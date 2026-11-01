// Session-only API relay for Vercel Functions (Node.js, Web Request/Response).
// No database, cookies, sessions or credentials saved in the app.
// The operator's API token is forwarded to exactly one allowlisted provider.
const UPSTREAMS = Object.freeze({
  clickadu: 'https://ssp.clickadu.com',
  adsterra: 'https://api3.adsterratools.com',
});
const RULES = {
  clickadu: [
    [/^\/v1\.0\/api\/client\/statistics\/$/, ['GET']],
    [/^\/v1\.0\/api\/client\/campaigns\/[A-Za-z0-9_-]+\/blocked\/zone\/$/, ['GET']],
    [/^\/api\/v2\/campaigns\/[A-Za-z0-9_-]+\/$/, ['GET','PUT']],
  ],
  adsterra: [
    [/^\/advertiser\/stats\.json$/, ['GET']],
    [/^\/advertiser\/campaign\/[0-9]+\/linking\/blacklist\.json$/, ['GET']],
    [/^\/advertiser\/campaign\/[0-9]+\/linking\/whitelist\.json$/, ['GET','POST']],
    [/^\/advertiser\/linking\/blacklist\.json$/, ['PUT']],
    [/^\/advertiser\/linking\/whitelist\.json$/, ['PUT']],
    [/^\/advertiser\/linking\/blacklist\/clean\.json$/, ['POST']],
    [/^\/advertiser\/campaign\/[0-9]+\/custom_bid\.json$/, ['GET','POST','PATCH','DELETE']],
    [/^\/advertiser\/campaign\/[0-9]+\.json$/, ['GET','PATCH']],
  ],
};
const MAX_REQUEST = 128 * 1024;
const MAX_RESPONSE = 20 * 1024 * 1024;
const NO_STORE = {
  'Cache-Control': 'no-store, private, max-age=0',
  'Pragma': 'no-cache',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const reply = (data, status=200) => Response.json(data,{status,headers:NO_STORE});

// Only recognized public validation reasons and bounded numeric IDs may leave
// the relay. Never forward arbitrary provider messages, URLs or raw error JSON.
function listFailure(provider, method, path, status, text) {
  const out={error:`API ${provider} menolak request (HTTP ${status}).`,uncertain:method!=='GET'&&(status>=500||status===408||status===429)};
  if(provider!=='adsterra'||status!==422||text.length>65536)return out;
  let data;try{data=JSON.parse(text);}catch{return out;}
  const campaign=path.match(/^\/advertiser\/campaign\/([1-9]\d*)\/linking\/blacklist\.json$/)?.[1];
  const refusal=data?.message==='Unprocessable Content'&&Object.keys(data).every(k=>['message','errors'].includes(k))
    &&data.errors&&typeof data.errors==='object'&&!Array.isArray(data.errors)&&Object.keys(data.errors).length===1
    &&Array.isArray(data.errors.campaign_ids)&&data.errors.campaign_ids.length===1
    &&data.errors.campaign_ids[0]===`Campaigns, inoperable due to having a whitelist: ${campaign}`;
  if(method==='GET'&&campaign&&refusal){
    out.error='Blacklist tidak dapat dibaca karena campaign memiliki Whitelist.';
    out.listEvidence={kind:'BLACKLIST_UNREADABLE_WHITELIST',campaignId:campaign};
    return out;
  }
  if(method!=='PUT'||path!=='/advertiser/linking/whitelist.json')return out;
  const reasons=new Set(),ids=new Set();
  const allowed=['Not suitable tags','Not suitable ad unit','Not exists','Unsuccessfully linked','Blacklisted'];
  let nodes=0;
  function visit(value,depth=0){
    if(depth>8||++nodes>3000)return;
    if(typeof value==='string'&&allowed.includes(value))reasons.add(value);
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value.placement_ids))for(const id of value.placement_ids.slice(0,200)){
      if(/^[1-9]\d*$/.test(String(id))&&Number.isSafeInteger(Number(id)))ids.add(String(id));
    }
    for(const child of Object.values(value))visit(child,depth+1);
  }
  visit(data.errors);
  if(reasons.size)out.error+=' '+[...reasons].join('; ')+'.';
  if(ids.size)out.rejectedIds=[...ids].slice(0,100);
  return out;
}

