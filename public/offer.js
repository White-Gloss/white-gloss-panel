import {offerLinesHTML} from './pricing.js';
import {appointmentHTML,offerSnapshotHash,createOfferAppointmentSelection,offerAcceptancePresentation,offerNeedsAppointmentOptions} from './appointment-options.js';

export const isOffer=location.pathname.startsWith('/angebot/');
const escaped=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

function confirmationMessage(delivery){
  if(delivery?.state==='test')return 'Dies ist ein Testangebot. Es wird keine E-Mail versendet.';
  if(delivery?.state==='unknown')return 'Ihr Termin ist gespeichert. Der E-Mail-Versand ist noch nicht bestätigt; White Gloss prüft den Versandstatus.';
  if(delivery?.state==='failed')return 'Ihr Termin ist gespeichert. Die E-Mail-Bestätigung steht noch aus; White Gloss kann den Versandstatus prüfen.';
  if(delivery?.state==='cancelled')return 'Der Auftrag wurde zwischenzeitlich storniert. Bitte wenden Sie sich an White Gloss, um den aktuellen Terminstatus zu klären.';
  return 'Ihre Terminbestätigung wird per E-Mail versendet. Bitte prüfen Sie auch Ihren Spam-Ordner.';
}

export async function showOffer(){
  const root=document.querySelector('#app');
  const token=location.pathname.split('/').pop();
  const response=await fetch('/api/offer/'+encodeURIComponent(token));
  const offer=await response.json();
  if(!response.ok){
    root.innerHTML='<main class="appoff card"><span class="brandmark">WG</span><h1>Ihr persönliches Angebot</h1><p>'+escaped(offer.error)+'</p></main>';
    return;
  }
  const amount=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(offer.offer.totalCents/100);
  const options=offer.appointmentOptions??[];
  const combined=options.length>0;
  const awaitingOptions=offerNeedsAppointmentOptions(offer);
  const open=offer.status==='Angebot offen'&&!offer.ownerPreview&&!awaitingOptions;
  const expiry=new Intl.DateTimeFormat('de-DE',{dateStyle:'long',timeStyle:'short',timeZone:'Europe/Berlin'}).format(new Date(offer.offer.expiresAt));
  const choice=combined?`<fieldset class="offer-appointment-choices"><legend>${open?'Bitte wählen Sie Ihren Termin':'Angebotene Termine'}</legend><p class="hint">Die Vorschläge sind noch nicht reserviert. Der ausgewählte Termin wird mit Ihrer persönlichen Annahme verbindlich, sofern er weiterhin verfügbar ist.</p>${options.map(option=>open?`<label class="offer-appointment-option"><input type="radio" name="appointmentOptionId" value="${escaped(option.id)}" required><span>${appointmentHTML(option)}</span></label>`:`<div class="appointment-stored">${appointmentHTML(option)}</div>`).join('')}</fieldset>`:'';
  const appointment=offer.appointment?'<div class="sectiontitle">'+(offer.status==='Storniert'?'Bisheriger Termin · Auftrag storniert':'Vereinbarter Termin')+'</div><div class="appointment-stored">'+appointmentHTML(offer.appointment)+'</div>':'';
  const legacy=combined||offer.appointment||awaitingOptions?'':'<p class="hint">Dieses frühere Angebot enthält noch keine Terminauswahl. Ihr Wunschtermin ist nicht verbindlich; White Gloss vereinbart den Termin nach Ihrer Annahme persönlich mit Ihnen.</p>';
  const form=open?`<form id="customerOfferForm">${choice}<div id="offerSelectedAppointment" class="offer-selected-appointment" aria-live="polite" hidden></div><h2 class="sectiontitle">Ihre persönliche Unterschrift</h2>${combined?'<p class="hint">Bitte zuerst einen Termin auswählen und anschließend unterschreiben. Wenn Sie die Auswahl ändern, unterschreiben Sie für den neuen Termin erneut.</p>':''}<canvas id="offerSignature" class="signature" aria-label="Ihre persönliche Unterschrift"></canvas><button type="button" id="clearOffer">Unterschrift löschen</button><label class="check sectiongap"><input type="checkbox" id="offerObligation" required>${combined?'Ich habe den ausgewählten Termin, die angezeigten Leistungen und den Gesamtfestpreis geprüft und nehme Termin und Angebot gemeinsam zahlungspflichtig an.':'Ich habe die angezeigten Leistungen und den Gesamtfestpreis geprüft und nehme das Angebot zahlungspflichtig an.'}</label><div class="error" id="offerError" role="alert"></div><button class="primary" type="submit">Zahlungspflichtig für ${amount} annehmen</button></form>`:offer.ownerPreview?choice+'<p class="hint">Betreibervorschau · Nur der Kunde kann dieses Angebot persönlich annehmen. Hier ist keine Unterschrift erforderlich.</p>':'<p>Dieses Angebot ist nicht mehr zur Annahme geöffnet. Status: '+escaped(offer.status)+'</p>';
  const awaitingMessage=awaitingOptions&&offer.status==='Angebot offen'?'<p class="offer-waiting">White Gloss hinterlegt noch Terminvorschläge. Bitte öffnen Sie das Angebot später erneut, um Termin und Angebot gemeinsam anzunehmen.</p>':'';
  root.innerHTML=`<main class="appoff card"><div class="brand"><span class="brandmark">WG</span><div><strong>White Gloss</strong><small>DETAILING · HORB AM NECKAR</small></div></div><h1>Ihr persönliches Angebot</h1><p>${escaped(offer.customer)} · ${escaped(offer.wg)}</p><div class="protocolreview"><p><strong>Fahrzeug</strong><br>${escaped(offer.vehicle)}</p><p><strong>Vereinbarte Leistungen</strong><br>${escaped(offer.offer.services)}</p>${offer.offer.condition?'<p><strong>Begutachtung / Fahrzeugzustand</strong><br><span class="appointment-location">'+escaped(offer.offer.condition)+'</span></p>':''}${offerLinesHTML(offer.offer)}<p><strong>Gesamtfestpreis inklusive Umsatzsteuer</strong><br>${amount}</p></div>${appointment}${legacy}<p class="hint">Dieses Angebot gilt bis ${escaped(expiry)} Uhr.</p>${awaitingMessage}${awaitingMessage?'':form}</main>`;
  if(!open)return;
  const canvas=document.querySelector('#offerSignature');
  const ctx=canvas.getContext('2d');
  canvas.width=900;canvas.height=300;
  let started=false,drawn=false,submitting=false;
  const clear=()=>{
    ctx.fillStyle='#fff';ctx.fillRect(0,0,900,300);
    ctx.strokeStyle='#263a4d';ctx.lineWidth=3;
    started=false;drawn=false;
  };
  const obligation=document.querySelector('#offerObligation');
  const error=document.querySelector('#offerError');
  const selection=createOfferAppointmentSelection(options,{clearSignature:clear,obligation,onSelect:option=>{
    const selected=document.querySelector('#offerSelectedAppointment');
    selected.innerHTML='<div class="sectiontitle">Sie bestätigen diesen Termin</div>'+appointmentHTML(option);
    selected.hidden=false;
    error.textContent='';
  }});
  clear();
  const point=event=>{
    const box=canvas.getBoundingClientRect();
    return [(event.clientX-box.left)*900/box.width,(event.clientY-box.top)*300/box.height];
  };
  canvas.onpointerdown=event=>{
    if(submitting)return;
    if(combined&&!selection.selected()){error.textContent='Bitte zuerst Ihren Termin auswählen.';return;}
    started=true;canvas.setPointerCapture(event.pointerId);
    ctx.beginPath();ctx.moveTo(...point(event));
  };
  canvas.onpointermove=event=>{if(started&&!submitting){ctx.lineTo(...point(event));ctx.stroke();drawn=true;}};
  canvas.onpointerup=()=>started=false;
  canvas.onpointercancel=()=>started=false;
  document.querySelector('#clearOffer').onclick=()=>{if(!submitting)clear();};
  const customerForm=document.querySelector('#customerOfferForm');
  customerForm.addEventListener('change',event=>{
    if(event.target.name==='appointmentOptionId'&&!submitting)selection.choose(event.target.value);
  });
  customerForm.onsubmit=async event=>{
    event.preventDefault();
    if(submitting)return;
    const controls=[...customerForm.querySelectorAll('input,button')];
    try{
      if(combined&&!selection.selected())throw Error('Bitte einen der angebotenen Termine auswählen.');
      if(!drawn)throw Error('Bitte persönlich für dieses Angebot'+(combined?' und den ausgewählten Termin':'')+' unterschreiben.');
      if(!obligation.checked)throw Error('Bitte die zahlungspflichtige Annahme bestätigen.');
      const selectedAppointment=selection.selected();
      const signature=canvas.toDataURL('image/png');
      const paymentObligation=obligation.checked;
      submitting=true;
      for(const control of controls)control.disabled=true;
      error.textContent='Ihre Annahme wird gespeichert …';
      const snapshotHash=await offerSnapshotHash(offer,selectedAppointment?.id);
      const sent=await fetch('/api/offer/'+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({snapshotHash,signature,paymentObligation,...(combined?{appointmentOptionId:selectedAppointment.id}:{})})});
      const result=await sent.json();
      if(!sent.ok)throw Error(result.error??'Ihre Annahme konnte noch nicht bestätigt werden.');
      const presentation=offerAcceptancePresentation(result,selectedAppointment);
      root.innerHTML=`<main class="appoff card"><span class="brandmark">WG</span><h1>${escaped(presentation.heading)}</h1><p>${escaped(presentation.body)}</p>${presentation.appointment?'<div class="appointment-stored">'+appointmentHTML(presentation.appointment)+'</div><p>'+escaped(confirmationMessage(result.confirmationDelivery))+'</p>':''}</main>`;
    }catch(reason){
      error.textContent=reason.message;
      submitting=false;
      for(const control of controls)control.disabled=false;
    }
  };
}
