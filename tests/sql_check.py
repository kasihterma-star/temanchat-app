from pathlib import Path
import sqlite3,uuid
base=Path(__file__).resolve().parents[1]
conn=sqlite3.connect(':memory:');conn.execute('PRAGMA foreign_keys=ON')
conn.executescript('''
CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT,email TEXT,display_name TEXT,email_verified INTEGER,password_hash TEXT,updated_at TEXT);
CREATE TABLE auth_tokens(id TEXT,user_id TEXT,token_hash TEXT,purpose TEXT,expires_at TEXT,used_at TEXT);
CREATE TABLE auth_rate_limits(key TEXT PRIMARY KEY,attempts INTEGER,created_at TEXT);
CREATE TABLE sessions(id TEXT,user_id TEXT,token_hash TEXT,device_name TEXT,expires_at TEXT,revoked_at TEXT);
''')
conn.executescript("""
CREATE TABLE tc_direct_chats (
 id TEXT PRIMARY KEY,pair_key TEXT NOT NULL UNIQUE,user_a TEXT NOT NULL,user_b TEXT NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_a) REFERENCES users(id),FOREIGN KEY(user_b) REFERENCES users(id)
);
CREATE TABLE tc_direct_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,sender_id TEXT NOT NULL,
 body TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(chat_id) REFERENCES tc_direct_chats(id),FOREIGN KEY(sender_id) REFERENCES users(id)
);
CREATE TABLE tc_chat_receipts (
 chat_id TEXT NOT NULL,user_id TEXT NOT NULL,delivered_id INTEGER DEFAULT 0,read_id INTEGER DEFAULT 0,
 updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(chat_id,user_id)
);
""")
conn.executescript((base/'migrations/02-v6-extras.sql').read_text())
for user,name in [('1','Satu'),('2','Dua')]:
 conn.execute("INSERT INTO users(id,username,email,display_name,email_verified) VALUES(?,?,?,?,1)",(user,name.lower(),name+'@example.com',name))
conn.execute("INSERT INTO tc_direct_chats(id,pair_key,user_a,user_b) VALUES('chat1','1:2','1','2')")
conn.execute("INSERT INTO tc_direct_messages(chat_id,sender_id,body) VALUES('chat1','1','halo')")
conn.execute("INSERT INTO tc_media_items(id,uploader_id,object_key,file_name,mime_type,file_size,status,expires_at) VALUES('file1','1','chats/chat1/file1','foto.png','image/png',1234,'available',datetime('now','+30 days'))")
conn.execute("INSERT INTO tc_media_links(message_id,media_id,chat_id) VALUES(1,'file1','chat1')")
conn.execute("INSERT INTO tc_media_backups(media_id,user_id,storage_type,storage_ref) VALUES('file1','2','google_drive','google-file-1')")
conn.execute("INSERT INTO tc_call_sessions(id,chat_id,caller_id,callee_id,kind) VALUES('call1','chat1','1','2','audio')")
conn.execute("INSERT INTO tc_call_signals(call_id,sender_id,kind,payload) VALUES('call1','1','offer','{}')")
msg=conn.execute('''SELECT m.id,m.sender_id,m.body,m.created_at,l.media_id,f.mime_type
 FROM tc_direct_messages m LEFT JOIN tc_media_links l ON l.message_id=m.id
 LEFT JOIN tc_media_items f ON f.id=l.media_id WHERE m.id IN
 (SELECT id FROM tc_direct_messages WHERE chat_id='chat1' ORDER BY id DESC LIMIT 100) ORDER BY m.id ASC''').fetchone()
assert msg[4:] == ('file1','image/png'),msg
assert conn.execute("SELECT COUNT(*) FROM tc_call_signals").fetchone()[0] == 1
# Simulasi penerima yang mengambil pesan di D1.
conn.execute('''INSERT INTO tc_chat_receipts(chat_id,user_id,delivered_id)
 SELECT c.id,?, COALESCE((SELECT MAX(m.id) FROM tc_direct_messages m WHERE m.chat_id=c.id AND m.sender_id<>?),0)
 FROM tc_direct_chats c WHERE (c.user_a=? OR c.user_b=?) AND EXISTS(
 SELECT 1 FROM tc_direct_messages m WHERE m.chat_id=c.id AND m.sender_id<>?)
 ON CONFLICT(chat_id,user_id) DO UPDATE SET delivered_id=MAX(tc_chat_receipts.delivered_id,excluded.delivered_id)
 ''',('2','2','2','2','2'))
assert conn.execute("SELECT delivered_id FROM tc_chat_receipts WHERE chat_id='chat1' AND user_id='2'").fetchone()[0]==1
print('PASS SQL: chat, media, signaling, receipt dan join pesan')
