import {need} from './domain.mjs';
import {isTrashedOrder} from './order-trash.mjs';

// Preserve the active release's restrictions without changing its retained originals.
export function recordOperationIssue(order,action='operate'){
  if(['deleteOrder','restoreOrder'].includes(action))return null;
  if(isTrashedOrder(order)&&!['read','read-original'].includes(action))return 'Dieser Auftrag liegt im Papierkorb. Kundenlinks, Änderungen und Versand sind gesperrt. Bitte zuerst wiederherstellen; aufbewahrte Originale bleiben lesbar.';
  if(['read','read-original','reconcile','note','vehicleCare','followUpDone','cancel','calendarCancel'].includes(action))return null;
  if(['blocked','anonymized'].includes(order.recordsRestriction?.status))return 'Diese Kundenakte ist gesperrt. Neue Vorgänge, Kundenkommunikation und finanzielle Aktionen sind gesperrt; aufbewahrte Originale bleiben lesbar.';
  if((order.documentCancellations??[]).length)return 'Ein bestätigtes Dokument dieses Vorgangs wurde storniert. Folgeaktionen benötigen einen geprüften Ersatzvorgang; Originale und Zahlungen bleiben erhalten.';
  return null;
}
export function assertRecordOperation(order,action='operate'){
  const issue=recordOperationIssue(order,action);need(!issue,issue,409);
}
// Provider writes must see the latest IONOS SQLite state in the same turn as fetch.
// Immutable confirmations may be delivered for an older version, but never after a block or cancellation.
export function assertCurrentRecordOperation(env,order,action='operate',expectedVersion=null){
  need(env.DB.sql?.prepare,'Die unmittelbare Prüfung der Auftragsfreigabe ist nicht verfügbar; keine Anbieteränderung.',503);
  const row=env.DB.sql.prepare('SELECT data,version FROM orders WHERE id=?').get(order.id);
  need(row,'Auftrag nicht gefunden.',404);
  need(expectedVersion===null||row.version===expectedVersion,'Auftrag wurde vor der Anbieteränderung verändert. Bitte neu öffnen.',409);
  assertRecordOperation(JSON.parse(row.data),action);
}
