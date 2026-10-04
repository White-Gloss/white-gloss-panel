import {calculateDilution,formatVolume} from './dilution.mjs';

const settings={amount:'1',unit:'l',concentrateParts:'1',waterParts:'10',basis:'total'};
const ratios=[1,5,10,20,50,100];
const amounts=[['0.5','0,5 L'],['1','1 L'],['5','5 L'],['10','10 L']];
const escape=value=>String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const number=value=>Number(String(value).trim().replace(',','.'));
const decimal=new Intl.NumberFormat('de-DE',{maximumFractionDigits:6});
const scientific=new Intl.NumberFormat('de-DE',{notation:'scientific',maximumFractionDigits:4});
const formatNumber=value=>value!==0&&(value<0.000001||value>=1000000)?scientific.format(value):decimal.format(value);

export function mixingCalculatorHTML(){
  return `<div class="heading"><div><div class="eyebrow">White Gloss Detailing · Horb am Neckar</div><h1>Mischverhältnisrechner</h1><p>Konzentrat und Wasser für deine Reinigungsmittel genau abmessen.</p></div></div>
  <section id="mixing-calculator" class="mix-layout" aria-label="Mischverhältnis berechnen">
    <div class="card mix-input-card">
      <div class="card-title"><h2>Deine Mischung</h2><span class="badge">Konzentrat : Wasser</span></div>
      <div class="card-body">
        <fieldset class="mix-fieldset"><legend>Womit möchtest du rechnen?</legend><div class="mix-basis">
          <button type="button" data-mix-basis="total" aria-pressed="${settings.basis==='total'}">Fertige Gesamtmenge</button>
          <button type="button" data-mix-basis="water" aria-pressed="${settings.basis==='water'}">Vorhandenes Wasser</button>
        </div></fieldset>
        <div class="mix-amount-row">
          <label for="mix-amount"><span data-mix-amount-label>${settings.basis==='water'?'Vorhandene Wassermenge':'Gewünschte Gesamtmenge'}</span><input id="mix-amount" data-mix-field="amount" type="text" inputmode="decimal" value="${escape(settings.amount)}" autocomplete="off" aria-describedby="mix-error"></label>
          <label for="mix-unit">Einheit<select id="mix-unit" data-mix-field="unit"><option value="ml" ${settings.unit==='ml'?'selected':''}>Milliliter (ml)</option><option value="l" ${settings.unit==='l'?'selected':''}>Liter (L)</option></select></label>
        </div>
        <div class="mix-presets" role="group" aria-label="Menge auswählen">${amounts.map(([value,label])=>`<button type="button" data-mix-amount="${value}" aria-pressed="false">${label}</button>`).join('')}</div>
        <fieldset class="mix-fieldset mix-ratio-fieldset"><legend>Mischverhältnis</legend>
          <div class="mix-ratio-row"><label for="mix-concentrate">Teile Konzentrat<input id="mix-concentrate" data-mix-field="concentrateParts" type="text" inputmode="decimal" value="${escape(settings.concentrateParts)}" autocomplete="off" aria-describedby="mix-ratio-help mix-error"></label><span class="mix-colon" aria-hidden="true">:</span><label for="mix-water">Teile Wasser<input id="mix-water" data-mix-field="waterParts" type="text" inputmode="decimal" value="${escape(settings.waterParts)}" autocomplete="off" aria-describedby="mix-ratio-help mix-error"></label></div>
          <p id="mix-ratio-help" class="mix-help">1 : 10 bedeutet 1 Teil Konzentrat plus 10 Teile Wasser.</p>
          <div class="mix-presets" role="group" aria-label="Mischverhältnis auswählen">${ratios.map(value=>`<button type="button" data-mix-ratio="${value}" aria-pressed="false">1 : ${value}</button>`).join('')}</div>
        </fieldset>
        <button type="button" class="smallbtn mix-reset" data-mix-reset>Auf 1 L · 1 : 10 zurücksetzen</button>
      </div>
    </div>
    <div class="card mix-result-card">
      <div class="card-title"><h2>So mischst du</h2><span class="mix-result-mark" aria-hidden="true">↓</span></div>
      <div class="card-body" aria-live="polite" aria-atomic="true">
        <div id="mix-error" class="error mix-error" hidden></div>
        <div data-mix-result>
          <p class="mix-result-description" data-mix-description></p>
          <dl class="mix-results"><div class="mix-concentrate-result"><dt>Konzentrat</dt><dd><output data-mix-concentrate></output></dd></div><div><dt>Wasser</dt><dd><output data-mix-water></output></dd></div><div class="mix-total-result"><dt>Fertige Gesamtmenge</dt><dd><output data-mix-total></output></dd></div></dl>
          <div class="mix-summary"><span data-mix-explanation></span><strong data-mix-percent></strong></div>
        </div>
      </div>
      <div class="mix-manufacturer"><strong>Verhältnis laut Hersteller einstellen</strong><p>Der Rechner verwendet Konzentrat : Wasser. Falls das Etikett die Verdünnung anders angibt, übertrage die dort genannten Mengen entsprechend. Die Auswahlwerte sind Rechenvorgaben, keine Produktempfehlungen.</p></div>
    </div>
  </section>`;
}

