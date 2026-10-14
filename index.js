// Tiarina Agent: Telegram + Gemini (function calling). Node 18+, tanpa dependensi.
// Alat: cari web, buat gambar, catatan, pengingat. Cocok juga untuk membuat paket konten Shorts.

const fs = require('fs');
const path = require('path');
const http = require('http');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'gemini-3.1-flash-image';
const OWNER = (process.env.OWNER_CHAT_ID || '').trim();
const MAX_HISTORY = parseInt(process.env.MAX_HISTORY || '30', 10);
const IMAGES_PER_DAY = parseInt(process.env.IMAGES_PER_DAY || '20', 10);
const IMAGES_PER_REQUEST = 6;
const MAX_STEPS = 6;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const GEMINI_BASE = process.env.GEMINI_BASE || 'https://generativelanguage.googleapis.com/v1beta';
const TG_BASE = process.env.TG_BASE || 'https://api.telegram.org';
const EXTRA_PROMPT = process.env.SYSTEM_PROMPT_EXTRA || '';

// Model alternatif (API kompatibel OpenAI), misalnya model gratis di Tiarina Cloud -> AI Services
const LLM_BASE = (process.env.LLM_BASE_URL || '').replace(/\/+$/, '');
const LLM_KEY = process.env.LLM_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-v4.1-flash:free';
const BASE_OK = /^https?:\/\/\S+$/i.test(LLM_BASE);
if (LLM_BASE && !BASE_OK) {
  console.error('LLM_BASE_URL tidak valid: harus diawali https:// (mungkin tertukar dengan API key). Model tiarina dinonaktifkan.');
}
const HAS_TIARINA = Boolean(BASE_OK && LLM_KEY);
let provider = (process.env.LLM_PROVIDER || (KEY ? 'gemini' : 'tiarina')).toLowerCase();
if (provider === 'openai') provider = 'tiarina';
if (provider === 'tiarina' && !HAS_TIARINA) provider = 'gemini';
if (provider === 'gemini' && !KEY && HAS_TIARINA) provider = 'tiarina';

if (!TOKEN || (!KEY && !HAS_TIARINA)) {
  console.error('TELEGRAM_BOT_TOKEN wajib diisi, plus minimal salah satu: GEMINI_API_KEY, atau LLM_BASE_URL + LLM_API_KEY.');
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- penyimpanan sederhana (file JSON) ----------
const F_STATE = path.join(DATA_DIR, 'state.json');
const F_NOTES = path.join(DATA_DIR, 'notes.json');
const F_REMIND = path.join(DATA_DIR, 'reminders.json');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v));

const wib = (ms = Date.now()) =>
  new Date(ms).toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }).slice(0, 16);
const loadState = () => {
  const s = readJson(F_STATE, {});
  const d = wib().slice(0, 10);
  return s.date === d ? s : { date: d, images: 0 };
};

// ---------- Telegram ----------
const API = `${TG_BASE}/bot${TOKEN}`;
async function tg(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  return res.json();
}
async function say(chat_id, text) {
  for (let i = 0; i < text.length; i += 4000) {
    await tg('sendMessage', { chat_id, text: text.slice(i, i + 4000) });
  }
}
async function sendPhoto(chat, buf, mime, caption) {
  const form = new FormData();
  form.append('chat_id', chat);
  if (caption) form.append('caption', caption.slice(0, 1000));
  form.append('photo', new Blob([buf], { type: mime }), 'gambar.png');
  const res = await fetch(`${API}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
  const j = await res.json();
  if (!j.ok) throw new Error(`Telegram: ${j.description || 'gagal kirim foto'}`);
}

// Sembunyikan rahasia agar tidak bocor ke chat atau log
function redact(text) {
  let t = String(text);
  for (const secret of [TOKEN, KEY, LLM_KEY]) {
    if (secret && secret.length > 6) t = t.split(secret).join('***');
  }
  return t.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***');
}

// ---------- HTTP dengan percobaan ulang (untuk error sementara 429/5xx) ----------
const RETRY_MS = parseInt(process.env.RETRY_MS || '1500', 10);
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '45000', 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchRetry(url, opts, label) {
  for (let i = 0; i < 3; i++) {
    let res;
    try {
      res = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      const timeout = e.name === 'TimeoutError';
      const badUrl = /parse URL|Invalid URL/i.test(e.message);
      // timeout atau URL salah tidak perlu diulang; langsung gagal (agar bisa pindah ke cadangan)
      if (timeout || badUrl || i === 2) {
        throw new Error(`${label} gagal: ${timeout ? 'waktu habis' : badUrl ? 'alamat server tidak valid' : redact(e.message)}`);
      }
      await sleep(RETRY_MS * (i + 1));
      continue;
    }
    if (res.ok) return res;
    if (![429, 500, 502, 503, 504].includes(res.status) || i === 2) {
      throw new Error(`${label} ${res.status}: ${redact((await res.text()).slice(0, 300))}`);
    }
    await sleep(RETRY_MS * (i + 1));
  }
}

// ---------- Gemini ----------
async function gemini(model, body) {
  if (!KEY) throw new Error('GEMINI_API_KEY belum diisi (dibutuhkan untuk cari web dan gambar).');
  const res = await fetchRetry(`${GEMINI_BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify(body),
  }, 'Gemini');
  return res.json();
}

