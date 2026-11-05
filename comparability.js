/* Multi-attribute comparability: one verdict over the whole transfer, not a dozen verdicts.

   A site transfer covers every quality attribute that matters - purity, the aggregate, the
   charge variants, potency, a handful of impurities. Comparing them one at a time gives a
   dozen separate runs with nothing joining them, and the thing nobody joins is the part that
   decides whether the study was ever going to work.

   Two facts pull in opposite directions, and both are usually got wrong.

   THE GOOD NEWS, which people throw away. Requiring EVERY attribute to pass needs no
   multiplicity correction at all. This is an intersection-union test: to wrongly declare the
   sites comparable you would have to wrongly pass every single attribute, so the chance of a
   false overall pass is at most the chance for one, whatever the number of attributes. The
   reflex is to Bonferroni the alphas or tighten the margins, and that reflex makes the study
   far harder for nothing. Each attribute is tested at the full alpha.

   Measured, with every attribute sitting exactly on its margin - the worst case for a false
   pass - at 20 per site and alpha 5%:

       attributes:         1        3        6       12       20
       independent:     4.6%     0.0%     0.0%     0.0%     0.0%
       correlation 0.6  4.6%     0.8%     0.2%     0.1%     0.0%
       correlation 0.9  4.6%     2.2%     1.5%     1.2%     0.7%
       Bonferroni alpha 5.0%    1.7%    0.83%    0.42%    0.25%

   The rate does not creep up as attributes are added; it FALLS. So a Bonferroni correction
   here is not merely unnecessary, it is conservative on top of something already conservative
   - it would hold a twelve-attribute transfer to 0.42% when the real rate is already under
   1.2%, and the batches that buys are batches nobody needed to make.

   THE BAD NEWS, which people do not price in. The POWER goes the other way and collapses. If
   each of twelve attributes passes 80% of the time, all twelve passing is far less likely
   than 80%, and a per-attribute sample size calculation says nothing about it. Measured here
   on simulated studies, each attribute individually powered at 80%:

       attributes:        1        3        6       12
       independent:    79.5%    51.7%    26.9%     6.7%
       correlation 0.3 79.5%    53.7%    30.8%    10.0%
       correlation 0.6 79.5%    58.1%    41.4%    24.1%
       correlation 0.9 79.5%    67.7%    60.4%    52.4%

   So the usual quoted figure - twelve at 80% gives 0.8^12, about 7% - is the INDEPENDENCE
   case, and it is the worst case. Quality attributes measured on the same batches share
   batch-level variation, so they are correlated, and correlation helps: at 0.6 the same study
   reaches 24% rather than 7%. Still nowhere near 80%, still needing more batches than a
   per-attribute calculation asks for, but three times better than the pessimistic number -
   which matters when the difference decides whether a transfer gets booked at all.

   The correlation is MEASURED from the data rather than assumed either way. That is the whole
   reason this is worth building: both 7% and 80% are wrong, and which is closer is a property
   of your attributes that nobody can know in advance.

   Depends on the engine, tost.js and tolerance.js. No network, no storage. */
