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
let data=null,businessData={accounts:[]},portalSection='orders',selectedId=null,chat=null,pads={},chatOpening=null,chatGeneration=0;

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
  try{businessData=await api('business/me'+(previewId?'?vorschau='+encodeURIComponent(previewId):''));}
  catch(error){businessData={accounts:[]};toast('Der Firmenbereich konnte nicht geladen werden: '+error.message);}
  const wanted=location.hash.slice(1);
  selectedId=data.orders.find(o=>o.id===wanted)?.id??data.orders.find(o=>o.id===previewId)?.id??data.orders.find(o=>o.todo?.length)?.id??data.orders.find(o=>!o.closed&&o.step!==null&&o.step<5)?.id??data.orders.find(o=>!o.closed)?.id??data.orders[0]?.id??null;
  if(!data.orders.length&&businessData.accounts.length)portalSection='business';
  render();
}

function render(){
  chatGeneration++;chatOpening=null;
  chat?.destroy();chat=null;
  const o=data.orders.find(x=>x.id===selectedId);
  const first=(data.customer.name||businessData.accounts[0]?.name||'').split(/\s+/)[0];
  app.innerHTML=`<div class="portal">
  <header class="portal-top"><a class="portal-brand" href="/kunde"><span class="brandmark">WG</span><span><strong>White Gloss</strong><small>Mein Kundenportal</small></span></a><button class="portal-logout" data-act="logout"${data.preview?' disabled':''}>Abmelden</button></header>
  ${data.preview?'<p class="portal-preview" role="status">Betreibervorschau: So sieht der Kunde sein Portal. Aktionen sind hier gesperrt.</p>':''}
  <main class="portal-main">
    <div class="portal-heading"><p class="eyebrow">Ihr persönlicher Kundenbereich</p><h1 class="portal-hello">${first?'Hallo '+esc(first):'Willkommen'}</h1><p>Termine, Leistungen und Dokumente für Ihr Fahrzeug — direkt und verlässlich an einem Ort.</p></div>
    ${businessData.accounts.length?`<nav class="portal-sections" aria-label="Kundenbereiche"><button type="button" data-portal-section="orders" aria-current="${portalSection==='orders'?'page':'false'}">Meine Aufträge</button><button type="button" data-portal-section="business" aria-current="${portalSection==='business'?'page':'false'}">Firmenbereich</button></nav>`:''}
    ${portalSection==='business'&&businessData.accounts.length?businessView():`${data.orders.length>1?`<nav class="portal-orders" aria-label="Ihre Aufträge">${data.orders.map(x=>`<button data-order="${x.id}" aria-current="${x.id===selectedId?'true':'false'}"><strong>${esc(x.vehicle||x.wg)}</strong><span>${esc(x.wg)}, ${esc(x.status)}</span></button>`).join('')}</nav>`:''}${o?orderView(o):'<section class="portal-card"><h2>Noch kein Auftrag</h2><p>Unter dieser E-Mail-Adresse gibt es keinen aktiven Auftrag. Neue Anfragen stellen Sie auf <a href="https://white-gloss.de">white-gloss.de</a>.</p></section>'}`}
  </main>
  <footer class="portal-foot"><strong>${esc(data.company.name)}</strong><span>${esc(data.company.owner)}, ${esc(data.company.street)}, ${esc(data.company.city)}</span><span><a href="tel:${esc(tel(data.company.phone))}">${esc(data.company.phone)}</a> · <a href="mailto:${esc(data.company.email)}">${esc(data.company.email)}</a></span></footer></div>`;
  // Unterschriftsfeld nur im Bestätigungsformular; es wird bei jedem Neuzeichnen ersetzt.
  const confirmBox=app.querySelector('.portal-confirm');pads=confirmBox?mountSignatures(confirmBox):{};
}
const tel=phone=>String(phone??'').replace(/[^\d+]/g,'').replace(/^0/,'+49');

