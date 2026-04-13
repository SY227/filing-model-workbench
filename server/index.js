import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';
import {
  buildModelPack,
  DEFAULT_BASELINE,
  normalizeBaseline,
  normalizeScenarioAdjustments,
  YEAR_LABELS,
} from './modeling.js';
import { buildSourcePacketForPrompt, ingestSource, normalizeFilingRequest, summarizeSource } from './sourceNormalization.js';
import {
  buildFilingAnalysisPrompt,
  buildFilingExtractionPrompt,
  buildReportFormattingPrompt,
} from './promptSchemas.js';
import {
  applySchemaDefaults,
  FILING_ANALYSIS_SCHEMA,
  FILING_EXTRACTION_SCHEMA,
  REPORT_PACK_SCHEMA,
  DRAFTED_BASELINE_META_SCHEMA,
} from './schemas.js';
import {
  buildPromptPacket,
  buildSafeReviewSummary,
  evaluateBaselineReadiness,
  extractDeterministicFilingData,
} from './deterministicExtraction.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distPath = path.join(projectRoot, 'dist');

export const app = express();
const port = Number(process.env.PORT || 8787);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 45000);

const HARD_BASELINE_FIELDS = [
  'currentRevenue',
  'shareCount',
  'cash',
  'debt',
  'netDebt',
  'grossMarginStart',
  'operatingMarginStart',
  'taxRate',
  'capexPct',
  'daPct',
];

app.use(cors());
app.use(express.json({ limit: '6mb' }));

app.get(['/api/health', '/health'], (_req, res) => {
  res.json({
    ok: true,
    model: GEMINI_MODEL,
    configured: Boolean(GEMINI_API_KEY),
  });
});

app.post(['/api/review-filing', '/review-filing'], async (req, res) => {
  try {
    ensureApiKey();
    const filingRequest = getFilingRequest(req.body);
    const analysis = await analyzeFilingRequest({ filingRequest });

    res.json(buildReviewPacket(analysis));
  } catch (error) {
    res.status(400).json({
      message: error.message || 'Could not review the filing.',
    });
  }
});

app.post(['/api/process', '/process'], async (req, res) => {
  setupSseHeaders(res);
  const send = (event, payload) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const startedAt = Date.now();
  const stageTimings = [];
  let currentStageStart = startedAt;

  const markStage = (key, label, note) => {
    const now = Date.now();
    if (stageTimings.length > 0) {
      stageTimings[stageTimings.length - 1].durationMs = now - currentStageStart;
      currentStageStart = now;
    }
    stageTimings.push({ key, label, note, startedAt: now, durationMs: 0 });
    send('stage', { key, label, note });
  };

  try {
    ensureApiKey();
    const filingRequest = getFilingRequest(req.body);

    const analysis = await analyzeFilingRequest({
      filingRequest,
      markStage,
    });

    let modelPack = null;
    let reportPack = null;

    if (analysis.analysisStatus.canRunModel) {
      markStage('forecast', 'Running deterministic model math', 'Running deterministic forecast and valuation math from the validated baseline.');
      modelPack = buildModelPack({
        baseline: normalizeBaseline(analysis.draftedBaseline),
        scenarioAdjustments: {
          base: normalizeScenarioAdjustments(analysis.filingAnalysis?.scenarioAdjustments?.base),
          upside: normalizeScenarioAdjustments(analysis.filingAnalysis?.scenarioAdjustments?.upside),
          downside: normalizeScenarioAdjustments(analysis.filingAnalysis?.scenarioAdjustments?.downside),
        },
      });

      markStage('pack', 'Preparing analysis pack', 'Formatting the final report shell, scenario commentary, and valuation framing.');
      reportPack = applySchemaDefaults(
        await callGeminiJson(
          buildReportFormattingPrompt({
            filingExtraction: analysis.filingExtraction,
            filingAnalysis: {
              ...analysis.filingAnalysis,
              draftedBaseline: analysis.draftedBaseline,
              draftedBaselineMeta: analysis.draftedBaselineMeta,
            },
            modelSummary: buildModelSummaryForPrompt(modelPack),
            analysisStatus: analysis.analysisStatus,
          }),
          0.2
        ),
        REPORT_PACK_SCHEMA
      );
    } else {
      markStage('forecast', 'Running deterministic model math', 'Baseline validation failed, suppressing valuation output until review issues are resolved.');
      markStage('pack', 'Preparing analysis pack', 'Preparing a review-required output instead of a valuation pack.');
      reportPack = buildSafeReviewSummary({
        filingMetadata: mergeFilingMetadata(analysis.filingExtraction?.filingMetadata, analysis.filingSource.fallbackMetadata),
        analysisStatus: analysis.analysisStatus,
      });
    }

    stageTimings[stageTimings.length - 1].durationMs = Date.now() - currentStageStart;

    send('result', buildResult({
      ...analysis,
      reportPack,
      modelPack,
      stageTimings,
      model: GEMINI_MODEL,
    }));
    send('done', { ok: true, totalDurationMs: Date.now() - startedAt });
  } catch (error) {
    send('error', {
      message: error.message || 'Something went wrong while generating the filing analysis pack.',
    });
  } finally {
    res.end();
  }
});

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

if (isDirectExecution()) {
  app.listen(port, () => {
    console.log(`Filing Model Workbench server listening on http://localhost:${port}`);
  });
}

export default app;

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

function ensureApiKey() {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    throw new Error('Missing GEMINI_API_KEY. Add it to your .env before generating a filing analysis pack.');
  }
}

function getFilingRequest(body) {
  const filingRequest = normalizeFilingRequest(body?.filingRequest || body?.filing);
  if (!filingRequest) throw new Error('A filing request is required.');
  return filingRequest;
}

async function analyzeFilingRequest({ filingRequest, markStage }) {
  markStage?.('ingest', 'Ingesting filing', 'Fetching or normalizing the 10-Q or 10-K text.');
  const filingSource = await ingestSource(
    { ...filingRequest, kind: 'filing', label: 'Filing' },
    { required: true, minChars: 700 }
  );

  const deterministicExtraction = await extractDeterministicFilingData(filingSource);
  logFilingSelection(deterministicExtraction?.diagnostics?.filingSelection);
  logDeterministicExtraction(deterministicExtraction);

  markStage?.('extract', 'Extracting filing facts', 'Combining deterministic SEC extraction with filing-aware AI summarization.');
  const filingExtractionAi = applySchemaDefaults(
    await callGeminiJson(
      buildFilingExtractionPrompt({
        filing: buildSourcePacketForPrompt(filingSource, 24_000),
        deterministicPacket: buildPromptPacket(deterministicExtraction),
      }),
      0.1,
      { timeoutMs: GEMINI_TIMEOUT_MS, label: 'filing extraction' }
    ),
    FILING_EXTRACTION_SCHEMA
  );

  const filingExtraction = mergeFilingExtraction({
    filingExtractionAi,
    deterministicExtraction,
    filingSource,
  });

  markStage?.('frame', 'Drafting baseline and model implications', 'Drafting soft assumptions and commentary around a deterministic-first baseline.');
  const filingAnalysis = applySchemaDefaults(
    await callGeminiJson(
      buildFilingAnalysisPrompt({
        filingExtraction: buildFilingAnalysisInput(filingExtraction),
        deterministicPacket: buildPromptPacket(deterministicExtraction),
      }),
      0.18,
      { timeoutMs: GEMINI_TIMEOUT_MS, label: 'filing analysis' }
    ),
    FILING_ANALYSIS_SCHEMA
  );

  const draftedBaseline = buildDraftedBaseline({ filingExtraction, deterministicExtraction, filingAnalysis });
  const draftedBaselineMeta = buildDraftedBaselineMeta({
    aiMeta: filingAnalysis?.draftedBaselineMeta,
    filingExtraction,
    deterministicExtraction,
    draftedBaseline,
    filingAnalysis,
  });
  const analysisStatus = evaluateBaselineReadiness({
    draftedBaseline,
    draftedBaselineMeta,
    normalizedMetrics: filingExtraction?.reportedBase?.normalizedMetrics,
    fieldSources: deterministicExtraction?.fieldSources,
    filingMetadata: mergeFilingMetadata(filingExtraction?.filingMetadata, filingSource.fallbackMetadata),
  });

  logBaselineDecision({ draftedBaseline, draftedBaselineMeta, analysisStatus, deterministicExtraction });

  return {
    filingSource,
    deterministicExtraction,
    filingExtraction,
    filingAnalysis,
    draftedBaseline,
    draftedBaselineMeta,
    analysisStatus,
  };
}

