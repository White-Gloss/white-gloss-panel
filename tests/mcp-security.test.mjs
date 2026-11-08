import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,origin} from './mcp-fixture.mjs';
import {handleMcp} from '../server/mcp.mjs';
import {PanelDatabase} from '../server/storage.mjs';
import {mcpMaintenance} from '../server/mcp-auth.mjs';
const initBody=JSON.stringify({jsonrpc:'2.0',id:42,method:'initialize',params:{protocolVersion:'2025-11-25'}});
const initRequest=access=>new Request(origin+'/mcp',{method:'POST',headers:{authorization:'Bearer '+access,'content-type':'application/json',accept:'application/json, text/event-stream'},body:initBody});
test('expired, wrong-owner, audience, scope and revoked grants fail closed',async t=>{
 const f=await fixture(t),tokens=await (await f.exchange(await f.grant())).json();
 for(const [column,value] of [['owner','customer'],['resource','https://evil.example'],['scope','panel:write'],['client','other-client'],['expires',0],['revoked',1]]){
  const previous=f.env.DB.sql.prepare('SELECT '+column+' value FROM mcp_grants').get().value;
  f.env.DB.sql.prepare('UPDATE mcp_grants SET '+column+'=?').run(value);
  assert.equal((await handleMcp(f.env,initRequest(tokens.access_token))).status,401,column);
  f.env.DB.sql.prepare('UPDATE mcp_grants SET '+column+'=?').run(previous);
 }
 f.env.DB.sql.prepare("UPDATE mcp_tokens SET expires=0 WHERE kind='access'").run();assert.equal((await handleMcp(f.env,initRequest(tokens.access_token))).status,401);
 const second=await (await f.exchange(await f.grant())).json();
 assert.equal((await f.call('/auth/mcp/revoke',{client_id:'test-client',token:second.refresh_token})).status,200);
 assert.equal((await handleMcp(f.env,initRequest(second.access_token))).status,401);
});
test('concurrent code exchange elects one caller and consent is single-use',async t=>{
 const f=await fixture(t),code=await f.grant(),responses=await Promise.all([f.exchange(code),f.exchange(code)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);
 assert.equal(f.env.DB.sql.prepare("SELECT count(*) n FROM mcp_tokens WHERE kind='access'").get().n,1);
 const consent=await f.consent(),body={consent,decision:'allow'},headers={cookie:'owner',origin};
 assert.equal((await f.call('/auth/mcp/authorize',body,headers)).status,303);assert.equal((await f.call('/auth/mcp/authorize',body,headers)).status,403);
 const deny=await f.call('/auth/mcp/authorize',{consent:await f.consent(),decision:'deny'},headers);assert.equal(new URL(deny.headers.get('location')).searchParams.get('error'),'access_denied');
});
test('tokens survive database close/reopen and maintenance never touches business data',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'wg-mcp-')),filename=join(dir,'panel.sqlite');
 const f=await fixture(t);f.env.DB.close();f.env.DB=new PanelDatabase(filename);
 const tokens=await (await f.exchange(await f.grant())).json();f.env.DB.close();f.env.DB=new PanelDatabase(filename);
 const response=await handleMcp({...f.env},initRequest(tokens.access_token));assert.equal(response.status,200);assert.equal((await response.json()).result.protocolVersion,'2025-11-25');
 await mcpMaintenance(f.env,Date.now()+31*86400000);assert.equal((await handleMcp(f.env,initRequest(tokens.access_token))).status,401);
 t.after(()=>rm(dir,{recursive:true,force:true}));
});
test('invalid config stays disabled and MCP body/rate limits are enforced',async t=>{
 const f=await fixture(t);assert.equal((await handleMcp({...f.env,PANEL_MCP_REDIRECT_URI:'http://evil.example'},new Request(origin+'/mcp'))).status,404);
 const tokens=await (await f.exchange(await f.grant())).json();
 const oversized=new Request(origin+'/mcp',{method:'POST',headers:{authorization:'Bearer '+tokens.access_token,'content-type':'application/json',accept:'application/json, text/event-stream'},body:'x'.repeat(20000)});assert.equal((await handleMcp(f.env,oversized)).status,413);
 f.env.DB.sql.prepare("UPDATE mcp_rates SET count=120 WHERE kind LIKE 'mcp%'").run();assert.equal((await handleMcp(f.env,initRequest(tokens.access_token))).status,429);
});
test('anonymous traffic cannot consume the authorized owner quota',async t=>{
 const f=await fixture(t),tokens=await (await f.exchange(await f.grant())).json();
 for(let i=0;i<125;i++)await f.call('/mcp');
 assert.equal((await handleMcp(f.env,initRequest(tokens.access_token))).status,200);
});
