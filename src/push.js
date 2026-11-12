// TemanChat V6.6 - Web Push RFC8291 + VAPID. Tidak menaruh secret di frontend.
// Cloudflare Workers WebCrypto native: ECDH, HMAC, AES-GCM, ECDSA P-256.
const enc = new TextEncoder();
const join = (...arr) => {const out=new Uint8Array(arr.reduce((n,x)=>n+x.length,0));let i=0;for(const a of arr){out.set(a,i);i+=a.length;}return out;};
const bytes = value => new Uint8Array(value);
const b64url = value => {let s='';for(const x of value)s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const from64 = str => {if(!/^[A-Za-z0-9_-]+$/.test(str))throw Error('base64url invalid');const s=atob(str.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-str.length%4)%4));return Uint8Array.from(s,c=>c.charCodeAt(0));};
const text = s => enc.encode(s);
const zero = new Uint8Array([0]);
const hexHash = async s => b64url(bytes(await crypto.subtle.digest('SHA-256',text(s))));
const json = (obj,status=200) => Response.json({ok:status<400,...obj},{status,headers:{'Cache-Control':'no-store'}});

let schemaPromise;
export async function ensurePushSchema(env){
 if(!schemaPromise)schemaPromise=env.DB.prepare(`CREATE TABLE IF NOT EXISTS tc_push_subscriptions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_success_at TEXT, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
 )`).run().then(()=>env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_tc_push_user ON tc_push_subscriptions(user_id)').run()).catch(e=>{schemaPromise=null;throw e});
 return schemaPromise;
}
function allowedEndpoint(raw){
 try{
  const u=new URL(raw);
  if(u.protocol!=='https:'||u.username||u.password||u.port||raw.length>1700)return false;
  const h=u.hostname.toLowerCase();
  // Batasi tujuan untuk mencegah SSRF via URL endpoint tersimpan.
  return h==='fcm.googleapis.com'||h==='updates.push.services.mozilla.com'||h==='push.services.mozilla.com'||h==='web.push.apple.com'||h.endsWith('.push.apple.com')||h.endsWith('.push.services.mozilla.com')||h==='android.googleapis.com';
 }catch{return false}
}
export async function pushApi(request,env,me){
 const path=new URL(request.url).pathname;
 if(!path.startsWith('/api/push/'))return null;
 if(!me)return json({error:'Masuk terlebih dahulu.'},401);
 if(path==='/api/push/config'&&request.method==='GET')return json({publicKey:env.VAPID_PUBLIC_KEY||'',configured:!!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY)});
 if(request.method!=='POST'||request.headers.get('Origin')!=='https://chat.ege.my.id')return json({error:'Permintaan tidak diizinkan.'},403);
 if(Number(request.headers.get('Content-Length')||0)>4096)return json({error:'Data terlalu besar.'},413);
 let body;try{body=await request.json()}catch{return json({error:'JSON tidak valid.'},400)}
 await ensurePushSchema(env);
 if(path==='/api/push/subscribe'){
  const p=body?.subscription;
  if(!p||!allowedEndpoint(p.endpoint)||typeof p.keys?.p256dh!=='string'||typeof p.keys?.auth!=='string')return json({error:'Langganan push tidak valid.'},400);
  try{if(from64(p.keys.p256dh).length!==65||from64(p.keys.auth).length!==16||!p.keys.p256dh.startsWith('B'))throw Error('bad')}catch{return json({error:'Kunci langganan tidak valid.'},400)}
  const id=await hexHash(p.endpoint);
  await env.DB.prepare(`INSERT INTO tc_push_subscriptions(id,user_id,endpoint,p256dh,auth) VALUES(?,?,?,?,?)
   ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth`).bind(id,me.id,p.endpoint,p.keys.p256dh,p.keys.auth).run();
  // Batas perangkat per akun; hapus yang paling lama agar DB tidak membengkak.
  await env.DB.prepare(`DELETE FROM tc_push_subscriptions WHERE user_id=? AND id NOT IN
  (SELECT id FROM tc_push_subscriptions WHERE user_id=? ORDER BY created_at DESC LIMIT 8)`).bind(me.id,me.id).run();
  return json({enabled:true});
 }
 if(path==='/api/push/unsubscribe'){
  const endpoint=String(body?.endpoint||'');
  if(!allowedEndpoint(endpoint))return json({error:'Endpoint tidak valid.'},400);
  await env.DB.prepare('DELETE FROM tc_push_subscriptions WHERE user_id=? AND endpoint=?').bind(me.id,endpoint).run();
  return json({enabled:false});
 }
 if(path==='/api/push/test'){
  // Tes hanya ke perangkat sendiri, tidak bisa spam pengguna lain.
  const row=await env.DB.prepare('SELECT id,endpoint,p256dh,auth FROM tc_push_subscriptions WHERE user_id=? ORDER BY created_at DESC LIMIT 1').bind(me.id).first();
  if(!row)return json({error:'Aktifkan notifikasi perangkat dahulu.'},400);
  const ok=await transmit(env,row,{title:'Tes TemanChat',body:'Notifikasi Web Push berhasil diterima!',url:'/',tag:'tc-test'},60);
  return json({sent:ok});
 }
 return json({error:'Tidak ditemukan.'},404);
}
async function hkdfExtract(key,data){const k=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);return bytes(await crypto.subtle.sign('HMAC',k,data));}
async function hkdfExpand(prk,info,len){const block=await hkdfExtract(prk,join(info,new Uint8Array([1])));return block.slice(0,len);}
async function encryptedPayload(sub,data){
 const receiver=from64(sub.p256dh),auth=from64(sub.auth);
 const kp=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const serverPub=bytes(await crypto.subtle.exportKey('raw',kp.publicKey));
 const ua=await crypto.subtle.importKey('raw',receiver,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const shared=bytes(await crypto.subtle.deriveBits({name:'ECDH',public:ua},kp.privateKey,256));
 const prkKey=await hkdfExtract(auth,shared);
 const ikm=await hkdfExpand(prkKey,join(text('WebPush: info'),zero,receiver,serverPub),32);
 const salt=crypto.getRandomValues(new Uint8Array(16));
 const prk=await hkdfExtract(salt,ikm);
 const cek=await hkdfExpand(prk,join(text('Content-Encoding: aes128gcm'),zero),16);
 const nonce=await hkdfExpand(prk,join(text('Content-Encoding: nonce'),zero),12);
 const key=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);
 const payload=join(text(JSON.stringify(data)),new Uint8Array([2]));
 const ciphertext=bytes(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,payload));
 const rs=new Uint8Array([0,0,16,0]); // RFC8188 record size = 4096, > payload + tag
 return join(salt,rs,new Uint8Array([serverPub.length]),serverPub,ciphertext);
}
async function vapidJwt(env,endpoint){
 const pub=from64(env.VAPID_PUBLIC_KEY),priv=from64(env.VAPID_PRIVATE_KEY);
 if(pub.length!==65||priv.length!==32)throw Error('VAPID key length invalid');
 const key=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:b64url(pub.slice(1,33)),y:b64url(pub.slice(33)),d:b64url(priv),ext:true},{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const aud=new URL(endpoint).origin;
 const jwtHead=b64url(text(JSON.stringify({typ:'JWT',alg:'ES256'})));
 const jwtBody=b64url(text(JSON.stringify({aud,exp:Math.floor(Date.now()/1000)+3600,sub:'mailto:noreply@temanchat.ege.my.id'})));
 const unsigned=jwtHead+'.'+jwtBody;
 const sig=bytes(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,text(unsigned)));
 // WebCrypto signature is IEEE-P1363 in Workers (64-byte R||S).
 if(sig.length!==64)throw Error('VAPID signature format invalid');
 return unsigned+'.'+b64url(sig);
}
async function transmit(env,row,payload,ttl=120){
 try{
  if(!allowedEndpoint(row.endpoint))return false;
  const body=await encryptedPayload(row,payload);
  const token=await vapidJwt(env,row.endpoint);
  const res=await fetch(row.endpoint,{method:'POST',headers:{'TTL':String(ttl),'Content-Type':'application/octet-stream','Content-Encoding':'aes128gcm','Authorization':`vapid t=${token}, k=${env.VAPID_PUBLIC_KEY}`},body,signal:AbortSignal.timeout(8000)});
  if(res.status===404||res.status===410){await env.DB.prepare('DELETE FROM tc_push_subscriptions WHERE id=?').bind(row.id).run();return false}
  if(res.ok){await env.DB.prepare('UPDATE tc_push_subscriptions SET last_success_at=CURRENT_TIMESTAMP WHERE id=?').bind(row.id).run();return true}
  console.warn('Push rejected',res.status);return false;
 }catch(e){console.warn('Web Push failed',e.message);return false;}
}
export async function sendPush(env,userId,payload,ttl=120){
 if(!env.VAPID_PRIVATE_KEY||!env.VAPID_PUBLIC_KEY||!userId)return;
 try{
  await ensurePushSchema(env);
  const rows=await env.DB.prepare('SELECT id,endpoint,p256dh,auth FROM tc_push_subscriptions WHERE user_id=? LIMIT 8').bind(userId).all();
  await Promise.allSettled(rows.results.map(r=>transmit(env,r,payload,ttl)));
 }catch(e){console.warn('Web push dispatch',e.message)}
}

// Internal helpers exposed only for local cryptographic tests (not HTTP).
export const _pushCryptoTest={encryptedPayload,vapidJwt,from64,b64url};
