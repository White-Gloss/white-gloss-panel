import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {manualCatalogSource} from '../src/catalog.mjs';
import {pricingHTML,mountPricing,readPricing} from '../dist/client/pricing.js';

test('price editor keeps Keramik extras included and reprices them explicitly when the package changes',t=>{
  const source=manualCatalogSource({packageId:'keramik',classId:'kompakt',extraIds:[],delivery:'Kunde bringt'});
  const dom=new JSDOM('<!doctype html><body></body>');t.after(()=>dom.window.close());
  dom.window.document.body.innerHTML=pricingHTML({source,status:'Preise prüfen'});
  const form=dom.window.document.querySelector('#priceform');mountPricing(form);
  assert.match(form.querySelector('[data-package-guidance]').textContent,/Keramik statt Wachs/);assert.match(form.querySelector('[data-package-guidance]').textContent,/Lackzustand/);
  form.querySelector('[data-price-extra]').value='glas';form.querySelector('[data-price-add-extra]').click();
  let row=form.querySelector('[data-id="extra-glas"]');assert.equal(row.querySelector('[data-line-price]').value,'0,00');assert.match(row.querySelector('[data-line-description]').value,/enthalten/);
  const select=form.querySelector('[data-price-package]');select.value='premium';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  row=form.querySelector('[data-id="extra-glas"]');assert.equal(row.querySelector('[data-line-price]').value,'99,00');assert.doesNotMatch(row.querySelector('[data-line-description]').value,/enthalten/);
  const result=readPricing(form);assert.equal(result.totalCents,44800);assert.equal(result.lines.find(line=>line.kind==='package').amountCents,34900);
});