function mergeFilingExtraction({ filingExtractionAi, deterministicExtraction, filingSource }) {
  const deterministicMetrics = deterministicExtraction?.normalizedMetrics || {};
  const aiMetrics = filingExtractionAi?.reportedBase?.normalizedMetrics || {};
  const mergedMetadata = mergeFilingMetadata(
    filingExtractionAi?.filingMetadata,
    deterministicExtraction?.filingMetadata || filingSource?.fallbackMetadata
  );

  const normalizedMetrics = {
    revenueLtm: chooseDeterministic(aiMetrics.revenueLtm, deterministicMetrics.revenueLtm),
    revenueHistoricalGrowthPct: chooseDeterministic(aiMetrics.revenueHistoricalGrowthPct, deterministicMetrics.revenueHistoricalGrowthPct),
    revenueComparableGrowthPct: chooseDeterministic(aiMetrics.revenueComparableGrowthPct, deterministicMetrics.revenueComparableGrowthPct),
    revenuePriorAnnualGrowthPct: chooseDeterministic(aiMetrics.revenuePriorAnnualGrowthPct, deterministicMetrics.revenuePriorAnnualGrowthPct),
    grossMarginPct: chooseDeterministic(aiMetrics.grossMarginPct, deterministicMetrics.grossMarginPct),
    operatingMarginPct: chooseDeterministic(aiMetrics.operatingMarginPct, deterministicMetrics.operatingMarginPct),
    taxRatePct: chooseDeterministic(aiMetrics.taxRatePct, deterministicMetrics.taxRatePct),
    capexPctRevenue: chooseDeterministic(aiMetrics.capexPctRevenue, deterministicMetrics.capexPctRevenue),
    daPctRevenue: chooseDeterministic(aiMetrics.daPctRevenue, deterministicMetrics.daPctRevenue),
    operatingWorkingCapital: chooseDeterministic(aiMetrics.operatingWorkingCapital, deterministicMetrics.operatingWorkingCapital),
    operatingWorkingCapitalPct: chooseDeterministic(aiMetrics.operatingWorkingCapitalPct, deterministicMetrics.operatingWorkingCapitalPct),
    accountsReceivable: chooseDeterministic(aiMetrics.accountsReceivable, deterministicMetrics.accountsReceivable),
    accountsReceivablePctRevenue: chooseDeterministic(aiMetrics.accountsReceivablePctRevenue, deterministicMetrics.accountsReceivablePctRevenue),
    inventory: chooseDeterministic(aiMetrics.inventory, deterministicMetrics.inventory),
    inventoryPctRevenue: chooseDeterministic(aiMetrics.inventoryPctRevenue, deterministicMetrics.inventoryPctRevenue),
    accountsPayable: chooseDeterministic(aiMetrics.accountsPayable, deterministicMetrics.accountsPayable),
    accountsPayablePctRevenue: chooseDeterministic(aiMetrics.accountsPayablePctRevenue, deterministicMetrics.accountsPayablePctRevenue),
    deferredRevenue: chooseDeterministic(aiMetrics.deferredRevenue, deterministicMetrics.deferredRevenue),
    deferredRevenuePctRevenue: chooseDeterministic(aiMetrics.deferredRevenuePctRevenue, deterministicMetrics.deferredRevenuePctRevenue),
    shareCount: chooseDeterministic(aiMetrics.shareCount, deterministicMetrics.shareCount),
    cash: chooseDeterministic(aiMetrics.cash, deterministicMetrics.cash),
    debt: chooseDeterministic(aiMetrics.debt, deterministicMetrics.debt),
    netDebt: chooseDeterministic(aiMetrics.netDebt, deterministicMetrics.netDebt),
    liquidity: chooseDeterministic(aiMetrics.liquidity, deterministicMetrics.liquidity),
  };

  return {
    ...filingExtractionAi,
    filingMetadata: mergedMetadata,
    businessOverview: filingExtractionAi?.businessOverview || { summary: '', businessLines: [], segmentNotes: [], geographyNotes: [] },
    reportedBase: {
      summary: filingExtractionAi?.reportedBase?.summary || buildReportedBaseSummary(mergedMetadata, normalizedMetrics),
      normalizedMetrics,
      reportedFacts: dedupeByKey([
        ...(deterministicExtraction?.reportedFacts || []),
        ...(filingExtractionAi?.reportedBase?.reportedFacts || []),
      ], (item) => `${item.metric}|${item.valueText}|${item.evidence}`),
    },
    derivedMetrics: dedupeByKey([
      ...(deterministicExtraction?.derivedMetrics || []),
      ...(filingExtractionAi?.derivedMetrics || []),
    ], (item) => `${item.metric}|${item.value}|${item.logic}`),
    keyTakeaways: filingExtractionAi?.keyTakeaways || [],
    modelDrivers: filingExtractionAi?.modelDrivers || [],
    guidanceReferences: filingExtractionAi?.guidanceReferences || [],
    risksAndWatchItems: filingExtractionAi?.risksAndWatchItems || [],
    confidenceMap: {
      ...(filingExtractionAi?.confidenceMap || {}),
      deterministic: deterministicExtraction?.confidenceMap || {},
    },
    evidenceMap: {
      ...(filingExtractionAi?.evidenceMap || {}),
      deterministic: deterministicExtraction?.evidenceMap || {},
    },
    reviewFlags: dedupeByKey([
      ...(deterministicExtraction?.reviewFlags || []),
      ...(filingExtractionAi?.reviewFlags || []),
    ], normalizeReviewFlagKey),
    missingBaseInputs: dedupeByKey([
      ...(deterministicExtraction?.missingBaseInputs || []),
      ...(filingExtractionAi?.missingBaseInputs || []),
    ], (item) => item.field),
    deterministicExtraction: {
      filingSelection: deterministicExtraction?.filingSelection,
      normalizedMetrics: deterministicMetrics,
      fieldSources: deterministicExtraction?.fieldSources || {},
      diagnostics: deterministicExtraction?.diagnostics || {},
    },
  };
}

