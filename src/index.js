// TemanChat: auth backend v2. Chat and calls remain demo.
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
async function passwordHash(password,salt=random(16),rounds=120000){
  const key=await crypto.subtle.importKey('raw',TE.encode(password),'PBKDF2',false,['deriveBits']);
  const hash=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:Uint8Array.from(salt.match(/../g).map(x=>parseInt(x,16))),iterations:rounds},key,256);
  return `pbkdf2-sha256$${rounds}$${salt}$${hex(hash)}`;
}
async function verifyPassword(password,stored){
  const p=String(stored||'').split('$');
  if(p.length!==4||p[0]!=='pbkdf2-sha256'||!/^[0-9a-f]{32}$/.test(p[2])||!/^[0-9a-f]{64}$/.test(p[3]))return false;
  const rounds=Number(p[1]);if(!Number.isSafeInteger(rounds)||rounds<100000||rounds>500000)return false;
  const got=(await passwordHash(password,p[2],rounds)).split('$')[3];
  let diff=0;for(let i=0;i<64;i++)diff|=got.charCodeAt(i)^p[3].charCodeAt(i);return diff===0;
}
async function readJSON(req){
  if(!req.headers.get('content-type')?.toLowerCase().includes('application/json'))throw Error('format');
  if(Number(req.headers.get('content-length')||0)>12000)throw Error('size');
  const raw=await req.text();if(raw.length>12000)throw Error('size');
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
  return env.DB.prepare('SELECT u.id,u.username,u.email,u.display_name,u.email_verified FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>datetime(\'now\') AND u.email_verified=1 LIMIT 1').bind(await sha(token)).first();
}
const publicUser=u=>({id:u.id,username:u.username,email:u.email,display_name:u.display_name,email_verified:u.email_verified});
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
 async fetch(request,env){
  const url=new URL(request.url),path=url.pathname;
  try {
    if(path==='/api/health'&&request.method==='GET'){
      const rows=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      return reply({ok:true,app:'TemanChat',phase:'auth-v2',database:'connected',tables:rows.results.map(x=>x.name)});
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
    if(path==='/api/auth/config'&&request.method==='GET')return reply({siteKey:SITE_KEY,authReady:Boolean(env.DB&&env.RESEND_API_KEY&&env.TURNSTILE_SECRET_KEY)});
    if(path==='/api/auth/me'&&request.method==='GET'){
      const u=await userSession(request,env);return u?reply({ok:true,user:publicUser(u)}):reply({ok:false},401);
    }
    if(path==='/api/auth/verify'&&request.method==='GET'){
      const row=await consumeToken(env,url.searchParams.get('token'),'verify_email');
      if(!row)return new Response('Tautan verifikasi tidak berlaku atau sudah digunakan.',{status:400,headers:{'Cache-Control':'no-store'}});
      await env.DB.prepare('UPDATE users SET email_verified=1,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(row.user_id).run();
      return Response.redirect(`https://${HOST}/auth.html?verified=1`,303);
    }
    if(path.startsWith('/api/auth/')&&request.method==='POST'){
      if(!allowOrigin(request))return reply({error:'Origin tidak diizinkan'},403);
      let d;try{d=await readJSON(request)}catch{return reply({error:'Permintaan JSON tidak valid'},400)}
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
        const token=random();
        await env.DB.prepare("INSERT INTO sessions(id,user_id,token_hash,device_name,expires_at) VALUES(?,?,?,?,datetime('now','+30 days'))").bind(crypto.randomUUID(),u.id,await sha(token),clean(d.deviceName).slice(0,80)||'Browser').run();
        const r=reply({ok:true,user:publicUser(u)});r.headers.set('Set-Cookie',sessionCookie(token,30*86400));return r;
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
      if(path==='/api/auth/logout'){
        const t=cookie(request,'tc_session');if(t&&/^[0-9a-f]{64}$/.test(t))await env.DB.prepare('UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?').bind(await sha(t)).run();
        const r=reply({ok:true});r.headers.set('Set-Cookie',sessionCookie('',0));return r;
      }
    }
    if(path.startsWith('/api/'))return reply({error:'Endpoint tidak ditemukan'},404);
    return env.ASSETS.fetch(request);
  }catch(err){
    const errorId=crypto.randomUUID();
    console.error('TemanChat internal error', {errorId, path, name:err?.name, message:err?.message, stack:err?.stack});
    return reply({error:'Terjadi masalah server.',errorId},500);
  }
 }
};
