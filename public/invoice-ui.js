const invoiceEsc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const invoiceMoney=cents=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(cents/100);
const invoiceDay=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const mountedInvoices=new WeakMap();
const invoiceStatusLabels={draft:'Entwurf',open:'Offen',unpaid:'Offen',paid:'Bezahlt',paidoff:'Bezahlt',voided:'Storniert',cancelled:'Storniert',canceled:'Storniert',overdue:'Überfällig',openRevenue:'Offen',balanced:'Ausgeglichen'};
const invoiceStatusLabel=status=>Object.hasOwn(invoiceStatusLabels,status)?invoiceStatusLabels[status]:'Unbekannter Anbieterstatus';

function invoiceLines(order){
  const lines=order.offer?.lines??[{title:'Fahrzeugaufbereitung',description:order.offer?.services??'',amountCents:order.offer?.totalCents}];
  if(!lines.length||lines.some(line=>!Number.isSafeInteger(line.amountCents)||line.amountCents<0)||lines.reduce((sum,line)=>sum+line.amountCents,0)!==order.offer?.totalCents)throw Error('Die gespeicherten Leistungen stimmen nicht mit dem vereinbarten Festpreis überein.');
  return lines;
}

export function invoiceTotals(order,vatBasisPoints){
  invoiceLines(order);
  if(![0,700,1900].includes(vatBasisPoints))throw Error('Bitte einen von Lexware unterstützten Umsatzsteuersatz auswählen: 0 %, 7 % oder 19 %.');
  const grossCents=order.offer.totalCents,denominator=BigInt(10000+vatBasisPoints);
  const taxCents=Number((BigInt(grossCents)*BigInt(vatBasisPoints)+denominator/2n)/denominator);
  return {grossCents,netCents:grossCents-taxCents,taxCents};
}

function addressParts(address={}){
  return [address.street_address,[address.zip_code,address.city].filter(Boolean).join(' '),address.country_code].filter(Boolean);
}

