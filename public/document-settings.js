const documentSettingsEscape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

export function documentSettingsHTML(company={}){
  const companyField=(key,label,type='text')=>`<label>${label}<input name="company_${key}" type="${type}" maxlength="300" value="${documentSettingsEscape(company[key])}" required></label>`;
  return `<section class="card formsection sectiongap" id="document-settings"><h2>Freigegebenes Briefpapier</h2><p>Verwende dein tatsächlich leeres originales Briefpapier. Eine ausgefüllte Rechnung enthält bereits Inhalte und Kundendaten; sie ist kein leerer Dokumenthintergrund.</p><div data-document-template-status aria-live="polite">Aktive Briefpapierversion wird geprüft …</div><form data-document-template data-ops><h3>Neue Briefpapierversion freigeben</h3><p class="hint">Einseitige A4-PDF im Hochformat, höchstens 2 MB. Das Original und seine Freigabe werden als eigene Version gespeichert. Bereits ausgestellte Dokumente behalten ihre gespeicherte Vorlage.</p><label>Leeres originales Briefpapier<input name="letterhead" type="file" accept="application/pdf,.pdf" required></label><p class="hint" data-document-file></p><label>Freigabenachweis<textarea name="evidence" maxlength="2000" required placeholder="Welche Originalvorlage hast du geprüft und freigegeben?"></textarea></label><h3>Ausstellerdaten ausdrücklich bestätigen</h3><div class="grid2">${companyField('name','Betriebsname')}${companyField('email','Kontakt-E-Mail','email')}${companyField('street','Straße und Hausnummer')}${companyField('city','PLZ und Ort')}</div><label class="check"><input type="checkbox" name="companyConfirmed" required>Ich habe diese Ausstellerdaten geprüft und bestätige sie für die Kundendokumente.</label><h3>Geprüfter Inhaltsbereich</h3><p class="hint">Gib die tatsächlich geprüften Abstände zur Papierkante in PDF-Punkten ein (72 Punkte = 1 Zoll). Jeder Rand mindestens 24 Punkte. Die Felder haben bewusst keine vorgeschlagene Freigabe.</p><div class="grid2">${[['left','Links'],['right','Rechts'],['top','Oben'],['bottom','Unten']].map(([key,label])=>`<label>${label} · PDF-Punkte<input name="margin_${key}" type="number" min="24" step="1" required></label>`).join('')}</div><label class="check"><input type="checkbox" name="blankLetterheadConfirmed" required>Ich bestätige, dass dies mein leeres originales Briefpapier ohne fremde Kundendaten oder bereits ausgefüllte Rechnungspositionen ist.</label><label class="check"><input type="checkbox" name="approved" required>Ich gebe diese PDF mit den bestätigten Ausstellerdaten und Inhaltsrändern als neue unveränderliche Briefpapierversion frei.</label><button class="primary" type="submit" disabled>Geprüfte Briefpapierversion freigeben</button><p class="error" data-document-error role="alert"></p></form><p class="hint">Die Rechnungsausgabe über Qonto benötigt ihren eigenen überprüften Layoutnachweis. Diese Freigabe allein bestätigt keine Qonto-Rechnungsgestaltung.</p></section>`;
}

export function readDocumentSettings(form){
  const values=Object.fromEntries(new FormData(form));
  if(!form.elements.companyConfirmed.checked||!form.elements.blankLetterheadConfirmed.checked||!form.elements.approved.checked)throw Error('Bitte leeres Briefpapier, Ausstellerdaten und Freigabe ausdrücklich bestätigen.');
  const evidence=String(values.evidence??'').trim();
  if(!evidence)throw Error('Bitte den konkreten Freigabenachweis eintragen.');
  const company=Object.fromEntries(['name','street','city','email'].map(key=>[key,String(values['company_'+key]??'').trim()]));
  if(Object.values(company).some(value=>!value||value.length>300))throw Error('Bitte die bestätigten Ausstellerdaten vollständig eintragen.');
  const contentBox=Object.fromEntries(['left','right','top','bottom'].map(key=>[key,Number(values['margin_'+key])]));
  if(Object.values(contentBox).some(value=>!Number.isFinite(value)||value<24))throw Error('Jeder geprüfte Inhaltsrand muss mindestens 24 PDF-Punkte betragen.');
  return {approved:true,blankLetterheadConfirmed:true,company,evidence,contentBox};
}

