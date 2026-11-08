// Manual replies only: signed customer evidence, a bounded service window and a durable send reservation.
import {createHash,createHmac} from 'node:crypto';
import {AppError,need} from '../src/domain.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PHONE=/^\+[1-9]\d{7,14}$/;
const CUSTOMER_TYPES=new Set(['text','image','audio','video','document','sticker','location','contacts','interactive','button','order']);
const DAY=24*60*60*1000;
const configMatch='phone_number_id=? AND graph_version=? AND access_token=? AND app_secret=? AND verify_token=? AND updated_at=? AND verified_at IS ?';
const configValues=row=>[row.phone_number_id,row.graph_version,row.access_token,row.app_secret,row.verify_token,row.updated_at,row.verified_at];
const validUUID=value=>typeof value==='string'&&value.length===36&&UUID.test(value);
const providerId=value=>typeof value==='string'&&value===value.trim()&&/^wamid\.[\x21-\x7e]{1,1000}$/.test(value);
const digits=value=>typeof value==='string'&&value===value.trim()&&/^[1-9]\d{7,14}$/.test(value);
export class WhatsAppReplyNotSentError extends AppError {}
function timestamp(value,now){if(typeof value!=='string'||value!==value.trim()||!/^\d{1,12}$/.test(value))return null;const at=Number(value)*1000;return Number.isSafeInteger(at)&&at>0&&at<=now?at:null;}
export function customerReplyTime(message,now){return CUSTOMER_TYPES.has(message?.type)&&providerId(message.id)&&message.id.length<=180&&!message.is_echo&&!message.echo&&digits(message.from)?timestamp(message.timestamp,now):null;}

export async function whatsappReplySchema(env){
  const tables=[
    `CREATE TABLE IF NOT EXISTS whatsapp_outgoing(
      request_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,conversation_key TEXT NOT NULL,
      source_message_id TEXT NOT NULL REFERENCES whatsapp_messages(id),phone_number_id TEXT NOT NULL,
      recipient_phone TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,
      send_state TEXT NOT NULL CHECK(send_state IN ('pending','accepted','uncertain')),
      provider_message_id TEXT UNIQUE,completed_at TEXT)`,
    'CREATE INDEX IF NOT EXISTS whatsapp_outgoing_conversation ON whatsapp_outgoing(conversation_key,created_at)',
    'CREATE INDEX IF NOT EXISTS whatsapp_outgoing_pending ON whatsapp_outgoing(phone_number_id,recipient_phone,send_state)',
    `CREATE TABLE IF NOT EXISTS whatsapp_delivery_events(
      id TEXT PRIMARY KEY,phone_number_id TEXT NOT NULL,provider_message_id TEXT NOT NULL,recipient_phone TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('sent','delivered','read','failed')),status_at INTEGER NOT NULL,
      received_at TEXT NOT NULL,error_code INTEGER)`,
    'CREATE INDEX IF NOT EXISTS whatsapp_delivery_identity ON whatsapp_delivery_events(phone_number_id,provider_message_id,recipient_phone)',
    "CREATE TRIGGER IF NOT EXISTS no_whatsapp_delivery_update BEFORE UPDATE ON whatsapp_delivery_events BEGIN SELECT RAISE(ABORT,'WhatsApp-Statusnachweise sind unveränderlich'); END",
    "CREATE TRIGGER IF NOT EXISTS no_whatsapp_delivery_delete BEFORE DELETE ON whatsapp_delivery_events BEGIN SELECT RAISE(ABORT,'WhatsApp-Statusnachweise werden nicht gelöscht'); END",
    "CREATE TRIGGER IF NOT EXISTS no_whatsapp_outgoing_delete BEFORE DELETE ON whatsapp_outgoing BEGIN SELECT RAISE(ABORT,'WhatsApp-Versandnachweise werden nicht gelöscht'); END",
    `CREATE TRIGGER IF NOT EXISTS no_whatsapp_outgoing_content_update BEFORE UPDATE OF request_id,request_hash,conversation_key,source_message_id,phone_number_id,recipient_phone,body,created_at ON whatsapp_outgoing BEGIN SELECT RAISE(ABORT,'WhatsApp-Versandinhalt ist unveränderlich'); END`
  ];
  await env.DB.batch(tables.map(sql=>env.DB.prepare(sql)));
  const columns=(await env.DB.prepare('PRAGMA table_info(whatsapp_messages)').all()).results.map(column=>column.name);
  if(!columns.includes('reply_window_at'))await env.DB.prepare('ALTER TABLE whatsapp_messages ADD COLUMN reply_window_at INTEGER').run();
}

