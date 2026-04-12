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
import {
  buildSourcePacketForPrompt,
  buildSupportingPacketForPrompt,
  ingestSource,
  ingestSupportingSources,
  summarizeSource,
} from './sourceNormalization.js';
import {
  buildFilingExtractionPrompt,
  buildIntegratedUpdatePrompt,
  buildReportFormattingPrompt,
  buildTranscriptDeltaPrompt,
} from './promptSchemas.js';

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
    if (!GEMINI_API_KEY) {
      throw new Error('Missing GEMINI_API_KEY. Add it to your .env before generating a model update pack.');
    }

    const { filing, transcript, supportingMaterials = [], baseline } = req.body ?? {};
    if (!filing) {
      throw new Error('A latest 10-Q or 10-K input is required.');
    }

    const analystBaseline = normalizeBaseline(baseline || {});

    markStage('filing', 'Ingesting filing', 'Fetching or normalizing the latest 10-Q or 10-K');
    const filingSource = await ingestSource(
      {
        ...filing,
        kind: 'filing',
        label: 'Filing',
      },
      { required: true, minChars: 700 }
    );

    markStage('support', 'Ingesting supporting materials', 'Adding optional release, deck, letter, or management commentary where provided');
    const supportSources = await ingestSupportingSources(
      Array.isArray(supportingMaterials)
        ? supportingMaterials.map((item) => ({
            ...item,
            kind: item.kind || 'supporting_material',
            label: materialLabel(item.kind || 'supporting_material'),
          }))
        : []
    );

    markStage('reported', 'Extracting filing-grounded base', 'Identifying reported facts, disclosed constraints, and missing base inputs');
    const filingExtraction = await callGeminiJson(
      buildFilingExtractionPrompt({
        filing: buildSourcePacketForPrompt(filingSource, 20_000),
        supportingMaterials: buildSupportingPacketForPrompt(supportSources),
        baseline: analystBaseline,
      }),
      0.1
    );

    const baselineUsed = mergeBaselineWithReportedBase(analystBaseline, filingExtraction);

    let transcriptSource = null;
    let transcriptDelta = buildTranscriptSkippedResult();

    markStage(
      'delta',
      'Assessing transcript delta',
      transcript && hasInputContent(transcript)
        ? 'Comparing management commentary against the filing-grounded base'
        : 'No transcript supplied. Forward read-through will rely on filing and supporting materials.'
    );

    if (transcript && hasInputContent(transcript)) {
      transcriptSource = await ingestSource(
        {
          ...transcript,
          kind: 'transcript',
          label: 'Transcript',
        },
        { required: false }
      );

      if (transcriptSource?.cleanedText?.length >= 900) {
        transcriptDelta = await callGeminiJson(
          buildTranscriptDeltaPrompt({
            filingExtraction,
            transcript: buildSourcePacketForPrompt(transcriptSource, 16_000),
            supportingMaterials: buildSupportingPacketForPrompt(supportSources),
          }),
          0.15
        );
      }
    }

    markStage('integrate', 'Integrating filing, call, and support materials', 'Building a reviewable estimate revision layer against the prior baseline');
    const integratedUpdate = await callGeminiJson(
      buildIntegratedUpdatePrompt({
        filingExtraction,
        transcriptDelta,
        supportingMaterials: buildSupportingPacketForPrompt(supportSources),
        baseline: baselineUsed,
      }),
      0.2
    );

    markStage('forecast', 'Running deterministic scenario forecast', 'Rolling the revised assumptions through inspectable code-driven model math');
    const modelPack = buildModelPack({
      baseline: baselineUsed,
      scenarioAdjustments: {
        base: normalizeScenarioAdjustments(integratedUpdate?.scenarioAdjustments?.base),
        upside: normalizeScenarioAdjustments(integratedUpdate?.scenarioAdjustments?.upside),
        downside: normalizeScenarioAdjustments(integratedUpdate?.scenarioAdjustments?.downside),
      },
    });

    markStage('valuation', 'Running valuation bridge and sensitivities', 'Computing scenario valuation, bridge impacts, and sensitivity framing');
    const reportPack = await callGeminiJson(
      buildReportFormattingPrompt({
        filingExtraction,
        transcriptDelta,
        integratedUpdate,
        modelSummary: buildModelSummaryForPrompt(modelPack),
      }),
      0.2
    );

    markStage('pack', 'Preparing model update pack', 'Assembling banker-style sections, evidence classification, and exportable tables');
    const result = buildResult({
      filingSource,
      transcriptSource,
      supportSources,
      filingExtraction,
      transcriptDelta,
      integratedUpdate,
      reportPack,
      modelPack,
      stageTimings,
      model: GEMINI_MODEL,
      baselineInput: analystBaseline,
      baselineUsed,
    });

    stageTimings[stageTimings.length - 1].durationMs = Date.now() - currentStageStart;

    send('result', result);
    send('done', { ok: true, totalDurationMs: Date.now() - startedAt });
  } catch (error) {
    send('error', {
      message: error.message || 'Something went wrong while generating the model update pack.',
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
  console.log(`Filing-to-Model Update Workbench server listening on http://localhost:${port}`);
});

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

function mergeBaselineWithReportedBase(baseline, filingExtraction) {
  const metrics = filingExtraction?.reportedBase?.normalizedMetrics || {};
  const merged = { ...baseline };

  if (!merged.companyName && filingExtraction?.filingMetadata?.company) merged.companyName = filingExtraction.filingMetadata.company;
  if (merged.currentRevenue === DEFAULT_BASELINE.currentRevenue && Number.isFinite(metrics.revenueLtm)) merged.currentRevenue = metrics.revenueLtm;
  if (merged.shareCount === DEFAULT_BASELINE.shareCount && Number.isFinite(metrics.shareCount)) merged.shareCount = metrics.shareCount;
  if (merged.netDebt === DEFAULT_BASELINE.netDebt && Number.isFinite(metrics.netDebt)) merged.netDebt = metrics.netDebt;
  if (merged.taxRate === DEFAULT_BASELINE.taxRate && Number.isFinite(metrics.taxRatePct)) merged.taxRate = metrics.taxRatePct;
  if (merged.grossMarginStart === DEFAULT_BASELINE.grossMarginStart && Number.isFinite(metrics.grossMarginPct)) {
    merged.grossMarginStart = metrics.grossMarginPct;
  }
  if (merged.operatingMarginStart === DEFAULT_BASELINE.operatingMarginStart && Number.isFinite(metrics.operatingMarginPct)) {
    merged.operatingMarginStart = metrics.operatingMarginPct;
  }
  if (merged.capexPct === DEFAULT_BASELINE.capexPct && Number.isFinite(metrics.capexPctRevenue)) merged.capexPct = metrics.capexPctRevenue;

  return normalizeBaseline(merged);
}

function buildTranscriptSkippedResult() {
  return {
    transcriptMetadata: {
      title: null,
      callDate: null,
      managementTone: {
        label: 'neutral',
        rationale: 'No transcript supplied. Forward read-through relies on the filing and any supporting materials.',
      },
    },
    callTakeaways: [],
    transcriptDelta: {
      overview: 'No earnings transcript was provided. The model update relies primarily on the filing-grounded base and any supporting materials.',
      changes: [],
    },
    watchItems: [],
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
  transcriptSource,
  supportSources,
  filingExtraction,
  transcriptDelta,
  integratedUpdate,
  reportPack,
  modelPack,
  stageTimings,
  model,
  baselineInput,
  baselineUsed,
}) {
  const evidenceMap = dedupeEvidence([
    ...(filingExtraction?.evidenceMap || []),
    ...((transcriptDelta?.transcriptDelta?.changes || []).map((item) => ({
      driver: item.driver,
      source: 'transcript',
      classification: mapTranscriptClassification(item.classification),
      summary: item.summary,
      evidence: item.evidence,
      confidence: item.confidence,
    })) || []),
    ...((integratedUpdate?.estimateChangeLog || []).map((item) => ({
      driver: item.driver,
      source: 'integrated_model',
      classification: item.classification,
      summary: item.recommendedChange,
      evidence: item.evidence,
      confidence: item.confidence,
    })) || []),
  ]);

  const reviewFlags = dedupeByText(
    [
      ...(integratedUpdate?.reviewFlags || []),
      ...((transcriptDelta?.watchItems || []).map((item) => ({
        item: item.item,
        reason: item.whyItMatters,
        evidence: 'Watch item surfaced from transcript comparison.',
        confidence: item.confidence,
      })) || []),
    ],
    'item'
  );

  return {
    generatedAt: new Date().toISOString(),
    model,
    filingMetadata: filingExtraction?.filingMetadata || filingSource.fallbackMetadata,
    transcriptMetadata: transcriptDelta?.transcriptMetadata || buildTranscriptSkippedResult().transcriptMetadata,
    sources: {
      filing: summarizeSource(filingSource),
      transcript: summarizeSource(transcriptSource),
      supportingMaterials: supportSources.map(summarizeSource),
    },
    baselineInput,
    baselineUsed,
    executiveTakeaway: reportPack?.executiveTakeaway || {},
    keyTakeaways: reportPack?.keyTakeaways || [],
    filingTakeaways: filingExtraction?.filingTakeaways || [],
    callTakeaways: transcriptDelta?.callTakeaways || [],
    changeVsPriorView: integratedUpdate?.changeVsPriorView || { summary: '', bullets: [] },
    reportedBase: filingExtraction?.reportedBase || {},
    filingGroundedBase: integratedUpdate?.filingGroundedBase || { summary: '', assumptionChecks: [] },
    estimateChangeLog: integratedUpdate?.estimateChangeLog || [],
    scenarioWriteups: reportPack?.scenarioWriteups || {},
    modelPack,
    valuationImplications: integratedUpdate?.valuationImplications || { summary: '', bridgeDrivers: [] },
    valuationSummary: reportPack?.valuationSummary || { summary: '', bridgeCommentary: '' },
    evidenceMap,
    reviewFlags,
    watchItems: [
      ...(integratedUpdate?.watchItems || []),
      ...((reportPack?.whatWouldChangeMyView || []).map((item) => ({ item, whyItMatters: 'What would change the view', confidence: 'medium' })) || []),
    ],
    checklist: integratedUpdate?.checklist || [],
    stageTimings,
  };
}

function mapTranscriptClassification(value) {
  if (value === 'stated') return 'stated';
  if (value === 'review_required') return 'review_required';
  return 'inferred';
}

function dedupeEvidence(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.driver}|${item.summary}`.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeByText(items, field) {
  const seen = new Set();
  return items.filter((item) => {
    const value = String(item?.[field] || '').trim().toLowerCase();
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function hasInputContent(source) {
  return Boolean(source && (String(source.url || '').trim() || String(source.text || '').trim()));
}

function materialLabel(kind) {
  if (kind === 'earnings_release') return 'Earnings release';
  if (kind === 'shareholder_letter') return 'Shareholder letter';
  if (kind === 'investor_presentation') return 'Investor presentation';
  if (kind === 'management_commentary') return 'Management commentary';
  return 'Supporting material';
}
