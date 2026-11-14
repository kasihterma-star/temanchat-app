// V6 tidak pernah cache API, sesi, HTML login, atau foto pribadi.
const CACHE='temanchat-v68-glass-dark-profile';
const ASSETS=['/style.css?v=6.8','/v6.css?v=6.8','/app.js?v=6.8','/storage.js?v=6.8','/config.js?v=6.8','/auth.css?v=6.8','/auth.js?v=6.8','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png'];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(async c=>{await Promise.allSettled(ASSETS.map(p=>c.add(p)));}));self.skipWaiting();
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('temanchat-')&&k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==location.origin)return;
 if(url.pathname.startsWith('/api/')||url.pathname==='/'||url.pathname.endsWith('.html'))return;
 event.respondWith(fetch(request).then(r=>{
  if(r.ok&&r.type==='basic'){const copy=r.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(request,copy)));}
  return r;
 }).catch(()=>caches.match(request)));
});

// Web Push tetap diterima ketika halaman PWA ditutup, selama OS mengizinkan.
self.addEventListener('push',event=>{
 let d={title:'TemanChat',body:'Ada pesan baru',url:'/',tag:'tc-event'};
 try{if(event.data)d={...d,...event.data.json()};}catch{}
 const safeUrl=typeof d.url==='string'&&d.url.startsWith('/')&&!d.url.startsWith('//')?d.url:'/';
 event.waitUntil((async()=>{
  // Acknowledge hanya bila push benar-benar diproses pada perangkat yang memiliki sesi penerima.
  // Tidak menandai pesan sebagai "dibaca".
  const tasks=[];
  if(d.kind==='message'&&typeof d.conversationId==='string'&&Number.isSafeInteger(Number(d.messageId))){
   tasks.push(fetch('/api/chat/push-delivered',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId:d.conversationId,messageId:d.messageId})})
    .then(r=>{if(!r.ok)console.warn('Delivery acknowledgement',r.status)}).catch(e=>console.warn('Delivery ack',e)));
  }
  if(d.kind==='call'&&typeof d.callId==='string'){
    tasks.push(fetch('/api/calls/ringing-ack',{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({callId:d.callId})})
      .then(r=>{if(!r.ok)console.warn('Call ringing acknowledgement',r.status)})
      .catch(e=>console.warn('Call ringing ack',e)));
  }
  if(Number.isFinite(Number(d.unreadCount))&&typeof self.navigator?.setAppBadge==='function'){
   tasks.push(Promise.resolve().then(()=>Number(d.unreadCount)>0?self.navigator.setAppBadge(Number(d.unreadCount)):self.navigator.clearAppBadge()).catch(()=>{}));
  }
  tasks.push(self.registration.showNotification(String(d.title||'TemanChat').slice(0,90),{
   body:String(d.body||'Ada aktivitas baru').slice(0,180),icon:'/icons/icon-192.png',
   badge:'/icons/icon-192.png',tag:String(d.tag||'tc-event'),data:{url:safeUrl},renotify:true
  }));
  await Promise.allSettled(tasks);
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const url=new URL(event.notification.data?.url||'/',self.location.origin).href;
 event.waitUntil((async()=>{
  const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(c=>new URL(c.url).origin===self.location.origin);
  if(existing){await existing.navigate(url);return existing.focus()}
  return clients.openWindow(url);
 })());
});
