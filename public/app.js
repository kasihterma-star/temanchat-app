'use strict';
// TemanChat V6: chat real D1, media R2 opsional, panggilan WebRTC eksperimental.
const $ = id => document.getElementById(id);
const TCS = window.TCStorage;
let me=null,chats=[],active=null,lastId=0,searchResults=null,searchSeq=0;
let pollTimer=null,busyMessages=false,busyChats=false,lastListUpdate=0,toastTimer,installPrompt=null;
let mediaEnabled=false,currentCall=null,checkingCalls=false,callBusy=false;
let replyTarget=null,mediaPrefs={mode:'none',noticeSeen:false},noticeShowing=false;
let voiceRecorder=null,voiceStream=null,voiceChunks=[],voiceTimer=null,voiceStart=0,voiceElapsed=0;
let voiceLocked=false,voicePendingStart=false,voicePressing=false,voicePressY=0,voicePressX=0,voiceCancelRequested=false;
const MAX_VOICE_MS=180000;
const CALL_MODE_KEY='tc_call_mode_v87';
let remoteCallGranted=false;
let presenceBusy=false,lastPresenceBeat=0;
const PRESENCE_PING_MS=45000;
// V7.2: indikator mengetik tidak mengirim konten dan tidak menyimpan histori.
// Pembaruan dibatasi saat input aktif; status otomatis hilang di server setelah 9 detik.
let typingOn=false,typingChatId=null,typingLastSent=0,typingIdleTimer=null;
let partnerTyping=false,typingReadBusy=false,typingPollTimer=null;
let typingPostQueue=Promise.resolve();
// Notifikasi browser best-effort saat JavaScript berjalan; BUKAN Web Push saat PWA ditutup.
let notificationBaselineReady=false;
const previousUnread=new Map();
const BASE_TITLE='TemanChat — Pesan';
// Pilihan tema lokal: sistem, terang, atau gelap.
const THEME_KEY='tc_theme';
function applyTheme(choice){
 const theme=['light','dark','system'].includes(choice)?choice:'system';
 document.documentElement.dataset.theme=theme;
 try{localStorage.setItem(THEME_KEY,theme)}catch{}
 const dark=theme==='dark'||(theme==='system'&&matchMedia('(prefers-color-scheme:dark)').matches);
 const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=dark?'#151718':'#e9efec';
 document.querySelectorAll('[data-tc-theme]').forEach(button=>{
   const selected=button.dataset.tcTheme===theme;
   button.setAttribute('aria-pressed',String(selected));
   button.classList.toggle('is-active',selected);
 });
}
applyTheme(localStorage.getItem(THEME_KEY)||'system');

const readAcknowledged=new Map();
const seenChatLast=new Map();
function notifySupported(){return 'Notification' in window&&window.isSecureContext}
async function notifyLocal(title,body,tag){
 if(!notificationsEnabled()||!notifySupported()||Notification.permission!=='granted')return false;
 const mode=notificationMode();
 const options={body,tag,icon:'/icons/icon-192.png',renotify:true,...notificationStyle(mode)};
 // Hindari serviceWorker.ready yang dapat menggantung sebelum worker aktif.
 try{
  if('serviceWorker' in navigator){
   const reg=await navigator.serviceWorker.getRegistration();
   if(reg?.active && typeof reg.showNotification==='function'){
    await reg.showNotification(title,options);return true;
   }
  }
 }catch(e){console.warn('Notifikasi SW:',e)}
 try{
  const n=new Notification(title,options);
  n.onclick=()=>{window.focus();n.close()};return true;
 }catch(e){console.warn('Notifikasi browser:',e);return false}
}

// V6.6 Web Push: izin diminta HANYA setelah ketukan tombol di Pengaturan.
let serverPushEnabled=false,serverPushEndpoint='';
const NOTIFY_PREF='tc_notifications_enabled';
const notificationsEnabled=()=>localStorage.getItem(NOTIFY_PREF)!=='off';
const NOTIFY_MODE_KEY='tc_notification_mode_v78'; // tetap memakai preferensi versi terdahulu
const notificationMode=()=>{
 const mode=localStorage.getItem(NOTIFY_MODE_KEY)||'both';
 return ['both','sound','vibrate','silent'].includes(mode)?mode:'both';
};
const notificationStyle=mode=>({
 // silent:true tidak boleh digabung dengan vibrate pada Notifications API.
 // Getar saja adalah permintaan tanpa suara dari aplikasi, tetapi OS yang mengatur bunyi channel.
 silent:mode==='silent',
 ...(['both','vibrate'].includes(mode)?{vibrate:[180,90,180]}:{})
});
const soundAllowed=()=>['both','sound'].includes(notificationMode());
const vibrationAllowed=()=>notificationsEnabled()&&['both','vibrate'].includes(notificationMode());
const audioPreference=()=>notificationsEnabled()&&soundAllowed()&&localStorage.getItem('tc_call_sounds')!=='off';
function syncNotificationModeWorker(){
 try{const mode=notificationMode();if(navigator.serviceWorker?.controller)navigator.serviceWorker.controller.postMessage({type:'tc-notification-mode',mode});
  void navigator.serviceWorker?.ready?.then(reg=>{reg.active?.postMessage({type:'tc-notification-mode',mode})}).catch(()=>{});
 }catch(e){console.warn('Preferensi notifikasi ke SW',e)}
}
function vibrateForCall(){if(vibrationAllowed()&&typeof navigator.vibrate==='function'&&!document.hidden)navigator.vibrate([220,120,220,120,350])}

// Smart Notification: jangan membunyikan notifikasi hanya bila chat yang sama
// benar-benar terlihat dan sedang menjadi layar utama pengguna.
const visibleChatId=()=>{
 if(!active||document.hidden||document.visibilityState!=='visible')return null;
 if(typeof document.hasFocus==='function'&&!document.hasFocus())return null;
 if(innerWidth<=740&&$('conversation')?.classList.contains('mobile-hidden'))return null;
 return active.id;
};
let focusChatReported=null,focusLastAt=0,focusBusy=false,focusPending=false;
async function syncNotificationFocus(force=false){
 if(!me||!serverPushEnabled||!serverPushEndpoint||focusBusy)return;
 const chat=visibleChatId();
 if(!force&&focusChatReported===chat&&Date.now()-focusLastAt<9500)return;
 focusBusy=true;
 try{
  await post('/api/push/active-chat',{endpoint:serverPushEndpoint,active:!!chat,conversationId:chat||null});
  focusChatReported=chat;focusLastAt=Date.now();
 }catch(e){console.warn('Fokus notifikasi:',e.message)}
 finally{focusBusy=false;
  if(focusPending){focusPending=false;void syncNotificationFocus(true)}
 }
}
function updateNotificationFocus(force=false){
 if(focusBusy){focusPending=true;return}
 void syncNotificationFocus(force);
}
function leaveNotificationFocus(){
 if(!me||!serverPushEndpoint||!serverPushEnabled)return;
 // Request keepalive membantu saat tab tersembunyi atau layar terkunci.
 const endpoint=serverPushEndpoint;
 focusChatReported=null;focusLastAt=0;
 void fetch('/api/push/active-chat',{method:'POST',credentials:'same-origin',cache:'no-store',keepalive:true,
  headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint,active:false})}).catch(()=>{});
}

const badgeAPI=('setAppBadge' in navigator);
async function syncAppBadge(n){try{if(!badgeAPI)return;const count=notificationsEnabled()?Math.max(0,Number(n)||0):0;if(count)await navigator.setAppBadge(count);else if(navigator.clearAppBadge)await navigator.clearAppBadge();}catch(e){console.warn('Badge system',e.message)}}

const fromB64url=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
async function registerPush(){
 if(!('serviceWorker' in navigator)||!('PushManager' in window)||!notifySupported())throw Error('Perangkat atau browser tidak mendukung Web Push. Di iPhone buka aplikasi dari Layar Utama.');
 const cfg=await api('/api/push/config');
 if(!cfg.configured||!cfg.publicKey)throw Error('Kunci VAPID Cloudflare belum dikonfigurasi.');
 let reg=await navigator.serviceWorker.getRegistration('/');
 if(!reg)reg=await navigator.serviceWorker.register('/sw.js');
 await navigator.serviceWorker.ready;
 const permission=await Notification.requestPermission();
 if(permission!=='granted')throw Error('Izinkan notifikasi melalui pengaturan perangkat.');
 let sub=await reg.pushManager.getSubscription();
 if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:fromB64url(cfg.publicKey)});
 await post('/api/push/subscribe',{subscription:sub.toJSON()});
 serverPushEnabled=true;serverPushEndpoint=sub.endpoint;
 updateNotificationFocus(true);
 return true;
}
async function checkPush(){
 if(!notificationsEnabled()){serverPushEnabled=false;return}
 try{
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||Notification.permission!=='granted')return;
  const reg=await navigator.serviceWorker.getRegistration('/');
  const sub=await reg?.pushManager.getSubscription();
  if(sub){await post('/api/push/subscribe',{subscription:sub.toJSON()});serverPushEnabled=true;serverPushEndpoint=sub.endpoint;updateNotificationFocus(true);}
 }catch(e){console.warn('Push registration refresh',e.message)}
}
const UUID=/^[0-9a-f-]{36}$/;
function element(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function toast(message){const t=$('toast');t.textContent=message;t.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('visible'),4100);}
async function api(url,options={}){
 let r;try{r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});}
 catch{throw Error('Tidak dapat terhubung. Periksa internet.')}
 if(r.status===401){location.replace('/auth.html');throw Error('Sesi berakhir')}
 let d;try{d=await r.json()}catch{throw Error('Respons server tidak valid.')}
 if(!r.ok||!d.ok)throw Error(d.error||'Terjadi masalah server.');return d;
}
const post=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const avatar=name=>(name||'?').trim().charAt(0).toUpperCase();
let ownAvatarVersion=0;
function paintAvatar(node,name,username){
 if(!node)return;
 node.replaceChildren(document.createTextNode(avatar(name)));
 if(typeof username!=='string'||!/^[a-z0-9_]{3,24}$/i.test(username))return;
 const img=document.createElement('img');img.className='tc-avatar-photo';img.alt='';img.decoding='async';
 img.onerror=()=>img.remove();
 img.src='/api/avatar/'+encodeURIComponent(username)+(me&&username===me.username?'?v='+ownAvatarVersion:'');
 node.append(img);
}
function makeAvatar(name,username,extraClass='avatar teal'){
 const node=element('div',extraClass);paintAvatar(node,name,username);return node;
}
async function prepareAvatarPhoto(file){
 if(!file||!/^image\/(jpeg|png|webp|gif)$/i.test(file.type))throw Error('Pilih foto JPG, PNG, WEBP, atau GIF.');
 if(file.size>6*1024*1024)throw Error('Foto asal maksimal 6 MB.');
 const url=URL.createObjectURL(file);
 try{
  const img=await new Promise((resolve,reject)=>{
   const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('Gambar tidak dapat dibaca.'));
   i.src=url;
  });
  if(!img.naturalWidth||!img.naturalHeight)throw Error('Dimensi foto tidak valid.');
  const side=Math.min(img.naturalWidth,img.naturalHeight);
  const draw=(pixels,quality)=>{
   const canvas=document.createElement('canvas');canvas.width=pixels;canvas.height=pixels;
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas tidak tersedia.');
   ctx.drawImage(img,(img.naturalWidth-side)/2,(img.naturalHeight-side)/2,side,side,0,0,pixels,pixels);
   return canvas.toDataURL('image/jpeg',quality);
  };
  let dataUrl=draw(160,.76);
  if(dataUrl.length>76000)dataUrl=draw(128,.66);
  if(dataUrl.length>76000)throw Error('Foto masih terlalu besar, coba foto lain.');
  return dataUrl;
 }finally{URL.revokeObjectURL(url)}
}

function smallTime(val){if(!val)return'';const d=new Date(val.replace(' ','T')+(val.endsWith('Z')?'':'Z'));return Number.isNaN(d.getTime())?'':d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});}
// Waktu dari server adalah Unix seconds UTC, ditampilkan sesuai zona waktu perangkat.
function presenceLabel(person){
 if(!person)return 'Cari pengguna untuk mulai chat';
 if(Number(person.is_online)===1)return 'Online';
 const time=Number(person.last_active_at);
 if(!Number.isFinite(time)||time<=0)return 'Offline · belum pernah aktif';
 const last=new Date(time*1000),now=new Date();
 const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 const previous=new Date(last.getFullYear(),last.getMonth(),last.getDate());
 const days=Math.round((today.getTime()-previous.getTime())/86400000);
 const hhmm=last.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
 if(days===0)return 'Offline · terakhir aktif hari ini '+hhmm;
 if(days===1)return 'Offline · terakhir aktif kemarin '+hhmm;
 if(days>1&&days<7)return 'Offline · terakhir aktif '+last.toLocaleDateString('id-ID',{weekday:'long'})+' '+hhmm;
 return 'Offline · terakhir aktif '+last.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'})+' '+hhmm;
}
function presenceCompact(person){
 if(Number(person?.is_online)===1)return 'Online';
 const seconds=Number(person?.last_active_at);
 if(!seconds)return 'Offline';
 const minutes=Math.max(1,Math.floor((Date.now()/1000-seconds)/60));
 if(minutes<60)return 'Offline · '+minutes+' mnt lalu';
 if(minutes<1440)return 'Offline · '+Math.floor(minutes/60)+' jam lalu';
 return 'Offline';
}
async function heartbeatPresence(force=false){
 if(!me||document.hidden||document.visibilityState!=='visible'||presenceBusy)return;
 if(!force&&Date.now()-lastPresenceBeat<PRESENCE_PING_MS)return;
 presenceBusy=true;
 try{
  await post('/api/presence/heartbeat',{});
  lastPresenceBeat=Date.now();
 }catch(e){console.warn('Status online:',e.message)}
 finally{presenceBusy=false}
}

