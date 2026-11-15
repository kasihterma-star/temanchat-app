# TemanChat V7.4 — Reply, Pesan Suara & Penyimpanan Media

**Paket proyek lengkap**, melanjutkan V7.3. Desain Glass Monokrom, autentikasi, percakapan, centang, Web Push, panggilan, status Online/Offline, Sedang Mengetik, dan pengingat instal tetap disertakan.

## Yang aktif pada V7.4

- **Balas pesan:** geser gelembung pesan ke kanan di HP, atau klik **⋯ → Balas pesan** di desktop. Rujukan pesan asli disimpan ke tabel baru `tc_reply_links` di Cloudflare D1 (dibuat otomatis). Bisa membalas teks maupun pesan media.
- **Pesan suara:** tekan dan tahan tombol 🎙 pada HP. Lepas untuk mengirim, geser ke atas untuk mengunci, geser ke kiri untuk membatalkan. Setelah terkunci tersedia Jeda/Lanjut, Batal, Kirim. Pada desktop, klik mikrofon untuk mulai merekam dan gunakan tombol Kirim/Batal pada panel. Rekaman diunggah ke R2 privat, maksimal 25 MB / 3 menit, lalu dapat diputar di percakapan.
- **Pemberitahuan foto pertama:** tampil hanya ketika akun pertama kali melihat foto yang diterima di percakapan. Dua tombol: **Mengerti** dan **Pengaturan**. Pilihan tercatat per akun di tabel `tc_media_preferences` (dibuat otomatis).
- **Media:** pilihan menyimpan file ada di menu **⋯** pada pesan; default akun **Tidak simpan otomatis**. Pilihan simpan manual ke perangkat tetap tersedia.
- **Folder lokal:** Chrome/Edge desktop atau browser lain yang mendukung `showDirectoryPicker` dapat memilih folder penyimpanan. Pilihan lokal di browser tanpa izin folder menyimpan salinan permanen dalam penyimpanan aplikasi (IndexedDB), **bukan otomatis ke galeri**.
- **Pengaturan → Panduan Penyimpanan & Media** tersedia kapan saja.
- **R2:** untuk media baru, masa transit awal ditetapkan sekitar **3 hari** (cron menghapus setelah melewati masa tersebut). Jika akun penerima sudah memilih mode backup cloud, pembersihan ditahan sampai bukti backup tersedia; pantau kapasitas R2 untuk file tertunda. Media lama dari versi terdahulu tetap menggunakan waktu kedaluwarsa yang tersimpan sebelumnya.

## Batasan yang perlu diketahui

1. **Google Drive otomatis belum aktif secara universal.** File `public/config.js` belum berisi OAuth Client ID; kamu harus menyiapkan OAuth resmi agar opsi Drive bisa dipilih. Kode backup Google pada versi sebelumnya dipertahankan, tetapi tidak boleh dianggap aktif tanpa konfigurasi dan pengujian izin.
2. **Nextcloud/CasaOS belum tersambung.** Pilihan tersebut terlihat sebagai rencana tetapi tidak dapat diaktifkan sampai konektor dibuat.
3. **File besar lewat Google Drive pengirim belum aktif**. V7.4 tetap membatasi foto/video/dokumen lewat Worker hingga 20 MB; audio hingga 25 MB. Upload video besar memerlukan alur terpisah agar tidak melewati batas Cloudflare Workers.
4. **PWA iPhone/Android tidak dapat dipaksa menulis file secara diam-diam ke galeri/folder**. Lokasi unduhan mengikuti izin sistem. Pilihan lokal di aplikasi saat aplikasi aktif memakai penyimpanan browser dan bisa hilang jika data situs dibersihkan.
5. Rekaman mikrofon memerlukan izin browser; codec yang didukung berbeda antara Safari dan Chrome. Uji langsung pada iPhone/Android sebelum dipakai secara luas.
6. Ini bukan enkripsi ujung-ke-ujung (E2EE) untuk isi chat dan media. R2 tetap **private** dan berkas disajikan hanya lewat endpoint yang memeriksa keanggotaan percakapan.

## Pasang dari GitHub Desktop

1. Ekstrak ZIP dan salin **semua isi root** paket ke `Documents/GitHub/temanchat-app`.
2. Pilih **Replace files in the destination**, jangan menyalin folder ZIP sebagai subfolder.
3. Di GitHub Desktop: **Commit to main → Push origin**.
4. Di Cloudflare pastikan worker `temanchat-app` status **Ready** dan binding D1 `DB` + R2 `MEDIA` tersedia.
5. Refresh aplikasi dengan paksa di desktop; di iPhone tutup lalu buka ulang PWA dari Layar Utama.

Tidak perlu mengulang VAPID, akun login, atau menjalankan SQL manual. Tabel baru dibuat oleh backend secara otomatis.

## Pemeriksaan dilakukan

- `npm run check` lulus: sintaks JS, Web Push crypto, aturan panggilan, presence, typing, struktur UI, SQL Reply dan preferensi media.
- Pengujian browser HTML/CSS melalui Chromium **simulasi API**: ukuran 390 px dan 1280 px, balas pesan ber-ID yang benar, pemberitahuan pertama, dan fokus input. Tidak ada error JavaScript / overflow.
- Simulasi MediaRecorder desktop: Batal tidak mengunggah, Kirim menghasilkan satu request pengiriman media.

**Belum diuji langsung di akun Cloudflare dan HP pengguna.** Cadangkan repository/commit lama sebelum mengganti file; semua pengujian lokal tidak menggantikan pengujian produksi.
