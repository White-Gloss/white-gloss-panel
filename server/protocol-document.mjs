import {readFile} from 'node:fs/promises';
import {digest} from './auth.mjs';
import {need,berlin,paintSummary} from '../src/domain.mjs';
import {soilingLevels,intakeChecks} from '../src/catalog.mjs';
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
  need(p&&p.business,'Gespeichertes Protokoll mit Betriebsdaten erforderlich.',409);
  need(!rendering,'Ein anderes PDF wird gerade erstellt. Bitte kurz erneut versuchen.',429);rendering=true;
  try{
    const {PDFDocument,rgb,fontkit}=await import(libraryURL.href),doc=await PDFDocument.create();doc.registerFontkit(fontkit);
    fontBytes??=await readFile(new URL('../dist/pdf/NotoSans.ttf',import.meta.url));const font=await doc.embedFont(fontBytes,{subset:true});
    const title=kind==='intake'?'Fahrzeugannahme':'Fahrzeugrückgabe',navy=rgb(0.08,0.12,0.19),grey=rgb(0.35,0.4,0.46);
    doc.setTitle(title+' · '+order.wg);doc.setAuthor(p.business.name+' · '+p.business.owner);doc.setSubject('Persönlich geprüftes Fahrzeugprotokoll mit beiden Unterschriften');const stamp=new Date(p.at??p.savedAt??Date.now());doc.setCreationDate(stamp);doc.setModificationDate(new Date(p.savedAt??stamp));
    /** @type {any} */ let page;let y=0;
    const newPage=()=>{page=doc.addPage([595.28,841.89]);page.drawRectangle({x:0,y:786,width:595.28,height:56,color:navy});page.drawText('WHITE GLOSS',{x:42,y:808,font,size:18,color:rgb(1,1,1)});page.drawText(order.wg,{x:390,y:808,font,size:11,color:rgb(1,1,1)});y=758;};
    const ensure=height=>{if(y-height<65)newPage();};
    const paragraph=(value,size=10,color=navy)=>{
      for(const block of String(value??'—').replace(/\r/g,'').split('\n')){
        let line='';for(const char of block){if(font.widthOfTextAtSize(line+char,size)>510&&line){const split=line.lastIndexOf(' '),draw=split>0?line.slice(0,split):line;ensure(size+6);page.drawText(draw,{x:42,y,font,size,color});y-=size+6;line=split>0?line.slice(split+1):'';}line+=char;}
        ensure(size+6);page.drawText(line,{x:42,y,font,size,color});y-=size+6;
      }
    };
    const heading=value=>{ensure(38);y-=12;paragraph(value,13);y-=5;};
    const field=(label,value)=>{ensure(34);paragraph(label,9,grey);paragraph(value,10);y-=5;};
    newPage();paragraph(title+'protokoll'+(p.replaces?' · Ersatz':''),20);y-=12;
    if(p.replaces)paragraph('Dieses Protokoll ersetzt ausdrücklich das'+(p.replaces.signedAt?' am '+berlin(p.replaces.signedAt):' zuvor')+' unterschriebene Protokoll. Die frühere Fassung bleibt in der Kundenakte erhalten.',10,rgb(0.65,0.08,0.08));
    if(!p.customerSignature)paragraph('Noch nicht vom Kunden unterschrieben.',10,rgb(0.65,0.08,0.08));
    paragraph(p.business.name+' · '+p.business.owner);paragraph(p.business.street+' · '+p.business.city);paragraph(p.business.phone+' · '+p.business.email,9,grey);
    heading('Fahrzeug und Übergabe');
    const shown=value=>value===null||value===undefined||value===''?'—':String(value);
    for(const [label,value] of [['Kunde',p.customerName||p.customer],['Betriebsvertreter',p.operatorName],['Fahrzeug',p.vehicle],['Kennzeichen',p.plate],['Datum und Uhrzeit (Europe/Berlin)',p.at?berlin(p.at):''],['Übergabeort',p.location],['Übergabeart',p.delivery],['Kilometerstand',p.mileage===null||p.mileage===undefined?'':p.mileage+' km'],['Übergebene Schlüssel',p.keys],['Tank- bzw. Ladestand',p.fuel===null||p.fuel===undefined?'':p.fuel+' %'],['Verschmutzung innen',soilingLevels[p.soilingInside]??''],['Verschmutzung außen',soilingLevels[p.soilingOutside]??'']])field(label,shown(value));
    const checks=intakeChecks.filter(([key])=>p.checklist?.[key]).map(([,label])=>'• '+label);if(checks.length||p.checklistNote){heading('Checkliste');for(const line of checks)paragraph(line);if(p.checklistNote)paragraph(p.checklistNote);}
    heading('Dokumentierter Zustand');paragraph(shown(p.condition));if(p.notes){heading('Hinweise');paragraph(p.notes);}
    if(p.damages?.length){heading('Schäden und Auffälligkeiten');p.damages.forEach((d,index)=>paragraph((index+1)+'. '+[d.area,d.kind,d.size].filter(Boolean).join(' · ')+(d.note?' — '+d.note:'')+(d.photo?' (Foto in der Kundenakte)':'')));}
    if(p.paint?.readings?.length||p.paint?.notes){heading('Lackschichtdicke (µm)');if(p.paint.device)field('Messgerät',p.paint.device);for(const reading of p.paint.readings??[]){const summary=paintSummary(reading.values);paragraph((reading.panel||'Bauteil')+': '+(reading.values.length?reading.values.join(' / ')+' µm'+(summary?' · Ø '+summary.average+' · min '+summary.min+' · max '+summary.max:''):'—'),10);}if(p.paint.notes)paragraph(p.paint.notes,9,grey);paragraph('Richtwerte: Werkslackierung meist etwa 80–180 µm. Deutlich höhere Werte können auf Nachlackierung, deutlich niedrigere auf dünnen Lack hinweisen. Die Messung ersetzt kein Gutachten.',8,grey);}
    if(kind==='return'){heading('Ausgeführte Leistungen');paragraph(shown(p.services));field('Arbeitsabschluss',p.workComplete?'Arbeiten ausdrücklich als abgeschlossen bestätigt':'Nicht bestätigt');field('Offene Punkte',p.openPoints||'Keine angegeben');}
    heading('Persönliche Bestätigung');if(p.customerAbsent===true)paragraph('Kunde nicht vor Ort. Der Betrieb hat diese Fassung'+(p.operatorSignedAt?' am '+berlin(p.operatorSignedAt):'')+' unterschrieben und zur persönlichen Prüfung durch den Kunden bereitgestellt.');paragraph(p.customerSignature?(p.signedRemotely?'Der Kunde hat dieses Protokoll über seinen persönlichen Zugang geprüft und unterschrieben.':'Das angezeigte Protokoll wurde persönlich geprüft und unterschrieben.')+(p.signedAt?' Unterschrieben am '+berlin(p.signedAt)+'.':''):'Dieses Protokoll ist noch nicht vom Kunden unterschrieben.');
    for(const [label,id,name] of [['Kunde',p.customerSignature,p.customerName],['Betrieb',p.operatorSignature,p.operatorName]]){
      if(!id){ensure(30);paragraph(label+' · '+(name||'—')+' · keine Unterschrift',10,grey);continue;}
      ensure(130);paragraph(label+' · '+(name||'—'),11);const asset=await protocolAsset(env,order,id,'signature');need(['image/png','image/jpeg'].includes(asset.mime),'Unterschrift kann nicht als PDF dargestellt werden.',409);const img=asset.mime==='image/png'?await doc.embedPng(asset.bytes):await doc.embedJpg(asset.bytes),scale=Math.min(470/img.width,85/img.height);page.drawImage(img,{x:42,y:y-85,width:img.width*scale,height:img.height*scale});y-=100;
    }
    const photos=p.photos??[];if(photos.length){heading('Zustandsfotos');paragraph('Die Originalaufnahmen bleiben zusätzlich geschützt in der Kundenakte gespeichert.',9,grey);}
    for(let index=0;index<photos.length;index++){
      const original=await protocolAsset(env,order,photos[index],'photo'),previewId=p.photoPreviews?.[original.id],image=previewId?await protocolAsset(env,order,previewId,'photo'):original;
      need(['image/png','image/jpeg'].includes(image.mime),'Für dieses Foto fehlt die PDF-Vorschau. Das Original bleibt geschützt gespeichert.',409);
      const img=image.mime==='image/png'?await doc.embedPng(image.bytes):await doc.embedJpg(image.bytes),scale=Math.min(510/img.width,290/img.height),height=img.height*scale;
      ensure(height+58);paragraph('Aufnahme '+(index+1),11);page.drawImage(img,{x:42,y:y-height,width:img.width*scale,height});y-=height+14;paragraph('Original-Prüfsumme: '+original.hash,7,grey);y-=9;
    }
    if(p.snapshotHash){heading('Protokollnachweis');paragraph(p.snapshotHash,8,grey);}
    if(p.customerSnapshotHash){paragraph('Nachweis der vom Kunden angezeigten Fassung: '+p.customerSnapshotHash,8,grey);}
    const pages=doc.getPages();pages.forEach((item,index)=>{item.drawText(p.business.name+' · '+order.wg,{x:42,y:33,font,size:8,color:grey});item.drawText((index+1)+' / '+pages.length,{x:510,y:33,font,size:8,color:grey});if(order.synthetic)item.drawText('TEST · Kein echtes Kundenprotokoll',{x:42,y:48,font,size:8,color:rgb(0.65,0.08,0.08)});});
    const bytes=await doc.save();need(bytes.byteLength<=25*1024*1024,'Protokoll-PDF ist für den E-Mail-Anhang zu groß.',413);return {bytes,filename:filename(order,kind),sha256:digest(bytes),snapshotHash:p.snapshotHash??null};
  }finally{rendering=false;}
}
