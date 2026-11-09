import test from 'node:test';
import assert from 'node:assert/strict';
import {browserFixture,origin} from './harness.mjs';
import {challenge,verifier} from '../tests/mcp-fixture.mjs';

const redirect='https://chatgpt.com/connector_platform_oauth_redirect';
for(const decision of ['allow','deny'])test(`MCP consent ${decision} permits the registered ChatGPT callback navigation in Chromium`,async t=>{
  const f=await browserFixture(t);
  // Playwright does not re-route 3xx hops. Offline mode prevents external traffic
  // while fulfilled panel requests still exercise real browser CSP/navigation.
  await f.context.setOffline(true);
  Object.assign(f.env,{PANEL_MCP_ENABLED:'true',PANEL_MCP_CLIENT_ID:'test-client',PANEL_MCP_REDIRECT_URI:redirect});
  const params={response_type:'code',client_id:'test-client',redirect_uri:redirect,scope:'panel:read',state:'browser-fixture',resource:origin+'/mcp',code_challenge:challenge,code_challenge_method:'S256'};
  let callbackRequest,submittedOrigin;
  f.page.on('request',request=>{const url=new URL(request.url());if(url.origin+url.pathname===redirect)callbackRequest=request;});
  // Override the generic harness route: this test must use the real browser Origin.
  await f.page.route(origin+'/auth/mcp/**',async route=>{
    const request=route.request(),headers=await request.allHeaders();
    if(request.method()==='POST')submittedOrigin=headers.origin;
    const response=await f.app.fetch(new Request(request.url(),{method:request.method(),headers,body:request.postDataBuffer()??undefined}));
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  });
  await f.page.goto(origin+'/auth/mcp/authorize?'+new URLSearchParams(params));
  await f.page.getByRole('button',{name:decision==='allow'?'Lesezugriff erlauben':'Ablehnen',exact:true}).click();
  await f.page.waitForURL(url=>url.origin+url.pathname===redirect,{timeout:5000});
  assert.equal(submittedOrigin,origin);
  assert.ok(callbackRequest,'The browser must attempt the registered callback');
  assert.equal(callbackRequest.method(),'GET');
  const callback=new URL(f.page.url());
  assert.equal(callback.searchParams.get('state'),params.state);
  assert.equal(callback.searchParams.get('iss'),origin);
  if(decision==='deny'){
    assert.equal(callback.searchParams.get('error'),'access_denied');
    assert.equal(callback.searchParams.has('code'),false);
  }else{
    const response=await f.app.fetch(new Request(origin+'/auth/mcp/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:params.client_id,redirect_uri:redirect,resource:params.resource,code:callback.searchParams.get('code'),code_verifier:verifier})}));
    assert.equal(response.status,200);
    const token=await response.json();assert.equal(token.scope,'panel:read');
    const profile=await f.app.fetch(new Request(origin+'/mcp',{method:'POST',headers:{authorization:'Bearer '+token.access_token,accept:'application/json, text/event-stream','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'panel_profile',arguments:{}}})}));
    assert.equal(profile.status,200);
    const result=await profile.json();assert.equal(result.result.isError,false);assert.equal(result.result.structuredContent.mode,'read-only');
  }
  assert.deepEqual(f.errors,[]);
});
