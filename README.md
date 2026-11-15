# TemanChat V7.0 — Timer, Foto Profil, Keamanan Email & Panggilan Setelah Saling Chat

**Aturan baru:** panggilan suara/video baru dapat dimulai setelah **kedua akun masing-masing pernah mengirim minimal satu pesan** dalam percakapan yang sama. Setelah ada balasan, panggilan langsung terbuka; tidak perlu berulang kali memenuhi syarat. Pemeriksaan dijalankan di Cloudflare Worker, bukan sekadar menyamarkan tombol. Pada percakapan lama yang sudah dua arah, fitur panggilan langsung tetap tersedia.

Masih mencakup timer panggilan setelah WebRTC terhubung, foto profil kecil di D1, lihat email akun, dan ganti email memakai password serta verifikasi email baru. Tidak perlu membuat ulang kunci, akun, atau database.

# TemanChat V7.0 — Durasi Panggilan & Foto Profil

**Dasar:** proyek lengkap V6.9 Glass Monokrom. Desain terang/gelap, notifikasi Web Push, status pesan, dan pengaturan lama dipertahankan.

## Perubahan V7.0

- **Timer panggilan langsung**: `Terhubung · 00:00` kemudian `00:01`, `00:02`, dan seterusnya. Dimulai **hanya ketika koneksi WebRTC mencapai state connected**, bukan saat menekan tombol telepon atau saat lawan mulai berdering. Timer muncul di bagian atas panel video maupun audio. Berhenti otomatis saat panggilan berakhir.
- **Audio-only tetap menampilkan avatar dan nama teman**, serta menggunakan elemen audio tersendiri.
- **Foto profil**: Pengaturan → Foto profil saya → Pilih foto → Simpan foto profil. JPG/PNG/WEBP/GIF dikonversi di browser menjadi JPEG persegi kecil (maksimal 60 KB), lalu disimpan di D1. Terlihat di daftar teman, bagian atas chat, tampilan panggilan, dan profil sendiri. Foto dapat dihapus. @username/email tidak berubah.
- **Tidak perlu Cloudflare R2 untuk FOTO PROFIL**. Pengiriman foto dan video chat tetap memerlukan R2.
- **Database**: tabel `tc_profile_avatars` dibuat otomatis saat endpoint avatar dipakai. Tidak perlu menjalankan SQL manual. Gambar hanya dikirim ke pengguna terautentikasi; satu pengguna hanya dapat mengubah fotonya sendiri.

## Cara memasang

1. Cadangkan folder proyek versi sebelumnya.
2. Ekstrak ZIP V7.0; salin **semua isi folder** ke `Documents\GitHub\temanchat-app` (pilih **Replace**).
3. GitHub Desktop → Commit `TemanChat V7.0 Foto Profil Durasi Panggilan` → **Push origin**.
4. Cloudflare Workers → Deployments → pastikan **Ready**.
5. Buka `chat.ege.my.id`, hard-refresh di desktop. Di iPhone tutup-buka PWA untuk mendapatkan aset baru.
6. Atur foto profil melalui Pengaturan, lalu login akun teman untuk memastikan foto tampil.
7. Uji panggilan suara/video dengan dua perangkat: `Memanggil` → `Berdering` → `Terhubung · 00:00` → timer berjalan.

## Keterbatasan

- Durasi dihitung secara lokal pada masing-masing perangkat sejak sambungan peer benar-benar connected. Selisih beberapa detik antar-perangkat normal. Durasi belum tersimpan di riwayat panggilan.
- Foto profil diperkecil dan disimpan di D1 sebagai base64 JPEG, cocok untuk kelompok kecil. Untuk banyak pengguna atau foto beresolusi tinggi, sebaiknya migrasi ke R2/Images.
- Bila jaringan berbeda dan WebRTC gagal, TURN tetap mungkin diperlukan. Sistem notifikasi iPhone mengikuti batasan PWA.
- Belum diuji pada Cloudflare milik pengguna; lakukan pengujian dua akun setelah deployment.