(function (root) {
  'use strict';
  const E = root.MLEngine || require('./engine.js');
  const TOST = () => root.MLTost || require('./tost.js');
  const TL = () => root.MLTolerance || require('./tolerance.js');
  const num = v => v !== null && v !== undefined && v !== '' && isFinite(Number(v));
  const normal = r => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  /* Cholesky factor, with the diagonal floored. A correlation matrix estimated from a handful
     of batches need not be positive definite, and a simulation that throws on the user's data
     is worse than one that runs on a slightly nudged matrix and says so. */
  function cholesky(M) {
    const k = M.length, L = Array.from({ length: k }, () => new Array(k).fill(0));
    let nudged = false;
    for (let i = 0; i < k; i++) for (let j = 0; j <= i; j++) {
      let s = M[i][j];
      for (let m = 0; m < j; m++) s -= L[i][m] * L[j][m];
      if (i === j) { if (s <= 1e-9) nudged = true; L[i][j] = Math.sqrt(Math.max(1e-9, s)); }
      else L[i][j] = L[j][j] > 1e-12 ? s / L[j][j] : 0;
    }
    return { L, nudged };
  }

  /* P(every attribute passes its own TOST), at a given n per group, by simulation on the
     correlation actually present. Each attribute's DIFFERENCE is correlated with the others
     because they share batches; each attribute's variance estimate is independent, because
     the residual spread of one attribute says nothing about another's. */
  function combinedPower(attrs, corr, n, opt) {
    opt = opt || {};
    const reps = opt.reps || 3000;
    const alpha = opt.alpha === undefined ? 0.05 : opt.alpha;
    const k = attrs.length;
    if (!k) return null;
    const df = Math.max(1, 2 * n - 2);
    const crit = E.tQuantile(alpha, df);
    const { L } = cholesky(corr);
    const rand = E.rng(opt.seed === undefined ? 23 : opt.seed);
    let all = 0;
    const z = new Array(k);
    for (let t = 0; t < reps; t++) {
      for (let j = 0; j < k; j++) z[j] = normal(rand);
      let pass = 0;
      for (let j = 0; j < k; j++) {
        const a = attrs[j];
        let cz = 0;
        for (let q = 0; q <= j; q++) cz += L[j][q] * z[q];
        const seTrue = a.sd * Math.sqrt(2 / n);
        const diff = a.assumedDiff + cz * seTrue;
        let ss = 0;
        for (let i = 0; i < df; i++) { const g = normal(rand); ss += g * g; }
        const seHat = a.sd * Math.sqrt(ss / df) * Math.sqrt(2 / n);
        if (diff - crit * seHat > -a.margin && diff + crit * seHat < a.margin) pass++;
      }
      if (pass === k) all++;
    }
    return all / reps;
  }

  function analyze(rows, opt) {
    opt = opt || {};
    const clean = (rows || []).map(r => {
      if (!r) return null;
      const attribute = r.attribute === undefined || r.attribute === null ? '' : String(r.attribute).trim();
      const group = r.group === undefined || r.group === null ? '' : String(r.group).trim();
      if (!attribute || !group || !num(r.value)) return null;
      return { attribute, group, value: Number(r.value), sample: r.sample === undefined || r.sample === null ? '' : String(r.sample).trim() };
    }).filter(Boolean);
    if (!clean.length) throw new Error('No usable rows. Each row needs an attribute name, which site or method it came from, and the result.');

    const names = [];
    clean.forEach(r => { if (!names.includes(r.attribute)) names.push(r.attribute); });
    if (names.length < 2) throw new Error('Only one attribute ("' + names[0] + '") is present. One attribute is an equivalence test, which the equivalence bench already does - this mode exists to join several into one verdict.');

    const groups = [];
    clean.forEach(r => { if (!groups.includes(r.group)) groups.push(r.group); });
    if (groups.length < 2) throw new Error('Two sites or methods are needed to compare. Found only "' + groups[0] + '".');
    const reference = opt.reference && groups.includes(opt.reference) ? opt.reference : groups[0];
    const test = opt.test && groups.includes(opt.test) && opt.test !== reference ? opt.test : groups.find(g => g !== reference);
    if (groups.length > 2 && !(opt.reference && opt.test)) throw new Error('Found ' + groups.length + ' sites (' + groups.join(', ') + '). Choose which two to compare; comparing all pairs at once is a different claim and needs a different margin.');

    const alpha = opt.alpha > 0 && opt.alpha < 0.5 ? opt.alpha : 0.05;
    const marginOf = name => {
      if (opt.margins && num(opt.margins[name])) return Math.abs(Number(opt.margins[name]));
      if (num(opt.margin)) return Math.abs(Number(opt.margin));
      return null;
    };

    /* Each attribute goes through the same TOST the equivalence bench uses, so a verdict here
       and a verdict there on the same attribute cannot disagree. */
    const T = TOST();
    const attributes = names.map(name => {
      const sub = clean.filter(r => r.attribute === name && (r.group === reference || r.group === test));
      const margin = marginOf(name);
      const out = { name, margin, n: { } };
      out.n[reference] = sub.filter(r => r.group === reference).length;
      out.n[test] = sub.filter(r => r.group === test).length;
      if (margin === null) { out.error = 'No equivalence margin given for "' + name + '". A margin is a judgement about what difference would matter clinically or analytically, and the tool will not invent one.'; return out; }
      try {
        const r = T.analyze(sub.map(r => ({ group: r.group, value: r.value, sample: r.sample })),
          { margin, marginType: opt.marginType, alpha, reference, test });
        out.tost = r;
        out.diff = r.diff; out.ciLow = r.ciLow; out.ciHigh = r.ciHigh;
        out.equivalent = !!r.equivalent; out.verdict = r.verdict;
        /* The spread the power simulation needs, taken from the two groups' own standard
           deviations rather than reverse-engineered out of the standard error. Working back
           from the error means assuming how it was formed, and TOST picks between pooled,
           Welch and paired on the data - a paired design would make that back-calculation
           wrong by a factor of root two, silently, in every sample size below. */
        const sA = r.refStats && r.refStats.sd, sB = r.testStats && r.testStats.sd;
        const nA = out.n[reference], nB = out.n[test];
        out.sd = (sA > 0 || sB > 0) && nA > 1 && nB > 1
          ? Math.sqrt(((nA - 1) * sA * sA + (nB - 1) * sB * sB) / (nA + nB - 2))
          : null;
        if (r.paired && r.pairs > 1) {
          /* A paired study's comparison rests on the spread of the DIFFERENCES, which is
             smaller than the pooled spread whenever the pairing works. Carried through so the
             sizing reflects the design that was actually run. */
          out.pairedSd = r.se * Math.sqrt(r.pairs);
        }
        /* Headroom: how much of the margin the interval has already spent. Above 1 means it
           does not fit, and the largest value across attributes is what the whole claim rests
           on - an intersection-union test is exactly as strong as its weakest member. */
        out.spent = Math.max(Math.abs(r.ciLow), Math.abs(r.ciHigh)) / margin;
      } catch (e) { out.error = e.message; }
      return out;
    });

    const usable = attributes.filter(a => a.tost && a.sd > 0);
    const failed = attributes.filter(a => a.error);
    if (!usable.length) throw new Error('No attribute could be tested. ' + (failed[0] ? failed[0].error : ''));

    const allEquivalent = attributes.every(a => a.equivalent === true);
    const anyUntested = failed.length > 0;
    const binding = usable.slice().sort((a, b) => b.spent - a.spent)[0];

    /* The correlation between the attribute comparisons, measured. Where the same samples were
       run at both sites, the per-sample differences are the right thing to correlate. Where
       they were not, the within-group correlation between attributes carries to the
       differences and is used instead, pooled across the two groups. */
    const corrInfo = estimateCorrelation(clean, usable.map(a => a.name), reference, test);
    const k = usable.length;
    const corr = corrInfo.matrix;

    const nMin = Math.min.apply(null, usable.map(a => Math.min(a.n[reference], a.n[test])));
    const simAttrs = usable.map(a => ({
      sd: a.sd, margin: a.margin, paired: !!a.pairedSd,
      assumedDiff: opt.assumeZeroDifference === false ? a.diff : 0
    }));

    const observedPower = combinedPower(simAttrs, corr, nMin, { alpha, reps: opt.reps || 3000, seed: 23 });
    const indepPower = combinedPower(simAttrs, identity(k), nMin, { alpha, reps: opt.reps || 3000, seed: 23 });
    const perAttrPowers = usable.map(a => TL().powerTost({ n: nMin, sd: a.sd, margin: a.margin, diff: simAttrs[usable.indexOf(a)].assumedDiff, alpha }).power);
    const weakestPerAttr = Math.min.apply(null, perAttrPowers);

    /* Sizing for the WHOLE claim, which is the number nobody has. Searched rather than solved,
       because the combined power has no closed form once the attributes are correlated. */
    const target = opt.power > 0 && opt.power < 1 ? opt.power : 0.8;
    const sized = sizeForCombined(simAttrs, corr, target, { alpha, reps: opt.sizeReps || 1500, seed: 29, maxN: opt.maxN || 400 });
    const perAttrN = usable.map(a => {
      try { return TL().sampleSizeTost({ sd: a.sd, margin: a.margin, diff: 0, alpha }, target).n; } catch (e) { return null; }
    }).filter(v => v !== null);
    const perAttrNeeded = perAttrN.length ? Math.max.apply(null, perAttrN) : null;

    const pctOf = v => (v === null ? '–' : (100 * v).toFixed(0) + '%');
    const why = k + ' attribute' + (k === 1 ? '' : 's') + ' compared between ' + test + ' and ' + reference +
      ' at ' + nMin + ' result' + (nMin === 1 ? '' : 's') + ' per site' + (anyUntested ? ', with ' + failed.length + ' left untested' : '') + '. ' +
      (allEquivalent
        ? 'Every attribute fits inside its margin, so the sites are comparable on this evidence. '
        : 'At least one attribute does not fit inside its margin, so the transfer does not pass as a whole: ' +
          usable.filter(a => !a.equivalent).map(a => a.name).join(', ') + '. ') +
      'This is an intersection-union test, and the point worth taking from it is that NO multiplicity correction is needed: to wrongly call the sites comparable you would have to wrongly pass every attribute, so the false-pass rate is at most ' +
      (100 * alpha).toFixed(0) + '% however many attributes there are. Measured with every attribute sitting exactly on its margin, which is the worst case, the rate does not creep up with more attributes - it falls, to under 1.2% by twelve. So splitting alpha between them, the usual reflex, would hold this study to ' +
      (100 * alpha / k).toFixed(2) + '% when it is already stricter than that, and the extra batches it costs buy nothing. ' +
      'The cost sits in the power instead, and that is where a per-attribute calculation misleads. ' +
      'The weakest single attribute here has about ' + pctOf(weakestPerAttr) + ' power at this sample size; the chance that ALL ' + k +
      ' pass is ' + pctOf(observedPower) + '. ' +
      (corrInfo.mean === null ? 'The correlation between the attributes could not be estimated, so they were treated as independent, which is the pessimistic case. '
        : 'Treating them as independent would have said ' + pctOf(indepPower) + '; the attributes actually correlate at about ' + corrInfo.mean.toFixed(2) +
          ' (' + corrInfo.basis + '), which ' + (observedPower > indepPower + 0.02 ? 'raises it to ' + pctOf(observedPower) + ' - correlated attributes tend to pass or fail together, so sharing batches between them helps the combined claim rather than hurting it.' : 'does not change it much.') + ' ') +
      (sized.n === null
        ? 'A sample size for the combined claim could not be found below ' + (opt.maxN || 400) + ' per site, which usually means a margin is too tight for the spread rather than that the study is large.'
        : 'For ' + pctOf(target) + ' power on the WHOLE claim you need about ' + sized.n + ' per site' +
          (perAttrNeeded !== null ? ', against the ' + perAttrNeeded + ' the worst single attribute asks for on its own - sizing attribute by attribute understates the study by ' + (sized.n / perAttrNeeded).toFixed(1) + ' times here' : '') + '.') +
      (corrInfo.nudged ? ' The estimated correlation matrix was not quite a valid one, which happens with few batches, and was nudged to the nearest valid matrix before simulating; treat the combined figures as indicative.' : '');

    return {
      reference, test, alpha, attributes, usable: usable.length, untested: failed.length,
      allEquivalent, anyUntested, binding,
      correlation: corrInfo, nPerSite: nMin,
      perAttributePower: perAttrPowers, weakestPerAttributePower: weakestPerAttr,
      combinedPower: observedPower, independentPower: indepPower,
      targetPower: target, nForCombined: sized.n, nPerAttributeWould: perAttrNeeded,
      sizingCurve: sized.curve, why
    };
  }

  function identity(k) { return Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))); }

  function estimateCorrelation(clean, names, reference, test) {
    const k = names.length;
    const M = identity(k);
    if (k < 2) return { matrix: M, mean: null, basis: 'one attribute', pairs: 0, nudged: false };

    /* Paired first: the same sample measured at both sites gives a difference per sample, and
       correlating those is exactly the quantity the combined power depends on. */
    const perAttrDiffs = {};
    let pairedUsable = true;
    for (const name of names) {
      const ref = new Map(), tst = new Map();
      clean.filter(r => r.attribute === name && r.sample).forEach(r => {
        if (r.group === reference) ref.set(r.sample, r.value);
        else if (r.group === test) tst.set(r.sample, r.value);
      });
      const shared = [...ref.keys()].filter(s => tst.has(s)).sort();
      if (shared.length < 4) { pairedUsable = false; break; }
      perAttrDiffs[name] = { keys: shared, vals: shared.map(s => tst.get(s) - ref.get(s)) };
    }

    const vectors = {};
    let basis;
    if (pairedUsable) {
      /* Only samples present for EVERY attribute can go into a correlation, or two columns
         would be correlated over different batches. */
      const common = names.reduce((acc, n) => acc.filter(s => perAttrDiffs[n].keys.includes(s)), perAttrDiffs[names[0]].keys.slice());
      if (common.length >= 4) {
        for (const n of names) vectors[n] = common.map(s => perAttrDiffs[n].vals[perAttrDiffs[n].keys.indexOf(s)]);
        basis = 'from ' + common.length + ' samples run at both sites, correlating the per-sample differences';
      } else pairedUsable = false;
    }
    if (!pairedUsable) {
      /* Unpaired: correlate the attribute values within each group, on the rows each group has
         in common by position, then pool. Weaker, and said to be. */
      const byGroup = [reference, test].map(g => {
        const perAttr = names.map(n => clean.filter(r => r.attribute === n && r.group === g).map(r => r.value));
        const len = Math.min.apply(null, perAttr.map(v => v.length));
        return { perAttr: perAttr.map(v => v.slice(0, len)), len };
      }).filter(x => x.len >= 4);
      if (!byGroup.length) return { matrix: M, mean: null, basis: 'too few results per attribute to estimate', pairs: 0, nudged: false };
      for (let i = 0; i < k; i++) {
        vectors[names[i]] = byGroup.reduce((acc, g) => acc.concat(centre(g.perAttr[i])), []);
      }
      basis = 'from within-site correlation between attributes, pooled across both sites - weaker than a paired estimate, because the same batches were not run at both';
    }

    const vals = [];
    let nudged = false;
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
      const a = vectors[names[i]], b = vectors[names[j]];
      const len = Math.min(a.length, b.length);
      let r = null;
      try { r = len >= 4 ? E.pearson(a.slice(0, len), b.slice(0, len)) : null; } catch (e) { r = null; }
      if (r === null || !isFinite(r)) r = 0;
      /* Clamped below zero. A negative estimate between two quality attributes on a handful of
         batches is almost always noise, and feeding it into the simulation makes the combined
         claim look HARDER than independence, which is not a conclusion a dozen batches can
         support. Clamping is the conservative direction here. */
      const use = Math.max(0, Math.min(0.99, r));
      M[i][j] = M[j][i] = use;
      vals.push(use);
    }
    const chk = cholesky(M); nudged = chk.nudged;
    return { matrix: M, mean: vals.length ? E.mean(vals) : null, basis, pairs: vals.length, nudged };
  }
  function centre(v) { const m = E.mean(v); return v.map(x => x - m); }

  function sizeForCombined(attrs, corr, target, opt) {
    opt = opt || {};
    const maxN = opt.maxN || 400;
    const curve = [];
    let found = null;
    /* Doubling to bracket, then bisecting. The combined power rises with n but the simulation
       is noisy, so the bracket is found coarsely and the answer refined rather than trusting a
       single crossing. */
    let n = 3, hiN = null;
    while (n <= maxN) {
      const p = combinedPower(attrs, corr, n, { alpha: opt.alpha, reps: opt.reps, seed: opt.seed });
      curve.push({ n, power: p });
      if (p >= target) { hiN = n; break; }
      n = Math.max(n + 1, Math.ceil(n * 1.6));
    }
    if (hiN === null) return { n: null, curve };
    let lo = curve.length > 1 ? curve[curve.length - 2].n : 2, hi = hiN;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      const p = combinedPower(attrs, corr, mid, { alpha: opt.alpha, reps: opt.reps, seed: opt.seed });
      curve.push({ n: mid, power: p });
      if (p >= target) hi = mid; else lo = mid;
    }
    found = hi;
    curve.sort((a, b) => a.n - b.n);
    return { n: found, curve };
  }

  root.MLComparability = { analyze, combinedPower, cholesky, estimateCorrelation, sizeForCombined };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MLComparability;
})(typeof globalThis !== 'undefined' ? globalThis : this);
