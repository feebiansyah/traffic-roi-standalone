'use strict';
// One raw-value decision shared by table, count, clipboard and application.
function listDecision(row,provider=state.provider){
 let cost,roiCompare;
 try{
  cost=exactDecimal.value(row.exactMoney?.cost??row.cost);
  if(exactDecimal.compare(cost,0)<0)return 'UNKNOWN';
  if(exactDecimal.compare(cost,1000)<0)return 'INSUFFICIENT';
  if(row.exactMoney){
   // ROI >= p iff commission * 100 >= cost * (100 + p), cost > 0.
   // Cross products retain exact decimal thresholds without any division.
   const commission=exactDecimal.value(row.exactMoney.commission);
   roiCompare=p=>exactDecimal.compare(exactDecimal.multiply(commission,100),exactDecimal.multiply(cost,100+p));
  }else{
   if(typeof row.roi!=='number'||!Number.isFinite(row.roi))return 'UNKNOWN';
   roiCompare=p=>exactDecimal.compare(row.roi,p);
  }
 }catch{return 'UNKNOWN';}
 if(provider==='adsterra'&&(!/^\d+$/.test(String(row.id))||!Number.isSafeInteger(Number(row.id))||Number(row.id)<=0||
  ![row.clicks,row.impressions].every(v=>Number.isSafeInteger(v)&&v>=0)))return 'UNKNOWN';
 const safe=provider==='clickadu'?roiCompare(30)>=0
  :roiCompare(20)>=0||(roiCompare(10)>0&&row.impressions>0&&BigInt(row.clicks)*100n>BigInt(row.impressions)*8n);
 return safe?'SAFE':'BLACKLIST';
}
function listRowLabel(row,kind){
 const decision=listDecision(row);
 if(decision==='UNKNOWN')return 'Data belum tersedia';
 if(decision==='INSUFFICIENT')return 'Belum Cukup Spend';
 return kind==='WHITELIST'?(decision==='SAFE'?'Kandidat Whitelist':'Bukan Kandidat Whitelist')
  :decision==='BLACKLIST'?'Kandidat Blacklist':'Aman';
}
function listCandidates(rows,kind=selectedListKind()){
 if(!['BLACKLIST','WHITELIST'].includes(kind))return [];
 return rows.filter(row=>listDecision(row)===(kind==='WHITELIST'?'SAFE':'BLACKLIST')).map(row=>row.id);
}
