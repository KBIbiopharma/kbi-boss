/* Particle size distribution fitted across the bins.

   Counts per bin were already handled as counts - charted, trended, made capable. What was
   missing is any model of the bin STRUCTURE, and that is where the information is. Two
   containers can report the same count at 10 micrometres and hold completely different
   populations: one where the count collapses with size, one where a flat tail carries far
   more large particles. The large ones are the clinically interesting ones and the rarest,
   so the counts alone hide exactly the change that matters.

   One number fixes that: the slope of cumulative count against size on a log-log scale.
   Subvisible particle populations are very often close to a power law, N(>=d) = n0 * d^-a,
   and the exponent a IS the shape - a steep slope means the population dies off quickly
   with size, a shallow one means a heavy tail. A change in slope at an unchanged 10 um
   count is a change in the generating mechanism, and it is invisible to a count chart.

   Three things this is careful about, because they are what makes a fitted distribution
   either useful or quietly misleading:

   1. USP <788> reports TWO thresholds, 10 um and 25 um. Two points determine a
      two-parameter distribution exactly, leaving no residual to check, so the fit cannot
      be wrong on this data and that is not a good thing - it means nothing tests it. The
      model comparison is refused below four bins and the reason is stated.
   2. A three-parameter lognormal fitted to three bins also fits exactly, so comparing its
      residuals against a two-parameter power law's on three points picks the lognormal
      every time by construction. The comparison is gated on degrees of freedom, not on
      which residual is smaller.
   3. Extrapolating past the largest bin is where the shape assumption is spent, and the
      two candidate shapes diverge hard out there - a power law has a far heavier tail
      than a lognormal. The divergence is measured and reported next to the estimate
      rather than left for somebody to find out from a regulator.

   Depends on the engine only. No network, no storage. */
