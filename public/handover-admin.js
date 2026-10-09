import {protocolHTML} from './protocol-view.js';
import {protocolAllowed,agreedOffer} from './operations.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const handoverStatus=(order,kind)=>order.handovers?.[kind]?.status==='pending'?'Wartet auf Kundenunterschrift':order[kind]?'Abgeschlossen':'Noch nicht erstellt';

export function handoversPage(orders){
  const visible=orders.filter(o=>protocolAllowed(o,'intake',true)||protocolAllowed(o,'return',true)||o.intake||o.return||o.handovers);
  const pending=visible.reduce((count,o)=>count+Object.values(o.handovers??{}).filter(p=>p.status==='pending').length,0);
  return `<div class="heading"><div><div class="eyebrow">Annahme & Abgabe</div><h1>Fahrzeugübergabeprotokoll</h1><p>Gemeinsam vor Ort unterschreiben oder bei abwesendem Kunden vorab dokumentieren.</p></div><div class="actions"><button class="primary" data-click="directHandoverIntake">Annahme direkt starten</button><button data-click="directHandoverReturn">Abgabe direkt starten</button><button data-click="refresh">Aktualisieren</button></div></div>
    <div class="notice blue"><div><strong>Du unterschreibst zuerst, der Kunde bestätigt später</strong>Fülle das Protokoll aus, dokumentiere den Fahrzeugzustand und unterschreibe. Der Kunde prüft es über seinen Zugang und unterschreibt dort persönlich. Bei der Abgabe ergänzt du den Schlüsselablageort mit Foto.</div></div>
    <section class="card"><div class="card-title"><h2>Annahme und Abgabe deiner Aufträge</h2><small>${pending} warten auf Kundenunterschrift</small></div>${visible.length?`<div class="tablewrap"><table><thead><tr><th>Auftrag / Kunde</th><th>Fahrzeug</th><th>Annahme</th><th>Abgabe</th><th></th></tr></thead><tbody>${visible.map(o=>`<tr><td><strong>${esc(o.wg)}</strong><span class="sub">${esc(o.source.name)}</span></td><td>${esc(o.source.vehicle)}</td><td><span class="badge ${o.handovers?.intake?.status==='pending'?'warn':o.intake?'good':''}">${handoverStatus(o,'intake')}</span></td><td><span class="badge ${o.handovers?.return?.status==='pending'?'warn':o.return?'good':''}">${handoverStatus(o,'return')}</span></td><td><button class="smallbtn" data-order="${esc(o.id)}">Protokoll öffnen</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><strong>Noch keine Fahrzeuge zur Übergabe</strong><p>Aufträge erscheinen hier, sobald Kundenannahme und verbindlicher Termin vorliegen.</p><button data-view="orders">Anfragen & Aufträge öffnen</button></div>'}</section>`;
}

export function remoteHandoverDetail(o,kind,{input,notice,customerReady,company,direct}){
  const saved=o.handovers?.[kind];
  if(saved){
    const pending=saved.status==='pending';
    return notice(pending?'Wartet auf Kundenunterschrift':'Protokoll abgeschlossen',pending?'Deine Unterschrift ist gespeichert. Der Kunde prüft und bestätigt genau dieses Protokoll über seinen Zugang.':'Beide Unterschriften sind gespeichert. Annahme beziehungsweise Abgabe ist bestätigt.',!pending)+
      `<div class="actions sectiongap"><button data-click="handoverLink" data-kind="${kind}">Kundenzugang anzeigen</button><a href="/protokoll/${esc(saved.token)}" target="_blank" rel="noreferrer">Kundenansicht öffnen →</a></div>`+
      protocolHTML({...saved.protocol,customerSignature:saved.customerSignature,customerSignedAt:saved.customerSignedAt},{assetUrl:id=>'/api/asset/'+encodeURIComponent(id),kind,operatorSignedAt:saved.operatorSignedAt,customerSignedAt:saved.customerSignedAt})+
      (!pending&&saved.protocol.business?`<p><a href="/api/protocol/pdf?id=${encodeURIComponent(o.id)}&kind=${kind}">Unterschriebenes Protokoll als PDF herunterladen</a></p>`:'');
  }
  if(o[kind])return notice('Protokoll bereits abgeschlossen','Das bestehende Protokoll ist gespeichert. Du findest es weiterhin unter Fahrzeugprotokolle.',true);
  if(Object.values(o.handovers??{}).some(p=>p.status==='pending'))return notice('Kundenunterschrift steht aus','Bitte zuerst das bereits bereitgestellte Protokoll vom Kunden bestätigen lassen.');
  if(!protocolAllowed(o,kind,direct))return notice('Direkte Übergabe',protocolAllowed(o,kind,true)?`Du kannst diese Übergabe auch ohne vorherigen Angebots- und Terminablauf dokumentieren. <button data-direct-existing="${kind}">${kind==='intake'?'Annahme':'Abgabe'} jetzt direkt dokumentieren</button>`:'In diesem Status ist kein weiteres Protokoll möglich. Prüfe gegebenenfalls offene Nachträge.');
  if(!customerReady)return notice('Kundenzugang noch einzurichten','Für die spätere persönliche Unterschrift muss der vorhandene Kundenzugang freigegeben sein. <a href="#settings" data-view="settings">Einstellungen öffnen →</a>');
  if(!o.source.email)return notice('Kunden-E-Mail fehlt','Ergänze zuerst die E-Mail-Adresse des Kunden, damit das Protokoll seinem persönlichen Zugang zugeordnet werden kann.');
  const localNow=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()).replace(' ','T');
  return `<p class="hint">${kind==='intake'?'Du dokumentierst die Annahme, während der Kunde nicht zu Hause ist.':'Du stellst das Fahrzeug ab und dokumentierst, wo du den Schlüssel hinterlegst.'} Nach deiner Unterschrift bleiben die Angaben festgeschrieben. Der Kunde erhält sie in seinem Zugang zur Prüfung.</p>
    ${kind==='return'&&o.intake?`<details class="protocolreview"><summary>Annahmeprotokoll zum Vergleich</summary>${protocolHTML(o.intake,{assetUrl:id=>'/api/asset/'+encodeURIComponent(id),kind:'intake'})}</details>`:''}
    ${o.customerPortalAccess?.ready===false?'<p class="hint">Der Kunde kann seine persönliche PIN über „PIN anfordern“ im Kundenpanel einrichten. Nach deiner Unterschrift wird das Protokoll dort sichtbar.</p>':''}
    <form id="handoverform"><input type="hidden" name="kind" value="${kind}">${direct?'<label>Anlass der direkten Übergabe<textarea name="directReason" maxlength="2000" required placeholder="Zum Beispiel telefonisch vereinbart …"></textarea></label>':''}<div class="grid2">
    ${input('Kennzeichen','plate','text',o.intake?.plate??o.source.plate??'','required')}
    ${input('Datum / Uhrzeit · Europe/Berlin','at','datetime-local',localNow,'required')}
    ${input(kind==='return'?'Abstellort des Fahrzeugs':'Ort der Fahrzeugannahme','location','text',o.appointment?.location??'','required')}
    <label>Übergabeart<select name="delivery"><option ${o.appointment?.delivery==='Abholung'?'selected':''}>Abholung</option><option ${o.appointment?.delivery==='Kunde bringt'?'selected':''}>Kunde bringt</option></select></label>
    ${input('Kilometerstand','mileage','number','','min="0" step="1" required')}
    ${input('Anzahl Schlüssel','keys','number','','min="0" max="20" step="1" required')}
    ${input('Name des Kunden','customerName','text',o.source.name,'required')}
    ${input('Name des Betriebsvertreters','operatorName','text',company?.owner??'','required')}</div>
    <label>Fahrzeugzustand / Schäden mit Position und Beschreibung<textarea name="condition" required></textarea></label>
    <label>Zusätzliche Hinweise<textarea name="notes"></textarea></label>
    ${kind==='return'?`<label>Ausgeführte Leistungen<textarea name="services" required>${esc(agreedOffer(o)?.services??'')}</textarea></label><label>Offene Punkte<textarea name="openPoints"></textarea></label><label class="check"><input type="checkbox" name="workComplete" required>Die vereinbarten Arbeiten sind abgeschlossen.</label><label>Ort der Schlüsselablage<textarea name="keyLocation" required placeholder="Zum Beispiel im vereinbarten Schlüsseltresor neben der Haustür"></textarea></label><label>Foto der Schlüsselablage · JPEG, PNG, WebP · maximal 5 MB<input name="keyPhotoFile" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required></label>`:''}
    <label>Zustandsfotos · JPEG, PNG, WebP · je maximal 5 MB<input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple required></label>
    <div class="error" id="form-error"></div><button class="primary" type="submit">Protokoll prüfen & vorab unterschreiben</button></form>`;
}
