// Kundenchat: direkte Nachrichten zwischen Kunde und Betreiber mit Bildern, Videos und PDFs.
// Ein Chat gehört genau zu einem Auftrag. Kunden erreichen ihn über einen persönlichen Link
// und die bestehende Anmeldung mit E-Mail-Link und PIN; der Betreiber im Panel.
// Nachrichten werden nie verändert oder gelöscht. Dateien liegen privat im vorhandenen
// Speicher und stehen in der Tabelle assets, damit die tägliche Sicherung sie erfasst.
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {AppError,need} from '../src/domain.mjs';
import {COMPANY} from '../src/company.mjs';
import {configuration,getOrder,init,protect,setting,unprotect} from '../src/worker.mjs';
import {digest,issueCustomerAccess,limited} from './auth.mjs';

export const CHAT_LIMITS=Object.freeze({text:4000,filesPerMessage:10,fileBytes:15*1024*1024,pendingFiles:20,filesPerThread:1000,history:300,waitSeconds:25});
const LINK_DAYS=365;
const OWNER_NOTIFY_PAUSE=10*60000,CUSTOMER_NOTIFY_PAUSE=30*60000,PRESENCE=60000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN=/^[a-f0-9]{64}$/;
const MIME={'image/jpeg':'Bild','image/png':'Bild','image/webp':'Bild','application/pdf':'PDF','video/mp4':'Video','video/quicktime':'Video'};
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const iso=ms=>new Date(ms).toISOString();
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function chatSchema(env){
  await init(env);
  await env.DB.batch([
    `CREATE TABLE IF NOT EXISTS chat_threads(id TEXT PRIMARY KEY,order_id TEXT UNIQUE NOT NULL,token_hash TEXT UNIQUE,token_sealed TEXT,token_expires_at TEXT,closed INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,last_at TEXT NOT NULL,owner_read_id INTEGER NOT NULL DEFAULT 0,customer_read_id INTEGER NOT NULL DEFAULT 0,owner_seen_at INTEGER NOT NULL DEFAULT 0,customer_seen_at INTEGER NOT NULL DEFAULT 0,owner_notified_id INTEGER NOT NULL DEFAULT 0,customer_notified_id INTEGER NOT NULL DEFAULT 0,owner_notified_at INTEGER NOT NULL DEFAULT 0,customer_notified_at INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS chat_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,thread_id TEXT NOT NULL,sender TEXT NOT NULL CHECK(sender IN ('owner','customer')),body TEXT NOT NULL,client_id TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(thread_id,client_id))`,
    'CREATE INDEX IF NOT EXISTS chat_messages_thread ON chat_messages(thread_id,id)',
    'CREATE TABLE IF NOT EXISTS chat_attachments(asset_id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,sender TEXT NOT NULL,name TEXT NOT NULL,message_id INTEGER,created_at TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS chat_attachments_message ON chat_attachments(thread_id,message_id)',
    "CREATE TRIGGER IF NOT EXISTS no_chat_message_delete BEFORE DELETE ON chat_messages BEGIN SELECT RAISE(ABORT,'Chatnachrichten werden nicht gelöscht'); END",
    "CREATE TRIGGER IF NOT EXISTS no_chat_message_update BEFORE UPDATE ON chat_messages BEGIN SELECT RAISE(ABORT,'Chatnachrichten werden nicht verändert'); END",
    "CREATE TRIGGER IF NOT EXISTS no_chat_attachment_delete BEFORE DELETE ON chat_attachments WHEN OLD.message_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'Gesendete Chatdateien werden nicht gelöscht'); END"
  ].map(query=>env.DB.prepare(query)));
}

// Customer paths that the application lets through for signed-in customers.
export const CUSTOMER_CHAT_PREFIXES=['/chat/','/api/kundenchat/'];

// --- Live updates: requests wait up to 25 seconds for a new message or read receipt. ---
const waiters=new Map();let waiting=0;
function wake(threadId){const set=waiters.get(threadId);if(!set)return;waiters.delete(threadId);for(const done of set)done();}
function waitFor(threadId,ms){
  if(ms<=0||waiting>=200)return Promise.resolve();
  waiting++;
  return new Promise(resolve=>{
    let set=waiters.get(threadId);if(!set){set=new Set();waiters.set(threadId,set);}
    const done=()=>{clearTimeout(timer);set.delete(done);if(!set.size&&waiters.get(threadId)===set)waiters.delete(threadId);waiting--;resolve();};
    const timer=setTimeout(done,ms);timer.unref?.();set.add(done);
  });
}

