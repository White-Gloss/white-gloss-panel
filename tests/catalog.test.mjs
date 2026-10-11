import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogQuote,manualCatalogSource} from '../src/catalog.mjs';
const selection=(data={})=>({packageId:'basis',classId:'kompakt',extraIds:[],delivery:'Kunde bringt',...data});
test('Website prices and vehicle factors use whole cents, including extras',()=>{
  assert.equal(catalogQuote(selection()).totalCents,14900);
  assert.equal(catalogQuote(selection({classId:'transporter'})).totalCents,23095);
  const q=catalogQuote(selection({classId:'suv',extraIds:['ozon'],delivery:'Abholung',citySlug:'nagold'}));
  assert.equal(q.packageCents,18625);assert.equal(q.extrasCents,12375);assert.equal(q.pickupCents,5000);assert.equal(q.totalCents,36000);
});
test('included Keramik options and pickup never cause double charges',()=>{
  const q=catalogQuote(selection({packageId:'keramik',extraIds:['glas','leder','ozon','ozon'],delivery:'Abholung',citySlug:'sindelfingen'}));
  assert.equal(q.totalCents,99800);assert.equal(q.pickupIncluded,true);assert.deepEqual(q.extras.map(e=>e.id),['ozon']);
  assert.equal(catalogQuote(selection({packageId:'keramik',delivery:'Abholung',pickupKm:60})).pickupCents,0);
});
test('pickup tariff boundaries; individual pickup stays on request until priced',()=>{
  for(const [km,fee] of [[10,0],[10.1,5000],[20,5000],[20.1,7000],[50,7000]])assert.equal(catalogQuote(selection({delivery:'Abholung',pickupKm:km})).pickupCents,fee);
  assert.equal(catalogQuote(selection({delivery:'Abholung',pickupKm:50.1})).totalCents,null);
  const onRequest=manualCatalogSource(selection({delivery:'Abholung',pickupKm:50.1}));assert.equal(onRequest.pickupOnRequest,true);assert.equal(onRequest.pickupCents,0);
  assert.equal(manualCatalogSource(selection({delivery:'Abholung',pickupKm:''})).pickupOnRequest,true);assert.throws(()=>manualCatalogSource(selection({delivery:'Abholung',pickupKm:-1})),/Abholentfernung/);
  assert.equal(manualCatalogSource(selection({delivery:'Abholung',pickupKm:80,customPickupCents:9500})).amountCents,24400);
  assert.equal(catalogQuote(selection({delivery:'Abholung',pickupKm:''})).pickupOnRequest,true);assert.throws(()=>catalogQuote(selection({delivery:'Abholung',pickupKm:'abc'})),/entfernung/i);
  assert.throws(()=>catalogQuote(selection({delivery:'Abholung',pickupKm:100,customPickupCents:99.5})),/ganzen Cent/);
});
test('unavailable or unknown catalogue selections are rejected',()=>{
  assert.throws(()=>catalogQuote(selection({extraIds:['scheinwerfer']})),/nicht buchbar/);
  assert.throws(()=>catalogQuote(selection({packageId:'unknown'})),/Paket/);
  assert.throws(()=>catalogQuote(selection({extraIds:['unknown']})),/unbekannt/);
  assert.throws(()=>catalogQuote(selection({citySlug:'unknown',delivery:'Abholung'})),/Abholort/);
});
