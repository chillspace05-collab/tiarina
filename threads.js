// threads.js - posting teks harian otomatis ke Threads, diatur lewat Telegram.
// Memakai Threads API resmi (izin threads_basic + threads_content_publish).

const path = require('path');
const crypto = require('crypto');

const PILAR = [
  'kehidupan sehari-hari yang relatable',
  'kesehatan mental sehari-hari',
  'dunia kerja kantoran yang ringan dan non-sensitif',
  'gym dan latihan beban',
  'info kesehatan ringan',
  'AI dan teknologi yang sedang tren',
];

const GAYA_BAWAAN = `Bahasa Indonesia sehari-hari yang umum dan wajar, seperti orang biasa menulis di media sosialnya sendiri. Mudah dipahami siapa saja.
Register menyesuaikan topik dan suasana: bisa santai, bisa agak serius, bisa sedikit lucu. Tidak harus rapi seperti artikel.
Pakai kata-kata biasa dan langsung ke maksudnya. Istilah Inggris hanya yang memang umum dipakai sehari-hari ("deadline", "meeting", "update").
Kata ganti "aku", atau tanpa kata ganti sama sekali. Sesekali "kita" bila wajar, jangan menggurui dengan "kamu harus".
Penulis tinggal di Solo, jadi sesekali boleh ada sedikit rasa Solo sebagai bumbu, paling banyak satu selipan per postingan dan tidak wajib.
Pakai yang umum dimengerti orang luar Jawa: partikel "og", "lho", "to", "wae"; ungkapan "monggo", "nggih", "matur nuwun", "alon-alon waton kelakon";
atau menyebut hal khas Solo secara wajar (wedangan di hik, nasi liwet, timlo, bangjo, Manahan, Ngarsopuro). Jangan menjelaskan arti kata Jawa.
Bahasa utama tetap Indonesia umum; selipan Jawa tidak boleh membuat kalimat sulit dipahami.
Dilarang memakai umpatan atau plesetan umpatan.`;

const PERSONA_BAWAAN =
  'Seorang pekerja kantoran (ASN, tapi jarang disebut) yang tinggal di Solo, rutin gym, melek teknologi, dan senang memperhatikan hal-hal kecil dalam keseharian.';

// frasa dan kata yang terlalu sering muncul di tulisan AI; dicek otomatis setelah draf jadi
const KLISE = [
  'di era digital', 'di era modern', 'di era sekarang', 'di zaman sekarang ini', 'di tengah hiruk pikuk', 'di tengah kesibukan',
  'mari kita', 'yuk simak', 'yuk kita', 'kesimpulannya', 'pada akhirnya', 'penting untuk diingat', 'perlu diingat', 'ingatlah',
  'tidak dapat dipungkiri', 'tak dapat dipungkiri', 'tidak bisa dipungkiri', 'tak bisa dipungkiri', 'tanpa disadari', 'tak terasa',
  'bukan sekadar', 'lebih dari sekadar', 'bukan hanya', 'tetapi juga', 'sejatinya', 'sesungguhnya', 'hakikatnya', 'nyatanya',
  'percayalah', 'siapa sangka', 'ternyata oh ternyata', 'yang menarik adalah', 'satu hal yang pasti', 'menjadi kunci', 'kunci utama',
  'langkah kecil', 'perjalanan hidup', 'sebuah perjalanan', 'self-love', 'self love', 'menemukan makna', 'esensi', 'keseimbangan hidup',
  'semoga bermanfaat', 'jangan lupa untuk', 'bagaimana dengan kamu', 'bagaimana denganmu', 'gimana menurut kalian', 'setuju?',
  'apakah kamu juga', 'kamu tidak sendiri', 'kamu tidak sendirian', 'it\'s okay', 'its okay', 'valid kok', 'pelan-pelan saja',
  'healing', 'produktivitas', 'mindset', 'insight', 'game changer', 'level up', 'upgrade diri', 'versi terbaik',
  'memang benar', 'tentu saja', 'sangatlah', 'merupakan', 'senantiasa', 'tak lain', 'tidak lain adalah',
];
const ATURAN = `Aturan menulis agar terasa ditulis manusia, bukan AI:
- Baris pertama langsung masuk ke hal yang spesifik (kejadian, benda, angka kecil, kalimat orang). Maksimal 12 kata, jujur, bukan clickbait.
- Tulis dari pengalaman atau pengamatan konkret: tempat, jam, benda, suara, percakapan pendek. Hindari kalimat umum yang bisa ditulis siapa saja.
- Panjang kalimat dan paragraf tidak seragam. Boleh satu kalimat pendek berdiri sendiri. Jangan setiap paragraf berpola sama.
- Jangan pakai pola khas AI: kalimat "bukan X, tapi Y", rangkaian tiga hal berirama ("A, B, dan C"), pertanyaan retoris di awal,
  "Hasilnya?" / "Jawabannya:" sebelum pengungkapan, dan pesan moral atau kesimpulan di akhir.
- Tidak perlu selalu ada pelajaran. Boleh berhenti di cerita, di kalimat yang menggantung, atau di punchline. Pertanyaan ke pembaca sesekali saja, jangan tiap postingan.
- Bahas satu topik saja dengan bahasa umum dan apa adanya. Jangan menyambungkan atau membandingkan dengan dunia lain dari persona
  (gym, kerja kantor, AI/teknologi) lewat perumpamaan atau istilah, misalnya "angkat barbel seperti beban kerja", "otak perlu di-upgrade seperti software", "kerjaan seperti set dan repetisi".
  Hindari majas dan perumpamaan yang dipaksakan; tulis yang dimaksud secara langsung.
- Tanpa hashtag. Emoji paling banyak satu, lebih sering tidak ada. Tanpa daftar bernomor atau poin, tanpa huruf tebal, tanpa tanda pisah panjang (—).
- Jangan memakai kata/frasa ini: ${KLISE.map((k) => `"${k}"`).join(', ')}.

Rambu konten (wajib):
- Tanpa politik, pemilu, partai, atau tokoh politik. Tanpa SARA.
- Tanpa kritik terhadap instansi, atasan, atau rekan kerja tertentu. Tanpa data atau informasi internal kantor. Tanpa keluhan angka gaji atau tunjangan.
- Kesehatan dan kesehatan mental: informasi umum dan empatik saja. Tanpa diagnosis, tanpa dosis obat atau suplemen, tanpa detail tentang menyakiti diri. Bila relevan, sarankan bicara dengan tenaga profesional.
- Jangan mengarang fakta, angka, atau nama produk. Kalau ragu, tulis secara umum.`;

