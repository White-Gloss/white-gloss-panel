import {readFile} from 'node:fs/promises';
import {AppError,need,text,berlin} from '../src/domain.mjs';
import {getOrder} from '../src/worker.mjs';
import {digest} from './auth.mjs';
import {indexCustomerFiles} from './customer-files.mjs';
import {wrapPDFText} from './pdf-layout.mjs';
import {customerAccessResolve} from '../src/customer-access.mjs';

export const PHOTO_TEMPLATES=[
  {id:'exterior',label:'Außenpflege',motifs:['Front schräg','Heck schräg','Fahrerseite','Beifahrerseite','Felge und Reifen']},
  {id:'interior',label:'Innenpflege',motifs:['Cockpit','Vordersitze','Rückbank','Fußraum','Kofferraum']},
  {id:'paint',label:'Lackpflege / Versiegelung',motifs:['Motorhaube im Streiflicht','Tür im Streiflicht','Dach','Detailstelle']},
  {id:'detail',label:'Einzelleistung',motifs:['Gesamtansicht','Betroffene Stelle','Detail aus gleicher Perspektive']}
];
export const PUBLICATION_PURPOSES=['Website','Soziale Medien','Druckwerbung'];
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const normalize=value=>String(value??'').trim().toLowerCase();
const blank=()=>({entries:[],completedServices:'',completionConfirmedAt:null,customerReleased:false,grants:[],masks:{}});

export async function resultReportsSchema(env){
  await env.DB.batch([
    'CREATE TABLE IF NOT EXISTS result_reports(order_id TEXT PRIMARY KEY REFERENCES orders(id),version INTEGER NOT NULL,data TEXT NOT NULL,updated_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS result_mask_previews(id TEXT PRIMARY KEY REFERENCES assets(id),order_id TEXT NOT NULL REFERENCES orders(id),original_id TEXT NOT NULL REFERENCES assets(id),source_hash TEXT NOT NULL,hash TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS result_reports_guard(value INTEGER NOT NULL CHECK(value=1))'
  ].map(sql=>env.DB.prepare(sql)));
}