function documentTemplateStatus(template){
  if(!template)return '<div class="notice"><div><strong>Kein Briefpapier freigegeben</strong>Zahlungsnachweise und andere geschützte Kundendokumente benötigen zuerst die tatsächliche leere Originalvorlage.</div></div>';
  const rows=[['Unveränderliche Vorlagen-ID',template.id],['Original-Prüfsumme · SHA-256',template.hash],['Freigegeben am',new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',dateStyle:'medium',timeStyle:'short'}).format(new Date(template.approvedAt))],['Freigabenachweis',template.evidence],['Aussteller',template.company?.name],['Adresse',[template.company?.street,template.company?.city].filter(Boolean).join(', ')],['Kontakt',template.company?.email],['Geprüfte Ränder · PDF-Punkte',['left','right','top','bottom'].map(key=>({left:'links',right:'rechts',top:'oben',bottom:'unten'}[key])+': '+template.contentBox?.[key]).join(' · ')]];
  return '<div class="notice blue"><div><strong>Aktive Briefpapierversion freigegeben</strong>Neue Zahlungsnachweise verwenden diese gespeicherte Originalvorlage.</div></div>'+rows.map(([key,value])=>`<div class="fieldpair"><span>${documentSettingsEscape(key)}</span><span>${documentSettingsEscape(value)}</span></div>`).join('');
}

async function documentPDFBase64(file){
  if(!file||file.size<=100||file.size>2*1024*1024)throw Error('Bitte eine einseitige A4-PDF mit höchstens 2 MB auswählen.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(!new TextDecoder().decode(bytes.subarray(0,5)).startsWith('%PDF-'))throw Error('Die ausgewählte Datei ist keine PDF.');
  let encoded='';
  for(let offset=0;offset<bytes.length;offset+=32768)encoded+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
  return btoa(encoded);
}

export async function mountDocumentSettings(host,{api,toast=()=>{}}){
  if(!host||host.dataset.mounted==='true')return;
  host.dataset.mounted='true';
  const form=host.querySelector('[data-document-template]'),submit=form.querySelector('[type="submit"]'),error=host.querySelector('[data-document-error]'),status=host.querySelector('[data-document-template-status]');
  let loading=false;
  const load=async()=>{const result=await api('document-template');if(host.isConnected){status.innerHTML=documentTemplateStatus(result.template);submit.disabled=false;}};
  form.elements.letterhead.addEventListener('change',()=>{const file=form.elements.letterhead.files[0];host.querySelector('[data-document-file]').textContent=file?file.name+' · '+Math.ceil(file.size/1024)+' KB · Prüfe Original, leeren Inhalt und Ränder vor deiner Freigabe.':'';});
  form.addEventListener('submit',async event=>{
    event.preventDefault();event.stopPropagation();if(loading)return;
    loading=true;submit.disabled=true;error.textContent='';
    try{
      const configuration=readDocumentSettings(form),pdfBase64=await documentPDFBase64(form.elements.letterhead.files[0]);
      const template=await api('document-template',{...configuration,pdfBase64});
      if(!host.isConnected)return;
      status.innerHTML=documentTemplateStatus(template);form.reset();host.querySelector('[data-document-file]').textContent='';toast('Originalbriefpapier als neue bestätigte Version gespeichert.');
    }catch(reason){if(host.isConnected)error.textContent=reason.message;}
    finally{loading=false;if(host.isConnected)submit.disabled=false;}
  });
  try{await load();}catch(reason){if(host.isConnected){status.textContent='Der Briefpapierstatus konnte nicht geprüft werden.';error.textContent=reason.message;}}
}
