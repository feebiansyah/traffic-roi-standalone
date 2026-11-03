'use strict';
// No provider mode is inferred. This is an application method for this session.
async function chooseListMethod(id,kind){
 if(state.busy||!['','BLACKLIST','WHITELIST'].includes(kind))return;
 const config=allConfigs().find(c=>c.id===id);if(!config)return;
 if(state.provider==='clickadu'){
  config.listMethod=kind||null;invalidateAnalysis();renderPlacementMethod();renderCampaignTable();
  notice('Rencana dipilih. Aktual tetap berdasarkan GET; perubahan diterapkan bersama daftar final.','notice','campaignNotice');return;
 }
 if(!kind){renderCampaignTable();return;}
 busy(true,'Menyiapkan metode');let ctx,stage='persiapan';
 try{
  ctx=operationContext(config);listOperation=ctx;
  const before=await ctx.snapshot(),bids=await ctx.bids(),old=ctx.method.method;
  const blocker=capabilityError(before,kind);if(blocker)throw Error(blocker);
  const same=old===kind,compatible=compatibleList(before,kind);
  const reset=!same&&(old!==null||!compatible||kind==='WHITELIST'&&!before.whitelist.length);
  if(same&&!compatible)throw Error('Daftar berlawanan tidak sesuai. Metode yang sama tidak mereset konflik provider.');
  const adopt=old===null&&compatible&&(kind==='BLACKLIST'||before.whitelist.length>0);
  if(reset&&before.campaign.active!==1)throw Error('Campaign harus INACTIVE sebelum daftar placement dapat direset. Status campaign tidak diubah oleh fitur replacement.');
  const counts=`Blacklist API: ${Array.isArray(before.blacklist)?before.blacklist.length:'tidak dapat dibaca karena Whitelist; dibaca ulang setelah clear'}. Whitelist API: ${before.whitelist.length}.`;
  if(!window.confirm(`Campaign ${config.label||config.id} (${config.id})\n${listName(old)} → ${listName(kind)}.\n${same?'Metode sama; tidak ada reset.':adopt?'Adopsi daftar API existing; tidak ada reset.':'Campaign sudah INACTIVE. Daftar placement direset; status campaign tidak diubah.'}\n${counts}\nCustom Bid (${bids.length} override) dipertahankan.${!same&&kind==='WHITELIST'&&reset?' Whitelist belum diisi.':''}${!same&&kind==='BLACKLIST'?' Blacklist kosong berarti tidak ada placement dikecualikan.':''}\nKonfirmasi?`)){notice('Perubahan metode dibatalkan. Tidak ada write provider.','notice','campaignNotice');return;}
  ctx.assert();const current=await ctx.snapshot();
  if(comparableSnapshot(before)!==comparableSnapshot(current)||!bidsEqual(bids,await ctx.bids()))throw Error('Campaign/daftar/bid berubah. Konfirmasi baru diperlukan.');
  if(same){notice('Sudah sesuai: metode tidak diubah atau direset.','success','campaignNotice');return;}
  ctx.reserve(reset?23:1);ctx.invalidate();
  if(reset){
   stage='verifikasi INACTIVE sebelum reset';
   let snapshot=await ctx.snapshot();
   if(snapshot.campaign.active!==1)throw Error('Campaign belum terverifikasi INACTIVE; reset dihentikan.');
   if(!bidsEqual(bids,await ctx.bids())||listBaseline(snapshot)!==listBaseline(before)||snapshot.campaign.pricing!==before.campaign.pricing)throw Error('Daftar/bid/pricing berubah sebelum reset.');
   const clearWhitelist=async()=>{
    if(!snapshot.whitelist.length)return;
    stage='reset Whitelist';await ctx.write('POST',`/advertiser/campaign/${ctx.id}/linking/whitelist.json`,{},13);
    const previous=snapshot;snapshot=await ctx.snapshot();
    if(snapshot.whitelist.length||snapshot.campaign.active!==1||snapshot.campaign.pricing!==before.campaign.pricing||!bidsEqual(bids,await ctx.bids()))throw Error('Reset Whitelist/INACTIVE/bid belum terverifikasi.');
    if(!Array.isArray(snapshot.blacklist))throw Error('Blacklist harus dibaca ulang setelah Whitelist dihapus; bukan dianggap kosong.');
    if(Array.isArray(previous.blacklist)&&!equalSet(previous.blacklist,snapshot.blacklist))throw Error('Blacklist berubah saat reset Whitelist. Konfirmasi baru diperlukan.');
   };
   const clearBlacklist=async()=>{
    if(!Array.isArray(snapshot.blacklist))throw Error('Blacklist belum dapat diverifikasi.');
    if(!snapshot.blacklist.length)return;
    const previous=snapshot;stage='reset Blacklist';
    await ctx.write('POST','/advertiser/linking/blacklist/clean.json',{campaign_id:Number(ctx.id)},9);
    snapshot=await ctx.snapshot();
    if(!Array.isArray(snapshot.blacklist)||snapshot.blacklist.length||!equalSet(previous.whitelist,snapshot.whitelist)||snapshot.campaign.active!==1||snapshot.campaign.pricing!==before.campaign.pricing||!bidsEqual(bids,await ctx.bids()))throw Error('Reset Blacklist/INACTIVE/bid belum terverifikasi.');
   };
   if(!Array.isArray(snapshot.blacklist)||kind==='BLACKLIST'&&snapshot.whitelist.length){await clearWhitelist();await clearBlacklist();}
   else{await clearBlacklist();await clearWhitelist();}
  }
  stage='verifikasi akhir';const final=await ctx.snapshot(),finalBids=await ctx.bids();
  if(!bidsEqual(bids,finalBids)||final.campaign.pricing!==before.campaign.pricing||reset&&(final.campaign.active!==1||!Array.isArray(final.blacklist)||final.blacklist.length||final.whitelist.length)||!reset&&comparableSnapshot(before)!==comparableSnapshot(final))throw Error('Keadaan akhir belum sesuai. Metode baru tidak diterbitkan.');
  ctx.assert();ctx.method.method=kind;ctx.method.ready=adopt||reset&&kind==='BLACKLIST';ctx.method.approved=ctx.method.ready?listBaseline(final):null;
  invalidateAnalysis();renderPlacementMethod();
  notice(`Berhasil: ${listName(kind)} disimpan untuk sesi ini.${reset?' Daftar direset; status campaign tidak diubah.':''}${kind==='WHITELIST'&&!final.whitelist.length?' Whitelist belum diisi.':''} Custom Bid dipertahankan.${ctx.issues.length?' Ada request ditolak; hasil terbaru dibuktikan GET.':''}`,'success','campaignNotice');
 }catch(e){
  if(ctx?.writes)try{await ctx.snapshot();}catch{/* Preserve the last validated campaign read. */}
  const reason=safeError(e).replace(/\.+$/,'');notice(`${ctx?.ambiguous?'Hasil belum pasti':ctx?.writes?'Selesai sebagian':'Gagal'} (${stage}): ${reason}. Metode baru belum disimpan.`,'error','campaignNotice');
 }finally{if(listOperation===ctx)listOperation=null;busy(false);renderCampaignTable();renderPlacementMethod();}
}
