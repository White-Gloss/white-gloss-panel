import {need,text,CLOSED_STATES} from './domain.mjs';

export const isTrashedOrder=order=>Boolean(order?.trash?.deletedAt);

// Removing an order from the working lists never removes its retained originals.
export function transitionOrderTrash(order,action,input={},now=new Date().toISOString(),role='owner'){
  need(role==='owner','Nur der Betreiber darf Aufträge löschen oder wiederherstellen.',403);
  need(['deleteOrder','restoreOrder'].includes(action),'Unbekannte Papierkorb-Aktion.');
  const o=structuredClone(order);
  if(action==='deleteOrder'){
    need(!isTrashedOrder(o),'Dieser Auftrag liegt bereits im Papierkorb.',409);
    o.trash={deletedAt:now,actor:role,reason:text(input.reason,1000)};
    o.trashHistory=[...(o.trashHistory??[]),{...o.trash,action:'deleteOrder'}];
    // These are operational customer links, not signed document content. Remove
    // them from the working view while retaining their revoked database rows.
    delete o.offerToken;
    for(const pending of Object.values(o.pending??{}))delete pending.token;
  }else{
    need(isTrashedOrder(o),'Dieser Auftrag liegt nicht im Papierkorb.',409);
    o.trashHistory=[...(o.trashHistory??[]),{action:'restoreOrder',at:now,actor:role,deletedAt:o.trash.deletedAt}];
    delete o.trash;
  }
  o.updatedAt=now;
  return o;
}

// Every related change depends on the versioned order write in the same batch.
// Optional IONOS tables are discovered so the same module also works in the Sites worker.
export async function orderTrashStatements(env,updated,action,operationId,version){
  need(['deleteOrder','restoreOrder'].includes(action),'Unbekannte Papierkorb-Aktion.');
  const guard="EXISTS(SELECT 1 FROM orders WHERE id=? AND version=? AND json_extract(data,'$.operationId')=?)";
  const guarded=[updated.id,version,operationId],statements=[];
  if(action==='restoreOrder'){
    if(updated.appointment&&!CLOSED_STATES.includes(updated.status)){
      const {start,end}=updated.appointment;
      need(start&&end&&Number.isFinite(Date.parse(start))&&Date.parse(start)<Date.parse(end),'Der gespeicherte Termin ist ungültig. Bitte vor der Wiederherstellung prüfen.',409);
      const conflict=await env.DB.prepare('SELECT order_id FROM appointments WHERE start<? AND end>? AND order_id!=?').bind(end,start,updated.id).first();
      need(!conflict,'Der gespeicherte Termin überschneidet sich mit einem anderen Auftrag. Bitte dessen Termin zuerst ändern.',409);
      statements.push(env.DB.prepare('INSERT INTO appointments(order_id,start,end) SELECT ?,?,? WHERE '+guard+' ON CONFLICT(order_id) DO UPDATE SET start=excluded.start,end=excluded.end').bind(updated.id,start,end,...guarded));
    }
    return statements;
  }
  const unsettled=await env.DB.prepare("SELECT kind,state FROM jobs WHERE order_id=? AND state IN ('pending','unknown','draft') LIMIT 1").bind(updated.id).first();
  need(!unsettled,'Eine Anbieteraktion ist noch nicht bestätigt. Bitte zuerst lesend abgleichen und danach löschen.',409);
  const rows=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),tables=new Set(rows.results.map(row=>row.name));
  for(const table of ['offer_tokens','document_requests','invoice_tokens']){
    if(tables.has(table))statements.push(env.DB.prepare('UPDATE '+table+' SET revoked=1 WHERE order_id=? AND '+guard).bind(updated.id,...guarded));
  }
  if(tables.has('chat_threads'))statements.push(env.DB.prepare('UPDATE chat_threads SET closed=1,token_expires_at=? WHERE order_id=? AND '+guard).bind(updated.trash.deletedAt,updated.id,...guarded));
  statements.push(env.DB.prepare("UPDATE jobs SET state='paused',updated_at=? WHERE order_id=? AND state IN ('queued','failed') AND "+guard).bind(updated.trash.deletedAt,updated.id,...guarded));
  statements.push(env.DB.prepare('DELETE FROM appointments WHERE order_id=? AND '+guard).bind(updated.id,...guarded));
  return statements;
}

// Only the owner's explicit retry releases the matching paused work. Nothing is
// requeued by restoring an order or by the scheduled maintenance process.
export async function resumePausedOrderJobs(env,order,action,input={}){
  need(!isTrashedOrder(order),'Auftrag liegt im Papierkorb. Bitte zuerst wiederherstellen.',409);
  let match=null,values=[];
  if(action==='sendOffer'&&order.offerToken){
    const tokenHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(order.offerToken)))).map(value=>value.toString(16).padStart(2,'0')).join('');
    match='kind=?';values=['offer-'+tokenHash];
  }
  if(action==='invoice'){match='kind=?';values=['invoice'];}
  if(action==='invoiceMail'){match='kind=?';values=['invoice-mail'];}
  if(action==='sendDocument'&&order.pending?.[input.kind]){
    const pending=order.pending[input.kind];match='kind=?';values=['document-'+input.kind+'-'+(pending.requestId??pending.createdAt)];
  }
  if(action==='calendarSync'){
    // Calendar job identities depend on the current appointment; the provider
    // claims only that identity and cannot revive an obsolete appointment.
    return;
  }
  if(!match)return;
  await env.DB.prepare("UPDATE jobs SET state='failed',updated_at=? WHERE order_id=? AND state='paused' AND "+match+" AND EXISTS(SELECT 1 FROM orders WHERE id=? AND version=? AND json_extract(data,'$.trash.deletedAt') IS NULL)").bind(new Date().toISOString(),order.id,...values,order.id,order.version).run();
}
