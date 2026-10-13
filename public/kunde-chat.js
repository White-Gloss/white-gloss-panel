// Kundenseite des Chats: /chat/<persönlicher Link>. Anmeldung erfolgt vorher über E-Mail-Link und PIN.
import {mountConversation,esc} from './chat-ui.js';
const app=document.querySelector('#app'),token=location.pathname.split('/').pop()??'';
const loginUrl='/auth/login?returnTo='+encodeURIComponent('/chat/'+token);
function header(){
  const head=document.createElement('header');head.className='chat-head';
  head.innerHTML='<span class="chat-avatar brandmark" aria-hidden="true">WG</span><div class="chat-title"><strong>White Gloss Detailing</strong><small data-chat-subtitle>Ihr direkter Draht zu uns</small></div><a class="chat-head-call" data-chat-call hidden aria-label="Anrufen"><svg class="chat-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg></a>';
  return head;
}
function failure(message,status){
  app.innerHTML=`<main class="appoff card chat-gate"><span class="brandmark">WG</span><h1>Ihr Chat mit White Gloss</h1><p>${esc(message)}</p>${status===401||status===403?`<p><a class="button primary" href="${esc(loginUrl)}">Mit E-Mail-Adresse anmelden</a></p><p class="hint">Sie erhalten einen persönlichen Link mit PIN an die E-Mail-Adresse Ihres Auftrags.</p>`:''}<p class="hint">White Gloss Detailing · 0152 33540284 · <a href="mailto:info@white-gloss.de">info@white-gloss.de</a></p></main>`;
}
if(!/^[a-f0-9]{64}$/.test(token))failure('Dieser Chatlink ist unvollständig. Bitte den Link aus Ihrer E-Mail vollständig öffnen.',404);
else{
  app.innerHTML='<div class="chat-shell" id="chatroot"></div>';
  const head=header();let described=false;
  mountConversation(document.querySelector('#chatroot'),{
    base:'/api/kundenchat/'+token,role:'customer',header:head,
    emptyText:'Schreiben Sie uns – zum Beispiel Fragen zum Termin oder Fotos von Ihrem Fahrzeug. Wir antworten so schnell wie möglich.',
    onData(data){
      if(data.error){failure(data.error,data.status);return;}
      if(described)return;described=true;
      head.querySelector('[data-chat-subtitle]').textContent=['Auftrag '+data.wg,data.vehicle].filter(Boolean).join(' · ');
      const call=head.querySelector('[data-chat-call]');call.href='tel:'+String(data.company?.phone??'').replace(/[^\d+]/g,'').replace(/^0/,'+49');call.hidden=!data.company?.phone;
      document.title='White Gloss · Chat '+data.wg;
    }
  });
}
