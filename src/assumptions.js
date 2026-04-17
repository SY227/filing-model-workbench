export const horizonLabels = ['FY+1E', 'FY+2E', 'FY+3E', 'FY+4E', 'FY+5E'];

export const defaultBaseline = {
  companyName: '',
  unitLabel: '$mm',
  currentRevenue: 1000,
  revenueGrowth: [8, 7, 6, 5, 4],
  grossMarginStart: 55,
  grossMarginEnd: 56.5,
  operatingMarginStart: 16,
  operatingMarginEnd: 18,
  taxRate: 21,
  capexPct: 3.5,
  daPct: 2,
  nwcPct: 1,
  wacc: 9,
  terminalGrowth: 2.5,
  shareCount: 100,
  netDebt: 0,
  exitEbitdaMultiple: 12,
};

export const baselineFieldOrder = [
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
];

export const assetManagerFieldOrder = [
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
];

export const directionalFieldOrder = [
  'companyName',
  'shareCount',
  'bookValue',
  'earningsLikeAnchor',
  'cash',
  'debt',
  'netDebt',
  'anchorLabel',
];

export const baselineFieldLabels = {
  companyName: 'Company name',
  currentRevenue: 'Revenue base ($mm)',
  revenueGrowth: 'Revenue growth path',
  grossMarginStart: 'Gross margin, Year 1',
  grossMarginEnd: 'Gross margin, Year 5',
  operatingMarginStart: 'Operating margin, Year 1',
  operatingMarginEnd: 'Operating margin, Year 5',
  taxRate: 'Tax rate',
  capexPct: 'Capex / revenue',
  daPct: 'D&A / revenue',
  nwcPct: 'Working capital / revenue',
  wacc: 'WACC',
  terminalGrowth: 'Terminal growth',
  shareCount: 'Diluted shares (mm)',
  netDebt: 'Net debt / (cash) ($mm)',
  exitEbitdaMultiple: 'Exit EBITDA multiple',
};

export const assetManagerFieldLabels = {
  companyName: 'Company name',
  aum: 'AUM ($mm)',
  feeRelatedEarnings: 'Fee-related earnings ($mm)',
  distributableEarnings: 'Distributable earnings ($mm)',
  managementFees: 'Management fees ($mm)',
  performanceIncome: 'Performance / incentive income ($mm)',
  bookValue: 'Book value / equity ($mm)',
  balanceSheetInvestments: 'Balance-sheet investments ($mm)',
  shareCount: 'Share count (mm)',
  cash: 'Cash ($mm)',
  debt: 'Debt ($mm)',
  netDebt: 'Net debt / (cash) ($mm)',
};

export const directionalFieldLabels = {
  companyName: 'Company name',
  shareCount: 'Share count (mm)',
  bookValue: 'Book value / equity ($mm)',
  earningsLikeAnchor: 'Earnings-like anchor ($mm)',
  cash: 'Cash ($mm)',
  debt: 'Debt ($mm)',
  netDebt: 'Net debt / (cash) ($mm)',
  anchorLabel: 'Anchor label',
};

export function getBaselineFieldOrder(mode = 'operating_company') {
  if (mode === 'asset_manager') return assetManagerFieldOrder;
  if (mode === 'directional_only' || mode === 'financial_other') return directionalFieldOrder;
  return baselineFieldOrder;
}

export function getBaselineFieldLabels(mode = 'operating_company') {
  if (mode === 'asset_manager') return assetManagerFieldLabels;
  if (mode === 'directional_only' || mode === 'financial_other') return directionalFieldLabels;
  return baselineFieldLabels;
}

export function formatDraftedBaselineValue(field, value, mode = 'operating_company') {
  if (field === 'companyName' || field === 'anchorLabel') return value || '—';
  if (field === 'revenueGrowth' && Array.isArray(value)) return value.map((item) => `${Number(item).toFixed(1)}%`).join(' / ');
  if (field === 'exitEbitdaMultiple') return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}x` : '—';
  if (['grossMarginStart', 'grossMarginEnd', 'operatingMarginStart', 'operatingMarginEnd', 'taxRate', 'capexPct', 'daPct', 'nwcPct', 'wacc', 'terminalGrowth'].includes(field)) {
    return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : '—';
  }

  if (mode === 'asset_manager' && ['aum', 'feeRelatedEarnings', 'distributableEarnings', 'managementFees', 'performanceIncome', 'bookValue', 'balanceSheetInvestments', 'cash', 'debt', 'netDebt'].includes(field)) {
    return Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—';
  }

  if ((mode === 'directional_only' || mode === 'financial_other') && ['bookValue', 'earningsLikeAnchor', 'cash', 'debt', 'netDebt'].includes(field)) {
    return Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—';
  }

  if (['currentRevenue', 'shareCount', 'netDebt', 'cash', 'debt'].includes(field)) {
    return Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—';
  }

  return String(value ?? '—');
}
