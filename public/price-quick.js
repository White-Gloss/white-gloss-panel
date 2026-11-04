// Schnell-Preisrechner für Telefon und Vor-Ort-Gespräche. Nutzt ausschließlich die geprüfte Katalogrechnung
// (catalogQuote); er legt nichts an, speichert nichts und versendet nichts.
import {packages,extras,vehicleClasses,cities,catalogQuote,extraIncluded,packageMinutes,priceNote,catalogCheckedAt} from './catalog.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const euro=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'});
const money=cents=>euro.format(cents/100);
const hours=minutes=>minutes>=2880?'ca. 2 Tage':minutes>=1440?`ca. ${Math.round(minutes/1440)} Tage`:`ca. ${Math.round(minutes/60)} Std.`;
const options=extras.filter(extra=>extra.requestable);

export function priceQuickHTML(){
  return `<div class="pq" id="price-quick">
    <section class="pq-inputs card" aria-label="Eingaben">
      <div class="pq-field"><span class="pq-label">Fahrzeugklasse</span><div class="pq-choices" role="radiogroup" aria-label="Fahrzeugklasse">${vehicleClasses.map((klass,index)=>`<label class="pq-choice"><input type="radio" name="classId" value="${esc(klass.id)}"${index===0?' checked':''}><span><strong>${esc(klass.label)}</strong><small>${esc(klass.hint)}${klass.factorPercent!==100?' · '+klass.factorPercent+' %':''}</small></span></label>`).join('')}</div></div>
      <div class="pq-field"><span class="pq-label">Paket</span><div class="pq-choices" role="radiogroup" aria-label="Paket">${packages.map((pack,index)=>`<label class="pq-choice"><input type="radio" name="packageId" value="${esc(pack.id)}"${index===0?' checked':''}><span><strong>${esc(pack.name)}</strong><small>${esc(pack.duration??'')} · ab ${money(pack.priceCents)}</small></span></label>`).join('')}</div></div>
      <div class="pq-field"><span class="pq-label">Zusatzleistungen</span><div class="pq-extras">${options.map(extra=>`<label class="pq-extra"><input type="checkbox" name="extra" value="${esc(extra.id)}"><span>${esc(extra.name)}<small data-extra-price="${esc(extra.id)}"></small></span></label>`).join('')}</div></div>
      <div class="pq-field"><span class="pq-label">Abholung</span><div class="pq-row"><label class="pq-switch"><input type="checkbox" name="pickup"> Fahrzeug wird abgeholt</label><label class="pq-km" data-pickup-fields hidden>Ort<select name="citySlug"><option value="">Entfernung in km eingeben</option>${cities.map(city=>`<option value="${esc(city.slug)}">${esc(city.name)} · ${city.km} km</option>`).join('')}</select></label><label class="pq-km" data-pickup-fields hidden>Einfache Strecke (km)<input name="pickupKm" type="number" inputmode="decimal" min="0" max="2000" step="1" placeholder="z. B. 25"></label></div></div>
    </section>
    <section class="pq-result card" aria-live="polite" aria-label="Preis"><div data-quote></div></section>
  </div>`;
}

function selection(root){
  const value=name=>root.querySelector(`[name="${name}"]:checked`)?.value??'';
  const pickup=root.querySelector('[name="pickup"]').checked;
  return {packageId:value('packageId'),classId:value('classId'),extraIds:[...root.querySelectorAll('[name="extra"]:checked')].map(input=>input.value),delivery:pickup?'Abholung':'Kunde bringt',citySlug:pickup?root.querySelector('[name="citySlug"]').value:'',pickupKm:pickup&&!root.querySelector('[name="citySlug"]').value?root.querySelector('[name="pickupKm"]').value:''};
}
export function quoteView(input){
  try{
    const quote=catalogQuote(input);const lines=[[quote.packageName+' · '+quote.className,quote.packageCents],...quote.extras.map(extra=>[extra.name+(extra.inspect?' (nach Prüfung)':''),extra.amountCents])];
    const included=input.extraIds.filter(id=>extraIncluded(quote.packageId,id)).map(id=>extras.find(extra=>extra.id===id)?.name).filter(Boolean);
    if(quote.delivery==='Abholung')lines.push([quote.pickupIncluded?'Abholung (im Paket enthalten)':quote.pickupOnRequest&&quote.pickupCents===null?'Abholung (Preis auf Anfrage)':`Abholung${quote.distanceKm!==null?' · '+quote.distanceKm+' km':''}`,quote.pickupCents]);
    const open=quote.pickupCents===null;
    return {quote,html:`<div class="pq-total"><span>Gesamt</span><strong>${open?money(quote.packageCents+quote.extrasCents)+' <small>+ Abholung auf Anfrage</small>':money(quote.totalCents)}</strong></div>
      <dl class="pq-lines">${lines.map(([label,cents])=>`<div><dt>${esc(label)}</dt><dd>${cents===null?'auf Anfrage':cents===0?'inklusive':money(cents)}</dd></div>`).join('')}</dl>
      ${included.length?`<p class="pq-note">Im Paket enthalten: ${esc(included.join(', '))}</p>`:''}
      <p class="pq-meta">Dauer ${esc(hours(packageMinutes[quote.packageId]??0))} · Preise inkl. MwSt. · Katalogstand ${esc(catalogCheckedAt)}</p><p class="pq-note">${esc(priceNote)}</p>`};
  }catch(error){return {quote:null,html:`<p class="pq-error" role="alert">${esc(error.message)}</p>`};}
}
export function mountPriceQuick(root){
  const host=root?.querySelector('#price-quick');if(!host)return;
  const update=()=>{
    const input=selection(host),klass=vehicleClasses.find(item=>item.id===input.classId);
    for(const extra of options){const label=host.querySelector(`[data-extra-price="${extra.id}"]`);if(label)label.textContent=extraIncluded(input.packageId,extra.id)?' · im Paket enthalten':' · '+money(Math.round(extra.priceCents*(klass?.factorPercent??100)/100));}
    for(const field of host.querySelectorAll('[data-pickup-fields]'))field.hidden=!host.querySelector('[name="pickup"]').checked;
    const kmField=host.querySelector('[name="pickupKm"]').closest('label');kmField.hidden=!host.querySelector('[name="pickup"]').checked||Boolean(host.querySelector('[name="citySlug"]').value);
    host.querySelector('[data-quote]').innerHTML=quoteView(input).html;
  };
  host.addEventListener('input',update);host.addEventListener('change',update);update();
}
