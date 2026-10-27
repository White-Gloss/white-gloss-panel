// Service worker of the Vor-Ort app: keeps only the program files for poor reception.
// Customer data, API answers and sign-in pages are never stored.
const CACHE='wg-vor-ort-v4';
const SHELL=['/vor-ort','/style.css','/brand.css','/barlow-latin.woff2','/barlow-latin-medium.woff2','/barlow-latin-semibold.woff2','/vor-ort.js','/device.js','/dilution.js','/protocol-form.js','/protocol-photos.js','/signature.js','/pricing.js','/catalog.mjs','/assessment.mjs','/manifest.webmanifest','/icon-192.png'];
// Installation succeeds only with a complete shell; otherwise the previous worker and cache stay in use.
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE+'-install').then(async staging=>{await Promise.all(SHELL.map(async url=>{const response=await fetch(url,{credentials:'same-origin',redirect:'manual'});if(!response.ok||response.redirected||response.type!=='basic')throw Error('Programmdatei fehlt: '+url);await staging.put(url,response);}));const cache=await caches.open(CACHE);for(const request of await staging.keys())await cache.put(request,await staging.match(request));await caches.delete(CACHE+'-install');}).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/auth/'))return;
  const shell=url.pathname==='/vor-ort'||SHELL.includes(url.pathname);if(!shell)return;
  event.respondWith(fetch(event.request).then(response=>{if(response.ok&&!response.redirected&&response.type==='basic'){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(url.pathname,copy));}return response;}).catch(async()=>(await caches.match(url.pathname))??new Response('<!doctype html><meta charset="utf-8"><title>Offline</title><p>Keine Verbindung. Bitte später erneut öffnen.</p>',{headers:{'Content-Type':'text/html; charset=utf-8'}})));
});
self.addEventListener('push',event=>{
  let data={};try{data=event.data?.json()??{};}catch{return;}
  const allowed={'/#requests':'Neue Website-Anfrage im Panel.','/#chat':'Neue Kundennachricht im Panel.','/#whatsapp':'Neue WhatsApp-Nachricht im Panel.'};
  if(data.title!=='White Gloss'||data.body!==allowed[data.url])return;
  event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'/icon-192.png',badge:'/icon-192.png',tag:typeof data.tag==='string'&&/^wg-[a-z]+$/.test(data.tag)?data.tag:'wg-activity',data:{url:data.url}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();const path=event.notification.data?.url;
  if(!['/#requests','/#chat','/#whatsapp'].includes(path))return;
  const target=new URL(path,self.location.origin).href;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    for(const client of clients){if(new URL(client.url).origin===self.location.origin){await client.focus();if(client.url!==target)await client.navigate(target);return;}}
    return self.clients.openWindow(target);
  }));
});
