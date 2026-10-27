import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid';
const pdf=Buffer.from('%PDF-1.7\nsynthetic assistant receipt\n%%EOF');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function providerResult(result){return {id:'resp_synthetic',status:'completed',model:'synthetic-vision',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]};}
async function fixture(t,adapter){
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,body,options){files.set(id,{body:new Uint8Array(body),httpMetadata:options?.httpMetadata??{}});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('asset')},ASSISTANT_ADAPTERS:adapter};
  t.after(()=>env.DB.close());const app=await createApplication(env),raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+3600000,Date.now()).run();
  const customerRaw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(customerRaw),'customer@example.invalid',Date.now()+3600000,Date.now()).run();
  const call=(path,body,role='owner')=>app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,cookie:'__Host-wg-session='+(role==='owner'?raw:customerRaw),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}));
  return {env,app,call,files};
}
async function settings(f){const response=await f.call('/api/assistant/settings',{apiKey:'synthetic-assistant-secret',model:'synthetic-vision',dataApproved:true});assert.equal(response.status,200,await response.text());assert.equal((await f.call('/api/assistant/check',{})).status,200);}
async function receipt(f){const id=randomUUID(),at=new Date().toISOString();await f.files.set(id,{body:pdf,httpMetadata:{contentType:'application/pdf'}});await f.env.DB.prepare('INSERT INTO accounting_documents VALUES(?,?,?,?,?,?,?,?)').bind(id,0,'Lieferant.pdf','application/pdf',sha256(pdf),pdf.length,at,'PANEL').run();return id;}

test('assistant credentials stay encrypted and connection check sends no customer content',async t=>{
  const checks=[],analyses=[];const f=await fixture(t,{async check(config){checks.push(config);},async analyze(){analyses.push(true);}});
  await f.call('/api/assistant/settings',{apiKey:'synthetic-assistant-secret',model:'synthetic-vision',dataApproved:true});
  const stored=await f.env.DB.prepare('SELECT * FROM assistant_settings WHERE id=1').first();assert.equal(stored.api_key.includes('synthetic-assistant-secret'),false);
  const view=await (await f.call('/api/assistant')).json();assert.equal(JSON.stringify(view).includes('synthetic-assistant-secret'),false);assert.equal(view.settings.verifiedAt,null);
  assert.equal((await f.call('/api/assistant/check',{})).status,200);assert.equal(checks.length,1);assert.equal(analyses.length,0);
  assert.equal((await f.call('/api/assistant',undefined,'customer')).status,403);
});

test('receipt analysis is an immutable suggestion and never classifies or posts the receipt',async t=>{
  const requests=[];const f=await fixture(t,{async check(){},async analyze(config,payload){requests.push({config,payload});return providerResult({category:'CLEANING_SUPPLIES',paymentPath:'UNKNOWN',amountMinor:11900,documentDate:'2026-10-17',partner:'Synthetischer Lieferant',note:'Bitte Zahlungsweg prüfen.',confidence:0.82,warnings:['Mehrwertsteuer nicht separat geprüft']});}});
  await settings(f);const id=await receipt(f),requestId=randomUUID(),input={requestId,kind:'receipt',sourceId:id,confirmed:true};
  const response=await f.call('/api/assistant/analyze',input),raw=await response.text();assert.equal(response.status,200,raw);const first=JSON.parse(raw);assert.equal(first.suggestion.result.amountMinor,11900);assert.equal(first.suggestion.result.category,'CLEANING_SUPPLIES');
  assert.match(requests[0].payload.input[0].content[0].file_data,/^data:application\/pdf;base64,/);assert.equal(requests[0].payload.store,false);assert.equal(requests[0].payload.text.format.type,'json_schema');
  const duplicate=await (await f.call('/api/assistant/analyze',input)).json();assert.equal(duplicate.duplicate,true);assert.equal(requests.length,1);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM accounting_classifications').first()).n,0);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM accounting_events').first()).n,0);
  const listed=await (await f.call('/api/assistant?source='+id)).json();assert.equal(listed.suggestions.length,1);assert.equal(listed.suggestions[0].id,first.suggestion.id);
});

