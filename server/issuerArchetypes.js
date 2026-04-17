const ARCHETYPES = ['operating_company', 'asset_manager', 'financial_other', 'directional_only'];

const CORE_ASSET_MANAGER_PATTERNS = [
  { pattern: /\bfee[- ]related earnings\b/i, weight: 6, label: 'fee-related earnings' },
  { pattern: /\bFRE\b/, weight: 4, label: 'FRE' },
  { pattern: /\bdistributable earnings\b/i, weight: 6, label: 'distributable earnings' },
  { pattern: /\bcarried interest\b/i, weight: 5, label: 'carried interest' },
  { pattern: /\bincentive fees?\b/i, weight: 4, label: 'incentive fees' },
  { pattern: /\bfee paying AUM\b/i, weight: 5, label: 'fee-paying AUM' },
  { pattern: /\bfee[- ]earning AUM\b/i, weight: 5, label: 'fee-earning AUM' },
  { pattern: /\bprivate equity\b/i, weight: 3, label: 'private equity' },
  { pattern: /\balternative asset management\b/i, weight: 5, label: 'alternative asset management' },
  { pattern: /\bbalance sheet investments\b/i, weight: 4, label: 'balance sheet investments' },
  { pattern: /\bprincipal investments\b/i, weight: 4, label: 'principal investments' },
];

const ASSET_MANAGER_PATTERNS = [
  { pattern: /\bassets? under management\b/i, weight: 5, label: 'assets under management' },
  { pattern: /\bAUM\b/, weight: 4, label: 'AUM' },
  ...CORE_ASSET_MANAGER_PATTERNS,
  { pattern: /\bmanagement fees?\b/i, weight: 4, label: 'management fees' },
  { pattern: /\badvisory fees?\b/i, weight: 4, label: 'advisory fees' },
  { pattern: /\bcredit\b/i, weight: 1, label: 'credit' },
  { pattern: /\breal assets?\b/i, weight: 2, label: 'real assets' },
];

const FINANCIAL_OTHER_PATTERNS = [
  { pattern: /\bnet interest income\b/i, weight: 5, label: 'net interest income' },
  { pattern: /\bCET1\b/i, weight: 5, label: 'CET1' },
  { pattern: /\bcommon equity tier 1\b/i, weight: 5, label: 'common equity tier 1' },
  { pattern: /\bdeposits\b/i, weight: 3, label: 'deposits' },
  { pattern: /\ballowance for credit losses\b/i, weight: 4, label: 'allowance for credit losses' },
  { pattern: /\bnet investment income\b/i, weight: 4, label: 'net investment income' },
  { pattern: /\bpremiums\b/i, weight: 4, label: 'premiums' },
  { pattern: /\bcombined ratio\b/i, weight: 5, label: 'combined ratio' },
  { pattern: /\bpolicyholder\b/i, weight: 3, label: 'policyholder' },
  { pattern: /\breserves\b/i, weight: 2, label: 'reserves' },
];

