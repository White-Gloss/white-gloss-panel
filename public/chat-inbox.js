// Posteingang des Kundenchats im Panel: Chatliste links, Unterhaltung rechts (mobil nacheinander).
import {mountConversation,esc,chatTime,chatDay,chatIcons} from './chat-ui.js';
let conversation=null,currentId=null,threads=[],listTimer=null,badgeTimer=null,query='',lastUnread=0;
const later=(fn,ms)=>{const timer=setTimeout(fn,ms);/** @type {any} */(timer).unref?.();return timer;};
const icon=path=>`<svg class="chat-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
const initials=name=>String(name||'?').split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase()||'?';
const dayOrTime=value=>{if(!value)return '';const label=chatDay(value);return label==='Heute'?chatTime(value):label;};
async function api(path,data){
  const response=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),credentials:'same-origin'});
  const result=await response.json().catch(()=>({error:'Verbindung nicht lesbar.'}));
  if(!response.ok)throw Object.assign(Error(result.error??'Verbindung fehlgeschlagen.'),{status:response.status});
  return result;
}
export function whatsappNumber(phone){let digits=String(phone??'').replace(/[^\d+]/g,'');if(digits.startsWith('+'))digits=digits.slice(1);else if(digits.startsWith('00'))digits=digits.slice(2);else if(digits.startsWith('0'))digits='49'+digits.slice(1);return /^\d{8,15}$/.test(digits)?digits:'';}

// Opens (or creates) the chat that belongs to one order and returns its id.
export async function openChatForOrder(orderId){return (await api('chats/open',{orderId})).id;}

// Unread counter in the navigation and the browser tab title.
export function startChatBadge(isSynthetic){
  clearTimeout(badgeTimer);
  const tick=async()=>{
    try{
      if(!document.hidden){const {unread}=await api('chats/summary'+(isSynthetic()?'?test=true':''));setBadge(unread);}
    }catch{/* ohne IONOS-Laufzeit gibt es keinen Chat; die Navigation bleibt ruhig */}
    badgeTimer=later(tick,30000);
  };
  tick();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){clearTimeout(badgeTimer);tick();}});
}
export function setBadge(unread=lastUnread){
  lastUnread=unread;
  for(const node of document.querySelectorAll('[data-chat-count]')){node.textContent=unread>99?'99+':String(unread);node.hidden=!unread;}
  document.title=(unread?'('+unread+') ':'')+document.title.replace(/^\(\d+\+?\) /,'');
}

function threadItem(thread){
  const last=thread.last,prefix=last?.sender==='owner'?'Du: ':'',files=last?.files?(last.files===1?'📎 Datei':'📎 '+last.files+' Dateien'):'';
  const preview=last?(prefix+(last.text||files)):'Noch keine Nachrichten';
  return `<li><button type="button" class="inbox-item${thread.id===currentId?' active':''}${thread.unread?' unread':''}" data-thread="${esc(thread.id)}" aria-current="${thread.id===currentId}">
    <span class="chat-avatar">${esc(initials(thread.name))}</span>
    <span class="inbox-item-main"><span class="inbox-item-top"><strong>${esc(thread.name||'Ohne Namen')}</strong><time>${esc(dayOrTime(thread.lastAt))}</time></span>
    <span class="inbox-item-sub">${esc(thread.wg)}${thread.vehicle?' · '+esc(thread.vehicle):''}${thread.closed?' · beendet':''}</span>
    <span class="inbox-item-bottom"><span class="inbox-preview">${esc(preview)}</span>${thread.unread?`<span class="inbox-unread" aria-label="${thread.unread} ungelesen">${thread.unread}</span>`:''}</span></span>
  </button></li>`;
}
function renderList(root){
  const box=root.querySelector('.inbox-threads');if(!box)return;
  const q=query.trim().toLowerCase(),visible=threads.filter(thread=>!q||(thread.name+' '+thread.wg+' '+thread.vehicle).toLowerCase().includes(q));
  box.innerHTML=visible.length?visible.map(threadItem).join(''):`<li class="inbox-none">${threads.length?'Kein Chat passt zur Suche.':'Noch keine Chats. Öffne einen Auftrag und tippe auf „Kundenchat“, um einen Chat zu beginnen.'}</li>`;
  setBadge(threads.reduce((sum,thread)=>sum+thread.unread,0));
}
async function loadList(root,synthetic){
  try{threads=(await api('chats'+(synthetic?'?test=true':''))).threads;renderList(root);}
  catch(error){const box=root.querySelector('.inbox-threads');if(box&&!threads.length)box.innerHTML=`<li class="inbox-none">${esc(error.message)}</li>`;}
}

function ownerHeader(){
  const head=document.createElement('header');head.className='chat-head';
  head.innerHTML=`<button type="button" class="chat-back" data-inbox-back aria-label="Zurück zur Chatliste">${icon(chatIcons.back)}</button><span class="chat-avatar" data-head-avatar></span><div class="chat-title"><strong data-head-name></strong><small data-head-sub></small></div><div class="chat-head-actions"><button type="button" class="smallbtn" data-head-order>Auftrag</button><details class="chat-menu"><summary class="smallbtn">Kundenzugang</summary><div class="chat-menu-panel" data-head-menu></div></details></div>`;
  return head;
}
function menuHTML(data){
  const link=data.link??{},until=link.expiresAt?new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',dateStyle:'medium'}).format(new Date(link.expiresAt)):'';
  const wa=whatsappNumber(data.phone),canMail=Boolean(data.email)&&!data.synthetic;
  const rows=[];
  if(link.active){
    rows.push(`<p class="chat-menu-note">Persönlicher Kundenlink aktiv bis ${esc(until)}. Der Kunde meldet sich mit der E-Mail-Adresse des Auftrags und einer PIN an.</p>`);
    rows.push(`<button type="button" data-chat-do="copy">Kundenlink kopieren</button>`);
    if(wa)rows.push(`<a class="button" target="_blank" rel="noopener noreferrer" href="https://wa.me/${wa}?text=${encodeURIComponent('Hallo '+(data.name||'')+', hier können Sie uns direkt schreiben und Fotos schicken: '+link.url+' – Ihr White-Gloss-Team')}">Link per WhatsApp senden</a>`);
    if(canMail)rows.push(`<button type="button" data-chat-do="invite">Einladung per E-Mail (Link + PIN)</button>`);
    rows.push(`<button type="button" data-chat-do="renew">Neuen Link erzeugen</button>`,`<button type="button" class="danger" data-chat-do="revoke">Kundenlink sperren</button>`);
  }else{
    rows.push(`<p class="chat-menu-note">${data.synthetic?'Testauftrag: Link nur zur Vorschau, kein E-Mail-Versand.':'Noch kein Kundenzugang. Mit der Einladung erhält der Kunde Link und PIN per E-Mail.'}</p>`);
    if(canMail)rows.push(`<button type="button" class="primary" data-chat-do="invite">Einladung per E-Mail (Link + PIN)</button>`);
    rows.push(`<button type="button" data-chat-do="create">Kundenlink erstellen</button>`);
  }
  rows.push(data.closed?`<button type="button" data-chat-do="reopen">Chat wieder öffnen</button>`:`<button type="button" data-chat-do="close">Chat beenden (Kunde kann nur noch lesen)</button>`);
  return rows.join('');
}

function openThread(root,id,{toast}){
  conversation?.destroy();currentId=id;
  root.querySelector('.inbox').classList.add('has-thread');
  for(const item of root.querySelectorAll('.inbox-item'))item.classList.toggle('active',item.dataset.thread===id);
  history.replaceState(null,'','#chat='+id);
  const head=ownerHeader(),pane=root.querySelector('.inbox-thread');
  let meta=null;
  const describe=data=>{
    if(data.error){toast?.(data.error);return;}
    meta={...meta,...data};
    head.querySelector('[data-head-avatar]').textContent=initials(meta.name);
    head.querySelector('[data-head-name]').textContent=meta.name||'Ohne Namen';
    head.querySelector('[data-head-sub]').textContent=[meta.wg,meta.vehicle,meta.closed?'beendet':''].filter(Boolean).join(' · ');
    head.querySelector('[data-head-order]').dataset.order=meta.orderId;
    head.querySelector('[data-head-menu]').innerHTML=menuHTML(meta);
    const entry=threads.find(thread=>thread.id===id);if(entry&&entry.unread&&currentId===id&&document.contains(head)){entry.unread=0;renderList(root);}
  };
  conversation=mountConversation(pane,{base:'/api/chats/t/'+id,role:'owner',header:head,emptyText:'Noch keine Nachrichten. Schreib dem Kunden oder sende ihm zuerst den Kundenlink über „Kundenzugang“.',onData:describe});
  head.addEventListener('click',async event=>{
    const target=/** @type {HTMLElement} */(event.target),action=target.closest('[data-chat-do]');
    if(target.closest('[data-inbox-back]')){root.querySelector('.inbox').classList.remove('has-thread');history.replaceState(null,'','#chat');return;}
    if(!action)return;
    const kind=action.dataset.chatDo;action.setAttribute('disabled','');
    try{
      if(kind==='copy'){try{await navigator.clipboard.writeText(meta.link.url);toast?.('Kundenlink kopiert.');}catch{window.prompt('Kundenlink',meta.link.url);}}
      if(kind==='create'||kind==='renew'){if(kind==='renew'&&!window.confirm('Der bisherige Kundenlink wird damit ungültig. Fortfahren?'))return;const r=await api('chats/t/'+id+'/link',{action:kind});describe({link:r.link});toast?.(kind==='renew'?'Neuer Kundenlink erstellt. Der alte Link gilt nicht mehr.':'Kundenlink erstellt.');}
      if(kind==='revoke'){if(!window.confirm('Kundenlink sperren? Der Kunde kann den Chat dann nicht mehr öffnen.'))return;const r=await api('chats/t/'+id+'/link',{action:'revoke'});describe({link:r.link});toast?.('Kundenlink gesperrt.');}
      if(kind==='invite'){const r=await api('chats/t/'+id+'/invite',{});toast?.(r.message);const fresh=await api('chats/t/'+id+'?after=999999999');describe(fresh);}
      if(kind==='close'||kind==='reopen'){const r=await api('chats/t/'+id+'/close',{closed:kind==='close'});describe({closed:r.closed});toast?.(r.closed?'Chat beendet.':'Chat wieder geöffnet.');}
    }catch(error){toast?.(error.message);}
    finally{action.removeAttribute('disabled');}
  });
}

/** @param {HTMLElement} root @param {{synthetic:boolean,threadId?:string|null,toast?:(message:string)=>void}} options */
export function mountInbox(root,options){
  conversation?.destroy();conversation=null;clearTimeout(listTimer);
  root.innerHTML=`<div class="inbox"><aside class="inbox-list" aria-label="Chats"><div class="inbox-list-head"><div><h2>Nachrichten</h2><small>Direkter Kundenchat mit Fotos, Videos und PDFs</small></div></div><label class="inbox-search"><span class="sr-only">Chats durchsuchen</span><input type="search" placeholder="Kunde, WG-Nummer oder Fahrzeug" value="${esc(query)}"></label><ul class="inbox-threads"><li class="inbox-none">Chats werden geladen …</li></ul></aside><section class="inbox-thread"><div class="inbox-placeholder">${icon('M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z')}<strong>Wähle einen Chat</strong><p>Kunden schreiben dir hier direkt – mit Fotos, Videos und PDFs. Neue Nachrichten erscheinen sofort, ohne Neuladen.</p></div></section></div>`;
  root.querySelector('.inbox-search input').addEventListener('input',event=>{query=/** @type {HTMLInputElement} */(event.target).value;renderList(root);});
  root.querySelector('.inbox-threads').addEventListener('click',event=>{const item=/** @type {HTMLElement} */(event.target).closest('[data-thread]');if(item)openThread(root,item.dataset.thread,options);});
  const poll=async()=>{if(!document.contains(root))return;if(!document.hidden)await loadList(root,options.synthetic);listTimer=later(poll,10000);};
  poll();
  const target=options.threadId??currentId;if(target)openThread(root,target,options);
  return {destroy(){conversation?.destroy();conversation=null;clearTimeout(listTimer);}};
}
export function leaveInbox(){conversation?.destroy();conversation=null;clearTimeout(listTimer);currentId=null;}
