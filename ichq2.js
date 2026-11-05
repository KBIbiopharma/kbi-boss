/* ICH Q2 method validation: linearity, detection and quantitation limits, and robustness.

   These are named calculations with published formulas, so the arithmetic is not the hard
   part. The hard part is that each of the three has a standard way of being reported that
   is wrong, and all three are easy to pass by accident:

   - Linearity gets reported as r-squared, and r-squared is not linearity. A curve through
     five points returns r-squared above 0.999 while bending visibly. So the test here is a
     lack-of-fit F test where replicates exist, and a curvature test on a fitted quadratic
     where they do not, and the verdict comes from those rather than from the correlation.

   - LOD and LOQ fall out of 3.3 and 10 times sigma over the slope, and nothing in that
     formula knows whether the answer lies anywhere near the data it came from. A quantitation
     limit computed from standards running 80 to 120% of nominal is an extrapolation two
     orders of magnitude below the lowest one. The formula will not say so; this does.

   - Robustness is judged by finding no significant effect, which on six runs is close to
     guaranteed whether the method is robust or not. So the minimum detectable effect is
     reported beside every p-value, and a design too small to see an effect that matters is
     reported as uninformative rather than as a pass.

   Depends on the engine only. No network, no storage. */
(function (root) {
  'use strict';
  const E = root.MLEngine || require('./engine.js');

  const num = v => v !== null && v !== undefined && v !== '' && isFinite(Number(v));
  const clean = (a, what) => {
    const v = (a || []).map(x => (num(x) ? Number(x) : null));
    if (v.some(x => x === null)) throw new Error('Every ' + what + ' must be a number. Leave a run out rather than entering a blank or a placeholder.');
    return v;
  };

  /* Ordinary least squares with the standard errors, solved from the normal equations by
     Gaussian elimination. Small, exact, and it keeps this file to one dependency. */
  function ols(X, y) {
    const n = y.length, p = X[0].length;
    const A = [], b = [];
    for (let i = 0; i < p; i++) {
      A.push(new Array(p).fill(0)); b.push(0);
      for (let k = 0; k < n; k++) {
        b[i] += X[k][i] * y[k];
        for (let j = 0; j < p; j++) A[i][j] += X[k][i] * X[k][j];
      }
    }
    // Invert by elimination on [A | I]; p is 2 or 3 here, so this is exact and cheap.
    const M = A.map((r, i) => r.concat(Array.from({ length: p }, (_, j) => (i === j ? 1 : 0))));
    for (let c = 0; c < p; c++) {
      let piv = c;
      for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) throw new Error('These concentrations do not vary enough to fit a line through them.');
      [M[c], M[piv]] = [M[piv], M[c]];
      const d = M[c][c];
      for (let j = 0; j < 2 * p; j++) M[c][j] /= d;
      for (let r = 0; r < p; r++) {
        if (r === c) continue;
        const f = M[r][c];
        for (let j = 0; j < 2 * p; j++) M[r][j] -= f * M[c][j];
      }
    }
    const inv = M.map(r => r.slice(p));
    const coef = inv.map(r => r.reduce((s, v, j) => s + v * b[j], 0));
    const fit = X.map(r => r.reduce((s, v, j) => s + v * coef[j], 0));
    const sse = y.reduce((s, v, i) => s + (v - fit[i]) ** 2, 0);
    const df = n - p;
    const mse = df > 0 ? sse / df : NaN;
    const se = inv.map((row, i) => Math.sqrt(Math.max(0, mse * row[i])));   // row is inv[i], so row[i] is the diagonal
    return { coef, se, fit, sse, df, mse, resid: y.map((v, i) => v - fit[i]) };
  }

  const fP = (F, d1, d2) => (!(F > 0) || !(d1 > 0) || !(d2 > 0) ? 1 : E.ibeta(d2 / 2, d1 / 2, d2 / (d2 + d1 * F)));

  /* ---------- Linearity ----------
     ICH Q2 asks for the slope, the intercept, the correlation, the residual sum of squares
     and a plot of the residuals. The plot is there because the numbers cannot show curvature
     and the picture can, so the curvature is tested here rather than left to the eye. */
  function linearity(conc, resp, opt) {
    opt = opt || {};
    const x = clean(conc, 'concentration'), y = clean(resp, 'response');
    if (x.length !== y.length) throw new Error('Got ' + x.length + ' concentrations and ' + y.length + ' responses. There must be one response per standard.');
    const n = x.length;
    if (n < 5) throw new Error('Need at least 5 points to assess linearity; ICH Q2 asks for a minimum of 5 concentration levels. Got ' + n + '.');
    const levels = [...new Set(x)].sort((a, b) => a - b);
    if (levels.length < 3) throw new Error('These ' + n + ' points sit at only ' + levels.length + ' distinct concentrations. A line through ' + levels.length + ' levels cannot show whether the response is linear.');

    const fit = ols(x.map(v => [1, v]), y);
    const [intercept, slope] = fit.coef;
    const r = E.pearson(x, y);
    const syx = Math.sqrt(fit.mse);                       // residual standard deviation
    // tQuantile takes a TAIL AREA, not a cumulative probability: alpha/2 per side.
    const t = E.tQuantile((opt.alpha === undefined ? 0.05 : opt.alpha) / 2, fit.df);

    /* Lack of fit, the proper test, available only when a level was measured more than
       once: it splits the residual into error the method actually makes and error the
       straight line makes, and only the second is evidence of curvature. */
    let lackOfFit = null;
    const reps = levels.filter(L => x.filter(v => v === L).length > 1).length;
    if (reps > 0 && levels.length > 2) {
      let ssPure = 0;
      for (const L of levels) {
        const at = y.filter((_, i) => x[i] === L);
        if (at.length < 2) continue;
        const m = E.mean(at);
        ssPure += at.reduce((s, v) => s + (v - m) ** 2, 0);
      }
      const dfPure = n - levels.length, dfLof = levels.length - 2;
      const ssLof = fit.sse - ssPure;
      if (dfPure > 0 && dfLof > 0 && ssPure > 0) {
        const F = (ssLof / dfLof) / (ssPure / dfPure);
        lackOfFit = { F, df1: dfLof, df2: dfPure, p: fP(F, dfLof, dfPure), ssPure, ssLof };
      }
    }

    /* With no replicates there is no pure error to compare against, so the fallback is to
       fit the squared term and ask whether it is needed. Weaker, and labelled as weaker. */
    let curvature = null;
    if (!lackOfFit && levels.length >= 4 && n >= 5) {
      const q = ols(x.map(v => [1, v, v * v]), y);
      const tq = q.coef[2] / (q.se[2] || Infinity);
      curvature = { coef: q.coef[2], t: tq, p: E.tTestP(tq, q.df), df: q.df };
    }

    const bent = (lackOfFit && lackOfFit.p < 0.05) || (curvature && curvature.p < 0.05);
    const range = [Math.min(...x), Math.max(...x)];
    /* ICH Q2 asks for a minimum of five concentration levels. Three can still be fitted and
       tested, so refusing them would be over-strict; but a study that falls short of the
       guideline should say so itself rather than leave a reviewer to count. */
    const meetsGuideline = levels.length >= 5;
    return {
      n, levels: levels.length, meetsGuideline, range,
      slope, intercept, r, r2: r * r, residualSd: syx, sse: fit.sse, df: fit.df,
      slopeSe: fit.se[1], interceptSe: fit.se[0],
      slopeCi: [slope - t * fit.se[1], slope + t * fit.se[1]],
      interceptCi: [intercept - t * fit.se[0], intercept + t * fit.se[0]],
      // The intercept as a percentage of the response at the top standard: a usual criterion.
      interceptPctOfTop: slope * range[1] + intercept !== 0 ? (intercept / (slope * range[1] + intercept)) * 100 : null,
      residuals: fit.resid, fitted: fit.fit, x: x.slice(), y: y.slice(),
      lackOfFit, curvature, linear: !bent,
      why: 'Slope ' + slope.toPrecision(4) + ', intercept ' + intercept.toPrecision(4) + ', r² ' + (r * r).toFixed(5) + '. ' +
        (lackOfFit
          ? 'Lack of fit F(' + lackOfFit.df1 + ',' + lackOfFit.df2 + ') = ' + lackOfFit.F.toFixed(2) + ', p = ' + lackOfFit.p.toFixed(4) +
            (lackOfFit.p < 0.05
              ? ' - the straight line misses by more than the method’s own repeat error, so the response is not linear over this range however high r² reads.'
              : ' - what the line misses is within the method’s own repeat error, which is what linearity means here.')
          : curvature
            ? 'No level was measured twice, so there is no pure error to test against. Fitting a squared term instead gives p = ' + curvature.p.toFixed(4) +
              (curvature.p < 0.05 ? ' - the curve is needed, so the response bends.' : ' - the squared term is not needed. This is weaker evidence than a lack-of-fit test; replicate at least one level to get one.')
            : 'Too few distinct levels to test the shape at all: r² is reported but it is not evidence of linearity.') +
        (meetsGuideline ? '' : ' Note: ' + levels.length + ' concentration levels were used, and ICH Q2 asks for a minimum of 5, so this falls short of the guideline whatever the numbers say.') +
        ' r² on its own never is - a quadratic through five points returns r² above 0.999 while bending visibly, which is why ICH Q2 asks for the residual plot.'
    };
  }

  /* ---------- Detection and quantitation limits ----------
     LOD = 3.3 sigma / slope and LOQ = 10 sigma / slope, where sigma is the standard
     deviation of the response. Which sigma has to be named, because the three choices
     ICH allows do not give the same answer. */
  function detectionLimits(lin, opt) {
    opt = opt || {};
    if (!lin || !isFinite(lin.slope)) throw new Error('Fit the linearity first: the limits are computed from its slope and residual spread.');
    const S = Math.abs(lin.slope);
    if (!(S > 0)) throw new Error('The slope is zero, so the response does not change with concentration and no limit can be derived from it.');

    let sigma, source;
    if (opt.blankSd !== undefined && opt.blankSd !== null) {
      if (!num(opt.blankSd) || Number(opt.blankSd) <= 0) throw new Error('The blank standard deviation must be a positive number.');
      sigma = Number(opt.blankSd); source = 'the standard deviation of the blank, which you supplied';
    } else if (opt.sigma === 'intercept') {
      sigma = lin.interceptSe; source = 'the standard error of the y-intercept';
    } else {
      sigma = lin.residualSd; source = 'the residual standard deviation of the regression';
    }
    if (!(sigma > 0)) throw new Error('The spread used for the limit is zero, which means the data is noiseless. A detection limit computed from it would be zero, which is not a result.');

    const lod = 3.3 * sigma / S, loq = 10 * sigma / S;
    const lowest = lin.range[0], top = lin.range[1];
    /* The formula is happy to answer far below anything that was measured. ICH expects the
       limit to be confirmed by analysing a sample at about that level, so say where it falls. */
    const loqInRange = loq >= lowest && loq <= top;
    const lodInRange = lod >= lowest && lod <= top;
    const factorBelow = lowest > 0 ? lowest / loq : null;

    return {
      lod, loq, sigma, slope: S, sigmaSource: source,
      lodInRange, loqInRange, studiedRange: [lowest, top],
      confirmed: false,
      why: 'LOD = 3.3 × ' + sigma.toPrecision(4) + ' / ' + S.toPrecision(4) + ' = ' + lod.toPrecision(4) +
        ' and LOQ = 10 × sigma / slope = ' + loq.toPrecision(4) + ', with sigma taken from ' + source + '. ' +
        (loqInRange
          ? 'The quantitation limit falls inside the range that was actually measured (' + lowest.toPrecision(4) + ' to ' + top.toPrecision(4) + '), so the figure rests on data rather than on extension of the line.'
          : 'The quantitation limit lies OUTSIDE the range that was measured (' + lowest.toPrecision(4) + ' to ' + top.toPrecision(4) + ')' +
            (factorBelow && factorBelow > 1 ? ', about ' + factorBelow.toPrecision(3) + ' times below the lowest standard' : '') +
            '. The formula cannot tell that: it extends the line to a concentration nobody ran. ICH Q2 expects the limit to be confirmed by analysing samples at about that level, and until that is done this is an estimate of where the limit might be, not a validated limit.') +
        ' Changing which sigma is used changes the answer, so the source is reported with the number rather than left to a method file.'
    };
  }

  /* ---------- Robustness ----------
     A robustness study varies method parameters on purpose and looks for an effect. Finding
     none is the expected outcome of a small study whether the method is robust or not, so
     what matters is the smallest effect the study could have detected. */
  function robustness(runs, opt) {
    opt = opt || {};
    const rows = runs || [];
    if (rows.length < 4) throw new Error('Need at least 4 runs to estimate any effect. A robustness study smaller than that cannot distinguish a change from the noise.');
    const names = Object.keys(rows[0].factors || {});
    if (!names.length) throw new Error('Each run needs its factor settings, as an object of name to level.');
    const y = clean(rows.map(r => r.response), 'response');

    // Code each factor to -1 / +1 from its two levels; a robustness study is a two-level design.
    const coded = names.map(nm => {
      const vals = [...new Set(rows.map(r => r.factors[nm]))];
      if (vals.length !== 2) throw new Error('Factor "' + nm + '" has ' + vals.length + ' levels. A robustness study varies each parameter between two deliberate settings.');
      const [lo, hi] = vals.slice().sort((a, b) => (num(a) && num(b) ? a - b : String(a) < String(b) ? -1 : 1));
      return { name: nm, lo, hi, col: rows.map(r => (r.factors[nm] === hi ? 1 : -1)) };
    });

    const X = rows.map((_, i) => [1].concat(coded.map(c => c.col[i])));
    if (X.length <= X[0].length) throw new Error('With ' + names.length + ' factors you need more than ' + X[0].length + ' runs to estimate their effects and still have error left to judge them against. Got ' + rows.length + '.');
    const fit = ols(X, y);
    /* A perfect fit leaves nothing to judge an effect against. The t statistic would be a
       division by zero, and reporting p = 1 from it would turn "this design cannot test
       anything" into "no effect found", which is the exact misreading this function exists
       to prevent. Refuse and say what would fix it. */
    if (!(fit.mse > 0)) {
      throw new Error('These ' + rows.length + ' runs fit the factor model exactly, so there is no residual error to test the effects against. ' +
        'That usually means the design is saturated or the responses were generated without noise. Add replicate runs, or centre points, so the method\u2019s own variation can be estimated.');
    }
    const t = E.tQuantile(0.025, fit.df);          // tail area per side, for a 95% interval
    /* The smallest effect this design could have detected, at 5% significance and 80% power.
       The 2.8 is the sum of the two normal quantiles (1.96 + 0.84), the usual approximation. */
    /* The smallest effect this design could reliably detect, at 5% significance and 80%
       power. Built from the t distribution rather than the normal one: with two or three
       degrees of freedom the normal quantile understates it badly, and understating the
       minimum detectable effect is the exact direction that makes an underpowered study
       look reassuring. The largest factor standard error is used, so the figure holds for
       every factor rather than only the best-estimated one. */
    const seMax = Math.max(...fit.se.slice(1).map(v => 2 * v));
    const mde = (E.tQuantile(0.025, fit.df) + E.tQuantile(0.20, fit.df)) * seMax;
    const limit = opt.acceptable === undefined || opt.acceptable === null ? null : Math.abs(Number(opt.acceptable));

    const effects = coded.map((c, k) => {
      const eff = 2 * fit.coef[k + 1];                 // change from low to high setting
      const se = 2 * fit.se[k + 1];
      const tv = se > 0 ? eff / se : 0;
      return { factor: c.name, low: c.lo, high: c.hi, effect: eff, se, t: tv, p: E.tTestP(tv, fit.df), ci: [eff - t * se, eff + t * se] };
    }).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));

    const moved = effects.filter(e => e.p < 0.05);
    /* The honest verdict. "No significant effect" is only reassuring if the study could have
       seen an effect worth worrying about; otherwise it is a statement about the study. */
    const underpowered = limit !== null && mde > limit;
    const verdict = moved.length ? 'not robust to ' + moved.map(e => e.factor).join(', ')
      : underpowered ? 'uninformative'
        : limit !== null ? 'robust within the limit you set'
          : 'no effect detected, and no acceptable limit was given to judge that against';

    return {
      n: rows.length, factors: names.length, df: fit.df, residualSd: Math.sqrt(fit.mse),
      effects, minimumDetectableEffect: mde, acceptable: limit, underpowered, verdict,
      why: rows.length + ' runs over ' + names.length + ' factors leaves ' + fit.df + ' degrees of freedom for error. ' +
        (moved.length
          ? moved.length + ' factor' + (moved.length === 1 ? '' : 's') + ' moved the response: ' + moved.map(e => e.factor + ' by ' + e.effect.toPrecision(3)).join(', ') + '. '
          : 'No factor reached significance. ') +
        'The smallest effect this design could reliably detect is about ' + mde.toPrecision(3) +
        (limit !== null
          ? ', against the ' + limit.toPrecision(3) + ' you called acceptable. ' +
            (underpowered
              ? 'That is larger than the limit, so this study could have missed an effect you would have cared about. Finding nothing here is a statement about the study, not about the method: add runs or replicate before calling it robust.'
              : 'That is inside the limit, so the study was capable of seeing an effect that mattered, and it did not find one.')
          : '. No acceptable limit was supplied, so there is nothing to judge that against: a p-value above 0.05 on ' + rows.length + ' runs is the expected outcome whether the method is robust or not.')
    };
  }

  root.MLIchQ2 = { linearity, detectionLimits, robustness, ols };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MLIchQ2;
})(typeof globalThis !== 'undefined' ? globalThis : this);
