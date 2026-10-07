import {readFile} from 'node:fs/promises';
import {need,berlin} from '../src/domain.mjs';
import {setting,settings} from '../src/worker.mjs';
import {digest} from './auth.mjs';
import {paymentRecord} from './payment-ledger.mjs';
import {wrapPDFText} from './pdf-layout.mjs';

const libraryURL=new URL('../dist/pdf/library.mjs',import.meta.url);
export async function templateSchema(env){
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS document_templates(id TEXT PRIMARY KEY,hash TEXT NOT NULL,configuration TEXT NOT NULL,created_at TEXT NOT NULL)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS payment_documents(payment_id TEXT PRIMARY KEY,order_id TEXT NOT NULL,asset_id TEXT NOT NULL,hash TEXT NOT NULL,template_id TEXT NOT NULL,created_at TEXT NOT NULL)').run();
}
export async function registerTemplate(env,input){
  need(input.approved===true&&input.blankLetterheadConfirmed===true,'Das echte leere Briefpapier muss ausdrücklich bestätigt sein.',409);
  need(typeof input.evidence==='string'&&input.evidence.trim(),'Freigabenachweis für das Briefpapier fehlt.');
  const bytes=Uint8Array.from(Buffer.from(input.pdfBase64??'','base64'));need(bytes.length>100&&bytes.length<=2*1024*1024,'Briefpapier muss eine PDF bis 2 MB sein.');
  const {PDFDocument}=await import(libraryURL.href),doc=await PDFDocument.load(bytes);need(doc.getPageCount()===1,'Einseitiges leeres Briefpapier erforderlich.');
  const {width,height}=doc.getPage(0).getSize();need(Math.abs(width-595.28)<8&&Math.abs(height-841.89)<8,'Briefpapier muss A4 im Hochformat sein.');
  const box=input.contentBox;need(box&&['left','right','top','bottom'].every(key=>Number.isFinite(box[key])&&box[key]>=24),'Geprüfte Inhaltsränder in PDF-Punkten fehlen.');
  need(width-box.left-box.right>=250&&height-box.top-box.bottom>=300,'Briefpapier lässt zu wenig Platz für Inhalte.');
  const company=input.company;need(company&&['name','street','city','email'].every(key=>typeof company[key]==='string'&&company[key].trim()&&company[key].length<=300),'Bestätigte Ausstellerdaten fehlen.');
  await templateSchema(env);const id=crypto.randomUUID(),hash=digest(bytes),at=new Date().toISOString();
  const configuration={id,hash,contentBox:box,company,evidence:input.evidence.trim(),approvedAt:at};
  await env.BUCKET.put(id,bytes,{httpMetadata:{contentType:'application/pdf'}});
  try{await env.DB.prepare('INSERT INTO document_templates VALUES(?,?,?,?)').bind(id,hash,JSON.stringify(configuration),at).run();await setting(env,'documentTemplate',configuration);}catch(error){await env.BUCKET.delete(id);throw error;}
  return configuration;
}
export async function letterhead(env,doc,configuration){
  need(configuration?.id&&configuration.hash,'Freigegebenes echtes Briefpapier fehlt.',409);
  await templateSchema(env);const row=await env.DB.prepare('SELECT hash,configuration FROM document_templates WHERE id=?').bind(configuration.id).first();
  need(row&&row.hash===configuration.hash&&row.configuration===JSON.stringify(configuration),'Briefpapierfreigabe stimmt nicht mit dem gespeicherten Original überein.',409);
  const original=await env.BUCKET.get(configuration.id);need(original&&digest(original.body)===configuration.hash,'Originalbriefpapier fehlt oder wurde verändert.',409);
  const [background]=await doc.embedPdf(original.body);return {configuration,draw(page){page.drawPage(background,{x:0,y:0,width:595.28,height:841.89});}};
}
export async function paymentDocument(env,orderId,paymentId){
  await templateSchema(env);const previous=await env.DB.prepare('SELECT * FROM payment_documents WHERE payment_id=? AND order_id=?').bind(paymentId,orderId).first();
  const snapshot=await paymentRecord(env,orderId,paymentId),filename=snapshot.wg.replace(/[^A-Za-z0-9_-]/g,'_')+'-'+snapshot.documentType+'-'+paymentId.slice(0,8)+'.pdf';
  if(previous){const stored=await env.BUCKET.get(previous.asset_id);need(stored&&digest(stored.body)===previous.hash,'Gespeicherter Zahlungsnachweis ist nicht vollständig.',409);return {bytes:stored.body,filename};}
  const configuration=(await settings(env)).documentTemplate;need(configuration,'Zahlung gespeichert. Dokument wartet auf freigegebenes echtes Briefpapier.',409);
  const {PDFDocument,rgb,fontkit}=await import(libraryURL.href),doc=await PDFDocument.create();doc.registerFontkit(fontkit);
  const font=await doc.embedFont(await readFile(new URL('../dist/pdf/NotoSans.ttf',import.meta.url)),{subset:true}),background=await letterhead(env,doc,configuration),box=configuration.contentBox;
  const ink=rgb(.08,.12,.19),grey=rgb(.35,.4,.46);let page,y=0;const width=595.28-box.left-box.right;
  const newPage=()=>{page=doc.addPage([595.28,841.89]);background.draw(page);y=841.89-box.top-20;};
  const paragraph=(value,size=10)=>{for(const line of wrapPDFText(value,font,size,width)){if(y-size<box.bottom+20)newPage();page.drawText(line,{x:box.left,y,font,size,color:ink});y-=size+6;}};
  newPage();paragraph(snapshot.documentType,20);y-=12;paragraph('Auftrag '+snapshot.wg);paragraph('Kunde: '+snapshot.customer);paragraph('Aussteller: '+configuration.company.name);paragraph(configuration.company.street+' · '+configuration.company.city);y-=12;
  const money=value=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(value/100);
  paragraph('Eingegangener Betrag: '+money(snapshot.amountCents),14);
  paragraph('Zahlungsart: '+snapshot.method);paragraph('Zahlungszeitpunkt (Europe/Berlin): '+berlin(snapshot.at));paragraph('Originalbeleg / Zahlungsreferenz: '+snapshot.reference);if(snapshot.invoiceNumber)paragraph('Zugehörige Rechnung: '+snapshot.invoiceNumber);
  y-=12;paragraph('Leistungen:');paragraph(snapshot.services);y-=12;
  paragraph('Hiermit bestätigen wir den Eingang des oben genannten Betrags für die aufgeführten Leistungen.');
  if(Number.isSafeInteger(snapshot.remainingCents)){paragraph('Zahlung erfasst (Europe/Berlin): '+berlin(snapshot.recordedAt));paragraph('Offener Auftragsbetrag bei dieser Zahlungserfassung: '+money(snapshot.remainingCents));if(snapshot.amountCents<snapshot.agreedTotalCents)paragraph(snapshot.documentType==='Quittung'?'Diese Quittung bestätigt eine Teilzahlung.':'Dieser Zahlungsnachweis bestätigt eine Teilzahlung. Die Zahlung ist durch den zugeordneten Originalbeleg dokumentiert.');}
  if(snapshot.method!=='Bar')paragraph('Der originale Bank- oder Terminalbeleg bleibt der Zahlungsreferenz zugeordnet.');
  paragraph('Dieser Beleg bestätigt den Zahlungseingang und ersetzt keine Rechnung.');if(snapshot.method==='Bar'){y-=12;paragraph('Empfang schriftlich bestätigt:');paragraph('Datum: ____________________  Unterschrift Betrieb: ____________________');}
  const pages=doc.getPages();pages.forEach((p,i)=>p.drawText(snapshot.wg+' · '+snapshot.documentType+' · '+(i+1)+'/'+pages.length,{x:box.left,y:box.bottom+2,font,size:8,color:grey}));
  doc.setTitle(snapshot.documentType+' '+snapshot.wg);doc.setAuthor(configuration.company.name);doc.setCreationDate(new Date(snapshot.recordedAt));
  const bytes=await doc.save(),id=crypto.randomUUID(),hash=digest(bytes);await env.BUCKET.put(id,bytes,{httpMetadata:{contentType:'application/pdf'}});
  try{await env.DB.prepare('INSERT INTO payment_documents VALUES(?,?,?,?,?,?)').bind(paymentId,orderId,id,hash,configuration.id,new Date().toISOString()).run();}
  catch(error){await env.BUCKET.delete(id);const winner=await env.DB.prepare('SELECT payment_id FROM payment_documents WHERE payment_id=? AND order_id=?').bind(paymentId,orderId).first();if(winner)return paymentDocument(env,orderId,paymentId);throw error;}
  return {bytes,filename};
}
export async function documentEndpoint(env,request){
  const url=new URL(request.url);
  if(url.pathname==='/api/payment/pdf'&&request.method==='GET'){const pdf=await paymentDocument(env,url.searchParams.get('id'),url.searchParams.get('payment'));return new Response(pdf.bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+pdf.filename+'"'}});}
  if(url.pathname!=='/api/document-template')return null;
  if(request.method==='GET')return Response.json({template:(await settings(env)).documentTemplate??null});
  need(request.method==='POST','Methode nicht erlaubt.',405);need(request.headers.get('origin')===env.PANEL_ORIGIN&&request.headers.get('content-type')?.startsWith('application/json'),'Ungültiger Ursprung oder Inhalt.',403);
  const raw=await request.text();need(raw.length<3*1024*1024,'Briefpapierdatei ist zu groß.',413);return Response.json(await registerTemplate(env,JSON.parse(raw)));
}
