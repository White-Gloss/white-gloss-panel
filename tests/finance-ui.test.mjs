import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Client dependencies are copied beside this module by the build; no browser or listener is needed here.
const source=(await readFile(new URL('../public/finance-flow.js',import.meta.url),'utf8')).replace("from './operations.mjs'","from '"+new URL('../src/operations.mjs',import.meta.url).href+"'");
const {paymentHTML,mountFinance}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
function control(value=''){return {value,checked:false,listeners:{},addEventListener(name,handler){this.listeners[name]=handler;},focus(){this.focused=true;}};}
function harness(){
  const elements={receivedConfirmed:control(),method:control('Überweisung'),reference:control('TEST-BANK-REF'),receipt:control('TEST FILE'),idempotencyKey:control('11111111-1111-1111-1111-111111111111'),amountCents:control('6900')},submit={disabled:false},title={textContent:''},receiptField={hidden:false},hint={textContent:''};
  const form={elements,dataset:{savedReceipt:'saved-bank-file'},listeners:{},addEventListener(name,handler){this.listeners[name]=handler;},querySelector(selector){return {'[type=submit]':submit,'[data-payment-reference-title]':title,'[data-payment-receipt-field]':receiptField,'[data-payment-method-hint]':hint}[selector];},scrollIntoView(){this.scrolled=true;}};
  const buttons=['Bar','Karte'].map(method=>({dataset:{paymentMethod:method},listeners:{},addEventListener(name,handler){this.listeners[name]=handler;}}));const root={querySelector:()=>form,querySelectorAll:()=>buttons};return {root,form,elements,submit,title,receiptField,hint,buttons};
}
test('cash action remains available without generic cash approval and the current remaining amount is prefilled',()=>{
  const html=paymentHTML({status:'Erledigt',synthetic:false,offer:{totalCents:11900,services:'TEST'},acceptance:{at:'2026-10-01T12:00:00Z'},payments:[{amountCents:5000,method:'Bar',at:'2026-10-01T12:00:00Z'}]},{cashRecordingApproved:false},'2026-10-07T12:00');
  assert.match(html,/data-payment-method="Bar"\s*>Barzahlung erhalten/);assert.match(html,/name="amountCents"[^>]*max="6900"[^>]*value="6900"/);assert.match(html,/<option>Bar<\/option>/);assert.ok(!html.includes('TSE'));assert.ok(!html.includes('Barzahlung wartet'));assert.match(html,/name="receivedConfirmed" type="checkbox" required/);assert.match(html,/type="submit" class="primary" disabled/);
});
test('cash selection uses an internal reference without a paper upload and keeps personal confirmation unchecked',()=>{
  const f=harness();mountFinance(f.root);assert.equal(f.submit.disabled,true);assert.equal(f.elements.receipt.required,true);f.elements.receivedConfirmed.checked=true;f.elements.receivedConfirmed.listeners.change();assert.equal(f.submit.disabled,false);
  f.buttons[0].listeners.click();assert.equal(f.elements.method.value,'Bar');assert.equal(f.elements.receivedConfirmed.checked,false);assert.equal(f.submit.disabled,true);assert.equal(f.elements.reference.value,'BARGELD-'+f.elements.idempotencyKey.value);assert.equal(f.elements.reference.readOnly,true);assert.equal(f.title.textContent,'Interne Zahlungsreferenz');assert.equal(f.receiptField.hidden,true);assert.equal(f.elements.receipt.required,false);assert.equal(f.elements.receipt.disabled,true);assert.equal(f.elements.receipt.value,'');assert.equal(f.form.dataset.savedReceipt,undefined);assert.match(f.hint.textContent,/kein Papierbeleg-Upload/);assert.equal(f.elements.amountCents.value,'6900');assert.equal(f.elements.amountCents.focused,true);
  f.elements.receivedConfirmed.checked=true;f.elements.receivedConfirmed.listeners.change();assert.equal(f.submit.disabled,false);f.form.listeners.input({target:f.elements.amountCents});assert.equal(f.elements.receivedConfirmed.checked,false);assert.equal(f.submit.disabled,true);
});
test('returning from cash to card restores the bank reference and requires the original again',()=>{
  const f=harness();mountFinance(f.root);f.buttons[0].listeners.click();f.elements.receivedConfirmed.checked=true;f.elements.receivedConfirmed.listeners.change();f.buttons[1].listeners.click();assert.equal(f.elements.method.value,'Karte');assert.equal(f.elements.reference.value,'TEST-BANK-REF');assert.equal(f.elements.reference.readOnly,false);assert.equal(f.elements.reference.required,true);assert.equal(f.receiptField.hidden,false);assert.equal(f.elements.receipt.required,true);assert.equal(f.elements.receipt.disabled,false);assert.equal(f.elements.receivedConfirmed.checked,false);assert.equal(f.submit.disabled,true);
});
