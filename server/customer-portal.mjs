import {AppError,need} from '../src/domain.mjs';
import {getOrder,saveOrder,settings} from '../src/worker.mjs';
import {reviewPolicyErrors} from '../src/customer-policy.mjs';
import {digest,limited} from './auth.mjs';
import {protocolDownload} from './protocol-mail.mjs';
import {paymentDocument,templateSchema} from './document-template.mjs';
import {agreementDocument} from './agreement-document.mjs';
import {invoicePaymentDocument} from './invoice-payment.mjs';
import {calendarAdjustmentData} from './calendar-adjustments.mjs';
import {recordOperationIssue} from '../src/operations.mjs';

export async function customerPortalSchema(env){
  await env.DB.batch([
    "CREATE TABLE IF NOT EXISTS customer_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id TEXT NOT NULL REFERENCES orders(id),sender_role TEXT NOT NULL CHECK(sender_role IN ('owner','customer')),request_id TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(order_id,sender_role,request_id))",
    'CREATE INDEX IF NOT EXISTS customer_messages_order ON customer_messages(order_id,id)',
    "CREATE TABLE IF NOT EXISTS customer_message_reads(order_id TEXT NOT NULL REFERENCES orders(id),reader_role TEXT NOT NULL CHECK(reader_role IN ('owner','customer')),last_id INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(order_id,reader_role))",
    'CREATE TABLE IF NOT EXISTS customer_consent_requests(order_id TEXT NOT NULL REFERENCES orders(id),request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,data TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(order_id,request_id))'
  ].map(sql=>env.DB.prepare(sql)));
}
const normalized=value=>String(value??'').trim().toLowerCase();
export async function customerOrder(env,identity,id){const order=await getOrder(env,id);need(normalized(order.source.email)===normalized(identity),'Vorgang nicht gefunden.',404);return order;}
function protocolBelongsToCustomer(order,kind,identity){const h=order.handovers?.[kind],p=h?.protocol??order[kind];return !h&&p?.workflow!=='remote'||normalized(p?.customerEmail)===normalized(identity);}
function ownOrderDTO(order,issuedPayments=new Set(),identity){
  const documents=['intake','return'].filter(kind=>order[kind]?.signaturesConfirmed&&order[kind]?.snapshotHash&&protocolBelongsToCustomer(order,kind,identity)).map(kind=>({kind,label:kind==='intake'?'Unterschriebenes Annahmeprotokoll':'Unterschriebenes Rückgabeprotokoll',at:order[kind].at,url:'/api/customer-portal/document?id='+encodeURIComponent(order.id)+'&kind='+kind}));
  if(order.acceptance)documents.push({kind:'agreement',label:'Unterschriebene Vereinbarung ansehen',at:order.acceptance.at,url:'/api/customer-portal/agreement?id='+encodeURIComponent(order.id)});
  for(const item of order.amendments??[])if(item.state==='accepted'&&item.acceptance)documents.push({kind:'amendment',label:'Unterschriebener Nachtrag ansehen',at:item.acceptance.at,url:'/api/customer-portal/agreement?id='+encodeURIComponent(order.id)+'&amendment='+encodeURIComponent(item.id)});
  for(const payment of order.payments??[])if(payment.id&&(order.receiptRequests?.[payment.id]?.requestedBy==='owner'||issuedPayments.has(payment.id)))documents.push({kind:'payment',label:payment.method==='Bar'?'Quittung herunterladen':'Zahlungsnachweis herunterladen',at:payment.at,url:'/api/customer/payment/pdf?id='+encodeURIComponent(order.id)+'&payment='+encodeURIComponent(payment.id)});
  if(typeof order.invoice?.url==='string'&&/^https:\/\/pay\.qonto\.com\/invoices\//.test(order.invoice.url))documents.push({kind:'invoice',label:'Rechnung '+order.invoice.number+' bei Qonto ansehen',at:order.invoice.at,url:order.invoice.url});
  if(/^[a-f0-9]{64}$/.test(order.invoice?.paymentCopyVersion??''))documents.push({kind:'invoice-payment',label:'Rechnung '+order.invoice.number+' · '+order.invoice.paymentCopy.header,at:order.invoice.paymentCopy.at,url:'/api/customer/invoice/payment/pdf?id='+encodeURIComponent(order.id)+'&version='+order.invoice.paymentCopyVersion});
  const safeAppointment=order.appointment?{start:order.appointment.start,end:order.appointment.end,duration:order.appointment.duration,delivery:order.appointment.delivery,location:order.appointment.location}:null;
  const cancellations=(order.documentCancellations??[]).filter(item=>{const kind=item.documentKey?.replace(/^handover:/,'');return !['intake','return'].includes(kind)||protocolBelongsToCustomer(order,kind,identity);}).map(item=>({documentKey:item.documentKey,at:item.at,reason:item.reason,scope:item.scope}));
  for(const document of documents){const key=document.kind==='agreement'?'offer':document.kind==='amendment'?'amendment:'+new URL(document.url,'https://panel.invalid').searchParams.get('amendment'):document.kind;const cancellation=cancellations.find(item=>item.documentKey===key||item.documentKey==='handover:'+key||item.scope==='whole-agreement'&&['agreement','amendment'].includes(document.kind)||document.kind==='agreement'&&item.documentKey==='pickup');if(cancellation){Object.assign(document,{cancellation});document.label='Originalbeleg (storniert): '+document.label;}}
  return {id:order.id,wg:order.wg,status:order.status,customer:order.source.name,vehicle:order.source.vehicle,createdAt:order.createdAt,appointment:safeAppointment,offer:order.offer?{services:order.offer.services,totalCents:order.offer.totalCents,expiresAt:order.offer.expiresAt}:null,acceptedAt:order.acceptance?.at??null,completedAt:order.completedAt??null,documents,documentCancellations:cancellations,operationIssue:recordOperationIssue(order)};
}
export async function customerPortalData(env,identity){await templateSchema(env);
  const rows=await env.DB.prepare("SELECT * FROM orders WHERE lower(trim(json_extract(data,'$.source.email')))=? ORDER BY updated_at DESC").bind(normalized(identity)).all();
  const orders=[],policy=(await settings(env)).reviewPolicy,validPolicy=reviewPolicyErrors(policy).length===0;
  for(const row of rows.results){const order={...JSON.parse(row.data),id:row.id,wg:row.wg,status:row.status,version:row.version};const issued=await env.DB.prepare('SELECT payment_id FROM payment_documents WHERE order_id=?').bind(order.id).all(),dto=ownOrderDTO(order,new Set(issued.results.map(item=>item.payment_id)),identity);const unread=await unreadCount(env,order.id,'customer');dto.unreadMessages=unread;dto.version=order.version;dto.reviewConsent={granted:order.reviewConsent?.granted===true&&!order.reviewConsent?.revokedAt,revokedAt:order.reviewConsent?.revokedAt??null};dto.reviewPolicy=validPolicy&&['Erledigt','Bezahlt'].includes(order.status)?{version:policy.version,schedule:policy.schedule,optOutText:policy.optOutText}:null;
    const links=await env.DB.prepare('SELECT hash,expires_at FROM offer_tokens WHERE order_id=? AND revoked=0 AND expires_at>?').bind(order.id,new Date().toISOString()).all();
    const eligible=new Set(links.results.map(item=>item.hash));dto.offerUrl=order.offerToken&&eligible.has(digest(order.offerToken))?'/angebot/'+order.offerToken:null;
    dto.amendments=(order.amendments??[]).filter(item=>item.state==='open'&&eligible.has(digest(item.token))).map(item=>({id:item.id,services:item.services,amountCents:item.amountCents,url:'/angebot/'+item.token}));
    const protocolLinks=await env.DB.prepare('SELECT hash,kind FROM handover_tokens WHERE order_id=? AND revoked=0').bind(order.id).all(),protocolAccess=new Set(protocolLinks.results.map(item=>item.kind+':'+item.hash));
    dto.handovers=['intake','return'].flatMap(kind=>{const h=order.handovers?.[kind];if(!h||normalized(h.protocol?.customerEmail)!==normalized(identity)||!['pending','completed'].includes(h.status))return [];const cancellation=dto.documentCancellations.find(item=>item.documentKey===kind||item.documentKey==='handover:'+kind||item.scope==='whole-agreement');if(cancellation)return [{kind,status:'cancelled',url:null,operatorSignedAt:h.operatorSignedAt,customerSignedAt:h.customerSignedAt??null,cancellation}];if(!/^[a-f0-9]{64}$/.test(h.token??'')||!protocolAccess.has(kind+':'+digest(h.token)))return [];return [{kind,status:h.status,url:'/protokoll/'+h.token,operatorSignedAt:h.operatorSignedAt,customerSignedAt:h.customerSignedAt??null,cancellation:undefined}];});
    dto.appointmentChanges=await calendarAdjustmentData(env,order);orders.push(dto);
  }
  return {orders};
}
async function unreadCount(env,id,role){return (await env.DB.prepare('SELECT COUNT(*) n FROM customer_messages WHERE order_id=? AND sender_role<>? AND id>COALESCE((SELECT last_id FROM customer_message_reads WHERE order_id=? AND reader_role=?),0)').bind(id,role,id,role).first()).n;}
async function chatInput(request){const reader=request.body?.getReader();need(reader,'Ungültige Eingabe.');const chunks=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>12000){await reader.cancel();throw new AppError('Nachricht zu groß.',413);}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}try{const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));need(input&&typeof input==='object'&&!Array.isArray(input),'Ungültige Eingabe.');return input;}catch(error){if(error instanceof AppError)throw error;throw new AppError('Ungültige Eingabe.',400);}}
export async function customerChat(env,request,identity,isOwner){
  const url=new URL(request.url),role=isOwner?'owner':'customer';
  const id=url.searchParams.get('id');need(typeof id==='string'&&id.length<=80,'Vorgang fehlt.');
  if(isOwner)await getOrder(env,id);else await customerOrder(env,identity,id);
  if(request.method==='GET'){
    const before=Number(url.searchParams.get('before')??0);need(Number.isSafeInteger(before)&&before>=0,'Nachrichtenposition ungültig.');
    const rows=await env.DB.prepare('SELECT id,sender_role,body,created_at FROM customer_messages WHERE order_id=? AND (?=0 OR id<?) ORDER BY id DESC LIMIT 101').bind(id,before,before).all(),hasMore=rows.results.length>100;
    return Response.json({messages:rows.results.slice(0,100).reverse().map(row=>({id:row.id,sender:row.sender_role,body:row.body,at:row.created_at})),hasMore,unread:await unreadCount(env,id,role)});
  }
  need(request.method==='POST','Methode nicht erlaubt.',405);
  need(request.headers.get('origin')===env.PANEL_ORIGIN&&request.headers.get('content-type')?.startsWith('application/json'),'Ungültiger Ursprung oder Inhalt.',403);
  const input=await chatInput(request);
  if(input.action==='read'){
    need(Number.isSafeInteger(input.lastId)&&input.lastId>=0,'Leseposition ungültig.');
    if(input.lastId>0)need(await env.DB.prepare('SELECT id FROM customer_messages WHERE id=? AND order_id=?').bind(input.lastId,id).first(),'Leseposition gehört nicht zu diesem Vorgang.');
    await env.DB.prepare('INSERT INTO customer_message_reads VALUES(?,?,?) ON CONFLICT(order_id,reader_role) DO UPDATE SET last_id=max(last_id,excluded.last_id)').bind(id,role,input.lastId).run();
    return Response.json({ok:true,unread:await unreadCount(env,id,role)});
  }
  need(input.action==='send','Unbekannter Nachrichtenschritt.');
  const issue=recordOperationIssue(await getOrder(env,id),'customerMessage');need(!issue,issue,409);
  need(typeof input.requestId==='string'&&/^[a-f0-9-]{36}$/.test(input.requestId),'Eindeutige Nachrichten-ID fehlt.');
  need(typeof input.body==='string'&&input.body.trim().length>0&&input.body.length<=4000&&!/\u0000/.test(input.body),'Nachricht muss 1 bis 4000 Zeichen enthalten.');
  const body=input.body.trim(),existing=await env.DB.prepare('SELECT id,body FROM customer_messages WHERE order_id=? AND sender_role=? AND request_id=?').bind(id,role,input.requestId).first();
  if(existing){need(existing.body===body,'Nachrichten-ID bereits mit anderem Inhalt verwendet.',409);return Response.json({ok:true,id:existing.id});}
  need(!await limited(env,'chat:'+role+':'+normalized(identity),Date.now(),60),'Zu viele Nachrichten. Bitte später erneut versuchen.',429);
  await env.DB.prepare("INSERT OR IGNORE INTO customer_messages(order_id,sender_role,request_id,body,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND COALESCE(json_extract(data,'$.recordsRestriction.status'),'') NOT IN ('blocked','anonymized') AND COALESCE(json_array_length(data,'$.documentCancellations'),0)=0)").bind(id,role,input.requestId,body,new Date().toISOString(),id).run();
  const saved=await env.DB.prepare('SELECT id,body FROM customer_messages WHERE order_id=? AND sender_role=? AND request_id=?').bind(id,role,input.requestId).first();need(saved?.body===body,'Nachrichten-ID bereits mit anderem Inhalt verwendet.',409);
  return Response.json({ok:true,id:saved.id});
}
export async function customerPortalDocument(env,request,identity){const url=new URL(request.url),id=url.searchParams.get('id'),kind=url.searchParams.get('kind');const order=await customerOrder(env,identity,id);need(['intake','return'].includes(kind)&&order[kind]?.signaturesConfirmed&&order[kind]?.snapshotHash&&protocolBelongsToCustomer(order,kind,identity),'Dokument nicht gefunden.',404);return protocolDownload(env,id,kind);}
export async function customerPaymentPDF(env,request,identity){const url=new URL(request.url),id=url.searchParams.get('id');await customerOrder(env,identity,id);const pdf=await paymentDocument(env,id,url.searchParams.get('payment'));return new Response(pdf.bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+pdf.filename+'"','Cache-Control':'no-store'}});}
export async function customerInvoicePaymentPDF(env,request,identity){const url=new URL(request.url),id=url.searchParams.get('id'),version=url.searchParams.get('version');await customerOrder(env,identity,id);need(/^[a-f0-9]{64}$/.test(version??''),'Gespeicherte Rechnungskopienversion fehlt.');const pdf=await invoicePaymentDocument(env,id,version);return new Response(pdf.bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+pdf.filename+'"','Cache-Control':'no-store'}});}
export async function customerReviewConsent(env,request,identity){
  need(request.method==='POST','Methode nicht erlaubt.',405);need(request.headers.get('origin')===env.PANEL_ORIGIN&&request.headers.get('content-type')?.startsWith('application/json'),'Ungültiger Ursprung oder Inhalt.',403);
  const input=await chatInput(request);need(typeof input.granted==='boolean'&&typeof input.requestId==='string'&&/^[a-f0-9-]{36}$/.test(input.requestId),'Einwilligung und eindeutige Anfrage-ID fehlen.');
  const order=await customerOrder(env,identity,input.id),payloadHash=digest(JSON.stringify({granted:input.granted,version:input.policyVersion??null})),old=await env.DB.prepare('SELECT payload_hash FROM customer_consent_requests WHERE order_id=? AND request_id=?').bind(order.id,input.requestId).first();
  if(old){need(old.payload_hash===payloadHash,'Anfrage-ID bereits mit anderer Einwilligung verwendet.',409);return Response.json({ok:true});}
  need(order.version===input.version,'Der Vorgang wurde geändert. Bitte neu laden.',409);need(!await limited(env,'review-consent:'+normalized(identity),Date.now(),30),'Zu viele Änderungen. Bitte später erneut versuchen.',429);
  const policy=(await settings(env)).reviewPolicy,now=new Date().toISOString();
  if(input.granted){need(reviewPolicyErrors(policy).length===0,'Die Bewertungsanfrage ist noch nicht vollständig freigegeben.',409);need(input.policyVersion===policy.version,'Die angezeigte Bewertungsregel wurde geändert. Bitte neu laden.',409);need(['Erledigt','Bezahlt'].includes(order.status)&&Number.isFinite(Date.parse(order.completedAt))&&Date.parse(order.completedAt)<=Date.now(),'Eine Bewertungsanfrage kann erst nach bestätigtem Dienstleistungsabschluss freigegeben werden.',409);}
  const consent=input.granted?{granted:true,channel:'email',orderId:order.id,recipient:normalized(order.source.email),grantedAt:now,version:policy.version,evidence:'Kunde hat im persönlich angemeldeten Kundenpanel ausdrücklich eine einmalige neutrale Bewertungsanfrage per E-Mail für diesen abgeschlossenen Vorgang freigegeben.',revokedAt:null}:{...(order.reviewConsent??{}),granted:false,revokedAt:now};
  const updated={...order,reviewConsent:consent,operationId:crypto.randomUUID()};
  const statements=[env.DB.prepare("INSERT INTO customer_consent_requests SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND version=? AND json_extract(data,'$.operationId')=?)").bind(order.id,input.requestId,payloadHash,JSON.stringify(consent),now,order.id,order.version+1,updated.operationId)];
  try{await saveOrder(env,updated,order.version,input.granted?'Kunde hat einmalige Bewertungsanfrage ausdrücklich erlaubt':'Kunde hat Bewertungsanfrage widerrufen','customer',statements);}catch(error){const replay=await env.DB.prepare('SELECT payload_hash FROM customer_consent_requests WHERE order_id=? AND request_id=?').bind(order.id,input.requestId).first();if(replay?.payload_hash===payloadHash)return Response.json({ok:true});throw error;}
  return Response.json({ok:true});
}
export async function customerAgreement(env,request,identity){
  const url=new URL(request.url),order=await customerOrder(env,identity,url.searchParams.get('id')),amendment=url.searchParams.get('amendment');
  if(url.searchParams.get('format')==='pdf'){const pdf=await agreementDocument(env,order,amendment);return new Response(pdf.bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+pdf.filename+'"','Cache-Control':'no-store'}});}
  const proof=amendment?order.amendments?.find(item=>item.id===amendment&&item.state==='accepted')?.acceptance:order.acceptance;need(proof,'Unterschriebene Vereinbarung nicht gefunden.',404);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const signature=typeof proof.signature==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(proof.signature)?'<img class="agreement-signature" src="'+proof.signature+'" alt="Gespeicherte persönliche Unterschrift">':'';
  const snapshot=proof.snapshot??{offer:order.offer};
  const details=snapshot.amendment??snapshot.offer??{},money=value=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format((value??0)/100),date=value=>value?new Intl.DateTimeFormat('de-DE',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Berlin'}).format(new Date(value)):'';
  const appointment=snapshot.appointment;
  const policy=snapshot.offer?.cancellationPolicy??order.cancellationTerms?.policy,acceptedAt=order.cancellationTerms?.acceptance?.at??proof.at;
  const acceptedTerms=policy?.terms?'<section><h2>Angenommene Stornobedingungen</h2><p>Version '+escape(policy.version)+' · angenommen am '+escape(date(acceptedAt))+'</p><p class="agreement-copy">'+escape(policy.terms)+'</p></section>':'';
  const content='<h2>Vereinbarte Leistungen</h2><p class="agreement-copy">'+escape(details.services)+'</p>'+(details.reason?'<p>'+escape(details.reason)+'</p>':'')+'<p><strong>Gesamtpreis: '+escape(money(details.totalCents))+'</strong></p>'+(details.amountCents!==undefined?'<p>Zusatzpreis: '+escape(money(details.amountCents))+'</p>':'')+(appointment?'<h2>Bestätigter Termin</h2><p>'+escape(date(appointment.start))+' bis '+escape(date(appointment.end))+'<br>'+escape(appointment.delivery)+' · '+escape(appointment.location)+'</p>':'')+acceptedTerms;
  const pdfURL='/api/customer-portal/agreement?id='+encodeURIComponent(order.id)+(amendment?'&amendment='+encodeURIComponent(amendment):'')+'&format=pdf';
  return new Response('<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>White Gloss · Unterschriebene Vereinbarung</title><link rel="stylesheet" href="/style.css"><main class="appoff card"><h1>'+escape(order.wg)+' · '+(amendment?'Unterschriebener Nachtrag':'Unterschriebene Vereinbarung')+'</h1><p>'+escape(order.source.name)+' · '+escape(order.source.vehicle)+'</p><p>Unterschrieben am '+escape(date(proof.at))+'</p>'+content+signature+'<p><a href="'+escape(pdfURL)+'">PDF auf Briefpapier herunterladen</a></p><p><a href="/kundenportal">Zurück zum Kundenpanel</a></p></main></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}
export async function ownerChatSummary(env){const rows=await env.DB.prepare("SELECT o.id,o.wg,o.synthetic,json_extract(o.data,'$.source.name') customer,json_extract(o.data,'$.source.email') email,COUNT(m.id) unread FROM orders o JOIN customer_messages m ON m.order_id=o.id AND m.sender_role='customer' AND m.id>COALESCE((SELECT last_id FROM customer_message_reads r WHERE r.order_id=o.id AND r.reader_role='owner'),0) GROUP BY o.id ORDER BY max(m.id) DESC").all();return {threads:rows.results};}
export function customerPortalPage(){return new Response('<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>White Gloss · Mein Kundenpanel</title><link rel="stylesheet" href="/style.css"><main class="appoff card"><span class="brandmark">WG</span><h1>Mein Kundenpanel</h1><p>Deine Vorgänge, Termine, Dokumente und Nachrichten.</p><p><button id="portal-refresh" type="button">Aktualisieren</button> <button id="portal-reset" type="button">PIN erneuern</button> <button id="portal-logout" type="button">Abmelden</button></p><p id="portal-status" role="status"></p><div id="portal-orders"></div><section id="portal-chat" hidden><h2 id="portal-chat-title">Nachrichten</h2><button id="portal-chat-close" type="button">Zurück zu meinen Vorgängen</button><div id="portal-messages" aria-live="polite"></div><button id="portal-older" type="button" hidden>Ältere Nachrichten laden</button><form id="portal-message-form"><label>Deine Nachricht<textarea id="portal-message" maxlength="4000" required></textarea></label><button class="primary" type="submit">Nachricht senden</button></form></section><script type="module" src="/customer-portal.js"></script></main></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});}