test('text correction requires explicit data release and does not alter an order',async t=>{
  const f=await fixture(t,{async check(){},async analyze(){return providerResult({correctedText:'Guten Tag, bitte schicken Sie uns Fotos.',changes:['Rechtschreibung korrigiert'],note:'Nur Formulierung angepasst.'});}});
  const id=randomUUID(),data={id,wg:'WG-1',version:1,status:'Preise prüfen',synthetic:false,source:{name:'Testkunde'},notes:[],payments:[]};await f.env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,0)').bind(id,data.wg,data.status,JSON.stringify(data),new Date().toISOString(),'test','fixture').run();const auditBefore=(await f.env.DB.prepare('SELECT COUNT(*) n FROM audit').first()).n;
  assert.equal((await f.call('/api/assistant/analyze',{requestId:randomUUID(),kind:'text',text:'Guten Tag bite schicken sie uns Fotos.',confirmed:true})).status,409);
  await settings(f);assert.equal((await f.call('/api/assistant/analyze',{requestId:randomUUID(),kind:'text',text:'Guten Tag bite schicken sie uns Fotos.'})).status,400);
  const result=await (await f.call('/api/assistant/analyze',{requestId:randomUUID(),kind:'text',text:'Guten Tag bite schicken sie uns Fotos.',confirmed:true})).json();assert.equal(result.suggestion.result.correctedText,'Guten Tag, bitte schicken Sie uns Fotos.');
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM audit').first()).n,auditBefore);assert.deepEqual(JSON.parse((await f.env.DB.prepare('SELECT data FROM orders').first()).data),data);
});

test('vehicle analysis is limited to an owned image and validates provider output',async t=>{
  let fail=false;const f=await fixture(t,{async check(){},async analyze(){return fail?{id:'resp_bad',status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'Nicht möglich'}]}]}:providerResult({conditionSummary:'Leichte oberflächliche Spuren sichtbar.',findings:[{area:'Tür',observation:'Feine Spuren im reflektierten Licht',severity:'leicht',calculationHint:'Vor Ort Lack und Tiefe prüfen'}],uncertainties:['Foto zeigt nur einen Ausschnitt'],calculationNote:'Kein Festpreis aus dem Foto ableiten.'});}});
  await settings(f);const orderId=randomUUID(),assetId=randomUUID(),data={id:orderId,wg:'WG-2',version:1,status:'Preise prüfen',synthetic:false,source:{name:'Testkunde'},notes:[],payments:[]},image=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(100,1),Buffer.from([0xff,0xd9])]);await f.env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,0)').bind(orderId,data.wg,data.status,JSON.stringify(data),new Date().toISOString(),'test','fixture').run();await f.env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(assetId,orderId,'booking','image/jpeg',sha256(image),image.length,new Date().toISOString()).run();await f.files.set(assetId,{body:image,httpMetadata:{contentType:'image/jpeg'}});
  assert.equal((await f.call('/api/assistant/analyze',{requestId:randomUUID(),kind:'vehicle',sourceId:randomUUID(),confirmed:true})).status,404);
  const response=await f.call('/api/assistant/analyze',{requestId:randomUUID(),kind:'vehicle',sourceId:assetId,confirmed:true}),raw=await response.text();assert.equal(response.status,200,raw);const result=JSON.parse(raw);assert.equal(result.suggestion.result.findings[0].area,'Tür');assert.equal(result.suggestion.sourceHash,sha256(image));
  fail=true;assert.equal((await f.call('/api/assistant/analyze',{requestId:randomUUID(),kind:'vehicle',sourceId:assetId,confirmed:true})).status,502);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM assistant_suggestions').first()).n,1);
});
