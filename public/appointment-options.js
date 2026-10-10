const drafts=new Map();
const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const localDate=value=>value?new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)).replace(' ','T'):'';
const day=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',weekday:'long',day:'numeric',month:'long',year:'numeric'});
const time=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit'});

export async function offerSnapshotHash(offer,appointmentOptionId){
  const options=offer.appointmentOptions??[];
  if(offerNeedsAppointmentOptions(offer))throw Error('White Gloss hinterlegt noch Terminvorschläge. Bitte öffnen Sie das Angebot später erneut.');
  if(options.length&&!options.some(option=>option.id===appointmentOptionId))throw Error('Bitte einen der angebotenen Termine auswählen.');
  const snapshot=options.length?{...offer,selectedAppointmentOptionId:appointmentOptionId}:offer;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(snapshot)));
  return Array.from(new Uint8Array(digest)).map(value=>value.toString(16).padStart(2,'0')).join('');
}

export function offerNeedsAppointmentOptions(offer){
  return offer.offer?.requiresAppointmentSelection===true&&!(offer.appointmentOptions?.length);
}

export function appointmentOptionsDeliveryIssue(order){
  const pickupCents=order.offer?.pickupCents??order.assessment?.pickupCents??0;
  return pickupCents>0&&order.appointmentOptions?.some(option=>option.delivery==='Kunde bringt')?'Der Preis enthält kostenpflichtige Abholung. Bitte die Terminvorschläge auf „Abholung“ setzen oder Leistungen und Preis für „Kunde bringt“ neu prüfen.':'';
}

export function createOfferAppointmentSelection(options,{clearSignature,obligation,onSelect=()=>{}}){
  let selected=null;
  return {
    choose(id){
      const option=options.find(item=>item.id===id);
      if(!option)throw Error('Bitte einen der angebotenen Termine auswählen.');
      if(selected?.id===id)return;
      selected=option;
      clearSignature();
      obligation.checked=false;
      onSelect(option);
    },
    selected:()=>selected
  };
}

export function offerAcceptancePresentation(result,fallbackAppointment=null){
  if(result.status==='Storniert'||result.confirmationDelivery?.state==='cancelled')return {heading:'Der Auftrag wurde storniert',body:'Ihre frühere Annahme bleibt dokumentiert. Der Auftrag ist inzwischen storniert; bitte klären Sie weitere Schritte mit White Gloss.',appointment:null};
  const appointment=result.appointment??fallbackAppointment;
  return appointment?{heading:'Termin und Angebot sind angenommen',body:'Vielen Dank. Ihre persönliche Annahme wurde gespeichert.',appointment}:{heading:'Ihre Annahme ist gespeichert',body:'Vielen Dank. White Gloss wird jetzt Ihren verbindlichen Termin mit Ihnen vereinbaren.',appointment:null};
}

export function appointmentHTML(appointment){
  const start=new Date(appointment.start),end=new Date(appointment.end);
  const endLabel=day.format(start)===day.format(end)?time.format(end):day.format(end)+' · '+time.format(end);
  return `<strong>${escape(day.format(start))}</strong><span class="appointment-time">${escape(time.format(start))} – ${escape(endLabel)} Uhr · ${escape(appointment.duration)} Minuten</span><span>${escape(appointment.delivery)}</span><span class="appointment-location">${escape(appointment.location)}</span>`;
}

export function clearAppointmentOptionsDraft(orderId){drafts.delete(orderId);}

function optionRow(option,index){
  return `<fieldset class="appointment-option-row"><legend>Terminvorschlag ${index+1}</legend><div class="grid2"><label>Datum und Uhrzeit · Europe/Berlin<input data-appointment-field="start" type="datetime-local" value="${escape(option.start)}" required></label><label>Dauer in Minuten<input data-appointment-field="duration" type="number" min="15" max="570" step="1" value="${escape(option.duration)}" required></label></div><div class="grid2"><label>Übergabeart<select data-appointment-field="delivery" required><option value="" ${!option.delivery?'selected':''}>Bitte prüfen und auswählen</option><option ${option.delivery==='Kunde bringt'?'selected':''}>Kunde bringt</option><option ${option.delivery==='Abholung'?'selected':''}>Abholung</option></select></label><label>Ort / Adresse<input data-appointment-field="location" type="text" maxlength="600" value="${escape(option.location)}" required></label></div><button type="button" class="smallbtn danger" data-appointment-remove aria-label="Terminvorschlag ${index+1} entfernen">Vorschlag entfernen</button></fieldset>`;
}

export function appointmentOptionsInitialValues(order,company={}){
  const saved=order.appointmentOptions??[];
  const draft=drafts.get(order.id);
  const source=order.source??{},raw=source.raw??source;
  const declared=[source.delivery,source.catalogQuote?.delivery,raw.delivery,raw.catalogQuote?.delivery];
  const pickup=declared.includes('Abholung')||raw.pickup_requested===true||source.pickupCents>0||[...(order.assessment?.lines??[]),...(order.offer?.lines??[])].some(line=>line.kind==='pickup');
  const bringing=declared.includes('Kunde bringt')||raw.pickup_requested===false;
  const delivery=pickup&&!bringing?'Abholung':bringing&&!pickup?'Kunde bringt':'';
  const location=delivery==='Abholung'?source.address??'':delivery==='Kunde bringt'?[company.street,company.city].filter(Boolean).join(', '):'';
  const options=draft?.options??(saved.length?saved.map(option=>({...option,start:localDate(option.start)})):[{start:'',duration:120,delivery,location}]);
  return {options:structuredClone(options),dirty:draft?.dirty===true};
}

