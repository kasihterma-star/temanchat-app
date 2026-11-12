'use strict';
// TemanChat V6: chat real D1, media R2 opsional, panggilan WebRTC eksperimental.
const $ = id => document.getElementById(id);
const TCS = window.TCStorage;
let me=null,chats=[],active=null,lastId=0,searchResults=null,searchSeq=0;
let pollTimer=null,busyMessages=false,busyChats=false,lastListUpdate=0,toastTimer,installPrompt=null;
let mediaEnabled=false,currentCall=null,checkingCalls=false,callBusy=false;
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
function smallTime(val){if(!val)return'';const d=new Date(val.replace(' ','T')+(val.endsWith('Z')?'':'Z'));return Number.isNaN(d.getTime())?'':d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});}
function showChat(){if(innerWidth<=740){$('sidebar').classList.remove('mobile-visible');$('conversation').classList.remove('mobile-hidden');}}
function showList(){if(innerWidth<=740){$('sidebar').classList.add('mobile-visible');$('conversation').classList.add('mobile-hidden');}}
function placeholder(msg){$('messages').replaceChildren(element('div','day',msg));}
function updateHeader(c){
 $('headName').textContent=c?c.other_name:'Pilih teman';$('headAvatar').textContent=c?avatar(c.other_name):'?';
 $('headStatus').textContent=c?'@'+c.other_username:'Cari pengguna untuk mulai chat';
 $('messageInput').disabled=!c;document.querySelector('.send').disabled=!c;
 for(const id of ['attachBtn','voiceBtn','videoBtn'])$(id).disabled=!c;
}
function renderChats(){
 const box=$('contacts'),q=$('search').value.trim().toLowerCase();box.replaceChildren();
 const list=q.length>=2&&searchResults!==null
  ?searchResults.map(u=>({other_name:u.display_name,other_username:u.username,searchPerson:true}))
  :chats.filter(c=>!q||c.other_name.toLowerCase().includes(q)||c.other_username.includes(q));
 if(!list.length){box.append(element('p','tc-empty',q.length>=2?'Tidak ditemukan. Coba username lain.':'Belum ada percakapan. Cari username teman di atas.'));return}
 for(const c of list){
  const b=element('button','contact'+(!c.searchPerson&&c.id===active?.id?' active':''));b.type='button';
  const av=element('div','avatar teal',avatar(c.other_name)),body=element('div','contact-content'),top=element('div','contact-top');
  top.append(element('b','',c.other_name),element('small','',c.searchPerson?'Mulai chat':smallTime(c.last_time)));
  body.append(top,element('p','',c.searchPerson?'@'+c.other_username:(c.last_message||'@'+c.other_username)));b.append(av,body);
  b.addEventListener('click',async()=>{
   if(c.searchPerson){
    b.disabled=true;
    try{
     const d=await post('/api/chat/start',{username:c.other_username});
     $('search').value='';searchResults=null;await fetchChats();
     await selectChat(chats.find(x=>x.id===d.conversationId)||{id:d.conversationId,other_name:c.other_name,other_username:c.other_username});
    }catch(e){toast(e.message)}finally{b.disabled=false}
   }else await selectChat(c);
  });box.append(b);
 }
}
async function fetchChats(){
 if(busyChats||!me)return;busyChats=true;
 try{
  const d=await api('/api/chat/conversations');chats=d.conversations||[];
  if(active){const now=chats.find(c=>c.id===active.id);if(now)active=now;}
  if(!$('search').value.trim()||searchResults===null)renderChats();
 }catch(e){toast(e.message)}finally{busyChats=false}
}
async function openMedia(messageId,m,area){
 if(!me)return;
 try{
  let local=await TCS.get(me.id,messageId).catch(()=>null),blob=local?.blob;
  if(!blob){
   const r=await fetch('/api/media/file?messageId='+encodeURIComponent(messageId),{credentials:'same-origin',cache:'no-store'});
   if(r.ok){blob=await r.blob();await TCS.put(me.id,messageId,blob,TCS.pref()==='local').catch(()=>{});}
   else{
    const b=await api('/api/media/backup?messageId='+encodeURIComponent(messageId));
    if(b.backup?.storage_type==='google_drive')blob=await TCS.downloadDrive(b.backup.storage_ref);
    else throw Error('Media sudah tidak tersedia. Penerima belum menyimpan salinannya.');
   }
  }
  if(!blob)return;
  const uri=URL.createObjectURL(blob);
  const preview=blob.type.startsWith('image/')?element('img'):blob.type.startsWith('video/')?element('video'):element('div','tc-hint','Dokumen siap diunduh');
  if(preview.tagName==='IMG'){preview.src=uri;preview.alt='Foto dalam percakapan';preview.onload=()=>{};}
  if(preview.tagName==='VIDEO'){preview.src=uri;preview.controls=true;preview.playsInline=true;}
  area.querySelector('.tc-preview')?.replaceChildren(preview);
  const actions=area.querySelector('.tc-actions');actions.replaceChildren();
  const save=element('button','tc-media-action','Simpan ke perangkat');save.onclick=async()=>{
   try{
    await TCS.put(me.id,messageId,blob,true);
    const a=document.createElement('a');a.href=uri;a.download=(m.mime_type||blob.type).startsWith('video/')?'temanchat-video.webm':'temanchat-media';a.click();
    toast('Media disimpan di aplikasi. Periksa folder unduhan jika ingin salinan di galeri.');
   }catch(e){toast(e.message)}
  };actions.append(save);
  if(TCS.pref()==='google_drive'&&TCS.getClientId()&&m.sender_id!==me.id){
   const drive=element('button','tc-media-action','Backup ke Google Drive');
   drive.onclick=async()=>{
    drive.disabled=true;drive.textContent='Mencadangkan…';
    try{
     const d=await TCS.uploadDrive(blob,'media-'+messageId);
     await post('/api/media/confirm',{messageId,storageType:'google_drive',driveFileId:d.fileId,accessToken:d.accessToken});
     await TCS.verified(me.id,messageId);toast('Backup Drive terverifikasi. Media transit R2 sudah dibersihkan.');
     drive.textContent='Tersimpan di Drive ✓';
    }catch(e){toast(e.message);drive.disabled=false;drive.textContent='Coba backup lagi'}
   };actions.append(drive);
  }
 }catch(e){toast(e.message)}
}
function addMessage(m){
 if($('messages').querySelector(`[data-message-id="${Number(m.id)}"]`))return;
 const b=element('div','bubble '+(m.sender_id===me.id?'me':'them'));b.dataset.messageId=String(m.id);
 b.append(element('span','',m.body));
 if(m.media_id){
  const area=element('div','tc-bubble-media');
  const view=element('button','tc-media-action','Buka media');view.onclick=()=>openMedia(m.id,m,area);
  const preview=element('div','tc-preview'),actions=element('div','tc-actions');
  area.append(view,preview,actions);b.append(area);
 }
 b.append(element('time','',smallTime(m.created_at)));
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
  for(const m of d.messages)addMessage(m);
 }catch(e){toast(e.message)}finally{busyMessages=false}
}
async function selectChat(c){active=c;lastId=0;updateHeader(c);renderChats();placeholder('Memuat pesan…');showChat();await fetchMessages(true)}
$('search').addEventListener('input',async()=>{
 const q=$('search').value.trim().toLowerCase(),seq=++searchSeq;searchResults=null;
 if(q.length<2){renderChats();return}
 try{const d=await api('/api/chat/people?q='+encodeURIComponent(q));if(seq===searchSeq){searchResults=d.people;renderChats()}}
 catch(e){if(seq===searchSeq)toast(e.message)}
});
$('messageForm').addEventListener('submit',async e=>{
 e.preventDefault();const input=$('messageInput'),msg=input.value.trim(),id=active?.id;
 if(!id||!msg||msg.length>1000)return;input.disabled=true;
 try{const d=await post('/api/chat/send',{conversationId:id,body:msg});input.value='';if(active?.id===id){if($('messages').querySelector('.day'))$('messages').replaceChildren();addMessage(d.message)}await fetchChats();}
 catch(e){toast(e.message)}finally{input.disabled=!active}
});
$('attachmentInput').addEventListener('change',async()=>{
 const file=$('attachmentInput').files[0],id=active?.id;$('attachmentInput').value='';if(!file||!id)return;
 if(!mediaEnabled){toast('R2 belum terhubung. Foto akan aktif setelah bucket MEDIA disiapkan.');return}
 if(file.size>20*1024*1024){toast('File maksimal 20 MB.');return}
 try{
  toast('Mengunggah media…');
  const init=await post('/api/media/init',{conversationId:id,name:file.name,type:file.type,size:file.size});
  const r=await fetch('/api/media/upload?id='+encodeURIComponent(init.mediaId),{method:'PUT',credentials:'same-origin',headers:{'Content-Type':file.type},body:file});
  const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'Gagal mengunggah media');
  const sent=await post('/api/media/send',{conversationId:id,mediaId:init.mediaId});
  if(active?.id===id){if($('messages').querySelector('.day'))$('messages').replaceChildren();addMessage(sent.message)}
  toast('Media terkirim. File asli di galeri tidak dihapus.');await fetchChats();
 }catch(e){toast(e.message)}
});
$('attachBtn').onclick=()=>{if(!mediaEnabled)toast('Untuk mengirim foto, hubungkan Cloudflare R2 lebih dahulu.');else $('attachmentInput').click()};
function modal(title,text,buttons=[]){$('modalTitle').textContent=title;$('modalDesc').textContent=text;const c=$('modalContent');c.replaceChildren();for(const b of buttons){const btn=element('button','primary',b.label);btn.onclick=b.action;c.append(btn)}$('modal').showModal();}
$('closeModal').onclick=()=>$('modal').close();
$('moreBtn').onclick=()=>modal('Percakapan',active?`Percakapan pribadi dengan @${active.other_username}. Pesan teks belum menggunakan enkripsi ujung-ke-ujung.`:'Silakan pilih teman.');
$('settingsBtn').onclick=()=>{
 modal('Pengaturan TemanChat',me?`${me.display_name} (@${me.username})`:'');
 const root=$('modalContent'),wrap=element('div','tc-settings'),label=element('label','','Penyimpanan media penerima');
 const select=element('select');
 for(const [v,t] of [['local','Lokal perangkat'],['google_drive','Google Drive pribadi']]){const o=element('option','',t);o.value=v;select.append(o)}
 select.value=TCS.pref();select.onchange=()=>{TCS.setPref(select.value);toast(select.value==='local'?'Penyimpanan lokal dipilih. Media di browser bisa hilang bila data situs dihapus.':'Google Drive dipilih. Backup butuh izin Google dan Wi-Fi yang bisa diverifikasi.')};
 wrap.append(label,select,element('small','Foto dikirim dari perangkat, bukan dipilih dari Google Drive. Cache cloud dibersihkan 3 hari setelah backup berhasil; mode lokal tidak ikut dibersihkan otomatis.'));
 if(!TCS.getClientId())wrap.append(element('small','','Integrasi Google Drive belum dikonfigurasi. Sampai disiapkan, gunakan Lokal.'));
 else {const connect=element('button','primary','Hubungkan Google Drive');connect.onclick=async()=>{try{await TCS.connectGoogle();toast('Google Drive terhubung untuk sesi browser ini.')}catch(e){toast(e.message)}};wrap.append(connect)}
 const install=element('button','primary','Instal TemanChat');install.onclick=()=>{$('modal').close();$('installBtn').click()};wrap.append(install);
 const logout=element('button','primary','Keluar dari akun');logout.onclick=async()=>{try{await post('/api/auth/logout',{});location.replace('/auth.html')}catch(e){toast(e.message)}};wrap.append(logout);root.append(wrap);
};
$('backBtn').onclick=showList;
window.addEventListener('resize',()=>{if(innerWidth>740){$('sidebar').classList.remove('mobile-visible');$('conversation').classList.remove('mobile-hidden')}else if(active)showChat();else showList()});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e});
$('installBtn').onclick=async()=>{
 if(matchMedia('(display-mode:standalone)').matches)return toast('TemanChat sudah terpasang.');
 if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;return}
 modal('Instal TemanChat',/iPhone|iPad|iPod/.test(navigator.userAgent)?'Safari → Bagikan → Tambahkan ke Layar Utama.':'Chrome/Edge → menu ⋮ → Instal aplikasi / Tambahkan ke layar utama.');
};
// --------- Panggilan suara dan video (WebRTC / signaling D1) ---------
function callLabel(text){$('callState').textContent=text}
function showCallUI(kind,name,incoming){
 const dlg=$('callDialog');$('callName').textContent=name||'TemanChat';$('callAvatar').textContent=avatar(name);
 $('callRemote').style.display='flex';$('callAvatar').style.display='grid';$('remoteVideo').style.display='none';$('localVideo').style.display='none';
 $('acceptCall').hidden=!incoming;$('cameraCall').hidden=kind!=='video';callLabel(incoming?'Panggilan masuk…':'Memanggil…');
 if(!dlg.open)dlg.showModal();
}
function closeCallUI(){
 const dlg=$('callDialog');if(dlg.open)dlg.close();$('localVideo').srcObject=null;$('remoteVideo').srcObject=null;
 $('localVideo').style.display='none';$('remoteVideo').style.display='none';
}
function stopCallLocally(){
 const c=currentCall;if(!c)return;
 currentCall=null;
 if(c.pc){c.pc.onicecandidate=null;c.pc.ontrack=null;c.pc.close()}
 c.stream?.getTracks().forEach(t=>t.stop());closeCallUI();
}
async function hangup(){
 const c=currentCall;stopCallLocally();if(c)await post('/api/calls/decision',{callId:c.id,action:'hangup'}).catch(()=>{});
}
$('hangupCall').onclick=hangup;
$('muteCall').onclick=()=>{const c=currentCall;if(!c?.stream)return;for(const track of c.stream.getAudioTracks())track.enabled=!track.enabled;$('muteCall').textContent=c.stream.getAudioTracks()[0]?.enabled?'🎙 Mikrofon':'🔇 Bisukan';};
$('cameraCall').onclick=()=>{const c=currentCall;if(!c?.stream)return;for(const track of c.stream.getVideoTracks())track.enabled=!track.enabled;$('cameraCall').textContent=c.stream.getVideoTracks()[0]?.enabled?'▣ Kamera':'▣ Kamera mati';};
async function preparePeer(c){
 const opts=await api('/api/calls/config');
 const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:c.kind==='video'});
 if(currentCall!==c){stream.getTracks().forEach(t=>t.stop());return}
 c.stream=stream;c.pc=new RTCPeerConnection({iceServers:opts.iceServers});
 for(const track of stream.getTracks())c.pc.addTrack(track,stream);
 c.pc.ontrack=e=>{$('remoteVideo').srcObject=e.streams[0];$('remoteVideo').style.display='block';$('callRemote').style.display='none';$('remoteVideo').play().catch(()=>{});callLabel('Terhubung')};
 c.pc.onicecandidate=e=>{if(!e.candidate||currentCall!==c)return;post('/api/calls/signal',{callId:c.id,kind:'candidate',payload:JSON.stringify(e.candidate.toJSON())}).catch(console.warn)};
 c.pc.onconnectionstatechange=()=>{if(currentCall!==c)return;const s=c.pc.connectionState;if(s==='connected')callLabel('Terhubung');if(['failed','closed'].includes(s)){toast('Koneksi panggilan terputus. TURN mungkin diperlukan.');hangup()}};
 if(c.kind==='video'){$('localVideo').srcObject=stream;$('localVideo').style.display='block';}
}
async function setRemote(c,description){
 if(!c.pc)return;
 await c.pc.setRemoteDescription(description);c.hasRemote=true;
 for(const ice of c.pending.splice(0)){try{await c.pc.addIceCandidate(ice)}catch{}}
}
async function pollCall(){
 const c=currentCall;
 if(!c)return;
 try{
  const state=await api('/api/calls/state?callId='+encodeURIComponent(c.id));
  if(currentCall!==c)return;
  if(['declined','ended','missed'].includes(state.call.status)){toast('Panggilan selesai.');stopCallLocally();return}
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
}
async function startCall(kind){
 if(!active)return toast('Pilih teman terlebih dahulu.');
 if(currentCall)return toast('Masih ada panggilan aktif.');
 if(!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection)return toast('Browser ini belum mendukung WebRTC atau izin mikrofon/kamera.');
 try{
  const d=await post('/api/calls/start',{conversationId:active.id,kind});
  const c={id:d.callId,kind,isCaller:true,lastSignal:0,pending:[],hasRemote:false};currentCall=c;
  showCallUI(kind,active.other_name,false);await preparePeer(c);if(currentCall!==c)return;
  const offer=await c.pc.createOffer();await c.pc.setLocalDescription(offer);
  await post('/api/calls/signal',{callId:c.id,kind:'offer',payload:JSON.stringify(c.pc.localDescription)});
  toast('Panggilan dikirim. Penerima harus membuka TemanChat.');
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
 try{const d=await api('/api/calls/incoming');if(d.call&&!currentCall){currentCall={id:d.call.id,kind:d.call.kind,isCaller:false,lastSignal:0,pending:[],hasRemote:false};showCallUI(d.call.kind,d.call.caller_name,true);}}
 catch(e){console.warn('Incoming call',e.message)}finally{checkingCalls=false}
}
async function tick(){
 if(document.hidden||!me)return;
 if(currentCall)await pollCall();else await checkIncoming();
 if(active)await fetchMessages();
 if(Date.now()-lastListUpdate>8000){lastListUpdate=Date.now();await fetchChats()}
}
async function init(){
 updateHeader(null);placeholder('Memeriksa sesi login…');if(innerWidth<=740)showList();
 try{
  const d=await api('/api/auth/me');me=d.user;
  document.querySelector('.profile b').textContent=me.display_name;
  document.querySelector('.profile small').textContent='@'+me.username;
  document.querySelector('.profile .avatar').textContent=avatar(me.display_name);
  $('mode').replaceChildren(element('span','dot'),document.createTextNode(' Pesan aktif · V6'));
  placeholder('Cari username teman untuk memulai percakapan.');
  await fetchChats();
  try{const m=await api('/api/media/config');mediaEnabled=!!m.enabled}catch{mediaEnabled=false}
  TCS.cleanup();
  pollTimer=setInterval(tick,4000);await checkIncoming();
 }catch(e){console.error('TemanChat init:',e);if(e.message!=='Sesi berakhir')toast('Tidak bisa memuat akun. Periksa koneksi lalu muat ulang.');}
}
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(console.warn));
init();
