// Command chat. Semua command diawali "!".
//
// Untuk SIAPA SAJA (belum terdaftar):  !add / !daftar  -> daftar & mulai dibalas AI (REGISTER_MODE=self)
// Untuk user terdaftar:                !reset !menu !stop
// Untuk admin:                         !add <nomor> !del !list !tamu !ban !unban !status !tesai
import { parseIdInputs, prettyId } from './jid.js';
import { resetHistory, testModels, lastModelUsed } from './ai.js';
import { WELCOME_TEXT } from './prompt.js';
import { config } from './config.js';

const startedAt = Date.now();
const REGISTER_CMDS = new Set(['!add', '!daftar']);

// Daftar pengirim tak dikenal terbaru, supaya admin gampang menambahkan (cukup !add #1)
const guests = []; // { ids: [], name, at, preview }
export function rememberGuest(ids, name, preview) {
  const key = ids.join('|');
  const idx = guests.findIndex((g) => g.ids.join('|') === key);
  if (idx !== -1) guests.splice(idx, 1);
  guests.unshift({ ids, name: name || '', at: Date.now(), preview: (preview || '').slice(0, 40) });
  if (guests.length > 15) guests.length = 15;
}

/** "#2" -> ID tamu nomor 2, selain itu parse nomor/LID */
function resolveTarget(target) {
  if (/^#\d+$/.test(target)) {
    const g = guests[Number(target.slice(1)) - 1];
    return g ? { ids: g.ids, name: g.name } : null;
  }
  const ids = parseIdInputs(target);
  return ids.length ? { ids, name: '' } : null;
}

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'barusan';
  if (m < 60) return `${m} mnt lalu`;
  return `${Math.round(m / 60)} jam lalu`;
}

const ADMIN_HELP = `*Cara paling gampang:* buka chat orangnya di HP kamu, ketik *!add* (atau *!add Nama*).
Di chat orang itu juga bisa: *!del*, *!ban*, *!unban*, *!cek*.
(Pesan command otomatis dihapus, orangnya cuma terima sambutan.)

*Command Admin* (di chat "Pesan ke diri sendiri")
• *!add 0812xxxx Nama* — daftarkan nomor orang lain
• *!add 1131xxxx@lid Nama* — daftarkan LID
• *!add #1 Nama* — daftarkan dari daftar !tamu
• *!del 0812xxxx* / *!del 3* — hapus (nomor urut dari !list)
• *!ban 0812xxxx* — hapus + blokir (tak bisa !add sendiri)
• *!unban 0812xxxx* — buka blokir
• *!list* — lihat yang terdaftar
• *!tamu* — orang belum terdaftar yang barusan chat
• *!status* — info bot & model Gemini terakhir
• *!tesai* — tes koneksi ke Gemini`;

const USER_HELP = `\n\nKetik *!reset* untuk mulai obrolan baru, *!stop* untuk berhenti dibalas bot.`;

/**
 * Command yang kamu ketik LANGSUNG di chat orang lain dari HP kamu (nomor bot).
 * Contoh: buka chat Pak Budi -> ketik "!add Pak Budi".
 * @returns {{ok: string, welcome?: boolean}|null}
 */
export function handleInChatCommand({ text, partnerIds, whitelist }) {
  const [rawCmd, ...args] = text.trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase();
  const name = args.join(' ');
  const who = (u) => `*${u?.name || '-'}* (${(u?.ids || partnerIds).map(prettyId).join(', ')})`;
  switch (cmd) {
    case '!add':
    case '!daftar': {
      whitelist.unban(partnerIds);
      const res = whitelist.add(partnerIds, name, 'admin-chat');
      return { ok: `${res.updated ? '♻️ Sudah terdaftar, diperbarui' : '✅ Ditambahkan'}: ${who(res.user)}`, welcome: !res.updated };
    }
    case '!del':
    case '!hapus': {
      const u = whitelist.remove(partnerIds[0]);
      return { ok: u ? `🗑️ Dihapus: ${who(u)}` : `Orang ini memang belum terdaftar.` };
    }
    case '!ban': {
      const u = whitelist.remove(partnerIds[0]);
      const ids = u ? u.ids : partnerIds;
      whitelist.ban(ids);
      return { ok: `⛔ Diblokir: ${ids.map(prettyId).join(', ')}` };
    }
    case '!unban':
      whitelist.unban(partnerIds);
      return { ok: `✅ Blokir dibuka: ${partnerIds.map(prettyId).join(', ')}` };
    case '!cek': {
      const u = whitelist.find(partnerIds);
      return { ok: u ? `✅ Terdaftar: ${who(u)}` : `❌ Belum terdaftar: ${partnerIds.map(prettyId).join(', ')}` };
    }
    default:
      return null;
  }
}

/** Apakah pesan ini permintaan daftar dari orang yang belum terdaftar? */
export function isSelfRegister(text) {
  if (!text) return false;
  const cmd = text.trim().split(/\s+/)[0].toLowerCase();
  return config.registerMode === 'self' && REGISTER_CMDS.has(cmd);
}

/** Proses daftar sendiri. Dipanggil untuk pengirim yang BELUM terdaftar. */
export function selfRegister({ senderIds, pushName, whitelist }) {
  if (whitelist.isBanned(senderIds)) return null; // diam saja
  whitelist.add(senderIds, pushName || '', 'self');
  return `✅ *Kamu sudah terdaftar!*\n\n${WELCOME_TEXT}${USER_HELP}`;
}

/**
 * @returns {Promise<string|null>} teks balasan, atau null kalau bukan command
 */
