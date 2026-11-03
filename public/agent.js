// Owner-only read-only Hermes bridge; no browser persistence or credentials.
export async function mountAgent(root,{synthetic=false,fetchImpl=globalThis.fetch}={}){
  if(!root||root.dataset.agentReady)return;
  root.dataset.agentReady='true';
  root.innerHTML=`<section class="card formsection agent-settings"><h2>Hermes · Betreiber-Chat</h2><p>Nur lesend (read-only). Keine Kundennachrichten, Rechnungen oder Zahlungen werden ausgelöst.</p><p>Deine Nachricht und begrenzte aktuelle Auftragszusammenfassungen (Kundenname, Fahrzeug, Paket, Status, Begutachtungsentwurf mit Prüfstatus, angenommener Angebotsbetrag soweit vorhanden und Termin) werden an die verbundene Hermes-Instanz übertragen. Diese Daten können dort durch den konfigurierten Modellanbieter verarbeitet werden. Mit jeder bestätigten Nachricht wird dieser tatsächliche aktuelle CRM-Snapshot übertragen. Bestätige jede Anfrage einzeln. Keine dauerhafte Speicherung im Browser.</p><p data-agent-status role="status">Verbindung wird geprüft …</p><form><label>Deine Nachricht<textarea name="message" rows="4" maxlength="4000" required disabled autocomplete="off"></textarea></label><label class="check"><input type="checkbox" name="confirmed" required disabled>Ich bestätige die Übertragung dieser einzelnen Nachricht an die verbundene Hermes-Instanz.</label><button type="submit" class="primary" disabled>Nachricht an Hermes senden</button></form><div data-agent-history aria-label="Letzte Hermes-Anfragen"></div><div data-agent-output class="assistant-text-preview" aria-live="polite"></div></section>`;
  const form=root.querySelector('form'),input=form.elements.message,consent=form.elements.confirmed,button=form.querySelector('button'),status=root.querySelector('[data-agent-status]');
  let available=false,busy=false,pending=null;
  input.addEventListener('input',()=>{consent.checked=false;});
  form.addEventListener('submit',async event=>{
    event.preventDefault();event.stopPropagation();
    if(!available||busy||!consent.checked||!input.value.trim()||input.value.length>4000)return;
    const message=input.value;
    if(!pending||pending.message!==message)pending={requestId:globalThis.crypto.randomUUID(),message,confirmed:true};
    busy=true;input.disabled=consent.disabled=button.disabled=true;
    consent.checked=false;status.classList.remove('error');
    status.textContent='Anfrage läuft …';
    root.querySelector('[data-agent-output]').textContent='';
    try{
      const response=await fetchImpl('/api/agent/chat',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending)});
      const result=await response.json();
      if(response.status===409&&typeof result.existingRequestId==='string'){pending={...pending,requestId:result.existingRequestId};throw Error((result.error||'Anfrage bereits vorhanden.')+' Anfrage-ID: '+result.existingRequestId);}
      if(!response.ok||result.ok!==true)throw Error(result.error||'Hermes-Anfrage fehlgeschlagen.');
      if(typeof result.reply!=='string')throw Error('Hermes-Antwort konnte nicht gelesen werden.');
      root.querySelector('[data-agent-output]').textContent=result.reply;
      status.textContent=result.incomplete?'Antwort unvollständig · bitte als Teilergebnis prüfen.':'Antwort erhalten · bitte inhaltlich prüfen.';
      input.value='';pending=null;button.textContent='Nachricht an Hermes senden';
    }catch(error){
      status.textContent=(error.message||'Hermes-Anfrage fehlgeschlagen.')+' Der Ausgang kann unklar sein. Keine automatische Wiederholung. Erneutes Senden derselben Nachricht nutzt dieselbe Anfrage-ID; bitte erneut bestätigen.';
      status.classList.add('error');button.textContent='Nachricht ausdrücklich erneut senden';
    }finally{
      busy=false;input.disabled=consent.disabled=button.disabled=!available;await loadHistory();
    }
  });
  try{
    const response=await fetchImpl('/api/agent',{credentials:'same-origin',cache:'no-store'});
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'Hermes-Verbindung konnte nicht geprüft werden.');
    available=!synthetic&&result.configured===true&&result.enabled===true&&result.bridgeConfigured===true&&result.mode==='read-only';
    status.textContent=synthetic?'Im Testbereich ist die Übertragung deaktiviert.':!result.configured?'Hermes ist nicht konfiguriert.':!result.enabled?'Hermes ist deaktiviert.':!available?'Die lesende Hermes-Bridge ist nicht verfügbar.':'Hermes ist für lesende Anfragen bereit.';
  }catch(error){status.textContent=error.message;status.classList.add('error');}
  async function loadHistory(){
    if(synthetic)return;
    const history=root.querySelector('[data-agent-history]');
    try{
      const response=await fetchImpl('/api/agent/requests',{credentials:'same-origin',cache:'no-store'}),result=await response.json();
      if(!response.ok||!Array.isArray(result.requests))throw Error('Anfrageverlauf nicht verfügbar.');
      history.replaceChildren();
      for(const row of result.requests){
        const item=root.ownerDocument.createElement('p');
        item.textContent=row.requestId+' · '+(row.state==='pending'?'läuft':row.state==='unknown'?'ungeklärt · nicht erneut senden':row.answerExpired?'Antwort abgelaufen':'Antwort gespeichert');
        if(row.state==='completed'&&!row.answerExpired){
          const recover=root.ownerDocument.createElement('button');recover.type='button';recover.dataset.agentRecover=row.requestId;recover.textContent='Gespeicherte Antwort anzeigen';
          recover.addEventListener('click',async()=>{
            recover.disabled=true;
            try{
              const response=await fetchImpl('/api/agent/requests/'+encodeURIComponent(row.requestId),{credentials:'same-origin',cache:'no-store'}),answer=await response.json();
              if(!response.ok||answer.ok!==true||typeof answer.reply!=='string')throw Error(answer.error||'Antwort nicht verfügbar.');
              root.querySelector('[data-agent-output]').textContent=answer.reply;status.textContent='Gespeicherte Antwort · keine neue Übertragung.';status.classList.remove('error');
            }catch(error){status.textContent=error.message;status.classList.add('error');}finally{recover.disabled=false;}
          });item.append(recover);
        }
        history.append(item);
      }
    }catch{if(!history.childElementCount)history.textContent='Anfrageverlauf nicht verfügbar. Keine automatische Wiederholung.';}
  }
  input.disabled=consent.disabled=button.disabled=!available;
  await loadHistory();
}
