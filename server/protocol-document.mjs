import {readFile} from 'node:fs/promises';
import {digest} from './auth.mjs';
import {need,berlin} from '../src/domain.mjs';
import {letterhead} from './document-template.mjs';
import {settings} from '../src/worker.mjs';
let rendering=false,fontBytes;
const libraryURL=new URL('../dist/pdf/library.mjs',import.meta.url);
const filename=(order,kind)=>order.wg.replace(/[^A-Za-z0-9_-]/g,'_')+'-'+(kind==='intake'?'Annahmeprotokoll':'Rueckgabeprotokoll')+'.pdf';
export const protocolFilename=filename;
export async function protocolAsset(env,order,id,kind){
  const row=await env.DB.prepare('SELECT * FROM assets WHERE id=? AND order_id=? AND kind=?').bind(id,order.id,kind).first();need(row,'Protokollaufnahme fehlt oder gehört zu einem anderen Auftrag.',409);
  const file=await env.BUCKET.get(id);need(file&&digest(file.body)===row.hash,'Protokollaufnahme ist nicht mehr vollständig gespeichert.',409);return {...row,bytes:file.body};
}
export async function protocolDocument(env,order,kind){
  need(['intake','return'].includes(kind),'Unbekanntes Protokoll.');const p=order[kind];
  need(p?.snapshotHash&&p.signaturesConfirmed&&p.customerSignature&&p.operatorSignature&&p.business,'Vollständig unterschriebenes Protokoll mit Betriebsdaten erforderlich.',409);
  need(!rendering,'Ein anderes PDF wird gerade erstellt. Bitte kurz erneut versuchen.',429);rendering=true;
  try{
    const {PDFDocument,rgb,fontkit}=await import(libraryURL.href),doc=await PDFDocument.create();doc.registerFontkit(fontkit);
    fontBytes??=await readFile(new URL('../dist/pdf/NotoSans.ttf',import.meta.url));const font=await doc.embedFont(fontBytes,{subset:true});
    const title=kind==='intake'?'Fahrzeugannahme':'Fahrzeugrückgabe',navy=rgb(0.08,0.12,0.19),grey=rgb(0.35,0.4,0.46);
    doc.setTitle(title+' · '+order.wg);doc.setAuthor(p.business.name+' · '+p.business.owner);doc.setSubject('Persönlich geprüftes Fahrzeugprotokoll mit beiden Unterschriften');doc.setCreationDate(new Date(p.at));doc.setModificationDate(new Date(p.at));
    const template=p.documentTemplate??(p.documentTemplatePending?(await settings(env)).documentTemplate:null);
    need(!p.documentTemplatePending||template,'Protokoll und Unterschriften gespeichert. PDF wartet auf freigegebenes echtes Briefpapier.',409);
    const approvedLetterhead=template?await letterhead(env,doc,template):null,box=template?.contentBox??{left:42,right:42,top:84,bottom:65},contentWidth=595.28-box.left-box.right;
    /** @type {any} */ let page;let y=0;
    const newPage=()=>{page=doc.addPage([595.28,841.89]);if(approvedLetterhead)approvedLetterhead.draw(page);else{page.drawRectangle({x:0,y:786,width:595.28,height:56,color:navy});page.drawText('WHITE GLOSS',{x:42,y:808,font,size:18,color:rgb(1,1,1)});page.drawText(order.wg,{x:390,y:808,font,size:11,color:rgb(1,1,1)});}y=841.89-box.top-20;};
    const ensure=height=>{if(y-height<box.bottom+20)newPage();};
    const paragraph=(value,size=10,color=navy)=>{
      for(const block of String(value??'—').replace(/\r/g,'').split('\n')){
        let line='';for(const char of block){if(font.widthOfTextAtSize(line+char,size)>contentWidth&&line){const split=line.lastIndexOf(' '),draw=split>0?line.slice(0,split):line;ensure(size+6);page.drawText(draw,{x:box.left,y,font,size,color});y-=size+6;line=split>0?line.slice(split+1):'';}line+=char;}
        ensure(size+6);page.drawText(line,{x:box.left,y,font,size,color});y-=size+6;
      }
    };
    const heading=value=>{ensure(38);y-=12;paragraph(value,13);y-=5;};
    const field=(label,value)=>{ensure(34);paragraph(label,9,grey);paragraph(value,10);y-=5;};
    newPage();paragraph(title+'protokoll',20);y-=12;
    paragraph(p.business.name+' · '+p.business.owner);paragraph(p.business.street+' · '+p.business.city);paragraph(p.business.phone+' · '+p.business.email,9,grey);
    heading('Fahrzeug und Übergabe');
    for(const [label,value] of [['Kunde',p.customerName],['Betriebsvertreter',p.operatorName],['Fahrzeug',p.vehicle],['Kennzeichen',p.plate],['Datum und Uhrzeit (Europe/Berlin)',berlin(p.at)],['Übergabeort',p.location],['Übergabeart',p.delivery],['Kilometerstand',p.mileage+' km'],['Übergebene Schlüssel',p.keys]])field(label,value);
    if(p.direct){heading('Direkte Übergabe');paragraph(p.directReason);paragraph('Dieses Fahrzeugprotokoll bestätigt keine gesonderte Angebotsannahme oder Terminvereinbarung.',9,grey);}
    heading('Dokumentierter Zustand');paragraph(p.condition);if(p.notes){heading('Hinweise');paragraph(p.notes);}
    if(kind==='return'){heading('Ausgeführte Leistungen');paragraph(p.services);field('Arbeitsabschluss',p.workComplete?'Arbeiten ausdrücklich als abgeschlossen bestätigt':'Nicht bestätigt');field('Offene Punkte',p.openPoints||'Keine angegeben');}
    heading('Persönliche Bestätigung');paragraph('Beide Personen haben das angezeigte Protokoll persönlich geprüft und unterschrieben.');
    for(const [label,id,name] of [['Kunde',p.customerSignature,p.customerName],['Betrieb',p.operatorSignature,p.operatorName]]){
      ensure(130);paragraph(label+' · '+name,11);const asset=await protocolAsset(env,order,id,'signature');need(['image/png','image/jpeg'].includes(asset.mime),'Unterschrift kann nicht als PDF dargestellt werden.',409);const img=asset.mime==='image/png'?await doc.embedPng(asset.bytes):await doc.embedJpg(asset.bytes),scale=Math.min(contentWidth/img.width,85/img.height);page.drawImage(img,{x:box.left,y:y-85,width:img.width*scale,height:img.height*scale});y-=100;
    }
    heading('Zustandsfotos');paragraph('Die Originalaufnahmen bleiben zusätzlich geschützt in der Kundenakte gespeichert.',9,grey);
    for(let index=0;index<p.photos.length;index++){
      const original=await protocolAsset(env,order,p.photos[index],'photo'),previewId=p.photoPreviews?.[original.id],image=previewId?await protocolAsset(env,order,previewId,'photo'):original;
      need(['image/png','image/jpeg'].includes(image.mime),'Für dieses Foto fehlt die PDF-Vorschau. Das Original bleibt geschützt gespeichert.',409);
      const img=image.mime==='image/png'?await doc.embedPng(image.bytes):await doc.embedJpg(image.bytes),scale=Math.min(contentWidth/img.width,Math.min(290,841.89-box.top-box.bottom-70)/img.height),height=img.height*scale;
      ensure(height+58);paragraph('Aufnahme '+(index+1),11);page.drawImage(img,{x:box.left,y:y-height,width:img.width*scale,height});y-=height+14;paragraph('Original-Prüfsumme: '+original.hash,7,grey);y-=9;
    }
    heading('Protokollnachweis');paragraph(p.snapshotHash,8,grey);
    const pages=doc.getPages();pages.forEach((item,index)=>{item.drawText(order.wg+' · '+(index+1)+' / '+pages.length,{x:box.left,y:box.bottom+2,font,size:8,color:grey});if(order.synthetic)item.drawText('TEST · Kein echtes Kundenprotokoll',{x:box.left,y:box.bottom+12,font,size:8,color:rgb(0.65,0.08,0.08)});});
    const bytes=await doc.save();need(bytes.byteLength<=25*1024*1024,'Protokoll-PDF ist für den E-Mail-Anhang zu groß.',413);return {bytes,filename:filename(order,kind),sha256:digest(bytes),snapshotHash:p.snapshotHash};
  }finally{rendering=false;}
}
