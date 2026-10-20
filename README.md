# Traffic ROI — Business Tracker Session Edition (Vercel)

Website ringan **tanpa database, tanpa login, dan tanpa instalasi di komputer operator**. Tampilan mengikuti tiga tab Traffic ROI Business Tracker: **Campaign**, **Placement/Zone**, dan **Pengaturan**.

## Deploy sekali oleh pemilik tool (bukan operator)

1. Buat repository GitHub **baru** (contoh `traffic-roi-session`). **Jangan** gunakan repository `business-tracker` production.
2. Upload **isi folder ZIP ini** ke root repository, yaitu `index.html`, `vercel.json`, folder `api/`, dan `README.md`. **Jangan upload ZIP-nya sebagai satu berkas**.
3. Buka Vercel → Add New → Project → Import repository baru.
4. Framework Preset: **Other**, Root Directory: `./`. Tidak memerlukan database, environment variables, package.json, npm install, atau Build Command.
5. Klik Deploy. Setelah sukses, bagikan URL Vercel kepada operator yang dipercaya.

## Cara penggunaan operator

1. Buka URL aplikasi dari browser.
2. Pilih **Adsterra** atau **Clickadu** dari sidebar.
3. Di tab **Pengaturan**, masukkan token/API key dan klik **Simpan Koneksi**. Di bagian Konfigurasi Campaign tambahkan Campaign ID, nama opsional, serta `Tag_link1` dari CSV Shopee.
4. Di tab **Placement/Zone**, pilih campaign, periode, kurs USD-IDR, dan CSV Komisi Shopee. Klik **Analisa**.
5. Tabel ROI mengikuti urutan dan kolom Business Tracker. Pada Adsterra, Custom Bid **ID** dapat dibuat/diedit/dihapus. Nilai GLOBAL hanya dibaca. **Replace Blacklist** mengganti daftar provider secara keseluruhan setelah konfirmasi.
6. Tab **Campaign** menampilkan daftar campaign; Adsterra bisa Refresh Status dan ON/OFF manual. Tombol Sync mengambil statistik harian selama periode yang dipilih di Placement/Zone (perlu CSV sebelumnya). Klik nama campaign untuk melihat hasil per hari pada sesi ini.
7. Refresh atau buka ulang halaman untuk memulai sesi baru. Token, konfigurasi, CSV, dan semua hasil dari memori halaman hilang. **Token asli provider tidak otomatis dicabut**.

## Perbedaan yang memang tidak mungkin identik tanpa database

- Tidak ada histori harian permanen: Sync hanya menyimpan laporan di memori browser hingga refresh.
- Auto ON/OFF terjadwal dinonaktifkan: scheduler membutuhkan layanan yang terus bekerja/menyimpan konfigurasi. Kolom tersebut ditampilkan sebagai tidak tersedia, bukan tombol palsu.
- Semua konfigurasi akun dan source tag diisi ulang saat refresh. Tidak ada Shopee Account yang permanen.
- Tidak ada pencatatan `last blacklist replaced` lintas sesi; hanya waktu Replace sukses dalam sesi aktif.

## Keamanan dan operasional

- Token pengguna hanya ditahan di memori JavaScript tab browser, lalu dikirim setiap request melalui HTTPS ke `api/relay.mjs` untuk diteruskan ke Clickadu/Adsterra. Tidak ditulis ke database, cookie, localStorage, atau sessionStorage oleh aplikasi.
- API relay menggunakan daftar endpoint dan metode yang dibatasi dan memblokir origin silang serta redirect. Server tidak sengaja mencatat token ke log aplikasi, tetapi jangan menganggap ini jaminan atas logging infrastruktur pihak ketiga.
- Setiap tombol **Simpan, Hapus, Replace Blacklist, ON/OFF** benar-benar bisa mengubah data provider. Jangan mencoba pada campaign penting untuk sekadar memastikan hosting berfungsi.
- Untuk publik di luar organisasi, pertimbangkan kontrol akses/rate limiting dan monitoring biaya sebelum menyebarkan URL luas. Pemegang token API memiliki otoritas sesuai izin token.
- Vercel **Hobby** hanya untuk kegiatan pribadi nonkomersial sesuai kebijakan paket. Gunakan untuk pengujian pribadi terlebih dahulu; periksa paket/lisensi yang sesuai jika dipakai dalam bisnis atau oleh operator eksternal.
- Ini adalah adaptasi UI dari pola Business Tracker dengan logika API/CSV dari versi standalone, **bukan ekspor bit-per-bit seluruh Next.js/Prisma**. Penyamaan layout dan pengecekan lokal tidak membuktikan seluruh tindakan API live di Vercel.

## Struktur

```text
index.html        UI dan analisis CSV client-side
api/relay.mjs     Vercel Function untuk request API provider (tanpa penyimpanan)
vercel.json       Konfigurasi Vercel dan security headers
README.md         Petunjuk pemilik tool
```
