'use strict';
const $=id=>document.getElementById(id);
let mode='login',widgetId=null,ready=false,submitting=false,registered=false;
const params=new URLSearchParams(location.search);
function note(text,error=false){const n=$('notice');n.textContent=text;n.hidden=false;n.classList.toggle('error',error)}
function switchMode(next){
 mode=next;registered=false;$('registerSuccess')?.remove();$('authForm').hidden=false;
 $('registerFields').hidden=next!=='register';$('passwordGroup').hidden=['forgot','resend'].includes(next);
 $('emailGroup').hidden=next==='reset';$('tabs').hidden=!['login','register'].includes(next);
 for(const b of $('tabs').querySelectorAll('button'))b.classList.toggle('on',b.dataset.mode===next);
 $('email').required=next!=='reset';$('password').required=!['forgot','resend'].includes(next);
 $('displayName').required=next==='register';$('username').required=next==='register';
 $('passwordLabel').textContent=next==='reset'?'Password baru':'Password';
 $('password').autocomplete=next==='login'?'current-password':'new-password';
 $('submitBtn').textContent=({login:'Masuk',register:'Daftar akun',forgot:'Kirim link reset',resend:'Kirim ulang verifikasi',reset:'Ganti password'})[mode];
 $('forgotBtn').hidden=['forgot','resend','reset'].includes(next);
 $('resendBtn').hidden=['forgot','resend','reset'].includes(next);
 $('notice').hidden=true;ready=false;$('submitBtn').disabled=true;
 if(widgetId!==null&&window.turnstile)window.turnstile.reset(widgetId);
}
function registerSuccess(address){
 registered=true;$('notice').hidden=true;$('authForm').hidden=true;$('tabs').hidden=true;
 const n=document.createElement('section');n.className='tc-success';n.id='registerSuccess';
 const icon=document.createElement('div');icon.className='mail-icon';icon.textContent='✉';
 const title=document.createElement('h2');title.textContent='Pendaftaran berhasil!';
 const p=document.createElement('p');p.textContent='Silakan periksa kotak masuk email untuk mengaktifkan akun TemanChat.';
 const email=document.createElement('strong');email.textContent=address;
 const help=document.createElement('p');help.textContent='Periksa juga folder Spam. Tautan verifikasi berlaku 30 menit.';
 const back=document.createElement('button');back.type='button';back.textContent='Kembali ke Login';
 back.onclick=()=>{switchMode('login');$('password').value='';};
 n.append(icon,title,p,email,help,back);$('authForm').insertAdjacentElement('afterend',n);
}
$('tabs').onclick=e=>{const next=e.target.closest('button')?.dataset.mode;if(['login','register'].includes(next))switchMode(next)};
$('forgotBtn').onclick=()=>switchMode('forgot');$('resendBtn').onclick=()=>switchMode('resend');
$('showPassword').onclick=()=>{const p=$('password');p.type=p.type==='password'?'text':'password';$('showPassword').textContent=p.type==='password'?'Lihat':'Sembunyikan'};
async function initTurnstile(){
 try{
  const r=await fetch('/api/auth/config',{cache:'no-store'}),d=await r.json();
  if(!r.ok||!d.authReady||!d.siteKey)throw Error('Sistem autentikasi belum siap.');
  for(let i=0;i<100&&!window.turnstile;i++)await new Promise(resolve=>setTimeout(resolve,100));
  if(!window.turnstile)throw Error('Komponen Turnstile gagal dimuat.');
  widgetId=window.turnstile.render('#turnstile',{
   sitekey:d.siteKey,theme:'light',
   callback:token=>{if(!token||registered)return;ready=true;$('submitBtn').disabled=submitting;$('notice').hidden=true;},
   'error-callback':code=>{ready=false;$('submitBtn').disabled=true;note('Verifikasi keamanan gagal (kode '+code+'). Periksa hostname Turnstile.',true);return true;},
   'expired-callback':()=>{ready=false;$('submitBtn').disabled=true;note('Verifikasi kedaluwarsa. Ulangi pemeriksaan.',true)},
   'timeout-callback':()=>{ready=false;$('submitBtn').disabled=true;note('Pemeriksaan keamanan terlalu lama.',true)}
  });
 }catch(e){note(e.message||'Komponen keamanan belum siap.',true)}
}
$('authForm').onsubmit=async event=>{
 event.preventDefault();if(submitting||registered)return;
 const token=widgetId!==null?window.turnstile?.getResponse(widgetId):'';
 if(!ready||!token){note('Selesaikan pemeriksaan keamanan terlebih dahulu.',true);return}
 const data={turnstileToken:token};if(mode!=='reset')data.email=$('email').value.trim();
 if(!['forgot','resend'].includes(mode))data.password=$('password').value;
 if(mode==='register'){data.displayName=$('displayName').value.trim();data.username=$('username').value.trim()}
 if(mode==='login')data.deviceName=navigator.userAgent.slice(0,80);
 if(mode==='reset')data.token=params.get('reset');
 if(typeof data.password==='string'&&data.password.length<8){note('Password minimal 8 karakter.',true);return}
 const endpoint=({login:'login',register:'register',forgot:'forgot',resend:'resend-verification',reset:'reset'})[mode];
 submitting=true;$('submitBtn').disabled=true;
 try{
  const r=await fetch('/api/auth/'+endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'Permintaan tidak berhasil.');
  if(mode==='login'){location.replace('/');return}
  if(mode==='register'){$('password').value='';registerSuccess(data.email);return}
  if(mode==='reset'){$('password').value='';switchMode('login');note('Password berhasil diganti. Silakan masuk.');return}
  note(d.message||'Permintaan berhasil.');
 }catch(e){note(e.message||'Terjadi masalah server.',true)}
 finally{ready=false;submitting=false;$('submitBtn').disabled=true;if(widgetId!==null)window.turnstile?.reset(widgetId)}
};
if(params.has('reset'))switchMode('reset');else if(params.has('verified'))note('Email berhasil diverifikasi. Silakan masuk.');else if(params.has('error'))note('Periksa koneksi internet, lalu coba lagi.',true);
initTurnstile();
