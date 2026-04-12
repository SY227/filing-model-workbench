import * as cheerio from 'cheerio';
import { fetchSecFiling } from './secLookup.js';

const MAX_TEXT_PREVIEW = 3_000;

export async function ingestSource(filingRequest, options = {}) {
  const { required = false, minChars = 1200 } = options;
  const normalizedRequest = normalizeFilingRequest(filingRequest);
  const kind = normalizedRequest?.kind || 'document';
  const label = normalizedRequest?.label || kind;

  if (!normalizedRequest?.mode) {
    if (required) throw new Error(`${label} input is required.`);
    return null;
  }

  let normalizedSource;
  if (normalizedRequest.mode === 'ticker_lookup') {
    normalizedSource = await fetchSourceFromTicker(normalizedRequest, { kind, label });
  } else if (normalizedRequest.mode === 'url') {
    normalizedSource = await fetchSourceFromUrl(normalizedRequest.url, { kind, label, titleOverride: normalizedRequest.title });
  } else if (normalizedRequest.mode === 'text') {
    normalizedSource = ingestPastedText(normalizedRequest.text, { kind, label, title: normalizedRequest.title });
  } else {
    throw new Error(`Unsupported filing request mode: ${normalizedRequest.mode}`);
  }

  if (required && (!normalizedSource.cleanedText || normalizedSource.cleanedText.length < minChars)) {
    throw new Error(`${label} did not contain enough readable text. Paste the text directly if URL extraction is weak.`);
  }

  return normalizedSource;
}

export function normalizeFilingRequest(filingRequest) {
  if (!filingRequest) return null;

  const legacyInputMode = filingRequest.inputMode;
  if (legacyInputMode === 'ticker') {
    return {
      mode: 'ticker_lookup',
      ticker: filingRequest.ticker || '',
      filingType: filingRequest.formType || filingRequest.filingType || '10-Q',
      quarter: filingRequest.quarter || null,
      year: filingRequest.year ?? null,
      title: filingRequest.title || '',
      kind: filingRequest.kind,
      label: filingRequest.label,
    };
  }

  if (legacyInputMode === 'url') {
    return {
      mode: 'url',
      url: filingRequest.url || '',
      title: filingRequest.title || '',
      kind: filingRequest.kind,
      label: filingRequest.label,
    };
  }

  if (legacyInputMode === 'text') {
    return {
      mode: 'text',
      text: filingRequest.text || '',
      title: filingRequest.title || '',
      kind: filingRequest.kind,
      label: filingRequest.label,
    };
  }

  return {
    ...filingRequest,
    kind: filingRequest.kind,
    label: filingRequest.label,
  };
}

export function buildSourcePacketForPrompt(source, maxChars = 12_000) {
  if (!source) return null;
  return {
    kind: source.kind,
    label: source.label,
    inputMode: source.sourceType,
    url: source.sourceUrl,
    title: source.title,
    metadata: source.fallbackMetadata,
    excerpt: clampText(source.cleanedText, maxChars),
  };
}

export function summarizeSource(source) {
  if (!source) return null;
  return {
    kind: source.kind,
    label: source.label,
    inputMode: source.sourceType,
    url: source.sourceUrl,
    title: source.title,
    chars: source.cleanedText.length,
    preview: clampText(source.cleanedText, MAX_TEXT_PREVIEW),
    fullText: source.cleanedText,
  };
}

function ingestPastedText(text, { kind, label, title }) {
  if (!text || typeof text !== 'string') {
    throw new Error(`Paste ${label.toLowerCase()} text to continue.`);
  }

  const cleanedText = normalizeDocumentText(text);
  const fallbackMetadata = inferMetadataFromText(cleanedText, title || label, kind);

  return {
    kind,
    label,
    sourceType: 'text',
    sourceUrl: null,
    title: fallbackMetadata.title,
    rawText: text,
    cleanedText,
    fallbackMetadata,
  };
}

