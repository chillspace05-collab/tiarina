// Agent chat via Telegram bot + Gemini. Tanpa dependensi, butuh Node 18+.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const OWNER = (process.env.OWNER_CHAT_ID || '').trim();
const MAX_TURNS = parseInt(process.env.MAX_TURNS || '20', 10); // jumlah pesan riwayat yang diingat
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  'Kamu adalah asisten pribadi yang ramah, singkat, dan jelas. Jawab dalam bahasa yang dipakai pengguna.';

if (!TOKEN || !GEMINI_KEY) {
  console.error('TELEGRAM_BOT_TOKEN dan GEMINI_API_KEY wajib diisi di Environment.');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;
const histories = new Map(); // chatId -> [{role, parts:[{text}]}]

async function tg(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function say(chat_id, text) {
  // Telegram membatasi 4096 karakter per pesan
  for (let i = 0; i < text.length; i += 4000) {
    await tg('sendMessage', { chat_id, text: text.slice(i, i + 4000) });
  }
}

async function askGemini(history) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: history,
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
  return text || 'Maaf, aku tidak bisa menjawab itu. Coba tanyakan dengan cara lain.';
}

async function handle(msg) {
  const chat = String(msg.chat.id);
  const text = (msg.text || '').trim();
  if (!text) return;

  if (text.startsWith('/start')) {
    if (!OWNER) {
      return say(chat, `Chat ID kamu: ${chat}\nIsi OWNER_CHAT_ID di Environment dengan angka ini, lalu redeploy. Setelah itu bot siap dipakai.`);
    }
    if (chat !== OWNER) return;
    return say(chat, 'Halo! Kirim pesan apa saja, aku akan menjawab.\n\n/reset - hapus riwayat percakapan');
  }

  // Bot hanya melayani pemilik, supaya kuota API kamu tidak dipakai orang lain
  if (!OWNER || chat !== OWNER) return;

  if (text.startsWith('/reset')) {
    histories.delete(chat);
    return say(chat, 'Riwayat percakapan dihapus.');
  }

  const history = histories.get(chat) || [];
  history.push({ role: 'user', parts: [{ text }] });
  while (history.length > MAX_TURNS) history.shift();
  while (history.length && history[0].role !== 'user') history.shift();
  histories.set(chat, history);

  tg('sendChatAction', { chat_id: chat, action: 'typing' });
  try {
    const answer = await askGemini(history);
    history.push({ role: 'model', parts: [{ text: answer }] });
    await say(chat, answer);
  } catch (e) {
    console.error(e);
    history.pop(); // buang pesan yang gagal supaya riwayat tetap rapi
    await say(chat, `Terjadi error: ${e.message}`);
  }
}

async function poll() {
  let offset = 0;
  console.log('Bot berjalan...');
  for (;;) {
    try {
      const res = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
      for (const u of res.result || []) {
        offset = u.update_id + 1;
        if (u.message) await handle(u.message).catch((e) => console.error(e));
      }
    } catch (e) {
      console.error('poll error:', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// server kecil supaya platform menganggap app sehat
require('http')
  .createServer((_, res) => res.end('ok'))
  .listen(process.env.PORT || 3000);

poll();
