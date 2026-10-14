// Kundenportal „Mein White Gloss“: Der Kunde meldet sich einmal mit der E-Mail-Adresse seines
// Auftrags an (Link + PIN) und sieht dort alle seine Aufträge: Status, Termin, Leistungen,
// unterschriebene Dokumente als PDF, offene Unterschriften, Rechnung, Chat mit Fotos und den
// Bewertungslink. Zusatzleistungen und Terminänderungen sind Anfragen: Erst der Betreiber
// übernimmt sie, gebucht wird über ein Ersatzangebot, das der Kunde selbst unterschreibt.
// Es werden keine Kundendaten gelöscht und keine E-Mails automatisch an Kunden versendet.
import {randomUUID} from 'node:crypto';
import {AppError,need,transition,text,appointmentSnapshot} from '../src/domain.mjs';
import {getOrder,saveOrder,settings,documentLinkUpdate,storeDataSignature} from '../src/worker.mjs';
import {packages,extras,vehicleClasses,extraIncluded} from '../src/catalog.mjs';
import {COMPANY} from '../src/company.mjs';
import {digest,limited} from './auth.mjs';
import {recordOperationIssue,assertRecordOperation} from '../src/record-compat.mjs';
import {isTrashedOrder} from '../src/order-trash.mjs';
import {portalChat,portalNotice} from './chat.mjs';
import {protocolDownload} from './protocol-mail.mjs';
import {invoicePDF,invoicePortalView,pdfResponse} from './qonto-billing.mjs';

export const PORTAL_PATH='/kunde';
export const PORTAL_PREFIXES=['/api/portal/'];
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const normal=value=>String(value??'').trim().toLowerCase();
const CLOSED=['Abgelehnt','Storniert','Abgelaufen'];
const EXTRA_STATES=['Preise prüfen','Angebot offen','Angenommen','Termin verbindlich','In Arbeit'];
const STEPS=['Anfrage','Angebot','Angenommen','Termin','In Arbeit','Fertig','Bezahlt'];
const STEP_OF={'Preise prüfen':0,'Angebot offen':1,'Angenommen':2,'Termin verbindlich':3,'In Arbeit':4,'Erledigt':5,'Bezahlt':6};
const STATUS_TEXT={
  'Preise prüfen':'Ihre Anfrage ist eingegangen. Wir prüfen die Angaben und erstellen Ihr persönliches Festpreis-Angebot.',
  'Angebot offen':'Ihr Angebot liegt bereit. Bitte prüfen und annehmen.',
  'Angenommen':'Vielen Dank für Ihren Auftrag. Wir stimmen den Termin mit Ihnen ab.',
  'Termin verbindlich':'Ihr Termin ist verbindlich eingeplant.',
  'In Arbeit':'Ihr Fahrzeug ist bei uns in Arbeit.',
  'Erledigt':'Ihr Fahrzeug ist fertig. Vielen Dank für Ihr Vertrauen!',
  'Bezahlt':'Der Auftrag ist abgeschlossen. Vielen Dank!',
  'Abgelehnt':'Diese Anfrage konnten wir leider nicht annehmen.',
  'Storniert':'Dieser Auftrag wurde storniert.',
  'Abgelaufen':'Das Angebot ist abgelaufen. Melden Sie sich gerne für ein neues Angebot.'
};
const DOCUMENT_LABEL={acceptance:'Auftragsbestätigung mit Ihrer Unterschrift',intake:'Annahmeprotokoll (Fahrzeugzustand bei Übergabe)',return:'Rückgabeprotokoll'};
const SIGN_LABEL={offer:'Ergänztes Angebot prüfen und unterschreiben',intake:'Annahmeprotokoll prüfen und unterschreiben',return:'Rückgabeprotokoll prüfen und unterschreiben'};

