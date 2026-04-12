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

export function formatDraftedBaselineValue(field, value) {
  if (field === 'companyName') return value || '—';
  if (field === 'revenueGrowth' && Array.isArray(value)) return value.map((item) => `${Number(item).toFixed(1)}%`).join(' / ');
  if (field === 'exitEbitdaMultiple') return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}x` : '—';
  if (['grossMarginStart', 'grossMarginEnd', 'operatingMarginStart', 'operatingMarginEnd', 'taxRate', 'capexPct', 'daPct', 'nwcPct', 'wacc', 'terminalGrowth'].includes(field)) {
    return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : '—';
  }
  if (['currentRevenue', 'shareCount', 'netDebt'].includes(field)) {
    return Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—';
  }
  return String(value ?? '—');
}
