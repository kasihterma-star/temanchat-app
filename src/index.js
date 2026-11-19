import { handleWhatsApp } from './whatsapp.js';
import { pushApi, sendPush, sendRingingCallPushes } from './push.js';
import { handleGoogle } from './google-drive.js';
import { logDeviceLogin, touchDevice, listDevices, revokeDevice, ensureDeviceSchema } from './devices.js';
// TemanChat V6 terpadu: login, chat, media R2 opsional, sinyal WebRTC.
import { ensureExtras, handleExtra, cleanup } from './extras.js';
import { ensureReplySchema, validateReply, storeReply } from './replies.js';
const HOST = 'chat.ege.my.id';
const FROM = 'TemanChat <noreply@temanchat.ege.my.id>';
const SITE_KEY = '0x4AAAAAAF8MtCXwBz83LC5d';
const TE = new TextEncoder();
const reply = (body, status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const hex = bytes => [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
const random = (n=32) => {const bytes=new Uint8Array(n);crypto.getRandomValues(bytes);return hex(bytes)};
const sha = async s => hex(await crypto.subtle.digest('SHA-256',TE.encode(s)));
const clean = s => String(s??'').trim();
const allowOrigin = req => req.headers.get('Origin') === `https://${HOST}`;
function cookie(req,name){const v=req.headers.get('Cookie')||'';const m=v.match(new RegExp('(?:^|;\\s*)'+name+'=([^;]*)'));return m?m[1]:null}
function sessionCookie(token,maxAge){return `tc_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`}
async function passwordHash(password,salt=random(16),rounds=100000){
  const key=await crypto.subtle.importKey('raw',TE.encode(password),'PBKDF2',false,['deriveBits']);
  const hash=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:Uint8Array.from(salt.match(/../g).map(x=>parseInt(x,16))),iterations:rounds},key,256);
  return `pbkdf2-sha256$${rounds}$${salt}$${hex(hash)}`;
}
async function verifyPassword(password,stored){
  const p=String(stored||'').split('$');
  if(p.length!==4||p[0]!=='pbkdf2-sha256'||!/^[0-9a-f]{32}$/.test(p[2])||!/^[0-9a-f]{64}$/.test(p[3]))return false;
  const rounds=Number(p[1]);if(!Number.isSafeInteger(rounds)||rounds<100000||rounds>100000)return false;
  const got=(await passwordHash(password,p[2],rounds)).split('$')[3];
  let diff=0;for(let i=0;i<64;i++)diff|=got.charCodeAt(i)^p[3].charCodeAt(i);return diff===0;
}
async function readJSON(req,max=12000){
  if(!req.headers.get('content-type')?.toLowerCase().includes('application/json'))throw Error('format');
  if(Number(req.headers.get('content-length')||0)>max)throw Error('size');
  const raw=await req.text();if(raw.length>max)throw Error('size');
  const body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error('format');return body;
}
async function limit(req,env,action,max,identity=''){
  const ip=req.headers.get('CF-Connecting-IP')||'unknown';const bucket=Math.floor(Date.now()/600000);
  const key=await sha(`${action}|${bucket}|${identity}|${ip}|${env.TURNSTILE_SECRET_KEY}`);
  const r=await env.DB.prepare('INSERT INTO auth_rate_limits(key,attempts,created_at) VALUES(?,1,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(key).first();
  return Number(r?.attempts||0)<=max;
}
async function turnstile(token,env){
  if(typeof token!=='string'||!token||token.length>2048||!env.TURNSTILE_SECRET_KEY)return false;
  try {
    const r=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:token})});
    if(!r.ok)return false;const data=await r.json();return data.success===true&&data.hostname===HOST;
  }catch{return false}
}
async function mail(env,to,subject,body){
  if(!env.RESEND_API_KEY)return false;
  try {
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:FROM,to:[to],subject,text:body})});
    if(!r.ok){console.error('Resend status',r.status);return false}return true;
  }catch(e){console.error('Resend request failed');return false}
}
async function makeToken(env,userId,purpose){
  const token=random(),hash=await sha(token),id=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO auth_tokens(id,user_id,token_hash,purpose,expires_at) VALUES(?,?,?,?,datetime(\'now\',\'+30 minutes\'))').bind(id,userId,hash,purpose).run();
  return token;
}
async function userSession(req,env){
  const token=cookie(req,'tc_session');if(!token||!/^[0-9a-f]{64}$/.test(token))return null;
  return env.DB.prepare('SELECT u.id,u.username,u.email,u.display_name,u.email_verified,s.id AS session_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>datetime(\'now\') AND u.email_verified=1 LIMIT 1').bind(await sha(token)).first();
}
const publicUser=(u,env)=>({id:u.id,username:u.username,email:u.email,display_name:u.display_name,email_verified:u.email_verified,is_admin:!!(env.TC_CALL_ADMIN_EMAIL&&u.email&&u.email.toLowerCase()===String(env.TC_CALL_ADMIN_EMAIL).trim().toLowerCase())});
// Foto profil mini (JPEG, maksimal 60 KB per akun). Terpisah dari R2 media chat.
// Hanya pengguna terautentikasi yang dapat melihat foto; akun hanya mengubah fotonya sendiri.
let avatarSchemaPromise;
function ensureAvatarSchema(env){
 if(!avatarSchemaPromise)avatarSchemaPromise=env.DB.prepare(`CREATE TABLE IF NOT EXISTS tc_profile_avatars (
   user_id TEXT PRIMARY KEY,
   image_b64 TEXT NOT NULL,
   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
   FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
 )`).run().catch(e=>{avatarSchemaPromise=null;throw e});
 return avatarSchemaPromise;
}

let emailChangeSchemaPromise;
function ensureEmailChangeSchema(env){
 if(!emailChangeSchemaPromise)emailChangeSchemaPromise=env.DB.prepare(`CREATE TABLE IF NOT EXISTS tc_pending_email_changes (
  user_id TEXT PRIMARY KEY,
  new_email TEXT NOT NULL COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
 )`).run().catch(e=>{emailChangeSchemaPromise=null;throw e});
 return emailChangeSchemaPromise;
}

// Watermark pesan per pengguna: delivered saat perangkat terhubung dan mengambil daftar,
// read hanya setelah percakapan terbuka dan terlihat. Tidak mengklaim diterima saat app offline.
let receiptSchema;
async function ensureReceiptSchema(env){
  if(!receiptSchema) receiptSchema=env.DB.prepare(`CREATE TABLE IF NOT EXISTS tc_chat_receipts (
    chat_id TEXT NOT NULL, user_id TEXT NOT NULL,
    delivered_id INTEGER NOT NULL DEFAULT 0, read_id INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(chat_id,user_id),
    FOREIGN KEY(chat_id) REFERENCES tc_direct_chats(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`).run().catch(e=>{receiptSchema=null;throw e});
  return receiptSchema;
}
async function deliveredWhileOnline(env,userId,chatId=null){
  await ensureReceiptSchema(env);
  const where=chatId?'(c.user_a=? OR c.user_b=?) AND c.id=?':'(c.user_a=? OR c.user_b=?)';
  const values=chatId?[userId,userId,userId,userId,chatId,userId]:[userId,userId,userId,userId,userId];
  await env.DB.prepare(`INSERT INTO tc_chat_receipts(chat_id,user_id,delivered_id)
    SELECT c.id,?, COALESCE((SELECT MAX(m.id) FROM tc_direct_messages m
      WHERE m.chat_id=c.id AND m.sender_id<>?),0)
    FROM tc_direct_chats c WHERE ${where}
    AND EXISTS(SELECT 1 FROM tc_direct_messages m WHERE m.chat_id=c.id AND m.sender_id<>?)
    ON CONFLICT(chat_id,user_id) DO UPDATE SET
      delivered_id=MAX(tc_chat_receipts.delivered_id,excluded.delivered_id),
      updated_at=CURRENT_TIMESTAMP`).bind(...values).run();
}
// Status Online / Terakhir aktif hanya diperbarui dari halaman aplikasi yang terlihat.
// Satu baris per akun: login di banyak perangkat tidak saling menimpa status offline.
// 45 detik per heartbeat, offline jika tidak ada heartbeat selama 110 detik.
const PRESENCE_OFFLINE_SECONDS=110;
let presenceSchemaPromise;
function ensurePresenceSchema(env){
 if(!presenceSchemaPromise)presenceSchemaPromise=env.DB.prepare(`CREATE TABLE IF NOT EXISTS tc_user_presence (
   user_id TEXT PRIMARY KEY,
   last_active_at INTEGER NOT NULL,
   FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
 )`).run().catch(e=>{presenceSchemaPromise=null;throw e});
 return presenceSchemaPromise;
}
// Indikator sedang mengetik bersifat sementara dan hanya terlihat oleh anggota chat.
// Tidak menyimpan isi ketikan. Kunci satu baris per pengguna dan percakapan.
let typingSchemaPromise;
function ensureTypingSchema(env){
 if(!typingSchemaPromise)typingSchemaPromise=env.DB.prepare(`CREATE TABLE IF NOT EXISTS tc_chat_typing (
   chat_id TEXT NOT NULL,
   user_id TEXT NOT NULL,
   expires_at INTEGER NOT NULL,
   PRIMARY KEY(chat_id,user_id),
   FOREIGN KEY (chat_id) REFERENCES tc_direct_chats(id) ON DELETE CASCADE,
   FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
 )`).run().catch(e=>{typingSchemaPromise=null;throw e});
 return typingSchemaPromise;
}
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function consumeToken(env,raw,purpose){
  if(typeof raw!=='string'||!/^[0-9a-f]{64}$/.test(raw))return null;
  const th=await sha(raw);
  const row=await env.DB.prepare('SELECT id,user_id FROM auth_tokens WHERE token_hash=? AND purpose=? AND used_at IS NULL AND expires_at>datetime(\'now\') LIMIT 1').bind(th,purpose).first();
  if(!row)return null;
  const changed=await env.DB.prepare('UPDATE auth_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=? AND used_at IS NULL AND expires_at>datetime(\'now\')').bind(row.id).run();
  return changed.meta.changes?row:null;
}
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url),path=url.pathname;
  try {
    if(path==='/api/health'&&request.method==='GET'){
      const rows=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      return reply({ok:true,app:'TemanChat',phase:'v6-integrated',database:'connected',tables:rows.results.map(x=>x.name)});
    }
    if(path==='/api/auth/schema-check'&&request.method==='GET'){
      const tests={
        users:['id','username','email','password_hash','display_name','email_verified','updated_at'],
        sessions:['id','user_id','token_hash','device_name','expires_at','revoked_at'],
        auth_tokens:['id','user_id','token_hash','purpose','expires_at','used_at'],
        auth_rate_limits:['key','attempts','created_at']
      };
      const checks={};
      for(const [table,columns] of Object.entries(tests)){
        const result=await env.DB.prepare(`PRAGMA table_info(${table})`).all();
        const actual=new Set(result.results.map(r=>r.name));
        checks[table]={ready:columns.every(c=>actual.has(c)),missing:columns.filter(c=>!actual.has(c))};
      }
      return reply({ok:Object.values(checks).every(c=>c.ready),checks});
    }
    if(path==='/api/features'&&request.method==='GET')return reply({ok:true,version:'7.4.0',media:!!env.MEDIA,chat:true,calls:true,googleDriveClientConfigured:Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET)});
    if(path.startsWith('/api/wa/'))return handleWhatsApp(request,env,await userSession(request,env));
    if(path==='/api/auth/config'&&request.method==='GET')return reply({siteKey:SITE_KEY,authReady:Boolean(env.DB&&env.RESEND_API_KEY&&env.TURNSTILE_SECRET_KEY)});
    if(path==='/api/auth/me'&&request.method==='GET'){
      const u=await userSession(request,env);if(u)await touchDevice(env,u,request.headers.get('User-Agent'));return u?reply({ok:true,user:publicUser(u,env)}):reply({ok:false},401);
    }
    if(path.startsWith('/api/avatar/')&&request.method==='GET'){
      const me=await userSession(request,env);
      if(!me)return reply({error:'Silakan login.'},401);
      const username=decodeURIComponent(path.slice('/api/avatar/'.length)).toLowerCase();
      if(!/^[a-z0-9_]{3,24}$/.test(username))return new Response(null,{status:404});
      await ensureAvatarSchema(env);
      const row=await env.DB.prepare(`SELECT a.image_b64 FROM tc_profile_avatars a
        JOIN users u ON u.id=a.user_id WHERE u.username=? AND u.email_verified=1 LIMIT 1`)
        .bind(username).first();
      if(!row)return new Response(null,{status:404,headers:{'Cache-Control':'private,max-age=30'}});
      const binary=atob(row.image_b64);
      const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
      return new Response(bytes,{headers:{'Content-Type':'image/jpeg','Cache-Control':'private,max-age=45',
        'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"}});
    }

    if(path==='/api/auth/verify'&&request.method==='GET'){
      const row=await consumeToken(env,url.searchParams.get('token'),'verify_email');
      if(!row)return new Response('Tautan verifikasi tidak berlaku atau sudah digunakan.',{status:400,headers:{'Cache-Control':'no-store'}});
      await env.DB.prepare('UPDATE users SET email_verified=1,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(row.user_id).run();
      return Response.redirect(`https://${HOST}/auth.html?verified=1`,303);
    }
    if(path.startsWith('/api/auth/')&&request.method==='POST'){
      if(!allowOrigin(request))return reply({error:'Origin tidak diizinkan'},403);
      let d;try{d=await readJSON(request,path==='/api/auth/avatar'?90000:12000)}catch{return reply({error:'Permintaan JSON tidak valid atau terlalu besar'},400)}
      if(path==='/api/auth/register'){
        if(!await limit(request,env,'register',5))return reply({error:'Terlalu banyak percobaan. Coba lagi nanti.'},429);
        const email=clean(d.email).toLowerCase(),username=clean(d.username).toLowerCase(),name=clean(d.displayName),password=d.password;
        if(!EMAIL.test(email)||email.length>254||!/^[a-z0-9_]{3,24}$/.test(username)||name.length<2||name.length>60||typeof password!=='string'||password.length<8||password.length>128)return reply({error:'Periksa nama, email, username, dan password (minimal 8 karakter).'},400);
        if(!await turnstile(d.turnstileToken,env))return reply({error:'Verifikasi keamanan gagal. Coba ulangi.'},403);
        const existing=await env.DB.prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE OR username=? LIMIT 1').bind(email,username).first();
        if(existing)return reply({error:'Email atau username sudah digunakan.'},409);
        // Password hashing on Workers Free must be tested against CPU quota before public launch.
        const pw=await passwordHash(password),userId=crypto.randomUUID(),token=random();
        try{
          await env.DB.batch([
            env.DB.prepare('INSERT INTO users(id,username,email,password_hash,display_name,email_verified) VALUES(?,?,?,?,?,0)').bind(userId,username,email,pw,name),
            env.DB.prepare("INSERT INTO auth_tokens(id,user_id,token_hash,purpose,expires_at) VALUES(?,?,?,'verify_email',datetime('now','+30 minutes'))").bind(crypto.randomUUID(),userId,await sha(token))
          ]);
        }catch{return reply({error:'Email atau username tidak tersedia.'},409)}
        const sent=await mail(env,email,'Verifikasi akun TemanChat',`Halo ${name}!\n\nBuka tautan berikut untuk mengaktifkan akun:\nhttps://${HOST}/api/auth/verify?token=${token}\n\nTautan berlaku 30 menit. Abaikan jika tidak mendaftar.`);
        return sent?reply({ok:true,message:'Pendaftaran dicatat. Periksa email untuk aktivasi.'}):reply({ok:false,error:'Akun sudah dibuat tetapi email gagal dikirim. Gunakan Kirim Ulang Verifikasi.'},503);
      }
      if(path==='/api/auth/resend-verification'){
        if(!await limit(request,env,'resend',3))return reply({error:'Terlalu banyak permintaan. Coba lagi nanti.'},429);
        if(!await turnstile(d.turnstileToken,env))return reply({error:'Verifikasi keamanan gagal.'},403);
        const email=clean(d.email).toLowerCase();if(!EMAIL.test(email)||email.length>254)return reply({error:'Email tidak valid.'},400);
        const u=await env.DB.prepare('SELECT id,display_name,email_verified FROM users WHERE email=? COLLATE NOCASE LIMIT 1').bind(email).first();
        if(u&&!u.email_verified){
          const token=await makeToken(env,u.id,'verify_email');
          await mail(env,email,'Tautan verifikasi TemanChat',`Halo ${u.display_name}!\n\nVerifikasi akun: https://${HOST}/api/auth/verify?token=${token}\n\nTautan berlaku 30 menit.`);
        }
        return reply({ok:true,message:'Jika email belum terverifikasi, tautan baru akan dikirim.'});
      }
      if(path==='/api/auth/login'){
        const email=clean(d.email).toLowerCase(),password=d.password;
        if(!await limit(request,env,'login-ip',15)||!await limit(request,env,'login-account',8,email))return reply({error:'Terlalu banyak percobaan login. Coba lagi nanti.'},429);
        if(!EMAIL.test(email)||email.length>254||typeof password!=='string'||password.length>128)return reply({error:'Email atau password salah.'},401);
        if(!await turnstile(d.turnstileToken,env))return reply({error:'Verifikasi keamanan gagal. Coba ulangi.'},403);
        const u=await env.DB.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE LIMIT 1').bind(email).first();
        if(!u||!await verifyPassword(password,u.password_hash))return reply({error:'Email atau password salah.'},401);
        if(!u.email_verified)return reply({error:'Email belum diverifikasi.'},403);
        const token=random(),sessionId=crypto.randomUUID();
        await ensureDeviceSchema(env);
        await env.DB.prepare("INSERT INTO sessions(id,user_id,token_hash,device_name,expires_at) VALUES(?,?,?,?,datetime('now','+30 days'))").bind(sessionId,u.id,await sha(token),clean(d.deviceName).slice(0,80)||'Browser').run();
        await logDeviceLogin(env,sessionId,u.id,request.headers.get('User-Agent'));
        const r=reply({ok:true,user:publicUser(u,env)});r.headers.set('Set-Cookie',sessionCookie(token,30*86400));return r;
      }
      if(path==='/api/auth/forgot'){
        if(!await limit(request,env,'forgot',3))return reply({error:'Terlalu banyak percobaan. Coba lagi nanti.'},429);
        if(!await turnstile(d.turnstileToken,env))return reply({error:'Verifikasi keamanan gagal.'},403);
        const email=clean(d.email).toLowerCase();if(!EMAIL.test(email)||email.length>254)return reply({error:'Email tidak valid'},400);
        const u=await env.DB.prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE AND email_verified=1 LIMIT 1').bind(email).first();
        if(u){const token=await makeToken(env,u.id,'reset_password');await mail(env,email,'Reset password TemanChat',`Untuk mengganti password, buka:\nhttps://${HOST}/auth.html?reset=${token}\n\nTautan berlaku 30 menit. Abaikan jika tidak meminta.`)}
        return reply({ok:true,message:'Jika email terdaftar, tautan reset akan dikirim.'});
      }
      if(path==='/api/auth/reset'){
        if(!await limit(request,env,'reset',5))return reply({error:'Terlalu banyak percobaan.'},429);
        if(!await turnstile(d.turnstileToken,env))return reply({error:'Verifikasi keamanan gagal.'},403);
        if(typeof d.password!=='string'||d.password.length<8||d.password.length>128)return reply({error:'Password baru minimal 8 karakter.'},400);
        // Check token before expensive hashing; single-use enforced at consumption.
        const raw=d.token;if(typeof raw!=='string'||!/^[a-f0-9]{64}$/.test(raw))return reply({error:'Tautan reset tidak valid.'},400);
        const th=await sha(raw);
        const valid=await env.DB.prepare("SELECT id FROM auth_tokens WHERE token_hash=? AND purpose='reset_password' AND used_at IS NULL AND expires_at>datetime('now')").bind(th).first();
        if(!valid)return reply({error:'Tautan reset tidak berlaku.'},400);
        const pw=await passwordHash(d.password),row=await consumeToken(env,raw,'reset_password');
        if(!row)return reply({error:'Tautan sudah digunakan.'},400);
        await env.DB.batch([
          env.DB.prepare('UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(pw,row.user_id),
          env.DB.prepare('UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND revoked_at IS NULL').bind(row.user_id)
        ]);
        return reply({ok:true,message:'Password berhasil diganti. Silakan login kembali.'});
      }
      if(path==='/api/auth/email-change/request'){
        const me=await userSession(request,env);
        if(!me)return reply({error:'Silakan login kembali.'},401);
        if(!await limit(request,env,'change-email',3,me.id))return reply({error:'Terlalu banyak permintaan. Coba kembali dalam beberapa menit.'},429);
        const next=clean(d.newEmail).toLowerCase();
        const pwd=d.password;
        if(!EMAIL.test(next)||next.length>254)return reply({error:'Alamat email baru tidak valid.'},400);
        if(next===me.email.toLowerCase())return reply({error:'Alamat tersebut sudah digunakan sebagai email akun.'},400);
        if(typeof pwd!=='string'||pwd.length>128||!pwd.length)return reply({error:'Masukkan password akun.'},400);
        const existing=await env.DB.prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE LIMIT 1').bind(next).first();
        if(existing)return reply({error:'Alamat email baru sudah terdaftar.'},409);
        const credentials=await env.DB.prepare('SELECT password_hash FROM users WHERE id=? LIMIT 1').bind(me.id).first();
        if(!credentials||!await verifyPassword(pwd,credentials.password_hash))return reply({error:'Password akun salah.'},403);
        await ensureEmailChangeSchema(env);
        const token=random(32),hash=await sha(token);
        await env.DB.prepare(`INSERT INTO tc_pending_email_changes(user_id,new_email,token_hash,expires_at)
          VALUES(?,?,?,datetime('now','+30 minutes')) ON CONFLICT(user_id) DO UPDATE SET
          new_email=excluded.new_email,token_hash=excluded.token_hash,
          expires_at=excluded.expires_at,created_at=CURRENT_TIMESTAMP`)
          .bind(me.id,next,hash).run();
        const confirmedLink=`https://${HOST}/confirm-email.html?token=${token}`;
        const sent=await mail(env,next,'Konfirmasi perubahan email TemanChat',
          `Halo ${me.display_name}!\n\nAda permintaan mengganti alamat email TemanChat menjadi ${next}.\n\n`
          +`Buka tautan berikut dan tekan tombol Konfirmasi untuk melanjutkan:\n${confirmedLink}\n\n`
          +'Tautan berlaku selama 30 menit. Jangan bagikan tautan ini. Abaikan jika bukan Anda yang meminta.');
        if(!sent){await env.DB.prepare('DELETE FROM tc_pending_email_changes WHERE user_id=? AND token_hash=?')
          .bind(me.id,hash).run();return reply({error:'Email konfirmasi belum bisa dikirim. Coba lagi.'},503)}
        // Peringatan ke email lama; perubahan belum berlaku sampai verifikasi alamat baru.
        ctx?.waitUntil(mail(env,me.email,'Permintaan perubahan email TemanChat',
          `Ada permintaan perubahan email akun @${me.username} ke alamat lain. Jika bukan Anda, segera ganti password akun TemanChat.`));
        return reply({ok:true,message:'Tautan konfirmasi dikirim ke alamat email baru. Email lama tetap aktif sampai konfirmasi.'});
      }
      if(path==='/api/auth/email-change/confirm'){
        if(!await limit(request,env,'email-confirm',12))return reply({error:'Terlalu banyak percobaan. Coba lagi nanti.'},429);
        if(typeof d.token!=='string'||!/^[0-9a-f]{64}$/.test(d.token))return reply({error:'Tautan tidak valid.'},400);
        await ensureEmailChangeSchema(env);
        const hash=await sha(d.token);
        // Token dikonsumsi dengan DELETE RETURNING, sehingga link tidak dapat digunakan dua kali.
        const pending=await env.DB.prepare(`DELETE FROM tc_pending_email_changes
          WHERE token_hash=? AND expires_at>datetime('now') RETURNING user_id,new_email`)
          .bind(hash).first();
        if(!pending)return reply({error:'Tautan sudah digunakan atau kedaluwarsa.'},400);
        const before=await env.DB.prepare('SELECT email,username FROM users WHERE id=? LIMIT 1').bind(pending.user_id).first();
        if(!before)return reply({error:'Akun tidak ditemukan.'},404);
        try{
          await env.DB.batch([
            env.DB.prepare('UPDATE users SET email=?,email_verified=1,updated_at=CURRENT_TIMESTAMP WHERE id=?')
              .bind(pending.new_email,pending.user_id),
            env.DB.prepare('UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND revoked_at IS NULL')
              .bind(pending.user_id)
          ]);
        }catch{return reply({error:'Alamat email tidak dapat digunakan. Minta tautan baru dari Pengaturan.'},409)}
        // Langganan push lama ditiadakan agar perangkat yang sudah logout tidak menerima informasi.
        const pushTable=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tc_push_subscriptions'").first();
        if(pushTable)await env.DB.prepare('DELETE FROM tc_push_subscriptions WHERE user_id=?').bind(pending.user_id).run();
        ctx?.waitUntil(mail(env,before.email,'Email TemanChat telah diubah',
          `Email login untuk akun @${before.username} telah diganti. Jika Anda tidak melakukan ini, segera hubungi pengelola TemanChat.`));
        return reply({ok:true,message:'Email berhasil diubah. Semua sesi lama telah keluar. Silakan login menggunakan email baru.'});
      }
      if(path==='/api/auth/avatar'){
        const me=await userSession(request,env);
        if(!me)return reply({error:'Sesi tidak tersedia.'},401);
        if(!await limit(request,env,'avatar-upload',30,me.id))return reply({error:'Terlalu sering mengganti foto. Coba sebentar lagi.'},429);
        await ensureAvatarSchema(env);
        // null = hapus foto. Semua foto yang masuk sudah dikecilkan dan dikonversi ke JPEG oleh canvas.
        if(d.dataUrl===null){
          await env.DB.prepare('DELETE FROM tc_profile_avatars WHERE user_id=?').bind(me.id).run();
          return reply({ok:true,removed:true});
        }
        if(typeof d.dataUrl!=='string'||d.dataUrl.length>85000||
           !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(d.dataUrl))
          return reply({error:'Format foto tidak valid. Gunakan foto JPG kecil.'},400);
        let bytes;try{bytes=atob(d.dataUrl.slice('data:image/jpeg;base64,'.length));}
        catch{return reply({error:'Data foto rusak.'},400)}
        if(bytes.length<200||bytes.length>60000||bytes.charCodeAt(0)!==255||bytes.charCodeAt(1)!==216||
           bytes.charCodeAt(2)!==255||bytes.charCodeAt(bytes.length-2)!==255||bytes.charCodeAt(bytes.length-1)!==217)
          return reply({error:'Foto terlalu besar atau bukan JPEG yang valid.'},400);
        await env.DB.prepare(`INSERT INTO tc_profile_avatars(user_id,image_b64,updated_at)
          VALUES(?,?,CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET image_b64=excluded.image_b64,updated_at=CURRENT_TIMESTAMP`)
          .bind(me.id,d.dataUrl.slice('data:image/jpeg;base64,'.length)).run();
        return reply({ok:true});
      }
      if(path==='/api/auth/profile'){
        const me=await userSession(request,env);
        if(!me)return reply({error:'Sesi tidak tersedia.'},401);
        const name=clean(d.displayName);
        if(name.length<2||name.length>60||/[\x00-\x1f\x7f]/.test(name))return reply({error:'Nama panggilan harus 2–60 karakter.'},400);
        await env.DB.prepare('UPDATE users SET display_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(name,me.id).run();
        return reply({ok:true,user:{...publicUser(me,env),display_name:name}});
      }
      if(path==='/api/auth/devices/revoke'){
        const me=await userSession(request,env);
        if(!me)return reply({error:'Silakan login kembali.'},401);
        if(!await limit(request,env,'revoke-device',6,me.id))return reply({error:'Terlalu banyak percobaan. Coba lagi dalam 10 menit.'},429);
        if(typeof d.password!=='string'||d.password.length<8||d.password.length>128)return reply({error:'Masukkan sandi akun yang benar.'},400);
        const credentials=await env.DB.prepare('SELECT password_hash FROM users WHERE id=? LIMIT 1').bind(me.id).first();
        if(!credentials||!await verifyPassword(d.password,credentials.password_hash))return reply({error:'Sandi akun salah.'},403);
        await ensureDeviceSchema(env);
        if(!await revokeDevice(env,me,d.sessionId))return reply({error:'Sesi perangkat tidak ditemukan atau sudah keluar. Perbarui daftar.'},404);
        return reply({ok:true,message:'Perangkat berhasil dikeluarkan. Sesi login perangkat tersebut telah dicabut.'});
      }
      if(path==='/api/auth/logout'){
        const t=cookie(request,'tc_session');if(t&&/^[0-9a-f]{64}$/.test(t))await env.DB.prepare('UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?').bind(await sha(t)).run();
        const r=reply({ok:true});r.headers.set('Set-Cookie',sessionCookie('',0));return r;
      }
    }

    if(path==='/api/auth/devices'&&request.method==='GET'){
      const me=await userSession(request,env);
      if(!me)return reply({error:'Silakan login kembali.'},401);
      await touchDevice(env,me,request.headers.get('User-Agent'));
      return reply({ok:true,devices:await listDevices(env,me)});
    }
    if(path.startsWith('/api/push/')){
      const me=await userSession(request,env);
      return await pushApi(request,env,me);
    }
    if(path==='/api/presence/heartbeat'&&request.method==='POST'){
      const me=await userSession(request,env);
      if(!me)return reply({error:'Silakan masuk kembali.'},401);
      if(!allowOrigin(request))return reply({error:'Origin tidak diizinkan.'},403);
      await touchDevice(env,me,request.headers.get('User-Agent'));
      await ensurePresenceSchema(env);
      await env.DB.prepare(`INSERT INTO tc_user_presence(user_id,last_active_at)
        VALUES(?,CAST(strftime('%s','now') AS INTEGER))
        ON CONFLICT(user_id) DO UPDATE SET last_active_at=excluded.last_active_at`).bind(me.id).run();
      return reply({ok:true});
    }
    // V5: API pesan. Selalu memerlukan sesi aktif dan keanggotaan chat.
    if(path.startsWith('/api/chat/')){
      const me=await userSession(request,env);
      if(!me)return reply({error:'Silakan masuk kembali.'},401);
      if(request.method==='POST'&&!allowOrigin(request))return reply({error:'Origin tidak diizinkan.'},403);
      // Status mengetik aman untuk percakapan 1:1: hanya anggota yang boleh mengakses.
      // Berlaku maksimal 9 detik tanpa pembaruan, sehingga tidak ada status tersangkut.
      if(path==='/api/chat/typing'&&(request.method==='POST'||request.method==='GET')){
        let id,isTyping;
        if(request.method==='POST'){
          let d;try{d=await readJSON(request)}catch{return reply({error:'Permintaan tidak valid'},400)}
          id=clean(d.conversationId);isTyping=d.isTyping;
          if(typeof isTyping!=='boolean')return reply({error:'Status mengetik tidak valid'},400);
        }else id=clean(url.searchParams.get('conversationId'));
        if(!/^[0-9a-f-]{36}$/.test(id))return reply({error:'Percakapan tidak valid'},400);
        const chat=await env.DB.prepare('SELECT user_a,user_b FROM tc_direct_chats WHERE id=? AND (user_a=? OR user_b=?)')
          .bind(id,me.id,me.id).first();
        if(!chat)return reply({error:'Percakapan tidak ditemukan.'},404);
        await ensureTypingSchema(env);
        if(request.method==='GET'){
          const other=chat.user_a===me.id?chat.user_b:chat.user_a;
          const state=await env.DB.prepare(`SELECT 1 AS active FROM tc_chat_typing
            WHERE chat_id=? AND user_id=? AND expires_at>CAST(strftime('%s','now') AS INTEGER)`)
            .bind(id,other).first();
          return reply({ok:true,typing:!!state});
        }
        if(isTyping){
          // Hindari penulisan berlebihan: setiap heartbeat hanya memperbarui bila mendekati kedaluwarsa.
          await env.DB.prepare(`INSERT INTO tc_chat_typing(chat_id,user_id,expires_at)
            VALUES(?,?,CAST(strftime('%s','now') AS INTEGER)+9)
            ON CONFLICT(chat_id,user_id) DO UPDATE SET expires_at=excluded.expires_at
            WHERE tc_chat_typing.expires_at<CAST(strftime('%s','now') AS INTEGER)+5`)
            .bind(id,me.id).run();
        }else{
          await env.DB.prepare('DELETE FROM tc_chat_typing WHERE chat_id=? AND user_id=?')
            .bind(id,me.id).run();
        }
        return reply({ok:true});
      }
      if(path==='/api/chat/people'&&request.method==='GET'){
        const q=clean(url.searchParams.get('q')).toLowerCase();
        if(!/^[a-z0-9_]{2,24}$/.test(q))return reply({ok:true,people:[]});
        await ensurePresenceSchema(env);
        const found=await env.DB.prepare(`SELECT u.username,u.display_name,
          p.last_active_at,
          CASE WHEN p.last_active_at>=CAST(strftime('%s','now') AS INTEGER)-${PRESENCE_OFFLINE_SECONDS}
            THEN 1 ELSE 0 END AS is_online
          FROM users u LEFT JOIN tc_user_presence p ON p.user_id=u.id
          WHERE u.email_verified=1 AND u.id!=? AND u.username LIKE ?
          ORDER BY u.username LIMIT 15`).bind(me.id,q+'%').all();
        const admin=env.TC_CALL_ADMIN_EMAIL?await env.DB.prepare('SELECT username FROM users WHERE email=? COLLATE NOCASE LIMIT 1').bind(String(env.TC_CALL_ADMIN_EMAIL).trim()).first():null;
        return reply({ok:true,people:found.results.map(u=>({...u,is_admin:Number(u.username===admin?.username)}))});
      }
      if(path==='/api/chat/start'&&request.method==='POST'){
        let d;try{d=await readJSON(request)}catch{return reply({error:'Permintaan tidak valid'},400)}
        const uname=clean(d.username).toLowerCase();
        if(!/^[a-z0-9_]{3,24}$/.test(uname))return reply({error:'Username tidak valid.'},400);
        if(!await limit(request,env,'chat-start',30))return reply({error:'Terlalu banyak permintaan.'},429);
        const other=await env.DB.prepare('SELECT id FROM users WHERE username=? AND email_verified=1 LIMIT 1').bind(uname).first();
        if(!other||other.id===me.id)return reply({error:'Pengguna tidak ditemukan.'},404);
        const ids=[me.id,other.id].sort(),pair=ids.join(':');
        await env.DB.prepare('INSERT INTO tc_direct_chats(id,pair_key,user_a,user_b) VALUES(?,?,?,?) ON CONFLICT(pair_key) DO NOTHING').bind(crypto.randomUUID(),pair,ids[0],ids[1]).run();
        const chat=await env.DB.prepare('SELECT id FROM tc_direct_chats WHERE pair_key=?').bind(pair).first();
        return reply({ok:true,conversationId:chat.id});
      }
      if(path==='/api/chat/conversations'&&request.method==='GET'){
        await ensurePresenceSchema(env);
        await ensureTypingSchema(env);
        await deliveredWhileOnline(env,me.id);
        const result=await env.DB.prepare(`SELECT c.id, c.created_at,
          u.username AS other_username,u.display_name AS other_name,
          p.last_active_at,
          CASE WHEN p.last_active_at>=CAST(strftime('%s','now') AS INTEGER)-${PRESENCE_OFFLINE_SECONDS}
            THEN 1 ELSE 0 END AS is_online,
          (EXISTS(SELECT 1 FROM tc_chat_typing t WHERE t.chat_id=c.id AND t.user_id=u.id
             AND t.expires_at>CAST(strftime('%s','now') AS INTEGER))) AS is_typing,
          (SELECT m.body FROM tc_direct_messages m WHERE m.chat_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
          (SELECT m.created_at FROM tc_direct_messages m WHERE m.chat_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_time,
          (SELECT m.sender_id FROM tc_direct_messages m WHERE m.chat_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_sender_id,
          (SELECT m.id FROM tc_direct_messages m WHERE m.chat_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message_id,
          (SELECT COUNT(*) FROM tc_direct_messages incoming
            WHERE incoming.chat_id=c.id AND incoming.sender_id<>?
              AND incoming.id>COALESCE((SELECT receipt.read_id FROM tc_chat_receipts receipt
                WHERE receipt.chat_id=c.id AND receipt.user_id=?),0)) AS unread_count,
          (EXISTS(SELECT 1 FROM tc_direct_messages own_msg
             WHERE own_msg.chat_id=c.id AND own_msg.sender_id=?)
           AND EXISTS(SELECT 1 FROM tc_direct_messages other_msg
             WHERE other_msg.chat_id=c.id AND other_msg.sender_id=u.id)) AS call_unlocked
          FROM tc_direct_chats c
          JOIN users u ON u.id=CASE WHEN c.user_a=? THEN c.user_b ELSE c.user_a END
          LEFT JOIN tc_user_presence p ON p.user_id=u.id
          WHERE c.user_a=? OR c.user_b=?
          ORDER BY COALESCE(last_time,c.created_at) DESC LIMIT 100`).bind(me.id,me.id,me.id,me.id,me.id,me.id).all();
        const admin=env.TC_CALL_ADMIN_EMAIL?await env.DB.prepare('SELECT username FROM users WHERE email=? COLLATE NOCASE LIMIT 1').bind(String(env.TC_CALL_ADMIN_EMAIL).trim()).first():null;
        return reply({ok:true,conversations:result.results.map(c=>({...c,other_is_admin:Number(c.other_username===admin?.username)}))});
      }
      if(path==='/api/chat/messages'&&request.method==='GET'){
        await ensureReceiptSchema(env);
        const id=clean(url.searchParams.get('conversationId'));
        const after=Number(url.searchParams.get('after')||0);
        if(!/^[0-9a-f-]{36}$/.test(id)||!Number.isSafeInteger(after)||after<0)return reply({error:'Parameter tidak valid.'},400);
        const access=await env.DB.prepare('SELECT id,user_a,user_b FROM tc_direct_chats WHERE id=? AND (user_a=? OR user_b=?)').bind(id,me.id,me.id).first();
        if(!access)return reply({error:'Percakapan tidak ditemukan.'},404);
        await deliveredWhileOnline(env,me.id,id);
        const partnerId=access.user_a===me.id?access.user_b:access.user_a;
        const receipt=await env.DB.prepare('SELECT delivered_id,read_id FROM tc_chat_receipts WHERE chat_id=? AND user_id=?').bind(id,partnerId).first();
        let mediaSchemaReady=true;
        try { await ensureExtras(env); }
        catch(e) { mediaSchemaReady=false; console.error('Schema media unavailable, serving text-only',e?.message); }
        await ensureReplySchema(env);
        const replyProjection=`,r.reply_to_id,original.body AS reply_body,original.sender_id AS reply_sender_id
          FROM tc_direct_messages m LEFT JOIN tc_reply_links r ON r.message_id=m.id
          LEFT JOIN tc_direct_messages original ON original.id=r.reply_to_id AND original.chat_id=m.chat_id`;
        const projection=mediaSchemaReady
          ? 'SELECT m.id,m.sender_id,m.body,m.created_at,l.media_id,f.mime_type'+replyProjection+' LEFT JOIN tc_media_links l ON l.message_id=m.id LEFT JOIN tc_media_items f ON f.id=l.media_id'
          : 'SELECT m.id,m.sender_id,m.body,m.created_at'+replyProjection;
        const sql=after>0
          ? projection+' WHERE m.chat_id=? AND m.id>? ORDER BY m.id ASC LIMIT 100'
          : projection+' WHERE m.id IN (SELECT id FROM tc_direct_messages WHERE chat_id=? ORDER BY id DESC LIMIT 100) ORDER BY m.id ASC';
        const statement=env.DB.prepare(sql);
        const r=after>0?await statement.bind(id,after).all():await statement.bind(id).all();
        return reply({ok:true,messages:r.results.map(m=>({...m,delivery_status:m.sender_id!==me.id?null:Number(receipt?.read_id||0)>=m.id?'read':Number(receipt?.delivered_id||0)>=m.id?'delivered':'sent'})),partnerReceipt:{deliveredId:receipt?.delivered_id||0,readId:receipt?.read_id||0}});
      }
      if(path==='/api/chat/receipt'&&request.method==='GET'){
        const id=clean(url.searchParams.get('conversationId'));
        if(!/^[0-9a-f-]{36}$/.test(id))return reply({error:'ID tidak valid'},400);
        const c=await env.DB.prepare('SELECT user_a,user_b FROM tc_direct_chats WHERE id=? AND (user_a=? OR user_b=?)').bind(id,me.id,me.id).first();
        if(!c)return reply({error:'Percakapan tidak ditemukan.'},404);
        await ensureReceiptSchema(env);
        const other=c.user_a===me.id?c.user_b:c.user_a;
        const state=await env.DB.prepare('SELECT delivered_id,read_id FROM tc_chat_receipts WHERE chat_id=? AND user_id=?').bind(id,other).first();
        return reply({ok:true,deliveredId:state?.delivered_id||0,readId:state?.read_id||0});
      }
      // V6.7: pengakuan pengiriman dari Service Worker penerima yang sah.
      // Tidak menandai dibaca dan tidak menerima ID pesan milik pengirim sendiri.
      if(path==='/api/chat/push-delivered'&&request.method==='POST'){
        let d;try{d=await readJSON(request,1500)}catch{return reply({error:'Parameter tidak valid'},400)}
        const id=clean(d.conversationId),messageId=Number(d.messageId);
        if(!/^[0-9a-f-]{36}$/.test(id)||!Number.isSafeInteger(messageId)||messageId<1)return reply({error:'ID tidak valid'},400);
        const valid=await env.DB.prepare(`SELECT m.id FROM tc_direct_messages m
          JOIN tc_direct_chats c ON c.id=m.chat_id
          WHERE m.id=? AND m.chat_id=? AND m.sender_id<>? AND (c.user_a=? OR c.user_b=?)`)
          .bind(messageId,id,me.id,me.id,me.id).first();
        if(!valid)return reply({error:'Pesan tidak ditemukan'},404);
        await ensureReceiptSchema(env);
        await env.DB.prepare(`INSERT INTO tc_chat_receipts(chat_id,user_id,delivered_id) VALUES(?,?,?)
          ON CONFLICT(chat_id,user_id) DO UPDATE SET delivered_id=MAX(tc_chat_receipts.delivered_id,excluded.delivered_id),updated_at=CURRENT_TIMESTAMP`)
          .bind(id,me.id,messageId).run();
        return reply({ok:true,deliveredId:messageId});
      }
      if(path==='/api/chat/read'&&request.method==='POST'){
        let d;try{d=await readJSON(request)}catch{return reply({error:'Permintaan tidak valid'},400)}
        const id=clean(d.conversationId),last=Number(d.lastMessageId);
        if(!/^[0-9a-f-]{36}$/.test(id)||!Number.isSafeInteger(last)||last<1)return reply({error:'Parameter tidak valid'},400);
        const c=await env.DB.prepare('SELECT id FROM tc_direct_chats WHERE id=? AND (user_a=? OR user_b=?)').bind(id,me.id,me.id).first();
        if(!c)return reply({error:'Percakapan tidak ditemukan.'},404);
        await ensureReceiptSchema(env);
        const row=await env.DB.prepare('SELECT MAX(id) AS id FROM tc_direct_messages WHERE chat_id=? AND sender_id<>? AND id<=?').bind(id,me.id,last).first();
        const readId=Number(row?.id||0);
        if(readId>0)await env.DB.prepare(`INSERT INTO tc_chat_receipts(chat_id,user_id,delivered_id,read_id)
          VALUES(?,?,?,?) ON CONFLICT(chat_id,user_id) DO UPDATE SET
          delivered_id=MAX(tc_chat_receipts.delivered_id,excluded.delivered_id),
          read_id=MAX(tc_chat_receipts.read_id,excluded.read_id),updated_at=CURRENT_TIMESTAMP`).bind(id,me.id,readId,readId).run();
        return reply({ok:true,readId});
      }
      if(path==='/api/chat/send'&&request.method==='POST'){
        let d;try{d=await readJSON(request)}catch{return reply({error:'Permintaan tidak valid'},400)}
        const id=clean(d.conversationId),body=typeof d.body==='string'?d.body.trim():'';
        if(!/^[0-9a-f-]{36}$/.test(id)||!body||body.length>1000)return reply({error:'Pesan wajib diisi, maksimal 1000 karakter.'},400);
        const access=await env.DB.prepare('SELECT id,user_a,user_b FROM tc_direct_chats WHERE id=? AND (user_a=? OR user_b=?)').bind(id,me.id,me.id).first();
        if(!access)return reply({error:'Percakapan tidak ditemukan.'},404);
        // V6.7: 100 pesan/menit, maksimal 50 pesan identik/menit, burst 10/5 detik.
        // Buckets berbasis akun agar pergantian IP tidak menghindari batas.
        const now=Date.now();
        const rate=async(kind,bucket,maximum)=>{
          const key=await sha('tc67|'+me.id+'|'+kind+'|'+bucket+'|'+env.TURNSTILE_SECRET_KEY);
          const item=await env.DB.prepare('INSERT INTO auth_rate_limits(key,attempts,created_at) VALUES(?,1,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(key).first();
          return Number(item?.attempts||0)<=maximum;
        };
        if(!await rate('all',Math.floor(now/60000),100))return reply({error:'Batas 100 pesan per menit. Coba lagi sebentar.'},429);
        if(!await rate('burst',Math.floor(now/5000),10))return reply({error:'Terlalu cepat. Tunggu beberapa detik sebelum mengirim lagi.'},429);
        const bodyHash=await sha(body.toLocaleLowerCase('id-ID'));
        if(!await rate('repeat:'+id+':'+bodyHash,Math.floor(now/60000),50))return reply({error:'Pesan sama sudah dikirim 50 kali dalam satu menit. Coba lagi nanti.'},429);
        let replyTo;
        try{replyTo=await validateReply(env,id,d.replyToId)}catch(e){return reply({error:e.message},400)}
        const sent=await env.DB.prepare('INSERT INTO tc_direct_messages(chat_id,sender_id,body) VALUES(?,?,?) RETURNING id,created_at').bind(id,me.id,body).first();
        if(replyTo)await storeReply(env,sent.id,id,replyTo);
        const recipientId=access.user_a===me.id?access.user_b:access.user_a;
        // Jumlah unread dari D1 agar angka badge bukan sekadar jumlah notifikasi yang diterima.
        await ensureReceiptSchema(env);
        const badgeRow=await env.DB.prepare(`SELECT COUNT(*) AS n FROM tc_direct_messages m
          JOIN tc_direct_chats c ON c.id=m.chat_id
          LEFT JOIN tc_chat_receipts r ON r.chat_id=m.chat_id AND r.user_id=?
          WHERE (c.user_a=? OR c.user_b=?) AND m.sender_id<>? AND m.id>COALESCE(r.read_id,0)`)
          .bind(recipientId,recipientId,recipientId,recipientId).first();
        ctx?.waitUntil(sendPush(env,recipientId,{title:'TemanChat',body:'Pesan baru dari '+me.display_name,
          url:'/?chat='+encodeURIComponent(id),tag:'tc-message-'+id+'-'+sent.id,kind:'message',
          conversationId:id,messageId:sent.id,unreadCount:Number(badgeRow?.n||0)},86400));
        return reply({ok:true,message:{id:sent.id,sender_id:me.id,body,created_at:sent.created_at,reply_to_id:replyTo?.id||null,reply_body:replyTo?.body||null,reply_sender_id:replyTo?.sender_id||null}});
      }
      return reply({error:'Endpoint chat tidak ditemukan.'},404);
    }
    if(path.startsWith('/api/google/')) {
      const me=await userSession(request,env);
      return await handleGoogle(request,env,me);
    }
    if(path.startsWith('/api/media/')||path.startsWith('/api/calls/')) {
      const me=await userSession(request,env);
      const extra=await handleExtra(request,env,me,{readJSON,limit,allowOrigin,sendPush:(user,payload,ttl)=>ctx?.waitUntil(sendPush(env,user,payload,ttl)),sendCallAlerts:(user,payload)=>ctx?.waitUntil(sendRingingCallPushes(env,user,payload))});
      if(extra)return extra;
    }
    if(path.startsWith('/api/'))return reply({error:'Endpoint tidak ditemukan'},404);
    return env.ASSETS.fetch(request);
  }catch(err){
    const errorId=crypto.randomUUID();
    console.error('TemanChat internal error', {errorId, path, name:err?.name, message:err?.message, stack:err?.stack});
    return reply({error:'Terjadi masalah server.',errorId},500);
  }
 },
 async scheduled(event,env,ctx){
   ctx.waitUntil((async()=>{
    // Tiap menit: panggilan tidak dijawab ditandai sekali; trigger hanya pada perubahan status.
    if(event.cron==='* * * * *'){
      await ensureExtras(env);
      const missed=await env.DB.prepare(`UPDATE tc_call_sessions SET status='missed',updated_at=CURRENT_TIMESTAMP
        WHERE status='ringing' AND created_at<datetime('now','-30 seconds')
        RETURNING id,callee_id,caller_id,chat_id`).all();
      for(const c of missed.results){
        const caller=await env.DB.prepare('SELECT display_name FROM users WHERE id=?').bind(c.caller_id).first();
        await sendPush(env,c.callee_id,{kind:'call_end',callId:c.id,tag:'tc-call-'+c.id},60);
        await sendPush(env,c.callee_id,{kind:'missed_call',callId:c.id,title:'Panggilan tak terjawab',body:'Panggilan dari '+(caller?.display_name||'Teman'),url:'/?chat='+c.chat_id,tag:'tc-missed-'+c.id},86400);
      }
    }else await cleanup(env);
   })());
  }
};
