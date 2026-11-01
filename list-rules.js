'use strict';
// One raw-value decision shared by table, count, clipboard and application.
function listDecision(row,provider=state.provider){
 if(typeof row.cost!=='number'||!Number.isFinite(row.cost)||row.cost<0)return 'UNKNOWN';
 if(row.cost<1000)return 'INSUFFICIENT';
 if(typeof row.roi!=='number'||!Number.isFinite(row.roi))return 'UNKNOWN';
 if(provider==='adsterra'&&(!/^\d+$/.test(String(row.id))||!Number.isSafeInteger(Number(row.id))||Number(row.id)<=0||
  ![row.clicks,row.impressions].every(v=>Number.isSafeInteger(v)&&v>=0)))return 'UNKNOWN';
 const safe=provider==='clickadu'?row.roi>=30
  :row.roi>=20||(row.roi>10&&row.impressions>0&&row.clicks/row.impressions*100>8);
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
