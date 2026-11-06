/* BOSS DOE module: detect designed experiments, analyze them (effects, p-values,
   optimum), and generate new designs (full/fractional factorial, Plackett-Burman,
   central composite, Box-Behnken). Pure computation; no network, no storage. */
(function (root) {
  'use strict';
  const E = root.MLEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const { mean, range, invert, tTestP, median, pearson } = E;

  const LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'.split('');

  // ---------- Detection ----------
  /* A dataset looks like a designed experiment when every predictor sits at a handful
     of set levels (2-5) and the factors are close to uncorrelated (orthogonal). */
  function detect(prof, featureCols, targetCol) {
    if (!targetCol || targetCol.kind !== 'numeric') return { isDOE: false, reason: 'Response is not numeric.' };
    if (featureCols.length < 2 || featureCols.length > 15) return { isDOE: false, reason: 'Needs 2 to 15 factors.' };
    const rows = range(prof.nRows).filter(r => targetCol.values[r] !== null && featureCols.every(c => c.values[r] !== null));
    if (rows.length < 4 || rows.length > 300) return { isDOE: false, reason: 'Run count outside a typical DOE.' };
    const factors = [];
    for (const c of featureCols) {
      const lv = Array.from(new Set(rows.map(r => c.values[r])));
      if (c.kind === 'numeric') {
        lv.sort((a, b) => a - b);
        if (lv.length < 2 || lv.length > 5) return { isDOE: false, reason: c.name + ' has ' + lv.length + ' levels.' };
        const lo = lv[0], hi = lv[lv.length - 1];
        // CCD star points sit outside the cube; use the inner pair as -1/+1 when 5 levels.
        const cubeLo = lv.length === 5 ? lv[1] : lo, cubeHi = lv.length === 5 ? lv[3] : hi;
        factors.push({ name: c.name, col: c, categorical: false, levels: lv, low: cubeLo, high: cubeHi, center: (cubeLo + cubeHi) / 2, half: (cubeHi - cubeLo) / 2 });
      } else {
        if (lv.length !== 2) return { isDOE: false, reason: c.name + ' is categorical with ' + lv.length + ' levels.' };
        lv.sort();
        factors.push({ name: c.name, col: c, categorical: true, levels: lv, low: lv[0], high: lv[1] });
      }
    }
    factors.forEach((f, i) => { f.letter = LETTERS[i]; });
    const coded = rows.map(r => factors.map(f => code(f, f.col.values[r])));
    for (let i = 0; i < factors.length; i++) for (let j = i + 1; j < factors.length; j++) {
      const r = pearson(coded.map(x => x[i]), coded.map(x => x[j]));
      if (Math.abs(r) > 0.3) return { isDOE: false, reason: factors[i].name + ' and ' + factors[j].name + ' move together (r = ' + r.toFixed(2) + ').' };
    }
    return { isDOE: true, factors, rows };
  }
  function code(f, v) {
    if (f.categorical) return v === f.high ? 1 : -1;
    return f.half ? (v - f.center) / f.half : 0;
  }
  function decode(f, c) {
    if (f.categorical) return c > 0 ? f.high : f.low;
    return f.center + c * f.half;
  }

  // ---------- Analysis ----------
  function termValue(term, x) { let v = 1; for (const i of term.idx) v *= x[i]; return v; }

  function analyze(det, targetCol) {
    const { factors, rows } = det;
    const k = factors.length;
    const X = rows.map(r => factors.map(f => code(f, f.col.values[r])));
    const y = rows.map(r => targetCol.values[r]);
    const n = y.length;

    // Candidate terms in hierarchy order: main effects, 2-factor interactions, squares.
    const cands = factors.map((f, i) => ({ idx: [i], label: f.letter, kind: 'main' }));
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) cands.push({ idx: [i, j], label: factors[i].letter + factors[j].letter, kind: 'interaction' });
    factors.forEach((f, i) => { if (!f.categorical && f.levels.length >= 3) cands.push({ idx: [i, i], label: f.letter + '²', kind: 'square' }); });

    // Add terms while they are estimable; terms that duplicate an existing column are aliased.
    const terms = [], cols = [new Array(n).fill(1)], aliases = [];
    const basis = [unit(cols[0])];
    for (const t of cands) {
      if (cols.length >= n) { aliases.push({ term: t.label, with: 'no runs left to estimate it' }); continue; }
      const v = X.map(x => termValue(t, x));
      const resid = orthResidual(v, basis);
      const norm = Math.sqrt(resid.reduce((s, a) => s + a * a, 0));
      if (norm < 1e-6 * Math.sqrt(n)) {
        const twin = terms.find((tt, ti) => Math.abs(pearson(cols[ti + 1], v)) > 0.999);
        aliases.push({ term: t.label, with: twin ? twin.label : 'a combination of other terms', squares: t.kind === 'square' && !!twin && twin.kind === 'square' });
        continue;
      }
      terms.push(t); cols.push(v); basis.push(resid.map(a => a / norm));
    }

    // With only center points, every squared term is the same column: report one pooled curvature term.
    const curvatureOnly = aliases.some(a => a.squares);
    if (curvatureOnly) terms.filter(t => t.kind === 'square').forEach(t => { t.label = 'Curv'; t.pooled = true; });
    const p = cols.length;
    const D = y.map((_, i) => cols.map(c => c[i]));
    const XtX = range(p).map(a => range(p).map(b => D.reduce((s, r) => s + r[a] * r[b], 0)));
    const inv = invert(XtX);
    const Xty = range(p).map(a => D.reduce((s, r, i) => s + r[a] * y[i], 0));
    const beta = inv ? inv.map(row => row.reduce((s, v, j) => s + v * Xty[j], 0)) : new Array(p).fill(0);
    const fitted = D.map(r => r.reduce((s, v, j) => s + v * beta[j], 0));
    const resid = y.map((v, i) => v - fitted[i]);
    const ym = mean(y);
    const sse = resid.reduce((s, v) => s + v * v, 0);
    const sst = y.reduce((s, v) => s + (v - ym) ** 2, 0);
    const dfe = n - p;
    const r2 = sst ? 1 - sse / sst : 0;
    const adjR2 = dfe > 0 && sst ? 1 - (sse / dfe) / (sst / (n - 1)) : null;
    let press = null;
    if (dfe > 0 && inv) {
      press = 0;
      for (let i = 0; i < n; i++) {
        const h = D[i].reduce((s, v, a) => s + v * D[i].reduce((t, w, b) => t + inv[a][b] * w, 0), 0);
        press += (resid[i] / Math.max(1e-9, 1 - h)) ** 2;
      }
    }
    const predR2 = press !== null && sst ? 1 - press / sst : null;

    let method, effects;
    if (dfe > 0 && inv) {
      method = 'Least squares with ' + dfe + ' degrees of freedom for error';
      const mse = sse / dfe;
      effects = terms.map((t, ti) => {
        const j = ti + 1, se = Math.sqrt(Math.max(0, mse * inv[j][j]));
        const tv = se ? beta[j] / se : Infinity;
        return { term: t.label, kind: t.kind, idx: t.idx, coef: beta[j], effect: 2 * beta[j], se, t: tv, p: tTestP(tv, dfe) };
      });
    } else {
      // Saturated design: no error estimate, so use Lenth's pseudo standard error.
      method = "Lenth's method (saturated design, no replicate error)";
      const c = terms.map((_, ti) => Math.abs(beta[ti + 1]));
      const s0 = 1.5 * median(c);
      const small = c.filter(v => v < 2.5 * s0);
      const pse = 1.5 * (small.length ? median(small) : s0) || 1e-12;
      const df = Math.max(1, terms.length / 3);
      effects = terms.map((t, ti) => {
        const tv = beta[ti + 1] / pse;
        return { term: t.label, kind: t.kind, idx: t.idx, coef: beta[ti + 1], effect: 2 * beta[ti + 1], se: pse, t: tv, p: tTestP(tv, df) };
      });
    }
    effects.forEach((e, i) => { if (terms.find(t => t.label === e.term && t.pooled)) e.name = 'Curvature'; });
    effects.forEach(e => { if (e.name) return; e.name = e.idx.length === 2 && e.idx[0] === e.idx[1] ? factors[e.idx[0]].name + '²' : e.idx.map(i => factors[i].name).join(' × '); });
    effects.sort((a, b) => Math.abs(b.t) - Math.abs(a.t));

    /* Every term is its own hypothesis test, and a 2^4 design fits eleven of them. Each
       p-value is calibrated - measured at a 4.4% false positive rate per term against a
       nominal 5% - but reading the list as "these effects are significant" is a different
       claim from any single test, and it is the claim people make.

       Measured on 500 analyses of a 2^4 design with three centre points and NO real effect
       at all: 27.4% of them produced at least one term below p = 0.05, and 0.48 false
       findings on average. So roughly one screening run in four hands back something that
       is not there.

       Two things are added rather than one. Benjamini-Hochberg q-values, because for a
       screen the sensible control is the share of claimed effects that are wrong rather
       than the chance of any error at all - Holm or Bonferroni would be stricter and would
       also strip real effects out of a nineteen-run design where power is already thin. And
       the family-wise risk in plain numbers, because an adjusted column nobody reads does
       not stop anyone over-reading the raw one. */
    const m = effects.length;
    const byP = effects.filter(e => e.p !== null && isFinite(e.p)).slice().sort((a, b) => a.p - b.p);
    // Benjamini-Hochberg: walk up from the largest p, keeping the running minimum, so the
    // adjusted values cannot decrease as the raw ones increase.
    let running = 1;
    for (let i = byP.length - 1; i >= 0; i--) {
      running = Math.min(running, (byP.length / (i + 1)) * byP[i].p);
      byP[i].q = Math.min(1, running);
    }
    effects.forEach(e => { if (e.q === undefined) e.q = null; });
    /* The independence value is an upper bound here rather than the figure itself: the
       terms share one error variance estimate, which makes them positively dependent and
       pulls the real risk below it. The measurement above bears that out - 27.4% against
       the 43.1% independence predicts for eleven terms - so it is labelled as a bound. */
    const fwerBound = m ? 1 - Math.pow(0.95, m) : 0;
    const multiplicity = {
      terms: m, alpha: 0.05, fwerBound,
      rawSignificant: effects.filter(e => e.p !== null && e.p < 0.05).length,
      fdrSignificant: effects.filter(e => e.q !== null && e.q < 0.05).length
    };

    // Curvature check from center points.
    const isCenter = x => x.every((v, i) => factors[i].categorical || Math.abs(v) < 1e-9);
    const isCorner = x => x.every(v => Math.abs(Math.abs(v) - 1) < 1e-9);
    const cy = y.filter((_, i) => isCenter(X[i])), fy = y.filter((_, i) => isCorner(X[i]));
    const hasSquares = terms.some(t => t.kind === 'square');
    let curvature = null;
    if (cy.length && fy.length) {
      const diff = mean(cy) - mean(fy);
      let pval = null;
      if (cy.length > 1) {
        const s2 = cy.reduce((s, v) => s + (v - mean(cy)) ** 2, 0) / (cy.length - 1);
        const se = Math.sqrt(s2 * (1 / cy.length + 1 / fy.length));
        pval = se ? tTestP(diff / se, cy.length - 1) : null;
      }
      curvature = { centerMean: mean(cy), cornerMean: mean(fy), diff, p: pval, nCenter: cy.length };
    }

    // Mean response at each level of each factor (main effects plot).
    const mainEffects = factors.map((f, i) => {
      const lv = Array.from(new Set(X.map(x => x[i]))).sort((a, b) => a - b);
      return { name: f.name, points: lv.map(c => ({ coded: c, actual: decode(f, c), mean: mean(y.filter((_, r) => X[r][i] === c)) })) };
    });

    const predict = x => cols.length && [1].concat(terms.map(t => termValue(t, x))).reduce((s, v, j) => s + v * beta[j], 0);

    // Interaction plot for the strongest interaction.
    const topInt = effects.find(e => e.kind === 'interaction');
    let interaction = null;
    if (topInt) {
      const [a, b] = topInt.idx;
      const base = factors.map(() => 0);
      interaction = {
        a: factors[a].name, b: factors[b].name, term: topInt.term, p: topInt.p,
        lines: [-1, 1].map(bv => ({
          bLevel: decode(factors[b], bv),
          points: [-1, 1].map(av => { const x = base.slice(); x[a] = av; x[b] = bv; return { aLevel: decode(factors[a], av), y: predict(x) }; })
        }))
      };
    }

    // Grid search inside the tested region for best settings.
    const grid = factors.map(f => (f.categorical ? [-1, 1] : k <= 6 ? [-1, -0.5, 0, 0.5, 1] : [-1, 0, 1]));
    let best = { max: null, min: null };
    const total = grid.reduce((s, g) => s * g.length, 1);
    if (total <= 200000) {
      const x = new Array(k).fill(0);
      const walk = d => {
        if (d === k) {
          const v = predict(x);
          if (!best.max || v > best.max.y) best.max = { y: v, x: x.slice() };
          if (!best.min || v < best.min.y) best.min = { y: v, x: x.slice() };
          return;
        }
        for (const g of grid[d]) { x[d] = g; walk(d + 1); }
      };
      walk(0);
    } else {
      const sign = s => factors.map((_, i) => { const e = effects.find(t => t.kind === 'main' && t.idx[0] === i); return e ? Math.sign(e.coef) * s || -1 : -1; });
      best.max = { x: sign(1), y: predict(sign(1)) }; best.min = { x: sign(-1), y: predict(sign(-1)) };
    }
    const describe = b => b && { y: b.y, settings: factors.map((f, i) => ({ name: f.name, coded: b.x[i], actual: decode(f, b.x[i]) })) };

    return {
      n, k, factors, terms: effects, aliases, curvatureOnly, method, r2, adjR2, predR2, multiplicity,
      s: dfe > 0 ? Math.sqrt(sse / dfe) : null, dfe, curvature, hasSquares,
      mainEffects, interaction, optimum: { max: describe(best.max), min: describe(best.min) },
      residuals: resid, fitted, y
    };
  }
  function unit(v) { const n = Math.sqrt(v.reduce((s, a) => s + a * a, 0)); return v.map(a => a / n); }
  function orthResidual(v, basis) {
    let r = v.slice();
    for (let pass = 0; pass < 2; pass++) for (const b of basis) {
      const d = r.reduce((s, a, i) => s + a * b[i], 0);
      r = r.map((a, i) => a - d * b[i]);
    }
    return r;
  }

  // ---------- Design generation ----------
  function fullFactorial(k) {
    const runs = [];
    for (let i = 0; i < 1 << k; i++) runs.push(range(k).map(j => ((i >> j) & 1 ? 1 : -1)));
    return runs;
  }
  // Standard minimum-aberration generators (letters index the base factors).
  const FRACTIONS = {
    '3-1': { gens: ['AB'], res: 'III' },
    '4-1': { gens: ['ABC'], res: 'IV' },
    '5-1': { gens: ['ABCD'], res: 'V' },
    '6-1': { gens: ['ABCDE'], res: 'VI' },
    '6-2': { gens: ['ABC', 'BCD'], res: 'IV' },
    '7-1': { gens: ['ABCDEF'], res: 'VII' },
    '7-3': { gens: ['ABC', 'BCD', 'ACD'], res: 'IV' },
    '8-4': { gens: ['BCD', 'ACD', 'ABC', 'ABD'], res: 'IV' }
  };
  function fractional(k, p) {
    const spec = FRACTIONS[k + '-' + p];
    if (!spec) return null;
    const base = fullFactorial(k - p);
    const runs = base.map(r => r.concat(spec.gens.map(g => g.split('').reduce((s, ch) => s * r[LETTERS.indexOf(ch)], 1))));
    const genText = spec.gens.map((g, i) => LETTERS[k - p + i] + ' = ' + g);
    return { runs, resolution: spec.res, generators: genText };
  }
  function plackettBurman(k) {
    const gens = {
      12: '++-+++---+-',
      20: '++--++++-+-+----++-'
    };
    const N = k <= 11 ? 12 : k <= 19 ? 20 : null;
    if (!N) return null;
    const g = gens[N].split('').map(c => (c === '+' ? 1 : -1));
    const runs = [];
    for (let i = 0; i < N - 1; i++) runs.push(range(N - 1).map(j => g[(j - i + N - 1) % (N - 1)]));
    runs.push(new Array(N - 1).fill(-1));
    return runs.map(r => r.slice(0, k));
  }
  function centralComposite(k, faceCentered) {
    const cube = k >= 5 ? fractional(k, 1).runs : fullFactorial(k);
    const alpha = faceCentered ? 1 : Math.pow(cube.length, 0.25);
    const axial = [];
    for (let i = 0; i < k; i++) for (const s of [-alpha, alpha]) { const r = new Array(k).fill(0); r[i] = s; axial.push(r); }
    return { runs: cube.concat(axial), alpha };
  }
  function boxBehnken(k) {
    if (k < 3 || k > 7) return null;
    const runs = [];
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const r = new Array(k).fill(0); r[i] = a; r[j] = b; runs.push(r);
    }
    return runs;
  }

  /* ---------- Definitive screening designs ----------

     Jones and Nachtsheim (2011). The point of a DSD is that it screens many factors in few
     runs WITHOUT the compromise a Plackett-Burman screen makes: main effects come out clean
     of each other and clean of every two-factor interaction, and curvature in each factor is
     estimable rather than invisible. That last part matters in process work, where the
     interesting setting is usually inside the range rather than at a corner.

     The design is built from a conference matrix C: zero diagonal, plus or minus one off it,
     and columns at right angles, C'C = (n-1)I. Fold it over and add a centre run and the
     orthogonality properties follow from that structure. Conference matrices are constructed
     here by Paley's method over a finite field, and the defining property is checked before
     the matrix is used, so a bad design can never be handed out. */
  function quadraticCharacterPrime(q) {
    const squares = new Set();
    for (let x = 1; x < q; x++) squares.add((x * x) % q);
    return d => { const v = ((d % q) + q) % q; return v === 0 ? 0 : squares.has(v) ? 1 : -1; };
  }
  // GF(9) is the one non-prime field needed to reach a conference matrix of order 10.
  function gf9Field() {
    const els = [];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) els.push([a, b]);
    const mul = (x, y) => [(((x[0] * y[0] - x[1] * y[1]) % 3) + 3) % 3, (((x[0] * y[1] + x[1] * y[0]) % 3) + 3) % 3];
    const squares = new Set();
    for (const e of els) if (e[0] || e[1]) squares.add(mul(e, e).join(','));
    return {
      els,
      sub: (x, y) => [(((x[0] - y[0]) % 3) + 3) % 3, (((x[1] - y[1]) % 3) + 3) % 3],
      chi: x => (!x[0] && !x[1] ? 0 : squares.has(x.join(',')) ? 1 : -1)
    };
  }
  const isPrime = n => { if (n < 2) return false; for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
  function conferenceMatrix(n) {
    const q = n - 1;
    let els, chi, sub;
    if (isPrime(q)) { els = range(q); chi = quadraticCharacterPrime(q); sub = (a, b) => a - b; }
    else if (q === 9) { const F = gf9Field(); els = F.els; chi = F.chi; sub = F.sub; }
    else return null;
    const Q = els.map(ai => els.map(aj => chi(sub(aj, ai))));
    // q = 1 mod 4 gives a symmetric matrix, q = 3 mod 4 a skew one. Both are conference
    // matrices; only the sign of the first column differs.
    const firstCol = q % 4 === 1 ? 1 : -1;
    const C = [];
    for (let i = 0; i < n; i++) {
      const row = new Array(n).fill(0);
      for (let j = 0; j < n; j++) {
        if (i === 0 && j === 0) row[j] = 0;
        else if (i === 0) row[j] = 1;
        else if (j === 0) row[j] = firstCol;
        else row[j] = Q[i - 1][j - 1];
      }
      C.push(row);
    }
    // Never return something unverified: the whole design rests on this property.
    for (let i = 0; i < n; i++) {
      if (C[i][i] !== 0) return null;
      for (let j = 0; j < n; j++) {
        if (i !== j && Math.abs(C[i][j]) !== 1) return null;
        let dot = 0;
        for (let r = 0; r < n; r++) dot += C[r][i] * C[r][j];
        if (dot !== (i === j ? n - 1 : 0)) return null;
      }
    }
    return C;
  }
  /* For an even number of factors the conference matrix of that order is used directly, in
     2m+1 runs. For an odd number there is no conference matrix to use, so one is built for
     m+1 factors and the spare column dropped, which costs two extra runs. */
  function definitiveScreening(k) {
    const n = k % 2 === 0 ? k : k + 1;
    const C = conferenceMatrix(n);
    if (!C) return null;
    const runs = [];
    for (const row of C) runs.push(row.slice(0, k));
    for (const row of C) runs.push(row.slice(0, k).map(v => -v));
    runs.push(new Array(k).fill(0));
    return { runs, order: n, fake: n !== k };
  }

  /* ---------- Mixture designs ----------

     A mixture is different in kind from a factorial: the components are proportions of one
     blend, so they must add to the total and none of them can be moved on its own. That one
     constraint rules out the usual designs and the usual model, because with a fixed sum the
     columns are linearly dependent and an intercept cannot be estimated at all. */
  const choose = (n, r) => { let v = 1; for (let i = 0; i < r; i++) v = v * (n - i) / (i + 1); return Math.round(v); };
  // Simplex lattice {q, d}: every blend whose components are whole multiples of 1/d.
  function simplexLattice(q, d) {
    const out = [];
    const walk = (i, left, acc) => {
      if (i === q - 1) { out.push(acc.concat([left / d])); return; }
      for (let a = 0; a <= left; a++) walk(i + 1, left - a, acc.concat([a / d]));
    };
    walk(0, d, []);
    return out;
  }
  // Simplex centroid: every pure component, every equal blend of two, of three, and so on.
  function simplexCentroid(q) {
    const out = [];
    for (let mask = 1; mask < (1 << q); mask++) {
      const idx = [];
      for (let i = 0; i < q; i++) if (mask & (1 << i)) idx.push(i);
      const pt = new Array(q).fill(0);
      idx.forEach(i => { pt[i] = 1 / idx.length; });
      out.push(pt);
    }
    return out;
  }
  /* Extreme vertices, by McLean and Anderson's method. Real formulations have a minimum and
     a maximum for every component, which cuts the simplex down to a smaller polytope; the
     corners of that polytope are where the information is. Each candidate corner comes from
     holding all but one component at a bound and letting the sum fix the last one. */
  function extremeVertices(lows, highs, opt) {
    opt = opt || {};
    const q = lows.length;
    const eps = 1e-9;
    const sumLow = lows.reduce((a, b) => a + b, 0), sumHigh = highs.reduce((a, b) => a + b, 0);
    if (sumLow > 1 + eps) throw new Error('The minimum proportions add up to ' + sumLow.toFixed(4) + ', which is more than the whole blend. Lower them.');
    if (sumHigh < 1 - eps) throw new Error('The maximum proportions only add up to ' + sumHigh.toFixed(4) + ', so they cannot fill the blend. Raise them.');
    for (let i = 0; i < q; i++) if (!(highs[i] > lows[i] - eps)) throw new Error('Component ' + (i + 1) + ' has a maximum below its minimum.');
    const seen = new Map();
    // free: the component the sum constraint solves for; the rest sit on a bound.
    for (let free = 0; free < q; free++) {
      const others = range(q).filter(i => i !== free);
      for (let mask = 0; mask < (1 << others.length); mask++) {
        const pt = new Array(q).fill(0);
        let used = 0;
        others.forEach((oi, bit) => { const v = (mask & (1 << bit)) ? highs[oi] : lows[oi]; pt[oi] = v; used += v; });
        pt[free] = 1 - used;
        if (pt[free] < lows[free] - 1e-7 || pt[free] > highs[free] + 1e-7) continue;
        const key = pt.map(v => v.toFixed(6)).join('|');
        if (!seen.has(key)) seen.set(key, pt);
      }
    }
    const vertices = Array.from(seen.values());
    if (!vertices.length) throw new Error('Those bounds leave no feasible blend. Check that the minimums and maximums can be satisfied together.');
    const points = vertices.slice();
    const add = pt => {
      const key = pt.map(v => v.toFixed(6)).join('|');
      if (!seen.has(key)) { seen.set(key, pt); points.push(pt); }
    };
    // The centroid of the feasible region, and the midpoint of every edge: the interior
    // points that let a curved (quadratic) blending model be fitted and checked.
    if (opt.centroid !== false && vertices.length > 1) {
      const c = new Array(q).fill(0);
      vertices.forEach(v => v.forEach((x, i) => { c[i] += x / vertices.length; }));
      add(c);
    }
    if (opt.edges && vertices.length > 1) {
      for (let i = 0; i < vertices.length; i++) for (let j = i + 1; j < vertices.length; j++) {
        add(vertices[i].map((x, c2) => (x + vertices[j][c2]) / 2));
      }
    }
    return { points, vertices: vertices.length };
  }

  /* Scheffe blending model. With the components summing to a constant there is no intercept
     to fit: each pure-component coefficient IS the predicted response for that component on
     its own, and each cross term says whether blending two of them does better or worse than
     the straight average of the two. That reading is the whole appeal of the form. */
  function analyzeMixture(points, y, names, opt) {
    opt = opt || {};
    const q = points[0].length, n = points.length;
    const terms = [];
    for (let i = 0; i < q; i++) terms.push({ label: names[i], idx: [i] });
    const quadratic = opt.model !== 'linear' && n >= q + choose(q, 2);
    if (quadratic) for (let i = 0; i < q; i++) for (let j = i + 1; j < q; j++) terms.push({ label: names[i] + ' x ' + names[j], idx: [i, j] });
    const build = ts => points.map(p => ts.map(t => t.idx.reduce((v, i) => v * p[i], 1)));
    const fit = ts => {
      const X = build(ts);
      const G = E.gram(X), Gi = E.invert(G);
      if (!Gi) return null;
      const Xty = ts.map((_, j) => X.reduce((s, r, i) => s + r[j] * y[i], 0));
      const beta = Gi.map(row => row.reduce((s, v, j) => s + v * Xty[j], 0));
      const pred = X.map(r => r.reduce((s, v, j) => s + v * beta[j], 0));
      const ybar = y.reduce((a, b) => a + b, 0) / n;
      const sse = y.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0);
      const sst = y.reduce((s, v) => s + (v - ybar) ** 2, 0);
      const df = n - ts.length;
      return { terms: ts, beta, pred, sse, sst, df, r2: sst > 0 ? 1 - sse / sst : null, rmse: df > 0 ? Math.sqrt(sse / df) : null, Gi };
    };
    let model = quadratic ? fit(terms) : null;
    let usedQuadratic = !!model;
    /* Enough blends is not the same as the right blends: a bounded design can carry more
       points than terms and still be rank deficient, because its points lie on a flat of
       the simplex. Worth distinguishing, because the cure is different - interior and edge
       blends rather than simply more of the same corners. */
    const singular = quadratic && !model;
    if (!model) { model = fit(terms.slice(0, q)); usedQuadratic = false; }
    if (!model) throw new Error('The blends supplied do not support a model: they may be too few, or they may all lie on one line.');
    // Standard errors, so a cross term can be judged rather than just admired.
    const s2 = model.df > 0 ? model.sse / model.df : null;
    const coefs = model.terms.map((t, j) => {
      const se = s2 === null ? null : Math.sqrt(Math.max(0, s2 * model.Gi[j][j]));
      const tv = se && se > 0 ? model.beta[j] / se : null;
      return { label: t.label, idx: t.idx, beta: model.beta[j], se, t: tv, p: tv === null ? null : E.tTestP(Math.abs(tv), model.df), pure: t.idx.length === 1 };
    });
    /* How far each component was actually pushed. A pure-component coefficient is the model's
       value at x_i = 1, and with realistic minimums and maximums that blend is usually not one
       anybody could make, let alone ran. Reporting it as "the response from that component
       alone" without saying so would be the most natural way to mislead someone here. */
    const maxObserved = range(q).map(i => Math.max.apply(null, points.map(p => p[i])));
    coefs.forEach(c => { if (c.pure) { c.maxObserved = maxObserved[c.idx[0]]; c.extrapolated = maxObserved[c.idx[0]] < 0.999; } });
    return {
      q, n, names, quadratic: usedQuadratic, singular, coefs, r2: model.r2, rmse: model.rmse, df: model.df,
      maxObserved, anyExtrapolated: coefs.some(c => c.extrapolated),
      termsWanted: q + (q * (q - 1)) / 2, termsFitted: model.terms.length,
      predict: pt => model.terms.reduce((s, t, j) => s + model.beta[j] * t.idx.reduce((v, i) => v * pt[i], 1), 0)
    };
  }

  /* One entry point for the three mixture layouts, returning proportions that always add to
     one. The amounts the operator actually weighs out come later, from the batch total. */
  function mixtureDesign(type, comps, opt) {
    opt = opt || {};
    const q = comps.length;
    if (q < 2) throw new Error('A mixture needs at least 2 components.');
    const lows = comps.map(c => Number(c.low) || 0);
    const highs = comps.map(c => (c.high === undefined || c.high === null || c.high === '' ? 1 : Number(c.high)));
    if (type === 'mixVertices') return extremeVertices(lows, highs, opt);
    const bounded = lows.some(v => v > 1e-9) || highs.some(v => v < 1 - 1e-9);
    const pts = type === 'mixCentroid' ? simplexCentroid(q) : simplexLattice(q, Math.max(1, Math.min(5, opt.degree || (q <= 4 ? 3 : 2))));
    /* Bounds and an unbounded layout do not mix: a lattice point can sit outside the
       formulable region entirely. Rather than quietly dropping runs, say so and point at the
       layout that handles bounds properly. */
    if (bounded) {
      const bad = pts.filter(p => p.some((v, i) => v < lows[i] - 1e-7 || v > highs[i] + 1e-7)).length;
      if (bad) throw new Error('You have set minimum or maximum proportions, and ' + bad + ' of the ' + pts.length + ' blends in this layout fall outside them. Use "Mixture: extreme vertices (with limits)", which is built for bounded components.');
    }
    return { points: pts, vertices: pts.filter(p => p.filter(v => v > 1e-9).length === 1).length };
  }

  const DESIGNS = {
    full: { name: 'Full factorial (2 levels)', min: 1, max: 7, purpose: 'Estimates every main effect and every interaction. The gold standard when you have 2 to 4 factors.' },
    half: { name: 'Fractional factorial (half fraction)', min: 3, max: 7, purpose: 'Half the runs of a full factorial. Some interactions are confounded (aliased), so it suits 4 to 6 factors.' },
    res4: { name: 'Fractional factorial (16 runs, resolution IV)', min: 6, max: 8, purpose: 'Screens 6 to 8 factors in 16 runs. Main effects are clean; two-factor interactions are aliased with each other.' },
    pb: { name: 'Plackett-Burman screening', min: 2, max: 19, purpose: 'Screens many factors (up to 11 in 12 runs, 19 in 20 runs) to find the vital few. Main effects only.' },
    ccd: { name: 'Central composite (response surface)', min: 2, max: 6, purpose: 'Finds curvature and the sweet spot. Use after screening, on the 2 to 5 factors that matter.' },
    ccf: { name: 'Face-centered central composite', min: 2, max: 6, purpose: 'Response surface that never leaves the low-high box. Use when going beyond the limits is unsafe.' },
    bbd: { name: 'Box-Behnken (response surface)', min: 3, max: 7, purpose: 'Response surface with 3 levels per factor and no extreme corner runs. Good when corners are risky or costly.' },
    dsd: { name: 'Definitive screening design', min: 3, max: 14, purpose: 'Screens many factors in about twice their number of runs, with main effects clean of each other AND of every two-factor interaction, and curvature still visible. The modern replacement for a Plackett-Burman screen.' },
    mixLattice: { name: 'Mixture: simplex lattice', min: 2, max: 8, mixture: true, purpose: 'For a formulation, where the components are proportions of one blend and have to add up. An even spread of blends across the whole range.' },
    mixCentroid: { name: 'Mixture: simplex centroid', min: 2, max: 7, mixture: true, purpose: 'Every pure component, every equal pair, every equal triple, and so on. Compact, and good at exposing whether blending helps or hurts.' },
    mixVertices: { name: 'Mixture: extreme vertices (with limits)', min: 2, max: 8, mixture: true, purpose: 'For a formulation where every component has a realistic minimum and maximum. Puts the runs at the corners of what is actually formulable, plus the middle.' }
  };

  /* factors: [{name, low, high}] ; opts: {type, centerPoints, replicates, randomize, seed} */
  function generate(factors, opts) {
    const k = factors.length;
    const type = opts.type;
    const spec = DESIGNS[type];
    if (!spec) throw new Error('Unknown design type');
    if (k < spec.min || k > spec.max) throw new Error(spec.name + ' needs ' + spec.min + ' to ' + spec.max + ' factors; you have ' + k + '.');
    let coded, notes = [];
    if (type === 'full') coded = fullFactorial(k);
    else if (type === 'half') {
      const f = fractional(k, 1); coded = f.runs;
      notes.push('Resolution ' + f.resolution + '. Generator: ' + f.generators.join(', ') + '.');
    } else if (type === 'res4') {
      const f = fractional(k, k - 4); coded = f.runs;
      notes.push('Resolution ' + f.resolution + '. Generators: ' + f.generators.join(', ') + '.');
    } else if (type === 'pb') {
      coded = plackettBurman(k);
      notes.push('Main effects are partly confounded with two-factor interactions. Follow up on the vital few.');
    } else if (type === 'ccd' || type === 'ccf') {
      const c = centralComposite(k, type === 'ccf'); coded = c.runs;
      notes.push('Axial distance alpha = ' + c.alpha.toFixed(3) + (type === 'ccd' ? ' (rotatable). Axial runs go beyond your low/high settings; check they are safe.' : ' (axial runs on the box faces).'));
    } else if (type === 'bbd') coded = boxBehnken(k);
    else if (type === 'dsd') {
      const d = definitiveScreening(k);
      if (!d) throw new Error('No definitive screening design is available for ' + k + ' factors. Use a Plackett-Burman screen instead.');
      coded = d.runs;
      notes.push('Main effects are orthogonal to each other and to every two-factor interaction, so a large interaction cannot masquerade as a main effect the way it can in a Plackett-Burman screen.');
      notes.push('Every factor is run at its middle setting as well as its extremes, so curvature in each one is estimable: this screen can tell you that the best setting is inside your range, not just at an end.');
      if (d.fake) notes.push('With an odd number of factors the design is built for ' + d.order + ' and the spare column dropped, which costs two extra runs and loses nothing.');
      notes.push('Two-factor interactions are not fully separable from each other. Treat a large one as a lead to confirm, not a conclusion.');
    }

    // ---- mixtures take a different path: proportions of a blend, not coded levels ----
    if (spec.mixture) {
      const total = Number(opts.total) > 0 ? Number(opts.total) : 100;
      const pcts = factors.map(f => ({
        low: f.low === '' || f.low === undefined || f.low === null ? 0 : Number(f.low) / 100,
        high: f.high === '' || f.high === undefined || f.high === null ? 1 : Number(f.high) / 100
      }));
      if (factors.some(f => f.categorical)) throw new Error('A mixture component has to be a proportion of the blend, so it cannot be categorical. Hold it fixed and design the blend for each setting separately.');
      if (pcts.some(c => !isFinite(c.low) || !isFinite(c.high) || c.low < 0 || c.high > 1)) {
        throw new Error('Mixture components are given as a minimum and maximum percentage of the blend, between 0 and 100.');
      }
      const res = mixtureDesign(type, pcts, { degree: opts.degree, edges: !!opts.edges });
      let pts = res.points;
      const reps2 = Math.max(1, opts.replicates || 1);
      let all2 = [];
      for (let r = 0; r < reps2; r++) all2 = all2.concat(pts.map(x => x.slice()));
      /* The amounts have to add up on the bench, so everything is rounded except the largest
         component, which absorbs the rounding. A run sheet whose column does not sum to the
         batch size gets questioned, and rightly. */
      const dec = total >= 1000 ? 2 : total >= 100 ? 3 : 4;
      const rows2 = all2.map((pt, i) => {
        const amounts = pt.map(v => Number((v * total).toFixed(dec)));
        let big = 0;
        for (let j = 1; j < amounts.length; j++) if (pt[j] > pt[big]) big = j;
        const others = amounts.reduce((sx, v, j) => sx + (j === big ? 0 : v), 0);
        amounts[big] = Number((total - others).toFixed(dec));
        return { std: i + 1, coded: pt, actual: amounts, proportions: pt };
      });
      if (opts.randomize !== false) {
        const order = E.shuffle(range(rows2.length), E.rng(opts.seed || Date.now()));
        order.forEach((ri, pos) => { rows2[ri].run = pos + 1; });
        rows2.sort((a, b) => a.run - b.run);
      } else rows2.forEach(r => { r.run = r.std; });
      notes.push('Every blend adds up to ' + total + '. The components are proportions of one mixture, so none of them can be changed on its own — raising one necessarily lowers the others, which is why an ordinary factorial design cannot be used here.');
      notes.push('Analyse this with a Scheffé blending model, not the usual factorial analysis: with the components summing to a constant there is no intercept to estimate. Each component\'s coefficient is the predicted response for that component on its own, and a cross term says whether a blend beats the straight average of its parts.');
      if (type === 'mixVertices') notes.push('Found ' + res.vertices + ' corners of the formulable region, plus its centre. The corners carry the most information; the centre is what lets a curved blending model be checked rather than assumed.');
      if (type === 'mixLattice') notes.push('An even lattice across the whole simplex. It covers the space well but spends runs on blends that may be of no practical interest — if every component has a realistic minimum and maximum, the extreme-vertices layout is the better buy.');
      return { type, name: spec.name, purpose: spec.purpose, k, runs: rows2, notes, mixture: true, total, vertices: res.vertices };
    }

    const reps = Math.max(1, opts.replicates || 1);
    let all = [];
    for (let r = 0; r < reps; r++) all = all.concat(coded.map(x => x.slice()));
    let centers = Math.max(0, opts.centerPoints || 0);
    if ((type === 'ccd' || type === 'ccf' || type === 'bbd') && centers < 3) { centers = Math.max(centers, 3); notes.push('At least 3 center points are included to estimate pure error and curvature.'); }
    if (type === 'dsd' && centers > 0) notes.push('The design already includes one centre run; the ' + centers + ' you asked for are added on top, which gives a pure-error estimate.');
    for (let c = 0; c < centers; c++) all.push(new Array(k).fill(0));
    if ((type === 'ccd' || type === 'ccf' || type === 'bbd') && factors.some(f => f.categorical)) throw new Error('Response-surface designs need numeric factors. Hold categorical factors fixed or use a factorial design.');
    if (type === 'dsd' && factors.some(f => f.categorical)) throw new Error('A definitive screening design runs every factor at three levels, so it needs numeric factors. Hold categorical factors fixed, or screen with a fractional factorial.');
    const rows = all.map((x, i) => ({ std: i + 1, coded: x, actual: x.map((c, j) => decodeRange(factors[j], c, i)) }));
    if (opts.randomize !== false) {
      const order = E.shuffle(range(rows.length), E.rng(opts.seed || Date.now()));
      order.forEach((ri, pos) => { rows[ri].run = pos + 1; });
      rows.sort((a, b) => a.run - b.run);
    } else rows.forEach(r => { r.run = r.std; });
    return { type, name: spec.name, purpose: spec.purpose, k, runs: rows, notes };
  }
  function decodeRange(f, c, i) {
    // Categorical factors have no middle; center runs alternate between the two levels.
    if (f.categorical) return c > 0 ? f.high : c < 0 ? f.low : (i % 2 ? f.high : f.low);
    const lo = Number(f.low), hi = Number(f.high);
    const v = (lo + hi) / 2 + c * (hi - lo) / 2;
    const step = Math.abs(hi - lo) / 1000 || 1e-6;
    const decimals = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step))));
    return Number(v.toFixed(decimals));
  }

  // Picks a design for k factors given what the agent learned.
  function recommend(k, opts) {
    opts = opts || {};
    if (opts.curvature && k <= 5) return { type: 'ccd', centerPoints: 3, why: 'There is evidence of curvature, so a response-surface design will locate the sweet spot.' };
    if (k <= 4) return { type: 'full', centerPoints: 3, why: 'With ' + k + ' factors a full factorial is affordable (' + (1 << k) + ' runs) and shows every interaction. Center points test for curvature.' };
    if (k === 5) return { type: 'half', centerPoints: 3, why: '5 factors in 16 runs at resolution V: main effects and two-factor interactions are all clear.' };
    if (k <= 8) return { type: 'res4', centerPoints: 2, why: k + ' factors in 16 runs. Screens main effects cleanly; follow up on interactions of the factors that matter.' };
    /* Past eight factors a definitive screening design is the better screen: about the same
       number of runs as a Plackett-Burman, but main effects cannot be confused with
       interactions and curvature stays visible. */
    if (k <= 14) return { type: 'dsd', centerPoints: 0, why: k + ' factors in ' + (k % 2 ? 2 * k + 3 : 2 * k + 1) + ' runs, with main effects clean of every two-factor interaction and curvature still estimable. Cheaper to interpret than a Plackett-Burman screen of the same size.' };
    return { type: 'pb', centerPoints: 0, why: k + ' candidate factors is a lot. A Plackett-Burman screen finds the vital few cheaply.' };
  }

  function toCSV(design, factors, responseName) {
    const esc = s => (/[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s));
    const head = ['RunOrder', 'StdOrder'].concat(factors.map(f => f.name)).concat([responseName || 'Response']);
    const lines = [head.map(esc).join(',')];
    for (const r of design.runs) lines.push([r.run, r.std].concat(r.actual).concat(['']).map(esc).join(','));
    return lines.join('\n') + '\n';
  }

  root.MLDoe = { detect, analyze, generate, recommend, toCSV, DESIGNS, fullFactorial, fractional, plackettBurman, centralComposite, boxBehnken, code, decode,
    conferenceMatrix, definitiveScreening, simplexLattice, simplexCentroid, extremeVertices, analyzeMixture, mixtureDesign };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MLDoe;
})(typeof globalThis !== 'undefined' ? globalThis : this);
