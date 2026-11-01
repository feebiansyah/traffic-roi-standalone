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
5. Pada Campaign, pilih rencana **Blacklist/Whitelist**, lalu analisis di Placement/Zone. Pilihan tersebut belum mengubah provider. **Terapkan** menampilkan satu konfirmasi browser, mengganti seluruh daftar tujuan, lalu memverifikasi GET. Whitelist wajib memiliki kandidat; ID yang ditolak tidak dihapus otomatis. Pada Adsterra, Custom Bid **ID** tetap dapat dikelola dengan alur existing; GLOBAL hanya dibaca.
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
placement-lists.js Pemilihan kandidat positif, preview dan penerapan daftar sesi
vercel.json       Konfigurasi Vercel dan security headers
README.md         Petunjuk pemilik tool
```

## Kontrak dan batas Replace daftar

- Clickadu: GET/PUT campaign memakai `targeting.zone.list` dan boolean
  `isExcluded`. Satu PUT mengganti metode serta ID sekaligus, tanpa clear.
  Field campaign writable yang tersedia dan targeting lain dipertahankan.
  Metode aktual hanya berasal dari GET, tidak dari pilihan atau respons PUT.
  Referensi: [panduan resmi](https://faq.clickadu.com/en/articles/6234861-api-documentation)
  dan [Swagger resmi](https://adv.clickadu.com/api//swagger/clickadu/swagger-v2.json).
- Adsterra: GET kedua linking list, PUT `/advertiser/linking/{blacklist|whitelist}.json`,
  POST blacklist clean atau campaign whitelist clear sesuai
  [OpenAPI resmi](https://docs.adsterratools.com/docs/public/v3/partners-api.yml).
  Pilihan aplikasi tidak membuktikan mode editor. Respons 422 dengan struktur
  `Unprocessable Content / errors.campaign_ids` dan alasan tepat campaign memiliki
  whitelist hanya diterima sebagai Blacklist **tidak dapat dibaca**, setelah
  Whitelist campaign yang sama terbukti valid/nonkosong. Null/404/error lain gagal.
- Bila daftar lawan harus dikosongkan, konfirmasi mencakup OFF jika diperlukan.
  Campaign harus terbukti INACTIVE sebelum clear; tidak dinyalakan kembali otomatis.
  Setelah clear, daftar dibaca ulang sebelum target diterapkan. Whitelist tidak
  mengubah bid. Blacklist menghapus override seluruh GEO pada target hanya setelah
  daftar terverifikasi, termasuk ketika daftar sudah sama.
- Aturan Blacklist tidak diubah. Whitelist menggunakan syarat positif standalone:
  biaya ≥Rp1.000 serta ROI ≥30% (Clickadu), atau ROI >10% DAN CTR >8% (Adsterra).
  Nilai unknown dan biaya belum cukup tidak lolos.
- Tidak ada retry write/rollback atau pemulihan bid otomatis. Penolakan 422
  menampilkan alasan publik yang dikenal dan cuplikan ID penolakan yang merupakan
  bagian target terkonfirmasi; bukan klaim seluruh ID lain diterima. Tidak ada
  tombol pengecualian otomatis pada tahap ini.
- Request write ambigu atau hasil setelah write yang belum terverifikasi memblokir
  penerapan berikutnya pada config selama sesi ini. GET yang kebetulan cocok tidak
  menghapus ketidakpastian request tersebut. Periksa provider; aplikasi session-only
  tidak memberikan koordinasi lintas tab/operator, transaksi atomik, atau exactly-once.
  Refresh menghapus guard lokal bersama seluruh sesi; bukan bukti request lama berhenti.

Verifikasi pengembangan menggunakan UI/helper/relay asli dengan upstream palsu,
bukan write API sungguhan. Tidak ada tes otomatis. Tidak ada klaim penerapan live
atau kecocokan dengan dashboard provider sebelum operator memverifikasinya.