function buildReportedBaseSummary(filingMetadata, normalizedMetrics) {
  const parts = [];
  if (Number.isFinite(normalizedMetrics.revenueLtm)) parts.push(`revenue base ${formatMoneyMillions(normalizedMetrics.revenueLtm)}`);
  if (Number.isFinite(normalizedMetrics.grossMarginPct)) parts.push(`gross margin ${round1(normalizedMetrics.grossMarginPct)}%`);
  if (Number.isFinite(normalizedMetrics.operatingMarginPct)) parts.push(`operating margin ${round1(normalizedMetrics.operatingMarginPct)}%`);
  if (Number.isFinite(normalizedMetrics.netDebt)) parts.push(`net debt ${formatMoneyMillions(normalizedMetrics.netDebt)}`);
  const subject = filingMetadata?.company || 'Selected filing';
  return parts.length ? `${subject}: ${parts.join(', ')}.` : `${subject}: deterministic hard-field extraction needs analyst review.`;
}

function buildDraftedBaseline({ filingExtraction, deterministicExtraction, filingAnalysis }) {
  const aiDraft = filingAnalysis?.draftedBaseline || {};
  const aiMeta = filingAnalysis?.draftedBaselineMeta || {};
  const metrics = filingExtraction?.reportedBase?.normalizedMetrics || {};
  const deterministicMetrics = deterministicExtraction?.normalizedMetrics || {};
  const currentRevenue = chooseDeterministic(metrics.revenueLtm);
  const shareCount = chooseDeterministic(metrics.shareCount);
  const netDebt = chooseDeterministic(metrics.netDebt);
  const grossMarginStart = chooseDeterministic(metrics.grossMarginPct);
  const operatingMarginStart = chooseDeterministic(metrics.operatingMarginPct);
  const taxRate = chooseDeterministic(metrics.taxRatePct);
  const capexPct = chooseDeterministic(metrics.capexPctRevenue) ?? deriveConservativeCapexFallback({ metrics, currentRevenue, grossMarginStart, operatingMarginStart, daPctRevenue: metrics.daPctRevenue });
  const daPct = chooseDeterministic(metrics.daPctRevenue);
  const revenueGrowthProfile = buildRevenueGrowthProfile({
    aiValues: aiDraft.revenueGrowth,
    aiMeta: aiMeta.revenueGrowth,
    aiRunwayGrowth: filingAnalysis?.currentRunwayGrowthPct,
    aiRunwayMeta: filingAnalysis?.currentRunwayGrowthMeta,
    deterministicExtraction,
    filingMetadata: filingExtraction?.filingMetadata,
    currentRevenue,
    operatingMarginStart,
  });
  const softAssumptions = buildCompanyAwareSoftAssumptions({
    filingMetadata: filingExtraction?.filingMetadata,
    metrics: { ...deterministicMetrics, ...metrics },
    historicalMetrics: deterministicExtraction?.historicalMetrics || {},
    currentRevenue,
    grossMarginStart,
    operatingMarginStart,
    taxRate,
    capexPct,
    daPct,
    netDebt,
    revenueGrowth: revenueGrowthProfile.path,
  });

  return {
    companyName: filingExtraction?.filingMetadata?.company || aiDraft.companyName || '',
    unitLabel: '$mm',
    currentRevenue,
    revenueGrowth: revenueGrowthProfile.path,
    grossMarginStart,
    grossMarginEnd: softAssumptions.values.grossMarginEnd,
    operatingMarginStart,
    operatingMarginEnd: softAssumptions.values.operatingMarginEnd,
    taxRate,
    capexPct,
    daPct,
    nwcPct: softAssumptions.values.nwcPct,
    workingCapitalTargetPct: softAssumptions.values.workingCapitalTargetPct,
    workingCapitalProfile: softAssumptions.values.workingCapitalProfile,
    wacc: softAssumptions.values.wacc,
    terminalGrowth: softAssumptions.values.terminalGrowth,
    shareCount,
    netDebt,
    exitEbitdaMultiple: softAssumptions.values.exitEbitdaMultiple,
    diagnostics: {
      cash: metrics.cash,
      debt: metrics.debt,
      liquidity: metrics.liquidity,
      operatingWorkingCapital: metrics.operatingWorkingCapital,
      operatingWorkingCapitalPct: metrics.operatingWorkingCapitalPct,
      hardFieldSources: deterministicExtraction?.fieldSources || {},
      revenueHistoricalGrowthPct: deterministicExtraction?.historicalMetrics?.revenueHistoricalGrowthPct ?? metrics.revenueHistoricalGrowthPct ?? null,
      revenueComparableGrowthPct: deterministicExtraction?.historicalMetrics?.revenueComparableGrowthPct ?? metrics.revenueComparableGrowthPct ?? null,
      revenuePriorAnnualGrowthPct: deterministicExtraction?.historicalMetrics?.revenuePriorAnnualGrowthPct ?? metrics.revenuePriorAnnualGrowthPct ?? null,
      revenueGrowthSource: revenueGrowthProfile.source,
      revenueGrowthSignals: revenueGrowthProfile.signals,
      heuristicMeta: {
        revenueGrowth: revenueGrowthProfile.meta,
        ...softAssumptions.meta,
      },
    },
  };
}

function buildDraftedBaselineMeta({ aiMeta, filingExtraction, deterministicExtraction, draftedBaseline, filingAnalysis }) {
  const meta = applySchemaDefaults(aiMeta || {}, DRAFTED_BASELINE_META_SCHEMA);
  const fieldSources = deterministicExtraction?.fieldSources || {};
  const aiDraft = filingAnalysis?.draftedBaseline || {};
  const heuristicMeta = draftedBaseline?.diagnostics?.heuristicMeta || {};

  if (draftedBaseline.companyName) {
    meta.companyName = {
      classification: 'reported',
      rationale: 'Company name comes directly from filing metadata.',
      evidence: filingExtraction?.filingMetadata?.company || filingExtraction?.filingMetadata?.title || '',
      confidence: 'high',
      source: 'filing_metadata',
    };
  }

  if (Array.isArray(draftedBaseline.revenueGrowth) && draftedBaseline.revenueGrowth.length === 5) {
    meta.revenueGrowth = heuristicMeta.revenueGrowth || meta.revenueGrowth;
  }

  for (const field of HARD_BASELINE_FIELDS) {
    if (field === 'cash' || field === 'debt') continue;
    const source = fieldSources[field];
    if (source && Number.isFinite(source.value)) {
      meta[field] = {
        classification: source.classification,
        rationale: source.rationale,
        evidence: source.evidence,
        confidence: source.confidence,
        source: source.source,
        basis: source.basis || null,
      };
      continue;
    }

    const aiValue = aiDraft[field];
    if (Number.isFinite(Number(aiValue))) {
      meta[field] = {
        classification: 'review_required',
        rationale: `No deterministic SEC fact was available for ${field}, so the AI fallback is retained for analyst review only.`,
        evidence: meta[field]?.evidence || 'Deterministic extraction unavailable.',
        confidence: 'low',
        source: 'ai_fallback',
        basis: 'fallback_only',
      };
    } else {
      meta[field] = {
        classification: 'review_required',
        rationale: `No reliable deterministic or AI-supported value is available for ${field}.`,
        evidence: source?.evidence || 'Value unresolved.',
        confidence: 'low',
        source: 'missing',
        basis: 'missing',
      };
    }
  }

  for (const field of ['grossMarginEnd', 'operatingMarginEnd', 'nwcPct', 'wacc', 'terminalGrowth', 'exitEbitdaMultiple']) {
    if (heuristicMeta[field]) meta[field] = heuristicMeta[field];
  }

  return meta;
}

