// V6 tidak pernah cache API, sesi, HTML login, atau foto pribadi.
const CACHE='temanchat-v63-static';
const ASSETS=['/style.css?v=6.3','/v6.css?v=6.3','/app.js?v=6.3','/storage.js?v=6.3','/config.js?v=6.3','/auth.css?v=6.3','/auth.js?v=6.3','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png'];
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
