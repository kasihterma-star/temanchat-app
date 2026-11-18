'use strict';
const $=id=>document.getElementById(id);
let mode='login',widgetId=null,ready=false,submitting=false,registered=false;
let securityLoading=false,securityFailed=false;
const turnstileReady=()=>typeof window.turnstile?.render==='function'&&typeof window.turnstile?.getResponse==='function';
const safeReset=()=>{if(widgetId!==null&&typeof window.turnstile?.reset==='function'){try{window.turnstile.reset(widgetId)}catch{}}};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const labels={login:'Masuk',register:'Daftar akun',forgot:'Kirim link reset',resend:'Kirim ulang verifikasi',reset:'Ganti password'};
function updateSubmitButton(){
 const button=$('submitBtn');
 if(!button)return;
 button.disabled=registered||submitting||!ready;
 button.textContent=submitting?'Memproses...':ready?labels[mode]:securityFailed?'Verifikasi belum siap':'Menyiapkan keamanan...';
}
function refreshSecurityStatus(){
 if(registered||submitting||widgetId===null||!turnstileReady())return;
 let token='';
 try{token=window.turnstile.getResponse(widgetId)||'';}catch{}
 const valid=Boolean(token);
 if(valid!==ready){ready=valid;updateSubmitButton();}
}

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
 updateSubmitButton();
 $('forgotBtn').hidden=['forgot','resend','reset'].includes(next);
 $('resendBtn').hidden=['forgot','resend','reset'].includes(next);
 $('notice').hidden=true;ready=false;updateSubmitButton();
 safeReset();
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
// Halaman dari WhatsApp/Safari dapat memuat objek Turnstile sebelum API render siap.
// Hindari refresh seluruh halaman berulang; ulangi hanya skrip keamanan satu kali.
async function waitForTurnstile(ms){
 const end=Date.now()+ms;
 while(Date.now()<end){if(turnstileReady())return true;await pause(120)}
 return turnstileReady();
}
async function loadTurnstileScript(attempt){
 if(turnstileReady())return true;
 const existing=document.getElementById('tc-turnstile-loader');
 if(existing)existing.remove();
 // Jangan memakai skrip lama/cached yang baru selesai setengah inisialisasi.
 if(window.turnstile&&!turnstileReady()){try{delete window.turnstile}catch{}}
 const script=document.createElement('script');
 script.id='tc-turnstile-loader';script.async=true;
 script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&tc_try='+attempt;
 const loaded=new Promise(resolve=>{
  script.onload=()=>resolve(true);script.onerror=()=>resolve(false);
  setTimeout(()=>resolve(false),8500);
 });
 document.head.append(script);
 await loaded;
 return waitForTurnstile(1400);
}
function showSecurityRetry(){
 const b=$('retrySecurityBtn');if(b)b.hidden=false;
}
function hideSecurityRetry(){
 const b=$('retrySecurityBtn');if(b)b.hidden=true;
}
async function initTurnstile(){
 if(securityLoading||registered||widgetId!==null)return;
 securityLoading=true;securityFailed=false;ready=false;updateSubmitButton();hideSecurityRetry();
 try{
  const r=await fetch('/api/auth/config',{cache:'no-store',credentials:'same-origin'});
  if(!r.ok)throw Error('Konfigurasi keamanan tidak dapat diakses.');
  const d=await r.json();
  if(!d.authReady||!d.siteKey)throw Error('Sistem keamanan belum siap. Coba lagi sebentar.');
  let available=await loadTurnstileScript(1);
  if(!available){available=await loadTurnstileScript(2)}
  if(!available)throw Error('Verifikasi keamanan tidak dapat dimuat di browser ini. Tekan Coba Lagi, atau buka tautan langsung melalui Safari/Chrome (bukan browser WhatsApp).');
  const w=window.turnstile;
  widgetId=w.render('#turnstile',{
   sitekey:d.siteKey,theme:'light',
   callback:token=>{if(!token||registered)return;ready=true;updateSubmitButton();$('notice').hidden=true;hideSecurityRetry()},
   'error-callback':code=>{ready=false;updateSubmitButton();note('Verifikasi keamanan belum berhasil ('+String(code||'').slice(0,16)+'). Coba ulangi atau buka melalui Safari/Chrome.',true);showSecurityRetry();return true},
   'expired-callback':()=>{ready=false;updateSubmitButton();note('Verifikasi kedaluwarsa. Silakan ulangi.',true);showSecurityRetry()},
   'timeout-callback':()=>{ready=false;updateSubmitButton();note('Verifikasi terlalu lama. Coba lagi.',true);showSecurityRetry()}
  });
  if(widgetId===undefined||widgetId===null)throw Error('Verifikasi keamanan belum tampil. Coba lagi.');
  refreshSecurityStatus();
 }catch(e){
  widgetId=null;securityFailed=true;updateSubmitButton();
  note(e.message||'Komponen keamanan belum siap. Coba lagi.',true);
  showSecurityRetry();
 }finally{securityLoading=false}
}
$('retrySecurityBtn')?.addEventListener('click',()=>{
 if(securityLoading||submitting)return;
 if(widgetId!==null&&typeof window.turnstile?.remove==='function'){
  try{window.turnstile.remove(widgetId)}catch{}
 }
 widgetId=null;ready=false;$('turnstile').replaceChildren();$('notice').hidden=true;
 void initTurnstile();
});
$('reloadPageBtn')?.addEventListener('click',()=>location.reload());
// Kembali dari share sheet/WhatsApp tidak boleh membuat challenge menggantung.
window.addEventListener('pageshow',event=>{
 if(event.persisted&&!securityLoading&&!registered){
  if(widgetId!==null){safeReset();ready=false;updateSubmitButton()}
  else void initTurnstile();
 }
});
$('authForm').onsubmit=async event=>{
 event.preventDefault();if(submitting||registered)return;
 refreshSecurityStatus();
 const token=widgetId!==null&&turnstileReady()?window.turnstile.getResponse(widgetId):'';
 if(!ready||!token){note('Selesaikan pemeriksaan keamanan terlebih dahulu.',true);return}
 const data={turnstileToken:token};if(mode!=='reset')data.email=$('email').value.trim();
 if(!['forgot','resend'].includes(mode))data.password=$('password').value;
 if(mode==='register'){data.displayName=$('displayName').value.trim();data.username=$('username').value.trim()}
 if(mode==='login')data.deviceName=navigator.userAgent.slice(0,80);
 if(mode==='reset')data.token=params.get('reset');
 if(typeof data.password==='string'&&data.password.length<8){note('Password minimal 8 karakter.',true);return}
 const endpoint=({login:'login',register:'register',forgot:'forgot',resend:'resend-verification',reset:'reset'})[mode];
 submitting=true;updateSubmitButton();
 try{
  const r=await fetch('/api/auth/'+endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'Permintaan tidak berhasil.');
  if(mode==='login'){location.replace('/');return}
  if(mode==='register'){$('password').value='';registerSuccess(data.email);return}
  if(mode==='reset'){$('password').value='';switchMode('login');note('Password berhasil diganti. Silakan masuk.');return}
  note(d.message||'Permintaan berhasil.');
 }catch(e){note(e.message||'Terjadi masalah server.',true)}
 finally{ready=false;submitting=false;updateSubmitButton();safeReset()}
};
if(params.has('reset'))switchMode('reset');else if(params.has('verified'))note('Email berhasil diverifikasi. Silakan masuk.');else if(params.has('error'))note('Periksa koneksi internet, lalu coba lagi.',true);
updateSubmitButton();
initTurnstile();
// Cadangan untuk kasus visual Turnstile sukses tetapi callback terlambat.
setInterval(refreshSecurityStatus,600);