function orderView(o){
  return `${hero(o)}${o.restricted?'':`<nav class="portal-jump" aria-label="Direkt zu Ihrem Auftrag"><a href="#leistungen-${esc(o.id)}">Termin & Leistungen</a><a href="#angaben-${esc(o.id)}">Ihre Angaben</a><a href="#dokumente-${esc(o.id)}">Dokumente${o.documents.length?` <span>${o.documents.length}</span>`:''}</a><a href="#nachrichten-${esc(o.id)}">Nachrichten & Fotos</a></nav>`}
  <div class="portal-grid">
  <div class="portal-col">${todo(o)}<div class="portal-section" id="leistungen-${esc(o.id)}">${appointment(o)}${services(o)}${extrasView(o)}</div>${inquiry(o)}</div>
  <div class="portal-col">${messages(o)}${documents(o)}${invoice(o)}${review(o)}</div></div>`;
}
function inquiry(o){
  if(o.restricted||!o.inquiry)return '';
  const values=[['Name',o.inquiry.name],['E-Mail',data.customer.email],['Telefon',o.inquiry.phone],['Fahrzeug',o.inquiry.vehicle],['Kennzeichen',o.inquiry.plate],['Fahrzeugklasse',o.inquiry.vehicleClass],['Gewünschtes Paket',o.inquiry.package],['Wunschtermin',o.inquiry.desiredDate],['Zeitfenster',o.inquiry.timeWindow],['Übergabe',o.inquiry.delivery],['Adresse',o.inquiry.address],['Ihre Anmerkung',o.inquiry.note]].filter(([,value])=>value);
  const requests=o.requests.filter(r=>r.kind==='details');
  return `<section class="portal-card portal-inquiry" id="angaben-${esc(o.id)}"><h2>Ihre Anfrage und Angaben</h2><p>Bitte prüfen Sie Ihre Angaben. Korrekturen können Sie uns direkt hier mitteilen.</p><dl class="portal-facts">${values.map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${requests.length?`<ul class="portal-requests">${requests.map(r=>`<li><span><strong>Änderungswunsch</strong><small>${esc(r.wish)}</small></span><span class="portal-state">${esc(REQUEST_STATUS[r.status]??r.status)}</span></li>`).join('')}</ul>`:''}<details class="portal-more"><summary>Angaben korrigieren oder etwas ändern</summary><form data-form="angaben"><label>Was sollen wir ändern?<textarea name="wish" rows="4" maxlength="1000" required placeholder="z. B. Kennzeichen FDS-WG 2 statt FDS-WG 1 oder neue Abholadresse"></textarea></label><button class="primary" type="submit"${data.preview?' disabled':''}>Änderungswunsch senden</button><p class="hint">Ihre bisherigen Angaben bleiben gültig, bis wir die Änderung geprüft und bestätigt haben. Ein unterschriebenes Angebot wird dadurch nicht automatisch geändert.</p><p class="error" role="alert"></p></form></details></section>`;
}
const businessStatus={OPEN:'Eingegangen',IN_PROGRESS:'In Bearbeitung',DONE:'Erledigt',DECLINED:'Abgelehnt'};
function businessView(){return `<div class="business-portal">${businessData.accounts.map(account=>`<section aria-labelledby="business-${esc(account.id)}"><div class="business-portal-head"><div><p class="eyebrow">Ihr Firmenbereich</p><h2 id="business-${esc(account.id)}">${esc(account.company)}</h2><p>Fahrzeuganfragen und abgeschlossene Reinigungen an einem Ort.</p></div><span class="badge good">Geschäftskunde</span></div><div class="business-portal-grid"><div class="portal-col"><section class="portal-card"><h2>Fahrzeuge zur Reinigung melden</h2><p>Teilen Sie uns die Anzahl mit. Wir stimmen anschließend Leistungen und Termin mit Ihnen ab. Das ist noch keine Buchung.</p><form data-form="business-request" data-account="${esc(account.id)}" class="business-request-form"><label>Anzahl Fahrzeuge<input type="number" name="count" min="1" max="100" step="1" inputmode="numeric" required placeholder="z. B. 5"></label><label>Wunschtermin (optional)<input type="date" name="desiredDate"></label><label>Hinweis (optional)<textarea name="note" rows="3" maxlength="500" placeholder="z. B. Fahrzeugtypen oder gewünschter Zeitraum"></textarea></label><button class="primary" type="submit"${data.preview?' disabled':''}>Anfrage senden</button><p class="error" role="alert"></p></form></section><section class="portal-card"><h2>Ihre Anfragen</h2>${account.requests.length?`<ul class="portal-requests">${account.requests.map(request=>`<li><span><strong>${request.count} ${request.count===1?'Fahrzeug':'Fahrzeuge'}</strong>${request.desiredDate?` · Wunschtermin ${esc(day(request.desiredDate))}`:''}${request.note?`<small>${esc(request.note)}</small>`:''}</span><span class="portal-state">${esc(businessStatus[request.status]??request.status)}</span></li>`).join('')}</ul>`:'<p>Noch keine Fahrzeuganfrage.</p>'}</section></div><div class="portal-col"><section class="portal-card"><h2>Erledigte Fahrzeuge</h2>${account.vehicles.length?account.vehicles.map(vehicle=>`<article class="business-fleet-card"><h3>${esc(vehicle.title)}${vehicle.plate?' · '+esc(vehicle.plate):''}</h3><p>Erledigt am ${esc(day(vehicle.completedOn))}</p><p class="business-fleet-price">${money(vehicle.netPriceMinor)} netto</p>${vehicle.note?`<p>${esc(vehicle.note)}</p>`:''}${vehicle.photos.length?`<div class="business-fleet-gallery">${vehicle.photos.map(photo=>`<a href="${esc(photo.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(photo.url)}" alt="${esc(vehicle.title)} nach der Reinigung" loading="lazy"></a>`).join('')}</div>`:''}</article>`).join(''):'<p>Hier erscheinen abgeschlossene Fahrzeuge, sobald White Gloss sie für Sie freigegeben hat.</p>'}<p class="hint">Die Übersicht dient Ihrer Information. Rechnungen finden Sie wie bisher beim jeweiligen Auftrag.</p></section></div></div></section>`).join('')}</div>`;}
function hero(o){
  const rail=o.step===null?'':`<ol class="portal-rail" aria-label="Fortschritt">${o.steps.map((label,i)=>`<li class="${i<o.step?'is-done':i===o.step?'is-now':''}"${i===o.step?' aria-current="step"':''}><span class="portal-dot" aria-hidden="true">${i<o.step?'✓':''}</span><span class="portal-steplabel">${esc(label)}</span></li>`).join('')}</ol>`;
  return `<section class="portal-hero${o.closed?' is-closed':''}" aria-labelledby="hero-${o.id}">
    <p class="portal-vehicle">${esc(o.vehicle||'Ihr Fahrzeug')}${o.plate?` <span class="portal-plate">${esc(o.plate)}</span>`:''}</p>
    <h2 id="hero-${o.id}">${esc(o.statusText)}</h2>
    <p class="portal-meta">Auftrag ${esc(o.wg)}${o.package?', '+esc(o.package):''}${o.createdAt?', angefragt am '+esc(day(o.createdAt)):''}</p>
    ${rail}</section>`;
}
function todo(o){
  const waiting=o.requests.some(r=>r.status==='offen');
  const title=o.closed?(o.status==='Bezahlt'?'Vielen Dank – Ihr Auftrag ist abgeschlossen.':'Für diesen Vorgang ist nichts mehr offen.'):o.appointment?.confirmed?'Ihr Termin ist verbindlich bestätigt.':waiting?'Ihre Anfrage ist bei uns.':'Aktuell ist nichts zu unterschreiben.';
  const action=(t,index)=>{
    const style=index===0?'portal-action':'portal-secondary-action';
    const content=`${icon(t.kind==='offer-open'||t.kind==='confirm-appointment'?ICONS.doc:ICONS.sign)}<span>${esc(t.label)}</span>`;
    if(data.preview&&(t.anchor||t.url||t.action))return `<span class="${style}" aria-disabled="true">${content}</span>`;
    if(t.anchor)return `<a class="${style}" href="#${esc(t.anchor)}">${content}</a>`;
    if(t.url)return `<a class="${style}" href="${esc(t.url)}">${content}</a>`;
    if(t.action)return `<button type="button" class="${style}" data-act="sign" data-kind="${esc(t.document)}">${content}</button>`;
    if(t.kind==='offer-expired')return `<p class="portal-note">${esc(t.label)}</p><button type="button" class="${style}" data-act="contact"${data.preview?' disabled':''}>${icon(ICONS.mail)}<span>Neuen Angebotslink anfragen</span></button>`;
    return `<p class="portal-note">${esc(t.label)}</p>`;
  };
  return `<section class="portal-card portal-next${o.todo.length?' portal-todo':' portal-next-clear'}" aria-labelledby="next-${esc(o.id)}"><p class="eyebrow">${o.todo.length?'Ihr nächster Schritt':'Aktueller Stand'}</p><h2 id="next-${esc(o.id)}">${o.todo.length?(o.todo.length===1?'Eine Aktion ist für Sie offen':o.todo.length+' Aktionen sind für Sie offen'):title}</h2>${o.todo.length?`<ul>${o.todo.map((t,index)=>`<li>${action(t,index)}</li>`).join('')}</ul>`:`<p>${o.closed?'Ihre vorhandenen Dokumente bleiben hier für Sie abrufbar.':o.appointment?.confirmed?'Die Details zu Termin, Übergabe und Leistungen finden Sie direkt darunter.':waiting?'Wir prüfen Ihren Wunsch. Bis zu unserer Bestätigung bleibt der bisherige Stand gültig.':'Sobald ein Angebot oder Dokument Ihre Bestätigung benötigt, erscheint es hier.'}</p>${o.restricted?'':`<button type="button" class="portal-text-action" data-act="contact"${data.preview?' disabled':''}>Frage zu diesem Auftrag? Nachricht schreiben <span aria-hidden="true">→</span></button>`}`}</section>`;
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
  return `<section class="portal-card portal-chatcard" id="nachrichten-${esc(o.id)}"><p class="eyebrow">Persönlich für Sie da</p><h2>Nachrichten und Fotos</h2><p>Fragen zum Auftrag, Fotos vom Fahrzeug oder Wünsche: Schreiben Sie uns direkt hier. Ihre Nachricht bleibt diesem Auftrag zugeordnet.</p><div class="portal-chatactions"><button type="button" class="primary" data-act="chat"${data.preview?' disabled':''}>Chat öffnen</button><button type="button" data-act="photo"${data.preview?' disabled':''}>${icon(ICONS.camera)}Fotos senden</button></div><p class="portal-contact">Lieber direkt? <a href="tel:${esc(tel(data.company.phone))}">${esc(data.company.phone)}</a> · <a href="mailto:${esc(data.company.email)}">${esc(data.company.email)}</a></p><div class="portal-chat" id="portal-chat" hidden></div></section>`;
}
function documents(o){
  if(o.restricted)return '';
  if(!o.documents.length)return `<section class="portal-card" id="dokumente-${esc(o.id)}"><div class="portal-card-heading"><h2>Dokumente</h2><span>Noch keine freigegeben</span></div><p>Hier finden Sie nach der Auftragsannahme Ihre Auftragsbestätigung und die Fahrzeugprotokolle als PDF.</p></section>`;
  return `<section class="portal-card" id="dokumente-${esc(o.id)}"><div class="portal-card-heading"><h2>Dokumente</h2><span>${o.documents.length} ${o.documents.length===1?'Datei':'Dateien'}</span></div><ul class="portal-docs">${o.documents.map(d=>`<li><a href="${esc(d.url)}" download>${icon(ICONS.doc)}<span><strong>${esc(d.label)}</strong><small>${d.at?esc(day(d.at)):''}${d.signed===false?(d.at?', ':'')+'ohne Ihre Unterschrift':''}</small></span>${icon(ICONS.down)}</a></li>`).join('')}</ul></section>`;
}
function invoice(o){
  const inv=o.invoice;if(!inv)return '';
  const open=inv.status==='open'||inv.status==='overdue',p=inv.payment??{},lines=inv.lines??[];
  return `<section class="portal-card portal-invoice"><h2>Rechnung ${esc(inv.number)}</h2>
    <div class="portal-amount"><span><small>${open?'Noch zu zahlen':'Rechnungsbetrag'}</small><strong>${money(open?inv.openCents:inv.totalCents)}</strong></span><span class="portal-state ${inv.status}">${esc(INVOICE_STATUS[inv.status]??inv.status)}</span></div>
    ${lines.length?`<details class="portal-more portal-invoice-lines"><summary>Rechnungspositionen ansehen</summary><table class="portal-lines"><tbody>${lines.map(line=>`<tr><td>${esc(line.title)}${line.description?`<small>${esc(line.description)}</small>`:''}</td><td>${money(line.amountCents)}</td></tr>`).join('')}</tbody><tfoot><tr><th scope="row">Rechnungsbetrag</th><td>${money(inv.totalCents)}</td></tr></tfoot></table></details>`:''}
    <dl class="portal-facts">${open&&inv.openCents<inv.totalCents?`<div><dt>Rechnungsbetrag</dt><dd>${money(inv.totalCents)}</dd></div><div><dt>Bereits gezahlt</dt><dd>${money(inv.totalCents-inv.openCents)}</dd></div>`:''}${inv.issueDate?`<div><dt>Rechnungsdatum</dt><dd>${esc(day(inv.issueDate))}</dd></div>`:''}${open&&inv.dueDate?`<div><dt>Zahlbar bis</dt><dd>${esc(day(inv.dueDate))}</dd></div>`:''}${open&&p.beneficiary?`<div><dt>Empfänger</dt><dd>${esc(p.beneficiary)}</dd></div>`:''}${open&&p.iban?`<div><dt>IBAN</dt><dd class="portal-iban">${esc(p.iban)}</dd></div>`:''}${open?`<div><dt>Verwendungszweck</dt><dd>${esc(p.reference??inv.number)}</dd></div>`:''}</dl>
    <div class="portal-row"><a class="button" href="${esc(inv.pdfUrl)}" download>${icon(ICONS.down)}Rechnung als PDF</a>${inv.payUrl?`<a class="button primary" href="${esc(inv.payUrl)}" target="_blank" rel="noopener noreferrer">Online bezahlen</a>`:''}</div></section>`;
}
function review(o){
  if(!o.review)return '';
  return `<section class="portal-card portal-review"><h2>Wie zufrieden sind Sie?</h2><p>Eine kurze Bewertung auf Google hilft uns als kleinem Betrieb sehr. Vielen Dank!</p><a class="button primary" href="${esc(o.review)}" target="_blank" rel="noopener noreferrer">${icon(ICONS.star)}Auf Google bewerten</a></section>`;
}

