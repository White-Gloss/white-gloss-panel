import {catalogQuote, packages, vehicleClasses, extras} from './catalog.mjs';

function assessmentNeed(ok,message){if(!ok)throw Object.assign(new Error(message),{status:400});}
function assessmentCents(value){assessmentNeed(Number.isSafeInteger(value)&&value>=0&&value<=100000000,'Jede Position benötigt einen ganzen, nicht negativen Centbetrag.');return value;}
export function normalizeAssessment(input){
  assessmentNeed(Array.isArray(input.lines)&&input.lines.length>0&&input.lines.length<=40,'Bitte 1 bis 40 Leistungspositionen angeben.');
  assessmentNeed(input.pricesReviewed===true,'Bitte alle Leistungen und Preise ausdrücklich prüfen.');
  const ids=new Set();let pickups=0;
  const lines=input.lines.map(line=>{
    assessmentNeed(line&&typeof line==='object','Leistungsposition ungültig.');
    const id=String(line.id??'');assessmentNeed(/^[a-zA-Z0-9_-]{1,80}$/.test(id)&&!ids.has(id),'Positionskennung fehlt oder ist doppelt.');ids.add(id);
    assessmentNeed(['package','extra','pickup','custom'].includes(line.kind),'Positionsart ungültig.');
    if(line.kind==='pickup')assessmentNeed(++pickups<=1,'Abholung darf nur einmal berechnet werden.');
    const title=String(line.title??'').trim();assessmentNeed(title.length>0&&title.length<=180,'Jede Leistung benötigt einen Namen mit höchstens 180 Zeichen.');
    const description=String(line.description??'').trim();assessmentNeed(description.length<=1000,'Leistungsbeschreibung ist zu lang.');
    const catalogId=String(line.catalogId??'');if(catalogId)assessmentNeed(line.kind==='package'?packages.some(p=>p.id===catalogId):line.kind==='extra'&&extras.some(e=>e.id===catalogId),'Katalogposition ist unbekannt.');return {id,kind:line.kind,...(catalogId?{catalogId}:{}),title,description,amountCents:assessmentCents(line.amountCents)};
  });
  const totalCents=assessmentCents(lines.reduce((sum,line)=>sum+line.amountCents,0));
  const pickupCents=lines.find(line=>line.kind==='pickup')?.amountCents??0;
  // The server calculates both totals; contradictory client values are rejected.
  for(const [key,value] of Object.entries({totalCents,pickupCents}))if(input[key]!==undefined)assessmentNeed(input[key]===value,'Positionssumme stimmt nicht mit dem Gesamtpreis überein.');
  return {condition:String(input.condition??'').trim().slice(0,2000),lines,totalCents,pickupCents,pricesReviewed:true,services:lines.map(line=>line.title+(line.description?' — '+line.description:'')).join('\n')};
}
export function assessmentSeed(source){
  const raw=source.raw??source;
  const packageId=source.packageId??raw.package_id??packages.find(p=>p.name===source.package)?.id;
  const classId=source.classId??raw.class_id??vehicleClasses.find(c=>c.label===source.vehicleClass)?.id;
  const extraIds=source.extraIds??raw.extra_ids??(source.extras??[]).map(name=>extras.find(e=>e.id===name||e.name===name)?.id).filter(Boolean);
  let quote=source.catalogQuote;
  if(!quote&&packageId&&classId)try{quote=catalogQuote({packageId,classId,extraIds,delivery:(source.pickupCents>0||source.delivery==='Abholung'||raw.pickup_requested===true)?'Abholung':'Kunde bringt',citySlug:source.citySlug??raw.city_slug,pickupKm:source.pickupKm??raw.pickup_distance_km,customPickupCents:source.pickupCents});}catch{/* Historical input remains visible even when today's catalogue cannot price it. */}
  const sourceTotal=assessmentCents(source.amountCents??0),pickup=assessmentCents(source.pickupCents??0);
  assessmentNeed(sourceTotal>=pickup,'Der ursprüngliche Gesamtpreis ist niedriger als die Abholung. Bitte Quelldaten prüfen.');
  const pickupPending=quote?.pickupOnRequest===true&&quote.pickupCents===null&&source.pickupCents==null;
  const matched=quote&&(pickupPending||quote.totalCents===sourceTotal&&quote.pickupCents===pickup);
  const lines=[{id:'package',kind:'package',...(packageId?{catalogId:packageId}:{}),title:quote?.packageName??source.package??'Fahrzeugaufbereitung',description:'',amountCents:matched?quote.packageCents:sourceTotal-pickup}];
  const requestedExtras=quote?.extras??(source.extras??[]).map((name,index)=>({id:String(index),name:extras.find(e=>e.id===name)?.name??String(name)}));
  for(const extra of requestedExtras)lines.push({id:'extra-'+extra.id,kind:'extra',...(extras.some(e=>e.id===extra.id)?{catalogId:extra.id}:{}),title:extra.name,description:'',amountCents:matched?extra.amountCents:0});
  if(pickup>0||source.delivery==='Abholung'||quote?.delivery==='Abholung')lines.push({id:'pickup',kind:'pickup',title:'Abholung und Rückbringung',description:source.address??'',amountCents:pickup,...(pickupPending?{pricePending:true}:{})});
  return {lines,condition:'',pricesReviewed:false,...(pickupPending?{pickupPricePending:true}:{}),reconciliationRequired:!matched&&requestedExtras.length>0};
}
