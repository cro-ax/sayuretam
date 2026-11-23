// Whitelist dinamis tersimpan di data/whitelist.json
// Penulisan atomik (tulis ke .tmp lalu rename) supaya file tidak rusak kalau bot mati mendadak.
import fs from 'node:fs';
import path from 'node:path';
import { parseIdInputs } from './jid.js';

export class Whitelist {
  constructor(dataDir, ownerInputs = []) {
    this.file = path.join(dataDir, 'whitelist.json');
    fs.mkdirSync(dataDir, { recursive: true });
    this.owners = new Set(ownerInputs.flatMap(parseIdInputs));
    this.users = []; // { ids: [jid...], name, addedAt, addedBy }
    this.banned = []; // jid yang diblokir admin (tidak bisa daftar sendiri)
    this.index = new Map(); // jid -> user
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) return this.save();
      const json = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.users = Array.isArray(json.users) ? json.users : [];
      this.banned = Array.isArray(json.banned) ? json.banned : [];
    } catch (err) {
      // File rusak: simpan cadangan, mulai dari kosong (admin tetap bisa masuk lewat OWNER_IDS)
      const bak = `${this.file}.broken-${Date.now()}`;
      try { fs.copyFileSync(this.file, bak); } catch {}
      console.error(`[whitelist] Gagal baca whitelist.json, cadangan: ${bak}`, err.message);
      this.users = [];
    }
    this.reindex();
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ users: this.users, banned: this.banned }, null, 2));
    fs.renameSync(tmp, this.file);
  }

  reindex() {
    this.index.clear();
    for (const u of this.users) for (const id of u.ids) this.index.set(id, u);
  }

  isOwner(candidates) {
    return candidates.some((c) => this.owners.has(c));
  }

  find(candidates) {
    for (const c of candidates) {
      const u = this.index.get(c);
      if (u) return u;
    }
    return null;
  }

  isAllowed(candidates) {
    return this.isOwner(candidates) || !!this.find(candidates);
  }

  /** Tambah user. ids = array JID (nomor dan/atau LID orang yang sama). */
  add(ids, name, addedBy) {
    ids = [...new Set(ids.filter(Boolean))];
    if (ids.length === 0) return { ok: false, reason: 'ID tidak valid' };
    const existing = ids.map((i) => this.index.get(i)).find(Boolean);
    if (existing) {
      const before = existing.ids.length;
      existing.ids = [...new Set([...existing.ids, ...ids])];
      if (name) existing.name = name;
      this.reindex();
      this.save();
      return { ok: true, user: existing, updated: true, merged: existing.ids.length > before };
    }
    const user = { ids, name: name || '', addedAt: new Date().toISOString(), addedBy: addedBy || '' };
    this.users.push(user);
    this.reindex();
    this.save();
    return { ok: true, user, updated: false };
  }

  /** Hapus berdasarkan ID apa pun milik user tsb, atau nomor urut dari !list (1-based). */
  remove(idOrIndex) {
    let user = null;
    if (/^\d{1,3}$/.test(String(idOrIndex))) {
      user = this.users[Number(idOrIndex) - 1] || null;
    }
    if (!user) {
      user = parseIdInputs(idOrIndex).map((j) => this.index.get(j)).find(Boolean) || null;
    }
    if (!user) return null;
    this.users = this.users.filter((u) => u !== user);
    this.reindex();
    this.save();
    return user;
  }

  /**
   * Kalau user whitelist chat dengan ID baru (misal LID-nya ketahuan),
   * simpan ID itu supaya ke depan tetap dikenali walau WA hanya kirim LID.
   */
  learnAliases(candidates) {
    const user = this.find(candidates);
    if (!user) return false;
    const fresh = candidates.filter((c) => !user.ids.includes(c) && !this.index.has(c));
    if (fresh.length === 0) return false;
    user.ids.push(...fresh);
    this.reindex();
    this.save();
    return true;
  }

  isBanned(candidates) {
    return candidates.some((c) => this.banned.includes(c));
  }

  ban(ids) {
    this.banned = [...new Set([...this.banned, ...ids])];
    this.save();
  }

  unban(ids) {
    this.banned = this.banned.filter((b) => !ids.includes(b));
    this.save();
  }

  list() {
    return this.users;
  }
}