export function deliveryStatements(env,statuses,phoneNumberId,receivedAt){
  const result=[],now=Date.parse(receivedAt);
  for(const event of statuses){
    if(!providerId(event?.id)||!digits(event?.recipient_id)||!['sent','delivered','read','failed'].includes(event?.status))continue;
    const at=timestamp(event.timestamp,now);if(at===null)continue;
    const recipient='+'+event.recipient_id,code=event.status==='failed'&&Number.isSafeInteger(event.errors?.[0]?.code)&&event.errors[0].code>=0?event.errors[0].code:null;
    const id=createHash('sha256').update(JSON.stringify([phoneNumberId,event.id,recipient,event.status,at,code])).digest('hex');
    // Early statuses can arrive before the HTTP result. Keep at most 1000 unmatched events,
    // and only for a recipient with our own outstanding attempt. A read never matches by recipient alone.
    result.push(env.DB.prepare(`INSERT OR IGNORE INTO whatsapp_delivery_events(id,phone_number_id,provider_message_id,recipient_phone,status,status_at,received_at,error_code)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM whatsapp_outgoing WHERE phone_number_id=? AND provider_message_id=? AND recipient_phone=?)
      OR (EXISTS(SELECT 1 FROM whatsapp_outgoing WHERE phone_number_id=? AND recipient_phone=? AND send_state IN ('pending','uncertain'))
      AND (SELECT COUNT(*) FROM whatsapp_delivery_events e WHERE NOT EXISTS(SELECT 1 FROM whatsapp_outgoing o WHERE o.phone_number_id=e.phone_number_id AND o.provider_message_id=e.provider_message_id AND o.recipient_phone=e.recipient_phone))<1000)`)
      .bind(id,phoneNumberId,event.id,recipient,event.status,at,receivedAt,code,phoneNumberId,event.id,recipient,phoneNumberId,recipient));
  }
  return result;
}