function buildReviewPacket({ filingSource, filingExtraction, draftedBaseline, draftedBaselineMeta, deterministicExtraction, analysisStatus }) {
  return {
    generatedAt: new Date().toISOString(),
    filingMetadata: mergeFilingMetadata(filingExtraction?.filingMetadata, filingSource.fallbackMetadata),
    filingSelection: deterministicExtraction?.diagnostics?.filingSelection || deterministicExtraction?.filingSelection || null,
    analysisStatus,
    sources: { filing: summarizeSource(filingSource) },
    businessOverview: filingExtraction?.businessOverview || { summary: '', businessLines: [], segmentNotes: [], geographyNotes: [] },
    reportedBase: filingExtraction?.reportedBase || { summary: '', reportedFacts: [], normalizedMetrics: {} },
    derivedMetrics: filingExtraction?.derivedMetrics || [],
    keyTakeaways: filingExtraction?.keyTakeaways || [],
    modelDrivers: filingExtraction?.modelDrivers || [],
    guidanceReferences: filingExtraction?.guidanceReferences || [],
    risksAndWatchItems: filingExtraction?.risksAndWatchItems || [],
    reviewFlags: filingExtraction?.reviewFlags || [],
    confidenceMap: filingExtraction?.confidenceMap || {},
    evidenceMap: filingExtraction?.evidenceMap || {},
    deterministicExtraction: {
      promptPacket: buildPromptPacket(deterministicExtraction),
      diagnostics: deterministicExtraction?.diagnostics || {},
    },
    draftedBaseline,
    draftedBaselineMeta,
    missingBaseInputs: filingExtraction?.missingBaseInputs || [],
  };
}

function buildModelSummaryForPrompt(modelPack) {
  const comparison = modelPack.comparison.map((row) => ({
    metric: row.metric,
    prior: row.prior,
    base: row.base,
    upside: row.upside,
    downside: row.downside,
    format: row.format,
  }));

  return {
    years: YEAR_LABELS,
    comparison,
    changeVsPrior: modelPack.changeVsPrior,
    baseValuation: modelPack.scenarios.base.valuation,
    upsideValuation: modelPack.scenarios.upside.valuation,
    downsideValuation: modelPack.scenarios.downside.valuation,
    valuationBridge: modelPack.valuationBridge,
  };
}

function buildResult({
  filingSource,
  deterministicExtraction,
  filingExtraction,
  filingAnalysis,
  draftedBaseline,
  draftedBaselineMeta,
  analysisStatus,
  reportPack,
  modelPack,
  stageTimings,
  model,
}) {
  return {
    generatedAt: new Date().toISOString(),
    model,
    analysisStatus,
    filingMetadata: mergeFilingMetadata(filingExtraction?.filingMetadata, filingSource.fallbackMetadata),
    filingSelection: deterministicExtraction?.diagnostics?.filingSelection || deterministicExtraction?.filingSelection || null,
    sources: { filing: summarizeSource(filingSource) },
    draftedBaseline,
    draftedBaselineMeta,
    deterministicExtraction: {
      promptPacket: buildPromptPacket(deterministicExtraction),
      diagnostics: deterministicExtraction?.diagnostics || {},
    },
    executiveSummary: reportPack?.executiveSummary || { headline: '', body: '', bullets: [] },
    businessOverview: filingExtraction?.businessOverview || { summary: '', businessLines: [], segmentNotes: [], geographyNotes: [] },
    keyTakeaways: filingExtraction?.keyTakeaways || [],
    whatMattersForModel: {
      summary: filingAnalysis?.whatMattersForModel?.summary || '',
      bullets: filingAnalysis?.whatMattersForModel?.bullets || [],
      drivers: filingExtraction?.modelDrivers || [],
    },
    reportedBase: filingExtraction?.reportedBase || { summary: '', reportedFacts: [], normalizedMetrics: {} },
    derivedMetrics: filingExtraction?.derivedMetrics || [],
    proposedAssumptions: filingAnalysis?.proposedAssumptions || [],
    assumptionReview: filingAnalysis?.assumptionReview || [],
    scenarioWriteups: reportPack?.scenarioWriteups || {},
    modelPack,
    valuationSummary: {
      summary: reportPack?.valuationSummary?.summary || filingAnalysis?.valuationFraming?.summary || '',
      bullets: reportPack?.valuationSummary?.bullets || [],
      bridgeDrivers: filingAnalysis?.valuationFraming?.bridgeDrivers || [],
      scenarioStructure: filingAnalysis?.valuationFraming?.scenarioStructure || [],
    },
    keySensitivities: filingAnalysis?.valuationFraming?.keySensitivities || [],
    guidanceReferences: filingExtraction?.guidanceReferences || [],
    risksAndWatchItems: filingExtraction?.risksAndWatchItems || [],
    reviewFlags: dedupeByKey([
      ...(filingExtraction?.reviewFlags || []),
      ...(filingAnalysis?.reviewFlags || []),
      ...((analysisStatus?.blockingIssues || []).map((message) => ({ item: 'Baseline review', reason: message, evidence: 'Baseline validation checks', confidence: 'high' }))),
    ], (item) => `${item.item}|${item.reason}|${item.evidence}`),
    checklist: filingAnalysis?.checklist || [],
    confidenceMap: {
      extraction: filingExtraction?.confidenceMap || {},
      analysis: filingAnalysis?.confidenceMap || {},
      draftedBaseline: draftedBaselineMeta,
    },
    evidenceMap: {
      extraction: filingExtraction?.evidenceMap || {},
      analysis: filingAnalysis?.evidenceMap || {},
    },
    sourceAppendix: reportPack?.sourceAppendix || { methodology: '', caveats: [] },
    missingBaseInputs: filingExtraction?.missingBaseInputs || [],
    stageTimings,
  };
}

function setupSseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
}

function mergeFilingMetadata(extracted = {}, fallback = {}) {
  return {
    ...fallback,
    ...extracted,
    company: extracted?.company || fallback?.company || null,
    filingType: extracted?.filingType || fallback?.filingType || null,
    period: extracted?.period || fallback?.period || fallback?.reportingPeriod || null,
    filingDate: extracted?.filingDate || fallback?.filingDate || null,
    title: extracted?.title || fallback?.title || null,
    fiscalQuarter: extracted?.fiscalQuarter || fallback?.fiscalQuarter || null,
    fiscalYear: extracted?.fiscalYear || fallback?.fiscalYear || null,
    reportingPeriod: extracted?.reportingPeriod || fallback?.reportingPeriod || null,
  };
}

function chooseDeterministic(primaryValue, deterministicValue = null) {
  if (Number.isFinite(deterministicValue)) return deterministicValue;
  return Number.isFinite(primaryValue) ? primaryValue : null;
}

