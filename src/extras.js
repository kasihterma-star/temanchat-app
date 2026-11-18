import { googleAccessToken } from './google-drive.js';
// TemanChat V7.4: media transit (R2), audio voice notes, preferensi, panggilan.
import { validateReply, storeReply } from './replies.js';
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
      `CREATE TABLE IF NOT EXISTS tc_media_preferences (
        user_id TEXT PRIMARY KEY,
        save_mode TEXT NOT NULL DEFAULT 'none' CHECK(save_mode IN ('none','local','google_drive','nextcloud')),
        notice_seen_at TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
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
      `CREATE INDEX IF NOT EXISTS idx_tc_call_signals ON tc_call_signals(call_id,id)`,
      `CREATE TABLE IF NOT EXISTS tc_remote_call_access (
        user_id TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
        requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TEXT, reviewed_by TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS tc_call_modes (
        call_id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK(mode IN ('local','remote')),
        FOREIGN KEY(call_id) REFERENCES tc_call_sessions(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS tc_call_auto_strategies (
        call_id TEXT PRIMARY KEY,
        FOREIGN KEY(call_id) REFERENCES tc_call_sessions(id) ON DELETE CASCADE
      )`
    ];
    for (const sql of ddl) await env.DB.prepare(sql).run();
    // Kompatibilitas database V8.7/V8.8: kolom masa berlaku ditambahkan tanpa menghapus izin lama.
    const columns=await env.DB.prepare('PRAGMA table_info(tc_remote_call_access)').all();
    if(!(columns.results||[]).some(col=>col.name==='expires_at')){
      await env.DB.prepare('ALTER TABLE tc_remote_call_access ADD COLUMN expires_at TEXT').run();
    }
  })().catch(err => { schemaPromise = null; throw err; });
  return schemaPromise;
}
const res = (o, status=200) => Response.json(o,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const bad = (text,status=400) => res({ok:false,error:text},status);
const trimmed = x => String(x ?? '').trim();
const UUID = /^[0-9a-f-]{36}$/;
const MAX_MEDIA = 25*1024*1024; // audio 25 MB, foto dan video 20 MB sampai multipart tersedia
const ALLOWED = new Set(['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','application/pdf','audio/webm','audio/mp4','audio/ogg','audio/wav','audio/mpeg']);
const MAX_GENERAL=20*1024*1024;
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
function isCallAdmin(env,me){
  // Admin = akun TemanChat yang sudah ada; tidak membuat password admin bawaan.
  return !!(env.TC_CALL_ADMIN_EMAIL && me?.email && me.email.toLowerCase()===String(env.TC_CALL_ADMIN_EMAIL).trim().toLowerCase());
}
async function remoteApproved(env,me){
  if(isCallAdmin(env,me))return true;
  const r=await env.DB.prepare("SELECT state,expires_at FROM tc_remote_call_access WHERE user_id=?").bind(me.id).first();
  return r?.state==='approved'&&(!r.expires_at||Date.parse(r.expires_at.replace(' ','T')+'Z')>Date.now());
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
 if(p==='/api/media/config'&&request.method==='GET')return res({ok:true,enabled:!!env.MEDIA,maxBytes:MAX_GENERAL,maxVoiceBytes:MAX_MEDIA});
 if(p==='/api/media/preferences'&&request.method==='GET'){
   const r=await env.DB.prepare('SELECT save_mode,notice_seen_at FROM tc_media_preferences WHERE user_id=?').bind(me.id).first();
   return res({ok:true,mode:r?.save_mode||'none',noticeSeen:!!r?.notice_seen_at});
 }
 if(p==='/api/media/preferences'&&request.method==='POST'){
   const d=await deps.readJSON(request,1600);
   if(d.mode!==undefined&&!['none','local','google_drive','nextcloud'].includes(d.mode))return bad('Pilihan penyimpanan tidak valid.');
   const before=await env.DB.prepare('SELECT save_mode,notice_seen_at FROM tc_media_preferences WHERE user_id=?').bind(me.id).first();
   const mode=d.mode===undefined?(before?.save_mode||'none'):d.mode;
   await env.DB.prepare(`INSERT INTO tc_media_preferences(user_id,save_mode,notice_seen_at)
     VALUES(?,?,CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END)
     ON CONFLICT(user_id) DO UPDATE SET save_mode=excluded.save_mode,
       notice_seen_at=CASE WHEN ? THEN COALESCE(tc_media_preferences.notice_seen_at,CURRENT_TIMESTAMP)
         ELSE tc_media_preferences.notice_seen_at END,updated_at=CURRENT_TIMESTAMP`)
     .bind(me.id,mode,d.ackNotice===true?1:0,d.ackNotice===true?1:0).run();
   return res({ok:true,mode,noticeSeen:!!before?.notice_seen_at||d.ackNotice===true});
 }
 if(p.startsWith('/api/media/')){
  if(!env.MEDIA)return bad('Penyimpanan R2 belum dihubungkan. Chat teks tetap berfungsi.',503);
  if(p==='/api/media/init'&&request.method==='POST'){
   const d=await deps.readJSON(request), chatId=trimmed(d.conversationId);
   if(!await member(env,chatId,me.id))return bad('Percakapan tidak ditemukan.',404);
   const mime=trimmed(d.type).toLowerCase(),size=Number(d.size),name=trimmed(d.name).slice(0,100);
   if(!ALLOWED.has(mime)||!Number.isSafeInteger(size)||size<1||size>(mime.startsWith('audio/')?MAX_MEDIA:MAX_GENERAL))return bad('Jenis atau ukuran file tidak didukung (foto/video maks 20 MB, audio maks 25 MB).');
   if(!await deps.limit(request,env,'media-init',30))return bad('Terlalu banyak unggahan.',429);
   const mediaId=crypto.randomUUID(),key=`chats/${chatId}/${mediaId}`;
   await env.DB.prepare(`INSERT INTO tc_media_items(id,uploader_id,object_key,file_name,mime_type,file_size,status,expires_at)
     VALUES(?,?,?,?,?,?,'pending',datetime('now','+3 days'))`).bind(mediaId,me.id,key,name||'media',mime,size).run();
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
   const label=f.mime_type.startsWith('image/')?'📷 Foto':f.mime_type.startsWith('video/')?'🎬 Video':f.mime_type.startsWith('audio/')?'🎤 Pesan suara':'📎 Dokumen';
   let replyTo;
   try{replyTo=await validateReply(env,chatId,d.replyToId)}catch(e){return bad(e.message)}
   const msg=await env.DB.prepare('INSERT INTO tc_direct_messages(chat_id,sender_id,body) VALUES(?,?,?) RETURNING id,created_at').bind(chatId,me.id,label).first();
   await env.DB.prepare('INSERT INTO tc_media_links(message_id,media_id,chat_id) VALUES(?,?,?)').bind(msg.id,mediaId,chatId).run();
   if(replyTo)await storeReply(env,msg.id,chatId,replyTo);
   const chat=await member(env,chatId,me.id);
   const otherId=chat.user_a===me.id?chat.user_b:chat.user_a;
   let unreadCount;
   try{const r=await env.DB.prepare(`SELECT COUNT(*) AS n FROM tc_direct_messages m
     JOIN tc_direct_chats c ON c.id=m.chat_id
     LEFT JOIN tc_chat_receipts r ON r.chat_id=m.chat_id AND r.user_id=?
     WHERE (c.user_a=? OR c.user_b=?) AND m.sender_id<>? AND m.id>COALESCE(r.read_id,0)`)
     .bind(otherId,otherId,otherId,otherId).first();unreadCount=Number(r?.n||0);
   }catch(e){console.warn('Media unread badge pending:',e.message)}
   deps.sendPush?.(otherId,{title:'TemanChat',body:label+' dari '+me.display_name,
     url:'/?chat='+chatId,tag:'tc-media-'+msg.id,kind:'message',conversationId:chatId,
     messageId:msg.id,...(unreadCount===undefined?{}:{unreadCount})},86400);
   return res({ok:true,message:{id:msg.id,sender_id:me.id,body:label,created_at:msg.created_at,media_id:mediaId,mime_type:f.mime_type,reply_to_id:replyTo?.id||null,reply_body:replyTo?.body||null,reply_sender_id:replyTo?.sender_id||null}});
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
   const fileId=trimmed(d.driveFileId),token=await googleAccessToken(env,me.id);
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
   // Jangan menghapus file bersama segera: pemilik/anggota lain mungkin belum menyimpan.
   // Pembersihan transit dilakukan oleh cron pada masa kedaluwarsa.
   return res({ok:true,deletedFromR2:false,backupVerified:true});
  }
  return bad('Endpoint media tidak tersedia.',404);
 }
 if(p==='/api/calls/access'&&request.method==='GET'){
  const admin=isCallAdmin(env,me);
  const row=await env.DB.prepare('SELECT state,requested_at,reviewed_at,expires_at FROM tc_remote_call_access WHERE user_id=?').bind(me.id).first();
  const approved=await remoteApproved(env,me);
  const expired=!!(row?.state==='approved'&&!approved);
  return res({ok:true,admin,adminConfigured:!!String(env.TC_CALL_ADMIN_EMAIL||'').trim(),approved,state:expired?'expired':row?.state||'none',requestedAt:row?.requested_at||null,expiresAt:row?.expires_at||null});
 }
 if(p==='/api/calls/access/request'&&request.method==='POST'){
  if(isCallAdmin(env,me))return res({ok:true,state:'approved'});
  if(!String(env.TC_CALL_ADMIN_EMAIL||'').trim())return bad('Admin belum dikonfigurasi oleh pengelola TemanChat.',503);
  if(!await deps.limit(request,env,'remote-call-request',4,me.id))return bad('Terlalu sering mengajukan. Coba lagi nanti.',429);
  const existing=await env.DB.prepare('SELECT state FROM tc_remote_call_access WHERE user_id=?').bind(me.id).first();
  if(existing?.state==='pending')return res({ok:true,state:'pending'});
  if(existing?.state==='approved'&&await remoteApproved(env,me))return res({ok:true,state:'approved'});
  await env.DB.prepare(`INSERT INTO tc_remote_call_access(user_id,state,requested_at,reviewed_at,reviewed_by,expires_at) VALUES(?,'pending',CURRENT_TIMESTAMP,NULL,NULL,NULL)
   ON CONFLICT(user_id) DO UPDATE SET state='pending',requested_at=CURRENT_TIMESTAMP,reviewed_at=NULL,reviewed_by=NULL,expires_at=NULL`).bind(me.id).run();
  // Push hanya ketika benar-benar membuat pengajuan baru; tidak dikirim berulang pada refresh.
  const administrator=await env.DB.prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE LIMIT 1').bind(String(env.TC_CALL_ADMIN_EMAIL).trim()).first();
  if(administrator?.id)deps.sendPush?.(administrator.id,{kind:'call_access_request',title:'TemanChat Admin',body:`${me.display_name||'Pengguna'} (@${me.username}) mengajukan akses panggilan jarak jauh.`,url:'/?adminCalls=1',tag:'tc-admin-call-request-'+me.id},86400);
  return res({ok:true,state:'pending'});
 }
 if(p==='/api/calls/access/requests'&&request.method==='GET'){
  if(!isCallAdmin(env,me))return bad('Hanya admin panggilan yang dapat melihat pengajuan.',403);
  const list=await env.DB.prepare(`SELECT a.user_id,CASE WHEN a.state='approved' AND a.expires_at IS NOT NULL AND a.expires_at<=datetime('now') THEN 'expired' ELSE a.state END AS state,a.requested_at,a.reviewed_at,a.expires_at,u.display_name,u.email,u.username
    FROM tc_remote_call_access a JOIN users u ON u.id=a.user_id ORDER BY CASE a.state WHEN 'pending' THEN 0 ELSE 1 END,a.requested_at DESC LIMIT 100`).all();
  return res({ok:true,requests:list.results||[]});
 }
 if(p==='/api/calls/access/users'&&request.method==='GET'){
  if(!isCallAdmin(env,me))return bad('Hanya administrator yang dapat mencari pengguna.',403);
  if(!await deps.limit(request,env,'remote-call-admin-users',45,me.id))return bad('Terlalu banyak pencarian.',429);
  const query=String(u.searchParams.get('q')||'').trim().replace(/^@/,'').slice(0,60);
  if(query&&query.length<2)return res({ok:true,users:[]});
  const statusFilter=String(u.searchParams.get('status')||'all');
  if(!['all','pending','approved','rejected','expired','none'].includes(statusFilter))return bad('Filter tidak dikenal.',400);
  const result=await env.DB.prepare(`SELECT usr.id AS user_id,usr.username,usr.display_name,
    CASE WHEN access.state='approved' AND access.expires_at IS NOT NULL AND access.expires_at<=datetime('now') THEN 'expired'
         ELSE COALESCE(access.state,'none') END AS state,
    access.expires_at,access.requested_at
    FROM users usr LEFT JOIN tc_remote_call_access access ON access.user_id=usr.id
    WHERE usr.id<>? AND (?='' OR instr(lower(usr.username),lower(?))>0 OR instr(lower(usr.display_name),lower(?))>0)
    ORDER BY CASE WHEN access.state='pending' THEN 0 WHEN access.state='approved' THEN 1 ELSE 2 END,
     usr.username COLLATE NOCASE LIMIT 120`).bind(me.id,query,query,query).all();
  const users=(result.results||[]).filter(row=>statusFilter==='all'||row.state===statusFilter).slice(0,60);
  return res({ok:true,users});
 }
 if(p==='/api/calls/access/review'&&request.method==='POST'){
  if(!isCallAdmin(env,me))return bad('Hanya admin panggilan yang dapat menyetujui.',403);
  if(!await deps.limit(request,env,'remote-call-review',30,me.id))return bad('Terlalu banyak permintaan.',429);
  const d=await deps.readJSON(request,1500);
  if(!UUID.test(String(d.userId||''))||!['approved','rejected'].includes(d.state))return bad('Permintaan tidak valid.',400);
  const duration=d.duration||'forever';
  if(!['1d','7d','30d','forever'].includes(duration))return bad('Masa berlaku tidak valid.',400);
  if(String(d.userId)===me.id)return bad('Tidak perlu mengubah akses admin.',400);
  const durationSql={ '1d':'+1 day','7d':'+7 days','30d':'+30 days' };
  // Durasi hanya berlaku pada persetujuan. Penolakan/pencabutan menghapus expiry.
  const expiry=d.state==='approved'&&duration!=='forever'?durationSql[duration]:null;
  // Admin boleh memberikan izin langsung kepada pengguna yang belum pernah mengajukan.
  const target=await env.DB.prepare('SELECT id FROM users WHERE id=? LIMIT 1').bind(d.userId).first();
  if(!target)return bad('Akun pengguna tidak ditemukan.',404);
  await env.DB.prepare(`INSERT INTO tc_remote_call_access(user_id,state,requested_at,reviewed_at,reviewed_by,expires_at)
    VALUES(?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?,CASE WHEN ? IS NULL THEN NULL ELSE datetime('now',?) END)
    ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,reviewed_at=CURRENT_TIMESTAMP,
    reviewed_by=excluded.reviewed_by,expires_at=excluded.expires_at`)
    .bind(d.userId,d.state,me.id,expiry,expiry).run();
  deps.sendPush?.(d.userId,{kind:'call_access_result',title:'Izin Panggilan TemanChat',body:d.state==='approved'?'Pengajuan panggilan jarak jauh disetujui.':'Izin panggilan jarak jauh ditolak atau dicabut.',url:'/',tag:'tc-call-access-result'},3600);
  return res({ok:true,state:d.state,duration:d.state==='approved'?duration:null});
 }
 if(p==='/api/calls/history'&&request.method==='GET'){
  // Status yang masih ringing >30 detik dihitung tak terjawab tanpa perlu menunggu cron.
  // Hanya pemanggil/penerima yang sedang login boleh melihat riwayatnya.
  const data=await env.DB.prepare(`SELECT c.id,c.chat_id,c.kind,c.status,c.created_at,c.updated_at,
    c.caller_id,c.callee_id,u.display_name AS other_name,u.username AS other_username,
    EXISTS(SELECT 1 FROM tc_call_signals sig WHERE sig.call_id=c.id AND sig.kind='answer') AS has_answer
    FROM tc_call_sessions c JOIN users u
      ON u.id=CASE WHEN c.caller_id=? THEN c.callee_id ELSE c.caller_id END
    WHERE c.caller_id=? OR c.callee_id=?
    ORDER BY c.created_at DESC LIMIT 60`).bind(me.id,me.id,me.id).all();
  const cutoff=Date.now()-30000;
  const calls=(data.results||[]).map(c=>{
    const stale=c.status==='ringing'&&Date.parse(String(c.created_at).replace(' ','T')+'Z')<cutoff;
    const noAnswer=c.status==='ended'&&!Number(c.has_answer);
    return {id:c.id,chatId:c.chat_id,kind:c.kind,
      direction:c.caller_id===me.id?'outgoing':'incoming',
      status:stale||noAnswer?'missed':c.status,
      other_name:c.other_name,other_username:c.other_username,
      created_at:c.created_at};
  });
  return res({ok:true,calls});
 }
 if(p==='/api/calls/config'&&request.method==='GET'){
  // Panggilan ditentukan saat dibuat, bukan pilihan browser penerima.
  const call=await callInfo(env,trimmed(u.searchParams.get('callId')),me.id);
  if(!call)return bad('Panggilan tidak ditemukan untuk sesi ini.',404);
  const modeRow=await env.DB.prepare('SELECT mode FROM tc_call_modes WHERE call_id=?').bind(call.id).first();
  const callMode=modeRow?.mode||'local';
  const autoRow=callMode==='remote'?await env.DB.prepare('SELECT call_id FROM tc_call_auto_strategies WHERE call_id=?').bind(call.id).first():null;
  const strategy=autoRow?'auto':callMode;
  if(callMode==='local')return res({ok:true,mode:'local',strategy:'local',iceServers:[],turnConfigured:false,turnWarning:''});
  if(call.status!=='ringing'&&call.status!=='answered')return bad('Panggilan sudah selesai.',409);

  const fallback=[{urls:['stun:stun.cloudflare.com:3478','stun:stun.l.google.com:19302']}];
  // Cloudflare Realtime TURN: secret jangka panjang hanya ada di Worker.
  // Browser menerima kredensial sementara untuk satu sesi panggilan.
  if(!env.CF_TURN_KEY_ID||!env.CF_TURN_API_TOKEN)
    return res({ok:true,mode:'remote',strategy,iceServers:fallback,turnConfigured:false,turnStatus:'not_configured',turnWarning:'Cloudflare TURN belum aktif. Panggilan akan mencoba koneksi langsung menggunakan STUN.'});
  try{
    if(!/^[a-zA-Z0-9_-]{8,128}$/.test(env.CF_TURN_KEY_ID))throw Error('TURN key ID tidak valid');
    const response=await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.CF_TURN_KEY_ID)}/credentials/generate-ice-servers`,{
      method:'POST',headers:{'Authorization':'Bearer '+env.CF_TURN_API_TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify({ttl:21600}),signal:AbortSignal.timeout(8000)
    });
    if(!response.ok)throw Error('TURN provider HTTP '+response.status);
    const data=await response.json();
    // Jangan terima URL lain dari response yang tidak sesuai dengan TURN Cloudflare.
    // Izinkan hanya alamat resmi Cloudflare; jangan meneruskan URL tak dikenal.
    const allowed=/^(?:stun:stun\.cloudflare\.com:3478|turn:turn\.cloudflare\.com:(?:3478|443|80)(?:\?transport=(?:tcp|udp))?|turns:turn\.cloudflare\.com:(?:5349|443)(?:\?transport=tcp)?)$/;
    const iceServers=Array.isArray(data.iceServers)?data.iceServers.map(x=>{
      if(!x||typeof x!=='object')return null;
      const candidates=Array.isArray(x.urls)?x.urls:typeof x.urls==='string'?[x.urls]:[];
      const urls=candidates.filter(u=>typeof u==='string'&&allowed.test(u));
      if(!urls.length)return null;
      if(urls.some(u=>u.startsWith('turn'))){
        if(typeof x.username!=='string'||!x.username||typeof x.credential!=='string'||!x.credential)return null;
        return {urls,username:x.username,credential:x.credential};
      }
      return {urls};
    }).filter(Boolean):[];
    if(!iceServers.some(x=>x.username&&x.credential&&x.urls.some(u=>u.startsWith('turn'))))throw Error('Provider tidak mengembalikan kredensial TURN');
    return res({ok:true,mode:'remote',strategy,iceServers,turnConfigured:true,turnStatus:'ready'});
  }catch(error){
    console.warn('TURN setup',error?.message||'unknown');
    return res({ok:true,mode:'remote',strategy,iceServers:fallback,turnConfigured:false,turnStatus:'unavailable',turnWarning:'Relay TURN belum dapat dihubungi. Periksa CF_TURN_KEY_ID dan CF_TURN_API_TOKEN di Cloudflare; saat ini mencoba STUN langsung.'});
  }
 }
 if(p==='/api/calls/start'&&request.method==='POST'){
  const d=await deps.readJSON(request),chat=await member(env,trimmed(d.conversationId),me.id),kind=trimmed(d.kind);
  // Otomatis diotorisasi sama seperti Jarak Jauh; tidak melewati persetujuan admin.
  const strategy=['local','remote','auto'].includes(d.mode)?d.mode:'local';
  if(d.mode!==undefined&&!['remote','local','auto'].includes(d.mode))return bad('Mode panggilan tidak valid.');
  const mode=strategy==='local'?'local':'remote';
  if(mode==='remote'&&!await remoteApproved(env,me))return bad('Mode otomatis/jarak jauh harus disetujui admin terlebih dahulu.',403);
  if(!chat||!['audio','video'].includes(kind))return bad('Percakapan atau jenis panggilan tidak valid.');
  const callee=chat.user_a===me.id?chat.user_b:chat.user_a;
  // Perlindungan panggilan pertama: harus pernah saling mengirim pesan (dua arah).
  // Cek ulang di server pada SETIAP panggilan; tombol UI saja tidak cukup untuk keamanan.
  // Berlaku juga untuk video call, dan percakapan lama yang sudah pernah saling membalas otomatis lolos.
  const exchange=await env.DB.prepare(`SELECT
    EXISTS(SELECT 1 FROM tc_direct_messages WHERE chat_id=? AND sender_id=?) AS caller_sent,
    EXISTS(SELECT 1 FROM tc_direct_messages WHERE chat_id=? AND sender_id=?) AS callee_replied`)
    .bind(chat.id,me.id,chat.id,callee).first();
  if(!Number(exchange?.caller_sent)||!Number(exchange?.callee_replied))
    return bad('Saling bertukar pesan terlebih dahulu untuk memulai panggilan suara atau video.',403);
  if(!await deps.limit(request,env,'call-start',8))return bad('Terlalu banyak panggilan. Coba beberapa saat lagi.',429);
  const id=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO tc_call_sessions(id,chat_id,caller_id,callee_id,kind) VALUES(?,?,?,?,?)').bind(id,chat.id,me.id,callee,kind).run();
  await env.DB.prepare('INSERT INTO tc_call_modes(call_id,mode) VALUES(?,?)').bind(id,mode).run();
  if(strategy==='auto')await env.DB.prepare('INSERT INTO tc_call_auto_strategies(call_id) VALUES(?)').bind(id).run();
  const callAlert={title:kind==='video'?'📹 Panggilan video TemanChat':'📞 Panggilan suara TemanChat',body:me.display_name+' sedang menelepon Anda',url:'/?call='+id,kind:'call',callId:id,tag:'tc-call-'+id};
  if(deps.sendCallAlerts)deps.sendCallAlerts(callee,callAlert);
  else deps.sendPush?.(callee,callAlert,45);
  return res({ok:true,callId:id});
 }
 if(p==='/api/calls/incoming'&&request.method==='GET'){
  const r=await env.DB.prepare(`SELECT c.id,c.chat_id,c.kind,CASE WHEN a.call_id IS NOT NULL THEN 'auto' ELSE COALESCE(m.mode,'local') END AS mode,
      u.display_name AS caller_name,u.username AS caller_username
    FROM tc_call_sessions c JOIN users u ON u.id=c.caller_id
    LEFT JOIN tc_call_modes m ON m.call_id=c.id
    LEFT JOIN tc_call_auto_strategies a ON a.call_id=c.id
    WHERE c.callee_id=? AND c.status='ringing' AND c.created_at>datetime('now','-30 seconds')
    ORDER BY c.created_at DESC LIMIT 1`).bind(me.id).first();
  if(r){
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS tc_call_delivery (call_id TEXT PRIMARY KEY,callee_id TEXT NOT NULL,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
    await env.DB.prepare('INSERT OR IGNORE INTO tc_call_delivery(call_id,callee_id) VALUES(?,?)').bind(r.id,me.id).run();
  }
  return res({ok:true,call:r||null});
 }
 if(p==='/api/calls/ringing-ack'&&request.method==='POST'){
  const d=await deps.readJSON(request),call=await callInfo(env,trimmed(d.callId),me.id);
  if(!call||call.callee_id!==me.id)return bad('Panggilan tidak ditemukan.',404);
  if(call.status!=='ringing')return res({ok:true,received:false});
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS tc_call_delivery (
    call_id TEXT PRIMARY KEY, callee_id TEXT NOT NULL, received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await env.DB.prepare('INSERT OR IGNORE INTO tc_call_delivery(call_id,callee_id) VALUES(?,?)').bind(call.id,me.id).run();
  return res({ok:true,received:true});
 }
 if(p==='/api/calls/state'&&request.method==='GET'){
  const call=await callInfo(env,trimmed(u.searchParams.get('callId')),me.id);
  if(!call)return bad('Panggilan tidak ditemukan.',404);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS tc_call_delivery (
    call_id TEXT PRIMARY KEY,callee_id TEXT NOT NULL,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  const receipt=await env.DB.prepare('SELECT received_at FROM tc_call_delivery WHERE call_id=?').bind(call.id).first();
  return res({ok:true,call:{id:call.id,status:call.status,kind:call.kind,chatId:call.chat_id,callerId:call.caller_id,delivered:!!receipt}});
 }
 if(p==='/api/calls/decision'&&request.method==='POST'){
  const d=await deps.readJSON(request),call=await callInfo(env,trimmed(d.callId),me.id),decision=trimmed(d.action);
  if(!call||!['answer','reject','hangup','timeout'].includes(decision))return bad('Panggilan tidak ditemukan.',404);
  if(decision==='answer'&&call.callee_id!==me.id)return bad('Hanya penerima yang boleh menjawab.',403);
  if(decision==='reject'&&call.callee_id!==me.id)return bad('Hanya penerima yang boleh menolak.',403);
  if(decision==='timeout'&&call.caller_id!==me.id)return bad('Hanya penelepon yang boleh mengakhiri waktu tunggu.',403);
  if(decision==='timeout'&&call.status==='ringing'){
   const eligible=await env.DB.prepare("SELECT 1 AS yes FROM tc_call_sessions WHERE id=? AND created_at<=datetime('now','-30 seconds')").bind(call.id).first();
   if(!eligible)return bad('Waktu tunggu belum berakhir.',409);
  }
  // UPDATE atomik: jangan sampai push "tak terjawab" terkirim dua kali atau sesudah dijawab.
  let status,changed;
  if(decision==='answer'){
   status='answered';changed=await env.DB.prepare("UPDATE tc_call_sessions SET status='answered',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='ringing' RETURNING id").bind(call.id).first();
  }else if(decision==='reject'){
   status='declined';changed=await env.DB.prepare("UPDATE tc_call_sessions SET status='declined',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='ringing' RETURNING id").bind(call.id).first();
  }else if(decision==='timeout'){
   status='missed';changed=await env.DB.prepare("UPDATE tc_call_sessions SET status='missed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='ringing' RETURNING id").bind(call.id).first();
  }else{
   // Penelepon menutup panggilan yang belum dijawab: tak terjawab di sisi penerima.
   // Penerima menutup sebelum menjawab: ditolak; panggilan aktif: berakhir.
   status=call.status==='ringing'?(me.id===call.caller_id?'missed':'declined'):'ended';
   changed=await env.DB.prepare(`UPDATE tc_call_sessions SET status=CASE WHEN status='ringing' THEN ? ELSE 'ended' END,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status IN ('ringing','answered') RETURNING status`).bind(status,call.id).first();
   if(changed)status=changed.status;
  }
  if(changed){
   deps.sendPush?.(call.callee_id,{kind:'call_end',callId:call.id,tag:'tc-call-'+call.id},60);
   if(status==='missed'){
    const caller=await env.DB.prepare('SELECT display_name FROM users WHERE id=?').bind(call.caller_id).first();
    deps.sendPush?.(call.callee_id,{kind:'missed_call',callId:call.id,
      title:call.kind==='video'?'Panggilan video tak terjawab':'Panggilan suara tak terjawab',
      body:(caller?.display_name||'Teman')+' menelepon Anda',url:'/?chat='+call.chat_id,tag:'tc-missed-'+call.id},86400);
   }
  }
  return res({ok:true,status:changed?status:call.status,changed:!!changed});
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
 // Penandaan tak terjawab hanya oleh cron menit yang mengirim push tepat sekali.
 if(!env.MEDIA)return;
 const expired=await env.DB.prepare(`SELECT f.id,f.object_key FROM tc_media_items f
   LEFT JOIN tc_media_links l ON l.media_id=f.id
   LEFT JOIN tc_direct_chats c ON c.id=l.chat_id
   LEFT JOIN tc_media_preferences p ON p.user_id=CASE WHEN c.user_a=f.uploader_id THEN c.user_b ELSE c.user_a END
   WHERE f.status IN ('pending','available','deleting') AND f.expires_at<datetime('now')
   AND (f.status='pending' OR p.save_mode IS NULL OR p.save_mode IN ('none','local')
     OR EXISTS(SELECT 1 FROM tc_media_backups b WHERE b.media_id=f.id AND b.user_id=p.user_id))
   LIMIT 15`).all();
 for(const f of expired.results){
  try{await env.MEDIA.delete(f.object_key);await env.DB.prepare("UPDATE tc_media_items SET status='expired',deleted_at=CURRENT_TIMESTAMP WHERE id=?").bind(f.id).run()}
  catch(e){console.error('R2 cleanup error',f.id,e?.message)}
 }
}