export async function handleCommand({ text, isOwner, userKey, senderIds, whitelist }) {
  if (!text || !text.startsWith('!')) return null;
  const [rawCmd, ...args] = text.trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase();

  // ----- command untuk semua user terdaftar -----
  if (cmd === '!reset') {
    resetHistory(userKey);
    return 'Oke Lur, obrolan sudah direset. Silakan tanya lagi dari awal 🌱';
  }
  if (cmd === '!menu' || cmd === '!start' || cmd === '!help') {
    return isOwner ? `${WELCOME_TEXT}\n\n${ADMIN_HELP}` : WELCOME_TEXT + USER_HELP;
  }
  if (cmd === '!stop' || cmd === '!keluar') {
    if (isOwner) return 'Kamu admin, tidak bisa !stop 😄';
    whitelist.remove(senderIds[0]);
    resetHistory(userKey);
    return 'Oke Lur, bot berhenti membalas kamu. Kalau mau pakai lagi, ketik *!add* ya 🙏';
  }
  if (REGISTER_CMDS.has(cmd) && !isOwner) {
    return 'Kamu sudah terdaftar kok Lur 👍 Langsung aja kirim foto atau pertanyaan soal kebun.';
  }

  if (!isOwner) return null; // command lain dianggap pesan biasa untuk non-admin

  switch (cmd) {
    case '!add':
    case '!daftar': {
      if (args.length === 0) return `Kamu admin, sudah otomatis bisa pakai bot.\n\n${ADMIN_HELP}`;
      const target = args[0];
      let name = args.slice(1).join(' ');
      const t = resolveTarget(target);
      if (!t) return `ID *${target}* tidak valid / tamu tidak ada.\nContoh: 081234567890, 111122223333444@lid, atau #1 (lihat !tamu)`;
      const ids = t.ids;
      if (!name) name = t.name;
      whitelist.unban(ids);
      const res = whitelist.add(ids, name, senderIds[0]);
      if (!res.ok) return `Gagal: ${res.reason}`;
      const idsText = res.user.ids.map(prettyId).join(', ');
      return res.updated
        ? `✅ Sudah terdaftar, data diperbarui: *${res.user.name || '-'}* (${idsText})`
        : `✅ Ditambahkan: *${res.user.name || '-'}* (${idsText})`;
    }

    case '!del':
    case '!hapus': {
      if (!args[0]) return 'Format: *!del 0812xxxx* atau *!del 3* (nomor urut dari !list)';
      const removed = whitelist.remove(args[0]);
      return removed
        ? `🗑️ Dihapus: *${removed.name || '-'}* (${removed.ids.map(prettyId).join(', ')})\nCatatan: dia bisa daftar lagi dengan !add. Pakai *!ban* kalau mau blokir.`
        : `Tidak ketemu *${args[0]}* di daftar.`;
    }

    case '!ban': {
      if (!args[0]) return 'Format: *!ban 0812xxxx* atau *!ban 3*';
      const t = resolveTarget(args[0]);
      const removed = whitelist.remove(t && /^#/.test(args[0]) ? t.ids[0] : args[0]);
      const ids = removed ? removed.ids : t?.ids || [];
      if (ids.length === 0) return `ID *${args[0]}* tidak valid.`;
      whitelist.ban(ids);
      return `⛔ Diblokir: ${ids.map(prettyId).join(', ')}`;
    }

    case '!unban': {
      const ids = resolveTarget(args[0] || '')?.ids || [];
      if (ids.length === 0) return 'Format: *!unban 0812xxxx*';
      whitelist.unban(ids);
      return `✅ Blokir dibuka: ${ids.map(prettyId).join(', ')}`;
    }

    case '!list': {
      const list = whitelist.list();
      if (list.length === 0) return 'Belum ada yang terdaftar.';
      const lines = list.map(
        (u, i) => `${i + 1}. *${u.name || '-'}* — ${u.ids.map(prettyId).join(', ')}${u.addedBy === 'self' ? ' (daftar sendiri)' : ''}`,
      );
      return `*Terdaftar (${list.length})*\n${lines.join('\n')}`;
    }

    case '!tamu': {
      if (guests.length === 0) return 'Belum ada orang tak terdaftar yang chat.';
      const lines = guests.map(
        (g, i) => `#${i + 1} ${g.name || '(tanpa nama)'} — ${g.ids.map(prettyId).join(', ')}\n    ${ago(g.at)}: "${g.preview}"`,
      );
      return `*Tamu terbaru*\n${lines.join('\n')}\n\nDaftarkan dengan *!add #1 Nama*`;
    }

    case '!status': {
      const up = Math.round((Date.now() - startedAt) / 60000);
      const mem = Math.round(process.memoryUsage().rss / 1024 / 1024);
      const lm = lastModelUsed();
      return [
        '*Status Bot*',
        `Uptime: ${up} menit | RAM: ${mem} MB`,
        `Mode daftar: ${config.registerMode === 'self' ? 'siapa saja ketik !add' : 'hanya admin'}`,
        `Terdaftar: ${whitelist.list().length} | Diblokir: ${whitelist.banned.length}`,
        `Gemini utama: ${config.model}`,
        `Gemini cadangan: ${config.fallbackModel}`,
        `Jawaban terakhir dari: ${lm ? `${lm.model} (${ago(lm.at)})` : 'belum ada'}`,
        `ID kamu: ${senderIds.map(prettyId).join(', ')}`,
      ].join('\n');
    }

    case '!tesai':
      return `*Tes Gemini*\n${await testModels()}`;

    default:
      return `Command *${cmd}* tidak dikenal.\n\n${ADMIN_HELP}`;
  }
}
