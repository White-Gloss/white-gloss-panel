import {customerDetail} from '../src/customers.mjs';
import {isMailJob} from '../src/website-intake.mjs';
import {paidCents} from '../src/domain.mjs';
const statuses={sent:'Vom Anbieter angenommen',delivered:'Zustellung vom Anbieter bestätigt',pending:'Versand angefordert',queued:'Versand angefordert',draft:'Nachricht erstellt',failed:'Versand fehlgeschlagen',unknown:'Status unbekannt',received:'Eingegangen',stored:'Im Kundenchat gespeichert',cancelled:'Versand abgebrochen',partial:'Teilweise vom Anbieter angenommen'};
const invoiceLabels={unpaid:'Offen',open:'Offen',paid:'Bezahlt',overdue:'Überfällig',draft:'Entwurf',canceled:'Storniert',cancelled:'Storniert',voided:'Storniert'};
function invoiceSummary(o){
 const invoice=o.invoice??o.invoiceDraft;if(!invoice)return null;
 let status=o.invoice?invoice.status:'draft';const totalCents=invoice.totalCents??o.offer?.totalCents??null;
 if(invoice.provider==='qonto'&&status==='unpaid'&&Number.isFinite(totalCents)){
  const open=o.invoiceInfo?.openCents??Math.max(0,totalCents-paidCents(o));
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  if(open===0)status='paid';else if(/^\d{4}-\d{2}-\d{2}$/.test(invoice.dueDate??'')&&invoice.dueDate<today)status='overdue';
 }
 return {number:invoice.number??o.wg,totalCents,status:invoiceLabels[status]??'Status unbekannt'};
}
const parse=value=>{try{return JSON.parse(value);}catch{return {};}};
const byDate=(a,b)=>String(b.at??'').localeCompare(String(a.at??''));
export function customerRecordModel({orders=[],requests=[],changes=[],messages=[],notes=[],tasks=[],history=[]}={}){
 const pending=[],internal=[...notes];
 const summaries=orders.map(o=>{
  for(const [i,n] of (o.notes??[]).entries()){internal.push({id:'order-note:'+o.id+':'+i,orderId:o.id,body:n.note??'',at:n.at});if(n.followUp&&!n.followUpDone)pending.push({id:'followup:'+o.id+':'+i,orderId:o.id,label:'Wiedervorlage',next:n.note??'Kundenbetreuung prüfen',at:n.followUp,tab:'notes'});}
  const documents=['offer','intake','return','invoice'].filter(kind=>o[kind]||o.pending?.[kind]).map(kind=>({kind,signed:Boolean(kind==='offer'?o.acceptance?.signature:o[kind]?.customerSignature),present:Boolean(o[kind]),pending:Boolean(o.pending?.[kind]),at:o[kind]?.signedAt??o[kind]?.savedAt??o[kind]?.issueDate??null}));
  for(const document of documents)if(document.pending||document.kind==='offer'&&o.status==='Angebot offen'&&!o.acceptance)pending.push({id:'signature:'+o.id+':'+document.kind,orderId:o.id,label:'Unterschrift offen',next:document.kind==='offer'?'Angebotsannahme prüfen':'Dokumentunterschrift prüfen',tab:document.kind==='offer'?'price':document.kind,at:o.updatedAt});
  return {id:o.id,wg:o.wg,status:o.status,vehicle:o.source?.vehicle??'',plate:o.source?.plate??'',appointment:o.appointment&&!['Storniert','Abgelehnt','Abgelaufen'].includes(o.status)?{start:o.appointment.start,end:o.appointment.end,confirmed:Boolean(o.appointment.confirmation&&typeof o.appointment.confirmation==='object'&&!Array.isArray(o.appointment.confirmation))}:null,documents,offerCents:o.offer?.totalCents??null,invoice:invoiceSummary(o),photoCount:o.photoCount??0};
 });
 for(const request of requests)if(request.status==='offen')pending.push({id:'request:'+request.id,orderId:request.order_id,label:request.kind==='termin'?'Termin passt nicht':'Zusatzleistung angefragt',next:request.kind==='termin'?'Terminwunsch prüfen':'Zusatzleistung prüfen',tab:request.kind==='termin'?'price':'source',at:request.created_at});
 for(const request of changes)if(request.status==='offen')pending.push({id:'change:'+request.id,orderId:request.order_id,label:'Offener Kundenwunsch',next:'Angaben / Übergabewunsch prüfen',tab:'source',at:request.created_at});
 for(const task of tasks)if(!task.done)pending.push({id:'mail-task:'+task.id,orderId:task.order_id,label:task.title,next:'Aufgabe im Communication Center prüfen',tab:'notes',at:task.due_date??task.created_at});
 for(const message of messages)if(message.unread&&!(message.portalNotice&&[...requests,...changes].some(r=>r.status==='offen'&&r.order_id===message.orderId&&r.created_at===message.at)))pending.push({id:'unread:'+message.orderId,orderId:message.orderId,label:'Neue Kundenchatnachricht',next:'Kundenchat öffnen und antworten',tab:'notes',at:message.at});
 return {orders:summaries,tasks:[...new Map(pending.map(item=>[item.id,item])).values()].sort(byDate),messages:[...new Map(messages.map(m=>[m.channel+':'+m.id+':'+(m.orderId??'customer'),{id:m.id,orderId:m.orderId??null,channel:m.channel,body:m.body??'',subject:m.subject??'',at:m.at??null,status:statuses[m.state]??'Status unbekannt',direction:m.direction??null}])).values()].sort(byDate),notes:internal.sort(byDate),history:history.sort(byDate)};
}

