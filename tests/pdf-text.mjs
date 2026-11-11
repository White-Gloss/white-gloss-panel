import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFArray,decodePDFRawStream} from 'pdf-lib';

export async function pdfText(bytes){
  const doc=await PDFDocument.load(bytes),texts=[];
  for(const page of doc.getPages()){
    const fonts=page.node.Resources().lookup(PDFName.of('Font')),mappings=new Map();
    for(const [name,ref] of fonts.entries()){
      const font=doc.context.lookup(ref),cmap=doc.context.lookup(font.get(PDFName.of('ToUnicode')));if(!cmap)continue;
      const raw=Buffer.from(decodePDFRawStream(cmap).decode()).toString(),mapping=new Map();
      for(const match of raw.matchAll(/^<([A-Fa-f0-9]{4})>\s*<([A-Fa-f0-9]+)>$/gm))mapping.set(match[1].toUpperCase(),match[2].match(/.{4}/g).map(code=>String.fromCharCode(parseInt(code,16))).join(''));
      mappings.set(String(name).slice(1),mapping);
    }
    const contents=page.node.Contents(),streams=contents instanceof PDFArray?contents.asArray():[contents];
    // Glyph IDs are local to each embedded font. Follow Tf instead of merging
    // the body/title/amount CMaps and accidentally decoding prices as letters.
    let currentFont;
    for(const ref of streams){
      const raw=Buffer.from(decodePDFRawStream(doc.context.lookup(ref)).decode()).toString();
      for(const match of raw.matchAll(/\/([^\s/]+)\s+[\d.]+\s+Tf|<([A-Fa-f0-9]+)>\s*Tj/g)){
        if(match[1]){currentFont=mappings.get(match[1]);continue;}
        assert.ok(currentFont,'drawn text has an embedded font mapping');
        texts.push(match[2].match(/.{4}/g).map(code=>currentFont.get(code.toUpperCase())??'').join(''));
      }
    }
  }
  return texts.join('\n');
}
