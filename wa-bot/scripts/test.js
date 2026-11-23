// Tes cepat logika whitelist & format (tanpa koneksi WA / Gemini).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseIdInput, parseIdInputs, normalizeJid, senderCandidates } from '../src/jid.js';
import { Whitelist } from '../src/whitelist.js';
import { toWhatsApp, splitMessage } from '../src/format.js';

// jid
assert.equal(parseIdInput('0812-3456-7890'), '6281234567890@s.whatsapp.net');
assert.equal(parseIdInput('+62 812 3456 7890'), '6281234567890@s.whatsapp.net');
assert.equal(parseIdInput('81234567890'), '6281234567890@s.whatsapp.net');
assert.equal(parseIdInput('111122223333444@lid'), '111122223333444@lid');
assert.equal(parseIdInput('lid:111122223333444'), '111122223333444@lid');
assert.equal(parseIdInput('abc'), null);
assert.equal(normalizeJid('6281234567890:12@s.whatsapp.net'), '6281234567890@s.whatsapp.net');
assert.deepEqual(
  senderCandidates({ key: { remoteJid: '111122223333444@lid', senderPn: '6281234567890@s.whatsapp.net' } }).sort(),
  ['111122223333444@lid', '6281234567890@s.whatsapp.net'],
);

assert.deepEqual(parseIdInputs('222233334444555').sort(), ['222233334444555@lid', '222233334444555@s.whatsapp.net']);
assert.deepEqual(parseIdInputs('6281200000000'), ['6281200000000@s.whatsapp.net']);
assert.deepEqual(parseIdInputs('111122223333444@lid'), ['111122223333444@lid']);

// whitelist
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-'));
const wl = new Whitelist(dir, ['6280000000001', '111122223333444']);
assert.ok(wl.isOwner(['6280000000001@s.whatsapp.net']));
assert.ok(wl.isOwner(['111122223333444@lid']));
assert.ok(!wl.isAllowed(['6281111111111@s.whatsapp.net']));
wl.add([parseIdInput('081111111111')], 'Pak Budi', 'admin');
assert.ok(wl.isAllowed(['6281111111111@s.whatsapp.net']));
// LID belajar otomatis
wl.learnAliases(['999888777666555@lid', '6281111111111@s.whatsapp.net']);
assert.ok(wl.isAllowed(['999888777666555@lid']));
// persist
const wl2 = new Whitelist(dir, []);
assert.ok(wl2.isAllowed(['999888777666555@lid']));
assert.equal(wl2.list()[0].name, 'Pak Budi');
// hapus by index
assert.ok(wl2.remove('1'));
assert.equal(wl2.list().length, 0);

// ban
wl2.add(['6282222222222@s.whatsapp.net'], 'X', 'self');
wl2.remove('6282222222222@s.whatsapp.net');
wl2.ban(['6282222222222@s.whatsapp.net']);
assert.ok(new Whitelist(dir, []).isBanned(['6282222222222@s.whatsapp.net']));

// format
assert.equal(toWhatsApp('**Penting** ya'), '*Penting* ya');
assert.equal(toWhatsApp('### Solusi'), '*Solusi*');
assert.equal(toWhatsApp('* satu\n* dua'), '• satu\n• dua');
assert.equal(toWhatsApp('ini *miring* dan **tebal**'), 'ini _miring_ dan *tebal*');
assert.equal(toWhatsApp('* **Mankozeb**: fungisida'), '• *Mankozeb*: fungisida');
assert.equal(splitMessage('a'.repeat(8000), 3500).length, 3);

console.log('✅ Semua tes lolos');
