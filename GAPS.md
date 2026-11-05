# What is missing, by department

A readout for the Digital Innovation team before this goes under code review. It is written
to be argued with: every gap below is quoted verbatim from the tool's own content, which the
build checks, so nothing here is a summary of a summary.

## How to read it

Gaps fall into three classes, and the class decides who should pay for the work.

| Class | Meaning | Who acts |
|---|---|---|
| **A — buildable** | Fits the current architecture: tabular data, vanilla JavaScript, runs offline in one page. Bounded, testable work. | This tool |
| **B — architectural** | Would require reading images or spectra, holding a trained model, calling a service, or writing prose. Any of these breaks the one guarantee the tool rests on: nothing leaves the browser, and there is no model and no AI service in it. | A different system |
| **C — somebody else's job** | Workflow, records, compendial and regulatory decisions. Not a limitation of the statistics; a different kind of software. | An existing system |

A class B gap is not a backlog item. Closing one means giving up the privacy guarantee, the
offline guarantee, or both, and the guarantee is most of why the tool is usable without a
validation project.

## What has been delivered since this evaluation was first written

Nine class A gaps are closed: the **rare-event chart**, **CUSUM and EWMA**, the **ICH Q2 calculations**, **capability across sites**, **subgroup charts**, **forecasting with a backtest**, **reliability distributions**, the **size distribution across bins**, and **changepoint detection**. Their rows below are marked
delivered and their department bullets are gone. The build fails if any gap here claims a capability the
code can be shown to have, so this section cannot silently go stale again.

| **Subgroup charts** (X-bar with R or S) | A | GMP manufacturing | **Delivered.** On the variance bench. The spread chart is drawn first and the X-bar reading is gated on it, because the limits on the averages are computed from that spread. Specification limits are never drawn on the X-bar chart, with the reason given. And the subgrouping itself is checked: if the averages scatter far less than the within-subgroup spread predicts, each subgroup is carrying the variation it should be comparing across, and the chart is reported as unable to signal. |

## Priority, by how many departments it blocks

