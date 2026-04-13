import * as cheerio from 'cheerio';
import { fetchSecJsonResource, fetchSecTextResource, parseSecArchiveUrl } from './secLookup.js';

const MONEY_CONCEPTS = {
  revenue: [
    ['us-gaap', 'RevenueFromContractWithCustomerExcludingAssessedTax'],
    ['us-gaap', 'SalesRevenueNet'],
    ['us-gaap', 'Revenues'],
    ['us-gaap', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
  ],
  grossProfit: [
    ['us-gaap', 'GrossProfit'],
  ],
  operatingIncome: [
    ['us-gaap', 'OperatingIncomeLoss'],
  ],
  pretaxIncome: [
    ['us-gaap', 'IncomeBeforeTaxExpenseBenefit'],
    ['us-gaap', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest'],
    ['us-gaap', 'PretaxIncome'],
    ['us-gaap', 'IncomeBeforeEquityMethodInvestments'],
  ],
  incomeTaxExpense: [
    ['us-gaap', 'IncomeTaxExpenseBenefit'],
    ['us-gaap', 'IncomeTaxes'],
  ],
  effectiveTaxRate: [
    ['us-gaap', 'EffectiveIncomeTaxRateContinuingOperations'],
    ['us-gaap', 'EffectiveIncomeTaxRateReconciliationForeignTaxRateDifferential'],
  ],
  capex: [
    ['us-gaap', 'PaymentsToAcquirePropertyPlantAndEquipment'],
    ['us-gaap', 'CapitalExpendituresIncurredButNotYetPaid'],
    ['us-gaap', 'PaymentsToAcquireProductiveAssets'],
    ['us-gaap', 'PropertyPlantAndEquipmentAdditions'],
    ['us-gaap', 'CapitalExpendituresGross'],
  ],
  da: [
    ['us-gaap', 'DepreciationDepletionAndAmortization'],
    ['us-gaap', 'DepreciationAmortizationAndAccretionNet'],
    ['us-gaap', 'DepreciationAndAmortization'],
    ['us-gaap', 'Depreciation'],
  ],
  cash: [
    ['us-gaap', 'CashAndCashEquivalentsAtCarryingValue'],
    ['us-gaap', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  ],
  liquidInvestments: [
    ['us-gaap', 'MarketableSecuritiesCurrent'],
    ['us-gaap', 'AvailableForSaleSecuritiesCurrent'],
    ['us-gaap', 'ShortTermInvestments'],
    ['us-gaap', 'AvailableForSaleDebtSecuritiesCurrent'],
  ],
  debtTotal: [
    ['us-gaap', 'LongTermDebtAndFinanceLeaseObligations'],
    ['us-gaap', 'LongTermDebtAndCapitalLeaseObligations'],
    ['us-gaap', 'LongTermDebt'],
  ],
  debtCurrent: [
    ['us-gaap', 'LongTermDebtAndFinanceLeaseObligationsCurrent'],
    ['us-gaap', 'LongTermDebtAndCapitalLeaseObligationsCurrent'],
    ['us-gaap', 'LongTermDebtCurrent'],
  ],
  debtNonCurrent: [
    ['us-gaap', 'LongTermDebtAndFinanceLeaseObligationsNoncurrent'],
    ['us-gaap', 'LongTermDebtAndCapitalLeaseObligationsNoncurrent'],
    ['us-gaap', 'LongTermDebtNoncurrent'],
  ],
  shortTermBorrowings: [
    ['us-gaap', 'ShortTermBorrowings'],
    ['us-gaap', 'CommercialPaper'],
    ['us-gaap', 'ShortTermDebt'],
  ],
  accountsReceivableCurrent: [
    ['us-gaap', 'AccountsReceivableNetCurrent'],
    ['us-gaap', 'ReceivablesNetCurrent'],
    ['us-gaap', 'TradeReceivablesNetCurrent'],
  ],
  inventory: [
    ['us-gaap', 'InventoryNet'],
    ['us-gaap', 'InventoriesNetOfReserves'],
  ],
  accountsPayableCurrent: [
    ['us-gaap', 'AccountsPayableCurrent'],
    ['us-gaap', 'TradeAccountsPayableCurrent'],
  ],
  deferredRevenueCurrent: [
    ['us-gaap', 'ContractWithCustomerLiabilityCurrent'],
    ['us-gaap', 'DeferredRevenueCurrent'],
    ['us-gaap', 'ContractRevenueLiabilityCurrent'],
  ],
  dilutedShares: [
    ['us-gaap', 'WeightedAverageNumberOfDilutedSharesOutstanding'],
    ['us-gaap', 'WeightedAverageNumberOfShareOutstandingBasicAndDiluted'],
  ],
  sharesOutstanding: [
    ['dei', 'EntityCommonStockSharesOutstanding'],
  ],
};

const HARD_FIELD_ORDER = [
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

const TABLE_ROW_PATTERNS = {
  revenue: [/^total net sales$/i, /^net sales$/i, /^total revenue$/i, /^revenue$/i, /^revenues$/i],
  grossProfit: [/^gross profit$/i, /^gross margin$/i],
  operatingIncome: [/^operating income$/i, /^income from operations$/i, /^operating profit$/i],
  incomeTaxExpense: [/^provision for income taxes$/i, /^income tax expense/i, /^income taxes$/i],
  pretaxIncome: [/^income before provision for income taxes$/i, /^income before taxes$/i, /^earnings before income taxes$/i],
  cash: [/^cash and cash equivalents$/i],
  liquidInvestments: [/^marketable securities$/i, /^short.?term investments$/i, /^available.?for.?sale securities$/i],
  debtCurrent: [/^current portion of long.?term debt$/i, /^commercial paper$/i, /^short.?term debt$/i, /^short.?term borrowings$/i],
  debtNonCurrent: [/^long.?term debt$/i, /^long.?term debt, excluding current portion$/i],
  accountsReceivable: [/^accounts receivable/i, /^trade receivables?/i, /^receivables?, net$/i],
  inventory: [/^inventories$/i, /^inventory$/i],
  accountsPayable: [/^accounts payable$/i, /^trade accounts payable$/i],
  deferredRevenue: [/^deferred revenue$/i, /^contract liabilities$/i, /^contract liability, current$/i],
  capex: [/^purchases of property, plant and equipment$/i, /^purchases of property and equipment$/i, /^capital expenditures$/i, /^capital spending$/i, /^additions to property, plant and equipment$/i, /^property and equipment additions$/i, /^payments to acquire property, plant and equipment$/i, /^acquisitions of property, plant and equipment$/i],
  da: [/^depreciation and amortization$/i, /^depreciation, depletion and amortization$/i, /^depreciation$/i],
  dilutedShares: [/^diluted shares$/i, /^weighted average diluted shares$/i, /^weighted average shares diluted$/i],
};

export async function extractDeterministicFilingData(filingSource) {
  const filingContext = buildFilingContext(filingSource);
  const diagnostics = {
    filingSelection: filingContext ? summarizeFilingContext(filingContext) : null,
    unitApplications: [],
    structuredUsed: false,
    tableFallbackUsed: false,
    tableReports: [],
    fieldSources: {},
  };

  let structured = createEmptyDeterministicPacket();
  let tableFallback = createEmptyDeterministicPacket();

  if (filingContext) {
    structured = await extractStructuredPacket(filingContext, diagnostics);
  }

  if (needsTableFallback(structured)) {
    tableFallback = await extractTableFallbackPacket(filingSource, filingContext, diagnostics);
  }

  const merged = mergeDeterministicPackets(structured, tableFallback, filingSource?.fallbackMetadata || {}, diagnostics);
  merged.diagnostics = diagnostics;
  merged.promptPacket = buildPromptPacket(merged);
  return merged;
}

export function buildPromptPacket(packet) {
  return {
    filingSelection: packet.filingSelection,
    normalizedMetrics: packet.normalizedMetrics,
    historicalMetrics: packet.historicalMetrics || {},
    hardFieldSources: packet.fieldSources,
    reviewFlags: packet.reviewFlags,
    missingBaseInputs: packet.missingBaseInputs,
    reportedFacts: packet.reportedFacts.slice(0, 16),
    derivedMetrics: packet.derivedMetrics.slice(0, 12),
  };
}

function createEmptyDeterministicPacket() {
  return {
    filingMetadata: {},
    normalizedMetrics: {
      revenueLtm: null,
      revenueHistoricalGrowthPct: null,
      revenueComparableGrowthPct: null,
      revenuePriorAnnualGrowthPct: null,
      grossMarginPct: null,
      operatingMarginPct: null,
      taxRatePct: null,
      capexPctRevenue: null,
      daPctRevenue: null,
      operatingWorkingCapital: null,
      operatingWorkingCapitalPct: null,
      accountsReceivable: null,
      accountsReceivablePctRevenue: null,
      inventory: null,
      inventoryPctRevenue: null,
      accountsPayable: null,
      accountsPayablePctRevenue: null,
      deferredRevenue: null,
      deferredRevenuePctRevenue: null,
      shareCount: null,
      cash: null,
      debt: null,
      netDebt: null,
      liquidity: null,
    },
    historicalMetrics: {},
    reportedFacts: [],
    derivedMetrics: [],
    reviewFlags: [],
    missingBaseInputs: [],
    confidenceMap: {},
    evidenceMap: {},
    fieldSources: {},
    filingSelection: null,
  };
}

function buildFilingContext(filingSource) {
  const secResolution = filingSource?.secResolution;
  if (secResolution?.filing && secResolution?.cik) {
    return {
      cik: String(Number(secResolution.cik)),
      accessionNumber: secResolution.filing.accessionNumber,
      accessionNoDashes: String(secResolution.filing.accessionNumber || '').replace(/-/g, ''),
      filingUrl: secResolution.filingUrl,
      primaryDocument: secResolution.filing.primaryDocument,
      filingDate: secResolution.filing.filingDate || null,
      reportDate: secResolution.filing.reportDate || null,
      form: secResolution.filing.form || filingSource?.fallbackMetadata?.filingType || null,
      fiscalQuarter: secResolution.filingQuarter || filingSource?.fallbackMetadata?.fiscalQuarter || null,
      fiscalYear: secResolution.fiscalYear || filingSource?.fallbackMetadata?.fiscalYear || null,
      companyName: secResolution.companyName || filingSource?.fallbackMetadata?.company || null,
    };
  }

  if (filingSource?.sourceUrl) {
    const parsed = parseSecArchiveUrl(filingSource.sourceUrl);
    if (parsed?.cik && parsed?.accessionNoDashes) {
      return {
        cik: parsed.cik,
        accessionNumber: parsed.accessionNumber,
        accessionNoDashes: parsed.accessionNoDashes,
        filingUrl: filingSource.sourceUrl,
        primaryDocument: parsed.primaryDocument,
        filingDate: filingSource?.fallbackMetadata?.filingDate || null,
        reportDate: filingSource?.fallbackMetadata?.period || null,
        form: filingSource?.fallbackMetadata?.filingType || null,
        fiscalQuarter: filingSource?.fallbackMetadata?.fiscalQuarter || null,
        fiscalYear: filingSource?.fallbackMetadata?.fiscalYear || null,
        companyName: filingSource?.fallbackMetadata?.company || null,
      };
    }
  }

  return null;
}

function summarizeFilingContext(context) {
  if (!context) return null;
  return {
    company: context.companyName || null,
    cik: context.cik,
    accessionNumber: context.accessionNumber,
    filingUrl: context.filingUrl,
    form: context.form,
    filingDate: context.filingDate,
    reportDate: context.reportDate,
    fiscalQuarter: context.fiscalQuarter,
    fiscalYear: context.fiscalYear,
  };
}

async function extractStructuredPacket(context, diagnostics) {
  const packet = createEmptyDeterministicPacket();
  packet.filingSelection = summarizeFilingContext(context);
  const companyFacts = await fetchSecJsonResource(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(context.cik).padStart(10, '0')}.json`);
  diagnostics.structuredUsed = true;
  const revenueConceptMatch = findConceptMatch(companyFacts, MONEY_CONCEPTS.revenue);
  const revenueEntries = revenueConceptMatch ? getEntries(revenueConceptMatch) : [];

  const revenueSeries = buildDurationMetric(companyFacts, context, MONEY_CONCEPTS.revenue, 'Revenue');
  const grossProfitSeries = buildDurationMetric(companyFacts, context, MONEY_CONCEPTS.grossProfit, 'Gross profit');
  const operatingIncomeSeries = buildDurationMetric(companyFacts, context, MONEY_CONCEPTS.operatingIncome, 'Operating income');
  const pretaxSeries = buildDurationMetric(companyFacts, context, MONEY_CONCEPTS.pretaxIncome, 'Pretax income');
  const taxExpenseSeries = buildDurationMetric(companyFacts, context, MONEY_CONCEPTS.incomeTaxExpense, 'Income tax expense');
  const capexSeries = buildDurationMetric(companyFacts, context, MONEY_CONCEPTS.capex, 'Capital expenditures');
  const daSeries = buildDurationMetric(companyFacts, context, MONEY_CONCEPTS.da, 'Depreciation & amortization');
  const taxRateFact = buildPercentMetric(companyFacts, context, MONEY_CONCEPTS.effectiveTaxRate, 'Effective tax rate');

  const cashFact = buildInstantMetric(companyFacts, context, MONEY_CONCEPTS.cash, 'Cash and cash equivalents');
  const liquidInvestmentsFact = buildInstantMetric(companyFacts, context, MONEY_CONCEPTS.liquidInvestments, 'Short-term investments');
  const debtCurrentFact = buildInstantMetric(companyFacts, context, MONEY_CONCEPTS.debtCurrent, 'Current debt');
  const debtNonCurrentFact = buildInstantMetric(companyFacts, context, MONEY_CONCEPTS.debtNonCurrent, 'Non-current debt');
  const debtTotalFact = buildInstantMetric(companyFacts, context, MONEY_CONCEPTS.debtTotal, 'Long-term debt total');
  const shortTermBorrowingsFact = buildInstantMetric(companyFacts, context, MONEY_CONCEPTS.shortTermBorrowings, 'Short-term borrowings');
  const accountsReceivableFact = buildInstantMetric(companyFacts, context, MONEY_CONCEPTS.accountsReceivableCurrent, 'Accounts receivable');
  const inventoryFact = buildInstantMetric(companyFacts, context, MONEY_CONCEPTS.inventory, 'Inventory');
  const accountsPayableFact = buildInstantMetric(companyFacts, context, MONEY_CONCEPTS.accountsPayableCurrent, 'Accounts payable');
  const deferredRevenueFact = buildInstantMetric(companyFacts, context, MONEY_CONCEPTS.deferredRevenueCurrent, 'Deferred revenue / contract liabilities');
  const dilutedSharesFact = buildDurationMetric(companyFacts, context, MONEY_CONCEPTS.dilutedShares, 'Diluted weighted average shares', { preferDurationForShares: true });
  const sharesOutstandingFact = buildInstantMetric(companyFacts, context, MONEY_CONCEPTS.sharesOutstanding, 'Shares outstanding', { valueType: 'shares' });

  const liquidity = addFinite(cashFact?.value, liquidInvestmentsFact?.value);
  const debt = deriveDebtValue(debtTotalFact, debtCurrentFact, debtNonCurrentFact, shortTermBorrowingsFact);
  const shareCount = firstFinite(dilutedSharesFact?.ltmValue, dilutedSharesFact?.currentValue, sharesOutstandingFact?.value);
  const revenueLtm = revenueSeries?.ltmValue ?? null;
  const grossProfitLtm = grossProfitSeries?.ltmValue ?? null;
  const operatingIncomeLtm = operatingIncomeSeries?.ltmValue ?? null;
  const pretaxIncomeLtm = pretaxSeries?.ltmValue ?? null;
  const taxExpenseLtm = taxExpenseSeries?.ltmValue ?? null;
  const capexLtm = capexSeries?.ltmValue ?? null;
  const daLtm = daSeries?.ltmValue ?? null;
  const grossMarginPct = computeRatio(grossProfitLtm, revenueLtm);
  const operatingMarginPct = computeRatio(operatingIncomeLtm, revenueLtm);
  const derivedTaxRatePct = computeRatio(taxExpenseLtm, pretaxIncomeLtm, { allowNegativeDenominator: false });
  const taxRatePct = firstFinite(taxRateFact?.value, derivedTaxRatePct);
  const capexPctRevenue = computeRatio(capexLtm, revenueLtm);
  const daPctRevenue = computeRatio(daLtm, revenueLtm);
  const operatingWorkingCapital = buildOperatingWorkingCapital({
    accountsReceivable: accountsReceivableFact?.value,
    inventory: inventoryFact?.value,
    accountsPayable: accountsPayableFact?.value,
    deferredRevenue: deferredRevenueFact?.value,
  });
  const operatingWorkingCapitalPct = computeRatio(operatingWorkingCapital, revenueLtm);
  const netDebt = Number.isFinite(debt) && Number.isFinite(liquidity)
    ? debt - liquidity
    : Number.isFinite(debt) && Number.isFinite(cashFact?.value)
      ? debt - cashFact.value
      : null;

  packet.filingMetadata = {
    company: context.companyName || null,
    filingType: context.form || null,
    filingDate: context.filingDate || null,
    fiscalQuarter: context.fiscalQuarter || null,
    fiscalYear: context.fiscalYear || null,
    reportingPeriod: buildReportingPeriodLabel(context.fiscalQuarter, context.fiscalYear),
  };

  const revenueHistoricalGrowthPct = Number.isFinite(revenueSeries?.priorAnnualValue) && Number.isFinite(revenueLtm) && revenueSeries.priorAnnualValue > 0
    ? ((revenueLtm / revenueSeries.priorAnnualValue) - 1) * 100
    : null;
  const revenueComparableGrowthPct = Number.isFinite(revenueSeries?.currentValue) && Number.isFinite(revenueSeries?.comparableValue) && revenueSeries.comparableValue > 0
    ? ((revenueSeries.currentValue / revenueSeries.comparableValue) - 1) * 100
    : null;
  const priorPriorAnnual = revenueEntries.length && revenueSeries?.priorAnnual?.end
    ? choosePriorAnnualEntry(revenueEntries, revenueSeries.priorAnnual.end)
    : null;
  const priorPriorAnnualValue = normalizeFactValue(priorPriorAnnual, 'money');
  const revenuePriorAnnualGrowthPct = Number.isFinite(revenueSeries?.priorAnnualValue) && Number.isFinite(priorPriorAnnualValue) && priorPriorAnnualValue > 0
    ? ((revenueSeries.priorAnnualValue / priorPriorAnnualValue) - 1) * 100
    : null;

  packet.normalizedMetrics = {
    revenueLtm,
    revenueHistoricalGrowthPct,
    revenueComparableGrowthPct,
    revenuePriorAnnualGrowthPct,
    grossMarginPct,
    operatingMarginPct,
    taxRatePct,
    capexPctRevenue,
    daPctRevenue,
    operatingWorkingCapital,
    operatingWorkingCapitalPct,
    accountsReceivable: accountsReceivableFact?.value ?? null,
    accountsReceivablePctRevenue: computeRatio(accountsReceivableFact?.value, revenueLtm),
    inventory: inventoryFact?.value ?? null,
    inventoryPctRevenue: computeRatio(inventoryFact?.value, revenueLtm),
    accountsPayable: accountsPayableFact?.value ?? null,
    accountsPayablePctRevenue: computeRatio(accountsPayableFact?.value, revenueLtm),
    deferredRevenue: deferredRevenueFact?.value ?? null,
    deferredRevenuePctRevenue: computeRatio(deferredRevenueFact?.value, revenueLtm),
    shareCount,
    cash: cashFact?.value ?? null,
    debt,
    netDebt,
    liquidity,
  };
  packet.historicalMetrics = {
    revenueCurrentPeriod: revenueSeries?.currentValue ?? null,
    revenuePriorComparable: revenueSeries?.comparableValue ?? null,
    revenuePriorAnnual: revenueSeries?.priorAnnualValue ?? null,
    revenueHistoricalGrowthPct,
    revenueComparableGrowthPct,
    revenuePriorAnnualGrowthPct,
  };

  const fieldSources = {
    currentRevenue: buildDurationFieldSource('currentRevenue', revenueSeries),
    grossMarginStart: buildDerivedFieldSource('grossMarginStart', grossMarginPct, [grossProfitSeries, revenueSeries], 'Gross profit / revenue'),
    operatingMarginStart: buildDerivedFieldSource('operatingMarginStart', operatingMarginPct, [operatingIncomeSeries, revenueSeries], 'Operating income / revenue'),
    taxRate: taxRateFact
      ? buildPercentFieldSource('taxRate', taxRateFact)
      : buildDerivedFieldSource('taxRate', derivedTaxRatePct, [taxExpenseSeries, pretaxSeries], 'Income tax expense / pretax income'),
    capexPct: buildDerivedFieldSource('capexPct', capexPctRevenue, [capexSeries, revenueSeries], 'Capital expenditures / revenue'),
    daPct: buildDerivedFieldSource('daPct', daPctRevenue, [daSeries, revenueSeries], 'D&A / revenue'),
    shareCount: dilutedSharesFact
      ? buildDurationFieldSource('shareCount', dilutedSharesFact, { valueType: 'shares' })
      : buildInstantFieldSource('shareCount', sharesOutstandingFact, { valueType: 'shares', classification: 'reported' }),
    cash: buildInstantFieldSource('cash', cashFact),
    debt: buildDebtFieldSource(debt, debtTotalFact, debtCurrentFact, debtNonCurrentFact, shortTermBorrowingsFact),
    netDebt: buildNetDebtFieldSource(netDebt, debt, cashFact?.value, liquidity, debtTotalFact, debtCurrentFact, debtNonCurrentFact, shortTermBorrowingsFact, cashFact, liquidInvestmentsFact),
  };

  packet.fieldSources = stripEmptyFieldSources(fieldSources);
  packet.reportedFacts = buildReportedFactsFromStructured({
    revenueSeries,
    grossProfitSeries,
    operatingIncomeSeries,
    taxRateFact,
    capexSeries,
    daSeries,
    cashFact,
    liquidInvestmentsFact,
    debt,
    shareCount,
    fieldSources: packet.fieldSources,
  });
  packet.derivedMetrics = buildDerivedMetricsFromStructured({
    grossMarginPct,
    operatingMarginPct,
    taxRatePct,
    capexPctRevenue,
    daPctRevenue,
    netDebt,
    liquidity,
    revenueSeries,
    grossProfitSeries,
    operatingIncomeSeries,
    capexSeries,
    daSeries,
    taxExpenseSeries,
    pretaxSeries,
    operatingWorkingCapitalPct,
    accountsReceivableFact,
    inventoryFact,
    accountsPayableFact,
    deferredRevenueFact,
  });

  packet.confidenceMap = Object.fromEntries(Object.entries(packet.fieldSources).map(([field, meta]) => [field, meta.confidence]));
  packet.evidenceMap = Object.fromEntries(Object.entries(packet.fieldSources).map(([field, meta]) => [field, meta.evidence]));
  packet.reviewFlags = buildStructuredReviewFlags(packet.normalizedMetrics, packet.fieldSources);
  packet.missingBaseInputs = buildMissingBaseInputs(packet.normalizedMetrics, packet.fieldSources);

  Object.assign(diagnostics.fieldSources, packet.fieldSources);
  return packet;
}

function buildReportedFactsFromStructured(input) {
  const facts = [];
  pushReportedFact(facts, input.revenueSeries, 'revenue', 'Revenue / sales');
  pushReportedFact(facts, input.grossProfitSeries, 'margin', 'Gross profit');
  pushReportedFact(facts, input.operatingIncomeSeries, 'margin', 'Operating income');
  pushReportedFact(facts, input.capexSeries, 'cash_flow', 'Capital expenditures');
  pushReportedFact(facts, input.daSeries, 'cash_flow', 'Depreciation & amortization');

  if (Number.isFinite(input.cashFact?.value)) {
    facts.push({
      metric: 'Cash and cash equivalents',
      valueText: formatMillions(input.cashFact.value),
      category: 'balance_sheet',
      evidence: input.cashFact.evidence,
      confidence: 'high',
    });
  }

  if (Number.isFinite(input.liquidInvestmentsFact?.value)) {
    facts.push({
      metric: 'Short-term investments / marketable securities',
      valueText: formatMillions(input.liquidInvestmentsFact.value),
      category: 'balance_sheet',
      evidence: input.liquidInvestmentsFact.evidence,
      confidence: 'medium',
    });
  }

  if (Number.isFinite(input.debt)) {
    const source = input.fieldSources?.debt;
    facts.push({
      metric: 'Debt',
      valueText: formatMillions(input.debt),
      category: 'balance_sheet',
      evidence: source?.evidence || 'Derived from debt disclosures',
      confidence: source?.confidence || 'medium',
    });
  }

  if (Number.isFinite(input.shareCount)) {
    const source = input.fieldSources?.shareCount;
    facts.push({
      metric: 'Diluted shares / shares outstanding',
      valueText: `${round1(input.shareCount)} mm`,
      category: 'balance_sheet',
      evidence: source?.evidence || 'Derived from filing share count disclosures',
      confidence: source?.confidence || 'medium',
    });
  }

  if (Number.isFinite(input.taxRateFact?.value)) {
    facts.push({
      metric: 'Effective tax rate',
      valueText: `${round1(input.taxRateFact.value)}%`,
      category: 'margin',
      evidence: input.taxRateFact.evidence,
      confidence: input.taxRateFact.confidence,
    });
  }

  return facts;
}

function pushReportedFact(facts, series, category, label) {
  if (!series?.currentValue && !series?.ltmValue) return;
  const value = Number.isFinite(series.ltmValue) ? series.ltmValue : series.currentValue;
  const suffix = series.basis === 'annual' ? 'annual' : series.basis === 'ltm' ? 'LTM' : series.basis || 'current';
  facts.push({
    metric: label,
    valueText: `${formatMillions(value)} (${suffix})`,
    category,
    evidence: series.evidence,
    confidence: series.confidence,
  });
}

function buildDerivedMetricsFromStructured(input) {
  const metrics = [];
  pushDerivedMetric(metrics, 'Gross margin', input.grossMarginPct, 'Gross profit / revenue', [input.grossProfitSeries, input.revenueSeries]);
  pushDerivedMetric(metrics, 'Operating margin', input.operatingMarginPct, 'Operating income / revenue', [input.operatingIncomeSeries, input.revenueSeries]);
  pushDerivedMetric(metrics, 'Tax rate', input.taxRatePct, 'Income tax expense / pretax income', [input.taxExpenseSeries, input.pretaxSeries]);
  pushDerivedMetric(metrics, 'Capex / revenue', input.capexPctRevenue, 'Capital expenditures / revenue', [input.capexSeries, input.revenueSeries]);
  pushDerivedMetric(metrics, 'D&A / revenue', input.daPctRevenue, 'D&A / revenue', [input.daSeries, input.revenueSeries]);
  pushDerivedMetric(
    metrics,
    'Operating working capital / revenue',
    input.operatingWorkingCapitalPct,
    'Accounts receivable + inventory - accounts payable - deferred revenue, divided by revenue',
    [input.accountsReceivableFact, input.inventoryFact, input.accountsPayableFact, input.deferredRevenueFact, input.revenueSeries]
  );
  if (Number.isFinite(input.netDebt)) {
    metrics.push({
      metric: 'Net debt / (cash)',
      value: formatMillions(input.netDebt),
      logic: Number.isFinite(input.liquidity) ? 'Debt less cash and current investments' : 'Debt less cash',
      evidence: 'Derived from current debt and liquidity balances in the filing',
      confidence: Number.isFinite(input.liquidity) ? 'high' : 'medium',
    });
  }
  return metrics;
}

function pushDerivedMetric(metrics, metric, value, logic, evidences) {
  if (!Number.isFinite(value)) return;
  metrics.push({
    metric,
    value: `${round1(value)}%`,
    logic,
    evidence: evidences.filter(Boolean).map((item) => item?.evidence).filter(Boolean).join(' | '),
    confidence: evidences.some((item) => item?.confidence === 'low') ? 'medium' : 'high',
  });
}

function buildStructuredReviewFlags(normalizedMetrics, fieldSources) {
  const flags = [];
  const revenueSource = fieldSources.currentRevenue;
  if (revenueSource?.basis && /annualized/i.test(revenueSource.basis)) {
    flags.push({
      item: 'Revenue base annualized from interim disclosure',
      reason: 'LTM revenue was not directly available from structured SEC data and was annualized from a shorter period.',
      evidence: revenueSource.evidence,
      confidence: 'medium',
    });
  }

  if (!Number.isFinite(normalizedMetrics.revenueLtm)) {
    flags.push({
      item: 'Revenue base unresolved',
      reason: 'Structured SEC facts did not yield a reliable revenue base.',
      evidence: 'No structured revenue fact matched the selected filing period.',
      confidence: 'high',
    });
  }

  if (!Number.isFinite(normalizedMetrics.shareCount)) {
    flags.push({
      item: 'Share count unresolved',
      reason: 'No reliable diluted share or outstanding share fact was found for the filing.',
      evidence: 'Share-count concepts were missing or ambiguous in structured SEC data.',
      confidence: 'high',
    });
  }

  if (!Number.isFinite(normalizedMetrics.debt)) {
    flags.push({
      item: 'Debt unresolved',
      reason: 'Debt balances could not be deterministically assembled from current and non-current debt facts.',
      evidence: 'Debt concepts were missing or incomplete in structured SEC data.',
      confidence: 'medium',
    });
  }

  return flags;
}

function buildMissingBaseInputs(normalizedMetrics, fieldSources) {
  const fields = [
    ['currentRevenue', normalizedMetrics.revenueLtm],
    ['shareCount', normalizedMetrics.shareCount],
    ['netDebt', normalizedMetrics.netDebt],
    ['grossMarginStart', normalizedMetrics.grossMarginPct],
    ['operatingMarginStart', normalizedMetrics.operatingMarginPct],
    ['taxRate', normalizedMetrics.taxRatePct],
    ['capexPct', normalizedMetrics.capexPctRevenue],
    ['daPct', normalizedMetrics.daPctRevenue],
  ];

  return fields
    .filter(([, value]) => !Number.isFinite(value))
    .map(([field]) => ({
      field,
      reason: fieldSources[field]?.evidence || 'Deterministic SEC extraction did not produce a high-confidence value.',
    }));
}

async function extractTableFallbackPacket(filingSource, context, diagnostics) {
  const packet = createEmptyDeterministicPacket();
  const reportTables = await loadStatementTables(filingSource, context, diagnostics);
  if (!reportTables.length) return packet;

  diagnostics.tableFallbackUsed = true;
  diagnostics.tableReports = reportTables.map((table) => ({ name: table.name, unitHeader: table.unitHeader, columnHeaders: table.columnHeaders }));

  const statements = indexTablesByKind(reportTables);
  const incomeTable = statements.income;
  const balanceTable = statements.balance;
  const cashFlowTable = statements.cashFlow;

  const revenue = findTableMetric(incomeTable, TABLE_ROW_PATTERNS.revenue, { valueType: 'money' });
  const grossProfit = findTableMetric(incomeTable, TABLE_ROW_PATTERNS.grossProfit, { valueType: 'money' });
  const operatingIncome = findTableMetric(incomeTable, TABLE_ROW_PATTERNS.operatingIncome, { valueType: 'money' });
  const pretaxIncome = findTableMetric(incomeTable, TABLE_ROW_PATTERNS.pretaxIncome, { valueType: 'money' });
  const taxExpense = findTableMetric(incomeTable, TABLE_ROW_PATTERNS.incomeTaxExpense, { valueType: 'money' });
  const cash = findTableMetric(balanceTable, TABLE_ROW_PATTERNS.cash, { valueType: 'money' });
  const liquidInvestments = findTableMetric(balanceTable, TABLE_ROW_PATTERNS.liquidInvestments, { valueType: 'money' });
  const debtCurrent = sumTableMetrics(balanceTable, TABLE_ROW_PATTERNS.debtCurrent, { valueType: 'money' });
  const debtNonCurrent = findTableMetric(balanceTable, TABLE_ROW_PATTERNS.debtNonCurrent, { valueType: 'money' });
  const capex = findTableMetric(cashFlowTable, TABLE_ROW_PATTERNS.capex, { valueType: 'money', absolute: true });
  const da = findTableMetric(cashFlowTable, TABLE_ROW_PATTERNS.da, { valueType: 'money', absolute: true });
  const dilutedShares = findTableMetric(incomeTable, TABLE_ROW_PATTERNS.dilutedShares, { valueType: 'shares' });
  const accountsReceivable = findTableMetric(balanceTable, TABLE_ROW_PATTERNS.accountsReceivable, { valueType: 'money' });
  const inventory = findTableMetric(balanceTable, TABLE_ROW_PATTERNS.inventory, { valueType: 'money' });
  const accountsPayable = findTableMetric(balanceTable, TABLE_ROW_PATTERNS.accountsPayable, { valueType: 'money' });
  const deferredRevenue = findTableMetric(balanceTable, TABLE_ROW_PATTERNS.deferredRevenue, { valueType: 'money' });

  const revenueBase = deriveRevenueFromTable(revenue, context, incomeTable);
  const revenueForIncomeStatementRatios = revenue?.value ?? revenueBase?.value ?? null;
  const cashFlowBasis = cashFlowTable ? inferTableBasis(cashFlowTable) : null;
  const incomeBasis = incomeTable ? inferTableBasis(incomeTable) : null;
  const revenueForCashFlowRatios = incomeBasis && cashFlowBasis && incomeBasis === cashFlowBasis
    ? (revenue?.value ?? revenueBase?.value ?? null)
    : cashFlowBasis === 'annual' && Number.isFinite(revenueBase?.value)
      ? revenueBase.value
      : null;
  const liquidity = addFinite(cash?.value, liquidInvestments?.value);
  const debt = addFinite(debtCurrent?.value, debtNonCurrent?.value);
  const operatingWorkingCapital = buildOperatingWorkingCapital({
    accountsReceivable: accountsReceivable?.value,
    inventory: inventory?.value,
    accountsPayable: accountsPayable?.value,
    deferredRevenue: deferredRevenue?.value,
  });
  const netDebt = Number.isFinite(debt) && Number.isFinite(liquidity)
    ? debt - liquidity
    : Number.isFinite(debt) && Number.isFinite(cash?.value)
      ? debt - cash.value
      : null;

  packet.normalizedMetrics = {
    revenueLtm: revenueBase?.value ?? null,
    revenueHistoricalGrowthPct: null,
    revenueComparableGrowthPct: null,
    revenuePriorAnnualGrowthPct: null,
    grossMarginPct: computeRatio(grossProfit?.value, revenueForIncomeStatementRatios),
    operatingMarginPct: computeRatio(operatingIncome?.value, revenueForIncomeStatementRatios),
    taxRatePct: computeRatio(taxExpense?.value, pretaxIncome?.value),
    capexPctRevenue: computeRatio(capex?.value, revenueForCashFlowRatios),
    daPctRevenue: computeRatio(da?.value, revenueForCashFlowRatios),
    operatingWorkingCapital,
    operatingWorkingCapitalPct: computeRatio(operatingWorkingCapital, revenueBase?.value ?? null),
    accountsReceivable: accountsReceivable?.value ?? null,
    accountsReceivablePctRevenue: computeRatio(accountsReceivable?.value, revenueBase?.value ?? null),
    inventory: inventory?.value ?? null,
    inventoryPctRevenue: computeRatio(inventory?.value, revenueBase?.value ?? null),
    accountsPayable: accountsPayable?.value ?? null,
    accountsPayablePctRevenue: computeRatio(accountsPayable?.value, revenueBase?.value ?? null),
    deferredRevenue: deferredRevenue?.value ?? null,
    deferredRevenuePctRevenue: computeRatio(deferredRevenue?.value, revenueBase?.value ?? null),
    shareCount: dilutedShares?.value ?? null,
    cash: cash?.value ?? null,
    debt,
    netDebt,
    liquidity,
  };

  packet.fieldSources = stripEmptyFieldSources({
    currentRevenue: buildTableFieldSource('currentRevenue', revenueBase, 'Revenue base from primary financial statement table'),
    grossMarginStart: buildTableDerivedSource('grossMarginStart', computeRatio(grossProfit?.value, revenueForIncomeStatementRatios), [grossProfit, revenue], 'Gross profit / revenue from filing tables'),
    operatingMarginStart: buildTableDerivedSource('operatingMarginStart', computeRatio(operatingIncome?.value, revenueForIncomeStatementRatios), [operatingIncome, revenue], 'Operating income / revenue from filing tables'),
    taxRate: buildTableDerivedSource('taxRate', computeRatio(taxExpense?.value, pretaxIncome?.value), [taxExpense, pretaxIncome], 'Income tax expense / pretax income from filing tables'),
    capexPct: buildTableDerivedSource('capexPct', computeRatio(capex?.value, revenueForCashFlowRatios), [capex, revenueBase], 'Capex / revenue from filing tables'),
    daPct: buildTableDerivedSource('daPct', computeRatio(da?.value, revenueForCashFlowRatios), [da, revenueBase], 'D&A / revenue from filing tables'),
    shareCount: buildTableFieldSource('shareCount', dilutedShares, 'Diluted shares from filing table', { valueType: 'shares' }),
    cash: buildTableFieldSource('cash', cash, 'Cash from balance sheet table'),
    debt: buildTableFieldSource('debt', Number.isFinite(debt) ? { value: debt, evidence: [debtCurrent?.evidence, debtNonCurrent?.evidence].filter(Boolean).join(' | '), confidence: 'medium' } : null, 'Debt assembled from filing table'),
    netDebt: buildTableFieldSource('netDebt', Number.isFinite(netDebt) ? { value: netDebt, evidence: [cash?.evidence, debtCurrent?.evidence, debtNonCurrent?.evidence].filter(Boolean).join(' | '), confidence: 'medium' } : null, 'Net debt derived from filing table'),
  });

  packet.reportedFacts = [
    revenueBase && makeTableFact('Revenue / sales', revenueBase.value, 'revenue', revenueBase.evidence),
    grossProfit && makeTableFact('Gross profit', grossProfit.value, 'margin', grossProfit.evidence),
    operatingIncome && makeTableFact('Operating income', operatingIncome.value, 'margin', operatingIncome.evidence),
    cash && makeTableFact('Cash and cash equivalents', cash.value, 'balance_sheet', cash.evidence),
    Number.isFinite(debt) ? makeTableFact('Debt', debt, 'balance_sheet', [debtCurrent?.evidence, debtNonCurrent?.evidence].filter(Boolean).join(' | ')) : null,
  ].filter(Boolean);

  packet.derivedMetrics = [
    makeDerivedPctFact('Gross margin', packet.normalizedMetrics.grossMarginPct, 'Gross profit / revenue from filing table', [grossProfit, revenueBase]),
    makeDerivedPctFact('Operating margin', packet.normalizedMetrics.operatingMarginPct, 'Operating income / revenue from filing table', [operatingIncome, revenueBase]),
    makeDerivedPctFact('Tax rate', packet.normalizedMetrics.taxRatePct, 'Tax expense / pretax income from filing table', [taxExpense, pretaxIncome]),
    makeDerivedPctFact('Operating working capital / revenue', packet.normalizedMetrics.operatingWorkingCapitalPct, 'Accounts receivable + inventory - accounts payable - deferred revenue, divided by revenue', [accountsReceivable, inventory, accountsPayable, deferredRevenue, revenueBase]),
  ].filter(Boolean);

  packet.reviewFlags = [];
  if (context?.form === '10-Q' && revenueBase?.basis !== 'ltm') {
    packet.reviewFlags.push({
      item: 'Interim revenue base inferred from filing table',
      reason: 'Structured SEC facts were unavailable, so the table fallback could not build a full LTM bridge with the same confidence as companyfacts.',
      evidence: revenueBase?.evidence || 'Filing income statement table.',
      confidence: 'medium',
    });
  }

  packet.missingBaseInputs = buildMissingBaseInputs(packet.normalizedMetrics, packet.fieldSources);
  return packet;
}

async function loadStatementTables(filingSource, context, diagnostics) {
  if (context?.cik && context?.accessionNoDashes) {
    try {
      return await loadStatementTablesFromFilingSummary(context, diagnostics);
    } catch {
      // Fall back to parsing the primary HTML when FilingSummary-based extraction is unavailable.
    }
  }

  if (filingSource?.rawText && /<table/i.test(filingSource.rawText)) {
    return parseTablesFromHtmlDocument(filingSource.rawText, filingSource.sourceUrl || 'Primary filing HTML');
  }

  return [];
}

async function loadStatementTablesFromFilingSummary(context, diagnostics) {
  const baseUrl = `https://www.sec.gov/Archives/edgar/data/${String(Number(context.cik))}/${context.accessionNoDashes}`;
  const filingSummaryXml = await fetchSecTextResource(`${baseUrl}/FilingSummary.xml`);
  const $ = cheerio.load(filingSummaryXml, { xmlMode: true });
  const reports = [];
  $('MyReports > Report').each((_index, node) => {
    reports.push({
      htmlFileName: $(node).find('HtmlFileName').text().trim(),
      shortName: $(node).find('ShortName').text().trim(),
      longName: $(node).find('LongName').text().trim(),
      menuCategory: $(node).find('MenuCategory').text().trim(),
    });
  });

  const selected = reports.filter((report) => /statement/i.test(report.menuCategory) && /operations|income|balance|cash/i.test(report.shortName));
  const tables = [];
  for (const report of selected) {
    if (!report.htmlFileName) continue;
    const html = await fetchSecTextResource(`${baseUrl}/${report.htmlFileName}`);
    const parsed = parseSingleStatementTable(html, `${baseUrl}/${report.htmlFileName}`, report.shortName);
    if (parsed) tables.push(parsed);
  }
  return tables;
}

function parseTablesFromHtmlDocument(html, sourceUrl) {
  const $ = cheerio.load(html);
  const tables = [];
  $('table').each((index, table) => {
    const parsed = parseHtmlTable($, $(table), sourceUrl, `Inline table ${index + 1}`);
    if (parsed && parsed.rows.length >= 3) tables.push(parsed);
  });
  return tables;
}

function parseSingleStatementTable(html, sourceUrl, fallbackName) {
  const $ = cheerio.load(html);
  const table = $('table.report').first();
  if (!table.length) return null;
  return parseHtmlTable($, table, sourceUrl, fallbackName);
}

function parseHtmlTable($, tableNode, sourceUrl, fallbackName) {
  const rows = [];
  const headerRows = [];
  tableNode.find('tr').each((_rowIndex, row) => {
    const rowNode = $(row);
    const cells = rowNode
      .find('th, td')
      .map((_cellIndex, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
      .get();
    if (!cells.length) return;
    const isHeader = rowNode.find('th').length > 0;
    if (isHeader) headerRows.push(cells);
    else rows.push(cells);
  });

  if (!rows.length) return null;

  const unitHeader = headerRows[0]?.[0] || '';
  const columnHeaders = (headerRows.at(-1) || []).slice(1);
  const headerText = headerRows.flat().join(' | ');
  const scales = parseStatementUnitHeader(unitHeader);
  const parsedRows = rows
    .map((cells) => {
      const label = normalizeLabel(cells[0]);
      const values = cells.slice(1).map((cellText) => parseStatementCell(cellText, scales.moneyScale));
      const shareValues = cells.slice(1).map((cellText) => parseStatementCell(cellText, scales.shareScale));
      return {
        label,
        rawLabel: cells[0],
        values,
        shareValues,
      };
    })
    .filter((row) => row.label);

  return {
    sourceUrl,
    name: fallbackName,
    kind: classifyTableKind(fallbackName),
    unitHeader,
    headerText,
    columnHeaders,
    scales,
    rows: parsedRows,
  };
}

function classifyTableKind(name = '') {
  if (/operations|income/i.test(name)) return 'income';
  if (/balance/i.test(name)) return 'balance';
  if (/cash flow/i.test(name)) return 'cashFlow';
  return 'other';
}

function indexTablesByKind(tables) {
  return tables.reduce((acc, table) => {
    if (!acc[table.kind]) acc[table.kind] = table;
    return acc;
  }, {});
}

function parseStatementUnitHeader(text) {
  const moneyScale = detectScale(text, 'money');
  const shareScale = detectScale(text, 'shares');
  return { moneyScale, shareScale };
}

function detectScale(text, valueType = 'money') {
  const normalized = String(text || '').toLowerCase();
  if (valueType === 'shares') {
    if (/shares in billions/.test(normalized)) return 1000;
    if (/shares in millions/.test(normalized)) return 1;
    if (/shares in thousands/.test(normalized)) return 0.001;
    return 1 / 1_000_000;
  }
  if (/\$ in billions|dollars? in billions|amounts? in billions/.test(normalized)) return 1000;
  if (/\$ in millions|dollars? in millions|amounts? in millions/.test(normalized)) return 1;
  if (/\$ in thousands|dollars? in thousands|amounts? in thousands/.test(normalized)) return 0.001;
  return 1 / 1_000_000;
}

function parseStatementCell(text, scaleToMillions) {
  const parsed = parseScaledNumber(text);
  if (!Number.isFinite(parsed)) return null;
  return parsed * scaleToMillions;
}

function findTableMetric(table, patterns, { valueType = 'money', absolute = false } = {}) {
  if (!table?.rows?.length) return null;
  const row = table.rows.find((candidate) => matchesAnyPattern(candidate.label, patterns));
  if (!row) return null;
  const values = valueType === 'shares' ? row.shareValues : row.values;
  const value = firstFinite(...values);
  if (!Number.isFinite(value)) return null;
  return {
    value: absolute ? Math.abs(value) : value,
    evidence: `${table.name} (${table.sourceUrl}) row "${row.rawLabel}"`,
    confidence: 'medium',
    basis: inferTableBasis(table),
  };
}

function sumTableMetrics(table, patterns, { valueType = 'money' } = {}) {
  if (!table?.rows?.length) return null;
  const matches = table.rows.filter((candidate) => matchesAnyPattern(candidate.label, patterns));
  if (!matches.length) return null;
  const sum = matches.reduce((total, row) => {
    const values = valueType === 'shares' ? row.shareValues : row.values;
    const value = firstFinite(...values);
    return Number.isFinite(value) ? total + value : total;
  }, 0);
  if (!Number.isFinite(sum) || sum === 0) return null;
  return {
    value: sum,
    evidence: `${table.name} (${table.sourceUrl}) rows ${matches.map((row) => `"${row.rawLabel}"`).join(', ')}`,
    confidence: 'medium',
    basis: inferTableBasis(table),
  };
}

function deriveRevenueFromTable(revenueMetric, context, incomeTable) {
  if (!revenueMetric) return null;
  if (context?.form === '10-K') return { ...revenueMetric, basis: 'annual' };
  const basis = inferTableBasis(incomeTable);
  if (basis === 'quarter') {
    return {
      ...revenueMetric,
      value: revenueMetric.value * 4,
      basis: 'annualized quarter',
      confidence: 'low',
      evidence: `${revenueMetric.evidence}; annualized from a single quarter because structured companyfacts were unavailable`,
    };
  }
  if (basis === 'ytd') {
    const annualized = revenueMetric.value * (12 / inferMonthCountFromHeaders(incomeTable?.headerText || incomeTable?.columnHeaders));
    return {
      ...revenueMetric,
      value: annualized,
      basis: 'annualized ytd',
      confidence: 'low',
      evidence: `${revenueMetric.evidence}; annualized from a year-to-date filing table because structured companyfacts were unavailable`,
    };
  }
  return revenueMetric;
}

function inferTableBasis(table) {
  const header = `${table?.name || ''} ${table?.headerText || ''} ${table?.columnHeaders?.join(' ') || ''}`.toLowerCase();
  if (/3 months ended/.test(header)) return 'quarter';
  if (/6 months ended|nine months ended|9 months ended/.test(header)) return 'ytd';
  if (/12 months ended|year ended/.test(header)) return 'annual';
  return 'current';
}

function inferMonthCountFromHeaders(headerSource = []) {
  const text = Array.isArray(headerSource) ? headerSource.join(' ').toLowerCase() : String(headerSource || '').toLowerCase();
  if (/nine months|9 months/.test(text)) return 9;
  if (/six months|6 months/.test(text)) return 6;
  if (/three months|3 months/.test(text)) return 3;
  return 12;
}

function makeTableFact(metric, value, category, evidence) {
  return {
    metric,
    valueText: formatMillions(value),
    category,
    evidence,
    confidence: 'medium',
  };
}

function makeDerivedPctFact(metric, value, logic, sources) {
  if (!Number.isFinite(value)) return null;
  return {
    metric,
    value: `${round1(value)}%`,
    logic,
    evidence: sources.filter(Boolean).map((item) => item?.evidence).filter(Boolean).join(' | '),
    confidence: 'medium',
  };
}

function buildTableFieldSource(field, metric, rationale, options = {}) {
  if (!metric || !Number.isFinite(metric.value)) return null;
  return {
    source: 'table_fallback',
    classification: field === 'currentRevenue' && /annualized/i.test(metric.basis || '') ? 'derived' : 'reported',
    confidence: metric.confidence || 'medium',
    evidence: metric.evidence,
    rationale,
    basis: metric.basis || null,
    value: metric.value,
    valueType: options.valueType || 'money',
  };
}

function buildTableDerivedSource(field, value, metrics, rationale) {
  if (!Number.isFinite(value)) return null;
  return {
    source: 'table_fallback',
    classification: 'derived',
    confidence: metrics.some((metric) => metric?.confidence === 'low') ? 'low' : 'medium',
    evidence: metrics.filter(Boolean).map((item) => item?.evidence).filter(Boolean).join(' | '),
    rationale,
    value,
    valueType: 'percent',
  };
}

function matchesAnyPattern(value, patterns = []) {
  return patterns.some((pattern) => pattern.test(value));
}

function normalizeLabel(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[\u2013\u2014]/g, '-')
    .trim()
    .toLowerCase();
}

function buildDurationMetric(companyFacts, context, conceptCandidates, label, options = {}) {
  const conceptMatch = findConceptMatch(companyFacts, conceptCandidates);
  if (!conceptMatch) return null;
  const entries = getEntries(conceptMatch);
  const accessionEntries = entries.filter((entry) => entry.accn === context.accessionNumber && entry.start && entry.end);
  if (!accessionEntries.length) return null;

  const current = chooseCurrentDurationEntry(accessionEntries, context, options);
  if (!current) return null;
  const comparable = chooseComparableDurationEntry(accessionEntries, current);
  const priorAnnual = choosePriorAnnualEntry(entries, current.end);

  const currentValue = normalizeFactValue(current, options.valueType === 'shares' ? 'shares' : 'money');
  const comparableValue = normalizeFactValue(comparable, options.valueType === 'shares' ? 'shares' : 'money');
  const priorAnnualValue = normalizeFactValue(priorAnnual, options.valueType === 'shares' ? 'shares' : 'money');

  let ltmValue = null;
  let basis = null;
  let confidence = 'high';

  if (current.durationDays >= 300) {
    ltmValue = currentValue;
    basis = 'annual';
  } else if (Number.isFinite(priorAnnualValue) && Number.isFinite(currentValue) && Number.isFinite(comparableValue)) {
    ltmValue = priorAnnualValue + currentValue - comparableValue;
    basis = 'ltm';
  } else if (current.durationDays >= 70 && current.durationDays <= 110 && Number.isFinite(currentValue)) {
    ltmValue = currentValue * 4;
    basis = 'annualized quarter';
    confidence = 'low';
  } else if (current.durationDays > 110 && Number.isFinite(currentValue)) {
    ltmValue = currentValue * (365 / current.durationDays);
    basis = 'annualized ytd';
    confidence = 'low';
  }

  const evidenceParts = [
    `${label} from SEC companyfacts ${conceptMatch.namespace}:${conceptMatch.name}`,
    formatPeriodEvidence(current),
  ];
  if (basis === 'ltm' && comparable && priorAnnual) {
    evidenceParts.push(`LTM bridge uses prior annual ${formatPeriodEvidence(priorAnnual)} less prior comparable ${formatPeriodEvidence(comparable)}`);
  }

  return {
    label,
    concept: `${conceptMatch.namespace}:${conceptMatch.name}`,
    currentValue,
    comparableValue,
    priorAnnualValue,
    ltmValue,
    basis,
    confidence,
    evidence: evidenceParts.filter(Boolean).join(' | '),
    current,
    comparable,
    priorAnnual,
  };
}

function buildPercentMetric(companyFacts, context, conceptCandidates, label) {
  const conceptMatch = findConceptMatch(companyFacts, conceptCandidates);
  if (!conceptMatch) return null;
  const entries = getEntries(conceptMatch).filter((entry) => entry.accn === context.accessionNumber && entry.end);
  if (!entries.length) return null;
  const current = chooseLatestByEnd(entries);
  if (!current) return null;
  const value = normalizePercentValue(current.val);
  if (!Number.isFinite(value)) return null;
  return {
    label,
    value,
    confidence: 'high',
    evidence: `${label} from SEC companyfacts ${conceptMatch.namespace}:${conceptMatch.name} | ${formatPeriodEvidence(current)}`,
    concept: `${conceptMatch.namespace}:${conceptMatch.name}`,
  };
}

function buildInstantMetric(companyFacts, context, conceptCandidates, label, options = {}) {
  const conceptMatch = findConceptMatch(companyFacts, conceptCandidates);
  if (!conceptMatch) return null;
  const entries = getEntries(conceptMatch).filter((entry) => entry.accn === context.accessionNumber && entry.end && !entry.start);
  if (!entries.length) return null;
  const current = chooseCurrentInstantEntry(entries, context);
  if (!current) return null;
  const value = normalizeFactValue(current, options.valueType === 'shares' ? 'shares' : 'money');
  if (!Number.isFinite(value)) return null;
  return {
    label,
    value,
    confidence: 'high',
    evidence: `${label} from SEC companyfacts ${conceptMatch.namespace}:${conceptMatch.name} | ${formatPeriodEvidence(current)}`,
    concept: `${conceptMatch.namespace}:${conceptMatch.name}`,
    entry: current,
  };
}

function findConceptMatch(companyFacts, conceptCandidates) {
  for (const [namespace, name] of conceptCandidates) {
    const concept = companyFacts?.facts?.[namespace]?.[name];
    if (concept?.units) return { namespace, name, concept };
  }
  return null;
}

function getEntries(conceptMatch) {
  return Object.entries(conceptMatch.concept.units || {})
    .flatMap(([unit, values]) => (Array.isArray(values) ? values.map((entry) => ({ ...entry, unit })) : []))
    .filter((entry) => Number.isFinite(Number(entry.val)));
}

function chooseCurrentDurationEntry(entries, context, options = {}) {
  const targetQuarterDays = quarterToTargetDays(context.fiscalQuarter);
  return [...entries]
    .map((entry) => ({
      ...entry,
      durationDays: diffDays(entry.start, entry.end),
      endTime: toTime(entry.end),
    }))
    .filter((entry) => entry.durationDays >= 45)
    .sort((a, b) => {
      if (b.endTime !== a.endTime) return b.endTime - a.endTime;
      const aDistance = Math.abs(a.durationDays - (options.preferDurationForShares ? targetQuarterDays || 365 : targetQuarterDays || (context.form === '10-K' ? 365 : targetQuarterDays || 90)));
      const bDistance = Math.abs(b.durationDays - (options.preferDurationForShares ? targetQuarterDays || 365 : targetQuarterDays || (context.form === '10-K' ? 365 : targetQuarterDays || 90)));
      return aDistance - bDistance;
    })[0] || null;
}

function chooseComparableDurationEntry(entries, current) {
  if (!current) return null;
  return [...entries]
    .map((entry) => ({ ...entry, durationDays: diffDays(entry.start, entry.end), endTime: toTime(entry.end) }))
    .filter((entry) => entry.endTime < toTime(current.end))
    .filter((entry) => Math.abs(entry.durationDays - current.durationDays) <= Math.max(20, current.durationDays * 0.25))
    .sort((a, b) => b.endTime - a.endTime)[0] || null;
}

function choosePriorAnnualEntry(entries, beforeDate) {
  return [...entries]
    .map((entry) => ({ ...entry, durationDays: diffDays(entry.start, entry.end), endTime: toTime(entry.end) }))
    .filter((entry) => entry.form === '10-K')
    .filter((entry) => entry.durationDays >= 300)
    .filter((entry) => entry.endTime < toTime(beforeDate))
    .sort((a, b) => b.endTime - a.endTime)[0] || null;
}

function chooseCurrentInstantEntry(entries, context) {
  const reportTime = toTime(context.reportDate || context.filingDate);
  return [...entries]
    .map((entry) => ({ ...entry, endTime: toTime(entry.end) }))
    .sort((a, b) => {
      const aDistance = Math.abs(a.endTime - reportTime);
      const bDistance = Math.abs(b.endTime - reportTime);
      if (aDistance !== bDistance) return aDistance - bDistance;
      return b.endTime - a.endTime;
    })[0] || null;
}

function chooseLatestByEnd(entries) {
  return [...entries]
    .map((entry) => ({ ...entry, endTime: toTime(entry.end) }))
    .sort((a, b) => b.endTime - a.endTime)[0] || null;
}

function normalizeFactValue(entry, valueType = 'money') {
  const raw = Number(entry?.val);
  if (!Number.isFinite(raw)) return null;
  if (valueType === 'shares') return raw / 1_000_000;
  return raw / 1_000_000;
}

function normalizePercentValue(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  return Math.abs(raw) <= 1 ? raw * 100 : raw;
}

function deriveDebtValue(debtTotalFact, debtCurrentFact, debtNonCurrentFact, shortTermBorrowingsFact) {
  const total = debtTotalFact?.value;
  const current = debtCurrentFact?.value;
  const nonCurrent = debtNonCurrentFact?.value;
  const shortTerm = shortTermBorrowingsFact?.value;

  if (Number.isFinite(current) && Number.isFinite(nonCurrent)) {
    return current + nonCurrent + (Number.isFinite(shortTerm) ? shortTerm : 0);
  }
  if (Number.isFinite(total) && Number.isFinite(shortTerm)) return total + shortTerm;
  if (Number.isFinite(total)) return total;
  if (Number.isFinite(current) || Number.isFinite(nonCurrent) || Number.isFinite(shortTerm)) {
    return [current, nonCurrent, shortTerm].filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
  }
  return null;
}

function buildDurationFieldSource(field, series, options = {}) {
  if (!series || !Number.isFinite(series.ltmValue ?? series.currentValue)) return null;
  return {
    source: 'structured',
    classification: series.basis === 'annual' ? 'reported' : 'derived',
    confidence: series.confidence,
    evidence: series.evidence,
    rationale: series.basis === 'annual'
      ? 'Direct structured SEC fact for the selected filing period.'
      : 'Deterministically bridged from structured SEC facts for the selected filing period.',
    basis: series.basis,
    value: Number.isFinite(series.ltmValue) ? series.ltmValue : series.currentValue,
    valueType: options.valueType || 'money',
  };
}

function buildPercentFieldSource(field, fact) {
  if (!fact || !Number.isFinite(fact.value)) return null;
  return {
    source: 'structured',
    classification: 'reported',
    confidence: fact.confidence,
    evidence: fact.evidence,
    rationale: 'Direct structured SEC percentage fact for the selected filing period.',
    basis: 'reported',
    value: fact.value,
    valueType: 'percent',
  };
}

function buildInstantFieldSource(field, fact, options = {}) {
  if (!fact || !Number.isFinite(fact.value)) return null;
  return {
    source: 'structured',
    classification: options.classification || 'reported',
    confidence: fact.confidence,
    evidence: fact.evidence,
    rationale: 'Direct structured SEC instant fact for the selected filing period.',
    basis: 'reported',
    value: fact.value,
    valueType: options.valueType || 'money',
  };
}

function buildDerivedFieldSource(field, value, seriesList, rationale) {
  if (!Number.isFinite(value)) return null;
  const confidence = seriesList.some((series) => series?.confidence === 'low') ? 'low' : 'high';
  return {
    source: 'structured',
    classification: 'derived',
    confidence,
    evidence: seriesList.filter(Boolean).map((series) => series?.evidence).filter(Boolean).join(' | '),
    rationale,
    basis: 'derived',
    value,
    valueType: 'percent',
  };
}

function buildDebtFieldSource(debt, debtTotalFact, debtCurrentFact, debtNonCurrentFact, shortTermBorrowingsFact) {
  if (!Number.isFinite(debt)) return null;
  const directTotal = Number.isFinite(debtTotalFact?.value) && !Number.isFinite(debtCurrentFact?.value) && !Number.isFinite(debtNonCurrentFact?.value);
  return {
    source: 'structured',
    classification: directTotal ? 'reported' : 'derived',
    confidence: directTotal ? 'high' : 'medium',
    evidence: [debtTotalFact?.evidence, debtCurrentFact?.evidence, debtNonCurrentFact?.evidence, shortTermBorrowingsFact?.evidence].filter(Boolean).join(' | '),
    rationale: directTotal ? 'Direct total debt fact from structured SEC data.' : 'Debt assembled from current, non-current, and short-term borrowing facts in structured SEC data.',
    basis: directTotal ? 'reported' : 'assembled',
    value: debt,
    valueType: 'money',
  };
}

function buildNetDebtFieldSource(netDebt, debt, cash, liquidity, debtTotalFact, debtCurrentFact, debtNonCurrentFact, shortTermBorrowingsFact, cashFact, liquidInvestmentsFact) {
  if (!Number.isFinite(netDebt)) return null;
  return {
    source: 'structured',
    classification: 'derived',
    confidence: Number.isFinite(liquidity) ? 'high' : 'medium',
    evidence: [debtTotalFact?.evidence, debtCurrentFact?.evidence, debtNonCurrentFact?.evidence, shortTermBorrowingsFact?.evidence, cashFact?.evidence, liquidInvestmentsFact?.evidence].filter(Boolean).join(' | '),
    rationale: Number.isFinite(liquidity)
      ? 'Net debt calculated as debt less cash and current liquid investments.'
      : 'Net debt calculated as debt less cash because current liquid investments were unavailable.',
    basis: 'derived',
    value: netDebt,
    valueType: 'money',
    inputs: { debt, cash, liquidity },
  };
}

function stripEmptyFieldSources(fieldSources) {
  return Object.fromEntries(Object.entries(fieldSources).filter(([, value]) => value));
}

function mergeDeterministicPackets(primary, fallback, fallbackMetadata, diagnostics) {
  const merged = createEmptyDeterministicPacket();
  merged.filingSelection = primary.filingSelection || fallback.filingSelection || diagnostics.filingSelection || null;
  merged.filingMetadata = {
    ...fallbackMetadata,
    ...fallback.filingMetadata,
    ...primary.filingMetadata,
  };

  merged.normalizedMetrics = mergeNumericMaps(primary.normalizedMetrics, fallback.normalizedMetrics);
  merged.historicalMetrics = {
    ...(fallback.historicalMetrics || {}),
    ...(primary.historicalMetrics || {}),
  };
  merged.fieldSources = { ...fallback.fieldSources, ...primary.fieldSources };
  diagnostics.fieldSources = merged.fieldSources;

  merged.reportedFacts = dedupeFacts([...primary.reportedFacts, ...fallback.reportedFacts]);
  merged.derivedMetrics = dedupeDerivedMetrics([...primary.derivedMetrics, ...fallback.derivedMetrics]);
  merged.reviewFlags = dedupeFlags([
    ...primary.reviewFlags,
    ...fallback.reviewFlags,
    ...buildStructuredReviewFlags(merged.normalizedMetrics, merged.fieldSources),
  ]);
  merged.missingBaseInputs = buildMissingBaseInputs(merged.normalizedMetrics, merged.fieldSources);
  merged.confidenceMap = { ...fallback.confidenceMap, ...primary.confidenceMap };
  merged.evidenceMap = { ...fallback.evidenceMap, ...primary.evidenceMap };
  return merged;
}

function mergeNumericMaps(primary = {}, fallback = {}) {
  const keys = new Set([...Object.keys(primary || {}), ...Object.keys(fallback || {})]);
  return Object.fromEntries([...keys].map((key) => [key, Number.isFinite(primary[key]) ? primary[key] : fallback[key] ?? null]));
}

function dedupeFacts(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.metric}|${item.valueText}|${item.evidence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeDerivedMetrics(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.metric}|${item.value}|${item.logic}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeFlags(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalizeFlagKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeFlagKey(item = {}) {
  return [item.item, item.reason, item.evidence]
    .map((value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim())
    .join('|');
}

function dedupeMissingInputs(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.field)) return false;
    seen.add(item.field);
    return true;
  });
}

function needsTableFallback(packet) {
  const metrics = packet?.normalizedMetrics || {};
  const required = ['revenueLtm', 'shareCount', 'netDebt', 'grossMarginPct', 'operatingMarginPct'];
  return required.some((field) => !Number.isFinite(metrics[field]));
}

export function evaluateBaselineReadiness({ draftedBaseline, draftedBaselineMeta, normalizedMetrics, fieldSources, filingMetadata }) {
  const checks = [];
  const hardFieldSources = fieldSources || {};
  const hardFieldValues = {
    currentRevenue: draftedBaseline?.currentRevenue,
    shareCount: draftedBaseline?.shareCount,
    cash: normalizedMetrics?.cash,
    debt: normalizedMetrics?.debt,
    netDebt: draftedBaseline?.netDebt,
    grossMarginStart: draftedBaseline?.grossMarginStart,
    operatingMarginStart: draftedBaseline?.operatingMarginStart,
    taxRate: draftedBaseline?.taxRate,
    capexPct: draftedBaseline?.capexPct,
    daPct: draftedBaseline?.daPct,
  };

  const marginsDeterministicallySupported = ['grossMarginStart', 'operatingMarginStart'].every((field) => {
    const source = hardFieldSources[field];
    return source && source.source !== 'ai_fallback' && source.confidence !== 'low';
  });
  const capexMissing = !Number.isFinite(hardFieldValues.capexPct);
  const ancillaryRateFailures = ['taxRate', 'daPct'].filter((field) => !Number.isFinite(hardFieldValues[field]));
  const lowConfidenceFallbacks = HARD_FIELD_ORDER.filter((field) => {
    const source = hardFieldSources[field];
    if (!source) return field !== 'capexPct';
    return source.source === 'ai_fallback' || source.confidence === 'low';
  });
  const structuralFallbacks = lowConfidenceFallbacks.filter((field) => !['capexPct'].includes(field));

  pushCheck(checks, 'Revenue base resolved', Number.isFinite(hardFieldValues.currentRevenue), Number.isFinite(hardFieldValues.currentRevenue)
    ? `Revenue base ${formatMillions(hardFieldValues.currentRevenue)}.`
    : 'Revenue base is unresolved.');

  pushCheck(checks, 'Revenue magnitude consistent with balance-sheet scale', !(
    Number.isFinite(hardFieldValues.currentRevenue)
    && hardFieldValues.currentRevenue < 100
    && (Number.isFinite(hardFieldValues.debt) && hardFieldValues.debt > 1000 || Number.isFinite(hardFieldValues.cash) && hardFieldValues.cash > 1000 || Number.isFinite(hardFieldValues.shareCount) && hardFieldValues.shareCount > 1000)
  ), Number.isFinite(hardFieldValues.currentRevenue)
    ? `Revenue ${formatMillions(hardFieldValues.currentRevenue)} checked against debt, cash, and shares.`
    : 'Revenue magnitude could not be checked.');

  pushCheck(checks, 'Share count resolved and normalized to millions', Number.isFinite(hardFieldValues.shareCount) && hardFieldValues.shareCount >= 1 && hardFieldValues.shareCount <= 1_000_000,
    Number.isFinite(hardFieldValues.shareCount)
      ? `Share count ${round1(hardFieldValues.shareCount)} mm.`
      : 'Share count is unresolved.');

  const expectedNetDebt = Number.isFinite(normalizedMetrics?.debt) && Number.isFinite(normalizedMetrics?.liquidity)
    ? normalizedMetrics.debt - normalizedMetrics.liquidity
    : Number.isFinite(normalizedMetrics?.debt) && Number.isFinite(normalizedMetrics?.cash)
      ? normalizedMetrics.debt - normalizedMetrics.cash
      : null;
  const netDebtConsistent = !Number.isFinite(expectedNetDebt) || !Number.isFinite(hardFieldValues.netDebt)
    ? Number.isFinite(hardFieldValues.netDebt)
    : Math.abs(expectedNetDebt - hardFieldValues.netDebt) <= Math.max(50, Math.abs(expectedNetDebt) * 0.05);
  pushCheck(checks, 'Net debt consistent with cash and debt inputs', netDebtConsistent,
    netDebtConsistent
      ? 'Net debt agrees with deterministic cash and debt balances.'
      : `Net debt ${formatMillions(hardFieldValues.netDebt)} conflicts with expected ${formatMillions(expectedNetDebt)}.`);

  const marginLogicIsCoherent = Number.isFinite(hardFieldValues.grossMarginStart)
    && Number.isFinite(hardFieldValues.operatingMarginStart)
    && hardFieldValues.grossMarginStart >= -10
    && hardFieldValues.grossMarginStart <= 98
    && hardFieldValues.operatingMarginStart >= -40
    && hardFieldValues.operatingMarginStart <= Math.min(70, hardFieldValues.grossMarginStart + 3);
  const marginMessage = `Gross margin ${round1(hardFieldValues.grossMarginStart)}%, operating margin ${round1(hardFieldValues.operatingMarginStart)}%.`;
  pushCheck(
    checks,
    'Gross and operating margins are internally coherent',
    marginLogicIsCoherent && (marginsDeterministicallySupported || hardFieldValues.grossMarginStart <= 92),
    marginsDeterministicallySupported
      ? `${marginMessage} Filing-supported margins cleared the coherence check.`
      : marginMessage
  );

  const taxDaResolved = ancillaryRateFailures.length === 0;
  pushCheck(checks, 'Tax and D&A rates resolved', taxDaResolved,
    `Tax ${round1(hardFieldValues.taxRate)}%, D&A ${round1(hardFieldValues.daPct)}%.`);

  const capexHandlingPassed = !capexMissing || (taxDaResolved && Number.isFinite(hardFieldValues.currentRevenue) && Number.isFinite(hardFieldValues.grossMarginStart) && Number.isFinite(hardFieldValues.operatingMarginStart));
  pushCheck(checks, 'Capex handling is sufficient for valuation', capexHandlingPassed,
    capexMissing
      ? 'Capex was not deterministically resolved, but the remaining baseline is strong enough to allow a conservative fallback.'
      : `Capex ${round1(hardFieldValues.capexPct)}%.`);

  const impossibleRateMix = Number.isFinite(hardFieldValues.capexPct) && Number.isFinite(hardFieldValues.daPct)
    && (hardFieldValues.capexPct > 30 || hardFieldValues.daPct > 20 || hardFieldValues.capexPct + hardFieldValues.daPct > 40);
  pushCheck(checks, 'Ancillary rate mix is credible', !impossibleRateMix,
    `Tax ${round1(hardFieldValues.taxRate)}%, capex ${round1(hardFieldValues.capexPct)}%, D&A ${round1(hardFieldValues.daPct)}%.`);

  pushCheck(checks, 'Too many structural hard fields are not deterministic', structuralFallbacks.length <= 2,
    structuralFallbacks.length
      ? `Low-confidence or AI-owned structural hard fields: ${structuralFallbacks.join(', ')}.`
      : 'Structural hard fields are deterministic or high-confidence derived.');

  const blockingChecks = checks.filter((check) => !check.passed);
  const unresolvedFields = HARD_FIELD_ORDER.filter((field) => !Number.isFinite(hardFieldValues[field]) && field !== 'cash' && field !== 'debt');

  return {
    state: blockingChecks.length ? 'needs_review' : 'ready',
    canRunModel: blockingChecks.length === 0,
    checks,
    blockingIssues: blockingChecks.map((check) => check.message),
    unresolvedFields,
    lowConfidenceFields: lowConfidenceFallbacks,
    summary: blockingChecks.length
      ? `${filingMetadata?.company || 'This filing'} needs review before valuation output because ${blockingChecks.length} baseline check${blockingChecks.length === 1 ? '' : 's'} failed.`
      : `${filingMetadata?.company || 'This filing'} passed deterministic baseline validation and is safe to run through the model.`,
  };
}

export function buildSafeReviewSummary({ filingMetadata, analysisStatus }) {
  return {
    executiveSummary: {
      headline: `${filingMetadata?.company || 'Filing'} needs review before valuation`,
      body: analysisStatus?.summary || 'The filing was ingested, but the quantitative baseline was not reliable enough to support a valuation output.',
      bullets: analysisStatus?.blockingIssues || [],
    },
    scenarioWriteups: {
      base: { summary: '', bullets: [] },
      upside: { summary: '', bullets: [] },
      downside: { summary: '', bullets: [] },
    },
    valuationSummary: {
      summary: 'Valuation output was intentionally suppressed because key baseline inputs need analyst review.',
      bullets: analysisStatus?.unresolvedFields?.map((field) => `${field} unresolved`) || [],
    },
    sourceAppendix: {
      methodology: 'Hard numeric baseline fields are deterministic-first. When the baseline fails sanity or confidence checks, the app surfaces a review-required state instead of rendering a misleading valuation pack.',
      caveats: analysisStatus?.blockingIssues || [],
    },
  };
}

function pushCheck(checks, label, passed, message) {
  checks.push({ label, passed, message });
}

function buildOperatingWorkingCapital({ accountsReceivable, inventory, accountsPayable, deferredRevenue }) {
  const assetPieces = [accountsReceivable, inventory].filter(Number.isFinite);
  const liabilityPieces = [accountsPayable, deferredRevenue].filter(Number.isFinite);
  if (!assetPieces.length && !liabilityPieces.length) return null;
  const assets = assetPieces.reduce((sum, value) => sum + value, 0);
  const liabilities = liabilityPieces.reduce((sum, value) => sum + value, 0);
  return assets - liabilities;
}

function addFinite(a, b) {
  if (Number.isFinite(a) && Number.isFinite(b)) return a + b;
  if (Number.isFinite(a)) return a;
  if (Number.isFinite(b)) return b;
  return null;
}

function computeRatio(numerator, denominator, options = {}) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (!options.allowNegativeDenominator && denominator <= 0) return null;
  if (denominator === 0) return null;
  return (numerator / denominator) * 100;
}

function firstFinite(...values) {
  return values.find((value) => Number.isFinite(value)) ?? null;
}

function quarterToTargetDays(quarter) {
  if (quarter === 'Q1') return 90;
  if (quarter === 'Q2') return 180;
  if (quarter === 'Q3') return 270;
  return 365;
}

function diffDays(start, end) {
  const startTime = toTime(start);
  const endTime = toTime(end);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 0;
  return Math.round((endTime - startTime) / 86_400_000);
}

function toTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function formatPeriodEvidence(entry) {
  if (!entry) return '';
  if (entry.start) return `${entry.form || ''} ${entry.start} to ${entry.end}`.trim();
  return `${entry.form || ''} as of ${entry.end}`.trim();
}

function buildReportingPeriodLabel(fiscalQuarter, fiscalYear) {
  if (!fiscalQuarter || !fiscalYear) return null;
  return `${fiscalQuarter} ${fiscalYear}`;
}

export function parseScaledNumber(text) {
  if (text === null || text === undefined) return null;
  const normalized = String(text)
    .replace(/\u00a0/g, ' ')
    .replace(/[–—]/g, '-')
    .trim();
  if (!normalized || /^[-—–]$/.test(normalized)) return null;

  const negative = /^\(.*\)$/.test(normalized) || /^-/.test(normalized);
  const cleaned = normalized
    .replace(/[()$,%]/g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '');

  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  if (!Number.isFinite(value)) return null;
  return negative ? -Math.abs(value) : value;
}

function formatMillions(value) {
  if (!Number.isFinite(value)) return '—';
  return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: Math.abs(value) < 100 ? 1 : 0 })}mm`;
}

function round1(value) {
  if (!Number.isFinite(value)) return value;
  return Math.round((value + Number.EPSILON) * 10) / 10;
}