async function context(env,id){
  const order=await getOrder(env,id),row=await env.DB.prepare('SELECT * FROM result_reports WHERE order_id=?').bind(id).first();
  const link=await env.DB.prepare('SELECT f.*,c.data AS customer_data FROM order_files f JOIN customer_files c ON c.id=f.customer_id WHERE order_id=?').bind(id).first();
  const data=row?JSON.parse(row.data):blank();
  return {order,link,row,data,version:row?.version??0};
}
function linked(c){return c.link&&(!c.row||c.data.vehicleId===c.link.vehicle_id&&c.data.customerId===c.link.customer_id);}
function restricted(c){return ['blocked','anonymized'].includes(c.order.recordsRestriction?.status)||['blocked','anonymized'].includes(JSON.parse(c.link?.customer_data??'{}').lifecycle?.status);}
async function customerAllowed(env,c,identity){return linked(c)&&!restricted(c)&&c.data.customerReleased===true&&(await customerAccessResolve(env,c.order,identity,'read-report')).allowed;}
async function original(env,orderId,id){
  const row=await env.DB.prepare("SELECT * FROM assets WHERE id=? AND order_id=? AND kind IN ('photo','booking')").bind(id,orderId).first();
  need(row&&['image/jpeg','image/png','image/webp'].includes(row.mime),'Originalbild fehlt oder gehört zu einem anderen Auftrag.',404);
  const file=await env.BUCKET.get(id);need(file&&digest(file.body)===row.hash,'Originalbild fehlt oder ist nicht mehr vollständig gespeichert.',409);
  return {...row,bytes:new Uint8Array(file.body)};
}
function customerDTO(c){
  const prefix='/api/customer/result-report',query='?id='+encodeURIComponent(c.order.id);
  return {orderId:c.order.id,wg:c.order.wg,vehicle:c.data.vehicle,version:c.version,updatedAt:c.row.updated_at,completedServices:c.data.completedServices,completionConfirmedAt:c.data.completionConfirmedAt,entries:c.data.entries.filter(e=>e.customerVisible).map(e=>({assetId:e.assetId,phase:e.phase,motif:e.motif,template:e.template,url:prefix+'/asset'+query+'&asset='+encodeURIComponent(e.assetId)})),pdfUrl:prefix+'/pdf'+query};
}
// Read-only allowlist for the existing customer portal; never exposes grant evidence or internal notes.
export async function customerResultReports(env,order,identity){
  const c=await context(env,order.id);return await customerAllowed(env,c,identity)?customerDTO(c):null;
}
async function ownerDTO(env,c){
  const assets=(await env.DB.prepare("SELECT id,mime,hash,created_at FROM assets WHERE order_id=? AND kind IN ('photo','booking') ORDER BY created_at").bind(c.order.id).all()).results;
  const previews=new Set(Object.values(c.order.intake?.photoPreviews??{}).concat(Object.values(c.order.return?.photoPreviews??{})));
  const completedReturn=c.order.return?.signaturesConfirmed===true&&['Erledigt','Bezahlt'].includes(c.order.status)?text(c.order.return.services,6000):'',completedSteps=(c.order.projectDetails?.workSteps??[]).filter(s=>s.done===true).map(s=>text(s.title,300)).filter(Boolean).join('\n');
  const serviceSuggestion=!c.data.completedServices&&(completedReturn||completedSteps)?{text:completedReturn||text(completedSteps,6000),source:completedReturn?'unterschriebenem Rückgabeprotokoll':'als erledigt markierten Arbeitsschritten'}:null;
  return {orderId:c.order.id,orderVersion:c.order.version,version:c.version,vehicle:c.order.source.vehicle,wg:c.order.wg,linked:!!linked(c),...c.data,serviceSuggestion,assets:assets.filter(a=>!previews.has(a.id)).map(a=>({...a,url:'/api/asset/'+a.id})),templates:PHOTO_TEMPLATES,purposes:PUBLICATION_PURPOSES,pdfUrl:'/api/result-reports/pdf?id='+encodeURIComponent(c.order.id)};
}
async function save(env,c,data,action){
  const now=new Date().toISOString(),snapshot={...data,customerId:c.link.customer_id,vehicleId:c.link.vehicle_id,vehicle:c.order.source.vehicle};
  const statements=[...guardStatements(env,c),
    env.DB.prepare('INSERT INTO result_reports(order_id,version,data,updated_at) VALUES(?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET version=excluded.version,data=excluded.data,updated_at=excluded.updated_at').bind(c.order.id,c.version+1,JSON.stringify(snapshot),now),
    env.DB.prepare('INSERT INTO file_audit(at,entity_id,action,data) VALUES(?,?,?,?)').bind(now,c.order.id,action,JSON.stringify({version:c.version+1,before:c.data,after:snapshot}))
  ];
  await guardedBatch(env,statements);
  return ownerDTO(env,await context(env,c.order.id));
}
function guardStatements(env,c){return [
    env.DB.prepare("INSERT INTO result_reports_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM orders o JOIN order_files f ON f.order_id=o.id JOIN customer_files cf ON cf.id=f.customer_id WHERE o.id=? AND o.version=? AND f.vehicle_id=? AND f.customer_id=? AND COALESCE(json_extract(o.data,'$.recordsRestriction.status'),'active') NOT IN ('blocked','anonymized') AND COALESCE(json_extract(cf.data,'$.lifecycle.status'),'active') NOT IN ('blocked','anonymized')) AND COALESCE((SELECT version FROM result_reports WHERE order_id=?),0)=? THEN 1 ELSE 0 END").bind(c.order.id,c.order.version,c.link.vehicle_id,c.link.customer_id,c.order.id,c.version),
    env.DB.prepare('DELETE FROM result_reports_guard')
  ];}
