const SEC_TICKER_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_SUBMISSIONS_BASE = 'https://data.sec.gov/submissions';
const SEC_ARCHIVES_BASE = 'https://www.sec.gov/Archives/edgar/data';
const CACHE_TTL_MS = 10 * 60 * 1000;
const SEC_MIN_INTERVAL_MS = Number(process.env.SEC_MIN_INTERVAL_MS || 250);

const cache = new Map();
let secRequestChain = Promise.resolve();
let lastSecRequestAt = 0;

export async function resolveTickerToFiling({ ticker, formType, year, quarter }) {
  const normalizedTicker = normalizeTicker(ticker);
  const normalizedFormType = normalizeFormType(formType) || '10-Q';
  const normalizedYear = normalizeYear(year);
  const normalizedQuarter = normalizeQuarter(quarter, normalizedFormType);

  if (year !== undefined && year !== null && year !== '' && normalizedYear === null) {
    throw new Error('Year must be a 4-digit year, like 2025. Leave it blank to use the latest filing.');
  }

  if (quarter !== undefined && quarter !== null && quarter !== '' && normalizedQuarter === null) {
    throw new Error('Quarter must be Q1, Q2, or Q3 when selecting a 10-Q.');
  }

  const cik = await getCikForTicker(normalizedTicker);
  const submissions = await getCompanySubmissions(cik);
  const filing = selectFiling(submissions, normalizedFormType, normalizedYear, normalizedQuarter);
  if (!filing) {
    const filingLabel = normalizedQuarter && normalizedFormType === '10-Q' ? `${normalizedQuarter} ${normalizedFormType}` : normalizedFormType;
    if (normalizedYear) {
      throw new Error(`No ${filingLabel} found for ${normalizedTicker} in ${normalizedYear}. Try another year or use advanced manual input.`);
    }
    throw new Error(`No ${filingLabel} found for ${normalizedTicker}. Try another filing window or use manual filing input.`);
  }

  return {
    ticker: normalizedTicker,
    cik,
    companyName: submissions.name || null,
    filing,
    filingQuarter: filing.inferredQuarter || null,
    fiscalYear: extractYear(filing.filingDate) || extractYear(filing.reportDate) || null,
    filingUrl: buildFilingUrl(cik, filing.accessionNumber, filing.primaryDocument),
  };
}

export async function getCikForTicker(ticker) {
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker) throw new Error('Enter a valid ticker to retrieve a filing.');

  const tickerMap = await getJsonWithCache('sec-ticker-map', async () => {
    const response = await fetchSecJson(SEC_TICKER_URL);
    return indexTickerMap(response);
  });

  const entry = tickerMap.get(normalizedTicker);
  if (!entry?.cik) throw new Error(`Unknown ticker: ${normalizedTicker}. Check the symbol or use advanced manual input.`);
  return entry.cik;
}

export async function getCompanySubmissions(cik) {
  const normalizedCik = normalizeCik(cik);
  return getJsonWithCache(`submissions:${normalizedCik}`, async () => fetchSecJson(`${SEC_SUBMISSIONS_BASE}/CIK${normalizedCik}.json`));
}

export function selectFiling(submissions, formType = '10-Q', year, quarter) {
  const normalizedFormType = normalizeFormType(formType) || '10-Q';
  const requestedYear = normalizeYear(year);
  const requestedQuarter = normalizeQuarter(quarter, normalizedFormType);
  const recent = submissions?.filings?.recent;
  if (!recent || !Array.isArray(recent.form) || !Array.isArray(recent.accessionNumber) || !Array.isArray(recent.primaryDocument)) {
    throw new Error('SEC response missing expected filing fields. Try again shortly or use advanced manual input.');
  }

  const fiscalYearEnd = inferFiscalYearEnd(submissions);

  const forms = recent.form || [];
  const accessionNumbers = recent.accessionNumber || [];
  const filingDates = recent.filingDate || [];
  const reportDates = recent.reportDate || [];
  const primaryDocuments = recent.primaryDocument || [];
  const primaryDocDescriptions = recent.primaryDocDescription || [];

  const candidates = forms
    .map((form, index) => ({
      form,
      accessionNumber: accessionNumbers[index],
      filingDate: filingDates[index],
      reportDate: reportDates[index],
      primaryDocument: primaryDocuments[index],
      primaryDocDescription: primaryDocDescriptions[index],
      inferredQuarter: form === '10-Q' ? inferQuarterFromFiling({
        form,
        filingDate: filingDates[index],
        reportDate: reportDates[index],
      }, fiscalYearEnd) : null,
    }))
    .filter((item) => item.form === normalizedFormType)
    .filter((item) => item.accessionNumber && item.primaryDocument)
    .filter((item) => (requestedYear ? filingMatchesYear(item, requestedYear) : true))
    .sort((a, b) => String(b.filingDate || '').localeCompare(String(a.filingDate || '')));

  if (!requestedQuarter) return candidates[0] || null;

  const quarterMatches = candidates.filter((item) => item.inferredQuarter === requestedQuarter);
  if (quarterMatches.length) return quarterMatches[0];

  if (candidates.some((item) => item.inferredQuarter === null)) {
    throw new Error(`Could not confidently determine ${requestedQuarter} for ${normalizedFormType}${requestedYear ? ` in ${requestedYear}` : ''}. Try another year or use advanced manual input.`);
  }

  return null;
}

export function buildFilingUrl(cik, accessionNumber, primaryDocument) {
  const normalizedCik = String(Number(cik));
  const accessionNoDashes = String(accessionNumber || '').replace(/-/g, '');
  return `${SEC_ARCHIVES_BASE}/${normalizedCik}/${accessionNoDashes}/${primaryDocument}`;
}

