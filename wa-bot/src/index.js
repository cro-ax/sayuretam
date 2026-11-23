// Redam log internal libsignal ("Bad MAC", "Closing session: SessionEntry {...}") yang sangat berisik
// dan berisi data kunci sesi. Error ini normal setelah scan QR baru & pulih otomatis.
const NOISY = [/^Closing session/, /^Closing open session/, /^Session error/, /^Failed to decrypt/, /^Decrypted message with closed session/, /^Removing old closed session/, /^Migrating session/];
let signalNoise = 0;
for (const fn of ['log', 'info', 'warn', 'error']) {
  const orig = console[fn].bind(console);
  console[fn] = (...args) => {
    const first = typeof args[0] === 'string' ? args[0] : args[0] instanceof Error ? args[0].message : '';
    if (NOISY.some((r) => r.test(first))) {
      signalNoise++;
      return;
    }
    orig(...args);
  };
}
setInterval(() => {
  if (signalNoise > 0) {
    console.info(`[signal] ${signalNoise} pesan sinkronisasi kunci enkripsi (normal, diabaikan)`);
    signalNoise = 0;
  }
}, 10 * 60_000).unref();

import * as baileys from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { config, validateConfig } from './config.js';
import { Whitelist } from './whitelist.js';
import crypto from 'node:crypto';
import { senderCandidates, prettyId, normalizeJid } from './jid.js';
import { askAI, verifyModels } from './ai.js';
import { toWhatsApp, splitMessage } from './format.js';
import { handleCommand, rememberGuest, isSelfRegister, selfRegister, handleInChatCommand } from './commands.js';
import { WELCOME_TEXT } from './prompt.js';

// Kompatibel Baileys v6 (CJS) & v7 (ESM)
const B = baileys.default && typeof baileys.default === 'object' ? { ...baileys.default, ...baileys } : baileys;
const makeWASocket =
  typeof B.makeWASocket === 'function' ? B.makeWASocket : typeof B.default === 'function' ? B.default : baileys.default;
const { useMultiFileAuthState, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion, Browsers } = B;
const normalizeContent = B.normalizeMessageContent || ((m) => m);

const log = pino({
  level: config.logLevel,
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:dd-mm HH:MM:ss', ignore: 'pid,hostname' },
  },
});
const quiet = pino({ level: 'silent' }); // log internal Baileys sangat berisik

const cfgErrors = validateConfig();
if (cfgErrors.length) {
  cfgErrors.forEach((e) => log.error(e));
  process.exit(1);
}

const whitelist = new Whitelist(config.dataDir, config.ownerIds);
log.info(`Admin: ${[...whitelist.owners].map(prettyId).join(', ')} | Whitelist: ${whitelist.list().length} orang`);

// ---------- Helper state ----------
const seen = new Map(); // message id -> ts (anti duplikat)
const queues = new Map(); // userKey -> Promise (proses pesan per user berurutan)
const rate = new Map(); // userKey -> [timestamps]

function isDuplicate(id) {
  if (!id) return false;
  if (seen.has(id)) return true;
  seen.set(id, Date.now());
  if (seen.size > 2000) {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [k, t] of seen) if (t < cutoff) seen.delete(k);
  }
  return false;
}

function rateLimited(key) {
  if (!config.rateLimitPerHour) return false;
  const now = Date.now();
  const arr = (rate.get(key) || []).filter((t) => now - t < 3_600_000);
  if (arr.length >= config.rateLimitPerHour) {
    rate.set(key, arr);
    return true;
  }
  arr.push(now);
  rate.set(key, arr);
  return false;
}

function enqueue(key, job) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(job).catch((err) => log.error({ err }, 'Job error'));
  queues.set(key, next);
  next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  return next;
}

// ---------- Cache untuk Baileys (retry pesan gagal didekripsi) ----------
function makeCache(max = 1000) {
  const m = new Map();
  return {
    get: (k) => m.get(k),
    set: (k, v) => {
      m.set(k, v);
      if (m.size > max) m.delete(m.keys().next().value);
    },
    del: (k) => m.delete(k),
    flushAll: () => m.clear(),
  };
}
const msgRetryCounterCache = makeCache(1000);
const sentStore = makeCache(500); // id -> isi pesan, supaya bisa dikirim ulang bila HP penerima minta

