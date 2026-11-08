import {need} from '../src/domain.mjs';
import {assertRecordOperation,assertCurrentRecordOperation} from '../src/record-compat.mjs';

export async function mailOrderSchema(env){
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS mail_order_links(message_id TEXT PRIMARY KEY REFERENCES mail_messages(id),order_id TEXT NOT NULL REFERENCES orders(id),recipient TEXT NOT NULL,created_at TEXT NOT NULL)').run();
 await env.DB.prepare('CREATE INDEX IF NOT EXISTS mail_order_links_order ON mail_order_links(order_id)').run();
}
export async function mailOrderTarget(env,id,recipients,synthetic=0){
 if(!id)return null;
 need(typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id),'Auftragszuordnung ist ungültig.');
 const row=await env.DB.prepare('SELECT data,version FROM orders WHERE id=? AND synthetic=?').bind(id,synthetic).first();
 need(row,'Auftrag nicht gefunden.',404);
 const order={...JSON.parse(row.data),id,version:row.version};assertRecordOperation(order,'mail');
 const email=String(order.source?.email??'').trim().toLowerCase();
 need(email&&recipients.includes(email),'Der Empfänger passt nicht zur gespeicherten Auftragsadresse. Bitte Zuordnung prüfen.',409);
 return {id,version:row.version,email};
}
export function guardMailOrder(env,target){if(target)assertCurrentRecordOperation(env,target,'mail',target.version);}
export function mailOrderStatement(env,target,messageId,at){return target?[env.DB.prepare('INSERT INTO mail_order_links(message_id,order_id,recipient,created_at) VALUES(?,?,?,?)').bind(messageId,target.id,target.email,at)]:[];}
