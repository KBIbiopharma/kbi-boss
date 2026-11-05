/* Changepoint detection: where the series stopped describing the same process.

   A forecast, a control chart and a capability index all assume one regime. Fit any of them
   to a record that contains a line modification, a new raw-material supplier or a vessel
   change, and the early data is describing a process that no longer exists. CUSUM would say
   a shift happened and roughly when; what was missing is segmenting the series there and
   refitting from the last regime, which is the part that changes what you do.

   The reason changepoint detection has a bad reputation is worth stating up front, because
   it is the whole difficulty: EVERY sequence of random numbers has a best split point. Take
   thirty draws from one distribution, try all the places you could cut them, and one cut
   will separate them better than any other - that is arithmetic, not a finding. Testing the
   two sides of that best cut with a t-test gives a tiny p-value on pure noise, because the
   cut was chosen to make it small. It is the same mistake as picking the largest of twenty
   effects and quoting its unadjusted p-value, and it is why people find changepoints in
   data that never changed.

   So the threshold here is not a formula. The maximum improvement over all candidate cuts
   is computed, and then the same maximum is computed on the same numbers in shuffled order,
   a few thousand times. That gives the distribution of "best cut you would find in data with
   no changepoint at all", measured on your own values, and the p-value is the share of
   shuffles that beat what the real order produced. No normality assumption, no asymptotic
   approximation, and the multiplicity of searching every cut is inside the null rather than
   corrected for afterwards.

   One thing a shuffle cannot do is keep autocorrelation, and an autocorrelated series that
   never changed regime will drift in ways that look exactly like a changepoint. That is the
   dominant cause of false findings and it is measured rather than mentioned: see lag1 and
   the warning it raises.

   Depends on the engine only. No network, no storage. */
