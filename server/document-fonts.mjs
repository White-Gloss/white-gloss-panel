import {readFile} from 'node:fs/promises';
import {pdfTextRenderer} from './pdf-font-runs.mjs';

// Only new documents embed these fonts. Existing persisted PDF bytes are served
// by protocol-mail.mjs without rendering or modifying the signed original.
let fontBytes,fallbackBytes;
export async function documentFonts(doc,text=''){
  fontBytes??=Promise.all(['plus-jakarta-sans-400.ttf','syne-700.ttf','syne-800.ttf'].map(name=>readFile(new URL('../dist/pdf/'+name,import.meta.url))));
  const bytes=await fontBytes,fonts=await Promise.all(bytes.map(data=>doc.embedFont(data,{subset:true})));
  const supported=fonts.map(font=>new Set(font.getCharacterSet()));
  const needsFallback=[...String(text)].some(char=>char.codePointAt(0)>31&&supported.some(set=>!set.has(char.codePointAt(0))));
  let fallback;
  if(needsFallback){fallbackBytes??=readFile(new URL('../dist/pdf/NotoSans-fallback.ttf',import.meta.url));fallback=await doc.embedFont(await fallbackBytes,{subset:true});}
  const selected={body:fonts[0],title:fonts[1],number:fonts[2],fallback};
  return {...selected,...pdfTextRenderer(selected)};
}