function buildRevenueGrowthProfile({ aiValues, aiMeta, aiRunwayGrowth, aiRunwayMeta, deterministicExtraction, filingMetadata, currentRevenue, operatingMarginStart }) {
  const historicalMetrics = deterministicExtraction?.historicalMetrics || {};
  const filingType = deterministicExtraction?.filingMetadata?.filingType || filingMetadata?.filingType || null;
  const comparableGrowth = firstFiniteNumber(historicalMetrics.revenueComparableGrowthPct, deterministicExtraction?.normalizedMetrics?.revenueComparableGrowthPct);
  const ltmGrowth = firstFiniteNumber(historicalMetrics.revenueHistoricalGrowthPct, deterministicExtraction?.normalizedMetrics?.revenueHistoricalGrowthPct);
  const priorAnnualGrowth = firstFiniteNumber(historicalMetrics.revenuePriorAnnualGrowthPct, deterministicExtraction?.normalizedMetrics?.revenuePriorAnnualGrowthPct);
  const hasDeterministicSignal = [comparableGrowth, ltmGrowth, priorAnnualGrowth].some((value) => Number.isFinite(value));
  const positiveSignals = [comparableGrowth, ltmGrowth, priorAnnualGrowth].filter(
    (value) => Number.isFinite(value) && value > 0
  );
  const bestPositiveSignal = positiveSignals.length ? Math.max(...positiveSignals) : null;

  if (!hasDeterministicSignal && shouldUseAiRevenueGrowth(aiValues, aiMeta)) {
    const path = aiValues.map((value) => round1(Number(value)));
    return {
      path,
      source: 'ai',
      signals: {},
      meta: {
        classification: 'proposed',
        rationale: 'AI revenue growth path was retained only because deterministic recent-growth signals were unavailable.',
        evidence: `Fallback AI path ${path.join(', ')}%.`,
        confidence: aiMeta?.confidence || 'medium',
        source: 'ai_supported',
        basis: 'fallback',
      },
    };
  }

  if (!hasDeterministicSignal) {
    return {
      path: DEFAULT_BASELINE.revenueGrowth,
      source: 'default',
      signals: {},
      meta: {
        classification: 'review_required',
        rationale: 'Recent reported growth signals were unavailable, so the revenue path falls back to the default house curve.',
        evidence: `Default path ${DEFAULT_BASELINE.revenueGrowth.join(', ')}%.`,
        confidence: 'low',
        source: 'default_fallback',
        basis: 'fallback',
      },
    };
  }

  const eliteGrowthProfile = currentRevenue >= 50_000 && operatingMarginStart >= 25;
  const primaryAnchor = filingType === '10-Q'
    ? weightedAverage([
      { value: comparableGrowth, weight: 0.6 },
      { value: ltmGrowth, weight: 0.25 },
      { value: priorAnnualGrowth, weight: 0.15 },
    ])
    : weightedAverage([
      { value: comparableGrowth, weight: eliteGrowthProfile ? 0.5 : 0.35 },
      { value: ltmGrowth, weight: eliteGrowthProfile ? 0.3 : 0.45 },
      { value: priorAnnualGrowth, weight: 0.2 },
    ]);
  const anchorGrowth = firstFiniteNumber(primaryAnchor, comparableGrowth, ltmGrowth, priorAnnualGrowth, DEFAULT_BASELINE.revenueGrowth[0]);
  const trendDelta = Number.isFinite(comparableGrowth) && Number.isFinite(priorAnnualGrowth)
    ? comparableGrowth - priorAnnualGrowth
    : Number.isFinite(comparableGrowth) && Number.isFinite(ltmGrowth)
      ? comparableGrowth - ltmGrowth
      : 0;
  const deceleration = Number.isFinite(comparableGrowth) && Number.isFinite(ltmGrowth)
    ? comparableGrowth - ltmGrowth
    : Number.isFinite(ltmGrowth) && Number.isFinite(priorAnnualGrowth)
      ? ltmGrowth - priorAnnualGrowth
      : 0;

  let qualityScore = 0;
  if (currentRevenue >= 100_000) qualityScore += 2;
  else if (currentRevenue >= 25_000) qualityScore += 1;
  else if (currentRevenue > 0 && currentRevenue < 5_000) qualityScore -= 0.5;
  if (operatingMarginStart >= 25) qualityScore += 2;
  else if (operatingMarginStart >= 15) qualityScore += 1;
  else if (operatingMarginStart < 0) qualityScore -= 2;
  else if (operatingMarginStart < 8) qualityScore -= 0.5;
  if (anchorGrowth >= 10) qualityScore += 0.75;
  else if (anchorGrowth < 0) qualityScore -= 0.75;
  if (deceleration >= -2) qualityScore += 0.5;
  else if (deceleration < -8) qualityScore -= 1;
  if (trendDelta >= 0) qualityScore += 0.4;
  else if (trendDelta < -8) qualityScore -= 0.5;

  let yearOneFloor = currentRevenue >= 100_000 ? 3.5 : currentRevenue >= 50_000 ? 2.5 : 1.5;

  if (eliteGrowthProfile && Number.isFinite(bestPositiveSignal) && bestPositiveSignal >= 8) {
    yearOneFloor = Math.max(yearOneFloor, Math.max(3.5, Math.min(12, bestPositiveSignal * 0.35)));
  }

  if (filingType === '10-Q' && Number.isFinite(comparableGrowth) && comparableGrowth >= 8) {
    yearOneFloor = Math.max(yearOneFloor, Math.min(12, comparableGrowth * 0.5));
  }

  let yearOne = clampNumber(anchorGrowth, DEFAULT_BASELINE.revenueGrowth[0], -12, eliteGrowthProfile ? 32 : 28);

  if (eliteGrowthProfile && Number.isFinite(bestPositiveSignal) && bestPositiveSignal >= 8) {
    yearOne = Math.max(yearOne, yearOneFloor);
  } else if (anchorGrowth > 0) {
    yearOne = Math.max(yearOne, yearOneFloor);
  }

  const normalizedAiRunway = normalizeAiRunwayGrowth(aiRunwayGrowth, aiRunwayMeta);
  if (Number.isFinite(normalizedAiRunway.value)) {
    yearOne = clampNumber(round1(normalizedAiRunway.value), DEFAULT_BASELINE.revenueGrowth[0], -12, eliteGrowthProfile ? 32 : 28);
  }

  let matureTarget = 3.2;
  if (currentRevenue >= 100_000) matureTarget += 0.5;
  else if (currentRevenue > 0 && currentRevenue < 5_000) matureTarget -= 0.3;
  if (operatingMarginStart >= 20) matureTarget += 0.35;
  else if (operatingMarginStart < 5) matureTarget -= 0.35;
  if (yearOne >= 15) matureTarget += 0.45;
  else if (yearOne < 3) matureTarget -= 0.25;
  if (deceleration < -8) matureTarget -= 0.35;
  if (eliteGrowthProfile && yearOne >= 8) matureTarget += 0.5;
  matureTarget = clampNumber(matureTarget, DEFAULT_BASELINE.revenueGrowth[4], 2, eliteGrowthProfile ? 8 : 7);

  const fadePower = qualityScore >= 3 ? 2.15 : qualityScore >= 1.5 ? 1.85 : qualityScore >= 0 ? 1.6 : 1.3;
  const yearFive = yearOne >= 0
    ? clampNumber(Math.min(Math.max(matureTarget, 2), Math.max(matureTarget, yearOne - (eliteGrowthProfile ? 1.2 : 0.8))), matureTarget, 2, eliteGrowthProfile ? 10 : 9)
    : clampNumber(Math.max(1.5, matureTarget - 0.3), matureTarget, 1.5, 5.5);

  const rawPath = interpolatePath(yearOne, yearFive, YEAR_LABELS.length, fadePower);
  const maxAnnualDrop = clampNumber(2.2 + Math.max(0, yearOne) / 10 + Math.max(0, -deceleration) * 0.18, eliteGrowthProfile ? 4.2 : 3.2, 1.5, eliteGrowthProfile ? 7.5 : 6.5);
  const path = smoothRevenueGrowthPath(rawPath, { maxAnnualDrop, allowMildReacceleration: yearOne < 3 }).map((value) => round1(value));

  const signalText = [
    Number.isFinite(comparableGrowth) ? `recent comparable-period growth ${round1(comparableGrowth)}%` : null,
    Number.isFinite(ltmGrowth) ? `LTM growth ${round1(ltmGrowth)}%` : null,
    Number.isFinite(priorAnnualGrowth) ? `prior-year growth ${round1(priorAnnualGrowth)}%` : null,
  ].filter(Boolean).join(', ');

  const revenueGrowthSource = Number.isFinite(normalizedAiRunway.value)
    ? 'ai_runway_priority'
    : 'heuristic';

  return {
    path,
    source: revenueGrowthSource,
    signals: {
      filingType,
      anchorGrowthPct: round1(yearOne),
      comparableGrowthPct: Number.isFinite(comparableGrowth) ? round1(comparableGrowth) : null,
      ltmGrowthPct: Number.isFinite(ltmGrowth) ? round1(ltmGrowth) : null,
      priorAnnualGrowthPct: Number.isFinite(priorAnnualGrowth) ? round1(priorAnnualGrowth) : null,
      decelerationPct: Number.isFinite(deceleration) ? round1(deceleration) : null,
      trendDeltaPct: Number.isFinite(trendDelta) ? round1(trendDelta) : null,
      bestPositiveSignalPct: Number.isFinite(bestPositiveSignal) ? round1(bestPositiveSignal) : null,
      aiRunwayGrowthPct: Number.isFinite(normalizedAiRunway.value) ? round1(normalizedAiRunway.value) : null,
      aiRunwayInfluence: Number.isFinite(normalizedAiRunway.value) ? 1 : 0,
      matureTargetPct: round1(yearFive),
      qualityScore: round1(qualityScore),
    },
    meta: {
      classification: Number.isFinite(normalizedAiRunway.value) ? 'proposed' : 'derived',
      rationale: Number.isFinite(normalizedAiRunway.value)
        ? 'FY+1 is led directly by the AI runway-growth read when numeric, while years 2 to 5 remain on the deterministic fade and smoothing logic.'
        : 'FY+1 blends comparable-period, prior-annual, and LTM growth signals, then fades with scale and profitability-aware discipline rather than collapsing elite growers to a flat base case.',
      evidence: Number.isFinite(normalizedAiRunway.value)
        ? `${signalText || 'Recent deterministic growth signals unavailable'}; AI runway ${round1(normalizedAiRunway.value)}% (${normalizedAiRunway.meta?.evidence || 'filing runway read'}); FY+1 anchored to AI runway; forecast path ${path.join(', ')}%.`
        : `${signalText || 'Recent deterministic growth signals unavailable'}; forecast path ${path.join(', ')}%.`,
      confidence: Number.isFinite(normalizedAiRunway.value)
        ? normalizedAiRunway.meta?.confidence || 'medium'
        : signalText ? 'medium' : 'low',
      source: Number.isFinite(normalizedAiRunway.value) ? 'ai_runway_priority' : 'deterministic_heuristic',
      basis: Number.isFinite(normalizedAiRunway.value) ? 'ai_runway_year1_deterministic_fade' : 'heuristic',
    },
  };
}

