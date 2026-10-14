# Tiarina Agent

AI agent pribadi via Telegram, ditenagai Gemini dengan function calling.

Alat yang dimiliki: cari web, buat gambar (dikirim langsung ke chat), catatan, pengingat.
Juga bisa membuat paket konten YouTube Shorts (judul, hook, naskah, adegan, prompt gambar, deskripsi).

## Pilihan model
Ada dua sumber model: Gemini, dan model gratis Tiarina Cloud (API kompatibel OpenAI).
Ganti kapan saja lewat perintah `/model gemini` atau `/model tiarina`.
Cari web dan buat gambar tetap memakai Gemini.

## Setup
1. Buat bot lewat @BotFather, simpan token-nya.
2. Buat API key gratis di Google AI Studio.
3. Deploy di Tiarina Cloud (Build Type: Dockerfile), isi Environment sesuai `.env.example`.
4. Kirim /start ke bot, ambil Chat ID, isi `OWNER_CHAT_ID`, lalu deploy ulang.

JANGAN menaruh token atau API key di file repo (repo ini publik). Pakai tab Environment.

Catatan: data (catatan, pengingat, hitungan gambar) disimpan di folder `data` dan hilang saat container dibuat ulang, kecuali folder itu dihubungkan ke volume.
