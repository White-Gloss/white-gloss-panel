import {need} from '../src/domain.mjs';

const libraryURL=new URL('../dist/pdf/library.mjs',import.meta.url);

export async function validatePaymentPDF(bytes){
  let document;
  try{
    const {PDFDocument}=await import(libraryURL.href);
    document=await PDFDocument.load(bytes,{ignoreEncryption:false,throwOnInvalidObject:true,updateMetadata:false});
    const pages=document.getPages();
    need(pages.length>0,'Originalbeleg muss mindestens eine PDF-Seite enthalten.');
    need(pages.every(page=>{const {width,height}=page.getSize();return Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0;}),'PDF-Seitengröße ist ungültig.');
  }catch{
    need(false,'Gültiger, unverschlüsselter PDF-Originalbeleg erforderlich.');
  }
}
