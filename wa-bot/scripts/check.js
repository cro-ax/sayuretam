// Cek sintaks semua file .js SEBELUM restart PM2.
// Mencegah bot mati karena file terpotong / SyntaxError.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

const files = [...walk('src'), ...walk('scripts')];
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    bad++;
    console.error(`❌ ${f}\n${r.stderr}`);
  } else {
    console.log(`✅ ${f}`);
  }
}
if (bad) {
  console.error(`\n${bad} file bermasalah. JANGAN restart dulu.`);
  process.exit(1);
}
console.log('\nSemua file OK. Aman untuk: pm2 restart sayur-etam');
