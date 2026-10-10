import {protocolHTML} from './protocol-view.js';

export const isHandover=location.pathname.startsWith('/protokoll/');
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const brand='<div class="brand"><span class="brandmark">WG</span><div><strong>White Gloss</strong><small>DETAILING · HORB AM NECKAR</small></div></div>';

async function readResponse(response){
  const data=await response.json().catch(()=>({error:'Die Antwort konnte nicht gelesen werden. Bitte erneut versuchen.'}));
  if(!response.ok){const error=Error(data.error??'Das Protokoll konnte nicht geladen werden.');error.status=response.status;throw error;}
  return data;
}

function signatureCanvas(canvas){
  const context=canvas.getContext('2d');
  canvas.width=900;canvas.height=300;
  let activePointer=null,drawn=false;
  const clear=()=>{
    activePointer=null;drawn=false;
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
    context.strokeStyle='#263a4d';context.lineWidth=3;context.lineCap='round';context.lineJoin='round';
  };
  const point=event=>{
    const rect=canvas.getBoundingClientRect();
    return [(event.clientX-rect.left)*canvas.width/rect.width,(event.clientY-rect.top)*canvas.height/rect.height];
  };
  canvas.onpointerdown=event=>{
    if(activePointer!==null||event.button!==0)return;
    event.preventDefault();activePointer=event.pointerId;canvas.setPointerCapture(event.pointerId);
    context.beginPath();context.moveTo(...point(event));
  };
  canvas.onpointermove=event=>{
    if(activePointer!==event.pointerId)return;
    context.lineTo(...point(event));context.stroke();drawn=true;
  };
  const stop=event=>{if(activePointer===event.pointerId)activePointer=null;};
  canvas.onpointerup=stop;canvas.onpointercancel=stop;canvas.onlostpointercapture=stop;
  clear();
  return {clear,hasSignature:()=>drawn};
}

export async function showHandover(){
  const root=document.querySelector('#app');
  const token=location.pathname.split('/').filter(Boolean).pop();
  const endpoint='/api/handover/'+encodeURIComponent(token);
  root.innerHTML=`<main class="appoff card handover-page">${brand}<h1>Ihr Fahrzeugübergabeprotokoll</h1><p role="status">Das Protokoll wird geladen …</p></main>`;
  let data;
  try{data=await readResponse(await fetch(endpoint,{credentials:'same-origin'}));}
  catch(error){
    const login='/auth/login?customer=1&returnTo='+encodeURIComponent('/protokoll/'+token);
    root.innerHTML=`<main class="appoff card handover-page">${brand}<h1>Ihr Fahrzeugübergabeprotokoll</h1><p class="error" role="alert">${escapeHTML(error.message)}</p>${error.status===401?`<p><a href="${escapeHTML(login)}">Mit persönlicher Kunden-PIN anmelden</a></p>`:''}<button type="button" id="retryHandover">Erneut laden</button><p><a href="/kundenportal">Mein Kundenpanel öffnen</a></p></main>`;
    document.querySelector('#retryHandover').onclick=()=>showHandover();
    return;
  }
  const isReturn=data.kind==='return',completed=data.status==='completed';
  const acknowledgement=isReturn
    ?'Ich habe das angezeigte Abgabeprotokoll einschließlich Fahrzeugzustand, ausgeführter Leistungen und dokumentierter Schlüsselablage geprüft und bestätige die Fahrzeugabgabe mit meiner persönlichen Unterschrift.'
    :'Ich habe das angezeigte Annahmeprotokoll einschließlich Fahrzeugzustand und Schlüsselanzahl geprüft und bestätige die dokumentierte Fahrzeugannahme mit meiner persönlichen Unterschrift.';
  root.innerHTML=`<main class="appoff card handover-page">${brand}<span class="badge ${completed?'good':'warn'}">${data.status==='cancelled'?'Storniertes Original · nur Ansicht':completed?'Abgeschlossen · beide Unterschriften gespeichert':'Wartet auf Ihre Unterschrift'}</span>${data.cancellation?'<p class="error">Storniert: '+escapeHTML(data.cancellation.reason)+' · '+escapeHTML(data.cancellation.at)+'</p>':''}<h1>Ihr Fahrzeugübergabeprotokoll · ${isReturn?'Abgabe':'Annahme'}</h1><p>${escapeHTML(data.wg)} · ${escapeHTML(data.protocol.customerName??data.protocol.customer)}</p>
    <p>${completed?'Dieses Protokoll wurde vom Betrieb und von Ihnen unterschrieben und ist verbindlich abgeschlossen. Sie können es weiterhin hier einsehen.':'White Gloss hat das Protokoll vollständig ausgefüllt und bereits unterschrieben. Prüfen Sie die Angaben und Fotos und unterschreiben Sie anschließend persönlich.'}</p>
    ${data.ownerPreview?'<p class="hint">Betreibervorschau · Die persönliche Kundenunterschrift erfolgt ausschließlich über den Kundenzugang.</p>':'<p><a href="/kundenportal">Mein Kundenpanel öffnen</a></p>'}
    ${protocolHTML({...data.protocol,wg:data.wg},{kind:data.kind,assetUrl:id=>endpoint+'/asset/'+encodeURIComponent(id),operatorSignedAt:data.operatorSignedAt,customerSignedAt:data.customerSignedAt})}
    ${!data.ownerPreview&&!completed&&data.status==='pending'?`<form id="customerHandoverForm" class="sectiongap"><h2 class="sectiontitle">Ihre persönliche Unterschrift</h2><p class="hint">Unterschreiben Sie im Feld mit dem Finger, Stift oder der Maus.</p><canvas id="handoverSignature" class="signature" aria-label="Ihre persönliche Unterschrift"></canvas><button type="button" id="clearHandover">Unterschrift löschen</button><label class="check sectiongap"><input type="checkbox" id="handoverConfirmation" required>${acknowledgement}</label><div class="error" id="handoverError" role="alert"></div><button class="primary" type="submit">Protokoll verbindlich unterschreiben</button><button type="button" id="reloadHandover" hidden>Protokoll erneut prüfen</button></form>`:''}</main>`;
  if(data.ownerPreview||completed||data.status!=='pending')return;
  const canvas=document.querySelector('#handoverSignature'),signature=signatureCanvas(canvas);
  const form=document.querySelector('#customerHandoverForm');
  const clearButton=document.querySelector('#clearHandover'),reloadButton=document.querySelector('#reloadHandover');
  clearButton.onclick=signature.clear;reloadButton.onclick=()=>showHandover();
  let submitting=false;
  form.onsubmit=async event=>{
    event.preventDefault();
    if(submitting)return;
    const submit=form.querySelector('[type=submit]'),errorBox=document.querySelector('#handoverError');
    errorBox.textContent='';reloadButton.hidden=true;
    try{
      if(!signature.hasSignature())throw Error('Bitte unterschreiben Sie persönlich im Unterschriftenfeld.');
      const confirmed=document.querySelector('#handoverConfirmation').checked;
      if(!confirmed)throw Error('Bitte bestätigen Sie, dass Sie dieses Protokoll geprüft haben.');
      submitting=true;submit.disabled=true;clearButton.disabled=true;
      await readResponse(await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({snapshotHash:data.hash,signature:canvas.toDataURL('image/png'),confirmed})}));
      await showHandover();
    }catch(error){
      errorBox.textContent=error.message;reloadButton.hidden=false;
    }finally{
      submitting=false;submit.disabled=false;clearButton.disabled=false;
    }
  };
}
