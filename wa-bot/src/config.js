import 'dotenv/config';
import path from 'node:path';

const num = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const ROOT = process.cwd();

export const config = {
  geminiKey: process.env.GEMINI_API_KEY || '',
  model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  fallbackModel: process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite',
  aiTimeoutMs: num(process.env.AI_TIMEOUT_MS, 12000),
  aiFallbackTimeoutMs: num(process.env.AI_FALLBACK_TIMEOUT_MS, 25000),
  temperature: num(process.env.AI_TEMPERATURE, 0.4),
  maxTokens: num(process.env.AI_MAX_TOKENS, 8192),
  // Kosong = bawaan model. 0 = matikan "berpikir" (lebih cepat). Angka lain = jatah token berpikir.
  thinkingBudget: process.env.AI_THINKING_BUDGET === undefined || process.env.AI_THINKING_BUDGET === '' ? null : num(process.env.AI_THINKING_BUDGET, null),

  // admin = hanya admin (kamu) yang bisa mendaftarkan orang  [default]
  // self  = siapa pun yang ketik !add sendiri otomatis terdaftar
  registerMode: (process.env.REGISTER_MODE || 'admin').toLowerCase() === 'self' ? 'self' : 'admin',
  // Kirim pesan sambutan ke orang yang baru kamu !add
  addWelcome: String(process.env.ADD_SEND_WELCOME || 'true').toLowerCase() !== 'false',
  // Hapus pesan "!add" yang kamu ketik di chat orang itu (supaya dia tidak lihat)
  deleteCommandMsg: String(process.env.DELETE_COMMAND_MSG || 'true').toLowerCase() !== 'false',

  ownerIds: (process.env.OWNER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  historyTurns: num(process.env.HISTORY_TURNS, 6),
  historyTtlMs: num(process.env.HISTORY_TTL_MIN, 30) * 60_000,
  rateLimitPerHour: num(process.env.RATE_LIMIT_PER_HOUR, 30),
  maxImageBytes: num(process.env.MAX_IMAGE_MB, 8) * 1024 * 1024,
  maxConcurrentAi: Math.max(1, num(process.env.MAX_CONCURRENT_AI, 3)),
  allowGroups: String(process.env.ALLOW_GROUPS || 'false').toLowerCase() === 'true',

  authDir: path.resolve(ROOT, process.env.AUTH_DIR || 'sesi_wa_sayuretam'),
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  logLevel: process.env.LOG_LEVEL || 'info',
};

export function validateConfig() {
  const errors = [];
  if (!config.geminiKey) errors.push('GEMINI_API_KEY belum diisi di .env');
  if (config.ownerIds.length === 0) errors.push('OWNER_IDS belum diisi di .env');
  return errors;
}
