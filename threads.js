// threads.js - posting teks harian otomatis ke Threads, diatur lewat Telegram.
// Memakai Threads API resmi (izin threads_basic + threads_content_publish).

const path = require('path');
const crypto = require('crypto');

const PILAR = [
  'kehidupan sehari-hari yang relatable',
  'kesehatan mental dari sudut pandang pegawai ASN',
  'dunia kerja ASN yang ringan dan non-sensitif',
  'gym dan latihan beban',
  'info kesehatan ringan',
  'AI dan teknologi yang sedang tren',
];

const GAYA_BAWAAN = `Semi-formal, hangat, dan elegan, dengan rasa logat Solo yang halus.
Dasar tulisan bahasa Indonesia yang rapi; rasa Solo muncul lewat selipan kecil, bukan kalimat Jawa penuh.
Bahan selipan (pilih paling banyak dua per postingan, tidak harus ada di setiap postingan):
- Partikel santai khas Solo: "og" (seperti "kok/loh", misal "Iya og, ternyata..."), "no" (seperti "dong"), "lho", "to", "wae".
- Ungkapan halus: "nggih", "monggo", "nyuwun sewu", "matur nuwun", "sumeleh", "alon-alon waton kelakon", "ojo kesusu".
- Kosakata keseharian Solo: "jan tenan" (sungguh), "naknu" (kalau begitu), "sek/kosek" (sebentar), "yah mene" (jam segini),
  "ngeleh" (lapar), "kebeteng" (tertahan hujan), "tletik" (gerimis), "udan kethek" (hujan saat cerah), "mondo" (kurang manis),
  "wedangan di hik" (nongkrong di angkringan), "bangjo" (lampu merah), "jagongan" (duduk santai), "gembrebeg" (meriang).
Istilah asing (Inggris) boleh sesekali bila lazim, misalnya "deadline", "burnout", "PR (personal record)", "workflow".
Dilarang memakai umpatan atau plesetan umpatan. Jangan menjelaskan arti kata Jawa kecuali benar-benar perlu.`;

const PERSONA_BAWAAN =
  'Seorang pegawai ASN yang rutin gym, melek teknologi, berlogat Solo, dan senang merenungkan hal-hal kecil dalam keseharian.';

const ATURAN = `Aturan menulis agar terasa ditulis manusia:
- Baris pertama adalah hook yang kuat dan jujur (maksimal 12 kata), bukan clickbait bohong.
- Kalimat bervariasi panjangnya. Pakai detail kecil yang konkret dan terasa nyata.
- Tanpa hashtag. Emoji paling banyak satu, boleh tidak ada sama sekali.
- Tanpa daftar bernomor atau poin-poin, tanpa huruf tebal, tanpa tanda pisah panjang.
- Hindari frasa klise seperti "Di era digital ini", "Mari kita", "Yuk simak", "Kesimpulannya", "Penting untuk diingat", "Tidak dapat dipungkiri".
- Penutup bervariasi: kadang pertanyaan ke pembaca, kadang kalimat yang menggantung, kadang punchline tenang.

Rambu konten (wajib):
- Tanpa politik, pemilu, partai, atau tokoh politik. Tanpa SARA.
- Tanpa kritik terhadap instansi, atasan, atau rekan kerja tertentu. Tanpa data atau informasi internal kantor. Tanpa keluhan angka gaji atau tunjangan.
- Kesehatan dan kesehatan mental: informasi umum dan empatik saja. Tanpa diagnosis, tanpa dosis obat atau suplemen, tanpa detail tentang menyakiti diri. Bila relevan, sarankan bicara dengan tenaga profesional.
- Jangan mengarang fakta, angka, atau nama produk. Kalau ragu, tulis secara umum.`;

const HARI = 864e5;

