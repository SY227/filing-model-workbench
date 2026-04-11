import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import * as cheerio from 'cheerio';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distPath = path.join(projectRoot, 'dist');

const app = express();
const port = Number(process.env.PORT || 8787);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const MAX_TRANSCRIPT_CHARS = 75000;

app.use(cors());
app.use(express.json({ limit: '3mb' }));

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
      throw new Error('Missing GEMINI_API_KEY. Add it to your .env before processing transcripts.');
    }

    const { inputMode, url, transcript } = req.body ?? {};
    if (!inputMode || !['url', 'text'].includes(inputMode)) {
      throw new Error('Please choose either transcript URL or pasted transcript text.');
    }

    markStage('ingest', 'Ingesting transcript', inputMode === 'url' ? 'Fetching and cleaning source page' : 'Cleaning pasted transcript');

    const ingestion = inputMode === 'url'
      ? await fetchTranscriptFromUrl(url)
      : ingestPastedTranscript(transcript);

    if (!ingestion.cleanedText || ingestion.cleanedText.length < 1200) {
      throw new Error(
        inputMode === 'url'
          ? 'I could not extract enough readable transcript text from that page. Try the paste-text path instead.'
          : 'The pasted transcript is too short to analyze. Paste a longer transcript excerpt.'
      );
    }

    const transcriptForModel = clampTranscript(ingestion.cleanedText, MAX_TRANSCRIPT_CHARS);

    markStage('metadata', 'Identifying metadata and themes', 'Detecting company, period, tone, and major themes');
    const extraction = await runExtractionPass({
      transcript: transcriptForModel,
      sourceUrl: ingestion.sourceUrl,
      pageTitle: ingestion.title,
      fallbackMetadata: ingestion.fallbackMetadata,
    });

    markStage('signals', 'Extracting guidance and signals', 'Pulling explicit management statements and model-relevant evidence');
    const synthesis = await runSynthesisPass({
      transcript: transcriptForModel,
      extraction,
      sourceUrl: ingestion.sourceUrl,
    });

    markStage('mapping', 'Mapping assumptions', 'Building assumption deltas, review flags, and checklist');

    markStage('pack', 'Preparing review pack', 'Assembling structured output for analyst review');
    const result = buildResult({
      ingestion,
      extraction,
      synthesis,
      stageTimings,
      model: GEMINI_MODEL,
    });

    stageTimings[stageTimings.length - 1].durationMs = Date.now() - currentStageStart;

    send('result', result);
    send('done', { ok: true, totalDurationMs: Date.now() - startedAt });
  } catch (error) {
    send('error', {
      message: error.message || 'Something went wrong while processing the transcript.',
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
  console.log(`Earnings-to-Model Update Agent server listening on http://localhost:${port}`);
});

function setupSseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
}

function ingestPastedTranscript(transcript) {
  if (!transcript || typeof transcript !== 'string') {
    throw new Error('Paste transcript text to continue.');
  }

  const cleanedText = normalizeTranscriptText(transcript);
  const fallbackMetadata = inferMetadataFromText(cleanedText, 'Pasted transcript');

  return {
    sourceType: 'text',
    sourceUrl: null,
    title: fallbackMetadata.title,
    rawText: transcript,
    cleanedText,
    fallbackMetadata,
  };
}

async function fetchTranscriptFromUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Paste a transcript URL to continue.');
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('That URL does not look valid.');
  }

  const response = await fetch(parsed.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; EarningsToModelAgent/1.0; +https://localhost)',
      Accept: 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`Could not fetch the transcript page (${response.status} ${response.statusText}).`);
  }

  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();

  let title = parsed.hostname;
  let extractedText = raw;

  if (contentType.includes('html')) {
    const { cleanedText, extractedTitle } = extractTextFromHtml(raw);
    extractedText = cleanedText;
    title = extractedTitle || title;
  }

  const cleanedText = normalizeTranscriptText(extractedText);
  const fallbackMetadata = inferMetadataFromText(cleanedText, title);

  return {
    sourceType: 'url',
    sourceUrl: parsed.toString(),
    title,
    rawText: raw,
    cleanedText,
    fallbackMetadata,
  };
}

