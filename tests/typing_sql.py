import sqlite3,time,uuid
c=sqlite3.connect(':memory:')
c.executescript('''CREATE TABLE users(id TEXT PRIMARY KEY);
CREATE TABLE tc_direct_chats(id TEXT PRIMARY KEY,user_a TEXT,user_b TEXT);
CREATE TABLE tc_chat_typing(chat_id TEXT NOT NULL,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL,
 PRIMARY KEY(chat_id,user_id),FOREIGN KEY(chat_id) REFERENCES tc_direct_chats(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);''')
a,b='A','B'; chat=str(uuid.uuid4());now=int(time.time())
c.executemany('INSERT INTO users(id) VALUES(?)',[(a,),(b,)])
c.execute('INSERT INTO tc_direct_chats VALUES (?,?,?)',(chat,a,b))
def begin(user):
 c.execute('''INSERT INTO tc_chat_typing(chat_id,user_id,expires_at)
 VALUES(?,?,CAST(strftime('%s','now') AS INTEGER)+9)
 ON CONFLICT(chat_id,user_id) DO UPDATE SET expires_at=excluded.expires_at
 WHERE tc_chat_typing.expires_at<CAST(strftime('%s','now') AS INTEGER)+5''',(chat,user))
def flag(user):
 return c.execute('''SELECT 1 FROM tc_chat_typing WHERE chat_id=? AND user_id=? AND expires_at>CAST(strftime('%s','now') AS INTEGER)''',(chat,user)).fetchone() is not None
begin(a);assert flag(a) and not flag(b)
expiry=c.execute('SELECT expires_at FROM tc_chat_typing').fetchone()[0]
begin(a)
assert c.execute('SELECT expires_at FROM tc_chat_typing').fetchone()[0]==expiry, 'rate-limited heartbeat'
c.execute('UPDATE tc_chat_typing SET expires_at=? WHERE user_id=?',(now-1,a));assert not flag(a)
begin(a);assert flag(a)
c.execute('DELETE FROM tc_chat_typing WHERE chat_id=? AND user_id=?',(chat,a));assert not flag(a)
print('PASS V7.2: typing SQL, expiry, heartbeat throttling, and stop.')
