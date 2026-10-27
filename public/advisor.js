const root=document.querySelector('#advisor-root'),message=document.querySelector('#advisor-message'),actions=document.querySelector('#advisor-actions');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const categories={UNCLEAR:'Noch ungeklärt',SERVICE_INCOME:'Dienstleistung / Kundeneinnahme',PRIVATE_CONTRIBUTION:'Privateinlage',PRIVATE_WITHDRAWAL:'Privatentnahme',CLEANING_SUPPLIES:'Reiniger / Polituren',RENT:'Miete',OTHER_EXPENSE:'Sonstige Betriebsausgabe',PRIVATE_PAID_EXPENSE:'Betriebsausgabe privat bezahlt'};
const payments={UNKNOWN:'Noch ungeklärt',QONTO_TRANSFER:'Qonto-Überweisung',QONTO_CARD:'Qonto-Geschäftskarte',CASH:'Bar',CUSTOMER_CARD:'Kundenzahlung per Karte',PRIVATE:'Privat bezahlt',UNPAID:'Unbezahlt'};
const credit={UNCLEAR:'Noch ungeklärt',SERVICE_B2C:'Dienstleistung · Privatkunde',SERVICE_B2B:'Dienstleistung · Firmenkunde',PRIVATE_CONTRIBUTION:'Privateinlage',TAX_REFUND:'Steuererstattung',TRANSFER_IN:'Interner Kontotransfer',OTHER_INCOME:'Sonstiger Eingang'};
const debit={UNCLEAR:'Noch ungeklärt',OPERATING_EXPENSE:'Betriebsausgabe',PRIVATE_WITHDRAWAL:'Privatentnahme',TAX_PAYMENT:'Steuerzahlung',TRANSFER_OUT:'Interner Kontotransfer',CARD_FEE:'Kartengebühr',OTHER_OUTGOING:'Sonstige Abbuchung'};
const labels={category:'Kategorie',paymentPath:'Zahlungsweg',amountMinor:'Betrag brutto',documentDate:'Belegdatum',partner:'Partner',note:'Prüfnotiz',documentId:'Zugeordneter Beleg'};
const tabs={documents:'Belege',bank:'Bankumsätze',invoices:'Rechnungen',proposals:'Vorschläge',accounts:'Zugänge verwalten'};
const options=(values,selected)=>Object.entries(values).map(([key,label])=>`<option value="${esc(key)}" ${key===selected?'selected':''}>${esc(label)}</option>`).join('');
const euro=(value,currency='EUR')=>value===null||value===undefined?'Nicht erfasst':new Intl.NumberFormat('de-DE',{style:'currency',currency}).format(value/100);
const date=value=>value?new Date(value).toLocaleString('de-DE'):'–';
const fragment=new URLSearchParams(location.hash.slice(1));let setupToken=fragment.get('einrichten');
const previewRequested=new URLSearchParams(location.search).get('ansicht')==='kanzlei';
if(setupToken)history.replaceState(null,'',location.pathname);
let session=null,ownerPreview=false,tab='documents',items=[],nextCursor=null,busy=false,receiptOptions=[],receiptCursor=null;
function notify(value,error=false){message.textContent=value;message.className=error?'error':'success';}
async function api(path,body){
  const response=await fetch('/api/advisor'+path,{credentials:'same-origin',method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json().catch(()=>({error:'Antwort konnte nicht gelesen werden.'}));
  if(!response.ok){const error=new Error(data.error||'Anfrage fehlgeschlagen.');error.status=response.status;throw error;}return data;
}
function login(){
  actions.innerHTML='<a href="/auth/login" class="smallbtn advisor-link">Betreiberanmeldung</a>';
  root.innerHTML=`<section class="card advisor-login"><h2>${setupToken?'Persönlichen Zugang einrichten':'Kanzleizugang'}</h2><p>${setupToken?'Gib die vom Betreiber hinterlegte E-Mail-Adresse ein und wähle ein eigenes Passwort. Der Einrichtungslink ist einmal verwendbar.':'Mit dem persönlichen Kanzleikonto anmelden. Einen neuen Einrichtungslink erhältst du vom Betreiber.'}</p><form data-form="login"><label>Persönliche E-Mail-Adresse<input name="email" type="email" maxlength="180" autocomplete="username" required></label><label>${setupToken?'Neues Passwort (mindestens 15 Zeichen)':'Passwort'}<input name="password" type="password" autocomplete="${setupToken?'new-password':'current-password'}" minlength="${setupToken?15:1}" maxlength="128" required></label>${setupToken?'<label>Passwort wiederholen<input name="confirmation" type="password" autocomplete="new-password" minlength="15" maxlength="128" required></label>':''}<button class="primary" type="submit">${setupToken?'Zugang einrichten':'Anmelden'}</button></form></section>`;
}
function shell(){
  actions.innerHTML=session.isOwner?'<a href="/#finance" class="smallbtn advisor-link">Zurück zum Panel</a>':'<button type="button" data-action="logout">Abmelden</button>';
  root.innerHTML=`<p class="advisor-meta">${esc(session.company)} · ${esc(session.email)}</p><p class="notice">${ownerPreview?'Lesende Steuerberateransicht: dieselben Datenlisten, Originale und Exporte wie für die Kanzlei. Kommentare, Vorschläge und Zugangsverwaltung sind in dieser Vorschau ausgeblendet.':'Lesen, Originale herunterladen, CSV oder XLSX exportieren, Belege kommentieren und Zuordnungen vorschlagen. Nur der Betreiber übernimmt Vorschläge als Zuordnungsentwurf.'}</p><nav aria-label="Kanzleibereich">${Object.entries(tabs).filter(([key])=>!ownerPreview&&(key!=='accounts'||session.isOwner)||ownerPreview&&key!=='accounts').map(([key,label])=>`<button type="button" data-tab="${key}" aria-pressed="${key===tab}">${label}</button>`).join('')}</nav><div id="advisor-view"></div>`;
}
function accessCard(account){
  const status=!account.enabled?'Gesperrt':account.enrolled?'Eingerichtet':account.activation_expires>Date.now()?'Einrichtung ausstehend':'Einrichtungslink abgelaufen';
  return `<article class="advisor-item"><h3>${esc(account.company)}</h3><p>${esc(account.email)} · <strong>${status}</strong></p><div class="advisor-actions"><button type="button" data-account-action="reset" data-id="${esc(account.id)}">Neuen Einrichtungslink erzeugen</button>${account.enabled?`<button type="button" class="danger" data-account-action="revoke" data-id="${esc(account.id)}">Zugang sperren</button>`:''}</div></article>`;
}
function renderAccounts(accounts){
  document.querySelector('#advisor-view').innerHTML=`<section class="card"><h2>Steuerberaterzugang anlegen</h2><p>Für jede Person einen eigenen Zugang anlegen. Du gibst den Einrichtungslink selbst über einen vertraulichen Kanal weiter. Es wird keine E-Mail versendet.</p><form data-form="account"><div class="advisor-grid"><label>Kanzleiname<input name="company" maxlength="180" minlength="2" required autocomplete="organization"></label><label>Persönliche E-Mail-Adresse<input name="email" type="email" maxlength="180" required autocomplete="off"></label></div><button class="primary" type="submit">Zugang und Einrichtungslink erstellen</button></form><div id="activation-result"></div></section><section class="card"><h2>Bestehende Zugänge</h2>${accounts.length?accounts.map(accessCard).join(''):'<p>Noch kein Kanzleizugang angelegt.</p>'}</section>`;
}
function activation(data){
  const el=document.querySelector('#activation-result');el.innerHTML=`<div class="notice"><strong>Einrichtungslink erstellt</strong><p>Gültig bis ${esc(date(data.expiresAt))}. Der Link wird nur jetzt angezeigt. Bitte vertraulich zusammen mit der hinterlegten E-Mail-Adresse weitergeben.</p><label>Einrichtungslink<input class="activation-link" readonly value="${esc(data.activationUrl)}"></label><button type="button" data-action="copy">Link kopieren</button><p>Es wurde keine Einladung versendet.</p></div>`;el.scrollIntoView({block:'nearest'});
}
function proposalForm(row,kind){
  const bank=kind==='bank',choices=bank?(row.side==='credit'?credit:debit):categories;
  return `<details><summary>Zuordnung vorschlagen</summary><form data-form="proposal" data-kind="${kind}" data-target="${esc(row.id)}" data-version="${row.version??0}"><label>Kategorie<select name="category" aria-label="Kategorie">${options(choices,row.category||'UNCLEAR')}</select></label>${bank?`<label>Beleg zuordnen<select name="documentId" data-selected="${esc(row.document_id??'')}"><option value="">Kein Beleg zugeordnet</option>${receiptOptions.map(d=>`<option value="${esc(d.id)}" ${d.id===row.document_id?'selected':''}>${esc(d.filename)}</option>`).join('')}${row.document_id&&!receiptOptions.some(d=>d.id===row.document_id)?`<option value="${esc(row.document_id)}" selected>Bereits zugeordneter Beleg · ${esc(row.document_id)}</option>`:''}</select></label>${receiptCursor?'<button type="button" data-action="receipt-options">Weitere Belege zur Auswahl laden</button>':''}`:`<div class="advisor-grid"><label>Zahlungsweg<select name="paymentPath">${options(payments,row.payment_path||'UNKNOWN')}</select></label><label>Betrag brutto in Euro<input name="amount" inputmode="decimal" value="${row.amount_minor===null?'':esc((row.amount_minor/100).toFixed(2).replace('.',','))}"></label><label>Belegdatum<input type="date" name="documentDate" value="${esc(row.document_date??'')}"></label><label>Partner / Lieferant<input name="partner" maxlength="180" value="${esc(row.partner??'')}"></label></div>`}<label>Prüfnotiz<textarea name="note" maxlength="800" rows="2">${esc(row.note??'')}</textarea></label><button type="submit" class="primary">Vorschlag zur Prüfung speichern</button><p class="advisor-meta">Ändert keine bestehende Zuordnung. Der Betreiber muss den Vorschlag ausdrücklich übernehmen.</p></form></details>`;
}
function commentBox(row,kind){return `<details data-comments="${esc(row.id)}" data-kind="${kind}"><summary>Kommentare</summary><button type="button" data-action="comments">Kommentare laden</button><div data-comment-list></div><form data-form="comment" data-kind="${kind}" data-target="${esc(row.id)}"><label>Neuer Kommentar<textarea name="body" maxlength="2000" rows="2" required></textarea></label><button type="submit">Kommentar speichern</button></form></details>`;}
function financeCard(row){
  if(tab==='documents')return `<article class="advisor-item"><h3>${esc(row.filename)}</h3><p class="advisor-meta">Eingang ${esc(date(row.received_at))} · ${esc(euro(row.amount_minor))} · ${esc(categories[row.category]??'Noch ungeklärt')} · Version ${row.version??0}</p><a class="smallbtn advisor-link" href="/api/advisor/document/${esc(row.id)}">Original herunterladen</a>${ownerPreview?'':proposalForm(row,'document')}${ownerPreview?'':commentBox(row,'document')}</article>`;
  if(tab==='bank')return `<article class="advisor-item"><h3>${esc(row.label||'Bankumsatz')} · ${row.side==='credit'?'+':'−'} ${esc(euro(row.amount_minor,row.currency))}</h3><p class="advisor-meta">${esc(row.reference)} · ${esc(date(row.settled_at||row.provider_updated_at))} · ${esc(row.status)}<br>${esc(row.account_iban)} · ${esc((row.side==='credit'?credit:debit)[row.category]??'Noch ungeklärt')}</p>${ownerPreview?'':proposalForm(row,'bank')}${ownerPreview?'':commentBox(row,'bank')}</article>`;
  if(tab==='invoices')return `<article class="advisor-item"><h3>${esc(row.number||'Rechnung')} · ${esc(euro(row.total_cents))}</h3><p>${esc(row.customer)} · ${esc(row.status)}${row.historical?' · Früherer Rechnungsstand':''}</p><p class="advisor-meta">Rechnungsdatum ${esc(row.issue_date||'–')} · Fällig ${esc(row.due_date||'–')}<br>Gespeicherter Anbieterstatus; kein neuer Qonto-Abgleich durch diesen Zugang.</p>${row.pdf_available?`<a class="smallbtn advisor-link" href="/api/advisor/invoice-pdf?orderId=${encodeURIComponent(row.order_id)}&amp;invoiceId=${encodeURIComponent(row.id)}">Archiviertes PDF herunterladen</a>`:'<p class="advisor-meta">Original noch nicht im Panel archiviert. Bitte den Betreiber um Abruf bitten.</p>'}</article>`;
  const detail=Object.entries(row.payload).map(([key,value])=>`<dt>${esc(labels[key]??key)}</dt><dd>${esc(key==='amountMinor'?euro(value):categories[value]??payments[value]??credit[value]??debit[value]??value??'–')}</dd>`).join('');
  return `<article class="advisor-item"><h3>Vorschlag für ${row.target_kind==='document'?'Beleg':'Bankumsatz'}</h3><p class="advisor-meta">${esc(row.company||'Betreiber')} · ${esc(row.email||'')} · ${esc(date(row.created_at))}<br>${esc(row.current?.filename||row.current?.label||row.target_id)} · Ausgangsversion ${row.base_version}</p><p class="advisor-meta">Aktuell: ${esc(categories[row.current?.category]??credit[row.current?.category]??debit[row.current?.category]??'Noch ungeklärt')} · ${esc(euro(row.current?.amount_minor))} · Version ${row.current?.version??0}</p>${!row.decision&&(!row.current||((row.current.version??0)!==row.base_version))?'<p class="notice">Der Ausgangsstand wurde geändert. Dieser Vorschlag kann nicht mehr übernommen werden.</p>':''}<dl>${detail}</dl><strong>${row.decision==='accepted'?'Als Entwurf übernommen':row.decision==='rejected'?'Abgelehnt':'Wartet auf Betreiberprüfung'}</strong>${session.isOwner&&!ownerPreview&&!row.decision?`<div class="advisor-actions"><button type="button" class="primary" data-decision="accepted" data-id="${esc(row.id)}">Als Zuordnungsentwurf übernehmen</button><button type="button" data-decision="rejected" data-id="${esc(row.id)}">Ablehnen</button></div>`:''}</article>`;
}
function renderList(){
  const now=new Date(),month=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  document.querySelector('#advisor-view').innerHTML=`${['documents','bank','invoices'].includes(tab)?`<details class="card"><summary>Daten für einen Zeitraum exportieren</summary><form data-form="export"><div class="advisor-grid"><label>Von<input name="from" type="date" value="${month}-01" required></label><label>Bis<input name="to" type="date" value="${month}-${String(new Date(now.getFullYear(),now.getMonth()+1,0).getDate()).padStart(2,'0')}" required></label><label>Dateiformat<select name="format"><option value="xlsx">Excel-Arbeitsmappe (.xlsx)</option><option value="csv">CSV (.csv)</option></select></label></div><button type="submit">${tabs[tab]} herunterladen</button><p class="advisor-meta">Beträge in Cent. Belege: Belegdatum, sonst Eingangsdatum. Bank: Buchungsdatum, sonst Anbieteränderung. Rechnungen: Rechnungsdatum. Maximal 366 Tage pro Export. Kein DATEV-Buchungsstapel; Originaldateien separat herunterladen.</p></form></details>`:''}<section class="card"><div class="advisor-toolbar"><h2>${tabs[tab]}</h2><button type="button" data-action="refresh">Aktualisieren</button></div>${items.length?items.map(financeCard).join(''):'<p>Noch keine Einträge vorhanden.</p>'}${nextCursor?'<button type="button" class="advisor-pagination" data-action="more">Weitere Einträge laden</button>':''}</section>`;
}
async function load(append=false){
  if(tab==='accounts'){const data=await api('/accounts');renderAccounts(data.accounts);return;}
  if(tab==='bank'&&!receiptOptions.length){const data=await api('/documents');receiptOptions=data.items;receiptCursor=data.nextCursor;}
  const data=await api('/'+tab+(append&&nextCursor?'?cursor='+encodeURIComponent(nextCursor):''));
  items=append?[...items,...data.items]:data.items;nextCursor=data.nextCursor;renderList();
}
async function ready(){session=await api('/session');ownerPreview=session.isOwner&&previewRequested;tab=session.isOwner?(ownerPreview?'documents':'accounts'):'documents';shell();await load();notify(ownerPreview?'Lesende Steuerberateransicht geladen.':'Zugang geladen.');}
async function run(button,job){if(busy)return;busy=true;if(button)button.disabled=true;try{await job();}catch(error){notify(error.message,true);}finally{busy=false;if(button?.isConnected)button.disabled=false;}}
function amount(value){const raw=String(value||'').trim();if(!raw)return null;if(!/^(?:0|[1-9]\d{0,7})(?:[,.]\d{1,2})?$/.test(raw))throw Error('Betrag bitte wie 119,00 eingeben.');const [whole,part='']=raw.replace(',','.').split('.');return Number(whole)*100+Number(part.padEnd(2,'0'));}
async function loadComments(details,append=false){
  const data=await api('/comments?kind='+details.dataset.kind+'&targetId='+encodeURIComponent(details.dataset.comments)+(append&&details.dataset.cursor?'&cursor='+details.dataset.cursor:''));
  const html=data.items.map(c=>`<div class="advisor-comment"><small>${esc(c.company||'Betreiber')} · ${esc(c.email||'')} · ${esc(date(c.created_at))}</small><p class="advisor-data">${esc(c.body)}</p></div>`).join('');
  const list=details.querySelector('[data-comment-list]');if(append)list.insertAdjacentHTML('beforeend',html);else list.innerHTML=html||'<p>Noch keine Kommentare.</p>';
  details.dataset.cursor=data.nextCursor||'';const button=details.querySelector('[data-action=comments]');button.textContent=data.nextCursor?'Ältere Kommentare laden':'Kommentare aktualisieren';
}
root.addEventListener('submit',event=>{
  const form=event.target.closest('form[data-form]');if(!form)return;event.preventDefault();
  const fields=Object.fromEntries(new FormData(form)),button=form.querySelector('[type=submit]');
  run(button,async()=>{
    switch(form.dataset.form){
      case 'login':await api(setupToken?'/enroll':'/login',{...fields,...(setupToken?{token:setupToken}:{})});setupToken=null;await ready();break;
      case 'account':{const data=await api('/accounts',{action:'create',...fields});await load();activation(data);notify('Zugang angelegt. Einrichtungslink bitte selbst vertraulich weitergeben.');break;}
      case 'proposal':await api('/proposals',{...fields,kind:form.dataset.kind,targetId:form.dataset.target,version:Number(form.dataset.version),...(form.dataset.kind==='document'?{amountMinor:amount(fields.amount)}:{})});notify('Vorschlag gespeichert. Die bestehende Zuordnung bleibt bis zur Betreiberprüfung unverändert.');form.closest('details').open=false;break;
      case 'comment':await api('/comments',{...fields,kind:form.dataset.kind,targetId:form.dataset.target});form.reset();await loadComments(form.closest('details'));notify('Kommentar gespeichert.');break;
      case 'export':{
        const response=await fetch('/api/advisor/export?'+new URLSearchParams({kind:tab,...fields}),{credentials:'same-origin'});
        if(!response.ok){const data=await response.json();throw Error(data.error||'Export fehlgeschlagen.');}
        const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=`white-gloss-${tab}-${fields.from}-${fields.to}.${fields.format}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);notify(fields.format.toUpperCase()+' erstellt.');break;
      }
    }
  });
});
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.tab)run(button,async()=>{tab=button.dataset.tab;shell();await load();notify(tabs[tab]+' geladen.');});
  if(button.dataset.accountAction)run(button,async()=>{
    if(!window.confirm(button.dataset.accountAction==='revoke'?'Diesen Zugang und alle laufenden Sitzungen jetzt sperren?':'Neuen Einrichtungslink erzeugen? Das bisherige Passwort, frühere Links und alle Sitzungen werden ungültig.'))return;
    const data=await api('/accounts',{action:button.dataset.accountAction,id:button.dataset.id});await load();if(data.activationUrl)activation(data);notify(data.activationUrl?'Neuer Einrichtungslink erstellt.':'Zugang gesperrt.');
  });
  if(button.dataset.decision)run(button,async()=>{await api('/decision',{id:button.dataset.id,decision:button.dataset.decision});await load();notify(button.dataset.decision==='accepted'?'Vorschlag als Zuordnungsentwurf übernommen. Keine Buchung oder Zahlung ausgelöst.':'Vorschlag abgelehnt.');});
  if(button.dataset.action)run(button,async()=>{
    switch(button.dataset.action){
      case 'logout':await api('/logout',{});session=null;login();notify('Abgemeldet.');break;
      case 'copy':await navigator.clipboard.writeText(document.querySelector('.activation-link').value);notify('Einrichtungslink kopiert.');break;
      case 'refresh':await load();notify('Ansicht aktualisiert.');break;
      case 'more':await load(true);notify('Weitere Einträge geladen.');break;
      case 'comments':{const details=button.closest('details');await loadComments(details,Boolean(details.dataset.cursor));break;}
      case 'receipt-options':{
        const data=await api('/documents?cursor='+encodeURIComponent(receiptCursor));receiptOptions.push(...data.items);receiptCursor=data.nextCursor;
        root.querySelectorAll('select[name=documentId]').forEach(select=>{for(const item of data.items){if([...select.options].some(o=>o.value===item.id))continue;const option=document.createElement('option');option.value=item.id;option.textContent=item.filename;select.append(option);}});
        if(!receiptCursor)root.querySelectorAll('[data-action=receipt-options]').forEach(el=>el.remove());notify('Weitere Belege stehen zur Auswahl.');break;
      }
    }
  });
});
if(setupToken){login();notify('Einrichtungslink geladen.');}else ready().catch(error=>{login();notify(error.status===401?'Bitte persönlich anmelden.':error.message,error.status!==401);});
