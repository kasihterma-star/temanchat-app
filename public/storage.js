/* TemanChat V6 — penyimpanan lokal aplikasi dan Google Drive opsional.
   Token Google hanya di memori browser; tidak disimpan ke localStorage/D1. */
(function(){
'use strict';
const DBNAME='temanchat-media-v6', STORE='items', META='prefs';
let dbPromise,googleClient,googleToken=null,googleExpires=0;
const key=(uid,id)=>`${uid}:${id}`;
function openDB(){
 if(!('indexedDB' in window))return Promise.reject(Error('Penyimpanan browser tidak tersedia.'));
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
  const r=indexedDB.open(DBNAME,2);
  r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'key'});if(!r.result.objectStoreNames.contains(META))r.result.createObjectStore(META)};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
 });
 return dbPromise;
}
async function put(uid,id,blob,permanent=false){
 const db=await openDB(),k=key(uid,id);
 return new Promise((resolve,reject)=>{
  const t=db.transaction(STORE,'readwrite'),s=t.objectStore(STORE);
  const r=s.get(k);r.onsuccess=()=>{
   const existing=r.result||{};
   s.put({key:k,blob,createdAt:existing.createdAt||Date.now(),permanent:permanent||existing.permanent||false,verifiedAt:existing.verifiedAt||0});
  };t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);
 });
}
async function get(uid,id){
 const db=await openDB();return new Promise((resolve,reject)=>{
  const r=db.transaction(STORE,'readonly').objectStore(STORE).get(key(uid,id));
  r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);
 });
}
async function verified(uid,id){
 const db=await openDB();return new Promise((resolve,reject)=>{
  const t=db.transaction(STORE,'readwrite'),s=t.objectStore(STORE),r=s.get(key(uid,id));
  r.onsuccess=()=>{if(r.result)s.put({...r.result,verifiedAt:Date.now()})};
  t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);
 });
}
async function cleanup(){
 try{
  const db=await openDB(),t=db.transaction(STORE,'readwrite'),s=t.objectStore(STORE);
  const r=s.openCursor();r.onsuccess=()=>{const c=r.result;if(!c)return;
   const item=c.value;
   // Hapus cache setelah 3 hari dari keberhasilan backup, BUKAN file permanen lokal.
   if(!item.permanent&&Date.now()-(item.verifiedAt||item.createdAt)>=3*86400000)c.delete();
   c.continue();
  };
 }catch(e){console.warn('Cache cleanup',e?.message)}
}
function pref(){return localStorage.getItem('tc_media_destination')||'none';}
function setPref(x){if(['none','local','google_drive','nextcloud'].includes(x))localStorage.setItem('tc_media_destination',x);}
async function folderHandle(value){
 const db=await openDB();return new Promise((resolve,reject)=>{
   const t=db.transaction(META,value?'readwrite':'readonly'),s=t.objectStore(META);
   const r=value?s.put(value,'download-folder'):s.get('download-folder');
   r.onsuccess=()=>resolve(value||r.result||null);r.onerror=()=>reject(r.error);
 });
}
function supportsFolder(){return typeof window.showDirectoryPicker==='function';}
async function chooseFolder(){
 if(!supportsFolder())throw Error('Pemilihan folder otomatis tidak didukung browser ini.');
 const handle=await window.showDirectoryPicker({mode:'readwrite'});
 if(await handle.requestPermission({mode:'readwrite'})!=='granted')throw Error('Akses folder belum diberikan.');
 await folderHandle(handle);return handle.name;
}
function safeName(name){return String(name||'TemanChat-media').replace(/[\/:*?"<>|\x00-\x1f]/g,'_').slice(0,120);}
async function autoSaveFolder(blob,name){
 const folder=await folderHandle();if(!folder)throw Error('Belum memilih folder.');
 let perm=await folder.queryPermission({mode:'readwrite'});
 if(perm!=='granted')throw Error('Izin folder perlu diberikan lagi melalui Pengaturan.');
 const file=await folder.getFileHandle(safeName(name),{create:true});
 const out=await file.createWritable();await out.write(blob);await out.close();return true;
}
async function saveManual(blob,name){
 if(typeof window.showSaveFilePicker==='function'){
   const h=await window.showSaveFilePicker({suggestedName:safeName(name)});
   const file=await h.createWritable();await file.write(blob);await file.close();return 'folder';
 }
 const url=URL.createObjectURL(blob);const a=document.createElement('a');
 a.href=url;a.download=safeName(name);a.rel='noopener';document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),45000);return 'unduhan';
}
function wifi(){const type=navigator.connection?.type;return type==='wifi'||type==='ethernet';}
function getClientId(){return 'server-oauth';} // OAuth berjalan di Worker, ID/secret tidak dikirim ke browser.
async function driveStatus(){
 const r=await fetch('/api/google/status',{credentials:'same-origin',cache:'no-store'});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Gagal memeriksa Google Drive.');return d;
}
async function connectGoogle(){window.location.assign('/api/google/connect');}
async function disconnectGoogle(){
 const r=await fetch('/api/google/disconnect',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Gagal memutus Google Drive.');return d;
}
async function uploadDrive(blob,name){
 if(blob.size>20*1024*1024)throw Error('Backup via Worker saat ini maksimal 20 MB. File besar belum didukung; jangan gunakan pengiriman otomatis.');
 const r=await fetch('/api/google/upload',{method:'POST',credentials:'same-origin',
  headers:{'Content-Type':blob.type||'application/octet-stream','X-TC-File-Name':encodeURIComponent(name)},body:blob});
 const d=await r.json().catch(()=>({}));
 if(!r.ok||!d.ok)throw Error(d.error||'Upload ke Google Drive gagal.');
 return {fileId:d.fileId,md5Checksum:d.md5Checksum};
}
async function downloadDrive(fileId){
 const r=await fetch('/api/google/download/'+encodeURIComponent(fileId),{credentials:'same-origin',cache:'no-store'});
 if(!r.ok)throw Error('File tidak bisa diambil dari Google Drive yang terhubung.');return r.blob();
}
window.TCStorage={put,get,verified,cleanup,pref,setPref,wifi,getClientId,driveStatus,connectGoogle,disconnectGoogle,uploadDrive,downloadDrive,supportsFolder,chooseFolder,autoSaveFolder,saveManual};
})();
