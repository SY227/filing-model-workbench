export const horizonLabels = ['FY+1', 'FY+2', 'FY+3', 'FY+4', 'FY+5'];

export const defaultBaseline = {
  companyName: '',
  unitLabel: 'USDm',
  currentRevenue: 1000,
  revenueGrowth: [10, 8, 7, 6, 5],
  grossMarginStart: 60,
  grossMarginEnd: 62,
  operatingMarginStart: 18,
  operatingMarginEnd: 20,
  taxRate: 21,
  capexPct: 3.5,
  daPct: 2,
  nwcPct: 1,
  wacc: 9,
  terminalGrowth: 3,
  shareCount: 100,
  netDebt: 0,
  exitEbitdaMultiple: 12,
};

export const baselineGroups = [
  {
    title: 'Company context',
    description: 'Keep one consistent unit system throughout, for example USDm.',
    fields: [
      { key: 'companyName', label: 'Company name', type: 'text', placeholder: 'Northstar Cloud' },
      { key: 'unitLabel', label: 'Unit label', type: 'text', placeholder: 'USDm' },
      { key: 'currentRevenue', label: 'LTM revenue', type: 'number', step: 1 },
      { key: 'shareCount', label: 'Diluted share count', type: 'number', step: 0.1 },
      { key: 'netDebt', label: 'Net debt / (cash)', type: 'number', step: 1 },
    ],
  },
  {
    title: 'Revenue assumptions',
    description: 'Enter the baseline growth path you would have carried into the call.',
    revenueGrowth: true,
  },
  {
    title: 'Profitability',
    description: 'Use next-year starting levels and a five-year destination margin.',
    fields: [
      { key: 'grossMarginStart', label: 'Gross margin FY+1 %', type: 'number', step: 0.1, suffix: '%' },
      { key: 'grossMarginEnd', label: 'Gross margin FY+5 %', type: 'number', step: 0.1, suffix: '%' },
      { key: 'operatingMarginStart', label: 'Operating margin FY+1 %', type: 'number', step: 0.1, suffix: '%' },
      { key: 'operatingMarginEnd', label: 'Operating margin FY+5 %', type: 'number', step: 0.1, suffix: '%' },
      { key: 'taxRate', label: 'Tax rate %', type: 'number', step: 0.1, suffix: '%' },
    ],
  },
  {
    title: 'Cash flow assumptions',
    description: 'Simplified external-analyst cash flow layer.',
    fields: [
      { key: 'capexPct', label: 'Capex % of revenue', type: 'number', step: 0.1, suffix: '%' },
      { key: 'daPct', label: 'D&A % of revenue', type: 'number', step: 0.1, suffix: '%' },
      { key: 'nwcPct', label: 'Working capital % of revenue', type: 'number', step: 0.1, suffix: '%' },
    ],
  },
  {
    title: 'Valuation assumptions',
    description: 'Used directly by the deterministic DCF layer.',
    fields: [
      { key: 'wacc', label: 'Discount rate / WACC', type: 'number', step: 0.1, suffix: '%' },
      { key: 'terminalGrowth', label: 'Terminal growth', type: 'number', step: 0.1, suffix: '%' },
      { key: 'exitEbitdaMultiple', label: 'Exit EBITDA multiple', type: 'number', step: 0.1, suffix: 'x' },
    ],
  },
];
