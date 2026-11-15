// V7.4: referensi balasan tetap di D1 dan hanya boleh menunjuk pesan dalam percakapan yang sama.
let ready;
export function ensureReplySchema(env){
 if(!ready)ready=env.DB.prepare(`CREATE TABLE IF NOT EXISTS tc_reply_links (
  message_id INTEGER PRIMARY KEY, chat_id TEXT NOT NULL, reply_to_id INTEGER NOT NULL,
  FOREIGN KEY(message_id) REFERENCES tc_direct_messages(id) ON DELETE CASCADE,
  FOREIGN KEY(reply_to_id) REFERENCES tc_direct_messages(id) ON DELETE CASCADE
 )`).run().catch(err=>{ready=null;throw err});
 return ready;
}
export async function validateReply(env,chatId,replyToId){
 if(replyToId===null||replyToId===undefined||replyToId==='')return null;
 const id=Number(replyToId);
 if(!Number.isSafeInteger(id)||id<1)throw Error('Pesan yang dibalas tidak valid.');
 const row=await env.DB.prepare('SELECT id,body,sender_id FROM tc_direct_messages WHERE id=? AND chat_id=?').bind(id,chatId).first();
 if(!row)throw Error('Pesan yang dibalas tidak ditemukan dalam percakapan.');
 return row;
}
export async function storeReply(env,messageId,chatId,reply){
 if(!reply)return;
 await ensureReplySchema(env);
 await env.DB.prepare('INSERT INTO tc_reply_links(message_id,chat_id,reply_to_id) VALUES(?,?,?)').bind(messageId,chatId,reply.id).run();
}
