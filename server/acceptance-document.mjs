import {readFile} from 'node:fs/promises';
import {digest} from './auth.mjs';
import {need,berlin} from '../src/domain.mjs';
import {COMPANY} from '../src/company.mjs';
import {priceNote} from '../src/catalog.mjs';
import {protocolAsset} from './protocol-document.mjs';
// Order confirmation on a durable medium: contract content, consents, signature and the withdrawal information shown.
let rendering=false,fontBytes;
const libraryURL=new URL('../dist/pdf/library.mjs',import.meta.url);
export const acceptanceFilename=order=>order.wg.replace(/[^A-Za-z0-9_-]/g,'_')+'-Auftragsbestaetigung.pdf';
const euro=cents=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format((cents??0)/100);
async function signatureBytes(env,order,signature){
  if(!signature)return null;
  if(String(signature).startsWith('data:image/png;base64,'))return {mime:'image/png',bytes:Buffer.from(String(signature).slice(22),'base64')};
  const asset=await protocolAsset(env,order,signature,'acceptance');return {mime:asset.mime,bytes:asset.bytes};
}
export async function acceptanceDocument(env,order){
  const a=order.acceptance,offer=a?.snapshot?.offer??order.offer,source=a?.snapshot?.source??order.source;need(a&&offer,'Für diesen Auftrag liegt noch keine Annahme vor.',409);
  need(!rendering,'Ein anderes PDF wird gerade erstellt. Bitte kurz erneut versuchen.',429);rendering=true;
  try{
    const {PDFDocument,rgb,fontkit}=await import(libraryURL.href),doc=await PDFDocument.create();doc.registerFontkit(fontkit);
    fontBytes??=await readFile(new URL('../dist/pdf/NotoSans.ttf',import.meta.url));const font=await doc.embedFont(fontBytes,{subset:true});
    const navy=rgb(0.08,0.12,0.19),grey=rgb(0.35,0.4,0.46),red=rgb(0.65,0.08,0.08);
    doc.setTitle('Auftragsbestätigung · '+order.wg);doc.setAuthor(COMPANY.name+' · '+COMPANY.owner);doc.setSubject('Auftragsbestätigung mit Widerrufsbelehrung');doc.setCreationDate(new Date(a.at));doc.setModificationDate(new Date(a.at));
    /** @type {any} */ let page;let y=0;
    const newPage=()=>{page=doc.addPage([595.28,841.89]);page.drawRectangle({x:0,y:786,width:595.28,height:56,color:navy});page.drawText('WHITE GLOSS',{x:42,y:808,font,size:18,color:rgb(1,1,1)});page.drawText(order.wg,{x:390,y:808,font,size:11,color:rgb(1,1,1)});y=758;};
    const ensure=height=>{if(y-height<65)newPage();};
    const paragraph=(value,size=10,color=navy)=>{for(const block of String(value??'—').replace(/\r/g,'').split('\n')){let line='';for(const char of block){if(font.widthOfTextAtSize(line+char,size)>510&&line){const split=line.lastIndexOf(' '),draw=split>0?line.slice(0,split):line;ensure(size+6);page.drawText(draw,{x:42,y,font,size,color});y-=size+6;line=split>0?line.slice(split+1):'';}line+=char;}ensure(size+6);page.drawText(line,{x:42,y,font,size,color});y-=size+6;}};
    const heading=value=>{ensure(38);y-=12;paragraph(value,13);y-=5;};
    const field=(label,value)=>{ensure(34);paragraph(label,9,grey);paragraph(value===null||value===undefined||value===''?'—':value,10);y-=5;};
    const amountLine=(label,cents)=>{paragraph(label,10);ensure(18);const amount=euro(cents);page.drawText(amount,{x:553-font.widthOfTextAtSize(amount,10),y,font,size:10,color:navy});y-=16;};
    newPage();paragraph('Auftragsbestätigung'+(offer.replaces||a.replaces?' · Ersatz':''),20);y-=12;
    paragraph(COMPANY.name+' · '+COMPANY.owner);paragraph(COMPANY.street+' · '+COMPANY.city);paragraph(COMPANY.phone+' · '+COMPANY.email,9,grey);
    if(a.replaces)paragraph('Diese Annahme ersetzt ausdrücklich das'+(a.replaces.signedAt?' am '+berlin(a.replaces.signedAt):' zuvor')+' unterschriebene Angebot.',10,red);
    heading('Kunde und Fahrzeug');
    for(const [label,value] of [['Kunde',[source.name,source.company].filter(Boolean).join(' · ')],['Anschrift',[source.address,source.city].filter(Boolean).join(', ')],['Kontakt',[source.phone,source.email].filter(Boolean).join(' · ')],['Fahrzeug',[source.vehicle,source.plate].filter(Boolean).join(' · ')],['Auftrag',order.wg]])field(label,value);
    heading('Vereinbarte Leistungen');
    const lines=offer.lines??[{title:offer.services||'Fahrzeugaufbereitung',amountCents:offer.totalCents}];for(const line of lines){amountLine(line.title||'Leistung',line.amountCents);if(line.description)paragraph(line.description,9,grey);}
    y-=4;amountLine('Gesamtfestpreis inklusive Umsatzsteuer',offer.totalCents);paragraph(a.snapshot?.priceNote??priceNote,9,grey);
    heading('Annahme');
    const released=a.mode==='ohne Unterschrift freigegeben';
    field('Art und Zeitpunkt',(released?'Vom Betreiber ohne Kundenunterschrift freigegeben':a.mode==='vor Ort'?'Persönlich vor Ort angenommen':'Über den persönlichen Kundenzugang angenommen')+' am '+berlin(a.at));
    if(released){field('Grund der Betreiberfreigabe',a.release?.reason);field('Zeitpunkt der Betreiberfreigabe',berlin(a.release?.at??a.at));}
    field('Zahlungspflichtige Annahme',a.paymentObligation?(released?'Im Rahmen der Betreiberfreigabe erfasst':'Vom Kunden ausdrücklich bestätigt'):'Nicht gesondert bestätigt');
    field('Beginn vor Ablauf der Widerrufsfrist',a.immediateStart?(a.immediateStartText||'Vom Kunden ausdrücklich verlangt'):'Nicht verlangt');
    if(a.withdrawalText)field('Widerrufsbelehrung',a.withdrawalNotice?'Vor der Annahme angezeigt und bestätigt':'Vor der Annahme angezeigt');
    const sig=await signatureBytes(env,order,a.signature);ensure(130);paragraph('Unterschrift Kunde'+(a.customerName?' · '+a.customerName:''),11);
    if(sig&&['image/png','image/jpeg'].includes(sig.mime)){const img=sig.mime==='image/png'?await doc.embedPng(sig.bytes):await doc.embedJpg(sig.bytes),scale=Math.min(470/img.width,85/img.height);page.drawImage(img,{x:42,y:y-85,width:img.width*scale,height:img.height*scale});y-=100;}else paragraph('Keine Unterschrift erfasst.',10,grey);
    if(a.withdrawalText){heading('Widerrufsbelehrung und Muster-Widerrufsformular');paragraph(a.withdrawalText,9);}
    if(a.snapshotHash){heading('Nachweis des angezeigten Angebots');paragraph(a.snapshotHash,8,grey);}
    const pages=doc.getPages();pages.forEach((item,index)=>{item.drawText(COMPANY.name+' · '+order.wg,{x:42,y:33,font,size:8,color:grey});item.drawText((index+1)+' / '+pages.length,{x:510,y:33,font,size:8,color:grey});if(order.synthetic)item.drawText('TEST · Keine echte Auftragsbestätigung',{x:42,y:48,font,size:8,color:red});});
    const bytes=await doc.save();return {bytes,filename:acceptanceFilename(order),sha256:digest(bytes)};
  }finally{rendering=false;}
}
