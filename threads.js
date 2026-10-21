// threads.js - posting teks harian otomatis ke Threads, diatur lewat Telegram.
// Memakai Threads API resmi (izin threads_basic + threads_content_publish).

const path = require('path');
const buatAnalisis = require('./analisis');
const crypto = require('crypto');

const PILAR_UMUM = [
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

// ---------- waktu tayang: agar hari/tanggal/bagian hari di tulisan cocok dengan waktu posting ----------
const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
// ts: "YYYY-MM-DD HH:MM" (WIB)
function infoWaktu(ts) {
  const [y, m, d] = ts.slice(0, 10).split('-').map(Number);
  const jam = +ts.slice(11, 13);
  const h = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const bagian = jam < 4 ? 'dini hari' : jam < 11 ? 'pagi' : jam < 15 ? 'siang' : jam < 18 ? 'sore' : 'malam';
  return {
    hari: NAMA_HARI[h], kemarin: NAMA_HARI[(h + 6) % 7], besok: NAMA_HARI[(h + 1) % 7],
    bulan: NAMA_BULAN[m - 1], bulanLalu: NAMA_BULAN[(m + 10) % 12], bulanDepan: NAMA_BULAN[m % 12],
    teks: `${NAMA_HARI[h]}, ${d} ${NAMA_BULAN[m - 1]} ${y}, sekitar pukul ${ts.slice(11, 16)} WIB (${bagian}, ${h === 0 || h === 6 ? 'akhir pekan' : 'hari kerja'})`,
  };
}
// nama hari/bulan di tulisan yang tidak cocok dengan waktu tayang (kemarin/hari ini/besok, bulan lalu/ini/depan masih wajar)
function waktuJanggal(teks, ts) {
  const w = infoWaktu(ts);
  const okHari = [w.hari, w.kemarin, w.besok];
  const okBulan = [w.bulan, w.bulanLalu, w.bulanDepan];
  const kena = new Set();
  // "Minggu" sebagai nama hari hanya bila huruf besar dan bukan "Minggu lalu/ini/depan/kemarin"
  for (const m of String(teks).matchAll(/\b(Senin|Selasa|Rabu|Kamis|Jum'?at|Sabtu|Minggu)\b(?!\s+(lalu|ini|depan|kemarin))/gi)) {
    const n = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase().replace("'", '');
    if (n === 'Minggu' && m[1][0] !== 'M') continue;
    if (!okHari.includes(n)) kena.add(m[1]);
  }
  for (const m of String(teks).matchAll(new RegExp(`\\b(${NAMA_BULAN.join('|')})\\b`, 'gi'))) {
    const n = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    if (!okBulan.includes(n)) kena.add(m[1]);
  }
  return [...kena];
}
const MAKS_JADWAL = 10;
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
// panjang: "3" (tetap) atau "2-3" (acak per postingan); null bila format salah
function rapikanPanjang(x) {
  const m = /^\s*([1-8])\s*(?:-\s*([1-8]))?\s*$/.exec(String(x ?? ''));
  if (!m) return null;
  const a = +m[1], b = m[2] ? +m[2] : a;
  if (b < a) return null;
  return a === b ? String(a) : `${a}-${b}`;
}

// ---------- cadangan token terenkripsi (disematkan di chat Telegram), satu pesan untuk semua akun ----------
const KUNCI = crypto.createHash('sha256').update('threads-cadangan:' + (process.env.TELEGRAM_BOT_TOKEN || '')).digest();
// daftar produk affiliate disimpan sebagai baris "nama | link" (nama boleh kosong)
const MAKS_AFFILIATE = 30;
const URL_RE = /https?:\/\/[^\s<>"']+/g;
function produkDari(teks) {
  const out = [];
  for (const baris of String(teks || '').split(/\n|\|\|/)) {
    const links = (baris.match(URL_RE) || []).map((u) => u.replace(/[.,;:!?)\]]+$/, ''));
    if (!links.length) continue;
    let nama = links.length > 1 ? '' : baris.replace(URL_RE, ' ')
      .replace(/dapatkan sekarang[^!.]*(shopee|tokopedia|tiktok)[^!.]*[!.]?/i, ' ')
      .replace(/\s*dengan harga\s+Rp\s?[\d.,]+(\s*-\s*Rp\s?[\d.,]+)?\.?/i, ' ')
      .replace(/^\s*(\d+[.)]\s*)?(cek\s+)?/i, '')
      .replace(/[\s|👉:\-–—•]+$/u, '').replace(/^[\s|👉:\-–—•]+/u, '')
      .replace(/\s+/g, ' ').trim().slice(0, 60);
    for (const link of links) if (!out.some((p) => p.link === link)) out.push({ nama, link });
  }
  return out;
}
const barisProduk = (list) => list.map((p) => (p.nama ? `${p.nama} | ${p.link}` : p.link)).join('\n');
// cek link affiliate: ikuti redirect sampai halaman produk (slug "Nama-Produk-i.123.456" memberi nama produk)
// UA browser: s.shopee.co.id menolak UA bot dengan 403
// status: ok | mati (halaman error / 404 / 410) | ragu (tidak bisa dipastikan: tetap dipakai)
async function cekLink(url) {
  const slug = (u) => { const m = /\/([^/?#]+)-i\.\d+\.\d+/.exec(u); return m ? decodeURIComponent(m[1]).replace(/[-_]+/g, ' ').trim() : ''; };
  const pendek = (t) => (t.length > 60 ? t.slice(0, 61).replace(/\s+\S*$/, '') : t); // dipotong di batas kata
  let u = url;
  try {
    for (let i = 0; i < 6; i++) {
      if (/error_page|page-not-found|\/error(\/|\?|$)/i.test(u)) return { status: 'mati', nama: '' };
      const s0 = slug(u);
      if (s0) return { status: 'ok', nama: pendek(s0) };
      if (/\/product\/\d+\/\d+/.test(u)) return { status: 'ok', nama: '' };
      const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' } });
      const loc = r.headers.get('location');
      if (loc) { u = new URL(loc, u).href; continue; }
      if (r.status === 404 || r.status === 410) return { status: 'mati', nama: '' };
      if (!r.ok) return { status: 'ragu', nama: '' };
      const h = (await r.text().catch(() => '')).slice(0, 200000);
      const m = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i.exec(h) || /<title>([^<]+)<\/title>/i.exec(h);
      const t = (m ? m[1] : '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
        .replace(/\s*[|-]\s*(Shopee|Tokopedia|TikTok).*$/i, '').trim();
      if (/tidak ditemukan|not found|page not found/i.test(t)) return { status: 'mati', nama: '' };
      return { status: 'ok', nama: !t || /^(shopee|tokopedia|tiktok)\b|error/i.test(t) ? '' : pendek(t) };
    }
  } catch { /* jaringan / timeout: tidak bisa dipastikan */ }
  return { status: 'ragu', nama: '' };
}

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

// Env per akun: akun 1 memakai THREADS_X, akun n memakai THREADSn_X.
// Bila kosong, beberapa kunci ikut akun 1 (app secret, mode, panjang, gaya, API base).
const IKUT_AKUN1 = ['APP_SECRET', 'MODE', 'PANJANG', 'GAYA', 'API_BASE'];
function envAkun(n, k) {
  const v = n === 1 ? process.env[`THREADS_${k}`] : process.env[`THREADS${n}_${k}`];
  if (v || n === 1 || !IKUT_AKUN1.includes(k)) return v || '';
  return process.env[`THREADS_${k}`] || '';
}
const JADWAL_BAWAAN = { 1: '07:00,12:00,19:00', 2: '08:00,13:00,20:00' };

// Bawaan khusus per akun (dipakai bila THREADSn_X kosong). Akun 2: @jampulang.05, gaya santai-lucu-slengekan.
const GAYA_SLENGEKAN = `Bahasa Indonesia gaul sehari-hari: santai, lucu, slengekan, seperti orang yang hobi menertawakan hidupnya sendiri di media sosial. Mudah dipahami siapa saja.
Lucunya datang dari kejadian dan detail yang spesifik, reaksi yang jujur, dan timing kalimat. Bukan dari lelucon template, plesetan yang dipaksakan, atau punchline yang dijelaskan ulang.
Boleh huruf kecil semua. Boleh singkatan chat yang wajar ("gak", "udah", "aja", "banget", "yg") asal tidak berlebihan. "wkwk" paling banyak sekali dan tidak di setiap postingan.
Kata ganti "aku", atau tanpa kata ganti. Boleh hiperbola yang jelas bercanda dan self-roasting, tapi tidak merendahkan orang lain, kelompok, atau fisik orang.
Penulis tinggal di Solo: sesekali boleh satu selipan rasa Solo ("og", "lho", "wae", hik, wedangan, nasi liwet), tidak wajib.
Hindari gaya yang terasa template: "POV:", "plot twist", "no debat", "bestie", "slay", "auto", "spill", dan kata gaul lain yang terdengar dipaksakan.
Dilarang memakai umpatan atau plesetan umpatan.`;
const AKUN_BAWAAN = {
  2: {
    jadwal: '07:15,09:20,11:45,13:30,15:40,17:55,20:10,22:05',
    panjang: '2-5',
    gaya: GAYA_SLENGEKAN,
    persona: 'Pekerja kantoran di Solo, niat gym tinggi tapi sering kalah sama kasur, suka ngulik AI dan gadget, dan hobi menertawakan kejadian konyol dalam hidupnya sendiri.',
    nada: [
      'receh, menertawakan kejadian konyol yang baru dialami',
      'curhat lebay yang jelas bercanda, self-roasting',
      'pengamatan iseng tentang hal sepele yang ternyata kocak',
      'cerita rencana yang gagal total, diceritakan santai',
      'komentar slengekan soal kebiasaan sehari-hari orang kebanyakan, tanpa menyindir pihak tertentu',
      'santai seperti cerita ke teman tongkrongan di hik',
    ],
  },
};

// cfg: { n, banyak(), simpanCadangan(), cadangkan(), adaCadangan() } dari pengelola akun di bawah
function buatAkun(deps, cfg) {
  const { say: sayAsli, tg, llmText, searchWeb, wib, readJson, writeJson, dataDir, redact, owner } = deps;
  const N = cfg.n;
  const env = (k) => envAkun(N, k);
  const khusus = AKUN_BAWAAN[N] || {};
  // urutan: THREADSn_X milik akun ini > bawaan khusus akun > (ikut akun 1)
  const envSendiri = (k) => (N === 1 ? process.env[`THREADS_${k}`] : process.env[`THREADS${N}_${k}`]) || '';
  const pakai = (k) => envSendiri(k) || khusus[k.toLowerCase()] || env(k);
  const NADA_AKUN = khusus.nada || NADA;
  const BASE = (env('API_BASE') || 'https://graph.threads.net/v1.0').replace(/\/+$/, '');
  const ORIGIN = new URL(BASE).origin;
  const USER = env('USER_ID') || 'me';
  const AKTIF = !process.env.THREADS_NONAKTIF; // dimatikan start.js untuk bot yang bukan bot Threads
  const ENV_TOKEN = env('ACCESS_TOKEN').trim();
  const TOKEN_TAG = ENV_TOKEN.slice(-10);
  const APP_SECRET = env('APP_SECRET').trim();
  const F = path.join(dataDir, N === 1 ? 'threads.json' : `threads-${N}.json`);
  const CB = N === 1 ? 'th:' : `th${N}:`; // awalan callback_data tombol
  const PILAR = env('PILAR') ? env('PILAR').split(/\s*;\s*/).filter(Boolean) : PILAR_UMUM;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const enc = encodeURIComponent;
  const nama = () => `Akun ${N}${st.username ? ` @${st.username}` : ''}`;
  const labelAkun = () => (cfg.banyak() ? `[${nama()}] ` : '');
  const say = (chat, text) => sayAsli(chat, labelAkun() + text);

  const bawaan = () => ({
    jadwal: rapikanJadwal(pakai('JADWAL')) || JADWAL_BAWAAN[N] || JADWAL_BAWAAN[1],
    mode: env('MODE').toLowerCase() === 'setuju' ? 'setuju' : 'otomatis',
    topik: env('TOPIK') || 'acak',
    panjang: rapikanPanjang(pakai('PANJANG')) || '2-3',
    gaya: pakai('GAYA') || GAYA_BAWAAN,
    persona: pakai('PERSONA') || PERSONA_BAWAAN,
    jeda: false,
    analisisAuto: false,
    affiliate: envSendiri('AFFILIATE').replace(/\\n/g, '\n'),
    affiliateOff: false,
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
    username: s0.username || '',
    analisis: s0.analisis || {},
    affIdx: s0.affIdx || 0, // giliran produk affiliate berikutnya
    affCek: s0.affCek || {}, // hasil cek link: { link: { s: ok|mati|ragu, t } }
  };
  st.set.panjang = rapikanPanjang(st.set.panjang) || bawaan().panjang;
  const simpan = () => writeJson(F, st);
  const daftarProduk = () => produkDari(st.set.affiliate);
  const affiliateAktif = () => !st.set.affiliateOff && daftarProduk().length > 0;
  // balasan affiliate: caption pendek dari AI (gaya akun) + link produk, produk dipakai bergiliran
  // hasil "ok" disimpan 12 jam; link mati dicek ulang tiap giliran dan pemilik diberi tahu sekali
  async function statusLink(p, no) {
    const c0 = st.affCek[p.link];
    if (c0?.s === 'ok' && Date.now() - c0.t < 12 * 3600e3) return 'ok';
    const c = await cekLink(p.link);
    if (c.status === 'mati' && c0?.s !== 'mati' && owner) {
      await say(owner, `⚠️ Link affiliate nomor ${no} (${p.nama || p.link}) sepertinya mati: tidak mengarah ke halaman produk. Link ini dilewati sampai normal lagi.\nCek di Shopee, lalu hapus bila perlu: /affiliate hapus ${no}`).catch(() => {});
    }
    st.affCek[p.link] = { s: c.status, t: Date.now() };
    for (const k of Object.keys(st.affCek)) if (!daftarProduk().some((x) => x.link === k)) delete st.affCek[k];
    simpan();
    return c.status;
  }
  async function pilihProduk(list, maju) {
    for (let k = 0; k < list.length; k++) {
      const i = ((st.affIdx || 0) + k) % list.length;
      if (await statusLink(list[i], i + 1) === 'mati') continue;
      if (maju) { st.affIdx = (i + 1) % list.length; simpan(); }
      return list[i];
    }
    return null; // semua link mati: tanpa balasan affiliate
  }
  async function captionAffiliate(hook, maju = true) {
    const list = daftarProduk();
    if (st.set.affiliateOff || !list.length) return '';
    const p = await pilihProduk(list, maju);
    if (!p) return '';
    let cap = '';
    try {
      const t = await llmText(`Kamu menulis satu balasan pendek di akhir utas Threads untuk menyisipkan link affiliate.
Persona penulis: ${st.set.persona}
Gaya bahasa:
${st.set.gaya}`, `Produk: ${p.nama || '(nama produk tidak diketahui: jangan sebut nama atau jenis produk, buat ajakan umum untuk cek link di bawah)'}
Cerita utas sebelumnya (tidak harus nyambung, boleh diabaikan): ${hook || '-'}

Tulis caption 1-2 kalimat (maksimal 200 karakter) yang santai, sesuai gaya di atas, dan bikin orang penasaran membuka link di bawahnya.
Aturan: jangan mengarang harga, diskon, promo, stok, spesifikasi, atau klaim manfaat; jangan mengaku sudah memakai atau membuktikan produknya; tanpa hashtag; jangan menulis link; tanpa tanda kutip; tanpa tanda pisah panjang.
Balas HANYA dengan teks caption.`);
      cap = rapikan(String(t || '').replace(URL_RE, '').replace(/#\S+/g, '').replace(/^["'“”\s]+|["'“”\s]+$/g, '')).slice(0, 300);
    } catch { /* LLM gagal: caption cadangan */ }
    if (!cap) cap = p.nama ? `Iseng nemu ${p.nama}, cek sendiri ya 👇` : 'Iseng nemu ini, cek sendiri ya 👇';
    return `${cap}\n${p.link}`.slice(0, 500);
  }
  function pilihPanjang() {
    const [a, b = a] = String(st.set.panjang).split('-').map(Number);
    return a + Math.floor(Math.random() * (b - a + 1));
  }

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

  // isi cadangan akun ini: token dari bot + pengaturan yang diubah lewat Telegram (beda dari Environment)
  function isiCadangan() {
    const b = bawaan();
    const ubah = {};
    for (const k of Object.keys(st.set)) if (st.set[k] !== b[k]) ubah[k] = st.set[k];
    return { token: tokenBot(), ubah, topikNanti: st.topikNanti || '', username: st.username || '' };
  }
  const cadanganKosong = (isi) => !isi.token && !Object.keys(isi.ubah).length && !isi.topikNanti;
  function terapkanCadangan(isi) {
    Object.assign(st.set, isi.ubah || {});
    st.set.panjang = rapikanPanjang(st.set.panjang) || bawaan().panjang;
    st.topikNanti = isi.topikNanti || '';
    if (isi.username) st.username = isi.username;
    const t = isi.token;
    // token dipakai lagi hanya bila Environment belum diganti dan belum kedaluwarsa
    if (t && t.dari === TOKEN_TAG && !(t.kedaluwarsa && t.kedaluwarsa < Date.now())) st.token = t;
    simpan();
  }
  const simpanCadangan = () => cfg.simpanCadangan();
  const cadangkanJikaBerubah = () => cfg.cadangkan();
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
  // nama @username untuk label pesan; dicek ulang sehari sekali
  let cekNama = 0;
  async function ambilUsername() {
    if (!adaToken() || Date.now() - cekNama < HARI) return;
    cekNama = Date.now();
    try {
      const me = await th('GET', '/me', { fields: 'id,username' });
      if (me.username && me.username !== st.username) { st.username = me.username; simpan(); }
    } catch { /* label tanpa username */ }
  }
  let siap = false;
  async function mulai() {
    await tukarTokenEnv();
    await ambilUsername();
    siap = true;
  }

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
      if (me.username) st.username = me.username;
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
    const sisa = PILAR.filter((p) => !baru.includes(p));
    const opsi = sisa.length ? sisa : PILAR;
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

  async function tulis(topikPaksa, utas, waktuTayang) {
    const tayang = waktuTayang || wib().slice(0, 16);
    const waktu = infoWaktu(tayang);
    const topik = pilihTopik(topikPaksa);
    const panjang = utas || pilihPanjang();
    let konteks = '';
    if (/AI|teknologi|tech/i.test(topik)) {
      try {
        const r = await searchWeb('berita AI dan teknologi terbaru minggu ini yang ramai dibicarakan di Indonesia');
        if (r?.ringkasan) konteks = `\n\nInfo terbaru dari pencarian web (pakai hanya yang relevan, jangan menambah fakta di luar ini):\n${r.ringkasan.slice(0, 1500)}`;
      } catch { /* tanpa pencarian, tulis secara umum */ }
    }
    const hindari = st.riwayat.slice(-10).map((r) => `- ${r.hook}`).join('\n') || '- (belum ada)';
    const nada = NADA_AKUN[Math.floor(Math.random() * NADA_AKUN.length)];
    const asn = /\bASN\b/.test(st.set.persona) && Math.random() < 0.15 ? 'Boleh menyebut bahwa penulis ASN bila memang relevan.' : 'Jangan menyebut ASN, PNS, atau instansi; cukup "kerja" atau "kantor" bila perlu.';
    const solo = Math.random() < 0.35 ? 'Boleh satu selipan rasa Solo bila pas, jangan dipaksakan.' : 'Kali ini tanpa selipan bahasa Jawa.';
    const system = `Kamu menulis postingan Threads untuk akun pribadi.
Persona penulis: ${st.set.persona}
Gaya bahasa:
${st.set.gaya}

${ATURAN}`;
    const user = `Topik: ${topik}
Waktu tayang: ${waktu.teks}.
Bila menyebut hari, tanggal, bulan, jam, atau bagian hari (pagi, siang, sore, malam, weekend, "barusan"), harus cocok dengan waktu tayang itu. Cerita boleh terjadi sebelumnya ("tadi pagi", "kemarin ${waktu.kemarin}") asal masuk akal.
Jangan menyebut tanggal tertentu, hari libur, atau momen musiman (gajian, puasa, Lebaran, Natal, tahun baru, musim hujan) kecuali memang cocok dengan waktu tayang.
Nada kali ini: ${nada}. ${solo} ${asn} Fokus hanya pada topik ini, jangan dicampur istilah atau perumpamaan dari topik lain.
Jumlah bagian: tepat ${panjang} (setiap bagian maksimal 480 karakter).${panjang > 1 ? `
Ini utas bercerita: isi "bagian" dengan TEPAT ${panjang} elemen; elemen pertama jadi postingan utama, sisanya diposting sebagai balasan bersambung.
Bagian 1 membuka cerita dengan situasi konkret dan membuat orang ingin membuka balasannya (jangan ditutup di bagian 1).
Bagian tengah melanjutkan kejadiannya: detail, percakapan pendek, atau perubahan yang terjadi. Setiap bagian lanjut dari bagian sebelumnya, tidak mengulang.
Bagian terakhir menutup cerita dengan wajar (kejadian akhir, kalimat menggantung, atau punchline), bukan ceramah atau kesimpulan.
Jangan beri nomor seperti "1/3" atau "(bersambung)".` : ''}
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
    if (panjang > 1 && bagian.length > 0 && bagian.length < panjang) { // model memberi bagian kurang: minta dipecah sekali
      try {
        const j3 = bacaJson(await llmText(system, `${user}\n\nDraf sebelumnya:\n${JSON.stringify({ hook: j.hook, bagian })}\n\nDraf itu baru ${bagian.length} bagian. Kembangkan menjadi cerita bersambung TEPAT ${panjang} bagian (array "bagian" berisi ${panjang} elemen). Balas HANYA dengan JSON yang sama formatnya.`));
        const b3 = (Array.isArray(j3.bagian) ? j3.bagian : []).map(rapikan).filter(Boolean);
        if (b3.length > bagian.length) { j = { ...j3, tag: j3.tag || j.tag }; bagian = b3; }
      } catch { /* pakai draf yang ada */ }
    }
    const janggal = waktuJanggal(bagian.join('\n'), tayang);
    if (janggal.length) { // satu kali tulis ulang dengan waktu yang benar
      try {
        const j4 = bacaJson(await llmText(system, `${user}\n\nDraf sebelumnya:\n${JSON.stringify({ hook: j.hook, bagian })}\n\nDraf itu menyebut ${janggal.map((k) => `"${k}"`).join(', ')}, padahal waktu tayangnya ${waktu.teks}. Perbaiki bagian yang menyebut waktu agar cocok (atau hapus penyebutannya), isi lain tetap sama. Balas HANYA dengan JSON yang sama formatnya.`));
        const b4 = (Array.isArray(j4.bagian) ? j4.bagian : []).map(rapikan).filter(Boolean);
        if (b4.length && waktuJanggal(b4.join('\n'), tayang).length < janggal.length) { j = { ...j4, tag: j4.tag || j.tag }; bagian = b4; }
      } catch { /* pakai draf yang ada */ }
    }
    bagian = bagian.flatMap(potong).slice(0, MAKS_UTAS);
    if (!bagian.length) throw new Error('Draf kosong. Coba /buat lagi.');
    const tag = rapikanTag(j.tag) || TAG_PILAR[topik] || '';
    const hook = String(j.hook || bagian[0].split('\n')[0]).slice(0, 120);
    const affiliate = await captionAffiliate(hook);
    return { topik, tag, nada, utas: panjang, hook, bagian, affiliate, tayang, dibuat: wib() };
  }

  // tulisan untuk jadwal: pakai topik titipan (/nanti) sekali, lalu kembali normal
  async function tulisTerjadwal(waktuTayang) {
    const titip = st.topikNanti;
    const d = await tulis(titip || null, undefined, waktuTayang);
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
    if (draf.affiliate === undefined) draf.affiliate = await captionAffiliate(draf.hook); // draf lama
    if (!affiliateAktif()) draf.affiliate = ''; // dimatikan setelah draf ditulis
    if (draf.affiliate) {
      try {
        await sleep(3000);
        const c = await th('POST', `/${USER}/threads`, { media_type: 'TEXT', text: draf.affiliate, reply_to_id: balasKe });
        await sleep(3000);
        const p = await th('POST', `/${USER}/threads_publish`, { creation_id: c.id });
        ids.push(p.id);
      } catch (e) {
        if (masalahToken(e.message)) throw e;
        draf.affiliateGagal = sensor(e.message).slice(0, 200);
      }
    }
    let link = '';
    try { link = (await th('GET', `/${pertama}`, { fields: 'permalink' })).permalink || ''; } catch { /* link opsional */ }
    st.terakhirPosting = wib().slice(0, 16);
    st.riwayat = [...st.riwayat, { tanggal: st.terakhirPosting.slice(0, 10), topik: draf.topik, tag: draf.tag || '', nada: draf.nada || '', jam: st.terakhirPosting.slice(11), hook: draf.hook, ids, link, ...(draf.affiliate && !draf.affiliateGagal ? { affiliate: true } : {}) }].slice(-30);
    st.draf = null;
    simpan();
    return link;
  }

  // preview isi yang sudah terposting, dengan tombol hapus sebagai pengaman
  async function kirimPreview(chat, draf, link, awalan = 'Terposting') {
    const n = draf.bagian.length;
    const isi = n > 1 ? draf.bagian.map((b, i) => `[${i + 1}/${n}]\n${b}`).join('\n\n') : draf.bagian[0];
    const r = st.riwayat.at(-1);
    const tombol = r?.ids?.length ? { inline_keyboard: [[{ text: '🗑 Hapus dari Threads', callback_data: `${CB}del:${r.ids[0]}` }]] } : undefined;
    const aff = draf.affiliate ? (draf.affiliateGagal ? `\n\n⚠️ Balasan affiliate gagal diposting: ${draf.affiliateGagal}` : `\n\n[balasan affiliate]\n${draf.affiliate}`) : '';
    const teks = `${awalan} (${draf.topik}${n > 1 ? `, ${n} utas` : ''}):${draf.tag ? `\nTopik Threads: ${draf.tag}` : ''}${link ? `\n${link}` : ''}\n\n${isi}${aff}`;
    if (teks.length <= 4000) return tg('sendMessage', { chat_id: chat, text: labelAkun() + teks, ...(tombol ? { reply_markup: tombol } : {}) });
    await say(chat, teks);
    if (tombol) await tg('sendMessage', { chat_id: chat, text: labelAkun() + 'Postingan di atas:', reply_markup: tombol });
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
    const aff = draf.affiliate ? `\n\n[balasan affiliate]\n${draf.affiliate}` : '';
    const tombol = { inline_keyboard: [
      [{ text: 'Posting sekarang', callback_data: `${CB}post` }, { text: `Jadwalkan ${draf.slot || slotBerikutnya()}`, callback_data: `${CB}sched` }],
      [{ text: 'Tulis ulang', callback_data: `${CB}redo` }, { text: 'Lewati', callback_data: `${CB}skip` }],
    ] };
    if ((judul + isi + aff).length <= 4000) return tg('sendMessage', { chat_id: chat, text: labelAkun() + judul + isi + aff, reply_markup: tombol });
    await say(chat, judul + isi + aff);
    await tg('sendMessage', { chat_id: chat, text: labelAkun() + `Draf di atas (${n} utas) mau diapakan?`, reply_markup: tombol });
  }


  // ---------- analisis performa (/analisis, /terapkan) ----------
  const an = buatAnalisis({
    th, st, simpan, llmText, wib, say, tg, CB, USER, labelAkun, daftarJadwal, rapikanJadwal, rapikanPanjang, sensor,
    cadangkan: () => cadangkanJikaBerubah(),
  });

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
Affiliate: ${affiliateAktif() ? `ON (${daftarProduk().length} link bergiliran, caption AI)` : daftarProduk().length ? `OFF (${daftarProduk().length} link tersimpan)` : 'OFF'}
Analisis otomatis: ${st.set.analisisAuto ? 'ON' : 'OFF'} (laporan tiap 21:00 WIB)
Terakhir posting: ${st.terakhirPosting || '-'}
Token: ${infoToken()}

Daftar topik:
${daftar}

Perintah:
/dadakan topik - draf topik dadakan sekarang (sama dengan /buat topik)
/nanti topik - titip topik untuk posting terjadwal berikutnya (/nanti batal)
/buat - draf dulu (tidak langsung posting), /posting, /jadwal 07:00,12:00,19:00
/mode otomatis (langsung posting, preview dikirim ke sini) | setuju (draf disetujui dulu)
/topik acak|nomor|teks, /panjang 3 atau 2-3 (acak), /gaya teks|reset, /persona teks|reset
/jeda, /lanjut, /token TOKEN_BARU
/affiliate - link affiliate (bulk) jadi balasan terakhir tiap postingan, caption dari AI
/analisis - views, capaian, penyebab, saran | /analisis auto on|off | /terapkan nomor|semua`;
  }

  async function handleCommand(chat, text, msgId) {
    const [c, ...rest] = text.split(/\s+/);
    const cmd = c.toLowerCase().split('@')[0];
    const arg = rest.join(' ').trim();
    const daftar = ['/threads', '/jadwal', '/mode', '/topik', '/panjang', '/gaya', '/persona', '/buat', '/dadakan', '/nanti', '/posting', '/jeda', '/lanjut', '/token', '/analisis', '/terapkan', '/affiliate'];
    if (!daftar.includes(cmd)) return false;
    if (!AKTIF) { await say(chat, 'Fitur Threads tidak aktif di bot ini.'); return true; }

    if (cmd === '/threads') await say(chat, status());
    else if (cmd === '/analisis') {
      const m = /^auto\s*(on|off)?$/i.exec(arg);
      if (m) {
        if (m[1]) { st.set.analisisAuto = m[1].toLowerCase() === 'on'; simpan(); }
        await say(chat, `Analisis otomatis: ${st.set.analisisAuto ? 'ON' : 'OFF'}.\nTiap 21:00 WIB laporan analisis dikirim ke sini. ${st.set.analisisAuto ? 'Saran yang datanya cukup kuat (jadwal, panjang utas, topik titipan) langsung diterapkan, maksimal sekali per 3 hari per jenis.' : 'Saran hanya ditampilkan; terapkan dengan tombol atau /terapkan.'}`);
      } else if (!adaToken()) await say(chat, 'Token Threads akun ini belum ada.');
      else await an.jalankan(chat);
    } else if (cmd === '/terapkan') await an.terapkan(chat, arg || '');
    else if (cmd === '/affiliate') {
      const mentah = text.replace(/^\S+[ \t]*/, '').trim(); // baris baru dipertahankan
      const [kata, ...sisaKata] = mentah.split(/\s+/);
      const sub = (kata || '').toLowerCase();
      const list = daftarProduk();
      const bantuan = `Cara pakai:
/affiliate lalu tempel link (bisa banyak sekaligus, satu link per baris; boleh diberi nama: Nama produk | link)
/affiliate ganti ... - ganti seluruh daftar
/affiliate hapus 2,5 | hapus semua
/affiliate off | on
/affiliate tes - contoh caption (tidak diposting)
/affiliate cek - cek semua link sekarang (link mati dilewati otomatis saat posting)`;
      if (!mentah) {
        const isi = list.map((p, i) => `${st.affCek[p.link]?.s === 'mati' ? '❌ ' : ''}${i + 1}. ${p.nama || '(nama tidak terbaca)'}\n${p.link}`).join('\n');
        await say(chat, `Affiliate ${affiliateAktif() ? 'ON' : 'OFF'}. ${list.length ? `${list.length} link, dipakai bergiliran; tiap postingan ditambah 1 balasan berisi caption dari AI + link.\n\n${isi}` : 'Belum ada link.'}\n\n${bantuan}`);
      } else if (sub === 'off' || sub === 'on') {
        st.set.affiliateOff = sub === 'off'; simpan();
        await say(chat, sub === 'off' ? 'Affiliate OFF (daftar link tetap tersimpan). Nyalakan lagi: /affiliate on' : list.length ? `Affiliate ON (${list.length} link).` : 'Affiliate ON, tapi belum ada link. Kirim /affiliate lalu tempel link-nya.');
      } else if (sub === 'hapus') {
        const a = sisaKata.join(' ').toLowerCase();
        const no = a === 'semua' ? list.map((_, i) => i + 1) : (a.match(/\d+/g) || []).map(Number).filter((n) => n >= 1 && n <= list.length);
        if (!no.length) await say(chat, `Contoh: /affiliate hapus 2 atau /affiliate hapus 2,5 atau /affiliate hapus semua (ada ${list.length} link).`);
        else { st.set.affiliate = barisProduk(list.filter((_, i) => !no.includes(i + 1))); st.affIdx = 0; simpan(); await say(chat, `${no.length} link dihapus. Sisa ${list.length - no.length} link.`); }
      } else if (sub === 'cek') {
        if (!list.length) { await say(chat, 'Belum ada link affiliate.'); return true; }
        await say(chat, `Mengecek ${list.length} link...`);
        const hasil = [];
        for (let i = 0; i < list.length; i += 5) hasil.push(...await Promise.all(list.slice(i, i + 5).map((p) => cekLink(p.link))));
        list.forEach((p, i) => { st.affCek[p.link] = { s: hasil[i].status, t: Date.now() }; });
        simpan();
        const ikon = { ok: '✅', mati: '❌', ragu: '❔' };
        const mati = list.map((_, i) => i + 1).filter((n) => hasil[n - 1].status === 'mati');
        await say(chat, `Hasil cek link:\n${list.map((p, i) => `${ikon[hasil[i].status]} ${i + 1}. ${p.nama || p.link}`).join('\n')}\n\n${mati.length ? `${mati.length} link mati (dilewati saat posting). Hapus: /affiliate hapus ${mati.join(',')}` : 'Semua link bisa dipakai.'}${hasil.some((h) => h.status === 'ragu') ? '\n❔ = tidak bisa dipastikan (mis. koneksi), tetap dipakai.' : ''}\nCatatan: yang dicek hanya link rusak atau produk yang dihapus, bukan stok habis.`);
      } else if (sub === 'tes') {
        if (!list.length) await say(chat, 'Belum ada link affiliate.');
        else await say(chat, `Contoh balasan affiliate (tidak diposting):\n\n${await captionAffiliate(st.riwayat.at(-1)?.hook || '', false)}`);
      } else {
        const gantiSemua = sub === 'ganti';
        const baru = produkDari(gantiSemua ? mentah.slice(kata.length) : mentah);
        if (!baru.length) { await say(chat, `Tidak ada link yang terbaca.\n\n${bantuan}`); return true; }
        const lama = gantiSemua ? [] : list;
        const tambah = baru.filter((p) => !lama.some((x) => x.link === p.link));
        let dinamai = 0; // link lama yang dikirim ulang dengan nama: namanya diperbarui
        for (const p of baru) { const x = lama.find((y) => y.link === p.link); if (x && p.nama && x.nama !== p.nama) { x.nama = p.nama; dinamai++; } }
        const muat = tambah.slice(0, Math.max(0, MAKS_AFFILIATE - lama.length));
        const lewatBatas = tambah.length - muat.length;
        if (muat.length) await say(chat, `Mengecek ${muat.length} link...`);
        for (let i = 0; i < muat.length; i += 5) {
          await Promise.all(muat.slice(i, i + 5).map(async (p) => {
            const c = await cekLink(p.link);
            p.mati = c.status === 'mati';
            if (!p.nama) p.nama = c.nama;
            st.affCek[p.link] = { s: c.status, t: Date.now() };
          }));
        }
        const rusak = muat.filter((p) => p.mati);
        muat.splice(0, muat.length, ...muat.filter((p) => !p.mati)); // link mati tidak dimasukkan
        st.set.affiliate = barisProduk([...lama, ...muat]);
        if (gantiSemua) st.affIdx = 0;
        st.set.affiliateOff = false; simpan();
        const tanpaNama = muat.filter((p) => !p.nama).length;
        await say(chat, `${gantiSemua ? 'Daftar diganti' : 'Ditambahkan'}: ${muat.length} link${baru.length - tambah.length ? `, ${baru.length - tambah.length} duplikat dilewati` : ''}${dinamai ? `, ${dinamai} nama diperbarui` : ''}${lewatBatas ? `, ${lewatBatas} tidak masuk (maksimal ${MAKS_AFFILIATE})` : ''}. Total ${lama.length + muat.length} link, affiliate ON.${rusak.length ? `\n❌ ${rusak.length} link mati, tidak dimasukkan:\n${rusak.map((p) => p.link).join('\n')}` : ''}${tanpaNama ? `\n${tanpaNama} link tanpa nama produk: caption-nya dibuat umum. Agar lebih pas, kirim ulang dengan format: Nama produk | link` : ''}\nLihat daftar: /affiliate · contoh caption: /affiliate tes`);
      }
    }
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
      const n = rapikanPanjang(arg);
      if (!n) await say(chat, `Panjang sekarang: ${st.set.panjang} bagian.\nIsi 1 sampai ${MAKS_UTAS}, atau rentang. Contoh: /panjang 3 (1 postingan + 2 balasan bersambung), /panjang 2-3 (acak 2 atau 3 tiap postingan)`);
      else { st.set.panjang = n; simpan(); await say(chat, `Setiap postingan: ${n} bagian${n.includes('-') ? ' (acak tiap postingan)' : ''}.`); }
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
    baris.push(cfg.adaCadangan() ? '✅ Cadangan token/pengaturan ter-pin di chat' : 'ℹ️ Belum ada cadangan ter-pin (dibuat otomatis saat ada token/pengaturan dari Telegram)');
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
    if (!owner || chat !== owner || !String(cq.data || '').startsWith(CB)) return;
    const aksi = cq.data.slice(CB.length);
    if (aksi.startsWith('an:')) return an.terapkan(chat, aksi.slice(3));
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
          st.draf = { ...(await tulis(st.draf.topik, st.draf.utas, st.draf.slotKey)), ...(st.draf.slotKey ? { slot: st.draf.slot, slotKey: st.draf.slotKey } : {}) }; simpan();
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
    if (N > 1 && !adaToken()) return; // akun tambahan belum dipasang
    await ambilUsername();
    await cadangkanJikaBerubah();
    await perbaruiToken().catch(() => {});
    await cekMasaToken().catch(() => {});
    if (adaToken()) an.harian(owner);
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
          st.draf = { ...(await tulisTerjadwal(key)), slot: jam, slotKey: key }; simpan();
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

  return {
    n: N, CB, nama, handleCommand, handleCallback, tick, tes, mulai, isiCadangan, terapkanCadangan, cadanganKosong, adaToken, aktif: AKTIF,
    cadanganLama: s0.cadanganId || 0,
  };
}

// ---------- pengelola akun: /akun, cadangan bersama, jadwal semua akun ----------
// Akun 2 selalu tersedia (aktif setelah ada token); akun 3-5 bila ada variabel THREADSn_*.
module.exports = function createThreads(deps) {
  const { say, tg, readJson, writeJson, dataDir, owner } = deps;
  const nomor = [1, 2, ...[3, 4, 5].filter((n) => Object.keys(process.env).some((k) => k.startsWith(`THREADS${n}_`)))];
  const FM = path.join(dataDir, 'threads-akun.json');
  const m0 = readJson(FM, {});
  const baru = !Object.keys(m0).length && !Object.keys(readJson(path.join(dataDir, 'threads.json'), {})).length;
  const mst = { aktif: m0.aktif || 1, cadanganId: m0.cadanganId || 0 };
  const simpanM = () => writeJson(FM, mst);
  let siap = false, terakhirDicadangkan = '';

  const cfg = (n) => ({
    n,
    banyak: () => akun.filter((a) => a.adaToken()).length > 1 || mst.aktif !== 1,
    simpanCadangan: () => simpanCadangan().catch(() => {}),
    cadangkan: () => cadangkanJikaBerubah(),
    adaCadangan: () => Boolean(mst.cadanganId),
  });
  const akun = nomor.map((n) => buatAkun(deps, cfg(n)));
  const cari = (n) => akun.find((a) => a.n === +n);
  if (!cari(mst.aktif)) mst.aktif = 1;
  if (!mst.cadanganId && akun[0].cadanganLama) mst.cadanganId = akun[0].cadanganLama; // dari versi satu akun
  const aktif = () => cari(mst.aktif);

  function isiCadangan() {
    const isi = { versi: 3, aktif: mst.aktif, akun: {} };
    for (const a of akun) { const c = a.isiCadangan(); if (!a.cadanganKosong(c) || c.username) isi.akun[a.n] = c; }
    return isi;
  }
  async function simpanCadangan() {
    if (!owner) return;
    const isi = isiCadangan();
    const kosong = Object.values(isi.akun).every((c) => !c.token && !Object.keys(c.ubah).length && !c.topikNanti);
    if (kosong && mst.aktif === 1 && !mst.cadanganId) return;
    const kepala = 'Cadangan token dan pengaturan Threads (terenkripsi). Jangan dihapus atau di-unpin; bot memakainya lagi setelah deploy ulang.\n';
    let teks = kepala + enkripsi(isi);
    if (teks.length > 4000) { // gaya/persona panjang: lewati agar muat satu pesan Telegram
      for (const c of Object.values(isi.akun)) { delete c.ubah.gaya; delete c.ubah.persona; }
      teks = kepala + enkripsi(isi);
    }
    if (teks.length > 4000) { // daftar affiliate panjang: simpan link saja tanpa nama, lalu pangkas dari belakang
      for (const c of Object.values(isi.akun)) if (c.ubah.affiliate) c.ubah.affiliate = produkDari(c.ubah.affiliate).map((p) => p.link).join('\n');
      teks = kepala + enkripsi(isi);
      for (const c of Object.values(isi.akun)) {
        while (teks.length > 4000 && c.ubah.affiliate) { c.ubah.affiliate = c.ubah.affiliate.split('\n').slice(0, -1).join('\n'); teks = kepala + enkripsi(isi); }
      }
    }
    terakhirDicadangkan = JSON.stringify(isiCadangan());
    if (mst.cadanganId) { // perbarui pesan yang sudah di-pin, tanpa pesan baru
      const e = await tg('editMessageText', { chat_id: owner, message_id: mst.cadanganId, text: teks });
      if (e?.ok || /not modified/i.test(e?.description || '')) return;
    }
    const r = await tg('sendMessage', { chat_id: owner, disable_notification: true, text: teks });
    if (!r?.ok) return;
    await tg('pinChatMessage', { chat_id: owner, message_id: r.result.message_id, disable_notification: true }).catch(() => {});
    if (mst.cadanganId && mst.cadanganId !== r.result.message_id) {
      tg('deleteMessage', { chat_id: owner, message_id: mst.cadanganId }).catch(() => {});
    }
    mst.cadanganId = r.result.message_id;
    simpanM();
  }
  async function cadangkanJikaBerubah() {
    if (siap && JSON.stringify(isiCadangan()) !== terakhirDicadangkan) await simpanCadangan().catch(() => {});
  }
  async function pulihkanCadangan() {
    if (!owner || !baru) return; // data/ masih ada: bukan deploy ulang
    try {
      const r = await tg('getChat', { chat_id: owner });
      const pm = r?.result?.pinned_message;
      const m = /THB1:[A-Za-z0-9+/=]+/.exec(pm?.text || '');
      if (!m) return;
      const c = dekripsi(m[0]);
      mst.cadanganId = pm.message_id;
      if (c.versi === 3) {
        for (const [n, isi] of Object.entries(c.akun || {})) cari(n)?.terapkanCadangan(isi);
        if (cari(c.aktif)) mst.aktif = +c.aktif;
      } else akun[0].terapkanCadangan(c.versi === 2 ? c : { token: c, ubah: {} }); // cadangan versi satu akun
      simpanM();
      console.log('Token dan pengaturan Threads dipulihkan dari cadangan Telegram.');
    } catch (e) {
      console.error('Gagal memulihkan cadangan token:', String(e.message).slice(0, 200));
    }
  }
  pulihkanCadangan()
    .then(() => Promise.all(akun.map((a) => a.mulai().catch(() => {}))))
    .finally(() => { terakhirDicadangkan = JSON.stringify(isiCadangan()); siap = true; });

  function tombolAkun() {
    return { inline_keyboard: [akun.map((a) => ({ text: `${a.n === mst.aktif ? '✅ ' : ''}${a.nama()}`, callback_data: `akun:${a.n}` }))] };
  }
  async function pilihAkun(chat, n) {
    const a = cari(n);
    if (!a) return say(chat, `Akun ${n} tidak ada. Pilihan: ${akun.map((x) => x.n).join(', ')}.`);
    mst.aktif = a.n; simpanM();
    await say(chat, `Akun aktif: ${a.nama()}.${a.adaToken() ? '' : '\nToken akun ini belum ada. Kirim /token TOKEN_AKUN_INI (sekarang, selagi akun ini aktif).'}\nSemua perintah Threads (/threads, /dadakan, /buat, /jadwal, /persona, /token, ...) dan Mode Threads sekarang berlaku untuk akun ini. Posting terjadwal tetap jalan untuk semua akun.`);
    await cadangkanJikaBerubah();
  }

  async function handleCommand(chat, text, msgId) {
    const [c, ...rest] = text.split(/\s+/);
    const cmd = c.toLowerCase().split('@')[0];
    const arg = rest.join(' ').trim();
    if (cmd === '/akun') {
      if (!akun[0].aktif) { await say(chat, 'Fitur Threads tidak aktif di bot ini.'); return true; }
      if (arg) await pilihAkun(chat, parseInt(arg, 10));
      else {
        const daftar = akun.map((a) => `${a.n === mst.aktif ? '✅' : '▫️'} ${a.nama()}${a.adaToken() ? '' : ' (token belum ada)'}`).join('\n');
        await tg('sendMessage', { chat_id: chat, text: `Akun Threads:\n${daftar}\n\nPilih akun yang mau diatur (atau ketik /akun 2):`, reply_markup: tombolAkun() });
      }
      return true;
    }
    const ok = await aktif().handleCommand(chat, text, msgId);
    if (ok && cmd === '/threads' && akun[0].aktif) await tg('sendMessage', { chat_id: chat, text: `Sedang mengatur ${aktif().nama()}. Ganti akun:`, reply_markup: tombolAkun() });
    return ok;
  }

  async function handleCallback(cq) {
    const data = String(cq.data || '');
    const chat = String(cq.message?.chat?.id || '');
    if (data.startsWith('akun:')) {
      tg('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      if (owner && chat === owner) await pilihAkun(chat, parseInt(data.slice(5), 10));
      return;
    }
    const a = akun.find((x) => data.startsWith(x.CB)) || akun[0];
    return a.handleCallback(cq);
  }

  async function tick() {
    if (!siap) return;
    for (const a of akun) await a.tick().catch((e) => console.error(`threads tick akun ${a.n}:`, e.message));
  }

  async function tes(lengkap) {
    const baris = [];
    let draf = null;
    for (const a of akun) {
      if (a.n !== 1 && !a.adaToken()) { baris.push(`➖ ${a.nama()}: token belum ada`); continue; }
      const r = await a.tes(lengkap && a.n === mst.aktif);
      baris.push(...(akun.length > 1 ? r.baris.map((b) => `${b} [${a.nama()}]`) : r.baris));
      draf = draf || r.draf;
    }
    return { baris, draf };
  }

  return { handleCommand, handleCallback, tick, tes, aktif: akun[0].aktif };
};
