/* Audit-package building blocks, all in plain JavaScript with no network: SHA-256
   fingerprints of input files, a zip writer, and an Excel (.xlsx) workbook writer. */
(function (root) {
  'use strict';

  const utf8 = s => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s) : Uint8Array.from(Buffer.from(s, 'utf8')));

  // ---------- SHA-256 (FIPS 180-4) ----------
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256(input) {
    const msg = typeof input === 'string' ? utf8(input) : input;
    const len = msg.length, total = Math.ceil((len + 9) / 64) * 64, buf = new Uint8Array(total);
    buf.set(msg); buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(len / 0x20000000)); dv.setUint32(total - 4, (len * 8) >>> 0);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64);
    const ror = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < total; o += 64) {
      for (let t = 0; t < 16; t++) W[t] = dv.getUint32(o + t * 4);
      for (let t = 16; t < 64; t++) {
        const s0 = ror(W[t - 15], 7) ^ ror(W[t - 15], 18) ^ (W[t - 15] >>> 3), s1 = ror(W[t - 2], 17) ^ ror(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + W[t]) >>> 0;
        const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return Array.from(H, x => x.toString(16).padStart(8, '0')).join('');
  }

  // ---------- Zip (stored, no compression) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  // files: [{ name, data: string | Uint8Array }] -> Uint8Array
  function zip(files, when) {
    const d = when || new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = utf8(f.name), data = typeof f.data === 'string' ? utf8(f.data) : f.data, crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, b) => s + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(all.reduce((s, b) => s + b.length, 0));
    let k = 0; for (const b of all) { out.set(b, k); k += b.length; }
    return out;
  }

  // ---------- Excel workbook (.xlsx) ----------
  const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  /* sheets: [{ name, rows: [[cell]] , header: true }]. Numbers stay numbers; the first row is
     bold and frozen when header is true. */
  function xlsx(sheets, meta) {
    meta = meta || {};
    const used = new Set();
    const safe = sheets.map((sh, i) => {
      let n = String(sh.name).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31).trim() || 'Sheet' + (i + 1);
      while (used.has(n.toLowerCase())) n = n.slice(0, 28) + ' ' + (i + 1);
      used.add(n.toLowerCase());
      return n;
    });
    const sheetXml = sh => {
      const rows = sh.rows || [];
      const ncol = Math.max(1, ...rows.map(r => r.length));
      const widths = Array.from({ length: ncol }, (_, c) => Math.min(60, Math.max(8, ...rows.slice(0, 200).map(r => String(r[c] === undefined || r[c] === null ? '' : r[c]).length + 2))));
      const head = sh.header !== false && rows.length > 1;
      let out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
      if (head) out += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
      out += '<cols>' + widths.map((w, c) => '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols><sheetData>';
      rows.forEach((r, ri) => {
        out += '<row r="' + (ri + 1) + '">';
        r.forEach((v, ci) => {
          if (v === null || v === undefined || v === '') return;
          const ref = colName(ci) + (ri + 1), st = head && ri === 0 ? ' s="1"' : '';
          if (typeof v === 'number' && isFinite(v)) out += '<c r="' + ref + '"' + st + '><v>' + v + '</v></c>';
          else out += '<c r="' + ref + '" t="inlineStr"' + st + '><is><t xml:space="preserve">' + xml(v) + '</t></is></c>';
        });
        out += '</row>';
      });
      return out + '</sheetData></worksheet>';
    };
    const files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' + sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
      { name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + xml(meta.title || 'KBI BOSS results') + '</dc:title><dc:creator>KBI BOSS</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') + '</dcterms:created></cp:coreProperties>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + safe.map((n, i) => '<sheet name="' + xml(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' }
    ].concat(sheets.map((sh, i) => ({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(sh) })));
    return zip(files);
  }

  // ---------- Audit trail and results workbook ----------
  const APP_VERSION = '2.0.0';
  const r4 = v => (typeof v === 'number' && isFinite(v) ? Number(v.toPrecision(6)) : v === undefined || v === null || (typeof v === 'number' && !isFinite(v)) ? '' : v);
  const yes = b => (b ? 'Yes' : 'No');

  /* What was done, by whom (the tool) and to which inputs, so a reviewer can retrace the run.
     ctx: { sources: [{name, bytes, rows, cols, sha256}], merge, options, when (Date), scenarios, design }.
     Returns sections: [{ title, rows: [[label, value]] }]. */
  function trail(rep, ctx) {
    ctx = ctx || {};
    const o = ctx.options || {}, when = ctx.when || new Date(), S = [];
    S.push({ title: 'Run', rows: [
      ['Tool', 'KBI BOSS ' + APP_VERSION + ' — KBI Biopharma Optimization Statistics Suite (static web page, runs entirely in the browser)'],
      ['Generated', when.toISOString()],
      ['Local time', when.toString()],
      ['Random seed', rep.seed || 42],
      ['Reproducible', 'Yes: the same files, settings and seed give the same models and numbers.']
    ] });
    S.push({ title: 'Input files', rows: (ctx.sources || []).map((f, i) => ['File ' + (i + 1), f.name + ' · ' + f.rows + ' rows × ' + f.cols + ' columns · ' + f.bytes + ' bytes · SHA-256 ' + f.sha256]) });
    if (ctx.merge) {
      const m = ctx.merge;
      S.push({ title: 'Merge (join)', rows: [
        ['Join', (m.how === 'left' ? 'Keep every row of ' : 'Only keys found in both: ') + m.left + ' + ' + m.right],
        ['Keys', m.left + '.' + m.leftKey + ' = ' + m.right + '.' + m.rightKey + ' (trimmed, case ignored)'],
        ['Rows', m.leftRows + ' + ' + m.rightRows + ' → ' + m.outputRows + ' (' + m.matchedKeys + ' of ' + m.rightKeys + ' keys matched)'],
        ['Unmatched in file 1', m.unmatchedLeft.length ? m.unmatchedLeft.length + ': ' + m.unmatchedLeft.slice(0, 20).join(', ') + (m.unmatchedLeft.length > 20 ? ' …' : '') : 'None'],
        ['Unmatched in file 2', m.unmatchedRight.length ? m.unmatchedRight.length + ': ' + m.unmatchedRight.slice(0, 20).join(', ') + (m.unmatchedRight.length > 20 ? ' …' : '') : 'None'],
        ['Replicates', m.repeatedKeys ? m.repeatedKeys + ' keys had repeat rows; numbers were averaged, text kept as "a | b"' : 'None'],
        ['Dropped replicate counters', m.droppedReplicateColumns.join(', ') || 'None'],
        ['Renamed columns', m.renamed.join(', ') || 'None']
      ] });
    }
    const analysis = [
      ['Data analyzed', rep.profile.nRows + ' rows × ' + rep.profile.nCols + ' columns'],
      ['Target', rep.target || 'None (unsupervised)'],
      ['Problem type', rep.task],
      ['Goal', rep.goal === 'min' ? 'Lower is better' : rep.task === 'regression' ? 'Higher is better' : String(rep.goal)],
      ['Inputs used', rep.features.join(', ')],
      ['Set aside', rep.dropped.map(d => d.name + ' (' + d.reason + ')').join('; ') || 'None']
    ];
    /* Which inputs were not one-hot encoded. A reviewer reading an importance or a
       coefficient for one of these is reading a frequency and a smoothed level average, not
       a level switch, and has no way to know that unless it is written down. */
    if (rep.encoding && rep.encoding.length) analysis.push(['Many-levelled inputs',
      rep.encoding.map(e => e.name + ' (' + e.levels + ' levels)').join('; ') +
      ' \u2014 carried as how common each level is and the level average of the result, smoothed towards the overall average, and rebuilt inside every fold so no fold sees its own rows']);
    if (rep.leaks && rep.leaks.length) analysis.push(['Leakage check', rep.leaks.map(l => l.name + ': ' + l.why).join('; ')]);
    else if (rep.target) analysis.push(['Leakage check', 'Passed: no single input reproduces the target almost perfectly.']);
    if (rep.best) {
      analysis.push(['Validation', (rep.folds === rep.nUsed ? 'Leave-one-out' : rep.folds + '-fold') + ' cross-validation: every score is on rows the model did not see']);
      analysis.push(['Models compared', rep.leaderboard.length]);
      analysis.push(['Chosen model', rep.best.name + ': ' + rep.bestReason]);
      analysis.push(['Selection rule', 'Highest cross-validated score; among models within 0.01 of it, the simplest']);
    }
    if (o.sixSigma) analysis.push(['Six Sigma mode', 'LSL ' + (o.sixSigma.lsl ?? '–') + ', USL ' + (o.sixSigma.usl ?? '–') + ', target ' + (o.sixSigma.target ?? '–') + ', rows in time order: ' + yes(o.sixSigma.timeOrdered !== false)]);
    if (ctx.stability) {
      const st = ctx.stability;
      analysis.push(['Shelf life (ICH Q1E)', 'Reported ' + st.reported.toFixed(2) + ' months (statistical ' + st.shelfLife.toFixed(2) + (st.capped ? ', capped by the extrapolation rule' : '') + ')']);
      analysis.push(['Shelf-life basis', st.modelLabel + '; ' + Math.round(st.confidence * 100) + '% one-sided limit against ' + (st.lsl !== null ? 'LSL ' + st.lsl : '') + (st.lsl !== null && st.usl !== null ? ' and ' : '') + (st.usl !== null ? 'USL ' + st.usl : '') + '; pooling tested at ' + st.poolAlpha + '; limiting batch ' + st.limiting]);
    }
    if (ctx.golden) {
      const g = ctx.golden;
      const bad = g.batches.filter(b => b.verdict === 'alarm');
      analysis.push(['Multivariate batch monitoring', g.batches.length + ' batches against ' + g.reference.length + ' reference batches on ' + g.variables.length + ' sensors; ' + g.components + ' components covering ' + Math.round(g.varianceCovered * 100) + '% of normal variation; ' + bad.length + ' flagged' + (bad.length ? ' (' + bad.map(b => b.name).join(', ') + ')' : '')]);
    }
    if (ctx.tost) {
      const tt = ctx.tost;
      analysis.push(['Method equivalence (TOST)', tt.test + ' vs ' + tt.reference + ': ' + tt.verdict + ', difference ' + r4(tt.diff) + ' with a ' + Math.round(tt.confidence * 100) + '% interval of ' + r4(tt.ciLow) + ' to ' + r4(tt.ciHigh) + ' against a margin of ' + r4(tt.margin)]);
    }
    if (ctx.variance) {
      const vv = ctx.variance;
      if (vv.kind === 'components') {
        analysis.push(['Variance components', vv.N + ' measurements across ' + vv.groups + ' groups of "' + vv.columns.group + '"; between-group share ' + Math.round(vv.icc * 100) + '%, total std dev ' + r4(vv.sdTotal) + '; ANOVA p ' + r4(vv.p) + (vv.negative ? '; the between-group estimate was negative and is reported as zero' : '')]);
        analysis.push(['Pairwise comparisons', 'Tukey at alpha ' + vv.alpha + ' (critical q ' + r4(vv.qCrit) + '); ' + vv.differing + ' of ' + vv.pairs.length + ' pairs differ' + (vv.balanced ? '' : '; unbalanced design, effective replication ' + r4(vv.n0))]);
      } else {
        analysis.push(['Measurement system analysis', vv.parts + ' samples x ' + vv.operators + ' operators x ' + vv.reps + ' repeats; ' + vv.model + ' (interaction p ' + r4(vv.pInteraction) + ')']);
        analysis.push(['Gage R&R verdict', vv.verdict + ' at ' + r4(vv.judgedOn === 'tolerance' ? vv.pctTolerance : vv.pctStudyGrr) + '% of ' + vv.judgedOn + (vv.tolerance !== null ? ' (LSL ' + vv.lsl + ', USL ' + vv.usl + ')' : '') + '; ' + (vv.ndc === null ? 'distinct categories not finite' : vv.ndc + ' distinct categories')]);
      }
    }
    if (ctx.tolerance) {
      const tv = ctx.tolerance;
      if (tv.kind === 'tolerance') {
        analysis.push(['Tolerance interval', tv.n + ' results from "' + tv.column + '"; ' + Math.round(tv.p * 1000) / 10 + '% coverage at ' + Math.round(tv.conf * 100) + '% confidence, ' + (tv.sided === 1 ? tv.bound + ' bound only' : 'two sided') + '; k ' + r4(tv.k) + ' against ' + r4(tv.limitingK) + ' for a known sigma']);
        analysis.push(['Limits supported by the data', (tv.lower === null ? '' : 'lower ' + r4(tv.lower)) + (tv.lower !== null && tv.upper !== null ? ', ' : '') + (tv.upper === null ? '' : 'upper ' + r4(tv.upper)) +
          (tv.inside === null ? '; no specification limits were given to compare against' : tv.inside ? '; the specification in force is supported' : '; the specification in force is NOT supported' + (tv.achievable === false ? ' and no sample size would support it' : tv.needed ? ' but about ' + tv.needed + ' results would' : ''))]);
        analysis.push(['Normality of the results', tv.normalityP === null ? 'not tested (too few results); the interval assumes a normal distribution' : 'Anderson-Darling p ' + r4(tv.normalityP) + ' (statistic ' + r4(tv.normalityStat) + '), ' + (tv.normal ? 'no evidence against normality' : 'NORMALITY DOUBTFUL, so the limits are provisional')]);
      } else {
        const o = tv.opt || {};
        analysis.push(['Sample size calculation', (tv.design === 'tost' ? 'equivalence by two one-sided tests' : tv.design === 'two' ? 'difference between two groups' : 'one group against a target') +
          '; assumed standard deviation ' + r4(o.sd) + ', alpha ' + o.alpha + ', target power ' + tv.target +
          (tv.design === 'tost' ? ', margin ' + r4(o.margin) + ', expected difference ' + r4(o.diff) + (o.paired ? ', paired' : ', unpaired') : ', difference to detect ' + r4(o.delta))]);
        analysis.push(['Sample size required', (tv.n === null ? 'not reachable at any realistic size' : tv.n + (tv.design === 'one' ? ' in total' : ' per group')) + (tv.n === null ? '' : ', giving power ' + r4(tv.power))]);
      }
    }
    if (rep.desirability) analysis.push(['Multi-result optimization', rep.desirability.specs.map(sp => sp.name + ' ' + sp.goal + ' [' + sp.low + ', ' + sp.high + ']' + (sp.target !== null ? ' target ' + sp.target : '') + ' weight ' + sp.weight).join('; ')]);
    S.push({ title: 'Analysis settings', rows: analysis });
    S.push({ title: 'Agent log', rows: (rep.log || []).map((l, i) => [String(i + 1), l.text]) });
    S.push({ title: 'Data handling', rows: [
      ['Where computed', 'In this browser tab only. The page has no network permission (Content Security Policy connect-src \'none\').'],
      ['Sent anywhere', 'No. No server, cloud service or AI/LLM received the data.'],
      ['Stored', 'No. Nothing was written to browser storage or cookies; closing the tab or pressing Delete erases it.'],
      ['This package', 'Is your own file. Store, share and delete it under your data policy.']
    ] });
    S.push({ title: 'Review and approval', rows: [
      ['Status', 'Decision-support analysis. Not a validated GxP system: confirm conclusions with a controlled trial before changing a process.'],
      ['Analyst', '______________________  Date __________'],
      ['Reviewer', '______________________  Date __________'],
      ['Approver', '______________________  Date __________']
    ] });
    return S;
  }
  const trailText = S => S.map(s => '== ' + s.title + ' ==\n' + s.rows.map(r => r[0] + ': ' + r[1]).join('\n')).join('\n\n') + '\n';

  // Workbook sheets for the results. Numbers stay numbers so reviewers can re-check them.
  function sheets(rep, ctx) {
    ctx = ctx || {};
    const out = [];
    const T = trail(rep, ctx);
    out.push({ name: 'Summary', rows: [['Item', 'Value']].concat(T[0].rows, T.find(s => s.title === 'Analysis settings').rows, (rep.insights || []).map((x, i) => ['Finding ' + (i + 1), x.text])) });
    out.push({ name: 'Audit trail', rows: [['Section', 'Item', 'Value']].concat(...T.map(s => s.rows.map(r => [s.title, r[0], r[1]]))) });
    const used = new Set(rep.features), dropped = {}; rep.dropped.forEach(d => { dropped[d.name] = d.reason; });
    out.push({ name: 'Columns', rows: [['Column', 'Type', 'Role', 'Used as', 'Missing', 'Distinct', 'Min', 'Median', 'Max', 'Mean', 'Std dev']].concat(rep.profile.columns.map(c => {
      const st = c.stats || {};
      return [c.name, c.kind, rep.roles && rep.roles[c.name] ? rep.roles[c.name].label : '', c.name === rep.target ? 'Target' : used.has(c.name) ? 'Input' : 'Set aside: ' + (dropped[c.name] || ''), c.missing, c.unique, r4(st.min), r4(st.median), r4(st.max), r4(st.mean), r4(st.sd)];
    })) });
    if (rep.leaderboard) {
      const reg = rep.task === 'regression';
      out.push({ name: 'Models', rows: [reg ? ['Model', 'R² (unseen rows)', 'RMSE', 'MAE', 'Chosen', 'Note'] : ['Model', 'Accuracy (unseen rows)', 'Balanced accuracy', 'Macro F1', 'Chosen', 'Note']].concat(rep.leaderboard.map(m => m.metrics
        ? (reg ? [m.name, r4(m.metrics.r2), r4(m.metrics.rmse), r4(m.metrics.mae)] : [m.name, r4(m.metrics.accuracy), r4(m.metrics.balancedAccuracy), r4(m.metrics.macroF1)]).concat([m === rep.best ? 'Yes' : '', m.plain])
        : [m.name, '', '', '', '', 'Failed: ' + m.error])) });
    }
    if (rep.importance && rep.importance.length) out.push({ name: 'Drivers', rows: [['Input', 'Importance (score drop when scrambled)', 'Share of total']].concat(rep.importance.map(v => [v.name, r4(v.importance), r4(v.share)])) });
    if (rep.actionPlan && rep.actionPlan.items.length) out.push({ name: 'Action plan', rows: [['Step', 'Action', 'What to do', 'Expected impact']].concat(rep.actionPlan.items.map((i, k) => [k + 1, i.verb, i.text, i.impactText || ''])).concat([[], ['Confidence', rep.actionPlan.confidence], ['Caveat', rep.actionPlan.caveat]]) });
    const c = rep.spc && rep.spc.capability;
    if (c) out.push({ name: 'Capability', rows: [['Statistic', 'Value']].concat([['n', c.n], ['Mean', r4(c.mean)], ['Std dev (overall)', r4(c.sdOverall)], ['Std dev (within, MR-bar/1.128)', r4(c.sdWithin)], ['LSL', r4(c.lsl)], ['USL', r4(c.usl)], ['Target', r4(c.target)],
      ['Cp', r4(c.Cp)], ['Cpk', r4(c.Cpk)], ['Pp', r4(c.Pp)], ['Ppk', r4(c.Ppk)], ['Cpm', r4(c.Cpm)], ['Z.bench', r4(c.zBench)], ['Sigma level (with 1.5 shift)', r4(c.sigmaLevel)], ['Expected PPM out of spec', r4(c.ppm)], ['Observed out of spec', c.observedOut], ['Taguchi loss (vs a unit at the limit)', r4(c.loss)], ['Verdict', c.verdict || '']]) });
    const im = rep.spc && rep.spc.imr;
    if (im) out.push({ name: 'Control chart', rows: [['Row in file', 'Value', 'Moving range', 'Center line', 'UCL', 'LCL', 'Signals']].concat(im.y.map((v, i) => [im.rowNums[i], r4(v), r4(im.mr[i]), r4(im.cl), r4(im.ucl), r4(im.lcl), im.flags[i].join('; ')])) });
    const a = rep.spc && rep.spc.attribute;
    if (a) out.push({ name: 'Sigma level', rows: [['Statistic', 'Value'], ['Units', a.total], ['Defects', a.defects], ['Yield', r4(a.yield)], ['DPMO', r4(a.dpmo)], ['Sigma level', r4(a.sigmaLevel)]] });
    const d = rep.desirability;
    if (d) {
      const rows = [['Result', 'Goal', 'Low', 'Target', 'High', 'Weight', 'Model', 'Model R²', 'Typical prediction', 'Typical d', 'Compromise prediction', 'Compromise d']];
      d.specs.forEach((sp, j) => rows.push([sp.name, sp.goal, sp.low, sp.target === null ? '' : sp.target, sp.high, sp.weight, d.models[j].model, r4(d.models[j].r2), r4(d.typical.ys[j]), r4(d.typical.ds[j]), r4(d.best.ys[j]), r4(d.best.ds[j])]));
      rows.push([], ['Overall D', '', '', '', '', '', '', '', '', r4(d.typical.D), '', r4(d.best.D)], [], ['Input', 'Typical setting', 'Compromise setting', 'Search low', 'Search high']);
      d.vars.forEach(v => rows.push([v.name, r4(d.typical.values[v.name]), r4(d.best.values[v.name]), v.kind === 'num' ? r4(v.lo) : '', v.kind === 'num' ? r4(v.hi) : '']));
      out.push({ name: 'Desirability', rows });
    }
    if (rep.doe) out.push({ name: 'DOE effects', rows: [['Term', 'Effect (low to high)', 'Coefficient', 'Std error', 't', 'p']].concat(rep.doe.effects.map(e => [e.name, r4(e.effect), r4(e.coef), r4(e.se), r4(e.t), r4(e.p)])) });
    if (ctx.stability) {
      const st = ctx.stability;
      const rows = [['Item', 'Value'], ['Run at', st.when], ['Model used', st.modelLabel], ['Reason', st.why],
        ['Time column', st.columns.time], ['Batch column', st.columns.batch], ['Result column', st.columns.result],
        ['Storage condition kept', st.columns.conditionValue || 'all rows'],
        ['Lower specification limit', st.lsl === null ? '' : st.lsl], ['Upper specification limit', st.usl === null ? '' : st.usl],
        ['Attribute direction', st.direction], ['Confidence', Math.round(st.confidence * 100) + '% one-sided'], ['Poolability level', st.poolAlpha],
        ['Measurements', st.measurements], ['Months of data', st.maxTime], ['Q1E extrapolation cap', st.allowed],
        ['Limiting batch', st.limiting], ['Shelf life (statistical)', r4(st.shelfLife)], ['Shelf life (reported)', r4(st.reported)], [],
        ['Poolability test', 'F', 'df1', 'df2', 'p', 'Outcome']];
      st.tests.forEach(t => rows.push([t.name, r4(t.f), t.df1, t.df2, r4(t.p), t.pass ? 'may be pooled' : 'kept separate']));
      rows.push([], ['Batch', 'Points', 'First month', 'Last month', 'Slope per month', 'Value at t=0', 'R2', 'Shelf life alone']);
      st.batches.forEach(b => rows.push([b.name, b.n, r4(b.first), r4(b.last), r4(b.slope), r4(b.intercept), r4(b.r2), r4(b.alone)]));
      out.push({ name: 'Shelf life', rows });
    }
    if (ctx.golden) {
      const g = ctx.golden;
      const rows = [['Item', 'Value'], ['Run at', g.when], ['Batch column', g.columns.batch], ['Time column', g.columns.time],
        ['Sensors', g.variables.join('; ')], ['Reference batches', g.reference.join('; ')],
        ['Aligned on', g.align === 'percent' ? 'percent of batch length' : 'elapsed time'],
        ['Principal components', g.components], ['Normal variation covered', r4(g.varianceCovered)],
        ['Alarm limit', g.limit], ['Limits calibrated on', g.calibration],
        ['T2 limit', r4(g.t2Limit)], ['Q limit', r4(g.qLimit)], [],
        ['Batch', 'Reference', 'Verdict', 'Points out', 'Points scored', 'Alarm at', 'Driven by', 'Worst T2', 'Worst Q']];
      g.batches.forEach(b => rows.push([b.name, b.isRef ? 'yes' : 'no', b.verdict, b.flagged, b.scored, b.alarmAt === null ? '' : r4(b.alarmAt), b.alarmBy || '', r4(b.maxT2), r4(b.maxQ)]));
      out.push({ name: 'Batch monitoring', rows });
    }
    if (ctx.tost) {
      const tt = ctx.tost;
      out.push({ name: 'Method equivalence', rows: [['Item', 'Value'], ['Run at', tt.when], ['Reference method', tt.reference], ['Method under test', tt.test], ['Design', tt.design],
        ['Method column', tt.columns.group], ['Result column', tt.columns.value], ['Sample identifier', tt.columns.sample || ''],
        ['Equivalence margin', r4(tt.margin)], ['Margin quoted as', tt.marginType === 'percent' ? tt.marginInput + '% of the reference mean' : 'absolute units'],
        ['Significance level (one sided)', tt.alpha], ['Interval', Math.round(tt.confidence * 100) + '%'],
        ['Reference n / mean / sd', tt.refStats.n + ' / ' + r4(tt.refStats.mean) + ' / ' + r4(tt.refStats.sd)],
        ['Test n / mean / sd', tt.testStats.n + ' / ' + r4(tt.testStats.mean) + ' / ' + r4(tt.testStats.sd)],
        ['Mean difference', r4(tt.diff)], ['Standard error', r4(tt.se)], ['Degrees of freedom', r4(tt.df)],
        ['Interval lower', r4(tt.ciLow)], ['Interval upper', r4(tt.ciHigh)], ['Margin used up', r4(tt.bandUsed)],
        ['p, difference above minus margin', r4(tt.p1)], ['p, difference below plus margin', r4(tt.p2)], ['Overall TOST p', r4(tt.pTost)],
        ['Two-sided p for any difference', r4(tt.pDiff)], ['Verdict', tt.verdict],
        ['Results per method that would settle it', tt.needed === null ? '' : tt.needed]] });
    }
    if (ctx.variance) {
      const vv = ctx.variance;
      if (vv.kind === 'components') {
        const rows = [['Item', 'Value'], ['Run at', vv.when], ['Grouping column', vv.columns.group], ['Result column', vv.columns.value],
          ['Groups', vv.groups], ['Measurements', vv.N], ['Balanced', vv.balanced ? 'yes' : 'no'], ['Effective replication (n0)', r4(vv.n0)],
          ['Between-group variance', r4(vv.between)], ['Within-group variance', r4(vv.within)],
          ['Total variance', r4(vv.total)], ['Total std dev', r4(vv.sdTotal)],
          ['Between-group share', r4(vv.icc)], ['Negative estimate reported as zero', vv.negative ? 'yes' : 'no'],
          ['ANOVA p', r4(vv.p)], ['Pairwise alpha', vv.alpha], ['Tukey critical q', r4(vv.qCrit)], [],
          ['Source', 'Sum of squares', 'df', 'Mean square', 'F', 'p']];
        vv.anova.forEach(a => rows.push([a.source, r4(a.ss), a.df, r4(a.ms), a.f === null ? '' : r4(a.f), a.p === null ? '' : r4(a.p)]));
        rows.push([], ['Component', 'Variance', 'Std dev', 'Share of variance']);
        vv.components.forEach(c => rows.push([c.source, r4(c.variance), r4(c.sd), r4(c.share)]));
        rows.push([], ['Group', 'Measurements', 'Mean', 'Std dev']);
        vv.groupStats.forEach(g => rows.push([g.name, g.n, r4(g.mean), isFinite(g.sd) ? r4(g.sd) : '']));
        rows.push([], ['Pair A', 'Pair B', 'Difference', 'Interval lower', 'Interval upper', 'p', 'Different']);
        vv.pairs.forEach(x => rows.push([x.a, x.b, r4(x.diff), r4(x.lower), r4(x.upper), r4(x.p), x.different ? 'yes' : 'no']));
        out.push({ name: 'Variance components', rows });
      } else {
        const rows = [['Item', 'Value'], ['Run at', vv.when], ['Sample column', vv.columns.part], ['Operator column', vv.columns.operator], ['Result column', vv.columns.value],
          ['Samples', vv.parts], ['Operators', vv.operators], ['Repeats per cell', vv.reps], ['Measurements', vv.N],
          ['Model', vv.model], ['Interaction p', r4(vv.pInteraction)],
          ['Lower spec limit', vv.lsl === null ? '' : vv.lsl], ['Upper spec limit', vv.usl === null ? '' : vv.usl], ['Tolerance', vv.tolerance === null ? '' : r4(vv.tolerance)],
          ['%GRR of study variation', r4(vv.pctStudyGrr)], ['%GRR of tolerance', vv.pctTolerance === null ? '' : r4(vv.pctTolerance)],
          ['Distinct categories', vv.ndc === null ? '' : vv.ndc], ['Judged on', vv.judgedOn], ['Verdict', vv.verdict], [],
          ['Source', 'Sum of squares', 'df', 'Mean square', 'F', 'p']];
        vv.anova.forEach(a => rows.push([a.source, r4(a.ss), a.df, a.df === 0 ? '' : r4(a.ms), a.f === null ? '' : r4(a.f), a.p === null ? '' : r4(a.p)]));
        rows.push([], ['Component', 'Variance', 'Std dev', 'Share of variance', '% of total spread']);
        vv.components.forEach(c => rows.push([c.source, r4(c.variance), r4(c.sd), r4(c.share), r4(c.pctStudy)]));
        out.push({ name: 'Measurement system', rows });
      }
    }
    if (ctx.tolerance) {
      const tv = ctx.tolerance;
      if (tv.kind === 'tolerance') {
        out.push({ name: 'Tolerance limits', rows: [['Item', 'Value'], ['Run at', tv.when], ['Result column', tv.column],
          ['Results', tv.n], ['Mean', r4(tv.mean)], ['Standard deviation', r4(tv.sd)], ['Degrees of freedom', tv.df],
          ['Proportion covered', tv.p], ['Confidence', tv.conf], ['Limits', tv.sided === 1 ? tv.bound + ' only' : 'two sided'],
          ['Tolerance factor k', r4(tv.k)], ['Factor if sigma were known', r4(tv.limitingK)],
          ['Lower tolerance limit', tv.lower === null ? '' : r4(tv.lower)], ['Upper tolerance limit', tv.upper === null ? '' : r4(tv.upper)],
          ['Lowest result', r4(tv.min)], ['Highest result', r4(tv.max)],
          ['Specification lower', tv.lsl === null ? '' : tv.lsl], ['Specification upper', tv.usl === null ? '' : tv.usl],
          ['Specification supported', tv.inside === null ? 'not assessed' : tv.inside ? 'yes' : 'no'],
          ['Results that would suffice', tv.achievable === false ? 'none at any sample size' : tv.needed === null ? '' : tv.needed],
          ['Anderson-Darling statistic', tv.normalityStat === null ? '' : r4(tv.normalityStat)],
          ['Normality p-value', tv.normalityP === null ? 'not tested' : r4(tv.normalityP)]] });
      } else {
        const o = tv.opt || {};
        const rows = [['Item', 'Value'], ['Run at', tv.when],
          ['Question', tv.design === 'tost' ? 'equivalence by two one-sided tests' : tv.design === 'two' ? 'difference between two groups' : 'one group against a target'],
          ['Standard deviation assumed', r4(o.sd)], ['Significance level', o.alpha], ['Target power', tv.target]];
        if (tv.design === 'tost') rows.push(['Equivalence margin', r4(o.margin)], ['Difference expected', r4(o.diff)], ['Paired', o.paired ? 'yes' : 'no']);
        else rows.push(['Difference to detect', r4(o.delta)]);
        rows.push(['Results needed', tv.n === null ? 'not reachable' : tv.n], ['Power at that size', tv.n === null ? '' : r4(tv.power)], []);
        rows.push(['Results per group', 'Power']);
        (tv.curve || []).forEach(c => rows.push([c[0], r4(c[1])]));
        out.push({ name: 'Sample size', rows });
      }
    }
    if (ctx.scenarios && ctx.scenarios.rows.length) out.push({ name: 'What-if scenarios', rows: [ctx.scenarios.header].concat(ctx.scenarios.rows) });
    if (ctx.design) out.push({ name: 'DOE run sheet', rows: [['RunOrder', 'StdOrder'].concat(ctx.design.factors.map(f => f.name), [ctx.design.response])].concat(ctx.design.design.runs.map(r => [r.run, r.std].concat(r.actual.map(v => (typeof v === 'number' ? v : isFinite(Number(v)) && v !== '' ? Number(v) : v)), ['']))) });
    if (ctx.table && ctx.table.rows.length <= 50000) out.push({ name: 'Data analyzed', rows: [ctx.table.columns].concat(ctx.table.rows.map(r => r.map(v => (v !== '' && v !== null && isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : v)))) });
    return out;
  }

  root.MLAudit = { sha256, crc32, zip, xlsx, utf8, trail, trailText, sheets, APP_VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MLAudit;
})(typeof globalThis !== 'undefined' ? globalThis : this);