export async function fetchSecFiling({ ticker, formType, year, quarter }) {
  return resolveTickerToFiling({ ticker, formType, year, quarter });
}

async function fetchSecJson(url) {
  return runSecRequest(async () => {
    const response = await fetch(url, {
      headers: {
        'User-Agent': buildSecUserAgent(),
        Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!response.ok) {
      throw new Error(`SEC fetch failed (${response.status} ${response.statusText}). Try again shortly or use advanced manual input.`);
    }

    try {
      return await response.json();
    } catch {
      throw new Error('SEC response could not be parsed. Try again shortly or use advanced manual input.');
    }
  });
}

async function getJsonWithCache(cacheKey, load) {
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;
  const value = await load();
  cache.set(cacheKey, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

function runSecRequest(task) {
  const next = secRequestChain.then(async () => {
    const elapsed = Date.now() - lastSecRequestAt;
    if (elapsed < SEC_MIN_INTERVAL_MS) {
      await wait(SEC_MIN_INTERVAL_MS - elapsed);
    }
    const result = await task();
    lastSecRequestAt = Date.now();
    return result;
  });

  secRequestChain = next.catch(() => undefined);
  return next;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function indexTickerMap(raw) {
  const map = new Map();
  Object.values(raw || {}).forEach((entry) => {
    const ticker = normalizeTicker(entry?.ticker);
    if (!ticker) return;
    map.set(ticker, {
      cik: normalizeCik(entry.cik_str),
      title: entry.title || null,
      ticker,
    });
  });
  return map;
}

function normalizeTicker(ticker) {
  return String(ticker || '').trim().toUpperCase().replace(/[^A-Z.]/g, '');
}

function normalizeCik(cik) {
  const numeric = String(cik || '').replace(/\D/g, '');
  return numeric.padStart(10, '0');
}

function normalizeFormType(formType) {
  const normalized = String(formType || '').trim().toUpperCase();
  if (normalized === '10-Q' || normalized === '10K' || normalized === '10-K' || normalized === '10Q') {
    return normalized === '10K' ? '10-K' : normalized === '10Q' ? '10-Q' : normalized;
  }
  return normalized || null;
}

function normalizeQuarter(quarter, formType) {
  if (normalizeFormType(formType) !== '10-Q') return null;
  if (quarter === undefined || quarter === null || quarter === '') return null;
  const normalized = String(quarter).trim().toUpperCase();
  return ['Q1', 'Q2', 'Q3'].includes(normalized) ? normalized : null;
}

function normalizeYear(year) {
  if (year === undefined || year === null || year === '') return null;
  const raw = String(year).trim();
  if (!/^\d{4}$/.test(raw)) return null;
  const numeric = Number(raw);
  if (numeric < 1994 || numeric > 2100) return null;
  return numeric;
}

function filingMatchesYear(filing, year) {
  const filingYear = extractYear(filing.filingDate) || extractYear(filing.reportDate);
  return filingYear === year;
}

function inferFiscalYearEnd(submissions) {
  const recent = submissions?.filings?.recent;
  if (!recent || !Array.isArray(recent.form)) return null;

  const tenKIndex = recent.form.findIndex((form, index) => {
    if (form !== '10-K') return false;
    return Boolean(recent.reportDate?.[index] || recent.filingDate?.[index]);
  });

  if (tenKIndex === -1) return null;
  const referenceDate = parseIsoDate(recent.reportDate?.[tenKIndex] || recent.filingDate?.[tenKIndex]);
  if (!referenceDate) return null;

  return {
    month: referenceDate.getUTCMonth() + 1,
    day: referenceDate.getUTCDate(),
  };
}

function inferQuarterFromFiling(filing, fiscalYearEnd) {
  if (!fiscalYearEnd) return null;
  const anchorDate = parseIsoDate(filing.reportDate) || parseIsoDate(filing.filingDate);
  if (!anchorDate) return null;

  const priorFiscalYearEnd = getMostRecentFiscalYearEnd(anchorDate, fiscalYearEnd);
  if (!priorFiscalYearEnd) return null;

  const diffDays = Math.round((anchorDate.getTime() - priorFiscalYearEnd.getTime()) / 86_400_000);
  const ranked = [
    { quarter: 'Q1', days: 91 },
    { quarter: 'Q2', days: 182 },
    { quarter: 'Q3', days: 273 },
  ]
    .map((item) => ({ ...item, gap: Math.abs(diffDays - item.days) }))
    .sort((a, b) => a.gap - b.gap);

  const [best, runnerUp] = ranked;
  if (!best) return null;
  if (best.gap <= 50 && (!runnerUp || runnerUp.gap - best.gap >= 12 || best.gap <= 28)) {
    return best.quarter;
  }

  return null;
}

function getMostRecentFiscalYearEnd(anchorDate, fiscalYearEnd) {
  const sameYear = createUtcDate(anchorDate.getUTCFullYear(), fiscalYearEnd.month, fiscalYearEnd.day);
  if (sameYear.getTime() <= anchorDate.getTime()) return sameYear;
  return createUtcDate(anchorDate.getUTCFullYear() - 1, fiscalYearEnd.month, fiscalYearEnd.day);
}

function createUtcDate(year, month, day) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1, Math.min(day, daysInMonth)));
}

function parseIsoDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function extractYear(value) {
  const match = String(value || '').match(/(20\d{2})/);
  return match ? Number(match[1]) : null;
}

function buildSecUserAgent() {
  return process.env.SEC_USER_AGENT || 'Filing Model Workbench/1.0 (contact: research@localhost)';
}
