# Pembaruan TemanChat V6.7 (beta)

Paket ini melanjutkan **V6.6**. Lihat `PANDUAN-V6.7.txt` untuk pemasangan.

- Web Push: penerima yang sah mengirim ACK `/api/chat/push-delivered` saat Service Worker memproses pesan. Centang dua tidak dijamin jika sesi cookie tidak tersedia pada background.
- Badge ikon PWA: angka unread pada iOS jika didukung; Android menampilkan sesuai launcher.
- Pengaturan ON/OFF push benar-benar unsubscribe/resubscribe perangkat. Izin sistem OS tetap diatur melalui Settings.
- Nada panggilan lokal berbeda antara outgoing dan incoming (hanya ketika aplikasi aktif).
- UI transparansi glass, desktop responsif, gambar terbatasi ukuran layar, input tidak kehilangan fokus setelah mengirim.
- Anti-spam: 100 pesan/menit, 50 pesan sama/menit, 10 pesan/5 detik.
- Tidak memerlukan secret atau migrasi D1 baru; status masih menggunakan tabel yang sudah ada. R2/TURN tetap pilihan terpisah.

---

# TemanChat V6.6 — Web Push

Perubahan utama adalah Web Push berbasis VAPID dan enkripsi RFC8291. Lihat `PANDUAN-V6.6-WEB-PUSH.txt`.

# TemanChat V6 Terpadu (BETA) — Cloudflare Workers + D1

**Target aplikasi:** chat pribadi 1:1 untuk keluarga & teman, Android/iPhone/komputer, PWA install, satu akun banyak perangkat. Proyek ini menggabungkan file frontend/backend sebelumnya supaya tidak perlu mengganti file satu per satu setiap kali.

## Fitur dan batasannya

| Fitur | Status |
|---|---|
| Pendaftaran email, verifikasi Resend, login, lupa password, logout | Berkode, harus diuji pada deployment |
| Chat teks antar akun dan pencarian username | Berkode, memakai tabel D1 V5 yang sudah dibuat |
| Navigasi mobile dan desktop, tombol kembali, instal PWA | Berkode |
| Anti-spam pesan berulang dan rate-limit | Berkode |
| Media dari perangkat, R2 transit, download lokal | Berkode; **perlu bucket R2 dan binding MEDIA** |
| Google Drive milik pengguna | Integrasi upload langsung disiapkan; **perlu Google OAuth Client ID, izin dan kondisi Wi-Fi yang dapat diverifikasi** |
| Nextcloud/WebDAV/server pribadi | **Belum diaktifkan**; memerlukan integrasi aman per penyedia |
| Telepon suara dan video dua orang | WebRTC + signaling D1 eksperimental; uji dua perangkat, **TURN belum tersedia** |
| Push notifikasi dan panggilan saat PWA ditutup | **Belum didukung** |
| Enkripsi end-to-end (E2EE) | **Belum tersedia**; jangan kirim informasi sangat sensitif |

Paket ini tidak mengubah atau menghapus tabel lama dan tidak meminta Secret Key. Untuk penggunaan publik perlu pengujian beban, keamanan, dan kebijakan data.

## Instalasi SEKALI di GitHub

1. **Simpan salinan / backup** repository `kasihterma-star/temanchat-app` atau buat tag versi sebelum mengganti.
2. Ekstrak ZIP paket ini. Masukkan **semua file/folder dari isi ZIP ke akar repository yang sudah ada**, pertahankan nama folder `src`, `public`, `migrations`, `tests`. Jangan unggah ZIP sebagai satu file ke repo. File lama dengan nama sama ditimpa.
3. `wrangler.jsonc` sudah memakai database `temanchat-db` dengan binding `DB` yang sudah dipakai. **Jangan mengubah database ID** dan jangan menghapus Secret Worker yang lama (`TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`).
4. Commit ke branch `main` sekaligus, bukan file demi file. Deployment GitHub→Cloudflare dijalankan satu kali.
5. Periksa status **Ready**, lalu uji `https://chat.ege.my.id/api/health` dan buka `https://chat.ege.my.id` dari HP & komputer.

