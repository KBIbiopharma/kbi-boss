/* ML Agent orchestrator: decides what kind of problem the data is, runs every suitable
   model with cross-validation, picks the winner, and writes plain-language findings and
   next steps (including a recommended DOE). Rule-based: no LLM, no network, no storage. */
(function (root) {
  'use strict';
  const E = root.MLEngine || require('./engine.js');
  const D = root.MLDoe || require('./doe.js');
  const S = root.MLSpc || require('./spc.js');
  const UNC = root.MLUncertainty || require('./uncertainty.js');
  const { range, mean, rng, shuffle, pearson } = E;

  const MAX_ROWS = 3000;
  const TARGET_NAME = /^(y|target|response|output|outcome|label|class|result|yield|quality|pass|passfail|pass\/fail|defects?|score|price|sales|revenue)$/i;
  const tick = () => new Promise(r => setTimeout(r, 0));

  /* Column roles from header names (and a look at the values), so analytical and QC files
     need no manual setup: id / metadata, date or time, result (with a priority for picking
     the target), analytical measurement, or process input. */
  const RESULT_RULES = [
    [1, /purity|main (band|peak)|monomer|main species/, 'purity / main band'],
    [2, /yield|titer|titre|productivity|output rate/, 'yield / titer'],
    [3, /potency|assay|bioactivity|bioassay/, 'potency / assay'],
    [4, /\bhmw|high mol|aggregat|\blmw|low mol|fragment|impurit|clipped|degradant/, 'impurity'],
    [5, /viab|\bvcd\b|endotoxin|bioburden|osmolal|\bhcp\b|host cell|residual dna|charge variant|acidic|basic variant/, 'quality attribute'],
    [6, /defect|scrap|reject|pass|fail|result|status|grade|outcome|quality|disposition/, 'outcome']
  ];
  const MEASUREMENT = /retention time|\brt\b|molecular weight|\bmw\b|\bkda\b|band size|\bmass\b|migration|rf value/;
  const META = /^replicates?\b|^n$|^count$|analyst|operator initials|instrument id|^lane$|^well$/;
  // Dates: the name says so (not words inside a rate like "visits per month"), or the values look like dates.
  const DATE_NAME = /\bdate\b|time ?stamp|datetime|^(month|year|week|day|time|period|at)$/;
  const DATE_VALUE = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4})([ t]\d{1,2}:\d{2})?/i;
  const looksLikeDates = c => { const v = (c.values || []).filter(x => x !== null).slice(0, 200); return v.length > 0 && v.filter(x => DATE_VALUE.test(String(x).trim())).length / v.length >= 0.8; };
  const words = name => ' ' + String(name).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim() + ' ';
  function columnRoles(prof) {
    const out = {};
    for (const c of prof.columns) {
      const w = words(c.name);
      let role = 'input', label = c.kind === 'categorical' ? 'category input' : 'process input', priority = 99;
      if (c.kind === 'id') { role = 'id'; label = 'ID'; }
      else if (META.test(w.trim())) { role = 'meta'; label = 'record info'; }
      // Numeric columns named Time or Day are usually process settings (hold time, cure time).
      else if (c.kind !== 'numeric' && ((DATE_NAME.test(w.trim()) && !/retention/.test(w)) || looksLikeDates(c))) { role = 'time'; label = 'date / time'; }
      else if (MEASUREMENT.test(w) || MEASUREMENT.test(' ' + c.name.toLowerCase().replace(/[^a-z0-9%]+/g, ' ') + ' ')) { role = 'measurement'; label = 'analytical measurement'; priority = 7; }
      else for (const [pr, re, lab] of RESULT_RULES) if (re.test(w)) { role = 'result'; label = 'result: ' + lab; priority = pr; break; }
      out[c.name] = { role, label, priority };
    }
    return out;
  }
  function guessTarget(prof) {
    const usable = prof.columns.filter(E.isUsableFeature);
    const explicit = usable.find(c => /^(y|target|response|label|outcome)$/i.test(c.name.trim()));
    if (explicit) return explicit.name;
    const roles = columnRoles(prof);
    const results = usable.filter(c => roles[c.name].role === 'result').sort((a, b) => roles[a.name].priority - roles[b.name].priority);
    if (results.length) return results[0].name;
    const byName = usable.find(c => TARGET_NAME.test(c.name.trim()));
    if (byName) return byName.name;
    return usable.length ? usable[usable.length - 1].name : null;
  }
  // Other measured results should not be inputs: measured on the same sample, they leak.
  function otherResults(prof, targetName) {
    const roles = columnRoles(prof);
    return prof.columns.filter(c => c.name !== targetName && E.isUsableFeature(c) && ['result', 'measurement', 'meta', 'time'].includes(roles[c.name].role)).map(c => c.name);
  }
  function decideTask(col, override) {
    if (override === 'regression' && col.kind === 'numeric') return 'regression';
    if (override === 'classification') return 'classification';
    if (col.kind === 'categorical') return 'classification';
    return col.unique <= 2 ? 'classification' : 'regression';
  }
  function fmt(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return '–';
    const a = Math.abs(v);
    const digits = d !== undefined ? d : a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 3;
    return Number(v).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  }
  function pct(v) { return isFinite(v) ? Math.round(v * 100) + '%' : '–'; }

  /* table: {columns, rows}; options: {target ('' = auto, '__none__' = find patterns),
     task ('auto'|'regression'|'classification'), exclude: [names], goal ('max'|'min'), seed } */
  async function run(table, options, onProgress) {
    options = options || {};
    const progress = onProgress || (() => {});
    const seed = options.seed || 42;
    const log = [];
    const say = (text, kind) => { log.push({ text, kind: kind || 'step' }); progress({ log: log.slice() }); };

    const prof = E.profile(table);
    if (!prof.nRows) throw new Error('No data rows found. Check that the first row holds column names.');
    say('Read ' + prof.nRows.toLocaleString() + ' rows and ' + prof.nCols + ' columns.');
    const exclude = new Set(options.exclude || []);
    const report0 = {};
    const dropped = [];
    // When the caller does not pass its own exclusions, other results are set aside automatically.
    const preTarget = options.target === '__none__' ? null : options.target || guessTarget(prof);
    const roleOut = new Set(options.exclude === undefined && preTarget ? otherResults(prof, preTarget) : (options.roleExclude || []));
    const roles = columnRoles(prof);
    // Every result being optimized together is an output, never an input.
    if (options.multi && options.multi.responses) options.multi.responses.forEach(r => { if (r.name !== preTarget) roleOut.add(r.name); });
    roleOut.forEach(n => exclude.add(n));
    report0.roles = roles;
    for (const c of prof.columns) {
      if (roleOut.has(c.name)) dropped.push({ name: c.name, reason: roles[c.name].role === 'meta' || roles[c.name].role === 'time' ? 'is record information, not a process input' : 'is another measured result, so using it as an input would leak the answer' });
      else if (exclude.has(c.name)) dropped.push({ name: c.name, reason: 'excluded by you' });
      else if (c.kind === 'id') dropped.push({ name: c.name, reason: 'looks like an ID or row counter' });
      else if (c.kind === 'constant') dropped.push({ name: c.name, reason: 'has only one value' });
      else if (c.kind === 'empty') dropped.push({ name: c.name, reason: 'is empty' });
      else if (c.kind === 'text') dropped.push({ name: c.name, reason: 'is free text or has too many categories' });
    }
    if (dropped.length) say('Set aside ' + dropped.length + ' column' + (dropped.length > 1 ? 's' : '') + ': ' + dropped.map(d => d.name + ' (' + d.reason + ')').join('; ') + '.');

    let targetName = options.target === '__none__' ? null : options.target || guessTarget(prof);
    const targetCol = targetName ? prof.columns.find(c => c.name === targetName) : null;
    if (targetName && !targetCol) throw new Error('Target column "' + targetName + '" not found.');
    if (targetCol && !E.isUsableFeature(targetCol)) throw new Error('"' + targetName + '" cannot be predicted: it ' + (dropped.find(d => d.name === targetName) || { reason: 'is not usable' }).reason + '.');
    let features = prof.columns.filter(c => c !== targetCol && E.isUsableFeature(c) && !exclude.has(c.name));
    if (targetCol) {
      const leaks = findLeaks(prof, targetCol, features, decideTask(targetCol, options.task));
      for (const l of leaks) {
        dropped.push({ name: l.name, reason: 'predicts ' + targetCol.name + ' almost perfectly on its own (' + l.why + '), so it is probably a copy of the result or recorded after it' });
        say('Set aside "' + l.name + '": it predicts "' + targetCol.name + '" almost perfectly on its own (' + l.why + '). That usually means it is a copy of the result or recorded after the fact (data leakage), which would make every model look perfect.', 'result');
      }
      features = features.filter(c => !leaks.some(l => l.name === c.name));
      report0.leaks = leaks;
    }
    if (!features.length) throw new Error('No usable input columns left. Include at least one numeric or category column besides the target.');

    const report = Object.assign(report0, { profile: prof, dropped, log, features: features.map(c => c.name), goal: options.goal || 'max', seed });
    report.correlations = correlations(prof, features.concat(targetCol && targetCol.kind === 'numeric' ? [targetCol] : []));
    /* Variance inflation on the inputs alone. A pairwise correlation sees two columns at a
       time, and the case that bites is the one it cannot: inputs that are each mildly
       correlated but jointly almost determine one another. */
    report.vif = E.vif(features, range(prof.nRows));

    if (!targetCol) {
      report.task = 'clustering';
      say('No target chosen, so this is unsupervised learning: looking for natural groups, hidden structure and unusual rows.');
      await tick();
      report.clustering = await cluster(prof, features, seed, say);
    } else {
      report.task = decideTask(targetCol, options.task);
      report.target = targetCol.name;
      say('Target is "' + targetCol.name + '" (' + (targetCol.kind === 'numeric' ? 'numeric, ' + targetCol.unique + ' distinct values' : targetCol.unique + ' categories') + '), so this is ' +
        (report.task === 'regression' ? 'a regression problem: predict a number.' : 'a classification problem: predict a category.'));
      if (report.task === 'classification' && targetCol.unique > 20) throw new Error('"' + targetCol.name + '" has ' + targetCol.unique + ' categories. Pick a target with 20 or fewer, or treat it as a number.');
      await supervised(report, prof, targetCol, features, seed, say, progress);
    }
    if (options.sixSigma && targetCol) {
      report.spc = sixSigma(report, prof, targetCol, features, options.sixSigma);
      say('Six Sigma mode: ' + (report.spc.capability ? 'capability against your spec limits, ' : report.spc.attribute ? 'defect rate and sigma level, ' : '') + (report.spc.imr ? 'an I-MR control chart, ' : '') + (report.spc.boxes ? 'box plots' : '') + (report.spc.taguchi ? ' and Taguchi signal-to-noise' : '') + '.', 'result');
    }
    if (options.multi && options.multi.responses && options.multi.responses.length >= 2 && report.task === 'regression') {
      report.desirability = await desirability(report, prof, features, options.multi, seed, say, progress);
    }
    report.actionPlan = actionPlan(report);
    report.insights = insights(report, prof, targetCol, features);
    report.nextSteps = nextSteps(report, prof, targetCol, features);
    say('Done. Findings and next steps are ready.', 'done');
    return report;
  }

  /* Data leakage: an input that on its own almost exactly reproduces the target (for example
     "alive" next to "survived", or "total_price" next to "price"). */
  function findLeaks(prof, target, features, task) {
    const out = [];
    const rows = range(prof.nRows).filter(r => target.values[r] !== null);
    if (rows.length < 20) return out;
    for (const c of features) {
      const rr = rows.filter(r => c.values[r] !== null);
      if (rr.length < 0.8 * rows.length) continue;
      if (task === 'regression') {
        if (c.kind !== 'numeric') continue;
        const r = pearson(rr.map(i => c.values[i]), rr.map(i => target.values[i]));
        if (Math.abs(r) >= 0.995) out.push({ name: c.name, why: 'correlation ' + r.toFixed(3) });
      } else {
        if (c.kind === 'numeric' && c.unique > 20) continue;
        // Purity: share of rows whose class is the most common class for their value of c.
        const tab = {};
        for (const i of rr) { const k = String(c.values[i]), t = String(target.values[i]); (tab[k] = tab[k] || {})[t] = (tab[k][t] || 0) + 1; }
        const keys = Object.keys(tab);
        if (keys.length > Math.max(2, rr.length / 10)) continue;
        const hit = keys.reduce((s, k) => s + Math.max(...Object.values(tab[k])), 0) / rr.length;
        const base = Math.max(...Object.values(rr.reduce((m, i) => { const t = String(target.values[i]); m[t] = (m[t] || 0) + 1; return m; }, {}))) / rr.length;
        if (hit >= 0.99 && base < 0.95) out.push({ name: c.name, why: pct(hit) + ' match' });
      }
    }
    return out;
  }

  function correlations(prof, cols) {
    const num = cols.filter(c => c.kind === 'numeric');
    const out = [];
    for (let i = 0; i < num.length; i++) for (let j = i + 1; j < num.length; j++) {
      const rows = range(prof.nRows).filter(r => num[i].values[r] !== null && num[j].values[r] !== null);
      if (rows.length < 5) continue;
      out.push({ a: num[i].name, b: num[j].name, r: pearson(rows.map(r => num[i].values[r]), rows.map(r => num[j].values[r])) });
    }
    return out.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  }

  async function supervised(report, prof, targetCol, features, seed, say, progress) {
    const task = report.task;
    let data = E.supervisedData(prof, targetCol, features, task);
    const missingTarget = prof.nRows - data.rows.length;
    if (missingTarget) say(missingTarget + ' row' + (missingTarget > 1 ? 's have' : ' has') + ' no value for the target and were skipped.');
    if (data.rows.length < 8) throw new Error('Only ' + data.rows.length + ' rows have a target value. The agent needs at least 8.');
    if (data.rows.length > MAX_ROWS) {
      const keep = shuffle(range(data.rows.length), rng(seed)).slice(0, MAX_ROWS).sort((a, b) => a - b);
      data = Object.assign({}, data, { rows: keep.map(i => data.rows[i]), y: keep.map(i => data.y[i]) });
      report.sampled = MAX_ROWS;
      say('Large file: using a random sample of ' + MAX_ROWS.toLocaleString() + ' rows so it runs quickly in your browser.');
    }
    report.classes = data.classes;
    report.nUsed = data.rows.length;

    /* Columns with more levels than one-hot can carry. Worth saying out loud, because it
       changes how the importance and the recipe for that column should be read. */
    report.encoding = features.filter(c => c.kind === 'categorical' && c.unique > E.HIGH_CARD)
      .map(c => ({ name: c.name, levels: c.unique }));
    for (const en of report.encoding) {
      say(en.name + ' has ' + en.levels + ' levels, too many for a column each. It is carried as numbers instead: how common each level is, and ' +
        (task === 'classification' ? 'the share of each ' + targetCol.name + ' class for it' : 'how ' + targetCol.name + ' averaged for it') +
        '. Both are built only from the rows each fold trains on, so the averages never see the rows they are checked against.');
    }

    // DOE check first: designed experiments get a classic effects analysis too.
    if (task === 'regression') {
      const det = D.detect(prof, features, targetCol);
      if (det.isDOE) {
        report.doe = D.analyze(det, targetCol);
        report.doeDet = det;
        const lv = det.factors.map(f => f.levels.length);
        say('This looks like a designed experiment: ' + det.factors.length + ' factors at ' + Array.from(new Set(lv)).join('/') + ' levels in ' + det.rows.length + ' runs, with factors that do not move together. Ran a DOE effects analysis.');
      } else report.doeCheck = det.reason;
    }

    const n = data.rows.length;
    const K = data.classes ? data.classes.length : 0;
    const k = n <= 20 ? n : n <= 100 ? 10 : 5;
    const folds = E.makeFolds(n, k, rng(seed), task === 'classification' ? data.y : null);
    report.folds = k;
    say('Testing models with ' + (k === n ? 'leave-one-out' : k + '-fold') + ' cross-validation: each model is scored only on rows it never saw while learning.');

    const p = features.length;
    const models = E.MODELS.filter(m => (m.task === 'both' || m.task === task) && (!m.applicable || m.applicable(n, p, task, K)));
    const board = [];
    for (let i = 0; i < models.length; i++) {
      const m = models[i];
      progress({ log: report.log.slice(), model: m.name, done: i, total: models.length });
      await tick();
      const t0 = Date.now();
      try {
        const oof = E.crossValidate(m, data, task, folds, k, seed);
        const metrics = task === 'regression' ? E.regressionMetrics(data.y, oof) : E.classificationMetrics(data.y, oof, K);
        board.push({ id: m.id, name: m.name, plain: m.plain, complexity: m.complexity, metrics, oof, ms: Date.now() - t0 });
      } catch (err) {
        board.push({ id: m.id, name: m.name, plain: m.plain, complexity: m.complexity, error: String(err && err.message || err) });
      }
    }
    const key = task === 'regression' ? 'r2' : 'balancedAccuracy';
    const ok = board.filter(b => b.metrics);
    ok.sort((a, b) => b.metrics[key] - a.metrics[key]);
    const top = ok.filter(b => b.id !== 'baseline')[0] || ok[0];
    // Parsimony: among models within 0.01 of the top score, keep the simplest.
    const close = ok.filter(b => b.id !== 'baseline' && top.metrics[key] - b.metrics[key] <= 0.01);
    const best = close.sort((a, b) => a.complexity - b.complexity)[0] || top;
    report.leaderboard = ok.concat(board.filter(b => b.error));
    report.metricKey = key;
    report.best = best;
    report.bestReason = best === top ? 'highest cross-validated score' : 'within 0.01 of the top score (' + top.name + ') but simpler, so easier to trust and explain';
    say('Best model: ' + best.name + ' (' + report.bestReason + ').', 'result');

    // Neural network: train once more on all rows, step by step, so the page can draw the
    // learning curve live. If the network is the winner, this run becomes the final model.
    let nnFull = null;
    const nnRow = ok.find(b => b.id === 'mlp');
    if (nnRow) {
      say('Training the neural network on all rows so you can watch it learn (85% to learn from, 15% held back to check it).');
      const enc = E.fitEncoder(features, data.rows, { y: data.y, task, classes: data.classes }), Xa = enc.transform(data.rows);
      const tr = E.mlpTrainer(Xa, data.y, { task, nClasses: K, rand: rng(seed + 7) });
      while (!tr.step(3)) { progress({ log: report.log.slice(), nn: { history: tr.history, sizes: tr.sizes, bestEpoch: tr.bestEpoch } }); await tick(); }
      report.nn = { history: tr.history.slice(), sizes: tr.sizes, bestEpoch: tr.bestEpoch, inputs: enc.labels, score: nnRow.metrics[key], rank: ok.filter(b => b.id !== 'baseline').indexOf(nnRow) + 1, chosen: best.id === 'mlp', cvMs: nnRow.ms };
      say('Neural network: stopped after ' + tr.epoch + ' epochs; its best check score came at epoch ' + tr.bestEpoch + '.');
      if (best.id === 'mlp') nnFull = { enc, X: Xa, fitted: tr.model() };
    }

    // Refit the winner on all rows for drivers and what-if predictions.
    await tick();
    const model = E.MODELS.find(m => m.id === best.id);
    const full = nnFull || E.fitFull(model, data, task, seed);
    const trainPred = full.fitted.predict(full.X);
    report.trainMetrics = task === 'regression' ? E.regressionMetrics(data.y, trainPred) : E.classificationMetrics(data.y, trainPred, K);
    /* More permutation repeats than the three the ranking used to be built from. Each
       shuffle is one reading, and the spread across them is the only thing that says
       whether the order would survive the dice being thrown again. Small data gets more
       repeats because they are cheap there and the ranking is shakiest. */
    const impReps = n <= 400 ? 10 : n <= 1500 ? 6 : 4;
    report.importance = best.id === 'baseline' ? [] : E.permutationImportance(full, data, task, seed, { reps: impReps });
    const totalImp = report.importance.reduce((s, v) => s + v.importance, 0) || 1;
    report.importance.forEach(v => { v.share = v.importance / totalImp; v.shareSE = (v.se || 0) / totalImp; });
    /* The noise floor for an importance, measured rather than assumed to be zero.
       Permutation importance is read off the rows the model was fitted on, so a model leans
       on whatever column it was handed and the reading is positive whether or not there is
       anything there - three columns of pure random numbers measured 0.005 to 0.007 against
       standard errors near 0.002, which is "significant" by its own spread and worthless.
       The honest reference is what this model gives these same columns once the target is
       shuffled: the relationship is destroyed, the structure of the inputs is kept, and
       anything at or below that is not distinguishable from an irrelevant column. Two
       shuffles, because the floor only has to be about right to be useful. */
    report.importanceFloor = null;
    if (report.importance.length && best.id !== 'baseline' && n <= 2000) {
      try {
        let worst = 0;
        const shuffles = 2;
        for (let t = 0; t < shuffles; t++) {
          const yShuf = shuffle(data.y.slice(), rng(seed + 400 + t));
          const nullData = { rows: data.rows, y: yShuf, classes: data.classes, featureCols: data.featureCols };
          const nullFull = E.fitFull(model, nullData, task, seed);
          const nullImp = E.permutationImportance(nullFull, nullData, task, seed, { reps: 4 });
          worst += nullImp.reduce((mx, v) => Math.max(mx, v.importance), 0) / shuffles;
        }
        report.importanceFloor = worst;
        report.importanceFloorShare = worst / totalImp;
      } catch (err) { /* no floor is better than a floor nobody can stand behind */ }
    }
    /* Whether that ranking can be read as an order at all. Two importances are told apart
       only if the gap clears the noise in both, and neither is worth reading if it cannot
       clear the floor. */
    report.rank = UNC.rankReliability(report.importance,
      report.importanceFloor === null ? {} : { floor: report.importanceFloor });
    if (report.rank && report.rank.topAboveFloor === false) {
      say('No input here beats what the same model scores on a shuffled target, so this driver chart should not be read as a ranking.', 'warn');
    }

    /* How firm the headline score is. The out-of-fold predictions are resampled - nothing
       is refitted - so this costs almost nothing and turns a three-decimal R2 off forty
       rows into the range the data can actually support. */
    report.scoreUncertainty = UNC.scoreUncertainty(data.y, best.oof, task,
      { classes: data.classes, p: features.length, seed: seed + 3 });
    if (report.scoreUncertainty) {
      const su = report.scoreUncertainty;
      const label = task === 'regression' ? 'R\u00b2' : 'balanced accuracy';
      say('That ' + label + ' of ' + su.metric.toFixed(3) + ' is itself an estimate: on these ' +
        su.n + ' rows the data cannot separate it from anything between ' + su.lo.toFixed(3) +
        ' and ' + su.hi.toFixed(3) + '.', (su.hi - su.lo) > 0.25 ? 'warn' : 'result');
    }

    /* Prediction intervals, for a regression. Split conformal on a slice held back from a
       second fit: calibrating on the out-of-fold predictions would have been free, but it
       was measured and it undercovered, because out-of-fold residuals come from the fold
       models rather than from the model whose prediction is being qualified. */
    report.interval = null;
    if (task === 'regression' && best.id !== 'baseline' && n >= 24) {
      try {
        const order = E.shuffle(E.range(n), rng(seed + 5));
        const nCal = Math.max(8, Math.round(n * 0.3));
        const calIdx = order.slice(0, nCal), fitIdx = order.slice(nCal);
        const sub = idx => ({ rows: idx.map(i => data.rows[i]), y: idx.map(i => data.y[i]), classes: null, featureCols: data.featureCols });
        const fitPart = sub(fitIdx), calPart = sub(calIdx);
        const partial = E.fitFull(model, fitPart, task, seed);
        const calX = partial.enc.transform(calPart.rows);
        report.interval = UNC.calibrate({
          trainX: partial.X, calX, calY: calPart.y, calPred: partial.fitted.predict(calX)
        }, {});
        if (report.interval) {
          say('Prediction intervals calibrated on ' + report.interval.nCal + ' rows held back from a second fit. ' +
            'They widen as a question moves away from the data, which a fixed multiple of the residual spread cannot do.');
        }
      } catch (err) { report.intervalError = String(err && err.message || err); }
    }
    /* ---------- What the runners-up say ----------
       One model's ranking of the drivers is one model's opinion. Three model families that
       work in completely different ways, agreeing on what matters, is a far stronger
       statement - and where they disagree, that is worth knowing before anyone acts on a
       chart. So the top few are refit and asked the same question independently. */
    report.compare = [];
    const ranked = ok.filter(b => b.id !== 'baseline');
    const picks = [best].concat(ranked.filter(b => b !== best)).slice(0, 3);
    for (const c of picks) {
      progress({ log: report.log.slice(), model: 'Comparing: ' + c.name, done: models.length, total: models.length });
      await tick();
      try {
        const f = c === best ? full : E.fitFull(E.MODELS.find(m => m.id === c.id), data, task, seed);
        const imp = c === best ? report.importance : E.permutationImportance(f, data, task, seed);
        const tot = imp.reduce((sx, v) => sx + v.importance, 0) || 1;
        const shares = imp.map(v => ({ name: v.name, importance: v.importance, share: v.importance / tot }));
        report.compare.push({ id: c.id, name: c.name, plain: c.plain, metrics: c.metrics, oof: c.oof, importance: shares, chosen: c === best });
      } catch (err) {
        report.compare.push({ id: c.id, name: c.name, plain: c.plain, metrics: c.metrics, oof: c.oof, importance: [], chosen: c === best, error: String(err && err.message || err) });
      }
    }
    /* Do they agree? Measured on the top driver and on the overlap of each model's leading
       few, rather than asserted. */
    if (report.compare.length > 1) {
      const withImp = report.compare.filter(c => c.importance.length);
      const tops = withImp.map(c => c.importance[0] && c.importance[0].name).filter(Boolean);
      const leading = withImp.map(c => new Set(c.importance.filter(v => v.share >= 0.1).slice(0, 4).map(v => v.name)));
      let shared = null;
      if (leading.length) {
        shared = [...leading[0]].filter(n => leading.every(set => set.has(n)));
      }
      report.agreement = {
        models: withImp.length,
        topDriver: tops.length && tops.every(t => t === tops[0]) ? tops[0] : null,
        tops, shared: shared || [],
        // The union is what at least one model thought mattered: the gap between it and the
        // shared set is the honest measure of how much they disagree.
        union: [...new Set(withImp.flatMap(c => c.importance.filter(v => v.share >= 0.1).slice(0, 4).map(v => v.name)))]
      };
      if (report.agreement.topDriver) {
        say('All ' + withImp.length + ' leading models put ' + report.agreement.topDriver + ' first.', 'result');
      } else if (report.agreement.shared.length) {
        say('The leading models disagree on the order, but all of them rate ' + report.agreement.shared.join(' and ') + ' among the top drivers.', 'result');
      } else if (withImp.length > 1) {
        say('The leading models do not agree on which inputs matter. Treat any single ranking with caution.', 'warn');
      }
    }

    if (task === 'classification') {
      const g = String(report.goal || '');
      let fav = g.indexOf('class:') === 0 ? data.classes.indexOf(g.slice(6)) : -1;
      if (fav < 0) fav = guessFavorable(data.classes);
      report.favorable = fav;
      report.ordinal = !!ladderRank(data.classes);
      report.favorableSet = targetSet(report, fav);
    }
    // How the result moves with each top driver, other things equal. For classification,
    // `from` limits it to rows currently in one class ("what moves Bronze to Silver?").
    report.fromClass = null;
    const subsetOf = from => (from === null || from === undefined ? null : data.rows.filter((_, i) => data.y[i] === from));
    report.pdFor = (cls, from) => {
      const out = [], subset = subsetOf(from);
      for (const imp of report.importance.filter(v => v.share >= 0.03).slice(0, 6)) {
        const col = features.find(c => c.name === imp.name);
        const pdv = col && E.partialDependence(full, data, col, cls, subset);
        if (pdv) { pdv.share = imp.share; out.push(pdv); }
      }
      return out;
    };
    report.pd = report.pdFor(report.favorableSet || report.favorable, null);
    await tick();
    explainModel(report, full, data, best, task, K);
    // Average prediction over past rows with some columns overridden (the "apply all" estimate).
    report.averageWith = overrides => {
      const pool = subsetOf(report.fromClass) || data.rows;
      const sample = pool.filter((_, i) => i % Math.max(1, Math.ceil(pool.length / 400)) === 0);
      const X = sample.map(r => { const o = {}; for (const p of full.enc.parts) o[p.col.name] = p.col.values[r]; return full.enc.encodeValues(Object.assign(o, overrides)); });
      const pr = full.fitted.predictProba ? full.fitted.predictProba(X).map(q => E.pickProb(q, report.favorableSet)) : full.fitted.predict(X);
      return E.mean(pr);
    };
    report.actual = data.y;
    report.targetSD = E.sd(task === 'regression' ? data.y : []);
    /* The confidence an interval is quoted at. A number nobody set is a number nobody
       owns, so it is a field on the report rather than a constant buried in here. */
    report.intervalConfidence = 0.9;
    const withBand = (x, value) => {
      const o = { value };
      const cal = report.interval;
      if (!cal) return o;
      const conf = report.intervalConfidence;
      const half = cal.halfWidth(x, conf);
      o.low = value - half; o.high = value + half;
      o.halfWidth = half; o.distance = cal.distance(x);
      o.confidence = conf;
      // Past this the band is a floor rather than a guarantee, and it says so.
      o.supported = cal.supports(conf);
      return o;
    };
    report.predict = values => {
      const x = full.enc.encodeValues(values);
      if (full.fitted.predictProba) { const pr = full.fitted.predictProba([x])[0]; return { proba: pr, label: data.classes[pr.indexOf(Math.max.apply(null, pr))] }; }
      return withBand(x, full.fitted.predict([x])[0]);
    };
    // Scores many hand-entered rows in one call (the what-if desk asks for ~100 per move).
    report.predictMany = list => {
      const X = list.map(v => full.enc.encodeValues(v));
      if (full.fitted.predictProba) return full.fitted.predictProba(X).map(pr => ({ proba: pr, label: data.classes[pr.indexOf(Math.max.apply(null, pr))] }));
      return full.fitted.predict(X).map((v, i) => withBand(X[i], v));
    };
  }

  async function cluster(prof, features, seed, say) {
    let rows = range(prof.nRows);
    if (rows.length > MAX_ROWS) rows = shuffle(rows, rng(seed)).slice(0, MAX_ROWS).sort((a, b) => a - b);
    if (rows.length < 6) throw new Error('Need at least 6 rows to look for groups.');
    const enc = E.fitEncoder(features, rows);
    const X = enc.transform(rows);
    const tries = [];
    const kMax = Math.min(6, rows.length - 1);
    for (let k = 2; k <= kMax; k++) {
      await tick();
      const km = E.kmeans(X, k, rng(seed + k), 5);
      tries.push({ k, inertia: km.inertia, silhouette: E.silhouette(X, km.labels, k, rng(seed)), km });
    }
    // A "group" of one or two rows is an outlier, not a segment, so such splits rank last.
    const minSize = Math.max(3, Math.ceil(0.02 * rows.length));
    const tiny = t => range(t.k).some(c => t.km.labels.filter(l => l === c).length < minSize);
    const best = tries.slice().sort((a, b) => (tiny(a) - tiny(b)) || b.silhouette - a.silhouette)[0];
    say('Tried 2 to ' + kMax + ' groups with k-means. ' + best.k + ' groups separate best (silhouette ' + best.silhouette.toFixed(2) + ' on a -1 to 1 scale).', 'result');
    const pc = X[0].length >= 2 ? E.pca(X) : null;
    if (pc) say('Principal components: the first two directions capture ' + pct(pc.explained[0] + pc.explained[1]) + ' of the spread.');

    // Profile each cluster: which columns make it different from the overall average.
    const labels = best.km.labels;
    const profiles = range(best.k).map(c => {
      const members = rows.filter((_, i) => labels[i] === c);
      const traits = [];
      for (const col of features) {
        if (col.kind === 'numeric') {
          const vals = members.map(r => col.values[r]).filter(v => v !== null);
          const z = col.stats.sd ? (mean(vals) - col.stats.mean) / col.stats.sd : 0;
          traits.push({ name: col.name, z, text: (z > 0 ? 'higher' : 'lower') + ' ' + col.name + ' (avg ' + fmt(mean(vals)) + ' vs ' + fmt(col.stats.mean) + ')', mean: mean(vals) });
        } else {
          const counts = {}; for (const r of members) { const v = col.values[r]; if (v !== null) counts[v] = (counts[v] || 0) + 1; }
          const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
          if (!top) continue;
          const share = counts[top] / members.length, overall = (col.counts[top] || 0) / (prof.nRows - col.missing);
          traits.push({ name: col.name, z: (share - overall) * 3, text: pct(share) + ' are ' + col.name + ' = ' + top + ' (vs ' + pct(overall) + ' overall)' });
        }
      }
      traits.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
      return { cluster: c + 1, size: members.length, share: members.length / rows.length, traits: traits.slice(0, 3), means: traits };
    });

    // Unusual rows: far from their own cluster center.
    const dist = X.map((x, i) => Math.sqrt(x.reduce((s, v, j) => s + (v - best.km.centers[labels[i]][j]) ** 2, 0)));
    const md = E.median(dist), mad = E.median(dist.map(d => Math.abs(d - md))) || 1e-9;
    const outliers = dist.map((d, i) => ({ row: rows[i] + 2, score: (d - md) / (1.4826 * mad) }))
      .filter(o => o.score > 3.5).sort((a, b) => b.score - a.score);

    return {
      k: best.k, silhouette: best.silhouette, tries: tries.map(t => ({ k: t.k, inertia: t.inertia, silhouette: t.silhouette, tiny: tiny(t) })),
      labels, rows, profiles, outliers, pca: pc && { explained: pc.explained, scores: pc.scores, loadings: pc.loadings, labels: enc.labels }
    };
  }

  // ---------- Plain-language findings ----------
  // ---------- Multi-response desirability (Derringer and Suich) ----------
  // Individual desirability: 0 = unacceptable, 1 = fully satisfied, straight line in between.
  function dScore(sp, y) {
    const L = sp.low, H = sp.high, T = sp.target;
    if (sp.goal === 'max') return y <= L ? 0 : y >= H ? 1 : (y - L) / (H - L);
    if (sp.goal === 'min') return y <= L ? 1 : y >= H ? 0 : (H - y) / (H - L);
    if (y < L || y > H) return 0;
    return y <= T ? (T > L ? (y - L) / (T - L) : 1) : (H > T ? (H - y) / (H - T) : 1);
  }
  // Overall desirability: weighted geometric mean, so failing any one result gives zero.
  function dOverall(ds, ws) {
    if (ds.some(d => d <= 0)) return 0;
    const W = ws.reduce((a, b) => a + b, 0);
    return Math.exp(ds.reduce((a, d, i) => a + ws[i] * Math.log(d), 0) / W);
  }
  function checkSpecs(specs) {
    for (const sp of specs) {
      if (!['max', 'min', 'target'].includes(sp.goal)) throw new Error('Pick a goal for ' + sp.name + '.');
      if (!(isFinite(sp.low) && isFinite(sp.high)) || sp.low >= sp.high) throw new Error(sp.name + ': the low value must be below the high value.');
      if (sp.goal === 'target' && !(isFinite(sp.target) && sp.target >= sp.low && sp.target <= sp.high)) throw new Error(sp.name + ': the target must sit between low and high.');
    }
  }
  async function desirability(rep, prof, features, multi, seed, say, progress) {
    const specs = multi.responses.map(r => ({ name: r.name, goal: r.goal, low: Number(r.low), high: Number(r.high), target: r.target === null || r.target === undefined || r.target === '' ? null : Number(r.target), weight: Number(r.weight) || 1 }));
    checkSpecs(specs);
    const models = [];
    for (const sp of specs) {
      const col = prof.columns.find(c => c.name === sp.name);
      if (!col || col.kind !== 'numeric') throw new Error('"' + sp.name + '" must be a numeric column to optimize it.');
      if (sp.name === rep.target) { models.push({ name: sp.name, model: rep.best.name, r2: rep.best.metrics.r2, predictMany: list => rep.predictMany(list).map(o => o.value) }); continue; }
      let data = E.supervisedData(prof, col, features, 'regression');
      if (data.rows.length < 8) throw new Error('"' + sp.name + '" has too few values to model.');
      if (data.rows.length > MAX_ROWS) { const keep = shuffle(range(data.rows.length), rng(seed)).slice(0, MAX_ROWS).sort((a, b) => a - b); data = Object.assign({}, data, { rows: keep.map(i => data.rows[i]), y: keep.map(i => data.y[i]) }); }
      const n = data.rows.length, k = n <= 20 ? n : n <= 100 ? 10 : 5, folds = E.makeFolds(n, k, rng(seed + 11));
      let bestM = null;
      for (const id of ['ridge', 'quadratic', 'forest', 'boosting']) {
        const m = E.MODELS.find(x => x.id === id);
        if (m.applicable && !m.applicable(n, features.length, 'regression', 0)) continue;
        await tick();
        const r2 = E.regressionMetrics(data.y, E.crossValidate(m, data, 'regression', folds, k, seed)).r2;
        if (!bestM || r2 > bestM.r2 + 0.01 || (Math.abs(r2 - bestM.r2) <= 0.01 && m.complexity < bestM.m.complexity)) bestM = { m, r2 };
      }
      const full = E.fitFull(bestM.m, data, 'regression', seed);
      models.push({ name: sp.name, model: bestM.m.name, r2: bestM.r2, predictMany: list => full.fitted.predict(list.map(v => full.enc.encodeValues(v))) });
      say('Modelled "' + sp.name + '" with ' + bestM.m.name + ' (R² ' + bestM.r2.toFixed(2) + ' on unseen rows) for the multi-result optimization.');
    }
    // Search space: the middle 90% of each numeric input, and the common levels of each category.
    const vars = features.map(c => {
      if (c.kind === 'numeric') {
        const v = c.values.filter(x => x !== null).sort((a, b) => a - b);
        const whole = v.every(x => Number.isInteger(x)); // days, rpm, counts stay whole numbers
        return { name: c.name, kind: 'num', whole, lo: E.quantile(v, 0.05), hi: E.quantile(v, 0.95), typical: whole ? Math.round(c.stats.median) : c.stats.median };
      }
      return { name: c.name, kind: 'cat', levels: c.levels.slice(0, 8), typical: c.levels[0] };
    });
    const ws = specs.map(s => s.weight);
    const evalMany = list => {
      const preds = models.map(m => m.predictMany(list));
      return list.map((_, i) => {
        const ys = preds.map(p => p[i]), ds = specs.map((sp, j) => dScore(sp, ys[j]));
        return { ys, ds, D: dOverall(ds, ws), soft: E.mean(ds) };
      });
    };
    const better = (a, b) => a.D > b.D + 1e-12 || (Math.abs(a.D - b.D) <= 1e-12 && a.soft > b.soft);
    const typical = {}; vars.forEach(v => { typical[v.name] = v.typical; });
    const rand = rng(seed + 99);
    const snap = (v, x) => (v.whole ? Math.round(x) : x);
    const randomPoint = () => { const o = {}; vars.forEach(v => { o[v.name] = v.kind === 'num' ? snap(v, v.lo + (v.hi - v.lo) * rand()) : v.levels[Math.floor(rand() * v.levels.length)]; }); return o; };
    let pool = [Object.assign({}, typical)];
    for (let i = 0; i < 1500; i++) pool.push(randomPoint());
    let scored = [];
    for (let i = 0; i < pool.length; i += 300) { await tick(); scored = scored.concat(evalMany(pool.slice(i, i + 300)).map((r, j) => Object.assign(r, { values: pool[i + j] }))); }
    scored.sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
    // Refine the five best, one input at a time.
    let best = scored[0];
    for (const start of scored.slice(0, 5)) {
      let cur = start;
      for (let pass = 0; pass < 2; pass++) {
        for (const v of vars) {
          const opts = v.kind === 'num' ? Array.from(new Set(range(9).map(i => snap(v, v.lo + (v.hi - v.lo) * i / 8)))) : v.levels;
          const cand = opts.map(o => Object.assign({}, cur.values, { [v.name]: o }));
          const res = evalMany(cand);
          res.forEach((r, i) => { if (better(r, cur)) cur = Object.assign(r, { values: cand[i] }); });
        }
        await tick();
      }
      if (better(cur, best)) best = cur;
    }
    const typ = Object.assign(evalMany([typical])[0], { values: typical });
    return {
      specs, models: models.map(m => ({ name: m.name, model: m.model, r2: m.r2 })), vars,
      best: { values: best.values, ys: best.ys, ds: best.ds, D: best.D }, typical: { values: typical, ys: typ.ys, ds: typ.ds, D: typ.D },
      evaluate: values => evalMany([Object.assign({}, typical, values)])[0]
    };
  }

  // ---------- Six Sigma mode ----------
  function levelCols(features, maxLevels) {
    return features.filter(c => (c.kind === 'categorical' && c.unique >= 2 && c.unique <= maxLevels) || (c.kind === 'numeric' && c.unique >= 2 && c.unique <= 5));
  }
  function sixSigma(rep, prof, targetCol, features, o) {
    const out = { spec: { lsl: o.lsl, usl: o.usl, target: o.target }, timeOrdered: o.timeOrdered !== false };
    if (rep.task === 'regression') {
      const rows = range(prof.nRows).filter(r => targetCol.values[r] !== null);
      const y = rows.map(r => targetCol.values[r]);
      const hasSpec = [o.lsl, o.usl].some(v => v !== null && v !== undefined && v !== '');
      const cap = S.capability(y, out.spec, out.timeOrdered);
      out.stats = cap;
      if (hasSpec) out.capability = cap;
      // A designed experiment varies factors on purpose, so its spread is not process variation.
      out.designed = !!rep.doeDet;
      if (out.timeOrdered && y.length >= 8 && !out.designed) {
        const keep = Math.max(0, y.length - 500);
        out.imr = S.imr(y.slice(keep));
        out.imr.rowNums = rows.slice(keep).map(r => r + 2);
        out.imr.trimmed = keep;
        /* The two charts built for a drift rather than a spike. Computed on the same rows
           and the same within-subgroup sigma as the I-MR chart above, so the three are
           comparable, and tuned to the same in-control false alarm rate so the speed
           difference between them is about what they catch rather than how often they
           interrupt. A count series goes on the count chart instead, where the spread is
           fixed by the mean. */
        try {
          const slice = y.slice(keep);
          out.cusum = S.cusum(slice, { mu0: out.spec.target !== null && out.spec.target !== undefined && out.spec.target !== '' ? Number(out.spec.target) : undefined });
          out.ewma = S.ewma(slice, { mu0: out.cusum.mu0, sigma: out.cusum.sigma });
          out.cusum.rowNums = out.imr.rowNums; out.ewma.rowNums = out.imr.rowNums;
        } catch (err) { out.driftError = err.message; }
        /* Counted data on a measurement chart gets the limits wrong, because a count's
           spread is not free: a Poisson count's standard deviation is the square root of
           its own mean. So when the target is whole and never negative, the right chart is
           computed beside the I-MR one rather than instead of it, and the panel says which
           to read. A column naming how many units were looked at turns it into a u or p
           chart, whose limits move with that number. */
        const counted = y.length >= 8 && y.every(v => v >= 0 && v === Math.round(v));
        if (counted) {
          const uCol = o.unitsColumn ? prof.columns.find(c => c.name === o.unitsColumn && c.kind === 'numeric') : null;
          const units = uCol ? rows.slice(keep).map(r => uCol.values[r]) : null;
          const usable = units && units.every(v => v !== null && v > 0);
          try {
            const opt = usable ? { units, kind: y.slice(keep).every((v, i) => v <= units[i]) ? 'p' : 'u' } : {};
            out.counts = S.countChart(y.slice(keep), opt);
            out.counts.rowNums = rows.slice(keep).map(r => r + 2);
            out.counts.unitsColumn = usable ? uCol.name : null;
            if (o.unitsColumn && !usable) out.counts.unitsNote = 'The column "' + o.unitsColumn + '" could not be used as the number of units looked at - it has blanks, zeros or negatives - so a c-chart was drawn instead, which assumes every point had the same opportunity.';
          } catch (err) { out.countsError = err.message; }
          /* Rare events need the other chart entirely. When the counts are mostly zeros -
             a finding now and then rather than a rate worth charting - the gaps between
             findings carry far more than the counts do, so they are charted too and the
             panel says which to read. */
          const total = y.reduce((p, q) => p + q, 0);
          const zeros = y.filter(v => v === 0).length;
          if (total >= 9 && zeros / y.length >= 0.5) {
            const gaps = [];
            let since = 0, started = false;
            for (const v of y) {
              if (v === 0) { since++; continue; }
              for (let k = 0; k < v; k++) { if (started) gaps.push(since); started = true; since = 0; }
              since = 0;
            }
            try { if (gaps.length >= 8) { out.rare = S.rareEvents(gaps); out.rare.zeroShare = zeros / y.length; } }
            catch (err) { out.rareError = err.message; }
          }
        }
      }
      // Box plots by the most important columns that have a handful of levels.
      const order = (rep.importance && rep.importance.length ? rep.importance.map(v => v.name) : features.map(c => c.name));
      const byImp = order.map(n => features.find(c => c.name === n)).filter(Boolean);
      const groupCols = levelCols(byImp, 8).slice(0, 3);
      out.boxes = {
        overall: S.box(y),
        by: groupCols.map(c => {
          const lv = Array.from(new Set(rows.map(r => c.values[r]).filter(v => v !== null))).sort((a, b) => (typeof a === 'number' ? a - b : String(a) < String(b) ? -1 : 1));
          return { name: c.name, groups: lv.map(l => ({ label: String(typeof l === 'number' ? fmt(l) : l), stats: S.box(rows.filter(r => c.values[r] === l).map(r => targetCol.values[r])) })) };
        })
      };
      // Taguchi: designed-experiment factors if this is a DOE, else columns with a few levels.
      const type = out.spec.target !== null && out.spec.target !== undefined && out.spec.target !== '' ? 'nominal' : rep.goal === 'min' ? 'smaller' : 'larger';
      const facCols = rep.doeDet ? rep.doeDet.factors.map(f => f.col) : levelCols(byImp, 6).slice(0, 8);
      if (facCols.length) {
        const t = S.taguchi(y, facCols.map(c => ({ name: c.name, values: rows.map(r => c.values[r]) })), type);
        if (t.length) out.taguchi = { type, factors: t };
      }
    } else if (rep.task === 'classification') {
      const good = rep.actual.filter(k => (rep.favorableSet || [rep.favorable]).includes(k)).length;
      out.attribute = S.attribute(good, rep.actual.length);
      out.goodLabel = classLabel(rep);
    }
    return out;
  }
  /* ---------- earned referrals ----------
     Each one names the bench to open, what in THIS data triggered it, and what it would buy.
     The gate is the point: a referral is only offered when the sheet in hand can support the
     study being recommended, and the structure alone decides that - column kinds, levels and
     row counts - so it works in Six Sigma mode whether or not models were fitted.

     Where nothing is earned, the output is not silence and not a hopeful suggestion: it is
     the columns to start recording, because that is the only thing that would change the
     answer. */
  function referrals(rep, prof, targetCol, features) {
    const out = [];
    const add = (phase, title, text) => out.push({ phase, title, text });
    const s = rep.spc, c = s && s.capability;
    const n = rep.nUsed || prof.nRows;
    const cols = (features || []).filter(f => f.name !== (targetCol && targetCol.name));
    /* For the measurement study, every column in the sheet - not just the ones the model kept.
       A sample identifier is the kind of column a supervised run sets aside, as an identifier
       or as a leak, and it is the column a Gage R&R is built on. This is defensive rather than
       a fix for an observed failure: on the crossed studies I could construct the sample column
       survived into the model's inputs anyway, so no fixture here demonstrates it mattering.
       It is kept because the exclusion it guards against is one the agent is entitled to make
       at any time, and the cost of reading one more list is nothing. */
    const allCols = (prof.columns || []).filter(f => f.name !== (targetCol && targetCol.name));

    /* A Gage R&R needs the SAME SAMPLE measured more than once, by more than one operator or
       instrument - a crossed design. A column that merely repeats is not enough and the first
       version of this gate got that wrong: a Lot column with ten rows per lot is ten different
       batches from one lot, not one batch measured ten times, and recommending a measurement
       study off it sends somebody looking for repeats that do not exist. So the pair is looked
       for, and the crossing is checked on the actual values. */
    const SAMPLEISH = /sample|specimen|part|vial|aliquot|unit|^id$|id$|batch|lot/i;
    const OPERISH = /analyst|operator|instrument|system|device|gauge|technician|appraiser|column|lab|site|machine|probe/i;
    const crossing = (a, b) => {
      const cells = new Map();
      for (let i = 0; i < a.values.length; i++) {
        const av = a.values[i], bv = b.values[i];
        if (av === null || bv === null) continue;
        const key = String(av) + '\u0000' + String(bv);
        cells.set(key, (cells.get(key) || 0) + 1);
      }
      const want = a.unique * b.unique;
      const filled = cells.size;
      let repeated = 0;
      for (const v of cells.values()) if (v >= 2) repeated++;
      return { filled, want, coverage: want ? filled / want : 0, repeatedCells: repeated };
    };
    let gauge = null;
    for (const smp of allCols.filter(f => f.unique >= 5 && f.unique <= n / 2 && SAMPLEISH.test(f.name))) {
      for (const op of allCols.filter(f => f !== smp && f.unique >= 2 && f.unique <= 10 && OPERISH.test(f.name))) {
        const x = crossing(smp, op);
        /* Most cells present, and some of them measured twice - the first gives
           reproducibility between operators, the second gives repeatability within one.
           What this catches is the STRUCTURAL case: a sheet with no repeated cell cannot
           support the study, whatever its columns are called. What it cannot catch is the
           semantic one - a vessel measured twice by three analysts has exactly the shape of a
           measurement study and is not one, because the spread between vessels is real
           part-to-part variation rather than the instrument. Only the column's name separates
           those, so the name patterns above are load-bearing and are pinned by a fixture in
           the tests. What remains uncatchable: a sheet that names a grouping column "Sample"
           would still be referred. The panel it opens asks for the sample and operator columns
           explicitly, which is where that would surface. */
        if (x.coverage >= 0.7 && x.repeatedCells >= Math.max(3, x.filled * 0.5)) { gauge = { smp, op, x }; break; }
      }
      if (gauge) break;
    }
    const gaugeable = gauge ? [gauge] : [];
    /* Candidate factors: something with a handful of levels, or a numeric input with spread.
       Three is the floor for a drivers run worth reading, and ten rows per factor is the rule
       of thumb the insights already use. */
    const factors = cols.filter(f => (f.kind === 'categorical' && f.unique >= 2 && f.unique <= 12) ||
      (f.kind === 'numeric' && f.unique >= 4));
    const streams = cols.filter(f => f.kind === 'categorical' && f.unique >= 2 && f.unique <= 8);

    if (s && s.designed) {
      add('Analyze', 'Read this as a DOE, not as a capability study',
        'The factors here were varied on purpose, so the spread is the experiment rather than the process and the capability figures above describe the design. The effects, the aliasing and the response surface are the useful output: the machine learning and DOE bench analyses them, and Six Sigma mode on routine production data is what gives you a real capability.');
    }

    if (gauge) {
      add('Measure', 'Qualify the measurement before trusting the capability',
        'A capability index built on an unqualified assay is a confident number about the assay, and this sheet can settle it: "' +
        gauge.smp.name + '" has ' + gauge.smp.unique + ' values crossed with ' + gauge.op.unique + ' levels of "' + gauge.op.name + '", ' +
        Math.round(100 * gauge.x.coverage) + '% of those combinations are present and ' + gauge.x.repeatedCells +
        ' of them are measured more than once - which is a crossed study with both reproducibility between ' + gauge.op.name +
        ' and repeatability within. The variance bench, Gage R&R mode, splits what you observe into the instrument, the people and real part-to-part difference.');
    } else if (c) {
      add('Measure', 'Nothing here can qualify the measurement, and that is a gap worth naming',
        'Every figure above takes the measurement at face value, and this sheet holds no crossed study that could separate the instrument from the product - a column that repeats is not enough, because ten rows sharing a lot number are ten different batches rather than one batch measured ten times. So the share of this spread that is the assay is unknown rather than small. What would change it: the same samples measured more than once, by more than one analyst or instrument, with a column naming the sample and a column naming who or what measured it. Ten samples, three analysts, two repeats is the usual study.');
    }

    /* The referral the gap asked for: in control but not capable means the problem is not
       stability, it is variation - and that is a drivers question, which needs factors. */
    const notCapable = c && c.Cpk !== null && c.Cpk < 1.33;
    const stable = s && s.imr && s.imr.signals.length === 0;
    if (notCapable && factors.length >= 2 && n >= 10 * Math.min(factors.length, 5)) {
      add('Analyze', 'The chart is not the problem here — move up a slot',
        (stable ? 'The process is in control and still not capable, which means stability is not what is costing you: the spread itself is too wide for the specification. '
          : 'The process is not capable, and once the signals above are dealt with the spread itself will still be too wide for the specification. ') +
        'That is a different question from the one a control chart answers, and this sheet can support it: ' + factors.length +
        ' candidate input' + (factors.length === 1 ? '' : 's') + ' across ' + n + ' rows. Switch to the machine learning and design of experiments bench — one slot up in the technique list — and it ranks which of them moves ' +
        (rep.target || 'the result') + ', with a shuffled-target noise floor beside the ranking so an input with nothing behind it is reported as having nothing behind it. Then it designs the experiment that would prove it.');
    } else if (notCapable) {
      add('Analyze', 'The spread is too wide, and this sheet cannot say why',
        'Cpk is ' + (c.Cpk === null ? 'not computable' : c.Cpk.toFixed(2)) + ', so the variation needs reducing rather than watching - but ' +
        (factors.length < 2
          ? 'this sheet records the result and almost nothing that could explain it (' + factors.length + ' usable input column' + (factors.length === 1 ? '' : 's') + '). A drivers analysis on it would be guessing.'
          : n + ' rows for ' + factors.length + ' inputs is too thin for a drivers analysis to beat its own noise floor.') +
        ' What would change the answer: record the things you already suspect alongside the result — raw-material lot, vessel, line, shift, analyst, hold time, the parameters you set — one column each, one row per batch. Thirty rows and half a dozen such columns is enough to start.');
    }

    if (streams.length && n >= 20) {
      const st = streams.sort((a, b) => a.unique - b.unique)[0];
      add('Measure', 'Check whether this is one process or several',
        '"' + st.name + '" has ' + st.unique + ' levels, so the chart above may be averaging across ' + st.unique +
        ' things that behave differently — two lines, two vessels, two sites. The variance bench compares capability across them and tests whether they may be pooled at all, and withholds a combined index when they may not, because one number over several different processes describes a mixture nobody runs.');
    }

    if (c && c.tailsUsable === false) {
      add('Analyze', 'For a defensible limit on data this shape, change benches',
        'The PPM, Z.bench and sigma level are withheld above because they are normal tail probabilities and these results are not bell-shaped. What does work without assuming a shape is a tolerance interval taken from the ranking of the results alone: the limits bench does that, and reports what it costs in sample size rather than hiding it.');
    }

    return out;
  }

  function spcInsights(rep, add) {
    const s = rep.spc;
    if (!s) return;
    const c = s.capability;
    if (c && s.designed) add('warn', 'This is a designed experiment: its spread comes from changing the factors on purpose, so the capability numbers below describe the experiment, not your everyday process. Run Six Sigma mode on normal production data for true capability.');
    if (c) {
      const idx = c.Cpk !== null ? 'Cpk = ' + c.Cpk.toFixed(2) : 'Ppk = ' + (c.Ppk !== null ? c.Ppk.toFixed(2) : '–');
      /* Cp and Cpk are ratios of distances to spread and stand whatever the shape. The PPM,
         Z.bench and sigma level are normal tail probabilities, and a tail probability from
         the wrong distribution is not approximately right - it is wrong by orders of
         magnitude. So they are quoted only when the data supports them, and the observed
         count, which needs no distribution at all, is always quoted beside them. */
      const tails = c.tailsUsable !== false
        ? 'Expected ' + fmt(c.ppm, 0) + ' parts per million out of spec (Z.bench ' + c.zBench.toFixed(2) + ', about ' + c.sigmaLevel.toFixed(1) + ' sigma). '
        : '';
      add(c.verdict === 'capable' || c.verdict === 'excellent' ? 'good' : 'warn', 'Process capability: ' + idx + ' (' + c.verdict + '). ' + tails + 'Observed: ' + c.observedOut + ' of ' + c.n + ' rows out of spec.');
      if (c.centeredCpk !== null && c.Cpk !== null && c.centeredCpk - c.Cpk > 0.2) add('info', 'The process is off center: the mean is ' + fmt(c.mean) + ' but the middle of the spec is ' + fmt((c.lsl + c.usl) / 2) + '. Centering it would lift Cpk from ' + c.Cpk.toFixed(2) + ' to ' + c.centeredCpk.toFixed(2) + ' without reducing variation.');
      if (c.centeredCpk !== null && c.centeredCpk < 1.33) add('warn', 'Even perfectly centered, the spread is too wide for Cpk 1.33: the standard deviation needs to come down from ' + fmt(c.sdWithin || c.sdOverall) + ' to about ' + fmt(c.sigmaFor133) + '.');
      /* This used to fire on a skewness above 1 and call the result "approximate". Measured
         on a right-skewed impurity with the limit at its true 99.9th percentile, so the real
         rate is 1,000 PPM: at a skewness of 0.65 the normal figure reads 62 PPM, sixteen
         times under, and the old rule said nothing at all. "Approximate" was the wrong word
         for it as well. The test is a real one now, and the figures it invalidates are
         withheld rather than labelled. */
      if (c.tailsUsable === false) {
        add('warn', 'These results are not bell-shaped (Anderson\u2013Darling p ' + (c.normality.p < 0.001 ? '< 0.001' : c.normality.p.toFixed(3)) +
          (Math.abs(c.skew) > 0.4 ? ', skewness ' + c.skew.toFixed(1) : '') + '), so the expected PPM, Z.bench and sigma level are not reported: every one of them is a normal tail probability, ' +
          'and on skewed data those are wrong by factors of tens to thousands rather than by a little. ' +
          'What stands is Cp and Cpk, which are ratios of distances and do not care about shape, and the observed ' +
          c.observedOut + ' of ' + c.n + ' rows out of spec, which needs no distribution at all. ' +
          'For a defensible figure on data this shape, use a tolerance interval or transform the results first.');
      } else if (c.tailsUsable === null) {
        add('info', 'Too few results to test whether they are bell-shaped, so the expected PPM and sigma level rest on an assumption nobody has checked. The observed ' +
          c.observedOut + ' of ' + c.n + ' rows out of spec does not.');
      } else if (Math.abs(c.skew) > 0.8) {
        add('info', 'The results pass a normality test but lean one way (skewness ' + c.skew.toFixed(1) + '), and the tail figures are the part that is sensitive to that. The observed count is the one to lead with.');
      }
      if (c.loss !== null) add('info', 'Taguchi quality loss: the average unit carries ' + pct(c.loss) + ' of the loss of a unit sitting right at the spec limit. Every step away from the target costs something, even inside spec.');
    } else if (s.stats) add('info', 'Six Sigma mode: no spec limits were given, so Cp and Cpk are skipped. The control chart, box plots and robustness analysis still apply.');
    if (s.imr) {
      const im = s.imr;
      if (im.expectedFalse >= 0.5) {
        add('info', 'This chart runs ' + (im.rules === 'all' ? 'the full Nelson rule set' : 'the control limits and the moving-range limit') +
          '. Measured on 3,000 in-control series, that raises a false signal about once every ' + im.falseAlarmEvery +
          ' points, so on ' + im.y.length + ' runs you should expect about ' + im.expectedFalse.toFixed(1) +
          ' signal' + (im.expectedFalse >= 1.5 ? 's' : '') + ' even from a process with nothing wrong with it. One isolated signal is not evidence; a pattern or a repeat is.');
      }
      const n = s.imr.signals.length;
      add(n ? 'warn' : 'good', n ? 'Control chart: ' + n + ' signal' + (n > 1 ? 's' : '') + ' of special-cause variation (first at row ' + s.imr.rowNums[s.imr.signals[0].i] + ': ' + s.imr.signals[0].why.join(', ') + '). The process is not yet stable, and capability assumes stability.' : 'Control chart: no special-cause signals. The process looks stable over this period.');
    }
    if (s.taguchi && s.taguchi.factors.length) {
      const t = s.taguchi.factors[0], kind = { larger: 'larger is better', smaller: 'smaller is better', nominal: 'on target is best' }[s.taguchi.type];
      add('info', 'Robustness (Taguchi signal-to-noise, ' + kind + '): ' + t.name + ' matters most for consistency; its most robust level is ' + (typeof t.best.level === 'number' ? fmt(t.best.level) : t.best.level) + '.');
    }
    if (s.attribute) {
      const a = s.attribute;
      add(a.sigmaLevel >= 4 ? 'good' : 'warn', 'Quality level: ' + pct(a.p) + ' of rows are not ' + s.goodLabel + ' (' + fmt(a.dpmo, 0) + ' defects per million opportunities). That is a sigma level of about ' + a.sigmaLevel.toFixed(1) + ' (yield ' + pct(a.yield) + '). Six Sigma is 3.4 per million.');
    }
  }

  function insights(rep, prof, targetCol, features) {
    const out = [];
    const add = (level, text) => out.push({ level, text });
    if (rep.desirability) {
      const d = rep.desirability, b = d.best;
      add(b.D >= 0.6 ? 'good' : b.D > 0 ? 'info' : 'warn', 'Best compromise across ' + d.specs.length + ' results: overall desirability ' + b.D.toFixed(2) + ' (0 = some result unacceptable, 1 = all fully met), versus ' + d.typical.D.toFixed(2) + ' at typical settings. ' +
        d.specs.map((sp, i) => sp.name + ' ≈ ' + fmt(b.ys[i])).join(', ') + '.' + (b.D === 0 ? ' No setting inside your data range meets every acceptable range at once: relax a range, lower an importance, or explore beyond the data with a DOE.' : ''));
    }
    spcInsights(rep, add);
    /* Interval calibration failing is the quietest of the failures this tool can have and the
       one that misleads most: every prediction then comes back as a bare number, and a bare
       number reads as an exact one. The reason is recorded a few hundred lines up and was
       never shown to anybody, so it is said here - in the findings, where somebody reading the
       predictions will see it. */
    if (rep.intervalError) add('warn', 'Prediction intervals could not be calibrated: ' + rep.intervalError +
      ' So every predicted figure below is a point estimate with no band around it, and a point estimate with no band reads as more certain than it is. The usual cause is too few rows to hold any back for calibration. Treat the predictions as directional until there are more.');
    const n = rep.nUsed || prof.nRows;
    if (n < 30) add('warn', 'Only ' + n + ' rows. Treat results as directional; small samples can mislead. A planned experiment gets more from few runs than historical data does.');
    else if (features.length && n < 10 * features.length) add('warn', n + ' rows for ' + features.length + ' inputs. Rule of thumb is 10+ rows per input; more data would firm up the results.');
    for (const l of rep.leaks || []) add('warn', '"' + l.name + '" was set aside because it matches ' + rep.target + ' almost exactly on its own (' + l.why + '). It is most likely recorded after the result or derived from it. If it truly is an input you control, you do not need machine learning for it: it already decides the result.');
    const v = rep.vif;
    if (v && v.factors && v.factors.length) {
      if (v.singular) {
        add('warn', 'At least one input is an exact, or near-exact, combination of the others (' + v.flagged.slice(0, 4).join(', ') +
          '). Their separate effects cannot be estimated at all \u2014 not weakly, not at all \u2014 so the model may predict well while any statement about which one to change is meaningless. Drop one, or combine them into the quantity they really represent.');
      } else if (v.flagged && v.flagged.length) {
        const worst = v.worst;
        add('info', 'Inputs that move with the others: ' + v.flagged.slice(0, 5).map(n => {
          const f = v.factors.find(x => x.name === n);
          return n + ' (VIF ' + f.vif.toFixed(1) + ')';
        }).join(', ') + '. Above 5 is worth knowing and above 10 is usually called a problem, though both are conventions rather than findings. ' +
          'What this costs is precision on those coefficients, not predictive accuracy: the model can predict perfectly and still be unable to say which of ' +
          worst.name + ' and the inputs it moves with is the one to change. A designed experiment separates them; historical data cannot.');
      }
    }
    const gappy = prof.columns.filter(c => c.n && c.missing / c.n > 0.05 && c.kind !== 'empty');
    if (gappy.length) add('warn', 'Missing values in ' + gappy.map(c => c.name + ' (' + pct(c.missing / c.n) + ')').join(', ') + '. Gaps were filled with the median or most common value. Fix at the source if you can.');
    const strong = (rep.correlations || []).filter(c => Math.abs(c.r) >= 0.85 && c.a !== rep.target && c.b !== rep.target);
    if (strong.length) add('warn', 'Inputs that move together: ' + strong.slice(0, 3).map(c => c.a + ' & ' + c.b + ' (r = ' + c.r.toFixed(2) + ')').join(', ') + '. Historical data cannot tell which one is the real driver. A DOE can, because it sets them independently.');

    if (rep.task === 'regression' || rep.task === 'classification') {
      const b = rep.best, key = rep.metricKey;
      const base = rep.leaderboard.find(m => m.id === 'baseline');
      if (rep.task === 'regression') {
        const r2 = b.metrics.r2;
        const verdict = r2 >= 0.8 ? 'strong' : r2 >= 0.5 ? 'moderate' : r2 >= 0.2 ? 'weak' : 'very weak';
        add(r2 >= 0.5 ? 'good' : 'warn', b.name + ' explains ' + pct(Math.max(0, r2)) + ' of the variation in ' + rep.target + ' on unseen rows (' + verdict + '). Typical prediction error is ±' + fmt(b.metrics.rmse) + '.');
        if (r2 < 0.2) add('warn', 'The inputs here do not explain much. Key drivers are probably missing from the data (raw material, operator, environment, measurement). Run a fishbone with the team to find candidates.');
      } else {
        const acc = b.metrics.accuracy, bal = b.metrics.balancedAccuracy;
        add(bal >= 0.7 ? 'good' : 'warn', b.name + ' classifies ' + pct(acc) + ' of unseen rows correctly (balanced accuracy ' + pct(bal) + ', vs ' + pct(base ? base.metrics.balancedAccuracy : 1 / rep.classes.length) + ' by guessing).');
        const counts = {}; rep.actual.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
        const minority = Math.min.apply(null, Object.values(counts)) / rep.actual.length;
        if (minority < 0.15) add('warn', 'Classes are imbalanced: the rarest class is only ' + pct(minority) + ' of rows. Judge the model on balanced accuracy and on how well it catches the rare class (see the confusion matrix).');
      }
      if (base && b.id !== 'baseline' && b.metrics[key] - base.metrics[key] < 0.02) add('warn', 'The best model barely beats guessing. The inputs carry little signal about ' + rep.target + '.');
      const gap = rep.task === 'regression' ? rep.trainMetrics.r2 - b.metrics.r2 : rep.trainMetrics.balancedAccuracy - b.metrics.balancedAccuracy;
      if (gap > 0.2) add('info', 'The winner scores ' + pct(gap) + ' better on data it learned from than on unseen data. Some of what it learned is noise; trust the cross-validated score, not the training score.');
      const lin = rep.leaderboard.find(m => m.id === (rep.task === 'regression' ? 'linear' : 'logistic'));
      const nonlin = rep.leaderboard.filter(m => ['quadratic', 'forest', 'boosting', 'tree', 'knn'].includes(m.id) && m.metrics);
      const bestNon = nonlin.sort((a, c) => c.metrics[key] - a.metrics[key])[0];
      if (lin && lin.metrics && bestNon && bestNon.metrics[key] - lin.metrics[key] > 0.05) {
        rep.nonlinear = true;
        add('info', 'Curved or interacting models beat the straight-line model by ' + pct(bestNon.metrics[key] - lin.metrics[key]) + '. Expect sweet spots or factor interactions. A DOE should include center points and interaction terms.');
      } else if (lin && lin.metrics && bestNon) add('info', 'A straight-line model does about as well as complex ones. The relationships are close to linear, which makes them easy to act on.');
      const top = (rep.importance || []).filter(v => v.share > 0.05).slice(0, 3);
      if (top.length) add('good', 'Top drivers of ' + rep.target + ': ' + top.map(t => t.name + ' (' + pct(t.share) + ' of importance)').join(', ') + '.');
    }
    if (rep.doe) {
      const a = rep.doe;
      /* Reported on the adjusted p-values, not the raw ones. Every term is its own test and
         this design fits a dozen, so the list as a whole is a different claim from any
         single p-value in it. Measured on 500 analyses of a 2^4 design with three centre
         points and no real effect at all: 23.2% produced at least one term below p = 0.05.
         With Benjamini-Hochberg that falls to 1.8%, and on the same design carrying two
         real effects it still finds both every time - so the correction costs nothing here
         and removes roughly one false finding in four runs. */
      const mp = a.multiplicity || { terms: a.terms.length, fwerBound: null, rawSignificant: 0, fdrSignificant: 0 };
      const sig = a.terms.filter(t => sigP(t) < 0.05);
      add(sig.length ? 'good' : 'warn', sig.length
        ? 'DOE: effects that survive the multiple-testing correction (Benjamini\u2013Hochberg q < 0.05): ' +
          sig.map(t => t.name + ' (effect ' + (t.effect >= 0 ? '+' : '') + fmt(t.effect) + ', q = ' + (t.q < 0.001 ? '< 0.001' : t.q.toFixed(3)) + ')').join(', ') + '.'
        : 'DOE: no effect survives the multiple-testing correction. The factor ranges may be too narrow, or the noise too high; consider replicates.');
      if (mp.rawSignificant > mp.fdrSignificant) {
        add('info', (mp.rawSignificant - mp.fdrSignificant) + ' further effect' + (mp.rawSignificant - mp.fdrSignificant === 1 ? '' : 's') +
          ' cleared the raw p < 0.05 but not the correction. With ' + mp.terms + ' terms tested, at least one raw result below 0.05 would be expected in up to ' +
          Math.round(mp.fwerBound * 100) + '% of runs on data with no real effect in it at all, so the raw column is the one to read with care.');
      } else if (mp.terms >= 6) {
        add('info', mp.terms + ' terms were tested. At least one raw p below 0.05 would be expected in up to ' +
          Math.round(mp.fwerBound * 100) + '% of runs on data with no real effect in it, which is why the adjusted q-value is the one reported above.');
      }
      add('info', 'DOE model R² = ' + pct(a.r2) + (a.adjR2 !== null ? ', adjusted ' + pct(a.adjR2) : '') + (a.predR2 !== null ? ', predicted ' + pct(Math.max(0, a.predR2)) : '') + '. ' + a.method + '.');
      if (a.curvature && a.curvature.p !== null && a.curvature.p < 0.05) add('warn', 'Curvature: center points average ' + fmt(a.curvature.centerMean) + ' vs ' + fmt(a.curvature.cornerMean) + ' at the corners (p = ' + a.curvature.p.toFixed(3) + '). The response is not a flat plane, so there may be a sweet spot inside the range.');
      if (a.curvatureOnly) add('info', 'Center points show whether the response curves, but not which factor causes it, so all squared terms are pooled into one "Curvature" term.');
      const aliases = a.aliases.filter(x => !x.squares);
      if (aliases.length) add('info', 'Aliased terms (cannot be separated in this design): ' + aliases.slice(0, 4).map(x => x.term + ' with ' + x.with).join('; ') + (aliases.length > 4 ? '…' : '') + '.');
    }
    if (rep.clustering) {
      const c = rep.clustering;
      add(c.silhouette >= 0.5 ? 'good' : c.silhouette >= 0.25 ? 'info' : 'warn', 'Found ' + c.k + ' groups. Separation is ' + (c.silhouette >= 0.5 ? 'clear' : c.silhouette >= 0.25 ? 'reasonable' : 'weak; groups overlap, so treat them as a rough split') + ' (silhouette ' + c.silhouette.toFixed(2) + ').');
      for (const p of c.profiles) add('info', 'Group ' + p.cluster + ' (' + p.size + ' rows, ' + pct(p.share) + '): ' + p.traits.map(t => t.text).join('; ') + '.');
      if (c.outliers.length) add('warn', c.outliers.length + ' unusual row' + (c.outliers.length > 1 ? 's' : '') + ' sit far from every group: row ' + c.outliers.slice(0, 6).map(o => o.row).join(', ') + (c.outliers.length > 6 ? '…' : '') + ' (spreadsheet row numbers). Check them for data errors or special causes.');
    }
    return out;
  }

  // ---------- Next steps, mapped to DMAIC ----------
  /* The value a term is judged on: the Benjamini-Hochberg q where the analysis produced
     one, and the raw p only where it did not. Defined once, because three places decide
     what counts as a real effect - the findings, the next steps and the action plan - and
     two of them reading the raw column while the third reads the adjusted one is how a
     report ends up recommending a lever it has just disowned. */
  const sigP = t => (t.q === null || t.q === undefined ? t.p : t.q);

  function nextSteps(rep, prof, targetCol, features) {
    const steps = [];
    const add = (phase, title, text) => steps.push({ phase, title, text });
    const goalWord = rep.goal === 'min' ? 'minimize' : 'maximize';

    if (rep.doe) {
      const a = rep.doe;
      // Next steps act on effects that survive the correction, not on raw p-values.
      const sig = a.terms.filter(t => sigP(t) < 0.05);
      const best = rep.goal === 'min' ? a.optimum.min : a.optimum.max;
      const curved = (a.curvature && a.curvature.p !== null && a.curvature.p < 0.05) || a.terms.some(t => t.kind === 'square' && t.p < 0.05);
      const keyIdx = Array.from(new Set(sig.reduce((s, t) => s.concat(t.idx), [])));
      const keyFactors = (keyIdx.length ? keyIdx : a.terms.filter(t => t.kind === 'main').slice(0, 3).map(t => t.idx[0])).map(i => a.factors[i]);
      if (best) add('Improve', 'Run confirmation runs at the best settings', 'To ' + goalWord + ' ' + rep.target + ', the model points to ' + best.settings.map(s => s.name + ' = ' + (typeof s.actual === 'number' ? fmt(s.actual) : s.actual)).join(', ') + ' (predicted ' + fmt(best.y) + '). Run 3 to 5 confirmation runs there. If results land near the prediction, the model holds.');
      if (curved && keyFactors.filter(f => !f.categorical).length >= 2) add('Improve', 'Map the curve with a response-surface design', 'Curvature is present, so the best point may be inside your range. A central composite design on ' + keyFactors.filter(f => !f.categorical).map(f => f.name).join(', ') + ' will find it. A draft is in the DOE builder below.');
      if (a.aliases.some(x => !x.squares)) add('Analyze', 'Separate aliased effects', 'Some effects are confounded. A fold-over (re-running the design with signs flipped) or a few added runs will separate them.');
      if (a.dfe <= 0) add('Measure', 'Add replicates', 'This design has no replicate runs, so significance comes from Lenth\'s method, which is less sensitive. Replicating 2 to 4 runs (or center points) gives a true error estimate.');
      const inert = a.terms.filter(t => t.kind === 'main' && t.p > 0.2);
      if (inert.length) add('Improve', 'Set the inactive factors for cost or convenience', inert.map(t => t.name).join(', ') + ' showed no meaningful effect in this range. Set them where they are cheapest or easiest, and recheck if the range changes.');
      rep.doeRecommendation = Object.assign(
        curved && keyFactors.filter(f => !f.categorical).length >= 2 && keyFactors.length <= 5
          ? { type: 'ccd', centerPoints: 3, why: 'Response-surface follow-up on the factors that matter.' }
          : Object.assign(D.recommend(keyFactors.length), { why: 'Follow-up on the factors that matter, with replication to confirm effects. ' + D.recommend(keyFactors.length).why }),
        { factors: (curved ? keyFactors.filter(f => !f.categorical) : keyFactors).map(f => ({ name: f.name, low: f.low, high: f.high, categorical: f.categorical })) }
      );
      if (!curved && rep.doeRecommendation.type === 'full') rep.doeRecommendation.replicates = 2;
    } else if (rep.task === 'regression' || rep.task === 'classification') {
      const drivers = (rep.importance || []).filter(v => v.share >= 0.05).slice(0, 7);
      const cols = drivers.map(d => features.find(c => c.name === d.name)).filter(Boolean);
      add('Analyze', 'Sanity-check the top drivers with the people who run the process', 'Show the driver chart to operators and engineers. Drivers that make physical sense are worth testing; surprising ones may point to a data issue or a hidden variable riding along.');
      if (cols.length) {
        const factors = cols.map(c => {
          if (c.kind === 'numeric') return { name: c.name, low: round(c.stats.p10), high: round(c.stats.p90), categorical: false };
          return { name: c.name, low: c.levels[0], high: c.levels[1] || c.levels[0], categorical: true };
        });
        const rec = D.recommend(factors.length, { curvature: rep.nonlinear && factors.length <= 3 && factors.every(f => !f.categorical) });
        rep.doeRecommendation = Object.assign(rec, { factors });
        add('Improve', 'Prove cause and effect with a DOE', 'These results come from historical data, which shows correlation, not cause. A designed experiment on ' + factors.map(f => f.name).join(', ') + ' will confirm which ones really move ' + rep.target + ' and by how much. ' + rec.why + ' Levels are set at the 10th and 90th percentiles you already run at; widen them if it is safe. The run sheet is ready below.');
      }
      add('Improve', 'Use the what-if tool for quick scenarios', 'Try settings in the what-if panel to see the predicted ' + rep.target + '. Stay inside the ranges in your data; predictions outside them are guesses.');
      if (rep.task === 'classification') add('Control', 'Use it as an early warning', 'Score new batches or orders before they finish and flag the high-risk ones for review. Track how often the flags turn out right.');
    } else if (rep.clustering) {
      add('Analyze', 'Name the groups with subject-matter experts', 'Look at each group\'s profile and give it a name people recognize (for example "high-volume, low-margin"). Groups nobody can explain may be data artefacts.');
      if (rep.clustering.outliers.length) add('Measure', 'Investigate the unusual rows', 'Check the flagged rows for typos, unit mix-ups or special-cause events before you act on the groups.');
      add('Improve', 'Act on the groups', 'Use the groups to stratify: different targets, standard work or service levels per group. In a DOE, use the group as a blocking factor.');
      add('Define', 'Pick an outcome to predict', 'If you have a result column (yield, defects, revenue, churn), choose it as the target and rerun. The agent will then find the drivers and design an experiment.');
    }
    if (rep.spc) {
      /* The referrals used to fire on rep.spc existing and nothing else: everybody was told
         to run a Gage R&R and to use the drivers and a DOE, whether or not the sheet they had
         could support either. A recommendation somebody cannot act on is worse than none - it
         sends them looking for a study their data cannot produce, and it teaches them to skip
         the next recommendation too. Each one is earned from the data now, and where nothing
         is earned the honest output is what to go and collect. */
      for (const r of referrals(rep, prof, targetCol, features)) add(r.phase, r.title, r.text);
      const c = rep.spc.capability;
      if (c && c.Cpk !== null && c.Cpk < 1.33) {
        const offCenter = c.centeredCpk !== null && c.centeredCpk - c.Cpk > 0.2;
        add('Improve', offCenter ? 'Center the process, then reduce variation' : 'Reduce variation', (offCenter ? 'Move the mean from ' + fmt(c.mean) + ' toward ' + fmt((c.lsl + c.usl) / 2) + ' (Cpk ' + c.Cpk.toFixed(2) + ' → ' + c.centeredCpk.toFixed(2) + '). ' : '') + (c.centeredCpk !== null && c.centeredCpk < 1.33 ? 'To reach Cpk 1.33 the standard deviation must drop to about ' + fmt(c.sigmaFor133) + '.' : 'Then hold it there with the control chart.'));
      }
      if (rep.spc.imr && rep.spc.imr.signals.length) add('Analyze', 'Investigate the control-chart signals', 'Find out what happened at the flagged rows (shift change, new lot, maintenance). Remove special causes before judging capability.');
      if (rep.spc.driftError || rep.spc.countsError || rep.spc.rareError) add('Measure', 'Some charts could not be computed', 'The run reports which and why above. A chart that could not be drawn is not a chart that found nothing.');
      if (rep.spc.taguchi) add('Improve', 'Set factors for robustness', 'Use the most robust levels in the Taguchi table for factors that do not affect the average much. They cut variation for free.');
    }
    if (rep.desirability && rep.desirability.best.D > 0) add('Improve', 'Confirm the best compromise', 'Run 3 to 5 batches at the compromise settings in the desirability card and check every result against its acceptable range. Each result has its own model and its own error, so the combined prediction is less certain than any single one.');
    add('Control', 'Sustain the gain', 'Once a change is proven, update the standard work and put a control chart (I-MR or X-bar R) on ' + (rep.target || 'the key metric') + ' and its top driver, so drift is caught early.');
    const order = { Define: 0, Measure: 1, Analyze: 2, Improve: 3, Control: 4 };
    return steps.sort((a, b) => order[a.phase] - order[b.phase]);
  }
  function round(v) {
    // Three significant figures keeps suggested DOE levels practical (182.4 rather than 182.3871).
    return isFinite(v) ? Number(Number(v).toPrecision(3)) : v;
  }

  const GOOD_CLASS = /^(pass|passed|good|yes|y|true|1|success|successful|ok|accept|accepted|approved|win|won|on ?time|in ?spec|conforming|compliant|retained|active)$/i;
  const BAD_CLASS = /(fail|bad|^no$|^n$|false|^0$|defect|reject|late|scrap|churn|lost|out ?of ?spec|nonconform|error|delay)/i;
  // Ordered labels, best first, so tiers sort sensibly and "best" is the top tier.
  /* Best first. A ranked outcome is what makes "what moves this up a tier" a real question,
     so the ladders have to include the ones this industry actually uses - a batch
     disposition is ordered, and treating Reject and Release as unrelated labels throws away
     the most useful thing the model could say about them. A ladder may be a superset of the
     classes present; every class simply has to appear in it. */
  const LADDERS = [['diamond', 'platinum', 'gold', 'silver', 'bronze', 'basic'], ['excellent', 'very good', 'good', 'fair', 'poor', 'very poor'],
    ['very high', 'high', 'medium', 'low', 'very low'], ['a', 'b', 'c', 'd', 'e', 'f'],
    ['release', 'release with deviation', 'conditional release', 'quarantine', 'rework', 'reprocess', 'reject', 'destroy'],
    ['none', 'minor', 'major', 'critical'],
    ['in specification', 'out of trend', 'out of specification']];
  function ladderRank(classes) {
    for (const L of LADDERS) {
      const r = classes.map(c => L.indexOf(String(c).trim().toLowerCase()));
      if (r.every(v => v >= 0)) return r;
    }
    return null;
  }
  // Class indices ordered best first when the labels form a known ladder, else as given.
  function classOrder(classes) {
    const r = ladderRank(classes), idx = classes.map((_, i) => i);
    return r ? idx.sort((a, b) => r[a] - r[b]) : idx;
  }
  function guessFavorable(classes) {
    const lr = ladderRank(classes);
    if (lr) return lr.indexOf(Math.min(...lr));
    const g = classes.findIndex(c => GOOD_CLASS.test(String(c).trim()));
    if (g >= 0) return g;
    if (classes.length === 2) { const b = classes.findIndex(c => BAD_CLASS.test(String(c))); if (b >= 0) return 1 - b; }
    return classes.length - 1;
  }

  // Turns an encoded split (feature index, threshold) back into a question in the user's units.
  function splitQuestion(enc, f, t) {
    const part = enc.parts[enc.groups[f]];
    if (part.type === 'num') return { q: part.col.name + ' ≤ ' + fmt(t * part.s + part.m) + '?', leftIsYes: true };
    /* A column with too many levels for one-hot is carried as numbers - how common the
       level is, and how the result averaged for it - so the split is a threshold on one of
       those, not a yes/no on a level. Said that way rather than dressed up as a level test. */
    if (part.type === 'high') {
      const mp = part.maps[E.encOffset(enc, f)];
      const v = t * mp.s + mp.m;
      return { q: enc.labels[f] + ' ≤ ' + (mp.kind === 'freq' ? pct(v) : fmt(v)) + '?', leftIsYes: true };
    }
    const lv = enc.labels[f].slice(part.col.name.length + 3);
    return { q: part.col.name + ' = ' + lv + '?', leftIsYes: false };
  }

  /* Material for the "peek inside the model" view: a simple 3-level tree trained on the same
     data, real trees from forests and boosting, and a per-unit "recipe" for linear models. */
  function explainModel(rep, full, data, best, task, K) {
    const n = full.X.length;
    const opt = { maxDepth: 3, minLeaf: Math.max(3, Math.round(n / 40)), nClasses: task === 'classification' ? K : 0 };
    const tree = E.buildTree(full.X, data.y, range(n), opt, rng(rep.seed), 0);
    const pr = full.X.map(r => E.treePredictRow(tree, r));
    const score = task === 'regression' ? E.regressionMetrics(data.y, pr).r2
      : E.classificationMetrics(data.y, pr.map(p => p.indexOf(Math.max.apply(null, p))), K).accuracy;
    const question = (f, t) => splitQuestion(full.enc, f, t);
    rep.explain = { tree, score, question };
    if (full.fitted.trees) rep.explain.trees = full.fitted.trees.slice(0, 3);
    if (['linear', 'ridge', 'lasso'].includes(best.id) && full.fitted.w) {
      rep.explain.recipe = full.fitted.w.map((w, j) => {
        const part = full.enc.parts[full.enc.groups[j]];
        if (part.type === 'num') return { label: part.col.name, numeric: true, perUnit: w / part.s, effectRange: w / part.s * ((part.col.stats.p90 - part.col.stats.p10) || 0) };
        // No reference level to compare against when the column is carried as numbers.
        if (part.type === 'high') return { label: full.enc.labels[j], numeric: false, encoded: true, perUnit: w, effectRange: w };
        return { label: full.enc.labels[j], numeric: false, ref: part.kept[0], perUnit: w, effectRange: w };
      }).filter(r => Math.abs(r.effectRange) > 1e-9).sort((a, b) => Math.abs(b.effectRange) - Math.abs(a.effectRange));
    }
  }

  // ---------- Plain-English action plan ----------
  function actionPlan(rep) {
    if (rep.doe) return doeActions(rep);
    if (rep.clustering) return clusterActions(rep);
    if (!rep.pd) return null;
    const cls = rep.task === 'classification';
    const maximize = cls || rep.goal !== 'min';
    const favLabel = cls ? classLabel(rep) : '';
    const outcome = cls ? 'the chance of ' + rep.target + ' = ' + favLabel : rep.target;
    const from = cls && rep.fromClass !== null && rep.fromClass !== undefined ? rep.classes[rep.fromClass] : null;
    const fromTyp = v => (from ? 'from the typical ' + from + ' level of ' + v : 'from its typical ' + v);
    const yourTyp = v => (from ? 'the typical ' + from + ' row (' + v + ')' : 'your typical ' + v);
    const vsTyp = from ? 'Expected change for a typical ' + from + ' row: ' : 'Expected change vs typical: ';
    const better = (a, b) => (maximize ? a > b : a < b);
    const show = d => {
      if (cls ? Math.abs(d) < 0.005 : Math.abs(d) < 0.02 * (rep.targetSD || 1)) return 'about the same';
      return cls ? (d >= 0 ? '+' : '−') + Math.abs(Math.round(d * 100)) + ' percentage points' : (d >= 0 ? '+' : '−') + fmt(Math.abs(d));
    };
    const r3 = v => (typeof v === 'number' ? Number(v.toPrecision(3)) : v);
    const unitOf = v => (typeof v === 'number' ? fmt(v) : v);
    const spanRef = cls ? 0.03 : 0.1 * (rep.targetSD || 1);
    const maxSpan = Math.max(0, ...rep.pd.map(p => Math.max(...p.ys) - Math.min(...p.ys)));
    const items = [], quiet = [], best = {};
    for (const p of rep.pd) {
      const span = Math.max(...p.ys) - Math.min(...p.ys);
      if (span < spanRef || span < 0.15 * maxSpan) { quiet.push(p.name); continue; }
      let bi = 0; p.ys.forEach((v, i) => { if (better(v, p.ys[bi])) bi = i; });
      let ti = 0;
      if (p.kind === 'numeric') p.grid.forEach((g, i) => { if (Math.abs(g - p.typical) < Math.abs(p.grid[ti] - p.typical)) ti = i; });
      else ti = Math.max(0, p.grid.indexOf(p.typical));
      const gain = (p.ys[bi] - p.ys[ti]) * (maximize ? 1 : -1);
      best[p.name] = r3(p.grid[bi]);
      let verb, text;
      if (p.kind === 'numeric') {
        const last = p.grid.length - 1, close = Math.abs(gain) < 0.2 * span, typ = fmt(r3(p.typical)), to = fmt(r3(p.grid[bi]));
        if (bi >= last - 1) {
          verb = close ? 'Hold' : 'Increase';
          text = close ? 'Higher ' + p.name + ' is better, and ' + yourTyp(typ) + ' is already near the top of its useful range. Keep it there; lowering it would hurt ' + outcome + '.'
            : 'Raise ' + p.name + ' ' + fromTyp(typ) + ' toward ' + to + ', the high end of what your data covers.';
        } else if (bi <= 1) {
          verb = close ? 'Hold' : 'Decrease';
          text = close ? 'Lower ' + p.name + ' is better, and ' + yourTyp(typ) + ' is already near the bottom of its useful range. Keep it there; raising it would hurt ' + outcome + '.'
            : 'Lower ' + p.name + ' ' + fromTyp(typ) + ' toward ' + to + ', the low end of what your data covers.';
        } else {
          verb = 'Target';
          text = 'Keep ' + p.name + ' near ' + to + '. That is a sweet spot: going higher or lower both make ' + outcome + ' worse.' + (close ? ' ' + yourTyp(typ).replace(/^./, c => c.toUpperCase()) + ' is already close.' : '');
        }
      } else {
        let wi = 0; p.ys.forEach((v, i) => { if (better(p.ys[wi], v)) wi = i; });
        verb = 'Choose';
        text = 'Use ' + p.name + ' = ' + p.grid[bi] + ' where you can' + (p.grid[wi] !== p.grid[bi] ? '; ' + p.grid[wi] + ' gives the worst ' + (cls ? 'odds' : 'results') : '') + '.';
        if (Math.abs(gain) < 0.2 * span) { verb = 'Hold'; text = 'Keep using ' + p.name + ' = ' + p.grid[bi] + ' (already the most common choice' + (from ? ' among ' + from + ' rows' : '') + ')' + (p.grid[wi] !== p.grid[bi] ? ' and avoid ' + p.grid[wi] : '') + '.'; }
      }
      items.push({ verb, factor: p.name, text, impact: gain, impactText: vsTyp + (cls ? 'chance of ' + rep.target + ' = ' + favLabel + ' ' : rep.target + ' ') + show(gain), span });
    }
    items.sort((a, b) => b.span - a.span);
    const plan = {
      headline: (cls ? (from === null ? 'To raise the chance of ' + rep.target + ' = ' + favLabel
        : from === rep.classes[rep.favorable] ? 'To keep rows that are now ' + rep.target + ' = ' + from + (rep.favorableSet.length > 1 ? ' at ' + favLabel : ' where they are')
          : 'To move rows that are now ' + rep.target + ' = ' + from + ' to ' + favLabel)
        : (maximize ? 'To increase ' : 'To decrease ') + rep.target) + ', starting with the strongest lever:',
      items: items.slice(0, 5), quiet,
      confidence: confidence(rep)
    };
    const levers = items.slice(0, 5);
    if (levers.length && rep.averageWith) {
      const tuned = {};
      for (const it of levers) tuned[it.factor] = best[it.factor];
      const now = rep.averageWith({}), after = rep.averageWith(tuned);
      plan.combined = 'If every ' + (from ? from + ' row' : 'past row') + ' had used these settings, the model estimates ' + (cls
        ? 'the chance of ' + rep.target + ' = ' + favLabel + ' would average ' + pct(after) + ' instead of ' + pct(now) + '.'
        : rep.target + ' would average ' + fmt(after) + ' instead of ' + fmt(now) + '.');
      // Each lever was tuned on its own; together they can overshoot (e.g. past the target into another class).
      if ((after - now) * (maximize ? 1 : -1) < 0) plan.combined += ' Applied all at once, these settings overshoot and make things worse, so change one lever at a time and check the result after each.';
      plan.settings = levers.map(it => ({ name: it.factor, value: unitOf(tuned[it.factor]) }));
    }
    const nFrom = from ? rep.actual.filter(v => v === rep.fromClass).length : 0;
    plan.caveat = (from && nFrom < 30 ? 'Only ' + nFrom + ' rows are ' + from + ' now, so this plan is a rough guide. ' : '') + 'These come from patterns in past data, which show what moves together, not what causes what. Make one change at a time or, better, confirm with the DOE pre-filled below before changing the process. Stay inside the ranges you have run before.';
    return plan;
  }
  function confidence(rep) {
    if (rep.doe) return rep.doe.r2 >= 0.8 && rep.doe.dfe > 0 ? 'high' : rep.doe.r2 >= 0.6 ? 'medium' : 'low';
    if (!rep.best) return 'medium';
    const v = rep.best.metrics[rep.metricKey];
    if (rep.task === 'regression') return v >= 0.7 ? 'high' : v >= 0.4 ? 'medium' : 'low';
    return v >= 0.85 ? 'high' : v >= 0.7 ? 'medium' : 'low';
  }
  function doeActions(rep) {
    const a = rep.doe, maximize = rep.goal !== 'min';
    const opt = maximize ? a.optimum.max : a.optimum.min;
    if (!opt) return null;
    // The action plan too: a lever built on a false positive is the costly kind of wrong.
    const sig = a.terms.filter(t => sigP(t) < 0.05);
    const active = new Set(sig.reduce((s, t) => s.concat(t.idx), []));
    const mains = a.terms.filter(t => t.kind === 'main').sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect));
    const items = [], quiet = [];
    for (const m of mains) {
      const i = m.idx[0], f = a.factors[i], st = opt.settings[i];
      if (!active.has(i)) { quiet.push(f.name); continue; }
      const val = typeof st.actual === 'number' ? fmt(st.actual) : st.actual;
      const verb = f.categorical ? 'Choose' : st.coded > 0.5 ? 'Increase' : st.coded < -0.5 ? 'Decrease' : 'Target';
      const text = f.categorical ? 'Use ' + f.name + ' = ' + val + '.'
        : st.coded > 0.5 ? 'Set ' + f.name + ' high, at ' + val + ' (the top of the tested range).'
          : st.coded < -0.5 ? 'Set ' + f.name + ' low, at ' + val + ' (the bottom of the tested range).'
            : 'Set ' + f.name + ' to about ' + val + ', inside the tested range.';
      items.push({ verb, factor: f.name, text, impact: m.effect, impactText: 'Going from low to high changes ' + rep.target + ' by ' + (m.effect >= 0 ? '+' : '−') + fmt(Math.abs(m.effect)) + (sigP(m) < 0.05 ? '' : ' on its own (it matters through an interaction)') });
    }
    for (const t of sig.filter(t => t.kind === 'interaction')) {
      const [i, j] = t.idx;
      items.push({ verb: 'Combine', factor: a.factors[i].name + ' × ' + a.factors[j].name, text: a.factors[i].name + ' and ' + a.factors[j].name + ' work together: the effect of one depends on the setting of the other. Change them as a pair, using the settings above.', impact: t.effect, impactText: 'Interaction effect ' + (t.effect >= 0 ? '+' : '−') + fmt(Math.abs(t.effect)) });
    }
    return {
      headline: (maximize ? 'To increase ' : 'To decrease ') + rep.target + ', based on your experiment:',
      items, quiet, confidence: confidence(rep),
      combined: 'At these settings the model predicts ' + rep.target + ' of about ' + fmt(opt.y) + ', vs an average of ' + fmt(E.mean(a.y)) + ' across your runs.',
      settings: opt.settings.map(s => ({ name: s.name, value: typeof s.actual === 'number' ? fmt(s.actual) : s.actual })),
      caveat: 'A designed experiment does show cause and effect, but only inside the ranges you tested. Confirm with 3 to 5 runs at these settings before you change the standard.'
    };
  }
  function clusterActions(rep) {
    const c = rep.clustering;
    const items = c.profiles.map(p => ({
      verb: 'Segment', factor: 'Group ' + p.cluster,
      text: 'Group ' + p.cluster + ' (' + pct(p.share) + ' of rows) stands out for ' + p.traits.slice(0, 2).map(t => t.text.replace(/ \(.*\)$/, '')).join(' and ') + '. Treat it as its own segment: give it its own targets or service level, and ask the team why it differs.',
      impactText: p.size + ' rows'
    }));
    if (c.outliers.length) items.push({ verb: 'Check', factor: 'Unusual rows', text: 'Look at the ' + c.outliers.length + ' unusual rows first (row ' + c.outliers.slice(0, 5).map(o => o.row).join(', ') + (c.outliers.length > 5 ? '…' : '') + '). They are either data errors or special causes worth understanding.', impactText: '' });
    return { headline: 'What to do with these groups:', items, quiet: [], confidence: c.silhouette >= 0.5 ? 'high' : c.silhouette >= 0.25 ? 'medium' : 'low', caveat: 'Groups describe the data; they do not explain it. Name them with people who know the process.' };
  }

  /* Re-aims the action plan and driver curves at another outcome class, optionally only for
     rows currently in `fromIdx` (null = all rows). Needs no re-training: the model is reused. */
  // For ranked labels (Bronze < Silver < Gold), aiming at a class means "that class or better".
  function targetSet(rep, clsIdx) {
    const r = ladderRank(rep.classes);
    return r ? rep.classes.map((_, i) => i).filter(i => r[i] <= r[clsIdx]) : [clsIdx];
  }
  function classLabel(rep) {
    const set = rep.favorableSet || [rep.favorable];
    return rep.classes[rep.favorable] + (set.length > 1 ? ' or better' : '');
  }

  function retarget(rep, clsIdx, fromIdx) {
    if (rep.task !== 'classification' || !rep.pdFor) return rep;
    rep.favorable = clsIdx;
    rep.favorableSet = targetSet(rep, clsIdx);
    rep.fromClass = fromIdx === undefined ? null : fromIdx;
    rep.goal = 'class:' + rep.classes[clsIdx];
    rep.pd = rep.pdFor(rep.favorableSet, rep.fromClass);
    rep.actionPlan = actionPlan(rep);
    return rep;
  }

  root.MLAgent = { run, retarget, dScore, dOverall, classOrder, classLabel, columnRoles, otherResults, guessTarget, decideTask, guessFavorable, fmt, pct, MAX_ROWS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MLAgent;
})(typeof globalThis !== 'undefined' ? globalThis : this);