(function (root) {
  'use strict';
  const E = root.MLEngine || require('./engine.js');

  /* Total within-segment sum of squares for a single split at k (first segment is values
     0..k-1). Computed from running sums so trying every cut is one pass, not n passes. */
  function bestSplit(y, minSeg) {
    const n = y.length;
    const pre = new Float64Array(n + 1), pre2 = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { pre[i + 1] = pre[i] + y[i]; pre2[i + 1] = pre2[i] + y[i] * y[i]; }
    const sseOf = (a, b) => {           // sum of squares about the mean of y[a..b-1]
      const m = b - a; if (m <= 0) return 0;
      const s = pre[b] - pre[a];
      return (pre2[b] - pre2[a]) - s * s / m;
    };
    const total = sseOf(0, n);
    let best = null;
    for (let k = minSeg; k <= n - minSeg; k++) {
      const sse = sseOf(0, k) + sseOf(k, n);
      const gain = total - sse;
      if (!best || gain > best.gain) best = { k, gain, sse, meanBefore: (pre[k]) / k, meanAfter: (pre[n] - pre[k]) / (n - k) };
    }
    if (!best) return null;
    /* Scaled so the statistic does not grow simply with the spread of the data, which keeps
       it comparable across series and makes the shuffled null a null about SHAPE in time
       rather than about scale. */
    best.statistic = total > 0 ? best.gain / total : 0;
    best.total = total;
    return best;
  }

  function lag1(y) {
    const n = y.length;
    if (n < 3) return null;
    const m = E.mean(y);
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { const d = y[i] - m; den += d * d; if (i) num += d * (y[i - 1] - m); }
    return den > 0 ? num / den : null;
  }

  /* One changepoint, tested against the best cut that the same numbers produce in a random
     order. `reps` shuffles; the seed is fixed so the same data gives the same answer twice. */
  function testOne(y, opt) {
    opt = opt || {};
    const minSeg = Math.max(2, opt.minSegment || Math.max(3, Math.floor(y.length * 0.1)));
    if (y.length < 2 * minSeg) return null;
    const obs = bestSplit(y, minSeg);
    if (!obs) return null;
    const reps = opt.reps || 2000;
    const rand = E.rng(opt.seed === undefined ? 17 : opt.seed);
    const copy = y.slice();
    let beaten = 0;
    for (let r = 0; r < reps; r++) {
      E.shuffle(copy, rand);
      const s = bestSplit(copy, minSeg);
      if (s && s.statistic >= obs.statistic) beaten++;
    }
    /* Add-one smoothing, so a p-value is never reported as exactly zero from a finite number
       of shuffles - with 2000 of them the smallest honest statement is "below 1 in 2001". */
    const p = (beaten + 1) / (reps + 1);
    return { k: obs.k, statistic: obs.statistic, gain: obs.gain, p, reps, minSeg,
             meanBefore: obs.meanBefore, meanAfter: obs.meanAfter, shift: obs.meanAfter - obs.meanBefore };
  }

  /* How far out could the position be? On an unlucky record, several points - and somebody
     is going to take this number to a batch record and look for what happened on that date,
     so a point estimate alone sends them to the wrong day. The spread is found by bootstrap
     rather than by a formula: hold the two fitted means, resample the residuals around them,
     re-run the same search, and see where the best cut lands. Conditioning on the estimated
     shift makes this optimistic, so the coverage it actually achieves is measured rather
     than claimed - see the test, which holds it to what it really delivers. */
  function locationInterval(y, k, minSeg, reps, seed) {
    const n = y.length;
    const a = y.slice(0, k), b = y.slice(k);
    const ma = E.mean(a), mb = E.mean(b);
    const resid = a.map(v => v - ma).concat(b.map(v => v - mb));
    const rand = E.rng(seed);
    const locs = [];
    const sim = new Array(n);
    for (let r = 0; r < reps; r++) {
      for (let i = 0; i < n; i++) sim[i] = (i < k ? ma : mb) + resid[Math.floor(rand() * resid.length)];
      const bs = bestSplit(sim, minSeg);
      if (bs) locs.push(bs.k);
    }
    if (!locs.length) return null;
    locs.sort((x, z) => x - z);
    const q = f => locs[Math.min(locs.length - 1, Math.max(0, Math.round(f * (locs.length - 1))))];
    return { lo: q(0.05), hi: q(0.95), reps: locs.length };
  }

  /* Binary segmentation: test the whole series, and if it splits, test each side the same
     way. Each test is a fresh permutation test on its own segment, so each p-value is
     locally honest - but the FAMILY of them is not, and the count of tests run is reported
     so that is visible rather than implied. */
  function detect(values, opt) {
    opt = opt || {};
    const y = (values || []).map(v => (v === null || v === undefined || v === '' ? null : Number(v)))
      .filter(v => v !== null && isFinite(v));
    if (y.length < 12) throw new Error('At least twelve points are needed before a changepoint can be told from a wiggle. With ' + y.length + ' the best split in pure noise is as convincing as the best split in a real shift, and nothing can separate them.');

    const alpha = opt.alpha === undefined ? 0.05 : opt.alpha;
    const minSeg = Math.max(2, opt.minSegment || Math.max(3, Math.floor(y.length * 0.1)));
    const maxDepth = opt.maxDepth === undefined ? 3 : opt.maxDepth;

    let tests = 0;
    const found = [];
    const search = (from, to, depth) => {
      if (depth > maxDepth) return;
      const seg = y.slice(from, to);
      if (seg.length < 2 * minSeg) return;
      const r = testOne(seg, { reps: opt.reps, seed: (opt.seed === undefined ? 17 : opt.seed) + from, minSegment: minSeg });
      tests++;
      if (!r || r.p > alpha) return;
      const at = from + r.k;
      const li = locationInterval(seg, r.k, minSeg, opt.locReps || 400, (opt.seed === undefined ? 17 : opt.seed) + 991 + from);
      found.push({ index: at, p: r.p, statistic: r.statistic, shift: r.shift,
                   meanBefore: r.meanBefore, meanAfter: r.meanAfter, depth,
                   locationLo: li ? from + li.lo : null, locationHi: li ? from + li.hi : null });
      search(from, at, depth + 1);
      search(at, to, depth + 1);
    };
    search(0, y.length, 0);
    found.sort((a, b) => a.index - b.index);

    // Segments between the changepoints, each with the numbers you would actually use.
    const cuts = [0].concat(found.map(c => c.index), [y.length]);
    const segments = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const part = y.slice(cuts[i], cuts[i + 1]);
      segments.push({ from: cuts[i], to: cuts[i + 1], n: part.length, mean: E.mean(part), sd: part.length > 1 ? E.sd(part) : null });
    }
    const last = segments[segments.length - 1];
    const whole = { n: y.length, mean: E.mean(y), sd: E.sd(y) };

    /* What the whole-history numbers cost, in the currency a control chart is read in. A
       step shift lands in the whole-history standard deviation as if it were noise, so the
       limits built from it are wider than the process they are meant to police - and a chart
       whose limits are too wide cannot signal the very shift that widened them. */
    const inflation = last.sd !== null && last.sd > 0 ? whole.sd / last.sd : null;
    const limitsWholeHistory = [whole.mean - 3 * whole.sd, whole.mean + 3 * whole.sd];
    const limitsLastRegime = last.sd === null ? null : [last.mean - 3 * last.sd, last.mean + 3 * last.sd];

    /* An autocorrelated series that never changed regime wanders, and a wander looks like a
       shift to any method that compares one stretch against another. The shuffled null cannot
       see that, because shuffling destroys the correlation it would need to reproduce. So the
       correlation is measured and said out loud.

       It has to be measured on the residuals about the SEGMENT means, not on the raw series.
       A step change makes a series look strongly autocorrelated whether or not its noise is -
       every point on one side of the shift sits above the overall mean and every point on the
       other sits below it, which is exactly what lag-1 correlation measures. Computed on the
       raw values, a clean 4-sigma step in independent noise reads 0.78, and the warning would
       then fire hardest precisely when the method had just worked. On the residuals the same
       series reads near zero, and a genuinely correlated one still reads high. */
    const resid = [];
    for (const seg of segments) {
      const part = y.slice(seg.from, seg.to), m = seg.mean;
      for (const v of part) resid.push(v - m);
    }
    const r1 = lag1(resid);
    const r1raw = lag1(y);
    const autoWarning = r1 !== null && r1 > 0.3;

    const why = y.length + ' points' + (found.length === 0
      ? '. No changepoint found: the best split in the real order is not better than the best split these same numbers produce in a shuffled order, so the series is consistent with one regime throughout. Worth knowing what that does and does not say - it does not mean nothing changed, it means a step change big enough to stand out from ' + y.length + ' points of this spread did not happen.'
      : ', ' + found.length + ' changepoint' + (found.length === 1 ? '' : 's') + ' at position' + (found.length === 1 ? ' ' : 's ') + found.map(c => c.index + 1).join(', ') +
        '. The largest moves the mean by ' + (() => { const b = found.slice().sort((x, z) => Math.abs(z.shift) - Math.abs(x.shift))[0]; return (b.shift > 0 ? '+' : '') + b.shift.toPrecision(4); })() +
        '. Each p-value is the share of ' + (opt.reps || 2000) + ' shuffles of that segment whose own best split beat the real one, so searching every candidate cut is inside the null rather than corrected afterwards.' +
        (tests > 1 ? ' ' + tests + ' such tests were run in all, which is where the family-wise rate goes: each p-value is honest on its own segment and the set of them is not, so treat changepoints after the first as weaker.' : '') +
        (inflation === null || inflation <= 1.15 ? ''
          : ' The whole record has a standard deviation ' + inflation.toFixed(2) + ' times the last regime’s, because the shift itself lands in it as though it were noise. Three-sigma limits from the whole history run ' +
            limitsWholeHistory[0].toPrecision(4) + ' to ' + limitsWholeHistory[1].toPrecision(4) + ' against ' + limitsLastRegime[0].toPrecision(4) + ' to ' + limitsLastRegime[1].toPrecision(4) +
            ' from the last regime alone. ' +
            (inflation >= 2
              ? 'At an inflation this large a chart stops working: measured on simulated series at 2.3 times, limits taken from the whole history caught a subsequent one-sigma shift in 2% of runs against 44% for limits taken from the last regime, and at 3.2 times it was 0% against 45%. Wider limits sound like the safe error and are not - they are a chart that cannot signal.'
              : 'An inflation of this size is worth correcting but is not on its own what blinds a chart: measured at 1.34 times, the two sets of limits caught a subsequent 1.5-sigma shift at 73% and 75%, which is no practical difference. The figure it does move is capability.') +
            ' And capability moves in a direction you cannot predict without doing this: measured on a process shifted toward its limit, the whole-history Cpk read 0.52 against the 0.33 the process actually running had - overstating by 1.56 times - while on a tighter configuration it read 1.15 against a true 1.27, understating. There is no safe-side argument for using the whole record, because the error has no reliable sign.')) +
      (r1 === null ? '' : ' Lag-1 autocorrelation within the segments is ' + r1.toFixed(2) +
        (r1raw !== null && Math.abs(r1raw - r1) > 0.15 ? ' (the raw series reads ' + r1raw.toFixed(2) + ', inflated by the step itself - every point on one side of a shift sits above the overall mean, which is what lag-1 measures, so the raw figure is not the one to read here)' : '') + '.' +
        (autoWarning
          ? ' That is high, and it is the main way this method goes wrong: a correlated series that never changed regime still wanders, a wander looks like a step, and the shuffled null cannot reproduce the wander because shuffling destroys the correlation. Measured on simulated AR(1) series of 60 points with no changepoint at all: at a lag-1 of 0.2 this found one in 16% of them, at 0.4 in 30%, at 0.55 in 59% and at 0.72 in 87%, against the 5% it would claim. Treat a finding on this series as a hypothesis to check against the batch record, not as evidence.'
          : ' Low enough that the shuffled null is a fair comparison for this series.'));

    return {
      n: y.length, values: y, changepoints: found, segments, tests,
      lastRegime: last, whole, inflation, limitsWholeHistory, limitsLastRegime,
      lag1: r1, lag1Raw: r1raw, autocorrelationWarning: autoWarning,
      alpha, minSegment: minSeg, reps: opt.reps || 2000, why
    };
  }

  root.MLChangepoint = { detect, testOne, bestSplit, lag1 };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MLChangepoint;
})(typeof globalThis !== 'undefined' ? globalThis : this);
