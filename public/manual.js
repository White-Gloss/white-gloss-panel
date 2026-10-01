import {packages,vehicleClasses,extras,cities,pickupPricing,extraIncluded,catalogQuote} from './catalog.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=c=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(c/100);
const field=(label,name,type='text',value='',attributes='')=>`<label>${label}<input type="${type}" name="${name}" value="${esc(value)}" ${attributes}></label>`;
export function readManualSelection(form){
  const f=form.elements;
  return {packageId:f.packageId.value,classId:f.classId.value,extraIds:[...form.querySelectorAll('[name=extraIds]:checked:not(:disabled)')].map(e=>e.value),delivery:f.delivery.value,citySlug:f.citySlug.value,pickupKm:f.pickupKm.value,customPickupCents:f.customPickupCents.value};
}
export function manualCreateModal({synthetic,modal}){
  modal(synthetic?'Synthetischen Testauftrag anlegen':'Neue manuelle Anfrage',`<form id="createform">
    <div class="sectiontitle">Kunde & Fahrzeug</div>
    <div class="grid2">${field('Name','name','text',synthetic?'Musterkunde':'','required')}${field('Fahrzeug','vehicle','text',synthetic?'Testfahrzeug':'','required')}${field('Telefon','phone','tel')}${field('E-Mail','email','email')}</div>
    <div class="sectiontitle">Paket & Fahrzeugklasse</div>
    <div class="grid2"><label>Paket<select name="packageId">${packages.map(p=>`<option value="${p.id}">${esc(p.name)} · ab ${money(p.priceCents)}</option>`).join('')}</select></label><label>Fahrzeugklasse<select name="classId">${vehicleClasses.map(c=>`<option value="${c.id}">${esc(c.label)}${c.factorPercent===100?'':` · +${c.factorPercent-100} %`}</option>`).join('')}</select></label></div>
    <div id="manual-package" class="catalog-package"></div>
    <fieldset class="catalog-options"><legend>Zubuchbare Optionen</legend>${extras.map(e=>`<label class="catalog-option"><input type="checkbox" name="extraIds" value="${e.id}" ${e.requestable?'':'disabled'}><span><strong>${esc(e.name)}</strong><small>${esc(e.hint)}${e.inspect?' · Begutachtung erforderlich':''}</small></span><span class="catalog-option-price" data-extra-price="${e.id}"></span></label>`).join('')}</fieldset>
    <div class="sectiontitle">Abholung / Kunde bringt</div>
    <label>Übergabeart<select name="delivery"><option>Kunde bringt</option><option>Abholung</option></select></label>
    <div id="manual-pickup" hidden><div class="grid2"><label>Abholort<select name="citySlug">${cities.map(c=>`<option value="${c.slug}">${esc(c.name)} · ${c.km} km</option>`).join('')}<option value="">Anderer Ort / individuelle Entfernung</option></select></label>${field('Einfache Entfernung ab Horb in km','pickupKm','number',0,'min="0" max="2000" step="0.1"')}</div><p class="hint">Bis 10 km kostenlos · bis 20 km 50,00 € · bis 50 km 70,00 € · darüber auf Anfrage. Keramikschutz: bis 60 km inklusive.</p><div id="manual-custom-pickup" hidden>${field('Individueller Abholpreis in Cent (Brutto)','customPickupCents','number','','min="0" step="1"')}<p class="hint">Außerhalb der Staffel ist vor dem Speichern ein eigener Abholpreis erforderlich. 100 Cent = 1,00 €.</p></div></div>
    <div class="grid2">${field('Ort / individueller Abholort','city')}${field('Adresse','address')}${field('Wunschdatum','desiredDate','date')}${field('Zeitfenster','timeWindow')}</div>
    <div id="manual-quote" class="catalog-total" role="status" aria-live="polite"></div>
    <p class="hint">Bruttopreise inklusive 19 % MwSt. Die Berechnung ist der Anfragebetrag. Deinen verbindlichen Fixpreis legst du nach der Begutachtung fest. Ein Wunschtermin bleibt unverbindlich.</p>
    <label>Hinweis / zusätzliche Wünsche<textarea name="note"></textarea></label><label class="check"><input type="checkbox" name="reviewConsent">Kundeneinwilligung zur Bewertungsmail liegt vor.</label>
    ${synthetic?'<p class="hint">Testauftrag mit eigener TEST-Nummer. Kein Versand und keine Rechnungen.</p>':''}
    <div class="error" id="modal-error"></div><button class="primary" type="submit">${synthetic?'Testauftrag':'Anfrage'} speichern</button></form>`);
  const form=document.getElementById('createform');
  form.addEventListener('change',()=>updateManualQuote(form));
  form.addEventListener('input',event=>{if(['pickupKm','customPickupCents'].includes(event.target.name))updateManualQuote(form);});
  updateManualQuote(form);
}
function updateManualQuote(form){
  const f=form.elements,pack=packages.find(p=>p.id===f.packageId.value),klass=vehicleClasses.find(c=>c.id===f.classId.value);
  const bringing=f.delivery.value==='Kunde bringt',city=cities.find(c=>c.slug===f.citySlug.value);
  form.querySelector('#manual-pickup').hidden=bringing;
  f.citySlug.disabled=bringing;f.pickupKm.disabled=bringing||!!city;
  if(city)f.pickupKm.value=String(city.km);
  f.city.readOnly=!bringing&&!!city;
  if(!bringing&&city)f.city.value=city.name;
  else if(f.city.dataset.knownCity===f.city.value)f.city.value='';
  f.city.dataset.knownCity=!bringing&&city?city.name:'';
  f.address.required=!bringing;
  f.pickupKm.required=!bringing&&!city;
  for(const e of extras){
    const checkbox=form.querySelector(`[name=extraIds][value="${e.id}"]`),included=extraIncluded(pack.id,e.id);
    if(included)checkbox.checked=true;
    else if(checkbox.dataset.included==='true')checkbox.checked=false;
    checkbox.dataset.included=String(included);
    checkbox.disabled=!e.requestable||included;
    form.querySelector(`[data-extra-price="${e.id}"]`).textContent=!e.requestable?'Derzeit nicht buchbar':included?'Im Paket enthalten':'ab '+money(Math.round(e.priceCents*klass.factorPercent/100));
  }
  form.querySelector('#manual-package').innerHTML=`<strong>${esc(pack.name)} · ${money(Math.round(pack.priceCents*klass.factorPercent/100))}</strong><small>${esc(klass.hint)} · ${esc(pack.duration)}</small><ul>${pack.items.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>`;
  const distance=city?city.km:Number(f.pickupKm.value);
  const onRequest=!bringing&&Number.isFinite(distance)&&distance>pickupPricing.maxKm&&!(pack.id==='keramik'&&distance<=pickupPricing.freeUpToKm);
  form.querySelector('#manual-custom-pickup').hidden=!onRequest;
  f.customPickupCents.disabled=!onRequest;f.customPickupCents.required=onRequest;
  const output=form.querySelector('#manual-quote');
  try{
    const quote=catalogQuote(readManualSelection(form));
    output.innerHTML=`<div><span>Paket</span><strong>${money(quote.packageCents)}</strong></div><div><span>Zusatzoptionen</span><strong>${money(quote.extrasCents)}</strong></div><div><span>${bringing?'Kunde bringt':quote.pickupIncluded?'Abholung im Paket enthalten':'Abholung'}</span><strong>${quote.pickupCents===null?'Preis auf Anfrage':money(quote.pickupCents)}</strong></div><div class="catalog-grand-total"><span>Anfragebetrag</span><strong>${quote.totalCents===null?'Abholpreis noch offen':money(quote.totalCents)}</strong></div>`;
  }catch(error){output.textContent=error.message;}
}
