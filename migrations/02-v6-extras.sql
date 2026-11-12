-- Referensi: skema ini dibangun OTOMATIS oleh Worker saat endpoint V6 dipakai.
-- Tidak perlu dijalankan manual pada D1 kamu yang sudah ada.
CREATE TABLE IF NOT EXISTS tc_media_items (
 id TEXT PRIMARY KEY,uploader_id TEXT NOT NULL,object_key TEXT NOT NULL UNIQUE,
 file_name TEXT NOT NULL,mime_type TEXT NOT NULL,file_size INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at TEXT NOT NULL,deleted_at TEXT,
 FOREIGN KEY(uploader_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS tc_media_receipts (
 media_id TEXT NOT NULL,user_id TEXT NOT NULL,downloaded_at TEXT,
 storage_type TEXT,storage_verified_at TEXT,
 PRIMARY KEY(media_id,user_id),
 FOREIGN KEY(media_id) REFERENCES tc_media_items(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS tc_media_links (
 message_id INTEGER PRIMARY KEY,
 media_id TEXT NOT NULL UNIQUE,
 chat_id TEXT NOT NULL,
 FOREIGN KEY(message_id) REFERENCES tc_direct_messages(id) ON DELETE CASCADE,
 FOREIGN KEY(media_id) REFERENCES tc_media_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tc_media_chat ON tc_media_links(chat_id);
CREATE TABLE IF NOT EXISTS tc_media_backups (
 media_id TEXT NOT NULL,user_id TEXT NOT NULL,
 storage_type TEXT NOT NULL,storage_ref TEXT NOT NULL,
 verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(media_id,user_id),
 FOREIGN KEY(media_id) REFERENCES tc_media_items(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS tc_call_sessions (
 id TEXT PRIMARY KEY,chat_id TEXT NOT NULL,caller_id TEXT NOT NULL,callee_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('audio','video')),
 status TEXT NOT NULL DEFAULT 'ringing' CHECK(status IN ('ringing','answered','declined','ended','missed')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(chat_id) REFERENCES tc_direct_chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tc_calls_incoming ON tc_call_sessions(callee_id,status,created_at);
CREATE TABLE IF NOT EXISTS tc_call_signals (
 id INTEGER PRIMARY KEY AUTOINCREMENT,call_id TEXT NOT NULL,sender_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('offer','answer','candidate')),
 payload TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(call_id) REFERENCES tc_call_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tc_call_signals ON tc_call_signals(call_id,id);
