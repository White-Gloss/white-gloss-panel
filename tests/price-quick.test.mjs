// Schnell-Preisrechner: nutzt die geprüfte Katalogrechnung, speichert nichts. Kein Server, kein Netz.
import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteView} from '../dist/client/price-quick.js';
import {catalogQuote,packages,extras,vehicleClasses,cities} from '../src/catalog.mjs';

const base={packageId:packages[0].id,classId:vehicleClasses[0].id,extraIds:[],delivery:'Kunde bringt',citySlug:'',pickupKm:''};
test('quick price equals the audited catalog quote for every package and class',()=>{
  for(const pack of packages)for(const klass of vehicleClasses){
    const input={...base,packageId:pack.id,classId:klass.id},view=quoteView(input);
    assert.equal(view.quote.totalCents,catalogQuote(input).totalCents);assert.equal(view.quote.packageCents,Math.round(pack.priceCents*klass.factorPercent/100));
  }
});
test('extras follow the class factor and included extras cost nothing in the ceramic package',()=>{
  const extra=extras.find(item=>item.requestable),klass=vehicleClasses.at(-1),input={...base,classId:klass.id,extraIds:[extra.id]},view=quoteView(input);
  assert.equal(view.quote.extrasCents,Math.round(extra.priceCents*klass.factorPercent/100));
  const ceramic=quoteView({...base,packageId:'keramik',extraIds:['glas','leder']});assert.equal(ceramic.quote.extrasCents,0);assert.match(ceramic.html,/Im Paket enthalten/);
});
test('pickup uses city distance or manual km and shows "auf Anfrage" outside the tiers',()=>{
  const city=cities.find(item=>item.km>0)??cities[0];
  assert.equal(quoteView({...base,delivery:'Abholung',citySlug:city.slug}).quote.distanceKm,city.km);
  const far=quoteView({...base,delivery:'Abholung',pickupKm:'1500'});assert.equal(far.quote.pickupCents,null);assert.match(far.html,/auf Anfrage/);
  const near=quoteView({...base,delivery:'Abholung',pickupKm:'25'});assert.equal(near.quote.distanceKm,25);
});
test('invalid input shows a clear message instead of a price',()=>{
  const view=quoteView({...base,packageId:'gibt-es-nicht'});assert.equal(view.quote,null);assert.match(view.html,/role="alert"/);
  assert.match(quoteView({...base,delivery:'Abholung',pickupKm:'-3'}).html,/gültige/);
});
test('quote output escapes markup and always carries the price note',()=>{
  const view=quoteView(base);assert.match(view.html,/kann sich der Preis nach Absprache mit dem Kunden noch ändern/);assert.doesNotMatch(view.html,/<script/i);
});

// jsdom rechnet kein Layout; die Desktop-Regeln werden deshalb im Stylesheet gesichert.
import {readFileSync} from 'node:fs';
test('price calculator CSS keeps radio buttons small, hides pickup fields and clears the sticky top bar',()=>{
  const css=readFileSync(new URL('../public/communication.css',import.meta.url),'utf8');
  assert.match(css,/\.pq input\[type=radio\],\.pq input\[type=checkbox\]\{[^}]*width:18px/,'panel base style would make them 100 % wide');
  assert.match(css,/\.pq-km\[hidden\]\{display:none\}/,'display:grid must not override the hidden attribute');
  assert.match(css,/\.pq-result\{position:sticky;top:calc\(var\(--desktop-topbar,68px\) \+ 16px\)/,'result must sit below the 68 px top bar');
});