function normalizeAiRunwayGrowth(value, meta = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return { value: null, meta: null };
  return { value: numeric, meta };
}

function shouldUseAiRevenueGrowth(values, meta = {}) {
  if (!Array.isArray(values) || values.length !== 5) return false;
  const normalized = values.map((value) => Number(value));
  if (normalized.some((value) => !Number.isFinite(value) || value < -20 || value > 35)) return false;
  if (normalized.every((value) => Math.abs(value) < 0.25)) return false;
  if ((meta?.confidence || 'low') === 'low') return false;
  return true;
}

function buildCompanyAwareSoftAssumptions({ filingMetadata, metrics, historicalMetrics, currentRevenue, grossMarginStart, operatingMarginStart, taxRate, capexPct, daPct, netDebt, revenueGrowth }) {
  const anchorGrowth = firstFiniteNumber(revenueGrowth?.[0], historicalMetrics?.revenueComparableGrowthPct, historicalMetrics?.revenueHistoricalGrowthPct);
  const yearFiveGrowth = firstFiniteNumber(revenueGrowth?.[4], DEFAULT_BASELINE.revenueGrowth[4]);
  const leverageRatio = Number.isFinite(netDebt) && Number.isFinite(currentRevenue) && currentRevenue > 0 ? netDebt / currentRevenue : null;
  const operatingWorkingCapitalPct = firstFiniteNumber(metrics.operatingWorkingCapitalPct);
  const inventoryPctRevenue = firstFiniteNumber(metrics.inventoryPctRevenue);
  const deferredRevenuePctRevenue = firstFiniteNumber(metrics.deferredRevenuePctRevenue);

  let wacc = 9.25;
  if (currentRevenue >= 150_000) wacc -= 0.9;
  else if (currentRevenue >= 50_000) wacc -= 0.6;
  else if (currentRevenue >= 10_000) wacc -= 0.3;
  else if (currentRevenue > 0 && currentRevenue < 3_000) wacc += 0.5;
  if (operatingMarginStart >= 30) wacc -= 0.5;
  else if (operatingMarginStart >= 15) wacc -= 0.25;
  else if (operatingMarginStart < 0) wacc += 1.0;
  else if (operatingMarginStart < 8) wacc += 0.35;
  if (grossMarginStart >= 60) wacc -= 0.2;
  else if (grossMarginStart < 25) wacc += 0.2;
  if (Number.isFinite(leverageRatio)) {
    if (leverageRatio > 1) wacc += 0.8;
    else if (leverageRatio > 0.5) wacc += 0.4;
    else if (leverageRatio < -0.1) wacc -= 0.2;
  }
  if (anchorGrowth >= 15) wacc += 0.25;
  else if (anchorGrowth < 3 && operatingMarginStart >= 15) wacc -= 0.15;
  wacc = clampNumber(round1(wacc), DEFAULT_BASELINE.wacc, 6.5, 13.5);

  let terminalGrowth = 2.5;
  if (currentRevenue >= 100_000) terminalGrowth += 0.3;
  if (operatingMarginStart >= 20) terminalGrowth += 0.2;
  if (grossMarginStart >= 55) terminalGrowth += 0.1;
  if (anchorGrowth >= 8) terminalGrowth += 0.2;
  else if (anchorGrowth < 2) terminalGrowth -= 0.3;
  if (Number.isFinite(leverageRatio) && leverageRatio > 0.8) terminalGrowth -= 0.2;
  terminalGrowth = clampNumber(round1(terminalGrowth), DEFAULT_BASELINE.terminalGrowth, 1.8, Math.min(4.0, wacc - 1.25));

  const eliteMarginProfile = grossMarginStart >= 68 || operatingMarginStart >= 28;

  let grossMarginEnd = Number.isFinite(grossMarginStart) ? grossMarginStart : DEFAULT_BASELINE.grossMarginEnd;
  if (grossMarginStart >= 75) grossMarginEnd += 0.8;
  else if (grossMarginStart >= 65) grossMarginEnd += 0.6;
  else if (grossMarginStart >= 50) grossMarginEnd += 0.4;
  else if (grossMarginStart <= 25 && anchorGrowth > 5) grossMarginEnd += 0.3;
  if (operatingMarginStart < 0 && grossMarginStart > 35) grossMarginEnd += 0.6;
  if (anchorGrowth < 0) grossMarginEnd -= 0.4;
  if (currentRevenue >= 50_000 && grossMarginStart >= 35) grossMarginEnd += 0.2;
  grossMarginEnd = clampNumber(round1(grossMarginEnd), DEFAULT_BASELINE.grossMarginEnd, Math.max(-20, (grossMarginStart || DEFAULT_BASELINE.grossMarginStart) - 2.5), Math.min(eliteMarginProfile ? 97 : 95, (grossMarginStart || DEFAULT_BASELINE.grossMarginStart) + (eliteMarginProfile ? 4.5 : 3.5)));

  let operatingMarginEnd = Number.isFinite(operatingMarginStart) ? operatingMarginStart : DEFAULT_BASELINE.operatingMarginEnd;
  if (operatingMarginStart >= 30) operatingMarginEnd += 1.0 + (anchorGrowth > 8 ? 0.5 : 0.2);
  else if (operatingMarginStart >= 25) operatingMarginEnd += 0.8 + (anchorGrowth > 8 ? 0.4 : 0);
  else if (operatingMarginStart >= 15) operatingMarginEnd += 1.2 + (currentRevenue >= 50_000 ? 0.4 : 0);
  else if (operatingMarginStart >= 5) operatingMarginEnd += 2.0 + (grossMarginStart > 45 ? 0.6 : 0);
  else if (operatingMarginStart >= 0) operatingMarginEnd += 3.0 + (grossMarginStart > 45 ? 0.8 : 0);
  else operatingMarginEnd += 4.5 + (grossMarginStart > 45 ? 1.0 : 0);
  if (eliteMarginProfile && anchorGrowth >= 5) operatingMarginEnd += 0.4;
  if (anchorGrowth < 0) operatingMarginEnd -= 0.6;
  if (capexPct > 6) operatingMarginEnd -= 0.3;
  operatingMarginEnd = Math.min(operatingMarginEnd, grossMarginEnd - (eliteMarginProfile ? 1.5 : 2.5));
  operatingMarginEnd = clampNumber(round1(operatingMarginEnd), DEFAULT_BASELINE.operatingMarginEnd, -20, Math.min(eliteMarginProfile ? 60 : 50, grossMarginEnd - 1.2));

  let workingCapitalProfile = 'balanced';
  if (Number.isFinite(operatingWorkingCapitalPct)) {
    if (operatingWorkingCapitalPct < -1.5 || deferredRevenuePctRevenue > 3) workingCapitalProfile = 'negative';
    else if (inventoryPctRevenue > 8 || grossMarginStart < 35) workingCapitalProfile = 'inventory_heavy';
    else if (operatingWorkingCapitalPct < 2) workingCapitalProfile = 'light';
  } else if (grossMarginStart >= 60) {
    workingCapitalProfile = 'light';
  } else if (grossMarginStart < 35) {
    workingCapitalProfile = 'inventory_heavy';
  }

  let nwcPct = Number.isFinite(operatingWorkingCapitalPct)
    ? operatingWorkingCapitalPct
    : workingCapitalProfile === 'negative'
      ? -1.5
      : workingCapitalProfile === 'inventory_heavy'
        ? 4.0
        : workingCapitalProfile === 'light'
          ? 0.5
          : DEFAULT_BASELINE.nwcPct;
  nwcPct = clampNumber(round1(nwcPct), DEFAULT_BASELINE.nwcPct, -8, 12);

  let workingCapitalTargetPct = nwcPct;
  if (workingCapitalProfile === 'negative') workingCapitalTargetPct = Math.min(nwcPct + 0.4, 0);
  if (workingCapitalProfile === 'inventory_heavy') workingCapitalTargetPct = nwcPct - 0.8;
  if (workingCapitalProfile === 'balanced') workingCapitalTargetPct = nwcPct - 0.3;
  if (workingCapitalProfile === 'light') workingCapitalTargetPct = nwcPct + (anchorGrowth > 10 ? 0.2 : 0);
  if (anchorGrowth < 0) workingCapitalTargetPct = Math.min(workingCapitalTargetPct, nwcPct + 0.2);
  workingCapitalTargetPct = clampNumber(round1(workingCapitalTargetPct), nwcPct, -8, 12);

  let exitEbitdaMultiple = 7.5;
  exitEbitdaMultiple += clampNumber((operatingMarginEnd - 10) * 0.25, 0, -1, 5);
  exitEbitdaMultiple += clampNumber((yearFiveGrowth - 3) * 0.2, 0, -0.5, 1.5);
  if (currentRevenue >= 100_000) exitEbitdaMultiple += 1.2;
  else if (currentRevenue >= 25_000) exitEbitdaMultiple += 0.6;
  if (wacc <= 8) exitEbitdaMultiple += 0.7;
  else if (wacc >= 10.5) exitEbitdaMultiple -= 0.5;
  if (Number.isFinite(leverageRatio) && leverageRatio > 1) exitEbitdaMultiple -= 0.7;
  if (operatingMarginEnd < 5) exitEbitdaMultiple -= 1.0;
  exitEbitdaMultiple = clampNumber(round1(exitEbitdaMultiple), DEFAULT_BASELINE.exitEbitdaMultiple, 6, 20);

  const signalSummary = [
    Number.isFinite(currentRevenue) ? `scale ${formatMoneyMillions(currentRevenue)} revenue` : null,
    Number.isFinite(anchorGrowth) ? `FY+1 growth anchor ${round1(anchorGrowth)}%` : null,
    Number.isFinite(grossMarginStart) ? `gross margin ${round1(grossMarginStart)}%` : null,
    Number.isFinite(operatingMarginStart) ? `operating margin ${round1(operatingMarginStart)}%` : null,
    Number.isFinite(operatingWorkingCapitalPct) ? `operating working capital ${round1(operatingWorkingCapitalPct)}% of revenue` : null,
  ].filter(Boolean).join(', ');

  return {
    values: {
      grossMarginEnd,
      operatingMarginEnd,
      nwcPct,
      workingCapitalTargetPct,
      workingCapitalProfile,
      wacc,
      terminalGrowth,
      exitEbitdaMultiple,
    },
    meta: {
      grossMarginEnd: buildSoftAssumptionMeta('proposed', 'Gross-margin fade is tied to current margin structure, scale, and recent growth quality rather than a flat template.', `${signalSummary}; gross margin end ${round1(grossMarginEnd)}%.`, 'medium'),
      operatingMarginEnd: buildSoftAssumptionMeta('proposed', 'Operating-margin evolution reflects current profitability, gross-margin headroom, scale, and growth cadence.', `${signalSummary}; operating margin end ${round1(operatingMarginEnd)}%.`, 'medium'),
      nwcPct: buildSoftAssumptionMeta('proposed', 'Working-capital intensity is grounded in filing-based receivables, inventory, payables, and deferred-revenue signals when available.', `${signalSummary}; modeled working-capital intensity ${round1(nwcPct)}% with a ${workingCapitalProfile.replace(/_/g, ' ')} profile.`, Number.isFinite(operatingWorkingCapitalPct) ? 'medium' : 'low'),
      wacc: buildSoftAssumptionMeta('proposed', 'WACC is scaled to company size, profitability, balance-sheet posture, and growth risk while staying conservative.', `${signalSummary}; WACC ${round1(wacc)}%.`, 'medium'),
      terminalGrowth: buildSoftAssumptionMeta('proposed', 'Terminal growth is bounded off company scale, profitability, and the de-risked end-state growth profile.', `${signalSummary}; terminal growth ${round1(terminalGrowth)}%.`, 'medium'),
      exitEbitdaMultiple: buildSoftAssumptionMeta('proposed', 'The exit multiple is an automatic terminal cross-check based on terminal growth, margins, scale, and cost of capital.', `${signalSummary}; exit EBITDA multiple ${round1(exitEbitdaMultiple)}x.`, 'medium'),
    },
  };
}

