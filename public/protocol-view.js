const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const text=value=>escapeHTML(value===undefined||value===null||value===''?'—':value);
const number=value=>typeof value==='number'&&Number.isFinite(value)?new Intl.NumberFormat('de-DE').format(value):text(value);
function dateTime(value){
  if(!value)return '—';
  const local=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value);
  const date=new Date(local?value+'Z':value);
  if(!Number.isFinite(date.getTime()))return text(value);
  return escapeHTML(new Intl.DateTimeFormat('de-DE',{dateStyle:'long',timeStyle:'short',timeZone:local?'UTC':'Europe/Berlin'}).format(date))+' Uhr · Europe/Berlin';
}
const values=rows=>`<dl class="protocol-values">${rows.map(([label,value])=>`<dt>${escapeHTML(label)}</dt><dd>${value}</dd>`).join('')}</dl>`;
const paragraph=(label,value)=>`<section><h3 class="sectiontitle">${escapeHTML(label)}</h3><p class="protocol-text">${text(value)}</p></section>`;
function image(id,assetUrl,label,className='',previewId){
  if(!id||typeof assetUrl!=='function')return '';
  const url=escapeHTML(assetUrl(id));
  return `<a href="${url}" target="_blank" rel="noreferrer"><img class="${className}" src="${escapeHTML(assetUrl(previewId??id))}" alt="${escapeHTML(label)}" loading="lazy"></a>`;
}

export function protocolHTML(protocol,{assetUrl,kind=protocol?.kind,operatorSignedAt,customerSignedAt}={}){
  const p=protocol??{},isReturn=kind==='return';
  const photos=Array.isArray(p.photos)?p.photos:[];
  return `<article class="protocol-document protocolreview" aria-label="${isReturn?'Abgabeprotokoll':'Annahmeprotokoll'}">
    <h2 class="sectiontitle">${isReturn?'Abgabe':'Annahme'} des Fahrzeugs</h2>
    ${p.business?`<section><h3 class="sectiontitle">Betrieb</h3>${values([['Betrieb',text(p.business.name)],['Inhaber',text(p.business.owner)],['Adresse',text([p.business.street,p.business.city].filter(Boolean).join(', '))],['Kontakt',text([p.business.phone,p.business.email].filter(Boolean).join(' · '))]])}</section>`:''}
    ${values([
      ['Auftrag',text(p.wg)],['Kunde',text(p.customerName??p.customer)],...(p.customerEmail?[['Kunden-E-Mail',text(p.customerEmail)]]:[]),['Fahrzeug',text(p.vehicle)],
      ['Kennzeichen',text(p.plate)],['Datum / Uhrzeit',dateTime(p.at)],['Übergabeort',text(p.location)],
      ['Übergabeart',text(p.delivery)],['Kilometerstand',number(p.mileage)+' km'],['Anzahl Schlüssel',number(p.keys)],
      ['Betriebsvertreter',text(p.operatorName)]
    ])}
    ${p.direct?paragraph('Anlass der direkten Übergabe',p.directReason)+'<p class="hint">Dieses Fahrzeugprotokoll bestätigt keine gesonderte Angebotsannahme oder Terminvereinbarung.</p>':''}
    ${p.documentTemplate?'<p class="hint">Das abgeschlossene Protokoll wird mit dem freigegebenen Briefpapier gespeichert.</p>':p.documentTemplatePending?'<p class="hint">Die Protokoll-PDF wartet noch auf das freigegebene Briefpapier. Das unterschriebene Protokoll bleibt hier einsehbar.</p>':''}
    ${paragraph('Fahrzeugzustand / Schäden',p.condition)}
    ${paragraph('Zusätzliche Hinweise',p.notes)}
    ${isReturn?paragraph('Ausgeführte Leistungen',p.services)+paragraph('Offene Punkte',p.openPoints)+values([['Vereinbarte Arbeiten abgeschlossen',p.workComplete===true?'Ja':'Nein']])+paragraph('Ort der Schlüsselablage',p.keyLocation):''}
    ${isReturn&&p.keyPhoto?`<section><h3 class="sectiontitle">Foto der Schlüsselablage</h3><p class="hint">Das Foto zeigt den dokumentierten Ablageort des Schlüssels.</p>${image(p.keyPhoto,assetUrl,'Dokumentierter Ort der Schlüsselablage','protocol-key-photo',p.photoPreviews?.[p.keyPhoto])}</section>`:''}
    <section><h3 class="sectiontitle">Zustandsfotos</h3><div class="protocol-gallery">${photos.map((id,index)=>`<figure>${image(id,assetUrl,'Zustandsfoto '+(index+1),'',p.photoPreviews?.[id])}<figcaption>Zustandsfoto ${index+1} · Zum Öffnen des Originals antippen</figcaption></figure>`).join('')||'<p class="hint">Keine Zustandsfotos hinterlegt.</p>'}</div></section>
    <section><h3 class="sectiontitle">Unterschriften</h3><div class="grid2"><div class="signaturebox"><h3>Betrieb · ${text(p.operatorName)}</h3>${p.operatorSignature?image(p.operatorSignature,assetUrl,'Unterschrift des Betriebsvertreters','protocol-signature'):'<p class="hint">Noch nicht unterschrieben.</p>'}${operatorSignedAt||p.operatorSignedAt?`<p class="hint">Unterschrieben am ${dateTime(operatorSignedAt??p.operatorSignedAt)}</p>`:''}</div><div class="signaturebox"><h3>Kunde · ${text(p.customerName??p.customer)}</h3>${p.customerSignature?image(p.customerSignature,assetUrl,'Persönliche Unterschrift des Kunden','protocol-signature'):'<p class="hint">Kundenunterschrift steht noch aus.</p>'}${customerSignedAt||p.customerSignedAt?`<p class="hint">Unterschrieben am ${dateTime(customerSignedAt??p.customerSignedAt)}</p>`:''}</div></div></section>
  </article>`;
}