export function mountMixingCalculator(root){
  if(!root||root.dataset.mounted==='true')return;
  root.dataset.mounted='true';
  const result=root.querySelector('[data-mix-result]');
  const error=root.querySelector('#mix-error');
  let unitError=null;
  const update=()=>{
    const waterBasis=settings.basis==='water';
    root.querySelector('[data-mix-amount-label]').textContent=waterBasis?'Vorhandene Wassermenge':'Gewünschte Gesamtmenge';
    for(const button of root.querySelectorAll('[data-mix-basis]'))button.setAttribute('aria-pressed',String(button.dataset.mixBasis===settings.basis));
    for(const button of root.querySelectorAll('[data-mix-ratio]'))button.setAttribute('aria-pressed',String(number(settings.concentrateParts)===1&&number(settings.waterParts)===Number(button.dataset.mixRatio)));
    const amountMl=number(settings.amount)*(settings.unit==='l'?1000:1);
    for(const button of root.querySelectorAll('[data-mix-amount]'))button.setAttribute('aria-pressed',String(amountMl===Number(button.dataset.mixAmount)*1000));
    for(const field of root.querySelectorAll('[data-mix-field]'))field.removeAttribute('aria-invalid');
    try{
      if(unitError)throw Error(unitError);
      const calculated=calculateDilution(settings);
      root.querySelector('[data-mix-concentrate]').textContent=formatVolume(calculated.concentrateMl);
      root.querySelector('[data-mix-water]').textContent=formatVolume(calculated.waterMl);
      root.querySelector('[data-mix-total]').textContent=formatVolume(calculated.totalMl);
      const concentrate=number(settings.concentrateParts),water=number(settings.waterParts);
      root.querySelector('[data-mix-description]').textContent=waterBasis?'Zum vorhandenen Wasser gibst du diese Menge Konzentrat hinzu.':'Für deine gewünschte Gesamtmenge misst du diese beiden Mengen ab.';
      root.querySelector('[data-mix-explanation]').textContent=`${formatNumber(concentrate)} ${concentrate===1?'Teil':'Teile'} Konzentrat + ${formatNumber(water)} ${water===1?'Teil':'Teile'} Wasser`;
      root.querySelector('[data-mix-percent]').textContent=`${formatNumber(calculated.concentrationPercent)} % Konzentrat`;
      result.hidden=false;
      error.hidden=true;
      error.textContent='';
    }catch(reason){
      result.hidden=true;
      error.hidden=false;
      error.textContent=reason.message;
      const message=reason.message;
      const invalidField=unitError?'unit':message.startsWith('Menge:')?'amount':message.startsWith('Konzentratteile:')?'concentrateParts':message.startsWith('Wasserteile:')||message.startsWith('Bei vorhandener Wassermenge')?'waterParts':message.startsWith('Einheit:')?'unit':null;
      if(invalidField)root.querySelector(`[data-mix-field="${invalidField}"]`).setAttribute('aria-invalid','true');
      else for(const field of root.querySelectorAll('input[data-mix-field]'))field.setAttribute('aria-invalid','true');
    }
  };
  const syncFields=()=>{
    for(const field of root.querySelectorAll('[data-mix-field]'))field.value=settings[field.dataset.mixField];
    update();
  };
  const readField=event=>{
    const field=event.target.closest('[data-mix-field]');
    if(!field)return;
    unitError=null;
    if(field.dataset.mixField==='unit'&&field.value!==settings.unit){
      try{
        // Validate only the amount: an unfinished ratio must not prevent a
        // valid amount from being preserved when its display unit changes.
        calculateDilution({amount:settings.amount,unit:settings.unit,concentrateParts:1,waterParts:0,basis:'total'});
        const [mantissa,exponent='0']=settings.amount.trim().replace(',','.').split(/e/i);
        const shifted=Number(`${mantissa}e${Number(exponent)+(field.value==='ml'?3:-3)}`);
        if(!Number.isFinite(shifted)||shifted<=0){
          field.value=settings.unit;
          unitError='Einheit: Diese Menge ist zu klein oder zu groß, um sie ohne Verlust in die andere Einheit umzurechnen.';
        }else{
          settings.amount=String(shifted).replace('.',',');
          root.querySelector('[data-mix-field="amount"]').value=settings.amount;
        }
      }catch{
        // Keep an invalid, unfinished amount exactly as the user entered it.
      }
    }
    settings[field.dataset.mixField]=field.value;
    update();
  };
  root.addEventListener('input',readField);
  root.addEventListener('change',readField);
  root.addEventListener('click',event=>{
    const button=event.target.closest('button');
    if(!button||!root.contains(button))return;
    unitError=null;
    if(button.dataset.mixBasis)settings.basis=button.dataset.mixBasis;
    if(button.dataset.mixRatio){settings.concentrateParts='1';settings.waterParts=button.dataset.mixRatio;}
    if(button.dataset.mixAmount){settings.amount=button.dataset.mixAmount.replace('.',',');settings.unit='l';}
    if(button.hasAttribute('data-mix-reset'))Object.assign(settings,{amount:'1',unit:'l',concentrateParts:'1',waterParts:'10',basis:'total'});
    syncFields();
  });
  update();
}