// --- Reading ---
async function threadById(env,id){need(UUID.test(id??''),'Chat nicht gefunden.',404);const row=await env.DB.prepare('SELECT * FROM chat_threads WHERE id=?').bind(id).first();need(row,'Chat nicht gefunden.',404);return row;}
async function threadByToken(env,token){
  need(TOKEN.test(token??''),'Chatlink ungültig.',404);
  const row=await env.DB.prepare('SELECT * FROM chat_threads WHERE token_hash=?').bind(digest(token)).first();
  need(row&&row.token_expires_at&&Date.parse(row.token_expires_at)>Date.now(),'Dieser Chatlink ist ungültig oder abgelaufen. Bitte White Gloss um einen neuen Link bitten.',404);
  return row;
}
async function latestId(env,threadId,sender=null){const row=await env.DB.prepare('SELECT COALESCE(MAX(id),0) AS id FROM chat_messages WHERE thread_id=?'+(sender?' AND sender=?':'')).bind(...(sender?[threadId,sender]:[threadId])).first();return Number(row.id);}

async function messagesAfter(env,threadId,after,fileUrl){
  const rows=(await env.DB.prepare('SELECT id,sender,body,created_at FROM chat_messages WHERE thread_id=? AND id>? ORDER BY id DESC LIMIT ?').bind(threadId,after,CHAT_LIMITS.history).all()).results.reverse();
  if(!rows.length)return [];
  const files=(await env.DB.prepare('SELECT c.asset_id,c.message_id,c.name,a.mime,a.size FROM chat_attachments c JOIN assets a ON a.id=c.asset_id WHERE c.thread_id=? AND c.message_id BETWEEN ? AND ? ORDER BY c.created_at,c.asset_id').bind(threadId,rows[0].id,rows[rows.length-1].id).all()).results;
  const byMessage=new Map();for(const file of files){const list=byMessage.get(file.message_id)??[];list.push({id:file.asset_id,name:file.name,mime:file.mime,size:Number(file.size),url:fileUrl(file.asset_id)});byMessage.set(file.message_id,list);}
  return rows.map(row=>({id:Number(row.id),sender:row.sender,text:row.body,at:row.created_at,files:byMessage.get(row.id)??[]}));
}

function orderSummary(order){return {orderId:order.id,wg:order.wg,name:order.source?.name??'',vehicle:[order.source?.vehicle,order.source?.plate].filter(Boolean).join(' · '),synthetic:order.synthetic===true};}

async function linkInfo(env,thread){
  const active=Boolean(thread.token_hash&&thread.token_expires_at&&Date.parse(thread.token_expires_at)>Date.now());
  if(!active)return {active:false,url:null,expiresAt:null};
  const token=await unprotect(env,thread.token_sealed);return {active:true,url:env.PANEL_ORIGIN+'/chat/'+token,expiresAt:thread.token_expires_at};
}

// Read receipts: a client confirms what it has received by asking for messages "after" that id.
// A request that was abandoned (closed tab, lost connection) therefore never marks new messages as read.
async function acknowledge(env,thread,side,after,now){
  const newest=await latestId(env,thread.id),upto=Math.min(after,newest),before=Number(thread[side+'_read_id']);
  await env.DB.prepare(`UPDATE chat_threads SET ${side}_read_id=MAX(${side}_read_id,?),${side}_seen_at=? WHERE id=?`).bind(upto,now,thread.id).run();
  if(upto>before)wake(thread.id);
}

