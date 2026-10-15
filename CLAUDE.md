# Tiarina Agent — Panduan Proyek untuk Claude Code

Dokumen ini adalah ringkasan lengkap proyek agar Claude Code bisa langsung memahami konteks, arsitektur,
aturan, dan pekerjaan yang tersisa. Taruh file ini di root repo dengan nama `CLAUDE.md`
(Claude Code membacanya otomatis setiap sesi).

---

## 1. Ringkasan

Bot Telegram pribadi yang berfungsi sebagai **AI agent** dan **otomasi posting teks harian ke Threads**.

- Pemilik: satu orang (dibatasi lewat `OWNER_CHAT_ID`). Bot mengabaikan chat lain.
- Hosting: **Tiarina Cloud → Applications** (platform berbasis Dokploy), build lewat `Dockerfile`, deploy dari GitHub
  (repo `chillspace05-collab/tiarina`, branch `main`, **repo publik**).
- Bahasa antarmuka bot: **Bahasa Indonesia**.
- Runtime: **Node.js 22**, **tanpa dependensi npm** (hanya modul bawaan: `fs`, `path`, `http`, `crypto`, `fetch`, `FormData`, `Blob`).

## 2. Struktur file

| File | Isi |
|---|---|
| `index.js` | Bot Telegram (long polling), agent loop dengan function calling, rantai cadangan model, alat agent, perintah umum, scheduler. |
| `threads.js` | Modul Threads: penulisan konten, jadwal harian, mode persetujuan, perintah Telegram, manajemen token, cadangan token terenkripsi. |
| `Dockerfile` | `node:22-slim` + ffmpeg + font + tzdata, `CMD ["node","index.js"]`. |
| `package.json` | Hanya script `start`, tanpa dependencies. |
| `.env.example` | Daftar variabel Environment. |
| `.gitignore`, `.dockerignore` | Abaikan `node_modules`, `.env`, `data`. |
| `README.md` | Panduan untuk pengguna (setup, perintah, token Threads). |

## 3. Menjalankan

```bash
# lokal
cp .env.example .env   # isi nilainya, JANGAN di-commit
node --env-file=.env index.js
```

Di Tiarina Cloud: isi variabel di tab **Environment** → **SAVE** → **DEPLOY**. Pantau tab **Logs** ("Bot berjalan...").
Hanya boleh ada **satu** instance yang berjalan (dua instance dengan token sama → Telegram error 409, sudah dicatat di log).

## 4. Variabel Environment

### Wajib
| Variabel | Keterangan |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Dari @BotFather. |
| `OWNER_CHAT_ID` | Chat ID pemilik. Kosong → bot hanya membalas `/start` dengan Chat ID. |
| `GEMINI_API_KEY` **atau** `LLM_BASE_URL` + `LLM_API_KEY` | Minimal salah satu penyedia model. |

### Model
| Variabel | Bawaan | Keterangan |
|---|---|---|
| `LLM_PROVIDER` | `gemini` jika ada key-nya | `gemini`, `tiarina`, atau `tokenomix` (penyedia utama; sisanya jadi cadangan). |
| `TOKENOMIX_API_KEY` | – | Key `sk-tkx-...` TokenomixAI. |
| `TOKENOMIX_BASE_URL` | `https://api.tokenomixai.com/v1` | |
| `TOKENOMIX_MODEL` | `deepseek-v4.1-flash,glm-5.3-flash,mimo-v2.6-flash` | Model yang benar-benar memanggil alat (deepseek-v4-flash & kimi tidak). Gateway mengirim `tool_calls` sebagai potongan stream; digabung oleh `mergeToolCalls`. |
| `LLM_BASE_URL` | – | API kompatibel OpenAI. Tiarina: `https://ai.tiarina.cloud/v1`. |
| `LLM_API_KEY` | – | Key `sk-tiar-...` dari Tiarina AI Services → API KEYS. |
| `LLM_MODEL` | `deepseek-v4.1-flash:free,deepseek-v4-flash:free,qwen3.8-flash:free,glm-5.3-flash:free,deepseek-v4.1-flash-netra:free` | Daftar dipisah koma; dirotasi bila kena rate limit. |
| `GEMINI_MODEL` | `gemini-3.8-flash,gemini-3.5-flash-lite` | Daftar dipisah koma. `gemini-2.5-*` ditolak untuk akun baru (404). |
| `IMAGE_MODEL` | `gemini-3.1-flash-image,gemini-3.1-flash-lite-image` | Model gambar Gemini **tidak punya free tier API** (butuh billing). |
| `TIMEOUT_MS` | `45000` | Batas waktu per permintaan HTTP ke model. |
| `RETRY_MS` | `1500` | Jeda dasar percobaan ulang. |
| `MAX_HISTORY` | `30` | Panjang riwayat percakapan per chat. |
| `IMAGES_PER_DAY` | `20` | Kuota gambar harian. |
| `SYSTEM_PROMPT_EXTRA` | – | Tambahan instruksi untuk agent chat. |