async function deliveryView(env,row){
  const event=row.provider_message_id?await env.DB.prepare(`SELECT status,error_code FROM whatsapp_delivery_events WHERE phone_number_id=? AND provider_message_id=? AND recipient_phone=?
    ORDER BY CASE status WHEN 'read' THEN 4 WHEN 'delivered' THEN 3 WHEN 'failed' THEN 2 WHEN 'sent' THEN 1 END DESC,status_at DESC LIMIT 1`).bind(row.phone_number_id,row.provider_message_id,row.recipient_phone).first():null;
  return {id:row.request_id,requestId:row.request_id,providerMessageId:row.provider_message_id,direction:'outgoing',profileName:'White Gloss',messageType:'text',body:row.body,sentAt:new Date(row.created_at).toISOString(),receivedAt:new Date(row.created_at).toISOString(),hasMedia:false,sendState:row.send_state,deliveryStatus:event?.status??row.send_state,deliveryErrorCode:event?.error_code??null};
}
export async function outgoingReplyViews(env,key,synthetic){
  if(synthetic)return [];
  const rows=(await env.DB.prepare('SELECT * FROM whatsapp_outgoing WHERE conversation_key=? ORDER BY created_at DESC LIMIT 500').bind(key).all()).results;
  return Promise.all(rows.map(row=>deliveryView(env,row)));
}
async function customerContext(env,key,phoneNumberId,sourceMessageId){
  const recipients=(await env.DB.prepare('SELECT DISTINCT sender_phone FROM whatsapp_messages WHERE synthetic=0 AND conversation_key=? AND phone_number_id=?').bind(key,phoneNumberId).all()).results;
  if(recipients.length!==1||!PHONE.test(recipients[0].sender_phone))return null;
  const recipient=recipients[0].sender_phone;
  const latest=await env.DB.prepare('SELECT id,reply_window_at FROM whatsapp_messages WHERE synthetic=0 AND conversation_key=? AND phone_number_id=? AND sender_phone=? AND reply_window_at IS NOT NULL ORDER BY reply_window_at DESC LIMIT 1').bind(key,phoneNumberId,recipient).first();
  if(!latest)return null;
  if(sourceMessageId){const source=await env.DB.prepare('SELECT id FROM whatsapp_messages WHERE id=? AND synthetic=0 AND conversation_key=? AND phone_number_id=? AND sender_phone=? AND reply_window_at IS NOT NULL').bind(sourceMessageId,key,phoneNumberId,recipient).first();if(!source)return null;}
  return {recipient,sourceMessageId:sourceMessageId??latest.id,lastCustomerAt:latest.reply_window_at,windowExpiresAt:new Date(latest.reply_window_at+DAY).toISOString()};
}
export async function replyAvailability(env,settings,key,synthetic,review){
  const result={allowed:false,reason:'Wähle eine eingegangene Unterhaltung aus.',windowExpiresAt:null,recipient:null,sourceMessageId:null};
  if(review)return {...result,reason:'Im Meta-Prüfzugang sind direkte Antworten gesperrt.'};
  if(synthetic)return {...result,reason:'Im Testbereich werden keine echten Nachrichten gesendet.'};
  if(!key)return result;
  if(!settings?.phone_number_id||!settings?.access_token||!settings?.app_secret||!settings?.verify_token||!settings?.verified_at)return {...result,reason:'WhatsApp-Verbindung zuerst einrichten und erfolgreich prüfen.'};
  const context=await customerContext(env,key,settings.phone_number_id);if(!context)return {...result,reason:'Für diese Unterhaltung fehlt ein gültiger neuer Kundeneingang. Neue Unterhaltungen benötigen eine genehmigte Vorlage.'};
  Object.assign(result,{recipient:context.recipient,sourceMessageId:context.sourceMessageId,windowExpiresAt:context.windowExpiresAt});
  const unresolved=await env.DB.prepare("SELECT request_id FROM whatsapp_outgoing WHERE phone_number_id=? AND recipient_phone=? AND send_state IN ('pending','uncertain') LIMIT 1").bind(settings.phone_number_id,context.recipient).first();
  if(unresolved)return {...result,reason:'Ein vorheriger Versand ist noch offen oder unklar. Zuerst den Versand prüfen; es wird nicht erneut gesendet.'};
  if(context.lastCustomerAt>Date.now()||context.lastCustomerAt+DAY<=Date.now())return {...result,reason:'Das 24-Stunden-Antwortfenster ist geschlossen. Eine genehmigte Vorlage oder eine neue Kundennachricht ist erforderlich.'};
  return {...result,allowed:true,reason:'Direkte Antwort innerhalb von 24 Stunden nach der letzten Kundennachricht.'};
}