export function appointmentOptionsFormHTML(order,company={}){
  const saved=order.appointmentOptions??[];
  const {options,dirty}=appointmentOptionsInitialValues(order,company);
  const pickupCents=order.offer?.pickupCents??order.assessment?.pickupCents??0;
  return `<section class="appointment-options-section"><div class="sectiontitle">Terminvorschläge zum Angebot</div><p class="hint">Du schlägst bis zu drei Termine vor. Der Kunde wählt einen Termin und unterschreibt Leistungen, Preis und Termin gemeinsam. Vorschläge sind noch nicht reserviert. Bitte Übergabeart und Ort anhand der Anfrage und deiner vereinbarten Leistungen prüfen.</p>${pickupCents>0?'<p class="hint">Der Preis enthält kostenpflichtige Abholung. Verwende dafür die Übergabeart „Abholung“. Wenn der Kunde selbst bringen möchte, müssen Leistungen und Preis neu geprüft werden.</p>':''}<form id="appointmentOptionsForm" data-order-id="${escape(order.id)}" data-pickup-cents="${escape(pickupCents)}" data-dirty="${dirty}"><div data-appointment-rows>${options.map(optionRow).join('')}</div><div class="actions"><button type="button" data-appointment-add>Weiteren Termin hinzufügen</button><button type="submit" class="primary">Terminvorschläge speichern</button></div><p class="hint" data-appointment-status aria-live="polite">${dirty?'Ungespeicherte Änderungen: Terminvorschläge vor dem Angebotsversand speichern.':saved.length?saved.length+' Terminvorschlag'+(saved.length===1?'':'e')+' gespeichert.':'Vor dem Angebotsversand mindestens einen Terminvorschlag speichern.'}</p><div class="error" id="appointment-options-error" role="alert"></div></form></section>`;
}

function values(form){
  return [...form.querySelectorAll('.appointment-option-row')].map(row=>Object.fromEntries([...row.querySelectorAll('[data-appointment-field]')].map(field=>[field.dataset.appointmentField,field.value])));
}

export function readAppointmentOptions(form){
  const options=values(form).map((option,index)=>{
    const duration=Number(option.duration);
    if(!option.start)throw Error(`Terminvorschlag ${index+1}: Bitte Datum und Uhrzeit angeben.`);
    if(!Number.isInteger(duration)||duration<15||duration>570)throw Error(`Terminvorschlag ${index+1}: Bitte eine Dauer zwischen 15 und 1440 Minuten angeben.`);
    if(!['Abholung','Kunde bringt'].includes(option.delivery))throw Error(`Terminvorschlag ${index+1}: Bitte die Übergabeart prüfen und auswählen.`);
    if(!option.location.trim())throw Error(`Terminvorschlag ${index+1}: Bitte den Übergabeort angeben.`);
    return {...option,start:option.start.trim(),duration,location:option.location.trim()};
  });
  if(options.length<1||options.length>3)throw Error('Bitte einen bis drei Terminvorschläge angeben.');
  const deliveryIssue=appointmentOptionsDeliveryIssue({assessment:{pickupCents:Number(form.dataset.pickupCents??0)},appointmentOptions:options});
  if(deliveryIssue)throw Error(deliveryIssue);
  return options;
}

export function mountAppointmentOptions(form){
  if(!form||form.dataset.mounted==='true')return;
  form.dataset.mounted='true';
  const rows=form.querySelector('[data-appointment-rows]');
  const update=()=>{
    const current=[...rows.children];
    form.querySelector('[data-appointment-add]').disabled=current.length>=3;
    current.forEach((row,index)=>{
      row.querySelector('legend').textContent='Terminvorschlag '+(index+1);
      const remove=row.querySelector('[data-appointment-remove]');
      remove.disabled=current.length<=1;
      remove.setAttribute('aria-label','Terminvorschlag '+(index+1)+' entfernen');
    });
    if(form.dataset.dirty==='true')for(const button of document.querySelectorAll('[data-click="sendOffer"],[data-click="offerLink"]'))button.disabled=true;
  };
  const dirty=()=>{
    form.dataset.dirty='true';
    drafts.set(form.dataset.orderId,{options:values(form),dirty:true});
    form.querySelector('[data-appointment-status]').textContent='Ungespeicherte Änderungen: Terminvorschläge vor dem Angebotsversand speichern.';
    update();
  };
  form.addEventListener('input',dirty);
  form.addEventListener('change',dirty);
  form.addEventListener('click',event=>{
    const add=event.target.closest('[data-appointment-add]');
    const remove=event.target.closest('[data-appointment-remove]');
    if(add&&rows.children.length<3){
      const first=values(form)[0];
      rows.insertAdjacentHTML('beforeend',optionRow({...first,start:''},rows.children.length));
      dirty();
    }
    if(remove&&rows.children.length>1){remove.closest('.appointment-option-row').remove();dirty();}
  });
  update();
}
