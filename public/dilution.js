// Ratios describe concentrate : water. For 1 : 10, the finished mixture has 11 parts.
const numberFormat=new Intl.NumberFormat('de-DE',{maximumFractionDigits:2});
const fineNumberFormat=new Intl.NumberFormat('de-DE',{maximumFractionDigits:4});
const mountedCalculators=new WeakSet();

function inputError(field,message){const error=new RangeError(message);error.field=field;return error;}
function decimal(value){
  if(typeof value==='number')return value;
  if(typeof value!=='string'||! /^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value.trim()))return NaN;
  return Number(value.trim().replace(',','.'));
}

export function calculateDilution({waterParts,total,unit}={}){
  const parts=decimal(waterParts),amount=decimal(total);
  if(!Number.isFinite(parts)||parts<0.01||parts>10000)throw inputError('waterParts','Bitte ein Verhältnis von 1 : 0,01 bis 1 : 10.000 eingeben.');
  if(unit!=='l'&&unit!=='ml')throw inputError('unit','Bitte Liter oder Milliliter auswählen.');
  const totalMl=amount*(unit==='l'?1000:1);
  if(!Number.isFinite(totalMl)||totalMl<1||totalMl>1000000)throw inputError('total','Bitte eine fertige Gesamtmenge von 1 ml bis 1.000 l eingeben.');
  const concentrateMl=totalMl/(1+parts);
  return {concentrateMl,waterMl:totalMl-concentrateMl,totalMl};
}

export function dilutionCalculatorHTML(){return `<div class="dilution-calculator" data-dilution-calculator>
  <h2 class="sectiontitle">Mischverhältnisrechner</h2>
  <p class="hint dilution-explanation">1 : 10 bedeutet 1 Teil Konzentrat + 10 Teile Wasser, also 11 Teile fertige Mischung. Das entspricht rund 9,09 % Konzentrat.</p>
  <div class="actions dilution-presets" role="group" aria-label="Mischverhältnis auswählen">${[5,10,20,50].map(parts=>`<button type="button" data-dilution-preset="${parts}" aria-pressed="${parts===10}">1 : ${parts}</button>`).join('')}</div>
  <div class="grid2 dilution-inputs">
    <label>Verhältnis · 1 Teil Konzentrat zu Wasserteilen<input type="text" inputmode="decimal" data-dilution-field="waterParts" value="10" autocomplete="off"><small>Bei 1 : 10 hier 10 eingeben.</small></label>
    <label>Fertige Gesamtmenge<input type="text" inputmode="decimal" data-dilution-field="total" value="1" autocomplete="off"><small>Konzentrat und Wasser zusammen.</small></label>
    <label>Einheit<select data-dilution-field="unit"><option value="l">Liter (l)</option><option value="ml">Milliliter (ml)</option></select></label>
  </div>
  <p class="error dilution-error" data-dilution-error role="status" hidden></p>
  <div class="dilution-results" data-dilution-results aria-live="polite" aria-atomic="true">
    <div class="fieldpair"><span>Konzentrat</span><output data-dilution-concentrate aria-label="Benötigtes Konzentrat">—</output></div>
    <div class="fieldpair"><span>Wasser</span><output data-dilution-water aria-label="Benötigtes Wasser">—</output></div>
    <div class="fieldpair"><span>Fertige Mischung</span><output data-dilution-total aria-label="Fertige Gesamtmenge">—</output></div>
  </div>
  <p class="hint dilution-rounding">Die Mengen werden in Millilitern angezeigt und gerundet.</p>
</div>`;}

function milliliters(value){return (value<1?fineNumberFormat:numberFormat).format(value)+' ml';}

// Works with the calculator itself or any parent, including a document; mounting twice is safe.
export function mountDilutionCalculator(container){
  const calculators=Array.from(container?.querySelectorAll?.('[data-dilution-calculator]')??[]);
  if(container?.matches?.('[data-dilution-calculator]'))calculators.unshift(container);
  for(const calculator of calculators){
    if(mountedCalculators.has(calculator))continue;
    mountedCalculators.add(calculator);
    const fields=Object.fromEntries(Array.from(calculator.querySelectorAll('[data-dilution-field]'),field=>[field.dataset.dilutionField,field]));
    const error=calculator.querySelector('[data-dilution-error]'),results=calculator.querySelector('[data-dilution-results]');
    const outputs=['concentrate','water','total'].map(key=>calculator.querySelector('[data-dilution-'+key+']'));
    const update=()=>{
      for(const field of Object.values(fields))field.removeAttribute('aria-invalid');
      for(const button of calculator.querySelectorAll('[data-dilution-preset]'))button.setAttribute('aria-pressed',String(decimal(fields.waterParts.value)===Number(button.dataset.dilutionPreset)));
      try{
        const result=calculateDilution(Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,field.value])));
        [result.concentrateMl,result.waterMl,result.totalMl].forEach((value,index)=>{outputs[index].textContent=milliliters(value);});
        error.textContent='';error.hidden=true;results.hidden=false;
      }catch(problem){
        for(const output of outputs)output.textContent='—';
        results.hidden=true;error.textContent=problem.message;error.hidden=false;
        fields[problem.field]?.setAttribute('aria-invalid','true');
      }
    };
    for(const field of Object.values(fields)){field.addEventListener('input',update);field.addEventListener('change',update);}
    for(const button of calculator.querySelectorAll('[data-dilution-preset]'))button.addEventListener('click',()=>{fields.waterParts.value=button.dataset.dilutionPreset;update();});
    update();
  }
}
