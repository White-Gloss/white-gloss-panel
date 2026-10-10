import {AppError,need,text,berlinISO} from '../src/domain.mjs';
import {customerOrderStatus,customerLinkAllowed} from '../src/customer-access.mjs';
import {recordOperationIssue} from '../src/operations.mjs';
import {getOrder,saveOrder} from '../src/worker.mjs';
import {requirePanelOwner,panelJSON} from './customer-create.mjs';
import {digest} from './auth.mjs';

async function links(env,order){
  const offers=(await env.DB.prepare('SELECT hash,expires_at,revoked FROM offer_tokens WHERE order_id=?').bind(order.id).all()).results;
  const handovers=(await env.DB.prepare('SELECT hash,kind,revoked FROM handover_tokens WHERE order_id=?').bind(order.id).all()).results;
  const out=[];
  for(const row of [...offers.map(row=>({...row,type:'offer'})),...handovers.map(row=>({...row,type:'handover',expires_at:null}))]){
    const control=await env.DB.prepare('SELECT * FROM customer_link_controls WHERE hash=?').bind(row.hash).first();
    const amendment=(order.amendments??[]).find(item=>digest(item.token)===row.hash),handover=Object.entries(order.handovers??{}).find(([,value])=>digest(value.token)===row.hash);
    const token=amendment?.token??handover?.[1].token??(order.offerToken&&digest(order.offerToken)===row.hash?order.offerToken:null);
    const effective=[row.expires_at,control?.expires_at].filter(Boolean).sort()[0]??null;
    out.push({hash:row.hash,type:row.type,label:amendment?'Nachtrag':handover?'Fahrzeug'+(handover[0]==='intake'?'annahme':'abgabe'):'Angebot',url:token?'/'+(row.type==='offer'?'angebot':'protokoll')+'/'+token:null,version:control?.version??0,expiresAt:effective,baseExpiresAt:row.expires_at,revoked:!!row.revoked||!!control?.revoked,active:!row.revoked&&(!row.expires_at||Date.parse(row.expires_at)>Date.now())&&await customerLinkAllowed(env,row.hash),legacy:!control&&row.type==='handover'});
  }
  return out;
}
async function view(env,order){return {id:order.id,version:order.version,customerStatus:customerOrderStatus(order),portalUrl:'/kundenportal',pickupRelease:order.pickupRelease?{released:order.pickupRelease.released,at:order.pickupRelease.at,instructions:order.pickupRelease.instructions??''}:null,canRelease:!recordOperationIssue(order)&&['In Arbeit','Erledigt','Bezahlt'].includes(order.status)&&!order.return?.signaturesConfirmed,links:await links(env,order)};}
export async function customerAccessEndpoint(env,request,identity){
  const url=new URL(request.url);if(url.pathname!=='/api/customer-access')return null;requirePanelOwner(env,identity);
  const order=await getOrder(env,url.searchParams.get('id'));
  if(request.method==='GET')return Response.json(await view(env,order));
  const input=await panelJSON(env,request);need(input.version===order.version,'Auftrag wurde geändert. Bitte neu laden.',409);
  if(input.action==='pickup'){
    need(typeof input.released==='boolean'&&input.confirmed===true,'Freigabe oder Rücknahme bitte ausdrücklich bestätigen.');
    if(input.released)need(!recordOperationIssue(order)&&['In Arbeit','Erledigt','Bezahlt'].includes(order.status)&&!order.return?.signaturesConfirmed,'Abholfreigabe erst für ein bearbeitetes, noch nicht übergebenes Fahrzeug.',409);
    const at=new Date().toISOString(),release={released:input.released,at,identity,instructions:text(input.instructions,1200)},updated={...order,pickupRelease:release,pickupReleaseHistory:[...(order.pickupReleaseHistory??[]),release]};
    await saveOrder(env,updated,order.version,input.released?'Fahrzeug nach persönlicher Prüfung zur Abholung freigegeben':'Abholfreigabe zurückgenommen','owner');
    return Response.json(await view(env,await getOrder(env,order.id)));
  }
  need(input.action==='link','Unbekannte Zugangsänderung.');need(input.confirmed===true,'Konkreten Link und Auswirkung bitte bestätigen.');
  const link=(await links(env,order)).find(item=>item.hash===input.hash);need(link,'Kundenlink nicht gefunden.',404);
  need(input.linkVersion===link.version,'Kundenlink wurde geändert. Bitte neu laden.',409);
  need(typeof input.revoked==='boolean','Linkstatus fehlt.');
  const now=new Date().toISOString(),expiresAt=input.expiresLocal?berlinISO(input.expiresLocal):typeof input.expiresAt==='string'?input.expiresAt:'';
  need(Number.isFinite(Date.parse(expiresAt))&&(input.revoked||Date.parse(expiresAt)>Date.now())&&Date.parse(expiresAt)<=Date.now()+366*86400000,'Eine zukünftige Zugangsfrist von höchstens einem Jahr angeben.');
  const expiry=new Date(expiresAt).toISOString();need(!link.baseExpiresAt||Date.parse(expiry)<=Date.parse(link.baseExpiresAt),'Ein Kundenlink darf die ursprüngliche Angebotsfrist nicht verlängern.');
  const record={hash:link.hash,version:link.version+1,expiresAt:expiry,revoked:input.revoked,at:now},updated={...order,customerLinkHistory:[...(order.customerLinkHistory??[]),{...record,identity}]};
  const extra=[env.DB.prepare('INSERT INTO customer_access_guard SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END'),env.DB.prepare('INSERT INTO customer_access_guard SELECT CASE WHEN COALESCE((SELECT version FROM customer_link_controls WHERE hash=?),0)=? THEN 1 ELSE 0 END').bind(link.hash,link.version),env.DB.prepare('INSERT INTO customer_link_controls VALUES(?,?,?,?,?) ON CONFLICT(hash) DO UPDATE SET version=excluded.version,expires_at=excluded.expires_at,revoked=excluded.revoked,updated_at=excluded.updated_at').bind(link.hash,record.version,expiry,Number(input.revoked),now),env.DB.prepare('DELETE FROM customer_access_guard')];
  try{await saveOrder(env,updated,order.version,input.revoked?'Persönlichen Kundenlink widerrufen':'Persönliche Kundenlinkfrist gespeichert','owner',extra);}catch(error){if(/CHECK constraint/.test(error.message))throw new AppError('Auftrag oder Kundenlink inzwischen geändert. Bitte neu laden.',409);throw error;}
  return Response.json(await view(env,await getOrder(env,order.id)));
}
