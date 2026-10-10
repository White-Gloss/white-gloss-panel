// Shared by the server and the owner UI. Signed originals are never rewritten.
export function agreedOffer(order) {
  if (!order.offer) return null;
  const approved=(order.amendments??[]).filter(item=>item.state==='accepted');
  return {...order.offer,
    totalCents:order.offer.totalCents+approved.reduce((sum,item)=>sum+item.amountCents,0),
    services:[order.offer.services,...approved.map(item=>'Nachtrag: '+item.services)].filter(Boolean).join('\n'),
    lines:[...(order.offer.lines??[{title:'Fahrzeugaufbereitung',description:order.offer.services,amountCents:order.offer.totalCents}]),...approved.map(item=>({title:'Freigegebener Nachtrag',description:item.services,amountCents:item.amountCents}))]};
}
export function protocolAllowed(order,kind,direct=false) {
  if (!['intake','return'].includes(kind)||order[kind]) return false;
  if (['Abgelehnt','Storniert','Abgelaufen','Bezahlt','Erledigt'].includes(order.status)) return false;
  if (kind==='return'&&(order.amendments??[]).some(item=>item.state==='open'&&Date.parse(item.expiresAt)>Date.now())) return false;
  return kind==='intake'?(order.status==='Termin verbindlich'||direct&&['Preise prüfen','Angebot offen','Angenommen'].includes(order.status)):(order.status==='In Arbeit'&&!!order.intake||direct);
}
export function dayBerlin(value=new Date()) {
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
}
export function todayTasks(orders,jobs=[],now=new Date()) {
  const today=dayBerlin(now),tasks=[];
  const add=(o,key,title,tab,priority,due)=>tasks.push({id:o.id+':'+key,orderId:o.id,wg:o.wg,customer:o.source.name,title,tab,priority,due});
  for(const o of orders){
    if(['Abgelehnt','Storniert','Abgelaufen'].includes(o.status))continue;
    if(o.status==='Preise prüfen')add(o,'price','Begutachtung und Preis prüfen','price',30,o.createdAt);
    if(o.status==='Angebot offen'&&!o.acceptance)add(o,'signature','Kundenunterschrift / Terminauswahl offen','appointment',40,o.offer?.expiresAt);
    if(o.status==='Termin verbindlich'&&!o.intake&&dayBerlin(o.appointment.start)<=today)add(o,'intake',dayBerlin(o.appointment.start)<today?'Annahme überfällig – Status prüfen':'Fahrzeug heute annehmen','intake',10,o.appointment.start);
    if(o.status==='In Arbeit'&&(!o.appointment||dayBerlin(o.appointment.end)<=today))add(o,'return','Rückgabe / Fertigstellung prüfen','return',20,o.appointment?.end);
    for(const [index,n] of (o.notes??[]).entries())if(n.followUp&&!n.completedAt&&n.followUp<=today)add(o,'followup-'+index,'Wiedervorlage: '+n.note,'notes',5,n.followUp);
    for(const a of o.amendments??[])if(a.state==='open')add(o,'amendment-'+a.id,Date.parse(a.expiresAt)<+new Date(now)?'Nachtrag abgelaufen':'Nachtragsfreigabe offen','amendments',35,a.expiresAt);
    for(const j of jobs.filter(j=>j.order_id===o.id&&['unknown','failed'].includes(j.state)))add(o,'job-'+j.id,'Versand / Verbindung prüfen: '+j.kind,'notes',0,j.updated_at);
  }
  return tasks.sort((a,b)=>a.priority-b.priority||String(a.due??'').localeCompare(String(b.due??'')));
}
