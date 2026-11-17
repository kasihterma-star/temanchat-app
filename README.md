# TemanChat V7.6 — Rebuild bersih dari V7.5

Sumber: ZIP V7.5 yang diunggah pengguna. Versi ini tidak memakai file repository GitHub yang sempat mengandung konflik merge.

## Yang berubah dari V7.5

- Foto memiliki pratinjau sebelum dikirim dengan tombol **Mode Cermin: Mati/Aktif**. Bawaan Normal, sehingga foto kamera atau galeri tidak dibalik tanpa pilihan pengguna.
- Tindakan **Batal** tidak mengunggah media.
- Tampilan kutipan dan menu **Balas** di HP dibatasi supaya tidak keluar dari layar.
- File cache PWA dinaikkan ke V7.6.
- Fitur lain termasuk R2, chat, suara, panggilan, dan notifikasi tetap mengikuti V7.5.

## Pemasangan aman

1. Cadangkan folder proyek `Documents\GitHub\temanchat-app`.
2. Ekstrak ZIP ini. **Salin isi ZIP** (bukan folder ZIP) ke dalam folder repository, pilih Replace.
3. Jangan memakai menu merge GitHub untuk menggabungkan file yang konflik.
4. Pastikan `package.json` dan `public/index.html` di repository tidak mengandung `<<<<<<<`, `=======`, atau `>>>>>>>`. Bila file tersebut sudah rusak, ganti dari paket ini.
5. GitHub Desktop: Commit ke main, lalu Push origin.
6. Periksa build Cloudflare sampai Ready. Jika gagal, baca Build logs.
7. Refresh browser atau buka ulang PWA, uji foto dengan pratinjau dan menu Balas.

R2 menggunakan binding `MEDIA` dan D1 menggunakan `DB`; jangan menghapus binding atau secret yang sudah ada.

Catatan: tidak ada perubahan schema database untuk fitur pratinjau foto ini. Penggunaan kamera bawaan iPhone tidak selalu mengungkap preferensi mirror, sehingga aplikasi menyediakan pilihan mirror manual.
# TemanChat V7.5 FULL — Smart Notification, Swipe Reply, Voice Glass

Paket lengkap penerus TemanChat V7.4. Desain **Glass Monokrom** dan seluruh fitur lama (akun, status online, R2, Web Push, centang, media, panggilan, foto profil, dan rekam suara) dipertahankan.

## Pembaruan yang diterapkan

1. **Notifikasi pintar per percakapan.** Saat notifikasi ON dan TemanChat aktif menampilkan chat dengan A, pesan baru A **tidak memicu push** atau suara tambahan. Chat B tetap memberi notifikasi. Setelah meninggalkan chat A, meminimalkan aplikasi, mematikan layar, berpindah tab/aplikasi, atau mengunci HP, notifikasi A kembali aktif. Panggilan masuk tidak dibisukan oleh fitur ini.
2. **Notifikasi OFF dari Pengaturan.** Mematikan semua notifikasi membatalkan langganan Web Push di perangkat tersebut dan menghentikan bunyi panggilan serta notifikasi lokal. Notifikasi OFF **tidak mematikan chat, panggilan, atau angka belum dibaca di dalam aplikasi**. UI panggilan masuk saat TemanChat terbuka tetap bisa ditampilkan tanpa suara. Pilihan OFF tersimpan di perangkat dan ON bisa mengaktifkan kembali dengan izin notifikasi perangkat. Preferensi OFF **berlaku per instalasi/perangkat**, bukan semua perangkat pengguna sekaligus.
3. **Balas dengan geser.** Pada layar sentuh, geser bubble ke kanan sekitar **62 px**. Bubble mengikuti jari dan menampilkan tanda ↩ Balas. Geser ke atas/bawah tetap dipakai untuk menggulir chat. Di komputer tetap tersedia menu **⋯ → Balas pesan**. Kutipan balasan tetap tersimpan di D1 sebagaimana V7.4.
4. **Perekam pesan suara lebih modern.** Panel kaca dengan timer, garis gelombang animasi (dekoratif), petunjuk geser, tombol Batal/Jeda/Kirim; tombol mikrofon diganti ikon SVG yang konsisten. Setelah pesan suara dibuka, pemutar memiliki kecepatan **1× / 1,5× / 2×** dan kontrol audio bawaan perangkat. Fungsi tahan-lepas, geser atas untuk mengunci, geser kiri untuk batal tetap tersedia.
5. **Cache PWA baru** `temanchat-v75-smart-voice` dan aset `7.5.0` supaya browser memuat kode baru.

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

## TemanChat V8.1 — Perangkat yang Login

Dari paket V8.0 FULL, ditambahkan pengelolaan sesi per perangkat dalam Pengaturan:

- Daftar sesi aktif dengan label OS/browser perkiraan, waktu login dan terakhir aktif bila tersedia.
- Sesi saat ini diberi penanda dan tidak bisa dikeluarkan melalui aksi perangkat lain.
- Sesi perangkat lain dapat dicabut hanya setelah memasukkan sandi akun yang benar, dengan pembatasan percobaan.
- Token sesi di server menjadi tidak berlaku segera; sesi perangkat lain dan sandi akun tidak berubah.
- Langganan push diikat ke sesi yang masih aktif, supaya perangkat yang sesi akunnya dicabut tidak menerima push baru untuk akun tersebut.
- Dua tabel otomatis: `tc_device_sessions` dan `tc_push_device_links`. Tidak memerlukan migrasi manual.

**Catatan**: Login sebelum V8.1 tidak mempunyai riwayat terakhir aktif historis; akan mulai tercatat setelah perangkat dibuka. Login yang baru dilacak saat login. Nama perangkat dari user-agent hanyalah perkiraan.

Langkah deploy, batasan dan uji perangkat ganda ada di `PANDUAN-V8.1-PERANGKAT-LOGIN.txt`.