function queueTyping(chatId,isTyping){
 // Jalankan terurut agar permintaan berhenti tidak didahului permintaan mulai yang lambat.
 typingPostQueue=typingPostQueue.catch(()=>{}).then(()=>post('/api/chat/typing',{
  conversationId:chatId,isTyping
 })).catch(e=>{console.warn('Status mengetik:',e.message)});
}
function stopTyping(){
 clearTimeout(typingIdleTimer);typingIdleTimer=null;
 if(typingOn&&typingChatId)queueTyping(typingChatId,false);
 typingOn=false;typingChatId=null;typingLastSent=0;
}
function handleTypingInput(){
 if(!me||!active||document.hidden||document.visibilityState!=='visible'||!$('messageInput').value.trim()){
  stopTyping();return;
 }
 const chatId=active.id,now=Date.now();
 if(typingChatId&&typingChatId!==chatId)stopTyping();
 if(!typingOn||now-typingLastSent>3000){
  typingOn=true;typingChatId=chatId;typingLastSent=now;queueTyping(chatId,true);
 }
 clearTimeout(typingIdleTimer);
 typingIdleTimer=setTimeout(stopTyping,2700);
}
function drawPartnerTyping(){
 const show=!!active&&partnerTyping;
 const indicator=$('typingIndicator');indicator.hidden=!show;
 if(show)$('typingLabel').textContent=(active.other_name||'Teman')+' sedang mengetik…';
}
async function refreshPartnerTyping(){
 if(!me||!active||document.hidden||document.visibilityState!=='visible'||typingReadBusy)return;
 const chatId=active.id;typingReadBusy=true;
 try{
  const d=await api('/api/chat/typing?conversationId='+encodeURIComponent(chatId));
  if(!active||active.id!==chatId)return;
  const next=!!d.typing;
  if(partnerTyping!==next){
   partnerTyping=next;
   const row=chats.find(c=>c.id===chatId);
   if(row)row.is_typing=next?1:0;
   updateHeader(active);drawPartnerTyping();
   if(!$('search').value.trim()||searchResults===null)renderChats();
  }
 }catch(e){console.warn('Status mengetik teman:',e.message)}
 finally{typingReadBusy=false}
}
function showChat(){if(innerWidth<=740){$('sidebar').classList.remove('mobile-visible');$('conversation').classList.remove('mobile-hidden');}updateNotificationFocus(true);}
function showList(){stopTyping();if(innerWidth<=740){$('sidebar').classList.add('mobile-visible');$('conversation').classList.add('mobile-hidden');}updateNotificationFocus(true);}
function placeholder(msg){$('messages').replaceChildren(element('div','day',msg));}
function updateHeader(c){
 $('headName').textContent=c?c.other_name:'Pilih teman';
 document.querySelectorAll('.tc-header-verified').forEach(el=>el.remove());
 if(c&&Number(c.other_is_admin)===1){const badge=officialBadge();badge.classList.add('tc-header-verified');$('headName').after(badge)}
 paintAvatar($('headAvatar'),c?.other_name,c?.other_username);
 const isTyping=!!c&&c.id===active?.id&&partnerTyping;
 $('headStatus').textContent=isTyping?'Sedang mengetik…':presenceLabel(c);
 $('headStatus').classList.toggle('tc-status-typing',isTyping);
 $('headStatus').classList.toggle('tc-status-online',!isTyping&&!!c&&Number(c.is_online)===1);
 $('headStatus').title=c?'@'+c.other_username+' · '+(isTyping?'Sedang mengetik…':presenceLabel(c)):'';
 $('messageInput').disabled=!c;document.querySelector('.send').disabled=!c;
 $('attachBtn').disabled=!c;
 const callUnlocked=!!c&&Boolean(Number(c.call_unlocked||0));
 for(const id of ['voiceBtn','videoBtn']){
  const button=$(id);
  button.disabled=!c;
  button.classList.toggle('tc-call-locked',!!c&&!callUnlocked);
  button.title=!c?'Pilih teman terlebih dahulu':callUnlocked
    ?(id==='voiceBtn'?'Telepon suara':'Panggilan video')
    :'Saling bertukar pesan dahulu agar bisa menelepon';
  button.setAttribute('aria-label',button.title);
 }
}
function officialBadge(){
 const badge=element('span','tc-verified-badge');
 badge.title='Administrator resmi TemanChat';
 badge.setAttribute('aria-label','Administrator resmi TemanChat');
 const ns='http://www.w3.org/2000/svg';
 const svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
 const shape=document.createElementNS(ns,'path');
 // Distinct scalloped seal and contrasting tick; no external icon dependency.
 shape.setAttribute('d','M12 2 14.7 3.7 17.9 3.6 18.7 6.7 21.2 8.7 20.2 11.8 21.2 14.8 18.7 16.8 17.9 20 14.7 19.8 12 21.5 9.3 19.8 6.1 20 5.3 16.8 2.8 14.8 3.8 11.8 2.8 8.7 5.3 6.7 6.1 3.6 9.3 3.7Z');
 shape.setAttribute('fill','currentColor');
 const tick=document.createElementNS(ns,'path');
 tick.setAttribute('d','M8 11.8l2.7 2.7 5.6-5.8');
 tick.setAttribute('fill','none');tick.setAttribute('stroke','white');tick.setAttribute('stroke-width','2.2');tick.setAttribute('stroke-linecap','round');tick.setAttribute('stroke-linejoin','round');
 svg.append(shape,tick);badge.append(svg);return badge;
}
function syncVerifiedBadges(){
 document.querySelectorAll('.tc-self-verified').forEach(el=>el.remove());
 if(!me?.is_admin)return;
 const name=document.querySelector('.profile b');
 if(name){const badge=officialBadge();badge.classList.add('tc-self-verified');name.after(badge)}
}
function renderChats(){
 const box=$('contacts'),q=$('search').value.trim().toLowerCase();box.replaceChildren();
 const list=q.length>=2&&searchResults!==null
  ?searchResults.map(u=>({other_name:u.display_name,other_username:u.username,
    last_active_at:u.last_active_at,is_online:u.is_online,other_is_admin:u.is_admin,searchPerson:true}))
  :chats.filter(c=>!q||c.other_name.toLowerCase().includes(q)||c.other_username.includes(q));
 if(!list.length){box.append(element('p','tc-empty',q.length>=2?'Tidak ditemukan. Coba username lain.':'Belum ada percakapan. Cari username teman di atas.'));return}
 for(const c of list){
  const b=element('button','contact'+(!c.searchPerson&&c.id===active?.id?' active':''));b.type='button';
  const av=makeAvatar(c.other_name,c.other_username),body=element('div','contact-content'),top=element('div','contact-top');
  const isOnline=Number(c.is_online)===1;
  const presenceDot=element('span','tc-presence-dot'+(isOnline?' online':''));
  presenceDot.title=presenceLabel(c);presenceDot.setAttribute('aria-label',presenceDot.title);
  av.append(presenceDot);av.classList.add('tc-avatar-with-presence');
  const contactName=element('b','',c.other_name);
  const nameWrap=element('span','tc-name-with-badge');nameWrap.append(contactName);
  if(Number(c.other_is_admin)===1)nameWrap.append(officialBadge());
  top.append(nameWrap,element('small','',c.searchPerson?'Cari teman':smallTime(c.last_time)));
  const typing=(!c.searchPerson)&&((active?.id===c.id&&partnerTyping)||Number(c.is_typing)===1);
  const statusLine=element('div','tc-contact-status'+(typing?' tc-status-typing':isOnline?' tc-status-online':''),
    typing?'Sedang mengetik…':presenceCompact(c));
  statusLine.title=typing?'Sedang mengetik…':presenceLabel(c);
  body.append(top,statusLine,element('p','',c.searchPerson?'@'+c.other_username:(c.last_message||'@'+c.other_username)));
  const unread=Math.max(0,Number(c.unread_count||0));
  if(!c.searchPerson&&unread>0){
   const badge=element('span','tc-unread',unread>99?'99+':String(unread));
   badge.title=unread+' pesan belum dibaca';badge.setAttribute('aria-label',badge.title);
   b.classList.add('tc-has-unread');b.append(av,body,badge);
  }else b.append(av,body);
  b.addEventListener('click',async()=>{
   if(c.searchPerson){
    b.disabled=true;
    try{
     const d=await post('/api/chat/start',{username:c.other_username});
     $('search').value='';searchResults=null;await fetchChats();
     await selectChat(chats.find(x=>x.id===d.conversationId)||{id:d.conversationId,other_name:c.other_name,other_username:c.other_username,last_active_at:c.last_active_at,is_online:c.is_online,other_is_admin:c.other_is_admin});
    }catch(e){toast(e.message)}finally{b.disabled=false}
   }else await selectChat(c);
  });box.append(b);
 }
}
async function fetchChats(){
 if(busyChats||!me)return;busyChats=true;
 try{
  const d=await api('/api/chat/conversations');chats=d.conversations||[];
  // Hitung pesan yang belum dibaca dari server, bukan hanya ID pesan terakhir.
  let totalUnread=0;
  const activeVisible=!!visibleChatId()&&
    (innerWidth>740||!$('conversation').classList.contains('mobile-hidden'));
  for(const c of chats){
   const count=Math.max(0,Number(c.unread_count||0));
   totalUnread+=count;
   const previous=previousUnread.get(c.id);
   const isCurrentVisible=activeVisible&&active?.id===c.id;
   if(notificationBaselineReady&&notificationsEnabled()&&!serverPushEnabled&&count>(previous??0)&&!isCurrentVisible){
    const increase=count-(previous??0);
    // Notifikasi lokal hanya saat JavaScript masih aktif; halaman tertutup perlu Web Push.
    void notifyLocal('Pesan dari '+(c.other_name||'teman'),
      increase===1?String(c.last_message||'Pesan baru').slice(0,120):increase+' pesan baru',
      'chat-msg-'+c.id+'-'+String(c.last_message_id||count));
    if(!document.hidden)toast(increase+' pesan baru dari '+(c.other_name||'teman'));
   }
   previousUnread.set(c.id,count);
  }
  for(const id of [...previousUnread.keys()])if(!chats.some(c=>c.id===id))previousUnread.delete(id);
  document.title=totalUnread>0?'('+totalUnread+') '+BASE_TITLE:BASE_TITLE;
  void syncAppBadge(totalUnread);
  notificationBaselineReady=true;

  if(active){const now=chats.find(c=>c.id===active.id);if(now){active=now;updateHeader(active);}}
  if(!$('search').value.trim()||searchResults===null)renderChats();
 }catch(e){toast(e.message)}finally{busyChats=false}
}
function shortReply(m){return String(m?.body||'Pesan').slice(0,100)}
function clearReply(){replyTarget=null;$('replyPreview').hidden=true;$('replyPreviewText').textContent='';}
function beginReply(m){if(!active||!m)return;replyTarget={id:Number(m.id),body:shortReply(m)};
 $('replyPreviewText').textContent=replyTarget.body;$('replyPreview').hidden=false;
 try{$('messageInput').focus({preventScroll:true})}catch{$('messageInput').focus()}
}
$('replyCancel').onclick=clearReply;
async function updateMediaPrefs(values){const p=await post('/api/media/preferences',values);mediaPrefs={mode:p.mode,noticeSeen:p.noticeSeen};TCS.setPref(p.mode);return p;}
async function maybePhotoNotice(messages){
 if(!me||mediaPrefs.noticeSeen||noticeShowing||!Array.isArray(messages))return;
 const photo=messages.some(m=>m.sender_id!==me.id&&typeof m.mime_type==='string'&&m.mime_type.startsWith('image/'));
 if(!photo||document.querySelector('dialog[open]'))return;
 noticeShowing=true;
 if(!$('mediaNoticeDialog').open)$('mediaNoticeDialog').showModal();
}
async function closePhotoNotice(openSettings=false){
 try{await updateMediaPrefs({ackNotice:true})}catch(e){toast('Belum bisa menyimpan pilihan: '+e.message);return}
 $('mediaNoticeDialog').close();noticeShowing=false;
 if(openSettings)$('settingsBtn').click();
}
$('mediaNoticeUnderstand').onclick=()=>void closePhotoNotice(false);
$('mediaNoticeSettings').onclick=()=>void closePhotoNotice(true);
$('mediaNoticeDialog').addEventListener('cancel',event=>{event.preventDefault();});
async function uploadMediaFile(file,id,replyId){
 if(!mediaEnabled)throw Error('Penyimpanan R2 belum aktif.');
 const mime=(file.type||'').split(';')[0];
 const cap=mime.startsWith('audio/')?25:20;
 if(file.size>cap*1024*1024)throw Error('Ukuran file melebihi '+cap+' MB.');
 const init=await post('/api/media/init',{conversationId:id,name:file.name,type:mime,size:file.size});
 const r=await fetch('/api/media/upload?id='+encodeURIComponent(init.mediaId),{
  method:'PUT',credentials:'same-origin',headers:{'Content-Type':mime},body:file});
 const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'Upload gagal');
 return post('/api/media/send',{conversationId:id,mediaId:init.mediaId,replyToId:replyId});
}
async function openMedia(messageId,m,area){
 if(!me)return;
 try{
  let local=await TCS.get(me.id,messageId).catch(()=>null),blob=local?.blob;
  if(!blob){
   const r=await fetch('/api/media/file?messageId='+encodeURIComponent(messageId),{credentials:'same-origin',cache:'no-store'});
   if(r.ok){blob=await r.blob();await TCS.put(me.id,messageId,blob,false).catch(()=>{});}
   else throw Error('Media sudah tidak tersedia di server. Gunakan salinan yang sebelumnya kamu simpan.');
  }
  if(!blob)return;
  const uri=URL.createObjectURL(blob);
  const mime=m.mime_type||blob.type;
  const isAudio=mime.startsWith('audio/'),isVideo=mime.startsWith('video/');
  const preview=blob.type.startsWith('image/')?element('img'):
   isVideo?element('video'):isAudio?element('audio'):element('div','tc-hint','Dokumen siap disimpan');
  if(['IMG','VIDEO','AUDIO'].includes(preview.tagName)){
   preview.src=uri;
   if(preview.tagName==='IMG')preview.alt='Foto dalam percakapan';
   else{preview.controls=true;preview.preload='metadata';}
   if(preview.tagName==='VIDEO')preview.playsInline=true;
  }
  const box=area.querySelector('.tc-preview');
  const old=box.querySelector('img,video,audio');if(old?.src?.startsWith('blob:'))URL.revokeObjectURL(old.src);
  if(isAudio){
   const audioShell=element('div','tc-audio-shell');
   const title=element('div','tc-audio-title');
   const icon=element('span','tc-audio-icon','♫');
   title.append(icon,element('span','','Pesan suara'));
   const controls=element('div','tc-audio-controls');
   const speed=element('button','tc-audio-speed','1×');speed.type='button';speed.title='Ubah kecepatan putar';
   speed.setAttribute('aria-label','Kecepatan pemutaran suara 1 kali');
   speed.onclick=()=>{const rates=[1,1.5,2];const next=rates[(rates.indexOf(preview.playbackRate)+1)%rates.length];
    preview.playbackRate=next;speed.textContent=next+'×';speed.setAttribute('aria-label','Kecepatan pemutaran suara '+next+' kali')};
   controls.append(preview,speed);audioShell.append(title,controls);
   box.replaceChildren(audioShell);
   const openButton=area.querySelector('.tc-media-action');if(openButton)openButton.hidden=true;
  }else box.replaceChildren(preview);
  const actions=area.querySelector('.tc-actions');actions.replaceChildren();actions.hidden=true;
  const fileName=isAudio?'TemanChat-suara-'+messageId+'.'+(mime==='audio/mp4'?'m4a':'webm'):
   isVideo?'TemanChat-video-'+messageId+'.mp4':mime.startsWith('image/')?'TemanChat-foto-'+messageId+'.jpg':'TemanChat-file-'+messageId;
  const save=element('button','tc-media-action','Simpan ke perangkat');
  save.onclick=async()=>{
   try{await TCS.saveManual(blob,fileName);await TCS.put(me.id,messageId,blob,true).catch(()=>{});
    toast('Proses penyimpanan dimulai. Periksa dialog atau folder perangkat.');}
   catch(e){if(e.name!=='AbortError')toast(e.message)}
  };actions.append(save);
  const permanent=element('button','tc-media-action','Simpan di aplikasi (offline)');
  permanent.onclick=async()=>{try{await TCS.put(me.id,messageId,blob,true);toast('Salinan disimpan di penyimpanan aplikasi. Tidak otomatis masuk galeri.')}catch(e){toast(e.message)}};
  actions.append(permanent);
  if(TCS.getClientId()){
   const drive=element('button','tc-media-action','Simpan ke Google Drive');
   drive.onclick=async()=>{
    drive.disabled=true;
    try{const b=await TCS.uploadDrive(blob,fileName);
      // Backup Drive milik penerima tidak menghapus R2 secara prematur.
      if(m.sender_id!==me.id){await post('/api/media/confirm',{messageId,storageType:'google_drive',driveFileId:b.fileId});}
      await TCS.verified(me.id,messageId);toast('Salinan Google Drive terverifikasi.');
    }catch(e){toast(e.message)}finally{drive.disabled=false}
   };actions.append(drive);
  }
  if(TCS.pref()==='local'){
   try{await TCS.put(me.id,messageId,blob,true);
    if(TCS.supportsFolder())await TCS.autoSaveFolder(blob,fileName);
   }catch(e){console.warn('Penyimpanan otomatis lokal:',e.message)}
  }
  if(TCS.pref()==='google_drive'&&TCS.wifi()&&m.sender_id!==me.id){
   try{
    const status=await TCS.driveStatus();
    if(status.connected){
      const oldBackup=await api('/api/media/backup?messageId='+encodeURIComponent(messageId));
      if(!oldBackup?.backup){
        const saved=await TCS.uploadDrive(blob,fileName);
        await post('/api/media/confirm',{messageId,storageType:'google_drive',driveFileId:saved.fileId});
        await TCS.verified(me.id,messageId);
        toast('Media berhasil dicadangkan ke Google Drive pribadi.');
      }
    }
   }catch(e){console.warn('Backup Google Drive belum selesai:',e.message);toast('Backup Drive belum berhasil: '+e.message)}
  }
 }catch(e){toast(e.message)}
}
// Mode lokal: saat media baru diunduh oleh aplikasi aktif, simpan salinan permanen di
// IndexedDB. Folder khusus hanya ditulis jika izin akses telah diberikan sebelumnya.
// Tidak bisa menulis diam-diam ke galeri iPhone/Android ketika PWA tertutup.
const autoStored=new Set();
async function tryAutoLocal(m){
 if(mediaPrefs.mode!=='local'||!me||m.sender_id===me.id||!m.media_id||autoStored.has(m.id))return;
 autoStored.add(m.id);
 try{
  const existing=await TCS.get(me.id,m.id).catch(()=>null);
  if(existing?.permanent)return;
  const r=await fetch('/api/media/file?messageId='+encodeURIComponent(m.id),{credentials:'same-origin',cache:'no-store'});
  if(!r.ok)throw Error('Media tidak tersedia');
  const blob=await r.blob();await TCS.put(me.id,m.id,blob,true);
  if(TCS.supportsFolder()){
   const name='TemanChat-'+m.id+(m.mime_type?.startsWith('image/')?'.jpg':m.mime_type?.startsWith('audio/')?'.m4a':'.bin');
   try{await TCS.autoSaveFolder(blob,name)}catch(e){console.info('Penyimpanan folder belum diizinkan:',e.message)}
  }
 }catch(e){autoStored.delete(m.id);console.warn('Penyimpanan lokal otomatis:',e.message)}
}
function setReceiptLabel(node,kind){
 const read=kind==='read',received=kind==='delivered';
 node.textContent=read||received?'✓✓':'✓';
 node.classList.toggle('tc-receipt-read',read);
 node.title=read?'Dibaca':received?'Diterima perangkat':'Terkirim ke server';
 node.setAttribute('aria-label',node.title);
}
function updateAllReceipts(deliveredId,readId){
 document.querySelectorAll('#messages [data-receipt-for]').forEach(n=>{
  const id=Number(n.dataset.receiptFor);
  setReceiptLabel(n,id<=readId?'read':id<=deliveredId?'delivered':'sent');
 });
}
async function markVisibleRead(chatId,lastSeen){
 if(document.hidden||document.visibilityState!=='visible'||!active||active.id!==chatId||!lastSeen)return;
 const already=readAcknowledged.get(chatId)||0;
 if(lastSeen<=already)return;
 // Hanya tandai dibaca setelah pesan dirender dan chat terbuka.
 try{const d=await post('/api/chat/read',{conversationId:chatId,lastMessageId:lastSeen});
  readAcknowledged.set(chatId,Math.max(already,Number(d.readId||0)));
  // Segera segarkan badge agar angka hilang setelah percakapan dibaca.
  if(!busyChats)void fetchChats();
 }catch(e){console.warn('Read acknowledgement:',e.message)}
}
function addMessage(m){
 if($('messages').querySelector(`[data-message-id="${Number(m.id)}"]`))return;
 const b=element('div','bubble '+(m.sender_id===me.id?'me':'them'));b.dataset.messageId=String(m.id);
 if(m.reply_to_id){
  const q=element('div','tc-reply-quote');q.append(element('small','',m.reply_sender_id===me.id?'Membalas kamu':'Membalas teman'),element('span','',String(m.reply_body||'Pesan sebelumnya').slice(0,140)));
  q.onclick=()=>{const target=$('messages').querySelector(`[data-message-id="${Number(m.reply_to_id)}"]`);if(target){target.scrollIntoView({behavior:'smooth',block:'center'});target.classList.add('tc-flash');setTimeout(()=>target.classList.remove('tc-flash'),900)}};
  b.append(q);
 }
 b.append(element('span','tc-message-text',m.body));
 const menuWrap=element('div','tc-message-menu');
 const menuButton=element('button','tc-message-more','⋯');menuButton.type='button';menuButton.title='Tindakan pesan';menuButton.setAttribute('aria-label','Tindakan pesan');
 const menu=element('div','tc-message-menu-items');menu.hidden=true;
 const reply=element('button','','↩ Balas pesan');reply.type='button';reply.onclick=()=>{beginReply(m);menu.hidden=true};
 menu.append(reply);menuButton.onclick=e=>{e.stopPropagation();menu.hidden=!menu.hidden};
 menuWrap.append(menuButton,menu);b.append(menuWrap);
 // Touch-only swipe. Vertikal tetap scroll; arah horizontal menampilkan indikator Balas.
 const swipe={active:false,x:0,y:0,lastX:0,lastY:0,axis:null};
 const resetSwipe=()=>{
  b.style.setProperty('--tc-swipe-x','0px');b.classList.remove('tc-swiping','tc-reply-ready');
  swipe.active=false;swipe.axis=null;
 };
 const swipeIcon=element('span','tc-swipe-reply-icon','↩');swipeIcon.setAttribute('aria-hidden','true');b.append(swipeIcon);
 b.addEventListener('touchstart',e=>{
  if(e.touches.length!==1||e.target.closest('button,a,audio,video,input,.tc-reply-quote'))return;
  const t=e.touches[0];swipe.active=true;swipe.axis=null;
  swipe.x=swipe.lastX=t.clientX;swipe.y=swipe.lastY=t.clientY;
 },{passive:true});
 b.addEventListener('touchmove',e=>{
  if(!swipe.active||e.touches.length!==1)return;
  const t=e.touches[0],dx=t.clientX-swipe.x,dy=t.clientY-swipe.y;
  swipe.lastX=t.clientX;swipe.lastY=t.clientY;
  if(!swipe.axis&&Math.max(Math.abs(dx),Math.abs(dy))>8)swipe.axis=Math.abs(dx)>Math.abs(dy)*1.25?'horizontal':'vertical';
  if(swipe.axis!=='horizontal')return;
  if(e.cancelable)e.preventDefault();
  const distance=Math.max(0,Math.min(85,dx));
  b.classList.add('tc-swiping');b.style.setProperty('--tc-swipe-x',distance+'px');
  b.classList.toggle('tc-reply-ready',distance>=62);
 },{passive:false});
 b.addEventListener('touchend',e=>{
  if(!swipe.active)return;
  const t=e.changedTouches[0];
  const dx=(t?.clientX??swipe.lastX)-swipe.x,dy=(t?.clientY??swipe.lastY)-swipe.y;
  const shouldReply=swipe.axis==='horizontal'&&dx>=62&&Math.abs(dy)<Math.abs(dx)*.8;
  resetSwipe();if(shouldReply){beginReply(m);if(navigator.vibrate)navigator.vibrate(8)}
 },{passive:true});
 b.addEventListener('touchcancel',resetSwipe,{passive:true});
 if(m.media_id){
  const area=element('div','tc-bubble-media');
  const view=element('button','tc-media-action',m.mime_type?.startsWith('audio/')?'▶ Putar pesan suara':'Buka media');view.onclick=()=>openMedia(m.id,m,area);
  const preview=element('div','tc-preview'),actions=element('div','tc-actions');
  const mediaDots=element('button','tc-media-dots','⋯');mediaDots.type='button';mediaDots.title='Pilihan penyimpanan';
  mediaDots.onclick=()=>{actions.hidden=!actions.hidden;if(!actions.hidden&&!actions.children.length)void openMedia(m.id,m,area)};
  actions.hidden=true;area.append(view,preview,mediaDots,actions);b.append(area);
 }
 const foot=element('div','tc-bubble-foot');
 foot.append(element('time','',smallTime(m.created_at)));
 if(m.sender_id===me.id){
  const status=element('span','tc-receipt','✓');status.dataset.receiptFor=String(m.id);
  status.setAttribute('aria-label','Pesan terkirim');
  setReceiptLabel(status,m.delivery_status||'sent');
  foot.append(status);
 }
 b.append(foot);
 const scroll=$('messages'),nearBottom=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<130;
 scroll.append(b);lastId=Math.max(lastId,Number(m.id)||0);if(nearBottom)scroll.scrollTop=scroll.scrollHeight;
}
async function fetchMessages(reset=false){
 if(!active||busyMessages)return;busyMessages=true;const id=active.id;
 try{
  const d=await api('/api/chat/messages?conversationId='+encodeURIComponent(id)+'&after='+(reset?0:lastId));
  if(!active||active.id!==id)return;
  if(reset){$('messages').replaceChildren();lastId=0;if(!d.messages.length)placeholder('Belum ada pesan. Mulai percakapan!')}
  if(d.messages.length&&$('messages').querySelector('.day'))$('messages').replaceChildren();
  for(const m of d.messages){addMessage(m);if(mediaPrefs.mode==='local'&&m.media_id)void tryAutoLocal(m)}
  void maybePhotoNotice(d.messages);
  updateAllReceipts(Number(d.partnerReceipt?.deliveredId||0),Number(d.partnerReceipt?.readId||0));
  // Jangan tandai pesan sendiri sebagai dibaca; server mengabaikan pesan sendiri.
  const received=d.messages.filter(m=>m.sender_id!==me.id);
  if(received.length)await markVisibleRead(id,Math.max(...received.map(m=>Number(m.id))));
  // Pada polling incremental, status centang pesan lama ikut diperbarui.
 }catch(e){toast(e.message)}finally{busyMessages=false}
}
async function selectChat(c){
 if(active?.id!==c.id&&(voiceRecorder||voicePendingStart))void voiceFinish(false);
 if(active?.id!==c.id){stopTyping();partnerTyping=false;}
 clearReply();active=c;lastId=0;updateHeader(c);drawPartnerTyping();renderChats();
 placeholder('Memuat pesan…');showChat();updateNotificationFocus(true);
 void refreshPartnerTyping();
 await fetchMessages(true);
}
$('search').addEventListener('input',async()=>{
 const q=$('search').value.trim().toLowerCase(),seq=++searchSeq;searchResults=null;
 if(q.length<2){renderChats();return}
 try{const d=await api('/api/chat/people?q='+encodeURIComponent(q));if(seq===searchSeq){searchResults=d.people;renderChats()}}
 catch(e){if(seq===searchSeq)toast(e.message)}
});
$('messageInput').addEventListener('input',handleTypingInput);
$('messageInput').addEventListener('blur',stopTyping);
$('messageForm').addEventListener('submit',async e=>{
 e.preventDefault();const input=$('messageInput'),msg=input.value.trim(),id=active?.id;
 if(!id||!msg||msg.length>1000)return;const sendBtn=document.querySelector('.send');sendBtn.disabled=true;
 try{const d=await post('/api/chat/send',{conversationId:id,body:msg,replyToId:replyTarget?.id||null});input.value='';clearReply();stopTyping();if(active?.id===id){if($('messages').querySelector('.day'))$('messages').replaceChildren();addMessage({...d.message,delivery_status:'sent'})}await fetchChats();}
 catch(e){toast(e.message)}finally{sendBtn.disabled=!active;if(active?.id===id&&!document.hidden){try{input.focus({preventScroll:true})}catch{input.focus()}}}
});
// V7.6: semua foto dapat diperiksa sebelum dikirim. Normal adalah bawaan;
// mode Cermin hanya dilakukan jika pengguna menekannya (kamera iPhone tidak
// memberikan informasi tepercaya apakah foto depan sudah dicerminkan).
async function previewPhotoBeforeSend(file){
 if(!file.type.startsWith('image/')||file.type==='image/gif')return file;
 const dialog=$('photoPreviewDialog'),img=$('photoPreviewImage');
 const flip=$('photoMirrorToggle'),confirm=$('photoPreviewSend'),cancel=$('photoPreviewCancel');
 if(!dialog||!img||typeof dialog.showModal!=='function')return file;
 const url=URL.createObjectURL(file);let mirrored=false;
 img.src=url;img.style.transform='none';flip.setAttribute('aria-pressed','false');
 flip.textContent='Mode Cermin: Mati';
 return new Promise(resolve=>{
  let settled=false;
  function finish(value){
   if(settled)return;settled=true;
   flip.removeEventListener('click',toggle);confirm.removeEventListener('click',send);
   cancel.removeEventListener('click',abort);dialog.removeEventListener('cancel',onCancel);
   if(dialog.open)dialog.close();img.removeAttribute('src');URL.revokeObjectURL(url);
   resolve(value);
  }
  function toggle(){mirrored=!mirrored;img.style.transform=mirrored?'scaleX(-1)':'none';
   flip.setAttribute('aria-pressed',String(mirrored));
   flip.textContent=mirrored?'Mode Cermin: Aktif':'Mode Cermin: Mati';}
  async function send(){
   if(!mirrored)return finish(file);
   confirm.disabled=true;
   try{
    if(!img.complete)await img.decode();
    const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('Perangkat tidak mendukung pengolahan foto');
    ctx.translate(canvas.width,0);ctx.scale(-1,1);ctx.drawImage(img,0,0);
    const outputType=file.type==='image/png'?'image/png':'image/jpeg';
    const blob=await new Promise(r=>canvas.toBlob(r,outputType,.93));
    canvas.width=canvas.height=0;
    if(!blob)throw Error('Tidak dapat memproses mode cermin');
    const ext=outputType==='image/png'?'png':'jpg';
    const base=(file.name||'TemanChat-foto').replace(/\.[^.]+$/,'');
    finish(new File([blob],base+'-cermin.'+ext,{type:outputType,lastModified:Date.now()}));
   }catch(err){toast(err.message||'Mode cermin gagal');confirm.disabled=false;}
  }
  function abort(){finish(null)}
  function onCancel(e){e.preventDefault();abort()}
  flip.addEventListener('click',toggle);confirm.addEventListener('click',send);
  cancel.addEventListener('click',abort);dialog.addEventListener('cancel',onCancel);
  confirm.disabled=false;dialog.showModal();
 });
}
$('attachmentInput').addEventListener('change',async()=>{
 const original=$('attachmentInput').files[0],id=active?.id;
 $('attachmentInput').value='';if(!original||!id)return;
 try{
  const file=await previewPhotoBeforeSend(original);
  if(!file)return; // Batal tidak pernah mengunggah ke R2.
  if(active?.id!==id){toast('Percakapan sudah berubah. Coba pilih file lagi.');return;}
  toast('Mengunggah media…');
  const result=await uploadMediaFile(file,id,replyTarget?.id||null);
  if(active?.id===id){clearReply();if($('messages').querySelector('.day'))$('messages').replaceChildren();addMessage(result.message)}
  toast('Media terkirim. Foto asli perangkat tidak diubah.');await fetchChats();
 }catch(e){toast(e.message)}
});
// V7.4 pesan suara: tahan > geser atas untuk kunci; lepaskan untuk kirim;
// geser kiri untuk batal. Desktop: klik sekali mulai, klik lagi mengirim.
let voiceChatId=null,voiceUploadOnStop=false,voiceStartRequest=0;
function voiceClock(ms){const secs=Math.floor(Math.max(0,ms)/1000);return String(Math.floor(secs/60)).padStart(2,'0')+':'+String(secs%60).padStart(2,'0')}
function voiceRefreshUI(){
 $('voicePanel').hidden=!voicePendingStart&&!voiceRecorder;
 const elapsed=voiceElapsed+(voiceRecorder?.state==='recording'?Date.now()-voiceStart:0);
 $('voiceTime').textContent=voiceClock(elapsed);
 $('voiceStatus').textContent=voicePendingStart?'Meminta izin mikrofon…':voiceLocked?'Rekaman terkunci':'Merekam suara…';
 $('voicePanel').classList.toggle('tc-voice-paused',voiceRecorder?.state==='paused');
 $('voicePanel').classList.toggle('tc-voice-locked',!!voiceLocked);
 $('voiceHint').hidden=voiceLocked;
 $('voicePause').hidden=!voiceLocked;
 $('voiceSend').hidden=!voiceLocked;
 $('voicePause').textContent=voiceRecorder?.state==='paused'?'▶ Lanjut':'⏸ Jeda';
}
function voiceStopTracks(){clearInterval(voiceTimer);voiceTimer=null;voiceStream?.getTracks().forEach(t=>t.stop());voiceStream=null;}
async function beginVoiceRecording(){
 if(voicePendingStart||voiceRecorder)return;
 if(!active||!mediaEnabled)return toast('Pilih percakapan dan aktifkan R2 dahulu.');
 if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')return toast('Browser ini tidak mendukung rekaman pesan suara.');
 voicePendingStart=true;voiceCancelRequested=false;voiceLocked=false;voiceChunks=[];voiceElapsed=0;voiceChatId=active.id;
 const request=++voiceStartRequest;
 voiceRefreshUI();
 try{
  // getUserMedia dipanggil langsung dari interaksi agar izin iPhone dapat muncul.
  const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
  if(voiceCancelRequested||request!==voiceStartRequest){stream.getTracks().forEach(t=>t.stop());return;}
  voiceStream=stream;
  const format=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
  const rec=new MediaRecorder(stream,format?{mimeType:format}:undefined);
  voiceRecorder=rec;
  rec.ondataavailable=e=>{if(e.data?.size)voiceChunks.push(e.data)};
  rec.onerror=()=>{toast('Perekaman mikrofon gagal.');void voiceFinish(false)};
  rec.onstop=async()=>{
   const send=voiceUploadOnStop&&!voiceCancelRequested;
   const recorded=new Blob(voiceChunks,{type:rec.mimeType||format||'audio/webm'});
   const chatId=voiceChatId,replyId=replyTarget?.id||null;
   voiceStopTracks();voiceRecorder=null;voiceChunks=[];voicePendingStart=false;voiceLocked=false;voiceUploadOnStop=false;
   voiceRefreshUI();
   if(!send)return;
   if(recorded.size<150)return toast('Rekaman terlalu singkat.');
   const type=(recorded.type||'audio/webm').split(';')[0];
   const ext=type==='audio/mp4'?'m4a':type==='audio/ogg'?'ogg':type==='audio/wav'?'wav':'webm';
   const file=new File([recorded],'TemanChat-suara-'+Date.now()+'.'+ext,{type});
   try{
    toast('Mengirim pesan suara…');const result=await uploadMediaFile(file,chatId,replyId);
    if(active?.id===chatId){clearReply();if($('messages').querySelector('.day'))$('messages').replaceChildren();addMessage(result.message)}
    await fetchChats();toast('Pesan suara terkirim.');
   }catch(e){toast('Gagal mengirim pesan suara: '+e.message)}
  };
  voicePendingStart=false;rec.start(300);voiceStart=Date.now();voiceElapsed=0;
  voiceTimer=setInterval(()=>{
   voiceRefreshUI();
   const total=voiceElapsed+(rec.state==='recording'?Date.now()-voiceStart:0);
   if(total>=MAX_VOICE_MS)void voiceFinish(true);
  },250);
  voiceRefreshUI();
  if(!voicePressing&&!voiceLocked){setTimeout(()=>{if(voiceRecorder===rec&&!voicePressing&&!voiceLocked)void voiceFinish(true)},500)}
 }catch(e){voiceStopTracks();voicePendingStart=false;voiceRecorder=null;voiceRefreshUI();toast('Mikrofon tidak dapat digunakan: '+e.message)}
}
async function voiceFinish(send){
 if(voicePendingStart&&!voiceRecorder){voiceCancelRequested=!send;voicePendingStart=false;voiceRefreshUI();return}
 if(!voiceRecorder||voiceRecorder.state==='inactive')return;
 voiceUploadOnStop=!!send;voiceCancelRequested=!send;
 try{
  if(voiceRecorder.state==='paused')voiceRecorder.resume();
  voiceRecorder.requestData();voiceRecorder.stop();
 }catch(e){voiceStopTracks();voiceRecorder=null;voiceRefreshUI();toast('Perekaman berhenti: '+e.message)}
}
function voiceLock(){if(!voiceRecorder&&!voicePendingStart)return;voiceLocked=true;voiceRefreshUI();}
$('voiceCancel').onclick=()=>void voiceFinish(false);
$('voiceSend').onclick=()=>void voiceFinish(true);
$('voicePause').onclick=()=>{
 const r=voiceRecorder;if(!r)return;
 try{if(r.state==='recording'){voiceElapsed+=Date.now()-voiceStart;r.pause()}else if(r.state==='paused'){voiceStart=Date.now();r.resume()}}
 catch(e){toast(e.message)}
 voiceRefreshUI();
};
const mic=$('voiceMessageBtn');
mic.addEventListener('pointerdown',e=>{
 if(e.pointerType==='mouse')return;
 e.preventDefault();voicePressing=true;voicePressY=e.clientY;voicePressX=e.clientX;
 mic.setPointerCapture?.(e.pointerId);void beginVoiceRecording();
});
mic.addEventListener('pointermove',e=>{
 if(!voicePressing||e.pointerType==='mouse')return;
 if(e.clientX-voicePressX < -80){voicePressing=false;void voiceFinish(false);return}
 if(voicePressY-e.clientY>65){voicePressing=false;voiceLock()}
});
mic.addEventListener('pointerup',e=>{if(e.pointerType==='mouse')return;
 e.preventDefault();if(voicePressing){voicePressing=false;if(!voiceLocked)void voiceFinish(true)}
});
mic.addEventListener('pointercancel',()=>{if(voicePressing&&!voiceLocked){voicePressing=false;void voiceFinish(false)}});
mic.onclick=e=>{if(e.detail===0||e.pointerType==='mouse'){
 if(voiceRecorder||voicePendingStart)void voiceFinish(true);else{voicePressing=false;void beginVoiceRecording().then(()=>{if(voiceRecorder){voiceLocked=true;voiceRefreshUI()}});}
}};
$('attachBtn').onclick=()=>{if(!mediaEnabled)toast('Untuk mengirim foto, hubungkan Cloudflare R2 lebih dahulu.');else $('attachmentInput').click()};
function modal(title,text,buttons=[]){$('modalTitle').textContent=title;$('modalDesc').textContent=text;const c=$('modalContent');c.replaceChildren();for(const b of buttons){const btn=element('button','primary',b.label);btn.onclick=b.action;c.append(btn)}$('modal').showModal();}
$('closeModal').onclick=()=>$('modal').close();
$('moreBtn').onclick=()=>modal('Percakapan',active?`Percakapan pribadi dengan @${active.other_username}. Pesan teks belum menggunakan enkripsi ujung-ke-ujung.`:'Silakan pilih teman.');
// Riwayat tersimpan di D1, bukan hanya saat browser terbuka.
async function showCallHistory(){
  modal('Riwayat panggilan','Panggilan masuk, keluar, dan tidak terjawab dari akun ini.');
  const box=$('modalContent');box.replaceChildren(element('p','tc-hint','Memuat riwayat…'));
  try{
    const data=await api('/api/calls/history');box.replaceChildren();
    if(!data.calls.length){box.append(element('p','tc-hint','Belum ada riwayat panggilan.'));return}
    const list=element('div','tc-call-history');
    for(const c of data.calls){
      const item=element('div','tc-call-history-item');
      const symbol=c.direction==='outgoing'?'↗':'↙';
      const missed=c.status==='missed'||c.status==='declined';
      const status=c.status==='ringing'?'Sedang memanggil':c.status==='missed'?'Tak terjawab':c.status==='declined'?'Ditolak':c.status==='answered'?'Terjawab':'Selesai';
      const heading=element('div','tc-call-history-person',(missed?'☎ ':'')+symbol+' '+(c.other_name||'Teman'));
      if(missed)heading.classList.add('tc-call-missed');
      const details=element('small','',`${c.kind==='video'?'Video':'Suara'} · ${status} · ${smallTime(c.created_at)}`);
      const date=element('small','',String(c.created_at||'').slice(0,10));
      item.append(heading,details,date);list.append(item);
    }
    box.append(list);
  }catch(e){box.replaceChildren(element('p','tc-hint','Riwayat belum bisa dimuat: '+e.message))}
}
$('callHistoryBtn').onclick=showCallHistory;
// V9.0 Panel Admin terpisah: daftar dan pencarian izin langsung berbasis server.
const adminEntry=$('adminPanelBtn');
async function openAdminPanel(){
 if(!me?.is_admin){toast('Hanya administrator yang dapat membuka panel ini.');return}
 modal('Panel Admin TemanChat','@'+me.username+' · Admin Utama · Akses jarak jauh aktif tanpa batas');
 const root=$('modalContent');
 const wrap=element('div','tc-admin-panel');
 const info=element('div','tc-admin-summary','Akun admin memiliki izin panggilan jarak jauh permanen. Izin pengguna lain dapat disetujui langsung tanpa pengajuan.');
 const search=element('input');search.type='search';search.placeholder='Cari nama atau @username (min. 2 huruf)';search.autocomplete='off';search.setAttribute('aria-label','Cari pengguna untuk izin panggilan');
 const status=element('select');status.setAttribute('aria-label','Filter status izin');
 for(const [key,label] of [['all','Semua pengguna'],['pending','Menunggu'],['approved','Diizinkan'],['rejected','Ditolak / dicabut'],['expired','Kedaluwarsa'],['none','Belum pernah mengajukan']]){
  const o=element('option','',label);o.value=key;status.append(o)
 }
 const list=element('div','tc-admin-users');
 const controls=element('div','tc-admin-search');controls.append(search,status);
 const reload=element('button','tc-admin-refresh','↻ Perbarui daftar');reload.type='button';
 wrap.append(info,controls,reload,list);root.append(wrap);
 let last=0,delay;
 const states={pending:'Menunggu',approved:'Diizinkan',rejected:'Ditolak / dicabut',expired:'Kedaluwarsa',none:'Belum ada izin'};
 async function refresh(){
  const seq=++last;
  list.replaceChildren(element('small','','Memuat data pengguna…'));
  reload.disabled=true;
  try{
   const q=search.value.trim();
   if(q.length===1){list.replaceChildren(element('small','','Ketik minimal 2 huruf, atau kosongkan pencarian untuk daftar semua pengguna.'));return}
   const d=await api('/api/calls/access/users?q='+encodeURIComponent(q)+'&status='+encodeURIComponent(status.value));
   if(seq!==last)return;
   list.replaceChildren();
   if(!d.users.length){list.append(element('small','','Tidak ada pengguna yang cocok.'));return}
   for(const person of d.users){
    const item=element('section','tc-admin-user');
    const title=element('div','tc-admin-user-title');
    title.append(element('b','',person.display_name||person.username),element('small','','@'+person.username));
    const state=element('small','tc-admin-status',states[person.state]||person.state);
    if(person.state==='approved'&&person.expires_at){
     const date=new Date(person.expires_at.replace(' ','T')+'Z');
     const duration=Math.max(0,date.getTime()-Date.now());
     state.textContent+=' · Sisa '+(duration>=86400000?Math.ceil(duration/86400000)+' hari':Math.ceil(duration/3600000)+' jam');
    }
    const duration=element('select');duration.setAttribute('aria-label','Masa berlaku izin '+person.username);
    for(const [v,label] of [['1d','1 hari'],['7d','7 hari'],['30d','30 hari'],['forever','Tanpa batas waktu']]){
     const opt=element('option','',label);opt.value=v;duration.append(opt);
    }duration.value='7d';
    const actions=element('div','tc-admin-actions');
    const approve=element('button','tc-admin-approve',person.state==='approved'?'Perpanjang izin':'Beri izin');
    const revoke=element('button','tc-admin-revoke','Cabut / Tolak');
    approve.type=revoke.type='button';
    approve.onclick=()=>update('approved');revoke.onclick=()=>update('rejected');
    async function update(value){
     const act=value==='approved'?'memberikan izin':'mencabut/menolak izin';
     if(!confirm(`Yakin ${act} panggilan jarak jauh untuk @${person.username}?`))return;
     approve.disabled=revoke.disabled=true;
     try{await post('/api/calls/access/review',{userId:person.user_id,state:value,duration:duration.value});toast('Izin @'+person.username+' berhasil diperbarui.');await refresh()}
     catch(error){toast(error.message);approve.disabled=revoke.disabled=false}
    }
    actions.append(duration,approve,revoke);item.append(title,state,actions);list.append(item);
   }
  }catch(error){if(seq===last)list.replaceChildren(element('small','','Gagal mengambil daftar: '+error.message))}
  finally{reload.disabled=false}
 }
 search.addEventListener('input',()=>{clearTimeout(delay);delay=setTimeout(refresh,350)});
 status.onchange=refresh;reload.onclick=refresh;
 await refresh();
}
if(adminEntry)adminEntry.onclick=()=>void openAdminPanel();