| Gap | Class | Departments affected | Assessment |
|---|---|---|---|
| **Rare-event chart** (units or days between events) | A | GMP manufacturing, particle characterization, microbiology, facilities | **Delivered.** Gaps between events, on probability limits rather than three sigma, with the three-sigma limits drawn beside them so the difference is visible, and the run rule taken from a baseline median rather than from all the data. All four departments' bullets have been removed. |
| **Image and spectrum reading** | B | Cell line, downstream, AFS, QC, particle characterization, microbiology | Six departments, and not buildable here. See the PICTS note below: the right move is to consume a classifier's output, not to become one. |
| **Live connections** (historian, BMS, SCADA, LIMS) | B | GMP manufacturing, facilities, QC, MSAT | Export-and-load is the deliberate design. A live connection means a server, credentials and a validation burden. |
| **CUSUM and EWMA** | A | GMP manufacturing, and useful to facilities and microbiology | **Delivered.** Both run beside the individuals chart at a matched false-alarm rate, with the baseline stated and the start of the drift estimated. At a one-sigma shift these signal after about 10 points against 45 for a three-sigma chart. |
| **Time-series forecasting and backtesting** | A | Upstream process development, GMP manufacturing | **Delivered.** Naive, seasonal naive, drift, exponential smoothing, Holt, damped trend and Holt-Winters, every one scored by rolling-origin backtest with its parameters fitted inside each origin. The headline is MASE against a baseline the method has to beat, and when it does not the result says so and tells you to forecast with the baseline. Intervals come from the errors the winner actually made across the origins, so their coverage is measured. This is also the harness for anything bought in: a vendor's forecasts arrive as a column and get the same origins, the same baseline and the same number. |
| **ICH Q2 calculations** (linearity, LOD, LOQ, robustness) | A | AFS, QC | **Delivered.** On the limits bench, as a third mode. Linearity is judged by a lack-of-fit test against the method's own repeat error, or by a fitted squared term where no level was replicated - not by r-squared, which reads 0.995 on a curve that visibly bends and is the example the panel ships with. The limits name which of the three sigmas they used and whether the quantitation limit falls anywhere near a standard anybody ran. Robustness reports the smallest effect the design could have detected beside every p-value, so an underpowered study reads as uninformative rather than as a pass. |
| **Reliability distributions** (Weibull, hazard, survival) | A | Facilities | **Delivered.** On the stability bench, as a third mode. Two-parameter Weibull by maximum likelihood with right censoring, so units still running at the end of the record contribute what is known about them instead of being dropped or counted as failures - either of which shortens the life estimate and raises the shape, both in the direction that wrongly recommends preventive replacement. The shape is reported with a 95% interval and the recommendation is gated on it: if that interval covers 1, random failure is still a live explanation and no replacement interval is offered, however much the point estimate leans towards wear-out. Below twenty failures the panel also states the fitting method's own upward bias in the shape, measured rather than quoted - about 21% high at eight failures, 13% at twelve, 8% at twenty, 4% at forty. Mean life is never printed without the shape beside it, and the Weibull probability-plot correlation is reported so a wrong distribution shows up instead of being formatted like a right one. |
| **Changepoint detection** | A | GMP manufacturing, upstream process development | **Delivered.** On the trends bench, as a fourth mode, and wired into the forecast mode so a series that changed regime is flagged before the leaderboard is read — which was the specific failure: a forecast fitted to the whole history carries a line change forward as though it were still in force. The threshold is not a formula, because the hard part here is that EVERY sequence of random numbers has a best split point: measured on 40 points of pure noise, a t-test at the chosen split called it a changepoint about 40% of the time. So the best split is compared against the best split the same numbers give in a few thousand random orders, which puts the multiplicity of searching every cut inside the null; that fired 5 to 6% against the 5% it claims. The position is reported as a bootstrap range, quoted at the 83 to 87% coverage it measures rather than the 90% its percentiles imply, because somebody takes that number to a batch record and looks for what happened on the day. The last regime's mean and spread are what the panel tells you to use, with the cost of not doing so measured: the whole record's spread runs 2.3× the last regime's on a four-sigma step, and capability moves in a direction that has no reliable sign — overstating by 1.56× on one configuration and understating on another, so there is no safe-side argument for the whole record. The dominant failure mode ships as an example rather than a caveat: an autocorrelated series that never changed regime still wanders, and at a within-regime lag-1 of 0.55 the method finds a changepoint in 59% of series where there is none, so the correlation is measured and the warning says so. |
| **Size distribution across bins** | A | Particle characterization | **Delivered.** On the variance bench, as a sixth mode. The shape is summarised by the power-law exponent of cumulative count against size, and tested by the fraction of particles at the lower threshold that reach the upper one — which is a nested proportion with an exact binomial error, not a ratio of two noisy numbers, and so works on the two thresholds USP &lt;788&gt; reports rather than needing a flow-imaging run. That matters because the test and the description behave very differently: measured on simulated populations, the tail fraction fired 5.7% of the time under the null against the 5% it claims and caught a shape change that raised the 25 um count 2.6-fold at an unchanged 10 um count in 100% of runs, while the slope comparison fired 0 times in 300 under the null and caught that same change 22% of the time. Both are reported, with which to believe stated, and the tool's own four-bin example is a case where they disagree. Two bins are flagged as fitting a two-parameter shape exactly, so nothing checks it; a three-parameter lognormal is not compared against a two-parameter power law until four bins give it a residual of its own. And extrapolation past the largest bin is measured rather than offered: from the two USP thresholds to 50 um it overshot by 1.5x, adding smaller bins at 2 and 5 um made it worse at 2.7x, and bins bracketing 50 um got within 6%. |
| **Capability across sites, and equivalence between them** | A | MSAT | **Delivered.** On the variance bench, as a fourth mode. Capability per site, plus a test of whether the sites may be pooled at all - one for the centres, one for the spreads. A combined index is reported only when both pass, and withheld with the reason when they do not, because pooling two centres returns a figure worse than either site has. The between-site share of the total spread says whether harmonising the sites is where the capability is. Given a margin it also tests every pair for equivalence, which is the question a transfer actually needs answered - failing to find a difference is not evidence of sameness - and keeps inconclusive as an available answer. |
| **Compendial and regulatory decision logic** | C | Microbiology, particle characterization, QA | Whether a result is an excursion or reportable is a regulated decision. The tool should keep refusing it. |
| **Document writing** | B/C | QA and regulatory | There is no language model here by choice. A tool that claimed to draft a deviation report would be found out at the worst possible moment. |

## Not gaps, and worth saying so

Three things read like gaps and should not be funded as such.

- **The distribution-free bound needs 299 results.** That is not a limitation to engineer
  around; it is the price of assuming no distribution. A one-sided 99% claim at 95%
  confidence takes 299 samples from the ranking alone, against about ten for the normal
  factor. The tool reports both so the trade is explicit.
- **Capability tail figures are withheld on non-normal data**, and still withheld when a
  Box-Cox transform fails its re-test. That is the feature. On a right-skewed reading the
  straight normal fit reported 0 PPM against a true 1,000.
- **Not a validated GxP system.** Everything here is decision support with an audit trail.
  Changing that is a validation project, not a feature.

## By department

Each list is the tool's own words, as rendered in the panel.

### Particle characterization core (PCC)

Best served of the eleven. Attribute agreement for the type call, Gage R&R for the counter, count charts with the clustering measured, capability on a transformed scale, distribution-free alert levels, the rare-event chart for a finding rate in the tenths of a percent, and now the size distribution fitted across the bins with a test that works on the two thresholds USP <788> actually reports. What is left is class B: image reading, answered by the PICTS note below.