module.exports = function createThreads(deps) {
  const { say, tg, llmText, searchWeb, wib, readJson, writeJson, dataDir, redact, owner } = deps;
  const BASE = (process.env.THREADS_API_BASE || 'https://graph.threads.net/v1.0').replace(/\/+$/, '');
  const ORIGIN = new URL(BASE).origin;
  const USER = process.env.THREADS_USER_ID || 'me';
  const ENV_TOKEN = (process.env.THREADS_ACCESS_TOKEN || '').trim();
  const TOKEN_TAG = ENV_TOKEN.slice(-10);
  const APP_SECRET = (process.env.THREADS_APP_SECRET || '').trim();
  const F = path.join(dataDir, 'threads.json');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const enc = encodeURIComponent;

  const bawaan = () => ({
    jadwal: process.env.THREADS_JADWAL || '19:00',
    mode: (process.env.THREADS_MODE || '').toLowerCase() === 'otomatis' ? 'otomatis' : 'setuju',
    topik: process.env.THREADS_TOPIK || 'acak',
    panjang: Math.min(4, Math.max(1, parseInt(process.env.THREADS_PANJANG || '1', 10) || 1)),
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

  // ---------- Threads API ----------
  async function th(method, p, params = {}, tok = token()) {
    const q = new URLSearchParams({ ...params, access_token: tok });
    const opts = { signal: AbortSignal.timeout(30000) };
    const res = method === 'GET'
      ? await fetch(`${BASE}${p}?${q}`, opts)
      : await fetch(`${BASE}${p}`, { ...opts, method: 'POST', body: q });
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

  async function sudahPostingHariIni() {
    try {
      const j = await th('GET', `/${USER}/threads`, { fields: 'id,timestamp', limit: '1' });
      const ts = j.data?.[0]?.timestamp;
      if (!ts) return false;
      const ms = Date.parse(ts.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
      return wib(ms).slice(0, 10) === sekarang().tanggal;
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

  async function tulis(topikPaksa) {
    const topik = pilihTopik(topikPaksa);
    let konteks = '';
    if (/AI|teknologi|tech/i.test(topik)) {
      try {
        const r = await searchWeb('berita AI dan teknologi terbaru minggu ini yang ramai dibicarakan di Indonesia');
        if (r?.ringkasan) konteks = `\n\nInfo terbaru dari pencarian web (pakai hanya yang relevan, jangan menambah fakta di luar ini):\n${r.ringkasan.slice(0, 1500)}`;
      } catch { /* tanpa pencarian, tulis secara umum */ }
    }
    const hindari = st.riwayat.slice(-10).map((r) => `- ${r.hook}`).join('\n') || '- (belum ada)';
    const system = `Kamu menulis postingan Threads untuk akun pribadi.
Persona penulis: ${st.set.persona}
Gaya bahasa:
${st.set.gaya}

${ATURAN}`;
    const user = `Topik: ${topik}
Jumlah bagian: ${st.set.panjang} (setiap bagian maksimal 480 karakter; jika lebih dari satu, bagian berikutnya melanjutkan seperti utas).
Hook yang sudah pernah dipakai, jangan diulang atau dibuat mirip:
${hindari}${konteks}

Balas HANYA dengan JSON: {"hook":"baris pertama","bagian":["teks bagian 1"]}`;
    const j = bacaJson(await llmText(system, user));
    const bagian = (Array.isArray(j.bagian) ? j.bagian : []).map((x) => String(x).trim()).filter(Boolean).flatMap(potong).slice(0, 6);
    if (!bagian.length) throw new Error('Draf kosong. Coba /buat lagi.');
    return { topik, hook: String(j.hook || bagian[0].split('\n')[0]).slice(0, 120), bagian, dibuat: wib() };
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
    for (const teks of draf.bagian) {
      const c = await th('POST', `/${USER}/threads`, { media_type: 'TEXT', text: teks, ...(balasKe ? { reply_to_id: balasKe } : {}) });
      await sleep(3000);
      const p = await th('POST', `/${USER}/threads_publish`, { creation_id: c.id });
      balasKe = p.id;
      pertama = pertama || p.id;
    }
    let link = '';
    try { link = (await th('GET', `/${pertama}`, { fields: 'permalink' })).permalink || ''; } catch { /* link opsional */ }
    st.terakhirPosting = sekarang().tanggal;
    st.riwayat = [...st.riwayat, { tanggal: st.terakhirPosting, topik: draf.topik, hook: draf.hook }].slice(-30);
    st.draf = null;
    simpan();
    return link;
  }

  async function kirimDraf(chat, draf, awalan = '') {
    const isi = draf.bagian.length > 1
      ? draf.bagian.map((b, i) => `[${i + 1}/${draf.bagian.length}]\n${b}`).join('\n\n')
      : draf.bagian[0];
    await tg('sendMessage', {
      chat_id: chat,
      text: `${awalan}Draf Threads (${draf.topik}):\n\n${isi}`.slice(0, 4000),
      reply_markup: { inline_keyboard: [
        [{ text: 'Posting sekarang', callback_data: 'th:post' }, { text: `Jadwalkan ${st.set.jadwal}`, callback_data: 'th:sched' }],
        [{ text: 'Tulis ulang', callback_data: 'th:redo' }, { text: 'Lewati', callback_data: 'th:skip' }],
      ] },
    });
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
Jadwal: ${st.set.jadwal} WIB
Topik: ${st.set.topik}${st.topikNanti ? `\nTopik titipan untuk jadwal berikutnya: ${st.topikNanti}` : ''}
Panjang: ${st.set.panjang} bagian
Terakhir posting: ${st.terakhirPosting || '-'}
Token: ${infoToken()}

Daftar topik:
${daftar}

Perintah:
/dadakan topik - draf topik dadakan sekarang (sama dengan /buat topik)
/nanti topik - titip topik untuk posting terjadwal berikutnya (/nanti batal)
/buat, /posting, /jadwal 19:00, /mode setuju|otomatis
/topik acak|nomor|teks, /panjang 1-4, /gaya teks|reset, /persona teks|reset
/jeda, /lanjut, /token TOKEN_BARU`;
  }

  async function handleCommand(chat, text, msgId) {
    const [c, ...rest] = text.split(/\s+/);
    const cmd = c.toLowerCase().split('@')[0];
    const arg = rest.join(' ').trim();
    const daftar = ['/threads', '/jadwal', '/mode', '/topik', '/panjang', '/gaya', '/persona', '/buat', '/dadakan', '/nanti', '/posting', '/jeda', '/lanjut', '/token'];
    if (!daftar.includes(cmd)) return false;

    if (cmd === '/threads') await say(chat, status());
    else if (cmd === '/token') {
      if (!arg) await say(chat, `Token: ${infoToken()}\n\nUntuk memperbarui, buat token baru di dashboard Meta lalu kirim:\n/token TOKEN_BARU\nPesan berisi token akan langsung kuhapus dari chat.`);
      else await pasangToken(chat, arg, msgId);
    } else if (cmd === '/jadwal') {
      if (keMenit(arg) == null) await say(chat, 'Format jam salah. Contoh: /jadwal 19:00');
      else { st.set.jadwal = arg.padStart(5, '0'); st.drafTanggal = ''; simpan(); await say(chat, `Jadwal posting: ${st.set.jadwal} WIB.`); }
    } else if (cmd === '/mode') {
      if (!['setuju', 'otomatis'].includes(arg)) await say(chat, 'Pilih: /mode setuju (draf dikirim dulu) atau /mode otomatis (langsung posting).');
      else { st.set.mode = arg; simpan(); await say(chat, `Mode: ${arg}.`); }
    } else if (cmd === '/topik') {
      if (!arg) await say(chat, `Topik sekarang: ${st.set.topik}\n\n${PILAR.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nContoh: /topik acak, /topik 4, /topik cerita lucu di kantor`);
      else { st.set.topik = arg; simpan(); await say(chat, `Topik tetap diatur: ${arg}.`); }
    } else if (cmd === '/nanti') {
      if (!arg) await say(chat, st.topikNanti ? `Topik titipan: ${st.topikNanti}` : 'Belum ada topik titipan. Contoh: /nanti pengalaman pertama ikut apel pagi');
      else if (arg === 'batal') { st.topikNanti = ''; simpan(); await say(chat, 'Topik titipan dibatalkan.'); }
      else { st.topikNanti = arg; simpan(); await say(chat, `Oke, posting terjadwal berikutnya (${st.set.jadwal} WIB) akan membahas: ${arg}. Setelah itu kembali ke topik biasa.`); }
    } else if (cmd === '/panjang') {
      const n = parseInt(arg, 10);
      if (!(n >= 1 && n <= 4)) await say(chat, 'Isi 1 sampai 4. Contoh: /panjang 2');
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
        await say(chat, 'Menulis draf...');
        try { st.draf = await tulis(arg || null); simpan(); await kirimDraf(chat, st.draf); }
        catch (e) { await say(chat, `Gagal membuat draf: ${pesanGagal(e)}`); }
      });
      if (!ok) await say(chat, 'Fitur Threads sedang memproses sesuatu, tunggu sebentar.');
    } else if (cmd === '/posting') {
      if (!st.draf) await say(chat, 'Belum ada draf. Kirim /buat dulu.');
      else {
        const ok = await kunci(async () => {
          try { const link = await posting(st.draf); await say(chat, `Terposting.${link ? `\n${link}` : ''}`); }
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
    baris.push(`ℹ️ Jadwal ${st.set.jadwal} WIB, mode ${st.set.mode}${st.set.jeda ? ' (DIJEDA)' : ''}, terakhir posting ${st.terakhirPosting || '-'}`);
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
    if (!st.draf) return say(chat, 'Draf ini sudah tidak aktif. Kirim /buat untuk membuat yang baru.');
    const ok = await kunci(async () => {
      try {
        if (aksi === 'post') {
          await say(chat, 'Memposting...');
          const link = await posting(st.draf);
          await say(chat, `Terposting.${link ? `\n${link}` : ''}`);
        } else if (aksi === 'sched') {
          st.draf.disetujui = true; simpan();
          await say(chat, `Oke, diposting jam ${st.set.jadwal} WIB (atau segera kalau jam itu sudah lewat hari ini).`);
        } else if (aksi === 'redo') {
          await say(chat, 'Menulis ulang...');
          st.draf = await tulis(st.draf.topik); simpan();
          await kirimDraf(chat, st.draf);
        } else if (aksi === 'skip') {
          st.draf = null; st.drafTanggal = sekarang().tanggal; simpan();
          await say(chat, 'Draf hari ini dilewati.');
        }
      } catch (e) { await say(chat, `Gagal: ${pesanGagal(e)}`); }
    });
    if (!ok) await say(chat, 'Masih memproses, tunggu sebentar.');
  }

  // ---------- jadwal (dipanggil tiap menit) ----------
  async function tick() {
    if (!owner || !siap) return;
    await cadangkanJikaBerubah();
    await perbaruiToken().catch(() => {});
    await cekMasaToken().catch(() => {});
    if (st.set.jeda || sibuk) return;
    const { tanggal, menit } = sekarang();
    const j = keMenit(st.set.jadwal);
    if (j == null || menit == null || st.terakhirPosting === tanggal) return;
    if (Date.now() < st.cobaLagi || (st.gagal[tanggal] || 0) >= 3) return;

    await kunci(async () => {
      try {
        if (st.set.mode === 'setuju') {
          if (st.draf?.disetujui && menit >= j && adaToken()) {
            const link = await posting(st.draf);
            await say(owner, `Posting terjadwal terkirim.${link ? `\n${link}` : ''}`);
          } else if (st.drafTanggal !== tanggal && menit >= Math.max(0, j - 60) && menit < j + 120) {
            st.drafTanggal = tanggal; simpan();
            st.draf = await tulisTerjadwal(); simpan();
            await kirimDraf(owner, st.draf, 'Draf untuk hari ini. ');
          }
          return;
        }
        if (!adaToken() || menit < j) return;
        if (await sudahPostingHariIni()) { st.terakhirPosting = tanggal; simpan(); return; }
        const draf = await tulisTerjadwal();
        const link = await posting(draf);
        await say(owner, `Posting harian terkirim (${draf.topik}).${link ? `\n${link}` : ''}`);
      } catch (e) {
        st.gagal = { [tanggal]: (st.gagal[tanggal] || 0) + 1 };
        st.cobaLagi = Date.now() + 10 * 60000;
        simpan();
        await say(owner, `Threads gagal (percobaan ${st.gagal[tanggal]}/3, dicoba lagi 10 menit): ${pesanGagal(e)}`).catch(() => {});
      }
    });
  }

  return { handleCommand, handleCallback, tick, tes };
};
