// TemanChat V6: media transit (R2) dan signaling panggilan (D1).
// Tabel tambahan dibuat otomatis saat endpoint V6 pertama kali dipakai.
let schemaPromise;
export function ensureExtras(env) {
  if (!schemaPromise) schemaPromise = (async () => {
    const ddl = [
      `CREATE TABLE IF NOT EXISTS tc_media_items (
        id TEXT PRIMARY KEY,uploader_id TEXT NOT NULL,object_key TEXT NOT NULL UNIQUE,
        file_name TEXT NOT NULL,mime_type TEXT NOT NULL,file_size INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,deleted_at TEXT,
        FOREIGN KEY(uploader_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS tc_media_receipts (
        media_id TEXT NOT NULL,user_id TEXT NOT NULL,
        downloaded_at TEXT,storage_type TEXT,storage_verified_at TEXT,
        PRIMARY KEY(media_id,user_id),
        FOREIGN KEY(media_id) REFERENCES tc_media_items(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS tc_media_links (
         message_id INTEGER PRIMARY KEY,
         media_id TEXT NOT NULL UNIQUE,
         chat_id TEXT NOT NULL,
         FOREIGN KEY(message_id) REFERENCES tc_direct_messages(id) ON DELETE CASCADE,
         FOREIGN KEY(media_id) REFERENCES tc_media_items(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS idx_tc_media_chat ON tc_media_links(chat_id)`,
      `CREATE TABLE IF NOT EXISTS tc_media_backups (
         media_id TEXT NOT NULL, user_id TEXT NOT NULL,
         storage_type TEXT NOT NULL, storage_ref TEXT NOT NULL,
         verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         PRIMARY KEY(media_id,user_id),
         FOREIGN KEY(media_id) REFERENCES tc_media_items(id) ON DELETE CASCADE
       )`,
      `CREATE TABLE IF NOT EXISTS tc_call_sessions (
         id TEXT PRIMARY KEY, chat_id TEXT NOT NULL,
         caller_id TEXT NOT NULL, callee_id TEXT NOT NULL,
         kind TEXT NOT NULL CHECK(kind IN ('audio','video')),
         status TEXT NOT NULL DEFAULT 'ringing'
           CHECK(status IN ('ringing','answered','declined','ended','missed')),
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         FOREIGN KEY(chat_id) REFERENCES tc_direct_chats(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS idx_tc_calls_incoming ON tc_call_sessions(callee_id,status,created_at)`,
      `CREATE TABLE IF NOT EXISTS tc_call_signals (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         call_id TEXT NOT NULL, sender_id TEXT NOT NULL,
         kind TEXT NOT NULL CHECK(kind IN ('offer','answer','candidate')),
         payload TEXT NOT NULL,
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         FOREIGN KEY(call_id) REFERENCES tc_call_sessions(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS idx_tc_call_signals ON tc_call_signals(call_id,id)`
    ];
    for (const sql of ddl) await env.DB.prepare(sql).run();
  })().catch(err => { schemaPromise = null; throw err; });
  return schemaPromise;
}
const res = (o, status=200) => Response.json(o,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const bad = (text,status=400) => res({ok:false,error:text},status);
const trimmed = x => String(x ?? '').trim();
const UUID = /^[0-9a-f-]{36}$/;
const MAX_MEDIA = 20*1024*1024;
const ALLOWED = new Set(['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','application/pdf']);
async function member(env,id,user){
 if(!UUID.test(id)) return null;
 return env.DB.prepare('SELECT id,user_a,user_b FROM tc_direct_chats WHERE id=? AND (user_a=? OR user_b=?)')
  .bind(id,user,user).first();
}
async function mediaInfo(env, messageId, userId){
 const id=Number(messageId);
 if(!Number.isSafeInteger(id)||id<1)return null;
 return env.DB.prepare(`SELECT m.id AS message_id,m.sender_id,m.chat_id,
  f.id AS media_id,f.object_key,f.file_name,f.mime_type,f.file_size,f.status
  FROM tc_direct_messages m JOIN tc_media_links l ON l.message_id=m.id
  JOIN tc_media_items f ON f.id=l.media_id
  JOIN tc_direct_chats c ON c.id=m.chat_id
  WHERE m.id=? AND (c.user_a=? OR c.user_b=?) LIMIT 1`)
  .bind(id,userId,userId).first();
}
async function callInfo(env,callId,userId){
 if(!UUID.test(callId))return null;
 return env.DB.prepare('SELECT * FROM tc_call_sessions WHERE id=? AND (caller_id=? OR callee_id=?) LIMIT 1')
  .bind(callId,userId,userId).first();
}
export async function handleExtra(request, env, me, deps){
 const u=new URL(request.url), p=u.pathname;
 if(!p.startsWith('/api/media/')&&!p.startsWith('/api/calls/'))return null;
 if(!me)return bad('Sesi telah berakhir.',401);
 const write = request.method==='POST'||request.method==='PUT';
 if(write&&!deps.allowOrigin(request))return bad('Origin tidak diizinkan.',403);
 // Pemeriksaan skema otomatis. Tidak mengubah 12 tabel lama.
 await ensureExtras(env);
 if(p==='/api/media/config'&&request.method==='GET')return res({ok:true,enabled:!!env.MEDIA,maxBytes:MAX_MEDIA});
 if(p.startsWith('/api/media/')){
  if(!env.MEDIA)return bad('Penyimpanan R2 belum dihubungkan. Chat teks tetap berfungsi.',503);
  if(p==='/api/media/init'&&request.method==='POST'){
   const d=await deps.readJSON(request), chatId=trimmed(d.conversationId);
   if(!await member(env,chatId,me.id))return bad('Percakapan tidak ditemukan.',404);
   const mime=trimmed(d.type).toLowerCase(),size=Number(d.size),name=trimmed(d.name).slice(0,100);
   if(!ALLOWED.has(mime)||!Number.isSafeInteger(size)||size<1||size>MAX_MEDIA)return bad('Jenis atau ukuran file tidak didukung (maksimal 20 MB).');
   if(!await deps.limit(request,env,'media-init',30))return bad('Terlalu banyak unggahan.',429);
   const mediaId=crypto.randomUUID(),key=`chats/${chatId}/${mediaId}`;
   await env.DB.prepare(`INSERT INTO tc_media_items(id,uploader_id,object_key,file_name,mime_type,file_size,status,expires_at)
     VALUES(?,?,?,?,?,?,'pending',datetime('now','+30 days'))`).bind(mediaId,me.id,key,name||'media',mime,size).run();
   return res({ok:true,mediaId});
  }
  if(p==='/api/media/upload'&&request.method==='PUT'){
   const id=trimmed(u.searchParams.get('id'));
   if(!UUID.test(id))return bad('ID file tidak valid.');
   const file=await env.DB.prepare("SELECT * FROM tc_media_items WHERE id=? AND uploader_id=? AND status='pending'").bind(id,me.id).first();
   if(!file)return bad('Sesi unggah tidak ditemukan.',404);
   if(request.headers.get('Content-Type')?.split(';')[0]!==file.mime_type)return bad('Tipe file tidak cocok.');
   const sizeHint=Number(request.headers.get('Content-Length'));
   if(sizeHint>MAX_MEDIA||sizeHint>file.file_size)return bad('File terlalu besar.',413);
   const buffer=await request.arrayBuffer();
   if(buffer.byteLength!==file.file_size||buffer.byteLength>MAX_MEDIA)return bad('Ukuran file berubah.',400);
   await env.MEDIA.put(file.object_key,buffer,{httpMetadata:{contentType:file.mime_type}});
   await env.DB.prepare("UPDATE tc_media_items SET status='available' WHERE id=? AND status='pending'").bind(id).run();
   return res({ok:true});
  }
  if(p==='/api/media/send'&&request.method==='POST'){
   const d=await deps.readJSON(request), chatId=trimmed(d.conversationId),mediaId=trimmed(d.mediaId);
   if(!await member(env,chatId,me.id))return bad('Percakapan tidak ditemukan.',404);
   const f=await env.DB.prepare("SELECT id,mime_type,object_key FROM tc_media_items WHERE id=? AND uploader_id=? AND status='available'").bind(mediaId,me.id).first();
   if(!f||!f.object_key.startsWith(`chats/${chatId}/`))return bad('File tidak ditemukan.',404);
   const existing=await env.DB.prepare('SELECT message_id FROM tc_media_links WHERE media_id=?').bind(mediaId).first();
   if(existing)return bad('Media sudah dikirim.',409);
   const label=f.mime_type.startsWith('image/')?'📷 Foto':f.mime_type.startsWith('video/')?'🎬 Video':'📎 Dokumen';
   const msg=await env.DB.prepare('INSERT INTO tc_direct_messages(chat_id,sender_id,body) VALUES(?,?,?) RETURNING id,created_at').bind(chatId,me.id,label).first();
   await env.DB.prepare('INSERT INTO tc_media_links(message_id,media_id,chat_id) VALUES(?,?,?)').bind(msg.id,mediaId,chatId).run();
   return res({ok:true,message:{id:msg.id,sender_id:me.id,body:label,created_at:msg.created_at,media_id:mediaId,mime_type:f.mime_type}});
  }
  if(p==='/api/media/file'&&request.method==='GET'){
   const f=await mediaInfo(env,u.searchParams.get('messageId'),me.id);
   if(!f||f.status!=='available')return bad('Media sudah tidak tersedia dari server. Periksa backup lokal atau Drive.',404);
   // Range diperlukan untuk video Safari/iPhone; jangan cache media privat di CDN.
   const total=Number(f.file_size),header=request.headers.get('Range');
   let range=null;
   if(header){
     const m=/^bytes=(\d*)-(\d*)$/.exec(header);
     if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${total}`}});
     let start,end;
     if(!m[1]){const suffix=Number(m[2]);start=Math.max(0,total-suffix);end=total-1;}
     else{start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),total-1):total-1;}
     if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=total||end<start)
       return new Response(null,{status:416,headers:{'Content-Range':`bytes */${total}`}});
     range={offset:start,length:end-start+1};
   }
   const obj=await env.MEDIA.get(f.object_key,range?{range}:undefined);
   if(!obj)return bad('File tidak tersedia.',404);
   const headers={'Content-Type':f.mime_type,'Content-Length':String(range?range.length:obj.size),
       'Accept-Ranges':'bytes','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
       'Content-Security-Policy':"default-src 'none'; sandbox"};
   if(range)headers['Content-Range']=`bytes ${range.offset}-${range.offset+range.length-1}/${total}`;
   return new Response(obj.body,{status:range?206:200,headers});
  }
  if(p==='/api/media/backup'&&request.method==='GET'){
   const f=await mediaInfo(env,u.searchParams.get('messageId'),me.id);
   if(!f)return bad('Media tidak ditemukan.',404);
   const record=await env.DB.prepare('SELECT storage_type,storage_ref FROM tc_media_backups WHERE media_id=? AND user_id=?').bind(f.media_id,me.id).first();
   return res({ok:true,backup:record||null,available:f.status==='available'});
  }
  if(p==='/api/media/confirm'&&request.method==='POST'){
   const d=await deps.readJSON(request),f=await mediaInfo(env,d.messageId,me.id);
   if(!f)return bad('Media tidak ditemukan.',404);
   if(f.sender_id===me.id)return bad('Pengirim tidak perlu mengonfirmasi cadangan penerima.');
   if(d.storageType!=='google_drive')return bad('Penghapusan otomatis R2 hanya setelah backup Drive diverifikasi. Penyimpanan lokal tetap dapat digunakan tanpa penghapusan dini.');
   const fileId=trimmed(d.driveFileId),token=trimmed(d.accessToken);
   if(!/^[\w-]{10,200}$/.test(fileId)||token.length<30||token.length>4096)return bad('Verifikasi Drive tidak valid.');
   let google;
   try {const g=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,size,trashed,md5Checksum`,{
     headers:{Authorization:`Bearer ${token}`}});if(!g.ok)return bad('Google Drive tidak dapat diverifikasi.',403);google=await g.json();}
   catch{return bad('Verifikasi Google Drive gagal.',503)}
   if(google.trashed||Number(google.size)!==Number(f.file_size))return bad('File Drive tidak cocok dengan media.',400);
   const original=await env.MEDIA.head(f.object_key);
   if(f.status==='available'&&(!original||!google.md5Checksum||google.md5Checksum.toLowerCase()!==String(original.etag||'').replaceAll('"','').toLowerCase()))
     return bad('Checksum file Drive tidak cocok. R2 tidak dihapus demi keamanan.',400);
   await env.DB.prepare(`INSERT INTO tc_media_receipts(media_id,user_id,downloaded_at,storage_type,storage_verified_at)
    VALUES(?,?,CURRENT_TIMESTAMP,'google_drive',CURRENT_TIMESTAMP)
    ON CONFLICT(media_id,user_id) DO UPDATE SET downloaded_at=COALESCE(downloaded_at,CURRENT_TIMESTAMP),storage_type='google_drive',storage_verified_at=CURRENT_TIMESTAMP`).bind(f.media_id,me.id).run();
   await env.DB.prepare(`INSERT INTO tc_media_backups(media_id,user_id,storage_type,storage_ref) VALUES(?,?,'google_drive',?)
      ON CONFLICT(media_id,user_id) DO UPDATE SET storage_type='google_drive',storage_ref=excluded.storage_ref,verified_at=CURRENT_TIMESTAMP`).bind(f.media_id,me.id,fileId).run();
   // Penghapusan dilakukan hanya sesudah salinan penerima terbukti ada di Google Drive.
   if(f.status==='available'){
     await env.DB.prepare("UPDATE tc_media_items SET status='deleting' WHERE id=? AND status='available'").bind(f.media_id).run();
     await env.MEDIA.delete(f.object_key);
     await env.DB.prepare("UPDATE tc_media_items SET status='deleted',deleted_at=CURRENT_TIMESTAMP WHERE id=?").bind(f.media_id).run();
   }
   return res({ok:true,deletedFromR2:true});
  }
  return bad('Endpoint media tidak tersedia.',404);
 }
 if(p==='/api/calls/config'&&request.method==='GET')return res({ok:true,iceServers:[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}],turnConfigured:false});
 if(p==='/api/calls/start'&&request.method==='POST'){
  const d=await deps.readJSON(request),chat=await member(env,trimmed(d.conversationId),me.id),kind=trimmed(d.kind);
  if(!chat||!['audio','video'].includes(kind))return bad('Percakapan atau jenis panggilan tidak valid.');
  if(!await deps.limit(request,env,'call-start',8))return bad('Terlalu banyak panggilan. Coba beberapa saat lagi.',429);
  const callee=chat.user_a===me.id?chat.user_b:chat.user_a,id=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO tc_call_sessions(id,chat_id,caller_id,callee_id,kind) VALUES(?,?,?,?,?)').bind(id,chat.id,me.id,callee,kind).run();
  return res({ok:true,callId:id});
 }
 if(p==='/api/calls/incoming'&&request.method==='GET'){
  const r=await env.DB.prepare(`SELECT c.id,c.chat_id,c.kind,u.display_name AS caller_name,u.username AS caller_username
    FROM tc_call_sessions c JOIN users u ON u.id=c.caller_id
    WHERE c.callee_id=? AND c.status='ringing' AND c.created_at>datetime('now','-90 seconds')
    ORDER BY c.created_at DESC LIMIT 1`).bind(me.id).first();
  return res({ok:true,call:r||null});
 }
 if(p==='/api/calls/state'&&request.method==='GET'){
  const call=await callInfo(env,trimmed(u.searchParams.get('callId')),me.id);
  return call?res({ok:true,call:{id:call.id,status:call.status,kind:call.kind,chatId:call.chat_id,callerId:call.caller_id}}):bad('Panggilan tidak ditemukan.',404);
 }
 if(p==='/api/calls/decision'&&request.method==='POST'){
  const d=await deps.readJSON(request),call=await callInfo(env,trimmed(d.callId),me.id),decision=trimmed(d.action);
  if(!call||!['answer','reject','hangup'].includes(decision))return bad('Panggilan tidak ditemukan.',404);
  if(decision==='answer'&&call.callee_id!==me.id)return bad('Hanya penerima yang boleh menjawab.',403);
  const status=decision==='answer'?'answered':decision==='reject'?'declined':'ended';
  if(decision==='answer')await env.DB.prepare("UPDATE tc_call_sessions SET status='answered',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='ringing'").bind(call.id).run();
  else await env.DB.prepare("UPDATE tc_call_sessions SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('ringing','answered')").bind(status,call.id).run();
  return res({ok:true,status});
 }
 if(p==='/api/calls/signal'&&request.method==='POST'){
  const d=await deps.readJSON(request,60000),call=await callInfo(env,trimmed(d.callId),me.id);
  const kind=trimmed(d.kind),payload=typeof d.payload==='string'?d.payload:'';
  if(!call||!['ringing','answered'].includes(call.status)||!['offer','answer','candidate'].includes(kind)||payload.length>50000||payload.length<2)return bad('Sinyal tidak valid.',400);
  const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM tc_call_signals WHERE call_id=?').bind(call.id).first();
  if(Number(count?.n)>150)return bad('Batas sinyal panggilan tercapai.',429);
  await env.DB.prepare('INSERT INTO tc_call_signals(call_id,sender_id,kind,payload) VALUES(?,?,?,?)').bind(call.id,me.id,kind,payload).run();
  return res({ok:true});
 }
 if(p==='/api/calls/signals'&&request.method==='GET'){
  const call=await callInfo(env,trimmed(u.searchParams.get('callId')),me.id),after=Number(u.searchParams.get('after')||0);
  if(!call||!Number.isSafeInteger(after)||after<0)return bad('Parameter tidak valid.',400);
  const signals=await env.DB.prepare('SELECT id,kind,payload FROM tc_call_signals WHERE call_id=? AND sender_id!=? AND id>? ORDER BY id ASC LIMIT 100').bind(call.id,me.id,after).all();
  return res({ok:true,signals:signals.results});
 }
 return bad('Endpoint panggilan tidak tersedia.',404);
}
export async function cleanup(env){
 if(!env.DB)return;
 await ensureExtras(env);
 await env.DB.prepare("DELETE FROM auth_tokens WHERE expires_at<datetime('now','-1 day')").run();
 await env.DB.prepare("DELETE FROM auth_rate_limits WHERE created_at<datetime('now','-2 days')").run();
 await env.DB.prepare("DELETE FROM tc_call_signals WHERE created_at<datetime('now','-2 days')").run();
 await env.DB.prepare("UPDATE tc_call_sessions SET status='missed' WHERE status='ringing' AND created_at<datetime('now','-90 seconds')").run();
 if(!env.MEDIA)return;
 const expired=await env.DB.prepare("SELECT id,object_key FROM tc_media_items WHERE status IN ('pending','available','deleting') AND expires_at<datetime('now') LIMIT 15").all();
 for(const f of expired.results){
  try{await env.MEDIA.delete(f.object_key);await env.DB.prepare("UPDATE tc_media_items SET status='expired',deleted_at=CURRENT_TIMESTAMP WHERE id=?").bind(f.id).run()}
  catch(e){console.error('R2 cleanup error',f.id,e?.message)}
 }
}