async function conversation(env,threadId,side,{after,seen,wait,preview,fileUrl,now}){
  let thread=await threadById(env,threadId);
  if(!preview){await acknowledge(env,thread,side,after,now);thread=await threadById(env,threadId);}
  let messages=await messagesAfter(env,thread.id,after,fileUrl);
  const otherRead=t=>Number(side==='owner'?t.customer_read_id:t.owner_read_id);
  if(!messages.length&&wait>0&&otherRead(thread)===seen){
    await waitFor(thread.id,Math.min(wait,CHAT_LIMITS.waitSeconds)*1000);
    thread=await threadById(env,threadId);messages=await messagesAfter(env,thread.id,after,fileUrl);
  }
  return {thread,messages,read:{owner:Number(thread.owner_read_id),customer:Number(thread.customer_read_id)}};
}

function viewParams(url){
  const after=Number(url.searchParams.get('after')??0),seen=Number(url.searchParams.get('seen')??-1),wait=Number(url.searchParams.get('wait')??0);
  return {after:Number.isSafeInteger(after)&&after>=0?after:0,seen:Number.isSafeInteger(seen)?seen:-1,wait:Number.isFinite(wait)&&wait>0?wait:0};
}

// --- Writing ---
function sameOrigin(env,request){need(request.headers.get('origin')===env.PANEL_ORIGIN,'Ungültiger Ursprung.',403);}
async function readJSON(env,request,max=20000){
  sameOrigin(env,request);need(request.headers.get('content-type')?.startsWith('application/json'),'JSON-Eingabe erforderlich.',415);
  const raw=await request.text();need(raw.length<=max,'Anfrage zu groß.',413);
  try{const value=JSON.parse(raw);need(value&&typeof value==='object'&&!Array.isArray(value),'Ungültige Eingabe.');return value;}catch(error){if(error instanceof AppError)throw error;throw new AppError('Ungültige Eingabe.');}
}
function fileName(value,mime){
  const ending={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','application/pdf':'.pdf','video/mp4':'.mp4','video/quicktime':'.mov'}[mime];
  let name=String(value??'').split(/[\\/]/).pop().normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,120);
  name=name.replace(/^\.+/,'').trim();
  if(!name)name=MIME[mime]+ending;
  return name;
}
function contentMatches(bytes,mime){
  const ascii=(start,end)=>Buffer.from(bytes.subarray(start,end)).toString('latin1');
  if(mime==='image/jpeg')return bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
  if(mime==='image/png')return ascii(0,8)==='\x89PNG\r\n\x1a\n';
  if(mime==='image/webp')return ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP';
  if(mime==='application/pdf')return ascii(0,5)==='%PDF-';
  return ascii(4,8)==='ftyp';
}