// ---------- alat ----------
const tools = {
  async cari_web({ query }) {
    const data = await gemini(MODEL, {
      contents: [{ role: 'user', parts: [{ text: String(query) }] }],
      tools: [{ google_search: {} }],
    });
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
    const sumber = (cand?.groundingMetadata?.groundingChunks || [])
      .map((c) => c.web?.uri).filter(Boolean).slice(0, 5);
    return { ringkasan: text || 'Tidak ada hasil.', sumber };
  },

  async buat_gambar({ prompt, keterangan }, ctx) {
    const st = loadState();
    if (st.images >= IMAGES_PER_DAY) return { error: `Kuota gambar harian (${IMAGES_PER_DAY}) habis.` };
    if (ctx.images >= IMAGES_PER_REQUEST) return { error: `Maksimal ${IMAGES_PER_REQUEST} gambar per permintaan.` };
    const data = await gemini(IMAGE_MODEL, {
      contents: [{ role: 'user', parts: [{ text: String(prompt) }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    });
    const parts = data.candidates?.[0]?.content?.parts || [];
    const img = parts.map((p) => p.inlineData || p.inline_data).find(Boolean);
    if (!img) return { error: 'Model tidak mengembalikan gambar (diblokir atau di luar kuota).' };
    await sendPhoto(ctx.chat, Buffer.from(img.data, 'base64'), img.mimeType || img.mime_type || 'image/png', keterangan || '');
    st.images += 1;
    writeJson(F_STATE, st);
    ctx.images += 1;
    return { hasil: 'Gambar sudah dikirim ke pengguna.' };
  },

  async simpan_catatan({ teks }) {
    const notes = readJson(F_NOTES, []);
    const id = (notes.at(-1)?.id || 0) + 1;
    notes.push({ id, teks: String(teks), waktu: wib() });
    writeJson(F_NOTES, notes);
    return { hasil: `Catatan #${id} disimpan.` };
  },
  async lihat_catatan() {
    return { catatan: readJson(F_NOTES, []) };
  },
  async hapus_catatan({ id }) {
    const notes = readJson(F_NOTES, []);
    const sisa = notes.filter((n) => n.id !== Number(id));
    writeJson(F_NOTES, sisa);
    return { hasil: sisa.length < notes.length ? `Catatan #${id} dihapus.` : 'Catatan tidak ditemukan.' };
  },

  async atur_pengingat({ teks, menit, waktu_wib }, ctx) {
    let at;
    if (Number(menit) > 0) at = Date.now() + Number(menit) * 60000;
    else if (waktu_wib) {
      const s = String(waktu_wib).trim().replace(' ', 'T');
      at = new Date(`${s.length === 16 ? s + ':00' : s}+07:00`).getTime();
    }
    if (!at || Number.isNaN(at) || at <= Date.now()) return { error: 'Waktu tidak valid atau sudah lewat.' };
    const list = readJson(F_REMIND, []);
    const id = (list.at(-1)?.id || 0) + 1;
    list.push({ id, chat: ctx.chat, teks: String(teks), at });
    writeJson(F_REMIND, list);
    return { hasil: `Pengingat #${id} diatur untuk ${wib(at)} WIB.` };
  },
  async lihat_pengingat(_, ctx) {
    return { pengingat: readJson(F_REMIND, []).filter((r) => r.chat === ctx.chat).map((r) => ({ id: r.id, teks: r.teks, waktu_wib: wib(r.at) })) };
  },
  async hapus_pengingat({ id }) {
    const list = readJson(F_REMIND, []);
    const sisa = list.filter((r) => r.id !== Number(id));
    writeJson(F_REMIND, sisa);
    return { hasil: sisa.length < list.length ? `Pengingat #${id} dihapus.` : 'Pengingat tidak ditemukan.' };
  },
};

const S = (description) => ({ type: 'STRING', description });
const DECLS = [
  { name: 'cari_web', description: 'Cari informasi terbaru di web dan ringkas hasilnya.',
    parameters: { type: 'OBJECT', properties: { query: S('Kata kunci atau pertanyaan pencarian') }, required: ['query'] } },
  { name: 'buat_gambar', description: 'Buat satu gambar dari deskripsi dan kirim langsung ke pengguna.',
    parameters: { type: 'OBJECT', properties: { prompt: S('Deskripsi gambar yang rinci, sebaiknya bahasa Inggris'), keterangan: S('Keterangan singkat untuk gambar (opsional)') }, required: ['prompt'] } },
  { name: 'simpan_catatan', description: 'Simpan sebuah catatan.',
    parameters: { type: 'OBJECT', properties: { teks: S('Isi catatan') }, required: ['teks'] } },
  { name: 'lihat_catatan', description: 'Tampilkan semua catatan tersimpan.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'hapus_catatan', description: 'Hapus catatan berdasarkan id.',
    parameters: { type: 'OBJECT', properties: { id: { type: 'INTEGER', description: 'Id catatan' } }, required: ['id'] } },
  { name: 'atur_pengingat', description: 'Atur pengingat yang akan dikirim ke pengguna. Pakai menit ATAU waktu_wib.',
    parameters: { type: 'OBJECT', properties: {
      teks: S('Isi pengingat'),
      menit: { type: 'INTEGER', description: 'Berapa menit dari sekarang' },
      waktu_wib: S('Waktu absolut WIB, format YYYY-MM-DD HH:mm') }, required: ['teks'] } },
  { name: 'lihat_pengingat', description: 'Tampilkan pengingat yang aktif.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'hapus_pengingat', description: 'Hapus pengingat berdasarkan id.',
    parameters: { type: 'OBJECT', properties: { id: { type: 'INTEGER', description: 'Id pengingat' } }, required: ['id'] } },
];

function systemPrompt() {
  return `Kamu adalah agent pribadi pemilik bot ini. Jawab dalam bahasa Indonesia yang singkat dan jelas, kecuali diminta lain.
Waktu sekarang: ${wib()} WIB.
Kamu punya alat: cari_web (info terbaru), buat_gambar (kirim gambar ke chat), catatan, dan pengingat. Pakai alat hanya bila perlu; jangan mengarang fakta, gunakan cari_web untuk data terbaru.
Jika diminta paket konten YouTube Shorts, beri: (1) judul maks 70 karakter, (2) hook 3 detik pertama, (3) naskah 30-45 detik, (4) 4-6 adegan beserta prompt gambar vertikal 9:16 dalam bahasa Inggris, (5) deskripsi dan 3-5 hashtag. Buat gambar hanya jika diminta. Konten harus orisinal dan bernilai tambah.
${EXTRA_PROMPT}`;
}

// ---------- agent loop ----------
const busy = new Set(); // chat yang sedang diproses
const histories = new Map();    // format Gemini
const historiesOA = new Map();  // format OpenAI

function trim(history) {
  while (history.length > MAX_HISTORY) history.shift();
  // riwayat harus diawali pesan teks pengguna, bukan potongan pemanggilan alat
  while (history.length && !(history[0].role === 'user' && history[0].parts?.[0]?.text !== undefined)) history.shift();
}

async function runAgentGemini(chat, userText) {
  const history = histories.get(chat) || [];
  histories.set(chat, history);
  const snapshot = history.length;
  history.push({ role: 'user', parts: [{ text: userText }] });
  const ctx = { chat, images: 0 };

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const data = await gemini(MODEL, {
        systemInstruction: { parts: [{ text: systemPrompt() }] },
        contents: history,
        tools: [{ functionDeclarations: DECLS }],
      });
      const content = data.candidates?.[0]?.content;
      if (!content?.parts?.length) {
        history.length = snapshot;
        return 'Maaf, aku tidak bisa menjawab itu. Coba tanyakan dengan cara lain.';
      }
      content.role = 'model';
      history.push(content);

      const calls = content.parts.filter((p) => p.functionCall);
      if (!calls.length) {
        const out = content.parts.map((p) => p.text || '').join('').trim();
        trim(history);
        return out || 'Selesai.';
      }

      const responses = [];
      for (const p of calls) {
        const { name, args } = p.functionCall;
        let result;
        try {
          if (!tools[name]) throw new Error('alat tidak dikenal');
          result = await tools[name](args || {}, ctx);
        } catch (e) {
          console.error(`alat ${name} gagal:`, e.message);
          result = { error: e.message };
        }
        responses.push({ functionResponse: { name, response: result } });
      }
      history.push({ role: 'user', parts: responses });
    }
    trim(history);
    return 'Aku berhenti karena langkahnya terlalu banyak. Coba pecah permintaannya.';
  } catch (e) {
    history.length = snapshot; // buang riwayat yang setengah jadi
    throw e;
  }
}

// ---------- agent untuk API kompatibel OpenAI ----------
function lowerTypes(x) {
  if (Array.isArray(x)) return x.map(lowerTypes);
  if (x && typeof x === 'object') {
    return Object.fromEntries(Object.entries(x).map(([k, v]) =>
      [k, k === 'type' && typeof v === 'string' ? v.toLowerCase() : lowerTypes(v)]));
  }
  return x;
}
const OA_TOOLS = DECLS.map((d) => ({
  type: 'function',
  function: { name: d.name, description: d.description, parameters: lowerTypes(d.parameters) },
}));

async function openaiChat(body) {
  const res = await fetchRetry(`${LLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_KEY}` },
    body: JSON.stringify(body),
  }, 'LLM');
  return res.json();
}

