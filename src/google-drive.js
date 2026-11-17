// TemanChat: akun Google Drive pribadi, OAuth authorization-code + PKCE.
// Semua token dienkripsi dengan AES-GCM, kunci diturunkan dari GOOGLE_CLIENT_SECRET.
const ORIGIN='https://chat.ege.my.id';
const SCOPE='https://www.googleapis.com/auth/drive.file';
const textEncoder=new TextEncoder();
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const bytesToBase64Url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const fromBase64Url=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
const random=()=>bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
const digest=async s=>bytesToBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256',textEncoder.encode(s))));
let keyPromise;
async function aesKey(env){
 if(!env.GOOGLE_CLIENT_SECRET)throw Error('Google OAuth belum dikonfigurasi');
 // Tidak menyimpan key ke file/response.
 if(!keyPromise)keyPromise=(async()=>{
  const input=await crypto.subtle.importKey('raw',textEncoder.encode(env.GOOGLE_CLIENT_SECRET),'HKDF',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:textEncoder.encode('temanchat-drive-key-v1'),info:textEncoder.encode('google-oauth-tokens')},input,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 })();
 return keyPromise;
}
async function encrypt(env,uid,text){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const buf=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:textEncoder.encode(uid)},await aesKey(env),textEncoder.encode(text));
 return bytesToBase64Url(iv)+'.'+bytesToBase64Url(new Uint8Array(buf));
}
async function decrypt(env,uid,packed){
 const [iv,ct]=String(packed).split('.');
 if(!iv||!ct)throw Error('Token tersimpan tidak valid');
 const buf=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64Url(iv),additionalData:textEncoder.encode(uid)},await aesKey(env),fromBase64Url(ct));
 return new TextDecoder().decode(buf);
}
let schemaPromise;
export async function ensureGoogleSchema(env){
 if(!schemaPromise)schemaPromise=(async()=>{
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS tc_google_oauth_states (
   state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_hash TEXT NOT NULL,
   code_verifier TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS tc_google_drive_accounts (
   user_id TEXT PRIMARY KEY, access_token TEXT NOT NULL, refresh_token TEXT NOT NULL,
   expires_at INTEGER NOT NULL, connected_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`).run();
 })().catch(e=>{schemaPromise=null;throw e});
 return schemaPromise;
}
async function sessionHash(req){
 const token=(req.headers.get('Cookie')||'').match(/(?:^|;\s*)tc_session=([0-9a-f]{64})(?:;|$)/)?.[1];
 return token?digest(token):null;
}
const redirect=(path)=>new Response(null,{status:302,headers:{Location:ORIGIN+path,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
async function tokensFromGoogle(env,body){
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,...body})});
 const d=await r.json().catch(()=>({}));
 if(!r.ok||!d.access_token)throw Error('Google OAuth gagal (HTTP '+r.status+')');
 return d;
}
async function saveCredentials(env,uid,tokens,existingRefresh){
 const refresh=tokens.refresh_token||existingRefresh;
 if(!refresh)throw Error('Google belum memberikan izin offline. Putuskan akses TemanChat dari Akun Google lalu hubungkan kembali.');
 const now=Math.floor(Date.now()/1000);
 await env.DB.prepare(`INSERT INTO tc_google_drive_accounts (user_id,access_token,refresh_token,expires_at,connected_at,updated_at)
  VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
  access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,updated_at=excluded.updated_at`)
  .bind(uid,await encrypt(env,uid,tokens.access_token),await encrypt(env,uid,refresh),now+Math.max(60,Number(tokens.expires_in)||3600),now,now).run();
}
export async function googleAccessToken(env,uid){
 await ensureGoogleSchema(env);
 const rec=await env.DB.prepare('SELECT * FROM tc_google_drive_accounts WHERE user_id=?').bind(uid).first();
 if(!rec)throw Error('Hubungkan Google Drive di Pengaturan terlebih dahulu.');
 if(rec.expires_at>Math.floor(Date.now()/1000)+90)return decrypt(env,uid,rec.access_token);
 const refresh=await decrypt(env,uid,rec.refresh_token);
 const tokens=await tokensFromGoogle(env,{grant_type:'refresh_token',refresh_token:refresh});
 await saveCredentials(env,uid,tokens,refresh);
 return tokens.access_token;
}
export async function handleGoogle(req,env,me){
 const url=new URL(req.url),path=url.pathname;
 if(!path.startsWith('/api/google/'))return null;
 const callback=path==='/api/google/callback';
 if(!me)return callback?redirect('/?drive=login'):json({error:'Silakan login kembali.'},401);
 if(!env.DB||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)return json({error:'Google Drive belum dikonfigurasi.'},503);
 await ensureGoogleSchema(env);
 if(path==='/api/google/status'&&req.method==='GET'){
  const item=await env.DB.prepare('SELECT connected_at,expires_at FROM tc_google_drive_accounts WHERE user_id=?').bind(me.id).first();
  let accountEmail=null,accountName=null,accountWarning=null;
  if(item){
   try{
    // Drive about.get bisa diakses dengan izin drive.file yang SUDAH ada.
    // Tidak perlu meminta scope email tambahan atau menyimpan email di D1.
    const token=await googleAccessToken(env,me.id);
    const r=await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)',{
     headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw Error('HTTP '+r.status);
    const about=await r.json();
    accountEmail=typeof about.user?.emailAddress==='string'?about.user.emailAddress:null;
    accountName=typeof about.user?.displayName==='string'?about.user.displayName:null;
   }catch(error){console.warn('Drive account info',error?.message);accountWarning='Identitas akun belum dapat diperiksa. Coba muat ulang.';}
  }
  return json({ok:true,configured:true,connected:!!item,connectedAt:item?.connected_at||null,accountEmail,accountName,accountWarning});
 }
 if(path==='/api/google/connect'&&req.method==='GET'){
  const sh=await sessionHash(req);if(!sh)return json({error:'Sesi tidak valid.'},401);
  const state=random(),verifier=random(),now=Math.floor(Date.now()/1000);
  await env.DB.prepare('DELETE FROM tc_google_oauth_states WHERE expires_at<?').bind(now).run();
  await env.DB.prepare('INSERT INTO tc_google_oauth_states(state_hash,user_id,session_hash,code_verifier,created_at,expires_at) VALUES(?,?,?,?,?,?)')
   .bind(await digest(state),me.id,await sh,verifier,now,now+600).run();
  const params=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:ORIGIN+'/api/google/callback',response_type:'code',scope:SCOPE,state,access_type:'offline',prompt:'consent',code_challenge:await digest(verifier),code_challenge_method:'S256',include_granted_scopes:'false'});
  return new Response(null,{status:302,headers:{Location:'https://accounts.google.com/o/oauth2/v2/auth?'+params,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 }
 if(callback&&req.method==='GET'){
  if(url.searchParams.get('error'))return redirect('/?drive=cancelled');
  const state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'';
  if(state.length<20||state.length>256||code.length<10||code.length>2048)return redirect('/?drive=invalid');
  const sh=await sessionHash(req);if(!sh)return redirect('/?drive=login');
  const row=await env.DB.prepare('SELECT * FROM tc_google_oauth_states WHERE state_hash=? AND user_id=? AND session_hash=? AND expires_at>?')
    .bind(await digest(state),me.id,await sh,Math.floor(Date.now()/1000)).first();
  if(!row)return redirect('/?drive=expired');
  const deleted=await env.DB.prepare('DELETE FROM tc_google_oauth_states WHERE state_hash=? AND user_id=? AND session_hash=?')
    .bind(await digest(state),me.id,await sh).run();
  if(!deleted.meta.changes)return redirect('/?drive=expired');
  try{
   const t=await tokensFromGoogle(env,{grant_type:'authorization_code',code,redirect_uri:ORIGIN+'/api/google/callback',code_verifier:row.code_verifier});
   // Lingkup harus sesuai izin minimal yang kita harapkan.
   if(t.scope&&!t.scope.split(' ').includes(SCOPE))return redirect('/?drive=scope');
   await saveCredentials(env,me.id,t);
   return redirect('/?drive=connected');
  }catch(e){console.error('Google OAuth callback failure',e?.message);return redirect('/?drive=failed');}
 }
 if(path==='/api/google/disconnect'&&req.method==='POST'){
  if(req.headers.get('Origin')!==ORIGIN)return json({error:'Origin ditolak.'},403);
  const token=await env.DB.prepare('SELECT access_token FROM tc_google_drive_accounts WHERE user_id=?').bind(me.id).first();
  await env.DB.prepare('DELETE FROM tc_google_drive_accounts WHERE user_id=?').bind(me.id).run();
  if(token){try{const access=await decrypt(env,me.id,token.access_token);await fetch('https://oauth2.googleapis.com/revoke?token='+encodeURIComponent(access),{method:'POST'});}catch{}}
  return json({ok:true,connected:false});
 }
 if(path==='/api/google/upload'&&req.method==='POST'){
  if(req.headers.get('Origin')!==ORIGIN)return json({error:'Origin ditolak.'},403);
  const len=Number(req.headers.get('content-length')||0);
  if(len>20*1024*1024)return json({error:'File harus berukuran maksimal 20 MB.'},413);
  const blob=await req.blob();if(!blob.size||blob.size>20*1024*1024)return json({error:'Ukuran file tidak didukung.'},413);
  let name='TemanChat-media';try{name=decodeURIComponent(req.headers.get('X-TC-File-Name')||name)}catch{}
  name='TemanChat_'+name.replace(/[\\/\r\n\0]/g,'_').slice(0,120);
  const boundary='tc-'+crypto.randomUUID();
  const meta={name};
  const payload=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${/^[\w.+-]+\/[\w.+-]+$/.test(blob.type)?blob.type:'application/octet-stream'}\r\n\r\n`,blob,`\r\n--${boundary}--\r\n`]);
  const token=await googleAccessToken(env,me.id);
  const out=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,md5Checksum,webViewLink',{
   method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'multipart/related; boundary='+boundary},body:payload
  });
  const data=await out.json().catch(()=>({}));
  if(!out.ok)return json({error:'Google Drive gagal menyimpan file (HTTP '+out.status+').'},502);
  if(!data.id||Number(data.size)!==blob.size)return json({error:'Ukuran file Drive tidak cocok. Silakan periksa Drive sebelum mengulang.'},502);
  return json({ok:true,fileId:data.id,name:data.name,size:Number(data.size),md5Checksum:data.md5Checksum||null});
 }
 if(path.startsWith('/api/google/download/')&&req.method==='GET'){
  const id=path.slice('/api/google/download/'.length);
  if(!/^[\w-]{10,200}$/.test(id))return json({error:'ID file tidak valid.'},400);
  const token=await googleAccessToken(env,me.id);
  const result=await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?alt=media',{headers:{Authorization:'Bearer '+token}});
  if(!result.ok)return json({error:'File tidak dapat dibuka dari Drive akun ini.'},result.status===404?404:502);
  return new Response(result.body,{headers:{'Content-Type':result.headers.get('Content-Type')||'application/octet-stream','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }
 return json({error:'Google API tidak tersedia'},404);
}
