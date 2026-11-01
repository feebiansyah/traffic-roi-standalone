# Traffic ROI — Business Tracker Session Edition (Vercel)

Website ringan **tanpa database, tanpa login, dan tanpa instalasi di komputer operator**. Tampilan mengikuti tiga tab Traffic ROI Business Tracker: **Campaign**, **Placement/Zone**, dan **Pengaturan**.

## Deploy sekali oleh pemilik tool (bukan operator)

1. Buat repository GitHub **baru** (contoh `traffic-roi-session`). **Jangan** gunakan repository `business-tracker` production.
2. Upload isi repository, termasuk `index.html`, ketiga helper JavaScript (`list-rules.js`, `placement-lists.js`, `campaign-method.js`), `vercel.json`, folder `api/`, dan `README.md`.
3. Buka Vercel → Add New → Project → Import repository baru.
4. Framework Preset: **Other**, Root Directory: `./`. Tidak memerlukan database, environment variables, package.json, npm install, atau Build Command.
5. Klik Deploy. Setelah sukses, bagikan URL Vercel kepada operator yang dipercaya.

## Cara penggunaan operator

1. Buka URL aplikasi dari browser.
2. Pilih **Adsterra** atau **Clickadu** dari sidebar.
3. Di tab **Pengaturan**, masukkan token/API key dan klik **Simpan Koneksi**. Di bagian Konfigurasi Campaign tambahkan Campaign ID, nama opsional, serta `Tag_link1` dari CSV Shopee.
4. Di tab **Placement/Zone**, pilih campaign, periode, kurs USD-IDR, dan CSV Komisi Shopee. Klik **Analisa**.
5. Pada **Campaign Adsterra**, tetapkan metode aplikasi **Blacklist/Whitelist** dengan satu konfirmasi browser. Daftar existing yang kompatibel dapat diadopsi tanpa OFF/reset (termasuk Blacklist kosong saat ACTIVE). Metode yang sama tidak mereset daftar. Pergantian metode mereset daftar setelah OFF terverifikasi, mempertahankan seluruh Custom Bid, dan tidak mengaktifkan campaign kembali. Whitelist yang baru direset belum boleh ON sebelum diisi. Placement mengikuti metode sesi ini dan **tidak melakukan clear atau mengganti metode**.
6. Pada **Campaign Clickadu**, GET menampilkan metode aktual. Tanpa rencana baru, analisis mengikuti metode tersebut. Pilihan rencana belum mengubah provider; satu PUT saat Terapkan mengganti metode dan seluruh daftar final sekaligus, tanpa clear terpisah.
7. Analisis → **Terapkan** → satu konfirmasi browser → GET verifikasi. Whitelist wajib nonkosong. Bila provider menolak ID, alasan dan tombol **Terapkan tanpa placement yang ditolak** tampil di atas form. Tombol ini menyiapkan target baru, menampilkan pengecualian kumulatif, dan meminta satu konfirmasi baru; tidak mengulang write otomatis. Custom Bid **ID** dapat dibuat satu item, diedit, atau dihapus; seluruh GEO dibaca, GLOBAL bukan editor terpisah.
8. Tab **Campaign** menyediakan Refresh Status, ON/OFF Adsterra, dan laporan sesi existing. OFF juga tersedia langsung dari Placement saat operasi berlangsung/belum pasti. Auto terjadwal tetap tidak tersedia. Sync/laporan dan import komisi tidak dirombak.
9. Refresh/buka ulang halaman memulai sesi baru. Token, metode, readiness, konfigurasi, CSV, dan semua hasil memori hilang. **Token asli provider tidak otomatis dicabut**.

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
list-rules.js      Satu keputusan kandidat/status, memakai nilai sebelum pembulatan
placement-lists.js Bukti daftar, context/timeout, penerapan dan receipt penolakan sesi
campaign-method.js Adopsi/pergantian metode Adsterra, kesiapan dan ON/OFF terverifikasi
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
- Hanya pergantian metode di Campaign Adsterra yang dapat mereset daftar.
  Bila daftar perlu dikosongkan, konfirmasi mencakup OFF jika diperlukan.
  Campaign harus terbukti INACTIVE sebelum clear; tidak dinyalakan kembali otomatis.
  Bila Blacklist tidak dapat dibaca karena Whitelist, Whitelist dihapus dahulu,
  kemudian Blacklist dibaca ulang dan direset berdasarkan hasil aktual.
  Setelah clear terverifikasi, metode sesi diterbitkan; target diisi melalui Placement.
  Whitelist tidak
  mengubah bid. Blacklist menghapus override seluruh GEO pada target hanya setelah
  daftar terverifikasi, termasuk ketika daftar sudah sama.
