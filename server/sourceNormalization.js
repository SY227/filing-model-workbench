import * as cheerio from 'cheerio';

const MAX_TEXT_PREVIEW = 3_000;

export async function ingestSource(source, options = {}) {
  const { required = false, minChars = 1200 } = options;
  const inputMode = source?.inputMode;
  const kind = source?.kind || 'document';
  const label = source?.label || kind;

  if (!inputMode) {
    if (required) throw new Error(`${label} input is required.`);
    return null;
  }

  const normalizedSource =
    inputMode === 'url'
      ? await fetchSourceFromUrl(source.url, { kind, label })
      : ingestPastedText(source.text, { kind, label, title: source.title });

  if (required && (!normalizedSource.cleanedText || normalizedSource.cleanedText.length < minChars)) {
    throw new Error(`${label} did not contain enough readable text. Paste the text directly if URL extraction is weak.`);
  }

  return normalizedSource;
}

export async function ingestSupportingSources(sources = []) {
  const results = [];
  for (const source of sources) {
    if (!hasSourceContent(source)) continue;
    const ingested = await ingestSource(source, { required: false });
    if (ingested?.cleanedText) results.push(ingested);
  }
  return results;
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

export function buildSupportingPacketForPrompt(sources = [], maxChars = 4_500) {
  return sources.map((source) => ({
    kind: source.kind,
    label: source.label,
    title: source.title,
    url: source.sourceUrl,
    excerpt: clampText(source.cleanedText, maxChars),
  }));
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

function hasSourceContent(source) {
  return Boolean(source && (String(source.url || '').trim() || String(source.text || '').trim()));
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

async function fetchSourceFromUrl(url, { kind, label }) {
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
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; FilingModelWorkbench/1.0; +https://localhost)',
      Accept: 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`Could not fetch the ${label.toLowerCase()} page (${response.status} ${response.statusText}).`);
  }

  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();

  let title = parsed.hostname;
  let extractedText = raw;

  if (contentType.includes('html')) {
    const extraction = extractTextFromHtml(raw);
    extractedText = extraction.cleanedText;
    title = extraction.extractedTitle || title;
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

  const candidateSelectors = ['article', 'main', '[role="main"]', '.transcript', '#transcript', '.article-body', '.main-content', '.content', 'body'];
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
  const firstChunk = `${title}\n${String(text || '').slice(0, 5000)}`;
  const filingTypeMatch = firstChunk.match(/\b(10-Q|10-K|8-K|annual report|quarterly report)\b/i);
  const quarterMatch = firstChunk.match(/\b(Q[1-4]|first quarter|second quarter|third quarter|fourth quarter|fiscal year|year ended)\s*(20\d{2})?\b/i);
  const dateMatch = firstChunk.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+20\d{2}\b/i);
  const companyMatch = title.match(/^(.+?)(?:\s+(?:Q[1-4]|10-Q|10-K|Annual Report|Quarterly Report|Earnings|Transcript|Conference Call))/i);

  return {
    title: title || deriveTitleFromText(text, kind),
    company: companyMatch?.[1]?.trim() || null,
    period: quarterMatch?.[0] || null,
    filingType: normalizeFilingType(filingTypeMatch?.[0] || null),
    callDate: kind === 'transcript' ? dateMatch?.[0] || null : null,
    filingDate: kind === 'filing' ? dateMatch?.[0] || null : null,
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
