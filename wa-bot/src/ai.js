// Mesin AI: Gemini dengan timeout + fallback model, riwayat percakapan per user,
// dan pembatas jumlah request bersamaan.
import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { SYSTEM_PROMPT } from './prompt.js';

const ai = new GoogleGenAI({ apiKey: config.geminiKey });

// ---------- Semaphore sederhana ----------
let running = 0;
const waiting = [];
async function acquire() {
  if (running < config.maxConcurrentAi) {
    running++;
    return;
  }
  await new Promise((resolve) => waiting.push(resolve));
  running++;
}
function release() {
  running--;
  const next = waiting.shift();
  if (next) next();
}

// ---------- Riwayat percakapan ----------
const histories = new Map(); // userKey -> { turns: [{role, parts}], last }

function getHistory(key) {
  const h = histories.get(key);
  if (!h) return [];
  if (Date.now() - h.last > config.historyTtlMs) {
    histories.delete(key);
    return [];
  }
  return h.turns;
}

function pushHistory(key, userText, hadImage, answer) {
  const turns = getHistory(key).slice();
  const userPart = (hadImage ? '[mengirim foto tanaman] ' : '') + (userText || '');
  turns.push({ role: 'user', parts: [{ text: userPart.trim() || '[foto]' }] });
  turns.push({ role: 'model', parts: [{ text: answer }] });
  const max = config.historyTurns * 2;
  histories.set(key, { turns: turns.slice(-max), last: Date.now() });
}

export function resetHistory(key) {
  histories.delete(key);
}

// Bersihkan riwayat kadaluarsa tiap 10 menit (hemat RAM)
setInterval(() => {
  const now = Date.now();
  for (const [k, h] of histories) if (now - h.last > config.historyTtlMs) histories.delete(k);
}, 10 * 60_000).unref();

// ---------- Pemanggilan model ----------
class TimeoutError extends Error {}

function buildConfig(signal) {
  const c = {
    systemInstruction: SYSTEM_PROMPT,
    temperature: config.temperature,
    // Batas besar: token "berpikir" model ikut dihitung di sini, kalau kecil jawaban terpotong
    maxOutputTokens: config.maxTokens,
    abortSignal: signal,
  };
  if (config.thinkingBudget !== null) c.thinkingConfig = { thinkingBudget: config.thinkingBudget };
  return c;
}

async function generateOnce(model, contents, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(`${model} timeout ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([
      ai.models.generateContent({ model, contents, config: buildConfig(controller.signal) }),
      timeout,
    ]);
    return {
      text: (res?.text || '').trim(),
      finish: res?.candidates?.[0]?.finishReason || '',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Panggil model; kalau jawaban terpotong (MAX_TOKENS), minta lanjutan otomatis (maks 2x). */
async function callModel(model, contents, timeoutMs, log) {
  let { text, finish } = await generateOnce(model, contents, timeoutMs);
  if (!text) throw new Error(`${model} jawaban kosong (${finish || 'tanpa alasan'})`);

  for (let i = 0; i < 2 && finish === 'MAX_TOKENS'; i++) {
    log?.warn({ model }, 'Jawaban terpotong, minta lanjutan');
    const more = await generateOnce(
      model,
      [
        ...contents,
        { role: 'model', parts: [{ text }] },
        { role: 'user', parts: [{ text: 'Lanjutkan jawabanmu persis dari kata terakhir, tanpa mengulang.' }] },
      ],
      timeoutMs,
    ).catch(() => null);
    if (!more?.text) break;
    text = `${text}${/\s$/.test(text) ? '' : ' '}${more.text}`;
    finish = more.finish;
  }
  return text;
}

/**
 * @param {string} userKey  id unik user (untuk riwayat)
 * @param {string} text     teks/keluhan
 * @param {{data: string, mimeType: string}|null} image  base64
 * @returns {Promise<{text: string, model: string}>}
 */
export async function askAI(userKey, text, image, log) {
  const parts = [];
  if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  parts.push({
    text: text || (image ? 'Tolong analisis foto tanaman ini: apa masalahnya dan bagaimana solusinya?' : ''),
  });

  const contents = [...getHistory(userKey), { role: 'user', parts }];

  await acquire();
  try {
    const started = Date.now();
    // Urutan percobaan: model utama -> fallback -> model utama sekali lagi (waktu lebih longgar).
    // Semua jawaban PASTI dari Gemini; tidak ada jawaban template.
    const attempts = [
      [config.model, config.aiTimeoutMs],
      [config.fallbackModel, config.aiFallbackTimeoutMs],
      [config.model, config.aiFallbackTimeoutMs],
    ];
    let lastErr;
    for (const [model, ms] of attempts) {
      try {
        const answer = await callModel(model, contents, ms, log);
        log?.info({ model, ms: Date.now() - started }, 'Gemini menjawab');
        lastModel = { model, at: Date.now() };
        pushHistory(userKey, text, !!image, answer);
        return { text: answer, model };
      } catch (err) {
        lastErr = err;
        log?.warn({ model, err: err.message }, 'Percobaan Gemini gagal');
      }
    }
    throw lastErr;
  } finally {
    release();
  }
}

// ---------- Diagnostik Gemini ----------
let lastModel = null;
export function lastModelUsed() {
  return lastModel;
}

/** Cek nama model valid & API key aktif. Dipanggil saat bot start. */
export async function verifyModels(log) {
  for (const model of [config.model, config.fallbackModel]) {
    try {
      await ai.models.get({ model });
      log.info(`Gemini OK: model "${model}" tersedia`);
    } catch (err) {
      log.error(`Gemini BERMASALAH: model "${model}" -> ${err.message?.slice(0, 160)}`);
    }
  }
}

/** Tes kirim prompt kecil ke tiap model (command !tesai). */
export async function testModels() {
  const lines = [];
  for (const model of [config.model, config.fallbackModel]) {
    const t = Date.now();
    try {
      const out = await callModel(
        model,
        [{ role: 'user', parts: [{ text: 'Jawab satu kata saja: siap' }] }],
        config.aiFallbackTimeoutMs,
      );
      lines.push(`✅ ${model} — ${Date.now() - t} ms — "${out.slice(0, 30)}"`);
    } catch (err) {
      lines.push(`❌ ${model} — ${err.message?.slice(0, 120)}`);
    }
  }
  return lines.join('\n');
}
