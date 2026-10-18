import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {need} from '../src/domain.mjs';
import {digest,limited,sessionIdentity} from './auth.mjs';
import {derive,inputFor} from './password-auth.mjs';

const cookieName='__Host-wg-advisor';
const random=()=>randomBytes(32).toString('hex');
export const advisorJSON=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const sessionCookie=(response,raw)=>{response.headers.set('Set-Cookie',`${cookieName}=${raw}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${raw?28800:0}`);return response;};
function cookieHash(request){const raw=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);return /^[a-f0-9]{64}$/.test(raw??'')?digest(raw):null;}

export async function advisorSchema(env){
  await env.DB.batch([
    `CREATE TABLE IF NOT EXISTS advisor_accounts(id TEXT PRIMARY KEY,company TEXT NOT NULL,email TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),revision TEXT NOT NULL,salt TEXT,derived TEXT,
      activation_hash TEXT,activation_expires INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS advisor_sessions(hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES advisor_accounts(id),
      revision TEXT NOT NULL,expires_at INTEGER NOT NULL,last_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS advisor_session_account ON advisor_sessions(account_id)`,
    `CREATE TABLE IF NOT EXISTS advisor_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS advisor_comments(id TEXT PRIMARY KEY,target_kind TEXT NOT NULL CHECK(target_kind IN ('document','bank')),
      target_id TEXT NOT NULL,body TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS advisor_comment_target ON advisor_comments(target_kind,target_id,created_at,id)`,
    `CREATE TABLE IF NOT EXISTS advisor_proposals(id TEXT PRIMARY KEY,target_kind TEXT NOT NULL CHECK(target_kind IN ('document','bank')),
      target_id TEXT NOT NULL,base_version INTEGER NOT NULL,payload TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS advisor_decisions(proposal_id TEXT PRIMARY KEY REFERENCES advisor_proposals(id),
      decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected')),actor TEXT NOT NULL,created_at TEXT NOT NULL)`,
    ...['advisor_audit','advisor_comments','advisor_proposals','advisor_decisions'].flatMap(table=>[
      `CREATE TRIGGER IF NOT EXISTS no_${table}_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Kanzleiverlauf ist unveränderlich'); END`,
      `CREATE TRIGGER IF NOT EXISTS no_${table}_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Kanzleiverlauf wird nicht gelöscht'); END`
    ])
  ].map(sql=>env.DB.prepare(sql)));
}

export function advisorAudit(env,actor,action,target){return env.DB.prepare('INSERT INTO advisor_audit(at,actor,action,target) VALUES(?,?,?,?)').bind(new Date().toISOString(),actor,action,target);}

// Recheck in mutation SQL as well as at request boundaries: revocation wins even
// when it happens while a request is awaiting another read or a password hash.
export function advisorGuard(context,now=Date.now()){
  if(context.isOwner)return {sql:'1=1',params:[]};
  return {sql:`EXISTS(SELECT 1 FROM advisor_sessions s JOIN advisor_accounts a ON a.id=s.account_id
    WHERE s.hash=? AND s.account_id=? AND s.revision=? AND a.revision=s.revision AND a.enabled=1
    AND s.expires_at>? AND s.last_at>?)`,params:[context.sessionHash,context.id,context.revision,now,now-1800000]};
}
export async function advisorContext(env,request){
  const identity=await sessionIdentity(env,request);
  if(identity&&digest(identity)===env.OWNER_EMAIL_SHA256)return {isOwner:true,actor:'owner',id:null,company:'White Gloss',email:identity};
  const hash=cookieHash(request);if(!hash)return null;
  const now=Date.now(),row=await env.DB.prepare(`SELECT a.id,a.company,a.email,a.revision FROM advisor_sessions s
    JOIN advisor_accounts a ON a.id=s.account_id WHERE s.hash=? AND s.revision=a.revision AND a.enabled=1
    AND s.expires_at>? AND s.last_at>?`).bind(hash,now,now-1800000).first();
  if(!row)return null;
  await env.DB.prepare('UPDATE advisor_sessions SET last_at=? WHERE hash=?').bind(now,hash).run();
  return {...row,isOwner:false,actor:'advisor:'+row.id,sessionHash:hash};
}
export async function advisorStillActive(env,context){const guard=advisorGuard(context);need(await env.DB.prepare('SELECT 1 WHERE '+guard.sql).bind(...guard.params).first(),'Zugang abgelaufen oder gesperrt. Bitte erneut anmelden.',401);}

