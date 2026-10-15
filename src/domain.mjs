import {normalizeAssessment} from './assessment.mjs';
import {immediateStartNotice,priceNote} from './catalog.mjs';
export const STATES = ['Preise prüfen','Angebot offen','Angenommen','Termin verbindlich','In Arbeit','Erledigt','Bezahlt','Abgelehnt','Storniert','Abgelaufen'];
const BEFORE_ACCEPT=['Preise prüfen','Angebot offen','Abgelaufen'],BEFORE_WORK=[...BEFORE_ACCEPT,'Angenommen','Termin verbindlich'];
export const CLOSED_STATES=['Abgelehnt','Storniert','Abgelaufen'];
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
// Accepts the Berlin form value as well as an already stored ISO time; empty stays empty.
export function optionalTime(value) { const raw=text(value,40); if(!raw) return null; if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return berlinISO(raw); need(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(raw)&&Number.isFinite(Date.parse(raw)),'Datum und Uhrzeit sind ungültig.'); return new Date(raw).toISOString(); }
export function normalizeSource(row) {
  need(row&&typeof row==='object','Ungültige Website-Anfrage.');
  const id=text(row.id??row.booking_id,150); need(id,'Website-ID fehlt.');
  // Aliases remain bounded. The raw original is retained separately for inspection.
  const get=(...keys)=>keys.map(k=>row[k]).find(v=>v!==undefined&&v!==null);
  return {id,name:text(get('name','customer_name'),180),phone:text(get('phone','telefon'),80),email:text(get('email'),180),vehicle:text(get('vehicle','car','fahrzeug'),180),package:text(get('package','package_name','paket','package_id'),180),vehicleClass:text(get('vehicleClass','vehicle_class','car_class','class_id'),80),extras:get('extras','extra_ids')??[],city:text(get('city','location','ort','city_slug'),180),note:text(get('note','message','hinweis')),amountCents:cents(get('amountCents','amount_cents','total_cents')??0),pickupCents:cents(get('pickupCents','pickup_cents','pickup_cost_cents')??0),desiredDate:text(get('desiredDate','preferred_date','date'),80),timeWindow:text(get('timeWindow','time_window','slot','preferred_slot'),100),address:text(get('address','pickup_address'),600),reviewConsent:get('reviewConsent','review_consent','review_email_consent')===true,createdAt:text(get('createdAt','created_at'),80),raw:row};
}
const field=(value,max,label)=>{if(value===undefined||value===null)return '';need(['string','number'].includes(typeof value),'Protokollangabe ist ungültig: '+label);const result=String(value).trim();need(result.length<=max,'Protokollangabe ist zu lang: '+label);return result;};
const count=(value,min,max,label)=>{if(value===undefined||value===null||value==='')return null;const number=typeof value==='string'?Number(value.replace(',','.')):value;need(Number.isSafeInteger(number)&&number>>0===number&&number>=min&&number<=max,label+' ist ungültig.');return number;};
export const isSigned=p=>Boolean(p&&p.customerSignature);
// An offer counts as signed only with a customer signature; an unsigned acceptance stays editable.
export const offerSigned=o=>Boolean(o?.acceptance?.signature);
export const offerAccepted=o=>Boolean(o.acceptance)&&['Angenommen','Termin verbindlich','In Arbeit','Erledigt','Bezahlt'].includes(o.status);
// Wiederholte Online-Annahme gilt nur als erledigt, wenn bereits eine Online-Unterschrift des Kunden gespeichert ist.
// Ältere Online-Annahmen haben noch kein mode-Feld; sie gelten wie bisher als online.
export const customerSignedOnline=o=>offerAccepted(o)&&Boolean(o.acceptance.signature)&&(o.acceptance.mode==='online'||!o.acceptance.mode);
export const PROTOCOL_CHECKS=['valuablesRemoved','warningLights','damageKnown','waterAvailable','powerAvailable'];
// Every protocol field is optional. Values are bounded and every referenced file must belong to this order.
export function protocolValid(p,kind,assetIds) {
  need(p&&typeof p==='object'&&!Array.isArray(p),'Protokoll fehlt.');
  const own=id=>{need(typeof id==='string'&&assetIds.has(id),'Foto oder Unterschrift gehört nicht zu diesem Auftrag.');return id;};
  const out={};for(const key of ['business','wg','customer','vehicle','snapshotHash','customerSnapshotHash','replaces','signedAt','operatorSignedAt'])if(p[key]!==undefined&&p[key]!==null)out[key]=p[key];
  if(p.customerAbsent===true)out.customerAbsent=true;
  for(const [key,max] of Object.entries({plate:80,location:600,condition:4000,notes:4000,customerName:180,operatorName:180,services:6000,openPoints:4000,checklistNote:1000}))out[key]=field(p[key],max,key);
  out.at=optionalTime(p.at);
  out.mileage=count(p.mileage,0,9999999,'Kilometerstand');out.keys=count(p.keys,0,20,'Schlüsselanzahl');out.fuel=count(p.fuel,0,100,'Tank- bzw. Ladestand');
  out.soilingInside=count(p.soilingInside,1,4,'Verschmutzungsgrad innen');out.soilingOutside=count(p.soilingOutside,1,4,'Verschmutzungsgrad außen');
  out.delivery=field(p.delivery,40,'Übergabeart');need(['','Abholung','Kunde bringt'].includes(out.delivery),'Übergabeart ist ungültig.');
  const checks=p.checklist&&typeof p.checklist==='object'?p.checklist:{};out.checklist=Object.fromEntries(PROTOCOL_CHECKS.map(key=>[key,checks[key]===true]));
  const photos=p.photos??[];need(Array.isArray(photos)&&photos.length<=40,'Höchstens 40 Zustandsfotos pro Protokoll.');out.photos=[...new Set(photos.map(own))];
  if(p.photoPreviews!==undefined&&p.photoPreviews!==null){need(typeof p.photoPreviews==='object'&&!Array.isArray(p.photoPreviews),'Foto-Vorschauen sind ungültig.');out.photoPreviews={};for(const [original,preview] of Object.entries(p.photoPreviews)){need(out.photos.includes(original),'PDF-Vorschau gehört nicht zu diesem Protokoll.');out.photoPreviews[original]=own(preview);}}
  const damages=p.damages??[];need(Array.isArray(damages)&&damages.length<=60,'Höchstens 60 Schäden pro Protokoll.');
  out.damages=damages.map(d=>{need(d&&typeof d==='object','Schadensangabe ist ungültig.');return {area:field(d.area,80,'Schadensposition'),kind:field(d.kind,80,'Schadensart'),size:field(d.size,60,'Schadensgröße'),note:field(d.note,1000,'Schadensbeschreibung'),photo:d.photo?own(d.photo):''};}).filter(d=>d.area||d.kind||d.size||d.note||d.photo);
  const paint=p.paint&&typeof p.paint==='object'?p.paint:{};const readings=paint.readings??[];need(Array.isArray(readings)&&readings.length<=40,'Höchstens 40 Lackmesspunkte.');
  out.paint={device:field(paint.device,120,'Messgerät'),notes:field(paint.notes,2000,'Lackhinweise'),readings:readings.map(r=>{need(r&&typeof r==='object','Lackmessung ist ungültig.');const values=r.values??[];need(Array.isArray(values)&&values.length<=5,'Höchstens 5 Messwerte pro Bauteil.');return {panel:field(r.panel,80,'Bauteil'),values:values.map(v=>count(v,0,5000,'Lackschichtdicke')).filter(v=>v!==null)};}).filter(r=>r.panel||r.values.length)};
  for(const key of ['customerSignature','operatorSignature'])out[key]=p[key]?own(p[key]):null;
  need(!out.customerSignature||out.customerSignature!==out.operatorSignature,'Zwei getrennte Unterschriften sind erforderlich.');
  out.signaturesConfirmed=p.signaturesConfirmed===true;
  if(kind==='return')out.workComplete=p.workComplete===true;
  return out;
}
export function paintSummary(values){if(!values?.length)return null;const min=Math.min(...values),max=Math.max(...values);return {min,max,average:Math.round(values.reduce((a,b)=>a+b,0)/values.length)};}
export function paidCents(o){return (o.payments??[]).filter(p=>!p.cancelledAt).reduce((sum,p)=>sum+p.amountCents,0);}
export function billedTotalCents(o){const invoice=o.invoice;if(invoice&&!['canceled','cancelled','void','voided'].includes(invoice.status)&&Number.isSafeInteger(invoice.totalCents)&&invoice.totalCents>=0)return invoice.totalCents;if(Number.isSafeInteger(o.invoiceDraft?.totalCents)&&o.invoiceDraft.totalCents>=0)return o.invoiceDraft.totalCents;return o.offer?.totalCents;}
function settle(o){const total=billedTotalCents(o),paid=paidCents(o),open=(o.payments??[]).some(p=>!p.cancelledAt);if(o.status==='Erledigt'&&open&&Number.isSafeInteger(total)&&paid>=total)o.status='Bezahlt';else if(o.status==='Bezahlt'&&!o.paidManually&&!(open&&Number.isSafeInteger(total)&&paid>=total))o.status='Erledigt';}
const history=(o,key,entry)=>{o[key]=[...(o[key]??[]),entry];};
// Consent texts the customer actually saw are stored with the acceptance as evidence.
const consents=input=>({paymentObligation:input.paymentObligation===true,immediateStart:input.immediateStart===true,immediateStartText:input.immediateStart===true?immediateStartNotice:'',withdrawalNotice:input.withdrawalNotice===true,withdrawalText:text(input.withdrawalText,8000)});
const acceptanceSnapshot=(order,offer,acceptance)=>({...acceptance,confirmationId:crypto.randomUUID(),snapshot:{source:structuredClone(order.source),offer:structuredClone(offer),priceNote}});
const emptyAssessment=()=>({condition:'',lines:[],totalCents:0,pickupCents:0,services:'',pricesReviewed:false});
const SOURCE_FIELDS={name:180,phone:80,email:180,vehicle:180,plate:80,address:600,city:180,note:2000,desiredDate:80,timeWindow:100,company:180};
function applyDocument(o,kind,content,acceptance,now){
  if(kind==='offer'){if(o.offer||o.acceptance)history(o,'offerHistory',{offer:o.offer??null,acceptance:o.acceptance??null,replacedAt:now});o.acceptance=acceptanceSnapshot(o,content,acceptance);o.offer=content;return;}
  if(o[kind])history(o,kind+'History',{...o[kind],replacedAt:now});o[kind]=content;
}
export const documentBaseSnapshot=(o,kind)=>JSON.stringify(kind==='offer'?{offer:o.offer??null,acceptance:o.acceptance??null}:{document:o[kind]??null});
export function assertPendingDocument(o,kind){need(['offer','intake','return'].includes(kind),'Unbekanntes Dokument.');const pending=o.pending?.[kind];need(pending,'Kein offenes Dokument zur Unterschrift.',404);need(!pending.baseSnapshot||pending.baseSnapshot===documentBaseSnapshot(o,kind),'Das Ausgangsdokument wurde verändert. Bitte einen neuen Entwurf zur Unterschrift erstellen.',409);return pending;}
function clearPendingDocument(o,kind,now){if(!o.pending?.[kind])return;history(o,'pendingHistory',{kind,...o.pending[kind],discardedAt:now});const {[kind]:_removed,...rest}=o.pending;o.pending=rest;}
// Freigabe ohne Kundenunterschrift: nur durch den Betreiber, mit Grund, dauerhaft protokolliert.
function ownerRelease(input,now,what){need(input.release===true,what+' braucht die Unterschrift des Kunden – oder deine ausdrückliche Freigabe ohne Unterschrift.',409);const reason=text(input.releaseReason,300);need(reason.length>=3,'Bitte einen Grund für die Freigabe ohne Unterschrift angeben.');return {by:'owner',at:now,reason};}
// Ein Termin ist verbindlich, sobald der Kunde ihn bestätigt (Unterschrift) oder der Betreiber ihn freigibt.
export const appointmentConfirmed=o=>Boolean(o.appointment?.confirmation);
const workAuthorized=o=>Boolean(o.acceptance)&&(appointmentConfirmed(o)||(o.status==='Termin verbindlich'&&Boolean(o.appointment)));
const sameAppointment=(a,b)=>Boolean(a&&b)&&a.start===b.start&&a.duration===b.duration&&a.delivery===b.delivery&&a.location===b.location;
export function appointmentSnapshot(o){const a=o.appointment;return a?{wg:o.wg,start:a.start,end:a.end,duration:a.duration,delivery:a.delivery,location:a.location??''}:null;}
// One explicit consent signs the displayed offer and appointment together. Keep the
// appointment evidence in the acceptance when a later reschedule needs a new signature.
function confirmOfferAppointment(o,input,now){
  if(input.confirmAppointment!==true)return;
  need(o.appointment,'Es gibt keinen Termin zum gemeinsamen Bestätigen.',409);
  need(!['Abgelehnt','Storniert','Abgelaufen','In Arbeit','Erledigt','Bezahlt'].includes(o.status),'Der Termin kann in diesem Auftragsstand nicht mehr bestätigt werden.',409);
  const a=o.acceptance;need(a?.signature||a?.release,'Eine persönliche Unterschrift oder ausdrückliche Betreiberfreigabe ist erforderlich.',409);
  a.snapshot.appointment=appointmentSnapshot(o);
  if(!appointmentConfirmed(o))o.appointment.confirmation={mode:a.mode,at:now,signature:a.signature??null,snapshotHash:a.snapshotHash??null,customerName:a.customerName??'',acceptanceId:a.confirmationId,...(a.release?{release:structuredClone(a.release)}:{})};
}
export function transition(order,action,input,now=new Date().toISOString(),role='owner') {
  const o=structuredClone(order); const status=o.status; input=input??{};
  // Freeze legacy accepted data before the first edit can change its document.
  if(o.acceptance&&!o.acceptance.snapshot)o.acceptance.snapshot={source:structuredClone(o.source),offer:structuredClone(o.offer),priceNote};
  if(action==='price') {
    if(input.lines!==undefined){try{o.assessment=normalizeAssessment(input);}catch(error){throw new AppError(error.message,400);}}
    else{const totalCents=cents(input.totalCents??0),pickupCents=cents(input.pickupCents??0);need(totalCents>=pickupCents,'Gesamtfestpreis darf nicht niedriger als die Abholung sein.');o.assessment={condition:text(input.condition),services:text(input.services),totalCents,pickupCents};}
    // An unsigned offer follows the edited prices; a signed offer stays and needs a signed replacement.
    if(o.offer&&!offerSigned(o)){history(o,'offerHistory',{offer:o.offer,acceptance:o.acceptance??null,replacedAt:now});o.offer={...structuredClone(o.assessment),createdAt:o.offer.createdAt,expiresAt:o.offer.expiresAt,editedAt:now};}
  }
  else if(action==='confirm') { need(['Preise prüfen','Abgelaufen'].includes(status)&&!o.acceptance,'Das Angebot ist bereits freigegeben.',409); if(o.offer)history(o,'offerHistory',{offer:o.offer,acceptance:null,replacedAt:now}); o.offer={...structuredClone(o.assessment??emptyAssessment()),createdAt:now,expiresAt:new Date(Date.parse(now)+14*86400000).toISOString()}; o.status='Angebot offen'; }
  else if(action==='accept') { need(role==='customer','Annahme ist ausschließlich dem Kunden vorbehalten.',403); if(customerSignedOnline(o)) return o; need(status==='Angebot offen'&&!o.acceptance&&Date.parse(o.offer.expiresAt)>Date.parse(now),'Angebot geschlossen oder abgelaufen.',409); need(input.signature&&input.snapshotHash&&input.paymentObligation===true,'Eigene Unterschrift und zahlungspflichtige Annahme sind erforderlich.'); o.acceptance=acceptanceSnapshot(o,o.offer,{signature:input.signature,snapshotHash:input.snapshotHash,at:now,mode:'online',...consents(input)});confirmOfferAppointment(o,input,now); o.status=appointmentConfirmed(o)?'Termin verbindlich':'Angenommen'; }
  else if(action==='onsiteAccept') {
    // The customer signs in person on the operator's device. A signed offer is only replaced by a new signature.
    const signature=text(input.signature,100)||null;
    const release=signature?null:ownerRelease(input,now,'Die Annahme des Angebots');
    const signed=offerSigned(o);need(!signed||signature,'Ein unterschriebenes Angebot bleibt erhalten. Für Änderungen unterschreibt der Kunde ein Ersatzangebot.',409);
    const base=signed?(o.assessment??emptyAssessment()):(o.offer??o.assessment??emptyAssessment());const previous=signed?{at:o.acceptance.at,signedAt:o.acceptance.at,offerCreatedAt:o.offer?.createdAt??null,snapshotHash:o.acceptance.snapshotHash??null}:null;
    const offer={...structuredClone(base),createdAt:signed||!o.offer?now:o.offer.createdAt,expiresAt:signed||!o.offer?now:o.offer.expiresAt,...(previous?{replaces:previous}:{})};
    applyDocument(o,'offer',offer,{mode:release?'ohne Unterschrift freigegeben':'vor Ort',at:now,signature,customerName:text(input.customerName,180),...consents(input),snapshotHash:text(input.snapshotHash,128)||null,...(release?{release}:{}),...(previous?{replaces:previous}:{})},now);
    confirmOfferAppointment(o,input,now);
    if(BEFORE_ACCEPT.includes(status)||status==='Angenommen')o.status=appointmentConfirmed(o)?'Termin verbindlich':'Angenommen';
  }
  else if(action==='appointment') {
    const workStarted=['In Arbeit','Erledigt','Bezahlt'].includes(status);
    if(!text(input.start)){need(!workStarted||!o.appointment,'Nach Arbeitsbeginn bleibt der bestätigte Termin unverändert.',409);if(o.appointment)history(o,'appointmentHistory',{...o.appointment,replacedAt:now});o.appointment=null;if(status==='Termin verbindlich'){history(o,'statusHistory',{from:status,to:'Angenommen',at:now,reason:'Termin entfernt'});o.status='Angenommen';}}
    else{const duration=input.duration===undefined||input.duration===null||input.duration===''?120:input.duration;need(Number.isInteger(duration)&&duration>=15&&duration<=4320,'Dauer: 15 Minuten bis 3 Tage.');const delivery=text(input.delivery,40)||'Kunde bringt';need(['Abholung','Kunde bringt'].includes(delivery),'Übergabeart ist ungültig.');const start=optionalTime(input.start),previous=o.appointment;o.appointment={start,end:new Date(Date.parse(start)+duration*60000).toISOString(),duration,delivery,location:text(input.location,600)};
      if(workStarted&&!sameAppointment(previous,o.appointment))need(input.release===true,'Der Auftrag läuft bereits. Den Termin bitte nur mit Freigabe und Grund ändern.',409);
      // Ein unveränderter Termin behält seine Bestätigung; jede Änderung braucht eine neue.
      if(sameAppointment(previous,o.appointment)&&previous.confirmation)o.appointment.confirmation=previous.confirmation;
      // Termine, die schon vor Einführung der Kundenbestätigung verbindlich waren, bleiben es beim unveränderten Speichern.
      else if(sameAppointment(previous,o.appointment)&&status==='Termin verbindlich')o.appointment.confirmation={mode:'bereits verbindlich (vor Einführung der Bestätigung)',at:now,legacy:true};
      else if(previous?.confirmation)history(o,'appointmentHistory',{...previous,replacedAt:now});
      // Eine Freigabe ersetzt nie eine bestehende (unterschriebene) Bestätigung eines unveränderten Termins.
      if(input.release===true&&!o.appointment.confirmation)o.appointment.confirmation={mode:'ohne Unterschrift freigegeben',at:now,release:ownerRelease(input,now,'Der Termin')};
      if(status==='Angenommen'&&appointmentConfirmed(o))o.status='Termin verbindlich';
      if(status==='Termin verbindlich'&&!appointmentConfirmed(o)){history(o,'statusHistory',{from:status,to:'Angenommen',at:now,reason:'Termin geändert – neue Bestätigung des Kunden nötig'});o.status='Angenommen';}}
  }
  else if(action==='confirmAppointment') {
    need(o.appointment,'Es gibt keinen Termin zum Bestätigen.',409);need(!['Abgelehnt','Storniert','Abgelaufen','In Arbeit','Erledigt','Bezahlt'].includes(status),'Der Termin kann in diesem Auftragsstand nicht mehr bestätigt werden.',409);
    if(appointmentConfirmed(o))return o;
    const signature=text(input.signature,100);
    if(role==='customer'){need(signature&&input.confirmed===true&&input.snapshotHash,'Bitte den angezeigten Termin bestätigen und unterschreiben.');o.appointment.confirmation={mode:'online',at:now,signature,snapshotHash:text(input.snapshotHash,128),customerName:text(input.customerName,180)};}
    else if(signature){need(input.inPerson===true,'Nur der Kunde unterschreibt die Terminbestätigung.',403);o.appointment.confirmation={mode:'vor Ort',at:now,signature,snapshotHash:text(input.snapshotHash,128)||null,customerName:text(input.customerName,180)};}
    else o.appointment.confirmation={mode:'ohne Unterschrift freigegeben',at:now,release:ownerRelease(input,now,'Der Termin')};
    if(status==='Angenommen')o.status='Termin verbindlich';
  }
  else if(action==='intake'||action==='return') {
    const current=o[action];
    need(!isSigned(current),'Ein unterschriebenes Protokoll bleibt unverändert. Bitte ein Ersatzprotokoll erstellen, das der Kunde neu unterschreibt.',409);
    need(!o.pending?.[action]?.content?.operatorSignature,'Das bereits vom Betrieb unterschriebene Protokoll bleibt unverändert. Bitte ausdrücklich eine neue Fassung erstellen oder den offenen Entwurf verwerfen.',409);
    need(input.customerAbsent!==true,'Für einen abwesenden Kunden bitte das Protokoll selbst unterschreiben und zur Kundenunterschrift bereitstellen.',409);
    clearPendingDocument(o,action,now);
    const content={...input,savedAt:now};
    if(isSigned(current))content.replaces={at:current.at??null,signedAt:current.signedAt??current.savedAt??null,snapshotHash:current.snapshotHash??null};
    if(input.customerSignature)content.signedAt=now;
    applyDocument(o,action,content,null,now);
    if(action==='intake'&&BEFORE_WORK.includes(status)&&workAuthorized(o))o.status='In Arbeit';
    if(action==='return'){if((BEFORE_WORK.includes(status)&&workAuthorized(o))||status==='In Arbeit')o.status='Erledigt';if(['Erledigt','Bezahlt'].includes(o.status)){o.completedAt??=now;settle(o);}}
  }
  else if(action==='replacement'||action==='protocolRequest') {
    const kind=input.kind;need(['offer','intake','return'].includes(kind),'Unbekanntes Dokument.');
    const remote=action==='protocolRequest',replacing=action==='replacement'||(remote&&isSigned(o[kind]));
    need(remote?kind!=='offer':(kind==='offer'?offerSigned(o):isSigned(o[kind])),remote?'Unbekanntes Protokoll.':'Nicht unterschriebene Dokumente werden direkt bearbeitet.',409);
    const content=kind==='offer'?{...structuredClone(o.assessment??emptyAssessment())}:structuredClone(input.content);need(content&&typeof content==='object','Ersatzdokument fehlt.');
    const current=kind==='offer'?o.offer:o[kind];
    clearPendingDocument(o,kind,now);
    if(remote){need(input.customerAbsent===true&&content.customerAbsent===true,'Bitte ausdrücklich „Kunde nicht vor Ort“ auswählen.',409);need(content.operatorSignature&&content.snapshotHash&&content.signaturesConfirmed===true&&!content.customerSignature,'Zuerst muss der Betrieb das angezeigte Protokoll persönlich unterschreiben.',409);content.operatorSignedAt=now;delete content.signedAt;}
    else if(kind!=='offer'){content.customerSignature=null;content.operatorSignature=null;content.signaturesConfirmed=false;delete content.signedAt;delete content.operatorSignedAt;delete content.customerSnapshotHash;delete content.customerAbsent;delete content.snapshotHash;delete content.replaces;}
    o.pending={...(o.pending??{}),[kind]:{content,createdAt:now,requestId:crypto.randomUUID(),baseSnapshot:documentBaseSnapshot(o,kind),replaces:replacing?{at:current?.at??current?.createdAt??null,signedAt:kind==='offer'?o.acceptance.at:(current.signedAt??current.savedAt??null),snapshotHash:kind==='offer'?(o.acceptance.snapshotHash??null):(current.snapshotHash??null)}:null}};
  }
  else if(action==='discardReplacement') { need(o.pending?.[input.kind],'Kein offenes Ersatzdokument.',409); history(o,'pendingHistory',{kind:input.kind,...o.pending[input.kind],discardedAt:now}); const {[input.kind]:_removed,...rest}=o.pending; o.pending=rest; }
  else if(action==='signReplacement') {
    // Customer signature, either through the personal link or in person on the operator's device.
    need(role==='customer'||input.inPerson===true,'Nur der Kunde unterschreibt das Ersatzdokument.',403);
    const kind=input.kind,pending=assertPendingDocument(o,kind);need(text(input.signature,100),'Unterschrift des Kunden fehlt.');need(input.snapshotHash,'Angezeigtes Dokument fehlt.',409);
    if(kind==='offer'){applyDocument(o,'offer',{...pending.content,createdAt:pending.createdAt,expiresAt:now,replaces:pending.replaces},{mode:role==='customer'?'online':'vor Ort',at:now,signature:text(input.signature,250000),...consents(input),snapshotHash:input.snapshotHash,replaces:pending.replaces},now);if(BEFORE_ACCEPT.includes(status))o.status='Angenommen';}
    else {const absent=pending.content.customerAbsent===true;need(!absent||(pending.content.operatorSignature&&pending.content.snapshotHash&&pending.content.operatorSignedAt),'Die Unterschrift des Betriebs fehlt. Bitte eine neue Fassung erstellen.',409);need(input.signature!==pending.content.operatorSignature,'Zwei getrennte Unterschriften sind erforderlich.');applyDocument(o,kind,{...pending.content,customerSignature:text(input.signature,100),operatorSignature:absent?pending.content.operatorSignature:null,signaturesConfirmed:true,signedAt:now,savedAt:now,snapshotHash:absent?pending.content.snapshotHash:input.snapshotHash,...(absent?{customerSnapshotHash:input.snapshotHash}:{}),replaces:pending.replaces??null,signedRemotely:role==='customer'},null,now);if(!pending.replaces){if(kind==='intake'&&BEFORE_WORK.includes(status)&&workAuthorized(o))o.status='In Arbeit';if(kind==='return'){if((BEFORE_WORK.includes(status)&&workAuthorized(o))||status==='In Arbeit')o.status='Erledigt';if(['Erledigt','Bezahlt'].includes(o.status)){o.completedAt??=now;settle(o);}}}}
    const {[kind]:_done,...rest}=o.pending;o.pending=rest;
  }
  else if(action==='payment') {
    const amount=cents(input.amountCents); need(amount>0,'Zahlungsbetrag muss positiv sein.');
    const at=input.at?optionalTime(input.at):now;need(Date.parse(at)<=Date.parse(now)+86400000,'Zahlungszeitpunkt liegt in der Zukunft.');
    const method=text(input.method,40)||'Überweisung';need(['Überweisung','Karte','Bar'].includes(method),'Zahlungsart ist ungültig.');
    const payment={id:crypto.randomUUID(),amountCents:amount,at,method,receipt:text(input.receipt,100)||null,cashConfirmed:input.cashConfirmed===true,note:text(input.note,500)};
    o.payments=[...(o.payments??[]),payment];
    need(input.allowOverpayment===true||!Number.isSafeInteger(billedTotalCents(o))||paidCents(o)<=billedTotalCents(o),'Zahlung überschreitet den Rechnungsbetrag bzw. vereinbarten Festpreis. Bitte Betrag prüfen oder Überzahlung ausdrücklich bestätigen.',409);
    settle(o);
  }
  else if(action==='paymentEdit') {
    const payments=o.payments??[];const index=input.id?payments.findIndex(p=>p.id===input.id):Number(input.index);need(Number.isInteger(index)&&payments[index],'Zahlung nicht gefunden.',404);
    const old=payments[index],{history:previous=[],...snapshot}=old,next={...old,history:[...previous,{...snapshot,changedAt:now}]};
    if(input.cancelled===true)next.cancelledAt=now;
    else{if(input.amountCents!==undefined){next.amountCents=cents(input.amountCents);need(next.amountCents>0,'Zahlungsbetrag muss positiv sein.');}if(input.at){next.at=optionalTime(input.at);need(Date.parse(next.at)<=Date.parse(now)+86400000,'Zahlungszeitpunkt liegt in der Zukunft.');}if(input.method!==undefined){next.method=text(input.method,40);need(['Überweisung','Karte','Bar'].includes(next.method),'Zahlungsart ist ungültig.');}if(input.note!==undefined)next.note=text(input.note,500);if(input.reactivate===true)delete next.cancelledAt;}
    o.payments=payments.map((p,i)=>i===index?next:p);
    need(input.allowOverpayment===true||!Number.isSafeInteger(billedTotalCents(o))||paidCents(o)<=billedTotalCents(o)||paidCents(o)<=paidCents(order),'Korrektur überschreitet den Rechnungsbetrag bzw. vereinbarten Festpreis. Bitte Betrag prüfen oder Überzahlung ausdrücklich bestätigen.',409);settle(o);
  }
  else if(action==='reject') { need(status!=='Bezahlt','Ein bezahlter Auftrag wird nicht abgelehnt.',409); history(o,'statusHistory',{from:status,to:'Abgelehnt',at:now,reason:text(input.reason)}); o.status='Abgelehnt'; o.closeReason=text(input.reason); }
  else if(action==='cancel') { need(status!=='Bezahlt','Ein bezahlter Auftrag wird nicht storniert.',409); history(o,'statusHistory',{from:status,to:'Storniert',at:now,reason:text(input.reason)}); o.status='Storniert';o.closeReason=text(input.reason); }
  else if(action==='expire') { need(status==='Angebot offen'&&Date.parse(o.offer.expiresAt)<=Date.parse(now),'Angebot ist noch nicht abgelaufen.',409); o.status='Abgelaufen'; }
  else if(action==='note') { need(text(input.note)||text(input.followUp),'Bitte eine Notiz oder ein Wiedervorlagedatum eingeben.'); o.notes=[...(o.notes??[]),{at:now,note:text(input.note),kind:text(input.kind,60)||'Notiz',followUp:text(input.followUp,40)}]; }
  else if(action==='editSource') {
    const changes={};const fields=input.source??input;
    for(const [key,max] of Object.entries(SOURCE_FIELDS))if(fields[key]!==undefined)changes[key]=text(fields[key],max);
    if(fields.reviewConsent!==undefined)changes.reviewConsent=fields.reviewConsent===true;
    need(Object.keys(changes).length,'Keine Änderung angegeben.');
    history(o,'sourceHistory',{at:now,before:Object.fromEntries(Object.keys(changes).map(key=>[key,o.source?.[key]??null]))});
    o.source={...o.source,...changes};o.sourceEdited=true;
  }
  else if(action==='setStatus') {
    need(STATES.includes(input.status),'Unbekannter Status.');
    // Ein Statussprung über fehlende Kundenunterschriften hinweg ist eine Freigabe: nur mit Grund.
    const BEYOND=['Angenommen','Termin verbindlich','In Arbeit','Erledigt','Bezahlt'],BINDING=['Termin verbindlich','In Arbeit','Erledigt','Bezahlt'];
    const skipsAcceptance=!o.acceptance&&BEYOND.includes(input.status)&&!BEYOND.includes(status);
    const skipsAppointment=BINDING.includes(input.status)&&!BINDING.includes(status)&&o.appointment&&!appointmentConfirmed(o);
    if(skipsAcceptance||skipsAppointment){
      need(text(input.reason).length>=3,skipsAcceptance?'Ohne Unterschrift des Kunden unter dem Angebot bitte einen Grund für die Freigabe angeben.':'Der Termin ist noch nicht vom Kunden bestätigt. Bitte einen Grund für die Freigabe angeben.');
      const release={by:'owner',at:now,reason:text(input.reason,300)};
      if(skipsAppointment)o.appointment.confirmation={mode:'ohne Unterschrift freigegeben',at:now,release};
      if(skipsAcceptance){
        const base=o.offer??o.assessment;
        if(!base?.totalCents&&!base?.lines?.length)o.acceptanceRelease={...release,status:input.status};
        else applyDocument(o,'offer',{...structuredClone(base),createdAt:o.offer?.createdAt??now,expiresAt:o.offer?.expiresAt??now},{mode:'ohne Unterschrift freigegeben',at:now,signature:null,snapshotHash:null,...consents({}),release},now);
      }
    }
    history(o,'statusHistory',{from:status,to:input.status,at:now,reason:text(input.reason)});
    // A status set by hand is kept; payments no longer move it back automatically.
    o.status=input.status;o.paidManually=o.status==='Bezahlt';if(['Erledigt','Bezahlt'].includes(o.status))o.completedAt??=now;
  }
  else throw new AppError('Unbekannter Arbeitsschritt.');
  o.updatedAt=now;return o;
}
export function dueJobs(o,now=Date.now()) {
  if(o.synthetic)return [];
  const out=[];const start=Date.parse(o.appointment?.start);
  if(o.status==='Termin verbindlich'&&start>now&&start-now<=72*3600000)out.push('reminder');
  if(['Erledigt','Bezahlt'].includes(o.status)&&o.source.reviewConsent&&o.completedAt&&now-Date.parse(o.completedAt)>=168*3600000)out.push('review');
  return out;
}
export function nextStep(o) {
  if(o.status==='Angenommen'&&o.appointment&&!appointmentConfirmed(o))return 'Terminbestätigung des Kunden abwarten (Kundenportal) oder vor Ort unterschreiben lassen';
  return ({'Preise prüfen':'Fahrzeugzustand und Preise prüfen','Angebot offen':'Auf persönliche Kundenannahme warten','Angenommen':'Verbindlichen Termin festlegen','Termin verbindlich':'Fahrzeugannahme vollständig dokumentieren','In Arbeit':'Arbeit abschließen und Rückgabe dokumentieren','Erledigt':'Schlussrechnung erstellen und Zahlung erfassen','Bezahlt':'Auftrag abgeschlossen'})[o.status]??'Auftrag geschlossen';
}
