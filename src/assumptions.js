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

export const baselineGroups = [
  {
    title: 'Capital structure and revenue base',
    description: 'These are working assumptions for the external model. Filing extraction can backfill selected fields where the disclosure is explicit.',
    fields: [
      { key: 'companyName', label: 'Company name', type: 'text', placeholder: 'Issuer name' },
      { key: 'currentRevenue', label: 'Revenue base ($mm)', type: 'number', step: 1 },
      { key: 'shareCount', label: 'Diluted shares (mm)', type: 'number', step: 0.1 },
      { key: 'netDebt', label: 'Net debt / (cash) ($mm)', type: 'number', step: 1 },
    ],
  },
  {
    title: 'Revenue build',
    description: 'Forward growth inputs for the five-year deterministic forecast.',
    revenueGrowth: true,
  },
  {
    title: 'Margin structure',
    description: 'Set the near-term anchor and medium-term destination. The forecast interpolates between them.',
    fields: [
      { key: 'grossMarginStart', label: 'Gross margin, Year 1', type: 'number', step: 0.1, suffix: '%' },
      { key: 'grossMarginEnd', label: 'Gross margin, Year 5', type: 'number', step: 0.1, suffix: '%' },
      { key: 'operatingMarginStart', label: 'Operating margin, Year 1', type: 'number', step: 0.1, suffix: '%' },
      { key: 'operatingMarginEnd', label: 'Operating margin, Year 5', type: 'number', step: 0.1, suffix: '%' },
      { key: 'taxRate', label: 'Tax rate', type: 'number', step: 0.1, suffix: '%' },
    ],
  },
  {
    title: 'Cash flow and valuation frame',
    description: 'A practical filing-grounded approximation layer, not a full three-statement operating model.',
    fields: [
      { key: 'capexPct', label: 'Capex / revenue', type: 'number', step: 0.1, suffix: '%' },
      { key: 'daPct', label: 'D&A / revenue', type: 'number', step: 0.1, suffix: '%' },
      { key: 'nwcPct', label: 'Working capital / revenue', type: 'number', step: 0.1, suffix: '%' },
      { key: 'wacc', label: 'WACC', type: 'number', step: 0.1, suffix: '%' },
      { key: 'terminalGrowth', label: 'Terminal growth', type: 'number', step: 0.1, suffix: '%' },
      { key: 'exitEbitdaMultiple', label: 'Exit EBITDA multiple', type: 'number', step: 0.1, suffix: 'x' },
    ],
  },
];
