import {readFile} from 'node:fs/promises';
import {need,berlin} from '../src/domain.mjs';
import {invoicePaymentSummary} from '../src/invoice-payment.mjs';
import {getOrder,saveOrder,settings,claimJob} from '../src/worker.mjs';
import {paymentSchema} from './payment-ledger.mjs';
import {digest} from './auth.mjs';
import {letterhead} from './document-template.mjs';
import {wrapPDFText} from './pdf-layout.mjs';

const libraryURL=new URL('../dist/pdf/library.mjs',import.meta.url),maxPDFBytes=8*1024*1024;
export async function invoicePaymentSchema(env){
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS invoice_originals(invoice_id TEXT PRIMARY KEY,order_id TEXT NOT NULL,asset_id TEXT NOT NULL,hash TEXT NOT NULL,metadata TEXT NOT NULL,created_at TEXT NOT NULL)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS invoice_payment_documents(version TEXT PRIMARY KEY,invoice_id TEXT NOT NULL,order_id TEXT NOT NULL,asset_id TEXT NOT NULL,hash TEXT NOT NULL,snapshot TEXT NOT NULL,created_at TEXT NOT NULL)').run();
}
export async function invoicePaymentState(env,order){
  await paymentSchema(env);const rows=await env.DB.prepare('SELECT id,data FROM payment_records WHERE order_id=? ORDER BY id').bind(order.id).all();
  const records=rows.results.map(row=>{const record=JSON.parse(row.data);need(record.receivedConfirmed!==true||record.receivedConfirmedBy!=='owner'||record.id===row.id,'Zahlungsdatensatz ist nicht eindeutig.',409);return record;});
  return invoicePaymentSummary(order,records);
}
function validateInvoice(order,remote){need(remote?.id===order.invoice?.id&&remote.number===order.wg&&remote.currency==='EUR'&&remote.total_amount_cents===order.invoice.totalCents&&['unpaid','paid'].includes(remote.status),'Qonto-Rechnung gehört nicht eindeutig zu diesem Auftrag.',409);}
async function originalInvoice(env,order){
  await invoicePaymentSchema(env);const row=await env.DB.prepare('SELECT * FROM invoice_originals WHERE invoice_id=? AND order_id=?').bind(order.invoice?.id??'',order.id).first();need(row,'Originalrechnung noch nicht geprüft archiviert. Der Zahlungs-Vermerk wartet auf das tatsächliche Qonto-PDF.',409);
  const original=await env.BUCKET.get(row.asset_id);need(original&&digest(original.body)===row.hash,'Archiviertes Rechnungsoriginal fehlt oder wurde verändert.',409);return {row,bytes:original.body};
}
export async function archiveQontoInvoice(env,order,remote,providerJSON,headers){
  validateInvoice(order,remote);await invoicePaymentSchema(env);
  const previous=await env.DB.prepare('SELECT invoice_id FROM invoice_originals WHERE invoice_id=? AND order_id=?').bind(remote.id,order.id).first();if(previous)return originalInvoice(env,order);
  const config=await settings(env),hosts=typeof env.QONTO_INVOICE_PDF_HOSTS==='string'?env.QONTO_INVOICE_PDF_HOSTS.split(',').map(host=>host.trim().toLowerCase()).filter(Boolean):[];need(config.qontoDocumentLayoutApproved===true&&config.qontoDocumentLayoutEvidence&&hosts.length,'Geprüfter Qonto-PDF-Abruf und Downloadhost fehlen. Technische Deploykonfiguration QONTO_INVOICE_PDF_HOSTS erforderlich.',409);
  need(/^[a-f0-9-]{36}$/.test(remote.attachment_id??''),'Qonto-Rechnung enthält noch kein geprüft abrufbares Original-PDF.',409);
  const data=await providerJSON('https://thirdparty.qonto.com/v2/attachments/'+remote.attachment_id,{headers}),attachment=data.attachment;
  need(attachment?.id===remote.attachment_id&&attachment.file_content_type==='application/pdf','Qonto-Rechnungsanhang ist nicht eindeutig als PDF bestätigt.',502);
  const url=new URL(attachment.url),size=Number(attachment.file_size);need(url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&hosts.includes(url.hostname)&&Number.isSafeInteger(size)&&size>100&&size<=maxPDFBytes,'Qonto-PDF-Downloadhost oder Dateigröße nicht bestätigt.',409);
  // The temporary download URL is never returned or stored; provider credentials stay at Qonto.
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(20000)});need(response.ok&&response.headers.get('content-type')?.split(';')[0]==='application/pdf','Qonto-Original-PDF konnte nicht eindeutig gelesen werden.',502);
  const reader=response.body?.getReader();need(reader,'Qonto-PDF ist leer.',502);const chunks=[];let length=0;
  try{while(true){const item=await reader.read();if(item.done)break;length+=item.value.length;need(length<=maxPDFBytes,'Qonto-PDF überschreitet die Dateigrenze.',502);chunks.push(item.value);}}finally{await reader.cancel().catch(()=>{});}
  need(length===size,'Qonto-PDF ist unvollständig.',502);const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const {PDFDocument}=await import(libraryURL.href),doc=await PDFDocument.load(bytes);need(doc.getPageCount()>0&&doc.getPageCount()<=100,'Qonto-PDF enthält keine vollständig prüfbare Rechnung.',502);
  const assetId=crypto.randomUUID(),hash=digest(bytes),at=new Date().toISOString(),metadata={id:remote.id,number:remote.number,totalCents:remote.total_amount_cents,currency:remote.currency,attachmentId:remote.attachment_id,header:remote.header??null};await env.BUCKET.put(assetId,bytes,{httpMetadata:{contentType:'application/pdf'}});
  try{await env.DB.prepare('INSERT INTO invoice_originals VALUES(?,?,?,?,?,?)').bind(remote.id,order.id,assetId,hash,JSON.stringify(metadata),at).run();}catch(error){await env.BUCKET.delete(assetId);if(await env.DB.prepare('SELECT invoice_id FROM invoice_originals WHERE invoice_id=? AND order_id=?').bind(remote.id,order.id).first())return originalInvoice(env,order);throw error;}
  return originalInvoice(env,order);
}
export async function invoicePaymentVersions(env,orderId){
  await invoicePaymentSchema(env);const rows=await env.DB.prepare('SELECT version,created_at,snapshot FROM invoice_payment_documents WHERE order_id=? ORDER BY created_at,version').bind(orderId).all();return rows.results.map(row=>({version:row.version,at:row.created_at,header:JSON.parse(row.snapshot).payment.header}));
}
export async function invoicePaymentDocument(env,orderId,version=null){
  await invoicePaymentSchema(env);const order=await getOrder(env,orderId);need(order.invoice?.id,'Zugeordnete Rechnung fehlt.',409);
  const saved=version?await env.DB.prepare('SELECT * FROM invoice_payment_documents WHERE version=? AND order_id=?').bind(version,orderId).first():null;
  const filename=order.wg.replace(/[^A-Za-z0-9_-]/g,'_')+'-Rechnungskopie-Zahlungsvermerk.pdf';
  if(version){need(saved,'Diese Rechnungskopie wurde nicht für diesen Auftrag gespeichert.',404);const stored=await env.BUCKET.get(saved.asset_id);need(stored&&digest(stored.body)===saved.hash,'Gespeicherte Rechnungskopie fehlt oder wurde verändert.',409);return {bytes:stored.body,filename,version};}
  const original=await originalInvoice(env,order),payment=await invoicePaymentState(env,order);need(payment.receivedTotalCents>0&&payment.header,'Kein persönlich bestätigter Zahlungseingang für einen Rechnungsvermerk vorhanden.',409);
  need(payment.agreedTotalCents===order.invoice.totalCents,'Zahlungen und Originalrechnung haben unterschiedliche vereinbarte Beträge.',409);
  const snapshot={invoiceId:order.invoice.id,number:order.invoice.number,originalHash:original.row.hash,payment},fingerprint=digest(JSON.stringify(snapshot));
  const existing=await env.DB.prepare('SELECT version FROM invoice_payment_documents WHERE version=? AND order_id=?').bind(fingerprint,orderId).first();if(existing)return invoicePaymentDocument(env,orderId,fingerprint);
  const configuration=(await settings(env)).documentTemplate;need(configuration,'Rechnungsvermerk wartet auf freigegebenes echtes Briefpapier.',409);
  const {PDFDocument,rgb,fontkit}=await import(libraryURL.href),doc=await PDFDocument.create(),source=await PDFDocument.load(original.bytes);for(const page of await doc.copyPages(source,source.getPageIndices()))doc.addPage(page);
  // Original pages receive no overlay. This is a copy plus an explicitly separate invoice annotation.
  doc.registerFontkit(fontkit);const font=await doc.embedFont(await readFile(new URL('../dist/pdf/NotoSans.ttf',import.meta.url)),{subset:true}),background=await letterhead(env,doc,configuration),box=configuration.contentBox;
  let page,y=0;const newPage=()=>{page=doc.addPage([595.28,841.89]);background.draw(page);y=841.89-box.top-20;};const paragraph=(value,size=10)=>{for(const line of wrapPDFText(value,font,size,595.28-box.left-box.right)){if(y-size<box.bottom+20)newPage();page.drawText(line,{x:box.left,y,font,size,color:rgb(.08,.12,.19)});y-=size+6;}};
  const at=new Date().toISOString(),money=value=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(value/100);newPage();paragraph('Rechnungskopie',18);y-=12;paragraph('Rechnung '+order.invoice.number);y-=12;paragraph(payment.header,18);y-=12;paragraph('Rechnungsbetrag: '+money(payment.agreedTotalCents));
  if(!payment.fullyCashPaid){paragraph('Bestätigter Zahlungseingang: '+money(payment.receivedTotalCents));paragraph('Davon bar: '+money(payment.cashTotalCents));paragraph('Offen bei Erstellung dieser Kopie: '+money(payment.remainingCents));}
  if(payment.paidAt)paragraph('Vollständig bezahlt am: '+berlin(payment.paidAt));paragraph('Zahlungsstatus vom: '+berlin(at));y-=12;
  paragraph('Diese Kopie ergänzt die Originalrechnung um den persönlich bestätigten Zahlungseingang. Die Originalseiten und die Rechnungsnummer bleiben erhalten.');
  doc.setTitle('Rechnungskopie '+order.invoice.number+' · Zahlungs-Vermerk');doc.setAuthor(configuration.company.name);doc.setCreationDate(new Date(at));const bytes=await doc.save(),id=crypto.randomUUID(),hash=digest(bytes);await env.BUCKET.put(id,bytes,{httpMetadata:{contentType:'application/pdf'}});
  try{await env.DB.prepare('INSERT INTO invoice_payment_documents VALUES(?,?,?,?,?,?,?)').bind(fingerprint,order.invoice.id,orderId,id,hash,JSON.stringify(snapshot),at).run();}catch(error){await env.BUCKET.delete(id);if(await env.DB.prepare('SELECT version FROM invoice_payment_documents WHERE version=? AND order_id=?').bind(fingerprint,orderId).first())return invoicePaymentDocument(env,orderId,fingerprint);throw error;}
  return {bytes,filename,version:fingerprint};
}
export async function syncInvoicePayment(env,order,providerJSON,headers){
  const config=await settings(env);need(!order.synthetic&&config.qontoVerified===true&&config.numberAudit===true&&config.qontoDocumentLayoutApproved===true&&config.qontoDocumentLayoutEvidence,'Rechnungs-Zahlungsabgleich ist noch nicht freigegeben.',409);
  const payment=await invoicePaymentState(env,order);need(payment.receivedTotalCents>0,'Persönlich bestätigte Zahlung für den Rechnungsabgleich fehlt.',409);need(order.invoice?.totalCents===payment.agreedTotalCents,'Rechnung und bestätigter Zahlungsbetrag stimmen nicht überein.',409);
  const url='https://thirdparty.qonto.com/v2/client_invoices/'+order.invoice.id;let remote=(await providerJSON(url,{headers})).client_invoice;validateInvoice(order,remote);
  // Preserve the provider original before any status mutation.
  await archiveQontoInvoice(env,order,remote,providerJSON,headers);
  if(payment.fullyPaid&&remote.status!=='paid'){
    const job=await claimJob(env,order,'invoice-paid-'+order.invoice.id);need(job,'Qonto-Zahlungsstatus ungeklärt. Zuerst vorhandenen Anbieterstatus lesend abgleichen.',409);
    const paidAt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(payment.paidAt));let attempted=false;
    try{attempted=true;remote=(await providerJSON(url+'/mark_as_paid',{method:'POST',headers,body:JSON.stringify({paid_at:paidAt})})).client_invoice;validateInvoice(order,remote);need(remote.status==='paid'&&Number.isFinite(Date.parse(remote.paid_at))&&new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(remote.paid_at))===paidAt,'Qonto hat Zahlungsstatus und Zahlungsdatum nicht eindeutig bestätigt.',502);await env.DB.prepare("UPDATE jobs SET state='sent',provider_id=?,detail=NULL,updated_at=? WHERE id=?").bind(remote.id,new Date().toISOString(),job).run();}
    catch(error){await env.DB.prepare('UPDATE jobs SET state=?,detail=?,updated_at=? WHERE id=?').bind(attempted?'unknown':'failed','Qonto-Zahlungsstatus ungeklärt; keine automatische Wiederholung.',new Date().toISOString(),job).run();throw error;}
  }
  if(payment.fullyPaid&&remote.status==='paid')await env.DB.prepare("UPDATE jobs SET state='sent',provider_id=?,detail=NULL,updated_at=? WHERE order_id=? AND kind=? AND state IN ('pending','unknown')").bind(remote.id,new Date().toISOString(),order.id,'invoice-paid-'+order.invoice.id).run();
  const copy=await invoicePaymentDocument(env,order.id),current=await getOrder(env,order.id);current.invoice={...current.invoice,status:remote.status,paymentCopyVersion:copy.version,paymentCopy:{version:copy.version,header:payment.header,at:new Date().toISOString()}};current.invoicePayment={version:copy.version,header:payment.header,at:new Date().toISOString(),error:null};return saveOrder(env,current,current.version,'Rechnungs-Zahlungsstatus abgeglichen und Rechnungskopie mit Vermerk archiviert','provider');
}
