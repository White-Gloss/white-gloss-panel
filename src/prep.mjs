// Vorbereitungen. Nichts wird versendet, gebucht oder als Preis festgeschrieben.
export function mailPrep(subject='', preview=''){
  const text=`${subject} ${preview}`.toLowerCase();
  const rules=[['Rechnung',['rechnung','invoice','beleg','mahnung','zahlung'] ],['Termin',['termin','uhrzeit','abholung'] ],['Werbung',['newsletter','abmelden','unsubscribe','rabatt','werbung'] ],['Anfrage',['anfrage','fahrzeug','politur','pflege','bitte um']]];
  for(const [folder,words] of rules) if(words.some(word=>text.includes(word))) return {folder,reason:`Sieht nach ${folder} aus. Es wird nichts verschoben, bis du zustimmst.`};
  return null;
}
export function inquiryGaps(source={}){
  const gaps=[];
  if(!String(source.vehicle||'').trim()) gaps.push('Fahrzeug fehlt');
  if(!String(source.package||source.services||'').trim()) gaps.push('Paket fehlt');
  if(!source.appointment && !String(source.wish||source.date||'').trim()) gaps.push('Wunschtermin fehlt');
  return gaps;
}
export function berlinDay(value,now=new Date()){
  const date=value?new Date(value):now;
  if(Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
export function morningBrief(orders,now=new Date()){
  const today=berlinDay(null,now);
  const upcoming=orders.filter(order=>order.appointment?.start && ['Termin verbindlich','In Arbeit'].includes(order.status) && Date.parse(order.appointment.start)>=now.getTime()-3600000);
  const todayCount=upcoming.filter(order=>berlinDay(order.appointment.start)===today).length;
  const next=upcoming.map(order=>order.appointment.start).sort()[0]??null;
  const nextTime=next?new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit'}).format(new Date(next)):'';
  return {todayCount,nextTime,openOffers:orders.filter(order=>order.status==='Angebot offen').length,prices:orders.filter(order=>order.status==='Preise prüfen').length};
}
export function followupDraft(order,now=new Date()){
  if(order.status!=='Angebot offen' || !order.offer?.createdAt) return null;
  if(Date.parse(order.offer.createdAt) > now.getTime()-3*86400000) return null;
  return `Guten Tag, ich möchte kurz nachfragen, ob das Angebot ${order.wg||''} noch passt. Es wird nichts versendet, bis du den Text selbst abschickst.`.replace(/\s+/g,' ').trim();
}
export function bankMatch(item,docs=[]){
  if(!item || item.classification?.documentId) return null;
  const hit=docs.find(doc=>doc.classification && doc.classification.amountMinor===item.amountMinor && !doc.classification.documentId);
  if(!hit) return null;
  return {filename:hit.filename||'Beleg',amountMinor:item.amountMinor};
}