// ---------- Kirim pesan dengan ID yang dicatat (supaya bot tidak membalas pesannya sendiri) ----------
const sentIds = new Set();
function newMsgId(sock) {
  if (typeof B.generateMessageIDV2 === 'function') return B.generateMessageIDV2(sock.user?.id);
  if (typeof B.generateMessageID === 'function') return B.generateMessageID();
  return '3EB0' + crypto.randomBytes(9).toString('hex').toUpperCase();
}
async function send(sock, jid, content, opts = {}) {
  const id = newMsgId(sock);
  sentIds.add(id);
  if (sentIds.size > 3000) sentIds.delete(sentIds.values().next().value);
  const sent = await sock.sendMessage(jid, content, { ...opts, messageId: id });
  if (sent?.message) sentStore.set(id, sent.message);
  return sent;
}

/** ID nomor bot sendiri (nomor HP + LID) */
function ownIds(sock) {
  return [normalizeJid(sock.user?.id), normalizeJid(sock.user?.lid)].filter(Boolean);
}

function extractContent(msg) {
  const m = normalizeContent(msg.message) || {};
  const text = m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.documentMessage?.caption || '';
  // Foto biasa, atau foto yang dikirim sebagai dokumen (kualitas asli)
  const image = m.imageMessage || (m.documentMessage?.mimetype?.startsWith('image/') ? m.documentMessage : null);
  return { text: text.trim(), image };
}

// ---------- Koneksi WhatsApp ----------
let reconnectAttempt = 0;

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);

  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch {
    /* pakai versi bawaan */
  }

  const sock = makeWASocket({
    auth: state,
    version,
    logger: quiet,
    browser: Browsers?.ubuntu ? Browsers.ubuntu('Chrome') : ['Ubuntu', 'Chrome', '22.04'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    msgRetryCounterCache,
    getMessage: async (key) => sentStore.get(key.id),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      log.info('Scan QR berikut di WhatsApp > Perangkat tertaut:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      reconnectAttempt = 0;
      log.info(`✅ Terhubung sebagai ${prettyId(sock.user?.id?.split(':')[0] + '@s.whatsapp.net')}`);
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        log.error('Sesi logout. Hapus folder auth lalu jalankan ulang untuk scan QR baru.');
        process.exit(1);
      }
      reconnectAttempt++;
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(reconnectAttempt, 5));
      log.warn(`Koneksi putus (kode ${code}). Sambung ulang dalam ${delay / 1000}s...`);
      setTimeout(() => start().catch((e) => log.error(e, 'Gagal start ulang')), delay);
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    for (const msg of messages) {
      // 'append' hanya dipakai untuk pesan yang kamu ketik dari HP (fromMe)
      if (type !== 'notify' && !msg.key?.fromMe) continue;
      try {
        onMessage(sock, msg);
      } catch (err) {
        log.error({ err }, 'onMessage error');
      }
    }
  });
}