export async function portalSchema(env){
  await env.DB.batch([
    "CREATE TABLE IF NOT EXISTS portal_requests(id TEXT PRIMARY KEY,order_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('extras','termin')),data TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'offen' CHECK(status IN ('offen','übernommen','erledigt','abgelehnt')),created_at TEXT NOT NULL,decided_at TEXT)",
    'CREATE INDEX IF NOT EXISTS portal_requests_order ON portal_requests(order_id,created_at)',
    "CREATE TRIGGER IF NOT EXISTS no_portal_request_delete BEFORE DELETE ON portal_requests BEGIN SELECT RAISE(ABORT,'Kundenwünsche werden nicht gelöscht'); END"
  ].map(sql=>env.DB.prepare(sql)));
}

// Aufträge, die zu einer Kunden-E-Mail gehören (ohne Testdaten und ohne Papierkorb).
async function ordersFor(env,email,synthetic=false){
  const rows=(await env.DB.prepare("SELECT data,version FROM orders WHERE synthetic=? AND lower(trim(json_extract(data,'$.source.email')))=? ORDER BY updated_at DESC LIMIT 100").bind(synthetic?1:0,email).all()).results;
  return rows.map(row=>({...JSON.parse(row.data),version:row.version})).filter(o=>!isTrashedOrder(o));
}
async function owned(env,identity,orderId,isOwner){
  need(UUID.test(orderId??''),'Auftrag nicht gefunden.',404);
  const o=await getOrder(env,orderId);
  need(!isTrashedOrder(o),'Auftrag nicht gefunden.',404);
  need(isOwner||(!o.synthetic&&normal(o.source?.email)&&normal(o.source.email)===normal(identity)),'Dieser Auftrag gehört zu einem anderen Kundenkonto.',403);
  return o;
}
async function validLink(env,table,token,orderId){
  if(!/^[a-f0-9]{64}$/.test(token??''))return false;
  const row=await env.DB.prepare('SELECT expires_at FROM '+table+' WHERE hash=? AND order_id=? AND revoked=0').bind(digest(token),orderId).first();
  return Boolean(row&&Date.parse(row.expires_at)>Date.now());
}
function classOf(o){return vehicleClasses.find(c=>c.id===o.source?.classId)??vehicleClasses.find(c=>c.label===o.source?.vehicleClass)??null;}
function packageOf(o){return o.source?.packageId??(o.offer??o.assessment)?.lines?.find(l=>l.kind==='package')?.catalogId??packages.find(p=>p.name===o.source?.package)?.id??'';}
// Bereits enthaltene Zusatzleistungen werden nicht erneut angeboten.
function bookedExtras(o){const ids=new Set(o.source?.extraIds??[]);for(const doc of [o.offer,o.assessment,o.pending?.offer?.content])for(const l of doc?.lines??[])if(l.kind==='extra'&&l.catalogId)ids.add(l.catalogId);return ids;}
// requested: Extras aus offenen oder übernommenen Kundenwünschen werden nicht erneut angeboten.
export function availableExtras(o,requested=new Set()){
  if(!EXTRA_STATES.includes(o.status))return [];
  const klass=classOf(o),pack=packageOf(o),booked=bookedExtras(o),factor=klass?.factorPercent??100;for(const id of requested)booked.add(id);
  return extras.filter(e=>e.requestable&&!booked.has(e.id)&&!extraIncluded(pack,e.id)).map(e=>({id:e.id,name:e.name,hint:e.hint,group:e.group,inspect:e.inspect===true,priceCents:Math.round(e.priceCents*factor/100),classKnown:Boolean(klass)}));
}
function requestedExtras(requests){return new Set(requests.filter(r=>r.kind==='extras'&&['offen','übernommen'].includes(r.status)).flatMap(r=>(r.extras??[]).map(e=>e.id)));}
async function requestsOf(env,orderId){
  return (await env.DB.prepare('SELECT id,kind,data,status,created_at,decided_at FROM portal_requests WHERE order_id=? ORDER BY created_at DESC LIMIT 50').bind(orderId).all()).results.map(r=>({id:r.id,kind:r.kind,status:r.status,createdAt:r.created_at,decidedAt:r.decided_at,...JSON.parse(r.data)}));
}
function offerView(o){
  const doc=['Preise prüfen'].includes(o.status)?null:o.offer;if(!doc)return null;
  return {lines:(doc.lines??[]).map(l=>({title:l.title,description:l.description??'',amountCents:l.amountCents})),services:doc.lines?.length?'':doc.services??'',totalCents:doc.totalCents??null,signed:Boolean(o.acceptance)};
}
const RESCHEDULE=['Preise prüfen','Angebot offen','Angenommen','Termin verbindlich'];
// Nur noch nicht verbindliche Termine werden vom Kunden bestätigt; ältere verbindliche Termine bleiben es.
const CONFIRMABLE=['Preise prüfen','Angebot offen','Angenommen'];
async function portalOrder(env,o,config,preview){
  const restricted=recordOperationIssue(o,'customer-document');
  // Gesperrte Akten: nur die Kopfzeile, keine Inhalte (wie bei Angebots-, Rechnungs- und Chatlinks).
  if(restricted)return {id:o.id,wg:o.wg,status:o.status,statusText:'Dieser Vorgang ist derzeit gesperrt. Bitte kontaktieren Sie uns telefonisch oder per E-Mail.',step:null,steps:STEPS,closed:true,restricted:true,vehicle:o.source?.vehicle??'',plate:'',package:'',createdAt:null,appointment:null,offer:null,todo:[],documents:[],invoice:null,extras:[],requests:[],review:null,canReschedule:false};
  /** @type {{kind:string,label:string,at:string|null,signed:boolean|null,url:string}[]} */
  const documents=[];const pdf=kind=>'/api/portal/o/'+o.id+'/pdf/'+kind;
  if(o.acceptance)documents.push({kind:'acceptance',label:o.acceptance.release?'Auftragsbestätigung':DOCUMENT_LABEL.acceptance,at:o.acceptance.at??null,signed:null,url:pdf('acceptance')});
  for(const kind of ['intake','return'])if(o[kind])documents.push({kind,label:DOCUMENT_LABEL[kind],at:o[kind].signedAt??o[kind].at??o[kind].savedAt??null,signed:Boolean(o[kind].customerSignature),url:pdf(kind)});
  const todo=[];
  {
    if(o.status==='Angebot offen'&&!o.acceptance&&await validLink(env,'offer_tokens',o.offerToken,o.id))todo.push({kind:'offer-open',label:'Angebot prüfen und annehmen',url:'/angebot/'+o.offerToken});
    else if(o.status==='Angebot offen'&&!o.acceptance)todo.push({kind:'offer-expired',label:'Ihr Angebotslink ist abgelaufen. Bitte schreiben Sie uns – wir senden Ihnen einen neuen.',url:null});
    if(o.appointment&&!o.appointment.confirmation&&CONFIRMABLE.includes(o.status))todo.push({kind:'confirm-appointment',label:'Termin bestätigen und unterschreiben',anchor:'termin-'+o.id});
    for(const kind of ['offer','intake','return'])if(o.pending?.[kind])todo.push({kind:'sign-'+kind,document:kind,label:SIGN_LABEL[kind],action:'/api/portal/o/'+o.id+'/sign/'+kind});
  }
  let invoice=null;
  if(o.invoice?.provider==='qonto'&&o.invoice.number&&!o.synthetic){try{const view=invoicePortalView(o,preview);invoice={...view.invoice,lines:view.lines,payment:view.payment,payUrl:view.payUrl,vat:view.vat,pdfUrl:'/api/portal/o/'+o.id+'/rechnung.pdf'};}catch{invoice=null;}}
  const a=o.appointment&&!CLOSED.includes(o.status)?{start:o.appointment.start,end:o.appointment.end,delivery:o.appointment.delivery??'',location:o.appointment.location??'',workDays:o.appointment.workDays??null,curingNote:o.appointment.curing?.note??'',
    confirmed:Boolean(o.appointment.confirmation)||!CONFIRMABLE.includes(o.status),confirmedAt:o.appointment.confirmation?.at??null,confirmedHow:o.appointment.confirmation?.mode??null,
    // Der Kunde unterschreibt genau diesen Stand; der Server prüft den Hash beim Absenden.
    snapshotHash:digest(JSON.stringify(appointmentSnapshot(o))),canConfirm:!o.appointment.confirmation&&CONFIRMABLE.includes(o.status)}:null;
  const done=['Erledigt','Bezahlt'].includes(o.status);
  return {
    id:o.id,wg:o.wg,status:o.status,statusText:o.status==='Angenommen'&&o.appointment&&!o.appointment.confirmation?'Ihr Termin ist vorgeschlagen. Bitte bestätigen Sie ihn mit Ihrer Unterschrift.':STATUS_TEXT[o.status]??o.status,step:STEP_OF[o.status]??null,steps:STEPS,closed:CLOSED.includes(o.status),restricted:false,canReschedule:Boolean(a)&&RESCHEDULE.includes(o.status),
    createdAt:o.createdAt??null,vehicle:o.source?.vehicle??'',plate:o.source?.plate??'',package:packages.find(p=>p.id===packageOf(o))?.name??o.source?.package??'',vehicleClass:classOf(o)?.label??o.source?.vehicleClass??'',
    desiredDate:o.source?.desiredDate??'',delivery:o.source?.delivery??'',appointment:a,offer:offerView(o),todo,documents,invoice,
    ...await (async()=>{const requests=await requestsOf(env,o.id);return {extras:availableExtras(o,requestedExtras(requests)),requests};})(),
    review:done&&/^https:\/\//.test(config.reviewUrl??'')?config.reviewUrl:null
  };
}
function company(){return {name:COMPANY.name,owner:COMPANY.owner,street:COMPANY.street,city:COMPANY.city,phone:COMPANY.phone,email:COMPANY.email};}
async function readJSON(request,max=8000){
  need(request.headers.get('origin')===new URL(request.url).origin,'Ungültiger Ursprung.',403);
  need(request.headers.get('content-type')?.startsWith('application/json'),'JSON-Eingabe erforderlich.',415);
  const raw=await request.text();need(raw.length<max,'Anfrage zu groß.',413);
  try{const value=JSON.parse(raw);need(value&&typeof value==='object','Ungültige Eingabe.');return value;}catch(error){if(error instanceof AppError)throw error;throw new AppError('Ungültige Eingabe.',400);}
}
const euro=cents=>(cents/100).toFixed(2).replace('.',',')+' €';

