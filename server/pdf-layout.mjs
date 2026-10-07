/** Wrap at word boundaries; only an individual oversized word may be split. */
export function wrapPDFText(value,font,size,width){
  const lines=[];
  for(const block of String(value??'').replace(/\r/g,'').split('\n')){
    if(!block.trim()){lines.push('');continue;}
    let line='';
    for(const word of block.trim().split(/\s+/u)){
      const candidate=line?line+' '+word:word;
      if(font.widthOfTextAtSize(candidate,size)<=width){line=candidate;continue;}
      if(line){lines.push(line);line='';}
      for(const character of word){if(line&&font.widthOfTextAtSize(line+character,size)>width){lines.push(line);line='';}line+=character;}
    }
    lines.push(line);
  }
  return lines;
}