async function guardedBatch(env,statements){
  try{await env.DB.batch(statements);}catch(error){if(/result_reports_guard|CHECK constraint failed/.test(error.message))throw new AppError('Auftrag oder Bericht wurde inzwischen geändert. Bitte neu laden.',409);throw error;}
}
async function boundedInput(request){
  need(request.headers.get('content-type')?.startsWith('application/json'),'JSON-Eingabe erforderlich.',415);
  const reader=request.body?.getReader();need(reader,'Eingabe fehlt.');const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>60000){await reader.cancel();throw new AppError('Eingabe zu groß.',413);}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  try{const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));need(input&&typeof input==='object'&&!Array.isArray(input),'Ungültige Eingabe.');return input;}catch(error){if(error instanceof AppError)throw error;throw new AppError('Ungültige Eingabe.',400);}
}
function validateMasks(input){
  need(Array.isArray(input.rectangles)&&input.rectangles.length<=20,'Kennzeichenbereiche fehlen oder sind ungültig.');
  need(input.rectangles.length>0||input.noPlateVisible===true,'Mindestens ein Kennzeichenbereich oder die geprüfte Feststellung „kein Kennzeichen sichtbar“ ist erforderlich.');
  return input.rectangles.map(r=>{need(r&&['x','y','width','height'].every(key=>typeof r[key]==='number'&&Number.isFinite(r[key]))&&r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=1.000001&&r.y+r.height<=1.000001,'Kennzeichenbereich liegt außerhalb des Bildes.');return {x:r.x,y:r.y,width:r.width,height:r.height};});
}
export async function flattenedMaskedImage(bytes,rectangles){
  const {default:sharp}=await import('sharp');
  // Decode, apply EXIF orientation, then write fresh pixel data without EXIF or an embedded original.
  const {data,info}=await sharp(bytes,{limitInputPixels:40000000}).rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(const r of rectangles){const x1=Math.floor(r.x*info.width),y1=Math.floor(r.y*info.height),x2=Math.min(info.width,Math.ceil((r.x+r.width)*info.width)),y2=Math.min(info.height,Math.ceil((r.y+r.height)*info.height));for(let y=y1;y<y2;y++)for(let x=x1;x<x2;x++){const i=(y*info.width+x)*4;data[i]=data[i+1]=data[i+2]=0;data[i+3]=255;}}
  return sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
}
async function maskPreview(env,c,input){
  const asset=await original(env,c.order.id,input.assetId),rectangles=validateMasks(input),bytes=await flattenedMaskedImage(asset.bytes,rectangles),id=crypto.randomUUID(),hash=digest(bytes),at=new Date().toISOString();
  need(bytes.byteLength<=20*1024*1024,'Maskierte Aufnahme ist zu groß.',413);
  await env.BUCKET.put(id,bytes,{httpMetadata:{contentType:'image/png'}});
  try{await guardedBatch(env,[...guardStatements(env,c),
    env.DB.prepare("INSERT INTO assets VALUES(?,?,'advertising-mask','image/png',?,?,?)").bind(id,c.order.id,hash,bytes.byteLength,at),
    env.DB.prepare('INSERT INTO result_mask_previews VALUES(?,?,?,?,?,?,?)').bind(id,c.order.id,asset.id,asset.hash,hash,JSON.stringify({rectangles,noPlateVisible:input.noPlateVisible===true}),at)
  ]);}catch(error){await env.BUCKET.delete(id);throw error;}
  return {previewId:id,hash,originalHash:asset.hash,url:'/api/result-reports/mask?id='+encodeURIComponent(c.order.id)+'&preview='+id};
}
function activeGrant(data,assetId,purpose){return data.grants.some(g=>g.assetId===assetId&&g.purpose===purpose&&!g.revokedAt);}
async function maskedAsset(env,c,assetId,purpose){
  need(PUBLICATION_PURPOSES.includes(purpose)&&activeGrant(c.data,assetId,purpose),'Für dieses Bild und diesen Verwendungszweck fehlt eine gültige Werbefreigabe.',403);
  const source=await original(env,c.order.id,assetId),mask=c.data.masks[assetId];need(c.data.grants.some(g=>g.assetId===assetId&&g.purpose===purpose&&!g.revokedAt&&g.sourceHash===source.hash),'Werbefreigabe gehört nicht mehr zum unveränderten Original.',403);need(mask?.reviewedAt&&mask.sourceHash===source.hash,'Kennzeichenmaskierung zuerst anhand der Vorschau prüfen und bestätigen.',409);
  const row=await env.DB.prepare('SELECT * FROM result_mask_previews WHERE id=? AND order_id=? AND original_id=?').bind(mask.previewId,c.order.id,assetId).first();need(row&&row.hash===mask.hash&&row.source_hash===source.hash,'Maskierungsnachweis fehlt.',409);
  const file=await env.BUCKET.get(row.id);need(file&&digest(file.body)===mask.hash,'Maskiertes Bild fehlt oder wurde verändert.',409);return {bytes:file.body,hash:mask.hash};
}
export async function resultReportsEndpoint(env,request,identity){
  const url=new URL(request.url),isCustomer=url.pathname.startsWith('/api/customer/result-report'),prefix=isCustomer?'/api/customer/result-report':'/api/result-reports';
  if(!isCustomer&&!url.pathname.startsWith(prefix))return null;
  need([prefix,prefix+'/pdf',prefix+'/asset',prefix+'/mask',prefix+'/export'].includes(url.pathname),'Nicht gefunden.',404);
  const owner=digest(normalize(identity))===env.OWNER_EMAIL_SHA256;
  need(owner||isCustomer,'Nur der Betreiber kann Bildberichte und Freigaben verwalten.',403);
  need(!isCustomer||request.method==='GET','Kundenberichte können hier nur gelesen werden.',405);
  need(['GET','POST'].includes(request.method),'Methode nicht erlaubt.',405);
  if(request.method==='POST')need(request.headers.get('origin')===env.PANEL_ORIGIN,'Ungültiger Ursprung.',403);
  const id=url.searchParams.get('id');need(uuid(id),'Auftrag fehlt.');
  // Indexing is an existing operator-only customer-file operation; customer reads never create records.
  if(owner&&!isCustomer)await indexCustomerFiles(env);
  const c=await context(env,id);
  if(isCustomer)need(await customerAllowed(env,c,identity),'Bericht nicht gefunden.',404);
  else need(linked(c),'Die Fahrzeugzuordnung hat sich geändert. Bericht darf nicht auf eine andere Fahrzeugakte übertragen werden.',409);
  if(request.method==='GET'){
    if(url.pathname===prefix)return Response.json(isCustomer?customerDTO(c):await ownerDTO(env,c));
    if(url.pathname===prefix+'/pdf'){
      need(c.data.completedServices&&c.data.entries.length,'Ergebnisbericht zuerst speichern.',409);
      const bytes=await resultReportPDF(env,c,isCustomer),latest=await context(env,id);need(latest.version===c.version&&linked(latest)&&(!isCustomer||await customerAllowed(env,latest,identity)),'Berichtsfreigabe oder Fahrzeugzuordnung wurde inzwischen geändert.',409);return new Response(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+c.order.wg.replace(/[^A-Za-z0-9_-]/g,'_')+'-Ergebnisbericht.pdf"'}});
    }
    if(url.pathname===prefix+'/asset'){
      const assetId=url.searchParams.get('asset');need(!isCustomer||c.data.entries.some(e=>e.assetId===assetId&&e.customerVisible),'Bild nicht freigegeben.',404);
      const asset=await original(env,id,assetId),latest=await context(env,id);need(!isCustomer||latest.version===c.version&&await customerAllowed(env,latest,identity)&&c.data.entries.some(e=>e.assetId===assetId&&e.originalHash===asset.hash),'Bildfreigabe oder Originalnachweis wurde inzwischen geändert.',409);return new Response(asset.bytes,{headers:{'Content-Type':asset.mime}});
    }
    need(owner&&!isCustomer,'Nicht gefunden.',404);
    if(url.pathname===prefix+'/mask'){
      const mask=await env.DB.prepare('SELECT * FROM result_mask_previews WHERE id=? AND order_id=?').bind(url.searchParams.get('preview'),id).first();need(mask,'Vorschau fehlt.',404);
      const file=await env.BUCKET.get(mask.id);need(file&&digest(file.body)===mask.hash,'Vorschau unvollständig.',409);return new Response(file.body,{headers:{'Content-Type':'image/png'}});
    }
    need(!restricted(c)&&!['Storniert','Abgelehnt'].includes(c.order.status),'Für gesperrte oder stornierte Vorgänge ist kein Werbeexport möglich.',409);
    const image=await maskedAsset(env,c,url.searchParams.get('asset'),url.searchParams.get('purpose')),latest=await context(env,id);
    need(latest.version===c.version&&linked(latest)&&!restricted(latest)&&!['Storniert','Abgelehnt'].includes(latest.order.status),'Bildfreigabe oder Auftrag wurde inzwischen geändert. Export gesperrt.',409);
    return new Response(image.bytes,{headers:{'Content-Type':'image/png','Content-Disposition':'attachment; filename="White-Gloss-Werbebild-'+image.hash.slice(0,12)+'.png"'}});
  }
  need(url.pathname===prefix,'Methode nicht erlaubt.',405);need(!restricted(c),'Gesperrte Aufträge können keine neuen Bildfreigaben erhalten.',409);
  const input=await boundedInput(request);need(input.version===c.version&&input.orderVersion===c.order.version,'Ansicht veraltet. Bitte neu laden.',409);
  const data=structuredClone(c.data),now=new Date().toISOString();
  if(input.action==='save'){
    need(Array.isArray(input.entries)&&input.entries.length<=30,'Höchstens 30 Bilder pro Bericht.');
    const used=new Set();data.entries=[];
    for(const e of input.entries){need(e&&!used.has(e.assetId)&&['before','after'].includes(e.phase)&&PHOTO_TEMPLATES.some(t=>t.id===e.template)&&text(e.motif,160),'Bild, Perspektive oder Zuordnung fehlen.');used.add(e.assetId);const asset=await original(env,id,e.assetId);data.entries.push({assetId:asset.id,originalHash:asset.hash,phase:e.phase,motif:text(e.motif,160),template:e.template,customerVisible:e.customerVisible===true});}
    data.completedServices=text(input.completedServices,6000);need(!data.completedServices||input.completionConfirmed===true,'Tatsächlich erledigte Leistungen bitte ausdrücklich bestätigen.');
    data.completionConfirmedAt=data.completedServices?now:null;data.customerReleased=input.customerReleased===true;
    if(data.customerReleased)need(data.completedServices&&data.entries.some(e=>e.customerVisible)&&input.customerReleaseConfirmed===true,'Kundenbericht benötigt erledigte Leistungen, ausgewählte Kundenbilder und deine ausdrückliche Freigabe.');
    return Response.json(await save(env,c,data,'Ergebnisbericht und getrennte Kundenfreigabe gespeichert'));
  }
  if(input.action==='grant'){
    const asset=await original(env,id,input.assetId);need(PUBLICATION_PURPOSES.includes(input.purpose),'Konkreten Werbezweck auswählen.');
    need(input.explicitConsent===true&&text(input.evidence,2000),'Gesonderte ausdrückliche Bildfreigabe mit Nachweis erforderlich. Eine Auftragsunterschrift reicht nicht.');
    const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
    need(/^\d{4}-\d{2}-\d{2}$/.test(input.consentDate??'')&&Number.isFinite(Date.parse(input.consentDate))&&new Date(input.consentDate).toISOString().slice(0,10)===input.consentDate&&input.consentDate<=today,'Gültiges Freigabedatum darf nicht in der Zukunft liegen.');
    need(!activeGrant(data,asset.id,input.purpose),'Für dieses Bild und diesen Zweck ist bereits eine Freigabe dokumentiert.',409);
    data.grants.push({id:crypto.randomUUID(),assetId:asset.id,sourceHash:asset.hash,purpose:input.purpose,consentDate:input.consentDate,evidence:text(input.evidence,2000),recordedAt:now,recordedBy:'owner',revokedAt:null});
    return Response.json(await save(env,c,data,'Gesonderte Werbefreigabe dokumentiert'));
  }
  if(input.action==='revoke'){
    const grant=data.grants.find(g=>g.id===input.grantId);need(grant&&!grant.revokedAt,'Freigabe fehlt oder wurde bereits widerrufen.',409);need(text(input.reason,1000),'Widerrufsgrund oder Eingang des Widerrufs dokumentieren.');
    grant.revokedAt=now;grant.revocationReason=text(input.reason,1000);return Response.json(await save(env,c,data,'Werbefreigabe widerrufen; weiterer Export gesperrt'));
  }
  if(input.action==='previewMask')return Response.json(await maskPreview(env,c,input));
  if(input.action==='approveMask'){
    const mask=await env.DB.prepare('SELECT * FROM result_mask_previews WHERE id=? AND order_id=?').bind(input.previewId,id).first();need(mask&&mask.hash===input.hash&&input.reviewed===true,'Exakte Maskierungsvorschau zuerst prüfen und bestätigen.');
    const asset=await original(env,id,mask.original_id);need(asset.hash===mask.source_hash,'Original inzwischen geändert.',409);
    data.masks[asset.id]={previewId:mask.id,hash:mask.hash,sourceHash:mask.source_hash,...JSON.parse(mask.data),reviewedAt:now,reviewedBy:'owner'};
    return Response.json(await save(env,c,data,'Kennzeichenmaskierung anhand der Vorschau geprüft'));
  }
  throw new AppError('Unbekannte Berichtsaktion.');
}