function clampNumber(value, fallback, min, max) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function buildSoftAssumptionMeta(classification, rationale, evidence, confidence = 'medium') {
  return {
    classification,
    rationale,
    evidence,
    confidence,
    source: 'deterministic_heuristic',
    basis: 'heuristic',
  };
}

function weightedAverage(items = []) {
  const usable = items.filter((item) => Number.isFinite(item?.value) && Number.isFinite(item?.weight) && item.weight > 0);
  if (!usable.length) return null;
  const weight = usable.reduce((sum, item) => sum + item.weight, 0);
  if (!weight) return null;
  return usable.reduce((sum, item) => sum + item.value * item.weight, 0) / weight;
}

function interpolatePath(start, end, length, power = 1.5) {
  return Array.from({ length }, (_value, index) => {
    if (length === 1) return start;
    const t = index / (length - 1);
    return start + (end - start) * Math.pow(t, power);
  });
}

function smoothRevenueGrowthPath(path, { maxAnnualDrop = 4, allowMildReacceleration = false } = {}) {
  const smoothed = [...path];
  for (let index = 1; index < smoothed.length; index += 1) {
    const prior = smoothed[index - 1];
    const current = smoothed[index];
    if (!Number.isFinite(prior) || !Number.isFinite(current)) continue;
    const floor = prior - maxAnnualDrop;
    const cap = allowMildReacceleration ? prior + 0.8 : prior + 0.25;
    smoothed[index] = Math.min(cap, Math.max(floor, current));
  }
  return smoothed;
}

