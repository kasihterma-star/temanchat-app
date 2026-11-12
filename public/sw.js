// V6 tidak pernah cache API, sesi, HTML login, atau foto pribadi.
const CACHE='temanchat-v66-static';
const ASSETS=['/style.css?v=6.6','/v6.css?v=6.6','/app.js?v=6.6','/storage.js?v=6.6','/config.js?v=6.6','/auth.css?v=6.6','/auth.js?v=6.6','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png'];
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
 event.waitUntil(self.registration.showNotification(String(d.title||'TemanChat').slice(0,90),{
  body:String(d.body||'Ada aktivitas baru').slice(0,180),
  icon:'/icons/icon-192.png',badge:'/icons/icon-192.png',tag:String(d.tag||'tc-event'),
  data:{url:safeUrl},renotify:true
 }));
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
