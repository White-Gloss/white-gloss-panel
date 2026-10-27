// Progressive mobile enhancement: installation and owner-only Web Push.
// Permission is requested only after an explicit button press; no delivery success is invented.
let installPrompt=null,installAccepted=false,installCompleted=false;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;installAccepted=false;installCompleted=false;updateInstallHint();});
window.addEventListener('appinstalled',()=>{installPrompt=null;installAccepted=false;installCompleted=true;updateInstallHint();});
const standalone=()=>installCompleted||window.matchMedia?.('(display-mode: standalone)')?.matches||navigator.standalone===true;
function updateInstallHint(){
  const button=document.querySelector('#device-install'),hint=document.querySelector('#device-install-hint');if(!button||!hint)return;
  const installed=standalone();button.hidden=installed||!installPrompt||installAccepted;
  hint.textContent=installed?'Die App ist auf diesem Gerät installiert.':installAccepted?'Die Installation wurde bestätigt. Der Browser schließt sie nun ab.':installPrompt?'Du kannst die Vor-Ort-App auf diesem Gerät installieren.':/iPad|iPhone|iPod/.test(navigator.userAgent)?'Auf diesem Gerät: Teilen → „Zum Home-Bildschirm“. Die Browser-Version bleibt ebenfalls nutzbar.':'Falls dein Browser die Installation anbietet, findest du sie im Browser-Menü unter „App installieren“ oder „Zum Home-Bildschirm hinzufügen“.';
}
async function request(path,data){
  const response=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),credentials:'same-origin'});
  const result=await response.json().catch(()=>({error:'Verbindung nicht lesbar.'}));if(!response.ok)throw Error(result.error??'Geräteeinstellung fehlgeschlagen.');return result;
}
function keyBytes(value){
  const base64=value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'=');
  return Uint8Array.from(atob(base64),character=>character.charCodeAt(0));
}
function keyString(buffer){return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export function mountDeviceCenter(container){
  if(!container)return;
  container.innerHTML='<details class="card sectiongap device-center"><summary><strong>App & Benachrichtigungen</strong></summary><div class="device-grid"><section><h3>Vor-Ort-App installieren</h3><p class="hint" id="device-install-hint"></p><button type="button" id="device-install" hidden>App installieren</button></section><section><h3>Betreiber-Benachrichtigungen</h3><p class="hint">Nur ein neutraler Hinweis bei neuen Website-Anfragen, Kundenchat- und WhatsApp-Nachrichten. Keine Kundendaten auf dem Sperrbildschirm.</p><p id="device-push-status" class="hint" role="status">Status wird geprüft …</p><div class="actions"><button type="button" id="device-push-enable">Auf diesem Gerät aktivieren</button><button type="button" id="device-push-disable" hidden>Auf diesem Gerät deaktivieren</button></div></section></div></details>';
  const install=container.querySelector('#device-install'),enable=container.querySelector('#device-push-enable'),disable=container.querySelector('#device-push-disable'),status=container.querySelector('#device-push-status');
  updateInstallHint();
  install.onclick=async()=>{
    if(!installPrompt)return;install.disabled=true;try{const prompt=installPrompt;await prompt.prompt();const choice=await prompt.userChoice;installAccepted=choice.outcome==='accepted';installPrompt=null;if(!installAccepted)container.querySelector('#device-install-hint').textContent='Die Installation wurde abgebrochen. Du kannst sie über das Browser-Menü erneut starten.';}catch{installAccepted=false;container.querySelector('#device-install-hint').textContent='Die Installation wurde nicht bestätigt. Du kannst es über das Browser-Menü erneut versuchen.';}finally{install.disabled=false;updateInstallHint();}
  };
  const refresh=async()=>{
    if(!('serviceWorker' in navigator)||!('PushManager' in window)||!window.Notification){status.textContent='Web Push wird von diesem Browser nicht unterstützt. Die App funktioniert trotzdem; neue Vorgänge siehst du nach dem Öffnen.';enable.hidden=true;disable.hidden=true;return;}
    if(window.Notification.permission==='denied'){status.textContent='Benachrichtigungen sind im Browser blockiert. Du kannst sie in den Website-Einstellungen des Browsers wieder erlauben.';enable.hidden=false;disable.hidden=true;}
    try{
      const current=await request('push');enable.hidden=false;disable.hidden=!current.thisDevice;
      status.textContent=current.thisDevice?(current.lastStatus==='sent'?'Dieses Gerät ist registriert. Der Push-Dienst hat die letzte Nachricht angenommen; die Anzeige auf dem Gerät ist damit nicht garantiert.':current.lastStatus==='failed'?'Dieses Gerät ist registriert, aber die letzte Zustellung wurde nicht bestätigt. '+(current.lastError??''):'Dieses Gerät ist registriert. Die erste echte Zustellung steht noch aus.'):(current.configured?'Push ist eingerichtet, aber dieses Gerät ist noch nicht registriert.':'Push ist noch nicht eingerichtet. Beim Aktivieren wird ein geschützter Schlüssel erzeugt; es wird keine Testnachricht versendet.')+(current.lastError&&!current.thisDevice?' '+current.lastError:'');
    }catch(error){status.textContent=error.message;}
  };
  enable.onclick=async()=>{
    enable.disabled=true;status.textContent='Browserberechtigung und Geräte-Registrierung werden geprüft …';
    try{
      if(!('serviceWorker' in navigator)||!('PushManager' in window)||!window.Notification)throw Error('Web Push wird von diesem Browser nicht unterstützt.');
      const permission=window.Notification.permission==='granted'?'granted':await window.Notification.requestPermission();
      if(permission!=='granted')throw Error('Benachrichtigungen wurden nicht erlaubt. Es wurde keine Registrierung gespeichert.');
      let registration=await navigator.serviceWorker.getRegistration('/');if(!registration)registration=await navigator.serviceWorker.register('/sw.js');registration=await navigator.serviceWorker.ready;
      const setup=await request('push/setup',{});let subscription=await registration.pushManager.getSubscription();
      if(subscription?.options?.applicationServerKey&&keyString(subscription.options.applicationServerKey)!==setup.publicKey){await subscription.unsubscribe();subscription=null;}
      if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(setup.publicKey)});
      await request('push/subscription',subscription.toJSON());await refresh();
    }catch(error){status.textContent=error.message;}finally{enable.disabled=false;}
  };
  disable.onclick=async()=>{
    disable.disabled=true;try{
      const registration=await navigator.serviceWorker.getRegistration('/'),subscription=await registration?.pushManager.getSubscription();
      if(subscription){await request('push/subscription/delete',{endpoint:subscription.endpoint});await subscription.unsubscribe();}
      status.textContent='Dieses Gerät wurde abgemeldet.';disable.hidden=true;enable.hidden=false;
    }catch(error){status.textContent=error.message;}finally{disable.disabled=false;}
  };
  refresh();
}