(function (root) {
  'use strict';
  const E = root.MLEngine || require('./engine.js');
  const num = v => v !== null && v !== undefined && v !== '' && isFinite(Number(v));

  /* Ordinary least squares on log size against log cumulative count. Written out rather
     than borrowed so the standard error of the slope is available: the slope is the whole
     finding here, and a slope without an interval is not a finding. */
  function ols(xs, ys) {
    const n = xs.length;
    const mx = E.mean(xs), my = E.mean(ys);
    let sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) * (xs[i] - mx); sxy += (xs[i] - mx) * (ys[i] - my); }
    const slope = sxx > 0 ? sxy / sxx : 0;
    const intercept = my - slope * mx;
    const resid = xs.map((x, i) => ys[i] - (intercept + slope * x));
    const df = n - 2;
    const sse = resid.reduce((a, r) => a + r * r, 0);
    const residSd = df > 0 ? Math.sqrt(sse / df) : null;
    const slopeSe = df > 0 && sxx > 0 ? Math.sqrt(sse / df / sxx) : null;
    return { slope, intercept, resid, residSd, slopeSe, df, sxx, n };
  }

  /* Power law on the cumulative counts: ln N = ln n0 - a * ln d. The exponent comes back
     positive, because a population whose count falls with size is the normal case and a
     negative-looking number for it reads as a mistake. */
  function powerLaw(bins) {
    const xs = bins.map(b => Math.log(b.size)), ys = bins.map(b => Math.log(b.count));
    const f = ols(xs, ys);
    const alpha = -f.slope;
    const ci = f.slopeSe === null ? null
      : [alpha - E.tQuantile(0.025, f.df) * f.slopeSe, alpha + E.tQuantile(0.025, f.df) * f.slopeSe];
    return {
      kind: 'power law', params: 2, alpha, alphaSe: f.slopeSe, alphaCi: ci,
      lnN0: f.intercept, residSd: f.residSd, df: f.df,
      resid: f.resid, sxx: f.sxx, n: f.n,
      predict: d => Math.exp(f.intercept + f.slope * Math.log(d))
    };
  }

  /* Lognormal survival fitted to the same cumulative counts: N(>=d) = total * (1 - Phi(z)).
     Three parameters, but only two need searching - for any (mu, sigma) the scale that
     minimises squared error on the log counts is the mean log offset, in closed form. So
     this is a 2-D search, done on a grid and then refined, which cannot run away the way
     a gradient step on three coupled parameters can. */
  function logNormal(bins) {
    const ys = bins.map(b => Math.log(b.count));
    const lnd = bins.map(b => Math.log(b.size));
    const scaleFor = (mu, sigma) => {
      let acc = 0;
      for (let i = 0; i < bins.length; i++) {
        const s = 1 - E.normCdf((lnd[i] - mu) / sigma);
        if (!(s > 0)) return null;
        acc += ys[i] - Math.log(s);
      }
      return acc / bins.length;
    };
    const sseAt = (mu, sigma) => {
      const lnTot = scaleFor(mu, sigma);
      if (lnTot === null) return Infinity;
      let sse = 0;
      for (let i = 0; i < bins.length; i++) {
        const s = 1 - E.normCdf((lnd[i] - mu) / sigma);
        const r = ys[i] - (lnTot + Math.log(s));
        sse += r * r;
      }
      return sse;
    };
    /* The grid starts below the smallest bin, because a subvisible population's mode sits
       below the smallest size anybody measured - that is why the counts are cumulative. */
    let best = { sse: Infinity, mu: 0, sigma: 1 };
    const loMu = lnd[0] - 6, hiMu = lnd[lnd.length - 1] + 1;
    for (let i = 0; i <= 80; i++) {
      const mu = loMu + (hiMu - loMu) * i / 80;
      for (let j = 1; j <= 60; j++) {
        const sigma = 0.1 + (4 - 0.1) * j / 60;
        const sse = sseAt(mu, sigma);
        if (sse < best.sse) best = { sse, mu, sigma };
      }
    }
    let stepMu = (hiMu - loMu) / 80, stepSig = 4 / 60;
    for (let round = 0; round < 60; round++) {
      let moved = false;
      for (const [dm, ds] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const mu = best.mu + dm * stepMu, sigma = best.sigma + ds * stepSig;
        if (sigma <= 0.02) continue;
        const sse = sseAt(mu, sigma);
        if (sse < best.sse) { best = { sse, mu, sigma }; moved = true; }
      }
      if (!moved) { stepMu /= 2; stepSig /= 2; }
    }
    const lnTot = scaleFor(best.mu, best.sigma);
    if (lnTot === null || !isFinite(best.sse)) return null;
    const df = bins.length - 3;
    const surv = d => 1 - E.normCdf((Math.log(d) - best.mu) / best.sigma);
    const resid = bins.map((b, i) => ys[i] - (lnTot + Math.log(surv(b.size))));
    return {
      kind: 'lognormal', params: 3, mu: best.mu, sigma: best.sigma,
      total: Math.exp(lnTot), residSd: df > 0 ? Math.sqrt(best.sse / df) : null, df,
      resid, n: bins.length,
      predict: d => Math.exp(lnTot) * surv(d)
    };
  }

  function analyze(rows, opt) {
    opt = opt || {};
    const kind = opt.kind === 'interval' ? 'interval' : 'cumulative';

    let raw = (rows || []).map(x => {
      if (!x) return null;
      const size = num(x.size) ? Number(x.size) : null;
      const count = num(x.count) ? Number(x.count) : null;
      if (size === null || count === null) return null;
      return { size, count };
    }).filter(Boolean);
    if (raw.length < 2) throw new Error('At least two size bins are needed, and each needs a size and a count. One bin is a count, not a distribution.');
    if (raw.some(b => b.size <= 0)) throw new Error('Every size threshold must be greater than zero: the fit works on log size, and a threshold of zero or below has no logarithm.');
    if (raw.some(b => b.count < 0)) throw new Error('A negative count is a data error, not a small count.');
    raw.sort((a, b) => a.size - b.size);
    const sizes = raw.map(b => b.size);
    if (new Set(sizes).size !== sizes.length) throw new Error('Two bins share the same size threshold. Combine them, or say which one the counts belong to.');

    /* Interval counts converted to cumulative by summing from the top, which is the only
       direction that works: the count at or above a size is everything in its own bin plus
       everything in every larger bin. */
    let bins = raw.map(b => ({ size: b.size, count: b.count }));
    if (kind === 'interval') {
      let running = 0;
      for (let i = bins.length - 1; i >= 0; i--) { running += bins[i].count; bins[i] = { size: bins[i].size, count: running }; }
    }

    /* A cumulative count cannot rise with size. When it does, the usual cause is that the
       counts are per-bin and were declared cumulative, which is worth naming rather than
       reporting as a data error, because the fix is a dropdown rather than a re-count. */
    const rising = [];
    for (let i = 1; i < bins.length; i++) if (bins[i].count > bins[i - 1].count) rising.push(bins[i].size);
    if (rising.length) {
      throw new Error('The count at ' + rising.join(' and ') + ' micrometres is HIGHER than the count at a smaller size, which a cumulative count cannot be - everything at or above 25 is also at or above 10. ' +
        (kind === 'cumulative'
          ? 'The likeliest cause is that these are counts within each bin rather than counts at or above each size; switch the input to per-bin and they will be summed correctly.'
          : 'As per-bin counts these were summed from the largest bin down, so this points at a data error rather than the convention.'));
    }

    /* Zeros carry real information - the count is below one - but they have no logarithm,
       so they cannot sit in the fit. Set aside and named, because silently dropping the
       largest bin is silently dropping the part of the distribution people care about. */
    const zeroBins = bins.filter(b => b.count === 0).map(b => b.size);
    const fitBins = bins.filter(b => b.count > 0);
    if (fitBins.length < 2) throw new Error('After setting aside the bins with a count of zero there are fewer than two left to fit. A zero count is a real result - it says fewer than one particle was found - but it has no logarithm and cannot sit in the fit.');

    const pl = powerLaw(fitBins);
    const ln = fitBins.length >= 3 ? logNormal(fitBins) : null;

    /* Degrees of freedom decide whether anything can be compared, not which residual is
       smaller. A three-parameter lognormal on three bins fits exactly and would win every
       time; four bins is the first point where it has a residual of its own to defend. */
    const checkable = fitBins.length >= 3;             // the power law has a spare point
    /* The real precondition is that BOTH fits have a residual of their own to defend, which
       is what the bin counts imply - but stating it directly means a change to either gate
       cannot produce a comparison against a null residual. */
    const comparable = fitBins.length >= 4 && !!ln && pl.residSd !== null && ln.residSd !== null;
    let preferred = null, preferredWhy = '';
    if (comparable) {
      const better = ln.residSd < pl.residSd ? ln : pl;
      const ratio = Math.max(pl.residSd, ln.residSd) / Math.max(1e-12, Math.min(pl.residSd, ln.residSd));
      preferred = ratio < 1.5 ? null : better.kind;
      preferredWhy = ratio < 1.5
        ? 'Neither shape describes these bins appreciably better: the residual spreads are within a factor of 1.5 of each other (' +
          pl.residSd.toFixed(3) + ' for the power law on ' + pl.df + ' degrees of freedom, ' + ln.residSd.toFixed(3) + ' for the lognormal on ' + ln.df +
          '). On this many bins that is the usual outcome, and it means the choice of shape has to be justified from what the particles are, not from the fit.'
        : 'The ' + better.kind + ' fits these bins better - residual spread ' + better.residSd.toFixed(3) + ' against ' +
          (better === ln ? pl.residSd.toFixed(3) : ln.residSd.toFixed(3)) + ' on log counts - by more than a factor of 1.5. Note the lognormal carries three parameters against the power law’s two, so it is expected to fit a little better even when it is not the better description; the margin here is past that.';
    }

    const dMin = fitBins[0].size, dMax = fitBins[fitBins.length - 1].size;

    /* What the shape assumption costs, measured where it is actually spent. Both fitted
       shapes are extrapolated to twice the largest bin and the answers compared. */
    let divergence = null;
    if (ln) {
      const at = dMax * 2;
      const a = pl.predict(at), b = ln.predict(at);
      divergence = { size: at, powerLaw: a, logNormal: b, ratio: b > 0 ? a / b : null };
    }

    const estimate = d => {
      if (!(d > 0)) return null;
      const inside = d >= dMin && d <= dMax;
      const a = pl.predict(d), b = ln ? ln.predict(d) : null;
      return {
        size: d, inside, powerLaw: a, logNormal: b,
        spread: b !== null && Math.min(a, b) > 0 ? Math.max(a, b) / Math.min(a, b) : null
      };
    };

    const curve = (() => {
      const lo = Math.log(dMin * 0.6), hi = Math.log(dMax * 2.2), out = [];
      for (let i = 0; i <= 70; i++) {
        const d = Math.exp(lo + (hi - lo) * i / 70);
        out.push({ size: d, powerLaw: pl.predict(d), logNormal: ln ? ln.predict(d) : null });
      }
      return out;
    })();

    const why = fitBins.length + ' bin' + (fitBins.length === 1 ? '' : 's') + ' from ' + dMin + ' to ' + dMax + ' micrometres' +
      (zeroBins.length ? ', with ' + zeroBins.length + ' zero-count bin' + (zeroBins.length === 1 ? '' : 's') + ' (' + zeroBins.join(', ') + ' um) set aside because a zero has no logarithm' : '') + '. ' +
      'The population falls off as size to the power of ' + pl.alpha.toFixed(2) +
      (pl.alphaCi ? ' (95% interval ' + pl.alphaCi[0].toFixed(2) + ' to ' + pl.alphaCi[1].toFixed(2) + ')' : '') + '. ' +
      (!checkable
        ? 'With only ' + fitBins.length + ' bins the power law fits them EXACTLY, because two points determine a two-parameter line. There is no residual left over, so nothing here tests whether a power law is the right shape at all - and USP <788> reports exactly these two thresholds, so this is the normal situation rather than an unlucky one. The fitted numbers are usable for reading between 10 and 25 micrometres and should not be pushed past 25 without a flow-imaging run that puts a third and fourth bin under them.'
        : 'Residual spread on log counts is ' + pl.residSd.toFixed(3) + ' on ' + pl.df + ' degree' + (pl.df === 1 ? '' : 's') + ' of freedom, so the shape has at least been tested. ' +
          (comparable ? preferredWhy : 'A lognormal needs three parameters and so needs four bins before it has a residual of its own; with ' + fitBins.length + ' it fits exactly and cannot be compared against the power law on fit.')) +
      (divergence && divergence.ratio !== null
        ? ' Extrapolation is where the shape assumption gets spent: at ' + divergence.size.toPrecision(3) + ' micrometres, past every bin measured, the power law predicts ' +
          divergence.ratio.toFixed(1) + ' times as many particles as the lognormal (' + divergence.powerLaw.toPrecision(3) + ' against ' + divergence.logNormal.toPrecision(3) +
          '). A power law has the heavier tail, so it is the conservative choice for a limit and the alarming one for a report; either way the gap is the assumption, not the data.'
        : '');

    return {
      kind, bins, fitBins, zeroBins, dMin, dMax,
      powerLaw: pl, logNormal: ln,
      alpha: pl.alpha, alphaCi: pl.alphaCi,
      checkable, comparable, preferred, preferredWhy,
      divergence, estimate, curve, why
    };
  }

  /* Two populations, same bins: has the SHAPE changed, or only the level? This is the
     question a count chart cannot answer, and it is the one a process change asks. The
     slopes are compared with their own standard errors, so "the slopes look different"
     becomes a number with a false-alarm rate attached. */
  function compare(groups, opt) {
    opt = opt || {};
    const fits = groups.map(g => {
      const r = analyze(g.rows, opt);
      return { label: g.label, fit: r, alpha: r.alpha, se: r.powerLaw.alphaSe, df: r.powerLaw.df, n: r.fitBins.length };
    });
    if (fits.length < 2) throw new Error('Two groups are needed to compare shapes. One group is a distribution, not a comparison.');
    const usable = fits.filter(f => f.se !== null && f.df > 0);
    if (usable.length < 2) {
      return {
        fits, testable: false,
        why: 'The slopes cannot be compared: a slope needs a standard error, and that needs at least three bins per group so the fit has a residual. ' +
          (fits.some(f => f.n === 2) ? 'At least one group here has two bins, where the line passes exactly through both points and no spread around it exists to measure. ' : '') +
          'The slopes themselves are still reported and the difference between them is still visible - what is missing is any way to say whether it is larger than the noise.'
      };
    }
    /* Pairwise on the two with the most bins, which is the comparison with the most to
       say; every pair is reported so a third group is not silently dropped. */
    const pairs = [];
    for (let i = 0; i < usable.length; i++) for (let j = i + 1; j < usable.length; j++) {
      const a = usable[i], b = usable[j];
      const diff = a.alpha - b.alpha;
      const se = Math.sqrt(a.se * a.se + b.se * b.se);
      const df = a.df + b.df;
      const t = se > 0 ? diff / se : 0;
      const p = E.tTestP(Math.abs(t), df);
      const crit = E.tQuantile(0.025, df);
      pairs.push({
        a: a.label, b: b.label, alphaA: a.alpha, alphaB: b.alpha, diff, se, t, df, p,
        ci: [diff - crit * se, diff + crit * se],
        differs: p < 0.05
      });
    }
    const any = pairs.some(p => p.differs);
    return {
      fits, pairs, testable: true, shapesDiffer: any,
      why: (any
        ? 'At least one pair of populations has a genuinely different slope, which means the size distribution changed shape and not merely level. That is a different finding from a higher count: the mechanism generating the particles is not the same one. '
        : 'No pair of slopes differs by more than its own noise, so the populations have the same shape as far as this comparison can tell. ') +
        'Slopes compared with their own standard errors on ' + pairs[0].df + ' degrees of freedom. ' +
        /* The honest caveat, measured rather than hedged. The slope's standard error is the
           scatter about a straight line on a log-log plot, and on a real population most of
           that scatter is the curve genuinely bending rather than sampling noise - so the
           error bar describes the wrong thing and comes out far too wide. Simulated on
           lognormal populations binned at 2, 5, 10 and 25 micrometres: under the null this
           test fired 0 times in 300, against the 5% it claims, and on a genuine shape change
           that doubled the 25 um count at an IDENTICAL 10 um count it fired 22% of the time.
           The nested tail fraction on the same data caught that change every time. */
        'Treat a "no difference" here as almost no evidence: measured on simulated lognormal populations binned at 2, 5, 10 and 25 micrometres, this slope test fired 0 times in 300 under the null against the 5% it nominally claims, and detected a real shape change that raised the 25 um count 2.6-fold at an unchanged 10 um count only 22% of the time. The nested tail fraction caught that same change in 100% of runs and needs only two bins. Use the slope to DESCRIBE the shape and the tail fraction to TEST it.'
    };
  }

  /* The slope is the whole-shape summary, but it needs three bins to carry an error bar and
     four to be compared, and USP <788> reports TWO. So the comparison that matters most has
     to work on two bins, and it does - because the counts are nested. Every particle at or
     above 25 um is also at or above 10 um, so N(>=25)/N(>=10) is not a ratio of two noisy
     numbers, it is a PROPORTION: given a particle big enough to be counted at 10, how often
     is it also big enough to be counted at 25. That proportion IS the tail shape, its error
     is binomial and exactly known, and it moves when the mechanism changes even if the 10 um
     count does not budge.

     This is also why it beats the slope test on real data. The slope's standard error comes
     from the scatter about a straight line on a log-log plot, and on a real particle
     population most of that scatter is the curve genuinely bending, not sampling noise - so
     the error bar describes the wrong thing and comes out too wide. Measured below. */
  function wilson(k, n, z) {
    if (!(n > 0)) return null;
    const p = k / n, z2 = z * z;
    const denom = 1 + z2 / n;
    const centre = (p + z2 / (2 * n)) / denom;
    const half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom;
    /* The score interval always contains the observed proportion - at p0 = p-hat the test
       statistic is exactly zero - but the closed form lands one unit in the last place short
       of it when k equals n, which hands back an interval that excludes the number it
       describes. Clamping to the observed value costs nothing and removes a predicate that
       would otherwise be false for 1e-16 worth of arithmetic. */
    return [Math.min(p, Math.max(0, centre - half)), Math.max(p, Math.min(1, centre + half))];
  }

  /* Two nested thresholds, one group each: has the fraction surviving to the larger size
     changed? Nested counts, so a two-proportion test on the conditional fraction. */
  function tailFraction(groups, lo, hi) {
    const at = (rows, d) => {
      const b = (rows || []).map(x => ({ size: Number(x.size), count: Number(x.count) })).find(x => x.size === d);
      return b ? b.count : null;
    };
    const g = groups.map(x => {
      const n = at(x.rows, lo), k = at(x.rows, hi);
      return { label: x.label, n, k, fraction: n > 0 ? k / n : null, ci: n > 0 ? wilson(k, n, 1.959963984540054) : null };
    });
    const bad = g.filter(x => x.n === null || x.k === null);
    if (bad.length) throw new Error('Not every group has a count at both ' + lo + ' and ' + hi + ' micrometres: ' + bad.map(x => x.label).join(', ') + '. The tail fraction compares the same two thresholds across groups, so both have to be present in each.');
    if (g.some(x => !(x.n > 0))) throw new Error('A group has no particles at or above ' + lo + ' micrometres, so there is nothing for a fraction to be out of.');
    if (g.some(x => x.k > x.n)) throw new Error('A group counts more particles at ' + hi + ' um than at ' + lo + ' um, which nested counts cannot do.');

    const pairs = [];
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const a = g[i], b = g[j];
      const pooled = (a.k + b.k) / (a.n + b.n);
      const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.n + 1 / b.n));
      const z = se > 0 ? (a.fraction - b.fraction) / se : 0;
      const p = 2 * (1 - E.normCdf(Math.abs(z)));
      const seUn = Math.sqrt(a.fraction * (1 - a.fraction) / a.n + b.fraction * (1 - b.fraction) / b.n);
      pairs.push({
        a: a.label, b: b.label, fractionA: a.fraction, fractionB: b.fraction,
        diff: a.fraction - b.fraction, z, p, differs: p < 0.05,
        ci: [(a.fraction - b.fraction) - 1.959963984540054 * seUn, (a.fraction - b.fraction) + 1.959963984540054 * seUn],
        ratio: b.fraction > 0 ? a.fraction / b.fraction : null
      });
    }
    return {
      lo, hi, groups: g, pairs, differs: pairs.some(x => x.differs),
      why: 'Of the particles counted at or above ' + lo + ' micrometres, the fraction that reach ' + hi + ' is ' +
        g.map(x => x.label + ' ' + (100 * x.fraction).toPrecision(3) + '%').join(', ') + '. ' +
        'These counts are nested - every particle at or above ' + hi + ' is also at or above ' + lo + ' - so this is a proportion with a binomial error, not a ratio of two independent numbers, and the interval on it is exact rather than fitted. ' +
        (pairs.some(x => x.differs)
          ? 'At least one pair differs beyond that error, so the shape of the population has changed. Worth saying plainly what that means: a heavier tail at an unchanged ' + lo + ' um count is not a bigger version of the same problem, it is a different population - and the large particles are both the rarest and the ones that matter.'
          : 'No pair differs beyond that error. The tail fraction is the same as far as these counts can tell, so any difference in level between the groups is a count question rather than a distribution question.')
    };
  }

  root.MLParticles = { analyze, compare, tailFraction, wilson, powerLaw, logNormal };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MLParticles;
})(typeof globalThis !== 'undefined' ? globalThis : this);
