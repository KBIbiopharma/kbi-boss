/* ML Agent tests. Run with: node --test tests/run-tests.js
   Covers parsing, models, DOE math, the agent's decisions, and a privacy lint that fails
   if code that could send or store data is ever added. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'engine.js'));
const D = require(path.join(ROOT, 'doe.js'));
const A = require(path.join(ROOT, 'agent.js'));
const S = require(path.join(ROOT, 'samples.js'));
const SPC = require(path.join(ROOT, 'spc.js'));
const VC = require(path.join(ROOT, 'variance.js'));
const TOL = require(path.join(ROOT, 'tolerance.js'));

test('CSV parser handles quotes, BOM, tabs and blank lines', () => {
  const t = E.parseCSV('﻿Name,Note,Value\r\n"Smith, J","said ""hi""",3\n\nLee,,4\n');
  assert.deepStrictEqual(t.columns, ['Name', 'Note', 'Value']);
  assert.deepStrictEqual(t.rows, [['Smith, J', 'said "hi"', '3'], ['Lee', '', '4']]);
  const tab = E.parseCSV('a\tb\n1\t2\n');
  assert.deepStrictEqual(tab.columns, ['a', 'b']);
  const semi = E.parseCSV('a;b\n1,5;2\n');
  assert.deepStrictEqual(semi.rows[0], ['1,5', '2']);
});

test('profiling detects numbers, categories, IDs and missing values', () => {
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push(['ID' + i, String(i * 1.5), i % 3 ? 'A' : 'B', i === 4 ? 'NA' : '1,2' + (i % 10) + '0', '5']);
  const p = E.profile({ columns: ['Sample ID', 'Temp', 'Line', 'Count', 'Const'], rows });
  const kinds = p.columns.map(c => c.kind);
  assert.deepStrictEqual(kinds, ['id', 'numeric', 'categorical', 'numeric', 'constant']);
  assert.strictEqual(p.columns[3].missing, 1);
  assert.strictEqual(p.columns[3].values[0], 1200);
});

test('t-distribution p-values match tables', () => {
  assert.ok(Math.abs(E.tTestP(2.228, 10) - 0.05) < 0.001);
  assert.ok(Math.abs(E.tTestP(1.96, 1e6) - 0.05) < 0.001);
  assert.ok(Math.abs(E.tTestP(0, 5) - 1) < 1e-9);
});

function linearData(n, seed) {
  const rand = E.rng(seed), rows = [];
  for (let i = 0; i < n; i++) {
    const x1 = rand() * 10, x2 = rand() * 5, g = rand() < 0.5 ? 'P' : 'Q';
    rows.push([x1.toFixed(3), x2.toFixed(3), g, (3 * x1 - 2 * x2 + (g === 'Q' ? 4 : 0) + (rand() - 0.5) * 0.5).toFixed(3)]);
  }
  return { columns: ['x1', 'x2', 'grp', 'y'], rows };
}

test('linear regression recovers a known relationship', () => {
  const prof = E.profile(linearData(120, 1));
  const [x1, x2, grp, y] = prof.columns;
  const data = E.supervisedData(prof, y, [x1, x2, grp], 'regression');
  const model = E.MODELS.find(m => m.id === 'linear');
  const folds = E.makeFolds(data.rows.length, 5, E.rng(1));
  const oof = E.crossValidate(model, data, 'regression', folds, 5, 1);
  assert.ok(E.regressionMetrics(data.y, oof).r2 > 0.99);
});

test('every model runs and beats the baseline on a clear signal', () => {
  const prof = E.profile(linearData(150, 2));
  const [x1, x2, grp, y] = prof.columns;
  const data = E.supervisedData(prof, y, [x1, x2, grp], 'regression');
  const folds = E.makeFolds(data.rows.length, 5, E.rng(2));
  for (const m of E.MODELS.filter(m => m.task !== 'classification')) {
    const r2 = E.regressionMetrics(data.y, E.crossValidate(m, data, 'regression', folds, 5, 2)).r2;
    if (m.id === 'baseline') assert.ok(r2 < 0.05, 'baseline ' + r2);
    else assert.ok(r2 > 0.7, m.id + ' r2 ' + r2);
  }
  // Classification: label is whether y is above its median.
  const med = E.median(data.y);
  const cTable = { columns: ['x1', 'x2', 'grp', 'label'], rows: linearData(150, 2).rows.map(r => [r[0], r[1], r[2], Number(r[3]) > med ? 'High' : 'Low']) };
  const cp = E.profile(cTable);
  const cd = E.supervisedData(cp, cp.columns[3], cp.columns.slice(0, 3), 'classification');
  const cf = E.makeFolds(cd.rows.length, 5, E.rng(3), cd.y);
  for (const m of E.MODELS.filter(m => m.task !== 'regression' && (!m.applicable || m.applicable(150, 3, 'classification', 2)))) {
    const met = E.classificationMetrics(cd.y, E.crossValidate(m, cd, 'classification', cf, 5, 3), 2);
    if (m.id === 'baseline') assert.ok(met.balancedAccuracy <= 0.55);
    else assert.ok(met.balancedAccuracy > 0.8, m.id + ' ' + met.balancedAccuracy);
  }
});

test('k-means finds well separated groups', () => {
  const rand = E.rng(5), X = [];
  for (const c of [[0, 0], [10, 10], [0, 10]]) for (let i = 0; i < 30; i++) X.push([c[0] + rand(), c[1] + rand()]);
  const km = E.kmeans(X, 3, E.rng(1), 5);
  for (let g = 0; g < 3; g++) assert.strictEqual(new Set(km.labels.slice(g * 30, g * 30 + 30)).size, 1);
  assert.ok(E.silhouette(X, km.labels, 3, E.rng(1)) > 0.8);
});

test('DOE designs have the right size and balance', () => {
  assert.strictEqual(D.fullFactorial(3).length, 8);
  const half = D.fractional(5, 1);
  assert.strictEqual(half.runs.length, 16);
  assert.strictEqual(half.resolution, 'V');
  const pb = D.plackettBurman(11);
  assert.strictEqual(pb.length, 12);
  for (let j = 0; j < 11; j++) {
    assert.strictEqual(pb.reduce((s, r) => s + r[j], 0), 0, 'column ' + j + ' balanced');
    for (let k = j + 1; k < 11; k++) assert.strictEqual(pb.reduce((s, r) => s + r[j] * r[k], 0), 0, 'columns orthogonal');
  }
  const pb20 = D.plackettBurman(15);
  for (let j = 0; j < 15; j++) for (let k = j + 1; k < 15; k++) assert.strictEqual(pb20.reduce((s, r) => s + r[j] * r[k], 0), 0);
  for (const k of [6, 7, 8]) {
    const f = D.fractional(k, k - 4);
    assert.strictEqual(f.runs.length, 16);
    for (let j = 0; j < k; j++) for (let m = j + 1; m < k; m++) assert.strictEqual(f.runs.reduce((s, r) => s + r[j] * r[m], 0), 0);
  }
  const ccd = D.generate([{ name: 'A', low: 10, high: 20 }, { name: 'B', low: 1, high: 3 }], { type: 'ccd', centerPoints: 5, randomize: false });
  assert.strictEqual(ccd.runs.length, 4 + 4 + 5);
  assert.ok(Math.abs(ccd.runs[4].actual[0] - (15 - 5 * Math.SQRT2)) < 0.01, 'rotatable alpha = 1.414');
  const bbd = D.generate(['A', 'B', 'C'].map(n => ({ name: n, low: 0, high: 1 })), { type: 'bbd', centerPoints: 3, randomize: false });
  assert.strictEqual(bbd.runs.length, 15);
  const cat = D.generate([{ name: 'T', low: 100, high: 200 }, { name: 'Supplier', low: 'North', high: 'East', categorical: true }], { type: 'full', centerPoints: 2, seed: 4 });
  assert.strictEqual(cat.runs.length, 6);
  assert.ok(cat.runs.every(r => ['North', 'East'].includes(r.actual[1])));
  assert.throws(() => D.generate([{ name: 'A', low: 0, high: 1 }], { type: 'bbd' }));
  const csv = D.toCSV(cat, [{ name: 'T' }, { name: 'Supplier' }], 'Yield');
  assert.ok(csv.startsWith('RunOrder,StdOrder,T,Supplier,Yield\n'));
});

test('DOE analysis recovers known effects from a replicated 2^3 factorial', () => {
  const rows = [];
  const rand = E.rng(9);
  for (let rep = 0; rep < 2; rep++) for (const x of D.fullFactorial(3)) {
    const [a, b, c] = x;
    rows.push([String(50 + 10 * a), String(5 + b), c > 0 ? 'Fast' : 'Slow', String(100 + 4 * a - 3 * b + 2 * a * b + (rand() - 0.5) * 0.2)]);
  }
  const prof = E.profile({ columns: ['Temp', 'Time', 'Mode', 'Y'], rows });
  const det = D.detect(prof, prof.columns.slice(0, 3), prof.columns[3]);
  assert.ok(det.isDOE, det.reason);
  const res = D.analyze(det, prof.columns[3]);
  const eff = n => res.terms.find(t => t.name === n);
  assert.ok(Math.abs(eff('Temp').effect - 8) < 0.2);
  assert.ok(Math.abs(eff('Time').effect + 6) < 0.2);
  assert.ok(Math.abs(eff('Temp × Time').effect - 4) < 0.2);
  assert.ok(eff('Temp').p < 0.001 && eff('Mode').p > 0.05);
  assert.strictEqual(res.optimum.max.settings[0].actual, 60);
});

test('DOE analysis flags aliasing in a half fraction', () => {
  const f = D.fractional(4, 1);
  const rows = f.runs.map(x => x.map(String).concat([String(10 + 3 * x[0] + 2 * x[1])]));
  const prof = E.profile({ columns: ['A', 'B', 'C', 'D', 'Y'], rows });
  const det = D.detect(prof, prof.columns.slice(0, 4), prof.columns[4]);
  const res = D.analyze(det, prof.columns[4]);
  assert.ok(res.aliases.length >= 3, 'two-factor interactions are aliased in pairs');
});

test('the agent picks the right task for each practice dataset', async () => {
  /* Every practice dataset is a biologics one now, and each is tagged with the function it
     belongs to so the picker can group them. Both of those are checked here: a dataset
     pointing at a column it does not emit, or at a function that does not exist, fails in
     front of whoever trusted it first. */
  const APPS = require(path.join(ROOT, 'applications.js'));
  const fnIds = APPS.FUNCTIONS.map(f => f[0]);
  const expect = {
    clones: 'regression', clonegroups: 'clustering', fedbatch: 'regression', capture: 'regression',
    formulation: 'regression', scaleup: 'regression', batches: 'classification', disposition: 'classification'
  };
  for (const s of S) {
    assert.ok(fnIds.indexOf(s.fn) >= 0, s.id + ' is tagged with function "' + s.fn + '", which is not in FUNCTIONS');
    assert.ok(s.title && s.blurb && s.kind, s.id + ' needs a title, kind and blurb');
    const first = s.files ? E.parseCSV(s.files[0].make()) : E.parseCSV(s.make());
    if (!s.files && s.target !== '__none__') {
      assert.ok(first.columns.indexOf(s.target) >= 0,
        s.id + ' declares target "' + s.target + '" which it does not emit');
    }
  }
  for (const s of S.filter(x => !x.files)) {
    const rep = await A.run(E.parseCSV(s.make()), { target: s.target });
    assert.strictEqual(rep.task, expect[s.id], s.id);
    assert.ok(rep.insights.length > 0 && rep.nextSteps.length > 0);
    if (s.id === 'fedbatch') {
      assert.ok(rep.doe, 'the factorial must be detected as a DOE');
      const sig = rep.doe.terms.filter(t => t.p < 0.05).map(t => t.name);
      /* Temperature and feed rate interact by construction, and the interaction is the
         finding worth having: a feed that helps warm hurts cool. */
      assert.ok(sig.includes('Temp_C') && sig.includes('FeedRate_mL_h') && sig.includes('Temp_C × FeedRate_mL_h'),
        'significant terms were ' + sig.join(', '));
    }
    if (s.id === 'clones') {
      /* The day 3 reads and the specific productivity are measured results, so the agent
         sets them aside as inputs by default rather than letting another measurement of the
         same batch predict the answer. That is the conservative call and it cannot know the
         reads came first - so this dataset doubles as the demonstration of that guard, and
         the score below is the one you get with the guard on. Re-including them deliberately
         is the exercise. */
      assert.ok(rep.features.indexOf('Specific_Productivity_qp') < 0,
        'a measured productivity must not silently become an input: ' + rep.features.join(', '));
      assert.ok(rep.features.indexOf('Promoter') >= 0, 'but the construct features must be used');
      assert.ok(rep.best.metrics.r2 > 0.7, 'and it should still model well on those alone: ' + rep.best.metrics.r2);
      assert.strictEqual(rep.importance[0].name, 'Promoter', 'the promoter is the dominant driver by construction');
      assert.ok(rep.doeRecommendation && rep.doeRecommendation.factors.length >= 2);
    }
    if (s.id === 'scaleup') {
      /* The confounding is the lesson. kLa falls as the vessel grows and that is what costs
         titer; Site B simply runs the big vessels more often. A careless read blames the
         site, so the dataset exists to be read carefully. */
      assert.strictEqual(rep.importance[0].name, 'kLa_per_h',
        'the real cause must lead, not the site it correlates with; got ' + rep.importance[0].name);
      const site = rep.importance.find(v => v.name === 'Site');
      assert.ok(!site || site.share < 0.25, 'Site must not dominate: ' + JSON.stringify(site));
    }
    if (s.id === 'clonegroups') assert.strictEqual(rep.clustering.k, 3, 'three phenotypes were built in');
  }
  // And the practice set must cover every analysis the tool offers, or the tour has a hole.
  const kinds = S.map(x => x.kind).join(' ');
  for (const need of ['Regression', 'Classification', 'DOE', 'clustering', 'join']) {
    assert.ok(kinds.indexOf(need) >= 0, 'no practice dataset covers ' + need);
  }
});

test('the agent gives a clear error instead of crashing on bad input', async () => {
  await assert.rejects(A.run({ columns: ['a', 'b'], rows: [] }, {}), /No data rows/);
  await assert.rejects(A.run(E.parseCSV('id,y\n1,2\n2,3\n3,4\n'), { target: 'y' }), /No usable input|at least 8/);
});

// ---------- Privacy lint ----------
// Fails if any code that could send data off the device or keep it after the tab closes
// appears in the app. The privacy self-test probes are the only allowed exceptions, and
// each such line must carry the PRIVACY-SELF-TEST marker.
/* XML and SVG namespace identifiers look like web addresses and are not. `xmlns="http://
   schemas.openxmlformats.org/..."` names a vocabulary inside a spreadsheet this tool
   writes to disk; nothing ever resolves it, and an .xlsx without it does not open. Only
   these three authorities are exempt, and only as namespace text - the rules against
   fetching, embedding and loading apply to every file regardless. */
const NAMESPACE = /https?:\/\/(?:schemas\.openxmlformats\.org|purl\.org|www\.w3\.org)\/[^"'\s]*/g;

test('privacy lint: no network, storage or tracking code', () => {
  const forbidden = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /EventSource/, /localStorage/, /sessionStorage/,
    /indexedDB/, /document\.cookie/, /serviceWorker/, /new\s+Worker/, /importScripts/, /new\s+Image\b/, /https?:\/\//, /\.src\s*=/, /window\.open/, /postMessage/];
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  const hits = [];
  for (const f of files) {
    fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      if (line.includes('PRIVACY-SELF-TEST')) return;
      // Charts become PDF images from an in-memory copy only: a data: URL, never a web address.
      if (line.includes('PRIVACY-LOCAL-IMAGE') && /\.src = 'data:image\/svg\+xml/.test(line) && !/https?:/.test(line)) return;
      /* The sequence optimizer runs in a Web Worker. A worker inherits the page's policy, so
         it can reach no further than the page can, but the file it loads and the messages it
         exchanges still have to be local: only this site's own relative .js files, and
         postMessage only between the page and that worker. */
      /* The academy links out to video explanations. A link is not a request: nothing is
         fetched, embedded or preloaded, and nothing leaves the browser until a reader
         clicks. One line in the project is allowed to know a web address, it must build
         exactly a youtube.com watch URL from an id, and it must carry no way to load
         anything by itself. */
      if (line.includes('PRIVACY-EXTERNAL-LINK') && /https:/.test(line)) {
        const code = line.replace(/(^|[^:'"\w])\/\/.*$/, '$1');
        assert.ok(/'https:\/\/www\.youtube\.com\/watch\?v='/.test(code),
          'the one external-link line must build a youtube watch URL and nothing else: ' + line.trim());
        assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|new\s+Image|\.src\s*=|iframe|window\.open|localStorage|document\.cookie/.test(code),
          'the external-link line must not be able to load or send anything: ' + line.trim());
        return;
      }
      if (line.includes('PRIVACY-LOCAL-WORKER')) {
        const code = line.replace(/\/\/.*$/, '');
        assert.ok(!/https?:|\/\//.test(code), 'worker line must not reference another origin: ' + line.trim());
        const paths = [...code.matchAll(/'([^']*\.js)'/g)].map(m => m[1]);
        for (const q of paths) assert.ok(/^[a-z0-9-]+\.js$/.test(q), 'worker may only load this site\'s own files: ' + q);
        assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|document\.cookie/.test(code), 'worker line must not add network or storage: ' + line.trim());
        return;
      }
      /* Strip trailing line comments - but not the "//" inside a web address. The
         original pattern cut everything from the first "//", so `const u = 'https://...'`
         became `const u = 'https:` and the one rule this lint exists to enforce could not
         see the one pattern it names. Only treat "//" as a comment when what precedes it
         is not a colon, a quote or a word character. */
      const code = line.replace(/(^|[^:'"\w])\/\/.*$/, '$1').replace(NAMESPACE, 'xml-namespace');
      for (const re of forbidden) if (re.test(code)) hits.push(f + ':' + (i + 1) + ' ' + re + ' → ' + line.trim());
    });
  }
  assert.deepStrictEqual(hits, []);
  const marked = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').split('\n').filter(l => l.includes('PRIVACY-SELF-TEST'));
  assert.ok(marked.every(l => /example\.com|new Image|document\.cookie/.test(l)), 'self-test lines only probe example.com');

  /* The external-link exception is deliberately hard to spread: one file, one line. If a
     second file ever claims it, that is a new outbound surface and wants arguing about,
     not a lint marker copied across. */
  const linkLines = [];
  for (const f of files) {
    fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      if (line.includes('PRIVACY-EXTERNAL-LINK') && /https:/.test(line)) linkLines.push(f + ':' + (i + 1));
    });
  }
  /* And pin where namespace text may appear: the spreadsheet writer, the chart drawing
     code, and the SVG-to-PDF export that has to restate the namespace on a cloned chart. A
     web address turning up anywhere else is a new outbound surface wearing a disguise. */
  const nsFiles = files.filter(f => NAMESPACE.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  NAMESPACE.lastIndex = 0;
  assert.deepStrictEqual(nsFiles.sort(), ['app.js', 'audit.js', 'charts.js'],
    'only the XML and SVG writers may carry namespace identifiers: ' + nsFiles.join(', '));

  assert.deepStrictEqual(linkLines.map(l => l.split(':')[0]), ['watch.js'],
    'only watch.js may hold a web address, and it holds exactly one: ' + linkLines.join(', '));
});

test('privacy lint: every page locks itself down and loads nothing from other servers', () => {
  for (const page of ['index.html', 'learn.html']) checkPage(page);
});

/* The pages carry the policy in a meta tag; a server may also send it as a header, and a
   browser enforces both. If the two ever disagree the stricter one silently wins, which is
   how a feature works on one host and breaks on another. They must match. */
test('the server configs send the same policy the pages carry', () => {
  const page = (fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];
  const rules = page.split(';').map(r => r.trim()).filter(Boolean);
  for (const file of ['web.config', 'DEPLOY.md']) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const policies = [...text.matchAll(/"(default-src[^"]*)"/g)].map(m => m[1]);
    assert.ok(policies.length, file + ' should document the policy');
    for (const p of policies) for (const rule of rules) assert.ok(p.includes(rule), file + ' is missing "' + rule + '"');
  }
});
function checkPage(page) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
  for (const rule of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "script-src 'self'", "img-src data: blob:", "base-uri 'none'"]) {
    assert.ok(csp.includes(rule), 'CSP must include ' + rule);
  }
  assert.ok(!/unsafe-inline|unsafe-eval/.test(csp), 'no unsafe CSP keywords');
  // Workers, where a page allows them at all, may only come from this site.
  assert.ok(/worker-src '(none|self)'/.test(csp), 'worker-src must be none or self');
  const srcs = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)].map(m => m[1]);
  for (const s of srcs) assert.ok(!/^(https?:)?\/\//.test(s), 'external resource: ' + s);
  assert.ok(!/<script>[^<]/.test(html), 'no inline scripts');
  assert.ok(!/\son[a-z]+="/.test(html), 'no inline event handlers');
}

test('round trip: a generated run sheet, once filled in, is analyzed as a DOE', async () => {
  const factors = [{ name: 'Temp', low: 150, high: 180 }, { name: 'Time', low: 30, high: 60 }, { name: 'Supplier', low: 'North', high: 'East', categorical: true }];
  const design = D.generate(factors, { type: 'full', centerPoints: 4, replicates: 1, seed: 3 });
  const rand = E.rng(8);
  const lines = D.toCSV(design, factors, 'Yield').trim().split('\n');
  const filled = [lines[0]].concat(design.runs.map((r, i) => {
    const a = (r.actual[0] - 165) / 15, b = (r.actual[1] - 45) / 15;
    return lines[i + 1] + (60 + 5 * a + 2 * b + (r.actual[2] === 'East' ? 1 : 0) + (rand() - 0.5) * 0.4).toFixed(2);
  })).join('\n');
  const rep = await A.run(E.parseCSV(filled), { target: 'Yield' });
  assert.ok(rep.doe, 'detected as a designed experiment');
  assert.ok(rep.dropped.some(d => d.name === 'RunOrder') && rep.dropped.some(d => d.name === 'StdOrder'));
  const temp = rep.doe.terms.find(t => t.name === 'Temp');
  assert.ok(Math.abs(temp.effect - 10) < 0.5 && temp.p < 0.01);
});

test('action plan turns drivers into plain-English moves', async () => {
  const get = id => S.find(s => s.id === id);
  const mold = await A.run(E.parseCSV(get('capture').make()), { target: 'Step_Yield_Pct', goal: 'max' });
  const items = mold.actionPlan.items;
  // A monotonic driver becomes a direction, and the direction has to follow the data.
  assert.strictEqual(items.find(i => i.factor === 'Residence_Time_min').verb, 'Increase');
  assert.strictEqual(items.find(i => i.factor === 'Load_g_per_L_resin').verb, 'Decrease');
  // A categorical driver names the worst level as well as the best.
  const lot = items.find(i => i.factor === 'Resin_Lot');
  assert.ok(lot && /RL-231/.test(lot.text) && /RL-224/.test(lot.text), 'best and worst resin lot named: ' + (lot && lot.text));
  assert.ok(/would average/.test(mold.actionPlan.combined));
  /* Flipping the goal must flip the advice. This is the check that it is reading the model
     rather than reciting a direction it likes. */
  const low = await A.run(E.parseCSV(get('capture').make()), { target: 'Step_Yield_Pct', goal: 'min' });
  assert.strictEqual(low.actionPlan.items.find(i => i.factor === 'Residence_Time_min').verb, 'Decrease');
  assert.strictEqual(low.actionPlan.items.find(i => i.factor === 'Load_g_per_L_resin').verb, 'Increase');

  /* A factor whose optimum sits inside its range must come back as "hold it here", not as a
     direction. The formulation screen has a real pH optimum away from both edges, which is
     exactly what a two-level screen is blind to by construction. */
  const form = await A.run(E.parseCSV(get('formulation').make()), { target: 'HMW_Increase_Pct', goal: 'min' });
  const ph = form.actionPlan.items.find(i => i.factor === 'pH');
  assert.strictEqual(ph.verb, 'Target', 'pH has a sweet spot');
  assert.ok(/sweet spot/.test(ph.text), ph.text);
  const buf = form.actionPlan.items.find(i => i.factor === 'Buffer');
  assert.ok(buf && /Histidine/.test(buf.text), 'the best buffer is named: ' + (buf && buf.text));

  const doe = await A.run(E.parseCSV(get('fedbatch').make()), { target: 'Titer_gL' });
  assert.ok(doe.actionPlan.items.some(i => i.factor === 'Temp_C' && i.verb === 'Increase'));
  assert.ok(doe.actionPlan.items.some(i => i.verb === 'Combine'), 'an interaction becomes a "change together" action');
  // And it must be the interaction that was actually built in.
  assert.ok(doe.actionPlan.items.some(i => i.verb === 'Combine' && /Temp_C/.test(i.factor) && /FeedRate/.test(i.factor)),
    'the temperature-by-feed interaction must be the one combined: ' +
    JSON.stringify(doe.actionPlan.items.filter(i => i.verb === 'Combine').map(i => i.factor)));

  const bat = await A.run(E.parseCSV(get('batches').make()), { target: 'Result' });
  assert.strictEqual(bat.classes[bat.favorable], 'Pass');
  assert.ok(bat.actionPlan.items.some(i => i.factor === 'Temperature' && i.verb === 'Decrease'));
  assert.ok(bat.explain.tree && bat.explain.trees.length === 3);
});

test('favorable outcome is guessed sensibly', () => {
  assert.strictEqual(A.guessFavorable(['Fail', 'Pass']), 1);
  assert.strictEqual(A.guessFavorable(['Late', 'OnTime']), 1);
  assert.strictEqual(A.guessFavorable(['Defect', 'OK']), 1);
  assert.strictEqual(A.guessFavorable(['Churned', 'Stayed']), 1);
  assert.strictEqual(A.guessFavorable(['0', '1']), 1);
});

test('every "learn more" link points to a lesson that exists', () => {
  const X = require(path.join(ROOT, 'explain.js'));
  const learn = fs.readFileSync(path.join(ROOT, 'learn.js'), 'utf8');
  const ids = new Set([...learn.matchAll(/id: '([a-z-]+)', group/g)].map(m => m[1]));
  assert.ok(ids.size >= 20, ids.size + ' lessons');
  for (const t of Object.values(X.MODEL_TOPIC)) assert.ok(ids.has(t), 'model topic ' + t);
  for (const [k, v] of Object.entries(X.READ)) assert.ok(ids.has(v[2]), 'chart ' + k + ' → ' + v[2]);
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'agent.js'), 'utf8');
  for (const m of app.matchAll(/learnLink\('([a-z-]+)'/g)) assert.ok(ids.has(m[1]), 'link ' + m[1]);
  // Links written straight into a page must point at a real lesson too.
  for (const page of ['index.html', 'learn.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    for (const m of html.matchAll(/href="learn\.html#([a-z-]+)"/g)) assert.ok(ids.has(m[1]), page + ' links to missing lesson ' + m[1]);
  }
});

test('columns that copy the target (data leakage) are set aside', async () => {
  const rand = E.rng(12), rows = [];
  for (let i = 0; i < 200; i++) {
    const t = 150 + rand() * 100, pass = (t > 190 && rand() > 0.2) ? 'Pass' : 'Fail';
    rows.push([t.toFixed(1), (rand() * 10).toFixed(2), pass === 'Pass' ? 'green' : 'red', pass]);
  }
  const rep = await A.run({ columns: ['Temp', 'Noise', 'Tag', 'Result'], rows }, { target: 'Result' });
  assert.ok(rep.dropped.some(d => d.name === 'Tag' && /copy of the result/.test(d.reason)));
  assert.ok(!rep.features.includes('Tag') && rep.features.includes('Temp'));
  assert.ok(rep.best.metrics.balancedAccuracy < 0.99, 'no fake perfect score');
  // A real but strong driver is not flagged.
  const reg = await A.run(E.parseCSV(S.find(s => s.id === 'capture').make()), { target: 'Step_Yield_Pct' });
  assert.ok(!(reg.leaks || []).length);
});

test('PDF writer produces a well-formed file', () => {
  const P = require(path.join(ROOT, 'pdf.js'));
  const doc = P.create({ title: 'Test (report)', footer: 'footer' });
  doc.h1('Heading').p('R² explains 89% of variation − with “quotes”, ≤ and ≥ signs. '.repeat(20)).h2('Table');
  doc.table([['A', 'B'], ['1', 'two'], ['3', 'a much longer cell that has to wrap onto several lines in its column']]);
  for (let i = 0; i < 80; i++) doc.p('Line ' + i, { bullet: '·' });
  doc.band('Increase', 'Raise pressure toward 98', 'Expected change +1.9');
  const bytes = doc.output();
  const s = Buffer.from(bytes).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
  const xref = Number(s.match(/startxref\n(\d+)/)[1]);
  assert.strictEqual(s.slice(xref, xref + 4), 'xref');
  const offs = [...s.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map(m => Number(m[1]));
  offs.forEach((o, i) => assert.ok(s.startsWith((i + 1) + ' 0 obj', o), 'object ' + (i + 1) + ' offset'));
  assert.ok(/\/Count [2-9]/.test(s), 'long content flows onto more pages');
  assert.ok(s.includes('R\xb2 explains'), 'superscript two kept in WinAnsi');
  assert.ok(!/[\u0100-\uffff]/.test(s), 'single-byte text only');
});

test('target outcome selector: ranked tiers, starting class and no re-training', async () => {
  const rep = await A.run(E.parseCSV(S.find(s => s.id === 'disposition').make()), { target: 'Disposition' });
  const ci = n => rep.classes.indexOf(n);
  /* A batch disposition is ordered, so "what moves this up a tier" is a real question.
     Treating Reject and Release as unrelated labels throws away the most useful thing the
     model can say about them, which is why the ladder carries this industry's own wording. */
  assert.strictEqual(rep.classes[rep.favorable], 'Release', 'the best disposition is the default target');
  assert.deepStrictEqual(A.classOrder(rep.classes).map(k => rep.classes[k]),
    ['Release', 'Release with deviation', 'Rework', 'Reject'], 'best to worst, not alphabetical');
  const best = rep.best;
  A.retarget(rep, ci('Rework'), ci('Reject'));
  assert.strictEqual(rep.best, best, 'same model, no re-training');
  assert.deepStrictEqual(rep.favorableSet.map(k => rep.classes[k]).sort(),
    ['Release', 'Release with deviation', 'Rework'], 'Rework means Rework or better');
  const plan = rep.actionPlan;
  assert.ok(/now Disposition = Reject to Rework or better/.test(plan.headline), plan.headline);
  const exp = plan.items.find(i => i.factor === 'Operator_Experience_Months');
  assert.strictEqual(exp.verb, 'Increase');
  assert.ok(/typical Reject level/.test(exp.text), exp.text);
  assert.ok(plan.items.some(i => i.factor === 'Deviation_Count' && i.verb === 'Decrease'));
  // The line barely matters by construction, which is usually the opposite of what the room
  // expects, so it must not show up as a lever.
  assert.ok(!plan.items.some(i => i.factor === 'Line'), 'the line has no real effect');
  const m = plan.combined.match(/average (\d+)% instead of (\d+)%/);
  assert.ok(m && Number(m[1]) > Number(m[2]), 'levers together help rather than overshoot: ' + plan.combined);
  /* Aiming the top class at itself reads as holding position, not as "or better" - there is
     nothing better than Release, and saying so would be nonsense. */
  A.retarget(rep, ci('Release'), ci('Release'));
  assert.ok(/keep rows that are now Disposition = Release where they are/.test(rep.actionPlan.headline),
    rep.actionPlan.headline);
  // Unranked classes keep the exact class.
  const pen = await A.run(E.parseCSV(fs.readFileSync(path.join(ROOT, 'demo-data', 'penguins.csv'), 'utf8')), { target: 'species' });
  A.retarget(pen, pen.classes.indexOf('Chinstrap'), pen.classes.indexOf('Adelie'));
  assert.deepStrictEqual(pen.favorableSet, [pen.classes.indexOf('Chinstrap')]);
  assert.ok(/to Chinstrap,/.test(pen.actionPlan.headline));
});

test('Six Sigma statistics match textbook values', () => {
  assert.ok(Math.abs(SPC.normCdf(1.96) - 0.975) < 1e-4);
  assert.ok(Math.abs(SPC.normInv(0.975) - 1.96) < 1e-3);
  assert.ok(Math.abs(SPC.normInv(1 - 3.4e-6) - 4.5) < 0.01, '3.4 PPM is 4.5 sigma long term');
  const a = SPC.attribute(9332, 10000);
  assert.ok(Math.abs(a.sigmaLevel - 3) < 0.02, '6.68% defects is 3 sigma');
  // Symmetric data, mean 100, spec 94 to 106.
  const y = []; for (let i = 0; i < 400; i++) y.push(100 + 2 * SPC.normInv((i + 0.5) / 400));
  const c = SPC.capability(y, { lsl: 94, usl: 106, target: 100 }, false);
  assert.ok(Math.abs(c.mean - 100) < 1e-9 && Math.abs(c.Pp - 1) < 0.03 && Math.abs(c.Ppk - c.Pp) < 1e-6, 'Pp = Ppk = 1 when centered at 3 sigma');
  assert.strictEqual(c.Cp, null, 'no short-term Cp without time order');
  assert.ok(Math.abs(c.ppm - 2700) < 250, 'about 2,700 PPM at plus or minus 3 sigma');
  const off = SPC.capability(y.map(v => v + 2), { lsl: 94, usl: 106 }, false);
  assert.ok(off.Ppk < off.Pp - 0.3 && Math.abs(off.centeredCpk - off.Pp) < 1e-9);
  assert.ok(Math.abs(SPC.snRatio([10, 10], 'larger') - 20) < 1e-9 && Math.abs(SPC.snRatio([10, 10], 'smaller') + 20) < 1e-9);
  const t = SPC.taguchi([10, 11, 10, 11, 5, 15, 4, 16], [{ name: 'Supplier', values: ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'B'] }], 'nominal');
  assert.strictEqual(t[0].best.level, 'A', 'the consistent supplier is the robust one');
  const steady = []; const rand = E.rng(2); for (let i = 0; i < 40; i++) steady.push(50 + (rand() - 0.5) * 2 + (i >= 25 ? 3 : 0));
  const m = SPC.imr(steady);
  assert.ok(m.signals.some(s => s.i >= 25), 'a shift is flagged');
  const b = SPC.box([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
  assert.deepStrictEqual(b.outliers, [100]);
});

test('Six Sigma mode in the agent', async () => {
  const get = id => S.find(s => s.id === id);
  const mold = await A.run(E.parseCSV(get('capture').make()), { target: 'Step_Yield_Pct', sixSigma: { lsl: 85, usl: 95, target: 90, timeOrdered: true } });
  const c = mold.spc.capability;
  assert.ok(c && c.Cpk < c.Cp && c.verdict === 'not capable');
  assert.ok(mold.spc.imr && mold.spc.boxes.by.some(b => b.name === 'Resin_Lot') && mold.spc.taguchi.type === 'nominal');
  assert.ok(mold.insights.some(i => /Process capability: Cpk/.test(i.text)));
  assert.ok(mold.nextSteps.some(s => /Gage R&R/.test(s.text)));
  /* Centred against these limits, so the advice is to reduce spread rather than to move the
     mean. Both branches are checked, because an agent that only ever says one of them is
     reciting rather than reading the data. */
  assert.ok(mold.nextSteps.some(s => /Reduce variation/.test(s.title)), 'centred: reduce spread');
  const offCentre = await A.run(E.parseCSV(get('capture').make()), { target: 'Step_Yield_Pct', sixSigma: { lsl: 86, usl: 99, target: 92.5, timeOrdered: true } });
  assert.ok(offCentre.nextSteps.some(s => /Center the process/.test(s.title)), 'off centre: move the mean first');
  assert.ok(offCentre.spc.capability.centeredCpk > offCentre.spc.capability.Cpk,
    'and centring must be shown to be worth more than tightening here');
  const plain = await A.run(E.parseCSV(get('capture').make()), { target: 'Step_Yield_Pct' });
  assert.strictEqual(plain.spc, undefined, 'standard mode adds nothing');
  const doe = await A.run(E.parseCSV(get('fedbatch').make()), { target: 'Titer_gL', sixSigma: { lsl: 2.5 } });
  assert.ok(doe.spc.designed && !doe.spc.imr, 'no control chart on a designed experiment');
  assert.ok(doe.insights.some(i => /designed experiment: its spread/.test(i.text)));
  const bat = await A.run(E.parseCSV(get('batches').make()), { target: 'Result', sixSigma: {} });
  assert.ok(Math.abs(bat.spc.attribute.p - bat.actual.filter(k => bat.classes[k] !== 'Pass').length / bat.actual.length) < 1e-12);
});

test('neural network learns non-linear patterns, stops early and is reproducible', async () => {
  const rand = E.rng(3), X = [], y = [], yc = [];
  for (let i = 0; i < 500; i++) { const a = rand() * 4 - 2, b = rand() * 4 - 2; X.push([a, b]); y.push(Math.sin(a * 2) * b); yc.push(a * a + b * b < 1.5 ? 1 : 0); }
  const run = () => { const t = E.mlpTrainer(X, y, { task: 'regression', rand: E.rng(1) }); while (!t.step(20)); return t; };
  const t1 = run(), m = t1.model();
  assert.ok(E.regressionMetrics(y, m.predict(X)).r2 > 0.95, 'fits sin(2a) * b');
  assert.ok(E.regressionMetrics(y, E.fitRidgeCore(X, y, 1e-6).predict(X)).r2 < 0.1, 'a straight line cannot');
  assert.ok(t1.bestEpoch <= t1.epoch && t1.history.length === t1.epoch && t1.history[0].val !== null);
  assert.deepStrictEqual(run().model().predict(X.slice(0, 5)), m.predict(X.slice(0, 5)), 'same seed, same network');
  const tc = E.mlpTrainer(X, yc, { task: 'classification', nClasses: 2, rand: E.rng(2) }); while (!tc.step(20));
  assert.ok(E.classificationMetrics(yc, tc.model().predict(X), 2).accuracy > 0.95);
  const rep = await A.run(E.parseCSV(S.find(s => s.id === 'capture').make()), { target: 'Step_Yield_Pct' });
  const nn = rep.leaderboard.find(b => b.id === 'mlp');
  assert.ok(nn && nn.metrics.r2 > 0.5, 'on the leaderboard with a real score (160 rows is small for a network)');
  assert.ok(rep.nn && rep.nn.history.length > 5 && rep.nn.sizes[1] === 32 && rep.nn.sizes[2] === 16);
  const tiny = await A.run(E.parseCSV(S.find(s => s.id === 'fedbatch').make()), { target: 'Titer_gL' });
  assert.ok(!tiny.leaderboard.some(b => b.id === 'mlp') && !tiny.nn, 'skipped on tiny data');
});

const M = require(path.join(ROOT, 'merge.js'));
const AU = require(path.join(ROOT, 'audit.js'));
const bioFiles = () => { const s = S.find(x => x.id === 'bioqc'); return s.files.map(f => E.parseCSV(f.make())); };
const joinBio = () => { const [log, qc] = bioFiles(); return M.join(log, qc, { leftKey: 'BatchID', rightKey: 'Batch ID', how: 'inner', bName: 'QC' }); };

test('key-based merge: suggested keys, replicate averaging and unmatched IDs', () => {
  const [log, qc] = bioFiles();
  const sug = M.suggestKeys(log, qc);
  assert.strictEqual(sug[0].left, 'BatchID');
  assert.strictEqual(sug[0].right, 'Batch ID');
  assert.ok(!sug.some(s => /Titer|HMW/.test(s.left + s.right)), 'measured decimals are never suggested as keys');
  const { table, stats } = joinBio();
  assert.strictEqual(stats.matchedKeys, 60);
  assert.strictEqual(stats.outputRows, 60);
  assert.deepStrictEqual(stats.unmatchedLeft, ['B1061', 'B1062', 'B1063', 'B1064']);
  assert.deepStrictEqual(stats.unmatchedRight, ['B1065', 'B1066']);
  assert.deepStrictEqual(stats.droppedReplicateColumns, ['Lane']);
  assert.ok(!table.columns.includes('Lane'));
  // Averaging: the joined purity for B1001 is the mean of its two lanes.
  const lanes = qc.rows.filter(r => r[0] === 'B1001').map(r => Number(r[2]));
  const row = table.rows.find(r => r[0] === 'B1001');
  assert.ok(Math.abs(Number(row[table.columns.indexOf('Purity_Pct')]) - (lanes[0] + lanes[1]) / 2) < 1e-9);
  assert.strictEqual(row[table.columns.indexOf('Analyst')], 'A.R. | J.K.');
  assert.strictEqual(row[table.columns.indexOf('Replicates (QC)')], '2');
  // Keys match after trimming and ignoring case; a left join keeps unmatched rows.
  const a = { columns: ['Lot', 'x'], rows: [[' lot-1 ', '1'], ['LOT-2', '2'], ['LOT-3', '3']] }, b = { columns: ['lot', 'y'], rows: [['LOT-1', '5'], ['lot-2', '6']] };
  assert.strictEqual(M.join(a, b, { leftKey: 'Lot', rightKey: 'lot', how: 'inner' }).table.rows.length, 2);
  const left = M.join(a, b, { leftKey: 'Lot', rightKey: 'lot', how: 'left' });
  assert.strictEqual(left.table.rows.length, 3);
  assert.strictEqual(left.table.rows[2][2], '');
});

test('column roles: analytical results, measurements, record info and dates', () => {
  const p = E.profile({ columns: ['BatchID', 'Temp', 'Time', 'VisitsPerMonth', 'Purity', 'HMW_Pct', 'LMW_Pct', 'RetentionTime', 'MolecularWeight', 'MainBand_kDa', 'Analyst', 'RunDate', 'Yield'],
    rows: Array.from({ length: 30 }, (_, i) => ['B' + i, String(30 + i % 7), String(10 + i % 4), String(i % 9), String(95 + (i % 5) / 2), String(1 + i % 3), String(0.5 + i % 2), String(12 + (i % 4) / 10), String(148 + i % 3), String(150 + i % 2), i % 2 ? 'AB' : 'CD', '2024-01-' + String(1 + i % 28).padStart(2, '0'), String(80 + i % 6)]) });
  const r = A.columnRoles(p);
  const role = n => r[n].role;
  assert.strictEqual(role('Purity'), 'result');
  assert.strictEqual(role('HMW_Pct'), 'result');
  assert.strictEqual(r.HMW_Pct.label, 'result: impurity');
  assert.strictEqual(role('LMW_Pct'), 'result');
  assert.strictEqual(role('Yield'), 'result');
  assert.strictEqual(role('RetentionTime'), 'measurement');
  assert.strictEqual(role('MolecularWeight'), 'measurement');
  assert.strictEqual(role('MainBand_kDa'), 'measurement');
  assert.strictEqual(role('Analyst'), 'meta');
  assert.strictEqual(role('RunDate'), 'time');
  assert.strictEqual(role('Temp'), 'input');
  assert.strictEqual(role('Time'), 'input', 'a numeric Time column is a process setting');
  assert.strictEqual(role('VisitsPerMonth'), 'input');
  assert.strictEqual(A.guessTarget(p), 'Purity');
  assert.deepStrictEqual(A.otherResults(p, 'Purity').sort(), ['Analyst', 'HMW_Pct', 'LMW_Pct', 'MainBand_kDa', 'MolecularWeight', 'RetentionTime', 'RunDate', 'Yield'].sort());
});

test('merged QC data: other results are set aside, so purity is not leaked', async () => {
  const { table } = joinBio();
  const rep = await A.run(table, { target: 'Purity_Pct' });
  assert.ok(!rep.features.includes('HMW_Pct') && !rep.features.includes('LMW_Pct') && !rep.features.includes('Titer_g_L'));
  assert.ok(rep.features.includes('Temp_C'));
  assert.ok(rep.best.metrics.r2 > 0.8 && rep.best.metrics.r2 < 0.999, 'R² ' + rep.best.metrics.r2);
  // Aggregates (HMW) rise with agitation and temperature, fragments (LMW) with harvest day.
  assert.deepStrictEqual(rep.importance.slice(0, 3).map(v => v.name).sort(), ['Agitation_rpm', 'HarvestDay', 'Temp_C']);
});

test('QC spec limits: one-sided LSL on purity', async () => {
  const { table } = joinBio();
  const rep = await A.run(table, { target: 'Purity_Pct', sixSigma: { lsl: 95, usl: null, target: 97, timeOrdered: true } });
  const c = rep.spc.capability;
  assert.strictEqual(c.Cp, null, 'no Cp without both limits');
  assert.strictEqual(c.Pp, null);
  assert.ok(c.Cpk !== null && Math.abs(c.Cpk - c.Cpl) < 1e-12, 'Cpk is the lower side only');
  assert.ok(c.pAbove === 0 && c.ppm > 0);
  assert.ok(c.loss !== null && c.loss > 0, 'Taguchi loss uses the target');
  assert.ok(rep.spc.taguchi && rep.spc.taguchi.type === 'nominal');
});

test('desirability: scores, overall D and a better compromise on the QC data', async () => {
  assert.strictEqual(A.dScore({ goal: 'max', low: 90, high: 98 }, 94), 0.5);
  assert.strictEqual(A.dScore({ goal: 'min', low: 1, high: 3 }, 3.5), 0);
  assert.strictEqual(A.dScore({ goal: 'target', low: 10, high: 20, target: 12 }, 11), 0.5);
  assert.strictEqual(A.dScore({ goal: 'target', low: 10, high: 20, target: 12 }, 16), 0.5);
  assert.strictEqual(A.dOverall([1, 0], [1, 1]), 0, 'one failing result makes D zero');
  assert.ok(Math.abs(A.dOverall([0.25, 1], [1, 1]) - 0.5) < 1e-12);
  assert.ok(Math.abs(A.dOverall([0.25, 1], [2, 1]) - Math.pow(0.25, 2 / 3)) < 1e-12, 'weights tilt the geometric mean');
  const { table } = joinBio();
  const multi = { responses: [
    { name: 'Purity_Pct', goal: 'max', low: 94, high: 97.5, weight: 3 },
    { name: 'Titer_g_L', goal: 'max', low: 2, high: 3.5, weight: 2 },
    { name: 'LMW_Pct', goal: 'min', low: 0.6, high: 1.6, weight: 1 }
  ] };
  const rep = await A.run(table, { target: 'Purity_Pct', multi });
  const d = rep.desirability;
  assert.ok(d && d.specs.length === 3);
  assert.ok(!rep.features.includes('Titer_g_L') && !rep.features.includes('LMW_Pct'), 'optimized results are never inputs');
  assert.ok(d.best.D > d.typical.D + 0.1, 'D ' + d.typical.D + ' → ' + d.best.D);
  assert.ok(Number.isInteger(d.best.values.HarvestDay) && Number.isInteger(d.best.values.Agitation_rpm), 'whole-number inputs stay whole');
  const again = d.evaluate(d.best.values);
  assert.ok(Math.abs(again.D - d.best.D) < 1e-9);
  assert.ok(rep.nextSteps.some(s => /compromise/.test(s.title)));
  await assert.rejects(A.run(table, { target: 'Purity_Pct', multi: { responses: [{ name: 'Purity_Pct', goal: 'max', low: 98, high: 94 }, { name: 'Titer_g_L', goal: 'max', low: 2, high: 3 }] } }), /low value must be below/);
});

test('audit package: SHA-256, zip and xlsx structure, audit trail content', async () => {
  assert.strictEqual(AU.sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.strictEqual(AU.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.strictEqual(AU.sha256('a'.repeat(1000)), require('node:crypto').createHash('sha256').update('a'.repeat(1000)).digest('hex'));
  const z = AU.zip([{ name: 'a.txt', data: 'hello' }, { name: 'b/c.txt', data: 'world!' }]);
  const dv = new DataView(z.buffer);
  assert.strictEqual(dv.getUint32(0, true), 0x04034b50);
  assert.strictEqual(dv.getUint32(z.length - 22, true), 0x06054b50);
  assert.strictEqual(dv.getUint16(z.length - 12, true), 2, 'two entries');
  assert.strictEqual(dv.getUint32(14, true), AU.crc32(AU.utf8('hello')));

  const [log, qc] = bioFiles();
  const { table, stats } = joinBio();
  const opts = { target: 'Purity_Pct', sixSigma: { lsl: 95, usl: null, target: null, timeOrdered: true }, multi: { responses: [{ name: 'Purity_Pct', goal: 'max', low: 94, high: 97.5, weight: 1 }, { name: 'LMW_Pct', goal: 'min', low: 0.6, high: 1.6, weight: 1 }] } };
  const rep = await A.run(table, opts);
  const src = (name, t) => ({ name, bytes: 100, rows: t.rows.length, cols: t.columns.length, sha256: AU.sha256(name) });
  const ctx = { sources: [src('log.csv', log), src('qc.csv', qc)], merge: Object.assign({ left: 'log.csv', right: 'qc.csv', leftKey: 'BatchID', rightKey: 'Batch ID' }, stats), options: opts, when: new Date(Date.UTC(2026, 0, 2)), table };
  const tr = AU.trail(rep, ctx), txt = AU.trailText(tr);
  for (const want of ['Input files', 'Merge (join)', 'Analysis settings', 'Agent log', 'Data handling', 'Review and approval', 'SHA-256 ' + AU.sha256('qc.csv'), 'Lane', 'B1065', 'cross-validation', 'Not a validated GxP system', 'LSL 95', 'Random seed']) assert.ok(txt.includes(want), 'audit trail mentions ' + want);
  const sh = AU.sheets(rep, ctx), names = sh.map(s => s.name);
  for (const n of ['Summary', 'Audit trail', 'Columns', 'Models', 'Drivers', 'Capability', 'Control chart', 'Desirability', 'Data analyzed']) assert.ok(names.includes(n), 'sheet ' + n);
  const models = sh.find(s => s.name === 'Models').rows;
  assert.strictEqual(typeof models[1][1], 'number', 'scores stay numbers');
  assert.strictEqual(sh.find(s => s.name === 'Data analyzed').rows.length, table.rows.length + 1);
  const book = AU.xlsx(sh, { title: 'Test' });
  assert.strictEqual(new DataView(book.buffer).getUint32(0, true), 0x04034b50);
  const text = Buffer.from(book).toString('latin1');
  for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet' + sh.length + '.xml']) assert.ok(text.includes(part), part);
  assert.ok(text.includes('<sheet name="Audit trail"'));

  /* A variance or Gage R&R run must reach the audit trail and the workbook too, or a study
     that drove a decision leaves no record in the package that documents the decision. */
  const vcRows = [];
  [[1, 2, 3], [4, 5, 6], [7, 8, 9]].forEach((v, i) => v.forEach(x => vcRows.push({ group: 'G' + i, value: x })));
  const tk = VC.tukey(vcRows, 0.05);
  const vcCtx = Object.assign({}, ctx, { variance: {
    kind: 'components', when: '2026-01-02T00:00:00.000Z', columns: { group: 'Resin_Lot', value: 'Yield' },
    groups: tk.a, N: tk.N, balanced: tk.balanced, n0: tk.n0, between: tk.between, within: tk.within,
    total: tk.total, sdTotal: tk.sdTotal, icc: tk.icc, negative: tk.negative, p: tk.p,
    significant: tk.significant, alpha: tk.alpha, qCrit: tk.qCrit, anova: tk.anova,
    components: tk.components, groupStats: tk.groups, pairs: tk.pairs, differing: tk.pairs.filter(x => x.different).length } });
  const vcTxt = AU.trailText(AU.trail(rep, vcCtx));
  for (const want of ['Variance components', 'Resin_Lot', 'Pairwise comparisons', 'Tukey']) assert.ok(vcTxt.includes(want), 'variance trail mentions ' + want);
  const vcSheet = AU.sheets(rep, vcCtx).find(x => x.name === 'Variance components');
  assert.ok(vcSheet, 'a variance run must get its own sheet');
  assert.ok(vcSheet.rows.some(r => r[0] === 'Between-group variance'));
  assert.ok(vcSheet.rows.some(r => r[0] === 'Pair A'), 'the pairwise comparisons must be in the workbook');

  const grrRows = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++)
    grrRows.push({ part: 'P' + i, operator: 'O' + j, value: 10 + i + j * 0.1 + k * 0.05 });
  const gg = VC.gageRR(grrRows, { lsl: 8, usl: 16 });
  const grrCtx = Object.assign({}, ctx, { variance: {
    kind: 'grr', when: '2026-01-02T00:00:00.000Z', columns: { part: 'Sample', operator: 'Analyst', value: 'Result' },
    parts: gg.parts.length, operators: gg.operators.length, reps: gg.reps, N: gg.N, model: gg.model,
    pInteraction: gg.pInteraction, keepInteraction: gg.keepInteraction, anova: gg.anova, components: gg.components,
    vRepeat: gg.vRepeat, vReprod: gg.vReprod, vGrr: gg.vGrr, vPart: gg.vPart, vTotal: gg.vTotal,
    pctStudyGrr: gg.pctStudyGrr, pctTolerance: gg.pctTolerance, tolerance: gg.tolerance,
    lsl: gg.lsl, usl: gg.usl, ndc: isFinite(gg.ndc) ? gg.ndc : null, verdict: gg.verdict, judgedOn: gg.judgedOn } });
  const grrTxt = AU.trailText(AU.trail(rep, grrCtx));
  for (const want of ['Measurement system analysis', 'Gage R&R verdict', 'Analyst']) assert.ok(grrTxt.includes(want), 'Gage R&R trail mentions ' + want);
  const grrSheet = AU.sheets(rep, grrCtx).find(x => x.name === 'Measurement system');
  assert.ok(grrSheet, 'a Gage R&R run must get its own sheet');
  assert.ok(grrSheet.rows.some(r => r[0] === 'Verdict'));
  // Both workbooks must still build, with the extra sheet in place.
  for (const c of [vcCtx, grrCtx]) assert.strictEqual(new DataView(AU.xlsx(AU.sheets(rep, c), { title: 'T' }).buffer).getUint32(0, true), 0x04034b50);

  /* A specification limit and a sample size are decisions someone has to defend later, so
     they have to appear in the package that documents the decision. */
  const ti = TOL.toleranceInterval([98.1, 97.4, 98.9, 97.8, 98.3, 98.6, 97.2, 98.0, 98.4, 97.9], { p: 0.99, conf: 0.95, sided: 2, lsl: 95, usl: 101 });
  const tolCtx = Object.assign({}, ctx, { tolerance: {
    kind: 'tolerance', when: '2026-01-02T00:00:00.000Z', column: 'Purity_Pct',
    n: ti.n, mean: ti.mean, sd: ti.sd, df: ti.df, p: ti.p, conf: ti.conf, sided: ti.sided, bound: ti.bound,
    k: ti.k, limitingK: ti.limitingK, lower: ti.lower, upper: ti.upper, min: ti.min, max: ti.max,
    lsl: ti.lsl, usl: ti.usl, inside: ti.inside, needed: ti.needed, achievable: ti.achievable,
    normalityP: ti.normality.p, normalityStat: ti.normality.adjusted, normal: ti.normality.normal } });
  const tolTxt = AU.trailText(AU.trail(rep, tolCtx));
  for (const want of ['Tolerance interval', 'Purity_Pct', 'Normality of the results', 'Limits supported by the data']) {
    assert.ok(tolTxt.includes(want), 'tolerance trail mentions ' + want);
  }
  const tolSheet = AU.sheets(rep, tolCtx).find(x => x.name === 'Tolerance limits');
  assert.ok(tolSheet && tolSheet.rows.some(r => r[0] === 'Tolerance factor k'), 'a tolerance run must get its own sheet');
  assert.ok(tolSheet.rows.some(r => r[0] === 'Normality p-value'), 'the normality check must be on the record, not just on screen');

  const ss = TOL.sampleSizeTost({ margin: 2, diff: 0.5, sd: 1.2, alpha: 0.05 }, 0.8);
  const sizeCtx = Object.assign({}, ctx, { tolerance: {
    kind: 'samplesize', when: '2026-01-02T00:00:00.000Z', design: 'tost', target: 0.8,
    n: ss.n, power: ss.power, opt: { sd: 1.2, alpha: 0.05, margin: 2, diff: 0.5, paired: false },
    curve: [[5, 0.4], [9, 0.81]] } });
  const sizeTxt = AU.trailText(AU.trail(rep, sizeCtx));
  for (const want of ['Sample size calculation', 'Sample size required', 'two one-sided tests']) {
    assert.ok(sizeTxt.includes(want), 'sample size trail mentions ' + want);
  }
  const sizeSheet = AU.sheets(rep, sizeCtx).find(x => x.name === 'Sample size');
  assert.ok(sizeSheet && sizeSheet.rows.some(r => r[0] === 'Results needed'));
  for (const c of [tolCtx, sizeCtx]) assert.strictEqual(new DataView(AU.xlsx(AU.sheets(rep, c), { title: 'T' }).buffer).getUint32(0, true), 0x04034b50);
});

const CD = require(path.join(ROOT, 'codon.js'));
const GA = require(path.join(ROOT, 'ga.js'));

test('genetic code: translation, synonyms and reverse complement', () => {
  assert.strictEqual(Object.keys(CD.CODE).length, 64);
  assert.strictEqual(CD.CODE.ATG, 'M');
  assert.strictEqual(CD.CODE.TGG, 'W');
  assert.deepStrictEqual(['TAA', 'TAG', 'TGA'].map(c => CD.CODE[c]), ['*', '*', '*']);
  assert.strictEqual(CD.translate('ATGGCCTGCGATTAA'), 'MACD*');
  assert.strictEqual(CD.SYN.L.length, 6);
  assert.strictEqual(CD.SYN.R.length, 6);
  assert.strictEqual(CD.SYN.S.length, 6);
  assert.strictEqual(CD.SYN.M.length, 1);
  assert.strictEqual(CD.SYN.W.length, 1);
  // Every codon maps back to the amino acid whose synonym list holds it.
  for (const c of Object.keys(CD.CODE)) assert.ok(CD.SYN[CD.CODE[c]].includes(c));
  assert.strictEqual(CD.revComp('GGTCTC'), 'GAGACC');
  assert.strictEqual(CD.clean('  atg gcc\nu  '), 'ATGGCCT');
});

test('CAI, GC content and 5-prime folding behave as defined', () => {
  const w = CD.relativeAdaptiveness('E_coli');
  // The host's favourite codon for an amino acid scores 1 by definition.
  assert.strictEqual(w.CTG, 1);
  assert.strictEqual(w.AAA, 1);
  assert.ok(w.CTA < 0.1 && w.CTA > 0);
  // A gene built only from favourite codons has CAI 1; swapping in rare ones drops it.
  const best = 'ATG' + 'CTG'.repeat(10) + 'AAA'.repeat(10) + 'TAA';
  const worst = 'ATG' + 'CTA'.repeat(10) + 'AAG'.repeat(10) + 'TAA';
  assert.ok(Math.abs(CD.cai(best, w) - 1) < 1e-12);
  assert.ok(CD.cai(worst, w) < 0.4);
  // Met, Trp and the stop carry no choice, so a gene of only those is undefined, not zero.
  assert.strictEqual(CD.cai('ATGTGGTAA', w), 0);

  assert.strictEqual(CD.gcOf('GGCC'), 1);
  assert.strictEqual(CD.gcOf('ATAT'), 0);
  const p = CD.gcProfile('G'.repeat(50) + 'A'.repeat(50), { gcLow: 0.45, gcHigh: 0.55, gcWindow: 50, gcStep: 50 });
  assert.strictEqual(p.overall, 0.5);
  assert.ok(!p.ok, 'two halves at 100% and 0% must fail the window test even though the mean is 50%');
  assert.ok(Math.abs(p.worstWindow - 0.45) < 1e-9);
  assert.ok(CD.gcProfile('GCAT'.repeat(25), { gcLow: 0.45, gcHigh: 0.55, gcWindow: 50, gcStep: 10 }).ok);

  // A perfect hairpin pairs with itself far more than a sequence that cannot pair at all.
  const stem = 'GGGGGGGGGG', loop = 'TTTT';
  assert.ok(CD.foldScore(stem + loop + CD.revComp(stem)) > CD.foldScore('AAAAAAAAAAAAAAAAAAAAAAAA'));
  assert.strictEqual(CD.foldScore('AAAAAAAAAAAA'), 0, 'A cannot pair with A');
});

test('restriction sites are found on both strands, with homopolymer runs', () => {
  const motifs = CD.motifList(['EcoRI', 'BsaI', 'gaattc']);
  const dna = 'AAAGAATTCAAA' + 'GGTCTC' + 'TTT' + 'GAGACC' + 'TTT' + 'CCCCCCCC';
  const hits = CD.findMotifs(dna, motifs, 6);
  const labels = hits.map(x => x.label);
  assert.ok(labels.includes('EcoRI'));
  assert.ok(labels.includes('BsaI'), 'BsaI on the top strand');
  assert.ok(labels.includes('BsaI (bottom strand)'), 'BsaI is not a palindrome: GAGACC cuts too');
  assert.ok(labels.some(l => /^C run/.test(l)), 'an 8-base C run is flagged when the limit is 6');
  assert.strictEqual(CD.findMotifs(dna, motifs, 0).filter(x => /run/.test(x.label)).length, 0, 'runs are off when the limit is 0');
  assert.strictEqual(CD.findMotifs('ACGTACGT', motifs, 6).length, 0);
});

test('a sequence that is not a clean coding sequence is refused with a reason', () => {
  assert.throws(() => GA.plan({ dna: 'ATGGCCT' }), /whole number of codons/);
  assert.throws(() => GA.plan({ dna: '' }), /No DNA sequence/);
  assert.throws(() => GA.plan({ dna: 'ATGTAAGCCTAA' }), /stop codon appears at codon 2/);
  const p = GA.plan({ dna: 'ATGCTGTGGTAA' });
  assert.deepStrictEqual(p.positions.map(x => x.fixed), [true, false, true, true], 'Met, Trp and the stop have nothing to choose');
});

test('codon optimization: same protein, higher CAI, sites removed, GC in window', () => {
  // A gene built from the codons CHO uses least, carrying an EcoRI site and a BsaI site.
  const r = GA.rng(5), aas = 'ACDEFGHIKLMNPQRSTVY';
  let dna = 'ATG';
  for (let i = 0; i < 200; i++) {
    const aa = aas[Math.floor(r() * aas.length)], syn = CD.SYN[aa].slice().sort((x, y) => CD.TABLES.CHO.usage[x] - CD.TABLES.CHO.usage[y]);
    dna += syn[0];
  }
  dna = dna.slice(0, 30) + 'GAATTC' + dna.slice(36);
  dna = dna.slice(0, 120) + 'GGTCTC' + dna.slice(126);
  dna += 'TGA';
  const job = { dna, host: 'CHO', gcLow: 0.45, gcHigh: 0.55, avoid: ['EcoRI', 'BsaI'], maxRun: 6, popSize: 60, generations: 120, seed: 42 };

  const run = GA.create(job);
  const before = run.state.baseline;
  assert.ok(before.violations >= 2, 'the starting sequence carries the planted sites');
  run.step(120);
  const res = run.result();

  assert.strictEqual(CD.translate(res.dna), CD.translate(dna), 'the protein must be identical');
  assert.ok(res.proteinUnchanged);
  assert.strictEqual(res.dna.length, dna.length);
  assert.strictEqual(res.dna.slice(-3), 'TGA', 'the stop codon is left as it came in');
  assert.strictEqual(res.after.violations, 0, 'every forbidden site is gone');
  assert.ok(res.after.cai > res.before.cai + 0.25, 'CAI ' + res.before.cai + ' -> ' + res.after.cai);
  assert.ok(res.after.cai > 0.8);
  assert.ok(res.after.gc >= 0.45 && res.after.gc <= 0.55, 'GC ' + res.after.gc);
  assert.strictEqual(CD.findMotifs(res.dna, CD.motifList(['EcoRI', 'BsaI']), 6).length, 0);
  // The Pareto front is a set of genuine trade-offs, sorted best-CAI first.
  assert.ok(res.front.length > 1);
  assert.ok(res.front.every(f => f.cai > 0 && f.dna.length === dna.length));
  assert.ok(res.history.length === res.generations + 1 && res.history[res.history.length - 1].best >= res.history[0].best);

  // Same seed, same answer: a run can be repeated and checked.
  const again = GA.create(job); again.step(120);
  assert.strictEqual(again.result().dna, res.dna);
  // A different host pulls the sequence somewhere else.
  const ecoli = GA.create(Object.assign({}, job, { host: 'E_coli' })); ecoli.step(120);
  const eRes = ecoli.result();
  assert.strictEqual(CD.translate(eRes.dna), CD.translate(dna));
  assert.notStrictEqual(eRes.dna, res.dna);
  assert.ok(CD.cai(eRes.dna, CD.relativeAdaptiveness('E_coli')) > CD.cai(res.dna, CD.relativeAdaptiveness('E_coli')),
    'optimizing for E. coli beats the CHO sequence on the E. coli table');
});

test('the optimizer never silently keeps a forbidden site it cannot remove', () => {
  // TGG (Trp) is the only codon for W, so a planted TGGTGG cannot be designed out.
  const dna = 'ATG' + 'TGGTGG' + 'GCCGCCGCCGCC' + 'TAA';
  const run = GA.create({ dna, host: 'HEK293', gcLow: 0.4, gcHigh: 0.6, avoid: ['TGGTGG'], maxRun: 6, popSize: 20, generations: 20, seed: 1 });
  run.step(20);
  const res = run.result();
  assert.strictEqual(res.after.violations, 1, 'the impossible site is still reported, not hidden');
  assert.strictEqual(CD.translate(res.dna), CD.translate(dna));
});

const ST = require(path.join(ROOT, 'stability.js'));
const stabRows = (specs, noise, seed, times) => {
  const r = E.rng(seed), out = [];
  for (const s of specs) for (const t of (times || [0, 3, 6, 9, 12, 18, 24])) out.push({ batch: s.b, time: t, y: s.i + s.m * t + (r() - 0.5) * (noise || 0) });
  return out;
};

test('F and t distributions match published tables', () => {
  // F(0.05; 3, 10) = 3.708; F(0.025; 4, 12) = 4.121; t(0.95; 10) = 1.8125; t(0.975; 20) = 2.0860
  assert.ok(Math.abs(ST.fTestP(3.708, 3, 10) - 0.05) < 1e-4);
  assert.ok(Math.abs(ST.fTestP(4.121, 4, 12) - 0.025) < 1e-4);
  assert.ok(Math.abs(ST.tQuantile(0.05, 10) - 1.8125) < 1e-4);
  assert.ok(Math.abs(ST.tQuantile(0.025, 20) - 2.0860) < 1e-4);
  assert.strictEqual(ST.fTestP(0, 1, 1), 1);
});

test('shelf life: a noiseless line crosses the spec exactly where algebra says', () => {
  // 100 - 0.5t meets 95 at t = 10. With no scatter the confidence limit is the line itself.
  const rows = [0, 3, 6, 9, 12, 18].map(t => ({ batch: 'B1', time: t, y: 100 - 0.5 * t }));
  const r = ST.analyze(rows, { lsl: 95, direction: 'decreasing' });
  assert.ok(Math.abs(r.curves[0].slope + 0.5) < 1e-9);
  assert.ok(Math.abs(r.shelfLife - 10) < 1e-6, 'shelf life ' + r.shelfLife);
  // An impurity rising to an upper limit is the mirror image.
  const imp = [0, 3, 6, 9, 12].map(t => ({ batch: 'B1', time: t, y: 0.5 + 0.25 * t }));
  assert.ok(Math.abs(ST.analyze(imp, { usl: 5, direction: 'increasing' }).shelfLife - 18) < 1e-6);
});

test('the confidence limit is the textbook one, and more scatter shortens the shelf life', () => {
  const rows = stabRows([{ b: 'B1', i: 100, m: -0.2 }], 1.2, 5);
  const r = ST.analyze(rows, { lsl: 95, direction: 'decreasing' });
  const c = r.curves[0];
  // At the mean time the band is exactly t * s / sqrt(n) wide.
  const expected = c.fit(c.tBar) - c.tq * c.s / Math.sqrt(c.nB);
  assert.ok(Math.abs(c.lower(c.tBar) - expected) < 1e-9);
  assert.ok(c.lower(0) < c.fit(0) && c.upper(0) > c.fit(0));
  // Away from the mean the band is wider: that is why extrapolation costs shelf life.
  assert.ok(c.fit(0) - c.lower(0) > c.fit(c.tBar) - c.lower(c.tBar));
  let previous = Infinity;
  for (const noise of [0.1, 0.8, 2.5]) {
    const s = ST.analyze(stabRows([{ b: 'B1', i: 100, m: -0.2 }], noise, 5), { lsl: 95, direction: 'decreasing' }).shelfLife;
    assert.ok(s < previous, 'noise ' + noise + ' gave ' + s + ', not shorter than ' + previous);
    previous = s;
  }
});

test('ICH Q1E poolability: the three models are chosen for the right reasons', () => {
  const opt = { lsl: 95, direction: 'decreasing' };
  const SAME = [{ b: 'A', i: 99.5, m: -0.16 }, { b: 'B', i: 99.45, m: -0.16 }, { b: 'C', i: 99.55, m: -0.16 }];
  // Same rate, same start, realistic scatter: everything pools into one line.
  const same = ST.analyze(stabRows(SAME, 0.55, 1), opt);
  assert.strictEqual(same.model, 'C');
  assert.strictEqual(same.tests.length, 2);
  assert.ok(same.tests.every(t => t.pass && t.p >= 0.25));

  /* Q1E's 0.25 level means the slope test wrongly splits identical batches about a quarter
     of the time, by design. Over twenty studies the rate has to land near that, or the test
     is not doing what Q1E describes. (Expect ~15 of 20 slope-pooled, ~11 fully pooled.) */
  let slopesPooled = 0, fullyPooled = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const r = ST.analyze(stabRows(SAME, 0.55, seed), opt);
    if (r.tests[0].pass) slopesPooled++;
    if (r.model === 'C') fullyPooled++;
  }
  assert.ok(slopesPooled >= 10, slopesPooled + ' of 20 pooled on slope, expected about 15');
  assert.ok(fullyPooled >= 6, fullyPooled + ' of 20 fully pooled, expected about 11');
  assert.ok(slopesPooled < 20, 'at this level some identical batches must still be split');

  // Same rate, clearly different starting levels: a common slope, separate intercepts.
  const offset = ST.analyze(stabRows([{ b: 'A', i: 99.5, m: -0.16 }, { b: 'B', i: 97.5, m: -0.16 }, { b: 'C', i: 101, m: -0.16 }], 0.3, 1), opt);
  assert.strictEqual(offset.model, 'B');
  assert.ok(offset.tests[0].pass && !offset.tests[1].pass);

  // Clearly different rates: no pooling at all, and the fastest decline decides.
  const spread = ST.analyze(stabRows([{ b: 'A', i: 99.5, m: -0.09 }, { b: 'B', i: 99.4, m: -0.22 }, { b: 'C', i: 99.5, m: -0.36 }], 0.25, 4), opt);
  assert.strictEqual(spread.model, 'A');
  assert.ok(!spread.tests[0].pass && spread.tests[0].p < 0.25);
  assert.strictEqual(spread.tests.length, 1, 'once slopes differ there is no point testing intercepts');
  assert.strictEqual(spread.limiting.name, 'C', 'the fastest-degrading batch sets the shelf life');
  assert.ok(spread.shelfLife <= Math.min.apply(null, spread.batches.map(b => b.alone)) + 1e-6);

  /* The level is a dial on how readily batches are split. Seed 4 is one of the studies that
     the 0.25 level splits (p 0.073) although the true slopes are identical; at a lower level
     the same data pools. Q1E chooses 0.25 precisely to err towards splitting, because
     splitting gives the shorter, more conservative shelf life. */
  const borderline = stabRows(SAME, 0.55, 4);
  const atQ1E = ST.analyze(borderline, opt);
  const atLoose = ST.analyze(borderline, Object.assign({}, opt, { poolAlpha: 0.001 }));
  assert.strictEqual(atQ1E.model, 'A');
  assert.strictEqual(atLoose.model, 'C');
  assert.ok(atQ1E.shelfLife < atLoose.shelfLife, 'splitting must give the shorter shelf life');
});

test('pooling buys shelf life, and every batch is also reported on its own', () => {
  const specs = [{ b: 'A', i: 99.5, m: -0.16 }, { b: 'B', i: 99.45, m: -0.16 }, { b: 'C', i: 99.55, m: -0.16 }];
  const r = ST.analyze(stabRows(specs, 0.55, 1), { lsl: 95, direction: 'decreasing' });
  assert.strictEqual(r.model, 'C');
  assert.strictEqual(r.batches.length, 3);
  // Every batch gets its own estimate whatever the pooling decision, and pooling (three
  // times the data, so a tighter band) must not come out worse than the best single batch.
  assert.ok(r.batches.every(b => b.alone !== null && b.alone > 0));
  assert.ok(r.shelfLife > Math.max.apply(null, r.batches.map(b => b.alone)));
});

test('Q1E extrapolation cap and out-of-spec data are reported honestly', () => {
  // Barely any decline over 12 months: the statistics run far past the data.
  const slow = ST.analyze(stabRows([{ b: 'A', i: 99.9, m: -0.02 }], 0.05, 9, [0, 3, 6, 9, 12]), { lsl: 95, direction: 'decreasing' });
  assert.ok(slow.shelfLife > slow.allowed, 'statistical ' + slow.shelfLife);
  assert.strictEqual(slow.allowed, 24, 'twice 12 months, and no more than 12 beyond');
  assert.strictEqual(slow.reported, 24);
  assert.ok(slow.capped && slow.extrapolated);

  // Inside the data there is nothing to cap.
  const fast = ST.analyze(stabRows([{ b: 'A', i: 99.5, m: -0.5 }], 0.1, 9), { lsl: 95, direction: 'decreasing' });
  assert.ok(!fast.extrapolated && !fast.capped && fast.reported === fast.shelfLife);

  // Material already below the limit on day one gets zero, not a negative number.
  const bad = ST.analyze([0, 3, 6].map(t => ({ batch: 'A', time: t, y: 94 - 0.2 * t })), { lsl: 95, direction: 'decreasing' });
  assert.strictEqual(bad.shelfLife, 0);
  assert.ok(bad.startsOutOfSpec);
});

test('stability input is checked before anything is fitted', () => {
  const rows = stabRows([{ b: 'A', i: 99, m: -0.1 }], 0.2, 2);
  assert.throws(() => ST.analyze(rows, {}), /specification limit/);
  assert.throws(() => ST.analyze(rows, { lsl: 99, usl: 95 }), /lower limit must be below/);
  assert.throws(() => ST.analyze([{ batch: 'A', time: 0, y: 1 }], { lsl: 0 }), /at least 3 time points/);
  assert.throws(() => ST.analyze([0, 1, 2].map(() => ({ batch: 'A', time: 0, y: 99 })), { lsl: 95 }), /only one time point/);
  /* Rows with no number are dropped rather than poisoning the fit. This matters more than
     it looks: isFinite(null) and isFinite('') are both true in JavaScript, so a blank result
     cell would otherwise be fitted as a zero and wreck the slope. */
  const dirty = rows.concat([{ batch: 'A', time: NaN, y: 99 }, { batch: 'A', time: 6, y: null }, { batch: 'A', time: 9, y: '' }, { batch: 'A', time: null, y: 98 }, { batch: 'A', time: 3, y: 'n/a' }]);
  const kept = ST.analyze(dirty, { lsl: 95, direction: 'decreasing' });
  assert.strictEqual(kept.rows.length, rows.length);
  assert.ok(kept.rows.every(p => p.y > 90), 'a blank result must never be read as zero');
  // Numbers arriving as text are still numbers.
  assert.strictEqual(ST.analyze([{ batch: 'A', time: '0', y: '100' }, { batch: 'A', time: '6', y: '98' }, { batch: 'A', time: '12', y: '96' }], { lsl: 95, direction: 'decreasing' }).rows.length, 3);
});

const TT = require(path.join(ROOT, 'tost.js'));
const twoGroups = (ref, test, withIds) => ref.map((v, i) => ({ group: 'A', value: v, sample: withIds ? 'S' + i : '' }))
  .concat(test.map((v, i) => ({ group: 'B', value: v, sample: withIds ? 'S' + i : '' })));
const REF10 = [100, 101, 99, 100.5, 99.5, 100.2, 99.8, 100.1, 100.3, 99.7];

test('TOST: the exact boundary cases land where algebra says', () => {
  // When the observed difference sits exactly on the margin, that one-sided test is a coin
  // flip: t = 0, so p = 0.5 precisely.
  const atUpper = TT.analyze(twoGroups(REF10, REF10.map(v => v + 2)), { reference: 'A', test: 'B', margin: 2 });
  assert.ok(Math.abs(atUpper.diff - 2) < 1e-12);
  assert.ok(Math.abs(atUpper.p2 - 0.5) < 1e-9, 'p2 ' + atUpper.p2);
  assert.ok(!atUpper.equivalent);
  const atLower = TT.analyze(twoGroups(REF10, REF10.map(v => v - 2)), { reference: 'A', test: 'B', margin: 2 });
  assert.ok(Math.abs(atLower.p1 - 0.5) < 1e-9);

  // With no difference at all and a margin of exactly t(0.95,df) x SE, both tests sit on the
  // 0.05 line, which is the definition of the boundary of equivalence.
  const probe = TT.analyze(twoGroups(REF10, REF10.slice()), { reference: 'A', test: 'B', margin: 1 });
  const edge = TT.analyze(twoGroups(REF10, REF10.slice()), { reference: 'A', test: 'B', margin: E.tQuantile(0.05, probe.df) * probe.se });
  assert.ok(Math.abs(edge.p1 - 0.05) < 1e-6 && Math.abs(edge.p2 - 0.05) < 1e-6, edge.p1 + ' / ' + edge.p2);
  assert.ok(Math.abs(edge.diff) < 1e-12);
});

test('TOST and the confidence interval always say the same thing', () => {
  /* The whole point of TOST is that "both one-sided tests pass at alpha" and "the
     100(1-2a)% interval fits inside the margins" are one statement. If these ever disagree
     the module is wrong, so it is checked over a few hundred shapes of data. */
  const r = E.rng(7);
  let checked = 0;
  for (let i = 0; i < 400; i++) {
    const n1 = 3 + Math.floor(r() * 12), n2 = 3 + Math.floor(r() * 12), shift = (r() - 0.5) * 6, sd = 0.5 + r() * 3;
    const a = [], b = [];
    for (let j = 0; j < n1; j++) a.push(100 + (r() - 0.5) * sd * 3.4);
    for (let j = 0; j < n2; j++) b.push(100 + shift + (r() - 0.5) * sd * 3.4);
    const res = TT.analyze(twoGroups(a, b), { reference: 'A', test: 'B', margin: 0.5 + r() * 5 });
    const byInterval = res.ciLow > -res.margin && res.ciHigh < res.margin;
    assert.strictEqual(byInterval, res.equivalent, 'disagreement at i=' + i);
    checked++;
  }
  assert.strictEqual(checked, 400);
});

test('TOST reports three outcomes, and tells "not proven" from "different"', () => {
  const opt = { reference: 'A', test: 'B', margin: 2 };
  const PRECISE = [100, 100.3, 99.8, 100.1, 99.9, 100.2, 99.7, 100.4, 100, 99.95];

  // Tight agreement: the interval is a fraction of the margin.
  const tight = TT.analyze(twoGroups(PRECISE, [100.1, 100.2, 99.9, 100.3, 100, 100.1, 99.8, 100.2, 100.05, 100]), opt);
  assert.strictEqual(tight.verdict, 'equivalent');
  assert.ok(tight.equivalent && tight.bandUsed < 0.2 && tight.needed === null);

  // A 3-unit bias against a 2-unit margin: a real difference, and too big to accept.
  const biased = TT.analyze(twoGroups(PRECISE, PRECISE.map(v => v + 3)), opt);
  assert.strictEqual(biased.verdict, 'different');
  assert.ok(biased.differs && !biased.equivalent);
  assert.strictEqual(biased.needed, null, 'no sample size rescues a difference bigger than the margin');

  /* Five noisy results each: neither equivalent nor different. This is the case people
     wrongly write up as "no significant difference, therefore the methods are the same" —
     the ordinary t-test is quiet (p 0.69) precisely because the study is too small. */
  const thin = TT.analyze(twoGroups([98, 102, 99, 103, 100], [99, 103, 98, 104, 101]), opt);
  assert.strictEqual(thin.verdict, 'inconclusive');
  assert.ok(!thin.equivalent && !thin.differs);
  assert.ok(thin.ciLow < -thin.margin && thin.ciHigh > 0, 'the interval runs past the margin but still covers zero');
  assert.ok(thin.pDiff > 0.05, 'the ordinary t-test is quiet here, which is exactly the trap');
  assert.strictEqual(thin.needed, 16, 'it should say how many results per method would settle it');
});

test('TOST: pairing, percentage margins, and the invariances that must hold', () => {
  const rnd = E.rng(21);
  const norm = () => { const u = Math.max(1e-12, rnd()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const truth = 90 + norm() * 6;              // samples differ a lot from each other
    rows.push({ group: 'A', value: truth + norm() * 0.25, sample: 'S' + i });
    rows.push({ group: 'B', value: truth + 0.3 + norm() * 0.25, sample: 'S' + i });
  }
  const paired = TT.analyze(rows, { reference: 'A', test: 'B', margin: 2, paired: true });
  const unpaired = TT.analyze(rows, { reference: 'A', test: 'B', margin: 2 });
  assert.ok(Math.abs(paired.diff - unpaired.diff) < 1e-9, 'the mean difference is the same either way');
  // Pairing removes sample-to-sample spread, so the same data becomes far more conclusive.
  assert.ok(paired.se < unpaired.se / 5);
  assert.strictEqual(paired.verdict, 'equivalent');
  assert.strictEqual(unpaired.verdict, 'inconclusive');
  assert.strictEqual(paired.df, 11);
  assert.strictEqual(paired.pairs.length, 12);

  // A percentage margin is a percentage of the reference mean.
  const pct = TT.analyze(rows, { reference: 'A', test: 'B', margin: 3, marginType: 'percent' });
  assert.ok(Math.abs(pct.margin - Math.abs(pct.refStats.mean) * 0.03) < 1e-9);

  // Swapping which method is the reference flips the sign and nothing else.
  const flipped = TT.analyze(rows, { reference: 'B', test: 'A', margin: 2 });
  assert.ok(Math.abs(flipped.diff + unpaired.diff) < 1e-9);
  assert.strictEqual(flipped.verdict, unpaired.verdict);
  assert.ok(Math.abs(flipped.pTost - unpaired.pTost) < 1e-9);

  // Changing the unit of measurement changes nothing that matters.
  const scaled = rows.map(x => ({ group: x.group, value: x.value * 1000, sample: x.sample }));
  const big = TT.analyze(scaled, { reference: 'A', test: 'B', margin: 2000 });
  assert.ok(Math.abs(big.pTost - unpaired.pTost) < 1e-9);
  assert.strictEqual(big.verdict, unpaired.verdict);

  // Welch and pooled agree exactly when the groups are the same size and spread.
  const even = twoGroups(REF10, REF10.map(v => v + 0.5));
  const w = TT.analyze(even, { reference: 'A', test: 'B', margin: 2 });
  const p = TT.analyze(even, { reference: 'A', test: 'B', margin: 2, welch: false });
  assert.ok(Math.abs(w.df - p.df) < 1e-6 && Math.abs(w.se - p.se) < 1e-12);
});

test('equivalence input is checked before anything is tested', () => {
  const ok = twoGroups(REF10, REF10.map(v => v + 0.4));
  assert.throws(() => TT.analyze(ok, { reference: 'A', test: 'B' }), /margin greater than zero/);
  assert.throws(() => TT.analyze(ok, { reference: 'A', test: 'B', margin: -1 }), /margin greater than zero/);
  assert.throws(() => TT.analyze([{ group: 'A', value: 1 }, { group: 'A', value: 2 }], { margin: 1 }), /Two methods are needed/);
  assert.throws(() => TT.analyze([{ group: 'A', value: 1 }, { group: 'B', value: 2 }], { margin: 1 }), /at least 2 results/);
  assert.throws(() => TT.analyze(twoGroups([5, 5, 5], [5, 5, 5]), { reference: 'A', test: 'B', margin: 1 }), /no scatter/);
  assert.throws(() => TT.analyze(ok.concat([{ group: 'C', value: 99 }, { group: 'C', value: 98 }]), { margin: 1 }), /Choose which two/);
  assert.throws(() => TT.analyze(ok, { reference: 'A', test: 'B', margin: 2, paired: true }), /sample identifier/);
  // Blanks and text are dropped rather than read as zero.
  const dirty = ok.concat([{ group: 'A', value: null }, { group: 'B', value: '' }, { group: 'A', value: 'n/a' }]);
  const r = TT.analyze(dirty, { reference: 'A', test: 'B', margin: 2 });
  assert.strictEqual(r.refStats.n + r.testStats.n, ok.length);
  assert.ok(r.refStats.mean > 90, 'a blank result must never be read as zero');
});

test('every tool has an applications write-up, and none of it overclaims', () => {
  const apps = require(path.join(ROOT, 'applications.js'));
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  // Every selectable tool but the privacy page must have one.
  // Only the tool selector's own options, not every <option> on the page.
  const selector = (html.match(/<select id="tool">([\s\S]*?)<\/select>/) || [])[1] || '';
  assert.ok(selector, 'the tool selector should be findable');
  const tools = [...selector.matchAll(/<option value="([a-z]+)"/g)].map(m => m[1]).filter(t => t !== 'privacy');
  assert.ok(tools.length >= 4, tools.join(','));
  for (const t of tools) {
    assert.ok(apps[t], 'no applications entry for ' + t);
    assert.ok(apps[t].tech && apps[t].scope, t + ' needs a technology name and a scope line');
    assert.ok(apps[t].groups.length >= 4, t + ' has only ' + apps[t].groups.length + ' areas');
    assert.ok(apps[t].groups.filter(g => !g.note).length >= 4, t + ' needs at least four application areas');
    for (const g of apps[t].groups) {
      assert.ok(g.name && g.text.length > 80, t + ': "' + g.name + '" is too thin');
      // Application paragraphs read as comma-separated lists of uses, which is what makes
      // them scannable. A paragraph flagged as a note is a closing remark and is exempt.
      if (!g.note) assert.ok((g.text.match(/,/g) || []).length >= 3, t + ': "' + g.name + '" should read as a comma-separated list of uses');
    }
    // The scope line is what stops a reader assuming the page takes images or audio.
    assert.ok(/In this tool:/.test(apps[t].scope), t + ': the scope line must say what this page actually reads');
  }
  // The panel must carry the caveat, not just the data file.
  assert.ok(/not a claim about what this page reads/.test(app), 'the panel must print the scope caveat, not just carry it in the data file');
  /* Every modality and function offered must have unit operations behind it, and every
     technique must say what it does for every function. A missing combination shows an
     empty panel, which is worse than not offering the choice. */
  const { MODALITIES, FUNCTIONS, UNITOPS, BYFUNCTION } = apps;
  assert.strictEqual(MODALITIES.length, 2, 'two modalities: mammalian and microbial');
  assert.ok(FUNCTIONS.length >= 6, FUNCTIONS.length + ' functions');
  const seen = new Set();
  for (const [m, mLabel] of MODALITIES) {
    assert.ok(UNITOPS[m], 'no unit operations for ' + mLabel);
    for (const [f, fLabel] of FUNCTIONS) {
      const ops = UNITOPS[m][f];
      assert.ok(ops && ops.length >= 4, mLabel + ' / ' + fLabel + ' has ' + (ops ? ops.length : 0) + ' unit operations');
      for (const [op, ml] of ops) {
        assert.ok(op && op.length > 4, mLabel + '/' + fLabel + ': a unit operation needs a name');
        assert.ok(ml && ml.length > 60, mLabel + '/' + fLabel + '/' + op + ': the application line is too thin');
        seen.add(m + '|' + f + '|' + op);
      }
    }
  }
  assert.ok(seen.size > 70, 'expected a full set of unit operations, got ' + seen.size);
  for (const t of tools) {
    assert.ok(BYFUNCTION[t], 'no per-function lines for ' + t);
    for (const [f, fLabel] of FUNCTIONS) {
      const line = BYFUNCTION[t][f];
      assert.ok(line && line.length > 50, t + ' says nothing for ' + fLabel);
    }
  }
  // The pickers, and the promise that the choice is not stored.
  assert.ok(/apps-modality/.test(app) && /apps-function/.test(app), 'the panel must offer both pickers');
  assert.ok(/Nothing is stored/.test(app), 'the choice must be documented as session-only');
  // Upstream and downstream unit operations should be the real ones, by name.
  const mamDsp = UNITOPS.mammalian.dspd.map(o => o[0]).join(' ');
  assert.ok(/Protein A/.test(mamDsp) && /viral/i.test(mamDsp), 'mammalian downstream should name capture and viral steps: ' + mamDsp);
  const micDsp = UNITOPS.microbial.dspd.map(o => o[0]).join(' ');
  assert.ok(/lysis/i.test(micDsp) && /refold/i.test(micDsp), 'microbial downstream should name lysis and refolding: ' + micDsp);

  // The selector is named by technology, not by one industry's use case.
  for (const bad of ['Chromatography', 'Bioreactor', 'Densitometer']) assert.ok(!new RegExp('<option[^>]*>[^<]*' + bad).test(html), 'selector should not name a specific application: ' + bad);
});

const GB = require(path.join(ROOT, 'golden.js'));
/* A fed-batch campaign: temperature ramps down, oxygen falls, feed ramps up — all planned.

   Crucially the batch-to-batch deviations are CORRELATED, through a per-batch "vigour"
   factor: a batch whose culture grows faster runs slightly warmer, pulls oxygen down and
   takes more feed. That correlation is the whole reason a multivariate model beats a wall of
   single-sensor charts, and without it PCA has no structure to find and Q means nothing.
   Faults are injected at a known hour so detection can be measured rather than admired. */
function campaign(seed, opt) {
  opt = opt || {};
  const r = E.rng(seed);
  const N = () => { const u = Math.max(1e-12, r()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
  const recs = [], ref = [];
  const one = (id, fault, hours, fixedVigour) => {
    /* A faulted batch is given an ordinary vigour on purpose. Left to chance it can draw an
       extreme one and be abnormal from hour zero for a reason that has nothing to do with the
       injected fault — true of the process, but it would mean the test was measuring two
       things at once. */
    const vigour = fixedVigour === undefined ? N() : fixedVigour;
    const end = hours || 336;
    for (let hh = 0; hh <= end; hh += 6) {
      const f = hh / end;                     // position through the batch, 0 to 1
      let temp = 37 - 0.8 * f + 0.08 * vigour + N() * 0.04;
      let dO = 55 - 20 * f - 2.2 * vigour + N() * 0.5;
      let ph = 7.05 - 0.1 * f - 0.03 * vigour + N() * 0.012;
      const feed = 2 + 10 * f + 0.45 * vigour + N() * 0.08;
      const agit = 120 + 30 * f + 1.1 * vigour + N() * 0.6;
      if (fault === 'do' && hh >= 168) dO -= 0.09 * (hh - 168);
      if (fault === 'temp' && hh >= 240 && hh <= 270) temp += 1.2;
      if (fault === 'probe' && hh >= 120) ph += 0.22;
      recs.push({ batch: id, time: hh, vars: { Temp_C: temp, DO_Pct: dO, pH: ph, Feed: feed, Agit: agit } });
    }
  };
  const nGood = opt.good || 10;
  for (let i = 1; i <= nGood; i++) {
    const id = 'B-' + String(i).padStart(2, '0');
    ref.push(id);
    // Batches of differing length, when asked for: the case percent alignment exists to handle.
    one(id, null, opt.varyLength ? 300 + Math.round((i % 5) * 18) : 336);
  }
  (opt.faults || ['do', 'temp', 'probe']).forEach(fl => one('F-' + fl, fl, opt.varyLength ? 330 : 336, 0.25));
  return { recs, ref, variables: ['Temp_C', 'DO_Pct', 'pH', 'Feed', 'Agit'] };
}
const ONSET = { 'F-do': 168, 'F-temp': 240, 'F-probe': 120 };

test('golden batch: resampling onto a shared grid never invents data', () => {
  // Linear between known points, and nothing outside the range the batch actually covers.
  const out = GB.resample([0, 10, 20], [0, 10, 0], [-5, 0, 5, 10, 15, 20, 25]);
  assert.deepStrictEqual(out, [null, 0, 5, 10, 5, 0, null]);
  assert.deepStrictEqual(GB.resample([0], [1], [0, 1]), [null, null], 'one point cannot make a trajectory');
});

test('golden batch: faults are caught, and good batches are left alone', () => {
  const { recs, ref, variables } = campaign(9);
  const r = GB.analyze(recs, { variables, reference: ref });
  assert.ok(r.components >= 1 && r.components < variables.length, 'Q needs components left over: ' + r.components);
  assert.ok(r.varianceCovered >= 0.8, 'components should carry most of normal variation');
  assert.strictEqual(r.calibration, 'held-out reference batches');

  const byName = {};
  r.summary.forEach(s => { byName[s.name] = s; });
  for (const f of ['F-do', 'F-temp', 'F-probe']) {
    assert.strictEqual(byName[f].verdict, 'alarm', f + ' should alarm');
    assert.ok(byName[f].alarmAt >= ONSET[f] - 6, f + ' alarmed at ' + byName[f].alarmAt + ', before its fault began at ' + ONSET[f]);
    assert.ok(byName[f].alarmAt <= ONSET[f] + 72, f + ' took until ' + byName[f].alarmAt + ' to notice a fault starting at ' + ONSET[f]);
  }
  // Each fault is blamed on the sensor that actually moved.
  assert.strictEqual(byName['F-do'].alarmBy, 'DO_Pct');
  assert.strictEqual(byName['F-probe'].alarmBy, 'pH');
  // And the good batches are, overwhelmingly, left alone.
  const good = r.summary.filter(s => s.isRef);
  assert.strictEqual(good.length, 10);
  assert.ok(good.filter(s => s.verdict === 'alarm').length <= 1, good.filter(s => s.verdict === 'alarm').length + ' of 10 good batches false-alarmed');
});

test('golden batch: limits are calibrated out of sample, not on the batches that built them', () => {
  /* The bug this guards: scoring a batch against an envelope it helped draw makes it look
     unnaturally good, so a limit taken from those same scores is far too tight and every
     batch the model has not seen trips it. Across several campaigns the false-alarm rate on
     known-good batches has to stay near the limit's promise, not at 100%. */
  let falseAlarms = 0, goodBatches = 0, caught = 0, faults = 0;
  for (const seed of [9, 17, 23, 41, 55]) {
    const { recs, ref, variables } = campaign(seed);
    const r = GB.analyze(recs, { variables, reference: ref });
    r.summary.forEach(s => {
      if (s.isRef) { goodBatches++; if (s.verdict === 'alarm') falseAlarms++; }
      else { faults++; if (s.verdict === 'alarm') caught++; }
    });
  }
  assert.strictEqual(goodBatches, 50);
  assert.strictEqual(faults, 15);
  assert.strictEqual(caught, 15, 'every injected fault must be caught');
  assert.ok(falseAlarms <= 3, falseAlarms + ' of 50 known-good batches false-alarmed');
});

test('golden batch: a reference batch is scored by a model built without it', () => {
  const { recs, ref, variables } = campaign(9);
  const r = GB.analyze(recs, { variables, reference: ref });
  const held = r.scoreBatch(ref[0]);
  assert.ok(held.isRef);
  // Its envelope must come from the other nine, so the mean at a point differs from the
  // all-ten envelope the non-reference batches are scored against.
  const all = r.scoreBatch('F-do');
  const diff = Math.abs(held.env[0][30].mean - all.env[0][30].mean);
  assert.ok(diff > 0, 'a held-out batch should not be scored against an envelope it helped draw');
  // Everyone shares the same limits, so the numbers on screen compare.
  assert.ok(Math.abs(held.t2Limit - all.t2Limit) < 1e-9 && Math.abs(held.qLimit - all.qLimit) < 1e-9);
});

test('golden batch: T-squared and Q measure different things', () => {
  const { recs, ref, variables } = campaign(9);
  const r = GB.analyze(recs, { variables, reference: ref });
  // The drifting pH probe breaks the relationship between sensors, which is Q's job.
  const probe = r.scoreBatch('F-probe');
  const late = probe.points.filter(p => p && p.t >= 160);
  assert.ok(late.some(p => p.overQ), 'a probe drifting out of step should raise Q');
  const worstQ = late.reduce((a, p) => (p.q > a.q ? p : a), late[0]);
  const share = worstQ.residuals.map((v, j) => ({ name: variables[j], s: v * v / worstQ.q })).sort((a, b) => b.s - a.s)[0];
  assert.strictEqual(share.name, 'pH', 'pH should own most of the residual, not ' + share.name);
  // Both numbers are non-negative by construction.
  r.summary.forEach(s => { assert.ok(s.maxT2 >= 0 && s.maxQ >= 0); });
});

test('golden batch: input problems are explained, not crashed on', () => {
  const { recs, ref, variables } = campaign(9);
  assert.throws(() => GB.analyze(recs, { variables: ['Temp_C'], reference: ref }), /at least 2 process variables/);
  assert.throws(() => GB.analyze(recs.filter(r => r.batch === 'B-01'), { variables, reference: ['B-01'] }), /At least 3/);
  assert.throws(() => GB.analyze(recs, { variables, reference: ref.slice(0, 2) }), /at least 3 reference batches/i);
  assert.throws(() => GB.analyze([], { variables, reference: ref }), /numeric time/);
  // Blank and non-numeric readings are dropped rather than read as zero.
  const dirty = recs.concat([{ batch: 'B-01', time: 999, vars: { Temp_C: null, DO_Pct: '', pH: 'n/a', Feed: 1, Agit: 1 } }]);
  const r = GB.analyze(dirty, { variables, reference: ref });
  assert.ok(r.summary.every(s => s.maxT2 < 1e6), 'a blank reading must not become a zero and blow up the model');
});

test('golden batch: batches of different lengths can be aligned on percent', () => {
  /* When batches genuinely run to different lengths, hour 200 of a 300-hour batch and hour
     200 of a 370-hour batch are different points in the process. Percent alignment compares
     like with like; absolute time can only reach as far as the shortest reference batch. */
  const { recs, ref, variables } = campaign(9, { varyLength: true });
  const byTime = GB.analyze(recs, { variables, reference: ref });
  const byPct = GB.analyze(recs, { variables, reference: ref, align: 'percent' });
  assert.ok(byTime.gridHi <= 300, 'absolute alignment stops at the shortest reference batch: ' + byTime.gridHi);
  assert.strictEqual(byPct.gridLo, 0);
  assert.strictEqual(byPct.gridHi, 100);
  assert.strictEqual(byPct.summary.find(s => s.name === 'F-do').verdict, 'alarm', 'the fault should still be caught on percent alignment');
  assert.ok(byPct.summary.filter(s => s.isRef && s.verdict === 'alarm').length <= 1, 'percent alignment should not start false-alarming on good batches');
});


/* The studentized range is the riskiest piece of numerical work here: there is no closed
   form, and a wrong critical value silently turns Tukey into nonsense that still looks like
   a table. Checked against published tables, plus the one case with an exact analytic
   answer: with two groups, q = sqrt(2) x t. */
test('the studentized range matches published tables', () => {
  assert.ok(Math.abs(VC.qCritical(0.05, 2, 10) - Math.SQRT2 * E.tQuantile(0.025, 10)) < 1e-3, 'two groups must agree with sqrt(2) x t exactly');
  const table = [[0.05, 2, 10, 3.151], [0.05, 3, 10, 3.88], [0.05, 4, 20, 3.958], [0.01, 3, 10, 5.27],
    [0.05, 5, 15, 4.367], [0.05, 2, 5, 3.635], [0.05, 10, 30, 4.82], [0.01, 4, 12, 5.50], [0.05, 3, 1e6, 3.314]];
  for (const [a, k, df, want] of table) {
    const got = VC.qCritical(a, k, df);
    assert.ok(Math.abs(got - want) < 0.02, 'q(' + a + ',' + k + ',' + df + ') = ' + got.toFixed(4) + ', table says ' + want);
  }
  // Monotone in the directions it must be: more groups needs a wider bar, more data a narrower one.
  assert.ok(VC.qCritical(0.05, 5, 20) > VC.qCritical(0.05, 3, 20));
  assert.ok(VC.qCritical(0.05, 3, 60) < VC.qCritical(0.05, 3, 6));
  assert.ok(VC.qCritical(0.01, 3, 20) > VC.qCritical(0.05, 3, 20));
});

test('variance components split a hand-computable dataset exactly', () => {
  // Three groups of three: means 2, 5, 8 with unit within-group variance.
  const rows = [];
  [[1, 2, 3], [4, 5, 6], [7, 8, 9]].forEach((v, i) => v.forEach(x => rows.push({ group: 'G' + i, value: x })));
  const r = VC.oneWay(rows);
  assert.strictEqual(r.anova[0].ss, 54);
  assert.strictEqual(r.anova[0].ms, 27);
  assert.strictEqual(r.anova[1].ms, 1);
  assert.ok(Math.abs(r.between - 26 / 3) < 1e-12, 'between = (MSB - MSW)/n0 = 26/3');
  assert.strictEqual(r.within, 1);
  assert.ok(Math.abs(r.icc - (26 / 3) / (26 / 3 + 1)) < 1e-12);
  assert.ok(r.balanced && r.n0 === 3);
  // Tukey's critical value for 3 groups on 6 error df is 4.339 in the published table.
  const t = VC.tukey(rows, 0.05);
  assert.ok(Math.abs(t.qCrit - 4.339) < 0.01, t.qCrit);
  assert.strictEqual(t.pairs.length, 3);
  assert.ok(t.pairs.every(p => p.different), 'all three groups are 3 apart with unit noise');

  // Unbalanced: n0 = (N - sum(ni^2)/N)/(a-1) = (9 - 29/9)/2.
  const ub = [];
  [[1, 2, 3, 4], [6, 8], [10, 12, 14]].forEach((v, i) => v.forEach(x => ub.push({ group: 'U' + i, value: x })));
  const r2 = VC.oneWay(ub);
  assert.ok(!r2.balanced);
  assert.ok(Math.abs(r2.n0 - (9 - 29 / 9) / 2) < 1e-12, r2.n0);
});

test('variance components are unbiased, and a negative estimate is reported honestly', () => {
  const rand = E.rng(404);
  const norm = () => { const u = Math.max(1e-12, rand()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };
  // True between-group variance 9, within 1. Averaged over replications the estimator must land on them.
  let sb = 0, sw = 0; const REPS = 60;
  for (let rep = 0; rep < REPS; rep++) {
    const rows = [];
    for (let g = 0; g < 40; g++) { const a = 3 * norm(); for (let j = 0; j < 8; j++) rows.push({ group: 'L' + g, value: 100 + a + norm() }); }
    const r = VC.oneWay(rows); sb += r.between; sw += r.within;
  }
  assert.ok(Math.abs(sb / REPS - 9) < 0.5, 'between-group variance recovered as ' + (sb / REPS).toFixed(3) + ', truth 9');
  assert.ok(Math.abs(sw / REPS - 1) < 0.1, 'within-group variance recovered as ' + (sw / REPS).toFixed(3) + ', truth 1');

  // No real group effect at all: the estimate must clamp at zero and say so, not go negative.
  let sawNegative = false;
  for (let seed = 1; seed <= 40 && !sawNegative; seed++) {
    const r2 = E.rng(seed * 13);
    const n2 = () => { const u = Math.max(1e-12, r2()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r2()); };
    const flat = [];
    for (let g = 0; g < 5; g++) for (let j = 0; j < 8; j++) flat.push({ group: 'F' + g, value: n2() });
    const r = VC.oneWay(flat);
    assert.ok(r.between >= 0, 'a variance may never be reported negative');
    if (r.negative) { sawNegative = true; assert.strictEqual(r.between, 0, 'a negative estimate is reported as zero'); }
  }
  assert.ok(sawNegative, 'with no group effect, some replicate should produce a negative raw estimate and be clamped');
});

test('variance components refuse what they cannot split, instead of guessing', () => {
  assert.throws(() => VC.oneWay([{ group: 'A', value: 1 }]), /at least 2 groups/i);
  // One value per group: within-group variation is unobservable.
  assert.throws(() => VC.oneWay([{ group: 'A', value: 1 }, { group: 'B', value: 2 }]), /single value|repeats/i);
  // Blanks are not zeros. A missing result must drop out, not be fitted as 0.
  const r = VC.oneWay([{ group: 'A', value: 10 }, { group: 'A', value: '' }, { group: 'A', value: 12 },
    { group: 'B', value: 20 }, { group: 'B', value: null }, { group: 'B', value: 22 }]);
  assert.strictEqual(r.N, 4, 'blank and null results must be dropped, not read as zero');
  assert.ok(r.grand > 15 && r.grand < 17, r.grand);
});

/* Gage R&R: the sums of squares are checked against a two-factor crossed ANOVA written
   independently here, and the components against values injected into simulated studies. */
test('Gage R&R matches an independently computed crossed ANOVA', () => {
  const rand = E.rng(515);
  const norm = () => { const u = Math.max(1e-12, rand()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };
  const P = 10, O = 3, R = 3;
  const pa = E.range(P).map(() => 2 * norm()), oa = E.range(O).map(() => 0.5 * norm()), ia = {};
  for (let i = 0; i < P; i++) for (let j = 0; j < O; j++) ia[i + '|' + j] = 0.3 * norm();
  const rows = [];
  for (let i = 0; i < P; i++) for (let j = 0; j < O; j++) for (let k = 0; k < R; k++)
    rows.push({ part: 'P' + i, operator: 'Op' + j, value: 10 + pa[i] + oa[j] + ia[i + '|' + j] + 0.4 * norm() });

  const mean = v => v.reduce((a, b) => a + b, 0) / v.length;
  const grand = mean(rows.map(x => x.value));
  const pm = i => mean(rows.filter(x => x.part === 'P' + i).map(x => x.value));
  const om = j => mean(rows.filter(x => x.operator === 'Op' + j).map(x => x.value));
  const cm = (i, j) => mean(rows.filter(x => x.part === 'P' + i && x.operator === 'Op' + j).map(x => x.value));
  let ssP = 0, ssO = 0, ssI = 0, ssE = 0;
  for (let i = 0; i < P; i++) ssP += O * R * (pm(i) - grand) ** 2;
  for (let j = 0; j < O; j++) ssO += P * R * (om(j) - grand) ** 2;
  for (let i = 0; i < P; i++) for (let j = 0; j < O; j++) {
    ssI += R * (cm(i, j) - pm(i) - om(j) + grand) ** 2;
    rows.filter(x => x.part === 'P' + i && x.operator === 'Op' + j).forEach(x => { ssE += (x.value - cm(i, j)) ** 2; });
  }
  const g = VC.gageRR(rows, { lsl: 4, usl: 16 });
  const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-8, what + ': ' + a + ' vs ' + b);
  near(g.anova[0].ss, ssP, 'part sum of squares');
  near(g.anova[1].ss, ssO, 'operator sum of squares');
  near(g.anova[2].ss, ssI, 'interaction sum of squares');
  near(g.anova[3].ss, ssE, 'error sum of squares');
  assert.deepStrictEqual([g.anova[0].df, g.anova[1].df, g.anova[2].df, g.anova[3].df], [9, 2, 18, 60]);
  // %GRR against tolerance is 6 sigma over the spec window, by definition.
  near(g.pctTolerance, 6 * Math.sqrt(g.vGrr) / 12 * 100, 'percent of tolerance');
  // Distinct categories, as the AIAG formula defines it.
  assert.strictEqual(g.ndc, Math.floor(1.41 * Math.sqrt(g.vPart) / Math.sqrt(g.vGrr)));
  // Shares of variance add to one; percentages of spread do not, and must not be made to.
  const shares = g.components[0].share + g.components[1].share + g.components[3].share;
  assert.ok(Math.abs(shares - 1) < 1e-9, shares);
});

test('Gage R&R recovers injected components and pools an unsupported interaction', () => {
  const rand = E.rng(808);
  const norm = () => { const u = Math.max(1e-12, rand()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };
  const study = (sP, sO, sI, sE) => {
    const pa = E.range(10).map(() => sP * norm()), oa = E.range(3).map(() => sO * norm()), ia = {};
    for (let i = 0; i < 10; i++) for (let j = 0; j < 3; j++) ia[i + '|' + j] = sI * norm();
    const rows = [];
    for (let i = 0; i < 10; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++)
      rows.push({ part: 'P' + i, operator: 'Op' + j, value: 10 + pa[i] + oa[j] + ia[i + '|' + j] + sE * norm() });
    return rows;
  };
  let acc = { vRepeat: 0, vInter: 0, vPart: 0 }; const REPS = 50;
  for (let i = 0; i < REPS; i++) {
    const r = VC.gageRR(study(2, 0.5, 0.3, 0.4), {});
    acc.vRepeat += r.vRepeat; acc.vInter += r.vInter; acc.vPart += r.vPart;
  }
  assert.ok(Math.abs(acc.vRepeat / REPS - 0.16) < 0.02, 'repeatability ' + (acc.vRepeat / REPS).toFixed(4) + ', truth 0.16');
  assert.ok(Math.abs(acc.vInter / REPS - 0.09) < 0.03, 'interaction ' + (acc.vInter / REPS).toFixed(4) + ', truth 0.09');
  assert.ok(Math.abs(acc.vPart / REPS - 4) < 1, 'part to part ' + (acc.vPart / REPS).toFixed(3) + ', truth 4');

  // No interaction injected: it should be pooled back into error rather than left to eat variation.
  const none = VC.gageRR(study(2, 0.5, 0, 0.4), {});
  assert.ok(!none.keepInteraction && none.vInter === 0, 'an unsupported interaction must be pooled: p ' + none.pInteraction);
  assert.ok(/pooled/.test(none.model));
  // A strong interaction must be kept, or its variation lands in the wrong place.
  const strong = VC.gageRR(study(2, 0.5, 1.5, 0.4), {});
  assert.ok(strong.keepInteraction && strong.vInter > 1, 'a real interaction must be kept: p ' + strong.pInteraction);

  // The verdict must move with the instrument, and the thresholds must be the stated ones.
  assert.strictEqual(VC.gageRR(study(2, 0.02, 0.01, 0.03), {}).verdict, 'acceptable');
  assert.strictEqual(VC.gageRR(study(2, 3, 1, 3), {}).verdict, 'not acceptable');
  /* The same instrument judged against a wide and a narrow specification: the %GRR of
     tolerance must scale exactly with the window, since nothing about the method changed.
     This is the trap the lesson is built around, so it is worth pinning down. */
  const rowsFixed = study(2, 0.3, 0.1, 0.3);
  const wide = VC.gageRR(rowsFixed, { lsl: 0, usl: 20 }), narrow = VC.gageRR(rowsFixed, { lsl: 5, usl: 15 });
  assert.ok(Math.abs(narrow.pctTolerance - 2 * wide.pctTolerance) < 1e-8, 'halving the window must double %GRR of tolerance');
  assert.strictEqual(narrow.vGrr, wide.vGrr, 'the measurement system itself must not depend on the specification');
});

test('Gage R&R refuses a study it cannot analyse, with a reason a user can act on', () => {
  const rows = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++)
    rows.push({ part: 'P' + i, operator: 'O' + j, value: 10 + i + j * 0.1 + k * 0.05 });
  assert.ok(VC.gageRR(rows, {}).N === 16, 'a complete balanced study must be accepted');
  // Unbalanced: one cell short.
  assert.throws(() => VC.gageRR(rows.slice(0, 15), {}), /not balanced/i);
  // One reading per cell: repeatability is unobservable.
  assert.throws(() => VC.gageRR(rows.filter((_, i) => i % 2 === 0), {}), /at least twice/i);
  // One part: nothing real to compare measurement noise against.
  assert.throws(() => VC.gageRR(rows.filter(r => r.part === 'P0'), {}), /at least 2 parts/i);
  // Blanks must drop out rather than be fitted as zero, which would invent a huge fake spread.
  const withBlanks = rows.concat([{ part: 'P0', operator: 'O0', value: '' }, { part: 'P1', operator: 'O1', value: null }]);
  assert.strictEqual(VC.gageRR(withBlanks, {}).N, 16, 'blank results must be dropped, not read as zero');
});

test('PLS beats ordinary regression where the columns outnumber the useful information', () => {
  const rand = E.rng(1234);
  const norm = () => { const u = Math.max(1e-12, rand()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };
  const p = 40;
  const l1 = E.range(p).map((_, j) => Math.sin(j / p * Math.PI)), l2 = E.range(p).map((_, j) => Math.cos(j / p * Math.PI * 2));
  const make = n => {
    const X = [], y = [];
    for (let i = 0; i < n; i++) {
      const a = norm() * 2, b = norm();
      X.push(E.range(p).map((_, j) => a * l1[j] + b * l2[j] + norm() * 0.25));
      y.push(3 * a - 1.5 * b + norm());
    }
    return { X, y };
  };
  const tr = make(25), te = make(600);
  const err = m => { const pr = m.predict(te.X); return Math.sqrt(te.y.reduce((s, v, i) => s + (v - pr[i]) ** 2, 0) / te.y.length); };
  const ols = err(E.fitRidgeCore(tr.X, tr.y, 1e-9));
  const pls = err(E.fitPLS(tr.X, tr.y, 3));
  const yMean = te.y.reduce((a, b) => a + b, 0) / te.y.length;
  const ySd = Math.sqrt(te.y.reduce((s, v) => s + (v - yMean) ** 2, 0) / te.y.length);
  assert.ok(pls < ols, 'PLS ' + pls.toFixed(3) + ' should beat OLS ' + ols.toFixed(3) + ' with 40 collinear channels and 25 rows');
  assert.ok(pls < ySd, 'PLS ' + pls.toFixed(3) + ' must beat guessing the mean ' + ySd.toFixed(3));
  // The same protein is predicted whichever units the channels arrive in: scaling must not change the fit.
  const scaled = { X: tr.X.map(r => r.map((v, j) => v * (j % 2 ? 100 : 1))), y: tr.y };
  const m1 = E.fitPLS(tr.X, tr.y, 3), m2 = E.fitPLS(scaled.X, scaled.y, 3);
  const pred1 = m1.predict(tr.X)[0];
  const pred2 = m2.predict(scaled.X)[0];
  assert.ok(Math.abs(pred1 - pred2) < 1e-6 * Math.max(1, Math.abs(pred1)), 'PLS should be invariant to rescaling the inputs: ' + pred1 + ' vs ' + pred2);
});


test('the normal CDF and its inverse are accurate to double precision', () => {
  // The tolerance factors integrate this and then root-find on the result, so the
  // approximation that is fine for a capability index is not fine here.
  const want = [[1, 0.8413447460685429], [1.96, 0.9750021048517795], [-3, 0.0013498980316301],
    [4, 0.9999683287581669], [0, 0.5], [-0.5, 0.3085375387259869]];
  for (const [z, w] of want) assert.ok(Math.abs(E.normCdf(z) - w) < 1e-14, 'Phi(' + z + ') = ' + E.normCdf(z));
  for (const p of [0.001, 0.025, 0.5, 0.95, 0.975, 0.999, 0.9999]) {
    assert.ok(Math.abs(E.normCdf(E.normInv(p)) - p) < 1e-13, 'round trip at ' + p);
  }
  assert.ok(Math.abs(E.normInv(0.975) - 1.959963984540054) < 1e-12);
});

test('non-central t with no offset reduces to the central t distribution', () => {
  /* nctCdf integrates the normal CDF over the distribution of s; tTestP goes through the
     incomplete beta. Two unrelated routes to the same number, so agreement is evidence. */
  for (const [t, df] of [[1.5, 5], [2.228, 10], [-1, 8], [0.5, 30], [3, 3], [0, 7]]) {
    const mine = TOL.nctCdf(t, df, 0);
    const central = t >= 0 ? 1 - E.tTestP(t, df) / 2 : E.tTestP(-t, df) / 2;
    assert.ok(Math.abs(mine - central) < 1e-7, 't=' + t + ' df=' + df + ': ' + mine + ' vs ' + central);
  }
});

test('tolerance factors match published tables', () => {
  // One sided, 95% confidence. These are the Natrella values.
  for (const [n, p, want] of [[3, 0.95, 7.655], [5, 0.95, 4.202], [10, 0.90, 2.355], [10, 0.95, 2.911],
    [20, 0.95, 2.396], [25, 0.99, 3.158], [30, 0.95, 2.220], [100, 0.95, 1.927]]) {
    const got = TOL.toleranceFactor(n, p, 0.95, 1);
    assert.ok(Math.abs(got - want) < 0.003, 'one-sided k(n=' + n + ', p=' + p + ') = ' + got.toFixed(4) + ', table ' + want);
  }
  // Two sided, 95% confidence.
  for (const [n, p, want] of [[5, 0.95, 5.079], [10, 0.90, 2.856], [10, 0.99, 4.437], [100, 0.95, 2.233]]) {
    const got = TOL.toleranceFactor(n, p, 0.95, 2);
    assert.ok(Math.abs(got - want) < 0.005, 'two-sided k(n=' + n + ', p=' + p + ') = ' + got.toFixed(4) + ', table ' + want);
  }
  /* As the sample grows the factor falls to the plain normal quantile, because there is no
     longer any doubt about sigma. How fast it falls is known in closed form from the delta
     method, by a route with nothing in common with the integration above, so the excess over
     the quantile is a far stronger check than "it is roughly z". */
  for (const [n, p] of [[2000, 0.95], [20000, 0.95], [200000, 0.99]]) {
    const zp = E.normInv(p), zc = E.normInv(0.95), df = n - 1;
    const excess = TOL.toleranceFactor(n, p, 0.95, 1) - zp;
    const predicted = zc * Math.sqrt(1 / n + zp * zp / (2 * df));
    assert.ok(Math.abs(excess / predicted - 1) < 0.03, 'one-sided excess at n=' + n + ': ' + excess.toExponential(3) + ' vs predicted ' + predicted.toExponential(3));
    const zq = E.normInv((1 + p) / 2);
    const excess2 = TOL.toleranceFactor(n, p, 0.95, 2) - zq;
    const predicted2 = zq * (zc / Math.sqrt(2 * df) + 1 / (2 * n));
    assert.ok(Math.abs(excess2 / predicted2 - 1) < 0.03, 'two-sided excess at n=' + n + ': ' + excess2.toExponential(3) + ' vs predicted ' + predicted2.toExponential(3));
  }
  // And it must always be wider than the naive quantile, never narrower.
  for (const n of [5, 10, 30, 100]) {
    assert.ok(TOL.toleranceFactor(n, 0.95, 0.95, 2) > E.normInv(0.975), 'n=' + n);
    assert.ok(TOL.toleranceFactor(n, 0.95, 0.95, 1) > E.normInv(0.95), 'n=' + n);
  }
  // Monotone in every direction it must be: more data narrows, more coverage or more
  // confidence widens, and two-sided is always wider than one-sided.
  for (let n = 5; n < 60; n += 7) {
    assert.ok(TOL.toleranceFactor(n, 0.95, 0.95, 2) > TOL.toleranceFactor(n + 7, 0.95, 0.95, 2));
    assert.ok(TOL.toleranceFactor(n, 0.99, 0.95, 2) > TOL.toleranceFactor(n, 0.95, 0.95, 2));
    assert.ok(TOL.toleranceFactor(n, 0.95, 0.99, 2) > TOL.toleranceFactor(n, 0.95, 0.95, 2));
    assert.ok(TOL.toleranceFactor(n, 0.95, 0.95, 2) > TOL.toleranceFactor(n, 0.95, 0.95, 1));
  }
});

test('tolerance intervals really cover what they claim (Monte Carlo)', () => {
  /* The tables confirm the arithmetic; this confirms the definition. Draw many samples,
     build the interval from each, and measure how often it genuinely covers p of the
     population. That fraction must come out at the stated confidence. */
  const rand = E.rng(20260101);
  const norm = () => { const u = Math.max(1e-12, rand()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };
  const REPS = 30000, se = Math.sqrt(0.95 * 0.05 / REPS);
  for (const [n, p, sided] of [[10, 0.90, 2], [12, 0.95, 1]]) {
    const k = TOL.toleranceFactor(n, p, 0.95, sided);
    let hit = 0;
    for (let r = 0; r < REPS; r++) {
      const x = []; let m = 0;
      for (let i = 0; i < n; i++) { const v = norm(); x.push(v); m += v; }
      m /= n;
      const sd = Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1));
      const content = sided === 2 ? E.normCdf(m + k * sd) - E.normCdf(m - k * sd) : 1 - E.normCdf(m - k * sd);
      if (content >= p) hit++;
    }
    const got = hit / REPS;
    assert.ok(Math.abs(got - 0.95) < 6 * se, 'n=' + n + ' p=' + p + ' sided=' + sided + ': real coverage ' + got.toFixed(4) + ', claimed 0.95');
  }
});

test('a tolerance interval reports the specification decision and what it would take', () => {
  const x = [98.1, 97.4, 98.9, 97.8, 98.3, 98.6, 97.2, 98.0, 98.4, 97.9];
  const fits = TOL.toleranceInterval(x, { p: 0.99, conf: 0.95, sided: 2, lsl: 95, usl: 101 });
  assert.strictEqual(fits.n, 10);
  assert.strictEqual(fits.inside, true);
  assert.ok(fits.lower > 95 && fits.upper < 101);
  assert.strictEqual(fits.needed, null, 'nothing is needed when it already fits');
  // The interval must be much wider than the mean plus three standard deviations people reach for.
  assert.ok(fits.k > 3 && fits.upper > fits.naive.upper, 'k=' + fits.k);

  // Same process, limits it cannot support: it must say how many results would settle it.
  const tight = TOL.toleranceInterval(x, { p: 0.99, conf: 0.95, sided: 2, lsl: 97, usl: 99 });
  assert.strictEqual(tight.inside, false);
  assert.ok(tight.achievable === false || tight.needed > 10, JSON.stringify({ a: tight.achievable, n: tight.needed }));
  // Limits so tight that no amount of data would support them must be called impossible,
  // not answered with a sample size nobody can run.
  const hopeless = TOL.toleranceInterval(x, { p: 0.99, conf: 0.95, sided: 2, lsl: 98, usl: 98.1 });
  assert.strictEqual(hopeless.inside, false);
  assert.strictEqual(hopeless.achievable, false, 'a limit inside the natural spread is unreachable at any n');
  assert.strictEqual(hopeless.needed, null);

  // One-sided, which is what a purity or an impurity limit actually is.
  const lower = TOL.toleranceInterval(x, { p: 0.99, conf: 0.95, sided: 1, bound: 'lower', lsl: 95 });
  assert.strictEqual(lower.upper, null, 'a lower bound must not invent an upper one');
  assert.ok(lower.lower > 95 && lower.insideLower === true);
  assert.ok(lower.k < fits.k, 'one-sided is narrower than two-sided');
  // Blanks are not zeros.
  assert.strictEqual(TOL.toleranceInterval([98.1, '', 97.4, null, 98.9], { p: 0.9, conf: 0.9 }).n, 3);
  assert.throws(() => TOL.toleranceInterval([1], {}), /at least 2/i);
});

test('normality is tested rather than assumed, because the tails are the whole answer', () => {
  const rand = E.rng(77);
  const norm = () => { const u = Math.max(1e-12, rand()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };
  // False positives on genuinely normal data must sit near the stated 5%.
  let flagged = 0, R = 1200;
  for (let i = 0; i < R; i++) {
    const x = []; for (let j = 0; j < 30; j++) x.push(norm());
    if (TOL.andersonDarling(x).p < 0.05) flagged++;
  }
  assert.ok(Math.abs(flagged / R - 0.05) < 0.025, 'false positive rate ' + (flagged / R).toFixed(4));
  // Strong skew must be caught nearly every time, or the check is decoration.
  let caught = 0;
  for (let i = 0; i < 200; i++) {
    const x = []; for (let j = 0; j < 30; j++) x.push(Math.exp(norm() * 1.2));
    if (TOL.andersonDarling(x).p < 0.05) caught++;
  }
  assert.ok(caught / 200 > 0.9, 'lognormal detection ' + (caught / 200).toFixed(3));
  // Too few results to test is said out loud, not quietly passed.
  const thin = TOL.andersonDarling([1, 2, 3, 4]);
  assert.strictEqual(thin.normal, null);
  assert.ok(/few/i.test(thin.note));
  assert.strictEqual(TOL.andersonDarling([5, 5, 5, 5, 5, 5, 5, 5, 5]).normal, null);
});

test('power and sample size match the textbook numbers', () => {
  // The canonical teaching values for a two-sample t-test at 5%, two-sided.
  assert.strictEqual(TOL.sampleSizeTwoSample({ delta: 0.5, sd: 1, alpha: 0.05, sided: 2 }, 0.8).n, 64);
  assert.strictEqual(TOL.sampleSizeTwoSample({ delta: 1, sd: 1, alpha: 0.05, sided: 2 }, 0.8).n, 17);
  assert.strictEqual(TOL.sampleSizeTwoSample({ delta: 0.5, sd: 1, alpha: 0.05, sided: 2 }, 0.9).n, 86);
  assert.strictEqual(TOL.sampleSizeOneSample({ delta: 0.5, sd: 1, alpha: 0.05, sided: 2 }, 0.8).n, 34);
  assert.ok(Math.abs(TOL.powerTwoSample({ n: 64, delta: 0.5, sd: 1, alpha: 0.05, sided: 2 }).power - 0.8015) < 0.002);

  /* With no real difference the test must reject exactly as often as the significance level
     allows. A power routine that fails this is miscalibrated everywhere else too. */
  for (const [n, a] of [[20, 0.05], [10, 0.01], [50, 0.1]]) {
    assert.ok(Math.abs(TOL.powerTwoSample({ n, delta: 0, sd: 1, alpha: a, sided: 2 }).power - a) < 1e-4, 'size at n=' + n);
  }
  // Power rises with n and with the difference, and falls as the scatter grows.
  assert.ok(TOL.powerTwoSample({ n: 40, delta: 0.5, sd: 1 }).power > TOL.powerTwoSample({ n: 20, delta: 0.5, sd: 1 }).power);
  assert.ok(TOL.powerTwoSample({ n: 20, delta: 1, sd: 1 }).power > TOL.powerTwoSample({ n: 20, delta: 0.5, sd: 1 }).power);
  assert.ok(TOL.powerTwoSample({ n: 20, delta: 0.5, sd: 2 }).power < TOL.powerTwoSample({ n: 20, delta: 0.5, sd: 1 }).power);
  // Only scale matters, not units.
  assert.ok(Math.abs(TOL.powerTwoSample({ n: 20, delta: 5, sd: 10 }).power - TOL.powerTwoSample({ n: 20, delta: 0.5, sd: 1 }).power) < 1e-9);
  // A difference no study could reach must be reported as capped, not as a sample size.
  assert.strictEqual(TOL.sampleSizeTwoSample({ delta: 0.0001, sd: 1 }, 0.8, 200).n, null);
});

test('TOST power is exact at the boundary, which pins the whole calculation', () => {
  /* When the true difference sits exactly on the margin, the chance of declaring
     equivalence is the significance level. It is the one point where the answer is known in
     advance, so it is the strongest available check on the joint calculation. */
  for (const [n, m, a] of [[25, 2, 0.05], [40, 0.5, 0.1], [15, 1.5, 0.01], [60, 1, 0.05]]) {
    const got = TOL.powerTost({ n, margin: m, diff: m, sd: 1, alpha: a }).power;
    assert.ok(got <= a + 1e-6 && got > a * 0.9, 'n=' + n + ' alpha=' + a + ' gave ' + got.toFixed(5));
  }
  // A difference well outside the margin is essentially never declared equivalent.
  assert.ok(TOL.powerTost({ n: 30, margin: 1, diff: 3, sd: 1 }).power < 1e-6);
  // A margin far wider than the scatter is always met.
  assert.ok(TOL.powerTost({ n: 10, margin: 100, diff: 0, sd: 1 }).power > 0.9999);
  // Monotone in n, and in the margin.
  const curve = [6, 12, 24, 48].map(n => TOL.powerTost({ n, margin: 1, diff: 0, sd: 1 }).power);
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i] > curve[i - 1], curve.join(','));
  assert.ok(TOL.powerTost({ n: 20, margin: 2, diff: 0, sd: 1 }).power > TOL.powerTost({ n: 20, margin: 1, diff: 0, sd: 1 }).power);
  // Paired studies are more sensitive than unpaired ones at the same count.
  assert.ok(TOL.powerTost({ n: 20, margin: 1, diff: 0, sd: 1, paired: true }).power >
    TOL.powerTost({ n: 20, margin: 1, diff: 0, sd: 1, paired: false }).power);
  // And the sample size search inverts its own power function.
  const need = TOL.sampleSizeTost({ margin: 1, diff: 0.2, sd: 1, alpha: 0.05 }, 0.8);
  assert.ok(TOL.powerTost({ n: need.n, margin: 1, diff: 0.2, sd: 1 }).power >= 0.8);
  assert.ok(TOL.powerTost({ n: need.n - 1, margin: 1, diff: 0.2, sd: 1 }).power < 0.8, 'the answer must be the smallest n that works');
});

test('conference matrices satisfy their defining property, or are not offered', () => {
  /* A DSD built from a bad conference matrix would look plausible and be worthless, so the
     property is checked here as well as inside the constructor. */
  for (const n of [4, 6, 8, 10, 12, 14, 18, 20]) {
    const C = D.conferenceMatrix(n);
    assert.ok(C, 'no conference matrix of order ' + n);
    assert.strictEqual(C.length, n);
    for (let i = 0; i < n; i++) {
      assert.strictEqual(C[i][i], 0, 'diagonal must be zero');
      for (let j = 0; j < n; j++) {
        if (i !== j) assert.strictEqual(Math.abs(C[i][j]), 1, 'off-diagonal must be +/-1');
        let dot = 0;
        for (let r = 0; r < n; r++) dot += C[r][i] * C[r][j];
        assert.strictEqual(dot, i === j ? n - 1 : 0, 'C^T C must be (n-1)I at ' + i + ',' + j);
      }
    }
  }
  // An order with no construction available must return null rather than something wrong.
  assert.strictEqual(D.conferenceMatrix(16), null, 'order 16 has no Paley construction here');
  assert.strictEqual(D.conferenceMatrix(7), null, 'odd orders are not conference matrices');
});

test('definitive screening designs deliver the properties they are chosen for', () => {
  for (let k = 3; k <= 14; k++) {
    const d = D.definitiveScreening(k);
    assert.ok(d, 'no DSD for ' + k + ' factors');
    const R = d.runs;
    // Run count: 2k+1 for an even number of factors, two more when a column is dropped.
    assert.strictEqual(R.length, k % 2 === 0 ? 2 * k + 1 : 2 * k + 3, k + ' factors');
    assert.ok(R.every(r => r.length === k && r.every(v => v === -1 || v === 0 || v === 1)), 'three levels only');
    for (let j = 0; j < k; j++) {
      assert.strictEqual(R.reduce((s, r) => s + r[j], 0), 0, 'column ' + j + ' must be balanced');
      // Each factor sits at its middle setting three times: twice from the foldover, once at the centre.
      assert.strictEqual(R.filter(r => r[j] === 0).length, 3, 'column ' + j + ' mid-level count');
      // Main effects orthogonal to each other.
      for (let m = j + 1; m < k; m++) assert.strictEqual(R.reduce((s, r) => s + r[j] * r[m], 0), 0, 'main effects ' + j + ',' + m);
    }
    /* The property that makes a DSD worth choosing over a Plackett-Burman screen: no main
       effect is correlated with any two-factor interaction at all. */
    for (let a = 0; a < k; a++) for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
      if (a === i || a === j) continue;
      assert.strictEqual(R.reduce((s, r) => s + r[a] * r[i] * r[j], 0), 0, 'main effect ' + a + ' vs interaction ' + i + 'x' + j);
    }
    // Curvature must be estimable: intercept, main effects and all pure quadratics, full rank.
    const X = R.map(r => [1].concat(r, r.map(v => v * v)));
    assert.ok(E.invert(E.gram(X)), 'quadratic effects must be estimable at k=' + k);
  }
  // A Plackett-Burman screen of similar size does NOT have the alias property, which is the
  // whole reason the DSD exists. Confirm the contrast rather than asserting it in prose.
  const pb = D.plackettBurman(8);
  let worst = 0;
  for (let a = 0; a < 8; a++) for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    if (a === i || a === j) continue;
    worst = Math.max(worst, Math.abs(pb.reduce((s, r) => s + r[a] * r[i] * r[j], 0)));
  }
  assert.ok(worst > 0, 'a Plackett-Burman screen should confound main effects with interactions');

  const g = D.generate(['A', 'B', 'C', 'D', 'E'].map(n => ({ name: n, low: 10, high: 20 })), { type: 'dsd', randomize: false });
  assert.strictEqual(g.runs.length, 13);
  assert.ok(g.runs.every(r => r.actual.every(v => v === 10 || v === 15 || v === 20)), 'levels decode to low, middle and high');
  assert.throws(() => D.generate([{ name: 'A', low: 1, high: 2 }, { name: 'S', low: 'x', high: 'y', categorical: true }, { name: 'C', low: 1, high: 2 }], { type: 'dsd' }), /numeric/i);
  assert.strictEqual(D.recommend(10).type, 'dsd', 'a DSD should be preferred over a Plackett-Burman screen at 10 factors');
});

test('mixture designs produce real blends that add up', () => {
  const choose = (n, r) => { let v = 1; for (let i = 0; i < r; i++) v = v * (n - i) / (i + 1); return Math.round(v); };
  for (const [q, deg] of [[3, 2], [3, 3], [4, 2], [5, 2], [4, 4]]) {
    const pts = D.simplexLattice(q, deg);
    assert.strictEqual(pts.length, choose(q + deg - 1, deg), 'lattice {' + q + ',' + deg + '} size');
    assert.ok(pts.every(p => Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-12), 'every blend must add to one');
    assert.ok(pts.every(p => p.every(v => v >= 0)), 'no negative amounts');
  }
  for (const q of [3, 4, 5]) {
    const pts = D.simplexCentroid(q);
    assert.strictEqual(pts.length, (1 << q) - 1);
    assert.ok(pts.every(p => Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-12));
    assert.strictEqual(pts.filter(p => p.filter(v => v > 0).length === 1).length, q, 'every pure component is included');
  }
  /* Bounded components: the corners of the feasible polytope. With these limits the region
     is a hexagon, so six corners plus the centroid. */
  const ev = D.extremeVertices([0.2, 0.1, 0], [0.6, 0.5, 0.4], { centroid: true });
  assert.strictEqual(ev.vertices, 6);
  assert.strictEqual(ev.points.length, 7);
  assert.ok(ev.points.every(p => Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9), 'bounded blends must still add to one');
  assert.ok(ev.points.every(p => p.every((v, i) => v >= [0.2, 0.1, 0][i] - 1e-7 && v <= [0.6, 0.5, 0.4][i] + 1e-7)), 'every blend must respect its limits');
  // Impossible limits are refused with a reason, in both directions.
  assert.throws(() => D.extremeVertices([0.5, 0.5, 0.3], [0.9, 0.9, 0.9]), /more than the whole blend/i);
  assert.throws(() => D.extremeVertices([0, 0, 0], [0.2, 0.2, 0.2]), /cannot fill the blend/i);

  // Through generate: amounts must sum to the batch total exactly, after rounding.
  const comps = [{ name: 'Buffer', low: 40, high: 70 }, { name: 'Sugar', low: 5, high: 30 }, { name: 'Surf', low: 0, high: 10 }, { name: 'Water', low: 10, high: 40 }];
  for (const total of [100, 250, 12.5]) {
    const m = D.generate(comps, { type: 'mixVertices', randomize: false, total });
    assert.ok(m.mixture && m.runs.length > 4);
    for (const r of m.runs) {
      assert.ok(Math.abs(r.actual.reduce((a, b) => a + b, 0) - total) < 1e-9, 'run must weigh out to ' + total + ', got ' + r.actual.reduce((a, b) => a + b, 0));
      assert.ok(Math.abs(r.proportions.reduce((a, b) => a + b, 0) - 1) < 1e-9);
    }
  }
  // A lattice cannot honour bounds, so asking for one with bounds must say so, not silently
  // hand back blends nobody can make.
  assert.throws(() => D.generate([{ name: 'A', low: 20, high: 60 }, { name: 'B', low: 10, high: 50 }, { name: 'C', low: 0, high: 40 }], { type: 'mixLattice' }), /extreme vertices/i);
  assert.throws(() => D.generate([{ name: 'A', low: 0, high: 100 }, { name: 'S', low: 'x', high: 'y', categorical: true }], { type: 'mixCentroid' }), /proportion/i);
});

test('the Scheffe blending model recovers a known formulation', () => {
  /* Pure-component responses 10, 4, 7 with a strong synergy between the first two and an
     antagonism between the first and third. */
  const truth = p => 10 * p[0] + 4 * p[1] + 7 * p[2] + 12 * p[0] * p[1] - 6 * p[0] * p[2];
  const pts = D.simplexLattice(3, 3).concat(D.simplexCentroid(3));
  const names = ['A', 'B', 'C'];
  const exact = D.analyzeMixture(pts, pts.map(truth), names);
  assert.ok(exact.quadratic, 'these blends support the quadratic model');
  assert.ok(exact.r2 > 0.999999, 'a noiseless fit must be exact: R2 ' + exact.r2);
  const want = { A: 10, B: 4, C: 7, 'A x B': 12, 'A x C': -6, 'B x C': 0 };
  for (const c of exact.coefs) assert.ok(Math.abs(c.beta - want[c.label]) < 1e-8, c.label + ' = ' + c.beta);
  /* The interpretive property that makes this form worth using: a pure-component
     coefficient IS the predicted response for that component on its own. */
  for (let i = 0; i < 3; i++) {
    const pure = [0, 0, 0]; pure[i] = 1;
    assert.ok(Math.abs(exact.predict(pure) - truth(pure)) < 1e-8);
    assert.ok(Math.abs(exact.coefs[i].beta - truth(pure)) < 1e-8, 'pure coefficient equals pure response');
  }
  // Unbiased under noise.
  const rand = E.rng(606);
  const norm = () => { const u = Math.max(1e-12, rand()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };
  const acc = {}; const REPS = 120;
  for (let r = 0; r < REPS; r++) {
    const m = D.analyzeMixture(pts, pts.map(p => truth(p) + norm() * 0.4), names);
    m.coefs.forEach(c => { acc[c.label] = (acc[c.label] || 0) + c.beta / REPS; });
  }
  for (const k of Object.keys(want)) assert.ok(Math.abs(acc[k] - want[k]) < 0.35, k + ' recovered as ' + acc[k].toFixed(4) + ', truth ' + want[k]);
  // A genuinely additive blend must not be given spurious synergy.
  const lin = D.analyzeMixture(pts, pts.map(p => 5 * p[0] + 9 * p[1] + 2 * p[2] + norm() * 0.02), names);
  assert.ok(lin.coefs.filter(c => !c.pure).every(c => c.p > 0.05), 'no cross term should be significant on an additive blend');
  // Too few blends falls back to the additive model instead of failing.
  const thin = D.analyzeMixture([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [10, 4, 7], names);
  assert.strictEqual(thin.quadratic, false);
  assert.ok(thin.coefs.every((c, i) => Math.abs(c.beta - [10, 4, 7][i]) < 1e-9));
  // A flat response puts the same value on every component, with no intercept to absorb it.
  const flat = D.analyzeMixture(pts, pts.map(() => 7), names);
  assert.ok(flat.coefs.filter(c => c.pure).every(c => Math.abs(c.beta - 7) < 1e-9), 'with no intercept the level lives in the component coefficients');
});

const ADV = require(path.join(ROOT, 'advisor.js'));
const ADVEV = require(path.join(ROOT, 'advisor-eval.js'));

test('the advisor routes plain English to the right tool, and its accuracy is measured', () => {
  const sets = { tuned: { n: 0, t1: 0, t2: 0, nm: 0 }, heldout: { n: 0, t1: 0, t2: 0, nm: 0 } };
  const misses = [];
  for (const c of ADVEV.CASES) {
    const s = sets[c.set];
    assert.ok(s, 'unknown eval set ' + c.set);
    s.n++;
    const r = ADV.advise(c.text);
    if (r.status === 'nomatch') { s.nm++; misses.push(c.set + ' ' + c.want + ' :: ' + c.text); continue; }
    const ids = r.recommendations.map(x => x.id);
    if (ids[0] === c.want) s.t1++; else misses.push(c.set + ' want ' + c.want + ' got ' + ids[0] + ' :: ' + c.text);
    if (ids.slice(0, 2).includes(c.want)) s.t2++;
  }
  const pct = s => 100 * s.t1 / s.n;
  // Printed so the number is visible on every run rather than buried in an assertion.
  console.log('    advisor: tuned ' + pct(sets.tuned).toFixed(1) + '% top-1 (' + sets.tuned.n + ' cases), ' +
    'held-out ' + pct(sets.heldout).toFixed(1) + '% top-1 / ' + (100 * sets.heldout.t2 / sets.heldout.n).toFixed(1) + '% top-2 (' +
    sets.heldout.n + ' cases, ' + sets.heldout.nm + ' no-match)');
  assert.ok(sets.tuned.n >= 60 && sets.heldout.n >= 50, 'the eval set must stay substantial');
  /* The bar for phrasings built from the lexicon's own vocabulary is high, because failing
     there means the matching is broken rather than merely limited. */
  assert.ok(pct(sets.tuned) >= 95, 'tuned accuracy fell to ' + pct(sets.tuned).toFixed(1) + '%');
  /* The held-out bar is deliberately modest. This is a word matcher, not a language model,
     and the honest expectation is that unfamiliar phrasing sometimes misses. The number is
     here to stop it regressing silently, not to flatter it. */
  assert.ok(pct(sets.heldout) >= 70, 'held-out accuracy fell to ' + pct(sets.heldout).toFixed(1) + '%:\n' + misses.join('\n'));
});

test('the advisor says nothing rather than guessing, and asks when two tools are close', () => {
  for (const nonsense of ['what colour is the sky', 'hello', 'asdf qwerty', 'book me a flight to Boston', '12345']) {
    assert.strictEqual(ADV.advise(nonsense).status, 'nomatch', 'should not route: ' + nonsense);
  }
  assert.strictEqual(ADV.advise('').status, 'empty');
  assert.strictEqual(ADV.advise('   ').status, 'empty');
  // A clear request must be confident, carry its evidence, and name a real next step.
  const r = ADV.advise('my titer varies between resin lots and I want to know which lot is to blame');
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.recommendations[0].id, 'variance-components');
  assert.ok(r.recommendations[0].hits.length, 'a recommendation must show why it was made');
  for (const k of ['bring', 'first', 'then', 'title', 'what']) assert.ok(r.recommendations[0][k], 'missing ' + k);
  /* Genuinely torn input must produce the distinguishing question rather than a confident
     wrong answer. "The same or just noisy" is exactly the sentence where routing straight to
     one tool would send someone down the wrong path. */
  const amb = ADV.advise('are these two lots the same or just noisy');
  assert.strictEqual(amb.status, 'unsure');
  assert.ok(/\?$/.test(amb.question), 'the question must be a question: ' + amb.question);
  assert.ok(amb.recommendations.length >= 2, 'an unsure answer must offer both options');
  assert.ok(amb.question.includes(amb.recommendations[0].distinguish) && amb.question.includes(amb.recommendations[1].distinguish),
    'the question must contrast the two tools it is torn between');
  assert.ok(ADV.advise('set a release specification').recommendations.length <= 3, 'at most three options');
});

test('the advisor normalises the ways people actually write', () => {
  // A word and its tenses must reach the same stem, or the lexicon matches one and misses the other.
  for (const [a, b] of [['measure', 'measured'], ['store', 'stored'], ['agree', 'agreed'], ['change', 'changed'],
    ['transfer', 'transferring'], ['run', 'running'], ['vary', 'varies'], ['batch', 'batches']]) {
    assert.strictEqual(ADV.tokenize(a)[0], ADV.tokenize(b)[0], a + ' and ' + b + ' must stem alike');
  }
  // British and American spelling, and the acronyms a site actually types.
  assert.deepStrictEqual(ADV.tokenize('optimise'), ADV.tokenize('optimize'));
  assert.deepStrictEqual(ADV.tokenize('analyse'), ADV.tokenize('analyze'));
  assert.ok(ADV.advise('MSA on the balance').recommendations[0].id === 'gage-rr', 'MSA should expand');
  assert.ok(ADV.advise('how many lots for PPQ').recommendations[0].id === 'study-size', 'PPQ should expand');
  assert.ok(ADV.advise('is my Cpk acceptable').recommendations[0].id === 'capability', 'Cpk should expand');
  /* Negation modifies a clause, not the subject. "Without changing the protein" is still
     about proteins, and suppressing topic words near a negation threw away more right
     answers than it saved. */
  for (const t of ['rewrite the gene for the host without changing the protein',
    'I cannot raise one ingredient without lowering the others']) {
    assert.notStrictEqual(ADV.advise(t).status, 'nomatch', 'negation must not erase the topic: ' + t);
  }
  assert.strictEqual(ADV.advise('rewrite the gene for the host without changing the protein').recommendations[0].id, 'codon');
});

test('every advisor recommendation points somewhere that exists', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const selector = (html.match(/<select id="tool">([\s\S]*?)<\/select>/) || [])[1] || '';
  const tools = new Set([...selector.matchAll(/<option value="([a-z]+)"/g)].map(m => m[1]));
  const ids = new Set();
  for (const p of ADV.PLAYBOOKS) {
    assert.ok(tools.has(p.tool), p.id + ' points at a tool that is not in the selector: ' + p.tool);
    assert.ok(!ids.has(p.id), 'duplicate playbook id ' + p.id);
    ids.add(p.id);
    // The mode it preselects, and any panel it opens, have to be real elements.
    if (p.mode) {
      assert.ok(new RegExp('id="' + p.mode.sel + '"').test(html), p.id + ' sets a control that does not exist: ' + p.mode.sel);
      /* The value has to be a real option. Most selects are written into the page, but the
         design chooser is filled at runtime from the design registry, so both are allowed
         sources and neither lets a typo through. */
      const inHtml = new RegExp('value="' + p.mode.value + '"').test(html);
      const inDesigns = Object.prototype.hasOwnProperty.call(D.DESIGNS, p.mode.value);
      assert.ok(inHtml || inDesigns, p.id + ' selects a value that is neither in the page nor a known design: ' + p.mode.value);
    }
    if (p.open) assert.ok(new RegExp('id="' + p.open + '"').test(html), p.id + ' opens a panel that does not exist: ' + p.open);
    for (const k of ['title', 'what', 'bring', 'first', 'then', 'distinguish']) assert.ok(p[k] && p[k].length > 10, p.id + ' needs a ' + k);
    assert.ok(p.phrases.length >= 10, p.id + ' has only ' + p.phrases.length + ' phrases');
  }
  // Every playbook must be reachable by something, or it is dead weight.
  const reached = new Set(ADVEV.CASES.map(c => c.want));
  for (const p of ADV.PLAYBOOKS) assert.ok(reached.has(p.id), p.id + ' has no eval case');
  // And the front door must promise what the rest of the page promises.
  assert.ok(/never sent anywhere, and never stored/.test(html), 'the ask box must state what happens to what is typed');
});

test('hairpins near the start are found, and only real ones', () => {
  const hp = (seq, opt) => CD.hairpins(seq, Object.assign({ within: 20 }, opt || {}));
  // A tight stem-loop: six Watson-Crick pairs closing over a short loop.
  const tight = hp('ATG' + 'GCGCGC' + 'TTTT' + 'GCGCGC' + 'AAAGATCTGAAAGGCTAA');
  assert.strictEqual(tight.length, 1);
  assert.strictEqual(tight[0].stem, 6);
  assert.ok(tight[0].loop >= 3 && tight[0].loop <= 8, 'loop ' + tight[0].loop);
  assert.ok(tight[0].strength >= 12, 'a GC stem should score as strong: ' + tight[0].strength);

  /* A short run pairing across a long gap is not a hairpin, and without a cap on the loop
     any T-rich and A-rich patch within reach of each other would be reported. */
  assert.strictEqual(hp('ATGAAAGATCTGAAATTTGAAAAAGATCTGAAAGGC').length, 0);
  assert.strictEqual(hp('ATGAAAGAAGATAAAGAAGATAAAGAAGATAAAGGC').length, 0);
  // Below the minimum stem length, nothing is reported.
  assert.strictEqual(hp('ATG' + 'GC' + 'TTT' + 'GC' + 'AAAAAAAAAAAAAAA', { minStem: 4 }).length, 0);
  // A realistic antibody-style start must come back clean, or the option is unusable.
  assert.strictEqual(hp('ATGGCCGAGGTGCAGCTGGTGGAGTCTGGGGGAGGCTTGGTACAGCCTGGG').length, 0);
  // One structure must be reported once, not as every overlapping candidate.
  assert.strictEqual(hp('ATG' + 'GGCGCC' + 'TTT' + 'GGCGCC' + 'AAAAAAAAAAAA').length, 1);
  // Only stems that start inside the window count.
  const late = 'ATG' + 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' + 'GCGCGC' + 'TTT' + 'GCGCGC';
  assert.strictEqual(hp(late, { within: 20 }).length, 0, 'a stem beyond the window must not count');
  assert.ok(hp(late, { within: 60 }).length >= 1, 'but it must be found when the window covers it');
  // A tighter stem requirement can only ever find fewer.
  assert.ok(hp('ATG' + 'GCGCGC' + 'TTTT' + 'GCGCGC' + 'AAAGATCTGAAAGGCTAA', { minStem: 7 }).length <= 1);
});

test('the no-hairpin option is a hard constraint, and is off unless asked for', () => {
  const w = CD.relativeAdaptiveness('CHO');
  const base = { w, motifs: [], maxRun: 6 };
  const seq = CD.clean('ATG' + 'GCGCGC' + 'TTTGCGCGC' + 'AAAGATCTGAAAGGCGATCTGAAAGGCGATCTGAAATAA');
  // Off by default: an unasked-for constraint must never fail somebody's design.
  assert.strictEqual(CD.score(seq, base).violations, 0);
  assert.deepStrictEqual(CD.score(seq, base).hairpins, []);
  const on = CD.score(seq, Object.assign({}, base, { noHairpin: { within: 20, minStem: 4 } }));
  assert.strictEqual(on.hairpins.length, 1);
  assert.strictEqual(on.violations, 1, 'a hairpin must count as a violation, not an objective');

  /* Run the optimizer with the requirement on. It has very little room - the start codon is
     fixed and only a few codons follow - so the test is that the requirement is either met
     or reported, never silently dropped. */
  const job = {
    dna: seq, host: 'CHO', gcLow: 0.4, gcHigh: 0.6, maxRun: 6, avoid: [],
    popSize: 60, generations: 150, seed: 11, noHairpin: { within: 20, minStem: 4, minLoop: 3 }
  };
  const run = GA.create(job);
  assert.ok(run.state.baseline.hairpins.length > 0, 'the starting sequence carries the hairpin');
  run.step(150);
  const res = run.result();
  assert.ok(res.proteinUnchanged, 'the protein must never change');
  assert.ok(Array.isArray(res.after.hairpins), 'hairpins must be reported in the result');
  if (res.after.violations === 0) {
    assert.strictEqual(res.after.hairpins.length, 0, 'zero violations must mean zero hairpins');
    // And it must not have paid for that by wrecking the codon usage.
    assert.ok(res.after.cai >= res.before.cai, 'CAI ' + res.before.cai + ' -> ' + res.after.cai);
  } else {
    assert.ok(res.after.hairpins.length > 0, 'a violation must be an actual reported hairpin');
  }
  // Every sequence offered on the front must satisfy the requirement, not just the pick.
  for (const f of res.front) assert.strictEqual(CD.hairpins(f.dna, { within: 20, minStem: 4 }).length, 0,
    'a sequence offered as a trade-off must still meet a hard requirement');
  // With the requirement off, the same search is free to leave the start structured.
  const offJob = Object.assign({}, job, { noHairpin: null });
  const offRun = GA.create(offJob); offRun.step(150);
  const off = offRun.result();
  assert.ok(off.proteinUnchanged);
  assert.deepStrictEqual(off.after.hairpins, [], 'with the option off, no hairpins are reported at all');
});

test('several models are reported, not just the winner, and agreement is measured', async () => {
  /* A single model's ranking is a single model's opinion. The point of refitting the
     runners-up is that agreement between unrelated model families is much better evidence,
     and disagreement is worth seeing before anyone acts on a driver chart. */
  const rand = E.rng(7);
  const cols = ['Temp', 'pH', 'Feed', 'DO', 'Agit', 'Shift', 'Yield'], rows = [];
  for (let i = 0; i < 200; i++) {
    const t = 35 + rand() * 4, ph = 6.8 + rand() * 0.6, f = 1 + rand() * 9, d = 30 + rand() * 40, ag = 100 + rand() * 60;
    // Temperature dominates through a strong curve; pH and feed matter less; DO and agitation barely.
    const y = 50 - 4.5 * (t - 37) * (t - 37) + 18 * (ph - 7) + 1.2 * f + 0.02 * d + 0.005 * ag + (rand() - 0.5) * 3;
    rows.push([t.toFixed(2), ph.toFixed(2), f.toFixed(2), d.toFixed(1), ag.toFixed(0), i % 3 ? 'A' : 'B', y.toFixed(2)]);
  }
  const rep = await A.run({ columns: cols, rows }, { target: 'Yield' });

  assert.ok(rep.compare && rep.compare.length >= 2, 'at least two models must be reported');
  assert.ok(rep.compare.length <= 3, 'but not so many that the table stops being readable');
  assert.ok(rep.compare.some(c => c.chosen), 'the chosen model must be among those shown');
  assert.strictEqual(rep.compare.filter(c => c.chosen).length, 1, 'exactly one is the chosen model');
  assert.ok(!rep.compare.some(c => c.id === 'baseline'), 'guessing the average is not a contender');
  const ids = rep.compare.map(c => c.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'no model should appear twice');

  for (const c of rep.compare) {
    assert.ok(c.metrics && isFinite(c.metrics.r2), c.name + ' needs its score');
    assert.ok(c.importance.length, c.name + ' needs its own drivers');
    const total = c.importance.reduce((s, v) => s + v.share, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, c.name + ' shares must add to one, got ' + total);
    assert.ok(c.importance.every(v => v.share >= 0), 'no negative importance');
    // Each model is asked independently, so these are genuinely its own numbers.
    assert.ok(c.importance.some(v => v.name === 'Temp'), c.name + ' should see the dominant driver');
  }
  // The chosen model's entry must match the headline importance, not be recomputed differently.
  const chosen = rep.compare.find(c => c.chosen);
  assert.strictEqual(chosen.importance[0].name, rep.importance[0].name);

  // Agreement is measured rather than asserted, and on this data it should be unanimous.
  assert.ok(rep.agreement, 'agreement must be reported');
  assert.strictEqual(rep.agreement.topDriver, 'Temp', 'tops were ' + JSON.stringify(rep.agreement.tops));
  assert.ok(rep.agreement.shared.includes('Temp'));
  assert.ok(rep.agreement.union.length >= rep.agreement.shared.length, 'the union cannot be smaller than the shared set');
  assert.ok(rep.log.some(l => /put Temp first/.test(l.text)), 'the agreement should be said out loud');

  /* With pure noise there is nothing to agree about, and the tool must not manufacture a
     consensus out of three models all ranking noise. */
  const noiseRows = [];
  const r2 = E.rng(3);
  for (let i = 0; i < 120; i++) noiseRows.push([r2().toFixed(3), r2().toFixed(3), r2().toFixed(3), (r2() * 10).toFixed(3)]);
  const noise = await A.run({ columns: ['A', 'B', 'C', 'Out'], rows: noiseRows }, { target: 'Out' });
  if (noise.agreement && noise.agreement.topDriver) {
    // If they do all agree on noise, it must at least be a weak, honestly-scored model.
    assert.ok(noise.best.metrics.r2 < 0.3, 'a confident consensus on noise would be a bug: r2 ' + noise.best.metrics.r2);
  }
});

const FOLD = require(path.join(ROOT, 'fold.js'));

test('folding produces a valid, nested secondary structure', () => {
  const valid = db => {
    const st = [];
    for (const c of db) { if (c === '(') st.push(1); else if (c === ')') { if (!st.length) return false; st.pop(); } }
    return st.length === 0;
  };
  const cases = ['AAAGGGGCCCCTTTTGGGGCCCCAAA', 'CCCCAGCGGCTGGCTTATATCGGCACGACCCGGGCCAGCCGCTGGGGTAA',
    'AAAAAGCGCGCTTTTGCGCGCAAAAAAAAAAGGCCGGTTTTCCGGCCAAAAA', 'ATGGCCGAGGTGCAGCTGGTGGAGTCTGGGGGAGGCTTGGTACAGCCTGGG'];
  for (const seq of cases) {
    const f = FOLD.foldStructure(seq);
    assert.strictEqual(f.dotBracket.length, f.seq.length);
    assert.ok(valid(f.dotBracket), 'brackets must balance: ' + f.dotBracket);
    for (let i = 0; i < f.pairs.length; i++) {
      const j = f.pairs[i];
      if (j < 0) continue;
      assert.strictEqual(f.pairs[j], i, 'pairing must be symmetric at ' + i);
      // A hairpin cannot close on fewer than three unpaired bases, and nothing may cross.
      if (j > i) assert.ok(j - i - 1 >= FOLD.MIN_LOOP, 'loop too short at ' + i + '-' + j);
      if (j > i) assert.ok(FOLD.PAIR[f.seq[i] + f.seq[j]] !== undefined, 'invented a pair ' + f.seq[i] + f.seq[j]);
    }
  }
  // Nothing to fold must fold into nothing, rather than into something invented.
  assert.strictEqual(FOLD.foldStructure('AAAAAAAAAAAAAAAAAAAAAAAA').pairs.filter(p => p >= 0).length, 0);
  assert.strictEqual(FOLD.foldStructure('').dotBracket, '');
  assert.strictEqual(FOLD.foldStructure('AT').dotBracket, '..');
  // Same sequence, same structure: a drawing has to be reproducible.
  const a = FOLD.foldStructure(cases[1]), b = FOLD.foldStructure(cases[1]);
  assert.strictEqual(a.dotBracket, b.dotBracket);

  /* Charging for loops is what stops base-pair maximization merging two tidy hairpins into
     one long bulgy helix, so the designed case has to come back as two separate stems. */
  const two = FOLD.foldStructure('AAAAAGCGCGCTTTTGCGCGCAAAAAAAAAAGGCCGGTTTTCCGGCCAAAAA');
  let depth = 0, exterior = 0;
  for (const c of two.dotBracket) { if (c === '(') { if (!depth) exterior++; depth++; } else if (c === ')') depth--; }
  assert.strictEqual(exterior, 2, 'two designed hairpins must stay two: ' + two.dotBracket);
});

test('the structure drawing does not cross itself', () => {
  /* A secondary structure diagram that crosses its own backbone is unreadable and, worse,
     looks like a pseudoknot. The layout is nested, so for ordinary folds this must be zero. */
  const cross = (p, q, c, d) => {
    const o = (a, b, e) => Math.sign((b.x - a.x) * (e.y - a.y) - (b.y - a.y) * (e.x - a.x));
    const pts = [p, q, c, d];
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < 1e-6) return false;
    return o(p, q, c) !== o(p, q, d) && o(c, d, p) !== o(c, d, q);
  };
  for (const seq of ['AAAGGGGCCCCTTTTGGGGCCCCAAA', 'AAAAAGCGCGCTTTTGCGCGCAAAAAAAAAAGGCCGGTTTTCCGGCCAAAAA',
    'CCCCAGCGGCTGGCTTATATCGGCACGACCCGGGCCAGCCGCTGGGGTAA', 'ATGGCGCGCTTTGCGCGCAAAGATCTGAAAGGCGATCTGAAAGGCGATCTGAAAGGCGATCTGAAATAA']) {
    const f = FOLD.foldStructure(seq), pos = FOLD.layout(f.seq, f.pairs);
    assert.strictEqual(pos.length, f.seq.length);
    assert.ok(pos.every(p => isFinite(p.x) && isFinite(p.y)), 'every base must be placed');
    const segs = [];
    for (let i = 1; i < pos.length; i++) segs.push([pos[i - 1], pos[i]]);
    for (let i = 0; i < f.pairs.length; i++) if (f.pairs[i] > i) segs.push([pos[i], pos[f.pairs[i]]]);
    let n = 0;
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (cross(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) n++;
    assert.strictEqual(n, 0, n + ' crossings in ' + f.dotBracket);
    // Paired bases sit one step apart, which is what makes a helix look like a helix.
    for (let i = 0; i < f.pairs.length; i++) {
      const j = f.pairs[i];
      if (j > i) assert.ok(Math.abs(Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y) - 24) < 0.5, 'pair ' + i + '-' + j + ' is not one step apart');
    }
    // And no two bases land on top of each other.
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
      assert.ok(Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y) > 8, 'bases ' + i + ' and ' + j + ' overlap');
    }
  }
});

const PL = require(path.join(ROOT, 'plasmid.js'));

/* A synthetic screening corpus with a known generating process and deliberately
   heteroscedastic noise - bigger plasmids are noisier - because that is exactly the shape
   where a fixed multiple of the residual spread misleads. */
function plasmidCorpus(n, seed, opt) {
  opt = opt || {};
  const r = E.rng(seed);
  const prom = ['CMV', 'EF1a', 'SV40', 'CAG'], mark = ['GS', 'DHFR', 'Puromycin'], mode = ['Stable', 'Transient'];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const pr = prom[Math.floor(r() * prom.length)], mk = mark[Math.floor(r() * mark.length)], md = mode[Math.floor(r() * mode.length)];
    const cai = (opt.caiLo || 0.6) + r() * ((opt.caiHi || 0.98) - (opt.caiLo || 0.6));
    const kb = (opt.kbLo || 4) + r() * ((opt.kbHi || 13) - (opt.kbLo || 4));
    const sd = 1.5 + r() * 7, enh = r() < 0.5 ? 'Yes' : 'No';
    const ps = PL.PROMOTERS[pr].strength, ms = PL.MARKERS[mk].stringency;
    const nz = () => { const u = Math.max(1e-9, r()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
    const noise = 0.08 + 0.05 * (kb - 4);
    const titer = 1.2 + 3.4 * ps + 1.8 * cai + 0.9 * ms + (enh === 'Yes' ? 0.45 : 0) - 0.11 * kb + 0.06 * sd + (md === 'Stable' ? 0.5 : 0) + nz() * noise;
    rows.push(['C' + i, pr, enh, cai.toFixed(3), kb.toFixed(2), mk, md, sd.toFixed(2), Math.max(0.05, titer).toFixed(3)]);
  }
  return { columns: ['Construct_ID', 'Promoter_Type', 'Enhancer_Present', 'CAI_Score', 'Plasmid_Size_kb', 'Selection_Marker', 'Expression_Mode', 'Seed_Density_10e5', 'Titer_gL'], rows };
}
const PL_FEATS = ['Promoter_Type', 'Enhancer_Present', 'CAI_Score', 'Plasmid_Size_kb', 'Selection_Marker', 'Expression_Mode', 'Seed_Density_10e5'];

test('conformal intervals keep the coverage they claim', () => {
  const m = PL.trainTarget(E.profile(plasmidCorpus(240, 11)), 'Titer_gL', PL_FEATS, { seed: 7 });
  assert.ok(isFinite(m.r2) && m.r2 > 0.5, 'the model must actually fit: r2 ' + m.r2);
  assert.ok(m.nCal >= 5, 'runs must be held back to calibrate');

  const measure = (table, conf) => {
    const tp = E.profile(table);
    const col = tp.columns.find(c => c.name === 'Titer_gL');
    let inside = 0, width = 0, n = 0;
    for (let r = 0; r < tp.nRows; r++) {
      const obj = {}; tp.columns.forEach(c => { obj[c.name] = c.values[r]; });
      const x = m.enc.encodeValues(obj);
      const half = m.q(conf) * (m.beta + m.distance(x));
      const yhat = m.predictRaw(x);
      if (Math.abs(col.values[r] - yhat) <= half) inside++;
      width += 2 * half; n++;
    }
    return { cov: inside / n, width: width / n };
  };
  /* The guarantee is that coverage does not fall below what was asked for. Some conservatism
     is expected and fine; falling short is the failure that matters. */
  for (const conf of [0.8, 0.9, 0.95]) {
    const got = measure(plasmidCorpus(600, 99), conf);
    assert.ok(got.cov >= conf - 0.04, 'at ' + conf + ' the interval only covered ' + got.cov.toFixed(3));
    assert.ok(got.cov <= conf + 0.12, 'at ' + conf + ' the interval is uselessly wide: ' + got.cov.toFixed(3));
  }
  // Asking for more confidence must widen the band, never narrow it.
  assert.ok(measure(plasmidCorpus(300, 5), 0.95).width > measure(plasmidCorpus(300, 5), 0.8).width);

  /* The behaviour the whole module exists for: outside the data the band widens. A fixed
     multiple of the residual spread cannot do this, which is the point of the comparison. */
  const near = measure(plasmidCorpus(400, 77, { caiLo: 0.7, caiHi: 0.9, kbLo: 5, kbHi: 9 }), 0.9);
  const far = measure(plasmidCorpus(400, 78, { caiLo: 0.3, caiHi: 0.55, kbLo: 14, kbHi: 20 }), 0.9);
  assert.ok(far.width > near.width * 1.25, 'outside the data the band must widen: ' + near.width.toFixed(3) + ' -> ' + far.width.toFixed(3));
});

test('unseen levels are mapped or refused, never silently treated as the commonest', () => {
  const known = ['CMV', 'EF1a', 'SV40'];
  assert.strictEqual(PL.nearestLevel('CMV', known, PL.PROMOTERS).exact, true);
  // Matched on name: a variant of a known promoter is treated as that promoter, and says so.
  const variant = PL.nearestLevel('CMV-intron', known, PL.PROMOTERS);
  assert.strictEqual(variant.level, 'CMV');
  assert.strictEqual(variant.exact, false);
  assert.ok(/contains/.test(variant.why));
  // Matched on declared property when the name gives nothing away.
  const byProp = PL.nearestLevel('UBC', known, PL.PROMOTERS);
  assert.ok(byProp.level && byProp.level !== null, 'UBC should map to something');
  assert.ok(/strength/.test(byProp.why), byProp.why);
  // And something nobody can place must come back as unplaceable, not as the reference level.
  assert.strictEqual(PL.nearestLevel('Zorb9000', known, PL.PROMOTERS).level, null);

  const prof = E.profile(plasmidCorpus(200, 11));
  const models = { Titer_gL: PL.trainTarget(prof, 'Titer_gL', PL_FEATS, { seed: 7 }) };
  const env = PL.summarise(prof, PL_FEATS);
  assert.ok(env.numeric.CAI_Score.min < env.numeric.CAI_Score.max, 'the envelope must be measured');
  assert.ok(env.categorical.Promoter_Type.levels.length >= 3);

  const base = { Promoter_Type: 'CMV', Enhancer_Present: 'Yes', CAI_Score: 0.85, Plasmid_Size_kb: 7, Selection_Marker: 'GS', Expression_Mode: 'Stable', Seed_Density_10e5: 4 };
  const ok = PL.predict(models, env, base, { confidence: 0.9 });
  assert.ok(ok.ok && ok.trust === 'inside', JSON.stringify({ ok: ok.ok, trust: ok.trust }));
  assert.ok(ok.results.Titer_gL.low < ok.results.Titer_gL.value && ok.results.Titer_gL.value < ok.results.Titer_gL.high);
  assert.strictEqual(ok.substitutions.length, 0);
  assert.strictEqual(ok.outside.length, 0);

  // A level that cannot be placed stops the prediction.
  const blocked = PL.predict(models, env, Object.assign({}, base, { Promoter_Type: 'Zorb9000' }), {});
  assert.strictEqual(blocked.ok, false);
  assert.ok(blocked.blocking[0].field === 'Promoter_Type');

  // A level that can be placed is substituted, and the substitution is reported.
  const sub = PL.predict(models, env, Object.assign({}, base, { Promoter_Type: 'CMV-intron' }), {});
  assert.ok(sub.ok);
  assert.strictEqual(sub.substitutions.length, 1);
  assert.strictEqual(sub.substitutions[0].used, 'CMV');

  // Out of range is detected, named, and widens the band.
  const far = PL.predict(models, env, Object.assign({}, base, { Plasmid_Size_kb: 19, CAI_Score: 0.35 }), { confidence: 0.9 });
  assert.ok(far.ok);
  assert.strictEqual(far.outside.length, 2);
  assert.ok(far.outside.every(o => o.by > 0 && o.field));
  assert.ok(far.distance > ok.distance, 'distance must grow with extrapolation');
  assert.ok(far.results.Titer_gL.halfWidth > ok.results.Titer_gL.halfWidth * 1.1, 'the interval must widen');
  assert.strictEqual(far.trust, 'outside');

  // The cap is an assumption, so it is reported when it binds rather than applied silently.
  const capped = PL.predict(models, env, base, { caps: { Titer_gL: 0.5 } });
  assert.strictEqual(capped.results.Titer_gL.capped, true);
  assert.strictEqual(capped.results.Titer_gL.value, 0.5);
  assert.ok(capped.results.Titer_gL.uncapped > 0.5, 'the uncapped figure must still be reported');

  // And the four-run screen is built over what is actually outside.
  const doe = PL.suggestDOE(env, Object.assign({}, base, { Plasmid_Size_kb: 19, CAI_Score: 0.35 }), far.outside, { seed: 3 });
  assert.strictEqual(doe.runs.length, 4);
  assert.strictEqual(doe.factors.length, 2);
  assert.deepStrictEqual(doe.factors.map(f => f.name).sort(), ['CAI_Score', 'Plasmid_Size_kb']);
  assert.deepStrictEqual(doe.runs.map(r => r.run).sort(), [1, 2, 3, 4]);
  assert.deepStrictEqual(doe.runs.map(r => r.std).sort(), [1, 2, 3, 4]);
  // Corners, so each factor takes each level twice.
  for (let j = 0; j < 2; j++) {
    const vals = doe.runs.map(r => r.values[j]);
    assert.strictEqual(new Set(vals).size, 2, 'factor ' + j + ' must be run at two levels');
  }
  assert.ok(PL.trainTarget.length >= 3);
  assert.throws(() => PL.trainTarget(E.profile(plasmidCorpus(8, 1)), 'Titer_gL', PL_FEATS, {}), /at least 12/);
});

/* Forecasting a whole proposed run sheet. The per-row mechanics are the same conformal
   machinery already checked above, so what needs establishing here is the part that is
   new when the question moves from one run to many: that a per-run interval does NOT
   cover a whole sheet, by how much it falls short, and that spending the error budget
   across the runs fixes it. All three are measured, not asserted. */
test('a run sheet is forecast row by row, with what was held and substituted named', () => {
  const prof = E.profile(plasmidCorpus(200, 11));
  const models = { Titer_gL: PL.trainTarget(prof, 'Titer_gL', PL_FEATS, { seed: 7 }) };
  const env = PL.summarise(prof, PL_FEATS);
  const desk = { Promoter_Type: 'CMV', Enhancer_Present: 'Yes', CAI_Score: 0.85, Plasmid_Size_kb: 7, Selection_Marker: 'GS', Expression_Mode: 'Stable', Seed_Density_10e5: 4 };

  // The sheet only carries the two things being varied; everything else is held at the desk.
  const sheet = {
    columns: ['RunOrder', 'StdOrder', 'Promoter_Type', 'Plasmid_Size_kb'],
    rows: [['1', '1', 'CMV', '6'], ['2', '2', 'EF1a', '6'], ['3', '3', 'CMV', '19'], ['4', '4', 'CMV-intron', '8']]
  };
  const parsed = PL.parseRunSheet(sheet, env, desk);
  assert.strictEqual(parsed.rows.length, 4);
  assert.deepStrictEqual(parsed.rows.map(r => r.run), [1, 2, 3, 4]);
  assert.deepStrictEqual(parsed.rows.map(r => r.std), [1, 2, 3, 4]);
  // The columns the sheet does carry are mapped; the rest are named as held, not dropped.
  assert.deepStrictEqual(parsed.factors.slice().sort(), ['Plasmid_Size_kb', 'Promoter_Type']);
  assert.deepStrictEqual(parsed.held.slice().sort(),
    ['CAI_Score', 'Enhancer_Present', 'Expression_Mode', 'Seed_Density_10e5', 'Selection_Marker']);
  assert.strictEqual(parsed.missing.length, 0);
  assert.strictEqual(parsed.rows[0].values.CAI_Score, 0.85, 'a feature the sheet omits must come from the desk');
  assert.strictEqual(parsed.rows[2].values.Plasmid_Size_kb, 19, 'and one it carries must come from the sheet');

  // A column that is not a feature is reported rather than silently absorbed.
  const noisy = PL.parseRunSheet({ columns: ['RunOrder', 'Plasmid_Size_kb', 'Operator_Initials'], rows: [['1', '6', 'VK']] }, env, desk);
  assert.deepStrictEqual(noisy.ignored, ['Operator_Initials']);
  // Loose matching, so a shortened header still finds its feature.
  assert.strictEqual(PL.parseRunSheet({ columns: ['CAI'], rows: [['0.7']] }, env, desk).rows[0].values.CAI_Score, 0.7);

  const fc = PL.forecastSheet(models, env, parsed.rows, { confidence: 0.9 });
  assert.ok(fc.ok);
  assert.strictEqual(fc.rows.length, 4);
  assert.strictEqual(fc.tally.n, 4);
  assert.strictEqual(fc.tally.refused, 0);
  // Every row gets its own prediction, its own interval and its own standing.
  for (const r of fc.rows) {
    assert.ok(r.ok, 'run ' + r.run + ' should have been forecast');
    const x = r.results.Titer_gL;
    assert.ok(isFinite(x.value) && x.low < x.value && x.value < x.high, JSON.stringify(x));
    assert.ok(['inside', 'edge', 'outside'].indexOf(r.trust) >= 0);
  }
  // The row that leaves the envelope is the row that is flagged, and its band is wider.
  const big = fc.rows.find(r => r.run === 3), small = fc.rows.find(r => r.run === 1);
  assert.ok(big.outside.some(o => o.field === 'Plasmid_Size_kb'), 'run 3 is outside the corpus on size');
  assert.strictEqual(small.outside.length, 0);
  assert.ok(big.results.Titer_gL.halfWidth > small.results.Titer_gL.halfWidth,
    'the extrapolating row must carry the wider band: ' + big.results.Titer_gL.halfWidth + ' vs ' + small.results.Titer_gL.halfWidth);
  assert.ok(fc.tally.inside + fc.tally.edge + fc.tally.outside === 4);
  /* Standing and beyond-range are counted separately because they are different claims,
     and a sheet where they disagree is the normal case rather than a curiosity. Run 3 is
     past the end of the size column; the counts must reflect that independently. */
  assert.strictEqual(fc.tally.beyondEnvelope, 1, 'exactly one row sets an input past the corpus range');
  assert.ok(fc.tally.beyondEnvelope !== fc.tally.outside,
    'this sheet is the case where the two measures disagree, which is what makes keeping them apart worth doing');
  assert.strictEqual(fc.rows.filter(r => r.ok && r.outside.length).length, fc.tally.beyondEnvelope);
  // The unseen promoter is mapped and the mapping is attached to that row, not the sheet.
  const mapped = fc.rows.find(r => r.run === 4);
  assert.strictEqual(mapped.substitutions.length, 1);
  assert.strictEqual(mapped.substitutions[0].used, 'CMV');

  // A sheet that cannot fill a categorical refuses that row rather than defaulting it,
  // which is the whole point of the module and must survive the batch path.
  const bare = PL.parseRunSheet({ columns: ['RunOrder', 'Plasmid_Size_kb'], rows: [['1', '6']] }, env, {});
  assert.ok(bare.missing.indexOf('Promoter_Type') >= 0);
  const refused = PL.forecastSheet(models, env, bare.rows, { confidence: 0.9 });
  assert.strictEqual(refused.tally.refused, 1);
  assert.strictEqual(refused.rows[0].ok, false);
  assert.ok(refused.rows[0].blocking.some(b => b.field === 'Promoter_Type'));

  // An empty sheet is an error, not an empty forecast that looks like a clean one.
  assert.strictEqual(PL.forecastSheet(models, env, [], {}).ok, false);

  // A design from the screen button becomes forecastable rows with the desk held around it.
  const far = PL.predict(models, env, Object.assign({}, desk, { Plasmid_Size_kb: 19, CAI_Score: 0.35 }), {});
  const design = PL.suggestDOE(env, Object.assign({}, desk, { Plasmid_Size_kb: 19, CAI_Score: 0.35 }), far.outside, { seed: 3 });
  const rows = PL.sheetFromDesign(design, desk);
  assert.strictEqual(rows.length, 4);
  assert.strictEqual(rows[0].values.Promoter_Type, 'CMV', 'the desk settings must be carried into every run');
  design.factors.forEach((f, j) => {
    rows.forEach((r, i) => assert.strictEqual(r.values[f.name], design.runs[i].values[j], 'design factor must reach the row'));
  });
  assert.ok(PL.forecastSheet(models, env, rows, { confidence: 0.9 }).tally.refused === 0);
});

test('whether the sheet can rank its own runs is reported, not assumed', () => {
  const prof = E.profile(plasmidCorpus(300, 23));
  const models = { Titer_gL: PL.trainTarget(prof, 'Titer_gL', PL_FEATS, { seed: 7 }) };
  const env = PL.summarise(prof, PL_FEATS);
  const desk = { Promoter_Type: 'CMV', Enhancer_Present: 'Yes', CAI_Score: 0.85, Plasmid_Size_kb: 7, Selection_Marker: 'GS', Expression_Mode: 'Stable', Seed_Density_10e5: 4 };
  const at = over => over.map((v, i) => ({ run: i + 1, values: Object.assign({}, desk, v) }));

  /* A sheet that only jiggles one factor a little cannot separate its runs, and must say
     so. TK against CMV is the largest promoter contrast the table carries, so the wide
     sheet is the one that should come back separable. */
  const narrow = PL.forecastSheet(models, env, at([
    { Seed_Density_10e5: 4.0 }, { Seed_Density_10e5: 4.1 }, { Seed_Density_10e5: 4.2 }
  ]), { confidence: 0.9 });
  const ns = narrow.byTarget.Titer_gL;
  assert.strictEqual(ns.separated, false, 'runs a tenth apart cannot be separable');
  assert.strictEqual(ns.bestBeatsWorst, false);
  assert.ok(ns.indistinguishable.length === 2, 'both other runs overlap the best');
  assert.ok(ns.spread < ns.meanHalfWidth, 'the effect it is chasing is smaller than its own uncertainty');

  // A sheet spanning the strongest and weakest promoter in the corpus should separate.
  const wide = PL.forecastSheet(models, env, at([
    { Promoter_Type: 'CMV', CAI_Score: 0.95 }, { Promoter_Type: 'SV40', CAI_Score: 0.62 }
  ]), { confidence: 0.9 });
  const ws = wide.byTarget.Titer_gL;
  assert.ok(ws.spread > ns.spread * 5, 'the wide sheet must chase a bigger effect');
  assert.strictEqual(ws.separated, true, 'a sheet spanning the promoter range should separate its runs');
  assert.strictEqual(ws.bestBeatsWorst, true);
  assert.deepStrictEqual(ws.indistinguishable, []);
  assert.strictEqual(ws.best.run, 1, 'the strong promoter at high CAI must be the better forecast');
  assert.ok(ws.best.value > ws.worst.value);
  assert.ok(ws.best.low > ws.worst.high, 'separated means the bands clear each other');

  // Asking for more confidence widens every band, so it can only cost separability.
  const strict = PL.forecastSheet(models, env, at([
    { Promoter_Type: 'CMV', CAI_Score: 0.95 }, { Promoter_Type: 'SV40', CAI_Score: 0.62 }
  ]), { confidence: 0.95 });
  assert.ok(strict.byTarget.Titer_gL.meanHalfWidth > ws.meanHalfWidth);
});

test('a per-run interval does not cover a whole sheet; the sheet-wide mode fixes it', () => {
  /* The claim being checked is the one a programme actually rests on. A 90% per-run band
     covers 90% of runs on average, which is NOT the same as all twelve runs of a sheet
     landing inside their bands. Measured here rather than reasoned about. */
  const SHEET = 12, SHEETS = 120, CONF = 0.9;
  const FEATS = PL_FEATS;
  function trial(seed, ncorpus, sheets) {
    const SHEETS = sheets || 120;
    // 560 is big enough that the calibration slice can resolve the Bonferroni tail; the
    // case where it cannot is measured too, further down.
    const prof = E.profile(plasmidCorpus(ncorpus || 560, seed));
    const models = { Titer_gL: PL.trainTarget(prof, 'Titer_gL', FEATS, { seed: 7 }) };
    const env = PL.summarise(prof, FEATS);
    const pool = E.profile(plasmidCorpus(SHEET * SHEETS, seed + 5000));
    const tcol = pool.columns.find(c => c.name === 'Titer_gL');
    const obj = ri => { const o = {}; pool.columns.forEach(c => { o[c.name] = c.values[ri]; }); return o; };
    let hits = 0, seen = 0, allMarginal = 0, allSimultaneous = 0, supported = true;
    for (let s = 0; s < SHEETS; s++) {
      const idx = E.range(SHEET).map(j => s * SHEET + j);
      const rows = idx.map((ri, j) => ({ run: j + 1, values: obj(ri) }));
      const truth = idx.map(ri => tcol.values[ri]);
      for (const sim of [false, true]) {
        // The cap is an assumption about burden, not part of the interval, so it is lifted
        // here: capping a band would confound a coverage measurement with a policy choice.
        const f = PL.forecastSheet(models, env, rows, { confidence: CONF, simultaneous: sim, caps: { Titer_gL: Infinity } });
        if (sim) supported = supported && f.supported;
        let all = true;
        f.rows.forEach((r, j) => {
          const x = r.results.Titer_gL;
          const inside = truth[j] >= x.low && truth[j] <= x.high;
          if (!inside) all = false;
          if (!sim) { seen++; if (inside) hits++; }
        });
        if (all) { if (sim) allSimultaneous++; else allMarginal++; }
      }
    }
    return { perRun: hits / seen, allMarginal: allMarginal / SHEETS, allSimultaneous: allSimultaneous / SHEETS, supported };
  }
  const trials = [11, 23, 37].map(s => trial(s, 560));
  const avg = k => trials.reduce((s, t) => s + t[k], 0) / trials.length;

  // Per run, the interval delivers what it says - the guarantee already established above.
  assert.ok(avg('perRun') >= CONF - 0.03, 'per-run coverage fell short: ' + avg('perRun').toFixed(3));

  /* The point of the whole mode. Reading a twelve-run sheet as one forecast through per-run
     bands is far worse than the 90% on the label, and lands near what independence would
     predict (0.9^12 = 0.282). Measured: about 0.33. */
  assert.ok(avg('allMarginal') < 0.55,
    'per-run bands must NOT be presentable as whole-sheet coverage; got ' + avg('allMarginal').toFixed(3));
  assert.ok(avg('allMarginal') > 0.12, 'sanity: it should not be near zero either, got ' + avg('allMarginal').toFixed(3));

  // And spending the error budget across the runs restores the claim.
  assert.ok(trials.every(t => t.supported), 'this corpus should be able to back the Bonferroni tail');
  assert.ok(avg('allSimultaneous') >= CONF,
    'sheet-wide coverage fell short of ' + CONF + ': ' + avg('allSimultaneous').toFixed(3));
  assert.ok(avg('allSimultaneous') > avg('allMarginal') + 0.3,
    'the sheet-wide mode must actually buy something: ' + avg('allMarginal').toFixed(3) + ' -> ' + avg('allSimultaneous').toFixed(3));

  // Sheet-wide bands are wider than per-run bands, which is the price being paid for it.
  const prof = E.profile(plasmidCorpus(560, 11));
  const models = { Titer_gL: PL.trainTarget(prof, 'Titer_gL', FEATS, { seed: 7 }) };
  const env = PL.summarise(prof, FEATS);
  const desk = { Promoter_Type: 'CMV', Enhancer_Present: 'Yes', CAI_Score: 0.85, Plasmid_Size_kb: 7, Selection_Marker: 'GS', Expression_Mode: 'Stable', Seed_Density_10e5: 4 };
  const rows = E.range(SHEET).map(j => ({ run: j + 1, values: desk }));
  const m = PL.forecastSheet(models, env, rows, { confidence: CONF });
  const sm = PL.forecastSheet(models, env, rows, { confidence: CONF, simultaneous: true });
  assert.strictEqual(m.rowConfidence, CONF, 'per-run mode must use the confidence as asked');
  assert.ok(Math.abs(sm.rowConfidence - (1 - (1 - CONF) / SHEET)) < 1e-12, 'the budget must be split across the runs');
  assert.ok(sm.byTarget.Titer_gL.meanHalfWidth > m.byTarget.Titer_gL.meanHalfWidth,
    'holding every run at once has to cost width');

  /* And where the calibration slice is too small to resolve that tail, the tool says so
     instead of printing a band that looks identical. A 200-run corpus holds back 60, which
     can only resolve out to 60/61 = 0.9836 - short of the 0.99167 a twelve-run sheet needs. */
  const small = { Titer_gL: PL.trainTarget(E.profile(plasmidCorpus(200, 11)), 'Titer_gL', FEATS, { seed: 7 }) };
  const senv = PL.summarise(E.profile(plasmidCorpus(200, 11)), FEATS);
  const short = PL.forecastSheet(small, senv, rows, { confidence: CONF, simultaneous: true });
  assert.strictEqual(short.supported, false, 'a 60-run calibration slice cannot back a 12-run Bonferroni tail');
  assert.ok(short.maxConf < short.rowConfidence);
  assert.ok(Math.abs(short.maxConf - small.Titer_gL.nCal / (small.Titer_gL.nCal + 1)) < 1e-12);

  /* And the shortfall is real, not theoretical - which is what earns the warning the tool
     prints. The figures the UI and DEMO.md quote for the unsupported case come from here. */
  const sat = [11, 23, 37].map(s => trial(s, 200, 60));
  const satAvg = sat.reduce((a, t) => a + t.allSimultaneous, 0) / sat.length;
  const satWorst = sat.reduce((a, t) => Math.min(a, t.allSimultaneous), 1);
  assert.ok(sat.every(t => !t.supported), 'a 200-run corpus must report the tail as unsupported');
  assert.ok(satAvg < CONF, 'the unsupported case must actually fall short of ' + CONF + ': ' + satAvg.toFixed(3));
  assert.ok(satWorst < 0.85, 'and must be seen to dip well below it: ' + satWorst.toFixed(3));
  assert.ok(satAvg > 0.70, 'sanity - it is a floor, not a collapse: ' + satAvg.toFixed(3));
  // Per-run mode on the same corpus is within what the slice can resolve, so it is fine.
  assert.strictEqual(PL.forecastSheet(small, senv, rows, { confidence: CONF }).supported, true);
});

/* The comparison the conformal machinery exists to win, measured rather than asserted.
   A fixed multiple of the residual spread is the thing a reader assumes an interval is,
   and the whole reason this module does something else is that such a band is at its most
   confident exactly where it is least justified. The figures quoted in README.md and
   DEMO.md come from here, so they cannot drift away from the code. */
test('a fixed multiple of sigma collapses outside the data where the conformal band holds', () => {
  const prof = E.profile(plasmidCorpus(240, 11));
  const m = PL.trainTarget(prof, 'Titer_gL', PL_FEATS, { seed: 7 });
  // The residual spread on the corpus the model was fitted on, which is what a fixed band uses.
  const tcol = prof.columns.find(c => c.name === 'Titer_gL');
  let se = 0, cnt = 0;
  for (let i = 0; i < prof.nRows; i++) {
    const o = {}; prof.columns.forEach(c => { o[c.name] = c.values[i]; });
    const d = tcol.values[i] - m.predictRaw(m.enc.encodeValues(o));
    se += d * d; cnt++;
  }
  const sigma = Math.sqrt(se / Math.max(1, cnt - 1));
  const cover = (table, mode) => {
    const tp = E.profile(table), col = tp.columns.find(c => c.name === 'Titer_gL');
    let ins = 0, w = 0, n = 0;
    for (let i = 0; i < tp.nRows; i++) {
      const o = {}; tp.columns.forEach(c => { o[c.name] = c.values[i]; });
      const x = m.enc.encodeValues(o);
      // 1.959964 sigma is the two-sided 95% band a normal assumption would give.
      const half = mode === 'fixed' ? 1.959964 * sigma : m.q(0.95) * (m.beta + m.distance(x));
      if (Math.abs(col.values[i] - m.predictRaw(x)) <= half) ins++;
      w += 2 * half; n++;
    }
    return { cov: ins / n, width: w / n };
  };
  const insideTbl = plasmidCorpus(400, 77, { caiLo: 0.7, caiHi: 0.9, kbLo: 5, kbHi: 9 });
  const outsideTbl = plasmidCorpus(400, 78, { caiLo: 0.3, caiHi: 0.55, kbLo: 14, kbHi: 20 });
  const fi = cover(insideTbl, 'fixed'), fo = cover(outsideTbl, 'fixed');
  const ci = cover(insideTbl, 'conf'), co = cover(outsideTbl, 'conf');

  // Inside the data both are fine; that is not where the difference lives.
  assert.ok(fi.cov >= 0.95, 'the fixed band should be fine inside the data: ' + fi.cov.toFixed(3));
  assert.ok(ci.cov >= 0.95, 'and so should the conformal band: ' + ci.cov.toFixed(3));

  /* Outside it the fixed band falls apart, because it cannot widen - its width does not
     depend on where the question is asked. README.md quotes 99.0% inside against 60.3%
     outside; these bounds are what pin that claim. */
  assert.ok(fo.cov < 0.70, 'the fixed band must be shown to collapse outside the data: ' + fo.cov.toFixed(3));
  assert.ok(Math.abs(fo.width - fi.width) < 1e-9, 'a fixed band cannot widen, which is the point');
  assert.ok(fi.cov - fo.cov > 0.30, 'the coverage it loses on leaving the data: ' + (fi.cov - fo.cov).toFixed(3));

  // The conformal band keeps most of its coverage out there, and widens to do it.
  assert.ok(co.cov >= 0.85, 'the conformal band must hold up outside the data: ' + co.cov.toFixed(3));
  assert.ok(co.cov > fo.cov + 0.20, 'and must beat the fixed band where it matters: ' +
    fo.cov.toFixed(3) + ' vs ' + co.cov.toFixed(3));
  const widening = co.width / ci.width;
  assert.ok(widening > 1.4 && widening < 2.0, 'README quotes a 1.66x widening; measured ' + widening.toFixed(3));
});

const UNC = require(path.join(ROOT, 'uncertainty.js'));

/* A regression whose noise grows with x1, which is the shape where one number for the whole
   dataset - an RMSE, a residual sigma - misleads worst. */
function uncCorpus(n, seed, opt) {
  opt = opt || {};
  const r = E.rng(seed), rows = [];
  const nz = () => { const u = Math.max(1e-9, r()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
  for (let i = 0; i < n; i++) {
    const x1 = (opt.lo1 || 0) + r() * ((opt.hi1 || 10) - (opt.lo1 || 0));
    const x2 = (opt.lo2 || 0) + r() * ((opt.hi2 || 5) - (opt.lo2 || 0));
    const g = ['A', 'B', 'C'][Math.floor(r() * 3)];
    const noise = 0.4 + 0.25 * x1;
    const y = 3 + 1.8 * x1 - 0.9 * x2 + (g === 'A' ? 2 : g === 'B' ? 0 : -1.5) + 0.05 * x1 * x1 + nz() * noise;
    rows.push([x1.toFixed(4), x2.toFixed(4), g, y.toFixed(4)]);
  }
  return { columns: ['x1', 'x2', 'grp', 'y'], rows };
}
const UNC_FEATS = ['x1', 'x2', 'grp'];

/* Picks a winner by cross-validation the way the agent does, then holds a slice back from a
   second fit to calibrate the band - which is the arrangement the agent actually ships. */
function uncFit(table, seed) {
  const prof = E.profile(table);
  const tcol = prof.columns.find(c => c.name === 'y');
  const fcols = UNC_FEATS.map(nm => prof.columns.find(c => c.name === nm));
  const data = E.supervisedData(prof, tcol, fcols, 'regression');
  const n = data.rows.length, k = 5;
  const folds = E.makeFolds(n, k, E.rng(seed));
  const cands = E.MODELS.filter(m => m.task !== 'classification' && m.id !== 'baseline' && (!m.applicable || m.applicable(n, fcols.length)));
  let best = null;
  for (const m of cands) {
    try {
      const oof = E.crossValidate(m, data, 'regression', folds, k, seed);
      const r2 = E.regressionMetrics(data.y, oof).r2;
      if (!isFinite(r2)) continue;
      if (!best || r2 > best.r2 + 0.01 || (Math.abs(r2 - best.r2) <= 0.01 && m.complexity < best.m.complexity)) best = { m, r2, oof };
    } catch (err) { /* a model that cannot fit this shape does not compete */ }
  }
  const full = E.fitFull(best.m, data, 'regression', seed);
  const order = E.shuffle(E.range(n), E.rng(seed + 5));
  const nCal = Math.max(8, Math.round(n * 0.3));
  const sub = idx => ({ rows: idx.map(i => data.rows[i]), y: idx.map(i => data.y[i]), classes: null, featureCols: data.featureCols });
  const fitPart = sub(order.slice(nCal)), calPart = sub(order.slice(0, nCal));
  const partial = E.fitFull(best.m, fitPart, 'regression', seed);
  const calX = partial.enc.transform(calPart.rows);
  const cal = UNC.calibrate({ trainX: partial.X, calX, calY: calPart.y, calPred: partial.fitted.predict(calX) }, {});
  return { data, full, best, cal };
}

test('the prediction band widens away from the data, where a fixed sigma cannot', () => {
  const F = uncFit(uncCorpus(300, 11), 7);
  assert.ok(F.cal, 'a calibrator must be built');
  assert.ok(F.cal.nCal >= 8);
  // The ceiling the calibration slice implies, which is what stops a 99% band being offered
  // off 90 rows as though the arithmetic could back it.
  assert.ok(Math.abs(F.cal.maxConf - F.cal.nCal / (F.cal.nCal + 1)) < 1e-12);
  assert.strictEqual(F.cal.supports(0.95), true);
  assert.strictEqual(F.cal.supports(0.999), false);

  // The residual spread a fixed band would use, measured on the rows it was fitted on.
  const trainPred = F.full.fitted.predict(F.full.X);
  let se = 0;
  for (let i = 0; i < F.data.y.length; i++) { const d = F.data.y[i] - trainPred[i]; se += d * d; }
  const sigma = Math.sqrt(se / Math.max(1, F.data.y.length - 1));

  const cover = (table, mode, conf) => {
    const tp = E.profile(table), tc = tp.columns.find(c => c.name === 'y');
    let ins = 0, w = 0, n = 0;
    for (let i = 0; i < tp.nRows; i++) {
      const o = {}; tp.columns.forEach(c => { o[c.name] = c.values[i]; });
      const x = F.full.enc.encodeValues(o);
      const yh = F.full.fitted.predict([x])[0];
      const half = mode === 'fixed' ? 1.959964 * sigma : F.cal.halfWidth(x, conf);
      if (Math.abs(tc.values[i] - yh) <= half) ins++;
      w += 2 * half; n++;
    }
    return { cov: ins / n, width: w / n };
  };
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const insides = [77, 78, 79, 80].map(s => uncCorpus(900, s));
  const outsides = [81, 82, 83, 84].map(s => uncCorpus(900, s, { lo1: 12, hi1: 18, lo2: 6, hi2: 9 }));

  const fi = avg(insides.map(t => cover(t, 'fixed', 0.95).cov));
  const fo = avg(outsides.map(t => cover(t, 'fixed', 0.95).cov));
  const ci = avg(insides.map(t => cover(t, 'conf', 0.95).cov));
  const co = avg(outsides.map(t => cover(t, 'conf', 0.95).cov));
  const wi = avg(insides.map(t => cover(t, 'conf', 0.95).width));
  const wo = avg(outsides.map(t => cover(t, 'conf', 0.95).width));
  const wf = avg(insides.map(t => cover(t, 'fixed', 0.95).width));
  const wfo = avg(outsides.map(t => cover(t, 'fixed', 0.95).width));

  /* The claim the UI makes, pinned. A fixed 1.96-sigma band is fine inside the data and
     collapses outside it, because its width cannot depend on where the question is asked. */
  assert.ok(fi > 0.90, 'the fixed band should look fine inside the data: ' + fi.toFixed(3));
  assert.ok(fo < 0.55, 'and must be shown to collapse outside it: ' + fo.toFixed(3));
  assert.ok(Math.abs(wf - wfo) < 1e-6, 'a fixed band cannot widen; that is the whole point');
  assert.ok(fi - fo > 0.35, 'coverage it loses on leaving the data: ' + (fi - fo).toFixed(3));

  /* The conformal band is approximately calibrated inside the data - approximately, because
     the model is refit on every row while the band comes from a model fitted on part of
     them, so the two are not perfectly exchangeable. The tolerance is stated rather than
     hidden, and README quotes the measured figure. */
  assert.ok(ci >= 0.95 - 0.03, 'inside the data the band must hold near its nominal 0.95: ' + ci.toFixed(3));
  assert.ok(ci <= 0.95 + 0.04, 'and must not be uselessly wide inside either: ' + ci.toFixed(3));
  // Outside, it must keep far more coverage than the fixed band, and widen to do it.
  assert.ok(co > 0.90, 'outside the data the band must hold up: ' + co.toFixed(3));
  assert.ok(co > fo + 0.3, 'and must beat the fixed band where it matters: ' + fo.toFixed(3) + ' vs ' + co.toFixed(3));
  assert.ok(wo / wi > 2, 'it can only do that by widening: ' + (wo / wi).toFixed(2) + 'x');

  // Asking for more confidence must widen the band, never narrow it.
  assert.ok(avg(insides.map(t => cover(t, 'conf', 0.95).width)) > avg(insides.map(t => cover(t, 'conf', 0.8).width)));
  // And a point sitting on the data is nearer than one well outside it.
  const near = {}, far = {};
  E.profile(uncCorpus(1, 5)).columns.forEach(c => { near[c.name] = c.values[0]; });
  Object.assign(far, near, { x1: 40, x2: 25 });
  assert.ok(F.cal.distance(F.full.enc.encodeValues(far)) > F.cal.distance(F.full.enc.encodeValues(near)),
    'distance must grow as the question leaves the data');

  // Too few rows and no band is offered at all, rather than one built on four residuals.
  assert.strictEqual(UNC.calibrate({ trainX: [[0], [1]], calX: [[0]], calY: [1], calPred: [1] }, {}), null);
});

test('the model score is reported as a range, and small samples widen it', () => {
  const widths = [];
  for (const n of [30, 60, 150, 600]) {
    const F = uncFit(uncCorpus(n, 31), 7);
    const su = UNC.scoreUncertainty(F.data.y, F.best.oof, 'regression', { p: 3, seed: 5 });
    assert.ok(su, 'a score range must be produced at n=' + n);
    // The point estimate must be the score itself, not a resampled average.
    assert.ok(Math.abs(su.metric - E.regressionMetrics(F.data.y, F.best.oof).r2) < 1e-9);
    assert.ok(su.lo < su.metric && su.metric < su.hi, 'the range must bracket the score at n=' + n);
    assert.ok(su.se > 0);
    assert.strictEqual(su.n, n);
    assert.ok(Math.abs(su.rowsPerFeature - n / 3) < 1e-9);
    widths.push({ n, w: su.hi - su.lo });
  }
  /* The point of reporting it. Thirty rows cannot pin a score to three decimals, and the
     range has to shrink as rows arrive or it is not measuring anything. */
  assert.ok(widths[0].w > 0.06, 'at n=30 the score range must be visibly wide: ' + widths[0].w.toFixed(3));
  assert.ok(widths[3].w < widths[0].w / 2, 'and must tighten with rows: ' +
    widths.map(x => x.n + ':' + x.w.toFixed(3)).join(' '));
  for (let i = 1; i < widths.length; i++) {
    assert.ok(widths[i].w <= widths[i - 1].w + 0.02, 'the range must not grow with more rows: ' +
      widths.map(x => x.n + ':' + x.w.toFixed(3)).join(' '));
  }
  // Below the floor it refuses rather than quoting a range off a handful of rows.
  assert.strictEqual(UNC.scoreUncertainty([1, 2, 3], [1, 2, 3], 'regression', {}), null);
});

test('the driver ranking reports whether it is an order or a coin toss', () => {
  const F = uncFit(uncCorpus(300, 11), 7);
  const imp = E.permutationImportance(F.full, F.data, 'regression', 7, { reps: 10 });
  // The spread across shuffles is kept now, not averaged away.
  assert.ok(imp.every(v => isFinite(v.se) && v.se >= 0), 'every driver needs a standard error');
  assert.ok(imp.every(v => v.reps === 10));
  assert.ok(imp.some(v => v.se > 0), 'and at least one must actually vary between shuffles');
  // x1 carries the signal here by construction, so it must lead and lead clearly.
  const rk = UNC.rankReliability(imp);
  assert.strictEqual(rk.top, 'x1');
  assert.strictEqual(rk.topClear, true, 'x1 is the dominant driver and must separate from the second');
  assert.deepStrictEqual(rk.tiedWithTop, []);

  /* Three columns that carry nothing must NOT come back as an order - and the obvious test
     for that does not work, which is the point of this block. Permutation importance is
     read off the rows the model was fitted on, so a model leans on any column it is handed:
     these three pure-noise columns come back at 0.005 to 0.007 with standard errors near
     0.002, "significant" by their own spread and completely meaningless. So the reference
     has to be measured, by shuffling the target and asking the same model again. */
  const r = E.rng(3);
  const noise = { columns: ['a', 'b', 'c', 'y'], rows: E.range(200).map(() => [r().toFixed(4), r().toFixed(4), r().toFixed(4), (r() * 10).toFixed(4)]) };
  const np = E.profile(noise);
  const ncols = ['a', 'b', 'c'].map(nm => np.columns.find(c => c.name === nm));
  const nd = E.supervisedData(np, np.columns.find(c => c.name === 'y'), ncols, 'regression');
  const lin = E.MODELS.find(m => m.id === 'linear');
  const nfull = E.fitFull(lin, nd, 'regression', 7);
  const nimp = E.permutationImportance(nfull, nd, 'regression', 7, { reps: 10 });
  // First, the trap itself, asserted so nobody reinstates the wrong test.
  assert.ok(nimp.every(v => v.importance > 0), 'pure noise still scores positive importance, which is the trap');
  assert.ok(nimp.some(v => v.importance > 1.959964 * v.se),
    'and at least one looks "significant" against its own permutation spread, which is why that test is wrong');

  const floorOf = (data, model, seed) => {
    let w = 0; const S = 2;
    for (let t = 0; t < S; t++) {
      const ys = E.shuffle(data.y.slice(), E.rng(seed + 400 + t));
      const ndata = { rows: data.rows, y: ys, classes: data.classes, featureCols: data.featureCols };
      const nf = E.fitFull(model, ndata, 'regression', seed);
      w += E.permutationImportance(nf, ndata, 'regression', seed, { reps: 4 }).reduce((mx, v) => Math.max(mx, v.importance), 0) / S;
    }
    return w;
  };
  const nFloor = floorOf(nd, lin, 7);
  const nrk = UNC.rankReliability(nimp, { floor: nFloor });
  assert.strictEqual(nrk.topClear, false, 'pure noise must not produce a defensible top driver');
  assert.strictEqual(nrk.topAboveFloor, false, 'and not one of them may clear the shuffled-target floor');
  assert.strictEqual(nrk.belowFloor.length, 3, 'all three must read as carrying no evidence');
  assert.ok(nFloor > nimp[0].importance, 'the floor must sit above every noise importance: ' +
    nFloor.toFixed(5) + ' vs ' + nimp[0].importance.toFixed(5));

  /* And the floor must not swallow a real driver. One genuine input beside one junk column:
     the real one clears the floor by orders of magnitude, the junk one does not. */
  const r2 = E.rng(9);
  const mix = { columns: ['x1', 'junk', 'y'], rows: E.range(200).map(() => { const x = r2() * 10, j = r2(); return [x.toFixed(4), j.toFixed(4), (3 + 1.8 * x + (r2() - 0.5)).toFixed(4)]; }) };
  const mp = E.profile(mix);
  const mcols = ['x1', 'junk'].map(nm => mp.columns.find(c => c.name === nm));
  const md = E.supervisedData(mp, mp.columns.find(c => c.name === 'y'), mcols, 'regression');
  const mfull = E.fitFull(lin, md, 'regression', 7);
  const mimp = E.permutationImportance(mfull, md, 'regression', 7, { reps: 10 });
  const mrk = UNC.rankReliability(mimp, { floor: floorOf(md, lin, 7) });
  assert.strictEqual(mrk.top, 'x1');
  assert.strictEqual(mrk.topAboveFloor, true, 'a real driver must clear the floor');
  assert.deepStrictEqual(mrk.belowFloor, ['junk'], 'and only the junk column must fall below it');

  // What the standard error covers is stated, because presenting it as the whole
  // uncertainty is the flattering reading and the tool must not take it.
  assert.ok(/permutation|shuffl/i.test(rk.seCovers), rk.seCovers);
  assert.ok(/sampl/i.test(rk.seOmits), rk.seOmits);
  assert.strictEqual(UNC.rankReliability([{ name: 'only', importance: 1, se: 0 }]), null);
  // With no floor measured, nothing is claimed about the floor rather than a default assumed.
  const noFloor = UNC.rankReliability(imp);
  assert.strictEqual(noFloor.floor, null);
  assert.strictEqual(noFloor.topAboveFloor, null);
  assert.deepStrictEqual(noFloor.belowFloor, []);
});

test('permutation standard error understates the real spread, by a measured amount', () => {
  /* The caveat the UI prints, measured rather than hand-waved. The permutation standard
     error holds the data and the fit fixed, so it cannot see the variability that comes from
     having sampled these rows rather than others. Refitting on fresh samples measures that
     second source directly, and it is several times larger - which is why the tool labels
     the bars as the most favourable reading rather than the whole story. */
  const perSample = {}, permSE = {};
  for (const s of E.range(12).map(i => 100 + i)) {
    const F = uncFit(uncCorpus(200, s), 7);
    for (const v of E.permutationImportance(F.full, F.data, 'regression', 7, { reps: 8 })) {
      (perSample[v.name] = perSample[v.name] || []).push(v.importance);
      (permSE[v.name] = permSE[v.name] || []).push(v.se);
    }
  }
  const ratios = Object.keys(perSample).map(nm => ({
    name: nm, ratio: E.sd(perSample[nm]) / Math.max(1e-9, E.mean(permSE[nm]))
  }));
  assert.strictEqual(ratios.length, 3);
  // Every driver's across-sample spread must exceed its permutation standard error.
  for (const r2 of ratios) {
    assert.ok(r2.ratio > 1, r2.name + ': across-sample spread must exceed the permutation SE, got ' + r2.ratio.toFixed(2) + 'x');
  }
  const worst = ratios.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  assert.ok(worst.ratio > 2, 'at least one driver must understate badly enough to be worth the warning: ' +
    ratios.map(x => x.name + ' ' + x.ratio.toFixed(2) + 'x').join(', '));
});

const DEPTS = require(path.join(ROOT, 'departments.js'));
const APPS = require(path.join(ROOT, 'applications.js'));

/* A workbench that routes somewhere no longer there is worse than no workbench: it fails
   in front of whoever trusted it. These are referential-integrity checks against the real
   tool selector and the real practice datasets, read out of index.html and samples.js
   rather than restated here, so renaming a tool breaks the build instead of the page. */
test('every department job routes to a tool and a dataset that exist', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  // The tool ids the selector actually offers.
  const sel = html.slice(html.indexOf('<select id="tool">'), html.indexOf('</select>', html.indexOf('<select id="tool">')));
  const tools = Array.from(sel.matchAll(/<option value="([a-z]+)"/g)).map(m => m[1]);
  assert.ok(tools.length >= 8, 'the tool selector should have been found: ' + tools.join(','));
  // And the panels those ids need, since showTool unhides #tab-<id>.
  for (const t of tools) assert.ok(html.indexOf('id="tab-' + t + '"') >= 0, 'no panel for tool ' + t);

  const samples = require(path.join(ROOT, 'samples.js')).map(s => s.id);
  assert.ok(samples.length >= 5);

  assert.ok(DEPTS.length >= 4, 'the four requested departments must be present');
  const ids = DEPTS.map(d => d.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'department ids must be unique');
  // The functions these benches claim to serve must exist in the function list already
  // shipped, so the two structures cannot drift apart.
  const fns = APPS.FUNCTIONS.map(f => f[0]);
  for (const d of DEPTS) {
    if (d.fn) assert.ok(fns.indexOf(d.fn) >= 0, d.id + ' claims function "' + d.fn + '" which is not in FUNCTIONS');
    assert.ok(d.name && d.blurb, d.id + ' needs a name and a blurb');
    assert.ok(d.jobs.length >= 3, d.id + ' needs at least three jobs');
    for (const j of d.jobs) {
      assert.ok(tools.indexOf(j.tool) >= 0, d.id + ': job "' + j.title + '" routes to "' + j.tool + '", which the selector does not offer');
      if (j.sample) assert.ok(samples.indexOf(j.sample) >= 0, d.id + ': job "' + j.title + '" wants sample "' + j.sample + '", which does not exist');
    }
  }
  // Every tool a job routes to must have a short label, or the button reads as a raw id.
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const shortBlock = app.slice(app.indexOf('const TOOLS_SHORT = {'), app.indexOf('};', app.indexOf('const TOOLS_SHORT = {')));
  for (const d of DEPTS) for (const j of d.jobs) {
    assert.ok(shortBlock.indexOf(j.tool + ':') >= 0, 'no short label for tool ' + j.tool);
  }
});

test('every department states what it will not do, and none claims to write documents', () => {
  for (const d of DEPTS) {
    /* The field this file mostly exists for. A job that lists only what you get is an
       advertisement; the refusal is what makes the rest of it trustworthy. */
    assert.ok(d.cannot && d.cannot.length > 40, d.id + ' must say what it cannot do across the department');
    for (const j of d.jobs) {
      assert.ok(j.not && j.not.length > 40, d.id + ': job "' + j.title + '" must carry a substantive "will not"');
      assert.ok(j.data && j.data.length > 20, d.id + ': job "' + j.title + '" must say what data to bring');
      assert.ok(j.out && j.out.length > 20, d.id + ': job "' + j.title + '" must say what comes back');
    }
  }

  /* The two benches whose users want prose must say, in their own text, that they do not
     get prose here. This tool has no language model by deliberate choice, and a regulatory
     writer who discovers that late is then right to distrust everything else. */
  const text = d => [d.blurb, d.honesty || '', d.cannot].concat(d.jobs.map(j => j.title + ' ' + j.data + ' ' + j.out + ' ' + j.not)).join(' ');
  for (const id of ['regwriting', 'bd']) {
    const d = DEPTS.find(x => x.id === id);
    assert.ok(d, id + ' must exist');
    assert.ok(d.honesty && d.honesty.length > 60, id + ' must carry an up-front honesty statement');
    assert.ok(/will not (write|build)|not write|no language model/i.test(d.honesty),
      id + ' must say plainly that it does not author the document: ' + d.honesty);
  }

  /* And nowhere may any bench promise authoring, drafting or slide-making. Checked across
     every field so a later edit cannot slip one in through a job description.

     The intervening-words allowance matters: an earlier version of this guard required the
     noun to sit directly after "your", so "it drafts your technical development report"
     walked straight through it. A guard that cannot fail is not a guard, so the violations
     it has to catch are asserted below alongside the content itself. */
  const FORBIDDEN = /\b(drafts?|writes?|authors?|generates?|assembles?|formats?)\s+(your|the|a|an)\s+((?:\w+[ -]){0,4})(report|protocol|document|deck|slides?|narrative|proposal|summary|section|memo)\b/i;
  const promisesAuthoring = t => {
    const hit = t.match(FORBIDDEN);
    if (!hit) return false;
    const before = t.slice(Math.max(0, hit.index - 45), hit.index);
    // "will not write your document" is a sentence we require, so a negated claim is fine.
    return !/\b(not|never|cannot|without|no)\b[\w\s,'-]{0,45}$/i.test(before);
  };
  // The guard must actually bite. These are the phrasings a later edit would plausibly add.
  for (const bad of [
    'It drafts your technical development report automatically.',
    'This generates the deck for your client meeting.',
    'The tool writes the protocol section for you.',
    'It assembles the filing document for you.',
    'It formats your stability summary to template.'
  ]) assert.strictEqual(promisesAuthoring(bad), true, 'the authoring guard failed to catch: ' + bad);
  // And must not fire on the refusals the benches are required to carry.
  for (const good of [
    'It will not write your document.',
    'This page cannot write the narrative.',
    'It does not write the narrative, format to your template, or cite the guideline text.',
    'No slides, no proposal text, no formatting to your brand.'
  ]) assert.strictEqual(promisesAuthoring(good), false, 'the authoring guard fired on honest text: ' + good);

  for (const d of DEPTS) {
    assert.strictEqual(promisesAuthoring(text(d)), false, d.id + ' appears to promise document authoring');
  }
  // Each of the four requested departments is present, by the job they were asked for.
  const byId = Object.fromEntries(DEPTS.map(d => [d.id, d]));
  assert.ok(byId.upstream.jobs.some(j => j.tool === 'plasmid'), 'upstream must reach the vector sandbox');
  assert.ok(byId.regwriting.jobs.some(j => j.tool === 'stability'), 'regulatory writing must reach shelf life');
  assert.ok(byId.qa.jobs.some(j => j.tool === 'golden'), 'QA must reach batch monitoring for deviations');
  assert.ok(byId.qa.jobs.some(j => j.tool === 'variance'), 'QA must reach Gage R&R: is it the process or the assay');
  assert.ok(byId.bd.jobs.some(j => j.tool === 'limits'), 'business development must reach defensible limits');
});

const XL = require(path.join(ROOT, 'xlsx.js'));
const PG = require(path.join(ROOT, 'program.js'));

test('an Excel workbook is read offline, with gaps and dates handled', async () => {
  const buf = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'workbook.xlsx'));
  const wb = await XL.read(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.deepStrictEqual(wb.sheets.map(s => s.name), ['Runs', 'Factors'],
    'both sheets must come back, named, in workbook order');
  const runs = wb.sheets[0];
  assert.deepStrictEqual(runs.columns, ['Construct_ID', 'Protein_Class', 'Protein_kDa', 'Promoter_Type', 'Titer_gL', 'Run_Date']);
  assert.strictEqual(runs.rows.length, 4);

  /* The failure that would be hardest to notice. Row 5 of the fixture has no promoter, so a
     reader that pushes values in the order it meets them puts the titer in the promoter
     column and every number after it is one place to the left - plausible-looking data,
     completely wrong. Cells are placed by their column letter, so the gap stays a gap. */
  const gapped = runs.rows.find(r => r[0] === 'C-004');
  assert.strictEqual(gapped[3], '', 'the missing promoter must stay missing');
  assert.strictEqual(gapped[4], '3.4', 'and the titer must stay in the titer column');
  assert.strictEqual(gapped[2], '147.2');

  // Dates are numbers with a format in Excel; unconverted they come back as 45730.
  assert.strictEqual(runs.rows[0][5], '2025-03-14');
  assert.strictEqual(runs.rows[1][5], '2025-04-02');
  assert.ok(!/^\d{5}$/.test(runs.rows[0][5]), 'a date must not come back as a serial number');

  /* Excel writes a double's full expansion: this cell holds 99.1 and the XML says
     99.09999999999999. Both are the same double, and the shorter form is the one that
     round-trips, so printing the long one into a run sheet is a presentation defect. */
  assert.strictEqual(runs.rows[1][2], '99.1');
  assert.strictEqual(XL.shortestNumber('99.09999999999999'), '99.1');
  assert.strictEqual(Number(XL.shortestNumber('99.09999999999999')), Number('99.09999999999999'),
    'shortening must never change the value');
  assert.strictEqual(XL.shortestNumber('abc'), 'abc', 'a non-number is left alone');

  // The second sheet is a factor catalogue, which the programme flow reads directly.
  assert.deepStrictEqual(wb.sheets[1].rows, [['Promoter_Type', 'CMV; EF1a; CAG']]);

  // And something that is not a workbook fails with a sentence a user can act on.
  await assert.rejects(() => XL.read(new TextEncoder().encode('Construct_ID,Titer\nC-1,5').buffer),
    /does not look like an .xlsx/);
});

test('Excel date serials, including the day that never existed', () => {
  /* Excel's calendar contains 1900-02-29, kept for bug-compatibility with Lotus 1-2-3.
     That day did not happen, so serials at or below 60 sit on a different epoch from
     everything above them, and a reader implementing one branch is wrong for exactly the
     dates nobody checks. */
  assert.strictEqual(XL.serialToDate(59), '1900-02-28');
  assert.strictEqual(XL.serialToDate(61), '1900-03-01');
  /* Serial 60 is Excel's phantom 1900-02-29. This returns 1900-03-01 rather than inventing
     a date that does not exist - a deliberate choice, asserted so it cannot drift. */
  assert.strictEqual(XL.serialToDate(60), '1900-03-01');
  // A modern date, and the time fraction when there is one.
  assert.strictEqual(XL.serialToDate(45730), '2025-03-14');
  assert.strictEqual(XL.serialToDate(45730.5).slice(0, 13), '2025-03-14 12');
  // Monotonic, which a reader that mixes up its epochs is not.
  for (let s = 1; s < 500; s++) assert.ok(XL.serialToDate(s) <= XL.serialToDate(s + 1), 'not monotonic at ' + s);

  // Column letters to indices, including past Z where an off-by-one hides.
  assert.strictEqual(XL.colOf('A1'), 0);
  assert.strictEqual(XL.colOf('Z9'), 25);
  assert.strictEqual(XL.colOf('AA1'), 26);
  assert.strictEqual(XL.colOf('AB12'), 27);
  assert.strictEqual(XL.colOf('BA1'), 52);

  // A shared string split into runs must be joined, not truncated at the first piece.
  assert.deepStrictEqual(XL.sharedStrings('<sst><si><t>plain</t></si><si><r><t>Anti-</t></r><r><t>CD20</t></r></si></sst>'),
    ['plain', 'Anti-CD20']);
  // Entities decoded, so a factor called "A &amp; B" does not arrive with the markup in it.
  assert.deepStrictEqual(XL.sharedStrings('<sst><si><t>A &amp; B &#65;</t></si></sst>'), ['A & B A']);

  // Which styles count as dates: the built-in ids, plus a custom code with y/m/d in it.
  const xfs = XL.dateStyles('<styleSheet><numFmts><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/>' +
    '<numFmt numFmtId="165" formatCode="0.00&quot;kg&quot;"/></numFmts>' +
    '<cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>');
  assert.deepStrictEqual(xfs, [false, true, true, false],
    'general and a units format are not dates; built-in 14 and a custom y-m-d code are');
});

test('the factor catalogue is read in both the shapes people actually have', () => {
  // Levels in one cell, separated however the author felt like separating them.
  const a = PG.parseCatalogue({
    columns: ['Factor', 'Levels', 'Min', 'Max', 'Step'],
    rows: [['Promoter_Type', 'CMV; EF1a | SV40, CAG', '', '', ''],
      ['Plasmid_Size_kb', '', '6', '11', '2.5'],
      ['Host', 'CHO-K1', '', '', ''],
      ['Nonsense', '', '', '', '']]
  });
  const byName = Object.fromEntries(a.factors.map(f => [f.name, f]));
  assert.deepStrictEqual(byName.Promoter_Type.levels, ['CMV', 'EF1a', 'SV40', 'CAG']);
  assert.strictEqual(byName.Promoter_Type.kind, 'categorical');
  assert.strictEqual(byName.Plasmid_Size_kb.kind, 'numeric');
  assert.strictEqual(byName.Plasmid_Size_kb.step, 2.5);
  // One level is not a choice, so it is held fixed and said so rather than offered.
  assert.strictEqual(byName.Host.kind, 'fixed');
  assert.ok(a.problems.some(x => /Host/.test(x) && /one level/.test(x)));
  // And a row with neither levels nor a range is skipped with a reason, not silently.
  assert.ok(!byName.Nonsense, 'an unusable factor must not become a factor');
  assert.ok(a.problems.some(x => /Nonsense/.test(x)));

  // One row per factor-level pair, which is how a database export arrives.
  const b = PG.parseCatalogue({
    columns: ['Factor', 'Level'],
    rows: [['Promoter_Type', 'CMV'], ['Promoter_Type', 'EF1a'], ['Selection_Marker', 'GS'], ['Selection_Marker', 'DHFR']]
  });
  assert.strictEqual(b.factors.length, 2);
  assert.deepStrictEqual(b.factors.find(f => f.name === 'Promoter_Type').levels, ['CMV', 'EF1a']);

  // No Factor column at all is an error with a sentence that says what was expected.
  const c = PG.parseCatalogue({ columns: ['Thing', 'Other'], rows: [['a', 'b']] });
  assert.strictEqual(c.factors.length, 0);
  assert.ok(/Factor/.test(c.problems[0]), c.problems[0]);
});

test('the programme sheet keeps protein attributes and drops vector choices', () => {
  const res = PG.parseProgram({
    columns: ['Program_ID', 'Protein_Class', 'Protein_kDa', 'Promoter_Type', 'Notes'],
    rows: [['PRG-1', 'bispecific', '101', 'CMV', 'rush'], ['PRG-2', 'enzyme', '63', 'EF1a', '']]
  }, ['Promoter_Type', 'Selection_Marker']);
  assert.deepStrictEqual(res.programs.map(p => p.id), ['PRG-1', 'PRG-2']);
  /* A vector column in the programme sheet is the one thing that would quietly defeat the
     point of the tool: it would predict for the promoter somebody already guessed instead
     of choosing one. Dropped, and named as dropped. */
  assert.deepStrictEqual(res.ignored, ['Promoter_Type']);
  assert.ok(!('Promoter_Type' in res.programs[0].attributes));
  assert.strictEqual(res.programs[0].attributes.Protein_Class, 'bispecific');
  /* Record-keeping columns are not protein attributes either, and this is not cosmetic. The
     history has no Notes column, so keeping it would make the attribute read as "not in the
     historical runs at all" and flip a well-supported programme to untested - a scheduling
     note quietly discrediting the prediction. */
  assert.ok(!('Notes' in res.programs[0].attributes), 'a notes column is not an attribute');
  assert.deepStrictEqual(res.skipped, ['Notes'], 'and it is reported as skipped rather than vanishing');
  const noisy = PG.parseProgram({
    columns: ['Program_ID', 'Protein_Class', 'Owner', 'Target_Date', 'Priority', 'Client'],
    rows: [['PRG-1', 'mAb', 'VK', '2026-01-04', 'high', 'Acme']]
  }, []);
  assert.deepStrictEqual(Object.keys(noisy.programs[0].attributes), ['Protein_Class'],
    'only the protein attribute survives: ' + JSON.stringify(noisy.programs[0].attributes));
  // With no id column, programmes are still distinguishable.
  const noId = PG.parseProgram({ columns: ['Protein_Class'], rows: [['mAb'], ['enzyme']] }, []);
  assert.strictEqual(new Set(noId.programs.map(p => p.id)).size, 2);
});

test('every buildable vector is enumerated, and a big catalogue is sampled not truncated', () => {
  const factors = [
    { name: 'Promoter_Type', kind: 'categorical', levels: ['CMV', 'EF1a', 'SV40', 'CAG'] },
    { name: 'Selection_Marker', kind: 'categorical', levels: ['GS', 'DHFR', 'Puromycin'] },
    { name: 'Plasmid_Size_kb', kind: 'numeric', min: 6, max: 11, step: 2.5 },
    { name: 'Host', kind: 'fixed', levels: ['CHO-K1'] }
  ];
  const all = PG.candidates(factors, {});
  assert.strictEqual(all.total, 4 * 3 * 3, 'three steps of 2.5 across 6 to 11 is three settings');
  assert.strictEqual(all.list.length, 36);
  assert.strictEqual(all.sampled, false);
  // Every combination exactly once.
  const sigs = all.list.map(c => [c.Promoter_Type, c.Selection_Marker, c.Plasmid_Size_kb].join('|'));
  assert.strictEqual(new Set(sigs).size, 36, 'no combination may repeat or be missed');
  // A fixed factor rides along on every candidate rather than becoming a choice.
  assert.ok(all.list.every(c => c.Host === 'CHO-K1'));
  assert.ok(all.axes.every(a => a.name !== 'Host'), 'a fixed factor is not an axis');
  // Without a step, a numeric factor contributes low, middle and high - no more.
  const noStep = PG.candidates([{ name: 'kb', kind: 'numeric', min: 6, max: 12 }], {});
  assert.deepStrictEqual(noStep.axes[0].values, [6, 9, 12]);

  /* Over the cap it samples. Truncating would hand back the alphabetically first corner of
     the catalogue, so the sheet would never see half the levels that exist. */
  const big = [0, 1, 2, 3, 4, 5].map(i => ({ name: 'F' + i, kind: 'categorical', levels: ['a', 'b', 'c', 'd'] }));
  const capped = PG.candidates(big, { cap: 60, seed: 5 });
  assert.strictEqual(capped.total, Math.pow(4, 6));
  assert.strictEqual(capped.list.length, 60);
  assert.strictEqual(capped.sampled, true);
  assert.strictEqual(new Set(capped.list.map(c => big.map(f => c[f.name]).join('|'))).size, 60, 'samples must be distinct');
  for (const f of big) {
    assert.strictEqual(new Set(capped.list.map(c => c[f.name])).size, 4,
      'the sample must still reach every level of ' + f.name + ', which truncation would not');
  }
});

test('the run sheet is balanced across levels, not just the top predictions', () => {
  const axes = [{ name: 'P', values: ['a', 'b', 'c', 'd'] }, { name: 'M', values: ['x', 'y'] }];
  // Scored best-first, with one level deliberately carrying all the best predictions.
  const scored = [];
  let v = 100;
  for (const pv of ['a', 'b', 'c', 'd']) for (const mv of ['x', 'y']) scored.push({ config: { P: pv, M: mv }, value: (pv === 'a' ? 1000 : 1) + (v--) });
  scored.sort((a, b) => b.value - a.value);

  const r8 = PG.runSheet(scored, axes, { runs: 8, seed: 3 });
  assert.strictEqual(r8.sheet.length, 8);
  /* The point of balancing. Taking the eight highest predictions would have run level "a"
     repeatedly and barely touched the others, and a sheet like that cannot say anything
     about the levels it skipped however good its numbers look. */
  assert.strictEqual(r8.balance.P.spread, 0, 'four levels over eight runs must come out even: ' + JSON.stringify(r8.balance.P.counts));
  assert.strictEqual(r8.balance.M.spread, 0);
  assert.deepStrictEqual(r8.balance.P.counts, [2, 2, 2, 2]);

  // Where the runs do not divide evenly, the gap must be at most one run.
  const r6 = PG.runSheet(scored, axes, { runs: 6, seed: 3 });
  assert.ok(r6.balance.P.spread <= 1, 'six runs over four levels: ' + JSON.stringify(r6.balance.P.counts));

  // Run order is a randomised permutation, and every std order appears exactly once.
  assert.deepStrictEqual(r8.sheet.map(s => s.run).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepStrictEqual(r8.sheet.map(s => s.std).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);

  // An empty input must not report itself as perfectly balanced.
  assert.strictEqual(PG.runSheet([], axes, { runs: 8 }).balance, null);
});

/* A screening corpus across several protein classes, where protein complexity genuinely
   interacts with promoter strength - so a cross-protein question has a real answer to find,
   and a one-protein corpus can be shown to have none. */
function vectorCorpus(n, seed, opt) {
  opt = opt || {};
  const CL = { 'mAb': [148, 1.0], 'Fc-fusion': [106, 0.8], 'bispecific': [99, 0.62], 'enzyme': [62, 0.9] };
  const names = opt.oneProtein ? ['mAb'] : Object.keys(CL);
  const prom = ['CMV', 'EF1a', 'SV40', 'CAG'], mark = ['GS', 'DHFR', 'Puromycin'];
  const r = E.rng(seed), rows = [];
  const nz = () => { const u = Math.max(1e-9, r()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
  for (let i = 0; i < n; i++) {
    const cl = names[Math.floor(r() * names.length)], kda = CL[cl][0], comp = CL[cl][1];
    const pr = prom[Math.floor(r() * prom.length)], mk = mark[Math.floor(r() * mark.length)];
    const kb = 5 + r() * 7;
    const titer = 0.8 + 4.2 * PL.PROMOTERS[pr].strength * comp + 1.1 * PL.MARKERS[mk].stringency - 0.09 * kb + nz() * (0.12 + 0.04 * (kb - 5));
    rows.push(['C-' + i, cl, kda, pr, mk, kb.toFixed(2), Math.max(0.05, titer).toFixed(3)]);
  }
  return { columns: ['Construct_ID', 'Protein_Class', 'Protein_kDa', 'Promoter_Type', 'Selection_Marker', 'Plasmid_Size_kb', 'Titer_gL'], rows };
}
const VEC_FACTORS = [
  { name: 'Promoter_Type', kind: 'categorical', levels: ['CMV', 'EF1a', 'SV40', 'CAG'] },
  { name: 'Selection_Marker', kind: 'categorical', levels: ['GS', 'DHFR', 'Puromycin'] },
  { name: 'Plasmid_Size_kb', kind: 'numeric', min: 6, max: 11, step: 2.5 }
];

test('a history of one protein cannot speak for another, and says so', () => {
  /* The most damaging thing this tool could do is answer this question confidently. A model
     fitted where every run is a monoclonal antibody holds no information about how a
     bispecific responds to a promoter choice - but the arithmetic does not complain, and the
     conformal interval stays narrow, because nothing in the residuals knows the question
     changed. So it is measured before anything is predicted. */
  const one = E.profile(vectorCorpus(240, 11, { oneProtein: true }));
  const programs = [{ id: 'PRG-1', attributes: { Protein_Class: 'bispecific', Protein_kDa: '101' } }];
  const t1 = PG.transferability(one, ['Protein_Class', 'Protein_kDa'], programs);
  assert.strictEqual(t1.canTransfer, false, 'one protein must not support a cross-protein claim');
  assert.strictEqual(t1.nProteins, 1, 'one protein must count as one, not zero');
  assert.deepStrictEqual(t1.constant.slice().sort(), ['Protein_Class', 'Protein_kDa'],
    'and the frozen attributes must be named, since those are what the user has to fix');
  assert.deepStrictEqual(t1.varying, []);
  assert.ok(/same protein/i.test(t1.why), t1.why);
  // Per programme: an attribute held constant in history is untested, not merely thin.
  assert.strictEqual(t1.perProgram[0].standing, 'untested');
  assert.deepStrictEqual(t1.perProgram[0].noEvidence.map(x => x.field).sort(), ['Protein_Class', 'Protein_kDa']);

  // With several proteins the same question is answerable, and says that instead.
  const many = E.profile(vectorCorpus(240, 11));
  const t2 = PG.transferability(many, ['Protein_Class', 'Protein_kDa'], programs);
  assert.strictEqual(t2.canTransfer, true);
  assert.strictEqual(t2.nProteins, 4);
  assert.deepStrictEqual(t2.varying.slice().sort(), ['Protein_Class', 'Protein_kDa']);
  assert.strictEqual(t2.perProgram[0].standing, 'supported');
  assert.strictEqual(t2.perProgram[0].noEvidence.length, 0);

  /* Two proteins is thin rather than supported: a protein effect fitted on two molecules is
     a line through two points, and calling that "supported" would be the flattering read. */
  const twoRows = vectorCorpus(240, 11).rows.filter(r => r[1] === 'mAb' || r[1] === 'enzyme');
  const two = E.profile({ columns: vectorCorpus(1, 1).columns, rows: twoRows });
  /* Asked about a protein the two-molecule history DOES contain. Asked about one it does
     not, the honest answer is "untested" rather than "thin", which is what it gives - so
     the thin state has to be probed with a protein that is actually in there. */
  const t3 = PG.transferability(two, ['Protein_Class', 'Protein_kDa'],
    [{ id: 'PRG-mAb', attributes: { Protein_Class: 'mAb', Protein_kDa: '148' } }]);
  assert.strictEqual(t3.nProteins, 2);
  assert.strictEqual(t3.canTransfer, true);
  assert.strictEqual(t3.perProgram[0].standing, 'thin', 'two molecules is thin evidence, not support');
  assert.ok(/two points/i.test(t3.why), t3.why);
  // And a protein outside those two is untested even though the history has two molecules.
  assert.strictEqual(PG.transferability(two, ['Protein_Class', 'Protein_kDa'], programs).perProgram[0].standing,
    'untested', 'a molecule absent from a two-molecule history is untested, not thin');

  // A class never run before, and a weight outside the historical range, are each named.
  const t4 = PG.transferability(many, ['Protein_Class', 'Protein_kDa'], [
    { id: 'novel-class', attributes: { Protein_Class: 'nanobody', Protein_kDa: '14' } },
    { id: 'in-range', attributes: { Protein_Class: 'mAb', Protein_kDa: '148' } }
  ]);
  const novel = t4.perProgram.find(x => x.id === 'novel-class');
  assert.strictEqual(novel.standing, 'untested');
  assert.deepStrictEqual(novel.unseen.map(u => u.field).sort(), ['Protein_Class', 'Protein_kDa']);
  assert.strictEqual(t4.perProgram.find(x => x.id === 'in-range').standing, 'supported');
});

test('the plan refuses a protein it cannot place, and offers a floor as well as a best bet', () => {
  const prof = E.profile(vectorCorpus(240, 11));
  const programs = [
    { id: 'PRG-ok', attributes: { Protein_Class: 'bispecific', Protein_kDa: '101' } },
    { id: 'PRG-novel', attributes: { Protein_Class: 'nanobody', Protein_kDa: '14' } }
  ];
  const plan = PG.plan({ profile: prof, factors: VEC_FACTORS, programs, targets: ['Titer_gL'] },
    { seed: 42, runs: 12, confidence: 0.9 });

  assert.strictEqual(plan.candidateCount, 36, 'the whole catalogue is buildable here');
  assert.deepStrictEqual(plan.proteinCols.slice().sort(), ['Protein_Class', 'Protein_kDa']);
  assert.strictEqual(plan.transfer.canTransfer, true);

  const ok = plan.perProgram.find(p => p.id === 'PRG-ok');
  assert.strictEqual(ok.standing, 'supported');
  assert.strictEqual(ok.candidates, 36);
  assert.strictEqual(ok.sheet.length, 12, 'the sheet is the length that was asked for');
  assert.ok(ok.bestPredicted && ok.safestChoice);
  // The floor is never above the central estimate, and the band brackets it.
  assert.ok(ok.bestPredicted.low < ok.bestPredicted.value && ok.bestPredicted.value < ok.bestPredicted.high);
  assert.ok(ok.safestChoice.low >= ok.bestPredicted.low - 1e-9,
    'the safest choice must have the best floor of any candidate');
  assert.ok(ok.bestPredicted.value >= ok.safestChoice.value - 1e-9,
    'and the best bet must have the best central estimate');
  // The corpus was built so a strong promoter wins; the recommendation must reflect that.
  assert.ok(['CMV', 'CAG'].indexOf(ok.bestPredicted.config.Promoter_Type) >= 0,
    'a strong promoter should win here, got ' + ok.bestPredicted.config.Promoter_Type);
  /* The sheet defaults to selection: spend the wells on the best-predicted few, repeated.
     Measured over 4,000 simulated 48-well sheets drawn from 36 candidates, running every
     vector once identifies the true best in 33-36% of sheets while concentrating on the
     predicted leaders reaches 56-61%, because a single observation of a vector is mostly
     noise and a sheet of singles ends up ranking noise. */
  assert.strictEqual(ok.purpose, 'select', 'picking a vector is what this tool is for');
  assert.ok(ok.replicates >= 2, 'selection means repeats, got ' + ok.replicates);
  assert.strictEqual(ok.distinct * ok.replicates <= ok.sheet.length, true);
  assert.ok(ok.replicated > 0, 'and the repeats must actually be on the sheet');
  const copies = {};
  ok.sheet.forEach(x => { copies[x.replicate] = (copies[x.replicate] || 0) + 1; });
  assert.ok(Object.keys(copies).length >= 2, 'more than one copy of something: ' + JSON.stringify(copies));

  /* The cost of that, stated rather than hidden: concentrating on the leaders gives up the
     level balance that lets a sheet estimate factor effects. A sheet of the top few may run
     one promoter every time and say nothing about the others. */
  const spreads = Object.keys(ok.balance).map(k => ok.balance[k].spread);
  assert.ok(Math.max.apply(null, spreads) > 1, 'a selection sheet is deliberately unbalanced');

  /* Screening mode is the other half of that trade and must still be balanced, because
     that is the mode for the question "what drives titer" rather than "which do we build". */
  const screen = PG.plan({ profile: prof, factors: VEC_FACTORS, programs, targets: ['Titer_gL'] },
    { seed: 42, runs: 12, confidence: 0.9, purpose: 'screen' });
  const sc = screen.perProgram.find(p => p.id === 'PRG-ok');
  assert.strictEqual(sc.purpose, 'screen');
  assert.strictEqual(sc.replicated, 0, 'twelve wells over thirty-six vectors needs no repeats');
  Object.keys(sc.balance).forEach(k => assert.ok(sc.balance[k].spread <= 1,
    k + ' is unbalanced on the screening sheet: ' + JSON.stringify(sc.balance[k].counts)));

  /* How far to concentrate is read off the cross-validated R2 of the model doing the
     ranking, not guessed: a model that cannot predict spreads wider because its order
     deserves less weight. */
  assert.strictEqual(PG.replicatesFor(0.05), 3);
  assert.strictEqual(PG.replicatesFor(0.4), 4);
  assert.strictEqual(PG.replicatesFor(0.9), 6);
  assert.strictEqual(PG.replicatesFor(null), 3, 'no score at all must not mean maximum confidence');

  /* The refusal. A protein class nothing in the history contains cannot be mapped to the
     nearest molecule and scored - that is precisely the move that would produce a confident
     number with no evidence under it. */
  const novel = plan.perProgram.find(p => p.id === 'PRG-novel');
  assert.strictEqual(novel.standing, 'untested');
  assert.strictEqual(novel.candidates, 0, 'nothing may be scored for an unplaceable protein');
  assert.strictEqual(novel.bestPredicted, null);
  assert.strictEqual(novel.balance, null, 'and an empty sheet must not report itself as balanced');
  assert.ok(novel.unseen.length >= 1);

  // A factor the history never recorded is reported rather than chosen blind.
  const extra = PG.plan({
    profile: prof,
    factors: VEC_FACTORS.concat([{ name: 'Terminator', kind: 'categorical', levels: ['BGH', 'SV40pA'] }]),
    programs: [programs[0]], targets: ['Titer_gL']
  }, { seed: 42, runs: 8 });
  assert.deepStrictEqual(extra.missing, ['Terminator'],
    'a catalogue factor absent from the history must be named, not silently picked');
});

test('typed-in, pasted and uploaded data take the same path to the same answer', () => {
  /* Three ways into each step, one parse path. If a pasted block and a typed-in form went
     through different code, they would drift, and the symptom would be a catalogue that
     behaves differently depending on how it arrived - which is close to impossible to
     diagnose from the outside. So both are turned into the table a file produces and handed
     to the same function, and that equivalence is asserted here rather than assumed. */
  const text = 'Factor,Levels,Min,Max,Step\nPromoter_Type,CMV; EF1a; CAG,,,\nPlasmid_Size_kb,,6,11,2.5\n';
  const fromPaste = PG.parseCatalogue(E.parseCSV(text));
  // What the hand-entry form builds: the same columns, values as typed.
  const fromForm = PG.parseCatalogue({
    columns: ['Factor', 'Levels', 'Min', 'Max', 'Step'],
    rows: [['Promoter_Type', 'CMV; EF1a; CAG', '', '', ''], ['Plasmid_Size_kb', '', '6', '11', '2.5']]
  });
  assert.deepStrictEqual(fromForm.factors, fromPaste.factors,
    'a typed catalogue and a pasted one must parse identically');

  // Tab separated, which is what a spreadsheet copy actually puts on the clipboard.
  const tabbed = 'Factor\tLevels\tMin\tMax\tStep\nPromoter_Type\tCMV; EF1a; CAG\t\t\t\nPlasmid_Size_kb\t\t6\t11\t2.5\n';
  assert.deepStrictEqual(PG.parseCatalogue(E.parseCSV(tabbed)).factors, fromPaste.factors,
    'pasting out of a spreadsheet must work as well as pasting a CSV');

  // Same for the programme sheet.
  const pText = 'Program_ID,Protein_Class,Protein_kDa\nPRG-1,bispecific,101\nPRG-2,enzyme,63\n';
  const pPaste = PG.parseProgram(E.parseCSV(pText), ['Promoter_Type']);
  const pForm = PG.parseProgram({
    columns: ['Program_ID', 'Protein_Class', 'Protein_kDa'],
    rows: [['PRG-1', 'bispecific', '101'], ['PRG-2', 'enzyme', '63']]
  }, ['Promoter_Type']);
  assert.deepStrictEqual(pForm.programs, pPaste.programs);
});

test('the hand-entry form is offered the attributes and levels the history really has', () => {
  const table = {
    columns: ['Construct_ID', 'Protein_Class', 'Protein_kDa', 'Promoter_Type', 'Owner', 'Titer_gL'],
    rows: [['C1', 'mAb', '148', 'CMV', 'VK', '5.1'], ['C2', 'enzyme', '62', 'EF1a', 'PS', '3.2'],
      ['C3', 'mAb', '148', 'CAG', 'VK', '4.4'], ['C4', 'mAb', '148', 'CMV', 'VK', '5.0']]
  };
  const prof = E.profile(table);

  /* The form must ask for exactly the protein attributes, which means the chosen factors,
     the outcome and the record-keeping columns all have to be out. One implementation of
     this, shared with the planner: two would drift, and the symptom would be a form
     offering a field the planner ignores, or omitting one it needs. */
  assert.deepStrictEqual(PG.proteinColumns(prof, ['Promoter_Type'], ['Titer_gL']),
    ['Protein_Class', 'Protein_kDa'], 'Owner is record-keeping and Titer_gL is the outcome');
  // With no catalogue yet, the candidate factors are still offered - that is step 2's job.
  assert.ok(PG.proteinColumns(prof, [], ['Titer_gL']).indexOf('Promoter_Type') >= 0);

  /* Offering the real levels is what stops a typo presenting as a scientific limitation: a
     mistyped class reads downstream as "a value the historical runs do not contain" and
     correctly marks the programme untested, which is a maddening way to discover a spelling
     mistake. Commonest first, so the usual answer is the default. */
  const cls = PG.attributeChoices(prof, 'Protein_Class');
  assert.strictEqual(cls.kind, 'categorical');
  assert.deepStrictEqual(cls.levels, ['mAb', 'enzyme'], 'commonest level first');

  const kda = PG.attributeChoices(prof, 'Protein_kDa');
  assert.strictEqual(kda.kind, 'numeric');
  assert.strictEqual(kda.min, 62);
  assert.strictEqual(kda.max, 148);
  assert.ok(kda.median >= 62 && kda.median <= 148);

  assert.strictEqual(PG.attributeChoices(prof, 'NoSuchColumn'), null);

  /* And the escape hatch has to keep working: a value deliberately outside the offered
     levels must still reach the planner and be reported as unseen, not silently coerced to
     the nearest option, which would be the whole failure this tool exists to avoid. */
  const t = PG.transferability(prof, ['Protein_Class', 'Protein_kDa'],
    [{ id: 'typed', attributes: { Protein_Class: 'nanobody', Protein_kDa: '14' } }]);
  assert.strictEqual(t.perProgram[0].standing, 'untested');
  assert.deepStrictEqual(t.perProgram[0].unseen.map(u => u.field).sort(), ['Protein_Class', 'Protein_kDa']);
});

test('the tool page carries the tool and nothing else', () => {
  /* The page drifted once and would drift again. Every time something useful was added -
     the plain-English front door, the department workbenches, the applications panel, nine
     practice datasets - it went in above the tool, and the thing people came for ended up
     below three screens of material they had already read. This asserts the split so the
     next addition has to choose a side on purpose. */
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const page = id => {
    const start = html.indexOf('<div class="page" id="' + id + '"');
    assert.ok(start >= 0, 'no page called ' + id);
    // Pages are siblings in <main>, so the next page marker (or </main>) ends this one.
    const nextPage = html.indexOf('<div class="page" id="', start + 10);
    const end = nextPage >= 0 ? nextPage : html.indexOf('</main>', start);
    return html.slice(start, end);
  };
  const tools = page('page-tools'), how = page('page-how'), apps = page('page-apps'), data = page('page-data');

  /* Three pages, and each block has exactly one home. Choosing a technique lives with the
     guidance, the datasets get a page of their own, and the tool page keeps neither. */
  /* One panel now carries both the jobs and the reference material: choosing your group
     twice, in two selects, to read two halves of the same answer was the thing to fix. */
  const home = { ask: apps, 'tool-apps': apps, samples: data, 'loop-steps': how, 'exit-gates': how };
  for (const id of Object.keys(home)) {
    assert.ok(home[id].indexOf('id="' + id + '"') >= 0, id + ' is not on the page it belongs to');
    assert.ok(tools.indexOf('id="' + id + '"') < 0, id + ' must NOT be on the tool page');
    // And on exactly one page, or it renders twice and the ids collide.
    const where = [tools, how, apps, data].filter(pg => pg.indexOf('id="' + id + '"') >= 0);
    assert.strictEqual(where.length, 1, id + ' appears on ' + where.length + ' pages');
  }
  // And the tool page keeps the selector and every tool panel.
  assert.ok(tools.indexOf('<select id="tool">') >= 0, 'the technique selector stays with the tools');
  const sel = html.slice(html.indexOf('<select id="tool">'), html.indexOf('</select>', html.indexOf('<select id="tool">')));
  const toolIds = Array.from(sel.matchAll(/<option value="([a-z]+)"/g)).map(m => m[1]);
  assert.ok(toolIds.length >= 8);
  for (const t of toolIds) {
    assert.ok(tools.indexOf('id="tab-' + t + '"') >= 0, 'tool panel tab-' + t + ' must be on the tool page');
  }
  // Nothing may be left outside both pages, or it renders on neither.
  const main = html.slice(html.indexOf('<main id="main">'), html.indexOf('</main>'));
  const strays = main.replace(tools, '').replace(apps, '').replace(data, '');
  assert.ok(!/<section class="wrap step"/.test(strays), 'a step section is outside both pages');
  assert.ok(!/<div class="tabpanel"/.test(strays), 'a tool panel is outside both pages');

  // The page switch itself, and the controls the script wires to it.
  for (const id of ['page-btn-tools', 'page-btn-apps', 'page-btn-data']) {
    assert.ok(html.indexOf('id="' + id + '"') >= 0, 'missing page tab ' + id);
  }
  // Every page declared in the script must exist in the markup, with a tab to reach it.
  const app0 = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const pagesDecl = app0.slice(app0.indexOf('const PAGES = ['), app0.indexOf('];', app0.indexOf('const PAGES = [')));
  const ids = Array.from(pagesDecl.matchAll(/id:\s*'(\w+)'/g)).map(m => m[1]);
  assert.deepStrictEqual(ids.sort(), ['apps', 'data', 'how', 'tools']);
  for (const id of ids) {
    assert.ok(html.indexOf('id="page-' + id + '"') >= 0, 'no markup for page ' + id);
    assert.ok(html.indexOf('id="page-btn-' + id + '"') >= 0, 'no tab for page ' + id);
  }
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  /* Asking for a tool has to land you on the tool page regardless of where the request came
     from - the advisor routes by hash, the department buttons call showTool directly, the
     privacy lock is a data-tab-link. One line in showTool covers all of them, and this is
     the assertion that it is still there. */
  const showTool = app.slice(app.indexOf('function showTool('), app.indexOf('function initTools('));
  assert.ok(/showPage\('tools'/.test(showTool), 'showTool must switch to the tool page');

  /* Moving the datasets off the tool page left somebody arriving with nothing to load and
     no visible way to reach them - a dead end created by a tidy-up. The invitation beside
     the drop zone is that route, and it fills the 360px the datasets used to occupy, so it
     earns its place twice. */
  assert.ok(tools.indexOf('id="start-card"') >= 0, 'the tool page needs a route to the practice data');
  assert.ok(/\$\('go-practice'\)[\s\S]{0,120}showPage\('data'/.test(app), 'and that route must actually open the data tab');
  assert.ok(/\$\('go-start'\)[\s\S]{0,120}showPage\('apps'/.test(app), 'with one to the guidance tab too');
  // It is an invitation, so it goes once taken, rather than sitting beside loaded data.
  assert.ok(/start-card'\)\.hidden = !!state\.table/.test(app), 'the invitation must clear once data is loaded');
});

test('the data is shown as a table before the model runs', () => {
  /* A column profile answers "what did it make of my columns". It does not answer "did my
     file load correctly", which is the question somebody actually has at the moment they
     press the button - a row shifted by a stray comma, a header read as data, a date column
     that arrived as numbers are all obvious in a table of rows and invisible in a summary. */
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');

  // It sits in step 2, which runs after loading and before the run button.
  const setup = html.slice(html.indexOf('id="setup"'), html.indexOf('id="results"'));
  assert.ok(setup.indexOf('id="data-preview"') >= 0, 'the preview belongs in the step between loading and running');
  assert.ok(setup.indexOf('id="data-preview"') < setup.indexOf('id="profile"'),
    'the data itself comes before the agent\\u2019s reading of the columns');
  assert.ok(html.indexOf('id="data-preview"') < html.indexOf('id="run"'),
    'and before the button that runs the model');

  // Rendered on every path that changes the table: load, join, and undoing a join all go
  // through renderSetup, so one call there covers them.
  const renderSetup = app.slice(app.indexOf('function renderSetup()'), app.indexOf('function renderProfile()'));
  assert.ok(/renderPreview\(\)/.test(renderSetup), 'renderSetup must draw the preview');
  assert.ok(/state\.table = r\.table/.test(app) && /renderSetup\(\)/.test(app), 'the join path refreshes through renderSetup');

  /* Capped, because this renders synchronously on the load path and the tool takes files of
     tens of thousands of rows. A 40,000-row table would freeze the tab for rows nobody
     scrolls to. */
  const m = app.match(/const PREVIEW_ROWS = (\d+);/);
  assert.ok(m, 'the row cap must be a named constant, not buried in a loop');
  const cap = Number(m[1]);
  assert.ok(cap >= 20 && cap <= 500, 'the cap should be a readable preview, got ' + cap);
  const render = app.slice(app.indexOf('function renderPreview()'), app.indexOf('function renderProfile()'));
  assert.ok(/Math\.min\(PREVIEW_ROWS/.test(render), 'the cap has to actually bound the loop');
  // A file shorter than the cap must not claim to be truncated.
  assert.ok(/t\.rows\.length > shown/.test(render), 'a short file must not say "the first 100 rows"');
  // The counts quoted in the footer are the whole file, not the preview.
  assert.ok(/t\.rows\.length\.toLocaleString\(\)/.test(render), 'the footer counts every row, not the shown ones');

  /* The header style must not restyle the column names. The table's own th rule upper-cases,
     and a column called Day3_VCD_e6 shown as DAY3_VCD_E6 is not the column in the file -
     which defeats the one job this panel has. */
  assert.ok(/th\s*\{[^}]*text-transform:\s*uppercase/.test(css), 'the base table header does upper-case, so the reset below is load-bearing');
  const previewTh = css.slice(css.indexOf('.preview-table thead th'), css.indexOf('}', css.indexOf('.preview-table thead th')) + 1);
  assert.ok(/text-transform:\s*none/.test(previewTh), 'the preview must show column names exactly as the file has them');

  // An empty cell is worth seeing as empty rather than as nothing at all.
  assert.ok(/cell-empty/.test(render) && /cell-empty/.test(css), 'blank cells are marked rather than rendered as nothing');
  // And clearing the data clears the preview with it, or deleted data stays on screen.
  assert.ok(/data-preview'\)\.innerHTML = ''/.test(app), 'deleting the data must remove the preview');
});

test('capability withholds the tail figures when the data is not bell-shaped', () => {
  /* Cp and Cpk are ratios of distances to spread and stand whatever the shape. The expected
     PPM, Z.bench and sigma level are different: every one is a normal tail probability, and
     a tail probability from the wrong distribution is not approximately right. This measures
     how wrong, because the size of the error is the whole argument for withholding it. */
  const logn = (n, seed, sg) => {
    const r = E.rng(seed), out = [];
    const nz = () => { const u = Math.max(1e-12, r()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
    for (let i = 0; i < n; i++) out.push(Math.exp(nz() * sg));
    return out;
  };
  const Z999 = 3.090232306;   // the 99.9th percentile of a standard normal

  /* A right-skewed impurity with the limit placed at its TRUE 99.9th percentile, so the
     real out-of-spec rate is 1,000 PPM by construction and every error below is the normal
     assumption's alone. */
  const errors = [];
  for (const sg of [0.15, 0.25, 0.4, 0.6]) {
    const c = SPC.capability(logn(4000, 7, sg), { usl: Math.exp(Z999 * sg) }, false);
    errors.push({ sg, skew: c.skew, ppm: c.ppm, under: 1000 / Math.max(c.ppm, 1e-12), usable: c.tailsUsable });
    assert.strictEqual(c.tailsUsable, false, 'a lognormal at shape ' + sg + ' must fail the normality test');
  }
  // Even the mildest skew here understates the real rate by more than tenfold.
  assert.ok(errors[0].under > 10, 'at skewness ' + errors[0].skew.toFixed(2) + ' the normal figure was only ' +
    errors[0].under.toFixed(1) + 'x under; the point of the check is that this is large');
  // And it gets worse fast, which is why "approximate" was the wrong word for it.
  assert.ok(errors[3].under > 1000, 'by shape 0.6 it should be off by orders of magnitude, got ' + errors[3].under.toFixed(0) + 'x');
  for (let i = 1; i < errors.length; i++) {
    assert.ok(errors[i].under > errors[i - 1].under, 'the error must grow with the skew');
  }

  /* The rule this replaced fired on a skewness above 1. At the mildest shape above the
     skewness is below that, so the old rule stayed silent through an error of more than
     tenfold - the mild right skew impurities and aggregates actually have. */
  assert.ok(Math.abs(errors[0].skew) < 1,
    'the first case must be one the old skew>1 rule missed, skew was ' + errors[0].skew.toFixed(2));

  // Genuinely normal data must not be caught by this, or the warning is noise.
  const r = E.rng(3);
  const nz = () => { const u = Math.max(1e-12, r()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
  const normal = E.range(500).map(() => 10 + nz());
  const cn = SPC.capability(normal, { lsl: 7, usl: 13 }, false);
  assert.strictEqual(cn.tailsUsable, true, 'normal data must keep its tail figures');
  assert.ok(cn.ppm >= 0 && isFinite(cn.ppm));
  assert.ok(cn.normality.p > 0.05);

  /* Too few rows is reported as untested rather than as a pass. A silent pass on five
     results would be the worst of the three outcomes: an unchecked assumption presented as
     a checked one. */
  const tiny = SPC.capability([1, 2, 3, 4, 5], { usl: 6 }, false);
  assert.strictEqual(tiny.tailsUsable, null);
  assert.ok(/Too few/.test(tiny.normality.note));

  // Cp and Cpk survive either way: they are ratios of distances, not tail probabilities.
  const skewed = SPC.capability(logn(4000, 7, 0.6), { lsl: 0.1, usl: Math.exp(Z999 * 0.6) }, false);
  assert.ok(isFinite(skewed.Ppk) && skewed.Ppk !== null, 'Ppk is not a tail probability and must still be given');
  assert.ok(isFinite(skewed.observedPct), 'and the observed rate needs no distribution at all');
});

test('the agent says which capability figures it is withholding, and why', async () => {
  const logn = (n, seed, sg) => {
    const r = E.rng(seed), out = [];
    const nz = () => { const u = Math.max(1e-12, r()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
    for (let i = 0; i < n; i++) out.push(Math.exp(nz() * sg));
    return out;
  };
  const build = (vals) => {
    const r = E.rng(5), rows = [];
    for (let i = 0; i < vals.length; i++) rows.push(['B' + i, (5 + r() * 3).toFixed(2), ['A', 'B'][Math.floor(r() * 2)], vals[i].toFixed(4)]);
    return { columns: ['BatchID', 'Temp', 'Line', 'Impurity_Pct'], rows };
  };
  const usl = Math.exp(3.090232306 * 0.3);
  const rep = await A.run(build(logn(200, 7, 0.3)), { target: 'Impurity_Pct', sixSigma: { usl: Number(usl.toFixed(4)) } });
  assert.strictEqual(rep.spc.capability.tailsUsable, false);
  const text = rep.insights.map(i => i.text).join(' ');
  assert.ok(/not bell-shaped/.test(text), 'it must say so plainly');
  assert.ok(/not reported|withheld/.test(text), 'and say the tail figures are withheld rather than labelling them approximate');
  // The headline must not quote a PPM it has just disowned.
  const headline = rep.insights.find(i => /Process capability:/.test(i.text)).text;
  assert.ok(!/parts per million/.test(headline), 'the capability line must not quote PPM here: ' + headline);
  assert.ok(/Observed: \d+ of \d+/.test(headline), 'it must quote the observed count instead');
  // What remains has to be named, or the warning leaves the reader with nothing.
  assert.ok(/Cp and Cpk/.test(text) && /tolerance interval/.test(text), 'it must say what still stands and what to use instead');

  // On normal data the figures come back, or the check is just a blanket refusal.
  const r2 = E.rng(11);
  const nz2 = () => { const u = Math.max(1e-12, r2()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r2()); };
  const ok = await A.run(build(E.range(200).map(() => 10 + nz2())), { target: 'Impurity_Pct', sixSigma: { lsl: 6, usl: 14 } });
  assert.strictEqual(ok.spc.capability.tailsUsable, true);
  assert.ok(/parts per million/.test(ok.insights.find(i => /Process capability:/.test(i.text)).text),
    'normal data must still get its PPM');
});

test('DOE effects are judged after correcting for how many were tested', () => {
  /* Every term in a DOE is its own hypothesis test and a 2^4 design fits eleven of them.
     Each p-value is calibrated - the per-term false positive rate measures at about 5%,
     asserted below - but reading the list as "these effects are significant" is a different
     claim from any single test in it, and it is the claim people make. */
  const nullDoe = seed => {
    const r = E.rng(seed);
    const nz = () => { const u = Math.max(1e-12, r()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
    const runs = []; for (let i = 0; i < 16; i++) runs.push([0, 1, 2, 3].map(j => ((i >> j) & 1 ? 1 : -1)));
    for (let c = 0; c < 3; c++) runs.push([0, 0, 0, 0]);
    return { columns: ['StdOrder', 'Temp_C', 'pH', 'FeedRate', 'DO_Pct', 'Titer'],
      rows: runs.map((x, i) => [i + 1, 35 + 1.5 * x[0], 7 + 0.15 * x[1], 12 + 4 * x[2], 40 + 15 * x[3], (3.4 + 0.15 * nz()).toFixed(4)]) };
  };
  const realDoe = seed => {
    const r = E.rng(seed);
    const nz = () => { const u = Math.max(1e-12, r()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
    const runs = []; for (let i = 0; i < 16; i++) runs.push([0, 1, 2, 3].map(j => ((i >> j) & 1 ? 1 : -1)));
    for (let c = 0; c < 3; c++) runs.push([0, 0, 0, 0]);
    return { columns: ['StdOrder', 'Temp_C', 'pH', 'FeedRate', 'DO_Pct', 'Titer'],
      rows: runs.map((x, i) => [i + 1, 35 + 1.5 * x[0], 7 + 0.15 * x[1], 12 + 4 * x[2], 40 + 15 * x[3],
        (3.4 + 0.52 * x[0] + 0.34 * x[2] + 0.15 * nz()).toFixed(4)]) };
  };
  const sweep = (gen, trials) => {
    let anyRaw = 0, anyQ = 0, fRaw = 0, fQ = 0, hits = 0, perTerm = 0, terms = 0, ok = 0, m = 0;
    for (let s = 0; s < trials; s++) {
      const t = gen(1000 + s), prof = E.profile(t);
      const tc = prof.columns.find(c => c.name === 'Titer');
      const det = D.detect(prof, prof.columns.filter(c => c !== tc && c.kind !== 'id'), tc);
      if (!det.isDOE) continue;
      ok++;
      const a = D.analyze(det, tc);
      const ts = a.terms.filter(x => x.p !== null && isFinite(x.p));
      m = a.multiplicity.terms;
      const real = x => x.name === 'Temp_C' || x.name === 'FeedRate';
      const rawSig = ts.filter(x => x.p < 0.05), qSig = ts.filter(x => x.q < 0.05);
      terms += ts.length; perTerm += rawSig.length;
      fRaw += rawSig.filter(x => !real(x)).length;
      fQ += qSig.filter(x => !real(x)).length;
      if (rawSig.some(x => !real(x))) anyRaw++;
      if (qSig.some(x => !real(x))) anyQ++;
      if (qSig.some(x => x.name === 'Temp_C') && qSig.some(x => x.name === 'FeedRate')) hits++;
    }
    return { ok, m, anyRaw: anyRaw / ok, anyQ: anyQ / ok, fRaw: fRaw / ok, fQ: fQ / ok, hits: hits / ok, perTerm: perTerm / terms };
  };

  const N = sweep(nullDoe, 300);
  assert.ok(N.ok > 250, 'the design must be detected as a DOE');
  assert.ok(N.m >= 10, 'this design should fit at least ten terms, got ' + N.m);
  // The individual tests are calibrated; the problem is the number of them, not their maths.
  assert.ok(N.perTerm > 0.02 && N.perTerm < 0.09, 'per-term false positive rate should sit near 0.05, got ' + N.perTerm.toFixed(3));
  /* On data with nothing in it, roughly one analysis in four turns up a "significant"
     effect at raw p. That is the number the correction exists for. */
  assert.ok(N.anyRaw > 0.15, 'raw p should go wrong often enough to matter: ' + (N.anyRaw * 100).toFixed(1) + '%');
  assert.ok(N.anyQ < N.anyRaw / 4, 'the correction must cut that sharply: ' +
    (N.anyRaw * 100).toFixed(1) + '% -> ' + (N.anyQ * 100).toFixed(1) + '%');
  assert.ok(N.anyQ < 0.06, 'and land near the level it controls, got ' + (N.anyQ * 100).toFixed(1) + '%');
  assert.ok(N.fQ < N.fRaw / 4, 'false findings per analysis: ' + N.fRaw.toFixed(2) + ' -> ' + N.fQ.toFixed(2));

  /* And it must not buy that by refusing everything. Bonferroni or Holm would be stricter
     and would strip real effects out of a nineteen-run design where power is already thin;
     Benjamini-Hochberg keeps both real effects every single time here. */
  const R = sweep(realDoe, 300);
  assert.strictEqual(R.hits, 1, 'both real effects must still be found in every analysis, got ' + (R.hits * 100).toFixed(1) + '%');
  assert.ok(R.fQ < R.fRaw, 'while still trimming the false extras: ' + R.fRaw.toFixed(2) + ' -> ' + R.fQ.toFixed(2));
});

test('the adjusted p-values are a correct Benjamini-Hochberg, and everything reads the same column', () => {
  // Checked against a worked example rather than against itself.
  const build = ps => ({
    isDOE: true,
    terms: ps.map((p, i) => ({ name: 't' + i, p })),
    multiplicity: null
  });
  const bh = ps => {
    const t = build(ps).terms.slice().sort((a, b) => a.p - b.p);
    let run = 1;
    for (let i = t.length - 1; i >= 0; i--) { run = Math.min(run, (t.length / (i + 1)) * t[i].p); t[i].q = Math.min(1, run); }
    return t.map(x => x.q);
  };
  const got = bh([0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205]).map(v => Number(v.toFixed(4)));
  assert.deepStrictEqual(got, [0.008, 0.032, 0.0672, 0.0672, 0.0672, 0.08, 0.0846, 0.205],
    'the standard worked example must come out exactly');

  // And on a real analysis: monotone, never below the raw value, never above 1.
  const t = E.parseCSV(S.find(x => x.id === 'fedbatch').make());
  const prof = E.profile(t);
  const tc = prof.columns.find(c => c.name === 'Titer_gL');
  const a = D.analyze(D.detect(prof, prof.columns.filter(c => c !== tc && c.kind !== 'id'), tc), tc);
  const ts = a.terms.filter(x => x.p !== null && isFinite(x.p)).slice().sort((x, y) => x.p - y.p);
  for (const x of ts) { assert.ok(x.q >= x.p - 1e-12, x.name + ': q must not fall below p'); assert.ok(x.q <= 1); }
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i].q >= ts[i - 1].q - 1e-12, 'q must not decrease as p rises');
  assert.strictEqual(a.multiplicity.terms, ts.length);
  assert.ok(a.multiplicity.fwerBound > 0.3, 'eleven terms is a real family-wise risk: ' + a.multiplicity.fwerBound);
  // On this design the real effects survive, so the correction is not just suppressing work.
  assert.ok(a.multiplicity.fdrSignificant >= 5, 'the built-in effects must survive: ' + a.multiplicity.fdrSignificant);

  /* Three places decide what counts as a real effect - the findings, the next steps and the
     action plan. Two reading the raw column while the third reads the adjusted one is how a
     report ends up recommending a lever it has just disowned, so they share one helper. */
  const agentSrc = fs.readFileSync(path.join(ROOT, 'agent.js'), 'utf8');
  assert.ok(/const sigP = t =>/.test(agentSrc), 'one definition of what counts as significant');
  const raw = agentSrc.match(/a\.terms\.filter\(t => t\.p < 0\.05\)/g);
  assert.strictEqual(raw, null, 'no path may still filter on the raw p: found ' + (raw || []).length);
});

test('levels the model cannot tell apart are named, not left to show as a smaller count', () => {
  /* A text factor fails in two quiet ways and a helper catalogue hits both. A level the
     history never used cannot be placed, so every combination containing it is refused -
     on a catalogue of six helpers where three have ever been run, that is half the
     catalogue, and the only sign used to be a candidate count smaller than the arithmetic
     implied. And a level that was run only a handful of times is modelled, but on a number
     that is mostly the overall average rather than anything about that level.

     Neither is a wrong decision. Both are indefensible as silent ones, because a helper
     the model could not see then looks exactly like a helper that scored badly. */
  const r = E.rng(7);
  const nz = () => { const u = Math.max(1e-9, r()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
  const SEEN = ['pCap-A', 'pCap-B', 'pCap-C'];
  const rows = [];
  for (let i = 0; i < 300; i++) {
    const cl = ['mAb', 'enzyme', 'bispecific'][Math.floor(r() * 3)];
    const h = SEEN[Math.floor(r() * 3)];
    rows.push(['C' + i, cl, [148, 62, 99][['mAb', 'enzyme', 'bispecific'].indexOf(cl)],
      ['CMV', 'EF1a'][Math.floor(r() * 2)], h, (3 + (h === 'pCap-C' ? 0.8 : 0) + nz() * 0.2).toFixed(3)]);
  }
  const prof = E.profile({ columns: ['ID', 'Protein_Class', 'Protein_kDa', 'Promoter_Type', 'Helper_Cap', 'Titer_gL'], rows });

  /* A catalogue written the way one actually arrives: text factors, several levels, and no
     Min or Max column anywhere. That shape has to parse on its own. */
  const cat = PG.parseCatalogue({
    columns: ['Factor', 'Levels'],
    rows: [['Promoter_Type', 'CMV; EF1a'], ['Helper_Cap', 'pCap-A; pCap-B; pCap-C; pCap-D; pCap-E; pCap-F']]
  });
  assert.strictEqual(cat.problems.length, 0, 'a text-only catalogue needs no Min and Max: ' + cat.problems.join('; '));
  assert.ok(cat.factors.every(f => f.kind === 'categorical'));
  assert.strictEqual(cat.factors.find(f => f.name === 'Helper_Cap').levels.length, 6);

  const plan = PG.plan({ profile: prof, factors: cat.factors,
    programs: [{ id: 'P1', attributes: { Protein_Class: 'mAb', Protein_kDa: '148' } }], targets: ['Titer_gL'] },
    { seed: 42, runs: 48 });

  const cov = plan.coverage.find(c => c.factor === 'Helper_Cap');
  assert.ok(cov, 'the factor with unusable levels must be reported');
  assert.deepStrictEqual(cov.unseen.slice().sort(), ['pCap-D', 'pCap-E', 'pCap-F'],
    'the three never run here must be named individually');
  assert.deepStrictEqual(cov.modelled.slice().sort(), ['pCap-A', 'pCap-B', 'pCap-C']);
  assert.strictEqual(cov.total, 6);
  // And the consequence is real: half the catalogue cannot be scored.
  assert.strictEqual(plan.perProgram[0].refused, plan.candidateCount - plan.perProgram[0].candidates);
  assert.ok(plan.perProgram[0].refused > 0, 'combinations using an unrunnable level must be refused, not guessed');
  // A factor whose levels are all runnable must not be reported at all, or the panel is noise.
  assert.ok(!plan.coverage.some(c => c.factor === 'Promoter_Type'));

  /* The other failure used to be pooling: the encoder kept the twelve commonest levels and
     lumped the rest into "other", so a thirteenth helper was modelled as "one of the rare
     ones". It no longer does that - a many-levelled column is carried as a frequency and a
     smoothed level average, so every level is modelled as itself. What that cannot remove
     is the thinness; it only makes it gradual, because the average for a level with eight
     runs is mostly the overall average by design. So the claim to check is that the
     thinness is still named, with the weight stated. Fifteen helpers, all genuinely run,
     three of them deliberately rare. */
  const LV = E.range(15).map(i => 'pHelp-' + String(i + 1).padStart(2, '0'));
  const r2 = E.rng(3);
  const nz2 = () => { const u = Math.max(1e-9, r2()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r2()); };
  const rows2 = [];
  const CLS = ['mAb', 'enzyme', 'bispecific'];
  for (let i = 0; i < 600; i++) {
    // The last three are made deliberately rare, so they fall outside the kept twelve.
    const h = r2() < 0.04 ? LV[12 + Math.floor(r2() * 3)] : LV[Math.floor(r2() * 12)];
    const cl = CLS[Math.floor(r2() * 3)];
    rows2.push(['C' + i, cl, [148, 62, 99][CLS.indexOf(cl)], h, ['CMV', 'EF1a'][Math.floor(r2() * 2)], (3 + nz2() * 0.2).toFixed(3)]);
  }
  const prof2 = E.profile({ columns: ['ID', 'Protein_Class', 'Protein_kDa', 'Helper', 'Promoter_Type', 'Titer_gL'], rows: rows2 });
  const cat2 = PG.parseCatalogue({ columns: ['Factor', 'Levels'], rows: [['Helper', LV.join('; ')], ['Promoter_Type', 'CMV; EF1a']] });
  const plan2 = PG.plan({ profile: prof2, factors: cat2.factors,
    programs: [{ id: 'P1', attributes: { Protein_Class: 'mAb', Protein_kDa: '148' } }], targets: ['Titer_gL'] },
    { seed: 42, runs: 24 });
  const cov2 = plan2.coverage.find(c => c.factor === 'Helper');
  assert.ok(cov2, 'thin levels must be reported too');
  assert.strictEqual(cov2.unseen.length, 0, 'all fifteen were run');
  assert.strictEqual(cov2.modelled.length, 15, 'every level is modelled as itself now, not twelve of them');
  // The three rare ones, and only those three, are called thin.
  assert.ok(cov2.thin.length >= 3 && cov2.thin.length <= 4, 'the rare levels must be named: ' + JSON.stringify(cov2.thin));
  for (const t of cov2.thin) {
    assert.ok(t.runs < 20, t.level + ' was flagged thin on ' + t.runs + ' runs, which is not thin');
    // The weight is stated, and it is the smoothing weight over the level's own runs.
    assert.ok(Math.abs(t.shrink - E.TARGET_PRIOR / (t.runs + E.TARGET_PRIOR)) < 1e-12);
    assert.ok(t.shrink > 0.5, 'thin means the prior outweighs the level own runs, got ' + t.shrink.toFixed(2));
  }
  // A level with plenty of runs is not flagged, or the panel is noise again.
  const flagged = new Set(cov2.thin.map(t => t.level));
  assert.ok(LV.slice(0, 12).some(l => !flagged.has(l)), 'the common levels must not be flagged');

  /* And the gain, on this same data: the three rare helpers are now ranked individually
     rather than as one pool, so a sheet can propose one of them and say which. */
  const sheetLevels = new Set(plan2.perProgram[0].sheet.map(r => r.config.Helper));
  assert.ok(sheetLevels.size >= 2, 'the run sheet must still vary the helper: ' + JSON.stringify(Array.from(sheetLevels)));
});

const CM = require(path.join(ROOT, 'campaign.js'));

test('rounds stack by column name, not by column order', () => {
  /* A run sheet comes back with its columns in whatever order the instrument wrote them,
     and usually with an extra one nobody asked for. Matching by position would silently put
     the operator initials in the titer column; dropping the unmatched column would throw
     away every earlier measurement of it. */
  const a = { name: 'passive', columns: ['Temp', 'pH', 'Titer'], rows: [['35', '7', '3.0'], ['36', '7.1', '3.8']] };
  const b = { name: 'DOE 1', columns: ['Titer', 'Temp', 'pH', 'Operator'], rows: [['4.2', '37', '7.2', 'VK']] };
  const st = CM.stack([a, b]);
  assert.deepStrictEqual(st.columns, ['Temp', 'pH', 'Titer', 'Operator', 'Round']);
  assert.deepStrictEqual(st.rows[0], ['35', '7', '3.0', '', '0'], 'the first round has no Operator and must keep the gap');
  assert.deepStrictEqual(st.rows[2], ['37', '7.2', '4.2', 'VK', '1'], 'the reordered round must land in the right columns');
  assert.deepStrictEqual(st.rounds.map(r => r.rows), [2, 1]);
  // Names differing only by case or punctuation are the same column.
  const c = CM.stack([{ columns: ['Temp_C', 'Titer'], rows: [['35', '3']] }, { columns: ['temp c', 'titer'], rows: [['36', '4']] }]);
  assert.deepStrictEqual(c.columns, ['Temp_C', 'Titer', 'Round']);
  assert.strictEqual(c.rows.length, 2);
  assert.deepStrictEqual(c.rows[1], ['36', '4', '1']);
  // And the round tag can be turned off for callers that do not want it.
  assert.deepStrictEqual(CM.stack([a], { roundColumn: false }).columns, ['Temp', 'pH', 'Titer']);
});

test('a campaign is steered on the interval, because R-squared moves with the range', () => {
  /* The trap in this loop. R2 is error measured against the spread of the data, and every
     round of a design-of-experiments campaign widens that spread deliberately - that is
     what the design is for. So R2 rises whether or not the model has improved, and a
     campaign steered by it would stop after one round of widening ranges having learned
     nothing. Measured here rather than argued. */
  const truth = t => 3 + 0.9 * (t - 35);
  const mk = (n, half, seed) => {
    const r = E.rng(seed);
    const z = () => { const u = Math.max(1e-12, r()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
    const rows = [];
    for (let i = 0; i < n; i++) { const t = 35 - half + r() * 2 * half; rows.push([t.toFixed(3), (truth(t) + z() * 0.25).toFixed(3)]); }
    return { columns: ['Temp', 'Titer'], rows };
  };
  // Identical truth, identical noise, identical model. Only the sampled range changes.
  const narrow = CM.metrics(mk(300, 0.4, 11), 'Titer', { seed: 42 });
  const wide = CM.metrics(mk(300, 3.2, 11), 'Titer', { seed: 42 });
  assert.ok(wide.r2 - narrow.r2 > 0.4,
    'widening the range alone must move R2 a long way: ' + narrow.r2.toFixed(3) + ' -> ' + wide.r2.toFixed(3));
  assert.ok(Math.abs(wide.rmse - narrow.rmse) < 0.05,
    'while the error per row barely moves: ' + narrow.rmse.toFixed(3) + ' vs ' + wide.rmse.toFixed(3));

  /* So the two causes are separated. On exactly this pair the model is no better at all, and
     the attribution has to say so rather than reporting a 0.6 improvement. */
  const a = CM.assess([narrow, wide], { halfWidth: 0.9 });
  assert.ok(a.rangeEffect, 'the attribution must be computed once there is more than one round');
  assert.ok(a.rangeEffect.spreadRatio > 2, 'the spread really did grow: ' + a.rangeEffect.spreadRatio.toFixed(2));
  assert.ok(Math.abs(a.rangeEffect.genuine) < 0.1,
    'almost none of this is a better model, got ' + a.rangeEffect.genuine.toFixed(3));
  assert.ok(a.rangeEffect.fromWidening > 0.4,
    'and almost all of it is the range, got ' + a.rangeEffect.fromWidening.toFixed(3));
  assert.ok(Math.abs(a.rangeEffect.fromWidening + a.rangeEffect.genuine - a.deltaR2) < 1e-9,
    'the two parts must add up to the move actually seen');

  // Targets are checked individually and only all of them together end a campaign.
  const t = CM.assess([narrow, wide], { halfWidth: 0.0001, r2: 0.5 });
  assert.strictEqual(t.met.r2, true);
  assert.strictEqual(t.met.halfWidth, false);
  assert.strictEqual(t.done, false, 'meeting the R2 target while the interval is nowhere near is not done');
  assert.strictEqual(CM.assess([narrow], {}).done, false, 'no targets set is not the same as targets met');

  // A target the tool cannot measure is refused rather than guessed.
  assert.throws(() => CM.metrics({ columns: ['a', 'b'], rows: [['x', 'y'], ['x', 'z']] }, 'b'), /not a number|at least 8/);
  assert.throws(() => CM.metrics(mk(300, 1, 5), 'NoSuchColumn'), /No column called/);
});

test('what another round would buy is projected from this dataset, and checked against what it does', () => {
  /* The projection refits on subsets of increasing size and reads the curve forward, rather
     than quoting a rule of thumb. Here it is held to that: project from n what the error
     will be at 2n, then actually build 2n and measure. */
  const truth = (t, p) => 3 + 0.9 * (t - 35) - 0.18 * (t - 35) * (t - 35) + 1.0 * (p - 7);
  const mk = (n, seed) => {
    const r = E.rng(seed);
    const z = () => { const u = Math.max(1e-12, r()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
    const rows = [];
    for (let i = 0; i < n; i++) {
      const t = 33 + r() * 4, p = 6.6 + r() * 0.8;
      rows.push([t.toFixed(3), p.toFixed(3), (truth(t, p) + z() * 0.3).toFixed(3)]);
    }
    return { columns: ['Temp', 'pH', 'Titer'], rows };
  };
  const errs = [];
  for (const n of [100, 160]) {
    const proj = CM.project(mk(n, 11), 'Titer', n, { seed: 42 });
    assert.ok(proj.projection, 'a projection must be produced at n=' + n);
    assert.strictEqual(proj.projection.atN, 2 * n);
    const actual = CM.metrics(mk(2 * n, 11), 'Titer', { seed: 42 });
    errs.push(Math.abs(proj.projection.rmse / actual.rmse - 1));
    /* More runs must never be projected to make the model worse. Left unguarded the least
       squares fit will happily return a rising curve when the subsample measurements are
       noisy, which produces the one projection nobody should ever be shown. A flat curve is
       the honest reading of that situation and is flagged as flat. */
    assert.ok(proj.projection.rmse <= proj.base.rmse + 1e-9, 'the curve must not predict getting worse with more data');
    if (proj.projection.flat) assert.ok(proj.projection.rmse <= proj.base.rmse + 1e-9,
      'a flat curve projects no better than today, and no worse');
    /* The floor is where the curve is heading, and it cannot sit below the noise that
       generated the data - that is the number that says stop running plates and improve the
       assay instead. */
    assert.ok(proj.projection.rmseFloor > 0.15 && proj.projection.rmseFloor < 0.5,
      'the floor should land near the 0.3 noise it was generated with, got ' + proj.projection.rmseFloor.toFixed(3));
    assert.ok(proj.points.length >= 3, 'the curve needs points to be fitted through');
  }
  assert.ok(Math.max.apply(null, errs) < 0.25,
    'the projection must land near what actually happens: errors were ' + errs.map(e => (e * 100).toFixed(0) + '%').join(', '));

  // Too little data to trace a curve is said rather than extrapolated from two points.
  const tiny = CM.project(mk(12, 3), 'Titer', 12, { seed: 42 });
  assert.ok(tiny.projection === null || tiny.points.length >= 3);
  if (tiny.projection === null) assert.ok(/Too few runs/.test(tiny.why));
  // And the extrapolation is labelled as one.
  const p2 = CM.project(mk(120, 11), 'Titer', 40, { seed: 42 });
  assert.ok(/assumes the next runs resemble/.test(p2.assumption), p2.assumption);
});

test('variance inflation catches what a pairwise correlation cannot', () => {
  const mk = (n, r, seed) => {
    const q = E.rng(seed);
    const z = () => { const u = Math.max(1e-12, q()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * q()); };
    const rows = [];
    for (let i = 0; i < n; i++) { const a = z(), b = r * a + Math.sqrt(1 - r * r) * z(); rows.push([a.toFixed(5), b.toFixed(5)]); }
    return { columns: ['A', 'B'], rows };
  };
  /* Two inputs correlated at r have a VIF of exactly 1/(1-r^2). Checked against that
     identity rather than against the function's own output. */
  for (const r of [0.5, 0.8, 0.9, 0.95]) {
    const prof = E.profile(mk(4000, r, 7));
    const got = E.vif(prof.columns, E.range(prof.nRows)).factors[0].vif;
    const want = 1 / (1 - r * r);
    assert.ok(Math.abs(got - want) / want < 0.05,
      'at r=' + r + ' VIF should be ' + want.toFixed(2) + ', got ' + got.toFixed(2));
  }

  /* The case the brief's pairwise check misses, and the reason VIF is worth having: three
     inputs that are each only mildly correlated but jointly almost determine one another.
     No pair looks alarming and the coefficients are still meaningless. */
  const q = E.rng(3);
  const z = () => { const u = Math.max(1e-12, q()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * q()); };
  const rows = [];
  for (let i = 0; i < 2000; i++) { const a = z(), b = z(); rows.push([a.toFixed(5), b.toFixed(5), (a + b + z() * 0.25).toFixed(5)]); }
  const prof = E.profile({ columns: ['A', 'B', 'C'], rows });
  const pair = (x, y) => Math.abs(E.pearson(prof.columns.find(c => c.name === x).values, prof.columns.find(c => c.name === y).values));
  const worstPair = Math.max(pair('A', 'B'), pair('A', 'C'), pair('B', 'C'));
  assert.ok(worstPair < 0.9, 'no pair trips a 0.9 threshold: worst was ' + worstPair.toFixed(3));
  const v = E.vif(prof.columns, E.range(prof.nRows));
  assert.ok(v.factors.every(f => f.vif > 10), 'yet every one is severely inflated: ' +
    v.factors.map(f => f.name + ' ' + f.vif.toFixed(1)).join(', '));
  assert.strictEqual(v.factors[0].verdict, 'severe');

  /* Exact collinearity does not make the inversion fail cleanly - it returns enormous
     numbers - so a VIF in the billions has to be read as what it is. Reporting
     621,657,757,936 would be the honest output of the arithmetic and useless to everybody. */
  const q2 = E.rng(3), rows2 = [];
  for (let i = 0; i < 200; i++) { const a = q2(), b = q2(); rows2.push([a.toFixed(6), b.toFixed(6), (a + b).toFixed(6)]); }
  const sing = E.vif(E.profile({ columns: ['A', 'B', 'S'], rows: rows2 }).columns, E.range(200));
  assert.strictEqual(sing.singular, true);
  assert.ok(sing.factors.every(f => f.verdict === 'inseparable'), 'not "very collinear" but inseparable');
  assert.ok(/cannot be estimated at all/.test(sing.note), sing.note);

  /* Things it cannot answer are refused rather than guessed. Profiling normally keeps a
     constant column away from here by tagging it constant, so the guard is exercised
     directly - a column that reaches this function with no variance would otherwise make
     the correlation matrix singular for a reason that has nothing to do with collinearity. */
  assert.deepStrictEqual(E.vif([{ kind: 'numeric', name: 'only', values: [1, 2, 3] }], [0, 1, 2]).factors, [],
    'one input cannot be collinear with anything');
  const flatCols = [
    { kind: 'numeric', name: 'Varies', values: E.range(40) },
    { kind: 'numeric', name: 'Frozen', values: E.range(40).map(() => 7) }
  ];
  assert.ok(/do not vary/.test(E.vif(flatCols, E.range(40)).note || ''),
    'a frozen input is named rather than producing an undefined factor');
  // Too few rows to separate the inputs is said, not papered over.
  assert.ok(/Too few complete rows/.test(E.vif([
    { kind: 'numeric', name: 'A', values: [1, 2, 3] },
    { kind: 'numeric', name: 'B', values: [2, 4, 7] }
  ], [0, 1, 2]).note || ''));
});

test('the control chart runs the full Nelson set, and says what that costs', () => {
  /* Rule 1 catches a point so far out it cannot be chance. The other seven catch what a
     limits-only chart is blind to: a process that has shifted or drifted while every point
     stays inside the lines. Each is checked on data built to trip exactly it, using the
     sigma the chart itself computes rather than a guess at it. */
  const probe = mut => {
    const y = E.range(40).map(i => 10 + (i % 2 ? 0.1 : -0.1));
    const sg = SPC.imr(y).sigma;
    mut(y, sg);
    return SPC.imr(y);
  };
  const fires = (im, why) => im.signals.some(s => s.why.includes(why));
  assert.ok(fires(probe((y, sg) => { y[15] = 10 + 5 * sg; }), 'beyond 3 sigma'), 'rule 1');
  assert.ok(fires(probe((y, sg) => { for (let i = 10; i < 19; i++) y[i] = 10 + 0.5 * sg; }), '9 in a row on one side'), 'rule 2');
  assert.ok(fires(probe((y, sg) => { for (let i = 10; i < 16; i++) y[i] = 10 + (i - 9) * 0.3 * sg; }), '6 in a row rising'), 'rule 3');
  assert.ok(fires(probe(() => {}), '14 alternating'), 'rule 4');
  assert.ok(fires(probe((y, sg) => { y[10] = 10 + 2.5 * sg; y[12] = 10 + 2.4 * sg; }), '2 of 3 beyond 2 sigma'), 'rule 5');
  assert.ok(fires(probe((y, sg) => { for (const i of [10, 11, 13, 14]) y[i] = 10 + 1.5 * sg; }), '4 of 5 beyond 1 sigma'), 'rule 6');
  assert.ok(fires(probe((y, sg) => { for (let i = 5; i < 25; i++) y[i] = 10 + (i % 2 ? 0.05 : -0.05) * sg; }), '15 in a row hugging the centre'), 'rule 7');
  assert.ok(fires(probe((y, sg) => { for (let i = 10; i < 18; i++) y[i] = 10 + (i % 2 ? 1.4 : -1.4) * sg; }), '8 in a row avoiding the centre'), 'rule 8');

  const q = E.rng(5);
  const nz = () => { const u = Math.max(1e-12, q()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * q()); };
  // An alarm is a run, not a point: a nine-in-a-row marks nine points and is one alarm.
  const events = im => {
    let c = 0; const active = {};
    im.flags.forEach(f => {
      for (const w of f) if (!active[w]) { active[w] = true; c++; }
      for (const w of Object.keys(active)) if (f.indexOf(w) < 0) delete active[w];
    });
    return c;
  };
  /* Rule 1 on its own is the one with a textbook figure to check against: a false signal
     about once every 370 points on a process with nothing wrong with it. */
  let only1 = 0, pts = 0, all = 0, lim = 0;
  for (let t = 0; t < 1200; t++) {
    const s = E.range(50).map(() => 10 + nz());
    const im = SPC.imr(s), imLim = SPC.imr(s, { rules: 'limits' });
    only1 += events({ flags: im.flags.map(f => f.filter(w => w === 'beyond 3 sigma')) });
    all += events(im); lim += events(imLim); pts += 50;
  }
  const per = c => pts / Math.max(1, c);
  assert.ok(per(only1) > 250 && per(only1) < 520,
    'the 3-sigma rule alone should land near the textbook 370, got ' + Math.round(per(only1)));
  /* The cost of the other seven, measured rather than asserted: about one false signal per
     fifty points, so roughly one per chart. Fine if you know it; misleading if you do not. */
  assert.ok(per(all) < per(lim), 'the full set must fire more often than limits alone');
  assert.ok(per(all) > 25 && per(all) < 90, 'measured about 1 in 50, got 1 in ' + Math.round(per(all)));
  const im = SPC.imr(E.range(50).map(() => 10 + nz()));
  assert.ok(Math.abs(im.falseAlarmEvery - per(all)) < 30, 'the reported rate must match the measured one: reported ' +
    im.falseAlarmEvery + ', measured ' + Math.round(per(all)));
  assert.ok(Math.abs(im.expectedFalse - 50 / im.falseAlarmEvery) < 1e-9);

  /* And the point of the extra rules: a shift that leaves every point inside the limits. A
     limits-only chart barely sees it. */
  const shift = E.range(40).map(i => 10 + (i < 25 ? 0 : 0.9) + nz() * 0.35);
  assert.ok(SPC.imr(shift, { rules: 'all' }).signals.length > SPC.imr(shift, { rules: 'limits' }).signals.length * 3,
    'the full set must catch a shift the limits miss');
  assert.strictEqual(SPC.imr(shift, { rules: 'limits' }).rules, 'limits');
});

test('JSON lands as a table whatever shape the export used', () => {
  // A list of records, which is what most APIs return. A field only some records carry
  // still gets a column, blank where it is absent, rather than knocking the rows out of line.
  const recs = E.parseTable('[{"Batch":"A","Titer":2.4},{"Batch":"B","Titer":3.1,"Note":"re-run"}]', 'runs.json');
  assert.deepStrictEqual(recs.columns, ['Batch', 'Titer', 'Note']);
  assert.deepStrictEqual(recs.rows, [['A', '2.4', ''], ['B', '3.1', 're-run']]);

  // An envelope: the records wrapped in metadata, the usual shape of a LIMS pull.
  const env = E.parseTable('{"status":"ok","count":2,"data":[{"A":1},{"A":2}]}', 'pull.json');
  assert.deepStrictEqual(env.columns, ['A']);
  assert.strictEqual(env.rows.length, 2);
  assert.ok(/"data" list/.test(env.shape), 'it must say which list it read, got ' + env.shape);

  // One array per column, which is how a dataframe serialises.
  const cols = E.parseTable('{"A":[1,2,3],"B":[4,5,6]}', 'frame.json');
  assert.deepStrictEqual(cols.columns, ['A', 'B']);
  assert.deepStrictEqual(cols.rows, [['1', '4'], ['2', '5'], ['3', '6']]);

  // One record per line, which is what a streamed export writes.
  const nd = E.parseTable('{"A":1}\n{"A":2}\n{"A":3}\n', 'stream.ndjson');
  assert.strictEqual(nd.rows.length, 3);

  // A list of rows with the names on top, and a single record.
  assert.deepStrictEqual(E.parseTable('[["A","B"],[1,2]]', 'grid.json').columns, ['A', 'B']);
  assert.deepStrictEqual(E.parseTable('{"A":1,"B":2}', 'one.json').rows, [['1', '2']]);

  /* Nesting, which instrument exports are full of. A nested object takes dotted names; a
     list inside one record is not a column, so it is kept as text rather than invented
     into one; null is missing, not zero; true and false are two levels. */
  const nest = E.parseTable('[{"id":1,"qc":{"purity":99.1,"hmw":0.4},"tags":["a","b"],"passed":true,"note":null}]', 'x.json');
  assert.deepStrictEqual(nest.columns, ['id', 'qc.purity', 'qc.hmw', 'tags', 'passed', 'note']);
  assert.deepStrictEqual(nest.rows[0], ['1', '99.1', '0.4', 'a; b', 'true', '']);
  const prof = E.profile({ columns: nest.columns, rows: nest.rows });
  assert.strictEqual(prof.columns[5].missing, 1, 'null must read as missing, not as a value');

  // A JSON file that is not JSON says so, rather than being silently read as one column.
  assert.throws(() => E.parseTable('{nope', 'broken.json'), /not valid JSON/);
  // And the sniffing is by content too, so a pasted record works with no file name at all.
  assert.deepStrictEqual(E.parseTable('  [{"A":1}]').columns, ['A']);
  // A CSV is still a CSV, even opening with a brace.
  assert.deepStrictEqual(E.parseTable('{a},b\n1,2\n', 'odd.csv').columns, ['{a}', 'b']);
});

/* Many levels, few rows each: 48 strains, a backbone catalogue, a supplier list. One-hot
   gives twelve of them a column and lumps the rest into "other", so the column that
   separates 48 strains arrives separating thirteen. Frequency and smoothed level averages
   carry it instead - and the level average is the one encoding that can leak the answer,
   so this test measures both what it buys and what fitting it wrong would cost. */
test('many-levelled text columns are carried as numbers, and fitting them leaks if done once', () => {
  const build = (nLev, signal, feed, seed) => {
    const r = E.rng(seed), nz = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const eff = E.range(nLev).map(() => nz() * 2);
    const rows = [];
    for (let i = 0; i < 200; i++) {
      const L = Math.floor(r() * nLev), x = r() * 10;
      rows.push(['S' + L, x.toFixed(3), (50 + feed * x + signal * eff[L] + nz()).toFixed(4)]);
    }
    return { columns: ['Strain', 'Feed', 'Titer'], rows };
  };
  // The same table with every level outside the top twelve renamed "other": exactly what
  // one-hot could have seen.
  const collapse = t => {
    const counts = {};
    for (const q of t.rows) counts[q[0]] = (counts[q[0]] || 0) + 1;
    const keep = new Set(Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 12));
    return { columns: t.columns.slice(), rows: t.rows.map(q => [keep.has(q[0]) ? q[0] : 'other', q[1], q[2]]) };
  };
  const setup = t => {
    const prof = E.profile(t);
    const target = prof.columns.find(c => c.name === 'Titer');
    const feats = prof.columns.filter(c => c.name !== 'Titer' && E.isUsableFeature(c));
    return { data: E.supervisedData(prof, target, feats, 'regression'), model: E.MODELS.find(m => m.id === 'ridge') };
  };
  const honest = (t, seed) => {
    const { data, model } = setup(t);
    const folds = E.makeFolds(data.rows.length, 5, E.rng(seed));
    return E.regressionMetrics(data.y, E.crossValidate(model, data, 'regression', folds, 5, seed)).r2;
  };
  // The leak: one encoder fit on every row, then used inside the folds. Each fold is then
  // scored on rows whose own results are already baked into the numbers it trained on.
  const leaky = (t, seed) => {
    const { data, model } = setup(t);
    const folds = E.makeFolds(data.rows.length, 5, E.rng(seed));
    const enc = E.fitEncoder(data.featureCols, data.rows, { y: data.y, task: 'regression' });
    const n = data.rows.length, oof = new Array(n);
    for (let f = 0; f < 5; f++) {
      const tr = [], te = [];
      for (let i = 0; i < n; i++) (folds[i] === f ? te : tr).push(i);
      const fit = model.fit(enc.transform(tr.map(i => data.rows[i])), tr.map(i => data.y[i]), { task: 'regression', nClasses: 0, rand: E.rng(seed + f) });
      const pr = fit.predict(enc.transform(te.map(i => data.rows[i])));
      te.forEach((i, j) => { oof[i] = pr[j]; });
    }
    return E.regressionMetrics(data.y, oof).r2;
  };
  const avg = f => { let s = 0; for (let i = 1; i <= 8; i++) s += f(i); return s / 8; };

  // 40 strains, 5 runs each, and the strain genuinely matters.
  const real = s => build(40, 1, 0.5, s * 77);
  const gain = avg(s => honest(real(s)), 0), oneHot = avg(s => honest(collapse(real(s)), 0));
  assert.ok(gain > oneHot + 0.1, 'carrying every level must beat collapsing to twelve: ' +
    gain.toFixed(3) + ' against ' + oneHot.toFixed(3));
  // Measured: 0.70 against 0.49. A fifth of the achievable fit was in the levels one-hot dropped.

  /* The control, and the reason the encoder is rebuilt per fold. Nothing is predictable
     here at all: strain is noise and there is no other signal, so an honest check must
     report no fit. Fit the level averages once on every row and the same nothing scores
     like a working model. */
  const noise = s => build(40, 0, 0, s * 77);
  const fair = avg(s => honest(noise(s)), 0), leak = avg(s => leaky(noise(s)), 0);
  assert.ok(fair < 0.02, 'a noise column must not score: got ' + fair.toFixed(3));
  assert.ok(leak > fair + 0.2, 'fitting the averages on every row must inflate the score, or this test proves nothing: ' +
    leak.toFixed(3) + ' against ' + fair.toFixed(3));
  // Measured: −0.16 done per fold, +0.15 done once. That +0.15 is a model that does not exist.

  /* The smoothing weight, swept rather than assumed. At 5 rows per level, a weight of 1
     buys 0.013 more on real signal and costs 0.063 more on noise than a weight of 10, and
     the curve is that flat from 1 to 40, so 10 is taken as the safer end of a shallow
     trade-off. The encoder must sit in that flat region, not past it. */
  const t0 = real(3);
  const enc = E.fitEncoder(E.profile(t0).columns.filter(c => c.name === 'Strain'), E.range(200), { y: t0.rows.map(q => Number(q[2])), task: 'regression' });
  const part = enc.parts[0];
  assert.strictEqual(part.type, 'high', 'a 40-level column must not be one-hot');
  assert.strictEqual(part.maps.length, 2, 'frequency and level average, two columns, not thirteen');
  assert.deepStrictEqual(part.maps.map(m => m.kind), ['freq', 'target']);
  assert.strictEqual(enc.labels.length, 2);
  assert.ok(/how common/.test(enc.labels[0]) && /average/.test(enc.labels[1]), 'the labels must say which is which: ' + enc.labels.join(' / '));

  // A level this fit never saw is given the overall figure, which is the only honest answer
  // for it, and never a number borrowed from a different level.
  const unseen = enc.encodeValues({ Strain: 'S_NEVER_RAN' });
  const freqMap = part.maps[0], tgtMap = part.maps[1];
  assert.ok(Math.abs(unseen[0] - (freqMap.fallback - freqMap.m) / freqMap.s) < 1e-12);
  assert.ok(Math.abs(unseen[1] - (tgtMap.fallback - tgtMap.m) / tgtMap.s) < 1e-12);
  // The fallback average is the overall average of the rows it was fit on.
  assert.ok(Math.abs(tgtMap.fallback - E.mean(t0.rows.map(q => Number(q[2])))) < 1e-9);

  // Twelve levels or fewer still get a column each, with the most common one as reference.
  const small = { columns: ['Line', 'Y'], rows: E.range(60).map(i => ['L' + (i % 4), String(i)]) };
  const sp = E.profile(small);
  const senc = E.fitEncoder(sp.columns.filter(c => c.name === 'Line'), E.range(60), { y: E.range(60), task: 'regression' });
  assert.strictEqual(senc.parts[0].type, 'cat');
  assert.strictEqual(senc.labels.length, 3, 'four levels, three dummies');

  // With no target to lean on - the unsupervised path - only the frequency survives, since
  // there is no result to average.
  const unsup = E.fitEncoder(E.profile(t0).columns.filter(c => c.name === 'Strain'), E.range(200));
  assert.strictEqual(unsup.parts[0].maps.length, 1);
  assert.deepStrictEqual(unsup.parts[0].maps.map(m => m.kind), ['freq']);
});

/* Attribute agreement: the measurement-system question for a judgement rather than a
   measurement. Gage R&R cannot touch a visual inspector's accept/reject call - there is no
   number to take a variance of - and percent agreement, which is what people reach for
   instead, is actively misleading when the defect is rare. Both claims are measured here. */
test('attribute agreement separates a good inspector from a rubber stamp, which percent agreement cannot', () => {
  const study = (n, call) => {
    const rows = [];
    for (let i = 0; i < n; i++) {
      const truth = i % 10 === 0 ? 'reject' : 'accept';   // 10% truly defective
      for (const op of ['Ana', 'Ben']) for (const look of [0, 1]) {
        rows.push({ part: 'V' + i, operator: op, rating: call(truth, op, look, i), standard: truth });
      }
    }
    return rows;
  };

  // A perfect inspector: kappa 1 everywhere, and the figure a quality unit asks for is 100%.
  const perfect = VC.attributeAgreement(study(30, t => t), { seed: 3, reps: 200 });
  assert.strictEqual(perfect.withinAppraiser[0].kappa, 1);
  assert.strictEqual(perfect.betweenAppraisers.kappa, 1);
  assert.strictEqual(perfect.vsStandard[0].kappa, 1);
  assert.strictEqual(perfect.allVsStandard.pct, 1);
  assert.strictEqual(perfect.verdict, 'acceptable');
  assert.strictEqual(perfect.vsStandard[0].miss, 0);
  assert.strictEqual(perfect.vsStandard[0].falseAlarm, 0);

  /* The rubber stamp: passes every vial without looking. This is the case the whole method
     exists for, and the one an agreement percentage flatters. */
  const stamp = VC.attributeAgreement(study(30, () => 'accept'), { seed: 3, reps: 200 });
  const s0 = stamp.vsStandard[0];
  assert.ok(Math.abs(s0.pct - 0.9) < 1e-9, 'agreeing with a 10% defect rate by passing everything scores 90%: got ' + s0.pct);
  assert.strictEqual(s0.kappa, 0, 'and kappa must be 0, because that is agreement above guessing');
  assert.strictEqual(s0.miss, 1, 'every real defect was passed');
  assert.strictEqual(s0.falseAlarm, 0, 'and no good vial was ever rejected, which is why they look good on agreement');
  assert.strictEqual(stamp.verdict, 'inadequate');
  // The gap itself has to be said out loud, not left for the reader to notice.
  assert.ok(stamp.notes.some(t => /kappa of 0/.test(t) && /background/.test(t)),
    'the prevalence trap must be stated: ' + JSON.stringify(stamp.notes));
  assert.ok(stamp.notes.some(t => /called every sample/.test(t)), 'an appraiser using one call only must be named');

  /* Regression. Categories were first taken from the ratings alone, so this study - where
     every rating is "accept" - threw "only one call ever made" and refused to run. The one
     analysis that exposes a rubber stamp was the one that could not be performed. */
  assert.doesNotThrow(() => VC.attributeAgreement(study(12, () => 'accept'), { seed: 1, reps: 50 }));

  // Guessing at the right rate: agreement looks fine, kappa lands at zero where it belongs.
  let kSum = 0, trials = 300;
  for (let t = 0; t < trials; t++) {
    const r = E.rng(500 + t);
    const rows = study(40, () => (r() < 0.1 ? 'reject' : 'accept'));
    const a = VC.attributeAgreement(rows, { seed: 2, reps: 0 });
    kSum += a.vsStandard[0].kappa;
  }
  assert.ok(Math.abs(kSum / trials) < 0.05, 'ratings independent of the truth must average a kappa of 0, got ' + (kSum / trials).toFixed(3));

  /* A real inspector: sees most defects, occasionally over-calls. The two rates are not
     symmetric and a single agreement figure hides which way they lean. */
  const real = VC.attributeAgreement(study(60, (t, op, look, i) => {
    if (t === 'reject') return (i % 30 === 0 ? 'accept' : 'reject');       // misses some
    return (i % 17 === 0 && look === 1 ? 'reject' : 'accept');             // over-calls some
  }), { seed: 5, reps: 300 });
  const r0 = real.vsStandard[0];
  assert.ok(r0.kappa > 0.5 && r0.kappa < 0.95, 'a middling inspector must land between the extremes, got ' + r0.kappa);
  assert.ok(r0.miss > 0 && r0.falseAlarm > 0, 'both error directions must be reported separately');
  assert.ok(r0.miss !== r0.falseAlarm, 'and they are not the same number');
  // The bootstrap interval has to contain the estimate and be an interval, not a point.
  assert.ok(r0.lo < r0.kappa && r0.hi > r0.kappa, 'bootstrap interval must bracket the estimate: ' + r0.lo + '..' + r0.hi);
  assert.ok(real.withinAppraiser[0].kappa < 1, 'an inspector who changes their mind on a second look is not perfectly repeatable');

  // Honest refusals rather than numbers built on nothing.
  assert.throws(() => VC.attributeAgreement([{ part: 'A', operator: 'x', rating: 'pass' }, { part: 'B', operator: 'x', rating: 'fail' }]), /at least 3 samples/);
  assert.throws(() => VC.attributeAgreement(E.range(12).map(i => ({ part: 'V' + i, operator: 'x', rating: 'pass', standard: 'pass' }))), /nothing to agree/);
  // A standard on only some samples is dropped, and said to be dropped.
  const partial = VC.attributeAgreement(E.range(20).map(i => ({ part: 'V' + i, operator: 'x', rating: i % 3 ? 'pass' : 'fail', standard: i < 5 ? 'pass' : '' })), { seed: 1, reps: 50 });
  assert.strictEqual(partial.hasStandard, false);
  assert.ok(partial.notes.some(t => /partial standard flatters/.test(t)));
});

/* Charts for counted data, and the reason the textbook ones misfire on it. A Poisson chart
   assumes every vial carries the same underlying rate; particles cluster by lot, line and
   shift, so the rate itself moves and the real spread is wider than the square-root law
   allows. The cost of ignoring that is measured here rather than asserted. */
test('count charts measure overdispersion, and the textbook limits fire constantly without it', () => {
  const pois = (lam, r) => { const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; };
  const nz = r => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  /* Counts with a given mean and a given dispersion, built by letting the rate itself wander
     lognormally: var = m + m^2(e^s2 - 1), so dispersion phi = 1 + m(e^s2 - 1). */
  const series = (n, m, phi, r) => {
    const s2 = phi <= 1 ? 0 : Math.log(1 + (phi - 1) / m), s = Math.sqrt(s2);
    return E.range(n).map(() => pois(m * Math.exp(s * nz(r) - s2 / 2), r));
  };
  const sweep = (phi, trials) => {
    let pts = 0, plain = 0, widened = 0, phiSum = 0, facSum = 0;
    for (let t = 0; t < trials; t++) {
      const c = SPC.countChart(series(60, 16, phi, E.rng(1000 + t)));
      pts += 60; plain += c.signals.length; widened += c.laney.signals.length;
      phiSum += c.dispersion; facSum += c.factor;
    }
    return { measured: phiSum / trials, factor: facSum / trials, plain: plain / pts, widened: widened / pts };
  };

  // Dispersion is estimated accurately across the range.
  const at1 = sweep(1, 200), at3 = sweep(3, 200), at5 = sweep(5, 150);
  assert.ok(Math.abs(at1.measured - 1) < 0.1, 'Poisson counts must measure a dispersion of 1, got ' + at1.measured.toFixed(2));
  assert.ok(Math.abs(at3.measured - 3) < 0.3, 'got ' + at3.measured.toFixed(2) + ' for true 3');
  assert.ok(Math.abs(at5.measured - 5) < 0.6, 'got ' + at5.measured.toFixed(2) + ' for true 5');

  /* When the counts really are Poisson the correction is near 1 and costs nothing, which is
     what makes it safe to apply by default. */
  assert.ok(at1.factor < 1.15, 'no widening when none is needed, got x' + at1.factor.toFixed(2));
  assert.ok(at1.plain < 0.01, 'and the textbook chart behaves on Poisson counts: ' + (at1.plain * 100).toFixed(2) + '%');

  /* The measured cost of ignoring overdispersion. At a dispersion of 3 - ordinary for
     particle counts - the textbook chart flags about one point in sixteen from a process
     with nothing wrong with it, which is roughly four false signals on a sixty-point chart.
     Widened, that falls to about one in ninety. */
  assert.ok(at3.plain > 0.04, 'textbook chart must misfire badly at phi 3, got ' + (at3.plain * 100).toFixed(2) + '%');
  assert.ok(at3.widened < at3.plain / 3, 'widening must cut it several-fold: ' + (at3.plain * 100).toFixed(2) + '% to ' + (at3.widened * 100).toFixed(2) + '%');
  assert.ok(at5.plain > 0.08, 'and it gets worse, not better, as clustering grows: ' + (at5.plain * 100).toFixed(2) + '%');
  // Measured: phi 1 -> 0.31% vs 0.21%; phi 2 -> 2.99% vs 0.72%; phi 3 -> 6.25% vs 1.07%; phi 5 -> 11.78% vs 1.63%.

  /* And the honest other side: widening costs sensitivity. A 60% sustained rise in the last
     third of the chart is caught on most charts but not all. The textbook chart catches it
     every time - while flagging one in sixteen in-control points, so that is not a fair
     hundred percent, it is a chart that flags nearly anything. */
  let caught = 0, trials = 200;
  for (let t = 0; t < trials; t++) {
    const r = E.rng(7000 + t);
    const c = SPC.countChart(series(40, 16, 3, r).concat(series(20, 26, 3, r)));
    if (c.laney.signals.some(s => s.i >= 40)) caught++;
  }
  assert.ok(caught / trials > 0.5, 'the widened chart must still see a real shift, got ' + Math.round(100 * caught / trials) + '%');

  // The recommendation follows the measurement rather than a preference.
  const clustered = SPC.countChart(series(60, 16, 4, E.rng(11)));
  assert.strictEqual(clustered.use, 'c-prime');
  assert.ok(/times as much as a Poisson model allows/.test(clustered.why));
  const tame = SPC.countChart(series(60, 16, 1, E.rng(11)));
  assert.strictEqual(tame.use, 'c');
  assert.ok(/behave as a Poisson model expects/.test(tame.why));

  /* A p-chart's limits move with how many units were looked at - the whole point of it.
     Inspect 50 vials and the band is wide; inspect 5,000 and it is narrow. */
  const units = [50, 5000, 50, 5000, 200, 200, 1000, 1000, 50, 5000];
  const p = SPC.countChart(units.map(u => Math.round(u * 0.02)), { units, kind: 'p' });
  assert.ok(Math.abs(p.centre - 0.02) < 0.002);
  assert.ok(p.upper[0] > p.upper[1] * 3, 'a 50-vial point must have a far wider band than a 5,000-vial one');
  assert.ok(p.lower.every(v => v >= 0) && p.upper.every(v => v <= 1), 'a proportion cannot leave 0 to 1');

  // u-chart: defects per unit, where a unit can hold several.
  const un = [10, 10, 20, 20, 5, 5, 10, 20, 10, 5];
  const u = SPC.countChart([12, 9, 25, 18, 7, 4, 11, 22, 8, 6], { units: un });
  assert.strictEqual(u.kind, 'u');
  assert.ok(Math.abs(u.centre - 122 / 115) < 1e-9);

  /* Nothing has ever happened: the limits collapse onto zero, and a chart that would flag
     the first event as a signal is arithmetic rather than evidence. Said, not drawn. */
  const none = SPC.countChart(E.range(12).map(() => 0));
  assert.strictEqual(none.signals.length, 0);
  assert.ok(/no rate to set limits around/.test(none.why));

  // Refusals: a count is not a measurement, and a gap is not a zero.
  assert.throws(() => SPC.countChart([1, 2, 3.5, 4, 5, 6, 7, 8]), /whole numbers/);
  assert.throws(() => SPC.countChart([1, 2, 3, 4, 5, 6, 7, null]), /missing count is not a zero/);
  assert.throws(() => SPC.countChart([1, 2, 3]), /at least 8 points/);
  assert.throws(() => SPC.countChart([1, 2, 3, 4, 5, 6, 7, 8], { units: [1, 2], kind: 'p' }), /one size per point/);
  assert.throws(() => SPC.countChart([9, 2, 3, 4, 5, 6, 7, 8], { units: [5, 5, 5, 5, 5, 5, 5, 5], kind: 'p' }), /cannot exceed the number inspected/);
});

/* One playbook per function, at the depth a group actually arrives wanting: what to do
   first and why, the order after that, the measured cost of skipping a step, and the gaps
   named rather than softened. The lists elsewhere in applications.js answer "what is this
   used for"; none of them answers "I run this group, what do I do first, and where will
   this let me down". These assertions are about that difference. */
test('every function has a playbook with an order, a measured figure and its gaps named', () => {
  const apps = require(path.join(ROOT, 'applications.js'));
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const selector = (html.match(/<select id="tool">([\s\S]*?)<\/select>/) || [])[1] || '';
  const tools = [...selector.matchAll(/<option value="([a-z]+)"/g)].map(m => m[1]);
  const pb = apps.PLAYBOOKS;
  assert.ok(pb, 'the playbooks must be exported, or the panel cannot render them');

  for (const [key, label] of apps.FUNCTIONS) {
    const p = pb[key];
    assert.ok(p, 'no playbook for ' + label);
    // A headline that states the hard problem, not a restatement of the function name.
    assert.ok(p.headline && p.headline.length > 70, key + ': the headline is too thin');
    // What to do FIRST, and why it comes first: the ordering is the point of a playbook.
    assert.ok(p.first && p.first.label && p.first.why, key + ': needs a first step with a reason');
    assert.ok(p.first.why.length > 120, key + ': the reason for starting there is too thin to be useful');
    assert.ok(tools.includes(p.first.tool), key + ': first step routes to "' + p.first.tool + '", which is not a tool');

    assert.ok(p.steps.length >= 4, key + ': only ' + p.steps.length + ' steps');
    for (const st of p.steps) {
      assert.ok(tools.includes(st.tool), key + ': step "' + st.label + '" routes to "' + st.tool + '", which is not a tool');
      assert.ok(st.label && st.does && st.does.length > 80, key + ': step "' + st.label + '" says too little about what it does');
      /* Every step must say where it stops. This is the field the whole structure exists
         for: a group that discovers the third limitation on its own stops believing the
         first two. */
      assert.ok(st.limit && st.limit.length > 60, key + ': step "' + st.label + '" does not say where it stops');
      if (st.measured) assert.ok(/\d/.test(st.measured), key + ': a "measured" claim with no number in it is not measured');
    }
    // At least one figure per playbook, because a warning with a number gets acted on.
    assert.ok(p.steps.some(st => st.measured), key + ': no measured figure anywhere in the playbook');
    assert.ok(p.gaps.length >= 3, key + ': only ' + p.gaps.length + ' gaps named');
    for (const g of p.gaps) assert.ok(g.length > 40, key + ': gap "' + g + '" is too vague to be honest');
  }

  /* The guard that matters most, and the same one the department benches carry: this page
     has no language model, and a quality group told it drafts their deviation report would
     find out otherwise at the worst possible moment. */
  const qa = pb.qa;
  const qaText = JSON.stringify(qa).toLowerCase();
  assert.ok(/does not write/.test(qaText) && /no language model/.test(qaText),
    'the quality playbook must say plainly that it does not write documents');
  assert.ok(!/\b(writes|drafts|generates) (your |the )?(deviation|capa|report|narrative)/.test(qaText),
    'nothing may claim to author a document: ' + qaText.slice(0, 200));

  /* Nothing may promise to read what the page cannot take. Every playbook is checked, not
     just the ones where images are an obvious temptation.

     The guard has to allow the denial while catching the claim, and the first version did
     not: "the page does not read traces" is exactly the sentence we want these files to
     contain, and it tripped the check. A guard that fires on the honest wording and the
     dishonest one equally is not a guard, so the negation is excluded explicitly - and
     then the check is run against a sentence built to trip it, because a guard nobody has
     seen fail is a guard nobody knows works. */
  const READS = /(?:\b(?:does ?n[o']t|do ?n[o']t|cannot|can ?not|never|no|without|neither|nor)\b[^.]{0,40})?\b(reads?|analyses?|analyzes?|interprets?) (?:the )?(image|picture|photo|chromatogram|spectra|spectrum|trace)s?\b/gi;
  const overclaims = text => {
    const hits = [];
    for (const m of String(text).matchAll(READS)) {
      // Group 1 present means a negator was swallowed ahead of the verb: a denial, not a claim.
      if (!/\b(?:does ?n[o']t|do ?n[o']t|cannot|can ?not|never|no|without|neither|nor)\b/i.test(m[0])) hits.push(m[0]);
    }
    return hits;
  };
  assert.deepStrictEqual(overclaims('It reads chromatograms and ranks the peaks.'), ['reads chromatograms'],
    'the guard must catch a plain claim, or it proves nothing below');
  assert.deepStrictEqual(overclaims('The page does not read chromatograms.'), [],
    'and must not fire on the denial, which is the wording these files are supposed to use');
  for (const key of Object.keys(pb)) {
    const hits = overclaims(JSON.stringify(pb[key]));
    assert.deepStrictEqual(hits, [], key + ' claims to read something this page does not take: ' + hits.join('; '));
  }
  // And the ones where the temptation is real must say so outright.
  for (const key of ['cld', 'dspd', 'afs', 'qc']) {
    assert.ok(/image|chromatogram|spectra|instrument file|pictures/i.test(JSON.stringify(pb[key].gaps)),
      key + ' must name what it cannot read, since its data usually starts as something it cannot read');
  }

  // The panel has to render it, and the measured-figure caveat has to reach the reader.
  assert.ok(/PLAYBOOKS/.test(app), 'app.js must read the playbooks');
  assert.ok(/own test suite/.test(app), 'the panel must say the figures are measured by the test suite rather than quoted');
  assert.ok(/Where it stops/.test(app), 'the panel must print the limits, not just carry them in the data file');
});

/* Withholding the tail figures when the shape is wrong is correct, and it is still a dead
   end: a QC group that has to write a specification this week is left with Cp, Cpk and a
   count. Two ways out, both measured here - transform to a scale where the shape is normal,
   or drop the distribution entirely and pay for it in sample size. */
test('a Box-Cox transform recovers the tail figures that skew destroys, and refuses when it cannot', () => {
  const nz = r => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  /* A right-skewed impurity, which is what impurities, aggregates and particulates actually
     look like. The limit is placed at the TRUE 99.9th percentile, so the real out-of-spec
     rate is 1,000 PPM by construction and any estimate can be scored against it. */
  const mu = Math.log(0.5), sg = 0.55;
  const usl = Math.exp(mu + sg * (-SPC.normInv(0.001)));
  let raw = 0, bc = 0, usable = 0, lambdas = [];
  const trials = 150;
  for (let t = 0; t < trials; t++) {
    const r = E.rng(400 + t);
    const y = E.range(300).map(() => Math.exp(mu + sg * nz(r)));
    const c = SPC.capability(y, { usl }, false);
    raw += c.ppm;
    assert.strictEqual(c.tailsUsable, false, 'lognormal data must fail the normality test');
    assert.ok(c.nonNormal, 'and the transform must then be offered');
    if (c.nonNormal.usable) { usable++; bc += c.nonNormal.ppm; lambdas.push(c.nonNormal.lambda); }
  }
  const rawPpm = raw / trials, bcPpm = bc / Math.max(1, usable);
  /* The normal fit on raw skewed data does not merely err, it reports no risk at all: a
     tail probability from the wrong distribution is wrong by orders of magnitude, and here
     it rounds to zero against a true 1,000. */
  assert.ok(rawPpm < 50, 'the raw normal fit should collapse to near zero, got ' + Math.round(rawPpm));
  assert.ok(usable / trials > 0.9, 'the transform should work on lognormal data nearly always, got ' + Math.round(100 * usable / trials) + '%');
  // And the transformed estimate lands on the right order of magnitude.
  assert.ok(bcPpm > 300 && bcPpm < 4000, 'transformed estimate should be near the true 1,000 PPM, got ' + Math.round(bcPpm));
  // Measured: 0 PPM raw, 1,322 PPM transformed, against a true 1,000. Lambda lands on 0, the log.
  const medLam = lambdas.sort((a, b) => a - b)[Math.floor(lambdas.length / 2)];
  assert.ok(Math.abs(medLam) < 0.15, 'lambda should land on the log for lognormal data, got ' + medLam);

  /* The discipline that makes it honest: normality is tested AGAIN after transforming, and
     a transform that did not work is not a licence to report. No power of a two-humped
     variable is bell-shaped, so this must stay withheld. */
  const r2 = E.rng(9);
  const bimodal = E.range(300).map((_, i) => (i % 2 ? 2 + 0.15 * nz(r2) : 8 + 0.15 * nz(r2)));
  const bm = SPC.capability(bimodal, { usl: 9 }, false);
  assert.strictEqual(bm.tailsUsable, false);
  assert.strictEqual(bm.nonNormal.usable, false, 'a transform must not rescue a bimodal distribution');
  assert.ok(/not a licence to report/.test(bm.nonNormal.why));

  // Data that passed its normality test is not offered a transform at all, so there are
  // never two sets of tail figures to pick the friendlier one from.
  const r3 = E.rng(21);
  const normal = SPC.capability(E.range(200).map(() => 100 + 2 * nz(r3)), { lsl: 94, usl: 106 }, false);
  assert.strictEqual(normal.tailsUsable, true);
  assert.strictEqual(normal.nonNormal, null, 'no competing figures when the raw data is fine');

  // Honest refusals rather than a silent shift.
  const withZero = SPC.capability(E.range(40).map((_, i) => (i === 0 ? 0 : i / 10)), { usl: 5 }, false);
  if (withZero.nonNormal) assert.ok(/above zero/.test(withZero.nonNormal.why), 'zero values must be refused with a reason');
  const lowLsl = SPC.nonNormalTail(E.range(40).map(i => 1 + i / 10), 0, 10);
  assert.strictEqual(lowLsl.usable, false);
  assert.ok(/at or below zero/.test(lowLsl.why));
});

test('a distribution-free tolerance bound assumes nothing, and says what that costs in samples', () => {
  /* The classic sample sizes, which are a property of the arithmetic rather than of any
     dataset, so they are exact and worth pinning. 299 for a one-sided 99% claim at 95%
     confidence is the number that surprises people: the normal-theory factor does it on
     about ten results by assuming a shape. */
  assert.strictEqual(TOL.nonParametricN(0.99, 0.95, 1), 299);
  assert.strictEqual(TOL.nonParametricN(0.99, 0.95, 2), 473);
  assert.strictEqual(TOL.nonParametricN(0.95, 0.95, 1), 59);
  assert.strictEqual(TOL.nonParametricN(0.90, 0.95, 1), 29);

  // The binomial tail behind it, checked against a hand-computable case.
  assert.ok(Math.abs(TOL.binomCdf(0, 10, 0.5) - Math.pow(0.5, 10)) < 1e-12);
  assert.ok(Math.abs(TOL.binomCdf(10, 10, 0.5) - 1) < 1e-12);
  assert.ok(Math.abs(TOL.binomCdf(5, 10, 0.5) - 0.623046875) < 1e-9);

  /* The claim that matters: the coverage holds whatever the measurements are distributed
     like, because only the ranking is used. Checked on three shapes that break the normal
     factor - a long right tail, an exponential, and a bounded uniform - by asking how often
     the bound really does sit above the population's 99th percentile. */
  const nz = r => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const shapes = {
    lognormal: { draw: r => Math.exp(0.6 * nz(r)), q99: Math.exp(0.6 * (-SPC.normInv(0.01))) },
    exponential: { draw: r => -Math.log(Math.max(1e-12, r())), q99: -Math.log(0.01) },
    uniform: { draw: r => r() * 10, q99: 9.9 }
  };
  for (const [name, sh] of Object.entries(shapes)) {
    let held = 0, trials = 400;
    for (let t = 0; t < trials; t++) {
      const r = E.rng(9000 + t);
      const xs = E.range(299).map(() => sh.draw(r));
      const b = TOL.nonParametric(xs, 0.99, 0.95, 1);
      assert.strictEqual(b.achievable, true, name + ': 299 results must reach the claim');
      if (b.upper >= sh.q99) held++;
    }
    const cover = held / trials;
    /* The bound is built to hold at least 95% of the time. It is conservative by
       construction - the achieved confidence at n=299 is a shade over 95% - so the
       measured rate sits above the nominal, never below it. */
    assert.ok(cover >= 0.93, name + ': coverage fell to ' + (cover * 100).toFixed(1) + '%, below the 95% claimed');
    assert.ok(cover <= 1.0, name + ': ' + (cover * 100).toFixed(1) + '%');
  }

  /* What it does on a realistic QC dataset, which is the honest bad news: thirty results
     cannot carry a 99% claim without assuming a shape, and the tool says how many would
     rather than quietly producing a number. */
  const r = E.rng(5);
  const small = TOL.nonParametric(E.range(30).map(() => Math.exp(0.5 * nz(r))), 0.99, 0.95, 1);
  assert.strictEqual(small.achievable, false);
  assert.strictEqual(small.nNeeded, 299);
  assert.ok(small.achieved < 0.3, 'thirty results reach only ' + (small.achieved * 100).toFixed(1) + '%');
  assert.ok(/No distribution was assumed/.test(small.note), small.note);

  // A looser claim the same thirty results CAN carry, so the answer is not always no.
  const r6 = E.rng(6);
  const looser = TOL.nonParametric(E.range(30).map(() => Math.exp(0.5 * nz(r6))), 0.90, 0.95, 1);
  assert.strictEqual(looser.achievable, true);
  assert.ok(looser.upper !== null && looser.rank >= 1);

  /* Two-sided uses both ends, and the interval must actually bracket. The generator is
     built once on purpose: seeding inside the map gave 500 identical values, and the bound
     correctly collapsed to a single point - which is the right answer for constant data and
     a broken test. */
  const r7 = E.rng(7);
  const two = TOL.nonParametric(E.range(500).map(() => 50 + 5 * nz(r7)), 0.99, 0.95, 2);
  assert.strictEqual(two.achievable, true);
  assert.ok(two.lower < two.upper, 'the two-sided interval must bracket: ' + two.lower + ' to ' + two.upper);
  assert.ok(two.achieved >= 0.95);
  // Constant data is not a failure of the method: the bound is that constant, both ends.
  const flat = TOL.nonParametric(E.range(500).map(() => 7), 0.99, 0.95, 2);
  assert.strictEqual(flat.lower, 7);
  assert.strictEqual(flat.upper, 7);

  // Nothing can be bounded from one result, and it says so rather than returning it.
  assert.strictEqual(TOL.nonParametric([1], 0.99, 0.95, 1).achievable, false);
});

/* One panel, not two. "Start from my job, not the method" and "Where this is used" asked
   the same question - which group are you in - in two different selects, and then answered
   two halves of it in two places, with the method you had just read about reachable only by
   going back to the technique selector and hunting for its name. Merged, the choice is made
   once and every method is a button. */
test('the applications panel is one panel, and every method in it opens from the application', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const apps = require(path.join(ROOT, 'applications.js'));
  const depts = require(path.join(ROOT, 'departments.js'));

  // The old second section is gone, from the page and from the code.
  assert.ok(html.indexOf('id="tool-depts"') < 0, 'the separate department section must be removed from the page');
  assert.ok(!/renderDepartments/.test(app), 'and its renderer with it, or it is dead code waiting to be called');
  assert.ok(/id="tool-apps"/.test(html), 'the surviving panel must still be on the page');
  assert.ok((html.match(/id="tool-apps"/g) || []).length === 1, 'and on the page exactly once');

  // One heading, and it is the one that was asked for.
  assert.ok(/Where this can be used/.test(app), 'the merged panel must carry the combined heading');
  assert.ok(!/Start from my job, not the method/.test(app), 'the old heading must not survive in the renderer');

  /* Nothing is orphaned by the merge. Every bench either hangs off a function, or appears
     in the same picker under its own heading - otherwise a department quietly disappears. */
  const fns = apps.FUNCTIONS.map(f => f[0]);
  for (const b of depts) {
    const reachable = (b.fn && fns.includes(b.fn));
    assert.ok(reachable || !b.fn, b.name + ' points at function "' + b.fn + '", which is not in the list');
  }
  assert.ok(/Other ways in/.test(app), 'benches with no function of their own need their own group in the picker');
  assert.ok(/bench:/.test(app), 'and a value the picker can route on');

  /* The point of the merge: having said which group you are in, every method is listed with
     what it does for that group and a button that opens it. */
  assert.ok(/function methodsHtml/.test(app), 'the per-group method list must exist');
  assert.ok(/data-open-tool/.test(app), 'each method needs a button that opens it');
  assert.ok(/BYFUNCTION/.test(app), 'and the line it shows must be the per-function one, not the generic blurb');
  // Both other routes out still work: a job card, and a playbook step.
  assert.ok(/data-dept-go/.test(app) && /data-dept-sample/.test(app), 'job cards must still route, with practice data where it exists');
  assert.ok(/\.pb-go/.test(app), 'playbook steps must still route');

  /* Every function must have a line for at least most of the methods, or the list renders
     nearly empty for that group and the panel looks broken rather than honest. */
  const tools = Object.keys(apps).filter(k => /^[a-z]+$/.test(k) && apps[k] && apps[k].groups);
  for (const f of fns) {
    const have = tools.filter(t => apps.BYFUNCTION[t] && apps.BYFUNCTION[t][f]);
    assert.ok(have.length >= tools.length - 1, f + ' has lines for only ' + have.length + ' of ' + tools.length + ' methods');
  }

  // The scope caveat has to survive the rewrite: it is what stops a reader assuming the
  // page reads images or audio.
  assert.ok(/not a claim about what this page reads/.test(app), 'the scope caveat must still be printed');
});

/* The loop tab. One pass answers a question; four passes change a process, and the method
   is cheap to print - so the part that has to be right is the stopping panel, which reads
   the run in memory rather than reprinting the advice. */
test('the loop tab names the phase you are on, and its exit criteria read the live run', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');

  // The tab exists, is addressable, and the page is a real page rather than a section.
  assert.ok(/id="page-btn-how"/.test(html), 'the tab button must exist');
  assert.ok(/<div class="page" id="page-how"/.test(html), 'and a page of its own');
  assert.ok(/'how', hash: 'how-to-use-this'/.test(app), 'the page needs an address, or it cannot be linked');

  /* Four phases, drawn rather than listed. The diagram is decorative, so the phases also
     exist as text - a loop nobody can read is not an explanation. */
  assert.strictEqual((html.match(/class="cyc-node"/g) || []).length, 4, 'four nodes in the loop');
  assert.strictEqual((html.match(/class="cyc-arc"/g) || []).length, 4, 'and four arrows, or it does not close');
  for (const label of ['Discover', 'Disentangle', 'Refine', 'Converge']) {
    assert.ok(html.indexOf('>' + label + '<') >= 0, label + ' must be labelled on the diagram');
    assert.ok(app.indexOf("'" + label + "'") >= 0, label + ' must also exist as a phase in the renderer');
  }
  // The SVG carries a text alternative, since it is the whole point of the page.
  assert.ok(/aria-label="A four-phase closed loop/.test(html), 'the diagram needs a description for a screen reader');
  /* Inline styles are blocked by the page's own security policy, so the diagram must be
     styled by class and attribute. A style= on it would render unstyled in the browser
     while passing every test here. */
  const svg = html.slice(html.indexOf('<svg class="cycle"'), html.indexOf('</svg>', html.indexOf('<svg class="cycle"')));
  assert.ok(svg.indexOf('style=') < 0, 'the diagram must not use inline styles: the CSP blocks them');
  assert.ok(/\.cyc-node\b/.test(css) && /\.cyc-arc\b/.test(css), 'and the classes it uses must be styled');

  /* The class names must not collide with anything already on the page. They did: .phase
     was already the DMAIC chip in the next-steps list, so the loop cards restyled it. */
  assert.ok(!/class="phase'/.test(app), 'the loop cards must not reuse .phase, which is the DMAIC chip');
  assert.ok(/loop-step/.test(app) && /\.loop-step\b/.test(css), 'they use their own class, and it is styled');

  // Three exit criteria, each with a live reading and a stated source.
  assert.ok(/The goal is met/.test(app) && /Error has plateaued/.test(app) && /The process is capable/.test(app),
    'all three criteria must be rendered');
  assert.ok(/MLCampaignRun/.test(app), 'the plateau gate must read the campaign, not a rule of thumb about round counts');
  const campUi = fs.readFileSync(path.join(ROOT, 'campaign-ui.js'), 'utf8');
  assert.ok(/window\.MLCampaignRun\s*=/.test(campUi), 'and the campaign panel must publish it, or the gate never fires');
  assert.ok(/MLCampaignRun = null/.test(campUi), 'and clear it on reset, or a stale projection outlives the data');
  /* 1.33 is a convention, not a regulation, and the panel has to say so. The same applies
     to the capability figures it leans on when the data is not normal. */
  assert.ok(/1\.33 bar is the industry convention/.test(app), 'the Cpk bar must be named as a convention');
  assert.ok(/forecast rather than a plateau/.test(app),
    'a plateau projected from one round must be marked as a forecast: concluding that experimenting will not pay before any experiment has run is the wrong answer to hand somebody');
  // Nothing is stored, and the panel says so where somebody might assume otherwise.
  assert.ok(/Nothing is stored, so they reset/.test(app), 'the gates read session memory and must say so');

  // The tool page gained the loop in one line and three words per pillar, not an essay.
  assert.ok(/class="pillars"/.test(html), 'the hero needs the three-step strip');
  const hero = html.slice(html.indexOf('<section class="hero">'), html.indexOf('</section>', html.indexOf('<section class="hero">')));
  for (const p of ['Learn', 'Test', 'Perfect']) assert.ok(hero.indexOf('<b>' + p + '</b>') >= 0, p + ' pillar missing');
  const pillarText = (hero.match(/<span>([^<]*)<\/span>/g) || []).map(x => x.replace(/<\/?span>/g, ''));
  assert.strictEqual(pillarText.length, 3);
  for (const t of pillarText) assert.ok(t.split(/\s+/).length <= 8, 'a pillar must stay a label, not a paragraph: "' + t + '"');
  assert.ok(/id="hero-how"/.test(html), 'and a way through to the loop from the tool page');
});

/* A particle characterization core's main judgement is not pass or fail, it is which of
   several things this particle is - proteinaceous, silicone oil, fibre, glass. That is a
   multi-category agreement problem, and the binary machinery does not all carry over. What
   survives and what does not is asserted here, because the playbook quotes both. */
test('agreement works on a multi-category call, and says which binary figures do not carry over', () => {
  const types = ['protein', 'silicone', 'fibre', 'glass'];
  const build = (disagree, seed) => {
    const r = E.rng(seed), rows = [];
    for (let i = 0; i < 40; i++) {
      const truth = types[i % 4];
      for (const who of ['A1', 'A2', 'A3']) for (const look of [0, 1]) {
        rows.push({ part: 'P' + i, operator: who, rating: (r() < disagree ? types[Math.floor(r() * 4)] : truth), standard: truth });
      }
    }
    return rows;
  };
  const a = VC.attributeAgreement(build(0.15, 11), { seed: 3, reps: 300 });
  assert.deepStrictEqual(a.categories, ['fibre', 'glass', 'protein', 'silicone'], 'all four calls must be carried');
  assert.strictEqual(a.binary, false, 'four categories is not a binary call');

  // Fleiss' kappa across analysts, and Cohen's against the standard, both work for four categories.
  assert.ok(a.betweenAppraisers.kappa > 0.6 && a.betweenAppraisers.kappa < 0.78,
    'measured at about 0.69 for 15% disagreement, got ' + a.betweenAppraisers.kappa.toFixed(3));
  /* And 0.69 is "inadequate" on the bands this tool uses, not "marginal" - the content first
     claimed marginal, which is a kinder word than the arithmetic supports. */
  assert.strictEqual(a.betweenAppraisers.verdict, 'inadequate', 'under 0.70 is inadequate on these bands');
  for (const v of a.vsStandard) {
    assert.ok(v.kappa > 0.6 && v.kappa < 0.95, v.operator + ' kappa ' + v.kappa);
    /* The part that does NOT carry over, and the playbook says so: with four categories
       there is no single thing being missed, so a miss rate and a false alarm rate are not
       defined. Null here rather than a number that would read as "no misses". */
    assert.strictEqual(v.miss, null, 'a miss rate is binary only');
    assert.strictEqual(v.falseAlarm, null, 'and so is a false alarm rate');
  }
  /* Where the flattery actually is: each analyst's agreement with the standard reads about
     84% while its kappa is lower, and the between-analyst kappa is lower again. The
     between column's percentage is NOT the comparable figure - it is the share of samples
     where every single rating agreed, a stricter quantity than kappa, and asserting it the
     other way round was my own misreading of the column. */
  for (const v of a.vsStandard) assert.ok(v.pct > v.kappa, v.operator + ': agreement ' + v.pct.toFixed(3) + ' must flatter kappa ' + v.kappa.toFixed(3));
  // Measured at 83.8%, 90.0% and 90.0%: "about 84%" was true of one analyst, not three.
  assert.ok(a.vsStandard.every(v => v.pct >= 0.83 && v.pct <= 0.91),
    'agreement with the standard measures 84 to 90%: ' + a.vsStandard.map(v => (v.pct * 100).toFixed(1)).join(', '));
  assert.ok(a.betweenAppraisers.pct < a.betweenAppraisers.kappa,
    'the all-agreed share is stricter than kappa here (' + a.betweenAppraisers.pct.toFixed(3) + ' against ' + a.betweenAppraisers.kappa.toFixed(3) + ')');

  // Perfect classification on four categories still reads as perfect.
  const perfect = VC.attributeAgreement(build(0, 12), { seed: 3, reps: 100 });
  assert.strictEqual(perfect.betweenAppraisers.kappa, 1);
  assert.strictEqual(perfect.verdict, 'acceptable');

  /* And the guard: nine categories is a measurement wearing a judgement's clothes, and the
     method is refused with a reason rather than applied to it. */
  const many = [];
  for (let i = 0; i < 20; i++) for (const who of ['A1', 'A2']) many.push({ part: 'P' + i, operator: who, rating: 'type' + (i % 9) });
  assert.throws(() => VC.attributeAgreement(many), /not a measurement/);
});

/* The department evaluation is a handover document, and a handover document that drifts
   from the thing it describes is worse than none: it gets quoted in a meeting six months
   after the gap was closed. So every gap in it is quoted verbatim from the tool's own
   content, and this is what keeps that true. */
test('the gap evaluation quotes the tool rather than describing it, and covers every department', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'GAPS.md'), 'utf8');
  const apps = require(path.join(ROOT, 'applications.js'));

  for (const [key, label] of apps.FUNCTIONS) {
    assert.ok(doc.indexOf('### ' + label) >= 0, label + ' has no section in the evaluation');
    /* Verbatim, not paraphrased. A paraphrase is where a document starts being wrong: the
       gap gets softened in the retelling and nobody notices it no longer matches. */
    for (const gap of apps.PLAYBOOKS[key].gaps) {
      assert.ok(doc.indexOf(gap) >= 0, label + ': this gap is not quoted in the evaluation, or has been reworded:\n  ' + gap);
    }
  }
  // Every gap carries a class, because the class is what decides who pays for the work.
  const bullets = doc.match(/^- \*\*\[[^\]]+\]\*\* /gm) || [];
  const gapCount = apps.FUNCTIONS.reduce((n, [k]) => n + apps.PLAYBOOKS[k].gaps.length, 0);
  assert.strictEqual(bullets.length, gapCount,
    'every gap must appear exactly once with a class: ' + bullets.length + ' bullets against ' + gapCount + ' gaps');
  assert.ok(!/\*\*\[\?\]\*\*/.test(doc), 'no gap may be left unclassified');

  // The three classes have to be defined, or the letters are decoration.
  for (const c of ['A — buildable', 'B — architectural', 'C — somebody else']) {
    assert.ok(doc.indexOf(c) >= 0, 'class "' + c + '" is used but not defined');
  }

  /* The rare-event chart was the headline recommendation and is now built, so no department
     may still be told it is missing, and the table has to say it was delivered. */
  const rare = apps.FUNCTIONS.filter(([k]) => apps.PLAYBOOKS[k].gaps.some(g => /rare-event chart/.test(g)));
  assert.strictEqual(rare.length, 0, 'the rare-event chart is built, but ' + rare.length + ' department(s) still name it as a gap');
  assert.ok(/\*\*Delivered\.\*\*/.test(doc), 'the priority table must record what has been delivered');
  assert.ok(/What has been delivered since this evaluation was first written/.test(doc),
    'a handover document has to say which of its own recommendations are already done');

  /* The PICTS answer is a recommendation against integrating, and the reason is the privacy
     guarantee. If that guarantee ever stops being true the recommendation has to be revisited,
     so the lint that enforces it is named here on purpose. */
  assert.ok(/PICTS/.test(doc), 'the PICTS question must be answered in the handover');
  assert.ok(/nothing leaves this browser/.test(doc) || /nothing can be sent anywhere/.test(doc),
    'and the answer must rest on the guarantee, not on taste');
});

/* Two failures that a unit test cannot see but a user meets immediately, both of which I
   shipped into this file's own history before catching them in a browser:

     1. howTo(key) reads X.READ[key] and dereferences it. An unknown key throws, and because
        the render is inside a try/catch the whole results section comes back empty with a
        one-line message. A new card with a new help key is exactly when this happens.
     2. rep.spc.capability only exists when specification limits were given. Reaching through
        it unguarded took out the entire Six Sigma section for anybody who left them blank -
        which is the documented default, since the panel says the limits are optional.

   Neither is caught by testing the statistics, because neither is in the statistics. */
test('every help key the page asks for exists, and the optional blocks are reached safely', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const X = require(path.join(ROOT, 'explain.js'));

  /* The keys arrive two ways: howTo('x') directly, and as card()'s fourth argument. The
     second needs the call split properly, because the third argument is a long HTML
     expression full of brackets and quotes - a regex over it finds the wrong string. */
  const keys = Array.from(app.matchAll(/howTo\(\s*'([^']+)'/g)).map(m => m[1]);
  const argsOf = (src, at) => {
    let i = at, depth = 0, quote = null, arg = '', out = [];
    for (; i < src.length; i++) {
      const ch = src[i], prev = src[i - 1];
      if (quote) { arg += ch; if (ch === quote && prev !== '\\') quote = null; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; arg += ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      if (ch === ')' || ch === ']' || ch === '}') { depth--; if (depth === 0) { out.push(arg); return out; } }
      if (ch === ',' && depth === 1) { out.push(arg); arg = ''; continue; }
      arg += ch;
    }
    return out;
  };
  for (const m of app.matchAll(/\bcard\(/g)) {
    const args = argsOf(app, m.index + 4);
    const fourth = (args[3] || '').trim();
    const lit = fourth.match(/^'([a-zA-Z][\w-]*)'$/);
    if (lit) keys.push(lit[1]);
  }
  assert.ok(keys.length > 10, 'expected the page to ask for a good few help topics, found ' + keys.length);
  // And the page must survive a key that is missing anyway, rather than blanking the section.
  assert.ok(/if \(!r\) return ''/.test(app), 'howTo must degrade to no help box rather than throwing');
  for (const k of new Set(keys)) {
    assert.ok(X.READ[k], 'app.js asks for help topic "' + k + '", which explain.js does not have. ' +
      'howTo dereferences it, so this throws and empties the whole results section.');
    const r = X.READ[k];
    assert.ok(Array.isArray(r) && r.length === 3, k + ': a help entry is [text, analogy, learn link]');
    assert.ok(r[0].length > 60 && r[1].length > 20, k + ': the text or the analogy is too thin to help');
  }

  /* Anything on the report that is only sometimes present must be reached through a guard.
     These are the fields that depend on a setting the user may not have filled in. */
  const optional = ['capability', 'counts', 'imr', 'taguchi', 'boxes', 'attribute'];
  for (const field of optional) {
    // A bare `s.<field>.` with no preceding guard in the same expression is the bug shape.
    const bad = new RegExp('(?<![&|?]\\\\s{0,3})\\\\bs\\\\.' + field + '\\\\.', 'g');
    const hits = Array.from(app.matchAll(bad)).map(m => m.index);
    for (const at of hits) {
      const line = app.slice(app.lastIndexOf('\n', at) + 1, app.indexOf('\n', at));
      assert.ok(/if \(s\.|s\.\w+ &&|\? |: |\|\|/.test(line),
        'app.js dereferences s.' + field + ' without a guard on this line, and it is not always present:\n  ' + line.trim());
    }
  }
  // And the specific one that broke: the transform result hangs off capability.
  assert.ok(/c && c\.nonNormal/.test(app),
    'the Box-Cox result must be reached through a guard on capability, which only exists when spec limits were given');
});

/* The gap four departments name. At a tenth of a percent a proportion chart is mostly
   noise: inspect a thousand containers, expect one finding, and the limits sit on top of
   each other with a lower limit of zero. The answer is to chart the distance between
   events instead - and then to resist charting it with three sigma, because both the
   geometric and the exponential are badly skewed. */
test('a rare-event chart uses probability limits, and a run rule carries the half they cannot', () => {
  const geomGaps = (p, n, r) => { const g = []; for (let i = 0; i < n; i++) { let k = 0; while (r() > p) k++; g.push(k); } return g; };

  // The fitted rate comes back, which everything else rests on.
  let est = 0, trials = 200;
  for (let t = 0; t < trials; t++) est += SPC.rareEvents(geomGaps(1 / 500, 60, E.rng(300 + t))).rate;
  assert.ok(Math.abs(est / trials - 1 / 500) < 1 / 500 * 0.15, 'the rate should come back near 1 in 500, got 1 in ' + Math.round(trials / est));

  /* Three sigma is the thing not to do, and the output has to show why rather than assert
     it. On a skewed distribution the lower limit lands below zero and is clamped away - and
     on a chart of gaps that is the expensive half, because gaps SHORTEN when the rate rises. */
  const ch = SPC.rareEvents(geomGaps(1 / 500, 40, E.rng(4)));
  assert.strictEqual(ch.kind, 'g');
  assert.ok(ch.naive.lower < 0, 'three sigma must put the lower limit below zero at this rate, got ' + ch.naive.lower.toFixed(1));
  assert.strictEqual(ch.naive.clamped, true);
  assert.ok(/cannot tell you the rate is rising/.test(ch.why), 'and the output must say which half that costs: ' + ch.why.slice(0, 120));
  // The upper limit is a probability limit, far above what three sigma would have drawn.
  assert.ok(ch.ucl > ch.naive.upper, 'the probability upper limit must sit above the three-sigma one: ' + ch.ucl + ' against ' + ch.naive.upper.toFixed(0));
  // At a three-sigma-equivalent alpha and this rate, no lower limit exists at all, and it says so.
  assert.strictEqual(ch.lclExists, false);
  assert.ok(/no lower limit exists at all/.test(ch.why));

  /* So the single-point rule alone cannot see a rising rate, which is the case these
     departments care about most. Measured below: it catches a fourfold deterioration in
     none of 150 runs. The run rule is what recovers it. */
  const toSignal = (pBase, pNew, trialsN, baseN, horizon, opt) => {
    let caught = 0, tot = 0;
    for (let t = 0; t < trialsN; t++) {
      const r = E.rng(9000 + t);
      const base = geomGaps(pBase, baseN, r);
      let hit = 0;
      const seq = [];
      for (let j = 0; j < horizon; j++) {
        let k = 0; while (r() > pNew) k++;
        seq.push(k);
        const sub = SPC.rareEvents(base.concat(seq), opt);
        if (sub.signals.some(x => x.i >= baseN)) { hit = j + 1; break; }
      }
      if (hit) { caught++; tot += hit; }
    }
    return { pct: caught / trialsN, avg: caught ? tot / caught : null };
  };
  // Limits only: run length pushed past the horizon so only the limits can fire.
  const limitsOnly = { alpha: 0.0027, run: 10000 };
  const worseLimits = toSignal(1 / 1000, 1 / 250, 60, 50, 60, limitsOnly);
  assert.strictEqual(worseLimits.pct, 0, 'with no lower limit, a single point cannot see a rising rate');

  // With the run rule, the same deterioration is caught almost always, and quickly.
  const worse = toSignal(1 / 1000, 1 / 250, 150, 50, 60, { alpha: 0.0027 });
  assert.ok(worse.pct > 0.9, 'the run rule must recover deterioration detection, got ' + Math.round(worse.pct * 100) + '%');
  assert.ok(worse.avg < 25, 'and reasonably quickly, averaged ' + (worse.avg || 0).toFixed(0) + ' events');
  // Measured: 0% on limits alone, 99% in an average of 12 events with the run rule.

  // Improvement is the other half, and the upper limit sees it on its own.
  const better = toSignal(1 / 1000, 1 / 4000, 150, 50, 60, { alpha: 0.0027 });
  assert.ok(better.pct > 0.9, 'a fourfold improvement must be caught, got ' + Math.round(better.pct * 100) + '%');
  assert.ok(better.avg < 15, 'improvement should show fast, averaged ' + (better.avg || 0).toFixed(0));

  /* What that costs, measured rather than hoped. The run rule is deliberately set where its
     own risk is the same order as the limits: the centre is the median, so each point falls
     below it with probability one half and a run of eight is 2^-8, about 0.39%. */
  const stable = toSignal(1 / 1000, 1 / 1000, 150, 50, 60, { alpha: 0.0027 });
  const perPoint = 1 - Math.pow(1 - stable.pct, 1 / 60);
  assert.ok(perPoint < 0.012, 'the false alarm rate per point should stay near the sum of the two rules, got ' + (perPoint * 100).toFixed(2) + '%');
  assert.ok(Math.abs(ch.runRisk - Math.pow(0.5, 8)) < 1e-12, 'the run rule risk must be reported');
  // Measured: about 0.6% per point, against 0.27% for the limits alone plus 0.39% for the run.

  /* And the comparison that justifies the whole build. A p-chart over the same ground, in
     subgroups of a thousand: it is blind to the improvement entirely, and its three-sigma
     limits are badly calibrated at this rate because the normal approximation fails when
     the expected count per subgroup is about one. */
  const pChart = (p, subgroups, n, r) => {
    const base = 1 / 1000, sd = Math.sqrt(base * (1 - base) / n);
    const ucl = base + 3 * sd, lcl = Math.max(0, base - 3 * sd);
    let out = 0;
    for (let s = 0; s < subgroups; s++) {
      let c = 0;
      for (let i = 0; i < n; i++) if (r() < p) c++;
      if (c / n > ucl || c / n < lcl) out++;
    }
    return out / subgroups;
  };
  assert.strictEqual(pChart(1 / 4000, 60, 1000, E.rng(77)), 0, 'a p-chart at this rate cannot see an improvement at all');
  /* Its false alarm rate is not a matter of simulation luck, it is arithmetic: the upper
     limit lands at 3.998 defectives, so any subgroup with four or more signals, and with an
     expected count of one that is P(Poisson(1) >= 4) = 1.9%. Seven times the 0.27% that
     "three sigma" is supposed to mean, because the normal approximation has no business
     here. Asserted exactly, then confirmed by simulation. */
  const poisTail = (lam, k) => { let s = 0, term = Math.exp(-lam); for (let i = 0; i < k; i++) { s += term; term *= lam / (i + 1); } return 1 - s; };
  const pChartAlarm = poisTail(1, 4);
  assert.ok(Math.abs(pChartAlarm - 0.0190) < 0.0005, 'the p-chart false alarm rate here is 1.9%, got ' + (pChartAlarm * 100).toFixed(2) + '%');
  assert.ok(pChartAlarm > 6 * 0.0027, 'which is several times the rate three sigma implies');
  assert.ok(pChart(1 / 1000, 200, 1000, E.rng(78)) > 0.008, 'and simulation agrees');

  /* Time between events rather than units between them: the same chart on an exponential
     fit, chosen automatically when the gaps are not whole numbers. */
  const expGaps = (lam, n, r) => E.range(n).map(() => -Math.log(Math.max(1e-12, r())) / lam);
  const t = SPC.rareEvents(expGaps(1 / 30, 40, E.rng(11)), { alpha: 0.0027 });
  assert.strictEqual(t.kind, 't');
  assert.ok(Math.abs(t.mean - 30) < 9, 'mean days between events should be near 30, got ' + t.mean.toFixed(1));
  assert.ok(t.lcl > 0 && t.ucl > t.lcl, 'an exponential chart has both limits: ' + t.lcl + ' to ' + t.ucl);
  assert.ok(Math.abs(t.centre - Math.log(2) * t.mean) < 1e-6, 'its centre is the median, not the mean');

  // Refusals, each with a reason that tells you what to do instead.
  assert.throws(() => SPC.rareEvents([1, 2, 3]), /at least 8 gaps/);
  assert.throws(() => SPC.rareEvents([1, 2, 3, 4, 5, 6, 7, -1]), /cannot be negative/);
  assert.throws(() => SPC.rareEvents(E.range(10).map(() => 0)), /not a rare event/);
  assert.throws(() => SPC.rareEvents([1.5, 2, 3, 4, 5, 6, 7, 8], { kind: 'g' }), /use the t-chart/);
  assert.throws(() => SPC.rareEvents(E.range(10).map(() => 5), { alpha: 0.9 }), /between 0 and 0.5/);
});

/* The I-MR chart is excellent at a spike and poor at a drift - the Nelson run rules exist
   to patch exactly that. Two charts are built for it from the start, and both work by
   remembering. The whole claim is about speed at a fixed false alarm rate, so both halves
   are measured: the in-control run length, which makes the comparison fair, and the
   out-of-control run length, which is the point. */
test('CUSUM and EWMA are calibrated to the same false alarm rate, and are far faster on a drift', () => {
  /* Run the three charts point by point down a stream and record when each first signals.
     Written out rather than calling the module in a loop, so what is being measured is the
     arithmetic itself and a bug in the module cannot quietly agree with a bug in the test. */
  const arl = (shift, trials, cap) => {
    const k = 0.5, h = 4.77, lam = 0.2, L = 2.962;
    let sC = 0, sE = 0, sS = 0, nC = 0, nE = 0, nS = 0;
    for (let t = 0; t < trials; t++) {
      const r = E.rng(20000 + t);
      const nz = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
      let cp = 0, cm = 0, z = 0, i = 0, hC = 0, hE = 0, hS = 0;
      while (i < cap && (!hC || !hE || !hS)) {
        i++;
        const x = shift + nz();
        cp = Math.max(0, cp + x - k); cm = Math.max(0, cm - x - k);
        if (!hC && (cp > h || cm > h)) hC = i;
        z = lam * x + (1 - lam) * (i === 1 ? 0 : z);
        const se = Math.sqrt((lam / (2 - lam)) * (1 - Math.pow(1 - lam, 2 * i)));
        if (!hE && Math.abs(z) > L * se) hE = i;
        if (!hS && Math.abs(x) > 3) hS = i;
      }
      if (hC) { sC += hC; nC++; } if (hE) { sE += hE; nE++; } if (hS) { sS += hS; nS++; }
    }
    return { cusum: nC ? sC / nC : null, ewma: nE ? sE / nE : null, shewhart: nS ? sS / nS : null };
  };

  /* In control, all three must wait about the same time for a false alarm, or any speed
     comparison between them is just one chart being more trigger-happy than another. */
  const quiet = arl(0, 1200, 2000);
  for (const [name, v] of [['CUSUM', quiet.cusum], ['EWMA', quiet.ewma], ['Shewhart', quiet.shewhart]]) {
    assert.ok(v > 250 && v < 600, name + ' should wait around 370 points for a false alarm, measured ' + Math.round(v));
  }
  // Measured: 358, 445 and 374 against the textbook 370.

  /* The reason to have them. A one-sigma shift leaves nearly every point inside three-sigma
     limits, so the plain chart waits forty-five points; these two signal in ten. */
  const one = arl(1, 1200, 2000);
  assert.ok(one.cusum < 16 && one.ewma < 16, 'at one sigma both should signal inside about 10 points, got ' + Math.round(one.cusum) + ' and ' + Math.round(one.ewma));
  assert.ok(one.shewhart > 30, 'and the plain chart should be far slower, got ' + Math.round(one.shewhart));
  assert.ok(one.shewhart > 3 * one.cusum, 'the gap should be several-fold: ' + Math.round(one.shewhart) + ' against ' + Math.round(one.cusum));

  // Half a sigma is where it is starkest: 35 and 41 points against 154.
  const half = arl(0.5, 900, 2000);
  assert.ok(half.shewhart > 3 * half.cusum, 'at half a sigma: ' + Math.round(half.shewhart) + ' against ' + Math.round(half.cusum));

  /* And the price, which is CUSUM's alone. On a large sudden jump the plain chart does not
     beat EWMA - they tie at one point - but CUSUM takes two, because its slack term has to
     be paid back before the running sum can cross. Claiming both charts lose on big jumps
     would have been the comfortable thing to write and is not what the measurement says. */
  const jump = arl(4, 1200, 200);
  assert.ok(jump.shewhart < 1.5, 'a four-sigma jump is caught by the plain chart almost at once, got ' + jump.shewhart.toFixed(2));
  assert.ok(jump.ewma < 1.5, 'and EWMA matches it rather than lagging, got ' + jump.ewma.toFixed(2));
  assert.ok(jump.cusum > jump.shewhart, 'while CUSUM costs a point: ' + jump.cusum.toFixed(2) + ' against ' + jump.shewhart.toFixed(2));
  assert.ok(jump.cusum < 3, 'but only about one point, not several: ' + jump.cusum.toFixed(2));

  /* The module must agree with that arithmetic, and must date the drift. A Shewhart signal
     tells you something is wrong now; the CUSUM count says how long it has been wrong,
     which is where an investigation starts. */
  const r = E.rng(3);
  const nz = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const y = E.range(40).map(() => 100 + 2 * nz()).concat(E.range(30).map(() => 100 + 1.5 + 2 * nz()));
  const c = SPC.cusum(y, { mu0: 100, sigma: 2 });
  const e = SPC.ewma(y, { mu0: 100, sigma: 2 });
  const m = SPC.imr(y);
  assert.ok(c.signals.length > 0, 'CUSUM must see a 0.75 sigma shift that the plain chart misses');
  assert.strictEqual(m.signals.filter(s => s.i >= 40).length, 0, 'and the plain chart must indeed miss it, or this proves nothing');
  assert.ok(c.shiftStarted >= 38 && c.shiftStarted <= 50,
    'the drift should be dated near where it really began (point 40), got ' + c.shiftStarted);

  // EWMA limits widen over the first points, because the average is still filling up.
  assert.ok(e.ucl[0] < e.ucl[5] && e.ucl[5] < e.ucl[30], 'the exact form has widening limits, not a constant band');
  assert.ok(Math.abs(e.ucl[69] - (100 + 2.962 * 2 * Math.sqrt(0.2 / 1.8))) < 0.01, 'and they settle on the asymptotic width');
  assert.ok(/exact form rather than the asymptotic one/.test(e.why));

  /* Where the centre comes from decides whether these charts work at all. Taking it from
     the grand mean absorbs the drift into the thing the drift is measured against: on a
     0.9-sigma step 60 points into a 110-point series, that leaves 9 signals where a
     baseline window leaves 49. This was the first behaviour I shipped, and it made the
     charts quietest about exactly what they are for. */
  const r2 = E.rng(9);
  const nz2 = () => { let u = 0, v = 0; while (!u) u = r2(); while (!v) v = r2(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const step = E.range(60).map(() => 99 + 0.4 * nz2()).concat(E.range(50).map(() => 99 + 0.36 + 0.4 * nz2()));
  const byGrand = SPC.cusum(step, { mu0: E.mean(step) });
  const byBase = SPC.cusum(step);
  assert.ok(byBase.signals.length > 3 * byGrand.signals.length,
    'a baseline centre must beat the grand mean by a wide margin: ' + byBase.signals.length + ' signals against ' + byGrand.signals.length);
  assert.ok(/first \d+ points/.test(byBase.baseline.from), 'and it must say where the centre came from: ' + byBase.baseline.from);
  assert.ok(/absorbs the drift being looked for/.test(byBase.why), 'and why it is not the grand mean');
  // A target, when there is one, is better still: the value the process should hold.
  const byTarget = SPC.cusum(step, { mu0: 99 });
  assert.strictEqual(byTarget.baseline.from, 'the target you gave');
  assert.ok(byTarget.signals.length >= byBase.signals.length - 5, 'a real target should do at least as well as a baseline');

  // Both report the measured comparison rather than leaving it to a reader to look up.
  assert.ok(/about 10 points against 45/.test(c.why) && /about 10 points against 45/.test(e.why));
  assert.ok(/slack has to be paid back/.test(c.why), 'CUSUM must own its one weakness');

  // Refusals.
  assert.throws(() => SPC.cusum([1, 2, 3]), /at least 8 points/);
  assert.throws(() => SPC.ewma(E.range(10).map(() => 5)), /no spread/);
  assert.throws(() => SPC.ewma(E.range(10).map((_, i) => i), { lambda: 0 }), /above 0 and at most 1/);
});

/* The bug class that silently emptied the academy page: a script whose first lines read
   `root.MLSomething || require('./something.js')` runs fine under node and throws
   "require is not defined" in a browser if the page forgot to load that dependency first.
   The throw happens at load time, so the file's own global is never defined, and every
   later script that uses it dies too - leaving blank containers with nothing in the UI to
   say why. learn.html shipped like that: it loaded agent.js without uncertainty.js, so
   window.MLAgent never existed and all 39 lessons rendered as empty boxes.

   One grep cannot catch it; the order of the script tags on each page is what matters. */
test('every page loads each script after the dependencies that script needs at load time', () => {
  const exportsOf = {}, needsOf = {};
  for (const f of fs.readdirSync(ROOT).filter(f => /\.js$/.test(f))) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const ex = src.match(/root\.(ML[A-Za-z]*|Charts)\s*=/g) || [];
    exportsOf[f] = ex.map(s => s.replace(/root\.|\s*=/g, ''));
    /* Only the unguarded form is a hazard. `typeof require !== 'undefined' ? ... : null`
       degrades to null in a browser, which is a missing-feature bug at worst, not a
       page-killing throw, and some files use it deliberately for optional dependencies. */
    needsOf[f] = (src.match(/root\.(ML[A-Za-z]*|Charts)\s*\|\|\s*require\(/g) || [])
      .map(s => s.replace(/root\.|\s*\|\|[\s\S]*/g, ''));
  }
  // Nothing may claim a dependency no file provides: that would be a typo, not an ordering bug.
  const provided = {};
  for (const f of Object.keys(exportsOf)) for (const g of exportsOf[f]) provided[g] = f;
  for (const f of Object.keys(needsOf)) for (const g of needsOf[f]) {
    assert.ok(provided[g], f + ' needs ' + g + ', which no file in the project defines');
  }

  const pages = fs.readdirSync(ROOT).filter(f => /\.html$/.test(f));
  assert.ok(pages.length >= 2, 'both pages must be checked: ' + pages.join(', '));
  for (const page of pages) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const loaded = (html.match(/<script src="([^"]+)"/g) || []).map(s => s.replace(/.*src="|"/g, ''));
    const defined = new Set();
    for (const f of loaded) {
      assert.ok(fs.existsSync(path.join(ROOT, f)), page + ' loads ' + f + ', which does not exist');
      for (const g of needsOf[f] || []) {
        assert.ok(defined.has(g),
          page + ' loads ' + f + ' before ' + g + ' (' + provided[g] + ') is defined. In a browser that file '
          + 'throws on load, so ' + (exportsOf[f] || []).join(' and ') + ' is never defined and every script after it breaks.');
      }
      for (const g of exportsOf[f] || []) defined.add(g);
    }
  }
});

/* The tools summary. Two tables over the same eight benches, and the thing that makes them
   worth having rather than decorative is that every row names the input type: variable,
   attribute, or neither. Get that wrong and the reader takes a count to a measurement chart,
   where the limits are not approximately wrong but structurally wrong - the spread of a
   Poisson count is fixed by its own mean and has nothing to do with the moving range. */
test('the tools summary covers every bench, names the input type, and cannot drift from the selector', () => {
  const M = require(path.join(ROOT, 'methods.js'));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

  // The selector is the single source of truth for which benches exist.
  const picker = html.slice(html.indexOf('<select id="tool">'), html.indexOf('</select>', html.indexOf('<select id="tool">')));
  const options = (picker.match(/value="([a-z]+)"/g) || []).map(s => s.replace(/value="|"/g, ''));
  assert.ok(options.length >= 8, 'tool selector not found or too short: ' + options.join(','));
  const analytic = options.filter(o => o !== 'privacy');

  // Every analysis bench gets exactly one row, and no row invents a bench.
  assert.deepStrictEqual(M.TOOLS.map(t => t.tool).slice().sort(), analytic.slice().sort(),
    'the summary table and the tool selector must list the same benches');
  for (const m of M.METHODS) assert.ok(options.includes(m.tool), m.name + ' points at bench "' + m.tool + '", which is not in the selector');
  // And every bench in the table has at least one method card opened up beneath it.
  for (const t of M.TOOLS) assert.ok(M.METHODS.some(m => m.tool === t.tool), t.tool + ' has a table row but no method card');

  /* Every field on both tables has to be filled and has to say something. A one-word cell
     passes a presence check and tells a reader nothing, so there is a floor on length. */
  for (const t of M.TOOLS) {
    for (const k of ['what', 'where', 'inputs', 'outputs']) {
      assert.ok(typeof t[k] === 'string' && t[k].length > 40, t.tool + ' has a thin or missing "' + k + '": ' + t[k]);
    }
  }
  for (const m of M.METHODS) {
    for (const k of ['method', 'answers', 'chart', 'where', 'inputs', 'outputs', 'judged', 'shape']) {
      assert.ok(typeof m[k] === 'string' && m[k].length > 40, m.name + ' has a thin or missing "' + k + '": ' + m[k]);
    }
    assert.ok(['stats', 'ml', 'both'].includes(m.kind), m.name + ' has an unknown kind');
  }

  /* The input type is the column that decides the method, so it must be named in words a
     reader can act on - not implied. The two benches that take no tabular data at all have
     to say so rather than quietly omitting it. */
  const names = /\b(variable|attribute|categor|count|pass.fail|sequence|no data|no tabular data)/i;
  for (const t of M.TOOLS) assert.ok(names.test(t.inputs), t.tool + ' does not name its input type: ' + t.inputs);
  for (const m of M.METHODS) assert.ok(names.test(m.inputs), m.name + ' does not name its input type: ' + m.inputs);
  // Attribute agreement is categories only; the count charts are the other direction.
  const agree = M.METHODS.find(m => /Attribute agreement/.test(m.name));
  assert.ok(/attribute only/i.test(agree.inputs), 'attribute agreement must say it takes no measurements');
  const caps = M.METHODS.find(m => /Capability and control charts/.test(m.name));
  assert.ok(/attribute/i.test(caps.inputs) && /variable/i.test(caps.inputs),
    'the chart bench takes both, and which chart goes with which is the whole point');

  /* The page renders both tables from the data file, so a method added to methods.js
     appears without anybody editing the markup. If these go back to being written into the
     HTML they will drift from the selector the first time a bench is renamed. */
  assert.ok(/M\.TOOLS\.map/.test(app), 'the table must be rendered from the data file');
  for (const col of ['What it is', 'Where it is used', 'Input data', 'What you get out']) {
    assert.ok(app.includes(col), 'the summary table is missing the "' + col + '" column');
  }
  for (const row of ['What the chart does', 'Where it can be used', 'Input data', 'What you get out']) {
    assert.ok(app.includes(row), 'the method cards are missing the "' + row + '" row');
  }
  // Each row opens its bench: a reference table you cannot act from is just reading material.
  assert.ok(/tool-table[\s\S]{0,2000}data-open-tool/.test(app), 'each table row needs a button that opens the bench');
  // Stacking on a phone must keep the column names with the cells.
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.ok(/content: attr\(data-label\)/.test(css), 'stacked cells must print their own column name');
  assert.ok(/data-label="/.test(app), 'and the renderer must supply it');
  // The build has to ship the data file, or the download renders an empty section.
  assert.ok(/methods\.js/.test(fs.readFileSync(path.join(ROOT, 'package.sh'), 'utf8')), 'package.sh must copy methods.js');
});

/* The academy. Fifty-eight lessons is only worth having if it covers what the tool actually
   reports - a lesson plan that stops before the methods a user will meet in their results
   sends them to a search engine at exactly the wrong moment. These assertions are the drift
   check: add a method to the tool and the lesson plan has to catch up or the suite fails. */
test('the lesson plan is complete, ordered, and covers every method the tool reports', () => {
  const src = fs.readFileSync(path.join(ROOT, 'learn.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'learn.html'), 'utf8');

  // Structure: every lesson carries the full teaching shape, not a title and a stub.
  const ids = (src.match(/^    id: '[a-z0-9-]+',/gm) || []).map(s => s.replace(/.*'([^']+)'.*/, '$1'));
  assert.ok(ids.length >= 55, 'expected a full curriculum, found ' + ids.length + ' lessons');
  assert.strictEqual(new Set(ids).size, ids.length, 'lesson ids must be unique');
  for (const field of ['group:', 'title:', 'analogy:', 'intro:', 'demo(el) {', 'steps:', 'when:', 'watch:', 'where:', 'quiz:']) {
    const n = (src.match(new RegExp(field.replace(/[(){}]/g, '\\$&'), 'g')) || []).length;
    assert.ok(n >= ids.length, 'only ' + n + ' lessons carry "' + field + '" but there are ' + ids.length);
  }
  // Every quiz offers a real choice and names a correct one that exists.
  const quizzes = src.match(/options: \[[^\]]*\], answer: \d/g) || [];
  assert.strictEqual(quizzes.length, ids.length, 'every lesson needs exactly one quiz');
  for (const qz of quizzes) {
    const opts = (qz.match(/'(?:[^'\\]|\\.)*'/g) || []).length;
    const ans = Number(qz.match(/answer: (\d)/)[1]);
    assert.ok(opts >= 3, 'a quiz with fewer than three options is not a check: ' + qz.slice(0, 80));
    assert.ok(ans >= 0 && ans < opts, 'answer index ' + ans + ' is outside its own option list');
  }

  /* Order: foundations first. Someone who does not know what a p-value is cannot start at
     gradient boosting, and the group order is taken from the order lessons are added. */
  const groups = [];
  for (const m of src.match(/^    id: '[a-z0-9-]+', group: '[^']+'/gm) || []) {
    const g = m.replace(/.*group: '([^']+)'.*/, '$1');
    if (!groups.includes(g)) groups.push(g);
  }
  assert.strictEqual(groups[0], 'Statistics foundations', 'the plan must open with the statistics, not with machine learning');
  assert.ok(groups.indexOf('Start here') === 1, 'the ML introduction comes second');
  assert.ok(groups.indexOf('Using the results') === groups.length - 1, 'reading the results comes last');

  /* Coverage. Each entry is something the tool prints in a result or a chart; if a user can
     be shown it, there has to be a lesson that explains it. */
  const topics = {
    'attribute versus variable data': /attribute or variable|Attribute or variable/,
    'mean, median and spread': /interquartile range/,
    'distribution shape': /skewness/,
    'sampling error': /standard error/,
    'confidence intervals': /confidence interval/i,
    'p-values': /p-value/,
    'correlation traps': /correlation coefficient/,
    'cross-validation': /[Cc]ross-validation/,
    'overfitting': /[Oo]verfitting/,
    'category encoding': /[Tt]arget encoding/,
    'collinearity and VIF': /variance inflation factor/,
    'randomization and blocking': /[Rr]andomiz/,
    'response surfaces': /response-surface design|response surface/i,
    'multiplicity': /Benjamini-Hochberg/,
    'capability': /Cpk/,
    'control charts': /[Nn]elson|control limit/,
    'count charts': /c, u and p|u-chart|c-chart/,
    'CUSUM and EWMA': /CUSUM/,
    'rare events': /between consecutive events|gap chart|g-chart/,
    'Box-Cox': /Box-Cox/,
    'normality testing': /Anderson-Darling/,
    'tolerance intervals': /tolerance interval/i,
    'distribution-free bounds': /distribution-free/i,
    'power and sample size': /sample size/,
    'attribute agreement': /kappa/,
    'Gage R&R': /Gage R&R/,
    'variance components': /variance component/i,
    'equivalence': /TOST|equivalence/i,
    'shelf life': /shelf life/i,
    'multivariate monitoring': /Hotelling|T-squared|T.squared/,
    'conformal intervals': /[Cc]onformal/,
    'desirability': /desirability/i,
    'Taguchi': /Taguchi/,
    'PCA': /PCA|principal component/i,
    'clustering': /k-means/,
    'genetic algorithms': /Pareto front/
  };
  for (const [name, re] of Object.entries(topics)) {
    assert.ok(re.test(src), 'no lesson covers ' + name + ' (looked for ' + re + ')');
  }

  /* Every design the DOE builder can generate has to be named somewhere in the lessons,
     by the words the builder itself uses. This is the check that catches a new design
     being added to the tool and never explained. */
  const DESIGN_WORDS = {
    full: /full factorial/i, half: /half fraction|fractional factorial/i, res4: /resolution IV/,
    pb: /Plackett-Burman/, ccd: /central composite/i, ccf: /face-centred central composite|face-centered central composite/i,
    bbd: /Box-Behnken/, dsd: /definitive screening/i, mixLattice: /simplex lattice/i,
    mixCentroid: /simplex centroid/i, mixVertices: /extreme vertices/i
  };
  assert.deepStrictEqual(Object.keys(DESIGN_WORDS).sort(), Object.keys(D.DESIGNS).sort(),
    'a design was added to or removed from the builder without updating this coverage list');
  for (const [key, re] of Object.entries(DESIGN_WORDS)) {
    assert.ok(re.test(src), 'the DOE builder offers "' + D.DESIGNS[key].name + '" but no lesson names it');
  }

  // The page has to load the libraries the lessons call, in an order that works in a browser.
  for (const f of ['engine.js', 'doe.js', 'spc.js', 'uncertainty.js', 'agent.js', 'variance.js', 'tolerance.js', 'charts.js', 'learn.js']) {
    assert.ok(html.includes('src="' + f + '"'), 'learn.html must load ' + f);
  }
  // Demos may compute, but they may not invent: nothing here fabricates a result to display.
  assert.ok(!/Math\.random\(/.test(src), 'lessons must use the seeded generator so every reader sees the same numbers');
});

/* The README quotes the size of the course and four measured figures from its demos. A
   number in a README is a promise to a reader who cannot check it, so each one is checked
   here against the thing it describes. */
test('the README figures for the academy match the academy', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const src = fs.readFileSync(path.join(ROOT, 'learn.js'), 'utf8');
  const count = (src.match(/^    id: '[a-z0-9-]+',/gm) || []).length;
  const quoted = readme.match(/(\d+)-lesson course/);
  assert.ok(quoted, 'the README must say how long the course is');
  assert.strictEqual(Number(quoted[1]), count, 'README says ' + quoted[1] + ' lessons; learn.js has ' + count);
  assert.ok(readme.includes(count + ' lessons'), 'the opening line must quote the same count');

  // The groups the README lists, in the order the lessons actually produce.
  const groups = [];
  for (const m of src.match(/^    id: '[a-z0-9-]+', group: '[^']+'/gm) || []) {
    const g = m.replace(/.*group: '([^']+)'.*/, '$1');
    if (!groups.includes(g)) groups.push(g);
  }
  let at = -1;
  for (const g of groups) {
    const i = readme.indexOf('*' + g + '*');
    assert.ok(i > at, 'the README group list must name "' + g + '" in course order');
    at = i;
  }
});

/* The conformal lesson makes a measured claim - that a band taken from in-sample residuals
   under-delivers while the same band taken from held-out residuals hits its nominal rate -
   and both the lesson and the README quote the figures. Re-measure them here, over exactly
   the ten datasets the demo cycles through, so neither can drift. */
test('in-sample interval bands under-cover where conformal bands do not', () => {
  const U = require(path.join(ROOT, 'uncertainty.js'));
  const normal = r => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const inSample = [], conformal = [];
  for (let k = 0; k < 10; k++) {
    const rand = E.rng(71 + 13 * k), nFit = 16, nCal = 60, nTest = 120, n = nFit + nCal + nTest;
    const xs = E.range(n).map(() => rand() * 10), ys = xs.map(x => 20 + 2 * x + normal(rand) * 2.5);
    const feat = x => E.range(9).map(j => Math.pow(x / 10, j + 1));
    const fit = E.range(nFit), cal = E.range(nCal).map(i => nFit + i), test = E.range(nTest).map(i => nFit + nCal + i);
    const m = E.fitRidgeCore(fit.map(i => feat(xs[i])), fit.map(i => ys[i]), 1e-7);
    const pr = idx => m.predict(idx.map(i => feat(xs[i])));
    const sIn = E.sd(pr(fit).map((p, j) => ys[fit[j]] - p));
    const q = U.conformalQuantile(pr(cal).map((p, j) => Math.abs(ys[cal[j]] - p)).sort((a, b) => a - b), 0.95);
    const tp = pr(test), cov = w => test.filter((i, j) => Math.abs(ys[i] - tp[j]) <= w).length / test.length;
    inSample.push(cov(1.96 * sIn)); conformal.push(cov(q));
  }
  const mi = E.mean(inSample), mc = E.mean(conformal);
  assert.ok(Math.abs(mi - 0.77) < 0.04, 'the lesson and README quote 77% for the in-sample band; measured ' + (mi * 100).toFixed(0) + '%');
  assert.ok(Math.abs(mc - 0.95) < 0.04, 'the conformal band must deliver its 95% claim; measured ' + (mc * 100).toFixed(0) + '%');
  assert.ok(Math.max(...inSample) < 0.95, 'the lesson says the in-sample band never reaches its claim; one dataset reached ' + (Math.max(...inSample) * 100).toFixed(0) + '%');
  assert.ok(mc - mi > 0.1, 'the whole point is the gap between the two, measured at ' + ((mc - mi) * 100).toFixed(0) + ' points');
});

/* The encoding lesson claims a column of pure noise scores R-squared 0.45 when its target
   encoding is fitted once over all the rows, and below zero when fitted inside the folds.
   That is the leak measuring itself, and the figures are quoted in the README. */
test('a target encoding fitted outside the folds scores a column that means nothing', () => {
  const rand = E.rng(13), n = 60, levels = 30;
  const code = E.range(n).map(i => 'L' + (i % levels));
  const normal = r => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const y = E.range(n).map(() => 100 + normal(rand) * 3);
  const scoreWith = encode => {
    const folds = E.makeFolds(n, 5, E.rng(3)), pred = new Array(n).fill(0);
    for (let f = 0; f < 5; f++) {
      const tr = E.range(n).filter(i => folds[i] !== f), te = E.range(n).filter(i => folds[i] === f);
      const map = encode(tr), grand = E.mean(tr.map(i => y[i]));
      const xOf = i => [map[code[i]] === undefined ? grand : map[code[i]]];
      const m = E.fitRidgeCore(tr.map(xOf), tr.map(i => y[i]), 1e-6);
      const pr = m.predict(te.map(xOf));
      te.forEach((i, k) => { pred[i] = pr[k]; });
    }
    return E.regressionMetrics(y, pred).r2;
  };
  const meanBy = rows => {
    const sum = {}, cnt = {};
    rows.forEach(i => { sum[code[i]] = (sum[code[i]] || 0) + y[i]; cnt[code[i]] = (cnt[code[i]] || 0) + 1; });
    const out = {}; Object.keys(sum).forEach(k => { out[k] = sum[k] / cnt[k]; });
    return out;
  };
  const leaky = scoreWith(() => meanBy(E.range(n))), honest = scoreWith(tr => meanBy(tr));
  assert.ok(leaky > 0.3, 'the leak must be visible; the lesson quotes 0.45 and measured ' + leaky.toFixed(2));
  assert.ok(honest < 0, 'encoded inside the folds, a noise column must score no better than the mean; measured ' + honest.toFixed(2));
  assert.ok(leaky - honest > 0.5, 'the gap between the two is the lesson; measured ' + (leaky - honest).toFixed(2));
});

/* The privacy lint strips trailing line comments before looking for forbidden patterns,
   and it used to strip from the first "//" it saw. A hardcoded web address contains "//",
   so `const u = 'https://somewhere/collect'` was cut down to `const u = 'https:` and the
   rule against web addresses - the one rule this project is built around - could not see
   the one pattern it names. This test plants exactly that line and fails if the lint goes
   blind to it again. */
test('the privacy lint can actually see a hardcoded web address', () => {
  const strip = line => line.replace(/(^|[^:'"\w])\/\/.*$/, '$1');
  const url = /https?:\/\//;
  const planted = [
    "  const endpoint = 'https://evil.example/collect';",
    '  const endpoint = "http://evil.example/collect";',
    "  img.src = 'https://evil.example/pixel.gif';",
    "  await fetch('https://evil.example/upload', { method: 'POST' });"
  ];
  for (const line of planted) {
    assert.ok(url.test(strip(line)), 'the lint would not see: ' + line.trim());
  }
  // A genuine comment that happens to mention an address is still a comment.
  for (const line of ['  doThing(); // see https://example.com for why', '  // https://example.com']) {
    assert.ok(!url.test(strip(line)), 'a comment should not be flagged: ' + line.trim());
  }
  // And the stripper must still remove ordinary comments, or every line looks like code.
  assert.strictEqual(strip('  const a = 1; // a note').trim(), 'const a = 1;');

  // The lint source itself must be using this form, not the one that was blind.
  const lint = fs.readFileSync(path.join(__dirname, 'run-tests.js'), 'utf8');
  assert.ok(lint.includes("replace(/(^|[^:'\"\\w])\\/\\/.*$/, '$1')"), 'the lint must use the URL-safe comment stripper');
});

/* Links out of the academy. The rule is narrow on purpose: one file, one address, and
   every lesson accounted for either by a link whose channel can be named or by an honest
   blank with the search that would find it. */
test('the academy links out without opening a door', () => {
  const W = require(path.join(ROOT, 'watch.js'));
  const src = fs.readFileSync(path.join(ROOT, 'learn.js'), 'utf8');
  const watchSrc = fs.readFileSync(path.join(ROOT, 'watch.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'learn.html'), 'utf8');
  const ids = (src.match(/^    id: '[a-z0-9-]+',/gm) || []).map(s => s.replace(/.*'([^']+)'.*/, '$1'));

  // Every lesson is accounted for, and nothing is listed that is not a lesson.
  for (const id of ids) {
    const w = W.WATCH[id];
    assert.ok(w, 'lesson "' + id + '" is missing from watch.js - every lesson needs a link or a stated blank');
    assert.ok((w.watch && w.watch.length) || w.search, 'lesson "' + id + '" has neither a link nor a search phrase');
  }
  for (const id of Object.keys(W.WATCH)) assert.ok(ids.includes(id), 'watch.js lists "' + id + '", which is not a lesson');

  /* A link nobody can vouch for is worse than a blank, so every one carries the channel it
     came from and a title a reader can search for when it dies. */
  const seen = new Set();
  for (const id of Object.keys(W.WATCH)) {
    for (const v of W.WATCH[id].watch || []) {
      assert.ok(/^[A-Za-z0-9_-]{11}$/.test(v.id), id + ' has a malformed video id: ' + v.id);
      assert.ok(v.title && v.title.length > 8, id + ' has a thin title: ' + v.title);
      assert.ok(v.channel && v.channel.length > 2, id + ' has no channel named: ' + v.channel);
      seen.add(v.id);
    }
  }
  assert.ok(seen.size >= 25, 'only ' + seen.size + ' videos; the course is 58 lessons long');

  // The URL builder produces a watch link and nothing else, from the id alone.
  assert.strictEqual(W.url('aircAruvnKk'), 'https://www.youtube.com/watch?v=aircAruvnKk');
  assert.ok(!/\?v=.*&/.test(W.url('abc')), 'no tracking parameters may be appended');
  assert.strictEqual(W.url('a b&c=d'), 'https://www.youtube.com/watch?v=a%20b%26c%3Dd');

  /* Nothing may be embedded or preloaded. An iframe, a thumbnail or a preconnect would
     contact the site on page load, which is the thing a plain link specifically does not
     do - and the page would be making the request, not the reader. */
  for (const bad of [/<iframe/i, /youtube-nocookie/, /img\.youtube/, /i\.ytimg/, /preconnect/, /dns-prefetch/, /embed\//]) {
    assert.ok(!bad.test(watchSrc + src), 'the academy must not embed or preload anything: ' + bad);
  }
  assert.ok(!/youtube/i.test(html), 'learn.html must not reference the site at all');
  // Links open away from the tool without handing it a window reference.
  assert.ok(/rel="noopener noreferrer"/.test(src), 'external links need rel="noopener noreferrer"');
  assert.ok(/target="_blank"/.test(src), 'external links should not replace the lesson');
  // And the page says, in the lesson, that these leave and need a connection.
  assert.ok(/leave ML Agent and need an internet connection/.test(src), 'the block must say what it costs');
  assert.ok(/nothing is sent anywhere unless you click/.test(src), 'and what it does not cost');
  // The check date is printed, because "verified" without a date is not a claim.
  assert.ok(/CHECKED/.test(src) && /\d{4}/.test(W.CHECKED), 'the date the links were checked must be shown');
  // The build ships it.
  assert.ok(/watch\.js/.test(fs.readFileSync(path.join(ROOT, 'package.sh'), 'utf8')), 'package.sh must copy watch.js');
});

/* Page by page. The pair of links at the foot of a lesson is easy to miss under a long
   article, so the same move has to be reachable without scrolling, and from the keyboard. */
test('a reader can move through the course one lesson at a time', () => {
  const src = fs.readFileSync(path.join(ROOT, 'learn.js'), 'utf8');
  assert.ok(/function topNav/.test(src), 'there must be a navigation bar at the top of each lesson');
  assert.ok(/Lesson ' \+ \(i \+ 1\) \+ ' of ' \+ LESSONS\.length/.test(src), 'it must say where you are in the course');
  assert.ok(/class="lesson-bar"/.test(src), 'and show progress through it');
  assert.ok(/lesson-nav/.test(src), 'the pair at the foot of the lesson stays');
  // Arrow keys, without stealing them from a focused control or a browser shortcut.
  assert.ok(/ArrowLeft|ArrowRight/.test(src), 'arrow keys must turn the page');
  assert.ok(/altKey \|\| e\.ctrlKey \|\| e\.metaKey \|\| e\.shiftKey/.test(src), 'modified arrow keys belong to the browser');
  assert.ok(/input, select, textarea/.test(src), 'arrow keys inside a control belong to the control');
  // The progress bar is drawn, not styled: the page forbids inline styles.
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.ok(/\.lesson-bar \.bar-on/.test(css), 'the progress bar needs a fill colour from the stylesheet');
  assert.ok(!/style="/.test(src), 'no inline styles anywhere in the lessons');
});

/* The gap evaluation goes to another team as a list of work to fund. Its previous guard
   checked that the document and the product agreed with each other - which they did, while
   both were wrong: five bullets across four departments still said the rare-event chart and
   CUSUM/EWMA were missing, months after they shipped, and the top row of the priority table
   said "build this first" about a chart that was already in the zip.

   Agreement is not truth. This ties each claim to the code instead: if the function that
   would close a gap can be shown to exist, no department may still be told the gap is open.
   Build one of the four remaining class A items and this test fails until its claim is
   removed - which is the only way a document like this stays honest without anyone
   remembering to check. */
test('no gap claims a capability the code already has', () => {
  const apps = require(path.join(ROOT, 'applications.js'));
  const doc = fs.readFileSync(path.join(ROOT, 'GAPS.md'), 'utf8');
  const UNC = require(path.join(ROOT, 'uncertainty.js'));
  const has = v => typeof v === 'function';

  /* Each entry pairs the way a gap claims absence with the thing that would close it. The
     patterns match the absence phrasing specifically, so a gap that mentions a capability
     while describing its limits - "no attribute agreement for more than eight calls" - is
     not caught by it. */
  const CLOSERS = [
    { what: 'the rare-event chart', claim: /\bno (?:\w+ )*rare-event chart/i, built: () => has(SPC.rareEvents) },
    { what: 'CUSUM and EWMA', claim: /\bno CUSUM or EWMA\b/i, built: () => has(SPC.cusum) && has(SPC.ewma) },
    { what: 'count charts', claim: /\bno (?:\w+ )*count charts?\b/i, built: () => has(SPC.countChart) },
    { what: 'a Box-Cox path for skewed data', claim: /\bno Box-Cox\b/i, built: () => has(SPC.boxCoxLambda) },
    { what: 'conformal prediction intervals', claim: /\bno (?:\w+ )*conformal\b/i, built: () => has(UNC.conformalQuantile) },
    // The four class A items still open. Each becomes self-policing the day it is built.
    { what: 'reliability distributions', claim: /\bno reliability distributions|\bno Weibull fitting/i, built: () => has(SPC.weibull) || has(SPC.hazard) },
    { what: 'capability across sites in one step', claim: /\bno process capability modelling across sites/i, built: () => has(SPC.crossSite) || has(SPC.acrossSites) },
    { what: 'a size distribution across the bins', claim: /\bno size distribution fitted across the bins/i, built: () => has(SPC.sizeDistribution) || has(SPC.binnedSize) },
    { what: 'the named ICH Q2 calculations', claim: /LOD and LOQ are not implemented|\bno ICH Q2 validation package/i, built: () => fs.existsSync(path.join(ROOT, 'ichq2.js')) },
    { what: 'forecasting a trend forward', claim: /\bno forecast of a trend forward/i, built: () => fs.existsSync(path.join(ROOT, 'forecast.js')) }
  ];

  for (const c of CLOSERS) {
    const claimed = [];
    for (const [key, label] of apps.FUNCTIONS) {
      for (const gap of apps.PLAYBOOKS[key].gaps) if (c.claim.test(gap)) claimed.push(label);
    }
    if (c.built()) {
      assert.deepStrictEqual(claimed, [],
        c.what + ' is built, but it is still listed as missing for: ' + claimed.join(', ') +
        '. Remove the gap from applications.js and from GAPS.md, and mark the priority row delivered.');
      // And the document must not be recommending it either.
      assert.ok(!new RegExp('Build this first[\\s\\S]{0,200}' + c.what.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(doc),
        c.what + ' is built but still carries a build-this-first recommendation');
    }
  }

  /* And the counts the document quotes about itself have to be right, since a reader uses
     them to size the work. */
  const total = apps.FUNCTIONS.reduce((n, [k]) => n + apps.PLAYBOOKS[k].gaps.length, 0);
  const bullets = (doc.match(/^- \*\*\[[^\]]+\]\*\* /gm) || []).length;
  assert.strictEqual(bullets, total, 'the document lists ' + bullets + ' gaps; the product has ' + total);
  // Every department still has something to say, or the panel renders an empty promise.
  for (const [key, label] of apps.FUNCTIONS) {
    assert.ok(apps.PLAYBOOKS[key].gaps.length > 0, label + ' has no gaps left, which is never true and reads as a bug');
  }
});

/* tQuantile takes a TAIL AREA, not a cumulative probability: tQuantile(0.025, 4) is 2.776.
   Passing 0.975 to it returns essentially zero, and a zero t turns every confidence interval
   into a point and every minimum detectable effect into nothing. It fails silently and in
   the reassuring direction - intervals look precise, underpowered studies look conclusive.
   It was shipped that way in the confidence-intervals lesson, whose demo was therefore
   drawing intervals that could never contain the truth, in a lesson about intervals
   containing the truth. This pins the convention and catches the next one by inspection. */
test('tQuantile is called with a tail area everywhere it is used', () => {
  for (const [tail, df, want] of [[0.025, 4, 2.776], [0.05, 4, 2.132], [0.1, 4, 1.533], [0.2, 4, 0.941], [0.05, 10, 1.812]]) {
    assert.ok(Math.abs(E.tQuantile(tail, df) - want) < 0.002,
      'tQuantile(' + tail + ', ' + df + ') should be ' + want + ', got ' + E.tQuantile(tail, df).toFixed(4));
  }
  /* A tail area above 0.5 is almost certainly a cumulative probability passed by mistake:
     it asks for a t below the median, which no interval or power calculation wants. */
  const bad = [];
  for (const f of fs.readdirSync(ROOT).filter(f => /\.js$/.test(f))) {
    fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/tQuantile\(\s*([0-9.]+)\s*,/g)) {
        if (Number(m[1]) > 0.5) bad.push(f + ':' + (i + 1) + ' tQuantile(' + m[1] + ', ...)');
      }
      if (/tQuantile\(\s*1\s*-\s*[^,)]*\/\s*2\s*,/.test(line)) bad.push(f + ':' + (i + 1) + ' tQuantile(1 - alpha/2, ...)');
    });
  }
  assert.deepStrictEqual(bad, [], 'these pass a cumulative probability where a tail area is wanted: ' + bad.join('; '));
});

/* ICH Q2: linearity, detection and quantitation limits, robustness. Each of the three has a
   standard way of being reported that is wrong, and the tests are mostly about those. */
test('ICH Q2 linearity tests the shape, not the correlation', () => {
  const Q = require(path.join(ROOT, 'ichq2.js'));
  const x = [50, 75, 100, 125, 150];

  const lin = Q.linearity(x, x.map(v => 2.5 * v + 10));
  assert.ok(Math.abs(lin.slope - 2.5) < 1e-9 && Math.abs(lin.intercept - 10) < 1e-7, 'noiseless slope and intercept must come back exactly');
  assert.ok(lin.linear && lin.r2 > 0.9999);

  /* The trap, and the reason this function exists. A gentle bend at the top of the range
     returns r-squared of 0.995 - through any "r2 > 0.99" criterion - while visibly curving. */
  const bent = Q.linearity(x, x.map(v => 2.5 * v + 10 - 0.004 * v * v));
  assert.ok(bent.r2 > 0.99, 'the trap needs a high r-squared to be a trap; got ' + bent.r2.toFixed(5));
  assert.strictEqual(bent.linear, false, 'r-squared ' + bent.r2.toFixed(5) + ' but the response bends, and it was not caught');
  assert.ok(bent.curvature.p < 0.001, 'the squared term must be clearly needed, p = ' + bent.curvature.p);
  assert.ok(/r² on its own never is/.test(bent.why), 'and it must say why r-squared is not the test');

  const xr = [], yr = [];
  for (const v of x) for (const d of [-0.3, 0.3]) { xr.push(v); yr.push(2.5 * v + 10 - 0.004 * v * v + d); }
  const lof = Q.linearity(xr, yr);
  assert.ok(lof.lackOfFit && lof.lackOfFit.p < 0.001, 'lack of fit must catch the same curve');
  assert.strictEqual(lof.linear, false);
  assert.ok(/repeat error/.test(lof.why), 'and must explain what it compared against');
  const ys = xr.map((v, i) => 2.5 * v + 10 + (i % 2 ? 0.3 : -0.3));
  assert.strictEqual(Q.linearity(xr, ys).linear, true, 'a straight line with repeat error must not be called curved');

  assert.throws(() => Q.linearity([1, 2, 3], [1, 2, 3]), /at least 5 points/);
  assert.throws(() => Q.linearity([1, 1, 1, 2, 2], [1, 1, 1, 2, 2]), /only 2 distinct concentrations/);
  /* Three levels can be fitted and tested, so refusing them would be over-strict - but the
     guideline asks for five, and a study that falls short has to say so itself. */
  const thin = Q.linearity([1, 1, 2, 2, 3], [2.1, 1.9, 4.1, 3.9, 6.0]);
  assert.strictEqual(thin.meetsGuideline, false);
  assert.ok(/ICH Q2 asks for a minimum of 5/.test(thin.why), 'a 3-level study must declare its own shortfall');
  assert.strictEqual(Q.linearity([50, 75, 100, 125, 150], [1, 2, 3, 4, 5]).meetsGuideline, true);
});

test('ICH Q2 limits say which sigma they used and whether anyone measured there', () => {
  const Q = require(path.join(ROOT, 'ichq2.js'));
  const lin = { slope: 2.0, residualSd: 0.5, interceptSe: 0.9, range: [50, 150] };
  const d = Q.detectionLimits(lin);
  assert.ok(Math.abs(d.lod - 3.3 * 0.5 / 2) < 1e-12, 'LOD is 3.3 sigma / slope');
  assert.ok(Math.abs(d.loq - 10 * 0.5 / 2) < 1e-12, 'LOQ is 10 sigma / slope');
  assert.ok(/residual standard deviation/.test(d.sigmaSource), 'the sigma used must be named');

  assert.strictEqual(d.loqInRange, false);
  assert.ok(/OUTSIDE the range that was measured/.test(d.why), 'an out-of-range limit must say so');
  assert.ok(/confirmed by analysing samples/.test(d.why), 'and name what would make it a validated limit');
  assert.strictEqual(d.confirmed, false, 'nothing computed here is a confirmed limit');

  const byIntercept = Q.detectionLimits(lin, { sigma: 'intercept' });
  assert.ok(Math.abs(byIntercept.loq - 10 * 0.9 / 2) < 1e-12);
  assert.ok(/y-intercept/.test(byIntercept.sigmaSource));
  assert.notStrictEqual(byIntercept.loq, d.loq, 'the three sigmas do not agree, which is the point of naming one');

  const near = Q.detectionLimits({ slope: 2.0, residualSd: 0.5, interceptSe: 0.9, range: [1, 150] });
  assert.strictEqual(near.loqInRange, true);
  assert.ok(/inside the range that was actually measured/.test(near.why));

  assert.throws(() => Q.detectionLimits({ slope: 0, residualSd: 1, range: [1, 2] }), /slope is zero/);
  assert.throws(() => Q.detectionLimits({ slope: 2, residualSd: 0, range: [1, 2] }), /noiseless/);
});

test('ICH Q2 robustness reports what the study could have detected, not just what it did', () => {
  const Q = require(path.join(ROOT, 'ichq2.js'));
  const rng = E.rng(7);
  const nz = () => { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const mk = (eff, sd) => {
    const L = [-1, 1], runs = [];
    for (const a of L) for (const b of L) for (const c of L) {
      runs.push({ factors: { pH: a === 1 ? 3.1 : 2.9, temp: b === 1 ? 32 : 28, flow: c === 1 ? 1.05 : 0.95 }, response: 100 + eff * a + nz() * sd });
    }
    return runs;
  };

  const real = Q.robustness(mk(3.0, 0.3), { acceptable: 1.0 });
  assert.ok(/not robust to pH/.test(real.verdict), 'a 3-unit effect on 8 runs must be caught: ' + real.verdict);
  assert.strictEqual(real.effects[0].factor, 'pH', 'and ranked first by size');

  /* The whole point. Noisy runs find nothing, and "found nothing" must not be reported as
     robust when the study could not have seen an effect that mattered. */
  const quiet = Q.robustness(mk(0, 2.0), { acceptable: 0.5 });
  assert.strictEqual(quiet.verdict, 'uninformative', 'an underpowered study is not a pass: ' + quiet.verdict);
  assert.ok(quiet.underpowered && quiet.minimumDetectableEffect > 0.5);
  assert.ok(/statement about the study, not about the method/.test(quiet.why));

  assert.ok(/no acceptable limit was given/i.test(Q.robustness(mk(0, 1.0), {}).verdict));
  assert.throws(() => Q.robustness(mk(2.0, 0), { acceptable: 1 }), /no residual error/);
  assert.throws(() => Q.robustness([{ factors: { a: 1 }, response: 1 }], {}), /at least 4 runs/);
});

/* The cross-validation lesson told readers the agent averages the five fold scores and that
   the average "is the number the agent puts on its leaderboard". It is not: the agent pools
   every out-of-fold prediction and scores the lot once. On the lesson's own data those are
   0.874 and 0.890 - close enough that nobody would notice, and different procedures.
   Averaging fold scores is also the worse of the two, because a fold's R-squared is measured
   against that fold's own mean and swings about on four rows. This pins the lesson to what
   the code actually does. */
test('the cross-validation lesson teaches the procedure the agent uses', () => {
  const src = fs.readFileSync(path.join(ROOT, 'learn.js'), 'utf8');
  const lesson = src.slice(src.indexOf("id: 'cross-validation'"), src.indexOf("id: 'overfitting'"));

  // The agent collects out-of-fold predictions and scores them together.
  const engine = fs.readFileSync(path.join(ROOT, 'engine.js'), 'utf8');
  const cv = engine.slice(engine.indexOf('function crossValidate'), engine.indexOf('function fitFull'));
  assert.ok(/const oof = new Array\(n\)/.test(cv) && /return oof/.test(cv),
    'this test assumes the agent returns out-of-fold predictions; if that changed, the lesson has to change with it');

  // So must the lesson.
  assert.ok(/oof\[i\] = pr\[k\]/.test(lesson), 'the lesson must collect out-of-fold predictions the way the agent does');
  assert.ok(/E\.regressionMetrics\(ys, oof\)/.test(lesson), 'and score them together, not fold by fold');
  assert.ok(/that<\/b> is the number the agent puts on its leaderboard/.test(lesson),
    'and say which of the two numbers is the leaderboard one');
  assert.ok(!/the cross-validated score is the average/i.test(lesson), 'the old, wrong claim must be gone');

  // It must also show the training score, or the gap it exists to expose is invisible.
  assert.ok(/trainR2/.test(lesson), 'the lesson must show what fitting and grading on the same rows gives');
  assert.ok(/measure of memory, not of prediction/.test(lesson), 'and say why that number is not evidence');

  /* And the two numbers it quotes have to be the ones its own code produces. */
  const normal = r => { const u = Math.max(1e-12, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const rand = E.rng(9), n = 20;
  const xs = E.range(n).map(() => rand() * 10), ys = xs.map(x => 3 + 2 * x + normal(rand) * 3);
  const trainR2 = E.regressionMetrics(ys, E.fitRidgeCore(xs.map(v => [v]), ys, 1e-8).predict(xs.map(v => [v]))).r2;
  const folds = E.makeFolds(n, 5, E.rng(2)), oof = new Array(n), per = [];
  for (let r = 0; r < 5; r++) {
    const tr = E.range(n).filter(i => folds[i] !== r), te = E.range(n).filter(i => folds[i] === r);
    const m = E.fitRidgeCore(tr.map(i => [xs[i]]), tr.map(i => ys[i]), 1e-8);
    const pr = m.predict(te.map(i => [xs[i]]));
    te.forEach((i, k) => { oof[i] = pr[k]; });
    per.push(E.regressionMetrics(te.map(i => ys[i]), pr).r2);
  }
  const pooled = E.regressionMetrics(ys, oof).r2;
  assert.ok(Math.abs(pooled - 0.890) < 0.002, 'the lesson quotes a pooled score near 0.890, measured ' + pooled.toFixed(3));
  assert.ok(Math.abs(E.mean(per) - 0.874) < 0.002, 'and a fold average near 0.874, measured ' + E.mean(per).toFixed(3));
  assert.notStrictEqual(pooled.toFixed(3), E.mean(per).toFixed(3), 'the two methods must visibly differ, or the lesson has no point to make');
  assert.ok(trainR2 > pooled, 'the training score must be the optimistic one: ' + trainR2.toFixed(3) + ' vs ' + pooled.toFixed(3));
});

/* The "when the tool refuses" lesson quotes real refusal messages. A lesson that quotes the
   software is only useful while the quotes are real, and a message reworded in the code
   would leave the lesson teaching a sentence nobody will ever see. Every quoted refusal must
   still exist, character for character, in the file that throws it. */
test('the refusals quoted in the academy are the ones the tool actually throws', () => {
  const src = fs.readFileSync(path.join(ROOT, 'learn.js'), 'utf8');
  const lesson = src.slice(src.indexOf("id: 'reading-errors'"), src.indexOf("id: 'reading-results'"));
  const quoted = [...lesson.matchAll(/msg: '((?:[^'\\]|\\.)+)'/g)].map(m => m[1].replace(/\\'/g, "'"));
  assert.ok(quoted.length >= 5, 'the lesson should show several refusals, found ' + quoted.length);

  const all = fs.readdirSync(ROOT).filter(f => /\.js$/.test(f) && f !== 'learn.js')
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  for (const msg of quoted) {
    assert.ok(all.includes(msg), 'the lesson quotes a refusal that no longer exists in the code:\n  ' + msg);
  }
  // Each one is sorted into a kind, and each kind is explained.
  for (const k of ['not-enough', 'wrong-kind', 'assumption']) {
    assert.ok(lesson.includes("kind: '" + k + "'"), 'no refusal is classified as ' + k);
  }
  assert.ok(/the message is the finding/i.test(lesson), 'the lesson must make the point that a refusal is a result');
});

/* Every result panel has to say how to read what it printed. A page of correct numbers that
   a reader cannot act on has not finished the job, and for a validation panel the inference
   is most of the value: what the verdict permits, what it blocks, and what it does not cover. */
test('the ICH Q2 results explain how to read them', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'tolerance-ui.js'), 'utf8');
  const panel = ui.slice(ui.indexOf('// ---------- ICH Q2'), ui.indexOf('// ---------- wiring'));
  const howto = (panel.match(/How to read this, and what it means/g) || []).length;
  assert.strictEqual(howto, 2, 'both the linearity and the robustness result need a how-to-read block, found ' + howto);
  // It has to carry the inference, not restate the arithmetic.
  for (const phrase of ['What to do next', 'r\\u00b2 is not the verdict', 'What it does not cover', 'Verdict']) {
    assert.ok(panel.includes(phrase), 'the how-to-read block is missing "' + phrase + '"');
  }
  // And both branches of each verdict must be written, or half the readers get nothing.
  assert.ok(/lin\.linear[\s\S]{0,400}\?[\s\S]{0,900}:/.test(panel), 'the linearity guidance must cover both verdicts');
  assert.ok(/res\.underpowered[\s\S]{0,200}\?/.test(panel), 'the robustness guidance must cover the underpowered case');
  assert.ok(/\.howto/.test(fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8')), 'and the block needs its styling');
});

/* Capability across sites. The temptation MSAT faces is one combined Cpk, and that index is
   only meaningful if the sites are the same process. If their centres differ, the pooled
   spread swallows the gap between them and the combined figure describes a mixture nobody
   runs - it can come out worse than every single site, which is the giveaway. So this works
   the way the shelf-life tool works with batches: test, report per site either way, and
   withhold the combined number with a reason. */
test('capability across sites refuses one index when the sites are not one process', () => {
  const rand = E.rng(3);
  const nz = () => { const u = Math.max(1e-12, rand()), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const mk = (site, m, sd, n) => E.range(n).map(() => ({ site, value: m + nz() * sd }));
  const spec = { lsl: 96, usl: 100 };

  // One process at two sites: the combined index is real and is reported.
  const same = SPC.crossSite(mk('A', 98.2, 0.5, 30).concat(mk('B', 98.1, 0.52, 30)), spec);
  assert.strictEqual(same.poolable, true);
  assert.ok(same.combined && isFinite(same.combined.Ppk), 'a poolable set must get a combined index');
  assert.ok(same.betweenShare < 0.15, 'with one process almost none of the spread is between sites, got ' + same.betweenShare);

  /* Two centres. The combined index is withheld - and the reason it must be is that pooling
     would report a capability worse than either site actually has. */
  const shifted = SPC.crossSite(mk('A', 98.2, 0.5, 30).concat(mk('B', 97.0, 0.5, 30)), spec);
  assert.strictEqual(shifted.poolable, false);
  assert.strictEqual(shifted.combined, null, 'a combined index over two centres must be withheld');
  assert.strictEqual(shifted.sameCentre, false);
  assert.ok(shifted.betweenShare > 0.3, 'the gap between sites should dominate, got ' + shifted.betweenShare);
  assert.ok(/mixture no site actually runs/.test(shifted.why), 'and the reason has to be stated');
  // The claim behind the refusal, measured: pooling really is worse than every site.
  const pooledAnyway = SPC.capability(mk('A', 98.2, 0.5, 30).concat(mk('B', 97.0, 0.5, 30)).map(r => r.value), spec);
  for (const s of shifted.perSite) {
    assert.ok(pooledAnyway.Ppk < s.Ppk, 'pooling two centres should score worse than site ' + s.site +
      ' (' + pooledAnyway.Ppk.toFixed(2) + ' vs ' + s.Ppk.toFixed(2) + ') - that is why it is withheld');
  }

  // Two spreads, same centre: also not one process, for the other reason.
  const spreads = SPC.crossSite(mk('A', 98.2, 0.3, 30).concat(mk('B', 98.2, 1.1, 30)), spec);
  assert.strictEqual(spreads.sameCentre, true);
  assert.strictEqual(spreads.sameSpread, false);
  assert.strictEqual(spreads.combined, null);
  assert.ok(/flatter the worse site/.test(spreads.why));

  // Per-site rows are always produced, sorted worst first, and always correct.
  assert.strictEqual(shifted.perSite.length, 2);
  assert.ok(shifted.perSite[0].Ppk <= shifted.perSite[1].Ppk, 'worst site first');
  assert.strictEqual(shifted.worst, shifted.perSite[0].site);

  // Refusals.
  assert.throws(() => SPC.crossSite(mk('A', 98, 0.5, 30), spec), /at least two/);
  assert.throws(() => SPC.crossSite(mk('A', 98, 0.5, 3).concat(mk('B', 98, 0.5, 30)), spec), /fewer than 5 results/);
  assert.throws(() => SPC.crossSite(mk('A', 98, 0.5, 30).concat(mk('B', 98, 0.5, 30)), {}), /specification limit/);
});

/* Whether two sites DIFFER and whether they are INTERCHANGEABLE are different questions, and
   a transfer needs the second. The capability comparison can only fail to find a difference,
   which is not evidence of sameness - the same confusion the equivalence bench exists to
   fix. Given a margin, every pair of sites is tested properly, and inconclusive stays an
   available answer. */
test('site comparison can demonstrate equivalence, not just fail to find a difference', () => {
  const rand = E.rng(3);
  const nz = () => { const u = Math.max(1e-12, rand()), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const mk = (site, m, sd, n) => E.range(n).map(() => ({ site, value: m + nz() * sd }));
  const spec = { lsl: 96, usl: 100 };

  // Close together, plenty of data, a sensible margin: equivalent.
  const close = SPC.crossSite(mk('A', 98.2, 0.5, 30).concat(mk('B', 98.15, 0.5, 30)), spec, { margin: 0.5 });
  assert.ok(close.equivalence.allEquivalent, 'two tight, close sites should pass: ' + close.equivalence.verdict);
  assert.strictEqual(close.equivalence.pairs.length, 1);

  // Genuinely apart: a finding, not a sample-size problem, and it says so.
  const apart = SPC.crossSite(mk('A', 98.2, 0.5, 30).concat(mk('B', 97.0, 0.5, 30)), spec, { margin: 0.5 });
  assert.strictEqual(apart.equivalence.allEquivalent, false);
  assert.ok(/differ by more than the margin/.test(apart.equivalence.why));
  assert.ok(/not a sample-size problem/.test(apart.equivalence.why), 'a real difference must not be blamed on the study');

  /* The third answer. Six results a side cannot show equivalence to a tight margin, and
     must not be allowed to read as a pass just because no difference was found. */
  const thin = SPC.crossSite(mk('A', 98.2, 0.5, 6).concat(mk('B', 98.2, 0.5, 6)), spec, { margin: 0.2 });
  assert.strictEqual(thin.equivalence.allEquivalent, false);
  assert.ok(/inconclusive/.test(thin.equivalence.verdict), 'got: ' + thin.equivalence.verdict);
  assert.ok(/statement about the study rather than the sites/.test(thin.equivalence.why));

  // Three sites means three pairs, and every one has to pass.
  const three = SPC.crossSite(mk('A', 98.2, 0.5, 25).concat(mk('B', 98.2, 0.5, 25)).concat(mk('C', 96.9, 0.5, 25)), spec, { margin: 0.5 });
  assert.strictEqual(three.equivalence.pairs.length, 3);
  assert.strictEqual(three.equivalence.allEquivalent, false, 'one bad site must fail the set');
  /* And no multiplicity correction, deliberately: requiring all of several claims is an
     intersection-union test and is already conservative. Correcting would be wrong. */
  assert.ok(/intersection-union/.test(three.equivalence.why), 'the reason for not correcting must be stated');

  // Without a margin nothing is claimed, and the absence is called out rather than left blank.
  const bare = SPC.crossSite(mk('A', 98.2, 0.5, 30).concat(mk('B', 98.15, 0.5, 30)), spec);
  assert.strictEqual(bare.equivalence, null);
  assert.ok(/nothing here shows the sites are interchangeable/.test(bare.why));

  assert.throws(() => SPC.crossSite(mk('A', 98, 0.5, 30).concat(mk('B', 98, 0.5, 30)), spec, { margin: -1 }), /greater than zero/);
});

/* Subgroup charts. The individuals chart was the only variables chart here, so anyone
   sampling three or five per batch had to average first - which throws away the within-
   subgroup spread, the very thing that sets the limits. Three ways these charts are misread,
   and the tests are mostly about those. */
test('subgroup charts read the spread chart first and refuse to be compared with specifications', () => {
  const rand = E.rng(11);
  const nz = () => { const u = Math.max(1e-12, rand()), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const mk = (k, n, fn) => { const rows = []; for (let g = 0; g < k; g++) for (let i = 0; i < n; i++) rows.push({ subgroup: 'G' + (g + 1), value: fn(g, i) }); return rows; };

  /* The constants. S-chart ones are computed from the gamma function, so they are checked
     against published values rather than trusted. */
  const c4 = n => Math.sqrt(2 / (n - 1)) * Math.exp(E.lgamma(n / 2) - E.lgamma((n - 1) / 2));
  for (const [n, pub] of [[2, 0.7979], [5, 0.9400], [10, 0.9727], [25, 0.9896]]) {
    assert.ok(Math.abs(c4(n) - pub) < 0.0002, 'c4(' + n + ') should be ' + pub + ', got ' + c4(n).toFixed(4));
  }

  // A healthy chart recovers the within-subgroup sigma it was built from.
  const ok = SPC.subgroupChart(mk(20, 5, () => 100 + nz() * 2));
  assert.strictEqual(ok.kind, 'xbar-r');
  assert.ok(Math.abs(ok.sigmaWithin - 2) < 0.25, 'within-subgroup sigma should recover 2, got ' + ok.sigmaWithin.toFixed(3));
  assert.strictEqual(ok.spreadStable, true);
  assert.ok(ok.ratio > 0.7 && !ok.subgroupingSuspect, 'healthy subgrouping should not be flagged, ratio ' + ok.ratio.toFixed(2));

  /* Irrational subgrouping: two streams sampled into every subgroup. The variation that
     should be compared across subgroups is sitting inside them, so the limits inflate and
     the chart goes blind. The means huddle far inside, and that is detectable. */
  const bad = SPC.subgroupChart(mk(20, 5, (g, i) => 100 + (i % 2 ? 6 : -6) + nz() * 0.5));
  assert.ok(bad.subgroupingSuspect, 'two streams in one subgroup must be flagged, ratio ' + bad.ratio.toFixed(2));
  assert.ok(bad.ratio < 0.4, 'and the means should huddle, got ' + bad.ratio.toFixed(2));
  assert.ok(/inflates the limits and leaves the chart unable to signal/.test(bad.why));
  assert.strictEqual(bad.meanSignals.length, 0, 'the point is that an inflated chart cannot signal');

  /* An unstable spread makes the X-bar limits meaningless, because they are computed from
     it. The result must say to stop at the spread chart rather than reading the means. */
  const unstable = SPC.subgroupChart(mk(20, 5, (g) => 100 + nz() * (g === 9 ? 14 : 2)));
  assert.ok(unstable.spreadSignals.length > 0, 'a blown-out subgroup must show on the spread chart');
  assert.strictEqual(unstable.spreadStable, false);
  assert.ok(/built on a moving foundation/.test(unstable.why), 'and the X-bar reading must be gated on it');

  // Specification limits are never drawn on an X-bar chart, and the reason is stated.
  const withSpec = SPC.subgroupChart(mk(20, 5, () => 100 + nz() * 2), { spec: { lsl: 90, usl: 110 } });
  assert.ok(/deliberately NOT drawn/.test(withSpec.why), 'spec limits on an X-bar chart is the commonest serious misreading');
  assert.ok(/a subgroup mean is not a unit of product/.test(withSpec.why));

  // Unequal sizes and large subgroups both route to S, whose constants need no table.
  const uneven = [];
  for (let g = 0; g < 12; g++) for (let i = 0; i < (g % 3 === 0 ? 4 : 6); i++) uneven.push({ subgroup: 'G' + g, value: 100 + nz() * 2 });
  assert.strictEqual(SPC.subgroupChart(uneven).kind, 'xbar-s');
  assert.strictEqual(SPC.subgroupChart(mk(20, 12, () => 100 + nz() * 2)).kind, 'xbar-s');
  assert.throws(() => SPC.subgroupChart(mk(20, 12, () => 100 + nz() * 2), { kind: 'r' }), /constants stop at ten|too large for a range chart/);
  assert.throws(() => SPC.subgroupChart(uneven, { kind: 'r' }), /not comparable/);

  // Refusals.
  assert.throws(() => SPC.subgroupChart(mk(20, 1, () => 100)), /subgroup of one has no within-subgroup spread/);
  assert.throws(() => SPC.subgroupChart(mk(4, 5, () => 100 + nz())), /Only 4 subgroups/);
});

/* Forecasting, and the part that matters: measuring whether a forecast is worth anything.
   Every method is scored by rolling origin - fit on what came before, forecast forward,
   score against what actually happened - and the headline is MASE against a baseline the
   method has to beat. A forecaster that cannot beat "carry the last value forward" has
   earned nothing, however good its chart looks. */
test('forecasts are scored by rolling origin against a baseline they have to beat', () => {
  const F = require(path.join(ROOT, 'forecast.js'));
  const rand = E.rng(5);
  const nz = () => { const u = Math.max(1e-12, rand()), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  // A real trend: a trend-following method should win, and should beat naive.
  const trend = E.range(40).map((_, i) => 100 + 0.8 * i + nz() * 2);
  const t1 = F.backtest(trend, { horizon: 1 });
  assert.ok(['drift', 'holt', 'damped'].includes(t1.winner.key), 'a trend series should be won by a trend method, got ' + t1.winner.key);
  assert.strictEqual(t1.beatsBaseline, true);
  assert.ok(t1.winner.mase < 1, 'at one step the winner should beat the naive scale, got ' + t1.winner.mase.toFixed(3));
  assert.strictEqual(t1.maseIsDirect, true);

  /* MASE is scaled by the ONE-step naive error even when forecasting further out, so values
     above 1 are normal at longer horizons and are not a failure. Saying otherwise - which an
     earlier draft of this did - turns a working method into a failing one on the page. */
  const t3 = F.backtest(trend, { horizon: 3 });
  assert.strictEqual(t3.maseIsDirect, false);
  assert.ok(/figures above 1 are normal at this horizon/.test(t3.why), 'the horizon caveat must be stated');
  assert.ok(t3.winner.mase < t3.baseline.mase, 'the comparison that decides it is against the baseline at the same horizon');

  // Seasonal series: the baseline becomes seasonal naive, because that is what must be beaten.
  const seasonal = E.range(48).map((_, i) => 100 + 6 * Math.sin(2 * Math.PI * i / 12) + nz() * 1.2);
  const s = F.backtest(seasonal, { period: 12, horizon: 3 });
  assert.strictEqual(s.scaledBy, 'seasonal naive');
  assert.strictEqual(s.baseline.key, 'snaive');
  assert.ok(s.results.some(r => r.key === 'holtwinters'), 'a seasonal series should offer a seasonal method');

  /* Nothing is scored on data it was fitted to. The giveaway would be a method that looks
     excellent in backtest and cannot be beaten by the baseline on a series with no signal. */
  const noise = E.range(40).map(() => 100 + nz() * 2);
  const nres = F.backtest(noise, { horizon: 1 });
  assert.ok(nres.results.every(r => isFinite(r.mase)), 'every method must produce a finite score');
  // On white noise, smoothing genuinely does beat naive - naive carries the noise forward.
  assert.ok(nres.winner.mase < 1, 'smoothing should beat naive on white noise, got ' + nres.winner.mase.toFixed(3));

  // Intervals come from the backtest errors, so their coverage is measured not assumed.
  assert.ok(s.interval && s.interval.halfWidth > 0, 'a conformal interval should be produced');
  assert.ok(Math.abs(s.interval.coverage - s.interval.confidence) < 0.12,
    'measured coverage ' + s.interval.coverage.toFixed(2) + ' should be near the ' + s.interval.confidence + ' claimed');
  assert.ok(/measured rather than assumed/.test(s.why));

  // And a forecast for the next h periods is produced from the full series.
  assert.strictEqual(s.forecast.length, 3);
  assert.ok(s.forecast.every(v => isFinite(v)));

  // Refusals.
  assert.throws(() => F.backtest(E.range(8).map((_, i) => i)), /Need at least/);
  assert.throws(() => F.backtest(E.range(40).map(() => 7)), /nothing to forecast/);
  /* 30 points with a cycle of 12 clears the length gate and trips the one that matters:
     two and a half cycles is not enough to fit a seasonal pattern worth having. */
  assert.throws(() => F.backtest(E.range(30).map((_, i) => i + (i % 12)), { period: 12 }), /three full cycles/);
  assert.throws(() => F.backtest([1, 2, null, 4]), /not a zero/);
});
