/* Links out to video explanations, one lesson at a time.

   This is the only file in the project that knows a web address exists, and it holds
   exactly one: the line marked PRIVACY-EXTERNAL-LINK, which builds a YouTube watch URL
   from a video id. Everything else here is an id, a title and a channel name. Nothing is
   fetched, embedded or preloaded - no iframe, no thumbnail, no script. A reader who never
   clicks has sent nothing anywhere, and the page's Content-Security-Policy is unchanged,
   because an ordinary link needs no permission that loading a resource would.

   Why links at all, in a tool whose point is that it works with the WiFi off: the academy
   is where someone learns, and the best explanation of gradient boosting is not one this
   project could write. The cost is honest and stated on the page - these need internet,
   and they leave the tool.

   Every link below was present in a live search index on 31 October 2026, under the title
   recorded here. That is what "checked" means: the video existed and was named this. It is
   not a promise that it still does, which is why the title and channel are stored beside
   the id - a dead link stays findable by searching for its title. Where no video could be
   attributed to a channel with confidence, the lesson gets a search phrase instead of a
   link, because an unattributed URL in a validated tool is worse than an honest blank. */
(function (root) {
  'use strict';

  const CHECKED = '31 October 2026';

  // The project's only web address, and it is a link, never a fetch.
  const url = id => 'https://www.youtube.com/watch?v=' + encodeURIComponent(id); // PRIVACY-EXTERNAL-LINK

  const SQ = 'StatQuest with Josh Starmer', B3 = '3Blue1Brown', JMP = 'JMP', MTB = 'Minitab';

  /* Keyed by lesson id. `watch` is what to go and see; `search` is what to type into a
     video site when nothing here could be verified for that lesson. A lesson may have
     neither, and that is a statement too. */
  const WATCH = {
    distributions: { watch: [
      { id: 'qBigTkBLU6g', title: 'StatQuest: Histograms, Clearly Explained', channel: SQ },
      { id: 'rzFX5NWojp0', title: 'The Normal Distribution, Clearly Explained!!!', channel: SQ }] },
    sampling: { watch: [
      { id: 'YAlJCEDH2uY', title: 'The Central Limit Theorem, Clearly Explained!!!', channel: SQ },
      { id: 'XNgt7F6FqDU', title: 'The standard error, Clearly Explained!!!', channel: SQ }] },
    'confidence-intervals': { watch: [
      { id: 'TqOeMYtOc1w', title: 'Confidence Intervals, Clearly Explained!!!', channel: SQ }] },
    'hypothesis-tests': { watch: [
      { id: 'vemZtEM63GY', title: 'p-values: What they are and how to interpret them', channel: SQ }] },
    'data-types': { search: 'attribute data versus variable data control charts' },
    'centre-spread': { search: 'mean median standard deviation interquartile range skewed data' },
    correlation: { search: "Anscombe's quartet correlation misleading" },

    start: { watch: [
      { id: 'Gv9_4yMHFhI', title: 'A Gentle Introduction to Machine Learning', channel: SQ }] },
    'cross-validation': { watch: [
      { id: 'fSytzGwwBVw', title: 'Machine Learning Fundamentals: Cross Validation', channel: SQ }] },
    overfitting: { watch: [
      { id: 'EuBBz3bI-aA', title: 'Machine Learning Fundamentals: Bias and Variance', channel: SQ }] },
    scores: { watch: [
      { id: '2AQKmw14mHM', title: 'R-squared, Clearly Explained!!!', channel: SQ },
      { id: 'Kdsp6soqA7o', title: 'Machine Learning Fundamentals: The Confusion Matrix', channel: SQ }] },

    linear: { watch: [
      { id: '7ArmBVF2dCs', title: 'Linear Regression, Clearly Explained!!!', channel: SQ }] },
    'ridge-lasso': { watch: [
      { id: 'Q81RR3yKn30', title: 'Regularization Part 1: Ridge (L2) Regression', channel: SQ },
      { id: 'NGf0voTMlcs', title: 'Regularization Part 2: Lasso (L1) Regression', channel: SQ }] },
    logistic: { watch: [
      { id: 'yIYKR4sgzI8', title: 'StatQuest: Logistic Regression', channel: SQ }] },
    'naive-bayes': { watch: [
      { id: 'O2L2Uv9pdDA', title: 'Naive Bayes, Clearly Explained!!!', channel: SQ }] },
    knn: { watch: [
      { id: 'HVXime0nQeI', title: 'StatQuest: K-nearest neighbors, Clearly Explained', channel: SQ }] },
    tree: { watch: [
      { id: '_L39rN6gz7Y', title: 'Decision and Classification Trees, Clearly Explained!!!', channel: SQ }] },
    forest: { watch: [
      { id: 'J4Wdy0Wc_xQ', title: 'StatQuest: Random Forests Part 1 - Building, Using and Evaluating', channel: SQ }] },
    boosting: { watch: [
      { id: '3CC4N4z3GJc', title: 'Gradient Boost Part 1 (of 4): Regression Main Ideas', channel: SQ }] },
    'neural-network': { watch: [
      { id: 'aircAruvnKk', title: 'But what is a neural network? | Chapter 1, Deep learning', channel: B3 }] },
    pls: { search: 'partial least squares regression explained' },
    quadratic: { search: 'polynomial regression quadratic model curvature explained' },
    encoding: { search: 'target encoding data leakage cross validation' },
    multicollinearity: { search: 'multicollinearity variance inflation factor explained' },

    kmeans: { watch: [
      { id: '4b5d3muPQmA', title: 'StatQuest: K-means clustering', channel: SQ }] },
    pca: { watch: [
      { id: 'FgakZw6K1QQ', title: 'StatQuest: Principal Component Analysis (PCA), Step-by-Step', channel: SQ }] },

    factorial: { watch: [
      { id: 'xqVbJvhPFvI', title: 'Design of experiments - Full factorial design - JMP', channel: JMP }] },
    designs: { watch: [
      { id: 'QcKTOfYhGZw', title: 'How to Construct a Box-Behnken Design in JMP', channel: JMP }] },
    'definitive-screening': { watch: [
      { id: 'P-5MaBHe_BU', title: 'How to Create a Definitive Screening Design in JMP', channel: JMP }] },
    'response-surface': { watch: [
      { id: 'JjMQ7e4oZcs', title: 'How to Construct a Response Surface Design in JMP', channel: JMP }] },
    multiplicity: { watch: [
      { id: 'L3nlGfSyHV0', title: 'False Discovery Rates, FDR, clearly explained', channel: SQ }] },
    'why-doe': { search: 'why design of experiments correlation is not causation' },
    interactions: { search: 'interaction effects design of experiments interaction plot' },
    significance: { search: 'Pareto chart of effects design of experiments significance' },
    'mixture-designs': { search: 'mixture design of experiments simplex formulation' },
    curvature: { search: 'centre points curvature design of experiments' },
    randomization: { search: 'randomization blocking replication design of experiments' },

    capability: { watch: [
      { id: '6A9Gxk6bJWc', title: 'How to Perform Capability Analysis in Minitab Statistical Software', channel: MTB }] },
    'golden-batch': { watch: [
      { id: 'Y3ciILGN2Vo', title: 'How to Create a Model-Driven Multivariate Control Chart in JMP', channel: JMP }] },
    'variance-components': { watch: [
      { id: 'MZctjlYKcnc', title: 'How to Use the Variability Chart in JMP: A Step-by-Step Tutorial', channel: JMP }] },
    'gage-rr': { watch: [
      { id: 'F4ln6PzVuMI', title: 'Minitab 19 Statistical Software: Gage R&R', channel: MTB },
      { id: 'uBL5e_m_jS0', title: 'How to Perform a Measurement System Analysis in Minitab Statistical Software', channel: MTB }] },
    'power-sample-size': { watch: [
      { id: 'Rsc5znwR5FA', title: 'Statistical Power, Clearly Explained!!!', channel: SQ }] },
    'count-charts': { watch: [
      { id: 'KSld8OiqiS4', title: 'How to Create NP Control Charts and P Control Charts in JMP', channel: JMP }] },
    'drift-charts': { watch: [
      { id: 'L5WCDo9QzE8', title: 'How to Create an EWMA Control Chart in JMP', channel: JMP }] },
    'control-charts': { search: 'control chart common cause special cause variation' },
    taguchi: { search: 'Taguchi methods signal to noise ratio robust design' },
    desirability: { search: 'desirability function multiple response optimization' },
    'shelf-life': { search: 'ICH Q1E shelf life regression stability data' },
    equivalence: { search: 'TOST two one-sided tests equivalence testing' },
    'tolerance-intervals': { search: 'tolerance interval versus confidence interval' },
    'attribute-agreement': { search: 'attribute agreement analysis Cohen kappa' },
    'rare-events': { search: 'g chart rare events time between events control chart' },
    'box-cox': { search: 'Box-Cox transformation capability analysis non-normal' },
    'distribution-free': { search: 'nonparametric distribution-free tolerance interval order statistics' },
    'codon-optimization': { search: 'NSGA-II multi-objective genetic algorithm Pareto front' },
    extrapolation: { search: 'dangers of extrapolation regression outside the data range' },
    conformal: { search: 'conformal prediction distribution-free uncertainty' },
    'forecast-backtest': { search: 'time series cross validation rolling origin MASE baseline' },
    'subgroup-charts': { search: 'X-bar and R chart rational subgrouping explained' },
    'across-sites': { search: 'process capability multiple sites pooled Cpk' },
    linearity: { search: 'method validation linearity residual plot lack of fit' },
    'detection-limits': { search: 'LOD LOQ limit of detection quantitation calculation ICH Q2' },
    'robustness-study': { search: 'analytical method robustness testing design of experiments' },
    'reading-errors': { search: 'checking statistical assumptions before reporting a result' },
    'reading-results': { search: 'turning statistical results into process actions' }
  };

  root.MLWatch = { WATCH, CHECKED, url };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MLWatch;
})(typeof globalThis !== 'undefined' ? globalThis : this);
