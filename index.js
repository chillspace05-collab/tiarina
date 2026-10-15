// Tiarina Agent: Telegram + Gemini (function calling). Node 18+, tanpa dependensi.
// Alat: cari web, buat gambar, catatan, pengingat. Cocok juga untuk membuat paket konten Shorts.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { AsyncLocalStorage } = require('async_hooks');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const KEY = process.env.GEMINI_API_KEY;
const list = (v) => v.split(',').map((m) => m.trim()).filter(Boolean);
const GEMINI_MODELS = list(process.env.GEMINI_MODEL || 'gemini-3.8-flash,gemini-3.5-flash-lite');
const IMAGE_MODELS = list(process.env.IMAGE_MODEL || 'gemini-3.1-flash-image,gemini-3.1-flash-lite-image');
const MODEL = GEMINI_MODELS[0];
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
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-v4.1-flash:free,deepseek-v4-flash:free,qwen3.8-flash:free,glm-5.3-flash:free,deepseek-v4.1-flash-netra:free';
const LLM_MODELS = LLM_MODEL.split(',').map((m) => m.trim()).filter(Boolean);
const BASE_OK = /^https?:\/\/\S+$/i.test(LLM_BASE);
if (LLM_BASE && !BASE_OK) {
  console.error('LLM_BASE_URL tidak valid: harus diawali https:// (mungkin tertukar dengan API key). Model tiarina dinonaktifkan.');
}
const HAS_TIARINA = Boolean(BASE_OK && LLM_KEY);

// TokenomixAI (API kompatibel OpenAI)
const TKX_BASE = (process.env.TOKENOMIX_BASE_URL || 'https://api.tokenomixai.com/v1').replace(/\/+$/, '');
const TKX_KEY = process.env.TOKENOMIX_API_KEY || '';
const TKX_MODELS = (process.env.TOKENOMIX_MODEL || 'deepseek-v4.1-flash,glm-5.3-flash,mimo-v2.6-flash')
  .split(',').map((m) => m.trim()).filter(Boolean);
const HAS_TOKENOMIX = Boolean(/^https?:\/\/\S+$/i.test(TKX_BASE) && TKX_KEY);

// penyedia kompatibel OpenAI
const OA = {
  tiarina: { base: LLM_BASE, key: LLM_KEY, models: LLM_MODELS, ok: HAS_TIARINA, start: 0 },
  tokenomix: { base: TKX_BASE, key: TKX_KEY, models: TKX_MODELS, ok: HAS_TOKENOMIX, start: 0 },
};
const PROVIDERS = ['gemini', 'tokenomix', 'tiarina']; // urutan cadangan
const hasProvider = (p) => (p === 'gemini' ? Boolean(KEY) : Boolean(OA[p]?.ok));

let provider = (process.env.LLM_PROVIDER || (KEY ? 'gemini' : HAS_TIARINA ? 'tiarina' : 'tokenomix')).toLowerCase();
if (provider === 'openai') provider = 'tiarina';
if (!hasProvider(provider)) provider = PROVIDERS.find(hasProvider) || 'gemini';

if (!TOKEN || !PROVIDERS.some(hasProvider)) {
  console.error('TELEGRAM_BOT_TOKEN wajib diisi, plus minimal salah satu: GEMINI_API_KEY, LLM_BASE_URL + LLM_API_KEY, atau TOKENOMIX_API_KEY.');
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
  for (const secret of [TOKEN, KEY, LLM_KEY, TKX_KEY]) {
    if (secret && secret.length > 6) t = t.split(secret).join('***');
  }
  return t.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***');
}