function extractTextFromHtml(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, svg, img, figure, form, button, nav, footer, header, aside').remove();

  const extractedTitle =
    $('meta[property="og:title"]').attr('content') ||
    $('meta[name="twitter:title"]').attr('content') ||
    $('title').first().text().trim() ||
    $('h1').first().text().trim() ||
    '';

  const candidateSelectors = [
    'article',
    'main',
    '[role="main"]',
    '.transcript',
    '#transcript',
    '.article-body',
    '.main-content',
    '.content',
    'body',
  ];

  const candidates = candidateSelectors
    .map((selector) => {
      const node = $(selector).first();
      if (!node.length) return null;
      const blocks = [];
      node.find('h1, h2, h3, h4, p, li, pre, blockquote').each((_idx, el) => {
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        if (text.length >= 30) blocks.push(text);
      });
      if (blocks.length < 8) {
        const rawText = node.text().replace(/\s+/g, ' ').trim();
        if (rawText.length > 1000) blocks.push(rawText);
      }
      return {
        selector,
        text: blocks.join('\n\n'),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.text.length - a.text.length);

  const cleanedText = candidates[0]?.text || $.root().text();
  return { cleanedText, extractedTitle };
}

function normalizeTranscriptText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, lines) => {
      if (!line) return true;
      const lower = line.toLowerCase();
      const junkPatterns = [
        /^advertisement$/,
        /^click here to /,
        /^read more$/,
        /^sign up$/,
        /^related articles$/,
      ];
      if (junkPatterns.some((pattern) => pattern.test(lower))) return false;
      if (index > 0 && lines[index - 1]?.trim() === line) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function inferMetadataFromText(text, title = '') {
  const firstChunk = `${title}\n${text.slice(0, 2500)}`;
  const quarterMatch = firstChunk.match(/\b(Q[1-4]|first quarter|second quarter|third quarter|fourth quarter)\s*(FY\s*)?(20\d{2})?\b/i);
  const dateMatch = firstChunk.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+20\d{2}\b/i);
  const companyMatch = title.match(/^(.+?)(?:\s+(?:Q[1-4]|First Quarter|Second Quarter|Third Quarter|Fourth Quarter|Earnings|Transcript|Conference Call))/i);

  return {
    title: title || deriveTitleFromTranscript(text),
    company: companyMatch?.[1]?.trim() || null,
    quarter: quarterMatch?.[0] || null,
    callDate: dateMatch?.[0] || null,
  };
}

function deriveTitleFromTranscript(text) {
  const lines = text.split('\n').filter(Boolean).slice(0, 6);
  return lines.find((line) => line.length > 18 && line.length < 120) || 'Transcript analysis';
}

function clampTranscript(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[Transcript truncated after ${maxChars.toLocaleString()} characters for model processing.]`;
}

async function runExtractionPass({ transcript, sourceUrl, pageTitle, fallbackMetadata }) {
  const prompt = `You are an earnings transcript extraction agent supporting financial model updates.

Analyze the transcript and return strict JSON only. Do not wrap in markdown. Be conservative. Do not invent exact numbers unless management explicitly stated them. Keep the output grounded in evidence from the transcript.

Required JSON shape:
{
  "metadata": {
    "company": string | null,
    "quarter": string | null,
    "callDate": string | null,
    "title": string | null,
    "managementTone": {
      "label": "constructive" | "mixed" | "cautious" | "negative" | "neutral",
      "rationale": string
    },
    "majorThemes": string[]
  },
  "keySignals": [
    {
      "category": "guidance" | "revenue" | "margin" | "demand" | "opex" | "capex" | "geography_segment" | "macro" | "risk" | "cash_flow" | "other",
      "title": string,
      "summary": string,
      "evidence": string,
      "explicitness": "explicit" | "inferred",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "explicitStatements": [
    {
      "statement": string,
      "evidence": string,
      "confidence": "high" | "medium" | "low"
    }
  ],
  "inferredImplications": [
    {
      "implication": string,
      "whyItMatters": string,
      "evidence": string,
      "confidence": "high" | "medium" | "low"
    }
  ],
  "reviewFlags": [
    {
      "item": string,
      "reason": string,
      "evidence": string,
      "confidence": "high" | "medium" | "low"
    }
  ]
}

Context:
- Source URL: ${sourceUrl || 'n/a'}
- Page title: ${pageTitle || 'n/a'}
- Fallback metadata: ${JSON.stringify(fallbackMetadata)}

Transcript:
${transcript}`;

  return callGeminiJson(prompt, 0.1);
}

async function runSynthesisPass({ transcript, extraction, sourceUrl }) {
  const prompt = `You are a finance workflow agent turning transcript evidence into a reviewable model-update pack.

Return strict JSON only. Do not wrap in markdown. Do not claim certainty you do not have. Never fabricate exact numeric model changes unless the transcript explicitly supports them. Prefer directional recommendations, conditional language, and analyst-review flags.

Required JSON shape:
{
  "executiveSummary": {
    "headline": string,
    "body": string,
    "bullets": string[]
  },
  "assumptionDeltaLog": [
    {
      "driver": string,
      "analystBaselineField": string,
      "proposedUpdate": string,
      "rationale": string,
      "sourceSupport": string,
      "confidence": "high" | "medium" | "low",
      "reviewRequired": true | false
    }
  ],
  "scenarios": {
    "base": {
      "summary": string,
      "points": string[]
    },
    "upside": {
      "summary": string,
      "points": string[]
    },
    "downside": {
      "summary": string,
      "points": string[]
    }
  },
  "modelUpdateChecklist": [
    {
      "task": string,
      "ownerHint": string,
      "priority": "high" | "medium" | "low"
    }
  ],
  "reviewTrail": [
    {
      "item": string,
      "classification": "explicit" | "inferred",
      "confidence": "high" | "medium" | "low",
      "whyReview": string
    }
  ]
}

Grounding inputs:
Source URL: ${sourceUrl || 'n/a'}
Extraction JSON:
${JSON.stringify(extraction, null, 2)}

Transcript:
${transcript}`;

  return callGeminiJson(prompt, 0.2);
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

function buildResult({ ingestion, extraction, synthesis, stageTimings, model }) {
  const metadata = {
    company: extraction?.metadata?.company || ingestion.fallbackMetadata.company || null,
    quarter: extraction?.metadata?.quarter || ingestion.fallbackMetadata.quarter || null,
    callDate: extraction?.metadata?.callDate || ingestion.fallbackMetadata.callDate || null,
    title: extraction?.metadata?.title || ingestion.title || ingestion.fallbackMetadata.title,
    managementTone: extraction?.metadata?.managementTone || { label: 'neutral', rationale: 'Tone not confidently inferred.' },
    majorThemes: extraction?.metadata?.majorThemes || [],
  };

  return {
    generatedAt: new Date().toISOString(),
    model,
    source: {
      inputMode: ingestion.sourceType,
      url: ingestion.sourceUrl,
      title: ingestion.title,
      transcriptChars: ingestion.cleanedText.length,
      transcriptPreview: ingestion.cleanedText.slice(0, 2800),
      transcriptFull: ingestion.cleanedText,
    },
    metadata,
    executiveSummary: synthesis.executiveSummary,
    keySignals: extraction.keySignals || [],
    assumptionDeltaLog: synthesis.assumptionDeltaLog || [],
    scenarios: synthesis.scenarios || {},
    explicitStatements: extraction.explicitStatements || [],
    inferredImplications: extraction.inferredImplications || [],
    reviewFlags: extraction.reviewFlags || [],
    modelUpdateChecklist: synthesis.modelUpdateChecklist || [],
    reviewTrail: synthesis.reviewTrail || [],
    stageTimings,
  };
}
