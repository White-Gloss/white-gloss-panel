// Communication Center: E-Mail, Termine, Notizen und laufende Aufträge in einer Arbeitsfläche.
// Originalnachweise bleiben serverseitig unveränderlich; Ordner, Markierungen und Notizen sind CRM-Metadaten.
import {mountTextAssistant} from './assistant.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const TZ='Europe/Berlin';
const fmt={
  time:new Intl.DateTimeFormat('de-DE',{timeZone:TZ,hour:'2-digit',minute:'2-digit'}),
  weekday:new Intl.DateTimeFormat('de-DE',{timeZone:TZ,weekday:'short'}),
  dayMonth:new Intl.DateTimeFormat('de-DE',{timeZone:TZ,day:'numeric',month:'short'}),
  short:new Intl.DateTimeFormat('de-DE',{timeZone:TZ,day:'2-digit',month:'2-digit',year:'2-digit'}),
  full:new Intl.DateTimeFormat('de-DE',{timeZone:TZ,weekday:'short',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}),
  key:new Intl.DateTimeFormat('sv-SE',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}),
  dayLabel:new Intl.DateTimeFormat('de-DE',{timeZone:TZ,weekday:'long',day:'numeric',month:'long'}),
  dayShort:new Intl.DateTimeFormat('de-DE',{timeZone:TZ,weekday:'short'}),
  dayNumber:new Intl.DateTimeFormat('de-DE',{timeZone:TZ,day:'numeric'})
};
const valid=value=>value&&Number.isFinite(new Date(value).getTime());
const dayKey=value=>fmt.key.format(new Date(value));
function when(value){
  if(!valid(value))return '—';const date=new Date(value),today=dayKey(Date.now()),key=dayKey(date);
  if(key===today)return fmt.time.format(date);const diff=(Date.parse(today)-Date.parse(key))/86400000;
  if(diff>0&&diff<6)return fmt.weekday.format(date);if(key.slice(0,4)===today.slice(0,4))return fmt.dayMonth.format(date);return fmt.short.format(date);
}
const full=value=>valid(value)?fmt.full.format(new Date(value)):'—';
const size=value=>value<1024?value+' B':value<1024*1024?Math.round(value/1024)+' KB':(value/1024/1024).toFixed(1).replace('.',',')+' MB';
const plural=(count,one,many)=>`${count} ${count===1?one:many}`;
const hue=value=>{let sum=0;for(const char of String(value??''))sum=(sum*31+char.charCodeAt(0))>>>0;return sum%8;};
const initialsOf=value=>String(value||'?').replace(/<.*>/,'').replace(/["']/g,'').trim().split(/[\s@._-]+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase()||'?';
const partnerOf=mail=>mail.direction==='INBOUND'?{name:mail.fromName,address:mail.fromAddress}:{name:mail.to?.[0]?.name??'',address:mail.to?.[0]?.address??''};
const avatar=(name,address,extra='')=>`<span class="cc-avatar cc-hue-${hue(address||name)} ${extra}" aria-hidden="true">${esc(initialsOf(name||address))}</span>`;

const ICONS={home:'M3 10 12 3l9 7M5 9v11h14V9M9 20v-7h6v7',inbox:'M3 13h5l1 3h6l1-3h5M5 5h14l2 8v6H3v-6z',unread:'M3 6h18v12H3zM3 6l9 7 9-7',flag:'M5 21V4M5 4h11l-2 4 2 4H5',draft:'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',sent:'M3 11 21 3l-8 18-2-8z',archive:'M3 4h18v4H3zM5 8v12h14V8M10 12h4',spam:'M12 3 3 7v5c0 5 4 8 9 9 5-1 9-4 9-9V7zM12 8v5M12 16v.5',trash:'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',folder:'M3 6h6l2 2h10v11H3z',car:'M4 15h16l-2-7H6zM3 15v5M21 15v5M6 17h1M17 17h1M7 8l1-4h8l1 4',calendar:'M4 5h16v16H4zM8 3v4M16 3v4M4 10h16',note:'M5 3h11l3 3v15H5zM9 9h6M9 13h6M9 17h3',chat:'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',people:'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8',reply:'M10 9V5l-7 7 7 7v-4c5 0 8 1 11 5-1-6-4-10-11-11',replyAll:'M7 9V5l-6 7 6 7v-4M13 9V5l-7 7 7 7v-4c4 0 7 1 9 5-1-6-3-10-9-11',forward:'M14 9V5l7 7-7 7v-4c-5 0-8 1-11 5 1-6 4-10 11-11',clip:'M20 11l-8 8a5 5 0 0 1-7-7l8-8a3 3 0 0 1 5 4l-8 8a1 1 0 0 1-2-2l7-7',star:'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',close:'M6 6l12 12M18 6 6 18',back:'M20 12H4M10 6l-6 6 6 6',menu:'M4 6h16M4 12h16M4 18h16',plus:'M12 5v14M5 12h14',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',sync:'M20 6v5h-5M4 18v-5h5M6 9a7 7 0 0 1 12-2l2 4M18 15a7 7 0 0 1-12 2l-2-4',search:'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M20 20l-4-4',check:'M4 12l5 5L20 6',move:'M3 6h6l2 2h10v11H3zM12 11v6M9 14l3 3 3-3',lock:'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',arrow:'M5 12h14M13 6l6 6-6 6',pin:'M9 3h6l-1 6 4 4H6l4-4zM12 13v8',bold:'M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z',italic:'M10 4h8M6 20h8M14 4 10 20',underline:'M7 4v7a5 5 0 0 0 10 0V4M5 20h14',list:'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',olist:'M10 6h10M10 12h10M10 18h10M4 4v4M3 12h2l-2 3h2M3 17h2v4H3',link:'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',quote:'M7 7h4v6H5V9M15 7h4v6h-6V9M7 13l-2 4M15 13l-2 4',clear:'M5 5l14 14M9 5h9M12 5l-4 14',task:'M9 11l2 2 4-4M12 3a9 9 0 100 18 9 9 0 000-18z'};
const icon=(name,extra='')=>`<svg class="cc-icon ${extra}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]??ICONS.folder}"/></svg>`;

const SECTIONS=[['home','Übersicht','home'],['mail','E-Mail','inbox'],['tasks','Aufgaben','task'],['orders','Laufende Aufträge','car'],['calendar','Kalender','calendar'],['notes','Notizen','note']];
const FOLDERS=[['INBOX','Posteingang','inbox'],['Unread','Ungelesen','unread'],['Flagged','Wichtig','flag'],['Drafts','Entwürfe','draft'],['Sent','Gesendet','sent'],['Archive','Archiv','archive'],['Spam','Spam','spam'],['Trash','Papierkorb','trash']];
const FOLDER_LABEL={...Object.fromEntries(FOLDERS.map(([id,label])=>[id,label])),all:'Alle E-Mails'};
const MOVE_TARGETS=[['INBOX','Posteingang'],['Archive','Archiv'],['Spam','Spam'],['Trash','Papierkorb']];
const FILTERS=[['all','Alle'],['unread','Ungelesen'],['flagged','Markiert'],['attachments','Mit Anhang'],['crm','CRM-Bezug']];
const STYLES=[['short','Kurz'],['friendly','Freundlich'],['professional','Professionell'],['appointment','Termin erfragen'],['question','Rückfrage'],['detailed','Ausführlich']];
const RUNNING=['Angenommen','Termin verbindlich','In Arbeit'];
const CLOSED=['Abgelehnt','Storniert','Abgelaufen'];
const UPLOAD_TYPES={'application/pdf':'PDF','image/jpeg':'JPG','image/png':'PNG','image/webp':'WEBP'};
const NEXT_STEP={'Angenommen':'Termin festlegen','Termin verbindlich':'Annahmeprotokoll erstellen','In Arbeit':'Arbeit abschließen und Rückgabe dokumentieren'};

// Ansicht bleibt beim erneuten Öffnen des Bereichs erhalten (z. B. nach einem geöffneten Auftrag).
const memory=new Map();let keyHandler=null;
const IMAGE_KEY='wg-cc-images';
function imagesAuto(){try{return localStorage.getItem(IMAGE_KEY)!=='off';}catch{return true;}}
function setImagesAuto(on){try{localStorage.setItem(IMAGE_KEY,on?'on':'off');}catch{/* Ohne lokalen Speicher gilt die Standardeinstellung. */}}
// Links in reinen Textmails anklickbar machen; nur http(s), www und E-Mail-Adressen.
const LINK=/(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
export function linkify(value){
  let output='',index=0;const source=String(value??'');
  for(const match of source.matchAll(LINK)){
    let found=match[0];const trail=/[.,;:!?)\]]+$/.exec(found)?.[0]??'';if(trail)found=found.slice(0,-trail.length);
    output+=esc(source.slice(index,match.index));const href=found.includes('@')&&!/^https?:|^www\./i.test(found)?'mailto:'+found:/^www\./i.test(found)?'https://'+found:found;
    output+=`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(found)}</a>`;index=match.index+found.length;
  }
  return output+esc(source.slice(index));
}
function remembered(synthetic){
  let value=memory.get(synthetic);if(value)return value;let section='home';
  try{const stored=localStorage.getItem('wg-cc-section');if(SECTIONS.some(([id])=>id===stored))section=stored;}catch{/* Ohne lokalen Speicher startet die Übersicht. */}
  value={section,folder:'INBOX',query:'',filter:'all',sort:'newest',openId:null,images:new Set(),hiddenImages:new Set(),noteQuery:'',noteFilter:'all',orderQuery:'',calendarDay:null};memory.set(synthetic,value);return value;
}

export function mountMailbox(root,{synthetic=false,toast=()=>{},orders=()=>[],markSaved=()=>{}}={}){
  if(!root)return;
  const ui=remembered(synthetic);
  let data=null,list=[],stale=new Set(),total=0,detail=null,detailState='idle',detailError='',listState='loading',listError='',busy=false,compose=null,selection=new Set(),selectMode=false,railOpen=false,settingsOpen=false,searchTimer=null,loadToken=0,observer=null,confirmDelete=null;

  async function api(path='',payload,params={}){
    const search=new URLSearchParams(params);if(synthetic)search.set('test','true');const query=search.toString();
    const response=await fetch('/api/mailbox'+path+(query?'?'+query:''),{method:payload===undefined?'GET':'POST',headers:payload===undefined?{}:{'Content-Type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload),credentials:'same-origin'});
    const result=await response.json().catch(()=>({error:'Antwort des Communication Centers konnte nicht gelesen werden.'}));if(!response.ok)throw Error(result.error??'Zugriff auf das Postfach fehlgeschlagen.');return result;
  }
  const $=selector=>root.querySelector(selector);
  const region=name=>root.querySelector(`[data-region="${name}"]`);
  function message(value,error=false){const element=$('[data-mailbox-message]');if(element){element.textContent=value;element.classList.toggle('error',error);}if(value&&!error)toast(value);if(value&&error)toast(value,{error:true});}
  async function run(action){if(busy)return;busy=true;root.setAttribute('aria-busy','true');try{await action();}catch(error){message(error.message,true);}finally{busy=false;root.removeAttribute('aria-busy');}}
  const allOrders=()=>{try{return (orders()??[]).filter(order=>!order.trash?.deletedAt);}catch{return [];}};
  const running=()=>allOrders().filter(order=>RUNNING.includes(order.status)).sort((a,b)=>String(a.appointment?.start??'9999').localeCompare(String(b.appointment?.start??'9999')));
  const appointments=()=>allOrders().filter(order=>valid(order.appointment?.start)&&!CLOSED.includes(order.status)).sort((a,b)=>a.appointment.start.localeCompare(b.appointment.start));
  const ownAddress=()=>String(data?.account?.email??'').toLowerCase();
  const counts=name=>data?.counts?.[name]??{total:0,unread:0};

  // ---------- Laden ----------
  function listParams(append=false){
    if(ui.section==='home')return {folder:'Unread',limit:'6'};
    if(ui.section!=='mail'||ui.folder==='Drafts')return {folder:'INBOX',limit:'1'};
    const params={folder:ui.folder,limit:'50',offset:append?String(Math.max(0,list.length-stale.size)):'0'};if(ui.query)params.q=ui.query;if(ui.filter!=='all')params.filter=ui.filter;if(ui.sort!=='newest')params.sort=ui.sort;return params;
  }
  async function load({append=false}={}){
    const token=++loadToken;if(!append){listState='loading';listError='';}
    try{const result=await api('',undefined,listParams(append));if(token!==loadToken)return false;data=result;if(append){const known=new Set(list.map(mail=>mail.id));list=[...list,...result.messages.filter(mail=>!known.has(mail.id))];total=result.total+stale.size;}else{stale=new Set();list=result.messages;total=result.total;}listState='ready';announce();return true;}
    catch(error){if(token!==loadToken)return false;listState='error';listError=error.message;if(!data)throw error;return true;}
  }
  // Lokale Statuswechsel können eine sichtbare Nachricht aus dem Serverfilter nehmen (z. B. gelesen in „Ungelesen“).
  // Sie bleibt bis zum Neuladen sichtbar, zählt aber nicht mehr für den Seiten-Offset.
  function trackFilter(id,patch){
    const leavesUnread=patch.read===true&&(ui.folder==='Unread'||ui.filter==='unread'),backUnread=patch.read===false&&(ui.folder==='Unread'||ui.filter==='unread');
    const leavesFlag=patch.flagged===false&&(ui.folder==='Flagged'||ui.filter==='flagged'),backFlag=patch.flagged===true&&(ui.folder==='Flagged'||ui.filter==='flagged');
    if(leavesUnread||leavesFlag)stale.add(id);if(backUnread||backFlag)stale.delete(id);
  }
  async function refreshMeta(){const result=await api('',undefined,{folder:'INBOX',limit:'1'}).catch(()=>null);if(result){const keep={messages:data?.messages,total:data?.total};data={...result,...keep};drawRail();drawStatus();announce();}}
  function announce(){const unread=data?.counts?.Unread?.total;if(Number.isFinite(unread))window.dispatchEvent(new window.CustomEvent('wg-mail-count',{detail:{unread}}));}

  // ---------- Gerüst ----------
  function sectionTitle(){if(ui.section!=='mail')return SECTIONS.find(([id])=>id===ui.section)?.[1]??'Übersicht';return FOLDER_LABEL[ui.folder]??ui.folder;}
  function drawAll(){
    root.innerHTML=`<div class="cc ${railOpen?'cc-rail-open':''}" data-cc data-section="${ui.section}">
      <header class="cc-head"><div class="cc-head-title"><button type="button" class="cc-icon-btn cc-rail-toggle" data-cc-rail aria-label="Ordner und Bereiche öffnen" aria-expanded="${railOpen}">${icon('menu')}</button><div><span class="eyebrow">COMMUNICATION CENTER${synthetic?' · TESTBEREICH':''}</span><h1 data-cc-title>${esc(sectionTitle())}</h1></div></div><div class="cc-head-status" data-region="status"></div></header>
      <div class="cc-shell"><aside class="cc-rail" data-region="rail" aria-label="Communication Center"></aside><button type="button" class="cc-rail-backdrop" data-cc-rail-close aria-label="Navigation schließen" tabindex="-1"></button><section class="cc-main" data-region="main"></section></div>
      <div data-region="compose"></div><div data-region="settings"></div><p class="cc-statusline" data-mailbox-message role="status" aria-live="polite"></p></div>`;
    drawStatus();drawRail();drawMain();drawCompose();drawSettings();
  }
  function drawStatus(){
    const element=region('status');if(!element)return;const account=data?.account,ready=Boolean(account?.imapVerifiedAt&&account?.smtpVerifiedAt);
    const state=!account?['warn','Postfach einrichten']:ready?['good','Verbunden']:!account.imapVerifiedAt?['warn','Empfang prüfen']:['warn','Versand prüfen'];
    element.innerHTML=`<button type="button" class="cc-connection ${state[0]}" data-mail-settings title="${esc(account?.email||'Postfach-Einstellungen')}"><span class="cc-connection-dot"></span><span><strong>${esc(state[1])}</strong><small>${esc(account?.email||'IMAP & SMTP')}${account?.lastSyncAt?' · '+esc(when(account.lastSyncAt)):''}</small></span></button>
      <button type="button" class="cc-icon-btn" data-mail-sync ${synthetic||!account?.imapVerifiedAt?'disabled':''} aria-label="Neue E-Mails abrufen" title="Neue E-Mails abrufen">${icon('sync')}</button>
      <button type="button" class="cc-icon-btn" data-mail-settings aria-label="Postfach-Einstellungen" title="Postfach-Einstellungen">${icon('settings')}</button>`;
  }
  function navButton({id,label,iconName,count=0,unread=0,active=false,attrs=''}){
    return `<button type="button" class="cc-nav-item ${active?'active':''}" ${attrs} ${active?'aria-current="page"':''}>${icon(iconName)}<span class="cc-nav-label">${esc(label)}</span>${unread?`<span class="cc-count strong" aria-label="${unread} ungelesen">${unread}</span>`:count?`<span class="cc-count">${count}</span>`:''}</button>`;
  }
  function drawRail(){
    const element=region('rail');if(!element)return;const today=dayKey(Date.now()),todayCount=appointments().filter(order=>dayKey(order.appointment.start)===today).length;
    const mailNav=FOLDERS.map(([id,label,iconName])=>{const c=id==='Drafts'?{total:data?.drafts?.length??0,unread:0}:counts(id);return navButton({id,label,iconName,count:['INBOX','Archive','Spam','Trash'].includes(id)?0:c.total,unread:['INBOX','Unread'].includes(id)?c.unread||(id==='Unread'?c.total:0):['Archive','Spam'].includes(id)?c.unread:0,active:ui.section==='mail'&&ui.folder===id,attrs:`data-mail-folder="${id}"`});}).join('');
    const custom=(data?.folders??[]).map(item=>`<div class="cc-nav-row">${navButton({label:item.name,iconName:'folder',count:counts(item.name).total,unread:counts(item.name).unread,active:ui.section==='mail'&&ui.folder===item.name,attrs:`data-mail-folder="${esc(item.name)}"`})}${synthetic?'':`<button type="button" class="cc-nav-remove" data-mail-folder-delete="${item.id}" aria-label="Ordner ${esc(item.name)} entfernen" title="Ordner entfernen (E-Mails kehren zurück)">${icon('close')}</button>`}</div>`).join('');
    element.innerHTML=`<button type="button" class="primary cc-compose-btn" data-mail-compose>${icon('plus')}<span>Neue E-Mail</span></button>
      <nav class="cc-nav" aria-label="Übersicht">${navButton({label:'Übersicht',iconName:'home',active:ui.section==='home',attrs:'data-cc-section="home"'})}</nav>
      <nav class="cc-nav" aria-label="E-Mail-Ordner"><span class="cc-nav-heading">E-Mail</span>${mailNav}
        ${navButton({label:'Aufgaben',iconName:'task',count:(data?.tasks??[]).filter(task=>!task.done).length,active:ui.section==='tasks',attrs:'data-mail-tasks'})}
        ${navButton({label:'Notizen',iconName:'note',count:data?.notes?.length??0,active:ui.section==='notes',attrs:'data-mail-notes'})}
      </nav>
      <div class="cc-nav"><span class="cc-nav-heading">Eigene Ordner</span>${custom||'<small class="cc-nav-empty">Noch keine eigenen Ordner</small>'}<form class="cc-new-folder" data-mail-new-folder><input name="name" maxlength="60" required placeholder="Neuer Ordner" aria-label="Name für eigenen Ordner"><button type="submit" class="cc-icon-btn" aria-label="Ordner anlegen">${icon('plus')}</button></form></div>
      <nav class="cc-nav" aria-label="CRM"><span class="cc-nav-heading">CRM</span>
        ${navButton({label:'Laufende Aufträge',iconName:'car',count:running().length,active:ui.section==='orders',attrs:'data-cc-section="orders"'})}
        ${navButton({label:'Kalender',iconName:'calendar',count:todayCount,active:ui.section==='calendar',attrs:'data-cc-section="calendar"'})}
        <button type="button" class="cc-nav-item cc-nav-out" data-view="whatsapp">${icon('chat')}<span class="cc-nav-label">WhatsApp</span>${icon('arrow','cc-out')}</button>
        <button type="button" class="cc-nav-item cc-nav-out" data-view="customers">${icon('people')}<span class="cc-nav-label">Kunden</span>${icon('arrow','cc-out')}</button>
      </nav>
      <p class="cc-rail-note">${icon('lock')}Ordner und Markierungen gelten im Panel. Das Postfach beim Anbieter bleibt unverändert.</p>`;
    markSaved(element);
  }
  function drawMain(){
    const element=region('main');if(!element)return;const title=$('[data-cc-title]');if(title)title.textContent=sectionTitle();$('[data-cc]')?.setAttribute('data-section',ui.section);
    disconnectObserver();
    if(ui.section==='mail'){element.innerHTML=`<div class="cc-mail ${ui.openId?'has-detail':''}"><section class="cc-list" data-region="list" aria-label="Nachrichtenliste"></section><section class="cc-reader" data-region="reader" aria-label="Nachricht"></section></div>`;drawList();drawReader();return;}
    element.innerHTML=ui.section==='orders'?ordersHTML():ui.section==='calendar'?calendarHTML():ui.section==='notes'?notesHTML():ui.section==='tasks'?tasksHTML():homeHTML();markSaved(element);
  }
  function empty(title,body,iconName='inbox',action=''){return `<div class="cc-empty">${icon(iconName,'cc-empty-icon')}<h3>${esc(title)}</h3><p>${esc(body)}</p>${action}</div>`;}
  function skeleton(rows=6){return `<div class="cc-skeleton" aria-hidden="true">${Array.from({length:rows},()=>'<div class="cc-skeleton-row"><span class="cc-skeleton-avatar"></span><span><i></i><i></i><i></i></span></div>').join('')}</div><p class="visually-hidden">Wird geladen …</p>`;}

  // ---------- Übersicht ----------
  function homeHTML(){
    const account=data?.account,unreadMails=list.slice(0,6),agenda=appointments().filter(order=>new Date(order.appointment.end??order.appointment.start).getTime()>=Date.now()-3600000).slice(0,5),active=running().slice(0,5),notes=(data?.notes??[]).slice(0,4),today=dayKey(Date.now());
    const kpi=(label,value,hint,attrs)=>`<button type="button" class="cc-kpi" ${attrs}><span>${esc(label)}</span><strong>${value}</strong><small>${esc(hint)}</small></button>`;
    return `<div class="cc-home">
      ${account?'':`<div class="cc-setup">${icon('lock')}<div><strong>Postfach verbinden</strong><p>IMAP-Empfang und SMTP-Versand werden getrennt geprüft. Zugangsdaten bleiben verschlüsselt auf dem Server.</p></div><button type="button" class="primary" data-mail-settings>Jetzt einrichten</button></div>`}
      <div class="cc-kpis">${kpi('Ungelesen',counts('Unread').total,'E-Mails ohne Lesestatus','data-mail-folder="Unread"')}${kpi('Wichtig',counts('Flagged').total,'Markierte Nachrichten','data-mail-folder="Flagged"')}${kpi('Laufende Aufträge',running().length,'Angenommen · terminiert · in Arbeit','data-cc-section="orders"')}${kpi('Termine heute',appointments().filter(order=>dayKey(order.appointment.start)===today).length,'Aus den Aufträgen','data-cc-section="calendar"')}${kpi('Entwürfe',data?.drafts?.length??0,'Begonnene E-Mails','data-mail-folder="Drafts"')}</div>
      <div class="cc-home-grid">
        <section class="cc-panel"><header><h2>${icon('unread')}Ungelesene E-Mails</h2><button type="button" class="cc-link" data-mail-folder="INBOX">Posteingang öffnen ${icon('arrow')}</button></header>${listState==='loading'?skeleton(3):unreadMails.length?`<div class="cc-mini-list">${unreadMails.map(mail=>`<button type="button" class="cc-mini-mail" data-mail-open="${mail.id}">${avatar(partnerOf(mail).name,partnerOf(mail).address)}<span><strong>${esc(mail.fromName||mail.fromAddress)}</strong><span>${esc(mail.subject)}</span></span><time>${esc(when(mail.receivedAt))}</time></button>`).join('')}</div>`:empty('Alles gelesen','Keine ungelesenen E-Mails im Posteingang.','check')}</section>
        <section class="cc-panel"><header><h2>${icon('calendar')}Heute & demnächst</h2><button type="button" class="cc-link" data-cc-section="calendar">Kalender ${icon('arrow')}</button></header>${agenda.length?`<div class="cc-mini-list">${agenda.map(order=>`<button type="button" class="cc-mini-event" data-order="${esc(order.id)}"><span class="cc-date-badge"><small>${esc(fmt.dayShort.format(new Date(order.appointment.start)))}</small><strong>${esc(fmt.dayNumber.format(new Date(order.appointment.start)))}</strong></span><span><strong>${esc(fmt.time.format(new Date(order.appointment.start)))} · ${esc(order.source?.name||'Ohne Namen')}</strong><span>${esc([order.source?.vehicle,order.wg].filter(Boolean).join(' · '))}</span></span></button>`).join('')}</div>`:empty('Keine anstehenden Termine','Neue Termine entstehen im Auftrag.','calendar')}</section>
        <section class="cc-panel"><header><h2>${icon('car')}Laufende Aufträge</h2><button type="button" class="cc-link" data-cc-section="orders">Alle ${icon('arrow')}</button></header>${active.length?`<div class="cc-mini-list">${active.map(order=>`<button type="button" class="cc-mini-order" data-order="${esc(order.id)}"><span class="cc-status-dot ${order.status==='In Arbeit'?'running':order.status==='Termin verbindlich'?'confirmed':'open'}"></span><span><strong>${esc(order.wg)} · ${esc(order.source?.name||'Ohne Namen')}</strong><span>${esc(order.status)} · ${esc(NEXT_STEP[order.status]??'')}</span></span></button>`).join('')}</div>`:empty('Keine laufenden Aufträge','Angenommene Aufträge erscheinen hier automatisch.','car')}</section>
        <section class="cc-panel"><header><h2>${icon('note')}Notizen</h2><button type="button" class="cc-link" data-mail-notes>Alle ${icon('arrow')}</button></header>${notes.length?`<div class="cc-mini-notes">${notes.map(note=>`<article>${note.pinned?icon('pin','cc-pinned'):''}<p>${esc(note.body.slice(0,180))}</p><small>${esc(when(note.updatedAt))}${note.wg?' · '+esc(note.wg):''}</small></article>`).join('')}</div>`:empty('Noch keine Notizen','Halte Rückrufe und Absprachen direkt fest.','note','<button type="button" class="smallbtn" data-mail-notes>Notiz erstellen</button>')}</section>
      </div></div>`;
  }

  // ---------- E-Mail-Liste ----------
  function drawList(){
    const element=region('list');if(!element)return;
    if(ui.folder==='Drafts'){element.innerHTML=`<div class="cc-list-head"><div><h2>Entwürfe</h2><small>${plural(data?.drafts?.length??0,'Entwurf','Entwürfe')}</small></div></div><div class="cc-items" data-region="items">${(data?.drafts??[]).length?data.drafts.map(draft=>`<div class="cc-row" role="button" tabindex="0" data-mail-draft="${draft.id}">${avatar('',draft.to||'?')}<div class="cc-row-body"><div class="cc-row-top"><strong class="cc-sender">${esc(draft.to||'Ohne Empfänger')}</strong><time>${esc(when(draft.updatedAt))}</time></div><div class="cc-row-subject">${esc(draft.subject||'(Ohne Betreff)')}</div><div class="cc-row-preview">${esc(draft.text.slice(0,160)||'Noch kein Nachrichtentext')}</div><div class="cc-row-tags"><span class="cc-tag warn">Entwurf</span>${draft.attachments.length?`<span class="cc-tag">${icon('clip')}${draft.attachments.length}</span>`:''}</div></div></div>`).join(''):empty('Keine Entwürfe','Begonnene E-Mails lassen sich im Editor als Entwurf speichern.','draft')}</div>`;return;}
    const label=FOLDER_LABEL[ui.folder]??ui.folder,c=counts(ui.folder);
    element.innerHTML=`<div class="cc-list-head"><div><h2>${esc(label)}</h2><small data-cc-list-count>${listCountText(c)}</small></div><button type="button" class="cc-toggle ${selectMode?'active':''}" data-mail-select-mode aria-pressed="${selectMode}">${icon('check')}<span>Auswählen</span></button></div>
      <div class="cc-search">${icon('search','cc-search-icon')}<input type="search" value="${esc(ui.query)}" placeholder="Absender, Betreff oder Inhalt suchen" aria-label="E-Mails durchsuchen" data-mail-search enterkeyhint="search" autocomplete="off"><select aria-label="Sortierung" data-mail-sort><option value="newest" ${ui.sort==='newest'?'selected':''}>Neueste zuerst</option><option value="oldest" ${ui.sort==='oldest'?'selected':''}>Älteste zuerst</option><option value="sender" ${ui.sort==='sender'?'selected':''}>Nach Absender</option></select></div>
      <div class="cc-chips" role="group" aria-label="Filter">${FILTERS.map(([id,text])=>`<button type="button" class="cc-chip ${ui.filter===id?'active':''}" data-mail-filter="${id}" aria-pressed="${ui.filter===id}">${esc(text)}</button>`).join('')}</div>
      <div class="cc-bulk" data-region="bulk" ${selection.size?'':'hidden'}></div>
      <div class="cc-items" data-region="items" role="list" aria-busy="${listState==='loading'}"></div>`;
    drawBulk();drawItems();
  }
  function listCountText(c){return listState==='loading'?'Wird geladen …':`${plural(total,'E-Mail','E-Mails')}${ui.query||ui.filter!=='all'?' gefunden':''}${c.unread&&!ui.query&&ui.filter==='all'?' · '+c.unread+' ungelesen':''}`;}
  function rowHTML(mail){
    const partner=partnerOf(mail),name=mail.direction==='INBOUND'?mail.fromName||mail.fromAddress:'An: '+(mail.to.map(item=>item.name||item.address).join(', ')||'—'),selected=selection.has(mail.id);
    const tags=[mail.crm?.order?`<span class="cc-tag crm">${icon('car')}${esc(mail.crm.order)}${mail.crm.status?' · '+esc(mail.crm.status):''}</span>`:'',mail.crm?.customer&&!mail.crm?.order?`<span class="cc-tag crm">${icon('people')}${esc(mail.crm.customer)}</span>`:'',['Unread','Flagged','all'].includes(ui.folder)||ui.query?`<span class="cc-tag">${esc(FOLDER_LABEL[mail.folder]??mail.folder)}</span>`:'',mail.receiptCount?'<span class="cc-tag warn">Beleg</span>':''].join('');
    return `<div class="cc-row ${mail.read?'':'unread'} ${ui.openId===mail.id?'active':''} ${selected?'selected':''}" role="listitem" tabindex="0" data-mail-open="${mail.id}" aria-label="${esc((mail.read?'':'Ungelesen, ')+name+', '+mail.subject)}">
      <label class="cc-row-check ${selectMode?'visible':''}" data-mail-quick><input type="checkbox" data-mail-select="${mail.id}" ${selected?'checked':''} aria-label="Auswählen"></label>
      ${avatar(partner.name,partner.address)}
      <div class="cc-row-body"><div class="cc-row-top"><strong class="cc-sender">${esc(name)}</strong><span class="cc-row-icons">${mail.attachmentCount?icon('clip','cc-mini'):''}${mail.flagged?icon('star','cc-mini cc-flagged'):''}</span><time datetime="${esc(mail.receivedAt)}">${esc(when(mail.receivedAt))}</time></div>
      <div class="cc-row-subject">${mail.isReply?'<span class="cc-reply-mark">↩</span>':''}${esc(mail.subject)}</div><div class="cc-row-preview">${esc(mail.preview||'Keine Textvorschau')}</div>${tags?`<div class="cc-row-tags">${tags}</div>`:''}</div>
      <div class="cc-row-actions" data-mail-quick><button type="button" data-mail-quick-action="read" data-id="${mail.id}" aria-label="${mail.read?'Als ungelesen markieren':'Als gelesen markieren'}" title="${mail.read?'Ungelesen':'Gelesen'}">${icon('unread')}</button><button type="button" data-mail-quick-action="flag" data-id="${mail.id}" aria-label="${mail.flagged?'Markierung entfernen':'Als wichtig markieren'}" title="Wichtig">${icon('star')}</button><button type="button" data-mail-quick-action="archive" data-id="${mail.id}" aria-label="Archivieren" title="Archivieren">${icon('archive')}</button><button type="button" data-mail-quick-action="trash" data-id="${mail.id}" aria-label="In den Papierkorb" title="Löschen">${icon('trash')}</button></div></div>`;
  }
  function drawItems(){
    const element=region('items');if(!element)return;const count=$('[data-cc-list-count]');if(count)count.textContent=listCountText(counts(ui.folder));element.setAttribute('aria-busy',String(listState==='loading'));disconnectObserver();
    if(listState==='loading'&&!list.length){element.innerHTML=skeleton();return;}
    if(listState==='error'){element.innerHTML=empty('Liste konnte nicht geladen werden',listError,'spam','<button type="button" class="smallbtn" data-mail-refresh>Erneut versuchen</button>');return;}
    if(!list.length){element.innerHTML=ui.query||ui.filter!=='all'?empty('Keine E-Mails gefunden','Passen Sie Suche oder Filter an.','search','<button type="button" class="smallbtn" data-mail-reset>Suche zurücksetzen</button>'):empty(ui.folder==='INBOX'?'Posteingang ist leer':'Keine Nachrichten',ui.folder==='INBOX'&&!data?.account?'Verbinden Sie zuerst das Postfach.':'Dieser Bereich enthält derzeit keine Nachrichten.','inbox',ui.folder==='INBOX'&&!data?.account?'<button type="button" class="smallbtn" data-mail-settings>Postfach einrichten</button>':'');return;}
    element.innerHTML=list.map(rowHTML).join('')+(list.length<total?`<div class="cc-more"><button type="button" class="smallbtn" data-mail-more>Weitere laden · ${list.length} von ${total}</button></div>`:list.length>20?`<p class="cc-end">Alle ${total} E-Mails geladen</p>`:'');
    const more=element.querySelector('[data-mail-more]');
    if(more&&typeof window.IntersectionObserver==='function'){observer=new window.IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))loadMore();},{rootMargin:'0px 0px 240px 0px'});observer.observe(more);}
  }
  function disconnectObserver(){observer?.disconnect();observer=null;}
  let loadingMore=false;
  async function loadMore(){if(loadingMore||list.length>=total)return;loadingMore=true;try{await load({append:true});drawItems();}catch(error){message(error.message,true);}finally{loadingMore=false;}}
  function drawBulk(){
    const element=region('bulk');if(!element)return;const show=selectMode||selection.size>0;element.hidden=!show;if(!show){element.innerHTML='';return;}
    if(!selection.size){element.innerHTML=`<strong>Nachrichten auswählen</strong><div><button type="button" class="smallbtn" data-mail-bulk="all">Alle sichtbaren</button></div>`;return;}
    element.innerHTML=`<strong>${selection.size} ausgewählt</strong><div><button type="button" class="smallbtn" data-mail-bulk="read">Gelesen</button><button type="button" class="smallbtn" data-mail-bulk="unread">Ungelesen</button><button type="button" class="smallbtn" data-mail-bulk="flag">Wichtig</button><button type="button" class="smallbtn" data-mail-bulk="archive">Archivieren</button><button type="button" class="smallbtn danger" data-mail-bulk="trash">Löschen</button>${moveSelect('data-mail-bulk-move')}<button type="button" class="smallbtn" data-mail-bulk="all">Alle sichtbaren</button><button type="button" class="smallbtn" data-mail-bulk="none">Aufheben</button></div>`;
  }
  function moveSelect(attribute){return `<select ${attribute} aria-label="In Ordner verschieben"><option value="">Verschieben …</option>${MOVE_TARGETS.map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}${(data?.folders??[]).map(item=>`<option value="${esc(item.name)}">${esc(item.name)}</option>`).join('')}</select>`;}

  // ---------- Lesebereich ----------
  function imagesShown(mail){return ui.images.has(mail.id)||(imagesAuto()&&!ui.hiddenImages.has(mail.id));}
  function moreMenu(mail){
    const item=(attrs,iconName,label)=>`<button type="button" role="menuitem" ${attrs}>${icon(iconName)}<span>${label}</span></button>`;
    return `<details class="cc-more-menu"><summary class="cc-icon-btn" aria-label="Weitere Aktionen" title="Mehr">${icon('menu')}</summary><div class="cc-menu" role="menu">
      ${item('data-mail-state="read"','unread',mail.read?'Als ungelesen markieren':'Als gelesen markieren')}
      ${item('data-mail-note-here','note','Notiz zu dieser E-Mail')}
      ${mail.hasHtml?item('data-mail-images-toggle',imagesShown(mail)?'eye':'eye',imagesShown(mail)?'Bilder ausblenden':'Bilder anzeigen'):''}
      <span class="cc-menu-label">Verschieben nach</span>
      ${[...MOVE_TARGETS,...(data?.folders??[]).map(folder=>[folder.name,folder.name])].filter(([id])=>id!==mail.folder).map(([id,label])=>item(`data-mail-move-to="${esc(id)}"`,id==='Trash'?'trash':id==='Archive'?'archive':id==='Spam'?'spam':id==='INBOX'?'inbox':'folder',esc(label))).join('')}
    </div></details>`;
  }
  function drawReader(){
    const element=region('reader');if(!element)return;$('.cc-mail')?.classList.toggle('has-detail',Boolean(ui.openId));
    if(!ui.openId){element.innerHTML=empty('Keine Nachricht ausgewählt','Wählen Sie eine E-Mail. Verlauf, Anhänge und passende CRM-Vorgänge erscheinen hier.','unread');return;}
    if(detailState==='loading'||!detail){element.innerHTML=detailState==='error'?`<div class="cc-reader-bar"><button type="button" class="cc-icon-btn cc-back" data-mail-close aria-label="Zurück zur Liste">${icon('back')}</button></div>${empty('E-Mail konnte nicht geöffnet werden',detailError,'spam','<button type="button" class="smallbtn" data-mail-retry>Erneut versuchen</button>')}`:`<div class="cc-reader-loading" aria-hidden="true"><i></i><i></i><i></i><i></i></div><p class="visually-hidden">E-Mail wird geladen …</p>`;return;}
    const mail=detail.message,inbound=mail.direction==='INBOUND',sender=inbound?{name:mail.fromName,address:mail.fromAddress}:{name:data?.account?.displayName||'White Gloss',address:mail.fromAddress},imagesAllowed=imagesShown(mail);
    const recipients=(label,items)=>items?.length?`<div><dt>${label}</dt><dd>${items.map(item=>esc(item.name?`${item.name} <${item.address}>`:item.address)).join(', ')}</dd></div>`:'';
    const blocked=mail.hasHtml&&mail.blockedImages&&!imagesAllowed?`<div class="cc-images-blocked">${icon('eye')}<span>${plural(mail.blockedImages,'Bild ist','Bilder sind')} ausgeblendet.</span><button type="button" class="smallbtn" data-mail-images>Bilder anzeigen</button></div>`:'';
    const frame=mail.hasHtml?`${blocked}<iframe class="cc-frame" data-mail-frame title="Inhalt der E-Mail" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" src="/api/mailbox/message/${mail.id}/view?images=${imagesAllowed?'1':'0'}${synthetic?'&amp;test=true':''}"></iframe>`:`<div class="mail-plaintext cc-plaintext">${mail.textBody?linkify(mail.textBody):'Diese E-Mail enthält keinen lesbaren Text.'}</div>`;
    const archived=mail.folder==='Archive',trashed=mail.folder==='Trash';
    element.innerHTML=`<article class="cc-reader-inner">
      <div class="cc-reader-bar"><button type="button" class="cc-icon-btn cc-back" data-mail-close aria-label="Zurück zur Liste">${icon('back')}</button>
        <div class="cc-reader-actions">${inbound?`<button type="button" class="primary" data-mail-reply>${icon('reply')}<span>Antworten</span></button><button type="button" class="cc-icon-btn" data-mail-reply-all aria-label="Allen antworten" title="Allen antworten">${icon('replyAll')}</button>`:''}<button type="button" class="cc-icon-btn" data-mail-forward aria-label="Weiterleiten" title="Weiterleiten">${icon('forward')}</button></div>
        <div class="cc-reader-tools"><button type="button" class="cc-icon-btn ${mail.flagged?'active':''}" data-mail-state="flagged" aria-pressed="${mail.flagged}" aria-label="${mail.flagged?'Markierung entfernen':'Als wichtig markieren'}" title="Wichtig">${icon('star')}</button>${archived?'':`<button type="button" class="cc-icon-btn" data-mail-move-to="Archive" aria-label="Archivieren" title="Archivieren">${icon('archive')}</button>`}<button type="button" class="cc-icon-btn" data-mail-move-to="${trashed?'':'Trash'}" aria-label="${trashed?'Wiederherstellen':'In den Papierkorb'}" title="${trashed?'Wiederherstellen':'Löschen'}">${icon(trashed?'inbox':'trash')}</button>${moreMenu(mail)}</div></div>
      <header class="cc-message-head"><h2>${esc(mail.subject)}</h2>
        <div class="cc-sender-block">${avatar(sender.name,sender.address,'large')}<div><strong>${esc(sender.name||sender.address)}</strong>${sender.name?`<span>&lt;${esc(sender.address)}&gt;</span>`:''}<details class="cc-recipients-toggle"><summary>an ${esc(mail.to.map(item=>item.name||item.address).join(', ')||'—')}${mail.cc?.length?' · Cc '+mail.cc.length:''}</summary><dl class="cc-recipients">${recipients('An',mail.to)}${recipients('Cc',mail.cc)}${recipients('Bcc',mail.bcc)}${mail.replyTo?.length&&mail.replyTo[0].address!==mail.fromAddress?recipients('Antwort an',mail.replyTo):''}</dl></details></div><time datetime="${esc(mail.receivedAt)}">${esc(full(mail.receivedAt))}</time></div>
        ${mail.flagged||!inbound||mail.folder!=='INBOX'?`<div class="cc-message-tags">${mail.folder!=='INBOX'?`<span class="cc-tag">${esc(FOLDER_LABEL[mail.folder]??mail.folder)}</span>`:''}${mail.flagged?'<span class="cc-tag warn">Wichtig</span>':''}${inbound?'':'<span class="cc-tag">Ausgehend</span>'}</div>`:''}</header>
      ${crmHTML()}
      ${photosHTML()}
      <div class="cc-body">${frame}${mail.restoreError&&mail.hasHtml?`<p class="cc-restore-note">Originaldarstellung derzeit nicht abrufbar (${esc(mail.restoreError)}). Angezeigt wird der beim Empfang gespeicherte Stand.</p>`:''}</div>
      ${attachmentsHTML()}${threadHTML()}
      ${inbound?`<details class="cc-ai"><summary>${icon('chat')}<span>KI-Antwortvorschlag</span></summary><div class="mail-ai-replies"><small>Der Nachrichtentext wird erst nach Ihrem Klick übertragen. Es wird nichts versendet; der Entwurf öffnet sich im Editor.</small><div>${STYLES.map(([id,label])=>`<button type="button" class="smallbtn" data-mail-ai="${id}">${label}</button>`).join('')}</div></div></details>`:''}
    </article>`;
    const iframe=element.querySelector('[data-mail-frame]');if(iframe)iframe.addEventListener('load',()=>fitFrame(iframe));
  }
  // Volle Höhe: der Inhalt erscheint komplett ohne eigenen Scrollbereich, auch wenn Bilder später laden.
  let frameObserver=null;
  function fitFrame(frame){
    frameObserver?.disconnect();frameObserver=null;
    try{const doc=frame.contentDocument;if(!doc?.documentElement)return;
      // Höhe zuerst auf 0 setzen: Stile wie „min-height:100vh“ messen dann die Inhaltshöhe, nicht die bisherige Rahmenhöhe.
      const fit=()=>{if(!frame.isConnected){frameObserver?.disconnect();return;}const before=frame.style.height;frame.style.height='0px';const height=Math.max(doc.documentElement.scrollHeight,doc.body?.scrollHeight??0),next=Math.min(Math.max(height+2,160),40000)+'px';frame.style.height=next===before?before:next;};
      fit();
      for(const image of doc.images)if(!image.complete){image.addEventListener('load',fit,{once:true});image.addEventListener('error',fit,{once:true});}
      if(typeof window.ResizeObserver==='function'&&doc.body){frameObserver=new window.ResizeObserver(fit);frameObserver.observe(doc.body);}
      setTimeout(fit,400);setTimeout(fit,1500);}catch{/* Ohne Zugriff bleibt die feste Mindesthöhe mit eigenem Scrollbereich. */}
  }
  // Fotos aus Anhängen direkt sichtbar; eingebettete Signaturbilder bleiben in der Nachricht.
  function photosHTML(){
    const photos=detail.attachments.filter(item=>item.archived&&!item.inline&&/^image\/(jpeg|png|webp)$/.test(item.mime));if(!photos.length)return '';
    return `<section class="cc-photos" aria-label="Fotos"><div class="cc-photo-grid ${photos.length===1?'single':''}">${photos.map(item=>`<a href="/api/mailbox/attachment/${item.id}${synthetic?'?test=true':''}" target="_blank" rel="noopener noreferrer" class="cc-photo"><img src="/api/mailbox/attachment/${item.id}${synthetic?'?test=true':''}" alt="${esc(item.filename)}" loading="lazy" decoding="async"></a>`).join('')}</div></section>`;
  }
  function crmHTML(){
    const {customers=[],orders:linked=[]}=detail.crm??{};
    if(!customers.length&&!linked.length)return `<div class="cc-crm cc-crm-none">${icon('people')}<span>Kein CRM-Bezug: Die Adresse ist keinem Kunden oder Auftrag exakt zugeordnet.</span></div>`;
    return `<section class="cc-crm" aria-label="CRM-Zuordnung"><header><span class="eyebrow">CRM · eindeutige Zuordnung</span><small>Nur exakt gespeicherte E-Mail-Adressen und feste Auftragsverknüpfungen</small></header>
      ${customers.map(customer=>`<div class="cc-crm-customer">${avatar(customer.name||customer.company,customer.email)}<div><strong>${esc(customer.name||customer.company||'Kunde')}</strong><span>${esc([customer.company&&customer.name?customer.company:'',customer.city].filter(Boolean).join(' · '))}</span>${customer.vehicles?.length?`<div class="cc-crm-vehicles">${customer.vehicles.map(vehicle=>`<span class="cc-tag">${icon('car')}${esc([vehicle.label,vehicle.plate].filter(Boolean).join(' · ')||'Fahrzeug')}</span>`).join('')}</div>`:''}</div><div class="cc-crm-actions">${customer.phone?`<a class="smallbtn button" href="tel:${esc(customer.phone.replace(/[^+0-9]/g,''))}">Anrufen</a>`:''}<button type="button" class="smallbtn" data-customer="${esc(customer.id)}">Kundenakte</button><button type="button" class="smallbtn" data-cc-note-customer="${esc(customer.id)}">Notiz</button></div></div>`).join('')}
      ${linked.length?`<div class="cc-crm-orders">${linked.map(order=>`<div class="cc-crm-order ${order.running?'running':''}"><span class="cc-status-dot ${order.status==='In Arbeit'?'running':order.running?'confirmed':'open'}"></span><div><strong>${esc(order.wg)} · ${esc(order.status)}</strong><span>${esc([order.vehicle,order.plate].filter(Boolean).join(' · ')||order.name)}${order.appointment?' · Termin '+esc(full(order.appointment.start)):''}</span></div><button type="button" class="smallbtn" data-order="${esc(order.id)}">Auftrag öffnen</button><button type="button" class="smallbtn" data-cc-note-order="${esc(order.id)}">Notiz</button></div>`).join('')}</div>`:''}</section>`;
  }
  function attachmentsHTML(){
    if(!detail.attachments.length)return '';
    const files=detail.attachments.filter(item=>!item.inline);if(!files.length)return '';
    return `<section class="cc-attachments"><h3>${icon('clip')}${plural(files.length,'Anhang','Anhänge')}</h3><div class="cc-attachment-grid">${files.map(item=>`<div class="cc-attachment"><span class="cc-file-icon ${item.mime==='application/pdf'?'pdf':'img'}">${esc(UPLOAD_TYPES[item.mime]??'DATEI')}</span><div><strong title="${esc(item.filename)}">${esc(item.filename)}</strong><small>${esc(size(item.size))}${item.documentId?' · ungeklärter Beleg':item.archived?'':' · Format nicht unterstützt'}</small></div>${item.archived?`<a class="smallbtn button" href="/api/mailbox/attachment/${item.id}${synthetic?'?test=true':''}" target="_blank" rel="noopener noreferrer">Öffnen</a><a class="smallbtn button" href="/api/mailbox/attachment/${item.id}?download=1${synthetic?'&amp;test=true':''}" download>Laden</a>`:''}${item.documentId?'<button type="button" class="smallbtn" data-view="finance-receipts">Belegprüfung</button>':''}</div>`).join('')}</div></section>`;
  }
  function threadHTML(){
    if(detail.thread.length<2)return '';
    return `<section class="cc-thread"><h3>Unterhaltung · ${detail.thread.length} Nachrichten</h3>${detail.thread.map(item=>{const own=item.direction==='OUTBOUND';return `<button type="button" class="cc-thread-item ${item.id===detail.message.id?'active':''} ${item.read?'':'unread'}" data-mail-open="${item.id}">${avatar(own?'White Gloss':item.fromName,own?ownAddress():item.fromAddress)}<span><strong>${esc(own?'Sie':item.fromName||item.fromAddress)}</strong><span>${esc(item.preview||item.subject)}</span></span><time>${esc(when(item.receivedAt))}</time></button>`;}).join('')}</section>`;
  }

  // ---------- Laufende Aufträge ----------
  function ordersHTML(){
    const q=ui.orderQuery.trim().toLowerCase(),items=running().filter(order=>!q||[order.wg,order.source?.name,order.source?.vehicle,order.source?.plate,order.source?.email,order.status].join(' ').toLowerCase().includes(q));
    return `<div class="cc-section"><div class="cc-section-head"><div><h2>Laufende Aufträge</h2><small>Angenommen, terminiert oder in Arbeit · ${running().length} insgesamt</small></div><div class="cc-section-tools"><input type="search" value="${esc(ui.orderQuery)}" placeholder="Auftrag, Kunde, Fahrzeug" aria-label="Laufende Aufträge durchsuchen" data-cc-order-search><button type="button" class="smallbtn" data-view="active">Vollansicht ${icon('arrow')}</button></div></div>
      ${items.length?`<div class="cc-order-grid">${items.map(order=>{const email=order.source?.email;return `<article class="cc-order-card"><header><span class="cc-status-dot ${order.status==='In Arbeit'?'running':order.status==='Termin verbindlich'?'confirmed':'open'}"></span><strong>${esc(order.wg)}</strong><span class="cc-tag">${esc(order.status)}</span></header><h3>${esc(order.source?.name||'Ohne Namen')}</h3><p>${esc([order.source?.vehicle,order.source?.plate].filter(Boolean).join(' · ')||'Fahrzeug nicht angegeben')}</p><dl><div><dt>Termin</dt><dd>${order.appointment?.start?esc(full(order.appointment.start)):'Noch offen'}</dd></div><div><dt>Nächster Schritt</dt><dd>${esc(NEXT_STEP[order.status]??'—')}</dd></div></dl><footer><button type="button" class="smallbtn primary" data-order="${esc(order.id)}">Öffnen</button>${email?`<button type="button" class="smallbtn" data-cc-mail-to="${esc(email)}" data-cc-subject="${esc('Ihr Auftrag '+order.wg)}">E-Mail schreiben</button><button type="button" class="smallbtn" data-cc-mail-search="${esc(email)}">E-Mails</button>`:''}<button type="button" class="smallbtn" data-cc-note-order="${esc(order.id)}">Notiz</button></footer></article>`;}).join('')}</div>`:empty(q?'Kein Treffer':'Keine laufenden Aufträge',q?'Suchbegriff anpassen.':'Angenommene, terminierte und laufende Aufträge erscheinen hier automatisch.','car')}</div>`;
  }

  // ---------- Kalender ----------
  function calendarHTML(){
    const today=dayKey(Date.now()),events=appointments(),days=[];const start=new Date(today+'T12:00:00Z');
    for(let index=0;index<14;index++){const day=new Date(start);day.setUTCDate(start.getUTCDate()+index);const key=day.toISOString().slice(0,10);days.push({key,count:events.filter(order=>dayKey(order.appointment.start)===key).length,date:day});}
    const selected=ui.calendarDay,upcoming=events.filter(order=>selected?dayKey(order.appointment.start)===selected:dayKey(order.appointment.start)>=today),groups=new Map();
    for(const order of upcoming.slice(0,60)){const key=dayKey(order.appointment.start);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(order);}
    const unscheduled=running().filter(order=>!order.appointment?.start);
    const dayName=new Intl.DateTimeFormat('de-DE',{timeZone:'UTC',weekday:'short'}),dayNum=new Intl.DateTimeFormat('de-DE',{timeZone:'UTC',day:'numeric'}),label=new Intl.DateTimeFormat('de-DE',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long'});
    return `<div class="cc-section"><div class="cc-section-head"><div><h2>Kalender</h2><small>Termine aus Ihren Aufträgen · Europe/Berlin</small></div><div class="cc-section-tools"><a class="smallbtn button" href="/api/calendar.ics${synthetic?'?test=true':''}" download>Exportieren</a><button type="button" class="smallbtn" data-view="calendar">Monatskalender ${icon('arrow')}</button></div></div>
      <div class="cc-week" role="group" aria-label="Die nächsten 14 Tage">${days.map(day=>`<button type="button" class="cc-day ${day.key===today?'today':''} ${selected===day.key?'active':''} ${day.count?'busy':''}" data-cc-day="${day.key}" aria-pressed="${selected===day.key}" aria-label="${esc(label.format(day.date))}: ${plural(day.count,'Termin','Termine')}"><small>${esc(dayName.format(day.date))}</small><strong>${esc(dayNum.format(day.date))}</strong><span>${day.count||''}</span></button>`).join('')}</div>
      ${selected?`<p class="cc-filter-note">Gefiltert auf ${esc(label.format(new Date(selected+'T12:00:00Z')))} · <button type="button" class="cc-link" data-cc-day="">Alle anstehenden zeigen</button></p>`:''}
      <div class="cc-agenda">${groups.size?[...groups].map(([key,items])=>`<section><h3>${key===today?'Heute · ':''}${esc(label.format(new Date(key+'T12:00:00Z')))}</h3>${items.map(order=>{const confirmed=Boolean(order.appointment?.confirmation)||['Termin verbindlich','In Arbeit','Erledigt','Bezahlt'].includes(order.status);return `<article class="cc-event ${confirmed?'confirmed':'proposed'} ${order.status==='In Arbeit'?'running':''}"><div class="cc-event-time"><strong>${esc(fmt.time.format(new Date(order.appointment.start)))}</strong><small>${valid(order.appointment.end)?'bis '+esc(fmt.time.format(new Date(order.appointment.end))):''}</small></div><div class="cc-event-body"><strong>${esc(order.source?.name||'Ohne Namen')}</strong><span>${esc([order.source?.vehicle,order.wg].filter(Boolean).join(' · '))}</span><span class="cc-tag ${confirmed?'good':'warn'}">${confirmed?esc(order.status):'Terminvorschlag'}</span></div><div class="cc-event-actions"><button type="button" class="smallbtn" data-order="${esc(order.id)}">Auftrag</button>${order.source?.email?`<button type="button" class="smallbtn" data-cc-mail-to="${esc(order.source.email)}" data-cc-subject="${esc('Ihr Termin · '+order.wg)}">E-Mail</button>`:''}</div></article>`;}).join('')}</section>`).join(''):empty(selected?'Keine Termine an diesem Tag':'Keine anstehenden Termine','Termine werden im Auftrag festgelegt und erscheinen hier automatisch.','calendar')}</div>
      ${unscheduled.length?`<section class="cc-unscheduled"><h3>Laufend ohne Termin · ${unscheduled.length}</h3>${unscheduled.map(order=>`<button type="button" class="cc-mini-order" data-order="${esc(order.id)}"><span class="cc-status-dot open"></span><span><strong>${esc(order.wg)} · ${esc(order.source?.name||'Ohne Namen')}</strong><span>${esc(NEXT_STEP[order.status]??order.status)}</span></span></button>`).join('')}</section>`:''}</div>`;
  }

  // ---------- Aufgaben, mit Notizen darunter ----------
  let taskDraft={id:null,title:'',body:'',due:'',important:false};
  function tasksHTML(){
    const tasks=data?.tasks??[],open=tasks.filter(task=>!task.done),done=tasks.filter(task=>task.done);
    const row=task=>`<article class="cc-task ${task.done?'done':''} ${task.important?'important':''}"><button type="button" class="cc-task-check ${task.done?'on':''}" data-task-done="${task.id}" aria-pressed="${task.done}" aria-label="${task.done?'Als offen markieren':'Als erledigt markieren'}">${icon('check')}</button><div class="cc-task-body"><strong>${esc(task.title)}</strong>${task.body?`<p>${esc(task.body)}</p>`:''}<small>${task.due?esc(task.due):'Ohne Datum'}${task.wg?' · '+esc(task.wg):''}${task.important?' · Wichtig':''}</small></div><div class="cc-task-tools"><button type="button" class="smallbtn" data-task-edit="${task.id}">Bearbeiten</button><button type="button" class="smallbtn danger" data-task-delete="${task.id}">${confirmDelete===task.id?'Wirklich löschen?':'Löschen'}</button></div></article>`;
    return `<div class="cc-section cc-tasks"><div class="cc-section-head"><div><h2>Aufgaben</h2><small>Eigene Liste, wie eine To-do-Liste. Es wird nichts versendet.</small></div></div>
      <form id="mail-task-form" class="cc-note-editor"><input type="hidden" name="taskId" value="${esc(taskDraft.id??'')}">
        <label class="visually-hidden" for="cc-task-title">Aufgabe</label><input id="cc-task-title" name="title" maxlength="200" required placeholder="Aufgabe hinzufügen" value="${esc(taskDraft.title)}">
        <label class="visually-hidden" for="cc-task-body">Notiz zur Aufgabe</label><textarea id="cc-task-body" name="body" rows="2" maxlength="10000" placeholder="Notiz zur Aufgabe">${esc(taskDraft.body)}</textarea>
        <div class="cc-note-options"><label>Fällig<input type="date" name="due" value="${esc(taskDraft.due)}"></label><label class="check"><input type="checkbox" name="important" ${taskDraft.important?'checked':''}>Wichtig</label><span class="cc-note-submit">${taskDraft.id?'<button type="button" class="smallbtn" data-task-cancel>Abbrechen</button>':''}<button class="primary" type="submit">${taskDraft.id?'Änderung speichern':'Aufgabe hinzufügen'}</button></span></div></form>
      <div class="cc-task-list" data-region="tasks">${open.length?open.map(row).join(''):empty('Keine offenen Aufgaben','Die erste Aufgabe steht direkt unter den E-Mails.','task')}</div>
      ${done.length?`<details class="cc-task-done"><summary>Erledigt (${done.length})</summary>${done.map(row).join('')}</details>`:''}
      ${notesHTML()}</div>`;
  }
  function openTasks(){taskDraft={id:null,title:'',body:'',due:'',important:false};confirmDelete=null;setSection('tasks');root.querySelector('#cc-task-title')?.focus();}
  function readTaskForm(){const form=root.querySelector('#mail-task-form');if(!form)return {};return {title:form.elements.title.value,body:form.elements.body.value,due:form.elements.due.value,important:form.elements.important.checked};}

  // ---------- Notizen ----------
  let noteDraft={id:null,body:'',orderId:'',customerId:'',messageId:'',pinned:false};
  function notesHTML(){
    const notes=data?.notes??[],q=ui.noteQuery.trim().toLowerCase(),filtered=notes.filter(note=>(ui.noteFilter==='pinned'?note.pinned:ui.noteFilter==='orders'?note.orderId:ui.noteFilter==='mails'?note.messageId:true)&&(!q||[note.body,note.wg,note.subject,note.customerName].join(' ').toLowerCase().includes(q)));
    const orderOptions=[...new Map([...running(),...(detail?.crm?.orders??[]).map(order=>({id:order.id,wg:order.wg,source:{name:order.name}}))].map(order=>[order.id,order])).values()];
    const linkedMail=noteDraft.messageId?(detail?.message?.id===noteDraft.messageId?detail.message.subject:notes.find(note=>note.messageId===noteDraft.messageId)?.subject??'Verknüpfte E-Mail'):'';
    const filterButtons=[['all','Alle'],['pinned','Angeheftet'],['orders','Mit Auftrag'],['mails','Mit E-Mail']];
    return `<div class="cc-section cc-notes"><div class="cc-section-head"><div><h2>Notizen</h2><small>Interne Arbeitsnotizen · nicht für Kunden sichtbar</small></div></div>
      <form id="mail-note-form" class="cc-note-editor"><input type="hidden" name="noteId" value="${esc(noteDraft.id??'')}"><input type="hidden" name="messageId" value="${esc(noteDraft.messageId)}"><input type="hidden" name="customerId" value="${esc(noteDraft.customerId)}">
        <label class="visually-hidden" for="cc-note-body">Notiz</label><textarea id="cc-note-body" name="body" rows="3" maxlength="10000" required placeholder="Notiz schnell erfassen … (Strg/⌘ + Enter speichert)">${esc(noteDraft.body)}</textarea>
        <div class="cc-note-options"><label>Auftrag<select name="orderId"><option value="">Kein Auftrag</option>${orderOptions.map(order=>`<option value="${esc(order.id)}" ${noteDraft.orderId===order.id?'selected':''}>${esc(order.wg)} · ${esc(order.source?.name||'')}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" name="pinned" ${noteDraft.pinned?'checked':''}>Anheften</label>
        ${linkedMail?`<span class="cc-tag">${icon('unread')}${esc(linkedMail)}<button type="button" class="cc-tag-remove" data-cc-note-unlink="message" aria-label="E-Mail-Verknüpfung entfernen">×</button></span>`:detail?`<button type="button" class="smallbtn" data-cc-note-link-mail>Mit geöffneter E-Mail verknüpfen</button>`:''}
        ${noteDraft.customerId?`<span class="cc-tag">${icon('people')}Kunde verknüpft<button type="button" class="cc-tag-remove" data-cc-note-unlink="customer" aria-label="Kundenverknüpfung entfernen">×</button></span>`:''}
        <span class="cc-note-submit">${noteDraft.id?'<button type="button" class="smallbtn" data-cc-note-cancel>Abbrechen</button>':''}<button class="primary" type="submit">${noteDraft.id?'Änderung speichern':'Notiz speichern'}</button></span></div></form>
      <div class="cc-note-tools"><input type="search" value="${esc(ui.noteQuery)}" placeholder="Notizen durchsuchen" aria-label="Notizen durchsuchen" data-cc-note-search><div class="cc-chips">${filterButtons.map(([id,label])=>`<button type="button" class="cc-chip ${ui.noteFilter===id?'active':''}" data-cc-note-filter="${id}" aria-pressed="${ui.noteFilter===id}">${label}</button>`).join('')}</div></div>
      <div class="cc-note-list" data-region="notes">${filtered.length?filtered.map(note=>`<article class="cc-note ${note.pinned?'pinned':''}"><p>${esc(note.body)}</p><footer><small>${esc(when(note.updatedAt))}${note.wg?' · '+esc(note.wg):''}${note.customerName?' · '+esc(note.customerName):''}${note.subject?' · '+esc(note.subject):''}</small><div><button type="button" class="cc-icon-btn ${note.pinned?'active':''}" data-cc-note-pin="${note.id}" aria-pressed="${note.pinned}" aria-label="${note.pinned?'Lösen':'Anheften'}" title="${note.pinned?'Lösen':'Anheften'}">${icon('pin')}</button><button type="button" class="smallbtn" data-note-edit="${note.id}">Bearbeiten</button>${note.orderId?`<button type="button" class="smallbtn" data-order="${note.orderId}">Auftrag</button>`:''}${note.customerId?`<button type="button" class="smallbtn" data-customer="${note.customerId}">Kunde</button>`:''}${note.messageId?`<button type="button" class="smallbtn" data-note-mail="${note.messageId}">E-Mail</button>`:''}<button type="button" class="smallbtn danger" data-note-delete="${note.id}">${confirmDelete===note.id?'Wirklich löschen?':'Löschen'}</button></div></footer></article>`).join(''):empty(notes.length?'Keine passende Notiz':'Noch keine Notizen',notes.length?'Suche oder Filter anpassen.':'Die erste interne Notiz ist schnell erstellt.','note')}</div></div>`;
  }
  function openNotes(values={}){noteDraft={id:null,body:'',orderId:'',customerId:'',messageId:'',pinned:false,...values};confirmDelete=null;setSection('notes');root.querySelector('#cc-note-body')?.focus();}

  // ---------- Editor ----------
  const textToHtml=value=>String(value??'').split(/\n{2,}/).map(block=>`<p>${esc(block).replace(/\n/g,'<br>')}</p>`).join('')||'<p><br></p>';
  function plainText(node){
    let output='';const walk=parent=>{for(const child of parent.childNodes){if(child.nodeType===3){output+=child.nodeValue;continue;}if(child.nodeType!==1)continue;const tag=child.tagName;if(tag==='BR'){output+='\n';continue;}const block=/^(P|DIV|LI|BLOCKQUOTE|UL|OL|H[1-6]|TR|HR)$/.test(tag);if(block&&output&&!output.endsWith('\n'))output+='\n';if(tag==='LI')output+='• ';
      if(tag==='BLOCKQUOTE'){const start=output.length;walk(child);const inner=output.slice(start);output=output.slice(0,start)+inner.split('\n').map(line=>line?'> '+line:line).join('\n');}else walk(child);if(block&&!output.endsWith('\n'))output+='\n';}};
    walk(node);return output.replace(/ /g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  }
  // Zitatblock ist markiert. Gespeicherte Antwort-/Weiterleitungsentwürfe verlieren die Markierung bei der
  // Bereinigung; dort ist es der letzte Block der obersten Ebene mit Zitat.
  function quoteNode(editor){return editor.querySelector('[data-cc-quote]');}
  function findQuote(editor){return [...editor.children].reverse().find(child=>child.tagName==='BLOCKQUOTE'||child.querySelector('blockquote'))??null;}
  function ownText(editor){const clone=editor.cloneNode(true);quoteNode(clone)?.remove();return plainText(clone);}
  function replaceOwnText(editor,value){const quote=quoteNode(editor),fragment=document.createElement('div');fragment.innerHTML=textToHtml(value);if(quote&&quote.parentNode===editor){while(editor.firstChild&&editor.firstChild!==quote)editor.firstChild.remove();for(const node of [...fragment.childNodes])editor.insertBefore(node,quote);editor.insertBefore(document.createElement('p'),quote).append(document.createElement('br'));}else editor.innerHTML=fragment.innerHTML;markComposeDirty();}
  function quoteHTML(mail,{forward=false}={}){
    const sender=mail.fromName?`${esc(mail.fromName)} &lt;${esc(mail.fromAddress)}&gt;`:esc(mail.fromAddress),body=textToHtml((mail.textBody||mail.preview||'').slice(0,20000));
    if(forward)return `<div data-cc-quote><p>---------- Weitergeleitete Nachricht ----------<br>Von: ${sender}<br>Datum: ${esc(full(mail.receivedAt))}<br>Betreff: ${esc(mail.subject)}<br>An: ${esc(mail.to.map(item=>item.address).join(', '))}${mail.cc?.length?'<br>Cc: '+esc(mail.cc.map(item=>item.address).join(', ')):''}</p><blockquote>${body}</blockquote></div>`;
    return `<div data-cc-quote><p>Am ${esc(full(mail.receivedAt))} schrieb ${sender}:</p><blockquote>${body}</blockquote></div>`;
  }
  const subjectWith=(prefix,subject)=>new RegExp('^'+prefix+':','i').test(subject)?subject:prefix+': '+subject;
  function replyValues(mode,draftText=''){
    const mail=detail.message,own=ownAddress(),primary=(mail.replyTo?.length?mail.replyTo:[{address:mail.fromAddress}]).map(item=>item.address).filter(address=>address&&address!==own);
    const to=mail.direction==='OUTBOUND'?mail.to.map(item=>item.address):primary;const cc=mode==='replyAll'?[...mail.to,...(mail.cc??[])].map(item=>item.address).filter(address=>address&&address!==own&&!to.includes(address)):[];
    return {mode,to:[...new Set(to)].join(', '),cc:[...new Set(cc)].join(', '),subject:subjectWith('Re',mail.subject),html:(draftText?textToHtml(draftText):'<p><br></p>')+'<p><br></p>'+quoteHTML(mail),replyTo:mail.id};
  }
  function forwardValues(){const mail=detail.message;return {mode:'forward',subject:subjectWith('Fwd',mail.subject),html:'<p><br></p>'+quoteHTML(mail,{forward:true}),attachments:detail.attachments.filter(item=>item.archived).map(item=>({id:item.id,source:'mail',filename:item.filename,mime:item.mime,size:item.size}))};}
  function openCompose(values={}){
    compose={id:null,mode:'new',to:'',cc:'',bcc:'',subject:'',html:'',text:'',attachments:[],replyTo:null,requestId:null,stage:'edit',dirty:false,...values};compose.showCc=Boolean(compose.cc);compose.showBcc=Boolean(compose.bcc);
    if(!compose.html&&compose.text)compose.html=textToHtml(compose.text);drawCompose();
    const form=$('#mailbox-compose');(form?.elements.to.value?form.querySelector('[data-compose-editor]'):form?.elements.to)?.focus();
  }
  function markComposeDirty(){if(!compose)return;compose.dirty=true;const form=$('#mailbox-compose');if(form)form.dataset.dirty='true';}
  function drawCompose(){
    const element=region('compose');if(!element)return;if(!compose){element.innerHTML='';return;}
    const account=data?.account,canSend=!synthetic&&Boolean(account?.smtpVerifiedAt),title={reply:'Antworten',replyAll:'Allen antworten',forward:'Weiterleiten'}[compose.mode]??'Neue E-Mail';
    const contacts=[...new Map([...allOrders().filter(order=>order.source?.email).map(order=>[order.source.email.toLowerCase(),order.source.name]),...list.map(mail=>[partnerOf(mail).address,partnerOf(mail).name])].filter(([address])=>address)).entries()].slice(0,200);
    element.innerHTML=`<div class="cc-compose-layer" data-compose-layer><form id="mailbox-compose" class="cc-compose" role="dialog" aria-modal="true" aria-labelledby="cc-compose-title" novalidate>
      <header class="cc-compose-head"><div><span class="eyebrow">${esc(account?.email||'Postfach nicht eingerichtet')}</span><strong id="cc-compose-title">${esc(title)}</strong></div><button type="button" class="cc-icon-btn" data-mail-compose-close aria-label="Editor schließen">${icon('close')}</button></header>
      <div class="cc-compose-fields">
        <label class="cc-field"><span>An</span><input type="text" name="to" value="${esc(compose.to)}" placeholder="kunde@example.de, weitere@example.de" autocomplete="off" list="cc-contacts" inputmode="email"><span class="cc-field-toggles">${compose.showCc?'':'<button type="button" data-compose-show="cc">Cc</button>'}${compose.showBcc?'':'<button type="button" data-compose-show="bcc">Bcc</button>'}</span></label>
        ${compose.showCc?`<label class="cc-field"><span>Cc</span><input type="text" name="cc" value="${esc(compose.cc)}" autocomplete="off" inputmode="email"></label>`:''}
        ${compose.showBcc?`<label class="cc-field"><span>Bcc</span><input type="text" name="bcc" value="${esc(compose.bcc)}" autocomplete="off" inputmode="email"></label>`:''}
        <label class="cc-field"><span>Betreff</span><input name="subject" maxlength="500" value="${esc(compose.subject)}"></label>
        <datalist id="cc-contacts">${contacts.map(([address,name])=>`<option value="${esc(address)}">${esc(name||'')}</option>`).join('')}</datalist>
      </div>
      <div class="cc-toolbar" role="toolbar" aria-label="Formatierung">${[['bold','bold','Fett'],['italic','italic','Kursiv'],['underline','underline','Unterstrichen'],['insertUnorderedList','list','Aufzählung'],['insertOrderedList','olist','Nummerierung'],['quote','quote','Zitat'],['link','link','Link einfügen'],['removeFormat','clear','Formatierung entfernen']].map(([command,iconName,label])=>`<button type="button" class="cc-icon-btn" data-format="${command}" aria-label="${label}" title="${label}">${icon(iconName)}</button>`).join('')}</div>
      <div class="cc-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Nachricht" data-compose-editor spellcheck="true">${compose.html||'<p><br></p>'}</div>
      <div class="cc-compose-attachments" data-region="compose-attachments"></div>
      <div class="cc-compose-assistant" data-compose-assistant></div>
      <footer class="cc-compose-foot" data-region="compose-foot"></footer>
    </form></div>`;
    const editor=element.querySelector('[data-compose-editor]');
    if(compose.mode!=='new'&&!quoteNode(editor))findQuote(editor)?.setAttribute('data-cc-quote','');
    mountTextAssistant(editor,{synthetic,read:()=>ownText(editor),write:value=>replaceOwnText(editor,value)});
    drawComposeAttachments();drawComposeFoot(canSend);markSaved(element);if(compose.dirty)element.querySelector('#mailbox-compose').dataset.dirty='true';
  }
  function drawComposeAttachments(){
    const element=region('compose-attachments');if(!element||!compose)return;const used=compose.attachments.reduce((sum,item)=>sum+Number(item.size??0),0);
    element.innerHTML=`${compose.attachments.length?`<div class="cc-attach-list">${compose.attachments.map(item=>`<span class="cc-attach-chip ${item.pending?'pending':''}"><span class="cc-file-icon ${item.mime==='application/pdf'?'pdf':'img'}">${esc(UPLOAD_TYPES[item.mime]??'DATEI')}</span><span><strong title="${esc(item.filename)}">${esc(item.filename)}</strong><small>${item.pending?'Wird hochgeladen …':esc(size(item.size))}</small></span>${item.pending?'':`<button type="button" class="cc-icon-btn" data-compose-remove="${esc(item.id)}" aria-label="Anhang ${esc(item.filename)} entfernen">${icon('close')}</button>`}</span>`).join('')}</div>`:''}
      <div class="cc-attach-row"><label class="smallbtn button cc-attach-add">${icon('clip')}Datei anhängen<input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" data-compose-file class="visually-hidden"></label><small>PDF, JPG, PNG, WebP · max. 12 MB je Datei · ${size(used)} von 15 MB</small></div>`;
  }
  function drawComposeFoot(canSend=!synthetic&&Boolean(data?.account?.smtpVerifiedAt)){
    const element=region('compose-foot');if(!element||!compose)return;
    if(compose.stage==='confirm'){const value=readCompose(),recipients=[value.to,value.cc,value.bcc].join(',').split(/[,;\n]+/).map(item=>item.trim()).filter(Boolean).length;element.innerHTML=`<div class="cc-confirm" role="alertdialog" aria-label="Versand bestätigen"><div><strong>Jetzt an ${plural(recipients,'Empfänger','Empfänger')} senden?</strong><small>${esc(value.subject)} · ${plural(compose.attachments.length,'Anhang','Anhänge')}. Ein Versand lässt sich nicht zurückholen.</small></div><div><button type="button" data-compose-stage="edit">Zurück</button><button type="button" class="primary" data-compose-send-confirmed>Jetzt senden</button></div></div>`;element.querySelector('[data-compose-send-confirmed]')?.focus();return;}
    if(compose.stage==='closing'){element.innerHTML=`<div class="cc-confirm" role="alertdialog" aria-label="Ungespeicherte Änderungen"><div><strong>Ungespeicherte Änderungen</strong><small>Als Entwurf sichern oder verwerfen?</small></div><div><button type="button" data-compose-stage="edit">Weiter schreiben</button><button type="button" class="danger" data-compose-discard>Verwerfen</button><button type="button" class="primary" data-mail-save-draft>Entwurf speichern</button></div></div>`;return;}
    element.innerHTML=`<p class="hint">${synthetic?'Im Testbereich ist der Versand gesperrt.':!data?.account?.smtpVerifiedAt?'Zum Versenden zuerst SMTP in den Postfach-Einstellungen prüfen.':'Kein automatischer Versand. Entwürfe bleiben bis zum angenommenen SMTP-Versand erhalten.'}</p><div class="cc-compose-actions">${compose.id?'<button type="button" class="danger" data-compose-delete-draft>Entwurf löschen</button>':''}<button type="button" data-mail-save-draft>Entwurf speichern</button><button type="submit" class="primary" ${canSend?'':'disabled'}>${icon('sent')}<span>Senden</span></button></div>`;
  }
  function readCompose(){
    const form=$('#mailbox-compose'),editor=form?.querySelector('[data-compose-editor]');if(!form||!editor)return null;
    return {to:form.elements.to.value,cc:form.elements.cc?.value??compose.cc,bcc:form.elements.bcc?.value??compose.bcc,subject:form.elements.subject.value,html:editor.innerHTML,text:plainText(editor),attachments:compose.attachments.filter(item=>!item.pending).map(item=>item.id)};
  }
  function closeCompose(force=false){if(!compose)return;if(!force&&compose.dirty){compose.stage='closing';drawComposeFoot();return;}compose=null;drawCompose();}
  async function saveDraft(){
    if(compose.attachments.some(item=>item.pending))throw Error('Bitte warten, bis alle Anhänge hochgeladen sind.');
    const value=readCompose();const result=await api('/draft',{id:compose.id,...value,mode:compose.mode,replyTo:compose.replyTo});compose=null;drawCompose();ui.section='mail';ui.folder='Drafts';ui.openId=null;await load();drawRail();drawMain();message('Entwurf gespeichert.');return result;
  }
  async function uploadFiles(files){
    const session=compose;if(!session)return;
    for(const file of files){
      if(compose!==session)return;
      const type=String(file.type||'').toLowerCase(),used=compose.attachments.reduce((sum,item)=>sum+Number(item.size??0),0);
      if(!UPLOAD_TYPES[type]){message(`„${file.name}“: nur PDF, JPG, PNG oder WebP möglich.`,true);continue;}
      if(file.size>(data?.limits?.attachmentBytes??12*1024*1024)){message(`„${file.name}“ ist größer als 12 MB.`,true);continue;}
      if(used+file.size>(data?.limits?.totalBytes??15*1024*1024)){message('Anhänge dürfen zusammen höchstens 15 MB groß sein.',true);continue;}
      if(compose.attachments.length>=(data?.limits?.files??10)){message('Höchstens 10 Anhänge pro E-Mail.',true);break;}
      const temp={id:'pending-'+Math.random().toString(36).slice(2),filename:file.name,mime:type,size:file.size,pending:true};compose.attachments.push(temp);drawComposeAttachments();
      try{const search=new URLSearchParams({name:file.name});if(synthetic)search.set('test','true');const response=await fetch('/api/mailbox/upload?'+search,{method:'POST',headers:{'Content-Type':type},body:file,credentials:'same-origin'});const result=await response.json().catch(()=>({error:'Upload-Antwort nicht lesbar.'}));if(!response.ok)throw Error(result.error??'Upload fehlgeschlagen.');
        // Editor inzwischen geschlossen: hochgeladene Datei sofort wieder verwerfen.
        if(compose!==session){api('/upload/delete',{id:result.attachment.id}).catch(()=>{});return;}
        Object.assign(temp,result.attachment,{pending:false});markComposeDirty();}
      catch(error){session.attachments=session.attachments.filter(item=>item!==temp);if(compose===session)message(error.message,true);}
      if(compose!==session)return;drawComposeAttachments();
    }
  }
  function format(command){
    const editor=$('[data-compose-editor]');if(!editor)return;editor.focus();
    if(command==='link'){const url=window.prompt('Link-Adresse (https://… oder mailto:…)','https://');if(!url)return;if(!/^(https?:\/\/|mailto:)/i.test(url.trim())){message('Nur https://-, http://- oder mailto:-Links sind erlaubt.',true);return;}document.execCommand('createLink',false,url.trim());}
    else if(command==='quote')document.execCommand('formatBlock',false,'blockquote');
    else document.execCommand(command,false);
    markComposeDirty();
  }

  // ---------- Einstellungen ----------
  function drawSettings(){
    const element=region('settings');if(!element)return;if(!settingsOpen){element.innerHTML='';return;}const account=data?.account;
    element.innerHTML=`<div class="cc-drawer-layer"><section class="cc-drawer" role="dialog" aria-modal="true" aria-labelledby="cc-settings-title"><header><div><span class="eyebrow">POSTFACH</span><h2 id="cc-settings-title">Verbindung & Versandprotokoll</h2></div><button type="button" class="cc-icon-btn" data-mail-settings-close aria-label="Einstellungen schließen">${icon('close')}</button></header>
      <section class="cc-setting"><label class="check"><input type="checkbox" data-cc-images-auto ${imagesAuto()?'checked':''}>Bilder und Fotos in E-Mails automatisch anzeigen</label><p class="hint">Gilt für dieses Gerät. Beim Laden externer Bilder kann der Absender erkennen, dass die E-Mail geöffnet wurde. Skripte aus E-Mails werden nie ausgeführt.</p></section>
      <p class="hint">IMAP und SMTP werden getrennt geprüft. Zugangsdaten bleiben verschlüsselt auf dem Server. Eine Prüfung versendet keine E-Mail.</p>
      <form id="mailbox-account"><div class="grid2"><label>Absenderadresse<input type="email" name="email" maxlength="320" required value="${esc(account?.email??'')}"></label><label>Anzeigename<input name="displayName" maxlength="180" value="${esc(account?.displayName??'White Gloss')}"></label></div><div class="grid2"><label>IMAP-Server<input name="imapHost" required value="${esc(account?.imapHost??'')}"></label><label>IMAP-Port<input type="number" name="imapPort" min="1" max="65535" required value="${account?.imapPort??993}"></label></div><label class="check"><input type="checkbox" name="imapSecure" ${account?.imapSecure!==false?'checked':''}>Direkte TLS-Verbindung für IMAP</label><div class="grid2"><label>SMTP-Server<input name="smtpHost" required value="${esc(account?.smtpHost??'')}"></label><label>SMTP-Port<input type="number" name="smtpPort" min="1" max="65535" required value="${account?.smtpPort??465}"></label></div><label class="check"><input type="checkbox" name="smtpSecure" ${account?.smtpSecure!==false?'checked':''}>Direkte TLS-Verbindung für SMTP</label><div class="grid2"><label>Benutzername<input name="username" autocomplete="username" required value="${esc(account?.username??'')}"></label><label>Passwort<input type="password" name="password" autocomplete="new-password" maxlength="500" ${account?'':'required'} placeholder="${account?.passwordConfigured?'Geschützt gespeichert · leer lassen zum Behalten':'Postfachpasswort'}"></label></div><label class="check"><input type="checkbox" name="syncApproved" ${account?.syncApproved?'checked':''}>Geplanten lesenden Hintergrundabruf erlauben</label><div class="actions"><button class="primary" type="submit">Zugang speichern</button><button type="button" data-mail-check="imap" ${account?'':'disabled'}>IMAP prüfen</button><button type="button" data-mail-check="smtp" ${account?'':'disabled'}>SMTP prüfen</button></div></form>
      ${account?.lastSyncError?`<p class="notice">Letzter Abruffehler: ${esc(account.lastSyncError)}</p>`:''}
      <h3>Versandprotokoll</h3>${data?.deliveries?.length?`<div class="tablewrap"><table><thead><tr><th>Zeitpunkt</th><th>Status</th><th>Angenommen</th><th>Hinweis</th></tr></thead><tbody>${data.deliveries.slice(0,20).map(item=>`<tr><td>${esc(full(item.createdAt))}</td><td>${esc(item.status)}</td><td>${item.acceptedCount}</td><td>${esc(item.error||'SMTP-Antwort gespeichert')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="hint">Noch keine Versandvorgänge.</p>'}
    </section></div>`;markSaved(element);element.querySelector('input')?.focus();
  }

  // ---------- Aktionen ----------
  function setSection(section){ui.section=section;railOpen=false;$('[data-cc]')?.classList.remove('cc-rail-open');try{localStorage.setItem('wg-cc-section',section);}catch{/* optional */}
    if(section==='mail'||section==='home'){list=[];listState='loading';drawMain();drawRail();return load().then(()=>{if(ui.section===section){drawMain();drawRail();drawStatus();}}).catch(error=>message(error.message,true));}
    drawMain();drawRail();return Promise.resolve();}
  // Ordnerwechsel startet wie in gängigen Mailprogrammen ohne alte Suche und Filter.
  function openFolder(folder){ui.folder=folder;ui.query='';ui.filter='all';ui.openId=null;detail=null;selection.clear();selectMode=false;return setSection('mail');}
  async function openMessage(id,{markRead=true}={}){
    // Aus Übersicht oder Notizen geöffnet: Ansicht „Ungelesen“ bzw. „Alle“ enthält die Nachricht sicher.
    if(ui.section!=='mail'){const fromHome=ui.section==='home';ui.section='mail';ui.folder=fromHome?'Unread':'all';ui.query='';ui.filter='all';selectMode=false;selection.clear();try{localStorage.setItem('wg-cc-section','mail');}catch{/* optional */}list=[];listState='loading';drawMain();drawRail();load().then(()=>{drawList();drawRail();}).catch(error=>message(error.message,true));}
    ui.openId=id;detail=null;detailState='loading';drawReader();markActive();const token=id;
    if(window.matchMedia?.('(max-width: 999px)').matches)$('.cc-mail')?.scrollIntoView({block:'start'});
    try{let result=await api('/message/'+id);if(ui.openId!==token)return;
      if(markRead&&!result.message.read){await api('/state',{messageId:id,read:true});if(list.some(mail=>mail.id===id))trackFilter(id,{read:true});result={...result,message:{...result.message,read:true}};const row=list.find(mail=>mail.id===id);if(row)row.read=true;refreshMeta();}
      detail=result;detailState='ready';}
    catch(error){if(ui.openId!==token)return;detailState='error';detailError=error.message;}
    drawReader();drawItems();
  }
  function markActive(){for(const row of root.querySelectorAll('.cc-row[data-mail-open]'))row.classList.toggle('active',row.dataset.mailOpen===ui.openId);$('.cc-mail')?.classList.toggle('has-detail',Boolean(ui.openId));}
  // Ablage nach einer Verschiebung; null bzw. ein unpassender Systemordner bedeutet Ursprungsordner.
  function effectiveFolder(mail,target){if(target===null||target===undefined)return mail.originalFolder;if(target==='INBOX'&&mail.direction==='OUTBOUND')return mail.originalFolder;if(target==='Sent'&&mail.direction==='INBOUND')return mail.originalFolder;return target;}
  // Entspricht der serverseitigen Ordnerlogik; entscheidet, ob eine verschobene Nachricht in der Ansicht bleibt.
  function inView(mail){const folder=mail.folder,view=ui.folder;if(view==='all')return true;if(view==='Unread')return mail.direction==='INBOUND'&&!mail.read&&!['Trash','Spam'].includes(folder);if(view==='Flagged')return mail.flagged&&folder!=='Trash';if(view==='INBOX')return mail.direction==='INBOUND'&&folder==='INBOX';if(view==='Sent')return mail.direction==='OUTBOUND'&&folder==='Sent';return folder===view;}
  async function changeState(ids,patch,note){
    // Der Server nimmt höchstens 200 Nachrichten je Anfrage; größere Auswahlen laufen in Teilen.
    for(let index=0;index<ids.length;index+=200){
      try{await api('/state',{messageIds:ids.slice(index,index+200),...patch});}
      catch(error){selection.clear();await load().catch(()=>{});drawItems();drawBulk();throw Error(index?`${index} von ${ids.length} E-Mails geändert. ${error.message}`:error.message);}
    }
    for(const mail of list)if(ids.includes(mail.id)){if(patch.read!==undefined)mail.read=patch.read;if(patch.flagged!==undefined)mail.flagged=patch.flagged;if(patch.folder!==undefined)mail.folder=effectiveFolder(mail,patch.folder);trackFilter(mail.id,patch);}
    if(patch.folder!==undefined){
      const removed=list.filter(mail=>ids.includes(mail.id)&&!inView(mail));list=list.filter(mail=>!removed.includes(mail));total=Math.max(0,total-removed.length);for(const mail of removed)stale.delete(mail.id);
      if(removed.some(mail=>mail.id===ui.openId)){ui.openId=null;detail=null;}
    }
    if(detail&&ids.includes(detail.message.id)){const row=list.find(mail=>mail.id===detail.message.id);detail={...detail,message:{...detail.message,...(patch.read!==undefined?{read:patch.read}:{}),...(patch.flagged!==undefined?{flagged:patch.flagged}:{}),...(row&&patch.folder!==undefined?{folder:row.folder}:{})}};}
    selection=new Set([...selection].filter(id=>!ids.includes(id)));await refreshMeta();drawItems();drawBulk();drawReader();if(note)message(note);
  }
  const moveNote=folder=>folder==='Trash'?'In den Papierkorb verschoben.':folder==='Archive'?'Archiviert.':folder==='Spam'?'Als Spam abgelegt.':folder===null?'Wiederhergestellt.':'Verschoben nach „'+(FOLDER_LABEL[folder]??folder)+'“.';
  function quickAction(action,id){
    const mail=list.find(item=>item.id===id)??(detail?.message.id===id?detail.message:null);if(!mail)return;
    if(action==='read')return run(()=>changeState([id],{read:!mail.read}));
    if(action==='flag')return run(()=>changeState([id],{flagged:!mail.flagged}));
    if(action==='archive')return run(()=>changeState([id],{folder:'Archive'},moveNote('Archive')));
    if(action==='trash')return run(()=>changeState([id],{folder:mail.folder==='Trash'?null:'Trash'},moveNote(mail.folder==='Trash'?null:'Trash')));
  }
  function scheduleSearch(){clearTimeout(searchTimer);searchTimer=setTimeout(async()=>{selection.clear();drawBulk();try{await load();drawItems();}catch(error){message(error.message,true);}},260);}
  function moveFocus(step){const rows=[...root.querySelectorAll('.cc-row[data-mail-open]')];if(!rows.length)return;const index=rows.findIndex(row=>row.dataset.mailOpen===ui.openId);const next=rows[Math.max(0,Math.min(rows.length-1,index+step))]??rows[0];next.focus();run(()=>openMessage(next.dataset.mailOpen));}

  root.addEventListener('click',event=>{
    const target=event.target;if(!(target instanceof window.Element))return;
    const quick=target.closest('[data-mail-quick-action]');if(quick){event.stopPropagation();quickAction(quick.dataset.mailQuickAction,quick.dataset.id);return;}
    if(target.closest('[data-mail-quick]'))return;
    const open=target.closest('[data-mail-open]');if(open){if(selectMode&&open.classList.contains('cc-row')){toggleSelect(open.dataset.mailOpen);return;}run(()=>openMessage(open.dataset.mailOpen));return;}
    if(target.closest('[data-mail-compose]')){openCompose();return;}
    if(target.closest('[data-mail-compose-close]')){closeCompose();return;}
    if(target.closest('[data-compose-discard]')){closeCompose(true);return;}
    const stage=target.closest('[data-compose-stage]');if(stage&&compose){compose.stage=stage.dataset.composeStage;drawComposeFoot();return;}
    if(target.closest('[data-compose-send-confirmed]'))return run(sendCompose);
    const show=target.closest('[data-compose-show]');if(show&&compose){const values=readCompose();compose={...compose,to:values.to,cc:values.cc,bcc:values.bcc,subject:values.subject,html:values.html,[show.dataset.composeShow==='cc'?'showCc':'showBcc']:true};drawCompose();$('#mailbox-compose')?.elements[show.dataset.composeShow]?.focus();return;}
    const remove=target.closest('[data-compose-remove]');if(remove&&compose){const id=remove.dataset.composeRemove,item=compose.attachments.find(entry=>entry.id===id);compose.attachments=compose.attachments.filter(entry=>entry.id!==id);markComposeDirty();drawComposeAttachments();if(item?.source==='upload')api('/upload/delete',{id}).catch(()=>{});return;}
    const formatButton=target.closest('[data-format]');if(formatButton){format(formatButton.dataset.format);return;}
    if(target.closest('[data-mail-save-draft]'))return run(saveDraft);
    if(target.closest('[data-compose-delete-draft]')&&compose?.id)return run(async()=>{await api('/draft/delete',{id:compose.id});compose=null;drawCompose();await load();drawRail();drawMain();message('Entwurf gelöscht.');});
    if(target.closest('[data-mail-close]')){const previous=ui.openId;ui.openId=null;detail=null;drawReader();markActive();[...root.querySelectorAll('.cc-row[data-mail-open]')].find(row=>row.dataset.mailOpen===previous)?.scrollIntoView({block:'center'});return;}
    if(target.closest('[data-mail-retry]')&&ui.openId)return run(()=>openMessage(ui.openId));
    const folder=target.closest('[data-mail-folder]');if(folder){run(()=>openFolder(folder.dataset.mailFolder));return;}
    const section=target.closest('[data-cc-section]');if(section){run(()=>setSection(section.dataset.ccSection));return;}
    if(target.closest('[data-mail-notes]')){openNotes();return;}
    if(target.closest('[data-mail-tasks]')){openTasks();return;}
    if(target.closest('[data-cc-rail]')){railOpen=!$('[data-cc]').classList.contains('cc-rail-open');$('[data-cc]').classList.toggle('cc-rail-open',railOpen);target.closest('[data-cc-rail]').setAttribute('aria-expanded',String(railOpen));if(railOpen)region('rail')?.querySelector('button')?.focus();return;}
    if(target.closest('[data-cc-rail-close]')){railOpen=false;$('[data-cc]').classList.remove('cc-rail-open');return;}
    if(target.closest('[data-mail-settings]')){settingsOpen=true;drawSettings();return;}
    if(target.closest('[data-mail-settings-close]')||target.matches('.cc-drawer-layer')){settingsOpen=false;drawSettings();return;}
    if(target.closest('[data-mail-refresh]'))return run(async()=>{await load();if(ui.openId&&ui.section==='mail'){const result=await api('/message/'+ui.openId).catch(()=>null);if(result){detail=result;detailState='ready';}}drawStatus();drawRail();drawMain();});
    if(target.closest('[data-mail-sync]'))return run(async()=>{const result=await api('/sync',{});await load();drawStatus();drawRail();drawMain();message(result.message);});
    const check=target.closest('[data-mail-check]');if(check)return run(async()=>{const result=await api('/check',{kind:check.dataset.mailCheck});await refreshMeta();drawSettings();message(result.message);});
    if(target.closest('[data-mail-more]')){loadMore();return;}
    if(target.closest('[data-mail-reset]')){ui.query='';ui.filter='all';drawList();run(async()=>{await load();drawItems();});return;}
    const filter=target.closest('[data-mail-filter]');if(filter){ui.filter=filter.dataset.mailFilter;selection.clear();for(const chip of root.querySelectorAll('[data-mail-filter]')){chip.classList.toggle('active',chip===filter);chip.setAttribute('aria-pressed',String(chip===filter));}listState='loading';drawItems();run(async()=>{await load();drawItems();});return;}
    if(target.closest('[data-mail-select-mode]')){selectMode=!selectMode;if(!selectMode)selection.clear();drawList();return;}
    const bulk=target.closest('[data-mail-bulk]');if(bulk){const ids=[...selection],action=bulk.dataset.mailBulk;
      if(action==='none'){selection.clear();drawItems();drawBulk();return;}if(action==='all'){selection=new Set(list.map(mail=>mail.id));drawItems();drawBulk();return;}
      const patch={read:{read:true},unread:{read:false},flag:{flagged:true},archive:{folder:'Archive'},trash:{folder:'Trash'}}[action];if(patch&&ids.length)return run(()=>changeState(ids,patch,plural(ids.length,'E-Mail','E-Mails')+' aktualisiert.'));return;}
    if(detail){
      if(target.closest('[data-mail-reply]')){openCompose(replyValues('reply'));return;}
      if(target.closest('[data-mail-reply-all]')){openCompose(replyValues('replyAll'));return;}
      if(target.closest('[data-mail-forward]')){openCompose(forwardValues());return;}
      const state=target.closest('[data-mail-state]');if(state)return run(()=>changeState([detail.message.id],state.dataset.mailState==='read'?{read:!detail.message.read}:{flagged:!detail.message.flagged}));
      const moveTo=target.closest('[data-mail-move-to]');if(moveTo){const value=moveTo.dataset.mailMoveTo||null;return run(()=>changeState([detail.message.id],{folder:value},moveNote(value)));}
      if(target.closest('[data-mail-images]')){ui.images.add(detail.message.id);ui.hiddenImages.delete(detail.message.id);drawReader();return;}
      if(target.closest('[data-mail-images-toggle]')){const id=detail.message.id;if(imagesShown(detail.message)){ui.hiddenImages.add(id);ui.images.delete(id);}else{ui.images.add(id);ui.hiddenImages.delete(id);}drawReader();return;}
      if(target.closest('[data-mail-note-here]')){openNotes({messageId:detail.message.id,orderId:detail.crm.orders.find(order=>order.running)?.id??''});return;}
      const ai=target.closest('[data-mail-ai]');if(ai)return run(async()=>{const result=await api('/reply-suggestion',{messageId:detail.message.id,style:ai.dataset.mailAi,confirmed:true});openCompose(replyValues('reply',result.draft));markComposeDirty();message('KI-Entwurf in den Editor übernommen. Bitte vor dem Versand prüfen.');});
    }
    const draft=target.closest('[data-mail-draft]');if(draft){const value=data?.drafts?.find(item=>item.id===draft.dataset.mailDraft);if(value)openCompose({...value,html:value.html||textToHtml(value.text)});return;}
    const deleteFolder=target.closest('[data-mail-folder-delete]');if(deleteFolder)return run(async()=>{await api('/folder/delete',{id:deleteFolder.dataset.mailFolderDelete});if(!['INBOX','Unread','Flagged','Drafts','Sent','Archive','Spam','Trash'].includes(ui.folder)){ui.folder='INBOX';}await load();drawRail();drawMain();message('Ordner entfernt. Enthaltene E-Mails sind zurück im Ursprungsordner.');});
    const mailTo=target.closest('[data-cc-mail-to]');if(mailTo){openCompose({to:mailTo.dataset.ccMailTo,subject:mailTo.dataset.ccSubject??''});return;}
    const mailSearch=target.closest('[data-cc-mail-search]');if(mailSearch){ui.folder='all';ui.query=mailSearch.dataset.ccMailSearch;ui.filter='all';ui.openId=null;run(()=>setSection('mail'));return;}
    const day=target.closest('[data-cc-day]');if(day){ui.calendarDay=day.dataset.ccDay||null;drawMain();return;}
    const noteOrder=target.closest('[data-cc-note-order]');if(noteOrder){openNotes({orderId:noteOrder.dataset.ccNoteOrder,messageId:ui.section==='mail'&&detail?detail.message.id:''});return;}
    const noteCustomer=target.closest('[data-cc-note-customer]');if(noteCustomer){openNotes({customerId:noteCustomer.dataset.ccNoteCustomer,messageId:detail?.message.id??''});return;}
    if(target.closest('[data-cc-note-link-mail]')&&detail){noteDraft={...noteDraft,...readNoteForm(),messageId:detail.message.id};drawMain();return;}
    const unlink=target.closest('[data-cc-note-unlink]');if(unlink){noteDraft={...noteDraft,...readNoteForm(),[unlink.dataset.ccNoteUnlink==='message'?'messageId':'customerId']:''};drawMain();return;}
    if(target.closest('[data-cc-note-cancel]')){noteDraft={id:null,body:'',orderId:'',customerId:'',messageId:'',pinned:false};drawMain();return;}
    const noteFilter=target.closest('[data-cc-note-filter]');if(noteFilter){ui.noteFilter=noteFilter.dataset.ccNoteFilter;noteDraft={...noteDraft,...readNoteForm()};drawMain();return;}
    const edit=target.closest('[data-note-edit]');if(edit){const note=data.notes.find(item=>item.id===edit.dataset.noteEdit);if(note){noteDraft={id:note.id,body:note.body,orderId:note.orderId??'',customerId:note.customerId??'',messageId:note.messageId??'',pinned:note.pinned};drawMain();root.querySelector('#cc-note-body')?.focus();}return;}
    const pin=target.closest('[data-cc-note-pin]');if(pin){const note=data.notes.find(item=>item.id===pin.dataset.ccNotePin);if(note)return run(async()=>{noteDraft={...noteDraft,...readNoteForm()};await api('/note',{id:note.id,body:note.body,orderId:note.orderId,messageId:note.messageId,customerId:note.customerId,pinned:!note.pinned});await refreshMeta();drawMain();});return;}
    const del=target.closest('[data-note-delete]');if(del){if(confirmDelete!==del.dataset.noteDelete){confirmDelete=del.dataset.noteDelete;noteDraft={...noteDraft,...readNoteForm()};drawMain();return;}return run(async()=>{await api('/note/delete',{id:del.dataset.noteDelete});confirmDelete=null;if(noteDraft.id===del.dataset.noteDelete)noteDraft={id:null,body:'',orderId:'',customerId:'',messageId:'',pinned:false};await refreshMeta();drawMain();message('Notiz gelöscht.');});}
    const taskDone=target.closest('[data-task-done]');if(taskDone)return run(async()=>{const task=(data?.tasks??[]).find(item=>item.id===taskDone.dataset.taskDone);await api('/task/done',{id:taskDone.dataset.taskDone,done:!task?.done});await refreshMeta();drawMain();});
    const taskEdit=target.closest('[data-task-edit]');if(taskEdit){const task=(data?.tasks??[]).find(item=>item.id===taskEdit.dataset.taskEdit);if(!task)return;taskDraft={id:task.id,title:task.title,body:task.body,due:task.due??'',important:task.important};drawMain();root.querySelector('#cc-task-title')?.focus();return;}
    const taskDelete=target.closest('[data-task-delete]');if(taskDelete){if(confirmDelete!==taskDelete.dataset.taskDelete){confirmDelete=taskDelete.dataset.taskDelete;taskDraft={...taskDraft,...readTaskForm()};drawMain();return;}return run(async()=>{await api('/task/delete',{id:taskDelete.dataset.taskDelete});confirmDelete=null;if(taskDraft.id===taskDelete.dataset.taskDelete)taskDraft={id:null,title:'',body:'',due:'',important:false};await refreshMeta();drawMain();message('Aufgabe gelöscht.');});}
    if(target.closest('[data-task-cancel]')){taskDraft={id:null,title:'',body:'',due:'',important:false};drawMain();return;}
    const noteMail=target.closest('[data-note-mail]');if(noteMail){run(()=>openMessage(noteMail.dataset.noteMail,{markRead:false}));return;}
    if(railOpen&&target.closest('[data-view],[data-order],[data-customer]')){railOpen=false;$('[data-cc]')?.classList.remove('cc-rail-open');}
  });
  function toggleSelect(id){if(selection.has(id))selection.delete(id);else selection.add(id);const row=[...root.querySelectorAll('.cc-row[data-mail-open]')].find(item=>item.dataset.mailOpen===id);row?.classList.toggle('selected',selection.has(id));const box=row?.querySelector('[data-mail-select]');if(box)box.checked=selection.has(id);drawBulk();}
  function readNoteForm(){const form=root.querySelector('#mail-note-form');if(!form)return {};return {body:form.elements.body.value,orderId:form.elements.orderId.value,pinned:form.elements.pinned.checked};}
  async function sendCompose(){
    const value=readCompose();compose.requestId??=crypto.randomUUID();
    const result=await api('/send',{requestId:compose.requestId,draftId:compose.id,...value,replyTo:compose.replyTo,confirmed:true});
    compose=null;drawCompose();ui.section='mail';ui.folder='Sent';ui.openId=null;await load();drawRail();drawMain();
    message(result.status==='PARTIAL'?'Nur ein Teil der Empfänger wurde angenommen. Bitte Versandprotokoll prüfen.':'SMTP hat die E-Mail angenommen. Die endgültige Zustellung ist damit noch nicht bestätigt.');
  }
  root.addEventListener('keydown',event=>{
    const row=event.target.closest?.('.cc-row[data-mail-open],.cc-row[data-mail-draft]');if(row&&(event.key==='Enter'||event.key===' ')&&event.target===row){event.preventDefault();row.click();return;}
    if(event.target.matches?.('[data-compose-editor]')&&(event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();$('#mailbox-compose')?.requestSubmit?.();return;}
    if(event.target.matches?.('#cc-note-body')&&(event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();root.querySelector('#mail-note-form')?.requestSubmit?.();return;}
    if(event.key==='Escape'){if(compose){event.preventDefault();closeCompose();return;}if(settingsOpen){settingsOpen=false;drawSettings();return;}if(railOpen){railOpen=false;$('[data-cc]').classList.remove('cc-rail-open');return;}}
  });
  root.addEventListener('input',event=>{
    if(event.target.matches('[data-mail-search]')){ui.query=event.target.value;listState='loading';const count=$('[data-cc-list-count]');if(count)count.textContent='Suche läuft …';scheduleSearch();return;}
    if(event.target.matches('[data-cc-order-search]')){ui.orderQuery=event.target.value;const position=event.target.selectionStart;drawMain();const input=$('[data-cc-order-search]');input?.focus();input?.setSelectionRange(position,position);return;}
    if(event.target.matches('[data-cc-note-search]')){ui.noteQuery=event.target.value;const position=event.target.selectionStart;noteDraft={...noteDraft,...readNoteForm()};drawMain();const input=$('[data-cc-note-search]');input?.focus();input?.setSelectionRange(position,position);return;}
    if(event.target.closest?.('#mailbox-compose'))markComposeDirty();
  });
  root.addEventListener('paste',event=>{
    const editor=event.target.closest?.('[data-compose-editor]');if(!editor)return;const value=event.clipboardData?.getData('text/plain');if(typeof value!=='string')return;
    // Fremdformatierungen (Word, Webseiten) werden beim Einfügen bewusst entfernt.
    event.preventDefault();if(!document.execCommand('insertText',false,value)){const selection=window.getSelection?.();if(selection?.rangeCount){const range=selection.getRangeAt(0);range.deleteContents();range.insertNode(document.createTextNode(value));range.collapse(false);}}markComposeDirty();
  });
  root.addEventListener('mousedown',event=>{if(event.target.closest?.('[data-format]'))event.preventDefault();});
  root.addEventListener('dragover',event=>{if(compose&&event.target.closest?.('[data-compose-layer]')){event.preventDefault();$('#mailbox-compose')?.classList.add('dropping');}});
  root.addEventListener('dragleave',event=>{if(event.target.matches?.('#mailbox-compose'))$('#mailbox-compose')?.classList.remove('dropping');});
  root.addEventListener('drop',event=>{if(!compose||!event.target.closest?.('[data-compose-layer]'))return;event.preventDefault();$('#mailbox-compose')?.classList.remove('dropping');const files=[...(event.dataTransfer?.files??[])];if(files.length)uploadFiles(files);});
  root.addEventListener('change',event=>{
    const target=event.target;
    if(target.matches('[data-mail-select]')){toggleSelect(target.dataset.mailSelect);return;}
    if(target.matches('[data-cc-images-auto]')){setImagesAuto(target.checked);ui.images.clear();ui.hiddenImages.clear();drawReader();message(target.checked?'Bilder werden automatisch angezeigt.':'Bilder werden erst nach Klick angezeigt.');return;}
    if(target.matches('[data-mail-sort]')){ui.sort=target.value;listState='loading';drawItems();run(async()=>{await load();drawItems();});return;}
    if(target.matches('[data-mail-move]')&&target.value&&detail){const value=target.value;run(()=>changeState([detail.message.id],{folder:value},moveNote(value)));return;}
    if(target.matches('[data-mail-bulk-move]')&&target.value&&selection.size){const value=target.value,ids=[...selection];run(()=>changeState(ids,{folder:value},moveNote(value)));return;}
    if(target.matches('[data-compose-file]')){const files=[...(target.files??[])];target.value='';if(files.length&&compose)uploadFiles(files);return;}
  });
  root.addEventListener('submit',event=>{
    // getAttribute statt form.id: ein Formularfeld namens „id“ würde form.id im Browser überdecken.
    event.preventDefault();event.stopPropagation();const form=event.target,formId=form.getAttribute('id');
    if(formId==='mailbox-account')return run(async()=>{const fields=new FormData(form),result=await api('/settings',{email:fields.get('email'),displayName:fields.get('displayName'),imapHost:fields.get('imapHost'),imapPort:Number(fields.get('imapPort')),imapSecure:form.elements.imapSecure.checked,smtpHost:fields.get('smtpHost'),smtpPort:Number(fields.get('smtpPort')),smtpSecure:form.elements.smtpSecure.checked,username:fields.get('username'),password:fields.get('password'),syncApproved:form.elements.syncApproved.checked});await refreshMeta();drawSettings();message(result.message);});
    if(formId==='mailbox-compose'){if(!compose)return;const value=readCompose();
      if(!value.to.trim()){message('Bitte mindestens einen Empfänger angeben.',true);form.elements.to.focus();return;}
      if(!value.subject.trim()){message('Bitte einen Betreff angeben.',true);form.elements.subject.focus();return;}
      if(!value.text.trim()){message('Bitte einen Nachrichtentext schreiben.',true);form.querySelector('[data-compose-editor]')?.focus();return;}
      if(compose.attachments.some(item=>item.pending)){message('Bitte warten, bis alle Anhänge hochgeladen sind.',true);return;}
      compose.stage='confirm';drawComposeFoot();return;}
    if(form.matches('[data-mail-new-folder]'))return run(async()=>{const name=form.elements.name.value.trim();await api('/folder',{name});ui.folder=name;ui.section='mail';ui.openId=null;await load();drawRail();drawMain();message('Eigener Ordner angelegt.');});
    if(formId==='mail-note-form')return run(async()=>{const value=readNoteForm();await api('/note',{id:form.elements.noteId.value||null,body:value.body,messageId:form.elements.messageId.value||null,orderId:value.orderId||null,customerId:form.elements.customerId.value||null,pinned:value.pinned});noteDraft={id:null,body:'',orderId:'',customerId:'',messageId:'',pinned:false};await refreshMeta();drawMain();message('Notiz gespeichert.');});
    if(formId==='mail-task-form')return run(async()=>{const value=readTaskForm();await api('/task',{id:form.elements.taskId.value||null,title:value.title,body:value.body,due:value.due||null,important:value.important});taskDraft={id:null,title:'',body:'',due:'',important:false};await refreshMeta();drawMain();message('Aufgabe gespeichert.');});
  });

  // Tastenkürzel nur außerhalb von Eingabefeldern und nur solange der Bereich sichtbar ist.
  if(keyHandler)document.removeEventListener('keydown',keyHandler);
  keyHandler=event=>{
    if(!root.isConnected){document.removeEventListener('keydown',keyHandler);keyHandler=null;return;}
    if(event.defaultPrevented||event.metaKey||event.ctrlKey||event.altKey||compose||settingsOpen)return;const target=event.target;
    if(target instanceof window.HTMLElement&&(target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))return;if(document.querySelector('dialog[open]'))return;
    const key=event.key;
    if(key==='c'){event.preventDefault();openCompose();return;}
    if(ui.section!=='mail')return;
    if(key==='/'){event.preventDefault();$('[data-mail-search]')?.focus();return;}
    if(key==='j'||key==='ArrowDown'&&target.closest?.('.cc-items')){event.preventDefault();moveFocus(1);return;}
    if(key==='k'||key==='ArrowUp'&&target.closest?.('.cc-items')){event.preventDefault();moveFocus(-1);return;}
    if(!detail)return;
    if(key==='r'&&detail.message.direction==='INBOUND'){event.preventDefault();openCompose(replyValues('reply'));}
    else if(key==='a'&&detail.message.direction==='INBOUND'){event.preventDefault();openCompose(replyValues('replyAll'));}
    else if(key==='f'){event.preventDefault();openCompose(forwardValues());}
    else if(key==='e'){event.preventDefault();quickAction('archive',detail.message.id);}
    else if(key==='#'||key==='Delete'){event.preventDefault();quickAction('trash',detail.message.id);}
    else if(key==='s'){event.preventDefault();quickAction('flag',detail.message.id);}
    else if(key==='u'){event.preventDefault();quickAction('read',detail.message.id);}
    else if(key==='Escape'){ui.openId=null;detail=null;drawReader();markActive();}
  };
  document.addEventListener('keydown',keyHandler);

  root.innerHTML='<div class="cc-boot card"><span></span><span></span><span></span><p>Communication Center wird geladen …</p></div>';
  load().then(()=>{drawAll();if(ui.section==='mail'&&ui.openId)openMessage(ui.openId,{markRead:false});}).catch(error=>{root.innerHTML=`<div class="cc-boot card">${empty('Communication Center nicht erreichbar',error.message,'spam','<button type="button" class="smallbtn" data-cc-reload>Erneut versuchen</button>')}</div>`;root.querySelector('[data-cc-reload]')?.addEventListener('click',()=>mountMailbox(root,{synthetic,toast,orders,markSaved}),{once:true});});
}