function onMessage(sock, msg) {
  if (!msg.message) return;
  const chatJid = msg.key.remoteJid;
  if (!chatJid || chatJid === 'status@broadcast' || chatJid.endsWith('@newsletter')) return;
  const isGroup = chatJid.endsWith('@g.us');
  if (sentIds.has(msg.key.id)) return; // pesan yang dikirim bot sendiri
  if (isDuplicate(msg.key.id)) return;

  const { text, image } = extractContent(msg);
  if (!text && !image) return; // stiker, voice note, dll diabaikan

  let ids;
  let isOwner;
  let selfChat = false;

  if (msg.key.fromMe) {
    // Pesan yang KAMU ketik dari HP (nomor bot)
    const ageSec = Date.now() / 1000 - Number(msg.messageTimestamp || 0);
    if (ageSec > 300) return; // abaikan pesan lama (sinkronisasi riwayat)
    const me = ownIds(sock);
    selfChat = me.includes(normalizeJid(chatJid));

    if (!selfChat) {
      // Command di chat orang lain -> berlaku untuk orang itu
      if (isGroup || !text.startsWith('!')) return;
      const partnerIds = senderCandidates(msg).filter((i) => !me.includes(i));
      if (partnerIds.length === 0) return;
      const res = handleInChatCommand({ text, partnerIds, whitelist });
      if (!res) return;
      log.info(`Admin (di chat): ${text} -> ${partnerIds.map(prettyId).join(' / ')}`);
      (async () => {
        if (config.deleteCommandMsg) await send(sock, chatJid, { delete: msg.key }).catch(() => {});
        if (res.welcome && config.addWelcome) await send(sock, chatJid, { text: WELCOME_TEXT });
        if (me[0]) await send(sock, me[0], { text: res.ok });
      })().catch((e) => log.error(e, 'Gagal proses command di chat'));
      return;
    }
    // Chat "pesan ke diri sendiri" = panel admin + bisa tes tanya AI
    ids = me;
    isOwner = true;
  } else {
    if (isGroup && !config.allowGroups) return;
    ids = senderCandidates(msg);
    isOwner = whitelist.isOwner(ids);
  }

  if (!isOwner && !whitelist.isAllowed(ids)) {
    // Belum terdaftar: hanya merespons "!add" / "!daftar", selain itu diam total
    if (isSelfRegister(text)) {
      const welcome = selfRegister({ senderIds: ids, pushName: msg.pushName, whitelist });
      if (welcome) {
        log.info(`Daftar sendiri: ${msg.pushName || '-'} ${ids.map(prettyId).join(' / ')}`);
        send(sock, chatJid, { text: welcome }, { quoted: msg }).catch((e) => log.error(e, 'Gagal kirim'));
      } else {
        log.info(`Daftar ditolak (diblokir): ${ids.map(prettyId).join(' / ')}`);
      }
      return;
    }
    rememberGuest(ids, msg.pushName, text || '[foto]');
    log.info(`Abaikan (belum !add): ${msg.pushName || '-'} ${ids.map(prettyId).join(' / ')}`);
    return;
  }
  if (!selfChat) whitelist.learnAliases(ids); // simpan LID/nomor baru milik user yg sama

  const userKey = ids.find((i) => i.endsWith('@s.whatsapp.net')) || ids[0];

  enqueue(userKey, async () => {
    const reply = async (body) => {
      for (const part of splitMessage(body)) {
        await send(sock, chatJid, { text: part }, { quoted: msg });
      }
    };

    // Command
    const cmdReply = await handleCommand({ text, isOwner, userKey, senderIds: ids, whitelist });
    if (cmdReply) return reply(cmdReply);

    if (!isOwner && rateLimited(userKey)) {
      return reply('Waduh Lur, pertanyaannya sudah banyak banget dalam sejam ini 😅 Coba lagi sebentar lagi ya.');
    }

    // Tandai dibaca + "sedang mengetik"
    sock.readMessages([msg.key]).catch(() => {});
    sock.sendPresenceUpdate('composing', chatJid).catch(() => {});

    let imagePayload = null;
    if (image) {
      const size = Number(image.fileLength || 0);
      if (size && size > config.maxImageBytes) {
        return reply(`Fotonya kebesaran Lur (maks ${Math.round(config.maxImageBytes / 1048576)} MB). Kirim ulang yang lebih kecil ya.`);
      }
      try {
        const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: quiet, reuploadRequest: sock.updateMediaMessage });
        imagePayload = { data: buf.toString('base64'), mimeType: image.mimetype || 'image/jpeg' };
      } catch (err) {
        log.warn({ err: err.message }, 'Gagal unduh foto');
        return reply('Fotonya gagal kebuka Lur 🙏 Coba kirim ulang ya.');
      }
    }

    try {
      const { text: answer } = await askAI(userKey, text, imagePayload, log);
      await reply(toWhatsApp(answer));
    } catch (err) {
      log.error({ err: err.message }, 'AI gagal total');
      await reply('Maaf Bosku, sistem lagi sibuk/gangguan. Coba kirim ulang beberapa menit lagi ya 🙏');
    } finally {
      sock.sendPresenceUpdate('paused', chatJid).catch(() => {});
    }
  });
}

process.on('unhandledRejection', (err) => log.error({ err }, 'unhandledRejection'));
process.on('uncaughtException', (err) => log.error({ err }, 'uncaughtException'));

verifyModels(log).catch(() => {});

start().catch((err) => {
  log.fatal(err, 'Gagal start');
  process.exit(1);
});
