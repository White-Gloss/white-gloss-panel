const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function pushHTML(){return '<section class="card sectiongap" id="push-settings"><div class="card-title"><h2>Handy-Benachrichtigungen</h2></div><div class="card-body"><p>Neue Anfragen, Kundenfreigaben und Versandprobleme direkt auf dein Gerät. Kundennamen und Fotos erscheinen nicht auf dem Sperrbildschirm.</p><p class="hint">Auf dem iPhone / iPad zuerst zum Home-Bildschirm hinzufügen und von dort öffnen. Die Freigabe gilt jeweils für dieses Gerät.</p><button data-push="enable">Dieses Gerät verbinden</button><div id="push-state" role="status"></div></div></section>';}
export async function mountPush(root,api){
  if(!root||root.dataset.mounted)return;root.dataset.mounted='true';const status=root.querySelector('#push-state');let data,deviceId;
  const supported='serviceWorker' in navigator&&'PushManager' in globalThis&&'Notification' in globalThis;
  const refresh=async()=>{data=await api('push');const registration=await navigator.serviceWorker?.getRegistration('/');const subscription=await registration?.pushManager.getSubscription();deviceId=subscription?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(subscription.endpoint)))).map(v=>v.toString(16).padStart(2,'0')).join(''):null;
    status.innerHTML=`<p>${supported?'Browser-Freigabe: '+esc(Notification.permission):'Dieser Browser bietet hier keine Push-Freigabe. Nutze einen unterstützten Browser bzw. die installierte Home-Bildschirm-App.'}</p>${data.devices.map(d=>`<div class="daily-task"><span>${esc(d.label)}${d.id===deviceId?' · dieses Gerät':''}</span><button data-push="test" data-id="${d.id}">Test senden</button><button data-push="remove" data-id="${d.id}">Entfernen</button></div>`).join('')}<p class="hint">${data.delivery.filter(d=>['failed','unknown'].includes(d.state)).reduce((n,d)=>n+d.count,0)} Push-Zustellungen ohne bestätigten Erfolg.</p>`;
  };
  root.addEventListener('click',async event=>{const button=event.target.closest('[data-push]');if(!button)return;button.disabled=true;
    try{const action=button.dataset.push;
      if(action==='enable'){
        if(!supported)throw Error('Push ist in diesem Browser nicht verfügbar. Auf iPhone/iPad die installierte Home-Bildschirm-App öffnen.');
        // Must be requested from the owner's button click, never automatically.
        const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Benachrichtigungen wurden nicht erlaubt. Die Freigabe kannst du in den Browsereinstellungen ändern.');
        const registration=await navigator.serviceWorker.register('/push-worker.js',{scope:'/'});await navigator.serviceWorker.ready;
        const key=Uint8Array.from(atob(data.publicKey.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-data.publicKey.length%4)%4)),c=>c.charCodeAt(0));
        const subscription=await registration.pushManager.getSubscription()??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
        await api('push',{action:'subscribe',subscription:subscription.toJSON(),label:'Mein '+(/Mobi/i.test(navigator.userAgent)?'Handy':'Browser')});
      }else if(action==='remove'){await api('push',{action:'remove',id:button.dataset.id});if(button.dataset.id===deviceId){const registration=await navigator.serviceWorker.getRegistration('/');await (await registration?.pushManager.getSubscription())?.unsubscribe();}}
      else if(action==='test'){const result=await api('push',{action:'test',id:button.dataset.id});status.insertAdjacentHTML('beforeend','<p>'+esc(result.message)+'</p>');return;}
      await refresh();
    }catch(error){status.insertAdjacentHTML('beforeend','<p class="error">'+esc(error.message)+'</p>');}finally{button.disabled=false;}
  });
  try{await refresh();}catch(error){status.textContent=error.message;}
}
