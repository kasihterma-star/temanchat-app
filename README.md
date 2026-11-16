# TemanChat V7.5 FULL — Smart Notification, Swipe Reply, Voice Glass

Paket lengkap penerus TemanChat V7.4. Desain **Glass Monokrom** dan seluruh fitur lama (akun, status online, R2, Web Push, centang, media, panggilan, foto profil, dan rekam suara) dipertahankan.

## Pembaruan yang diterapkan

1. **Notifikasi pintar per percakapan.** Saat notifikasi ON dan TemanChat aktif menampilkan chat dengan A, pesan baru A **tidak memicu push** atau suara tambahan. Chat B tetap memberi notifikasi. Setelah meninggalkan chat A, meminimalkan aplikasi, mematikan layar, berpindah tab/aplikasi, atau mengunci HP, notifikasi A kembali aktif. Panggilan masuk tidak dibisukan oleh fitur ini.
2. **Notifikasi OFF dari Pengaturan.** Mematikan semua notifikasi membatalkan langganan Web Push di perangkat tersebut dan menghentikan bunyi panggilan serta notifikasi lokal. Notifikasi OFF **tidak mematikan chat, panggilan, atau angka belum dibaca di dalam aplikasi**. UI panggilan masuk saat TemanChat terbuka tetap bisa ditampilkan tanpa suara. Pilihan OFF tersimpan di perangkat dan ON bisa mengaktifkan kembali dengan izin notifikasi perangkat. Preferensi OFF **berlaku per instalasi/perangkat**, bukan semua perangkat pengguna sekaligus.
3. **Balas dengan geser.** Pada layar sentuh, geser bubble ke kanan sekitar **62 px**. Bubble mengikuti jari dan menampilkan tanda ↩ Balas. Geser ke atas/bawah tetap dipakai untuk menggulir chat. Di komputer tetap tersedia menu **⋯ → Balas pesan**. Kutipan balasan tetap tersimpan di D1 sebagaimana V7.4.
4. **Perekam pesan suara lebih modern.** Panel kaca dengan timer, garis gelombang animasi (dekoratif), petunjuk geser, tombol Batal/Jeda/Kirim; tombol mikrofon diganti ikon SVG yang konsisten. Setelah pesan suara dibuka, pemutar memiliki kecepatan **1× / 1,5× / 2×** dan kontrol audio bawaan perangkat. Fungsi tahan-lepas, geser atas untuk mengunci, geser kiri untuk batal tetap tersedia.
<<<<<<< HEAD
5. **Cache PWA baru** `temanchat-v76-photo-reply` dan aset `7.6.0` supaya browser memuat kode baru.
=======
5. **Cache PWA baru** `temanchat-v75-smart-voice` dan aset `7.5.0` supaya browser memuat kode baru.
>>>>>>> ab2fb14b2bbe2c86d1fd2149a08eecedb51f74f3

## Cara pasang (GitHub Desktop)

1. Ekstrak ZIP ini.
2. Salin **semua isinya** (bukan folder terluar) ke `Documents/GitHub/temanchat-app`.
3. Saat diminta, pilih **Replace the files in the destination**. Jangan menghapus folder `.git` yang sudah ada pada repository lokal.
4. Periksa perubahan di GitHub Desktop. Commit dengan judul `TemanChat V7.5 Smart Notification Swipe Voice` lalu klik **Push origin**.
5. Tunggu deployment `temanchat-app` di Cloudflare **Ready**, lalu refresh paksa desktop (`Ctrl+Shift+R`) atau tutup lalu buka ulang PWA di HP.

Tidak perlu mengubah kunci VAPID, bucket R2, binding `MEDIA`, ataupun membuat tabel D1 manual. Tabel `tc_push_focus` disiapkan otomatis oleh Worker.

## Uji pada dua perangkat

- **Notifikasi ON:** buka chat A pada HP penerima, kirim pesan A dari perangkat lain. Saat chat A terlihat/fokus, tidak ada suara/push. Kirim pesan dari B → notifikasi tetap muncul.
- **Layar terkunci:** kunci HP penerima, kirim lagi pesan dari A → notifikasi kembali muncul. Ada kemungkinan jeda singkat jika browser tidak segera memberitahukan status layar terkunci; status fokus kedaluwarsa sekitar 23 detik.
- **Notifikasi OFF:** matikan lewat Pengaturan, kirim pesan dan panggilan baru → tidak ada notifikasi/bunyi pada HP tersebut; chat dan riwayat tetap berjalan. Aktifkan kembali dan uji ulang.
- **Balas pesan:** di HP swipe bubble ke kanan; di desktop pilih ⋯ → Balas. Uji gulir vertikal agar tidak keliru membalas.
- **Pesan suara:** tahan mic, geser ke atas untuk kunci, Kirim/Jeda/Batal; buka rekaman yang diterima, coba kecepatan 1×, 1,5×, 2×.

## Catatan teknis

- Agar Web Push tidak menampilkan notifikasi yang sama saat chat aktif, frontend melaporkan **ID percakapan yang sedang terlihat** ke Worker; server memverifikasi pengguna dan percakapan tersebut, lalu menahan pengiriman pesan dari chat itu selama status fokus masih segar. Konten ketikan tidak dikirim. Ketika halaman hilang fokus, status disetop; jika sinyal keluar gagal karena iOS membekukan PWA, penanda otomatis kedaluwarsa, sehingga notifikasi dapat kembali muncul setelah jeda.
- Suara notifikasi/panggilan saat aplikasi tertutup tetap tunduk pada aturan iOS/Android dan setelan suara sistem. OFF memutus langganan aplikasi; notifikasi yang sudah antre di layanan push mungkin masih dapat muncul sesaat ketika perubahan diterapkan.
- Pengujian lokal telah mencakup `npm run check`, pemeriksaan otorisasi endpoint fokus, simulasi browser ukuran 390 px dan 1280 px, swipe balas, tampilan perekam, serta aturan mute pesan A/pesan B/panggilan. **Belum diuji langsung di Cloudflare dan iPhone pengguna.**
- Pengiriman file besar melalui Google Drive, backup Nextcloud otomatis, dan notifikasi panggilan bergaya native tetap memiliki batasan integrasi sebagaimana pada V7.4.
<<<<<<< HEAD


## TemanChat V7.6
Pratinjau foto sebelum kirim dengan pilihan Mode Cermin (opsional, bukan deteksi otomatis kamera), plus batas tampilan menu Balas pada HP. Lihat PANDUAN-V7.6.txt.
=======
>>>>>>> ab2fb14b2bbe2c86d1fd2149a08eecedb51f74f3
