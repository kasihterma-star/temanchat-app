// TemanChat WhatsApp Cloud API PILOT: satu nomor tes bisnis, bukan sesi WhatsApp Web.
const j=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const enc=new TextEncoder();
function isAdmin(user,env){return !!(user?.email&&env.TC_CALL_ADMIN_EMAIL&&user.email.toLowerCase()===env.TC_CALL_ADMIN_EMAIL.trim().toLowerCase())}
const safeNumber=s=>/^\d{8,15}$/.test(String(s||''))?String(s):null;
let readyPromise;
async function ensure(env){
 if(!readyPromise)readyPromise=(async()=>{
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS tc_wa_permissions(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,enabled INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS tc_wa_messages(id TEXT PRIMARY KEY,phone TEXT NOT NULL,direction TEXT NOT NULL CHECK(direction IN ('in','out')),body TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,kind TEXT NOT NULL DEFAULT 'text')`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS tc_wa_messages_phone_time ON tc_wa_messages(phone,created_at DESC)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS tc_wa_send_limits(user_id TEXT NOT NULL,minute_slot INTEGER NOT NULL,cnt INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,minute_slot))`).run();
 })().catch(e=>{readyPromise=null;throw e});return readyPromise;
}
function configured(env){return Boolean(env.WA_ACCESS_TOKEN&&env.WA_PHONE_NUMBER_ID&&env.WA_VERIFY_TOKEN&&env.WA_APP_SECRET)}
async function jsonBody(req,max=3000){const raw=await req.text();if(raw.length>max)throw Error('Terlalu panjang');return JSON.parse(raw)}
async function checkRate(env,userId){const minute=Math.floor(Date.now()/60000);const result=await env.DB.prepare('INSERT INTO tc_wa_send_limits(user_id,minute_slot,cnt) VALUES(?,?,1) ON CONFLICT(user_id,minute_slot) DO UPDATE SET cnt=cnt+1 RETURNING cnt').bind(userId,minute).first();return Number(result?.cnt||0)<=10}
async function canAccess(user,env){if(!user)return false;if(isAdmin(user,env))return true;const p=await env.DB.prepare('SELECT enabled FROM tc_wa_permissions WHERE user_id=?').bind(user.id).first();return p?.enabled===1}
async function equalHmac(raw,signature,secret){
 if(!/^sha256=[0-9a-f]{64}$/i.test(signature||''))return false;
 const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(raw)));
 const expected='sha256='+[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');
 let diff=0;const a=expected.toLowerCase(),b=signature.toLowerCase();for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
}
export async function handleWhatsApp(req,env,user){
 const url=new URL(req.url),p=url.pathname;
 if(p==='/api/wa/webhook'){
  if(req.method==='GET'){
   const q=url.searchParams;if(q.get('hub.mode')==='subscribe'&&env.WA_VERIFY_TOKEN&&q.get('hub.verify_token')===env.WA_VERIFY_TOKEN)return new Response(q.get('hub.challenge')||'',{headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
   return new Response('Forbidden',{status:403});
  }
  if(req.method!=='POST'||!env.WA_APP_SECRET)return new Response('Forbidden',{status:403});
  const raw=await req.text();if(raw.length>120000)return new Response('Payload too large',{status:413});
  if(!await equalHmac(raw,req.headers.get('x-hub-signature-256'),env.WA_APP_SECRET))return new Response('Bad signature',{status:403});
  let data;try{data=JSON.parse(raw)}catch{return new Response('Bad JSON',{status:400})}
  const messages=[];
  for(const e of data.entry||[])for(const c of e.changes||[])for(const m of c.value?.messages||[]){
   const phone=safeNumber(m.from);if(!phone||!/^wamid\./.test(String(m.id||'')))continue;
   const body=m.type==='text'?String(m.text?.body||'').slice(0,4096):`[${String(m.type||'media').slice(0,40)} diterima; pratinjau tidak tersedia pada pilot]`;
   messages.push([String(m.id),phone,'in',body,m.type==='text'?'text':'other']);
  }
  if(messages.length){await ensure(env);for(const m of messages.slice(0,50))await env.DB.prepare('INSERT OR IGNORE INTO tc_wa_messages(id,phone,direction,body,kind) VALUES(?,?,?,?,?)').bind(...m).run()}
  return new Response('EVENT_RECEIVED',{headers:{'Content-Type':'text/plain'}});
 }
 if(!user)return j({error:'Silakan login dahulu.'},401);
 if(req.method==='POST'&&req.headers.get('Origin')!==url.origin)return j({error:'Origin tidak diizinkan.'},403);
 await ensure(env);
 const admin=isAdmin(user,env);const allowed=await canAccess(user,env);
 if(p==='/api/wa/status'&&req.method==='GET')return j({ok:true,allowed,admin,configured:configured(env),provider:'meta_cloud_api_test',phoneNumberIdConfigured:!!env.WA_PHONE_NUMBER_ID});
 if(!allowed)return j({error:'Akses WhatsApp belum diberikan admin.'},403);
 if(p==='/api/wa/users'&&req.method==='GET'){
  if(!admin)return j({error:'Khusus admin.'},403);
  const rows=await env.DB.prepare(`SELECT u.id,u.username,u.display_name,COALESCE(p.enabled,0) enabled FROM users u LEFT JOIN tc_wa_permissions p ON p.user_id=u.id WHERE u.email_verified=1 ORDER BY u.username LIMIT 200`).all();return j({ok:true,users:rows.results});
 }
 if(p==='/api/wa/users'&&req.method==='POST'){
  if(!admin)return j({error:'Khusus admin.'},403);
  let d;try{d=await jsonBody(req)}catch{return j({error:'JSON tidak valid'},400)}
  if(typeof d.enabled!=='boolean'||!/^[-a-f0-9]{36}$/i.test(String(d.userId||'')))return j({error:'Data izin tidak valid'},400);
  const exists=await env.DB.prepare('SELECT id,email FROM users WHERE id=? AND email_verified=1').bind(d.userId).first();if(!exists)return j({error:'Pengguna tidak ditemukan'},404);
  if(exists.email?.toLowerCase()===String(env.TC_CALL_ADMIN_EMAIL).toLowerCase())return j({error:'Akses admin tidak dapat diubah dari sini'},400);
  await env.DB.prepare(`INSERT INTO tc_wa_permissions(user_id,enabled,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,updated_at=CURRENT_TIMESTAMP`).bind(d.userId,d.enabled?1:0).run();return j({ok:true});
 }
 if(p==='/api/wa/conversations'&&req.method==='GET'){
  const rs=await env.DB.prepare(`SELECT m.phone,MAX(m.created_at) last_at,(SELECT substr(x.body,1,100) FROM tc_wa_messages x WHERE x.phone=m.phone ORDER BY x.created_at DESC,rowid DESC LIMIT 1) preview,COUNT(*) total FROM tc_wa_messages m GROUP BY m.phone ORDER BY last_at DESC LIMIT 50`).all();return j({ok:true,conversations:rs.results});
 }
 if(p==='/api/wa/messages'&&req.method==='GET'){
  const phone=safeNumber(url.searchParams.get('phone'));if(!phone)return j({error:'Nomor tidak valid'},400);
  const rs=await env.DB.prepare(`SELECT id,phone,direction,body,kind,created_at FROM tc_wa_messages WHERE phone=? ORDER BY created_at DESC,rowid DESC LIMIT 60`).bind(phone).all();return j({ok:true,messages:rs.results.reverse()});
 }
 if(p==='/api/wa/test-template'&&req.method==='POST'){
  if(!admin)return j({error:'Khusus admin.'},403);
  if(!configured(env))return j({error:'Konfigurasi Meta belum lengkap.'},409);
  let d;try{d=await jsonBody(req)}catch{return j({error:'Permintaan tidak valid'},400)}
  const to=safeNumber(d.to),allowlist=String(env.WA_TEST_RECIPIENTS||'').split(',').map(s=>s.trim());
  if(!to||!allowlist.includes(to))return j({error:'Nomor belum terdaftar pada daftar penguji Cloudflare dan Meta.'},403);
  const gate=await checkRate(env,user.id);if(!gate)return j({error:'Terlalu banyak pesan uji. Coba beberapa saat lagi.'},429);
  const version=/^v\d+\.\d+$/.test(String(env.WA_GRAPH_VERSION||''))?env.WA_GRAPH_VERSION:'v26.0';
  let response,data;try{response=await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(env.WA_PHONE_NUMBER_ID)}/messages`,{method:'POST',headers:{Authorization:`Bearer ${env.WA_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'template',template:{name:'hello_world',language:{code:'en_US'}}})});data=await response.json()}catch{return j({error:'Tidak dapat menghubungi Meta'},502)}
  if(!response.ok)return j({error:`Meta menolak template (HTTP ${response.status}): ${String(data?.error?.message||'Periksa nomor, token, template').slice(0,150)}`},502);
  return j({ok:true,id:data?.messages?.[0]?.id||''});
 }
 if(p==='/api/wa/send'&&req.method==='POST'){
  if(!configured(env))return j({error:'Konfigurasi nomor tes WhatsApp belum lengkap di Cloudflare.'},409);
  let d;try{d=await jsonBody(req)}catch{return j({error:'Permintaan salah.'},400)}
  const to=safeNumber(d.to),body=typeof d.text==='string'?d.text.trim():'';
  if(!to||body.length<1||body.length>1000)return j({error:'Nomor internasional atau pesan tidak valid.'},400);
  // Batasi pilot: hanya nomor penerima yang disetujui di Meta dan disimpan di secret.
  const allowlist=String(env.WA_TEST_RECIPIENTS||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(!allowlist.includes(to))return j({error:'Nomor belum dimasukkan dalam WA_TEST_RECIPIENTS di Cloudflare.'},403);
  // WhatsApp hanya mengizinkan teks bebas dalam jendela layanan aktif 24 jam.
  const recent=await env.DB.prepare(`SELECT id FROM tc_wa_messages WHERE phone=? AND direction='in' AND created_at>=datetime('now','-24 hours') LIMIT 1`).bind(to).first();
  if(!recent)return j({error:'Belum ada pesan masuk dalam 24 jam terakhir. Kirim template hello_world lalu minta penerima membalasnya.'},409);
  if(!await checkRate(env,user.id))return j({error:'Batas pengiriman uji tercapai. Coba lagi nanti.'},429);
  const version=/^v\d+\.\d+$/.test(String(env.WA_GRAPH_VERSION||''))?env.WA_GRAPH_VERSION:'v26.0';
  const target=`https://graph.facebook.com/${version}/${encodeURIComponent(env.WA_PHONE_NUMBER_ID)}/messages`;
  let response,data;try{response=await fetch(target,{method:'POST',headers:{Authorization:`Bearer ${env.WA_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body}})});data=await response.json()}catch{return j({error:'Tidak dapat menghubungi Meta.'},502)}
  if(!response.ok)return j({error:`Meta menolak pengiriman (HTTP ${response.status}): ${String(data?.error?.message||'periksa konfigurasi').slice(0,150)}`},502);
  const id=String(data.messages?.[0]?.id||'');if(!id.startsWith('wamid.'))return j({error:'Respons Meta tidak mengandung ID pesan'},502);
  await env.DB.prepare('INSERT OR IGNORE INTO tc_wa_messages(id,phone,direction,body) VALUES(?,?,?,?)').bind(id,to,'out',body).run();return j({ok:true,id});
 }
 return j({error:'Endpoint WhatsApp tidak ditemukan'},404);
}
