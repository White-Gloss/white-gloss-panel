// Gemeinsame Chatansicht für die Kundenseite und das Panel.
// Nachrichten werden als DOM-Knoten aufgebaut (kein innerHTML für Inhalte), Bilder vor dem
// Hochladen im Browser verkleinert, neue Nachrichten über wartende Abfragen live geladen.
const timeFormat=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit'});
const dayFormat=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',weekday:'short',day:'numeric',month:'short',year:'numeric'});
const dayKey=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'});
const ALLOWED=['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','application/pdf'];
const MAX_BYTES=15*1024*1024,MAX_EDGE=2048,MAX_FILES=10;
const svg=(path,cls='')=>`<svg class="chat-icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
export const chatIcons={
  attach:'M21 11.5 12.6 19.9a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8',
  send:'M4 12 20 4l-4 16-4.5-6.5zM11.5 13.5 20 4',
  tick:'M4 12.5 9 17 20 6',
  ticks:'M2 12.5 7 17 18 6M10 16.5l.8.6L22 6',
  file:'M6 3h8l4 4v14H6zM14 3v5h4',
  close:'M6 6l12 12M18 6 6 18',
  back:'M20 12H4M10 6l-6 6 6 6',
  alert:'M12 3 2 21h20zM12 9v5M12 17v1'
};
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const formatBytes=n=>n>=1048576?(n/1048576).toFixed(1).replace('.',',')+' MB':Math.max(1,Math.round(n/1024))+' KB';
export function chatTime(value){return value?timeFormat.format(new Date(value)):'';}
export function chatDay(value){
  const key=dayKey.format(new Date(value)),today=dayKey.format(new Date()),yesterday=dayKey.format(new Date(Date.now()-86400000));
  return key===today?'Heute':key===yesterday?'Gestern':dayFormat.format(new Date(value));
}
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
const sleep=ms=>new Promise(resolve=>{const timer=setTimeout(resolve,ms);/** @type {any} */(timer).unref?.();});
const uuid=()=>crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');

// Text with clickable web links; everything else stays plain text.
function richText(text){
  const fragment=document.createDocumentFragment();
  for(const part of String(text).split(/(https?:\/\/[^\s<>"']+)/g)){
    if(!part)continue;
    if(/^https?:\/\//.test(part)){const link=el('a','',part);link.href=part;link.target='_blank';link.rel='noopener noreferrer';fragment.append(link);}
    else fragment.append(document.createTextNode(part));
  }
  return fragment;
}

// Images are scaled to at most 2048 px and re-encoded as JPEG: faster upload, no location metadata.
async function prepareFile(file){
  const type=(file.type||'').toLowerCase();
  if(type.startsWith('image/')){
    try{
      const bitmap=await createImageBitmap(file);
      const scale=Math.min(1,MAX_EDGE/Math.max(bitmap.width,bitmap.height));
      const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const context=canvas.getContext('2d');context.fillStyle='#ffffff';context.fillRect(0,0,width,height);context.drawImage(bitmap,0,0,width,height);
      const blob=await new Promise((resolve,reject)=>canvas.toBlob(result=>result?resolve(result):reject(Error('Bild konnte nicht vorbereitet werden.')),'image/jpeg',0.85));
      const thumbScale=Math.min(1,220/Math.max(width,height)),thumb=document.createElement('canvas');thumb.width=Math.max(1,Math.round(width*thumbScale));thumb.height=Math.max(1,Math.round(height*thumbScale));
      thumb.getContext('2d').drawImage(canvas,0,0,thumb.width,thumb.height);bitmap.close?.();
      return {blob,type:'image/jpeg',name:(file.name||'Foto').replace(/\.[a-z0-9]{2,5}$/i,'')+'.jpg',thumb:thumb.toDataURL('image/jpeg',0.7)};
    }catch{
      if(['image/jpeg','image/png','image/webp'].includes(type))return {blob:file,type,name:file.name||'Foto',thumb:null};
      throw Error('Dieses Bildformat wird nicht unterstützt. Bitte als JPEG oder PNG senden.');
    }
  }
  if(ALLOWED.includes(type))return {blob:file,type,name:file.name||'Datei',thumb:null};
  throw Error('„'+(file.name||'Datei')+'“: Erlaubt sind Fotos, Videos (MP4, MOV) und PDF-Dateien.');
}

/**
 * @param {HTMLElement} root
 * @param {{base:string, role:'customer'|'owner', header:HTMLElement|null, emptyText:string, readonly?:boolean, onData?:(data:any)=>void}} options
 */
export function mountConversation(root,options){
  const mine=options.role,other=mine==='owner'?'customer':'owner';
  root.innerHTML=`<div class="chat">
    <div class="chat-head-slot"></div>
    <div class="chat-banner" hidden></div>
    <div class="chat-scroll" tabindex="0"><div class="chat-empty" hidden></div><ol class="chat-list" role="log" aria-live="polite" aria-label="Nachrichtenverlauf"></ol></div>
    <form class="chat-composer" novalidate>
      <div class="chat-pending" hidden></div>
      <p class="chat-error" role="alert"></p>
      <div class="chat-inputrow">
        <label class="chat-attach" title="Foto, Video oder PDF anhängen">${svg(chatIcons.attach)}<span class="sr-only">Foto, Video oder PDF anhängen</span><input class="sr-only" type="file" multiple accept="image/*,video/mp4,video/quicktime,application/pdf"></label>
        <textarea rows="1" maxlength="4000" placeholder="Nachricht schreiben" aria-label="Nachricht" enterkeyhint="send" autocomplete="off"></textarea>
        <button type="submit" class="chat-send" aria-label="Senden">${svg(chatIcons.send)}</button>
      </div>
    </form>
    <div class="chat-lightbox" hidden><button type="button" class="chat-lightbox-close" aria-label="Schließen">${svg(chatIcons.close)}</button><img alt=""></div>
  </div>`;
  const $=selector=>root.querySelector(selector);
  const scroll=$('.chat-scroll'),list=$('.chat-list'),emptyState=$('.chat-empty'),form=$('.chat-composer'),textarea=$('textarea'),fileInput=$('input[type=file]'),pendingBox=$('.chat-pending'),errorBox=$('.chat-error'),banner=$('.chat-banner'),lightbox=$('.chat-lightbox');
  if(options.header)$('.chat-head-slot').replaceWith(options.header);else $('.chat-head-slot').remove();
  emptyState.textContent=options.emptyText;
  const messages=new Map(),nodes=new Map(),outbox=[],listeners=new AbortController(),bound={signal:listeners.signal};
  let cursor=0,otherRead=0,alive=true,closed=false,controller=null,pending=[],queue=Promise.resolve(),wakeLoop=null,lastData=null;

  const nearBottom=()=>scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<90;
  const toBottom=()=>{scroll.scrollTop=scroll.scrollHeight;};
  function showError(message){errorBox.textContent=message??'';}

  function fileNode(file,stick){
    if(file.mime.startsWith('image/')){
      const button=el('button','chat-image');button.type='button';button.dataset.full=file.url;button.setAttribute('aria-label','Bild vergrößern: '+file.name);
      const image=el('img');image.src=file.url;image.alt=file.name;image.loading='lazy';image.decoding='async';
      image.addEventListener('load',()=>{if(stick())toBottom();},{once:true});button.append(image);return button;
    }
    if(file.mime.startsWith('video/')){const video=el('video','chat-video');video.controls=true;video.preload='metadata';video.setAttribute('playsinline','');video.src=file.url;return video;}
    const link=el('a','chat-file');link.href=file.url;link.target='_blank';link.rel='noopener';link.innerHTML=svg(chatIcons.file);
    const label=el('span');label.append(el('strong','',file.name),el('small','',(file.mime==='application/pdf'?'PDF':'Datei')+' · '+formatBytes(file.size)));link.append(label);return link;
  }
  function bubble(message,local=null){
    const item=el('li','chat-msg '+(message.sender===mine?'mine':'theirs'));
    const box=el('div','chat-bubble');
    const files=message.files??[];
    if(files.length){const media=el('div','chat-media'+(files.filter(f=>f.mime.startsWith('image/')).length>1?' grid':''));const stick=()=>stuck;for(const file of files)media.append(fileNode(file,stick));box.append(media);}
    if(local?.items?.length){const media=el('div','chat-media'+(local.items.length>1?' grid':''));for(const entry of local.items){if(entry.thumb){const image=el('img');image.src=entry.thumb;image.alt=entry.name;const wrap=el('span','chat-image');wrap.append(image);media.append(wrap);}else{const chip=el('span','chat-file');chip.innerHTML=svg(chatIcons.file);chip.append(el('span','',entry.name));media.append(chip);}}box.append(media);}
    if(message.text){const text=el('p','chat-text');text.append(richText(message.text));box.append(text);}
    const meta=el('span','chat-meta');meta.append(el('time','',chatTime(message.at)));
    if(message.sender===mine){const tick=el('span','chat-tick');meta.append(tick);}
    box.append(meta);item.append(box);
    if(local){item.classList.add('local',local.state);if(local.state==='failed'){const actions=el('span','chat-retry-row');const retry=el('button','chat-retry','Nicht gesendet · Erneut senden');retry.type='button';retry.dataset.retry=local.clientId;const discard=el('button','chat-retry discard','Verwerfen');discard.type='button';discard.dataset.discard=local.clientId;actions.append(retry,discard);item.append(actions);}}
    return item;
  }
  function updateTicks(){for(const [id,node] of nodes){const message=messages.get(id);if(message?.sender!==mine)continue;const read=id<=otherRead;node.classList.toggle('read',read);const tick=node.querySelector('.chat-tick');if(tick&&tick.dataset.read!==String(read)){tick.dataset.read=String(read);tick.innerHTML=svg(read?chatIcons.ticks:chatIcons.tick);tick.setAttribute('aria-label',read?'Gelesen':'Gesendet');tick.title=read?'Gelesen':'Gesendet';}}}
  let stuck=true;
  const separators=new Map();
  // Minimal DOM changes: nodes already in place are never moved, so playing videos keep playing.
  function render(force=false){
    stuck=force||nearBottom();
    const sorted=[...messages.values()].sort((a,b)=>a.id-b.id),children=[];let day='';
    for(const message of sorted){
      const key=dayKey.format(new Date(message.at));
      if(key!==day){day=key;let separator=separators.get(key);if(!separator){separator=el('li','chat-day');separator.append(el('span','',chatDay(message.at)));separators.set(key,separator);}children.push(separator);}
      let node=nodes.get(message.id);if(!node){node=bubble(message);nodes.set(message.id,node);}children.push(node);
    }
    for(const local of outbox){if(!local.node||local.node.dataset.state!==local.state){local.node=bubble({sender:mine,text:local.text,at:local.at,files:[]},local);local.node.dataset.state=local.state;}children.push(local.node);}
    children.forEach((node,index)=>{if(list.children[index]!==node)list.insertBefore(node,list.children[index]??null);});
    while(list.children.length>children.length)list.lastElementChild.remove();
    emptyState.hidden=children.length>0;
    updateTicks();
    if(stuck)toBottom();
  }
  function apply(data){
    lastData=data;
    for(const message of data.messages??[]){messages.set(message.id,message);if(message.id>cursor)cursor=message.id;}
    if(data.read)otherRead=Number(data.read[other]??0);
    closed=Boolean(data.closed);
    const blocked=closed||options.readonly||data.ownerPreview;
    form.hidden=Boolean(blocked);
    banner.hidden=!blocked;
    if(blocked)banner.textContent=data.ownerPreview?'Betreibervorschau: So sieht der Kunde den Chat. Antworten bitte im Panel.':closed?(mine==='owner'?'Dieser Chat ist beendet. Der Kunde kann lesen, aber nicht mehr schreiben.':'Dieser Chat wurde beendet. Für Rückfragen erreichen Sie uns telefonisch oder per E-Mail.'):'';
    if((data.messages??[]).length||data.read)render();
    options.onData?.(data);
  }

  async function request(path,init={}){
    const response=await fetch(path,{credentials:'same-origin',...init});
    const data=await response.json().catch(()=>({error:response.status===413?'Datei ist zu groß (höchstens 15 MB).':'Verbindung nicht lesbar.'}));
    if(!response.ok)throw Object.assign(Error(data.error??'Verbindung fehlgeschlagen.'),{status:response.status});
    return data;
  }
  async function loop(){
    let first=true,failures=0;
    while(alive){
      if(document.hidden){await new Promise(resolve=>{wakeLoop=resolve;});wakeLoop=null;first=true;if(!alive)break;}
      controller=new AbortController();
      try{
        const began=Date.now(),waited=!first;
        const data=await request(`${options.base}?after=${cursor}&seen=${otherRead}&wait=${first?0:25}`,{signal:controller.signal});
        if(!alive)break;const unchanged=!(data.messages??[]).length&&Number(data.read?.[other]??0)===otherRead&&Boolean(data.closed)===closed;if(waited&&unchanged&&Date.now()-began<1000)await sleep(2500);if(!alive)break;first=false;failures=0;root.classList.remove('chat-offline');apply(data);
      }catch(error){
        if(!alive)break;if(error.name==='AbortError'){first=true;continue;}
        failures++;root.classList.add('chat-offline');
        if([401,403,404].includes(error.status)){banner.hidden=false;banner.textContent=error.message;form.hidden=true;options.onData?.({error:error.message,status:error.status});break;}
        await sleep(Math.min(30000,1500*2**Math.min(failures,4)));
      }
    }
  }
  const visibility=()=>{if(document.hidden)controller?.abort();else wakeLoop?.();};
  document.addEventListener('visibilitychange',visibility);

  // --- Composer ---
  function renderPending(){
    pendingBox.hidden=!pending.length;pendingBox.replaceChildren(...pending.map((entry,index)=>{
      const chip=el('div','chat-chip');
      if(entry.thumb){const image=el('img');image.src=entry.thumb;image.alt='';chip.append(image);}else chip.innerHTML=svg(chatIcons.file);
      chip.append(el('span','',entry.name));
      const remove=el('button','chat-chip-remove');remove.type='button';remove.dataset.remove=String(index);remove.setAttribute('aria-label',entry.name+' entfernen');remove.innerHTML=svg(chatIcons.close);chip.append(remove);return chip;
    }));
  }
  async function addFiles(files){
    showError('');
    for(const file of Array.from(files??[])){
      if(pending.length>=MAX_FILES){showError('Höchstens 10 Dateien pro Nachricht.');break;}
      try{const prepared=await prepareFile(file);if(prepared.blob.size>MAX_BYTES)throw Error('„'+prepared.name+'“ ist größer als 15 MB.');pending.push(prepared);}catch(error){showError(error.message);}
    }
    renderPending();
  }
  function autosize(){textarea.style.height='auto';textarea.style.height=Math.min(textarea.scrollHeight,150)+'px';}
  async function deliver(local){
    try{
      for(const item of local.items){
        if(item.id)continue;
        const uploaded=await request(options.base+'/file?name='+encodeURIComponent(item.name),{method:'POST',headers:{'Content-Type':item.type},body:item.blob});
        item.id=uploaded.id;
      }
      const result=await request(options.base+'/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:local.text,files:local.items.map(item=>item.id),clientId:local.clientId})});
      outbox.splice(outbox.indexOf(local),1);messages.set(result.message.id,result.message);render(true);
    }catch(error){local.state='failed';showError(error.message);render();}
  }
  function enqueue(local){queue=queue.then(()=>deliver(local));return queue;}
  async function submit(){
    if(closed)return;
    const text=textarea.value.trim();if(!text&&!pending.length)return;
    if(text.length>4000){showError('Eine Nachricht darf höchstens 4000 Zeichen lang sein.');return;}
    const local={clientId:uuid(),text,items:pending,at:new Date().toISOString(),state:'sending',node:null};
    outbox.push(local);pending=[];textarea.value='';autosize();renderPending();showError('');render(true);
    await enqueue(local);
  }
  form.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();submit();});
  textarea.addEventListener('input',autosize);
  textarea.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&window.matchMedia?.('(pointer: fine)')?.matches){event.preventDefault();submit();}});
  textarea.addEventListener('paste',event=>{const files=event.clipboardData?.files;if(files?.length){event.preventDefault();addFiles(files);}});
  fileInput.addEventListener('change',()=>{addFiles(fileInput.files);fileInput.value='';});
  root.addEventListener('dragover',event=>{if(event.dataTransfer?.types?.includes('Files')){event.preventDefault();root.classList.add('chat-drop');}},bound);
  root.addEventListener('dragleave',event=>{if(event.target===root||!root.contains(/** @type {Node} */(event.relatedTarget)))root.classList.remove('chat-drop');},bound);
  root.addEventListener('drop',event=>{if(event.dataTransfer?.files?.length){event.preventDefault();root.classList.remove('chat-drop');if(!closed)addFiles(event.dataTransfer.files);}},bound);
  root.addEventListener('click',event=>{
    const target=/** @type {HTMLElement} */(event.target);
    const remove=target.closest('[data-remove]'),retry=target.closest('[data-retry]'),image=target.closest('[data-full]');
    if(remove){pending.splice(Number(remove.dataset.remove),1);renderPending();return;}
    if(retry){const local=outbox.find(entry=>entry.clientId===retry.dataset.retry);if(local){local.state='sending';showError('');render();enqueue(local);}return;}
    const discard=target.closest('[data-discard]');if(discard){const index=outbox.findIndex(entry=>entry.clientId===discard.dataset.discard);if(index>=0){outbox.splice(index,1);showError('');render();}return;}
    if(image){const big=lightbox.querySelector('img');big.src=image.dataset.full;big.alt=image.getAttribute('aria-label')??'';lightbox.hidden=false;lightbox.querySelector('button').focus();return;}
    if(target.closest('.chat-lightbox')){lightbox.hidden=true;lightbox.querySelector('img').removeAttribute('src');}
  },bound);
  const escape=event=>{if(event.key==='Escape'&&!lightbox.hidden){lightbox.hidden=true;lightbox.querySelector('img').removeAttribute('src');}};
  document.addEventListener('keydown',escape);

  loop();
  return {
    destroy(){alive=false;controller?.abort();listeners.abort();wakeLoop?.();document.removeEventListener('visibilitychange',visibility);document.removeEventListener('keydown',escape);},
    focus(){textarea.focus();},
    get data(){return lastData;}
  };
}
