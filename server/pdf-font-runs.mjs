const segmenter=new Intl.Segmenter('de',{granularity:'grapheme'});
export const documentGraphemes=value=>Array.from(segmenter.segment(String(value)),part=>part.segment);

// One selection rule for both wrapping/alignment and drawing. Keep combining
// marks with their base character; only a missing grapheme uses the legacy font.
export function pdfTextRenderer({body,title,number,fallback}){
  const coverage=new Map([body,title,number,fallback].filter(Boolean).map(font=>[font,new Set(font.getCharacterSet())]));
  const choices=new Map();
  const fontFor=(grapheme,primary)=>{
    let cache=choices.get(primary);if(!cache){cache=new Map();choices.set(primary,cache);}
    if(!cache.has(grapheme))cache.set(grapheme,[...grapheme].every(char=>coverage.get(primary).has(char.codePointAt(0)))?primary:(fallback??primary));
    // Characters absent from the original font keep their previous .notdef
    // behavior. A typography change must not introduce a new customer blocker.
    return cache.get(grapheme);
  };
  const runs=(value,primary=body)=>{
    const result=[];
    for(const grapheme of documentGraphemes(value)){
      const font=fontFor(grapheme,primary),last=result.at(-1);
      if(last?.font===font)last.text+=grapheme;else result.push({font,text:grapheme});
    }
    return result;
  };
  const widthOfTextAtSize=(value,size,primary=body)=>runs(value,primary).reduce((width,run)=>width+run.font.widthOfTextAtSize(run.text,size),0);
  const drawText=(page,value,options)=>{
    let x=options.x;
    for(const run of runs(value,options.font??body)){
      page.drawText(run.text,{...options,x,font:run.font});
      x+=run.font.widthOfTextAtSize(run.text,options.size);
    }
  };
  return {widthOfTextAtSize,drawText};
}
