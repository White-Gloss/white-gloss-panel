import {inflateSync} from 'node:zlib';
import {AppError,need} from '../src/domain.mjs';
export function validateCustomerSignature(png){
  const message='Die Unterschrift ist kein vollständig lesbares PNG-Bild. Bitte erneut unterschreiben.';
  try{
    const rowBytes=png.width*png.channels+1,length=rowBytes*png.height;
    const decoded=inflateSync(Buffer.concat(png.idat.map(chunk=>Buffer.from(chunk))),{maxOutputLength:length+1});
    need(decoded.length===length,message);for(let row=0;row<png.height;row++)need(decoded[row*rowBytes]<=4,message);
  }catch{throw new AppError(message);}
}