async function fetchSourceFromTicker(request, { kind, label }) {
  const { ticker, filingType, quarter, year, title } = request || {};
  const resolved = await fetchSecFiling({ ticker, formType: filingType, year, quarter });
  const fetched = await fetchSourceFromUrl(resolved.filingUrl, {
    kind,
    label,
    titleOverride: title || `${resolved.companyName || resolved.ticker} ${resolved.filing.form}`,
  });

  return {
    ...fetched,
    sourceType: 'ticker',
    sourceUrl: resolved.filingUrl,
    title: title || `${resolved.companyName || resolved.ticker} ${resolved.filing.form}`,
    fallbackMetadata: {
      ...fetched.fallbackMetadata,
      company: fetched.fallbackMetadata.company || resolved.companyName,
      filingType: fetched.fallbackMetadata.filingType || resolved.filing.form,
      filingDate: fetched.fallbackMetadata.filingDate || resolved.filing.filingDate || null,
      fiscalQuarter: fetched.fallbackMetadata.fiscalQuarter || resolved.filingQuarter || null,
      fiscalYear: fetched.fallbackMetadata.fiscalYear || resolved.fiscalYear || null,
      reportingPeriod: fetched.fallbackMetadata.reportingPeriod || buildReportingPeriodLabel(resolved.filingQuarter, resolved.fiscalYear),
    },
    secResolution: resolved,
  };
}

