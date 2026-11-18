// V6 tidak pernah cache API, sesi, HTML login, atau foto pribadi.
const CACHE='temanchat-v995-responsive-layout';
const ASSETS=['/style.css?v=9.9.5','/v6.css?v=9.9.5','/share.js?v=9.9.5','/app.js?v=9.9.5','/storage.js?v=9.9.5','/config.js?v=9.9.5','/auth.css?v=9.9.5','/auth.js?v=9.9.5','/confirm-email.js?v=9.9.5','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/icons/temanchat-logo.png'];
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
 // Hanya aset statis dalam daftar versi yang boleh cache-first.
 // API, halaman login, dan foto pribadi tidak pernah disimpan di cache ini.
 const staticAsset=ASSETS.includes(url.pathname+url.search)||ASSETS.includes(url.pathname);
 event.respondWith((async()=>{
  if(staticAsset){const cached=await caches.match(request);if(cached)return cached;}
  try{
   const response=await fetch(request);
   if(staticAsset&&response.ok&&response.type==='basic'){
    const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)));
   }
   return response;
  }catch(error){const cached=await caches.match(request);if(cached)return cached;throw error;}
 })());
});

// Simpan preferensi per-perangkat secara terpisah dari localStorage halaman.
// IndexedDB dapat dibaca Service Worker, termasuk saat halaman PWA tertutup.
const TC_PREF_DB='tc-push-device-prefs-v78';
function tcPrefsDb(){return new Promise((resolve,reject)=>{
 const req=indexedDB.open(TC_PREF_DB,1);
 req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('settings'))req.result.createObjectStore('settings')};
 req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
})}
async function tcModeStore(mode){const db=await tcPrefsDb();try{await new Promise((resolve,reject)=>{
 const tx=db.transaction('settings','readwrite');tx.objectStore('settings').put(mode,'mode');
 tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
})}finally{db.close()}}
async function tcModeRead(){try{const db=await tcPrefsDb();try{return await new Promise((resolve,reject)=>{
 const tx=db.transaction('settings','readonly');const req=tx.objectStore('settings').get('mode');
 req.onsuccess=()=>resolve(['both','sound','vibrate','silent'].includes(req.result)?req.result:'both');
 req.onerror=()=>reject(req.error);
})}finally{db.close()}}catch{return 'both'}}
self.addEventListener('message',event=>{
 const d=event.data;if(d?.type!=='tc-notification-mode'||!['both','sound','vibrate','silent'].includes(d.mode))return;
 event.waitUntil(tcModeStore(d.mode).catch(e=>console.warn('Mode notifikasi',e)));
});
// Web Push tetap diterima ketika halaman PWA ditutup, selama OS mengizinkan.
async function tcCloseCallNotification(callId){
 const tag='tc-call-'+callId;
 const list=await self.registration.getNotifications({tag});
 for(const n of list)n.close();
}
self.addEventListener('message',event=>{
 if(event.data?.type==='tc-call-close'&&typeof event.data.callId==='string'&&/^[0-9a-f-]{36}$/i.test(event.data.callId))
  event.waitUntil(tcCloseCallNotification(event.data.callId));
});
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
  if(d.kind==='call_end'&&typeof d.callId==='string'){
   await tcCloseCallNotification(d.callId);
   return;
  }
  if(d.kind==='missed_call'&&typeof d.callId==='string'){
   await tcCloseCallNotification(d.callId);
  }
  if(d.kind==='call'&&typeof d.callId==='string'){
    // JANGAN menunda notifikasi panggilan untuk memeriksa state melalui jaringan.
    // Saat HP terkunci, cookie / konektivitas dapat menunda fetch hingga panggilan selesai.
    // Push ber-TTL pendek; panggilan selesai ditutup oleh event call_end,
    // dan status tetap diverifikasi saat notifikasi diklik.
    tasks.push(fetch('/api/calls/ringing-ack',{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({callId:d.callId})})
      .then(r=>{if(!r.ok)console.warn('Call ringing acknowledgement',r.status)})
      .catch(e=>console.warn('Call ringing ack',e)));
  }
  if(Number.isFinite(Number(d.unreadCount))&&typeof self.navigator?.setAppBadge==='function'){
   tasks.push(Promise.resolve().then(()=>Number(d.unreadCount)>0?self.navigator.setAppBadge(Number(d.unreadCount)):self.navigator.clearAppBadge()).catch(()=>{}));
  }
  const notificationMode=await Promise.race([
   tcModeRead(),new Promise(resolve=>setTimeout(()=>resolve('both'),700))
  ]);
  tasks.push(self.registration.showNotification(String(d.title||'TemanChat').slice(0,90),{
   body:String(d.body||'Ada aktivitas baru').slice(0,180),icon:'/icons/icon-192.png',
   badge:'/icons/icon-192.png',tag:String(d.tag||'tc-event'),data:{url:safeUrl,kind:d.kind||'',callId:d.callId||''},renotify:true,
   // Jangan pakai silent:true bersama vibrate; kombinasi tersebut tidak valid.
   silent:notificationMode==='silent',
   ...(['both','vibrate'].includes(notificationMode)?{vibrate:d.kind==='call'?[300,120,300,120,500,200,300]:[180,90,180]}:{})
  }));
  await Promise.allSettled(tasks);
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const details=event.notification.data;
 const url=new URL(details?.url||'/',self.location.origin).href;
 event.waitUntil((async()=>{
  // Saat notifikasi panggilan diketuk, pastikan belum dibatalkan/diangkat.
  if(details?.kind==='call'&&details?.callId){
   try{const r=await fetch('/api/calls/state?callId='+encodeURIComponent(details.callId),{credentials:'same-origin',cache:'no-store'});
    if(!r.ok||(await r.json()).call?.status!=='ringing')return;
   }catch{return}
  }
  const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(c=>new URL(c.url).origin===self.location.origin);
  if(existing){await existing.navigate(url);return existing.focus()}
  return clients.openWindow(url);
 })());
});

// Best effort: beberapa browser memicu event ini saat subscription push dirotasi.
// Pada browser lain, app.js juga menyegarkan subscription saat dibuka kembali.
function tcDecodeVapidKey(text){
 const pad='='.repeat((4-text.length%4)%4);
 const bytes=atob((text+pad).replace(/-/g,'+').replace(/_/g,'/'));
 return Uint8Array.from(bytes,c=>c.charCodeAt(0));
}
self.addEventListener('pushsubscriptionchange',event=>{
 event.waitUntil((async()=>{
  try{
   const cfg=await fetch('/api/push/config',{credentials:'include',cache:'no-store'}).then(r=>r.json());
   if(!cfg?.configured||!cfg.publicKey)return;
   const sub=event.newSubscription||await self.registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:tcDecodeVapidKey(cfg.publicKey)});
   if(!sub)return;
   const res=await fetch('/api/push/subscribe',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:sub.toJSON()})});
   if(!res.ok)console.warn('Memperbarui langganan push gagal',res.status);
  }catch(e){console.warn('Push perlu sinkronisasi saat aplikasi dibuka',e?.message||e)}
 })());
});
