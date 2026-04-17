import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';
import {
  buildAssetManagerModelPack,
  buildDirectionalModelPack,
  buildModelPack,
  DEFAULT_BASELINE,
  normalizeAssetManagerBaseline,
  normalizeBaseline,
  normalizeDirectionalBaseline,
  normalizeScenarioAdjustments,
  YEAR_LABELS,
} from './modeling.js';
import { buildSourcePacketForPrompt, ingestSource, normalizeFilingRequest, summarizeSource } from './sourceNormalization.js';
import {
  buildAssetManagerAnalysisPrompt,
  buildDirectionalAnalysisPrompt,
  buildFilingAnalysisPrompt,
  buildFilingExtractionPrompt,
  buildReportFormattingPrompt,
  buildRunwayGrowthPrompt,
} from './promptSchemas.js';
import {
  applySchemaDefaults,
  ASSET_MANAGER_ANALYSIS_SCHEMA,
  ASSET_MANAGER_BASELINE_META_SCHEMA,
  DIRECTIONAL_ANALYSIS_SCHEMA,
  DIRECTIONAL_BASELINE_META_SCHEMA,
  FILING_ANALYSIS_SCHEMA,
  FILING_EXTRACTION_SCHEMA,
  OPCO_BASELINE_META_SCHEMA,
  REPORT_PACK_SCHEMA,
  RUNWAY_GROWTH_SCHEMA,
} from './schemas.js';
import {
  buildPromptPacket,
  buildSafeReviewSummary,
  evaluateAssetManagerReadiness,
  evaluateDirectionalReadiness,
  evaluateOperatingCompanyReadiness,
  extractDeterministicFilingData,
} from './deterministicExtraction.js';
import {
  detectIssuerArchetypeFromDeterministicSignals,
  refineIssuerArchetype,
} from './issuerArchetypes.js';

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
    let assetManagerPack = null;
    let directionalPack = null;
    let reportPack = null;

    if (analysis.analysisStatus.canRunModel) {
      const forecastNote = analysis.analysisMode === 'asset_manager'
        ? 'Running anchor-based asset-manager valuation math from the validated baseline.'
        : analysis.analysisMode === 'directional_only'
          ? 'Running Directional Mode valuation math from the validated baseline.'
          : 'Running deterministic forecast and valuation math from the validated baseline.';
      markStage('forecast', 'Running deterministic model math', forecastNote);

      if (analysis.analysisMode === 'asset_manager') {
        assetManagerPack = buildAssetManagerModelPack({
          baseline: normalizeAssetManagerBaseline(analysis.draftedBaseline),
        });
      } else if (analysis.analysisMode === 'directional_only') {
        directionalPack = buildDirectionalModelPack({
          baseline: normalizeDirectionalBaseline(analysis.draftedBaseline),
          directionalModeReason: analysis.directionalModeReason,
        });
      } else {
        modelPack = buildModelPack({
          baseline: normalizeBaseline(analysis.draftedBaseline),
          scenarioAdjustments: {
            base: normalizeScenarioAdjustments(analysis.filingAnalysis?.scenarioAdjustments?.base),
            upside: normalizeScenarioAdjustments(analysis.filingAnalysis?.scenarioAdjustments?.upside),
            downside: normalizeScenarioAdjustments(analysis.filingAnalysis?.scenarioAdjustments?.downside),
          },
        });
      }

      markStage('pack', 'Preparing analysis pack', 'Formatting the final report shell, scenario commentary, and valuation framing.');
      reportPack = applySchemaDefaults(
        await callGeminiJson(
          buildReportFormattingPrompt({
            analysisMode: analysis.analysisMode,
            filingExtraction: analysis.filingExtraction,
            filingAnalysis: {
              ...analysis.filingAnalysis,
              draftedBaseline: analysis.draftedBaseline,
              draftedBaselineMeta: analysis.draftedBaselineMeta,
              directionalModeReason: analysis.directionalModeReason,
            },
            modelSummary: buildModelSummaryForPrompt({
              analysisMode: analysis.analysisMode,
              modelPack,
              assetManagerPack,
              directionalPack,
              directionalModeReason: analysis.directionalModeReason,
            }),
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
        analysisMode: analysis.analysisMode,
      });
    }

    stageTimings[stageTimings.length - 1].durationMs = Date.now() - currentStageStart;

    send('result', buildResult({
      ...analysis,
      reportPack,
      modelPack,
      assetManagerPack,
      directionalPack,
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
  const provisionalArchetype = detectIssuerArchetypeFromDeterministicSignals({ filingSource, deterministicExtraction });
  logFilingSelection(deterministicExtraction?.diagnostics?.filingSelection);
  logDeterministicExtraction(deterministicExtraction);

  markStage?.('extract', 'Extracting filing facts', 'Combining deterministic SEC extraction with filing-aware AI summarization.');
  const filingExtractionAi = applySchemaDefaults(
    await callGeminiJson(
      buildFilingExtractionPrompt({
        filing: buildSourcePacketForPrompt(filingSource, 24_000),
        deterministicPacket: buildPromptPacket(deterministicExtraction),
        issuerArchetype: provisionalArchetype.archetype,
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
    provisionalArchetype,
  });
  const refinedArchetype = refineIssuerArchetype({ provisionalArchetype, filingExtraction, deterministicExtraction, filingSource });

  const routingMode = refinedArchetype?.archetype || provisionalArchetype?.archetype || 'directional_only';
  let modeResult;

  if (routingMode === 'operating_company') {
    markStage?.('frame', 'Drafting baseline and model implications', 'Drafting soft assumptions and commentary around a deterministic-first operating-company baseline.');
    modeResult = await runOperatingCompanyFlow({ filingSource, filingExtraction, deterministicExtraction });
  } else if (routingMode === 'asset_manager') {
    markStage?.('frame', 'Drafting baseline and model implications', 'Drafting anchor-based asset-manager valuation inputs instead of forcing an operating-company template.');
    modeResult = await runAssetManagerFlow({ filingSource, filingExtraction, deterministicExtraction });
  } else {
    markStage?.('frame', 'Drafting baseline and model implications', 'Drafting an honest directional valuation frame for a non-operating-company issuer.');
    modeResult = await runDirectionalFlow({ filingSource, filingExtraction, deterministicExtraction, issuerArchetype: routingMode });
  }

  logBaselineDecision({ draftedBaseline: modeResult.draftedBaseline, draftedBaselineMeta: modeResult.draftedBaselineMeta, analysisStatus: modeResult.analysisStatus, deterministicExtraction });

  return {
    filingSource,
    deterministicExtraction,
    filingExtraction,
    provisionalArchetype,
    refinedArchetype,
    ...modeResult,
  };
}

async function runOperatingCompanyFlow({ filingSource, filingExtraction, deterministicExtraction }) {
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

  const resolvedRunwayGrowth = await resolveAiRunwayGrowth({
    filingAnalysis,
    filingExtraction,
    deterministicExtraction,
  });

  const draftedBaseline = buildDraftedBaseline({ filingExtraction, deterministicExtraction, filingAnalysis, resolvedRunwayGrowth });
  const draftedBaselineMeta = buildDraftedBaselineMeta({
    aiMeta: filingAnalysis?.draftedBaselineMeta,
    filingExtraction,
    deterministicExtraction,
    draftedBaseline,
    filingAnalysis,
  });
  const analysisStatus = evaluateOperatingCompanyReadiness({
    draftedBaseline,
    draftedBaselineMeta,
    normalizedMetrics: filingExtraction?.reportedBase?.normalizedMetrics,
    fieldSources: deterministicExtraction?.fieldSources,
    filingMetadata: mergeFilingMetadata(filingExtraction?.filingMetadata, filingSource.fallbackMetadata),
  });

  return {
    analysisMode: 'operating_company',
    directionalModeReason: '',
    filingAnalysis: {
      ...filingAnalysis,
      analysisMode: 'operating_company',
      resolvedRunwayGrowth,
    },
    draftedBaseline,
    draftedBaselineMeta,
    analysisStatus,
  };
}

async function runAssetManagerFlow({ filingSource, filingExtraction, deterministicExtraction }) {
  const filingAnalysis = applySchemaDefaults(
    await callGeminiJson(
      buildAssetManagerAnalysisPrompt({
        filingExtraction: buildFilingAnalysisInput(filingExtraction),
        deterministicPacket: buildPromptPacket(deterministicExtraction),
      }),
      0.18,
      { timeoutMs: GEMINI_TIMEOUT_MS, label: 'asset manager analysis' }
    ),
    ASSET_MANAGER_ANALYSIS_SCHEMA
  );

  const draftedBaseline = buildAssetManagerBaseline({ filingExtraction, deterministicExtraction, filingAnalysis });
  const draftedBaselineMeta = buildAssetManagerBaselineMeta({
    aiMeta: filingAnalysis?.draftedBaselineMeta,
    filingExtraction,
    deterministicExtraction,
    draftedBaseline,
  });
  const filingMetadata = mergeFilingMetadata(filingExtraction?.filingMetadata, filingSource.fallbackMetadata);
  const analysisStatus = evaluateAssetManagerReadiness({
    draftedBaseline,
    draftedBaselineMeta,
    assetManagerMetrics: filingExtraction?.assetManagerMetrics,
    filingMetadata,
  });

  if (analysisStatus.canRunModel) {
    return {
      analysisMode: 'asset_manager',
      directionalModeReason: '',
      filingAnalysis: { ...filingAnalysis, analysisMode: 'asset_manager' },
      draftedBaseline,
      draftedBaselineMeta,
      analysisStatus,
    };
  }

  const directionalFallback = await runDirectionalFlow({
    filingSource,
    filingExtraction,
    deterministicExtraction,
    issuerArchetype: 'directional_only',
    fallbackReason: 'Asset-manager anchors were too thin for a clean blended anchor pack, so the output falls back to Directional Mode.',
  });

  return {
    ...directionalFallback,
    originalAnalysisMode: 'asset_manager',
  };
}

async function runDirectionalFlow({ filingSource, filingExtraction, deterministicExtraction, issuerArchetype = 'directional_only', fallbackReason = '' }) {
  const filingAnalysis = applySchemaDefaults(
    await callGeminiJson(
      buildDirectionalAnalysisPrompt({
        filingExtraction: buildFilingAnalysisInput(filingExtraction),
        deterministicPacket: buildPromptPacket(deterministicExtraction),
        issuerArchetype,
      }),
      0.16,
      { timeoutMs: GEMINI_TIMEOUT_MS, label: 'directional analysis' }
    ),
    DIRECTIONAL_ANALYSIS_SCHEMA
  );

  const draftedBaseline = buildDirectionalBaseline({ filingExtraction, deterministicExtraction, filingAnalysis });
  const draftedBaselineMeta = buildDirectionalBaselineMeta({
    aiMeta: filingAnalysis?.draftedBaselineMeta,
    filingExtraction,
    deterministicExtraction,
    draftedBaseline,
  });
  const analysisStatus = evaluateDirectionalReadiness({
    draftedBaseline,
    filingMetadata: mergeFilingMetadata(filingExtraction?.filingMetadata, filingSource.fallbackMetadata),
  });

  return {
    analysisMode: 'directional_only',
    directionalModeReason: fallbackReason || filingAnalysis?.directionalModeReason || 'Directional Mode is being used because the filing does not cleanly fit the operating-company DCF lane.',
    filingAnalysis: {
      ...filingAnalysis,
      analysisMode: 'directional_only',
      directionalModeReason: fallbackReason || filingAnalysis?.directionalModeReason || '',
    },
    draftedBaseline,
    draftedBaselineMeta,
    analysisStatus,
  };
}

function mergeFilingExtraction({ filingExtractionAi, deterministicExtraction, filingSource, provisionalArchetype }) {
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

  const mergedAssetManagerMetrics = mergeAssetManagerExtractionMetrics(
    deterministicExtraction?.assetManagerMetrics,
    filingExtractionAi?.assetManagerMetrics
  );

  return {
    ...filingExtractionAi,
    issuerArchetype: filingExtractionAi?.issuerArchetype || provisionalArchetype?.archetype || null,
    analysisMode: filingExtractionAi?.analysisMode || provisionalArchetype?.archetype || null,
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
    assetManagerMetrics: mergedAssetManagerMetrics,
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

function mergeAssetManagerExtractionMetrics(deterministicMetrics = {}, aiMetrics = {}) {
  const keys = new Set([...Object.keys(deterministicMetrics || {}), ...Object.keys(aiMetrics || {})]);
  return Object.fromEntries([...keys].map((key) => {
    const deterministicValue = deterministicMetrics?.[key];
    const aiValue = aiMetrics?.[key];
    if (Number.isFinite(deterministicValue?.value)) return [key, deterministicValue];
    if (Number.isFinite(aiValue?.value)) return [key, aiValue];
    return [key, deterministicValue || aiValue || { value: null, classification: 'review_required', evidence: '', confidence: 'low' }];
  }));
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

function buildDraftedBaseline({ filingExtraction, deterministicExtraction, filingAnalysis, resolvedRunwayGrowth }) {
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
    aiRunwayGrowth: resolvedRunwayGrowth?.currentRunwayGrowthPct,
    aiRunwayMeta: resolvedRunwayGrowth,
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
      rawAiRunwayGrowthPct: revenueGrowthProfile.signals?.rawAiRunwayGrowthPct ?? null,
      fallbackAiRunwayGrowthPct: revenueGrowthProfile.signals?.fallbackAiRunwayGrowthPct ?? null,
      rawAiRunwayMeta: revenueGrowthProfile.signals?.rawAiRunwayMeta ?? null,
      selectedAiRunwayGrowthPct: revenueGrowthProfile.signals?.selectedAiRunwayGrowthPct ?? null,
      normalizedAiRunwayGrowthPct: revenueGrowthProfile.signals?.selectedAiRunwayGrowthPct ?? null,
      usedAiRunwayForYearOne: Boolean(revenueGrowthProfile.signals?.usedAiRunwayForYearOne),
      aiRunwayRejectedReason: revenueGrowthProfile.signals?.aiRunwayRejectedReason || '',
      yearOneSource: revenueGrowthProfile.signals?.yearOneSource || revenueGrowthProfile.source,
      heuristicMeta: {
        revenueGrowth: revenueGrowthProfile.meta,
        ...softAssumptions.meta,
      },
    },
  };
}

function buildDraftedBaselineMeta({ aiMeta, filingExtraction, deterministicExtraction, draftedBaseline, filingAnalysis }) {
  const meta = applySchemaDefaults(aiMeta || {}, OPCO_BASELINE_META_SCHEMA);
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

function buildAssetManagerBaseline({ filingExtraction, deterministicExtraction, filingAnalysis }) {
  const aiDraft = filingAnalysis?.draftedBaseline || {};
  const assetMetrics = filingExtraction?.assetManagerMetrics || deterministicExtraction?.assetManagerMetrics || {};
  const reportedBase = filingExtraction?.reportedBase?.normalizedMetrics || {};
  const cash = chooseAssetMetricValue(assetMetrics.cash, aiDraft.cash, reportedBase.cash);
  const debt = chooseAssetMetricValue(assetMetrics.debt, aiDraft.debt, reportedBase.debt);
  const netDebt = chooseAssetMetricValue(assetMetrics.netDebt, aiDraft.netDebt, Number.isFinite(cash) && Number.isFinite(debt) ? debt - cash : reportedBase.netDebt);
  const shareCount = firstFiniteNumber(reportedBase.shareCount, assetMetrics.shareCount?.value, coerceFiniteNumber(aiDraft.shareCount));

  return {
    companyName: filingExtraction?.filingMetadata?.company || aiDraft.companyName || '',
    unitLabel: '$mm',
    aum: chooseAssetMetricValue(assetMetrics.aum, aiDraft.aum),
    feeRelatedEarnings: chooseAssetMetricValue(assetMetrics.feeRelatedEarnings, aiDraft.feeRelatedEarnings),
    distributableEarnings: chooseAssetMetricValue(assetMetrics.distributableEarnings, aiDraft.distributableEarnings),
    managementFees: chooseAssetMetricValue(assetMetrics.managementFees, aiDraft.managementFees),
    performanceIncome: chooseAssetMetricValue(assetMetrics.performanceIncome, aiDraft.performanceIncome),
    bookValue: chooseAssetMetricValue(assetMetrics.bookValue, aiDraft.bookValue),
    balanceSheetInvestments: chooseAssetMetricValue(assetMetrics.balanceSheetInvestments, aiDraft.balanceSheetInvestments),
    shareCount,
    cash,
    debt,
    netDebt,
  };
}

function buildAssetManagerBaselineMeta({ aiMeta, filingExtraction, deterministicExtraction, draftedBaseline }) {
  const assetMetrics = filingExtraction?.assetManagerMetrics || deterministicExtraction?.assetManagerMetrics || {};
  const fields = ['companyName', 'aum', 'feeRelatedEarnings', 'distributableEarnings', 'managementFees', 'performanceIncome', 'bookValue', 'balanceSheetInvestments', 'shareCount', 'cash', 'debt', 'netDebt'];
  return buildModeBaselineMeta({
    fields,
    schema: ASSET_MANAGER_BASELINE_META_SCHEMA,
    aiMeta,
    draftedBaseline,
    metricMap: assetMetrics,
    companyEvidence: filingExtraction?.filingMetadata?.company,
  });
}

function buildDirectionalBaseline({ filingExtraction, deterministicExtraction, filingAnalysis }) {
  const aiDraft = filingAnalysis?.draftedBaseline || {};
  const assetMetrics = filingExtraction?.assetManagerMetrics || deterministicExtraction?.assetManagerMetrics || {};
  const reportedBase = filingExtraction?.reportedBase?.normalizedMetrics || {};
  const shareCount = firstFiniteNumber(reportedBase.shareCount, assetMetrics.shareCount?.value, coerceFiniteNumber(aiDraft.shareCount));
  const bookValue = chooseAssetMetricValue(assetMetrics.bookValue, aiDraft.bookValue);
  const earningsLikeAnchor = firstFiniteNumber(
    coerceFiniteNumber(aiDraft.earningsLikeAnchor),
    assetMetrics.distributableEarnings?.value,
    assetMetrics.feeRelatedEarnings?.value,
    inferDirectionalAnchorFromNarrative(filingExtraction)
  );
  const cash = chooseAssetMetricValue(assetMetrics.cash, aiDraft.cash, reportedBase.cash);
  const debt = chooseAssetMetricValue(assetMetrics.debt, aiDraft.debt, reportedBase.debt);
  const netDebt = chooseAssetMetricValue(assetMetrics.netDebt, aiDraft.netDebt, Number.isFinite(cash) && Number.isFinite(debt) ? debt - cash : reportedBase.netDebt);

  return {
    companyName: filingExtraction?.filingMetadata?.company || aiDraft.companyName || '',
    unitLabel: '$mm',
    shareCount,
    bookValue,
    earningsLikeAnchor,
    cash,
    debt,
    netDebt,
    anchorLabel: aiDraft.anchorLabel || inferDirectionalAnchorLabel(filingExtraction),
  };
}

function buildDirectionalBaselineMeta({ aiMeta, filingExtraction, deterministicExtraction, draftedBaseline }) {
  const assetMetrics = filingExtraction?.assetManagerMetrics || deterministicExtraction?.assetManagerMetrics || {};
  const fields = ['companyName', 'shareCount', 'bookValue', 'earningsLikeAnchor', 'cash', 'debt', 'netDebt', 'anchorLabel'];
  return buildModeBaselineMeta({
    fields,
    schema: DIRECTIONAL_BASELINE_META_SCHEMA,
    aiMeta,
    draftedBaseline,
    metricMap: {
      ...assetMetrics,
      earningsLikeAnchor: numberToMetaDetail(draftedBaseline?.earningsLikeAnchor, draftedBaseline?.anchorLabel || 'Narrative earnings-like anchor'),
      anchorLabel: { value: draftedBaseline?.anchorLabel, classification: draftedBaseline?.anchorLabel ? 'derived' : 'review_required', evidence: draftedBaseline?.anchorLabel || '', confidence: draftedBaseline?.anchorLabel ? 'medium' : 'low' },
    },
    companyEvidence: filingExtraction?.filingMetadata?.company,
  });
}

function buildModeBaselineMeta({ fields, schema = OPCO_BASELINE_META_SCHEMA, aiMeta, draftedBaseline, metricMap = {}, companyEvidence = '' }) {
  const meta = applySchemaDefaults(aiMeta || {}, schema);
  fields.forEach((field) => {
    if (field === 'companyName') {
      meta[field] = {
        classification: draftedBaseline?.companyName ? 'reported' : 'review_required',
        rationale: draftedBaseline?.companyName ? 'Company name comes directly from filing metadata.' : 'Company name was not resolved from filing metadata.',
        evidence: companyEvidence || draftedBaseline?.companyName || '',
        confidence: draftedBaseline?.companyName ? 'high' : 'low',
      };
      return;
    }

    const metric = metricMap?.[field];
    if (metric && (Number.isFinite(metric.value) || (typeof metric.value === 'string' && metric.value))) {
      meta[field] = {
        classification: metric.classification || 'derived',
        rationale: metric.classification === 'reported' ? 'Direct filing-supported metric.' : 'Filing-supported metric requiring some normalization or framing.',
        evidence: metric.evidence || '',
        confidence: metric.confidence || 'medium',
      };
      return;
    }

    if (Number.isFinite(draftedBaseline?.[field]) || (typeof draftedBaseline?.[field] === 'string' && draftedBaseline?.[field])) {
      meta[field] = {
        classification: 'proposed',
        rationale: `No deterministic value was available for ${field}, so the analysis-layer fallback is retained with explicit review context.`,
        evidence: meta[field]?.evidence || 'AI analysis fallback.',
        confidence: meta[field]?.confidence || 'low',
      };
      return;
    }

    meta[field] = {
      classification: 'review_required',
      rationale: `No reliable value is available for ${field}.`,
      evidence: meta[field]?.evidence || 'Value unresolved.',
      confidence: 'low',
    };
  });
  return meta;
}

function numberToMetaDetail(value, evidence = '') {
  return {
    value: Number.isFinite(value) ? value : null,
    classification: Number.isFinite(value) ? 'derived' : 'review_required',
    evidence,
    confidence: Number.isFinite(value) ? 'low' : 'low',
  };
}

function chooseAssetMetricValue(metric, ...fallbacks) {
  if (Number.isFinite(metric?.value)) return metric.value;
  return firstFiniteNumber(...fallbacks);
}

function coerceFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function inferDirectionalAnchorFromNarrative(filingExtraction) {
  const text = JSON.stringify([
    ...(filingExtraction?.reportedBase?.reportedFacts || []),
    ...(filingExtraction?.derivedMetrics || []),
    ...(filingExtraction?.keyTakeaways || []),
  ]);
  const patterns = [
    /net interest income[^\n]{0,120}/ig,
    /earnings available to common[^\n]{0,120}/ig,
    /net income[^\n]{0,120}/ig,
    /distributable earnings[^\n]{0,120}/ig,
    /\bFFO\b[^\n]{0,120}/ig,
    /\bAFFO\b[^\n]{0,120}/ig,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    for (const match of matches) {
      const scaledMatch = [...match.matchAll(/(\(?-?\$?\d[\d,.]*(?:\.\d+)?\)?)(?=\s*(trillion|billion|million|thousand))/ig)].at(-1)?.[1] || null;
      const candidate = scaledMatch || [...match.matchAll(/\(?-?\$?\d[\d,.]*(?:\.\d+)?\)?/g)].map((entry) => entry[0]).find(Boolean);
      if (!candidate) continue;
      const numeric = Number(String(candidate).replace(/[()$,]/g, '').replace(/,/g, ''));
      if (!Number.isFinite(numeric)) continue;
      if (/trillion/i.test(match)) return numeric * 1_000_000;
      if (/billion/i.test(match)) return numeric * 1000;
      if (/million/i.test(match)) return numeric;
      if (/thousand/i.test(match) || /\|/.test(match)) return numeric / 1000;
      if (Math.abs(numeric) > 100_000) return numeric / 1_000_000;
      if (Math.abs(numeric) > 31) return numeric;
    }
  }

  return null;
}

function inferDirectionalAnchorLabel(filingExtraction) {
  const text = JSON.stringify([
    ...(filingExtraction?.reportedBase?.reportedFacts || []),
    ...(filingExtraction?.derivedMetrics || []),
    ...(filingExtraction?.keyTakeaways || []),
  ]);
  if (/net interest income/i.test(text)) return 'Net interest income';
  if (/FFO/i.test(text)) return 'FFO';
  if (/AFFO/i.test(text)) return 'AFFO';
  if (/distributable earnings/i.test(text)) return 'Distributable earnings';
  if (/net income/i.test(text)) return 'Net income';
  return 'Earnings-like anchor';
}

function buildReviewPacket({ filingSource, filingExtraction, draftedBaseline, draftedBaselineMeta, deterministicExtraction, analysisStatus, analysisMode, provisionalArchetype, refinedArchetype, directionalModeReason }) {
  return {
    generatedAt: new Date().toISOString(),
    analysisMode,
    directionalModeReason,
    provisionalArchetype,
    refinedArchetype,
    filingMetadata: mergeFilingMetadata(filingExtraction?.filingMetadata, filingSource.fallbackMetadata),
    filingSelection: deterministicExtraction?.diagnostics?.filingSelection || deterministicExtraction?.filingSelection || null,
    analysisStatus,
    sources: { filing: summarizeSource(filingSource) },
    businessOverview: filingExtraction?.businessOverview || { summary: '', businessLines: [], segmentNotes: [], geographyNotes: [] },
    reportedBase: filingExtraction?.reportedBase || { summary: '', reportedFacts: [], normalizedMetrics: {} },
    assetManagerMetrics: filingExtraction?.assetManagerMetrics || deterministicExtraction?.assetManagerMetrics || {},
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

function buildModelSummaryForPrompt({ analysisMode, modelPack, assetManagerPack, directionalPack, directionalModeReason }) {
  const activePack = analysisMode === 'asset_manager' ? assetManagerPack : analysisMode === 'directional_only' ? directionalPack : modelPack;
  if (!activePack) return { analysisMode, directionalModeReason };

  return {
    analysisMode,
    years: activePack.years || YEAR_LABELS,
    comparison: activePack.comparison || [],
    valuationSummary: activePack.valuationSummary || {},
    baseValuation: activePack.scenarios?.base?.valuation || null,
    upsideValuation: activePack.scenarios?.upside?.valuation || null,
    downsideValuation: activePack.scenarios?.downside?.valuation || null,
    valuationBridge: activePack.valuationBridge || activePack.anchorWeights || [],
    anchorSnapshot: activePack.anchorSnapshot || [],
    directionalModeReason,
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
  analysisMode,
  directionalModeReason,
  provisionalArchetype,
  refinedArchetype,
  reportPack,
  modelPack,
  assetManagerPack,
  directionalPack,
  stageTimings,
  model,
}) {
  return {
    generatedAt: new Date().toISOString(),
    model,
    analysisMode,
    directionalModeReason,
    provisionalArchetype,
    refinedArchetype,
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
    assetManagerMetrics: filingExtraction?.assetManagerMetrics || deterministicExtraction?.assetManagerMetrics || {},
    derivedMetrics: filingExtraction?.derivedMetrics || [],
    proposedAssumptions: filingAnalysis?.proposedAssumptions || [],
    assumptionReview: filingAnalysis?.assumptionReview || [],
    scenarioWriteups: reportPack?.scenarioWriteups || {},
    modelPack,
    assetManagerPack,
    directionalPack,
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
  const normalizedAiRunway = normalizeAiRunwayGrowth(aiRunwayGrowth, aiRunwayMeta);
  const selectedAiRunway = Number.isFinite(normalizedAiRunway.value) ? round1(normalizedAiRunway.value) : null;
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
    ? (aiRunwayMeta?.selectedSource || 'ai_runway_priority')
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
      rawAiRunwayGrowthPct: aiRunwayMeta?.rawAiRunwayGrowthPct ?? null,
      fallbackAiRunwayGrowthPct: aiRunwayMeta?.fallbackAiRunwayGrowthPct ?? null,
      rawAiRunwayMeta: aiRunwayMeta?.selectedRawMeta ?? aiRunwayMeta?.rawAiRunwayMeta ?? aiRunwayMeta?.rawFallbackAiRunwayMeta ?? null,
      selectedAiRunwayGrowthPct: selectedAiRunway,
      normalizedAiRunwayGrowthPct: selectedAiRunway,
      usedAiRunwayForYearOne: Number.isFinite(normalizedAiRunway.value),
      aiRunwayRejectedReason: normalizedAiRunway.rejectedReason || '',
      yearOneSource: aiRunwayMeta?.selectedSource || (Number.isFinite(normalizedAiRunway.value) ? 'ai_runway_priority' : 'heuristic'),
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

async function resolveAiRunwayGrowth({ filingAnalysis, filingExtraction, deterministicExtraction }) {
  const primaryRawValue = filingAnalysis?.currentRunwayGrowthPct;
  const primaryRawMeta = filingAnalysis?.currentRunwayGrowthMeta || null;
  const primaryCoerced = coerceRunwayGrowthFromText([primaryRawValue, primaryRawMeta?.rationale, primaryRawMeta?.evidence]);
  const primaryNormalized = normalizeAiRunwayGrowth(
    Number.isFinite(Number(primaryRawValue)) ? primaryRawValue : primaryCoerced.value,
    {
      source: Number.isFinite(Number(primaryRawValue)) ? 'filing_analysis' : 'filing_analysis_coerced',
      basis: Number.isFinite(Number(primaryRawValue)) ? 'primary_field' : 'primary_text_coercion',
      confidence: primaryRawMeta?.confidence || 'medium',
      evidence: primaryRawMeta?.evidence || '',
      rationale: primaryRawMeta?.rationale || '',
    }
  );

  const firstFallback = await requestRunwayGrowth({ filingExtraction, deterministicExtraction, retry: false });
  let secondFallback = null;
  let firstFallbackNormalized = normalizeAiRunwayGrowth(firstFallback?.currentRunwayGrowthPct, {
    source: 'runway_growth_fallback',
    basis: 'fallback_call',
    confidence: firstFallback?.confidence || 'medium',
    evidence: firstFallback?.evidence || '',
    rationale: firstFallback?.rationale || '',
  });

  if (!Number.isFinite(firstFallbackNormalized.value)) {
    secondFallback = await requestRunwayGrowth({ filingExtraction, deterministicExtraction, retry: true });
    firstFallbackNormalized = normalizeAiRunwayGrowth(secondFallback?.currentRunwayGrowthPct, {
      source: 'runway_growth_fallback_retry',
      basis: 'fallback_retry_call',
      confidence: secondFallback?.confidence || 'medium',
      evidence: secondFallback?.evidence || '',
      rationale: secondFallback?.rationale || '',
    });
  }

  const fallbackPayload = secondFallback || firstFallback;
  const fallbackCoerced = coerceRunwayGrowthFromText([
    fallbackPayload?.currentRunwayGrowthPct,
    fallbackPayload?.rationale,
    fallbackPayload?.evidence,
  ]);
  const fallbackCoercedNormalized = normalizeAiRunwayGrowth(fallbackCoerced.value, {
    source: 'runway_growth_fallback_coerced',
    basis: 'fallback_text_coercion',
    confidence: fallbackPayload?.confidence || 'medium',
    evidence: fallbackPayload?.evidence || '',
    rationale: fallbackPayload?.rationale || '',
  });

  const selected = [
    { key: 'dedicated_fallback_ai', normalized: firstFallbackNormalized, payload: fallbackPayload },
    { key: 'filing_analysis_ai', normalized: normalizeAiRunwayGrowth(primaryRawValue, { source: 'filing_analysis', basis: 'primary_field', confidence: primaryRawMeta?.confidence || 'medium', evidence: primaryRawMeta?.evidence || '', rationale: primaryRawMeta?.rationale || '' }), payload: { rationale: primaryRawMeta?.rationale || '', evidence: primaryRawMeta?.evidence || '', confidence: primaryRawMeta?.confidence || 'medium' } },
    { key: 'dedicated_fallback_coerced', normalized: fallbackCoercedNormalized, payload: fallbackPayload },
    { key: 'filing_analysis_coerced', normalized: primaryNormalized, payload: { rationale: primaryRawMeta?.rationale || '', evidence: primaryRawMeta?.evidence || '', confidence: primaryRawMeta?.confidence || 'medium' } },
  ].find((entry) => Number.isFinite(entry.normalized.value));

  return {
    currentRunwayGrowthPct: selected?.normalized?.value ?? null,
    rationale: selected?.payload?.rationale || '',
    evidence: selected?.payload?.evidence || '',
    confidence: selected?.payload?.confidence || 'medium',
    classification: 'proposed',
    source: selected?.key || 'heuristic_fallback_required',
    selectedSource: selected?.key || 'heuristic',
    selectedRawMeta: selected?.payload || null,
    basis: selected?.normalized?.meta?.basis || 'no_numeric_ai_runway',
    rawAiRunwayGrowthPct: primaryRawValue ?? null,
    rawAiRunwayMeta: primaryRawMeta,
    fallbackAiRunwayGrowthPct: fallbackPayload?.currentRunwayGrowthPct ?? fallbackCoerced.value ?? null,
    rawFallbackAiRunwayMeta: fallbackPayload ? {
      rationale: fallbackPayload?.rationale || '',
      evidence: fallbackPayload?.evidence || '',
      confidence: fallbackPayload?.confidence || 'medium',
    } : null,
    normalizedAiRunwayGrowthPct: selected?.normalized?.value ?? null,
    usedAiRunwayForYearOne: Boolean(selected),
    aiRunwayRejectedReason: selected
      ? ''
      : `Primary AI runway rejected: ${primaryNormalized.rejectedReason} Fallback AI runway rejected: ${firstFallbackNormalized.rejectedReason} Coerced fallback rejected: ${fallbackCoercedNormalized.rejectedReason}`.trim(),
  };
}

async function requestRunwayGrowth({ filingExtraction, deterministicExtraction, retry = false }) {
  return applySchemaDefaults(
    await callGeminiJson(
      buildRunwayGrowthPrompt({
        filingExtraction: buildFilingAnalysisInput(filingExtraction),
        deterministicPacket: buildPromptPacket(deterministicExtraction),
        retry,
      }),
      retry ? 0 : 0.1,
      { timeoutMs: GEMINI_TIMEOUT_MS, label: retry ? 'runway growth fallback retry' : 'runway growth fallback' }
    ),
    RUNWAY_GROWTH_SCHEMA
  );
}

function coerceRunwayGrowthFromText(values = []) {
  const text = values.filter((value) => value !== null && value !== undefined).map((value) => String(value)).join(' ');
  const matches = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*%?/g)];
  for (const match of matches) {
    const numeric = Number(match[1]);
    if (Number.isFinite(numeric) && numeric >= -15 && numeric <= 40) {
      return { value: numeric, sourceText: match[0] };
    }
  }
  return { value: null, sourceText: '' };
}

function normalizeAiRunwayGrowth(value, meta = {}) {
  if (value === null || value === undefined) {
    return {
      value: null,
      meta: null,
      rejectedReason: 'AI runway growth was null or undefined.',
    };
  }
  if (typeof value === 'number' && Number.isNaN(value)) {
    return {
      value: null,
      meta: null,
      rejectedReason: 'AI runway growth was NaN.',
    };
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return {
      value: null,
      meta: null,
      rejectedReason: typeof value === 'string' && value.trim() !== ''
        ? `AI runway growth was non-numeric: ${value}`
        : 'AI runway growth was non-numeric.',
    };
  }
  return { value: numeric, meta, rejectedReason: '' };
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
    issuerArchetype: filingExtraction?.issuerArchetype || null,
    analysisMode: filingExtraction?.analysisMode || null,
    filingMetadata: filingExtraction?.filingMetadata || null,
    businessOverview: filingExtraction?.businessOverview || null,
    reportedBase: {
      summary: filingExtraction?.reportedBase?.summary || '',
      normalizedMetrics: filingExtraction?.reportedBase?.normalizedMetrics || {},
      reportedFacts: (filingExtraction?.reportedBase?.reportedFacts || []).slice(0, 12),
    },
    assetManagerMetrics: filingExtraction?.assetManagerMetrics || {},
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