async function openChat(attach=false,scroll=true){
  const o=data.orders.find(x=>x.id===selectedId),box=document.querySelector('#portal-chat'),generation=chatGeneration;
  if(!o||!box)return;
  const current=()=>generation===chatGeneration&&selectedId===o.id&&box.isConnected&&document.querySelector('#portal-chat')===box;
  // Ist der Chat schon offen, öffnet „Fotos senden“ die Auswahl direkt (noch innerhalb des Tippens).
  if(chat&&attach){box.querySelector('input[type=file]')?.click();return;}
  if(!chat){
    if(chatOpening?.generation===generation&&chatOpening.box===box)return;
    const opening={generation,box};chatOpening=opening;
    try{
      const result=await api('o/'+o.id+'/chat',{});
      if(!current()||chatOpening!==opening)return;
      if(!result.available){toast(result.message);return;}
      box.hidden=false;
      chat=mountConversation(box,{base:result.base,role:'customer',header:null,emptyText:'Schreiben Sie uns – zum Beispiel Fragen zum Termin oder Fotos von Ihrem Fahrzeug. Wir antworten so schnell wie möglich.',onData(d){if(current()&&d?.error)toast(d.error);}});
      document.querySelector('[data-act="chat"]').textContent='Chat ist geöffnet';
    }catch(error){if(current())throw error;return;}
    finally{if(chatOpening===opening)chatOpening=null;}
  }
  if(!current())return;
  if(scroll)box.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  if(attach)toast('Tippen Sie unten im Chat auf die Büroklammer, um Fotos aus der Kamera oder Galerie zu senden.');
}

