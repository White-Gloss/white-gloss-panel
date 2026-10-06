/* No fetch handler: customer data, photos and responses are never cached. */
self.addEventListener('push',event=>{
  let data;try{data=event.data.json();}catch{return;}
  const path=/^\/\?order=[a-f0-9-]{36}$/.test(data.url)?data.url:'/';
  event.waitUntil(self.registration.showNotification(String(data.title??'White Gloss').slice(0,100),{body:String(data.body??'Bitte Panel öffnen.').slice(0,180),tag:path,data:{path},icon:'/panel-icon.svg'}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();const path=event.notification.data?.path;
  event.waitUntil(self.clients.openWindow(new URL(/^\/\?order=[a-f0-9-]{36}$/.test(path)?path:'/',self.location.origin).href));
});
