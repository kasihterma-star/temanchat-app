/* TemanChat V6 — penyimpanan lokal aplikasi dan Google Drive opsional.
   Token Google hanya di memori browser; tidak disimpan ke localStorage/D1. */
(function(){
'use strict';
const DBNAME='temanchat-media-v6', STORE='items';
let dbPromise,googleClient,googleToken=null,googleExpires=0;
const key=(uid,id)=>`${uid}:${id}`;
function openDB(){
 if(!('indexedDB' in window))return Promise.reject(Error('Penyimpanan browser tidak tersedia.'));
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
  const r=indexedDB.open(DBNAME,1);
  r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'key'})};
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
   if(!item.permanent&&item.verifiedAt&&Date.now()-item.verifiedAt>=3*86400000)c.delete();
   c.continue();
  };
 }catch(e){console.warn('Cache cleanup',e?.message)}
}
function pref(){return localStorage.getItem('tc_media_destination')||'local';}
function setPref(x){if(['local','google_drive'].includes(x))localStorage.setItem('tc_media_destination',x);}
function wifi(){const type=navigator.connection?.type;return type==='wifi'||type==='ethernet';}
function getClientId(){return window.TEMANCHAT_CONFIG?.googleClientId?.trim()||'';}
async function loadGIS(){
 if(window.google?.accounts?.oauth2)return;
 await new Promise((resolve,reject)=>{
  const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;
  s.onload=resolve;s.onerror=()=>reject(Error('Gagal memuat layanan Google.'));document.head.append(s);
 });
}
async function connectGoogle(){
 const cid=getClientId();if(!cid)throw Error('Google Drive belum dikonfigurasi oleh pemilik TemanChat.');
 await loadGIS();
 if(googleToken&&Date.now()<googleExpires)return googleToken;
 return new Promise((resolve,reject)=>{
  if(!googleClient)googleClient=google.accounts.oauth2.initTokenClient({
   client_id:cid,scope:'https://www.googleapis.com/auth/drive.file',
   callback:response=>{
    if(response.error||!response.access_token){reject(Error('Koneksi Google dibatalkan.'));return;}
    googleToken=response.access_token;googleExpires=Date.now()+(Number(response.expires_in||3500)-60)*1000;
    resolve(googleToken);
   }
  });
  googleClient.requestAccessToken({prompt:'consent'});
 });
}
async function getGoogleToken(){return googleToken&&Date.now()<googleExpires?googleToken:await connectGoogle();}
async function uploadDrive(blob,name){
 if(!wifi())throw Error('Backup hanya saat Wi-Fi terverifikasi. Browser ini mungkin tidak bisa mendeteksi jenis jaringan.');
 const token=await getGoogleToken();
 const boundary='tc_'+Math.random().toString(36).slice(2);
 const metadata={name:'TemanChat_'+(name||'media').replace(/[^\w.-]/g,'_').slice(0,90)};
 const before=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${blob.type||'application/octet-stream'}\r\n\r\n`;
 const payload=new Blob([before,blob,`\r\n--${boundary}--`]);
 const r=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size',{
  method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':`multipart/related; boundary=${boundary}`},body:payload
 });
 if(!r.ok)throw Error('Upload ke Google Drive gagal (HTTP '+r.status+').');
 const d=await r.json();if(!d.id||Number(d.size)!==blob.size)throw Error('Ukuran backup Google Drive tidak cocok.');
 return {fileId:d.id,accessToken:token};
}
async function downloadDrive(fileId){
 const token=await getGoogleToken();const r=await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?alt=media',{headers:{Authorization:`Bearer ${token}`}});
 if(!r.ok)throw Error('Media tidak bisa diambil dari Drive. Hubungkan kembali akun Google.');
 return r.blob();
}
window.TCStorage={put,get,verified,cleanup,pref,setPref,wifi,getClientId,connectGoogle,uploadDrive,downloadDrive};
})();
