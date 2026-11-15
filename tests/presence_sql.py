"""Run actual conversation and people SQL against SQLite to catch broken joins/bindings."""
import sqlite3, re
from pathlib import Path
src=(Path(__file__).resolve().parents[1]/'src/index.js').read_text()
assert 'CREATE TABLE IF NOT EXISTS tc_user_presence' in src
assert "path==='/api/presence/heartbeat'" in src
assert "!allowOrigin(request)" in src
schema=re.search(r'`(CREATE TABLE IF NOT EXISTS tc_user_presence \([\s\S]*?\))`\)\.run\(\)',src)
assert schema, 'Actual schema not found'
con=sqlite3.connect(':memory:')
con.executescript('''
CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT,display_name TEXT,email_verified INTEGER);
CREATE TABLE tc_direct_chats(id TEXT PRIMARY KEY,user_a TEXT,user_b TEXT,created_at TEXT);
CREATE TABLE tc_direct_messages(id INTEGER PRIMARY KEY,chat_id TEXT,sender_id TEXT,body TEXT,created_at TEXT);
CREATE TABLE tc_chat_receipts(chat_id TEXT,user_id TEXT,delivered_id INTEGER,read_id INTEGER);
CREATE TABLE tc_chat_typing(chat_id TEXT,user_id TEXT,expires_at INTEGER,PRIMARY KEY(chat_id,user_id));
INSERT INTO users VALUES('a','aku_123','Aku',1),('b','teman_123','Teman',1),('c','tidak_123','Tidak',1);
INSERT INTO tc_direct_chats VALUES('chat','a','b',CURRENT_TIMESTAMP);
INSERT INTO tc_direct_messages VALUES(1,'chat','a','Halo',CURRENT_TIMESTAMP);
INSERT INTO tc_direct_messages VALUES(2,'chat','b','Hai',CURRENT_TIMESTAMP);
''')
con.execute(schema.group(1))
con.execute("INSERT INTO tc_user_presence VALUES('b', CAST(strftime('%s','now') AS INTEGER))")
query=re.search(r'const result=await env\.DB\.prepare\(`(SELECT c\.id, c\.created_at,[\s\S]*?LIMIT 100)`\)\.bind\(me\.id,me\.id,me\.id,me\.id,me\.id,me\.id\)\.all\(\)',src)
assert query, 'Query conversations did not match expected binding contract'
sql=query.group(1).replace('${PRESENCE_OFFLINE_SECONDS}','110')
con.row_factory=sqlite3.Row
r=con.execute(sql,('a',)*6).fetchone()
assert r and r['other_name']=='Teman' and r['is_online']==1 and r['call_unlocked']==1,dict(r) if r else None
last_active=r['last_active_at']
con.execute("UPDATE tc_user_presence SET last_active_at=CAST(strftime('%s','now') AS INTEGER)-180 WHERE user_id='b'")
r2=con.execute(sql,('a',)*6).fetchone()
assert r2['is_online']==0 and r2['last_active_at']<last_active
people=re.search(r'const found=await env\.DB\.prepare\(`(SELECT u\.username,u\.display_name,[\s\S]*?ORDER BY u\.username LIMIT 15)`\)\.bind\(me\.id,q\+\'%\'\)\.all\(\)',src)
assert people
rows=con.execute(people.group(1).replace('${PRESENCE_OFFLINE_SECONDS}','110'),('a','teman%')).fetchall()
assert len(rows)==1 and rows[0]['is_online']==0
assert not con.execute(people.group(1).replace('${PRESENCE_OFFLINE_SECONDS}','110'),('a','aku%')).fetchall(), 'Own username should not appear in search'
# Compare against other user that has never sent a presence heartbeat.
rows=con.execute(people.group(1).replace('${PRESENCE_OFFLINE_SECONDS}','110'),('a','tidak%')).fetchall()
assert rows[0]['last_active_at'] is None and rows[0]['is_online']==0
print('PASS V7.1 SQL: active/idle/never-online and two-way chat query.')
