import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import {
  buildModelPack,
  DEFAULT_BASELINE,
  normalizeBaseline,
  normalizeScenarioAdjustments,
  YEAR_LABELS,
} from './modeling.js';
import { buildSourcePacketForPrompt, ingestSource, summarizeSource } from './sourceNormalization.js';
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
} from './schemas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distPath = path.join(projectRoot, 'dist');

const app = express();
const port = Number(process.env.PORT || 8787);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

app.use(cors());
app.use(express.json({ limit: '6mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    model: GEMINI_MODEL,
    configured: Boolean(GEMINI_API_KEY),
  });
});

app.post('/api/review-filing', async (req, res) => {
  try {
    ensureApiKey();
    const { filing, baseline } = req.body ?? {};
    if (!filing) throw new Error('A 10-Q or 10-K input is required.');

    const analystBaseline = normalizeBaseline(baseline || {});
    const { filingSource, filingExtraction, baselineSuggested } = await extractFilingReview({ filing, baseline: analystBaseline });

    res.json(
      buildReviewPacket({
        filingSource,
        filingExtraction,
        baselineInput: analystBaseline,
        baselineSuggested,
      })
    );
  } catch (error) {
    res.status(400).json({
      message: error.message || 'Could not review the filing.',
    });
  }
});

app.post('/api/process', async (req, res) => {
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

    const { filing, baseline } = req.body ?? {};
    if (!filing) {
      throw new Error('A 10-Q or 10-K input is required.');
    }

    const analystBaseline = normalizeBaseline(baseline || {});

    markStage('ingest', 'Ingesting filing', 'Fetching or normalizing the 10-Q or 10-K text.');
    const filingSource = await ingestSource(
      {
        ...filing,
        kind: 'filing',
        label: 'Filing',
      },
      { required: true, minChars: 700 }
    );

    markStage('extract', 'Extracting filing facts', 'Identifying filing metadata, reported base metrics, and disclosure-driven takeaways.');
    const filingExtraction = applySchemaDefaults(
      await callGeminiJson(
        buildFilingExtractionPrompt({
          filing: buildSourcePacketForPrompt(filingSource, 24_000),
          baseline: analystBaseline,
        }),
        0.1
      ),
      FILING_EXTRACTION_SCHEMA
    );

    const baselineUsed = mergeBaselineWithReportedBase(analystBaseline, filingExtraction);

    markStage('frame', 'Drafting assumptions and model implications', 'Converting filing disclosures into a reported base, proposed assumptions, scenario setup, and valuation framing.');
    const filingAnalysis = applySchemaDefaults(
      await callGeminiJson(
        buildFilingAnalysisPrompt({
          filingExtraction,
          baseline: baselineUsed,
        }),
        0.18
      ),
      FILING_ANALYSIS_SCHEMA
    );

    markStage('forecast', 'Running deterministic model math', 'Rolling the filing-grounded setup through code-driven forecast and valuation logic.');
    const modelPack = buildModelPack({
      baseline: baselineUsed,
      scenarioAdjustments: {
        base: normalizeScenarioAdjustments(filingAnalysis?.scenarioAdjustments?.base),
        upside: normalizeScenarioAdjustments(filingAnalysis?.scenarioAdjustments?.upside),
        downside: normalizeScenarioAdjustments(filingAnalysis?.scenarioAdjustments?.downside),
      },
    });

    markStage('pack', 'Preparing analysis pack', 'Formatting the final report shell, scenario commentary, and valuation summary.');
    const reportPack = applySchemaDefaults(
      await callGeminiJson(
        buildReportFormattingPrompt({
          filingExtraction,
          filingAnalysis,
          modelSummary: buildModelSummaryForPrompt(modelPack),
        }),
        0.2
      ),
      REPORT_PACK_SCHEMA
    );

    stageTimings[stageTimings.length - 1].durationMs = Date.now() - currentStageStart;

    send(
      'result',
      buildResult({
        filingSource,
        filingExtraction,
        filingAnalysis,
        reportPack,
        modelPack,
        stageTimings,
        model: GEMINI_MODEL,
        baselineInput: analystBaseline,
        baselineUsed,
      })
    );
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

app.listen(port, () => {
  console.log(`Filing Model Workbench server listening on http://localhost:${port}`);
});

function ensureApiKey() {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    throw new Error('Missing GEMINI_API_KEY. Add it to your .env before generating a filing analysis pack.');
  }
}

async function extractFilingReview({ filing, baseline }) {
  const filingSource = await ingestSource(
    {
      ...filing,
      kind: 'filing',
      label: 'Filing',
    },
    { required: true, minChars: 700 }
  );

  const filingExtraction = applySchemaDefaults(
    await callGeminiJson(
      buildFilingExtractionPrompt({
        filing: buildSourcePacketForPrompt(filingSource, 24_000),
        baseline,
      }),
      0.1
    ),
    FILING_EXTRACTION_SCHEMA
  );

  return {
    filingSource,
    filingExtraction,
    baselineSuggested: mergeBaselineWithReportedBase(baseline, filingExtraction),
  };
}

function buildReviewPacket({ filingSource, filingExtraction, baselineInput, baselineSuggested }) {
  return {
    generatedAt: new Date().toISOString(),
    filingMetadata: filingExtraction?.filingMetadata || filingSource.fallbackMetadata,
    sources: {
      filing: summarizeSource(filingSource),
    },
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
    missingBaseInputs: filingExtraction?.missingBaseInputs || [],
    baselineInput,
    baselineSuggested,
  };
}

function mergeBaselineWithReportedBase(baseline, filingExtraction) {
  const metrics = filingExtraction?.reportedBase?.normalizedMetrics || {};
  const reportedFacts = filingExtraction?.reportedBase?.reportedFacts || [];
  const filingType = filingExtraction?.filingMetadata?.filingType || null;
  const merged = { ...baseline };

  const normalizedRevenue = Number.isFinite(metrics.revenueLtm)
    ? metrics.revenueLtm
    : inferRevenueBaseFromFacts(reportedFacts, filingType);
  const normalizedShareCount = normalizeShareCount(metrics.shareCount);
  const normalizedNetDebt = normalizeNetDebt(metrics);

  if (!merged.companyName && filingExtraction?.filingMetadata?.company) merged.companyName = filingExtraction.filingMetadata.company;
  if (merged.currentRevenue === DEFAULT_BASELINE.currentRevenue && Number.isFinite(normalizedRevenue)) merged.currentRevenue = normalizedRevenue;
  if (merged.shareCount === DEFAULT_BASELINE.shareCount && Number.isFinite(normalizedShareCount)) merged.shareCount = normalizedShareCount;
  if (merged.netDebt === DEFAULT_BASELINE.netDebt && Number.isFinite(normalizedNetDebt)) merged.netDebt = normalizedNetDebt;
  if (merged.taxRate === DEFAULT_BASELINE.taxRate && Number.isFinite(metrics.taxRatePct)) merged.taxRate = metrics.taxRatePct;
  if (merged.grossMarginStart === DEFAULT_BASELINE.grossMarginStart && Number.isFinite(metrics.grossMarginPct)) {
    merged.grossMarginStart = metrics.grossMarginPct;
  }
  if (merged.operatingMarginStart === DEFAULT_BASELINE.operatingMarginStart && Number.isFinite(metrics.operatingMarginPct)) {
    merged.operatingMarginStart = metrics.operatingMarginPct;
  }
  if (merged.capexPct === DEFAULT_BASELINE.capexPct && Number.isFinite(metrics.capexPctRevenue)) merged.capexPct = metrics.capexPctRevenue;
  if (merged.daPct === DEFAULT_BASELINE.daPct && Number.isFinite(metrics.daPctRevenue)) merged.daPct = metrics.daPctRevenue;

  if (merged.grossMarginEnd === DEFAULT_BASELINE.grossMarginEnd && merged.grossMarginStart > merged.grossMarginEnd) {
    merged.grossMarginEnd = merged.grossMarginStart;
  }
  if (merged.operatingMarginEnd === DEFAULT_BASELINE.operatingMarginEnd && merged.operatingMarginStart > merged.operatingMarginEnd) {
    merged.operatingMarginEnd = merged.operatingMarginStart;
  }

  return normalizeBaseline(merged);
}

function inferRevenueBaseFromFacts(reportedFacts, filingType) {
  const revenueFact = reportedFacts.find((fact) => /total net sales|net sales|total revenue|revenue/i.test(fact.metric || ''));
  const parsedValue = parseNumericValue(revenueFact?.valueText);
  if (!Number.isFinite(parsedValue)) return null;
  return filingType === '10-Q' ? parsedValue * 4 : parsedValue;
}

function normalizeShareCount(value) {
  if (!Number.isFinite(value)) return null;
  if (value > 1_000_000) return value / 1_000_000;
  return value;
}

function normalizeNetDebt(metrics) {
  if (Number.isFinite(metrics.debt) && Number.isFinite(metrics.cash)) {
    return metrics.debt - metrics.cash;
  }
  if (Number.isFinite(metrics.netDebt)) return metrics.netDebt;
  return null;
}

function parseNumericValue(valueText) {
  if (!valueText) return null;
  const match = String(valueText).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
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
  filingExtraction,
  filingAnalysis,
  reportPack,
  modelPack,
  stageTimings,
  model,
  baselineInput,
  baselineUsed,
}) {
  return {
    generatedAt: new Date().toISOString(),
    model,
    filingMetadata: filingExtraction?.filingMetadata || filingSource.fallbackMetadata,
    sources: {
      filing: summarizeSource(filingSource),
    },
    baselineInput,
    baselineUsed,
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
    reviewFlags: [...(filingExtraction?.reviewFlags || []), ...(filingAnalysis?.reviewFlags || [])],
    checklist: filingAnalysis?.checklist || [],
    confidenceMap: {
      extraction: filingExtraction?.confidenceMap || {},
      analysis: filingAnalysis?.confidenceMap || {},
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

async function callGeminiJson(prompt, temperature = 0.2) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Gemini returned invalid JSON.');
  }
}
