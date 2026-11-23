// Cek model Gemini apa saja yang bisa dipakai API key di .env, plus tes kecepatannya.
//   npm run models          -> daftar model + tes kecepatan model "flash"
//   npm run models -- all   -> tes kecepatan SEMUA model (lebih lama)
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error('GEMINI_API_KEY belum diisi di .env');
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey: key });
const testAll = process.argv.includes('all');

const names = [];
try {
  for await (const m of await ai.models.list()) {
    const actions = m.supportedActions || [];
    if (!actions.includes('generateContent')) continue;
    names.push(m.name.replace(/^models\//, ''));
  }
} catch (err) {
  console.error('Gagal ambil daftar model:', err.message);
  console.error('Kalau key diawali "AQ." dan error-nya soal API key, tambahkan GOOGLE_GENAI_USE_VERTEXAI=true di .env');
  process.exit(1);
}

names.sort();
console.log(`\n=== ${names.length} model bisa dipakai (generateContent) ===`);
for (const n of names) console.log(' -', n);

const toTest = names.filter((n) => testAll || (/flash/.test(n) && !/(tts|image|audio|live|embedding|preview-native)/.test(n)));
if (toTest.length === 0) process.exit(0);

console.log(`\n=== Tes kecepatan (${toTest.length} model) ===`);
console.log(`Sekarang di .env -> utama: ${process.env.GEMINI_MODEL} | cadangan: ${process.env.GEMINI_FALLBACK_MODEL}\n`);

const results = [];
for (const model of toTest) {
  const t = Date.now();
  try {
    await Promise.race([
      ai.models.generateContent({
        model,
        contents: 'Daun cabai keriting dan menguning, apa penyebabnya? Jawab 3 kalimat.',
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('lebih dari 30 detik')), 30000)),
    ]);
    const ms = Date.now() - t;
    results.push({ model, ms });
    console.log(`✅ ${model.padEnd(40)} ${ms} ms`);
  } catch (err) {
    console.log(`❌ ${model.padEnd(40)} ${String(err.message).slice(0, 70)}`);
  }
}

results.sort((a, b) => a.ms - b.ms);
if (results.length) {
  console.log('\n=== Urutan tercepat ===');
  results.forEach((r, i) => console.log(`${i + 1}. ${r.model} — ${r.ms} ms`));
  console.log('\nGanti model di .env: GEMINI_MODEL=... dan GEMINI_FALLBACK_MODEL=..., lalu pm2 restart sayur-etam');
}
