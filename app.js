/* BOSS page logic. Reads files with the browser's FileReader (local only), runs the
   agent, and draws results. Data lives only in the `state` object below. "Finish and delete"
   (or 30 idle minutes, or leaving the page) drops it and every result from the page. */
(function () {
  'use strict';
  const A = window.MLAgent, D = window.MLDoe, E = window.MLEngine, C = window.Charts, X = window.MLExplain;
  const h = C.esc, fmt = A.fmt, pct = A.pct;
  const $ = id => document.getElementById(id);
  const IDLE_MS = 30 * 60 * 1000;

  const state = { table: null, prof: null, name: '', report: null, sampleTarget: null, factors: null, design: null, sources: [], merge: null, pending: null, roleTarget: null };
  const M = window.MLMerge, AU = window.MLAudit;
  // What was loaded, for the audit trail: file name, size, rows, columns and SHA-256 fingerprint.
  const sourceInfo = (name, text, table) => ({ name, bytes: AU.utf8(text).length, rows: table.rows.length, cols: table.columns.length, sha256: AU.sha256(text) });
  const DEFAULT_FACTORS = () => [{ name: 'Temperature', low: 150, high: 180 }, { name: 'Time', low: 30, high: 60 }, { name: 'Catalyst', low: 'Type A', high: 'Type B' }];

  // ---------- Loading ----------
  function showError(id, msg) { const el = $(id); el.textContent = msg; el.hidden = !msg; }

  /* Panels that are only worth reading when there is a reason to: the DOE builder once the
     agent has something to suggest. The practice datasets used to fold away here too; they
     now live on the "Where to start" page, so the tool page has nothing to collapse. */
  function foldPanels() {
    if (!state.table) $('doe-wrap').open = false;
    // The "no data to hand?" card is an invitation, so it goes once the invitation is taken.
    if ($('start-card')) $('start-card').hidden = !!state.table;
  }

  function loadText(text, name, sampleTarget) {
    showError('load-error', ''); $('deleted-note').hidden = true;
    let table;
    try { table = E.parseTable(text, name); } catch (e) { return showError('load-error', 'Could not read that data: ' + e.message); }
    if (!table.columns.length || !table.rows.length) return showError('load-error', 'No data found. The first row should hold column names, with one row per observation below it.');
    if (table.columns.length < 2) return showError('load-error', 'Only one column found. If your file uses another separator, try pasting the cells from Excel instead.');
    state.table = table; state.name = name; state.sampleTarget = sampleTarget || null;
    // What shape the file turned out to be, so a JSON export read the wrong way is visible.
    state.shape = table.shape || null;
    state.sources = [sourceInfo(name, text, table)]; state.merge = null; state.pending = null; state.roleTarget = null; state.original = table;
    state.prof = E.profile(table);
    resetMerge();
    state.report = state.sim = null;
    $('sim').innerHTML = ''; $('sim').hidden = true;
    $('results').hidden = true; $('next').hidden = true; $('progress').hidden = true; showError('run-error', '');
    $('delete-top').hidden = false;
    renderSetup();
    $('setup').hidden = false;
    foldPanels();
    touch();
    $('setup').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function readFile(file) {
    if (!file) return;
    if (/\.(xlsx|xls|xlsm)$/i.test(file.name)) return showError('load-error', 'Excel workbooks need one extra step: in Excel use File → Save As → CSV, or copy the cells and paste them in the box.');
    if (file.size > 50 * 1024 * 1024) return showError('load-error', 'That file is over 50 MB. Try a sample of the rows, or remove columns you do not need.');
    const reader = new FileReader();
    reader.onload = () => { const text = String(reader.result); $('file').value = ''; loadText(text, file.name); };
    reader.onerror = () => showError('load-error', 'Could not read the file.');
    reader.readAsText(file);
  }

  // ---------- Setup ----------
  const KIND_LABEL = { numeric: 'number', categorical: 'category', id: 'ID', constant: 'constant', text: 'free text', empty: 'empty' };

  function renderSetup() {
    const prof = state.prof;
    $('data-summary').innerHTML = '<b>' + h(state.name) + '</b>: ' + prof.nRows.toLocaleString() + ' rows × ' + prof.nCols + ' columns. The agent has checked each column below.';
    renderPreview();
    const usable = prof.columns.filter(E.isUsableFeature);
    const guess = state.sampleTarget || A.guessTarget(prof);
    $('target').innerHTML = usable.map(c => '<option value="' + h(c.name) + '"' + (c.name === guess ? ' selected' : '') + '>' + h(c.name) + '</option>').join('') +
      '<option value="__none__"' + (guess === '__none__' ? ' selected' : '') + '>Nothing: find groups and patterns (unsupervised)</option>';
    $('task').value = 'auto';
    /* Only numeric columns can say how many units were looked at, and the target itself
       cannot be its own denominator. */
    if ($('count-units')) {
      const num = prof.columns.filter(c => c.kind === 'numeric' && c.name !== guess);
      $('count-units').innerHTML = '<option value="">\u2014 not counted data \u2014</option>' +
        num.map(c => '<option value="' + h(c.name) + '">' + h(c.name) + '</option>').join('');
    }
    renderProfile();
    const pv = state.table.rows.slice(0, 8);
    $('preview').innerHTML = '<thead><tr>' + state.table.columns.map(c => '<th>' + h(c) + '</th>').join('') + '</tr></thead><tbody>' +
      pv.map(r => '<tr>' + r.map(v => '<td>' + h(v) + '</td>').join('') + '</tr>').join('') + '</tbody>';
  }

  function renderGoal(col, task) {
    const sel = $('goal');
    if (!col) { sel.innerHTML = '<option value="max">Not needed for finding groups</option>'; sel.disabled = true; return; }
    sel.disabled = false;
    if (task === 'classification') {
      const classes = (col.levels || []).map(String);
      const fav = A.guessFavorable(classes);
      sel.innerHTML = classes.map((c, i) => '<option value="class:' + h(c) + '"' + (i === fav ? ' selected' : '') + '>More "' + h(c) + '" is better</option>').join('');
    } else {
      sel.innerHTML = '<option value="max">Higher ' + h(col.name) + ' is better</option><option value="min">Lower ' + h(col.name) + ' is better</option>';
      if (/defect|scrap|cost|time|delay|downtime|error|waste|reject|cycle|lead|days|hours/i.test(col.name)) sel.value = 'min';
    }
  }

  /* The data itself, before anything is done to it.

     Step 2 showed a column profile - type, role, missing, distinct, range - which answers
     "what did it make of my columns" and not "did my file load correctly". Those are
     different questions, and the second one is the one somebody has at the moment they press
     the button. A row shifted by a stray comma, a header read as data, a date column that
     arrived as numbers: all obvious in a table of rows and invisible in a summary of columns.

     Capped at 100 rows because this renders synchronously on the load path and a 40,000-row
     table would freeze the tab for the sake of rows nobody scrolls to. */
  const PREVIEW_ROWS = 100;
  function renderPreview() {
    const host = $('data-preview');
    if (!host) return;
    const t = state.table;
    if (!t || !t.rows.length) { host.innerHTML = ''; return; }
    const shown = Math.min(PREVIEW_ROWS, t.rows.length);
    const cells = t.rows.length * t.columns.length;
    const head = '<tr>' + t.columns.map(c => '<th>' + h(c) + '</th>').join('') + '</tr>';
    let body = '';
    for (let i = 0; i < shown; i++) {
      const r = t.rows[i];
      body += '<tr>' + t.columns.map((c, j) => {
        const v = r[j];
        // An empty cell is worth seeing as empty rather than as nothing at all.
        return v === undefined || v === null || String(v).trim() === ''
          ? '<td class="cell-empty">&mdash;</td>' : '<td>' + h(String(v)) + '</td>';
      }).join('') + '</tr>';
    }
    host.innerHTML = '<div class="preview">' +
      '<p class="preview-head">Previewing ' + (t.rows.length > shown ? 'the first <b>' + shown + '</b> rows of ' : 'all <b>' + shown + '</b> rows of ') +
      '<b>' + h(state.name || 'your data') + '</b></p>' +
      '<div class="table-scroll"><table class="preview-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="preview-foot"><span>' + h(state.shape ? 'JSON: ' + state.shape : 'Tabular') + '</span><span>' + t.columns.length + ' columns &times; ' +
      t.rows.length.toLocaleString() + ' rows</span><span>' + cells.toLocaleString() + ' cells</span>' +
      '<span>Read in this browser. Never uploaded.</span></p></div>';
  }

  function renderProfile() {
    const target = $('target').value;
    const roles = A.columnRoles(state.prof);
    let excluded = new Set(Array.from(document.querySelectorAll('#profile input[data-col]')).filter(i => !i.checked).map(i => i.getAttribute('data-col')));
    // A new target resets the defaults: other measured results start unchecked.
    if (state.roleTarget !== target) { excluded = new Set(target === '__none__' ? [] : A.otherResults(state.prof, target)); state.roleTarget = target; }
    const rows = state.prof.columns.map(c => {
      const isT = c.name === target;
      const usable = E.isUsableFeature(c);
      let detail = '';
      if (c.stats) detail = h(fmt(c.stats.min) + ' to ' + fmt(c.stats.max) + ', median ' + fmt(c.stats.median));
      else if (c.levels) detail = c.levels.slice(0, 4).map(h).join(', ') + (c.levels.length > 4 ? ', …' : '');
      const chip = isT ? '<span class="chip target">target</span>' : usable ? '<span class="chip">' + KIND_LABEL[c.kind] + '</span>' : '<span class="chip off">' + KIND_LABEL[c.kind] + ', set aside</span>';
      const box = usable && !isT ? '<input type="checkbox" aria-label="Use ' + h(c.name) + '" data-col="' + h(c.name) + '"' + (excluded.has(c.name) ? '' : ' checked') + '>' : '';
      const r = roles[c.name], roleChip = '<span class="role role-' + r.role + '">' + h(r.label) + '</span>' + (usable && !isT && excluded.has(c.name) && ['result', 'measurement'].includes(r.role) ? '<small class="role-why">off: another measured result</small>' : '');
      return '<tr' + (usable ? '' : ' class="dim"') + '><td>' + box + '</td><td><b>' + h(c.name) + '</b></td><td>' + chip + '</td><td>' + roleChip + '</td><td class="num-cell">' + (c.missing ? c.missing + ' (' + pct(c.missing / c.n) + ')' : '0') + '</td><td class="num-cell">' + c.unique + '</td><td>' + detail + '</td></tr>';
    });
    $('profile').innerHTML = '<thead><tr><th>Use</th><th>Column</th><th>Type</th><th>Role</th><th class="num-cell">Missing</th><th class="num-cell">Distinct</th><th>Range or values</th></tr></thead><tbody>' + rows.join('') + '</tbody>';
    const col = state.prof.columns.find(c => c.name === target);
    const task = col && A.decideTask(col, $('task').value);
    renderGoal(col, task);
    renderSpcPanel(col, task);
    renderMulti(col, task, roles);
    $('target-hint').textContent = !col ? 'No target: the agent will look for natural groups (clustering), main directions of variation (PCA) and unusual rows.'
      : task === 'regression' ? '"' + target + '" is a number, so the agent will run regression models and check whether the data is a designed experiment.'
        : '"' + target + '" is a category, so the agent will run classification models.';
    const tr = col && roles[col.name];
    if (tr && tr.role === 'result' && tr.priority <= 5 && !sigmaMode() && task === 'regression') $('target-hint').textContent += ' This looks like a QC or release result: switch on Six Sigma mode below to check it against your specification (for example LSL 95.0 for purity).';
  }

  // ---------- Several results at once (setup) ----------
  function multiDefaults(col, roles, isPrimary) {
    const v = col.values.filter(x => x !== null).sort((a, b) => a - b), q = p => Number(E.quantile(v, p).toPrecision(4));
    const r = roles[col.name] || {};
    const goal = isPrimary ? ($('goal').value === 'min' ? 'min' : 'max') : r.label === 'result: impurity' || /defect|scrap|cost|time|waste|reject/i.test(col.name) ? 'min' : r.role === 'measurement' ? 'target' : 'max';
    return { name: col.name, on: isPrimary || r.role === 'result', goal, low: q(0.1), high: q(0.9), target: goal === 'target' ? q(0.5) : null, weight: isPrimary ? 3 : 2 };
  }
  function renderMulti(col, task, roles) {
    const tbl = $('multi-table');
    if (!col || task !== 'regression') { tbl.innerHTML = '<tbody><tr><td>Multi-result optimization needs a numeric target. Pick one above.</td></tr></tbody>'; $('multi-add').disabled = true; state.multiRows = null; return; }
    $('multi-add').disabled = false;
    const prev = state.multiRows && state.multiRows.primary === col.name ? state.multiRows.rows : null;
    if (!prev) {
      const others = state.prof.columns.filter(c => c !== col && c.kind === 'numeric' && ['result', 'measurement'].includes(roles[c.name].role));
      state.multiRows = { primary: col.name, rows: [multiDefaults(col, roles, true)].concat(others.map(c => multiDefaults(c, roles, false))) };
    }
    drawMulti(roles);
  }
  function drawMulti(roles) {
    const rows = state.multiRows.rows;
    const num = (i, k, v, dis) => '<input type="number" step="any" data-m="' + i + '" data-k="' + k + '" value="' + (v === null || v === undefined ? '' : v) + '"' + (dis ? ' disabled' : '') + ' aria-label="' + k + '">';
    $('multi-table').innerHTML = '<thead><tr><th>Use</th><th>Result</th><th>Goal</th><th>Low</th><th>High</th><th>Target</th><th>Importance</th></tr></thead><tbody>' +
      rows.map((r, i) => '<tr><td><input type="checkbox" data-m="' + i + '" data-k="on"' + (r.on ? ' checked' : '') + (i === 0 ? ' disabled' : '') + ' aria-label="Use ' + h(r.name) + '"></td><td><b>' + h(r.name) + '</b>' + (i === 0 ? ' <span class="chip target">target</span>' : '') + '</td>' +
        '<td><select data-m="' + i + '" data-k="goal">' + [['max', 'Maximize'], ['min', 'Minimize'], ['target', 'Hit a target']].map(([v, l]) => '<option value="' + v + '"' + (r.goal === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></td>' +
        '<td>' + num(i, 'low', r.low) + '</td><td>' + num(i, 'high', r.high) + '</td><td>' + num(i, 'target', r.target, r.goal !== 'target') + '</td>' +
        '<td><select data-m="' + i + '" data-k="weight">' + [1, 2, 3, 4, 5].map(w => '<option' + (r.weight === w ? ' selected' : '') + '>' + w + '</option>').join('') + '</select></td></tr>').join('') + '</tbody>';
    const inTable = new Set(rows.map(r => r.name));
    const extra = state.prof.columns.filter(c => c.kind === 'numeric' && !inTable.has(c.name));
    $('multi-add').innerHTML = '<option value="">Choose a column…</option>' + extra.map(c => '<option>' + h(c.name) + '</option>').join('');
  }
  function readMulti() {
    if (!$('multi').open || !state.multiRows) return null;
    const on = state.multiRows.rows.filter(r => r.on);
    if (on.length < 2) return null;
    return { responses: on.map(r => ({ name: r.name, goal: r.goal, low: r.low, high: r.high, target: r.goal === 'target' ? r.target : null, weight: r.weight })) };
  }

  // ---------- Joining a second file ----------
  function resetMerge() {
    $('merge').open = false; $('merge-config').hidden = true; $('m-result').hidden = true; $('file2').value = '';
  }
  function stageSecond(text, name) {
    let t;
    try { t = E.parseTable(text, name); } catch (e) { return showError('load-error', 'Could not read the second file: ' + e.message); }
    if (!t.rows.length || t.columns.length < 2) return showError('load-error', 'The second file has no usable rows.');
    const base = state.original || state.table;
    state.pending = { text, name, table: t };
    const sug = M.suggestKeys(base, t);
    $('m-left-name').textContent = state.sources[0].name; $('m-right-name').textContent = name;
    $('m-left').innerHTML = base.columns.map(c => '<option' + (sug[0] && sug[0].left === c ? ' selected' : '') + '>' + h(c) + '</option>').join('');
    $('m-right').innerHTML = t.columns.map(c => '<option' + (sug[0] && sug[0].right === c ? ' selected' : '') + '>' + h(c) + '</option>').join('');
    $('merge-config').hidden = false; $('m-result').hidden = true; $('merge').open = true;
    previewJoin(sug.length ? '' : 'No column pair with matching values was found automatically. Pick the key columns yourself.');
  }
  function previewJoin(note) {
    const p = state.pending; if (!p) return;
    let r;
    try { r = M.join(state.original || state.table, p.table, { leftKey: $('m-left').value, rightKey: $('m-right').value, how: $('m-how').value, bName: shortName(p.name) }); }
    catch (e) { $('m-preview').textContent = e.message; return; }
    const s = r.stats, ex = a => a.slice(0, 4).join(', ') + (a.length > 4 ? '…' : '');
    $('m-preview').textContent = (note ? note + ' ' : '') + s.matchedKeys + ' IDs match. ' +
      (s.unmatchedLeft.length ? s.unmatchedLeft.length + ' only in ' + state.sources[0].name + ' (' + ex(s.unmatchedLeft) + '). ' : '') +
      (s.unmatchedRight.length ? s.unmatchedRight.length + ' only in ' + p.name + ' (' + ex(s.unmatchedRight) + '). ' : '') +
      (s.repeatedKeys ? s.repeatedKeys + ' IDs have repeated rows in ' + p.name + ': numbers are averaged' + (s.droppedReplicateColumns.length ? ', ' + s.droppedReplicateColumns.join(', ') + ' dropped' : '') + '. ' : '') +
      'Result: ' + s.outputRows + ' rows × ' + r.table.columns.length + ' columns.';
    $('m-join').disabled = !s.matchedKeys;
  }
  const shortName = n => String(n).replace(/\.(csv|tsv|txt)$/i, '').slice(0, 24);
  function doJoin() {
    const p = state.pending; if (!p) return;
    const left = state.original || state.table;
    const r = M.join(left, p.table, { leftKey: $('m-left').value, rightKey: $('m-right').value, how: $('m-how').value, bName: shortName(p.name) });
    state.sources = [state.sources[0], sourceInfo(p.name, p.text, p.table)];
    state.merge = Object.assign({ leftKey: $('m-left').value, rightKey: $('m-right').value, left: state.sources[0].name, right: p.name }, r.stats);
    state.table = r.table; state.name = state.sources[0].name + ' + ' + p.name;
    state.prof = E.profile(r.table); state.roleTarget = null; state.report = null;
    state.pending = null;
    renderSetup();
    $('merge').open = true; $('merge-config').hidden = true;
    $('m-result').hidden = false;
    $('m-result').innerHTML = '✓ Joined on ' + h(state.merge.leftKey) + ' = ' + h(state.merge.rightKey) + ': ' + state.merge.outputRows + ' rows. ' + h($('m-preview').textContent.replace(/^.*?IDs match\. /, '')) + ' <button type="button" class="btn ghost small" id="m-undo">Undo the join</button>';
  }
  function undoJoin() {
    state.table = state.original; state.name = state.sources[0].name; state.sources = [state.sources[0]]; state.merge = null;
    state.prof = E.profile(state.table); state.roleTarget = null; state.report = null;
    renderSetup(); resetMerge();
  }

  // ---------- Six Sigma mode (setup) ----------
  const sigmaMode = () => document.querySelector('input[name="mode"]:checked').value === 'sigma';
  function renderSpcPanel(col, task) {
    const on = sigmaMode();
    $('spc-panel').hidden = !on;
    if (!on) return;
    const numeric = col && task === 'regression';
    $('spc-fields').hidden = !numeric;
    $('spc-intro').textContent = !col ? 'Six Sigma mode needs a target column. With no target, the agent runs the usual group finding.'
      : numeric ? 'Does "' + col.name + '" have specification limits? All optional: leave them blank and you still get the control chart, box plots and robustness analysis.'
        : '"' + col.name + '" is pass/fail or a category, so the agent will report the defect rate, defects per million and sigma level. "Which result is better?" sets what counts as good.';
    if (numeric && col.stats) {
      $('lsl').placeholder = 'data min ' + fmt(col.stats.min);
      $('usl').placeholder = 'data max ' + fmt(col.stats.max);
      $('spec-target').placeholder = 'optional';
    }
  }
  // Returns the Six Sigma options, or throws a message for the user.
  function readSpc() {
    if (!sigmaMode()) return null;
    const v = id => { const t = $(id).value.trim(); return t === '' ? null : Number(t); };
    const lsl = v('lsl'), usl = v('usl'), target = v('spec-target');
    if ([lsl, usl, target].some(x => x !== null && !isFinite(x))) throw new Error('Spec limits must be numbers.');
    if (lsl !== null && usl !== null && lsl >= usl) throw new Error('The lower spec limit must be below the upper spec limit.');
    if (target !== null && ((lsl !== null && target < lsl) || (usl !== null && target > usl))) throw new Error('The target value must sit between the spec limits.');
    return { lsl, usl, target, timeOrdered: $('time-ordered').checked, unitsColumn: $('count-units') ? $('count-units').value || null : null };
  }

  // ---------- Run ----------
  async function runAgent() {
    if (!state.table) return;
    showError('run-error', '');
    const btn = $('run'); btn.disabled = true; btn.textContent = 'Running…';
    $('progress').hidden = false; $('agent-log').innerHTML = ''; $('progress-bar').value = 2; $('progress-text').textContent = 'Starting';
    $('nn-live').hidden = true; $('nn-live-chart').innerHTML = '';
    const exclude = Array.from(document.querySelectorAll('#profile input[data-col]')).filter(i => !i.checked).map(i => i.getAttribute('data-col'));
    showError('spc-error', '');
    let sixSigma;
    try { sixSigma = readSpc(); } catch (e) {
      showError('spc-error', e.message); $('progress').hidden = true; btn.disabled = false; btn.textContent = 'Run the agent'; return;
    }
    try {
      const others = new Set($('target').value === '__none__' ? [] : A.otherResults(state.prof, $('target').value));
      const multi = readMulti();
      const opts = { target: $('target').value, task: $('task').value, goal: $('goal').value, exclude, roleExclude: exclude.filter(n => others.has(n)), sixSigma, multi };
      state.runOptions = opts; state.runAt = new Date();
      const rep = await A.run(state.table, opts, p => {
        if (p.log) $('agent-log').innerHTML = p.log.map(l => '<li class="log-' + l.kind + '">' + h(l.text) + '</li>').join('');
        if (p.total) { $('progress-bar').value = 5 + 90 * p.done / p.total; $('progress-text').textContent = 'Testing ' + p.model + ' (' + (p.done + 1) + ' of ' + p.total + ')'; }
        if (p.nn) {
          $('nn-live').hidden = false;
          $('progress-text').textContent = 'Neural network: epoch ' + p.nn.history.length;
          lossChart($('nn-live-chart'), p.nn, 220);
        }
      });
      if (!state.table) return; // deleted while running
      $('progress-bar').value = 100; $('progress-text').textContent = 'Finished';
      state.report = rep;
      renderResults(rep);
    } catch (e) {
      showError('run-error', e.message || String(e));
      $('progress-text').textContent = 'Stopped';
    } finally {
      btn.disabled = false; btn.textContent = 'Run the agent';
    }
  }

  // ---------- Result building blocks ----------
  function learnLink(topic, text) { return '<a class="learn-link" href="learn.html#' + topic + '" target="_blank" rel="noopener noreferrer">' + h(text || 'Learn how this works') + ' ↗</a>'; }
  function howTo(key, extra) {
    const r = X.READ[key];
    /* A key with no entry used to throw here, and because the whole results render sits in
       a try/catch that emptied the entire section over a missing help box. A missing box is
       a missing box; the build asserts the key exists, and the page degrades rather than
       going blank if one ever slips through. */
    if (!r) return '';
    return '<details class="howto"><summary>How to read this</summary><p>' + h(r[0]) + (extra ? ' ' + h(extra) : '') + '</p><p class="analogy">' + h(r[1]) + '</p><p>' + learnLink(r[2]) + '</p></details>';
  }
  function tile(label, val, sub, hero, badge) { return '<div class="tile' + (hero ? ' hero-tile' : '') + '"><div class="lbl">' + h(label) + '</div><div class="val">' + h(val) + '</div><div class="sub">' + h(sub || '') + '</div>' + (badge || '') + '</div>'; }
  // Under 30 rows, one or two unusual rows can swing a cross-validated score by a lot.
  const SMALL_N = 30;
  function smallSampleBadge(rep) {
    const n = rep.nUsed || 0;
    if (!n || n >= SMALL_N) return '';
    const tip = 'Only ' + n + ' rows were scored. With fewer than ' + SMALL_N + ', the score can move a lot if a few rows change, so read it as a rough guide, not a precise number.' +
      (rep.doe ? ' The DOE effects analysis is built for small run counts and is the better guide here.' : ' More rows, or a designed experiment, will firm it up.');
    return '<span class="risk-badge" tabindex="0" data-tip="' + h(tip) + '" aria-label="' + h(tip) + '">⚠ Small sample size: high variance risk</span>';
  }
  function card(title, sub, inner, readKey, extra) { return '<div class="card"><h3>' + h(title) + '</h3>' + (sub ? '<p class="sub-head">' + sub + '</p>' : '') + inner + (readKey ? howTo(readKey, extra) : '') + '</div>'; }
  function append(parent, html, cls) {
    const d = document.createElement('div');
    d.innerHTML = html;
    if (cls) { d.className = cls; parent.appendChild(d); return d; }
    const el = d.firstElementChild; parent.appendChild(el); return el;
  }

  /* The paragraph somebody reads instead of the charts. Everything below it is the evidence;
     this is the finding. Written so it survives being pasted into an email on its own. */
  function plainSummary(rep) {
    let head = '', text = '';
    if (rep.task === 'clustering') {
      const c = rep.clustering;
      head = c.k + ' natural groups';
      text = 'Without being told what to look for, the agent found ' + c.k + ' groups in these ' + rep.profile.nRows.toLocaleString() + ' rows' +
        (c.silhouette >= 0.5 ? ', and they separate cleanly' : ', though they overlap, so treat the split as a hint rather than a fact') + '. ' +
        (c.outliers.length ? c.outliers.length + ' row' + (c.outliers.length === 1 ? ' sits' : 's sit') + ' far from every group and may be worth checking individually.' : 'No rows sat far outside every group.');
    } else {
      const b = rep.best, reg = rep.task === 'regression';
      const score = reg ? Math.max(0, b.metrics.r2) : b.metrics.accuracy;
      const strength = score >= 0.8 ? 'strong' : score >= 0.5 ? 'moderate' : 'weak';
      const top = rep.importance && rep.importance.length ? rep.importance[0] : null;
      const act = rep.actionPlan && rep.actionPlan.items && rep.actionPlan.items.length ? rep.actionPlan.items[0] : null;
      head = strength === 'weak' ? 'The data cannot explain this yet' : 'What drives ' + rep.target;
      text = reg
        ? 'Using ' + rep.features.length + ' input' + (rep.features.length === 1 ? '' : 's') + ' from ' + (rep.nUsed || rep.profile.nRows).toLocaleString() + ' rows, the agent can account for ' + pct(score) + ' of why ' + rep.target + ' varies, which is a ' + strength + ' result.'
        : 'Using ' + rep.features.length + ' input' + (rep.features.length === 1 ? '' : 's') + ' from ' + (rep.nUsed || rep.profile.nRows).toLocaleString() + ' rows, the agent predicts ' + rep.target + ' correctly ' + pct(score) + ' of the time on cases it had never seen, which is a ' + strength + ' result.';
      if (top) text += ' The single biggest influence is ' + top.name + ', accounting for ' + pct(top.share) + ' of what the model relies on.';
      if (act && strength !== 'weak') {
        const a = act.text.replace(/\s*\.\s*$/, '');
        text += ' The first thing to try: ' + a.charAt(0).toLowerCase() + a.slice(1) + '.';
      }
      if (strength === 'weak') text += ' That usually means the things that really matter were not measured, rather than that nothing matters. The designed experiment below is the way to find out.';
    }
    const tone = rep.task === 'clustering' ? '' : (rep.best && (rep.task === 'regression' ? Math.max(0, rep.best.metrics.r2) : rep.best.metrics.accuracy) >= 0.5 ? ' capable' : ' marginal');
    return '<div class="plain' + tone + '"><h4>' + h(head) + '</h4><p>' + h(text) + '</p></div>';
  }

  // quiet: re-draw in place (after changing the target class) without scrolling or redoing the DOE.
  function renderResults(rep, quiet) {
    const tiles = [];
    if (rep.task === 'clustering') {
      const c = rep.clustering;
      tiles.push(tile('Problem type', 'Unsupervised', 'Finding groups and patterns'));
      tiles.push(tile('Groups found', String(c.k), 'k-means, best of 2 to ' + (c.tries.length + 1), true));
      tiles.push(tile('Separation', c.silhouette.toFixed(2), 'silhouette, −1 to 1 (above 0.5 is clear)'));
      tiles.push(tile('Unusual rows', String(c.outliers.length), 'far from every group'));
    } else {
      const b = rep.best, reg = rep.task === 'regression';
      tiles.push(tile('Problem type', reg ? 'Regression' : 'Classification', reg ? 'Predicting the number ' + rep.target : 'Predicting the category ' + rep.target));
      tiles.push(tile('Best model', b.name, X.MODEL_ANALOGY[b.id] || rep.bestReason, true));
      tiles.push(reg ? tile('Variation explained', pct(Math.max(0, b.metrics.r2)), 'R² on unseen rows · error ±' + fmt(b.metrics.rmse), false, smallSampleBadge(rep))
        : tile('Accuracy', pct(b.metrics.accuracy), 'on unseen rows · balanced ' + pct(b.metrics.balancedAccuracy), false, smallSampleBadge(rep)));
      tiles.push(rep.doe ? tile('Designed experiment', rep.doe.k + ' factors', rep.doe.n + ' runs, effects analysis below')
        : tile('Rows used', (rep.nUsed || 0).toLocaleString(), (rep.folds === rep.nUsed ? 'leave-one-out' : rep.folds + '-fold') + ' cross-validation' + (rep.sampled ? ', sampled' : '')));
    }
    if (rep.spc && rep.spc.capability) {
      const c = rep.spc.capability, k = c.Cpk !== null ? c.Cpk : c.Ppk;
      /* The index stands whatever the shape; the PPM beside it does not, so on data that
         fails the normality test the tile shows what was actually observed instead. */
      if (k !== null) tiles.push(tile('Process capability', (c.Cpk !== null ? 'Cpk ' : 'Ppk ') + k.toFixed(2),
        c.verdict + ' · ' + (c.tailsUsable === false
          ? c.observedOut + ' of ' + c.n + ' rows observed out of spec'
          : fmt(c.ppm, 0) + ' PPM expected out of spec')));
    } else if (rep.spc && rep.spc.attribute) {
      const a = rep.spc.attribute;
      tiles.push(tile('Sigma level', a.sigmaLevel.toFixed(1) + ' σ', fmt(a.dpmo, 0) + ' defects per million · yield ' + pct(a.yield)));
    }
    $('tiles').innerHTML = plainSummary(rep) + tiles.join('');
    renderPlan(rep);
    renderSimulator(rep);
    $('insights').innerHTML = rep.insights.map(i => '<li class="' + i.level + '">' + h(i.text) + '</li>').join('');

    const blocks = $('result-blocks');
    blocks.innerHTML = '';
    $('results').hidden = false;
    if (rep.desirability) renderDesirability(rep, blocks);
    if (rep.spc) renderSPC(rep, blocks);
    if (rep.doe) renderDOE(rep, blocks);
    if (rep.task === 'clustering') renderClusters(rep, blocks);
    else renderSupervised(rep, blocks);
    renderCorrelations(rep, blocks);

    $('next-steps').innerHTML = rep.nextSteps.map(s => '<li class="p-' + s.phase + '"><span class="phase">' + h(s.phase) + '</span><b>' + h(s.title) + '</b><p>' + h(s.text) + '</p></li>').join('');
    $('next').hidden = false;
    // The iteration panel takes the loaded data as round 0 and the chosen target as its result.
    if (window.MLCampaignUI) window.MLCampaignUI.sync(state.table, state.name, $('target').value);
    if (quiet) return;
    if (rep.doeRecommendation && rep.doeRecommendation.factors.length) prefillDOE(rep);
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Target outcome and starting class, for classification. Changing them re-aims the plan.
  function planControls(rep) {
    if (rep.task !== 'classification' || !rep.classes || rep.classes.length < 2 || !rep.pdFor) return '';
    const order = A.classOrder(rep.classes);
    const counts = rep.classes.map((_, k) => rep.actual.filter(v => v === k).length);
    // For ranked tiers, "lowest tier or better" is everyone, so it is not offered as a target.
    const targets = rep.ordinal ? order.slice(0, -1) : order;
    return '<div class="plan-controls"><label>Target outcome <select id="plan-target">' +
      targets.map(k => '<option value="' + k + '"' + (k === rep.favorable ? ' selected' : '') + '>' + h(rep.classes[k]) + (rep.ordinal && k !== order[0] ? ' or better' : '') + '</option>').join('') +
      '</select></label><label>Starting from <select id="plan-from"><option value="">All rows</option>' +
      order.map(k => '<option value="' + k + '"' + (k === rep.fromClass ? ' selected' : '') + '>Rows now ' + h(rep.classes[k]) + ' (' + counts[k] + ')</option>').join('') +
      '</select></label><span class="hint">Re-aims the plan, the driver curves and the model peek. ' + (rep.ordinal ? 'Tiers are ranked, so a target means that tier or better.' : '') + '</span></div>';
  }
  function retargetFrom(changedId) {
    const rep = state.report; if (!rep) return;
    const from = $('plan-from').value;
    A.retarget(rep, Number($('plan-target').value), from === '' ? null : Number(from));
    renderResults(rep, true);
    const opt = Array.from($('goal').options).find(o => o.value === rep.goal);
    if (opt) $('goal').value = rep.goal;
    $(changedId).focus();
  }

  function renderPlan(rep) {
    const p = rep.actionPlan, el = $('plan');
    if (!p || !p.items.length) { el.innerHTML = planControls(rep) + '<h3>Action plan</h3><p>No clear levers stood out' + (rep.fromClass !== null && rep.fromClass !== undefined ? ' for this combination' : ' in this data') + '. See the findings below, and consider collecting the drivers the team believes matter.</p>'; return; }
    const confText = { high: 'high confidence', medium: 'medium confidence', low: 'low confidence: treat as hints' }[p.confidence];
    el.innerHTML = planControls(rep) + '<h3>Action plan in plain English <span class="conf ' + p.confidence + '">' + confText + '</span></h3>' +
      '<p class="sub-head">' + h(p.headline) + '</p><ol class="plan-list">' +
      p.items.map(i => '<li><span class="verb ' + i.verb + '">' + h(i.verb) + '</span><div><b>' + h(i.text) + '</b>' + (i.impactText ? '<span class="impact">' + h(i.impactText) + '</span>' : '') + '</div></li>').join('') + '</ol>' +
      (p.quiet && p.quiet.length ? '<p><b>Little effect:</b> ' + h(p.quiet.join(', ')) + '. In the range you have run, these barely move the result, so set them for cost, speed or convenience.</p>' : '') +
      (p.combined ? '<p><b>All together:</b> ' + h(p.combined) + '</p>' : '') +
      '<p class="hint">' + h(p.caveat) + ' ' + learnLink('reading-results', 'How the action plan is worked out') + '</p>';
  }

  function renderSPC(rep, blocks) {
    const s = rep.spc;
    const row = (k, v) => v === null || v === undefined || v === '' ? '' : '<tr><td>' + h(k) + '</td><td class="num-cell"><b>' + h(v) + '</b></td></tr>';
    const f2 = v => (v === null || v === undefined || !isFinite(v) ? null : v.toFixed(2));
    if (s.attribute) {
      const a = s.attribute;
      append(blocks, card('Quality level (pass/fail)', 'Good outcome: ' + h(s.goodLabel) + '. Every other result counts as a defect.',
        '<div class="table-scroll"><table class="spc-table"><tbody>' + row('Rows', a.total.toLocaleString()) + row('Defects', a.defects.toLocaleString()) + row('Defect rate', pct(a.p)) + row('Yield', pct(a.yield)) +
        row('Defects per million (DPMO)', fmt(a.dpmo, 0)) + row('Z (long term)', f2(a.zLT)) + row('Sigma level (short term, +1.5 shift)', a.sigmaLevel.toFixed(2)) + '</tbody></table></div>', 'sigma'));
      return;
    }
    const c = s.capability, st = s.stats;
    /* Capability only exists when specification limits were given; the control chart, box
       plots and the rest do not need them. Reaching through it unguarded took out the whole
       Six Sigma section for anybody who left the limits blank. */
    const nn = c && c.nonNormal ? c.nonNormal : null;
    const histHtml = '<div class="spc-hist"></div>';
    if (c) {
      const v = c.verdict === 'not capable' ? 'not' : c.verdict;
      append(blocks,
        card('Process capability', 'Against ' + [c.lsl !== null ? 'LSL ' + fmt(c.lsl) : '', c.usl !== null ? 'USL ' + fmt(c.usl) : '', c.target !== null ? 'target ' + fmt(c.target) : ''].filter(Boolean).join(', ') + '. <span class="verdict ' + v + '">' + h(c.verdict) + '</span>' + (s.designed ? '<br>Designed experiment: this spread was created on purpose, so read these as illustration only.' : ''),
          '<div class="table-scroll"><table class="spc-table"><tbody>' + row('Rows', c.n.toLocaleString()) + row('Mean', fmt(c.mean)) + row('Std. deviation, within (short term)', c.sdWithin === null ? null : fmt(c.sdWithin)) + row('Std. deviation, overall (long term)', fmt(c.sdOverall)) +
          row('Cp', f2(c.Cp)) + row('Cpk', f2(c.Cpk)) + row('Pp', f2(c.Pp)) + row('Ppk', f2(c.Ppk)) + row('Cpm (Taguchi, vs target)', f2(c.Cpm)) + row('Z.bench', f2(c.zBench)) +
          row('Expected out of spec (PPM)', c.tailsUsable === false
            ? '<span class="flagged-note">withheld: these results are not bell-shaped</span>' : fmt(c.ppm, 0)) +
          row('Observed out of spec', c.observedOut + ' of ' + c.n + ' (' + pct(c.observedPct) + ')') +
          row('Sigma level (short term, +1.5 shift)', c.tailsUsable === false
            ? '<span class="flagged-note">withheld</span>' : f2(c.sigmaLevel)) +
          /* Withholding is right and is still a dead end on its own. Where a transform
             recovers the shape, the figures come back on that scale - and only when
             normality was re-tested on the transformed values and passed. */
          (nn && nn.usable ? row('PPM, on a ' + h(nn.label) + ' scale', '<b>' + fmt(nn.ppm, 0) + '</b>') +
            row('Sigma level, same scale', f2(nn.sigmaLevel)) : '') +
          row('Results are bell-shaped', c.normality === null || c.normality.p === null
            ? 'not tested (' + ((c.normality && c.normality.note) || 'too few results') + ')'
            : (c.normality.normal ? 'no evidence against it' : 'no &mdash; Anderson&ndash;Darling p ' + (c.normality.p < 0.001 ? '&lt; 0.001' : c.normality.p.toFixed(3)))) +
          row('Taguchi loss vs a unit at the spec limit', c.loss === null ? null : pct(c.loss)) + '</tbody></table></div>' + (c.sdWithin === null ? '<p class="hint">Rows are not in time order, so short-term Cp and Cpk are skipped; Pp and Ppk use the overall spread.</p>' : '') +
          (nn ? '<p class="hint">' + h(nn.why) + '</p>' : ''), 'capability') +
        card('Distribution against the spec', 'Red bars fall outside the spec. The curve is the bell shape the capability numbers assume.', histHtml, 'histogram'),
        'block-grid');
    } else {
      append(blocks, card('Distribution of ' + rep.target, 'No spec limits given. Add LSL and USL in step 2 to get Cp and Cpk.', histHtml, 'histogram'));
    }
    C.histogram(blocks.querySelector('.spc-hist'), (st.n ? state.prof.columns.find(col => col.name === rep.target).values.filter(x => x !== null) : []),
      { lsl: c ? c.lsl : null, usl: c ? c.usl : null, target: c ? c.target : null, mean: st.mean, sd: st.sdOverall, xLabel: rep.target, label: 'Histogram of ' + rep.target });

    if (s.imr) {
      const m = s.imr;
      const sig = m.signals.slice(0, 8).map(g => 'row ' + m.rowNums[g.i] + ' (' + g.why.join(', ') + ')');
      const el = append(blocks, card('I-MR control chart', 'Individuals (top) and moving range (bottom), in row order' + (m.trimmed ? ', last 500 rows' : '') + '. ' + (m.signals.length ? m.signals.length + ' signal' + (m.signals.length > 1 ? 's' : '') + ' in red.' : 'No signals: the process looks stable.'),
        '<div class="cc-i"></div><div class="cc-mr"></div>' + (sig.length ? '<p class="hint">Signals: ' + h(sig.join('; ')) + (m.signals.length > 8 ? '…' : '') + '</p>' : ''), 'controlChart'));
      const label = i => 'Row ' + m.rowNums[i];
      C.controlChart(el.querySelector('.cc-i'), m.y, { cl: m.cl, ucl: m.ucl, lcl: m.lcl, flags: m.flags, rowLabel: label, yLabel: rep.target, label: 'Individuals chart' });
      C.controlChart(el.querySelector('.cc-mr'), m.mr, { cl: m.mrBar, ucl: m.mrUcl, lcl: null, flags: m.mr.map((v, i) => (v !== null && v > m.mrUcl ? ['jump between points'] : [])), rowLabel: label, yLabel: 'Moving range', height: 170, label: 'Moving range chart' });
    }
    /* The chart counted data actually belongs on. Both limit sets are drawn - the textbook
       ones and the ones widened for clustering - because the difference between them is the
       interesting part, and a reader who only sees the widened chart cannot tell how much of
       the calm was the correction. */
    if (s.counts && s.counts.centre > 0) {
      const q = s.counts;
      const kindName = { c: 'c-chart (counts)', u: 'u-chart (per unit)', p: 'p-chart (proportion defective)' }[q.kind] || q.kind;
      const useWide = q.use !== q.kind;
      const lo = useWide ? q.laney.lower : q.lower, hi = useWide ? q.laney.upper : q.upper;
      const sigs = useWide ? q.laney.signals : q.signals;
      const el = append(blocks, card('Count chart \u2014 ' + kindName,
        'Your result is whole and never negative, so it is counted data and this is the chart for it. ' +
        (q.unitsColumn ? 'Limits move with "' + h(q.unitsColumn) + '", so the chart is drawn standardised: each point as its distance from the centre in its own standard deviations. ' : '') +
        (sigs.length ? sigs.length + ' signal' + (sigs.length > 1 ? 's' : '') + ' in red.' : 'No points outside the limits.'),
        '<div class="cc-count"></div>' +
        '<p class="hint">' + h(q.why) + '</p>' +
        (q.unitsNote ? '<p class="hint flagged-note">' + h(q.unitsNote) + '</p>' : '') +
        '<div class="table-scroll"><table class="spc-table"><tbody>' +
        row('Chart', kindName) + row('Centre line', fmt(q.centre)) +
        row('Dispersion measured', f2(q.dispersion) + (q.overdispersed ? ' \u2014 wider than the model allows' : ' \u2014 as the model expects')) +
        row('Limits widened by', '\u00d7' + f2(q.factor)) +
        row('Signals, textbook limits', q.signals.length) +
        row('Signals, widened limits', q.laney.signals.length) +
        row('Chart to read', useWide ? 'the widened one' : 'the textbook one') +
        '</tbody></table></div>', 'countChart'));
      const label = i => 'Row ' + (q.rowNums ? q.rowNums[i] : i + 1);
      const flags = q.plotted.map((v, i) => (v > hi[i] ? ['above the limit'] : v < lo[i] ? ['below the limit'] : []));
      /* A c-chart's limits are one pair of numbers and draw as two straight lines. A u or p
         chart's limits move with how many units each point covered, which the chart drawer
         cannot show as a single line - so those are plotted standardised instead: each point
         as its distance from the centre in its own standard deviations, against one pair of
         limits that then applies to every point. The axis label says which is being shown,
         because the two are not the same picture. */
      const flat = hi.every(v => Math.abs(v - hi[0]) < 1e-12) && lo.every(v => Math.abs(v - lo[0]) < 1e-12);
      if (flat) {
        C.controlChart(el.querySelector('.cc-count'), q.plotted, {
          cl: q.centre, ucl: hi[0], lcl: lo[0], flags, rowLabel: label,
          yLabel: q.kind === 'p' ? 'Proportion' : q.kind === 'u' ? 'Per unit' : rep.target, label: kindName
        });
      } else {
        const z = q.plotted.map((v, i) => (v - q.centre) / q.sigma[i]);
        const lim = 3 * (useWide ? q.factor : 1);
        C.controlChart(el.querySelector('.cc-count'), z, {
          cl: 0, ucl: lim, lcl: -lim, flags, rowLabel: label,
          yLabel: 'Standard deviations from the centre line', label: kindName + ', standardised'
        });
      }
    }
    /* Something that could not be computed is said, not left out. Each of these three has a
       catch in the agent that records why it failed, and for a long time nothing here read
       any of them: the card simply did not appear, so somebody who expected a CUSUM chart saw
       no chart and no reason, which is the worst of the three possible outcomes. The rule this
       tool runs on is that a blank reads as a pass, so a refusal has to be visible. */
    const notes = [
      ['driftError', 'The CUSUM and EWMA charts', 'They are the pair for a small sustained shift, so this is worth fixing rather than ignoring - usually it means the results are too few or too alike for a within-subgroup sigma.'],
      ['countsError', 'The count chart', 'The target looked like counted data - whole numbers, never negative - so a count chart was attempted beside the measurement chart. The individuals chart above still stands.'],
      ['rareError', 'The rare-event chart', 'Most rows recorded nothing, so the gaps between events would have carried more than the counts do.']
    ].filter(([key]) => s[key]);
    if (notes.length) {
      append(blocks, card(notes.length === 1 ? notes[0][1] + ' could not be computed' : 'Some charts could not be computed',
        'Said here rather than left out, because a missing card looks like a clean result.',
        notes.map(([key, what, why]) => '<p class="hint flagged-note"><b>' + h(what) + ':</b> ' + h(s[key]) + ' ' + h(why) + '</p>').join('')));
    }
    /* The drift charts, beside the I-MR one rather than instead of it. Both are drawn
       because they answer the same question differently and disagreeing is informative:
       CUSUM crossing while EWMA has not is a slow bias, the reverse is a recent step. */
    if (s.cusum && s.ewma) {
      const cu = s.cusum, ew = s.ewma;
      const first = cu.signals.length ? cu.signals[0] : null;
      const el = append(blocks, card('Drift charts \u2014 CUSUM and EWMA',
        'For a small sustained shift, which the chart above is weakest at. ' +
        (cu.signals.length || ew.signals.length
          ? 'CUSUM ' + (cu.signals.length ? cu.signals.length + ' signal' + (cu.signals.length > 1 ? 's' : '') : 'quiet') +
            ', EWMA ' + (ew.signals.length ? ew.signals.length + ' signal' + (ew.signals.length > 1 ? 's' : '') : 'quiet') + '.'
          : 'Neither signals: no sustained shift from target.'),
        '<div class="cc-cusum"></div><div class="cc-ewma"></div>' +
        (first && cu.shiftStarted !== null
          ? '<p class="hint"><b>The drift dates from row ' + (cu.rowNums ? cu.rowNums[cu.shiftStarted] : cu.shiftStarted + 1) +
            '</b> \u2014 the running sum last sat at zero there, and crossed at row ' + (cu.rowNums ? cu.rowNums[first.i] : first.i + 1) +
            '. A plain chart tells you something is wrong now; this says how long it has been wrong.</p>'
          : '') +
        '<p class="hint">' + h(cu.why) + '</p>' +
        '<p class="hint">' + h(ew.why) + '</p>', 'drift'));
      const label = i => 'Row ' + (cu.rowNums ? cu.rowNums[i] : i + 1);
      /* CUSUM is two one-sided sums, so the signed version is drawn: the upward sum as it
         stands and the downward one mirrored below zero, against one decision interval each
         way. Plotting both as positive on one axis reads as a process drifting up. */
      const signed = cu.hi.map((v, i) => (v > 0 ? v : -cu.lo[i]));
      C.controlChart(el.querySelector('.cc-cusum'), signed, {
        cl: 0, ucl: cu.h, lcl: -cu.h,
        flags: signed.map((v, i) => (cu.signals.some(x => x.i === i) ? ['crossed the decision interval'] : [])),
        rowLabel: label, xLabel: 'Row (time order)', yLabel: 'CUSUM, sigma units', label: 'CUSUM chart'
      });
      /* EWMA limits widen over the first points, and the chart drawer takes one pair of
         numbers, so the settled width is drawn and the early points are described rather
         than mis-drawn. Their own limits are in the table. */
      C.controlChart(el.querySelector('.cc-ewma'), ew.z, {
        cl: ew.mu0, ucl: ew.ucl[ew.n - 1], lcl: ew.lcl[ew.n - 1],
        flags: ew.z.map((v, i) => (ew.signals.some(x => x.i === i) ? ['outside its own limit at this point'] : [])),
        rowLabel: label, xLabel: 'Row (time order)', yLabel: 'EWMA of ' + rep.target, height: 200, label: 'EWMA chart'
      });
    }
    /* Rare events: the gaps, not the rate. Only drawn when the data is actually that shape,
       because on a busy process this chart answers a question nobody asked. */
    if (s.rare) {
      const q = s.rare;
      const lim = v => (v === null ? 'none at this rate' : fmt(v, q.kind === 'g' ? 0 : 2));
      const sig = q.signals.slice(0, 6).map(x => 'gap ' + (x.i + 1) + ' (' + x.meaning + ')');
      const el = append(blocks, card('Rare-event chart \u2014 ' + (q.kind === 'g' ? 'units between events' : 'time between events'),
        Math.round(q.zeroShare * 100) + '% of rows recorded nothing, so the rate is too low to chart directly. These are the ' +
        q.n + ' gaps between the ' + q.events + ' events instead. ' +
        (q.signals.length ? q.signals.length + ' signal' + (q.signals.length > 1 ? 's' : '') + '.' : 'No signals.'),
        '<div class="cc-rare"></div>' +
        '<p class="hint">' + h(q.why) + '</p>' +
        (sig.length ? '<p class="hint">Signals: ' + h(sig.join('; ')) + (q.signals.length > 6 ? '\u2026' : '') + '</p>' : '') +
        '<div class="table-scroll"><table class="spc-table"><tbody>' +
        row('Events', q.events) + row('Event rate', q.rateLabel) +
        row('Centre line (median gap)', fmt(q.centre, 0)) +
        row('Lower limit', lim(q.lcl)) + row('Upper limit', lim(q.ucl)) +
        row('Three sigma would have given', fmt(q.naive.lower, 0) + ' to ' + fmt(q.naive.upper, 0) + (q.naive.clamped ? ' (lower clamped to 0)' : '')) +
        row('Run rule', q.runLen + ' gaps the same side of the centre, risk ' + (q.runRisk * 100).toFixed(2) + '% a point') +
        '</tbody></table></div>', 'rareEvents'));
      const flags = q.gaps.map((v, i) => {
        const hits = q.signals.filter(x => x.i === i);
        return hits.length ? hits.map(x => x.meaning) : [];
      });
      C.controlChart(el.querySelector('.cc-rare'), q.gaps, {
        cl: q.centre, ucl: q.ucl, lcl: q.lcl === null ? 0 : q.lcl, flags,
        rowLabel: i => 'Gap ' + (i + 1),
        // The points are gaps, not rows, so the default axis caption would be wrong here.
        xLabel: 'Gap number (in order)',
        yLabel: q.kind === 'g' ? 'Units between events' : 'Time between events', label: 'Rare-event chart'
      });
    }
    if (s.boxes) {
      const el = append(blocks, card('Box plots of ' + rep.target, 'Overall' + (s.boxes.by.length ? ', and split by ' + h(s.boxes.by.map(b => b.name).join(', ')) : '') + '. Shifted boxes change the average; wider boxes mean more variation.',
        '<div class="bp-all"></div>' + s.boxes.by.map((b, i) => '<h4>By ' + h(b.name) + '</h4><div class="bp-' + i + '"></div>').join(''), 'boxplot'));
      const spec = { lsl: c ? c.lsl : null, usl: c ? c.usl : null };
      const ov = s.boxes.overall, ext = [ov.min, ov.max, spec.lsl, spec.usl].filter(v => v !== null), pad = (Math.max(...ext) - Math.min(...ext)) * 0.05 || 1;
      spec.domain = [Math.min(...ext) - pad, Math.max(...ext) + pad];
      C.boxplot(el.querySelector('.bp-all'), [{ label: 'All rows', stats: s.boxes.overall }], Object.assign({ label: 'Box plot, all rows' }, spec));
      s.boxes.by.forEach((b, i) => C.boxplot(el.querySelector('.bp-' + i), b.groups, Object.assign({ label: 'Box plots by ' + b.name, xLabel: rep.target }, spec)));
    }
    if (s.taguchi) {
      const t = s.taguchi, kind = { larger: 'larger is better', smaller: 'smaller is better', nominal: 'on target is best' }[t.type];
      const lv = v => (typeof v === 'number' ? fmt(v) : v);
      const el = append(blocks, card('Taguchi robustness (signal-to-noise)', 'S/N type: ' + kind + '. Higher S/N means more consistent results. Factors are ranked by how much S/N changes across their levels.',
        '<div class="table-scroll"><table><thead><tr><th>Rank</th><th>Factor</th><th class="num-cell">S/N range (dB)</th><th>Most robust level</th><th>S/N by level (mean)</th></tr></thead><tbody>' +
        t.factors.map(f => '<tr><td class="num-cell">' + f.rank + '</td><td>' + h(f.name) + '</td><td class="num-cell">' + f.delta.toFixed(2) + '</td><td><b>' + h(lv(f.best.level)) + '</b></td><td>' + h(f.levels.map(x => lv(x.level) + ': ' + x.sn.toFixed(1) + ' (' + fmt(x.mean) + ')').join(' · ')) + '</td></tr>').join('') +
        '</tbody></table></div><div class="me-grid tg-grid"></div>', 'taguchi'));
      const all = t.factors.reduce((a, f) => a.concat(f.levels.map(x => x.sn)), []), dom = [Math.min(...all), Math.max(...all)];
      t.factors.slice(0, 6).forEach(f => {
        const d = document.createElement('div'); el.querySelector('.tg-grid').appendChild(d);
        C.lines(d, [{ name: f.name, points: f.levels.map((x, i) => ({ x: i, y: x.sn, big: x === f.best, tip: f.name + ' = ' + lv(x.level) + '\nS/N ' + x.sn.toFixed(2) + ' dB, mean ' + fmt(x.mean) })) }],
          { yDomain: dom, xLabel: f.name, xTickFmt: i => String(lv(f.levels[i] ? f.levels[i].level : '')), width: 280, height: 180, label: 'S/N by level of ' + f.name });
      });
    }
  }

  /* What the runners-up say. One model's ranking is one model's opinion; several model
     families that work in completely different ways, landing on the same drivers, is a much
     stronger statement - and a disagreement is worth seeing before anyone acts on a chart. */
  function compareCard(rep, reg) {
    const cmp = (rep.compare || []).filter(c => c.importance && c.importance.length);
    if (cmp.length < 2) return '';
    const ag = rep.agreement || {};
    const names = ag.union && ag.union.length ? ag.union
      : Array.from(new Set(cmp.flatMap(c => c.importance.slice(0, 4).map(v => v.name))));
    const shareOf = (c, n) => { const v = c.importance.find(x => x.name === n); return v ? v.share : 0; };
    const verdict = ag.topDriver
      ? '<span class="verdict capable">they agree</span> All ' + cmp.length + ' put <b>' + h(ag.topDriver) + '</b> first. Different model families reaching the same answer is far better evidence than any one of them alone.'
      : (ag.shared && ag.shared.length)
        ? '<span class="verdict marginal">partly</span> They order them differently, but all ' + cmp.length + ' rate <b>' + ag.shared.map(h).join('</b> and <b>') + '</b> among the top drivers. Treat those as the solid ones and the rest as unsettled.'
        : '<span class="verdict not">they disagree</span> The leading models do not pick out the same inputs. That usually means the signal is weak, the inputs overlap heavily, or there is not enough data to separate them &mdash; so no single ranking here should be acted on yet.';

    const head = '<tr><th>Driver</th>' + cmp.map(c => '<th class="num-cell">' + h(c.name.replace(/\s*\(.*\)$/, '')) +
      (c.chosen ? '<span class="chip">chosen</span>' : '') + '</th>').join('') + '</tr>' +
      '<tr class="dim"><td>Score on unseen rows</td>' + cmp.map(c => '<td class="num-cell">' +
        (reg ? c.metrics.r2.toFixed(3) : pct(c.metrics.balancedAccuracy)) + '</td>').join('') + '</tr>';
    // Highlight the driver they actually agree on, not whichever happens to be listed first.
    const body = names.map(n => '<tr' + (ag.topDriver === n ? ' class="agreed"' : '') + '><td>' + h(n) + '</td>' + cmp.map(c => {
      const sh = shareOf(c, n);
      /* The bar is an SVG rect rather than a styled div: the page forbids inline styles, so
         a width has to arrive as an attribute. */
      const bar = '<svg class="share-bar" viewBox="0 0 100 5" preserveAspectRatio="none" aria-hidden="true"><rect x="0" y="0" height="5" width="' + Math.max(0, Math.min(100, sh * 100)).toFixed(1) + '"/></svg>';
      return '<td class="num-cell share-cell">' + (sh >= 0.005 ? pct(sh) : '–') + bar + '</td>';
    }).join('') + '</tr>').join('');

    return card('Do the models agree on what matters?',
      'Each model was refit on all the rows and asked independently which inputs it leans on. Agreement is the point: a driver that only one model likes is a lead, not a finding.',
      '<p class="sub-head">' + verdict + '</p>' +
      '<div class="table-scroll"><table class="compare-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="hint">Percentages are each model\'s own importance split, so they are comparable down a column, not across one. A model with a lower score still gets a say here: the question is what it leans on, not whether it won.</p>',
      'leaderboard');
  }

  function renderSupervised(rep, blocks) {
    const reg = rep.task === 'regression', key = rep.metricKey;
    const lb = rep.leaderboard.filter(m => m.metrics);
    append(blocks,
      card('Model leaderboard', (reg ? 'R²: share of variation explained' : 'Balanced accuracy') + ' on rows each model never saw. Yellow = chosen.', scoreRangeNote(rep, reg) + '<div id="lb-chart"></div>' +
        '<div class="models"><details><summary>Scores table</summary><div class="table-scroll"><table><thead><tr><th>Model</th>' +
        (reg ? '<th class="num-cell">R²</th><th class="num-cell">RMSE</th><th class="num-cell">MAE</th>' : '<th class="num-cell">Accuracy</th><th class="num-cell">Balanced</th><th class="num-cell">Macro F1</th>') +
        '</tr></thead><tbody>' + lb.map(m => '<tr' + (m === rep.best ? ' class="best"' : '') + '><td>' + h(m.name) + '</td>' +
          (reg ? '<td class="num-cell">' + m.metrics.r2.toFixed(3) + '</td><td class="num-cell">' + fmt(m.metrics.rmse) + '</td><td class="num-cell">' + fmt(m.metrics.mae) + '</td>'
            : '<td class="num-cell">' + pct(m.metrics.accuracy) + '</td><td class="num-cell">' + pct(m.metrics.balancedAccuracy) + '</td><td class="num-cell">' + m.metrics.macroF1.toFixed(2) + '</td>') + '</tr>').join('') +
        '</tbody></table></div></details><details><summary>What each model does, in plain words</summary><dl>' +
        lb.map(m => '<dt>' + h(m.name) + '</dt><dd>' + h(m.plain) + ' <i>' + h(X.MODEL_ANALOGY[m.id] || '') + '</i> ' + learnLink(X.MODEL_TOPIC[m.id], 'Visual lesson') + '</dd>').join('') + '</dl></details></div>', 'leaderboard') +
      compareCard(rep, reg) +
      card(reg ? 'Predicted vs actual' : 'Confusion matrix', reg ? 'Each dot is a row, predicted while hidden from the model. Dots on the dashed line are perfect.' : 'Rows on the diagonal were classified correctly. Hover a cell for details.', '<div id="fit-chart"></div>', reg ? 'fitScatter' : 'confusion'),
      'block-grid');
    C.hbar($('lb-chart'), lb.map(m => ({
      label: m.name, value: Math.max(0, m.metrics[key]), cls: m === rep.best ? 'accent hi' : '',
      text: reg ? m.metrics.r2.toFixed(2) : pct(m.metrics[key]),
      tip: m.name + '\n' + (reg ? 'R² ' + m.metrics.r2.toFixed(3) + ' · RMSE ' + fmt(m.metrics.rmse) : 'Accuracy ' + pct(m.metrics.accuracy) + ' · balanced ' + pct(m.metrics.balancedAccuracy)) + '\nScored in ' + m.ms + ' ms'
    })), { min: 0, max: 1, tickFmt: t => pct(t), label: 'Model scores' });
    if (reg) {
      C.scatter($('fit-chart'), rep.actual.map((y, i) => ({ x: y, y: rep.best.oof[i], tip: 'Actual ' + fmt(y) + '\nPredicted ' + fmt(rep.best.oof[i]) })),
        { diagonal: true, xLabel: 'Actual ' + rep.target, yLabel: 'Predicted', label: 'Predicted versus actual' });
    } else C.confusion($('fit-chart'), rep.best.metrics.confusion, rep.classes);

    const imp = (rep.importance || []).slice(0, 12);
    /* A ranking with no sense of its own noise invites a reader to act on an order that a
       second roll of the dice would reverse. Each importance is a mean over repeated
       shuffles, so the spread across them is available and is reported. */
    let impNote = '';
    const rk = rep.rank;
    if (rk) {
      if (rk.topClear) {
        impNote += '<p class="hint"><b>' + h(rk.top) + ' is genuinely ahead of ' + h(rk.second) +
          '</b> &mdash; the gap between them is larger than the noise in both, so the top of this order can be read as an order.</p>';
      } else if (rk.tiedWithTop.length) {
        impNote += '<p class="hint"><b>' + h(rk.top) + ' cannot be separated from ' + h(rk.tiedWithTop.join(', ')) +
          '.</b> Treat them as joint leaders rather than a ranking: the order between them is within the noise, and a second run could reverse it.</p>';
      }
      /* The negative control, and the only honest way to say a bar means nothing. A short
         bar is not evidence of no influence - it is an absence of evidence - and the
         reference it has to clear is not zero but what this model scores on a shuffled
         target. On the bench it is the blank well: if the blank reads as high as the
         sample, the sample has told you nothing. */
      if (rk.topAboveFloor === false) {
        impNote += '<p class="hint"><b>No input here beats the blank.</b> Shuffle the ' + h(rep.target) +
          ' column so there is nothing left to find, refit, and the same model still hands out importances up to ' +
          pct(rep.importanceFloorShare) + '. Every bar above is at or below that, so this chart should not be read as a ranking at all.</p>';
      } else if (rk.belowFloor.length) {
        impNote += '<p class="hint">At or below the blank: <b>' + h(rk.belowFloor.join(', ')) +
          '</b>. With ' + h(rep.target) + ' shuffled into nonsense this model still scores up to ' + pct(rep.importanceFloorShare) +
          ', so those bars carry no evidence. That is not the same as no influence &mdash; it means this data cannot see one.</p>';
      }
      impNote += '<p class="hint">The whiskers cover ' + h(rk.seCovers) + '. They do <b>not</b> cover ' + h(rk.seOmits) +
          ' &mdash; measured on this tool, that second source runs 1.5 to 5.7 times larger. Nor does a whisker clear of zero mean a driver is real: ' +
          'importance is read off the rows the model was fitted on, so a model leans on any column it is given. Three columns of pure random numbers measured 0.005 to 0.007 against ' +
          'standard errors near 0.002 &mdash; "significant" by their own spread and worthless. That is what the blank above is for.</p>';
    }
    append(blocks, card('What drives ' + rep.target, 'How much the best model\'s score drops when each column is scrambled. Bigger = more important.', imp.length ? '<div id="imp-chart"></div>' + impNote : '<p>No drivers to show.</p>', 'drivers'));
    if (imp.length) C.hbar($('imp-chart'), imp.map((v, i) => ({
      label: v.name, value: v.share, text: pct(v.share), cls: i < 3 ? 'hi' : '',
      // 95% on the permutation noise alone, which is what the note beneath the chart says.
      err: isFinite(v.shareSE) ? 1.959964 * v.shareSE : 0,
      tip: v.name + '\n' + pct(v.share) + ' of what the model relies on' +
        (isFinite(v.shareSE) && v.shareSE > 0 ? '\nShuffling noise: \u00b1' + pct(1.959964 * v.shareSE) + ' (95%, over ' + (v.reps || 0) + ' shuffles)' : '')
    })), { min: 0, tickFmt: t => pct(t), label: 'Driver importance' });
    renderNN(rep, blocks);
    renderPD(rep, blocks);
    renderPeek(rep, blocks);
  }

  // Loss curve: error on the rows the network learns from, and on the rows held back to check it.
  function lossChart(el, nn, height) {
    const hist = nn.history; if (!hist.length) return;
    const hasVal = hist[0].val !== null;
    const series = [{ name: 'Learning rows', points: hist.map(e => ({ x: e.epoch, y: e.train })) }];
    if (hasVal) series.push({ name: 'Check rows', cls: 's2', points: hist.map(e => ({ x: e.epoch, y: e.val, big: e.epoch === nn.bestEpoch, tip: 'Best check score, epoch ' + e.epoch })) });
    else series[0].points.forEach(pt => { pt.big = pt.x === nn.bestEpoch; });
    const last = hist[hist.length - 1].epoch, ticks = C.niceTicks(1, Math.max(2, last), 5).filter(t => t >= 1 && t <= last);
    C.lines(el, series, { noDots: true, xTicks: ticks, xLabel: 'Epoch (one pass over the learning rows)', yLabel: 'Error', height: height || 240, label: 'Neural network learning curve' });
    el.insertAdjacentHTML('beforeend', C.legend([{ label: 'Error on rows it learns from', cls: 'pt' }].concat(hasVal ? [{ label: 'Error on held-back check rows', cls: 'pt s2' }] : [])));
  }
  // A sketch of the network: up to 8 units drawn per layer, connections faint.
  function networkSketch(sizes, inputs) {
    const W = 520, H = 190, cols = sizes.length, show = s => Math.min(s, 8);
    const x = c => 40 + c * (W - 80) / (cols - 1), y = (c, i) => { const n = show(sizes[c]); return H / 2 + (i - (n - 1) / 2) * 20; };
    let b = '';
    for (let c = 0; c < cols - 1; c++) for (let i = 0; i < show(sizes[c]); i++) for (let j = 0; j < show(sizes[c + 1]); j++) b += '<line class="nn-edge" x1="' + x(c) + '" y1="' + y(c, i) + '" x2="' + x(c + 1) + '" y2="' + y(c + 1, j) + '"/>';
    const names = ['Inputs', 'Hidden layer 1', 'Hidden layer 2', 'Output'];
    sizes.forEach((s, c) => {
      for (let i = 0; i < show(s); i++) b += '<circle class="nn-node' + (c === 0 ? ' in' : c === cols - 1 ? ' out' : '') + '" cx="' + x(c) + '" cy="' + y(c, i) + '" r="6.5"/>';
      b += '<text class="lbl-strong" x="' + x(c) + '" y="14" text-anchor="middle">' + names[c] + '</text><text x="' + x(c) + '" y="' + (H - 4) + '" text-anchor="middle">' + s + (s > 8 ? ' (8 shown)' : '') + '</text>';
    });
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Network diagram: ' + sizes.join(' to ') + ' units">' + b + '</svg>';
  }
  function renderNN(rep, blocks) {
    const nn = rep.nn; if (!nn) return;
    const key = rep.metricKey, bestScore = rep.best.metrics[key];
    const scoreTxt = v => (rep.task === 'regression' ? 'R² ' + v.toFixed(2) : pct(v));
    const why = nn.chosen ? 'It is the chosen model.' : bestScore - nn.score <= 0.01 + 1e-9 ? 'A simpler model scored within 0.01, so the agent kept the easier-to-explain one.' : 'Other models scored higher on this data, which is common for small tables.';
    const outN = nn.sizes[nn.sizes.length - 1];
    const bestVal = nn.history[nn.bestEpoch - 1] && nn.history[nn.bestEpoch - 1].val, lastVal = nn.history[nn.history.length - 1].val;
    const overfit = bestVal !== null && bestVal !== undefined && lastVal > bestVal * 1.05 ? ' After that, the check error rises while the learning error keeps falling: that is overfitting, so the network keeps its epoch-' + nn.bestEpoch + ' version.' : '';
    const el = append(blocks, card('Neural network: how it learned', nn.sizes[0] + ' inputs → ' + nn.sizes[1] + ' → ' + nn.sizes[2] + ' units → ' + (outN === 1 ? '1 output (the number)' : outN + ' outputs (one per class)') + '. Cross-validated ' + scoreTxt(nn.score) + ', rank ' + nn.rank + ' on the leaderboard. ' + why +
      ' Training stopped after ' + nn.history.length + ' epochs; the best check score came at epoch ' + nn.bestEpoch + '.' + overfit,
      '<div class="block-grid nn-grid"><div class="nn-curve"></div><div>' + networkSketch(nn.sizes) + '<p class="hint">Inputs are your columns after scaling (each category becomes a yes/no input). Each unit adds up its weighted inputs and passes the signal on only if it is positive (ReLU).</p></div></div>', 'nn'));
    lossChart(el.querySelector('.nn-curve'), nn);
  }

  function renderPD(rep, blocks) {
    if (!rep.pd || !rep.pd.length) return;
    const cls = rep.task === 'classification';
    const what = cls ? 'chance of ' + A.classLabel(rep) + (rep.fromClass !== null && rep.fromClass !== undefined ? ' for rows now ' + rep.classes[rep.fromClass] : '') : rep.target;
    const c = append(blocks, card('How each driver moves ' + rep.target, 'Model-expected ' + h(what) + ' as one driver changes, with everything else as it was. Same scale on every panel; the large dot is your typical value.', '<div class="me-grid pd-grid"></div>', 'pd'));
    const grid = c.querySelector('.pd-grid');
    const all = rep.pd.reduce((s, p) => s.concat(p.ys), []);
    const dom = [Math.min(...all), Math.max(...all)];
    const yf = v => (cls ? pct(v) : fmt(v));
    for (const p of rep.pd) {
      const div = document.createElement('div'); grid.appendChild(div);
      if (p.kind === 'numeric') {
        const near = Math.min(...p.grid.map(q => Math.abs(q - p.typical)));
        C.lines(div, [{ name: p.name, points: p.grid.map((g, i) => {
          const typ = Math.abs(g - p.typical) === near;
          return { x: g, y: p.ys[i], big: typ, tip: p.name + ' = ' + fmt(g) + '\nExpected ' + what + ': ' + yf(p.ys[i]) + (typ ? '\n(near your typical value)' : '') };
        }) }], { yDomain: dom, xLabel: p.name, xTicks: [p.grid[0], p.grid[6], p.grid[12]], xTickFmt: v => fmt(Number(v.toPrecision(3))), width: 280, height: 190, label: 'Effect of ' + p.name });
      } else {
        C.hbar(div, p.grid.map((g, i) => ({ label: g, value: p.ys[i], text: yf(p.ys[i]) })), { width: 280, min: cls ? 0 : Math.min(...p.ys) - (Math.max(...p.ys) - Math.min(...p.ys)) * 0.3, label: 'Effect of ' + p.name, tickFmt: yf });
        const t = document.createElement('p'); t.className = 'pd-cap'; t.textContent = p.name; div.appendChild(t);
      }
    }
  }

  function renderPeek(rep, blocks) {
    const ex = rep.explain;
    if (!ex) return;
    const cls = rep.task === 'classification';
    const leaf = node => {
      if (!cls) return [rep.target + ' ≈ ' + fmt(node.value), node.n + ' rows'];
      const k = node.value.indexOf(Math.max(...node.value));
      return [rep.classes[k] + ' ' + pct(node.value[k]), node.n + ' rows'];
    };
    // Regression leaves: best third green, worst third red (by the chosen goal).
    const leafVals = [];
    (function walk(n) { if (n.leaf) leafVals.push(n.value); else { walk(n.left); walk(n.right); } })(ex.tree);
    const lo = Math.min(...leafVals), hi = Math.max(...leafVals), up = rep.goal !== 'min';
    const leafClass = node => {
      if (cls) return (rep.favorableSet || [rep.favorable]).includes(node.value.indexOf(Math.max(...node.value))) ? 'good' : 'bad';
      const r = hi > lo ? (node.value - lo) / (hi - lo) : 0.5, score = up ? r : 1 - r;
      return score >= 0.67 ? 'good' : score <= 0.33 ? 'bad' : '';
    };
    const scoreText = cls ? 'gets ' + pct(ex.score) + ' of rows right' : 'explains ' + pct(Math.max(0, ex.score)) + ' of the variation';
    let html = '<p class="sub-head">A simplified 3-question tree trained on your data. It ' + scoreText + ' (on the rows it learned from), versus ' +
      (cls ? pct(rep.best.metrics.accuracy) : pct(Math.max(0, rep.best.metrics.r2))) + ' for the chosen ' + h(rep.best.name) + ' on unseen rows.</p><div class="table-scroll peek-tree"></div>' + howTo('tree');
    const ensemble = ex.trees && (rep.best.id === 'forest' || rep.best.id === 'boosting');
    if (ensemble) html += '<h3 class="peek-sub">Inside your ' + (rep.best.id === 'forest' ? 'random forest' : 'gradient boosting chain') + '</h3><div class="trees-row"></div>' + howTo(rep.best.id === 'forest' ? 'forest' : 'boosting');
    if (ex.recipe) html += '<h3 class="peek-sub">The recipe your ' + h(rep.best.name.toLowerCase()) + ' learned</h3><div class="recipe"></div>' + howTo('recipe');
    const c = append(blocks, '<div class="card"><h3>Peek inside the model</h3>' + html + '</div>');
    C.treeDiagram(c.querySelector('.peek-tree'), ex.tree, { question: ex.question, leaf, leafClass, label: 'Simplified decision tree' });
    if (ensemble) {
      const row = c.querySelector('.trees-row');
      const boostLeaf = node => {
        const v = node.value * 0.1;
        if (cls) return [v >= 0 ? 'nudge toward ' + rep.classes[1] : 'nudge toward ' + rep.classes[0], node.n + ' rows'];
        return [(v >= 0 ? '+' : '−') + fmt(Math.abs(v)) + ' correction', node.n + ' rows'];
      };
      ex.trees.forEach((t, i) => {
        const d = document.createElement('div');
        d.innerHTML = '<h4>' + (rep.best.id === 'forest' ? 'Tree ' + (i + 1) + ' of many' : i === 0 ? 'Tree 1: first correction' : 'Tree ' + (i + 1) + ': fixes what is left') + '</h4><div class="table-scroll"></div>';
        row.appendChild(d);
        C.treeDiagram(d.querySelector('div'), t, { question: ex.question, leaf: rep.best.id === 'forest' ? leaf : boostLeaf, leafClass: rep.best.id === 'forest' ? leafClass : null, maxDepth: 2, colW: 118, label: 'Tree ' + (i + 1) });
      });
    }
    if (ex.recipe) {
      C.hbar(c.querySelector('.recipe'), ex.recipe.slice(0, 10).map(x => ({
        label: x.label, value: x.effectRange,
        text: (x.perUnit >= 0 ? '+' : '−') + fmt(Math.abs(x.perUnit)) + (x.encoded ? ' per step' : x.numeric ? ' per unit' : ' vs ' + x.ref),
        tip: x.encoded ? x.label + ': one standard step of this changes ' + rep.target + ' by ' + fmt(x.perUnit)
          : x.numeric ? 'Each +1 in ' + x.label + ' changes ' + rep.target + ' by ' + fmt(x.perUnit) + '\nAcross its usual range: ' + fmt(x.effectRange) : x.label + ' changes ' + rep.target + ' by ' + fmt(x.perUnit) + ' compared with ' + x.ref
      })), { label: 'Recipe coefficients' });
    }
  }

  // ---------- Multi-result best compromise ----------
  const goalText = sp => (sp.goal === 'max' ? 'Maximize (≥ ' + fmt(sp.high) + ' is ideal, ≤ ' + fmt(sp.low) + ' fails)' : sp.goal === 'min' ? 'Minimize (≤ ' + fmt(sp.low) + ' is ideal, ≥ ' + fmt(sp.high) + ' fails)' : 'Hit ' + fmt(sp.target) + ' (fails outside ' + fmt(sp.low) + ' to ' + fmt(sp.high) + ')');
  // A 0 to 1 bar drawn as SVG (the page's security policy blocks inline styles).
  const dBar = d => '<span class="dval"><svg class="dbar" viewBox="0 0 60 8" aria-hidden="true"><rect class="track" width="60" height="8" rx="4"/><rect class="fill" width="' + (60 * d).toFixed(1) + '" height="8" rx="4"/></svg> ' + d.toFixed(2) + '</span>';
  function renderDesirability(rep, blocks) {
    const d = rep.desirability, b = d.best, t = d.typical;
    const rows = d.specs.map((sp, j) => '<tr><td><b>' + h(sp.name) + '</b><div class="hint">' + h(goalText(sp)) + (sp.weight !== 1 ? ' · weight ' + sp.weight : '') + '</div></td><td class="num-cell">' + h(fmt(t.ys[j])) + '</td><td>' + dBar(t.ds[j]) + '</td><td class="num-cell"><b>' + h(fmt(b.ys[j])) + '</b></td><td>' + dBar(b.ds[j]) + '</td><td>' + h(d.models[j].model) + ' · R² ' + Math.max(0, d.models[j].r2).toFixed(2) + '</td></tr>').join('');
    const changes = d.vars.filter(v => b.values[v.name] !== t.values[v.name]).map(v => '<tr><td>' + h(v.name) + '</td><td class="num-cell">' + h(v.kind === 'num' ? fmt(t.values[v.name]) : t.values[v.name]) + '</td><td class="num-cell"><b>' + h(v.kind === 'num' ? fmt(b.values[v.name]) : b.values[v.name]) + '</b></td><td class="hint">' + (v.kind === 'num' ? 'searched ' + h(fmt(v.lo)) + ' to ' + h(fmt(v.hi)) : 'levels seen in your data') + '</td></tr>').join('');
    const inner = '<div class="tiles mini"><div class="tile"><div class="lbl">Typical settings</div><div class="val">D ' + t.D.toFixed(2) + '</div></div><div class="tile hero-tile"><div class="lbl">Best compromise</div><div class="val">D ' + b.D.toFixed(2) + '</div><div class="sub">0 = some result fails, 1 = all fully met</div></div></div>' +
      '<div class="table-scroll"><table><thead><tr><th>Result and goal</th><th class="num-cell">Typical</th><th>d</th><th class="num-cell">Compromise</th><th>d</th><th>Model</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (changes ? '<h4>Settings that change</h4><div class="table-scroll"><table><thead><tr><th>Input</th><th class="num-cell">Typical</th><th class="num-cell">Compromise</th><th>Search range</th></tr></thead><tbody>' + changes + '</tbody></table></div>' : '<p>Typical settings already give the best balance found.</p>') +
      '<div class="row-actions"><button class="btn primary" type="button" id="des-apply">Load the compromise into the what-if desk</button></div>';
    const el = append(blocks, card('Best compromise across ' + d.specs.length + ' results', 'Like tuning a car for speed, fuel and comfort at once: pushing one result to its limit usually hurts another, so each result gets a 0 to 1 score (d) and the overall score D is their geometric mean, which drops to 0 if any single result fails.', inner, 'desirability'));
    el.querySelector('#des-apply').onclick = () => { applyCompromise(); $('sim').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  }
  function applyCompromise() {
    const sim = state.sim, rep = state.report; if (!sim || !rep || !rep.desirability) return;
    const best = rep.desirability.best.values;
    sim.base = Object.assign({}, best);
    sim.drivers.forEach(d => { if (best[d.name] !== undefined) sim.values[d.name] = best[d.name]; });
    syncKnobs(); scheduleSim();
  }

  // ---------- What-if mixing desk ----------
  // One knob per top driver. Each move re-scores the current settings plus a short sweep
  // along every knob (the curve under it), in a single batch, so it feels instant.
  function simDrivers(rep) {
    const imp = rep.importance && rep.importance.length ? rep.importance.filter(v => v.share >= 0.02).map(v => v.name) : rep.features;
    return imp.slice(0, 8).map(n => state.prof.columns.find(c => c.name === n)).filter(Boolean).map(c => {
      if (c.kind === 'numeric') {
        const sorted = c.values.filter(v => v !== null).sort((a, b) => a - b);
        const span = c.stats.max - c.stats.min || 1, step = Number((span / 200).toPrecision(2));
        return { name: c.name, kind: 'numeric', min: c.stats.min, max: c.stats.max, lo: E.quantile(sorted, 0.05), hi: E.quantile(sorted, 0.95), typical: c.stats.median, step,
          grid: E.range(15).map(i => c.stats.min + span * i / 14) };
      }
      return { name: c.name, kind: 'categorical', levels: c.levels.slice(0, 12), typical: c.levels[0], grid: c.levels.slice(0, 12) };
    });
  }
  const simScore = (rep, out) => (out.proba ? (rep.favorableSet || [rep.favorable]).reduce((a, k) => a + out.proba[k], 0) : out.value);
  const simFmt = (rep, v) => (rep.task === 'classification' ? pct(v) : fmt(v));

  function knobHtml(d, i, v) {
    const head = '<div class="knob-head"><label for="knob-' + i + '">' + h(d.name) + '</label><output id="knob-out-' + i + '">' + h(d.kind === 'numeric' ? fmt(v) : v) + '</output></div>';
    let ctl;
    if (d.kind === 'numeric') {
      ctl = '<input type="range" id="knob-' + i + '" data-knob="' + i + '" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + v + '">' +
        '<div class="knob-scale"><span>' + fmt(d.min) + '</span><span>typical ' + fmt(d.typical) + '</span><span>' + fmt(d.max) + '</span></div>';
    } else if (d.levels.length <= 5) {
      ctl = '<div class="seg" role="group" aria-label="' + h(d.name) + '">' + d.levels.map(l => '<button type="button" data-knob="' + i + '" data-level="' + h(l) + '" aria-pressed="' + (l === v) + '">' + h(l) + '</button>').join('') + '</div>';
    } else {
      ctl = '<select id="knob-' + i + '" data-knob="' + i + '">' + d.levels.map(l => '<option' + (l === v ? ' selected' : '') + '>' + h(l) + '</option>').join('') + '</select>';
    }
    return '<div class="knob">' + head + ctl + '<div class="knob-curve" id="knob-curve-' + i + '" aria-hidden="true"></div></div>';
  }

  /* A score is an estimate of a score. Quoting R2 to three decimals off forty rows reads
     as precision the arithmetic cannot support, and the range below is usually the single
     most decision-relevant number on the page: it is what says whether a model is worth
     acting on. Computed by resampling the out-of-fold predictions, so nothing is refitted. */
  function scoreRangeNote(rep, reg) {
    const su = rep.scoreUncertainty;
    if (!su) return '';
    const label = reg ? 'R²' : 'balanced accuracy';
    const width = su.hi - su.lo;
    const cls = width > 0.25 ? 'not' : width > 0.12 ? 'marginal' : 'capable';
    let txt = '<p class="hint"><span class="verdict ' + cls + '">' + label + ' ' + su.metric.toFixed(3) +
      ', and the data cannot separate that from anything between ' + su.lo.toFixed(3) + ' and ' + su.hi.toFixed(3) +
      '</span> (95%, from resampling the held-out predictions of these ' + su.n + ' rows).</p>';
    if (width > 0.25) {
      txt += '<p class="hint">That range is wide enough that the leaderboard order is largely noise. ' +
        'Comparing models on these rows will not reliably tell you which is better &mdash; more rows will.</p>';
    }
    if (su.rowsPerFeature !== null && su.rowsPerFeature < 10) {
      txt += '<p class="hint"><b>' + su.rowsPerFeature.toFixed(1) + ' rows per input.</b> Below about 10 a model has enough freedom to ' +
        'fit the rows it was given rather than the process behind them, and every number here inherits that. ' +
        'Cutting inputs is usually a faster fix than collecting rows.</p>';
    }
    return txt;
  }

  function renderSimulator(rep) {
    const el = $('sim');
    const drivers = rep.predictMany && rep.task !== 'clustering' ? simDrivers(rep) : [];
    if (!drivers.length) { el.hidden = true; el.innerHTML = ''; return; }
    let sim = state.sim;
    if (!sim || sim.rep !== rep) sim = state.sim = { rep, values: {}, pinned: [], shown: null };
    sim.drivers = drivers;
    // Columns without a knob: their typical values, or the best compromise once it is loaded.
    sim.typicalBase = rep.desirability ? Object.assign({}, rep.desirability.typical.values) : {};
    // Same starting point as the best-compromise card, so the two always agree.
    drivers.forEach(d => { if (sim.typicalBase[d.name] !== undefined) d.typical = sim.typicalBase[d.name]; });
    drivers.forEach(d => { if (sim.values[d.name] === undefined) sim.values[d.name] = d.typical; });
    sim.typical = {}; drivers.forEach(d => { sim.typical[d.name] = d.typical; });
    if (!sim.base) sim.base = Object.assign({}, sim.typicalBase);
    const cls = rep.task === 'classification';
    const what = cls ? 'Chance of ' + rep.target + ' = ' + A.classLabel(rep) : 'Predicted ' + rep.target;
    const plan = rep.actionPlan && rep.actionPlan.settings && rep.actionPlan.settings.length;
    el.hidden = false;
    el.innerHTML = '<h3>What-if mixing desk</h3><p class="sub-head">Move a knob and the prediction updates instantly. The curve under each knob shows how ' + h(rep.target) + ' responds to it, given where the other knobs sit right now (same scale on every curve, so a flat curve is a knob that barely matters). Columns without a knob stay at their typical value.</p>' +
      '<div class="sim-layout"><div class="sim-readout" aria-live="polite"><div class="lbl">' + h(what) + '</div><div class="sim-big" id="sim-big">–</div><div class="sim-delta" id="sim-delta"></div><div id="sim-extra"></div></div>' +
      '<div class="sim-knobs">' + drivers.map((d, i) => knobHtml(d, i, sim.values[d.name])).join('') + '</div></div>' +
      '<p class="sim-warn" id="sim-warn" hidden></p>' +
      '<div class="row-actions sim-actions">' + (rep.desirability ? '<button class="btn" type="button" id="sim-des">Apply the best compromise</button>' : '') + (plan ? '<button class="btn" type="button" id="sim-plan">Apply the action plan</button>' : '') +
      '<button class="btn ghost" type="button" id="sim-reset">Reset to typical</button><button class="btn primary" type="button" id="sim-pin">Pin this scenario</button></div>' +
      '<div id="sim-pins"></div>' + howTo('whatif');
    const setKnob = (i, raw) => {
      const d = drivers[i];
      sim.values[d.name] = d.kind === 'numeric' ? Number(raw) : raw;
      scheduleSim();
    };
    el.oninput = e => { const i = e.target.getAttribute('data-knob'); if (i !== null && e.target.tagName !== 'BUTTON') setKnob(Number(i), e.target.value); };
    el.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-level')) { setKnob(Number(b.getAttribute('data-knob')), b.getAttribute('data-level')); syncKnobs(); return; }
      if (b.id === 'sim-reset') { Object.assign(sim.values, sim.typical); sim.base = Object.assign({}, sim.typicalBase); syncKnobs(); scheduleSim(); }
      if (b.id === 'sim-des') applyCompromise();
      if (b.id === 'sim-plan') {
        rep.actionPlan.settings.forEach(st => { const d = drivers.find(x => x.name === st.name); if (d) sim.values[d.name] = d.kind === 'numeric' ? Math.min(d.max, Math.max(d.min, Number(String(st.value).replace(/,/g, '')))) : st.value; });
        syncKnobs(); scheduleSim();
      }
      if (b.id === 'sim-pin') { sim.pinned.push({ values: Object.assign({}, sim.values), base: Object.assign({}, sim.base) }); renderPins(); }
      if (b.hasAttribute('data-unpin')) { sim.pinned.splice(Number(b.getAttribute('data-unpin')), 1); renderPins(); }
    };
    sim.shown = null;
    updateSim();
    renderPins();
  }
  function syncKnobs() {
    const sim = state.sim;
    sim.drivers.forEach((d, i) => {
      const v = sim.values[d.name];
      if (d.kind === 'numeric' || d.levels.length > 5) $('knob-' + i).value = v;
      else document.querySelectorAll('[data-knob="' + i + '"][data-level]').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-level') === v)));
    });
  }
  let simFrame = 0;
  function scheduleSim() { if (!simFrame) simFrame = requestAnimationFrame(() => { simFrame = 0; updateSim(); }); }

  function updateSim() {
    const sim = state.sim; if (!sim || !state.report) return;
    const rep = sim.rep, ds = sim.drivers, cur = sim.values;
    // One batch: typical settings, current settings, then a sweep along each knob.
    const batch = [Object.assign({}, sim.typicalBase, sim.typical), Object.assign({}, sim.base, cur)];
    ds.forEach(d => d.grid.forEach(g => batch.push(Object.assign({}, sim.base, cur, { [d.name]: g }))));
    const outs = rep.predictMany(batch), sc = outs.map(o => simScore(rep, o));
    const base = sc[0], now = sc[1], nowOut = outs[1];
    let k = 2;
    const curves = ds.map(d => { const ys = sc.slice(k, k + d.grid.length); k += d.grid.length; return ys; });
    const all = curves.flat().concat([now]), lo = Math.min(...all), hi = Math.max(...all);
    ds.forEach((d, i) => {
      $('knob-out-' + i).textContent = d.kind === 'numeric' ? fmt(cur[d.name]) : cur[d.name];
      $('knob-curve-' + i).innerHTML = knobCurve(rep, d, curves[i], cur[d.name], now, lo, hi);
    });
    animateNumber($('sim-big'), sim.shown === null ? now : sim.shown, now, v => simFmt(rep, v));
    sim.shown = now;
    const diff = now - base, cls = rep.task === 'classification';
    const better = cls || rep.goal !== 'min' ? diff > 0 : diff < 0;
    const tiny = cls ? Math.abs(diff) < 0.005 : Math.abs(diff) < 1e-9 + 0.01 * (rep.targetSD || 1);
    $('sim-delta').className = 'sim-delta ' + (tiny ? '' : better ? 'up' : 'down');
    $('sim-delta').textContent = tiny ? 'Same as typical settings' : (diff > 0 ? '▲ +' : '▼ −') + (cls ? Math.abs(Math.round(diff * 100)) + ' points' : fmt(Math.abs(diff))) + ' vs typical settings (' + simFmt(rep, base) + ')';
    let extra = '';
    if (cls) {
      extra = '<div class="proba">' + A.classOrder(rep.classes).map(c => '<div' + ((rep.favorableSet || [rep.favorable]).includes(c) ? ' class="tgt"' : '') + '><span>' + h(rep.classes[c]) + '</span><progress max="1" value="' + nowOut.proba[c] + '"></progress><span>' + pct(nowOut.proba[c]) + '</span></div>').join('') + '</div><p class="hint">Most likely: <b>' + h(nowOut.label) + '</b></p>';
    } else {
      /* This used to read "typical error +/- RMSE", which is the most confident thing the
         page could have said and the least defensible. RMSE is one number for the whole
         dataset: it cannot widen when the desk is wound out past the data, so it was at its
         most reassuring exactly where it was least justified. Measured on this tool, a
         fixed 1.96-sigma band covered 93.2% of rows inside the data and 35.0% outside it.
         The conformal band is calibrated on rows held back from a second fit and widens
         with distance from the data: 95.1% and 100% at the same nominal 95%. */
      if (nowOut && isFinite(nowOut.low) && isFinite(nowOut.high)) {
        const pcConf = Math.round((nowOut.confidence || 0.9) * 100);
        const far = nowOut.distance > 2 ? 'not' : nowOut.distance > 1.2 ? 'marginal' : 'capable';
        extra = '<p class="hint"><b>' + simFmt(rep, nowOut.low) + ' to ' + simFmt(rep, nowOut.high) + '</b> &middot; ' +
          pcConf + '% of runs at these settings should land in that range' +
          (nowOut.supported === false ? ' (a floor, not a guarantee: the calibration slice cannot resolve this tail)' : '') + '.</p>' +
          (far !== 'capable'
            ? '<span class="verdict ' + far + '">' + (far === 'not' ? 'outside the data' : 'edge of the data') + '</span>' +
              '<p class="hint">These settings sit ' + (far === 'not' ? 'well ' : '') + 'away from the rows the model learned from, so the band has widened to match. That widening is calibrated, but a wide band on an extrapolation is still an extrapolation.</p>'
            : '');
      } else {
        extra = '<p class="hint">Typical error &plusmn;' + fmt(rep.best.metrics.rmse) +
          '. <i>No calibrated interval here: that needs at least 24 rows, so this is the dataset-wide error and it does not widen away from the data.</i></p>';
      }
      const c = rep.spc && rep.spc.capability;
      if (c) {
        const out = c.lsl !== null && now < c.lsl ? 'below LSL ' + fmt(c.lsl) : c.usl !== null && now > c.usl ? 'above USL ' + fmt(c.usl) : null;
        extra += '<span class="verdict ' + (out ? 'not' : 'capable') + '">' + (out ? h(out) : 'inside spec') + '</span>';
      }
    }
    if (rep.desirability) {
      const des = rep.desirability, ev = des.evaluate(Object.assign({}, sim.base, cur));
      extra += '<div class="sim-multi"><div class="lbl">All results · overall D <b>' + ev.D.toFixed(2) + '</b> (best found ' + des.best.D.toFixed(2) + ')</div>' +
        des.specs.map((sp, j) => '<div><span>' + h(sp.name) + '</span><b>' + h(fmt(ev.ys[j])) + '</b>' + dBar(ev.ds[j]) + '</div>').join('') + '</div>';
    }
    $('sim-extra').innerHTML = extra;
    const outside = ds.filter(d => d.kind === 'numeric' && (cur[d.name] < d.lo || cur[d.name] > d.hi)).map(d => d.name);
    $('sim-warn').hidden = !outside.length;
    $('sim-warn').textContent = outside.length ? '⚠ ' + outside.join(', ') + (outside.length > 1 ? ' are' : ' is') + ' outside the range where 90% of your data sits. Predictions there are less reliable: confirm with a trial before acting.' : '';
  }

  // The small response curve under a knob: shaded usual range, current position marked.
  function knobCurve(rep, d, ys, v, now, lo, hi) {
    const W = 260, H = 46, pad = 3, span = hi - lo || 1;
    const sy = y => H - pad - (y - lo) / span * (H - 2 * pad);
    if (d.kind === 'numeric') {
      const sx = x => pad + (x - d.min) / (d.max - d.min || 1) * (W - 2 * pad);
      const path = d.grid.map((g, i) => (i ? 'L' : 'M') + sx(g).toFixed(1) + ' ' + sy(ys[i]).toFixed(1)).join('');
      return '<svg class="chart knob-svg" viewBox="0 0 ' + W + ' ' + H + '"><rect class="usual" x="' + sx(d.lo) + '" y="0" width="' + (sx(d.hi) - sx(d.lo)) + '" height="' + H + '"/><path class="line" d="' + path + '"/><circle class="query" cx="' + sx(v) + '" cy="' + sy(now) + '" r="4.5"/></svg>';
    }
    // Categories: one bar per level, labelled underneath, current level highlighted.
    const n = d.grid.length, bw = (W - 2 * pad) / n, LH = 14;
    return '<svg class="chart knob-svg" viewBox="0 0 ' + W + ' ' + (H + LH) + '">' + d.grid.map((g, i) => '<rect class="bar' + (g === v ? ' accent' : '') + '" x="' + (pad + i * bw + 1) + '" y="' + sy(ys[i]) + '" width="' + Math.max(2, bw - 2) + '" height="' + Math.max(1.5, H - pad - sy(ys[i])) + '" rx="2"><title>' + h(g) + ': ' + h(simFmt(rep, ys[i])) + '</title></rect>' +
      '<text x="' + (pad + i * bw + bw / 2) + '" y="' + (H + LH - 3) + '" text-anchor="middle"' + (g === v ? ' class="lbl-strong"' : '') + '>' + h(String(g).length > 10 ? String(g).slice(0, 9) + '…' : g) + '</text>').join('') + '</svg>';
  }

  function animateNumber(el, from, to, show) {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || from === to) { el.textContent = show(to); return; }
    const t0 = performance.now(), dur = 220;
    const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = show(from + (to - from) * e); if (k < 1 && el.isConnected) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  function renderPins() {
    const sim = state.sim; if (!sim) return;
    const rep = sim.rep, ds = sim.drivers;
    if (!sim.pinned.length) { $('sim-pins').innerHTML = ''; return; }
    const rows = [{ name: 'Typical settings', values: sim.typical }].concat(sim.pinned.map((p, i) => ({ name: 'Scenario ' + (i + 1), values: p.values, base: p.base, i })));
    const scores = rep.predictMany(rows.map((r, j) => Object.assign({}, j ? r.base : sim.typicalBase, r.values))).map(o => simScore(rep, o));
    const des = rep.desirability, Ds = des ? rows.map((r, j) => des.evaluate(Object.assign({}, j ? r.base : sim.typicalBase, r.values)).D) : null;
    sim.pinRows = rows.map((r, j) => ({ name: r.name, values: r.values, score: scores[j], D: Ds ? Ds[j] : null }));
    $('sim-pins').innerHTML = '<h4>Pinned scenarios</h4><div class="table-scroll"><table class="pins"><thead><tr><th>Scenario</th>' + ds.map(d => '<th class="num-cell">' + h(d.name) + '</th>').join('') + '<th class="num-cell">' + h(rep.task === 'classification' ? 'Chance of ' + A.classLabel(rep) : 'Predicted ' + rep.target) + '</th>' + (Ds ? '<th class="num-cell">Overall D</th>' : '') + '<th></th></tr></thead><tbody>' +
      rows.map((r, j) => '<tr' + (j ? '' : ' class="dim"') + '><td>' + h(r.name) + '</td>' + ds.map(d => { const v = r.values[d.name]; const changed = j && v !== sim.typical[d.name]; return '<td class="num-cell">' + (changed ? '<b>' : '') + h(d.kind === 'numeric' ? fmt(v) : v) + (changed ? '</b>' : '') + '</td>'; }).join('') +
        '<td class="num-cell"><b>' + h(simFmt(rep, scores[j])) + '</b></td>' + (Ds ? '<td class="num-cell">' + Ds[j].toFixed(2) + '</td>' : '') + '<td>' + (j ? '<button type="button" class="icon-btn" data-unpin="' + r.i + '" aria-label="Remove ' + h(r.name) + '">✕</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>';
  }

  function tCritical(df) {
    let lo = 0, hi = 200;
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (E.tTestP(mid, df) > 0.05) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  function renderDOE(rep, blocks) {
    const a = rep.doe;
    const df = a.dfe > 0 ? a.dfe : Math.max(1, a.terms.length / 3);
    const tc = tCritical(df);
    const goal = rep.goal === 'min' ? a.optimum.min : a.optimum.max;
    const nm = v => (typeof v === 'number' ? fmt(v) : v);
    append(blocks,
      card('DOE: Pareto of effects', 'Standardized effect size |t|. Bars past the red dashed line (t = ' + tc.toFixed(2) + ') are significant at p &lt; 0.05. Dark bars are significant.', '<div id="pareto"></div>', 'pareto') +
      card('DOE: effects table', h(a.method) + '. R² ' + pct(a.r2) + (a.adjR2 !== null ? ', adjusted ' + pct(a.adjR2) : '') + (a.predR2 !== null ? ', predicted ' + pct(Math.max(0, a.predR2)) : '') + '.',
        '<div class="table-scroll"><table><thead><tr><th>Term</th><th class="num-cell">Effect</th><th class="num-cell">Coef.</th><th class="num-cell">t</th><th class="num-cell">p</th><th class="num-cell">q (adjusted)</th><th></th></tr></thead><tbody>' +
        a.terms.map(t => '<tr' + ((t.q === null || t.q === undefined ? t.p : t.q) < 0.05 ? '' : ' class="dim"') + '><td>' + h(t.name) + '</td><td class="num-cell">' + (t.kind === 'square' ? '–' : fmt(t.effect)) + '</td><td class="num-cell">' + fmt(t.coef) + '</td><td class="num-cell">' + (isFinite(t.t) ? t.t.toFixed(2) : '∞') + '</td><td class="num-cell">' + (isFinite(t.p) ? (t.p < 0.001 ? '&lt;0.001' : t.p.toFixed(3)) : '–') + '</td><td class="num-cell">' + (t.q === null || t.q === undefined ? '–' : (t.q < 0.001 ? '&lt;0.001' : t.q.toFixed(3))) + '</td><td>' +
          (t.p < 0.05 ? '<span class="chip">significant</span>' : t.p < 0.1 ? '<span class="chip off">borderline</span>' : '') + '</td></tr>').join('') +
        '</tbody></table></div><p class="hint">Factor letters: ' + a.factors.map(f => f.letter + ' = ' + h(f.name)).join(', ') + '.</p>', 'effects'),
      'block-grid');
    C.hbar($('pareto'), a.terms.slice(0, 15).map(t => ({ label: t.name, value: Math.min(Math.abs(t.t), 999), cls: (t.q === null || t.q === undefined ? t.p : t.q) < 0.05 ? 'hi' : '', text: Math.abs(t.t) > 999 ? '>999' : Math.abs(t.t).toFixed(1), tip: t.name + '\nEffect ' + fmt(t.effect) + ' · p ' + (isFinite(t.p) ? t.p.toFixed(4) : '–') + (t.q === null || t.q === undefined ? '' : ' · q ' + t.q.toFixed(4)) })), { min: 0, ref: { value: tc }, label: 'Pareto chart of standardized effects' });

    append(blocks, card('DOE: main effects', 'Average ' + h(rep.target) + ' at each level of each factor. Steeper = stronger. Same scale on every panel.', '<div class="me-grid" id="me-grid"></div>', 'mainEffects'));
    append(blocks,
      card('DOE: ' + (a.interaction ? 'strongest interaction' : 'interactions'), a.interaction ? 'Model prediction for ' + h(a.interaction.a) + ' at each level of ' + h(a.interaction.b) + '. Non-parallel lines mean the factors interact.' : '', a.interaction ? '<div id="int-chart"></div><div id="int-legend"></div>' : '<p>No interaction terms could be estimated in this design.</p>', 'interaction') +
      card('Best settings found', 'Goal: ' + (rep.goal === 'min' ? 'minimize' : 'maximize') + ' ' + h(rep.target) + ', searching inside the tested range only.',
        goal ? '<div class="table-scroll"><table><tbody>' + goal.settings.map(s => '<tr><td>' + h(s.name) + '</td><td class="num-cell"><b>' + h(nm(s.actual)) + '</b></td></tr>').join('') +
          '<tr class="best"><td>Predicted ' + h(rep.target) + '</td><td class="num-cell"><b>' + fmt(goal.y) + '</b></td></tr></tbody></table></div><p class="hint">Confirm with 3 to 5 runs at these settings before changing the process.</p>' : '<p>Not available.</p>', 'optimum'),
      'block-grid');
    const all = a.mainEffects.reduce((s, m) => s.concat(m.points.map(p => p.mean)), []);
    const dom = [Math.min(...all), Math.max(...all)];
    a.mainEffects.forEach(m => {
      const div = document.createElement('div'); $('me-grid').appendChild(div);
      const lab = {}; m.points.forEach(p => { lab[p.coded] = nm(p.actual); });
      C.lines(div, [{ name: m.name, points: m.points.map(p => ({ x: p.coded, y: p.mean, tip: m.name + ' = ' + lab[p.coded] + '\nMean ' + fmt(p.mean) })) }],
        { yDomain: dom, xLabel: m.name, xTickFmt: c => lab[c], width: 280, height: 190, label: 'Main effect of ' + m.name });
    });
    if (a.interaction) {
      const it = a.interaction;
      const lab = { '-1': String(nm(it.lines[0].points[0].aLevel)), '1': String(nm(it.lines[0].points[1].aLevel)) };
      C.lines($('int-chart'), it.lines.map((l, i) => ({ name: it.b + ' = ' + nm(l.bLevel), cls: i ? 's2' : '', points: l.points.map((p, j) => ({ x: j ? 1 : -1, y: p.y, tip: it.a + ' = ' + nm(p.aLevel) + ', ' + it.b + ' = ' + nm(l.bLevel) + '\nPredicted ' + fmt(p.y) })) })),
        { xLabel: it.a, yLabel: rep.target, xTickFmt: c => lab[String(c)], label: 'Interaction plot' });
      $('int-legend').innerHTML = C.legend(it.lines.map((l, i) => ({ label: it.b + ' = ' + nm(l.bLevel), cls: i ? 'pt s2' : 'pt' })));
    }
  }

  function renderClusters(rep, blocks) {
    const c = rep.clustering;
    append(blocks,
      card('Groups in the data', c.pca ? 'Rows plotted on the two main directions of variation (PCA: ' + pct(c.pca.explained[0]) + ' + ' + pct(c.pca.explained[1]) + ' of the spread). Color and shape show the group.' : '', c.pca ? '<div id="pca-chart"></div><div id="pca-legend"></div>' : '<p>Need at least two inputs to plot.</p>', 'pca') +
      card('How many groups?', 'Silhouette score for each number of groups: higher means tighter, better separated groups. The largest dot is the agent\'s choice. Splits that leave a group of only a few rows are skipped: those rows are outliers, not a segment.', '<div id="sil-chart"></div>', 'silhouette'),
      'block-grid');
    if (c.pca) {
      C.scatter($('pca-chart'), c.pca.scores.map((s, i) => ({ x: s[0], y: s[1], cls: 'c' + (c.labels[i] % 6 + 1), shape: C.SHAPES[c.labels[i] % 6], tip: 'Row ' + (c.rows[i] + 2) + '\nGroup ' + (c.labels[i] + 1) })),
        { xLabel: 'Component 1', yLabel: 'Component 2', label: 'PCA scatter by group' });
      $('pca-legend').innerHTML = C.legend(c.profiles.map(p => ({ label: 'Group ' + p.cluster + ' (' + p.size + ')', cls: 'c' + ((p.cluster - 1) % 6 + 1), shape: C.SHAPES[(p.cluster - 1) % 6] })));
    }
    C.lines($('sil-chart'), [{ name: 'Silhouette', points: c.tries.map(t => ({ x: t.k, y: t.silhouette, big: t.k === c.k, tip: t.k + ' groups: silhouette ' + t.silhouette.toFixed(2) + (t.tiny ? '\nSkipped: one group has only a few rows' : '') })) }], { xLabel: 'Number of groups', yLabel: 'Silhouette', label: 'Silhouette by number of groups' });

    const numCols = state.prof.columns.filter(col => rep.features.includes(col.name) && col.kind === 'numeric');
    const prof = '<div class="table-scroll"><table><thead><tr><th>Group</th><th class="num-cell">Rows</th>' + numCols.map(col => '<th class="num-cell">' + h(col.name) + '</th>').join('') + '<th>Stands out for</th></tr></thead><tbody>' +
      c.profiles.map(p => '<tr><td><b>Group ' + p.cluster + '</b></td><td class="num-cell">' + p.size + ' (' + pct(p.share) + ')</td>' +
        numCols.map(col => { const t = p.means.find(m => m.name === col.name); return '<td class="num-cell">' + (t ? fmt(t.mean) : '–') + '</td>'; }).join('') +
        '<td>' + h(p.traits.map(t => t.text).join('; ')) + '</td></tr>').join('') +
      '<tr class="dim"><td>All rows</td><td class="num-cell">' + c.rows.length + '</td>' + numCols.map(col => '<td class="num-cell">' + fmt(col.stats.mean) + '</td>').join('') + '<td></td></tr></tbody></table></div>';
    const out = c.outliers.length ? '<p class="hint">Unusual rows (spreadsheet row numbers, header = row 1): ' + c.outliers.slice(0, 20).map(o => o.row).join(', ') + (c.outliers.length > 20 ? '…' : '') + '</p>' : '';
    append(blocks, card('Group profiles', 'Average of each numeric column per group, and what makes each group different.', prof + out, 'profiles'));
  }

  function renderCorrelations(rep, blocks) {
    const cs = (rep.correlations || []).filter(c => Math.abs(c.r) >= 0.3).slice(0, 8);
    if (!cs.length) return;
    append(blocks, card('Strongest relationships between numeric columns', 'Pearson correlation, −1 to 1.',
      '<div class="table-scroll"><table><thead><tr><th>Column</th><th>Column</th><th class="num-cell">r</th><th>Reads as</th></tr></thead><tbody>' +
      cs.map(c => '<tr><td>' + h(c.a) + '</td><td>' + h(c.b) + '</td><td class="num-cell">' + c.r.toFixed(2) + '</td><td>' + (Math.abs(c.r) >= 0.7 ? 'strong' : 'moderate') + (c.r > 0 ? ', rise together' : ', one rises as the other falls') + '</td></tr>').join('') + '</tbody></table></div>', 'correlations'));
  }

  // ---------- DOE builder ----------
  function isNum(v) { return v !== '' && v !== null && isFinite(Number(v)); }
  function factorList() {
    return state.factors.map(f => ({ name: String(f.name).trim(), low: f.low, high: f.high, categorical: !(isNum(f.low) && isNum(f.high)) }));
  }
  const isMixture = () => !!(D.DESIGNS[$('design-type').value] || {}).mixture;
  function renderFactors() {
    /* A mixture component is a share of one blend, so "low and high level" is the wrong
       question for it: what it has is a minimum and a maximum percentage. */
    const mix = isMixture();
    $('factors').innerHTML = '<thead><tr><th>' + (mix ? 'Component' : 'Factor') + '</th><th>' + (mix ? 'Minimum %' : 'Low level') + '</th><th>' + (mix ? 'Maximum %' : 'High level') + '</th><th></th></tr></thead><tbody>' +
      state.factors.map((f, i) => '<tr><td><input type="text" data-i="' + i + '" data-k="name" value="' + h(f.name) + '" aria-label="Factor ' + (i + 1) + ' name"></td>' +
        '<td><input type="text" data-i="' + i + '" data-k="low" value="' + h(f.low) + '" aria-label="' + (mix ? 'Component ' + (i + 1) + ' minimum percent' : 'Factor ' + (i + 1) + ' low level') + '"></td>' +
        '<td><input type="text" data-i="' + i + '" data-k="high" value="' + h(f.high) + '" aria-label="' + (mix ? 'Component ' + (i + 1) + ' maximum percent' : 'Factor ' + (i + 1) + ' high level') + '"></td>' +
        '<td><button class="icon-btn" type="button" data-remove="' + i + '" aria-label="Remove factor ' + (i + 1) + '">✕</button></td></tr>').join('') + '</tbody>';
    renderDesignTypes();
  }
  function designPurpose() {
    const type = $('design-type').value, spec = D.DESIGNS[type] || {};
    const extra = spec.mixture ? learnLink('mixture-designs', 'How mixtures differ') : type === 'dsd' ? learnLink('definitive-screening', 'Why this beats a Plackett-Burman screen') : learnLink('designs', 'See the design shapes');
    $('design-purpose').innerHTML = h(spec.purpose || '') + ' ' + extra;
    const mix = !!spec.mixture;
    $('total-wrap').hidden = !mix;
    $('degree-wrap').hidden = type !== 'mixLattice';
    // Centre points mean nothing in a blend: there is no "everything at mid-level" mixture.
    $('centers').closest('label').hidden = mix;
    $('mix-analyse').hidden = !mix;
    /* A definitive screening design carries its own centre run, so the usual default of three
       would quietly inflate it past the run count it is chosen for. Start at none; adding
       some is then a deliberate choice that buys a pure-error estimate. */
    if (type === 'dsd' && Number($('centers').value) === 3) $('centers').value = 0;
  }
  function renderDesignTypes(preferred) {
    const k = state.factors.length;
    const sel = $('design-type');
    const current = preferred || sel.value;
    sel.innerHTML = Object.keys(D.DESIGNS).map(t => {
      const d = D.DESIGNS[t], ok = k >= d.min && k <= d.max;
      return '<option value="' + t + '"' + (ok ? '' : ' disabled') + '>' + h(d.name) + (ok ? '' : ' (needs ' + d.min + '–' + d.max + ' factors)') + '</option>';
    }).join('');
    const d = D.DESIGNS[current];
    sel.value = d && k >= d.min && k <= d.max ? current : D.recommend(k).type;
    if (!D.DESIGNS[sel.value] || sel.selectedOptions[0].disabled) sel.value = 'pb';
    designPurpose();
  }
  function generateDesign(seed) {
    showError('doe-error', '');
    const fs = factorList();
    const names = fs.map(f => f.name);
    if (names.some(n => !n)) return showError('doe-error', 'Every factor needs a name.');
    if (new Set(names).size !== names.length) return showError('doe-error', 'Factor names must be different.');
    if (isMixture()) {
      const badPct = fs.find(f => [f.low, f.high].some(v => String(v).trim() !== '' && !isNum(v)));
      if (badPct) return showError('doe-error', '"' + badPct.name + '" needs its minimum and maximum as percentages of the blend, or left blank for 0 and 100.');
    } else {
      const bad = fs.find(f => String(f.low).trim() === '' || String(f.high).trim() === '' || String(f.low).trim() === String(f.high).trim());
      if (bad) return showError('doe-error', '"' + bad.name + '" needs two different levels.');
    }
    let design;
    try {
      design = D.generate(fs.map(f => ({ name: f.name, low: f.categorical ? String(f.low).trim() : Number(f.low), high: f.categorical ? String(f.high).trim() : Number(f.high), categorical: f.categorical })), {
        type: $('design-type').value, centerPoints: Number($('centers').value) || 0, replicates: Number($('reps').value) || 1,
        randomize: $('randomize').checked, seed: seed || (Date.now() % 1e9),
        total: Number($('mix-total').value) || 100, degree: Number($('mix-degree').value) || 3
      });
    } catch (e) { return showError('doe-error', e.message); }
    state.design = { design, factors: fs, response: $('response-name').value.trim() || 'Response' };
    const resp = state.design.response;
    $('design-out').innerHTML = '<div class="design-summary"><p><b>' + h(design.name) + ': ' + design.runs.length + ' runs</b> for ' + design.k + ' factor' + (design.k > 1 ? 's' : '') + '.</p><p>' + h(design.purpose) + '</p>' +
      design.notes.map(n => '<p>' + h(n) + '</p>').join('') +
      '<p>Run the experiments in <b>RunOrder</b> (randomized to protect against drift), record ' + h(resp) + ', then load the file in step 1. The agent will recognize the design and analyze it.</p></div>' +
      '<div class="row-actions"><button class="btn primary" type="button" id="download-design">Download run sheet (.csv)</button></div>' +
      '<div class="table-scroll"><table class="runsheet"><thead><tr><th class="num-cell">Run</th><th class="num-cell">Std</th>' + fs.map(f => '<th class="num-cell">' + h(f.name) + '</th>').join('') + '<th>' + h(resp) + '</th></tr></thead><tbody>' +
      design.runs.map(r => '<tr><td class="num-cell">' + r.run + '</td><td class="num-cell">' + r.std + '</td>' +
        r.actual.map((v, j) => '<td class="num-cell">' + h(v) + (design.mixture ? '<span class="share-note">' + (r.proportions[j] * 100).toFixed(1) + '%</span>' : '') + '</td>').join('') +
        '<td class="blank"></td></tr>').join('') + '</tbody></table></div>';
    $('download-design').addEventListener('click', () => download('doe-run-sheet.csv', D.toCSV(design, fs, resp), 'text/csv'));
  }
  /* ---------- Analysing a finished mixture ----------
     Kept here beside the builder rather than in the main pipeline: the usual analysis path
     assumes factors that move independently, and a blend does not. */
  function mixtureExample() {
    // A formulation where the buffer and the sugar help each other and the surfactant hurts
    // above a few percent: a synergy and an antagonism, so both readings are on show.
    const comps = [{ name: 'Buffer', low: 40, high: 70 }, { name: 'Sugar', low: 5, high: 30 },
      { name: 'Surfactant', low: 0, high: 10 }, { name: 'Water', low: 10, high: 40 }];
    // Edge midpoints as well as corners: without interior blends a curved model cannot be
    // fitted, and demonstrating synergy is the point of the example.
    const d = D.generate(comps, { type: 'mixVertices', randomize: false, total: 100, seed: 7, edges: true });
    const rand = E.rng(99);
    const norm = () => { const u = Math.max(1e-12, rand()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };
    const lines = [comps.map(c => c.name).concat(['Stability_Pct']).join(',')];
    d.runs.forEach(r => {
      const p = r.proportions;
      const y = 92 * p[0] + 78 * p[1] + 40 * p[2] + 60 * p[3] + 55 * p[0] * p[1] - 70 * p[0] * p[2] + norm() * 0.5;
      lines.push(r.actual.concat([y.toFixed(2)]).join(','));
    });
    return lines.join('\n');
  }
  function fitMixture() {
    showError('mix-error', '');
    $('mix-out').innerHTML = '';
    const text = $('mix-data').value.trim();
    if (!text) return showError('mix-error', 'Paste the completed run sheet first, or load the worked example.');
    let t;
    try { t = E.parseTable(text); } catch (e) { return showError('mix-error', 'Could not read that: ' + e.message); }
    if (!t.rows.length || t.columns.length < 3) return showError('mix-error', 'Expected a header row, one column per component, and a column holding the measured response.');
    const prof = E.profile(t);
    const numeric = prof.columns.filter(c => c.kind === 'numeric').map(c => c.name);
    if (numeric.length < 3) return showError('mix-error', 'At least two component columns and one response column need to hold numbers.');
    // The response is the last numeric column; everything numeric before it is a component.
    const respName = numeric[numeric.length - 1];
    const compNames = numeric.slice(0, -1);
    const ci = compNames.map(c => t.columns.indexOf(c)), ri = t.columns.indexOf(respName);
    const pts = [], y = [];
    let dropped = 0;
    t.rows.forEach(row => {
      const amounts = ci.map(j => E.toNumber(row[j]));
      const resp = E.toNumber(row[ri]);
      if (resp === null || amounts.some(v => v === null)) { dropped++; return; }
      const tot = amounts.reduce((a, b) => a + b, 0);
      if (!(tot > 0)) { dropped++; return; }
      pts.push(amounts.map(v => v / tot));
      y.push(resp);
    });
    if (pts.length < compNames.length) return showError('mix-error', 'Only ' + pts.length + ' usable blends for ' + compNames.length + ' components. A blending model needs at least as many blends as components.');
    /* The totals should already be constant; if they are not, each row is still normalised
       to its own total, which is the right thing to do but worth saying out loud. */
    const totals = t.rows.map(row => ci.map(j => E.toNumber(row[j])).reduce((a, b) => a + (b || 0), 0)).filter(v => v > 0);
    const spread = Math.max.apply(null, totals) - Math.min.apply(null, totals);
    let res;
    try { res = D.analyzeMixture(pts, y, compNames); } catch (e) { return showError('mix-error', e.message); }

    const pure = res.coefs.filter(c => c.pure).slice().sort((a, b) => b.beta - a.beta);
    const cross = res.coefs.filter(c => !c.pure).slice().sort((a, b) => Math.abs(b.beta) - Math.abs(a.beta));
    const real = cross.filter(c => c.p !== null && c.p < 0.05);
    // The best blend among those actually run: no extrapolating outside the tested region.
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (y[i] > y[best]) best = i;

    const pFmt = v => (v === null || !isFinite(v) ? '–' : v < 0.0001 ? '<0.0001' : v.toFixed(4));
    const fx = v => (v === null || !isFinite(v) ? '–' : Number(v).toFixed(3));
    const anyExtrap = res.anyExtrapolated;
    const plain = (anyExtrap
      ? 'The component coefficients rank the components, strongest first: ' + pure.map(c => c.label + ' ' + fx(c.beta)).join(', ') + '. Each one is the model\'s value for that component on its own — but your limits mean no such blend was run, or could be, so treat them as a ranking rather than as predictions. '
      : 'Read the component coefficients as the response from that component on its own: ' +
        pure.slice(0, 2).map(c => c.label + ' at ' + fx(c.beta)).join(' is the strongest, ') + ', and the weakest is ' + pure[pure.length - 1].label + ' at ' + fx(pure[pure.length - 1].beta) + '. ') +
      (res.quadratic
        ? (real.length
          ? 'The blend terms matter here: ' + real.slice(0, 2).map(c => c.label + ' is ' + (c.beta > 0 ? 'positive (' + fx(c.beta) + '), so that pair does better together than the average of the two apart' : 'negative (' + fx(c.beta) + '), so that pair works against each other')).join(', and ') + '. That is exactly the kind of effect a factorial design on these components could not have found.'
          : 'None of the blend terms reach significance, so on this evidence the components simply add up: the best formulation is the best components in the largest allowed amounts, with no synergy to exploit.')
        : (res.singular
          ? 'Only a straight additive model could be fitted. There are enough blends here for a curved one (' + res.n + ' blends for ' + res.termsWanted + ' terms) but they do not sit in enough different places to support it — corners alone cannot show curvature. Add the edge midpoints and the centre of the region and it becomes estimable.'
          : 'Only a straight additive model could be fitted from these ' + res.n + ' blends; a curved one needs at least ' + res.termsWanted + '. So no synergy or antagonism can be assessed either way.'));

    $('mix-out').innerHTML = '<div class="card mix-result"><h4>Blending model (Scheff&eacute;)</h4>' +
      '<div class="plain ' + (real.length ? 'marginal' : 'capable') + '"><h4>In plain English</h4><p>' + h(plain) + '</p></div>' +
      '<p class="sub-head">' + res.n + ' blends, ' + res.q + ' components, ' + (res.quadratic ? 'quadratic' : 'linear') + ' model' +
      (res.r2 === null ? '' : ', R&sup2; ' + (res.r2 * 100).toFixed(1) + '%') + (res.rmse === null ? '' : ', typical miss ' + fx(res.rmse)) + '.</p>' +
      '<div class="table-scroll"><table><thead><tr><th>Term</th><th class="num-cell">Coefficient</th><th class="num-cell">Std error</th><th class="num-cell">p</th><th>Reading</th></tr></thead><tbody>' +
      res.coefs.map(c => '<tr><td>' + h(c.label) + '</td><td class="num-cell">' + fx(c.beta) + '</td><td class="num-cell">' + fx(c.se) + '</td><td class="num-cell">' + pFmt(c.p) + '</td><td>' +
        (c.pure ? (c.extrapolated ? h(c.label) + ' alone — <b>not a blend you ran</b> (highest tested ' + (c.maxObserved * 100).toFixed(0) + '%)' : 'response from ' + h(c.label) + ' alone')
          : c.p !== null && c.p < 0.05 ? (c.beta > 0 ? '<span class="verdict capable">synergy</span>' : '<span class="verdict not">antagonism</span>')
            : '<span class="verdict marginal">not shown</span>') + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<p class="hint">There is no intercept, and that is correct rather than an omission: the components always add to the same total, so a constant term cannot be told apart from the components themselves.</p>' +
      '<h4>Best blend among those actually run</h4><p>' + compNames.map((c, j) => h(c) + ' ' + (pts[best][j] * 100).toFixed(1) + '%').join(', ') + ' &rarr; ' + h(respName) + ' ' + fx(y[best]) + '.</p>' +
      '<ul class="insights">' +
      '<li class="info">This is the best of the blends you ran, not a predicted optimum. Searching the model for a better blend is worth doing, but it only means something inside the region you actually tested.</li>' +
      (anyExtrap ? '<li class="warn">Your components have minimums and maximums, so a pure-component blend was never formulable. The pure coefficients above are the model extrapolated to a corner of the triangle that no run came near — useful for ranking the components, not as a number to quote.</li>' : '') +
      (res.singular ? '<li class="warn">A curved blending model could not be fitted from these blends even though there are enough of them: they sit on too few distinct faces of the region. Adding the edge midpoints and the centre would let synergy be assessed.</li>' : '') +
      (res.df < 3 ? '<li class="warn">Only ' + res.df + ' degree' + (res.df === 1 ? '' : 's') + ' of freedom left after fitting, so the standard errors above are barely estimated. Treat the p-values as indicative.</li>' : '') +
      (spread > 1e-6 ? '<li class="warn">The component totals are not constant across rows (they vary by ' + fx(spread) + '), so each blend was converted to proportions of its own total. If that was not intended, check the run sheet.</li>' : '') +
      (dropped ? '<li class="info">' + dropped + ' row' + (dropped === 1 ? '' : 's') + ' skipped for missing numbers.</li>' : '') +
      '<li class="info">Response taken as "' + h(respName) + '" (the last numeric column); components taken as ' + compNames.map(h).join(', ') + '. Reorder the columns if that is not what you meant.</li>' +
      '</ul></div>';
  }

  function prefillDOE(rep) {
    const rec = rep.doeRecommendation;
    state.factors = rec.factors.map(f => ({ name: f.name, low: f.low, high: f.high }));
    renderFactors();
    renderDesignTypes(rec.type);
    $('centers').value = rec.centerPoints || 0;
    $('reps').value = rec.replicates || 1;
    $('response-name').value = rep.target;
    $('doe-intro').innerHTML = '<b>Pre-filled by the agent.</b> ' + h(rec.why) + ' Adjust the levels to what is safe and practical, then regenerate.';
    $('doe-wrap').open = true;
    generateDesign(rep.seed);
  }
  function resetDOE() {
    state.factors = DEFAULT_FACTORS(); state.design = null;
    renderFactors(); renderDesignTypes('full');
    $('centers').value = 3; $('reps').value = 1; $('response-name').value = 'Response';
    $('design-out').innerHTML = ''; showError('doe-error', '');
    $('doe-intro').textContent = 'Plan a designed experiment from scratch, or let the agent pre-fill it after a run. Set each factor\'s low and high level; words (like Supplier A / Supplier B) make a categorical factor.';
  }

  // ---------- Report ----------
  function download(name, data, type) {
    // Builds the file in memory and hands it to the browser's own download. Nothing is sent anywhere.
    const url = URL.createObjectURL(new Blob([data], { type: typeof data === 'string' ? type + ';charset=utf-8' : type }));
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function pageCSS() {
    // Copies this page's own stylesheet (already loaded, nothing fetched) into the report.
    try { return Array.from(document.styleSheets).map(s => Array.from(s.cssRules).map(r => r.cssText).join('\n')).join('\n'); } catch (e) { return ''; }
  }
  function reportHTML(rep) {
    const clone = id => {
      const n = $(id).cloneNode(true);
      n.querySelectorAll('.whatif').forEach(x => { const c = x.closest('.card'); if (c) c.remove(); });
      n.querySelectorAll('button, input, select, textarea, .row-actions, a.learn-link').forEach(x => x.remove());
      n.querySelectorAll('details').forEach(d => { d.open = true; });
      n.removeAttribute('hidden');
      return n.outerHTML;
    };
    const glossary = '<div class="card"><h3>Glossary</h3><table><tbody>' + X.GLOSSARY.map(g => '<tr><td><b>' + h(g[0]) + '</b></td><td>' + h(g[1]) + '</td></tr>').join('') + '</tbody></table></div>';
    const models = rep.leaderboard ? '<div class="card"><h3>The models, in plain words</h3><dl>' + rep.leaderboard.filter(m => m.metrics).map(m => '<dt><b>' + h(m.name) + '</b>' + (m === rep.best ? ' (chosen)' : '') + '</dt><dd>' + h(m.plain) + ' <i>' + h(X.MODEL_ANALOGY[m.id] || '') + '</i></dd>').join('') + '</dl></div>' : '';
    let doe = '';
    if (state.design) {
      const out = $('design-out').cloneNode(true);
      out.querySelectorAll('.row-actions').forEach(x => x.remove());
      doe = '<section class="wrap step"><div class="step-head"><span class="num">5</span><h2>Recommended experiment</h2></div><div class="card"><p>' + $('doe-intro').innerHTML + '</p>' + out.innerHTML + '</div></section>';
    }
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">' +
      '<title>BOSS report: ' + h(state.name) + '</title><style>' + pageCSS() + '</style></head><body><main>' +
      '<section class="hero"><div class="wrap"><p class="eyebrow">BOSS report · ' + h(new Date().toLocaleString()) + '</p><h1>' + h(state.name) + '</h1><p class="lede">' + rep.profile.nRows.toLocaleString() + ' rows × ' + rep.profile.nCols + ' columns. ' +
      (rep.target ? 'Target: ' + h(rep.target) + '.' : 'No target: unsupervised analysis.') + ' Computed entirely in the browser; no data left the device.</p></div></section>' +
      clone('results') + '<section class="wrap step">' + models + glossary + '</section>' + clone('next') + doe +
      '</main><footer class="foot"><div class="wrap"><p>Generated by BOSS. Charts and tables summarize your data; keep or delete this file as your data policy requires.</p></div></footer></body></html>';
  }

  // ---------- PDF and print ----------
  // Charts use light-mode colors in the PDF and on paper, whatever the screen theme is.
  function withLightTheme() {
    const el = document.documentElement, prev = el.getAttribute('data-theme');
    el.setAttribute('data-theme', 'light');
    return () => { if (prev === null) el.removeAttribute('data-theme'); else el.setAttribute('data-theme', prev); };
  }
  const SVG_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-size', 'font-weight', 'font-family', 'font-style'];
  // Turns an on-screen SVG chart into a JPEG for the PDF. The chart is drawn from an in-memory
  // copy (a data: URL), so nothing is loaded from anywhere.
  async function chartImage(svg) {
    const vb = svg.viewBox.baseVal, w = Math.round(vb.width), h = Math.round(vb.height);
    if (!w || !h) return null;
    const clone = svg.cloneNode(true);
    const from = svg.querySelectorAll('*'), to = clone.querySelectorAll('*');
    from.forEach((el, i) => {
      const cs = getComputedStyle(el);
      SVG_PROPS.forEach(p => { const v = cs.getPropertyValue(p); if (v) to[i].setAttribute(p, v); });
    });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', w); clone.setAttribute('height', h);
    const xml = new XMLSerializer().serializeToString(clone);
    const img = document.createElement('img');
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml); }); // PRIVACY-LOCAL-IMAGE
    const scale = 2, cv = document.createElement('canvas');
    cv.width = w * scale; cv.height = h * scale;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const b64 = cv.toDataURL('image/jpeg', 0.9).split(',')[1], bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, w: cv.width, h: cv.height, viewW: w };
  }
  const tableRows = t => Array.from(t.querySelectorAll('tr')).map(tr => Array.from(tr.children).map(c => c.textContent.replace(/\s+/g, ' ').trim()));
  const VERB_COLOR = { Increase: [44, 74, 94], Decrease: [235, 104, 52], Target: [168, 118, 0], Combine: [168, 118, 0], Choose: [47, 122, 82], Hold: [47, 122, 82], Segment: [47, 122, 82], Check: [154, 90, 0] };

  async function savePDF() {
    const rep = state.report; if (!rep) return;
    const btn = $('save-pdf'); btn.disabled = true; btn.textContent = 'Building PDF…';
    try {
      download('boss-report.pdf', await buildPDF(rep), 'application/pdf');
    } catch (e) {
      showError('run-error', 'Could not build the PDF: ' + (e.message || e) + '. Use Print and choose "Save as PDF" instead.');
    } finally {
      btn.disabled = false; btn.textContent = 'Save as PDF';
    }
  }
  async function buildPDF(rep) {
    const restore = withLightTheme();
    try {
      const P = window.MLPdf.create({ title: 'BOSS report: ' + state.name, footer: 'BOSS report · ' + state.name + ' · computed in the browser, no data left the device' });
      P.h1('BOSS report');
      P.muted(state.name + ' · ' + rep.profile.nRows.toLocaleString() + ' rows × ' + rep.profile.nCols + ' columns · ' + (rep.target ? 'target: ' + rep.target : 'no target (unsupervised)') + ' · ' + new Date().toLocaleString());
      P.space(4);
      const plain = document.querySelector('#tiles .plain');
      if (plain) {
        P.h2(plain.querySelector('h4').textContent);
        P.p(plain.querySelector('p').textContent, { gap: 8 });
      }
      document.querySelectorAll('#tiles .tile').forEach(t => {
        const badge = t.querySelector('.risk-badge');
        P.p(t.querySelector('.lbl').textContent + ': ' + t.querySelector('.val').textContent, { bold: true, size: 10.5, gap: 0 }).muted(t.querySelector('.sub').textContent, { gap: badge ? 1 : 4 });
        if (badge) P.p('! Small sample size, high variance risk. ' + badge.getAttribute('data-tip'), { size: 8.5, bold: true, color: [154, 90, 0], gap: 4 });
      });

      const plan = rep.actionPlan;
      if (plan && plan.items.length) {
        P.h2('Action plan in plain English (' + plan.confidence + ' confidence)');
        P.p(plan.headline, { gap: 6 });
        plan.items.forEach(i => P.band(i.verb, i.text, i.impactText, VERB_COLOR[i.verb]));
        if (plan.quiet && plan.quiet.length) P.p('Little effect: ' + plan.quiet.join(', ') + '. In the range you have run, these barely move the result, so set them for cost, speed or convenience.');
        if (plan.combined) P.p('All together: ' + plan.combined);
        P.muted(plan.caveat);
      }
      const sim = state.sim;
      if (sim && sim.drivers && sim.drivers.length) {
        renderPins();
        const rows = sim.pinRows || [];
        P.h2('What-if scenarios');
        P.muted('From the what-if mixing desk. Columns not listed stay at their typical value. ' + (rep.task === 'classification' ? 'Values are the chance of ' + rep.target + ' = ' + A.classLabel(rep) + '.' : 'Values are the predicted ' + rep.target + ' (typical error ±' + fmt(rep.best.metrics.rmse) + ').'));
        const cur = rep.predictMany([Object.assign({}, sim.base, sim.values)]).map(o => simScore(rep, o))[0];
        const all = (rows.length ? rows : [{ name: 'Typical settings', values: sim.typical, score: rep.predictMany([Object.assign({}, sim.typicalBase, sim.typical)]).map(o => simScore(rep, o))[0] }]).concat([{ name: 'Current desk settings', values: sim.values, score: cur }]);
        P.table([['Scenario'].concat(sim.drivers.map(d => d.name)).concat(['Prediction'])].concat(all.map(r => [r.name].concat(sim.drivers.map(d => (d.kind === 'numeric' ? fmt(r.values[d.name]) : String(r.values[d.name])))).concat([simFmt(rep, r.score)]))));
      }
      P.h2('What the agent found');
      rep.insights.forEach(i => P.p(i.text, { bullet: i.level === 'warn' ? '!' : '·', gap: 3 }));

      P.h2('Charts, and how to read them');
      for (const card of document.querySelectorAll('#result-blocks .card')) {
        if (card.querySelector('.whatif')) continue;
        P.keep(card.querySelector('svg.chart:not(.legend svg)') ? 260 : 120).h3(card.querySelector('h3').textContent);
        const parts = card.querySelectorAll('.sub-head, svg.chart, table, h3.peek-sub, h4, .legend, .pd-cap, p.hint, details.howto');
        for (const el of parts) {
          if (el.closest('.legend') && el.tagName.toLowerCase() === 'svg') continue;
          if (el.closest('details.howto') && !el.matches('details.howto')) continue;
          if (el.closest('dl')) continue;
          if (el.matches('.sub-head, p.hint')) P.muted(el.textContent);
          else if (el.matches('h3.peek-sub')) P.h3(el.textContent);
          else if (el.matches('h4, .pd-cap')) P.p(el.textContent, { bold: true, size: 9 });
          else if (el.matches('.legend')) P.muted('Legend: ' + Array.from(el.querySelectorAll('li')).map(li => li.textContent).join(' · '));
          else if (el.matches('table')) P.table(tableRows(el));
          else if (el.matches('details.howto')) {
            const ps = el.querySelectorAll('p');
            P.p('How to read this: ' + ps[0].textContent, { size: 9, color: [44, 74, 94], gap: 2 });
            if (ps[1]) P.p(ps[1].textContent, { size: 9, italic: true, color: [86, 99, 108] });
          } else {
            const im = await chartImage(el);
            if (im) P.image(im, Math.min(500, im.viewW * 0.66));
          }
        }
        P.space(6);
      }

      P.h2('Next steps (DMAIC)');
      rep.nextSteps.forEach(s => P.p(s.phase + ': ' + s.title, { bold: true, gap: 1, keep: true }).p(s.text, { gap: 6 }));
      if (state.design) {
        const d = state.design;
        P.h2('Recommended experiment: ' + d.design.name + ' (' + d.design.runs.length + ' runs)');
        P.p($('doe-intro').textContent);
        d.design.notes.forEach(n => P.muted(n));
        P.table([['Run', 'Std'].concat(d.factors.map(f => f.name)).concat([d.response])].concat(d.design.runs.map(r => [String(r.run), String(r.std)].concat(r.actual.map(String)).concat(['']))));
      }
      if (rep.leaderboard) {
        P.h2('The models, in plain words');
        rep.leaderboard.filter(m => m.metrics).forEach(m => P.p(m.name + (m === rep.best ? ' (chosen)' : ''), { bold: true, gap: 1, keep: true }).p(m.plain, { gap: 5 }));
      }
      P.h2('Glossary');
      P.table([['Term', 'Meaning']].concat(X.GLOSSARY));
      P.pageBreak().h1('Audit trail');
      P.muted('What was analyzed, how, and with which settings, so a reviewer can retrace this report.');
      AU.trail(rep, auditContext()).forEach(sec => { if (sec.rows.length) { P.keep(90).h2(sec.title); P.table([['Item', 'Detail']].concat(sec.rows.map(r => [String(r[0]), String(r[1])]))); } });
      return P.output();
    } finally {
      restore();
    }
  }

  // ---------- Audit-ready exports ----------
  function scenarioTable() {
    const sim = state.sim, rep = state.report;
    if (!sim || !sim.drivers || !sim.drivers.length || sim.rep !== rep) return null;
    renderPins();
    const rows = (sim.pinRows || []).slice();
    const cur = rep.predictMany([Object.assign({}, sim.base, sim.values)]).map(o => simScore(rep, o))[0];
    rows.push({ name: 'Current desk settings', values: sim.values, score: cur, D: rep.desirability ? rep.desirability.evaluate(Object.assign({}, sim.base, sim.values)).D : null });
    const header = ['Scenario'].concat(sim.drivers.map(d => d.name), [rep.task === 'classification' ? 'Chance of ' + A.classLabel(rep) : 'Predicted ' + rep.target], rep.desirability ? ['Overall D'] : []);
    return { header, rows: rows.map(r => [r.name].concat(sim.drivers.map(d => r.values[d.name]), [Number(r.score.toPrecision(6))], rep.desirability ? [Number(r.D.toPrecision(4))] : [])) };
  }
  const auditContext = () => ({ sources: state.sources, merge: state.merge, options: state.runOptions, when: state.runAt, scenarios: scenarioTable(), design: state.design, table: state.table, stability: window.MLStabilityRun, tost: window.MLTostRun, golden: window.MLGoldenRun, variance: window.MLVarianceRun, tolerance: window.MLToleranceRun });
  const workbook = rep => AU.xlsx(AU.sheets(rep, auditContext()), { title: 'BOSS results: ' + state.name });
  function saveExcel() {
    const rep = state.report; if (!rep) return;
    try { download('boss-results.xlsx', workbook(rep), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); }
    catch (e) { showError('run-error', 'Could not build the workbook: ' + (e.message || e)); }
  }
  async function saveAuditPackage() {
    const rep = state.report; if (!rep) return;
    const btn = $('save-audit'); btn.disabled = true; btn.textContent = 'Building package…';
    try {
      const ctx = auditContext(), when = new Date();
      const files = [{ name: 'report.pdf', data: await buildPDF(rep) }, { name: 'results.xlsx', data: workbook(rep) }, { name: 'audit-trail.txt', data: AU.trailText(AU.trail(rep, ctx)) }];
      if (state.design) files.push({ name: 'doe-run-sheet.csv', data: D.toCSV(state.design.design, state.design.factors, state.design.response) });
      const manifest = files.map(f => AU.sha256(typeof f.data === 'string' ? AU.utf8(f.data) : f.data) + '  ' + f.name).join('\n') + '\n';
      files.push({ name: 'SHA256SUMS.txt', data: manifest });
      files.push({ name: 'README.txt', data: 'Biopharma Optimization Stats Suite (BOSS) audit package\nCreated ' + when.toISOString() + ' from ' + state.name + '\n\n' +
        'report.pdf        The full report: results, charts, explanations and the audit trail.\n' +
        'results.xlsx      Every number behind the report, one sheet per topic, plus the data analyzed.\n' +
        'audit-trail.txt   Input file fingerprints (SHA-256), merge details, settings, exclusions and the agent log.\n' +
        (state.design ? 'doe-run-sheet.csv The recommended experiment, ready to fill in.\n' : '') +
        'SHA256SUMS.txt    Fingerprints of the files above. Check one with: sha256sum -c SHA256SUMS.txt\n\n' +
        'Everything was computed in the browser. No data was sent to any server or AI service, and nothing was stored by the tool.\n' +
        'This package is your own file: keep or delete it as your data policy requires.\n' });
      download('boss-audit-package.zip', AU.zip(files, when), 'application/zip');
    } catch (e) {
      showError('run-error', 'Could not build the audit package: ' + (e.message || e));
    } finally {
      btn.disabled = false; btn.textContent = 'Download audit package (.zip)';
    }
  }

  // Printing: show every "How to read this" note and use light colors, then put things back.
  let printUndo = null;
  function beforePrint() {
    const closed = Array.from(document.querySelectorAll('details')).filter(d => !d.open);
    closed.forEach(d => { d.open = true; });
    const restore = withLightTheme();
    printUndo = () => { closed.forEach(d => { d.open = false; }); restore(); };
  }
  function afterPrint() { if (printUndo) { printUndo(); printUndo = null; } }

  // ---------- Privacy self-test ----------
  async function selfTest() {
    const out = $('self-test-out');
    out.textContent = 'Testing…';
    const blocked = [];
    const onViolation = e => blocked.push(e.violatedDirective || e.effectiveDirective);
    document.addEventListener('securitypolicyviolation', onViolation);
    // The probes below carry no data. They exist only to show that the browser refuses them.
    let fetchBlocked = false;
    try { await fetch('https://example.com/boss-privacy-self-test', { mode: 'no-cors', cache: 'no-store' }); } catch (e) { fetchBlocked = true; } // PRIVACY-SELF-TEST
    const imgBlocked = await new Promise(res => {
      const img = new Image(); // PRIVACY-SELF-TEST
      const timer = setTimeout(() => res(true), 4000);
      img.onload = () => { clearTimeout(timer); res(false); };
      img.onerror = () => { clearTimeout(timer); res(true); };
      img.src = 'https://example.com/boss-pixel.gif'; // PRIVACY-SELF-TEST
    });
    await new Promise(r => setTimeout(r, 150));
    document.removeEventListener('securitypolicyviolation', onViolation);
    const noCookies = document.cookie === ''; // PRIVACY-SELF-TEST
    const ok = fetchBlocked && imgBlocked;
    const row = (pass, text) => '<li class="' + (pass ? 'pass' : 'fail') + '">' + (pass ? '✓ ' : '✗ ') + text + '</li>';
    out.innerHTML = '<p class="' + (ok ? 'pass' : 'fail') + '">' + (ok ? 'Passed. This page cannot send data out.' : 'Something got through. Please report this.') + '</p><ul>' +
      row(fetchBlocked, 'Data request to an outside server: blocked') +
      row(imgBlocked, 'Tracking pixel (hidden image) to an outside server: blocked') +
      row(noCookies, 'Cookies set by this page: none') +
      row(true, state.table ? 'Your data is held only in this tab\'s memory. Use "Finish and delete my data" when you are done.' : 'No data is held in this tab right now') +
      '</ul><p class="hint">The browser\'s security policy stopped ' + blocked.length + ' attempt' + (blocked.length === 1 ? '' : 's') + (blocked.length ? ' (' + Array.from(new Set(blocked)).join(', ') + ')' : '') + '. That is the lock working.</p>';
  }

  // ---------- Delete ----------
  function deleteData(reason) {
    const had = !!state.table;
    clearTimeout(idleTimer);
    state.table = state.prof = state.report = state.sim = null; state.name = ''; state.sampleTarget = null;
    if (window.MLCampaignUI) window.MLCampaignUI.reset();
    state.sources = []; state.merge = state.pending = state.original = state.roleTarget = state.multiRows = state.runOptions = state.runAt = null;
    resetMerge(); $('m-preview').textContent = ''; $('m-result').innerHTML = ''; $('multi-table').innerHTML = ''; $('multi').open = false;
    if (window.MLSeq) window.MLSeq.clear();
    if (window.MLStab) window.MLStab.clear();
    if (window.MLEquiv) window.MLEquiv.clear();
    if (window.MLGoldenUI) window.MLGoldenUI.clear();
    if (window.MLVarUI) window.MLVarUI.clear();
    if (window.MLLimits) window.MLLimits.clear();
    if (window.MLAsk) window.MLAsk.clear();
    if (window.MLPlasmidUI) window.MLPlasmidUI.clear();
    foldPanels();
    $('sim').innerHTML = ''; $('sim').hidden = true;
    $('paste').value = ''; $('file').value = '';
    ['setup', 'results', 'next', 'progress'].forEach(id => { $(id).hidden = true; });
    ['result-blocks', 'insights', 'tiles', 'agent-log', 'plan', 'profile', 'preview', 'target', 'goal', 'next-steps', 'self-test-out'].forEach(id => { $(id).innerHTML = ''; });
    $('data-summary').textContent = ''; $('target-hint').textContent = '';
    if ($('data-preview')) $('data-preview').innerHTML = '';
    showError('load-error', ''); showError('run-error', '');
    resetDOE();
    ['lsl', 'usl', 'spec-target'].forEach(id => { $(id).value = ''; });
    showError('spc-error', '');
    $('delete-top').hidden = true;
    const note = $('deleted-note');
    note.textContent = had ? (reason || 'Your data and all results have been deleted from this page.') + ' Nothing was saved or sent anywhere.' : 'Cleared. There was no data loaded. Nothing was saved or sent anywhere.';
    note.hidden = false;
    $('load').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  let idleTimer = null;
  function touch() {
    clearTimeout(idleTimer);
    if (state.table && $('auto-delete').checked) idleTimer = setTimeout(() => deleteData('Auto-delete: after 30 minutes without activity, your data and results were removed.'), IDLE_MS);
  }

  // ---------- Wiring ----------
  /* One tool on screen at a time. A selector rather than a row of tabs, because the list
     keeps growing and tabs stop fitting; each panel wraps whole sections, so the sections
     keep their own hidden logic (step 2 appears once data is loaded, and so on) untouched. */
  /* Short names for the button that routes a department job to its tool. The selector's
     own labels name the technique; these name the destination the way somebody arriving
     from a job would recognise it. */
  const TOOLS_SHORT = {
    analyze: 'the ML agent', stability: 'shelf life', golden: 'batch monitoring',
    equivalence: 'method transfer', variance: 'variance & Gage R&R', limits: 'limits & study size',
    plasmid: 'vector selection', sequence: 'the sequence optimizer', privacy: 'privacy & data handling'
  };
  const TOOLS = {
    analyze: 'Regression, classification, clustering and neural networks on a table of data, with the drivers named in plain English and the next experiment designed for you.',
    stability: 'Fit a trend against time, test whether batches may be pooled, and take the date off the confidence limit rather than the fitted line.',
    golden: 'Learn the path your good batches follow, then watch any batch against it: one number for all sensors at once, and the sensor to blame when it drifts.',
    equivalence: 'Two one-sided tests: show that a new lab, instrument or supplier agrees with the old one, within a margin you declare first.',
    variance: 'Split a spread into named sources and see what share each owns, or point the same arithmetic at your own instrument and find out whether the method can see what you are chasing.',
    limits: 'Work out which specification limits your data can actually defend, and how many results a study needs before it is worth running.',
    plasmid: 'Pick the vector for an incoming programme: historical runs, the parts you can order and the protein\u2019s attributes in, a balanced run sheet with predicted titer out.',
    sequence: 'A genetic algorithm searching several competing objectives at once, pointed here at codon optimization.',
    /* A second door onto the ML bench rather than a bench of its own, because Six Sigma mode
       is the same run with more output - it reads rep.importance and rep.doeDet, so splitting
       it off would mean either fitting models nobody asked for or losing the guard that stops
       a capability index being quoted from a designed experiment. What it fixes is the door:
       somebody who wants a capability study should not have to find it behind a radio button
       on a bench called machine learning. The option carries data-opens="analyze" and the
       mode is flipped on arrival. */
    /* Nothing is chosen until somebody chooses. The old default landed everybody on the
       machine-learning bench, which quietly made it the recommended first move for every
       question - and for most people arriving with a process metric it is the second move,
       after asking whether the thing is stable and capable at all. */
    '': 'Pick what you are trying to find out. Six Sigma is first on the list because it is usually the first question: is this process stable, and is it capable against its specification. The machine learning bench answers the next one \u2014 what is driving the result \u2014 and the rest are for a specific job each.',
    sigma: 'Process capability against your specification, the individuals chart with CUSUM and EWMA beside it, count and rare-event charts where the data is counted, box plots by source and Taguchi robustness. The same run as the machine-learning bench, with the process-control output switched on.',
    privacy: 'How the tool keeps your data on your own device, and how to check that for yourself.'
  };

  /* The department workbench: the same nine tools entered from the job rather than the
     method. The selector above names techniques, which is right for someone who already
     knows which one they want and wrong for everyone else - nobody arrives looking for
     "variance components", they arrive because purity moves between resin lots and nobody
     can say whether it is the resin or the assay.

     Every job carries what it will NOT do, and that field is rendered, not tucked into a
     tooltip. Two of these departments want documents written and this page cannot write a
     document; a regulatory writer told otherwise finds out at the worst moment and is then
     right to distrust everything else here. */
  let myDept = '';

  /* The jobs for one department bench, rendered as cards that route straight to the tool.
     This used to be its own panel ("start from my job, not the method") sitting above the
     reference panel, and the split was wrong: somebody who has just chosen their group is
     then asked to choose it again in a different select to see the jobs that belong to it.
     One panel, one choice, and the jobs and the reference material both hang off it. */
  function jobsHtml(bench, tool) {
    if (!bench) return '';
    return (bench.honesty ? '<div class="plain marginal dept-honest"><h4>What this will not do for you</h4><p>' + h(bench.honesty) + '</p></div>' : '') +
      '<div class="dept-jobs">' + bench.jobs.map((j, i) => {
        const here = j.tool === tool;
        return '<div class="dept-job' + (here ? ' here' : '') + '">' +
          '<h4>' + h(j.title) + '</h4>' +
          '<dl><dt>Bring</dt><dd>' + h(j.data) + '</dd>' +
          '<dt>Get back</dt><dd>' + h(j.out) + '</dd>' +
          '<dt class="wont">Will not</dt><dd class="wont">' + h(j.not) + '</dd></dl>' +
          '<div class="row-actions"><button class="btn ' + (here ? '' : 'primary') + '" type="button" data-dept-go="' + h(bench.id) + ':' + i + '">' +
          (here ? 'You are on this tool' : 'Open ' + h(TOOLS_SHORT[j.tool] || j.tool)) + '</button>' +
          (j.sample ? '<button class="btn ghost small" type="button" data-dept-sample="' + h(bench.id) + ':' + i + '">Open with practice data</button>' : '') +
          '</div></div>';
      }).join('') + '</div>' +
      '<p class="apps-note"><b>Across this department.</b> ' + h(bench.cannot) + '</p>';
  }
  const benchesFor = key => (window.MLDepartments || []).filter(b => b.fn && b.fn === key);
  // Benches with no function of their own still need a way in, so they join the same picker.
  const looseBenches = () => (window.MLDepartments || []).filter(b => !b.fn);
  const benchById = id => (window.MLDepartments || []).find(b => b.id === id);

  /* Loads a practice dataset by id, the same way the sample buttons do, so a department
     job can land somebody on the right tool with something already in it. */
  function loadNamedSample(id) {
    const s = (window.MLSamples || []).find(x => x.id === id);
    if (!s) return;
    if (s.files) { loadText(s.files[0].make(), s.files[0].name, s.target); stageSecond(s.files[1].make(), s.files[1].name); return; }
    loadText(s.make(), s.title + ' (practice data)', s.target);
  }

  /* The practice datasets, grouped by the function they belong to.

     They used to be a flat list that toured unrelated industries - injection molding, loyalty
     tiers, customer segments - which made the tool look like a generic demo and left a
     downstream engineer with nothing to click that resembled their own work. Every dataset is
     now a biologics one, tagged with its function, and the groups are shown under those
     headings. Whichever function the person picked in "Where this is used" comes first and is
     marked, because that is the one they will actually open. */
  function renderSamples() {
    const list = window.MLSamples || [];
    const A = window.MLApplications;
    const labelFor = k => (A && A.FUNCTIONS && A.FUNCTIONS.find(f => f[0] === k) || [, k])[1];
    /* One grid rather than a grid per function. Grouping under headings was right about the
       information and wrong about the shape: seven of the nine functions have a single
       dataset, so each got a heading and one card with two thirds of the row empty beneath
       it. Nine cards in one three-column grid fill exactly three rows. The function is still
       on every card, the cards are still ordered so a function's datasets sit together, and
       whichever function you picked still comes first and is marked - so nothing is lost
       except the gaps. */
    const groups = [];
    for (const s of list) if (groups.indexOf(s.fn) < 0) groups.push(s.fn);
    groups.sort((a, b) => (b === myFunction ? 1 : 0) - (a === myFunction ? 1 : 0));
    const ordered = groups.reduce((acc, fn) => acc.concat(list.filter(s => s.fn === fn)), []);
    $('samples').innerHTML = ordered.map(s => {
      const mine = s.fn === myFunction;
      return '<button type="button" class="sample' + (mine ? ' mine' : '') + '" data-sample="' + h(s.id) + '">' +
        '<span class="s-fn">' + h(labelFor(s.fn)) + (mine ? ' &middot; your group' : '') + '</span>' +
        '<b>' + h(s.title) + '</b>' +
        '<span class="s-blurb">' + h(s.blurb) + '</span>' +
        '<span class="k">' + h(s.kind) + '</span></button>';
    }).join('');
  }

  /* Under the selector: what the chosen technique is used for across industries, so the
     page can be shown to people who know the problem but not the method. The write-ups are
     about the technique in general, and each one states what this page actually reads, so
     nobody leaves thinking it does computer vision. */
  function renderApplications(name) {
    const a = window.MLApplications && window.MLApplications[name];
    const el = $('tool-apps');
    if (!a) { el.innerHTML = ''; el.hidden = true; return; }
    el.hidden = false;
    const uses = a.groups.filter(g => !g.note), notes = a.groups.filter(g => g.note);
    const A = window.MLApplications;
    const loose = looseBenches();
    /* One select, carrying the functions and then any bench that has no function of its own,
       so nothing is orphaned by the merge and there is still only one choice to make. */
    const picker = '<div class="apps-pick"><label>Modality <select id="apps-modality">' + optionsFor(A.MODALITIES, myModality) + '</select></label>' +
      '<label>My function or group <select id="apps-function"><option value="">Choose one\u2026</option>' +
      '<optgroup label="Development and manufacturing">' +
      A.FUNCTIONS.map(([k, label]) => '<option value="' + k + '"' + (k === myFunction ? ' selected' : '') + '>' + h(label) + '</option>').join('') +
      '</optgroup>' +
      (loose.length ? '<optgroup label="Other ways in">' + loose.map(b => '<option value="bench:' + h(b.id) + '"' + ('bench:' + b.id === myFunction ? ' selected' : '') + '>' + h(b.name) + '</option>').join('') + '</optgroup>' : '') +
      '</select></label></div>';

    let chosen = '';
    if (myFunction.indexOf('bench:') === 0) {
      const b = benchById(myFunction.slice(6));
      if (b) chosen = '<div class="apps-mine"><div class="mine"><h4>' + h(b.name) + '</h4><p>' + h(b.blurb) + '</p></div></div>' + jobsHtml(b, name);
    } else if (myFunction) {
      const fn = labelOf(A.FUNCTIONS, myFunction);
      const benches = benchesFor(myFunction);
      chosen = (benches.length
        ? '<h4 class="ops-head">Jobs in ' + h(fn) + '<span class="hint">each one opens the tool it needs</span></h4>' +
          benches.map(b => jobsHtml(b, name)).join('')
        : '') +
        methodsHtml(myFunction, fn, name) +
        playbookHtml(myFunction, fn) +
        unitOpsHtml(myFunction, fn);
    }

    el.innerHTML = '<details class="applications" id="apps-details"' + (appsOpen ? ' open' : '') + '>' +
      '<summary><b>Where this can be used</b><span class="hint">' +
      (myFunction ? h(myFunction.indexOf('bench:') === 0 ? (benchById(myFunction.slice(6)) || {}).name || '' : labelOf(A.FUNCTIONS, myFunction)) : 'pick your group and every method is one click away') +
      '</span></summary>' +
      '<div class="apps-body">' + picker + chosen +
      '<h4 class="ops-head">What ' + h(TOOLS_SHORT[name] || name) + ' is used for<span class="hint">' + h(a.tech) + '</span></h4>' +
      '<p class="apps-scope">' + h(a.scope) + ' The uses below are the technique as biologics development and manufacturing applies it, not a claim about what this page reads.</p>' +
      '<div class="apps-grid">' + uses.map(g => '<div class="use"><h4>' + h(g.name) + '</h4><p>' + h(g.text) + '</p></div>').join('') + '</div>' +
      notes.map(g => '<p class="apps-note"><b>' + h(g.name) + '.</b> ' + h(g.text) + '</p>').join('') +
      '</div></details>';

    $('apps-details').addEventListener('toggle', e => { appsOpen = e.target.open; });
    $('apps-modality').addEventListener('change', e => { myModality = e.target.value; renderApplications(name); });
    $('apps-function').addEventListener('change', e => {
      myFunction = e.target.value;
      renderApplications(name);
      // The practice datasets are grouped by function, so they reorder with this choice.
      if ($('samples')) renderSamples();
    });
    // Every route out of this panel, whether it came from a job, a method or a playbook step.
    Array.prototype.forEach.call(el.querySelectorAll('.pb-go, [data-open-tool]'), b => {
      b.addEventListener('click', () => { showTool(b.getAttribute('data-tool') || b.getAttribute('data-open-tool'), true); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    });
    Array.prototype.forEach.call(el.querySelectorAll('[data-dept-go]'), b => b.addEventListener('click', () => {
      const [id, i] = b.getAttribute('data-dept-go').split(':');
      const bench = benchById(id); if (!bench) return;
      showTool(bench.jobs[Number(i)].tool, true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
    Array.prototype.forEach.call(el.querySelectorAll('[data-dept-sample]'), b => b.addEventListener('click', () => {
      const [id, i] = b.getAttribute('data-dept-sample').split(':');
      const bench = benchById(id); if (!bench) return;
      const j = bench.jobs[Number(i)];
      showTool(j.tool, true);
      loadNamedSample(j.sample);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
  }

  /* The part the merge exists for: having said which group you are in, every method is
     listed with what it does for THAT group and a button that opens it. Before this you
     chose your function in one panel to read about it, and then went hunting in the
     technique selector for the name you had just read. */
  function methodsHtml(key, fnLabel, current) {
    const A = window.MLApplications;
    const BF = A.BYFUNCTION || {};
    const rows = Object.keys(TOOLS_SHORT).filter(t => t !== 'privacy' && BF[t] && BF[t][key]);
    if (!rows.length) return '';
    return '<h4 class="ops-head">Every method, for ' + h(fnLabel) + '<span class="hint">what each one does for your group &middot; click to open it</span></h4>' +
      '<ul class="method-list">' + rows.map(t => {
        const here = t === current;
        return '<li class="method' + (here ? ' here' : '') + '"><div class="method-head"><b>' + h(TOOLS_SHORT[t]) + '</b>' +
          (here ? '<span class="pb-tool">open now</span>' : '') + '</div>' +
          '<p>' + h(BF[t][key]) + '</p>' +
          '<div class="row-actions"><button class="btn ' + (here ? 'ghost small' : 'ghost small') + '" type="button" data-open-tool="' + h(t) + '">' +
          (here ? 'Back to it' : 'Open ' + h(TOOLS_SHORT[t])) + '</button></div></li>';
      }).join('') + '</ul>';
  }

  function unitOpsHtml(key, fnLabel) {
    const A = window.MLApplications;
    const ops = (A.UNITOPS[myModality] || {})[key] || [];
    if (!ops.length) return '';
    return '<h4 class="ops-head">Unit operations in ' + h(fnLabel) + '<span class="hint">' + h(labelOf(A.MODALITIES, myModality)) + ' &middot; what machine learning is used for at each step</span></h4>' +
      '<ol class="ops">' + ops.map(([op, ml]) => '<li><b>' + h(op) + '</b><span>' + h(ml) + '</span></li>').join('') + '</ol>';
  }

  /* Open by default. It is now the panel that routes you to a tool rather than reference
     material read once, and on a page called "where to start" that is the point. */
  let appsOpen = true;
  /* Held for the session only. Nothing is stored, so this resets on reload like the data
     does. Modality has no "any": there are two, and every unit operation differs between
     them, so a default of mammalian is more useful than a blank. */
  let myModality = 'mammalian', myFunction = '';
  const optionsFor = (list, chosen, blank) => (blank ? '<option value="">' + blank + '</option>' : '') +
    list.map(([k, label]) => '<option value="' + k + '"' + (k === chosen ? ' selected' : '') + '>' + h(label) + '</option>').join('');
  const labelOf = (list, k) => (list.find(x => x[0] === k) || [, ''])[1];

  /* The depth a group actually arrives wanting: what to do first and why, then the order,
     each step with the measured cost of skipping it, and the gaps named out loud. Folded,
     because it is a page of reading and the tool is what people came for - but folded shut
     rather than left out, since a group that finds the third limitation by itself stops
     believing the first two. */
  function playbookHtml(key, fnLabel) {
    const A = window.MLApplications;
    const pb = A.PLAYBOOKS && A.PLAYBOOKS[key];
    if (!pb) return '';
    const toolName = t => {
      const o = document.querySelector('#tool option[value="' + t + '"]');
      return o ? o.textContent.replace(/\s*\u2014.*$/, '').trim() : t;
    };
    const jump = (t, label) => '<button class="btn ghost small pb-go" type="button" data-tool="' + h(t) + '">' + h(label || ('Open ' + toolName(t))) + '</button>';
    const steps = pb.steps.map((st, i) => '<li class="pb-step">' +
      '<div class="pb-step-head"><span class="pb-num">' + (i + 1) + '</span><b>' + h(st.label) + '</b>' +
      '<span class="pb-tool">' + h(toolName(st.tool)) + '</span></div>' +
      '<p>' + h(st.does) + '</p>' +
      (st.measured ? '<p class="pb-measured"><b>Measured.</b> ' + h(st.measured) + '</p>' : '') +
      '<p class="pb-limit"><b>Where it stops.</b> ' + h(st.limit) + '</p>' +
      '<div class="row-actions">' + jump(st.tool) + '</div></li>').join('');
    return '<details class="playbook" id="pb-details">' +
      '<summary><b>A playbook for ' + h(fnLabel) + '</b><span class="hint">what to do first, in what order, and where it stops</span></summary>' +
      '<div class="pb-body">' +
      '<p class="pb-headline">' + h(pb.headline) + '</p>' +
      '<div class="pb-first"><h4>Start here &mdash; ' + h(pb.first.label) + '</h4><p>' + h(pb.first.why) + '</p>' +
      '<div class="row-actions">' + jump(pb.first.tool) + '</div></div>' +
      '<h4 class="pb-head">Then, in this order</h4><ol class="pb-steps">' + steps + '</ol>' +
      '<h4 class="pb-head">What this tool will not do for ' + h(fnLabel) + '</h4>' +
      '<ul class="pb-gaps">' + pb.gaps.map(g => '<li>' + h(g) + '</li>').join('') + '</ul>' +
      '<p class="hint">Every figure above is measured by this tool\u2019s own test suite on data built so the right answer is known in advance, not quoted from a textbook.</p>' +
      '</div></details>';
  }

  /* Two pages, not one scroll. The tool page carries the technique selector and the tool,
     and nothing else: every time something useful got added - the plain-English front door,
     the department workbenches, the applications panel, nine practice datasets - it went
     above the tool, and the thing people came for ended up below three screens of material
     they had already read once. All of that now lives on its own page.

     Everything that routes to a tool goes through showTool, so the advisor (which routes by
     setting the hash), the department job buttons, the privacy lock link and the selector
     all land on the tool page without each needing to know about pages. */
  /* ---------- How to use this: the loop, and whether you may stop ----------

     One pass answers a question; four passes change a process. The phases are the method,
     and they are cheap to print. The part worth building is the panel underneath, which
     reads the run currently in memory and says which turn you are on and which exit
     criteria are actually met - because "stop when the error plateaus" is advice, and
     "your last round moved RMSE by 0.004, so another one will not pay" is a decision.

     Where a gate cannot be computed it says what is missing rather than showing a dash: a
     blank reads as a failure, and the usual reason a gate is blank is that nobody entered
     the specification limits it needs. */
  const PHASES = [
    { n: 1, name: 'Discover', tag: 'Passive data',
      what: 'Drop in messy historical logs, text attributes and assay results. It cleans, handles the skew, picks the algorithm, flags collinearity and ranks the drivers.',
      tool: 'analyze', cta: 'Load historical data' },
    { n: 2, name: 'Disentangle', tag: 'First-pass DOE',
      what: 'History shows correlation, not cause. It fills in a run sheet - factorial, fractional or a definitive screen - that moves factors independently so the effects separate.',
      tool: 'analyze', cta: 'Open the DOE builder' },
    { n: 3, name: 'Refine', tag: 'Feedback',
      what: 'You run the plate or the pilot. The new results go back in beside the old passive data, matched by column name so a reordered sheet still lands correctly.',
      tool: 'analyze', cta: 'Add a round of results' },
    { n: 4, name: 'Converge', tag: 'Re-optimization',
      what: 'The intervals tighten, the confounding untangles, and screening gives way to response-surface work: curvature, sweet spots, and a window rather than a setting.',
      tool: 'analyze', cta: 'See what another round buys' }
  ];

  // Which turn of the loop the session is actually on, from what is in memory.
  function currentPhase() {
    const r = state.report;
    if (!state.table) return 1;
    if (!r) return 1;
    const camp = window.MLCampaignRun;
    if (camp && camp.rounds > 1) return 4;
    if (state.design || (r.doe && r.doe.terms)) return 3;
    return 2;
  }

  function renderHow() {
    const host = $('loop-steps');
    if (!host) return;
    const at = currentPhase();
    host.innerHTML = PHASES.map(p => '<li class="loop-step' + (p.n === at ? ' on' : '') + '">' +
      '<div class="loop-head"><span class="loop-num">' + p.n + '</span><b>' + h(p.name) + '</b>' +
      '<span class="pb-tool">' + h(p.tag) + '</span>' + (p.n === at ? '<span class="loop-here">you are here</span>' : '') + '</div>' +
      '<p>' + h(p.what) + '</p>' +
      '<div class="row-actions"><button class="btn ghost small" type="button" data-phase-go="' + p.n + '">' + h(p.cta) + '</button></div>' +
      '</li>').join('');
    Array.prototype.forEach.call(document.querySelectorAll('.cycle .cyc-node'), g => {
      g.classList.toggle('on', Number(g.getAttribute('data-phase')) === at);
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-phase-go]'), b => {
      b.addEventListener('click', () => {
        const p = PHASES[Number(b.getAttribute('data-phase-go')) - 1];
        showTool(p.tool, true);
        showPage('tools', true);
        const target = p.n === 1 ? 'load' : p.n === 2 ? 'doe-wrap' : p.n >= 3 ? 'campaign' : 'load';
        const el = $(target);
        if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      });
    });
    renderGates();
    renderMethods();
  }

  /* The reference card. Rendered rather than written into the markup so the tool names come
     from the selector itself and cannot drift from it, and so a method added to the data
     file appears here without anybody remembering to edit the page. */
  function renderMethods() {
    const M = window.MLMethods;
    const host = $('methods-table'), nn = $('nonnormal');
    if (!M || !host) return;
    const KIND = { stats: ['Statistics', 'A named procedure with assumptions you can check and an exact answer'],
      ml: ['Machine learning', 'Fitted from your rows and judged on rows it never saw'],
      both: ['Both', 'One is used to qualify the other'] };
    const toolName = t => {
      const o = document.querySelector('#tool option[value="' + t + '"]');
      return o ? o.textContent.replace(/\s*\u2014.*$/, '').trim() : t;
    };
    /* Two passes over the same eight benches, because two different questions get asked.
       The table answers "which one do I open, and what do I need to have" in a row you can
       scan; the cards answer "what does it assume and how is it judged" for the methods
       inside each bench. A cell is labelled rather than positional so the table can stack on
       a phone without the columns losing their meaning. */
    const cell = (label, text) => '<td data-label="' + h(label) + '">' + h(text) + '</td>';
    const table = !M.TOOLS ? '' : '<div class="tool-table-wrap"><table class="tool-table">' +
      '<caption class="sr-only">Every tool with what it is, where it is used, what data it takes and what it returns</caption>' +
      '<thead><tr><th scope="col">Tool</th><th scope="col">What it is</th><th scope="col">Where it is used</th>' +
      '<th scope="col">Input data</th><th scope="col">What you get out</th></tr></thead><tbody>' +
      M.TOOLS.map(t => '<tr><th scope="row" data-label="Tool"><button class="btn ghost small" type="button" data-open-tool="' + h(t.tool) + '">' +
        h(toolName(t.tool)) + '</button></th>' + cell('What it is', t.what) + cell('Where it is used', t.where) +
        cell('Input data', t.inputs) + cell('What you get out', t.outputs) + '</tr>').join('') +
      '</tbody></table></div>';

    host.innerHTML = table + '<h4 class="sub-sub-head">Method by method</h4>' +
      '<p class="hint">The same benches opened up: the named procedure inside each one, what its chart is for, and what it does when the data is not bell-shaped.</p>' +
      '<div class="method-cards">' + M.METHODS.map(m =>
      '<div class="mcard"><div class="mcard-head"><b>' + h(m.name) + '</b>' +
      '<span class="kind-tag k-' + h(m.kind) + '" title="' + h(KIND[m.kind][1]) + '">' + h(KIND[m.kind][0]) + '</span>' +
      '<button class="btn ghost small" type="button" data-open-tool="' + h(m.tool) + '">' + h(toolName(m.tool)) + '</button></div>' +
      '<dl><dt>Method</dt><dd>' + h(m.method) + '</dd>' +
      '<dt>Answers</dt><dd>' + h(m.answers) + '</dd>' +
      '<dt>What the chart does</dt><dd>' + h(m.chart) + '</dd>' +
      '<dt>Where it can be used</dt><dd>' + h(m.where) + '</dd>' +
      '<dt>Input data</dt><dd>' + h(m.inputs) + '</dd>' +
      '<dt>What you get out</dt><dd>' + h(m.outputs) + '</dd>' +
      '<dt>Judged by</dt><dd>' + h(m.judged) + '</dd>' +
      '<dt class="shape">If the data is not normal</dt><dd class="shape">' + h(m.shape) + '</dd></dl></div>').join('') + '</div>';
    Array.prototype.forEach.call(host.querySelectorAll('[data-open-tool]'), b => {
      b.addEventListener('click', () => { showTool(b.getAttribute('data-open-tool'), true); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    });
    if (nn) {
      const N = M.NONNORMAL;
      nn.innerHTML = '<p class="lede">' + h(N.lead) + '</p>' +
        '<dl class="qa">' + N.rows.map(r => '<dt>' + h(r.q) + '</dt><dd>' + h(r.a) + '</dd>').join('') + '</dl>' +
        '<p class="apps-note"><b>The pattern.</b> ' + h(N.close) + '</p>';
    }
  }

  /* The three exit criteria, each either a measured verdict or a plain statement of what it
     needs. Nothing here is a target the tool invented: the goal comes from your spec limits,
     the plateau from the projection the campaign panel already fits, and 1.33 is the
     capability convention, named as a convention. */
  function renderGates() {
    const host = $('exit-gates');
    if (!host) return;
    const r = state.report;
    const cap = r && r.spc && r.spc.capability ? r.spc.capability : null;
    const gates = [];

    // 1. Is the goal met?
    if (!r) gates.push({ ok: null, name: 'The goal is met', val: 'no run yet', why: 'Load data and run the agent, then this reads your own specification limits rather than a number the tool chose.' });
    else if (!cap) gates.push({ ok: null, name: 'The goal is met', val: 'needs spec limits', why: 'Turn on Six Sigma mode and enter the limits you must hold. Without them there is no definition of "met" to check against, and the tool will not invent one.' });
    else {
      const out = cap.observedPct;
      gates.push({ ok: out === 0, name: 'The goal is met', val: pct(1 - out) + ' inside spec',
        why: out === 0 ? 'Every row in hand sits inside your limits. That is the observed count, which needs no distribution assumption.'
          : Math.round(out * cap.n) + ' of ' + cap.n + ' rows sit outside your limits, so the process is not yet hitting the target you set.' });
    }

    /* 2. Have the returns diminished? The projection is fitted from the campaign's own
          subsample curve, so the gain is the difference between the RMSE measured now and
          the RMSE projected after another round - not a rule of thumb about round counts. */
    const camp = window.MLCampaignRun || null;
    const now = camp && camp.base ? camp.base.rmse : null;
    const after = camp && camp.projection ? camp.projection.rmse : null;
    if (!camp || !camp.projection || now === null || after === null || !isFinite(now) || !(now > 0)) {
      gates.push({ ok: null, name: 'Error has plateaued', val: 'needs two rounds',
        why: 'Stack a second round of results in step 6 and a learning curve is fitted to your own data, so the next round is costed before it is booked rather than guessed at.' });
    } else {
      const share = (now - after) / now;
      const flat = camp.projection.flat === true;
      const plateau = flat || share < 0.05;
      /* One round is a forecast, not a plateau. The curve is fitted by subsampling whatever
         is in hand, so with a single round it can legitimately project no gain - and
         reporting that as "stop experimenting" before a single experiment has been run is
         exactly the wrong conclusion to hand somebody. It is shown, and marked unconfirmed. */
      const confirmed = camp.rounds > 1;
      gates.push({ ok: confirmed ? plateau : null, name: 'Error has plateaued',
        val: (flat ? 'curve is flat' : fmt(now) + ' \u2192 ' + fmt(after)) + (confirmed ? '' : ' (forecast)'),
        why: 'Fitted from the subsample curve of the data in hand and clamped so it can never promise better than today\u2019s measurement. ' +
          (confirmed
            ? (flat ? 'Across ' + camp.rounds + ' rounds the curve is flat: more runs of the same kind are not expected to help, which is a finding rather than a failure to produce one.'
                    : 'Another ' + camp.projection.addN + ' runs project ' + pct(share) + ' less error. Under about 5% is where experimenting stops paying.')
            : 'This is from one round only, so it is a forecast rather than a plateau: the curve was traced by subsampling the rows you already have, and the test of it is one real round of new runs. Stack a second round in step 6 to settle it.') });
    }

    // 3. Is the process capable?
    if (!cap || cap.Cpk === null) gates.push({ ok: null, name: 'The process is capable', val: 'needs spec limits', why: 'Cpk is a ratio of your tolerance to your spread, so it needs both limits. It is reported whatever the shape of the data, unlike the PPM and sigma figures.' });
    else gates.push({ ok: cap.Cpk >= 1.33, name: 'The process is capable', val: 'Cpk ' + fmt(cap.Cpk),
      why: 'The 1.33 bar is the industry convention rather than a regulatory limit. ' +
        (cap.tailsUsable === false ? 'The tail figures for this data are withheld because it failed its normality test, so read Cpk and the observed count, not a PPM.' : 'Normality passed, so the PPM and sigma figures beside it can be read too.') });

    const badge = g => (g.ok === true ? 'capable' : g.ok === false ? 'not' : 'marginal');
    const mark = g => (g.ok === true ? 'met' : g.ok === false ? 'not met' : 'not measured');
    host.innerHTML = '<div class="gates">' + gates.map(g =>
      '<div class="gate ' + badge(g) + '"><div class="gate-head"><b>' + h(g.name) + '</b><span class="verdict ' + badge(g) + '">' + mark(g) + '</span></div>' +
      '<div class="gate-val">' + h(String(g.val)) + '</div><p>' + h(g.why) + '</p></div>').join('') + '</div>' +
      '<p class="hint">All three are read from the run in memory. Nothing is stored, so they reset when you clear your data, and they are decision support rather than a release decision.</p>';
  }

  const PAGES = [
    // The tool page's address is the tool itself, so #variance still works as a deep link.
    { id: 'tools', hash: null },
    { id: 'how', hash: 'how-to-use-this' },
    { id: 'apps', hash: 'where-to-start' },
    { id: 'data', hash: 'practice-data' }
  ];
  function showPage(name, push) {
    if (!PAGES.some(p => p.id === name)) name = 'tools';
    for (const pg of PAGES) {
      $('page-' + pg.id).hidden = pg.id !== name;
      $('page-btn-' + pg.id).setAttribute('aria-selected', String(pg.id === name));
    }
    // The loop panel reads live state, so it is rebuilt each time it is opened.
    if (name === 'how') renderHow();
    if (push) {
      const pg = PAGES.find(x => x.id === name);
      history.replaceState(null, '', '#' + (pg.hash || $('tool').value));
    }
  }

  const TOOL_NAMES = Object.keys(TOOLS);
  /* Which panel an option opens, read off the option itself rather than kept in a second list
     here. An option with no data-opens is its own panel, which is every one but sigma. */
  const opensOf = name => {
    const o = $('tool') && $('tool').querySelector('option[value="' + name + '"]');
    return (o && o.getAttribute('data-opens')) || name;
  };
  const PANELS = TOOL_NAMES.filter(n => n && opensOf(n) === n);
  function showTool(name, push) {
    if (!TOOL_NAMES.includes(name)) name = '';
    const panel = opensOf(name);
    // Asking for a tool means wanting to see it, wherever the request came from.
    showPage('tools', false);
    if ($('tool').value !== name) $('tool').value = name;
    $('tool-desc').textContent = TOOLS[name];
    renderApplications(panel);
    /* With nothing chosen every panel is hidden and the prompt above is the whole page, which
       is the point: a bench on screen is a recommendation, and recommending one before the
       question is known is how somebody ends up fitting models to a metric they have not yet
       established is stable. */
    PANELS.forEach(n => { $('tab-' + n).hidden = !panel || n !== panel; });
    if ($('tool-unchosen')) $('tool-unchosen').hidden = !!panel;
    /* The two doors onto the ML bench set the mode they were opened for. Clicking through to
       the plain bench after using the Six Sigma one should not leave the spec panel up, and
       arriving at the Six Sigma one should not require finding the radio. */
    if (panel === 'analyze') {
      const want = name === 'sigma' ? 'sigma' : 'ml';
      const radio = document.querySelector('input[name="mode"][value="' + want + '"]');
      if (radio && !radio.checked) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    // A link can be shared or bookmarked straight to one tool.
    if (push && location.hash.slice(1) !== name) history.replaceState(null, '', name ? '#' + name : location.pathname);
  }
  function initTools() {
    $('tool').addEventListener('change', () => { showTool($('tool').value, true); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    /* The only route from the tool page to the data, now that the datasets live elsewhere.
       Without it somebody who arrives with nothing to load has to work out that another tab
       exists. */
    $('go-practice').addEventListener('click', () => { showPage('data', true); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('go-start').addEventListener('click', () => { showPage('apps', true); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    if ($('hero-how')) $('hero-how').addEventListener('click', () => { showPage('how', true); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    PAGES.forEach(pg => $('page-btn-' + pg.id).addEventListener('click', () => {
      showPage(pg.id, true); window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
    document.querySelectorAll('[data-tab-link]').forEach(a => a.addEventListener('click', () => showTool(a.getAttribute('data-tab-link'), true)));
    /* Every page is addressable, or none of them can be shared. A tool's own id is its
       address; the other pages have names of their own. */
    const routeTo = hash => {
      const pg = PAGES.find(x => x.hash && x.hash === hash);
      if (!pg) { showTool(hash, false); return; }
      // showTool would pull us back to the tool page, so the tool is set first and the page after.
      showTool($('tool').value, false);
      showPage(pg.id, false);
    };
    window.addEventListener('hashchange', () => routeTo(location.hash.slice(1)));
    routeTo(location.hash.slice(1));
  }

  function init() {
    initTools();
    C.bindTips($('tip'));
    renderSamples();
    $('samples').addEventListener('click', e => {
      const b = e.target.closest('[data-sample]'); if (!b) return;
      const s = window.MLSamples.find(x => x.id === b.getAttribute('data-sample'));
      /* The datasets sit on the "where to start" page and the tool is on the other one, so
         loading one has to carry you across. Leaving somebody on a page whose button just
         did something invisible elsewhere is the worst of both layouts. */
      /* Loading a dataset is not choosing a technique, so this carries you to the tool page
         without picking one - the prompt there says the data is loaded and waiting. Jumping
         straight to the machine learning bench made it the implied first move for every
         practice set, which is the thing the unchosen default exists to stop. */
      showTool('', true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (s.files) { loadText(s.files[0].make(), s.files[0].name, s.target); stageSecond(s.files[1].make(), s.files[1].name); return; }
      loadText(s.make(), s.title + ' (practice data)', s.target);
    });
    $('file').addEventListener('change', e => readFile(e.target.files[0]));
    const drop = $('drop');
    ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('over')));
    drop.addEventListener('drop', e => { e.preventDefault(); readFile(e.dataTransfer.files[0]); });
    $('use-paste').addEventListener('click', () => { const t = $('paste').value; if (t.trim()) { $('paste').value = ''; loadText(t, 'Pasted data'); } else showError('load-error', 'Paste some data first.'); });
    ['clear', 'delete-top', 'delete-bottom'].forEach(id => $(id).addEventListener('click', () => deleteData()));
    $('target').addEventListener('change', renderProfile);
    $('multi-table').addEventListener('input', e => {
      const i = e.target.getAttribute('data-m'); if (i === null || !state.multiRows) return;
      const r = state.multiRows.rows[Number(i)], k = e.target.getAttribute('data-k');
      if (k === 'on') r.on = e.target.checked;
      else if (k === 'goal') { r.goal = e.target.value; if (r.goal === 'target' && (r.target === null || r.target === '')) r.target = Number(((r.low + r.high) / 2).toPrecision(4)); drawMulti(); }
      else if (k === 'weight') r.weight = Number(e.target.value);
      else r[k] = e.target.value === '' ? null : Number(e.target.value);
    });
    $('multi-table').addEventListener('change', e => { if (e.target.tagName === 'SELECT') e.target.dispatchEvent(new Event('input', { bubbles: true })); });
    $('multi-add').addEventListener('change', e => {
      const c = state.prof.columns.find(x => x.name === e.target.value); if (!c || !state.multiRows) return;
      const d = multiDefaults(c, A.columnRoles(state.prof), false); d.on = true;
      state.multiRows.rows.push(d); drawMulti();
    });
    $('file2').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => stageSecond(String(rd.result), f.name); rd.readAsText(f); });
    ['m-left', 'm-right', 'm-how'].forEach(id => $(id).addEventListener('change', () => previewJoin()));
    $('m-join').addEventListener('click', doJoin);
    $('m-result').addEventListener('click', e => { if (e.target.id === 'm-undo') undoJoin(); });
    document.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener('change', () => { if (state.prof) renderProfile(); }));
    $('task').addEventListener('change', renderProfile);
    $('run').addEventListener('click', runAgent);
    $('download-report').addEventListener('click', () => state.report && download('boss-report.html', reportHTML(state.report), 'text/html'));
    $('print').addEventListener('click', () => window.print());
    $('save-pdf').addEventListener('click', savePDF);
    $('save-excel').addEventListener('click', saveExcel);
    $('save-audit').addEventListener('click', saveAuditPackage);
    $('plan').addEventListener('change', e => { if (e.target.id === 'plan-target' || e.target.id === 'plan-from') retargetFrom(e.target.id); });
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    $('self-test').addEventListener('click', selfTest);
    ['pointerdown', 'keydown', 'scroll', 'input'].forEach(t => document.addEventListener(t, touch, { passive: true, capture: true }));
    $('auto-delete').addEventListener('change', touch);
    // Leaving the page wipes the data, so the browser's back/forward cache cannot bring it back.
    window.addEventListener('pagehide', () => { if (state.table) deleteData(); });

    state.factors = DEFAULT_FACTORS();
    renderFactors();
    $('factors').addEventListener('input', e => {
      const i = e.target.getAttribute('data-i'); if (i === null) return;
      state.factors[Number(i)][e.target.getAttribute('data-k')] = e.target.value;
    });
    $('factors').addEventListener('click', e => {
      const r = e.target.closest('[data-remove]'); if (!r) return;
      if (state.factors.length <= 1) return showError('doe-error', 'A design needs at least one factor.');
      state.factors.splice(Number(r.getAttribute('data-remove')), 1); renderFactors();
    });
    $('add-factor').addEventListener('click', () => {
      if (state.factors.length >= 19) return showError('doe-error', 'Up to 19 factors are supported.');
      state.factors.push({ name: 'Factor ' + (state.factors.length + 1), low: -1, high: 1 }); renderFactors();
    });
    // Switching to or from a mixture changes what the two level columns even mean, so the
    // table is relabelled rather than left saying "low level" about a proportion.
    $('design-type').addEventListener('change', () => { designPurpose(); renderFactors(); });
    $('mix-fit').addEventListener('click', fitMixture);
    $('mix-example').addEventListener('click', () => { $('mix-data').value = mixtureExample(); fitMixture(); });
    $('generate').addEventListener('click', () => generateDesign());
  }
  init();
})();
