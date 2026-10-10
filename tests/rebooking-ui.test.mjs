import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Load only the draft helpers: no page, website server or provider is started.
const source=(await readFile(new URL('../public/rebooking.js',import.meta.url),'utf8')).replace("'./catalog.mjs'",JSON.stringify(new URL('../src/catalog.mjs',import.meta.url).href));
const {createRebookingDraft,persistRebookingDraft,restoreRebookingDraft,prepareRebookingPayload}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const seed=()=>({orderId:'source-order',orderVersion:3,customerId:'customer-id',customerVersion:4,vehicleId:'vehicle-id',vehicleVersion:5,catalogCheckedAt:'2026-10-01',selection:{packageId:'basis',classId:'kompakt',extraIds:[],delivery:'Kunde bringt',citySlug:'',pickupKm:''},condition:'Former condition',wishes:'Former wishes',desiredDate:'2020-01-01',timeWindow:'Former slot',oldPrice:1,acceptance:{at:'old'}});
const storage=()=>{const rows=new Map();return {getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value)};};

test('new rebooking reuses identifiers and catalog choices but starts fresh current-state fields',()=>{
  const context=seed(),draft=createRebookingDraft(context),next=createRebookingDraft(context);
  assert.notEqual(draft.requestId,next.requestId);
  assert.equal(draft.orderId,context.orderId);
  assert.deepEqual(draft.form,{selection:context.selection,condition:'',wishes:'',desiredDate:'',timeWindow:'',confirmed:false});
  draft.form.selection.extraIds.push('leder');assert.deepEqual(context.selection.extraIds,[]);
  const payload=prepareRebookingPayload(context,draft);
  assert.equal(payload.customerVersion,4);assert.equal(payload.vehicleVersion,5);assert.equal(payload.orderVersion,3);
  assert.equal(payload.catalogCheckedAt,context.catalogCheckedAt);assert.equal(payload.customerId,context.customerId);assert.equal(payload.vehicleId,context.vehicleId);
  assert.equal(payload.acceptance,undefined);assert.equal(payload.oldPrice,undefined);
});

test('new payload excludes historical or custom monetary values from the selection',()=>{
  const context=seed();Object.assign(context.selection,{customPickupCents:1,oldPrice:1,totalCents:1});
  const draft=createRebookingDraft(context);draft.form.selection.customPickupCents=1;
  const payload=prepareRebookingPayload(context,draft);
  assert.deepEqual(Object.keys(payload.selection).sort(),['packageId','classId','extraIds','delivery','citySlug','pickupKm'].sort());
});

test('uncertain attempt survives reload with exact payload and original versions',()=>{
  const context=seed(),store=storage(),draft=restoreRebookingDraft(store,context);
  Object.assign(draft.form,{condition:'Leichter Staub',wishes:'Nur aktueller Wunsch',desiredDate:'2030-01-01',timeWindow:'vormittags',confirmed:true});
  draft.pending=prepareRebookingPayload(context,draft);persistRebookingDraft(store,draft);
  const attempted=structuredClone(draft.pending),newContext={...context,orderVersion:90,customerVersion:91,vehicleVersion:92,catalogCheckedAt:'2030-01-01'};
  const restored=restoreRebookingDraft(store,newContext);
  assert.equal(restored.requestId,draft.requestId);assert.deepEqual(prepareRebookingPayload(newContext,restored),attempted);
  const detached=prepareRebookingPayload(newContext,restored);detached.selection.extraIds.push('leder');detached.condition='changed';
  assert.deepEqual(restored.pending,attempted);
});

test('a saved receipt prevents another attempt until an explicit new draft is created',()=>{
  const context=seed(),store=storage(),draft=restoreRebookingDraft(store,context);
  draft.receipt={id:'new-order',wg:'WG-TEST',status:'Preise prüfen'};persistRebookingDraft(store,draft);
  const restored=restoreRebookingDraft(store,context);
  assert.deepEqual(restored.receipt,draft.receipt);assert.throws(()=>prepareRebookingPayload(context,restored),/bereits bestätigt/);
  const another=createRebookingDraft(context);assert.notEqual(another.requestId,restored.requestId);assert.equal(another.receipt,null);
});

test('explicit correction uses a fresh request id and requires a fresh confirmation',()=>{
  const context=seed(),draft=createRebookingDraft(context);Object.assign(draft.form,{condition:'Staub',wishes:'Bitte prüfen',confirmed:true});
  draft.pending=prepareRebookingPayload(context,draft);draft.rejected={status:409};
  const corrected=createRebookingDraft(context,draft.form);
  assert.notEqual(corrected.requestId,draft.requestId);assert.equal(corrected.pending,null);assert.equal(corrected.rejected,null);assert.equal(corrected.form.confirmed,false);
  assert.equal(corrected.form.condition,'Staub');assert.equal(corrected.form.wishes,'Bitte prüfen');
});

test('unavailable or silently failing storage refuses to prepare a durable draft',()=>{
  assert.throws(()=>restoreRebookingDraft({getItem:()=>null,setItem:()=>{throw Error('denied');}},seed()),/denied/);
  assert.throws(()=>restoreRebookingDraft({getItem:()=>null,setItem:()=>{}},seed()),/nicht gespeichert/);
});

test('corrupted or mismatched stored attempt fails closed instead of regenerating an id',()=>{
  const context=seed(),store=storage(),key='wg-rebooking-v1:'+context.orderId;
  store.setItem(key,'not json');assert.throws(()=>restoreRebookingDraft(store,context),/nicht lesbar/);
  const draft=createRebookingDraft(context);draft.pending={requestId:crypto.randomUUID(),selection:{}};store.setItem(key,JSON.stringify(draft));
  assert.throws(()=>restoreRebookingDraft(store,context),/nicht eindeutig/);
  assert.equal(store.getItem(key),JSON.stringify(draft));
});