### Threads
| Variabel | Bawaan | Keterangan |
|---|---|---|
| `THREADS_ACCESS_TOKEN` | – | Opsional; token juga bisa dikirim lewat `/token`. |
| `THREADS_APP_SECRET` | – | Opsional; menukar token 1 jam → 60 hari otomatis. |
| `THREADS_USER_ID` | `me` | |
| `THREADS_API_BASE` | `https://graph.threads.net/v1.0` | |
| `THREADS_JADWAL` | `19:00` | WIB. |
| `THREADS_MODE` | `setuju` | `setuju` (draf dikirim dulu) / `otomatis`. |
| `THREADS_TOPIK` | `acak` | `acak`, nomor 1–6, atau teks bebas. |
| `THREADS_PANJANG` | `1` | 1–4 bagian per postingan (bagian lanjutan diposting sebagai balasan berantai). |
| `THREADS_PERSONA`, `THREADS_GAYA` | lihat `threads.js` | Persona dan gaya bahasa. |

### Khusus pengujian
`DATA_DIR`, `TG_BASE`, `GEMINI_BASE`, `THREADS_TICK_MS`, `PORT` — dipakai untuk mengarahkan bot ke server tiruan.

## 5. Arsitektur `index.js`

### Alur pesan
1. `poll()` memanggil `getUpdates` (long polling 30 detik, `allowed_updates: message, callback_query`).
   Pesan diproses **tanpa** `await` agar loop tidak terblokir. Respons `ok:false` (mis. 409) dicatat dan diberi jeda.
2. `handle(msg)`: log pesan → cek pemilik → perintah Threads (`threads.handleCommand`) → perintah umum → agent.
3. Penanda `busy` per chat: pesan biasa saat agent masih bekerja dibalas "Masih memproses...". Perintah tetap responsif.
4. `callback_query` (tombol inline) diteruskan ke `threads.handleCallback`.

### Agent
- `runAgentGemini(chat, text, model)`: format `contents` Gemini, `tools: functionDeclarations`, maks 6 langkah.
  Konten model disimpan apa adanya (menjaga *thought signature* Gemini 3).
- `runAgentOpenAI(chat, text)`: format `messages` + `tools` OpenAI (tipe skema diubah ke huruf kecil), `tool_calls` → pesan `role: tool`.
- Riwayat terpisah: `histories` (Gemini) dan `historiesOA` (OpenAI). Saat gagal, riwayat dikembalikan ke snapshot.

### Rantai cadangan
- `fetchRetry`: ulang untuk 429/5xx; **tidak** mengulang timeout atau URL tidak valid.
- `openaiChat`: rotasi daftar `LLM_MODELS`, mengingat model terakhir yang berhasil (`oaStart`).
- `runGeminiChain`: rotasi `GEMINI_MODELS`, mengingat model terakhir yang berhasil (`gemStart`).
- `runAgent`: urutan penyedia sesuai `provider`; penyedia yang gagal dilewati 3 menit (`downUntil`).
  Bila semua gagal: "Semua model sedang sibuk atau dibatasi...".
- `llmText(system, user)`: satu panggilan teks tanpa alat dengan rantai cadangan yang sama (dipakai `threads.js`).
- Regex error sementara: `TRANSIENT = /(Gemini|LLM) (429|500|502|503|504|gagal)/`.

### Alat agent
`cari_web` (Gemini + Google Search grounding), `buat_gambar` (Gemini image → `sendPhoto`),
`simpan_catatan`, `lihat_catatan`, `hapus_catatan`, `atur_pengingat`, `lihat_pengingat`, `hapus_pengingat`.
Pengingat dicek tiap 20 detik.

### Perintah umum
`/start`, `/bantuan`, `/reset`, `/model [gemini|tiarina]`, `/status`.