- Aturan disamakan dengan [Business Tracker 055e01b](https://github.com/feebiansyah/business-tracker/tree/055e01b2cecabf322b53646b0362511dd85c4675):
  minimum biaya **Rp1.000**, nilai asli sebelum pembulatan tampilan.
  Clickadu: Blacklist **ROI <30%**, Whitelist **ROI ≥30%**.
  Adsterra: aman/Whitelist **ROI ≥20% ATAU (ROI >10% DAN CTR >8%)**;
  Blacklist biaya cukup, ROI valid dan tidak memenuhi aman. ROI 25%/CTR 5%
  masuk Whitelist, bukan Blacklist. ROI ≥20% tetap aman dengan impresi valid nol.
  Count harus integer aman/non-negatif; missing, whitespace, boolean, overflow,
  ROI unknown/invalid, dan biaya belum cukup tidak otomatis menjadi kandidat.
  Tabel, jumlah, Copy ID, serta target memakai helper yang sama; pengecualian
  terkonfirmasi ditandai di tabel dan target akhir.
- Tidak ada retry write/rollback atau pemulihan bid otomatis. Penolakan 422
  hanya memakai record `errors.placement_ids[].ids` atau
  `errors.landing_ids[landing][].placement_ids` beserta alasan aman. Landing ID
  bukan placement ID. ID di luar target ditolak, ukuran dibatasi, dan hasil yang
  tidak lengkap diberi keterangan; bukan klaim ID lainnya pasti diterima.
  Receipt penolakan terikat koneksi, provider, campaign, input/CSV/analisis,
  metode/versi, target dan TTL lima menit. Pergantian konteks membatalkannya.
- PUT Clickadu mempertahankan whitelist field writable referensi, termasuk
  `pushNotificationCreative`, `cohort`, serta targeting selain Zone.
- Readiness Adsterra memakai kedua bukti daftar yang disetujui dan GET terbaru,
  bukan dugaan mode editor. Campaign legacy yang belum pernah diatur tetap dapat
  ON/OFF; pengaturan pertama yang terhenti **tidak** dianggap legacy. Drift
  daftar, Whitelist kosong/belum diterapkan, dan write ambigu menahan ON.
  OFF tidak diblokir oleh kebutuhan metode. GET tidak mempromosikan readiness.
- Pipeline daftar/metode dibatasi 90 detik, 40 request, timeout HTTP maksimal
  10 detik, sequential (OFF protektif menunggu write yang sedang dikirim selesai
  atau timeout sebelum OFF). Tidak ada polling. Hasil status lama diabaikan.
- Penolakan HTTP yang sudah selesai dapat disiapkan ulang dengan konfirmasi baru;
  kegagalan verifikasi tidak diklaim berhasil. **Write yang benar-benar ambigu**
  tetap memblokir write berikutnya pada campaign fisik selama sesi, termasuk
  setelah GET cocok. OFF tetap tersedia tetapi tidak menghapus ketidakpastian.
  Periksa provider; aplikasi session-only
  tidak memberikan koordinasi lintas tab/operator, transaksi atomik, atau exactly-once.
  Refresh menghapus guard lokal bersama seluruh sesi; bukan bukti request lama berhenti.

Verifikasi pengembangan menggunakan UI/helper/relay asli dengan upstream palsu,
bukan write API sungguhan. Tidak ada tes otomatis. Tidak ada klaim penerapan live
atau kecocokan dengan dashboard provider sebelum operator memverifikasinya.
