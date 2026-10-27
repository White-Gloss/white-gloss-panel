// Eigenes IMAP-/SMTP-Postfach. Eingänge werden lesend übernommen; Versand nur
// nach ausdrücklicher Betreiberaktion. Beleganhänge bleiben unklassifiziert.
import {createHash,randomUUID} from 'node:crypto';
import {protect,unprotect} from '../src/worker.mjs';
import {AppError,need,text} from '../src/domain.mjs';

const {simpleParser,ImapFlow,nodemailer}=await import(new URL('../dist/runtime/mailbox.mjs',import.meta.url).href);
const ROOT='/api/mailbox';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOST=/^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const MIMES={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
const MAX_MAIL=25*1024*1024,MAX_ATTACHMENT=12*1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const safeName=(value,fallback)=>text(value||fallback,180).replace(/[\\/\u0000-\u001f\u007f]/g,'_')||fallback;
const addresses=value=>(value?.value??[]).filter(item=>EMAIL.test(item.address??'')).map(item=>({name:text(item.name,180),address:text(item.address,320).toLowerCase()}));
const publicAccount=row=>row?{email:row.email,displayName:row.display_name,imapHost:row.imap_host,imapPort:row.imap_port,imapSecure:row.imap_secure===1,smtpHost:row.smtp_host,smtpPort:row.smtp_port,smtpSecure:row.smtp_secure===1,username:row.username,passwordConfigured:Boolean(row.password),syncApproved:row.sync_approved===1,imapVerifiedAt:row.imap_verified_at,smtpVerifiedAt:row.smtp_verified_at,lastSyncAt:row.last_sync_at,lastSyncError:row.last_sync_error}:null;

export async function mailboxSchema(env){
  await env.DB.batch([
    `CREATE TABLE IF NOT EXISTS mailbox_accounts(
      id INTEGER PRIMARY KEY CHECK(id=1),email TEXT NOT NULL,display_name TEXT NOT NULL,
      imap_host TEXT NOT NULL,imap_port INTEGER NOT NULL,imap_secure INTEGER NOT NULL,
      smtp_host TEXT NOT NULL,smtp_port INTEGER NOT NULL,smtp_secure INTEGER NOT NULL,
      username TEXT NOT NULL,password TEXT NOT NULL,sync_approved INTEGER NOT NULL DEFAULT 0,
      imap_verified_at TEXT,smtp_verified_at TEXT,last_sync_at TEXT,last_sync_error TEXT,updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS mail_messages(
      id TEXT PRIMARY KEY,dedupe_key TEXT NOT NULL UNIQUE,synthetic INTEGER NOT NULL CHECK(synthetic IN (0,1)),
      direction TEXT NOT NULL CHECK(direction IN ('INBOUND','OUTBOUND')),folder TEXT NOT NULL,
      uid INTEGER,uid_validity TEXT,message_id_hash TEXT,from_name TEXT NOT NULL,from_address TEXT NOT NULL,
      to_json TEXT NOT NULL,subject TEXT NOT NULL,text_body TEXT NOT NULL,received_at TEXT NOT NULL,imported_at TEXT NOT NULL)`,
    'CREATE INDEX IF NOT EXISTS mail_messages_inbox ON mail_messages(synthetic,received_at DESC)',
    `CREATE TABLE IF NOT EXISTS mail_attachments(
      id TEXT PRIMARY KEY,message_id TEXT NOT NULL REFERENCES mail_messages(id),filename TEXT NOT NULL,
      mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,archived INTEGER NOT NULL CHECK(archived IN (0,1)),
      document_id TEXT REFERENCES accounting_documents(id))`,
    'CREATE INDEX IF NOT EXISTS mail_attachments_message ON mail_attachments(message_id)',
    'CREATE INDEX IF NOT EXISTS mail_attachments_document ON mail_attachments(document_id)',
    `CREATE TABLE IF NOT EXISTS mail_deliveries(
      request_id TEXT PRIMARY KEY,message_id TEXT NOT NULL REFERENCES mail_messages(id),
      status TEXT NOT NULL CHECK(status IN ('PENDING','SENT','PARTIAL','FAILED','UNKNOWN')),
      accepted_count INTEGER NOT NULL DEFAULT 0,rejected_count INTEGER NOT NULL DEFAULT 0,
      provider_message_id TEXT,provider_response TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
    ...['mail_messages','mail_attachments'].flatMap(table=>[
      `CREATE TRIGGER IF NOT EXISTS no_${table}_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'E-Mail-Nachweise sind unveränderlich'); END`,
      `CREATE TRIGGER IF NOT EXISTS no_${table}_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'E-Mail-Nachweise werden nicht gelöscht'); END`
    ])
  ].map(sql=>env.DB.prepare(sql)));
}

async function bodyJSON(request,maximum=100000){
  need(request.headers.get('origin')===new URL(request.url).origin,'Ungültiger Ursprung.',403);
  need(request.headers.get('content-type')?.startsWith('application/json'),'JSON-Eingabe erforderlich.',415);
  need(Number(request.headers.get('content-length')??0)<=maximum,'Anfrage zu groß.',413);
  const raw=await request.text();need(raw.length<=maximum,'Anfrage zu groß.',413);
  try{const value=JSON.parse(raw);need(value&&typeof value==='object'&&!Array.isArray(value),'Ungültige Eingabe.');return value;}
  catch(error){if(error instanceof AppError)throw error;throw new AppError('Ungültige Eingabe.',400);}
}
function validAttachment(bytes,mime){
  if(!MIMES[mime]||bytes.length<=30||bytes.length>MAX_ATTACHMENT)return false;
  if(mime==='application/pdf')return bytes.subarray(0,5).toString()==='%PDF-';
  if(mime==='image/jpeg')return bytes[0]===0xff&&bytes[1]===0xd8&&bytes.at(-2)===0xff&&bytes.at(-1)===0xd9;
  if(mime==='image/png')return bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  return bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
}
async function existingMessage(env,key){return env.DB.prepare('SELECT id FROM mail_messages WHERE dedupe_key=?').bind(key).first();}

export async function ingestMessage(env,raw,locator,{synthetic=false}={}){
  const bytes=Buffer.from(raw);need(bytes.length>20&&bytes.length<=MAX_MAIL,'E-Mail ist leer oder größer als 25 MB.',413);
  const uid=Number(locator.uid),folder=text(locator.folder||'INBOX',180),uidValidity=text(locator.uidValidity||'0',80);
  need(Number.isSafeInteger(uid)&&uid>0&&folder&&uidValidity,'IMAP-Nachrichtenadresse ist ungültig.',502);
  const key=`INBOUND:1:${folder}:${uidValidity}:${uid}`,existing=await existingMessage(env,key);if(existing)return {id:existing.id,duplicate:true};
  let parsed;try{parsed=await simpleParser(bytes,{skipImageLinks:true,skipTextToHtml:true,skipTextLinks:true,maxHtmlLengthToParse:2000000});}
  catch{throw new AppError('E-Mail konnte nicht als MIME-Nachricht gelesen werden.',502);}
  need((parsed.attachments??[]).length<=30,'E-Mail enthält mehr als 30 Anhänge.',413);
  const id=randomUUID(),at=new Date().toISOString(),parsedDate=parsed.date&&Number.isFinite(parsed.date.getTime())?parsed.date.toISOString():at;
  const sender=addresses(parsed.from)[0]??{name:'',address:''},recipients=addresses(parsed.to);
  const attachments=(parsed.attachments??[]).map((part,index)=>{
    const content=Buffer.from(part.content??[]),mime=text(part.contentType,120).toLowerCase(),archived=validAttachment(content,mime),attachmentId=randomUUID();
    return {id:attachmentId,filename:safeName(part.filename,'Anhang-'+(index+1)+(MIMES[mime]?'.'+MIMES[mime]:'')),mime,size:content.length,sha256:hash(content),archived,content,documentId:archived?attachmentId:null};
  });
  const stored=[];try{
    for(const attachment of attachments)if(attachment.archived){await env.BUCKET.put(attachment.id,attachment.content,{httpMetadata:{contentType:attachment.mime}});stored.push(attachment.id);}
    const statements=[env.DB.prepare(`INSERT INTO mail_messages(
      id,dedupe_key,synthetic,direction,folder,uid,uid_validity,message_id_hash,from_name,from_address,to_json,subject,text_body,received_at,imported_at)
      VALUES(?,?,?,'INBOUND',?,?,?,?,?,?,?,?,?,?,?)`).bind(id,key,synthetic?1:0,folder,uid,uidValidity,parsed.messageId?hash(parsed.messageId):null,sender.name,sender.address,JSON.stringify(recipients),text(parsed.subject||'(Ohne Betreff)',500),text(parsed.text,200000),parsedDate,at)];
    for(const attachment of attachments){
      if(attachment.archived){
        statements.push(env.DB.prepare('INSERT INTO accounting_documents VALUES(?,?,?,?,?,?,?,?)').bind(attachment.documentId,synthetic?1:0,attachment.filename,attachment.mime,attachment.sha256,attachment.size,at,'PANEL'));
        statements.push(env.DB.prepare('INSERT INTO accounting_events(document_id,at,actor,action,payload) VALUES(?,?,?,?,?)').bind(attachment.documentId,at,'email','RECEIVED',JSON.stringify({sha256:attachment.sha256,size:attachment.size,mime:attachment.mime,source:'EMAIL',mailMessageId:id})));
      }
      statements.push(env.DB.prepare('INSERT INTO mail_attachments VALUES(?,?,?,?,?,?,?,?)').bind(attachment.id,id,attachment.filename,attachment.mime,attachment.size,attachment.sha256,attachment.archived?1:0,attachment.documentId));
    }
    await env.DB.batch(statements);
  }catch(error){
    const duplicate=await existingMessage(env,key);for(const storedId of stored)await env.BUCKET.delete(storedId).catch(()=>{});
    if(duplicate)return {id:duplicate.id,duplicate:true};throw error;
  }
  return {id,duplicate:false,attachments:attachments.filter(item=>item.documentId).length};
}

async function accountCredentials(env){
  const row=await env.DB.prepare('SELECT * FROM mailbox_accounts WHERE id=1').first();need(row,'Postfach ist noch nicht eingerichtet.',409);
  let password;try{password=await unprotect(env,row.password);}catch{throw new AppError('Postfachpasswort kann nicht entschlüsselt werden. Bitte erneut geschützt speichern.',503);}
  need(password,'Postfachpasswort fehlt. Bitte erneut geschützt speichern.',409);return {row,password};
}
/** @returns {import('imapflow').ImapFlowOptions} */
function imapConfig(row,password){return {host:row.imap_host,port:row.imap_port,secure:row.imap_secure===1,doSTARTTLS:row.imap_secure!==1,auth:{user:row.username,pass:password},logger:false,connectionTimeout:15000,greetingTimeout:10000,socketTimeout:30000,maxLineLength:1024*1024,maxLiteralSize:MAX_MAIL+1024*1024,maxResponseSize:MAX_MAIL+5*1024*1024,maxResponseTokens:200000};}
function smtpConfig(row,password){return {host:row.smtp_host,port:row.smtp_port,secure:row.smtp_secure===1,requireTLS:row.smtp_secure!==1,opportunisticTLS:false,auth:{user:row.username,pass:password},connectionTimeout:15000,greetingTimeout:10000,socketTimeout:30000};}
function connectionError(kind,error){const code=text(error?.code??error?.name??'Verbindungsfehler',80).replace(/[\r\n]/g,' ');return new AppError(kind+'-Verbindung fehlgeschlagen ('+code+'). Zugangsdaten und Server prüfen.',502);}

export async function checkMailbox(env,kind){
  need(['imap','smtp'].includes(kind),'Unbekannte Postfachprüfung.');const {row,password}=await accountCredentials(env),at=new Date().toISOString();
  try{
    if(env.MAILBOX_ADAPTERS?.[kind==='imap'?'verifyImap':'verifySmtp'])await env.MAILBOX_ADAPTERS[kind==='imap'?'verifyImap':'verifySmtp'](kind==='imap'?imapConfig(row,password):smtpConfig(row,password));
    else if(kind==='imap'){const client=new ImapFlow(imapConfig(row,password));try{await client.connect();need(client.authenticated,'IMAP-Anmeldung nicht bestätigt.',502);}finally{await client.logout().catch(()=>{});}}
    else{const transporter=nodemailer.createTransport(smtpConfig(row,password));try{await transporter.verify();}finally{transporter.close();}}
  }catch(error){await env.DB.prepare(`UPDATE mailbox_accounts SET ${kind}_verified_at=NULL,updated_at=? WHERE id=1`).bind(at).run();throw error instanceof AppError?error:connectionError(kind.toUpperCase(),error);}
  await env.DB.prepare(`UPDATE mailbox_accounts SET ${kind}_verified_at=?,updated_at=? WHERE id=1`).bind(at,at).run();
  return {ok:true,message:(kind==='imap'?'IMAP-Empfang':'SMTP-Versand')+' erfolgreich geprüft. Es wurde keine E-Mail versendet.'};
}

export async function syncMailbox(env,{automatic=false}={}){
  const {row,password}=await accountCredentials(env);need(row.imap_verified_at,'IMAP-Verbindung zuerst prüfen.',409);if(automatic)need(row.sync_approved===1,'Automatischer Postfachabruf ist nicht freigegeben.',409);
  if(env.MAILBOX_ADAPTERS?.sync)return env.MAILBOX_ADAPTERS.sync(imapConfig(row,password),{automatic});
  const client=new ImapFlow(imapConfig(row,password));let checked=0,imported=0,skipped=0;
  try{
    await client.connect();const lock=await client.getMailboxLock('INBOX',{readOnly:true,acquireTimeout:10000});
    try{
      const mailbox=client.mailbox;if(!mailbox)throw new AppError('IMAP-Postfachstatus fehlt.',502);
      const total=mailbox.exists,uidValidity=String(mailbox.uidValidity??'0');
      const entries=total?await client.fetchAll(`${Math.max(1,total-49)}:*`,{uid:true,size:true,envelope:true}):[];
      for(const entry of entries){
        checked++;if(!entry.uid||entry.size>MAX_MAIL){skipped++;continue;}
        if(await env.DB.prepare('SELECT id FROM mail_messages WHERE dedupe_key=?').bind(`INBOUND:1:INBOX:${uidValidity}:${entry.uid}`).first()){skipped++;continue;}
        const message=await client.fetchOne(entry.uid,{uid:true,source:true,size:true},{uid:true});
        if(!message||!message.source||message.size>MAX_MAIL){skipped++;continue;}
        await ingestMessage(env,message.source,{folder:'INBOX',uid:entry.uid,uidValidity});imported++;
      }
    }finally{lock.release();}
    const at=new Date().toISOString();await env.DB.prepare('UPDATE mailbox_accounts SET last_sync_at=?,last_sync_error=NULL,updated_at=? WHERE id=1').bind(at,at).run();
    return {checked,imported,skipped,message:`${imported} neue E-Mail${imported===1?'':'s'} übernommen; ${skipped} bereits vorhanden oder übersprungen.`};
  }catch(error){
    const detail=text(error?.code??error?.name??'Abruffehler',100);await env.DB.prepare('UPDATE mailbox_accounts SET last_sync_error=?,updated_at=? WHERE id=1').bind(detail,new Date().toISOString()).run();throw error instanceof AppError?error:connectionError('IMAP-Abruf',error);
  }finally{await client.logout().catch(()=>{});}
}

async function saveAccount(env,input){
  const old=await env.DB.prepare('SELECT * FROM mailbox_accounts WHERE id=1').first(),email=text(input.email,320).toLowerCase(),username=text(input.username,320);
  need(EMAIL.test(email),'Gültige Absenderadresse erforderlich.');need(username.length>0&&username.length<=320,'Postfach-Benutzername fehlt oder ist zu lang.');
  const values={displayName:text(input.displayName||'White Gloss',180),imapHost:text(input.imapHost,253).toLowerCase(),smtpHost:text(input.smtpHost,253).toLowerCase(),imapPort:Number(input.imapPort),smtpPort:Number(input.smtpPort)};
  need(HOST.test(values.imapHost)&&HOST.test(values.smtpHost),'IMAP- und SMTP-Server müssen als Hostname angegeben werden.');
  for(const key of ['imapPort','smtpPort'])need(Number.isSafeInteger(values[key])&&values[key]>=1&&values[key]<=65535,'Serverport ist ungültig.');
  const password=text(input.password,500)?await protect(env,text(input.password,500)):old?.password??'';need(password,'Postfachpasswort fehlt.',400);
  const imapSecure=input.imapSecure===true,smtpSecure=input.smtpSecure===true,syncApproved=input.syncApproved===true,at=new Date().toISOString();
  const imapChanged=!old||old.imap_host!==values.imapHost||old.imap_port!==values.imapPort||old.imap_secure!==Number(imapSecure)||old.username!==username||Boolean(text(input.password,500));
  const smtpChanged=!old||old.smtp_host!==values.smtpHost||old.smtp_port!==values.smtpPort||old.smtp_secure!==Number(smtpSecure)||old.username!==username||Boolean(text(input.password,500));
  await env.DB.prepare(`INSERT INTO mailbox_accounts(
    id,email,display_name,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,username,password,sync_approved,imap_verified_at,smtp_verified_at,updated_at)
    VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,imap_host=excluded.imap_host,imap_port=excluded.imap_port,imap_secure=excluded.imap_secure,smtp_host=excluded.smtp_host,smtp_port=excluded.smtp_port,smtp_secure=excluded.smtp_secure,username=excluded.username,password=excluded.password,sync_approved=excluded.sync_approved,imap_verified_at=excluded.imap_verified_at,smtp_verified_at=excluded.smtp_verified_at,updated_at=excluded.updated_at`)
    .bind(email,values.displayName,values.imapHost,values.imapPort,Number(imapSecure),values.smtpHost,values.smtpPort,Number(smtpSecure),username,password,Number(syncApproved),imapChanged?null:old.imap_verified_at,smtpChanged?null:old.smtp_verified_at,at).run();
  return {ok:true,message:'Postfach geschützt gespeichert. IMAP und SMTP separat prüfen.'};
}

function deliveryView(row){return {requestId:row.request_id,messageId:row.message_id,status:row.status,acceptedCount:row.accepted_count,rejectedCount:row.rejected_count,providerMessageId:row.provider_message_id,error:row.error,createdAt:row.created_at,updatedAt:row.updated_at};}
async function sendMail(env,input){
  need(input.confirmed===true,'Versand muss ausdrücklich bestätigt werden.');need(UUID.test(input.requestId??''),'Versand-ID fehlt oder ist ungültig.');
  const recipients=String(input.to??'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean);need(recipients.length>=1&&recipients.length<=10&&recipients.every(value=>EMAIL.test(value)&&value.length<=320),'Bis zu zehn gültige Empfängeradressen erforderlich.');
  const subject=text(input.subject,500),body=text(input.text,50000);need(subject,'Betreff fehlt.');need(body,'Nachrichtentext fehlt.');
  const {row,password}=await accountCredentials(env);need(row.smtp_verified_at,'SMTP-Verbindung zuerst erfolgreich prüfen.',409);
  const previous=await env.DB.prepare('SELECT * FROM mail_deliveries WHERE request_id=?').bind(input.requestId).first();
  if(previous){need(previous.status==='SENT'||previous.status==='PARTIAL','Dieser Versand ist noch ungeklärt. Kein automatischer Neuversuch; bitte zuerst das Postfach prüfen.',409);return {ok:true,status:previous.status,duplicate:true};}
  const id=randomUUID(),at=new Date().toISOString(),key='OUTBOUND:'+input.requestId;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO mail_messages(id,dedupe_key,synthetic,direction,folder,uid,uid_validity,message_id_hash,from_name,from_address,to_json,subject,text_body,received_at,imported_at)
      VALUES(?,?,0,'OUTBOUND','Sent',NULL,NULL,NULL,?,?,?,?,?,?,?)`).bind(id,key,row.display_name,row.email,JSON.stringify(recipients.map(address=>({name:'',address}))),subject,body,at,at),
    env.DB.prepare("INSERT INTO mail_deliveries(request_id,message_id,status,created_at,updated_at) VALUES(?,?,'PENDING',?,?)").bind(input.requestId,id,at,at)
  ]);
  const message={from:row.display_name?`"${row.display_name.replace(/["\\\r\n]/g,'')}" <${row.email}>`:row.email,to:recipients.join(', '),subject,text:body};
  const transporter=env.MAILBOX_ADAPTERS?.sendMail?null:nodemailer.createTransport(smtpConfig(row,password));
  try{
    const result=transporter?await transporter.sendMail(message):await env.MAILBOX_ADAPTERS.sendMail(smtpConfig(row,password),message);
    const accepted=Array.isArray(result.accepted)?result.accepted:[],rejected=Array.isArray(result.rejected)?result.rejected:[],status=accepted.length&&rejected.length?'PARTIAL':accepted.length?'SENT':'FAILED',updatedAt=new Date().toISOString();
    await env.DB.prepare('UPDATE mail_deliveries SET status=?,accepted_count=?,rejected_count=?,provider_message_id=?,provider_response=?,error=?,updated_at=? WHERE request_id=?').bind(status,accepted.length,rejected.length,text(result.messageId,500)||null,text(result.response,500)||null,status==='FAILED'?'SMTP hat keinen Empfänger angenommen. Kein automatischer Neuversuch.':null,updatedAt,input.requestId).run();
    return {ok:status!=='FAILED',status,acceptedCount:accepted.length,rejectedCount:rejected.length};
  }catch(error){
    const detail='SMTP-Ergebnis ungeklärt. Kein automatischer Neuversuch; bitte zuerst das Postfach prüfen.';
    await env.DB.prepare("UPDATE mail_deliveries SET status='UNKNOWN',error=?,updated_at=? WHERE request_id=?").bind(detail,new Date().toISOString(),input.requestId).run();throw new AppError(detail,502);
  }finally{transporter?.close();}
}