// Kundenseite: /api/portal/... – der Aufrufer ist angemeldet (Kunde oder Betreiber-Vorschau).
export async function handlePortal(env,request,identity,isOwner){
  const url=new URL(request.url),path=url.pathname,now=Date.now();
  if(!path.startsWith('/api/portal/'))return null;
  const email=normal(identity),rest=path.slice('/api/portal/'.length).split('/');
  if(request.method==='GET'&&rest.length===1&&rest[0]==='me'){
    let orders,customerEmail=email,preview=false;
    if(isOwner){
      const id=url.searchParams.get('vorschau')??'';need(UUID.test(id),'Betreibervorschau: Bitte im Auftrag „Kundenportal-Vorschau“ öffnen.',400);
      const o=await getOrder(env,id);need(!isTrashedOrder(o),'Auftrag liegt im Papierkorb.',404);customerEmail=normal(o.source?.email);preview=true;
      orders=customerEmail?await ordersFor(env,customerEmail,o.synthetic):[{...o}];
      if(!orders.some(x=>x.id===o.id))orders.unshift(o);
    }else orders=await ordersFor(env,email);
    const config=await settings(env);
    const views=[];for(const o of orders)views.push(await portalOrder(env,o,config,preview));
    const name=orders.find(o=>o.source?.name)?.source.name??'';
    return json({customer:{name,email:customerEmail},preview,company:company(),orders:views});
  }
  need(rest[0]==='o'&&rest.length>=3,'Funktion nicht gefunden.',404);
  const o=await owned(env,email,rest[1],isOwner),op=rest.slice(2).join('/');
  if(request.method==='GET'){
    assertRecordOperation(o,'customer-document');
    if(/^pdf\/(acceptance|intake|return)$/.test(op)){
      const kind=op.slice(4);need(kind==='acceptance'?o.acceptance:o[kind],'Dieses Dokument liegt noch nicht vor.',404);
      const r=await protocolDownload(env,o.id,kind);return new Response(r.body,{headers:{...Object.fromEntries(r.headers),...headers}});
    }
    if(op==='rechnung.pdf'){
      need(o.invoice?.provider==='qonto'&&o.invoice.number&&!o.synthetic,'Für diesen Auftrag liegt keine Rechnung vor.',404);
      const pdf=await invoicePDF(env,o);need(pdf,'Das Rechnungs-PDF wird gerade erstellt. Bitte in einer Minute erneut versuchen.',409);
      const r=pdfResponse(pdf);return new Response(r.body,{headers:{...Object.fromEntries(r.headers),...headers}});
    }
    throw new AppError('Funktion nicht gefunden.',404);
  }
  need(request.method==='POST','Methode nicht erlaubt.',405);
  need(!isOwner,'Betreibervorschau: Aktionen führt nur der Kunde selbst aus.',403);
  assertRecordOperation(o,'customer-document');
  // Eine Unterschrift als PNG braucht mehr Platz als die übrigen Formulare.
  const input=await readJSON(request,op==='termin-bestaetigen'?450000:8000);
  if(op==='chat'){
    const chat=await portalChat(env,o.id,now);
    return json(chat);
  }
  need(!await limited(env,'portal:'+email,now,30),'Zu viele Anfragen in kurzer Zeit. Bitte später erneut versuchen.',429);
  if(/^sign\/(offer|intake|return)$/.test(op)){
    const kind=op.slice(5),pending=o.pending?.[kind];need(pending,'Dieses Dokument wartet nicht mehr auf Ihre Unterschrift.',409);
    if(pending.token&&await validLink(env,'document_requests',pending.token,o.id))return json({url:'/dokument/'+pending.token});
    const {updated,statements}=await documentLinkUpdate(env,o,kind);
    const saved=await saveOrder(env,updated,o.version,'Kunde hat Dokument im Kundenportal zur Unterschrift geöffnet','customer',statements);
    return json({url:'/dokument/'+saved.pending[kind].token});
  }
  if(op==='extras'){
    const offered=new Map(availableExtras(o,requestedExtras(await requestsOf(env,o.id))).map(e=>[e.id,e]));
    const ids=[...new Set(Array.isArray(input.extraIds)?input.extraIds:[])];
    need(ids.length>0&&ids.length<=10&&ids.every(id=>offered.has(id)),'Bitte mindestens eine verfügbare Zusatzleistung auswählen.');
    const note=text(input.note,500),chosen=ids.map(id=>offered.get(id)),id=randomUUID(),at=new Date(now).toISOString();
    const data={extras:chosen.map(e=>({id:e.id,name:e.name,priceCents:e.priceCents,inspect:e.inspect})),note};
    await env.DB.prepare("INSERT INTO portal_requests(id,order_id,kind,data,created_at) VALUES(?,?,'extras',?,?)").bind(id,o.id,JSON.stringify(data),at).run();
    await portalNotice(env,o.id,'Zusatzleistungen über das Kundenportal angefragt (noch nicht gebucht):\n'+chosen.map(e=>'• '+e.name+' – '+(e.inspect?'ab ':'')+euro(e.priceCents)).join('\n')+(note?'\n\nHinweis: '+note:''),now).catch(()=>null);
    return json({ok:true,id,message:'Danke! Ihre Anfrage ist bei uns. Wir prüfen sie und senden Ihnen ein ergänztes Angebot zur Unterschrift hier ins Portal.'});
  }
  if(op==='termin-bestaetigen'){
    if(o.appointment&&(o.appointment.confirmation||o.status==='Termin verbindlich'))return json({ok:true,message:'Ihr Termin ist bereits bestätigt.'});
    need(o.appointment&&CONFIRMABLE.includes(o.status),'Für diesen Auftrag gibt es keinen Termin zum Bestätigen.',409);
    need(input.confirmed===true,'Bitte bestätigen Sie den angezeigten Termin.');
    need(input.snapshotHash===digest(JSON.stringify(appointmentSnapshot(o))),'Der Termin wurde inzwischen geändert. Bitte die Seite neu laden und den aktuellen Termin bestätigen.',409);
    const operationId=randomUUID(),guard={sql:"EXISTS(SELECT 1 FROM orders WHERE id=? AND version=? AND json_extract(data,'$.operationId')=?)",params:[o.id,o.version+1,operationId]};
    const signature=await storeDataSignature(env,o.id,input.signature,'signature',guard);
    const updated=transition(o,'confirmAppointment',{signature:signature.id,confirmed:true,snapshotHash:input.snapshotHash,customerName:input.customerName},new Date(now).toISOString(),'customer');updated.operationId=operationId;
    try{await saveOrder(env,updated,o.version,'Kunde hat den Termin im Kundenportal bestätigt und unterschrieben','customer',[signature.statement]);}catch(error){await env.BUCKET.delete(signature.id);throw error;}
    await portalNotice(env,o.id,'Termin im Kundenportal bestätigt und unterschrieben.',now).catch(()=>null);
    return json({ok:true,message:'Vielen Dank! Ihr Termin ist jetzt verbindlich bestätigt.'});
  }
  if(op==='termin'){
    need(o.appointment&&RESCHEDULE.includes(o.status),'Für diesen Auftrag kann kein Terminwunsch mehr gesendet werden.',409);
    const wish=text(input.wish,500);need(wish.length>=3,'Bitte beschreiben Sie kurz Ihren Wunsch.');
    const id=randomUUID(),at=new Date(now).toISOString();
    await env.DB.prepare("INSERT INTO portal_requests(id,order_id,kind,data,created_at) VALUES(?,?,'termin',?,?)").bind(id,o.id,JSON.stringify({wish,appointmentStart:o.appointment?.start??null}),at).run();
    await portalNotice(env,o.id,'Terminwunsch über das Kundenportal:\n'+wish,now).catch(()=>null);
    return json({ok:true,id,message:'Danke! Wir melden uns zu Ihrem Terminwunsch. Bis dahin gilt der bisherige Termin.'});
  }
  throw new AppError('Funktion nicht gefunden.',404);
}

