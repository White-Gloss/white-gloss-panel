const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value&&!Number.isNaN(Date.parse(value))?new Intl.DateTimeFormat('de-DE',{dateStyle:'medium'}).format(new Date(value)):'Nicht hinterlegt';
const fact=item=>`<p>${esc(item.status)}</p><small>Datum: ${esc(date(item.at))}${item.operatorSigned?' · Betrieb unterschrieben':''}</small>`;
export function orderEvidenceHTML(model){
 if(model.loading)return '<p role="status">Dokumente werden geladen …</p>';
 return `<section class="order-evidence" aria-labelledby="evidence-title"><h3 id="evidence-title">Dokumente</h3><p class="hint">Aktuelle Nachweise und offene Fassungen. Bearbeiten und versenden im jeweiligen Bereich.</p>${model.documents.map(d=>`<article class="evidence-document" data-evidence-document="${d.kind}"><div><h4>${esc(d.title)}</h4>${fact(d.current)}${d.pending?`<div class="evidence-pending">${fact(d.pending)}<small>Das bisherige Dokument bleibt unverändert.</small></div>`:''}${d.handover?`<p class="hint">Vorab-Übergabeerlaubnis: ${d.handover.signed?'Unterschrieben':'Unterschrift nicht hinterlegt'} · ${esc(date(d.handover.at))}. Separater Nachweis, keine Protokollunterschrift.</p>`:''}${d.annotation?`<p class="hint">Schritt: ${esc(({skipped:'Übersprungen',completed:'Manuell erledigt',open:'Wieder geöffnet'})[d.annotation.state]??'Nicht hinterlegt')}${d.annotation.reason?' · '+esc(d.annotation.reason):''} · ${esc(date(d.annotation.at))}</p>`:''}${d.history.length?`<details><summary>Frühere Fassungen (${d.history.length})</summary>${d.history.map(h=>`<div class="evidence-history">${fact(h)}<small>Beendet / ersetzt: ${esc(date(h.replacedAt))}</small></div>`).join('')}</details>`:''}</div><button type="button" data-tab="${d.targetTab}" aria-label="${esc(d.title)}: Bereich öffnen">Bereich öffnen</button></article>`).join('')}</section>`;
}
export function orderMediaHTML(){return `<section class="order-evidence"><h3>Fotos & Fahrzeugzustand</h3><p class="hint">Nach Quelle und Dokumentfassung getrennt. Gespeicherte Medien werden erst beim Öffnen geladen.</p>${[['stored','Anfrage / Kommunikation'],['intake','Annahme'],['return','Rückgabe']].map(([kind,label])=>`<details data-order-media="${kind}"><summary>${label}</summary><div data-media-result role="status" aria-live="polite"></div></details>`).join('')}</section>`;}
function mediaHTML(photos){return photos.length?`<div class="evidence-media">${photos.map((p,i)=>{
 const url=typeof p.url==='string'&&/^\/api\/asset\/[a-zA-Z0-9_-]+$/.test(p.url)?p.url:null;
 if(!url)return '<p>Medium nicht verfügbar.</p>';
 const label=p.name||'Zustandsfoto '+(i+1),mime=p.mime??'';
 return `<figure>${mime.startsWith('image/')?`<a href="${esc(url)}" target="_blank" rel="noreferrer"><img loading="lazy" src="${esc(url)}" alt="${esc(label)}"></a>`:mime.startsWith('video/')?`<video controls preload="none" src="${esc(url)}" aria-label="${esc(label)}"></video>`:`<a href="${esc(url)}" target="_blank" rel="noreferrer">${mime==='application/pdf'?'PDF öffnen':'Datei öffnen'}: ${esc(label)}</a>`}<figcaption>${esc(label)}${p.source?' · '+esc(p.source):''}</figcaption></figure>`;
 }).join('')}</div>`:'<p>Keine gespeicherten Medien vorhanden.</p>';}
export function mountOrderMedia(root,{order,load}){
 let disposed=false;const cleanups=[];
 for(const detail of root.querySelectorAll('[data-order-media]')){
  let busy=false,loaded=false,failed=false;const result=detail.querySelector('[data-media-result]');
  const valid=()=>!disposed&&root.isConnected&&detail.isConnected;
  const show=async()=>{
   if(!detail.open||busy||loaded||failed||!valid())return;busy=true;result.textContent='Gespeicherte Medien werden geladen …';
   try{
    const kind=detail.dataset.orderMedia;
    let html;
    if(kind==='intake'||kind==='return'){
     const versions=[{label:'Aktuelle Fassung',content:order[kind]},{label:'Offene Fassung',content:order.pending?.[kind]?.content},...(order[kind+'History']??[]).slice().reverse().map((content,i)=>({label:'Frühere Fassung '+(i+1),content}))].filter(v=>v.content);
     html=versions.length?versions.map(v=>`<h4>${esc(v.label)} · ${esc(date(v.content.savedAt??v.content.signedAt))}</h4>${mediaHTML((v.content.photos??[]).map((id,i)=>({url:'/api/asset/'+id,mime:'image/jpeg',name:(kind==='intake'?'Annahme':'Rückgabe')+' · '+v.label+' · Foto '+(i+1)})))}`).join(''):'<p>Noch kein Protokoll vorhanden.</p>';
    }else{const data=await load(order.id);html='<p class="hint">Bis zu 40 zuletzt gespeicherte Medien. Keine Synchronisation beim Nachschlagen.</p>'+mediaHTML(data.photos??[])+(data.warning?'<p>'+esc(data.warning)+'</p>':'');}
    if(valid()){result.innerHTML=html;loaded=true;}
   }catch{failed=true;if(valid())result.innerHTML='<p>Gespeicherte Medien konnten nicht geladen werden.</p><button type="button" data-media-retry>Erneut versuchen</button>';}
   finally{busy=false;}
  };
  const retry=e=>{if(e.target.closest('[data-media-retry]')){failed=false;show();}};
  detail.addEventListener('toggle',show);detail.addEventListener('click',retry);cleanups.push(()=>{detail.removeEventListener('toggle',show);detail.removeEventListener('click',retry);});
 }
 return ()=>{disposed=true;for(const cleanup of cleanups)cleanup();};
}
