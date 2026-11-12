import test from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {fixture,origin,redirect,verifier} from './mcp-fixture.mjs';

// Regression: browser HTML form submissions may send Origin: null when the
// consent document advertises Referrer-Policy: no-referrer. An origin-only
// policy preserves the real Origin without exposing OAuth query parameters.
test('application preserves OAuth consent policy, strict CSRF checks and read-only token exchange',async t=>{
  const f=await fixture(t);
  const app=await createApplication({...f.env,ASSETS:{fetch:async()=>new Response('asset')}});
  const session='a'.repeat(64),cookie='__Host-wg-session='+session;
  await f.env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(session),'owner@example.test',Date.now()+3600000,Date.now()).run();
  const call=(path,body=null,headers={})=>app.fetch(new Request(origin+path,{method:body===null?'GET':'POST',headers:body===null?headers:{'content-type':'application/x-www-form-urlencoded',...headers},...(body===null?{}:{body:new URLSearchParams(body).toString()})}));
  const authorization='/auth/mcp/authorize?'+new URLSearchParams(f.params);
  const login=await call(authorization);
  assert.equal(login.status,200);
  assert.equal(login.headers.get('referrer-policy'),'origin');
  assert.match(await login.text(),/Betreiberanmeldung erforderlich/);
  const response=await call(authorization,null,{cookie});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('referrer-policy'),'origin');
  assert.equal(response.headers.get('content-security-policy'),"default-src 'none'; form-action 'self' https://chatgpt.com; frame-ancestors 'none'; base-uri 'none'");
  const html=await response.text();
  assert.match(html,/<form method="post" action="\/auth\/mcp\/authorize">/);
  const consent=html.match(/name="consent" value="([^"]+)"/)?.[1];
  assert.ok(consent);
  for(const unwanted of [undefined,'null','https://evil.example']){
    const blocked=await call('/auth/mcp/authorize',{consent,decision:'allow'},{cookie,...(unwanted===undefined?{}:{origin:unwanted})});
    assert.equal(blocked.status,403,'An unknown Origin must remain forbidden');
    assert.equal(blocked.headers.get('referrer-policy'),'no-referrer');
    assert.equal((await blocked.json()).error,'invalid_origin');
  }
  const accepted=await call('/auth/mcp/authorize',{consent,decision:'allow'},{cookie,origin});
  assert.equal(accepted.status,303);
  assert.equal(accepted.headers.get('referrer-policy'),'no-referrer');
  const callback=new URL(accepted.headers.get('location'));
  assert.equal(callback.origin+callback.pathname,redirect);
  assert.equal(callback.searchParams.get('state'),f.params.state);
  const tokenResponse=await call('/auth/mcp/token',{grant_type:'authorization_code',client_id:f.params.client_id,redirect_uri:redirect,resource:origin+'/mcp',code:callback.searchParams.get('code'),code_verifier:verifier});
  assert.equal(tokenResponse.status,200);
  assert.equal(tokenResponse.headers.get('referrer-policy'),'no-referrer');
  const token=await tokenResponse.json();
  assert.equal(token.scope,'panel:read');
  const profile=await app.fetch(new Request(origin+'/mcp',{method:'POST',headers:{authorization:'Bearer '+token.access_token,accept:'application/json, text/event-stream','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'panel_profile',arguments:{}}})}));
  assert.equal(profile.status,200);
  assert.equal(profile.headers.get('referrer-policy'),'no-referrer');
  assert.equal((await profile.json()).result.isError,false);
  for(const [path,status] of [['/.well-known/oauth-authorization-server',200],['/healthz',200],['/auth/login',200],['/mcp',401],['/auth/mcp/authorize',400]]){
    const other=await call(path);
    assert.equal(other.status,status);
    assert.equal(other.headers.get('referrer-policy'),'no-referrer',path+' must keep the default policy');
    assert.ok(!other.headers.get('content-security-policy').includes('https://chatgpt.com'),path+' must not allow the OAuth callback as a form target');
  }
});