// ---------- HTTP dengan percobaan ulang (untuk error sementara 429/5xx) ----------
const RETRY_MS = parseInt(process.env.RETRY_MS || '1500', 10);
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '45000', 10);
// batas tunggu model utama; lewat dari ini langsung pindah ke penyedia cadangan
const SLOW_MS = parseInt(process.env.SLOW_MS || '25000', 10);
const batas = new AsyncLocalStorage(); // batas waktu khusus untuk satu putaran agent/teks
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchRetry(url, opts, label, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    let res;
    try {
      res = await fetch(url, { ...opts, signal: AbortSignal.timeout(batas.getStore()?.ms || TIMEOUT_MS) });
    } catch (e) {
      const timeout = e.name === 'TimeoutError';
      const badUrl = /parse URL|Invalid URL/i.test(e.message);
      // timeout atau URL salah tidak perlu diulang; langsung gagal (agar bisa pindah ke cadangan)
      if (timeout || badUrl || i === attempts - 1) {
        throw new Error(`${label} gagal: ${timeout ? 'waktu habis' : badUrl ? 'alamat server tidak valid' : redact(e.message)}`);
      }
      await sleep(RETRY_MS * (i + 1));
      continue;
    }
    if (res.ok) return res;
    if (![429, 500, 502, 503, 504].includes(res.status) || i === attempts - 1) {
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

const TRANSIENT = /(Gemini|LLM) (429|500|502|503|504|gagal)/;
async function geminiAny(models, body) {
  let lastErr;
  for (const m of models) {
    try { return await gemini(m, body); } catch (e) {
      lastErr = e;
      console.error(`gemini ${m} gagal: ${redact(e.message).slice(0, 100)}`);
      if (!TRANSIENT.test(e.message) || /waktu habis/.test(e.message)) throw e;
    }
  }
  throw lastErr;
}

// ---------- alat ----------
const tools = {
  async cari_web({ query }) {
    const data = await geminiAny(GEMINI_MODELS, {
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
    const data = await geminiAny(IMAGE_MODELS, {
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

async function runAgentGemini(chat, userText, model = MODEL) {
  const history = histories.get(chat) || [];
  histories.set(chat, history);
  const snapshot = history.length;
  history.push({ role: 'user', parts: [{ text: userText }] });
  const ctx = { chat, images: 0 };

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const data = await gemini(model, {
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
          result = await batas.exit(() => tools[name](args || {}, ctx));
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

// Sebagian gateway (mis. TokenomixAI) mengirim tool_calls sebagai potongan stream yang belum digabung:
// potongan tanpa id dan nama adalah lanjutan argumen dari panggilan sebelumnya.
function mergeToolCalls(calls) {
  const out = [];
  for (const c of calls || []) {
    const f = c.function || {};
    const last = out[out.length - 1];
    if (last && !c.id && !f.name) {
      last.function.arguments += f.arguments || '';
      continue;
    }
    out.push({ id: c.id || `call_${Date.now()}_${out.length}`, type: 'function', function: { name: f.name || '', arguments: f.arguments || '' } });
  }
  return out;
}

async function openaiChat(body, name = 'tiarina') {
  const p = OA[name];
  let lastErr;
  for (let k = 0; k < p.models.length; k++) {
    const idx = (p.start + k) % p.models.length;
    try {
      const res = await fetchRetry(`${p.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
        body: JSON.stringify({ ...body, model: p.models[idx] }),
      }, 'LLM', p.models.length > 1 ? 1 : 3);
      p.start = idx;
      const data = await res.json();
      const msg = data.choices?.[0]?.message;
      if (msg?.tool_calls) msg.tool_calls = mergeToolCalls(msg.tool_calls);
      return data;
    } catch (e) {
      lastErr = e;
      console.error(`${name} ${p.models[idx]} gagal: ${redact(e.message).slice(0, 100)}`);
      // hanya pindah model untuk error sementara; error lain (key salah dll) langsung dilaporkan
      if (!/LLM (429|500|502|503|504|gagal)/.test(e.message) || /waktu habis/.test(e.message)) throw e;
    }
  }
  throw lastErr;
}

function trimOA(history) {
  while (history.length > MAX_HISTORY) history.shift();
  while (history.length && history[0].role !== 'user') history.shift();
}

async function runAgentOpenAI(chat, userText, name = 'tiarina') {
  const history = historiesOA.get(chat) || [];
  historiesOA.set(chat, history);
  const snapshot = history.length;
  history.push({ role: 'user', content: userText });
  const ctx = { chat, images: 0 };

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const data = await openaiChat({
        messages: [{ role: 'system', content: systemPrompt() }, ...history],
        tools: OA_TOOLS,
      }, name);
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
          result = await batas.exit(() => tools[name](args, ctx));
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

// ---------- rantai cadangan: model utama -> model lain -> penyedia lain ----------
const DOWN_MS = 3 * 60 * 1000;
const downUntil = { gemini: 0, tiarina: 0, tokenomix: 0 }; // penyedia yang baru gagal dilewati sementara
const providerOrder = () => [provider, ...PROVIDERS.filter((p) => p !== provider)];

let gemStart = 0; // indeks model Gemini yang terakhir berhasil
async function runGeminiChain(chat, text) {
  let lastErr;
  for (let k = 0; k < GEMINI_MODELS.length; k++) {
    const idx = (gemStart + k) % GEMINI_MODELS.length;
    const m = GEMINI_MODELS[idx];
    try {
      const r = await runAgentGemini(chat, text, m);
      gemStart = idx;
      return r;
    } catch (e) {
      lastErr = e;
      console.error(`gemini ${m} gagal: ${redact(e.message).slice(0, 100)}`);
      if (!TRANSIENT.test(e.message) || /waktu habis/.test(e.message)) throw e;
    }
  }
  throw lastErr;
}

// penyedia yang masih punya cadangan di belakangnya diberi batas SLOW_MS
const withLimit = (todo, i, fn) => batas.run({ ms: i < todo.length - 1 ? Math.min(SLOW_MS, TIMEOUT_MS) : TIMEOUT_MS }, fn);

async function runAgent(chat, text) {
  const order = providerOrder();
  const avail = order.filter(hasProvider);
  let todo = avail.filter((p) => Date.now() >= downUntil[p]);
  if (!todo.length) todo = avail; // semua sedang ditandai bermasalah: tetap coba
  let lastErr;
  for (const [i, p] of todo.entries()) {
    try {
      const r = await withLimit(todo, i, () => (p === 'gemini' ? runGeminiChain(chat, text) : runAgentOpenAI(chat, text, p)));
      downUntil[p] = 0;
      return p === order[0] ? r : `(${order[0]} sedang sibuk, dijawab ${p})\n\n${r}`;
    } catch (e) {
      lastErr = e;
      if (!TRANSIENT.test(e.message)) throw e;
      downUntil[p] = Date.now() + DOWN_MS;
      console.error(`${p} gagal semua, coba penyedia lain: ${redact(e.message).slice(0, 100)}`);
    }
  }
  throw new Error(`Semua model sedang sibuk atau dibatasi. Coba lagi beberapa menit lagi. (detail: ${redact(lastErr?.message || '').slice(0, 120)})`);
}

// ---------- teks sekali jadi (tanpa alat), dipakai fitur Threads ----------
async function llmText(system, user) {
  const avail = providerOrder().filter(hasProvider);
  let todo = avail.filter((p) => Date.now() >= downUntil[p]);
  if (!todo.length) todo = avail;
  let lastErr;
  for (const [i, p] of todo.entries()) {
    try {
      return await withLimit(todo, i, async () => {
        if (p !== 'gemini') {
          const data = await openaiChat({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.9 }, p);
          const t = data.choices?.[0]?.message?.content;
          if (t) return t;
          throw new Error('LLM gagal: jawaban kosong');
        }
        const data = await geminiAny(GEMINI_MODELS, {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
        });
        const t = (data.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
        if (t) return t;
        throw new Error('Gemini gagal: jawaban kosong');
      });
    } catch (e) {
      lastErr = e;
      if (!TRANSIENT.test(e.message)) throw e;
      downUntil[p] = Date.now() + DOWN_MS;
    }
  }
  throw lastErr || new Error('Tidak ada model yang diatur.');
}

const threads = require('./threads')({
  say, tg, llmText, wib, readJson, writeJson, redact,
  searchWeb: (q) => tools.cari_web({ query: q }),
  dataDir: DATA_DIR,
  owner: OWNER,
});

// ---------- tes run (/tes, /tes lengkap): cek model, alat, dan Threads tanpa memposting ----------
async function tesRun(chat, lengkap) {
  await say(chat, `Menjalankan tes${lengkap ? ' lengkap' : ''}... (sekitar ${lengkap ? '1-2 menit' : '30 detik'})`);
  const baris = [];
  const ukur = async (label, fn) => {
    const t0 = Date.now();
    try {
      const r = await batas.run({ ms: TIMEOUT_MS }, fn);
      baris.push(`✅ ${label} (${((Date.now() - t0) / 1000).toFixed(1)} dtk)${r ? `: ${String(r).slice(0, 80)}` : ''}`);
    } catch (e) { baris.push(`❌ ${label}: ${redact(e.message).slice(0, 150)}`); }
  };
  const teksGemini = (d) => (d.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
  const panggilan = (parts) => parts.flatMap((x) => (x.functionCall ? [x.functionCall.name] : []));
  const ping = [{ role: 'user', content: 'Balas satu kata saja: siap' }];
  const minta = 'Simpan catatan berisi: tes alat';

  // 1. model: menjawab + memanggil alat (model yang tidak memanggil alat membuat fitur agent gagal diam-diam)
  for (const p of PROVIDERS) {
    if (!hasProvider(p)) { baris.push(`➖ ${p}: tidak diatur`); continue; }
    if (p === 'gemini') {
      await ukur('gemini menjawab', async () => teksGemini(await geminiAny(GEMINI_MODELS, { contents: [{ role: 'user', parts: [{ text: ping[0].content }] }] })));
      await ukur('gemini memanggil alat', async () => {
        const d = await geminiAny(GEMINI_MODELS, { contents: [{ role: 'user', parts: [{ text: minta }] }], tools: [{ functionDeclarations: DECLS }] });
        const n = panggilan(d.candidates?.[0]?.content?.parts || []);
        if (!n.length) throw new Error('model menjawab tanpa memanggil alat');
        return n.join(', ');
      });
    } else {
      await ukur(`${p} menjawab`, async () => {
        const d = await openaiChat({ messages: ping }, p);
        return `${OA[p].models[OA[p].start]}: ${d.choices?.[0]?.message?.content || '(kosong)'}`;
      });
      await ukur(`${p} memanggil alat`, async () => {
        const d = await openaiChat({ messages: [{ role: 'user', content: minta }], tools: OA_TOOLS }, p);
        const tc = d.choices?.[0]?.message?.tool_calls || [];
        if (!tc.length) throw new Error(`${OA[p].models[OA[p].start]} menjawab tanpa memanggil alat`);
        JSON.parse(tc[0].function.arguments || '{}'); // argumen harus JSON utuh
        return `${OA[p].models[OA[p].start]}: ${tc.map((c) => c.function.name).join(', ')}`;
      });
    }
  }

  // 2. alat: dijalankan langsung lalu dibersihkan lagi
  await ukur('alat catatan (simpan, lihat, hapus)', async () => {
    const r = await tools.simpan_catatan({ teks: '[tes otomatis]' });
    const id = Number(/#(\d+)/.exec(r.hasil)?.[1]);
    if (!(await tools.lihat_catatan()).catatan.some((n) => n.id === id)) throw new Error('catatan tidak tersimpan');
    await tools.hapus_catatan({ id });
  });
  await ukur('penyimpanan data/', async () => {
    const f = path.join(DATA_DIR, 'tes.tmp');
    fs.writeFileSync(f, 'ok');
    fs.unlinkSync(f);
  });
  if (lengkap && KEY) {
    await ukur('alat cari web', async () => {
      const r = await tools.cari_web({ query: 'tanggal hari ini dan satu berita utama Indonesia' });
      return `${r.sumber.length} sumber`;
    });
    await ukur('alat buat gambar', () => tools.buat_gambar({ prompt: 'a small cute robot waving, flat illustration', keterangan: 'Tes alat gambar' }, { chat, images: 0 })
      .then((r) => { if (r.error) throw new Error(r.error); return 'gambar terkirim'; }));
  }

  // 3. Threads
  const th = await threads.tes(lengkap);
  baris.push(...th.baris);

  const gagal = baris.filter((b) => b.startsWith('❌')).length;
  await say(chat, `Hasil tes${lengkap ? ' lengkap' : ''}: ${gagal ? `${gagal} gagal` : 'semua lolos'}\n\n${baris.join('\n')}${lengkap ? '' : '\n\nKirim /tes lengkap untuk juga mencoba cari web, buat gambar, dan menulis draf Threads.'}`);
  if (th.draf) {
    const isi = th.draf.bagian.map((b, i) => (th.draf.bagian.length > 1 ? `[${i + 1}/${th.draf.bagian.length}]\n${b}` : b)).join('\n\n');
    await say(chat, `Contoh draf (TIDAK diposting, topik: ${th.draf.topik}):\n\n${isi}`);
  }
}

// ---------- mode chat: asisten atau Threads (tombol di bawah kolom chat) ----------
const F_MODE = path.join(DATA_DIR, 'mode.json');
const TOMBOL_ASISTEN = '🤖 Mode Asisten';
const TOMBOL_THREADS = '🧵 Mode Threads';
const KEYBOARD = { keyboard: [[{ text: TOMBOL_ASISTEN }, { text: TOMBOL_THREADS }]], resize_keyboard: true, is_persistent: true };
const modeChat = (chat) => readJson(F_MODE, {})[chat] || 'asisten';
function setMode(chat, mode) {
  const semua = readJson(F_MODE, {});
  semua[chat] = mode;
  writeJson(F_MODE, semua);
}
const sayTombol = (chat, text) => tg('sendMessage', { chat_id: chat, text, reply_markup: KEYBOARD });

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
  if (text === TOMBOL_ASISTEN || /^\/asisten(@\S+)?$/i.test(text)) {
    setMode(chat, 'asisten');
    return sayTombol(chat, 'Mode Asisten aktif. Tulis apa saja: cari info, catat, ingatkan, atau buat gambar.');
  }
  if (text === TOMBOL_THREADS || /^\/modethreads(@\S+)?$/i.test(text)) {
    if (!threads.aktif) return say(chat, 'Fitur Threads tidak aktif di bot ini.');
    setMode(chat, 'threads');
    return sayTombol(chat, 'Mode Threads aktif. Kirim topik apa saja, nanti kubuatkan drafnya. Draf tidak diposting sebelum kamu tekan tombol Posting atau Jadwalkan.\n\n/threads - status dan pengaturan (jadwal, mode setuju/otomatis, topik)\n/posting - posting draf terakhir');
  }
  if (await threads.handleCommand(chat, text, msg.message_id)) return;

  if (text.startsWith('/start') || text.startsWith('/bantuan')) {
    return sayTombol(chat, 'Aku agent-mu. Contoh perintah:\n- "cari berita terbaru tentang ..."\n- "buatkan paket Shorts tentang fakta unik ..."\n- "gambar kucing astronaut gaya kartun"\n- "catat: beli domain"\n- "ingatkan aku 30 menit lagi untuk upload"\n\n/reset - hapus riwayat percakapan\n/model - lihat atau ganti model (gemini / tiarina / tokenomix)\n/status - cek kondisi model\n/threads - posting harian ke Threads (status dan pengaturan)\n/dadakan topik - draf Threads topik dadakan\n/token TOKEN - perbarui token Threads\n\nTombol di bawah: Mode Asisten (pesan dijawab agent) atau Mode Threads (pesan jadi draf Threads).\n/tes - tes run model, alat, dan Threads (tanpa posting)\n/tes lengkap - plus cari web, gambar, dan contoh draf');
  }
  if (/^\/tes(@\S+)?(\s|$)/i.test(text)) {
    if (busy.has(chat)) return say(chat, 'Masih memproses permintaan sebelumnya, tunggu sebentar ya.');
    busy.add(chat);
    try { await tesRun(chat, /lengkap/i.test(text)); } catch (e) { await say(chat, `Tes berhenti: ${redact(e.message)}`); } finally { busy.delete(chat); }
    return;
  }
  if (text.startsWith('/reset')) {
    histories.delete(chat);
    historiesOA.delete(chat);
    return say(chat, 'Riwayat percakapan dihapus (catatan dan pengingat tetap tersimpan).');
  }
  if (text.startsWith('/status')) {
    const st = (p, ok) => !ok ? 'tidak diatur' : Date.now() < downUntil[p] ? `bermasalah (dilewati sampai ${wib(downUntil[p]).slice(11)} WIB)` : 'siap';
    return say(chat, `Mode chat: ${modeChat(chat)}\nUtama: ${provider}\nGemini: ${st('gemini', Boolean(KEY))} [${GEMINI_MODELS.join(', ')}]\nTiarina: ${st('tiarina', HAS_TIARINA)} [${LLM_MODELS.join(', ')}]\nTokenomix: ${st('tokenomix', HAS_TOKENOMIX)} [${TKX_MODELS.join(', ')}]`);
  }
  if (text.startsWith('/model')) {
    let arg = (text.split(/\s+/)[1] || '').toLowerCase();
    if (arg === 'openai') arg = 'tiarina';
    const aktif = provider === 'gemini' ? `gemini (${GEMINI_MODELS[gemStart]})` : `${provider} (${OA[provider].models[OA[provider].start]})`;
    if (!arg) return say(chat, `Model aktif: ${aktif}\nGanti dengan /model gemini, /model tiarina, atau /model tokenomix`);
    if (PROVIDERS.includes(arg) && hasProvider(arg)) provider = arg;
    else return say(chat, 'Pilihan tidak tersedia. Pastikan key-nya sudah diisi di Environment.');
    histories.delete(chat);
    historiesOA.delete(chat);
    return say(chat, `Beralih ke ${provider}. Riwayat percakapan dihapus.`);
  }

  // Mode Threads: teks biasa menjadi topik draf
  if (modeChat(chat) === 'threads' && threads.aktif && !text.startsWith('/')) {
    return threads.handleCommand(chat, `/dadakan ${text}`);
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
      const res = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
      if (!res.ok) {
        console.error('getUpdates gagal:', res.error_code, res.description,
          res.error_code === 409 ? '(ada dua instance bot dengan token yang sama!)' : '');
        await sleep((res.parameters?.retry_after || 5) * 1000);
        continue;
      }
      for (const u of res.result || []) {
        offset = u.update_id + 1;
        if (u.message) handle(u.message).catch((e) => console.error(e));
        if (u.callback_query) threads.handleCallback(u.callback_query).catch((e) => console.error(e));
      }
    } catch (e) {
      console.error('poll error:', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

setInterval(() => threads.tick().catch((e) => console.error('threads tick:', e.message)), parseInt(process.env.THREADS_TICK_MS || '60000', 10));

http.createServer((_, res) => res.end('ok')).listen(process.env.PORT || 3000);
poll();