function messageView(row){return {id:row.id,direction:row.direction,folder:row.folder,fromName:row.from_name,fromAddress:row.from_address,to:JSON.parse(row.to_json),subject:row.subject,receivedAt:row.received_at,importedAt:row.imported_at,attachmentCount:row.attachment_count,receiptCount:row.receipt_count};}
async function mailboxView(env,synthetic){
  const account=publicAccount(await env.DB.prepare('SELECT * FROM mailbox_accounts WHERE id=1').first());
  const messages=(await env.DB.prepare(`SELECT m.*,(SELECT COUNT(*) FROM mail_attachments a WHERE a.message_id=m.id) attachment_count,(SELECT COUNT(*) FROM mail_attachments a WHERE a.message_id=m.id AND a.document_id IS NOT NULL) receipt_count FROM mail_messages m WHERE m.synthetic=? ORDER BY m.received_at DESC LIMIT 100`).bind(synthetic).all()).results.map(messageView);
  const deliveries=(await env.DB.prepare('SELECT d.* FROM mail_deliveries d JOIN mail_messages m ON m.id=d.message_id WHERE m.synthetic=? ORDER BY d.created_at DESC LIMIT 50').bind(synthetic).all()).results.map(deliveryView);
  return {account,messages,deliveries};
}
async function messageDetail(env,id){
  const row=await env.DB.prepare('SELECT * FROM mail_messages WHERE id=?').bind(id).first();need(row,'E-Mail nicht gefunden.',404);
  const attachments=(await env.DB.prepare('SELECT * FROM mail_attachments WHERE message_id=? ORDER BY filename').bind(id).all()).results.map(item=>({id:item.id,filename:item.filename,mime:item.mime,size:item.size,archived:item.archived===1,documentId:item.document_id}));
  return {message:{...messageView({...row,attachment_count:attachments.length,receipt_count:attachments.filter(item=>item.documentId).length}),textBody:row.text_body},attachments};
}