export async function sendWhatsAppReply(env,input,synthetic,loadCredentials){
  let attempted=false;
  try{
    need(!synthetic,'Im Testbereich werden keine echten WhatsApp-Nachrichten gesendet.',409);
    need(input.confirmed===true,'Bitte den manuellen Versand ausdrücklich bestätigen.');
    need(Object.keys(input).every(key=>['requestId','conversationKey','sourceMessageId','body','confirmed'].includes(key)),'Der Empfänger wird ausschließlich aus der gewählten Kundennachricht bestimmt.');
    need(validUUID(input.requestId)&&validUUID(input.sourceMessageId),'Versand-ID oder Kundennachricht ist ungültig.');
    need(typeof input.conversationKey==='string'&&input.conversationKey===input.conversationKey.trim()&&/^[0-9+]{6,30}$/.test(input.conversationKey),'WhatsApp-Unterhaltung nicht gefunden.',404);
    need(typeof input.body==='string'&&input.body.length<=4096&&input.body.trim().length>0&&!input.body.includes('\0'),'Eine Nachricht mit 1 bis 4096 Zeichen ist erforderlich.');
    const requestHash=createHmac('sha256',Buffer.from(env.CONFIG_KEY,'base64')).update('whatsapp-reply\0'+JSON.stringify({conversationKey:input.conversationKey,sourceMessageId:input.sourceMessageId,body:input.body})).digest('hex');
    const previous=await env.DB.prepare('SELECT * FROM whatsapp_outgoing WHERE request_id=?').bind(input.requestId).first();
    if(previous){attempted=true;need(previous.request_hash===requestHash,'Diese Versand-ID gehört bereits zu einem anderen Inhalt.',409);need(previous.send_state==='accepted','Dieser Versand ist noch offen oder unklar. Nicht erneut senden; zuerst den Versand prüfen.',409);return {ok:true,accepted:true,duplicate:true,outgoing:await deliveryView(env,previous),message:'Die Nachricht wurde bereits von Meta angenommen.'};}
    const {row,accessToken}=await loadCredentials();need(row.verified_at,'WhatsApp-Verbindung zuerst erfolgreich prüfen.',409);need(row.graph_version===row.graph_version.trim()&&/^v\d{1,3}\.\d{1,2}$/.test(row.graph_version),'Gespeicherte Graph-Version ist ungültig.',409);
    const context=await customerContext(env,input.conversationKey,row.phone_number_id,input.sourceMessageId);need(context,'Die gewählte Kundennachricht gehört nicht eindeutig zur aktuellen WhatsApp-Verbindung.',409);
    const now=Date.now();need(context.lastCustomerAt<=now&&context.lastCustomerAt+DAY>now,'Das 24-Stunden-Antwortfenster ist geschlossen. Eine genehmigte Vorlage oder eine neue Kundennachricht ist erforderlich.',409);
    const reserved=await env.DB.prepare(`INSERT INTO whatsapp_outgoing(request_id,request_hash,conversation_key,source_message_id,phone_number_id,recipient_phone,body,created_at,send_state)
      SELECT ?,?,?,?,?,?,?,?,'pending' WHERE EXISTS(SELECT 1 FROM whatsapp_settings WHERE id=1 AND ${configMatch})
      AND NOT EXISTS(SELECT 1 FROM whatsapp_outgoing WHERE phone_number_id=? AND recipient_phone=? AND send_state IN ('pending','uncertain')) ON CONFLICT(request_id) DO NOTHING`)
      .bind(input.requestId,requestHash,input.conversationKey,input.sourceMessageId,row.phone_number_id,context.recipient,input.body,now,...configValues(row),row.phone_number_id,context.recipient).run();
    if(reserved.meta.changes!==1){const existing=await env.DB.prepare('SELECT request_id FROM whatsapp_outgoing WHERE request_id=?').bind(input.requestId).first();attempted=Boolean(existing);throw new AppError('Ein Versand ist bereits offen oder die Verbindung wurde geändert. Zuerst den Verlauf neu laden.',409);}
    attempted=true;
    const config={phoneNumberId:row.phone_number_id,graphVersion:row.graph_version,accessToken},payload={messaging_product:'whatsapp',recipient_type:'individual',to:context.recipient,type:'text',text:{preview_url:false,body:input.body}};
    try{
      let result;
      if(env.WHATSAPP_ADAPTERS?.sendReply)result=await env.WHATSAPP_ADAPTERS.sendReply(config,payload);
      else {const fetched=await fetch(`https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`,{method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'manual',signal:AbortSignal.timeout(15000)});need(fetched.ok,'Meta hat den Versand nicht bestätigt.',502);result=await fetched.json();}
      const id=result?.messages?.[0]?.id;need(Array.isArray(result?.messages)&&result.messages.length===1&&providerId(id),'Meta hat keine gültige Nachrichten-ID bestätigt.',502);
      const saved=await env.DB.prepare("UPDATE whatsapp_outgoing SET send_state='accepted',provider_message_id=?,completed_at=? WHERE request_id=? AND send_state='pending'").bind(id,new Date().toISOString(),input.requestId).run();need(saved.meta.changes===1,'Die Versandbestätigung konnte nicht gespeichert werden.',502);
      const outgoing=await env.DB.prepare('SELECT * FROM whatsapp_outgoing WHERE request_id=?').bind(input.requestId).first();
      return {ok:true,accepted:true,duplicate:false,outgoing:await deliveryView(env,outgoing),message:'Meta hat die Nachricht angenommen. Die Zustellung wird separat bestätigt.'};
    }catch{
      await env.DB.prepare("UPDATE whatsapp_outgoing SET send_state='uncertain',completed_at=? WHERE request_id=? AND send_state='pending'").bind(new Date().toISOString(),input.requestId).run().catch(()=>{});
      throw new AppError('Der Versand konnte nicht eindeutig bestätigt werden. Der Versuch bleibt gespeichert und wird nicht automatisch wiederholt.',502);
    }
  }catch(error){
    if(!attempted&&error instanceof AppError){
      // Even malformed retries must not claim that a pre-existing attempt was never sent.
      const prior=validUUID(input.requestId)?await env.DB.prepare('SELECT request_id FROM whatsapp_outgoing WHERE request_id=?').bind(input.requestId).first():null;
      if(!prior)throw new WhatsAppReplyNotSentError(error.message,error.status);
    }
    throw error;
  }
}