document.addEventListener('click',async event=>{
  const target=event.target.closest('[data-order],[data-act],[data-portal-section]');if(!target||!data)return;
  if(target.dataset.portalSection){portalSection=target.dataset.portalSection;render();return;}
  if(target.dataset.order){selectedId=target.dataset.order;history.replaceState(null,'','#'+selectedId);render();return;}
  const act=target.dataset.act;
  try{
    if(act==='logout'){await fetch('/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin'});location.replace(loginUrl);}
    if(act==='chat'||act==='contact')await openChat(false);
    if(act==='photo')await openChat(true);
    if(act==='sign'){target.disabled=true;const r=await api('o/'+selectedId+'/sign/'+target.dataset.kind,{});location.assign(r.url);}
  }catch(error){target.disabled=false;toast(error.message);}
});
document.addEventListener('submit',async event=>{
  const form=event.target.closest('[data-form]');if(!form)return;event.preventDefault();
  const button=form.querySelector('[type=submit]'),error=form.querySelector('.error');button.disabled=true;error.textContent='';
  try{
    let r;
    if(form.dataset.form==='business-request'){form.dataset.requestKey??=crypto.randomUUID();r=await api('business/request',{accountId:form.dataset.account,requestKey:form.dataset.requestKey,count:Number(form.elements.count.value),desiredDate:form.elements.desiredDate.value,note:form.elements.note.value});}
    if(form.dataset.form==='extras'){const extraIds=[...form.querySelectorAll('input[name=extra]:checked')].map(x=>x.value);if(!extraIds.length)throw Error('Bitte mindestens eine Zusatzleistung auswählen.');r=await api('o/'+selectedId+'/extras',{extraIds,note:form.elements.note.value});}
    if(form.dataset.form==='angaben')r=await api('o/'+selectedId+'/angaben',{wish:form.elements.wish.value});
    if(form.dataset.form==='termin')r=await api('o/'+selectedId+'/termin',{wish:form.elements.wish.value});
    if(form.dataset.form==='confirm'){const signature=pads['confirm-sign']?.dataURL();if(!form.elements.confirmed.checked)throw Error('Bitte bestätigen Sie den angezeigten Termin.');if(!signature)throw Error('Bitte unterschreiben Sie im Feld „Ihre Unterschrift“.');r=await api('o/'+selectedId+'/termin-bestaetigen',{signature,confirmed:true,customerName:form.elements.customerName.value,snapshotHash:form.dataset.hash});}
    const reopen=Boolean(chat);toast(r.message);await load();if(reopen)await openChat(false,false);
  }catch(e){error.textContent=e.message;button.disabled=false;}
});
load();
