// HTML-Verarbeitung des Communication Centers.
// Sicherheitsgrenze ist die Sandbox ohne Skripte plus eigene CSP der Darstellungsroute.
// Die Bereinigung hier ist eine zusätzliche Schutzschicht und entfernt aktive Inhalte,
// Formulare, eingebettete Fremdobjekte und gefährliche Adressen.

const TAG=/<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE=/([^\s"'<>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
const WITH_CONTENT=['script','iframe','frameset','object','embed','applet','svg','math','noembed','template','title','xml'];
const DROP_TAGS=new Set([...WITH_CONTENT,'frame','link','meta','base','form','input','button','select','textarea','option','optgroup','keygen','isindex','html','head','body','!doctype','portal','dialog','slot']);
const URL_ATTRIBUTES=new Set(['href','src','background','poster','cite','longdesc','lowsrc','dynsrc','action','formaction','xlink:href','data']);
const DROP_ATTRIBUTES=new Set(['srcset','formaction','action','http-equiv','xmlns','ping','integrity','nonce','autofocus','contenteditable','is']);
const ENTITIES={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",colon:':',tab:'\t',newline:'\n',sol:'/',lpar:'(',rpar:')'};

export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function decode(value){
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi,(match,code)=>{
    if(code[0]==='#'){const number=code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):parseInt(code.slice(1),10);return Number.isFinite(number)&&number>0&&number<0x110000?String.fromCodePoint(number):'';}
    return ENTITIES[code.toLowerCase()]??match;
  });
}
const unquote=value=>value===undefined?'':/^["']/.test(value)?value.slice(1,-1):value;
const scheme=value=>decode(value).replace(/[\u0000- \u007f-\u009f]/g,'').toLowerCase();
function safeUrl(name,value,{images=true}={}){
  const url=scheme(value);
  if(name==='href'){if(url.startsWith('#'))return true;return /^(https?:|mailto:|tel:)/.test(url);}
  if(name==='src'){if(/^data:image\/(png|jpe?g|gif|webp);base64,/.test(url))return true;return images&&/^https?:/.test(url);}
  if(name==='background')return images&&/^https?:/.test(url);
  return false;
}
function cleanStyle(value){
  const css=decode(value);if(/expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|@import/i.test(css))return '';
  return value;
}
// Entfernt Elemente samt Inhalt, wiederholt bis zum stabilen Ergebnis (verschachtelte Tricks).
function removeWithContent(html){
  let previous;const pattern=new RegExp(`<\\s*(${WITH_CONTENT.join('|')})\\b(?:[^>"']|"[^"]*"|'[^']*')*>[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>`,'gi');
  do{previous=html;html=html.replace(pattern,'');}while(html!==previous);
  return html;
}
function serializeAttributes(name,raw,{mode,images,stats}){
  const kept=[];const seen=new Set();
  for(const match of raw.matchAll(ATTRIBUTE)){
    const key=match[1].toLowerCase();let value=unquote(match[2]);
    if(seen.has(key)||!/^[a-z_:][-a-z0-9_:.]*$/.test(key)||key.startsWith('on')||DROP_ATTRIBUTES.has(key)||key.startsWith('xmlns'))continue;seen.add(key);
    if(mode==='compose'){
      if(!(name==='a'&&key==='href'))continue;
      if(!safeUrl('href',value))continue;
    }
    if(URL_ATTRIBUTES.has(key)){
      if(!['href','src','background'].includes(key))continue;
      if(key==='src'||key==='background'){
        const external=/^https?:/.test(scheme(value));if(external&&stats)stats.blockedImages+=images?0:1;
        if(!safeUrl(key,value,{images}))continue;
      }else if(!safeUrl(key,value))continue;
    }
    if(key==='style'){value=cleanStyle(value);if(!images&&/url\s*\(\s*['"]?\s*https?:/i.test(decode(value))){if(stats)stats.blockedImages++;value=value.replace(/url\s*\(\s*(['"]?)\s*https?:/gi,'url($1about:invalid#');}if(!value)continue;}
    if(mode==='render'&&(key==='target'||key==='rel'))continue;
    kept.push(match[2]===undefined?key:`${key}="${value.replace(/"/g,'&quot;').replace(/</g,'&lt;')}"`);
  }
  if(mode==='render'&&(name==='a'||name==='area'))kept.push('target="_blank"','rel="noopener noreferrer"');
  if(mode==='compose'&&name==='a')kept.push('target="_blank"','rel="noopener noreferrer"');
  return kept.length?' '+kept.join(' '):'';
}
function rebuild(html,{mode,images=true,stats=null,allow=null}){
  let output='',index=0;
  for(const match of html.matchAll(TAG)){
    output+=match.index>index?html.slice(index,match.index).replace(/</g,'&lt;').replace(/>/g,'&gt;'):'';index=match.index+match[0].length;
    const closing=match[1]==='/',name=match[2].toLowerCase();
    if(DROP_TAGS.has(name)||(allow&&!allow.has(name)))continue;
    if(closing){output+=`</${name}>`;continue;}
    // Gepaarte Style-Blöcke sind vorher ausgelagert; ein einzelnes Style-Tag würde den Rest verschlucken.
    if(name==='style')continue;
    output+=`<${name}${serializeAttributes(name,match[3]??'',{mode,images,stats})}>`;
  }
  output+=html.slice(index).replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return output;
}
function cleanStyleBlocks(html,{images,stats}){
  return html.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi,(match,css)=>{
    if(/expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|@import|<\//i.test(css))return '';
    if(!images&&/url\s*\(\s*['"]?\s*https?:/i.test(css)){if(stats)stats.blockedImages++;css=css.replace(/url\s*\(\s*(['"]?)\s*https?:/gi,'url($1about:invalid#');}
    return '<style>'+css+'</style>';
  });
}
function stripDeclarations(html){return html.replace(/\u0000/g,'').replace(/<!--[\s\S]*?-->/g,'').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g,'').replace(/<![^>]*>/g,'').replace(/<\?[\s\S]*?\?>/g,'');}

// Beim Empfang: aktive Inhalte entfernen, Links und externe Bildadressen für eine spätere,
// ausdrücklich freigegebene Darstellung behalten. Eingebettete CID-Bilder werden zu data:-URLs.
export function sanitizeInboundHtml(value,inlineImages=[]){
  if(typeof value!=='string'||!value)return '';let html=stripDeclarations(value.slice(0,2000000));html=removeWithContent(html);
  for(const item of inlineImages){const cid=String(item.contentId??'').replace(/^<|>$/g,'');if(!cid)continue;const data='data:'+item.mime+';base64,'+item.content.toString('base64');html=html.split('cid:'+cid).join(data);}
  const styles=[];html=html.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi,match=>{styles.push(match);return `\u0000STYLE${styles.length-1}\u0000`;});
  html=rebuild(html,{mode:'store',images:true});
  return html.replace(/\u0000STYLE(\d+)\u0000/g,(match,index)=>cleanStyleBlocks(styles[Number(index)]??'',{images:true,stats:null}));
}

const BASE_STYLE='html{background:#fff}body{margin:0;padding:20px 22px;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#1d2731;overflow-wrap:anywhere;word-break:normal}img{max-width:100%;height:auto}table{max-width:100%}a{color:#24557d}blockquote{margin:12px 0;padding-left:12px;border-left:3px solid #d5dde3;color:#4b5966}pre{white-space:pre-wrap}img[data-wg-blocked]{display:inline-block;min-width:24px;min-height:16px;background:#eef2f5;outline:1px dashed #c3ccd3}';

// Darstellung in eigener Sandbox-Seite. Externe Bilder bleiben ohne Freigabe blockiert.
export function mailDocument(stored,{images=false}={}){
  const stats={blockedImages:0};let html=stripDeclarations(String(stored??''));html=removeWithContent(html);
  const styles=[];html=html.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi,match=>{styles.push(match);return `\u0000STYLE${styles.length-1}\u0000`;});
  html=rebuild(html,{mode:'render',images,stats}).replace(/<img(?![^>]*\bsrc=)/gi,'<img data-wg-blocked=""');
  html=html.replace(/\u0000STYLE(\d+)\u0000/g,(match,index)=>cleanStyleBlocks(styles[Number(index)]??'',{images,stats}));
  return {html:`<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE_STYLE}</style></head><body>${html}</body></html>`,blockedImages:stats.blockedImages};
}
export function mailDocumentPolicy(images){
  return `sandbox allow-popups allow-popups-to-escape-sandbox allow-same-origin; default-src 'none'; style-src 'unsafe-inline'; img-src data:${images?' https: http:':''}; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`;
}
// Zählt externe Bildquellen einer gespeicherten Nachricht ohne sie zu laden.
export function externalImageCount(stored){return mailDocument(stored,{images:false}).blockedImages;}

// Formatierter Text aus dem eigenen Editor: strikte Allowlist, nur sichere Links.
const COMPOSE_TAGS=new Set(['p','br','div','span','b','strong','i','em','u','s','strike','ul','ol','li','a','blockquote','hr']);
export function sanitizeComposeHtml(value){
  if(typeof value!=='string'||!value.trim())return '';let html=stripDeclarations(value.slice(0,200000));html=removeWithContent(html.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,''));
  return rebuild(html,{mode:'compose',images:false,allow:COMPOSE_TAGS}).trim();
}
export function htmlToText(value){
  return decode(String(value??'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(p|div|li|blockquote|h[1-6]|tr)>/gi,'\n').replace(/<li\b[^>]*>/gi,'• ').replace(/<[^>]*>/g,'')).replace(/ /g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
// Versandfertiges HTML mit ruhiger, mailclient-tauglicher Grundformatierung.
export function outboundHtml(content,origin=''){
  let fonts='';
  try{
    const url=new URL(origin);
    if(url.protocol==='https:'&&!url.username&&!url.password){
      const base=url.origin;
      fonts=`@font-face{font-family:Syne;font-style:normal;font-weight:400 800;src:url("${base}/syne-variable.woff2") format("woff2")}@font-face{font-family:"Plus Jakarta Sans";font-style:normal;font-weight:400 800;src:url("${base}/plus-jakarta-sans-variable.woff2") format("woff2")}`;
    }
  }catch{/* Mail clients without web fonts retain the generic sans-serif fallback. */}
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${fonts}body{font-family:"Plus Jakarta Sans",sans-serif;font-size:16px;line-height:1.625;color:#1d2731}h1,h2,h3,h4,h5,h6{font-family:Syne,sans-serif;font-weight:700}h1{font-size:46px;font-weight:800;line-height:1.15;letter-spacing:-.5px}h2{font-size:32px;line-height:1.25}h3{font-size:21px}h4,h5,h6{font-size:19px}@media(max-width:767px){body{font-size:15px}h1{font-size:33px}h2{font-size:25px}h3{font-size:19px}}</style></head><body><div style="font-family:'Plus Jakarta Sans',sans-serif;line-height:1.625;color:#1d2731">${content}</div></body></html>`;
}
