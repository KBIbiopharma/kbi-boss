/* What each technique in this tool is used for across industries and functions.

   Written to be read standing up: one line per area, as a comma-separated list of uses.
   These describe the technique in general. Every tool here works on tabular data (and DNA
   sequences in the optimizer), never on images, audio or free text, and each entry's scope
   line says so, so the panel can be shown to an audience without overselling it.

   Content only; no computation, no network, no storage. */
(function (root) {
  'use strict';

  const APPLICATIONS = {
    analyze: {
      tech: 'Supervised and unsupervised learning, neural networks, design of experiments',
      scope: 'In this tool: rows and columns of numbers and categories — batch records, run logs, assay results.',
      groups: [
        { name: 'Upstream', text: 'Clone and feed screening, bioreactor and fermenter parameter effects on titer and quality, scale-down model agreement, harvest timing against what downstream can process.' },
        { name: 'Downstream', text: 'Load, wash and elution conditions against yield and purity, resin and membrane lifetime, pooling criteria, step yields reconciled across the train.' },
        { name: 'Analytical and formulation', text: 'Assay variability split across analyst, instrument and day, excipient and pH effects on stability, method robustness factors, specifications set from real capability.' },
        { name: 'Manufacturing and MSAT', text: 'Batch records mined for deviation causes, site-to-site and scale-to-scale differences, characterisation designs, parameters ranked for the control strategy.' },
        { name: 'Where neural networks earn their place', note: true, text: 'Here a network competes on the same leaderboard as simpler models and wins only when it truly predicts better, which on tabular data is rarer than expected. The same technique drives visual inspection and speech and language work, all of which need inputs this page does not take.' }
      ]
    },
    stability: {
      tech: 'Linear regression with confidence limits, and poolability testing (ICH Q1E)',
      scope: 'In this tool: a measured attribute against time, by batch, against your specification limits.',
      groups: [
        { name: 'Drug substance and drug product', text: 'Purity, aggregate and potency trends to specification, expiry taken from the confidence limit, poolability across primary batches, long-term against accelerated conditions.' },
        { name: 'Formulation development', text: 'Candidate formulations ranked on degradation rate, accelerated against real-time agreement, excipient and pH effects on shelf life, container closure comparisons.' },
        { name: 'Materials and intermediates', text: 'Harvest and pool hold times, buffer and media usable life, resin and membrane lifetime, incoming material expiry set from measured degradation.' },
        { name: 'Filings and claims', text: 'Shelf life with the extrapolation limits the guideline sets, poolability evidence on file, condition-by-condition reporting, expiry maintained as commercial data accrues.' }
      ]
    },
    golden: {
      tech: 'Principal component analysis and multivariate statistical process control (Hotelling T², Q residuals)',
      scope: 'In this tool: time-series readings from several sensors across many batches, aligned on how far through the batch each reading was.',
      groups: [
        { name: 'Live batch monitoring', text: 'A running batch compared against the path good ones took, drift caught during the run rather than in the deviation report, the sensor to blame named as it strays, hours of warning instead of hindsight.' },
        { name: 'Campaign review', text: 'A whole campaign triaged in one table, the unusual batches picked out for review, release supported by how far each batch sat from normal, trends across a campaign rather than one run.' },
        { name: 'Deviation investigation', text: 'The hour a batch went off, the sensors that moved together, whether that pattern ever appeared in a good run, a starting point instead of the whole batch record.' },
        { name: 'Scale-up and transfer', text: 'At-scale batches scored against the scale-down envelope, a receiving site compared with the sending site, a new line judged against the qualified one, trajectories compared rather than endpoints.' },
        { name: 'Probe and equipment health', text: 'A sensor drifting out of step with the rest of the vessel, a seal or valve degrading, calibration slipping between services, all visible before the reading itself leaves its own limits.' },
        { name: 'Why one number beats thirty charts', note: true, text: 'A batch can sit inside every single sensor limit and still be wrong, because what went wrong was the combination: temperature a little high while dissolved oxygen ran low and feed lagged. Thirty charts cannot show a combination. T² is that combination as one line, and Q catches the case where the sensors stop agreeing with each other at all.' }
      ]
    },
    equivalence: {
      tech: 'Equivalence and non-inferiority testing by two one-sided tests (TOST)',
      scope: 'In this tool: results from two methods, labs, instruments or analysts, against a margin you set first.',
      groups: [
        { name: 'Analytical method transfer', text: 'Development laboratory against receiving QC, instrument against instrument, analyst against analyst, a method bridged after a change without full revalidation.' },
        { name: 'Process and scale', text: 'Scale-down model against at-scale, pilot against GMP, site against site, a clone or strain change shown comparable, a suite qualified against the first one.' },
        { name: 'Materials and consumables', text: 'A second resin or media lot, an alternative single-use assembly, a new filter or membrane supplier, a second-source excipient.' },
        { name: 'Comparability after change', text: 'Pre-change against post-change product, biosimilar against reference, a bridging exercise for a process improvement, lot-to-lot equivalence of clinical supplies.' }
      ]
    },
    variance: {
      tech: 'Variance component analysis, one-way ANOVA with Tukey comparisons, and measurement system analysis (Gage R&R)',
      scope: 'In this tool: repeated measurements labelled by the source you suspect \u2014 lot, analyst, instrument, vessel, shift \u2014 or a crossed study of samples by operators.',
      groups: [
        { name: 'Raw materials and suppliers', text: 'Resin, media and buffer lot effects on yield and quality, one supplier against another, incoming lot variability against process variability, the case for tightening or relaxing an incoming specification, a lot disqualified on evidence rather than on suspicion.' },
        { name: 'Analytical methods', text: 'Assay variation split across analyst, instrument, column and day, method precision quantified before a transfer, replicate strategy chosen from measured noise, system suitability limits set from capability, an apparent out-of-trend result tested against the method that produced it.' },
        { name: 'Equipment and measurement systems', text: 'Gage R&R on balances, HPLCs, plate readers and probes, repeatability separated from operator-to-operator disagreement, distinct categories checked before a control chart is trusted, qualification repeated after a service or a software change.' },
        { name: 'Process and equipment trains', text: 'Vessel-to-vessel and skid-to-skid differences, shift and site effects, column and membrane position, nested variation across campaign, batch and sample, the share of spread that is genuinely controllable named before a project is scoped.' },
        { name: 'Specifications and capability', text: 'Specification limits built from the real components of variation rather than from historical ranges, measurement noise removed before capability is quoted, sample sizes justified from the variance structure, tolerance intervals argued from the right error term.' },
        { name: 'Why this comes before everything else', note: true, text: 'A capability index, a trend report and a comparability study all take the measurement at face value. If a third of what you observe is the assay, every one of those numbers is partly about the assay, and no amount of further analysis will separate them after the fact. Splitting the variation first is what tells you whether the rest of the work is measuring your process or your instrument.' }
      ]
    },
    limits: {
      tech: 'Tolerance intervals, statistical power and sample size',
      scope: 'In this tool: one column of independent results for a limit, or the scatter you expect and the difference that matters for a study size.',
      groups: [
        { name: 'Specification setting', text: 'Release and shelf-life limits argued from measured capability, limits defended at a filing or an inspection, in-process action and alert levels, a specification widened or tightened on evidence, the gap between what a process holds and what was committed to on three batches.' },
        { name: 'Study design', text: 'Comparability and method-transfer studies sized before instrument time is booked, characterisation runs costed honestly, stability designs with enough batches to matter, Gage R&R and variance studies sized so their own estimates mean something.' },
        { name: 'Process validation', text: 'Process performance qualification batch numbers justified statistically, continued process verification limits set from the qualification data, acceptance criteria agreed in advance rather than fitted afterwards, sampling plans defended on coverage.' },
        { name: 'Materials and suppliers', text: 'Incoming specifications set from supplier history, a second-source qualification sized to a margin agreed first, certificate-of-analysis limits checked against what the vendor can really hold, hold-time and usable-life limits taken from the data behind them.' },
        { name: 'Deciding not to run a study', text: 'The calculation that shows a planned comparison could never have reached a conclusion, the margin that no achievable study can support, the difference too small to detect against the method noise, and the honest case for improving the measurement first.' },
        { name: 'Why not mean plus three standard deviations', note: true, text: 'On a handful of batches the standard deviation is itself a rough guess, and plugging it into a formula meant for a known sigma produces limits that cover far less than they claim. On ten results the honest factor for 99% coverage is about 4.4, not 3. That gap is the whole reason specifications set on early batches get broken later, and it is arithmetic rather than bad luck.' }
      ]
    },
    plasmid: {
      tech: 'Regression with conformal prediction intervals and explicit extrapolation control',
      scope: 'In this tool: a corpus of screened constructs with their genetic features and measured outcomes, plus a desk for asking about one that has not been built.',
      groups: [
        { name: 'Vector and construct selection', text: 'Promoter and enhancer combinations ranked before synthesis, selection marker choice against expected productivity, plasmid size traded against titer, a shortlist cut to what is worth building, constructs compared on evidence rather than on the last project that worked.' },
        { name: 'Cell line development', text: 'Expected titer and specific productivity for a candidate construct, seed density effects on volumetric output, stable against transient expression compared on the same footing, screening effort pointed at the combinations the history cannot already answer.' },
        { name: 'Deciding what to build next', text: 'The four runs that would settle a question the corpus cannot, high-uncertainty regions identified before money is spent, a screen designed around the inputs that are genuinely outside the data, synthesis budget spent on information rather than on confirmation.' },
        { name: 'Knowing when not to trust the answer', text: 'Predictions flagged when the construct leaves the historical envelope, intervals that widen with distance from the data, promoters and markers never used here mapped to the nearest that were, and a question the corpus cannot support refused outright.' },
        { name: 'Why the interval is the product', text: 'A point prediction for a construct nobody has built is worth very little on its own; what decides whether to spend on synthesis is how wrong it could be. A fixed plus-or-minus band is at its most confident exactly where it is least justified, because it assumes the errors are the same size everywhere. A conformal interval is calibrated against runs held back from training, so it keeps its stated coverage whatever shape the errors take, and widens where the evidence thins.' }
      ]
    },
    sequence: {
      tech: 'Genetic algorithms and multi-objective optimization (NSGA-II)',
      scope: 'In this tool: pointed at codon optimization, evolving synonymous codons while the protein stays identical.',
      groups: [
        { name: 'Construct and strain design', text: 'Host codon usage for CHO, HEK293 or E. coli, restriction sites and homopolymer runs designed out, GC held in the synthesis window, the 5′ end kept unfolded.' },
        { name: 'Process optimisation', text: 'Feed, pH and temperature combinations too numerous to run, objectives that genuinely conflict such as titer against glycans, the trade-off curve rather than one setpoint.' },
        { name: 'Formulation search', text: 'Excipient, buffer and surfactant combinations under competing stability, viscosity and concentration targets, with hard constraints never violated.' },
        { name: 'Scheduling and capacity', text: 'Suite and skid scheduling, campaign sequencing under changeover limits, cleaning and turnaround windows, analytical queues under instrument and analyst constraints.' },
        { name: 'Why multi-objective, not one score', note: true, text: 'Collapsing competing goals into one weighted number hides the trade-off and buries the argument in the weights. A Pareto front shows every option that cannot be improved on one goal without giving ground on another, which is the honest input to a decision somebody has to own.' }
      ]
    }
  };

  /* Tailored examples for recombinant protein CDMO work.

     Two modalities, because that is the real split in how a molecule is made, and the
     functions a development and manufacturing site is actually organised into. Pick a
     function and the panel lists the unit operations that sit inside it, each with what
     machine learning is used for at that step. Zooming in: technique, then function, then
     the step in front of you.

     Function names and unit operations follow common industry practice, not any one
     company's org chart. Rename them to match your own site if they differ.

     The choice is held in memory for the session only: nothing is stored, so it resets on
     reload, like everything else here. */
  const MODALITIES = [
    ['mammalian', 'Mammalian (CHO) recombinant protein'],
    ['microbial', 'Microbial (E. coli) recombinant protein']
  ];
  const FUNCTIONS = [
    ['cld', 'Cell line / strain development'],
    ['uspd', 'Upstream process development'],
    ['dspd', 'Downstream process development'],
    ['afs', 'Analytical & formulation sciences (AFS)'],
    ['msat', 'MSAT & technology transfer'],
    ['mfg', 'GMP manufacturing'],
    ['qc', 'Quality control'],
    ['pcc', 'Particle characterization core (PCC)'],
    ['micro', 'Microbiology & environmental monitoring'],
    ['fac', 'Facilities & engineering'],
    ['qa', 'Quality assurance & regulatory']
  ];

  /* Unit operations inside each function, with what machine learning is used for at that
     step. These are uses of the methods in general; what this page itself does with your
     data is whatever tool you have selected. */
  const UNITOPS = {
    mammalian: {
      pcc: [
        ['Subvisible counting (light obscuration)', 'Counts per container by size bin, charted as counts rather than measurements, with the shape tested before any tail figure or sigma level is quoted.'],
        ['Flow imaging and particle type classification', 'Proteinaceous against silicone oil against extrinsic, with analyst-to-analyst agreement on the type call measured rather than assumed consistent.'],
        ['Identification (FTIR, Raman, SEM-EDX)', 'Material classes entered as labels and trended by lot, line and campaign, so a recurring source is separated from a one-off finding.'],
        ['Size distribution across the bins', 'Counts per bin modelled against process and formulation conditions, so a shift in the distribution is attributed rather than described.'],
        ['Container closure and glass delamination', 'Lamellae and delamination counts against vial lot, depyrogenation and fill conditions, with the container as a named variance source.'],
        ['Aggregation on stability', 'Subvisible growth against time and condition, with the limit met at the confidence bound rather than at the fitted trend.'],
        ['Counting method qualification', 'Repeatability and reproducibility of the counter itself, judged against the specification window rather than against the samples that happened to be run.'],
        ['Counter and laboratory comparability', 'Light obscuration against flow imaging, or site against site, on a margin declared beforehand, with inconclusive available as a verdict.'],
      ],
      micro: [
        ['Environmental monitoring (viable)', 'Settle and active air counts charted as counts rather than measurements, with the clustering between rooms and shifts measured instead of assumed away.'],
        ['Non-viable particle counts', 'Cleanroom particle counts against a limit, with the tail figures computed on a scale where the shape holds rather than from a bell curve the data has not got.'],
        ['Bioburden and endotoxin', 'In-process bioburden against hold time and material, with limits set from the ranking of past results when the distribution will not support a factor.'],
        ['Media fill and aseptic process simulation', 'Contamination events as rare-event data, with the false alarm rate of whichever chart is used stated rather than left implicit.'],
        ['Plate reading and colony counting', 'Reader against reader on the same plates, with agreement beyond chance measured so a disputed count is settled on evidence.'],
        ['Rapid micro method qualification', 'A rapid method against compendial on the same samples, with the margin fixed first and an inconclusive result reported as inconclusive.'],
      ],
      fac: [
        ['Water systems (WFI, clean steam)', 'Conductivity, TOC and temperature trended with the chart rules that catch a slow drift while every reading is still inside its limit.'],
        ['HVAC and pressure cascade', 'Differential pressures and air changes against room classification, with a probe drifting out of step with the rest of the suite visible before it leaves range.'],
        ['Clean utilities and compressed gases', 'Dew point, oil and particle readings trended per outlet, with outlet-to-outlet differences separated from instrument noise.'],
        ['Equipment reliability and maintenance', 'Time between failures and downtime modelled against usage and service interval, so a maintenance interval is argued from data.'],
        ['Calibration and instrument drift', 'As-found against as-left readings across services, so an instrument drifting predictably is caught before it fails a calibration.'],
        ['Single-use and consumable supply', 'Lot-to-lot differences in assemblies and filters separated from process variation, so a supplier change is judged rather than suspected.'],
      ],
      cld: [
        ['Transfection and selection', 'Pool performance predicted from early growth and titer reads, so weak pools are cut before they take up incubator space.'],
        ['Single-cell cloning', 'Imaging and outgrowth features used to rank clones on survival probability, rather than on a day-14 titer alone.'],
        ['Clone screening (deep well, shake)', 'Small-scale reads modelled against later bioreactor performance, to learn which screens actually predict and which are noise.'],
        ['Clonal stability study', 'Titer and quality drift over generations fitted as a trend with confidence limits, so the generation limit has evidence behind it.'],
        ['Cell banking (MCB, WCB)', 'Post-thaw viability and recovery tracked across vials and runs, flagging cryopreservation or bank drift early.']
      ],
      uspd: [
        ['Vial thaw and seed train', 'Growth rate and doubling time through the train modelled against production-stage outcome, so a slow train is caught before inoculation.'],
        ['Scale-down model (shake flask, ambr)', 'Agreement between scale-down and at-scale tested formally rather than assumed, before the model carries a characterisation study.'],
        ['Production bioreactor (fed-batch, perfusion)', 'DO, pH, temperature, agitation and sparge ranked for their effect on titer and quality, with a design that breaks the correlations historical runs leave behind.'],
        ['Feed and supplement strategy', 'Feed timing, volume and composition searched against titer, glycans and lactate together, where those goals genuinely conflict.'],
        ['Harvest timing', 'Viability, aggregate and host cell protein at harvest modelled to choose a day downstream can actually process.']
      ],
      dspd: [
        ['Clarification and depth filtration', 'Throughput and filter loading predicted from harvest turbidity and debris, so the step is sized before it blinds mid-batch.'],
        ['Protein A capture', 'Load density, residence time and wash conditions against yield, host cell protein and aggregate clearance, with resin lifetime tracked across cycles.'],
        ['Low-pH viral inactivation', 'Hold time, pH and temperature against aggregate formation, to find the window that inactivates without damaging product.'],
        ['Polishing (AEX, CEX, HIC)', 'Load conductivity, pH and gradient slope tuned for the purity against yield trade-off, with pooling criteria set from data rather than habit.'],
        ['Viral filtration', 'Flux decay and throughput predicted from feed quality, to avoid a filter change in the middle of a batch.'],
        ['UF/DF and bulk formulation', 'Transmembrane pressure, concentration factor and diafiltration volumes against aggregation and final concentration accuracy.']
      ],
      afs: [
        ['Mass spec: intact and subunit mass', 'Measured masses against the sequence prediction, with the modification that accounts for a shift ranked rather than assigned by eye, across many lots at once.'],
        ['Mass spec: peptide mapping and modifications', 'Oxidation, deamidation and clipping sites tracked as percentages per lot, modelled against the process conditions and hold times that moved them.'],
        ['Mass spec: host cell protein', 'HCP identities and abundances across purification variants, so a wash or load change is judged on which proteins it actually cleared.'],
        ['Titer and cell counting', 'Assay variability partitioned across analyst, instrument and day, so method noise is not read as a process signal.'],
        ['Purity (SEC, CE-SDS)', 'Aggregate and fragment results trended against process conditions, with specification limits set from measured capability.'],
        ['Charge variants (iCIEF, IEX)', 'Acidic and basic species modelled against culture conditions and harvest timing.'],
        ['Glycan profiling (HILIC)', 'Glycoform distribution against feed, pH and temperature, where several glycan targets compete with each other.'],
        ['Potency bioassay', 'Plate and operator variation separated from true sample differences, and the method transferred with an equivalence test rather than a t-test.'],
        ['Formulation and stability screening', 'Excipient, pH and surfactant combinations ranked on degradation rate, then confirmed with a shelf-life fit.']
      ],
      msat: [
        ['Scale-down model qualification', 'Formal equivalence between scale-down and at-scale, with a margin set before the runs, instead of an eyeball comparison.'],
        ['Technology transfer runs', 'Receiving site compared with sending site against an agreed margin, so "comparable" means something specific.'],
        ['Process characterisation (PC)', 'Factorial and response-surface designs that separate critical parameters from noise, and give a filing the ranges it needs.'],
        ['PPQ and continued process verification', 'Capability and control charts across PPQ and commercial batches, watching several parameters together rather than thirty charts separately.'],
        ['Deviation and investigation support', 'Historical batch records mined for what the deviating batch had in common with others.']
      ],
      mfg: [
        ['Media and buffer preparation', 'Weighing, pH and conductivity records trended for prep-to-prep drift that surfaces later as a chromatography problem.'],
        ['Seed train and bioreactor operation', 'The live batch trajectory compared with the envelope of good batches, so drift is caught during the run and not in the deviation report.'],
        ['Harvest and chromatography skids', 'Step yields and pool attributes reconciled across the train, identifying the step that actually lost the material.'],
        ['TFF and filtration', 'Flux and pressure profiles compared with previous batches to anticipate a membrane or filter issue.'],
        ['Fill and finish', 'Fill weight capability, stopper and seal attributes, and line speed against reject rate.']
      ],
      qc: [
        ['Raw material and component release', 'Incoming lot attributes linked to downstream performance, to learn which specifications genuinely matter.'],
        ['In-process testing', 'Turnaround and variability trended, with out-of-trend results separated from ordinary assay scatter.'],
        ['Release testing', 'Capability against specification for every released attribute, reported as PPM and sigma level rather than a pass count.'],
        ['Stability programme', 'Trend fits with confidence limits per condition, poolability across batches, expiry maintained as data accrues.'],
        ['OOS and OOT investigations', 'Whether a result is a real shift or sits inside assay capability, decided with numbers rather than argument.']
      ],
      qa: [
        ['Batch record review', 'Records mined across batches for recurring patterns, ahead of the trend report rather than after it.'],
        ['Deviation and CAPA', 'Effectiveness evidenced with before-and-after capability, instead of an absence of repeats.'],
        ['Change control', 'Comparability and equivalence evidence assembled for the change, with the margin fixed before the data was seen.'],
        ['Annual product quality review', 'Capability, stability trends and control charts for the year built from the raw data, not from summaries of summaries.'],
        ['Data integrity and audit readiness', 'Every analysis exported with its input fingerprints, settings and the model that produced it.']
      ]
    },
    microbial: {
      pcc: [
        ['Subvisible counting (light obscuration)', 'Counts per container by size bin as counts, with the distribution tested rather than assumed before any tail figure is reported.'],
        ['Flow imaging and particle type classification', 'Aggregate against host cell debris against extrinsic, with agreement between analysts on the type call measured instead of presumed.'],
        ['Identification (FTIR, Raman, SEM-EDX)', 'Material classes entered as labels and trended by lot and campaign, separating a recurring source from an isolated finding.'],
        ['Refold and aggregate characterization', 'Aggregate and precipitate counts against refold conditions, concentration and hold time, so the trade against correctly folded yield is explicit.'],
        ['Host cell debris and lysis carryover', 'Particulate load against lysis and clarification settings, so a downstream particle finding is traced to the step that created it.'],
        ['Aggregation on stability', 'Subvisible growth against time and storage condition, with the limit met at the confidence bound rather than at the trend line.'],
        ['Counting method qualification', 'Repeatability and reproducibility of the counter, judged against the specification window rather than against a convenient sample set.'],
        ['Counter and laboratory comparability', 'One counting technique or laboratory against another on a declared margin, with an explicit inconclusive verdict when the study cannot settle it.'],
      ],
      micro: [
        ['Environmental monitoring (viable)', 'Air and surface counts charted as counts, with the clustering between rooms, shifts and campaigns measured rather than assumed to be absent.'],
        ['Non-viable particle counts', 'Room particle counts against a limit, with tail figures taken on a transformed scale rather than from a bell curve that counted data never has.'],
        ['Bioburden and endotoxin', 'Fermentation and downstream bioburden against hold times, with limits read off the ranking of past results where no distribution fits.'],
        ['Host strain purity and phage screening', 'Screening outcomes tracked as pass and fail rates with the detection rate of the method itself separated from the incidence.'],
        ['Plate reading and colony counting', 'Reader against reader on the same plates, so disagreement between technicians is measured instead of argued about.'],
        ['Rapid micro method qualification', 'A rapid method against compendial, judged on a declared margin, with the sample size needed for a verdict reported up front.'],
      ],
      fac: [
        ['Water systems (WFI, clean steam)', 'Conductivity, TOC and temperature trended with the rules that catch a drift while every individual reading is still within limit.'],
        ['HVAC and pressure cascade', 'Room pressures and air changes against classification, with one probe drifting out of step with its neighbours caught before it leaves range.'],
        ['Fermenter utilities and services', 'Chilled water, steam and compressed air readings trended per service, with service-to-service differences separated from sensor noise.'],
        ['Equipment reliability and maintenance', 'Failures and downtime against usage and service interval, so intervals are set from measured reliability rather than from the manual.'],
        ['Calibration and instrument drift', 'As-found against as-left across services, so predictable drift is caught before it becomes a failed calibration.'],
        ['Cleaning and changeover', 'Rinse and swab results against cleaning parameters and changeover time, with limits set from what the data supports.'],
      ],
      cld: [
        ['Construct and codon design', 'Codon usage matched to the host, restriction sites and repeats designed out, GC held inside the synthesis window.'],
        ['Expression screening', 'Small-scale expression reads modelled against fermenter performance, to learn which screens predict and which mislead.'],
        ['Plasmid and strain stability', 'Plasmid retention and expression over generations fitted as a trend, so the generation limit rests on data.'],
        ['Cell banking (WCB)', 'Post-thaw viability and lag time tracked across vials for bank-to-bank consistency.']
      ],
      uspd: [
        ['Inoculum and seed', 'Seed density and growth rate against fermentation outcome, so a weak inoculum is caught before the production vessel.'],
        ['Fed-batch fermentation', 'DO, pH, temperature, feed rate and agitation ranked for their effect on titer and soluble fraction, with a design that breaks historical correlation.'],
        ['Induction strategy', 'Induction density, inducer concentration and post-induction temperature against yield and inclusion-body quality.'],
        ['Scale-up parameters', 'Oxygen transfer, tip speed and mixing time compared between scales, with the scale-down model formally qualified.'],
        ['Biomass harvest', 'Centrifugation and resuspension conditions against cell integrity and how well the lysis step will then perform.']
      ],
      dspd: [
        ['Cell lysis (homogenisation)', 'Pressure and pass count against release and fines generation, which decides how hard clarification becomes.'],
        ['Inclusion body wash', 'Wash composition and cycle count against the purity entering refolding.'],
        ['Solubilisation and refolding', 'Redox ratio, pH, protein concentration and additives searched together against refold yield and aggregate, a space far too large to run exhaustively.'],
        ['Capture chromatography', 'Load and wash conditions against yield, host cell protein and endotoxin clearance.'],
        ['Polishing and endotoxin clearance', 'Conditions tuned for purity against yield, with endotoxin and host cell protein treated as competing objectives.'],
        ['UF/DF and bulk formulation', 'Concentration and buffer exchange against aggregation and final concentration accuracy.']
      ],
      afs: [
        ['Mass spec: intact mass and truncation', 'Measured mass against the predicted sequence, with N-terminal processing and truncation tracked per lot rather than described once at the end.'],
        ['Mass spec: peptide mapping and modifications', 'Oxidation and misincorporation quantified per site, modelled against induction temperature, duration and feed so a spike has a cause to test.'],
        ['Mass spec: host cell protein', 'E. coli HCP identities and abundances across refold and capture variants, so each change is judged on which contaminants it removed.'],
        ['Purity (RP-HPLC, CE-SDS)', 'Purity and related substances trended against fermentation and refold conditions.'],
        ['Aggregates (SEC)', 'High molecular weight species against refolding and concentration conditions, with method variability separated out first.'],
        ['Host cell protein ELISA', 'Clearance across the train, with assay variability distinguished from real carryover.'],
        ['Endotoxin (LAL)', 'Clearance modelled step by step, identifying which step actually limits it.'],
        ['Refolding yield assays', 'Yield reads linked back to redox and additive conditions, confirming whether the optimiser was right.'],
        ['Formulation and stability screening', 'Buffer, pH and excipient combinations ranked on degradation rate, then confirmed with a shelf-life fit.']
      ],
      msat: [
        ['Scale-down model qualification', 'Equivalence between bench fermenter and production scale, tested rather than assumed.'],
        ['Technology transfer runs', 'Receiving-site fermentations compared with the sending site against a margin agreed in advance.'],
        ['Process characterisation (PC)', 'Designs that separate critical fermentation and refold parameters from noise, with ranges a filing can use.'],
        ['PPQ and continued process verification', 'Capability and multivariate control across PPQ and commercial campaigns.'],
        ['Deviation and investigation support', 'Campaign records mined for what the failing run shared with others.']
      ],
      mfg: [
        ['Media preparation and sterilisation', 'Prep records and sterilisation cycles trended for the drift that later shows up as a slow fermentation.'],
        ['Fermentation operation', 'The live trajectory compared with the envelope of good campaigns, so drift is caught during the run.'],
        ['Harvest and homogenisation', 'Centrifuge and homogeniser performance against how filterable the stream then is.'],
        ['Refold and chromatography', 'Step yields reconciled across the train, identifying the limiting step rather than guessing at it.'],
        ['UF/DF and fill', 'Flux profiles and fill weight capability trended batch to batch.']
      ],
      qc: [
        ['Raw material and component release', 'Incoming lot attributes linked to fermentation and refold performance, to learn which specifications matter.'],
        ['In-process testing (density, bioburden, endotoxin)', 'Turnaround and variability trended, with out-of-trend results separated from assay scatter.'],
        ['Release testing', 'Capability against specification for every released attribute, as PPM and sigma level rather than a pass count.'],
        ['Stability programme', 'Trend fits with confidence limits per condition, poolability across batches, expiry maintained as data accrues.'],
        ['OOS and OOT investigations', 'Whether a result is a real shift or inside assay capability, decided with numbers.']
      ],
      qa: [
        ['Batch record review', 'Campaign records mined across batches for recurring patterns ahead of the trend report.'],
        ['Deviation and CAPA', 'Effectiveness evidenced with before-and-after capability rather than an absence of repeats.'],
        ['Change control', 'Comparability and equivalence evidence assembled for the change, with the margin fixed beforehand.'],
        ['Annual product quality review', 'Capability, stability trends and control charts for the year built from raw data.'],
        ['Data integrity and audit readiness', 'Every analysis exported with input fingerprints, settings and the model that produced it.']
      ]
    }
  };

  // What the selected technique specifically does for that function.
  const BYFUNCTION = {
    analyze: {
      pcc: 'The counts this group reports, charted as counts with their clustering measured, plus what moves particle load ranked with a noise floor and the designed study that separates it.',
      micro: 'Counts charted as counts with their clustering measured, and what moves bioburden or a monitoring excursion ranked with a noise floor beside it.',
      fac: 'Utility and equipment data turned into the few parameters that predict a failure or an excursion, with a drift caught by the rules a limits-only chart is blind to.',
      cld: 'Rank clones and strains on the screen reads that actually predict later performance, and design the confirmation study.',
      uspd: 'Find which bioreactor or fermenter parameters move titer and quality, then design the experiment that separates the ones history has confounded.',
      dspd: 'Model yield and purity against load, wash and elution conditions, and design the characterisation runs around the optimum.',
      afs: 'Partition assay variability across analyst, instrument and day, and model which process conditions move the attribute.',
      msat: 'Mine batch records for what distinguishes a good campaign, and produce the characterisation design a filing needs.',
      mfg: 'Turn historical batch data into the few parameters worth controlling, and the settings to run with.',
      qc: 'Separate assay noise from real process shifts, and show capability against specification rather than a pass count.',
      qa: 'Evidence for trend reports, CAPA effectiveness and annual reviews, drawn from raw data rather than from summaries.'
    },
    stability: {
      pcc: 'Subvisible growth against time and condition, which is how aggregation and delamination actually present, with the limit met at the confidence bound rather than at the trend line.',
      micro: 'Bioburden and endotoxin against hold time, giving a hold limit read off the confidence limit rather than taken from convention.',
      fac: 'Filter, membrane and consumable service life from measured performance decline, and water system recovery after sanitisation.',
      cld: 'Fit titer and quality drift over generations, to set a generation limit that can be defended.',
      uspd: 'Hold-time limits for harvest and intermediates, taken from measured degradation rather than convention.',
      dspd: 'Pool and intermediate hold times, resin and membrane life, from trends with confidence limits attached.',
      afs: 'The core use: expiry from the confidence limit, poolability across batches, formulations ranked on degradation rate.',
      msat: 'Shelf life maintained as commercial batches accrue, with extrapolation kept inside what the data supports.',
      mfg: 'In-process hold limits and material usable life, set from data and auditable afterwards.',
      qc: 'The stability programme itself: per-condition trend fits, poolability, expiry updated as the study matures.',
      qa: 'Shelf-life claims with the extrapolation limits documented and the poolability evidence on file.'
    },
    golden: {
      pcc: 'A filling or lyophilisation campaign scored against the runs you were happy with, naming the hour a drift began and the sensor furthest out of step.',
      micro: 'Monitoring across a campaign read as one trajectory, so a room drifting across several sensors at once is visible before any single one alarms.',
      fac: 'A utility loop or HVAC suite watched as a whole, so a probe falling out of step with its neighbours shows up while its own reading is still in range.',
      cld: 'Screening runs compared against the pattern good clones produced, so an odd one is spotted before it reaches the bioreactor.',
      uspd: 'The core use: every bioreactor or fermenter run scored against the path good batches took, with the sensor to blame named at the hour it drifts.',
      dspd: 'Chromatography and filtration profiles compared run to run, so a column or membrane degrading shows up before the pool fails its test.',
      afs: 'Instrument traces compared against normal, flagging the runs where the detector, column or sample handling behaved unlike any good sequence.',
      msat: 'At-scale batches scored against the scale-down envelope, and a receiving site against the sending site, on trajectories rather than endpoints.',
      mfg: 'A running batch watched against the envelope of good ones, with hours of warning instead of a deviation report after the fact.',
      qc: 'Analytical sequences and system suitability trends watched together, separating a real shift from ordinary instrument scatter.',
      qa: 'Campaign review with every batch triaged in one table, and an investigation that starts from the hour and the sensor rather than from the whole record.'
    },
    equivalence: {
      pcc: 'A core deliverable rather than an afterthought: one counting technique or laboratory against another on a margin fixed beforehand, with inconclusive reported as its own answer.',
      micro: 'A rapid micro method against compendial, or one incubator or reader against another, with the margin declared first.',
      fac: 'A replacement instrument, outlet or assembly against the qualified one, judged on a declared margin rather than on a passing glance.',
      cld: 'A new clone or strain shown comparable to the one it replaces, within a margin set in advance.',
      uspd: 'Scale-down model against at-scale, and a process change shown to have done no harm.',
      dspd: 'A second resin lot, an alternative membrane, or a re-sequenced train shown to match the qualified one.',
      afs: 'Method transfer to QC, instrument to instrument, analyst to analyst, with power behind it rather than a quiet t-test.',
      msat: 'The heart of tech transfer: receiving site against sending site, with the margin agreed before the runs.',
      mfg: 'A second suite, skid or line shown to match the qualified one before anything is released from it.',
      qc: 'Method bridging after a change, and whether an apparent shift is real or sits inside capability.',
      qa: 'Comparability evidence for change control, with the margin fixed before the data was seen.'
    },
    variance: {
      pcc: 'Two different methods for the two things this group produces: attribute agreement for the particle type call, which is a judgement, and Gage R&R for the counter, which is a measurement. Most groups run neither on the classification.',
      micro: 'Plate reader against plate reader on the same plates, with agreement beyond chance measured, plus incubator and media lot as variance sources.',
      fac: 'Probe-to-probe, outlet-to-outlet and technician-to-technician differences separated from the instrument noise underneath them.',
      cld: 'Split clone screening spread into real clone differences and plate or assay noise, so a top performer is not simply a lucky well.',
      uspd: 'Separate vessel, shift and media-lot effects from process variation, and size the replication a development study actually needs.',
      dspd: 'Separate resin lot, column position and operator effects from step-yield variation, so a column is retired on evidence rather than on age.',
      afs: 'The core use: assay precision partitioned across analyst, instrument and day, and Gage R&R run before a method is trusted to release product.',
      msat: 'Split site, scale and train differences from ordinary batch noise, and show which part of a scale-up gap is real.',
      mfg: 'Name how much of batch-to-batch spread is the equipment, the shift or the material, before a CAPA is written against the wrong one.',
      qc: 'Measurement system analysis on each instrument, and incoming lot variation tested against the method that measures it.',
      qa: 'Variation attributed to a named source in trend reports and investigations, with the measurement system qualified so capability is about product rather than assay.'
    },
    limits: {
      pcc: 'Alert and action levels for counts no bell curve fits, taken from the ranking of past results where the distribution will not support a factor, with the sample size that needs stated up front.',
      micro: 'Alert and action levels for counts that no bell curve fits, taken from the ranking of past results when the distribution will not support a factor.',
      fac: 'Utility and environmental limits the data supports, with the honest answer when no sample size could support the limit being asked for.',
      cld: 'Size a clone screen so the winner is a real winner, and set generation-limit criteria from the data rather than from convention.',
      uspd: 'Size characterisation and scale-down studies honestly, and set in-process action levels from measured capability.',
      dspd: 'Set pool and intermediate acceptance limits from what the train really delivers, and size the runs needed to defend them.',
      afs: 'Set specification and system-suitability limits with the coverage stated, and size method-transfer studies so they can actually conclude.',
      msat: 'Justify process performance qualification batch numbers, and set continued verification limits from the qualification data.',
      mfg: 'Alert and action levels that reflect real capability, and sampling plans defended on how much of production they cover.',
      qc: 'Release limits argued from capability rather than from history, and the number of replicates a result needs to be trusted.',
      qa: 'Specification limits with the statistical argument attached for filings and inspections, and study protocols with the sample size justified in advance.'
    },
    plasmid: {
      pcc: 'Not applicable to particulate work. It selects constructs from historical screening data, and is named here so the boundary is explicit rather than discovered.',
      micro: 'Not applicable to monitoring work. It selects constructs from historical screening data and has nothing to say about a count or an excursion.',
      fac: 'Not applicable to utilities or equipment. It is a construct-selection tool and is named here so the gap is explicit.',
      cld: 'The core use: rank candidate constructs on expected titer and specific productivity before any of them are built.',
      uspd: 'Carry a construct choice into process conditions, with seed density and expression mode on the same footing as the genetics.',
      dspd: 'Judge whether a construct change moves the feed stream enough to matter downstream before the train is re-developed.',
      afs: 'Predict the attribute a method will have to measure, and size the assay effort to the spread the model expects.',
      msat: 'Compare a proposed construct against the historical envelope before a transfer commits to it.',
      mfg: 'Check that a new vector sits inside the range the facility has actually run before it reaches the floor.',
      qc: 'Set expectations for incoming material from a new construct, with an interval rather than a single number.',
      qa: 'A prediction that records what it rested on: which runs, which substitutions, and how far outside the data it was.'
    },
    sequence: {
      pcc: 'Not applicable to particulate work. It optimizes coding sequences, and is listed only so the gap is stated rather than left for somebody to find.',
      micro: 'Not applicable to monitoring work, and listed so the boundary is stated rather than left for somebody to discover.',
      fac: 'Not applicable to facilities work. It optimizes coding sequences and is named here only so the gap is explicit.',
      cld: 'Codon-optimise the construct for the host while removing restriction sites and holding GC inside the synthesis window.',
      uspd: 'Search feed, pH and temperature combinations too numerous to run, returning the trade-off curve rather than a single setpoint.',
      dspd: 'Search refold and elution conditions where yield, aggregate and clearance pull against each other.',
      afs: 'Search excipient, pH and surfactant combinations under competing stability and viscosity targets.',
      msat: 'Search inside characterised ranges for settings that satisfy every quality attribute at once.',
      mfg: 'Sequence campaigns and suites under changeover and cleaning constraints.',
      qc: 'Schedule the analytical queue under instrument and analyst constraints.',
      qa: 'A search that is reproducible on demand: same seed, same inputs, same answer, which is what a reviewer asks for.'
    }
  };


  /* ---------- One playbook per function, in the order the work actually goes ----------

     The panels above answer "what is this technique used for". They do not answer the
     question somebody actually arrives with, which is "I run this group, what do I do first,
     what will it buy me, and where will it let me down". That needs three things the lists
     above deliberately leave out: an ORDER, because doing capability before qualifying the
     assay produces a confident number about the assay; the MEASURED cost of getting each
     step wrong, because a warning with a number attached gets acted on and a warning without
     one gets argued with; and the GAPS, named out loud, because a group that finds the third
     limitation by itself stops believing the first two.

     Every figure quoted below is measured by this repository's own test suite on data built
     so the right answer is known in advance, not taken from a textbook. Where the tool
     cannot do something, that is written down rather than softened. */
  const PLAYBOOKS = {
    cld: {
      headline: 'Rank clones on the screen reads that actually predict, and stop paying incubator rent on pools that were never going to make it.',
      first: { tool: 'variance', label: 'Variance components on the screening assay',
        why: 'A clone ranking is only as good as the assay that produced it. Split the spread across plate, day and analyst first: if repeat wells on the same clone scatter as widely as different clones do, the top of your ranking is the luck of the plate and no amount of modelling fixes it.' },
      steps: [
        { tool: 'analyze', label: 'Which early reads predict the late ones',
          does: 'Model day-14 titer and quality against the small-scale reads you take in week one, with importance ranked, error bars on the ranking, and a shuffled-target noise floor alongside so a read carrying no evidence is named as carrying none rather than appearing low on a list.',
          limit: 'A screen that was never varied cannot be assessed. If every pool got the same feed, the data cannot say what the feed does.' },
        { tool: 'analyze', label: 'Clone and strain identity as a real input',
          does: 'Forty-eight strains or a backbone catalogue are carried as how common each level is and how the result averaged for it, so every level is modelled as itself.',
          measured: 'Against collapsing to the twelve commonest levels: R² 0.70 against 0.49 over eight datasets of 200 runs across 40 strains. A fifth of the achievable fit was in the levels one-hot was throwing away.',
          limit: 'A level run only a handful of times gets an average that is mostly the overall average by design. The panel names those levels and states the weight, so a small difference between two rarely-run clones is not read as evidence.' },
        { tool: 'plasmid', label: 'Pick the construct for a programme not yet started',
          does: 'Every historical construct, the parts it was built from and the protein it was for, turned into a run sheet per incoming programme with a calibrated interval on each prediction.',
          measured: 'Wells go where they are worth most: measured over 4,000 simulated 48-well sheets from 36 candidates, the top 8 built 6 times each identifies the truly best vector 61.4% of the time against 36.4% for building all 36 once.',
          limit: 'If every historical run is the same molecule, it refuses to predict a different one rather than returning a confident number with a narrow band.' },
        { tool: 'stability', label: 'Generation limits from measured drift',
          does: 'Titer and quality against generation number, with the confidence limit deciding where the limit sits rather than convention.',
          limit: 'Needs enough generations sampled to see a trend; three points cannot distinguish drift from scatter.' }
      ],
      gaps: [
        'No imaging. Colony counts, confluence and morphology have to arrive as numbers in a column; the page reads tables, never pictures.',
        'No sequence-to-function prediction. The sequence optimizer works on codon usage, GC content and structure, and says nothing about whether a construct will express.',
        'Single-cell data is out of scope: this is built for one row per clone or per well, not per cell.'
      ]
    },
    uspd: {
      headline: 'Separate what the bioreactor is doing from what the assay is doing, then design the run that settles the rest.',
      first: { tool: 'variance', label: 'Gage R&R on the attribute you are chasing',
        why: 'Before attributing a 0.3 g/L difference to a feed strategy, find out what the assay does on the same sample twice. If the measurement owns a third of the spread, a third of every conclusion below is about the measurement. Fewer than five distinct categories and the method cannot support a control chart on individual runs at all.' },
      steps: [
        { tool: 'analyze', label: 'What moves titer and quality',
          does: 'A run log - parameters set, result obtained - becomes a ranked list of drivers with whiskers, a what-if desk with calibrated bands, and the DOE that resolves what history confounded.',
          measured: 'Variance inflation catches what a pairwise correlation cannot: on a worked case where one parameter is the sum of two others, the largest pairwise correlation is 0.696 - nothing trips a 0.9 threshold - while every inflation factor lands between 16 and 32.',
          limit: 'Observational run logs cannot separate parameters that always moved together. The tool names the confounding rather than resolving it.' },
        { tool: 'analyze', label: 'The screen that resolves it',
          does: 'A definitive screening design takes 3 to 14 factors in about twice their number of runs, with main effects orthogonal to every two-factor interaction and curvature estimable, so the screen can tell you the optimum is inside your range.',
          measured: 'Effects are judged after correcting for how many were tested: over 500 analyses of a 2⁴ design with no real effect in it at all, 23.2% handed back at least one significant term. Benjamini-Hochberg cuts that to 1.8% while still catching real effects every time.',
          limit: 'A screen tells you which factors matter, not the optimum. Expect a second, smaller design to find settings.' },
        { tool: 'golden', label: 'Watch a running batch against the ones that worked',
          does: 'Sensor traces across a campaign, scored against the path the good runs took, naming the hour a drift began and the sensor furthest out of step.',
          measured: 'Alarm limits are calibrated on reference batches held out of the model that scored them, so 99% means a batch the model had never seen.',
          limit: 'Needs several batches you were genuinely happy with. Three is the bare minimum and ten or more makes the envelope mean something.' },
        { tool: 'analyze', label: 'Close the loop and know when to stop',
          does: 'Each round of results stacks onto the last by column name, the model refits, and the projection says what another round would buy before you book the suite.',
          limit: 'The projection is fitted from your own data and clamped so it can never promise better than today’s measurement. It is a forecast, not a guarantee.' }
      ],
      gaps: [
        'No raw time-series modelling of a single batch: the multivariate chart compares batches to each other, it does not fit kinetics or forecast a trajectory forward.',
        'No mechanistic models. Nothing here knows Monod, oxygen transfer or metabolic flux; every relationship is learned from your rows.',
        'Soft sensors and real-time feedback are out of scope. This runs on a desk, on a file, after the batch.'
      ]
    },
    dspd: {
      headline: 'Two results pulling against each other is the normal case downstream, and the tool is built to trade them off explicitly rather than optimise one and hope.',
      first: { tool: 'variance', label: 'Variance components across resin lot, column and analyst',
        why: 'Purity moving between resin lots is the classic downstream question, and it has three candidate answers - the resin, the column history, the assay. Splitting the spread names which before anyone writes a resin complaint.' },
      steps: [
        { tool: 'analyze', label: 'Yield and purity against load, wash and elution',
          does: 'Both results modelled at once with a desirability trade-off: say what is acceptable for each, and the best compromise is found rather than argued about.',
          limit: 'A compromise is only as honest as the acceptability ranges you set, and those are a judgement the tool cannot make for you.' },
        { tool: 'analyze', label: 'Mixture designs for buffers and formulations',
          does: 'Components that are shares of one blend cannot move independently, so simplex lattice, simplex centroid and extreme-vertices designs handle them, fitted with a Scheffé blending model that correctly has no intercept.',
          limit: 'Where component limits mean a pure-component blend was never formulable, it says so rather than quoting an extrapolated coefficient as a prediction.' },
        { tool: 'stability', label: 'Resin lifetime and hold times',
          does: 'Step yield against cycle number, or an intermediate against hold hours, with shelf life read off where the confidence limit meets the limit you must hold.',
          measured: 'The guideline extrapolation cap is applied: at most twice the data in hand, never more than 12 months past it.',
          limit: 'Needs the degradation to be visible in the window you sampled.' },
        { tool: 'equivalence', label: 'A second resin lot or a new supplier',
          does: 'Two one-sided tests against a margin you fix beforehand, giving three answers rather than two. The third is the one people misreport: inconclusive, rather than "no significant difference, therefore the same", and for an inconclusive result it says how many runs per side would settle it.',
          limit: 'The margin is yours to justify. A margin chosen after seeing the data is not a test.' }
      ],
      gaps: [
        'No chromatogram analysis. Peak integration, tailing and resolution have to arrive as computed numbers; the page does not read traces.',
        'No mechanistic chromatography modelling: no isotherms, no breakthrough prediction, no column scale-up equations.',
        'Pooling criteria are modelled against the outcome you supply; the tool cannot see the fractions themselves.'
      ]
    },
    afs: {
      headline: 'This is where the tool is strongest, because almost every question an analytical and formulation group has is a question about distributions and limits.',
      first: { tool: 'variance', label: 'Gage R&R, then attribute agreement if the call is a judgement',
        why: 'Two different methods for two different things. A number read off an instrument goes through Gage R&R. A pass/fail judgement - a visual inspection, a plate read, a defect grade - has no variance to take, and goes through attribute agreement instead, which is the one most groups are missing.' },
      steps: [
        { tool: 'variance', label: 'Attribute agreement for judgement calls',
          does: 'Whether appraisers agree with themselves, with each other and with the truth, with kappa beside every agreement percentage and the miss rate reported separately from the false alarm rate.',
          measured: 'The reason kappa is there: with a 10% defect rate, an inspector who simply passes every unit scores 90% agreement and a kappa of exactly 0, with a 100% miss rate. The percentage alone reads as an excellent inspector.',
          limit: 'Build the study close to half defective, however unrepresentative that feels. A production-like set of a few percent defective cannot support a miss rate, because there is almost nothing to miss.' },
        { tool: 'limits', label: 'Specifications the data can actually defend',
          does: 'A tolerance interval covering a stated share of production with stated confidence, and run backwards, the study size needed before instrument time is booked.',
          measured: 'On ten results, covering 99% needs a factor of about 4.4, not 3 - which is why hand-set limits are routinely too tight. Normality is tested rather than assumed, because a specification is a claim about the tails.',
          limit: 'When the data cannot support your limit it says whether more results would fix it or whether no sample size ever could. The second answer saves the most time and is the least welcome.' },
        { tool: 'stability', label: 'Shelf life and formulation ranking',
          does: 'Degradation fitted per batch, the two poolability tests run, expiry read off where the one-sided confidence limit meets specification, and candidate formulations ranked on rate rather than on endpoint.',
          limit: 'Accelerated-to-real-time agreement is reported, not assumed. The tool will not extrapolate a 40 °C rate onto a 5 °C claim for you.' },
        { tool: 'equivalence', label: 'Method transfer and bridging',
          does: 'Development against receiving QC, instrument against instrument, two labs whose files share neither column names nor row order, matched as pairs when both carry a sample identifier.',
          limit: 'Paired or unpaired changes the answer; the tool asks which you have rather than guessing.' }
      ],
      gaps: [
        'No spectra, chromatograms or images. Everything arrives as computed numbers.',
        'No attribute agreement for more than eight possible calls: a judgement with dozens of categories is closer to a measurement and the method does not apply.',
        'A distribution-free bound exists now, but it needs 299 results for a one-sided 99% claim at 95% confidence against about ten for the normal factor, so for a typical method-validation dataset the honest answer is still that the claim cannot be supported.'
      ]
    },
    msat: {
      headline: 'Comparability is a claim about equivalence, not about significance, and the difference decides whether a transfer passes.',
      first: { tool: 'equivalence', label: 'Fix the margin before you look at the data',
        why: 'A transfer judged on "no significant difference" can pass on a study too small to see anything. Declaring the margin first turns it into a question the data can answer - and lets the inconclusive answer exist, which is where underpowered transfers actually sit.' },
      steps: [
        { tool: 'golden', label: 'Receiving site against sending site, trajectory by trajectory',
          does: 'The qualified line becomes the envelope; the new line is scored against it, with the hour and the sensor named when it strays.',
          limit: 'Compares shapes of runs, not causes. It tells you where they diverged, not why.' },
        { tool: 'analyze', label: 'What the scale or site change actually moved',
          does: 'Site and scale as inputs alongside the parameters, so a difference is attributed rather than assumed, with confounding named where the two moved together.',
          measured: 'The inflation factors are validated against the identity VIF = 1/(1 \u2212 r\u00b2) rather than against themselves: at a correlation of 0.95, theory says 10.26 and the tool measures 10.10.',
          limit: 'Two sites that differ in nine ways at once cannot be told apart by any amount of arithmetic - that is a study design problem and the tool says so. Exact collinearity is reported as inseparable rather than as a number in the billions, which is the honest output of the arithmetic and useless to everybody.' },
        { tool: 'limits', label: 'Size the comparability study before booking it',
          does: 'Power and sample size for equivalence, a two-group difference or one group against a target, with the curve and a table of what each study size buys. The calculations are exact and t-based rather than the normal approximation, which quietly overstates power at development sample sizes.',
          limit: 'Power depends on the spread you assume. Use a measured one, and the tool reports which it used.' },
        { tool: 'analyze', label: 'The characterisation design a filing needs',
          does: 'Full or fractional factorial, definitive screening, central composite or Box-Behnken, with the run sheet and a column to write results into.',
          limit: 'Design generation is not design justification: the risk assessment behind the factor list stays yours.' }
      ],
      gaps: [
        'No automated PPQ or stage-2 continued-verification report format.',
        'No multi-attribute comparability in one step. Sites are compared one attribute at a time, so a transfer covering a dozen quality attributes is a dozen separate runs with nothing joining them into a verdict. Requiring every attribute to pass also makes the combined claim far harder than any single one - twelve attributes each powered at 80% give about a 7% chance of all passing - and the per-attribute sample size does not account for that.',
        'Nothing here reads a batch record. Every input is a table somebody has already assembled.'
      ]
    },
    mfg: {
      headline: 'The chronic failure on the floor is a rate drifting while every single batch stays inside its limits, and that is specifically what the extra control-chart rules are for.',
      first: { tool: 'analyze', label: 'Six Sigma mode on the attribute that is hurting',
        why: 'Capability and a control chart on the same attribute, in one pass, with the normality question settled rather than skipped - because the figures people quote most, PPM and sigma level, are the ones that break when the shape is wrong.' },
      steps: [
        { tool: 'analyze', label: 'The full Nelson rule set, with its price stated',
          does: 'All eight rules, not the three a limits-only chart runs: a shifted or drifting process with every point inside the lines is exactly what rules two to eight exist to catch.',
          measured: 'On a 0.9 sigma shift the limits-only chart raises one signal and the full set raises twenty-five. The cost is measured too: the three-sigma rule alone raises a false alarm about once every 367 points, the full set about once every 50, so on a fifty-point chart expect roughly one false signal from a process with nothing wrong with it. The number is reported beside the signals and the rule set is a choice.',
          limit: 'Built for measurements. Counted data - rejects, particles, deviations - belongs on a count chart instead.' },
        { tool: 'analyze', label: 'Count charts for things you count',
          does: 'c, u and p charts, with dispersion measured rather than assumed and the limits widened when the counts are wider than a Poisson or binomial model allows.',
          measured: 'This matters more than the choice of chart: at a dispersion of 3 - ordinary when defects cluster by lot, line or shift - the textbook chart flags about one point in sixteen from a process behaving perfectly, roughly four false signals on a sixty-point chart. Widened for the clustering, that falls to about one in ninety. When the counts really are Poisson the widening comes out at about 1.05, so it costs nothing when it is not needed.',
          limit: 'Rare events are still badly served: at a tenth of a percent reject rate a proportion chart is mostly noise, and the chart that suits it - time or units between events - is not built yet.' },
        { tool: 'analyze', label: 'Capability that withholds what it cannot support',
          does: 'Cp and Cpk stand whatever the shape and are reported. PPM, Z.bench and sigma level are normal tail probabilities, so when the shape is not there they are recomputed on a Box-Cox transformed scale, and withheld outright if the transformed values still fail their normality test.',
          measured: 'On a right-skewed impurity whose limit sits at its true 99.9th percentile, so the real rate is 1,000 PPM by construction: at a skewness of 0.65 the normal figure reads 62 PPM, sixteen times under, and by a skewness of 1.8 it reads 0.',
          limit: 'A Box-Cox transform now recovers the tail figures where the shape can be fixed, but normality is re-tested on the transformed values and the figures stay withheld when it fails - and no power transform fixes a bimodal reading, which is what two lines or two shifts alternating looks like.' },
        { tool: 'analyze', label: 'What is worth controlling, from the batch record',
          does: 'Historical batches mined for the few parameters that move the result, with a what-if desk and an in-spec badge, so a control strategy is argued from data.',
          limit: 'Correlation from routine production is not a control-strategy justification on its own, and the tool designs the study that would be.' }
      ],
      gaps: [
        'No live connection to anything: no historian, no SCADA, no LIMS. Export a file and load it.',
        'No changepoint detection. A forecast here is fitted to the whole history, and nothing segments the series where it changed regime and refits from there, so a line modification or a raw-material change part way through the record is carried forward as if it were still in force. CUSUM will say a shift happened and roughly when; acting on that is still a human decision.',
        'Not a validated GxP system. Everything here is decision support with an audit trail attached.'
      ]
    },
    qc: {
      headline: 'The question underneath nearly every QC argument is whether the result moved or the method did, and that is answerable rather than arguable.',
      first: { tool: 'variance', label: 'Qualify the method before you trend its output',
        why: 'A trend report built on an unqualified assay reports the assay. Gage R&R for a measured result, attribute agreement for a pass/fail call, and the distinct-categories figure tells you whether individual results can carry a control chart at all - under five, and the chart shows the measurement moving, not the process.' },
      steps: [
        { tool: 'analyze', label: 'Assay noise against real process shifts',
          does: 'Six Sigma mode gives capability against specification and a control chart with the full rule set, so a drift is distinguished from scatter with the false-alarm rate stated.',
          limit: 'Rows must be in run order for the within-subgroup estimate to mean anything, and the tool asks rather than assuming.' },
        { tool: 'variance', label: 'Attribute agreement for inspection and plate reads',
          does: 'Appraiser against themselves, against each other and against a known standard, with kappa, bootstrapped intervals, and miss and false alarm rates kept separate.',
          measured: 'Percent agreement alone is the trap: at a 10% defect rate, passing everything scores 90% agreement, kappa 0 and a 100% miss rate.',
          limit: 'Without a known value it can only say whether people agree, not whether they are right. Two analysts trained the same wrong way agree perfectly.' },
        { tool: 'equivalence', label: 'Instrument against instrument, analyst against analyst',
          does: 'TOST with the margin fixed first, paired when the same samples were run twice, and an explicit inconclusive verdict.',
          limit: 'An inconclusive result is a real result. The tool reports how many more results would settle it rather than letting the study pass by default.' },
        { tool: 'limits', label: 'Specifications and study sizes',
          does: 'What the data supports as a limit, and how many results a planned study needs, with normality tested rather than assumed.',
          limit: 'A limit the data cannot support is sometimes unsupportable at any sample size, and that answer is given plainly.' }
      ],
      gaps: [
        'No instrument files. Chromatograms, spectra and plate images have to be reduced to numbers first.',
        'No OOS workflow, no trending database, no stability scheduling: this computes on a file, it does not manage a programme.',
        'The distribution-free bound needs 299 results for a one-sided 99% claim, so a skewed assay with thirty results still gets a refusal - now with the number of results that would change the answer attached to it.'
      ]
    },
    pcc: {
      headline: 'What this group produces is a classification and a count, so the first thing to qualify is the classification and the count - and they need two different methods, because one is a judgement and the other is a measurement.',
      first: { tool: 'variance', label: 'Qualify the type call and the counter separately',
        why: 'A particle type call - proteinaceous, silicone oil, fibre, glass - is a human judgement with no number in it, so there is no variance to take and Gage R&R does not apply; attribute agreement does. The counter is the opposite: a number from an instrument, where Gage R&R is exactly right and agreement means nothing. Running the wrong one of the two is the common failure, and running neither on the classification is more common still: every count and every identification this group issues rests on a judgement nobody has measured.' },
      steps: [
        { tool: 'variance', label: 'Attribute agreement on the particle type call',
          does: 'Analyst against themselves, analyst against analyst, and each one against a known standard, with Fleiss and Cohen kappa beside every agreement percentage and bootstrapped intervals over samples.',
          measured: 'Why the percentage alone will not do: on a binary call with a 10% positive rate, an analyst who calls everything negative scores 90% agreement, a kappa of exactly 0 and a 100% miss rate. On a four-way type call with three analysts disagreeing 15% of the time, the between-analyst kappa measures 0.69, which these bands call inadequate, while each analyst\u2019s own agreement with the standard on that same study reads between 84 and 90%.',
          limit: 'The miss and false alarm rates are binary only. For a four-way type call you get kappa, agreement and the per-analyst comparison against the standard, but not those two rates, because with four categories there is no single thing being missed.' },
        { tool: 'variance', label: 'Gage R&R on the counter',
          does: 'Repeatability, reproducibility and real container-to-container differences from a crossed study, judged against your specification window rather than against whichever containers happened to be run.',
          limit: 'Under five distinct categories the counter cannot support a control chart on individual results: the chart would show the method moving, not the product. That is reported rather than left to be discovered on a trend report.' },
        { tool: 'equivalence', label: 'Counter against counter, laboratory against laboratory',
          does: 'Light obscuration against flow imaging, or site against site, by two one-sided tests on a margin declared beforehand, paired when the same containers went through both. Three answers rather than two, and the third is the one these studies usually deserve: inconclusive, rather than "no significant difference, therefore comparable" - with the number of containers per method that would settle it.',
          limit: 'The margin is yours to justify, and a margin chosen after seeing the data is not a test. Recovery and detection limits are method validation questions this does not answer.' },
        { tool: 'analyze', label: 'The counts, charted as counts',
          does: 'Counts per container or per lot with dispersion measured rather than assumed, and the limits widened when particles cluster by vial lot, line or shift - which they almost always do.',
          measured: 'At a dispersion of 3, ordinary for particle counts, the textbook chart flags one point in sixteen from a process behaving perfectly, about four false signals on a sixty-point chart, against one in ninety-four once widened. On genuinely Poisson counts the widening is x1.05, so it costs nothing when it is not needed.',
          limit: 'Rare events remain badly served. At a finding rate in the tenths of a percent a proportion chart is mostly noise, and the chart that suits it - containers or days between findings - is not built yet.' },
        { tool: 'analyze', label: 'Capability without pretending the shape is normal',
          does: 'Counts are bounded at zero with a long right tail, so Cp and Cpk are reported as the shape-free ratios they are, and the tail figures are recomputed on a Box-Cox transformed scale with normality re-tested on the transformed values.',
          measured: 'On a right-skewed count whose limit sits at its true 99.9th percentile, so the real rate is 1,000 PPM by construction, the straight normal fit reports 0 PPM - no risk at all - and the transformed fit about 1,300.',
          limit: 'No power transform fixes a bimodal distribution, which is what two lines or two vial lots alternating looks like. There the honest output stays Cp, Cpk and the observed count out of spec.' },
        { tool: 'limits', label: 'Alert and action levels that assume no distribution',
          does: 'A bound taken from the ranking of past results alone, which holds whatever the shape, reported beside the normal-theory factor so the trade is visible rather than settled by whichever test happened to pass.',
          measured: 'The cost is sample size and it is steep: a one-sided 99% claim at 95% confidence needs 299 results from the ranking alone against about ten for the normal factor, and thirty results reach only 26% confidence.',
          limit: 'Below the required count it refuses and states what the data actually reaches, with the number of results that would change the answer, rather than issuing a limit nobody can defend.' },
        { tool: 'analyze', label: 'Supporting an investigation: what moved the load',
          does: 'Vial lot, stopper lot, siliconisation, line speed, filter lot and hold time ranked with error bars and a shuffled-target noise floor, then the design that separates the ones history confounded.',
          measured: 'Effects are judged after correcting for how many were tested: over 500 analyses of a design with no real effect in it at all, 23.2% handed back at least one significant term, and the correction cuts that to 1.8% while still catching real effects every time.',
          limit: 'An investigation log cannot separate parameters that always moved together; the tool names the confounding rather than resolving it, and resolving it is what the design is for.' }
      ],
      gaps: [
        'No image or spectrum reading, which for this group is the biggest limitation: FTIR, Raman, SEM-EDX and flow imaging outputs have to arrive as labels and numbers in columns, because the page reads tables and nothing else.',
        'No automated particle type classification. The type call stays a human judgement; what the tool does is measure how consistent and how correct that judgement is.',
        'No USP two-tier decision logic: it will not tell you which tier a result falls in, whether it is an excursion, or whether it is reportable.',
        'No size distribution fitted across the bins - counts per bin are handled as counts, with nothing modelled over the bin structure itself.'
      ]
    },
    micro: {
      headline: 'Monitoring data is counted, rare and judged by eye, which breaks all three of the usual defaults: the measurement chart, the bell curve, and percent agreement.',
      first: { tool: 'analyze', label: 'Put counts on a count chart, with the clustering measured',
        why: 'An environmental monitoring series on a measurement chart gets the limits wrong, because a count’s spread is not free - a Poisson count’s standard deviation is the square root of its own mean. Worse, monitoring counts cluster by room, shift and campaign, so they are wider than even a Poisson chart allows, and a chart that ignores that fires constantly at a facility behaving normally. Measure the clustering first and the rest of the programme stops chasing its own false alarms.' },
      steps: [
        { tool: 'analyze', label: 'Count charts that account for clustering',
          does: 'c, u and p charts with dispersion measured rather than assumed, and the limits widened when the counts are wider than a Poisson or binomial model allows.',
          measured: 'Measured over 400 charts of 60 points at a mean of 16: at a dispersion of 3, which is ordinary for counts that cluster, the textbook chart flags one point in sixteen from a process behaving perfectly - about four false signals per chart - against one in ninety-four once widened. On genuinely Poisson counts the widening comes out at ×1.05, so it costs nothing when it is not needed.',
          limit: 'Rare events are still badly served. At a contamination rate of a tenth of a percent a proportion chart is mostly noise, and the chart that suits it - units or days between events - is not built yet.' },
        { tool: 'variance', label: 'Attribute agreement on plate reading',
          does: 'Reader against themselves, reader against reader, and each reader against a known standard, with kappa beside every agreement percentage and miss and false alarm rates reported separately.',
          measured: 'Why the percentage alone will not do: at a 10% positive rate, a reader who calls everything negative scores 90% agreement, a kappa of exactly 0, and a 100% miss rate. The percentage reads as an excellent reader.',
          limit: 'Build the qualification set close to half positive, however unrepresentative that feels. A set matching real monitoring rates cannot measure a miss rate, because there is almost nothing to miss.' },
        { tool: 'limits', label: 'Alert and action levels with no distribution assumed',
          does: 'Where counts fit no bell curve, a bound taken from the ranking of past results alone, which holds whatever the shape, plus the normal-theory factor beside it so the trade is visible.',
          measured: 'What it costs is sample size, and the cost is steep: a one-sided 99% claim at 95% confidence needs 299 results from the ranking alone, against about ten for the normal factor. The tool reports both the bound and the number of results needed, rather than picking for you.',
          limit: 'Below the required count it refuses rather than producing a number, and states the confidence the data actually reaches - 30 results reach 26%, not 95%.' },
        { tool: 'equivalence', label: 'A rapid method against compendial',
          does: 'Two one-sided tests on a declared margin, paired when the same samples went through both, with inconclusive as its own verdict and the sample size that would settle it.',
          limit: 'Recovery and detection limits are method validation questions this does not answer; it compares results you already have.' }
      ],
      gaps: [
        'No identification or genotyping: an isolate identity has to arrive as a label in a column.',
        'No compendial decision logic. It will not tell you whether a result is an excursion, an action-level breach or reportable.',
        'No image reading, so colony counts must be entered as numbers rather than read from a plate photograph.'
      ]
    },
    fac: {
      headline: 'Utility and equipment failures almost never announce themselves with a reading outside its limit; they announce themselves as a drift, or as one probe disagreeing with its neighbours.',
      first: { tool: 'analyze', label: 'Run the full Nelson rule set on the utility trend',
        why: 'A limits-only chart is blind to the thing that actually happens to a water system or an HVAC suite: a slow shift where every individual reading stays comfortably inside its limit. Rules two to eight exist for exactly that, and the difference is not marginal - on a 0.9 sigma shift the limits-only chart raises one signal and the full set raises twenty-five. Turn them on before building anything more elaborate.' },
      steps: [
        { tool: 'analyze', label: 'The drift rules, with their price stated',
          does: 'All eight rules with zones, selectable, and the false alarm rate reported beside the signals so the sensitivity is a decision rather than a surprise.',
          measured: 'The three-sigma rule alone raises a false alarm about once every 367 points; the full set about once every 50. On a fifty-point chart that is roughly one false signal from a system with nothing wrong with it, which is worth knowing before an engineer is sent to investigate it.',
          limit: 'Built for measurements. Cleanroom particle counts and failure counts belong on a count chart instead.' },
        { tool: 'analyze', label: 'Capability on readings that are not bell-shaped',
          does: 'Cleanroom particle counts and TOC are bounded at zero with a long tail, so Cp and Cpk are reported as the shape-free ratios they are, and the tail figures come from a Box-Cox transformed scale with normality re-tested on the transformed values.',
          measured: 'On a right-skewed reading whose limit sits at its true 99.9th percentile, so the real rate is 1,000 PPM by construction, the straight normal fit reports 0 PPM - no risk at all - while the transformed fit reports about 1,300. A transform that still fails its re-test leaves the figures withheld rather than reported.',
          limit: 'No power transform fixes a bimodal reading, which is what two pumps or two shifts alternating looks like. There the honest output stays Cp, Cpk and the observed count.' },
        { tool: 'golden', label: 'One probe out of step with the suite',
          does: 'A utility loop or HVAC suite scored as a whole, so the case where sensors stop agreeing with each other shows up while every individual reading is still in range.',
          measured: 'Alarm limits are calibrated on reference periods held out of the model that scored them, so 99% means a period the model had never seen.',
          limit: 'Needs several periods you were genuinely happy with, nominated by somebody who knows. Three is the minimum and ten or more makes the envelope mean something.' },
        { tool: 'variance', label: 'Probe, outlet and technician as named sources',
          does: 'The spread split across probe, outlet, shift and technician, with Tukey naming which pairs genuinely differ rather than which look different.',
          limit: 'Needs repeat readings per source. One reading per outlet cannot separate outlet differences from the instrument underneath them.' }
      ],
      gaps: [
        'No connection to a historian, BMS or SCADA. Export a file and load it; nothing here reads a live tag.',
        'No reliability distributions: no Weibull fitting, no hazard rate, no survival model, so MTBF work is limited to trends and comparisons.',
        'No qualification or commissioning logic: it will not tell you whether a system is in a qualified state.'
      ]
    },
    qa: {
      headline: 'The tool cannot write your document, and will not pretend to: what it does is produce the numbers a document needs, with the fingerprints a reviewer will ask for.',
      first: { tool: 'analyze', label: 'Run it once with the audit package exported',
        why: 'Every analysis exports with each input file’s SHA-256 fingerprint, size and shape, the join, the target, the settings, every column set aside and why, the leakage check, the validation scheme, the models compared, the selection rule and the seed. That package is what makes a number in a report traceable, and it is produced in the same click as the number.' },
      steps: [
        { tool: 'analyze', label: 'Deviation investigation support',
          does: 'The deviating batches against the population, which recorded parameters distinguish them, and a control chart dating the onset rather than the discovery. A shuffled-target noise floor runs alongside, so a parameter with nothing behind it is reported as having nothing behind it instead of appearing low on a ranked list and reading as a weak lead.',
          limit: 'It cannot establish cause from routine production data, and says so. What it produces is a ranked, evidenced starting point and the design that would settle it.' },
        { tool: 'golden', label: 'Date the onset, name the sensor',
          does: 'The hour a batch left the path good batches took, the sensors that moved together, and whether that pattern ever appeared in a batch you released.',
          limit: 'Needs the reference batches nominated by somebody who knows which runs were good. The tool cannot decide that for you.' },
        { tool: 'analyze', label: 'CAPA effectiveness, honestly measured',
          does: 'Before and after as an equivalence or difference question with the margin fixed first, and the control chart showing whether the rate actually moved or the chart is just newer.',
          measured: 'The multiplicity correction matters here: test enough attributes after a change and something looks significant. Over 500 analyses of a design with no real effect in it, 23.2% produced at least one false finding; the correction cuts that to 1.8%.',
          limit: 'Effectiveness checks need enough post-change data to see the effect you claimed. The tool will say the study is too small rather than passing it.' },
        { tool: 'analyze', label: 'Annual product quality review material',
          does: 'Capability, stability trends and control charts for the year, built from raw data rather than from last year’s summary, exported as a workbook where numbers stay numbers.',
          limit: 'Formatting and narrative are yours. There is no language model here, by deliberate choice.' }
      ],
      gaps: [
        'It does not write documents. No deviation report, no CAPA narrative, no technical development report: there is no language model on this page and a tool that claimed otherwise would be found out at the worst possible moment.',
        'No CAPA or deviation tracking workflow, no electronic signatures, no record management.',
        'Not a validated GxP system, and the audit trail says so in its own footer.',
        'No regulatory decision logic: it will not tell you whether something is reportable.'
      ]
    }
  };

  root.MLApplications = APPLICATIONS;
  root.MLApplications.MODALITIES = MODALITIES;
  root.MLApplications.FUNCTIONS = FUNCTIONS;
  root.MLApplications.UNITOPS = UNITOPS;
  root.MLApplications.BYFUNCTION = BYFUNCTION;
  root.MLApplications.PLAYBOOKS = PLAYBOOKS;

  if (typeof module !== 'undefined' && module.exports) module.exports = APPLICATIONS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
