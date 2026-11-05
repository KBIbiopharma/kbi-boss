/* Forecasting a trend forward, and measuring whether the forecast is worth anything.

   The tool could already say that a level had moved (CUSUM, EWMA) and project a stability
   trend to its specification (ICH Q1E). It could not say where a monthly metric lands next
   quarter, and - more to the point - nothing here measured forecast accuracy at all.

   The measuring is the part that matters, so it is the part this file is built around:

   - Every method is scored by ROLLING ORIGIN backtest. Fit on the first k points, forecast
     the next h, step forward, repeat. Parameters are fitted inside each origin, never on
     the whole series, for the same reason a category encoding is fitted inside each fold.
   - The headline metric is MASE, the error scaled by what the naive forecast achieves on
     the training data. Below 1 means better than naive; at or above 1 the method has earned
     nothing, whatever its R-squared or how good the chart looks.
   - A seasonal series gets seasonal-naive as the baseline instead, because "same month last
     year" is the thing a seasonal method has to beat to be worth running.
   - Intervals come from the backtest errors by split conformal, so their coverage is
     measured on forecasts the method had not seen rather than assumed from a formula.

   That is also what makes this the harness for anything bought in. A foundation model's
   forecasts arrive as a column, go through the same rolling origin, and get the same MASE
   against the same baseline. No vendor's benchmark required.

   Depends on the engine and, where present, the uncertainty module. No network, no storage. */
