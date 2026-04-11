const HORIZON = 5;
const YEAR_LABELS = Array.from({ length: HORIZON }, (_, index) => `FY+${index + 1}`);

const DEFAULT_BASELINE = {
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
  daPct: 2.0,
  nwcPct: 1.0,
  wacc: 9.0,
  terminalGrowth: 3.0,
  shareCount: 100,
  netDebt: 0,
  exitEbitdaMultiple: 12,
};

export function normalizeBaseline(input = {}) {
  const revenueGrowth = normalizeArray(input.revenueGrowth, DEFAULT_BASELINE.revenueGrowth, HORIZON);

  return {
    companyName: String(input.companyName || '').trim(),
    unitLabel: String(input.unitLabel || DEFAULT_BASELINE.unitLabel).trim() || DEFAULT_BASELINE.unitLabel,
    currentRevenue: clampNumber(input.currentRevenue, DEFAULT_BASELINE.currentRevenue, 1, 10_000_000),
    revenueGrowth,
    grossMarginStart: clampNumber(input.grossMarginStart, DEFAULT_BASELINE.grossMarginStart, -20, 95),
    grossMarginEnd: clampNumber(input.grossMarginEnd, DEFAULT_BASELINE.grossMarginEnd, -20, 95),
    operatingMarginStart: clampNumber(input.operatingMarginStart, DEFAULT_BASELINE.operatingMarginStart, -40, 60),
    operatingMarginEnd: clampNumber(input.operatingMarginEnd, DEFAULT_BASELINE.operatingMarginEnd, -40, 60),
    taxRate: clampNumber(input.taxRate, DEFAULT_BASELINE.taxRate, 0, 45),
    capexPct: clampNumber(input.capexPct, DEFAULT_BASELINE.capexPct, 0, 20),
    daPct: clampNumber(input.daPct, DEFAULT_BASELINE.daPct, 0, 15),
    nwcPct: clampNumber(input.nwcPct, DEFAULT_BASELINE.nwcPct, -10, 15),
    wacc: clampNumber(input.wacc, DEFAULT_BASELINE.wacc, 4, 20),
    terminalGrowth: clampNumber(input.terminalGrowth, DEFAULT_BASELINE.terminalGrowth, -2, 6),
    shareCount: clampNumber(input.shareCount, DEFAULT_BASELINE.shareCount, 0.1, 10_000_000),
    netDebt: clampNumber(input.netDebt, DEFAULT_BASELINE.netDebt, -10_000_000, 10_000_000),
    exitEbitdaMultiple: clampNumber(input.exitEbitdaMultiple, DEFAULT_BASELINE.exitEbitdaMultiple, 0, 50),
  };
}

export function normalizeScenarioAdjustments(input = {}) {
  return {
    revenueGrowthDeltaPpts: normalizeArray(input.revenueGrowthDeltaPpts, Array(HORIZON).fill(0), HORIZON, -10, 10),
    grossMarginDeltaBps: normalizeArray(input.grossMarginDeltaBps, Array(HORIZON).fill(0), HORIZON, -1000, 1000),
    operatingMarginDeltaBps: normalizeArray(input.operatingMarginDeltaBps, Array(HORIZON).fill(0), HORIZON, -1200, 1200),
    capexPctDeltaBps: normalizeArray(input.capexPctDeltaBps, Array(HORIZON).fill(0), HORIZON, -800, 800),
    daPctDeltaBps: normalizeArray(input.daPctDeltaBps, Array(HORIZON).fill(0), HORIZON, -500, 500),
    nwcPctDeltaBps: normalizeArray(input.nwcPctDeltaBps, Array(HORIZON).fill(0), HORIZON, -500, 500),
    taxRateDeltaBps: normalizeArray(input.taxRateDeltaBps, Array(HORIZON).fill(0), HORIZON, -500, 500),
    waccDeltaBps: clampNumber(input.waccDeltaBps, 0, -200, 200),
    terminalGrowthDeltaBps: clampNumber(input.terminalGrowthDeltaBps, 0, -100, 100),
    summary: String(input.summary || '').trim(),
    keyAssumptions: Array.isArray(input.keyAssumptions) ? input.keyAssumptions.map(String).filter(Boolean).slice(0, 6) : [],
  };
}

