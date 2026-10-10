import {registerTemplate} from '../../server/document-template.mjs';

/** Isolated in-memory test PDF; this is never a production branding template. */
export async function createTestLetterhead(env,{contentBox={left:42,right:42,top:84,bottom:65},marker='TEST synthetic blank letterhead'}={}){
  const {PDFDocument}=await import('../../dist/pdf/library.mjs'),doc=await PDFDocument.create(),page=doc.addPage([595.28,841.89]);
  page.drawText(marker,{x:30,y:817,size:9});
  return registerTemplate(env,{pdfBase64:Buffer.from(await doc.save()).toString('base64'),approved:true,blankLetterheadConfirmed:true,evidence:'TEST only · synthetic empty A4 background checked in an isolated in-memory fixture',company:{name:'TEST White Gloss',street:'TEST street 1',city:'00000 TEST city',email:'test@example.invalid'},contentBox});
}