(function (root) {
  'use strict';
  const E = root.MLEngine || require('./engine.js');
  const unc = () => root.MLUncertainty || (typeof require !== 'undefined' ? require('./uncertainty.js') : null);

  const num = v => v !== null && v !== undefined && v !== '' && isFinite(Number(v));
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

  // ---------- the methods ----------
  /* Each takes a training series and a horizon and returns h numbers. They are deliberately
     simple: on the 20 to 60 points a monthly process metric gives you, a damped trend is
     usually the best thing available and anything more elaborate is fitting noise. */
  const naive = (y, h) => new Array(h).fill(y[y.length - 1]);

  const seasonalNaive = (y, h, m) => {
    if (!m || y.length < m) return naive(y, h);
    return Array.from({ length: h }, (_, i) => y[y.length - m + ((i) % m)]);
  };

  const drift = (y, h) => {
    const n = y.length;
    if (n < 2) return naive(y, h);
    const slope = (y[n - 1] - y[0]) / (n - 1);
    return Array.from({ length: h }, (_, i) => y[n - 1] + slope * (i + 1));
  };

  /* Exponential smoothing with an optional trend and an optional damping on it. phi = 1 is
     Holt's linear trend; below 1 the trend flattens out, which is what stops a forecast
     walking off the chart six periods ahead. */
  function expSmooth(y, h, p) {
    const alpha = p.alpha, beta = p.beta || 0, phi = p.phi === undefined ? 1 : p.phi;
    let level = y[0], trend = beta ? (y.length > 1 ? y[1] - y[0] : 0) : 0;
    for (let i = 1; i < y.length; i++) {
      const prev = level + phi * trend;
      level = alpha * y[i] + (1 - alpha) * prev;
      if (beta) trend = beta * (level - (prev - phi * trend)) + (1 - beta) * phi * trend;
    }
    const out = [];
    let damp = 0;
    for (let i = 1; i <= h; i++) { damp += Math.pow(phi, i); out.push(level + (beta ? damp * trend : 0)); }
    return out;
  }

  /* Parameters are chosen by one-step error on the training window only. A coarse grid is
     deliberate: finer tuning on 30 points is fitting the noise, and the backtest would show
     it as a worse score rather than a better one. */
  function fitSmooth(y, withTrend, damped) {
    let best = null;
    const alphas = [0.1, 0.2, 0.3, 0.5, 0.7, 0.9];
    const betas = withTrend ? [0.05, 0.1, 0.2, 0.4] : [0];
    const phis = damped ? [0.8, 0.9, 0.95, 0.98] : [1];
    for (const alpha of alphas) for (const beta of betas) for (const phi of phis) {
      let sse = 0;
      let level = y[0], trend = withTrend ? (y.length > 1 ? y[1] - y[0] : 0) : 0;
      for (let i = 1; i < y.length; i++) {
        const prev = level + phi * trend;
        sse += (y[i] - prev) * (y[i] - prev);
        level = alpha * y[i] + (1 - alpha) * prev;
        if (withTrend) trend = beta * (level - (prev - phi * trend)) + (1 - beta) * phi * trend;
      }
      if (best === null || sse < best.sse) best = { sse, alpha, beta, phi };
    }
    return best;
  }

  function holtWinters(y, h, m) {
    // Additive seasonality, fitted by a coarse grid on one-step error, seasonal start from the first cycles.
    if (!m || y.length < 2 * m) return null;
    let best = null;
    for (const alpha of [0.1, 0.3, 0.5]) for (const beta of [0.05, 0.1, 0.3]) for (const gamma of [0.1, 0.3, 0.5]) {
      const seas = [];
      for (let s = 0; s < m; s++) {
        const vals = [];
        for (let i = s; i < y.length; i += m) vals.push(y[i]);
        seas.push(mean(vals) - mean(y));
      }
      let level = mean(y.slice(0, m)), trend = (mean(y.slice(m, 2 * m)) - mean(y.slice(0, m))) / m, sse = 0;
      const S = seas.slice();
      for (let i = 0; i < y.length; i++) {
        const si = i % m, prev = level + trend + S[si];
        if (i >= m) sse += (y[i] - prev) * (y[i] - prev);
        const newLevel = alpha * (y[i] - S[si]) + (1 - alpha) * (level + trend);
        trend = beta * (newLevel - level) + (1 - beta) * trend;
        S[si] = gamma * (y[i] - newLevel) + (1 - gamma) * S[si];
        level = newLevel;
      }
      if (best === null || sse < best.sse) best = { sse, alpha, beta, gamma, level, trend, S: S.slice(), n: y.length };
    }
    if (!best) return null;
    const out = [];
    for (let i = 1; i <= h; i++) out.push(best.level + i * best.trend + best.S[(best.n + i - 1) % m]);
    return out;
  }

  function methodsFor(m, n) {
    const list = [
      { key: 'naive', name: 'Naive (carry the last value forward)', fn: (y, h) => naive(y, h), baseline: !m },
      { key: 'drift', name: 'Drift (last value plus the average trend)', fn: (y, h) => drift(y, h) },
      { key: 'ses', name: 'Exponential smoothing (level only)', fn: (y, h) => expSmooth(y, h, fitSmooth(y, false, false)) },
      { key: 'holt', name: "Holt's linear trend", fn: (y, h) => expSmooth(y, h, fitSmooth(y, true, false)) },
      { key: 'damped', name: 'Damped trend', fn: (y, h) => expSmooth(y, h, fitSmooth(y, true, true)) }
    ];
    if (m && n >= 2 * m) {
      list.unshift({ key: 'snaive', name: 'Seasonal naive (same point last cycle)', fn: (y, h) => seasonalNaive(y, h, m), baseline: true });
      list.push({ key: 'holtwinters', name: 'Holt-Winters (trend and season)', fn: (y, h) => holtWinters(y, h, m) });
    }
    return list;
  }

  /* ---------- the backtest ----------
     Rolling origin: fit on everything up to a point, forecast forward, score against what
     actually happened, move the origin on. Nothing a method sees at an origin includes
     anything after it. */
  function backtest(values, opt) {
    opt = opt || {};
    const y = (values || []).map(v => (num(v) ? Number(v) : null));
    if (y.some(v => v === null)) throw new Error('Every point must be a number. A gap in a time series is not a zero: leave the period out and say so, or interpolate it deliberately before charting.');
    const n = y.length;
    const m = opt.period && opt.period > 1 ? Math.round(opt.period) : null;
    const h = opt.horizon && opt.horizon > 0 ? Math.round(opt.horizon) : 1;

    const minTrain = Math.max(m ? 2 * m : 8, 8);
    if (n < minTrain + h + 2) {
      throw new Error('Need at least ' + (minTrain + h + 2) + ' points to backtest a ' + h + '-step forecast' +
        (m ? ' on a series with a cycle of ' + m : '') + ', and there are ' + n + '. Below that there are too few origins to tell one method from another, and the winner would be noise.');
    }
    if (m && n < 3 * m) {
      throw new Error('A seasonal method needs at least three full cycles to be worth fitting; ' + n + ' points over a cycle of ' + m + ' gives ' + (n / m).toFixed(1) + '. Run it without a period, or collect more.');
    }

    const methods = methodsFor(m, n);
    const origins = [];
    for (let t = minTrain; t + h <= n; t++) origins.push(t);

    /* The scale for MASE: the average one-step error the naive forecast makes in-sample.
       Seasonal series are scaled by seasonal-naive instead, because that is the thing a
       seasonal method has to beat. */
    let scaleSum = 0, scaleCount = 0;
    for (let i = (m || 1); i < n; i++) { scaleSum += Math.abs(y[i] - y[i - (m || 1)]); scaleCount++; }
    const scale = scaleCount ? scaleSum / scaleCount : 0;
    if (!(scale > 0)) throw new Error('Every point is identical, so there is nothing to forecast and no scale to measure an error against.');

    const results = methods.map(meth => {
      const errs = [], byHorizon = Array.from({ length: h }, () => []);
      let failed = 0;
      for (const t of origins) {
        const train = y.slice(0, t);
        let f;
        try { f = meth.fn(train, h); } catch (e) { f = null; }
        if (!f || f.some(v => !isFinite(v))) { failed++; continue; }
        for (let i = 0; i < h; i++) { const e = y[t + i] - f[i]; errs.push(e); byHorizon[i].push(e); }
      }
      if (!errs.length) return { key: meth.key, name: meth.name, usable: false, baseline: !!meth.baseline };
      const abs = errs.map(Math.abs);
      return {
        key: meth.key, name: meth.name, usable: true, baseline: !!meth.baseline,
        origins: origins.length - failed,
        mae: mean(abs), rmse: Math.sqrt(mean(errs.map(e => e * e))), mase: mean(abs) / scale,
        bias: mean(errs),
        byHorizon: byHorizon.map(es => (es.length ? mean(es.map(Math.abs)) / scale : null)),
        errors: errs
      };
    });

    const usable = results.filter(r => r.usable);
    if (!usable.length) throw new Error('No method produced a usable forecast on this series.');
    usable.sort((a, b) => a.mase - b.mase);
    const winner = usable[0];
    const base = usable.find(r => r.baseline) || null;
    const beatsBaseline = base ? winner.mase < base.mase : null;

    /* Intervals from the backtest errors, by split conformal: the width is the quantile of
       the errors the winning method actually made on forecasts it had not seen. */
    const U = unc();
    const conf = opt.confidence === undefined ? 0.9 : opt.confidence;
    let halfWidth = null, coverage = null;
    if (U && winner.errors.length >= 10) {
      const sorted = winner.errors.map(Math.abs).sort((a, b) => a - b);
      halfWidth = U.conformalQuantile(sorted, conf);
      coverage = winner.errors.filter(e => Math.abs(e) <= halfWidth).length / winner.errors.length;
    }

    const fitted = methods.find(mm => mm.key === winner.key);
    const ahead = fitted ? fitted.fn(y, h) : null;

    return {
      n, period: m, horizon: h, origins: origins.length, scale, scaledBy: m ? 'seasonal naive' : 'naive',
      maseIsDirect: h === 1,
      results: usable, winner, baseline: base, beatsBaseline,
      forecast: ahead, interval: halfWidth === null ? null : { halfWidth, confidence: conf, coverage },
      why: n + ' points, ' + origins.length + ' rolling origins, forecasting ' + h + ' step' + (h === 1 ? '' : 's') + ' ahead. ' +
        'Best by MASE: ' + winner.name + ' at ' + winner.mase.toFixed(3) + '. ' +
        (base === null ? ''
          : beatsBaseline
            ? 'That beats the ' + base.name.toLowerCase() + ' baseline (' + base.mase.toFixed(3) + '), so the method is earning its place.'
            : 'The ' + base.name.toLowerCase() + ' baseline scores ' + base.mase.toFixed(3) + ', which is at least as good. Nothing here has earned its place: forecast with the baseline, and treat any fancier method as unproven on this series until it beats it.') +
        ' MASE is the error divided by the one-step error ' + (m ? 'the same point last cycle' : 'carrying the last value forward') +
        ' makes on the training data. ' +
        (h === 1
          ? 'At one step ahead that makes the reading direct: below 1 is better than the baseline, at or above 1 is not. '
          : 'The scale stays the ONE-step error even though this forecast runs ' + h + ' steps, so figures above 1 are normal at this horizon and are not a failure - errors grow with distance. What decides it is the comparison against the baseline above, which was forecast over the same origins at the same horizon. ') +
        (halfWidth === null ? ''
          : 'The interval is the ' + Math.round(conf * 100) + 'th percentile of the errors this method actually made across the origins, so its width was measured rather than assumed; it caught ' +
            Math.round(coverage * 100) + '% of them. ') +
        'Everything here is scored on forecasts made before the answer was known. A method fitted to the whole series and scored on the same series would look far better and tell you nothing.'
    };
  }

  root.MLForecast = { backtest, naive, seasonalNaive, drift, expSmooth, fitSmooth, holtWinters, methodsFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MLForecast;
})(typeof globalThis !== 'undefined' ? globalThis : this);