function readInvoiceFields(form){
  const data=Object.fromEntries([...new FormData(form)].map(([key,value])=>[key,typeof value==='string'?value:'']));
  if(!/^\d{1,2}(?:[,.]\d{1,2})?$/.test(String(data.vatPercent??'')))throw Error('Steuersatz mit höchstens zwei Nachkommastellen eingeben.');
  const [whole,fraction='']=data.vatPercent.replace(',','.').split('.');
  const vatBasisPoints=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(![0,700,1900].includes(vatBasisPoints))throw Error('Bitte einen von Lexware unterstützten Umsatzsteuersatz auswählen: 0 %, 7 % oder 19 %.');
  const vatExemptionReason=String(data.vatExemptionReason??'').trim();
  if(vatBasisPoints===0&&!vatExemptionReason)throw Error('Bei 0 % Umsatzsteuer bitte den Steuerbefreiungsgrund angeben.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate??'')||Number.isNaN(Date.parse(data.dueDate))||new Date(data.dueDate).toISOString().slice(0,10)!==data.dueDate||data.dueDate<invoiceDay())throw Error('Fälligkeit muss ein gültiges Datum ab heute sein.');
  const billing={kind:data.billingKind,firstName:String(data.billingFirstName??'').trim(),lastName:String(data.billingLastName??'').trim(),name:String(data.billingName??'').trim(),street:String(data.billingStreet??'').trim(),zip:String(data.billingZip??'').trim(),city:String(data.billingCity??'').trim(),country:String(data.billingCountry??'').trim().toUpperCase()};
  return {provider:'lexware',clientId:data.clientId??'',vatBasisPoints,vatExemptionReason,dueDate:data.dueDate,billing};
}

function reviewedClient(input,inventory){
  const clients=inventory.clients??[];
  if(clients.length){
    const client=clients.find(item=>item.id===input.clientId);
    if(!client)throw Error('Bitte den passenden Lexware-Rechnungskunden auswählen.');
    if(!client.billing_address?.street_address||!client.billing_address?.zip_code||!client.billing_address?.city||!client.billing_address?.country_code)throw Error('Die Rechnungsadresse in Lexware ist unvollständig. Bitte dort ergänzen und den Rechnungsdialog neu öffnen.');
    return {name:client.name,email:client.email,address:addressParts(client.billing_address),existing:true};
  }
  const billing=input.billing;
  if(!['individual','company'].includes(billing.kind))throw Error('Bitte Privatkunde oder Firmenkunde auswählen.');
  if(billing.kind==='individual'?(!billing.firstName||!billing.lastName):!billing.name)throw Error('Bitte den vollständigen Rechnungskunden angeben.');
  if(!billing.street||!billing.zip||!billing.city||!/^[A-Z]{2}$/.test(billing.country))throw Error('Bitte die vollständige Rechnungsadresse prüfen.');
  return {name:billing.kind==='company'?billing.name:billing.firstName+' '+billing.lastName,address:[billing.street,billing.zip+' '+billing.city,billing.country],existing:false};
}

export function invoiceReview(order,input,inventory){
  const client=reviewedClient(input,inventory),totals=invoiceTotals(order,input.vatBasisPoints),vat=(input.vatBasisPoints/100).toLocaleString('de-DE',{maximumFractionDigits:2});
  return `<div class="sectiontitle">Deine Schlussrechnung vor der Freigabe</div><div class="fieldpair"><span>Auftragsreferenz</span><strong>${invoiceEsc(order.wg)}</strong></div><div class="fieldpair"><span>Rechnungskunde</span><span>${invoiceEsc(client.name)}<br>${invoiceEsc(client.email??order.source.email)}<br>${client.address.map(invoiceEsc).join('<br>')}</span></div><div class="fieldpair"><span>Fälligkeit</span><span>${invoiceEsc(input.dueDate)}</span></div><div class="tablewrap"><table><thead><tr><th>Vereinbarte Leistung</th><th>Brutto</th></tr></thead><tbody>${invoiceLines(order).map(line=>`<tr><td>${invoiceEsc(line.title)}${line.description?'<span class="sub">'+invoiceEsc(line.description)+'</span>':''}</td><td class="money">${invoiceMoney(line.amountCents)}</td></tr>`).join('')}</tbody></table></div><div class="fieldpair"><span>Nettobetrag · Vorschau</span><span class="money">${invoiceMoney(totals.netCents)}</span></div><div class="fieldpair"><span>Enthaltene Umsatzsteuer · ${invoiceEsc(vat)} % · Vorschau</span><span class="money">${invoiceMoney(totals.taxCents)}</span></div>${input.vatBasisPoints===0?'<div class="fieldpair"><span>Steuerbefreiungsgrund</span><span>'+invoiceEsc(input.vatExemptionReason)+'</span></div>':''}<div class="fieldpair"><strong>Verbindlicher Gesamtfestpreis</strong><strong class="money">${invoiceMoney(totals.grossCents)}</strong></div><p class="hint">${client.existing?'Der geprüfte vorhandene Lexware-Kunde wird verwendet.':'Der neue Rechnungskunde wird mit diesen Angaben in Lexware angelegt.'} Lexware vergibt die Rechnungsnummer; ${invoiceEsc(order.wg)} bleibt als Auftragsreferenz erhalten. Bankdaten und Rechnungsdesign kommen aus deinen Lexware-Einstellungen.</p>`;
}

export function invoiceForm(order,inventory){
  invoiceLines(order);
  const clients=inventory.clients??[];
  const field=(label,name,value='',extra='')=>`<label>${label}<input name="${name}" value="${invoiceEsc(value)}" ${extra}></label>`;
  return `<p>${invoiceEsc(order.wg)} · ${invoiceEsc(order.source.name)} · Festpreis ${invoiceMoney(order.offer.totalCents)} brutto</p><form id="invoiceform"><label>Lexware-Rechnungskunde<select name="clientId" ${clients.length?'required':''}><option value="">${clients.length?'Bitte den passenden vorhandenen Kunden auswählen':'Neuen Rechnungskunden mit den geprüften Angaben anlegen'}</option>${clients.map(client=>`<option value="${invoiceEsc(client.id)}">${invoiceEsc(client.name)} · ${invoiceEsc(client.email)}</option>`).join('')}</select></label>${clients.length?'':`<fieldset class="catalog-options"><legend>Neue Rechnungsadresse</legend><label>Rechnungskunde<select name="billingKind"><option value="individual">Privatkunde</option><option value="company">Firmenkunde</option></select></label><div class="grid2">${field('Vorname','billingFirstName','','autocomplete="given-name" maxlength="100"')}${field('Nachname','billingLastName','','autocomplete="family-name" maxlength="100"')}${field('Firma','billingName','','autocomplete="organization" maxlength="180"')}${field('Straße und Hausnummer','billingStreet','','autocomplete="street-address" maxlength="180" required')}${field('Postleitzahl','billingZip','','autocomplete="postal-code" maxlength="20" required')}${field('Ort','billingCity','','autocomplete="address-level2" maxlength="100" required')}${field('Land als Länderkürzel','billingCountry','DE','maxlength="2" required')}</div><p class="hint">Die Rechnungsadresse ausdrücklich prüfen. Der neue Kunde wird erst mit der Rechnungsfreigabe in Lexware gespeichert.</p></fieldset>`}<div class="grid2"><label>Umsatzsteuer in Prozent<input name="vatPercent" inputmode="decimal" required placeholder="0, 7 oder 19" maxlength="5"></label>${field('Steuerbefreiungsgrund, nur bei 0 %','vatExemptionReason','','maxlength="500"')}${field('Fälligkeit','dueDate','','type="date" min="'+invoiceDay()+'" required')}</div><section class="sectiongap" data-invoice-review aria-live="polite"><p class="hint">Rechnungskunde, Steuerangaben und Fälligkeit vervollständigen, um die Vorschau zu prüfen.</p></section><label class="check"><input type="checkbox" name="reviewed" required disabled>Ich habe den Rechnungskunden, die Anschrift, die Steuerangaben, alle Leistungen und den Festpreis in dieser Vorschau geprüft. Die Schlussrechnung soll jetzt bei Lexware erstellt werden.</label><p class="hint">Die endgültige Rechnung wird einmal erstellt. Eine Zahlung oder Rechnungs-E-Mail wird dadurch nicht ausgelöst.</p><button class="primary" type="submit" disabled>Geprüfte Lexware-Schlussrechnung erstellen</button><div id="modal-error" class="error"></div></form>`;
}

export function mountInvoiceForm(form,order,inventory){
  if(!form)return;
  const context={order:structuredClone(order),inventory:structuredClone(inventory),reviewedInput:null};
  mountedInvoices.set(form,context);
  const update=()=>{
    const kind=form.elements.billingKind?.value;
    for(const name of ['billingFirstName','billingLastName','billingName'])if(form.elements[name]){
      const needed=name==='billingName'?kind==='company':kind==='individual';
      form.elements[name].required=needed;
      form.elements[name].closest('label').hidden=!needed;
    }
    const review=form.querySelector('[data-invoice-review]'),submit=form.querySelector('[type="submit"]');
    form.elements.reviewed.checked=false;
    try{
      const input=readInvoiceFields(form);
      review.innerHTML=invoiceReview(context.order,input,context.inventory);
      context.reviewedInput=JSON.stringify(input);
      form.elements.reviewed.disabled=false;submit.disabled=false;
    }catch(error){
      context.reviewedInput=null;
      review.innerHTML='<p class="hint">'+invoiceEsc(error.message)+'</p>';
      form.elements.reviewed.disabled=true;submit.disabled=true;
    }
  };
  form.addEventListener('input',event=>{if(event.target.name!=='reviewed')update();});
  form.addEventListener('change',event=>{if(event.target.name!=='reviewed')update();});
  update();
}

export function invoiceInput(form,currentOrder){
  const context=mountedInvoices.get(form),input=readInvoiceFields(form);
  if(!context||!currentOrder||currentOrder.id!==context.order.id||currentOrder.version!==context.order.version)throw Error('Der Auftrag hat sich seit der Vorschau geändert. Bitte den Rechnungsdialog erneut öffnen und prüfen.');
  if(!context||context.reviewedInput!==JSON.stringify(input)||form.elements.reviewed.checked!==true)throw Error('Bitte die aktuelle Rechnungsvorschau vollständig prüfen und ausdrücklich freigeben.');
  reviewedClient(input,context.inventory);invoiceTotals(context.order,input.vatBasisPoints);
  const selectedClient=(context.inventory.clients??[]).find(client=>client.id===input.clientId);
  if(selectedClient&&!/^[a-f0-9]{64}$/i.test(selectedClient.reviewHash??''))throw Error('Der geprüfte Kundenabgleich fehlt. Bitte den Rechnungsdialog erneut öffnen.');
  return {...input,clientReviewHash:selectedClient?.reviewHash??null,reviewed:true};
}

export function invoiceResultHTML(order){
  const invoice=order.invoice;
  if(!invoice)return '';
  const lexware=invoice.provider==='lexware',label=lexware?'Lexware-Schlussrechnung':'Bestehende Rechnung';
  let link='';
  if(lexware&&/^[a-f0-9-]{36}$/i.test(invoice.id??''))link=`<a href="https://app.lexware.de/permalink/invoices/view/${invoiceEsc(invoice.id)}" target="_blank" rel="noreferrer">Rechnung in Lexware ansehen →</a>`;
  else if(!lexware&&invoice.url){try{const url=new URL(invoice.url);if(url.protocol==='https:')link='<a href="'+invoiceEsc(url.href)+'" target="_blank" rel="noreferrer">Bestehende Rechnung ansehen →</a>';}catch{/* Historische Rechnungsdaten bleiben ohne ungültigen Link sichtbar. */}}
  const remote=invoice.remotePayment;
  return `<p><strong>${label} ${invoiceEsc(invoice.number??'')}</strong> · ${invoiceStatusLabel(invoice.status)}</p><div class="actions">${lexware?'<a href="/api/lexware/pdf?id='+encodeURIComponent(order.id)+'">Original-Rechnung als PDF herunterladen</a>':''}${link}</div>${lexware&&remote?'<p>Lexware-Zahlstatus: '+invoiceStatusLabel(remote.status??remote.paymentStatus)+'</p><p class="hint">Der Lexware-Zahlstatus ist ein externer Stand. Tatsächliche Zahlungseingänge im Auftrag mit Nachweis erfassen.</p>':''}`;
}