// Betreiber: offene Kundenwünsche ansehen und bearbeiten.
export async function handlePortalAdmin(env,request,isOwner){
  const url=new URL(request.url);if(!url.pathname.startsWith('/api/portal-admin/'))return null;
  need(isOwner,'Nur für den Betreiber.',403);
  if(request.method==='GET'&&url.pathname==='/api/portal-admin/requests'){
    const order=url.searchParams.get('order');
    const rows=order?(await env.DB.prepare('SELECT r.*,o.wg,o.data AS order_data FROM portal_requests r JOIN orders o ON o.id=r.order_id WHERE r.order_id=? ORDER BY r.created_at DESC LIMIT 50').bind(order).all()).results:(await env.DB.prepare("SELECT r.*,o.wg,o.data AS order_data FROM portal_requests r JOIN orders o ON o.id=r.order_id WHERE r.status='offen' AND json_extract(o.data,'$.trash.deletedAt') IS NULL ORDER BY r.created_at DESC LIMIT 100").all()).results;
    return json({requests:rows.map(r=>{const d=JSON.parse(r.order_data);return {id:r.id,orderId:r.order_id,wg:r.wg,name:d.source?.name??'',kind:r.kind,status:r.status,createdAt:r.created_at,decidedAt:r.decided_at,synthetic:d.synthetic===true,...JSON.parse(r.data)};})});
  }
  if(request.method==='POST'&&url.pathname==='/api/portal-admin/request'){
    const input=await readJSON(request);need(UUID.test(input.id??''),'Kundenwunsch nicht gefunden.',404);
    const row=await env.DB.prepare('SELECT * FROM portal_requests WHERE id=?').bind(input.id).first();need(row,'Kundenwunsch nicht gefunden.',404);
    need(row.status==='offen','Dieser Kundenwunsch wurde bereits bearbeitet.',409);
    const at=new Date().toISOString(),decide=status=>env.DB.prepare("UPDATE portal_requests SET status=?,decided_at=? WHERE id=? AND status='offen'").bind(status,at,row.id);
    if(input.decision==='apply'){
      need(row.kind==='extras','Nur Zusatzleistungen lassen sich in die Leistungen übernehmen.');
      const o=await getOrder(env,row.order_id);assertRecordOperation(o,'operate');
      need(EXTRA_STATES.includes(o.status),'Der Auftrag ist bereits '+o.status+'. Zusatzleistungen lassen sich nicht mehr übernehmen.',409);
      const base=o.assessment??o.offer;need(Array.isArray(base?.lines),'Bitte zuerst die Leistungen im Preisformular als Positionen speichern.',409);
      const data=JSON.parse(row.data),present=new Set(base.lines.filter(l=>l.kind==='extra').map(l=>l.catalogId));
      const added=data.extras.filter(e=>!present.has(e.id)).map(e=>({id:'portal-'+e.id+'-'+row.id.slice(0,8),kind:'extra',catalogId:e.id,title:e.name,description:e.inspect?'Preis vorbehaltlich Prüfung vor Ort':'',amountCents:e.priceCents}));
      const updated=transition(o,'price',{lines:[...base.lines.map(l=>({...l})),...added],condition:base.condition??'',pricesReviewed:false},at);
      // Ein offenes, noch nicht unterschriebenes Angebot bleibt unverändert, bis der Betreiber die
      // Preise geprüft und im Preisformular gespeichert hat.
      if(!o.acceptance){updated.offer=o.offer;if(o.offerHistory===undefined)delete updated.offerHistory;else updated.offerHistory=o.offerHistory;}
      // Erst den Wunsch beanspruchen, damit „Übernehmen“ und „Ablehnen“ nie beide wirken.
      const claimed=await decide('übernommen').run();need(claimed.meta.changes===1,'Dieser Kundenwunsch wurde bereits bearbeitet.',409);
      try{await saveOrder(env,updated,o.version,'Zusatzleistungen aus dem Kundenportal übernommen','owner');}
      catch(error){await env.DB.prepare("UPDATE portal_requests SET status='offen',decided_at=NULL WHERE id=? AND status='übernommen' AND decided_at=?").bind(row.id,at).run();throw error;}
      return json({ok:true,signed:Boolean(o.acceptance),message:o.acceptance?'Übernommen. Bitte Preise prüfen und ein Ersatzangebot erstellen – der Kunde unterschreibt es im Portal.':'Übernommen. Bitte die Preise unter „Leistungen & Angebot“ prüfen und speichern – erst dann sieht der Kunde das ergänzte Angebot.'});
    }
    need(['done','decline'].includes(input.decision),'Unbekannte Entscheidung.');
    const r=await decide(input.decision==='done'?'erledigt':'abgelehnt').run();need(r.meta.changes===1,'Dieser Kundenwunsch wurde bereits bearbeitet.',409);
    return json({ok:true});
  }
  throw new AppError('Funktion nicht gefunden.',404);
}