### Keamanan
- `redact()` menyamarkan `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `LLM_API_KEY`, dan pola `sk-...` di semua pesan error.
- Validasi `LLM_BASE_URL` saat start (harus `http(s)://`); jika salah, penyedia Tiarina dinonaktifkan dan dicatat di log.

## 6. Modul `threads.js`

### Konten
- 6 pilar topik (dirotasi acak, menghindari 2 topik terakhir): kehidupan sehari-hari; kesehatan mental sudut pandang pegawai ASN;
  dunia kerja ASN yang ringan dan non-sensitif; gym dan latihan beban; info kesehatan ringan; AI dan teknologi yang sedang tren.
- Topik AI/teknologi didahului `searchWeb` agar faktanya terkini.
- Model diminta membalas **JSON**: `{"hook": "...", "bagian": ["..."]}`. Bagian > 500 karakter dipotong per kalimat (`potong`).
- 10 hook terakhir dikirim ke model agar tidak berulang.

### Gaya bahasa (bawaan)
Semi-formal, hangat, elegan, dengan **rasa logat Solo** yang halus: dasar bahasa Indonesia rapi, paling banyak dua selipan per postingan.
- Partikel Solo: "og" (≈ kok/loh), "no" (≈ dong), "lho", "to", "wae".
- Ungkapan halus: "nggih", "monggo", "nyuwun sewu", "matur nuwun", "sumeleh", "alon-alon waton kelakon", "ojo kesusu".
- Kosakata Solo: jan tenan, naknu, sek/kosek, yah mene, ngeleh, kebeteng, tletik, udan kethek, mondo, wedangan di hik, bangjo, jagongan, gembrebeg.
- Dilarang umpatan atau plesetan umpatan.

### Aturan anti-"tulisan AI"
Hook baris pertama (≤12 kata, jujur), panjang kalimat bervariasi, detail konkret, tanpa hashtag, emoji ≤1, tanpa daftar poin/huruf tebal/tanda pisah panjang,
larang frasa klise ("Di era digital ini", "Mari kita", "Yuk simak", "Kesimpulannya", "Penting untuk diingat", "Tidak dapat dipungkiri"), penutup bervariasi.

### Rambu konten (WAJIB dipertahankan)
- Tanpa politik/pemilu/partai/tokoh politik, tanpa SARA.
- Tanpa kritik instansi/atasan/rekan tertentu, tanpa data internal kantor, tanpa keluhan angka gaji/tunjangan (konteks netralitas ASN).
- Kesehatan & kesehatan mental: umum dan empatik; tanpa diagnosis, tanpa dosis obat/suplemen, tanpa detail menyakiti diri; sarankan tenaga profesional bila relevan.
- Jangan mengarang fakta, angka, atau nama produk.

### Jadwal (`tick`, tiap 60 detik)
- **Mode setuju**: draf dibuat 60 menit sebelum jadwal (jendela s.d. 120 menit setelahnya), dikirim dengan tombol
  `th:post` (posting sekarang), `th:sched` (posting saat jadwal), `th:redo` (tulis ulang), `th:skip` (lewati).
- **Mode otomatis**: saat jadwal tiba → cek `GET /me/threads` (cegah dobel posting setelah deploy ulang) → tulis → posting → kabari pemilik.
- Gagal: maksimal 3 percobaan per hari, jeda 10 menit, pemilik dikabari.
- Satu operasi Threads pada satu waktu (`kunci`/`sibuk`).

### Perintah Telegram
`/threads` (status), `/buat [topik]`, `/dadakan topik` (draf topik dadakan sekarang), `/nanti topik|batal` (titip topik untuk jadwal berikutnya, sekali pakai),
`/posting`, `/jadwal HH:MM`, `/mode setuju|otomatis`, `/topik acak|1-6|teks`, `/panjang 1-4`, `/gaya teks|reset`, `/persona teks|reset`,
`/jeda`, `/lanjut`, `/token [TOKEN_BARU]`.

### Posting (Threads API)
`POST /{user}/threads` (`media_type=TEXT`, `text`, `reply_to_id` untuk bagian lanjutan) → jeda 3 detik → `POST /{user}/threads_publish` (`creation_id`)
→ `GET /{id}?fields=permalink`. Batas resmi: teks 500 karakter, 250 posting/24 jam per profil.
Tanpa App Review hanya bisa memposting ke akun sendiri / tester app (sesuai kebutuhan proyek ini).

