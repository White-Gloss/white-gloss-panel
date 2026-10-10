import {need} from './domain.mjs';

export const customerAccessIdentity=value=>String(value??'').trim().toLowerCase();
// The extension hook must return an explicit denied result for an assigned
// company order. Only an unassigned order may use the private-account fallback.
export async function customerAccessResolve(env,order,identity,operation='read',options={}){
  const email=customerAccessIdentity(identity);
  if(env.customerOrderAccess){const delegated=await env.customerOrderAccess(env,order,email,operation,options);if(delegated!==null&&delegated!==undefined)return delegated;}
  const protocol=options.protocolKind?(order.handovers?.[options.protocolKind]?.protocol??order[options.protocolKind]):null;
  const protocolAllowed=!options.protocolKind||(!order.handovers?.[options.protocolKind]&&protocol?.workflow!=='remote')||customerAccessIdentity(protocol?.customerEmail)===email;
  return {allowed:!!email&&customerAccessIdentity(order.source.email)===email&&protocolAllowed,scope:'private',identity:email,orderId:order.id,operation,protocolKind:options.protocolKind??null};
}
export async function customerAccessRequire(env,order,identity,operation='read',options={}){
  const access=await customerAccessResolve(env,order,identity,operation,options);need(access.allowed,'Vorgang nicht gefunden.',404);return access;
}
export function customerAccessGuards(env,access){
  if(access.scope!=='private')return env.customerOrderAccessGuards?.(env,access)??[env.DB.prepare('INSERT INTO customer_access_guard VALUES(0)')];
  const protocolGuard=access.protocolKind?" AND (lower(trim(COALESCE(json_extract(data,?),json_extract(data,?),'')))=? OR (json_extract(data,?) IS NULL AND COALESCE(json_extract(data,?), '')<>'remote'))":'';
  return [env.DB.prepare("INSERT INTO customer_access_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM orders WHERE id=? AND lower(trim(json_extract(data,'$.source.email')))=?"+protocolGuard+') THEN 1 ELSE 0 END').bind(access.orderId,access.identity,...(access.protocolKind?['$.handovers.'+access.protocolKind+'.protocol.customerEmail','$.'+access.protocolKind+'.customerEmail',access.identity,'$.handovers.'+access.protocolKind,'$.'+access.protocolKind+'.workflow']:[])),env.DB.prepare('DELETE FROM customer_access_guard')];
}
export async function customerLinkAllowed(env,hash,now=Date.now()){
  const rule=await env.DB.prepare('SELECT expires_at,revoked FROM customer_link_controls WHERE hash=?').bind(hash).first();
  return !rule||(!rule.revoked&&Date.parse(rule.expires_at)>now);
}
export function customerLinkGuards(env,hash,type='handover'){
  const table=type==='offer'?'offer_tokens':'handover_tokens',expiry=type==='offer'?" AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')":'';
  return [env.DB.prepare("INSERT INTO customer_access_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM "+table+' WHERE hash=? AND revoked=0'+expiry+") AND NOT EXISTS(SELECT 1 FROM customer_link_controls WHERE hash=? AND (revoked=1 OR expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))) THEN 1 ELSE 0 END").bind(hash,hash),env.DB.prepare('DELETE FROM customer_access_guard')];
}
export function customerOrderStatus(order){
  if(['blocked','anonymized'].includes(order.recordsRestriction?.status)||order.documentCancellations?.length)return 'Rücksprache erforderlich';
  if(['Abgelehnt','Storniert','Abgelaufen'].includes(order.status))return order.status;
  if(order.return?.signaturesConfirmed)return 'Fahrzeug übergeben';
  if(order.pickupRelease?.released===true&&['In Arbeit','Erledigt','Bezahlt'].includes(order.status))return 'Abholbereit';
  return ({'Preise prüfen':'Anfrage eingegangen','Angebot offen':'Angebot zur Prüfung','Angenommen':'Angenommen · Termin wird vereinbart','Termin verbindlich':'Termin bestätigt','In Arbeit':'Fahrzeug in Bearbeitung','Erledigt':'Arbeiten abgeschlossen','Bezahlt':'Auftrag abgeschlossen'})[order.status]??'Rücksprache erforderlich';
}
