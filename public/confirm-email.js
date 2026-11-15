/* Konfirmasi email memakai POST eksplisit, tidak otomatis dipicu crawler email. */
'use strict';
const raw=new URL(location.href).searchParams.get('token');
try{history.replaceState(null,'',location.pathname)}catch{}
const info=document.getElementById('status'),btn=document.getElementById('confirm');
if(!raw||!/^[0-9a-f]{64}$/.test(raw)){
 info.textContent='Tautan tidak valid. Minta tautan baru dari Pengaturan TemanChat.';btn.disabled=true;
}else{
 btn.addEventListener('click',async()=>{
  btn.disabled=true;info.textContent='Memverifikasi email baru…';
  try{
   const r=await fetch('/api/auth/email-change/confirm',{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({token:raw})
   });
   const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'Verifikasi gagal.');
   info.textContent=d.message||'Berhasil. Silakan login menggunakan email baru.';
   btn.textContent='Email berhasil diperbarui';
  }catch(e){info.textContent=e.message;btn.textContent='Coba lagi';btn.disabled=false}
 });
}
