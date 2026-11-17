// TemanChat V8.1: independent, revocable device sessions. Device names are hints from
// user-agent only; browser/OS may be inaccurate and are never security identifiers.
let schema;
export async function ensureDeviceSchema(env){
 if(!schema)schema=env.DB.prepare(`CREATE TABLE IF NOT EXISTS tc_device_sessions (
  session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  device_label TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_at TEXT,
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
 )`).run().then(()=>env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_tc_device_sessions_user ON tc_device_sessions(user_id)').run())
 .catch(e=>{schema=null;throw e});
 return schema;
}
export function deviceLabel(ua){
 const s=String(ua||'').slice(0,500);
 const os=/Android/i.test(s)?'Android':/iPhone|iPad|iPod/i.test(s)?'iPhone/iPad':/Windows/i.test(s)?'Windows':/Macintosh|Mac OS X/i.test(s)?'macOS':/Linux/i.test(s)?'Linux':'Perangkat lain';
 const browser=/Edg\//i.test(s)?'Edge':/OPR\//i.test(s)?'Opera':/CriOS|Chrome\//i.test(s)?'Chrome':/FxiOS|Firefox\//i.test(s)?'Firefox':/Safari\//i.test(s)?'Safari':'Browser';
 return `${os} · ${browser}`;
}
export async function logDeviceLogin(env,id,userId,ua){
 await ensureDeviceSchema(env);
 await env.DB.prepare('INSERT INTO tc_device_sessions(session_id,user_id,device_label,last_active_at) VALUES(?,?,?,CURRENT_TIMESTAMP)')
  .bind(id,userId,deviceLabel(ua)).run();
}
export async function touchDevice(env,me,ua){
 if(!me?.session_id)return;
 await ensureDeviceSchema(env);
 await env.DB.prepare(`INSERT INTO tc_device_sessions(session_id,user_id,device_label,last_active_at)
 VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(session_id) DO UPDATE SET last_active_at=CURRENT_TIMESTAMP`)
  .bind(me.session_id,me.id,deviceLabel(ua)).run();
}
export async function listDevices(env,me){
 await ensureDeviceSchema(env);
 const rows=await env.DB.prepare(`SELECT s.id,COALESCE(d.device_label,
 CASE WHEN s.device_name LIKE '%Android%' THEN 'Android · Browser' WHEN s.device_name LIKE '%iPhone%' THEN 'iPhone · Browser'
 WHEN s.device_name LIKE '%Windows%' THEN 'Windows · Browser' WHEN s.device_name LIKE '%Macintosh%' THEN 'macOS · Browser'
 ELSE 'Perangkat lain · Browser' END) AS device_label,
 d.created_at,d.last_active_at,s.expires_at,
 CASE WHEN s.id=? THEN 1 ELSE 0 END AS current_device
 FROM sessions s LEFT JOIN tc_device_sessions d ON d.session_id=s.id
 WHERE s.user_id=? AND s.revoked_at IS NULL AND s.expires_at>datetime('now')
 ORDER BY current_device DESC,COALESCE(d.last_active_at,d.created_at,s.expires_at) DESC LIMIT 50`)
 .bind(me.session_id,me.id).all();
 return rows.results.map(r=>({id:r.id,label:r.device_label,createdAt:r.created_at||null,
  lastActiveAt:r.last_active_at||null,expiresAt:r.expires_at,current:!!r.current_device}));
}
export async function revokeDevice(env,me,targetId){
 if(!/^[0-9a-f-]{36}$/i.test(String(targetId||'')))return false;
 if(targetId===me.session_id)return false;
 const r=await env.DB.prepare(`UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP
  WHERE id=? AND user_id=? AND id<>? AND revoked_at IS NULL AND expires_at>datetime('now') RETURNING id`)
 .bind(targetId,me.id,me.session_id).first();
 if(!r)return false;
 // This revokes the session immediately and prevents future authenticated requests.
 // Delete its push subscription too, where the subscription was linked to this session.
 try{
  await env.DB.prepare('DELETE FROM tc_push_focus WHERE subscription_id IN (SELECT subscription_id FROM tc_push_device_links WHERE session_id=?)').bind(targetId).run();
  await env.DB.prepare(`DELETE FROM tc_push_subscriptions WHERE id IN
   (SELECT subscription_id FROM tc_push_device_links WHERE session_id=?)`).bind(targetId).run();
  await env.DB.prepare('DELETE FROM tc_push_device_links WHERE session_id=?').bind(targetId).run();
 }catch(e){console.warn('Revoked session; push cleanup pending',e.message)}
 return true;
}
