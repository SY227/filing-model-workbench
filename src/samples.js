export const sampleCases = [
  {
    id: 'northstar-cloud',
    label: 'Example: enterprise software',
    description: 'Fictional software issuer with a filing-grounded base, transcript delta, and release excerpt.',
    baseline: {
      companyName: 'Northstar Cloud Holdings',
      unitLabel: 'USDm',
      currentRevenue: 1680,
      revenueGrowth: [14, 12, 10, 8, 7],
      grossMarginStart: 77.5,
      grossMarginEnd: 79,
      operatingMarginStart: 17.2,
      operatingMarginEnd: 21.5,
      taxRate: 21,
      capexPct: 4.1,
      daPct: 2.3,
      nwcPct: 1.2,
      wacc: 9.2,
      terminalGrowth: 3.0,
      shareCount: 145,
      netDebt: -120,
      exitEbitdaMultiple: 15.5,
    },
    filing: {
      inputMode: 'text',
      text: `Northstar Cloud Holdings, Inc. Quarterly Report on Form 10-Q
For the quarterly period ended March 31, 2026

Northstar Cloud Holdings, Inc. reported revenue of $412.0 million for the quarter ended March 31, 2026, compared with $346.8 million in the prior-year period. Subscription revenue increased 24% year over year, while professional services revenue declined modestly as the company continued to emphasize higher-margin software mix.

Gross profit was $323.8 million, or 78.6% of revenue, compared with 77.2% in the prior-year period. Operating income was $75.8 million, or 18.4% of revenue, compared with 15.8% in the prior-year period. Net cash provided by operating activities was $68.4 million. Capital expenditures were $17.2 million in the quarter as the company continued its data-center optimization program.

Cash, cash equivalents, and marketable securities totaled $418.0 million as of March 31, 2026. Total debt was $298.0 million. Weighted-average diluted shares outstanding were 145.2 million.

Management noted continued demand strength in regulated industries and public sector. The company disclosed elongated customer expansion cycles among small and mid-market accounts and noted that larger enterprise buying committees continue to scrutinize payback periods and rollout pacing.

The company stated that it may continue investing in AI-assisted workflow capabilities and selective go-to-market hiring, which could affect the pace of near-term margin expansion. The filing also noted a modest FX benefit in the quarter, but did not indicate reliance on that benefit for the balance of the year.

Risk factors included longer sales cycles, implementation timing variability, and potential shifts in enterprise software spending patterns.`
    },
    transcript: {
      inputMode: 'text',
      text: `Northstar Cloud Holdings Q1 2026 Earnings Call Transcript
May 7, 2026

Daniel Mercer, Chief Executive Officer
We opened fiscal 2026 with durable demand in our enterprise workflow platform, but customers remain measured on the pace of new seat expansions. First quarter revenue grew 19% year over year to $412 million, ahead of the high end of our prior outlook. Subscription revenue grew 24%, while services revenue declined modestly as we remained disciplined on lower-margin implementation work.

We saw particular strength in regulated industries and public-sector wins, while small and mid-market customers remained more budget constrained. Net revenue retention was 112%, down from 115% a year ago, largely reflecting elongated expansion cycles rather than elevated churn.

Priya Shah, Chief Financial Officer
Non-GAAP gross margin was 78.6%, up 140 basis points year over year, driven by infrastructure efficiency and lower services mix. Non-GAAP operating margin was 18.4%, up 260 basis points year over year. Free cash flow was $61 million, or 15% margin.

Turning to guidance, for the second quarter we expect revenue between $418 million and $422 million and non-GAAP operating margin of approximately 18%. For the full year, we are raising revenue guidance to a range of $1.705 billion to $1.725 billion from $1.680 billion to $1.710 billion. We are maintaining full-year non-GAAP operating margin guidance at approximately 19% as we continue to invest in AI-assisted workflow features and selective go-to-market hiring in the back half.

We now expect stock-based compensation to be roughly 10 basis points lower as a percentage of revenue than our prior expectation. Capital expenditures should remain elevated in the first half before moderating in the fourth quarter as we complete the current data-center optimization program.

Daniel Mercer
Buying committees are asking for faster payback and more phased rollouts. That creates some duration risk in the near term even when budgets are ultimately approved.`
    },
    supportingMaterials: [
      {
        kind: 'earnings_release',
        inputMode: 'text',
        text: `Northstar Cloud Holdings reported first quarter revenue of $412 million, above the high end of guidance, and raised full-year revenue guidance to $1.705 billion to $1.725 billion. Non-GAAP operating margin guidance for the full year was maintained at approximately 19%.`
      }
    ]
  },
  {
    id: 'ridgeway-industrial',
    label: 'Example: industrials',
    description: 'Fictional industrial issuer with a 10-K style base and a softer call read-through.',
    baseline: {
      companyName: 'Ridgeway Motion Systems',
      unitLabel: 'USDm',
      currentRevenue: 4720,
      revenueGrowth: [2, 3, 3.5, 4, 4],
      grossMarginStart: 29.5,
      grossMarginEnd: 31,
      operatingMarginStart: 13.5,
      operatingMarginEnd: 15.2,
      taxRate: 23,
      capexPct: 3.1,
      daPct: 2.2,
      nwcPct: 2.4,
      wacc: 9.5,
      terminalGrowth: 2.5,
      shareCount: 82,
      netDebt: 640,
      exitEbitdaMultiple: 10.5,
    },
    filing: {
      inputMode: 'text',
      text: `Ridgeway Motion Systems Annual Report on Form 10-K
For the fiscal year ended December 31, 2025

Net sales for the year ended December 31, 2025 were $4.72 billion, compared with $4.86 billion in the prior year. Pricing remained positive, though industrial OEM volumes were weak in Europe and selected process end markets. Energy and aftermarket demand remained comparatively resilient.

Gross profit was $1.39 billion, or 29.4% of sales. Operating income was $638 million, or 13.5% of sales. Cash flow from operations was $521 million. Capital expenditures were $118 million.

Cash and equivalents totaled $246 million at year end. Total debt was $886 million. Weighted-average diluted shares outstanding were 82.1 million.

Management highlighted productivity actions, inventory normalization, and commercial pricing discipline as operating priorities for 2026. Risk factors included tariff exposure, freight and labor inflation, and continued uncertainty in European OEM demand.`
    },
    transcript: {
      inputMode: 'text',
      text: `Ridgeway Motion Systems Q4 2025 Earnings Call Transcript
February 19, 2026

Elena Cruz, Chief Executive Officer
Fourth quarter revenue declined 3% year over year to $1.18 billion, slightly better than we expected entering the quarter. Pricing remained positive across most product categories, but industrial OEM volumes stayed soft, especially in Europe. In contrast, our energy and aftermarket businesses were resilient, and North America distribution trends improved sequentially.

Adjusted EBITDA margin was 16.1%, down 90 basis points year over year, reflecting lower absorption and a less favorable mix. We executed another $22 million of productivity savings in the quarter and exited the year with inventory in better shape than expected.

For 2026, we expect revenue to be flat to up 2% organically, with first-half demand remaining choppy. We expect adjusted EBITDA margin to improve modestly over the course of the year as productivity actions outpace inflation in labor and freight. We are planning capital expenditures of approximately $145 million, up from $118 million in 2025, primarily tied to our automation program and a new bearings line in Texas.

Martin Keller, Chief Financial Officer
Free cash flow conversion should improve in 2026 as working capital normalizes, though we expect cash taxes to be a headwind. Tariffs remain an active watch item.`
    },
    supportingMaterials: [
      {
        kind: 'investor_presentation',
        inputMode: 'text',
        text: `Ridgeway Motion Systems investor presentation highlights mid-cycle EBITDA margin ambition above 17% and notes incremental upside if Europe recovers faster than expected.`
      }
    ]
  }
];