- **[B]** No image or spectrum reading, which for this group is the biggest limitation: FTIR, Raman, SEM-EDX and flow imaging outputs have to arrive as labels and numbers in columns, because the page reads tables and nothing else.
- **[B]** No automated particle type classification. The type call stays a human judgement; what the tool does is measure how consistent and how correct that judgement is.
- **[C]** No USP two-tier decision logic: it will not tell you which tier a result falls in, whether it is an excursion, or whether it is reportable.
- **[A]** No mixture of two populations. The distribution is fitted as one population, so a container holding both silicone oil droplets and protein aggregates gets a single exponent landing between the two and describing neither – the bent line on the log-log plot is the only warning, and reading it is left to you. Splitting a record by particle type needs the type call the tool also cannot make.


### Microbiology & environmental monitoring

The same shape as particle characterization. Counted, rare, judged by eye: the tool now covers all three, the rare-event chart included. What is left for this group is identification and compendial decision logic, and neither is a statistics problem.

- **[B]** No identification or genotyping: an isolate identity has to arrive as a label in a column.
- **[C]** No compendial decision logic. It will not tell you whether a result is an excursion, an action-level breach or reportable.
- **[B]** No image reading, so colony counts must be entered as numbers rather than read from a plate photograph.


### GMP manufacturing

Well covered for measured data. The gaps are the two chart families it does not have, and both are class A.

- **[B]** No live connection to anything: no historian, no SCADA, no LIMS. Export a file and load it.
- **[A]** No detection of a change in SPREAD, or of a gradual drift. The regime search finds steps in the mean only: a process that became more variable at an unchanged average is invisible to it, and a slow ramp has no single best cut, so forcing one on a ramp returns a position with no meaning. CUSUM and EWMA will see a drift starting; neither segments the record for you.
- **[C]** Not a validated GxP system. Everything here is decision support with an audit trail attached.


### Facilities & engineering

Drift detection, multivariate monitoring and now equipment life are covered. What is left is the plumbing and the qualification state, neither of which belongs here.

- **[B]** No connection to a historian, BMS or SCADA. Export a file and load it; nothing here reads a live tag.
- **[A]** No repairable-system model. The Weibull fit treats each row as one unit’s life, which is right for seals, filters and bearings but not for a chiller that has been repaired six times: there the question is whether the gaps between failures are shrinking, which is a point process (power-law NHPP) and is not fitted here. Feed repeated failures of one system in as separate lives and the shape describes a mixture of units that do not exist. A chart of the gaps between events will tell you the rate moved; it will not give you a growth or deterioration parameter.
- **[C]** No qualification or commissioning logic: it will not tell you whether a system is in a qualified state.


### Analytical & formulation sciences (AFS)

The strongest fit in the tool: tolerance intervals, power, agreement, shelf life, equivalence. What is missing is a named ICH Q2 set rather than any underlying capability.

- **[B]** No spectra, chromatograms or images. Everything arrives as computed numbers.
- **[C]** No attribute agreement for more than eight possible calls: a judgement with dozens of categories is closer to a measurement and the method does not apply.
- **[—]** A distribution-free bound exists now, but it needs 299 results for a one-sided 99% claim at 95% confidence against about ten for the normal factor, so for a typical method-validation dataset the honest answer is still that the claim cannot be supported.


### Quality control

Covered for trending, capability and agreement. The gaps are workflow (class C) and the same ICH Q2 set as AFS.

- **[B]** No instrument files. Chromatograms, spectra and plate images have to be reduced to numbers first.
- **[C]** No OOS workflow, no trending database, no stability scheduling: this computes on a file, it does not manage a programme.
- **[—]** The distribution-free bound needs 299 results for a one-sided 99% claim, so a skewed assay with thirty results still gets a refusal - now with the number of results that would change the answer attached to it.


### Upstream process development

Drivers, DOE, multivariate monitoring and the campaign loop all land here. The gaps are a different discipline - kinetics and mechanistic models - not missing statistics.

- **[B]** No raw time-series modelling of a single batch: the multivariate chart compares batches to each other, it does not fit kinetics or forecast a trajectory forward.
- **[C]** No mechanistic models. Nothing here knows Monod, oxygen transfer or metabolic flux; every relationship is learned from your rows.
- **[B]** Soft sensors and real-time feedback are out of scope. This runs on a desk, on a file, after the batch.


### Downstream process development

Trade-off work and mixture designs are well covered. The gaps are chromatogram-level, which is class B.