**Catatan Cloudflare Workers Free:** CPU request 10 ms; PBKDF2 100.000 iterasi sudah pernah diuji pada akun ini namun tetap perlu pantau Live Logs. Jika error, rollback ke commit GitHub sebelumnya.

## Uji chat utama (tidak perlu tambahan SQL)

1. Akun A masuk di Chrome komputer. Akun B masuk di browser HP/Incognito menggunakan email terverifikasi.
2. Cari username B dari akun A. Klik hasil → percakapan membuka. Ketik pesan.
3. Periksa pesan masuk di B (polling ~4 detik), balas, refresh kedua perangkat. Klik tombol kembali di HP.
4. Uji logout dan buka `/api/auth/me` setelah logout: status harus 401.
5. R2 belum tersambung? **Chat teks tetap berjalan**. Lampiran akan menjelaskan bahwa R2 belum aktif.

## Aktivasi foto/video — konfigurasi SEKALI

1. Cloudflare → R2 Object Storage → buat **bucket `temanchat-media`**, jangan gunakan bucket Moments/Absensi.
2. **Supaya tidak perlu mengedit potongan kode**, buka file `wrangler-media-ready.jsonc` dari ZIP dan salin semua isinya untuk mengganti `wrangler.jsonc` di GitHub. Jangan mengganti nama file menjadi `wrangler-media-ready.jsonc` di GitHub; hanya ambil isinya. Contoh binding yang ditambahkan adalah `"r2_buckets": [{ "binding": "MEDIA", "bucket_name": "temanchat-media" }]`.

3. Deploy lagi **setelah bucket ada**. Halaman `https://chat.ege.my.id/api/media/config` butuh login; jika `enabled:true`, pengiriman foto/video/file lokal aktif. Ukuran maksimal 20 MB.
4. Atur **R2 Object Lifecycle** bucket `temanchat-media` → hapus objek setelah **30 hari** sebagai jaring pengaman. Worker juga menjadwalkan pemeriksaan masa berlaku setiap hari. Sebelum 30 hari, media dihapus dari R2 hanya ketika server memverifikasi salinan Google Drive penerima (jika Drive telah dikonfigurasi).

R2 tidak langsung menghapus file hanya dari centang dua. Pengirim memilih media dari galeri/berkas lokal; file asli di galeri tidak disentuh.

## Google Drive pengguna (opsional)

1. Di Google Cloud Console, buat OAuth 2.0 Client ID jenis **Web application** untuk TemanChat, dengan Authorized JavaScript origin `https://chat.ege.my.id`.
2. Konfigurasikan OAuth Consent Screen / pengguna yang boleh mengakses. Jika masih Testing, hanya akun penguji yang dapat memakai fitur Google Drive.
3. Isi Client ID publik pada `public/config.js`, contoh: `googleClientId: 'xxxx.apps.googleusercontent.com'`. **Jangan isi Client Secret Google atau token akses di GitHub.**
4. Pengguna memilih Google Drive pada Pengaturan, menghubungkan akunnya, lalu tekan **Backup ke Google Drive** pada foto yang dibuka. Hanya berjalan jika browser dapat memverifikasi koneksi Wi-Fi (`navigator.connection.type`); di iPhone/Safari deteksi ini sering tidak tersedia. Aplikasi tidak menebak Wi-Fi dari kecepatan koneksi.
5. Google Drive diperiksa lewat API untuk memastikan ukuran file cocok sebelum R2 dihapus. Token akses berada sementara di memori browser. Salinan lokal cache yang sudah terverifikasi baru dibersihkan setelah 3 hari; media lokal yang disimpan permanen tidak ikut dihapus otomatis.

**Batasan:** backup otomatis di background ketika PWA ditutup belum tersedia. Integrasi Google OAuth dan Drive belum diuji end-to-end pada akun pengguna; perlu uji dengan akun sendiri sebelum digunakan luas.

