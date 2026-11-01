'use strict';
// Plans, evidence and receipts live only in this page's memory.
const listName=kind=>kind==='WHITELIST'?'Whitelist':kind==='BLACKLIST'?'Blacklist':'Belum dipilih';
const rejectionReceipts=new WeakSet();
let listOperation=null;
function canonicalCampaign(id){
 if(!/^\d+$/.test(String(id))||!Number.isSafeInteger(Number(id))||Number(id)<=0)throw Error('Campaign Adsterra tidak valid.');
 return String(Number(id));
}
function clickaduWriteGuard(id){
 // Survives config deletion/editing/recreation and token changes in this page.
 // Numeric aliases use a string canonical form, never a lossy Number cast.
 if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id))throw Error('Campaign Clickadu tidak valid.');
 const physical=/^\d+$/.test(id)?id.replace(/^0+(?=\d)/,''):id;
 const guards=state.sessions.clickadu.writeGuards??=new Map(),key='clickadu:'+physical;
 if(!guards.has(key))guards.set(key,{uncertain:false});
 return guards.get(key);
}
function campaignMethod(config=activeConfig()){
 if(!config)return null;
 const methods=session().appMethods??=new Map(),key=canonicalCampaign(config.id);
 if(!methods.has(key))methods.set(key,{method:null,version:0,ready:false,approved:null,uncertain:false});
 return methods.get(key);
}
function selectedListKind(){
 const c=activeConfig();if(!c)return null;
 return state.provider==='adsterra'?campaignMethod(c).method:c.listMethod||c.listEvidence?.kind||null;
}
function strictListIds(values,{hashes=false,clickadu=false}={}){
 if(!Array.isArray(values)||values.length>20000)throw Error('Daftar API tidak valid, bukan daftar kosong.');
 const out=values.map(v=>{
  if(typeof v!=='number'&&typeof v!=='string')throw Error('ID daftar provider tidak valid.');
  const raw=String(v);
  if(hashes&&/^[a-zA-Z0-9]{32}$/.test(raw))return raw;
  if(!/^\d+$/.test(raw)||(clickadu?typeof v!=='string':!Number.isSafeInteger(Number(raw))||Number(raw)<=0))throw Error('ID daftar provider tidak didukung.');
  return clickadu?raw:String(Number(raw));
 });
 if(new Set(out).size!==out.length)throw Error('Daftar provider berisi ID duplikat.');
 return out.sort();
}
function parsePlacementList(data,id,blacklist=false){
 if(data&&Object.hasOwn(data,'campaign_id')&&canonicalCampaign(data.campaign_id)!==id)throw Error('Identitas daftar campaign tidak sesuai.');
 if(data&&!Array.isArray(data)&&(Object.hasOwn(data,'error')||Object.hasOwn(data,'errors')))throw Error('Respons daftar provider tidak valid.');
 return strictListIds(blacklist&&Array.isArray(data)&&data.length===0?data:data?.placement_ids,{hashes:blacklist});
}
function parseClickaduList(data,id){
 const raw=data?.result??data;
 if(!raw||String(raw.id)!==String(id)||!raw.targeting||typeof raw.targeting.zone?.isExcluded!=='boolean')throw Error('Identitas/metode campaign Clickadu tidak valid.');
 return {raw,kind:raw.targeting.zone.isExcluded?'BLACKLIST':'WHITELIST',ids:strictListIds(raw.targeting.zone.list,{clickadu:true})};
}
function acceptCampaign(config,raw,epoch=campaignMethod(config).statusEpoch||0){
 if(epoch!==(campaignMethod(config).statusEpoch||0))throw Error('Pembacaan status lama diabaikan.');
 if(!raw||canonicalCampaign(raw.id)!==canonicalCampaign(config.id)||![1,2,3,4].includes(raw.active))throw Error('Identitas/status campaign Adsterra tidak valid.');
 session().statuses??={};
 // A validated status is not lost if a later list/bid GET fails.
 for(const c of allConfigs())if(canonicalCampaign(c.id)===canonicalCampaign(config.id))session().statuses[c.id]=({1:'OFF',2:'LIMITED',3:'ON',4:'NOT IN USE'})[raw.active];
 renderCampaignTable();renderPlacementMethod();
 return {id:canonicalCampaign(raw.id),active:raw.active,pricing:typeof raw.pricing_type==='string'?raw.pricing_type.toUpperCase():'UNKNOWN'};
}
async function readPlacementLists(id,provider=state.provider,token=session().token,request=api){
 if(provider==='clickadu'){
  const read=parseClickaduList(await request('GET',`/api/v2/campaigns/${id}/`,undefined,provider,token),id);
  return {kind:read.kind,blacklist:read.kind==='BLACKLIST'?read.ids:null,whitelist:read.kind==='WHITELIST'?read.ids:null,campaign:read.raw,at:new Date().toISOString()};
 }
 id=canonicalCampaign(id);
 if(provider!==state.provider||token!==session().token)throw Error('Koneksi pembacaan sudah berubah.');
 const scopedConfig=allConfigs().find(c=>canonicalCampaign(c.id)===id);
 if(!scopedConfig)throw Error('Scope campaign sudah berubah.');
 const epoch=campaignMethod(scopedConfig).statusEpoch||0;
 const raw=await request('GET',`/advertiser/campaign/${id}.json`,undefined,provider,token);
 if(provider!==state.provider||token!==session().token)throw Error('Koneksi pembacaan sudah berubah.');
 const config=allConfigs().find(c=>canonicalCampaign(c.id)===id);
 if(!config)throw Error('Scope campaign sudah berubah.');
 const campaign=acceptCampaign(config,raw,epoch);
 const whitelist=parsePlacementList(await request('GET',`/advertiser/campaign/${id}/linking/whitelist.json`,undefined,provider,token),id);
 let blacklist;
 try{blacklist=parsePlacementList(await request('GET',`/advertiser/campaign/${id}/linking/blacklist.json`,undefined,provider,token),id,true);}
 catch(e){if(e.listEvidence?.kind!=='BLACKLIST_UNREADABLE_WHITELIST'||e.listEvidence.campaignId!==id||!whitelist.length)throw e;
  blacklist={unreadable:'WHITELIST',campaignId:id};}
 if(provider!==state.provider||token!==session().token||epoch!==(campaignMethod(config).statusEpoch||0))throw Error('Pembacaan daftar lama diabaikan.');
 return {blacklist,whitelist,campaign,at:new Date().toISOString()};
}
function listBaseline(s){return JSON.stringify({blacklist:s.blacklist,whitelist:s.whitelist,kind:s.kind});}
function comparableSnapshot(s){return JSON.stringify({campaign:s.campaign,lists:listBaseline(s)});}
function compatibleList(s,kind){
 return kind==='BLACKLIST'?Array.isArray(s.blacklist)&&s.whitelist.length===0
  :(Array.isArray(s.blacklist)?s.blacklist.length===0:s.blacklist?.unreadable==='WHITELIST'&&s.blacklist.campaignId===s.campaign.id&&s.whitelist.length>0);
}
function verifyListSnapshot(s,kind,target){
 if(state.provider==='clickadu')return s.kind===kind&&equalSet(kind==='BLACKLIST'?s.blacklist:s.whitelist,target);
 return compatibleList(s,kind)&&equalSet(kind==='BLACKLIST'?s.blacklist:s.whitelist,target);
}
function capabilityError(s,kind){
 if(!['CPM','CPC','CPA'].includes(s.campaign.pricing))return 'Pricing campaign belum dapat diverifikasi.';
 return kind==='WHITELIST'&&s.campaign.pricing==='CPA'?'Whitelist tidak didukung untuk campaign CPA.':'';
}
function assertBidAllowed(blacklist,id){
 // Special evidence is produced only after a valid nonempty whitelist GET.
 if(!Array.isArray(blacklist)){
  if(blacklist?.unreadable!=='WHITELIST'||blacklist.campaignId!==canonicalCampaign(activeConfig().id))throw Error('Blacklist belum dapat diverifikasi.');
  return;
 }
 if(blacklist.some(v=>!/^[1-9]\d*$/.test(v)))throw Error('Blacklist menggunakan hash; keamanan Simpan belum dapat dibuktikan.');
 if(blacklist.includes(id))throw Error('Placement sedang blacklist, Simpan ditolak.');
}
function clickaduListPayload(campaign,kind,target){
 const payload={};
 for(const key of CLICK_FIELDS)if(Object.hasOwn(campaign,key))payload[key]=campaign[key];
 for(const key of ['name','direction','frequency','capping','freqCapType','status','rateModel','feed','targetUrl','rates'])if(!Object.hasOwn(payload,key))throw Error(`Field campaign Clickadu '${key}' tidak lengkap.`);
 payload.targeting={...campaign.targeting,zone:{list:target,isExcluded:kind==='BLACKLIST'}};
 return payload;
}
async function refreshConfigLists(config){
 const provider=state.provider,owner=session(),token=owner.token;
 try{
  const result=await readPlacementLists(config.id,provider,token);
  if(state.provider!==provider||session()!==owner||owner.token!==token||!allConfigs().includes(config))return;
  config.listEvidence=result;config.listError='';
 }catch(e){if(state.provider===provider&&owner.token===token){config.listError=safeError(e);config.listEvidence=null;}}
}
function listEvidenceText(c){
 if(c.listError)return c.listError;
 const s=c.listEvidence;if(!s)return 'Daftar API belum dibaca.';
 if(state.provider==='clickadu')return `Aktual GET: ${listName(s.kind)} · ${(s.kind==='BLACKLIST'?s.blacklist:s.whitelist).length} Zone`;
 const m=campaignMethod(c),readiness=m.uncertain?'Write belum pasti':m.method?(m.ready&&m.approved===listBaseline(s)?'Siap':m.method==='WHITELIST'&&!s.whitelist.length?'Whitelist belum diisi':'Perlu diterapkan / daftar berubah'):m.version?'Pengaturan belum selesai':'Belum dipilih';
 return `${readiness}. Blacklist API: ${Array.isArray(s.blacklist)?s.blacklist.length:'tidak dapat dibaca karena Whitelist'} · Whitelist API: ${s.whitelist.length}. Bukan mode editor.`;
}
function renderPlacementMethod(){
 const c=activeConfig(),kind=selectedListKind();
 $('analysisMethod').textContent=c?(state.provider==='adsterra'?`Metode aplikasi: ${listName(kind)}.${kind?'':' Pilih metode di Campaign sebelum analisis.'}`:`Rencana: ${listName(kind)}. ${listEvidenceText(c)}`):'';
 const off=$('placementOff');if(off){off.classList.toggle('hidden',state.provider!=='adsterra'||!c);off.disabled=!c||Boolean(state.safetyPending);}
}
function clearListRejection(){state.listRejection=null;const box=$('listRejection');if(box)box.classList.add('hidden');}
function renderListRejection(){
 const box=$('listRejection'),r=state.listRejection;if(!box)return;
 box.classList.toggle('hidden',!r);if(!r)return;
 $('listRejectionReason').textContent=r.groups.map(g=>g.reason+': '+g.ids.join(', ')).join('; ')+(r.complete?'':' · Rincian terbatas; placement lain belum tentu diterima.');
 $('retryWhitelist').disabled=state.busy;
}
function operationContext(config,{analysis=false}={}){
 const provider=state.provider,owner=session(),token=owner.token,id=provider==='adsterra'?canonicalCampaign(config.id):config.id;
 const input=analysis?requireSetup(true):null,originalAnalysis=state.analysis,csv=state.csv,source=config.source;
 const method=provider==='adsterra'?campaignMethod(config):clickaduWriteGuard(config.id);
 let version=method.version,plan=config.listMethod,stopped=false,requests=0,writes=0;
 const deadline=Date.now()+90000,issues=[];
 const ctx={provider,id,config,owner,token,method,input,originalAnalysis,csv,issues,ambiguous:false,writeStarted:false,
  assert(){
   if(stopped||Date.now()>=deadline)throw Error('Operasi dihentikan atau batas waktu habis. Siapkan konfirmasi baru.');
   if(state.provider!==provider||session()!==owner||owner.token!==token||!allConfigs().includes(config)||config.source!==source||(provider==='adsterra'?canonicalCampaign(config.id):config.id)!==id)throw Error('Koneksi/scope berubah. Siapkan konfirmasi baru.');
   if(provider==='adsterra'&&method.version!==version||provider==='clickadu'&&config.listMethod!==plan)throw Error('Metode berubah. Siapkan konfirmasi baru.');
   if(analysis&&(state.analysis!==originalAnalysis||state.csv!==csv||activeConfig()!==config||JSON.stringify(requireSetup(true))!==JSON.stringify(input)))throw Error('Input analisis berubah. Jalankan analisis baru.');
  },
  stop(){stopped=true;},
  invalidate(){ctx.assert();if(provider==='adsterra'){method.version++;version=method.version;method.ready=false;}},
  reserve(count){ctx.assert();if(requests+count>40||deadline-Date.now()<15000)throw Error('Budget tidak cukup untuk perubahan dan verifikasi. Tidak menjadwalkan write berikutnya.');},
  async request(verb,path,body){
   ctx.assert();if(++requests>40)throw Error('Batas 40 request tercapai; hasil parsial tidak dianggap lengkap.');
   const remaining=deadline-Date.now();if(remaining<250)throw Error('Budget operasi habis.');
   const result=await api(verb,path,body,provider,token,{timeoutMs:Math.min(10000,remaining)});
   ctx.assert();return result;
  },
  async snapshot(){
   try{const value=await readPlacementLists(id,provider,token,ctx.request);ctx.assert();config.listEvidence=value;config.listError='';return value;}
   catch(e){try{ctx.assert();config.listError=safeError(e);}catch{/* Stale/cancelled errors cannot replace newer evidence. */}throw e;}
  },
  async bids(){return parseAdsterraBids(await ctx.request('GET',`/advertiser/campaign/${id}/custom_bid.json`));},
  async write(verb,path,body,reserve=8){
   ctx.reserve(reserve);ctx.assert();
   // All validation is before dispatch. A later local cancellation must not be
   // confused with a network request whose completion is unknown.
   const timeoutMs=Math.min(10000,deadline-Date.now());requests++;ctx.writeStarted=true;writes++;
   let failure=null;
   try{ctx.inflightWrite=api(verb,path,body,provider,token,{timeoutMs});const response=await ctx.inflightWrite;if(ctx.captureResponse)ctx.lastResponse=response;}
   catch(e){
    issues.push(safeError(e));
    if(e.uncertain!==false){ctx.ambiguous=true;method.uncertain=true;throw e;}
    failure=e;
   }
   finally{ctx.inflightWrite=null;}
   ctx.assert();return failure;
  },
  get writes(){return writes;},get version(){return version;},get remaining(){return deadline-Date.now();}
 };
 if(!token)throw Error('Simpan koneksi token terlebih dahulu.');
 if(method.uncertain)throw Error('Request sebelumnya belum pasti. Jangan mengulang write pada sesi ini; periksa provider. OFF tetap tersedia.');
 return ctx;
}
function rememberRejection(ctx,error,target,excluded){
 const r=error?.rejection;
 if(ctx.provider!=='adsterra'||!r||!Array.isArray(r.ids))return;
 const ids=strictListIds(r.ids).filter(id=>target.includes(id));if(!ids.length)return;
 const groups=Array.isArray(r.groups)?r.groups.map(g=>({reason:String(g.reason).slice(0,100),ids:ids.filter(id=>g.ids?.includes(id))})).filter(g=>g.ids.length):[];
 const receipt=Object.freeze({provider:ctx.provider,owner:ctx.owner,token:ctx.token,config:ctx.config,source:ctx.config.source,analysis:ctx.originalAnalysis,csv:ctx.csv,input:JSON.stringify(ctx.input),version:ctx.version,target:[...target],excluded:[...excluded],ids,groups,complete:r.complete===true,expires:Date.now()+300000});
 rejectionReceipts.add(receipt);state.listRejection=receipt;renderListRejection();
}
function exclusionTarget(ctx,kind,candidates,receipt){
 if(!receipt)return {target:candidates,excluded:[]};
 if(kind!=='WHITELIST'||!rejectionReceipts.has(receipt)||receipt!==state.listRejection||receipt.expires<Date.now()||receipt.provider!==ctx.provider||receipt.owner!==ctx.owner||receipt.token!==ctx.token||receipt.config!==ctx.config||receipt.source!==ctx.config.source||receipt.analysis!==ctx.originalAnalysis||receipt.csv!==ctx.csv||receipt.input!==JSON.stringify(ctx.input)||receipt.version!==ctx.version)throw Error('Penolakan lama tidak sesuai konteks. Analisis dan siapkan ulang.');
 if(!equalSet(candidates.filter(id=>!receipt.excluded.includes(id)),receipt.target)||receipt.excluded.some(id=>!candidates.includes(id))||receipt.ids.some(id=>!receipt.target.includes(id)))throw Error('Target penolakan berubah. Siapkan konfirmasi baru.');
 const excluded=[...new Set([...receipt.excluded,...receipt.ids])];
 return {target:candidates.filter(id=>!excluded.includes(id)),excluded};
}
async function applyPlacementList(receipt=null){
 if(!state.analysis||state.busy)return;
 busy(true,'Menyiapkan penerapan');notice('');let ctx,stage='persiapan',rejection=null,target=[],excluded=[];
 try{
  const cfg=activeConfig(),kind=selectedListKind();ctx=operationContext(cfg,{analysis:true});listOperation=ctx;
  if(!kind||state.analysis.listKind!==kind||state.analysis.methodVersion!==(state.provider==='adsterra'?ctx.version:null)||JSON.stringify(state.analysis.setup)!==JSON.stringify({...ctx.input,token:undefined}))throw Error('Metode/input berubah. Pilih metode Campaign dan analisis baru.');
  const candidates=strictListIds(listCandidates(state.rows,kind),{clickadu:ctx.provider==='clickadu'});
  ({target,excluded}=exclusionTarget(ctx,kind,candidates,receipt));
  if(kind==='WHITELIST'&&!target.length)throw Error('Whitelist wajib nonkosong. Tidak ada perubahan provider.');
  const before=await ctx.snapshot(),bids=ctx.provider==='adsterra'?await ctx.bids():null;
  if(ctx.provider==='clickadu'&&!cfg.listMethod&&before.kind!==kind)throw Error('Metode aktual Clickadu berubah. Analisis ulang mengikuti GET terbaru atau pilih rencana baru.');
  if(ctx.provider==='adsterra'){
   const blocker=capabilityError(before,kind);if(blocker)throw Error(blocker);
   if(ctx.method.method!==kind||!compatibleList(before,kind))throw Error('Metode/daftar berlawanan tidak sesuai. Atur melalui Campaign; Placement tidak mengosongkan daftar lawan.');
  }
  const resetBids=bids&&kind==='BLACKLIST'?bids.filter(b=>target.includes(b.placement)):[];
  const previous=ctx.provider==='clickadu'?listName(before.kind):listName(ctx.method.method);
  const oldList=ctx.provider==='clickadu'?(before.kind==='BLACKLIST'?before.blacklist:before.whitelist):(kind==='BLACKLIST'?before.blacklist:before.whitelist);
  const delta=`Tambah ${target.filter(id=>!oldList.includes(id)).length}; keluarkan ${oldList.filter(id=>!target.includes(id)).length} ID dari daftar lama.`;
  if(!window.confirm(`Campaign ${cfg.label||cfg.id} (${cfg.id})\n${previous} → ${listName(kind)}. Target final: ${target.length} ID. Daftar lama diganti penuh. ${delta}${kind==='BLACKLIST'&&!target.length?' Tidak ada placement yang dikecualikan.':''}\n${excluded.length?'Pengecualian: '+excluded.join(', ')+'\n':''}${resetBids.length?resetBids.length+' override Custom Bid seluruh GEO pada target dihapus setelah verifikasi; tidak dipulihkan saat ON.':'Custom Bid dipertahankan.'}\nTerapkan?`)){notice('Penerapan dibatalkan. Tidak ada write provider.');return;}
  ctx.assert();
  const rows=calculate(await getStats(ctx.id,ctx.input.from,ctx.input.till,ctx.request),commissions(ctx.input.source,ctx.input.from,ctx.input.till).map,ctx.input.fxExact??ctx.input.fx);
  if(!equalSet(strictListIds(listCandidates(rows,kind),{clickadu:ctx.provider==='clickadu'}),candidates))throw Error('Kandidat berubah. Analisis dan konfirmasi baru diperlukan.');
  const snapshot=await ctx.snapshot();
  if(comparableSnapshot(snapshot)!==comparableSnapshot(before)||bids&&!bidsEqual(bids,await ctx.bids()))throw Error('Campaign/daftar/Custom Bid berubah. Siapkan konfirmasi baru.');
  ctx.reserve(ctx.provider==='adsterra'?14:3);ctx.invalidate();clearListRejection();
  stage='penerapan daftar';
  if(!verifyListSnapshot(snapshot,kind,target)){
   const error=ctx.provider==='clickadu'?await ctx.write('PUT',`/api/v2/campaigns/${ctx.id}/`,clickaduListPayload(snapshot.campaign,kind,target),3)
    :await ctx.write('PUT',`/advertiser/linking/${kind.toLowerCase()}.json`,{campaign_id:Number(ctx.id),placement_ids:target.map(Number)},14);
   if(kind==='WHITELIST')rejection=error;
  }
  stage='verifikasi daftar';const actual=await ctx.snapshot();
  if(!verifyListSnapshot(actual,kind,target))throw Error('GET aktual belum cocok dengan seluruh target final.');
  if(ctx.provider==='adsterra'){
   stage='verifikasi/reset Custom Bid';
   if(!bidsEqual(bids,await ctx.bids()))throw Error('Custom Bid berubah sebelum reset; tidak ada penghapusan yang belum dikonfirmasi.');
   if(resetBids.length)await ctx.write('DELETE',`/advertiser/campaign/${ctx.id}/custom_bid.json`,{custom_bids:resetBids.map(b=>({placement_id:Number(b.placement),country_code:b.geo}))},7);
   const finalBids=await ctx.bids();state.bids=finalBids;
   if(!bidsEqual(kind==='BLACKLIST'?bids.filter(b=>!target.includes(b.placement)):bids,finalBids))throw Error('Custom Bid belum sesuai; hasil parsial. Tidak ada restore otomatis.');
  }
  stage='verifikasi akhir';const final=await ctx.snapshot();
  if(!verifyListSnapshot(final,kind,target)||ctx.provider==='adsterra'&&(final.campaign.active!==before.campaign.active||final.campaign.pricing!==before.campaign.pricing))throw Error('Daftar/status/pricing berubah pada verifikasi akhir.');
  if(ctx.provider==='adsterra'){
   const expected=kind==='BLACKLIST'?bids.filter(b=>!target.includes(b.placement)):bids;
   const finalBids=await ctx.bids();state.bids=finalBids;
   if(!bidsEqual(expected,finalBids))throw Error('Verifikasi akhir Custom Bid tidak sesuai.');
   ctx.method.ready=true;ctx.method.approved=listBaseline(final);
  }
  state.rows=rows;state.candidates=target;state.analysis.totals=sumStats(rows);state.analysis.methodVersion=ctx.provider==='adsterra'?ctx.version:null;
  state.analysis.excluded=excluded;state.analysis.candidateIds=[...target];
  render();
  if(kind==='BLACKLIST')recordReplaceTime();
  notice(`${ctx.writes?'Berhasil':'Sudah sesuai'}: ${listName(kind)} terverifikasi dengan ${target.length} ID.${ctx.issues.length?' Ada request ditolak; status terbaru berdasarkan GET, penyebab perubahan tidak diasumsikan.':''}`,'success');
 }catch(e){
  if(ctx&&ctx.writes){try{await ctx.snapshot();if(ctx.provider==='adsterra')state.bids=await ctx.bids();}catch{/* Keep prior successful bids; list failure is not bid failure. */}}
  if(rejection&&ctx&&!ctx.ambiguous)rememberRejection(ctx,rejection,target,excluded);
  if(ctx&&state.analysis===ctx.originalAnalysis&&ctx.provider==='adsterra')state.analysis.methodVersion=ctx.version;
  const result=ctx?.ambiguous?'Hasil belum pasti':ctx?.writes?'Penerapan ditolak / selesai sebagian':'Gagal menyiapkan penerapan';
  notice(`${result} (${stage}): ${safeError(rejection||e)}${rejection?' '+safeError(e):''} Tidak ada retry otomatis.`,'error');
  if(state.analysis)renderRows();
 }finally{if(ctx===listOperation)listOperation=null;busy(false);renderListRejection();renderPlacementMethod();}
}