- **[B]** No chromatogram analysis. Peak integration, tailing and resolution have to arrive as computed numbers; the page does not read traces.
- **[C]** No mechanistic chromatography modelling: no isotherms, no breakthrough prediction, no column scale-up equations.
- **[B]** Pooling criteria are modelled against the outcome you supply; the tool cannot see the fractions themselves.


### Cell line / strain development

Screening, ranking and the vector tool cover the core work. Imaging and sequence-to-function are class B and out of scope respectively.

- **[B]** No imaging. Colony counts, confluence and morphology have to arrive as numbers in a column; the page reads tables, never pictures.
- **[C]** No sequence-to-function prediction. The sequence optimizer works on codon usage, GC content and structure, and says nothing about whether a construct will express.
- **[C]** Single-cell data is out of scope: this is built for one row per clone or per well, not per cell.


### MSAT & technology transfer

Comparability, transfer and characterization designs are well covered. One small class A gap.

- **[C]** No automated PPQ or stage-2 continued-verification report format.
- **[A]** No multi-attribute comparability in one step. Sites are compared one attribute at a time, so a transfer covering a dozen quality attributes is a dozen separate runs with nothing joining them into a verdict. Requiring every attribute to pass also makes the combined claim far harder than any single one - twelve attributes each powered at 80% give about a 7% chance of all passing - and the per-attribute sample size does not account for that.
- **[B]** Nothing here reads a batch record. Every input is a table somebody has already assembled.


### Quality assurance & regulatory

Evidence, audit trail and investigation support are covered. Every remaining gap is class B or C: the tool should not write documents or decide reportability.

- **[B]** It does not write documents. No deviation report, no CAPA narrative, no technical development report: there is no language model on this page and a tool that claimed otherwise would be found out at the worst possible moment.
- **[C]** No CAPA or deviation tracking workflow, no electronic signatures, no record management.
- **[C]** Not a validated GxP system, and the audit trail says so in its own footer.
- **[C]** No regulatory decision logic: it will not tell you whether something is reportable.

## PICTS: should it be integrated?

**No, and the reason is structural rather than a matter of effort. But its output should be,
and that is the more valuable half.**

PICTS classifies particle images from flow imaging into morphological types. This page has
no model in it, reads tables and never pictures, runs with the network off, and declares in
its own security policy that nothing can be sent anywhere. Embedding an image classifier
means one of three things, and all three cost more than they return:

1. **Ship a trained model in the page.** That needs a runtime this project deliberately does
   not carry, and it would make the download a model artefact with its own version, drift
   and qualification. The classifier's validation status would then depend on which copy of
   the page somebody opened.
2. **Call PICTS as a service.** That ends "nothing leaves this browser", which is the single
   claim the tool is built around and the reason it needs no data agreement to use.
3. **Re-implement the classifier.** Two classifiers for one decision, drifting apart, with
   the ugly case being a disagreement nobody can adjudicate.

**What to do instead, and it is better.** PICTS produces a type per particle and therefore
proportions per sample. That is a table, which is exactly what this tool takes. Three things
follow immediately, with no new machinery:

- **Qualify PICTS with the attribute agreement mode.** Treat it as one more appraiser
  alongside your analysts, against a known standard. You get its kappa, its per-class
  agreement, and where the standard is a two-way call, its miss and false alarm rates
  separately — which matter asymmetrically, since calling protein "silicone oil" and the
  reverse have different consequences. The tool already refuses to let perfect
  self-consistency pass as accuracy, which is the exact failure mode of a deterministic
  classifier: PICTS agrees with itself perfectly on the same image every time, and that
  tells you nothing about whether it is right.
- **Trend its output.** Proportions per lot go on a p-chart; counts per type go on a count
  chart with the clustering measured. Both are built.
- **Compare it with manual classification** by two one-sided tests on a margin declared
  first, with inconclusive available as a verdict — which is where that comparison usually
  belongs.

That turns this tool into the thing that **measures whether PICTS can be trusted**, rather
than a second, worse PICTS. It is also the question a reviewer will ask about PICTS first,
and nothing in your current toolchain answers it.

One caveat to carry into that study: the agreement mode handles up to eight categories, and
the miss and false alarm rates are defined for a two-way call only. For a four-way type call
you get kappa, agreement and the per-appraiser comparison against the standard, which is the
right set — but not those two rates, because with four categories there is no single thing
being missed.

## After this handover

Every change from here goes through code review. Three things are worth holding to, because
they are what the test suite enforces today and they are easy to lose:

1. **Every numeric claim is measured**, in `tests/run-tests.js`, on data built so the right
   answer is known in advance. A "measured" claim with no number in it fails the build.
2. **Where the tool cannot answer, it says so** rather than returning a plausible number.
   Several tests exist only to assert that a refusal still happens.
3. **The privacy lint fails the build** if `fetch`, XHR, WebSocket, `localStorage`, cookies
   or an `https:` reference appears outside the marked exceptions.