function trimOA(history) {
  while (history.length > MAX_HISTORY) history.shift();
  while (history.length && history[0].role !== 'user') history.shift();
}

async function runAgentOpenAI(chat, userText) {
  const history = historiesOA.get(chat) || [];
  historiesOA.set(chat, history);
  const snapshot = history.length;
  history.push({ role: 'user', content: userText });
  const ctx = { chat, images: 0 };

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const data = await openaiChat({
        model: LLM_MODEL,
        messages: [{ role: 'system', content: systemPrompt() }, ...history],
        tools: OA_TOOLS,
      });
      const msg = data.choices?.[0]?.message;
      if (!msg) {
        history.length = snapshot;
        return 'Maaf, aku tidak bisa menjawab itu. Coba tanyakan dengan cara lain.';
      }
      const calls = msg.tool_calls || [];
      const clean = { role: 'assistant', content: msg.content ?? '' };
      if (calls.length) clean.tool_calls = calls;
      if (msg.reasoning_content) clean.reasoning_content = msg.reasoning_content;
      history.push(clean);

      if (!calls.length) {
        trimOA(history);
        return (msg.content || '').trim() || 'Selesai.';
      }
      for (const c of calls) {
        let result;
        try {
          const name = c.function?.name;
          if (!tools[name]) throw new Error('alat tidak dikenal');
          let args = {};
          try { args = JSON.parse(c.function.arguments || '{}'); } catch { /* argumen kosong */ }
          result = await tools[name](args, ctx);
        } catch (e) {
          console.error('alat gagal:', e.message);
          result = { error: e.message };
        }
        history.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
      }
    }
    trimOA(history);
    return 'Aku berhenti karena langkahnya terlalu banyak. Coba pecah permintaannya.';
  } catch (e) {
    history.length = snapshot;
    throw e;
  }
}

