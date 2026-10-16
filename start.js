// Menjalankan satu atau dua bot dari satu aplikasi (satu Environment).
// Bot 1 memakai variabel biasa. Bot 2 aktif bila BOT2_TELEGRAM_BOT_TOKEN diisi; variabel lain untuk
// bot 2 ditulis dengan awalan BOT2_ (mis. BOT2_OWNER_CHAT_ID), selebihnya ikut variabel bot 1.
// Fitur Threads (THREADS_*, THREADS2_* untuk akun Threads kedua) hanya dijalankan satu bot agar tidak posting dobel:
// THREADS_BOT=1 atau 2 (bawaan: 2 bila bot 2 ada, selain itu 1).
const { spawn } = require('child_process');
const path = require('path');

const env = process.env;
const adaBot2 = Boolean((env.BOT2_TELEGRAM_BOT_TOKEN || '').trim());
const threadsBot = env.THREADS_BOT || (adaBot2 ? '2' : '1');
const dataDir = env.DATA_DIR || path.join(__dirname, 'data');
const port = parseInt(env.PORT || '3000', 10);

function envBot(n) {
  const e = {};
  for (const [k, v] of Object.entries(env)) if (!k.startsWith('BOT2_')) e[k] = v;
  if (n === 2) {
    for (const [k, v] of Object.entries(env)) if (k.startsWith('BOT2_')) e[k.slice(5)] = v;
    e.DATA_DIR = path.join(dataDir, 'bot2');
    e.PORT = String(port + 1);
  }
  if (String(n) !== threadsBot) {
    for (const k of Object.keys(e)) if (/^THREADS\d*_/.test(k)) delete e[k];
    e.THREADS_NONAKTIF = '1';
  }
  return e;
}

const anak = new Map();
let berhenti = false;
function jalankan(n) {
  const p = spawn(process.execPath, [path.join(__dirname, 'index.js')], { env: envBot(n), stdio: ['ignore', 'pipe', 'pipe'] });
  anak.set(n, p);
  const awalan = `[bot${n}] `;
  const salur = (src, dst) => {
    let sisa = '';
    src.on('data', (d) => {
      const baris = (sisa + d).split('\n');
      sisa = baris.pop();
      for (const b of baris) dst.write(awalan + b + '\n');
    });
  };
  salur(p.stdout, process.stdout);
  salur(p.stderr, process.stderr);
  const mulai = Date.now();
  p.on('exit', (code) => {
    anak.delete(n);
    if (berhenti) return;
    // crash cepat (mis. token salah) diberi jeda lebih lama agar log tidak banjir
    const jeda = Date.now() - mulai < 30000 ? 30000 : 3000;
    console.error(`${awalan}berhenti (kode ${code}), dijalankan ulang dalam ${jeda / 1000} detik`);
    setTimeout(() => jalankan(n), jeda);
  });
}

jalankan(1);
if (adaBot2) jalankan(2);
console.log(`Menjalankan ${adaBot2 ? '2 bot' : '1 bot'}; fitur Threads di bot${threadsBot}.`);

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    berhenti = true;
    for (const p of anak.values()) p.kill(sig);
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