async function throttle(env,request,subject){
  const now=Date.now(),ip=(request.headers.get('x-forwarded-for')??'unknown').slice(0,80);
  const blockedIP=await limited(env,'advisor-ip:'+ip,now,20),blockedSubject=await limited(env,'advisor-login:'+subject,now,10);
  need(!blockedIP&&!blockedSubject,'Zu viele Anmeldeversuche. Bitte später erneut versuchen.',429);
  await env.DB.prepare('DELETE FROM advisor_sessions WHERE expires_at<=? OR last_at<=?').bind(now,now-1800000).run();
}
export async function handleAdvisorAuth(env,request){
  const path=new URL(request.url).pathname;
  if(!['/api/advisor/login','/api/advisor/enroll','/api/advisor/logout'].includes(path))return null;
  need(request.method==='POST','Methode nicht erlaubt.',405);
  const input=await inputFor(env,request);
  if(path.endsWith('/logout')){
    await env.DB.prepare('DELETE FROM advisor_sessions WHERE hash=?').bind(cookieHash(request)??'').run();
    return sessionCookie(advisorJSON({ok:true}),'');
  }
  const email=String(input.email??'').trim().toLowerCase(),password=input.password;
  await throttle(env,request,email.slice(0,180));
  need(email.length<=180&&typeof password==='string'&&password.length>=1&&password.length<=128,'E-Mail-Adresse oder Passwort ungültig.',401);
  const row=await env.DB.prepare('SELECT * FROM advisor_accounts WHERE email=? AND enabled=1').bind(email).first();
  const now=Date.now(),raw=random(),hash=digest(raw);
  if(path.endsWith('/enroll')){
    need(Array.from(password).length>=15&&password===input.confirmation,'Bitte zweimal dasselbe Passwort mit 15 bis 128 Zeichen eingeben.');
    need(/^[a-f0-9]{64}$/.test(input.token??'')&&row?.activation_hash===digest(input.token)&&row.activation_expires>now,'Einrichtungslink ungültig oder abgelaufen.',401);
    const salt=random(),key=(await derive(password,salt)).toString('hex'),revision=random();
    const result=await env.DB.batch([
      env.DB.prepare(`UPDATE advisor_accounts SET salt=?,derived=?,revision=?,activation_hash=NULL,activation_expires=NULL,updated_at=?
        WHERE id=? AND revision=? AND activation_hash=? AND activation_expires>? AND enabled=1`).bind(salt,key,revision,new Date().toISOString(),row.id,row.revision,digest(input.token),Date.now()),
      env.DB.prepare(`INSERT INTO advisor_sessions SELECT ?,id,revision,?,? FROM advisor_accounts WHERE id=? AND revision=? AND enabled=1`).bind(hash,now+28800000,now,row.id,revision),
      env.DB.prepare('DELETE FROM advisor_sessions WHERE account_id=? AND revision<>? AND EXISTS(SELECT 1 FROM advisor_sessions WHERE hash=?)').bind(row.id,revision,hash),
      env.DB.prepare(`INSERT INTO advisor_audit(at,actor,action,target) SELECT ?,?,'ENROLLED',? WHERE EXISTS(SELECT 1 FROM advisor_sessions WHERE hash=?)`).bind(new Date().toISOString(),'advisor:'+row.id,row.id,hash)
    ]);
    need(result[0].meta.changes===1,'Der Einrichtungslink wurde inzwischen ersetzt oder gesperrt.',409);
  }else{
    const key=await derive(password,row?.salt??'00'.repeat(32));
    need(row?.derived&&timingSafeEqual(key,Buffer.from(row.derived,'hex')),'E-Mail-Adresse oder Passwort stimmen nicht.',401);
    const result=await env.DB.prepare(`INSERT INTO advisor_sessions SELECT ?,id,revision,?,? FROM advisor_accounts
      WHERE id=? AND revision=? AND enabled=1 AND derived=?`).bind(hash,now+28800000,now,row.id,row.revision,row.derived).run();
    need(result.meta.changes===1,'Zugang wurde geändert. Bitte erneut anmelden.',409);
    await advisorAudit(env,'advisor:'+row.id,'LOGIN',row.id).run();
  }
  return sessionCookie(advisorJSON({ok:true}),raw);
}

