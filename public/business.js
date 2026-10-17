// Betreiberoberfläche für freigeschaltete Geschäftskunden. Sie verändert keine Rechnungen.
const money=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'});
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const status={OPEN:'Neu',IN_PROGRESS:'In Bearbeitung',DONE:'Erledigt',DECLINED:'Abgelehnt'};
const net=minor=>money.format(minor/100)+' netto';
function parseEuro(value){const raw=String(value??'').trim();if(!/^(?:0|[1-9]\d{0,6})(?:[,.]\d{1,2})?$/.test(raw))throw Error('Bitte einen Nettopreis wie 250,00 eingeben.');const [whole,fraction='']=raw.replace('.',',').split(',');return Number(whole)*100+Number(fraction.padEnd(2,'0'));}
async function api(path,body){const response=await fetch('/api/portal-admin/business/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin'});const data=await response.json().catch(()=>({error:'Antwort nicht lesbar.'}));if(!response.ok)throw Error(data.error??'Verbindung fehlgeschlagen.');return data;}
async function upload(vehicleId,file){const response=await fetch('/api/portal-admin/business/photo?vehicle='+encodeURIComponent(vehicleId),{method:'POST',headers:{'Content-Type':file.type},body:file,credentials:'same-origin'});const data=await response.json().catch(()=>({error:'Foto konnte nicht verarbeitet werden.'}));if(!response.ok)throw Error(data.error??'Foto konnte nicht gespeichert werden.');return data;}

