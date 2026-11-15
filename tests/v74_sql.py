import sqlite3
c=sqlite3.connect(':memory:')
c.executescript('''
PRAGMA foreign_keys=ON;
CREATE TABLE users(id TEXT PRIMARY KEY);
CREATE TABLE tc_direct_chats(id TEXT PRIMARY KEY,user_a TEXT,user_b TEXT);
CREATE TABLE tc_direct_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT,sender_id TEXT,body TEXT,created_at TEXT);
CREATE TABLE tc_reply_links(message_id INTEGER PRIMARY KEY,chat_id TEXT NOT NULL,reply_to_id INTEGER NOT NULL,
 FOREIGN KEY(message_id) REFERENCES tc_direct_messages(id) ON DELETE CASCADE,
 FOREIGN KEY(reply_to_id) REFERENCES tc_direct_messages(id) ON DELETE CASCADE);
CREATE TABLE tc_media_preferences(user_id TEXT PRIMARY KEY,save_mode TEXT NOT NULL DEFAULT 'none'
 CHECK(save_mode IN ('none','local','google_drive','nextcloud')),notice_seen_at TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
INSERT INTO users VALUES('a'),('b');
INSERT INTO tc_direct_chats VALUES('c','a','b');
INSERT INTO tc_direct_messages(chat_id,sender_id,body) VALUES('c','a','Pesan awal'),('c','b','Balasan');
INSERT INTO tc_reply_links VALUES(2,'c',1);
''')
x=c.execute('''SELECT m.id,m.sender_id,m.body,m.created_at,r.reply_to_id,original.body AS reply_body, original.sender_id AS reply_sender_id
FROM tc_direct_messages m LEFT JOIN tc_reply_links r ON r.message_id=m.id
LEFT JOIN tc_direct_messages original ON original.id=r.reply_to_id AND original.chat_id=m.chat_id
WHERE m.chat_id=? ORDER BY m.id''',('c',)).fetchall()
assert x[1][-3:]==(1,'Pesan awal','a')
c.execute("INSERT INTO tc_media_preferences(user_id,save_mode,notice_seen_at) VALUES('a','none',NULL)")
assert c.execute("SELECT save_mode FROM tc_media_preferences WHERE user_id='a'").fetchone()[0]=='none'
print('PASS V7.4 SQL: Reply join & default none preference')