## Telepon / video call

- Dua pengguna harus membuka TemanChat. Klik ☎ atau ▣, penerima akan melihat panggilan masuk saat aplikasi terbuka (polling setiap 4 detik).
- Izinkan mikrofon/kamera. WebRTC memakai STUN publik; **belum ada TURN** sehingga sebagian kombinasi operator seluler/NAT tidak akan tersambung.
- Belum ada notifikasi push agar panggilan berdering saat aplikasi ditutup, dan panggilan multi-device belum dikoordinasikan secara sempurna. Ini fitur eksperimental, bukan pengganti WhatsApp.
- Data suara/video tidak direkam oleh TemanChat.

## Keamanan dan pengelolaan

- Percakapan hanya dibaca peserta yang mempunyai sesi aktif. HTML/JS statis bisa diakses, tetapi data API memerlukan login.
- Password disimpan sebagai PBKDF2 SHA-256 salted 100.000 iterasi (batas platform yang sebelumnya dilaporkan). Untuk rilis lebih luas, perlu evaluasi kekuatan hashing dan biaya CPU di Workers Free.
- Pesan teks di D1 **belum E2EE** dan file R2 **belum enkripsi sisi klien**. Jika ingin privasi seperti aplikasi messenger besar, E2EE masih proyek lanjutan.
- Untuk update berikutnya cukup edit file dalam repository yang sama, commit sekali, kemudian uji di HP dan komputer.
- Jika ada kegagalan, Cloudflare → Workers & Pages → Deployments → rollback ke deployment sebelumnya atau revert commit GitHub.

## Struktur proyek

```
src/index.js              Autentikasi dan chat teks
src/extras.js             Pengiriman media dan sinyal WebRTC
public/index.html         Tampilan chat mobile/desktop
public/app.js             Interaksi chat, media, panggilan
public/style.css          Desain utama lama
public/v6.css             Penyesuaian mobile dan panggilan
public/auth.html          Form login/daftar
public/auth.js            Frontend autentikasi
public/auth.css           Tampilan autentikasi
public/storage.js         Cache IndexedDB dan Google Drive opsional
public/config.js          Client ID Google (publik, default kosong)
public/sw.js              Service Worker PWA
public/manifest.webmanifest
wrangler.jsonc            Config Cloudflare Workers/D1/Cron; R2 opsional
migrations/02-v6-extras.sql   Referensi SQL, Worker menginisialisasi otomatis
wrangler-media-ready.jsonc    Template config siap tempel jika bucket R2 tersedia
```


## Perbaikan 6.1 (12 November 2026)
Login Turnstile: label tombol otomatis menyesuaikan status dan pemeriksaan token secara berkala mengatasi kondisi widget 'Success' tetapi tombol tetap disabled. Tidak ada perubahan pada tabel D1.


## V6.4: status pesan & notifikasi halaman aktif
- `✓` setelah tersimpan di D1 (terkirim ke server).
- `✓✓` abu setelah akun penerima aktif dan mengambil pesan melalui API (diterima pada aplikasi yang aktif).
- `✓✓` biru setelah penerima membuka percakapan di halaman yang terlihat dan API read berhasil.
- Tabel `tc_chat_receipts` dibuat otomatis pada permintaan chat pertama. Tidak perlu migrasi manual.
- Notifikasi browser diperbaiki menggunakan `serviceWorker.showNotification` jika tersedia dan mendeteksi pesan via ID.
- **Belum Web Push:** notifikasi saat app ditutup/ditangguhkan tetap tidak bisa dijamin.


## V6.5: pesan belum dibaca
Setiap daftar chat menampilkan badge jumlah pesan masuk di atas watermark baca terakhir
(tc_chat_receipts.read_id), dan badge otomatis dibersihkan setelah pesan ditampilkan.
Notifikasi lokal diperbaiki, tetapi NOT Web Push background: aplikasi ditutup sepenuhnya tetap tidak menerima notifikasi.