## Pemeriksaan lokal

`npm run check` — pemeriksaan sintaks dan kontrak UI/Web Push (Node.js).

---

# TemanChat V7.0 — Foto Profil, Timer Panggilan & Keamanan Email

# TemanChat V6.9 — Glass Monokrom UI

Pembaruan ini memoles **antarmuka** dari V6.8 dan **mempertahankan backend**. Tidak perlu membuat ulang akun, kunci VAPID, database D1, atau Secrets Cloudflare.

## Perubahan V6.9

- **Tema gelap monokrom:** latar charcoal, panel kaca abu gelap, teks terang, sedikit aksen hijau.
- **Tema terang:** kaca putih susu, latar netral, teks dan ikon kontras.
- **Pilihan tema terlihat langsung di sidebar:** **Terang / Gelap / Sistem**. Tetap bisa diganti dari Pengaturan.
- **Ikon outline SVG lokal** untuk telepon, video, riwayat, pengaturan, instal, pencarian, lampiran, kirim, kembali, dan panggilan.
- **Perbaikan keterbacaan:** tombol aktif tidak samar; placeholder, nama teman, jam pesan, status, dan kontrol lebih jelas.
- **Responsive:** desain desktop/HP tidak melebar, serta input 16 px untuk mencegah zoom otomatis Safari iPhone.
- **Audio/Video:** ikon tombol saat panggilan tidak lenyap setelah mikrofon atau kamera diganti statusnya.
- **Service Worker/cache:** versi asset diperbarui menjadi V6.9.

## Fitur V6.8 yang dipertahankan

Pendaftaran dan login, pencarian teman, pesan D1, tanda terkirim/diterima/dibaca, badge belum dibaca, Web Push, pengaturan notifikasi ON/OFF, daftar panggilan, panggilan WebRTC, pengubahan nama panggilan, serta konfigurasi media opsional dan penyimpanan pribadi.

## Cara instal (GitHub Desktop)

1. **Cadangkan** folder repository `temanchat-app` yang lama.
2. Ekstrak ZIP ini, lalu **salin seluruh ISINYA** ke `Documents/GitHub/temanchat-app` dan pilih **Replace files**.
3. Jangan menghapus folder `.git` dan jangan memasukkan file ke folder tambahan.
4. GitHub Desktop → **Changes** → Summary `TemanChat V6.9 Glass Monokrom` → **Commit to main** → **Push origin**.
5. Periksa Cloudflare → Workers & Pages → `temanchat-app` → Deployments hingga **Ready**.
6. Desktop: `Ctrl + Shift + R`. iPhone/Android PWA: tutup dan buka kembali aplikasi dari Layar Utama setelah deployment. Jangan hapus data situs jika menyimpan media lokal.

## Pengujian yang disarankan

- Terang → Gelap → Sistem tanpa refresh.
- Kontras tombol telepon, video, pengaturan, dan kolom input di kedua tema.
- Cari teman dan buka percakapan di HP.
- Kirim pesan dan langsung lanjut mengetik.
- Periksa bahwa jumlah belum dibaca dan centang biru masih berfungsi.
- Periksa notifikasi Web Push dan panggilan pada dua perangkat, tanpa membagikan kunci privat.

## Keterangan teknis

- UI dirender pada simulasi ukuran desktop 1440 × 900 dan mobile 390 × 844; penggantian tema dan kirim pesan diuji dengan API tiruan. **Belum diuji di Cloudflare dan perangkat milik pengguna.**
- Di platform yang meminta pengurangan transparansi, efek blur akan dinonaktifkan untuk aksesibilitas.
- Media tetap memerlukan Cloudflare R2, dan panggilan beda jaringan mungkin membutuhkan TURN.
- **Tidak ada file `.env` atau kunci rahasia dalam paket.** Variabel VAPID/Resend/Turnstile tetap di Cloudflare.

Referensi rinci: `PANDUAN-V6.9.txt`.
