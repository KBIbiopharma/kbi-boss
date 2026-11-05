/* Six Sigma and process-control statistics: capability (Cp, Cpk, Pp, Ppk, Cpm, Z.bench,
   PPM), I-MR control charts, box-plot summaries, Taguchi signal-to-noise and quality loss,
   and defect rate / DPMO / sigma level for pass-fail data. Pure computation; no network,
   no storage. */
(function (root) {
  'use strict';
  const E = root.MLEngine || require('./engine.js');
  const { mean, sd, quantile } = E;

  // Shared numerics: the engine carries the accurate normal CDF and its inverse.
  const { normCdf, normInv } = E;
  /* Resolved when used, so load order cannot bite: the capability block needs the normality
     test that the tolerance tool already carries, and reimplementing Anderson-Darling here
     to avoid the dependency would be two versions of one thing waiting to disagree. */
  const tolerance = () => root.MLTolerance || (typeof require !== 'undefined' ? require('./tolerance.js') : null);
  const tost = () => root.MLTost || (typeof require !== 'undefined' ? require('./tost.js') : null);

  const num = v => v !== null && v !== undefined && v !== '' && isFinite(Number(v));


  /* ---------- Capability when the data is not bell-shaped ----------

     Withholding the tail figures, which is what happens above when Anderson-Darling fails,
     is correct and is still a dead end: a QC group that has to write a specification this
     week is left with Cp, Cpk and a count. There is a standard way out that does not
     require pretending - transform the measurements to a scale where the shape IS normal,
     transform the specification limits the same way, and compute the tail there.

     Box-Cox picks the power that makes the transformed data as normal as possible, by
     maximising the profile likelihood over lambda. The crucial discipline is that
     normality is then TESTED AGAIN on the transformed values, and the figures are still
     withheld if the transform did not fix it. A transform that failed is not a licence to
     report; impurity data with a hard floor at zero and a long right tail is usually fixed
     by lambda near 0, which is the log, and a bimodal distribution is not fixed by any
     lambda at all, because no power of a two-humped variable is bell-shaped.

     The transform is monotone increasing for every lambda, so the limits keep their order
     and the probability below a limit is preserved exactly - which is what makes the tail
     figure in the transformed space the right answer in the original one. */
  function boxCoxLambda(values) {
    const xs = values.filter(v => isFinite(v) && v > 0);
    const n = xs.length;
    if (n < 8 || n !== values.length) return null;
    const sumLog = xs.reduce((a, x) => a + Math.log(x), 0);
    const at = lam => {
      const ys = Math.abs(lam) < 1e-9 ? xs.map(Math.log) : xs.map(x => (Math.pow(x, lam) - 1) / lam);
      const m = mean(ys);
      let v = 0;
      for (const y of ys) v += (y - m) * (y - m);
      v /= n;
      if (!(v > 0)) return -Infinity;
      return -(n / 2) * Math.log(v) + (lam - 1) * sumLog;
    };
    let best = null, bestLL = -Infinity;
    for (let lam = -5; lam <= 5.0001; lam += 0.01) {
      const ll = at(lam);
      if (ll > bestLL) { bestLL = ll; best = lam; }
    }
    if (best === null) return null;
    return { lambda: Math.round(best * 100) / 100, loglik: bestLL };
  }
  const bcApply = (x, lam) => (Math.abs(lam) < 1e-9 ? Math.log(x) : (Math.pow(x, lam) - 1) / lam);

  /* Returns the tail figures computed on the transformed scale, or an honest reason why
     there are none. Called by capability when the raw data fails its normality test. */
  function nonNormalTail(y, lsl, usl) {
    if (y.some(v => !(v > 0))) {
      return { usable: false, why: 'Box-Cox needs every result above zero, and this data contains zero or negative values. A shift would make it apply, but the size of the shift is a judgement the tool should not make for you.' };
    }
    const bc = boxCoxLambda(y);
    if (!bc) return { usable: false, why: 'Not enough results to fit a transform worth trusting.' };
    const lam = bc.lambda;
    if (lsl !== null && !(lsl > 0)) {
      return { usable: false, lambda: lam, why: 'The lower specification limit is at or below zero, which the transform cannot carry, so a two-sided tail figure is not available on this scale.' };
    }
    const t = y.map(v => bcApply(v, lam));
    const TOL = tolerance();
    const ad = TOL && TOL.andersonDarling ? TOL.andersonDarling(t) : null;
    const normalNow = ad ? ad.normal : null;
    const m = mean(t), s = sd(t);
    const tl = lsl !== null ? bcApply(lsl, lam) : null;
    const tu = usl !== null ? bcApply(usl, lam) : null;
    const pBelow = tl !== null && s > 0 ? normCdf((tl - m) / s) : 0;
    const pAbove = tu !== null && s > 0 ? 1 - normCdf((tu - m) / s) : 0;
    const pOut = pBelow + pAbove;
    const zBench = pOut <= 0 || pOut >= 1 ? null : -normInv(pOut);
    return {
      usable: normalNow === true,
      lambda: lam, label: lam === 0 ? 'log' : lam === 1 ? 'none needed' : 'x^' + lam,
      normality: ad ? { stat: ad.adjusted, p: ad.p, normal: ad.normal, note: ad.note || null } : null,
      pBelow, pAbove, ppm: pOut * 1e6, zBench, sigmaLevel: zBench === null ? null : zBench + 1.5,
      why: normalNow === true
        ? 'A Box-Cox transform at lambda ' + lam + ' brings this data to a shape the normal tail figures can be read from, and normality was re-tested on the transformed values rather than assumed. Cp and Cpk stay as computed on your actual measurements, since they are ratios and need no shape.'
        : normalNow === false
          ? 'A Box-Cox transform at lambda ' + lam + ' was fitted and the transformed values still fail the normality test, so the tail figures stay withheld. No power of a two-humped or mixed distribution is bell-shaped, and a transform that did not work is not a licence to report.'
          : 'The transform was fitted but normality could not be tested on the result.'
    };
  }

  /* Capability. y in time order; spec = { lsl, usl, target } (any may be missing);
     timeOrdered: within-subgroup sigma comes from the average moving range, which only
     means something when rows are in production order. */
  function capability(y, spec, timeOrdered) {
    const lsl = num(spec.lsl) ? Number(spec.lsl) : null, usl = num(spec.usl) ? Number(spec.usl) : null, T = num(spec.target) ? Number(spec.target) : null;
    const n = y.length, m = mean(y), sO = sd(y);
    const mrs = []; for (let i = 1; i < n; i++) mrs.push(Math.abs(y[i] - y[i - 1]));
    const mrBar = mean(mrs), sW = timeOrdered && mrs.length ? mrBar / 1.128 : null;
    const idx = (s, k) => {
      if (!s) return {};
      const up = usl !== null ? (usl - m) / (3 * s) : null, dn = lsl !== null ? (m - lsl) / (3 * s) : null;
      const both = usl !== null && lsl !== null;
      return { [k + 'p']: both ? (usl - lsl) / (6 * s) : null, [k + 'pu']: up, [k + 'pl']: dn, [k + 'pk']: [up, dn].filter(v => v !== null).reduce((a, b) => Math.min(a, b), Infinity) };
    };
    const w = idx(sW, 'C'), o = idx(sO, 'P');
    if (w.Cpk === Infinity) w.Cpk = null;
    if (o.Ppk === Infinity) o.Ppk = null;
    // Expected fraction out of spec, from the overall (long-term) spread.
    const pBelow = lsl !== null && sO ? normCdf((lsl - m) / sO) : 0, pAbove = usl !== null && sO ? 1 - normCdf((usl - m) / sO) : 0;
    const pOut = pBelow + pAbove;
    const zBench = lsl === null && usl === null ? null : Math.min(8, normInv(1 - Math.max(pOut, 1e-15)));
    const observedOut = y.filter(v => (lsl !== null && v < lsl) || (usl !== null && v > usl)).length;
    const cpm = T !== null && lsl !== null && usl !== null ? (usl - lsl) / (6 * Math.sqrt(sO * sO + (m - T) ** 2)) : null;
    // Taguchi quadratic loss, relative to the loss of a unit sitting exactly at a spec limit.
    let loss = null;
    if (T !== null && (lsl !== null || usl !== null)) {
      const delta = Math.min(usl !== null ? usl - T : Infinity, lsl !== null ? T - lsl : Infinity);
      if (delta > 0 && isFinite(delta)) loss = mean(y.map(v => (v - T) ** 2)) / (delta * delta);
    }
    const s3 = y.reduce((a, v) => a + ((v - m) / (sO || 1)) ** 3, 0) / n;

    /* Whether the PPM and sigma figures above mean anything.

       Cp and Cpk are ratios of distances to spread; they are what they are whatever the
       shape. The expected PPM, Z.bench and sigma level are different: every one of them is
       a normal tail probability, and a tail probability from the wrong distribution is not
       approximately right, it is wrong by orders of magnitude.

       Measured on a right-skewed (lognormal) impurity with the limit at its true 99.9th
       percentile, so the real rate is 1,000 PPM: at a skewness of 0.50 the normal figure
       reads 80 PPM, twelve times under; at 0.85 it reads 9 PPM, a hundred times under; by
       1.47 it is eight thousand times under. The warning this replaced only fired above a
       skewness of 1, so it stayed silent through the first two - the mild right skew that
       impurities, aggregates and particulates actually have.

       So the test is a real one rather than a skew threshold, and the observed count is
       carried beside the estimate, because that one needs no distribution at all. */
    const TOL = tolerance();
    const ad = TOL && TOL.andersonDarling ? TOL.andersonDarling(y) : null;
    const tailsUsable = !ad || ad.normal === null ? null : ad.normal;
    /* How far apart the two answers are. The expected count is what the normal fit implies
       for these n rows; the observed count is what actually happened. When they disagree,
       the observed one is the evidence and the other is an assumption. */
    const expectedOut = pOut * n;
    const key = w.Cpk ?? o.Ppk ?? null;
    return {
      n, mean: m, sdOverall: sO, sdWithin: sW, lsl, usl, target: T, mrBar,
      // Missing indices are null (never undefined), so callers can test with === null.
      Cp: w.Cp ?? null, Cpk: w.Cpk ?? null, Cpu: w.Cpu ?? null, Cpl: w.Cpl ?? null, Pp: o.Pp ?? null, Ppk: o.Ppk ?? null, Cpm: cpm,
      pBelow, pAbove, ppm: pOut * 1e6, zBench, sigmaLevel: zBench === null ? null : zBench + 1.5,
      observedOut, observedPct: observedOut / n, loss, skew: s3,
      expectedOut,
      // Normality of the results, and therefore whether the tail figures are usable.
      normality: ad ? { stat: ad.adjusted, p: ad.p, normal: ad.normal, note: ad.note || null } : null,
      tailsUsable,
      /* Only fitted when the raw data failed. On data that passed, a transform would be
         solving a problem that is not there, and reporting two sets of tail figures invites
         picking the friendlier one. */
      nonNormal: tailsUsable === false ? nonNormalTail(y, lsl, usl) : null,
      verdict: key === null || key === undefined ? null : key >= 1.67 ? 'excellent' : key >= 1.33 ? 'capable' : key >= 1 ? 'marginal' : 'not capable',
      centeredCpk: lsl !== null && usl !== null && (sW || sO) ? (usl - lsl) / (6 * (sW || sO)) : null,
      sigmaFor133: lsl !== null && usl !== null ? (usl - lsl) / 8 : null
    };
  }

  /* Individuals and moving-range chart limits, with two classic signals:
     a point beyond 3 sigma, and 8 points in a row on one side of the center line. */
  /* Sensitivity is a choice, and it is the user's.

     The conservative chart is the control limits plus the moving-range limit: measured on
     3,000 in-control series it raises a false signal about once every 103 points. The
     3-sigma rule on its own measures once every 367, which is the textbook 370 - the
     difference is the moving-range chart, which is a second chart and fires on its own
     account. The number reported is for what the mode actually does rather than for the
     part of it with the nicer figure.

     Turning on all eight rules catches shifts and drifts a limits-only chart is blind to -
     on a 0.9-sigma shift the limits chart raises one signal and the full set raises
     twenty-five - and costs about one false signal every 50 points.

     On a fifty-run chart that is roughly one false signal expected per chart. Fine if you
     know it, badly misleading if you do not, so the number is reported beside the signals
     rather than left for somebody to discover by investigating noise. */
  const RULE_COST = { limits: 103, all: 50 };

  function imr(y, opt) {
    opt = opt || {};
    const useAll = opt.rules !== 'limits';
    const mrs = [null]; for (let i = 1; i < y.length; i++) mrs.push(Math.abs(y[i] - y[i - 1]));
    const mrBar = mean(mrs.slice(1)), cl = mean(y);
    const ucl = cl + 2.66 * mrBar, lcl = cl - 2.66 * mrBar, mrUcl = 3.267 * mrBar;
    /* The full Nelson set, not three of it.

       Rule 1 catches a point so far out it cannot be chance. The other seven catch the
       thing a limits-only chart is blind to: a process that has shifted or drifted while
       every individual point stays inside the lines. A slow drift toward a limit trips rule
       3 long before it trips rule 1, which is the whole reason the rules exist - by the time
       a point is beyond 3 sigma the batch is usually already made.

       Zones are the thirds of the distance from the centre line to a limit: C within one
       sigma, B between one and two, A between two and three. Sigma here comes from the
       moving range, which is the within-subgroup spread, not the standard deviation of the
       whole series - using the latter would widen the limits with the very shift the chart
       is meant to find. */
    const sigma = (ucl - cl) / 3;
    const flags = y.map(() => []);
    const zone = v => (sigma > 0 ? (v - cl) / sigma : 0);     // signed, in sigmas
    const mark = (i, why) => { if (flags[i].indexOf(why) < 0) flags[i].push(why); };
    // A rule that fires over a window marks every point in it, so the chart shows the run.
    const span = (from, to, why) => { for (let i = from; i <= to; i++) mark(i, why); };

    y.forEach((v, i) => { if (v > ucl || v < lcl) mark(i, 'beyond 3 sigma'); });

    const z = y.map(zone);
    const n = y.length;
    const sideOf = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
    const runRule = (len, test, why) => {
      for (let i = 0; i + len <= n; i++) {
        let ok = true;
        for (let j = 0; j < len && ok; j++) ok = test(i + j, i);
        if (ok) span(i, i + len - 1, why);
      }
    };
    // 2: nine in a row on one side of the centre line.
    if (useAll) {
    for (const s of [1, -1]) runRule(9, k => sideOf(z[k]) === s, '9 in a row on one side');
    // 3: six in a row climbing or falling.
    runRule(6, (k, i) => k === i || y[k] > y[k - 1], '6 in a row rising');
    runRule(6, (k, i) => k === i || y[k] < y[k - 1], '6 in a row falling');
    // 4: fourteen in a row alternating up and down.
    runRule(14, (k, i) => k === i || k === i + 1 || ((y[k] - y[k - 1]) * (y[k - 1] - y[k - 2]) < 0), '14 alternating');
    // 5: two of three in zone A or beyond, on one side.
    for (const s of [1, -1]) {
      for (let i = 0; i + 3 <= n; i++) {
        let c = 0;
        for (let j = 0; j < 3; j++) if (sideOf(z[i + j]) === s && Math.abs(z[i + j]) > 2) c++;
        if (c >= 2) span(i, i + 2, '2 of 3 beyond 2 sigma');
      }
    }
    // 6: four of five in zone B or beyond, on one side.
    for (const s of [1, -1]) {
      for (let i = 0; i + 5 <= n; i++) {
        let c = 0;
        for (let j = 0; j < 5; j++) if (sideOf(z[i + j]) === s && Math.abs(z[i + j]) > 1) c++;
        if (c >= 4) span(i, i + 4, '4 of 5 beyond 1 sigma');
      }
    }
    // 7: fifteen in a row inside one sigma, either side. Too good to be true, usually a
    // limit calculated from the wrong spread or data that has been smoothed.
    runRule(15, k => Math.abs(z[k]) < 1, '15 in a row hugging the centre');
    // 8: eight in a row outside one sigma, either side - a bimodal process, often two
    // shifts or two lines pooled into one chart.
    runRule(8, k => Math.abs(z[k]) > 1, '8 in a row avoiding the centre');
    }

    mrs.forEach((v, i) => { if (v !== null && v > mrUcl) mark(i, 'jump between points'); });
    const signals = flags.map((f, i) => (f.length ? { i, why: f } : null)).filter(Boolean);
    return { y, mr: mrs, cl, ucl, lcl, mrBar, mrUcl, sigma, flags, signals,
      rules: useAll ? 'all' : 'limits',
      /* How often this rule set cries wolf on a process with nothing wrong with it,
         measured on 3,000 in-control series rather than quoted. */
      falseAlarmEvery: RULE_COST[useAll ? 'all' : 'limits'],
      expectedFalse: y.length / RULE_COST[useAll ? 'all' : 'limits'],
      // The zone boundaries, so a chart can draw them rather than implying only the limits.
      zones: { a: [cl + 2 * sigma, cl + 3 * sigma], b: [cl + sigma, cl + 2 * sigma], c: [cl - sigma, cl + sigma] } };
  }

  function box(values) {
    const s = values.slice().sort((a, b) => a - b);
    const q1 = quantile(s, 0.25), med = quantile(s, 0.5), q3 = quantile(s, 0.75), iqr = q3 - q1;
    const loF = q1 - 1.5 * iqr, hiF = q3 + 1.5 * iqr;
    const inside = s.filter(v => v >= loF && v <= hiF);
    return { n: s.length, min: s[0], max: s[s.length - 1], q1, median: med, q3, mean: mean(s), whiskerLo: inside[0], whiskerHi: inside[inside.length - 1], outliers: s.filter(v => v < loF || v > hiF) };
  }

  // Taguchi signal-to-noise ratio (dB). Higher is always better (more robust).
  function snRatio(y, type) {
    if (!y.length) return null;
    if (type === 'larger') return y.some(v => v === 0) ? null : -10 * Math.log10(mean(y.map(v => 1 / (v * v))));
    if (type === 'smaller') return -10 * Math.log10(mean(y.map(v => v * v)));
    if (y.length < 2) return null;
    const v = E.variance(y);
    return v > 0 ? 10 * Math.log10(mean(y) ** 2 / v) : null;
  }
  /* S/N and mean at every level of each factor. factors: [{ name, values: [] }] aligned
     with y. Ranks factors by how much S/N changes across their levels (delta). */
  function taguchi(y, factors, type) {
    const out = factors.map(f => {
      const levels = Array.from(new Set(f.values.filter(v => v !== null))).sort((a, b) => (typeof a === 'number' ? a - b : String(a) < String(b) ? -1 : 1));
      const rows = levels.map(lv => {
        const ys = y.filter((_, i) => f.values[i] === lv);
        return { level: lv, n: ys.length, sn: snRatio(ys, type), mean: mean(ys) };
      }).filter(r => r.sn !== null && isFinite(r.sn));
      if (rows.length < 2) return null;
      const sns = rows.map(r => r.sn);
      const best = rows[sns.indexOf(Math.max(...sns))];
      return { name: f.name, levels: rows, delta: Math.max(...sns) - Math.min(...sns), best };
    }).filter(Boolean);
    out.sort((a, b) => b.delta - a.delta);
    out.forEach((f, i) => { f.rank = i + 1; });
    return out;
  }

  // Pass/fail quality: defect rate, defects per million, and process sigma level.
  function attribute(good, total) {
    const p = total ? (total - good) / total : 0;
    const zLT = normInv(1 - Math.min(Math.max(p, 1e-9), 1 - 1e-9));
    return { total, defects: total - good, p, yield: 1 - p, dpmo: p * 1e6, zLT, sigmaLevel: zLT + 1.5 };
  }


  /* ---------- Charts for things you count ----------

     The I-MR chart above is built for measurements: a titer, a pH, a purity. A great deal of
     quality data is not measured but counted - particles in a vial, vials rejected at
     inspection, deviations in a month, colonies on a plate - and running a counted series
     through a measurement chart gets the limits wrong, because the spread of a count is not
     free to be anything: a Poisson count's standard deviation is the square root of its own
     mean, and a proportion's depends on how many units were looked at.

       c   defects per constant opportunity   particles per vial, deviations per month
       u   defects per unit, varying size     particles per mL, deviations per 1000 batches
       p   proportion of units defective      share of vials rejected at inspection

     And then the part that matters more than the choice between them. The textbook limits
     above assume the counts really are Poisson or binomial - that every vial has the same
     underlying rate. Real counts almost never do: particles cluster by batch, by stopper
     lot, by shift, so the rate itself moves and the observed spread is wider than the
     square-root law allows. That is overdispersion, and a chart that ignores it draws
     limits far too tight and then fires constantly at a process that is behaving.

     So dispersion is measured rather than assumed, and reported. If the counts are wider
     than the model allows, Laney's correction is applied: standardise every point, take the
     spread of that standardised series from its average moving range - deliberately, since
     a moving range is barely moved by the shifts the chart exists to find - and widen the
     limits by it. When the counts really are Poisson that factor comes out near 1 and the
     chart is the textbook one, so the correction costs nothing when it is not needed. Both
     sets of limits are returned, with a recommendation, because a reader deserves to see
     how much of the alarm was the chart. */
  const LANEY_D2 = 1.128;   // E[moving range] / sigma for a pair of normal draws

  function countChart(counts, opt) {
    opt = opt || {};
    const y = (counts || []).map(v => (num(v) ? Number(v) : null));
    if (y.some(v => v === null)) throw new Error('Every point must be a number. A missing count is not a zero: leave the period out rather than calling it zero defects.');
    if (y.some(v => v < 0 || v !== Math.round(v))) throw new Error('Counts must be whole numbers and cannot be negative. If these are measurements rather than counts, use the I-MR chart instead.');
    const m = y.length;
    if (m < 8) throw new Error('Need at least 8 points to set limits worth drawing. Below that the limits move more than the process does.');

    let units = null;
    if (opt.units) {
      units = opt.units.map(v => (num(v) ? Number(v) : null));
      if (units.length !== m) throw new Error('Got ' + m + ' counts but ' + units.length + ' opportunity sizes. There must be one size per point.');
      if (units.some(v => v === null || v <= 0)) throw new Error('Every opportunity size must be a positive number: how many units were inspected, or how much material was looked at.');
    }
    let kind = opt.kind || (units ? 'u' : 'c');
    if (kind === 'p' && !units) throw new Error('A p-chart needs how many units were inspected at each point, or a proportion cannot be formed.');
    if (kind === 'p' && y.some((v, i) => v > units[i])) throw new Error('A p-chart counts defective units, so a count cannot exceed the number inspected. If a unit can hold several defects, this is a u-chart.');
    if (kind === 'c' && units && !units.every(u => u === units[0])) throw new Error('These opportunity sizes are not all the same, so a c-chart cannot apply. Use a u-chart, whose limits move with the size.');

    const total = y.reduce((a, b) => a + b, 0);
    const totalUnits = units ? units.reduce((a, b) => a + b, 0) : m;
    let centre, sigmaAt, plotted;
    if (kind === 'c') {
      centre = total / m;
      plotted = y.slice();
      sigmaAt = () => Math.sqrt(centre);
    } else if (kind === 'u') {
      centre = total / totalUnits;
      plotted = y.map((v, i) => v / units[i]);
      sigmaAt = i => Math.sqrt(centre / units[i]);
    } else {
      centre = total / totalUnits;
      plotted = y.map((v, i) => v / units[i]);
      sigmaAt = i => Math.sqrt(centre * (1 - centre) / units[i]);
    }
    /* A centre of zero means nothing ever happened. The limits collapse onto zero and the
       chart would flag the first event that ever occurs as a signal, which is arithmetic
       rather than evidence. */
    if (!(centre > 0)) {
      return { kind, n: m, centre: 0, plotted, sigma: plotted.map(() => 0), lower: plotted.map(() => 0), upper: plotted.map(() => 0),
        dispersion: null, overdispersed: false, laney: null, signals: [], use: kind,
        why: 'Not one defect in ' + m + ' points, so there is no rate to set limits around. The chart starts meaning something once something has happened.' };
    }

    const sigma = plotted.map((_, i) => sigmaAt(i));
    const clampHi = v => (kind === 'p' ? Math.min(1, v) : v);
    const lower = sigma.map(s => Math.max(0, centre - 3 * s));
    const upper = sigma.map(s => clampHi(centre + 3 * s));

    /* Dispersion: the average squared standardised distance from centre. Poisson or
       binomial counts put this at 1. Above it, the rate itself is moving. */
    const z = plotted.map((v, i) => (v - centre) / sigma[i]);
    const phi = z.reduce((a, b) => a + b * b, 0) / (m - 1);

    const mrs = [];
    for (let i = 1; i < m; i++) mrs.push(Math.abs(z[i] - z[i - 1]));
    const sigmaZ = mrs.length ? mean(mrs) / LANEY_D2 : 1;
    /* Only ever used to widen. A sigmaZ below 1 says the counts are tighter than the model
       allows, which is a real thing - stratified or over-controlled data - but tightening
       limits on it would manufacture signals, so the textbook limits stand as the floor. */
    const factor = Math.max(1, sigmaZ);
    const lowerP = sigma.map(s => Math.max(0, centre - 3 * s * factor));
    const upperP = sigma.map(s => clampHi(centre + 3 * s * factor));

    const findSignals = (lo, hi) => {
      const out = [];
      for (let i = 0; i < m; i++) {
        if (plotted[i] > hi[i]) out.push({ i, value: plotted[i], count: y[i], side: 'above', limit: hi[i] });
        else if (plotted[i] < lo[i]) out.push({ i, value: plotted[i], count: y[i], side: 'below', limit: lo[i] });
      }
      return out;
    };
    const signals = findSignals(lower, upper);
    const signalsP = findSignals(lowerP, upperP);

    const overdispersed = phi > 1.5 && factor > 1.1;
    const prime = kind + '-prime';
    return {
      kind, n: m, centre, plotted, sigma, lower, upper, signals,
      units: units ? units.slice() : null, counts: y.slice(), total,
      dispersion: phi, overdispersed, sigmaZ, factor,
      laney: { kind: prime, sigmaZ, factor, lower: lowerP, upper: upperP, signals: signalsP },
      use: overdispersed ? prime : kind,
      why: overdispersed
        ? 'These counts vary ' + phi.toFixed(1) + ' times as much as a ' + (kind === 'p' ? 'binomial' : 'Poisson') + ' model allows, so the rate itself is moving between points - clustering by lot, line or shift. The textbook limits would flag ' +
          signals.length + ' of ' + m + ' points; widened for that extra spread, ' + signalsP.length + ' remain. Read the widened chart, and treat the difference as a question about what the clusters are rather than as signals.'
        : 'Dispersion measures ' + phi.toFixed(2) + ', so these counts behave as a ' + (kind === 'p' ? 'binomial' : 'Poisson') + ' model expects and the textbook limits hold. The widened limits were computed too and change nothing worth reading.'
    };
  }


  /* ---------- When the event is rare: chart the gaps, not the rate ----------

     At a tenth of a percent, a proportion chart is mostly noise. Inspect a thousand
     containers and expect one finding: the subgroup proportion is 0, 0.001, 0.002, the
     limits sit on top of each other, and the lower limit is zero - so the chart can signal
     that things got worse and can never signal that they got better. Four departments in
     this tool name that gap, and it is the same gap each time.

     The fix is to stop charting the rate and start charting the distance between events:
     containers inspected between findings, or days between failures. Those gaps carry every
     event individually instead of summarising a thousand of them into one dot, and they
     have a distribution worth using - geometric for counted opportunities, exponential for
     elapsed time.

     What must not be done to them is three sigma. Both distributions are heavily skewed, so
     a symmetric band is wrong on both sides. The lower limit lands below zero and is clamped
     away, and on a chart of GAPS that is the expensive half: gaps get shorter when the rate
     goes up, so a lower limit that cannot be crossed is a chart that cannot tell you
     contamination is increasing. (It is the mirror of the proportion chart's failure, where
     a lower limit of zero hides an improvement.) So the limits here are
     PROBABILITY limits: the points in each tail that carry alpha/2 of the distribution,
     computed from the fitted parameter rather than from a standard deviation. What three
     sigma would have given is computed too and reported beside them, because the difference
     is the argument for doing it this way. */
  function rareEvents(gaps, opt) {
    opt = opt || {};
    const g = (gaps || []).map(v => (num(v) ? Number(v) : null));
    if (g.some(v => v === null)) throw new Error('Every gap must be a number: how many units, or how long, between one event and the next.');
    if (g.some(v => v < 0)) throw new Error('A gap cannot be negative.');
    const n = g.length;
    if (n < 8) throw new Error('Need at least 8 gaps - that is 9 events - before limits mean anything. Below that the chart moves more than the process does.');

    const whole = g.every(v => v === Math.round(v));
    const kind = opt.kind || (whole ? 'g' : 't');
    if (kind === 'g' && !whole) throw new Error('A g-chart counts whole units between events. These gaps are not whole numbers, so this is time between events: use the t-chart.');
    const alpha = opt.alpha === undefined || opt.alpha === null ? 0.0027 : Number(opt.alpha);
    if (!(alpha > 0 && alpha < 0.5)) throw new Error('The false alarm rate must be between 0 and 0.5. The default, 0.0027, is what three sigma means on a normal chart, so the two are comparable.');
    const m = mean(g);
    if (!(m > 0)) throw new Error('Every gap is zero, which means an event at every opportunity. That is not a rare event and this is not the chart for it.');

    const lo = alpha / 2, hi = 1 - alpha / 2;
    let centre, lcl, ucl, rate, rateLabel, lclExists = true;
    if (kind === 'g') {
      /* Gaps counted as opportunities between events, so X is geometric on 0,1,2,... with
         mean (1-p)/p. P(X > k) = (1-p)^(k+1). */
      const p = 1 / (m + 1);
      const q = 1 - p;
      const lq = Math.log(q);
      ucl = Math.ceil(Math.log(lo) / lq) - 1;
      const kLow = Math.floor(Math.log(hi) / lq) - 1;
      lcl = kLow;
      if (kLow < 0) { lcl = null; lclExists = false; }
      centre = Math.ceil(Math.log(0.5) / lq) - 1;   // the median, which is the honest centre for a skewed chart
      rate = p;
      rateLabel = 'about 1 event in every ' + fmtInt(1 / p) + ' units';
    } else {
      const lam = 1 / m;
      ucl = -Math.log(lo) / lam;
      lcl = -Math.log(hi) / lam;
      centre = Math.log(2) / lam;
      rate = lam;
      rateLabel = 'about 1 event every ' + fmtInt(m) + ' units of time';
    }

    /* What a three-sigma chart would have drawn on the same gaps, for comparison. The
       lower limit is the point: on a skewed distribution it lands below zero and is clamped
       away, and with it goes any chance of seeing the process improve. */
    const s = sd(g);
    const naive = { lower: m - 3 * s, upper: m + 3 * s };
    naive.clamped = naive.lower < 0;
    naive.lowerDrawn = Math.max(0, naive.lower);

    const signals = [];
    for (let i = 0; i < n; i++) {
      if (g[i] > ucl) signals.push({ i, value: g[i], side: 'above', rule: 'limit', meaning: 'a longer gap than chance explains: the rate has fallen, or an event was missed' });
      else if (lclExists && g[i] < lcl) signals.push({ i, value: g[i], side: 'below', rule: 'limit', meaning: 'a shorter gap than chance explains: the rate has risen' });
    }
    /* A single point is not enough here, and measurement says so: at a three-sigma-equivalent
       false alarm rate this chart catches a fourfold improvement in about five events and a
       fourfold deterioration in none at all, because no lower limit exists to cross. Yet a
       rising rate is the case these departments care about most.

       It presents as a RUN of short gaps rather than as one impossible gap, so a run rule
       carries that half. The centre line is the median, so each point falls below it with
       probability one half and a run of `run` has probability 2^-run per position - at the
       default of eight that is 0.39%, the same order as the limits themselves, so the rule
       is not bought with a flood of false alarms. */
    const runLen = Math.max(4, Math.round(opt.run === undefined ? 8 : opt.run));
    let below = 0, above = 0;
    for (let i = 0; i < n; i++) {
      below = g[i] < centre ? below + 1 : 0;
      above = g[i] > centre ? above + 1 : 0;
      if (below === runLen) signals.push({ i, value: g[i], side: 'below', rule: 'run', meaning: runLen + ' gaps in a row shorter than usual: the rate has risen' });
      if (above === runLen) signals.push({ i, value: g[i], side: 'above', rule: 'run', meaning: runLen + ' gaps in a row longer than usual: the rate has fallen' });
    }
    signals.sort((x, y) => x.i - y.i);
    return {
      kind, n, events: n + 1, alpha, mean: m, median: centre,
      centre, lcl, ucl, lclExists, rate, rateLabel, gaps: g.slice(),
      signals, naive, runLen,
      runRisk: Math.pow(0.5, runLen),
      why: 'Limits are the points carrying ' + (alpha / 2 * 100).toPrecision(2) + '% in each tail of the fitted ' +
        (kind === 'g' ? 'geometric' : 'exponential') + ' distribution, not three standard deviations. ' +
        (naive.clamped
          ? 'Three sigma would have put the lower limit at ' + fmtSigned(naive.lower) + ', which is below zero and would be clamped away. Gaps shorten when the rate rises, so a lower limit nothing can cross is a chart that cannot tell you the rate is rising.'
          : 'Three sigma would have given ' + fmtSigned(naive.lower) + ' to ' + fmtSigned(naive.upper) + ' here.') +
        (lclExists ? '' : ' At this rate and this false alarm rate no lower limit exists at all: with events this rare, even a gap of zero is not surprising on its own, so a rise in the rate shows up as a run of short gaps rather than as one point. A looser false alarm rate, or more events, brings the lower limit into existence.')
    };
  }
  const fmtInt = v => (isFinite(v) ? Math.round(v).toLocaleString() : '–');
  const fmtSigned = v => (isFinite(v) ? (Math.round(v * 100) / 100).toLocaleString() : '–');


  /* ---------- The small sustained shift, which a Shewhart chart is worst at ----------

     The I-MR chart above looks at one point at a time, so it is excellent at a spike and
     poor at a drift: a half-sigma shift leaves almost every point inside the limits, and
     the Nelson run rules were added precisely to patch that. There are two charts built for
     it from the start, and they work by remembering.

       CUSUM  accumulates how far each point sits from target, minus a slack term, and
              signals when the running total crosses a decision interval. Nothing is
              forgotten, so a persistent small bias piles up.

       EWMA   is a weighted average where the weight decays, so recent points matter most
              and older ones fade. Its limits widen over the first few points as the average
              fills up, which is the exact form rather than the asymptotic one.

     Both are tuned to the same in-control false alarm rate as a three-sigma chart, so the
     comparison between them is fair and the choice is about what you want to catch rather
     than about how often you want to be interrupted. The parameters here - k = 0.5 with
     h = 4.77, and lambda = 0.2 with L = 2.962 - are the standard pairings for an in-control
     run length near 370, and the tests measure that rather than taking it on trust.

     The trade, measured rather than assumed. Both beat the plain chart by a wide margin on
     a small sustained shift: at one sigma the average wait is ten points against forty-five.
     On a large sudden jump the plain chart does not win - EWMA matches it point for point -
     but CUSUM costs one point above about three and a half sigma, because its slack term has
     to be paid back before the running sum can cross. That is the whole price, and it is in
     the output rather than left as a caveat somebody else discovers. */
  const CUSUM_K = 0.5, CUSUM_H = 4.77, EWMA_LAMBDA = 0.2, EWMA_L = 2.962;

  // Within-subgroup sigma, the same estimate the I-MR chart uses, so the charts agree.
  function shortSigma(y) {
    const mrs = [];
    for (let i = 1; i < y.length; i++) mrs.push(Math.abs(y[i] - y[i - 1]));
    const bar = mrs.length ? mean(mrs) : 0;
    if (bar > 0) return bar / 1.128;
    /* No movement between neighbours at all. Fall back to the overall spread, and return
       zero honestly when there is none either - the first version returned 1 here, which
       meant a chart on perfectly constant data drew limits around a sigma that did not
       exist. The callers refuse on zero, which is the right answer for that data. */
    return sd(y) || 0;
  }

  /* Where the centre comes from, which decides whether these charts work at all.

     Taking it from the grand mean is the obvious thing and it is self-defeating: a drift
     that moves the mean is partly absorbed into the centre it is being measured against,
     so the chart goes quieter about the very thing it exists for. When no target is given,
     the centre and the spread therefore come from an opening stretch - the standard
     two-phase practice, where an early window establishes what normal was and everything
     after it is judged against that. A target, where one exists, is better still: it is
     the value the process is supposed to hold rather than the value it happened to hold. */
  function baselineOf(y, opt) {
    const n = y.length;
    if (opt.mu0 !== undefined && opt.mu0 !== null) {
      const sg = opt.sigma === undefined || opt.sigma === null ? shortSigma(y) : Number(opt.sigma);
      return { mu0: Number(opt.mu0), sigma: sg, from: 'the target you gave', baseN: n };
    }
    const want = opt.baseline === undefined ? Math.max(8, Math.min(Math.round(n / 3), 50)) : Math.round(opt.baseline);
    const baseN = Math.max(8, Math.min(want, n));
    const head = y.slice(0, baseN);
    const sg = opt.sigma === undefined || opt.sigma === null ? shortSigma(head) : Number(opt.sigma);
    return { mu0: mean(head), sigma: sg, from: 'the first ' + baseN + ' points', baseN };
  }

  function cusum(y, opt) {
    opt = opt || {};
    const n = y.length;
    if (n < 8) throw new Error('Need at least 8 points: a chart that remembers has nothing to remember yet.');
    const base = baselineOf(y, opt);
    const mu0 = base.mu0, sigma = base.sigma;
    if (!(sigma > 0)) throw new Error('Every point is identical, so there is no spread to measure a shift against.');
    const k = opt.k === undefined ? CUSUM_K : Number(opt.k);
    const h = opt.h === undefined ? CUSUM_H : Number(opt.h);
    const hi = [], lo = [], signals = [];
    let cp = 0, cm = 0;
    for (let i = 0; i < n; i++) {
      const z = (y[i] - mu0) / sigma;
      cp = Math.max(0, cp + z - k);
      cm = Math.max(0, cm - z - k);
      hi.push(cp); lo.push(cm);
      if (cp > h) signals.push({ i, side: 'above', value: cp, meaning: 'the total drift above target has crossed the decision interval' });
      else if (cm > h) signals.push({ i, side: 'below', value: cm, meaning: 'the total drift below target has crossed the decision interval' });
    }
    return {
      kind: 'cusum', n, mu0, sigma, k, h, hi, lo, signals, baseline: base,
      /* Once it signals, the count itself says how long the drift has been running: the
         number of points since the sum last sat at zero. That is a starting date for an
         investigation, which a Shewhart signal does not give you. */
      shiftStarted: signals.length ? (() => {
        const at = signals[0].i;
        const series = signals[0].side === 'above' ? hi : lo;
        let j = at;
        while (j > 0 && series[j - 1] > 0) j--;
        return j;
      })() : null,
      why: 'Slack k = ' + k + ' sigma and decision interval h = ' + h + ' sigma, the standard pairing for an in-control run length near 370 points - the same false alarm rate as a three-sigma chart, so the two are comparable. Centre and spread come from ' + base.from + ', because a centre taken from all the data absorbs the drift being looked for. The running sums reset to zero whenever the process is at target, so a crossing means a persistent bias rather than one odd point. Measured: at a one-sigma shift this signals after about 10 points against 45 for a three-sigma chart; on a jump above about three and a half sigma it takes 2 points where the plain chart takes 1, because the slack has to be paid back first.'
    };
  }

  function ewma(y, opt) {
    opt = opt || {};
    const n = y.length;
    if (n < 8) throw new Error('Need at least 8 points: a chart that remembers has nothing to remember yet.');
    const base = baselineOf(y, opt);
    const mu0 = base.mu0, sigma = base.sigma;
    if (!(sigma > 0)) throw new Error('Every point is identical, so there is no spread to measure a shift against.');
    const lam = opt.lambda === undefined ? EWMA_LAMBDA : Number(opt.lambda);
    const L = opt.L === undefined ? EWMA_L : Number(opt.L);
    if (!(lam > 0 && lam <= 1)) throw new Error('The weight lambda must be above 0 and at most 1. At 1 the chart forgets everything and becomes the plain individuals chart.');
    const z = [], ucl = [], lcl = [], signals = [];
    let prev = mu0;
    for (let i = 0; i < n; i++) {
      prev = lam * y[i] + (1 - lam) * prev;
      z.push(prev);
      /* The exact standard error, not the asymptotic one: the average is still filling up
         over the first few points, so its limits are narrower there. Using the asymptotic
         width throughout misses an early shift, which is when it is cheapest to fix. */
      const se = sigma * Math.sqrt((lam / (2 - lam)) * (1 - Math.pow(1 - lam, 2 * (i + 1))));
      ucl.push(mu0 + L * se); lcl.push(mu0 - L * se);
      if (prev > ucl[i]) signals.push({ i, side: 'above', value: prev, meaning: 'the weighted average has risen above its limit' });
      else if (prev < lcl[i]) signals.push({ i, side: 'below', value: prev, meaning: 'the weighted average has fallen below its limit' });
    }
    return {
      kind: 'ewma', n, mu0, sigma, lambda: lam, L, z, ucl, lcl, signals, baseline: base,
      why: 'Weight lambda = ' + lam + ' and limit factor L = ' + L + ', the standard pairing for an in-control run length near 370 - the same false alarm rate as a three-sigma chart. Centre and spread come from ' + base.from + '. Each point carries ' + Math.round(lam * 100) + '% of the new reading and ' + Math.round((1 - lam) * 100) + '% of the history, so a drift accumulates while a single spike is damped. The limits widen over the first few points because the average is still filling up, which is the exact form rather than the asymptotic one. Measured: at a one-sigma shift this signals after about 10 points against 45 for a three-sigma chart, and at large shifts it matches the plain chart point for point rather than lagging it.'
    };
  }

  /* ---------- Capability across sites ----------
     The question MSAT actually asks is "is this the same process at both sites", and the
     tempting answer is one combined Cpk. That index is only meaningful if the sites are the
     same process: if their means differ, the combined spread includes the gap between them
     and describes a mixture nobody runs; if their spreads differ, the combined figure
     flatters the worse site and penalises the better one.

     So this works the way the shelf-life tool already works with batches: test whether the
     groups may be pooled, report per-site either way, and withhold the combined index with
     a reason when they may not. The two tests are the ones that matter - one for the means,
     one for the spreads - and the spread test uses deviations from each site's median, which
     survives the non-normal data this tool is usually pointed at. */
  function oneWayF(groups) {
    const all = groups.reduce((a, g) => a.concat(g), []);
    const N = all.length, k = groups.length, grand = mean(all);
    let ssb = 0, ssw = 0;
    for (const g of groups) {
      const m = mean(g);
      ssb += g.length * (m - grand) * (m - grand);
      for (const v of g) ssw += (v - m) * (v - m);
    }
    const df1 = k - 1, df2 = N - k;
    if (df1 < 1 || df2 < 1 || ssw <= 0) return { F: null, p: null, df1, df2 };
    const F = (ssb / df1) / (ssw / df2);
    return { F, p: E.ibeta(df2 / 2, df1 / 2, df2 / (df2 + df1 * F)), df1, df2, ssb, ssw, grand };
  }
  const medianOf = a => { const s = a.slice().sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

  function crossSite(rows, spec, opt) {
    opt = opt || {};
    const clean = (rows || []).map(r => (r ? { site: String(r.site === undefined ? '' : r.site).trim(), value: num(r.value) ? Number(r.value) : null } : null))
      .filter(r => r && r.site !== '' && r.value !== null);
    if (!clean.length) throw new Error('No usable rows. Each row needs a site and a numeric result.');
    const names = [];
    for (const r of clean) if (names.indexOf(r.site) < 0) names.push(r.site);
    if (names.length < 2) throw new Error('Only one site here (' + names[0] + '). Comparing capability across sites needs at least two.');
    if (!spec || (spec.lsl === null || spec.lsl === undefined) && (spec.usl === null || spec.usl === undefined)) {
      throw new Error('Capability needs at least one specification limit. Without one there is nothing for the spread to be capable of.');
    }
    const MIN = opt.minPerSite === undefined ? 5 : opt.minPerSite;
    const groups = names.map(nm => clean.filter(r => r.site === nm).map(r => r.value));
    const thin = names.filter((nm, i) => groups[i].length < MIN);
    if (thin.length) throw new Error('These sites have fewer than ' + MIN + ' results: ' + thin.join(', ') + '. A capability index from that few is mostly noise, and comparing it across sites would be comparing noise.');

    const per = names.map((nm, i) => {
      const cap = capability(groups[i], spec);
      return { site: nm, n: groups[i].length, mean: cap.mean, sd: cap.sdOverall, Cp: cap.Cp, Cpk: cap.Cpk, Pp: cap.Pp, Ppk: cap.Ppk,
        observedOut: cap.observedOut, tailsUsable: cap.tailsUsable, normal: cap.normality ? cap.normality.normal : null };
    }).sort((a, b) => (a.Ppk === null ? -Infinity : a.Ppk) - (b.Ppk === null ? -Infinity : b.Ppk));

    // Do the sites share a centre, and do they share a spread?
    const means = oneWayF(groups);
    const spreads = oneWayF(groups.map(g => { const md = medianOf(g); return g.map(v => Math.abs(v - md)); }));
    const sameCentre = means.p === null ? null : means.p >= 0.05;
    const sameSpread = spreads.p === null ? null : spreads.p >= 0.05;
    const poolable = sameCentre === true && sameSpread === true;

    /* How much of the total spread is the gap between sites rather than variation inside
       them. This is the number that says whether harmonising the sites is worth anything. */
    const allValues = clean.map(r => r.value);
    const gm = mean(allValues);
    const totalVar = allValues.length > 1 ? allValues.reduce((a, v) => a + (v - gm) * (v - gm), 0) / (allValues.length - 1) : 0;
    const withinVar = means.ssw !== undefined && means.df2 > 0 ? means.ssw / means.df2 : null;
    const betweenShare = totalVar > 0 && withinVar !== null ? Math.max(0, (totalVar - withinVar) / totalVar) : null;

    /* Whether the sites DIFFER and whether they are INTERCHANGEABLE are different questions,
       and a transfer needs the second. The tests above can only fail to find a difference,
       which is not evidence of sameness. Given a margin - the difference you are willing to
       call unimportant, set before looking - every pair of sites is tested for equivalence.

       Every pair must pass, and that needs no correction for multiplicity: requiring all of
       several claims is an intersection-union test, and its error rate is already at most
       alpha. Correcting here would make a conservative test more conservative still. */
    let equivalence = null;
    const T = tost();
    if (opt.margin !== undefined && opt.margin !== null && opt.margin !== '' && T) {
      const margin = Number(opt.margin);
      if (!(isFinite(margin) && margin > 0)) throw new Error('The equivalence margin must be a number greater than zero: the difference between sites you are willing to call unimportant.');
      const pairs = [];
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const rowsFor = clean.filter(r => r.site === names[i] || r.site === names[j]).map(r => ({ group: r.site, value: r.value }));
          try {
            const t = T.analyze(rowsFor, { margin, reference: names[i], test: names[j] });
            pairs.push({ a: names[i], b: names[j], verdict: t.verdict, equivalent: !!t.equivalent, differs: !!t.differs,
              diff: t.diff, ciLow: t.ciLow, ciHigh: t.ciHigh, needed: t.needed === undefined ? null : t.needed });
          } catch (e) { pairs.push({ a: names[i], b: names[j], verdict: 'not testable', error: e.message, equivalent: false, differs: false, diff: null, ciLow: null, ciHigh: null, needed: null }); }
        }
      }
      const failed = pairs.filter(p => !p.equivalent);
      const inconclusive = failed.filter(p => !p.differs);
      equivalence = {
        margin, pairs, allEquivalent: failed.length === 0,
        verdict: failed.length === 0 ? 'every pair is equivalent within the margin'
          : failed.some(p => p.differs) ? 'at least one pair differs by more than the margin'
            : 'inconclusive: no pair was shown to differ, and none was shown to be equivalent either',
        why: 'Margin ' + margin + ', applied to all ' + pairs.length + ' pair' + (pairs.length === 1 ? '' : 's') + ' of sites. ' +
          (failed.length === 0
            ? 'Every interval for a difference between sites sits inside the margin, so on this attribute the sites are interchangeable at the stated confidence.'
            : failed.some(p => p.differs)
              ? 'These pairs differ by more than the margin: ' + failed.filter(p => p.differs).map(p => p.a + ' vs ' + p.b).join(', ') + '. That is a real finding about the transfer, not a sample-size problem.'
              : 'No pair was shown to differ, but none was shown to be equivalent either - the intervals are wider than the margin. That is the inconclusive case, and it is a statement about the study rather than the sites' +
                (inconclusive.some(p => p.needed) ? ': about ' + Math.max(...inconclusive.map(p => p.needed || 0)) + ' results per site would settle it.' : '.')) +
          ' Every pair has to pass, and that needs no correction for multiplicity: requiring all of several claims at once is an intersection-union test, whose overall risk is already at most the 5% each one carries. Correcting here would only make a conservative test more conservative.'
      };
    }
    const combined = poolable ? capability(allValues, spec) : null;
    const best = per[per.length - 1], worst = per[0];

    return {
      sites: names.length, perSite: per, best: best.site, worst: worst.site,
      meansTest: means, spreadsTest: spreads, sameCentre, sameSpread, poolable,
      equivalence,
      combined: combined ? { Cp: combined.Cp, Cpk: combined.Cpk, Pp: combined.Pp, Ppk: combined.Ppk, n: combined.n, mean: combined.mean, sd: combined.sdOverall } : null,
      betweenShare, spread: { worstPpk: worst.Ppk, bestPpk: best.Ppk },
      why: names.length + ' sites, ' + clean.length + ' results. ' +
        'Centres: ' + (sameCentre === null ? 'not testable' : sameCentre ? 'no difference detected (p = ' + means.p.toFixed(3) + ')' : 'they differ (p = ' + (means.p < 0.001 ? '<0.001' : means.p.toFixed(3)) + ')') + '. ' +
        'Spreads: ' + (sameSpread === null ? 'not testable' : sameSpread ? 'no difference detected (p = ' + spreads.p.toFixed(3) + ')' : 'they differ (p = ' + (spreads.p < 0.001 ? '<0.001' : spreads.p.toFixed(3)) + ')') + '. ' +
        (poolable
          ? 'On both counts these behave as one process, so a combined index is reported and means what it says.'
          : 'So a combined index is withheld: ' +
            (sameCentre === false && sameSpread === false ? 'the sites differ in both centre and spread'
              : sameCentre === false ? 'the sites are centred differently, so a combined spread would include the gap between them and describe a mixture no site actually runs'
                : 'the sites have different spreads, so one index would flatter the worse site and penalise the better one') +
            '. Read the per-site rows instead; they are each correct.') +
        (betweenShare === null ? '' : ' Between-site differences account for ' + Math.round(betweenShare * 100) + '% of the total spread' +
          (betweenShare > 0.3 ? ', so harmonising the sites is where the capability is, not tightening any one of them.' : ', so most of the variation lives inside the sites rather than between them, and harmonising would buy little.')) +
        (equivalence ? ' Equivalence against a margin of ' + equivalence.margin + ': ' + equivalence.verdict + '.' : ' No equivalence margin was given, so nothing here shows the sites are interchangeable - only whether a difference was detected, which is a different claim.') +
        ' Worst is ' + worst.site + (worst.Ppk === null ? '' : ' at Ppk ' + worst.Ppk.toFixed(2)) + ', best is ' + best.site + (best.Ppk === null ? '' : ' at Ppk ' + best.Ppk.toFixed(2)) + '.'
    };
  }

  /* ---------- Subgroup charts: X-bar with R or S ----------
     The individuals chart is the only variables chart here, so anyone sampling three or five
     per batch has been averaging first and throwing away the within-subgroup spread, which
     is the thing that sets the limits.

     Three ways these go wrong, and all three are handled rather than assumed away:

     1. The spread chart comes first. X-bar limits are computed FROM the within-subgroup
        spread, so if the R or S chart is out of control the X-bar limits are built on a
        moving foundation and mean nothing. The verdict here is gated on that.
     2. X-bar limits are not specification limits, and the two get compared constantly.
        Subgroup means vary by sigma over root n, so the limits are narrower than the process
        by that factor - at n = 5, less than half as wide. A process can sit comfortably
        inside X-bar limits and still make product outside specification.
     3. Subgrouping decides what the chart can see. If a subgroup spans a real source of
        variation - cavities, lanes, two filling heads - that variation lands inside the
        subgroup, inflates the limits, and the chart goes quiet whatever the process does.
        That is detectable, and it is reported.

     The S-chart constants are computed exactly from the gamma function. The R-chart ones
     come from the published d2 and d3 table, which is why ranges are only offered up to
     subgroups of ten; above that the tool uses S, whose constants need no table. */
  const D2 = { 2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704, 8: 2.847, 9: 2.970, 10: 3.078 };
  const D3T = { 2: 0.853, 3: 0.888, 4: 0.880, 5: 0.864, 6: 0.848, 7: 0.833, 8: 0.820, 9: 0.808, 10: 0.797 };
  const c4of = n => Math.sqrt(2 / (n - 1)) * Math.exp(E.lgamma(n / 2) - E.lgamma((n - 1) / 2));

  function subgroupChart(rows, opt) {
    opt = opt || {};
    const clean = (rows || []).map(r => (r ? { subgroup: String(r.subgroup === undefined ? '' : r.subgroup).trim(), value: num(r.value) ? Number(r.value) : null } : null))
      .filter(r => r && r.subgroup !== '' && r.value !== null);
    if (!clean.length) throw new Error('No usable rows. Each row needs a subgroup label and a numeric result.');
    const labels = [];
    for (const r of clean) if (labels.indexOf(r.subgroup) < 0) labels.push(r.subgroup);
    if (labels.length < 8) throw new Error('Only ' + labels.length + ' subgroups. Below about 8 the limits move more than the process does; collect more before charting.');
    const groups = labels.map(L => clean.filter(r => r.subgroup === L).map(r => r.value));
    const sizes = groups.map(g => g.length);
    const nMin = Math.min(...sizes), nMax = Math.max(...sizes);
    if (nMin < 2) throw new Error('Subgroup "' + labels[sizes.indexOf(nMin)] + '" has one result. A subgroup of one has no within-subgroup spread, which is what these limits are built from - use the individuals chart instead.');

    /* R needs a table and only goes to ten; S is computed and has no such limit. Unequal
       sizes also rule R out, because the range is not comparable across different n. */
    const varying = nMin !== nMax;
    const useS = opt.kind === 's' || varying || nMax > 10;
    if (opt.kind === 'r' && (varying || nMax > 10)) {
      throw new Error(varying
        ? 'Subgroup sizes differ (' + nMin + ' to ' + nMax + '), so ranges are not comparable between them. The S chart handles unequal sizes and is used instead.'
        : 'Subgroups of ' + nMax + ' are too large for a range chart to be efficient, and the published range constants stop at ten. Use the S chart.');
    }

    const means = groups.map(g => mean(g));
    const sdOf = g => { const m = mean(g); return Math.sqrt(g.reduce((a, v) => a + (v - m) * (v - m), 0) / (g.length - 1)); };
    const spreads = groups.map(g => (useS ? sdOf(g) : Math.max(...g) - Math.min(...g)));
    const grand = clean.reduce((a, r) => a + r.value, 0) / clean.length;

    /* Within-subgroup sigma. With equal sizes this is the plain average spread over its
       constant; with unequal sizes the pooled form is used, which weights by how much each
       subgroup actually knows. */
    let sigmaWithin, spreadBar, limitsFor;
    if (useS) {
      if (varying) {
        const num2 = groups.reduce((a, g, i) => a + (g.length - 1) * spreads[i] * spreads[i], 0);
        const den = groups.reduce((a, g) => a + (g.length - 1), 0);
        sigmaWithin = Math.sqrt(num2 / den);
        spreadBar = sigmaWithin * c4of(Math.round(clean.length / labels.length));
      } else {
        spreadBar = mean(spreads);
        sigmaWithin = spreadBar / c4of(nMax);
      }
      limitsFor = i => {
        const n = sizes[i], c4 = c4of(n), root = Math.sqrt(Math.max(0, 1 - c4 * c4));
        return { xUcl: grand + 3 * sigmaWithin / Math.sqrt(n), xLcl: grand - 3 * sigmaWithin / Math.sqrt(n),
          sUcl: sigmaWithin * (c4 + 3 * root), sLcl: Math.max(0, sigmaWithin * (c4 - 3 * root)), centre: sigmaWithin * c4 };
      };
    } else {
      spreadBar = mean(spreads);
      const d2 = D2[nMax], d3 = D3T[nMax];
      sigmaWithin = spreadBar / d2;
      limitsFor = () => ({ xUcl: grand + 3 * sigmaWithin / Math.sqrt(nMax), xLcl: grand - 3 * sigmaWithin / Math.sqrt(nMax),
        sUcl: spreadBar * (1 + 3 * d3 / d2), sLcl: Math.max(0, spreadBar * (1 - 3 * d3 / d2)), centre: spreadBar });
    }

    const lim = labels.map((_, i) => limitsFor(i));
    const spreadSignals = [], meanSignals = [];
    spreads.forEach((v, i) => { if (v > lim[i].sUcl || v < lim[i].sLcl) spreadSignals.push({ i, label: labels[i], value: v }); });
    means.forEach((v, i) => { if (v > lim[i].xUcl || v < lim[i].xLcl) meanSignals.push({ i, label: labels[i], value: v }); });

    /* Is the subgrouping rational? If a subgroup spans a real source of variation, the
       within-subgroup spread swallows it, the X-bar limits widen, and the means huddle well
       inside them. Comparing the observed scatter of the means against what the within-
       subgroup spread predicts detects exactly that. Near 1 is healthy. */
    const sdMeans = means.length > 1 ? Math.sqrt(means.reduce((a, v) => a + (v - mean(means)) * (v - mean(means)), 0) / (means.length - 1)) : 0;
    const expected = sigmaWithin / Math.sqrt(clean.length / labels.length);
    const ratio = expected > 0 ? sdMeans / expected : null;
    const subgroupingSuspect = ratio !== null && ratio < 0.7;

    const specGiven = opt.spec && (num(opt.spec.lsl) || num(opt.spec.usl));
    return {
      kind: useS ? 'xbar-s' : 'xbar-r', subgroups: labels.length, labels, sizes, n: clean.length,
      means, spreads, grand, spreadBar, sigmaWithin, limits: lim,
      meanSignals, spreadSignals,
      spreadStable: spreadSignals.length === 0,
      ratio, subgroupingSuspect,
      why: labels.length + ' subgroups of ' + (varying ? nMin + ' to ' + nMax : nMax) + ', charted as X-bar and ' + (useS ? 'S' : 'R') + '. ' +
        (spreadSignals.length
          ? 'Read the ' + (useS ? 'S' : 'R') + ' chart first, and stop there: ' + spreadSignals.length + ' subgroup' + (spreadSignals.length === 1 ? ' has' : 's have') +
            ' a spread outside its limits, and the X-bar limits are computed from that same spread. Until the within-subgroup variation is stable, the limits on the means are built on a moving foundation and the signals on them cannot be read.'
          : 'The ' + (useS ? 'S' : 'R') + ' chart is in control, so the within-subgroup spread is a stable foundation and the X-bar limits mean what they say. ' +
            (meanSignals.length ? meanSignals.length + ' subgroup mean' + (meanSignals.length === 1 ? '' : 's') + ' outside the limits.' : 'No subgroup mean is outside its limits.')) +
        ' Within-subgroup sigma is ' + sigmaWithin.toPrecision(4) + ', so the limits on the means sit at three sigma over root ' +
        (varying ? 'n' : nMax) + ' - narrower than the process itself by that factor.' +
        (specGiven ? ' Specification limits were supplied and are deliberately NOT drawn on the X-bar chart: a subgroup mean is not a unit of product, and comparing the two is the commonest serious misreading of this chart. Judge capability on the individual results, not on the means.' : '') +
        (subgroupingSuspect
          ? ' The subgroup means scatter only ' + ratio.toFixed(2) + ' times as much as the within-subgroup spread predicts. That usually means each subgroup already contains a source of variation it should be comparing across - different cavities, lanes or heads sampled into one subgroup - which inflates the limits and leaves the chart unable to signal. Subgroup within a stream, not across them.'
          : ratio === null ? '' : ' The means scatter ' + ratio.toFixed(2) + ' times what the within-subgroup spread predicts, which is consistent with subgroups that capture only common-cause variation.')
    };
  }

  root.MLSpc = { normCdf, normInv, capability, crossSite, subgroupChart, imr, countChart, rareEvents, cusum, ewma, shortSigma, boxCoxLambda, nonNormalTail, box, snRatio, taguchi, attribute };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MLSpc;
})(typeof globalThis !== 'undefined' ? globalThis : this);
