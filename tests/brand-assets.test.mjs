import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {PanelDatabase,StaticAssets} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';

test('same-origin brand stylesheet and WOFF2 fonts load before authentication without exposing private files',async t=>{
  const env={PANEL_ORIGIN:'https://panel.example.invalid',OWNER_EMAIL_SHA256:digest('owner@example.invalid'),CONFIG_KEY:Buffer.alloc(32,8).toString('base64'),DB:new PanelDatabase(':memory:'),ASSETS:new StaticAssets(resolve('public'))};
  t.after(()=>env.DB.close());const app=await createApplication(env);
  for(const path of ['/brand.css','/barlow-latin.woff2','/barlow-latin-medium.woff2','/barlow-latin-semibold.woff2']){
    const response=await app.fetch(new Request(env.PANEL_ORIGIN+path));assert.equal(response.status,200,path);
    assert.equal(response.headers.get('content-type'),path.endsWith('.woff2')?'font/woff2':'text/css; charset=utf-8');
    const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.length>1000);
    if(path.endsWith('.woff2'))assert.equal(bytes.subarray(0,4).toString(),'wOF2');
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  }
  const login=await app.fetch(new Request(env.PANEL_ORIGIN+'/auth/login'));assert.match(await login.text(),/href="\/brand\.css"/);
  assert.equal((await app.fetch(new Request(env.PANEL_ORIGIN+'/private.woff2'))).status,404);
  assert.equal((await app.fetch(new Request(env.PANEL_ORIGIN+'/environment.key'))).status,303);
  assert.equal((await app.fetch(new Request(env.PANEL_ORIGIN+'/api/state'))).status,401);
});
