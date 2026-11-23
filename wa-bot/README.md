# Sayur Etam — WhatsApp AI PPL Hortikultura (v2)

## Struktur
```
sayur-etam-bot/
├─ src/
│  ├─ index.js       # koneksi WA, alur pesan, antrian, rate limit
│  ├─ ai.js          # Gemini + timeout 12 dtk -> fallback, riwayat obrolan
│  ├─ commands.js    # !add !del !list !tamu !status !reset !menu
│  ├─ whitelist.js   # whitelist dinamis (data/whitelist.json)
│  ├─ jid.js         # normalisasi nomor HP & LID
│  ├─ format.js      # Markdown -> format WA, pecah pesan panjang
│  ├─ prompt.js      # PERSONA BOT (edit di sini untuk ubah gaya jawaban)
│  └─ config.js
├─ scripts/check.js  # cek sintaks sebelum restart
├─ scripts/test.js
├─ ecosystem.config.cjs
└─ .env.example
```

## Cara deploy (TANPA paste di terminal)

Masalah `SyntaxError: Unexpected end of input` terjadi karena paste di SSH terpotong.
Solusinya: **upload file**, jangan paste.

1. Di MobaXterm, buka panel **SFTP** (sidebar kiri, ikon bola dunia/folder) setelah SSH ke VPS.
2. Masuk ke folder home (mis. `/root`), lalu **drag & drop** `sayur-etam-bot.zip` ke situ.
3. Di terminal:
   ```bash
   cd ~ && unzip -o sayur-etam-bot.zip && cd sayur-etam-bot
   npm install --omit=dev
   cp .env.example .env
   nano .env            # isi GEMINI_API_KEY dan OWNER_IDS
   npm run check        # pastikan semua ✅
   npm test
   ```

### Pindahkan sesi WA lama (tidak perlu scan QR ulang)
Folder sesi sudah disamakan dengan bot lama (`sesi_wa_sayuretam`). Tinggal copy:
```bash
pm2 stop all                                   # matikan bot lama dulu!
cp -r ~/FOLDER_BOT_LAMA/sesi_wa_sayuretam ~/sayur-etam-bot/
```

### Jalankan
```bash
pm2 delete NAMA_BOT_LAMA           # hapus proses lama dari PM2
pm2 start ecosystem.config.cjs
pm2 save
pm2 logs sayur-etam                # kalau belum login, QR muncul di sini
```

### Update berikutnya
Upload ulang file yang berubah lewat SFTP (timpa), lalu:
```bash
cd ~/sayur-etam-bot && npm run check && pm2 restart sayur-etam
```
`npm run check` mencegah bot mati gara-gara file rusak/terpotong.

## Cara mendaftarkan orang (REGISTER_MODE=admin, default)
Bot jalan di nomor kamu. Orang yang belum kamu daftarkan **tidak dibalas sama sekali**.

**Cara 1 — paling gampang:** buka chat orangnya di HP kamu, ketik:
```
!add            atau   !add Pak Budi
```
→ pesan `!add` otomatis dihapus, orang itu menerima pesan sambutan, dan konfirmasinya masuk ke
chat *"Pesan ke diri sendiri"* (Message yourself) kamu. Mulai saat itu semua pertanyaan/fotonya dijawab Gemini.

Di chat orang itu juga bisa: `!del` (hapus), `!ban` (blokir), `!unban`, `!cek` (cek status).

**Cara 2 — panel admin:** buka chat *"Pesan ke diri sendiri"* (atau chat dari nomor admin lain di OWNER_IDS):

| Command | Fungsi |
|---|---|
| `!add 0812xxxx Nama` / `!add 1131...@lid Nama` | daftarkan lewat nomor/LID |
| `!tamu` lalu `!add #1 Nama` | daftarkan orang yang barusan chat tapi belum terdaftar |
| `!del 0812xxxx` / `!del 3` | hapus (nomor urut dari `!list`) |
| `!ban ...` / `!unban ...` | blokir / buka blokir |
| `!list` | daftar terdaftar |
| `!status` | uptime, model Gemini, model yang terakhir menjawab |
| `!tesai` | tes langsung ke kedua model Gemini |
| (pertanyaan biasa) | di chat diri sendiri kamu juga bisa tes tanya AI |

Untuk orang yang terdaftar: `!reset` (mulai obrolan baru), `!menu`, `!stop`.

## Memastikan jawaban dari Gemini
- Saat start, log menampilkan `Gemini OK: model "..." tersedia` atau `Gemini BERMASALAH`.
- Setiap jawaban tercatat di log: `Gemini menjawab model=... ms=...`.
- Urutan percobaan: model utama (12 dtk) → cadangan → model utama lagi. Tidak ada jawaban template;
  kalau ketiganya gagal baru bot minta maaf.
- Ketik `!tesai` dari nomor admin untuk tes kapan saja.

## Pengaturan `.env`
Lihat `.env.example`, semua sudah ada keterangannya (model, timeout, batas pesan per jam, ukuran foto, dll).
