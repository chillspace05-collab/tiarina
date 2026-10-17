// analisis.js - analisis performa Threads satu akun (/analisis): angka, capaian, penyebab, dan saran.
// Data dari Threads Insights API (izin threads_manage_insights). Saran yang bisa diterapkan hanya
// mengubah pengaturan yang memang dipakai bot (jadwal, panjang utas, topik titipan), lewat jalur
// yang sama dengan perintah Telegram, jadi ikut tersimpan di cadangan ter-pin.

const HARI = 864e5;
const JAM = 36e5;
const TANGGA_FOLLOWERS = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 50000, 100000];
const TANGGA_VIEWS = [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000]; // views 28 hari
const JEDA_OTOMATIS = 3 * HARI; // jenis saran yang sama paling sering diterapkan otomatis tiap 3 hari
const BATAS_SARAN = 3 * HARI;   // saran lebih lama dari ini harus dianalisis ulang
const MAKS_POST = 40;
const METRIK = ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'];

const angka = (x) => Math.round(x || 0).toLocaleString('id-ID');
const persen = (a, b) => (b ? `${a >= b ? '+' : ''}${Math.round((100 * (a - b)) / b)}%` : a ? 'baru' : '0%');
const msTs = (ts) => Date.parse(String(ts).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
const potong = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

module.exports = function buatAnalisis(d) {
  const { th, st, simpan, llmText, wib, say, tg, CB, USER, labelAkun, daftarJadwal, rapikanJadwal, rapikanPanjang, cadangkan, sensor } = d;
  st.analisis = st.analisis || {};
  const A = st.analisis;
  const izinKurang = (m) => /threads_manage_insights|permission|\(#10\)|\(#200\)|not authorized|scope/i.test(m);

  // ---------- ambil data ----------
  async function daftarPost() {
    const since = String(Math.floor((Date.now() - 28 * HARI) / 1000));
    const ambil = async (fields) => {
      const out = [];
      let after = '';
      for (let i = 0; i < 2 && out.length < MAKS_POST; i++) {
        const j = await th('GET', `/${USER}/threads`, { fields, limit: '50', since, ...(after ? { after } : {}) });
        out.push(...(j.data || []));
        after = j.paging?.cursors?.after;
        if (!after || !j.paging?.next) break;
      }
      return out;
    };
    let posts;
    try { posts = await ambil('id,timestamp,text,permalink,is_reply,topic_tag'); } catch { posts = await ambil('id,timestamp,text,permalink,is_reply'); }
    return posts.filter((p) => !p.is_reply && p.timestamp).slice(0, MAKS_POST);
  }

  async function ambilData() {
    const posts = await daftarPost();
    let izin = true, galat = '';
    for (const p of posts) {
      p.ms = msTs(p.timestamp);
      if (!izin) continue;
      try {
        const j = await th('GET', `/${p.id}/insights`, { metric: METRIK.join(',') });
        p.m = {};
        for (const x of j.data || []) p.m[x.name] = x.values?.[0]?.value ?? x.total_value?.value ?? 0;
      } catch (e) {
        if (izinKurang(e.message)) { izin = false; galat = sensor(e.message); } // tanpa izin: berhenti mencoba
      }
      const r = st.riwayat.find((x) => x.ids?.[0] === p.id);
      p.topik = r?.topik || p.topic_tag || '-';
      p.tag = p.topic_tag || r?.tag || '';
      p.nada = r?.nada || '';
      p.bagian = r?.ids?.length || 0;
    }
    // jumlah bagian utas untuk postingan yang tidak ada di riwayat bot (mis. setelah deploy ulang)
    for (const p of posts.filter((x) => !x.bagian).slice(0, 30)) {
      try {
        const c = await th('GET', `/${p.id}/conversation`, { fields: 'id,username', limit: '25' });
        p.bagian = 1 + (c.data || []).filter((x) => !st.username || x.username === st.username).length;
      } catch { p.bagian = 1; }
    }
    // metrik replies ikut menghitung bagian utas sendiri (balasan berantai): dikurangi
    for (const p of posts) if (p.m) p.m.replies = Math.max(0, (p.m.replies || 0) - Math.max(0, (p.bagian || 1) - 1));
    const user = {};
    if (izin) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const j = await th('GET', `/${USER}/threads_insights`, { metric: 'followers_count,views', since: String(now - 14 * 86400), until: String(now) });
        for (const x of j.data || []) {
          if (x.name === 'followers_count') user.followers = x.total_value?.value ?? x.values?.at(-1)?.value;
          if (x.name === 'views') {
            const v = (x.values || []).map((y) => y.value || 0);
            user.profil7 = v.slice(-7).reduce((a, b) => a + b, 0);
            user.profilPrev7 = v.slice(-14, -7).reduce((a, b) => a + b, 0);
          }
        }
      } catch (e) { if (izinKurang(e.message)) { izin = false; galat = sensor(e.message); } }
    }
    return { posts, user, izin, galat };
  }

  // ---------- hitung ----------
  const interaksi = (m) => (m ? (m.likes || 0) + (m.replies || 0) + (m.reposts || 0) + (m.quotes || 0) + (m.shares || 0) : 0);
  const jamWib = (ms) => +wib(ms).slice(11, 13);

  function grup(posts, kunci) {
    const g = new Map();
    for (const p of posts) {
      const k = kunci(p);
      if (k === '' || k == null) continue;
      const x = g.get(k) || { k, n: 0, views: 0, inter: 0 };
      x.n++; x.views += p.m.views || 0; x.inter += interaksi(p.m);
      g.set(k, x);
    }
    return [...g.values()].map((x) => ({ ...x, rata: x.views / x.n, er: x.views ? x.inter / x.views : 0 })).sort((a, b) => b.rata - a.rata);
  }
  // terbaik vs terburuk bila bedanya jelas (>= 1.5x) dan tiap kelompok minimal `min` postingan
  function beda(gs, min = 2) {
    const ok = gs.filter((x) => x.n >= min);
    if (ok.length < 2) return null;
    const [best, worst] = [ok[0], ok.at(-1)];
    if (best.rata < 1.5 * Math.max(worst.rata, 1) || best.rata - worst.rata < 5) return null;
    return { best, worst, aman: best.n >= 3 && worst.n >= 3 };
  }

  function hitung(data) {
    const now = Date.now();
    const ada = data.posts.filter((p) => p.m);
    const dinilai = ada.filter((p) => now - p.ms >= 24 * JAM); // postingan < 24 jam belum dinilai
    const sum = (arr, f) => arr.reduce((a, p) => a + f(p), 0);
    const p7 = ada.filter((p) => now - p.ms < 7 * HARI), pPrev = ada.filter((p) => now - p.ms >= 7 * HARI && now - p.ms < 14 * HARI);
    const tot = {};
    for (const k of METRIK) tot[k] = sum(ada, (p) => p.m[k] || 0);
    const h = {
      jumlah: data.posts.length, dinilai, ada, tot,
      views7: sum(p7, (p) => p.m.views || 0), n7: p7.length,
      viewsPrev: sum(pPrev, (p) => p.m.views || 0), nPrev: pPrev.length,
      rata: dinilai.length ? sum(dinilai, (p) => p.m.views || 0) / dinilai.length : 0,
      er: tot.views ? sum(ada, (p) => interaksi(p.m)) / tot.views : 0,
      perHari: data.posts.length ? data.posts.length / Math.max(1, (now - Math.min(...data.posts.map((p) => p.ms))) / HARI) : 0,
      jam: grup(dinilai, (p) => jamWib(p.ms)),
      bagian: grup(dinilai, (p) => p.bagian || ''),
      topik: grup(dinilai, (p) => p.topik !== '-' ? p.topik : ''),
      tag: grup(dinilai, (p) => p.tag),
    };
    const urut = [...dinilai].sort((a, b) => (b.m.views || 0) - (a.m.views || 0));
    h.top = urut.slice(0, 3);
    h.bawah = urut.length > 3 ? urut.slice(-3).reverse() : [];
    return h;
  }

  // ---------- penyebab + saran (aturan) ----------
  function aturan(h) {
    const penyebab = [], saran = [];
    if (h.dinilai.length < 4) {
      penyebab.push(`Baru ${h.dinilai.length} postingan yang berumur >24 jam, belum cukup untuk menyimpulkan pola. Analisis makin akurat setelah ±10 postingan.`);
      return { penyebab, saran };
    }
    const bj = beda(h.jam);
    if (bj) {
      penyebab.push(`Jam posting berpengaruh: jam ${bj.best.k}:00 rata-rata ${angka(bj.best.rata)} views (${bj.best.n} post), jam ${bj.worst.k}:00 hanya ${angka(bj.worst.rata)} (${bj.worst.n} post).`);
      const slot = daftarJadwal();
      const pakaiJam = new Set(slot.map((s) => +s.slice(0, 2)));
      let ganti = 0;
      const terpakai = new Set(slot);
      const baru = slot.map((s) => {
        if (ganti >= 2 || +s.slice(0, 2) !== bj.worst.k) return s;
        const tujuan = h.jam.find((g) => g.n >= 2 && g.rata > h.rata && !pakaiJam.has(g.k)) || bj.best;
        const hh = String(tujuan.k).padStart(2, '0');
        const jam = [s.slice(3), '30', '45', '15', '00'].map((mm) => `${hh}:${mm}`).find((x) => !terpakai.has(x));
        if (!jam) return s;
        ganti++;
        pakaiJam.add(tujuan.k);
        terpakai.add(jam);
        return jam;
      });
      const nilai = rapikanJadwal(baru.join(','));
      if (nilai && nilai !== rapikanJadwal(slot.join(','))) {
        // otomatis hanya bila jadwal tetap tersebar di minimal 2 jam berbeda
        const ragam = new Set(nilai.split(',').map((x) => x.slice(0, 2))).size >= Math.min(2, slot.length);
        saran.push({ jenis: 'jadwal', nilai, aman: bj.aman && ragam, teks: `Pindahkan slot jam ${bj.worst.k}:xx → jadwal baru ${nilai.split(',').join(', ')} WIB` });
      }
    }
    const bb = beda(h.bagian);
    if (bb) {
      penyebab.push(`Panjang utas berpengaruh: ${bb.best.k} bagian rata-rata ${angka(bb.best.rata)} views, ${bb.worst.k} bagian ${angka(bb.worst.rata)}.`);
      const [a, b = a] = String(rapikanPanjang(st.set.panjang) || '1').split('-').map(Number);
      const p = +bb.best.k, w = +bb.worst.k;
      // ubah bila yang terbaik di luar rentang sekarang, atau yang terburuk masih termasuk rentang
      if (p < a || p > b || (w >= a && w <= b && a !== b)) {
        const dekat = h.bagian.find((g) => g.n >= 2 && Math.abs(+g.k - p) === 1 && g.rata > h.rata && +g.k !== w);
        const nilai = rapikanPanjang(dekat ? `${Math.min(p, +dekat.k)}-${Math.max(p, +dekat.k)}` : String(p));
        if (nilai && nilai !== rapikanPanjang(st.set.panjang)) saran.push({ jenis: 'panjang', nilai, aman: bb.aman, teks: `Ubah panjang utas ${st.set.panjang} → ${nilai} bagian` });
      }
    }
    const bt = beda(h.topik);
    if (bt) {
      penyebab.push(`Topik "${potong(bt.best.k, 45)}" paling kuat (${angka(bt.best.rata)} views/post); "${potong(bt.worst.k, 45)}" paling lemah (${angka(bt.worst.rata)}).`);
      if (st.topikNanti !== bt.best.k) saran.push({ jenis: 'nanti', nilai: bt.best.k, aman: true, teks: `Titip topik terkuat "${potong(bt.best.k, 45)}" untuk posting terjadwal berikutnya (sekali)` });
    }
    if (h.views7 && h.viewsPrev && h.views7 < 0.7 * h.viewsPrev && h.n7 >= h.nPrev) {
      penyebab.push(`Views 7 hari turun ${persen(h.views7, h.viewsPrev)} padahal jumlah postingan sama/lebih banyak: kemungkinan jenuh atau hook kurang kuat.`);
    }
    if (h.tot.views >= 200 && h.er < 0.01) {
      penyebab.push(`Engagement rate rendah (${(h.er * 100).toFixed(1)}%): orang melihat tapi jarang membalas/menyukai.`);
      saran.push({ jenis: 'manual', teks: 'Akhiri sebagian postingan dengan detail yang memancing cerita balik (bukan pertanyaan template), dan balas komentar yang masuk dalam 1 jam pertama.' });
    }
    if (h.rata < 20) {
      penyebab.push(`Rata-rata baru ${angka(h.rata)} views/post: distribusi masih kecil (akun baru/follower sedikit), wajar di fase awal.`);
      saran.push({ jenis: 'manual', teks: 'Ikut membalas postingan orang lain di topik yang sama (mis. komunitas tag yang dipakai) beberapa menit per hari; algoritma Threads banyak mendorong akun yang aktif berinteraksi.' });
    }
    if (h.perHari >= 6 && h.rata < 30) {
      saran.push({ jenis: 'manual', teks: `Sekarang ±${h.perHari.toFixed(1)} post/hari dengan views kecil. Pertimbangkan mengurangi jumlah slot (/jadwal) dan fokus pada kualitas hook.` });
    }
    return { penyebab, saran };
  }

  // satu panggilan LLM: penjelasan penyebab + saran manual tambahan; gagal = cukup hasil aturan
  async function mintaLlm(h) {
    const ringkas = (gs) => gs.slice(0, 6).map((g) => ({ kelompok: g.k, post: g.n, rata_views: Math.round(g.rata), er: +(g.er * 100).toFixed(1) }));
    const data = {
      postingan_dinilai: h.dinilai.length, rata_views: Math.round(h.rata), er_persen: +(h.er * 100).toFixed(2),
      views_7h: h.views7, views_7h_sebelumnya: h.viewsPrev, post_per_hari: +h.perHari.toFixed(1),
      per_jam: ringkas(h.jam), per_bagian: ringkas(h.bagian), per_topik: ringkas(h.topik),
      terbaik: h.top.map((p) => ({ hook: potong(p.text, 90), views: p.m.views, balasan: p.m.replies, bagian: p.bagian })),
      terburuk: h.bawah.map((p) => ({ hook: potong(p.text, 90), views: p.m.views, balasan: p.m.replies, bagian: p.bagian })),
      pengaturan: { jadwal: daftarJadwal().join(','), panjang: st.set.panjang, gaya: potong(st.set.gaya, 200) },
    };
    const sys = 'Kamu analis pertumbuhan akun Threads berbahasa Indonesia. Hanya simpulkan yang didukung data; bila sampel kecil, katakan begitu. Balas JSON saja.';
    const user = `Data performa akun (views = tayangan postingan, er = engagement rate %):\n${JSON.stringify(data)}\n\nBandingkan hook terbaik vs terburuk (gaya pembuka, kekonkretan, emosi) dan pola lain.\nBalas HANYA JSON: {"penyebab":["maks 3 kalimat singkat"],"saran":["maks 3 saran praktis yang bisa dilakukan pemilik akun"]}`;
    const t = await llmText(sys, user);
    const s = String(t).replace(/```json|```/g, '');
    const j = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
    return { penyebab: (j.penyebab || []).slice(0, 3).map(String), saran: (j.saran || []).slice(0, 3).map(String) };
  }

  // ---------- laporan ----------
  function tangga(n, tg) {
    const next = tg.find((x) => x > n);
    if (!next) return `${angka(n)} (semua target tercapai 🎉)`;
    const prev = [...tg].reverse().find((x) => x <= n) || 0;
    return `${angka(n)} → target ${angka(next)} (${Math.floor((100 * n) / next)}%${prev ? `, sudah lewat ${angka(prev)}` : ''})`;
  }
  const barisPost = (p, i) => `${i + 1}. ${angka(p.m.views)} views · ${interaksi(p.m)} interaksi · ${p.bagian || '?'} bag · ${wib(p.ms).slice(5, 16).replace(' ', ' jam ')}\n   "${potong(p.text, 70)}"${p.permalink ? `\n   ${p.permalink}` : ''}`;

  function catatFollowers(n) {
    if (n == null) return null;
    const hariIni = wib().slice(0, 10);
    A.followers = (A.followers || []).filter((x) => x.t !== hariIni).concat({ t: hariIni, n }).slice(-30);
    const lalu = A.followers.find((x) => Date.parse(x.t) <= Date.now() - 7 * HARI) || (A.followers.length > 1 ? A.followers[0] : null);
    return lalu ? { delta: n - lalu.n, sejak: lalu.t } : null;
  }

  function laporan(data, h, sebab, saran, catatanOtomatis) {
    const u = data.user;
    const ff = catatFollowers(u.followers);
    const L = [`📈 Analisis Threads (${wib()} WIB)`];
    if (!data.izin) {
      L.push('', `⚠️ Token belum punya izin threads_manage_insights, jadi angka views/likes tidak bisa dibaca.\nCara: di dashboard Meta (aplikasi Threads > Use cases > Access the Threads API) centang threads_manage_insights, buat token baru, lalu kirim /token TOKEN_BARU.${data.galat ? `\nDetail: ${potong(data.galat, 150)}` : ''}`);
      L.push('', `Yang terbaca: ${h.jumlah} postingan utama dalam 28 hari (±${h.perHari.toFixed(1)}/hari).`);
      return L.join('\n');
    }
    L.push('', '📊 Angka (postingan 28 hari terakhir)');
    L.push(`Postingan: ${h.jumlah} (±${h.perHari.toFixed(1)}/hari), dinilai (>24 jam): ${h.dinilai.length}`);
    L.push(`Views: ${angka(h.tot.views)} total · rata-rata ${angka(h.rata)}/post`);
    L.push(`7 hari: ${angka(h.views7)} views dari ${h.n7} post (${h.nPrev ? `${persen(h.views7, h.viewsPrev)} vs 7 hari sebelumnya: ${angka(h.viewsPrev)} dari ${h.nPrev} post` : 'belum ada pembanding 7 hari sebelumnya'})`);
    L.push(`Interaksi: ${angka(h.tot.likes)} suka · ${angka(h.tot.replies)} balasan · ${angka(h.tot.reposts)} repost · ${angka(h.tot.quotes)} kutipan · ${angka(h.tot.shares)} share`);
    L.push(`Engagement rate: ${(h.er * 100).toFixed(1)}%`);
    if (u.followers != null) L.push(`Followers: ${angka(u.followers)}${ff ? ` (${ff.delta >= 0 ? '+' : ''}${ff.delta} sejak ${ff.sejak})` : ''}`);
    if (u.profil7 != null) L.push(`Kunjungan profil 7 hari: ${angka(u.profil7)} (${persen(u.profil7, u.profilPrev7)})`);
    L.push('', '🏆 Capaian');
    if (u.followers != null) L.push(`Followers: ${tangga(u.followers, TANGGA_FOLLOWERS)}`);
    L.push(`Views 28 hari: ${tangga(h.tot.views, TANGGA_VIEWS)}`);
    if (h.top.length) L.push('', '🥇 Teratas', ...h.top.map(barisPost));
    if (h.bawah.length) L.push('', '🥉 Terbawah', ...h.bawah.map(barisPost));
    L.push('', '🔍 Penyebab', ...(sebab.length ? sebab.map((s) => `• ${s}`) : ['• Belum ada pola yang jelas dari data.']));
    L.push('', '💡 Saran');
    if (!saran.length) L.push('Belum ada saran: pertahankan pengaturan sekarang.');
    saran.forEach((s, i) => L.push(`${i + 1}. ${s.teks}${s.jenis === 'manual' ? ' (manual)' : s.diterapkan ? ' ✅ diterapkan' : ''}`));
    if (catatanOtomatis) L.push('', catatanOtomatis);
    if (saran.some((s) => s.jenis !== 'manual' && !s.diterapkan)) L.push('', `Terapkan: tombol di bawah atau /terapkan <nomor|semua>. Otomatis: /analisis auto ${st.set.analisisAuto ? 'off (sekarang ON)' : 'on (sekarang OFF)'}`);
    return L.join('\n');
  }

  function tombol(saran) {
    const bisa = saran.map((s, i) => ({ s, i })).filter(({ s }) => s.jenis !== 'manual' && !s.diterapkan);
    if (!bisa.length) return undefined;
    const baris = [bisa.map(({ i }) => ({ text: `✅ Terapkan ${i + 1}`, callback_data: `${CB}an:${i + 1}` }))];
    if (bisa.length > 1) baris.push([{ text: '✅ Terapkan semua', callback_data: `${CB}an:all` }]);
    return { inline_keyboard: baris };
  }

  // ---------- terapkan ----------
  function terapkanSatu(s) {
    if (s.jenis === 'jadwal') { const j = rapikanJadwal(s.nilai); if (!j) return false; st.set.jadwal = j; st.drafSlot = ''; }
    else if (s.jenis === 'panjang') { const p = rapikanPanjang(s.nilai); if (!p) return false; st.set.panjang = p; }
    else if (s.jenis === 'nanti') st.topikNanti = s.nilai;
    else return false;
    s.diterapkan = true;
    A.terakhir = { ...(A.terakhir || {}), [s.jenis]: Date.now() };
    return true;
  }

  async function terapkan(chat, pilih) {
    const saran = A.saran || [];
    if (!saran.length || Date.now() - (A.dibuat || 0) > BATAS_SARAN) return say(chat, 'Belum ada saran yang masih berlaku. Kirim /analisis dulu.');
    const target = pilih === 'semua' || pilih === 'all'
      ? saran.filter((s) => s.jenis !== 'manual' && !s.diterapkan)
      : [saran[parseInt(pilih, 10) - 1]].filter(Boolean);
    if (!target.length) {
      return say(chat, pilih === 'semua' || pilih === 'all' ? 'Semua saran yang bisa diterapkan sudah diterapkan.' : `Pilih nomor saran (1-${saran.length}) atau "semua". Contoh: /terapkan 1`);
    }
    const hasil = target.map((s) => (s.jenis === 'manual' ? `• ${s.teks}: harus dilakukan manual` : s.diterapkan ? `• Sudah diterapkan: ${s.teks}` : terapkanSatu(s) ? `✅ ${s.teks}` : `❌ Gagal: ${s.teks}`));
    simpan();
    await cadangkan();
    return say(chat, `${hasil.join('\n')}\n\nPengaturan sekarang: jadwal ${daftarJadwal().join(', ')} WIB, panjang ${st.set.panjang} bagian${st.topikNanti ? `, topik titipan: ${st.topikNanti}` : ''}.`);
  }

  // ---------- jalankan ----------
  let jalan = false;
  async function jalankan(chat, { otomatis = false } = {}) {
    if (jalan) return say(chat, 'Analisis sedang berjalan, tunggu sebentar.');
    jalan = true;
    try {
      if (!otomatis) await say(chat, 'Mengambil data insight Threads...');
      const data = await ambilData();
      const h = hitung(data);
      let { penyebab, saran } = aturan(h);
      if (data.izin && h.dinilai.length >= 4) {
        try {
          const l = await mintaLlm(h);
          penyebab = [...penyebab, ...l.penyebab].slice(0, 6);
          saran = [...saran, ...l.saran.map((t) => ({ jenis: 'manual', teks: t }))];
        } catch (e) { console.error('analisis LLM gagal, pakai aturan saja:', sensor(e.message).slice(0, 120)); }
      }
      saran = saran.slice(0, 7);
      A.saran = saran; A.dibuat = Date.now();
      let catatan = '';
      if (otomatis && st.set.analisisAuto) {
        const kena = saran.filter((s) => s.jenis !== 'manual' && s.aman && Date.now() - (A.terakhir?.[s.jenis] || 0) > JEDA_OTOMATIS);
        const ok = kena.filter(terapkanSatu);
        catatan = ok.length ? `🤖 Diterapkan otomatis: ${ok.map((s) => s.teks).join('; ')}` : '🤖 Mode otomatis: tidak ada saran yang cukup yakin untuk diterapkan otomatis.';
        if (ok.length) await cadangkan();
      }
      simpan();
      const teks = labelAkun() + laporan(data, h, penyebab, data.izin ? saran : [], catatan);
      const markup = data.izin ? tombol(saran) : undefined;
      if (teks.length <= 4000) await tg('sendMessage', { chat_id: chat, text: teks, disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) });
      else {
        await say(chat, teks.replace(labelAkun(), ''));
        if (markup) await tg('sendMessage', { chat_id: chat, text: labelAkun() + 'Terapkan saran di atas:', reply_markup: markup });
      }
    } catch (e) {
      await say(chat, `Analisis gagal: ${sensor(e.message).slice(0, 300)}`);
    } finally { jalan = false; }
  }

  // dipanggil tiap tick: analisis harian 21:00-21:59 WIB, sekali sehari
  function harian(owner) {
    const s = wib();
    if (jalan || s.slice(11, 13) !== '21' || A.harian === s.slice(0, 10)) return;
    A.harian = s.slice(0, 10);
    simpan();
    jalankan(owner, { otomatis: true }).catch(() => {});
  }

  return { jalankan, terapkan, harian };
};
