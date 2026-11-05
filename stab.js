/* Shelf-life panel (ICH Q1E): reads a stability study, runs the poolability tests and the
   confidence-limit intersection, and draws the result. Nothing is uploaded or stored. */
(function () {
  'use strict';
  const E = window.MLEngine, S = window.MLStability, CH = window.Charts;
  const $ = id => document.getElementById(id);
  const h = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f2 = v => (isFinite(v) ? Number(v).toFixed(2) : '–');
  const f3 = v => (isFinite(v) ? Number(v).toFixed(3) : '–');
  const months = v => (v >= 1000 ? 'beyond the search range' : f2(v) + ' months');

  let table = null, last = null;

  function download(name, data, type) {
    const url = URL.createObjectURL(new Blob([data], { type: type + ';charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---------- reading the study ----------
  const TIME = /^(month|months|time|timepoint|time ?point|t|age|interval|study ?month)$/i;
  const BATCH = /batch|lot|^run$|campaign|drug ?product/i;
  const COND = /condition|storage|temp|rh|humidity|orientation|package/i;
  const RESULT = /purity|potency|assay|content|impurit|degrad|related|moisture|dissolution|titer|activity|result|value|%/i;

  function loadText(text) {
    let t;
    try { t = E.parseTable(text); } catch (e) { return fail('Could not read the data: ' + e.message); }
    if (!t.rows.length || t.columns.length < 2) return fail('No usable rows found. The first row should hold column names.');
    table = t;
    const prof = E.profile(t);
    const numeric = prof.columns.filter(c => c.kind === 'numeric' || c.kind === 'id').map(c => c.name);
    const guess = (re, from) => from.find(c => re.test(c)) || '';
    const timeCol = guess(TIME, t.columns) || guess(/month|time|week|day/i, t.columns) || numeric[0] || t.columns[0];
    const batchCol = guess(BATCH, t.columns) || t.columns[0];
    const yCol = t.columns.filter(c => c !== timeCol && numeric.includes(c)).find(c => RESULT.test(c)) ||
      t.columns.filter(c => c !== timeCol && numeric.includes(c)).pop() || '';
    const condCol = guess(COND, t.columns);
    const opt = (sel, cols, val, blank) => {
      $(sel).innerHTML = (blank ? '<option value="">(none)</option>' : '') + cols.map(c => '<option' + (c === val ? ' selected' : '') + '>' + h(c) + '</option>').join('');
    };
    opt('stab-time', t.columns, timeCol); opt('stab-batch', t.columns, batchCol);
    opt('stab-y', t.columns, yCol); opt('stab-cond', t.columns, condCol, true);
    $('stab-map').hidden = false;
    if ($('fc-series')) { const numeric = E.profile(table).columns.filter(c => c.kind === 'numeric').map(c => c.name);
      $('fc-series').innerHTML = numeric.map(c => '<option>' + c + '</option>').join(''); }
    if ($('rel-time')) fillReliability(t);
    if ($('stab-mode')) showStabMode();
    $('stab-settings').hidden = false;
    fillConditions();
    describe();
  }
  function fillConditions() {
    const c = $('stab-cond').value;
    const sel = $('stab-cond-value');
    if (!c || !table) { sel.innerHTML = '<option value="">(all rows)</option>'; sel.disabled = true; return; }
    const i = table.columns.indexOf(c);
    const vals = Array.from(new Set(table.rows.map(r => String(r[i]).trim()).filter(Boolean)));
    sel.disabled = false;
    sel.innerHTML = '<option value="">(all rows)</option>' + vals.map(v => '<option>' + h(v) + '</option>').join('');
    // A study usually holds several conditions; long term is the one Q1E sets shelf life from.
    const longTerm = vals.find(v => /25|30|long/i.test(v));
    if (longTerm) sel.value = longTerm;
  }

  function readRows() {
    if (!table) throw new Error('Load some stability data first.');
    const ti = table.columns.indexOf($('stab-time').value);
    const bi = table.columns.indexOf($('stab-batch').value);
    const yi = table.columns.indexOf($('stab-y').value);
    if (ti < 0 || yi < 0) throw new Error('Pick a time column and a result column.');
    if (ti === yi) throw new Error('The time column and the result column must be different.');
    const ci = $('stab-cond').value ? table.columns.indexOf($('stab-cond').value) : -1;
    const want = $('stab-cond-value').value;
    const out = [];
    let skipped = 0;
    table.rows.forEach(r => {
      if (ci >= 0 && want && String(r[ci]).trim() !== want) return;
      const time = E.toNumber(r[ti]), y = E.toNumber(r[yi]);
      if (time === null || y === null) { skipped++; return; }
      out.push({ batch: bi >= 0 ? String(r[bi]).trim() : 'All data', time, y, condition: ci >= 0 ? String(r[ci]).trim() : '' });
    });
    if (!out.length) throw new Error('No rows left after filtering. Check the column choices and the storage condition.');
    return { rows: out, skipped };
  }
  function readOpts() {
    const num = id => ($(id).value === '' ? null : Number($(id).value));
    const lsl = num('stab-lsl'), usl = num('stab-usl');
    const dir = $('stab-dir').value;
    return { lsl: lsl === null ? NaN : lsl, usl: usl === null ? NaN : usl, direction: dir === 'auto' ? null : dir, poolAlpha: Number($('stab-alpha').value) };
  }

  function describe() {
    try {
      const { rows, skipped } = readRows();
      const bs = Array.from(new Set(rows.map(r => r.batch)));
      const ts = Array.from(new Set(rows.map(r => r.time))).sort((a, b) => a - b);
      $('stab-read').textContent = rows.length + ' measurements, ' + bs.length + ' batch' + (bs.length === 1 ? '' : 'es') +
        ', time points ' + ts.slice(0, 10).join(', ') + (ts.length > 10 ? '…' : '') + ' months.' +
        (skipped ? ' ' + skipped + ' row' + (skipped === 1 ? '' : 's') + ' skipped (no number in the time or result column).' : '');
    } catch (e) { $('stab-read').textContent = e.message; }
  }
  function fail(msg) { $('stab-error').textContent = msg; $('stab-error').hidden = false; }

  // ---------- the chart ----------
  /* Measurements, the fitted line for each batch, the confidence limit that decides the
     shelf life, the specification, and a marker where the two meet. */
  function drawChart(el, r) {
    const W = Math.max(340, el.clientWidth || 700), H = Math.round(Math.min(420, W * 0.58)), L = 62, R = 18, T = 16, B = 46;
    const xMax = Math.max(r.maxTime * 1.1, Math.min(r.shelfLife * 1.15, r.horizon));
    const ysData = r.rows.map(p => p.y);
    const limitVals = [];
    for (let i = 0; i <= 40; i++) {
      const t = xMax * i / 40;
      r.curves.forEach(c => { limitVals.push(c.fit(t)); if (c.watchLow) limitVals.push(c.lower(t)); if (c.watchHigh) limitVals.push(c.upper(t)); });
    }
    const cand = ysData.concat(limitVals).concat([r.lsl, r.usl].filter(v => v !== null));
    let ylo = Math.min.apply(null, cand), yhi = Math.max.apply(null, cand);
    const padY = (yhi - ylo) * 0.08 || 1; ylo -= padY; yhi += padY;
    const sx = v => L + (v / (xMax || 1)) * (W - L - R);
    const sy = v => H - B - (v - ylo) / (yhi - ylo) * (H - T - B);
    let b = '';
    // Out-of-specification zones, so "below the line is bad" is visible at a glance.
    if (r.lsl !== null && r.lsl > ylo) b += '<rect class="oos" x="' + L + '" y="' + sy(r.lsl) + '" width="' + (W - L - R) + '" height="' + Math.max(0, H - B - sy(r.lsl)) + '"/>';
    if (r.usl !== null && r.usl < yhi) b += '<rect class="oos" x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + Math.max(0, sy(r.usl) - T) + '"/>';
    for (const t of CH.niceTicks(ylo, yhi, 5)) if (t >= ylo && t <= yhi) b += '<line class="gridline" x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(t) + '" y2="' + sy(t) + '"/><text x="' + (L - 6) + '" y="' + (sy(t) + 4) + '" text-anchor="end">' + h(CH.esc ? f2(t) : t) + '</text>';
    for (const t of CH.niceTicks(0, xMax, 6)) if (t >= 0 && t <= xMax) b += '<text x="' + sx(t) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + Math.round(t) + '</text>';
    b += '<line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>';
    [['lsl', r.lsl, 'LSL'], ['usl', r.usl, 'USL']].forEach(([, v, lab]) => {
      if (v === null || v < ylo || v > yhi) return;
      b += '<line class="ref" x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(v) + '" y2="' + sy(v) + '"/>' +
        '<text class="lbl-strong" x="' + (W - R - 2) + '" y="' + (sy(v) - 4) + '" text-anchor="end">' + lab + ' ' + f2(v) + '</text>';
    });
    const path = (fn, cls) => {
      let d = '';
      for (let i = 0; i <= 80; i++) { const t = xMax * i / 80; d += (i ? 'L' : 'M') + sx(t).toFixed(1) + ' ' + sy(fn(t)).toFixed(1); }
      return '<path class="' + cls + '" d="' + d + '"/>';
    };
    const cls = i => 'c' + ((i % 6) + 1);
    r.curves.forEach((c, i) => {
      const lim = c === r.limiting;
      b += path(c.fit, 'line ' + cls(i) + (lim ? '' : ' faint'));
      if (c.watchLow) b += path(c.lower, 'climit ' + cls(i) + (lim ? '' : ' faint'));
      if (c.watchHigh) b += path(c.upper, 'climit ' + cls(i) + (lim ? '' : ' faint'));
    });
    // Points are coloured by batch, even when one pooled line is fitted through all of them.
    const order = r.batches.map(b => b.name);
    r.rows.forEach(p => {
      const i = Math.max(0, order.indexOf(p.batch));
      b += '<g data-tip="' + h(p.batch + ' · month ' + p.time + ' · ' + f3(p.y)) + '"><circle class="pt ' + cls(i) + '" cx="' + sx(p.time) + '" cy="' + sy(p.y) + '" r="3.8"/></g>';
    });
    if (r.shelfLife <= xMax) {
      b += '<line class="target-line" x1="' + sx(r.shelfLife) + '" x2="' + sx(r.shelfLife) + '" y1="' + T + '" y2="' + (H - B) + '"/>' +
        '<text class="lbl-strong" x="' + (sx(r.shelfLife) + 5) + '" y="' + (T + 12) + '">' + f2(r.shelfLife) + ' months</text>';
    }
    if (r.maxTime <= xMax) b += '<line class="data-end" x1="' + sx(r.maxTime) + '" x2="' + sx(r.maxTime) + '" y1="' + T + '" y2="' + (H - B) + '"/>';
    b += '<text class="lbl-strong" x="' + ((L + W - R) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">Months</text>';
    b += '<text class="lbl-strong" transform="translate(14 ' + ((T + H - B) / 2) + ') rotate(-90)" text-anchor="middle">' + h($('stab-y').value) + '</text>';
    el.innerHTML = '<svg class="chart stab-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Stability trend with confidence limit and specification">' + b + '</svg>' +
      CH.legend(r.batches.map((bt, i) => ({ label: bt.name + (r.limiting.name === bt.name ? ' (sets the shelf life)' : ''), cls: 'pt ' + cls(i) }))
        .concat([{ label: 'solid: fitted trend · dashed: ' + Math.round(r.confidence * 100) + '% confidence limit', cls: 'pt', shape: 'square' },
          { label: 'vertical dotted: last real data point', cls: 'pt', shape: 'square' }]));
  }

  // ---------- results ----------
  function render(r) {
    last = r;
    const tile = (lbl, val, sub, hero) => '<div class="tile' + (hero ? ' hero-tile' : '') + '"><div class="lbl">' + h(lbl) + '</div><div class="val">' + h(val) + '</div><div class="sub">' + h(sub || '') + '</div></div>';
    const verdictClass = r.startsOutOfSpec ? 'not' : r.capped ? 'marginal' : 'capable';
    const headline = r.startsOutOfSpec ? 'Already outside specification at time zero'
      : r.capped ? f2(r.allowed) + ' months (capped)' : months(r.reported);

    const tiles = tile('Shelf life', headline, r.capped ? 'statistically ' + f2(r.shelfLife) + ', capped by the Q1E extrapolation rule' : 'where the ' + Math.round(r.confidence * 100) + '% limit meets the specification', true) +
      tile('Batch pooling', { A: 'Not pooled', B: 'Common slope only', C: 'Fully pooled' }[r.model], r.modelLabel) +
      tile('Data in hand', f2(r.maxTime) + ' months', r.rows.length + ' measurements, ' + r.batches.length + ' batch' + (r.batches.length === 1 ? '' : 'es')) +
      tile('Limiting batch', r.limiting.name, 'slope ' + f3(r.limiting.slope) + ' per month');

    const tests = r.tests.length ? '<h4>Poolability tests (ICH Q1E)</h4><div class="table-scroll"><table><thead><tr><th>Test</th><th class="num-cell">F</th><th class="num-cell">df</th><th class="num-cell">p</th><th>At level ' + r.poolAlpha + '</th></tr></thead><tbody>' +
      r.tests.map(t => '<tr><td>' + h(t.name) + '</td><td class="num-cell">' + f3(t.f) + '</td><td class="num-cell">' + t.df1 + ', ' + t.df2 + '</td><td class="num-cell">' + S.fmtP(t.p) + '</td><td><span class="verdict ' + (t.pass ? 'capable' : 'not') + '">' + (t.pass ? 'may be pooled' : 'kept separate') + '</span></td></tr>').join('') +
      '</tbody></table></div>' : '';

    const perBatch = '<h4>Each batch on its own</h4><p class="hint">Every batch fitted separately, whatever the pooling tests decided. ' +
      (r.model === 'C' ? 'The reported shelf life comes from the pooled line, which is tighter than any single batch because it rests on more data.' : 'The shortest of these sets the shelf life.') + '</p>' +
      '<div class="table-scroll"><table><thead><tr><th>Batch</th><th class="num-cell">Points</th><th class="num-cell">Months covered</th><th class="num-cell">Slope / month</th><th class="num-cell">Value at t=0</th><th class="num-cell">R&sup2;</th><th class="num-cell">Shelf life alone</th></tr></thead><tbody>' +
      r.batches.map(b => '<tr><td>' + h(b.name) + (r.limiting.name === b.name ? ' <span class="chip target">limiting</span>' : '') + '</td><td class="num-cell">' + b.n + '</td><td class="num-cell">' + f2(b.first) + ' to ' + f2(b.last) + '</td>' +
        '<td class="num-cell">' + f3(b.slope) + '</td><td class="num-cell">' + f2(b.intercept) + '</td><td class="num-cell">' + f3(b.r2) + '</td><td class="num-cell">' + (b.alone === null ? '–' : f2(b.alone)) + '</td></tr>').join('') + '</tbody></table></div>';

    const notes = [];
    notes.push('Shelf life is read where the ' + Math.round(r.confidence * 100) + '% one-sided confidence limit of the ' + (r.model === 'C' ? 'pooled regression line' : 'limiting batch') + ' meets the ' + (r.limiting.which === 'lower' ? 'lower' : 'upper') + ' specification limit, as ICH Q1E directs.');
    notes.push('Poolability was tested at level ' + r.poolAlpha + '. ' + r.why);
    if (r.extrapolated) notes.push('This runs past the ' + f2(r.maxTime) + ' months of data you have. Q1E allows a shelf life of at most twice the data period, and no more than 12 months beyond it: ' + f2(r.allowed) + ' months here.' + (r.capped ? ' The reported figure is capped at that.' : ''));
    else notes.push('The shelf life sits inside the ' + f2(r.maxTime) + ' months of data, so no extrapolation is involved.');
    if (r.limiting.df < 6) notes.push('Only ' + r.limiting.df + ' degrees of freedom for error: the confidence limit is wide and the estimate is soft. More time points would tighten it.');
    if (r.batches.length < 3) notes.push('ICH Q1A/Q1E expects at least three primary batches for a registration shelf life. This study has ' + r.batches.length + '.');

    const plainTone = r.startsOutOfSpec ? 'not' : r.capped ? 'marginal' : 'capable';
    const plainText = r.startsOutOfSpec
      ? 'This material is already outside its specification at time zero, so no shelf life can be set from it. Check the specification limits and the units before reading anything else here.'
      : 'On this data you can support a shelf life of about ' + f2(r.reported) + ' months. That is not where the average batch crosses the limit — it is where you can still be confident it has not, which is what the guideline requires and is always the earlier date. ' +
        (r.model === 'C' ? 'The batches behaved alike, so they were pooled into one trend.' : 'The batches differed, so they were kept apart and the worst one set the date.') +
        (r.capped ? ' The statistics alone suggested ' + f2(r.shelfLife) + ' months, but you only have ' + f2(r.maxTime) + ' months of data, so the claim is capped at ' + f2(r.allowed) + '.' : '');
    $('stab-out').innerHTML = '<div class="card stab-result"><h3>Shelf-life estimate</h3>' +
      '<div class="plain ' + plainTone + '"><h4>In plain English</h4><p>' + h(plainText) + '</p></div>' +
      '<p class="sub-head"><span class="verdict ' + verdictClass + '">' + h(headline) + '</span></p>' +
      '<div class="tiles">' + tiles + '</div>' +
      '<div id="stab-chart"></div>' + tests + perBatch +
      '<h4>What was done, and what it rests on</h4><ul class="insights">' + notes.map(n => '<li class="info">' + h(n) + '</li>').join('') + '</ul>' +
      '<div class="row-actions"><button class="btn primary" type="button" id="stab-csv">Download the Q1E report (.csv)</button></div>' +
      '<p class="hint">Decision support, not a validated stability system. A shelf life in a regulatory submission needs software validated for that purpose, and an independent check of this arithmetic.</p>' +
      '</div>';
    drawChart($('stab-chart'), r);
    $('stab-csv').addEventListener('click', () => download('ich-q1e-shelf-life.csv', reportCSV(r), 'text/csv'));
    // The audit package picks this up when an analysis report is exported in the other tab.
    window.MLStabilityRun = summary(r);
  }

  function summary(r) {
    return {
      when: new Date().toISOString(), model: r.model, modelLabel: r.modelLabel, why: r.why,
      shelfLife: r.shelfLife, reported: r.reported, capped: r.capped, extrapolated: r.extrapolated,
      maxTime: r.maxTime, allowed: r.allowed, confidence: r.confidence, poolAlpha: r.poolAlpha,
      lsl: r.lsl, usl: r.usl, direction: r.direction, limiting: r.limiting.name,
      measurements: r.rows.length, batches: r.batches, tests: r.tests.map(t => ({ name: t.name, f: t.f, df1: t.df1, df2: t.df2, p: t.p, pass: t.pass })),
      columns: { time: $('stab-time').value, batch: $('stab-batch').value, result: $('stab-y').value, condition: $('stab-cond').value, conditionValue: $('stab-cond-value').value }
    };
  }

  function reportCSV(r) {
    const q = v => '"' + String(v).replace(/"/g, '""') + '"';
    const L = [];
    L.push(['ICH Q1E shelf-life report']);
    L.push(['Generated', q(new Date().toISOString())]);
    L.push(['Computed', q('In the browser. No data was uploaded or stored.')]);
    L.push([]);
    L.push(['Setting', 'Value']);
    L.push(['Time column', q(r0('stab-time'))], ['Batch column', q(r0('stab-batch'))], ['Result column', q(r0('stab-y'))]);
    if ($('stab-cond').value) L.push(['Condition column', q(r0('stab-cond'))], ['Condition kept', q($('stab-cond-value').value || 'all')]);
    L.push(['Lower specification limit', r.lsl === null ? '' : r.lsl], ['Upper specification limit', r.usl === null ? '' : r.usl]);
    L.push(['Attribute direction', r.direction], ['Confidence', Math.round(r.confidence * 100) + '% one-sided'], ['Poolability level', r.poolAlpha]);
    L.push(['Measurements', r.rows.length], ['Batches', r.batches.length], ['Months of data', r.maxTime]);
    L.push([]);
    L.push(['Poolability test', 'F', 'df1', 'df2', 'p', 'Outcome']);
    r.tests.forEach(t => L.push([q(t.name), t.f, t.df1, t.df2, t.p, t.pass ? 'may be pooled' : 'kept separate']));
    L.push([]);
    L.push(['Model used', q(r.modelLabel)], ['Reason', q(r.why)]);
    L.push([]);
    L.push(['Batch', 'Points', 'First month', 'Last month', 'Slope per month', 'Value at t=0', 'R2', 'Shelf life alone (months)']);
    r.batches.forEach(b => L.push([q(b.name), b.n, b.first, b.last, b.slope, b.intercept, b.r2, b.alone === null ? '' : b.alone]));
    L.push([]);
    L.push(['Limiting batch', q(r.limiting.name)]);
    L.push(['Shelf life (statistical)', r.shelfLife]);
    L.push(['Q1E extrapolation cap', r.allowed]);
    L.push(['Shelf life (reported)', r.reported]);
    L.push([]);
    L.push(['Batch', 'Month', 'Result', 'Condition']);
    r.rows.forEach(p => L.push([q(p.batch), p.time, p.y, q(p.condition || '')]));
    L.push([]);
    L.push([q('Decision support, not a validated stability system. A shelf life in a regulatory submission needs software validated for that purpose, and an independent check of this arithmetic.')]);
    return L.map(x => x.join(',')).join('\n') + '\n';
  }
  const r0 = id => $(id).value;

  // ---------- example studies ----------
  /* Both examples are made here rather than copied from a real filing: a well-behaved study
     whose batches pool, and one whose batches degrade at visibly different rates. */
  function example(spread) {
    const r = E.rng(spread ? 19 : 4);
    const lines = ['BatchID,Month,Condition,Purity_Pct'];
    const specs = spread
      ? [{ b: 'B-101', i: 99.6, m: -0.09 }, { b: 'B-102', i: 99.4, m: -0.22 }, { b: 'B-103', i: 99.5, m: -0.36 }]
      : [{ b: 'B-201', i: 99.5, m: -0.16 }, { b: 'B-202', i: 99.45, m: -0.16 }, { b: 'B-203', i: 99.55, m: -0.16 }];
    const noise = spread ? 0.25 : 0.55;
    for (const s of specs) for (const t of [0, 3, 6, 9, 12, 18, 24]) {
      lines.push([s.b, t, '25C/60RH', (s.i + s.m * t + (r() - 0.5) * noise).toFixed(2)].join(','));
      lines.push([s.b, t, '40C/75RH', (s.i + s.m * 3.4 * t + (r() - 0.5) * noise * 1.6).toFixed(2)].join(','));
    }
    return lines.join('\n');
  }

  /* Two failure records, drawn from Weibull lifetimes with the record cut off at a fixed age
     so that some units are genuinely still running. The second one matters more than the
     first: its point estimate of the shape lands near 1.4, which reads as wear-out, but the
     interval covers 1 and the tool refuses the replacement interval. That refusal is the
     thing worth seeing, because a spreadsheet would have printed the 1.4 and stopped. */
  function relExample(random) {
    const beta = random ? 1.0 : 2.3, eta = random ? 3000 : 4200;
    const n = random ? 20 : 26, end = random ? 4000 : 5000;
    const r = E.rng(random ? 9 : 3);
    const what = random ? 'Actuator' : 'Seal';
    const lines = ['Unit,Hours_In_Service,Status'];
    for (let i = 0; i < n; i++) {
      const t = eta * Math.pow(-Math.log(1 - r()), 1 / beta);
      lines.push(t > end
        ? [what + '-' + String(i + 1).padStart(2, '0'), end, 'still running'].join(',')
        : [what + '-' + String(i + 1).padStart(2, '0'), Math.round(t), 'failed'].join(','));
    }
    return lines.join('\n');
  }

  function run() {
    $('stab-error').hidden = true;
    let rows, opts;
    try { rows = readRows(); opts = readOpts(); } catch (e) { return fail(e.message); }
    try {
      render(window.MLStability.analyze(rows.rows, opts));
      $('stab-out').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { fail(e.message); }
  }

  function showStabMode() {
    const m = $('stab-mode').value, fc = m === 'forecast', rel = m === 'reliability';
    $('stab-fc').hidden = !fc || !table;
    if ($('stab-rel')) $('stab-rel').hidden = !rel || !table;
    $('stab-map').hidden = fc || rel || !table;
    $('stab-settings').hidden = fc || rel || !table;
    /* The example buttons load different shapes of data per mode. A stability study has no
       failure times in it and a failure record has no batches, so offering the wrong example
       just produces a confusing refusal. */
    if ($('stab-sample3')) {
      $('stab-sample3').hidden = !rel;
      $('stab-sample4').hidden = !rel;
      $('stab-sample').hidden = rel;
      $('stab-sample2').hidden = rel;
    }
    $('stab-out').innerHTML = ''; $('stab-error').hidden = true;
  }

  // ---------- equipment life (Weibull) ----------
  const RELTIME = /hour|cycle|^time|age|life|day|run ?time|service|tbf|mile|batch(es)? ?run/i;
  const RELCENS = /status|censor|suspend|surviv|still|running|failed?|event|state|outcome/i;
  const RELRUN = /run|censor|suspend|surviv|alive|^no$|^n$|^0$|in ?service|ongoing|active|right/i;

  function fillReliability(t) {
    const prof = E.profile(t);
    const numeric = prof.columns.filter(c => c.kind === 'numeric' || c.kind === 'id').map(c => c.name);
    const timeCol = t.columns.filter(c => numeric.includes(c)).find(c => RELTIME.test(c)) ||
      t.columns.filter(c => numeric.includes(c)).pop() || t.columns[0];
    const censCol = t.columns.filter(c => c !== timeCol).find(c => RELCENS.test(c)) || '';
    $('rel-time').innerHTML = t.columns.map(c => '<option' + (c === timeCol ? ' selected' : '') + '>' + h(c) + '</option>').join('');
    $('rel-cens').innerHTML = '<option value="">(none \u2013 every row is a failure)</option>' +
      t.columns.map(c => '<option' + (c === censCol ? ' selected' : '') + '>' + h(c) + '</option>').join('');
    fillCensValues();
  }

  function fillCensValues() {
    const c = $('rel-cens').value, sel = $('rel-cens-value'), wrap = sel.parentNode;
    if (!c || !table) { sel.innerHTML = ''; wrap.hidden = true; return; }
    wrap.hidden = false;
    const i = table.columns.indexOf(c);
    const vals = Array.from(new Set(table.rows.map(r => String(r[i]).trim()).filter(v => v !== '')));
    const guess = vals.find(v => RELRUN.test(v));
    sel.innerHTML = vals.map(v => '<option' + (v === guess ? ' selected' : '') + '>' + h(v) + '</option>').join('');
  }

  /* A row is censored when the status column holds the value the user named as "still
     running". Anything else - including a blank - is read as a failure, which is the
     conservative direction: miscounting a running unit as failed shortens the life
     estimate, and shortening it never justifies maintenance that the data does not. */
  function runReliability() {
    $('stab-error').hidden = true;
    const R = window.MLReliability;
    if (!R) return fail('The reliability module did not load.');
    if (!table) return fail('Load some data first.');
    const ti = table.columns.indexOf($('rel-time').value);
    if (ti < 0) return fail('Pick the column holding the time in service.');
    const ci = $('rel-cens').value ? table.columns.indexOf($('rel-cens').value) : -1;
    const runs = $('rel-cens-value').value;
    const rows = table.rows.map(r => {
      const t = E.toNumber(r[ti]);
      if (t === null) return null;
      return { time: t, censored: ci >= 0 && String(r[ci]).trim() === runs };
    }).filter(Boolean);
    try {
      renderReliability(R.analyze(rows), ci >= 0);
      $('stab-out').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { fail(e.message); }
  }

  function renderReliability(r, hadCensorColumn) {
    const unit = $('rel-time').value;
    const t4 = v => (isFinite(v) ? Number(v).toPrecision(4) : '\u2013');
    const verdict = r.coversOne
      ? { k: 'Cannot be told apart from random', s: 'a replacement interval is not supported' }
      : r.beta > 1
        ? { k: 'Wearing out', s: 'a replacement interval is supported' }
        : { k: 'Infant mortality', s: 'replacing on a schedule would make it worse' };

    $('stab-out').innerHTML = '<div class="card"><h3>Equipment life: what the failure pattern licenses you to do</h3>' +
      '<div class="tiles">' +
      '<div class="tile hero-tile"><div class="lbl">Failure pattern</div><div class="val">' + h(verdict.k) + '</div><div class="sub">' + h(verdict.s) + '</div></div>' +
      '<div class="tile"><div class="lbl">Shape (&beta;)</div><div class="val">' + f2(r.beta) + '</div><div class="sub">95% interval ' + f2(r.betaCi[0]) + ' to ' + f2(r.betaCi[1]) + '</div></div>' +
      '<div class="tile"><div class="lbl">Characteristic life (&eta;)</div><div class="val">' + t4(r.eta) + '</div><div class="sub">63% have failed by here</div></div>' +
      '<div class="tile"><div class="lbl">B10 life</div><div class="val">' + t4(r.b10) + '</div><div class="sub">one in ten has failed' +
        (r.preventiveReplacementJustified ? '' : ' \u2013 not an interval here') + '</div></div>' +
      '<div class="tile"><div class="lbl">Mean life</div><div class="val">' + t4(r.mtbf) + '</div><div class="sub">read it with &beta; = ' + f2(r.beta) + ', not alone</div></div>' +
      '<div class="tile"><div class="lbl">Records used</div><div class="val">' + r.failures + '</div><div class="sub">failures' + (r.censored ? ', plus ' + r.censored + ' still running' : ', none still running') + '</div></div>' +
      '</div>' +
      (r.fitCorrelation === null ? '' : '<p class="demo-read"><b>Weibull probability plot correlates at ' + f3(r.fitCorrelation) + '.</b> ' +
        (r.fitCorrelation < 0.95
          ? 'That is poor. The Weibull may be the wrong description of this equipment, and every number above rests on it \u2013 treat them as indicative and look at the times themselves before acting.'
          : 'That is consistent with a Weibull being a reasonable description of this equipment.') + '</p>') +
      '<p class="why">' + h(r.why) + '</p>' +
      '<div id="rel-surv" class="chart"></div>' +
      '<div id="rel-haz" class="chart"></div>' +
      '<details class="howto" open><summary>How to read this, and what to do about it</summary><div class="howto-body">' +
      '<p><b>The shape &beta; is the whole question.</b> It says which way the failure rate is moving with age, and the three answers call for three different, non-overlapping actions. Below 1, failures get <i>less</i> frequent as a unit ages: that is infant mortality, and it is a commissioning, installation or burn-in problem. At 1, the rate is flat \u2013 the thing fails at random, age tells you nothing, and preventive replacement buys nothing while still costing the labour and the fresh installation risk. Above 1, failures get more frequent with age, and replacing before the age where the rate climbs genuinely removes failures.</p>' +
      '<p><b>Why the interval decides it and not the point estimate.</b> This read ' + f2(r.beta) + ', but the 95% interval runs ' + f2(r.betaCi[0]) + ' to ' + f2(r.betaCi[1]) + '. ' +
      (r.coversOne
        ? 'That interval covers 1, so a flat failure rate is still a live explanation of this data. Scheduling replacements on this basis would be spending maintenance money on a pattern that has not been shown to exist. The fix is more failures, not a bolder reading of the ones you have.'
        : 'The whole interval sits ' + (r.beta > 1 ? 'above' : 'below') + ' 1, so the direction is established, not just suggested.') + '</p>' +
      (!r.smallSample ? '' : '<p><b>Small-sample warning, measured not quoted.</b> With ' + r.failures + ' failures the fitting method itself overstates &beta;. Simulated at a true shape of 2.0, the estimate runs about <b>21% high at 8 failures</b>, 13% at 12, 8% at 20 and 4% at 40. That bias points towards wear-out \u2013 the finding that justifies spending money \u2013 so a shape only a little above 1 on this many failures is not yet evidence.</p>') +
      '<p><b>Censoring.</b> ' + (hadCensorColumn
        ? 'Units still running when the record ended were carried through the fit as censored \u2013 they contribute what is known (they lasted at least that long) without pretending to be failures. ' + (r.censored ? 'There were ' + r.censored + ' of them here. ' : 'There were none in this data. ')
        : 'No status column was given, so every row was read as a failure. ') +
      'If running units are dropped, or their age entered as a failure time, the life estimate comes out short and the shape comes out high \u2013 both in the direction that wrongly recommends preventive replacement.</p>' +
      '<p><b>What to do with the numbers.</b> If the pattern is wear-out, B10 (' + t4(r.b10) + ') is the usual starting point for a replacement interval, because it is the age by which one unit in ten has already failed. Then weigh the cost of a planned replacement against the cost of a failure in service: the cheaper the failure, the longer you let it run. If the pattern is infant mortality, nothing here is a schedule \u2013 it is a signal to look at how the unit is installed and commissioned. If the pattern cannot be told apart from random, run to failure and keep the spare on the shelf.</p>' +
      '<p><b>What this does not cover.</b> One failure mode at a time. A pump that fails from seal wear <i>and</i> from random bearing debris mixes two shapes into one, and the fit will land somewhere between them and describe neither \u2013 split the record by failure mode first. The model also assumes each unit is in the same duty: mixing a hard-run line with a standby unit mixes two lifetimes. And the mean life is a mean, not a safe operating age; at &beta; = ' + f2(r.beta) + ' about ' + Math.round(100 * (1 - r.reliabilityAt(r.mtbf))) + '% have already failed by the mean.</p>' +
      '</div></details></div>';

    const ticks = CH.niceTicks(0, r.curve[r.curve.length - 1].t, 5);
    CH.lines($('rel-surv'), [{ name: 'Still running', points: r.curve.map(p => ({ x: p.t, y: p.reliability, tip: 'By ' + t4(p.t) + ': ' + Math.round(p.reliability * 100) + '% still running' })) }],
      { noDots: true, xTicks: ticks, xLabel: unit, yLabel: 'Fraction still running', yDomain: [0, 1], label: 'Survival curve' });
    CH.lines($('rel-haz'), [{ name: 'Failure rate', points: r.curve.map(p => ({ x: p.t, y: p.hazard, tip: 'At ' + t4(p.t) + ': failure rate ' + p.hazard.toPrecision(3) })) }],
      { noDots: true, xTicks: ticks, xLabel: unit, yLabel: 'Failure rate at that age', label: 'Hazard curve' });
  }

  /* The series is one numeric column in time order. Rows are taken as given: a series whose
     order has been shuffled by a spreadsheet sort is a different series, and nothing here
     can detect that, so the order you load is the order it forecasts. */
  function runForecast() {
    $('stab-error').hidden = true;
    const F = window.MLForecast;
    if (!F) return fail('The forecasting module did not load.');
    if (!table) return fail('Load some data first.');
    const i = table.columns.indexOf($('fc-series').value);
    if (i < 0) return fail('Pick the column holding the series.');
    const vals = table.rows.map(r => E.toNumber(r[i])).filter(v => v !== null);
    const period = $('fc-period').value === '' ? null : Number($('fc-period').value);
    const horizon = $('fc-horizon').value === '' ? 1 : Number($('fc-horizon').value);
    try {
      renderForecast(F.backtest(vals, { period, horizon }), vals);
      $('stab-out').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { fail(e.message); }
  }

  function renderForecast(r, vals) {
    const f3 = x => (x === null || x === undefined || !isFinite(x) ? '\u2013' : Number(x).toFixed(3));
    const beat = r.beatsBaseline;
    $('stab-out').innerHTML = '<div class="card"><h3>Backtest: every method scored on forecasts made before the answer was known</h3>' +
      '<div class="table-scroll"><table class="pm"><thead><tr><th>Method</th><th>MASE</th><th>MAE</th><th>RMSE</th><th>Bias</th></tr></thead><tbody>' +
      r.results.map(m => '<tr' + (m.key === r.winner.key ? ' class="hi"' : '') + '><td>' + h(m.name) + (m.baseline ? ' <b>(baseline)</b>' : '') +
        '</td><td>' + f3(m.mase) + '</td><td>' + f3(m.mae) + '</td><td>' + f3(m.rmse) + '</td><td>' + f3(m.bias) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<div class="tiles">' +
      '<div class="tile hero-tile"><div class="lbl">Use this method</div><div class="val">' + h(beat === false ? (r.baseline ? r.baseline.name : r.winner.name) : r.winner.name) +
        '</div><div class="sub">' + (beat === false ? 'nothing beat the baseline' : 'MASE ' + f3(r.winner.mase)) + '</div></div>' +
      '<div class="tile"><div class="lbl">Rolling origins</div><div class="val">' + r.origins + '</div><div class="sub">' + r.horizon + ' step' + (r.horizon === 1 ? '' : 's') + ' ahead each</div></div>' +
      (r.interval ? '<div class="tile"><div class="lbl">Interval half-width</div><div class="val">\u00b1' + f3(r.interval.halfWidth) +
        '</div><div class="sub">caught ' + Math.round(r.interval.coverage * 100) + '% of ' + Math.round(r.interval.confidence * 100) + '% claimed</div></div>' : '') +
      '</div>' +
      (!r.forecast ? '' : '<p class="demo-read"><b>Next ' + r.horizon + ':</b> ' + r.forecast.map(v => f3(v)).join(', ') +
        (r.interval ? ' (each \u00b1' + f3(r.interval.halfWidth) + ')' : '') + '</p>') +
      '<p class="why">' + h(r.why) + '</p>' +
      '<details class="howto" open><summary>How to read this, and what it means</summary><div class="howto-body">' +
      '<p><b>' + (beat === false
        ? 'Nothing here earned its place. The baseline scored at least as well as every method tried, so forecast with the baseline and treat anything fancier as unproven on this series. That is a real result, not a failure of the tool - most short, noisy process series are genuinely hard to beat.'
        : 'The winning method beat the baseline over ' + r.origins + ' separate forecasts, each made without seeing what came next.') + '</b></p>' +
      '<p><b>MASE.</b> The error divided by the one-step error the baseline makes. ' + (r.maseIsDirect
        ? 'At one step ahead, below 1 is better than the baseline and at or above 1 is not.'
        : 'The scale stays the one-step error even though you are forecasting ' + r.horizon + ' ahead, so figures above 1 are normal here. The comparison that decides it is the baseline row, scored over the same origins.') + '</p>' +
      '<p><b>Bias</b> is the average signed error. Near zero means the method is as often high as low; a persistent sign means it is systematically chasing or lagging the series, which is worth more attention than a slightly better MASE.</p>' +
      '<p><b>What this does not cover.</b> A forecast assumes the future behaves like the past. A planned change, a new raw-material lot or a line modification breaks that, and nothing here detects it - check whether anything changed before trusting a number a month out.</p>' +
      '</div></details></div>';
  }

  function clear() {
    table = null; last = null; window.MLStabilityRun = null;
    $('stab-data').value = ''; $('stab-out').innerHTML = ''; $('stab-read').textContent = '';
    $('stab-map').hidden = true; $('stab-settings').hidden = true; $('stab-error').hidden = true; $('stab-file').value = '';
    if ($('stab-rel')) $('stab-rel').hidden = true;
  }

  /* An attribute that only falls can never breach an upper limit, so asking for one is
     noise. "Decide from the data" keeps both, because the direction is not known yet. */
  function showRelevantLimits() {
    const d = $('stab-dir').value;
    $('stab-lsl-wrap').hidden = d === 'increasing';
    $('stab-usl-wrap').hidden = d === 'decreasing';
    if (d === 'increasing') $('stab-lsl').value = '';
    if (d === 'decreasing') $('stab-usl').value = '';
  }

  function init() {
    const load = text => { $('stab-data').value = text; $('stab-error').hidden = true; $('delete-top').hidden = false; loadText(text); };
    $('stab-sample').addEventListener('click', () => load(example(false)));
    $('stab-sample2').addEventListener('click', () => load(example(true)));
    $('stab-clear').addEventListener('click', clear);
    $('stab-data').addEventListener('change', () => { if ($('stab-data').value.trim()) { $('delete-top').hidden = false; loadText($('stab-data').value); } });
    $('stab-file').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const fr = new FileReader();
      fr.onload = () => load(String(fr.result));
      fr.readAsText(f);
    });
    ['stab-time', 'stab-batch', 'stab-y', 'stab-cond-value'].forEach(id => $(id).addEventListener('change', describe));
    $('stab-cond').addEventListener('change', () => { fillConditions(); describe(); });
    $('stab-run').addEventListener('click', run);
    if ($('stab-mode')) {
      $('stab-mode').addEventListener('change', showStabMode);
      $('fc-run').addEventListener('click', runForecast);
      if ($('stab-sample3')) {
        $('stab-sample3').addEventListener('click', () => load(relExample(false)));
        $('stab-sample4').addEventListener('click', () => load(relExample(true)));
        $('rel-run').addEventListener('click', runReliability);
        $('rel-cens').addEventListener('change', fillCensValues);
      }
      showStabMode();
    }
    $('stab-dir').addEventListener('change', showRelevantLimits);
    showRelevantLimits();
  }

  window.MLStab = { clear, example, relExample };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