let geminiDownUntil = 0; // jika Gemini baru saja gagal, langsung pakai cadangan beberapa menit
const DOWN_MS = 5 * 60 * 1000;

async function runAgent(chat, text) {
  if (provider === 'tiarina') return runAgentOpenAI(chat, text);
  if (HAS_TIARINA && Date.now() < geminiDownUntil) {
    const r = await runAgentOpenAI(chat, text);
    return `(Gemini sedang bermasalah, dijawab model cadangan)\n\n${r}`;
  }
  try {
    return await runAgentGemini(chat, text);
  } catch (e) {
    // Gemini sibuk/kuota habis/menggantung -> coba model cadangan (jika diatur)
    if (HAS_TIARINA && /Gemini (429|500|502|503|504|gagal)/.test(e.message)) {
      console.error('Gemini gagal, memakai model cadangan:', redact(e.message).slice(0, 120));
      geminiDownUntil = Date.now() + DOWN_MS;
      const r = await runAgentOpenAI(chat, text);
      return `(Gemini sedang sibuk, dijawab model cadangan)\n\n${r}`;
    }
    throw e;
  }
}

// ---------- pesan masuk ----------
async function handle(msg) {
  const chat = String(msg.chat.id);
  const text = (msg.text || '').trim();
  if (!text) return;
  console.log(`pesan dari ${chat}${OWNER && chat !== OWNER ? ' (diabaikan: bukan pemilik)' : ''}: ${text.slice(0, 40)}`);

  if (text.startsWith('/start') && !OWNER) {
    return say(chat, `Chat ID kamu: ${chat}\nIsi OWNER_CHAT_ID di Environment dengan angka ini, lalu deploy ulang. Setelah itu bot siap dipakai.`);
  }
  if (!OWNER || chat !== OWNER) return; // hanya melayani pemilik

  if (text.startsWith('/start') || text.startsWith('/bantuan')) {
    return say(chat, 'Aku agent-mu. Contoh perintah:\n- "cari berita terbaru tentang ..."\n- "buatkan paket Shorts tentang fakta unik ..."\n- "gambar kucing astronaut gaya kartun"\n- "catat: beli domain"\n- "ingatkan aku 30 menit lagi untuk upload"\n\n/reset - hapus riwayat percakapan\n/model - lihat atau ganti model (gemini / tiarina)');
  }
  if (text.startsWith('/reset')) {
    histories.delete(chat);
    historiesOA.delete(chat);
    return say(chat, 'Riwayat percakapan dihapus (catatan dan pengingat tetap tersimpan).');
  }
  if (text.startsWith('/model')) {
    const arg = (text.split(/\s+/)[1] || '').toLowerCase();
    const aktif = provider === 'tiarina' ? `tiarina (${LLM_MODEL})` : `gemini (${MODEL})`;
    if (!arg) return say(chat, `Model aktif: ${aktif}\nGanti dengan /model gemini atau /model tiarina`);
    if (arg === 'gemini' && KEY) provider = 'gemini';
    else if ((arg === 'tiarina' || arg === 'openai') && HAS_TIARINA) provider = 'tiarina';
    else return say(chat, 'Pilihan tidak tersedia. Pastikan key-nya sudah diisi di Environment.');
    histories.delete(chat);
    historiesOA.delete(chat);
    return say(chat, `Beralih ke ${provider}. Riwayat percakapan dihapus.`);
  }

  if (busy.has(chat)) return say(chat, 'Masih memproses permintaan sebelumnya, tunggu sebentar ya.');
  busy.add(chat);
  const typing = setInterval(() => tg('sendChatAction', { chat_id: chat, action: 'typing' }).catch(() => {}), 4000);
  tg('sendChatAction', { chat_id: chat, action: 'typing' }).catch(() => {});
  try {
    await say(chat, await runAgent(chat, text));
  } catch (e) {
    console.error(e);
    await say(chat, `Terjadi error: ${redact(e.message)}`);
  } finally {
    clearInterval(typing);
    busy.delete(chat);
  }
}

// ---------- pengingat ----------
setInterval(async () => {
  const list = readJson(F_REMIND, []);
  const now = Date.now();
  const due = list.filter((r) => r.at <= now);
  if (!due.length) return;
  writeJson(F_REMIND, list.filter((r) => r.at > now));
  for (const r of due) await say(r.chat, `Pengingat: ${r.teks}`).catch(() => {});
}, 20000);

async function poll() {
  let offset = 0;
  console.log('Bot berjalan...');
  for (;;) {
    try {
      const res = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
      if (!res.ok) {
        console.error('getUpdates gagal:', res.error_code, res.description,
          res.error_code === 409 ? '(ada dua instance bot dengan token yang sama!)' : '');
        await sleep((res.parameters?.retry_after || 5) * 1000);
        continue;
      }
      for (const u of res.result || []) {
        offset = u.update_id + 1;
        if (u.message) handle(u.message).catch((e) => console.error(e));
      }
    } catch (e) {
      console.error('poll error:', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

http.createServer((_, res) => res.end('ok')).listen(process.env.PORT || 3000);
poll();