async function storeFile(env,thread,sender,request,now){
  sameOrigin(env,request);need(env.BUCKET,'Geschützter Dateispeicher ist nicht gebunden.',503);
  need(!thread.closed,'Dieser Chat ist beendet. Es können keine Dateien mehr gesendet werden.',409);
  const mime=(request.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
  need(MIME[mime],'Erlaubt sind Fotos (JPEG, PNG, WebP), Videos (MP4, MOV) und PDF-Dateien.',415);
  need(Number(request.headers.get('content-length')??0)<=CHAT_LIMITS.fileBytes,'Eine Datei darf höchstens 15 MB groß sein.',413);
  if(sender==='customer')need(!await limited(env,'chat-file:'+thread.id,now,80),'Zu viele Dateien in kurzer Zeit. Bitte später erneut versuchen.',429);
  const counts=await env.DB.prepare('SELECT COUNT(*) AS total,SUM(CASE WHEN sender=? AND message_id IS NULL THEN 1 ELSE 0 END) AS pending FROM chat_attachments WHERE thread_id=?').bind(sender,thread.id).first();
  need(Number(counts.pending??0)<CHAT_LIMITS.pendingFiles,'Zu viele vorbereitete Dateien. Bitte zuerst senden.',409);
  need(Number(counts.total??0)<CHAT_LIMITS.filesPerThread,'Für diesen Chat ist die Dateigrenze erreicht.',409);
  const bytes=new Uint8Array(await request.arrayBuffer());
  need(bytes.byteLength>50&&bytes.byteLength<=CHAT_LIMITS.fileBytes,'Die Datei muss zwischen 50 Byte und 15 MB groß sein.',413);
  need(contentMatches(bytes,mime),'Dateiinhalt passt nicht zum Dateityp.',415);
  const id=randomUUID(),at=iso(now),name=fileName(new URL(request.url).searchParams.get('name'),mime);
  await env.BUCKET.put(id,bytes,{httpMetadata:{contentType:mime}});
  try{
    await env.DB.batch([
      env.DB.prepare('INSERT INTO assets(id,order_id,kind,mime,hash,size,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,thread.order_id,'chat',mime,sha256(bytes),bytes.byteLength,at),
      env.DB.prepare('INSERT INTO chat_attachments(asset_id,thread_id,sender,name,message_id,created_at) VALUES(?,?,?,?,NULL,?)').bind(id,thread.id,sender,name,at)
    ]);
  }catch(error){await env.BUCKET.delete(id);throw error;}
  return {id,name,mime,size:bytes.byteLength};
}

async function postMessage(env,thread,sender,request,now,fileUrl,notify=true){
  const input=await readJSON(env,request);
  need(!thread.closed,'Dieser Chat ist beendet. Bitte telefonisch oder per E-Mail Kontakt aufnehmen.',409);
  const text=String(input.text??'').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim();
  need(text.length<=CHAT_LIMITS.text,'Eine Nachricht darf höchstens 4000 Zeichen lang sein.');
  const files=[...new Set(Array.isArray(input.files)?input.files:[])];
  need(files.length<=CHAT_LIMITS.filesPerMessage&&files.every(id=>typeof id==='string'&&UUID.test(id)),'Höchstens 10 Dateien pro Nachricht.');
  need(text||files.length,'Die Nachricht ist leer.');
  const clientId=typeof input.clientId==='string'&&/^[A-Za-z0-9-]{8,64}$/.test(input.clientId)?input.clientId:randomUUID();
  const existing=await env.DB.prepare('SELECT id FROM chat_messages WHERE thread_id=? AND client_id=?').bind(thread.id,clientId).first();
  if(existing)return {message:(await messagesAfter(env,thread.id,Number(existing.id)-1,fileUrl))[0],duplicate:true};
  if(sender==='customer')need(!await limited(env,'chat-message:'+thread.id,now,120),'Zu viele Nachrichten in kurzer Zeit. Bitte später erneut versuchen.',429);
  if(files.length){
    const owned=await env.DB.prepare(`SELECT COUNT(*) AS n FROM chat_attachments WHERE thread_id=? AND sender=? AND message_id IS NULL AND asset_id IN (${files.map(()=>'?').join(',')})`).bind(thread.id,sender,...files).first();
    need(Number(owned.n)===files.length,'Eine Datei gehört nicht zu diesem Chat oder wurde bereits gesendet.',409);
  }
  const at=iso(now),column=sender==='owner'?'owner':'customer';
  const created='(SELECT id FROM chat_messages WHERE thread_id=? AND client_id=?)';
  try{
    await env.DB.batch([
      env.DB.prepare('INSERT INTO chat_messages(thread_id,sender,body,client_id,created_at) VALUES(?,?,?,?,?)').bind(thread.id,sender,text,clientId,at),
      ...(files.length?[env.DB.prepare(`UPDATE chat_attachments SET message_id=${created} WHERE thread_id=? AND sender=? AND message_id IS NULL AND asset_id IN (${files.map(()=>'?').join(',')})`).bind(thread.id,clientId,thread.id,sender,...files)]:[]),
      env.DB.prepare(`UPDATE chat_threads SET last_at=?,${column}_read_id=${created},${column}_seen_at=? WHERE id=?`).bind(at,thread.id,clientId,now,thread.id)
    ]);
  }catch(error){
    const again=await env.DB.prepare('SELECT id FROM chat_messages WHERE thread_id=? AND client_id=?').bind(thread.id,clientId).first();
    if(!again)throw error;
  }
  const row=await env.DB.prepare('SELECT id FROM chat_messages WHERE thread_id=? AND client_id=?').bind(thread.id,clientId).first();
  wake(thread.id);
  const message=(await messagesAfter(env,thread.id,Number(row.id)-1,fileUrl))[0];
  if(notify)await notifyThread(env,thread.id,Date.now()).catch(error=>setting(env,'chatNotifyError',String(error?.message??error)).catch(()=>{}));
  return {message};
}

// Serves one chat file. Videos support byte ranges because mobile Safari plays MP4 only that way.
async function serveFile(env,thread,assetId,request,customer){
  need(UUID.test(assetId??''),'Datei nicht gefunden.',404);
  const row=await env.DB.prepare('SELECT c.sender,c.name,c.message_id,a.mime,a.size FROM chat_attachments c JOIN assets a ON a.id=c.asset_id WHERE c.asset_id=? AND c.thread_id=?').bind(assetId,thread.id).first();
  need(row&&(!customer||row.message_id!==null||row.sender==='customer'),'Datei nicht gefunden.',404);
  const object=await env.BUCKET.get(assetId);need(object,'Datei nicht gefunden.',404);
  const body=object.body,size=body.byteLength;
  const base={...headers,'Content-Type':row.mime,'Accept-Ranges':'bytes','Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(row.name),'Content-Security-Policy':"sandbox; default-src 'none'; img-src 'self'; media-src 'self'"};
  const range=/^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range')??'');
  if(range&&(range[1]||range[2])){
    let start=range[1]?Number(range[1]):Math.max(0,size-Number(range[2])),end=range[1]&&range[2]?Number(range[2]):size-1;
    end=Math.min(end,size-1);
    if(!(start<=end&&start<size))return new Response(null,{status:416,headers:{...base,'Content-Range':'bytes */'+size}});
    return new Response(body.slice(start,end+1),{status:206,headers:{...base,'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':String(end-start+1)}});
  }
  return new Response(body,{headers:{...base,'Content-Length':String(size)}});
}

// --- Customer link and email ---
async function createLink(env,thread,renew,now){
  if(!renew){const info=await linkInfo(env,thread);if(info.active)return info;}
  const token=randomBytes(32).toString('hex');
  await env.DB.prepare('UPDATE chat_threads SET token_hash=?,token_sealed=?,token_expires_at=? WHERE id=?').bind(digest(token),await protect(env,token),iso(now+LINK_DAYS*86400000),thread.id).run();
  return linkInfo(env,await threadById(env,thread.id));
}

async function sendMail(config,{to,subject,text,key}){
  const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+config.resendKey,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({from:config.sender,to:[to],reply_to:COMPANY.email,subject,text})});
  const result=await response.json().catch(()=>null);
  need(response.ok&&typeof result?.id==='string','E-Mail-Versand wurde nicht bestätigt.',502);
  return result.id;
}
const signature='\n\n'+COMPANY.name+' · '+COMPANY.owner+'\n'+COMPANY.street+', '+COMPANY.city+'\nTelefon '+COMPANY.phone+' · '+COMPANY.email;

function customerMailAllowed(order){return order&&!order.synthetic&&emailPattern.test(order.source?.email??'');}

async function invite(env,thread,now){
  const order=await getOrder(env,thread.order_id);
  need(!order.synthetic,'Im Testbereich wird keine Kunden-E-Mail versendet.',409);
  need(customerMailAllowed(order),'Für diesen Auftrag ist keine gültige Kunden-E-Mail hinterlegt.',409);
  need(!thread.closed,'Der Chat ist beendet. Bitte zuerst wieder öffnen.',409);
  const config=await configuration(env,['resendKey']);
  need(config.resendKey&&config.emailVerified&&config.sendApproved&&config.sender,'E-Mail-Versand zuerst in den Einstellungen prüfen und freigeben.',409);
  need(!await limited(env,'chat-invite:'+thread.id,now,5),'Bitte später erneut einladen.',429);
  const link=await createLink(env,thread,false,now),token=link.url.slice(link.url.lastIndexOf('/')+1);
  const access=await issueCustomerAccess(env,order.source.email,'/chat/'+token,now,now+86400000);
  const id=await sendMail(config,{to:order.source.email,key:'wg-chat-invite-'+access.hash,subject:'Ihr direkter Chat mit White Gloss · '+order.wg,
    text:'Guten Tag '+(order.source.name||'')+',\n\nfür Ihren Auftrag '+order.wg+' können Sie uns ab sofort direkt schreiben und Fotos, Videos oder PDF-Dateien senden – ganz ohne Telefon-Warteschleife.\n\nZum Chat:\n'+access.url+'\n\nIhre persönliche einmalige PIN: '+access.pin+'\n\nDer Link gilt 24 Stunden und kann einmal verwendet werden. Danach erreichen Sie Ihren Chat jederzeit hier und erhalten mit Ihrer E-Mail-Adresse einen neuen Zugang:\n'+link.url+signature});
  return {ok:true,message:'Einladung mit persönlichem Link und PIN an '+order.source.email+' versendet.',providerId:id};
}

// Sends at most one email per side and pause while the other side is away and messages are unread.
export async function notifyThread(env,threadId,now=Date.now()){
  const config=await configuration(env,['resendKey']);
  if(!config.resendKey||!config.emailVerified||!config.sender)return {owner:false,customer:false};
  const thread=await threadById(env,threadId),order=await getOrder(env,thread.order_id),sent={owner:false,customer:false};
  const preview=async(sender,afterId)=>{
    const rows=(await env.DB.prepare('SELECT m.body,(SELECT COUNT(*) FROM chat_attachments c WHERE c.message_id=m.id) AS files FROM chat_messages m WHERE m.thread_id=? AND m.sender=? AND m.id>? ORDER BY m.id').bind(thread.id,sender,afterId).all()).results;
    const files=rows.reduce((sum,row)=>sum+Number(row.files),0),texts=rows.map(row=>row.body).filter(Boolean);
    const quote=texts.join('\n').slice(0,600);
    return (quote?'„'+quote+(texts.join('\n').length>600?' …':'')+'“':'')+(files?(quote?'\n':'')+'('+files+(files===1?' Datei':' Dateien')+' angehängt)':'');
  };
  const ownerAddress=digest(COMPANY.email)===env.OWNER_EMAIL_SHA256?COMPANY.email:null;
  const customerLatest=await latestId(env,thread.id,'customer');
  if(ownerAddress&&customerLatest>Number(thread.owner_read_id)&&customerLatest>Number(thread.owner_notified_id)&&Number(thread.owner_seen_at)<now-PRESENCE&&Number(thread.owner_notified_at)<now-OWNER_NOTIFY_PAUSE){
    const claimed=await env.DB.prepare('UPDATE chat_threads SET owner_notified_id=?,owner_notified_at=? WHERE id=? AND owner_notified_id=?').bind(customerLatest,now,thread.id,thread.owner_notified_id).run();
    if(claimed.meta.changes){
      const text=await preview('customer',Math.max(Number(thread.owner_read_id),Number(thread.owner_notified_id)));
      await sendMail(config,{to:ownerAddress,key:'wg-chat-owner-'+thread.id+'-'+customerLatest,subject:'Neue Kundennachricht · '+order.wg+' · '+(order.source?.name||'Kunde'),
        text:(order.source?.name||'Ein Kunde')+' hat dir im Kundenchat geschrieben:\n\n'+text+'\n\nIm Panel antworten:\n'+env.PANEL_ORIGIN+'/#chat='+thread.id});
      sent.owner=true;
    }
  }
  const ownerLatest=await latestId(env,thread.id,'owner');
  if(customerMailAllowed(order)&&config.sendApproved&&!thread.closed&&thread.token_hash&&Date.parse(thread.token_expires_at??'')>now&&ownerLatest>Number(thread.customer_read_id)&&ownerLatest>Number(thread.customer_notified_id)&&Number(thread.customer_seen_at)<now-PRESENCE&&Number(thread.customer_notified_at)<now-CUSTOMER_NOTIFY_PAUSE){
    const claimed=await env.DB.prepare('UPDATE chat_threads SET customer_notified_id=?,customer_notified_at=? WHERE id=? AND customer_notified_id=?').bind(ownerLatest,now,thread.id,thread.customer_notified_id).run();
    if(claimed.meta.changes){
      const token=await unprotect(env,thread.token_sealed),chatUrl=env.PANEL_ORIGIN+'/chat/'+token;
      const access=await issueCustomerAccess(env,order.source.email,'/chat/'+token,now,now+86400000);
      const text=await preview('owner',Math.max(Number(thread.customer_read_id),Number(thread.customer_notified_id)));
      await sendMail(config,{to:order.source.email,key:'wg-chat-customer-'+thread.id+'-'+ownerLatest,subject:'Neue Nachricht von White Gloss · '+order.wg,
        text:'Guten Tag '+(order.source.name||'')+',\n\nSie haben eine neue Nachricht zu Ihrem Auftrag '+order.wg+':\n\n'+text+'\n\nZum Chat:\n'+access.url+'\n\nIhre persönliche einmalige PIN: '+access.pin+'\n\nDer Link gilt 24 Stunden und kann einmal verwendet werden. Ihren Chat erreichen Sie jederzeit hier:\n'+chatUrl+signature});
      sent.customer=true;
    }
  }
  return sent;
}

// Background run: catches messages that stayed unread after the other side left the chat.
export async function chatBackground(env,now=Date.now()){
  await chatSchema(env);const errors=[];
  const rows=(await env.DB.prepare('SELECT id FROM chat_threads WHERE last_at>? ORDER BY last_at DESC LIMIT 50').bind(iso(now-14*86400000)).all()).results;
  for(const row of rows){try{await notifyThread(env,row.id,now);}catch(error){errors.push('Kundenchat: '+(error?.message??'Benachrichtigung fehlgeschlagen.'));}}
  return errors.length?[errors[0]+(errors.length>1?' (+'+(errors.length-1)+' weitere)':'')]:[];
}

// --- Owner overview ---
async function threadList(env,synthetic){
  const rows=(await env.DB.prepare(`SELECT t.id,t.order_id,t.closed,t.last_at,t.token_hash IS NOT NULL AND t.token_expires_at>? AS linked,o.wg,o.data,
      (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id=t.id AND m.sender='customer' AND m.id>t.owner_read_id) AS unread,
      (SELECT json_object('id',m.id,'sender',m.sender,'text',substr(m.body,1,160),'at',m.created_at,'files',(SELECT COUNT(*) FROM chat_attachments c WHERE c.message_id=m.id AND c.thread_id=t.id)) FROM chat_messages m WHERE m.thread_id=t.id ORDER BY m.id DESC LIMIT 1) AS last
    FROM chat_threads t JOIN orders o ON o.id=t.order_id WHERE o.synthetic=? ORDER BY t.last_at DESC LIMIT 500`).bind(iso(Date.now()),synthetic?1:0).all()).results;
  return rows.map(row=>{const data=JSON.parse(row.data);return {id:row.id,...orderSummary({...data,id:row.order_id,wg:row.wg}),closed:Boolean(row.closed),linked:Boolean(row.linked),lastAt:row.last_at,unread:Number(row.unread),last:row.last?JSON.parse(row.last):null};});
}
async function unreadCount(env,synthetic){
  const row=await env.DB.prepare("SELECT COUNT(*) AS n FROM chat_messages m JOIN chat_threads t ON t.id=m.thread_id JOIN orders o ON o.id=t.order_id WHERE m.sender='customer' AND m.id>t.owner_read_id AND o.synthetic=?").bind(synthetic?1:0).first();
  return Number(row.n);
}

// --- Routing ---
export async function handleChat(env,request,identity,isOwner){
  const url=new URL(request.url),path=url.pathname,now=Date.now();
  if(path.startsWith('/api/kundenchat/')){
    const [token,...rest]=path.slice('/api/kundenchat/'.length).split('/');
    const thread=await threadByToken(env,token),order=await getOrder(env,thread.order_id);
    const email=String(identity??'').trim().toLowerCase();
    need(isOwner||(!order.synthetic&&email&&email===String(order.source?.email??'').trim().toLowerCase()),'Dieser Chat gehört zu einem anderen Kundenkonto.',403);
    const fileUrl=id=>'/api/kundenchat/'+token+'/file/'+id;
    if(request.method==='GET'&&rest.length===0){
      const view=await conversation(env,thread.id,'customer',{...viewParams(url),preview:isOwner,fileUrl,now});
      return json({wg:order.wg,vehicle:orderSummary(order).vehicle,customer:order.source?.name??'',closed:Boolean(view.thread.closed),ownerPreview:isOwner,company:{name:COMPANY.name,owner:COMPANY.owner,phone:COMPANY.phone,email:COMPANY.email},messages:view.messages,read:view.read,limits:{text:CHAT_LIMITS.text,files:CHAT_LIMITS.filesPerMessage,bytes:CHAT_LIMITS.fileBytes}});
    }
    if(request.method==='GET'&&rest[0]==='file'&&rest.length===2)return serveFile(env,thread,rest[1],request,!isOwner);
    need(request.method==='POST','Methode nicht erlaubt.',405);
    need(!isOwner,'Betreibervorschau: Bitte im Panel antworten.',403);
    if(rest[0]==='file'&&rest.length===1)return json(await storeFile(env,thread,'customer',request,now));
    if(rest[0]==='message'&&rest.length===1)return json(await postMessage(env,thread,'customer',request,now,fileUrl));
    throw new AppError('Funktion nicht gefunden.',404);
  }
  if(!path.startsWith('/api/chats'))return null;
  need(isOwner,'Nur der Betreiber darf alle Chats öffnen.',403);
  if(request.method==='GET'&&path==='/api/chats')return json({threads:await threadList(env,url.searchParams.get('test')==='true')});
  if(request.method==='GET'&&path==='/api/chats/summary')return json({unread:await unreadCount(env,url.searchParams.get('test')==='true')});
  if(request.method==='POST'&&path==='/api/chats/open'){
    const input=await readJSON(env,request);const order=await getOrder(env,String(input.orderId??''));
    await env.DB.prepare('INSERT OR IGNORE INTO chat_threads(id,order_id,created_at,last_at) VALUES(?,?,?,?)').bind(randomUUID(),order.id,iso(now),iso(now)).run();
    const row=await env.DB.prepare('SELECT id FROM chat_threads WHERE order_id=?').bind(order.id).first();
    return json({id:row.id});
  }
  const match=/^\/api\/chats\/t\/([0-9a-f-]{36})(?:\/(.*))?$/.exec(path);need(match,'Funktion nicht gefunden.',404);
  const thread=await threadById(env,match[1]),rest=(match[2]??'').split('/').filter(Boolean),fileUrl=id=>'/api/chats/t/'+thread.id+'/file/'+id;
  if(request.method==='GET'&&rest.length===0){
    const order=await getOrder(env,thread.order_id),view=await conversation(env,thread.id,'owner',{...viewParams(url),preview:false,fileUrl,now});
    return json({id:thread.id,...orderSummary(order),email:order.source?.email??'',phone:order.source?.phone??'',closed:Boolean(view.thread.closed),link:await linkInfo(env,view.thread),messages:view.messages,read:view.read,limits:{text:CHAT_LIMITS.text,files:CHAT_LIMITS.filesPerMessage,bytes:CHAT_LIMITS.fileBytes}});
  }
  if(request.method==='GET'&&rest[0]==='file'&&rest.length===2)return serveFile(env,thread,rest[1],request,false);
  need(request.method==='POST','Methode nicht erlaubt.',405);
  if(rest[0]==='file'&&rest.length===1)return json(await storeFile(env,thread,'owner',request,now));
  if(rest[0]==='message'&&rest.length===1)return json(await postMessage(env,thread,'owner',request,now,fileUrl));
  if(rest[0]==='link'&&rest.length===1){
    const input=await readJSON(env,request);
    if(input.action==='revoke'){await env.DB.prepare('UPDATE chat_threads SET token_hash=NULL,token_sealed=NULL,token_expires_at=NULL WHERE id=?').bind(thread.id).run();return json({link:{active:false,url:null,expiresAt:null}});}
    need(['create','renew'].includes(input.action),'Unbekannte Aktion.');
    return json({link:await createLink(env,thread,input.action==='renew',now)});
  }
  if(rest[0]==='invite'&&rest.length===1){await readJSON(env,request);return json(await invite(env,thread,now));}
  if(rest[0]==='close'&&rest.length===1){
    const input=await readJSON(env,request);need(typeof input.closed==='boolean','Ungültige Eingabe.');
    await env.DB.prepare('UPDATE chat_threads SET closed=? WHERE id=?').bind(input.closed?1:0,thread.id).run();wake(thread.id);
    return json({closed:input.closed});
  }
  throw new AppError('Funktion nicht gefunden.',404);
}
