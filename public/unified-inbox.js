const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const dateFormat=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',dateStyle:'medium',timeStyle:'short'});
const validTime=value=>{const time=Date.parse(value??'');return Number.isFinite(time)?time:0;};

export function combineInboxData({mailbox,chats,whatsapp}){
  const items=[
    ...(mailbox?.messages??[]).map(mail=>({channel:'E-Mail',kind:'mail',id:mail.id,name:mail.fromName||mail.fromAddress||'Unbekannter Absender',preview:mail.preview||mail.subject||'Keine Textvorschau',at:mail.receivedAt,unread:!mail.read,href:'#mail='+encodeURIComponent(mail.id)})),
    ...(chats?.threads??[]).map(thread=>({channel:'Kundenchat',kind:'chat',id:thread.id,name:thread.name||'Ohne Namen',preview:thread.last?.text||(thread.last?.files?'Anhang erhalten':'Noch keine Nachrichten'),at:thread.lastAt,unreadCount:Number(thread.unread)||0,href:'#chat='+encodeURIComponent(thread.id)})),
    ...(whatsapp?.conversations??[]).map(conversation=>({channel:'WhatsApp',kind:'whatsapp',id:conversation.conversationKey,name:conversation.profileName||conversation.senderPhone||'Unbekannter Absender',preview:conversation.lastBody||'Anhang oder andere Nachricht',at:conversation.lastReceivedAt,href:'#whatsapp='+encodeURIComponent(conversation.conversationKey)}))
  ];
  return items.sort((a,b)=>validTime(b.at)-validTime(a.at));
}

export function renderUnifiedInboxList(items,{query='',filter='all'}={}){
  const needle=query.trim().toLocaleLowerCase('de-DE');
  const visible=items.filter(item=>(filter!=='unread'||item.unread||item.unreadCount)&&(!needle||(item.name+' '+item.preview+' '+item.channel).toLocaleLowerCase('de-DE').includes(needle)));
  if(!visible.length)return '<p class="unified-inbox-empty">Keine passenden Nachrichten.</p>';
  return `<ul class="unified-inbox-list">${visible.map(item=>`<li><a href="${esc(item.href)}" class="unified-inbox-item"><span class="unified-inbox-channel">${esc(item.channel)}</span><span class="unified-inbox-main"><span class="unified-inbox-head"><strong>${esc(item.name)}</strong><time datetime="${esc(item.at??'')}">${esc(Number.isFinite(Date.parse(item.at??''))?dateFormat.format(new Date(item.at)):'—')}</time></span><span class="unified-inbox-preview">${esc(item.preview)}</span></span>${item.unreadCount?`<span class="unified-inbox-unread" aria-label="${item.unreadCount} ungelesen">${item.unreadCount}</span>`:item.unread?'<span class="unified-inbox-unread" aria-label="Ungelesen">Ungelesen</span>':''}</a></li>`).join('')}</ul>`;
}

export function mountUnifiedInbox(root,{synthetic=false}={}){
  if(!root)return;
  root.innerHTML=`<section class="unified-inbox"><header class="unified-inbox-header"><div><h1>Gemeinsamer Posteingang</h1><p>E-Mail, Kundenchat und WhatsApp nach Eingang sortiert. Zum Antworten öffnet sich der jeweilige Kanal.</p></div><button type="button" class="smallbtn" data-unified-refresh>Aktualisieren</button></header><div class="unified-inbox-controls"><label><span class="visually-hidden">Nachrichten durchsuchen</span><input type="search" data-unified-search placeholder="Name, Nachricht oder Kanal suchen"></label><label><span class="visually-hidden">Nachrichten filtern</span><select data-unified-filter><option value="all">Alle Nachrichten</option><option value="unread">Ungelesene E-Mails und Chats</option></select></label></div><p class="unified-inbox-status" data-unified-status role="status" aria-live="polite">Nachrichten werden geladen …</p><div data-unified-list></div><p class="unified-inbox-note">Der gemeinsame Eingang bündelt die letzten 50 E-Mails sowie die gespeicherten Chats und WhatsApp-Unterhaltungen. Lesestatus und Antworten bleiben im jeweiligen Kanal.</p></section>`;
  const list=root.querySelector('[data-unified-list]'),status=root.querySelector('[data-unified-status]');
  let items=[];
  const draw=()=>{list.innerHTML=renderUnifiedInboxList(items,{query:root.querySelector('[data-unified-search]').value,filter:root.querySelector('[data-unified-filter]').value});};
  async function get(path){
    const response=await fetch('/api/'+path,{credentials:'same-origin'});
    const result=await response.json().catch(()=>({error:'Antwort konnte nicht gelesen werden.'}));
    if(!response.ok)throw Error(result.error??'Nachrichten konnten nicht geladen werden.');
    return result;
  }
  async function reload(){
    const button=root.querySelector('[data-unified-refresh]');button.disabled=true;status.textContent='Nachrichten werden geladen …';status.classList.remove('error');
    const params=synthetic?'?test=true':'';
    const results=await Promise.allSettled([get('mailbox?folder=INBOX&limit=50'+(synthetic?'&test=true':'')),get('chats'+params),get('whatsapp'+params)]);
    const sources=['E-Mail','Kundenchat','WhatsApp'],data={mailbox:null,chats:null,whatsapp:null},errors=[];
    results.forEach((result,index)=>{if(result.status==='fulfilled')data[['mailbox','chats','whatsapp'][index]]=result.value;else errors.push(sources[index]+': '+result.reason.message);});
    items=combineInboxData(data);draw();
    status.textContent=errors.length?errors.join(' · '):`${items.length} Nachrichten · E-Mail ${data.mailbox?.messages?.length??0}, Kundenchat ${data.chats?.threads?.length??0}, WhatsApp ${data.whatsapp?.conversations?.length??0}`;
    status.classList.toggle('error',errors.length>0);button.disabled=false;
  }
  root.addEventListener('input',event=>{if(event.target.matches('[data-unified-search]'))draw();});
  root.addEventListener('change',event=>{if(event.target.matches('[data-unified-filter]'))draw();});
  root.addEventListener('click',event=>{if(event.target.closest('[data-unified-refresh]'))reload().catch(error=>{status.textContent=error.message;status.classList.add('error');});});
  reload().catch(error=>{status.textContent=error.message;status.classList.add('error');root.querySelector('[data-unified-refresh]').disabled=false;});
}
