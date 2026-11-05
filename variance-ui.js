/* Variance components and Gage R&R.

   Two questions out of one piece of arithmetic. "Where is the variation coming from?" splits
   a total spread across named sources and names which groups actually differ. "Can my
   measurement system see it?" points the same split at an instrument: how much of what you
   observe is the method rather than the product.

   Everything runs here. Nothing is uploaded and nothing is kept after the page is closed. */
(function () {
  'use strict';
  const E = window.MLEngine, V = window.MLVariance, CH = window.Charts;
  const $ = id => document.getElementById(id);
  const h = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f2 = v => (isFinite(v) ? Number(v).toFixed(2) : '–');
  const f3 = v => (isFinite(v) ? Number(v).toFixed(3) : '–');
  const f4 = v => (isFinite(v) ? Number(v).toFixed(4) : '–');
  const pct = v => (isFinite(v) ? Number(v).toFixed(1) + '%' : '–');
  const pFmt = p => (p === null || p === undefined || !isFinite(p) ? '–' : p < 0.0001 ? '<0.0001' : p.toFixed(4));
  const mode = () => $('vc-mode').value;

  let table = null, last = null;

  function download(name, data, type) {
    const url = URL.createObjectURL(new Blob([data], { type: type + ';charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---------- what each mode is for, and what it needs ----------
  const MODE_DESC = {
    psd: 'Counts per size bin fitted as a distribution rather than as a handful of separate counts. The slope of count against size describes the shape; the nested fraction that reaches the larger threshold tests it. Two containers can report the same count at 10 micrometres and hold completely different populations, and it is the heavier tail - the large, rare particles - that matters most.',
    subgroup: 'Several measurements per batch or per time point, charted as the subgroup average with its spread. The spread chart is read first, because the limits on the averages are computed from it - and specification limits are never drawn here, because a subgroup mean is not a unit of product.',
    sites: 'Capability at each site, and whether the sites behave as one process at all. A single combined index is only reported when their centres and their spreads both survive a test; otherwise it is withheld, because one number over several different processes describes a mixture nobody runs.',
    components: 'Splits a total spread into between-group and within-group variation, says what share each owns, and names which groups genuinely differ rather than looking different by chance.',
    grr: 'Splits what you observe into repeatability, reproducibility and real part-to-part differences, and judges whether the measurement system is fit to make the decisions you make with it.',
    agree: 'For a judgement rather than a measurement: whether appraisers agree with themselves, with each other, and with the truth. Reports kappa beside the agreement percentage, because when the defect is rare an appraiser who passes everything scores high on the percentage and nothing on kappa.'
  };
  const SHAPES = {
    psd: '<p class="hint">One row per size bin: the threshold in micrometres and the count. Add a group column to compare containers, batches, lines or methods. USP &lt;788&gt; gives you the two thresholds below and that is enough to <em>test</em> the tail; a flow-imaging run with four or more bins is what lets the shape be <em>checked</em>.</p>' +
      '<div class="table-scroll"><table class="shape-table"><thead><tr><th>Batch</th><th>Size_um</th><th>Count_per_container</th></tr></thead><tbody>' +
      '<tr><td>B-401</td><td>10</td><td>3980</td></tr><tr><td>B-401</td><td>25</td><td>318</td></tr>' +
      '<tr><td>B-402</td><td>10</td><td>4040</td></tr><tr><td>B-402</td><td>25</td><td>471</td></tr>' +
      '<tr class="dim"><td colspan="3">&hellip; every threshold present for every group</td></tr></tbody></table></div>' +
      '<p class="hint">Counts are read as cumulative &mdash; at or above each size &mdash; because that is what a light obscuration counter reports and what the compendial thresholds mean. If yours are counts <em>within</em> each bin, say so in the dropdown and they will be summed from the largest bin down.</p>',
    subgroup: '<p class="hint">One row per measurement: which subgroup it belongs to, and the number. Two or more per subgroup, at least eight subgroups. Subgroup <em>within</em> a stream, not across them &mdash; a subgroup spanning two filling heads hides the difference between them inside the limits.</p>' +
      '<div class="table-scroll"><table class="shape-table"><thead><tr><th>Batch</th><th>Fill_Weight</th></tr></thead><tbody>' +
      '<tr><td>B-01</td><td>100.2</td></tr><tr><td>B-01</td><td>99.7</td></tr><tr><td>B-01</td><td>100.4</td></tr>' +
      '<tr><td>B-02</td><td>99.9</td></tr><tr class="dim"><td colspan="2">&hellip; same number per subgroup where you can</td></tr></tbody></table></div>',
    sites: '<p class="hint">One row per result: which site it came from, and the number. At least five results per site, and the specification limits below &mdash; capability is a comparison against a limit, so without one there is nothing to be capable of.</p>' +
      '<div class="table-scroll"><table class="shape-table"><thead><tr><th>Site</th><th>Purity_Pct</th></tr></thead><tbody>' +
      '<tr><td>Site A</td><td>98.2</td></tr><tr><td>Site A</td><td>97.9</td></tr><tr><td>Site B</td><td>97.1</td></tr>' +
      '<tr class="dim"><td colspan="2">&hellip; one row per batch, at least five per site</td></tr></tbody></table></div>',
    components: '<p class="hint">One row per measurement: which group it came from, and the number. Several measurements per group is what makes the split possible &mdash; with one each, there is nothing to compare the between-group spread against.</p>' +
      '<div class="table-scroll"><table class="shape-table"><thead><tr><th>Lot</th><th>Result</th></tr></thead><tbody>' +
      '<tr><td>L-2401</td><td>96.2</td></tr><tr><td>L-2401</td><td>96.6</td></tr><tr><td>L-2401</td><td>96.4</td></tr>' +
      '<tr><td>L-2402</td><td>94.1</td></tr><tr><td>L-2402</td><td>94.5</td></tr>' +
      '<tr class="dim"><td colspan="2">&hellip; and so on for every lot</td></tr></tbody></table></div>' +
      '<p class="hint">The groups can be anything you suspect: raw material lot, analyst, instrument, vessel, shift, site, day. Groups need not be the same size. Three groups is thin; six or more makes the between-group estimate worth quoting.</p>',
    grr: '<p class="hint">Every operator measures every sample, more than once. The repeats are what separate the instrument\'s own noise from the differences between people, so a study with one reading per cell cannot be analysed at all.</p>' +
      '<div class="table-scroll"><table class="shape-table"><thead><tr><th>Sample</th><th>Analyst</th><th>Result</th></tr></thead><tbody>' +
      '<tr><td>S-01</td><td>Analyst 1</td><td>98.4</td></tr><tr><td>S-01</td><td>Analyst 1</td><td>98.6</td></tr>' +
      '<tr><td>S-01</td><td>Analyst 2</td><td>98.9</td></tr><tr><td>S-01</td><td>Analyst 2</td><td>98.7</td></tr>' +
      '<tr><td>S-02</td><td>Analyst 1</td><td>95.1</td></tr>' +
      '<tr class="dim"><td colspan="3">&hellip; every sample measured by every analyst, the same number of times</td></tr></tbody></table></div>' +
      '<p class="hint">The usual study is 10 samples, 3 operators, 2 or 3 repeats, and the design must be complete and balanced. Pick samples that span the range you really see in production: a study run on ten near-identical samples will fail whatever the instrument does, because there is nothing for the method to resolve.</p>'
    ,
    agree: '<p class="hint">One row per look. Every appraiser judges every sample, more than once, and the calls are words rather than numbers &mdash; accept or reject, pass or fail. A known value per sample is optional but changes what can be answered.</p>' +
      '<div class="table-scroll"><table class="shape-table"><thead><tr><th>Vial</th><th>Inspector</th><th>Call</th><th>Known</th></tr></thead><tbody>' +
      '<tr><td>V-01</td><td>Ana</td><td>accept</td><td>accept</td></tr><tr><td>V-01</td><td>Ana</td><td>accept</td><td>accept</td></tr>' +
      '<tr><td>V-01</td><td>Ben</td><td>reject</td><td>accept</td></tr>' +
      '<tr><td>V-02</td><td>Ana</td><td>reject</td><td>reject</td></tr>' +
      '<tr class="dim"><td colspan="4">&hellip; every sample judged by every inspector, twice or more</td></tr></tbody></table></div>' +
      '<p class="hint">Build the sample set close to half good and half defective, however unrepresentative that feels. A set matching real production &mdash; a few percent defective &mdash; cannot support a miss rate: there is almost nothing to miss, and the appraiser who passes every vial comes out looking excellent.</p>'
  };
  const EXAMPLES = {
    psd: [['vc-ex1', 'Example: same count, heavier tail'], ['vc-ex2', 'Example: two bins, nothing checks the fit'], ['vc-ex3', 'Example: flow imaging, four bins']],
    subgroup: [['vc-ex1', 'Example: a stable filling line'], ['vc-ex2', 'Example: one subgroup blows out the spread'], ['vc-ex3', 'Example: two heads sampled into one subgroup']],
    sites: [['vc-ex1', 'Example: two sites, one process'], ['vc-ex2', 'Example: the sites are centred differently'], ['vc-ex3', 'Example: one site is far more variable']],
    components: [['vc-ex1', 'Example: one supplier lot is the problem'], ['vc-ex2', 'Example: the lots are fine, the assay is noisy'], ['vc-ex3', 'Example: analyst-to-analyst drift']],
    grr: [['vc-ex1', 'Example: a method fit for release'], ['vc-ex2', 'Example: one analyst out of step'], ['vc-ex3', 'Example: the instrument cannot resolve it']],
    agree: [['vc-ex1', 'Example: inspectors fit to qualify'], ['vc-ex2', 'Example: the rubber stamp'], ['vc-ex3', 'Example: one inspector over-rejects']]
  };

  // ---------- reading the data ----------
  const GROUP = /lot|batch|supplier|vendor|analyst|operator|instrument|vessel|reactor|shift|site|line|day|group|source|material/i;
  const PART = /sample|specimen|part|vial|lot|batch|aliquot|^id|id$/i;
  const OPER = /analyst|operator|instrument|system|device|gauge|technician|appraiser|column|lab/i;
  const VALUE = /result|value|assay|purity|potency|conc|content|titer|titre|measure|area|response|reading|%/i;
  const CALL = /call|rating|rated|judge|judgement|judgment|decision|disposition|verdict|accept|reject|pass|fail|result|grade|inspection/i;
  const TRUTH = /standard|known|truth|true|reference|master|expected|actual|gold|answer/i;
  const SIZE = /size|micron|micrometre|micrometer|\bum\b|\bu?m\b|diameter|threshold|bin|ecd/i;
  const COUNT = /count|particles?|number|^n$|per ?container|per ?ml|cumulative/i;

  function loadText(text) {
    let t;
    try { t = E.parseTable(text); } catch (e) { return fail('Could not read the data: ' + e.message); }
    if (!t.rows.length || t.columns.length < 2) return fail('No usable rows found. The first row should hold column names.');
    table = t;
    const prof = E.profile(t);
    const numeric = prof.columns.filter(c => c.kind === 'numeric').map(c => c.name);
    const value = numeric.find(c => VALUE.test(c)) || numeric[numeric.length - 1] || t.columns[t.columns.length - 1];
    const others = t.columns.filter(c => c !== value);
    const opt = (sel, cols, val) => { $(sel).innerHTML = cols.map(c => '<option' + (c === val ? ' selected' : '') + '>' + h(c) + '</option>').join(''); };
    opt('vc-value', t.columns, value);
    opt('vc-grr-value', t.columns, value);
    opt('vc-group', t.columns, others.find(c => GROUP.test(c)) || others[0] || value);
    const part = others.find(c => PART.test(c)) || others[0] || value;
    opt('vc-part', t.columns, part);
    opt('vc-operator', t.columns, others.find(c => c !== part && OPER.test(c)) || others.find(c => c !== part) || part);
    /* The agreement study's columns are all text, so the numeric guesses above are no help.
       The call is picked from the low-cardinality text columns, since a column holding two
       or three distinct words is what a judgement looks like. */
    const textCols = prof.columns.filter(c => c.kind !== 'numeric');
    const callish = textCols.filter(c => c.unique >= 2 && c.unique <= 8).map(c => c.name);
    const aPart = t.columns.find(c => PART.test(c)) || t.columns[0];
    const aOper = t.columns.find(c => c !== aPart && OPER.test(c)) || t.columns.find(c => c !== aPart) || aPart;
    const aCall = callish.find(c => c !== aPart && c !== aOper && CALL.test(c) && !TRUTH.test(c)) ||
      callish.find(c => c !== aPart && c !== aOper && !TRUTH.test(c)) || t.columns.find(c => c !== aPart && c !== aOper) || aPart;
    const aTruth = t.columns.find(c => TRUTH.test(c) && c !== aCall);
    opt('vc-a-part', t.columns, aPart);
    opt('vc-a-operator', t.columns, aOper);
    opt('vc-a-rating', t.columns, aCall);
    $('vc-a-standard').innerHTML = '<option value="">\u2014 none, judge agreement only \u2014</option>' +
      t.columns.map(c => '<option' + (c === aTruth ? ' selected' : '') + '>' + h(c) + '</option>').join('');
    /* The size column is the one holding the thresholds, which look like 2, 5, 10, 25 - a
       small set of repeated round numbers - while the count column holds large, mostly
       distinct values. Guessing by name first, then by that shape. */
    if ($('vc-psd-size')) {
      const sizeCol = t.columns.find(c => SIZE.test(c)) ||
        numeric.filter(c => new Set(t.rows.map(r => String(r[t.columns.indexOf(c)]))).size <= 8)[0] || numeric[0] || t.columns[0];
      const countCol = numeric.find(c => c !== sizeCol && COUNT.test(c)) || numeric.find(c => c !== sizeCol) || t.columns.find(c => c !== sizeCol) || sizeCol;
      opt('vc-psd-size', t.columns, sizeCol);
      opt('vc-psd-count', t.columns, countCol);
      const gcols = t.columns.filter(c => c !== sizeCol && c !== countCol);
      $('vc-psd-group').innerHTML = '<option value="">\u2014 none, one distribution \u2014</option>' +
        gcols.map(c => '<option' + (GROUP.test(c) ? ' selected' : '') + '>' + h(c) + '</option>').join('');
      fillPsdThresholds();
    }
    $('vc-settings').hidden = false;
    $('vc-error').hidden = true;
    describe();
  }

  /* The two tail-fraction thresholds come from the sizes actually present. Default to the
     widest pair, which is the most informative fraction the data supports. */
  function fillPsdThresholds() {
    if (!table || !$('vc-psd-lo')) return;
    const si = table.columns.indexOf($('vc-psd-size').value);
    const ci = table.columns.indexOf($('vc-psd-count').value);
    const sizes = Array.from(new Set(table.rows.map(r => E.toNumber(r[si])).filter(v => v !== null && v > 0))).sort((a, b) => a - b);
    /* The upper threshold defaults to the largest one that actually found something in every
       group. Defaulting to a threshold where the count is zero gives a fraction of 0% with a
       one-sided bound and nothing to compare, which is the least informative pair available -
       and it reads as a result rather than as a bad default. The option is still in the list. */
    const counted = sizes.filter(v => {
      const rows = table.rows.filter(r => E.toNumber(r[si]) === v);
      return rows.length > 0 && rows.every(r => { const c = E.toNumber(r[ci]); return c !== null && c > 0; });
    });
    const hi = counted.length > 1 ? counted[counted.length - 1] : sizes[sizes.length - 1];
    const lo = counted.length > 1 ? counted[0] : sizes[0];
    const o = (sel, val) => { $(sel).innerHTML = sizes.map(v => '<option' + (v === val ? ' selected' : '') + '>' + v + '</option>').join(''); };
    o('vc-psd-lo', lo);
    o('vc-psd-hi', hi);
  }

  function readRows() {
    if (!table) throw new Error('Load some measurements first.');
    const col = id => table.columns.indexOf($(id).value);
    if (mode() === 'components' || mode() === 'sites' || mode() === 'subgroup') {
      const gi = col('vc-group'), vi = col('vc-value');
      if (gi < 0 || vi < 0) throw new Error('Pick a grouping column and a result column.');
      if (gi === vi) throw new Error('The grouping column and the result column must be different.');
      const out = []; let skipped = 0;
      table.rows.forEach(r => {
        const value = E.toNumber(r[vi]);
        if (value === null) { skipped++; return; }
        out.push({ group: String(r[gi]).trim(), value });
      });
      if (!out.length) throw new Error('No numeric results found in "' + $('vc-value').value + '".');
      return { rows: out, skipped };
    }
    if (mode() === 'psd') {
      const si = col('vc-psd-size'), ci = col('vc-psd-count');
      const gi = $('vc-psd-group').value ? table.columns.indexOf($('vc-psd-group').value) : -1;
      if (si < 0 || ci < 0) throw new Error('Pick the column holding the size thresholds and the column holding the counts.');
      if (si === ci) throw new Error('The size column and the count column must be different.');
      if (gi >= 0 && (gi === si || gi === ci)) throw new Error('The group column must be a column of its own, not the size or the count.');
      const out = []; let skipped = 0;
      table.rows.forEach(r => {
        const size = E.toNumber(r[si]), count = E.toNumber(r[ci]);
        if (size === null || count === null) { skipped++; return; }
        out.push({ size, count, group: gi >= 0 ? String(r[gi]).trim() : '' });
      });
      if (!out.length) throw new Error('No rows with both a size and a count were found.');
      return { rows: out, skipped };
    }
    if (mode() === 'agree') {
      const ai = col('vc-a-part'), bi = col('vc-a-operator'), ci = col('vc-a-rating');
      const si = $('vc-a-standard').value ? table.columns.indexOf($('vc-a-standard').value) : -1;
      if (ai < 0 || bi < 0 || ci < 0) throw new Error('Pick a sample column, an appraiser column and the column holding the call.');
      if (ai === bi || ai === ci || bi === ci) throw new Error('The sample, appraiser and call columns must all be different.');
      if (si >= 0 && (si === ai || si === bi || si === ci)) throw new Error('The known value must be a column of its own, not one already used.');
      const out = []; let skipped = 0;
      table.rows.forEach(r => {
        const rating = String(r[ci] === undefined ? '' : r[ci]).trim();
        if (rating === '') { skipped++; return; }
        out.push({ part: String(r[ai]).trim(), operator: String(r[bi]).trim(), rating, standard: si >= 0 ? String(r[si] === undefined ? '' : r[si]).trim() : '' });
      });
      if (!out.length) throw new Error('No calls found in "' + $('vc-a-rating').value + '".');
      return { rows: out, skipped };
    }
    const pi = col('vc-part'), oi = col('vc-operator'), vi = col('vc-grr-value');
    if (pi < 0 || oi < 0 || vi < 0) throw new Error('Pick a sample column, an operator column and a result column.');
    if (pi === oi || pi === vi || oi === vi) throw new Error('The sample, operator and result columns must all be different.');
    const out = []; let skipped = 0;
    table.rows.forEach(r => {
      const value = E.toNumber(r[vi]);
      if (value === null) { skipped++; return; }
      out.push({ part: String(r[pi]).trim(), operator: String(r[oi]).trim(), value });
    });
    if (!out.length) throw new Error('No numeric results found in "' + $('vc-grr-value').value + '".');
    return { rows: out, skipped };
  }

  function describe() {
    try {
      const { rows, skipped } = readRows();
      const tail = skipped ? ' ' + skipped + ' row' + (skipped === 1 ? '' : 's') + ' skipped (no number in the result column).' : '';
      if (mode() === 'psd') {
        const sizes = Array.from(new Set(rows.map(r => r.size))).sort((a, b) => a - b);
        const g = Array.from(new Set(rows.map(r => r.group).filter(x => x !== '')));
        $('vc-read').textContent = rows.length + ' row' + (rows.length === 1 ? '' : 's') + ': ' + sizes.length + ' size threshold' + (sizes.length === 1 ? '' : 's') +
          ' (' + sizes.join(', ') + ' um)' + (g.length ? ' across ' + g.length + ' group' + (g.length === 1 ? '' : 's') + ' (' + g.slice(0, 6).join(', ') + (g.length > 6 ? '\u2026' : '') + ')' : ', one distribution') +
          '. ' + (sizes.length < 3 ? 'Two thresholds fit a two-parameter shape exactly, so the tail fraction can be tested but the shape itself cannot be checked.' : sizes.length < 4 ? 'Three thresholds give the power law one spare point to be checked against; a lognormal needs four.' : 'Enough thresholds to check the shape and compare candidate shapes.') + tail;
        return;
      }
      if (mode() === 'components') {
        const g = Array.from(new Set(rows.map(r => r.group)));
        const sizes = g.map(n => rows.filter(r => r.group === n).length);
        const lo = Math.min.apply(null, sizes), hi = Math.max.apply(null, sizes);
        $('vc-read').textContent = rows.length + ' measurements across ' + g.length + ' group' + (g.length === 1 ? '' : 's') +
          ' (' + g.slice(0, 6).map(x => x).join(', ') + (g.length > 6 ? '…' : '') + '), ' +
          (lo === hi ? lo + ' each' : lo + ' to ' + hi + ' each') + '.' + tail;
      } else if (mode() === 'agree') {
        const p = new Set(rows.map(r => r.part)), o = new Set(rows.map(r => r.operator)), c = new Set(rows.map(r => r.rating));
        const withStd = rows.filter(r => r.standard !== '').length;
        const cells = p.size * o.size;
        $('vc-read').textContent = rows.length + ' calls: ' + p.size + ' sample' + (p.size === 1 ? '' : 's') + ' \u00d7 ' + o.size + ' appraiser' + (o.size === 1 ? '' : 's') +
          (cells ? ', ' + (rows.length / cells === Math.round(rows.length / cells) ? (rows.length / cells) + ' look' + (rows.length / cells === 1 ? '' : 's') + ' each' : 'unevenly repeated') : '') +
          '. Calls used: ' + Array.from(c).slice(0, 6).join(', ') + (c.size > 6 ? '\u2026' : '') +
          (withStd ? '. Known value on ' + (withStd === rows.length ? 'every row' : withStd + ' of ' + rows.length + ' rows') + '.' : '. No known value, so accuracy cannot be judged.') + tail;
      } else {
        const p = new Set(rows.map(r => r.part)), o = new Set(rows.map(r => r.operator));
        const cells = p.size * o.size;
        $('vc-read').textContent = rows.length + ' measurements: ' + p.size + ' sample' + (p.size === 1 ? '' : 's') + ' × ' + o.size + ' operator' + (o.size === 1 ? '' : 's') +
          (cells ? ', ' + (rows.length / cells === Math.round(rows.length / cells) ? (rows.length / cells) + ' repeats each' : 'unevenly repeated') : '') + '.' + tail;
      }
    } catch (e) { $('vc-read').textContent = e.message; }
  }
  function fail(msg) { $('vc-error').textContent = msg; $('vc-error').hidden = false; }

  // ---------- charts ----------
  /* The whole answer in one bar: the total spread cut into its sources, by share of variance.
     Variance adds up and standard deviation does not, which is why the bar is in variance and
     the table quotes both. */
  function drawShare(el, parts, caption) {
    const W = Math.max(320, el.clientWidth || 700), H = 108, L = 0, R = 0, barY = 30, barH = 38;
    const total = parts.reduce((a, p) => a + p.value, 0);
    if (!(total > 0)) { el.innerHTML = '<p class="hint">Every source came out at zero: the measurements are identical.</p>'; return; }
    let x = L, b = '';
    parts.forEach((p, i) => {
      const w = (p.value / total) * (W - L - R);
      if (w <= 0) return;
      b += '<g data-tip="' + h(p.label + ' · ' + pct(p.value / total * 100) + ' of the variance')  + '">' +
        '<rect class="share c' + ((i % 4) + 1) + '" x="' + x + '" y="' + barY + '" width="' + Math.max(0.5, w) + '" height="' + barH + '"/></g>';
      if (w > 46) b += '<text class="lbl-strong on-bar" x="' + (x + w / 2) + '" y="' + (barY + barH / 2 + 5) + '" text-anchor="middle">' + pct(p.value / total * 100) + '</text>';
      x += w;
    });
    b += '<text class="lbl-strong" x="0" y="20">' + h(caption) + '</text>';
    let lx = 0;
    parts.forEach((p, i) => {
      b += '<rect class="share c' + ((i % 4) + 1) + '" x="' + lx + '" y="' + (barY + barH + 14) + '" width="11" height="11"/>' +
        '<text x="' + (lx + 16) + '" y="' + (barY + barH + 24) + '">' + h(p.label) + '</text>';
      lx += 26 + String(p.label).length * 6.6;
    });
    el.innerHTML = '<svg class="chart share-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + h(caption) + '">' + b + '</svg>';
  }

  // Every measurement, grouped, with each group's mean marked: an outlier cannot hide behind a mean.
  function drawGroups(el, r, rows, key) {
    const names = r.groups ? r.groups.map(g => g.name) : r.parts;
    const vals = rows.map(x => x.value);
    const rowH = 34, W = Math.max(320, el.clientWidth || 700);
    const H = 30 + rowH * names.length;
    const L = Math.min(170, 24 + Math.max.apply(null, names.map(n => n.length)) * 7.5), R = 22;
    let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const sx = v => L + (v - lo) / (hi - lo) * (W - L - R);
    let b = '';
    for (const t of CH.niceTicks(lo, hi, 5)) if (t >= lo && t <= hi) b += '<text x="' + sx(t) + '" y="' + (H - 6) + '" text-anchor="middle">' + f2(t) + '</text>';
    b += '<line class="zero" x1="' + sx(r.grand) + '" x2="' + sx(r.grand) + '" y1="14" y2="' + (H - 22) + '"/>';
    names.forEach((n, i) => {
      const y = 26 + i * rowH;
      const mine = rows.filter(x => String(x[key]).trim() === n);
      const m = mine.reduce((a, x) => a + x.value, 0) / (mine.length || 1);
      b += '<text class="lbl-strong" x="0" y="' + (y + 4) + '">' + h(n) + '</text>';
      b += '<line class="gridline" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/>';
      b += '<line class="mean-mark c' + ((i % 4) + 1) + '" x1="' + sx(m) + '" x2="' + sx(m) + '" y1="' + (y - 11) + '" y2="' + (y + 11) + '"/>';
      mine.forEach(x => { b += '<g data-tip="' + h(n + ' · ' + f3(x.value)) + '"><circle class="pt c' + ((i % 4) + 1) + '" cx="' + sx(x.value) + '" cy="' + y + '" r="4"/></g>'; });
    });
    el.innerHTML = '<svg class="chart strip-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Every measurement by group, with group means">' + b + '</svg>' +
      '<p class="hint">Every measurement, with the vertical mark at each group’s mean and the long line at the overall mean.</p>';
  }

  // ---------- plain English ----------
  function plainComponents(r, label) {
    const b = Math.round(r.icc * 100);
    if (r.negative || b < 10) {
      return 'The ' + label + 's are not the problem. Almost all of the spread you are seeing — about ' + (100 - b) + '% of it — happens between repeat measurements of the same ' + label + '. ' +
        'Chasing a ' + label + ' that looks high or low is chasing noise; if this spread matters, the measurement is where to go after it.';
    }
    if (b >= 70) {
      return 'The ' + label + 's really do differ, and that is where almost all of the spread lives: about ' + b + '% of the total. ' +
        'Repeat measurements of the same ' + label + ' agree well, so when a result looks different it is different. The ' + label + ' is a real lever, and worth the investigation.';
    }
    return 'Both things are happening. About ' + b + '% of the spread is genuine difference between ' + label + 's, and about ' + (100 - b) + '% is scatter between repeat measurements of the same one. ' +
      'Neither can be ignored: a single measurement is not enough to judge a ' + label + ', but the ' + label + 's are not interchangeable either.';
  }
  function plainGrr(r) {
    const basis = r.judgedOn === 'tolerance' ? 'the specification window' : 'the spread of the samples in this study';
    const head = r.judgedOn === 'tolerance' ? pct(r.pctTolerance) + ' of ' + basis : pct(r.pctStudyGrr) + ' of ' + basis;
    if (r.verdict === 'acceptable') {
      return 'The measurement system is good enough. It uses ' + head + ', which leaves the rest for real differences between samples, and it can tell about ' + (isFinite(r.ndc) ? r.ndc : 'many') + ' distinct levels apart. ' +
        'When this method says two samples differ, they differ.';
    }
    if (r.verdict === 'marginal') {
      return 'The measurement system is borderline. It uses ' + head + ', which is usable for monitoring a trend but thin for passing or failing an individual result against a limit. ' +
        (r.vReprod > r.vRepeat ? 'Most of that noise is between operators rather than within one, so training, a clearer method or a tighter procedure would help more than a new instrument.'
          : 'Most of that noise is the instrument repeating itself, so more replicates per result, or better equipment, is the lever.');
    }
    return 'The measurement system is not fit for this decision. It uses ' + head + ', so a large part of what you see on a certificate is the method rather than the material. ' +
      (r.vReprod > r.vRepeat ? 'The bigger share is disagreement between operators, which points at the method description and training before the hardware.'
        : 'The bigger share is the instrument failing to repeat itself on the same sample, which points at the hardware, the sample preparation or the number of replicates.') +
      (isFinite(r.ndc) && r.ndc < 5 ? ' It can only separate about ' + r.ndc + ' distinct levels, and the usual bar is five.' : '');
  }

  // ---------- results ----------
  const tile = (lbl, val, sub, hero) => '<div class="tile' + (hero ? ' hero-tile' : '') + '"><div class="lbl">' + h(lbl) + '</div><div class="val">' + h(val) + '</div><div class="sub">' + h(sub || '') + '</div></div>';
  const anovaTable = rows => '<div class="table-scroll"><table><thead><tr><th>Source</th><th class="num-cell">Sum of squares</th><th class="num-cell">df</th><th class="num-cell">Mean square</th><th class="num-cell">F</th><th class="num-cell">p</th></tr></thead><tbody>' +
    rows.map(a => '<tr><td>' + h(a.source) + '</td><td class="num-cell">' + f4(a.ss) + '</td><td class="num-cell">' + a.df + '</td><td class="num-cell">' + f4(a.ms) + '</td><td class="num-cell">' + (a.f === null ? '–' : f3(a.f)) + '</td><td class="num-cell">' + pFmt(a.p) + '</td></tr>').join('') +
    '</tbody></table></div>';
  const compTable = (comps, extra) => '<div class="table-scroll"><table><thead><tr><th>Source</th><th class="num-cell">Variance</th><th class="num-cell">Std dev</th><th class="num-cell">Share of variance</th>' + (extra ? '<th class="num-cell">% of total spread</th>' : '') + '</tr></thead><tbody>' +
    comps.map(c => '<tr><td>' + h(c.source) + '</td><td class="num-cell">' + f4(c.variance) + '</td><td class="num-cell">' + f4(c.sd) + '</td><td class="num-cell">' + pct(c.share * 100) + '</td>' + (extra ? '<td class="num-cell">' + pct(c.pctStudy) + '</td>' : '') + '</tr>').join('') +
    '</tbody></table></div>';

  function renderComponents(r, rows) {
    const label = ($('vc-group').value || 'group').replace(/[_-]+/g, ' ').toLowerCase();
    const cls = r.negative || r.icc < 0.1 ? 'capable' : r.icc >= 0.7 ? 'not' : 'marginal';
    const badge = r.negative || r.icc < 0.1 ? 'MEASUREMENT, NOT THE GROUPS' : r.icc >= 0.7 ? 'THE GROUPS DIFFER' : 'BOTH MATTER';
    const tiles = tile('Between ' + label + 's', pct(r.icc * 100), 'share of the total variance', true) +
      tile('Within ' + label + 's', pct((1 - r.icc) * 100), 'repeat measurements of the same one') +
      tile('Total spread', f3(r.sdTotal), 'standard deviation, all sources together') +
      tile('Groups differ?', r.significant ? 'Yes (p ' + pFmt(r.p) + ')' : 'Not shown (p ' + pFmt(r.p) + ')', 'one-way ANOVA F test');

    const diff = r.pairs.filter(p => p.different);
    const pairTable = '<h4>Which ' + h(label) + 's actually differ</h4>' +
      '<p class="hint">Tukey&rsquo;s method, holding ' + Math.round((1 - r.alpha) * 100) + '% confidence across all ' + r.pairs.length + ' comparison' + (r.pairs.length === 1 ? '' : 's') + ' at once. An interval that does not contain zero is a real difference.</p>' +
      '<div class="table-scroll"><table><thead><tr><th>Pair</th><th class="num-cell">Difference</th><th class="num-cell">' + Math.round((1 - r.alpha) * 100) + '% interval</th><th class="num-cell">p</th><th>Verdict</th></tr></thead><tbody>' +
      r.pairs.slice(0, 40).map(p => '<tr><td>' + h(p.a) + ' &minus; ' + h(p.b) + '</td><td class="num-cell">' + f3(p.diff) + '</td><td class="num-cell">' + f3(p.lower) + ' to ' + f3(p.upper) + '</td><td class="num-cell">' + pFmt(p.p) + '</td><td><span class="verdict ' + (p.different ? 'not' : 'capable') + '">' + (p.different ? 'differs' : 'no difference shown') + '</span></td></tr>').join('') +
      '</tbody></table></div>' + (r.pairs.length > 40 ? '<p class="hint">Showing the 40 largest differences of ' + r.pairs.length + '. The full set is in the report.</p>' : '');

    const groupTable = '<h4>Each ' + h(label) + '</h4><div class="table-scroll"><table><thead><tr><th>' + h(label.charAt(0).toUpperCase() + label.slice(1)) + '</th><th class="num-cell">Measurements</th><th class="num-cell">Mean</th><th class="num-cell">Std dev</th><th class="num-cell">Difference from overall</th></tr></thead><tbody>' +
      r.groups.slice().sort((a, b) => b.mean - a.mean).map(g => '<tr><td>' + h(g.name) + '</td><td class="num-cell">' + g.n + '</td><td class="num-cell">' + f3(g.mean) + '</td><td class="num-cell">' + (isFinite(g.sd) ? f3(g.sd) : '–') + '</td><td class="num-cell">' + (g.mean - r.grand >= 0 ? '+' : '') + f3(g.mean - r.grand) + '</td></tr>').join('') +
      '</tbody></table></div>';

    const notes = [];
    notes.push('Variance adds up; standard deviation does not. The shares above are shares of variance, which is why removing a source that owns 50% of the variance cuts the spread you feel by about 29%, not by half.');
    if (r.negative) notes.push('The between-' + label + ' estimate came out negative, which cannot be true of a variance. It means the ' + label + 's differ by less than ordinary measurement scatter would produce anyway, and the estimate is reported as zero by convention.');
    if (!r.balanced) notes.push('The groups are different sizes, so the effective replication is ' + f2(r.n0) + ' rather than a whole number. That is handled, but a badly unbalanced study leans heavily on its largest groups.');
    if (r.a < 6) notes.push('With ' + r.a + ' groups, the between-group variance rests on ' + (r.a - 1) + ' degree' + (r.a === 2 ? '' : 's') + ' of freedom and is a rough estimate whatever the arithmetic says. Treat the share as an order of magnitude, not a number to put in a specification.');
    if (r.significant && !diff.length) notes.push('The overall F test is significant but no single pair clears Tukey&rsquo;s bar. That is not a contradiction: the overall test pools all the evidence, while each pair gets only its own, paying for the protection against false alarms across every comparison.');
    if (!r.significant && diff.length) notes.push('No overall effect, yet a pair clears the bar. With this few groups that can happen; treat it as a lead to confirm, not a finding.');
    notes.push('This splits variation across the groups you supplied. A source you did not record — the day, the instrument, the operator — hides inside whichever column happens to move with it, so a clean split needs the study designed, not just the data pulled.');

    const plain = plainComponents(r, label);
    const top = diff.length ? (diff[0].diff >= 0 ? diff[0] : { a: diff[0].b, b: diff[0].a, diff: -diff[0].diff }) : null;
    const act = top
      ? 'Start with ' + h(top.a) + ' against ' + h(top.b) + ': a gap of ' + f3(top.diff) + ', wider than repeat measurements explain.'
      : r.icc < 0.1 ? 'Nothing here points at a particular ' + label + '. If this spread matters, run a Gage R&R on the method that produced these numbers.'
        : 'No single pair stands out yet. More measurements per ' + label + ', or more ' + label + 's, would sharpen it.';

    $('vc-out').innerHTML = '<div class="card vc-result"><h3>Where the variation comes from</h3>' +
      '<div class="plain ' + cls + '"><h4>In plain English</h4><p>' + h(plain) + '</p><p><b>Next move.</b> ' + act + '</p></div>' +
      '<p class="sub-head"><span class="verdict ' + cls + '">' + badge + '</span> ' + r.N + ' measurements across ' + r.a + ' ' + h(label) + 's.</p>' +
      '<div class="tiles">' + tiles + '</div>' +
      '<div id="vc-share"></div>' +
      '<h4>Variance components</h4>' + compTable(r.components) +
      '<h4>Analysis of variance</h4>' + anovaTable(r.anova) +
      '<div id="vc-strip"></div>' + groupTable + pairTable +
      '<h4>What this rests on</h4><ul class="insights">' + notes.map(n => '<li class="info">' + n + '</li>').join('') + '</ul>' +
      '<div class="row-actions"><button class="btn primary" type="button" id="vc-csv">Download the report (.csv)</button></div>' +
      '<p class="hint">Decision support, not a validated system. Confirm against your protocol and have the arithmetic checked independently.</p></div>';
    drawShare($('vc-share'), [{ label: 'Between ' + label + 's', value: r.between }, { label: 'Within ' + label + 's (repeat error)', value: r.within }], 'The total variance, cut into its sources');
    drawGroups($('vc-strip'), r, rows, 'group');
    $('vc-csv').addEventListener('click', () => download('variance-components.csv', csvComponents(r, rows, label), 'text/csv'));
  }

  function renderGrr(r, rows) {
    const cls = r.verdict === 'acceptable' ? 'capable' : r.verdict === 'marginal' ? 'marginal' : 'not';
    const headline = r.judgedOn === 'tolerance' ? r.pctTolerance : r.pctStudyGrr;
    const tiles = tile('Measurement system', r.verdict === 'acceptable' ? 'Fit' : r.verdict === 'marginal' ? 'Borderline' : 'Not fit', 'judged on ' + r.judgedOn, true) +
      tile('Gage R&R', pct(headline), r.judgedOn === 'tolerance' ? 'of the ' + f3(r.tolerance) + ' spec window' : 'of the study spread') +
      tile('Distinct categories', isFinite(r.ndc) ? String(r.ndc) : 'many', 'levels it can tell apart (5 is the usual bar)') +
      tile('Real differences', pct(r.components[3].pctStudy), 'part to part, the signal you want');

    const bars = [
      { label: 'Repeatability', value: r.components[0].pctStudy },
      { label: 'Reproducibility', value: r.components[1].pctStudy },
      { label: 'Total Gage R&R', value: r.components[2].pctStudy },
      { label: 'Part to part', value: r.components[3].pctStudy }
    ];

    const notes = [];
    notes.push('Repeatability is one operator measuring the same sample twice and getting a different answer: the instrument and the sample preparation. Reproducibility is two operators measuring the same sample and disagreeing: the method description, the training, the judgement calls.');
    notes.push('The model used was ' + r.model + ' (interaction p ' + pFmt(r.pInteraction) + '). Dropping an unsupported interaction is standard practice: left in, a noisy interaction term eats variation that belongs to the operators.');
    if (r.judgedOn !== 'tolerance') notes.push('No specification limits were given, so the verdict is against the spread of the samples in this study. That flatters a study built from very different samples and punishes one built from similar ones. Enter the real spec limits and the verdict becomes the one that matters: can this method pass and fail product against its limits?');
    if (r.keepInteraction) notes.push('The part-by-operator interaction is real: some operators read some samples differently from others, rather than being uniformly high or low. That pattern usually means a step of the method is open to interpretation, and it will not be fixed by recalibrating.');
    if (isFinite(r.ndc) && r.ndc < 5) notes.push('Fewer than five distinct categories means the method cannot support a control chart on individual results: it would show the measurement moving, not the process.');
    if (r.parts.length < 10) notes.push('With ' + r.parts.length + ' samples the part-to-part estimate is rough, and since the verdict is partly a ratio against it, the verdict is rough too. Ten is the usual study size.');
    if (r.reps < 3) notes.push('With ' + r.reps + ' repeats per cell, repeatability rests on ' + r.anova[3].df + ' degrees of freedom. Three repeats is the usual choice and costs little more.');
    notes.push('The samples must span the range you really see. A study run on near-identical samples will fail however good the instrument is, because the arithmetic compares measurement noise against real differences and there are none to compare against.');

    const worst = r.operators.length > 1 ? (() => {
      const means = r.operators.map(o => { const mine = rows.filter(x => x.operator === o); return { o, m: mine.reduce((a, x) => a + x.value, 0) / mine.length }; });
      means.sort((a, b) => b.m - a.m);
      return means;
    })() : null;
    const act = r.verdict === 'acceptable'
      ? 'Nothing to fix. Record this study as the method&rsquo;s qualification and repeat it after any change to the instrument, the method or the people.'
      : r.vReprod > r.vRepeat
        ? 'Go after reproducibility first: it is the larger share. ' + (worst ? 'The operators span ' + f3(worst[0].m - worst[worst.length - 1].m) + ' between ' + h(worst[0].o) + ' and ' + h(worst[worst.length - 1].o) + ', which is a method and training question, not a calibration one.' : '')
        : 'Go after repeatability first: it is the larger share. That is the instrument and the sample preparation. Averaging ' + (r.reps < 3 ? 'three' : 'more') + ' replicates per reported result divides this part of the noise by the square root of the count, which is often the cheapest fix available.';

    $('vc-out').innerHTML = '<div class="card vc-result"><h3>Measurement system analysis (Gage R&amp;R)</h3>' +
      '<div class="plain ' + cls + '"><h4>In plain English</h4><p>' + h(plainGrr(r)) + '</p><p><b>Next move.</b> ' + act + '</p></div>' +
      '<p class="sub-head"><span class="verdict ' + cls + '">' + r.verdict.toUpperCase() + '</span> ' + r.parts.length + ' samples × ' + r.operators.length + ' operators × ' + r.reps + ' repeats = ' + r.N + ' measurements.</p>' +
      '<div class="tiles">' + tiles + '</div>' +
      '<div id="vc-share"></div>' +
      '<h4>Where the spread comes from</h4><div id="vc-bars"></div>' +
      '<h4>Variance components</h4>' + compTable(r.components, true) +
      '<p class="hint">"% of total spread" is on the standard-deviation scale, which is the number quoted as "%GRR" in a measurement-system report. The shares of variance in the previous column add to 100%; the percentages of spread do not, because standard deviations do not add.</p>' +
      '<h4>Analysis of variance</h4>' + anovaTable(r.anova) +
      '<div id="vc-strip"></div>' +
      '<h4>What this rests on</h4><ul class="insights">' + notes.map(n => '<li class="info">' + n + '</li>').join('') + '</ul>' +
      '<div class="row-actions"><button class="btn primary" type="button" id="vc-csv">Download the report (.csv)</button></div>' +
      '<p class="hint">Decision support, not a validated measurement-system package. Confirm against your protocol and have the arithmetic checked independently.</p></div>';
    drawShare($('vc-share'), [
      { label: 'Repeatability', value: r.vRepeat },
      { label: 'Reproducibility', value: r.vReprod },
      { label: 'Real part-to-part differences', value: r.vPart }
    ], 'The total variance, cut into measurement and material');
    CH.hbar($('vc-bars'), bars.map(b => ({ label: b.label, value: b.value, text: pct(b.value), cls: b.label === 'Part to part' ? 'hi' : '' })), { min: 0, max: Math.max(100, Math.ceil(Math.max.apply(null, bars.map(b => b.value)) / 10) * 10), label: '% of total spread (standard deviation scale)' });
    drawGroups($('vc-strip'), { groups: r.operators.map(o => ({ name: o })), grand: r.grand }, rows, 'operator');
    $('vc-csv').addEventListener('click', () => download('gage-rr.csv', csvGrr(r, rows), 'text/csv'));
  }

  function renderAgree(r, rows) {
    const k3 = v => (v === null || v === undefined || !isFinite(v) ? '–' : Number(v).toFixed(3));
    const ci = (lo, hi) => (lo === null || hi === null || !isFinite(lo) || !isFinite(hi) ? '–' : k3(lo) + ' to ' + k3(hi));
    const vcls = v => (v === 'acceptable' ? 'capable' : v === 'marginal' ? 'marginal' : 'not');
    const cls = vcls(r.verdict);
    const badge = r.verdict === 'acceptable' ? 'FIT TO QUALIFY' : r.verdict === 'marginal' ? 'BORDERLINE' : 'NOT FIT';

    const tiles = tile('Appraisal system', r.verdict === 'acceptable' ? 'Fit' : r.verdict === 'marginal' ? 'Borderline' : 'Not fit', 'on the weakest kappa in the study', true) +
      tile('Worst kappa', k3(r.worstKappa), 'agreement above chance (0.90 is the usual bar)') +
      tile('Study', r.parts + ' × ' + r.operators.length + ' × ' + r.repeats, 'samples × appraisers × looks') +
      (r.allVsStandard
        ? tile('All correct', pct(r.allVsStandard.pct * 100), 'samples every appraiser called right every time')
        : tile('All agreed', pct((r.betweenAppraisers.pct || 0) * 100), 'samples every appraiser called the same way'));

    /* Percent agreement and kappa side by side, on purpose. The gap between the two columns
       is the finding whenever the defect is rare. */
    const within = '<h4>Each appraiser against themselves</h4>' +
      '<p class="hint">Whether a second look at the same sample gets the same call. Repeatability for a judgement.</p>' +
      '<div class="table-scroll"><table><thead><tr><th>Appraiser</th><th class="num-cell">Samples</th><th class="num-cell">Agreed with self</th><th class="num-cell">Kappa</th><th class="num-cell">95% interval</th><th>Verdict</th></tr></thead><tbody>' +
      r.withinAppraiser.map(w => '<tr><td>' + h(w.operator) + '</td><td class="num-cell">' + (w.n || '–') + '</td><td class="num-cell">' +
        (w.pct === null ? '–' : pct(w.pct * 100)) + '</td><td class="num-cell">' + k3(w.kappa) + '</td><td class="num-cell">' + ci(w.lo, w.hi) + '</td>' +
        '<td><span class="verdict ' + vcls(w.verdict) + '">' + h(w.verdict) + '</span>' + (w.why ? ' <span class="hint">' + h(w.why) + '</span>' : '') + '</td></tr>').join('') +
      '</tbody></table></div>';

    const standard = !r.hasStandard ? '' : '<h4>Each appraiser against the known value</h4>' +
      '<p class="hint">Accuracy, not just consistency. The last two columns matter more than any single figure here, and they are not interchangeable: a miss reaches the patient, a false alarm costs yield.</p>' +
      '<div class="table-scroll"><table><thead><tr><th>Appraiser</th><th class="num-cell">Calls</th><th class="num-cell">Agreed</th><th class="num-cell">Kappa</th><th class="num-cell">95% interval</th>' +
      (r.binary ? '<th class="num-cell">Missed a real ' + h(String(r.defect)) + '</th><th class="num-cell">False alarm</th>' : '') + '<th>Verdict</th></tr></thead><tbody>' +
      r.vsStandard.map(v => '<tr><td>' + h(v.operator) + '</td><td class="num-cell">' + v.n + '</td><td class="num-cell">' + pct(v.pct * 100) + '</td>' +
        '<td class="num-cell">' + k3(v.kappa) + '</td><td class="num-cell">' + ci(v.lo, v.hi) + '</td>' +
        (r.binary ? '<td class="num-cell">' + (v.miss === null ? '–' : pct(v.miss * 100) + ' of ' + v.defectsSeen) + '</td><td class="num-cell">' + (v.falseAlarm === null ? '–' : pct(v.falseAlarm * 100) + ' of ' + v.goodsSeen) + '</td>' : '') +
        '<td><span class="verdict ' + vcls(v.verdict) + '">' + h(v.verdict) + '</span></td></tr>').join('') +
      '</tbody></table></div>';

    const b = r.betweenAppraisers;
    const between = '<h4>Appraiser against appraiser</h4><p class="hint">' +
      (b.kappa === null ? h(b.why || 'Not computable for this study.')
        : 'Every appraiser called the same way on <b>' + pct(b.pct * 100) + '</b> of samples, kappa <b>' + k3(b.kappa) + '</b> (' + ci(b.lo, b.hi) + '), ' + h(b.verdict) + '. Disagreement between people usually means a step of the inspection is open to interpretation, and retraining one person will not fix it.') + '</p>';

    const notes = r.notes.slice();
    notes.push('Kappa is agreement above what calling at the same rates by chance would give: 1 is perfect, 0 is no better than guessing. The 0.90 and 0.70 cuts used for the verdicts are the measurement-systems convention rather than a regulatory limit, so a borderline study is an argument to have, not a box to tick.');
    notes.push('The 95% intervals are bootstrapped by resampling samples, not individual calls, 600 times. The ratings within one sample are the thing being measured, so resampling them would break the very dependence the study exists to capture.');
    if (!r.hasStandard) notes.push('No known value was given, so nothing here says whether the appraisers are right — only whether they agree. Two inspectors trained the same wrong way agree perfectly. Add a column holding the truth for the samples and the miss and false alarm rates follow.');
    if (!r.balanced) notes.push('Unbalanced studies weight whoever made the most calls. A complete design — every appraiser, every sample, the same number of looks — is worth the extra plates.');

    $('vc-out').innerHTML = '<div class="verdict-card ' + cls + '"><div class="verdict-badge">' + badge + '</div>' +
      '<div class="tiles">' + tiles + '</div>' +
      within + standard + between +
      '<div id="vc-kbars"></div>' +
      '<h4>Worth knowing</h4><ul class="notes">' + notes.map(n => '<li>' + n + '</li>').join('') + '</ul>' +
      '<div class="row-actions"><button class="btn primary" type="button" id="vc-csv">Download the report (.csv)</button></div>' +
      '<p class="hint">Decision support, not a validated inspection-qualification package. Confirm against your protocol and have the arithmetic checked independently.</p></div>';

    const bars = (r.hasStandard ? r.vsStandard : r.withinAppraiser).filter(x => x.kappa !== null && isFinite(x.kappa))
      .map(x => ({ label: x.operator, value: x.kappa * 100, text: k3(x.kappa), cls: x.kappa >= 0.9 ? 'hi' : '' }));
    if (bars.length) CH.hbar($('vc-kbars'), bars, { min: 0, max: 100, label: 'Kappa by appraiser, ×100 (90 is the usual bar)' });
    $('vc-csv').addEventListener('click', () => download('attribute-agreement.csv', csvAgree(r, rows), 'text/csv'));
  }

  function csvAgree(r, rows) {
    const L = head('Attribute agreement analysis');
    L.push(['Samples', r.parts], ['Appraisers', r.operators.length], ['Looks per appraiser per sample', r.repeats],
      ['Balanced', r.balanced ? 'Yes' : 'No'], ['Calls seen', q(r.categories.join(' / '))],
      ['Known value given', r.hasStandard ? 'Yes' : 'No'], ['Defect level', q(r.defect || 'n/a')],
      ['Share truly defective', r.prevalence === null ? '' : r.prevalence], ['Worst kappa', r.worstKappa], ['Verdict', q(r.verdict)], []);
    L.push(['Each appraiser against themselves'], ['Appraiser', 'Samples', 'Agreed with self', 'Kappa', 'Lower 95%', 'Upper 95%', 'Verdict']);
    r.withinAppraiser.forEach(w => L.push([q(w.operator), w.n, w.pct, w.kappa, w.lo, w.hi, q(w.verdict)]));
    L.push([]);
    if (r.hasStandard) {
      L.push(['Each appraiser against the known value'], ['Appraiser', 'Calls', 'Agreed', 'Kappa', 'Lower 95%', 'Upper 95%', 'Missed a real defect', 'Defects seen', 'False alarm rate', 'Good units seen', 'Verdict']);
      r.vsStandard.forEach(v => L.push([q(v.operator), v.n, v.pct, v.kappa, v.lo, v.hi, v.miss, v.defectsSeen, v.falseAlarm, v.goodsSeen, q(v.verdict)]));
      L.push([]);
      L.push(['Every appraiser correct every look', r.allVsStandard.agreed + ' of ' + r.allVsStandard.n, r.allVsStandard.pct], []);
    }
    const b = r.betweenAppraisers;
    L.push(['Appraiser against appraiser'], ['Samples', b.n], ['All called the same', b.pct], ['Kappa', b.kappa], ['Lower 95%', b.lo], ['Upper 95%', b.hi], ['Verdict', q(b.verdict)], []);
    L.push(['Worth knowing']);
    r.notes.forEach(n => L.push([q(n)]));
    L.push([], ['Ratings used']);
    L.push(['Sample', 'Appraiser', 'Call', 'Known value']);
    rows.forEach(x => L.push([q(x.part), q(x.operator), q(x.rating), q(x.standard || '')]));
    return L.map(line => line.join(',')).join('\n');
  }

  const summaryAgree = r => ({
    kind: 'agree', when: new Date().toISOString(),
    columns: { part: $('vc-a-part').value, operator: $('vc-a-operator').value, rating: $('vc-a-rating').value, standard: $('vc-a-standard').value || null },
    parts: r.parts, operators: r.operators, repeats: r.repeats, balanced: r.balanced,
    categories: r.categories, defect: r.defect, hasStandard: r.hasStandard, prevalence: r.prevalence,
    withinAppraiser: r.withinAppraiser, vsStandard: r.vsStandard, betweenAppraisers: r.betweenAppraisers,
    allVsStandard: r.allVsStandard, worstKappa: r.worstKappa, verdict: r.verdict, notes: r.notes
  });

  // ---------- reports ----------
  const q = v => '"' + String(v).replace(/"/g, '""') + '"';
  function head(title) {
    const L = [[title], ['Generated', q(new Date().toISOString())], ['Computed', q('In the browser. No data was uploaded or stored.')], []];
    return L;
  }
  function csvComponents(r, rows, label) {
    const L = head('Variance component analysis (one-way random effects)');
    L.push(['Setting', 'Value']);
    L.push(['Grouping column', q($('vc-group').value)], ['Result column', q($('vc-value').value)]);
    L.push(['Groups', r.a], ['Measurements', r.N], ['Balanced', r.balanced ? 'yes' : 'no'], ['Effective replication (n0)', r.n0]);
    L.push(['Pairwise confidence', Math.round((1 - r.alpha) * 100) + '%'], ['Tukey critical q', r.qCrit]);
    L.push([]);
    L.push(['Source', 'Sum of squares', 'df', 'Mean square', 'F', 'p']);
    r.anova.forEach(a => L.push([q(a.source), a.ss, a.df, a.ms, a.f === null ? '' : a.f, a.p === null ? '' : a.p]));
    L.push([]);
    L.push(['Component', 'Variance', 'Std dev', 'Share of variance']);
    r.components.forEach(c => L.push([q(c.source), c.variance, c.sd, c.share]));
    L.push(['Total', r.total, r.sdTotal, 1]);
    if (r.negative) L.push([q('Note'), q('The between-group estimate was negative and is reported as zero.')]);
    L.push([]);
    L.push([q(label.charAt(0).toUpperCase() + label.slice(1)), 'Measurements', 'Mean', 'Std dev', 'Difference from overall']);
    r.groups.forEach(g => L.push([q(g.name), g.n, g.mean, isFinite(g.sd) ? g.sd : '', g.mean - r.grand]));
    L.push([]);
    L.push(['Pair A', 'Pair B', 'Difference', 'Std error', 'q', 'p', 'Interval lower', 'Interval upper', 'Different']);
    r.pairs.forEach(p => L.push([q(p.a), q(p.b), p.diff, p.se, p.q, p.p, p.lower, p.upper, p.different ? 'yes' : 'no']));
    L.push([]);
    L.push([q('Group'), q('Measurement')]);
    rows.forEach(x => L.push([q(x.group), x.value]));
    L.push([]);
    L.push([q('Decision support, not a validated system. Variation can only be split across sources that were recorded; an unrecorded source hides inside whichever column moves with it.')]);
    return L.map(x => x.join(',')).join('\n') + '\n';
  }
  function csvGrr(r, rows) {
    const L = head('Measurement system analysis (Gage R&R, crossed, ANOVA method)');
    L.push(['Setting', 'Value']);
    L.push(['Sample column', q($('vc-part').value)], ['Operator column', q($('vc-operator').value)], ['Result column', q($('vc-grr-value').value)]);
    L.push(['Samples', r.parts.length], ['Operators', r.operators.length], ['Repeats per cell', r.reps], ['Measurements', r.N]);
    L.push(['Model', q(r.model)], ['Interaction p', r.pInteraction]);
    if (r.tolerance !== null) L.push(['Lower spec limit', r.lsl], ['Upper spec limit', r.usl], ['Tolerance', r.tolerance]);
    L.push(['Judged on', q(r.judgedOn)]);
    L.push([]);
    L.push(['Source', 'Sum of squares', 'df', 'Mean square', 'F', 'p']);
    r.anova.forEach(a => L.push([q(a.source), a.ss, a.df, a.ms, a.f === null ? '' : a.f, a.p === null ? '' : a.p]));
    L.push([]);
    L.push(['Component', 'Variance', 'Std dev', 'Share of variance', '% of total spread']);
    r.components.forEach(c => L.push([q(c.source), c.variance, c.sd, c.share, c.pctStudy]));
    L.push([]);
    L.push(['Result', 'Value']);
    L.push(['%GRR of study variation', r.pctStudyGrr]);
    if (r.pctTolerance !== null) L.push(['%GRR of tolerance', r.pctTolerance]);
    L.push(['Number of distinct categories', isFinite(r.ndc) ? r.ndc : '']);
    L.push(['Verdict', q(r.verdict)]);
    L.push([]);
    L.push(['Sample', 'Operator', 'Measurement']);
    rows.forEach(x => L.push([q(x.part), q(x.operator), x.value]));
    L.push([]);
    L.push([q('Decision support, not a validated measurement-system package. Acceptance thresholds of 10% and 30% follow common industry practice; your own protocol governs.')]);
    return L.map(x => x.join(',')).join('\n') + '\n';
  }

  // ---------- examples ----------
  /* Built here rather than taken from a real study, so each one illustrates exactly one
     situation and the write-up can be checked against what was injected. */
  function example(kind) {
    const seeds = { components: { vc1: 7, vc2: 19, vc3: 41 }, grr: { vc1: 3, vc2: 23, vc3: 57 }, agree: { vc1: 13, vc2: 31, vc3: 61 }, sites: { vc1: 3, vc2: 11, vc3: 29 }, subgroup: { vc1: 11, vc2: 17, vc3: 23 }, psd: { vc1: 5, vc2: 5, vc3: 5 } };
    const r = E.rng(seeds[mode()]['vc' + kind]);
    const N = () => { const u = Math.max(1e-12, r()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
    if (mode() === 'psd') {
      /* Two subvisible populations sampled particle by particle and then binned, so the
         counts are internally consistent rather than typed in. Batch B is drawn from a wider
         lognormal and then SCALED so its 10 micrometre count matches batch A's - which is the
         case the whole mode exists for: the number anybody looks at is unchanged and the
         population is not the same one. */
      const draw = (sigma, n) => { const out = []; for (let i = 0; i < n; i++) out.push(Math.exp(Math.log(3) + sigma * N())); return out; };
      const A = draw(1.0, 60000), B = draw(1.45, 60000);
      const at = (ds, t) => ds.filter(d => d >= t).length;
      const thresholds = kind === 3 ? [2, 5, 10, 25] : [10, 25];
      const scale = at(A, 10) / at(B, 10);
      const lines = ['Batch,Size_um,Count_per_container'];
      if (kind === 2) {
        // One container, two thresholds: the case where nothing can check the fitted shape.
        for (const t of [10, 25]) lines.push('B-401,' + t + ',' + at(A, t));
        return lines.join('\n');
      }
      for (const t of thresholds) lines.push('B-401,' + t + ',' + at(A, t));
      for (const t of thresholds) lines.push('B-402,' + t + ',' + Math.round(at(B, t) * scale));
      return lines.join('\n');
    }
    if (mode() === 'subgroup') {
      /* A filling line sampled five per batch. The three examples are a stable line, one
         batch whose spread blows out, and the subgrouping mistake: two heads running 6 apart
         sampled into the same subgroup, which inflates the limits until nothing can signal. */
      const rows = ['Batch,Fill_Weight'];
      for (let g = 1; g <= 20; g++) {
        for (let i = 0; i < 5; i++) {
          let v2 = 100 + N() * 2;
          if (kind === 2 && g === 10) v2 = 100 + N() * 14;
          if (kind === 3) v2 = 100 + (i % 2 ? 6 : -6) + N() * 0.5;
          rows.push('B-' + String(g).padStart(2, '0') + ',' + v2.toFixed(2));
        }
      }
      return rows.join('\n');
    }
    if (mode() === 'sites') {
      /* Three release datasets from two sites against a 96 to 100 specification. The three
         examples are the three answers the tool can give: one process, two centres, two
         spreads - because the interesting part is which of those you are looking at. */
      const shift = kind === 2 ? 1.2 : 0;
      const sdB = kind === 3 ? 1.1 : 0.5;
      const lines = ['Site,Purity_Pct'];
      for (let i = 0; i < 30; i++) lines.push('Site A,' + (98.2 + N() * 0.5).toFixed(2));
      for (let i = 0; i < 30; i++) lines.push('Site B,' + (98.1 - shift + N() * sdB).toFixed(2));
      return lines.join('\n');
    }
    if (mode() === 'agree') {
      /* A visual inspection qualification set: 24 vials, half of them seeded with a real
         particle, three inspectors, two looks each. Half and half on purpose - a set built
         to match production, at a few percent defective, cannot measure a miss rate. */
      const vials = E.range(24).map(i => ({ id: 'V-' + String(i + 1).padStart(2, '0'), truth: i % 2 === 0 ? 'reject' : 'accept' }));
      const build = call => {
        const lines = ['Vial,Inspector,Call,Known'];
        for (const v of vials) for (const who of ['Ana', 'Ben', 'Cara']) for (const look of [1, 2]) {
          lines.push([v.id, who, call(v, who, look), v.truth].join(','));
        }
        return lines.join('\n');
      };
      // Fit to qualify: everyone sees nearly everything, with the odd honest slip.
      if (kind === 1) return build((v, who, look) => (r() < 0.04 ? (v.truth === 'reject' ? 'accept' : 'reject') : v.truth));
      /* The rubber stamp. Cara passes every vial without looking. Against a production-like
         set she would score in the high nineties; here the miss rate gives her away. */
      if (kind === 2) return build((v, who) => (who === 'Cara' ? 'accept' : (r() < 0.05 ? (v.truth === 'reject' ? 'accept' : 'reject') : v.truth)));
      // Ben rejects anything he is unsure of: no misses at all, and a yield problem.
      return build((v, who) => {
        if (who === 'Ben') return (v.truth === 'reject' || r() < 0.35 ? 'reject' : 'accept');
        return (r() < 0.05 ? (v.truth === 'reject' ? 'accept' : 'reject') : v.truth);
      });
    }
    if (mode() === 'components') {
      if (kind === 1) {
        // Six resin lots, one of them genuinely low; the assay itself is tight.
        const lines = ['Resin_Lot,Step_Yield_Pct'];
        ['R-4401', 'R-4402', 'R-4403', 'R-4404', 'R-4405', 'R-4406'].forEach((lot, i) => {
          const shift = lot === 'R-4404' ? -4.1 : N() * 0.5;
          for (let k = 0; k < 4; k++) lines.push([lot, (91.5 + shift + N() * 0.6).toFixed(2)].join(','));
        });
        return lines.join('\n');
      }
      if (kind === 2) {
        // Lots all the same; the assay is noisy. The honest answer is "stop blaming the vendor".
        const lines = ['Media_Lot,Titer_g_L'];
        ['M-11', 'M-12', 'M-13', 'M-14', 'M-15', 'M-16', 'M-17'].forEach(lot => {
          for (let k = 0; k < 4; k++) lines.push([lot, (3.42 + N() * 0.001 + N() * 0.21).toFixed(3)].join(','));
        });
        return lines.join('\n');
      }
      // Four analysts, a graded drift across them: no single villain, a real effect.
      const lines = ['Analyst,Purity_Pct'];
      ['A. Rao', 'B. Chen', 'C. Okafor', 'D. Lindqvist'].forEach((who, i) => {
        for (let k = 0; k < 6; k++) lines.push([who, (98.1 + i * 0.42 + N() * 0.3).toFixed(2)].join(','));
      });
      return lines.join('\n');
    }
    // Gage R&R: 10 samples spanning the range, 3 analysts, 3 repeats.
    const samples = [], names = ['Analyst 1', 'Analyst 2', 'Analyst 3'];
    for (let i = 0; i < 10; i++) samples.push(96 + i * 0.9 + N() * 0.3);
    const bias = kind === 2 ? [0, 0, 1.6] : [0, 0.05, -0.04];
    const noise = kind === 3 ? 1.9 : 0.16;
    const lines = ['Sample,Analyst,Assay_Result'];
    samples.forEach((truth, i) => names.forEach((who, j) => {
      for (let k = 0; k < 3; k++) lines.push(['S-' + String(i + 1).padStart(2, '0'), who, (truth + bias[j] + N() * noise).toFixed(2)].join(','));
    }));
    return lines.join('\n');
  }

  function renderSites(r) {
    const f2n = x => (x === null || x === undefined || !isFinite(x) ? '\u2013' : Number(x).toFixed(2));
    $('vc-out').innerHTML = '<div class="card">' +
      '<h3>Capability at each site</h3>' +
      '<div class="table-scroll"><table class="pm"><thead><tr><th>Site</th><th>n</th><th>Mean</th><th>SD</th><th>Cp</th><th>Cpk</th><th>Pp</th><th>Ppk</th><th>Out of spec</th></tr></thead><tbody>' +
      r.perSite.map(s => '<tr><td>' + h(s.site) + '</td><td>' + s.n + '</td><td>' + f2n(s.mean) + '</td><td>' + f2n(s.sd) +
        '</td><td>' + f2n(s.Cp) + '</td><td>' + f2n(s.Cpk) + '</td><td>' + f2n(s.Pp) + '</td><td>' + f2n(s.Ppk) +
        '</td><td>' + (s.observedOut === null || s.observedOut === undefined ? '\u2013' : s.observedOut) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<div class="tiles">' +
      '<div class="tile hero-tile"><div class="lbl">Combined index</div><div class="val">' +
        (r.combined ? 'Ppk ' + f2n(r.combined.Ppk) : 'withheld') + '</div><div class="sub">' +
        (r.poolable ? 'the sites behave as one process' : 'the sites are not one process') + '</div></div>' +
      '<div class="tile"><div class="lbl">Between-site share of spread</div><div class="val">' +
        (r.betweenShare === null ? '\u2013' : Math.round(r.betweenShare * 100) + '%') + '</div><div class="sub">the rest is inside the sites</div></div>' +
      '<div class="tile"><div class="lbl">Worst site</div><div class="val">' + h(r.worst) + '</div><div class="sub">best is ' + h(r.best) + '</div></div>' +
      '</div>' +
      (!r.equivalence ? '' : '<div class="table-scroll"><table class="pm"><thead><tr><th>Pair</th><th>Difference</th><th>90% interval</th><th>Verdict</th></tr></thead><tbody>' +
        r.equivalence.pairs.map(pr => '<tr><td>' + h(pr.a) + ' vs ' + h(pr.b) + '</td><td>' + f2n(pr.diff) + '</td><td>' +
          (pr.ciLow === null ? '\u2013' : f2n(pr.ciLow) + ' to ' + f2n(pr.ciHigh)) + '</td><td>' + h(pr.verdict) + '</td></tr>').join('') +
        '</tbody></table></div>') +
      '<p class="why">' + h(r.why) + '</p>' +
      '<details class="howto" open><summary>How to read this, and what it means</summary><div class="howto-body">' +
      '<p><b>The per-site rows are always the answer.</b> Each is a capability index for a process that actually exists. The combined index is the convenience, and it is the one that can be wrong.</p>' +
      '<p><b>' + (r.poolable
        ? 'These sites passed both tests, so the combined index describes a real single process and can go in the report.'
        : 'The combined index is withheld, and that is the finding.') + '</b> ' +
        (r.poolable ? '' : r.sameCentre === false
          ? 'The sites sit at different centres, so pooling them inflates the spread with the gap between them: the combined number would describe a mixture no site runs, and would be worse than every site individually.'
          : 'The sites have different spreads, so one index averages a tight process with a loose one, flattering the loose site and penalising the tight one.') + '</p>' +
      '<p><b>Where the capability is.</b> ' + (r.betweenShare === null ? 'Not estimable here.'
        : r.betweenShare > 0.3
          ? Math.round(r.betweenShare * 100) + '% of the total spread is the difference between sites, so harmonising them is worth more than tightening any one of them. Start by asking why ' + h(r.worst) + ' sits where it does.'
          : 'Only ' + Math.round(r.betweenShare * 100) + '% of the spread is between sites, so the variation lives inside them. Harmonising would buy little; reducing within-site variation is the work.') + '</p>' +
      '<p><b>What this does not tell you.</b> Why the sites differ. Equipment, raw material lot, analyst and method version are all candidates, and separating them needs those columns in the data - the variance components mode is the next step.</p>' +
      '</div></details></div>';
  }

  function renderSubgroup(r) {
    const equal = r.sizes.every(n => n === r.sizes[0]);
    const spreadName = r.kind === 'xbar-s' ? 'S' : 'R';
    $('vc-out').innerHTML = '<div class="card"><h3>' + spreadName + ' chart \u2014 read this one first</h3><div id="vc-spread-chart"></div>' +
      '<h3>X-bar chart \u2014 the subgroup averages</h3><div id="vc-mean-chart"></div>' +
      '<p class="why">' + h(r.why) + '</p>' +
      '<details class="howto" open><summary>How to read this, and what it means</summary><div class="howto-body">' +
      '<p><b>The spread chart first, always.</b> The limits on the averages are computed from the within-subgroup spread. ' +
      (r.spreadStable
        ? 'It is in control here, so the X-bar limits rest on something stable and its signals can be read.'
        : 'It is <b>not</b> in control here, so stop: the X-bar limits are built from a spread that is itself moving, and a signal or its absence on the averages means nothing until that is sorted out.') + '</p>' +
      '<p><b>These limits are not specification limits.</b> A subgroup mean varies by sigma over root n, so at ' + r.sizes[0] + ' per subgroup these limits are about ' +
      Math.sqrt(r.sizes[0]).toFixed(1) + ' times narrower than the process itself. A chart entirely in control can still be making product outside specification, and a chart breaching its limits can still be inside it. Capability is a separate question, asked of individual results.</p>' +
      '<p><b>Was the subgrouping right?</b> ' + (r.ratio === null ? 'Not assessable here.' : r.subgroupingSuspect
        ? 'Probably not. The means scatter only ' + r.ratio.toFixed(2) + ' times what the within-subgroup spread predicts, which is what happens when each subgroup already contains the thing it should be comparing across - two heads, two cavities, two lanes. The limits inflate and the chart stops being able to signal. Re-subgroup within a stream.'
        : 'The means scatter ' + r.ratio.toFixed(2) + ' times what the within-subgroup spread predicts, consistent with subgroups capturing only common-cause variation.') + '</p>' +
      '</div></details></div>';
    const flagsFor = sig => r.labels.map((_, i) => (sig.some(s => s.i === i) ? ['outside the limits'] : []));
    if (equal) {
      CH.controlChart($('vc-spread-chart'), r.spreads, { ucl: r.limits[0].sUcl, cl: r.limits[0].centre, lcl: r.limits[0].sLcl,
        flags: flagsFor(r.spreadSignals), yLabel: spreadName, xLabel: 'Subgroup', rowLabel: i => r.labels[i], height: 210 });
      CH.controlChart($('vc-mean-chart'), r.means, { ucl: r.limits[0].xUcl, cl: r.grand, lcl: r.limits[0].xLcl,
        flags: flagsFor(r.meanSignals), yLabel: 'Subgroup mean', xLabel: 'Subgroup', rowLabel: i => r.labels[i], height: 210 });
    } else {
      /* Unequal subgroups give every point its own limits, which a single pair of lines
         cannot show. Standardising each point by its own limit is the standard answer: the
         limits become a flat +/-3 and the shape of the chart is unchanged. */
      const zs = r.means.map((m, i) => (m - r.grand) / ((r.limits[i].xUcl - r.grand) / 3));
      const zr = r.spreads.map((v, i) => (v - r.limits[i].centre) / Math.max(1e-9, (r.limits[i].sUcl - r.limits[i].centre) / 3));
      CH.controlChart($('vc-spread-chart'), zr, { ucl: 3, cl: 0, lcl: -3, flags: flagsFor(r.spreadSignals),
        yLabel: 'Standardised ' + spreadName, xLabel: 'Subgroup', rowLabel: i => r.labels[i], height: 210 });
      CH.controlChart($('vc-mean-chart'), zs, { ucl: 3, cl: 0, lcl: -3, flags: flagsFor(r.meanSignals),
        yLabel: 'Standardised mean', xLabel: 'Subgroup', rowLabel: i => r.labels[i], height: 210 });
      $('vc-out').insertAdjacentHTML('beforeend', '<p class="hint">Subgroup sizes differ, so every point has its own limits. Each is plotted standardised by its own, which turns the limits into a flat &plusmn;3 without changing the shape of the chart.</p>');
    }
  }

  // ---------- particle size distribution ----------
  /* The log-log plot is the whole picture: cumulative count against size, where a power law
     is a straight line. Drawn on log axes because that is the only scale on which four
     decades of count and one of size are both readable, and because a bent line on this
     plot IS the finding - it is the shape changing with size. */
  function drawPsdCurve(el, fits) {
    const W = Math.max(320, el.clientWidth || 700), H = 300, L = 62, R = 16, T = 14, B = 46;
    const allSizes = fits.reduce((a, f) => a.concat(f.r.fitBins.map(b => b.size), f.r.curve.map(c => c.size)), []);
    const allCounts = fits.reduce((a, f) => a.concat(f.r.fitBins.map(b => b.count), f.r.curve.map(c => c.powerLaw)), []).filter(v => v > 0);
    const lx = v => Math.log10(v), ly = v => Math.log10(v);
    const x0 = Math.min.apply(null, allSizes.map(lx)), x1 = Math.max.apply(null, allSizes.map(lx));
    const y0 = Math.min.apply(null, allCounts.map(ly)), y1 = Math.max.apply(null, allCounts.map(ly));
    const px = (x1 - x0) * 0.04 || 0.1, py = (y1 - y0) * 0.06 || 0.1;
    const sx = v => L + (lx(v) - (x0 - px)) / ((x1 + px) - (x0 - px)) * (W - L - R);
    const sy = v => H - B - (ly(v) - (y0 - py)) / ((y1 + py) - (y0 - py)) * (H - T - B);
    let b = '';
    for (let d = Math.floor(y0 - py); d <= Math.ceil(y1 + py); d++) {
      const v = Math.pow(10, d);
      if (ly(v) < y0 - py || ly(v) > y1 + py) continue;
      b += '<line class="gridline" x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(v) + '" y2="' + sy(v) + '"/>' +
        '<text x="' + (L - 6) + '" y="' + (sy(v) + 4) + '" text-anchor="end">' + (v >= 1 ? v.toLocaleString('en-US') : v) + '</text>';
    }
    const ticks = Array.from(new Set(fits[0].r.bins.map(x => x.size))).sort((p, q) => p - q);
    for (const t of ticks) b += '<text x="' + sx(t) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + t + '</text>';
    b += '<line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>';
    fits.forEach((f, i) => {
      const cls = i === 0 ? '' : 's' + (i + 1);
      const inRange = f.r.curve.filter(c => c.powerLaw > 0);
      b += '<path class="line ' + cls + '" d="' + inRange.map((c, j) => (j ? 'L' : 'M') + sx(c.size).toFixed(1) + ' ' + sy(c.powerLaw).toFixed(1)).join('') + '"/>';
      if (f.r.logNormal) b += '<path class="line alt-shape ' + cls + '" d="' +
        f.r.curve.filter(c => c.logNormal > 0).map((c, j) => (j ? 'L' : 'M') + sx(c.size).toFixed(1) + ' ' + sy(c.logNormal).toFixed(1)).join('') + '"/>';
      for (const bin of f.r.fitBins) b += '<g data-tip="' + h((f.label || 'All') + '— ' + bin.size + ' um: ' + bin.count.toLocaleString('en-US') + ' counted') + '">' +
        '<circle class="hit" cx="' + sx(bin.size) + '" cy="' + sy(bin.count) + '" r="12"/>' +
        '<circle class="pt ' + cls + '" cx="' + sx(bin.size) + '" cy="' + sy(bin.count) + '" r="4.5"/></g>';
    });
    b += '<text class="lbl-strong" x="' + ((L + W - R) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">Size threshold (micrometres, log scale)</text>' +
      '<text class="lbl-strong" transform="translate(14 ' + ((T + H - B) / 2) + ') rotate(-90)" text-anchor="middle">Count at or above that size (log scale)</text>';
    el.innerHTML = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cumulative particle count against size on log axes">' + b + '</svg>';
    if (CH.bindTips) CH.bindTips(el);
  }

  function renderPsd(rows) {
    const P = window.MLParticles;
    if (!P) throw new Error('The particle distribution module did not load.');
    const kind = $('vc-psd-kind').value;
    const groupNames = Array.from(new Set(rows.map(r => r.group)));
    const grouped = groupNames.length > 1 || groupNames[0] !== '';
    const groups = grouped
      ? groupNames.map(g => ({ label: g, rows: rows.filter(r => r.group === g) }))
      : [{ label: '', rows }];

    const fits = groups.map(g => ({ label: g.label, r: P.analyze(g.rows, { kind }) }));
    const lo = Number($('vc-psd-lo').value), hi = Number($('vc-psd-hi').value);

    let tail = null, tailErr = null;
    if (lo < hi) {
      try { tail = P.tailFraction(groups.map((g, i) => ({ label: g.label || 'All rows', rows: fits[i].r.bins })), lo, hi); }
      catch (e) { tailErr = e.message; }
    } else tailErr = 'The tail fraction needs two different thresholds, the smaller one first.';

    let slope = null, slopeErr = null;
    if (groups.length > 1) {
      try { slope = P.compare(groups, { kind }); } catch (e) { slopeErr = e.message; }
    }

    const f = fits[0].r;
    const pctl = v => (100 * v).toPrecision(3) + '%';
    last = { kind: 'psd', fits, tail, slope, rows };

    let html = '<div class="card"><h3>' + (grouped ? 'Size distributions compared across ' + groups.length + ' groups' : 'The size distribution across the bins') + '</h3>';

    /* The test first and the description second, deliberately: the tail fraction is what
       carries a measured false-alarm rate, and the slope is what explains the picture. */
    if (tail) {
      html += '<div class="tiles">' +
        '<div class="tile hero-tile"><div class="lbl">Reaches ' + hi + ' um, of those at ' + lo + ' um</div><div class="val">' +
        (tail.groups.length === 1 ? pctl(tail.groups[0].fraction) : tail.groups.map(g => pctl(g.fraction)).join(' vs ')) +
        '</div><div class="sub">' + (tail.groups.length === 1 ? '95% interval ' + pctl(tail.groups[0].ci[0]) + ' to ' + pctl(tail.groups[0].ci[1])
          : tail.differs ? 'the tail changed shape' : 'no shape change detected') + '</div></div>' +
        '<div class="tile"><div class="lbl">Falls off as size to the power</div><div class="val">' + f2(f.alpha) +
        '</div><div class="sub">' + (f.alphaCi ? '95% interval ' + f2(f.alphaCi[0]) + ' to ' + f2(f.alphaCi[1]) : 'no interval: ' + f.fitBins.length + ' bins fit exactly') + '</div></div>' +
        '<div class="tile"><div class="lbl">Bins fitted</div><div class="val">' + f.fitBins.length +
        '</div><div class="sub">' + f.dMin + ' to ' + f.dMax + ' um' + (f.zeroBins.length ? ', ' + f.zeroBins.length + ' zero set aside' : '') + '</div></div>' +
        '<div class="tile"><div class="lbl">Shape checkable</div><div class="val">' + (f.checkable ? 'Yes' : 'No') +
        '</div><div class="sub">' + (f.comparable ? 'and comparable against a lognormal' : f.checkable ? 'but not comparable: needs 4 bins' : 'two bins fit a two-parameter line exactly') + '</div></div>' +
        '</div>';
    }

    html += '<div id="vc-psd-chart" class="chart"></div>' +
      '<p class="hint">Solid line: the fitted power law, a straight line on these axes. ' +
      (f.logNormal ? 'Dashed: a lognormal fitted to the same bins. Where they part company is the extrapolation you cannot check. ' : '') +
      'Dots are your counts.</p>';

    if (tail) {
      html += '<h4>The tail fraction: the test</h4>' +
        '<div class="table-scroll"><table class="pm"><thead><tr><th>Group</th><th>At ' + lo + ' um</th><th>At ' + hi + ' um</th><th>Fraction reaching ' + hi + ' um</th><th>95% interval</th></tr></thead><tbody>' +
        tail.groups.map(g => '<tr><td>' + h(g.label) + '</td><td>' + g.n.toLocaleString('en-US') + '</td><td>' + g.k.toLocaleString('en-US') +
          '</td><td><b>' + pctl(g.fraction) + '</b></td><td>' + pctl(g.ci[0]) + ' to ' + pctl(g.ci[1]) + '</td></tr>').join('') +
        '</tbody></table></div>';
      if (tail.pairs.length) {
        html += '<div class="table-scroll"><table class="pm"><thead><tr><th>Pair</th><th>Difference</th><th>95% interval</th><th>p</th><th>Verdict</th></tr></thead><tbody>' +
          tail.pairs.map(x => '<tr' + (x.differs ? ' class="hi"' : '') + '><td>' + h(x.a) + ' vs ' + h(x.b) + '</td><td>' +
            (x.diff >= 0 ? '+' : '') + pctl(x.diff) + '</td><td>' + pctl(x.ci[0]) + ' to ' + pctl(x.ci[1]) + '</td><td>' + pFmt(x.p) +
            '</td><td>' + (x.differs ? '<b>shape differs</b>' : 'not distinguishable') + '</td></tr>').join('') +
          '</tbody></table></div>';
      }
      html += '<p class="why">' + h(tail.why) + '</p>';
    } else if (tailErr) {
      html += '<h4>The tail fraction</h4><p class="why">Not available: ' + h(tailErr) + '</p>';
    }

    if (fits.length > 1) {
      html += '<h4>The slope: the description</h4>' +
        '<div class="table-scroll"><table class="pm"><thead><tr><th>Group</th><th>Exponent</th><th>95% interval</th><th>Residual spread</th><th>Better shape</th></tr></thead><tbody>' +
        fits.map(x => '<tr><td>' + h(x.label || 'All rows') + '</td><td>' + f2(x.r.alpha) + '</td><td>' +
          (x.r.alphaCi ? f2(x.r.alphaCi[0]) + ' to ' + f2(x.r.alphaCi[1]) : 'not estimable') + '</td><td>' +
          (x.r.powerLaw.residSd === null ? 'exact fit, nothing left over' : f3(x.r.powerLaw.residSd)) + '</td><td>' +
          (x.r.comparable ? (x.r.preferred || 'neither clearly') : 'needs 4 bins') + '</td></tr>').join('') +
        '</tbody></table></div>' +
        /* When the two verdicts disagree, say so here rather than leaving somebody to notice
           that one table says changed and the other says not. On this tool's own four-bin
           example the exponent nearly halves - 1.44 against 0.84 - and the slope test still
           returns no difference, which is the measured 22% power showing up in practice. */
        ((tail && tail.differs && slope && slope.testable && !slope.shapesDiffer)
          ? '<p class="demo-read"><b>These two disagree, and the fraction is the one to believe.</b> The exponents above are far apart, the tail fraction says the shape moved, and the slope test still returns no difference \u2013 which is the 22% detection rate showing up in practice rather than a contradiction. The slope\u2019s error bar is the scatter about a straight line, and most of that scatter here is the curve genuinely bending.</p>'
          : '') +
        '<p class="why">' + h(slope ? slope.why : slopeErr || '') + '</p>';
    }

    html += '<p class="why">' + h(f.why) + '</p>';

    html += '<details class="howto" open><summary>How to read this, and what it means</summary><div class="howto-body">' +
      '<p><b>Why a count is not a distribution.</b> Two containers can report the same count at ' + lo + ' micrometres and hold completely different populations: one where the count collapses with size, one where a flat tail carries far more large particles. The large ones are both the rarest and the ones that matter, so a count chart on the ' + lo + ' um number is blind to exactly the change you would want to catch. The exponent is the shape in one number - a steep value means the population dies off fast with size, a shallow one means a heavy tail.</p>' +
      '<p><b>Test with the fraction, describe with the slope.</b> The counts are nested: every particle at or above ' + hi + ' um is also at or above ' + lo + ', so the fraction reaching ' + hi + ' is a proportion with an exact binomial error rather than a ratio of two noisy numbers. Measured on simulated populations, that test fired 5.7% of the time under the null against the 5% it claims, and caught a real shape change that raised the ' + hi + ' um count 2.6-fold at an unchanged ' + lo + ' um count in <b>100%</b> of runs. The slope comparison, on the same data, caught that same change in <b>22%</b> and fired 0 times in 300 under the null. Its error bar is the scatter about a straight line, and on a real population most of that scatter is the curve genuinely bending rather than sampling noise - so it describes the wrong thing and comes out far too wide. Use the slope to say what the shape is; use the fraction to say whether it moved.</p>' +
      (f.checkable ? '' : '<p><b>Nothing here tests the shape.</b> Two thresholds determine a two-parameter line exactly, so the fit cannot be wrong on this data - and that is not reassuring, it means no residual exists to check it against. USP &lt;788&gt; reports exactly two thresholds, so this is the normal situation rather than bad luck. The tail fraction above is unaffected, because it is a count of nested events and assumes no shape at all. What you cannot do is push the fitted line past ' + f.dMax + ' micrometres.</p>') +
      '<p><b>Extrapolation is where the assumption gets spent, and more bins do not fix it.</b> ' +
      (f.divergence && f.divergence.ratio !== null
        ? 'At ' + f.divergence.size.toPrecision(3) + ' um, past every bin measured, the power law here predicts ' + f.divergence.ratio.toFixed(1) + ' times as many particles as the lognormal fitted to the same bins. '
        : '') +
      'Measured on simulated lognormal populations: extrapolating to 50 micrometres from the two USP thresholds overshot the truth by <b>1.5x</b>, and adding two <i>smaller</i> bins at 2 and 5 um made it <b>worse</b>, at 2.7x - because the fit then averages a slope over a range where the slope is genuinely changing. Bins that <i>bracket</i> the size you want got it to within <b>6%</b>. If you need a number at 50 um, measure near 50 um; more bins at the small end will not buy it.</p>' +
      '<p><b>What this does not cover.</b> It fits one population at a time. A container holding both silicone oil droplets and protein aggregates holds two distributions, and a single exponent will land between them and describe neither - which is itself worth noticing, because a line that visibly bends on the chart above is usually two mechanisms rather than one bad fit. Nothing here reads a particle image, so the type call stays human: this measures the sizes, not what the particles are. And it issues no compendial verdict - which tier a result falls in, and whether it is reportable, is a regulated decision this tool refuses.</p>' +
      '</div></details></div>';

    $('vc-out').innerHTML = html;
    drawPsdCurve($('vc-psd-chart'), fits);
  }

  // ---------- wiring ----------
  function showMode() {
    const m = mode();
    $('vc-mode-desc').textContent = MODE_DESC[m];
    $('vc-shape-body').innerHTML = SHAPES[m];
    $('vc-shape').querySelector('summary').textContent = 'What the data should look like';
    $('vc-map-components').hidden = m !== 'components' && m !== 'sites' && m !== 'subgroup';
    $('vc-map-grr').hidden = m !== 'grr';
    $('vc-map-agree').hidden = m !== 'agree';
    if ($('vc-map-psd')) $('vc-map-psd').hidden = m !== 'psd';
    $('vc-agree-note').hidden = m !== 'agree';
    $('vc-spec').hidden = m !== 'grr' && m !== 'sites' && m !== 'subgroup';
    if ($('vc-margin-wrap')) $('vc-margin-wrap').hidden = m !== 'sites';

    $('vc-spec-note').hidden = m !== 'grr';
    $('vc-advanced').hidden = m !== 'components';
    $('vc-run').textContent = m === 'components' ? 'Split the variation' : m === 'agree' ? 'Check the agreement' : m === 'sites' ? 'Compare the sites' : m === 'subgroup' ? 'Chart it' : m === 'psd' ? 'Fit the distribution' : 'Check the measurement system';
    $('vc-examples').innerHTML = EXAMPLES[m].map(([id, label]) => '<button class="btn ghost small" id="' + id + '" type="button">' + h(label) + '</button>').join('') +
      '<button class="btn ghost small" id="vc-clear" type="button">Clear</button>';
    bindExamples();
    $('vc-data').placeholder = m === 'components' ? 'Lot,Result\nL-2401,96.2\nL-2401,96.6\nL-2402,94.1'
      : m === 'agree' ? 'Vial,Inspector,Call,Known\nV-01,Ana,accept,accept\nV-01,Ana,accept,accept\nV-01,Ben,reject,accept'
      : m === 'psd' ? 'Batch,Size_um,Count_per_container\nB-401,10,3980\nB-401,25,318\nB-402,10,4040\nB-402,25,471'
      : 'Sample,Analyst,Result\nS-01,Analyst 1,98.4\nS-01,Analyst 1,98.6';
    $('vc-out').innerHTML = ''; $('vc-error').hidden = true;
    if (table) { describe(); } else { $('vc-read').textContent = ''; }
  }
  function bindExamples() {
    EXAMPLES[mode()].forEach(([id], i) => {
      const b = $(id); if (!b) return;
      b.addEventListener('click', () => load(example(i + 1)));
    });
    const c = $('vc-clear'); if (c) c.addEventListener('click', clear);
  }
  function load(text) {
    $('vc-data').value = text; $('vc-error').hidden = true; $('delete-top').hidden = false;
    $('vc-out').innerHTML = '';
    loadText(text);
  }

  function run() {
    $('vc-error').hidden = true;
    let got;
    try { got = readRows(); } catch (e) { return fail(e.message); }
    try {
      if (mode() === 'components') {
        const res = V.tukey(got.rows, Number($('vc-alpha').value));
        last = { kind: 'components', r: res, rows: got.rows };
        renderComponents(res, got.rows);
        window.MLVarianceRun = summaryComponents(res);
      } else if (mode() === 'agree') {
        const res = V.attributeAgreement(got.rows, { seed: 29, reps: 600 });
        last = { kind: 'agree', r: res, rows: got.rows };
        renderAgree(res, got.rows);
        window.MLVarianceRun = summaryAgree(res);
      } else if (mode() === 'psd') {
        renderPsd(got.rows);
      } else if (mode() === 'subgroup') {
        const spec = { lsl: $('vc-lsl').value === '' ? null : Number($('vc-lsl').value), usl: $('vc-usl').value === '' ? null : Number($('vc-usl').value) };
        const res = window.MLSpc.subgroupChart(got.rows.map(r => ({ subgroup: r.group, value: r.value })), { spec });
        last = { kind: 'subgroup', r: res, rows: got.rows };
        renderSubgroup(res);
      } else if (mode() === 'sites') {
        const spec = { lsl: $('vc-lsl').value === '' ? null : Number($('vc-lsl').value), usl: $('vc-usl').value === '' ? null : Number($('vc-usl').value) };
        const margin = $('vc-margin') && $('vc-margin').value !== '' ? $('vc-margin').value : null;
        const res = window.MLSpc.crossSite(got.rows.map(r => ({ site: r.group, value: r.value })), spec, { margin });
        last = { kind: 'sites', r: res, rows: got.rows };
        renderSites(res);
      } else {
        const res = V.gageRR(got.rows, { lsl: $('vc-lsl').value, usl: $('vc-usl').value });
        last = { kind: 'grr', r: res, rows: got.rows };
        renderGrr(res, got.rows);
        window.MLVarianceRun = summaryGrr(res);
      }
      $('vc-out').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { fail(e.message); }
  }

  const summaryComponents = r => ({
    kind: 'components', when: new Date().toISOString(),
    columns: { group: $('vc-group').value, value: $('vc-value').value },
    groups: r.a, N: r.N, balanced: r.balanced, n0: r.n0,
    between: r.between, within: r.within, total: r.total, sdTotal: r.sdTotal,
    icc: r.icc, negative: r.negative, p: r.p, significant: r.significant,
    alpha: r.alpha, qCrit: r.qCrit,
    anova: r.anova, components: r.components,
    groupStats: r.groups, pairs: r.pairs,
    differing: r.pairs.filter(p => p.different).length
  });
  const summaryGrr = r => ({
    kind: 'grr', when: new Date().toISOString(),
    columns: { part: $('vc-part').value, operator: $('vc-operator').value, value: $('vc-grr-value').value },
    parts: r.parts.length, operators: r.operators.length, reps: r.reps, N: r.N,
    model: r.model, pInteraction: r.pInteraction, keepInteraction: r.keepInteraction,
    anova: r.anova, components: r.components,
    vRepeat: r.vRepeat, vReprod: r.vReprod, vGrr: r.vGrr, vPart: r.vPart, vTotal: r.vTotal,
    pctStudyGrr: r.pctStudyGrr, pctTolerance: r.pctTolerance, tolerance: r.tolerance,
    lsl: r.lsl, usl: r.usl, ndc: isFinite(r.ndc) ? r.ndc : null, verdict: r.verdict, judgedOn: r.judgedOn
  });

  function clear() {
    table = null; last = null; window.MLVarianceRun = null;
    $('vc-data').value = ''; $('vc-file').value = '';
    $('vc-out').innerHTML = ''; $('vc-read').textContent = '';
    $('vc-settings').hidden = true; $('vc-error').hidden = true;
    $('vc-lsl').value = ''; $('vc-usl').value = '';
  }

  function init() {
    showMode();
    $('vc-mode').addEventListener('change', () => { table = null; $('vc-settings').hidden = true; $('vc-data').value = ''; showMode(); });
    $('vc-data').addEventListener('change', () => { if ($('vc-data').value.trim()) { $('delete-top').hidden = false; loadText($('vc-data').value); } });
    $('vc-file').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const fr = new FileReader();
      fr.onload = () => load(String(fr.result));
      fr.readAsText(f);
    });
    ['vc-group', 'vc-value', 'vc-part', 'vc-operator', 'vc-grr-value', 'vc-a-part', 'vc-a-operator', 'vc-a-rating', 'vc-a-standard'].forEach(id => $(id).addEventListener('change', describe));
    /* Changing the size column changes which thresholds exist, so the tail-fraction pickers
       have to be rebuilt before they are read. */
    if ($('vc-psd-size')) {
      $('vc-psd-size').addEventListener('change', () => { fillPsdThresholds(); describe(); });
      ['vc-psd-count', 'vc-psd-group', 'vc-psd-kind', 'vc-psd-lo', 'vc-psd-hi'].forEach(id => $(id).addEventListener('change', describe));
    }
    $('vc-run').addEventListener('click', run);
  }

  window.MLVarUI = { clear, example };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
