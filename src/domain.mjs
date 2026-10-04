import {normalizeAssessment} from './assessment.mjs';
export const STATES = ['Preise prüfen','Angebot offen','Angenommen','Termin verbindlich','In Arbeit','Erledigt','Bezahlt','Abgelehnt','Storniert','Abgelaufen'];
export class AppError extends Error { constructor(message, status=400) { super(message); this.status=status; } }
export function need(value, message, status=400) { if (!value) throw new AppError(message,status); }
export function cents(value) { need(Number.isSafeInteger(value) && value>=0 && value<=100000000,'Preis muss ein ganzer, nicht negativer Centbetrag sein.'); return value; }
export function text(value,max=2000) { return String(value??'').trim().slice(0,max); }
export function berlin(iso) { return new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',dateStyle:'medium',timeStyle:'short'}).format(new Date(iso)); }
export function berlinISO(local) {
  need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local),'Datum und Uhrzeit fehlen.');
  const base=Date.parse(local+'Z'); const matches=[];
  const fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  for(const offset of [60,120]) { const d=new Date(base-offset*60000); if(!Number.isNaN(+d)&&fmt.format(d).replace(' ','T')===local) matches.push(d.toISOString()); }
  need(matches.length===1,matches.length?'Diese Uhrzeit ist bei der Zeitumstellung doppeldeutig. Bitte eine andere Uhrzeit wählen.':'Diese Uhrzeit gibt es in Europe/Berlin nicht.');
  return matches[0];
}
export function normalizeSource(row) {
  need(row&&typeof row==='object','Ungültige Website-Anfrage.');
  const id=text(row.id??row.booking_id,150); need(id,'Website-ID fehlt.');
  // Aliases remain bounded. The raw original is retained separately for inspection.
  const get=(...keys)=>keys.map(k=>row[k]).find(v=>v!==undefined&&v!==null);
  return {id,name:text(get('name','customer_name'),180),phone:text(get('phone','telefon'),80),email:text(get('email'),180),vehicle:text(get('vehicle','car','fahrzeug'),180),package:text(get('package','package_name','paket','package_id'),180),vehicleClass:text(get('vehicleClass','vehicle_class','car_class','class_id'),80),extras:get('extras','extra_ids')??[],city:text(get('city','location','ort','city_slug'),180),note:text(get('note','message','hinweis')),amountCents:cents(get('amountCents','amount_cents','total_cents')??0),pickupCents:cents(get('pickupCents','pickup_cents','pickup_cost_cents')??0),desiredDate:text(get('desiredDate','preferred_date','date'),80),timeWindow:text(get('timeWindow','time_window','slot','preferred_slot'),100),address:text(get('address','pickup_address'),600),reviewConsent:get('reviewConsent','review_consent','review_email_consent')===true,createdAt:text(get('createdAt','created_at'),80),raw:row};
}
export function protocolValid(p,kind,assetIds) {
  need(p&&typeof p==='object','Protokoll fehlt.');
  for(const k of ['plate','at','location','condition','customerName','operatorName']) need(text(p[k]),'Pflichtangabe im Protokoll fehlt: '+k);
  p.at=berlinISO(p.at);
  need(Number.isSafeInteger(p.mileage)&&p.mileage>=0,'Kilometerstand ungültig.');
  need(Number.isSafeInteger(p.keys)&&p.keys>=0&&p.keys<=20,'Schlüsselanzahl ungültig.');
  need(['Abholung','Kunde bringt'].includes(p.delivery),'Übergabeart fehlt.');
  need(Array.isArray(p.photos)&&p.photos.length>=1,'Mindestens ein Zustandsfoto ist erforderlich.');
  for(const id of [...p.photos,p.customerSignature,p.operatorSignature]) need(assetIds.has(id),'Foto oder Unterschrift fehlt oder gehört nicht zu diesem Auftrag.');
  need(p.customerSignature!==p.operatorSignature,'Zwei getrennte Unterschriften sind erforderlich.');
  need(p.signaturesConfirmed===true,'Beide Personen müssen das angezeigte Protokoll unterschreiben.');
  if(kind==='return') { need(p.workComplete===true,'Arbeitsabschluss muss ausdrücklich bestätigt sein.'); need(text(p.services),'Ausgeführte Leistungen fehlen.'); }
  return p;
}
export function normalizeAppointmentOptions(options,now=new Date().toISOString()) {
  need(Array.isArray(options)&&options.length>=1&&options.length<=3,'Bitte einen bis drei Terminvorschläge angeben.');
  const starts=new Set();
  return options.map(input=>{
    need(input&&typeof input==='object'&&!Array.isArray(input),'Terminvorschlag ist ungültig.');
    need(Number.isInteger(input.duration)&&input.duration>=15&&input.duration<=1440,'Dauer: 15 bis 1440 Minuten.');
    need(['Abholung','Kunde bringt'].includes(input.delivery),'Übergabeart fehlt.');
    need(typeof input.location==='string'&&input.location.trim().length>0&&input.location.trim().length<=600,'Bitte einen Übergabeort mit höchstens 600 Zeichen angeben.');
    const start=berlinISO(input.start);need(Date.parse(start)>Date.parse(now),'Terminvorschläge müssen in der Zukunft liegen.');
    need(!starts.has(start),'Jeder Terminvorschlag braucht eine andere Startzeit.');starts.add(start);
    return {id:crypto.randomUUID(),start,end:new Date(Date.parse(start)+input.duration*60000).toISOString(),duration:input.duration,delivery:input.delivery,location:input.location.trim()};
  });
}
export function validateAppointmentDelivery(offer,options){
  need(!(offer?.pickupCents>0&&options.some(option=>option.delivery==='Kunde bringt')),'Der Festpreis enthält Abholkosten. Bitte nur Abholung anbieten oder die Abholkosten vor der Preisfreigabe auf null setzen.',409);
}
export function customerSignaturePNG(value){
  const message='Persönliche Unterschrift muss ein vollständiges PNG-Bild sein.';
  need(typeof value==='string'&&value.startsWith('data:image/png;base64,')&&value.length<250000,message);
  const encoded=value.slice(22);need(encoded.length>=64&&encoded.length%4===0&&/^[A-Za-z0-9+/]+={0,2}$/.test(encoded),message);
  let bytes;try{bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));}catch{throw new AppError(message);}
  need(bytes.length>50&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b),message);
  const view=new DataView(bytes.buffer),idat=[];let offset=8,width=0,height=0,channels=0,ended=false,closedIDAT=false,chunks=0;
  while(offset<bytes.length){
    need(++chunks<=100&&offset+12<=bytes.length,message);const length=view.getUint32(offset),end=offset+12+length;
    need(end<=bytes.length,message);const type=String.fromCharCode(...bytes.slice(offset+4,offset+8));need(/^[A-Za-z]{4}$/.test(type),message);
    let crc=0xffffffff;for(let i=offset+4;i<offset+8+length;i++){crc^=bytes[i];for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    need(((crc^0xffffffff)>>>0)===view.getUint32(offset+8+length),message);
    if(offset===8){
      need(type==='IHDR'&&length===13,message);width=view.getUint32(offset+8);height=view.getUint32(offset+12);channels=({0:1,2:3,4:2,6:4})[bytes[offset+17]];
      need(width>=32&&height>=16&&width<=4096&&height<=4096&&width*height<=4000000&&bytes[offset+16]===8&&channels&&bytes[offset+18]===0&&bytes[offset+19]===0&&bytes[offset+20]===0,message);
    }else if(type==='IDAT'){need(!closedIDAT&&length>0,message);idat.push(bytes.slice(offset+8,offset+8+length));}
    else if(type==='IEND'){need(length===0&&idat.length>0&&end===bytes.length,message);ended=true;}
    else{need(type!=='IHDR'&&!/^[A-Z]/.test(type)||type==='PLTE',message);if(type==='PLTE')need(!idat.length&&length>0&&length%3===0&&length<=768,message);if(idat.length)closedIDAT=true;}
    offset=end;
  }
  need(ended&&width&&height&&idat.length,message);return {bytes,width,height,channels,idat};
}
export function transition(order,action,input,now=new Date().toISOString(),role='owner') {
  const o=structuredClone(order); const status=o.status;
  if(action==='price') { need(status==='Preise prüfen','Der Preis ist bereits festgeschrieben.',409); if(input.lines){try{o.assessment=normalizeAssessment(input);}catch(error){throw new AppError(error.message,400);}}else{need(text(input.services),'Leistungen fehlen.');const totalCents=cents(input.totalCents),pickupCents=cents(input.pickupCents??0);need(totalCents>=pickupCents,'Gesamtfestpreis darf nicht niedriger als die Abholung sein.');o.assessment={condition:text(input.condition),services:text(input.services),totalCents,pickupCents};} }
  else if(action==='confirm') { need(status==='Preise prüfen'&&o.assessment,'Zuerst Begutachtung und Preis speichern.',409);validateAppointmentDelivery(o.assessment,o.appointmentOptions??[]); o.offer={...structuredClone(o.assessment),createdAt:now,expiresAt:new Date(Date.parse(now)+14*86400000).toISOString(),requiresAppointmentSelection:true}; o.status='Angebot offen'; }
  else if(action==='appointmentOptions') { need(role==='owner','Terminvorschläge sind dem Betreiber vorbehalten.',403);need(['Preise prüfen','Angebot offen'].includes(status)&&!o.acceptance,'Terminvorschläge sind nur vor der Kundenunterschrift möglich.',409);o.appointmentOptions=normalizeAppointmentOptions(input.options,now);validateAppointmentDelivery(o.offer??o.assessment,o.appointmentOptions);o.appointmentOptionsVersion=(o.appointmentOptionsVersion??0)+1; }
  else if(action==='accept') {
    need(role==='customer','Annahme ist ausschließlich dem Kunden vorbehalten.',403);
    if(o.acceptance?.appointmentOptionId){need(o.acceptance.snapshotHash===input.snapshotHash&&o.acceptance.appointmentOptionId===input.appointmentOptionId,'Dieser Auftrag wurde bereits mit einer anderen Vereinbarung unterschrieben.',409);return o;}
    if(status==='Angenommen')return o;
    need(status==='Angebot offen'&&Date.parse(o.offer.expiresAt)>Date.parse(now),'Angebot geschlossen oder abgelaufen.',409);
    need(input.signature&&input.snapshotHash&&input.paymentObligation===true,'Eigene Unterschrift und zahlungspflichtige Annahme sind erforderlich.');
    const options=o.appointmentOptions??[];
    need(!o.offer.requiresAppointmentSelection||options.length>0,'White Gloss muss vor der gemeinsamen Unterschrift noch Terminvorschläge hinterlegen.',409);
    if(options.length){
      validateAppointmentDelivery(o.offer,options);
      const option=options.find(item=>item.id===input.appointmentOptionId);need(option,'Bitte einen der angezeigten Terminvorschläge auswählen.',409);need(Date.parse(option.start)>Date.parse(now),'Dieser Terminvorschlag liegt nicht mehr in der Zukunft. Bitte neue Termine anfragen.',409);
      o.appointment=structuredClone(option);
      o.acceptance={signature:input.signature,snapshotHash:input.snapshotHash,paymentObligation:true,at:now,appointmentOptionId:option.id,appointmentOptionsVersion:o.appointmentOptionsVersion,snapshot:{offer:structuredClone(o.offer),appointment:structuredClone(option),appointmentOptionsVersion:o.appointmentOptionsVersion}};
      o.status='Termin verbindlich';
    }else{o.acceptance={signature:input.signature,snapshotHash:input.snapshotHash,at:now};o.status='Angenommen';}
  }
  else if(action==='appointment') { need(!o.acceptance?.appointmentOptionId,'Der gemeinsam unterschriebene Termin bleibt verbindlich. Änderungen müssen erneut mit dem Kunden vereinbart werden.',409);need(['Angenommen','Termin verbindlich'].includes(status),'Ein verbindlicher Termin setzt die Kundenannahme voraus.',409); need(['Abholung','Kunde bringt'].includes(input.delivery),'Übergabeart fehlt.'); need(Number.isInteger(input.duration)&&input.duration>=15&&input.duration<=1440,'Dauer: 15 bis 1440 Minuten.'); const start=berlinISO(input.start); need(Date.parse(start)>Date.parse(now),'Termin muss in der Zukunft liegen.'); o.appointment={start,end:new Date(Date.parse(start)+input.duration*60000).toISOString(),duration:input.duration,delivery:input.delivery,location:text(input.location,600)}; o.status='Termin verbindlich'; }
  else if(action==='intake') { need(status==='Termin verbindlich','Zuerst einen verbindlichen Termin speichern.',409); need(!o.intake,'Bestätigtes Annahmeprotokoll bleibt erhalten.',409); o.intake=input; o.status='In Arbeit'; }
  else if(action==='return') { need(status==='In Arbeit'&&o.intake,'Vollständige Fahrzeugannahme erforderlich.',409); need(!o.return,'Bestätigtes Rückgabeprotokoll bleibt erhalten.',409); o.return=input; o.completedAt=now; o.status='Erledigt'; }
  else if(action==='payment') { need(['Erledigt','Bezahlt'].includes(status),'Zahlungserfassung erst nach Abschluss.',409); const amount=cents(input.amountCents); need(amount>0,'Zahlungsbetrag muss positiv sein.'); need(text(input.at)&&!Number.isNaN(Date.parse(input.at))&&Date.parse(input.at)<=Date.parse(now),'Zahlungszeitpunkt ungültig.'); need(['Überweisung','Karte','Bar'].includes(input.method),'Zahlungsart fehlt.'); need(input.method==='Bar'?input.cashConfirmed===true:input.receipt,'Zahlungsbeleg oder ausdrückliche Bargeldbestätigung fehlt.'); o.payments=[...(o.payments??[]),{...input,amountCents:amount}]; const paid=o.payments.reduce((n,p)=>n+p.amountCents,0); need(paid<=o.offer.totalCents,'Zahlung überschreitet den vereinbarten Festpreis.'); if(paid===o.offer.totalCents)o.status='Bezahlt'; }
  else if(action==='reject') { need(status==='Preise prüfen','Ablehnung nur vor Preisfreigabe.',409); need(text(input.reason),'Grund fehlt.'); o.status='Abgelehnt'; o.closeReason=text(input.reason); }
  else if(action==='cancel') { need(['Preise prüfen','Angebot offen','Angenommen','Termin verbindlich'].includes(status),'Auftrag kann in diesem Status nicht storniert werden.',409); need(text(input.reason),'Grund fehlt.'); o.status='Storniert';o.closeReason=text(input.reason); }
  else if(action==='expire') { need(status==='Angebot offen'&&Date.parse(o.offer.expiresAt)<=Date.parse(now),'Angebot ist noch nicht abgelaufen.',409); o.status='Abgelaufen'; }
  else if(action==='note') { need(text(input.note),'Notiz fehlt.'); o.notes=[...(o.notes??[]),{at:now,note:text(input.note),kind:text(input.kind,60)||'Notiz',followUp:text(input.followUp,40)}]; }
  else throw new AppError('Unbekannter Arbeitsschritt.');
  o.updatedAt=now;return o;
}
export function dueJobs(o,now=Date.now()) {
  if(o.synthetic)return [];
  const out=[];const start=Date.parse(o.appointment?.start);
  if(o.status==='Termin verbindlich'&&start>now&&start-now<=72*3600000)out.push('reminder');
  if(['Erledigt','Bezahlt'].includes(o.status)&&o.source.reviewConsent&&now-Date.parse(o.completedAt)>=168*3600000)out.push('review');
  return out;
}
export function nextStep(o) {
  return ({'Preise prüfen':'Fahrzeugzustand und Preise prüfen','Angebot offen':'Auf persönliche Kundenannahme warten','Angenommen':'Verbindlichen Termin festlegen','Termin verbindlich':'Fahrzeugannahme vollständig dokumentieren','In Arbeit':'Arbeit abschließen und Rückgabe dokumentieren','Erledigt':'Schlussrechnung erstellen und Zahlung erfassen','Bezahlt':'Auftrag abgeschlossen'})[o.status]??'Auftrag geschlossen';
}
