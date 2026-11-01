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
const invalidRequest=(error,status)=>reply({error,uncertain:false},status);

// Preserve only statistics spent numeric lexemes before JSON.parse can round
// them. The relay's internal DTO accepts the same decimal string as the UI.
// Matching whole JSON string tokens prevents replacing text inside strings.
function statisticsJson(text){
  let previous='',end=0;
  return JSON.parse(text.replace(/"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,(token,offset)=>{
    const money=token[0]!=='"'&&previous==='spent'&&/^\s*:\s*$/.test(text.slice(end,offset));
    previous=token[0]==='"'?JSON.parse(token):'';end=offset+token.length;
    return money?JSON.stringify(token):token;
  }));
}

// Only recognized public validation reasons and bounded numeric IDs may leave
// the relay. Never forward arbitrary provider messages, URLs or raw error JSON.
function whitelistRejection(data,target){
  const allowed=new Set(target.map(String)),ids=new Set(),groups=new Map();let complete=true,records=0;
  const reasons=new Set(['Token not found','Invalid token','Invalid owner type','Invalid output format','Campaign not found','In use landings not found','Validation failed','Data validation error','Unsuccessfully linked','Not exists','Not suitable ad unit','Not suitable category','Already linked','Blacklisted','Not suitable tags','Not active publisher','Not active placement','Invalid integer field']);
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v:null;
  function read(value,field){
    const row=object(value);
    if(++records>100||!row||typeof row.reason!=='string'||!Array.isArray(row[field])){complete=false;return;}
    let reason=reasons.has(row.reason)?row.reason:/^Placement with ids [\d, ]+ not found$/.test(row.reason)?'Placement IDs not found':/^Landings for campaign with id \d+ not found$/.test(row.reason)?'Campaign landings not found':row.reason==='This value should be of type int.'?'Invalid integer field':'Provider reason unavailable';
    if(reason==='Provider reason unavailable')complete=false;
    if(!groups.has(reason)){if(groups.size>=8){complete=false;return;}groups.set(reason,{reason,ids:[]});}
    const group=groups.get(reason);if(row[field].length>500)complete=false;
    for(const raw of row[field].slice(0,500)){
      const id=['number','string'].includes(typeof raw)&&/^\d+$/.test(String(raw))&&Number.isSafeInteger(Number(raw))&&Number(raw)>0?String(Number(raw)):'';
      if(!allowed.has(id)||!ids.has(id)&&ids.size>=500){complete=false;continue;}
      ids.add(id);if(!group.ids.includes(id))group.ids.push(id);
    }
  }
  const errors=object(object(data)?.errors);if(!errors)return {ids:[],groups:[],complete:false};
  if(Object.keys(errors).some(k=>!['placement_ids','landing_ids'].includes(k)))complete=false;
  if(errors.placement_ids!==undefined){if(!Array.isArray(errors.placement_ids))complete=false;else{if(errors.placement_ids.length>100)complete=false;for(const row of errors.placement_ids.slice(0,100))read(row,'ids');}}
  if(errors.landing_ids!==undefined){
    const landings=object(errors.landing_ids);if(!landings)complete=false;
    else{const entries=Object.entries(landings);if(entries.length>100)complete=false;
      for(const [landing,rows] of entries.slice(0,100)){
        if(!/^\d+$/.test(landing)||!Array.isArray(rows)){complete=false;continue;}
        if(rows.length>100)complete=false;
        for(const row of rows.slice(0,100)){if(records>=100){complete=false;break;}read(row,'placement_ids');}
      }
    }
  }
  return {ids:[...ids],groups:[...groups.values()].filter(g=>g.ids.length),complete:complete&&records>0};
}
function listFailure(provider, method, path, status, text,body) {
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
  out.rejection=whitelistRejection(data,Array.isArray(body?.placement_ids)?body.placement_ids:[]);
  if(out.rejection.groups.length)out.error+=' '+out.rejection.groups.map(g=>g.reason).join('; ')+'.';
  return out;
}

