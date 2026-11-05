/* ML Agent Academy: interactive lessons. Each lesson has an analogy, a hands-on demo built
   on made-up data, plain-English steps, and a one-question check. Quiz progress is kept in
   memory only. No network, no storage. */
(function () {
  'use strict';
  const E = window.MLEngine, C = window.Charts, A = window.MLAgent, D = window.MLDoe;
  const S = window.MLSpc, V = window.MLVariance, TL = window.MLTolerance, U = window.MLUncertainty;
  const Q2 = window.MLIchQ2;
  const FC = window.MLForecast;
  const RL = window.MLReliability;
  const PD = window.MLParticles;
  const CP = window.MLChangepoint;
  const CB = window.MLComparability;
  const W = window.MLWatch;
  const h = C.esc, fmt = A.fmt, pct = A.pct;
  const range = E.range;

  // ---------- Small drawing helpers ----------
  function frame(W, H, xd, yd, o) {
    o = o || {};
    const L = o.l !== undefined ? o.l : 46, R = 14, T = o.t !== undefined ? o.t : 12, B = o.b !== undefined ? o.b : 38;
    const sx = v => L + (v - xd[0]) / (xd[1] - xd[0]) * (W - L - R);
    const sy = v => H - B - (v - yd[0]) / (yd[1] - yd[0]) * (H - T - B);
    let axes = '';
    if (!o.noAxes) {
      for (const t of C.niceTicks(yd[0], yd[1], 4)) if (t >= yd[0] && t <= yd[1]) axes += '<line class="gridline" x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(t) + '" y2="' + sy(t) + '"/><text x="' + (L - 6) + '" y="' + (sy(t) + 4) + '" text-anchor="end">' + h(o.yFmt ? o.yFmt(t) : fmt(t)) + '</text>';
      for (const t of C.niceTicks(xd[0], xd[1], 5)) if (t >= xd[0] && t <= xd[1]) axes += '<text x="' + sx(t) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + h(o.xFmt ? o.xFmt(t) : fmt(t)) + '</text>';
      axes += '<line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>';
      if (o.xLabel) axes += '<text class="lbl-strong" x="' + ((L + W - R) / 2) + '" y="' + (H - 4) + '" text-anchor="middle">' + h(o.xLabel) + '</text>';
      if (o.yLabel) axes += '<text class="lbl-strong" transform="translate(12 ' + ((T + H - B) / 2) + ') rotate(-90)" text-anchor="middle">' + h(o.yLabel) + '</text>';
    }
    const inv = (px, py) => [xd[0] + (px - L) / (W - L - R) * (xd[1] - xd[0]), yd[0] + (H - B - py) / (H - T - B) * (yd[1] - yd[0])];
    return { sx, sy, inv, axes, L, R, T, B, W, H, clip: '<clipPath id="clip' + (++clipN) + '"><rect x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '"/></clipPath>', clipId: 'clip' + clipN };
  }
  let clipN = 0;
  const svg = (W, H, label, body) => '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + h(label) + '">' + body + '</svg>';
  const pathOf = (pts, f) => pts.map((p, i) => (i ? 'L' : 'M') + f.sx(p[0]).toFixed(1) + ' ' + f.sy(p[1]).toFixed(1)).join('');
  function svgPoint(svgEl, e) {
    const r = svgEl.getBoundingClientRect(), vb = svgEl.viewBox.baseVal;
    return [(e.clientX - r.left) / r.width * vb.width, (e.clientY - r.top) / r.height * vb.height];
  }
  function slider(role, label, min, max, step, value) {
    return '<label>' + h(label) + ' <input type="range" data-role="' + role + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '"><output data-out="' + role + '">' + value + '</output></label>';
  }
  const btn = (role, label, cls) => '<button type="button" class="btn ' + (cls || '') + '" data-role="' + role + '">' + h(label) + '</button>';
  const q = (el, role) => el.querySelector('[data-role="' + role + '"]');
  const setOut = (el, role, v) => { const o = el.querySelector('[data-out="' + role + '"]'); if (o) o.textContent = v; };
  function normal(rand) { const u = Math.max(1e-12, rand()), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  const dot = (x, y, cls, r, tip, shape) => (tip ? '<g data-tip="' + h(tip) + '">' : '') + (shape === 'square'
    ? '<rect class="' + cls + '" x="' + (x - r) + '" y="' + (y - r) + '" width="' + 2 * r + '" height="' + 2 * r + '" rx="1"/>'
    : '<circle class="' + cls + '" cx="' + x + '" cy="' + y + '" r="' + r + '"/>') + (tip ? '</g>' : '');
  const passLegend = C.legend([{ label: 'Pass', cls: 'c1' }, { label: 'Fail', cls: 'c2', shape: 'square' }]);

  // Toy pass/fail process data: passes inside a temperature window at low humidity.
  function passFail(n, seed) {
    const rand = E.rng(seed), X = [], y = [];
    for (let i = 0; i < n; i++) {
      const t = 150 + 100 * rand(), hu = 20 + 60 * rand();
      let pass = t > 180 && t < 230 && hu < 58 ? 1 : 0;
      if (rand() < 0.06) pass = 1 - pass;
      X.push([t, hu]); y.push(pass);
    }
    return { X, y };
  }
  const PF_X = [150, 250], PF_Y = [20, 80];
  const pfQuestion = (f, t) => ({ q: (f ? 'Humidity' : 'Temperature') + ' ≤ ' + fmt(t) + '?', leftIsYes: true });
  const pfLeaf = node => { const k = node.value[1] >= 0.5 ? 1 : 0; return [(k ? 'Pass ' : 'Fail ') + pct(node.value[k]), node.n + ' rows']; };
  const pfLeafClass = node => (node.value[1] >= 0.5 ? 'good' : 'bad');
  function treeRegions(node, b, out) {
    if (node.leaf) { out.push({ b, p: node.value[1] }); return out; }
    const [x0, x1, y0, y1] = b;
    if (node.f === 0) { treeRegions(node.left, [x0, Math.min(x1, node.t), y0, y1], out); treeRegions(node.right, [Math.max(x0, node.t), x1, y0, y1], out); }
    else { treeRegions(node.left, [x0, x1, y0, Math.min(y1, node.t)], out); treeRegions(node.right, [x0, x1, Math.max(y0, node.t), y1], out); }
    return out;
  }
  function pathTo(tree, r) { const s = new Set(); let n = tree; s.add(n); while (!n.leaf) { n = r[n.f] <= n.t ? n.left : n.right; s.add(n); } return { set: s, leaf: n }; }
  function pfPoints(f, d) { return d.X.map((p, i) => dot(f.sx(p[0]), f.sy(p[1]), d.y[i] ? 'c1' : 'c2', 4, (d.y[i] ? 'Pass' : 'Fail') + '\nTemperature ' + fmt(p[0]) + ', humidity ' + fmt(p[1]), d.y[i] ? 'circle' : 'square')).join(''); }

  // ---------- Lessons ----------
  const LESSONS = [];
  const add = l => LESSONS.push(l);

  /* ---------- Statistics foundations ----------
     These come first because every later lesson leans on them, and because the mistakes
     they prevent are the expensive ones: a count on a measurement chart, an average quoted
     from a skewed distribution, a p-value read as an effect size. Each demo computes its
     numbers with the same functions the tool uses on real data, so nothing here is a
     simplification that stops being true at the bench. */

  // A Poisson draw, for the lessons about counts. Knuth's method: multiply uniforms until
  // the product falls below exp(-lambda). Fine at the small means these demos use.
  function poisson(lambda, rand) {
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= rand(); } while (p > L);
    return k - 1;
  }
  // First signal at or after a given point, or -1. Used by the drift-chart race.
  const sigOf = (res, at) => { const s = res.signals.find(x => x.i >= (at === undefined ? 40 : at)); return s ? s.i : -1; };
  const skew = v => { const m = E.mean(v), s = E.sd(v); return s > 0 ? E.mean(v.map(x => Math.pow((x - m) / s, 3))) : 0; };

  add({
    id: 'data-types', group: 'Statistics foundations', title: 'Attribute or variable: the first question',
    analogy: 'A thermometer and a tally counter. One tells you how hot it is, the other how many times something happened. Averaging a tally the way you average a temperature is how a chart ends up confidently wrong.',
    intro: 'Variable data is measured on a scale: purity, pH, titre, fill weight. You measure its spread from the data itself. Attribute data is a count or a call: three particles, pass, fail, protein-like. Its spread is not yours to measure, because the mean fixes it - a count averaging 4 has a standard deviation of 2 whether you like it or not. Almost every method in this tool branches on which kind you brought, and getting it wrong does not make the answer approximately right.',
    demo(el) {
      el.innerHTML = '<div class="demo-grid"><div><h4>On a count chart (correct)</h4><div data-role="c"></div></div>' +
        '<div><h4>On a measurement chart (wrong)</h4><div data-role="i"></div></div></div>' +
        '<p class="demo-read" data-role="read"></p>';
      const rand = E.rng(17);
      const counts = range(24).map(() => poisson(4, rand));
      counts[11] = 12;                                        // one genuine excursion
      const cc = S.countChart(counts);
      const im = S.imr(counts);
      C.controlChart(q(el, 'c'), counts, { ucl: cc.upper[0], cl: cc.centre, lcl: cc.lower[0], flags: counts.map((v, i) => (cc.signals.some(s => s.i === i) ? ['beyond the count limit'] : [])), yLabel: 'Defects per batch', height: 220 });
      C.controlChart(q(el, 'i'), counts, { ucl: im.ucl, cl: im.cl, lcl: im.lcl, flags: im.flags, yLabel: 'Defects per batch', height: 220 });
      const cFlags = cc.signals.length, iFlags = im.signals.length;
      q(el, 'read').innerHTML = 'Same 24 numbers, two sets of limits. The count chart sets its upper limit at <b>' + fmt(cc.upper[0]) +
        '</b> from the mean alone, because for a count the mean <i>is</i> the spread. The measurement chart measures a spread from the moving range and lands on <b>' + fmt(im.ucl) +
        '</b>, with a lower limit of <b>' + fmt(im.lcl) + '</b> - a negative number of defects, which cannot happen. ' +
        'Here they happen to flag ' + cFlags + ' and ' + iFlags + ' points; the problem is not the count but that the second chart’s limits were never the right shape, so whether it agrees is luck.';
    },
    steps: ['Ask what one row is: a measurement on a scale, or a count or a call?', 'Variable data: you estimate the centre and the spread separately from the data.', 'Attribute data: the mean determines the spread, so the limits come from a count distribution, not from a standard deviation.', 'Attribute data has its own methods throughout: count charts instead of I-MR, kappa instead of Gage R&R, proportions instead of means.'],
    when: 'Before you choose any method. It is the first branch in the decision, not a detail.',
    watch: 'A count dressed as a measurement is the commonest version of this mistake: particles per vial, deviations per month, failures per batch. All counts.',
    where: 'The capability tool switches to c, u and p charts when you tell it the column is a count; the variance tool switches to attribute agreement when the calls are categories.',
    quiz: { q: 'You chart "particles per vial" on an individuals chart and the lower control limit comes out at −1.8. What has gone wrong?', options: ['Nothing; a negative limit just never triggers', 'A count cannot be negative, so the limits were built from the wrong distribution and the upper one is wrong too', 'The data needs more points'], answer: 1, why: 'The impossible lower limit is the visible symptom of a deeper problem: the chart assumed a symmetric spread you measure, when a count’s spread is fixed by its mean. The upper limit is wrong by the same mistake, it just does not look absurd.' }
  });

  add({
    id: 'centre-spread', group: 'Statistics foundations', title: 'Average, median and spread',
    analogy: 'Two people describe the same commute. One says "it averages 40 minutes", the other says "half the time it is under 30". Both are true, and the gap between them is the whole story.',
    intro: 'Four numbers describe most datasets. The mean and the median say where the middle is; the standard deviation and the interquartile range say how wide it is. They disagree in a specific and useful way: the mean and the standard deviation are pulled by extreme values, the median and the IQR are not. When they disagree, that is information, not a problem to be averaged away.',
    demo(el) {
      el.innerHTML = '<div data-role="plot"></div><div class="demo-controls">' + slider('out', 'Move one result to', 100, 180, 1, 102) + '</div><p class="demo-read" data-role="read"></p>';
      const rand = E.rng(11);
      const base = range(14).map(() => 100 + normal(rand) * 2);
      const f = frame(640, 150, [95, 185], [0, 1], { noAxes: false, b: 34, yFmt: () => '' });
      const draw = () => {
        const v = Number(q(el, 'out').value);
        setOut(el, 'out', v);
        const data = base.concat([v]);
        const m = E.mean(data), md = E.median(data), sd = E.sd(data);
        const iqr = E.quantile(data, 0.75) - E.quantile(data, 0.25);
        const mark = (x, lab, cls) => '<line class="' + cls + '" x1="' + f.sx(x) + '" x2="' + f.sx(x) + '" y1="26" y2="104"/><text class="lbl-strong" x="' + f.sx(x) + '" y="20" text-anchor="middle">' + h(lab) + '</text>';
        q(el, 'plot').innerHTML = svg(640, 150, 'Fifteen results with the mean and the median marked',
          f.axes + data.map((d, i) => dot(f.sx(d), 72 + (i % 3 - 1) * 9, i === data.length - 1 ? 'c2' : 'c1', 5)).join('') +
          mark(m, 'Mean ' + fmt(m), 'ref') + mark(md, 'Median ' + fmt(md), 'median'));
        q(el, 'read').innerHTML = 'Mean <b>' + fmt(m) + '</b>, median <b>' + fmt(md) + '</b>, standard deviation <b>' + fmt(sd) +
          '</b>, interquartile range <b>' + fmt(iqr) + '</b>. Drag the orange result out to 180 and the mean follows it while the median barely moves: ' +
          'one value in fifteen shifts the mean by ' + fmt(m - E.mean(base.concat([102]))) + ' and the median by ' + fmt(md - E.median(base.concat([102]))) + '. ' +
          'The standard deviation reacts even harder, because it squares the distance first.';
      };
      q(el, 'out').oninput = draw;
      draw();
    },
    steps: ['Mean: add them up and divide. Every value gets a vote weighted by how far out it is.', 'Median: line them up and take the middle one. Each value gets one vote regardless of size.', 'Standard deviation: the typical distance from the mean, computed by squaring, averaging and taking the root - so a far-out value counts for a great deal.', 'Interquartile range: the width of the middle half. Insensitive to both tails by construction.'],
    when: 'Always report both pairs on data you have not seen before. If they agree, the distribution is roughly symmetric; if they do not, you have learned something before fitting anything.',
    watch: 'A mean quoted alone on skewed data is the classic trap: most impurity results sit below their own average, so "the average is within spec" can be true while a quarter of batches fail.',
    where: 'The data profile prints both for every numeric column, and the capability panel reports the median beside the mean precisely so the gap is visible.',
    quiz: { q: 'An impurity has a mean of 0.8% and a median of 0.5%. What does that tell you?', options: ['The data has an error in it', 'The distribution has a long right tail: a few high results are pulling the mean up', 'The two are close enough to treat as equal'], answer: 1, why: 'Mean well above median is the signature of right skew, which is what impurities, aggregates and particle counts normally look like. It also warns you that any figure computed from a normal tail - PPM, sigma level - is about to be wrong.' }
  });

  add({
    id: 'distributions', group: 'Statistics foundations', title: 'Shape: the bell curve and the many things that are not one',
    analogy: 'Four crowds, all averaging 1.75 m tall: a school staff room, a basketball squad mixed with jockeys, a queue where one person is on stilts, and a crowd where nobody can be shorter than zero. The average describes none of them.',
    intro: 'A great deal of statistics assumes the bell curve, and biologics data routinely is not one. Impurities and particle counts are bounded at zero with a long right tail. Counts of rare events are Poisson. A bimodal result usually means two populations got mixed. The tool tests the shape rather than assuming it, and this lesson is what that test is looking at.',
    demo(el) {
      const SHAPES = [['normal', 'Bell-shaped'], ['skew', 'Right-skewed impurity'], ['bimodal', 'Two populations mixed'], ['counts', 'Counts of something rare']];
      el.innerHTML = '<div class="demo-controls">' + SHAPES.map(s => btn(s[0], s[1], 'ghost')).join('') + '</div>' +
        '<div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const make = kind => {
        const rand = E.rng(23);
        if (kind === 'skew') return range(160).map(() => 0.2 + Math.exp(normal(rand) * 0.55) * 0.3);
        if (kind === 'bimodal') return range(160).map((_, i) => (i % 2 ? 0.7 : 1.9) + normal(rand) * 0.18);
        if (kind === 'counts') return range(160).map(() => poisson(1.4, rand));
        return range(160).map(() => 1.3 + normal(rand) * 0.3);
      };
      const show = kind => {
        const v = make(kind), ad = TL.andersonDarling(v);
        C.histogram(q(el, 'plot'), v, { mean: E.mean(v), sd: E.sd(v), xLabel: 'Result', label: 'Distribution of 160 results' });
        q(el, 'read').innerHTML = 'Mean <b>' + fmt(E.mean(v)) + '</b>, median <b>' + fmt(E.median(v)) + '</b>, skewness <b>' + fmt(skew(v)) +
          '</b>. The line drawn over the bars is the bell curve those two numbers imply. Anderson-Darling: p = <b>' + fmt(ad.p) + '</b>, so normality ' +
          (ad.normal ? '<b>is not rejected</b> - the bell curve is a usable description here.' : '<b>is rejected</b>. Look at where the line sits against the bars: that gap is what every normal tail probability would be computed from.') +
          (kind === 'bimodal' ? ' No transform fixes two humps - the honest move is to find out what separates the two populations and split them.' : '') +
          (kind === 'counts' ? ' And these are counts, not measurements: the bell curve was never the right model, however the test comes out.' : '');
      };
      SHAPES.forEach(s => { q(el, s[0]).onclick = () => show(s[0]); });
      show('normal');
    },
    steps: ['Draw the histogram first. Most shape problems are visible before any test is run.', 'Compare the mean with the median: apart means skewed.', 'Run Anderson-Darling, which weights the tails - where the specification lives - more heavily than the middle.', 'Below about eight results the test has no power worth quoting, so the tool reports "untested" rather than "passed".'],
    when: 'Before anything that depends on a tail: PPM, sigma level, a tolerance interval, a capability claim.',
    watch: 'A passed normality test on 20 results is weak evidence, not a clean bill of health. And a failed test does not invalidate everything - Cp and Cpk are ratios and survive it.',
    where: 'The capability panel runs Anderson-Darling automatically and withholds the tail figures when it fails, with the reason printed rather than a footnote.',
    quiz: { q: 'A normality test on 150 particle counts returns p = 0.001. Which figures should you still be happy to quote?', options: ['None of them', 'Cp, Cpk and the observed count outside specification', 'PPM and sigma level, since the sample is large'], answer: 1, why: 'Cp and Cpk are ratios of distances to spread and need no distribution. So does counting how many results actually fell outside the limits. PPM and sigma level are normal tail probabilities, and a large sample makes a wrong distribution more precisely wrong, not less.' }
  });

  add({
    id: 'sampling', group: 'Statistics foundations', title: 'Sampling variation: why two samples never agree',
    analogy: 'Two auditors each pull ten batches from the same year and come back with different averages. Neither made a mistake. That difference has a size you can predict, and predicting it is most of statistics.',
    intro: 'Measure ten batches and you get an average. Measure ten more from the same unchanged process and you get a different one. The spread of those averages has a formula: the standard deviation divided by the square root of how many you took. That single fact is behind every confidence interval, every p-value and every sample size calculation in this tool.',
    demo(el) {
      el.innerHTML = '<div data-role="plot"></div><div class="demo-controls">' + slider('n', 'Batches per sample', 2, 50, 1, 5) +
        btn('draw', 'Draw 30 samples', 'primary') + btn('reset', 'Clear', 'ghost') + '</div><p class="demo-read" data-role="read"></p>';
      const TRUE = 100, SIGMA = 4;
      const rand = E.rng(31);
      let means = [];
      const f = frame(640, 190, [94, 106], [0, 1], { b: 34, yFmt: () => '' });
      const draw = () => {
        const n = Number(q(el, 'n').value);
        setOut(el, 'n', n);
        const se = SIGMA / Math.sqrt(n);
        const band = '<rect class="usual" x="' + f.sx(TRUE - 2 * se) + '" y="24" width="' + (f.sx(TRUE + 2 * se) - f.sx(TRUE - 2 * se)) + '" height="104"/>';
        q(el, 'plot').innerHTML = svg(640, 190, 'Sample averages from an unchanged process', band + f.axes +
          '<line class="target-line" x1="' + f.sx(TRUE) + '" x2="' + f.sx(TRUE) + '" y1="24" y2="128"/>' +
          '<text class="lbl-strong" x="' + f.sx(TRUE) + '" y="18" text-anchor="middle">True average 100</text>' +
          means.map((m, i) => dot(f.sx(m), 128 - (i % 11) * 9, Math.abs(m - TRUE) > 2 * se ? 'c2' : 'c1', 4.5)).join(''));
        const obs = means.length > 2 ? E.sd(means) : null;
        q(el, 'read').innerHTML = 'The process never changes: every result is drawn around 100 with a standard deviation of 4. The shaded band is &plusmn;2 standard errors - ' +
          '4 &divide; &radic;' + n + ' = <b>' + fmt(se) + '</b> - which is where sample averages should land about 95% of the time. ' +
          (means.length ? means.length + ' samples drawn, and the spread of their averages is <b>' + fmt(obs) + '</b> against the predicted ' + fmt(se) + '. '
            : 'Press draw. ') +
          'Raise the sample size and the band narrows as the square root: going from 5 batches to 20 halves it, and from 20 to 80 halves it again. That is why the fourth doubling of a study costs as much as the first and buys a quarter as much.';
      };
      q(el, 'draw').onclick = () => { const n = Number(q(el, 'n').value); for (let k = 0; k < 30; k++) means.push(E.mean(range(n).map(() => TRUE + normal(rand) * SIGMA))); draw(); };
      q(el, 'reset').onclick = () => { means = []; draw(); };
      q(el, 'n').oninput = () => { means = []; draw(); };
      draw();
    },
    steps: ['A statistic computed from a sample is itself a random quantity with its own spread.', 'For an average, that spread is the standard error: sigma divided by the square root of n.', 'Four times the data halves the uncertainty, which is the single most useful piece of arithmetic in study planning.', 'Everything downstream - intervals, p-values, control limits - is built on this one quantity.'],
    when: 'Whenever you are tempted to say two numbers differ. Ask first how far apart they would be if nothing had changed.',
    watch: 'The formula assumes the results are independent. Three vials from the same batch are not three batches, and treating them as such understates the uncertainty - badly.',
    where: 'The power and sample size tool is this lesson made operational; the standard errors behind every interval the agent prints come from it.',
    quiz: { q: 'Your study of 10 batches gives a confidence interval 3 units wide, and you need 1.5. How many batches?', options: ['20', '40', '15'], answer: 1, why: 'Width shrinks with the square root of n, so halving it needs four times the data: 40 batches. This is the arithmetic that stops a study being planned by hope.' }
  });

  add({
    id: 'confidence-intervals', group: 'Statistics foundations', title: 'Confidence intervals: the range the data can defend',
    analogy: 'A weather forecast of "18 to 24 degrees" rather than "21". The range is not weakness, it is the part you can be held to.',
    intro: 'A single number from a sample is almost certainly not the truth. A confidence interval is the range of truths the data cannot rule out. "95% confidence" is a property of the procedure, not of your one interval: run the study many times and 95% of the intervals it produces will contain the real value. This demo runs it many times so you can watch that happen - and watch the ones that miss.',
    demo(el) {
      el.innerHTML = '<div data-role="plot"></div><div class="demo-controls">' + slider('n', 'Batches per study', 3, 40, 1, 8) +
        btn('draw', 'Run 25 studies', 'primary') + btn('reset', 'Clear', 'ghost') + '</div><p class="demo-read" data-role="read"></p>';
      const TRUE = 100, SIGMA = 4;
      const rand = E.rng(41);
      let runs = [];
      const draw = () => {
        const n = Number(q(el, 'n').value); setOut(el, 'n', n);
        const rows = runs.slice(-25);
        const W = 640, H = Math.max(120, 26 + rows.length * 10);
        const lo = Math.min(92, ...rows.map(r => r.lo)), hi = Math.max(108, ...rows.map(r => r.hi));
        const sx = v => 40 + (v - lo) / (hi - lo) * (W - 60);
        let b = '<line class="target-line" x1="' + sx(TRUE) + '" x2="' + sx(TRUE) + '" y1="16" y2="' + (H - 6) + '"/>' +
          '<text class="lbl-strong" x="' + sx(TRUE) + '" y="12" text-anchor="middle">The truth: 100</text>';
        rows.forEach((r, i) => {
          const y = 22 + i * 10, cls = r.miss ? 'c2' : 'c1';
          b += '<line class="errbar' + (r.miss ? ' miss' : '') + '" x1="' + sx(r.lo) + '" x2="' + sx(r.hi) + '" y1="' + y + '" y2="' + y + '"/>' + dot(sx(r.m), y, cls, 3);
        });
        q(el, 'plot').innerHTML = svg(W, H, 'Confidence intervals from repeated studies', b);
        const miss = runs.filter(r => r.miss).length;
        q(el, 'read').innerHTML = runs.length
          ? runs.length + ' studies run, each on ' + n + ' batches from the same unchanged process. <b>' + (runs.length - miss) + '</b> intervals contain the truth and <b>' + miss +
            '</b> miss it entirely: ' + pct(miss / runs.length) + ' against the 5% the method promises. The ones that miss are not mistakes - they are the advertised failure rate, and in real life you never know which kind you have.'
          : 'Each line will be one study: its average as a dot, its 95% interval as the bar. Press the button.';
      };
      q(el, 'draw').onclick = () => {
        const n = Number(q(el, 'n').value);
        for (let k = 0; k < 25; k++) {
          const y = range(n).map(() => TRUE + normal(rand) * SIGMA);
          const m = E.mean(y), se = E.sd(y) / Math.sqrt(n), t = E.tQuantile(0.025, n - 1);
          const lo = m - t * se, hi = m + t * se;
          runs.push({ m, lo, hi, miss: TRUE < lo || TRUE > hi });
        }
        draw();
      };
      q(el, 'reset').onclick = () => { runs = []; draw(); };
      q(el, 'n').oninput = () => { runs = []; draw(); };
      draw();
    },
    steps: ['Take the estimate, and the standard error that goes with it.', 'Multiply the standard error by a factor from the t distribution, which widens as the sample shrinks because sigma had to be estimated too.', 'The interval is estimate plus and minus that product.', 'Read it as "the values this data cannot rule out", and act on the unfavourable end when the decision is one-sided.'],
    when: 'Report one beside every estimate that will be used for a decision. A point estimate alone hides exactly the information a reviewer needs.',
    watch: '95% confidence is a property of the procedure over many studies, not a probability about your particular interval. And an interval says nothing about whether the measurement was biased - only about how much the sampling moved it.',
    where: 'Shelf life uses the one-sided limit rather than the fitted line; the equivalence verdict is read off an interval; the model leaderboard puts a bootstrap interval on every score.',
    quiz: { q: 'A 95% interval for a difference runs from −0.4 to +2.8. What is the honest reading?', options: ['There is no difference, because the interval includes zero', 'The data cannot rule out "no difference", but it also cannot rule out a difference as large as 2.8', 'The difference is 1.2'], answer: 1, why: 'An interval containing zero is not evidence of no effect; it is a statement that the study was not sharp enough to exclude it. Reporting that as "no difference" throws away the other half of what the interval says - which is that a substantial effect is equally consistent with the data.' }
  });

  add({
    id: 'hypothesis-tests', group: 'Statistics foundations', title: 'p-values: what they do and do not say',
    analogy: 'A metal detector. It beeps to say "something is there", not "something valuable is there". Turn the sensitivity up far enough and it beeps at a bottle top.',
    intro: 'A p-value answers one narrow question: if nothing were really different, how often would I see a gap at least this big by chance alone? Small p means the gap is hard to explain as noise. It does not mean the gap is large, or important, or worth acting on - and the two sliders below pull those apart.',
    demo(el) {
      el.innerHTML = '<div data-role="plot"></div><div class="demo-controls">' + slider('d', 'Real difference between the labs', 0, 3, 0.1, 0.3) +
        slider('n', 'Results per lab', 4, 200, 2, 10) + '</div><p class="demo-read" data-role="read"></p>';
      const SIGMA = 2;
      const draw = () => {
        const d = Number(q(el, 'd').value), n = Number(q(el, 'n').value);
        setOut(el, 'd', d.toFixed(1)); setOut(el, 'n', n);
        const rand = E.rng(7);
        const a = range(n).map(() => 100 + normal(rand) * SIGMA);
        const b = range(n).map(() => 100 + d + normal(rand) * SIGMA);
        const se = Math.sqrt(E.variance(a) / n + E.variance(b) / n);
        const t = (E.mean(b) - E.mean(a)) / se;
        const p = E.tTestP(t, 2 * n - 2);
        const f = frame(640, 200, [94, 108], [0, 1], { b: 34, yFmt: () => '' });
        q(el, 'plot').innerHTML = svg(640, 200, 'Two labs, the same method', f.axes +
          a.map(v => dot(f.sx(v), 60, 'c1', 4)).join('') + b.map(v => dot(f.sx(v), 110, 'c3', 4)).join('') +
          '<text x="12" y="64">Lab A</text><text x="12" y="114">Lab B</text>' +
          '<line class="ref" x1="' + f.sx(E.mean(a)) + '" x2="' + f.sx(E.mean(a)) + '" y1="44" y2="76"/>' +
          '<line class="ref" x1="' + f.sx(E.mean(b)) + '" x2="' + f.sx(E.mean(b)) + '" y1="94" y2="126"/>');
        const obs = E.mean(b) - E.mean(a);
        q(el, 'read').innerHTML = 'Observed gap <b>' + fmt(obs) + '</b> units, p = <b>' + (p < 0.001 ? '&lt;0.001' : fmt(p)) + '</b>. ' +
          (p < 0.05 ? 'Significant. ' : 'Not significant. ') +
          'Now hold the real difference at 0.3 - a third of a unit, almost certainly irrelevant to a release decision - and push the sample size to 200: the p-value crosses 0.05 while the difference stays trivial. ' +
          'Then set a real difference of 2 units with 4 results each: a difference that would fail a transfer, and p says nothing. The p-value is a statement about evidence, and sample size is half of it. The size of the effect is a separate question that only the interval answers.';
      };
      q(el, 'd').oninput = draw; q(el, 'n').oninput = draw;
      draw();
    },
    steps: ['State what "nothing is happening" would mean - the null hypothesis.', 'Compute how extreme the observed result is against that assumption, in standard errors.', 'The p-value is the chance of a result at least that extreme if the null were true.', 'Read it with the effect size and the interval beside it, never alone.'],
    when: 'When you need to know whether a difference is distinguishable from noise - which is a smaller question than whether it matters.',
    watch: 'Two opposite misreadings. A large p is not proof of no effect, usually just a small study. A small p is not proof of a large effect, often just a large one. And a test for a difference can never demonstrate sameness: that needs an equivalence test against a margin.',
    where: 'DOE effect p-values, poolability tests, ANOVA F tests, Gage R&R interaction tests - and the TOST tool, which exists because this test is the wrong one for a sameness claim.',
    quiz: { q: 'A supplier comparison on 400 lots per supplier gives p = 0.004 for a difference of 0.05% in yield. What should you do?', options: ['Change supplier: the difference is highly significant', 'Treat the difference as real but almost certainly too small to act on', 'Repeat the study with more lots'], answer: 1, why: 'With 800 lots the study can detect differences far smaller than anything that matters operationally. The p-value is doing its job correctly; the mistake would be to read statistical significance as practical importance. Look at the interval and ask whether its whole range is small enough to ignore.' }
  });

  add({
    id: 'correlation', group: 'Statistics foundations', title: 'Correlation: one number that hides as much as it shows',
    analogy: 'A one-line summary of four different films, all of which happen to read "a journey, mostly uphill". Accurate, useless, and you would not green-light any of them on it.',
    intro: 'The correlation coefficient measures how well a straight line through the data describes it. Four datasets below have almost the same correlation and nothing else in common: one is genuinely linear, one is a curve, one is driven by a single point, one is two separate populations. The number cannot tell them apart. Looking at the plot takes two seconds and can.',
    demo(el) {
      el.innerHTML = '<div class="demo-grid" data-role="grid"></div><div class="demo-controls">' + btn('line', 'Fit a straight line to each', 'primary') + '</div><p class="demo-read" data-role="read"></p>';
      const rand = E.rng(5);
      const sets = [
        ['Genuinely linear', range(28).map(() => { const x = 2 + rand() * 8; return [x, 10 + 1.6 * x + normal(rand) * 1.8]; })],
        ['A curve', range(28).map((_, i) => { const x = 2 + i * 0.3; return [x, 10 + 5.2 * Math.sqrt(x) - 0.02 * x * x + normal(rand) * 0.7]; })],
        ['One point doing the work', range(27).map(() => { const x = 2 + rand() * 2; return [x, 14 + normal(rand) * 1.4]; }).concat([[11, 34]])],
        ['Two populations', range(28).map((_, i) => (i % 2 ? [3 + rand() * 1.5, 13 + normal(rand) * 1.2] : [9 + rand() * 1.5, 26 + normal(rand) * 1.2]))]
      ];
      let withLine = false;
      const draw = () => {
        q(el, 'grid').innerHTML = sets.map(([name, pts], k) => {
          const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
          const r = E.pearson(xs, ys);
          const f = frame(300, 210, [1, 12], [8, 36], { l: 34, b: 28 });
          let body = f.axes + pts.map(p => dot(f.sx(p[0]), f.sy(p[1]), 'c1', 4)).join('');
          if (withLine) {
            const mx = E.mean(xs), my = E.mean(ys);
            const b1 = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((a, p) => a + (p[0] - mx) * (p[0] - mx), 0);
            body += '<path class="line" d="' + pathOf([[1, my + b1 * (1 - mx)], [12, my + b1 * (12 - mx)]], f) + '"/>';
          }
          return '<div><h4>' + h(name) + ' &mdash; r = ' + r.toFixed(2) + '</h4>' + svg(300, 210, name, body) + '</div>';
        }).join('');
        q(el, 'read').innerHTML = 'Four correlations within a few hundredths of each other. ' + (withLine
          ? 'And four straight lines, only one of which deserves to be there. On the curve the line misses the shape entirely and would extrapolate badly; on the third panel the line exists because of one point, and deleting it leaves a correlation near zero; on the fourth there is no relationship inside either group - the line is an artefact of two clusters sitting diagonally apart.'
          : 'Press the button to fit a line to each, then ask which of the four lines you would use to predict anything.');
      };
      q(el, 'line').onclick = () => { withLine = !withLine; draw(); };
      draw();
    },
    steps: ['Correlation runs from −1 to +1 and measures straight-line agreement only.', 'It is symmetric and unitless, so it says nothing about which way the causation runs or how big the effect is in real units.', 'A curve, a single leverage point or two clusters all produce respectable-looking correlations.', 'Plot it. Then, if you need a number with units, fit a slope and look at its interval.'],
    when: 'As a first screen across many columns, to decide what to look at. Never as the evidence itself.',
    watch: 'Correlation is not causation - and on historical data it is usually not even correlation with the thing you think, because the inputs move together. That is what DOE and multicollinearity checks are for.',
    where: 'The driver ranking is built from models rather than raw correlations for exactly this reason, and every important driver gets a response curve so the shape is visible.',
    quiz: { q: 'Two process inputs correlate at r = 0.85 with yield. One is a genuine driver, one moves with it because both follow the seasons. What tells them apart?', options: ['The higher correlation', 'A designed experiment that moves each one on purpose', 'A larger historical dataset'], answer: 1, why: 'No amount of history separates a driver from a companion that moves with it: both will correlate. Changing one on purpose while holding the other still is the only thing that does, which is why the tool pairs the model with a run sheet.' }
  });

  add({
    id: 'start', group: 'Start here', title: 'What machine learning is (and is not)',
    analogy: 'An apprentice who studies thousands of past jobs until they can guess the outcome of the next one, but who never understands the physics.',
    intro: 'Machine learning finds patterns in past data and uses them to predict or group new data. It is fast and tireless, but it only knows what is in the data. It cannot tell cause from coincidence on its own. That is why ML Agent pairs it with Design of Experiments.',
    demo(el) {
      el.innerHTML = '<div class="demo-grid">' + ['Supervised: learning with an answer key', 'Unsupervised: finding groups with no answer key'].map((t, i) => '<div><h4>' + t + '</h4><div data-role="p' + i + '"></div></div>').join('') + '</div>' +
        '<div class="demo-controls">' + btn('go', 'Let the algorithm find groups', 'primary') + '</div><p class="demo-read" data-role="read">Left: every point already has a label (blue Pass, orange Fail), so a model can learn to predict it. Right: no labels at all. Press the button to let k-means look for natural groups.</p>';
      const rand = E.rng(4), pts = [];
      [[2, 2], [7, 3], [4.5, 7.5]].forEach((c, g) => { for (let i = 0; i < 25; i++) pts.push({ x: c[0] + normal(rand) * 0.8, y: c[1] + normal(rand) * 0.8, g }); });
      const f = frame(320, 240, [-1, 10], [-1, 10.5], { noAxes: true, l: 10, b: 10 });
      const lab = pts.map(p => p.x > 4.5 ? 1 : 0);
      q(el, 'p0').innerHTML = svg(320, 240, 'Labelled points', pts.map((p, i) => dot(f.sx(p.x), f.sy(p.y), lab[i] ? 'c1' : 'c2', 5, null, lab[i] ? 'circle' : 'square')).join('')) + passLegend;
      const draw = labels => { q(el, 'p1').innerHTML = svg(320, 240, 'Unlabelled points', pts.map((p, i) => labels ? dot(f.sx(p.x), f.sy(p.y), 'c' + (labels[i] + 1), 5, null, C.SHAPES[labels[i]]) : dot(f.sx(p.x), f.sy(p.y), 'hollow', 5)).join('')); };
      draw(null);
      q(el, 'go').onclick = () => {
        const km = E.kmeans(pts.map(p => [p.x, p.y]), 3, E.rng(1), 5);
        draw(km.labels);
        q(el, 'read').innerHTML = 'k-means found <b>3 groups</b> without being told anything. It cannot name them: that is your job. Supervised learning answers "what will happen?"; unsupervised learning answers "what kinds of things do we have?"';
      };
    },
    steps: ['Supervised learning: you give examples with the answer (yield, pass/fail). The model learns the link from inputs to answer.', 'Regression predicts a number; classification predicts a category.', 'Unsupervised learning: no answer column. The model looks for groups, main directions and oddballs.', 'Every model is tested on rows it did not learn from, so you know how far to trust it.'],
    when: 'Use ML on historical data to find likely drivers quickly and cheaply.',
    watch: 'Patterns in history can be coincidence or a hidden cause. Prove the important ones with a DOE.',
    where: 'Step 2 of the agent: pick a target for supervised learning, or "Nothing" for unsupervised.',
    quiz: { q: 'You have 2 years of batch records with a Pass/Fail result and want to know what drives failures. What kind of problem is this?', options: ['Unsupervised clustering', 'Supervised classification', 'Regression'], answer: 1, why: 'There is an answer column (Pass/Fail) and it is a category, so it is supervised classification.' }
  });

  add({
    id: 'cross-validation', group: 'Start here', title: 'Cross-validation: the surprise exam',
    analogy: 'Grading a student on questions they have never seen, not on the homework they could have memorized.',
    intro: 'A model can look brilliant on the rows it learned from and fail on new ones. Cross-validation hides part of the data, trains on the rest, and scores the model on the hidden part. Then it rotates until every row has been hidden once.',
    demo(el) {
      el.innerHTML = '<div data-role="plot"></div><div class="demo-controls">' + btn('next', 'Next round', 'primary') + btn('all', 'Run all five', 'ghost') + btn('reset', 'Start over', 'ghost') + '</div><p class="demo-read" data-role="read"></p>';
      const rand = E.rng(9), n = 20, xs = range(n).map(() => rand() * 10), ys = xs.map(x => 3 + 2 * x + normal(rand) * 3);
      const folds = E.makeFolds(n, 5, E.rng(2));
      /* The score to beat: fit on all twenty rows and grade on those same twenty. This is
         the number cross-validation exists to replace, so the lesson has to show it. */
      const trainR2 = E.regressionMetrics(ys, E.fitRidgeCore(xs.map(v => [v]), ys, 1e-8).predict(xs.map(v => [v]))).r2;
      let round = -1; const scores = []; const oof = new Array(n);
      const draw = () => {
        const W = 640, cell = 26, H = 5 * 34 + 30;
        let b = '';
        range(n).forEach(i => { b += '<text x="' + (110 + i * cell + cell / 2) + '" y="14" text-anchor="middle">' + (i + 1) + '</text>'; });
        for (let r = 0; r < 5; r++) {
          const y = 24 + r * 34;
          b += '<text x="100" y="' + (y + 18) + '" text-anchor="end" class="' + (r === round ? 'lbl-strong' : '') + '">Round ' + (r + 1) + (scores[r] !== undefined ? '  R² ' + scores[r].toFixed(2) : '') + '</text>';
          if (r <= round) range(n).forEach(i => { b += '<rect class="' + (folds[i] === r ? 'cell-test' : 'cell-train') + '" x="' + (110 + i * cell + 2) + '" y="' + y + '" width="' + (cell - 4) + '" height="26" rx="3"/>'; });
        }
        q(el, 'plot').innerHTML = svg(W, H, 'Cross-validation rounds', b) + C.legend([{ label: 'Rows the model learns from', cls: 'cell-train', shape: 'square' }, { label: 'Hidden rows it is tested on', cls: 'cell-test', shape: 'square' }]);
        if (round < 0) {
          q(el, 'read').innerHTML = 'Twenty rows. Fitted on all twenty and graded on those same twenty, this model scores <b>R² ' + trainR2.toFixed(3) +
            '</b> - but it has already seen every answer, so that number is a measure of memory, not of prediction. Press <b>Next round</b> to hide 4 rows, train on the other 16, and test on the hidden 4.';
          return;
        }
        if (round < 4) {
          q(el, 'read').innerHTML = 'Round ' + (round + 1) + ': the model learned from the grey rows and scored <b>R² ' + scores[round].toFixed(2) +
            '</b> on the yellow rows it never saw. Watch how much the five rounds differ - each is only 4 rows, so one of them is a thin result on its own.';
          return;
        }
        /* The agent pools every out-of-fold prediction and scores the lot once, rather than
           averaging the five fold scores. The two are not the same number, and pooling is
           the better one: a fold's R-squared is measured against that fold's own mean, so on
           4 rows it swings wildly and can go negative while the model is perfectly good. */
        const pooled = E.regressionMetrics(ys, oof).r2;
        const avg = E.mean(scores);
        q(el, 'read').innerHTML = 'Every row has now been predicted exactly once by a model that had not seen it. Scoring all twenty of those predictions together gives <b>R² ' +
          pooled.toFixed(3) + '</b>, and <b>that</b> is the number the agent puts on its leaderboard. ' +
          'Averaging the five round scores instead gives ' + avg.toFixed(3) + ' - close here, but not the same thing: each round’s R² is measured against the average of its own 4 rows, so on small folds it swings about and can even go negative while the model is fine. Pooling avoids that. ' +
          'Against the training score of ' + trainR2.toFixed(3) + ' the honest figure is ' + (trainR2 - pooled > 0 ? 'lower by ' + (trainR2 - pooled).toFixed(3) : 'no lower') +
          '. The gap is small because a straight line through one input has almost nothing to memorise with; give a flexible model the same data and the gap becomes the whole story, which is the next lesson.';
      };
      const step = () => {
        if (round >= 4) return;
        round++;
        const tr = range(n).filter(i => folds[i] !== round), te = range(n).filter(i => folds[i] === round);
        const m = E.fitRidgeCore(tr.map(i => [xs[i]]), tr.map(i => ys[i]), 1e-8);
        const pr = m.predict(te.map(i => [xs[i]]));
        te.forEach((i, k) => { oof[i] = pr[k]; });
        scores[round] = E.regressionMetrics(te.map(i => ys[i]), pr).r2;
        draw();
      };
      q(el, 'next').onclick = step;
      q(el, 'all').onclick = () => { while (round < 4) step(); };
      q(el, 'reset').onclick = () => { round = -1; scores.length = 0; oof.fill(undefined); draw(); };
      draw();
    },
    steps: ['Split the rows into 5 groups (folds).', 'Train on 4 folds, predict the 5th.', 'Rotate so every row is predicted exactly once by a model that never saw it.', 'Score all of those out-of-fold predictions together, rather than averaging the five fold scores: a fold\u2019s R\u00b2 is measured against its own small mean and swings about. With very small data the agent uses leave-one-out, where every row is its own fold.'],
    when: 'Always. It is the honest way to compare models.',
    watch: 'If the data has a time order and the future differs from the past, even cross-validation can be optimistic. And anything fitted from the data - a scaling, a category encoding, a choice of which columns to keep - has to be refitted inside each fold, or the held-out rows have already influenced the model that is about to be graded on them.',
    where: 'The model leaderboard shows cross-validated scores only.',
    quiz: { q: 'A model scores R² 0.98 on its training rows but 0.40 in cross-validation. Which number should you trust?', options: ['0.98, it is higher', '0.40, it was earned on unseen rows', 'Average them: 0.69'], answer: 1, why: 'Only the cross-validated score reflects how the model does on new data. The gap means it memorized noise.' }
  });

  add({
    id: 'overfitting', group: 'Start here', title: 'Overfitting: memorizing instead of learning',
    analogy: 'A student who memorizes last year\'s answer sheet aces the practice test and fails the real one.',
    intro: 'A model that is too simple misses the pattern (underfitting). A model that is too flexible chases every wobble of noise (overfitting). The sweet spot is in between, and cross-validation is how we find it.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('deg', 'Model flexibility', 1, 12, 1, 3) + '</div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const rand = E.rng(17);
      const truth = x => Math.sin(2.6 * x) * 3 + x;
      const train = range(14).map(() => { const x = rand() * 3; return [x, truth(x) + normal(rand) * 0.9]; });
      const test = range(14).map(() => { const x = rand() * 3; return [x, truth(x) + normal(rand) * 0.9]; });
      const feats = (x, d) => range(d).map(k => Math.pow(x / 1.5 - 1, k + 1));
      const draw = () => {
        const d = Number(q(el, 'deg').value); setOut(el, 'deg', d);
        const m = E.fitRidgeCore(train.map(p => feats(p[0], d)), train.map(p => p[1]), 1e-9);
        const rmse = pts => Math.sqrt(E.mean(pts.map(p => (m.predict([feats(p[0], d)])[0] - p[1]) ** 2)));
        const tr = rmse(train), te = rmse(test);
        const f = frame(640, 300, [0, 3], [-4, 8], { xLabel: 'Setting', yLabel: 'Result' });
        const curve = range(150).map(i => { const x = i / 149 * 3; return [x, m.predict([feats(x, d)])[0]]; });
        q(el, 'plot').innerHTML = svg(640, 300, 'Model fit', f.clip + f.axes + '<g clip-path="url(#' + f.clipId + ')"><path class="curve" d="' + pathOf(curve, f) + '"/></g>' +
          train.map(p => dot(f.sx(p[0]), f.sy(p[1]), 'pt', 4.5, 'Training row')).join('') + test.map(p => dot(f.sx(p[0]), f.sy(p[1]), 'hollow', 4.5, 'Hidden test row')).join('')) +
          C.legend([{ label: 'Rows the model learns from', cls: 'pt' }, { label: 'Hidden rows', cls: 'hollow' }]);
        const verdict = d <= 1 ? 'Too simple: a straight line misses the curve. Both errors are high (underfitting).'
          : d <= 5 ? 'About right: the curve follows the real pattern, and the error on hidden rows is lowest.'
            : 'Too flexible: the curve bends to hit training rows, so training error falls, but error on hidden rows climbs. That is overfitting.';
        q(el, 'read').innerHTML = 'Error on training rows: <b>' + tr.toFixed(2) + '</b> · error on hidden rows: <b>' + te.toFixed(2) + '</b><br>' + verdict;
      };
      q(el, 'deg').oninput = draw; draw();
    },
    steps: ['Training error always falls as a model gets more flexible.', 'Error on unseen data falls, then rises again once the model starts fitting noise.', 'The agent picks the model with the best unseen-data score, and prefers the simpler one in a tie.', 'Ridge, lasso, tree depth limits and forests are all ways to rein in overfitting.'],
    when: 'Think about it whenever you have few rows and many columns.',
    watch: 'A big gap between training and cross-validated scores. The agent flags it in its findings.',
    where: 'Findings: "The winner scores X% better on data it learned from than on unseen data."',
    quiz: { q: 'You raise model flexibility and training error drops, but error on hidden rows rises. What is happening?', options: ['The model is learning the real pattern better', 'The model is overfitting: memorizing noise', 'The data has errors'], answer: 1, why: 'Falling training error with rising unseen error is the signature of overfitting.' }
  });

  add({
    id: 'scores', group: 'Start here', title: 'Reading the scores: R², error and the confusion matrix',
    analogy: 'R² is how much of the weather a forecaster explains. A confusion matrix is a smoke alarm\'s report card: false alarms versus missed fires.',
    intro: 'For numbers, R² says what share of the ups and downs the model explains, and RMSE is the typical miss in your own units. For categories, accuracy can fool you when one outcome is rare, so the agent uses balanced accuracy and shows the confusion matrix.',
    demo(el) {
      el.innerHTML = '<div class="demo-grid"><div><h4>R²: how tightly predictions hug reality</h4><div class="demo-controls">' + slider('noise', 'Noise', 0, 4, 0.1, 1) + '</div><div data-role="r2"></div></div>' +
        '<div><h4>Smoke alarm: 100 days, 10 real fires</h4><div class="demo-controls">' + slider('sens', 'Alarm sensitivity', 0, 100, 5, 50) + '</div><div data-role="cm"></div></div></div><p class="demo-read" data-role="read"></p>';
      const rand = E.rng(5), base = range(40).map(() => rand() * 10), eps = range(40).map(() => normal(rand));
      const fires = range(100).map(i => i < 10), signal = range(100).map(i => (i < 10 ? 62 : 35) + normal(E.rng(i + 1)) * 13);
      const draw = () => {
        const nz = Number(q(el, 'noise').value); setOut(el, 'noise', nz.toFixed(1));
        const act = base.map((x, i) => 10 + 3 * x + eps[i] * nz * 3), pred = base.map(x => 10 + 3 * x);
        const mtr = E.regressionMetrics(act, pred);
        const f = frame(320, 260, [0, 60], [0, 60], { xLabel: 'Actual', yLabel: 'Predicted' });
        q(el, 'r2').innerHTML = svg(320, 260, 'Predicted versus actual', f.axes + '<line class="diag" x1="' + f.sx(0) + '" y1="' + f.sy(0) + '" x2="' + f.sx(60) + '" y2="' + f.sy(60) + '"/>' + act.map((a, i) => dot(f.sx(a), f.sy(pred[i]), 'dot', 4)).join('') +
          '<text class="big-num" x="60" y="40">R² ' + Math.max(0, mtr.r2).toFixed(2) + '</text><text x="60" y="58">typical miss ±' + mtr.rmse.toFixed(1) + '</text>');
        const s = Number(q(el, 'sens').value); setOut(el, 'sens', s + '%');
        const thr = 100 - s;
        let tp = 0, fn = 0, fp = 0, tn = 0;
        signal.forEach((v, i) => { const alarm = v > thr; if (fires[i]) alarm ? tp++ : fn++; else alarm ? fp++ : tn++; });
        const box = (x, y, n, label, cls) => '<rect class="cm-box ' + cls + '" x="' + x + '" y="' + y + '" width="130" height="80" rx="6"/><text class="big-num" x="' + (x + 65) + '" y="' + (y + 38) + '" text-anchor="middle">' + n + '</text><text x="' + (x + 65) + '" y="' + (y + 60) + '" text-anchor="middle">' + label + '</text>';
        q(el, 'cm').innerHTML = svg(320, 230, 'Smoke alarm confusion matrix', '<text class="lbl-strong" x="200" y="14" text-anchor="middle">Alarm said</text><text x="135" y="32" text-anchor="middle">Fire!</text><text x="270" y="32" text-anchor="middle">All clear</text>' +
          '<text x="58" y="85" text-anchor="end">Real fire</text><text x="58" y="170" text-anchor="end">No fire</text>' + box(70, 40, tp, 'caught fires', 'ok') + box(205, 40, fn, 'MISSED fires', fn ? 'bad' : '') + box(70, 125, fp, 'false alarms', fp ? 'bad' : '') + box(205, 125, tn, 'quiet, correct', 'ok'));
        const acc = (tp + tn) / 100, bal = (tp / 10 + tn / 90) / 2;
        q(el, 'read').innerHTML = '<b>Left:</b> more noise scatters the dots away from the diagonal and R² falls. ' +
          '<b>Right:</b> accuracy is <b>' + pct(acc) + '</b>, balanced accuracy is <b>' + pct(bal) + '</b>. Slide sensitivity to 0: the alarm never rings, accuracy is still 90%, yet it misses every fire. Balanced accuracy drops to 50%, exposing it. That is why the agent ranks classifiers by balanced accuracy.';
      };
      q(el, 'noise').oninput = draw; q(el, 'sens').oninput = draw; draw();
    },
    steps: ['R² = 1 means perfect predictions; 0 means no better than always guessing the average. Below 0 is worse than guessing.', 'RMSE is the typical prediction error in the target\'s own units.', 'Accuracy = share of correct calls. Misleading when one class is rare.', 'Balanced accuracy averages the hit rate of each class, so rare classes count.'],
    when: 'R² and RMSE for numbers; balanced accuracy and the confusion matrix for categories.',
    watch: 'High accuracy on imbalanced data. Always look at the missed-rare-class cell.',
    where: 'The tiles at the top of the results, the leaderboard and the confusion matrix.',
    quiz: { q: '95% of your batches pass. A model that always says "Pass" has what accuracy?', options: ['50%', '95%', '0%'], answer: 1, why: 'It is right 95% of the time while catching zero failures. Its balanced accuracy is only 50%.' }
  });

  add({
    id: 'linear', group: 'Predicting numbers and categories', title: 'Linear regression: the recipe',
    analogy: 'A recipe card: every extra spoon of sugar adds the same sweetness, no matter what else is in the bowl.',
    intro: 'Linear regression draws the straight line (or flat surface, with many inputs) that sits as close as possible to all the points. It gives each input one number: how much the result changes per unit of that input.',
    demo(el) {
      el.innerHTML = '<div data-role="plot"></div><div class="demo-controls">' + btn('outlier', 'Add an odd point', 'ghost') + btn('reset', 'Reset', 'ghost') + '</div><p class="demo-read" data-role="read"></p>';
      const rand = E.rng(21); let pts;
      const reset = () => { pts = range(25).map(() => { const x = rand() * 10; return [x, 3 + 0.8 * x + normal(rand) * 0.8]; }); };
      const draw = () => {
        const m = E.fitRidgeCore(pts.map(p => [p[0]]), pts.map(p => p[1]), 1e-9);
        const f = frame(640, 300, [0, 10], [0, 14], { xLabel: 'Input (for example pressure)', yLabel: 'Result' });
        q(el, 'plot').innerHTML = svg(640, 300, 'Linear regression', f.axes + pts.map(p => '<line class="resid" x1="' + f.sx(p[0]) + '" y1="' + f.sy(p[1]) + '" x2="' + f.sx(p[0]) + '" y2="' + f.sy(m.predict([[p[0]]])[0]) + '"/>').join('') +
          '<path class="curve" d="' + pathOf([[0, m.b0], [10, m.b0 + 10 * m.w[0]]], f) + '"/>' + pts.map(p => dot(f.sx(p[0]), f.sy(p[1]), 'pt', 4.5, 'Input ' + fmt(p[0]) + ', result ' + fmt(p[1]))).join(''));
        q(el, 'read').innerHTML = 'Recipe: start at <b>' + m.b0.toFixed(2) + '</b>, then every +1 in the input adds <b>' + m.w[0].toFixed(2) + '</b>. The red dashes are the misses; the line is placed to make their squared total as small as possible. Add an odd point to see one bad row tilt the whole line.';
      };
      q(el, 'outlier').onclick = () => { pts.push([9 + rand(), 1 + rand()]); draw(); };
      q(el, 'reset').onclick = () => { reset(); draw(); };
      reset(); draw();
    },
    steps: ['Find the line that minimizes the total squared distance to the points.', 'Each input gets a slope: the change in the result per unit of that input.', 'With many inputs, each slope is "with the other inputs held still".', 'Categories become yes/no columns, each compared with the most common category.'],
    when: 'When effects are roughly straight-line and you want the easiest model to explain.',
    watch: 'Curves and sweet spots, outliers that drag the line, and inputs that move together.',
    where: 'If a linear model wins, "Peek inside the model" shows its recipe.',
    quiz: { q: 'A linear model gives Pressure a slope of +0.5 for Yield. What does that mean?', options: ['Pressure explains 50% of Yield', 'Each +1 unit of pressure adds about 0.5 to Yield, other inputs unchanged', 'Pressure must be raised by 50%'], answer: 1, why: 'A slope is the change in the result per unit of the input, holding the others still.' }
  });

  add({
    id: 'ridge-lasso', group: 'Predicting numbers and categories', title: 'Ridge and lasso: recipes with a seat belt',
    analogy: 'Ridge is a seat belt that stops the recipe from over-reacting. Lasso is an editor who crosses out the ingredients that do not matter: the vital few versus the trivial many.',
    intro: 'When there are many inputs, or inputs that move together, a plain linear model can give wild slopes. Ridge shrinks every slope a little toward zero. Lasso shrinks too, but pushes useless slopes all the way to zero.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('pen', 'Penalty strength', 0, 10, 1, 0) + '</div><div class="demo-grid"><div><h4>Ridge: every slope shrinks</h4><div data-role="ridge"></div></div><div><h4>Lasso: useless slopes drop to zero</h4><div data-role="lasso"></div></div></div><p class="demo-read" data-role="read"></p>';
      const rand = E.rng(33), n = 40;
      const names = ['Real driver A', 'Real driver B', 'Copy of A', 'Noise 1', 'Noise 2', 'Noise 3', 'Noise 4'];
      const X = range(n).map(() => { const a = normal(rand), b = normal(rand); return [a, b, a + normal(rand) * 0.15, normal(rand), normal(rand), normal(rand), normal(rand)]; });
      const y = X.map(r => 3 * r[0] - 2 * r[1] + normal(rand) * 1.2);
      const draw = () => {
        const s = Number(q(el, 'pen').value); setOut(el, 'pen', s);
        const rw = E.fitRidgeCore(X, y, s === 0 ? 1e-8 : Math.pow(2, s) * 2).w;
        const lw = E.fitLasso(X, y, s * 0.12, 400).w;
        const bars = w => w.map((v, i) => ({ label: names[i], value: v, text: v.toFixed(2), cls: Math.abs(v) < 1e-6 ? '' : 'hi' }));
        C.hbar(q(el, 'ridge'), bars(rw), { min: -4, max: 4, label: 'Ridge slopes' });
        C.hbar(q(el, 'lasso'), bars(lw), { min: -4, max: 4, label: 'Lasso slopes' });
        const zeros = lw.filter(v => Math.abs(v) < 1e-6).length;
        q(el, 'read').innerHTML = s === 0 ? 'No penalty: notice how "Real driver A" and its near-copy share the credit in odd ways, and the noise columns get small non-zero slopes.'
          : 'Ridge pulls all slopes toward zero but keeps every input. Lasso has switched off <b>' + zeros + ' of 7</b> inputs. The real drivers A and B survive longest. Too much penalty and even they shrink away.';
      };
      q(el, 'pen').oninput = draw; draw();
    },
    steps: ['Both add a penalty for large slopes to the usual "minimize the misses".', 'Ridge: penalty on squared slopes, so everything shrinks smoothly.', 'Lasso: penalty on absolute slopes, so small ones snap to exactly zero.', 'The agent tunes the penalty with an inner cross-validation.'],
    when: 'Many inputs, few rows, or inputs that move together (multicollinearity).',
    watch: 'When two inputs are near copies, lasso keeps one somewhat at random. Domain knowledge decides which is real.',
    where: 'Ridge and lasso appear on the leaderboard for every regression.',
    quiz: { q: 'Which method can tell you "these 5 columns do not matter at all"?', options: ['Ridge', 'Lasso', 'Neither'], answer: 1, why: 'Lasso drives unhelpful slopes to exactly zero, which acts as automatic factor screening.' }
  });

  add({
    id: 'pls', group: 'Predicting numbers and categories', title: 'Partial least squares: when the columns outnumber the rows',
    analogy: 'A hundred witnesses all describe the same two events. Asking each one separately and weighting their answers independently is hopeless — they contradict each other on detail. Better to work out what the two events were, then predict from those. PLS builds those few underlying stories, and unlike PCA it builds the ones that actually relate to the thing you are predicting.',
    intro: 'Ordinary regression needs more rows than columns, and it falls apart long before that if the columns move together. A spectrum has hundreds of wavelengths and twenty batches; a sensor train has forty tags all driven by the same few things. PLS compresses the inputs into a handful of components chosen for their relationship to the answer, then regresses on those. The contrast that matters is against <i>ordinary</i> regression, which simply breaks here. Ridge is a serious rival, and the demo below will often show it winning \u2014 that is not a bug in the lesson, it is the honest answer.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('p', 'Input channels', 4, 80, 2, 60) + slider('n', 'Batches measured', 12, 60, 1, 25) + slider('noise', 'Measurement noise', 0.1, 3, 0.1, 1) + '</div><div data-role="bars"></div><p class="demo-read" data-role="read"></p>';
      const draw = () => {
        const p = Number(q(el, 'p').value), n = Number(q(el, 'n').value), noise = Number(q(el, 'noise').value);
        setOut(el, 'p', p); setOut(el, 'n', n); setOut(el, 'noise', noise.toFixed(1));
        const rand = E.rng(77);
        /* Two hidden factors drive every channel, which is how spectra and sensor trains
           really behave: the channels are not independent pieces of information. */
        const load1 = range(p).map((_, j) => Math.sin(j / p * Math.PI));
        const load2 = range(p).map((_, j) => Math.cos(j / p * Math.PI * 2));
        const make = m => {
          const X = [], y = [];
          for (let i = 0; i < m; i++) {
            const a = normal(rand) * 2, b = normal(rand);
            X.push(range(p).map((_, j) => a * load1[j] + b * load2[j] + normal(rand) * 0.25));
            y.push(3 * a - 1.5 * b + normal(rand) * noise);
          }
          return { X, y };
        };
        const tr = make(n), te = make(400);
        const rmse = m => { const pr = m.predict(te.X); return Math.sqrt(te.y.reduce((s, v, i) => s + (v - pr[i]) ** 2, 0) / te.y.length); };
        const ySd = Math.sqrt(te.y.reduce((s, v) => s + (v - te.y.reduce((a, c) => a + c, 0) / te.y.length) ** 2, 0) / te.y.length);
        const lin = (() => { try { return E.fitRidgeCore(tr.X, tr.y, 1e-9); } catch (err) { return null; } })();
        const rid = E.fitRidgeCore(tr.X, tr.y, 1);
        const pls = E.fitPLS(tr.X, tr.y, Math.min(3, p, n - 2));
        const items = [
          { label: 'Always guess the mean', value: ySd },
          { label: 'Ordinary regression', value: lin ? rmse(lin) : NaN },
          { label: 'Ridge', value: rmse(rid) },
          { label: 'PLS (3 components)', value: rmse(pls) }
        ];
        const best = Math.min.apply(null, items.filter(i => isFinite(i.value)).map(i => i.value));
        const top = Math.max.apply(null, items.filter(i => isFinite(i.value)).map(i => i.value));
        C.hbar(q(el, 'bars'), items.map(i => ({
          label: i.label, value: isFinite(i.value) ? i.value : 0,
          text: isFinite(i.value) ? fmt(i.value) : 'failed',
          cls: isFinite(i.value) && i.value === best ? 'hi' : ''
        })), { min: 0, max: top * 1.1 || 1, label: 'Error on 400 batches it never saw (lower is better)' });
        const winner = items.filter(i => isFinite(i.value)).sort((a, b) => a.value - b.value)[0];
        q(el, 'read').innerHTML = '<b>' + h(winner.label) + '</b> predicts best here. ' +
          (p > n ? 'With <b>' + p + ' channels and only ' + n + ' batches</b> ordinary regression has more unknowns than equations: it fits the training data perfectly and predicts nothing. ' : '') +
          'The ' + p + ' channels carry only <b>two</b> pieces of real information, because two hidden factors drive all of them. PLS finds those two and ignores the rest.' +
          '<br>Notice how close ridge runs, and how often it wins: on pure prediction the two are rivals, and which one comes out ahead depends on the data rather than on which is more fashionable. What PLS adds is a handful of named components you can plot and interpret, where ridge gives you ' + p + ' shrunken coefficients. That is why both sit on the leaderboard and the agent keeps whichever actually predicts better.' +
          '<br>Now drag <i>Input channels</i> down to 4. With few, nearly independent inputs the compression buys nothing and plain regression is as good or better — which is why neither of these replaces the simple models.';
      };
      ['p', 'n', 'noise'].forEach(k => { q(el, k).oninput = draw; });
      draw();
    },
    steps: ['Find the combination of inputs that correlates most strongly with the answer. That is component one.', 'Strip what that component explains out of both the inputs and the answer, then repeat on what is left.', 'Stop after a few components, chosen by cross-validation rather than by eye.', 'Regress the answer on those few components, and fold the result back into one coefficient per original input so it can still be read.'],
    when: 'Spectroscopy and process-analytical data, sensor trains where many tags move together, any table with more columns than rows, and multivariate calibration generally.',
    watch: 'PLS will happily fit noise if given too many components, which is why the count is cross-validated. It is also not a causal statement: a wavelength with a large coefficient may simply travel with the thing that matters. Where the inputs are few and independent it buys nothing over ordinary regression, and even where they are many it does not reliably beat ridge \u2014 reach for it when you want a few interpretable components, not because it is the more advanced-sounding method.',
    where: 'PLS appears on the leaderboard automatically whenever there are at least two numeric inputs and eight rows, and wins only when it genuinely predicts better.',
    quiz: { q: 'You have 18 batches and 200 wavelengths. Why can ordinary least squares not be used?', options: ['The wavelengths are measured on the wrong scale', 'There are more unknowns than equations, so it fits the training data exactly and generalizes not at all', 'Least squares only works on categorical inputs'], answer: 1, why: 'With 200 coefficients and 18 observations an exact fit always exists, and infinitely many of them do. The fit says nothing about a nineteenth batch. PLS reduces the 200 channels to a few components first, so there are fewer unknowns than observations \u2014 and so does ridge, by shrinking them instead. Either beats ordinary least squares here.' }
  });

  add({
    id: 'quadratic', group: 'Predicting numbers and categories', title: 'Quadratic models: finding the sweet spot',
    analogy: 'Baking: too cold and the cake is raw, too hot and it burns. The best result is in the middle.',
    intro: 'Real processes often have an optimum inside the range: temperature, speed, concentration. A quadratic model adds squared terms (curves) and cross terms (interactions). It is the response-surface model used in DOE.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls"><label><input type="checkbox" data-role="lin" checked> Straight line</label><label><input type="checkbox" data-role="quad" checked> Curve (quadratic)</label></div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const rand = E.rng(41);
      const pts = range(30).map(() => { const x = 20 + rand() * 80; return [x, 80 - 0.025 * (x - 62) ** 2 + normal(rand) * 2.5]; });
      const lin = E.fitRidgeCore(pts.map(p => [p[0]]), pts.map(p => p[1]), 1e-8);
      const quad = E.fitRidgeCore(pts.map(p => [p[0], p[0] * p[0]]), pts.map(p => p[1]), 1e-8);
      const vx = -quad.w[0] / (2 * quad.w[1]), vy = quad.predict([[vx, vx * vx]])[0];
      const draw = () => {
        const f = frame(640, 300, [15, 105], [20, 90], { xLabel: 'Oven temperature', yLabel: 'Quality score' });
        let b = f.axes;
        if (q(el, 'lin').checked) b += '<path class="curve alt" d="' + pathOf([[15, lin.predict([[15]])[0]], [105, lin.predict([[105]])[0]]], f) + '"/>';
        if (q(el, 'quad').checked) {
          b += '<path class="curve" d="' + pathOf(range(100).map(i => { const x = 15 + i * 0.9; return [x, quad.predict([[x, x * x]])[0]]; }), f) + '"/>';
          b += '<line class="ref" x1="' + f.sx(vx) + '" x2="' + f.sx(vx) + '" y1="' + f.sy(20) + '" y2="' + f.sy(vy) + '"/><text class="lbl-strong" x="' + (f.sx(vx) + 6) + '" y="' + (f.sy(vy) - 8) + '">Sweet spot ≈ ' + vx.toFixed(0) + '</text>';
        }
        b += pts.map(p => dot(f.sx(p[0]), f.sy(p[1]), 'pt', 4.5)).join('');
        q(el, 'plot').innerHTML = svg(640, 300, 'Linear versus quadratic fit', b);
        const r2l = E.regressionMetrics(pts.map(p => p[1]), lin.predict(pts.map(p => [p[0]]))).r2;
        const r2q = E.regressionMetrics(pts.map(p => p[1]), quad.predict(pts.map(p => [p[0], p[0] * p[0]]))).r2;
        q(el, 'read').innerHTML = 'Straight line R² <b>' + r2l.toFixed(2) + '</b> versus curve R² <b>' + r2q.toFixed(2) + '</b>. The straight line says "temperature barely matters", which is wrong: it matters a lot, just not in one direction. The curve finds the best temperature at about <b>' + vx.toFixed(0) + '</b>.';
      };
      q(el, 'lin').onchange = draw; q(el, 'quad').onchange = draw; draw();
    },
    steps: ['Add each input squared, so the model can bend.', 'Add each pair of inputs multiplied, so it can capture interactions.', 'Fit like linear regression, with a little ridge penalty for stability.', 'The top of the curve is the sweet spot.'],
    when: 'When you suspect an optimum inside the range, or after a DOE shows curvature.',
    watch: 'Never trust the curve outside the data. Curves shoot off quickly beyond the tested range.',
    where: 'The "Quadratic (curves + interactions)" model, and "Target" actions in the action plan.',
    quiz: { q: 'A straight-line model says temperature has almost no effect, but a quadratic fits much better. What is the likely story?', options: ['Temperature does not matter', 'There is a sweet spot: both too low and too high are bad', 'The data is broken'], answer: 1, why: 'A hump-shaped relationship averages out to a flat line, hiding a strong effect with an optimum in the middle.' }
  });

  add({
    id: 'logistic', group: 'Predicting numbers and categories', title: 'Logistic regression: scoring the odds',
    analogy: 'A credit score: points for each factor add up, and the total maps to a chance of default.',
    intro: 'For yes/no outcomes, logistic regression adds up weighted inputs like a linear model, then squeezes the total through an S-shaped curve so the answer is a probability between 0% and 100%.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('x', 'Hold time (hours)', 0, 24, 0.5, 12) + '</div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const rand = E.rng(51);
      const pts = range(60).map(() => { const x = rand() * 24; const p = 1 / (1 + Math.exp(-(x - 13) * 0.55)); return [x, rand() < p ? 1 : 0]; });
      let a = 0, b = 0;
      for (let it = 0; it < 4000; it++) { let ga = 0, gb = 0; pts.forEach(([x, y]) => { const p = 1 / (1 + Math.exp(-(a + b * x))); ga += p - y; gb += (p - y) * x; }); a -= 0.05 * ga / 60; b -= 0.01 * gb / 60; }
      const P = x => 1 / (1 + Math.exp(-(a + b * x)));
      const draw = () => {
        const x = Number(q(el, 'x').value); setOut(el, 'x', x);
        const f = frame(640, 300, [0, 24], [-0.08, 1.08], { xLabel: 'Hold time (hours)', yLabel: 'Chance of failure', yFmt: v => pct(v) });
        const jit = i => ((i * 37) % 11 - 5) / 100;
        q(el, 'plot').innerHTML = svg(640, 300, 'Logistic curve', f.axes + '<line class="diag" x1="' + f.sx(0) + '" x2="' + f.sx(24) + '" y1="' + f.sy(0.5) + '" y2="' + f.sy(0.5) + '"/>' +
          pts.map((p, i) => dot(f.sx(p[0]), f.sy(p[1] + jit(i)), p[1] ? 'c2' : 'c1', 4, null, p[1] ? 'square' : 'circle')).join('') +
          '<path class="curve" d="' + pathOf(range(100).map(i => [i * 0.24, P(i * 0.24)]), f) + '"/><line class="ref" x1="' + f.sx(x) + '" x2="' + f.sx(x) + '" y1="' + f.sy(0) + '" y2="' + f.sy(P(x)) + '"/>' + dot(f.sx(x), f.sy(P(x)), 'query', 7)) +
          C.legend([{ label: 'Passed (bottom)', cls: 'c1' }, { label: 'Failed (top)', cls: 'c2', shape: 'square' }]);
        q(el, 'read').innerHTML = 'At <b>' + x + ' hours</b> the model gives a <b>' + pct(P(x)) + '</b> chance of failure, so it predicts <b>' + (P(x) >= 0.5 ? 'Fail' : 'Pass') + '</b> (50% cut-off, dashed line). Each extra hour multiplies the odds of failure by about <b>' + Math.exp(b).toFixed(2) + '</b>.';
      };
      q(el, 'x').oninput = draw; draw();
    },
    steps: ['Add up weighted inputs into a score.', 'Turn the score into a probability with an S-curve.', 'Predict the class with the highest probability.', 'Each weight says how much an input shifts the odds.'],
    when: 'Yes/no or few-category outcomes where you want an explainable model.',
    watch: 'Like linear models, it assumes effects push steadily in one direction.',
    where: 'Leaderboard for classification, and the probability bars in the what-if simulator.',
    quiz: { q: 'What does logistic regression output before the final yes/no call?', options: ['A probability between 0% and 100%', 'A straight line', 'A list of groups'], answer: 0, why: 'The S-curve turns the weighted score into a probability; the class is then the most likely one.' }
  });

  add({
    id: 'naive-bayes', group: 'Predicting numbers and categories', title: 'Naive Bayes: matching the profile',
    analogy: 'A detective with a profile of each suspect group: "people in this group are usually this tall and this old." Who does the new person resemble most?',
    intro: 'Naive Bayes learns what each class typically looks like (a bell curve per input), then for a new row asks which class profile it fits best. It is "naive" because it treats inputs as independent, which is rarely true but often works well.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('x', 'Measured pH', 3, 10, 0.1, 6.2) + '</div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const g = (x, m, s) => Math.exp(-((x - m) ** 2) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI));
      const draw = () => {
        const x = Number(q(el, 'x').value); setOut(el, 'x', x.toFixed(1));
        const f = frame(640, 280, [3, 10], [0, 0.45], { xLabel: 'pH', yLabel: 'How typical', yFmt: () => '' });
        const xs = range(141).map(i => 3 + i * 0.05);
        const pa = g(x, 7, 0.7), pb = g(x, 5.2, 0.9), post = pa / (pa + pb);
        q(el, 'plot').innerHTML = svg(640, 280, 'Class profiles', f.axes + '<path class="curve" d="' + pathOf(xs.map(v => [v, g(v, 7, 0.7)]), f) + '"/><path class="curve alt" d="' + pathOf(xs.map(v => [v, g(v, 5.2, 0.9)]), f) + '"/>' +
          '<line class="ref" x1="' + f.sx(x) + '" x2="' + f.sx(x) + '" y1="' + f.sy(0) + '" y2="' + f.sy(0.45) + '"/>' + dot(f.sx(x), f.sy(pa), 'pt', 6) + dot(f.sx(x), f.sy(pb), 'pt s2', 6, null, 'square')) +
          C.legend([{ label: 'Profile of passing batches', cls: 'pt' }, { label: 'Profile of failing batches', cls: 'pt s2', shape: 'square' }]);
        q(el, 'read').innerHTML = 'At pH <b>' + x.toFixed(1) + '</b> the batch looks <b>' + (pa / pb).toFixed(1) + '×</b> as typical of a pass as of a fail, so the chance of passing is <b>' + pct(post) + '</b>. With more inputs, Naive Bayes multiplies these "how typical" scores together.';
      };
      q(el, 'x').oninput = draw; draw();
    },
    steps: ['For each class, learn the average and spread of each input.', 'For a new row, score how typical it is of each class.', 'Multiply the scores across inputs (treating them as independent).', 'Pick the class with the highest score.'],
    when: 'Small data, many inputs, or as a fast benchmark.',
    watch: 'Strongly linked inputs get double-counted, so probabilities can be over-confident.',
    where: 'Leaderboard for classification problems.',
    quiz: { q: 'Why is it called "naive"?', options: ['It only works on small data', 'It assumes the inputs do not influence each other', 'It ignores the target'], answer: 1, why: 'It treats every input as independent, a simplification that is often good enough.' }
  });

  add({
    id: 'knn', group: 'Predicting numbers and categories', title: 'k-Nearest neighbours: ask the neighbours',
    analogy: 'Pricing a house by looking at the five most similar houses that sold nearby.',
    intro: 'kNN does not build a formula at all. To predict a new row it finds the k most similar past rows and takes their majority vote (or average). Click anywhere on the chart to drop a new batch.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('k', 'Neighbours (k)', 1, 15, 2, 5) + '</div><div data-role="plot"></div>' + passLegend + '<p class="demo-read" data-role="read"></p>';
      const d = passFail(90, 7);
      let qx = 205, qy = 50;
      const draw = () => {
        const k = Number(q(el, 'k').value); setOut(el, 'k', k);
        const f = frame(640, 340, PF_X, PF_Y, { xLabel: 'Temperature', yLabel: 'Humidity' });
        const dist = d.X.map((p, i) => [((p[0] - qx) / 100) ** 2 + ((p[1] - qy) / 60) ** 2, i]).sort((a, b) => a[0] - b[0]).slice(0, k);
        const votes = dist.reduce((s, v) => s + d.y[v[1]], 0);
        q(el, 'plot').innerHTML = svg(640, 340, 'k nearest neighbours', f.axes + dist.map(v => '<line class="nbr" x1="' + f.sx(qx) + '" y1="' + f.sy(qy) + '" x2="' + f.sx(d.X[v[1]][0]) + '" y2="' + f.sy(d.X[v[1]][1]) + '"/>').join('') + pfPoints(f, d) + dot(f.sx(qx), f.sy(qy), 'query', 8) + '<rect class="hit" x="0" y="0" width="640" height="340"/>');
        q(el, 'read').innerHTML = '<b>' + votes + ' of ' + k + '</b> nearest neighbours passed, so kNN predicts <b>' + (votes * 2 > k ? 'Pass' : votes * 2 === k ? 'a tie' : 'Fail') + '</b> for the yellow batch (temperature ' + fmt(qx) + ', humidity ' + fmt(qy) + '). Click elsewhere to move it. Small k follows local quirks; large k smooths them out.';
        const s = q(el, 'plot').querySelector('svg');
        s.onclick = e => { const [px, py] = svgPoint(s, e); const v = f.inv(px, py); qx = Math.max(150, Math.min(250, v[0])); qy = Math.max(20, Math.min(80, v[1])); draw(); };
      };
      q(el, 'k').oninput = draw; draw();
    },
    steps: ['Put every input on the same scale.', 'Measure the distance from the new row to every past row.', 'Take the k closest.', 'Vote (classification) or average (regression).'],
    when: 'When similar conditions really do give similar results, and the data is not huge.',
    watch: 'Irrelevant columns distort "similar". It gets slow with very large data.',
    where: 'Leaderboard for both regression and classification.',
    quiz: { q: 'With k = 1, kNN copies the single closest row. What is the risk?', options: ['It is too slow', 'One noisy or mislabelled row decides the prediction', 'It cannot handle numbers'], answer: 1, why: 'k = 1 trusts one neighbour completely, so noise passes straight through. Larger k averages it out.' }
  });

  add({
    id: 'tree', group: 'Predicting numbers and categories', title: 'Decision tree: the troubleshooting flowchart',
    analogy: 'A game of 20 questions, or the troubleshooting chart on the side of a machine: "Is the light red? Yes → check the fuse."',
    intro: 'A decision tree asks a series of yes/no questions about the inputs. Each question is chosen to split the rows into the purest possible groups. Grow the tree one level at a time and watch the map on the left get carved into boxes. Click the map to send a batch down the tree.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('depth', 'Tree depth (questions asked)', 1, 5, 1, 2) + '</div><div class="demo-grid"><div><h4>The map the tree draws</h4><div data-role="map"></div>' + passLegend + '</div><div><h4>The tree itself</h4><div class="table-scroll" data-role="tree"></div></div></div><p class="demo-read" data-role="read"></p>';
      const d = passFail(120, 3);
      let probe = [205, 45];
      const draw = () => {
        const depth = Number(q(el, 'depth').value); setOut(el, 'depth', depth);
        const tree = E.buildTree(d.X, d.y, range(d.X.length), { maxDepth: depth, minLeaf: 3, nClasses: 2 }, E.rng(1), 0);
        const f = frame(360, 300, PF_X, PF_Y, { xLabel: 'Temperature', yLabel: 'Humidity' });
        const regions = treeRegions(tree, [150, 250, 20, 80], []);
        const acc = E.mean(d.X.map((r, i) => ((E.treePredictRow(tree, r)[1] >= 0.5 ? 1 : 0) === d.y[i] ? 1 : 0)));
        const path = pathTo(tree, probe);
        q(el, 'map').innerHTML = svg(360, 300, 'Tree regions', f.axes + regions.map(r => '<rect class="region-' + (r.p >= 0.5 ? 'c1' : 'c2') + '" fill-opacity="0.16" x="' + f.sx(r.b[0]) + '" y="' + f.sy(r.b[3]) + '" width="' + (f.sx(r.b[1]) - f.sx(r.b[0])) + '" height="' + (f.sy(r.b[2]) - f.sy(r.b[3])) + '"/>').join('') +
          pfPoints(f, d) + dot(f.sx(probe[0]), f.sy(probe[1]), 'query', 8) + '<rect class="hit" x="0" y="0" width="360" height="300"/>');
        C.treeDiagram(q(el, 'tree'), tree, { question: pfQuestion, leaf: pfLeaf, leafClass: pfLeafClass, path: path.set, colW: 112, label: 'Decision tree' });
        q(el, 'read').innerHTML = 'Depth <b>' + depth + '</b>: the tree gets <b>' + pct(acc) + '</b> of these rows right. The yellow batch follows the highlighted path and lands in a <b>' + (path.leaf.value[1] >= 0.5 ? 'Pass' : 'Fail') + '</b> box. ' +
          (depth >= 4 ? 'Deep trees start carving tiny boxes around single noisy points: overfitting.' : 'Each extra level lets the tree draw finer boxes.');
        const s = q(el, 'map').querySelector('svg');
        s.onclick = e => { const [px, py] = svgPoint(s, e); const v = f.inv(px, py); probe = [Math.max(150, Math.min(250, v[0])), Math.max(20, Math.min(80, v[1]))]; draw(); };
      };
      q(el, 'depth').oninput = draw; draw();
    },
    steps: ['Try every input and every cut point.', 'Pick the question that splits the rows into the purest two groups.', 'Repeat inside each group until the tree is deep enough or groups get too small.', 'A new row answers the questions top to bottom and gets the result of the box it lands in.'],
    when: 'When you want rules people can read and act on, or when effects have thresholds.',
    watch: 'A single tree is unstable: a few changed rows can change the whole tree. Deep trees overfit.',
    where: '"Peek inside the model" shows a 3-question tree trained on your data.',
    quiz: { q: 'What does each box at the bottom of a decision tree hold?', options: ['A question', 'The predicted result for rows that end there', 'The raw data'], answer: 1, why: 'Leaves (rounded boxes) give the prediction: the average result or the most common class of the rows that reach them.' }
  });

  add({
    id: 'forest', group: 'Predicting numbers and categories', title: 'Random forest: the wisdom of the crowd',
    analogy: 'Asking 60 experienced operators separately and going with the majority. Each has blind spots, but their mistakes rarely line up.',
    intro: 'A random forest grows many decision trees. Each tree sees a random sample of the rows and, at each question, a random subset of the inputs. So the trees differ. The forest takes a vote. Click the map to send one batch through all five trees below.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + btn('grow', 'Grow a new forest', 'primary') + '</div><div class="demo-grid"><div><h4>One tree on its own</h4><div data-role="one"></div></div><div><h4>The forest\'s vote (darker = more trees agree)</h4><div data-role="map"></div></div></div>' + passLegend +
        '<h4>The five trees: pick one to see the path the yellow batch takes through it</h4><div data-role="trees"></div><p class="demo-read" data-role="read"></p>';
      const d = passFail(120, 3);
      let probe = [205, 45], seed = 1, trees = [], cur = 0;
      const grow = () => {
        const rand = E.rng(seed++);
        trees = range(5).map(() => { const idx = range(d.X.length).map(() => Math.floor(rand() * d.X.length)); return E.buildTree(d.X, d.y, idx, { maxDepth: 3, minLeaf: 2, nClasses: 2, mtry: 1 }, rand, 0); });
      };
      const single = E.buildTree(d.X, d.y, range(d.X.length), { maxDepth: 3, minLeaf: 2, nClasses: 2 }, E.rng(1), 0);
      const mapSvg = (fn, label) => {
        const f = frame(320, 270, PF_X, PF_Y, { xLabel: 'Temperature', yLabel: 'Humidity' });
        let b = f.axes;
        const nx = 30, ny = 22;
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
          const x0 = 150 + 100 * i / nx, x1 = 150 + 100 * (i + 1) / nx, y0 = 20 + 60 * j / ny, y1 = 20 + 60 * (j + 1) / ny;
          const p = fn([(x0 + x1) / 2, (y0 + y1) / 2]);
          // Snap cell edges to whole units so neighbouring cells share edges exactly (no seams).
          const rx = Math.round(f.sx(x0)), ry = Math.round(f.sy(y1));
          b += '<rect class="region-' + (p >= 0.5 ? 'c1' : 'c2') + '" fill-opacity="' + (0.05 + 0.3 * Math.abs(p - 0.5) * 2).toFixed(2) + '" x="' + rx + '" y="' + ry + '" width="' + (Math.round(f.sx(x1)) - rx) + '" height="' + (Math.round(f.sy(y0)) - ry) + '" shape-rendering="crispEdges"/>';
        }
        return { f, html: svg(320, 270, label, b + pfPoints(f, d) + dot(f.sx(probe[0]), f.sy(probe[1]), 'query', 8) + '<rect class="hit" x="0" y="0" width="320" height="270"/>') };
      };
      const vote = r => E.mean(trees.map(t => (E.treePredictRow(t, r)[1] >= 0.5 ? 1 : 0)));
      const draw = () => {
        const one = mapSvg(r => E.treePredictRow(single, r)[1], 'Single tree map');
        const forest = mapSvg(vote, 'Forest vote map');
        q(el, 'one').innerHTML = one.html; q(el, 'map').innerHTML = forest.html;
        const votes = trees.map(t => pathTo(t, probe));
        const yes = votes.filter(v => v.leaf.value[1] >= 0.5).length;
        const box = q(el, 'trees');
        box.innerHTML = '<div class="tree-tabs" role="tablist">' + votes.map((v, i) => '<button type="button" role="tab" aria-selected="' + (i === cur) + '" class="btn ' + (i === cur ? 'primary' : 'ghost') + '" data-tree="' + i + '">Tree ' + (i + 1) + ': <span class="' + (v.leaf.value[1] >= 0.5 ? 'pass' : 'fail') + '">' + (v.leaf.value[1] >= 0.5 ? 'Pass' : 'Fail') + '</span></button>').join('') + '</div><div class="table-scroll" data-role="one-tree"></div>';
        C.treeDiagram(q(box, 'one-tree'), trees[cur], { question: pfQuestion, leaf: pfLeaf, leafClass: pfLeafClass, path: votes[cur].set, colW: 116, label: 'Tree ' + (cur + 1) });
        box.querySelectorAll('[data-tree]').forEach(b => { b.onclick = () => { cur = Number(b.getAttribute('data-tree')); draw(); }; });
        q(el, 'read').innerHTML = '<b>' + yes + ' of 5</b> trees vote Pass, so the forest says <b>' + (yes >= 3 ? 'Pass' : 'Fail') + '</b> with ' + pct(Math.max(yes, 5 - yes) / 5) + ' agreement. Compare the two maps: the single tree draws hard, blocky edges; the forest\'s vote is smoother and shows where it is unsure (pale areas). The agent\'s forest uses 60 trees, not 5.';
        [one, forest].forEach((m, k) => { const s = q(el, k ? 'map' : 'one').querySelector('svg'); s.onclick = e => { const [px, py] = svgPoint(s, e); const v = m.f.inv(px, py); probe = [Math.max(150, Math.min(250, v[0])), Math.max(20, Math.min(80, v[1]))]; draw(); }; });
      };
      q(el, 'grow').onclick = () => { grow(); draw(); };
      grow(); draw();
    },
    steps: ['Draw a random sample of rows (with repeats) for each tree.', 'At every question, let the tree consider only a random few inputs.', 'Grow many such trees; they will disagree in different places.', 'Average or vote. Random errors cancel; the real pattern adds up.'],
    when: 'A strong default for messy, non-linear data with interactions.',
    watch: 'Harder to explain than one tree, so use the driver chart and "how each driver moves the result" to interpret it.',
    where: 'If a forest wins, "Peek inside the model" shows three of its real trees.',
    quiz: { q: 'Why does a random forest usually beat a single decision tree?', options: ['Its trees are deeper', 'Averaging many different trees cancels out their individual mistakes', 'It uses more columns'], answer: 1, why: 'Each tree errs in different places; the vote keeps what they agree on, which is the real pattern.' }
  });

  add({
    id: 'boosting', group: 'Predicting numbers and categories', title: 'Gradient boosting: continuous improvement',
    analogy: 'Golf: the first shot gets you near the green, each next shot corrects what is left. Or a kaizen loop: every cycle closes part of the remaining gap.',
    intro: 'Boosting builds small trees one after another. The first makes a rough guess. Each next tree is trained only on what is still wrong (the leftover errors), and adds a small correction. Slide the rounds to watch the fit improve.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('m', 'Rounds (trees added)', 0, 80, 1, 0) + '</div><div class="demo-grid"><div><h4>The model\'s prediction</h4><div data-role="fit"></div></div><div><h4>Remaining error after each round</h4><div data-role="err"></div></div></div><p class="demo-read" data-role="read"></p>';
      const rand = E.rng(61), n = 70;
      const X = range(n).map(() => [rand() * 10]), y = X.map(r => Math.sin(r[0]) * 3 + r[0] * 0.4 + normal(rand) * 0.5);
      const grid = range(120).map(i => [i / 119 * 10]);
      const f0 = E.mean(y), F = y.map(() => f0), G = grid.map(() => f0);
      const fits = [G.slice()], errs = [Math.sqrt(E.mean(y.map((v, i) => (v - F[i]) ** 2)))];
      for (let m = 0; m < 80; m++) {
        const r = y.map((v, i) => v - F[i]);
        const t = E.buildTree(X, r, range(n), { maxDepth: 2, minLeaf: 4, nClasses: 0 }, rand, 0);
        X.forEach((row, i) => { F[i] += 0.3 * E.treePredictRow(t, row); });
        grid.forEach((row, i) => { G[i] += 0.3 * E.treePredictRow(t, row); });
        fits.push(G.slice()); errs.push(Math.sqrt(E.mean(y.map((v, i) => (v - F[i]) ** 2))));
      }
      const draw = () => {
        const m = Number(q(el, 'm').value); setOut(el, 'm', m);
        const f = frame(330, 260, [0, 10], [-4, 8], { xLabel: 'Setting', yLabel: 'Result' });
        q(el, 'fit').innerHTML = svg(330, 260, 'Boosting fit', f.axes + X.map((r, i) => dot(f.sx(r[0]), f.sy(y[i]), 'dot', 3.5)).join('') + '<path class="curve good" d="' + pathOf(grid.map((g, i) => [g[0], fits[m][i]]), f) + '"/>');
        const fe = frame(330, 260, [0, 80], [0, Math.ceil(errs[0])], { xLabel: 'Round', yLabel: 'Typical error' });
        q(el, 'err').innerHTML = svg(330, 260, 'Error by round', fe.axes + '<path class="curve" d="' + pathOf(errs.map((e, i) => [i, e]), fe) + '"/>' + dot(fe.sx(m), fe.sy(errs[m]), 'query', 6));
        q(el, 'read').innerHTML = m === 0 ? 'Round 0: the model just guesses the average, a flat line. Start sliding.'
          : 'After <b>' + m + '</b> small trees, the typical error is down from ' + errs[0].toFixed(2) + ' to <b>' + errs[m].toFixed(2) + '</b>. Early rounds fix big misses; later rounds polish. Too many rounds would start fitting noise, so the agent keeps the corrections small (a learning rate) and checks with cross-validation.';
      };
      q(el, 'm').oninput = draw; draw();
    },
    steps: ['Start with a simple guess (the average).', 'Measure what is still wrong for every row.', 'Fit a small tree to those leftovers and add a fraction of it.', 'Repeat 100 times. Each round closes part of the gap.'],
    when: 'Often the most accurate model on tabular data with non-linear effects.',
    watch: 'Least explainable on its own. Lean on the driver and "how each driver moves" charts.',
    where: 'If boosting wins, "Peek inside the model" shows its first three correction trees.',
    quiz: { q: 'What does each new tree in gradient boosting learn?', options: ['The original target, from scratch', 'The errors the previous trees still make', 'A random subset of columns only'], answer: 1, why: 'Each tree targets the remaining errors, so the chain keeps correcting itself.' }
  });

  add({
    id: 'neural-network', group: 'Predicting numbers and categories', title: 'Neural networks: watch one learn',
    analogy: 'A team of specialists passing notes forward. The first layer spots simple clues, the next combines clues into patterns, and the last makes the call. Training is the team adjusting how much they trust each note.',
    intro: 'A neural network is layers of simple units. Each unit adds up its weighted inputs and passes a signal on if the total is positive. Stack two layers and the network can bend its boundary into curves and islands that a straight line cannot draw. Pick a pattern and press Train.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + ['circle', 'moons', 'xor'].map((k, i) => btn('d-' + k, { circle: 'Circle', moons: 'Two moons', xor: 'Checkerboard (XOR)' }[k], i ? 'ghost' : 'primary')).join('') +
        slider('h', 'Units per hidden layer', 2, 16, 1, 8) + btn('go', 'Train', 'primary') + btn('reset', 'Reset', 'ghost') + '</div>' +
        '<div class="demo-grid"><div><h4>What the network thinks (shading = its confidence)</h4><div data-role="map"></div>' + passLegend + '</div><div><h4>The network: blue connections push up, orange push down</h4><div data-role="net"></div><h4>Error while learning</h4><div data-role="loss"></div></div></div><p class="demo-read" data-role="read"></p>';
      let kind = 'circle', tr = null, data = null, running = false, raf = 0;
      const make = () => {
        const rand = E.rng(17), X = [], y = [];
        for (let i = 0; i < 220; i++) {
          let a, b, c;
          if (kind === 'circle') { a = rand() * 4 - 2; b = rand() * 4 - 2; c = a * a + b * b < 1.4 ? 1 : 0; }
          else if (kind === 'xor') { a = rand() * 4 - 2; b = rand() * 4 - 2; c = (a > 0) === (b > 0) ? 1 : 0; }
          else { const t = rand() * Math.PI, up = rand() < 0.5; a = up ? Math.cos(t) * 1.4 - 0.5 : 0.9 - Math.cos(t) * 1.4; b = up ? Math.sin(t) * 1.4 - 0.4 : 0.4 - Math.sin(t) * 1.4; c = up ? 1 : 0; a += normal(rand) * 0.15; b += normal(rand) * 0.15; }
          X.push([a, b]); y.push(c);
        }
        return { X, y };
      };
      const restart = () => {
        cancelAnimationFrame(raf); running = false; q(el, 'go').textContent = 'Train';
        const h = Number(q(el, 'h').value); setOut(el, 'h', h);
        data = make();
        tr = E.mlpTrainer(data.X, data.y, { task: 'classification', nClasses: 2, rand: E.rng(5) }, { h1: h, h2: h, maxEpochs: 400, patience: 400, lr: 0.01, l2: 0 });
        draw();
      };
      const draw = () => {
        const f = frame(330, 290, [-2.2, 2.2], [-2.2, 2.2], { xLabel: 'Input 1', yLabel: 'Input 2' });
        const nx = 34, ny = 30, cells = [];
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) cells.push([-2.2 + 4.4 * (i + 0.5) / nx, -2.2 + 4.4 * (j + 0.5) / ny]);
        const pr = tr.peek(cells);
        let b = f.axes;
        cells.forEach((c, k) => {
          const p1 = pr[k][1], x0 = Math.round(f.sx(c[0] - 2.2 / nx)), y0 = Math.round(f.sy(c[1] + 2.2 / ny));
          b += '<rect class="region-' + (p1 >= 0.5 ? 'c1' : 'c2') + '" fill-opacity="' + (0.06 + 0.4 * Math.abs(p1 - 0.5)).toFixed(2) + '" x="' + x0 + '" y="' + y0 + '" width="' + (Math.round(f.sx(c[0] + 2.2 / nx)) - x0) + '" height="' + (Math.round(f.sy(c[1] - 2.2 / ny)) - y0) + '" shape-rendering="crispEdges"/>';
        });
        b += data.X.map((p, i) => dot(f.sx(p[0]), f.sy(p[1]), data.y[i] ? 'c1' : 'c2', 3.5, null, data.y[i] ? 'circle' : 'square')).join('');
        q(el, 'map').innerHTML = svg(330, 290, 'Network decision map', b);
        // Network diagram with live weights.
        const wts = tr.weights(), sizes = tr.sizes, W = 330, H = 200, xs = c => 30 + c * (W - 60) / (sizes.length - 1), ys = (c, i) => H / 2 + (i - (sizes[c] - 1) / 2) * Math.min(22, (H - 30) / sizes[c]);
        let maxw = 1e-9; wts.W.forEach(w => w.forEach(v => { maxw = Math.max(maxw, Math.abs(v)); }));
        let n = '';
        for (let l = 0; l < sizes.length - 1; l++) for (let j = 0; j < sizes[l + 1]; j++) for (let i = 0; i < sizes[l]; i++) {
          const v = wts.W[l][j * sizes[l] + i];
          n += '<line class="nn-edge ' + (v >= 0 ? 'pos' : 'neg') + '" stroke-opacity="' + (0.15 + 0.85 * Math.abs(v) / maxw).toFixed(2) + '" stroke-width="' + (0.5 + 3 * Math.abs(v) / maxw).toFixed(2) + '" x1="' + xs(l) + '" y1="' + ys(l, i) + '" x2="' + xs(l + 1) + '" y2="' + ys(l + 1, j) + '"/>';
        }
        sizes.forEach((sz, c) => { for (let i = 0; i < sz; i++) n += '<circle class="nn-node' + (c === 0 ? ' in' : c === sizes.length - 1 ? ' out' : '') + '" cx="' + xs(c) + '" cy="' + ys(c, i) + '" r="6"/>'; });
        q(el, 'net').innerHTML = svg(W, H, 'Network diagram', n);
        const hist = tr.history;
        if (hist.length > 1) {
          const fl = frame(330, 150, [1, Math.max(10, hist.length)], [0, Math.max(0.8, ...hist.map(e => e.train))], { xLabel: 'Epoch', yFmt: v => v.toFixed(1) });
          q(el, 'loss').innerHTML = svg(330, 150, 'Training error', fl.axes + '<path class="curve" d="' + pathOf(hist.map(e => [e.epoch, e.train]), fl) + '"/>');
        } else q(el, 'loss').innerHTML = '<p class="hint">Press Train to start.</p>';
        const acc = E.mean(tr.peek(data.X).map((o, i) => ((o[1] >= 0.5 ? 1 : 0) === data.y[i] ? 1 : 0)));
        q(el, 'read').innerHTML = 'Epoch <b>' + hist.length + '</b> · accuracy <b>' + pct(acc) + '</b>. ' + (hist.length === 0 ? 'Before training the weights are random, so the map is a guess.' :
          acc > 0.95 ? 'It has bent its boundary to fit the pattern. Try fewer units: with 2 per layer it often cannot draw the shape.' : 'Watch the shading reshape as the connections strengthen.');
      };
      const loop = () => { if (!running) return; const fin = tr.step(2); draw(); if (fin) { running = false; q(el, 'go').textContent = 'Train'; return; } raf = requestAnimationFrame(loop); };
      q(el, 'go').onclick = () => { running = !running; q(el, 'go').textContent = running ? 'Pause' : 'Train'; if (running) raf = requestAnimationFrame(loop); };
      q(el, 'reset').onclick = restart;
      q(el, 'h').oninput = restart;
      ['circle', 'moons', 'xor'].forEach(k => { q(el, 'd-' + k).onclick = () => { kind = k; el.querySelectorAll('[data-role^="d-"]').forEach(b => { b.className = 'btn ' + (b.getAttribute('data-role') === 'd-' + k ? 'primary' : 'ghost'); }); restart(); }; });
      restart();
    },
    steps: ['Each unit computes a weighted sum of its inputs plus a bias, then keeps it only if positive (ReLU).', 'Two hidden layers let the network combine simple cuts into curves and islands.', 'Training nudges every weight a little to reduce the error (backpropagation with the Adam optimizer), one batch at a time.', 'ML Agent holds back 15% of rows and stops when their error stops improving (early stopping), keeping the best version.'],
    when: 'Tangled, curved patterns with enough rows (hundreds or more), where trees and straight lines fall short.',
    watch: 'Needs more data than simple models, is hard to explain, and can overfit small tables. On many business tables boosting or a forest does as well with less fuss, and the agent will tell you when.',
    where: 'The "Neural network (MLP)" row on the leaderboard, the live learning curve while the agent runs, and the "Neural network: how it learned" card.',
    quiz: { q: 'Why does the agent stop training when the error on held-back rows stops improving?', options: ['To save battery', 'Further training would start memorizing noise (overfitting)', 'Because the network is full'], answer: 1, why: 'Learning-row error keeps falling, but once held-back error plateaus, extra epochs only fit noise.' }
  });

  add({
    id: 'encoding', group: 'Predicting numbers and categories', title: 'Turning categories into numbers (and the leak that hides in it)',
    analogy: 'A model cannot read "Supplier B". It needs a number. How you choose that number decides what the model is allowed to learn - and one popular choice quietly hands it the answer sheet.',
    intro: 'Text columns - supplier, operator, lot code, site - carry real information, but every algorithm here wants numbers. Three ways to supply them: one column per level (one-hot), how often each level appears (frequency), or the average result for each level (target encoding). The third is the most powerful and the most dangerous, because the average result is made out of the answer you are trying to predict.',
    demo(el) {
      el.innerHTML = '<div data-role="plot"></div><div class="demo-controls">' + btn('run', 'Score both ways', 'primary') + '</div><p class="demo-read" data-role="read"></p>';
      /* A lot code with no real effect whatsoever: y is pure noise, and every level appears
         exactly twice. Nothing is there to find, so an honest score must come out near zero
         and anything above that is the leak measuring itself. */
      const rand = E.rng(13), n = 60, levels = 30;
      const code = range(n).map(i => 'L' + (i % levels));
      const y = range(n).map(() => 100 + normal(rand) * 3);
      const scoreWith = encode => {
        const folds = E.makeFolds(n, 5, E.rng(3));
        const pred = new Array(n).fill(0);
        for (let f = 0; f < 5; f++) {
          const tr = range(n).filter(i => folds[i] !== f), te = range(n).filter(i => folds[i] === f);
          const map = encode(tr);
          const grand = E.mean(tr.map(i => y[i]));
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
      const smoothed = rows => {
        const sum = {}, cnt = {}, grand = E.mean(rows.map(i => y[i])), prior = E.TARGET_PRIOR;
        rows.forEach(i => { sum[code[i]] = (sum[code[i]] || 0) + y[i]; cnt[code[i]] = (cnt[code[i]] || 0) + 1; });
        const out = {}; Object.keys(sum).forEach(k => { out[k] = (sum[k] + prior * grand) / (cnt[k] + prior); });
        return out;
      };
      const draw = vals => { C.hbar(q(el, 'plot'), vals.map(v => ({ label: v.label, value: v.value, cls: v.cls, text: 'R\u00b2 ' + v.value.toFixed(2) })), { min: -1, max: 1 }); };
      draw([{ label: 'Cross-validated score', value: 0 }]);
      q(el, 'run').onclick = () => {
        const leaky = scoreWith(() => meanBy(range(n)));          // encoded once, on everything
        const honest = scoreWith(tr => meanBy(tr));               // encoded inside each fold
        const smooth = scoreWith(tr => smoothed(tr));             // inside the fold, and pulled to the grand mean
        draw([
          { label: 'Encoded on all rows', value: leaky, cls: 'accent' },
          { label: 'Encoded inside each fold', value: honest },
          { label: 'Inside the fold, smoothed', value: smooth }
        ]);
        q(el, 'read').innerHTML = 'The result column here is pure noise and the lot code means nothing, so an honest score cannot be above zero. ' +
          'Encode the lot code with its average result <b>once, over all 60 rows</b>, and cross-validation reports <b>R&sup2; ' + leaky.toFixed(2) +
          '</b> - a respectable-looking model of nothing at all, because each row’s encoded value was built partly from that row’s own answer. It sat the exam with the paper in front of it. ' +
          'Recompute the encoding <b>inside every fold</b>, from training rows only, and the score falls to <b>' + honest.toFixed(2) +
          '</b>. Below zero means it predicts worse than simply quoting the overall average - which is what a column of noise deserves. ' +
          'Smoothing each level toward the grand mean recovers part of that (<b>' + smooth.toFixed(2) +
          '</b>) and is what the tool does, because with two rows per level a raw average is almost all noise. ' +
          'The point is not that target encoding is bad: it is that the encoding is part of the model, so it has to be fitted where the model is fitted.';
      };
    },
    steps: ['One-hot: one yes/no column per level. Safe and interpretable; impractical past a dozen levels.', 'Frequency: replace the level with how often it occurs. Cheap, never leaks, and often surprisingly useful - rare suppliers behave differently from routine ones.', 'Target encoding: replace the level with the average result for it. Powerful for many-levelled columns, and it must be fitted inside the cross-validation folds or it leaks.', 'Smoothing: pull each level’s average toward the overall average in proportion to how few rows it has, so a level with two rows is not trusted like one with two hundred.'],
    when: 'Any time a text column matters: supplier, site, operator, lot, campaign.',
    watch: 'A suspiciously good cross-validated score on a dataset with a high-cardinality code column is the signature of this leak. So is an ID-like column appearing as the top driver.',
    where: 'The agent encodes automatically: one-hot up to 12 levels, then frequency and smoothed target encoding above it - always refitted inside each fold. Columns that look like unique identifiers are dropped with a note rather than encoded.',
    quiz: { q: 'A model that includes a 40-level "lot code" column scores R² 0.91 in cross-validation, and the lot code is the top driver. What is the first thing to check?', options: ['Whether more lots would help', 'Whether the lot code was target-encoded using all rows rather than inside each fold', 'Whether the model is too simple'], answer: 1, why: 'With 40 levels and a target encoding fitted once on everything, each row’s encoded value is built partly from its own answer. The score then measures the leak, not the process. Refit inside the folds and the score usually collapses - which is the honest number.' }
  });

  add({
    id: 'multicollinearity', group: 'Predicting numbers and categories', title: 'When two inputs carry the same information',
    analogy: 'Two witnesses who were standing in the same spot. Between them they describe the scene well, but ask which one saw the crucial detail and they will contradict each other at random.',
    intro: 'In historical process data, inputs move together: temperature and jacket setpoint, feed rate and dilution, run time and total volume. When two columns are nearly the same information, a model can still predict well while its individual coefficients become almost arbitrary. That matters here, because the whole point of the driver ranking is to say which input to change.',
    demo(el) {
      el.innerHTML = '<div data-role="plot"></div><div class="demo-controls">' + slider('r', 'Correlation between the two inputs', 0, 0.99, 0.01, 0.3) + '</div><p class="demo-read" data-role="read"></p>';
      const draw = () => {
        const r = Number(q(el, 'r').value);
        setOut(el, 'r', r.toFixed(2));
        const rand = E.rng(29), n = 40, fits = [];
        for (let rep = 0; rep < 40; rep++) {
          const X = [], y = [];
          for (let i = 0; i < n; i++) {
            const a = normal(rand), b = r * a + Math.sqrt(1 - r * r) * normal(rand);
            X.push([a, b]); y.push(1 * a + 1 * b + normal(rand) * 0.6);
          }
          const m = E.fitRidgeCore(X, y, 1e-9);
          fits.push([m.w[0], m.w[1]]);
        }
        const f = frame(420, 300, [-2.5, 4.5], [-2.5, 4.5], { l: 42, b: 36, xLabel: 'Coefficient fitted for input A', yLabel: 'for input B' });
        q(el, 'plot').innerHTML = svg(420, 300, 'Forty refits of the same model', f.axes +
          '<path class="diag" d="' + pathOf([[-2.5, 4.5], [4.5, -2.5]], f) + '"/>' +
          fits.map(c => dot(f.sx(c[0]), f.sy(c[1]), 'c1', 4)).join('') +
          dot(f.sx(1), f.sy(1), 'c2', 6, 'The truth: both slopes are exactly 1', 'square'));
        const sdA = E.sd(fits.map(c => c[0])), sdSum = E.sd(fits.map(c => c[0] + c[1]));
        const vif = 1 / (1 - r * r);
        q(el, 'read').innerHTML = 'Forty independent datasets from the same truth - both slopes are exactly 1, marked by the orange square. Each blue dot is one refit. ' +
          'At this correlation the variance inflation factor is <b>' + vif.toFixed(1) + '</b> (that is 1 &divide; (1 &minus; r&sup2;)), the fitted slope for A varies by <b>&plusmn;' + fmt(sdA) +
          '</b> between datasets, but their <b>sum</b> varies by only <b>&plusmn;' + fmt(sdSum) + '</b>. ' +
          'Push the slider to 0.99 and the dots stretch along the dashed line: the model knows the two together add up to 2 and has almost no idea how to split it. ' +
          'Predictions stay fine. The attribution - which input to change - is what has gone.';
      };
      q(el, 'r').oninput = draw;
      draw();
    },
    steps: ['Fit the model. If it predicts well, prediction is not the problem.', 'Compute each input’s variance inflation factor: how much its coefficient’s variance is inflated by its overlap with the others. Above about 5 is a warning, above 10 a serious one.', 'Read the ranking as "this group of inputs matters", not "this one input matters", when the group is collinear.', 'To separate them, change them independently - which means an experiment, not more history.'],
    when: 'Before acting on a driver ranking built from observational data. It is the standard failure mode of historical process data.',
    watch: 'A coefficient with the wrong sign, or one that flips when you add a column, is collinearity rather than a discovery. Ridge and PLS stabilise the prediction but do not restore the attribution.',
    where: 'The agent computes VIF for every numeric input and warns when a group of inputs is inseparable, rather than letting the ranking imply a single cause. The DOE tool is the fix.',
    quiz: { q: 'Temperature and jacket setpoint have a VIF of 22 between them. The model predicts yield well. What can you honestly claim?', options: ['Temperature is the driver, since it has the larger coefficient', 'The thermal setting matters, but this data cannot say which of the two to change', 'Neither matters'], answer: 1, why: 'With a VIF of 22 the two columns are nearly the same information, so the split between their coefficients is close to arbitrary and would move with a different sample. The group effect is real and well estimated; the individual attribution is not. Moving one while holding the other is an experiment, not an analysis.' }
  });

  add({
    id: 'kmeans', group: 'Finding patterns', title: 'k-means: finding natural groups',
    analogy: 'Placing k warehouses so every store is as close as possible to its nearest one. Move the warehouses, reassign the stores, repeat.',
    intro: 'k-means has no answer key. It drops k centers, assigns every row to the nearest center, moves each center to the middle of its rows, and repeats until nothing changes. Step through it.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('k', 'Number of groups (k)', 2, 5, 1, 3) + btn('step', 'Next step', 'primary') + btn('run', 'Run to the end', 'ghost') + btn('restart', 'New random start', 'ghost') + '</div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const rand = E.rng(71), pts = [];
      [[2, 2.5], [7.5, 2], [5, 7.5]].forEach(c => { for (let i = 0; i < 30; i++) pts.push([c[0] + normal(rand) * 0.9, c[1] + normal(rand) * 0.9]); });
      let centers, labels, phase, stepN, seed = 3;
      const restart = () => {
        const r = E.rng(seed++), k = Number(q(el, 'k').value); setOut(el, 'k', k);
        centers = range(k).map(() => [0.5 + r() * 9, 0.5 + r() * 9]);
        labels = null; phase = 'assign'; stepN = 0;
      };
      const inertia = () => labels ? pts.reduce((s, p, i) => s + (p[0] - centers[labels[i]][0]) ** 2 + (p[1] - centers[labels[i]][1]) ** 2, 0) : null;
      const step = () => {
        stepN++;
        if (phase === 'assign') {
          const nl = pts.map(p => { let b = 0; centers.forEach((c, j) => { if ((p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 < (p[0] - centers[b][0]) ** 2 + (p[1] - centers[b][1]) ** 2) b = j; }); return b; });
          const changed = !labels || nl.some((v, i) => v !== labels[i]);
          labels = nl; phase = 'move';
          return changed;
        }
        centers = centers.map((c, j) => { const m = pts.filter((_, i) => labels[i] === j); return m.length ? [E.mean(m.map(p => p[0])), E.mean(m.map(p => p[1]))] : c; });
        phase = 'assign';
        return true;
      };
      const draw = msg => {
        const f = frame(640, 340, [-1, 11], [-1, 11], { noAxes: true, l: 10, b: 10 });
        q(el, 'plot').innerHTML = svg(640, 340, 'k-means steps', pts.map((p, i) => labels ? dot(f.sx(p[0]), f.sy(p[1]), 'c' + (labels[i] + 1), 5, null, C.SHAPES[labels[i]]) : dot(f.sx(p[0]), f.sy(p[1]), 'hollow', 5)).join('') +
          centers.map((c, j) => '<g><circle class="c' + (j + 1) + '" cx="' + f.sx(c[0]) + '" cy="' + f.sy(c[1]) + '" r="13" fill-opacity=".35"/><path class="center-mark" d="M' + (f.sx(c[0]) - 9) + ' ' + f.sy(c[1]) + 'h18M' + f.sx(c[0]) + ' ' + (f.sy(c[1]) - 9) + 'v18"/></g>').join(''));
        q(el, 'read').innerHTML = msg || 'The crosses are ' + centers.length + ' random starting centers. Press <b>Next step</b>.';
      };
      q(el, 'step').onclick = () => {
        const wasAssign = phase === 'assign';
        const changed = step();
        draw(wasAssign ? (changed ? 'Step ' + stepN + ': every point joins its <b>nearest</b> center. Total distance: ' + inertia().toFixed(1) + '.' : 'Step ' + stepN + ': no point changed group. <b>Done.</b> These are the groups.')
          : 'Step ' + stepN + ': each center moves to the <b>middle</b> of its points.');
      };
      q(el, 'run').onclick = () => { for (let i = 0; i < 60; i++) { const a = phase === 'assign'; const ch = step(); if (a && !ch) break; } draw('Finished. Total distance ' + inertia().toFixed(1) + '. Try "New random start" or a different k: with the wrong k, groups get merged or split oddly. The agent tries k = 2 to 6 and picks the clearest split.'); };
      q(el, 'restart').onclick = () => { restart(); draw(); };
      q(el, 'k').oninput = () => { restart(); draw(); };
      restart(); draw();
    },
    steps: ['Pick k starting centers (the agent uses a smart spread-out start and 5 tries).', 'Assign every row to its nearest center.', 'Move each center to the average of its rows.', 'Repeat until no row changes group. Then name the groups with people who know the process.'],
    when: 'Segmenting customers, products, lots or machines when there is no outcome column.',
    watch: 'Columns must be on comparable scales (the agent standardizes them). k-means likes round, similar-sized groups.',
    where: 'Unsupervised results: groups chart, silhouette chart and group profiles.',
    quiz: { q: 'What are the two steps k-means repeats?', options: ['Split and prune', 'Assign rows to the nearest center, then move centers to the middle of their rows', 'Vote and average'], answer: 1, why: 'Assign, then update, until nothing changes.' }
  });

  add({
    id: 'pca', group: 'Finding patterns', title: 'PCA: the most informative angle',
    analogy: 'Photographing a 3D object from the angle that shows the most. Or a shadow: flatten something into fewer dimensions but keep its shape.',
    intro: 'When there are many columns, PCA finds the directions in which the rows spread out the most. The first direction (component) captures the most variation, the second the next most, and so on. Plotting the first two gives a map of the whole dataset.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls"><label><input type="checkbox" data-role="flat"> Flatten onto the main direction</label></div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const rand = E.rng(81);
      const pts = range(80).map(() => { const a = normal(rand) * 2, b = normal(rand) * 0.6; return [5 + a * 0.8 - b * 0.6, 5 + a * 0.6 + b * 0.8]; });
      const pc = E.pca(pts), mx = E.mean(pts.map(p => p[0])), my = E.mean(pts.map(p => p[1]));
      const v1 = pc.loadings[0], v2 = pc.loadings[1];
      const draw = () => {
        const flat = q(el, 'flat').checked;
        const f = frame(640, 340, [0, 10], [0, 10], { xLabel: 'Column 1', yLabel: 'Column 2' });
        let b = f.axes;
        const l1 = Math.sqrt(pc.explained[0]) * 4.5, l2 = Math.sqrt(pc.explained[1]) * 4.5;
        b += '<line class="arrow" x1="' + f.sx(mx - v1[0] * l1) + '" y1="' + f.sy(my - v1[1] * l1) + '" x2="' + f.sx(mx + v1[0] * l1) + '" y2="' + f.sy(my + v1[1] * l1) + '"/>';
        b += '<line class="arrow second" x1="' + f.sx(mx - v2[0] * l2) + '" y1="' + f.sy(my - v2[1] * l2) + '" x2="' + f.sx(mx + v2[0] * l2) + '" y2="' + f.sy(my + v2[1] * l2) + '"/>';
        pts.forEach(p => {
          const s = (p[0] - mx) * v1[0] + (p[1] - my) * v1[1], px = mx + s * v1[0], py = my + s * v1[1];
          if (flat) b += '<line class="proj" x1="' + f.sx(p[0]) + '" y1="' + f.sy(p[1]) + '" x2="' + f.sx(px) + '" y2="' + f.sy(py) + '"/>' + dot(f.sx(px), f.sy(py), 'pt', 4);
          else b += dot(f.sx(p[0]), f.sy(p[1]), 'pt', 4);
        });
        q(el, 'plot').innerHTML = svg(640, 340, 'PCA directions', b) + C.legend([{ label: 'Main direction (component 1)', cls: 'arrow-key', shape: 'square' }, { label: 'Second direction', cls: 'c6', shape: 'square' }]);
        q(el, 'read').innerHTML = 'The red line is the direction of greatest spread. It alone captures <b>' + pct(pc.explained[0]) + '</b> of the variation. ' + (flat ? 'Flattened onto it, the points keep almost all their story with one number instead of two.' : 'Tick the box to flatten the points onto it.') + ' With 20 columns, PCA does the same: two components can often show most of the picture.';
      };
      q(el, 'flat').onchange = draw; draw();
    },
    steps: ['Standardize the columns.', 'Find the direction of greatest spread: component 1.', 'Find the next one at right angles: component 2.', 'Plot every row on those two directions.'],
    when: 'To see many-column data on one chart, and to spot groups and outliers.',
    watch: 'Components are blends of columns, so they do not have simple names.',
    where: 'The "Groups in the data" scatter in unsupervised results.',
    quiz: { q: 'PCA component 1 captures 85% of the variation. What does that tell you?', options: ['85% of rows are correct', 'One blended direction tells most of the story of how rows differ', 'The model is 85% accurate'], answer: 1, why: 'Explained variation is about how rows spread out, not accuracy.' }
  });

  add({
    id: 'why-doe', group: 'Design of experiments', title: 'Why DOE: correlation is not causation',
    analogy: 'Ice-cream sales and sunburns rise together, but banning ice cream will not prevent sunburn. The sun drives both.',
    intro: 'Historical data shows what moves together. A hidden driver can make two things look linked. In a designed experiment you set the factors yourself, in a balanced pattern and a random order, so hidden drivers cannot ride along. That is how you prove cause and effect.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls"><label><input type="checkbox" data-role="reveal"> Reveal the hidden driver (daily temperature)</label></div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const rand = E.rng(91);
      const days = range(60).map(() => { const t = 10 + rand() * 25; return { t, ice: 20 + t * 4 + normal(rand) * 12, burn: t * 0.6 + normal(rand) * 2.5 }; });
      const r = E.pearson(days.map(d => d.ice), days.map(d => d.burn));
      const draw = () => {
        const rev = q(el, 'reveal').checked;
        const f = frame(640, 320, [40, 170], [0, 25], { xLabel: 'Ice-cream sales', yLabel: 'Sunburn cases' });
        q(el, 'plot').innerHTML = svg(640, 320, 'Spurious correlation', f.axes + days.map(d => dot(f.sx(d.ice), f.sy(d.burn), rev ? (d.t < 18 ? 'heat1' : d.t < 26 ? 'heat2' : 'heat3') : 'dot', 5, 'Temperature ' + d.t.toFixed(0) + '°C')).join('')) +
          (rev ? C.legend([{ label: 'Cool days', cls: 'heat1' }, { label: 'Mild days', cls: 'heat2' }, { label: 'Hot days', cls: 'heat3' }]) : '');
        q(el, 'read').innerHTML = 'Correlation r = <b>' + r.toFixed(2) + '</b>: a strong link. ' + (rev ? 'Coloured by temperature, the truth appears: hot days drive both. In your plant, the "temperature" might be a raw-material lot, a shift or the season.' : 'Does ice cream cause sunburn? Tick the box.');
      };
      q(el, 'reveal').onchange = draw; draw();
    },
    steps: ['Machine learning on history finds candidate drivers fast.', 'But inputs in history move together, and hidden factors lurk.', 'A DOE sets each factor high or low on purpose, independently of the others.', 'Random run order spreads any hidden drift evenly, so it cannot fake an effect.'],
    when: 'Before you change a standard based on what historical data suggests.',
    watch: '"The data says X drives Y" from history alone. Always ask what else changed at the same time.',
    where: 'The agent pre-fills the DOE builder with the drivers it found, so you can confirm them.',
    quiz: { q: 'Historical data shows higher line speed goes with fewer defects. What is the safest next step?', options: ['Raise line speed everywhere', 'Run a designed experiment varying speed on purpose', 'Ignore it'], answer: 1, why: 'Maybe the newest machines are both faster and better. A DOE separates the real cause.' }
  });

  add({
    id: 'factorial', group: 'Design of experiments', title: 'Factorial designs and main effects',
    analogy: 'Testing every combination of settings, like trying every combination of oven temperature, time and recipe, then comparing the averages.',
    intro: 'A 2-level full factorial runs every combination of low and high for each factor. With 3 factors that is 2 × 2 × 2 = 8 runs: the corners of a cube. The main effect of a factor is the average result on its high side minus the average on its low side. Pick a factor to see it.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + ['Temperature', 'Time', 'Catalyst'].map((n, i) => btn('f' + i, 'Effect of ' + n, i ? 'ghost' : 'primary')).join('') + '</div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const runs = D.fullFactorial(3).map(x => ({ x, y: 60 + 6 * x[0] + 1 * x[1] + 3.5 * x[2] + 2 * x[0] * x[2] }));
      const names = ['Temperature', 'Time', 'Catalyst'], lv = [['150°', '180°'], ['30 min', '60 min'], ['A', 'B']];
      let sel = 0;
      const pos = x => [220 + x[0] * 120 + x[1] * 60, 128 - x[2] * 72 - x[1] * 36];
      const draw = () => {
        el.querySelectorAll('[data-role^="f"]').forEach((b, i) => { b.className = 'btn ' + (i === sel ? 'primary' : 'ghost'); });
        let b = '';
        const edges = [];
        runs.forEach((r, i) => runs.forEach((s, j) => { if (j > i && r.x.filter((v, k) => v !== s.x[k]).length === 1) edges.push([pos(r.x), pos(s.x)]); }));
        b += edges.map(e => '<line class="edge" x1="' + e[0][0] + '" y1="' + e[0][1] + '" x2="' + e[1][0] + '" y2="' + e[1][1] + '"/>').join('');
        runs.forEach(r => { const [px, py] = pos(r.x); b += '<g data-tip="' + h(names.map((n, k) => n + ' ' + lv[k][r.x[k] > 0 ? 1 : 0]).join(', ') + '\nYield ' + fmt(r.y)) + '"><circle class="corner ' + (r.x[sel] > 0 ? 'hi' : 'lo') + '" cx="' + px + '" cy="' + py + '" r="20"/><text class="cm-text inv" x="' + px + '" y="' + (py + 4) + '" text-anchor="middle">' + fmt(r.y) + '</text></g>'; });
        b += '<text x="170" y="262" class="lbl-strong">Temperature →</text><text x="12" y="132" class="lbl-strong">Catalyst ↑</text><text x="440" y="40" class="lbl-strong">↗ Time</text>';
        q(el, 'plot').innerHTML = svg(560, 270, '2 to the 3 factorial cube', b) + C.legend([{ label: names[sel] + ' high', cls: 'corner hi' }, { label: names[sel] + ' low', cls: 'corner lo' }]);
        const hi = runs.filter(r => r.x[sel] > 0).map(r => r.y), lo = runs.filter(r => r.x[sel] < 0).map(r => r.y);
        q(el, 'read').innerHTML = 'Average with ' + names[sel] + ' high: (' + hi.map(fmt).join(' + ') + ') ÷ 4 = <b>' + fmt(E.mean(hi)) + '</b><br>Average with ' + names[sel] + ' low: (' + lo.map(fmt).join(' + ') + ') ÷ 4 = <b>' + fmt(E.mean(lo)) + '</b><br>Main effect of ' + names[sel] + ' = <b>' + fmt(E.mean(hi) - E.mean(lo)) + '</b>. Every one of the 8 runs is used for every factor\'s estimate: that is the efficiency of a factorial.';
      };
      [0, 1, 2].forEach(i => { q(el, 'f' + i).onclick = () => { sel = i; draw(); }; });
      draw();
    },
    steps: ['Choose factors and a low and high level for each.', 'Run every combination (2^k runs), in random order.', 'Main effect = average at high − average at low.', 'Interaction effects come from the same runs (next lesson).'],
    when: '2 to 4 factors. With more, use a fraction or a screening design.',
    watch: 'Choose levels far enough apart to see an effect, but within safe limits.',
    where: 'DOE builder: "Full factorial". Results: effects table and main effects plots.',
    quiz: { q: 'How many runs does a 2-level full factorial with 4 factors need (before center points)?', options: ['8', '16', '4'], answer: 1, why: '2 × 2 × 2 × 2 = 16.' }
  });

  add({
    id: 'interactions', group: 'Design of experiments', title: 'Interactions: when factors team up',
    analogy: 'Fertilizer only helps if there is enough water. Salt and sugar each change the taste, and together they change it differently.',
    intro: 'An interaction means the effect of one factor depends on the level of another. On an interaction plot, parallel lines mean no interaction; lines that spread or cross mean the factors work together. One-factor-at-a-time testing misses this entirely.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('s', 'Interaction strength', -1, 1, 0.1, 0) + '</div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const draw = () => {
        const s = Number(q(el, 's').value); setOut(el, 's', s.toFixed(1));
        const y = (f, w) => 20 + 3 * f + 2 * w + 6 * s * f * w;
        C.lines(q(el, 'plot'), [-1, 1].map((w, i) => ({ name: 'Water ' + (w > 0 ? 'high' : 'low'), cls: i ? 's2' : '', points: [-1, 1].map(f => ({ x: f, y: y(f, w), tip: 'Fertilizer ' + (f > 0 ? 'high' : 'low') + ', water ' + (w > 0 ? 'high' : 'low') + ': growth ' + fmt(y(f, w)) })) })),
          { yDomain: [0, 42], xLabel: 'Fertilizer', yLabel: 'Growth', xTickFmt: v => (v > 0 ? 'High' : 'Low'), label: 'Interaction plot' });
        q(el, 'plot').insertAdjacentHTML('beforeend', C.legend([{ label: 'Water low', cls: 'pt' }, { label: 'Water high', cls: 'pt s2' }]));
        const effLow = y(1, -1) - y(-1, -1), effHigh = y(1, 1) - y(-1, 1);
        q(el, 'read').innerHTML = 'Fertilizer adds <b>' + fmt(effLow) + '</b> with low water and <b>' + fmt(effHigh) + '</b> with high water. ' +
          (Math.abs(s) < 0.05 ? 'Same effect either way: parallel lines, no interaction.' : Math.abs(effLow) < 0.5 || Math.sign(effLow) !== Math.sign(effHigh) ? 'The effect flips or vanishes depending on water: a strong interaction. Testing fertilizer alone could give the wrong answer.' : 'The lines are not parallel: the factors interact, so set them together.');
      };
      q(el, 's').oninput = draw; draw();
    },
    steps: ['In a factorial, multiply the coded levels (−1/+1) of two factors to get an interaction column.', 'Its effect is estimated just like a main effect.', 'Plot: one line per level of the second factor.', 'Significant interaction → choose the two settings as a pair.'],
    when: 'Whenever two factors plausibly affect each other (temperature and time, speed and feed).',
    watch: 'If an interaction is strong, a main effect on its own can mislead.',
    where: 'DOE results: "strongest interaction" plot and "Combine" actions in the action plan.',
    quiz: { q: 'On an interaction plot, the two lines are parallel. What does that mean?', options: ['A strong interaction', 'No interaction: each factor acts on its own', 'The experiment failed'], answer: 1, why: 'Parallel lines mean the effect of one factor is the same at both levels of the other.' }
  });

  add({
    id: 'significance', group: 'Design of experiments', title: 'Pareto chart and p-values: signal versus noise',
    analogy: 'Listening for voices on a crackly radio. The p-value asks: if nobody were talking, how often would static sound this loud?',
    intro: 'Every experiment has noise, so every estimated effect wobbles. The Pareto chart ranks effects by how far they stand out from the noise (|t|). Bars past the red line have p < 0.05: noise alone would produce an effect that big less than 5% of the time.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('noise', 'Process noise', 0.5, 8, 0.5, 2) + btn('again', 'Run the experiment again', 'primary') + '</div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const names = ['Temperature', 'Pressure', 'Speed', 'Material', 'Operator', 'Humidity'], truth = [8, 5, 2, 0, 0, 0];
      let seed = 1;
      const draw = () => {
        const nz = Number(q(el, 'noise').value); setOut(el, 'noise', nz);
        const rand = E.rng(seed), se = nz / 2;
        const est = truth.map(t => t + normal(rand) * se);
        const tc = 2.26;
        const items = est.map((e, i) => ({ label: names[i] + (truth[i] ? ' (real)' : ' (no effect)'), value: Math.abs(e / se), text: Math.abs(e / se).toFixed(1), cls: Math.abs(e / se) > tc ? 'hi' : '' })).sort((a, b) => b.value - a.value);
        C.hbar(q(el, 'plot'), items, { min: 0, ref: { value: tc }, label: 'Pareto of effects' });
        const found = est.filter((e, i) => truth[i] && Math.abs(e / se) > tc).length, fake = est.filter((e, i) => !truth[i] && Math.abs(e / se) > tc).length;
        q(el, 'read').innerHTML = 'Three factors truly matter (8, 5 and 2 units). This run detected <b>' + found + ' of 3</b>' + (fake ? ' and raised <b>' + fake + ' false alarm' + (fake > 1 ? 's' : '') + '</b>' : '') + '. Raise the noise and the small real effect (Speed) sinks below the line. The cure: reduce noise, widen the factor levels, or add replicates.';
      };
      q(el, 'noise').oninput = draw; q(el, 'again').onclick = () => { seed++; draw(); };
      draw();
    },
    steps: ['Estimate each effect from the runs.', 'Estimate the noise from replicates or center points (or Lenth\'s method when there are none).', 't = effect ÷ its standard error; the p-value comes from t.', 'p < 0.05 → treat as real. Look at the size too: real but tiny may not be worth acting on.'],
    when: 'Reading any DOE result.',
    watch: 'p > 0.05 does not prove "no effect"; it may mean too much noise. And with many effects, about 1 in 20 can cross the line by luck.',
    where: 'DOE results: Pareto chart and effects table.',
    quiz: { q: 'An effect has p = 0.30. What is the best reading?', options: ['It definitely has no effect', 'The data cannot separate it from noise; it may be absent or too small to see', 'It is 30% important'], answer: 1, why: 'A high p-value means "not proven", not "proven absent".' }
  });

  add({
    id: 'designs', group: 'Design of experiments', title: 'Which design? The shapes of experiments',
    analogy: 'Choosing a map: a quick sketch to find the right neighbourhood (screening), then a detailed street map to find the exact house (response surface).',
    intro: 'Each design is a pattern of points in the factor space. Screening designs use few runs to find the vital few factors. Factorials measure effects and interactions. Response-surface designs add points so you can see curves and find the optimum.',
    demo(el) {
      const kinds = [['full2', 'Full factorial, 2 factors'], ['full3', 'Full factorial, 3 factors'], ['half', 'Half fraction'], ['center', 'With center points'], ['ccd', 'Central composite'], ['bbd', 'Box-Behnken'], ['pb', 'Plackett-Burman']];
      el.innerHTML = '<div class="demo-controls">' + kinds.map((k, i) => btn(k[0], k[1], i ? 'ghost' : 'primary')).join('') + '</div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const info = {
        full2: ['4 runs', 'Every combination of 2 factors. Measures both main effects and their interaction.'],
        full3: ['8 runs', 'The corners of a cube. All main effects and interactions for 3 factors.'],
        half: ['4 runs instead of 8', 'Half of the cube\'s corners, chosen so main effects stay clear. Some interactions get mixed (aliased) with main effects. Good for screening 4 to 6 factors.'],
        center: ['8 + 3 runs', 'Center points (all factors in the middle) check whether the response curves, and give a cheap estimate of noise.'],
        ccd: ['2 factors: 4 + 4 + 3 runs', 'Corners, plus "star" points beyond the edges, plus center points. Fits curves in every direction to find the sweet spot.'],
        bbd: ['3 factors: 12 + 3 runs', 'Points at the middle of each cube edge, plus centers. Never runs all factors at extremes at once: good when corners are unsafe.'],
        pb: ['12 runs for up to 11 factors', 'A screening table of + and − settings. Each column is balanced against every other. Finds the vital few factors cheaply.']
      };
      let sel = 'full2';
      const draw = () => {
        el.querySelectorAll('.demo-controls .btn').forEach(b => { b.className = 'btn ' + (b.getAttribute('data-role') === sel ? 'primary' : 'ghost'); });
        let b = '';
        const sq = (x, y, s) => [[x - s, y + s], [x + s, y + s], [x + s, y - s], [x - s, y - s]];
        const cube = (x, y) => { const p = []; for (const c of D.fullFactorial(3)) p.push([x + c[0] * 80 + c[1] * 40, y - c[2] * 80 - c[1] * 35, c]); return p; };
        const cubeEdges = pts => pts.map((a, i) => pts.map((c, j) => (j > i && a[2].filter((v, k) => v !== c[2][k]).length === 1 ? '<line class="edge" x1="' + a[0] + '" y1="' + a[1] + '" x2="' + c[0] + '" y2="' + c[1] + '"/>' : '')).join('')).join('');
        if (sel === 'pb') {
          const rows = D.plackettBurman(11);
          q(el, 'plot').innerHTML = '<div class="table-scroll"><table class="pm"><thead><tr><th>Run</th>' + range(11).map(i => '<th>F' + (i + 1) + '</th>').join('') + '</tr></thead><tbody>' + rows.map((r, i) => '<tr><td>' + (i + 1) + '</td>' + r.map(v => '<td class="' + (v > 0 ? 'p' : 'm') + '">' + (v > 0 ? '+' : '−') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
        } else {
          if (sel === 'full2' || sel === 'ccd') {
            const pts = sq(280, 120, 70);
            b += '<rect class="edge" x="210" y="50" width="140" height="140"/>' + pts.map(p => '<circle class="corner hi" cx="' + p[0] + '" cy="' + p[1] + '" r="10"/>').join('');
            if (sel === 'ccd') {
              const a = 70 * 1.414;
              b += '<circle class="edge" cx="280" cy="120" r="' + a + '" stroke-dasharray="4 4"/>' + [[280 - a, 120], [280 + a, 120], [280, 120 - a], [280, 120 + a]].map(p => '<circle class="corner star" cx="' + p[0] + '" cy="' + p[1] + '" r="10"/>').join('') + '<circle class="corner mid" cx="280" cy="120" r="10"/>';
            }
          } else {
            const pts = cube(250, 128);
            b += cubeEdges(pts);
            if (sel === 'bbd') {
              pts.forEach((a, i) => pts.forEach((c, j) => { if (j > i && a[2].filter((v, k) => v !== c[2][k]).length === 1) b += '<circle class="corner star" cx="' + (a[0] + c[0]) / 2 + '" cy="' + (a[1] + c[1]) / 2 + '" r="9"/>'; }));
              b += '<circle class="corner mid" cx="250" cy="128" r="9"/>';
            } else {
              pts.forEach(p => { const on = sel !== 'half' || p[2][0] * p[2][1] * p[2][2] > 0; b += '<circle class="corner ' + (on ? 'hi' : '') + '" cx="' + p[0] + '" cy="' + p[1] + '" r="' + (on ? 10 : 6) + '"/>'; });
              if (sel === 'center') b += '<circle class="corner mid" cx="250" cy="128" r="10"/>';
            }
          }
          q(el, 'plot').innerHTML = svg(560, 250, 'Design shape', b) + C.legend([{ label: 'Factorial (corner) runs', cls: 'corner hi' }, { label: 'Star or edge runs', cls: 'corner star' }, { label: 'Center points', cls: 'corner mid' }]);
        }
        q(el, 'read').innerHTML = '<b>' + info[sel][0] + '.</b> ' + info[sel][1];
      };
      kinds.forEach(k => { q(el, k[0]).onclick = () => { sel = k[0]; draw(); }; });
      draw();
    },
    steps: ['Many candidate factors (6+)? Screen with Plackett-Burman or a resolution IV fraction.', '2 to 5 important factors? Full or half factorial with center points.', 'Curvature found? Response surface: central composite, or Box-Behnken if corners are risky.', 'Always randomize the run order; replicate if noise is high.'],
    when: 'The agent recommends one automatically from the number of drivers and whether curvature showed up.',
    watch: 'Small fractions alias effects. Plan a follow-up (fold-over) if an aliased effect looks important.',
    where: 'DOE builder: design selector, run sheet and notes.',
    quiz: { q: 'You have 10 candidate factors and limited budget. Which design first?', options: ['Full factorial (1,024 runs)', 'Plackett-Burman screening (12 runs)', 'Central composite'], answer: 1, why: 'Screen first to find the vital few, then study those in detail.' }
  });

  add({
    id: 'definitive-screening', group: 'Design of experiments', title: 'Definitive screening: a screen you can actually act on',
    analogy: 'A Plackett-Burman screen is an identity parade where two suspects are handcuffed together. Whatever the witness points at, you cannot tell which of the pair did it — and worse, an innocent one can be convicted because his partner was guilty. A definitive screening design un-cuffs them: every main effect stands on its own, separate from every pair.',
    intro: 'Screening designs buy cheapness by confounding: a main effect and some two-factor interaction share a column, so a big reading could be either. Usually you shrug and assume interactions are small. Jones and Nachtsheim showed in 2011 that you no longer have to. For about the same number of runs, a definitive screening design keeps every main effect clear of every two-factor interaction, and runs each factor at its middle setting too, so curvature is visible instead of invisible. Drag the factor count and watch what each design actually confounds.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('k', 'Factors to screen', 5, 12, 1, 8) + '</div><div data-role="bars"></div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const worstAlias = runs => {
        // Largest correlation between any main effect column and any two-factor interaction.
        const k = runs[0].length;
        let worst = 0;
        const norm = v => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
        for (let a = 0; a < k; a++) for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
          if (a === i || a === j) continue;
          const m = runs.map(r => r[a]), x = runs.map(r => r[i] * r[j]);
          const dot = m.reduce((s, v, t) => s + v * x[t], 0);
          const den = norm(m) * norm(x);
          if (den > 1e-12) worst = Math.max(worst, Math.abs(dot / den));
        }
        return worst;
      };
      const draw = () => {
        const k = Number(q(el, 'k').value);
        setOut(el, 'k', k);
        const pb = D.plackettBurman(k);
        const dsd = D.definitiveScreening(k);
        const rows = [
          { label: 'Plackett-Burman', runs: pb.length, worst: worstAlias(pb), curv: false },
          { label: 'Definitive screening', runs: dsd.runs.length, worst: worstAlias(dsd.runs), curv: true }
        ];
        if (k <= 8) { const f = D.fractional(k, k - 4); rows.unshift({ label: 'Fractional (res IV)', runs: f.runs.length, worst: worstAlias(f.runs), curv: false }); }
        C.hbar(q(el, 'bars'), rows.map(r => ({
          label: r.label, value: r.worst, text: r.worst < 1e-9 ? 'none' : r.worst.toFixed(2),
          cls: r.worst < 1e-9 ? 'hi' : ''
        })), { min: 0, max: 1, label: 'Worst confusion between a main effect and a two-factor interaction (0 is clean)' });
        C.hbar(q(el, 'plot'), rows.map(r => ({ label: r.label, value: r.runs, text: r.runs + ' runs' })), { min: 0, max: Math.max.apply(null, rows.map(r => r.runs)) * 1.15, label: 'Runs required' });
        const d = rows.find(r => r.curv), p = rows.find(r => r.label === 'Plackett-Burman');
        q(el, 'read').innerHTML = 'With <b>' + k + '</b> factors, the definitive screening design needs <b>' + d.runs + '</b> runs against Plackett-Burman’s <b>' + p.runs + '</b> — and its main effects are <b>completely clean</b> of two-factor interactions, where Plackett-Burman’s are confounded at up to <b>' + p.worst.toFixed(2) + '</b>.' +
          '<br>A correlation of ' + p.worst.toFixed(2) + ' means that column is partly measuring an interaction rather than the factor you named. If the interaction is real and you act on the main effect, you change the wrong setting.' +
          '<br>The definitive design also runs every factor at its midpoint, so it can tell you the best setting is <i>inside</i> your range. A two-level screen is blind to that by construction: with only the ends measured, every factor looks like a straight line.';
      };
      q(el, 'k').oninput = draw; draw();
    },
    steps: ['Build a conference matrix: zero on the diagonal, plus or minus one elsewhere, columns at right angles.', 'Stack it with its own mirror image (every sign flipped). That foldover is what makes main effects immune to two-factor interactions.', 'Add one run at the centre of everything. Runs needed: about twice the number of factors, plus one.', 'Analyse main effects first, then look for curvature, then treat any interaction as a lead rather than a finding.'],
    when: 'Screening four or more factors when you suspect interactions or an optimum inside the range — which in process development is most of the time.',
    watch: 'Two-factor interactions are clean of main effects but not fully separable from each other, so a large interaction tells you to run a follow-up, not what to change. The design needs numeric factors, since it uses three levels of each. And it is a screen: a response-surface design is still the right tool once you know which few factors matter.',
    where: 'Pick "Definitive screening design" in the DOE builder. The agent proposes it automatically for more than eight factors.',
    quiz: { q: 'A Plackett-Burman screen on 8 factors flags factor D as large. What can you conclude?', options: ['D matters and should be changed', 'D matters, or some two-factor interaction confounded with D matters, and you cannot tell which', 'D does not matter'], answer: 1, why: 'In a Plackett-Burman design each main effect column is partly correlated with two-factor interactions. A large reading on D could be D, or an interaction that happens to share that column. A definitive screening design removes this ambiguity for the same sort of run count.' }
  });

  add({
    id: 'mixture-designs', group: 'Design of experiments', title: 'Mixture designs: when the factors have to add up',
    analogy: 'A recipe, not a control panel. On a control panel you can turn the temperature dial without touching anything else. In a recipe you cannot add more flour without every other ingredient becoming a smaller share of the loaf. The usual experimental designs assume dials. A formulation has no dials, and that single fact changes both the design and the model.',
    intro: 'Buffer, sugar, surfactant and water make up one formulation, so their percentages always sum to 100. Try a factorial design on them and you ask for runs that do not exist; try the usual regression and the arithmetic fails outright, because with a fixed sum the intercept cannot be told apart from the components. The space of possible blends is a triangle (for three components) and the designs live inside it. Drag the limits below and watch the formulable region shrink.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('minA', 'Minimum of A (%)', 0, 50, 5, 20) + slider('maxC', 'Maximum of C (%)', 10, 100, 5, 40) + '</div><div class="demo-grid"><div><h4>Even lattice across everything</h4><div data-role="lat"></div></div><div><h4>Corners of what is actually formulable</h4><div data-role="ev"></div></div></div><p class="demo-read" data-role="read"></p>';
      // Barycentric coordinates: a triangle is the honest picture of a three-part blend.
      const tri = (role, pts, label) => {
        const W = 300, H = 268, pad = 34;
        const sx = (a, b, c) => pad + (b + c / 2) * (W - 2 * pad);
        const sy = (a, b, c) => H - pad - c * Math.sqrt(3) / 2 * (W - 2 * pad);
        let s = '';
        const corners = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        s += '<path class="simplex" d="' + corners.map((p, i) => (i ? 'L' : 'M') + sx.apply(null, p).toFixed(1) + ' ' + sy.apply(null, p).toFixed(1)).join('') + 'Z"/>';
        ['A', 'B', 'C'].forEach((n, i) => {
          const p = corners[i];
          s += '<text class="lbl-strong" x="' + sx.apply(null, p) + '" y="' + (sy.apply(null, p) + (i === 2 ? -10 : 18)) + '" text-anchor="middle">' + n + '</text>';
        });
        pts.forEach(p => { s += dot(sx.apply(null, p), sy.apply(null, p), 'c1', 5, 'A ' + Math.round(p[0] * 100) + '%, B ' + Math.round(p[1] * 100) + '%, C ' + Math.round(p[2] * 100) + '%'); });
        q(el, role).innerHTML = svg(W, H, label, s) + '<p class="hint">' + pts.length + ' blends</p>';
      };
      const draw = () => {
        const minA = Number(q(el, 'minA').value) / 100, maxC = Number(q(el, 'maxC').value) / 100;
        setOut(el, 'minA', (minA * 100).toFixed(0)); setOut(el, 'maxC', (maxC * 100).toFixed(0));
        tri('lat', D.simplexLattice(3, 3), 'Simplex lattice across the whole triangle');
        let ev = null, msg = '';
        try { ev = D.extremeVertices([minA, 0, 0], [1, 1, maxC], { centroid: true }); }
        catch (e) { msg = e.message; }
        if (ev) tri('ev', ev.points, 'Extreme vertices of the bounded region');
        else q(el, 'ev').innerHTML = '<p class="hint">' + h(msg) + '</p>';
        const outside = D.simplexLattice(3, 3).filter(p => p[0] < minA - 1e-9 || p[2] > maxC + 1e-9).length;
        q(el, 'read').innerHTML = 'Every point in both pictures is a blend adding to 100%. ' +
          (ev ? 'With A held at <b>' + (minA * 100).toFixed(0) + '%</b> or more and C capped at <b>' + (maxC * 100).toFixed(0) + '%</b>, the formulable region has <b>' + ev.vertices + ' corners</b>, and those corners are where the information is.' : h(msg)) +
          '<br><b>' + outside + ' of the 10</b> even-lattice blends on the left break those limits — they are not formulations anyone could make. That is why a bounded formulation needs the extreme-vertices layout rather than a tidy lattice.' +
          '<br>Notice what is missing from both pictures: a centre point in the factorial sense. There is no "all factors at mid-level" blend to return to, because the components are not free to move independently.';
      };
      ['minA', 'maxC'].forEach(k => { q(el, k).oninput = draw; });
      draw();
    },
    steps: ['List the components and the realistic minimum and maximum percentage of each.', 'Pick the layout: a simplex lattice or simplex centroid design if any blend is allowed, extreme vertices if the components have real upper and lower limits.', 'Run the blends and measure the response.', 'Fit a Scheffé model, which has no intercept. Each component’s coefficient is the response from that component alone; a cross term says whether a pair beats the straight average of the two.'],
    when: 'Formulation and buffer development, excipient screening, media and feed composition, anything where the answer is a recipe rather than a set of machine settings.',
    watch: 'The ordinary factorial analysis is not merely inaccurate here, it is undefined: with the components summing to a constant the design matrix is singular and an intercept cannot exist. Also, a model fitted inside the formulable region says nothing outside it, and with tight limits that region can be small — so resist reading the coefficients as if a pure component had been tested when it never was.',
    where: 'Pick one of the three "Mixture" designs in the DOE builder; paste the finished run sheet back in underneath to fit the blending model.',
    quiz: { q: 'Why does a mixture model have no intercept?', options: ['Because the response is always positive', 'Because the components sum to a constant, so a constant term cannot be distinguished from the components themselves', 'Because mixture designs have no centre point'], answer: 1, why: 'With x1 + x2 + ... + xq = 1, the column of ones is exactly the sum of the component columns. An intercept would be perfectly collinear with them, so it cannot be estimated — and it is not needed: each component coefficient already carries the level of the response.' }
  });

  add({
    id: 'curvature', group: 'Design of experiments', title: 'Center points and curvature',
    analogy: 'Measuring a bridge only at both ends tells you nothing about whether it sags in the middle.',
    intro: 'A 2-level design only sees the ends of each factor\'s range, so it assumes straight lines between them. Center points measure the middle. If the middle result differs from what the straight line predicts, the response curves, and the optimum may lie inside the range.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('c', 'True curvature', -8, 8, 0.5, 4) + '</div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const draw = () => {
        const c = Number(q(el, 'c').value); setOut(el, 'c', c);
        const y = x => 50 + 6 * x + c * (1 - x * x);
        const f = frame(640, 300, [-1.2, 1.2], [30, 70], { xLabel: 'Factor level (low → center → high)', yLabel: 'Result', xFmt: v => (v === -1 ? 'low' : v === 1 ? 'high' : v === 0 ? 'center' : '') });
        const line = 50, mid = y(0);
        q(el, 'plot').innerHTML = svg(640, 300, 'Curvature check', f.axes + '<path class="curve alt" d="' + pathOf([[-1, y(-1)], [1, y(1)]], f) + '"/><path class="curve" d="' + pathOf(range(61).map(i => { const x = -1.2 + i * 0.04; return [x, y(x)]; }), f) + '"/>' +
          '<line class="ref" x1="' + f.sx(0) + '" x2="' + f.sx(0) + '" y1="' + f.sy(line) + '" y2="' + f.sy(mid) + '"/>' + dot(f.sx(-1), f.sy(y(-1)), 'corner hi', 8) + dot(f.sx(1), f.sy(y(1)), 'corner hi', 8) + dot(f.sx(0), f.sy(mid), 'corner mid', 8)) +
          C.legend([{ label: 'Corner runs', cls: 'corner hi' }, { label: 'Center point', cls: 'corner mid' }, { label: 'True response', cls: 'pt', shape: 'square' }]);
        q(el, 'read').innerHTML = 'The straight line through the corners predicts <b>' + fmt(line) + '</b> at the center; the center point measures <b>' + fmt(mid) + '</b>. Gap = <b>' + fmt(mid - line) + '</b>. ' + (Math.abs(mid - line) > 2 ? 'That is curvature: a response-surface design (central composite) is the next step.' : 'Little curvature: straight-line effects describe the process well.');
      };
      q(el, 'c').oninput = draw; draw();
    },
    steps: ['Add 3 to 5 runs with every factor at its midpoint.', 'Compare their average with the average of the corner runs.', 'A clear gap means curvature: some factor has a sweet spot.', 'Center points also measure pure noise, because they are true replicates.'],
    when: 'Almost always: they are cheap insurance on any 2-level design with numeric factors.',
    watch: 'Center points show that curvature exists, but not which factor causes it. A response-surface design pins that down.',
    where: 'DOE results: "Curvature" term and the curvature finding.',
    quiz: { q: 'Center points average 72, corner runs average 65. What does this suggest?', options: ['An error in the data', 'Curvature: the best setting may be inside the range', 'No effect of any factor'], answer: 1, why: 'The middle beats the straight-line prediction, so the response bends.' }
  });

  add({
    id: 'randomization', group: 'Design of experiments', title: 'Randomization, blocking and replication',
    analogy: 'Tasting a soup while someone slowly adds salt. Taste the low-temperature batches in the morning and the high ones in the afternoon, and you will credit the temperature with everything the salt did.',
    intro: 'A designed experiment is not only a set of factor settings; it is also an order and a structure. Three devices protect it. Randomizing the run order stops anything that drifts with time from being credited to a factor. Blocking takes a nuisance you know about - day, operator, raw-material lot - out of the comparison on purpose. Replication measures the noise, which is what every p-value is divided by.',
    demo(el) {
      el.innerHTML = '<div class="demo-grid"><div><h4>Runs in a tidy order</h4><div data-role="s"></div></div><div><h4>Runs randomized</h4><div data-role="r"></div></div></div>' +
        '<div class="demo-controls">' + slider('drift', 'Drift per run (units)', 0, 0.4, 0.02, 0.2) + btn('again', 'New noise', 'ghost') + '</div><p class="demo-read" data-role="read"></p>';
      let seed = 3;
      const draw = () => {
        const drift = Number(q(el, 'drift').value);
        setOut(el, 'drift', drift.toFixed(2));
        const n = 16, TRUE = 2;
        const est = (order, rand) => {
          const y = order.map((lvl, pos) => 100 + TRUE * lvl + drift * pos + normal(rand) * 0.8);
          const hi = y.filter((_, i) => order[i] > 0), lo = y.filter((_, i) => order[i] < 0);
          return { y, eff: E.mean(hi) - E.mean(lo) };
        };
        const sorted = range(n).map(i => (i < n / 2 ? -1 : 1));
        const shuffled = E.shuffle(sorted.slice(), E.rng(seed));
        // Same noise sequence for both panels, so the only difference on screen is the run order.
        const a = est(sorted, E.rng(seed)), b = est(shuffled, E.rng(seed));
        const panel = (role, order, res, label) => {
          const f = frame(300, 220, [-0.5, n - 0.5], [99, 100 + TRUE + drift * n + 2], { l: 38, b: 32, xLabel: 'Run order' });
          q(el, role).innerHTML = svg(300, 220, label, f.axes +
            res.y.map((v, i) => dot(f.sx(i), f.sy(v), order[i] > 0 ? 'c2' : 'c1', 4.5, (order[i] > 0 ? 'High' : 'Low') + ' setting, run ' + (i + 1), order[i] > 0 ? 'square' : 'circle')).join('')) +
            '<p class="demo-read">Effect of the factor comes out at <b>' + fmt(res.eff) + '</b> (the truth is ' + TRUE + ').</p>';
        };
        panel('s', sorted, a, 'All low runs first, then all high');
        panel('r', shuffled, b, 'Settings randomized across the run order');
        q(el, 'read').innerHTML = 'The factor really is worth ' + TRUE + ' units. Something in the background also drifts by ' + drift.toFixed(2) +
          ' units per run - a reagent ageing, a column fouling, an operator getting quicker. ' +
          'Run all the low settings first and the drift lands entirely on the factor: the estimate comes out at <b>' + fmt(a.eff) + '</b>, inflated by about ' + fmt(drift * n / 2) +
          ' units of pure confounding, and no amount of replication fixes it because the bias is in the design. ' +
          'Randomize and the estimate comes out at <b>' + fmt(b.eff) + '</b>: the drift is still there, but it now lands on both settings about equally, so it goes into the noise rather than into the answer. Noisier, and honest.';
      };
      q(el, 'drift').oninput = draw;
      q(el, 'again').onclick = () => { seed += 7; draw(); };
      draw();
    },
    steps: ['Randomize the run order unless something makes it impossible, and record the order you actually ran.', 'Block what you know about and cannot avoid: run the whole design once per day, or once per lot, and let the analysis remove the block.', 'Replicate genuine runs - not repeat measurements of one run - so the noise estimate is the noise the next run will see.', 'Keep centre points sprinkled through the order: they check for both curvature and drift at once.'],
    when: 'Every designed experiment. It costs nothing but a shuffled run sheet.',
    watch: 'Hard-to-change factors tempt everyone into running them in blocks. That is a split-plot design and needs to be analysed as one - the easy-to-change factors get a different noise estimate from the hard-to-change ones.',
    where: 'The run sheet the DOE tool generates is randomized, with the standard order kept beside it so you can see what was shuffled, and centre points distributed rather than bunched at the end.',
    quiz: { q: 'Your 16-run design was executed low-setting-first because it saved two changeovers. The factor looks hugely significant. What do you actually know?', options: ['The factor has a large effect, confirmed by the p-value', 'Nothing separable: any drift over the 16 runs has been credited to the factor', 'The effect is real but smaller than estimated'], answer: 1, why: 'The design has confounded the factor with run order, so the estimate is the factor plus whatever drifted - and the data holds no way to split them. The p-value is small and meaningless. Re-running in a randomized order is the only fix, which is why the order is part of the design and not an administrative detail.' }
  });

  add({
    id: 'response-surface', group: 'Design of experiments', title: 'Response surfaces: from "which way is uphill" to "where is the top"',
    analogy: 'A two-level factorial is a compass: it tells you which direction improves things. A response surface design is a contour map: it shows you where the summit is and how flat the ground is around it.',
    intro: 'A two-level design fits straight lines, so it can only ever say "more of this is better". That is the right answer while you are far from the optimum and the wrong answer once you are near it, because near a peak every slope is near zero. Adding points in the middle and beyond the edges lets a curved model be fitted, and a curved model has a top.',
    demo(el) {
      const DESIGNS = [['fac', '4 corners only'], ['cen', 'Corners + centre points'], ['ccd', 'Central composite (corners, stars, centre)']];
      el.innerHTML = '<div class="demo-controls">' + DESIGNS.map((d, i) => btn(d[0], d[1], i ? 'ghost' : 'primary')).join('') + '</div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      // The truth: a dome with its peak inside the design space, deliberately off centre.
      const PEAK = [0.35, -0.45];
      const truth = (a, b) => 92 + 6 * (1 - Math.pow(a - PEAK[0], 2) - 0.8 * Math.pow(b - PEAK[1], 2));
      const show = sel => {
        el.querySelectorAll('.demo-controls .btn').forEach(b => { b.className = 'btn ' + (b.getAttribute('data-role') === sel ? 'primary' : 'ghost'); });
        const rand = E.rng(19);
        let pts = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
        if (sel === 'cen') pts = pts.concat([[0, 0], [0, 0], [0, 0]]);
        if (sel === 'ccd') { const a = 1.414; pts = pts.concat([[-a, 0], [a, 0], [0, -a], [0, a], [0, 0], [0, 0], [0, 0]]); }
        const y = pts.map(p => truth(p[0], p[1]) + normal(rand) * 0.25);
        const quad = sel === 'ccd';
        const design = p => (quad ? [p[0], p[1], p[0] * p[0], p[1] * p[1], p[0] * p[1]] : [p[0], p[1]]);
        const m = E.fitRidgeCore(pts.map(design), y, 1e-8);
        const fit = (a, b) => m.predict([design([a, b])])[0];
        // Best setting the fitted model can offer, searched on a fine grid over the studied range.
        let best = null;
        for (let a = -1.4; a <= 1.4; a += 0.05) for (let b = -1.4; b <= 1.4; b += 0.05) { const v = fit(a, b); if (!best || v > best[2]) best = [a, b, v]; }
        const f = frame(420, 330, [-1.6, 1.6], [-1.6, 1.6], { l: 42, b: 36, xLabel: 'Factor A (coded)', yLabel: 'Factor B (coded)' });
        let heat = '';
        const g = 26, lo = 86, hi = 99;
        for (let i = 0; i < g; i++) for (let j = 0; j < g; j++) {
          const a = -1.6 + 3.2 * (i + 0.5) / g, b = -1.6 + 3.2 * (j + 0.5) / g;
          const o = Math.max(0, Math.min(1, (fit(a, b) - lo) / (hi - lo)));
          heat += '<rect class="bar" fill-opacity="' + o.toFixed(2) + '" x="' + f.sx(-1.6 + 3.2 * i / g) + '" y="' + f.sy(-1.6 + 3.2 * (j + 1) / g) + '" width="' + (f.sx(3.2 / g) - f.sx(0)) + '" height="' + (f.sy(0) - f.sy(3.2 / g)) + '"/>';
        }
        q(el, 'plot').innerHTML = svg(420, 330, 'Fitted surface with the design points on it', heat + f.axes +
          pts.map(p => dot(f.sx(p[0]), f.sy(p[1]), 'c1', 5)).join('') +
          dot(f.sx(PEAK[0]), f.sy(PEAK[1]), 'c3', 7, 'The true optimum', 'square') +
          dot(f.sx(best[0]), f.sy(best[1]), 'c2', 6, 'Where the fitted model says to go')) +
          C.legend([{ label: 'Runs in the design', cls: 'c1' }, { label: 'The true optimum', cls: 'c3', shape: 'square' }, { label: 'Optimum the model found', cls: 'c2' }]);
        const miss = Math.sqrt(Math.pow(best[0] - PEAK[0], 2) + Math.pow(best[1] - PEAK[1], 2));
        q(el, 'read').innerHTML = (quad
          ? 'A quadratic model can be fitted, so the shaded surface has a dome and a top. The model puts the optimum <b>' + fmt(miss) +
            ' coded units</b> from the truth, and the response it predicts there is <b>' + fmt(best[2]) + '</b> against a true best of ' + fmt(truth(PEAK[0], PEAK[1])) + '.'
          : sel === 'cen'
            ? 'The centre points now tell you the surface is curved - they sit well above what the straight-line fit through the corners predicts for the middle - but four corners plus a centre cannot say <i>where</i> the curve peaks. The model can detect curvature and not locate it. That is the moment to add star points.'
            : 'Four corners can only fit a plane, so the shaded surface is a ramp and its best point sits at the edge of whatever region you search - here <b>' + fmt(miss) +
              ' coded units</b> from the real optimum. Nothing is wrong with the arithmetic; a plane has no top, so the answer will always be "go further in that direction".') +
          ' Box-Behnken is the same idea at three factors or more, with no run at the extreme of every factor at once - which matters when the corners are unsafe or infeasible.';
      };
      DESIGNS.forEach(d => { q(el, d[0]).onclick = () => show(d[0]); });
      show('fac');
    },
    steps: ['Screen first: find the few factors that matter, with a two-level or definitive screening design.', 'Add centre points to ask whether the response is curved. If the centre sits off the plane through the corners, it is.', 'If it curves, augment to a response-surface design and fit the quadratic terms: a central composite, a face-centred central composite when the star points must stay inside the range you can actually run, or a Box-Behnken when no factor may sit at its extreme while another does.', 'Read the optimum off the fitted surface, then confirm it with runs at that setting. A predicted optimum is a hypothesis.'],
    when: 'Once screening has reduced the problem to two to four factors and the goal has changed from "which factors" to "what settings".',
    watch: 'A quadratic model is only trustworthy inside the region you studied. The maximum of a fitted parabola can sit outside the design space, where the parabola is pure extrapolation - the tool marks the studied range on every response curve for exactly this reason.',
    where: 'The DOE tool generates central composite and Box-Behnken designs, fits the quadratic model, and reports the optimum with the desirability score when several responses have to be satisfied at once.',
    quiz: { q: 'Your factorial says "increase both factors", you do, and yield falls. What most likely happened?', options: ['The experiment was run badly', 'You were already near the top of a curved surface, where a straight-line model always points outward', 'The factors interact'], answer: 1, why: 'A plane fitted near a peak slopes gently in whatever direction the noise favours, and its best point is always a corner. This is the standard signal to add centre and star points and fit curvature, not to repeat the factorial.' }
  });

  add({
    id: 'multiplicity', group: 'Design of experiments', title: 'Testing twenty things at once',
    analogy: 'Twenty slot machines, each paying out one time in twenty. Pull every lever once, expect roughly one win - and do not call it skill.',
    intro: 'A p-value threshold of 0.05 accepts a one-in-twenty chance of crying wolf. Test one factor and that is a reasonable bargain. Test twenty, and crying wolf once is the expected outcome even when nothing whatever is going on. Every screening design and every driver ranking tests many things at once, so the correction is not optional bookkeeping.',
    demo(el) {
      el.innerHTML = '<div data-role="plot"></div><div class="demo-controls">' + slider('real', 'Factors that really matter', 0, 5, 1, 0) +
        btn('again', 'Run another screen', 'primary') + '</div><p class="demo-read" data-role="read"></p>';
      let seed = 2;
      const draw = () => {
        const real = Number(q(el, 'real').value);
        setOut(el, 'real', real);
        const m = 20, n = 24, rand = E.rng(seed);
        const rows = range(m).map(k => {
          const lvl = range(n).map((_, i) => (i % 2 ? 1 : -1));
          const eff = k < real ? 1.4 : 0;
          const y = lvl.map(l => 100 + eff * l + normal(rand) * 1.2);
          const hi = y.filter((_, i) => lvl[i] > 0), lo = y.filter((_, i) => lvl[i] < 0);
          const se = Math.sqrt(E.variance(hi) / hi.length + E.variance(lo) / lo.length);
          const t = (E.mean(hi) - E.mean(lo)) / se;
          return { k, real: k < real, p: E.tTestP(t, n - 2) };
        }).sort((a, b) => a.p - b.p);
        // Benjamini-Hochberg: the largest rank whose p is below (rank / m) * alpha passes, and everything above it in the ranking passes with it.
        const alpha = 0.05;
        let cut = -1;
        rows.forEach((r, i) => { if (r.p <= (i + 1) / m * alpha) cut = i; });
        const f = frame(640, 260, [0.5, m + 0.5], [0, 1], { l: 46, b: 36, xLabel: 'Factors, ranked by p-value', yLabel: 'p-value' });
        q(el, 'plot').innerHTML = svg(640, 260, 'Twenty p-values with both thresholds', f.axes +
          '<path class="ref" d="' + pathOf([[0.5, alpha], [m + 0.5, alpha]], f) + '"/>' +
          '<text class="lbl-strong" x="' + f.sx(m + 0.2) + '" y="' + (f.sy(alpha) - 6) + '" text-anchor="end">0.05 for each test</text>' +
          '<path class="line s2" d="' + pathOf(range(m).map(i => [i + 1, (i + 1) / m * alpha]), f) + '"/>' +
          '<text class="lbl-strong" x="' + f.sx(m * 0.62) + '" y="' + (f.sy(0.62 * alpha) - 8) + '">Benjamini-Hochberg line</text>' +
          rows.map((r, i) => dot(f.sx(i + 1), f.sy(r.p), r.real ? 'c3' : 'c2', 5, 'Factor ' + (r.k + 1) + (r.real ? ' (really matters)' : ' (nothing there)') + ', p = ' + fmt(r.p), r.real ? 'square' : 'circle')).join('')) +
          C.legend([{ label: 'Factor with a real effect', cls: 'c3', shape: 'square' }, { label: 'Factor with no effect at all', cls: 'c2' }]);
        const naive = rows.filter(r => r.p <= alpha), bh = rows.slice(0, cut + 1);
        const falseNaive = naive.filter(r => !r.real).length, falseBh = bh.filter(r => !r.real).length;
        q(el, 'read').innerHTML = 'Twenty factors screened, <b>' + real + '</b> of which really matter. ' +
          'Take every p below 0.05 and you flag <b>' + naive.length + '</b> factors, <b>' + falseNaive + '</b> of them pure noise. ' +
          'Benjamini-Hochberg compares the <i>k</i>th smallest p against <i>k</i>/20 &times; 0.05 instead - the sloping line - and flags <b>' + bh.length +
          '</b>, <b>' + falseBh + '</b> of them noise. ' +
          (real === 0 ? 'With nothing real at all, the plain threshold still finds something to chase about as often as not, and that is the whole problem: the next experiment gets spent on it. '
            : 'It keeps the real ones and drops most of the false ones, because a genuinely tiny p-value clears even the lowest rung of the sloping line. ') +
          'Press the button a few times and watch how often the plain threshold hands you a factor that does not exist.';
      };
      q(el, 'real').oninput = draw;
      q(el, 'again').onclick = () => { seed += 11; draw(); };
      draw();
    },
    steps: ['Count how many tests you are actually doing. A 20-factor screen is 20 tests, and adding interactions multiplies that.', 'Rank the p-values smallest to largest.', 'Benjamini-Hochberg: find the largest rank k whose p-value is below k/m times your level, and declare that one and everything ranked above it.', 'This controls the false discovery rate - the share of your flagged factors that are wrong - rather than the chance of any error at all, which is the trade you usually want on a screen.'],
    when: 'Any time more than a handful of effects are tested from one dataset: screening designs, driver rankings, many-response studies.',
    watch: 'Bonferroni - dividing 0.05 by the number of tests - controls errors more strictly and finds far less. On a screen whose purpose is to generate candidates, that is usually the wrong trade. Neither correction rescues you from testing until something passes.',
    where: 'The DOE effect p-values are Benjamini-Hochberg corrected, and the driver ranking is checked against a shuffled-target noise floor, which is the same idea by simulation rather than by formula.',
    quiz: { q: 'A 20-factor screen flags three factors at p < 0.05: p = 0.002, 0.031 and 0.047. Which survive Benjamini-Hochberg at 0.05?', options: ['All three', 'Only p = 0.002', 'None'], answer: 1, why: 'The thresholds are 1/20 x 0.05 = 0.0025, 2/20 x 0.05 = 0.005 and 3/20 x 0.05 = 0.0075. Only 0.002 clears its rung, so only it survives. The other two are exactly the kind of near-threshold result that twenty tests produce for free - worth a cheap confirmation run, not a process change.' }
  });

  add({
    id: 'capability', group: 'Six Sigma and process control', title: 'Process capability: Cp, Cpk and sigma level',
    analogy: 'Parking a car in a garage. Cp asks: is the car narrower than the garage? Cpk asks: is it parked in the middle, or scraping one wall?',
    intro: 'Capability compares what the customer allows (the spec limits) with what the process actually does (its spread). Move the process average and its spread below and watch the numbers. The red tails are defects.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('mu', 'Process average', 92, 108, 0.5, 103) + slider('sd', 'Process spread (std. dev.)', 0.8, 5, 0.1, 2.5) + '</div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const LSL = 90, USL = 110, T = 100;
      const draw = () => {
        const mu = Number(q(el, 'mu').value), sdv = Number(q(el, 'sd').value);
        setOut(el, 'mu', mu); setOut(el, 'sd', sdv.toFixed(1));
        const f = frame(640, 290, [80, 120], [0, 0.52], { xLabel: 'Measured value', yFmt: () => '' });
        const pdf = x => Math.exp(-((x - mu) ** 2) / (2 * sdv * sdv)) / (sdv * Math.sqrt(2 * Math.PI));
        const xs = range(241).map(i => 80 + i / 6);
        const area = (a, b) => 'M' + f.sx(a) + ' ' + f.sy(0) + xs.filter(x => x >= a && x <= b).map(x => 'L' + f.sx(x).toFixed(1) + ' ' + f.sy(pdf(x)).toFixed(1)).join('') + 'L' + f.sx(b) + ' ' + f.sy(0) + 'Z';
        let b = f.axes + '<path class="region-c2" fill-opacity=".55" d="' + area(80, LSL) + '"/><path class="region-c2" fill-opacity=".55" d="' + area(USL, 120) + '"/>';
        b += '<path class="curve" d="' + pathOf(xs.map(x => [x, pdf(x)]), f) + '"/>';
        [['LSL', LSL, 'ref'], ['USL', USL, 'ref'], ['Target', T, 'target-line']].forEach(([l, v, c]) => { b += '<line class="' + c + '" x1="' + f.sx(v) + '" x2="' + f.sx(v) + '" y1="' + f.sy(0) + '" y2="' + f.sy(0.5) + '"/><text class="lbl-strong" x="' + f.sx(v) + '" y="' + (f.sy(0.5) - 2) + '" text-anchor="middle">' + l + '</text>'; });
        q(el, 'plot').innerHTML = svg(640, 290, 'Capability demo', b);
        const S = window.MLSpc, cp = (USL - LSL) / (6 * sdv), cpk = Math.min(USL - mu, mu - LSL) / (3 * sdv);
        const pOut = S.normCdf((LSL - mu) / sdv) + 1 - S.normCdf((USL - mu) / sdv), z = Math.min(8, S.normInv(1 - Math.max(pOut, 1e-15)));
        const verdict = cpk >= 1.33 ? 'capable' : cpk >= 1 ? 'marginal' : 'not capable';
        q(el, 'read').innerHTML = 'Cp <b>' + cp.toFixed(2) + '</b> · Cpk <b>' + cpk.toFixed(2) + '</b> (' + verdict + ') · expected <b>' + fmt(pOut * 1e6, 0) + '</b> defects per million · sigma level <b>' + (z + 1.5).toFixed(1) + '</b><br>' +
          (cp - cpk > 0.2 ? 'The car fits, but it is parked off center: Cp is fine while Cpk suffers. Center the average at 100 and Cpk rises to Cp.' : cp < 1.33 ? 'Centered, but the car is too wide for the garage: only reducing the spread will make it capable.' : 'Narrow and centered: plenty of room on both sides.');
      };
      q(el, 'mu').oninput = draw; q(el, 'sd').oninput = draw; draw();
    },
    steps: ['Cp = (USL − LSL) ÷ 6σ: does the spread fit inside the spec window?', 'Cpk = distance from the average to the nearer limit ÷ 3σ: does it fit where it actually sits?', 'Cp/Cpk use short-term spread (row to row); Pp/Ppk use the overall, long-term spread.', '1.33 or more is capable; below 1.0 means a steady stream of defects. PPM and sigma level express the same thing as a defect rate.'],
    when: 'Any measured result with specification limits, on a stable process in normal production.',
    watch: 'Capability assumes the process is stable (check the control chart first) and roughly bell-shaped. A designed experiment is not normal production.',
    where: 'Six Sigma mode: the "Process capability" card and the capability tile.',
    quiz: { q: 'Cp is 1.8 but Cpk is 0.9. What is the quickest fix?', options: ['Reduce variation', 'Center the process average', 'Widen the spec limits'], answer: 1, why: 'A big gap between Cp and Cpk means the spread fits but the process is off center. Centering it raises Cpk toward Cp.' }
  });

  add({
    id: 'control-charts', group: 'Six Sigma and process control', title: 'Control charts: common cause or special cause?',
    analogy: 'Your commute: it varies a few minutes every day (common cause). A road closure is different (special cause). A control chart tells the two apart, so you do not overreact to normal noise or miss a real problem.',
    intro: 'An I-MR chart plots each value in time order with control limits at about 3 standard deviations. Inside the limits is everyday noise. Add a disruption below and watch the chart flag it.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls"><label><input type="checkbox" data-role="shift"> Process shift from point 25</label><label><input type="checkbox" data-role="spike"> One-off spike at point 12</label>' + btn('new', 'New data', 'ghost') + '</div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      let seed = 3;
      const draw = () => {
        const rand = E.rng(seed);
        const base = range(40).map(() => 50 + normal(rand) * 1.5);
        const y = base.map((v, i) => v + (q(el, 'shift').checked && i >= 24 ? 2.2 : 0) + (q(el, 'spike').checked && i === 11 ? 7 : 0));
        // Limits from the first 20 points, as a team would set them from a stable baseline.
        const base20 = window.MLSpc.imr(y.slice(0, 20));
        const lim = { cl: base20.cl, ucl: base20.ucl, lcl: base20.lcl };
        const flags = y.map((v, i) => { const f = []; if (v > lim.ucl || v < lim.lcl) f.push('beyond limits'); return f; });
        let run = 0, side = 0;
        y.forEach((v, i) => { const sd0 = v > lim.cl ? 1 : -1; run = sd0 === side ? run + 1 : 1; side = sd0; if (run >= 8) flags[i].push('8 in a row on one side'); });
        C.controlChart(q(el, 'plot'), y, Object.assign({ flags, rowLabel: i => 'Point ' + (i + 1), yLabel: 'Value', xLabel: 'Point (time order)', label: 'Individuals chart demo' }, lim));
        const n = flags.filter(f => f.length).length;
        q(el, 'read').innerHTML = n ? '<b>' + n + ' point' + (n > 1 ? 's' : '') + ' flagged.</b> ' + (q(el, 'shift').checked ? 'A shift shows up as a long run on one side of the center line, even when no single point crosses a limit. ' : '') + (q(el, 'spike').checked ? 'A one-off spike breaks the limit: find out what happened at that moment.' : '')
          : 'No signals: the wiggle you see is common-cause noise. Reacting to it (tampering) would make the process worse. Tick a box to add a real disruption.';
      };
      q(el, 'shift').onchange = draw; q(el, 'spike').onchange = draw; q(el, 'new').onclick = () => { seed++; draw(); };
      draw();
    },
    steps: ['Plot each value in time order.', 'Center line = average; control limits = average ± 2.66 × the average moving range (about ±3σ).', 'Signals: a point beyond a limit, 8 in a row on one side, or an unusually big jump.', 'Investigate signals (special causes). Leave common-cause noise alone, and reduce it only by changing the system.'],
    when: 'Before judging capability, and in the Control phase to keep a gain from slipping.',
    watch: 'Control limits come from the process, not the spec. A process can be stable and still out of spec, or in spec and unstable.',
    where: 'Six Sigma mode: the "I-MR control chart" card (rows must be in time order).',
    quiz: { q: 'Eight points in a row sit above the center line, none beyond the limits. What does it suggest?', options: ['Nothing; all points are inside the limits', 'A shift in the process average', 'The limits are wrong'], answer: 1, why: 'A long run on one side is very unlikely by chance and signals that the average has moved.' }
  });

  add({
    id: 'taguchi', group: 'Six Sigma and process control', title: 'Taguchi: robustness, S/N ratios and quality loss',
    analogy: 'A recipe that tastes good every time, not just on a good day. Taguchi looks for settings that make the result consistent despite noise you cannot control.',
    intro: 'Two suppliers can give the same average and very different consistency. The signal-to-noise (S/N) ratio rewards both being on target and being consistent. The loss function adds that being off target costs something even inside the spec.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('noise', 'Supplier B spread', 0.5, 4, 0.1, 2.5) + slider('pos', 'One unit measures', 90, 110, 0.5, 106) + '</div><div class="demo-grid"><div><h4>Same average, different consistency</h4><div data-role="box"></div></div><div><h4>Goalpost thinking vs Taguchi loss</h4><div data-role="loss"></div></div></div><p class="demo-read" data-role="read"></p>';
      const draw = () => {
        const nz = Number(q(el, 'noise').value), pos = Number(q(el, 'pos').value);
        setOut(el, 'noise', nz.toFixed(1)); setOut(el, 'pos', pos);
        const rand = E.rng(11), a = range(40).map(() => 100 + normal(rand) * 1), bb = range(40).map(() => 100 + normal(rand) * nz);
        const S = window.MLSpc;
        C.boxplot(q(el, 'box'), [{ label: 'Supplier A', stats: S.box(a) }, { label: 'Supplier B', stats: S.box(bb) }], { lsl: 90, usl: 110, label: 'Supplier box plots' });
        const f = frame(320, 240, [88, 112], [0, 1.3], { xLabel: 'Measured value', yLabel: 'Cost of the unit', yFmt: v => (v === 1 ? 'scrap' : v === 0 ? '0' : '') });
        const tag = x => ((x - 100) / 10) ** 2;
        let b = f.axes + '<path class="curve alt" d="' + pathOf([[88, 1], [90, 1], [90, 0], [110, 0], [110, 1], [112, 1]], f) + '"/>';
        b += '<path class="curve" d="' + pathOf(range(97).map(i => { const x = 88 + i * 0.25; return [x, Math.min(1.3, tag(x))]; }), f) + '"/>' + dot(f.sx(pos), f.sy(Math.min(1.3, tag(pos))), 'query', 6);
        q(el, 'loss').innerHTML = svg(320, 240, 'Loss functions', b) + C.legend([{ label: 'Goalpost: in spec is free', cls: 'pt s2' }, { label: 'Taguchi: loss grows away from target', cls: 'pt' }]);
        const snA = S.snRatio(a, 'nominal'), snB = S.snRatio(bb, 'nominal');
        q(el, 'read').innerHTML = 'S/N (on target is best): Supplier A <b>' + snA.toFixed(1) + ' dB</b>, Supplier B <b>' + snB.toFixed(1) + ' dB</b>. Higher is more robust, so ' + (snA > snB ? 'A' : 'B') + ' wins even though both average about 100. ' +
          'The unit at <b>' + pos + '</b> is ' + (pos < 90 || pos > 110 ? 'out of spec' : 'inside spec, so goalpost thinking says it is perfect') + '; Taguchi loss puts its cost at <b>' + pct(Math.min(tag(pos), 9)) + '</b> of a scrapped unit.';
      };
      q(el, 'noise').oninput = draw; q(el, 'pos').oninput = draw; draw();
    },
    steps: ['Pick the S/N type from your goal: larger is better, smaller is better, or on target is best.', 'Compute S/N for each level of each factor. Higher S/N = more consistent.', 'Rank factors by how much their S/N changes: big ranges matter most for robustness.', 'Set robust levels for factors that barely move the average; use another factor to adjust the average onto target.'],
    when: 'When variation hurts as much as the average does, for example fit, finish, fill weight or timing.',
    watch: 'S/N needs several results per level; with very few runs, treat the ranking as a hint.',
    where: 'Six Sigma mode: "Taguchi robustness" card, box plots, and the quality-loss line in the capability table.',
    quiz: { q: 'Two settings give the same average yield. Setting A has S/N 32 dB, setting B 24 dB. Which is better?', options: ['They are equal', 'A: it is more consistent', 'B: lower noise number'], answer: 1, why: 'Higher S/N means less variation relative to the signal, so A is more robust.' }
  });

  add({
    id: 'desirability', group: 'Six Sigma and process control', title: 'Desirability: the best compromise across several results',
    analogy: 'Tuning a car for speed, fuel economy and comfort at once. Flat out wins on speed and fails on fuel. The best tune is the one where nothing fails and everything is as good as it can be together.',
    intro: 'Real processes have several results to hit at once, for example high purity and low aggregates. Pushing temperature up may raise one and wreck the other. Desirability turns each result into a 0 to 1 score (d), then combines them with a geometric mean (D). Move the temperature and the purity weight below.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('x', 'Culture temperature (°C)', 30, 40, 0.1, 33) + slider('w', 'Weight on purity', 0.5, 3, 0.5, 1) + '</div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const purity = x => 97.2 - 0.22 * (x - 36.5) ** 2, hmw = x => 0.4 + 0.3 * (x - 30);
      const dP = y => Math.max(0, Math.min(1, (y - 94) / 3)), dH = y => Math.max(0, Math.min(1, (3 - y) / 2));
      const D = (x, w) => { const a = dP(purity(x)), b = dH(hmw(x)); return a <= 0 || b <= 0 ? 0 : Math.exp((w * Math.log(a) + Math.log(b)) / (w + 1)); };
      const draw = () => {
        const x = Number(q(el, 'x').value), w = Number(q(el, 'w').value);
        setOut(el, 'x', x.toFixed(1)); setOut(el, 'w', w);
        const xs = range(101).map(i => 30 + i / 10);
        const f = frame(640, 280, [30, 40], [0, 1.05], { xLabel: 'Culture temperature (°C)', yLabel: 'Desirability (0 to 1)' });
        let best = 30; xs.forEach(v => { if (D(v, w) > D(best, w)) best = v; });
        let b = f.axes + '<path class="curve d1" d="' + pathOf(xs.map(v => [v, dP(purity(v))]), f) + '"/><path class="curve alt" d="' + pathOf(xs.map(v => [v, dH(hmw(v))]), f) + '"/><path class="curve d3" d="' + pathOf(xs.map(v => [v, D(v, w)]), f) + '"/>';
        b += '<line class="target-line" x1="' + f.sx(best) + '" x2="' + f.sx(best) + '" y1="' + f.sy(0) + '" y2="' + f.sy(1.05) + '"/>' + dot(f.sx(x), f.sy(D(x, w)), 'query', 6);
        q(el, 'plot').innerHTML = svg(640, 280, 'Desirability demo', b) + C.legend([{ label: 'd purity (94% fails, 97% ideal)', cls: 'c1' }, { label: 'd aggregates HMW (3% fails, 1% ideal)', cls: 'c2' }, { label: 'Overall D', cls: 'c3' }]);
        const p = purity(x), m = hmw(x);
        q(el, 'read').innerHTML = 'At <b>' + x.toFixed(1) + ' °C</b>: purity <b>' + p.toFixed(2) + '%</b> (d ' + dP(p).toFixed(2) + '), HMW <b>' + m.toFixed(2) + '%</b> (d ' + dH(m).toFixed(2) + '), overall <b>D ' + D(x, w).toFixed(2) + '</b>. The best compromise is about <b>' + best.toFixed(1) + ' °C</b> (dashed line), not the purity peak at 36.5 °C, because aggregates climb with temperature. ' +
          (w > 1 ? 'Weighting purity more pulls the compromise toward the purity peak.' : 'Raise the purity weight and watch the compromise move.');
      };
      q(el, 'x').oninput = draw; q(el, 'w').oninput = draw; draw();
    },
    steps: ['For each result, pick a goal: maximize, minimize, or hit a target, plus where it fails and where it is fully met.', 'Each result gets its own model and a score d from 0 (fails) to 1 (ideal), a straight line in between.', 'Overall D is the weighted geometric mean of the d scores, so a single failing result makes D zero: no trade can hide a failure.', 'The agent searches the middle 90% of your settings for the highest D, then you confirm it with a few real batches.'],
    when: 'Two or more results matter at once: purity and yield, strength and weight, speed and defects.',
    watch: 'Each result model has its own error, so the combined prediction is less certain than any single one. Keep settings inside the range you have run.',
    where: 'Setup: "Optimize several results together". Results: the "Best compromise" card and every result on the what-if desk.',
    quiz: { q: 'Purity scores d = 1.0, but aggregates score d = 0. What is D?', options: ['0.5', '0', '1.0'], answer: 1, why: 'D is a geometric mean, so one failing result (d = 0) makes the whole compromise unacceptable, however good the others are.' }
  });

  add({
    id: 'shelf-life', group: 'Six Sigma and process control', title: 'Shelf life: why the confidence limit sets the date, not the line',
    analogy: 'The date on a milk carton is not the day it is expected to turn. It is the day you can still be confident it has not. The gap between those two is what noisy data costs you.',
    intro: 'Fit a straight line through a stability study and it crosses the specification at some month. ICH Q1E does not use that month. It uses the month where the 95% confidence limit of the line crosses, which is always earlier, and gets earlier still as the data gets noisier or thinner. Move the sliders and watch the price of uncertainty.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('noise', 'Assay scatter (std. dev.)', 0, 1.2, 0.05, 0.3) + slider('pts', 'Time points measured', 3, 8, 1, 7) + '</div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const ST = window.MLStability, LSL = 95, TRUE_SLOPE = -0.18, START = 99.6;
      const ALL = [0, 3, 6, 9, 12, 18, 24, 36];
      const draw = () => {
        const nz = Number(q(el, 'noise').value), np = Number(q(el, 'pts').value);
        setOut(el, 'noise', nz.toFixed(2)); setOut(el, 'pts', np);
        const rand = E.rng(17), times = ALL.slice(0, np);
        const rows = times.map(t => ({ batch: 'B1', time: t, y: START + TRUE_SLOPE * t + normal(rand) * nz }));
        let r;
        try { r = ST.analyze(rows, { lsl: LSL, direction: 'decreasing' }); } catch (err) { q(el, 'read').textContent = err.message; return; }
        const c = r.curves[0];
        const trueCross = (LSL - START) / TRUE_SLOPE;
        const xMax = 48;
        const f = frame(640, 300, [0, xMax], [93, 100.5], { xLabel: 'Months', yLabel: 'Purity %' });
        let b = f.axes;
        b += '<rect class="region-c2" fill-opacity=".10" x="' + f.sx(0) + '" y="' + f.sy(LSL) + '" width="' + (f.sx(xMax) - f.sx(0)) + '" height="' + (f.sy(93) - f.sy(LSL)) + '"/>';
        b += '<line class="ref" x1="' + f.sx(0) + '" x2="' + f.sx(xMax) + '" y1="' + f.sy(LSL) + '" y2="' + f.sy(LSL) + '"/><text class="lbl-strong" x="' + (f.sx(xMax) - 4) + '" y="' + (f.sy(LSL) - 5) + '" text-anchor="end">Specification 95.0</text>';
        const xs = range(97).map(i => i * xMax / 96);
        const inside = fn => xs.map(x => [x, fn(x)]).filter(pt => pt[1] >= 93 && pt[1] <= 100.5);
        b += '<path class="curve" d="' + pathOf(inside(c.fit), f) + '"/>';
        b += '<path class="curve alt" d="' + pathOf(inside(c.lower), f) + '"/>';
        rows.forEach(p => { b += dot(f.sx(p.time), f.sy(p.y), 'pt', 4.5); });
        // Two verticals, labelled at different heights so they never collide.
        [[r.shelfLife, 'target-line', 'shelf life you can defend', 10], [trueCross, 'ref', 'where the fitted line crosses', 26]].forEach(([x, cls, lab, dy]) => {
          if (x > xMax) return;
          const anchor = f.sx(x) > f.W * 0.62 ? 'end' : 'start';
          b += '<line class="' + cls + '" x1="' + f.sx(x) + '" x2="' + f.sx(x) + '" y1="' + f.sy(100.5) + '" y2="' + f.sy(93) + '"/>' +
            '<text x="' + (f.sx(x) + (anchor === 'end' ? -5 : 5)) + '" y="' + (f.sy(100.5) + dy) + '" text-anchor="' + anchor + '">' + lab + ': ' + fmt(x) + '</text>';
        });
        q(el, 'plot').innerHTML = svg(640, 300, 'Shelf life from the confidence limit', b) +
          C.legend([{ label: 'fitted trend', cls: 'pt' }, { label: '95% lower confidence limit', cls: 'pt s2' }]);
        const lost = trueCross - r.shelfLife;
        q(el, 'read').innerHTML = 'The fitted line reaches 95.0% at about <b>' + fmt(trueCross) + ' months</b>. The 95% confidence limit gets there at <b>' + fmt(r.shelfLife) + ' months</b>, so the shelf life you can defend is <b>' + fmt(lost) + ' months shorter</b>.<br>' +
          (nz < 0.05 ? 'With almost no scatter the two nearly coincide: perfect data costs nothing.'
            : lost > 6 ? 'Scatter and few time points widen the band, and every bit of width is shelf life you cannot claim. This is why analytical precision pays for itself.'
              : 'Tighten the assay or add time points and the band narrows, pulling the date back towards the trend line.') +
          (np <= 4 ? ' With only ' + np + ' time points there are barely any degrees of freedom, so the band flares out quickly.' : '');
      };
      q(el, 'noise').oninput = draw; q(el, 'pts').oninput = draw; draw();
    },
    steps: ['Fit purity (or impurity) against time, in months.', 'Test whether the batches may be pooled: equal slopes first, then equal intercepts, both at the 0.25 level Q1E sets.', 'Take the 95% one-sided confidence limit of the chosen line: the lower limit for something that falls, the upper limit for something that rises.', 'The shelf life is where that limit meets the specification, capped at twice the data you actually have (and never more than 12 months past it).'],
    when: 'Setting or defending an expiry date from a stability study.',
    watch: 'The 0.25 level is deliberately generous about splitting batches, because splitting gives the shorter, safer answer. A shelf life past your data is an extrapolation, and Q1E limits how far it may go.',
    where: 'Pick "Shelf life" from the selector at the top of the agent.',
    quiz: { q: 'Your fitted line reaches the specification at 30 months, but the 95% confidence limit reaches it at 22. What shelf life does ICH Q1E support?', options: ['30 months, the best estimate', '22 months', '26 months, the average'], answer: 1, why: 'Q1E uses the confidence limit, not the fitted line, so the claim holds even if the true degradation rate is at the unfavourable end of what the data can rule out.' }
  });

  add({
    id: 'golden-batch', group: 'Six Sigma and process control', title: 'Golden batch: watching every sensor at once',
    analogy: 'A doctor does not read your pulse, temperature and blood pressure on three separate days. Each can be normal on its own while the combination says you are ill. A batch is the same: thirty sensors, each inside its own limits, and the batch still going wrong.',
    intro: 'Below are two sensors from a bioreactor. Drag the fault slider: both readings stay inside their own limits, but their relationship breaks. Watch the single combined number notice what the two separate charts miss.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('fault', 'How far the batch drifts', 0, 3, 0.1, 0) + slider('kind', 'Fault type: 0 = both drift together, 1 = they stop agreeing', 0, 1, 1, 1) + '</div><div class="cols2"><div data-role="scatter"></div><div data-role="bars"></div></div><p class="demo-read" data-role="read"></p>';
      const draw = () => {
        const fault = Number(q(el, 'fault').value), kind = Number(q(el, 'kind').value);
        setOut(el, 'fault', fault.toFixed(1)); setOut(el, 'kind', kind);
        const rand = E.rng(5);
        // Good batches: temperature and dissolved oxygen move together, as they do in a real vessel.
        const good = range(60).map(() => { const a = normal(rand); return { x: a + normal(rand) * 0.25, y: a + normal(rand) * 0.25 }; });
        // Drift along the relationship, or across it.
        const now = kind === 0 ? { x: fault, y: fault } : { x: fault * 0.75, y: -fault * 0.75 };
        const lim = 2;   // each sensor's own limit, in standard deviations
        const f = frame(330, 300, [-3.6, 3.6], [-3.6, 3.6], { xLabel: 'Temperature (sd from normal)', yLabel: 'Dissolved oxygen (sd from normal)' });
        let b = f.axes;
        [-lim, lim].forEach(v => {
          b += '<line class="ref" x1="' + f.sx(v) + '" x2="' + f.sx(v) + '" y1="' + f.sy(-3.6) + '" y2="' + f.sy(3.6) + '"/>';
          b += '<line class="ref" x1="' + f.sx(-3.6) + '" x2="' + f.sx(3.6) + '" y1="' + f.sy(v) + '" y2="' + f.sy(v) + '"/>';
        });
        good.forEach(p => { b += dot(f.sx(p.x), f.sy(p.y), 'pt small', 3); });
        b += dot(f.sx(now.x), f.sy(now.y), 'query', 7);
        q(el, 'scatter').innerHTML = svg(330, 300, 'Two sensors against each other', b) +
          C.legend([{ label: 'good batches', cls: 'pt' }, { label: 'this moment', cls: 'query' }, { label: 'each sensor’s own limit', cls: 'ref', shape: 'square' }]);
        // T-squared along the relationship, Q across it: the two numbers the tool reports.
        const along = (now.x + now.y) / 2, across = (now.x - now.y) / 2;
        const t2 = (along * along) / 1.06 * 2, qv = across * across * 2;
        const t2lim = 9, qlim = 2.2;
        const bars = [['Temperature alone', Math.abs(now.x), lim], ['Oxygen alone', Math.abs(now.y), lim], ['T² (both together)', t2, t2lim], ['Q (do they still agree)', qv, qlim]];
        const W = 330, rowH = 52, H = bars.length * rowH + 16;
        let bb = '';
        bars.forEach(([name, val, limit], i) => {
          const y = 18 + i * rowH, maxv = Math.max(limit * 2, val * 1.1), w = v => Math.max(1, v / maxv * (W - 150));
          const over = val > limit;
          bb += '<text x="0" y="' + (y + 4) + '" class="lbl-strong">' + h(name) + '</text>';
          bb += '<rect x="145" y="' + (y - 8) + '" width="' + w(val) + '" height="16" rx="3" class="' + (over ? 'bar-bad' : 'bar-ok') + '"/>';
          bb += '<line x1="' + (145 + w(limit)) + '" x2="' + (145 + w(limit)) + '" y1="' + (y - 13) + '" y2="' + (y + 13) + '" class="ref"/>';
          bb += '<text x="' + (150 + w(Math.max(val, limit))) + '" y="' + (y + 4) + '">' + (over ? 'OVER' : 'ok') + '</text>';
        });
        q(el, 'bars').innerHTML = svg(W, H, 'Each sensor alone against the combined numbers', bb);
        const singlesOk = Math.abs(now.x) <= lim && Math.abs(now.y) <= lim;
        const combinedOver = t2 > t2lim || qv > qlim;
        q(el, 'read').innerHTML = fault < 0.2 ? 'A normal moment: everything sits where good batches sat.'
          : singlesOk && combinedOver
            ? '<b class="warn">This is the case the tool exists for.</b> Both sensors are inside their own limits, so every single-sensor chart on the plant says fine &mdash; but ' + (kind === 1 ? 'they have stopped agreeing with each other, and <b>Q</b> has caught it. A probe drifting out of step with the vessel looks exactly like this.' : '<b>T²</b> has caught how far the pair has moved together.')
            : combinedOver ? 'Far enough out that the single-sensor charts catch it too. The combined numbers caught it earlier.'
              : 'Still inside everything. Drag further.';
      };
      q(el, 'fault').oninput = draw; q(el, 'kind').oninput = draw; draw();
    },
    steps: ['Line every batch up on how far through it they are, so a planned ramp is not mistaken for a fault.', 'From the batches you were happy with, work out the average path and the spread around it: the golden envelope.', 'Turn every reading into "how many standard deviations from the golden path at this moment", so all sensors are on one scale.', 'T² is how far this moment sits from the middle of normal, counting all sensors together. Q is whether the sensors still relate to each other the way they normally do.', 'Alarm limits come from reference batches held out of the model that scored them, so "99%" means a batch the model had never seen.'],
    when: 'Any process with several sensors logging through a run: bioreactors, fermenters, chromatography skids, lyophilisers, filling lines.',
    watch: 'The envelope is only as good as the batches you nominate. Nominate a bad batch as a reference and you teach it that bad is normal. Three batches is the bare minimum, ten is a working model, and more is better. And an alarm is not a root cause: it is a time, a sensor and an invitation to go and look.',
    where: 'Pick "PCA & multivariate SPC" from the selector at the top of the agent.',
    quiz: { q: 'Every sensor on a batch stayed inside its own alarm limits, but Q went over. What does that most likely mean?', options: ['A false alarm; the single-sensor charts are the real test', 'The sensors stopped relating to each other the way they normally do', 'The batch ran longer than usual'], answer: 1, why: 'Q measures whether the pattern between sensors still holds. Breaking that pattern while every individual reading stays in range is the classic signature of a drifting probe or a developing fault, and it is invisible on single-sensor charts.' }
  });

  add({
    id: 'equivalence', group: 'Six Sigma and process control', title: 'Equivalence (TOST): proving sameness, not just failing to find a difference',
    analogy: 'A jury verdict of "not guilty" is not the same as "innocent". An ordinary t-test can only fail to convict. TOST is the test that can actually acquit: it asks whether the difference is small enough to be beside the point.',
    intro: 'Run a t-test on two labs, get p = 0.42, and it is tempting to write "no significant difference, methods equivalent". That does not follow: a small, noisy study fails to find almost anything. TOST flips the question. You declare a margin first, then test both edges of it. Drag the margin and the scatter below and watch the two tests disagree.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('margin', 'Equivalence margin (±)', 0.5, 6, 0.1, 2) + slider('noise', 'Scatter in each lab', 0.3, 5, 0.1, 1) + slider('n', 'Results per lab', 4, 30, 1, 12) + '</div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const TT = window.MLTost;
      const draw = () => {
        const margin = Number(q(el, 'margin').value), noise = Number(q(el, 'noise').value), n = Number(q(el, 'n').value);
        setOut(el, 'margin', margin.toFixed(1)); setOut(el, 'noise', noise.toFixed(1)); setOut(el, 'n', n);
        const rand = E.rng(5), rows = [];
        // The two labs genuinely differ by 0.4: small, and the point is whether that matters.
        for (let i = 0; i < n; i++) {
          rows.push({ group: 'A', value: 100 + normal(rand) * noise });
          rows.push({ group: 'B', value: 100.4 + normal(rand) * noise });
        }
        let r;
        try { r = TT.analyze(rows, { reference: 'A', test: 'B', margin: margin }); } catch (err) { q(el, 'read').textContent = err.message; return; }
        const span = Math.max(margin * 1.5, Math.abs(r.ciLow) * 1.15, Math.abs(r.ciHigh) * 1.15);
        const f = frame(640, 230, [-span, span], [0, 1], { yFmt: () => '', xLabel: 'Difference: Lab B minus Lab A' });
        let b = '<rect class="region-c3" fill-opacity=".16" x="' + f.sx(-margin) + '" y="' + f.sy(1) + '" width="' + (f.sx(margin) - f.sx(-margin)) + '" height="' + (f.sy(0) - f.sy(1)) + '"/>';
        b += f.axes;
        [[-margin, '−margin'], [margin, '+margin']].forEach(([v, lab]) => {
          b += '<line class="ref" x1="' + f.sx(v) + '" x2="' + f.sx(v) + '" y1="' + f.sy(1) + '" y2="' + f.sy(0) + '"/>' +
            '<text class="lbl-strong" x="' + f.sx(v) + '" y="' + (f.sy(1) - 6) + '" text-anchor="middle">' + lab + '</text>';
        });
        b += '<line class="target-line" x1="' + f.sx(0) + '" x2="' + f.sx(0) + '" y1="' + f.sy(1) + '" y2="' + f.sy(0) + '"/>';
        const y = f.sy(0.5), cls = r.equivalent ? 'good' : r.differs ? 'bad' : 'warn';
        b += '<line class="ci-line ' + cls + '" x1="' + f.sx(r.ciLow) + '" x2="' + f.sx(r.ciHigh) + '" y1="' + y + '" y2="' + y + '"/>';
        [r.ciLow, r.ciHigh].forEach(v => { b += '<line class="ci-line ' + cls + '" x1="' + f.sx(v) + '" x2="' + f.sx(v) + '" y1="' + (y - 10) + '" y2="' + (y + 10) + '"/>'; });
        b += dot(f.sx(r.diff), y, 'query', 6);
        q(el, 'plot').innerHTML = svg(640, 230, 'Confidence interval against the equivalence margin', b);
        const tTest = r.pDiff < 0.05 ? 'finds a significant difference (p ' + r.pDiff.toFixed(3) + ')' : 'finds no significant difference (p ' + r.pDiff.toFixed(3) + ')';
        const verdict = r.equivalent ? '<b class="ok">Equivalent</b>: the whole interval fits inside the margin.'
          : r.differs ? '<b class="bad">Not equivalent</b>: a real difference, and bigger than the margin allows.'
            : '<b class="warn">Inconclusive</b>: the interval is wider than the margin but still covers zero, so there is simply not enough data to say.';
        q(el, 'read').innerHTML = 'The ordinary t-test ' + tTest + '. TOST says: ' + verdict + '<br>' +
          '90% interval <b>' + fmt(r.ciLow) + ' to ' + fmt(r.ciHigh) + '</b> against a margin of ±' + fmt(margin) + '. ' +
          (!r.equivalent && !r.differs ? 'Notice that the t-test is quiet here while TOST refuses to conclude: "not significant" was never the same as "the same".' : r.equivalent && r.pDiff >= 0.05 ? 'Here both agree, but only TOST is entitled to the word "equivalent".' : '');
      };
      ['margin', 'noise', 'n'].forEach(k => { q(el, k).oninput = draw; });
      draw();
    },
    steps: ['Set the margin first, from what actually matters to the product. Choosing it after seeing the data is how studies get talked into passing.', 'Test two one-sided hypotheses: that the difference is above −margin, and that it is below +margin.', 'Both must pass. That is the same statement as the 90% confidence interval sitting entirely inside the margins.', 'Three outcomes, not two: equivalent, a real difference, or not enough data to tell.'],
    when: 'Transferring a method to another lab, instrument or analyst; qualifying a second supplier; showing a process change did not shift the result.',
    watch: 'A wide interval that covers zero is not evidence of sameness. The margin is a business and product decision, not a statistical one, and a pass that uses 95% of the margin will not survive the next drift.',
    where: 'Pick "Method transfer" from the selector at the top of the agent.',
    quiz: { q: 'Two labs are compared. The t-test gives p = 0.42, and the 90% interval for the difference runs from −3.1 to +1.8 against a margin of ±2. What can you conclude?', options: ['The methods are equivalent, since p > 0.05', 'Nothing yet: the interval is wider than the margin', 'The methods differ, since the interval is wide'], answer: 1, why: 'The interval runs past −2, so equivalence is not shown; it still covers zero, so no difference is shown either. That is the inconclusive case, and it usually means too few results.' }
  });

  add({
    id: 'variance-components', group: 'Six Sigma and process control', title: 'Variance components: whose fault is the spread?',
    analogy: 'A classroom sits an exam twice. If every pupil scores about the same both times but pupils differ from each other, the exam is measuring something real. If each pupil swings wildly between the two sittings, the exam is measuring its own mood. Same spread of marks, opposite conclusions — and you cannot tell which from the marks alone, only from the repeats.',
    intro: 'Six resin lots give six different yields. Is that the supplier, or is it the assay? Both stories produce the same scatter of numbers, so no amount of staring at lot means will separate them. What separates them is repeats: measure the same lot more than once and the within-lot spread tells you what the measurement does by itself. Everything left over belongs to the lots. Drag the two sliders below and watch the same-looking picture change its meaning.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('between', 'How much the lots really differ', 0, 3, 0.1, 1.6) + slider('within', 'Measurement scatter', 0.1, 3, 0.1, 0.5) + slider('reps', 'Measurements per lot', 2, 8, 1, 4) + '</div><div data-role="plot"></div><div data-role="bars"></div><p class="demo-read" data-role="read"></p>';
      const V = window.MLVariance;
      const draw = () => {
        const sb = Number(q(el, 'between').value), sw = Number(q(el, 'within').value), reps = Number(q(el, 'reps').value);
        setOut(el, 'between', sb.toFixed(1)); setOut(el, 'within', sw.toFixed(1)); setOut(el, 'reps', reps);
        const rand = E.rng(21), lots = ['L-01', 'L-02', 'L-03', 'L-04', 'L-05', 'L-06'], rows = [];
        lots.forEach(name => {
          const shift = normal(rand) * sb;
          for (let k = 0; k < reps; k++) rows.push({ group: name, value: 92 + shift + normal(rand) * sw });
        });
        const r = V.oneWay(rows);
        const vals = rows.map(x => x.value);
        const lo = Math.min.apply(null, vals) - 0.4, hi = Math.max.apply(null, vals) + 0.4;
        const f = frame(640, 250, [lo, hi], [-0.6, lots.length - 0.4], { l: 60, yFmt: () => '', xLabel: 'Measured yield (%)' });
        let b = f.axes;
        b += '<line class="target-line" x1="' + f.sx(r.grand) + '" x2="' + f.sx(r.grand) + '" y1="' + f.sy(lots.length - 0.4) + '" y2="' + f.sy(-0.6) + '"/>';
        lots.forEach((name, i) => {
          const y = f.sy(lots.length - 1 - i);
          const mine = rows.filter(x => x.group === name);
          const m = mine.reduce((a, x) => a + x.value, 0) / mine.length;
          b += '<text class="lbl-strong" x="4" y="' + (y + 4) + '">' + h(name) + '</text>';
          b += '<line class="gridline" x1="' + f.L + '" x2="' + (f.W - f.R) + '" y1="' + y + '" y2="' + y + '"/>';
          b += '<line class="mean-mark c1" x1="' + f.sx(m) + '" x2="' + f.sx(m) + '" y1="' + (y - 10) + '" y2="' + (y + 10) + '"/>';
          mine.forEach(x => { b += dot(f.sx(x.value), y, 'c2', 4, name + ' · ' + fmt(x.value)); });
        });
        q(el, 'plot').innerHTML = svg(640, 250, 'Measurements by lot, with lot means', b);
        const share = Math.round(r.icc * 100);
        C.hbar(q(el, 'bars'), [
          { label: 'Between lots', value: share, text: share + '%', cls: share >= 50 ? 'hi' : '' },
          { label: 'Measurement', value: 100 - share, text: (100 - share) + '%', cls: share < 50 ? 'hi' : '' }
        ], { min: 0, max: 100, label: 'Share of the total variance' });
        const verdict = share < 10 ? '<b class="warn">The lots are not the problem.</b> Chasing the low one is chasing noise.'
          : share >= 70 ? '<b class="ok">The lots really differ.</b> This is worth taking to the supplier.'
            : '<b>Both matter.</b> A single measurement cannot judge a lot, but the lots are not interchangeable either.';
        q(el, 'read').innerHTML = verdict + '<br>Total spread <b>' + fmt(r.sdTotal) + '</b>, of which <b>' + share + '%</b> of the variance sits between lots (ANOVA p ' + (r.p < 0.0001 ? '&lt;0.0001' : r.p.toFixed(4)) + ').' +
          (r.negative ? ' The between-lot estimate came out negative, which cannot be true of a variance — it means the lots differ by less than measurement scatter alone would produce, and it is reported as zero.' : '') +
          '<br>Now drop <i>Measurements per lot</i> to 2 and watch the estimate lurch about. The split is only as trustworthy as the repeats behind it.';
      };
      ['between', 'within', 'reps'].forEach(k => { q(el, k).oninput = draw; });
      draw();
    },
    steps: ['Measure each group more than once. Without repeats there is nothing to compare the between-group spread against, and no split is possible at any sample size.', 'Within-group spread estimates what the measurement does by itself: the same material, measured again.', 'Between-group spread is inflated by that same noise, so the noise is subtracted off before the group effect is quoted.', 'Shares are shares of variance, because variance adds up and standard deviation does not.', 'Then Tukey’s method names which pairs actually differ, holding the confidence across every comparison at once.'],
    when: 'Before blaming a supplier, an analyst, a vessel or a shift. Also before quoting process capability, since measurement noise inflates the spread that Cpk is calculated from.',
    watch: 'You can only split variation across sources you recorded. If every lot of resin happened to be run on a different week, "lot" and "week" are the same column and the arithmetic cannot tell them apart — it will hand the whole effect to whichever one you named. Six groups is also thin: the between-group estimate rests on five degrees of freedom and is a rough number however many decimals it is printed to.',
    where: 'Pick "Variance components, ANOVA & Gage R&R" from the selector at the top of the agent, then "Where is the variation coming from?".',
    quiz: { q: 'Eight media lots are each assayed four times. The within-lot spread is large and the between-lot share comes out at 6%. What is the right next move?', options: ['Reject the worst lot and tighten the incoming specification', 'Investigate the assay, not the lots', 'Collect more lots to find the bad one'], answer: 1, why: 'Almost all the spread is repeat measurements of the same lot disagreeing with each other. The lots are not distinguishable; the method that measures them is what is moving. More lots would just produce more noise.' }
  });

  add({
    id: 'gage-rr', group: 'Six Sigma and process control', title: 'Gage R&R: can the method even see what you are chasing?',
    analogy: 'Weighing a letter on bathroom scales. The scales are not broken and they are properly calibrated — they simply cannot resolve grams. Every reading you take is mostly the scales, and no amount of averaging the postage over the quarter will fix the decision you make on one letter.',
    intro: 'Every capability index, trend report and comparability study takes the measurement at face value. If a third of what you observe is the assay, then a third of your Cpk is about the assay, and nothing done afterwards can separate them. Gage R&R splits what you see into the instrument repeating itself, operators disagreeing with each other, and genuine differences between samples. Drag the sliders and watch the verdict turn over.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('rep', 'Instrument noise (repeatability)', 0.05, 2, 0.05, 0.2) + slider('op', 'Disagreement between analysts', 0, 2, 0.05, 0.1) + slider('part', 'How different the samples are', 0.2, 6, 0.1, 3) + '</div><div data-role="bars"></div><p class="demo-read" data-role="read"></p>';
      const V = window.MLVariance;
      const draw = () => {
        const sr = Number(q(el, 'rep').value), so = Number(q(el, 'op').value), sp = Number(q(el, 'part').value);
        setOut(el, 'rep', sr.toFixed(2)); setOut(el, 'op', so.toFixed(2)); setOut(el, 'part', sp.toFixed(1));
        const rand = E.rng(9), rows = [];
        const ops = ['Analyst 1', 'Analyst 2', 'Analyst 3'];
        const bias = ops.map(() => normal(rand) * so);
        for (let i = 0; i < 10; i++) {
          const truth = 100 + normal(rand) * sp;
          ops.forEach((o, j) => { for (let k = 0; k < 3; k++) rows.push({ part: 'S-' + (i + 1), operator: o, value: truth + bias[j] + normal(rand) * sr }); });
        }
        // Specification window held fixed, because that is the decision the method has to support.
        const r = V.gageRR(rows, { lsl: 94, usl: 106 });
        C.hbar(q(el, 'bars'), r.components.map(c => ({
          label: c.source.replace(/ \(.*\)/, ''), value: c.pctStudy, text: c.pctStudy.toFixed(1) + '%',
          cls: /Part to part/.test(c.source) ? 'hi' : ''
        })), { min: 0, max: 100, label: '% of total spread (standard-deviation scale)' });
        const cls = r.verdict === 'acceptable' ? 'ok' : r.verdict === 'marginal' ? 'warn' : 'bad';
        q(el, 'read').innerHTML = '<b class="' + cls + '">' + r.verdict.toUpperCase() + '</b>: the measurement system uses <b>' + r.pctTolerance.toFixed(1) + '%</b> of the 12-unit specification window, and can tell about <b>' + (isFinite(r.ndc) ? r.ndc : 'many') + '</b> distinct levels apart (five is the usual bar).' +
          '<br>Repeatability is one analyst measuring the same sample twice and getting a different answer — the hardware and the sample preparation. Reproducibility is two analysts disagreeing about the same sample — the method description and the training. They need different fixes, which is the whole reason for splitting them.' +
          '<br><i>Now the trap:</i> leave the instrument alone and drag <i>How different the samples are</i> down to 0.2. The <b>% of the specification window stays put</b> — the method has not changed — but "part to part" collapses and the study looks like a disaster. A Gage R&R run on ten near-identical samples fails whatever the instrument does. That is why the samples must span the range you really see, and why the verdict here is taken against the specification rather than against the study.';
      };
      ['rep', 'op', 'part'].forEach(k => { q(el, k).oninput = draw; });
      draw();
    },
    steps: ['Every operator measures every sample, more than once, in a complete and balanced design. The repeats are what separate the instrument from the people.', 'Repeatability comes from disagreement within a cell: same operator, same sample, two readings.', 'Reproducibility comes from operators sitting high or low against each other, plus any pattern where some operators read some samples differently.', 'Add those two together for total Gage R&R, and compare it against the specification window: under 10% is acceptable, 10 to 30% marginal, above 30% not fit.', 'Distinct categories says how many genuinely different levels the method can resolve. Under five, a control chart on individual results tracks the measurement rather than the process.'],
    when: 'Before a method is trusted to release product, before capability is quoted, after any change of instrument, column, software or staff, and whenever two analysts argue about a result.',
    watch: 'Without specification limits the verdict is taken against the spread of the samples in the study, which flatters a study of very different samples and condemns one of similar ones. The usual 10% and 30% thresholds are industry convention, not law: your protocol governs. And a study of ten samples gives a rough part-to-part estimate, so a borderline verdict is genuinely borderline.',
    where: 'Pick "Variance components, ANOVA & Gage R&R" from the selector at the top of the agent, then "Can my measurement system see it?".',
    quiz: { q: 'A Gage R&R returns 8% of tolerance but only 3 distinct categories. What does that combination mean?', options: ['The study is contradictory and should be rerun', 'The method is fine against the specification, but the samples chosen were too alike to show it resolving much', 'The method cannot be used'], answer: 1, why: 'The two numbers answer different questions. Against the specification window — the decision that matters — the method only uses 8%. Distinct categories is a ratio against the spread of the samples in this study, so near-identical samples drive it down without saying anything about the instrument.' }
  });

  add({
    id: 'tolerance-intervals', group: 'Six Sigma and process control', title: 'Tolerance intervals: the limits your data can defend',
    analogy: 'A confidence interval asks where the bullseye is. A tolerance interval asks where the arrows will land. Shoot more arrows and you learn the bullseye’s position as precisely as you like — but the arrows keep scattering just as much as they always did. The two questions have different answers, and a specification is the second one.',
    intro: 'Three batches come in at 98.1, 97.4 and 98.9, so somebody writes the specification as the mean plus or minus three standard deviations and moves on. That interval does not cover 99.7% of future production; on three batches it covers nothing like it, because the standard deviation in the formula is itself a guess made from three numbers. A tolerance interval does the honest version, and the price of honesty is visible below.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('n', 'Batches you have', 3, 120, 1, 10) + slider('p', 'Share of production to cover (%)', 90, 99.9, 0.1, 99) + '</div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const T = window.MLTolerance;
      const draw = () => {
        const n = Number(q(el, 'n').value), pPct = Number(q(el, 'p').value), p = pPct / 100;
        setOut(el, 'n', n); setOut(el, 'p', pPct.toFixed(1));
        const k = T.toleranceFactor(n, p, 0.95, 2);
        const kKnown = E.normInv((1 + p) / 2);
        // The factor against sample size, so the shape of the price is visible.
        const pts = [];
        for (const m of [3, 4, 5, 6, 8, 10, 15, 20, 30, 50, 80, 120]) pts.push([m, T.toleranceFactor(m, p, 0.95, 2)]);
        const top = Math.max(pts[0][1], k) * 1.05;
        const f = frame(640, 250, [0, 125], [0, top], { xLabel: 'Batches in hand', yLabel: 'Factor applied to s' });
        let b = f.axes;
        b += '<line class="ref" x1="' + f.L + '" x2="' + (f.W - f.R) + '" y1="' + f.sy(kKnown) + '" y2="' + f.sy(kKnown) + '"/>';
        b += '<text class="lbl-strong" x="' + (f.W - f.R - 4) + '" y="' + (f.sy(kKnown) - 7) + '" text-anchor="end">if sigma were known: ' + fmt(kKnown) + '</text>';
        b += '<line class="target-line" x1="' + f.L + '" x2="' + (f.W - f.R) + '" y1="' + f.sy(3) + '" y2="' + f.sy(3) + '"/>';
        b += '<text x="' + (f.L + 6) + '" y="' + (f.sy(3) - 7) + '">the "3" people use</text>';
        b += '<path class="line" d="' + pathOf(pts, f) + '"/>';
        pts.forEach(pt => { b += dot(f.sx(pt[0]), f.sy(pt[1]), 'c1', 4, pt[0] + ' batches: k = ' + fmt(pt[1])); });
        b += dot(f.sx(n), f.sy(k), 'query', 7, 'you are here');
        q(el, 'plot').innerHTML = svg(640, 250, 'Tolerance factor against sample size', b);
        const inflation = k / kKnown;
        q(el, 'read').innerHTML = 'On <b>' + n + '</b> batches, covering <b>' + pPct.toFixed(1) + '%</b> of production with 95% confidence needs <b>k = ' + fmt(k) + '</b>, not ' + fmt(kKnown) + '. ' +
          'That is <b>' + fmt(inflation) + ' times</b> wider than if you knew sigma exactly' + (k > 3 ? ', and wider than the 3 almost everybody writes down' : '') + '.' +
          '<br>Drag the batch count to 3 and watch the factor go through the roof. That is not the arithmetic being awkward: it is telling you that three batches genuinely cannot pin down the tails of a distribution. Drag it to 120 and it settles towards ' + fmt(kKnown) + ', which is the most any amount of data can buy you.';
      };
      ['n', 'p'].forEach(key => { q(el, key).oninput = draw; });
      draw();
    },
    steps: ['Decide what the limit has to promise: what share of production it covers, and with what confidence. Both are choices, and both belong in the protocol.', 'The factor k depends on the sample size, the share and the confidence — and nothing else.', 'The limits are the mean plus or minus k times the sample standard deviation.', 'Compare that against the specification you hold. If the interval fits inside, the data supports the limits; if not, either more data or a better process is needed.'],
    when: 'Setting or defending a release specification, an in-process action level, a shelf-life limit, or an incoming material specification.',
    watch: 'This assumes independent, normally distributed results on the scale the specification is written on. One number per batch: if each row is an average of replicates, the spread looks smaller than batch-to-batch reality and the limits will be broken later. Normality matters more here than almost anywhere else, because a specification is a statement about the tails, which is exactly where the wrong distribution hurts — so the tool tests it rather than assuming it.',
    where: 'Pick "Tolerance intervals, power & sample size" from the selector at the top of the agent.',
    quiz: { q: 'You have 10 batches and want limits covering 99% of production with 95% confidence. Roughly what multiple of the standard deviation do you need?', options: ['About 2.6, since that is the 99% normal quantile', 'About 3, the usual rule of thumb', 'About 4.4, because sigma is only estimated from 10 results'], answer: 2, why: 'The exact two-sided factor is 4.44. The 2.58 quantile would be right if sigma were known exactly; with 10 results it is not, and the extra width is the cost of that uncertainty. Using 3 here would give limits that cover far less than 99%.' }
  });

  add({
    id: 'power-sample-size', group: 'Six Sigma and process control', title: 'Power and sample size: is this study worth running?',
    analogy: 'A smoke detector with a dead battery never goes off. Silence from it is not evidence that the building is safe — it is no evidence at all. An underpowered study is the same instrument: when it reports "no significant difference", it has told you nothing, and the trap is that the report looks identical to the one from a study that genuinely found nothing.',
    intro: 'Power is the chance that a study finds a real effect. Work it out before the study and you know whether the question can be answered for the money; work it out afterwards and you are explaining why a quarter of instrument time produced an inconclusive result. The two cases below need very different numbers, and the one people underestimate is the second.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('d', 'Difference that really exists', 0, 3, 0.05, 1) + slider('sd', 'Scatter (standard deviation)', 0.3, 3, 0.1, 1) + slider('m', 'Equivalence margin (±)', 0.5, 5, 0.1, 2) + '</div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const T = window.MLTolerance;
      const draw = () => {
        const d = Number(q(el, 'd').value), sd = Number(q(el, 'sd').value), m = Number(q(el, 'm').value);
        setOut(el, 'd', d.toFixed(2)); setOut(el, 'sd', sd.toFixed(1)); setOut(el, 'm', m.toFixed(1));
        const ns = [];
        for (let n = 3; n <= 120; n += 3) ns.push(n);
        const diffPts = ns.map(n => [n, T.powerTwoSample({ n: n, delta: d, sd: sd, alpha: 0.05, sided: 2 }).power]);
        const eqPts = ns.map(n => [n, T.powerTost({ n: n, margin: m, diff: d, sd: sd, alpha: 0.05 }).power]);
        const f = frame(640, 260, [0, 125], [0, 1], { xLabel: 'Results per group', yLabel: 'Chance of a conclusive answer', yFmt: v => Math.round(v * 100) + '%' });
        let b = f.axes;
        b += '<line class="ref" x1="' + f.L + '" x2="' + (f.W - f.R) + '" y1="' + f.sy(0.8) + '" y2="' + f.sy(0.8) + '"/>';
        b += '<text x="' + (f.L + 6) + '" y="' + (f.sy(0.8) - 7) + '">80%, the usual bar</text>';
        b += '<path class="line" d="' + pathOf(diffPts, f) + '"/>';
        b += '<path class="line s2" d="' + pathOf(eqPts, f) + '"/>';
        b += '<text class="lbl-strong" x="' + (f.W - f.R - 4) + '" y="' + (f.sy(diffPts[diffPts.length - 1][1]) - 8) + '" text-anchor="end">detecting a difference</text>';
        b += '<text class="lbl-strong s2" x="' + (f.W - f.R - 4) + '" y="' + (f.sy(eqPts[eqPts.length - 1][1]) + 18) + '" text-anchor="end">showing equivalence</text>';
        q(el, 'plot').innerHTML = svg(640, 260, 'Power against sample size for both questions', b);
        const nDiff = T.sampleSizeTwoSample({ delta: d, sd: sd, alpha: 0.05, sided: 2 }, 0.8).n;
        const nEq = Math.abs(d) >= m ? null : T.sampleSizeTost({ margin: m, diff: d, sd: sd, alpha: 0.05 }, 0.8).n;
        q(el, 'read').innerHTML =
          'To <b>detect</b> a difference of ' + fmt(d) + ' at 80% power: <b>' + (d === 0 ? 'impossible — there is nothing to detect' : nDiff === null ? 'more than any realistic study' : nDiff + ' per group') + '</b>.<br>' +
          'To <b>show equivalence</b> within ±' + fmt(m) + ', when the true difference is ' + fmt(d) + ': <b>' + (nEq === null ? 'impossible — the real difference is already at or beyond the margin' : nEq + ' per group') + '</b>.<br>' +
          (nEq !== null && nDiff !== null && nEq > nDiff ? 'Note which is larger. Proving sameness generally costs more than finding a difference, which is the opposite of what most people assume when they plan a transfer. ' : '') +
          'Now set the difference to 0 and watch the equivalence curve: with no real bias, equivalence becomes much cheaper to show. An honest guess at the bias is worth more at this stage than an optimistic one, because an optimistic guess is how a study ends up half the size it needed to be.';
      };
      ['d', 'sd', 'm'].forEach(key => { q(el, key).oninput = draw; });
      draw();
    },
    steps: ['State the difference that would actually change a decision. Not the smallest detectable one — the smallest one worth acting on.', 'Put a number on the scatter, from previous runs or from a variance study.', 'Pick the power you want. 80% is conventional, and still means a one-in-five chance of missing a real effect.', 'Read off the sample size, then decide whether the study is worth it. Finding out it is not is a useful result, delivered before the money is spent.'],
    when: 'Before a comparability study, a method transfer, a supplier qualification, a process change, or any validation protocol that has to state its acceptance criteria in advance.',
    watch: 'Every one of these answers rests on the standard deviation you fed in. If that came from three runs it is barely known, and the sample size inherits the doubt — so a variance study or a Gage R&R is often the right first step. And power calculated after the fact, on the difference you happened to observe, is not power; it is the p-value wearing a disguise.',
    where: 'Pick "Tolerance intervals, power & sample size" from the selector, then "Work out how many results a study needs".',
    quiz: { q: 'A method transfer with 6 results per lab reports p = 0.48 and the team writes "no significant difference, methods equivalent". What is wrong?', options: ['Nothing, p > 0.05 means no difference', 'The study had little chance of detecting a difference, so finding none is uninformative — and equivalence needs its own test against a margin', 'They should have used a one-sided test'], answer: 1, why: 'Two errors at once. A small study fails to find almost anything, so "not significant" is close to meaningless. And equivalence is a different claim that requires a margin set in advance and its own test; failing to reject is not the same as demonstrating sameness.' }
  });

  add({
    id: 'attribute-agreement', group: 'Six Sigma and process control', title: 'Attribute agreement: can people agree on a judgement?',
    analogy: 'Three referees watching the same match. Before you argue about the result, find out whether they would even agree on what happened - and whether a referee who never gives a foul looks excellent simply because fouls are rare.',
    intro: 'Gage R&R needs a measurement. Many of the most important calls are not measurements: pass or fail, contaminated or clean, protein-like or silicone-like. For those the question is whether appraisers agree with themselves, with each other, and with the truth. Percent agreement answers it badly, and this demo shows exactly how badly.',
    demo(el) {
      el.innerHTML = '<div data-role="plot"></div><div class="demo-controls">' + slider('prev', 'Share of samples that really are defective (%)', 5, 50, 5, 5) +
        slider('miss', 'How often appraiser C calls a real defect good (%)', 0, 100, 10, 100) + '</div><p class="demo-read" data-role="read"></p>';
      const draw = () => {
        const prev = Number(q(el, 'prev').value) / 100, miss = Number(q(el, 'miss').value) / 100;
        setOut(el, 'prev', Math.round(prev * 100)); setOut(el, 'miss', Math.round(miss * 100));
        const n = 20, nd = Math.max(1, Math.round(n * prev));
        const std = range(n).map(i => (i < nd ? 'Fail' : 'Pass'));
        const rows = [];
        ['A', 'B', 'C'].forEach(op => {
          std.forEach((t, i) => {
            [1, 2].forEach(() => {
              let call = t;
              if (op === 'C' && t === 'Fail' && i / nd < miss) call = 'Pass';
              if (op === 'B' && t === 'Pass' && i === n - 1) call = 'Fail';   // one honest false alarm, for contrast
              rows.push({ part: 'P' + i, operator: op, rating: call, standard: t });
            });
          });
        });
        const r = V.attributeAgreement(rows, {});
        const c = r.vsStandard.find(v => v.operator === 'C');
        C.hbar(q(el, 'plot'), r.vsStandard.map(v => ({
          label: 'Appraiser ' + v.operator, value: v.kappa, cls: v.kappa >= 0.9 ? 'hi' : v.kappa >= 0.7 ? '' : 'accent',
          text: 'kappa ' + v.kappa.toFixed(2) + '  (agrees ' + pct(v.pct) + ')'
        })), { min: 0, max: 1, ref: { value: 0.9, label: 'acceptable' } });
        q(el, 'read').innerHTML = 'Appraiser C misses ' + pct(c.miss) + ' of the real defects, and still agrees with the standard <b>' + pct(c.pct) +
          '</b> of the time - because only ' + pct(r.prevalence) + ' of the samples are defective, so calling everything good is right most of the time by default. ' +
          'Kappa subtracts the agreement you would get by chance at this prevalence and lands at <b>' + c.kappa.toFixed(2) +
          '</b>: against the 0.90 convention, <b>' + c.verdict + '</b>. ' +
          'Turn the defect share up to 50% and the percent agreement collapses towards 50% while kappa barely moves, because kappa was measuring the right thing all along. ' +
          'The miss rate - ' + pct(c.miss) + ' here against a false alarm rate of ' + pct(c.falseAlarm) + ' - is reported separately on purpose: shipping a defect and scrapping a good unit are not the same mistake and must not be averaged.';
      };
      q(el, 'prev').oninput = draw; q(el, 'miss').oninput = draw;
      draw();
    },
    steps: ['Choose samples spanning the decision, including borderline ones, and establish the truth independently.', 'Have each appraiser rate every sample at least twice, blind and in a different order.', 'Report within-appraiser repeatability, between-appraiser agreement, and agreement against the standard - three different failures with three different fixes.', 'Judge kappa, not percent agreement, and report miss and false alarm separately for a two-way call.'],
    when: 'Before trusting any dataset built from human or automated calls: visual inspection, deviation classification, particle typing by an image classifier.',
    watch: 'Without a known standard you can only measure consistency, never accuracy - three appraisers who agree perfectly on the wrong answer score perfectly. And a rare defect makes percent agreement almost meaningless, which is where most of these studies live.',
    where: 'The variance tool runs this when the ratings are categories, bootstraps the intervals over samples rather than using an asymptotic formula, and refuses to call consistency accuracy when no standard column is supplied.',
    quiz: { q: 'An inspector agrees with the standard on 97% of samples. Defects run at 3%. What have you learned?', options: ['The inspector is excellent', 'Almost nothing: calling everything "pass" scores 97% here, so kappa and the miss rate are the only informative numbers', 'The study needs more samples'], answer: 1, why: 'At 3% prevalence the trivial strategy of passing everything scores 97%. Kappa removes that baseline, and the miss rate says directly how many real defects got through. This is the single commonest way an inspection system is declared qualified when it is blind.' }
  });

  add({
    id: 'count-charts', group: 'Six Sigma and process control', title: 'Counting defects: c, u and p charts',
    analogy: 'A hotel with a different number of rooms every night cannot be judged on "complaints per night". It has to be complaints per room - and the acceptable range tightens on the nights when there are more rooms to complain about.',
    intro: 'Counts do not get a measured spread. For a Poisson count the mean fixes the standard deviation at its square root, so the limits come from the average alone. Which chart you need depends on what you counted: defects with a constant opportunity (c), defects per varying opportunity (u), or defective units out of how many were inspected (p). And real counts often cluster more than Poisson allows, which has to be measured rather than hoped away.',
    demo(el) {
      const MODES = [['c', 'Same opportunity every time (c)'], ['u', 'Varying opportunity (u)'], ['over', 'Counts that cluster (overdispersed)']];
      el.innerHTML = '<div class="demo-controls">' + MODES.map((m, i) => btn(m[0], m[1], i ? 'ghost' : 'primary')).join('') + '</div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const show = sel => {
        el.querySelectorAll('.demo-controls .btn').forEach(b => { b.className = 'btn ' + (b.getAttribute('data-role') === sel ? 'primary' : 'ghost'); });
        const rand = E.rng(37);
        let counts, units = null, r, n;
        if (sel === 'c') { n = 24; counts = range(n).map(() => poisson(5, rand)); r = S.countChart(counts, { kind: 'c' }); }
        else if (sel === 'u') {
          n = 24;
          units = range(n).map(() => 40 + Math.round(rand() * 160));
          counts = units.map(u => poisson(0.06 * u, rand));
          r = S.countChart(counts, { kind: 'u', units });
        } else {
          /* Clustered counts: the rate itself wanders from period to period, which is what
             happens when particles arrive in bursts or one bad lot drives a week of
             deviations. Note the rate wanders point by point - a rate that steps and stays
             is a real signal, not overdispersion, and the chart should flag it rather than
             widen for it. */
          n = 30;
          counts = range(n).map(() => poisson(5 * Math.exp(normal(rand) * 0.6), rand));
          r = S.countChart(counts, { kind: 'c' });
        }
        // Read the limits the result says to read, and show the other pair for comparison.
        const wide = r.overdispersed, lim = wide ? r.laney : r;
        const up = lim.upper, dn = lim.lower, alt = wide ? r : null;
        const plotted = r.plotted;
        const ymax = Math.max(...plotted, ...up) * 1.12;
        const f = frame(640, 270, [-0.5, n - 0.5], [0, ymax], { l: 48, b: 38, xLabel: 'Period', yLabel: sel === 'u' ? 'Defects per unit' : 'Defects' });
        const step = (arr, cls) => '<path class="' + cls + '" d="' + arr.map((v, i) => 'M' + f.sx(i - 0.5) + ' ' + f.sy(v) + 'L' + f.sx(i + 0.5) + ' ' + f.sy(v)).join('') + '"/>';
        const sig = lim.signals;
        q(el, 'plot').innerHTML = svg(640, 270, 'Count chart', f.axes +
          (alt ? step(alt.upper, 'diag') + step(alt.lower, 'diag') : '') +
          step(up, 'ref') + step(dn, 'ref') +
          '<path class="cl-line" d="' + pathOf([[-0.5, r.centre], [n - 0.5, r.centre]], f) + '"/>' +
          plotted.map((v, i) => dot(f.sx(i), f.sy(v), sig.some(s => s.i === i) ? 'c2' : 'c1', 4.5,
            (units ? counts[i] + ' defects in ' + units[i] + ' units' : counts[i] + ' defects') + ' | limit ' + fmt(up[i]), 'circle')).join('')) +
          C.legend([{ label: 'Period', cls: 'c1' }, { label: 'Signal', cls: 'c2' }].concat(alt ? [{ label: 'Textbook Poisson limits (too tight here)', cls: 'bar', shape: 'square' }] : []));
        q(el, 'read').innerHTML = (sel === 'c'
          ? 'Constant opportunity, so one pair of limits for the whole chart: centre <b>' + fmt(r.centre) + '</b>, upper limit <b>' + fmt(up[0]) +
            '</b>, and the lower limit sits at <b>' + fmt(dn[0]) + '</b> because a count cannot go below zero. Nothing was measured to get that width - it came from the mean, since for a Poisson count the mean is the spread.'
          : sel === 'u'
            ? 'The opportunity changes every period (' + Math.min(...units) + ' to ' + Math.max(...units) + ' units inspected), so the limits step: a period with few units gets a wide limit because one defect moves the rate a long way. ' +
              'Plotting raw counts here would flag the busy periods for being busy.'
            : 'These counts come in bursts. Dispersion - the observed scatter against what Poisson allows - measures <b>' + fmt(r.dispersion) +
              '</b>' + (r.overdispersed
                ? '. The textbook Poisson limits (grey) would flag <b>' + r.signals.length + ' of ' + n + '</b> periods; widened by the Laney correction for that extra spread (red), <b>' + r.laney.signals.length +
                  '</b> remain. The correction takes the spread from the period-to-period variation instead of from the mean, which is the only honest source when the rate itself is moving. ' +
                  'The difference between the two charts is a question about what the clusters are - lot, line, shift - not a list of signals.'
                : ', which is close enough to Poisson that the textbook limits stand.')) +
          ' ' + sig.length + ' point' + (sig.length === 1 ? '' : 's') + ' signalled on the chart you are reading.';
      };
      MODES.forEach(m => { q(el, m[0]).onclick = () => show(m[0]); });
      show('c');
    },
    steps: ['Decide what one period counted: defects with a fixed opportunity (c), defects per varying opportunity (u), or defective units out of n inspected (p).', 'The centre line is the overall rate; the limits come from it, not from a measured standard deviation.', 'Check dispersion: divide the observed scatter by what the count distribution allows. Much above 1 means the counts cluster.', 'If they cluster, widen the limits from the between-period variation - the Laney u-prime and p-prime correction - rather than accepting a chart that cries wolf every week.'],
    when: 'Deviations per month, particles per vial, failures per batch, contaminated units per run - anything you counted rather than measured.',
    watch: 'A missing period is not zero defects. Leave it out rather than entering a zero, which drags the centre line down and tightens every limit.',
    where: 'The capability tool offers c, u and p charts, asks for the opportunity size when the chart needs one, and reports the dispersion test with the correction applied rather than silently.',
    quiz: { q: 'A c-chart of monthly deviations flags six of twelve months as out of control, and the process has not changed. What is the most likely explanation?', options: ['The process really is unstable', 'The counts are overdispersed - they cluster - so Poisson limits are too tight', 'The chart needs more months'], answer: 1, why: 'Half the points outside the limits is not a process signal, it is a limits problem. Real deviation counts cluster: one bad lot or one new procedure drives a whole month. Measuring the dispersion and widening the limits accordingly gives a chart that signals when something actually changes.' }
  });

  add({
    id: 'drift-charts', group: 'Six Sigma and process control', title: 'CUSUM and EWMA: catching the drift a Shewhart chart misses',
    analogy: 'A smoke alarm that only sounds for a blaze, next to one that notices the room slowly filling. You want both, and they are not the same device.',
    intro: 'A three-sigma individuals chart judges each point on its own, so it is excellent at spikes and poor at small sustained shifts - a half-sigma drift takes it hundreds of points to notice, by which time a campaign is over. CUSUM adds up the deviations from target and signals when the total gets implausible; EWMA keeps a weighted average that remembers recent history. Both trade spike sensitivity for drift sensitivity.',
    demo(el) {
      el.innerHTML = '<div data-role="plot"></div><div class="demo-controls">' + slider('shift', 'Size of the shift, in sigmas', 0.25, 4, 0.25, 1) + '</div>' +
        '<div data-role="race"></div><p class="demo-read" data-role="read"></p>';
      const AT = 40, WINDOW = 50;
      /* One realisation is a coin toss, so the headline numbers come from repeating the
         whole thing 200 times. The chart below shows a single run so the shapes are visible;
         the bars are what actually happens on average. */
      const RACE = {};
      const race = sh => {
        if (RACE[sh]) return RACE[sh];
        const R = 200, got = [0, 0, 0], sum = [0, 0, 0];
        for (let rep = 0; rep < R; rep++) {
          const rand = E.rng(1000 + rep), n = AT + WINDOW;
          const y = range(n).map(i => 100 + (i >= AT ? sh : 0) + normal(rand));
          const base = y.slice(0, 30), mr = [];
          for (let i = 1; i < base.length; i++) mr.push(Math.abs(base[i] - base[i - 1]));
          const cl = E.mean(base), sg = E.mean(mr) / 1.128;
          const fs = y.findIndex((v, i) => i >= AT && (v > cl + 3 * sg || v < cl - 3 * sg));
          const firsts = [fs, sigOf(S.cusum(y, { baseline: 30 })), sigOf(S.ewma(y, { baseline: 30 }))];
          firsts.forEach((f, k) => { if (f >= 0) { got[k]++; sum[k] += f - AT + 1; } });
        }
        RACE[sh] = [0, 1, 2].map(k => ({ found: got[k], of: R, mean: got[k] ? sum[k] / got[k] : null }));
        return RACE[sh];
      };
      const draw = () => {
        const sh = Number(q(el, 'shift').value);
        setOut(el, 'shift', sh.toFixed(2));
        const rand = E.rng(53), n = AT + WINDOW;
        const y = range(n).map(i => 100 + (i >= AT ? sh : 0) + normal(rand));
        const base = y.slice(0, 30), mr = [];
        for (let i = 1; i < base.length; i++) mr.push(Math.abs(base[i] - base[i - 1]));
        const cl = E.mean(base), sg = E.mean(mr) / 1.128, ucl = cl + 3 * sg, lcl = cl - 3 * sg;
        const fs = y.findIndex((v, i) => i >= AT && (v > ucl || v < lcl));
        const fc = sigOf(S.cusum(y, { baseline: 30 })), fe = sigOf(S.ewma(y, { baseline: 30 }));
        const ylo = Math.min(...y, lcl) - 0.4, yhi = Math.max(...y, ucl) + 0.4;
        const f = frame(640, 290, [-0.5, n - 0.5], [ylo, yhi], { l: 48, b: 36, xLabel: 'Point', yLabel: 'Result', t: 56 });
        // Labels are stacked by row so two charts that signal on the same point stay legible.
        const flag = (idx, label, row) => (idx < 0 ? '' : '<line class="ref" x1="' + f.sx(idx) + '" x2="' + f.sx(idx) + '" y1="' + (16 + row * 13) + '" y2="' + f.sy(ylo) + '"/><text class="lbl-strong" x="' + (f.sx(idx) + 4) + '" y="' + (12 + row * 13) + '">' + label + '</text>');
        q(el, 'plot').innerHTML = svg(640, 290, 'One run, and where each chart first noticed', f.axes +
          '<rect class="usual" x="' + f.sx(AT) + '" y="18" width="' + (f.sx(n - 0.5) - f.sx(AT)) + '" height="' + (f.sy(ylo) - 18) + '"/>' +
          '<path class="ref" d="' + pathOf([[-0.5, ucl], [n - 0.5, ucl]], f) + '"/>' +
          '<path class="ref" d="' + pathOf([[-0.5, lcl], [n - 0.5, lcl]], f) + '"/>' +
          '<path class="cl-line" d="' + pathOf([[-0.5, cl], [n - 0.5, cl]], f) + '"/>' +
          '<path class="line thin" d="' + pathOf(y.map((v, i) => [i, v]), f) + '"/>' +
          y.map((v, i) => dot(f.sx(i), f.sy(v), 'c1', 3)).join('') +
          '<line class="target-line" x1="' + f.sx(AT) + '" x2="' + f.sx(AT) + '" y1="18" y2="' + f.sy(ylo) + '"/>' +
          '<text class="lbl-strong" x="' + f.sx(AT) + '" y="14" text-anchor="middle">shift starts</text>' +
          flag(fs, '3-sigma', 1) + flag(fc, 'CUSUM', 2) + flag(fe, 'EWMA', 3));
        const r = race(sh), names = ['Three-sigma chart', 'CUSUM', 'EWMA'];
        C.hbar(q(el, 'race'), r.map((v, k) => ({
          label: names[k] + (v.mean ? ' (' + v.mean.toFixed(0) + ' pts)' : ''), value: v.found / v.of, cls: v.found === Math.max(...r.map(x => x.found)) ? 'hi' : '',
          text: v.found + '/' + v.of
        })), { min: 0, max: 1 });
        const best = r[1].found >= r[0].found ? 'the memory charts' : 'the plain chart';
        q(el, 'read').innerHTML = 'The process shifts by <b>' + sh.toFixed(2) + ' sigma</b> at point ' + (AT + 1) + ' (shaded), and each chart gets ' + WINDOW +
          ' points to notice. The bars repeat that whole experiment 200 times, because one run is a coin toss: the bar is how often each chart caught the shift at all, and the figure in brackets is how many points it took when it did. ' +
          'All three are tuned to the same false alarm rate - about one in 370 points when nothing is wrong - so this is a fair race. ' +
          'At <b>1 sigma</b> CUSUM catches it in ' + race(1)[1].found + ' runs of 200 after about ' + race(1)[1].mean.toFixed(0) +
          ' points, where the three-sigma chart catches it in only ' + race(1)[0].found + ' and takes about ' + race(1)[0].mean.toFixed(0) + ' when it does. ' +
          'At <b>4 sigma</b> the order reverses: ' + race(4)[0].mean.toFixed(1) + ' points for the plain chart against ' + race(4)[1].mean.toFixed(1) +
          ' for CUSUM, because the slack CUSUM subtracts from every point has to be paid back before the sum can cross. ' +
          'Right now ' + best + ' are ahead. That is the trade, and it is why these run beside the individuals chart rather than instead of it.';
      };
      q(el, 'shift').oninput = draw;
      draw();
    },
    steps: ['Estimate the centre and spread from a baseline window - a stable stretch, or your target - never from all the data, because a centre taken from everything absorbs the drift you are looking for.', 'CUSUM: add up each point’s deviation from target in sigmas, less a slack of half a sigma, and signal when the running total passes 4.77.', 'EWMA: carry 20% of the new point and 80% of history, with limits that widen over the first few points because the average is still filling up.', 'Keep the individuals chart too. The memory charts are slower on a large jump by construction.'],
    when: 'Continuous processes, slow-moving attributes, and anything where a small sustained shift matters more than the occasional spike - stability trends, column performance, fill weight.',
    watch: 'Both are only as good as the baseline. And once CUSUM signals, read the count backwards to when the sum last sat at zero: that is an estimate of when the drift began, which a Shewhart signal cannot give you.',
    where: 'The capability tool runs CUSUM and EWMA beside the individuals chart, states where the baseline came from, and reports when the drift appears to have started.',
    quiz: { q: 'A fill-weight process drifts up by about half a sigma and stays there. Which chart notices first, and roughly how much sooner?', options: ['The three-sigma chart, within a few points', 'CUSUM or EWMA, in about ten points against roughly forty-five', 'They are equivalent at any shift size'], answer: 1, why: 'At a one-sigma shift the memory charts signal after about ten points; the published run length for a three-sigma chart is around 45, and the gap widens sharply as the shift gets smaller. At half a sigma the plain chart is close to blind within any window you would actually look at, which is why a slow drift is usually found months later in a trend review rather than by the chart.' }
  });

  add({
    id: 'rare-events', group: 'Six Sigma and process control', title: 'Rare events: chart the gaps, not the rate',
    analogy: 'A hospital that has gone 300 days without an infection learns nothing from a chart of "infections per month", which reads zero, zero, zero. Charting the days between them turns the good news into data.',
    intro: 'Once events get rare, a count chart is almost all zeros and its limits are useless - the lower limit is zero, so an improvement is invisible, and a single event in a month can breach the upper limit. The fix is to turn the question round and chart the gap between consecutive events: units made between failures, or days between deviations. That distribution is heavily skewed, so its limits cannot be three sigma.',
    demo(el) {
      el.innerHTML = '<div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const rand = E.rng(61);
      /* Twenty gaps. The first twelve run at about one event in 25 units; after an
         improvement the rate drops to about one in 90. The whole point is that this is
         invisible on a chart of events per period, which reads zero either way. */
      const BASE = 12;
      const gaps = range(20).map(i => Math.max(1, Math.round(-Math.log(Math.max(1e-9, rand())) * (i < BASE ? 25 : 90))));
      const r = S.rareEvents(gaps);
      // Centre the run rule on the baseline, not on all the data: a median taken over
      // everything moves with the improvement it is meant to detect.
      const baseMedian = E.median(gaps.slice(0, BASE));
      let run = 0, runEnd = -1;
      gaps.forEach((g, i) => { if (g > baseMedian) { run++; if (run >= r.runLen && runEnd < 0) runEnd = i; } else run = 0; });
      const n = gaps.length, ymax = Math.max(...gaps, r.ucl) * 1.1;
      const f = frame(640, 290, [-0.5, n - 0.5], [0, ymax], { l: 52, b: 38, xLabel: 'Event number', yLabel: 'Units since the previous event' });
      const line = (v, cls) => '<path class="' + cls + '" d="' + pathOf([[-0.5, v], [n - 0.5, v]], f) + '"/>';
      el.querySelector('[data-role="plot"]').innerHTML = svg(640, 290, 'Gaps between rare events, with probability limits', f.axes +
        (runEnd >= 0 ? '<rect class="usual" x="' + f.sx(runEnd - r.runLen + 0.5) + '" y="16" width="' + (f.sx(runEnd + 0.5) - f.sx(runEnd - r.runLen + 0.5)) + '" height="' + (f.sy(0) - 16) + '"/>' : '') +
        line(r.ucl, 'ref') + (r.lclExists ? line(r.lcl, 'ref') : '') +
        line(r.naive.upper, 'diag') + (r.naive.lower > 0 ? line(r.naive.lower, 'diag') : '') +
        line(baseMedian, 'cl-line') +
        '<path class="line thin" d="' + pathOf(gaps.map((v, i) => [i, v]), f) + '"/>' +
        gaps.map((v, i) => dot(f.sx(i), f.sy(v), r.signals.some(s => s.i === i) ? 'c2' : (v > baseMedian ? 'c3' : 'c1'), 5, 'Gap of ' + v + ' units')).join('') +
        '<text class="lbl-strong" x="' + f.sx(n - 0.6) + '" y="' + (f.sy(r.ucl) - 6) + '" text-anchor="end">Probability limit ' + fmt(r.ucl) + '</text>' +
        '<text x="' + f.sx(n - 0.6) + '" y="' + (f.sy(r.naive.upper) - 6) + '" text-anchor="end">Three sigma would say ' + fmt(r.naive.upper) + '</text>' +
        '<text x="' + f.sx(0.2) + '" y="' + (f.sy(baseMedian) - 6) + '">Baseline median ' + fmt(baseMedian) + '</text>') +
        C.legend([{ label: 'Gap at or below the baseline median', cls: 'c1' }, { label: 'Gap above it', cls: 'c3' }]);
      el.querySelector('[data-role="read"]').innerHTML = 'Twenty gaps. The first twelve average about ' + fmt(E.mean(gaps.slice(0, BASE))) +
        ' units between events; after an improvement the later ones average <b>' + fmt(E.mean(gaps.slice(BASE))) + '</b>. ' +
        'A chart of events per period would have read zero, zero, zero throughout and shown none of this. ' +
        'The dashed grey lines are what three sigma would have drawn: an upper limit of <b>' + fmt(r.naive.upper) + '</b> and a lower limit of <b>' + fmt(r.naive.lower) +
        '</b>' + (r.naive.clamped ? ', which is below zero and has to be clamped away' : '') + '. Gaps are strongly right-skewed, so symmetric limits are the wrong shape: they cry wolf on the high side and can never signal on the low side. ' +
        'The probability limit puts the top at <b>' + fmt(r.ucl) + '</b> - the gap carrying the same tail risk a three-sigma chart carries - and ' +
        (r.lclExists ? 'a genuine lower limit at <b>' + fmt(r.lcl) + '</b>.' : 'reports honestly that at this rate no lower limit exists: no gap is short enough to be surprising on its own.') +
        ' So the improvement is not caught by a limit at all but by the run rule: ' +
        (runEnd >= 0
          ? '<b>' + r.runLen + ' consecutive gaps above the baseline median</b> (shaded), which carries a risk of ' + fmt(r.runRisk * 100) + '% by chance - that is the evidence, and it took ' + (runEnd + 1) + ' events to earn it.'
          : 'it needs ' + r.runLen + ' consecutive gaps above the baseline median, and this run has not reached that yet - which is the honest state of the evidence.') +
        ' Note the median comes from the baseline period, not from all the data: a median computed over everything rises with the improvement it is supposed to detect.';
    },
    steps: ['Count units or time between consecutive events rather than events per period.', 'Whole units between events is a g-chart; elapsed time is a t-chart.', 'Set the limits from the tail probabilities of the geometric or exponential distribution, not from three standard deviations.', 'When no lower limit exists, use the run rule at the median: a run of long gaps is how an improvement shows up.'],
    when: 'Any event rare enough that most periods are zero: contamination excursions, sterility failures, line stoppages, serious deviations.',
    watch: 'Charting a rate that is mostly zeros looks stable because the chart cannot move. And the upper limit alone is not a quality improvement claim - one long gap is weak evidence; a run of them is the signal.',
    where: 'The capability tool switches to the gap chart when events are rare, prints the three-sigma limits beside the probability limits so the difference is visible, and names the run rule with its actual risk.',
    quiz: { q: 'Your deviation rate chart has read zero for nine of twelve months. What should you chart instead?', options: ['The same chart with wider limits', 'The number of days between consecutive deviations', 'A yearly total'], answer: 1, why: 'A chart that is nine-twelfths zero has no room to show improvement or deterioration. The gaps between events use every event you have and turn a long quiet stretch into evidence - which is exactly the claim a quality improvement needs to make.' }
  });

  add({
    id: 'box-cox', group: 'Six Sigma and process control', title: 'Box-Cox: making skewed data behave (and when it cannot)',
    analogy: 'Changing the scale on a map. Distances look wrong in Mercator near the poles; redraw the projection and they come right. Redraw it badly and you have simply moved the distortion.',
    intro: 'Cp and Cpk survive a failed normality test because they are ratios. PPM, Z.bench and sigma level do not, because they are normal tail probabilities. Often they can be recovered: find the power that makes the data as bell-shaped as possible, transform the specification limits the same way, and compute the tail there. The discipline is to re-test normality afterwards and stay silent if it still fails.',
    demo(el) {
      el.innerHTML = '<div data-role="plot"></div><div class="demo-controls">' + slider('lam', 'Power applied to the data (lambda)', -1, 2, 0.1, 1) + btn('best', 'Find the best lambda', 'primary') + '</div><p class="demo-read" data-role="read"></p>';
      const rand = E.rng(67);
      /* A right-skewed impurity with a one-sided specification, the usual shape for this
         kind of result. Built as 0.15 + 0.35 x exp(0.6 Z), so the true rate beyond the
         limit can be computed exactly and every estimate below scored against it. */
      const LO = 0.15, SC = 0.35, SD = 0.6, USL = 2.0;
      const raw = range(90).map(() => LO + Math.exp(normal(rand) * SD) * SC);
      const TRUE_PPM = (1 - S.normCdf(Math.log((USL - LO) / SC) / SD)) * 1e6;
      const tf = (v, lam) => (Math.abs(lam) < 1e-8 ? Math.log(v) : (Math.pow(v, lam) - 1) / lam);
      const best = S.boxCoxLambda(raw);
      const draw = () => {
        const lam = Number(q(el, 'lam').value);
        setOut(el, 'lam', lam.toFixed(1));
        const t = raw.map(v => tf(v, lam)), tUsl = tf(USL, lam);
        const ad = TL.andersonDarling(t);
        const m = E.mean(t), s = E.sd(t);
        const z = (tUsl - m) / s, ppm = (1 - S.normCdf(z)) * 1e6;
        const observed = raw.filter(v => v > USL).length;
        C.histogram(q(el, 'plot'), t, { mean: m, sd: s, usl: tUsl, xLabel: 'Result, on the transformed scale', label: 'Transformed data against the transformed specification' });
        q(el, 'read').innerHTML = 'Lambda ' + lam.toFixed(1) + (Math.abs(lam - 1) < 1e-8 ? ' is the raw data, untransformed' : Math.abs(lam) < 1e-8 ? ' is the logarithm' : '') +
          '. Anderson-Darling on the transformed values: p = <b>' + fmt(ad.p) + '</b>, so normality ' + (ad.normal ? '<b>holds</b>' : '<b>still fails</b>') + '. ' +
          'The specification has been transformed with the same power, so it is still the same limit - ' + fmt(USL) + ' becomes ' + fmt(tUsl) + '. ' +
          'The normal tail beyond it reads <b>' + Math.round(ppm).toLocaleString() + ' PPM</b>. This data was built from a known distribution, so the true rate over the limit is <b>' +
          Math.round(TRUE_PPM).toLocaleString() + ' PPM</b>, and ' + observed + ' of ' + raw.length + ' results actually exceeded it. ' +
          (ad.normal ? 'Normality holds on this scale, so that PPM figure is worth reporting.' : 'Normality fails on this scale, so the tool withholds the PPM rather than printing it - the number is exactly as wrong as the shape it assumes.') +
          ' Untransformed, the figure reads about 8 PPM against a truth near ' + Math.round(TRUE_PPM / 1000) + ',000: three orders of magnitude of false comfort. ' +
          'The logarithm (lambda 0) lands within about a fifth of the truth; the maximum-likelihood lambda for this data is <b>' + best.lambda.toFixed(2) +
          '</b> and overshoots it by roughly two and a half times. A transform recovers the order of magnitude - the difference between a real risk and no risk at all - without making the figure exact.';
      };
      q(el, 'lam').oninput = draw;
      q(el, 'best').onclick = () => { q(el, 'lam').value = Math.max(-1, Math.min(2, Math.round(best.lambda * 10) / 10)); draw(); };
      draw();
    },
    steps: ['Test the shape first. If normality holds, no transform is needed and applying one only costs interpretability.', 'Search the power lambda by profile likelihood: lambda = 0 is the logarithm, 0.5 the square root, 1 no change, −1 the reciprocal.', 'Transform the specification limits with the same power. A transform applied to the data but not the limits produces a confident, meaningless number.', 'Re-test normality on the transformed values and withhold the tail figures if it still fails. No power of a two-humped variable is bell-shaped.'],
    when: 'When a capability study on skewed data needs PPM or sigma level, and the ratios alone are not enough for the decision.',
    watch: 'Box-Cox needs positive data. Bimodal data will not transform - that is two populations, and the fix is to find out what separates them. And the transformed Cpk is on a transformed scale: report it as such rather than comparing it with an untransformed one.',
    where: 'The capability panel runs this automatically when normality fails, reports the lambda it found, shows the re-test, and keeps the figures withheld when the re-test fails too.',
    quiz: { q: 'A skewed impurity fails normality. You transform with lambda = 0.3 and the re-test still fails, but the PPM now looks sensible. What should you report?', options: ['The transformed PPM, since it is more reasonable than the raw one', 'Cp and Cpk, the observed out-of-specification count, and that the tail figures cannot be computed', 'The raw PPM with a caveat'], answer: 1, why: 'A figure that looks reasonable is not the test; the test is whether the distribution it assumes fits. Cp, Cpk and the observed count need no distribution at all, so they stand. A tail probability from a shape that has twice failed its test is a guess wearing a number, and a blank with a reason attached is worth more.' }
  });

  add({
    id: 'distribution-free', group: 'Six Sigma and process control', title: 'Distribution-free limits: what the ranking alone can prove',
    analogy: 'Asking the tallest of ten people to stand for "taller than 99% of the country". With ten people it is a guess; with three hundred it is nearly a fact. The claim depends on the crowd size, not on anyone being measured more carefully.',
    intro: 'A normal-theory tolerance interval is efficient and leans hard on the shape of the tails - exactly where a wrong distribution does the most damage. There is an alternative that assumes nothing at all: use the largest observed value as the limit, and ask what confidence the sample size alone buys. The arithmetic is simple, the honesty is total, and the cost is sample size.',
    demo(el) {
      el.innerHTML = '<div data-role="plot"></div><div class="demo-controls">' + slider('n', 'Results you have', 10, 400, 5, 30) +
        slider('cov', 'Share of production to cover (%)', 90, 99.5, 0.5, 99) + '</div><p class="demo-read" data-role="read"></p>';
      const draw = () => {
        const n = Number(q(el, 'n').value), cov = Number(q(el, 'cov').value) / 100;
        setOut(el, 'n', n); setOut(el, 'cov', (cov * 100).toFixed(1));
        /* The largest of n results is above the coverage quantile unless every one of the n
           fell below it, so the confidence is 1 - coverage^n. One line, no distribution. */
        const conf = 1 - Math.pow(cov, n);
        const need = TL.nonParametricN(cov, 0.95, 'one');
        const f = frame(640, 250, [10, 400], [0, 1], { l: 52, b: 38, xLabel: 'Number of results', yLabel: 'Confidence the largest value covers it' });
        const curve = range(79).map(i => { const k = 10 + i * 5; return [k, 1 - Math.pow(cov, k)]; });
        q(el, 'plot').innerHTML = svg(640, 250, 'Confidence from the ranking alone', f.axes +
          '<path class="ref" d="' + pathOf([[10, 0.95], [400, 0.95]], f) + '"/>' +
          '<text class="lbl-strong" x="' + f.sx(395) + '" y="' + (f.sy(0.95) - 6) + '" text-anchor="end">95% confidence</text>' +
          '<path class="line" d="' + pathOf(curve, f) + '"/>' +
          dot(f.sx(n), f.sy(conf), 'c2', 6, n + ' results: ' + pct(conf)) +
          (need <= 400 ? '<line class="target-line" x1="' + f.sx(need) + '" x2="' + f.sx(need) + '" y1="14" y2="' + f.sy(0) + '"/><text class="lbl-strong" x="' + f.sx(need) + '" y="11" text-anchor="middle">' + need + ' needed</text>' : ''));
        q(el, 'read').innerHTML = 'With <b>' + n + '</b> results, the largest one covers ' + pct(cov) + ' of production with <b>' + pct(conf) +
          '</b> confidence. The whole calculation is 1 &minus; ' + cov.toFixed(3) + '<sup>' + n + '</sup>: the largest value fails only if every single result landed below the ' +
          pct(cov) + ' point. No distribution appears anywhere - which is the point. ' +
          'For the usual claim of ' + pct(cov) + ' coverage at 95% confidence you need <b>' + need + '</b> results' +
          (need > 400 ? ', beyond the right-hand edge of this chart.' : ', marked on the chart.') +
          ' The normal-theory factor gets there with about ten, and that gap is the price of the assumption: ten results plus a shape you have assumed, against ' + need +
          ' results and nothing assumed at all. Below the threshold the tool refuses the claim and states what the data does reach, rather than quietly reporting the normal figure.';
      };
      q(el, 'n').oninput = draw; q(el, 'cov').oninput = draw;
      draw();
    },
    steps: ['Rank the results and take the largest (or smallest, for a lower limit) as the candidate limit.', 'Confidence that it covers the chosen share of production is one minus that share raised to the power n.', 'Invert it for planning: for 99% coverage at 95% confidence you need 299 results, for 95% coverage 59.', 'Report it beside the normal-theory interval, not instead of it - the gap between the two is the size of the assumption you are making.'],
    when: 'Whenever a specification is being defended on data that fails or cannot be shown to pass a normality test, and whenever a reviewer may ask what the claim rests on.',
    watch: 'The bound is one of your observed values, so it can never be tighter than your data and gets no credit for a tidy distribution. It also assumes the results are independent and representative - 299 results from three batches are not 299 independent results.',
    where: 'The tolerance tool reports the distribution-free bound beside the normal factor, with the Anderson-Darling verdict and the sample size the claim would need.',
    quiz: { q: 'You have 30 results on a right-skewed impurity and need a limit covering 99% of production at 95% confidence. What can you honestly offer?', options: ['The normal-theory interval, since 30 is a reasonable sample', 'Neither claim at this confidence: say so, report what 30 results do reach, and state that 299 would be needed distribution-free', 'The largest observed value, as a 95% limit'], answer: 1, why: 'The normal interval needs a shape the data contradicts, and the ranking of 30 results reaches only about 26% confidence for a 99% claim. The useful answer names the gap and the sample size that would close it, which is something a reviewer can act on - unlike a number that will not survive being asked about.' }
  });

  add({
    id: 'linearity', group: 'Validating an analytical method', title: 'Linearity is not r-squared',
    analogy: 'A ruler that reads two centimetres long at one end still correlates beautifully with length. The correlation was never the question.',
    intro: 'ICH Q2 asks for the slope, the intercept, the correlation, the residual sum of squares and a plot of the residuals. The plot is on that list because the numbers cannot show curvature and the picture can. A response that bends gently across the range returns an r-squared any acceptance criterion would wave through, and the residuals give it away immediately.',
    demo(el) {
      el.innerHTML = '<div class="demo-grid"><div><h4>The calibration curve</h4><div data-role="cal"></div></div>' +
        '<div><h4>The residuals, which is where it shows</h4><div data-role="res"></div></div></div>' +
        '<div class="demo-controls">' + slider('bend', 'How much the response bends', 0, 0.006, 0.0005, 0.004) + '</div><p class="demo-read" data-role="read"></p>';
      const draw = () => {
        const bend = Number(q(el, 'bend').value);
        setOut(el, 'bend', bend.toFixed(4));
        const conc = [], resp = [];
        for (const c of [50, 75, 100, 125, 150]) for (const d of [-0.3, 0.3]) { conc.push(c); resp.push(2.5 * c + 10 - bend * c * c + d); }
        const lin = Q2.linearity(conc, resp);
        const f = frame(300, 230, [40, 160], [Math.min(...resp) - 20, Math.max(...resp) + 20], { l: 44, b: 34, xLabel: 'Concentration' });
        q(el, 'cal').innerHTML = svg(300, 230, 'Response against concentration', f.axes +
          '<path class="line" d="' + pathOf([[40, lin.intercept + lin.slope * 40], [160, lin.intercept + lin.slope * 160]], f) + '"/>' +
          conc.map((c, i) => dot(f.sx(c), f.sy(resp[i]), 'c1', 4)).join(''));
        const rmax = Math.max(0.6, Math.max(...lin.residuals.map(Math.abs)) * 1.3);
        const g = frame(300, 230, [40, 160], [-rmax, rmax], { l: 44, b: 34, xLabel: 'Concentration' });
        q(el, 'res').innerHTML = svg(300, 230, 'Residual against concentration', g.axes +
          '<path class="cl-line" d="' + pathOf([[40, 0], [160, 0]], g) + '"/>' +
          conc.map((c, i) => dot(g.sx(c), g.sy(lin.residuals[i]), lin.linear ? 'c1' : 'c2', 4)).join(''));
        q(el, 'read').innerHTML = 'r&sup2; = <b>' + lin.r2.toFixed(5) + '</b>' +
          (lin.r2 > 0.99 ? ' - through any "r&sup2; above 0.99" criterion' : '') +
          '. Lack-of-fit test: p = <b>' + (lin.lackOfFit.p < 0.0001 ? '&lt;0.0001' : lin.lackOfFit.p.toFixed(4)) + '</b>, so the verdict is <b>' +
          (lin.linear ? 'linear' : 'not linear') + '</b>. ' +
          (lin.linear
            ? 'With no bend the residuals scatter either side of zero with no pattern, which is what linearity looks like.'
            : 'Look at the right-hand plot: the residuals form a smile. The straight line sits above the data at both ends and below it in the middle, and no amount of r&sup2; will tell you that. The test compares what the line misses against what the method misses on repeat measurements of the same standard - which is why replicating at least one level matters.');
      };
      q(el, 'bend').oninput = draw;
      draw();
    },
    steps: ['Prepare at least five concentration levels across the range, and replicate at least one of them.', 'Fit the line and report slope, intercept, residual standard deviation and the correlation.', 'Test the shape: lack of fit against pure error where you have replicates, a fitted squared term where you do not.', 'Plot the residuals against concentration and look at them. A smile or a frown is curvature; a fan is non-constant variance and calls for weighting.'],
    when: 'Every method validation, and again whenever the range is extended or the detection changes.',
    watch: 'r-squared rises with the spread of the standards, so widening the range flatters it. A high r-squared on a bent response is the normal case, not an unlucky one.',
    where: 'The limits bench, third mode. The example it ships with is exactly this trap: r&sup2; of 0.995 on a response that bends.',
    quiz: { q: 'Your calibration returns r² = 0.9995 and the residuals form a clear U shape. What do you report?', options: ['Linear: r² comfortably exceeds the criterion', 'Not linear over this range: the U is curvature the correlation cannot see', 'Linear, but add a note about the residuals'], answer: 1, why: 'The U means the straight line is systematically wrong at the ends and in the middle, so predictions from it are biased by position in the range. That is what non-linear means. Either narrow the range to the part that is straight, or fit and validate the curve you actually have.' }
  });

  add({
    id: 'detection-limits', group: 'Validating an analytical method', title: 'LOD and LOQ: where the formula stops knowing',
    analogy: 'Holding a tape measure past its end and reading a number off the air. The arithmetic is fine; there is just nothing there.',
    intro: 'The detection limit is 3.3 times sigma over the slope, and the quantitation limit is 10 times sigma over the slope. Two things in that sentence do the damage. Sigma has three permitted meanings and they do not agree. And the formula will happily return a concentration far below anything anybody measured, because dividing does not know where your standards were.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + btn('residual', 'Sigma = residual SD', 'primary') + btn('intercept', 'Sigma = SE of intercept', 'ghost') + '</div>' +
        '<div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const rand = E.rng(21);
      const conc = [], resp = [];
      for (const c of [50, 75, 100, 125, 150]) for (const d of [0, 1]) { conc.push(c); resp.push(2.5 * c + 10 + normal(rand) * 3); }
      const lin = Q2.linearity(conc, resp);
      const show = which => {
        el.querySelectorAll('.demo-controls .btn').forEach(b => { b.className = 'btn ' + (b.getAttribute('data-role') === which ? 'primary' : 'ghost'); });
        const lim = Q2.detectionLimits(lin, { sigma: which });
        const other = Q2.detectionLimits(lin, { sigma: which === 'residual' ? 'intercept' : 'residual' });
        const hi = 170;
        const f = frame(640, 170, [0, hi], [0, 1], { l: 40, b: 36, xLabel: 'Concentration', yFmt: () => '' });
        const mark = (v, lab, cls) => (v > hi ? '' : '<line class="' + cls + '" x1="' + f.sx(v) + '" x2="' + f.sx(v) + '" y1="30" y2="110"/>' +
          '<text class="lbl-strong" x="' + f.sx(v) + '" y="24" text-anchor="middle">' + lab + '</text>');
        q(el, 'plot').innerHTML = svg(640, 170, 'Where the limits fall against the standards that were run', f.axes +
          '<rect class="usual" x="' + f.sx(lin.range[0]) + '" y="40" width="' + (f.sx(lin.range[1]) - f.sx(lin.range[0])) + '" height="60"/>' +
          '<text x="' + f.sx((lin.range[0] + lin.range[1]) / 2) + '" y="76" text-anchor="middle" class="lbl-strong">standards actually run</text>' +
          [...new Set(conc)].map(c => dot(f.sx(c), 100, 'c1', 4)).join('') +
          mark(lim.lod, 'LOD ' + lim.lod.toPrecision(3), 'ref') + mark(lim.loq, 'LOQ ' + lim.loq.toPrecision(3), 'target-line'));
        q(el, 'read').innerHTML = 'With sigma taken from ' + h(lim.sigmaSource) + ', LOQ = <b>' + lim.loq.toPrecision(4) +
          '</b>. Switch to the other sigma and the same data gives <b>' + other.loq.toPrecision(4) + '</b> - a factor of ' +
          (Math.max(lim.loq, other.loq) / Math.min(lim.loq, other.loq)).toFixed(1) + ' between two answers both permitted by the guideline, which is why the one you used has to be reported with the number. ' +
          (lim.loqInRange
            ? 'Here the limit falls inside the shaded band, so it rests on measurements.'
            : 'Both fall well below the shaded band: nobody ran a standard anywhere near them. The line was extended into a region the method was never shown to work in. ICH expects the limit to be confirmed by analysing samples at about that level, and until that is done the number is an estimate of where the limit might be - not a validated limit.');
      };
      q(el, 'residual').onclick = () => show('residual');
      q(el, 'intercept').onclick = () => show('intercept');
      show('residual');
    },
    steps: ['Fit the calibration first: both limits are built from its slope and its spread.', 'Choose sigma and say which: the residual standard deviation of the regression, the standard error of the intercept, or the standard deviation of the blank.', 'LOD = 3.3 sigma / slope, LOQ = 10 sigma / slope.', 'Check where the answer falls. If it is below your lowest standard, it is an extrapolation, and confirming it means running samples at about that level and showing the method performs there.'],
    when: 'Impurity and degradation methods, residual testing, anything where the question is whether a small amount is present.',
    watch: 'A quantitation limit quoted without its sigma is not reproducible: the three permitted choices can differ by several fold on the same data. And a limit far below the calibration range is a prediction about untested territory.',
    where: 'The limits bench, third mode, reported beside the linearity with the sigma named and the range checked.',
    quiz: { q: 'Standards ran from 80 to 120% of nominal. The computed LOQ is 0.4% of nominal. What is the honest reporting?', options: ['LOQ is 0.4% of nominal', 'The formula gives 0.4%, which is two hundred times below the lowest standard, so it must be confirmed by analysis at that level before it is a limit', 'Set LOQ to the lowest standard, 80%'], answer: 1, why: 'The formula extends the fitted line into a region nobody measured. The method may be perfectly good there, or hopeless, and this data cannot tell you which. Confirming it is a short experiment; quoting it unconfirmed is a claim you cannot defend when asked.' }
  });

  add({
    id: 'robustness-study', group: 'Validating an analytical method', title: 'Robustness: what "no significant effect" is worth',
    analogy: 'A metal detector that is switched off also reports no metal. Before you trust the all-clear, check the batteries.',
    intro: 'A robustness study varies method parameters on purpose - pH, temperature, flow rate - and looks for an effect on the result. Finding none is the expected outcome of a small study whether the method is robust or not, because eight runs cannot see much. So the number that matters is not the p-value; it is the smallest effect the study could have detected.',
    demo(el) {
      el.innerHTML = '<div data-role="plot"></div><div class="demo-controls">' + slider('noise', 'Run-to-run variation of the assay', 0.2, 3, 0.1, 2) +
        slider('acc', 'Effect you would call acceptable', 0.5, 4, 0.5, 1) + '</div><p class="demo-read" data-role="read"></p>';
      const draw = () => {
        const sd = Number(q(el, 'noise').value), acc = Number(q(el, 'acc').value);
        setOut(el, 'noise', sd.toFixed(1)); setOut(el, 'acc', acc.toFixed(1));
        const rand = E.rng(5), runs = [];
        for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) {
          runs.push({ factors: { pH: a === 1 ? 3.1 : 2.9, Temperature: b === 1 ? 32 : 28, FlowRate: c === 1 ? 1.05 : 0.95 },
            response: 100 + 1.2 * a + normal(rand) * sd });
        }
        const r = Q2.robustness(runs, { acceptable: acc });
        C.hbar(q(el, 'plot'), r.effects.map(e => ({
          label: e.factor, value: Math.abs(e.effect), cls: e.p < 0.05 ? 'accent' : '',
          text: 'effect ' + e.effect.toFixed(2) + ', p ' + (e.p < 0.001 ? '<0.001' : e.p.toFixed(3))
        })), { min: 0, max: Math.max(acc, r.minimumDetectableEffect, ...r.effects.map(e => Math.abs(e.effect))) * 1.15, ref: { value: r.minimumDetectableEffect, label: 'smallest detectable' } });
        q(el, 'read').innerHTML = 'pH really does move the result, by 2.4 units from its low setting to its high one. ' +
          'At this level of run-to-run variation the study can only reliably detect an effect of <b>' + r.minimumDetectableEffect.toFixed(2) +
          '</b>, against the <b>' + acc.toFixed(1) + '</b> you said you would accept. Verdict: <b>' + h(r.verdict) + '</b>. ' +
          (r.underpowered
            ? 'So finding nothing here would say nothing about the method. Turn the variation down, or add runs, until the smallest detectable effect drops below what you care about - then an all-clear means something.'
            : 'The study could have seen an effect that mattered, so its answer is worth having.');
      };
      q(el, 'noise').oninput = draw; q(el, 'acc').oninput = draw;
      draw();
    },
    steps: ['List the method parameters an analyst might plausibly get slightly wrong, and the small deliberate variation for each.', 'Run a small two-level design over them - a fractional factorial or Plackett-Burman keeps the run count down.', 'Decide beforehand what size of effect would actually matter, in the units of the result.', 'Report each effect with its interval, and the smallest effect the design could detect. If that is bigger than what matters, the study is uninformative rather than reassuring.'],
    when: 'Before a method transfers to another site or another analyst, which is when small deviations start happening for real.',
    watch: 'This is the same trap as reading a large p-value as proof of no difference, and it is worse here because the study is deliberately small. Robustness studies are routinely declared passed on designs that could not have detected a problem twice the size of the specification.',
    where: 'The limits bench, third mode: pick Robustness, give the acceptable effect, and every p-value is reported beside the smallest effect the design could see.',
    quiz: { q: 'Eight runs, three parameters, nothing significant, and the smallest detectable effect is 4% against a specification window of ±2%. What does the study show?', options: ['The method is robust to all three parameters', 'Nothing useful: it could not have detected a problem twice the size of the whole specification window', 'The method is robust to within 4%'], answer: 1, why: 'A study blind to anything smaller than 4% cannot reassure you about a 2% window. The all-clear is a property of the design, not of the method. More runs or tighter execution is the fix; reporting it as a pass is how a fragile method reaches another site.' }
  });

  add({
    id: 'forecast-backtest', group: 'Six Sigma and process control', title: 'Forecasting: the baseline you have to beat',
    analogy: 'A weather forecaster who says "tomorrow will be like today" is right most of the time. Anything cleverer has to beat that, and a surprising amount of it does not.',
    intro: 'Any method can be made to fit a line of history beautifully, because it was fitted to that history. The only question worth asking is how it does on points it had not seen. So every method here is scored by rolling origin - fit on what came before, forecast forward, compare with what actually happened, move on - and the score is the error divided by what the dullest possible forecast achieves.',
    demo(el) {
      const CASES = [['noise', 'A metric that just wobbles'], ['trend', 'A metric that is drifting'], ['season', 'A metric with an annual cycle']];
      el.innerHTML = '<div class="demo-controls">' + CASES.map((c, i) => btn(c[0], c[1], i ? 'ghost' : 'primary')).join('') + '</div>' +
        '<div data-role="series"></div><div data-role="board"></div><p class="demo-read" data-role="read"></p>';
      const show = which => {
        el.querySelectorAll('.demo-controls .btn').forEach(b => { b.className = 'btn ' + (b.getAttribute('data-role') === which ? 'primary' : 'ghost'); });
        const rand = E.rng(5), n = 48;
        const y = range(n).map(i => {
          if (which === 'trend') return 100 + 0.7 * i + normal(rand) * 2.5;
          if (which === 'season') return 100 + 7 * Math.sin(2 * Math.PI * i / 12) + normal(rand) * 1.5;
          return 100 + normal(rand) * 2.5;
        });
        const r = FC.backtest(y, which === 'season' ? { period: 12, horizon: 1 } : { horizon: 1 });
        const f = frame(640, 190, [0, n - 1], [Math.min(...y) - 2, Math.max(...y) + 2], { l: 46, b: 34, xLabel: 'Period' });
        q(el, 'series').innerHTML = svg(640, 190, 'The series', f.axes +
          '<path class="line thin" d="' + pathOf(y.map((v, i) => [i, v]), f) + '"/>' +
          y.map((v, i) => dot(f.sx(i), f.sy(v), 'c1', 2.5)).join(''));
        C.hbar(q(el, 'board'), r.results.map(m => ({
          label: m.name.replace(/ \(.*\)$/, '') + (m.baseline ? ' (baseline)' : ''),
          value: m.mase, cls: m.key === r.winner.key ? 'hi' : m.baseline ? 'accent' : '',
          text: 'MASE ' + m.mase.toFixed(3)
        })), { min: 0, max: Math.max(1.1, ...r.results.map(m => m.mase)) * 1.1, ref: { value: 1, label: 'baseline' } });
        q(el, 'read').innerHTML = 'Scored over <b>' + r.origins + '</b> separate forecasts, each made without seeing what came next. Best: <b>' +
          h(r.winner.name) + '</b> at MASE ' + r.winner.mase.toFixed(3) + '. ' +
          (r.beatsBaseline === false
            ? '<b>Nothing beat the baseline.</b> On this series the dullest forecast is as good as anything tried, so that is what you should use - and a method that cannot beat it has earned nothing, however convincing its chart looks.'
            : 'That beats the ' + h(r.baseline.name.toLowerCase()) + ' baseline at ' + r.baseline.mase.toFixed(3) + ', so it is earning its place.') +
          (which === 'noise'
            ? ' Note what smoothing achieves here even though there is no signal at all: averaging beats carrying the last value forward, because the last value is pure noise. That is a real gain, and it is also the ceiling - no method can predict noise.'
            : which === 'trend'
              ? ' A drifting series is where trend methods pay off, and where the naive forecast is always one step behind.'
              : ' With a cycle, the baseline becomes "the same month last year", which is a much harder thing to beat than "last month".');
      };
      CASES.forEach(c => { q(el, c[0]).onclick = () => show(c[0]); });
      show('noise');
    },
    steps: ['Pick the horizon that matters: where the metric lands next month is a different question from next year, and a different method may win.', 'Score by rolling origin, never on the data the method was fitted to. Parameters have to be fitted inside each origin too, or the method has seen the future.', 'Judge against a baseline: carrying the last value forward, or the same point last cycle for a seasonal series. MASE is the error divided by what that baseline achieves.', 'If nothing beats the baseline, use the baseline. That is a result, not a failure.'],
    when: 'Monthly process metrics, deviation counts, utility demand, anything where somebody asks where a number is heading.',
    watch: 'A forecast assumes the future behaves like the past. A line modification, a new raw-material supplier or a process change breaks that, and no amount of backtesting on the old regime will warn you. And MASE is scaled by the one-step baseline error, so at longer horizons figures above 1 are normal - the comparison against the baseline row is what decides it.',
    where: 'The trends bench: pick the forecast mode, give it the series column, a cycle length if it repeats, and how far ahead. The leaderboard is the backtest, not the fit.',
    quiz: { q: 'A vendor shows you a forecasting model with R² of 0.94 on your historical data. What should you ask for?', options: ['The confidence intervals', 'Its MASE against a naive baseline, scored by rolling origin on data it never saw', 'A larger training set'], answer: 1, why: 'R² on fitted history measures how well it described the past, which any flexible method can do perfectly. The only number that matters is how it did on points it had not seen, against the dullest forecast available. If it cannot beat "carry the last value forward" on your own series, it has earned nothing - and you can run that comparison yourself in this tool before anyone signs anything.' }
  });





  add({
    id: 'multi-attribute', group: 'Six Sigma and process control', title: 'A dozen things must all pass: two surprises',
    analogy: 'A relay team of twelve. To win, every runner must beat their opponent - so the team is exactly as fast as its slowest leg, and knowing all twelve individual times tells you nothing until you ask which one loses. Now the part people get wrong: if each runner wins 80% of the time, the team does not win 80% of the time. It wins far less. But if they all train together and have good and bad days together, it wins rather more than the arithmetic of independence suggests.',
    intro: 'A site transfer covers every quality attribute that matters, and the usual approach is a separate equivalence test for each. That gives a dozen verdicts and no answer. Joining them changes two things, in opposite directions, and both are routinely got backwards: one of them is free money people leave on the table, and the other is a study that was never going to work.',
    demo(el) {
      const CASES = [['free', 'The correction you must not apply'], ['cost', 'Where the real cost is'], ['corr', 'Why correlation is good news']];
      el.innerHTML = '<div class="demo-controls">' + CASES.map((c, i) => btn(c[0], c[1], i ? 'ghost' : 'primary')).join('') + '</div>' +
        '<div data-role="bars"></div><p class="demo-read" data-role="read"></p>';
      const equi = (k, rho) => range(k).map(i => range(k).map(j => (i === j ? 1 : rho)));
      /* Every attribute sitting exactly on its margin is the worst case for a false pass, so
         it is the case the type I error claim has to survive. */
      const falsePass = (k, rho) => CB.combinedPower(range(k).map(() => ({ sd: 1, margin: 1, assumedDiff: 1 })), equi(k, rho), 20, { alpha: 0.05, reps: 2500, seed: 41 });
      // And a margin of 0.9424 sigma at 20 per side is exactly 80% power for one attribute.
      const power = (k, rho) => CB.combinedPower(range(k).map(() => ({ sd: 1, margin: 0.9424, assumedDiff: 0 })), equi(k, rho), 20, { alpha: 0.05, reps: 2500, seed: 11 });

      const show = which => {
        el.querySelectorAll('.demo-controls .btn').forEach(b => { b.className = 'btn ' + (b.getAttribute('data-role') === which ? 'primary' : 'ghost'); });

        if (which === 'free') {
          const ks = [1, 3, 6, 12, 20];
          const got = ks.map(k => falsePass(k, 0.9));
          C.hbar(q(el, 'bars'), ks.map((k, i) => ({
            label: k + ' attribute' + (k === 1 ? '' : 's'), value: 100 * got[i],
            cls: i === 0 ? 'hi' : '', text: (100 * got[i]).toFixed(1) + '%  (Bonferroni would demand ' + (5 / k).toFixed(2) + '%)'
          })), { min: 0, max: 6, ref: { value: 5, label: '5% claimed' }, label: 'How often the whole transfer wrongly passes, every attribute sitting exactly on its margin' });
          q(el, 'read').innerHTML = '<b>Twelve tests, and no correction.</b> That feels wrong, and it is right. To wrongly declare the sites comparable you would have to wrongly pass <i>every single attribute</i> - so the chance of a false overall pass is at most the chance for one, which is the ' +
            '5% each test already claims. This is an intersection-union test, and it is the mirror image of the usual multiplicity problem: there, you win if ANY test fires, so more tests means more false alarms. Here you win only if ALL of them pass, so more tests makes a false pass <i>harder</i>.' +
            '<br><br>Look at the direction on the bars. The false-pass rate does not creep up as attributes are added, it <b>falls</b> - to about <b>' + (100 * got[3]).toFixed(1) +
            '%</b> at twelve attributes, against the <b>' + (5 / 12).toFixed(2) + '%</b> a Bonferroni split would hold you to. So the reflex is not merely unnecessary here, it is conservative on top of something already conservative, and every batch it costs is a batch nobody needed to make. If somebody asks you to divide alpha across your CQAs, this chart is the answer.';
          return;
        }

        if (which === 'cost') {
          const ks = [1, 3, 6, 12];
          const got = ks.map(k => power(k, 0));
          C.hbar(q(el, 'bars'), ks.map((k, i) => ({
            label: 'all ' + ks[i] + ' must pass', value: 100 * got[i],
            cls: i === ks.length - 1 ? 'bad' : '', text: (100 * got[i]).toFixed(0) + '%'
          })), { min: 0, max: 100, ref: { value: 80, label: '80% for one' }, label: 'Chance the whole transfer passes, each attribute independently powered at 80%' });
          q(el, 'read').innerHTML = 'Here is the bill for the free lunch. Each of these attributes passes on its own <b>80%</b> of the time - a perfectly respectable study by any per-attribute calculation. Three of them together: <b>' +
            (100 * got[1]).toFixed(0) + '%</b>. Six: <b>' + (100 * got[2]).toFixed(0) + '%</b>. Twelve: <b>' + (100 * got[3]).toFixed(0) +
            '%</b>, which is 0.8 multiplied by itself twelve times. You would book the batches, run the study, and have roughly a one-in-fourteen chance of the transfer passing even if the two sites were genuinely identical.' +
            '<br><br>This is the number that is missing from almost every transfer protocol, because the sample size was calculated attribute by attribute and nothing joined them. And note which way the error runs: the per-attribute calculation always says the study is <i>big enough</i>. Nobody discovers otherwise until the data is in and an attribute has failed, at which point the argument is about that attribute rather than about the design.';
          return;
        }

        const RHO = [0, 0.3, 0.6, 0.9];
        const got = RHO.map(r => power(12, r));
        C.hbar(q(el, 'bars'), RHO.map((r, i) => ({
          label: 'correlation ' + r.toFixed(1) + (r === 0 ? ' (independent)' : ''), value: 100 * got[i],
          cls: i === 0 ? 'bad' : i === RHO.length - 1 ? 'hi' : '', text: (100 * got[i]).toFixed(0) + '%'
        })), { min: 0, max: 100, ref: { value: 80, label: '80% for one' }, label: 'Twelve attributes, each powered at 80%: chance all twelve pass, by how correlated they are' });
        q(el, 'read').innerHTML = 'The 0.8<sup>12</sup> figure assumes the attributes are <b>independent</b>, and they are not. They are measured on the same batches, so they share batch-level variation: a batch that runs a little high runs a little high on several attributes at once. That means they tend to pass or fail <i>together</i> - and for a claim that needs all of them, togetherness is exactly what you want.' +
          '<br><br>Measured: twelve attributes at 80% each reach <b>' + (100 * got[0]).toFixed(0) + '%</b> if independent, <b>' + (100 * got[1]).toFixed(0) +
          '%</b> at a correlation of 0.3, <b>' + (100 * got[2]).toFixed(0) + '%</b> at 0.6, and <b>' + (100 * got[3]).toFixed(0) +
          '%</b> at 0.9. So the pessimistic number is wrong by a factor of several, and the optimistic number - "each one is at 80%, so we are fine" - is wrong by a factor of several in the other direction. Both of the figures people reach for are wrong, which is the whole reason this is worth computing rather than assuming.' +
          '<br><br>And it is computable: the correlation is a property of your own attributes, and it can be measured from the same data. Where the same batches were run at both sites, the per-batch differences for each attribute are correlated directly. The tool recovers a known correlation of 0.3 as 0.31, 0.6 as 0.60 and 0.9 as 0.90, so the figure it gives you is measured rather than borrowed.';
      };
      CASES.forEach(c => { q(el, c[0]).onclick = () => show(c[0]); });
      show('free');
    },
    steps: [
      'Declare a margin for every attribute before the study, in that attribute’s own units. One margin across a dozen attributes is meaningless: 2.5% is generous on a purity of 98% and a seventh of the noise on an aggregate of 1.1%.',
      'Do NOT split alpha across the attributes. Requiring all of them to pass already controls the false-pass rate, and correcting it again costs batches for nothing.',
      'Compute the chance that ALL of them pass, not each one separately. That is the study’s real power and it is the number a per-attribute calculation hides.',
      'Measure the correlation between the attributes rather than assuming independence. Independence is the pessimistic end, and real attributes on shared batches do better.',
      'Size for the combined claim, and take that number to whoever books the batches. Then watch the binding attribute - the whole transfer is exactly as strong as its weakest member.'
    ],
    when: 'Site transfers, scale changes, a new contract manufacturer, a process change needing comparability, a bridging study - anywhere a decision rests on several attributes all being acceptable at once rather than on any single one.',
    watch: 'The margins are a judgement and must come first: a margin chosen after seeing the data is not a test, and the tool refuses to invent one. Two sites at a time - three receiving sites at once is a different claim that multiplies the same problem again. And the combined power is what says whether a pass meant anything: failing to find a difference is never evidence of sameness, which is the reason this is an equivalence test and not a t-test.',
    where: 'The equivalence bench, second mode: give it the attribute column, the site column, the result, and a margin per attribute. Three example transfers are on the buttons there, including one where eleven attributes pass and the twelfth fails.',
    quiz: { q: 'A transfer protocol lists twelve CQAs, each sized for 80% power, and QA asks you to Bonferroni-correct the twelve equivalence tests to protect against multiplicity. What do you tell them?', options: ['Agree: twelve tests need a correction, so each should be tested at 0.05/12', 'No correction is needed, because every attribute must pass for the transfer to pass - but raise the opposite problem, that twelve attributes at 80% each give roughly a 7% chance of the whole transfer passing if they are independent', 'Agree to correct, and increase the sample size to compensate'], answer: 1, why: 'Multiplicity corrections protect you when you win by ANY test firing - more shots, more false alarms. Here you win only if EVERY test passes, so adding attributes makes a false pass harder, not easier: measured with every attribute exactly on its margin, the false-pass rate falls to about 1.2% by twelve attributes, already stricter than the 0.42% Bonferroni would impose. Correcting costs batches and buys nothing. The real problem is the one QA has not raised: the combined power. Twelve attributes at 80% each is 0.8 to the twelfth if they are independent, and that study would probably fail on a pair of identical sites. Measure the correlation between the attributes - it will be above zero and that helps - then size for the combined claim.' }
  });

  add({
    id: 'changepoints', group: 'Six Sigma and process control', title: 'Changepoints: every random series has a best split',
    analogy: 'Deal thirty playing cards into two piles, cutting wherever you like. One cut will separate high cards from low better than any other cut - guaranteed, every time, from a shuffled deck. Now imagine someone showing you that cut and telling you the deck changed halfway through. That is changepoint detection done badly, and it is the default.',
    intro: 'A control chart, a capability index and a forecast all assume one process. Fit any of them to a record containing a line modification or a new raw-material supplier and the early data describes something that no longer exists. So you want to find where the series changed - and the moment you go looking, you hit the trap: the best split in pure noise is just as convincing as the best split in a real shift, because you chose it to be. The fix is not a better formula.',
    demo(el) {
      const CASES = [['trap', 'The trap: noise with a best split'], ['real', 'A real step, found'], ['wander', 'The failure mode: a series that only wanders']];
      el.innerHTML = '<div class="demo-controls">' + CASES.map((c, i) => btn(c[0], c[1], i ? 'ghost' : 'primary')).join('') + '</div>' +
        '<div data-role="chart"></div><div data-role="bars"></div><p class="demo-read" data-role="read"></p>';

      const flat = seed => { const r = E.rng(seed), y = []; for (let i = 0; i < 40; i++) y.push(100 + normal(r) * 2); return y; };
      const step = seed => { const r = E.rng(seed), y = []; for (let i = 0; i < 60; i++) y.push(100 + (i >= 35 ? 4 : 0) + normal(r) * 2); return y; };
      const ar1 = seed => { const r = E.rng(seed), y = []; let x = 0; for (let i = 0; i < 60; i++) { x = 0.75 * x + normal(r) * Math.sqrt(1 - 0.5625); y.push(100 + x * 2); } return y; };

      const plot = (y, res, label, trueAt) => {
        const lo = Math.min(...y), hi = Math.max(...y), pad = (hi - lo) * 0.12 || 1;
        const f = frame(640, 240, [0, y.length - 1], [lo - pad, hi + pad], { l: 50, b: 38, xLabel: 'Point in time order' });
        let body = f.axes;
        if (res) for (const c of res.changepoints) {
          if (c.locationLo !== null && c.locationHi > c.locationLo)
            body += '<rect class="cp-band" x="' + f.sx(c.locationLo) + '" y="' + 12 + '" width="' + Math.max(1, f.sx(c.locationHi) - f.sx(c.locationLo)) + '" height="' + (240 - 38 - 12) + '"/>';
          body += '<path class="cp-line" d="' + pathOf([[c.index, lo - pad], [c.index, hi + pad]], f) + '"/>';
        }
        if (trueAt !== undefined) body += '<path class="target-line" d="' + pathOf([[trueAt, lo - pad], [trueAt, hi + pad]], f) + '"/>';
        if (res) for (const sg of res.segments)
          body += '<path class="cl-line" d="' + pathOf([[sg.from, sg.mean], [sg.to - 1, sg.mean]], f) + '"/>';
        body += '<path class="line thin" d="' + pathOf(y.map((v, i) => [i, v]), f) + '"/>';
        body += y.map((v, i) => dot(f.sx(i), f.sy(v), 'c1', 2.5)).join('');
        q(el, 'chart').innerHTML = svg(640, 240, label, body);
      };

      const show = which => {
        el.querySelectorAll('.demo-controls .btn').forEach(b => { b.className = 'btn ' + (b.getAttribute('data-role') === which ? 'primary' : 'ghost'); });
        q(el, 'bars').innerHTML = '';

        if (which === 'trap') {
          /* Pure noise. The naive t-test at the chosen split is run over many series so the
             rate is a measurement rather than one anecdote, and the permutation test is run
             on the same series so the comparison is like for like. */
          let naive = 0, perm = 0; const T = 120;
          for (let s = 0; s < T; s++) {
            const y = flat(s + 500);
            const bs = CP.bestSplit(y, 4);
            const a = y.slice(0, bs.k), b = y.slice(bs.k);
            const se = Math.sqrt(E.variance(a) / a.length + E.variance(b) / b.length);
            if (E.tTestP(Math.abs(E.mean(a) - E.mean(b)) / se, a.length + b.length - 2) < 0.05) naive++;
            if (CP.detect(y, { reps: 300, locReps: 80, seed: 3 }).changepoints.length) perm++;
          }
          const y0 = flat(500);
          const bs0 = CP.bestSplit(y0, 4);
          plot(y0, { changepoints: [{ index: bs0.k, locationLo: null, locationHi: null }], segments: [
            { from: 0, to: bs0.k, mean: bs0.meanBefore }, { from: bs0.k, to: y0.length, mean: bs0.meanAfter }] }, 'Noise, with its best split');
          C.hbar(q(el, 'bars'), [
            { label: 't-test at the best split', value: 100 * naive / T, cls: 'bad', text: (100 * naive / T).toFixed(0) + '%' },
            { label: 'Compared against shuffled orders', value: 100 * perm / T, cls: 'hi', text: (100 * perm / T).toFixed(1) + '%' }
          ], { min: 0, max: 100 * Math.max(0.5, naive / T) * 1.2, ref: { value: 5, label: '5% claimed' }, label: 'How often each method found a changepoint in data that never changed' });
          q(el, 'read').innerHTML = 'These forty points come from <b>one distribution</b>. Nothing changed. But the best split still separates them at point <b>' +
            (bs0.k + 1) + '</b>, with means of ' + fmt(bs0.meanBefore) + ' and ' + fmt(bs0.meanAfter) +
            ' on either side - and a t-test on those two halves hands back a convincing p-value, because the cut was chosen to make it convincing. Over <b>' + T +
            '</b> such series the t-test cried changepoint <b>' + (100 * naive / T).toFixed(0) + '%</b> of the time.' +
            '<br><br>This is the same mistake as picking the largest of twenty effects and quoting its unadjusted p-value, and the fix is the same in spirit: make the null account for the search. Take your own numbers, shuffle them so time order is destroyed but the values are untouched, find the best split in the shuffled order, and repeat a few thousand times. That gives the distribution of <i>best split you would find in data with no changepoint at all</i>, measured on your own data with no formula and no normality assumption. On the same ' + T +
            ' series that fired <b>' + (100 * perm / T).toFixed(1) + '%</b> of the time against the 5% it claims.';
          return;
        }

        if (which === 'real') {
          const y = step(4000);
          const res = CP.detect(y, { reps: 1500, locReps: 400, seed: 17 });
          plot(y, res, 'A real step, with the position interval shaded', 35);
          const c = res.changepoints[res.changepoints.length - 1];
          q(el, 'read').innerHTML = 'A 2-sigma step was put in at point <b>36</b> (the green line). It was found at point <b>' +
            (c.index + 1) + '</b>, and the shaded band is the bootstrap range for the position: <b>' + (c.locationLo + 1) + ' to ' + (c.locationHi + 1) +
            '</b>. That band is the part people skip, and it matters because somebody is going to take this number to a change record and look for what happened on that day. Measured over many runs, the band contains the true position <b>83 to 87%</b> of the time - less than the 90% its percentiles imply, because it conditions on the shift size being what was estimated. Check the whole range, not the single point.' +
            '<br><br>The horizontal lines are each regime’s own mean, drawn only across the points it describes, and that is what you should be computing from. The whole record here has a spread <b>' +
            res.inflation.toFixed(2) + '×</b> the last regime’s, because the step lands in it as though it were noise. The consequence is not what people expect: measured at an inflation of 1.34 the two sets of control limits caught a later shift about equally (73% against 75%), but at 2.3 the whole-history limits caught it <b>2%</b> of the time against <b>44%</b>. And capability moves in a direction with <b>no reliable sign</b> - on a process shifted toward its limit the whole-history Cpk read 0.52 against the 0.33 actually running, overstating by 1.56 times, while on a tighter configuration it understated. There is no safe-side argument for using the whole record.' +
            '<br><br>What the method will not find: a half-sigma step in 40 points turns up only about <b>17%</b> of the time. "No changepoint" means no step big enough to stand out from this much noise, not "nothing changed".';
          return;
        }

        const y = ar1(31);
        const res = CP.detect(y, { reps: 1500, locReps: 400, seed: 17 });
        plot(y, res, 'A series that only wanders');
        C.hbar(q(el, 'bars'), [
          { label: 'lag-1 = 0.2', value: 16, cls: '', text: '16%' },
          { label: 'lag-1 = 0.4', value: 30, cls: '', text: '30%' },
          { label: 'lag-1 = 0.55', value: 59, cls: 'bad', text: '59%' },
          { label: 'lag-1 = 0.72', value: 87, cls: 'bad', text: '87%' }
        ], { min: 0, max: 100, ref: { value: 5, label: '5% claimed' }, label: 'Changepoints found in series that never changed, by how correlated they are' });
        q(el, 'read').innerHTML = 'This series has <b>no changepoint in it at all</b>. It is a process whose value depends partly on the previous value - which describes most real process series, because a vessel, a column or a room has memory. It found <b>' +
          res.changepoints.length + '</b> changepoint' + (res.changepoints.length === 1 ? '' : 's') + ' anyway.' +
          '<br><br>This is the dominant failure mode and it is worth understanding rather than memorising. A correlated series <i>wanders</i>: it spends a stretch above its average and a stretch below, and a wander looks exactly like a step to anything that compares one stretch against another. The shuffled null cannot see this, because shuffling destroys the very correlation that produces the wander - so the null is the wrong null for a series like this. The bars show how badly, measured on simulated series with nothing in them: at a lag-1 of 0.55 a changepoint is found in <b>59%</b> of them.' +
          '<br><br>So the correlation is measured and reported, and it has to be measured on the residuals <i>within</i> each regime rather than on the raw series - a clean step makes the raw figure read 0.75 even when the noise is completely independent, because every point on one side of a step sits above the overall mean and that is what lag-1 measures. Computed on the raw series the warning would fire hardest exactly when the method had just worked. Here the within-regime correlation is <b>' +
          res.lag1.toFixed(2) + '</b>, which is high, and the panel says so before it says anything else.';
      };
      CASES.forEach(c => { q(el, c[0]).onclick = () => show(c[0]); });
      show('trap');
    },
    steps: [
      'Make sure the rows are in time order. Nothing can check this, and a sheet sorted by batch ID is a different series that will still produce changepoints.',
      'Look at the reported within-regime correlation first. If it is high, treat every position as a date to check rather than a finding - that is the failure mode, not a footnote.',
      'Read the position as a range, not a point, and take the whole range to the change record.',
      'Recompute your limits, capability and forecast from the last regime. The whole record is describing a process you are no longer running.',
      'Then find out what the change was. A changepoint is a date; the value of a date is that it is specific enough to check a change record against.'
    ],
    when: 'Any process metric with a long record: impurity trends, yield, deviation counts, utility readings, a release attribute over two years. Also before any capability or forecast claim on a long history, because both assume one regime and neither checks.',
    watch: 'Autocorrelation, which is the big one and is measured for you. After that: binary segmentation tests each segment separately, so each p-value is honest on its own stretch while the family of them is not - treat changepoints after the first as weaker, and the number of tests run is reported for that reason. And this finds steps in the MEAN only. A process that became more variable at an unchanged average is invisible here, and a gradual drift has no single best cut, so forcing one on a ramp gives a position with no meaning.',
    where: 'The trends bench, fourth mode: give it the series column in time order. The forecast mode also runs this check automatically and says so before the leaderboard, because a forecast fitted across a regime boundary has learned to average two processes.',
    quiz: { q: 'A yield series of 60 points gives a changepoint at point 41 with p below 0.001. The within-regime lag-1 autocorrelation is reported as 0.58. What is the right next step?', options: ['Act on it: p below 0.001 is decisive, and the position is well determined', 'Treat point 41 as a date to check against the change record, because at this correlation the method finds changepoints in most series that never changed', 'Discard the finding: the autocorrelation makes the analysis invalid'], answer: 1, why: 'At a within-regime lag-1 around 0.55 this method found a changepoint in 59% of simulated series that had none, because a correlated series wanders and a wander looks like a step - and the shuffled null cannot reproduce a wander, so the p-value is answering the wrong question. That does not make the finding worthless, which is why the third option is wrong: it makes it a hypothesis with a specific date attached, and a specific date is checkable. Go to the change record for the window around point 41 and look for a line modification, a new material lot or a vessel change. If you find one, you have a finding; if the record is clean across the whole position range, you probably have a wander.' }
  });

  add({
    id: 'size-distribution', group: 'Six Sigma and process control', title: 'Counts versus distributions: the same number, a different population',
    analogy: 'Two towns both report 7,000 people earning over $10,000. In one, almost nobody earns over $25,000; in the other, a third of them do. Same headline number, completely different place - and every decision you would make differs. A particle count at one threshold is that headline number.',
    intro: 'A particle counter gives you counts at a few size thresholds, and the usual treatment is to chart each one as its own number. That throws away the structure. The information is in how fast the count falls off as size rises, because the large particles are both the rarest and the ones that matter clinically. One number captures it: the slope of cumulative count against size on a log-log scale. But the slope turns out to be the wrong thing to TEST with, and the reason is worth more than the slope itself.',
    demo(el) {
      const CASES = [['same', 'Same count, different population'], ['check', 'Two bins check nothing'], ['extrap', 'Where extrapolation goes wrong']];
      el.innerHTML = '<div class="demo-controls">' + CASES.map((c, i) => btn(c[0], c[1], i ? 'ghost' : 'primary')).join('') + '</div>' +
        '<div data-role="chart"></div><div data-role="bars"></div><p class="demo-read" data-role="read"></p>';
      /* Particles sampled one at a time from a lognormal and then binned, so every count on
         screen is consistent with every other one. Batch B is scaled to match A at 10 um:
         the number anybody looks at is identical and the population is not. */
      const pop = (seed, sigma, n) => {
        const rand = E.rng(seed), out = [];
        for (let i = 0; i < n; i++) out.push(Math.exp(Math.log(3) + sigma * normal(rand)));
        return out;
      };
      const at = (ds, t) => ds.filter(d => d >= t).length;
      /* Counts pooled across a batch's containers rather than one container's, so the far
         tail holds enough particles for the extrapolation case to be about the fit rather
         than about sampling noise. 300,000 draws runs in under a tenth of a second. */
      const A = pop(5, 1.0, 300000), B = pop(11, 1.45, 300000);
      const scale = at(A, 10) / at(B, 10);
      const binsOf = (ds, th, k) => th.map(t => ({ size: t, count: Math.round(at(ds, t) * (k || 1)) }));

      const plot = (fits, label) => {
        const sizes = fits.reduce((a, f) => a.concat(f.r.curve.map(c => c.size)), []);
        const counts = fits.reduce((a, f) => a.concat(f.r.curve.map(c => c.powerLaw), f.r.fitBins.map(b => b.count)), []).filter(v => v > 0);
        const f = frame(640, 250, [Math.log10(Math.min(...sizes)), Math.log10(Math.max(...sizes))],
          [Math.log10(Math.min(...counts)) - 0.1, Math.log10(Math.max(...counts)) + 0.1],
          { l: 58, b: 40, xLabel: 'Size threshold, um (log)', yLabel: 'Count at or above (log)', xFmt: v => Math.pow(10, v).toPrecision(2), yFmt: v => Math.round(Math.pow(10, v)).toLocaleString('en-US') });
        let body = f.axes;
        fits.forEach((x, i) => {
          const cls = i ? 's2' : 'c1';
          body += '<path class="line' + (i ? ' s2' : '') + '" d="' + pathOf(x.r.curve.filter(c => c.powerLaw > 0).map(c => [Math.log10(c.size), Math.log10(c.powerLaw)]), f) + '"/>';
          if (x.r.logNormal) body += '<path class="line alt-shape' + (i ? ' s2' : '') + '" d="' +
            pathOf(x.r.curve.filter(c => c.logNormal > 0).map(c => [Math.log10(c.size), Math.log10(c.logNormal)]), f) + '"/>';
          for (const bin of x.r.fitBins) body += dot(f.sx(Math.log10(bin.size)), f.sy(Math.log10(bin.count)), cls, 4,
            (x.label || 'Counts') + '\n' + bin.size + ' um: ' + bin.count.toLocaleString('en-US'));
        });
        q(el, 'chart').innerHTML = svg(640, 250, label, body);
      };

      const show = which => {
        el.querySelectorAll('.demo-controls .btn').forEach(b => { b.className = 'btn ' + (b.getAttribute('data-role') === which ? 'primary' : 'ghost'); });
        q(el, 'bars').innerHTML = '';

        if (which === 'same') {
          const th = [2, 5, 10, 25];
          const ba = binsOf(A, th), bb = binsOf(B, th, scale);
          const fa = PD.analyze(ba), fb = PD.analyze(bb);
          plot([{ label: 'Batch A', r: fa }, { label: 'Batch B', r: fb }], 'Two size distributions');
          const tf = PD.tailFraction([{ label: 'Batch A', rows: ba }, { label: 'Batch B', rows: bb }], 10, 25);
          const sl = PD.compare([{ label: 'Batch A', rows: ba }, { label: 'Batch B', rows: bb }]);
          C.hbar(q(el, 'bars'), [
            { label: 'Batch A: of the particles at 10 um, reach 25 um', value: 100 * tf.groups[0].fraction, cls: '', text: (100 * tf.groups[0].fraction).toFixed(1) + '%' },
            { label: 'Batch B: of the particles at 10 um, reach 25 um', value: 100 * tf.groups[1].fraction, cls: 'hi', text: (100 * tf.groups[1].fraction).toFixed(1) + '%' }
          ], { min: 0, max: 100 * Math.max(tf.groups[0].fraction, tf.groups[1].fraction) * 1.3, label: 'The tail fraction' });
          q(el, 'read').innerHTML = 'Both batches report <b>' + ba[2].count.toLocaleString('en-US') +
            '</b> particles at or above 10 micrometres, pooled across the batch - identical, by construction. At 25 micrometres they report <b>' +
            ba[3].count.toLocaleString('en-US') + '</b> and <b>' + bb[3].count.toLocaleString('en-US') +
            '</b>. The fraction of 10 um particles that reach 25 um is <b>' + (100 * tf.groups[0].fraction).toFixed(1) + '%</b> against <b>' +
            (100 * tf.groups[1].fraction).toFixed(1) + '%</b>, and the test on it returns p ' + (tf.pairs[0].p < 1e-10 ? 'below 1e-10' : tf.pairs[0].p.toExponential(1)) +
            '. These counts are <i>nested</i> - every particle at or above 25 is also at or above 10 - so that is a proportion with an exact binomial error, not a ratio of two noisy numbers.' +
            '<br><br>Now the uncomfortable part. The exponents are <b>' + sl.fits[0].alpha.toFixed(2) + '</b> and <b>' + sl.fits[1].alpha.toFixed(2) +
            '</b> - nearly a factor of two apart, and visibly different on the chart - and the test comparing those slopes returns p ' + sl.pairs[0].p.toFixed(3) +
            ': <b>no significant difference.</b> It is not broken. Its standard error is the scatter about a straight line, and on a real population most of that scatter is the curve genuinely bending rather than sampling noise, so the error bar describes the wrong thing and comes out far too wide. Measured over simulations: the tail fraction caught this kind of change <b>100%</b> of the time and fired 5.7% under the null; the slope test caught it <b>22%</b> of the time and fired 0 times in 300 under the null. Describe with the slope, test with the fraction.';
          return;
        }

        if (which === 'check') {
          const ba = binsOf(A, [10, 25]), b4 = binsOf(A, [2, 5, 10, 25]);
          const f2b = PD.analyze(ba), f4 = PD.analyze(b4);
          plot([{ label: 'Two bins', r: f2b }], 'A two-bin fit');
          q(el, 'read').innerHTML = 'USP &lt;788&gt; reports two thresholds, 10 and 25 micrometres. Two points determine a two-parameter line <b>exactly</b>: the fit here has a residual of precisely zero and an exponent of <b>' +
            f2b.alpha.toFixed(2) + '</b> that cannot be wrong on this data. That is not reassurance, it is the absence of a test - nothing is left over to check whether a power law describes these particles at all. ' +
            'Put four flow-imaging bins under the same container and the exponent reads <b>' + f4.alpha.toFixed(2) + '</b> with a 95% interval of <b>' +
            f4.alphaCi[0].toFixed(2) + ' to ' + f4.alphaCi[1].toFixed(2) + '</b> and a residual spread of ' + f4.powerLaw.residSd.toFixed(3) +
            ' to argue with. Note the point estimate moved, which is the warning: the two-bin number was a local slope between 10 and 25, not a property of the population.' +
            '<br><br>One thing the two bins <i>can</i> do is the tail fraction, because it counts nested events and assumes no shape whatsoever. That is why the testable part of this lesson works on compendial data and the describable part does not. And a three-parameter lognormal is no better off: it fits three bins exactly too, so comparing its residual against a two-parameter power law on three points picks the lognormal every time by construction. Four bins is the first honest comparison.';
          return;
        }

        const th4 = [2, 5, 10, 25];
        const target = 50;
        const truth = at(A, target);
        const near = PD.analyze(binsOf(A, [25, 40]));
        const two = PD.analyze(binsOf(A, [10, 25]));
        const four = PD.analyze(binsOf(A, th4));
        plot([{ label: 'Four bins', r: four }], 'Extrapolating past the bins');
        C.hbar(q(el, 'bars'), [
          { label: 'Truth at ' + target + ' um', value: truth, cls: 'accent', text: truth.toLocaleString('en-US') },
          { label: 'From 25 and 40 um (bracketing)', value: near.powerLaw.predict(target), cls: 'hi', text: Math.round(near.powerLaw.predict(target)).toLocaleString('en-US') },
          { label: 'From 10 and 25 um (USP)', value: two.powerLaw.predict(target), cls: '', text: Math.round(two.powerLaw.predict(target)).toLocaleString('en-US') },
          { label: 'From 2, 5, 10 and 25 um (four bins)', value: four.powerLaw.predict(target), cls: '', text: Math.round(four.powerLaw.predict(target)).toLocaleString('en-US') }
        ], { min: 0, max: Math.max(truth, four.powerLaw.predict(target)) * 1.2, ref: { value: truth, label: 'truth' }, label: 'Predicted count at ' + target + ' micrometres' });
        q(el, 'read').innerHTML = 'The batch really holds <b>' + truth.toLocaleString('en-US') + '</b> particles at or above ' + target +
          ' micrometres. Fit from the two USP thresholds and you predict <b>' + Math.round(two.powerLaw.predict(target)).toLocaleString('en-US') +
          '</b>, high by a factor of <b>' + (two.powerLaw.predict(target) / truth).toFixed(2) + '</b>. Now add <i>two more bins</i> at 2 and 5 micrometres - more data, four points instead of two - and it gets <b>worse</b>: <b>' +
          Math.round(four.powerLaw.predict(target)).toLocaleString('en-US') + '</b>, a factor of <b>' + (four.powerLaw.predict(target) / truth).toFixed(2) +
          '</b>. Fit instead from 25 and 40 micrometres, two bins that <i>bracket</i> the size you want, and you get <b>' +
          Math.round(near.powerLaw.predict(target)).toLocaleString('en-US') + '</b> - within <b>' +
          Math.abs(100 * (near.powerLaw.predict(target) / truth - 1)).toFixed(0) + '%</b>.' +
          '<br><br>This is the lesson most people get backwards. The extra bins did not help because they are in the wrong <i>place</i>: a real size distribution genuinely bends, so a straight line fitted across 2 to 25 averages a slope over a range where the slope is changing, and that averaged slope is too shallow for the far tail. More data at the small end buys nothing for a question about large particles. If you need a number at ' + target +
          ' micrometres, measure near ' + target + ' micrometres.';
      };
      CASES.forEach(c => { q(el, c[0]).onclick = () => show(c[0]); });
      show('same');
    },
    steps: [
      'Put the counts in as cumulative - at or above each threshold - because that is what a counter reports and what the compendial thresholds mean. Per-bin counts get summed from the largest bin down.',
      'Read the tail fraction first: of the particles counted at the lower threshold, what share reach the upper one. Nested counts, binomial error, works on two bins.',
      'Read the exponent second, as a description of the shape. Steep means the population dies off fast with size; shallow means a heavy tail.',
      'Check whether anything tested the shape at all. Two bins fit a two-parameter line exactly, so nothing did - that is the normal state of USP <788> data, not bad luck.',
      'Do not extrapolate past your largest bin on a shape nothing checked. If you need a count at a larger size, measure near that size.'
    ],
    when: 'Subvisible particle counts by light obscuration or flow imaging, container closure studies, aggregation on stability, and any comparison of two counters, two lines or two batches where the question is whether the population changed rather than whether the number went up.',
    watch: 'A bent line on the log-log plot is usually two populations, not one bad fit - silicone oil droplets and protein aggregates together will give you a single exponent that lands between the two and describes neither. Split by particle type if you can, which needs a type call nothing here can make. And a single exponent says nothing about what the particles ARE: this measures sizes.',
    where: 'The variance bench, sixth mode: give it the size column, the count column, and a group column if you are comparing. The three examples in this lesson are on the buttons there.',
    quiz: { q: 'A line change leaves the 10 um particle count unchanged at about 4,000 per container, but the 25 um count rises from 320 to 470. The count chart on the 10 um number shows nothing. What has happened, and what would you test?', options: ['Nothing meaningful: the 10 um count is the compendial number and it is unchanged', 'The size distribution got a heavier tail. Test the fraction of 10 um particles reaching 25 um, which is a nested proportion and needs only these two thresholds', 'Fit a power law to both and compare the slopes, which is the standard shape comparison'], answer: 1, why: 'The fraction reaching 25 um went from 8.0% to 11.8% - the population changed shape, which means the mechanism generating the particles is not the same one, and the large particles are the ones that matter. Because the counts are nested, that fraction is a proportion with an exact binomial error and the test on these numbers returns p around 5e-8. The third option is the trap: with two bins the slope has no standard error at all, and even with four bins that test detects a change of this size only about 22% of the time, because its error bar is measuring the curve bending rather than sampling noise. The first option is how this change reaches a patient.' }
  });

  add({
    id: 'weibull-life', group: 'Six Sigma and process control', title: 'Equipment life: is it wearing out, or just unlucky?',
    analogy: 'Light bulbs and lottery tickets both fail, and the right response is opposite. A bulb that has been on for 900 hours is closer to the end than a fresh one, so replacing it early helps. A lottery ticket that has lost nine times is no more likely to lose the tenth, so swapping it for a new one achieves nothing. Most maintenance schedules are built on the assumption that equipment is a bulb. A lot of it is a ticket.',
    intro: 'The question maintenance actually asks is not "how long does this last" but "does its failure rate climb with age". One number answers that: the Weibull shape, beta. Below 1 the rate falls with age - infant mortality, an installation problem. At 1 the rate is flat - failures at random, and preventive replacement buys nothing while still costing labour and a fresh installation risk. Above 1 the rate climbs with age, and replacing before it climbs genuinely removes failures. The trap is that beta is estimated from a handful of failures, so a point estimate alone is not an answer.',
    demo(el) {
      const CASES = [['wear', 'Seals that wear out'], ['random', 'Looks like wear-out, is not'], ['censor', 'The units still running']];
      el.innerHTML = '<div class="demo-controls">' + CASES.map((c, i) => btn(c[0], c[1], i ? 'ghost' : 'primary')).join('') + '</div>' +
        '<div data-role="chart"></div><div data-role="bars"></div><p class="demo-read" data-role="read"></p>';
      const gen = (seed, beta, eta, n, end) => {
        const rand = E.rng(seed), rows = [];
        for (let i = 0; i < n; i++) {
          const t = eta * Math.pow(-Math.log(1 - rand()), 1 / beta);
          rows.push(t > end ? { time: end, censored: true } : { time: t, censored: false });
        }
        return rows;
      };
      const curveOf = (r, label) => {
        const f = frame(640, 210, [0, r.curve[r.curve.length - 1].t], [0, 1], { l: 52, b: 36, xLabel: 'Hours in service', yLabel: 'Fraction still running' });
        return svg(640, 210, label, f.axes +
          '<path class="ref" d="' + pathOf([[0, 0.9], [r.curve[r.curve.length - 1].t, 0.9]], f) + '"/>' +
          '<path class="line" d="' + pathOf(r.curve.map(p => [p.t, p.reliability]), f) + '"/>' +
          dot(f.sx(r.b10), f.sy(0.9), 'c2', 4.5, 'B10: one in ten has failed by ' + Math.round(r.b10) + ' hours'));
      };
      const show = which => {
        el.querySelectorAll('.demo-controls .btn').forEach(b => { b.className = 'btn ' + (b.getAttribute('data-role') === which ? 'primary' : 'ghost'); });
        q(el, 'bars').innerHTML = ''; q(el, 'chart').innerHTML = '';
        if (which === 'censor') {
          /* The same 26 records, read three ways. Only the first is correct; the other two are
             what a spreadsheet does with a unit that has not failed yet. */
          const rows = gen(3, 2.3, 4200, 26, 5000);
          const kept = RL.analyze(rows);
          const dropped = RL.analyze(rows.filter(x => !x.censored));
          const asFailed = RL.analyze(rows.map(x => ({ time: x.time, censored: false })));
          C.hbar(q(el, 'bars'), [
            { label: 'Carried as censored (correct)', value: kept.mtbf, cls: 'hi', text: Math.round(kept.mtbf) + ' h, shape ' + kept.beta.toFixed(2) },
            { label: 'Still-running units deleted', value: dropped.mtbf, cls: '', text: Math.round(dropped.mtbf) + ' h, shape ' + dropped.beta.toFixed(2) },
            { label: 'Their age entered as a failure', value: asFailed.mtbf, cls: '', text: Math.round(asFailed.mtbf) + ' h, shape ' + asFailed.beta.toFixed(2) }
          ], { min: 0, max: kept.mtbf * 1.25, label: 'Mean life under three ways of handling the four units still running' });
          q(el, 'read').innerHTML = 'Twenty-six seals, four of which were still running when the record closed at 5,000 hours. Handled properly they contribute what is actually known - that they lasted <i>at least</i> 5,000 hours - and the mean life comes out at <b>' +
            Math.round(kept.mtbf) + ' hours</b> with a shape of <b>' + kept.beta.toFixed(2) + '</b>. Delete those four rows, which is what happens when somebody filters to "failures only", and the mean life drops to <b>' +
            Math.round(dropped.mtbf) + ' hours</b> and the shape rises to <b>' + dropped.beta.toFixed(2) + '</b>. Enter their current age as a failure time instead and you get <b>' +
            Math.round(asFailed.mtbf) + ' hours</b> at <b>' + asFailed.beta.toFixed(2) + '</b>. Notice the direction of both errors: a <b>shorter</b> life and a <b>higher</b> shape. Shorter life means an earlier replacement interval, and higher shape means more confident wear-out. Both mistakes argue for spending money, which is why they rarely get caught.';
          return;
        }
        const r = which === 'wear' ? RL.analyze(gen(3, 2.3, 4200, 26, 5000)) : RL.analyze(gen(9, 1.0, 3000, 20, 4000));
        q(el, 'chart').innerHTML = curveOf(r, 'Survival curve');
        C.hbar(q(el, 'bars'), [
          { label: 'Lower end of the 95% interval', value: r.betaCi[0], cls: '' },
          { label: 'Shape estimated from this data', value: r.beta, cls: 'hi' },
          { label: 'Upper end of the 95% interval', value: r.betaCi[1], cls: '' }
        ], { min: 0, max: Math.max(2.2, r.betaCi[1] * 1.15), ref: { value: 1, label: 'random failure' }, label: 'The Weibull shape and its interval, against 1' });
        q(el, 'read').innerHTML = which === 'wear'
          ? 'Shape <b>' + r.beta.toFixed(2) + '</b>, interval <b>' + r.betaCi[0].toFixed(2) + ' to ' + r.betaCi[1].toFixed(2) +
            '</b>. The whole interval sits above 1, so the failure rate genuinely climbs with age and this is the case where preventive replacement works. B10 - the age by which one seal in ten has failed, marked on the curve at <b>' +
            Math.round(r.b10) + ' hours</b> - is the usual starting point for the interval, which you then trade off against the cost of a failure in service. Note that the mean life of <b>' +
            Math.round(r.mtbf) + ' hours</b> is no use as an operating age: by then <b>' + Math.round(100 * (1 - r.reliabilityAt(r.mtbf))) + '%</b> have already failed.'
          : 'Shape <b>' + r.beta.toFixed(2) + '</b>, which reads like wear-out and would be written up as wear-out by almost anybody. But the interval runs <b>' +
            r.betaCi[0].toFixed(2) + ' to ' + r.betaCi[1].toFixed(2) + '</b>, and it covers 1 - so a flat, age-independent failure rate is still a perfectly good explanation of these ' +
            r.failures + ' failures. This data was in fact generated at a true shape of exactly 1.0: random. <b>The tool refuses to recommend a replacement interval here</b>, and that refusal is the whole point of the lesson: the point estimate is not the finding, the interval is. Two things fix it, and neither is a bolder reading - more failures, or splitting the record by failure mode so one shape is not describing two mechanisms.';
      };
      CASES.forEach(c => { q(el, c[0]).onclick = () => show(c[0]); });
      show('wear');
    },
    steps: [
      'Collect one row per unit: its time in service, and whether it has failed yet. Hours, cycles, batches, days - any consistent measure of use.',
      'Mark the units that have NOT failed. They are censored, not missing: they tell you a life was at least that long, and dropping them shortens every figure that follows.',
      'Read the shape and its interval, not the shape alone. If the interval covers 1, the data cannot tell wear-out from random failure and no schedule follows from it.',
      'Only if the whole interval sits above 1, set the interval from B10 and weigh a planned replacement against a failure in service.',
      'Split the record by failure mode first. One shape cannot describe a seal that wears and a bearing that fails at random; the fit will land between them and describe neither.'
    ],
    when: 'Pump seals, filters, bearings, valve actuators, HEPA filters, probes - anything replaced on a schedule where somebody has asked whether the schedule is earning its cost. Also the other way round: an item being run to failure where you suspect it should not be.',
    watch: 'Three traps, in order of how often they bite. First, the mean time between failures on its own: it is a mean, and at any shape above 1 roughly half the units have already failed by it, so it is not a safe operating age. Second, small samples - the fitting method overstates the shape when failures are few. Measured on simulated data at a true shape of 2.0, the estimate runs about 21% high at 8 failures, 13% at 12, 8% at 20 and 4% at 40; the bias points towards wear-out, the finding that justifies spending, so a shape just above 1 on a dozen failures is not yet evidence. Third, a repairable system: one chiller repaired six times is not six chillers, and feeding those six intervals in as separate lives fits a shape to a mixture of units that do not exist. For that, the question is whether the gaps between failures are shrinking - which is a different model, and is not in this tool.',
    where: 'The trends bench, third mode: pick "Equipment life", point it at the time column and the status column, and say which value means still running. Both examples from this lesson are on the buttons there.',
    quiz: { q: 'Fourteen pump failures over two years. The fit gives a Weibull shape of 1.6 with a 95% interval of 0.9 to 2.3, and maintenance wants a 6-month replacement schedule costed from it. What do you tell them?', options: ['Go ahead: 1.6 is clearly above 1, so the pumps are wearing out', 'The data cannot yet distinguish wear-out from random failure, so a schedule is not supported - and on 14 failures the 1.6 is itself biased high', 'Use the mean time between failures as the replacement interval instead'], answer: 1, why: 'The interval covers 1, so a flat failure rate is still a live explanation and a schedule built on these numbers would be spending money on a pattern not yet shown to exist. Worse, at 14 failures the estimate is biased upward by roughly 10-15% by the fitting method alone, and that bias points towards exactly the conclusion being asked for. The honest answer is that the record is not yet long enough - keep collecting, and check whether the failures are really one mode or several. The third option is the most common mistake in the field: at a shape of 1.6 about half the pumps have already failed by the mean, so scheduling on it means half the fleet fails first.' }
  });

  add({
    id: 'subgroup-charts', group: 'Six Sigma and process control', title: 'Subgroup charts: read the spread chart first',
    analogy: 'Weighing five apples together tells you about the bag. It tells you nothing about whether one apple is rotten, and the bag can look perfectly normal while the apples disagree wildly.',
    intro: 'When you sample several units per batch, the average of each subgroup goes on one chart and the spread within it goes on another. The order matters: the limits on the averages are calculated from the within-subgroup spread, so if the spread chart is out of control the X-bar limits are built on a moving foundation and neither their signals nor their silence can be read.',
    demo(el) {
      const CASES = [['ok', 'A stable line'], ['blown', 'One batch blows out the spread'], ['heads', 'Two filling heads in one subgroup']];
      el.innerHTML = '<div class="demo-controls">' + CASES.map((c, i) => btn(c[0], c[1], i ? 'ghost' : 'primary')).join('') + '</div>' +
        '<div class="demo-grid"><div><h4>Spread within each subgroup (R)</h4><div data-role="r"></div></div>' +
        '<div><h4>Subgroup averages (X-bar)</h4><div data-role="x"></div></div></div><p class="demo-read" data-role="read"></p>';
      const show = which => {
        el.querySelectorAll('.demo-controls .btn').forEach(b => { b.className = 'btn ' + (b.getAttribute('data-role') === which ? 'primary' : 'ghost'); });
        const rand = E.rng(11), rows = [];
        for (let g = 1; g <= 20; g++) for (let i = 0; i < 5; i++) {
          let v = 100 + normal(rand) * 2;
          if (which === 'blown' && g === 10) v = 100 + normal(rand) * 14;
          if (which === 'heads') v = 100 + (i % 2 ? 6 : -6) + normal(rand) * 0.5;
          rows.push({ subgroup: 'B' + g, value: v });
        }
        const r = S.subgroupChart(rows);
        const panel = (role, vals, lo, cl, hi, sig, label) => {
          const pad = (hi - lo) * 0.15 || 1;
          const f = frame(300, 215, [-0.5, vals.length - 0.5], [Math.min(lo, ...vals) - pad, Math.max(hi, ...vals) + pad], { l: 44, b: 32, xLabel: 'Subgroup' });
          q(el, role).innerHTML = svg(300, 215, label, f.axes +
            '<path class="ref" d="' + pathOf([[-0.5, hi], [vals.length - 0.5, hi]], f) + '"/>' +
            '<path class="ref" d="' + pathOf([[-0.5, lo], [vals.length - 0.5, lo]], f) + '"/>' +
            '<path class="cl-line" d="' + pathOf([[-0.5, cl], [vals.length - 0.5, cl]], f) + '"/>' +
            '<path class="line thin" d="' + pathOf(vals.map((v, i) => [i, v]), f) + '"/>' +
            vals.map((v, i) => dot(f.sx(i), f.sy(v), sig.some(s => s.i === i) ? 'c2' : 'c1', 3.5)).join(''));
        };
        const L = r.limits[0];
        panel('r', r.spreads, L.sLcl, L.centre, L.sUcl, r.spreadSignals, 'Range within each subgroup');
        panel('x', r.means, L.xLcl, r.grand, L.xUcl, r.meanSignals, 'Subgroup averages');
        q(el, 'read').innerHTML = which === 'ok'
          ? 'The R chart is in control, so the X-bar limits rest on a stable spread and can be read. Within-subgroup sigma is <b>' + fmt(r.sigmaWithin) +
            '</b>; the limits on the averages sit at three of those over &radic;5, which is <b>' + fmt(Math.sqrt(5)) + ' times narrower than the process itself</b>. That is why specification limits must never be drawn here.'
          : which === 'blown'
            ? 'Batch 10 breaks the R chart. <b>Stop there.</b> The X-bar limits were computed from the average within-subgroup spread, and that average has just been inflated by this one batch - so the limits on the right are too wide, and whether any average sits inside them tells you nothing. Find out what happened to batch 10 first.'
            : 'Both charts look calm, and the process is anything but: two filling heads running 12 units apart are being sampled into every subgroup. That difference lands <i>inside</i> the subgroup, so it inflates the within-subgroup spread, which inflates the limits on the averages - and the chart goes blind. The giveaway is that the averages scatter only <b>' +
              r.ratio.toFixed(2) + '</b> times as much as the spread predicts. Healthy subgrouping sits near 1. Subgroup within a head, not across them.';
      };
      CASES.forEach(c => { q(el, c[0]).onclick = () => show(c[0]); });
      show('ok');
    },
    steps: ['Decide the subgroup so that only common-cause variation can happen inside it: one stream, one head, one short window.', 'Plot the within-subgroup spread (R for small subgroups, S for larger or unequal ones) and read that chart first.', 'Only once the spread is stable are the limits on the averages meaningful, because they are computed from it.', 'Never draw specification limits on the X-bar chart. Averages vary by sigma over root n, so the limits are narrower than the process; capability is a separate question asked of individual results.'],
    when: 'Any time you measure several units per batch, per hour or per tray - fill weight, tablet hardness, vial headspace.',
    watch: 'The quiet chart is the dangerous one. If the subgroups span a real source of variation, the limits inflate until nothing can signal, and the process can drift for months inside them. Compare how much the averages scatter against what the within-subgroup spread predicts: well under 1 means the subgrouping is hiding what you are looking for.',
    where: 'The variance bench: pick the subgroup chart mode, give it a subgroup column and a result column. The spread chart is drawn first on purpose.',
    quiz: { q: 'Your X-bar chart has sat inside its limits for six months and nobody has ever investigated a signal. The R chart is also calm. What is the first thing to check?', options: ['Nothing - this is a well-controlled process', 'Whether each subgroup spans several streams, which would inflate the limits until the chart cannot signal', 'Whether the limits need recalculating from more recent data'], answer: 1, why: 'A chart that never signals is either a genuinely excellent process or a chart that cannot see. Sampling across two heads, cavities or lanes puts their difference inside the subgroup, where it widens the limits instead of showing up as a signal. Compare the scatter of the averages against what the within-subgroup spread predicts: if it is well below 1, the chart has been blind the whole time.' }
  });

  add({
    id: 'across-sites', group: 'Six Sigma and process control', title: 'Capability across sites: when one number is worse than all of them',
    analogy: 'Two buses, each reliably five minutes early or five minutes late. Average them and the service looks perfectly on time, which is no help to anyone standing at the stop.',
    intro: 'A transfer ends with somebody asking for the capability of the product, singular. If the sites are genuinely the same process, one index is fair. If they sit at different centres, pooling them folds the gap between the sites into the spread, and the combined figure can come out worse than every site in it - a number that describes a process nobody runs.',
    demo(el) {
      el.innerHTML = '<div data-role="plot"></div><div class="demo-controls">' + slider('gap', 'Difference between the two site averages', 0, 2.4, 0.1, 0) + '</div><p class="demo-read" data-role="read"></p>';
      const LSL = 96, USL = 100;
      const draw = () => {
        const gap = Number(q(el, 'gap').value);
        setOut(el, 'gap', gap.toFixed(1));
        const rand = E.rng(3), rows = [];
        const nz = () => { const u = Math.max(1e-12, rand()), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
        for (let i = 0; i < 30; i++) rows.push({ site: 'Site A', value: 98.6 - gap / 2 + nz() * 0.5 });
        for (let i = 0; i < 30; i++) rows.push({ site: 'Site B', value: 98.6 + gap / 2 + nz() * 0.5 });
        const r = S.crossSite(rows, { lsl: LSL, usl: USL });
        const pooled = S.capability(rows.map(x => x.value), { lsl: LSL, usl: USL });
        const f = frame(640, 250, [94.5, 101.5], [0, 1], { l: 46, b: 36, xLabel: 'Purity (%)', yFmt: () => '' });
        const band = (v, cls) => '<line class="' + cls + '" x1="' + f.sx(v) + '" x2="' + f.sx(v) + '" y1="20" y2="190"/>';
        const strip = (vals, y, cls) => vals.map((v, i) => dot(f.sx(v), y + ((i % 3) - 1) * 7, cls, 3.5)).join("");
        const a = rows.filter(x => x.site === 'Site A').map(x => x.value);
        const b = rows.filter(x => x.site === 'Site B').map(x => x.value);
        q(el, 'plot').innerHTML = svg(640, 250, 'Two sites against one specification', f.axes +
          band(LSL, 'ref') + band(USL, 'ref') +
          '<text class="lbl-strong" x="' + f.sx(LSL) + '" y="14" text-anchor="middle">LSL 96</text>' +
          '<text class="lbl-strong" x="' + f.sx(USL) + '" y="14" text-anchor="middle">USL 100</text>' +
          strip(a, 70, 'c1') + strip(b, 110, 'c3') + strip(rows.map(x => x.value), 160, 'c2') +
          '<text x="8" y="74">Site A</text><text x="8" y="114">Site B</text><text x="8" y="164">Pooled</text>');
        const pa = r.perSite.find(s => s.site === 'Site A'), pb = r.perSite.find(s => s.site === 'Site B');
        const below = pooled.Ppk < Math.min(pa.Ppk, pb.Ppk);
        q(el, 'read').innerHTML = 'Site A reaches <b>Ppk ' + pa.Ppk.toFixed(2) + '</b>, Site B <b>Ppk ' + pb.Ppk.toFixed(2) +
          '</b>. Pooling all sixty results gives <b>Ppk ' + pooled.Ppk.toFixed(2) + '</b>' +
          (below ? ' - <b>worse than either site</b>, because the pooled spread now contains the distance between them as well as the variation inside them.' : '.') + ' ' +
          (r.poolable
            ? 'The centres and the spreads both survive their tests, so the tool reports the combined index: here it is a fair summary of one process.'
            : 'The tool withholds the combined index and says why. The per-site rows still stand - each is a correct statement about a process that exists.') +
          ' Between-site differences account for <b>' + Math.round(r.betweenShare * 100) + '%</b> of the total spread' +
          (r.betweenShare > 0.3 ? ', so the work is harmonising the sites, not tightening either one.' : '.') +
          ' Drag the slider: nothing inside either site changes, only the gap between them, and the single number gets steadily worse while both real processes stay exactly as good as they were.';
      };
      q(el, 'gap').oninput = draw;
      draw();
    },
    steps: ['Compute capability at each site separately. These are always the honest numbers.', 'Test whether the sites may be pooled at all: one test for the centres, one for the spreads.', 'Only if both survive does a combined index describe a real single process.', 'If they do not, report per site and say which assumption failed. Then ask how much of the total spread is between sites: that is what tells you whether harmonising is worth a programme.', 'To claim the sites are interchangeable rather than merely not-shown-to-differ, set a margin beforehand and test every pair for equivalence. Every pair has to pass, and that needs no correction for multiplicity.'],
    when: 'Technology transfer, multi-site release, any comparability claim where somebody wants one figure for the product.',
    watch: 'A combined index that looks poor is sometimes read as "both sites are struggling". Check the centres first - it may be that both sites are capable and simply disagree about where the target is, which is a much easier problem and a completely different investigation.',
    where: 'The variance bench, fourth mode: give it a site column, a result column and the specification limits.',
    quiz: { q: 'Site A reaches Ppk 1.41, Site B reaches 1.38, and pooling all the data gives 0.74. What is going on?', options: ['Both sites are marginal and the pooled figure is the honest one', 'The sites are centred in different places, so the pooled spread includes the gap between them', 'The pooled calculation is wrong'], answer: 1, why: 'Each site is comfortably capable against the same limits, so neither has a spread problem. A pooled figure far below both can only come from the distance between their centres being added to the spread. The fix is to find out why they sit apart - and until they do not, one combined index is not a statement about any real process.' }
  });

  add({
    id: 'codon-optimization', group: 'Optimizing with evolution', title: 'Codon optimization: evolving a gene without changing the protein',
    analogy: 'Spelling the same word in two languages. "Colour" and "color" read the same to a person, but one is what the local reader expects. The protein is the meaning; the codons are the spelling, and each host has its own preference.',
    intro: 'Most amino acids can be written with several codons, so a protein has astronomically many possible genes. A genetic algorithm breeds a population of spellings: it keeps the ones that score well, mixes them, and mutates a codon here and there. Drag through the generations below and watch a deliberately badly-spelled gene improve, one objective at a time.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('gen', 'Generation', 0, 60, 1, 0) + btn('play', 'Play', 'primary') + '</div>' +
        '<div data-role="track"></div><p class="demo-read" data-role="read"></p><div class="cols2"><div data-role="plot"></div><div data-role="codons"></div></div>';
      const CD = window.MLCodon, GA = window.MLGa;
      // A short gene written with the codons a human cell uses least, plus an EcoRI site.
      const rnd = GA.rng(11), aas = 'ACDEFGHIKLMNPQRSTVY';
      let dna = 'ATG';
      for (let i = 0; i < 59; i++) {
        const aa = aas[Math.floor(rnd() * aas.length)];
        dna += CD.SYN[aa].slice().sort((x, y) => CD.TABLES.HEK293.usage[x] - CD.TABLES.HEK293.usage[y])[0];
      }
      dna = dna.slice(0, 15) + 'GAATTC' + dna.slice(21) + 'TAA';
      const job = { dna, host: 'HEK293', gcLow: 0.45, gcHigh: 0.55, avoid: ['EcoRI'], maxRun: 6, popSize: 30, generations: 60, seed: 3 };
      const run = GA.create(job), w = CD.relativeAdaptiveness('HEK293');
      /* Record the best sequence at every generation, then let the slider scrub through
         them. Generation 0 is the gene exactly as it was written: the starting population
         already contains improved spellings, so showing its best here would skip the point. */
      const keep = m => ({ dna: m.dna, cai: m.cai, gc: m.gc.overall, viol: m.violations, d: m.d });
      const snaps = [keep(run.state.baseline)];
      for (let g = 0; g < 60; g++) { run.step(1); snaps.push(keep(run.state.best.m)); }

      const draw = () => {
        const g = Number(q(el, 'gen').value), s = snaps[g];
        setOut(el, 'gen', g);
        // One cell per codon, shaded by how much this host likes that codon.
        const n = s.dna.length / 3, cw = 640 / n;
        let b = '';
        for (let i = 0; i < n; i++) {
          const c = s.dna.slice(i * 3, i * 3 + 3);
          const good = CD.SYN[CD.CODE[c]].length < 2 ? 1 : w[c];
          const changed = c !== dna.slice(i * 3, i * 3 + 3);
          b += '<rect x="' + (i * cw) + '" y="8" width="' + Math.max(1, cw - 1) + '" height="26" rx="2" class="' + (good > 0.8 ? 'cell-good' : good > 0.45 ? 'cell-mid' : 'cell-bad') + '"><title>' + h(c) + ' = ' + h(CD.CODE[c]) + ', host preference ' + good.toFixed(2) + '</title></rect>' +
            (changed ? '<rect x="' + (i * cw) + '" y="36" width="' + Math.max(1, cw - 1) + '" height="3" class="cell-changed"/>' : '');
        }
        q(el, 'track').innerHTML = svg(640, 46, 'Codon preference along the gene', b) +
          C.legend([{ label: 'codon this host likes', cls: 'c3', shape: 'square' }, { label: 'middling', cls: 'c4', shape: 'square' }, { label: 'rare codon', cls: 'c2', shape: 'square' }, { label: 'changed from the original', cls: 'c1', shape: 'square' }]);
        const f = frame(320, 220, [0, 60], [0, 1], { xLabel: 'Generation', yLabel: 'Overall score' });
        let p = f.axes + '<path class="curve d3" d="' + pathOf(snaps.slice(0, g + 1).map((x, i) => [i, x.d]), f) + '"/>';
        p += dot(f.sx(g), f.sy(s.d), 'query', 5);
        q(el, 'plot').innerHTML = svg(320, 220, 'Score by generation', p);
        // What the first six codons look like now, versus where they started.
        let rows = '<table class="mini"><thead><tr><th>Codon</th><th>Started</th><th>Now</th><th>Amino acid</th></tr></thead><tbody>';
        for (let i = 1; i < 7; i++) {
          const was = dna.slice(i * 3, i * 3 + 3), now = s.dna.slice(i * 3, i * 3 + 3);
          rows += '<tr><td>' + (i + 1) + '</td><td>' + h(was) + ' <span class="hint">' + w[was].toFixed(2) + '</span></td><td><b>' + h(now) + '</b> <span class="hint">' + w[now].toFixed(2) + '</span></td><td>' + h(CD.CODE[now]) + '</td></tr>';
        }
        q(el, 'codons').innerHTML = rows + '</tbody></table>';
        const first = snaps[0];
        q(el, 'read').innerHTML = 'Generation <b>' + g + '</b>: CAI <b>' + s.cai.toFixed(3) + '</b> (started ' + first.cai.toFixed(3) + '), GC <b>' + pct(s.gc) + '</b>, EcoRI sites <b>' + s.viol + '</b>, overall score <b>' + s.d.toFixed(3) + '</b>.<br>' +
          (g === 0 ? 'This is the gene as written: rare codons nearly everywhere (the red track) and an EcoRI site that has to go. Drag the slider, or press Play.'
            : s.viol === 0 && s.cai > 0.85 ? 'The protein has not changed by a single amino acid: only the spelling has. Rare codons have been swapped for ones this host reads easily, and the restriction site is gone.'
              : 'Evolution in progress: the population is still trading CAI against GC and the leftover site.');
      };
      q(el, 'gen').oninput = draw;
      q(el, 'play').onclick = () => {
        let g = 0;
        const sl = q(el, 'gen');
        const tickOn = () => { sl.value = g; draw(); if (g++ < 60) setTimeout(tickOn, 60); };
        tickOn();
      };
      draw();
    },
    steps: ['Start from a population of spellings of the same protein: the original, the host’s favourite codon everywhere, and random mixes.', 'Score each one: Codon Adaptation Index (does this host read it easily?), GC content in its window, how much the 5′ end folds, and whether forbidden sites are present.', 'Keep the sequences nothing else beats on all goals at once (the Pareto front), breed them, and mutate the odd codon to a synonym.', 'Repeat for a few hundred generations. Because only synonyms are ever swapped, the protein cannot change.'],
    when: 'Expressing a gene in a host it did not come from, or cleaning a sequence up before ordering synthesis.',
    watch: 'Codon tables are averages over a genome, not a promise about your construct. The folding number here is a base-pairing score, not a kcal/mol free energy. Highest CAI is not always best: very fast translation can misfold some proteins. Always have the final sequence reviewed.',
    where: 'Pick "Sequence optimizer" from the selector at the top: paste a coding sequence, pick a host, and run it.',
    quiz: { q: 'A codon optimizer changes 60% of the codons in your gene. What should the protein look like afterwards?', options: ['Slightly different, which is normal', 'Exactly the same, every amino acid', 'Shorter, because rare codons are dropped'], answer: 1, why: 'Only synonymous codons are swapped, so the amino acid sequence is identical. If it is not, something is wrong: the tool checks this and reports it.' }
  });

  add({
    id: 'extrapolation', group: 'Using the results', title: 'Extrapolation: the interval is the answer',
    analogy: 'A thermometer calibrated between 0 and 50 degrees, held in a furnace. It will show a number. It will show it to one decimal place, steadily, with no outward sign that it is now a piece of decorative glass. Every model does this: asked about conditions it never saw, it answers in exactly the same confident voice it uses for conditions it knows well.',
    intro: 'A prediction for a construct nobody has built is worth very little on its own. What decides whether to spend on synthesis is how wrong it could be — and that is where the usual habit, mean plus or minus two standard deviations of the residuals, quietly fails. That band is one fixed width everywhere. It is therefore at its most confident exactly where it is least justified. Drag the slider below past the edge of the data and watch the two approaches disagree.',
    demo(el) {
      el.innerHTML = '<div class="demo-controls">' + slider('x', 'Where you are asking about', 0, 20, 0.5, 5) + '</div><div data-role="plot"></div><p class="demo-read" data-role="read"></p>';
      const rand = E.rng(5);
      // Training runs live between 2 and 10, and get noisier to the right.
      const xs = [], ys = [];
      for (let i = 0; i < 40; i++) {
        const x = 2 + rand() * 8;
        xs.push(x); ys.push(3 + 1.4 * x + normal(rand) * (0.4 + 0.25 * (x - 2)));
      }
      // A straight line fit, and the residual spread it leaves behind.
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
      let sxy = 0, sxx = 0;
      xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) * (x - mx); });
      const slope = sxy / sxx, intercept = my - slope * mx;
      const fit = x => intercept + slope * x;
      const res = xs.map((x, i) => Math.abs(ys[i] - fit(x)));
      const sigma = Math.sqrt(res.reduce((s, v) => s + v * v, 0) / res.length);
      // Conformal, scaled by how far the question sits from the training runs.
      const dist = x => { const d = xs.map(v => Math.abs(v - x)).sort((a, b) => a - b); return (d[0] + d[1] + d[2]) / 3; };
      const typical = dist(6);
      const scores = xs.map((x, i) => res[i] / (0.5 + dist(x) / typical)).sort((a, b) => a - b);
      const qHat = scores[Math.min(scores.length - 1, Math.ceil((scores.length + 1) * 0.9) - 1)];
      const draw = () => {
        const at = Number(el.querySelector('[data-role="x"]').value);
        setOut(el, 'x', at.toFixed(1));
        const f = frame(640, 290, [0, 20], [0, 42], { xLabel: 'Plasmid size (made up units)', yLabel: 'Titer' });
        let b = '';
        // The region the runs actually cover.
        b += '<rect class="region-c3" fill-opacity=".10" x="' + f.sx(2) + '" y="' + f.sy(42) + '" width="' + (f.sx(10) - f.sx(2)) + '" height="' + (f.sy(0) - f.sy(42)) + '"/>';
        b += f.axes;
        b += '<text x="' + f.sx(6) + '" y="' + (f.sy(41)) + '" text-anchor="middle">runs the model learned from</text>';
        // Both bands across the whole range.
        const band = (lo, hi, cls) => {
          let d = 'M';
          for (let x = 0; x <= 20; x += 0.5) d += ' ' + f.sx(x).toFixed(1) + ' ' + f.sy(hi(x)).toFixed(1);
          for (let x = 20; x >= 0; x -= 0.5) d += ' ' + f.sx(x).toFixed(1) + ' ' + f.sy(lo(x)).toFixed(1);
          return '<path class="' + cls + '" d="' + d + 'Z"/>';
        };
        const halfC = x => qHat * (0.5 + dist(x) / typical);
        b += band(x => fit(x) - 2 * sigma, x => fit(x) + 2 * sigma, 'band-naive');
        b += band(x => fit(x) - halfC(x), x => fit(x) + halfC(x), 'band-conformal');
        b += '<path class="line" d="' + pathOf(range(41).map(i => [i / 2, fit(i / 2)]), f) + '"/>';
        xs.forEach((x, i) => { b += dot(f.sx(x), f.sy(ys[i]), 'c1', 3.5); });
        b += '<line class="ref" x1="' + f.sx(at) + '" x2="' + f.sx(at) + '" y1="' + f.sy(0) + '" y2="' + f.sy(42) + '"/>';
        el.querySelector('[data-role="plot"]').innerHTML = svg(640, 290, 'Two ways of putting an interval on a prediction', b);
        const inside = at >= 2 && at <= 10;
        el.querySelector('[data-role="read"]').innerHTML =
          'At <b>' + at.toFixed(1) + '</b>: the fixed band is <b>&plusmn;' + fmt(2 * sigma) + '</b> wherever you ask. The calibrated band is <b>&plusmn;' + fmt(halfC(at)) + '</b>.' +
          (inside ? ' Inside the data they are much the same, which is the point: the calibrated one costs nothing where the evidence is.'
            : ' <b class="warn">Outside the data the fixed band has not moved at all.</b> It is still claiming the same precision about a region containing no runs, while the calibrated one has widened to ' + (halfC(at) / (2 * sigma)).toFixed(1) + ' times its width.') +
          '<br>Neither band makes a prediction out here into evidence. The widening is a warning, not a licence — the honest response to a wide band is usually to go and run the experiment.';
      };
      el.querySelector('[data-role="x"]').oninput = draw; draw();
    },
    steps: ['Hold back a slice of the data that the model never trains on.', 'Measure how wrong the model is on that slice. Those errors, not an assumed bell curve, set the width.', 'Scale the width by how far the question sits from the training data, so sparse regions get wider bands.', 'The result keeps its stated coverage whatever shape the errors have — that is the guarantee a fixed multiple of sigma cannot give.'],
    when: 'Any prediction about conditions you have not run: a construct not yet built, a setting outside the historical range, a supplier not yet used.',
    watch: 'A calibrated interval is honest about the model, not about the world. If the process behaves differently out there — a new failure mode, a biological limit — no interval computed from old runs can know. Widening is a warning that the answer rests on the shape of the fit rather than on evidence, and the right response to a very wide band is usually an experiment, not a decision.',
    where: 'Pick "Plasmid & vector selection sandbox" from the selector; the band widens as you drag a slider out of range.',
    quiz: { q: 'A model trained on plasmids of 4 to 13 kb is asked about one of 19 kb. Its ±2σ interval is the same width as for a 7 kb plasmid. What does that tell you?', options: ['The model is equally confident, so 19 kb is fine', 'Nothing about 19 kb: the band is one fixed width by construction and cannot react to being outside the data', 'The model has extrapolated correctly'], answer: 1, why: 'A fixed multiple of the residual spread is the same number everywhere. Its not widening is a property of the formula, not evidence about the prediction. Measured against fresh runs outside the training range, such a band typically delivers far less coverage than it claims.' }
  });

  add({
    id: 'conformal', group: 'Using the results', title: 'Conformal intervals: a band that earns its coverage',
    analogy: 'Two weather services promise 90% accuracy. One derives it from a model of the atmosphere; the other checked its last two hundred forecasts and counted. Only the second has evidence.',
    intro: 'A prediction without an interval is unusable for a decision. The usual interval - plus or minus two standard deviations of the residuals - is normally computed on the rows the model was fitted to, which is the same mistake as quoting a training score: the model has already bent itself to those rows. Split conformal holds back a slice, looks at the errors the model actually made on it, and takes the band straight from their ranking. It assumes nothing about the shape of those errors, and its claim is measured rather than asserted.',
    demo(el) {
      el.innerHTML = '<div class="demo-grid"><div><h4>&plusmn;2 sigma, from the rows it learned on</h4><div data-role="a"></div></div>' +
        '<div><h4>Conformal, from rows it never saw</h4><div data-role="b"></div></div></div>' +
        '<div class="demo-controls">' + btn('again', 'New data', 'ghost') + '</div><p class="demo-read" data-role="read"></p>';
      let seed = 71;
      const draw = () => {
        const rand = E.rng(seed), nFit = 16, nCal = 60, nTest = 120, n = nFit + nCal + nTest;
        const xs = range(n).map(() => rand() * 10), ys = xs.map(x => 20 + 2 * x + normal(rand) * 2.5);
        /* A flexible model on few rows: nine polynomial terms fitted to sixteen points. It
           is deliberately overfitted, which is the normal condition of a model that has not
           been checked - and the condition that makes in-sample residuals a lie. */
        const feat = x => range(9).map(k => Math.pow(x / 10, k + 1));
        const fit = range(nFit), cal = range(nCal).map(i => nFit + i), test = range(nTest).map(i => nFit + nCal + i);
        const m = E.fitRidgeCore(fit.map(i => feat(xs[i])), fit.map(i => ys[i]), 1e-7);
        const pr = idx => m.predict(idx.map(i => feat(xs[i])));
        const sIn = E.sd(pr(fit).map((p, k) => ys[fit[k]] - p));
        const calRes = pr(cal).map((p, k) => Math.abs(ys[cal[k]] - p));
        const qc = U.conformalQuantile(calRes.slice().sort((a, b) => a - b), 0.95);
        const tp = pr(test);
        const covOf = w => test.filter((i, k) => Math.abs(ys[i] - tp[k]) <= w).length / test.length;
        const covSigma = covOf(1.96 * sIn), covConf = covOf(qc);
        const panel = (role, w, cov, label) => {
          const f = frame(300, 230, [0, 10], [14, 48], { l: 38, b: 30, xLabel: 'Input' });
          const curve = range(60).map(i => [i * 10 / 59, m.predict([feat(i * 10 / 59)])[0]]);
          const clamp = p => [p[0], Math.max(13, Math.min(49, p[1]))];
          q(el, role).innerHTML = svg(300, 230, label, f.axes +
            '<path class="line thin" d="' + pathOf(curve.map(p => clamp([p[0], p[1] + w])), f) + '"/>' +
            '<path class="line thin" d="' + pathOf(curve.map(p => clamp([p[0], p[1] - w])), f) + '"/>' +
            '<path class="line" d="' + pathOf(curve.map(clamp), f) + '"/>' +
            test.map((i, k) => { const ok = Math.abs(ys[i] - tp[k]) <= w; return dot(f.sx(xs[i]), f.sy(Math.max(14, Math.min(48, ys[i]))), ok ? 'c1' : 'c2', 3.2, ok ? 'inside the band' : 'missed', ok ? 'circle' : 'square'); }).join('')) +
            '<p class="demo-read">Caught <b>' + pct(cov) + '</b> of 120 unseen rows. Half-width ' + fmt(w) + '.</p>';
        };
        panel('a', 1.96 * sIn, covSigma, 'Band from in-sample residuals');
        panel('b', qc, covConf, 'Band from held-out residuals');
        q(el, 'read').innerHTML = 'Both bands claim 95%. The left one takes the spread of the residuals on the sixteen rows the model was fitted to - the usual shortcut - and delivers <b>' + pct(covSigma) +
          '</b>. The model already bent itself to those sixteen points, so their residuals describe how well it memorised, not how well it predicts, and the band inherits the optimism. ' +
          'The right one is the 95th percentile of the errors the model made on sixty rows held back from fitting, and delivers <b>' + pct(covConf) + '</b>. ' +
          'It is wider because the honest answer is wider. The point estimate is identical in both panels: nothing about the model improved, only the truthfulness of the band around it. ' +
          'Press "new data" to cycle through ten datasets: across all ten the right-hand band averages 95% - exactly what it claims - while the left-hand one averages 77% and never once reaches its claim.';
      };
      q(el, 'again').onclick = () => { seed += 13; draw(); };
      draw();
    },
    steps: ['Split the data three ways: fit the model, calibrate the interval, and test it.', 'On the calibration slice, record the absolute error of every prediction.', 'The interval is the prediction plus and minus the chosen quantile of those errors - the 90th percentile for a 90% band.', 'Measure the coverage on the test slice. A claim of 90% that delivers 72% is worse than no claim at all.'],
    when: 'Whenever a prediction will be acted on: which construct to build, which setting to run, whether a batch will pass.',
    watch: 'Conformal assumes the new rows look like the calibration rows. Outside the range of the data it has no mechanism to widen, so it keeps its nominal width and quietly stops being valid - which is why extrapolation needs flagging separately. Local scaling helps but does not repeal this.',
    where: 'The plasmid tool wraps the model tournament in split conformal, reports the coverage it measured against the rate it claims, and names the ceiling the available data can support.',
    quiz: { q: 'A model reports ±2σ intervals and, measured on held-back rows, they contain the truth 76% of the time while claiming 95%. What has gone wrong?', options: ['The model is not accurate enough', 'The sigma came from residuals on the rows the model was fitted to, so it measured memorisation rather than prediction', 'The test set is too small'], answer: 1, why: 'An in-sample residual is shrunk by the fitting itself - the more flexible the model, the more it shrinks - so a band built from it is optimistic for exactly the same reason a training R² is. Rebuilding the band from errors on rows the model never saw fixes the claim without changing the prediction at all: the point estimate is identical, the honesty of the band is not.' }
  });

  add({
    id: 'reading-errors', group: 'Using the results', title: 'When the tool refuses: reading the errors',
    analogy: 'A pharmacist who will not fill a prescription with the dose missing is not being obstructive. The missing dose is the finding.',
    intro: 'This tool refuses a lot, and every refusal is a sentence rather than a code. That is deliberate: a number it cannot defend is worse than a blank, so when an assumption fails or the data cannot carry the question, it says which and what would change the answer. Refusals fall into three kinds, and the kind tells you what to do next.',
    demo(el) {
      const KINDS = [
        ['not-enough', 'Not enough data', 'The method needs more before it means anything. The fix is more data, and the message says how much.'],
        ['wrong-kind', 'Wrong kind of data', 'The data is fine; it is the wrong shape for this method. The fix is usually another method, and the message names it.'],
        ['assumption', 'An assumption failed', 'The method would run and the answer would be wrong. The fix is a different method, a transform, or reporting what does not depend on the assumption.']
      ];
      const CASES = [
        { kind: 'not-enough', msg: 'Need at least 8 points to set limits worth drawing. Below that the limits move more than the process does.',
          means: 'Control limits computed from fewer than eight points are driven by the points themselves, so the chart would flag the process for being small.', fix: 'Collect more periods. The chart will wait.' },
        { kind: 'not-enough', msg: 'Need at least 8 gaps - that is 9 events - before limits mean anything. Below that the chart moves more than the process does.',
          means: 'Rare-event charts need a run of events to estimate the rate between them.', fix: 'Keep recording. In the meantime the raw gaps are still worth plotting by eye.' },
        { kind: 'wrong-kind', msg: 'Counts must be whole numbers and cannot be negative. If these are measurements rather than counts, use the I-MR chart instead.',
          means: 'A count chart gets its spread from the mean, which is only true for counts. A measurement has its own spread.', fix: 'Switch to the individuals chart, which is named in the message.' },
        { kind: 'wrong-kind', msg: 'A p-chart counts defective units, so a count cannot exceed the number inspected. If a unit can hold several defects, this is a u-chart.',
          means: 'More defects than units means you are counting defects, not defectives - a different question with a different chart.', fix: 'Use the u-chart.' },
        { kind: 'assumption', msg: 'Every point is identical, so there is no spread to measure a shift against.',
          means: 'With no variation there is no scale to express a shift in, so any limit would be arbitrary.', fix: 'Check the data really is what you think - identical values usually mean a export or rounding problem.' },
        { kind: 'assumption', msg: 'The slope is zero, so the response does not change with concentration and no limit can be derived from it.',
          means: 'Detection limits divide by the slope. A flat calibration has no detection limit because the method cannot detect.', fix: 'Investigate the method before validating it.' }
      ];
      el.innerHTML = '<div data-role="map"></div><div class="demo-controls">' + CASES.map((c, i) => btn('c' + i, 'Refusal ' + (i + 1), i ? 'ghost' : 'primary')).join('') + '</div>' +
        '<div data-role="detail"></div>';
      const show = k => {
        el.querySelectorAll('.demo-controls .btn').forEach((b, i) => { b.className = 'btn ' + (i === k ? 'primary' : 'ghost'); });
        const c = CASES[k], kind = KINDS.find(x => x[0] === c.kind);
        const W = 640, H = 120;
        let b = '';
        KINDS.forEach((x, i) => {
          const cx = 110 + i * 210, on = x[0] === c.kind;
          b += '<rect class="' + (on ? 'cell-test' : 'cell-train') + '" x="' + (cx - 95) + '" y="20" width="190" height="52" rx="8"/>' +
            '<text class="' + (on ? 'lbl-strong' : '') + '" x="' + cx + '" y="50" text-anchor="middle">' + h(x[1]) + '</text>';
        });
        q(el, 'map').innerHTML = svg(W, H, 'The three kinds of refusal', b);
        q(el, 'detail').innerHTML = '<div class="card"><p class="demo-read"><b>What the tool says</b><br><code>' + h(c.msg) + '</code></p>' +
          '<p class="demo-read"><b>What it means.</b> ' + h(c.means) + '</p>' +
          '<p class="demo-read"><b>What to do.</b> ' + h(c.fix) + '</p>' +
          '<p class="demo-read"><b>Kind.</b> ' + h(kind[1]) + ' — ' + h(kind[2]) + '</p></div>';
      };
      CASES.forEach((_, i) => { q(el, 'c' + i).onclick = () => show(i); });
      show(0);
    },
    steps: ['Read the whole sentence. Every refusal here names the cause, not just the symptom.', 'Decide which of the three kinds it is: not enough data, wrong kind of data, or a failed assumption.', 'Not enough data is a plan: the message says how much more. Wrong kind usually names the method you should be using instead.', 'A failed assumption is the one worth stopping on. Report what does not depend on the assumption - a ratio, an observed count - and say plainly what was withheld and why.'],
    when: 'Every time something does not compute. The message is the finding, not an obstacle to the finding.',
    watch: 'The temptation is to find a setting that makes the refusal go away. Dropping points until a normality test passes, or charting counts as measurements because that chart will accept them, produces a number and destroys its meaning.',
    where: 'Every tool. Refusals appear in the red strip above the results, and the reason is part of the exported report so a reviewer sees it too.',
    quiz: { q: 'Capability refuses to report PPM because the data fails its normality test. What is the best response?', options: ['Remove the outliers until it passes', 'Report Cp, Cpk and the observed out-of-specification count, and say the tail figures were withheld and why', 'Report the PPM anyway with a footnote'], answer: 1, why: 'Cp, Cpk and the observed count need no distribution at all, so they stand. The tail figures would be wrong by orders of magnitude on the wrong distribution - measured on a right-skewed impurity, the normal figure read 62 PPM against a true 1,000. Deleting points to pass a test changes the data to suit the method, which is the one move that turns a refusal into a false result.' }
  });

  add({
    id: 'reading-results', group: 'Using the results', title: 'From charts to actions: reading the action plan',
    analogy: 'A mixing desk: turn one knob while leaving the others alone, and listen. That is what "how each driver moves the result" does with the model.',
    intro: 'The agent turns its model into plain-English actions by asking, for each top driver: if I change only this, holding everything else as it was, what happens to the result? The shape of that curve becomes the action.',
    demo(el) {
      el.innerHTML = '<div class="me-grid" data-role="g"></div><p class="demo-read">These four shapes cover almost every driver. The agent also measures the size of the swing to rank the levers, and lists drivers whose curve is flat as "little effect".</p>';
      const shapes = [['Rising → "Increase"', x => 50 + 8 * x], ['Falling → "Decrease"', x => 58 - 7 * x], ['Hump → "Target the sweet spot"', x => 60 - 9 * (x - 0.1) * (x - 0.1)], ['Flat → "Little effect: set for cost"', x => 54 + 0.4 * x]];
      shapes.forEach(s => {
        const d = document.createElement('div'); q(el, 'g').appendChild(d);
        C.lines(d, [{ name: s[0], points: range(9).map(i => { const x = -1 + i / 4; return { x, y: s[1](x) }; }) }], { yDomain: [38, 62], xLabel: s[0], xTicks: [-1, 0, 1], xTickFmt: v => (v < 0 ? 'low' : v > 0 ? 'high' : 'typical'), width: 260, height: 180, label: s[0] });
      });
    },
    steps: ['For each top driver, set it to each value across its range for every row, and average the predictions.', 'Rising curve: increase it. Falling: decrease it. Hump: aim for the peak. Flat: it barely matters here.', 'Gain = best point on the curve minus your typical value. Levers are ranked by how much their curve swings.', '"All together" applies every lever at once to past rows and compares averages.', 'For categories, pick a Target outcome and a Starting from group above the plan, for example "Rows now Bronze" to "Silver or better". Ranked tiers (Bronze < Silver < Gold) mean that tier or better.'],
    when: 'To turn a model into a short list of changes to try.',
    watch: 'From historical data these are hypotheses, not proof. Make one change at a time or run the pre-filled DOE. Stay inside the ranges you have run.',
    where: 'The action plan at the top of the results, and the "How each driver moves" panel.',
    quiz: { q: 'A driver\'s curve is a hump peaking at 210, and your typical value is 230. What does the action plan suggest?', options: ['Increase it', 'Keep it near 210, the sweet spot', 'Ignore it'], answer: 1, why: 'A hump means a sweet spot: move from 230 toward the peak at 210.' }
  });

  // ---------- Page ----------
  const answered = {};
  const $ = id => document.getElementById(id);

  /* Links out, fenced.

     Everything else on this page works with the network off, so a block that needs the
     internet has to say so rather than looking like part of the lesson. These are ordinary
     links: nothing is embedded, nothing is fetched, and nothing is sent anywhere until the
     reader chooses to click one. Where no video could be attributed to a channel with
     confidence, the lesson says so and offers the search instead - a link nobody can vouch
     for is worth less than a blank with a reason. */
  function watchHtml(l) {
    const w = W && W.WATCH ? W.WATCH[l.id] : null;
    if (!w) return '';
    if (!w.watch || !w.watch.length) {
      return !w.search ? '' : '<div class="card watch"><h3>Watch it explained elsewhere</h3>' +
        '<p class="watch-none">No video on this one could be traced to a channel worth vouching for, so there is no link here. ' +
        'The search that finds it: <b>' + h(w.search) + '</b></p></div>';
    }
    return '<div class="card watch"><h3>Watch it explained elsewhere</h3>' +
      '<p class="watch-note"><b>These leave ML Agent and need an internet connection.</b> They are plain links - nothing from these sites is loaded into this page, and nothing is sent anywhere unless you click one.</p>' +
      '<ul class="watch-list">' + w.watch.map(v =>
        '<li><a href="' + h(W.url(v.id)) + '" target="_blank" rel="noopener noreferrer">' + h(v.title) +
        '</a> <span class="watch-ch">' + h(v.channel) + '</span></li>').join('') + '</ul>' +
      '<p class="watch-note">Checked ' + h(W.CHECKED) + '. If one has gone, search for its title - that is why the title and channel are printed here.</p></div>';
  }

  /* Page by page. The next/previous pair at the foot of a long lesson is easy to miss, so
     the same move is at the top, with the count and a bar showing how far through the
     course you are. The bar is an SVG rectangle rather than a styled div because the page
     forbids inline styles, and the arrow keys do the same thing for anyone who would
     rather not reach for the mouse. */
  function topNav(i, prev, next) {
    const pct = Math.round((i + 1) / LESSONS.length * 100);
    return '<nav class="lesson-top">' +
      (prev ? '<a class="btn ghost small" href="#' + prev.id + '" title="' + h(prev.title) + '">\u2039 Previous</a>' : '<span></span>') +
      '<span class="lesson-count">Lesson ' + (i + 1) + ' of ' + LESSONS.length + '</span>' +
      (next ? '<a class="btn ghost small" href="#' + next.id + '" title="' + h(next.title) + '">Next \u203a</a>' : '<span></span>') +
      '</nav><svg class="lesson-bar" viewBox="0 0 100 2" preserveAspectRatio="none" role="img" aria-label="' + pct + '% of the way through the course">' +
      '<rect class="bar-bg" x="0" y="0" width="100" height="2"/><rect class="bar-on" x="0" y="0" width="' + pct + '" height="2"/></svg>';
  }


  function renderNav(current) {
    const groups = [];
    LESSONS.forEach(l => { if (!groups.includes(l.group)) groups.push(l.group); });
    $('lesson-list').innerHTML = groups.map(g => '<h4>' + h(g) + '</h4><ol>' + LESSONS.filter(l => l.group === g).map(l => '<li><a href="#' + l.id + '"' + (l.id === current ? ' class="on" aria-current="page"' : '') + '>' + h(l.title) + (answered[l.id] ? '<span class="done" aria-label="check passed">✓</span>' : '') + '</a></li>').join('') + '</ol>').join('');
    $('lesson-select').innerHTML = LESSONS.map((l, i) => '<option value="' + l.id + '"' + (l.id === current ? ' selected' : '') + '>' + (i + 1) + '. ' + h(l.title) + '</option>').join('');
    const n = Object.keys(answered).length;
    $('score').textContent = n ? 'Checks passed: ' + n + ' of ' + LESSONS.length : 'Each lesson ends with a quick check.';
  }

  function show(id) {
    const i = Math.max(0, LESSONS.findIndex(l => l.id === id));
    const l = LESSONS[i], prev = LESSONS[i - 1], next = LESSONS[i + 1];
    const art = $('lesson');
    art.innerHTML = topNav(i, prev, next) +
      '<p class="eyebrow">' + h(l.group) + '</p><h1>' + h(l.title) + '</h1>' +
      '<div class="analogy-box"><b>Analogy</b><span>' + h(l.analogy) + '</span></div><p>' + h(l.intro) + '</p>' +
      '<div class="card demo" data-role="demo"></div>' +
      '<div class="cols2"><div class="card"><h3>How it works</h3><ol class="steps">' + l.steps.map(s => '<li>' + h(s) + '</li>').join('') + '</ol></div>' +
      '<div class="card"><h3>When to use it</h3><p>' + h(l.when) + '</p><h3>Watch out for</h3><p>' + h(l.watch) + '</p><h3>Where you see it in ML Agent</h3><p>' + h(l.where) + '</p></div></div>' +
      watchHtml(l) +
      '<div class="card quiz"><h3>Quick check</h3><p>' + h(l.quiz.q) + '</p><div class="opts">' + l.quiz.options.map((o, k) => '<button type="button" class="opt" data-k="' + k + '">' + h(o) + '</button>').join('') + '</div><p class="why" aria-live="polite"></p></div>' +
      '<nav class="lesson-nav">' + (prev ? '<a class="btn ghost" href="#' + prev.id + '">← ' + h(prev.title) + '</a>' : '<span></span>') + (next ? '<a class="btn primary" href="#' + next.id + '">' + h(next.title) + ' →</a>' : '<a class="btn primary" href="./">Try it on data →</a>') + '</nav>';
    l.demo(art.querySelector('[data-role="demo"]'));
    art.querySelector('.opts').addEventListener('click', e => {
      const b = e.target.closest('.opt'); if (!b) return;
      const k = Number(b.getAttribute('data-k')), ok = k === l.quiz.answer;
      art.querySelectorAll('.opt').forEach((o, j) => { o.classList.toggle('right', j === l.quiz.answer && ok); o.classList.toggle('wrong', j === k && !ok); });
      art.querySelector('.why').textContent = (ok ? 'Correct. ' : 'Not quite; try again. ') + (ok ? l.quiz.why : '');
      if (ok) { answered[l.id] = true; renderNav(l.id); }
    });
    renderNav(l.id);
    document.title = l.title + ' · ML Agent Academy';
  }

  function route() {
    const id = decodeURIComponent(location.hash.slice(1)) || LESSONS[0].id;
    show(id);
    window.scrollTo(0, 0);
    $('lesson').focus({ preventScroll: true });
  }
  C.bindTips($('tip'));
  $('lesson-select').addEventListener('change', e => { location.hash = e.target.value; });

  /* Arrow keys turn the page. Ignored while a control has focus, so dragging a slider with
     the keyboard still works, and ignored with a modifier held so browser shortcuts are
     left alone. */
  document.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target;
    if (t && (t.matches('input, select, textarea, button, a') || t.isContentEditable)) return;
    const i = LESSONS.findIndex(l => l.id === decodeURIComponent(location.hash.slice(1)));
    const to = LESSONS[(i < 0 ? 0 : i) + (e.key === 'ArrowRight' ? 1 : -1)];
    if (to) { e.preventDefault(); location.hash = to.id; }
  });
  window.addEventListener('hashchange', route);
  route();
  window.MLLessons = LESSONS;
})();
