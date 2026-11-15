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
