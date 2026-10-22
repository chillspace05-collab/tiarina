// horor.js - niche cerita horor/menegangkan: bahan cerita dari Reddit (RSS publik), konteks hari ini dari Google News (RSS),
// dan filter konten aman yang dipakai semua postingan (menyakiti diri, kekerasan grafis, seksual).

const UA = 'Mozilla/5.0 (compatible; tiarina-bot/1.0; +https://github.com/chillspace05-collab/tiarina)';
const REDDIT_BASE = (process.env.REDDIT_BASE || 'https://www.reddit.com').replace(/\/+$/, '');
// suasana hari ini: berita film/cerita horor yang lagi ramai + cuaca (Google News RSS); [url, jumlah judul]
const GN = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=id&gl=ID&ceid=ID:id`;
const BERITA = process.env.BERITA_RSS ? [[process.env.BERITA_RSS, 12]] : [[GN('"film horor" OR mistis OR angker when:3d'), 7], [GN('cuaca hari ini when:1d'), 3]];
// subreddit cerita seram/menegangkan yang ditulis sebagai pengalaman nyata (nosleep = fiksi, ditandai)
const SUB_HOROR = ['LetsNotMeet', 'Thetruthishere', 'Glitch_in_the_Matrix', 'creepyencounters', 'Paranormal', 'nosleep'];
const SUB_FIKSI = ['nosleep'];
const JAM = 36e5;

// bahan cerita yang tidak dipakai: menyakiti diri, seksual, anak/hewan disakiti, sadis, narkoba, serial/lanjutan
const TOLAK_SUMBER = new RegExp([
  'suicid', 'kill(ing|ed)? (my|him|her|them)sel', 'self[- ]?harm', 'cutting (my|him|her)sel', 'slit (my|his|her) wrist', 'overdos',
  'hang(ed|ing)? (my|him|her|them)sel', 'end(ed|ing)? (my|his|her|their) (own )?life', 'want(ed)? to die',
  'rap(e|ed|ist)\\b', 'molest', 'sexual', '\\bsex\\b', 'naked', 'nude', 'grop(e|ed|ing)', 'porn', 'pedo', 'incest', 'groom(ed|ing)',
  'child abuse', 'abus(e|ed|ive)', 'tortur', 'dismember', 'mutilat', 'gore', 'decapitat', 'animal cruelty', 'dead (dog|cat|puppy|kitten)',
  'cocaine', 'heroin', '\\bmeth\\b', 'school shooting', 'mass shooting', 'terroris', 'nsfw', 'trigger warning', '\\btw:',
].join('|'), 'i');
const JUDUL_LANJUTAN = /\b(part|pt\.?|chapter|bagian)\s*([2-9]|\d{2})\b|\bupdate\b|\bseries\b|\bfinal\b/i;

// rambu keluaran (bahasa Indonesia + Inggris). Dipakai untuk SEMUA postingan, bukan hanya niche horor.
const RAMBU = [
  ['menyakiti diri', /bunuh\s*diri|gantung\s*diri|terjun\s*bebas|(mengakhiri|akhiri|akhirin)\s*(hidup|nyawa)|menyakiti\s*diri|melukai\s*diri|nyakitin\s*diri|self[- ]?harm|suicid|(sayat|iris|potong)\s*(nadi|tangan|lengan)|overdosis|\bOD\b|minum\s*(racun|obat\s*nyamuk|cairan\s*pembersih)|lompat\s*dari\s*(gedung|jembatan|lantai|atap)|(pengen|ingin|pingin|pengin|mau|kepengen)\s*(mati|mati\s*aja|ngilang\s*(selamanya|dari\s*dunia))|mending\s*mati|(udah|dah|pengen|mau)\s*mati\s*aja|capek\s*hidup|cape\s*hidup|lelah\s*hidup|(gak|nggak|ga|tidak|tak)\s*(mau|ingin|pengen)\s*hidup\s*lagi|hidup\s*(gak|nggak|ga|tidak)\s*ada\s*artinya/i],
  ['kekerasan grafis', /mutilasi|dimutilasi|dipotong[- ]potong|isi\s*perut(nya)?\s*(keluar|terburai)|terburai|darah\s*(muncrat|menyembur)|kepala(nya)?\s*(putus|terpenggal)|dipenggal|menguliti|dikuliti|disiksa\s*sampai|penyiksaan/i],
  ['konten seksual', /perkosa|pemerkosaan|pelecehan\s*seksual|dilecehkan|telanjang|bugil|cabul|pencabulan|seksual/i],
  ['tantangan berbahaya', /(coba|cobain|silakan\s*coba|lakukan)\s*(ritual|pemanggilan|manggil)|cara\s*(memanggil|manggil)\s*(arwah|setan|jin|hantu)/i],
];
function cekAman(teks) {
  const t = String(teks || '');
  return RAMBU.filter(([, re]) => re.test(t)).map(([nama, re]) => `${nama} ("${t.match(re)[0]}")`);
}

const htmlDecode = (s) => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const teksPolos = (html) => htmlDecode(htmlDecode(html)
  .replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/\[link\]|\[comments\]|submitted by\s+\/u\/\S+/gi, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

async function ambilTeks(url, ms = 15000) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/atom+xml, application/rss+xml, text/xml, */*' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function bacaAtom(xml, sub) {
  const out = [];
  for (const m of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const id = (/<id>([^<]+)<\/id>/.exec(e) || [])[1] || '';
    const judul = htmlDecode((/<title>([\s\S]*?)<\/title>/.exec(e) || [])[1] || '').trim();
    const link = htmlDecode((/<link[^>]*href="([^"]+)"/.exec(e) || [])[1] || '');
    const isi = teksPolos((/<content[^>]*>([\s\S]*?)<\/content>/.exec(e) || [])[1] || '');
    if (id && judul && isi) out.push({ id, sub, judul, link, isi, fiksi: SUB_FIKSI.includes(sub) });
  }
  return out;
}
const layak = (c) => c.isi.length >= 700 && c.isi.length <= 15000 && !JUDUL_LANJUTAN.test(c.judul) && !TOLAK_SUMBER.test(`${c.judul}\n${c.isi}`);

// cache bersama semua akun (satu proses): diisi ulang tiap 12 jam, maksimal 3 subreddit per isi ulang (hindari 429)
const cache = { pool: [], t: 0, gagal: 0, berita: [], tBerita: 0 };
const acak = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
async function isiPool(subPilih) {
  const subs = subPilih ? [subPilih] : acak(SUB_HOROR).slice(0, 3);
  let berhasil = 0;
  for (const [i, sub] of subs.entries()) {
    if (i) await new Promise((r) => setTimeout(r, 1500));
    try {
      const baru = bacaAtom(await ambilTeks(`${REDDIT_BASE}/r/${sub}/top/.rss?t=week&limit=25`), sub).filter(layak);
      cache.pool = [...cache.pool.filter((c) => !baru.some((b) => b.id === c.id)), ...baru].slice(-150);
      berhasil++;
    } catch { /* subreddit ini gagal (diblok/429), lanjut yang lain */ }
  }
  if (berhasil) { cache.t = Date.now(); cache.gagal = 0; } else cache.gagal = Date.now();
}

// pilih satu cerita yang belum dipakai akun ini; null bila Reddit tidak bisa diakses
async function ambilCerita(dipakai = [], sub = '') {
  const segar = Date.now() - cache.t < 12 * JAM;
  const bolehCoba = Date.now() - cache.gagal > 30 * 60000;
  const belum = (c) => !dipakai.includes(c.id) && (!sub || c.sub.toLowerCase() === sub.toLowerCase());
  if (bolehCoba && (!segar || !cache.pool.some(belum))) await isiPool(sub && SUB_HOROR.find((s) => s.toLowerCase() === sub.toLowerCase()));
  const opsi = cache.pool.filter(belum);
  const lain = opsi.length ? opsi : cache.pool.filter((c) => !dipakai.includes(c.id)); // sub yang diminta habis: pakai sub lain
  if (!lain.length) return null;
  // utamakan cerita nyata dan yang tidak terlalu panjang
  const skor = (c) => (c.fiksi ? 0 : 2) + (c.isi.length < 6000 ? 1 : 0) + Math.random() * 2;
  return lain.sort((a, b) => skor(b) - skor(a))[0];
}

// judul berita hari ini (untuk mengaitkan suasana pembuka), di-cache 3 jam
async function beritaHariIni() {
  if (Date.now() - cache.tBerita < 3 * JAM && cache.berita.length) return cache.berita;
  const hasil = [];
  for (const [url, n] of BERITA) {
    try {
      const xml = await ambilTeks(url, 10000);
      hasil.push(...[...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)]
        .map((m) => htmlDecode(m[1]).replace(/<!\[CDATA\[|\]\]>/g, '').replace(/\s+-\s+[^-]+$/, '').trim())
        .filter(Boolean).slice(0, n));
    } catch { /* lewati feed ini */ }
  }
  if (hasil.length) { cache.berita = hasil; cache.tBerita = Date.now(); } else cache.tBerita = Date.now() - 2 * JAM; // gagal: coba lagi sekitar 1 jam lagi
  return cache.berita;
}

module.exports = { ambilCerita, beritaHariIni, cekAman, SUB_HOROR, _cache: cache, _bacaAtom: bacaAtom, _layak: layak };
