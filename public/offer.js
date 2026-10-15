import {offerLinesHTML} from './pricing.js';
import {signaturePad} from './signature.js';
import {immediateStartNotice} from './catalog.mjs';
export const isOffer=location.pathname.startsWith('/angebot/');
const escaped=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=iso=>new Intl.DateTimeFormat('de-DE',{dateStyle:'long',timeStyle:'short',timeZone:'Europe/Berlin'}).format(new Date(iso))+' Uhr';
function appointmentHTML(a){return a?`<section class="offer-appointment"><h2>Ihr vereinbarter Termin</h2><p><strong>${escaped(date(a.start))}</strong><br>Voraussichtlich fertig: ${escaped(date(a.end))}</p><p>${escaped(a.delivery)}${a.location?'<br>'+escaped(a.location):''}</p><p class="hint">Angebot und Termin bestätigen Sie gemeinsam mit einer Unterschrift.</p></section>`:'<p class="hint">Ein konkreter Termin wird nach Ihrer Annahme persönlich vereinbart.</p>';}
export async function showOffer(){
  const root=document.querySelector('#app'),token=location.pathname.split('/').pop();
  const response=await fetch('/api/offer/'+encodeURIComponent(token)),o=await response.json();
  if(!response.ok){root.innerHTML='<main class="appoff card"><span class="brandmark">WG</span><h1>Ihr persönliches Angebot</h1><p>'+escaped(o.error)+'</p></main>';return;}
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(o)));
  const snapshotHash=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
  const amount=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(o.offer.totalCents/100),business=o.business;
  root.innerHTML=`<main class="appoff card offer-document"><header class="offer-header"><div class="brand"><span class="brandmark">WG</span><div><strong>White Gloss</strong><small>DETAILING · HORB AM NECKAR</small></div></div><h1>${o.appointment?'Ihr Angebot & Termin':'Ihr persönliches Angebot'}</h1><p>${escaped(o.wg)}</p>${business?`<p class="hint">${escaped(business.name)} · ${escaped(business.owner)}<br>${escaped(business.street)} · ${escaped(business.city)}<br>${escaped(business.phone)} · ${escaped(business.email)}</p>`:''}</header>
    <section><h2 class="sectiontitle">Für Sie vorbereitet</h2><p><strong>${escaped(o.customer)}</strong><br>${escaped(o.vehicle)}</p></section>
    <section class="protocolreview"><h2 class="sectiontitle">Vereinbarte Leistungen</h2>${o.offer.services&&!o.offer.lines?.length?'<p>'+escaped(o.offer.services)+'</p>':''}${offerLinesHTML(o.offer)}<div class="offer-total"><span>Gesamtfestpreis inklusive Umsatzsteuer</span><strong>${amount}</strong></div>${o.hints?.price?`<p class="hint">${escaped(o.hints.price)}</p>`:''}</section>
    ${appointmentHTML(o.appointment)}<p class="hint">Dieses Angebot gilt bis ${escaped(date(o.offer.expiresAt))}.</p>
    ${o.hints?.withdrawal?`<details class="protocolreview" open><summary>Widerrufsbelehrung</summary><p class="withdrawal-text">${escaped(o.hints.withdrawal)}</p></details>`:''}
    ${o.ownerPreview?'<p class="hint">Betreibervorschau · Nur der Kunde kann dieses Angebot persönlich annehmen.</p>':o.status==='Angebot offen'?`<form id="customerOfferForm"><h2 class="sectiontitle">${o.appointment?'Eine Unterschrift für Angebot & Termin':'Ihre persönliche Unterschrift'}</h2><canvas id="offerSignature" class="signature" aria-label="Ihre persönliche Unterschrift"></canvas><button type="button" id="clearOffer">Unterschrift löschen</button><label class="check sectiongap"><input type="checkbox" id="offerObligation" required>Ich habe die angezeigten Leistungen und den Gesamtfestpreis geprüft und nehme das Angebot zahlungspflichtig an.</label>${o.appointment?'<label class="check"><input type="checkbox" id="offerAppointment" required>Ich bestätige den oben angezeigten Termin verbindlich mit derselben Unterschrift.</label>':''}${o.hints?.withdrawal?'<label class="check"><input type="checkbox" id="offerWithdrawal">Die Widerrufsbelehrung wurde mir angezeigt.</label>':''}<label class="check"><input type="checkbox" id="offerImmediate">${escaped(immediateStartNotice)}</label><div class="error" id="offerError" role="alert"></div><button class="primary" type="submit">${o.appointment?'Angebot & Termin':'Angebot'} zahlungspflichtig für ${amount} bestätigen</button></form>`:'<p>Dieses Angebot ist nicht mehr zur Annahme geöffnet. Status: '+escaped(o.status)+'</p>'}</main>`;
  if(o.ownerPreview||o.status!=='Angebot offen')return;
  const pad=signaturePad(document.querySelector('#offerSignature'));
  document.querySelector('#clearOffer').onclick=()=>pad.clear();
  document.querySelector('#customerOfferForm').onsubmit=async e=>{
    e.preventDefault();const button=e.target.querySelector('[type=submit]');
    try{
      if(!pad.drawn)throw Error('Bitte persönlich unterschreiben.');
      if(o.appointment&&!document.querySelector('#offerAppointment').checked)throw Error('Bitte den angezeigten Termin bestätigen.');
      button.disabled=true;
      const r=await fetch('/api/offer/'+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({snapshotHash,signature:pad.dataURL(),paymentObligation:document.querySelector('#offerObligation').checked,confirmAppointment:document.querySelector('#offerAppointment')?.checked===true,withdrawalNotice:document.querySelector('#offerWithdrawal')?.checked===true,immediateStart:document.querySelector('#offerImmediate').checked})});
      const result=await r.json();if(!r.ok)throw Error(result.error);
      root.innerHTML='<main class="appoff card offer-document"><span class="brandmark">WG</span><h1>Ihre Annahme ist gespeichert</h1><p>'+(result.status==='Termin verbindlich'?'Vielen Dank. Ihr Angebot und der angezeigte Termin sind verbindlich bestätigt.':'Vielen Dank. White Gloss wird Ihren verbindlichen Termin mit Ihnen vereinbaren.')+'</p></main>';
    }catch(error){document.querySelector('#offerError').textContent=error.message;button.disabled=false;}
  };
}