const NADA = [
  'santai seperti cerita ke teman di grup chat',
  'catatan pendek seperti jurnal pribadi, agak pelan',
  'receh dan menertawakan diri sendiri',
  'cerita satu kejadian kecil hari ini, apa adanya',
  'opini singkat yang agak beda dari kebanyakan orang, tetap sopan',
  'pengamatan iseng tentang hal sepele yang ternyata menarik',
];
const HARI = 864e5;
const MAKS_JADWAL = 6;
// "7:00, 12:00 19:00" -> "07:00,12:00,19:00" (urut, unik); null bila ada jam yang salah
function rapikanJadwal(teks) {
  const jam = String(teks).split(/[,;\s]+/).filter(Boolean);
  if (!jam.length || jam.length > MAKS_JADWAL) return null;
  const ok = [];
  for (const j of jam) {
    const m = /^(\d{1,2})[:.](\d{2})$/.exec(j);
    if (!m || +m[1] > 23 || +m[2] > 59) return null;
    ok.push(`${m[1].padStart(2, '0')}:${m[2]}`);
  }
  return [...new Set(ok)].sort().join(',');
}
// topik Threads (topic_tag) bawaan per pilar; dipakai bila model tidak memberi topik yang valid
const TAG_PILAR = {
  'kehidupan sehari-hari yang relatable': 'Daily Life Threads',
  'kesehatan mental sehari-hari': 'Mental Health Threads',
  'dunia kerja kantoran yang ringan dan non-sensitif': 'Work Life Threads',
  'gym dan latihan beban': 'Gym Threads',
  'info kesehatan ringan': 'Health Threads',
  'AI dan teknologi yang sedang tren': 'AI Threads',
};
// aturan Threads: 1-50 karakter, tanpa titik dan "&"
function rapikanTag(t) {
  const s = String(t || '').replace(/^#/, '').replace(/[.&#]/g, '').replace(/\s+/g, ' ').trim();
  return s.length && s.length <= 50 ? s : '';
}
const MAKS_UTAS = 8; // bagian per postingan: 1 postingan utama + balasan berantai

module.exports = function createThreads(deps) {
  const { say, tg, llmText, searchWeb, wib, readJson, writeJson, dataDir, redact, owner } = deps;
  const BASE = (process.env.THREADS_API_BASE || 'https://graph.threads.net/v1.0').replace(/\/+$/, '');
  const ORIGIN = new URL(BASE).origin;
  const USER = process.env.THREADS_USER_ID || 'me';
  const AKTIF = !process.env.THREADS_NONAKTIF; // dimatikan start.js untuk bot yang bukan bot Threads
  const ENV_TOKEN = (process.env.THREADS_ACCESS_TOKEN || '').trim();
  const TOKEN_TAG = ENV_TOKEN.slice(-10);
  const APP_SECRET = (process.env.THREADS_APP_SECRET || '').trim();
  const F = path.join(dataDir, 'threads.json');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const enc = encodeURIComponent;

  const bawaan = () => ({
    jadwal: rapikanJadwal(process.env.THREADS_JADWAL || '') || '07:00,12:00,19:00',
    mode: (process.env.THREADS_MODE || '').toLowerCase() === 'setuju' ? 'setuju' : 'otomatis',
    topik: process.env.THREADS_TOPIK || 'acak',
    panjang: Math.min(MAKS_UTAS, Math.max(1, parseInt(process.env.THREADS_PANJANG || '1', 10) || 1)),
    gaya: process.env.THREADS_GAYA || GAYA_BAWAAN,
    persona: process.env.THREADS_PERSONA || PERSONA_BAWAAN,
    jeda: false,
  });
  const s0 = readJson(F, {});
  const st = {
    set: { ...bawaan(), ...(s0.set || {}) },
    riwayat: s0.riwayat || [],
    draf: s0.draf || null,
    drafTanggal: s0.drafTanggal || '',
    terakhirPosting: s0.terakhirPosting || '',
    slotSelesai: s0.slotSelesai || '', // slot terjadwal terakhir yang sudah ditangani, "YYYY-MM-DD HH:MM"
    drafSlot: s0.drafSlot || '',
    topikNanti: s0.topikNanti || '',
    gagal: s0.gagal || {},
    cobaLagi: s0.cobaLagi || 0,
    token: s0.token || null,
    tokenCoba: s0.tokenCoba || 0,
    peringatan: s0.peringatan || '',
    cadanganId: s0.cadanganId || 0,
  };
  const simpan = () => writeJson(F, st);

  // Token yang dipakai: token dari bot (/token atau hasil perpanjangan) selama Environment belum diganti.
  const tokenBot = () => (st.token?.value && st.token.dari === TOKEN_TAG ? st.token : null);
  const token = () => tokenBot()?.value || ENV_TOKEN;
  const adaToken = () => Boolean(token());
  const sensor = (t) => {
    let s = redact(String(t));
    for (const k of [ENV_TOKEN, st.token?.value, APP_SECRET]) if (k && k.length > 6) s = s.split(k).join('***');
    return s;
  };
  const masalahToken = (msg) => /expired|session has|invalid oauth|error validating access token|access token|\b190\b/i.test(msg);
  const pesanGagal = (e) => {
    const m = sensor(e.message);
    return masalahToken(m)
      ? `${m}\n\nSepertinya token Threads tidak valid atau sudah habis. Buat token baru di dashboard Meta, lalu kirim:\n/token TOKEN_BARU`
      : m;
  };

  // ---------- cadangan token terenkripsi (disematkan di chat Telegram) ----------
  const KUNCI = crypto.createHash('sha256').update('threads-cadangan:' + (process.env.TELEGRAM_BOT_TOKEN || '')).digest();
  function enkripsi(obj) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', KUNCI, iv);
    const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
    return 'THB1:' + Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
  }
  function dekripsi(s) {
    const b = Buffer.from(s.slice(5), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', KUNCI, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
  }
  // isi cadangan: token dari bot + pengaturan yang diubah lewat Telegram (beda dari Environment)
  function isiCadangan() {
    const b = bawaan();
    const ubah = {};
    for (const k of Object.keys(st.set)) if (st.set[k] !== b[k]) ubah[k] = st.set[k];
    return { versi: 2, token: tokenBot(), ubah, topikNanti: st.topikNanti || '' };
  }
  let terakhirDicadangkan = '';
  async function simpanCadangan() {
    if (!owner) return;
    const isi = isiCadangan();
    if (!isi.token && !Object.keys(isi.ubah).length && !isi.topikNanti && !st.cadanganId) return;
    let teks = `Cadangan token dan pengaturan Threads (terenkripsi). Jangan dihapus atau di-unpin; bot memakainya lagi setelah deploy ulang.\n${enkripsi(isi)}`;
    if (teks.length > 4000) { // gaya/persona panjang: lewati agar muat satu pesan Telegram
      delete isi.ubah.gaya; delete isi.ubah.persona;
      teks = teks.slice(0, teks.indexOf('\n') + 1) + enkripsi(isi);
    }
    terakhirDicadangkan = JSON.stringify(isi);
    if (st.cadanganId) { // perbarui pesan yang sudah di-pin, tanpa pesan baru
      const e = await tg('editMessageText', { chat_id: owner, message_id: st.cadanganId, text: teks });
      if (e?.ok || /not modified/i.test(e?.description || '')) return;
    }
    const r = await tg('sendMessage', { chat_id: owner, disable_notification: true, text: teks });
    if (!r?.ok) return;
    await tg('pinChatMessage', { chat_id: owner, message_id: r.result.message_id, disable_notification: true }).catch(() => {});
    if (st.cadanganId && st.cadanganId !== r.result.message_id) {
      tg('deleteMessage', { chat_id: owner, message_id: st.cadanganId }).catch(() => {});
    }
    st.cadanganId = r.result.message_id;
    simpan();
  }
  async function pulihkanCadangan() {
    if (!owner || Object.keys(s0).length) return; // data/ masih ada: bukan deploy ulang
    try {
      const r = await tg('getChat', { chat_id: owner });
      const pm = r?.result?.pinned_message;
      const m = /THB1:[A-Za-z0-9+/=]+/.exec(pm?.text || '');
      if (!m) return;
      const c = dekripsi(m[0]);
      const isi = c.versi === 2 ? c : { token: c, ubah: {} }; // cadangan lama hanya berisi token
      st.cadanganId = pm.message_id;
      Object.assign(st.set, isi.ubah || {});
      st.topikNanti = isi.topikNanti || '';
      const t = isi.token;
      // token dipakai lagi hanya bila Environment belum diganti dan belum kedaluwarsa
      if (t && t.dari === TOKEN_TAG && !(t.kedaluwarsa && t.kedaluwarsa < Date.now())) st.token = t;
      terakhirDicadangkan = JSON.stringify(isiCadangan());
      simpan();
      console.log('Token dan pengaturan Threads dipulihkan dari cadangan Telegram.');
    } catch (e) {
      console.error('Gagal memulihkan cadangan token:', sensor(e.message));
    }
  }
  // token pendek (1 jam) di Environment ditukar sekali menjadi token 60 hari saat bot start
  async function tukarTokenEnv() {
    if (!ENV_TOKEN || !APP_SECRET || tokenBot()) return;
    try {
      const j = await getJson(`${ORIGIN}/access_token?grant_type=th_exchange_token&client_secret=${enc(APP_SECRET)}&access_token=${enc(ENV_TOKEN)}`);
      if (!j.access_token) return;
      st.token = { value: j.access_token, dari: TOKEN_TAG, diperbarui: Date.now(), kedaluwarsa: Date.now() + (j.expires_in || 0) * 1000, perkiraan: false };
      simpan();
      console.log('Token Threads dari Environment ditukar menjadi token 60 hari.');
      await simpanCadangan().catch(() => {});
    } catch (e) {
      // token sudah 60 hari, atau sudah habis: dipakai apa adanya
      console.error('Token Threads tidak ditukar:', sensor(e.message));
    }
  }
  async function cadangkanJikaBerubah() {
    if (siap && JSON.stringify(isiCadangan()) !== terakhirDicadangkan) await simpanCadangan().catch(() => {});
  }
  let siap = false;
  pulihkanCadangan().then(tukarTokenEnv).finally(() => { siap = true; });

  // ---------- waktu ----------
  const keMenit = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
    if (!m || +m[1] > 23 || +m[2] > 59) return null;
    return +m[1] * 60 + +m[2];
  };
  const sekarang = () => { const s = wib(); return { tanggal: s.slice(0, 10), menit: keMenit(s.slice(11, 16)) }; };
  const daftarJadwal = () => (rapikanJadwal(st.set.jadwal) || '19:00').split(',');
  // jam terjadwal berikutnya yang belum lewat hari ini (atau jam pertama besok)
  function slotBerikutnya() {
    const { menit } = sekarang();
    const j = daftarJadwal();
    return j.find((x) => keMenit(x) > menit) || j[0];
  }
  // kunci "YYYY-MM-DD HH:MM" untuk jam terjadwal berikutnya (besok bila semua jam hari ini sudah lewat)
  function kunciSlotBerikutnya() {
    const { tanggal, menit } = sekarang();
    const j = daftarJadwal();
    const hariIni = j.find((x) => keMenit(x) > menit);
    return hariIni ? `${tanggal} ${hariIni}` : `${wib(Date.now() + HARI).slice(0, 10)} ${j[0]}`;
  }
  // slot yang sedang jatuh tempo: jam terakhir yang sudah lewat hari ini, maksimal 3 jam yang lalu
  function slotJatuhTempo() {
    const { tanggal, menit } = sekarang();
    const lewat = daftarJadwal().filter((x) => keMenit(x) <= menit);
    if (!lewat.length) return null;
    const jam = lewat.at(-1);
    const key = `${tanggal} ${jam}`;
    if (key <= st.slotSelesai) return null;
    if (menit - keMenit(jam) > 180) { st.slotSelesai = key; simpan(); return null; } // bot sempat mati lama: lewati
    return { jam, key };
  }

  // ---------- Threads API ----------
  async function th(method, p, params = {}, tok = token()) {
    const q = new URLSearchParams({ ...params, access_token: tok });
    const opts = { signal: AbortSignal.timeout(30000) };
    const res = method === 'POST'
      ? await fetch(`${BASE}${p}`, { ...opts, method: 'POST', body: q })
      : await fetch(`${BASE}${p}?${q}`, { ...opts, method });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(`Threads ${res.status}: ${sensor(j.error?.message || JSON.stringify(j)).slice(0, 200)}`);
    return j;
  }
  async function getJson(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(sensor(j.error?.message || `status ${res.status}`));
    return j;
  }

  async function sudahPostingSejak(key) {
    try {
      const j = await th('GET', `/${USER}/threads`, { fields: 'id,timestamp', limit: '1' });
      const ts = j.data?.[0]?.timestamp;
      if (!ts) return false;
      const ms = Date.parse(ts.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
      return wib(ms).slice(0, 16) >= key;
    } catch { return false; }
  }

  // ---------- masa berlaku token ----------
  async function perbaruiToken() {
    if (!adaToken() || Date.now() - st.tokenCoba < HARI) return;
    const t = tokenBot();
    if (t && Date.now() - (t.diperbarui || 0) < 7 * HARI) return;
    st.tokenCoba = Date.now();
    try {
      const j = await getJson(`${ORIGIN}/refresh_access_token?grant_type=th_refresh_token&access_token=${enc(token())}`);
      if (!j.access_token) throw new Error('jawaban tanpa token');
      st.token = { value: j.access_token, dari: TOKEN_TAG, diperbarui: Date.now(), kedaluwarsa: Date.now() + (j.expires_in || 0) * 1000, perkiraan: false };
      simpan();
      console.log('Token Threads diperbarui.');
      await simpanCadangan().catch(() => {});
    } catch (e) {
      console.error('Gagal memperbarui token Threads:', sensor(e.message));
      simpan();
      if (masalahToken(e.message)) await peringatkan(`Perpanjangan otomatis token Threads gagal: ${sensor(e.message)}`, true);
    }
  }

  async function peringatkan(alasan, paksa = false) {
    const hariIni = sekarang().tanggal;
    if (!owner || (!paksa && st.peringatan === hariIni) || (paksa && st.peringatan === `${hariIni}!`)) return;
    st.peringatan = paksa ? `${hariIni}!` : hariIni;
    simpan();
    await say(owner, `Peringatan token Threads.\n${alasan}\n\nCara memperbarui: buat token baru di dashboard Meta (pengaturan Threads API), lalu kirim di sini:\n/token TOKEN_BARU\nPesan berisi token akan langsung kuhapus dari chat.`).catch(() => {});
  }

  async function cekMasaToken() {
    const t = tokenBot();
    if (!adaToken() || !t?.kedaluwarsa) return;
    const sisa = Math.ceil((t.kedaluwarsa - Date.now()) / HARI);
    if (sisa > 7) return;
    const tgl = wib(t.kedaluwarsa).slice(0, 10);
    await peringatkan(sisa <= 0
      ? `Token sudah habis (${tgl}). Posting ke Threads tidak akan jalan sampai token diperbarui.`
      : `Token akan habis dalam ${sisa} hari (${t.perkiraan ? 'sekitar ' : ''}${tgl}), dan perpanjangan otomatis belum berhasil.`);
  }

  async function pasangToken(chat, baru, msgId) {
    if (msgId) tg('deleteMessage', { chat_id: chat, message_id: msgId }).catch(() => {});
    baru = String(baru).trim();
    if (baru.length < 20) return say(chat, 'Token terlalu pendek, sepertinya tidak tersalin lengkap.');
    await say(chat, 'Memeriksa token... (pesan berisi token sudah kuhapus dari chat)');
    let value = baru, kedaluwarsa = 0;
    if (APP_SECRET) { // token pendek (1 jam) ditukar menjadi token 60 hari
      try {
        const j = await getJson(`${ORIGIN}/access_token?grant_type=th_exchange_token&client_secret=${enc(APP_SECRET)}&access_token=${enc(baru)}`);
        if (j.access_token) { value = j.access_token; kedaluwarsa = Date.now() + (j.expires_in || 0) * 1000; }
      } catch { /* mungkin sudah token panjang */ }
    }
    if (!kedaluwarsa) {
      try {
        const j = await getJson(`${ORIGIN}/refresh_access_token?grant_type=th_refresh_token&access_token=${enc(value)}`);
        if (j.access_token) { value = j.access_token; kedaluwarsa = Date.now() + (j.expires_in || 0) * 1000; }
      } catch { /* token baru (<24 jam) belum bisa diperpanjang; tidak masalah */ }
    }
    let nama;
    try {
      const me = await th('GET', '/me', { fields: 'id,username' }, value);
      nama = me.username ? `@${me.username}` : me.id;
    } catch (e) {
      return say(chat, `Token ditolak oleh Threads: ${sensor(e.message)}\nPastikan tokennya lengkap dan izinnya threads_basic + threads_content_publish.`);
    }
    const perkiraan = !kedaluwarsa;
    if (perkiraan) kedaluwarsa = Date.now() + 60 * HARI;
    st.token = { value, dari: TOKEN_TAG, diperbarui: Date.now(), kedaluwarsa, perkiraan };
    st.tokenCoba = 0;
    st.peringatan = '';
    simpan();
    await simpanCadangan().catch(() => {});
    const catatan = perkiraan && !APP_SECRET
      ? '\n\nCatatan: masa berlaku ini perkiraan. Pastikan yang kamu kirim token 60 hari (long-lived). Kalau dashboard hanya memberi token 1 jam, isi THREADS_APP_SECRET di Environment supaya bot bisa menukarnya otomatis.'
      : '';
    return say(chat, `Token aktif untuk ${nama}. Berlaku sampai ${perkiraan ? 'sekitar ' : ''}${wib(kedaluwarsa).slice(0, 10)}.\nCadangan terenkripsi sudah disematkan di chat ini, jadi token tetap terpakai setelah deploy ulang. Jangan di-unpin.${catatan}`);
  }

  function infoToken() {
    if (!adaToken()) return 'belum ada (kirim /token TOKEN)';
    const t = tokenBot();
    if (!t?.kedaluwarsa) return 'dari Environment (masa berlaku diketahui setelah perpanjangan pertama)';
    return `${t.perkiraan ? 'sekitar ' : ''}berlaku sampai ${wib(t.kedaluwarsa).slice(0, 10)}`;
  }

  // ---------- penulisan ----------
  function cariKlise(teks) {
    // tanda baca selain ? ' - jadi spasi, lalu cocokkan sebagai kata utuh
    const t = ` ${String(teks).toLowerCase().replace(/[^\p{L}\d?'\- ]+/gu, ' ').replace(/\s+/g, ' ')} `;
    return KLISE.filter((k) => t.includes(` ${k} `));
  }
  // bekas khas AI yang aman dibersihkan otomatis
  function rapikan(x) {
    return String(x)
      .replace(/\s*[—–]\s*/g, ', ')      // tanda pisah panjang
      .replace(/\*\*(.+?)\*\*/g, '$1')   // huruf tebal markdown
      .replace(/(^|\s)#[\p{L}\d_]+/gu, '') // hashtag
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  function pilihTopik(paksa) {
    if (paksa) return paksa;
    const t = String(st.set.topik);
    const n = parseInt(t, 10);
    if (t !== 'acak') return !Number.isNaN(n) && PILAR[n - 1] ? PILAR[n - 1] : t;
    const baru = st.riwayat.slice(-2).map((r) => r.topik);
    const opsi = PILAR.filter((p) => !baru.includes(p));
    return opsi[Math.floor(Math.random() * opsi.length)];
  }

  function potong(teks) {
    if (teks.length <= 500) return [teks];
    const out = [];
    let buf = '';
    for (const k of teks.split(/(?<=[.!?…])\s+/)) {
      if ((buf + ' ' + k).trim().length > 490) {
        if (buf) out.push(buf.trim());
        buf = k;
        while (buf.length > 490) { out.push(buf.slice(0, 490)); buf = buf.slice(490); }
      } else buf = (buf + ' ' + k).trim();
    }
    if (buf) out.push(buf.trim());
    return out;
  }

  function bacaJson(t) {
    const s = String(t).replace(/```json|```/g, '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('Model tidak mengembalikan format yang diminta. Coba /buat lagi.');
    return JSON.parse(s.slice(a, b + 1));
  }

  async function tulis(topikPaksa, utas) {
    const topik = pilihTopik(topikPaksa);
    const panjang = utas || st.set.panjang;
    let konteks = '';
    if (/AI|teknologi|tech/i.test(topik)) {
      try {
        const r = await searchWeb('berita AI dan teknologi terbaru minggu ini yang ramai dibicarakan di Indonesia');
        if (r?.ringkasan) konteks = `\n\nInfo terbaru dari pencarian web (pakai hanya yang relevan, jangan menambah fakta di luar ini):\n${r.ringkasan.slice(0, 1500)}`;
      } catch { /* tanpa pencarian, tulis secara umum */ }
    }
    const hindari = st.riwayat.slice(-10).map((r) => `- ${r.hook}`).join('\n') || '- (belum ada)';
    const nada = NADA[Math.floor(Math.random() * NADA.length)];
    const asn = Math.random() < 0.15 ? 'Boleh menyebut bahwa penulis ASN bila memang relevan.' : 'Jangan menyebut ASN, PNS, atau instansi; cukup "kerja" atau "kantor" bila perlu.';
    const solo = Math.random() < 0.35 ? 'Boleh satu selipan rasa Solo bila pas, jangan dipaksakan.' : 'Kali ini tanpa selipan bahasa Jawa.';
    const system = `Kamu menulis postingan Threads untuk akun pribadi.
Persona penulis: ${st.set.persona}
Gaya bahasa:
${st.set.gaya}

${ATURAN}`;
    const user = `Topik: ${topik}
Nada kali ini: ${nada}. ${solo} ${asn} Fokus hanya pada topik ini, jangan dicampur istilah atau perumpamaan dari topik lain.
Jumlah bagian: tepat ${panjang} (setiap bagian maksimal 480 karakter; jika lebih dari satu, ini utas: bagian 1 membuat orang ingin membuka balasannya, tiap bagian berikutnya melanjutkan dari bagian sebelumnya sebagai satu alur, bagian terakhir tidak perlu kesimpulan).
Hook yang sudah pernah dipakai, jangan diulang atau dibuat mirip:
${hindari}${konteks}

Isi juga "tag": satu topik Threads yang paling relevan dengan isi tulisan, dalam bentuk nama komunitas Threads berbahasa Inggris "<Nama> Threads",
misalnya "AI Threads", "Tech Threads", "Gym Threads", "Fitness Threads", "Mental Health Threads", "Health Threads", "Work Life Threads", "Daily Life Threads", "Book Threads", "Food Threads". Tanpa titik, tanpa "&", maksimal 50 karakter.

Balas HANYA dengan JSON: {"hook":"baris pertama","tag":"AI Threads","bagian":["teks bagian 1"]}`;
    let j = bacaJson(await llmText(system, user));
    let bagian = (Array.isArray(j.bagian) ? j.bagian : []).map(rapikan).filter(Boolean);
    const kena = cariKlise(bagian.join('\n'));
    if (kena.length) { // satu kali tulis ulang tanpa frasa yang terdeteksi
      try {
        const j2 = bacaJson(await llmText(system, `${user}\n\nDraf sebelumnya:\n${JSON.stringify({ hook: j.hook, bagian })}\n\nTulis ulang draf itu dengan isi yang sama, tetapi tanpa kata/frasa berikut dan tanpa menggantinya dengan sinonim yang sama klisenya: ${kena.map((k) => `"${k}"`).join(', ')}. Balas HANYA dengan JSON yang sama formatnya.`));
        const b2 = (Array.isArray(j2.bagian) ? j2.bagian : []).map(rapikan).filter(Boolean);
        if (b2.length && cariKlise(b2.join('\n')).length < kena.length) { j = j2; bagian = b2; }
      } catch { /* pakai draf pertama */ }
    }
    bagian = bagian.flatMap(potong).slice(0, MAKS_UTAS);
    if (!bagian.length) throw new Error('Draf kosong. Coba /buat lagi.');
    const tag = rapikanTag(j.tag) || TAG_PILAR[topik] || '';
    return { topik, tag, utas: panjang, hook: String(j.hook || bagian[0].split('\n')[0]).slice(0, 120), bagian, dibuat: wib() };
  }

  // tulisan untuk jadwal: pakai topik titipan (/nanti) sekali, lalu kembali normal
  async function tulisTerjadwal() {
    const titip = st.topikNanti;
    const d = await tulis(titip || null);
    if (titip) { st.topikNanti = ''; simpan(); }
    return d;
  }

  async function posting(draf) {
    if (!adaToken()) throw new Error('Token Threads belum ada. Kirim /token TOKEN atau isi THREADS_ACCESS_TOKEN di Environment.');
    let balasKe = null, pertama = null;
    const ids = [];
    for (const teks of draf.bagian) {
      const isi = { media_type: 'TEXT', text: teks, ...(balasKe ? { reply_to_id: balasKe } : {}) };
      let c;
      if (!balasKe && draf.tag) { // topik hanya di postingan utama; bila ditolak API, posting tanpa topik
        try { c = await th('POST', `/${USER}/threads`, { ...isi, topic_tag: draf.tag }); } catch (e) {
          if (masalahToken(e.message)) throw e;
          draf.tag = '';
        }
      }
      c = c || await th('POST', `/${USER}/threads`, isi);
      await sleep(3000);
      const p = await th('POST', `/${USER}/threads_publish`, { creation_id: c.id });
      balasKe = p.id;
      ids.push(p.id);
      pertama = pertama || p.id;
    }
    let link = '';
    try { link = (await th('GET', `/${pertama}`, { fields: 'permalink' })).permalink || ''; } catch { /* link opsional */ }
    st.terakhirPosting = wib().slice(0, 16);
    st.riwayat = [...st.riwayat, { tanggal: st.terakhirPosting.slice(0, 10), topik: draf.topik, tag: draf.tag || '', hook: draf.hook, ids, link }].slice(-30);
    st.draf = null;
    simpan();
    return link;
  }

  // preview isi yang sudah terposting, dengan tombol hapus sebagai pengaman
  async function kirimPreview(chat, draf, link, awalan = 'Terposting') {
    const n = draf.bagian.length;
    const isi = n > 1 ? draf.bagian.map((b, i) => `[${i + 1}/${n}]\n${b}`).join('\n\n') : draf.bagian[0];
    const r = st.riwayat.at(-1);
    const tombol = r?.ids?.length ? { inline_keyboard: [[{ text: '🗑 Hapus dari Threads', callback_data: `th:del:${r.ids[0]}` }]] } : undefined;
    const teks = `${awalan} (${draf.topik}${n > 1 ? `, ${n} utas` : ''}):${draf.tag ? `\nTopik Threads: ${draf.tag}` : ''}${link ? `\n${link}` : ''}\n\n${isi}`;
    if (teks.length <= 4000) return tg('sendMessage', { chat_id: chat, text: teks, ...(tombol ? { reply_markup: tombol } : {}) });
    await say(chat, teks);
    if (tombol) await tg('sendMessage', { chat_id: chat, text: 'Postingan di atas:', reply_markup: tombol });
  }
  async function hapusPostingan(chat, idPertama) {
    const r = st.riwayat.find((x) => x.ids?.[0] === idPertama);
    if (!r) return say(chat, 'Data postingan ini sudah tidak ada di bot (mungkin setelah deploy ulang). Hapus manual di aplikasi Threads.');
    if (r.dihapus) return say(chat, 'Postingan ini sudah dihapus.');
    for (const id of [...r.ids].reverse()) await th('DELETE', `/${id}`); // balasan dulu, lalu postingan utama
    r.dihapus = true;
    simpan();
    await say(chat, `Postingan "${r.hook}" (${r.ids.length} bagian) sudah dihapus dari Threads.`);
  }

  async function kirimDraf(chat, draf, awalan = '') {
    const n = draf.bagian.length;
    const isi = n > 1 ? draf.bagian.map((b, i) => `[${i + 1}/${n}]\n${b}`).join('\n\n') : draf.bagian[0];
    const judul = `${awalan}Draf Threads (${draf.topik})${n > 1 ? `, ${n} utas` : ''}:${draf.tag ? `\nTopik Threads: ${draf.tag}` : ''}\n\n`;
    const tombol = { inline_keyboard: [
      [{ text: 'Posting sekarang', callback_data: 'th:post' }, { text: `Jadwalkan ${draf.slot || slotBerikutnya()}`, callback_data: 'th:sched' }],
      [{ text: 'Tulis ulang', callback_data: 'th:redo' }, { text: 'Lewati', callback_data: 'th:skip' }],
    ] };
    if ((judul + isi).length <= 4000) return tg('sendMessage', { chat_id: chat, text: judul + isi, reply_markup: tombol });
    await say(chat, judul + isi);
    await tg('sendMessage', { chat_id: chat, text: `Draf di atas (${n} utas) mau diapakan?`, reply_markup: tombol });
  }


  // ---------- perintah Telegram ----------
  let sibuk = false;
  async function kunci(fn) {
    if (sibuk) return false;
    sibuk = true;
    try { await fn(); } finally { sibuk = false; }
    return true;
  }

  function status() {
    const daftar = PILAR.map((p, i) => `${i + 1}. ${p}`).join('\n');
    return `Threads
Mode: ${st.set.mode}${st.set.jeda ? ' (DIJEDA)' : ''}
Jadwal: ${daftarJadwal().join(', ')} WIB (${daftarJadwal().length}x sehari)
Topik: ${st.set.topik}${st.topikNanti ? `\nTopik titipan untuk jadwal berikutnya: ${st.topikNanti}` : ''}
Panjang: ${st.set.panjang} bagian
Terakhir posting: ${st.terakhirPosting || '-'}
Token: ${infoToken()}

Daftar topik:
${daftar}

Perintah:
/dadakan topik - draf topik dadakan sekarang (sama dengan /buat topik)
/nanti topik - titip topik untuk posting terjadwal berikutnya (/nanti batal)
/buat - draf dulu (tidak langsung posting), /posting, /jadwal 07:00,12:00,19:00
/mode otomatis (langsung posting, preview dikirim ke sini) | setuju (draf disetujui dulu)
/topik acak|nomor|teks, /panjang 1-8, /gaya teks|reset, /persona teks|reset
/jeda, /lanjut, /token TOKEN_BARU`;
  }

  async function handleCommand(chat, text, msgId) {
    const [c, ...rest] = text.split(/\s+/);
    const cmd = c.toLowerCase().split('@')[0];
    const arg = rest.join(' ').trim();
    const daftar = ['/threads', '/jadwal', '/mode', '/topik', '/panjang', '/gaya', '/persona', '/buat', '/dadakan', '/nanti', '/posting', '/jeda', '/lanjut', '/token'];
    if (!daftar.includes(cmd)) return false;
    if (!AKTIF) { await say(chat, 'Fitur Threads tidak aktif di bot ini.'); return true; }

    if (cmd === '/threads') await say(chat, status());
    else if (cmd === '/token') {
      if (!arg) await say(chat, `Token: ${infoToken()}\n\nUntuk memperbarui, buat token baru di dashboard Meta lalu kirim:\n/token TOKEN_BARU\nPesan berisi token akan langsung kuhapus dari chat.`);
      else await pasangToken(chat, arg, msgId);
    } else if (cmd === '/jadwal') {
      const j = rapikanJadwal(arg);
      if (!j) await say(chat, `Format jam salah. Contoh: /jadwal 19:00 atau /jadwal 07:00,12:00,19:00 (maksimal ${MAKS_JADWAL} jam).`);
      else { st.set.jadwal = j; st.drafSlot = ''; simpan(); await say(chat, `Jadwal posting: ${j.split(',').join(', ')} WIB (${j.split(',').length}x sehari).`); }
    } else if (cmd === '/mode') {
      if (!['setuju', 'otomatis'].includes(arg)) await say(chat, 'Pilih: /mode setuju (draf dikirim dulu) atau /mode otomatis (langsung posting).');
      else { st.set.mode = arg; simpan(); await say(chat, `Mode: ${arg}.`); }
    } else if (cmd === '/topik') {
      if (!arg) await say(chat, `Topik sekarang: ${st.set.topik}\n\n${PILAR.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nContoh: /topik acak, /topik 4, /topik cerita lucu di kantor`);
      else { st.set.topik = arg; simpan(); await say(chat, `Topik tetap diatur: ${arg}.`); }
    } else if (cmd === '/nanti') {
      if (!arg) await say(chat, st.topikNanti ? `Topik titipan: ${st.topikNanti}` : 'Belum ada topik titipan. Contoh: /nanti pengalaman pertama ikut apel pagi');
      else if (arg === 'batal') { st.topikNanti = ''; simpan(); await say(chat, 'Topik titipan dibatalkan.'); }
      else { st.topikNanti = arg; simpan(); await say(chat, `Oke, posting terjadwal berikutnya (${slotBerikutnya()} WIB) akan membahas: ${arg}. Setelah itu kembali ke topik biasa.`); }
    } else if (cmd === '/panjang') {
      const n = parseInt(arg, 10);
      if (!(n >= 1 && n <= MAKS_UTAS)) await say(chat, `Isi 1 sampai ${MAKS_UTAS}. Contoh: /panjang 3 (1 postingan + 2 balasan bersambung)`);
      else { st.set.panjang = n; simpan(); await say(chat, `Setiap postingan: ${n} bagian.`); }
    } else if (cmd === '/gaya' || cmd === '/persona') {
      const key = cmd.slice(1);
      if (!arg) await say(chat, `${key} sekarang:\n${st.set[key]}`);
      else { st.set[key] = arg === 'reset' ? bawaan()[key] : arg; simpan(); await say(chat, `${key} diperbarui.`); }
    } else if (cmd === '/jeda' || cmd === '/lanjut') {
      st.set.jeda = cmd === '/jeda'; simpan();
      await say(chat, st.set.jeda ? 'Posting harian dijeda.' : 'Posting harian dilanjutkan.');
    } else if (cmd === '/buat' || cmd === '/dadakan') {
      if (cmd === '/dadakan' && !arg) { await say(chat, 'Tulis topiknya. Contoh: /dadakan hujan deras pas pulang kantor'); return true; }
      const ok = await kunci(async () => {
        await say(chat, cmd === '/dadakan' && st.set.mode === 'otomatis' && adaToken() ? 'Menulis dan memposting...' : 'Menulis draf...');
        const m = /^([1-8])\s*(?:utas|bagian)\b\s*[:|-]?\s*(\S.*)$/is.exec(arg);
        try {
          st.draf = m ? await tulis(m[2], +m[1]) : await tulis(arg || null); simpan();
          if (cmd === '/dadakan' && st.set.mode === 'otomatis' && adaToken()) {
            const d = st.draf;
            const link = await posting(d);
            await kirimPreview(chat, d, link);
          } else await kirimDraf(chat, st.draf);
        }
        catch (e) { await say(chat, `Gagal membuat draf: ${pesanGagal(e)}`); }
      });
      if (!ok) await say(chat, 'Fitur Threads sedang memproses sesuatu, tunggu sebentar.');
    } else if (cmd === '/posting') {
      if (!st.draf) await say(chat, 'Belum ada draf. Kirim /buat dulu.');
      else {
        const ok = await kunci(async () => {
          try { const d = st.draf; const link = await posting(d); await kirimPreview(chat, d, link); }
          catch (e) { await say(chat, `Gagal posting: ${pesanGagal(e)}`); }
        });
        if (!ok) await say(chat, 'Fitur Threads sedang memproses sesuatu, tunggu sebentar.');
      }
    }
    await cadangkanJikaBerubah();
    return true;
  }

  // ---------- tes run (/tes): cek tanpa memposting apa pun ----------
  async function tes(lengkap) {
    const baris = [];
    if (!AKTIF) return { baris: ['➖ Threads: tidak aktif di bot ini'], draf: null };
    if (!adaToken()) baris.push('➖ Threads: token belum ada (isi THREADS_ACCESS_TOKEN atau kirim /token TOKEN)');
    else {
      try {
        const me = await th('GET', '/me', { fields: 'id,username' });
        baris.push(`✅ Token Threads: @${me.username || me.id}, ${infoToken()}`);
      } catch (e) { baris.push(`❌ Token Threads: ${pesanGagal(e).split('\n')[0]}`); }
      try {
        const q = await th('GET', `/${USER}/threads_publishing_limit`, { fields: 'quota_usage,config' });
        const d = q.data?.[0];
        if (d) baris.push(`✅ Kuota posting 24 jam: ${d.quota_usage}/${d.config?.quota_total ?? '?'}`);
      } catch (e) { baris.push(`❌ Kuota posting: ${sensor(e.message).slice(0, 120)}`); }
    }
    baris.push(`ℹ️ Jadwal ${daftarJadwal().join(', ')} WIB, mode ${st.set.mode}${st.set.jeda ? ' (DIJEDA)' : ''}, terakhir posting ${st.terakhirPosting || '-'}`);
    baris.push(st.cadanganId ? '✅ Cadangan token/pengaturan ter-pin di chat' : 'ℹ️ Belum ada cadangan ter-pin (dibuat otomatis saat ada token/pengaturan dari Telegram)');
    let draf = null;
    if (lengkap) {
      const t0 = Date.now();
      try {
        draf = await tulis(null); // hanya ditulis, tidak disimpan sebagai draf dan tidak diposting
        baris.push(`✅ Tulis draf Threads (${((Date.now() - t0) / 1000).toFixed(1)} dtk, topik: ${draf.topik})`);
      } catch (e) { baris.push(`❌ Tulis draf Threads: ${pesanGagal(e).split('\n')[0]}`); }
    }
    return { baris, draf };
  }

  async function handleCallback(cq) {
    const chat = String(cq.message?.chat?.id || '');
    tg('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
    if (!owner || chat !== owner || !String(cq.data || '').startsWith('th:')) return;
    const aksi = cq.data.slice(3);
    if (aksi.startsWith('del:')) {
      try { await hapusPostingan(chat, aksi.slice(4)); } catch (e) { await say(chat, `Gagal menghapus: ${pesanGagal(e)}`); }
      return;
    }
    if (!st.draf) return say(chat, 'Draf ini sudah tidak aktif. Kirim /buat untuk membuat yang baru.');
    const ok = await kunci(async () => {
      try {
        if (aksi === 'post') {
          await say(chat, 'Memposting...');
          const d = st.draf;
          const link = await posting(d);
          await kirimPreview(chat, d, link);
        } else if (aksi === 'sched') {
          st.draf.disetujui = true; simpan();
          if (!st.draf.slotKey) { st.draf.slotKey = kunciSlotBerikutnya(); st.draf.slot = st.draf.slotKey.slice(11); }
          simpan();
          await say(chat, `Oke, diposting ${st.draf.slotKey.slice(0, 10) === sekarang().tanggal ? 'hari ini' : 'besok'} jam ${st.draf.slot} WIB.`);
        } else if (aksi === 'redo') {
          await say(chat, 'Menulis ulang...');
          st.draf = await tulis(st.draf.topik, st.draf.utas); simpan();
          await kirimDraf(chat, st.draf);
        } else if (aksi === 'skip') {
          if (st.draf.slotKey) st.slotSelesai = st.draf.slotKey;
          st.draf = null; simpan();
          await say(chat, 'Draf ini dilewati.');
        }
      } catch (e) { await say(chat, `Gagal: ${pesanGagal(e)}`); }
    });
    if (!ok) await say(chat, 'Masih memproses, tunggu sebentar.');
  }

  // ---------- jadwal (dipanggil tiap menit) ----------
  async function tick() {
    if (!AKTIF || !owner || !siap) return;
    await cadangkanJikaBerubah();
    await perbaruiToken().catch(() => {});
    await cekMasaToken().catch(() => {});
    if (st.set.jeda || sibuk) return;
    const { tanggal, menit } = sekarang();
    if (menit == null || Date.now() < st.cobaLagi) return;

    await kunci(async () => {
      let slot = null;
      try {
        if (st.set.mode === 'setuju') {
          // draf yang sudah disetujui diposting saat jamnya tiba
          if (st.draf?.disetujui && adaToken() && wib().slice(0, 16) >= (st.draf.slotKey || '')) {
            const d = st.draf;
            const link = await posting(d);
            if (d.slotKey) st.slotSelesai = d.slotKey;
            simpan();
            await kirimPreview(owner, d, link, 'Posting terjadwal terkirim');
            return;
          }
          // draf dikirim sampai 60 menit sebelum jam berikutnya
          const jam = daftarJadwal().find((x) => menit >= keMenit(x) - 60 && menit < keMenit(x) + 120);
          const key = jam && `${tanggal} ${jam}`;
          if (!jam || key <= st.slotSelesai || key === st.drafSlot || st.draf?.disetujui) return;
          slot = { jam, key };
          if ((st.gagal[key] || 0) >= 3) return;
          st.drafSlot = key; simpan();
          st.draf = { ...(await tulisTerjadwal()), slot: jam, slotKey: key }; simpan();
          await kirimDraf(owner, st.draf, `Draf untuk jam ${jam}. `);
          return;
        }
        slot = slotJatuhTempo();
        if (!slot || !adaToken() || (st.gagal[slot.key] || 0) >= 3) return;
        if (await sudahPostingSejak(slot.key)) { st.slotSelesai = slot.key; simpan(); return; }
        const draf = await tulisTerjadwal();
        const link = await posting(draf);
        st.slotSelesai = slot.key; simpan();
        await kirimPreview(owner, draf, link, `Posting jam ${slot.jam} terkirim`);
      } catch (e) {
        const key = slot?.key || tanggal;
        st.gagal = { [key]: (st.gagal[key] || 0) + 1 };
        st.cobaLagi = Date.now() + 10 * 60000;
        simpan();
        await say(owner, `Threads gagal (percobaan ${st.gagal[key]}/3, dicoba lagi 10 menit): ${pesanGagal(e)}`).catch(() => {});
      }
    });
  }

  return { handleCommand, handleCallback, tick, tes, aktif: AKTIF };
};
