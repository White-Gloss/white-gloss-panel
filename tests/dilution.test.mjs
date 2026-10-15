import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {calculateDilution,dilutionCalculatorHTML,mountDilutionCalculator} from '../public/dilution.js';

test('1 : 10 uses one concentrate part and ten water parts of the finished volume',()=>{
  const result=calculateDilution({waterParts:10,total:1,unit:'l'});
  assert.equal(result.totalMl,1000);
  assert.equal(result.concentrateMl,1000/11);
  assert.equal(result.waterMl,1000-1000/11);
  assert.equal(result.concentrateMl+result.waterMl,1000);
  assert.notEqual(result.concentrateMl,100,'1 : 10 does not mean ten percent concentrate');
});

test('liters, milliliters, decimal ratios and German decimal input are supported',()=>{
  assert.deepEqual(calculateDilution({waterParts:' 10 ',total:'0,55',unit:'l'}),{concentrateMl:50,waterMl:500,totalMl:550});
  assert.deepEqual(calculateDilution({waterParts:10,total:550,unit:'ml'}),{concentrateMl:50,waterMl:500,totalMl:550});
  assert.deepEqual(calculateDilution({waterParts:'1,5',total:'1.25',unit:'l'}),{concentrateMl:500,waterMl:750,totalMl:1250});
  for(const waterParts of [5,10,20,50]){
    const result=calculateDilution({waterParts,total:1100,unit:'ml'});
    assert.ok(Math.abs(result.waterMl/result.concentrateMl-waterParts)<1e-12);
    assert.equal(result.concentrateMl+result.waterMl,result.totalMl);
  }
});

test('invalid numbers and unsafe ranges never yield a usable calculation',()=>{
  for(const waterParts of [0,-1,'','  ',null,undefined,true,[],{},NaN,Infinity,0.001,10001,'1e2','10,5,2','1.000,5','<img>'])assert.throws(()=>calculateDilution({waterParts,total:1,unit:'l'}),/Verhältnis/);
  for(const total of [0,-1,'','  ',null,undefined,true,[],{},NaN,Infinity,0.0009,1001,'1e3','0,5,2'])assert.throws(()=>calculateDilution({waterParts:10,total,unit:'l'}),/Gesamtmenge/);
  for(const unit of ['L','kg','',null,undefined])assert.throws(()=>calculateDilution({waterParts:10,total:1,unit}),/Liter oder Milliliter/);
  assert.throws(()=>calculateDilution(),/Verhältnis/);
  assert.equal(calculateDilution({waterParts:0.01,total:1,unit:'ml'}).totalMl,1);
  assert.equal(calculateDilution({waterParts:10000,total:1000,unit:'l'}).totalMl,1000000);
});

function boot(t,html=dilutionCalculatorHTML()){
  const dom=new JSDOM('<main>'+html+'</main>');t.after(()=>dom.window.close());
  const root=dom.window.document.querySelector('main');mountDilutionCalculator(root);
  const field=key=>root.querySelector('[data-dilution-field="'+key+'"]');
  const output=key=>root.querySelector('[data-dilution-'+key+']').textContent;
  const fill=(key,value)=>{field(key).value=value;field(key).dispatchEvent(new dom.window.Event(key==='unit'?'change':'input',{bubbles:true}));};
  return {root,field,output,fill,window:dom.window};
}

test('calculator renders a clear ratio definition, immediate results and German decimal amounts',t=>{
  const ui=boot(t);
  assert.match(ui.root.textContent,/1 Teil Konzentrat \+ 10 Teile Wasser/);
  assert.match(ui.root.textContent,/9,09 %/);
  assert.equal(ui.output('concentrate'),'90,91 ml');
  assert.equal(ui.output('water'),'909,09 ml');
  assert.equal(ui.output('total'),'1.000 ml');
  ui.fill('total','0,55');
  assert.equal(ui.output('concentrate'),'50 ml');assert.equal(ui.output('water'),'500 ml');
  ui.fill('unit','ml');ui.fill('total','550');
  assert.equal(ui.output('concentrate'),'50 ml');assert.equal(ui.output('total'),'550 ml');
});

test('presets recalculate, retain the selected volume and stay independent of form submission',t=>{
  const ui=boot(t,'<form>'+dilutionCalculatorHTML()+'</form>');let submissions=0;
  ui.root.querySelector('form').addEventListener('submit',event=>{event.preventDefault();submissions++;});
  ui.fill('total','2');
  ui.root.querySelector('[data-dilution-preset="5"]').click();
  assert.equal(ui.field('waterParts').value,'5');assert.equal(ui.field('total').value,'2');
  assert.equal(ui.output('concentrate'),'333,33 ml');assert.equal(ui.output('water'),'1.666,67 ml');
  assert.equal(ui.root.querySelector('[data-dilution-preset="5"]').getAttribute('aria-pressed'),'true');
  assert.equal(ui.root.querySelector('[data-dilution-preset="10"]').getAttribute('aria-pressed'),'false');
  ui.fill('waterParts','20');assert.equal(ui.root.querySelector('[data-dilution-preset="20"]').getAttribute('aria-pressed'),'true');
  assert.equal(submissions,0);
});

test('invalid edits clear every old result, expose the error and recover on correction',t=>{
  const ui=boot(t),error=ui.root.querySelector('[data-dilution-error]'),results=ui.root.querySelector('[data-dilution-results]');
  ui.fill('total','');
  assert.equal(results.hidden,true);assert.equal(error.hidden,false);assert.match(error.textContent,/Gesamtmenge/);
  assert.equal(ui.field('total').getAttribute('aria-invalid'),'true');
  for(const key of ['concentrate','water','total'])assert.equal(ui.output(key),'—');
  ui.fill('total','0,55');assert.equal(results.hidden,false);assert.equal(error.hidden,true);
  assert.equal(ui.field('total').hasAttribute('aria-invalid'),false);assert.equal(ui.output('concentrate'),'50 ml');
  ui.fill('waterParts','Infinity');assert.equal(results.hidden,true);assert.match(error.textContent,/Verhältnis/);
  assert.equal(ui.output('concentrate'),'—');assert.equal(ui.field('waterParts').getAttribute('aria-invalid'),'true');
  ui.root.querySelector('[data-dilution-preset="10"]').click();assert.equal(results.hidden,false);assert.equal(ui.output('concentrate'),'50 ml');
});

test('mount accepts the calculator itself and multiple instances without duplicate or shared state',t=>{
  const ui=boot(t,dilutionCalculatorHTML()+dilutionCalculatorHTML());
  const calculators=ui.root.querySelectorAll('[data-dilution-calculator]');
  mountDilutionCalculator(calculators[0]);mountDilutionCalculator(ui.root);
  ui.fill('total','2');
  assert.equal(ui.output('total'),'2.000 ml');
  assert.equal(calculators[1].querySelector('[data-dilution-total]').textContent,'1.000 ml');
  const single=new JSDOM(dilutionCalculatorHTML());t.after(()=>single.window.close());
  const calculator=single.window.document.querySelector('[data-dilution-calculator]');mountDilutionCalculator(calculator);
  assert.equal(calculator.querySelector('[data-dilution-concentrate]').textContent,'90,91 ml');
});
