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
    [/^\/advertiser\/linking\/blacklist\.json$/, ['PUT']],
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
  try {
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(),45000);
    let result;
    try {
      result=await fetch(target.toString(),{
        method, headers, body:serialized,
        redirect:'manual', cache:'no-store', signal:controller.signal,
      });
    } finally {clearTimeout(timeout);}
    if(result.status>=300 && result.status<400) return reply({error:'Redirect provider ditolak.'},502);
    // Limit response size regardless of whether provider provides Content-Length.
    const advertised=Number(result.headers.get('content-length')||0);
    if(advertised>MAX_RESPONSE) return reply({error:'Respons provider terlalu besar.'},502);
    const chunks=[];
    let total=0;
    if(result.body){
      const reader=result.body.getReader();
      try {
        while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;
          if(total>MAX_RESPONSE){await reader.cancel();return reply({error:'Respons provider terlalu besar.'},502);}
          chunks.push(value);
        }
      } finally {reader.releaseLock();}
    }
    // Never reveal provider error body; it might contain private information.
    if(!result.ok) return reply({error:`API ${provider} menolak request (HTTP ${result.status}).`},result.status);
    const jsonText=Buffer.concat(chunks.map(x=>Buffer.from(x)),total).toString('utf8');
    let value;
    try {value=jsonText?JSON.parse(jsonText):null;}catch{return reply({error:'Respons JSON provider tidak valid.'},502);}
    return reply({ok:true,value,status:result.status});
  } catch {
    return reply({error:method==='GET'
      ? 'Koneksi provider gagal atau timeout.'
      : 'Write mungkin sudah diproses, tetapi respons tidak dapat dipastikan. Periksa dashboard provider dan jangan ulang otomatis.'},502);
  }
}

export function GET(){return reply({ok:true,app:'Traffic ROI Session',message:'API siap, gunakan dashboard untuk melakukan request.'});}
export function OPTIONS(){return reply({error:'Tidak menerima cross-origin request.'},405);}
