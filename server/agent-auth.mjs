import {randomBytes,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {digest,sessionIdentity,sessionHash,limited,authResponse} from './auth.mjs';
import {need,AppError} from '../src/domain.mjs';

const rawToken=()=>randomBytes(32).toString('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const scopesAllowed=['panel:read','panel:write'];
const cookieName='__Host-wg-agent-request';
const cookie=request=>(request.headers.get('cookie')??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)??'';
const resource=env=>env.PANEL_ORIGIN+'/mcp';
const csrf=(env,request,purpose)=>createHmac('sha256',Buffer.from(env.CONFIG_KEY,'base64')).update(sessionHash(request)+':'+purpose).digest('hex');
function scopes(value){const result=[...new Set((value??'panel:read').split(' ').filter(Boolean))].sort();need(result.length&&result.includes('panel:read')&&result.every(s=>scopesAllowed.includes(s)),'Ungültiger Berechtigungsumfang.');return result.join(' ');}
function response(data,status=200){return authResponse(data,status);}
export function agentChallenge(env,scope='panel:read',error='invalid_token'){return `Bearer resource_metadata="${env.PANEL_ORIGIN}/.well-known/oauth-protected-resource/mcp", error="${error}", scope="${scope}"`;}
export function agentUnauthorized(env,status=401,scope='panel:read'){const r=response({error:status===403?'insufficient_scope':'invalid_token'},status);r.headers.set('WWW-Authenticate',agentChallenge(env,scope,status===403?'insufficient_scope':'invalid_token'));return r;}

export async function agentAuthSchema(env){await env.DB.batch([
  'CREATE TABLE IF NOT EXISTS agent_requests(hash TEXT PRIMARY KEY,payload TEXT NOT NULL,expires_at INTEGER NOT NULL,consumed INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS agent_grants(id TEXT PRIMARY KEY,email TEXT NOT NULL,client_id TEXT NOT NULL,resource TEXT NOT NULL,scopes TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS agent_codes(hash TEXT PRIMARY KEY,grant_id TEXT NOT NULL,redirect_uri TEXT NOT NULL,challenge TEXT NOT NULL,expires_at INTEGER NOT NULL,consumed INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS agent_tokens(hash TEXT PRIMARY KEY,grant_id TEXT NOT NULL,kind TEXT NOT NULL,expires_at INTEGER NOT NULL,consumed INTEGER NOT NULL DEFAULT 0)'
].map(sql=>env.DB.prepare(sql)));}

async function clientMetadata(clientId){
  // Fetch only OpenAI's documented CIMD origin and paths. No arbitrary URL fetch.
  need(typeof clientId==='string'&&/^https:\/\/chatgpt\.com\/oauth\/(?:[a-zA-Z0-9_-]{1,160}\/)?client\.json$/.test(clientId),'Dieser OAuth-Client ist nicht freigegeben.',400);
  const r=await fetch(clientId,{redirect:'manual',signal:AbortSignal.timeout(15000)});
  need(r.ok,'OpenAI-Clientmetadaten konnten nicht bestätigt werden.',502);
  const text=await r.text();need(Buffer.byteLength(text)<=16384,'Clientmetadaten zu groß.',502);
  let data;try{data=JSON.parse(text);}catch{throw new AppError('Clientmetadaten ungültig.',502);}
  const methods=data.token_endpoint_auth_methods_supported??[data.token_endpoint_auth_method];
  need(data.client_id===clientId&&Array.isArray(data.redirect_uris)&&methods.includes('none'),'OpenAI-Client unterstützt den erforderlichen PKCE-Zugang nicht.',400);
  const redirects=data.redirect_uris.filter(uri=>typeof uri==='string'&&/^https:\/\/chatgpt\.com\/(?:connector_platform_oauth_redirect|connector\/oauth\/[a-zA-Z0-9_-]{1,160})$/.test(uri));
  need(redirects.length,'Keine freigegebene OpenAI-Rückrufadresse.');
  return {id:clientId,redirects,name:'ChatGPT / Codex'};
}

function html(body){return new Response('<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>White Gloss · Agent-Zugang</title><link rel="stylesheet" href="/style.css"><main class="appoff card"><span class="brandmark">WG</span><h1>White-Gloss-Agent</h1>'+body+'</main></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});}
async function ownerIdentity(env,request){const identity=await sessionIdentity(env,request);need(identity&&digest(identity)===env.OWNER_EMAIL_SHA256,'Nur der persönlich angemeldete Betreiber darf diese Verbindung freigeben.',403);return identity;}
async function boundedForm(request){need(request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'),'Formulareingabe erforderlich.',415);const reader=request.body?.getReader();need(reader,'Formulareingabe fehlt.');const chunks=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();throw new AppError('Anfrage zu groß.',413);}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}const form=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));for(const key of new Set(form.keys()))need(form.getAll(key).length===1,'Doppelte Eingabeparameter.');return form;}
function bindCookie(r,raw){const out=new Response(r.body,{status:r.status,headers:r.headers});out.headers.append('Set-Cookie',cookieName+'='+raw+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600');return out;}
function callback(env,payload,params){const u=new URL(payload.redirectUri);for(const [k,v] of Object.entries({...params,state:payload.state,iss:env.PANEL_ORIGIN}))u.searchParams.set(k,v);return Response.redirect(u.href,303);}

async function authorize(env,request,now){
  const query=new URL(request.url).searchParams;
  for(const key of new Set(query.keys()))need(query.getAll(key).length===1,'Doppelte OAuth-Parameter.');
  need(query.get('response_type')==='code'&&query.get('code_challenge_method')==='S256','Authorization Code mit S256-PKCE erforderlich.');
  need(query.get('resource')===resource(env),'Der Zugang muss ausschließlich für dieses Panel angefordert werden.');
  const challenge=query.get('code_challenge'),state=query.get('state');
  need(/^[A-Za-z0-9_-]{43}$/.test(challenge??'')&&typeof state==='string'&&state.length>=16&&state.length<=512,'OAuth-Zustand oder PKCE fehlt.');
  const ip=(request.headers.get('x-forwarded-for')??'unknown').slice(0,80);
  need(!await limited(env,'agent-authorize:'+ip,now,40),'Zu viele Verbindungsversuche.',429);
  const client=await clientMetadata(query.get('client_id'));
  const redirectUri=query.get('redirect_uri');need(client.redirects.includes(redirectUri),'Rückruf gehört nicht zum bestätigten OAuth-Client.');
  const payload={clientId:client.id,redirectUri,challenge,state,scopes:scopes(query.get('scope')??undefined),resource:resource(env)};
  const raw=rawToken();await env.DB.prepare('INSERT INTO agent_requests(hash,payload,expires_at) VALUES(?,?,?)').bind(digest(raw),JSON.stringify(payload),now+600000).run();
  const identity=await sessionIdentity(env,request);
  const target=identity&&digest(identity)===env.OWNER_EMAIL_SHA256?'/agent/connect':'/auth/login?returnTo=%2Fagent%2Fconnect';
  return bindCookie(Response.redirect(new URL(target,env.PANEL_ORIGIN).href,303),raw);
}

async function connectionPage(env,request,now){
  const identity=await sessionIdentity(env,request);
  if(!identity)return Response.redirect(env.PANEL_ORIGIN+'/auth/login?returnTo=%2Fagent%2Fconnect',303);
  need(digest(identity)===env.OWNER_EMAIL_SHA256,'Kundenzugänge können keinen Agenten verbinden.',403);
  const record=await env.DB.prepare('SELECT * FROM agent_requests WHERE hash=? AND consumed=0 AND expires_at>?').bind(digest(cookie(request)),now).first();
  let body='<p>Das White-Gloss-Panel ist das einzige operative System. Dieser Zugang verwendet die vorhandenen Aufträge, Fotos und Fachregeln.</p>';
  if(record){const p=JSON.parse(record.payload),write=p.scopes.includes('panel:write');body+='<h2>ChatGPT / Codex verbinden</h2><p>Freigegeben werden Auftragsübersichten, Kundenangaben, Leistungen, Terminvorschläge und Buchungsfotos aus diesem Panel.'+(write?' Zusätzlich dürfen Notizen, Begutachtungspreise und unverbindliche Terminvorschläge nach einer konkreten Anweisung geändert werden.':' Es wird ausschließlich lesender Zugriff beantragt.')+'</p><p>Keine Kundenunterschriften, Rechnungen, Zahlungen, Mails oder Kalenderbuchungen über diesen Zugang. Die Verbindung gilt höchstens 30 Tage und lässt sich hier widerrufen.</p><form method="post" action="/agent/oauth/consent"><input type="hidden" name="csrf" value="'+csrf(env,request,'consent:'+record.hash)+'"><button type="submit" name="decision" value="approve" class="primary">Verbindung freigeben</button> <button type="submit" name="decision" value="deny">Ablehnen</button></form>';}
  else body+='<p>Verbindung in ChatGPT über die MCP-Adresse <code>'+escape(resource(env))+'</code> beginnen. Die persönliche Freigabe erfolgt anschließend hier.</p>';
  const grants=await env.DB.prepare('SELECT id,client_id,scopes,created_at,expires_at FROM agent_grants WHERE email=? AND revoked=0 AND expires_at>? ORDER BY created_at DESC LIMIT 30').bind(identity,now).all();
  body+='<h2>Aktive Verbindungen</h2>';
  for(const grant of grants.results)body+='<form method="post" action="/agent/oauth/revoke-grant"><p>ChatGPT / Codex · '+escape(grant.scopes)+' · gültig bis '+escape(new Date(grant.expires_at).toLocaleString('de-DE',{timeZone:'Europe/Berlin'}))+'</p><input type="hidden" name="id" value="'+escape(grant.id)+'"><input type="hidden" name="csrf" value="'+csrf(env,request,'revoke:'+grant.id)+'"><button type="submit">Verbindung widerrufen</button></form>';
  if(!grants.results.length)body+='<p>Keine aktive Agent-Verbindung.</p>';
  return html(body+'<p><a href="/">Zum Panel</a></p>');
}

async function consent(env,request,now){
  const identity=await ownerIdentity(env,request);need(request.headers.get('origin')===env.PANEL_ORIGIN,'Ungültiger Ursprung.',403);
  const form=await boundedForm(request),hash=digest(cookie(request));
  need(equal(form.get('csrf'),csrf(env,request,'consent:'+hash)),'Diese Freigabe gehört nicht zur aktuellen Sitzung.',403);
  const record=await env.DB.prepare('SELECT * FROM agent_requests WHERE hash=? AND consumed=0 AND expires_at>?').bind(hash,now).first();need(record,'Verbindungsanfrage abgelaufen oder bereits verwendet.',409);
  const payload=JSON.parse(record.payload);need(['approve','deny'].includes(form.get('decision')),'Entscheidung fehlt.');
  if(form.get('decision')==='deny'){const claimed=await env.DB.prepare('UPDATE agent_requests SET consumed=1 WHERE hash=? AND consumed=0 AND expires_at>?').bind(hash,now).run();need(claimed.meta.changes,'Anfrage bereits entschieden.',409);return callback(env,payload,{error:'access_denied'});}
  const client=await clientMetadata(payload.clientId);need(client.redirects.includes(payload.redirectUri),'OpenAI-Rückruf wurde geändert.',409);
  const grantId=crypto.randomUUID(),code=rawToken(),codeHash=digest(code);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO agent_grants SELECT ?,?,?,?,?,?,?,0 WHERE EXISTS(SELECT 1 FROM agent_requests WHERE hash=? AND consumed=0 AND expires_at>?)').bind(grantId,identity,payload.clientId,payload.resource,payload.scopes,now,now+30*86400000,hash,now),
    env.DB.prepare('INSERT INTO agent_codes SELECT ?,?,?,?, ?,0 WHERE EXISTS(SELECT 1 FROM agent_grants WHERE id=?)').bind(codeHash,grantId,payload.redirectUri,payload.challenge,now+120000,grantId),
    env.DB.prepare('UPDATE agent_requests SET consumed=1 WHERE hash=? AND EXISTS(SELECT 1 FROM agent_grants WHERE id=?)').bind(hash,grantId)
  ]);
  need(await env.DB.prepare('SELECT hash FROM agent_codes WHERE hash=?').bind(codeHash).first(),'Anfrage bereits entschieden.',409);
  return callback(env,payload,{code});
}

async function issue(env,grant,guardSQL,guardArgs,consumeSQL,consumeArgs,now){
  const access=rawToken(),refresh=rawToken(),accessHash=digest(access);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO agent_tokens SELECT ?,?,\'access\',?,0 WHERE '+guardSQL).bind(accessHash,grant.id,Math.min(now+3600000,grant.expires_at),...guardArgs),
    env.DB.prepare('INSERT INTO agent_tokens SELECT ?,?,\'refresh\',?,0 WHERE EXISTS(SELECT 1 FROM agent_tokens WHERE hash=?)').bind(digest(refresh),grant.id,grant.expires_at,accessHash),
    env.DB.prepare(consumeSQL+' AND EXISTS(SELECT 1 FROM agent_tokens WHERE hash=?)').bind(...consumeArgs,accessHash)
  ]);
  need(await env.DB.prepare('SELECT hash FROM agent_tokens WHERE hash=?').bind(accessHash).first(),'invalid_grant',400);
  return response({access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:Math.floor((Math.min(now+3600000,grant.expires_at)-now)/1000),scope:grant.scopes});
}

async function tokenEndpoint(env,request,now){
  const form=await boundedForm(request),ip=(request.headers.get('x-forwarded-for')??'unknown').slice(0,80);
  need(!await limited(env,'agent-token:'+ip,now,100),'temporarily_unavailable',429);
  need(form.get('resource')===resource(env),'invalid_target',400);
  const kind=form.get('grant_type'),raw=form.get(kind==='authorization_code'?'code':'refresh_token');need(/^[a-f0-9]{64}$/.test(raw??''),'invalid_grant');
  const table=kind==='authorization_code'?'agent_codes':kind==='refresh_token'?'agent_tokens':null;need(table,'unsupported_grant_type');
  const row=await env.DB.prepare('SELECT * FROM '+table+' WHERE hash=?').bind(digest(raw)).first();need(row&&row.expires_at>now,'invalid_grant');
  const grant=await env.DB.prepare('SELECT * FROM agent_grants WHERE id=? AND revoked=0 AND expires_at>?').bind(row.grant_id,now).first();
  need(grant&&digest(grant.email)===env.OWNER_EMAIL_SHA256&&grant.client_id===form.get('client_id')&&grant.resource===resource(env),'invalid_grant');
  if(kind==='refresh_token'&&row.consumed){await env.DB.prepare('UPDATE agent_grants SET revoked=1 WHERE id=?').bind(grant.id).run();throw new AppError('invalid_grant');}
  need(!row.consumed,'invalid_grant');
  if(form.has('scope'))need(scopes(form.get('scope'))===grant.scopes,'invalid_scope');
  if(kind==='authorization_code'){
    const verifier=form.get('code_verifier');need(/^[A-Za-z0-9._~-]{43,128}$/.test(verifier??'')&&equal(createHash('sha256').update(verifier).digest('base64url'),row.challenge)&&form.get('redirect_uri')===row.redirect_uri,'invalid_grant');
  }else need(row.kind==='refresh','invalid_grant');
  const hash=digest(raw);
  return issue(env,grant,'EXISTS(SELECT 1 FROM '+table+' WHERE hash=? AND consumed=0 AND expires_at>?) AND EXISTS(SELECT 1 FROM agent_grants WHERE id=? AND revoked=0 AND expires_at>?)',[hash,now,grant.id,now],'UPDATE '+table+' SET consumed=1 WHERE hash=?',[hash],now);
}

export async function agentIdentity(env,request,now=Date.now()){
  const match=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization')??'');if(!match)return null;
  const row=await env.DB.prepare("SELECT g.*,t.expires_at token_expires_at FROM agent_tokens t JOIN agent_grants g ON g.id=t.grant_id WHERE t.hash=? AND t.kind='access' AND t.consumed=0 AND t.expires_at>? AND g.revoked=0 AND g.expires_at>?").bind(digest(match[1]),now,now).first();
  if(!row||digest(row.email)!==env.OWNER_EMAIL_SHA256||row.resource!==resource(env)||!row.scopes.split(' ').includes('panel:read'))return null;
  return {...row,token:match[1],scopeList:row.scopes.split(' ')};
}

export async function agentAuthEndpoint(env,request,now=Date.now()){
  const path=new URL(request.url).pathname;
  if(request.method==='GET'&&['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'].includes(path))return response({resource:resource(env),authorization_servers:[env.PANEL_ORIGIN],scopes_supported:scopesAllowed,bearer_methods_supported:['header'],resource_name:'White Gloss Panel'});
  if(request.method==='GET'&&path==='/.well-known/oauth-authorization-server')return response({issuer:env.PANEL_ORIGIN,authorization_endpoint:env.PANEL_ORIGIN+'/agent/oauth/authorize',token_endpoint:env.PANEL_ORIGIN+'/agent/oauth/token',revocation_endpoint:env.PANEL_ORIGIN+'/agent/oauth/revoke',authorization_response_iss_parameter_supported:true,client_id_metadata_document_supported:true,token_endpoint_auth_methods_supported:['none'],response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],scopes_supported:scopesAllowed});
  if(path==='/agent/oauth/authorize'&&request.method==='GET')return authorize(env,request,now);
  if(path==='/agent/connect'&&request.method==='GET')return connectionPage(env,request,now);
  if(path==='/agent/oauth/consent'&&request.method==='POST')return consent(env,request,now);
  if(path==='/agent/oauth/token'&&request.method==='POST'){try{return await tokenEndpoint(env,request,now);}catch(error){return response({error:error instanceof AppError?error.message:'server_error'},error instanceof AppError?error.status:500);}}
  if(path==='/agent/oauth/revoke-grant'&&request.method==='POST'){
    const identity=await ownerIdentity(env,request),form=await boundedForm(request),id=form.get('id');need(request.headers.get('origin')===env.PANEL_ORIGIN&&equal(form.get('csrf'),csrf(env,request,'revoke:'+id)),'Ungültiger Ursprung oder Sitzung.',403);
    await env.DB.prepare('UPDATE agent_grants SET revoked=1 WHERE id=? AND email=?').bind(id,identity).run();return Response.redirect(env.PANEL_ORIGIN+'/agent/connect',303);
  }
  if(path==='/agent/oauth/revoke'&&request.method==='POST'){
    const form=await boundedForm(request),hash=digest(form.get('token')??'');await env.DB.prepare('UPDATE agent_grants SET revoked=1 WHERE client_id=? AND id IN(SELECT grant_id FROM agent_tokens WHERE hash=?)').bind(form.get('client_id'),hash).run();return response({});
  }
  return null;
}

export async function pruneAgentAuth(env,now=Date.now()){await env.DB.batch([
  env.DB.prepare('DELETE FROM agent_requests WHERE expires_at<?').bind(now-86400000),
  env.DB.prepare('DELETE FROM agent_codes WHERE expires_at<?').bind(now-86400000),
  env.DB.prepare('DELETE FROM agent_tokens WHERE expires_at<?').bind(now-86400000)
]);}
