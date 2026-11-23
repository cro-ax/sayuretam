// Utilitas normalisasi ID WhatsApp (nomor HP & LID).
// Semua ID disimpan dalam bentuk "user@server" tanpa device suffix, contoh:
//   6281234567890@s.whatsapp.net
//   111122223333444@lid

const PN = 's.whatsapp.net';

/** Hilangkan device suffix (":12") dan samakan server lama (c.us). */
export function normalizeJid(jid) {
  if (!jid || typeof jid !== 'string') return null;
  const at = jid.indexOf('@');
  if (at === -1) return null;
  let user = jid.slice(0, at).split(':')[0];
  let server = jid.slice(at + 1).toLowerCase();
  if (server === 'c.us') server = PN;
  if (!user) return null;
  return `${user}@${server}`;
}

/**
 * Ubah input admin jadi JID.
 * Terima: 0812..., +62 812-..., 62812..., 111122223333444@lid, lid:1131..., 62812@s.whatsapp.net
 */
export function parseIdInput(input) {
  if (!input) return null;
  let s = String(input).trim().toLowerCase();

  if (s.startsWith('lid:')) {
    const d = s.slice(4).replace(/\D/g, '');
    return d ? `${d}@lid` : null;
  }
  if (s.includes('@')) {
    const [u, server] = s.split('@');
    const d = u.split(':')[0].replace(/\D/g, '');
    if (!d) return null;
    if (server === 'lid') return `${d}@lid`;
    if (server === PN || server === 'c.us') return `${d}@${PN}`;
    return null;
  }

  let d = s.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0')) d = '62' + d.slice(1); // 08xx -> 628xx
  else if (d.startsWith('8') && d.length <= 12) d = '62' + d; // 812xx -> 62812xx
  if (d.length < 8 || d.length > 15) return null;
  return `${d}@${PN}`;
}

/**
 * Versi "aman" untuk angka polos yang bisa jadi nomor HP atau LID
 * (contoh 222233334444555). Nomor Indonesia yang jelas -> 1 JID,
 * angka panjang yang tidak jelas -> dua-duanya (HP & LID).
 */
export function parseIdInputs(input) {
  const s = String(input || '').trim().toLowerCase();
  if (s.includes('@') || s.startsWith('lid:') || s.startsWith('+')) {
    const one = parseIdInput(s);
    return one ? [one] : [];
  }
  const d = s.replace(/\D/g, '');
  if (!d) return [];
  const clearlyPhone = d.startsWith('0') || (d.startsWith('8') && d.length <= 12) || (d.startsWith('62') && d.length <= 14);
  if (clearlyPhone) {
    const one = parseIdInput(d);
    return one ? [one] : [];
  }
  if (d.length < 8) return [];
  const out = [`${d}@lid`];
  if (d.length <= 15) out.push(`${d}@s.whatsapp.net`);
  return out;
}

/** Tampilan singkat untuk balasan chat. */
export function prettyId(jid) {
  if (!jid) return '-';
  const [u, server] = jid.split('@');
  return server === 'lid' ? `${u}@lid` : `+${u}`;
}

/**
 * Ambil semua kemungkinan ID pengirim dari sebuah pesan.
 * Baileys versi baru menaruh nomor asli di field berbeda saat chat memakai LID.
 */
export function senderCandidates(msg) {
  const k = msg.key || {};
  const raw = [
    k.participant,
    k.remoteJid,
    k.senderPn,
    k.senderLid,
    k.participantPn,
    k.participantLid,
    k.remoteJidAlt,
    k.participantAlt,
    msg.participant,
  ];
  const out = new Set();
  for (const r of raw) {
    const n = normalizeJid(r);
    if (n && !n.endsWith('@g.us') && !n.endsWith('@broadcast')) out.add(n);
  }
  return [...out];
}
