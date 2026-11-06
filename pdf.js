/* A small PDF writer, so "Save as PDF" builds a real .pdf file inside the browser with no
   library and no network. Supports headings, wrapped text, bullet lists, tables, JPEG
   images and page numbers. Uses the standard Helvetica fonts that every PDF viewer has. */
(function (root) {
  'use strict';

  // Helvetica widths (per 1000 units) for character codes 32 to 126.
  const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
    667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
    278, 278, 278, 469, 556, 333,
    556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
    334, 260, 334, 584];
  const SWAP = { '−': '-', '–': '-', '—': '-', '≈': '~', '≤': '<=', '≥': '>=', '→': '->', '←': '<-', '↗': '', '…': '...', '‘': "'", '’': "'", '“': '"', '”': '"', '✓': '', '✗': 'x', '•': '·', '⁴': '^4', '³': '³', '✕': 'x', '⑂': '', '▾': '', ' ': ' ' };

  // Text in the PDF's single-byte (WinAnsi) encoding; unsupported characters are simplified.
  function ansi(s) {
    let out = '';
    for (const ch of String(s)) {
      const c = SWAP[ch] !== undefined ? SWAP[ch] : ch;
      for (const k of c) out += k.charCodeAt(0) < 256 ? k : '?';
    }
    return out;
  }
  function width(s, size, bold) {
    let w = 0;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); w += c >= 32 && c <= 126 ? W[c - 32] : 556; }
    return w / 1000 * size * (bold ? 1.07 : 1);
  }
  const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const rgb = c => c.map(v => (v / 255).toFixed(3)).join(' ');

  function wrap(text, size, bold, maxW) {
    maxW = Math.max(maxW, size); // always room for at least one character
    const lines = [];
    for (const para of ansi(text).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const tryLine = line ? line + ' ' + word : word;
        if (width(tryLine, size, bold) <= maxW) { line = tryLine; continue; }
        if (line) lines.push(line);
        // Break words longer than a whole line.
        let w = word;
        while (width(w, size, bold) > maxW) {
          let n = w.length;
          while (n > 1 && width(w.slice(0, n), size, bold) > maxW) n--;
          lines.push(w.slice(0, n)); w = w.slice(n);
        }
        line = w;
      }
      lines.push(line);
    }
    return lines;
  }

  function create(opt) {
    opt = opt || {};
    const PW = 595.28, PH = 841.89, M = 48, CW = PW - 2 * M;
    const INK = [23, 34, 43], MUTED = [86, 99, 108], LINE = [211, 216, 214];
    const pages = [], images = [];
    let cur = null, y = 0;

    function newPage() { cur = []; pages.push(cur); y = PH - M; }
    function ensure(h) { if (!cur || y - h < M + 16) newPage(); }
    function text(x, yy, s, size, font, color) { cur.push('BT /' + font + ' ' + size + ' Tf ' + rgb(color || INK) + ' rg ' + x.toFixed(2) + ' ' + yy.toFixed(2) + ' Td (' + esc(s) + ') Tj ET'); }
    function rect(x, yy, w, h, fill) { cur.push(rgb(fill) + ' rg ' + [x, yy, w, h].map(v => v.toFixed(2)).join(' ') + ' re f'); }
    function hline(x1, x2, yy, color) { cur.push(rgb(color || LINE) + ' RG 0.6 w ' + x1.toFixed(2) + ' ' + yy.toFixed(2) + ' m ' + x2.toFixed(2) + ' ' + yy.toFixed(2) + ' l S'); }

    const api = {
      // Block of wrapped text. o: { size, bold, italic, color, indent, gap, bullet, keep }
      p(s, o) {
        o = o || {};
        if (s === null || s === undefined || String(s).trim() === '') return api;
        const size = o.size || 10, lh = size * 1.35, indent = o.indent || 0, font = o.bold ? 'F2' : o.italic ? 'F3' : 'F1';
        const bulletW = o.bullet ? 12 : 0;
        const lines = wrap(s, size, o.bold, CW - indent - bulletW);
        if (o.keep) ensure(Math.min(lines.length, 3) * lh);
        lines.forEach((ln, i) => {
          ensure(lh);
          y -= lh;
          if (o.bullet && i === 0) text(M + indent, y, ansi(o.bullet), size, 'F2', o.bulletColor || o.color);
          text(M + indent + bulletW, y, ln, size, font, o.color);
        });
        y -= o.gap !== undefined ? o.gap : size * 0.5;
        return api;
      },
      h1(s) { ensure(60); api.p(s, { size: 20, bold: true, gap: 6 }); return api; },
      h2(s) { ensure(70); y -= 8; api.p(s, { size: 14, bold: true, gap: 2 }); hline(M, M + CW, y + 1); y -= 6; return api; },
      h3(s) { ensure(50); y -= 2; api.p(s, { size: 11.5, bold: true, gap: 3 }); return api; },
      muted(s, o) { return api.p(s, Object.assign({ size: 9, color: MUTED }, o)); },
      space(n) { y -= n; return api; },
      // A key line in a tinted band, for the action plan items.
      band(label, s, sub, color) {
        const size = 10, lh = 13.5, lines = wrap(s, size, true, CW - 92), subl = sub ? wrap(sub, 8.5, false, CW - 92) : [];
        const h = lines.length * lh + subl.length * 11.5 + 10;
        ensure(h + 6);
        rect(M, y - h, CW, h, [247, 248, 246]);
        rect(M + 6, y - 19, 72, 14, color || [44, 74, 94]);
        text(M + 10, y - 15.5, ansi(label).toUpperCase().slice(0, 12), 7.5, 'F2', [255, 255, 255]);
        let yy = y - 5;
        lines.forEach(ln => { yy -= lh; text(M + 86, yy + 3, ln, size, 'F2'); });
        subl.forEach(ln => { yy -= 11.5; text(M + 86, yy + 3, ln, 8.5, 'F1', MUTED); });
        y -= h + 6;
        return api;
      },
      // JPEG image: { bytes: Uint8Array, w: pixels, h: pixels }, drawn at most `maxW` points wide.
      image(img, maxW, maxH) {
        const w0 = Math.min(maxW || CW, CW), scale = Math.min(w0 / img.w, (maxH || 520) / img.h);
        const w = img.w * scale, h = img.h * scale;
        ensure(h + 6);
        let id = images.indexOf(img);
        if (id < 0) { images.push(img); id = images.length - 1; }
        y -= h;
        cur.push('q ' + w.toFixed(2) + ' 0 0 ' + h.toFixed(2) + ' ' + (M + (CW - w) / 2).toFixed(2) + ' ' + y.toFixed(2) + ' cm /Im' + id + ' Do Q');
        y -= 8;
        return api;
      },
      // rows: arrays of strings; the first row is the header.
      table(rows, o) {
        o = o || {};
        if (!rows.length) return api;
        const size = o.size || 8.5, lh = size * 1.3, pad = 4, n = Math.max(...rows.map(r => r.length));
        const natural = range(n).map(c => Math.max(24, ...rows.map(r => width(ansi(r[c] || ''), size, true) + 2 * pad)));
        const total = natural.reduce((a, b) => a + b, 0);
        let cw;
        if (total < CW) cw = natural.map(v => v + (CW - total) / n);
        else {
          // Short columns keep their width (up to 80 pt); long text shares what is left.
          const floor = natural.map(v => Math.min(v, 80)), spare = CW - floor.reduce((a, b) => a + b, 0), extra = total - floor.reduce((a, b) => a + b, 0);
          cw = natural.map((v, c) => (spare > 0 ? floor[c] + (v - floor[c]) / (extra || 1) * spare : v / total * CW));
        }
        const drawRow = (r, head) => {
          const cells = range(n).map(c => wrap(r[c] || '', size, head, cw[c] - 2 * pad));
          const h = Math.max(...cells.map(l => l.length)) * lh + 2 * pad;
          if (y - h < M + 16) { newPage(); if (!head) drawRow(rows[0], true); }
          if (head) rect(M, y - h, CW, h, [232, 235, 230]);
          let x = M;
          cells.forEach((lines, c) => { lines.forEach((ln, i) => text(x + pad, y - pad - (i + 1) * lh + 2.5, ln, size, head ? 'F2' : 'F1')); x += cw[c]; });
          y -= h; hline(M, M + CW, y);
        };
        ensure(lh * 3);
        drawRow(rows[0], true);
        rows.slice(1).forEach(r => drawRow(r, false));
        y -= 8;
        return api;
      },
      pageBreak() { newPage(); return api; },
      // Start a new page unless at least `h` points are left (keeps a heading with its chart).
      keep(h) { ensure(h); return api; },
      output() {
        const objs = [];
        const add = body => { objs.push(body); return objs.length; };
        const catalog = add(null), pagesId = add(null);
        const fonts = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique'].map(f => add('<< /Type /Font /Subtype /Type1 /BaseFont /' + f + ' /Encoding /WinAnsiEncoding >>'));
        const imgIds = images.map(im => add({ dict: '<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.bytes.length + ' >>', bytes: im.bytes }));
        const res = '<< /Font << /F1 ' + fonts[0] + ' 0 R /F2 ' + fonts[1] + ' 0 R /F3 ' + fonts[2] + ' 0 R >> /XObject << ' + imgIds.map((id, i) => '/Im' + i + ' ' + id + ' 0 R').join(' ') + ' >> >>';
        const pageIds = pages.map((ops, i) => {
          const foot = 'BT /F1 8 Tf ' + rgb(MUTED) + ' rg ' + M + ' 24 Td (' + esc(ansi(opt.footer || '')) + ') Tj ET BT /F1 8 Tf ' + (PW - M - 60) + ' 24 Td (' + esc('Page ' + (i + 1) + ' of ' + pages.length) + ') Tj ET';
          const stream = ops.join('\n') + '\n' + foot;
          const cid = add({ dict: '<< /Length ' + stream.length + ' >>', text: stream });
          return add('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources ' + res + ' /Contents ' + cid + ' 0 R >>');
        });
        objs[catalog - 1] = '<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>';
        objs[pagesId - 1] = '<< /Type /Pages /Kids [' + pageIds.map(id => id + ' 0 R').join(' ') + '] /Count ' + pageIds.length + ' >>';
        const d = new Date(), pad2 = v => String(v).padStart(2, '0');
        const info = add('<< /Title (' + esc(ansi(opt.title || 'Report')) + ') /Producer (BOSS) /CreationDate (D:' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()) + ') >>');

        // Assemble bytes; every string here is single-byte, so length = byte count.
        const parts = [], offsets = [];
        let pos = 0;
        const put = s => { const b = typeof s === 'string' ? latin1(s) : s; parts.push(b); pos += b.length; };
        put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
        objs.forEach((o, i) => {
          offsets.push(pos);
          put((i + 1) + ' 0 obj\n');
          if (typeof o === 'string') put(o + '\n');
          else { put(o.dict + '\nstream\n'); put(o.bytes || o.text); put('\nendstream\n'); }
          put('endobj\n');
        });
        const xref = pos;
        put('xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
        put('trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
        const out = new Uint8Array(pos);
        let k = 0; for (const b of parts) { out.set(b, k); k += b.length; }
        return out;
      }
    };
    newPage();
    return api;
  }
  function range(n) { return Array.from({ length: n }, (_, i) => i); }
  function latin1(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }

  root.MLPdf = { create, ansi, wrap, width };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MLPdf;
})(typeof globalThis !== 'undefined' ? globalThis : this);
