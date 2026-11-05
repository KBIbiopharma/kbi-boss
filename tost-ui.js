/* Method-transfer equivalence panel: reads results from two methods, runs TOST, and shows
   the interval against the margin you declared. Nothing is uploaded or stored. */
(function () {
  'use strict';
  const E = window.MLEngine, T = window.MLTost, CH = window.Charts;
  const $ = id => document.getElementById(id);
  const h = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f2 = v => (isFinite(v) ? Number(v).toFixed(2) : '–');
  const f3 = v => (isFinite(v) ? Number(v).toFixed(3) : '–');
  const pFmt = p => (p === null || p === undefined || !isFinite(p) ? '–' : p < 0.0001 ? '<0.0001' : p.toFixed(4));

  let table = null, last = null;
  // Two-file layout: each side is parsed on its own, then stacked into the long table the
  // rest of the panel already works with, so nothing downstream has to know the difference.
  const sides = { a: null, b: null };
  const layout = () => $('eq-layout').value;

  function download(name, data, type) {
    const url = URL.createObjectURL(new Blob([data], { type: type + ';charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---------- reading the results ----------
  const GROUP = /method|lab|instrument|analyst|site|operator|system|group|site|column/i;
  const VALUE = /result|value|assay|purity|potency|conc|content|measure|area|response|%/i;
  const SAMPLE = /sample|specimen|lot|batch|vial|id$|^id/i;

  function loadText(text) {
    let t;
    try { t = E.parseTable(text); } catch (e) { return fail('Could not read the data: ' + e.message); }
    if (!t.rows.length || t.columns.length < 2) return fail('No usable rows found. The first row should hold column names.');
    table = t;
    const prof = E.profile(t);
    const numeric = prof.columns.filter(c => c.kind === 'numeric').map(c => c.name);
    const twoLevel = prof.columns.filter(c => c.unique >= 2 && c.unique <= 8 && c.kind !== 'numeric').map(c => c.name);
    const pick = (re, from, fallback) => from.find(c => re.test(c)) || fallback || '';
    const groupCol = pick(GROUP, twoLevel.length ? twoLevel : t.columns, twoLevel[0] || t.columns[0]);
    const valueCol = pick(VALUE, numeric, numeric[numeric.length - 1]) || '';
    const sampleCol = t.columns.filter(c => c !== groupCol && c !== valueCol).find(c => SAMPLE.test(c)) || '';
    const opt = (sel, cols, val, blank) => {
      $(sel).innerHTML = (blank ? '<option value="">(none)</option>' : '') + cols.map(c => '<option' + (c === val ? ' selected' : '') + '>' + h(c) + '</option>').join('');
    };
    opt('eq-group', t.columns, groupCol); opt('eq-value', t.columns, valueCol); opt('eq-sampleid', t.columns, sampleCol, true);
    /* The attribute column holds a handful of repeated names - Purity, Aggregate, Potency -
       so it looks like the method column does. It is picked by name first and then by that
       shape, excluding whichever column was already taken for the method. */
    if ($('eq-attr')) {
      const cand = t.columns.filter(c => c !== valueCol && c !== groupCol);
      const byShape = cand.filter(c => { const i = t.columns.indexOf(c); const u = new Set(t.rows.map(r => String(r[i]).trim())).size; return u >= 2 && u <= 40; });
      opt('eq-attr', t.columns, cand.find(c => ATTR.test(c)) || byShape[0] || cand[0] || valueCol);
      /* A dozen attributes in a dozen different units cannot share one margin: a 2.5% band is
         generous on a purity of 98% and a seventh of the noise on an aggregate of 1.1%. A real
         transfer protocol declares a margin per attribute, so the column is read if it is
         there, and the single margin below is only the fallback. */
      if ($('eq-margincol')) {
        const nums = prof.columns.filter(c => c.kind === 'numeric' && c.name !== valueCol).map(c => c.name);
        opt('eq-margincol', nums, nums.find(c => MARGIN.test(c)) || '', true);
      }
    }
    $('eq-settings').hidden = false;
    fillMethods();
    if ($('eq-what')) showWhat();
    describe();
  }

  const ATTR = /attribute|^cqa$|cqa|quality ?attribute|analyte|test|assay|parameter|measure(ment)?$|characteristic|method ?name|property/i;
  const MARGIN = /margin|acceptance|allowance|tolerance|limit|criterion|criteria|band/i;
  const multi = () => $('eq-what') && $('eq-what').value === 'multi';

  function showWhat() {
    const m = multi();
    if ($('eq-map-multi')) $('eq-map-multi').hidden = !m;
    if ($('eq-layout-wrap')) $('eq-layout-wrap').hidden = m;   // a transfer arrives as one long table
    if (m && $('eq-layout').value !== 'one') { $('eq-layout').value = 'one'; showLayout(); }
    ['eq-sample4', 'eq-sample5', 'eq-sample6'].forEach(id => { if ($(id)) $(id).hidden = !m; });
    ['eq-sample', 'eq-sample2', 'eq-sample3'].forEach(id => { if ($(id)) $(id).hidden = m; });
    $('eq-run').textContent = m ? 'Judge the whole transfer' : 'Test for equivalence';
    $('eq-out').innerHTML = ''; $('eq-error').hidden = true;
    if (table) describe();
  }

  /* One file per method is how the data usually arrives: each lab sends its own export.
     Both sides are stacked into a single long table with a Method column, which is exactly
     what the single-file layout produces, so the two paths meet here and never diverge. */
  function loadSide(which, text, name) {
    let t;
    try { t = E.parseTable(text, name); } catch (e) { return fail('Could not read that file: ' + e.message); }
    if (!t.rows.length) return fail('No rows found in that file.');
    const prof = E.profile(t);
    const numeric = prof.columns.filter(c => c.kind === 'numeric').map(c => c.name);
    const value = numeric.find(c => VALUE.test(c)) || numeric[numeric.length - 1] || t.columns[0];
    const sample = t.columns.filter(c => c !== value).find(c => SAMPLE.test(c)) || '';
    sides[which] = { table: t, value, sample };
    const opt = (sel, cols, val, blank) => { $(sel).innerHTML = (blank ? '<option value="">(none)</option>' : '') + cols.map(c => '<option' + (c === val ? ' selected' : '') + '>' + h(c) + '</option>').join(''); };
    opt('eq-' + which + '-value', t.columns, value);
    opt('eq-' + which + '-sample', t.columns, sample, true);
    $('eq-' + which + '-map').hidden = false;
    if (name && !$('eq-' + which + '-name').dataset.touched) $('eq-' + which + '-name').value = name.replace(/\.(csv|tsv|txt)$/i, '').slice(0, 40);
    $('eq-' + which + '-read').textContent = t.rows.length + ' rows, ' + t.columns.length + ' columns.';
    combineSides();
  }
  function combineSides() {
    if (!sides.a || !sides.b) { $('eq-settings').hidden = true; describe(); return; }
    const nameA = $('eq-a-name').value.trim() || 'Reference method';
    const nameB = $('eq-b-name').value.trim() || 'New method';
    if (nameA === nameB) return fail('Give the two methods different names.');
    const valueName = 'Result';
    const rows = [];
    const take = (side, label) => {
      const t = side.table, vi = t.columns.indexOf($('eq-' + (side === sides.a ? 'a' : 'b') + '-value').value);
      const si = $('eq-' + (side === sides.a ? 'a' : 'b') + '-sample').value ? t.columns.indexOf($('eq-' + (side === sides.a ? 'a' : 'b') + '-sample').value) : -1;
      t.rows.forEach(r => rows.push([label, vi >= 0 ? r[vi] : '', si >= 0 ? r[si] : '']));
    };
    take(sides.a, nameA); take(sides.b, nameB);
    table = { columns: ['Method', valueName, 'Sample'], rows };
    $('eq-group').innerHTML = '<option>Method</option>';
    $('eq-value').innerHTML = '<option>' + valueName + '</option>';
    $('eq-sampleid').innerHTML = '<option value="">(none)</option><option selected>Sample</option>';
    if (!rows.some(r => r[2] !== '')) $('eq-sampleid').value = '';
    $('eq-settings').hidden = false;
    $('eq-error').hidden = true;
    fillMethods();
    $('eq-ref').value = nameA; $('eq-test').value = nameB;
    $('eq-paired-wrap').hidden = !pairableCount();
    describe();
  }

  function showLayout() {
    const two = layout() === 'two';
    $('eq-one').hidden = two; $('eq-two').hidden = !two;
    // In the two-file layout the method and result columns are already decided per side.
    $('eq-map-one').hidden = two; $('eq-methods').hidden = two;
    table = null; sides.a = sides.b = null;
    $('eq-settings').hidden = true; $('eq-out').innerHTML = ''; $('eq-read').textContent = ''; $('eq-error').hidden = true;
    ['a', 'b'].forEach(w => { $('eq-' + w + '-map').hidden = true; $('eq-' + w + '-read').textContent = ''; });
  }

  function fillMethods() {
    if (!table) return;
    const gi = table.columns.indexOf($('eq-group').value);
    const labels = gi < 0 ? [] : Array.from(new Set(table.rows.map(r => String(r[gi]).trim()).filter(Boolean)));
    const prevRef = $('eq-ref').value, prevTest = $('eq-test').value;
    $('eq-ref').innerHTML = labels.map(l => '<option>' + h(l) + '</option>').join('');
    $('eq-test').innerHTML = labels.map(l => '<option>' + h(l) + '</option>').join('');
    if (labels.includes(prevRef)) $('eq-ref').value = prevRef; else $('eq-ref').value = labels[0] || '';
    if (labels.includes(prevTest) && prevTest !== $('eq-ref').value) $('eq-test').value = prevTest;
    else $('eq-test').value = labels.find(l => l !== $('eq-ref').value) || labels[1] || '';
    // Pairing is only on offer when a sample identifier actually matches across both methods.
    $('eq-paired-wrap').hidden = !pairableCount();
  }
  function pairableCount() {
    const si = $('eq-sampleid').value ? table.columns.indexOf($('eq-sampleid').value) : -1;
    const gi = table.columns.indexOf($('eq-group').value);
    if (si < 0 || gi < 0) return 0;
    const ref = $('eq-ref').value, test = $('eq-test').value;
    const inRef = new Set(), inTest = new Set();
    table.rows.forEach(r => {
      const g = String(r[gi]).trim(), id = String(r[si]).trim();
      if (!id) return;
      if (g === ref) inRef.add(id); else if (g === test) inTest.add(id);
    });
    let n = 0; inRef.forEach(id => { if (inTest.has(id)) n++; });
    return n;
  }

  function readRows() {
    if (!table) throw new Error('Load some results first.');
    const gi = table.columns.indexOf($('eq-group').value);
    const vi = table.columns.indexOf($('eq-value').value);
    if (gi < 0 || vi < 0) throw new Error('Pick a method column and a result column.');
    if (gi === vi) throw new Error('The method column and the result column must be different.');
    const si = $('eq-sampleid').value ? table.columns.indexOf($('eq-sampleid').value) : -1;
    const ai = multi() && $('eq-attr') && $('eq-attr').value ? table.columns.indexOf($('eq-attr').value) : -1;
    if (multi() && ai < 0) throw new Error('Pick the column that names the attribute.');
    if (multi() && (ai === gi || ai === vi)) throw new Error('The attribute column must be its own column, not the method or the result.');
    const out = [];
    let skipped = 0;
    table.rows.forEach(r => {
      const value = E.toNumber(r[vi]);
      if (value === null) { skipped++; return; }
      out.push({ group: String(r[gi]).trim(), value, sample: si >= 0 ? String(r[si]).trim() : '',
        attribute: ai >= 0 ? String(r[ai]).trim() : '' });
    });
    if (!out.length) throw new Error('No numeric results found in "' + $('eq-value').value + '".');
    return { rows: out, skipped };
  }
  const readOpts = () => ({
    reference: $('eq-ref').value, test: $('eq-test').value,
    margin: Number($('eq-margin').value), marginType: $('eq-margin-type').value,
    alpha: Number($('eq-alpha').value), paired: !$('eq-paired-wrap').hidden && $('eq-paired').checked,
    welch: $('eq-var').value !== 'pooled'
  });

  function describe() {
    try {
      const { rows, skipped } = readRows();
      const labels = Array.from(new Set(rows.map(r => r.group)));
      if (multi()) {
        const attrs = Array.from(new Set(rows.map(r => r.attribute).filter(Boolean)));
        const perAttr = attrs.map(a => rows.filter(r => r.attribute === a).length);
        const lo = perAttr.length ? Math.min.apply(null, perAttr) : 0;
        $('eq-read').textContent = rows.length + ' results: ' + attrs.length + ' attribute' + (attrs.length === 1 ? '' : 's') +
          ' (' + attrs.slice(0, 8).join(', ') + (attrs.length > 8 ? '\u2026' : '') + ') across ' + labels.length + ' site' + (labels.length === 1 ? '' : 's') +
          ' (' + labels.slice(0, 4).join(', ') + '), ' + Math.round(lo / Math.max(1, labels.length)) + ' or more per attribute per site.' +
          (attrs.length > 1 ? ' Requiring all ' + attrs.length + ' to pass needs no multiplicity correction, but it is far harder to achieve than any one of them - the run says by how much.' : '') +
          (skipped ? ' ' + skipped + ' row' + (skipped === 1 ? '' : 's') + ' skipped (no number in the result column).' : '');
        return;
      }
      const pairs = pairableCount();
      $('eq-read').textContent = rows.length + ' results across ' + labels.length + ' method' + (labels.length === 1 ? '' : 's') + ' (' + labels.slice(0, 6).join(', ') + (labels.length > 6 ? '…' : '') + ').' +
        (pairs ? ' ' + pairs + ' sample' + (pairs === 1 ? '' : 's') + ' measured by both, so they can be paired.' : '') +
        (skipped ? ' ' + skipped + ' row' + (skipped === 1 ? '' : 's') + ' skipped (no number in the result column).' : '');
    } catch (e) { $('eq-read').textContent = e.message; }
  }
  function fail(msg) { $('eq-error').textContent = msg; $('eq-error').hidden = false; }

  // ---------- the TOST chart ----------
  /* The confidence interval against the band you declared acceptable. Everything the test
     says is visible here: if the whole bar sits inside the shaded band, it passes. */
  function drawChart(el, r) {
    const W = Math.max(340, el.clientWidth || 700), H = 190, L = 40, R = 40, T0 = 34, mid = 104;
    const span = Math.max(r.margin * 1.45, Math.abs(r.ciLow) * 1.2, Math.abs(r.ciHigh) * 1.2, 1e-9);
    const sx = v => L + (v + span) / (2 * span) * (W - L - R);
    let b = '';
    b += '<rect class="band" x="' + sx(-r.margin) + '" y="' + T0 + '" width="' + (sx(r.margin) - sx(-r.margin)) + '" height="' + (mid + 34 - T0) + '"/>';
    [[-r.margin, '−margin'], [r.margin, '+margin']].forEach(([v, lab]) => {
      b += '<line class="ref" x1="' + sx(v) + '" x2="' + sx(v) + '" y1="' + T0 + '" y2="' + (mid + 34) + '"/>' +
        '<text class="lbl-strong" x="' + sx(v) + '" y="' + (T0 - 8) + '" text-anchor="middle">' + lab + ' ' + f2(v) + '</text>';
    });
    b += '<line class="zero" x1="' + sx(0) + '" x2="' + sx(0) + '" y1="' + T0 + '" y2="' + (mid + 34) + '"/>';
    b += '<text x="' + sx(0) + '" y="' + (mid + 50) + '" text-anchor="middle">no difference</text>';
    // The interval itself, with caps.
    const cls = r.equivalent ? 'ok' : r.differs ? 'bad' : 'warn';
    b += '<line class="ci ' + cls + '" x1="' + sx(r.ciLow) + '" x2="' + sx(r.ciHigh) + '" y1="' + mid + '" y2="' + mid + '"/>';
    [r.ciLow, r.ciHigh].forEach(v => { b += '<line class="ci-cap ' + cls + '" x1="' + sx(v) + '" x2="' + sx(v) + '" y1="' + (mid - 9) + '" y2="' + (mid + 9) + '"/>'; });
    b += '<circle class="ci-dot ' + cls + '" cx="' + sx(r.diff) + '" cy="' + mid + '" r="6"/>';
    b += '<text class="lbl-strong" x="' + sx(r.diff) + '" y="' + (mid - 16) + '" text-anchor="middle">difference ' + f3(r.diff) + '</text>';
    b += '<text x="' + sx(r.ciLow) + '" y="' + (mid + 26) + '" text-anchor="middle">' + f3(r.ciLow) + '</text>';
    b += '<text x="' + sx(r.ciHigh) + '" y="' + (mid + 26) + '" text-anchor="middle">' + f3(r.ciHigh) + '</text>';
    b += '<text class="lbl-strong" x="' + ((L + W - R) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + h(r.test) + ' minus ' + h(r.reference) + ' &#183; ' + Math.round(r.confidence * 100) + '% confidence interval</text>';
    el.innerHTML = '<svg class="chart tost-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Confidence interval against the equivalence margins">' + b + '</svg>';
  }

  // A strip of the individual results, so an outlier cannot hide behind a mean.
  function drawPoints(el, r, rows) {
    const groups = [r.reference, r.test];
    const vals = rows.filter(x => groups.includes(x.group)).map(x => x.value);
    const W = Math.max(320, el.clientWidth || 700), rowH = 46, H = 34 + rowH * 2, L = Math.min(150, 20 + Math.max(r.reference.length, r.test.length) * 7.5), R = 20;
    let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const sx = v => L + (v - lo) / (hi - lo) * (W - L - R);
    let b = '';
    for (const t of CH.niceTicks(lo, hi, 5)) if (t >= lo && t <= hi) b += '<text x="' + sx(t) + '" y="' + (H - 6) + '" text-anchor="middle">' + f2(t) + '</text>';
    groups.forEach((g, i) => {
      const y = 24 + i * rowH, st = i === 0 ? r.refStats : r.testStats;
      b += '<text class="lbl-strong" x="0" y="' + (y + 4) + '">' + h(g) + '</text>';
      b += '<line class="gridline" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/>';
      b += '<line class="mean-mark c' + (i + 1) + '" x1="' + sx(st.mean) + '" x2="' + sx(st.mean) + '" y1="' + (y - 13) + '" y2="' + (y + 13) + '"/>';
      rows.filter(x => x.group === g).forEach(x => {
        b += '<g data-tip="' + h(g + ' · ' + f3(x.value) + (x.sample ? ' · ' + x.sample : '')) + '"><circle class="pt c' + (i + 1) + '" cx="' + sx(x.value) + '" cy="' + y + '" r="4"/></g>';
      });
    });
    el.innerHTML = '<svg class="chart strip-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Individual results from each method">' + b + '</svg>' +
      '<p class="hint">Every result, with the vertical mark at each method’s mean.</p>';
  }

  // ---------- results ----------
  function render(r, rows) {
    last = { r, rows };
    const badge = { equivalent: ['capable', 'EQUIVALENT'], different: ['not', 'NOT EQUIVALENT'], inconclusive: ['marginal', 'INCONCLUSIVE'] }[r.verdict];
    const headline = {
      equivalent: 'The methods agree closely enough. The whole ' + Math.round(r.confidence * 100) + '% interval sits inside your margin.',
      different: 'There is a real difference, and it is bigger than you said you would accept.',
      inconclusive: 'Not proven either way. The interval is wider than your margin, but it still includes zero, so this is most likely too little data rather than a real bias.'
    }[r.verdict];
    const tile = (lbl, val, sub, hero) => '<div class="tile' + (hero ? ' hero-tile' : '') + '"><div class="lbl">' + h(lbl) + '</div><div class="val">' + h(val) + '</div><div class="sub">' + h(sub || '') + '</div></div>';

    const tiles = tile('Verdict', badge[1] === 'EQUIVALENT' ? 'Pass' : badge[1] === 'INCONCLUSIVE' ? 'Not yet' : 'Fail', r.design, true) +
      tile('Mean difference', f3(r.diff) + (isFinite(r.diffPct) ? ' (' + f2(r.diffPct) + '%)' : ''), h(r.test) + ' minus ' + h(r.reference)) +
      tile(Math.round(r.confidence * 100) + '% interval', f3(r.ciLow) + ' to ' + f3(r.ciHigh), 'margin ±' + f3(r.margin) + (r.marginType === 'percent' ? ' (' + f2(r.marginInput) + '% of ' + f2(r.refStats.mean) + ')' : '')) +
      tile('Margin used up', Math.round(r.bandUsed * 100) + '%', r.bandUsed <= 1 ? 'room to spare' : 'the interval runs past the margin');

    const stats = '<h4>Each method</h4><div class="table-scroll"><table><thead><tr><th>Method</th><th class="num-cell">Results</th><th class="num-cell">Mean</th><th class="num-cell">Std dev</th><th class="num-cell">%CV</th><th class="num-cell">Lowest</th><th class="num-cell">Highest</th></tr></thead><tbody>' +
      [[r.reference, r.refStats, 'reference'], [r.test, r.testStats, 'under test']].map(([n, st, role]) =>
        '<tr><td>' + h(n) + ' <span class="chip">' + role + '</span></td><td class="num-cell">' + st.n + '</td><td class="num-cell">' + f3(st.mean) + '</td><td class="num-cell">' + f3(st.sd) + '</td><td class="num-cell">' + (isFinite(st.cv) ? f2(st.cv * 100) + '%' : '–') + '</td><td class="num-cell">' + f3(st.min) + '</td><td class="num-cell">' + f3(st.max) + '</td></tr>').join('') +
      '</tbody></table></div>';

    const tests = '<h4>The two one-sided tests</h4><div class="table-scroll"><table><thead><tr><th>Test</th><th class="num-cell">t</th><th class="num-cell">df</th><th class="num-cell">p</th><th>At ' + r.alpha + '</th></tr></thead><tbody>' +
      '<tr><td>Difference is above &minus;' + f3(r.margin) + '</td><td class="num-cell">' + f3(r.t1) + '</td><td class="num-cell">' + f2(r.df) + '</td><td class="num-cell">' + pFmt(r.p1) + '</td><td><span class="verdict ' + (r.p1 < r.alpha ? 'capable' : 'not') + '">' + (r.p1 < r.alpha ? 'passed' : 'not passed') + '</span></td></tr>' +
      '<tr><td>Difference is below +' + f3(r.margin) + '</td><td class="num-cell">' + f3(r.t2) + '</td><td class="num-cell">' + f2(r.df) + '</td><td class="num-cell">' + pFmt(r.p2) + '</td><td><span class="verdict ' + (r.p2 < r.alpha ? 'capable' : 'not') + '">' + (r.p2 < r.alpha ? 'passed' : 'not passed') + '</span></td></tr>' +
      '<tr class="dim"><td>Overall TOST (the worse of the two)</td><td class="num-cell">–</td><td class="num-cell">' + f2(r.df) + '</td><td class="num-cell">' + pFmt(r.pTost) + '</td><td><span class="verdict ' + (r.equivalent ? 'capable' : 'not') + '">' + (r.equivalent ? 'equivalent' : 'not shown') + '</span></td></tr>' +
      '</tbody></table></div>';

    const notes = [];
    notes.push('Both one-sided tests must pass for equivalence. That is the same statement as the ' + Math.round(r.confidence * 100) + '% interval fitting inside ±' + f3(r.margin) + ', which is what the chart shows.');
    if (r.verdict === 'inconclusive') {
      notes.push('This is the result people most often misread. It is not evidence that the methods agree, and not evidence that they differ.' +
        (r.needed ? ' On the scatter seen here, about ' + r.needed + ' results per method would settle it.' : ' The difference seen here is already larger than the margin, so more data would not rescue it: the margin or the method needs revisiting.'));
    }
    if (r.verdict === 'different') notes.push('The difference of ' + f3(r.diff) + ' is larger than the ±' + f3(r.margin) + ' you allowed (two-sided p ' + pFmt(r.pDiff) + '). More data will not change that; the bias needs investigating, or the margin was set tighter than the method can hold.');
    if (r.verdict === 'equivalent' && r.bandUsed > 0.8) notes.push('It passes, but only just: the interval uses ' + Math.round(r.bandUsed * 100) + '% of the margin. A small drift would fail next time.');
    if (r.paired) notes.push('Paired on the sample identifier: ' + r.pairs.length + ' pairs. Pairing compares like with like, so sample-to-sample spread does not count against the comparison.' + (r.dropped > 0 ? ' ' + r.dropped + ' unmatched result' + (r.dropped === 1 ? ' was' : 's were') + ' left out.' : ''));
    else if (pairableCount()) notes.push('The same samples appear under both methods, so pairing them would be more sensitive than this unpaired comparison. Tick "Match the same samples as pairs" and run again.');
    if (r.refStats.n < 6 || r.testStats.n < 6) notes.push('With ' + Math.min(r.refStats.n, r.testStats.n) + ' results in the smaller method, the interval is wide whatever the truth is. Treat the verdict as provisional.');
    notes.push('The margin is a decision, not a statistic: it has to be set from what matters to the product before the data is seen, not chosen afterwards to get a pass.');

    const plainText = {
      equivalent: 'The two methods agree closely enough to treat as interchangeable. The difference could be anywhere from ' + f3(r.ciLow) + ' to ' + f3(r.ciHigh) + ', and the whole of that range sits inside the ±' + f3(r.margin) + ' you declared acceptable before looking at the data.',
      different: 'These methods do not agree. The difference is around ' + f3(r.diff) + ', which is larger than the ±' + f3(r.margin) + ' you were willing to accept. More data will not change that; something real is different and needs investigating.',
      inconclusive: 'This study cannot answer the question either way. The difference could be as much as ' + f3(Math.max(Math.abs(r.ciLow), Math.abs(r.ciHigh))) + ', which is outside your ±' + f3(r.margin) + ' margin, but it could also be zero. That is a sign of too little data rather than a real problem' + (r.needed ? ', and about ' + r.needed + ' results per method would settle it' : '') + '. Do not record this as "no significant difference, therefore equivalent" — that is the mistake this test exists to prevent.'
    }[r.verdict];
    $('eq-out').innerHTML = '<div class="card eq-result"><h3>Equivalence result</h3>' +
      '<div class="plain ' + badge[0] + '"><h4>In plain English</h4><p>' + h(plainText) + '</p></div>' +
      '<p class="sub-head"><span class="verdict ' + badge[0] + '">' + badge[1] + '</span> ' + h(headline) + '</p>' +
      '<div class="tiles">' + tiles + '</div>' +
      '<div id="eq-chart"></div><div id="eq-points"></div>' + stats + tests +
      '<h4>What this rests on</h4><ul class="insights">' + notes.map(n => '<li class="info">' + h(n) + '</li>').join('') + '</ul>' +
      '<div class="row-actions"><button class="btn primary" type="button" id="eq-csv">Download the report (.csv)</button></div>' +
      '<p class="hint">Decision support, not a validated method-transfer system. Confirm against your protocol and have the arithmetic checked independently.</p>' +
      '</div>';
    drawChart($('eq-chart'), r);
    drawPoints($('eq-points'), r, rows);
    $('eq-csv').addEventListener('click', () => download('method-transfer-tost.csv', reportCSV(r, rows), 'text/csv'));
    window.MLTostRun = summary(r);
  }

  const summary = r => ({
    when: new Date().toISOString(), reference: r.reference, test: r.test, design: r.design, paired: r.paired,
    verdict: r.verdict, equivalent: r.equivalent, diff: r.diff, diffPct: r.diffPct, se: r.se, df: r.df,
    ciLow: r.ciLow, ciHigh: r.ciHigh, confidence: r.confidence, alpha: r.alpha,
    margin: r.margin, marginType: r.marginType, marginInput: r.marginInput, bandUsed: r.bandUsed,
    p1: r.p1, p2: r.p2, pTost: r.pTost, pDiff: r.pDiff, needed: r.needed,
    refStats: r.refStats, testStats: r.testStats, pairs: r.pairs ? r.pairs.length : 0,
    columns: { group: $('eq-group').value, value: $('eq-value').value, sample: $('eq-sampleid').value }
  });

  function reportCSV(r, rows) {
    const q = v => '"' + String(v).replace(/"/g, '""') + '"';
    const L = [];
    L.push(['Method transfer equivalence report (TOST)']);
    L.push(['Generated', q(new Date().toISOString())]);
    L.push(['Computed', q('In the browser. No data was uploaded or stored.')]);
    L.push([]);
    L.push(['Setting', 'Value']);
    L.push(['Method column', q($('eq-group').value)], ['Result column', q($('eq-value').value)]);
    if ($('eq-sampleid').value) L.push(['Sample identifier', q($('eq-sampleid').value)]);
    L.push(['Reference method', q(r.reference)], ['Method under test', q(r.test)], ['Design', q(r.design)]);
    L.push(['Equivalence margin', r.margin], ['Margin quoted as', q(r.marginType === 'percent' ? r.marginInput + '% of the reference mean' : 'absolute units')]);
    L.push(['Significance level (one sided)', r.alpha], ['Interval', Math.round(r.confidence * 100) + '%']);
    L.push([]);
    L.push(['Method', 'n', 'Mean', 'Std dev', 'CV', 'Min', 'Max']);
    [[r.reference, r.refStats], [r.test, r.testStats]].forEach(([n, st]) => L.push([q(n), st.n, st.mean, st.sd, st.cv, st.min, st.max]));
    L.push([]);
    L.push(['Result', 'Value']);
    L.push(['Mean difference (test minus reference)', r.diff]);
    L.push(['Standard error', r.se], ['Degrees of freedom', r.df]);
    L.push(['Interval lower', r.ciLow], ['Interval upper', r.ciHigh]);
    L.push(['Margin used up', r.bandUsed]);
    L.push([]);
    L.push(['One-sided test', 't', 'df', 'p', 'Passed']);
    L.push([q('Difference above -margin'), r.t1, r.df, r.p1, r.p1 < r.alpha ? 'yes' : 'no']);
    L.push([q('Difference below +margin'), r.t2, r.df, r.p2, r.p2 < r.alpha ? 'yes' : 'no']);
    L.push([q('Overall TOST'), '', r.df, r.pTost, r.equivalent ? 'yes' : 'no']);
    L.push(['Two-sided test of any difference', '', r.df, r.pDiff, '']);
    L.push([]);
    L.push(['Verdict', q(r.verdict)]);
    if (r.needed) L.push(['Results per method that would settle it', r.needed]);
    L.push([]);
    if (r.paired) {
      L.push(['Sample', 'Reference', 'Test', 'Difference']);
      r.pairs.forEach(p => L.push([q(p.sample), p.ref, p.test, p.d]));
    } else {
      L.push(['Method', 'Result', 'Sample']);
      rows.forEach(p => L.push([q(p.group), p.value, q(p.sample || '')]));
    }
    L.push([]);
    L.push([q('Decision support, not a validated method-transfer system. The equivalence margin must be set from product requirements before the data is seen.')]);
    return L.map(x => x.join(',')).join('\n') + '\n';
  }

  /* Three examples, built here rather than taken from a real transfer: one that passes, one
     with a genuine bias, and one that is simply too small to tell either way. */
  function example(kind) {
    const r = E.rng(kind === 'pass' ? 12 : kind === 'bias' ? 31 : 5);
    const norm = () => { const u = Math.max(1e-12, r()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
    const n = kind === 'thin' ? 4 : 12;
    const shift = kind === 'bias' ? 4.2 : kind === 'thin' ? 0.6 : 0.25;
    const noise = kind === 'thin' ? 3.2 : 0.9;
    const lines = ['SampleID,Method_Lab,Result_Value'];
    for (let i = 0; i < n; i++) {
      const truth = 98.5 + norm() * 1.4;
      lines.push(['S-' + String(i + 1).padStart(2, '0'), 'Lab A (reference)', (truth + norm() * noise).toFixed(2)].join(','));
      lines.push(['S-' + String(i + 1).padStart(2, '0'), 'Lab B (new)', (truth + shift + norm() * noise).toFixed(2)].join(','));
    }
    return lines.join('\n');
  }

  // ---------- a whole transfer: every attribute, one verdict ----------
  /* The forest plot is the right picture here and the only one: each attribute's interval
     against its own margin, scaled so every row is comparable. Scaled as a FRACTION of each
     attribute's margin, because the attributes are in different units - a purity in percent
     beside an aggregate in percent beside a potency in units cannot share an axis any other
     way, and the question for every one of them is the same question: does it fit. */
  function drawForest(el, r) {
    const rows = r.attributes.filter(a => a.tost);
    const W = Math.max(340, el.clientWidth || 700), L = 150, R = 56, T0 = 30, rowH = 30;
    const H = T0 + rows.length * rowH + 42;
    const span = Math.max(1.25, ...rows.map(a => Math.max(Math.abs(a.ciLow), Math.abs(a.ciHigh)) / a.margin * 1.12));
    const sx = v => L + (v + span) / (2 * span) * (W - L - R);
    let b = '<rect class="band" x="' + sx(-1) + '" y="' + T0 + '" width="' + (sx(1) - sx(-1)) + '" height="' + (rows.length * rowH + 6) + '"/>';
    for (const v of [-1, 1]) b += '<line class="ref" x1="' + sx(v) + '" x2="' + sx(v) + '" y1="' + T0 + '" y2="' + (T0 + rows.length * rowH + 6) + '"/>';
    b += '<line class="zero" x1="' + sx(0) + '" x2="' + sx(0) + '" y1="' + T0 + '" y2="' + (T0 + rows.length * rowH + 6) + '"/>';
    b += '<text class="lbl-strong" x="' + sx(-1) + '" y="' + (T0 - 8) + '" text-anchor="middle">−margin</text>' +
      '<text class="lbl-strong" x="' + sx(1) + '" y="' + (T0 - 8) + '" text-anchor="middle">+margin</text>';
    rows.forEach((a, i) => {
      const y = T0 + i * rowH + rowH / 2 + 3;
      const cls = a.equivalent ? 'ok' : 'bad';
      const lo = a.ciLow / a.margin, hi = a.ciHigh / a.margin, d = a.diff / a.margin;
      const clamp = v => Math.max(-span, Math.min(span, v));
      b += '<text x="' + (L - 10) + '" y="' + (y + 4) + '" text-anchor="end"' + (a.equivalent ? '' : ' class="lbl-strong"') + '>' + CH.esc(trunc(a.name, 22)) + '</text>';
      b += '<g data-tip="' + CH.esc(a.name + '\n' + (a.equivalent ? 'inside its margin' : 'OUTSIDE its margin') + '\ndifference ' + f3(a.diff) + ', interval ' + f3(a.ciLow) + ' to ' + f3(a.ciHigh) + '\nmargin ±' + f3(a.margin) + '\nspent ' + Math.round(100 * a.spent) + '% of it') + '">';
      b += '<rect class="hit" x="' + L + '" y="' + (y - rowH / 2) + '" width="' + (W - L - R) + '" height="' + rowH + '"/>';
      b += '<line class="ci ' + cls + '" x1="' + sx(clamp(lo)) + '" x2="' + sx(clamp(hi)) + '" y1="' + y + '" y2="' + y + '"/>';
      for (const v of [lo, hi]) b += '<line class="ci-cap ' + cls + '" x1="' + sx(clamp(v)) + '" x2="' + sx(clamp(v)) + '" y1="' + (y - 6) + '" y2="' + (y + 6) + '"/>';
      b += '<circle class="ci-dot ' + cls + '" cx="' + sx(clamp(d)) + '" cy="' + y + '" r="4"/></g>';
      b += '<text x="' + (W - R + 6) + '" y="' + (y + 4) + '">' + Math.round(100 * a.spent) + '%</text>';
    });
    b += '<text class="lbl-strong" x="' + ((L + W - R) / 2) + '" y="' + (H - 10) + '" text-anchor="middle">Difference as a fraction of each attribute’s own margin</text>';
    el.innerHTML = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Every attribute’s confidence interval against its own equivalence margin">' + b + '</svg>';
    if (CH.bindTips) CH.bindTips(el);
  }
  const trunc = (v, n) => (String(v).length > n ? String(v).slice(0, n - 1) + '…' : String(v));

  /* Three transfers, every one generated batch by batch so the attributes genuinely share
     batch-level variation rather than being typed in as if they did. The third is the point
     of the mode: sized from a per-attribute calculation, every attribute passes comfortably
     on its own, and the chance of all of them passing is poor. */
  function multiExample(kind) {
    const rand = E.rng(kind === 'fail' ? 13 : kind === 'thin' ? 29 : 5);
    const norm = () => { const u = Math.max(1e-12, rand()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };
    const ATTRS = [
      ['Purity_Pct', 98.5, 0.45], ['Monomer_Pct', 97.2, 0.5], ['HMW_Aggregate_Pct', 1.1, 0.18],
      ['LMW_Fragment_Pct', 0.7, 0.12], ['Acidic_Variants_Pct', 12.0, 0.9], ['Basic_Variants_Pct', 7.4, 0.7],
      ['Main_Peak_Pct', 80.6, 1.1], ['Potency_Pct', 101.0, 3.2], ['Afucosylation_Pct', 4.2, 0.4],
      ['G0F_Pct', 68.0, 2.1], ['Charge_Het_Pct', 18.5, 1.3], ['Host_Cell_Protein_ppm', 42.0, 6.0]
    ];
    const k = 12;
    const n = 20;
    const rho = 0.55;
    /* The margin per attribute, as a multiple of that attribute's own standard deviation.
       At 20 per site a margin of 0.94 sigma is exactly 80% power, so 1.45 sigma is a
       comfortable protocol and 0.98 is a tight one - which is what makes the third example
       the one worth looking at: every attribute passes on its own and the transfer still
       probably fails. */
    /* 0.94 sigma is exactly 80% single-attribute power at 20 per site, which is what a
       per-attribute calculation would have sized this study for. Every attribute then passes
       comfortably on its own and the chance of ALL twelve passing is poor - which is the
       whole point of the third example, and the thing a dozen separate runs cannot show. */
    const mult = kind === 'thin' ? 0.94 : 1.45;
    const lines = ['Batch,Attribute,Site,Result,Margin'];
    for (let i = 0; i < n; i++) {
      // One shared batch effect per site, so every attribute on a batch moves together.
      const sRef = norm(), sTest = norm();
      ATTRS.slice(0, k).forEach(([name, mean, sd], j) => {
        /* One attribute is genuinely shifted in the "fail" case, by a little over its
           margin - the case where eleven separate runs would all have reported a pass. */
        const shift = kind === 'fail' && name === 'Acidic_Variants_Pct' ? sd * 2.6 : 0;
        const ref = mean + sd * (Math.sqrt(rho) * sRef + Math.sqrt(1 - rho) * norm());
        const tst = mean + shift + sd * (Math.sqrt(rho) * sTest + Math.sqrt(1 - rho) * norm());
        const dp = mean < 2 ? 3 : 2;
        const mg = (sd * mult).toFixed(3);
        lines.push(['B-' + String(i + 1).padStart(2, '0'), name, 'Site 1 (origin)', ref.toFixed(dp), mg].join(','));
        lines.push(['B-' + String(i + 1).padStart(2, '0'), name, 'Site 2 (receiving)', tst.toFixed(dp), mg].join(','));
      });
    }
    return lines.join('\n');
  }

  function runMulti() {
    $('eq-error').hidden = true;
    const CM = window.MLComparability;
    if (!CM) return fail('The comparability module did not load.');
    let got;
    try { got = readRows(); } catch (e) { return fail(e.message); }
    if ($('eq-ref').value === $('eq-test').value) return fail('The reference site and the site under test must be different.');
    const opts = {
      reference: $('eq-ref').value, test: $('eq-test').value,
      margin: Number($('eq-margin').value), marginType: $('eq-margin-type').value,
      alpha: Number($('eq-alpha').value),
      power: Number($('eq-power') ? $('eq-power').value : 0.8),
      reps: 2500, sizeReps: 900, maxN: 300
    };
    /* Per-attribute margins, in each attribute's own units, taken from the column where one
       was given. A margin that disagrees between rows of the same attribute is a protocol
       error rather than something to average, so it is refused. */
    const mc = $('eq-margincol') && $('eq-margincol').value ? table.columns.indexOf($('eq-margincol').value) : -1;
    const ai = table.columns.indexOf($('eq-attr').value);
    if (mc >= 0) {
      const margins = {}, clash = [];
      table.rows.forEach(r => {
        const a = String(r[ai]).trim(), m = E.toNumber(r[mc]);
        if (!a || m === null) return;
        if (margins[a] === undefined) margins[a] = Math.abs(m);
        else if (Math.abs(Math.abs(m) - margins[a]) > 1e-9 && !clash.includes(a)) clash.push(a);
      });
      if (clash.length) return fail('The margin column gives more than one margin for ' + clash.join(', ') +
        '. A margin is one number declared per attribute before the study; differing values in the same column are a protocol error rather than something to average.');
      opts.margins = margins;
      opts.marginType = 'absolute';
    }
    try {
      renderMulti(CM.analyze(got.rows, opts));
      $('eq-out').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { fail(e.message); }
  }

  function renderMulti(r) {
    const pct0 = v => (v === null || v === undefined || !isFinite(v) ? '–' : (100 * v).toFixed(0) + '%');
    const k = r.usable;
    const failing = r.attributes.filter(a => a.tost && !a.equivalent);
    last = { kind: 'multi', r };

    $('eq-out').innerHTML = '<div class="card"><h3>' + (r.allEquivalent ? 'Comparable on every attribute' : 'Not comparable as a whole') + '</h3>' +
      '<div class="tiles">' +
      '<div class="tile hero-tile"><div class="lbl">The whole transfer</div><div class="val">' + (r.allEquivalent ? 'Passes' : 'Fails') +
        '</div><div class="sub">' + (r.allEquivalent ? 'all ' + k + ' attributes inside their margins' : failing.length + ' of ' + k + ' outside: ' + failing.slice(0, 3).map(a => a.name).join(', ') + (failing.length > 3 ? '…' : '')) + '</div></div>' +
      '<div class="tile"><div class="lbl">Binding attribute</div><div class="val">' + CH.esc(trunc(r.binding.name, 16)) +
        '</div><div class="sub">spent ' + Math.round(100 * r.binding.spent) + '% of its margin</div></div>' +
      '<div class="tile"><div class="lbl">Chance all ' + k + ' pass</div><div class="val">' + pct0(r.combinedPower) +
        '</div><div class="sub">weakest one alone: ' + pct0(r.weakestPerAttributePower) + '</div></div>' +
      '<div class="tile"><div class="lbl">Per site for ' + pct0(r.targetPower) + ' on the whole claim</div><div class="val">' + (r.nForCombined === null ? '–' : r.nForCombined) +
        '</div><div class="sub">' + (r.nPerAttributeWould === null ? 'per-attribute sizing unavailable' : 'attribute by attribute says ' + r.nPerAttributeWould) + '</div></div>' +
      '</div>' +
      '<div id="eq-forest" class="chart"></div>' +
      '<div class="table-scroll"><table class="pm"><thead><tr><th>Attribute</th><th>Difference</th><th>' + Math.round(100 * (1 - 2 * r.alpha)) + '% interval</th><th>Margin</th><th>Margin spent</th><th>Verdict</th></tr></thead><tbody>' +
      r.attributes.map(a => a.error
        ? '<tr><td>' + CH.esc(a.name) + '</td><td colspan="5"><span class="hint">' + CH.esc(a.error) + '</span></td></tr>'
        : '<tr' + (a.equivalent ? '' : ' class="hi"') + '><td>' + CH.esc(a.name) + '</td><td>' + f3(a.diff) + '</td><td>' + f3(a.ciLow) + ' to ' + f3(a.ciHigh) +
          '</td><td>±' + f3(a.margin) + '</td><td>' + Math.round(100 * a.spent) + '%</td><td>' + (a.equivalent ? 'inside' : '<b>outside</b>') + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<p class="why">' + CH.esc(r.why) + '</p>' +
      '<details class="howto" open><summary>How to read this, and what it changes</summary><div class="howto-body">' +
      '<p><b>One verdict, and it is the weakest attribute’s verdict.</b> Requiring every attribute to pass is an intersection-union test, so the whole transfer is exactly as strong as its worst member — here <b>' + CH.esc(r.binding.name) +
      '</b>, which has spent ' + Math.round(100 * r.binding.spent) + '% of its margin. That is the attribute to argue about, to add batches for, or to revisit the margin on. A dozen separate equivalence runs give you a dozen verdicts and never tell you which one the transfer rests on.</p>' +
      '<p><b>Do not correct for multiplicity. This is the part that saves money.</b> The reflex with twelve tests is to split alpha twelve ways, and it is wrong here: to wrongly call the sites comparable you would have to wrongly pass <i>every</i> attribute, so the false-pass rate is at most ' + pct0(r.alpha) +
      ' however many attributes there are. Measured with every attribute sitting exactly on its margin — the worst case — the rate does not creep up as attributes are added, it <b>falls</b>: about 4.6% at one attribute, 2.2% at three, 1.2% at twelve. A Bonferroni split would hold a twelve-attribute transfer to 0.42% when it is already stricter than that, and the extra batches that buys are batches nobody needed to make.</p>' +
      '<p><b>The cost is in the power, and it is the opposite of intuitive.</b> Each attribute here passes on its own with probability up to ' + pct0(r.weakestPerAttributePower) +
      ' for the weakest; all ' + k + ' passing together is <b>' + pct0(r.combinedPower) + '</b>. The usual quoted figure for twelve attributes each powered at 80% is 0.8¹², about 7% — and that is the <i>independence</i> case, which is the worst case. Quality attributes measured on the same batches share batch-level variation, so they tend to pass or fail together, and that <i>helps</i>: measured on simulated studies at 80% each, twelve attributes reach 10% at a correlation of 0.3, 24% at 0.6 and 52% at 0.9. ' +
      (r.correlation.mean === null
        ? 'The correlation could not be estimated here, so the attributes were treated as independent — the pessimistic end.'
        : 'Yours correlate at about <b>' + r.correlation.mean.toFixed(2) + '</b> (' + CH.esc(r.correlation.basis) + '), which is why the figure above is ' + pct0(r.combinedPower) + ' rather than the ' + pct0(r.independentPower) + ' independence would have predicted.') + '</p>' +
      '<p><b>So size for the whole claim, not for one attribute.</b> ' + (r.nForCombined === null
        ? 'A size for the combined claim could not be found below 300 per site, which usually means a margin is too tight for the spread rather than that the study is genuinely enormous — check the binding attribute’s margin against what its own data says is achievable.'
        : 'For ' + pct0(r.targetPower) + ' confidence of passing the whole transfer you need about <b>' + r.nForCombined + ' per site</b>' +
          (r.nPerAttributeWould === null ? '.' : ', against the ' + r.nPerAttributeWould + ' a per-attribute calculation on the worst single attribute asks for — so sizing attribute by attribute understates this study by about ' + (r.nForCombined / r.nPerAttributeWould).toFixed(1) + ' times. That is the number to take to the people booking the batches.') ) + '</p>' +
      '<p><b>What this does not cover.</b> The margins are yours and the tool will not invent one — an attribute with no margin is listed as untested rather than quietly dropped' + (r.anyUntested ? ', and ' + r.untested + ' here ' + (r.untested === 1 ? 'is' : 'are') : '') + '. A margin chosen after seeing the data is not a test. Two sites are compared at a time: three sites at once is a different claim needing a different margin. And failing to find a difference is never evidence of sameness, which is the whole reason this is an equivalence test and not a t-test — the combined power above is what says whether a pass meant anything.</p>' +
      '</div></details></div>';

    drawForest($('eq-forest'), r);
  }

  function run() {
    if (multi()) return runMulti();
    $('eq-error').hidden = true;
    let rows, opts;
    try { rows = readRows(); opts = readOpts(); } catch (e) { return fail(e.message); }
    if ($('eq-ref').value === $('eq-test').value) return fail('The reference and the method under test must be different.');
    try {
      const res = T.analyze(rows.rows, opts);
      render(res, rows.rows.filter(x => x.group === res.reference || x.group === res.test));
      $('eq-out').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { fail(e.message); }
  }

  function clear() {
    table = null; last = null; window.MLTostRun = null;
    $('eq-data').value = ''; $('eq-out').innerHTML = ''; $('eq-read').textContent = '';
    $('eq-settings').hidden = true; $('eq-error').hidden = true; $('eq-file').value = '';
    $('eq-paired-wrap').hidden = true; $('eq-paired').checked = false;
    sides.a = sides.b = null;
    ['a', 'b'].forEach(w => {
      $('eq-' + w + '-data').value = ''; $('eq-' + w + '-file').value = '';
      $('eq-' + w + '-read').textContent = ''; $('eq-' + w + '-map').hidden = true;
      delete $('eq-' + w + '-name').dataset.touched;
    });
    $('eq-a-name').value = 'Reference method'; $('eq-b-name').value = 'New method';
  }

  function init() {
    const load = (text, margin) => {
      if (layout() !== 'one') { $('eq-layout').value = 'one'; showLayout(); }
      $('eq-data').value = text; $('eq-error').hidden = true; $('delete-top').hidden = false;
      loadText(text);
      // The examples set the margin they were built to illustrate: 2% of the reference is a
      // realistic acceptance band for an assay transfer, where 10% would wave anything through.
      if (margin) { $('eq-margin').value = margin; $('eq-margin-type').value = 'percent'; }
    };
    $('eq-sample').addEventListener('click', () => load(example('pass'), 2));
    $('eq-sample2').addEventListener('click', () => load(example('bias'), 2));
    $('eq-sample3').addEventListener('click', () => load(example('thin'), 2));
    if ($('eq-sample4')) {
      /* The transfer examples carry a 2.5% margin, which is a realistic acceptance band for
         a site transfer across this mix of attributes. The mode is switched before loading,
         because the attribute column only gets guessed while the mode is multi. */
      const loadMulti = kind => { if ($('eq-what').value !== 'multi') { $('eq-what').value = 'multi'; showWhat(); } load(multiExample(kind)); };
      $('eq-sample4').addEventListener('click', () => loadMulti('pass'));
      $('eq-sample5').addEventListener('click', () => loadMulti('fail'));
      $('eq-sample6').addEventListener('click', () => loadMulti('thin'));
      $('eq-what').addEventListener('change', showWhat);
      $('eq-attr').addEventListener('change', describe);
      if ($('eq-margincol')) $('eq-margincol').addEventListener('change', describe);
      if ($('eq-power')) $('eq-power').addEventListener('change', () => {});
      showWhat();
    }
    $('eq-clear').addEventListener('click', clear);
    $('eq-data').addEventListener('change', () => { if ($('eq-data').value.trim()) { $('delete-top').hidden = false; loadText($('eq-data').value); } });
    $('eq-file').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const fr = new FileReader();
      fr.onload = () => load(String(fr.result));
      fr.readAsText(f);
    });
    $('eq-layout').addEventListener('change', showLayout);
    ['a', 'b'].forEach(w => {
      const pull = text => { $('eq-' + w + '-data').value = text; $('delete-top').hidden = false; loadSide(w, text); };
      $('eq-' + w + '-data').addEventListener('change', () => { if ($('eq-' + w + '-data').value.trim()) pull($('eq-' + w + '-data').value); });
      $('eq-' + w + '-file').addEventListener('change', e => {
        const f = e.target.files && e.target.files[0]; if (!f) return;
        const fr = new FileReader();
        fr.onload = () => { $('eq-' + w + '-data').value = String(fr.result); $('delete-top').hidden = false; loadSide(w, String(fr.result), f.name); };
        fr.readAsText(f);
      });
      $('eq-' + w + '-name').addEventListener('input', () => { $('eq-' + w + '-name').dataset.touched = '1'; combineSides(); });
      ['value', 'sample'].forEach(k => $('eq-' + w + '-' + k).addEventListener('change', combineSides));
    });
    ['eq-group', 'eq-sampleid'].forEach(id => $(id).addEventListener('change', () => { if (layout() === 'one') { fillMethods(); describe(); } }));
    ['eq-ref', 'eq-test'].forEach(id => $(id).addEventListener('change', () => { $('eq-paired-wrap').hidden = !pairableCount(); }));
    $('eq-value').addEventListener('change', describe);
    $('eq-run').addEventListener('click', run);
  }

  window.MLEquiv = { clear, example };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
