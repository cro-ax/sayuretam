// Ubah Markdown keluaran Gemini menjadi format WhatsApp.
// WA: *tebal*  _miring_  ~coret~  ```mono```

export function toWhatsApp(md) {
  if (!md) return '';
  let t = String(md).replace(/\r\n/g, '\n');

  // Lindungi blok kode
  const codes = [];
  t = t.replace(/```[\s\S]*?```/g, (m) => {
    codes.push(m);
    return `\u0000C${codes.length - 1}\u0000`;
  });

  // Heading "### Judul" -> *Judul*
  t = t.replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm, (_, h) => `\u0001${h.replace(/\*\*/g, '')}\u0001`);

  // Bullet "* item" / "- item" -> "• item"
  t = t.replace(/^(\s*)[*-]\s+/gm, (_, sp) => `${sp}• `);

  // **tebal** / __tebal__ -> placeholder
  t = t.replace(/\*\*(.+?)\*\*/g, '\u0001$1\u0001');
  t = t.replace(/__(.+?)__/g, '\u0001$1\u0001');

  // *miring* (markdown) -> _miring_
  t = t.replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\w)/g, '$1_$2_');

  // ~~coret~~ -> ~coret~
  t = t.replace(/~~(.+?)~~/g, '~$1~');

  // Link [teks](url) -> teks (url)
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)');

  // Placeholder tebal -> *tebal*
  t = t.replace(/\u0001/g, '*');

  // Rapikan baris kosong berlebih
  t = t.replace(/\n{3,}/g, '\n\n').trim();

  // Kembalikan blok kode
  t = t.replace(/\u0000C(\d+)\u0000/g, (_, i) => codes[Number(i)]);
  return t;
}

/** Pecah teks panjang jadi beberapa pesan, potong di paragraf/baris. */
export function splitMessage(text, max = 3500) {
  if (text.length <= max) return [text];
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}
