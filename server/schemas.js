const META_FIELD = { classification: 'review_required', rationale: '', evidence: '', confidence: 'low' };

function buildMetaShape(fields) {
  return Object.fromEntries(fields.map((field) => [field, { ...META_FIELD }]));
}

export const OPCO_BASELINE_META_SCHEMA = buildMetaShape([
  'companyName',
  'currentRevenue',
  'revenueGrowth',
  'grossMarginStart',
  'grossMarginEnd',
  'operatingMarginStart',
  'operatingMarginEnd',
  'taxRate',
  'capexPct',
  'daPct',
  'nwcPct',
  'wacc',
  'terminalGrowth',
  'shareCount',
  'netDebt',
  'exitEbitdaMultiple',
]);

export const ASSET_MANAGER_BASELINE_META_SCHEMA = buildMetaShape([
  'companyName',
  'aum',
  'feeRelatedEarnings',
  'distributableEarnings',
  'managementFees',
  'performanceIncome',
  'bookValue',
  'balanceSheetInvestments',
  'shareCount',
  'cash',
  'debt',
  'netDebt',
]);

export const DIRECTIONAL_BASELINE_META_SCHEMA = buildMetaShape([
  'companyName',
  'shareCount',
  'bookValue',
  'earningsLikeAnchor',
  'cash',
  'debt',
  'netDebt',
  'anchorLabel',
]);

export const DRAFTED_BASELINE_META_SCHEMA = OPCO_BASELINE_META_SCHEMA;

export const ASSET_MANAGER_METRICS_SCHEMA = {
  aum: { value: null, classification: 'review_required', evidence: '', confidence: 'low' },
  feeRelatedEarnings: { value: null, classification: 'review_required', evidence: '', confidence: 'low' },
  distributableEarnings: { value: null, classification: 'review_required', evidence: '', confidence: 'low' },
  managementFees: { value: null, classification: 'review_required', evidence: '', confidence: 'low' },
  performanceIncome: { value: null, classification: 'review_required', evidence: '', confidence: 'low' },
  bookValue: { value: null, classification: 'review_required', evidence: '', confidence: 'low' },
  balanceSheetInvestments: { value: null, classification: 'review_required', evidence: '', confidence: 'low' },
  shareCount: { value: null, classification: 'review_required', evidence: '', confidence: 'low' },
  cash: { value: null, classification: 'review_required', evidence: '', confidence: 'low' },
  debt: { value: null, classification: 'review_required', evidence: '', confidence: 'low' },
  netDebt: { value: null, classification: 'review_required', evidence: '', confidence: 'low' },
};

export const FILING_EXTRACTION_SCHEMA = {
  issuerArchetype: null,
  analysisMode: null,
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
  assetManagerMetrics: ASSET_MANAGER_METRICS_SCHEMA,
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

const SCENARIO_ADJUSTMENT_SCHEMA = {
  revenueGrowthDeltaPpts: [0, 0, 0, 0, 0],
  grossMarginDeltaBps: [0, 0, 0, 0, 0],
  operatingMarginDeltaBps: [0, 0, 0, 0, 0],
  capexPctDeltaBps: [0, 0, 0, 0, 0],
  daPctDeltaBps: [0, 0, 0, 0, 0],
  nwcPctDeltaBps: [0, 0, 0, 0, 0],
  taxRateDeltaBps: [0, 0, 0, 0, 0],
  waccDeltaBps: 0,
  terminalGrowthDeltaBps: 0,
  summary: '',
  keyAssumptions: [],
};

export const FILING_ANALYSIS_SCHEMA = {
  analysisMode: 'operating_company',
  draftedBaseline: {},
  draftedBaselineMeta: OPCO_BASELINE_META_SCHEMA,
  currentRunwayGrowthPct: null,
  currentRunwayGrowthMeta: {
    classification: 'review_required',
    rationale: '',
    evidence: '',
    confidence: 'medium',
    source: '',
    basis: '',
  },
  whatMattersForModel: {
    summary: '',
    bullets: [],
  },
  proposedAssumptions: [],
  assumptionReview: [],
  scenarioAdjustments: {
    base: SCENARIO_ADJUSTMENT_SCHEMA,
    upside: SCENARIO_ADJUSTMENT_SCHEMA,
    downside: SCENARIO_ADJUSTMENT_SCHEMA,
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

export const ASSET_MANAGER_ANALYSIS_SCHEMA = {
  analysisMode: 'asset_manager',
  draftedBaseline: {},
  draftedBaselineMeta: ASSET_MANAGER_BASELINE_META_SCHEMA,
  whatMattersForModel: {
    summary: '',
    bullets: [],
  },
  proposedAssumptions: [],
  assumptionReview: [],
  valuationFraming: {
    summary: '',
    bridgeDrivers: [],
    keySensitivities: [],
    scenarioStructure: [],
  },
  directionalModeReason: '',
  confidenceMap: {},
  evidenceMap: {},
  reviewFlags: [],
  checklist: [],
};

export const DIRECTIONAL_ANALYSIS_SCHEMA = {
  analysisMode: 'directional_only',
  draftedBaseline: {},
  draftedBaselineMeta: DIRECTIONAL_BASELINE_META_SCHEMA,
  whatMattersForModel: {
    summary: '',
    bullets: [],
  },
  proposedAssumptions: [],
  assumptionReview: [],
  valuationFraming: {
    summary: '',
    bridgeDrivers: [],
    keySensitivities: [],
    scenarioStructure: [],
  },
  directionalModeReason: '',
  confidenceMap: {},
  evidenceMap: {},
  reviewFlags: [],
  checklist: [],
};

export const RUNWAY_GROWTH_SCHEMA = {
  currentRunwayGrowthPct: null,
  rationale: '',
  evidence: '',
  confidence: 'medium',
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
