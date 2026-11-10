# TemanChat — Tahap 1 (PWA demo)

Ini baru frontend demonstrasi. **Tidak ada akun, pesan, telepon, maupun video call sungguhan.** Jangan memasukkan password asli.

## Upload ke GitHub
Unggah isi folder ini (wrangler.jsonc, package.json, public, src) ke repository GitHub baru.

## Deploy ke Cloudflare
Workers & Pages > Create application > GitHub > pilih repository > deploy. Gunakan perintah deploy `npx wrangler deploy`. Pastikan nama Worker adalah `temanchat-app` agar sesuai dengan wrangler.jsonc. Jika nama itu sudah terpakai, sesuaikan juga pada konfigurasi.

## Lokal (opsional)
`npm install` kemudian `npm run dev`.

## Pemeriksaan
Buka halaman utama dan `/api/health`. Uji Install App pada browser yang mendukung.

## Tahap berikutnya
Cloudflare D1 untuk user/chat, autentikasi dengan verifikasi email dan password hash, otorisasi tiap pesan, Durable Objects untuk WebSocket, TURN/WebRTC untuk voice/video, notifikasi dan anti-spam.
