"""Deterministic test for two-way-message condition used by call start and chat UI."""
import sqlite3
from pathlib import Path
root=Path(__file__).resolve().parents[1]
server=(root/'src'/'extras.js').read_text()
worker=(root/'src'/'index.js').read_text()
app=(root/'public'/'app.js').read_text()
assert "SELECT 1 FROM tc_direct_messages WHERE chat_id=? AND sender_id=?" in server
assert "if(!Number(exchange?.caller_sent)||!Number(exchange?.callee_replied))" in server
assert server.index('if(!Number(exchange?.caller_sent)') < server.index("INSERT INTO tc_call_sessions")
assert 'AS call_unlocked' in worker
assert 'if(!Number(active.call_unlocked||0))' in app
con=sqlite3.connect(':memory:')
con.executescript('''
 CREATE TABLE tc_direct_chats(id TEXT PRIMARY KEY,user_a TEXT,user_b TEXT,created_at TEXT);
 CREATE TABLE tc_direct_messages(id INTEGER PRIMARY KEY,chat_id TEXT,sender_id TEXT,body TEXT,created_at TEXT);
 CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT,display_name TEXT);
 CREATE TABLE tc_chat_receipts(chat_id TEXT,user_id TEXT,read_id INTEGER);
 INSERT INTO users VALUES('a','a_abc','A'),('b','b_abc','B');
 INSERT INTO tc_direct_chats VALUES('chat1','a','b',CURRENT_TIMESTAMP);
''')
q='''SELECT EXISTS(SELECT 1 FROM tc_direct_messages WHERE chat_id=? AND sender_id=?) AS caller_sent,
     EXISTS(SELECT 1 FROM tc_direct_messages WHERE chat_id=? AND sender_id=?) AS callee_replied'''
def unlocked(caller,callee):
    row=con.execute(q,('chat1',caller,'chat1',callee)).fetchone()
    return bool(row[0] and row[1])
assert not unlocked('a','b') and not unlocked('b','a')
con.execute("INSERT INTO tc_direct_messages(chat_id,sender_id,body,created_at) VALUES('chat1','a','Hi',CURRENT_TIMESTAMP)")
assert not unlocked('a','b') and not unlocked('b','a'), 'Satu pesan sepihak tidak membuka panggilan'
con.execute("INSERT INTO tc_direct_messages(chat_id,sender_id,body,created_at) VALUES('chat1','a','Hi lagi',CURRENT_TIMESTAMP)")
assert not unlocked('a','b'), 'Banyak pesan sepihak tidak membuka panggilan'
con.execute("INSERT INTO tc_direct_messages(chat_id,sender_id,body,created_at) VALUES('chat1','b','Halo',CURRENT_TIMESTAMP)")
assert unlocked('a','b') and unlocked('b','a'), 'Balasan membuka panggilan dua arah'
# Validate the ACTUAL conversations query and binding count, not a paraphrase.
import re
m=re.search(r"const result=await env\.DB\.prepare\(`(SELECT c\.id, c\.created_at,[\s\S]*?LIMIT 100)`\)\.bind\(me\.id,me\.id,me\.id,me\.id,me\.id,me\.id\)\.all\(\)",worker)
assert m, 'Conversation query/bindings mismatch'
con.execute("INSERT INTO tc_chat_receipts VALUES('chat1','a',0)")
rows=con.execute(m.group(1),('a','a','a','a','a','a')).fetchall()
assert len(rows)==1 and rows[0][-1]==1, 'Conversation should be unlocked after two-way exchange'
print('PASS: panggilan baru terkunci sampai kedua akun masing-masing membalas, lalu terbuka dua arah.')
