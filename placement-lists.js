'use strict';
// Session-only list workflow. No persistent method, credential or operation store.
const listName=kind=>kind==='WHITELIST'?'Whitelist':'Blacklist';
function selectedListKind(){return activeConfig()?.listMethod||'BLACKLIST';}
function listCandidates(rows,kind=selectedListKind()){
 if(kind==='BLACKLIST')return rows.filter(r=>r.candidate).map(r=>r.id);
 return rows.filter(r=>Number.isFinite(r.cost)&&r.cost>=1000&&Number.isFinite(r.roi)&&
  (state.provider==='clickadu'?r.roi>=30:Number.isFinite(r.ctr)&&r.roi>10&&r.ctr>8)).map(r=>r.id);
}
function strictListIds(values){
 if(!Array.isArray(values))throw Error('Daftar API tidak valid, bukan daftar kosong.');
 const out=values.map(v=>{const id=String(v);if(!/^[1-9]\d*$/.test(id)||!Number.isSafeInteger(Number(id)))throw Error('ID daftar provider tidak didukung.');return id;});
 if(new Set(out).size!==out.length)throw Error('Daftar provider berisi ID duplikat.');
 return out.sort();
}
function parsePlacementList(data,id,allowEmptyArray=false){
 if(data&&Object.hasOwn(data,'campaign_id')&&String(data.campaign_id)!==id)throw Error('Identitas daftar campaign tidak sesuai.');
 return strictListIds(allowEmptyArray&&Array.isArray(data)&&!data.length?data:data?.placement_ids);
}
function parseClickaduList(data,id){
 const raw=data?.result??data;
 if(!raw||String(raw.id)!==String(id)||!raw.targeting||typeof raw.targeting.zone?.isExcluded!=='boolean')throw Error('Identitas/metode campaign Clickadu tidak valid.');
 return {raw,kind:raw.targeting.zone.isExcluded?'BLACKLIST':'WHITELIST',ids:strictListIds(raw.targeting.zone.list)};
}
async function readPlacementLists(id,provider=state.provider,token=session().token){
 if(provider==='clickadu'){
  const read=parseClickaduList(await api('GET',`/api/v2/campaigns/${id}/`,undefined,provider,token),id);
  return {kind:read.kind,blacklist:read.kind==='BLACKLIST'?read.ids:null,whitelist:read.kind==='WHITELIST'?read.ids:null,campaign:read.raw,at:new Date().toISOString()};
 }
 if(!/^[1-9]\d*$/.test(id)||!Number.isSafeInteger(Number(id)))throw Error('Campaign Adsterra tidak didukung.');
 const campaign=await api('GET',`/advertiser/campaign/${id}.json`,undefined,provider,token);
 if(String(campaign?.id)!==id||![1,2,3,4].includes(campaign.active))throw Error('Identitas/status campaign Adsterra tidak valid.');
 const whitelist=parsePlacementList(await api('GET',`/advertiser/campaign/${id}/linking/whitelist.json`,undefined,provider,token),id);
 let blacklist;
 try{blacklist=parsePlacementList(await api('GET',`/advertiser/campaign/${id}/linking/blacklist.json`,undefined,provider,token),id,true);}
 catch(e){if(e.listEvidence?.kind!=='BLACKLIST_UNREADABLE_WHITELIST'||e.listEvidence.campaignId!==id||!whitelist.length)throw e;
  blacklist={unreadable:'WHITELIST',campaignId:id};}
 return {blacklist,whitelist,campaign,at:new Date().toISOString()};
}
function comparableSnapshot(s){
 return JSON.stringify({campaign:s.campaign,blacklist:s.blacklist,whitelist:s.whitelist,kind:s.kind});
}
function oppositeNeedsClear(s,kind){
 return kind==='BLACKLIST'?Array.isArray(s.whitelist)&&s.whitelist.length>0:Array.isArray(s.blacklist)&&s.blacklist.length>0;
}
function verifyListSnapshot(s,kind,target){
 if(state.provider==='clickadu')return s.kind===kind&&equalSet(kind==='BLACKLIST'?s.blacklist:s.whitelist,target);
 if(kind==='BLACKLIST')return Array.isArray(s.blacklist)&&equalSet(s.blacklist,target)&&s.whitelist.length===0;
 return equalSet(s.whitelist,target)&&(Array.isArray(s.blacklist)?!s.blacklist.length:s.blacklist?.unreadable==='WHITELIST'&&s.blacklist.campaignId===s.campaign.id.toString()&&target.length>0);
}
function clickaduListPayload(campaign,kind,target){
 const payload={};
 for(const key of CLICK_FIELDS)if(Object.hasOwn(campaign,key))payload[key]=campaign[key];
 for(const key of ['name','direction','frequency','capping','freqCapType','status','rateModel','feed','targetUrl','rates'])if(!Object.hasOwn(payload,key))throw Error(`Field campaign Clickadu '${key}' tidak lengkap.`);
 payload.targeting={...campaign.targeting,zone:{...campaign.targeting.zone,list:target,isExcluded:kind==='BLACKLIST'}};
 return payload;
}
async function refreshConfigLists(config){
 try{config.listEvidence=await readPlacementLists(config.id);config.listError='';}
 catch(e){config.listError=safeError(e);config.listEvidence=null;}
}
function chooseListMethod(id,kind){
 if(state.busy||!['BLACKLIST','WHITELIST'].includes(kind))return;
 const config=allConfigs().find(c=>c.id===id);if(!config)return;
 config.listMethod=kind;
 if(activeConfig()===config){invalidateAnalysis();$('analysisMethod').textContent='Metode tujuan dari Campaign: '+listName(kind)+'. Aktual hanya berdasarkan GET provider.';}
 renderCampaignTable();notice(`Rencana ${listName(kind)} dipilih. Analisis dan penerapan belum mengubah daftar provider.`,'notice','campaignNotice');
}
function listEvidenceText(c){
 if(c.listError)return c.listError;
 const s=c.listEvidence;if(!s)return 'Daftar API belum dibaca.';
 if(state.provider==='clickadu')return `Aktual GET: ${listName(s.kind)} · ${(s.kind==='BLACKLIST'?s.blacklist:s.whitelist).length} Zone`;
 return `Blacklist API: ${Array.isArray(s.blacklist)?s.blacklist.length:'tidak dapat dibaca karena Whitelist'} · Whitelist API: ${s.whitelist.length}. Pilihan aplikasi bukan mode editor.`;
}
async function applyPlacementList(){
 if(!state.analysis||state.busy)return;
 busy(true,'Menyiapkan penerapan');notice('');
 const cfg=activeConfig(),provider=state.provider,kind=selectedListKind();
 let writes=0,ambiguous=false,stage='persiapan',confirmedTarget=[];
 const issues=[];
 const write=async(method,path,body)=>{
  writes++;
  try{await api(method,path,body,provider,setup.token);}
  catch(e){
   const rejected=Array.isArray(e.rejectedIds)?e.rejectedIds.filter(id=>confirmedTarget.includes(id)):[];
   const reason=safeError(e)+(rejected.length?' ID ditolak (cuplikan): '+rejected.join(', '):'');
   if(e.uncertain!==false){ambiguous=true;throw e;}issues.push(reason);
  }
 };
 let setup;
 try{
  if(cfg.listUncertain)throw Error('Request sebelumnya belum pasti. Jangan mengulang write pada sesi ini; periksa provider.');
  setup=requireSetup(true);
  if(JSON.stringify(state.analysis.setup)!==JSON.stringify({...setup,token:undefined})||state.analysis.listKind!==kind)throw Error('Input/metode berubah. Jalankan analisis baru.');
  const target=strictListIds(listCandidates(state.rows,kind));
  confirmedTarget=target;
  if(kind==='WHITELIST'&&!target.length)throw Error('Whitelist wajib nonkosong. Tidak ada perubahan provider.');
  const before=await readPlacementLists(setup.campaign);
  const bids=provider==='adsterra'?await getBids():null;
  if(provider==='adsterra'&&kind==='WHITELIST'&&!/^(CPM|CPC)$/i.test(before.campaign.pricing_type||''))throw Error('Pricing campaign belum terbukti mendukung Whitelist (CPA tidak didukung).');
  const clear=provider==='adsterra'&&oppositeNeedsClear(before,kind);
  const resetBids=provider==='adsterra'&&kind==='BLACKLIST'?bids.filter(b=>target.includes(b.placement)):[];
  const previous=provider==='clickadu'?listName(before.kind):'daftar API (bukan mode editor)';
  const message=`Campaign ${cfg.label||cfg.id} (${cfg.id})\n${previous} → ${listName(kind)}. Target final: ${target.length} ${provider==='clickadu'?'Zone':'Placement'}.\nDaftar tujuan lama diganti penuh.${clear?'\nDaftar berlawanan dikosongkan. Campaign harus terverifikasi INACTIVE; jika perlu akan dimatikan, tanpa ON otomatis.':''}\n${resetBids.length?resetBids.length+' override Custom Bid seluruh GEO pada target blacklist dihapus setelah verifikasi. Tidak dipulihkan saat ON kembali.':'Custom Bid dipertahankan.'}\nKonfirmasi penerapan?`;
  if(!window.confirm(message)){notice('Penerapan dibatalkan. Tidak ada write provider.');return;}
  // Revalidate exact input, candidates, full campaign and lists after confirmation.
  const current=requireSetup(true);
  if(activeConfig()!==cfg||state.provider!==provider||cfg.listMethod&&cfg.listMethod!==kind||JSON.stringify(current)!==JSON.stringify(setup))throw Error('Target berubah. Siapkan konfirmasi baru.');
  const rows=calculate(await getStats(setup.campaign,setup.from,setup.till),commissions(setup.source,setup.from,setup.till).map,setup.fx);
  if(!equalSet(strictListIds(listCandidates(rows,kind)),target))throw Error('Kandidat berubah. Jalankan analisis dan konfirmasi baru.');
  let snapshot=await readPlacementLists(setup.campaign);
  if(comparableSnapshot(snapshot)!==comparableSnapshot(before))throw Error('Pengaturan/daftar provider berubah. Siapkan konfirmasi baru.');
  if(bids&&!bidsEqual(bids,await getBids()))throw Error('Custom Bid berubah. Siapkan konfirmasi baru.');
  if(clear){
   stage='OFF sebelum clear';
   if(snapshot.campaign.active!==1){
    await write('PATCH',`/advertiser/campaign/${setup.campaign}.json`,{active:false});
    const campaign=await getCampaign();
    if(String(campaign.raw.id)!==cfg.id||campaign.raw.active!==1)throw Error('Campaign belum terverifikasi INACTIVE. Daftar tidak dikosongkan.');
   }
   snapshot=await readPlacementLists(setup.campaign);
   if(snapshot.campaign.active!==1||!bidsEqual(bids,await getBids()))throw Error('Prasyarat OFF/bid berubah sebelum clear.');
   stage='clear daftar berlawanan';
   if(kind==='BLACKLIST')await write('POST',`/advertiser/campaign/${cfg.id}/linking/whitelist.json`,{});
   else await write('POST','/advertiser/linking/blacklist/clean.json',{campaign_id:Number(cfg.id)});
   snapshot=await readPlacementLists(cfg.id);
   if(snapshot.campaign.active!==1||!Array.isArray(snapshot.blacklist)||(kind==='WHITELIST'?snapshot.blacklist.length:snapshot.whitelist.length)||!bidsEqual(bids,await getBids()))throw Error('Clear/INACTIVE/bid belum sesuai; penerapan target dihentikan.');
  }
  stage='penerapan daftar';
  if(!verifyListSnapshot(snapshot,kind,target)){
   if(provider==='clickadu')await write('PUT',`/api/v2/campaigns/${cfg.id}/`,clickaduListPayload(snapshot.campaign,kind,target));
   else await write('PUT',`/advertiser/linking/${kind.toLowerCase()}.json`,{campaign_id:Number(cfg.id),placement_ids:target.map(Number)});
  }
  stage='verifikasi daftar';
  const actual=await readPlacementLists(cfg.id);cfg.listEvidence=actual;cfg.listError='';
  if(!verifyListSnapshot(actual,kind,target))throw Error('GET aktual belum cocok dengan metode/seluruh target final.');
  if(clear&&actual.campaign.active!==1)throw Error('Status campaign berubah setelah clear; hasil belum lengkap.');
  if(provider==='adsterra'){
   stage='verifikasi/reset Custom Bid';
   if(kind==='WHITELIST'){if(!bidsEqual(bids,await getBids()))throw Error('Whitelist sesuai, tetapi Custom Bid berubah. Tidak ada restore otomatis.');}
   else {
    const now=await getBids();
    if(!bidsEqual(bids,now))throw Error('Bid berubah sebelum reset; jangan menghapus override yang belum dikonfirmasi.');
    if(resetBids.length)await write('DELETE',`/advertiser/campaign/${cfg.id}/custom_bid.json`,{custom_bids:resetBids.map(b=>({placement_id:Number(b.placement),country_code:b.geo}))});
    const final=await getBids();state.bids=final;
    if(final.some(b=>target.includes(b.placement))||!bidsEqual(bids.filter(b=>!target.includes(b.placement)),final))throw Error('Reset Custom Bid belum lengkap atau bid lain berubah.');
   }
  }
  if(!verifyListSnapshot(await readPlacementLists(cfg.id),kind,target))throw Error('Daftar berubah pada verifikasi akhir.');
  state.rows=rows;state.candidates=target;state.analysis.totals=sumStats(rows);state.blocked=kind==='BLACKLIST'?target:null;
  render();renderCampaignTable();
  if(issues.length){notice(`Selesai sebagian: GET sesuai target, tetapi ada request ditolak: ${issues.join(' ')}. Tidak mengasumsikan penyebab perubahan.`);return;}
  if(kind==='BLACKLIST')recordReplaceTime();
  notice(`${writes?'Berhasil':'Sudah sesuai'}: ${listName(kind)} terverifikasi dengan ${target.length} ID.`,'success');
 }catch(e){
  // A completed validation refusal may be re-prepared, but an unresolved
  // dispatched write (including a failed verification GET) stays fenced here.
  if(ambiguous||(writes&&!issues.length))cfg.listUncertain=true;
  let actual='';
  if(writes)try{const snapshot=await readPlacementLists(cfg.id);cfg.listEvidence=snapshot;cfg.listError='';actual=` GET akhir: Blacklist ${Array.isArray(snapshot.blacklist)?snapshot.blacklist.length:provider==='clickadu'?'tidak aktif pada metode Clickadu':'tidak dapat dibaca karena Whitelist'}, Whitelist ${Array.isArray(snapshot.whitelist)?snapshot.whitelist.length:'tidak aktif pada metode Clickadu'}. `; }catch{cfg.listUncertain=true;actual=' GET akhir gagal; keadaan provider belum terverifikasi. ';cfg.listError=actual;}
  const outcome=ambiguous||cfg.listUncertain?'Hasil belum pasti':writes?'Penerapan ditolak / selesai sebagian':'Gagal menyiapkan penerapan';
  notice(`${outcome} (${stage}): ${safeError(e)}${issues.length?' '+issues.join(' '):''}${actual} Tidak ada retry atau rollback otomatis.`,'error');
 }finally{busy(false);}
}