async function fetchSourceFromUrl(url, { kind, label, titleOverride }) {
  if (!url || typeof url !== 'string') {
    throw new Error(`Paste a ${label.toLowerCase()} URL to continue.`);
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`That ${label.toLowerCase()} URL does not look valid.`);
  }

  const response = await fetch(parsed.toString(), {
    headers: buildRequestHeaders(parsed),
  });

  if (!response.ok) {
    throw new Error(`Could not fetch the ${label.toLowerCase()} page (${response.status} ${response.statusText}).`);
  }

  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();

  let title = titleOverride || parsed.hostname;
  let extractedText = raw;

  if (contentType.includes('html')) {
    const extraction = extractTextFromHtml(raw);
    extractedText = extraction.cleanedText;
    title = titleOverride || extraction.extractedTitle || title;
  }

  const cleanedText = normalizeDocumentText(extractedText);
  const fallbackMetadata = inferMetadataFromText(cleanedText, title, kind);

  return {
    kind,
    label,
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

  $('table').each((_idx, table) => {
    const rows = [];
    $(table)
      .find('tr')
      .each((_rowIdx, row) => {
        const cells = $(row)
          .find('th, td')
          .map((_cellIdx, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
          .get()
          .filter(Boolean);
        if (cells.length) rows.push(cells.join(' | '));
      });
    if (rows.length) $(table).replaceWith(`\n${rows.join('\n')}\n`);
  });

  const candidateSelectors = ['article', 'main', '[role="main"]', '.article-body', '.main-content', '.content', 'body'];
  const candidates = candidateSelectors
    .map((selector) => {
      const node = $(selector).first();
      if (!node.length) return null;
      const blocks = [];
      node.find('h1, h2, h3, h4, p, li, pre, blockquote, div').each((_idx, el) => {
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        if (text.length >= 35) blocks.push(text);
      });
      if (blocks.length < 8) {
        const rawText = node.text().replace(/\s+/g, ' ').trim();
        if (rawText.length > 1200) blocks.push(rawText);
      }
      return { selector, text: blocks.join('\n\n') };
    })
    .filter(Boolean)
    .sort((a, b) => b.text.length - a.text.length);

  return {
    cleanedText: candidates[0]?.text || $.root().text(),
    extractedTitle,
  };
}

export function normalizeDocumentText(text) {
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
      const junkPatterns = [/^advertisement$/, /^click here to /, /^read more$/, /^sign up$/, /^related articles$/];
      if (junkPatterns.some((pattern) => pattern.test(lower))) return false;
      if (index > 0 && lines[index - 1]?.trim() === line) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function inferMetadataFromText(text, title = '', kind = 'document') {
  const firstChunk = `${title}\n${String(text || '').slice(0, 8000)}`;
  const filingTypeMatch =
    firstChunk.match(/\bFORM\s+(10-Q|10-K|8-K)\b/i) ||
    firstChunk.match(/\b(10-Q|10-K|8-K|annual report|quarterly report)\b/i);
  const periodMatch =
    firstChunk.match(/for the quarterly period ended\s+([A-Za-z]+\s+\d{1,2},\s+20\d{2})/i) ||
    firstChunk.match(/for the fiscal year ended\s+([A-Za-z]+\s+\d{1,2},\s+20\d{2})/i) ||
    firstChunk.match(/year ended\s+([A-Za-z]+\s+\d{1,2},\s+20\d{2})/i) ||
    firstChunk.match(/\b(Q[1-4]|first quarter|second quarter|third quarter|fourth quarter|fiscal year)\s*(20\d{2})?\b/i);
  const dateMatch = firstChunk.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+20\d{2}\b/i);
  const titleCompanyMatch = title.match(/^(.+?)(?:\s+(?:Q[1-4]|10-Q|10-K|Annual Report|Quarterly Report|Form 10-Q|Form 10-K))/i);
  const lineCompanyMatch = String(text || '')
    .split('\n')
    .slice(0, 12)
    .find((line) => /inc\.|corporation|corp\.|company|holdings|ltd\.|plc|group/i.test(line) && line.length < 120);

  return {
    title: title || deriveTitleFromText(text, kind),
    company: titleCompanyMatch?.[1]?.trim() || lineCompanyMatch?.trim() || null,
    period: periodMatch?.[1] || periodMatch?.[0] || null,
    filingType: normalizeFilingType(filingTypeMatch?.[1] || filingTypeMatch?.[0] || null),
    filingDate: kind === 'filing' ? dateMatch?.[0] || null : null,
    fiscalQuarter: normalizeQuarterLabel(periodMatch?.[1] || periodMatch?.[0] || title || ''),
    fiscalYear: extractMetadataYear(periodMatch?.[1] || title || text),
    reportingPeriod: normalizeQuarterLabel(periodMatch?.[1] || periodMatch?.[0] || title || '')
      ? buildReportingPeriodLabel(normalizeQuarterLabel(periodMatch?.[1] || periodMatch?.[0] || title || ''), extractMetadataYear(periodMatch?.[1] || title || text))
      : null,
  };
}

function deriveTitleFromText(text, kind) {
  const lines = String(text || '').split('\n').filter(Boolean).slice(0, 8);
  return lines.find((line) => line.length > 18 && line.length < 120) || `${capitalize(kind)} analysis`;
}

function clampText(text, maxChars) {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[Source truncated for prompt packaging.]`;
}

function normalizeFilingType(value) {
  if (!value) return null;
  const upper = value.toUpperCase();
  if (upper.includes('10-Q') || upper.includes('QUARTERLY')) return '10-Q';
  if (upper.includes('10-K') || upper.includes('ANNUAL')) return '10-K';
  if (upper.includes('8-K')) return '8-K';
  return value;
}

function capitalize(value) {
  return String(value || 'document').charAt(0).toUpperCase() + String(value || 'document').slice(1);
}

function normalizeQuarterLabel(value) {
  const upper = String(value || '').toUpperCase();
  if (upper.includes('Q1') || upper.includes('FIRST QUARTER')) return 'Q1';
  if (upper.includes('Q2') || upper.includes('SECOND QUARTER')) return 'Q2';
  if (upper.includes('Q3') || upper.includes('THIRD QUARTER')) return 'Q3';
  if (upper.includes('Q4') || upper.includes('FOURTH QUARTER')) return 'Q4';
  return null;
}

function extractMetadataYear(value) {
  const match = String(value || '').match(/(20\d{2})/);
  return match ? Number(match[1]) : null;
}

function buildReportingPeriodLabel(fiscalQuarter, fiscalYear) {
  if (!fiscalQuarter || !fiscalYear) return null;
  return `${fiscalQuarter} ${fiscalYear}`;
}

function buildRequestHeaders(parsedUrl) {
  if (isSecHost(parsedUrl.hostname)) {
    return {
      'User-Agent': buildSecUserAgent(),
      Accept: 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9',
    };
  }

  return {
    Accept: 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8',
    'User-Agent': 'FilingModelWorkbench/1.0',
  };
}

function buildSecUserAgent() {
  return process.env.SEC_USER_AGENT || 'Filing Model Workbench/1.0 (contact: research@localhost)';
}

function isSecHost(hostname = '') {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'sec.gov' || normalized.endsWith('.sec.gov');
}
