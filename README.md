# Tiarina Agent

AI agent pribadi via Telegram, ditenagai Gemini dengan function calling.

Alat yang dimiliki: cari web, buat gambar (dikirim langsung ke chat), catatan, pengingat.
Juga bisa membuat paket konten YouTube Shorts (judul, hook, naskah, adegan, prompt gambar, deskripsi).

## Pilihan model
Ada tiga sumber model: Gemini, model gratis Tiarina Cloud, dan TokenomixAI (keduanya API kompatibel OpenAI).
Ganti kapan saja lewat perintah `/model gemini`, `/model tiarina`, atau `/model tokenomix`; cek kondisi dengan `/status`.
Jika model utama sibuk atau dibatasi, bot otomatis mencoba model lain lalu penyedia lain.
Cari web dan buat gambar tetap memakai Gemini.

## Setup
1. Buat bot lewat @BotFather, simpan token-nya.
2. Buat API key gratis di Google AI Studio.
3. Deploy di Tiarina Cloud (Build Type: Dockerfile), isi Environment sesuai `.env.example`.
4. Kirim /start ke bot, ambil Chat ID, isi `OWNER_CHAT_ID`, lalu deploy ulang.

JANGAN menaruh token atau API key di file repo (repo ini publik). Pakai tab Environment.

Catatan: data (catatan, pengingat, hitungan gambar) disimpan di folder `data` dan hilang saat container dibuat ulang, kecuali folder itu dihubungkan ke volume.

## Dua bot dalam satu aplikasi

`start.js` menjalankan bot kedua bila `BOT2_TELEGRAM_BOT_TOKEN` diisi. Variabel lain dipakai bersama,
kecuali ditulis dengan awalan `BOT2_` (mis. `BOT2_OWNER_CHAT_ID`). Data tiap bot terpisah (`data/` dan `data/bot2/`).
Fitur Threads hanya jalan di satu bot (`THREADS_BOT`, bawaan bot 2) supaya tidak posting dobel.

## Tes run

`/tes` mengecek setiap model (menjawab dan memanggil alat), alat catatan, penyimpanan, token dan kuota Threads.
`/tes lengkap` juga mencoba cari web, membuat gambar, dan menulis contoh draf. Tidak ada yang diposting.

## Posting harian ke Threads
Bot membuat dan memposting satu tulisan per hari ke akun Threads-mu.
Topik bawaan bergiliran: kehidupan sehari-hari, kesehatan mental sudut pandang ASN, dunia kerja ASN (non-sensitif),
gym, info kesehatan ringan, AI dan teknologi. Rambu konten (tanpa politik, SARA, kritik instansi, diagnosis/dosis) sudah tertanam.

Gaya bawaan: semi-formal dan elegan dengan rasa logat Solo (partikel "og", "no", ungkapan halus, kosakata keseharian Solo), paling banyak dua selipan per postingan.

Perintah: `/threads`, `/buat [topik]`, `/dadakan topik` (draf topik dadakan sekarang), `/nanti topik` (titip topik untuk jadwal berikutnya),
`/posting`, `/jadwal 19:00`, `/mode setuju|otomatis`, `/topik acak|1-6|teks`, `/panjang 1-4`, `/gaya teks|reset`,
`/persona teks|reset`, `/jeda`, `/lanjut`, `/token TOKEN_BARU`.
`/buat` sudah bisa dicoba sebelum token Threads diisi (hanya membuat draf).

### Menyiapkan token Threads (sekali saja)
Tampilan dashboard Meta bisa berubah; ikuti istilah yang paling mirip.
1. Buka developers.facebook.com, buat app baru, pilih use case untuk mengakses Threads API.
2. Di pengaturan use case Threads, aktifkan izin `threads_basic` dan `threads_content_publish`.
3. Di App roles, tambahkan akun Threads-mu sebagai Threads Tester, lalu terima undangannya di aplikasi Threads
   (pengaturan akun, bagian izin situs web / undangan).
4. Buat access token untuk akun itu lewat generator token di pengaturan Threads API.
   Jika token yang didapat berumur pendek (1 jam), tukar menjadi token 60 hari:
   `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=APP_SECRET&access_token=TOKEN_PENDEK`
5. Isi `THREADS_ACCESS_TOKEN` di tab Environment Tiarina, SAVE, lalu DEPLOY.

Alternatif yang lebih mudah: kirim token langsung ke bot dengan `/token TOKEN`.
Bot menghapus pesan berisi token, memeriksa token ke Threads, lalu menyimpan cadangan terenkripsi
yang disematkan (pin) di chat supaya tetap terpakai setelah deploy ulang. Jangan di-unpin.
Jika dashboard hanya memberi token 1 jam, isi `THREADS_APP_SECRET` di Environment agar bot menukarnya otomatis menjadi token 60 hari.

Bot memperpanjang token sendiri tiap minggu, dan mengirim peringatan sekali sehari bila masa berlakunya tinggal 7 hari atau kurang
(atau bila token ditolak). Perbarui dengan `/token TOKEN_BARU`.
