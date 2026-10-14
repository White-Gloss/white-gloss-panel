// Kundenportal „Mein White Gloss“ unter /kunde. Der Kunde ist über E-Mail-Link und PIN angemeldet
// und sieht nur Aufträge mit seiner E-Mail-Adresse. Der Betreiber öffnet mit ?vorschau=<Auftrag>
// eine schreibgeschützte Vorschau.
import {mountConversation,esc} from './chat-ui.js';
import {signatureBox,mountSignatures} from './signature.js';
const app=document.querySelector('#app');
const params=new URLSearchParams(location.search),previewId=params.get('vorschau');
const loginUrl='/auth/login?returnTo='+encodeURIComponent('/kunde');
const moneyFormat=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'});
const money=cents=>cents===null||cents===undefined?'—':moneyFormat.format(cents/100);
const dateTime=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
const dateShort=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit',year:'numeric'});
const when=iso=>iso?dateTime.format(new Date(iso))+' Uhr':'';
// Freitext (z. B. „KW 42“) bleibt unverändert stehen statt die Seite abstürzen zu lassen.
const day=value=>{if(!value)return '';if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value.slice(8,10)+'.'+value.slice(5,7)+'.'+value.slice(0,4);const d=new Date(value);return Number.isFinite(+d)?dateShort.format(d):String(value);};
const INVOICE_STATUS={open:'Offen',overdue:'Überfällig',paid:'Bezahlt',canceled:'Storniert'};
const REQUEST_STATUS={offen:'Angefragt – wir prüfen',übernommen:'Übernommen – ergänztes Angebot folgt',erledigt:'Erledigt',abgelehnt:'Leider nicht möglich'};
const icon=path=>`<svg class="portal-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
const ICONS={doc:'M6 3h8l4 4v14H6zM14 3v5h4M9 13h6M9 17h6',down:'M12 4v11M7 10l5 5 5-5M5 20h14',sign:'M4 18c3-6 5-9 7-9s-1 9 2 9 3-4 4-4 1 2 3 2M4 21h16',star:'M12 3l2.6 5.5 6 .7-4.5 4.1 1.2 5.9L12 16.3 6.7 19.2l1.2-5.9L3.4 9.2l6-.7z',phone:'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',mail:'M3 6h18v12H3zM3 7l9 6 9-6',cal:'M4 5h16v16H4zM8 3v4M16 3v4M4 10h16',camera:'M4 8h4l2-3h4l2 3h4v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8',plus:'M12 5v14M5 12h14'};
let data=null,selectedId=null,chat=null,pads={};

async function api(path,body){
  const r=await fetch('/api/portal/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin'});
  const d=await r.json().catch(()=>({error:'Antwort nicht lesbar. Bitte Seite neu laden.'}));
  if(!r.ok)throw Object.assign(Error(d.error??'Verbindung fehlgeschlagen.'),{status:r.status});return d;
}
function toast(message){const t=document.querySelector('#toast');t.textContent=message;t.classList.add('visible');setTimeout(()=>t.classList.remove('visible'),6000);}
function gate(message,login=false){
  app.innerHTML=`<main class="appoff card portal-gate"><span class="brandmark">WG</span><h1>Mein White Gloss</h1><p>${esc(message)}</p>${login?`<p><a class="button primary" href="${esc(loginUrl)}">Mit E-Mail-Adresse anmelden</a></p><p class="hint">Sie erhalten einen persönlichen Link mit PIN an die E-Mail-Adresse Ihrer Anfrage.</p>`:''}<p class="hint">White Gloss Detailing, Horb am Neckar · <a href="tel:+4915233540284">0152 33540284</a> · <a href="mailto:info@white-gloss.de">info@white-gloss.de</a></p></main>`;
}
async function load(){
  try{data=await api('me'+(previewId?'?vorschau='+encodeURIComponent(previewId):''));}
  catch(error){if(error.status===401){location.replace(loginUrl);return;}gate(error.message,error.status===403);return;}
  const wanted=location.hash.slice(1);
  selectedId=data.orders.find(o=>o.id===wanted)?.id??data.orders.find(o=>o.id===previewId)?.id??data.orders.find(o=>o.todo?.length)?.id??data.orders.find(o=>!o.closed&&o.step!==null&&o.step<5)?.id??data.orders.find(o=>!o.closed)?.id??data.orders[0]?.id??null;
  render();
}

function render(){
  chat?.destroy();chat=null;
  const o=data.orders.find(x=>x.id===selectedId);
  const first=(data.customer.name||'').split(/\s+/)[0];
  app.innerHTML=`<div class="portal">
  <header class="portal-top"><a class="portal-brand" href="/kunde"><span class="brandmark">WG</span><span><strong>White Gloss</strong><small>Mein Kundenportal</small></span></a><button class="portal-logout" data-act="logout"${data.preview?' disabled':''}>Abmelden</button></header>
  ${data.preview?'<p class="portal-preview" role="status">Betreibervorschau: So sieht der Kunde sein Portal. Aktionen sind hier gesperrt.</p>':''}
  <main class="portal-main">
    <h1 class="portal-hello">${first?'Hallo '+esc(first):'Willkommen'}</h1>
    ${data.orders.length>1?`<nav class="portal-orders" aria-label="Ihre Aufträge">${data.orders.map(x=>`<button data-order="${x.id}" aria-current="${x.id===selectedId?'true':'false'}"><strong>${esc(x.vehicle||x.wg)}</strong><span>${esc(x.wg)}, ${esc(x.status)}</span></button>`).join('')}</nav>`:''}
    ${o?orderView(o):'<section class="portal-card"><h2>Noch kein Auftrag</h2><p>Unter dieser E-Mail-Adresse gibt es keinen aktiven Auftrag. Neue Anfragen stellen Sie auf <a href="https://white-gloss.de">white-gloss.de</a>.</p></section>'}
  </main>
  <footer class="portal-foot"><strong>${esc(data.company.name)}</strong><span>${esc(data.company.owner)}, ${esc(data.company.street)}, ${esc(data.company.city)}</span><span><a href="tel:${esc(tel(data.company.phone))}">${esc(data.company.phone)}</a> · <a href="mailto:${esc(data.company.email)}">${esc(data.company.email)}</a></span></footer></div>`;
  // Unterschriftsfeld nur im Bestätigungsformular; es wird bei jedem Neuzeichnen ersetzt.
  const confirmBox=app.querySelector('.portal-confirm');pads=confirmBox?mountSignatures(confirmBox):{};
}
const tel=phone=>String(phone??'').replace(/[^\d+]/g,'').replace(/^0/,'+49');

function orderView(o){
  return `<div class="portal-grid">
  <div class="portal-col">${hero(o)}${todo(o)}${appointment(o)}${services(o)}${extrasView(o)}</div>
  <div class="portal-col">${messages(o)}${documents(o)}${invoice(o)}${review(o)}</div></div>`;
}
function hero(o){
  const rail=o.step===null?'':`<ol class="portal-rail" aria-label="Fortschritt">${o.steps.map((label,i)=>`<li class="${i<o.step?'is-done':i===o.step?'is-now':''}"${i===o.step?' aria-current="step"':''}><span class="portal-dot" aria-hidden="true">${i<o.step?'✓':''}</span><span class="portal-steplabel">${esc(label)}</span></li>`).join('')}</ol>`;
  return `<section class="portal-hero${o.closed?' is-closed':''}" aria-labelledby="hero-${o.id}">
    <p class="portal-vehicle">${esc(o.vehicle||'Ihr Fahrzeug')}${o.plate?` <span class="portal-plate">${esc(o.plate)}</span>`:''}</p>
    <h2 id="hero-${o.id}">${esc(o.statusText)}</h2>
    <p class="portal-meta">Auftrag ${esc(o.wg)}${o.package?', '+esc(o.package):''}${o.createdAt?', angefragt am '+esc(day(o.createdAt)):''}</p>
    ${rail}</section>`;
}
function todo(o){
  if(!o.todo.length)return '';
  return `<section class="portal-card portal-todo"><h2>Für Sie zu erledigen</h2><ul>${o.todo.map(t=>`<li>${t.anchor?`<a class="portal-action" href="#${esc(t.anchor)}">${icon(ICONS.sign)}<span>${esc(t.label)}</span></a>`:t.url?`<a class="portal-action" href="${esc(t.url)}">${icon(ICONS.sign)}<span>${esc(t.label)}</span></a>`:t.action?`<button class="portal-action" data-act="sign" data-kind="${esc(t.document)}"${data.preview?' disabled':''}>${icon(ICONS.sign)}<span>${esc(t.label)}</span></button>`:`<p class="portal-note">${esc(t.label)}</p>`}</li>`).join('')}</ul></section>`;
}
function appointment(o){
  const a=o.appointment;
  if(!a)return o.closed||o.step===null||o.step>=4?'':`<section class="portal-card"><h2>Termin</h2><p>${o.desiredDate?'Ihr Wunschtermin: '+esc(day(o.desiredDate))+'. ':''}Den genauen Termin stimmen wir mit Ihnen ab und tragen ihn hier ein.</p></section>`;
  const open=o.requests.find(r=>r.kind==='termin'&&r.status==='offen');
  const status=a.confirmed?`<p class="portal-confirmed"><span aria-hidden="true">✓</span> Verbindlich bestätigt${a.confirmedAt?' am '+esc(day(a.confirmedAt)):''}</p>`:`<p class="portal-pending"><span aria-hidden="true">◌</span> Vorgeschlagen – noch nicht bestätigt</p>`;
  const confirm=a.canConfirm?`<div class="portal-confirm" id="termin-${esc(o.id)}"><p>Bitte bestätigen Sie diesen Termin mit Ihrer Unterschrift. Erst dann ist er für beide Seiten verbindlich.</p><form data-form="confirm" data-hash="${esc(a.snapshotHash)}"><label>Ihr Name<input name="customerName" maxlength="180" autocomplete="name" value="${esc(data.customer.name)}"></label>${signatureBox('confirm-sign','Ihre Unterschrift')}<label class="check portal-check"><input type="checkbox" name="confirmed"> Ich bestätige den oben angezeigten Termin verbindlich.</label><button class="primary" type="submit"${data.preview?' disabled':''}>Termin verbindlich bestätigen</button><p class="error" role="alert"></p></form></div>`:'';
  return `<section class="portal-card portal-termin"><h2>Termin</h2>${status}
    <p class="portal-when">${icon(ICONS.cal)}<span><strong>${esc(when(a.start))}</strong>${a.end?`<span>Voraussichtlich fertig: ${esc(when(a.end))}</span>`:''}</span></p>
    <dl class="portal-facts"><div><dt>Übergabe</dt><dd>${a.delivery==='Abholung'?'Wir holen Ihr Fahrzeug ab':'Sie bringen Ihr Fahrzeug zu uns'}</dd></div>${a.location?`<div><dt>Ort</dt><dd>${esc(a.location)}</dd></div>`:''}${a.workDays>1?`<div><dt>Dauer</dt><dd>${a.workDays} Arbeitstage</dd></div>`:''}</dl>
    ${a.curingNote?`<p class="portal-note">Nach der Versiegelung: ${esc(a.curingNote)}</p>`:''}
    ${confirm}
    ${open?`<p class="portal-note">Ihr Terminwunsch vom ${esc(day(open.createdAt))} liegt uns vor. Wir melden uns.</p>`:!o.canReschedule?'':`<details class="portal-more"><summary>Termin verschieben?</summary><form data-form="termin"><label>Ihr Wunsch<textarea name="wish" rows="3" maxlength="500" required placeholder="z. B. lieber eine Woche später, vormittags"></textarea></label><button class="primary" type="submit"${data.preview?' disabled':''}>Terminwunsch senden</button><p class="hint">Bis wir uns melden, gilt der bisherige Termin.</p><p class="error" role="alert"></p></form></details>`}
  </section>`;
}
function services(o){
  if(!o.offer)return '';
  const lines=o.offer.lines.length?`<table class="portal-lines"><tbody>${o.offer.lines.map(l=>`<tr><td>${esc(l.title)}${l.description?`<small>${esc(l.description)}</small>`:''}</td><td>${money(l.amountCents)}</td></tr>`).join('')}</tbody><tfoot><tr><th scope="row">Festpreis gesamt</th><td>${money(o.offer.totalCents)}</td></tr></tfoot></table>`:`<p>${esc(o.offer.services)}</p><p><strong>Festpreis ${money(o.offer.totalCents)}</strong></p>`;
  return `<section class="portal-card"><h2>${o.offer.signed?'Ihre gebuchten Leistungen':'Ihr Angebot'}</h2>${lines}<p class="hint">Alle Preise inklusive Mehrwertsteuer.</p></section>`;
}
function extrasView(o){
  const requests=o.requests.filter(r=>r.kind==='extras');
  if(!o.extras.length&&!requests.length)return '';
  const list=o.extras.length?`<details class="portal-more portal-extrasbox"><summary>${requests.length?'Weitere Zusatzleistungen ansehen':o.extras.length+' Zusatzleistungen für Ihr Fahrzeug ansehen'}</summary><form data-form="extras" class="portal-extras"><fieldset><legend class="sr-only">Zusatzleistungen auswählen</legend>${o.extras.map(e=>`<label class="portal-extra"><input type="checkbox" name="extra" value="${esc(e.id)}"><span><strong>${esc(e.name)}</strong><small>${esc(e.hint)}</small></span><span class="portal-price">${e.inspect?'ab ':''}${money(e.priceCents)}</span></label>`).join('')}</fieldset><label>Hinweis (optional)<textarea name="note" rows="2" maxlength="500"></textarea></label><button class="primary" type="submit"${data.preview?' disabled':''}>Unverbindlich anfragen</button><p class="hint">Die Anfrage ist noch keine Buchung. Wir prüfen sie und schicken Ihnen ein ergänztes Angebot, das Sie hier unterschreiben.${o.extras.some(e=>!e.classKnown)?' Preise gelten für die Kompaktklasse; für größere Fahrzeuge bestätigen wir den Preis.':''}</p><p class="error" role="alert"></p></form></details>`:'';
  return `<section class="portal-card"><h2>Zusatzleistungen</h2>${requests.length?`<ul class="portal-requests">${requests.map(r=>`<li><span>${esc((r.extras??[]).map(e=>e.name).join(', '))}</span><span class="portal-state">${esc(REQUEST_STATUS[r.status]??r.status)}</span></li>`).join('')}</ul>`:''}${list}</section>`;
}
function messages(o){
  if(o.restricted)return '';
  return `<section class="portal-card portal-chatcard"><h2>Nachrichten und Fotos</h2><p>Fragen zum Auftrag, Fotos vom Fahrzeug oder Wünsche: Schreiben Sie uns direkt hier.</p><div class="portal-chatactions"><button class="primary" data-act="chat"${data.preview?' disabled':''}>Chat öffnen</button><button data-act="photo"${data.preview?' disabled':''}>${icon(ICONS.camera)}Fotos senden</button></div><div class="portal-chat" id="portal-chat" hidden></div></section>`;
}
function documents(o){
  if(o.restricted)return '';
  if(!o.documents.length)return `<section class="portal-card"><h2>Dokumente</h2><p>Hier finden Sie nach der Auftragsannahme Ihre Auftragsbestätigung und die Fahrzeugprotokolle als PDF.</p></section>`;
  return `<section class="portal-card"><h2>Dokumente</h2><ul class="portal-docs">${o.documents.map(d=>`<li><a href="${esc(d.url)}" download>${icon(ICONS.doc)}<span><strong>${esc(d.label)}</strong><small>${d.at?esc(day(d.at)):''}${d.signed===false?(d.at?', ':'')+'ohne Ihre Unterschrift':''}</small></span>${icon(ICONS.down)}</a></li>`).join('')}</ul></section>`;
}
function invoice(o){
  const inv=o.invoice;if(!inv)return '';
  const open=inv.status==='open'||inv.status==='overdue',p=inv.payment??{};
  return `<section class="portal-card portal-invoice"><h2>Rechnung ${esc(inv.number)}</h2>
    <p class="portal-amount"><strong>${money(open?inv.openCents:inv.totalCents)}</strong><span class="portal-state ${inv.status}">${esc(INVOICE_STATUS[inv.status]??inv.status)}</span></p>
    <dl class="portal-facts">${inv.issueDate?`<div><dt>Rechnungsdatum</dt><dd>${esc(day(inv.issueDate))}</dd></div>`:''}${open&&inv.dueDate?`<div><dt>Zahlbar bis</dt><dd>${esc(day(inv.dueDate))}</dd></div>`:''}${open&&p.beneficiary?`<div><dt>Empfänger</dt><dd>${esc(p.beneficiary)}</dd></div>`:''}${open&&p.iban?`<div><dt>IBAN</dt><dd>${esc(p.iban)}</dd></div>`:''}${open?`<div><dt>Verwendungszweck</dt><dd>${esc(p.reference??inv.number)}</dd></div>`:''}</dl>
    <div class="portal-row"><a class="button" href="${esc(inv.pdfUrl)}" download>${icon(ICONS.down)}Rechnung als PDF</a>${inv.payUrl?`<a class="button primary" href="${esc(inv.payUrl)}" target="_blank" rel="noopener noreferrer">Online bezahlen</a>`:''}</div></section>`;
}
function review(o){
  if(!o.review)return '';
  return `<section class="portal-card portal-review"><h2>Wie zufrieden sind Sie?</h2><p>Eine kurze Bewertung auf Google hilft uns als kleinem Betrieb sehr. Vielen Dank!</p><a class="button primary" href="${esc(o.review)}" target="_blank" rel="noopener noreferrer">${icon(ICONS.star)}Auf Google bewerten</a></section>`;
}

async function openChat(attach=false,scroll=true){
  const o=data.orders.find(x=>x.id===selectedId),box=document.querySelector('#portal-chat');
  // Ist der Chat schon offen, öffnet „Fotos senden“ die Auswahl direkt (noch innerhalb des Tippens).
  if(chat&&attach){box.querySelector('input[type=file]')?.click();return;}
  if(!chat){
    const result=await api('o/'+o.id+'/chat',{});
    if(!result.available){toast(result.message);return;}
    box.hidden=false;
    chat=mountConversation(box,{base:result.base,role:'customer',header:null,emptyText:'Schreiben Sie uns – zum Beispiel Fragen zum Termin oder Fotos von Ihrem Fahrzeug. Wir antworten so schnell wie möglich.',onData(d){if(d?.error)toast(d.error);}});
    document.querySelector('[data-act="chat"]').textContent='Chat ist geöffnet';
  }
  if(scroll)box.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  if(attach)toast('Tippen Sie unten im Chat auf die Büroklammer, um Fotos aus der Kamera oder Galerie zu senden.');
}

document.addEventListener('click',async event=>{
  const target=event.target.closest('[data-order],[data-act]');if(!target||!data)return;
  if(target.dataset.order){selectedId=target.dataset.order;history.replaceState(null,'','#'+selectedId);render();return;}
  const act=target.dataset.act;
  try{
    if(act==='logout'){await fetch('/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin'});location.replace(loginUrl);}
    if(act==='chat')await openChat(false);
    if(act==='photo')await openChat(true);
    if(act==='sign'){target.disabled=true;const r=await api('o/'+selectedId+'/sign/'+target.dataset.kind,{});location.assign(r.url);}
  }catch(error){target.disabled=false;toast(error.message);}
});
document.addEventListener('submit',async event=>{
  const form=event.target.closest('[data-form]');if(!form)return;event.preventDefault();
  const button=form.querySelector('[type=submit]'),error=form.querySelector('.error');button.disabled=true;error.textContent='';
  try{
    let r;
    if(form.dataset.form==='extras'){const extraIds=[...form.querySelectorAll('input[name=extra]:checked')].map(x=>x.value);if(!extraIds.length)throw Error('Bitte mindestens eine Zusatzleistung auswählen.');r=await api('o/'+selectedId+'/extras',{extraIds,note:form.elements.note.value});}
    if(form.dataset.form==='termin')r=await api('o/'+selectedId+'/termin',{wish:form.elements.wish.value});
    if(form.dataset.form==='confirm'){const signature=pads['confirm-sign']?.dataURL();if(!form.elements.confirmed.checked)throw Error('Bitte bestätigen Sie den angezeigten Termin.');if(!signature)throw Error('Bitte unterschreiben Sie im Feld „Ihre Unterschrift“.');r=await api('o/'+selectedId+'/termin-bestaetigen',{signature,confirmed:true,customerName:form.elements.customerName.value,snapshotHash:form.dataset.hash});}
    const reopen=Boolean(chat);toast(r.message);await load();if(reopen)await openChat(false,false);
  }catch(e){error.textContent=e.message;button.disabled=false;}
});
load();