$('settingsBtn').onclick=()=>{
 modal('Pengaturan TemanChat',me?`${me.display_name} (@${me.username})`:'');
 if(me?.is_admin)$('modalDesc').append(' ',officialBadge());
 const root=$('modalContent'),wrap=element('div','tc-settings'),label=element('label','','Penyimpanan media penerima');
 const shareSettings=element('button','primary','↗ Bagikan TemanChat');shareSettings.type='button';shareSettings.onclick=()=>{ $('modal').close(); window.TCShare?.open(); };wrap.append(shareSettings);
 // Nama tampilan dapat diganti, username login tidak berubah.
 const profileTitle=element('label','','Nama panggilan saya');
 const profileInput=element('input');profileInput.type='text';profileInput.maxLength=60;profileInput.minLength=2;
 profileInput.placeholder='Nama yang terlihat oleh teman';profileInput.value=me?.display_name||'';
 profileInput.autocomplete='nickname';profileInput.setAttribute('aria-label','Ubah nama panggilan');
 const saveName=element('button','primary','Simpan nama panggilan');
 saveName.onclick=async()=>{
   const name=profileInput.value.trim();if(name.length<2||name.length>60){toast('Nama harus 2–60 karakter.');return}
   saveName.disabled=true;
   try{const d=await post('/api/auth/profile',{displayName:name});me=d.user;
     document.querySelector('.profile b').textContent=me.display_name;
     if(adminEntry)adminEntry.hidden=!me.is_admin;
  syncVerifiedBadges();
     paintAvatar(document.querySelector('.profile .avatar'),me.display_name,me.username);
     $('modalDesc').textContent=`${me.display_name} (@${me.username})`;
     if(me.is_admin)$('modalDesc').append(' ',officialBadge());
     toast('Nama panggilan berhasil diperbarui.');
   }catch(e){toast(e.message)}finally{saveName.disabled=false}
 };
 wrap.append(profileTitle,profileInput,saveName,element('small','','Nama panggilan terlihat oleh teman. @username dan email login tidak berubah.'));
 // Foto avatar terpisah dari media chat: bisa digunakan walaupun R2 belum aktif.
 const photoTitle=element('label','','Foto profil saya');
 const photoRow=element('div','tc-avatar-settings');
 const photoPreview=makeAvatar(me?.display_name,me?.username,'avatar tc-avatar-settings-preview');
 const photoButtons=element('div','tc-avatar-settings-buttons');
 const filePicker=element('input');filePicker.type='file';filePicker.accept='image/jpeg,image/png,image/webp,image/gif';
 filePicker.setAttribute('aria-label','Pilih foto profil');filePicker.style.display='none';
 let pendingPhoto=null;
 const choosePhoto=element('button','primary','Pilih foto');choosePhoto.type='button';choosePhoto.onclick=()=>filePicker.click();
 const savePhoto=element('button','primary','Simpan foto profil');savePhoto.type='button';savePhoto.disabled=true;
 filePicker.onchange=async()=>{
  const file=filePicker.files?.[0];filePicker.value='';if(!file)return;
  try{pendingPhoto=await prepareAvatarPhoto(file);
   photoPreview.replaceChildren(document.createTextNode(avatar(me?.display_name)));
   const img=document.createElement('img');img.src=pendingPhoto;img.alt='Foto terpilih';img.className='tc-avatar-photo';photoPreview.append(img);
   savePhoto.disabled=false;
  }catch(e){toast(e.message)}
 };
 savePhoto.onclick=async()=>{
  if(!pendingPhoto)return;savePhoto.disabled=true;
  try{await post('/api/auth/avatar',{dataUrl:pendingPhoto});pendingPhoto=null;ownAvatarVersion=Date.now();
    paintAvatar(document.querySelector('.profile .avatar'),me.display_name,me.username);
    paintAvatar(photoPreview,me.display_name,me.username);
    toast('Foto profil tersimpan dan dapat dilihat teman.');
  }catch(e){toast(e.message);savePhoto.disabled=false;}
 };
 const removePhoto=element('button','tc-avatar-remove','Hapus foto');removePhoto.type='button';
 removePhoto.onclick=async()=>{
  removePhoto.disabled=true;
  try{await post('/api/auth/avatar',{dataUrl:null});pendingPhoto=null;savePhoto.disabled=true;
    ownAvatarVersion=Date.now();paintAvatar(photoPreview,me.display_name,me.username);
    paintAvatar(document.querySelector('.profile .avatar'),me.display_name,me.username);
    toast('Foto profil dihapus.');
  }catch(e){toast(e.message)}finally{removePhoto.disabled=false}
 };
 photoButtons.append(choosePhoto,savePhoto,removePhoto,filePicker);photoRow.append(photoPreview,photoButtons);
 wrap.append(photoTitle,photoRow,element('small','','Foto dipotong persegi dan diperkecil otomatis, maksimum 60 KB. Tersimpan di D1 tanpa perlu R2.'));

 // Akun & keamanan: email hanya tampil untuk pemilik akun, bukan pada profil publik.
 const sectionTitle=element('label','','Akun & keamanan');sectionTitle.classList.add('tc-security-heading');
 const currentEmail=element('div','tc-email-display');
 currentEmail.append(element('small','','Email login yang terdaftar'),element('strong','',me?.email||'Tidak tersedia'));
 const changeEmailToggle=element('button','tc-email-change-toggle','Ganti alamat email');changeEmailToggle.type='button';
 const changeBox=element('div','tc-email-change-box');changeBox.hidden=true;
 const newEmail=element('input');newEmail.type='email';newEmail.maxLength=254;
 newEmail.autocomplete='email';newEmail.placeholder='Alamat email baru';newEmail.setAttribute('aria-label','Email baru');
 const emailPass=element('input');emailPass.type='password';emailPass.maxLength=128;
 emailPass.autocomplete='current-password';emailPass.placeholder='Password akun saat ini';emailPass.setAttribute('aria-label','Konfirmasi password akun');
 const confirmEmailRequest=element('button','primary','Kirim tautan verifikasi email');confirmEmailRequest.type='button';
 const emailStatus=element('small','tc-email-status','');
 changeEmailToggle.onclick=()=>{changeBox.hidden=!changeBox.hidden;changeEmailToggle.setAttribute('aria-expanded',String(!changeBox.hidden));};
 changeEmailToggle.setAttribute('aria-expanded','false');
 confirmEmailRequest.onclick=async()=>{
  const email=newEmail.value.trim(),password=emailPass.value;
  if(!email||!newEmail.checkValidity()){toast('Periksa alamat email baru.');return}
  if(!password){toast('Masukkan password akun terlebih dahulu.');return}
  confirmEmailRequest.disabled=true;emailStatus.textContent='Mengirim tautan verifikasi…';
  try{
   const result=await post('/api/auth/email-change/request',{newEmail:email,password});
   emailPass.value='';emailStatus.textContent=result.message||'Periksa kotak masuk email baru.';toast('Periksa email baru untuk menyelesaikan perubahan.');
  }catch(e){emailStatus.textContent=e.message;toast(e.message)}
  finally{emailPass.value='';confirmEmailRequest.disabled=false}
 };
 changeBox.append(newEmail,emailPass,confirmEmailRequest,emailStatus,
  element('small','','Email lama tetap berlaku hingga tautan dikonfirmasi. Setelah berhasil, login ulang diperlukan dan notifikasi push perlu diaktifkan kembali.'));
 wrap.append(sectionTitle,currentEmail,changeEmailToggle,changeBox);


 const themeTitle=element('label','','Tampilan TemanChat');
 const themeSelect=element('select');
 for(const [value,text] of [['system','Ikuti sistem'],['light','Terang · Glass'],['dark','Gelap · Glass']]){
  const opt=element('option','',text);opt.value=value;themeSelect.append(opt);
 }
 themeSelect.value=localStorage.getItem(THEME_KEY)||'system';themeSelect.onchange=()=>applyTheme(themeSelect.value);
 wrap.append(themeTitle,themeSelect,element('small','','Efek kaca disesuaikan dengan tema, kontras, dan pengaturan aksesibilitas perangkat.'));

 const section=element('details','tc-storage-guide');section.open=false;
 const guideTitle=element('summary','','Panduan Penyimpanan & Media');
 section.append(guideTitle,element('p','','Bawaan: tidak simpan otomatis. Foto/video sementara dapat kedaluwarsa setelah sekitar 3 hari. Pilih menu ⋯ pada media untuk menyimpan file tertentu. Cache sementara bukan galeri perangkat; file asli di galeri tidak dihapus.'));
 wrap.append(section);
 const select=element('select');
 for(const [v,t] of [['none','Tidak simpan otomatis (bawaan)'],['local','Simpan ke perangkat / folder pilihan'],['google_drive','Google Drive pribadi (akun terhubung)'],['nextcloud','Nextcloud / CasaOS (belum aktif)']]){
  const option=element('option','',t);option.value=v;select.append(option);
 }
 select.value=mediaPrefs.mode;
 select.onchange=async()=>{
  const mode=select.value;
  if(mode==='nextcloud'){select.value=mediaPrefs.mode;toast('Integrasi Nextcloud belum diaktifkan, pengaturan tidak diubah.');return;}
  if(mode==='google_drive'){try{const d=await TCS.driveStatus();if(!d.connected){select.value=mediaPrefs.mode;toast('Hubungkan Google Drive dahulu.');return;}}catch(e){select.value=mediaPrefs.mode;toast(e.message);return;}}
  select.disabled=true;
  try{await updateMediaPrefs({mode});toast('Pilihan penyimpanan disimpan di akun.');}
  catch(e){select.value=mediaPrefs.mode;toast(e.message)}finally{select.disabled=false}
 };
 wrap.append(label,select,element('small','','Pilihan berlaku untuk akun. Pada iPhone, browser dapat meminta konfirmasi penyimpanan. File di browser bisa hilang jika data situs dihapus.'));
 if(TCS.supportsFolder()){
  const choose=element('button','primary','Pilih folder penyimpanan perangkat');
  choose.onclick=async()=>{try{const name=await TCS.chooseFolder();toast('Folder '+name+' dipilih. Izin dapat perlu diperbarui.')}catch(e){if(e.name!=='AbortError')toast(e.message)}};
  wrap.append(choose);
 }else wrap.append(element('small','','Perangkat ini tidak mendukung penyimpanan otomatis ke folder tertentu. Simpan file manual melalui menu ⋯ pada media.'));
 const driveGroup=element('div','tc-drive-connect');
 driveGroup.append(element('b','','Google Drive pribadi'),element('small','','Akses drive.file: hanya file yang dibuat/dipilih melalui TemanChat. Token disimpan terenkripsi di server; tidak dibagikan ke teman.'));
 const driveState=element('small','','Memeriksa koneksi Drive…');
 const connect=element('button','primary','Hubungkan Google Drive');
 const disconnect=element('button','tc-media-action','Putuskan Google Drive');
 const refreshDrive=async()=>{
  try{const d=await TCS.driveStatus();driveState.textContent=d.connected?(d.accountEmail?'✓ Terhubung: '+d.accountEmail:(d.accountWarning?'✓ Drive terhubung — '+d.accountWarning:'✓ Drive terhubung (email tidak tersedia)')):'Google Drive belum terhubung';connect.hidden=!!d.connected;disconnect.hidden=!d.connected;}
  catch(e){driveState.textContent='Tidak dapat memeriksa koneksi: '+e.message;disconnect.hidden=true;}
 };
 connect.onclick=()=>TCS.connectGoogle();
 disconnect.onclick=async()=>{if(!confirm('Putuskan Google Drive dari TemanChat? File yang sudah ada di Drive tidak dihapus.'))return;disconnect.disabled=true;try{await TCS.disconnectGoogle();await refreshDrive();toast('Koneksi Google Drive diputus.');}catch(e){toast(e.message)}finally{disconnect.disabled=false}};
 driveGroup.append(driveState,connect,disconnect);
 wrap.append(driveGroup);void refreshDrive();
 wrap.append(element('small','','Simpan permanen ke Nextcloud memerlukan konektor server tambahan. Tidak dianggap sudah tersimpan sebelum konektor benar-benar tersedia.'));
 // Mode lokal per perangkat, dikirim ke Service Worker agar push ketika aplikasi tertutup
 // tetap menghormati pilihan bila browser mendukung properti silent/vibrate.
 const modeTitle=element('label','','Mode notifikasi pesan dan panggilan');
 const modeSelect=element('select','tc-notify-mode');
 for(const [value,label] of [['both','🔔 Suara + Getar'],['sound','🔊 Suara saja'],['vibrate','📳 Getar saja'],['silent','🔕 Senyap (visual saja)']]){
  const option=element('option','',label);option.value=value;modeSelect.append(option);
 }
 modeSelect.value=notificationMode();modeSelect.setAttribute('aria-label','Mode suara dan getar notifikasi');
 const modeHelp=element('small','','Android/Chrome menentukan suara dan getar push melalui kanal notifikasi sistem. Mode Getar saja meminta pola getar, tetapi tidak bisa memaksa HP senyap. Periksa Pengaturan Android → Aplikasi → TemanChat/Chrome → Notifikasi → Getar.');
 modeSelect.onchange=()=>{localStorage.setItem(NOTIFY_MODE_KEY,modeSelect.value);syncNotificationModeWorker();
   if(!audioPreference())stopCallTone();toast('Mode notifikasi disimpan di perangkat ini.');
   toneButton.textContent=audioPreference()?'Suara panggilan: Aktif':'Suara panggilan: Nonaktif';
 };
 wrap.append(modeTitle,modeSelect,modeHelp);
 const notifyButton=element('button','primary','Memeriksa notifikasi…');
 const showPushState=async()=>{
   // Perhatikan pengaturan pengguna, bukan hanya apakah Web Push tersedia.
   // Bahkan jika browser tidak mendukung push, OFF wajib mematikan bunyi lokal.
   const enabled=notificationsEnabled();
   notifyButton.textContent=enabled?'Matikan semua notifikasi':'Aktifkan semua notifikasi';
   notifyButton.setAttribute('aria-pressed',String(enabled));
   notifyButton.dataset.enabled=enabled?'true':'false';
 };
 notifyButton.onclick=async()=>{
  notifyButton.disabled=true;
  try{
    if(notifyButton.dataset.enabled==='true'){
      const reg=await navigator.serviceWorker?.getRegistration('/');const sub=await reg?.pushManager?.getSubscription();
      if(sub){await post('/api/push/unsubscribe',{endpoint:sub.endpoint});await sub.unsubscribe();}
      try{const shown=await reg?.getNotifications?.();shown?.forEach(n=>n.close())}catch{}
      serverPushEnabled=false;serverPushEndpoint='';focusChatReported=null;
      localStorage.setItem(NOTIFY_PREF,'off');stopCallTone();
      if(navigator.clearAppBadge)void navigator.clearAppBadge().catch(()=>{});
      toast('Semua notifikasi dan bunyi panggilan TemanChat dimatikan pada perangkat ini.');
    }else{
      await registerPush();localStorage.setItem(NOTIFY_PREF,'on');syncNotificationModeWorker();updateNotificationFocus(true);
      toast('Notifikasi TemanChat diaktifkan pada perangkat ini.');
    }
  }catch(e){toast('Pengaturan notifikasi gagal: '+e.message)}
  finally{notifyButton.disabled=false;await showPushState();toneButton.textContent=audioPreference()?'Suara panggilan: Aktif':'Suara panggilan: Nonaktif'}
 };
 wrap.append(notifyButton,element('small','','OFF mematikan pesan, panggilan dan bunyi pada perangkat ini. Angka pesan belum dibaca di dalam chat tetap terlihat. ON mengaktifkan kembali Web Push.'));
 void (async()=>{await checkPush();await showPushState()})();
 const toneButton=element('button','primary',audioPreference()?'Suara panggilan: Aktif':'Suara panggilan: Nonaktif');
 toneButton.onclick=()=>{if(!notificationsEnabled())return toast('Notifikasi OFF. Aktifkan terlebih dahulu agar suara panggilan bisa dipakai.');const enabled=!audioPreference();localStorage.setItem('tc_call_sounds',enabled?'on':'off');toneButton.textContent='Suara panggilan: '+(enabled?'Aktif':'Nonaktif');if(!enabled)stopCallTone();};
 wrap.append(toneButton);
 const pushTest=element('button','primary','Kirim notifikasi uji');
 pushTest.onclick=async()=>{if(!notificationsEnabled())return toast('Aktifkan notifikasi dahulu.');try{const d=await post('/api/push/test',{});toast(d.sent?'Tes terkirim. Cek notifikasi perangkat.':'Push ditolak penyedia. Periksa Log Cloudflare.')}catch(e){toast(e.message)}};
 wrap.append(pushTest);
 const vibrateTest=element('button','tc-media-action','Tes getar perangkat');
 vibrateTest.onclick=()=>{
  if(!notificationsEnabled())return toast('Notifikasi sedang OFF.');
  if(!vibrationAllowed())return toast('Pilih Suara + Getar atau Getar saja terlebih dahulu.');
  if(typeof navigator.vibrate!=='function')return toast('Browser/perangkat ini tidak mendukung getaran dari website.');
  const ok=navigator.vibrate([180,120,270,120,180]);toast(ok?'Perintah getar diterima browser (belum menjamin motor HP bergetar). Cek pengaturan getar Android.':'Perangkat/browser menolak perintah getar.');
 };
 wrap.append(vibrateTest);
 const androidInfo=element('small','','Status aplikasi: '+(runningAsApp()?'PWA terpasang / standalone':'Dibuka di tab browser')+'. Tombol Back sistem Android mengikuti riwayat halaman dan kebijakan Android/Chrome; website tidak dapat memaksa langsung ke Home HP. Tombol kembali TemanChat tetap menuju daftar chat.');
 wrap.append(androidInfo);
 if(!runningAsApp()){const install=element('button','primary','Instal TemanChat');install.onclick=()=>{$('modal').close();void triggerTemanChatInstall()};wrap.append(install);}
 // V8.1: daftar sesi login pada semua perangkat, bukan izin mengakses perangkat fisik.
 const deviceTitle=element('label','','Perangkat yang login');
 const deviceHint=element('small','','Lihat tempat akun masuk, terakhir aktif, dan keluarkan perangkat lain dengan sandi. Nama perangkat diperkirakan dari browser.');
 const deviceList=element('div','tc-device-list');
 const refreshDevices=element('button','primary','Perbarui daftar perangkat');
 const fmtDeviceTime=raw=>{
   if(!raw)return 'Belum tercatat';
   const iso=String(raw).replace(' ','T')+(String(raw).includes('Z')||/[+-]\d\d:\d\d$/.test(String(raw))?'':'Z');
   const t=new Date(iso);return isNaN(t.getTime())?'Belum tercatat':t.toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'});
 };
 async function loadDeviceSessions(){
   refreshDevices.disabled=true;deviceList.replaceChildren(element('small','','Memuat perangkat…'));
   try{
     const d=await api('/api/auth/devices');deviceList.replaceChildren();
     if(!d.devices?.length){deviceList.append(element('small','','Tidak ada perangkat aktif.'));return}
     for(const session of d.devices){
       const item=element('div','tc-device-item');
       const head=element('div','tc-device-heading');
       head.append(element('strong','',session.label||'Perangkat lain'));
       if(session.current)head.append(element('span','tc-device-current','Perangkat ini'));
       item.append(head,element('small','',`Terakhir aktif: ${fmtDeviceTime(session.lastActiveAt)}`));
       if(session.createdAt)item.append(element('small','',`Login tercatat: ${fmtDeviceTime(session.createdAt)}`));
       item.append(element('small','',`Batas sesi: ${fmtDeviceTime(session.expiresAt)}`));
       if(!session.current){
         const kick=element('button','tc-media-action','Keluarkan perangkat ini');
         const authBox=element('div','tc-device-confirm');authBox.hidden=true;
         const pass=element('input');pass.type='password';pass.autocomplete='current-password';pass.placeholder='Masukkan sandi TemanChat';pass.maxLength=128;
         pass.setAttribute('aria-label','Sandi untuk mengeluarkan perangkat');
         const confirm=element('button','primary','Konfirmasi keluarkan');
         const cancel=element('button','tc-media-action','Batal');
         const controls=element('div','tc-device-actions');controls.append(confirm,cancel);
         // Pesan kesalahan harus terlihat DI DALAM dialog, bukan toast di belakang modal.
         const passError=element('small','tc-device-error','');
         passError.hidden=true;passError.setAttribute('role','alert');passError.setAttribute('aria-live','polite');
         const showPassError=message=>{passError.textContent=message;passError.hidden=!message;pass.setAttribute('aria-invalid',String(!!message));};
         pass.addEventListener('input',()=>showPassError(''));
         authBox.append(element('small','','Perangkat ini akan keluar dan harus login ulang.'),pass,passError,controls);
         kick.onclick=()=>{showPassError('');authBox.hidden=false;kick.hidden=true;pass.focus()};
         cancel.onclick=()=>{pass.value='';showPassError('');authBox.hidden=true;kick.hidden=false};
         confirm.onclick=async()=>{
           if(pass.value.length<8){showPassError('Masukkan sandi akun TemanChat (minimal 8 karakter).');pass.focus();return;}
           showPassError('');confirm.disabled=true;
           try{
             const result=await post('/api/auth/devices/revoke',{sessionId:session.id,password:pass.value});
             pass.value='';toast(result.message||'Perangkat berhasil dikeluarkan.');await loadDeviceSessions();
           }catch(e){
             // Sandi salah tidak boleh menutup dialog ataupun mencabut sesi.
             showPassError(e.message||'Gagal memverifikasi sandi.');pass.select();
           }finally{confirm.disabled=false}
         };
         item.append(kick,authBox);
       }
       deviceList.append(item);
     }
   }catch(e){deviceList.replaceChildren(element('small','','Daftar perangkat gagal dimuat: '+e.message))}
   finally{refreshDevices.disabled=false}
 }
 refreshDevices.onclick=loadDeviceSessions;
 wrap.append(deviceTitle,deviceHint,refreshDevices,deviceList);
 void loadDeviceSessions();
 // Pengajuan mode jarak jauh diproses server. Pilihan bawaan selalu lokal.
 const callTitle=element('label','','Mode panggilan');
 const callMode=element('select');
 for(const [v,text] of [['local','Lokal — Wi-Fi / jaringan lokal yang sama'],['remote','Jarak jauh — khusus akun disetujui admin']]){
   const opt=element('option','',text);opt.value=v;callMode.append(opt);
 }
 callMode.value=localStorage.getItem(CALL_MODE_KEY)==='remote'?'remote':'local';
 const accessText=element('small','','Memeriksa akses jarak jauh…');
 const requestAccess=element('button','primary','Ajukan akses panggilan jarak jauh');
 const adminRequests=element('div','tc-call-admin-requests');
 const refreshCallAccess=async()=>{
   try{
     const d=await api('/api/calls/access');remoteCallGranted=!!d.approved;
     if(!remoteCallGranted){callMode.value='local';localStorage.setItem(CALL_MODE_KEY,'local');}
     callMode.querySelector('option[value="remote"]').disabled=!d.approved;
     accessText.textContent=d.admin?'Anda adalah admin panggilan.':d.approved?('Panggilan jarak jauh disetujui'+(d.expiresAt?' hingga '+d.expiresAt+' UTC':' tanpa batas waktu')+'.'):d.state==='pending'?'Pengajuan menunggu persetujuan admin.':d.state==='rejected'?'Izin ditolak atau dicabut.':d.state==='expired'?'Izin sudah kedaluwarsa. Ajukan kembali.':'Mode jarak jauh belum diaktifkan.';
     requestAccess.hidden=!!d.approved||d.state==='pending'||!d.adminConfigured;
     if(!d.adminConfigured)accessText.textContent='Admin panggilan belum dikonfigurasi.';
     if(d.admin)await loadCallRequests();
   }catch(e){remoteCallGranted=false;callMode.value='local';callMode.querySelector('option[value="remote"]').disabled=true;accessText.textContent='Status akses tidak tersedia: '+e.message;}
 };
 callMode.onchange=()=>{if(callMode.value==='remote'&&!remoteCallGranted){callMode.value='local';return toast('Ajukan dan tunggu persetujuan admin.');}localStorage.setItem(CALL_MODE_KEY,callMode.value);toast('Mode panggilan disimpan pada perangkat ini.');};
 requestAccess.onclick=async()=>{requestAccess.disabled=true;try{await post('/api/calls/access/request',{});await refreshCallAccess();toast('Pengajuan dikirim kepada admin panggilan.')}catch(e){toast(e.message)}finally{requestAccess.disabled=false}};
 async function loadCallRequests(){
   const d=await api('/api/calls/access/requests');adminRequests.replaceChildren(element('b','','Pengajuan panggilan jarak jauh'));
   if(!d.requests.length){adminRequests.append(element('small','','Belum ada pengajuan.'));return;}
   for(const r of d.requests){
     const item=element('div','tc-call-access-item');
     const labelState={pending:'Menunggu persetujuan',approved:'Diizinkan',rejected:'Ditolak / Dicabut',expired:'Kedaluwarsa'}[r.state]||r.state;
     item.append(element('small','',`${r.display_name} (@${r.username}) — ${labelState}${r.state==='approved'&&r.expires_at?' sampai '+r.expires_at+' UTC':''}`));
     const durationSelect=element('select');
     for(const [value,label] of [['1d','1 hari'],['7d','7 hari'],['30d','30 hari'],['forever','Tanpa batas waktu']]){
       const opt=element('option','',label);opt.value=value;durationSelect.append(opt);
     }
     durationSelect.value='7d';
     durationSelect.setAttribute('aria-label','Masa berlaku izin');
     item.append(durationSelect);
     for(const [state,label] of [['approved','Setujui / Perpanjang'],['rejected',r.state==='approved'?'Cabut Akses':'Tolak / Cabut']]){
       const btn=element('button','tc-media-action',label);btn.type='button';
       btn.onclick=async()=>{
         const duration=state==='approved'?durationSelect.value:'forever';
         const durLabel=durationSelect.options[durationSelect.selectedIndex]?.textContent||'';
         if(!confirm(`${label} akses jarak jauh untuk @${r.username}${state==='approved'?' selama '+durLabel:''}?`))return;
         btn.disabled=true;
         try{await post('/api/calls/access/review',{userId:r.user_id,state,duration});await loadCallRequests();toast('Akses diperbarui.')}catch(e){toast(e.message)}finally{btn.disabled=false}
       };
       item.append(btn);
     }
     adminRequests.append(item);
   }
 }
 wrap.append(callTitle,callMode,accessText,requestAccess,element('small','','Mode lokal tidak menggunakan TURN; panggilan perlu jaringan lokal yang saling terhubung. Mode jarak jauh memerlukan koneksi langsung WebRTC atau relay TURN bila jaringan memblokir koneksi.'),adminRequests);
 void refreshCallAccess();
 const logout=element('button','primary','Keluar dari akun');logout.onclick=async()=>{
   try{
    // Jangan biarkan perangkat yang logout menerima push akun sebelumnya.
    try{
      const reg=await navigator.serviceWorker?.getRegistration('/');
      const sub=await reg?.pushManager?.getSubscription();
      if(sub){await post('/api/push/unsubscribe',{endpoint:sub.endpoint});await sub.unsubscribe();}
    }catch(e){console.warn('Push logout cleanup',e.message)}
    await post('/api/auth/logout',{});location.replace('/auth.html')
   }catch(e){toast(e.message)}
 };wrap.append(logout);root.append(wrap);
};
$('backBtn').onclick=showList;
window.addEventListener('resize',()=>{if(innerWidth>740){$('sidebar').classList.remove('mobile-visible');$('conversation').classList.remove('mobile-hidden')}else if(active)showChat();else showList()});
// Pengingat instal PWA: hanya pada TAB browser (bukan saat berjalan sebagai aplikasi).
// Browser tidak bisa mengetahui secara pasti apakah PWA terpasang di perangkat lain.
const INSTALL_SNOOZE_KEY='tc_install_remind_after_v73';
function runningAsApp(){
 return window.matchMedia?.('(display-mode: standalone)').matches ||
        window.matchMedia?.('(display-mode: fullscreen)').matches ||
        navigator.standalone===true;
}
function hideInstallBanner(){
 const banner=$('installBanner');if(banner)banner.hidden=true;
}
function refreshInstallOffer(){
 const installed=runningAsApp();
 $('installBtn').hidden=installed;
 if(installed){hideInstallBanner();return}
 const snoozeUntil=Number(localStorage.getItem(INSTALL_SNOOZE_KEY)||0);
 const banner=$('installBanner');
 if(banner)banner.hidden=!(me&&Date.now()>snoozeUntil&&!document.hidden);
}
window.addEventListener('beforeinstallprompt',e=>{
 e.preventDefault();installPrompt=e;
 refreshInstallOffer();
});
window.addEventListener('appinstalled',()=>{
 installPrompt=null;hideInstallBanner();$('installBtn').hidden=true;
 // Sembunyikan pengingat dalam tab browser ini setelah instalasi sukses.
 localStorage.setItem(INSTALL_SNOOZE_KEY,String(Date.now()+365*24*60*60*1000));
 toast('TemanChat berhasil dipasang. Buka melalui ikon aplikasinya.');
});
async function triggerTemanChatInstall(){
 if(runningAsApp()){hideInstallBanner();return toast('TemanChat sudah berjalan sebagai aplikasi.');}
 if(installPrompt){
  const prompt=installPrompt;installPrompt=null;
  hideInstallBanner();
  try{
   await prompt.prompt();
   const choice=await prompt.userChoice;
   if(choice?.outcome==='accepted'){
    localStorage.setItem(INSTALL_SNOOZE_KEY,String(Date.now()+365*24*60*60*1000));
   }else{
    localStorage.setItem(INSTALL_SNOOZE_KEY,String(Date.now()+24*60*60*1000));
   }
  }catch(e){toast('Tidak dapat menampilkan pemasangan: '+e.message)}
  return;
 }
 const ios=/iPhone|iPad|iPod/.test(navigator.userAgent);
 modal('Pasang TemanChat',ios
  ? 'Buka di Safari, ketuk Bagikan, kemudian Tambahkan ke Layar Utama. Setelah terpasang, buka TemanChat lewat ikonnya.'
  : 'Di browser, buka menu ⋮ lalu pilih Instal aplikasi atau Tambahkan ke layar utama. Jika menu tidak ada, browser mungkin belum mendukung instalasi.');
}
$('installBtn').onclick=triggerTemanChatInstall;
$('installBannerAction').onclick=triggerTemanChatInstall;
$('installBannerDismiss').onclick=()=>{
 localStorage.setItem(INSTALL_SNOOZE_KEY,String(Date.now()+7*24*60*60*1000));
 hideInstallBanner();
};
window.addEventListener('pageshow',refreshInstallOffer);
document.addEventListener('visibilitychange',()=>{if(document.hidden)hideInstallBanner();else refreshInstallOffer()});
// Nada panggilan original, hanya selama laman PWA aktif dan browser mengizinkan audio.
let tcAudioContext=null,tcToneLoop=null;
function stopCallTone(){if(tcToneLoop){clearInterval(tcToneLoop);tcToneLoop=null}}
function toneBeep(freq=470,duration=.16,volume=.045){
 try{if(!audioPreference())return;
  tcAudioContext=tcAudioContext||new (window.AudioContext||window.webkitAudioContext)();
  if(tcAudioContext.state==='suspended')void tcAudioContext.resume();
  const o=tcAudioContext.createOscillator(),g=tcAudioContext.createGain(),t=tcAudioContext.currentTime;
  o.type='sine';o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(.001,t);g.gain.exponentialRampToValueAtTime(volume,t+.018);g.gain.exponentialRampToValueAtTime(.001,t+duration);
  o.connect(g);g.connect(tcAudioContext.destination);o.start(t);o.stop(t+duration+.03);
 }catch(e){console.warn('Audio panggilan',e.message)}
}
function startCallTone(kind){
 stopCallTone();if(!audioPreference())return;
 const play=()=>{if(kind==='incoming'){toneBeep(620,.25);setTimeout(()=>{if(currentCall&&!currentCall.isCaller)toneBeep(800,.28)},340)}
  else if(kind==='outgoing'){toneBeep(430,.22,.03)}else if(kind==='ringback'){toneBeep(460,.32,.035);setTimeout(()=>{if(currentCall?.isCaller&&currentCall.ringingConfirmed)toneBeep(460,.32,.035)},520)}};
 play();tcToneLoop=setInterval(play,kind==='incoming'?2600:kind==='ringback'?2700:1900);
}
// V8.3: pemantauan koneksi suara terpisah dari refresh chat; video tetap versi V8.2.
const VOICE_SIGNAL_INTERVAL_MS=2500;
const VOICE_DISCONNECT_GRACE_MS=12000;
let voiceSignalTimer=null;
function stopVoiceSignalTimer(){if(voiceSignalTimer){clearInterval(voiceSignalTimer);voiceSignalTimer=null}}
function startVoiceSignalTimer(c){
 stopVoiceSignalTimer();
 if(c?.kind!=='audio')return;
 voiceSignalTimer=setInterval(()=>{if(currentCall===c)void pollCall();else stopVoiceSignalTimer()},VOICE_SIGNAL_INTERVAL_MS);
}
function clearVoiceDisconnectTimer(c){if(c?.disconnectTimer){clearTimeout(c.disconnectTimer);c.disconnectTimer=null}}
function detachVoiceResume(c){
 if(c?.resumeAudio){document.removeEventListener('pointerdown',c.resumeAudio);c.resumeAudio=null}
}
// --------- Panggilan suara dan video (WebRTC / signaling D1) ---------
function durationText(ms){
 const s=Math.max(0,Math.floor(ms/1000));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),sec=s%60;
 return (h?String(h)+':':'')+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');
}
function updateCallDuration(c){
 if(!c||currentCall!==c||!c.connectedAt)return;
 const label='Terhubung · '+durationText(Date.now()-c.connectedAt);
 $('callState').textContent=label;
 $('callStatusPill').textContent=label;
}
function markCallConnected(c){
 if(!c||currentCall!==c)return;
 if(!c.connectedAt){
  c.connectedAt=Date.now();stopCallTone();
  void showCallPath(c);
  c.durationInterval=setInterval(()=>updateCallDuration(c),1000);
 }
 updateCallDuration(c);
}
function callLabel(text){
 if(currentCall?.connectedAt&&!text.startsWith('Terhubung'))return;
 $('callState').textContent=text;
 $('callStatusPill').textContent=text;
 if(/Terhubung|Menghubungkan/.test(text))stopCallTone();
}
function setCallModeDisplay(mode,detail){
 const badge=$('callModeBadge'),hint=$('callModeHint');
 if(!badge||!hint)return;
 badge.dataset.mode=mode==='remote'?'remote':mode==='local'?'local':'pending';
 badge.textContent=mode==='remote'?'Mode Jarak Jauh':mode==='local'?'Mode Lokal':'Memeriksa mode panggilan…';
 hint.textContent=detail||(mode==='remote'?'Mencoba koneksi internet antarperangkat':mode==='local'?'Hanya perangkat di LAN / Wi-Fi yang saling terhubung':'Mengambil konfigurasi dari server…');
}
async function showCallPath(c){
 if(currentCall!==c||!c.pc||!c.connectedAt)return;
 try{
  const stats=await c.pc.getStats();if(currentCall!==c)return;
  let pair=null;
  stats.forEach(s=>{if(s.type==='transport'&&s.selectedCandidatePairId)pair=stats.get(s.selectedCandidatePairId)});
  if(!pair)stats.forEach(s=>{if(s.type==='candidate-pair'&&s.nominated&&s.state==='succeeded')pair=s});
  const local=pair&&stats.get(pair.localCandidateId);
  const remote=pair&&stats.get(pair.remoteCandidateId);
  if(c.mode==='remote'){
   const relay=local?.candidateType==='relay'||remote?.candidateType==='relay';
   setCallModeDisplay('remote',relay?'Tersambung melalui relay TURN':'Tersambung langsung (tanpa relay TURN)');
  }else if(c.mode==='local')setCallModeDisplay('local','Tersambung melalui jaringan lokal');
 }catch{/* Diagnostik bukan syarat agar panggilan berfungsi. */}
}
function showCallUI(kind,name,incoming,username){
 const dlg=$('callDialog');$('callName').textContent=name||'TemanChat';paintAvatar($('callAvatar'),name,username);
 $('callRemote').style.display='flex';$('callAvatar').style.display='grid';$('remoteVideo').style.display='none';$('localVideo').style.display='none';
 setCallModeDisplay(incoming?'pending':(currentCall?.mode||'pending'));
 $('acceptCall').hidden=!incoming;$('cameraCall').hidden=kind!=='video';callLabel(incoming?'Panggilan masuk…':'Memanggil…');
 if(!dlg.open)dlg.showModal();
 if(!currentCall?.isCaller)vibrateForCall();
 startCallTone(incoming?'incoming':'outgoing');
}
function closeCallUI(){
 stopCallTone();
 const dlg=$('callDialog');if(dlg.open)dlg.close();$('localVideo').srcObject=null;$('remoteVideo').srcObject=null;$('remoteAudio').srcObject=null;
 $('localVideo').style.display='none';$('remoteVideo').style.display='none';
}
function closeCallPushLocally(id){
 if(!id)return;
 try{navigator.serviceWorker?.controller?.postMessage({type:'tc-call-close',callId:id});}catch{}
 void navigator.serviceWorker?.ready?.then(r=>r.active?.postMessage({type:'tc-call-close',callId:id})).catch(()=>{});
}
function stopCallLocally(){
 const c=currentCall;if(!c)return;
 closeCallPushLocally(c.id);
 if(c.timeoutTimer){clearTimeout(c.timeoutTimer);c.timeoutTimer=null;}
 if(c.durationInterval){clearInterval(c.durationInterval);c.durationInterval=null;}
 clearVoiceDisconnectTimer(c);
 detachVoiceResume(c);
 stopVoiceSignalTimer();
 currentCall=null;
 if(c.pc){c.pc.onicecandidate=null;c.pc.ontrack=null;c.pc.close()}
 c.stream?.getTracks().forEach(t=>t.stop());closeCallUI();
}
async function hangup(){
 const c=currentCall;stopCallLocally();if(c)await post('/api/calls/decision',{callId:c.id,action:'hangup'}).catch(()=>{});
}
$('hangupCall').onclick=hangup;
$('muteCall').onclick=()=>{const c=currentCall;if(!c?.stream)return;for(const track of c.stream.getAudioTracks())track.enabled=!track.enabled;$('muteCall').querySelector('span').textContent=c.stream.getAudioTracks()[0]?.enabled?'Mikrofon aktif':'Mikrofon mati';};
$('cameraCall').onclick=()=>{const c=currentCall;if(!c?.stream)return;for(const track of c.stream.getVideoTracks())track.enabled=!track.enabled;$('cameraCall').querySelector('span').textContent=c.stream.getVideoTracks()[0]?.enabled?'Kamera aktif':'Kamera mati';};
async function preparePeer(c){
 const opts=await api('/api/calls/config?callId='+encodeURIComponent(c.id));
 c.mode=opts.mode==='remote'?'remote':'local';
 if(currentCall===c)setCallModeDisplay(c.mode,c.mode==='remote'?(opts.turnConfigured?'TURN tersedia; memeriksa jalur koneksi…':'TURN belum tersedia; mencoba STUN langsung'):'Hanya LAN / Wi-Fi yang saling terhubung');
 if(opts.mode==='remote'&&!opts.turnConfigured&&currentCall===c)toast(opts.turnWarning||'Mode jarak jauh sedang mencoba STUN langsung. Jika gagal, perlu TURN.');
 const constraints=c.kind==='audio'
  ? {audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false}
  : {audio:true,video:true};
 const stream=await navigator.mediaDevices.getUserMedia(constraints);
 if(currentCall!==c){stream.getTracks().forEach(t=>t.stop());return}
 c.stream=stream;c.pc=new RTCPeerConnection({iceServers:opts.iceServers});
 for(const track of stream.getTracks())c.pc.addTrack(track,stream);
 c.pc.ontrack=e=>{
  // Pisahkan elemen audio dan video: pada iPhone suara jangan ikut terhenti saat video disembunyikan.
  const media=c.kind==='video'?$('remoteVideo'):$('remoteAudio');
  media.srcObject=e.streams?.[0]||new MediaStream([e.track]);
  if(c.kind==='audio'){
   // Beberapa browser menolak autoplay meski izin mikrofon sudah diberikan.
   // Coba kembali pada sentuhan pengguna, tanpa membuat listener permanen.
   media.muted=false;
   const resume=()=>{if(currentCall===c)void media.play().then(()=>detachVoiceResume(c)).catch(()=>{})};
   c.resumeAudio=resume;
   document.addEventListener('pointerdown',resume);
  }
  $('remoteVideo').style.display=c.kind==='video'?'block':'none';
  $('callRemote').style.display=c.kind==='video'?'none':'flex';
  media.play().then(()=>{if(c.kind==='audio')detachVoiceResume(c)}).catch(()=>{
   if(c.kind==='audio'&&currentCall===c)toast('Ketuk layar TemanChat untuk mengaktifkan suara panggilan.');
  });
 };
 c.pc.onicecandidate=e=>{if(!e.candidate||currentCall!==c)return;post('/api/calls/signal',{callId:c.id,kind:'candidate',payload:JSON.stringify(e.candidate.toJSON())}).catch(console.warn)};
 c.pc.onconnectionstatechange=()=>{
  if(currentCall!==c)return;const state=c.pc.connectionState;
  if(state==='connected'){
   clearVoiceDisconnectTimer(c);
   markCallConnected(c);
  }else if(state==='disconnected'&&c.kind==='audio'&&!c.disconnectTimer){
   // Pemutusan sesaat saat perpindahan Wi-Fi/data jangan langsung mematikan telepon.
   c.disconnectTimer=setTimeout(()=>{
    c.disconnectTimer=null;
    if(currentCall===c&&c.pc?.connectionState==='disconnected'){
     toast('Koneksi suara tidak pulih. Panggilan diakhiri.');void hangup();
    }
   },VOICE_DISCONNECT_GRACE_MS);
  }else if(['failed','closed'].includes(state)){
   clearVoiceDisconnectTimer(c);
   toast(opts.turnConfigured?'Koneksi panggilan gagal. Periksa jaringan kedua perangkat.':'Koneksi panggilan gagal. Aktifkan Cloudflare TURN untuk jaringan berbeda.');void hangup();
  }
 };
 if(c.kind==='video'){$('localVideo').srcObject=stream;$('localVideo').style.display='block';}
}
async function setRemote(c,description){
 if(!c.pc)return;
 await c.pc.setRemoteDescription(description);c.hasRemote=true;
 for(const ice of c.pending.splice(0)){try{await c.pc.addIceCandidate(ice)}catch{}}
}
async function pollCall(){
 const c=currentCall;
 if(!c||c.pollBusy)return;
 c.pollBusy=true;
 try{
  const state=await api('/api/calls/state?callId='+encodeURIComponent(c.id));
  if(currentCall!==c)return;
  if(['declined','ended','missed'].includes(state.call.status)){toast('Panggilan selesai.');stopCallLocally();return}
  if(c.isCaller&&state.call.status==='ringing'&&state.call.delivered&&!c.ringingConfirmed){c.ringingConfirmed=true;callLabel('Berdering…');stopCallTone();startCallTone('ringback');}
  const d=await api('/api/calls/signals?callId='+encodeURIComponent(c.id)+'&after='+c.lastSignal);
  if(currentCall!==c)return;
  for(const s of d.signals){
   c.lastSignal=Math.max(c.lastSignal,s.id);
   try{
    const val=JSON.parse(s.payload);
    if(s.kind==='offer'&&!c.isCaller&&c.pc&&!c.hasRemote){
     await setRemote(c,val);const answer=await c.pc.createAnswer();await c.pc.setLocalDescription(answer);
     await post('/api/calls/signal',{callId:c.id,kind:'answer',payload:JSON.stringify(c.pc.localDescription)});
     callLabel('Menghubungkan…');
    }else if(s.kind==='answer'&&c.isCaller&&c.pc&&!c.hasRemote){await setRemote(c,val);callLabel('Menghubungkan…')}
    else if(s.kind==='candidate'){if(c.pc?.remoteDescription)await c.pc.addIceCandidate(val);else c.pending.push(val)}
   }catch(err){console.warn('Call signal',err)}
  }
 }catch(e){console.warn('Call polling',e.message)}
 finally{c.pollBusy=false}
}
async function startCall(kind){
 try{if(tcAudioContext?.state==='suspended')await tcAudioContext.resume()}catch{}
 if(!active)return toast('Pilih teman terlebih dahulu.');
 if(currentCall)return toast('Masih ada panggilan aktif.');
 if(!Number(active.call_unlocked||0))return toast('Saling bertukar pesan terlebih dahulu untuk memulai panggilan suara atau video.');
 if(!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection)return toast('Browser ini belum mendukung WebRTC atau izin mikrofon/kamera.');
 try{
  const mode=remoteCallGranted&&localStorage.getItem(CALL_MODE_KEY)==='remote'?'remote':'local';
  const d=await post('/api/calls/start',{conversationId:active.id,kind,mode});
  const c={id:d.callId,kind,mode,isCaller:true,lastSignal:0,pending:[],hasRemote:false};currentCall=c;
  // Batasi panggilan tidak terjawab ~30 detik tanpa menunggu cron 1 menit.
  c.timeoutTimer=setTimeout(async()=>{
   if(currentCall!==c||c.connectedAt)return;
   try{const r=await post('/api/calls/decision',{callId:c.id,action:'timeout'});
    if(r.status==='missed'&&currentCall===c){toast('Panggilan tidak dijawab.');stopCallLocally();}
   }catch(e){console.warn('Batas waktu panggilan',e.message)}
  },32000);
  showCallUI(kind,active.other_name,false,active.other_username);
  startVoiceSignalTimer(c);
  await preparePeer(c);if(currentCall!==c)return;
  const offer=await c.pc.createOffer();await c.pc.setLocalDescription(offer);
  await post('/api/calls/signal',{callId:c.id,kind:'offer',payload:JSON.stringify(c.pc.localDescription)});
  toast('Panggilan dikirim. Penerima bisa menerima notifikasi push.');
 }catch(e){toast('Panggilan gagal: '+e.message);await hangup()}
}
$('voiceBtn').onclick=()=>startCall('audio');$('videoBtn').onclick=()=>startCall('video');
$('acceptCall').onclick=async()=>{
 const c=currentCall;if(!c||c.isCaller||callBusy)return;callBusy=true;
 $('acceptCall').hidden=true;callLabel('Menyiapkan kamera/mikrofon…');
 try{await preparePeer(c);if(currentCall!==c)return;await post('/api/calls/decision',{callId:c.id,action:'answer'});callLabel('Menghubungkan…');await pollCall();}
 catch(e){toast('Tidak dapat menerima panggilan: '+e.message);await hangup()}
 finally{callBusy=false}
};
async function checkIncoming(){
 if(checkingCalls||currentCall||document.hidden||!me)return;checkingCalls=true;
 try{const d=await api('/api/calls/incoming');if(d.call&&!currentCall){currentCall={id:d.call.id,kind:d.call.kind,isCaller:false,lastSignal:0,pending:[],hasRemote:false};startVoiceSignalTimer(currentCall);showCallUI(d.call.kind,d.call.caller_name,true,d.call.caller_username);(notificationsEnabled()&&!serverPushEnabled&&notifyLocal('Panggilan TemanChat',String(d.call.caller_name||'Teman')+' menelepon Anda', 'call-'+d.call.id));}}
 catch(e){console.warn('Incoming call',e.message)}finally{checkingCalls=false}
}
let lastKnownCallId=null,callHistoryReady=false,lastHistoryCheck=0;
async function checkMissedCalls(){
  if(!me)return;
  try{
    const d=await api('/api/calls/history');
    const incoming=(d.calls||[]).filter(c=>c.direction==='incoming'&&c.status==='missed');
    if(callHistoryReady&&incoming.length&&incoming[0].id!==lastKnownCallId){
      const newest=incoming[0];
      if(notificationsEnabled()&&!serverPushEnabled)notifyLocal('Panggilan tak terjawab',`${newest.other_name||'Teman'} menelepon Anda`,'missed-'+newest.id);
    }
    lastKnownCallId=incoming[0]?.id||null;callHistoryReady=true;
  }catch(e){console.warn('Call history polling',e.message)}
}
// Satu siklus polling aktif dalam satu waktu: respons jaringan lambat tidak
// boleh membuat siklus 4 detik berikutnya bertumpuk dan membebani HP/server.
let tickBusy=false;
async function tick(){
 if(!me||tickBusy)return;
 tickBusy=true;
 try{
  const now=Date.now();
  if(!document.hidden){void heartbeatPresence();updateNotificationFocus();}
  // Riwayat tetap dicocokkan saat tersembunyi, tetapi tidak setiap 4 detik.
  if(now-lastHistoryCheck>(document.hidden?60000:20000)){
   lastHistoryCheck=now;await checkMissedCalls();
  }
  if(document.hidden){
   // Pertahankan signaling saat ada panggilan aktif; saat tidak ada panggilan,
   // notifikasi masuk tetap menjadi tugas Web Push (tanpa polling chat).
   if(currentCall&&currentCall.kind!=='audio')await pollCall();
   return;
  }
  if(currentCall){if(currentCall.kind!=='audio')await pollCall();}else await checkIncoming();
  if(active)await fetchMessages();
  if(now-lastListUpdate>8000){lastListUpdate=now;await fetchChats()}
 }finally{tickBusy=false}
}
async function init(){
 updateHeader(null);placeholder('Memeriksa sesi login…');if(innerWidth<=740)showList();
 try{
  const d=await api('/api/auth/me');me=d.user;
  document.querySelector('.profile b').textContent=me.display_name;
  document.querySelector('.profile small').textContent='@'+me.username;
  if(adminEntry)adminEntry.hidden=!me.is_admin;
  syncVerifiedBadges();
  paintAvatar(document.querySelector('.profile .avatar'),me.display_name,me.username);
  $('mode').replaceChildren(element('span','dot'),document.createTextNode(' Pesan aktif · V9.0'));
  placeholder('Cari username teman untuk memulai percakapan.');
  // Status Online hanya dari aplikasi terlihat, bukan hanya akun login.
  await heartbeatPresence(true);
  try{const preferences=await api('/api/media/preferences');
    mediaPrefs={mode:preferences.mode||'none',noticeSeen:!!preferences.noticeSeen};
    TCS.setPref(mediaPrefs.mode);
  }catch(e){console.warn('Preferensi media:',e.message)}
  await fetchChats();
  setTimeout(refreshInstallOffer,1300);
  const urlParams=new URLSearchParams(location.search);
  if(urlParams.get('adminCalls')==='1'&&me?.is_admin){
    // Pengajuan masuk langsung membuka panel admin khusus.
    if(adminEntry)adminEntry.click();
    history.replaceState(null,'',location.pathname);
  }
  const linkedChat=urlParams.get('chat');
  if(linkedChat&&UUID.test(linkedChat)){const destination=chats.find(c=>c.id===linkedChat);if(destination)void selectChat(destination);}
  void checkPush();
  try{const m=await api('/api/media/config');mediaEnabled=!!m.enabled}catch{mediaEnabled=false}
  TCS.cleanup();
  await checkMissedCalls();pollTimer=setInterval(tick,4000);
  typingPollTimer=setInterval(()=>{if(!document.hidden&&active)void refreshPartnerTyping()},3000);
  await checkIncoming();
 }catch(e){console.error('TemanChat init:',e);if(e.message!=='Sesi berakhir')toast('Tidak bisa memuat akun. Periksa koneksi lalu muat ulang.');}
}
document.addEventListener('visibilitychange',()=>{
 if(document.hidden){leaveNotificationFocus();stopTyping();partnerTyping=false;drawPartnerTyping();}
 else{updateNotificationFocus(true);void heartbeatPresence(true);void fetchChats();if(active){void fetchMessages(true);void refreshPartnerTyping();}}
});
window.addEventListener('blur',leaveNotificationFocus);
window.addEventListener('focus',()=>updateNotificationFocus(true));
window.addEventListener('pagehide',leaveNotificationFocus);
window.addEventListener('focus',()=>{if(Date.now()-lastPresenceBeat>PRESENCE_PING_MS)void heartbeatPresence()});
if('serviceWorker' in navigator){
 window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').then(syncNotificationModeWorker).catch(console.warn));
 navigator.serviceWorker.addEventListener('controllerchange',syncNotificationModeWorker);
}
// V7.9: tidak menambahkan pushState atau intercept popstate. Tombol Kembali
// bawaan Android tetap milik browser/OS, bukan dipaksa kembali ke daftar chat.
// Tombol Kembali internal (#backBtn), tombol tutup dialog, tetap bekerja bertahap.
// Mode tema dapat langsung diubah tanpa masuk ke Pengaturan.
document.querySelectorAll('[data-tc-theme]').forEach(button=>{
 button.addEventListener('click',()=>applyTheme(button.dataset.tcTheme));
});
applyTheme(localStorage.getItem(THEME_KEY)||'system');
if(window.matchMedia){
 const colorQuery=matchMedia('(prefers-color-scheme: dark)');
 colorQuery.addEventListener?.('change',()=>{
   if((localStorage.getItem(THEME_KEY)||'system')==='system')applyTheme('system');
 });
}
init();

// OAuth kembali dari Google setelah pengguna memberi izin.
try{const q=new URL(location.href).searchParams.get('drive');if(q){history.replaceState(null,'',location.pathname);setTimeout(()=>{const dict={connected:'Google Drive berhasil terhubung. Buka Pengaturan untuk melihat status.',failed:'Koneksi Google Drive gagal. Coba lagi dari Pengaturan.',cancelled:'Koneksi Google Drive dibatalkan.',expired:'Sesi izin Google kedaluwarsa. Ulangi.',login:'Silakan login ke TemanChat lagi.',scope:'Izin Drive belum diberikan.',invalid:'Respons Google tidak valid.'};toast(dict[q]||'Status Drive: '+q)},800)}}catch{}
