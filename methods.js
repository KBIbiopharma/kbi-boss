/* A reference card in three parts: one scannable row per tool - what it is, where it is
   used, what data it takes and what it returns - then the method inside each tool, whether
   it is statistics or machine learning and what its chart is for, and finally what the whole
   suite does when the data is not bell-shaped.

   The input type is named on every row because it decides the method before anything else
   does. Variable data is measured on a scale and carries its own spread; attribute data is a
   count or a call, and its spread is fixed by its mean, so a count on a measurement chart
   gets limits that are not approximately wrong but structurally wrong.

   Two further questions come up constantly and neither is answered by the tool list. The first is
   "is this statistics or ML" - which matters because the two carry different burdens of
   proof: a t-test has an assumption you can check and a p-value that means something
   specific, while a cross-validated model has neither and is judged on whether it predicts
   rows it has never seen. The second is "what happens to my data, which is not normal" -
   and that one has a different answer for every method, so a single reassuring sentence
   would be a lie.

   Content only; no computation, no network, no storage. */
(function (root) {
  'use strict';

  /* kind: 'stats' is a named procedure with assumptions and an exact answer; 'ml' is fitted
     and judged on held-out rows; 'both' uses one to qualify the other. */
  const METHODS = [
    { tool: 'analyze', kind: 'ml', name: 'Model tournament',
      method: 'Up to ten algorithms - linear, ridge, lasso, PLS, trees, random forest, gradient boosting, k-nearest neighbours, a neural network and a baseline - scored by cross-validation',
      answers: 'Which inputs move the result, and what the result would be at settings you have not tried',
      chart: 'A leaderboard of cross-validated scores, and then for each important input a response curve: how the result moves as that input changes while the others sit at their typical values. The range your data actually covers is marked on the curve, so it is visible where the line stops being evidence and starts being an extrapolation.',
      where: 'Two years of batch records where nobody knows which of forty logged parameters matter, and running an experiment on all forty is not an option.',
      inputs: 'Variable and attribute together: numeric columns are used as they are, text columns are encoded. The answer column may be a number (it predicts a number) or a category (it predicts a class). Missing values are allowed and reported.',
      outputs: 'Ranked drivers with a shuffled-target noise floor beneath them, a response curve for each, a prediction at settings you type in, and the cross-validated score with bootstrap uncertainty on it.',
      judged: 'Cross-validated score on rows the model never saw, with bootstrap uncertainty on the score and a shuffled-target noise floor underneath the driver ranking',
      shape: 'No distribution assumed anywhere. Trees and forests do not care about shape at all; the linear family cares only that the errors are not wildly skewed, and the cross-validated score would show it if they were.' },
    { tool: 'analyze', kind: 'stats', name: 'Design of experiments',
      method: 'Full and fractional factorials, Plackett-Burman, definitive screening, central composite, Box-Behnken, and mixture designs fitted with a Scheffe model',
      answers: 'Which factors genuinely cause the effect, rather than which moved together in history',
      chart: 'A Pareto chart of effect sizes with the significance cut-off drawn across it, so the vital few are separated from the rest by the picture rather than by reading a table. An interaction plot\'s crossing lines show factors that only matter in combination, and a response-surface design adds a contour map of the fitted surface with the optimum marked.',
      where: 'Choosing the next sixteen runs instead of guessing, once a screen or a model has narrowed forty parameters down to five.',
      inputs: 'No data to begin with: you give factors and the range or levels each may take, and the tool gives you the run sheet. You bring back one variable response per run. Factors may be continuous settings or categorical levels; mixture components must sum to a constant.',
      outputs: 'A randomized run sheet, effect sizes with p-values corrected for how many terms were tested, an ANOVA table, the fitted model with its optimum, residual plots, and the aliasing a fractional design costs you.',
      judged: 'Effect p-values, corrected for how many terms were tested using Benjamini-Hochberg',
      shape: 'The effect tests assume roughly normal residuals. With a skewed response, a transform before fitting is the usual fix; the residual plots are there to show whether it was needed.' },
    { tool: 'analyze', kind: 'stats', name: 'Capability and control charts',
      method: 'Cp, Cpk, Pp, Ppk, Cpm; I-MR chart with all eight Nelson rules; c, u and p count charts; CUSUM and EWMA; rare-event gap charts',
      answers: 'Is the process capable of its specification, and is it stable over time',
      chart: 'The control chart plots results in time order against limits computed from the process\'s own variation, which is why a point outside them means the process changed rather than that a result failed specification - two different questions that a single histogram cannot separate. The capability plot puts the distribution against your spec limits; CUSUM and EWMA accumulate small deviations so a drift too small to break a limit still shows; and when events are rare the chart switches to the gaps between them.',
      where: 'Monthly release data from a filling line: is it centred, is it stable, is it drifting, and what fraction of future product falls outside specification.',
      inputs: 'Variable data in time order for the I-MR chart, capability, CUSUM and EWMA. Attribute data for the count charts: defect counts per unit or per varying area (c, u) or pass-fail proportions (p). Spec limits are optional - without them you get stability but no capability, and the tool says so rather than inventing limits.',
      outputs: 'Cp, Cpk, Pp, Ppk and Cpm; a control chart with all eight Nelson rules and every signal listed with its rule; PPM, Z.bench and sigma level where normality allows, and a reason where it does not; a Box-Cox recovery attempt; and the dispersion test that decides whether counts need the Laney correction.',
      judged: 'Against your specification limits, with the false alarm rate of each rule set reported beside the signals',
      shape: 'This is where shape matters most, and the tool treats the parts differently: Cp and Cpk are ratios and stand whatever the shape, while PPM, Z.bench and sigma level are normal tail probabilities and are withheld when the data fails its normality test. A Box-Cox transform recovers them where it can, re-tested on the transformed values. Counts go on count charts, whose spread is fixed by the mean rather than measured.' },
    { tool: 'variance', kind: 'stats', name: 'Variance components and Gage R&R',
      method: 'One-way random-effects ANOVA, Tukey honest significant difference, crossed Gage R&R with an interaction test',
      answers: 'Where the variation comes from, and whether the measurement system can see what you are chasing',
      chart: 'A stacked bar that splits the total variation into its sources, so the share belonging to the measurement rather than to the product is visible at a glance - the number that decides whether to investigate the lots or the assay. Tukey intervals beside it show which groups genuinely differ once every pairwise comparison is paid for.',
      where: 'Eight media lots assayed four times each: is the lot-to-lot spread real, or is it one assay disagreeing with itself.',
      inputs: 'A variable response, plus the attribute columns that label it - lot, operator, instrument, day. Gage R&R needs part, operator and repeated-measurement columns, and at least two measurements per part per operator.',
      outputs: 'The variance share of each source with an F test, repeatability and reproducibility as a percentage of tolerance and of study variation, the operator-by-part interaction test, and the number of distinct categories the method can resolve.',
      judged: 'F tests, variance shares, and the number of distinct categories the method can resolve',
      shape: 'ANOVA is fairly forgiving of non-normality when groups are balanced, and the variance shares are descriptive rather than tested. Tukey intervals do assume normality, so on a visibly skewed response read the shares and treat the pairwise intervals as approximate.' },
    { tool: 'variance', kind: 'stats', name: 'Attribute agreement',
      method: 'Percent agreement with Cohen and Fleiss kappa, intervals bootstrapped over samples',
      answers: 'Whether people agree with themselves, with each other, and with the truth, on a judgement rather than a measurement',
      chart: 'One bar per appraiser with its bootstrap interval, against the agreement bands as drawn rules, plus a confusion table against the known truth where one exists - because a miss and a false alarm have different costs and averaging them into one accuracy hides the one you care about.',
      where: 'Qualifying visual inspection, a manual particle call, or an image classifier such as PICTS, where the result is a judgement and not a measurement.',
      inputs: 'Attribute only: each appraiser\'s category call per sample, repeated at least twice, with the known standard alongside where one exists. No numbers anywhere - and perfect self-consistency with no standard proves only consistency, which the tool says rather than scoring it as accuracy.',
      outputs: 'Percent agreement within appraisers, between appraisers and against the standard; Cohen\'s and Fleiss\' kappa with intervals bootstrapped over samples; miss and false-alarm rates for a two-way call; and the verdict against the 0.90 and 0.70 convention.',
      judged: 'Kappa against the 0.90 and 0.70 measurement-systems convention, plus miss and false alarm rates for a two-way call',
      shape: 'No distribution at all: the data is categories. The intervals are resampled rather than taken from an asymptotic formula, precisely because that formula is fragile where these studies live - few samples and rare defects.' },
    { tool: 'limits', kind: 'stats', name: 'Tolerance intervals, power and sample size',
      method: 'Exact tolerance factors by numerical integration, non-central t for power, and distribution-free bounds from order statistics',
      answers: 'Which specification limits this data can defend, and how many results a planned study needs',
      chart: 'The interval drawn over the data\'s own histogram with the specification limits beside it, which answers “can this data defend that limit” by looking rather than by reading a ratio. The power curve shows how the chance of detecting the difference you care about grows with sample size, so the flat part of the curve is where extra runs stop buying anything.',
      where: 'Setting a release specification from thirty batches, or deciding before a comparability study how many runs it needs to be worth running at all.',
      inputs: 'Variable data for the interval. For power and sample size, no data at all: the difference you want to detect, the spread you expect, and the risks you will accept.',
      outputs: 'A tolerance interval at your coverage and confidence with the exact factor it used, the Anderson-Darling normality verdict beside it, a distribution-free bound from the ranking alone with the sample size that bound needs, and the sample size a planned study requires.',
      judged: 'Coverage at a stated confidence, verified by Monte Carlo in the test suite',
      shape: 'The normal-theory factor leans hard on normality, because a specification is a claim about the tails - which is exactly where the wrong distribution bites. Normality is tested with Anderson-Darling, and a distribution-free bound from the ranking alone is reported beside it. That one assumes nothing and needs 299 results for a one-sided 99% claim against about ten, which is the trade.' },
    { tool: 'stability', kind: 'stats', name: 'Shelf life to ICH Q1E',
      method: 'Linear regression with one-sided confidence limits, and the guideline poolability F tests at the 0.25 level',
      answers: 'When the trend meets the specification, and whether batches may be pooled',
      chart: 'The regression line with its one-sided confidence limit alongside and the specification as a horizontal rule. Shelf life is where the limit crosses, not where the line crosses, and the gap between the two crossings is the whole point of the picture.',
      where: 'Setting an expiry date from twelve-month stability data on three batches, to the guideline a regulator will read it against.',
      inputs: 'Variable: a measured attribute at each time point, with a batch label and time in months. Three batches is the guideline\'s expectation; fewer is allowed and reported as what it is.',
      outputs: 'Shelf life read from the confidence limit, the poolability F tests at the 0.25 level with their verdict, slope and intercept per batch, the extrapolation cap the guideline imposes, and the residual plot that shows whether a straight line was the right shape.',
      judged: 'The confidence limit rather than the fitted line, with the guideline extrapolation cap applied',
      shape: 'Assumes the degradation is linear in the fitted scale and the residuals roughly normal. A curved trend is the common failure, and the fit is shown so it is visible rather than taken on trust.' },
    { tool: 'equivalence', kind: 'stats', name: 'Equivalence by two one-sided tests',
      method: 'TOST, paired or unpaired, Welch or pooled, against a margin declared beforehand',
      answers: 'Whether two methods, labs or sites agree closely enough to be interchangeable',
      chart: 'The confidence interval for the difference drawn against the equivalence margin, which collapses the verdict into one picture: wholly inside the margin is equivalent, straddling its edge is inconclusive, wholly outside is different.',
      where: 'A method transfer between two labs, a site-to-site comparability claim, or a supplier change where the claim is sameness rather than no-difference-found.',
      inputs: 'Variable: two sets of measured results, paired or unpaired. The margin is yours, must be set before you look at the data, and is the one input the statistics cannot supply.',
      outputs: 'Both one-sided p-values, the confidence interval for the difference, an explicit verdict of equivalent, different or inconclusive, and - when inconclusive - the sample size that would settle it.',
      judged: 'Both one-sided tests at the stated level, with inconclusive as an explicit third verdict',
      shape: 'A t-based test, so it assumes roughly normal data - and is fairly robust at moderate sample sizes. Badly skewed results are better compared after a transform, or on the median with a different test this tool does not have.' },
    { tool: 'golden', kind: 'both', name: 'Multivariate batch monitoring',
      method: 'Principal component analysis with Hotelling T-squared and Q residuals, limits calibrated on held-out reference batches',
      answers: 'Whether a batch is following the path the good ones took, and which sensor is out of step',
      chart: 'Two charts instead of twenty. Hotelling T² asks whether the batch sits unusually far from the normal operating region; Q asks whether the relationship between the sensors still holds, which is the failure that every single-sensor chart misses. A contribution plot then names the sensor responsible, which is what turns an alarm into an action.',
      where: 'Watching twenty bioreactor tags per batch, where twenty separate charts would be unreadable and would still miss a drifting probe whose every reading stays in range.',
      inputs: 'Variable: one row per batch or per time slice, one column per sensor, plus a set of known-good reference batches to calibrate on. Attribute columns are carried as labels, not modelled.',
      outputs: 'T² and Q per batch against limits calibrated on held-out reference batches, the alarm rate measured on those batches rather than assumed, a scores plot, and the sensor contributions behind each alarm.',
      judged: 'Alarm rates measured on reference batches the model never saw',
      shape: 'The T-squared limit assumes multivariate normal scores, which is why the limits here are calibrated empirically on held-out batches instead - that makes the stated rate true for your data rather than for an assumption about it.' },
    { tool: 'plasmid', kind: 'ml', name: 'Vector selection with calibrated intervals',
      method: 'The model tournament again, wrapped in split conformal prediction and a local difficulty scaling',
      answers: 'Which construct to build for an incoming programme, and how wrong the prediction might be',
      chart: 'Each candidate\'s prediction with its interval, sorted. The intervals carry more information than the ranking: two candidates whose intervals overlap are not distinguishable on this data, however far apart their point predictions sit.',
      where: 'Choosing a construct for an incoming programme from a table of past builds and their outcomes, where the cost of being wrong is a failed build rather than a rounding error.',
      inputs: 'Variable and attribute mixed: construct properties - size, promoter, host, selection marker - against a measured outcome such as titre. A properties table with no outcome column can be ranked by rule but not predicted, and the tool distinguishes the two.',
      outputs: 'A ranked shortlist with split-conformal prediction intervals, the coverage those intervals actually achieved on held-back rows against the rate they claim, and the ceiling the available data can support.',
      judged: 'Interval coverage measured against the nominal rate, with the attainable ceiling reported',
      shape: 'Conformal intervals assume nothing about the distribution of the errors. They are built from the errors actually observed on a held-back slice, which is what makes the coverage hold whatever shape those errors have.' },
    { tool: 'sequence', kind: 'stats', name: 'Codon optimization',
      method: 'NSGA-II multi-objective genetic algorithm with constrained domination',
      answers: 'Which synonymous codon choices satisfy several goals at once',
      chart: 'The Pareto front: every point is a sequence that cannot be improved on one objective without giving something up on another, so the trade-off between codon adaptation, GC content and structure is a curve to choose from rather than a single answer somebody weighted for you.',
      where: 'Preparing a gene for synthesis in a chosen expression host, with sites to avoid and repeats to break up.',
      inputs: 'Neither attribute nor variable data: a protein or DNA sequence, a host codon usage table, and the constraints you want respected.',
      outputs: 'The Pareto set of sequences with every objective scored, the protein back-translated and checked character by character against the original, and the restriction sites, repeats and homopolymers that were avoided.',
      judged: 'The Pareto front, with the protein re-translated and checked at the end',
      shape: 'Not a statistical model: a search over a discrete space. No distribution is involved.' }
  ];

  /* The non-normal question deserves its own answer, because the honest one is "it depends
     which number you are asking for" and that needs saying in one place. */
  const NONNORMAL = {
    lead: 'Biologics data is routinely not bell-shaped. Impurities, aggregates and particle counts are bounded at zero with a long right tail; counts of anything rare are Poisson-ish; a bimodal result usually means two populations have been mixed. What the tool does about it depends on the number being asked for, so here is the whole answer rather than a reassuring sentence.',
    rows: [
      { q: 'Is it tested, or assumed?',
        a: 'Tested. Anderson-Darling, with the small-sample adjustment, wherever a figure depends on the shape. Below about eight results it reports "untested" rather than "passed", because the test has no power worth quoting there.' },
      { q: 'Which figures survive a failed test?',
        a: 'Cp, Cpk, Pp and Ppk are ratios of distances to spread and stand whatever the shape. So does the observed count out of specification, which needs no distribution at all. Those are reported.' },
      { q: 'Which figures are withheld?',
        a: 'Expected PPM, Z.bench and sigma level. Every one of them is a normal tail probability, and a tail probability from the wrong distribution is not approximately right - measured on a right-skewed impurity whose limit sat at its true 99.9th percentile, so the real rate was 1,000 PPM, the normal figure read 62 PPM at a skewness of 0.65 and 0 by a skewness of 1.8.' },
      { q: 'Can they be recovered?',
        a: 'Often. A Box-Cox transform finds the power that makes the data as normal as possible, the specification limits are transformed the same way, and the tail is computed there. Normality is then re-tested on the transformed values and the figures stay withheld if it still fails - no power of a two-humped variable is bell-shaped, and a transform that did not work is not a licence to report.' },
      { q: 'What about specification limits?',
        a: 'The normal-theory tolerance factor is reported with its normality test, and a distribution-free bound from the ranking of the results alone is reported beside it. The second assumes nothing whatever, and costs sample size: 299 results for a one-sided 99% claim at 95% confidence, against about ten. Below that it refuses and says what the data actually reaches.' },
      { q: 'What about counts?',
        a: 'Counts are not measurements and do not go on a measurement chart: a Poisson count’s standard deviation is the square root of its own mean. They go on c, u or p charts, with the dispersion measured rather than assumed - real counts cluster, and limits that ignore that fire constantly. When events are rare the gaps between them are charted instead, with probability limits rather than three sigma, because the gap distribution is heavily skewed.' },
      { q: 'What about the models?',
        a: 'Trees, forests and boosting make no distributional assumption at all. The linear family assumes little more than that the errors are not wildly skewed, and every model is judged by cross-validation on rows it never saw - which is a test of whether it works rather than of whether an assumption held.' },
      { q: 'And the prediction intervals?',
        a: 'Split conformal, built from the errors actually observed on a held-back slice. They assume nothing about the shape of those errors, which is why the coverage holds on skewed data where a normal interval would not.' }
    ],
    close: 'The pattern throughout: test the assumption, report what does not depend on it, recover what can be recovered honestly, and withhold the rest with the reason attached. A number that looks fine and is wrong by two orders of magnitude is worse than a blank.'
  };


  /* The same eight benches as one scannable table. The cards above answer "how does this
     work and what does it assume"; this answers "which one do I open" - which is a
     different question and the one asked first. Input type is called out because it decides
     the method before anything else does: a count on a measurement chart gets limits that
     are simply wrong, and a judgement call cannot go on any chart at all. */
  const TOOLS = [
    { tool: 'analyze',
      what: 'Model tournament and designed experiments in one bench: ten algorithms scored against each other, then a run sheet to prove what the models only suggest.',
      where: 'Historical batch records; process development; any question of the form "which of these inputs actually moves the result".',
      inputs: 'Variable and attribute columns together, one row per batch or run. An answer column that is either a number or a category.',
      outputs: 'Ranked drivers over a noise floor, response curves, cross-validated scores, predictions at new settings, a run sheet, effect p-values, capability and control charts.' },
    { tool: 'stability',
      what: 'Regression with the one-sided confidence limit the shelf-life guideline asks for, plus the batch poolability tests.',
      where: 'Stability studies; expiry dating; any trend where the claim has to hold at the unfavourable end of what the data can rule out.',
      inputs: 'Variable: a measured result at each time point, with a batch label. Time in months.',
      outputs: 'Shelf life from the confidence limit, poolability F tests, per-batch slopes, the extrapolation cap, residual plot.' },
    { tool: 'golden',
      what: 'Principal component analysis with T-squared and Q charts, limits calibrated on batches the model never saw.',
      where: 'Multivariate batch monitoring; many sensors per batch; catching a drifting probe whose every single reading is still in range.',
      inputs: 'Variable: one column per sensor, one row per batch or time slice, plus known-good reference batches.',
      outputs: 'T-squared and Q per batch with measured alarm rates, a scores plot, and the sensor contributions behind each alarm.' },
    { tool: 'equivalence',
      what: 'Two one-sided tests against a margin you set in advance, which is what demonstrating sameness requires.',
      where: 'Method transfer; site-to-site comparability; supplier changes; anywhere "no significant difference" is being misread as "the same".',
      inputs: 'Variable: two sets of results, paired or unpaired. An equivalence margin, declared before looking.',
      outputs: 'Both one-sided p-values, the interval for the difference, a verdict of equivalent, different or inconclusive, and the sample size that would settle it.' },
    { tool: 'variance',
      what: 'Random-effects ANOVA, Gage R&R, attribute agreement, capability across sites and subgroup control charts: everything that starts with a grouping column and a result column.',
      where: 'Measurement system analysis; lot-to-lot questions; qualifying an inspector or a classifier against a known standard.',
      inputs: 'A variable response with the attribute columns that label it (lot, operator, instrument). Attribute agreement takes category calls only.',
      outputs: 'Variance share per source with F tests, repeatability and reproducibility against tolerance, distinct categories, kappa with bootstrap intervals, miss and false-alarm rates.' },
    { tool: 'limits',
      what: 'Tolerance intervals by exact factor, a distribution-free bound beside them, and power and sample size before the study runs.',
      where: 'Setting or defending a specification; sizing a comparability or validation study; answering "is this study worth running".',
      inputs: 'Variable data for the interval. For power, no data: the difference to detect, the spread expected, the risks accepted.',
      outputs: 'The interval with its exact factor and normality verdict, a distribution-free bound with the sample size it needs, a power curve, and the required n.' },
    { tool: 'plasmid',
      what: 'The model tournament wrapped in conformal prediction, so each candidate carries an interval whose coverage has been measured.',
      where: 'Construct and vector selection; any shortlist where two candidates have to be told apart and the honest answer may be that they cannot.',
      inputs: 'Variable and attribute construct properties against a measured outcome such as titre.',
      outputs: 'A ranked shortlist with prediction intervals, the coverage those intervals achieved against the rate they claim, and the ceiling the data supports.' },
    { tool: 'sequence',
      what: 'A multi-objective genetic algorithm that returns the whole trade-off curve rather than one weighted answer.',
      where: 'Codon optimization for a chosen host; any design problem with several goals that genuinely conflict.',
      inputs: 'A sequence, a host codon table, and the constraints to respect. No tabular data.',
      outputs: 'The Pareto set with every objective scored, the protein re-checked against the original, and the sites and repeats avoided.' }
  ];

  root.MLMethods = { TOOLS, METHODS, NONNORMAL };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MLMethods;
})(typeof globalThis !== 'undefined' ? globalThis : this);