const DIRECTIONAL_PATTERNS = [
  { pattern: /\bFFO\b/, weight: 5, label: 'FFO' },
  { pattern: /\bAFFO\b/, weight: 5, label: 'AFFO' },
  { pattern: /\bbook value\b/i, weight: 3, label: 'book value' },
  { pattern: /\bstockholders[’'] equity\b/i, weight: 3, label: 'stockholders equity' },
  { pattern: /\bshareholders[’'] equity\b/i, weight: 3, label: 'shareholders equity' },
];

const OPCO_PATTERNS = [
  { pattern: /\bgross margin\b/i, weight: 3, label: 'gross margin' },
  { pattern: /\boperating margin\b/i, weight: 3, label: 'operating margin' },
  { pattern: /\bcapital expenditures\b/i, weight: 2, label: 'capital expenditures' },
  { pattern: /\bdepreciation and amortization\b/i, weight: 2, label: 'depreciation and amortization' },
  { pattern: /\brevenue\b/i, weight: 1, label: 'revenue' },
  { pattern: /\bproducts?\b/i, weight: 1, label: 'products' },
  { pattern: /\bservices?\b/i, weight: 1, label: 'services' },
];

export function detectIssuerArchetypeFromDeterministicSignals({ filingSource, deterministicExtraction }) {
  const text = buildTextCorpus({ filingSource, deterministicExtraction, filingExtraction: null });
  const scorecard = buildScorecard(text, deterministicExtraction, null);
  return finalizeArchetype(scorecard, 'deterministic_text_first');
}

export function refineIssuerArchetype({ provisionalArchetype, filingExtraction, deterministicExtraction, filingSource }) {
  const lockedAssetManager = provisionalArchetype?.archetype === 'asset_manager'
    && provisionalArchetype?.confidence === 'high'
    && provisionalArchetype?.hasCoreAssetManagerEvidence;
  if (lockedAssetManager) {
    return {
      ...provisionalArchetype,
      stage: 'refined',
      rationale: `${provisionalArchetype.rationale} Deterministic and text-first signals were already decisive, so AI framing was not allowed to force the issuer back into an operating-company template.`,
    };
  }

  const text = buildTextCorpus({ filingSource, deterministicExtraction, filingExtraction });
  const scorecard = buildScorecard(text, deterministicExtraction, filingExtraction);

  if (provisionalArchetype?.archetype === 'asset_manager') {
    scorecard.asset_manager += 2;
  }

  return finalizeArchetype(scorecard, 'refined_after_extraction');
}

function buildScorecard(text, deterministicExtraction, filingExtraction) {
  const scorecard = {
    operating_company: scorePatterns(text, OPCO_PATTERNS),
    asset_manager: scorePatterns(text, ASSET_MANAGER_PATTERNS),
    financial_other: scorePatterns(text, FINANCIAL_OTHER_PATTERNS),
    directional_only: scorePatterns(text, DIRECTIONAL_PATTERNS),
    hits: {
      operating_company: collectHits(text, OPCO_PATTERNS),
      asset_manager: collectHits(text, ASSET_MANAGER_PATTERNS),
      financial_other: collectHits(text, FINANCIAL_OTHER_PATTERNS),
      directional_only: collectHits(text, DIRECTIONAL_PATTERNS),
    },
    coreHits: {
      asset_manager: collectHits(text, CORE_ASSET_MANAGER_PATTERNS),
      financial_other: collectHits(text, FINANCIAL_OTHER_PATTERNS.filter((entry) => entry.weight >= 4)),
    },
    metricSignals: {
      assetManagerCore: 0,
      financialOtherCore: 0,
    },
  };

  const normalizedMetrics = deterministicExtraction?.normalizedMetrics || {};
  if (Number.isFinite(normalizedMetrics.revenueLtm)) scorecard.operating_company += 2;
  if (Number.isFinite(normalizedMetrics.grossMarginPct)) scorecard.operating_company += 2;
  if (Number.isFinite(normalizedMetrics.operatingMarginPct)) scorecard.operating_company += 2;

  const assetMetrics = flattenAssetManagerMetrics(deterministicExtraction?.assetManagerMetrics || filingExtraction?.assetManagerMetrics || {});
  if (Number.isFinite(assetMetrics.aum)) scorecard.asset_manager += 8;
  if (Number.isFinite(assetMetrics.feeRelatedEarnings)) {
    scorecard.asset_manager += 7;
    scorecard.metricSignals.assetManagerCore += 1;
  }
  if (Number.isFinite(assetMetrics.distributableEarnings)) {
    scorecard.asset_manager += 7;
    scorecard.metricSignals.assetManagerCore += 1;
  }
  if (Number.isFinite(assetMetrics.bookValue)) {
    scorecard.asset_manager += 2;
    scorecard.directional_only += 1;
  }
  if (Number.isFinite(assetMetrics.managementFees)) scorecard.asset_manager += 3;
  if (Number.isFinite(assetMetrics.performanceIncome)) {
    scorecard.asset_manager += 3;
    scorecard.metricSignals.assetManagerCore += 1;
  }
  if (Number.isFinite(assetMetrics.balanceSheetInvestments)) scorecard.metricSignals.assetManagerCore += 1;

  const bankSignals = [
    /net interest income/i,
    /common equity tier 1/i,
    /\bCET1\b/i,
    /deposits/i,
    /allowance for credit losses/i,
    /provision for credit losses/i,
  ];
  scorecard.metricSignals.financialOtherCore = bankSignals.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);

  const evidenceText = JSON.stringify({
    businessOverview: filingExtraction?.businessOverview || null,
    keyTakeaways: filingExtraction?.keyTakeaways || [],
    modelDrivers: filingExtraction?.modelDrivers || [],
  });
  if (/asset management|alternative asset|fee-related earnings|distributable earnings|AUM/i.test(evidenceText)) scorecard.asset_manager += 4;
  if (/net interest income|combined ratio|premiums|CET1|allowance for credit losses/i.test(evidenceText)) scorecard.financial_other += 4;
  if (/FFO|AFFO|book value/i.test(evidenceText)) scorecard.directional_only += 3;

  return scorecard;
}

function finalizeArchetype(scorecard, stage) {
  const ranked = ARCHETYPES
    .map((key) => ({ key, score: scorecard[key] || 0, hits: scorecard.hits?.[key] || [] }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0] || { key: 'directional_only', score: 0, hits: [] };
  const second = ranked[1] || { score: 0 };
  const hasCoreAssetManagerEvidence = (scorecard.coreHits?.asset_manager?.length || 0) > 0 || (scorecard.metricSignals?.assetManagerCore || 0) > 0;
  const hasStrongFinancialOtherEvidence = (scorecard.coreHits?.financial_other?.length || 0) >= 2 || (scorecard.metricSignals?.financialOtherCore || 0) >= 2;

  let archetype = top.key;
  if (top.score < 4) archetype = 'directional_only';
  if (top.key === 'asset_manager' && top.score >= 8) archetype = 'asset_manager';
  if (top.key === 'financial_other' && top.score >= Math.max(6, second.score + 1)) archetype = 'financial_other';
  if (top.key === 'directional_only' && top.score >= Math.max(5, second.score + 1)) archetype = 'directional_only';
  if (top.key === 'operating_company' && top.score >= Math.max(4, second.score)) archetype = 'operating_company';
  if (top.score === second.score && top.score > 0 && archetype !== 'asset_manager') archetype = 'directional_only';

  if (archetype === 'asset_manager' && !hasCoreAssetManagerEvidence && hasStrongFinancialOtherEvidence) {
    archetype = 'financial_other';
  }

  if (archetype === 'asset_manager' && !hasCoreAssetManagerEvidence && scorecard.financial_other >= Math.max(10, scorecard.asset_manager - 6)) {
    archetype = 'financial_other';
  }

  const selectedScore = ranked.find((item) => item.key === archetype)?.score || top.score;
  const confidence = selectedScore >= 10 || (archetype === 'asset_manager' && selectedScore >= 8)
    ? 'high'
    : selectedScore >= 5
      ? 'medium'
      : 'low';

  const hits = (ranked.find((item) => item.key === archetype)?.hits || []).slice(0, 6);
  const rationale = hits.length
    ? `Matched ${archetype.replace(/_/g, ' ')} signals: ${hits.join(', ')}.`
    : 'Signals were thin, so the issuer falls back to a cautious directional classification.';

  return {
    archetype,
    stage,
    confidence,
    rationale,
    hasCoreAssetManagerEvidence,
    hasStrongFinancialOtherEvidence,
    scores: Object.fromEntries(ARCHETYPES.map((key) => [key, scorecard[key] || 0])),
    hits: scorecard.hits || {},
    coreHits: scorecard.coreHits || {},
    metricSignals: scorecard.metricSignals || {},
    ranked,
  };
}

function buildTextCorpus({ filingSource, deterministicExtraction, filingExtraction }) {
  return [
    filingSource?.title,
    filingSource?.fallbackMetadata?.title,
    filingSource?.fallbackMetadata?.company,
    filingSource?.cleanedText?.slice(0, 50000),
    ...(filingSource?.promptSections || []).map((section) => section?.excerpt || ''),
    JSON.stringify(deterministicExtraction?.reportedFacts || []),
    JSON.stringify(deterministicExtraction?.derivedMetrics || []),
    JSON.stringify(deterministicExtraction?.assetManagerMetrics || {}),
    JSON.stringify(filingExtraction?.businessOverview || {}),
    JSON.stringify(filingExtraction?.keyTakeaways || []),
    JSON.stringify(filingExtraction?.modelDrivers || []),
    JSON.stringify(filingExtraction?.assetManagerMetrics || {}),
  ].filter(Boolean).join('\n');
}

function scorePatterns(text, patterns) {
  return patterns.reduce((sum, entry) => sum + (entry.pattern.test(text) ? entry.weight : 0), 0);
}

function collectHits(text, patterns) {
  return patterns.filter((entry) => entry.pattern.test(text)).map((entry) => entry.label);
}

function flattenAssetManagerMetrics(assetManagerMetrics = {}) {
  return Object.fromEntries(Object.entries(assetManagerMetrics || {}).map(([key, value]) => [key, Number.isFinite(value?.value) ? value.value : null]));
}