### Token
- Prioritas: token milik bot (`st.token`, dari `/token` atau hasil perpanjangan) **selama** 10 karakter terakhir `THREADS_ACCESS_TOKEN` sama dengan saat token disimpan (`dari`);
  jika Environment diganti, token Environment yang dipakai.
- Perpanjangan otomatis tiap 7 hari: `GET {origin}/refresh_access_token?grant_type=th_refresh_token` (token harus ≥24 jam).
- `/token TOKEN`: hapus pesan pengguna → (opsional) tukar token 1 jam via `th_exchange_token` dengan `THREADS_APP_SECRET` → coba refresh → validasi `GET /me` →
  simpan → buat cadangan.
- **Cadangan terenkripsi**: AES-256-GCM, kunci = SHA-256(`threads-cadangan:` + `TELEGRAM_BOT_TOKEN`), format `THB1:<base64(iv|tag|data)>`,
  dikirim ke chat pemilik lalu di-**pin**. Saat start, `getChat` → `pinned_message` → dekripsi → pulihkan.
- Peringatan sekali sehari bila sisa ≤7 hari, dan segera bila token ditolak (pola error 190/expired/OAuth).

## 7. Penyimpanan & batasan platform

- Data (`data/state.json`, `notes.json`, `reminders.json`, `threads.json`) disimpan di folder `DATA_DIR` **di dalam container** → **hilang saat deploy ulang**.
  Pengecualian: token Threads (dipulihkan dari pesan pin). Pengaturan Threads kembali ke nilai Environment.
- Tiarina Free Tier: 4 aplikasi (1 vCPU / 1 GB), Object Storage 5 GB, model AI gratis 100 permintaan/24 jam; aplikasi gratis dihapus jika berhenti 7 hari.
- Model gratis Tiarina sering kena 429 dari penyedia → rotasi model wajib dipertahankan.

## 8. Pengujian

Belum ada unit test. Pengujian selama ini memakai **server tiruan** satu file (`http.createServer` di port 9999) yang meniru
Telegram (`getUpdates`, `sendMessage`, `pinChatMessage`, `deleteMessage`, `getChat`, `answerCallbackQuery`),
Gemini (`/models/{m}:generateContent`), API OpenAI (`/v1/chat/completions`), dan Threads (`/v1.0/...`, `/refresh_access_token`, `/access_token`).
Bot diarahkan ke sana lewat `TG_BASE`, `GEMINI_BASE`, `LLM_BASE_URL`, `THREADS_API_BASE`, dengan `RETRY_MS`/`TIMEOUT_MS`/`THREADS_TICK_MS` kecil.

Skenario yang sudah lolos: tool calling (catatan, gambar), rotasi model 429, Gemini 503/menggantung → cadangan, circuit breaker,
`/model` & `/status`, validasi URL & penyamaran key, alur draf → tombol → posting berantai, mode otomatis sekali sehari,
cegah dobel posting setelah deploy ulang, `/dadakan`, `/nanti`, `/token` (hapus pesan, validasi, pin), pemulihan token dari pin, peringatan token.

**Belum diuji dengan layanan asli**: Threads API (akun nyata), model gratis Tiarina dengan tool calling, model gambar Gemini.

## 9. Konvensi kode

- Tetap tanpa dependensi npm kecuali benar-benar perlu (container kecil, deploy cepat).
- Pesan ke pengguna dalam Bahasa Indonesia, singkat dan jelas.
- Semua `fetch` keluar wajib punya timeout (`AbortSignal.timeout`).
- Semua pesan error ke pengguna/log melewati `redact()` / `sensor()`.
- Jangan pernah menulis token/key ke file repo (repo publik). Rahasia hanya di Environment Tiarina.
- Jaga agar `handle()` tidak memblokir loop polling.

## 10. Pekerjaan berikutnya (usulan)

1. Uji nyata Threads: buat Meta App (use case Threads, izin `threads_basic` + `threads_content_publish`, akun sebagai Threads Tester), kirim `/token`, coba `/dadakan`.
2. Pisahkan pengujian tiruan menjadi skrip `test/` yang bisa dijalankan ulang (`node test/run.js`).
3. Penyimpanan permanen pengaturan Threads & catatan (opsi: Object Storage Tiarina yang kompatibel S3, atau Managed Database).
4. Carousel gambar Threads (ditunda): render slide teks menjadi PNG tanpa model gambar berbayar, unggah ke Object Storage publik.
5. Opsional: statistik postingan (Threads insights) dan laporan mingguan ke Telegram.
