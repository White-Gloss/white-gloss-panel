import {createHash} from 'node:crypto';
import {need,paidCents} from '../src/domain.mjs';
import {validDay} from './accounting.mjs';
import {BOOK_TOKEN} from './bookkeeping-schema.mjs';
export const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export const bankKey=r=>'bank:'+JSON.stringify([r.organization_id,r.account_iban,r.provider_id]);
export const day=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)):null;
export const monthValid=month=>typeof month==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(month);
export async function token(env){return (await env.DB.prepare('SELECT '+BOOK_TOKEN+' AS value').first()).value;}
async function rows(env,sql){const all=(await env.DB.prepare(sql+' LIMIT 10001').all()).results;need(all.length<=10000,'Mehr als 10.000 Datensätze: Monatsprüfung muss vor weiterer Verarbeitung erweitert werden. Es wurde nichts abgeschnitten.',409);return all;}
export async function bookData(env){
  for(let attempt=0;attempt<3;attempt++){
    const version=await token(env);
    const orders=await rows(env,'SELECT * FROM orders WHERE synthetic=0 ORDER BY id');
    const documents=await rows(env,`SELECT d.*,c.version,c.amount_minor,c.document_date,c.partner,c.category,c.payment_path FROM accounting_documents d LEFT JOIN accounting_classifications c ON c.id=(SELECT id FROM accounting_classifications WHERE document_id=d.id ORDER BY version DESC LIMIT 1) WHERE d.synthetic=0 ORDER BY d.id`);
    const bank=await rows(env,`SELECT r.*,c.version AS classification_version,c.category,c.document_id,c.note AS classification_note FROM accounting_bank_revisions r LEFT JOIN accounting_bank_classifications c ON c.id=(SELECT id FROM accounting_bank_classifications WHERE bank_revision_id=r.revision_id ORDER BY version DESC LIMIT 1) WHERE r.revision_id IN (SELECT max(revision_id) FROM accounting_bank_revisions GROUP BY organization_id,account_iban,provider_id) ORDER BY r.revision_id`);
    const resolutions=await rows(env,'SELECT * FROM book_resolutions ORDER BY id');
    const entries=(await rows(env,'SELECT * FROM book_entries ORDER BY rowid')).map(r=>({...r,data:JSON.parse(r.data)}));
    const matches=await rows(env,'SELECT m.* FROM book_matches m WHERE NOT EXISTS(SELECT 1 FROM book_match_reversals r WHERE r.match_id=m.id) ORDER BY m.id');
    const periods=await rows(env,'SELECT * FROM book_periods ORDER BY id');
    const exports=await rows(env,'SELECT id,period_id,month,filename,sha256,entry_count FROM book_exports ORDER BY rowid');
    const exported=new Set((await rows(env,'SELECT entry_id FROM book_export_entries ORDER BY entry_id')).map(r=>r.entry_id));
    const pending=await rows(env,`SELECT p.target_kind,CASE WHEN p.target_kind='bank' THEN CAST((SELECT max(n.revision_id) FROM accounting_bank_revisions old JOIN accounting_bank_revisions n ON n.organization_id=old.organization_id AND n.account_iban=old.account_iban AND n.provider_id=old.provider_id WHERE CAST(old.revision_id AS TEXT)=p.target_id) AS TEXT) ELSE p.target_id END AS target_id FROM advisor_proposals p WHERE NOT EXISTS(SELECT 1 FROM advisor_decisions d WHERE d.proposal_id=p.id) ORDER BY p.id`);
    const settings=await env.DB.prepare('SELECT * FROM book_settings ORDER BY id DESC LIMIT 1').first();
    if(version!==await token(env))continue;
    const sources=[],invoices=[],orderMap=new Map();
    function add(value){sources.push({...value,hash:hash(value)});}
    for(const r of documents)add({key:'document:'+r.id,kind:'document',id:r.id,label:r.filename,date:r.document_date??day(r.received_at),amount:r.amount_minor,currency:'EUR',missing:!r.document_date||!r.amount_minor,revision:r.version??0,original:r.sha256,category:r.category,paymentPath:r.payment_path});
    for(const r of bank){const date=day(r.settled_at);add({key:bankKey(r),kind:'bank',id:String(r.revision_id),label:r.label+' · '+r.reference,date,amount:r.amount_minor,currency:r.currency,side:r.side,status:r.status,revision:r.revision_id,account:r.account_iban,classification:r.classification_version?{version:r.classification_version,category:r.category,documentId:r.document_id,note:r.classification_note}:null,missing:r.status==='completed'&&!date});}
    for(const row of orders){
      const o={...JSON.parse(row.data),id:row.id,wg:row.wg,version:row.version,status:row.status};orderMap.set(o.id,o);
      const all=[...(o.invoiceHistory??[]),...(o.invoice?[o.invoice]:[])],seen=new Set();
      for(const i of all){if(!i.id||seen.has(i.id))continue;seen.add(i.id);const canceled=['canceled','cancelled','void','voided'].includes(i.status),current=i.id===o.invoice?.id;
        add({key:'invoice:'+o.id+':'+i.id,kind:'invoice',id:i.id,orderId:o.id,label:i.number??o.wg,date:validDay(i.issueDate)?i.issueDate:null,amount:i.totalCents??null,currency:i.currency??'EUR',canceled,missing:!validDay(i.issueDate)||!Number.isSafeInteger(i.totalCents)});
        if(current&&!canceled)invoices.push({orderId:o.id,invoiceId:i.id,number:i.number??o.wg,customer:o.source?.name??'',total:i.totalCents,paid:paidCents(o),open:Math.max(0,(i.totalCents??0)-paidCents(o)),version:o.version,payments:(o.payments??[]).filter(p=>!p.cancelledAt).map(p=>({id:p.id,amount:p.amountCents,at:p.at,method:p.method,matched:matches.some(m=>m.order_id===o.id&&m.payment_id===p.id)}))});
      }
      for(const p of o.payments??[])add({key:'payment:'+o.id+':'+p.id,kind:'payment',id:p.id,orderId:o.id,label:o.wg+' · '+p.method,date:day(p.at),amount:p.amountCents,currency:'EUR',canceled:!!p.cancelledAt,method:p.method,missing:!day(p.at)});
    }
    return {version,sources,orders:orderMap,invoices,bank,resolutions,entries,matches,periods,exports,exported,pending,settings:settings?JSON.parse(settings.data):null};
  }
  need(false,'Daten wurden während der Prüfung geändert. Bitte neu laden.',409);
}
export function lastResolution(data,key){return data.resolutions.filter(r=>r.source_key===key).at(-1);}
export function lastPeriod(data,month){return data.periods.filter(p=>p.month===month).at(-1);}
export function openMonth(data,month){need(monthValid(month),'Monat ungültig.');need(lastPeriod(data,month)?.kind!=='close','Monat ist abgeschlossen. Für eine Korrektur zuerst mit Begründung wieder öffnen.',409);}
export function openPositions(data,month){
  const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10),items=[];
  for(const o of data.orders.values()){
    const invoices=[...new Map([...(o.invoiceHistory??[]),...(o.invoice?[o.invoice]:[])].map(i=>[i.id,i])).values()].filter(i=>validDay(i.issueDate)&&i.issueDate<=end).sort((a,b)=>a.issueDate.localeCompare(b.issueDate));
    const i=invoices.at(-1);if(!i)continue;
    const canceled=['canceled','cancelled','void','voided'].includes(i.status),canceledDay=day(i.canceledAt??i.cancelledAt);
    if(canceled&&canceledDay&&canceledDay<=end)continue;
    let paid=0,corrected=false;for(const payment of o.payments??[]){
      // paymentEdit records the previous snapshot at each change. Reconstruct
      // the value before later corrections, then apply the payment's value date.
      const previous=(payment.history??[]).filter(h=>day(h.changedAt)>end).sort((a,b)=>a.changedAt.localeCompare(b.changedAt))[0],p=previous??payment;
      if(previous&&JSON.stringify([previous.amountCents,previous.at,previous.cancelledAt??null])!==JSON.stringify([payment.amountCents,payment.at,payment.cancelledAt??null])&&(day(previous.at)<=end||day(payment.at)<=end))corrected=true;
      if(day(p.at)&&day(p.at)<=end&&(!p.cancelledAt||day(p.cancelledAt)>end))paid+=p.amountCents;
    }
    const uncertain=canceled&&!canceledDay||corrected;
    items.push({orderId:o.id,invoiceId:i.id,number:i.number??o.wg,issueDate:i.issueDate,total:i.totalCents,paid:uncertain?null:paid,open:uncertain?null:Math.max(0,i.totalCents-paid),credit:uncertain?null:Math.max(0,paid-i.totalCents),uncertain,reason:uncertain?(corrected?'Zahlung nach dem Stichtag korrigiert. Offenen Betrag zum Stichtag manuell nachweisen.':'Historischer Storno ohne belegten Zeitpunkt. Offenen Betrag zum Stichtag manuell nachweisen.'):null});
  }
  return {cutoff:end,items};
}
export function monthView(data,month){
  need(monthValid(month),'Monat ungültig.');const sources=data.sources.filter(s=>s.date?.startsWith(month+'-')||s.missing&&!s.date||data.matches.some(m=>m.month===month&&m.bank_key===s.key)||(lastResolution(data,s.key)?.month===month&&lastResolution(data,s.key)?.kind==='post'));
  const problems=[],items=[];for(const s of sources){
    const resolution=lastResolution(data,s.key),resolved=resolution&&resolution.kind!=='reverse'&&resolution.source_hash===s.hash;
    const inactive=s.kind==='bank'&&s.status!=='completed'||s.canceled;
    if(!resolved&&!inactive)problems.push(s.label+': Buchung oder begründete Ausnahme fehlt.');
    if(resolution?.kind==='post'&&(resolution.source_hash!==s.hash||inactive))problems.push(s.label+': Quelle geändert; Buchung prüfen und stornieren.');
    const links=data.matches.filter(m=>m.bank_key===s.key),sum=links.reduce((v,m)=>v+m.amount,0);
    if(s.kind==='bank'){
      if(s.status==='completed'&&(sum!==s.amount||links.some(m=>m.bank_revision!==s.revision)))problems.push(s.label+': Bankabgleich unvollständig oder veraltet.');
      if(s.status!=='completed'&&links.length)problems.push(s.label+': Abgleich trotz geändertem Bankstatus; Zuordnung lösen.');
    }
    if(data.pending.some(p=>p.target_kind===s.kind&&p.target_id===s.id))problems.push(s.label+': Kanzleivorschlag noch nicht entschieden.');
    items.push({...s,resolution:resolution?{id:resolution.id,kind:resolution.kind,reason:resolution.reason,stale:resolution.source_hash!==s.hash}:null,matches:links,remaining:s.kind==='bank'?s.amount-sum:null});
  }
  // A provider revision may move an already posted transaction to another month.
  for(const r of data.resolutions.filter(r=>r.month===month&&r.kind==='post'&&lastResolution(data,r.source_key)?.id===r.id)){
    const s=data.sources.find(s=>s.key===r.source_key);if(!s||s.hash!==r.source_hash){if(!sources.some(x=>x.key===r.source_key))problems.push('Gebuchte Quelle wurde in einen anderen Zeitraum verschoben: '+r.source_key);}
  }
  for(const m of data.matches.filter(m=>m.month===month)){const s=data.sources.find(s=>s.key===m.bank_key);if(!s||s.revision!==m.bank_revision||s.status!=='completed')problems.push('Bankzuordnung '+m.id+': Anbieterstand geändert.');}
  const entries=data.entries.filter(e=>e.month===month),period=lastPeriod(data,month);
  const positions=openPositions(data,month);
  const evidence={month,sources:items.map(s=>({key:s.key,hash:s.hash,resolution:s.resolution?.id??null})),entries:entries.map(e=>e.id),matches:data.matches.filter(m=>m.month===month).map(m=>m.id).sort(),positions,problems};
  const fingerprint=hash(evidence),changed=period?.kind==='close'&&JSON.parse(period.snapshot).fingerprint!==fingerprint;
  const displayPositions=period?.kind==='close'&&!changed?{...positions,items:JSON.parse(period.snapshot).invoices.map(i=>({...i,uncertain:false}))}:positions;
  return {month,items,problems,entries,positions:displayPositions,period:period?{id:period.id,kind:period.kind,sha256:period.sha256,changed}:null,fingerprint,evidence,exports:data.exports.filter(e=>e.month===month)};
}
