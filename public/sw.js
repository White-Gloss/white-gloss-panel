// Service worker of the Vor-Ort app: keeps only the program files for poor reception.
// Customer data, API answers and sign-in pages are never stored.
const CACHE='wg-vor-ort-v1';
const SHELL=['/vor-ort','/style.css','/vor-ort.js','/protocol-form.js','/protocol-photos.js','/signature.js','/pricing.js','/catalog.mjs','/assessment.mjs','/manifest.webmanifest','/icon-192.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>Promise.allSettled(SHELL.map(url=>fetch(url,{credentials:'same-origin',redirect:'manual'}).then(response=>response.ok&&!response.redirected?cache.put(url,response):null)))).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/auth/'))return;
  const shell=url.pathname==='/vor-ort'||SHELL.includes(url.pathname);if(!shell)return;
  event.respondWith(fetch(event.request).then(response=>{if(response.ok&&!response.redirected&&response.type==='basic'){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(url.pathname,copy));}return response;}).catch(async()=>(await caches.match(url.pathname))??new Response('<!doctype html><meta charset="utf-8"><title>Offline</title><p>Keine Verbindung. Bitte später erneut öffnen.</p>',{headers:{'Content-Type':'text/html; charset=utf-8'}})));
});