export async function handleMailbox(env,request,isOwner){
  const url=new URL(request.url),path=url.pathname;if(path!==ROOT&&!path.startsWith(ROOT+'/'))return null;need(isOwner,'Nur für den Betreiber vorgesehen.',403);
  if(request.method==='GET'&&path===ROOT)return response(await mailboxView(env,url.searchParams.get('test')==='true'?1:0));
  if(request.method==='GET'&&path.startsWith(ROOT+'/message/')){const id=path.slice((ROOT+'/message/').length);need(UUID.test(id),'E-Mail nicht gefunden.',404);return response(await messageDetail(env,id));}
  if(request.method==='GET'&&path.startsWith(ROOT+'/attachment/')){
    const id=path.slice((ROOT+'/attachment/').length);need(UUID.test(id),'Anhang nicht gefunden.',404);const row=await env.DB.prepare('SELECT * FROM mail_attachments WHERE id=? AND archived=1').bind(id).first();need(row,'Anhang nicht gefunden oder nicht unterstützt.',404);
    const file=await env.BUCKET.get(id);need(file&&hash(file.body)===row.sha256,'Anhang nicht verfügbar oder Integritätsprüfung fehlgeschlagen.',503);
    return new Response(file.body,{headers:{'Content-Type':row.mime,'Content-Disposition':'inline; filename="Anhang"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(request.method==='POST'&&path===ROOT+'/settings')return response(await saveAccount(env,await bodyJSON(request,16000)));
  if(request.method==='POST'&&path===ROOT+'/check'){const input=await bodyJSON(request);return response(await checkMailbox(env,input.kind));}
  if(request.method==='POST'&&path===ROOT+'/sync'){await bodyJSON(request);need(url.searchParams.get('test')!=='true','Im Testbereich wird kein echtes Postfach abgerufen.',409);return response(await syncMailbox(env));}
  if(request.method==='POST'&&path===ROOT+'/send'){const input=await bodyJSON(request);need(url.searchParams.get('test')!=='true','Im Testbereich wird keine E-Mail versendet.',409);return response(await sendMail(env,input));}
  return response({error:'Funktion nicht gefunden.'},404);
}

export async function mailboxBackground(env){
  const row=await env.DB.prepare('SELECT sync_approved,imap_verified_at FROM mailbox_accounts WHERE id=1').first();if(!row||row.sync_approved!==1||!row.imap_verified_at)return {skipped:true};
  return syncMailbox(env,{automatic:true});
}