export function buildModelPack({ baseline, scenarioAdjustments }) {
  const baseScenario = buildScenarioModel('Base', baseline, normalizeScenarioAdjustments(scenarioAdjustments.base));
  const upsideScenario = buildScenarioModel('Upside', baseline, normalizeScenarioAdjustments(scenarioAdjustments.upside));
  const downsideScenario = buildScenarioModel('Downside', baseline, normalizeScenarioAdjustments(scenarioAdjustments.downside));

  const valuationSummary = {
    base: baseScenario.valuation,
    upside: upsideScenario.valuation,
    downside: downsideScenario.valuation,
    range: {
      low: downsideScenario.valuation.valuePerShare,
      midpoint: baseScenario.valuation.valuePerShare,
      high: upsideScenario.valuation.valuePerShare,
    },
  };

  return {
    years: YEAR_LABELS,
    baseline,
    scenarios: {
      base: baseScenario,
      upside: upsideScenario,
      downside: downsideScenario,
    },
    comparison: buildScenarioComparison(baseScenario, upsideScenario, downsideScenario),
    valuationSummary,
    baseSensitivity: buildDcfSensitivity(baseScenario),
  };
}

function buildScenarioModel(label, baseline, adjustment) {
  const grossMarginPath = buildPath(baseline.grossMarginStart, baseline.grossMarginEnd).map(
    (value, index) => clamp(value + adjustment.grossMarginDeltaBps[index] / 100, -20, 95)
  );
  const operatingMarginPath = buildPath(baseline.operatingMarginStart, baseline.operatingMarginEnd).map(
    (value, index) => clamp(value + adjustment.operatingMarginDeltaBps[index] / 100, -40, 60)
  );
  const revenueGrowth = baseline.revenueGrowth.map((value, index) => clamp(value + adjustment.revenueGrowthDeltaPpts[index], -50, 60));
  const capexPctPath = YEAR_LABELS.map((_year, index) => clamp(baseline.capexPct + adjustment.capexPctDeltaBps[index] / 100, 0, 25));
  const daPctPath = YEAR_LABELS.map((_year, index) => clamp(baseline.daPct + adjustment.daPctDeltaBps[index] / 100, 0, 20));
  const nwcPctPath = YEAR_LABELS.map((_year, index) => clamp(baseline.nwcPct + adjustment.nwcPctDeltaBps[index] / 100, -20, 20));
  const taxRatePath = YEAR_LABELS.map((_year, index) => clamp(baseline.taxRate + adjustment.taxRateDeltaBps[index] / 100, 0, 45));
  const wacc = clamp(baseline.wacc + adjustment.waccDeltaBps / 100, 4, 20);
  const terminalGrowth = clamp(baseline.terminalGrowth + adjustment.terminalGrowthDeltaBps / 100, -2, Math.min(6, wacc - 1));

  let priorRevenue = baseline.currentRevenue;
  let priorWorkingCapital = priorRevenue * (nwcPctPath[0] / 100);

  const forecastTable = YEAR_LABELS.map((year, index) => {
    const revenue = priorRevenue * (1 + revenueGrowth[index] / 100);
    const grossProfit = revenue * (grossMarginPath[index] / 100);
    const operatingIncome = revenue * (operatingMarginPath[index] / 100);
    const tax = Math.max(operatingIncome, 0) * (taxRatePath[index] / 100);
    const nopat = operatingIncome - tax;
    const da = revenue * (daPctPath[index] / 100);
    const capex = revenue * (capexPctPath[index] / 100);
    const workingCapital = revenue * (nwcPctPath[index] / 100);
    const deltaWorkingCapital = workingCapital - priorWorkingCapital;
    const freeCashFlow = nopat + da - capex - deltaWorkingCapital;
    const ebitda = operatingIncome + da;

    priorRevenue = revenue;
    priorWorkingCapital = workingCapital;

    return {
      year,
      revenue,
      revenueGrowth: revenueGrowth[index],
      grossMargin: grossMarginPath[index],
      grossProfit,
      operatingMargin: operatingMarginPath[index],
      operatingIncome,
      ebitda,
      taxRate: taxRatePath[index],
      tax,
      nopat,
      capexPct: capexPctPath[index],
      capex,
      daPct: daPctPath[index],
      da,
      nwcPct: nwcPctPath[index],
      deltaWorkingCapital,
      freeCashFlow,
    };
  });

  const valuation = runDcf({
    forecastTable,
    wacc,
    terminalGrowth,
    shareCount: baseline.shareCount,
    netDebt: baseline.netDebt,
    exitEbitdaMultiple: baseline.exitEbitdaMultiple,
  });

  return {
    label,
    assumptions: {
      revenueGrowth,
      grossMarginPath,
      operatingMarginPath,
      capexPctPath,
      daPctPath,
      nwcPctPath,
      taxRatePath,
      wacc,
      terminalGrowth,
    },
    forecastTable,
    valuation,
    narrative: {
      summary: adjustment.summary,
      keyAssumptions: adjustment.keyAssumptions,
    },
  };
}

