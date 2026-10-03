const passwordForm=document.querySelector('#password-form'),passwordMessage=document.querySelector('#password-message');
passwordForm.addEventListener('submit',async event=>{
  event.preventDefault();const button=passwordForm.querySelector('button');button.disabled=true;passwordMessage.textContent='';
  try{
    const body=Object.fromEntries(new FormData(passwordForm));
    const response=await fetch('/auth/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw Error(result.error);
    passwordForm.reset();passwordMessage.textContent=result.message;
    button.textContent='Passwort gespeichert';
    const link=document.createElement('a');link.href='/';link.textContent='Panel öffnen';passwordMessage.append(document.createElement('br'),link);
  }catch(error){passwordMessage.textContent=error.message;button.disabled=false;}
});
