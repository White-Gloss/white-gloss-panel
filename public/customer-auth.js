const root=document.querySelector('#customer-auth-content'),title=document.querySelector('#customer-auth-title'),description=document.querySelector('#customer-auth-description'),message=document.querySelector('#customer-auth-message');
let email='',busy=false;
const emailField='<label>E-Mail-Adresse<input name="email" type="email" autocomplete="username" maxlength="180" required></label>';
const passwordFields='<label>Neues Passwort<input name="password" type="password" autocomplete="new-password" minlength="15" maxlength="128" required></label><label>Passwort wiederholen<input name="confirmation" type="password" autocomplete="new-password" minlength="15" maxlength="128" required></label>';
const steps={
 login:['Willkommen zurück','Melden Sie sich mit Ihrer E-Mail-Adresse und Ihrem Passwort an.',emailField+'<label>Passwort<input name="password" type="password" autocomplete="current-password" maxlength="128" required></label><label class="check"><input name="remember" type="checkbox"><span>Auf diesem privaten Gerät 30 Tage angemeldet bleiben</span></label>','Anmelden'],
 setup:['Ihr Kundenkonto einrichten','Bestätigen Sie zuerst die E-Mail-Adresse Ihrer Anfrage. Danach wählen Sie Ihr persönliches Passwort.',emailField,'Bestätigungscode anfordern'],
 reset:['Passwort vergessen?','Wir senden einen einmaligen Code an die E-Mail-Adresse Ihres Kundenkontos.',emailField,'Wiederherstellungscode anfordern'],
 verify:['E-Mail bestätigen','Geben Sie den sechsstelligen Code aus Ihrer E-Mail ein. Er gilt 10 Minuten.',emailField+'<label>Bestätigungscode<input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required></label>','E-Mail bestätigen'],
 password:['Ihr persönliches Passwort','Wählen Sie mindestens 15 Zeichen, zum Beispiel einen langen Satz. Ein Passwortmanager ist willkommen.',passwordFields,'Passwort speichern']
};
function show(step,focus=true){
 message.textContent='';busy=false;
 if(step==='success'){title.textContent='Ihr Passwort ist gespeichert';description.textContent='Ihr Kundenkonto bleibt bestehen. Sie können sich jetzt und künftig mit E-Mail-Adresse und Passwort anmelden.';root.innerHTML='<button class="primary" type="button" data-step="login">Jetzt anmelden</button>';}
 else{
  if(!steps[step])step='login';const [heading,text,fields,button]=steps[step];title.textContent=heading;description.textContent=text;
  root.innerHTML='<form data-action="'+step+'">'+fields+'<button class="primary" type="submit">'+button+'</button></form><nav class="customer-access-nav" aria-label="Kundenkonto">'+(step==='login'?'<button type="button" data-step="setup">Erstmals einrichten</button><button type="button" data-step="reset">Passwort vergessen?</button><button type="button" data-step="verify">Code eingeben</button>':'<button type="button" data-step="login">Zur Anmeldung</button>'+(step==='verify'?'<button type="button" data-step="setup">Neuen Einrichtungscode anfordern</button><button type="button" data-step="reset">Neuen Wiederherstellungscode anfordern</button>':''))+'</nav>';
  const field=root.querySelector('[name="email"]');if(field)field.value=email;
 }
 if(focus)title.focus();
}
root.addEventListener('click',event=>{const step=event.target.closest('[data-step]')?.dataset.step;if(step&&!busy){email=root.querySelector('[name="email"]')?.value??email;show(step);}});
root.addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;const form=event.target,step=form.dataset.action,data=Object.fromEntries(new FormData(form));email=data.email??email;
 const action=['setup','reset'].includes(step)?'request':step;if(action==='request')data.purpose=step;if(step==='login')data.remember=form.elements.remember.checked;
 busy=true;for(const button of root.querySelectorAll('button'))button.disabled=true;message.textContent='Bitte warten …';
 try{const response=await fetch('/auth/customer/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw Error(result.error||'Bitte erneut versuchen.');
  if(action==='login'){location.replace('/kunde');return;}
  if(action==='request'){show('verify');message.textContent=result.message;}
  else if(action==='verify')show('password');
  else if(action==='password')show('success');
 }catch(error){message.textContent=error.message;}finally{busy=false;for(const button of root.querySelectorAll('button'))button.disabled=false;}
});
show(new URL(location.href).searchParams.get('step')??'login',false);