export async function readCustomerRecord(env,id){
 const base=await customerDetail(env,id),synthetic=Number(base.customer.synthetic);
 const rows=(await env.DB.prepare("SELECT o.*, (SELECT count(*) FROM order_media m WHERE m.order_id=o.id) photo_count FROM orders o JOIN customer_orders l ON l.order_id=o.id WHERE l.customer_id=? AND o.synthetic=? AND json_extract(o.data,'$.trash.deletedAt') IS NULL ORDER BY o.updated_at DESC LIMIT 500").bind(id,synthetic).all()).results;
 const orders=rows.map(row=>({...parse(row.data),id:row.id,wg:row.wg,status:row.status,photoCount:row.photo_count})),ids=orders.map(o=>o.id),marks=ids.map(()=>'?').join(',');
 const query=async(sql,args=ids)=>(await env.DB.prepare(sql).bind(...args).all()).results;
 const requests=ids.length?await query('SELECT * FROM portal_requests WHERE order_id IN ('+marks+')'):[];
 const changes=ids.length?await query('SELECT * FROM portal_change_requests WHERE order_id IN ('+marks+')'):[];
 const chat=ids.length?await query("SELECT m.id,t.order_id,m.sender,m.body,m.client_id,m.created_at, m.sender='customer' AND m.id>t.owner_read_id AS unread FROM chat_messages m JOIN chat_threads t ON t.id=m.thread_id WHERE t.order_id IN ("+marks+') ORDER BY m.id DESC LIMIT 100'):[];
 const jobs=ids.length?await query('SELECT * FROM jobs WHERE order_id IN ('+marks+') ORDER BY created_at DESC LIMIT 100'):[];
 const whatsapp=ids.length?await query('SELECT DISTINCT m.id,a.order_id,m.body,m.sent_at FROM whatsapp_messages m JOIN whatsapp_media_assignments a ON a.message_id=m.id WHERE a.order_id IN ('+marks+') AND m.synthetic=? ORDER BY m.sent_at DESC LIMIT 100',[...ids,synthetic]):[];
 const email=String(base.customer.email??'').trim().toLowerCase();
 const mail=await query(`SELECT m.id,m.direction,m.subject,m.text_body,m.received_at,d.status,l.order_id FROM mail_messages m LEFT JOIN mail_deliveries d ON d.message_id=m.id LEFT JOIN mail_order_links l ON l.message_id=m.id WHERE m.synthetic=? AND ((${ids.length?'l.order_id IN ('+marks+')':'0'}) OR (l.message_id IS NULL AND ?<>'' AND (lower(trim(m.from_address))=? OR EXISTS(SELECT 1 FROM json_each(m.to_json) recipient WHERE lower(trim(json_extract(recipient.value,'$.address')))=?)))) ORDER BY m.received_at DESC LIMIT 100`,[synthetic,...ids,email,email,email]);
 const notes=await query('SELECT id,order_id,body,created_at FROM mail_notes WHERE synthetic=? AND (customer_id=?'+(ids.length?' OR order_id IN ('+marks+')':'')+') ORDER BY created_at DESC LIMIT 100',[synthetic,id,...ids]);
 const tasks=ids.length?await query('SELECT * FROM mail_tasks WHERE order_id IN ('+marks+') AND synthetic=? ORDER BY created_at DESC LIMIT 100',[...ids,synthetic]):[];
 const history=ids.length?await query('SELECT order_id,at,action,status FROM audit WHERE order_id IN ('+marks+') ORDER BY at DESC LIMIT 100'):[];
 const messages=[...chat.map(m=>({id:String(m.id),orderId:m.order_id,channel:'Kundenchat',body:m.body,at:m.created_at,state:'stored',direction:m.sender,unread:Boolean(m.unread),portalNotice:String(m.client_id).startsWith('portal-')})),...jobs.filter(j=>isMailJob(j.kind)).map(j=>({id:j.id,orderId:j.order_id,channel:'Transaktionsmail',subject:j.kind,at:j.updated_at,state:j.state,direction:'outbound'})),...mail.map(m=>({id:m.id,orderId:ids.includes(m.order_id)?m.order_id:null,channel:'E-Mail',subject:m.subject,body:m.text_body.slice(0,1000),at:m.received_at,state:m.direction==='INBOUND'?'received':String(m.status??'unknown').toLowerCase(),direction:m.direction})),...whatsapp.map(m=>({id:m.id,orderId:m.order_id,channel:'WhatsApp',body:m.body,at:m.sent_at,state:'received',direction:'inbound'}))];
 return {...base,record:customerRecordModel({orders,requests,changes,messages,notes:notes.map(n=>({id:n.id,orderId:n.order_id,body:n.body,at:n.created_at})),tasks,history:history.map(h=>({orderId:h.order_id,at:h.at,action:h.action,status:h.status}))}),limits:{orders:500,messagesPerChannel:100,history:100}};
}

