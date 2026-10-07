const authForm=document.querySelector('#auth-form'),authMessage=document.querySelector('#auth-message'),recovery=document.querySelector('#auth-recovery');
const authURL=new URL(location.href),authToken=authURL.searchParams.get('token');
let authReturn=authURL.searchParams.get('returnTo')??'/',emailMode=false,customerMode=false,resetMode=false;
function requirePin(){if(authForm.querySelector('#auth-pin'))return;const label=document.createElement('label');label.textContent='Persönliche PIN aus deiner E-Mail';const field=document.createElement('input');field.id='auth-pin';field.type='text';field.inputMode='numeric';field.autocomplete='one-time-code';field.pattern='[0-9]{6}';field.minLength=6;field.maxLength=6;field.required=true;label.append(field);authForm.prepend(label);document.querySelector('#auth-description').textContent='Gib die sechsstellige PIN aus derselben E-Mail ein. Der persönliche Link kann einmal verwendet werden.';}
function useEmail(setup){
  emailMode=true;if(setup)authReturn='/auth/password';
  document.querySelector('#auth-password-label').hidden=true;
  document.querySelector('#auth-password').disabled=true;
  document.querySelector('#auth-email').autocomplete='email';
  authForm.querySelector('button').textContent='Anmeldelink anfordern';
  document.querySelector('#auth-description').textContent=setup?'Bestätige deinen Betreiberzugang per E-Mail. Anschließend legst du dein Passwort fest.':'Melde dich mit der E-Mail-Adresse deiner Anfrage an. Du erhältst einen persönlichen Link zu deinem Angebot.';
  recovery.hidden=true;authMessage.textContent='';
}
function useCustomer(reset=false){
  customerMode=true;resetMode=reset;authReturn='/kundenportal';
  document.querySelector('#auth-password-label').hidden=true;document.querySelector('#auth-password').disabled=true;
  if(!reset&&!authForm.querySelector('#auth-pin'))requirePin();
  const pin=authForm.querySelector('#auth-pin');if(pin){pin.disabled=reset;pin.parentElement.hidden=reset;pin.autocomplete='current-password';}
  document.querySelector('#auth-email').autocomplete='username';
  document.querySelector('#auth-description').textContent=reset?'Fordere eine neue persönliche PIN an. Erst der bestätigte E-Mail-Link ersetzt deine bisherige PIN.':'Melde dich mit deiner E-Mail-Adresse und deiner persönlichen PIN wiederholt in deinem Kundenpanel an.';
  authForm.querySelector('button').textContent=reset?'Neue PIN anfordern':'Mit PIN anmelden';recovery.textContent=reset?'Zur Anmeldung zurück':'PIN vergessen / erstmalig anfordern';recovery.hidden=false;authMessage.textContent='';
}
if(authToken){authForm.innerHTML='<button class="primary" type="submit">Persönliche Anmeldung bestätigen</button>';document.querySelector('#auth-description').textContent='Bestätige die Anmeldung. Dieser Link kann einmal verwendet werden.';recovery.hidden=true;if(authURL.searchParams.get('pin')==='required')requirePin();history.replaceState(null,'','/auth/verify');}
else if(authURL.searchParams.get('customer')==='1')useCustomer(authURL.searchParams.get('reset')==='1');
else if(/^\/angebot\/[a-f0-9]{64}$/.test(authReturn))useEmail(false);
else if(authURL.searchParams.get('setup')==='1')useEmail(true);
recovery.addEventListener('click',()=>customerMode?useCustomer(!resetMode):useEmail(true));
authForm.addEventListener('submit',async event=>{
  event.preventDefault();const button=authForm.querySelector('button');button.disabled=true;authMessage.textContent='';
  try{
    const body=authToken?{token:authToken,pin:document.querySelector('#auth-pin')?.value}:customerMode?{email:document.querySelector('#auth-email').value,pin:document.querySelector('#auth-pin')?.value,returnTo:authReturn}:emailMode?{email:document.querySelector('#auth-email').value,returnTo:authReturn}:{email:document.querySelector('#auth-email').value,password:document.querySelector('#auth-password').value,returnTo:authReturn};
    const result=await fetch(authToken?'/auth/redeem':customerMode?(resetMode?'/auth/customer/reset/request':'/auth/customer/login'):emailMode?'/auth/request':'/auth/password/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await result.json();if(!result.ok){if(data.pinRequired)requirePin();throw Error(data.error);}
    if(data.returnTo&&data.customerPortal){authMessage.textContent=data.personalPinActivated?'Diese PIN ist jetzt deine persönliche Kunden-PIN. Du kannst dich damit und deiner E-Mail-Adresse wiederholt unter „Mein Kundenpanel“ anmelden. Bewahre sie sicher auf.':'Die Anmeldung ist bestätigt. Diese Eingabe-PIN gehört zu diesem Bestätigungslink. Deine bereits eingerichtete persönliche Kunden-PIN bleibt unverändert. Falls du sie vergessen hast, kannst du sie bei der Kundenpanel-Anmeldung erneuern.';authForm.replaceChildren();const link=document.createElement('a');link.href=data.returnTo;link.className='primary';link.textContent=data.returnTo==='/kundenportal'?'Mein Kundenpanel öffnen':'Zum Angebot weiter';authForm.append(link);if(data.returnTo!=='/kundenportal'){const portal=document.createElement('a');portal.href='/kundenportal';portal.textContent='Mein Kundenpanel';authForm.append(portal);}}else if(data.returnTo)location.replace(data.returnTo);else authMessage.textContent=data.message;
  }catch(error){authMessage.textContent=error.message;}finally{button.disabled=false;}
});
