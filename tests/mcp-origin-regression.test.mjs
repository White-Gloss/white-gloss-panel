import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,origin} from './mcp-fixture.mjs';

// Regression: browser HTML form submissions may send Origin: null when the
// consent document advertises Referrer-Policy: no-referrer. An origin-only
// policy preserves the real Origin without exposing OAuth query parameters.
test('OAuth consent page preserves a verifiable form Origin and strict CSRF checks',async t=>{
  const f=await fixture(t);
  const response=await f.call('/auth/mcp/authorize?'+new URLSearchParams(f.params),null,{cookie:'owner'});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('referrer-policy'),'origin');
  assert.match(response.headers.get('content-security-policy')??'',/form-action 'self'/);
  const html=await response.text();
  assert.match(html,/<form method="post" action="\/auth\/mcp\/authorize">/);
  const consent=html.match(/name="consent" value="([^"]+)"/)?.[1];
  assert.ok(consent);
  for(const unwanted of ['null','https://evil.example']){
    const blocked=await f.call('/auth/mcp/authorize',{consent,decision:'allow'},{cookie:'owner',origin:unwanted});
    assert.equal(blocked.status,403,'An unknown Origin must remain forbidden');
  }
  const accepted=await f.call('/auth/mcp/authorize',{consent,decision:'allow'},{cookie:'owner',origin});
  assert.equal(accepted.status,303);
  const redirect=new URL(accepted.headers.get('location'));
  assert.equal(redirect.origin,'https://chatgpt.com');
  const api=await f.call('/.well-known/oauth-authorization-server');
  assert.equal(api.headers.get('referrer-policy'),'no-referrer');
});
