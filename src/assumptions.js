export const horizonLabels = ['FY+1', 'FY+2', 'FY+3', 'FY+4', 'FY+5'];

export const defaultBaseline = {
  companyName: '',
  unitLabel: 'USDm',
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

export const baselineGroups = [
  {
    title: 'Company and capital structure',
    description: 'Use consistent units throughout. Filing extraction can backfill selected fields when the baseline still reflects defaults.',
    fields: [
      { key: 'companyName', label: 'Company name', type: 'text', placeholder: 'Issuer name' },
      { key: 'unitLabel', label: 'Model units', type: 'text', placeholder: 'USDm' },
      { key: 'currentRevenue', label: 'Current revenue base', type: 'number', step: 1 },
      { key: 'shareCount', label: 'Diluted share count', type: 'number', step: 0.1 },
      { key: 'netDebt', label: 'Net debt / (cash)', type: 'number', step: 1 },
    ],
  },
  {
    title: 'Revenue frame',
    description: 'This is the prior view you would have carried into the update before reviewing the latest filing and call materials.',
    revenueGrowth: true,
  },
  {
    title: 'Margin structure',
    description: 'Use a near-term anchor and a medium-term destination. The deterministic model interpolates between them.',
    fields: [
      { key: 'grossMarginStart', label: 'Gross margin, FY+1', type: 'number', step: 0.1, suffix: '%' },
      { key: 'grossMarginEnd', label: 'Gross margin, FY+5', type: 'number', step: 0.1, suffix: '%' },
      { key: 'operatingMarginStart', label: 'Operating margin, FY+1', type: 'number', step: 0.1, suffix: '%' },
      { key: 'operatingMarginEnd', label: 'Operating margin, FY+5', type: 'number', step: 0.1, suffix: '%' },
      { key: 'taxRate', label: 'Tax rate', type: 'number', step: 0.1, suffix: '%' },
    ],
  },
  {
    title: 'Cash flow frame',
    description: 'A practical external-analyst approximation layer, not a full three-statement build.',
    fields: [
      { key: 'capexPct', label: 'Capex / revenue', type: 'number', step: 0.1, suffix: '%' },
      { key: 'daPct', label: 'D&A / revenue', type: 'number', step: 0.1, suffix: '%' },
      { key: 'nwcPct', label: 'Working capital / revenue', type: 'number', step: 0.1, suffix: '%' },
    ],
  },
  {
    title: 'Valuation frame',
    description: 'Used directly by the code-driven DCF layer and valuation bridge.',
    fields: [
      { key: 'wacc', label: 'WACC', type: 'number', step: 0.1, suffix: '%' },
      { key: 'terminalGrowth', label: 'Terminal growth', type: 'number', step: 0.1, suffix: '%' },
      { key: 'exitEbitdaMultiple', label: 'Exit EBITDA multiple', type: 'number', step: 0.1, suffix: 'x' },
    ],
  },
];

export const supportingMaterialKinds = [
  { value: 'earnings_release', label: 'Earnings release' },
  { value: 'shareholder_letter', label: 'Shareholder letter' },
  { value: 'investor_presentation', label: 'Investor presentation' },
  { value: 'management_commentary', label: 'Management commentary' },
  { value: 'other', label: 'Other supporting material' },
];