function firstFiniteNumber(...values) {
  const value = values.find((candidate) => Number.isFinite(Number(candidate)));
  return value === undefined ? null : Number(value);
}

function dedupeByKey(items, keyFn) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeReviewFlagKey(item = {}) {
  return [item.item, item.reason, item.evidence]
    .map((value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim())
    .join('|');
}

function deriveConservativeCapexFallback({ metrics, currentRevenue, grossMarginStart, operatingMarginStart, daPctRevenue }) {
  const daPct = firstFiniteNumber(metrics?.daPctRevenue, daPctRevenue);
  const revenueScale = firstFiniteNumber(currentRevenue, metrics?.revenueLtm);
  let fallback = Number.isFinite(daPct) ? Math.max(daPct, daPct + 0.4) : 2.5;
  if (Number.isFinite(grossMarginStart) && grossMarginStart >= 60) fallback -= 0.3;
  if (Number.isFinite(operatingMarginStart) && operatingMarginStart >= 25) fallback -= 0.2;
  if (Number.isFinite(revenueScale) && revenueScale >= 100000) fallback -= 0.2;
  if (Number.isFinite(metrics?.inventoryPctRevenue) && metrics.inventoryPctRevenue > 8) fallback += 0.8;
  return clampNumber(round1(fallback), DEFAULT_BASELINE.capexPct, 1.2, 6.5);
}

function formatMoneyMillions(value) {
  if (!Number.isFinite(value)) return '—';
  return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: Math.abs(value) < 100 ? 1 : 0 })}mm`;
}

function round1(value) {
  if (!Number.isFinite(value)) return value;
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function logFilingSelection(filingSelection) {
  if (!filingSelection) return;
  console.log('[filing-selection]', JSON.stringify(filingSelection));
}

function logDeterministicExtraction(deterministicExtraction) {
  const diagnostics = deterministicExtraction?.diagnostics || {};
  console.log('[deterministic-extraction]', JSON.stringify({
    filingSelection: diagnostics.filingSelection,
    normalizedMetrics: deterministicExtraction?.normalizedMetrics,
    fieldSources: deterministicExtraction?.fieldSources,
    unitApplications: diagnostics.unitApplications,
    tableFallbackUsed: diagnostics.tableFallbackUsed,
    tableReports: diagnostics.tableReports,
  }));
}

function logBaselineDecision({ draftedBaseline, draftedBaselineMeta, analysisStatus, deterministicExtraction }) {
  console.log('[baseline-decision]', JSON.stringify({
    draftedBaseline,
    hardFieldSources: deterministicExtraction?.fieldSources || {},
    draftedBaselineMeta,
    analysisStatus,
  }));
}

function buildFilingAnalysisInput(filingExtraction) {
  return {
    filingMetadata: filingExtraction?.filingMetadata || null,
    businessOverview: filingExtraction?.businessOverview || null,
    reportedBase: {
      summary: filingExtraction?.reportedBase?.summary || '',
      normalizedMetrics: filingExtraction?.reportedBase?.normalizedMetrics || {},
      reportedFacts: (filingExtraction?.reportedBase?.reportedFacts || []).slice(0, 12),
    },
    derivedMetrics: (filingExtraction?.derivedMetrics || []).slice(0, 8),
    keyTakeaways: (filingExtraction?.keyTakeaways || []).slice(0, 10),
    modelDrivers: (filingExtraction?.modelDrivers || []).slice(0, 10),
    guidanceReferences: (filingExtraction?.guidanceReferences || []).slice(0, 6),
    risksAndWatchItems: (filingExtraction?.risksAndWatchItems || []).slice(0, 8),
    reviewFlags: (filingExtraction?.reviewFlags || []).slice(0, 8),
    missingBaseInputs: filingExtraction?.missingBaseInputs || [],
  };
}

async function callGeminiJson(prompt, temperature = 0.2, options = {}) {
  const { timeoutMs = GEMINI_TIMEOUT_MS, label = 'Gemini request' } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          responseMimeType: 'application/json',
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || 'Gemini request failed.';
      throw new Error(message);
    }

    const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('')?.trim();
    if (!text) throw new Error('Gemini returned an empty response.');

    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error('Gemini returned invalid JSON.');
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