export async function POST(request) {
  // Browser request must come from same deployed origin (not cross-site form/fetch).
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (!origin || origin !== requestUrl.origin || (fetchSite && !['same-origin','none'].includes(fetchSite))) {
    return invalidRequest('Permintaan harus berasal dari halaman Traffic ROI.',403);
  }
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) return invalidRequest('Content type tidak valid.',415);
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(contentLength) || contentLength > MAX_REQUEST) return invalidRequest('Request terlalu besar.',413);
  let raw;
  try {raw=await request.text();} catch {return invalidRequest('Gagal membaca request.',400);}
  if (Buffer.byteLength(raw,'utf8') > MAX_REQUEST) return invalidRequest('Request terlalu besar.',413);
  let payload;
  try {payload=JSON.parse(raw);} catch {return invalidRequest('JSON request tidak valid.',400);}
  if (!payload || typeof payload!=='object' || Array.isArray(payload)) return invalidRequest('Request tidak valid.',400);
  const {provider, method, path, token, body}=payload;
  if (typeof provider!=='string' || !Object.hasOwn(UPSTREAMS,provider)
      || typeof method!=='string' || !['GET','PUT','POST','PATCH','DELETE'].includes(method)
      || typeof path!=='string' || typeof token!=='string' || !token.trim() || token.length>4096) {
    return invalidRequest('Provider, endpoint, metode, atau token tidak valid.',400);
  }
  let target;
  try {target = new URL(path,UPSTREAMS[provider]);} catch {return invalidRequest('Alamat API tidak valid.',400);}
  if(target.origin !== UPSTREAMS[provider] || target.username || target.password || target.hash
       || !RULES[provider].some(([pattern,methods])=>pattern.test(target.pathname) && methods.includes(method))) {
    return invalidRequest('Endpoint atau metode API tidak diizinkan.',403);
  }
  if(method==='GET' && body!=null) return invalidRequest('GET tidak menerima body.',400);
  let serialized;
  if(method!=='GET') {
    try {serialized=JSON.stringify(body ?? {});} catch {return invalidRequest('Payload provider tidak valid.',400);}
    if(Buffer.byteLength(serialized,'utf8')>MAX_REQUEST) return invalidRequest('Payload provider terlalu besar.',413);
  }
  const headers = provider==='clickadu'
    ? {Authorization:token}
    : {'X-API-Key':token, Accept:'application/json'};
  if(serialized!==undefined)headers['Content-Type']='application/json';
  let timeout;
  try {
    const controller = new AbortController();
    // List pipelines opt into a 10s request timeout; other existing reads retain theirs.
    const timeoutMs=Number.isInteger(payload.timeoutMs)&&payload.timeoutMs>0?Math.min(payload.timeoutMs,10000):45000;
    timeout = setTimeout(()=>controller.abort(),timeoutMs);
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
    if(!result.ok)return reply(listFailure(provider,method,target.pathname,result.status,jsonText,body),result.status);
    let value;
    try {value=jsonText?(method==='GET'&&['/advertiser/stats.json','/v1.0/api/client/statistics/'].includes(target.pathname)?statisticsJson(jsonText):JSON.parse(jsonText)):null;}catch{return reply({error:'Respons JSON provider tidak valid.'},502);}
    return reply({ok:true,value,status:result.status});
  } catch {
    return reply({error:method==='GET'
      ? 'Koneksi provider gagal atau timeout.'
      : 'Write mungkin sudah diproses, tetapi respons tidak dapat dipastikan. Periksa dashboard provider dan jangan ulang otomatis.',uncertain:method!=='GET'},502);
  } finally {clearTimeout(timeout);}
}

export function GET(){return reply({ok:true,app:'Traffic ROI Session',message:'API siap, gunakan dashboard untuk melakukan request.'});}
export function OPTIONS(){return reply({error:'Tidak menerima cross-origin request.'},405);}