export async function POST(request) {
  // Browser request must come from same deployed origin (not cross-site form/fetch).
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (!origin || origin !== requestUrl.origin || (fetchSite && !['same-origin','none'].includes(fetchSite))) {
    return reply({error:'Permintaan harus berasal dari halaman Traffic ROI.'},403);
  }
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) return reply({error:'Content type tidak valid.'},415);
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(contentLength) || contentLength > MAX_REQUEST) return reply({error:'Request terlalu besar.'},413);
  let raw;
  try {raw=await request.text();} catch {return reply({error:'Gagal membaca request.'},400);}
  if (Buffer.byteLength(raw,'utf8') > MAX_REQUEST) return reply({error:'Request terlalu besar.'},413);
  let payload;
  try {payload=JSON.parse(raw);} catch {return reply({error:'JSON request tidak valid.'},400);}
  if (!payload || typeof payload!=='object' || Array.isArray(payload)) return reply({error:'Request tidak valid.'},400);
  const {provider, method, path, token, body}=payload;
  if (typeof provider!=='string' || !Object.hasOwn(UPSTREAMS,provider)
      || typeof method!=='string' || !['GET','PUT','POST','PATCH','DELETE'].includes(method)
      || typeof path!=='string' || typeof token!=='string' || !token.trim() || token.length>4096) {
    return reply({error:'Provider, endpoint, metode, atau token tidak valid.'},400);
  }
  let target;
  try {target = new URL(path,UPSTREAMS[provider]);} catch {return reply({error:'Alamat API tidak valid.'},400);}
  if(target.origin !== UPSTREAMS[provider] || target.username || target.password || target.hash
       || !RULES[provider].some(([pattern,methods])=>pattern.test(target.pathname) && methods.includes(method))) {
    return reply({error:'Endpoint atau metode API tidak diizinkan.'},403);
  }
  if(method==='GET' && body!=null) return reply({error:'GET tidak menerima body.'},400);
  let serialized;
  if(method!=='GET') {
    try {serialized=JSON.stringify(body ?? {});} catch {return reply({error:'Payload provider tidak valid.'},400);}
    if(Buffer.byteLength(serialized,'utf8')>MAX_REQUEST) return reply({error:'Payload provider terlalu besar.'},413);
  }
  const headers = provider==='clickadu'
    ? {Authorization:token}
    : {'X-API-Key':token, Accept:'application/json'};
  if(serialized!==undefined)headers['Content-Type']='application/json';
  let timeout;
  try {
    const controller = new AbortController();
    timeout = setTimeout(()=>controller.abort(),45000);
    let result;
    try {
      result=await fetch(target.toString(),{
        method, headers, body:serialized,
        redirect:'manual', cache:'no-store', signal:controller.signal,
      });
    } finally { /* The timeout also bounds reading the response body below. */ }
    if(result.status>=300 && result.status<400) return reply({error:'Redirect provider ditolak.'},502);
    // Limit response size regardless of whether provider provides Content-Length.
    const advertised=Number(result.headers.get('content-length')||0);
    if(advertised>MAX_RESPONSE) return reply({error:'Respons provider terlalu besar.'},502);
    const responseLimit=result.ok?MAX_RESPONSE:65536;
    const chunks=[];
    let total=0;
    if(result.body){
      const reader=result.body.getReader();
      try {
        while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;
          if(total>responseLimit){await reader.cancel();return reply({error:'Respons provider terlalu besar.',uncertain:method!=='GET'},502);}
          chunks.push(value);
        }
      } finally {reader.releaseLock();}
    }
    const jsonText=Buffer.concat(chunks.map(x=>Buffer.from(x)),total).toString('utf8');
    if(!result.ok)return reply(listFailure(provider,method,target.pathname,result.status,jsonText),result.status);
    let value;
    try {value=jsonText?JSON.parse(jsonText):null;}catch{return reply({error:'Respons JSON provider tidak valid.'},502);}
    return reply({ok:true,value,status:result.status});
  } catch {
    return reply({error:method==='GET'
      ? 'Koneksi provider gagal atau timeout.'
      : 'Write mungkin sudah diproses, tetapi respons tidak dapat dipastikan. Periksa dashboard provider dan jangan ulang otomatis.',uncertain:method!=='GET'},502);
  } finally {clearTimeout(timeout);}
}

export function GET(){return reply({ok:true,app:'Traffic ROI Session',message:'API siap, gunakan dashboard untuk melakukan request.'});}
export function OPTIONS(){return reply({error:'Tidak menerima cross-origin request.'},405);}