function runDcf({ forecastTable, wacc, terminalGrowth, shareCount, netDebt, exitEbitdaMultiple }) {
  const waccDecimal = wacc / 100;
  const terminalGrowthDecimal = Math.min(terminalGrowth / 100, waccDecimal - 0.01);

  const discounted = forecastTable.map((row, index) => {
    const discountFactor = 1 / Math.pow(1 + waccDecimal, index + 1);
    const pvFreeCashFlow = row.freeCashFlow * discountFactor;
    return {
      year: row.year,
      discountFactor,
      pvFreeCashFlow,
    };
  });

  const terminalBase = forecastTable.at(-1)?.freeCashFlow ?? 0;
  const terminalValue = (terminalBase * (1 + terminalGrowthDecimal)) / Math.max(waccDecimal - terminalGrowthDecimal, 0.01);
  const pvTerminalValue = terminalValue / Math.pow(1 + waccDecimal, forecastTable.length);
  const enterpriseValue = discounted.reduce((sum, row) => sum + row.pvFreeCashFlow, 0) + pvTerminalValue;
  const equityValue = enterpriseValue - netDebt;
  const valuePerShare = shareCount > 0 ? equityValue / shareCount : null;
  const exitMultipleValue = exitEbitdaMultiple > 0 ? (forecastTable.at(-1)?.ebitda ?? 0) * exitEbitdaMultiple : null;

  return {
    wacc,
    terminalGrowth,
    terminalValue,
    pvTerminalValue,
    enterpriseValue,
    equityValue,
    valuePerShare,
    exitMultipleValue,
    discountedCashFlows: discounted,
  };
}

function buildScenarioComparison(base, upside, downside) {
  const finalBase = base.forecastTable.at(-1);
  const finalUpside = upside.forecastTable.at(-1);
  const finalDownside = downside.forecastTable.at(-1);

  return [
    {
      metric: 'FY+1 revenue growth',
      base: base.forecastTable[0]?.revenueGrowth,
      upside: upside.forecastTable[0]?.revenueGrowth,
      downside: downside.forecastTable[0]?.revenueGrowth,
      format: 'percent',
    },
    {
      metric: 'FY+5 revenue',
      base: finalBase?.revenue,
      upside: finalUpside?.revenue,
      downside: finalDownside?.revenue,
      format: 'number',
    },
    {
      metric: 'FY+5 operating margin',
      base: finalBase?.operatingMargin,
      upside: finalUpside?.operatingMargin,
      downside: finalDownside?.operatingMargin,
      format: 'percent',
    },
    {
      metric: 'FY+5 free cash flow',
      base: finalBase?.freeCashFlow,
      upside: finalUpside?.freeCashFlow,
      downside: finalDownside?.freeCashFlow,
      format: 'number',
    },
    {
      metric: 'Implied enterprise value',
      base: base.valuation.enterpriseValue,
      upside: upside.valuation.enterpriseValue,
      downside: downside.valuation.enterpriseValue,
      format: 'number',
    },
    {
      metric: 'Implied value per share',
      base: base.valuation.valuePerShare,
      upside: upside.valuation.valuePerShare,
      downside: downside.valuation.valuePerShare,
      format: 'perShare',
    },
  ];
}

function buildDcfSensitivity(baseScenario) {
  const waccOffsets = [-0.5, 0, 0.5];
  const terminalOffsets = [-0.5, 0, 0.5];
  const forecastTable = baseScenario.forecastTable;

  return {
    waccValues: waccOffsets.map((offset) => round2(baseScenario.valuation.wacc + offset)),
    terminalGrowthValues: terminalOffsets.map((offset) => round2(baseScenario.valuation.terminalGrowth + offset)),
    matrix: terminalOffsets.map((terminalOffset) =>
      waccOffsets.map((waccOffset) => {
        const valuation = runDcf({
          forecastTable,
          wacc: clamp(baseScenario.valuation.wacc + waccOffset, 4, 20),
          terminalGrowth: clamp(baseScenario.valuation.terminalGrowth + terminalOffset, -2, baseScenario.valuation.wacc + waccOffset - 1),
          shareCount: 1,
          netDebt: 0,
          exitEbitdaMultiple: 0,
        });
        return valuation.enterpriseValue;
      })
    ),
  };
}

function buildPath(start, end) {
  return YEAR_LABELS.map((_year, index) => {
    if (YEAR_LABELS.length === 1) return start;
    const t = index / (YEAR_LABELS.length - 1);
    return start + (end - start) * t;
  });
}

function normalizeArray(input, fallback, length, min = -Infinity, max = Infinity) {
  const source = Array.isArray(input) ? input : fallback;
  return Array.from({ length }, (_value, index) => clampNumber(source[index], fallback[index] ?? 0, min, max));
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
