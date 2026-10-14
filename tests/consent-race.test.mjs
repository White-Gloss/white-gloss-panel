import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker,{getOrder,setting} from '../src/worker.mjs';
import {PanelDatabase} from '../server/storage.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid';
function environment(t){const e={DB:new PanelDatabase(':memory:'),BUCKET:{async put(){},async delete(){}},OWNER_EMAIL_SHA256:createHash('sha256').update(owner).digest('hex'),CONFIG_KEY:Buffer.alloc(32,7).toString('base64')};t.after(()=>e.DB.close());return e;}
async function request(e,path,data){return worker.fetch(new Request(origin+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{'oai-authenticated-user-email':owner,Origin:origin,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)}),e);}
async function accepted(e,path,data){const r=await request(e,path,data),body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body;}

test('on-site booking rejects changed displayed withdrawal text before creating any order',async t=>{
  const e=environment(t);await accepted(e,'state');await setting(e,'withdrawalText','Aktueller Text');
  const stale=await request(e,'onsite',{synthetic:true,source:{name:'Nur Test'},acceptance:{displayedWithdrawalText:'Vorheriger Text',release:true,releaseReason:'Test ohne Unterschrift'},appointment:{skip:true}});
  assert.equal(stale.status,409);assert.equal(e.DB.sql.prepare('SELECT COUNT(*) n FROM orders').get().n,0);
  const order=await accepted(e,'onsite',{synthetic:true,source:{name:'Nur Test'},acceptance:{displayedWithdrawalText:'Aktueller Text',release:true,releaseReason:'Test ohne Unterschrift'},appointment:{skip:true}});
  assert.equal(order.acceptance.withdrawalText,'Aktueller Text');
});

test('operator acceptance and replacement offer preserve exactly the text displayed to the customer',async t=>{
  const e=environment(t);let order=await accepted(e,'create',{synthetic:true,source:{name:'Nur Test'}});
  await setting(e,'withdrawalText','Text nach Formularöffnung');
  const stale=await request(e,'action',{id:order.id,version:order.version,action:'onsiteAccept',input:{displayedWithdrawalText:'Text bei Formularöffnung',release:true,releaseReason:'Test ohne Unterschrift'}});
  assert.equal(stale.status,409);assert.equal((await getOrder(e,order.id)).acceptance,undefined);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ypcAAAAASUVORK5CYII=','base64');
  const signature='data:image/png;base64,'+Buffer.concat([png,Buffer.alloc(300)]).toString('base64');
  order=await accepted(e,'action',{id:order.id,version:order.version,action:'onsiteAccept',input:{displayedWithdrawalText:'Text nach Formularöffnung',signature}});
  assert.equal(order.acceptance.withdrawalText,'Text nach Formularöffnung');
  order=await accepted(e,'action',{id:order.id,version:order.version,action:'replacement',input:{kind:'offer'}});
  const replacement=await request(e,'action',{id:order.id,version:order.version,action:'signReplacement',input:{kind:'offer',inPerson:true,displayedWithdrawalText:'Alter Text'}});
  assert.equal(replacement.status,409);assert.ok((await getOrder(e,order.id)).pending.offer);
});
