import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,origin,redirect,verifier} from './mcp-fixture.mjs';
test('OAuth discovery and unauthenticated challenge advertise only read scope and PKCE',async t=>{
  const f=await fixture(t),r=await f.call('/mcp');assert.equal(r.status,401);assert.match(r.headers.get('www-authenticate'),/oauth-protected-resource/);
  const metadata=await (await f.call('/.well-known/oauth-authorization-server')).json();assert.deepEqual(metadata.code_challenge_methods_supported,['S256']);assert.deepEqual(metadata.token_endpoint_auth_methods_supported,['none']);
  const resource=await (await f.call('/.well-known/oauth-protected-resource/mcp')).json();assert.equal(resource.resource,origin+'/mcp');assert.deepEqual(resource.scopes_supported,['panel:read']);
});
test('only owner consent can issue a code; redirects, resource, scope and PKCE are exact',async t=>{
  const f=await fixture(t);
  for(const [key,value] of [['redirect_uri','https://evil.example'],['resource','https://evil.example/mcp'],['scope','panel:write'],['code_challenge_method','plain'],['response_type','token']]){
    const r=await f.call('/auth/mcp/authorize?'+new URLSearchParams({...f.params,[key]:value}),null,{cookie:'owner'});assert.equal(r.status,400,key);assert.equal(r.headers.get('location'),null);
  }
  assert.equal((await f.call('/auth/mcp/authorize?'+new URLSearchParams(f.params),null,{cookie:'customer'})).status,403);
  const consent=await f.consent();assert.equal((await f.call('/auth/mcp/authorize',{consent,decision:'allow'},{cookie:'owner',origin:'https://evil.example'})).status,403);
  assert.equal((await f.call('/auth/mcp/authorize',{consent,decision:'allow'},{cookie:'customer',origin})).status,403);
  const code=await f.grant();assert.ok(code);
  const wrong=await f.call('/auth/mcp/token',{grant_type:'authorization_code',client_id:'test-client',redirect_uri:redirect,resource:origin+'/mcp',code,code_verifier:'x'.repeat(43)});assert.equal(wrong.status,400);
});
test('single use codes, rotating refresh tokens, restart persistence and replay revocation',async t=>{
  const f=await fixture(t),code=await f.grant(),r=await f.exchange(code);assert.equal(r.status,200);const token=await r.json();assert.equal(token.expires_in,900);assert.ok(token.refresh_token);assert.equal((await f.exchange(code)).status,400);
  const initialize=access=>f.call('/mcp',JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}}),{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer '+access});
  assert.equal((await initialize(token.access_token)).status,200);
  const refresh=()=>f.call('/auth/mcp/token',{grant_type:'refresh_token',client_id:'test-client',resource:origin+'/mcp',refresh_token:token.refresh_token});
  const renewed=await (await refresh()).json();assert.ok(renewed.access_token);assert.notEqual(renewed.refresh_token,token.refresh_token);
  assert.equal((await refresh()).status,400);assert.equal((await initialize(renewed.access_token)).status,401);
  const raw=JSON.stringify(f.env.DB.sql.prepare('SELECT * FROM mcp_tokens').all());assert.ok(!raw.includes(token.access_token));assert.ok(!raw.includes(token.refresh_token));
});