export function mountBusinessAdmin(root,{synthetic=false}={}){
  if(!root)return;
  let accounts=[],selectedId=null,detail=null,editing=null,busy=false;
  const message=(value,error=false)=>{const target=root.querySelector('[data-business-message]');if(target){target.textContent=value;target.classList.toggle('error',error);}};
  const accountCard=account=>`<button type="button" class="business-account ${selectedId===account.id?'selected':''}" data-business-action="select" data-id="${esc(account.id)}" aria-current="${selectedId===account.id?'true':'false'}"><span><strong>${esc(account.company)}</strong><small>${esc(account.name||account.email)}</small></span><span class="badge ${account.active?'good':'warn'}">${account.active?'Portal aktiv':'Nicht freigegeben'}</span></button>`;
  const requestCard=request=>`<li class="business-request"><div><strong>${request.count} ${request.count===1?'Fahrzeug':'Fahrzeuge'}</strong><small>${esc(request.desiredDate||'Termin offen')} · ${esc(request.note||'Ohne Hinweis')}</small></div><label>Status<select data-business-request="${esc(request.id)}">${Object.entries(status).map(([key,label])=>`<option value="${key}" ${request.status===key?'selected':''}>${label}</option>`).join('')}</select></label></li>`;
  const vehicleCard=vehicle=>`<article class="business-vehicle"><div class="business-vehicle-head"><div><strong>${esc(vehicle.title)}</strong><small>${esc([vehicle.plate,vehicle.completedOn].filter(Boolean).join(' · '))}</small></div><span class="badge ${vehicle.published?'good':'warn'}">${vehicle.published?'Für Kunden sichtbar':'Entwurf'}</span></div><p class="business-price">${net(vehicle.netPriceMinor)}</p>${vehicle.note?`<p>${esc(vehicle.note)}</p>`:''}${vehicle.photos.length?`<div class="business-gallery">${vehicle.photos.map(photo=>`<div><a href="${esc(photo.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(photo.url)}" alt="${esc(vehicle.title)}"></a><button type="button" class="smallbtn" data-business-action="photo-visibility" data-id="${esc(photo.id)}" data-visible="${photo.visible?'false':'true'}">${photo.visible?'Foto ausblenden':'Foto einblenden'}</button></div>`).join('')}</div>`:''}<div class="business-card-actions"><label class="business-photo-input">Foto hinzufügen<input type="file" accept="image/jpeg,image/png,image/webp" data-business-upload="${esc(vehicle.id)}"></label><button type="button" class="smallbtn" data-business-action="edit" data-id="${esc(vehicle.id)}">Bearbeiten</button><button type="button" class="smallbtn ${vehicle.published?'':'primary'}" data-business-action="publish" data-id="${esc(vehicle.id)}" data-published="${vehicle.published?'false':'true'}">${vehicle.published?'Ausblenden':'Für Kunden freigeben'}</button></div></article>`;
  function draw(){
    const selected=accounts.find(x=>x.id===selectedId),account=detail?.account;
    root.innerHTML=`<div class="business-admin"><div class="business-toolbar"><div><strong>Geschäftskunden</strong><p>Freischaltung pro Firmenakte. Private Kunden bleiben im bisherigen Portal.</p></div><button type="button" class="smallbtn" data-business-action="reload">Aktualisieren</button></div><p data-business-message role="status" aria-live="polite"></p>${synthetic?'<p class="notice blue">Testbereich: Hier angelegte Fälle sind von echten Kunden getrennt.</p>':''}
    <div class="business-layout"><aside class="business-accounts" aria-label="Geschäftskunden">${accounts.length?accounts.map(accountCard).join(''):'<p>Noch keine Firma mit E-Mail-Adresse im Kundenstamm. Lege sie zuerst unter „Kunden“ an.</p>'}<button type="button" data-view="customers" class="smallbtn">Kundenstamm öffnen</button></aside>
    <div class="business-detail">${!selected?'<section class="card formsection"><h2>Firmenakte auswählen</h2><p>Wähle links einen Geschäftskunden. Fahrzeuganfragen und erledigte Fahrzeuge werden nur diesem Konto zugeordnet.</p></section>':`<section class="card formsection"><div class="business-heading"><div><p class="eyebrow">Geschäftskunde</p><h2>${esc(selected.company)}</h2><p>${esc(selected.name)} · ${esc(selected.email)}</p></div><button type="button" class="${selected.active?'smallbtn danger':'primary'}" data-business-action="access" data-id="${esc(selected.id)}" data-enabled="${selected.active?'false':'true'}">${selected.active?'Portalzugang sperren':'B2B-Portal freischalten'}</button></div><p class="hint">Freigabe gilt für die E-Mail-Adresse in dieser Firmenakte. Fahrzeugkarten erscheinen dem Kunden erst nach deiner Veröffentlichung.</p></section>
    ${account?`<section class="card formsection"><div class="card-title"><h2>Fahrzeuganfragen</h2><span class="badge">${account.requests.filter(x=>x.status==='OPEN').length} neu</span></div>${account.requests.length?`<ul class="business-requests">${account.requests.map(requestCard).join('')}</ul>`:'<p class="hint">Noch keine Fahrzeuganzahl angefragt.</p>'}</section>
    <section class="card formsection"><h2>${editing?'Fahrzeug bearbeiten':'Erledigtes Fahrzeug anlegen'}</h2><p class="hint">Der Nettopreis ist eine Übersicht für den Firmenkunden. Diese Eingabe erstellt keine Rechnung.</p><form id="business-vehicle-form"><div class="grid2"><label>Fahrzeug<input name="title" maxlength="180" required value="${esc(editing?.title??'')}" placeholder="z. B. VW Transporter"></label><label>Kennzeichen<input name="plate" maxlength="40" value="${esc(editing?.plate??'')}"></label><label>Erledigt am<input name="completedOn" type="date" required value="${esc(editing?.completedOn??today())}"></label><label>Nettopreis in €<input name="netPrice" inputmode="decimal" required value="${editing?(editing.netPriceMinor/100).toFixed(2).replace('.',','):''}" placeholder="250,00"></label></div><label>Leistung / Hinweis<textarea name="note" maxlength="1000" rows="2">${esc(editing?.note??'')}</textarea></label><div class="actions"><button type="submit" class="primary">${editing?'Änderung speichern':'Als Entwurf speichern'}</button>${editing?'<button type="button" class="smallbtn" data-business-action="cancel-edit">Abbrechen</button>':''}</div></form></section>
    <section class="card formsection"><div class="card-title"><h2>Erledigte Fahrzeuge</h2><span class="badge">${account.vehicles.length}</span></div>${account.vehicles.length?`<div class="business-vehicles">${account.vehicles.map(vehicleCard).join('')}</div>`:'<p class="hint">Noch kein erledigtes Fahrzeug erfasst.</p>'}</section>`:''}`}</div></div></div>`;
  }
  async function reload(keepMessage=''){
    const result=await api('accounts'+(synthetic?'?test=true':''));accounts=result.accounts;
    if(!accounts.some(x=>x.id===selectedId))selectedId=accounts[0]?.id??null;
    detail=selectedId?await api('account/'+encodeURIComponent(selectedId)):null;draw();if(keepMessage)message(keepMessage);
  }
  root.addEventListener('click',async event=>{
    const button=event.target.closest('[data-business-action]');if(!button||busy)return;event.preventDefault();busy=true;
    try{const action=button.dataset.businessAction,id=button.dataset.id;
      if(action==='select'){selectedId=id;editing=null;detail=await api('account/'+encodeURIComponent(id));draw();}
      if(action==='reload')await reload('Ansicht aktualisiert.');
      if(action==='cancel-edit'){editing=null;draw();}
      if(action==='edit'){editing=detail.account.vehicles.find(x=>x.id===id);draw();root.querySelector('#business-vehicle-form')?.scrollIntoView({block:'start',behavior:'smooth'});}
      if(action==='access'){await api('access',{customerId:id,enabled:button.dataset.enabled==='true'});await reload('B2B-Zugang aktualisiert.');}
      if(action==='publish'){await api('publish',{id,published:button.dataset.published==='true'});await reload('Sichtbarkeit aktualisiert.');}
      if(action==='photo-visibility'){await api('photo/visibility',{id,visible:button.dataset.visible==='true'});await reload('Foto-Sichtbarkeit aktualisiert.');}
    }catch(error){message(error.message,true);}finally{busy=false;}
  });
  root.addEventListener('change',async event=>{
    const select=event.target.closest('[data-business-request]'),file=event.target.closest('[data-business-upload]');if(!select&&!file||busy)return;busy=true;
    try{if(select){await api('request-status',{id:select.dataset.businessRequest,status:select.value});await reload('Anfragestatus gespeichert.');}
      if(file){const files=[...file.files];for(const image of files)await upload(file.dataset.businessUpload,image);await reload(files.length+' Foto gespeichert.');}}
    catch(error){message(error.message,true);if(select)await reload(error.message);}finally{busy=false;}
  });
  root.addEventListener('submit',async event=>{
    if(event.target.id!=='business-vehicle-form')return;event.preventDefault();event.stopPropagation();if(busy)return;busy=true;
    const form=event.target,button=form.querySelector('[type=submit]');button.disabled=true;
    try{const data=new FormData(form),saved=await api('vehicle',{customerId:selectedId,...(editing?{id:editing.id,version:editing.version}:{}),title:data.get('title'),plate:data.get('plate'),completedOn:data.get('completedOn'),netPriceMinor:parseEuro(data.get('netPrice')),note:data.get('note')});editing=null;await reload('Fahrzeug '+(saved.id?'gespeichert.':''));}
    catch(error){message(error.message,true);button.disabled=false;}finally{busy=false;}
  });
  reload().catch(error=>message(error.message,true));
}