export async function handleAdvisorAccounts(env,request,context){
  need(context.isOwner,'Nur der Betreiber verwaltet Kanzleizugänge.',403);
  if(request.method==='GET'){
    const rows=(await env.DB.prepare(`SELECT id,company,email,enabled,derived IS NOT NULL AS enrolled,activation_expires,created_at,updated_at
      FROM advisor_accounts ORDER BY created_at DESC,id`).all()).results;
    return advisorJSON({accounts:rows});
  }
  need(request.method==='POST','Methode nicht erlaubt.',405);
  const input=await inputFor(env,request),at=new Date().toISOString(),revision=random();
  if(input.action==='revoke'){
    const result=await env.DB.batch([
      env.DB.prepare('UPDATE advisor_accounts SET enabled=0,revision=?,salt=NULL,derived=NULL,activation_hash=NULL,activation_expires=NULL,updated_at=? WHERE id=?').bind(revision,at,input.id??''),
      env.DB.prepare("INSERT INTO advisor_audit(at,actor,action,target) SELECT ?,'owner','REVOKED',? WHERE changes()=1").bind(at,input.id??''),
      env.DB.prepare('DELETE FROM advisor_sessions WHERE account_id=?').bind(input.id??'')
    ]);
    need(result[0].meta.changes===1,'Kanzleizugang nicht gefunden.',404);return advisorJSON({ok:true});
  }
  need(['create','reset'].includes(input.action),'Aktion ungültig.');
  const raw=random(),expires=Date.now()+86400000;
  let id=input.id;
  if(input.action==='create'){
    const company=String(input.company??'').trim(),email=String(input.email??'').trim().toLowerCase();
    need(company.length>=2&&company.length<=180,'Kanzleiname muss 2 bis 180 Zeichen enthalten.');
    need(email.length<=180&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&digest(email)!==env.OWNER_EMAIL_SHA256,'Persönliche E-Mail-Adresse der Kanzlei eingeben.');
    id=randomUUID();
    const results=await env.DB.batch([
      env.DB.prepare(`INSERT INTO advisor_accounts VALUES(?,?,?,1,?,NULL,NULL,?,?,?,?) ON CONFLICT(email) DO NOTHING`).bind(id,company,email,revision,digest(raw),expires,at,at),
      env.DB.prepare("INSERT INTO advisor_audit(at,actor,action,target) SELECT ?,'owner','CREATED',? WHERE changes()=1").bind(at,id)
    ]);
    need(results[0].meta.changes===1,'Für diese E-Mail-Adresse besteht bereits ein Zugang. Nutze „Neuen Einrichtungslink erzeugen“.',409);
  }else{
    const results=await env.DB.batch([
      env.DB.prepare('UPDATE advisor_accounts SET enabled=1,revision=?,salt=NULL,derived=NULL,activation_hash=?,activation_expires=?,updated_at=? WHERE id=?').bind(revision,digest(raw),expires,at,id??''),
      env.DB.prepare("INSERT INTO advisor_audit(at,actor,action,target) SELECT ?,'owner','RESET',? WHERE changes()=1").bind(at,id??''),
      env.DB.prepare('DELETE FROM advisor_sessions WHERE account_id=?').bind(id??'')
    ]);
    need(results[0].meta.changes===1,'Kanzleizugang nicht gefunden.',404);
  }
  // Fragment is never sent in HTTP access logs. Only the one-time response holds the raw token.
  return advisorJSON({ok:true,id,expiresAt:expires,activationUrl:env.PANEL_ORIGIN+'/kanzlei#einrichten='+raw});
}