export async function resultReportPDF(env,c,customer=false){
  const libraryURL=new URL('../dist/pdf/library.mjs',import.meta.url),{PDFDocument,rgb,fontkit}=await import(libraryURL.href),{default:sharp}=await import('sharp'),doc=await PDFDocument.create();doc.registerFontkit(fontkit);
  const font=await doc.embedFont(await readFile(new URL('../dist/pdf/NotoSans.ttf',import.meta.url)),{subset:true}),navy=rgb(.08,.12,.19);
  /** @type {any} */
  let page=null;let y=0;
  const next=()=>{page=doc.addPage([595.28,841.89]);page.drawRectangle({x:0,y:775,width:595.28,height:66,color:navy});page.drawText('WHITE GLOSS',{x:42,y:806,font,size:20,color:rgb(1,1,1)});y=744;};
  const lines=(value,size=10)=>{for(const line of wrapPDFText(value,font,size,511)){if(y<70)next();page.drawText(line,{x:42,y,font,size,color:navy});y-=size+6;}};
  next();lines('Ergebnisbericht · '+c.order.wg,18);lines(c.data.vehicle);lines('Stand: '+berlin(c.row.updated_at));lines(customer?'Für den Kunden freigegebene Dokumentation':'Interne Dokumentation · keine Werbefreigabe',9);y-=12;lines('Tatsächlich erledigte Leistungen',13);lines(c.data.completedServices);y-=12;
  const groups=new Map();
  for(const e of c.data.entries.filter(e=>!customer||e.customerVisible)){const key=e.template+'|'+e.motif;if(!groups.has(key))groups.set(key,{motif:e.motif,template:e.template,before:[],after:[]});groups.get(key)[e.phase].push(e);}
  const embed=async e=>{
    if(!e)return null;const asset=await original(env,c.order.id,e.assetId);need(asset.hash===e.originalHash,'Originalnachweis stimmt nicht überein.',409);
    const png=await sharp(asset.bytes,{limitInputPixels:40000000}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).png().toBuffer(),img=await doc.embedPng(png),scale=Math.min(245/img.width,235/img.height);
    return {img,width:img.width*scale,height:img.height*scale,hash:e.originalHash};
  };
  for(const group of groups.values()){
    const title=(PHOTO_TEMPLATES.find(t=>t.id===group.template)?.label??'Dokumentation')+' · '+group.motif,rows=[];
    for(let i=0;i<Math.max(group.before.length,group.after.length);i++){const before=await embed(group.before[i]),after=await embed(group.after[i]);rows.push({before,after,height:24+Math.max(before?.height??45,after?.height??45)+43});}
    const titleHeight=wrapPDFText(title,font,13,511).length*19+6,groupHeight=titleHeight+rows.reduce((sum,r)=>sum+r.height,0);
    // Keep a complete motif on one page when it fits; larger motifs break only
    // between complete before/after rows, never between the two phases.
    if(groupHeight<=679&&y-groupHeight<65)next();
    for(let index=0;index<rows.length;index++){
      const row=rows[index];let heading=index===0;
      if(y-row.height-(heading?titleHeight:0)<65){next();heading=true;}
      if(heading){lines(title+(index?' (Fortsetzung)':''),13);y-=6;}
      for(const [phase,x] of [['before',42],['after',308]]){
        const label=phase==='before'?'Vorher':'Nachher',picture=row[phase];page.drawText(label+(rows.length>1?' · Aufnahme '+(index+1):''),{x,y,font,size:10,color:navy});
        if(picture){const bottom=y-24-picture.height;page.drawImage(picture.img,{x,y:bottom,width:picture.width,height:picture.height});page.drawText('Originalnachweis (SHA-256)',{x,y:bottom-12,font,size:6.5,color:navy});for(let half=0;half<2;half++)page.drawText(picture.hash.slice(half*32,(half+1)*32),{x,y:bottom-22-half*9,font,size:6.5,color:navy});}
        else{const empty=wrapPDFText('Keine '+label+'-Aufnahme zugeordnet.',font,9,245);empty.forEach((line,i)=>page.drawText(line,{x,y:y-28-i*14,font,size:9,color:navy}));}
      }
      y-=row.height;
    }
    y-=8;
  }
  const pages=doc.getPages();for(let i=0;i<pages.length;i++)pages[i].drawText(c.order.wg+' · '+(i+1)+' / '+pages.length,{x:42,y:35,font,size:8,color:navy});doc.setTitle('White-Gloss Ergebnisbericht '+c.order.wg);doc.setAuthor('White Gloss');return doc.save();
}
