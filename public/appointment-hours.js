export function hoursToMinutes(value){
 const raw=String(value).trim().replace(',','.');
 if(!/^\d+(?:\.\d+)?$/.test(raw))throw Error('Bitte eine Dauer in Stunden eingeben, z. B. 3,5.');
 const minutes=Number(raw)*60;
 if(Math.abs(minutes-Math.round(minutes))>1e-8||minutes<15||minutes>4320)throw Error('Dauer: 0,25 bis 72 Stunden in ganzen Minuten.');
 return Math.round(minutes);
}
export const hoursLabel=minutes=>new Intl.NumberFormat('de-DE',{maximumFractionDigits:2}).format(minutes/60)+' Stunden';
export function mountAppointmentHours(form,toISO){
 if(!form)return;const input=form.elements.durationHours,minutes=form.elements.duration,output=form.querySelector('[data-hours-preview]');if(!input||!minutes)return;
 const update=()=>{try{minutes.value=String(hoursToMinutes(input.value));input.setCustomValidity('');output.textContent='Geplant: '+hoursLabel(Number(minutes.value));if(form.elements.start?.value&&toISO){const end=new Date(Date.parse(toISO(form.elements.start.value))+Number(minutes.value)*60000);output.textContent+=' · Ende: '+new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',dateStyle:'medium',timeStyle:'short'}).format(end);}}catch(error){input.setCustomValidity(error.message);output.textContent=error.message;}};
 input.addEventListener('input',update);input.addEventListener('change',update);form.elements.start?.addEventListener('change',update);update();
}
