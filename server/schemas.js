export const FILING_EXTRACTION_SCHEMA = {
  filingMetadata: {
    company: null,
    filingType: null,
    period: null,
    filingDate: null,
    title: null,
    fiscalQuarter: null,
    fiscalYear: null,
    reportingPeriod: null,
  },
  businessOverview: {
    summary: '',
    businessLines: [],
    segmentNotes: [],
    geographyNotes: [],
  },
  reportedBase: {
    summary: '',
    normalizedMetrics: {
      revenueLtm: null,
      grossMarginPct: null,
      operatingMarginPct: null,
      taxRatePct: null,
      capexPctRevenue: null,
      daPctRevenue: null,
      shareCount: null,
      cash: null,
      debt: null,
      netDebt: null,
      liquidity: null,
    },
    reportedFacts: [],
  },
  derivedMetrics: [],
  keyTakeaways: [],
  modelDrivers: [],
  risksAndWatchItems: [],
  guidanceReferences: [],
  confidenceMap: {},
  evidenceMap: {},
  reviewFlags: [],
  missingBaseInputs: [],
};

export const FILING_ANALYSIS_SCHEMA = {
  whatMattersForModel: {
    summary: '',
    bullets: [],
  },
  proposedAssumptions: [],
  assumptionReview: [],
  scenarioAdjustments: {
    base: {},
    upside: {},
    downside: {},
  },
  valuationFraming: {
    summary: '',
    bridgeDrivers: [],
    keySensitivities: [],
    scenarioStructure: [],
  },
  confidenceMap: {},
  evidenceMap: {},
  reviewFlags: [],
  checklist: [],
};

export const REPORT_PACK_SCHEMA = {
  executiveSummary: {
    headline: '',
    body: '',
    bullets: [],
  },
  scenarioWriteups: {
    base: { summary: '', bullets: [] },
    upside: { summary: '', bullets: [] },
    downside: { summary: '', bullets: [] },
  },
  valuationSummary: {
    summary: '',
    bullets: [],
  },
  sourceAppendix: {
    methodology: '',
    caveats: [],
  },
};

export function applySchemaDefaults(value, schema) {
  if (Array.isArray(schema)) {
    return Array.isArray(value) ? value : [];
  }

  if (schema && typeof schema === 'object') {
    const next = {};
    const input = value && typeof value === 'object' ? value : {};
    for (const key of Object.keys(schema)) {
      next[key] = applySchemaDefaults(input[key], schema[key]);
    }
    for (const key of Object.keys(input)) {
      if (!(key in next)) next[key] = input[key];
    }
    return next;
  }

  return value ?? schema;
}
