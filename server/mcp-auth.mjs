import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

export const MCP_SCOPE='panel:read';
export const mcpHash=value=>createHash('sha256').update(value).digest('hex');
const random=()=>randomBytes(32).toString('base64url');
export const mcpJson=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer',...headers}});
export class McpError extends Error {constructor(code,status=400){super(code);this.status=status;}}
const requireValue=(ok,code='invalid_request',status=400)=>{if(!ok)throw new McpError(code,status);};
export function mcpConfig(env){
  if(env.PANEL_MCP_ENABLED!=='true')return null;
  try{
    const origin=new URL(env.PANEL_ORIGIN),redirect=new URL(env.PANEL_MCP_REDIRECT_URI);
    if(origin.protocol!=='https:'||origin.origin!==env.PANEL_ORIGIN||redirect.protocol!=='https:'||redirect.username||redirect.password||redirect.hash||!env.PANEL_MCP_CLIENT_ID||! /^[a-f0-9]{64}$/.test(env.OWNER_EMAIL_SHA256??'')||Buffer.from(env.CONFIG_KEY??'','base64').length!==32)return null;
    return {origin:origin.origin,resource:origin.origin+'/mcp',client:env.PANEL_MCP_CLIENT_ID,redirect:redirect.href,owner:env.OWNER_EMAIL_SHA256};
  }catch{return null;}
}
export async function mcpSchema(env){
  await env.DB.batch([
    'CREATE TABLE IF NOT EXISTS mcp_codes(hash TEXT PRIMARY KEY,client TEXT NOT NULL,redirect TEXT NOT NULL,resource TEXT NOT NULL,owner TEXT NOT NULL,challenge TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0)',
    'CREATE TABLE IF NOT EXISTS mcp_grants(id TEXT PRIMARY KEY,owner TEXT NOT NULL,client TEXT NOT NULL,resource TEXT NOT NULL,scope TEXT NOT NULL,expires INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0)',
    'CREATE TABLE IF NOT EXISTS mcp_tokens(hash TEXT PRIMARY KEY,grant_id TEXT NOT NULL REFERENCES mcp_grants(id),kind TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0)',
    'CREATE INDEX IF NOT EXISTS mcp_tokens_grant ON mcp_tokens(grant_id)',
    'CREATE TABLE IF NOT EXISTS mcp_consents(hash TEXT PRIMARY KEY,expires INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS mcp_rates(bucket INTEGER NOT NULL,kind TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(bucket,kind))'
  ].map(sql=>env.DB.prepare(sql)));
}
export async function mcpLimit(env,kind,max=120){
  const bucket=Math.floor(Date.now()/60000);
  await env.DB.prepare('INSERT INTO mcp_rates VALUES(?,?,1) ON CONFLICT(bucket,kind) DO UPDATE SET count=count+1').bind(bucket,kind).run();
  await env.DB.prepare('DELETE FROM mcp_rates WHERE bucket<?').bind(bucket-2).run();
  const row=await env.DB.prepare('SELECT count FROM mcp_rates WHERE bucket=? AND kind=?').bind(bucket,kind).first();
  requireValue(row.count<=max,'rate_limit_exceeded',429);
}
export async function mcpBody(request,max=16384){
  const reader=request.body?.getReader();if(!reader)return '';
  let size=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){void reader.cancel();throw new McpError('request_too_large',413);}chunks.push(value);}return Buffer.concat(chunks).toString('utf8');}finally{reader.releaseLock();}
}
function unique(params){for(const key of params.keys())requireValue(params.getAll(key).length===1);return Object.fromEntries(params);}
function authorizeParams(config,params){
  const p=unique(params);
  requireValue(p.client_id===config.client&&p.redirect_uri===config.redirect&&p.resource===config.resource);
  requireValue(p.response_type==='code'&&p.scope===MCP_SCOPE&&p.code_challenge_method==='S256'&&/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge??''));
  requireValue(typeof p.state==='string'&&p.state.length>0&&p.state.length<=1024);
  return p;
}
function signed(env,value){const body=Buffer.from(JSON.stringify(value)).toString('base64url');return body+'.'+createHmac('sha256',Buffer.from(env.CONFIG_KEY,'base64')).update(body).digest('base64url');}
function verified(env,value){
  requireValue(typeof value==='string'&&value.length<=8000);const [body,signature,...rest]=value.split('.');
  requireValue(rest.length===0&&/^[A-Za-z0-9_-]{43}$/.test(signature??''));
  const expected=createHmac('sha256',Buffer.from(env.CONFIG_KEY,'base64')).update(body).digest();
  const supplied=Buffer.from(signature,'base64url');requireValue(supplied.length===expected.length&&timingSafeEqual(expected,supplied),'invalid_consent',403);
  try{return JSON.parse(Buffer.from(body,'base64url').toString());}catch{throw new McpError('invalid_consent',403);}
}
const html=body=>new Response('<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>White-Gloss · ChatGPT-Verbindung</title><body><main>'+body+'</main></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}});
async function ownerIdentity(env,request,resolveIdentity){
  const identity=await resolveIdentity(request);if(!identity)return null;
  requireValue(mcpHash(identity)===env.OWNER_EMAIL_SHA256,'owner_required',403);return identity;
}
function challenge(config){return mcpJson({error:'invalid_token'},401,{'WWW-Authenticate':`Bearer resource_metadata="${config.origin}/.well-known/oauth-protected-resource/mcp", scope="${MCP_SCOPE}"`});}
export async function mcpAuthenticate(env,request,config){
  const raw=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization')??'')?.[1];
  if(!raw)return challenge(config);
  const row=await env.DB.prepare('SELECT g.*,t.expires token_expires FROM mcp_tokens t JOIN mcp_grants g ON g.id=t.grant_id WHERE t.hash=? AND t.kind=\'access\'').bind(mcpHash(raw)).first();
  if(!row||row.revoked||row.owner!==config.owner||row.client!==config.client||row.resource!==config.resource||row.scope!==MCP_SCOPE||row.expires<=Date.now()||row.token_expires<=Date.now())return challenge(config);
  return row;
}
async function issueTokens(env,grant,claim){
  const access=random(),refresh=random(),now=Date.now();
  // Claim and token creation share the same BEGIN IMMEDIATE transaction. A losing
  // concurrent exchange cannot mint usable tokens.
  const results=await env.DB.batch([
    claim,
    env.DB.prepare('INSERT INTO mcp_tokens SELECT ?,?,\'access\',?,0 WHERE changes()=1').bind(mcpHash(access),grant,now+900000),
    env.DB.prepare('INSERT INTO mcp_tokens SELECT ?,?,\'refresh\',?,0 WHERE changes()=1').bind(mcpHash(refresh),grant,now+30*86400000)
  ]);
  requireValue(results[0].meta.changes===1,'invalid_grant');
  return mcpJson({access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:900,scope:MCP_SCOPE});
}
export async function handleMcpOAuth(env,request,config,resolveIdentity){
  const url=new URL(request.url),path=url.pathname;
  if(path.startsWith('/.well-known/')){
    if(request.method!=='GET')return mcpJson({error:'method_not_allowed'},405,{Allow:'GET'});
    if(['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'].includes(path))return mcpJson({resource:config.resource,authorization_servers:[config.origin],scopes_supported:[MCP_SCOPE],bearer_methods_supported:['header']});
    if(path==='/.well-known/oauth-authorization-server')return mcpJson({issuer:config.origin,authorization_endpoint:config.origin+'/auth/mcp/authorize',token_endpoint:config.origin+'/auth/mcp/token',revocation_endpoint:config.origin+'/auth/mcp/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],revocation_endpoint_auth_methods_supported:['none'],scopes_supported:[MCP_SCOPE],authorization_response_iss_parameter_supported:true});
    return mcpJson({error:'not_found'},404);
  }
  if(path==='/auth/mcp/authorize'&&request.method==='GET'){
    const params=authorizeParams(config,url.searchParams),identity=await ownerIdentity(env,request,resolveIdentity);
    if(!identity)return html('<h1>Betreiberanmeldung erforderlich</h1><p><a href="/auth/login" target="_blank" rel="noopener noreferrer">Im Panel anmelden</a>. Anschließend diesen Tab neu laden. Kundenkonten können keine ChatGPT-Verbindung freigeben.</p>');
    await mcpLimit(env,'consent:'+config.owner,60);
    const consent=signed(env,{params,session:mcpHash(request.headers.get('cookie')??''),expires:Date.now()+300000,nonce:random()});
    return html('<h1>White-Gloss Panel mit ChatGPT verbinden</h1><p>ChatGPT darf Aufträge, Kunden, Fahrzeuge, bestätigte Termine, Nachrichten und Finanzdaten lesen. Keine Änderungen oder Nachrichtenversände. Nur freigeben, wenn du diese Verbindung selbst in ChatGPT gestartet hast.</p><form method="post" action="/auth/mcp/authorize"><input type="hidden" name="consent" value="'+consent+'"><button name="decision" value="allow">Lesezugriff erlauben</button> <button name="decision" value="deny">Ablehnen</button></form>');
  }
  if(!['/auth/mcp/authorize','/auth/mcp/token','/auth/mcp/revoke'].includes(path))return mcpJson({error:'not_found'},404);
  if(request.method!=='POST')return mcpJson({error:'method_not_allowed'},405,{Allow:'POST'});
  requireValue(/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get('content-type')??''),'unsupported_media_type',415);
  const p=unique(new URLSearchParams(await mcpBody(request)));
  if(path==='/auth/mcp/authorize'){
    requireValue(request.headers.get('origin')===config.origin,'invalid_origin',403);
    requireValue(await ownerIdentity(env,request,resolveIdentity),'owner_required',403);
    const saved=verified(env,p.consent);requireValue(saved.expires>Date.now()&&saved.session===mcpHash(request.headers.get('cookie')??''),'invalid_consent',403);
    const params=authorizeParams(config,new URLSearchParams(saved.params));
    requireValue(['allow','deny'].includes(p.decision));
    const used=await env.DB.prepare('INSERT OR IGNORE INTO mcp_consents VALUES(?,?)').bind(mcpHash(p.consent),saved.expires).run();requireValue(used.meta.changes===1,'invalid_consent',403);
    const target=new URL(config.redirect);target.searchParams.set('state',params.state);target.searchParams.set('iss',config.origin);
    if(p.decision==='deny')target.searchParams.set('error','access_denied');
    else{const code=random();await env.DB.prepare('INSERT INTO mcp_codes(hash,client,redirect,resource,owner,challenge,expires) VALUES(?,?,?,?,?,?,?)').bind(mcpHash(code),config.client,config.redirect,config.resource,config.owner,params.code_challenge,Date.now()+60000).run();target.searchParams.set('code',code);}
    return new Response(null,{status:303,headers:{Location:target.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  }
  requireValue(p.client_id===config.client,'invalid_client');
  if(path==='/auth/mcp/revoke'){
    requireValue(typeof p.token==='string'&&p.token.length<=512);
    await env.DB.prepare('UPDATE mcp_grants SET revoked=1 WHERE client=? AND id IN (SELECT grant_id FROM mcp_tokens WHERE hash=?)').bind(config.client,mcpHash(p.token)).run();return mcpJson({});
  }
  requireValue(p.resource===config.resource,'invalid_target');requireValue(!p.scope||p.scope===MCP_SCOPE,'invalid_scope');
  if(p.grant_type==='authorization_code'){
    requireValue(typeof p.code==='string'&&p.redirect_uri===config.redirect&&/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier??''),'invalid_grant');
    const row=await env.DB.prepare('SELECT * FROM mcp_codes WHERE hash=?').bind(mcpHash(p.code)).first();
    requireValue(row&&!row.used&&row.expires>Date.now()&&row.owner===config.owner&&row.client===config.client&&row.redirect===config.redirect&&row.resource===config.resource&&row.challenge===createHash('sha256').update(p.code_verifier).digest('base64url'),'invalid_grant');
    await mcpLimit(env,'exchange:'+config.owner,60);
    const grant=random();
    // Create the empty grant before the guarded exchange; concurrent losers have no tokens.
    await env.DB.prepare('INSERT INTO mcp_grants VALUES(?,?,?,?,?,?,0)').bind(grant,config.owner,config.client,config.resource,MCP_SCOPE,Date.now()+30*86400000).run();
    return issueTokens(env,grant,env.DB.prepare('UPDATE mcp_codes SET used=1 WHERE hash=? AND used=0 AND expires>?').bind(row.hash,Date.now()));
  }
  if(p.grant_type==='refresh_token'){
    requireValue(typeof p.refresh_token==='string'&&p.refresh_token.length<=512,'invalid_grant');
    const row=await env.DB.prepare('SELECT t.*,g.revoked,g.owner,g.client,g.resource,g.scope,g.expires grant_expires FROM mcp_tokens t JOIN mcp_grants g ON g.id=t.grant_id WHERE t.hash=? AND t.kind=\'refresh\'').bind(mcpHash(p.refresh_token)).first();
    requireValue(row&&row.owner===config.owner&&row.client===config.client&&row.resource===config.resource&&row.scope===MCP_SCOPE,'invalid_grant');
    if(row.used){await env.DB.prepare('UPDATE mcp_grants SET revoked=1 WHERE id=?').bind(row.grant_id).run();throw new McpError('invalid_grant');}
    requireValue(!row.revoked&&row.expires>Date.now()&&row.grant_expires>Date.now(),'invalid_grant');
    await mcpLimit(env,'refresh:'+row.grant_id,60);
    try{return await issueTokens(env,row.grant_id,env.DB.prepare('UPDATE mcp_tokens SET used=1 WHERE hash=? AND used=0 AND expires>? AND EXISTS(SELECT 1 FROM mcp_grants WHERE id=? AND revoked=0 AND expires>?)').bind(row.hash,Date.now(),row.grant_id,Date.now()));}
    catch(error){if(error instanceof McpError)await env.DB.prepare('UPDATE mcp_grants SET revoked=1 WHERE id=?').bind(row.grant_id).run();throw error;}
  }
  throw new McpError('unsupported_grant_type');
}
export async function mcpMaintenance(env,now=Date.now()){
  await env.DB.batch([
    env.DB.prepare('DELETE FROM mcp_codes WHERE expires<?').bind(now),
    env.DB.prepare('DELETE FROM mcp_consents WHERE expires<?').bind(now),
    env.DB.prepare('DELETE FROM mcp_tokens WHERE grant_id IN (SELECT id FROM mcp_grants WHERE expires<?)').bind(now),
    env.DB.prepare('DELETE FROM mcp_grants WHERE expires<?').bind(now),
    env.DB.prepare('DELETE FROM mcp_rates WHERE bucket<?').bind(Math.floor(now/60000)-2)
  ]);
}

