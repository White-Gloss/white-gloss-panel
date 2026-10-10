import {deflateSync} from 'node:zlib';
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
function chunk(type,bytes){const name=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(bytes.length);crc.writeUInt32BE(crc32(Buffer.concat([name,bytes])));return Buffer.concat([length,name,bytes,crc]);}
export function signatureBytes({width=64,height=32,compressed}={}){
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const rows=Buffer.alloc(height*(width*4+1));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const offset=y*(width*4+1)+1+x*4,ink=x>8&&x<width-8&&Math.abs(y-(8+(x%13)))<2;rows[offset]=rows[offset+1]=rows[offset+2]=ink?0:255;rows[offset+3]=255;}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',compressed??deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
export const syntheticSignature='data:image/png;base64,'+signatureBytes().toString('base64');
