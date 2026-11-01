'use strict';
// Small finite-decimal arithmetic for money decisions. No rounded division,
// epsilon, dependency, or persistent state. Numbers are only used for display.
const exactDecimal=(()=>{
 function value(input){
  if(input&&typeof input==='object'&&typeof input.n==='bigint'&&Number.isInteger(input.scale)&&input.scale>=0)return input;
  if(!['string','number'].includes(typeof input)||typeof input==='number'&&!Number.isFinite(input))throw Error('Nilai desimal tidak valid.');
  const text=String(input).trim();
  const m=text.length<=1024&&text.match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d{1,4}))?$/i);
  if(!m)throw Error('Nilai desimal tidak valid.');
  const fraction=m[3]??m[4]??'',exponent=Number(m[5]||0);if(Math.abs(exponent)>1024)throw Error('Eksponen desimal di luar batas.');
  let n=BigInt((m[1]==='-'?'-':'')+(m[2]||'0')+fraction),scale=fraction.length-exponent;
  if(scale<0){n*=10n**BigInt(-scale);scale=0;}
  return normalized(n,scale);
 }
 function normalized(n,scale){
  if(n===0n)return {n:0n,scale:0};
  while(scale>0&&n%10n===0n){n/=10n;scale--;}
  return {n,scale};
 }
 function text(input){
  const {n,scale}=value(input),negative=n<0n,raw=(negative?-n:n).toString().padStart(scale+1,'0');
  return (negative?'-':'')+(scale?raw.slice(0,-scale)+'.'+raw.slice(-scale):raw);
 }
 function aligned(a,b){
  a=value(a);b=value(b);const scale=Math.max(a.scale,b.scale);
  return [a.n*10n**BigInt(scale-a.scale),b.n*10n**BigInt(scale-b.scale),scale];
 }
 function add(a,b){const [left,right,scale]=aligned(a,b);return normalized(left+right,scale);}
 function multiply(a,b){a=value(a);b=value(b);return normalized(a.n*b.n,a.scale+b.scale);}
 function compare(a,b){const [left,right]=aligned(a,b);return left<right?-1:left>right?1:0;}
 return {value,text,add,multiply,compare};
})();
