const HORIZON = 5;
export const YEAR_LABELS = Array.from({ length: HORIZON }, (_, index) => `FY+${index + 1}`);

export const DEFAULT_BASELINE = {
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
  daPct: 2.0,
  nwcPct: 1.0,
  workingCapitalTargetPct: 1.0,
  workingCapitalProfile: 'balanced',
  wacc: 9.0,
  terminalGrowth: 2.5,
  shareCount: 100,
  netDebt: 0,
  exitEbitdaMultiple: 12,
};

export const ZERO_SCENARIO_ADJUSTMENTS = {
  revenueGrowthDeltaPpts: Array(HORIZON).fill(0),
  grossMarginDeltaBps: Array(HORIZON).fill(0),
  operatingMarginDeltaBps: Array(HORIZON).fill(0),
  capexPctDeltaBps: Array(HORIZON).fill(0),
  daPctDeltaBps: Array(HORIZON).fill(0),
  nwcPctDeltaBps: Array(HORIZON).fill(0),
  taxRateDeltaBps: Array(HORIZON).fill(0),
  waccDeltaBps: 0,
  terminalGrowthDeltaBps: 0,
  summary: '',
  keyAssumptions: [],
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
    workingCapitalTargetPct: clampNumber(input.workingCapitalTargetPct, clampNumber(input.nwcPct, DEFAULT_BASELINE.workingCapitalTargetPct, -10, 15), -10, 15),
    workingCapitalProfile: ['negative', 'light', 'balanced', 'inventory_heavy'].includes(input.workingCapitalProfile) ? input.workingCapitalProfile : DEFAULT_BASELINE.workingCapitalProfile,
    wacc: clampNumber(input.wacc, DEFAULT_BASELINE.wacc, 4, 20),
    terminalGrowth: clampNumber(input.terminalGrowth, DEFAULT_BASELINE.terminalGrowth, -2, 6),
    shareCount: clampNumber(input.shareCount, DEFAULT_BASELINE.shareCount, 0.1, 10_000_000),
    netDebt: clampNumber(input.netDebt, DEFAULT_BASELINE.netDebt, -10_000_000, 10_000_000),
    exitEbitdaMultiple: clampNumber(input.exitEbitdaMultiple, DEFAULT_BASELINE.exitEbitdaMultiple, 0, 50),
  };
}

export function normalizeScenarioAdjustments(input = {}) {
  return {
    revenueGrowthDeltaPpts: normalizeArray(input.revenueGrowthDeltaPpts, ZERO_SCENARIO_ADJUSTMENTS.revenueGrowthDeltaPpts, HORIZON, -10, 10),
    grossMarginDeltaBps: normalizeArray(input.grossMarginDeltaBps, ZERO_SCENARIO_ADJUSTMENTS.grossMarginDeltaBps, HORIZON, -1000, 1000),
    operatingMarginDeltaBps: normalizeArray(input.operatingMarginDeltaBps, ZERO_SCENARIO_ADJUSTMENTS.operatingMarginDeltaBps, HORIZON, -1200, 1200),
    capexPctDeltaBps: normalizeArray(input.capexPctDeltaBps, ZERO_SCENARIO_ADJUSTMENTS.capexPctDeltaBps, HORIZON, -800, 800),
    daPctDeltaBps: normalizeArray(input.daPctDeltaBps, ZERO_SCENARIO_ADJUSTMENTS.daPctDeltaBps, HORIZON, -500, 500),
    nwcPctDeltaBps: normalizeArray(input.nwcPctDeltaBps, ZERO_SCENARIO_ADJUSTMENTS.nwcPctDeltaBps, HORIZON, -500, 500),
    taxRateDeltaBps: normalizeArray(input.taxRateDeltaBps, ZERO_SCENARIO_ADJUSTMENTS.taxRateDeltaBps, HORIZON, -500, 500),
    waccDeltaBps: clampNumber(input.waccDeltaBps, 0, -200, 200),
    terminalGrowthDeltaBps: clampNumber(input.terminalGrowthDeltaBps, 0, -100, 100),
    summary: String(input.summary || '').trim(),
    keyAssumptions: Array.isArray(input.keyAssumptions) ? input.keyAssumptions.map(String).filter(Boolean).slice(0, 6) : [],
  };
}

export function buildModelPack({ baseline, scenarioAdjustments = {} }) {
  let normalizedAdjustments = {
    prior: normalizeScenarioAdjustments(ZERO_SCENARIO_ADJUSTMENTS),
    base: normalizeScenarioAdjustments(scenarioAdjustments?.base),
    upside: normalizeScenarioAdjustments(scenarioAdjustments?.upside),
    downside: normalizeScenarioAdjustments(scenarioAdjustments?.downside),
  };

  normalizedAdjustments = ensureScenarioSeparation(normalizedAdjustments);

  const priorView = buildScenarioModel('Prior View', baseline, normalizedAdjustments.prior);
  const baseScenario = buildScenarioModel('Base', baseline, normalizedAdjustments.base);
  const upsideScenario = buildScenarioModel('Upside', baseline, normalizedAdjustments.upside);
  const downsideScenario = buildScenarioModel('Downside', baseline, normalizedAdjustments.downside);

  const valuationSummary = {
    prior: priorView.valuation,
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
    priorView,
    scenarios: {
      base: baseScenario,
      upside: upsideScenario,
      downside: downsideScenario,
    },
    comparison: buildScenarioComparison(baseScenario, upsideScenario, downsideScenario, priorView),
    valuationSummary,
    valuationBridge: buildValuationBridge(baseline, normalizedAdjustments.base),
    baseSensitivity: buildDcfSensitivity(baseScenario),
    changeVsPrior: buildChangeVsPrior(priorView, baseScenario),
  };
}


const DEFAULT_UPSIDE_SCENARIO_SPREAD = {
  revenueGrowthDeltaPpts: [2.0, 2.0, 1.5, 1.5, 1.0],
  grossMarginDeltaBps: [50, 75, 100, 125, 150],
  operatingMarginDeltaBps: [75, 100, 125, 150, 175],
  capexPctDeltaBps: [-25, -25, -25, -25, -25],
  daPctDeltaBps: [0, 0, 0, 0, 0],
  nwcPctDeltaBps: [-25, -25, -25, -25, -25],
  taxRateDeltaBps: [0, 0, 0, 0, 0],
  waccDeltaBps: -50,
  terminalGrowthDeltaBps: 25,
  summary: 'Upside case applies stronger revenue cadence, operating leverage, lighter capital intensity, and a modestly more constructive valuation frame.',
  keyAssumptions: [
    'Higher revenue growth versus base case',
    'Stronger operating leverage',
    'Slightly lower WACC',
    'Slightly higher terminal growth',
  ],
};

const DEFAULT_DOWNSIDE_SCENARIO_SPREAD = {
  revenueGrowthDeltaPpts: [-2.0, -2.0, -1.5, -1.5, -1.0],
  grossMarginDeltaBps: [-50, -75, -100, -125, -150],
  operatingMarginDeltaBps: [-75, -100, -125, -150, -175],
  capexPctDeltaBps: [25, 25, 25, 25, 25],
  daPctDeltaBps: [0, 0, 0, 0, 0],
  nwcPctDeltaBps: [25, 25, 25, 25, 25],
  taxRateDeltaBps: [0, 0, 0, 0, 0],
  waccDeltaBps: 50,
  terminalGrowthDeltaBps: -25,
  summary: 'Downside case applies softer revenue cadence, margin pressure, heavier cash-flow drag, and a modestly more conservative valuation frame.',
  keyAssumptions: [
    'Lower revenue growth versus base case',
    'Weaker operating leverage',
    'Slightly higher WACC',
    'Slightly lower terminal growth',
  ],
};

function ensureScenarioSeparation(adjustments) {
  const base = adjustments.base || normalizeScenarioAdjustments();

  return {
    ...adjustments,
    base,
    upside: hasMeaningfulScenarioDelta(adjustments.upside, base)
      ? adjustments.upside
      : mergeScenarioSpread(base, DEFAULT_UPSIDE_SCENARIO_SPREAD),
    downside: hasMeaningfulScenarioDelta(adjustments.downside, base)
      ? adjustments.downside
      : mergeScenarioSpread(base, DEFAULT_DOWNSIDE_SCENARIO_SPREAD),
  };
}

function hasMeaningfulScenarioDelta(candidate, reference) {
  const candidateSignal = flattenScenarioSignal(candidate);
  const referenceSignal = flattenScenarioSignal(reference);

  return candidateSignal.some((value, index) => Math.abs(value - referenceSignal[index]) > 0.0001);
}

function flattenScenarioSignal(adjustment = {}) {
  return [
    ...(adjustment.revenueGrowthDeltaPpts || []),
    ...(adjustment.grossMarginDeltaBps || []),
    ...(adjustment.operatingMarginDeltaBps || []),
    ...(adjustment.capexPctDeltaBps || []),
    ...(adjustment.daPctDeltaBps || []),
    ...(adjustment.nwcPctDeltaBps || []),
    ...(adjustment.taxRateDeltaBps || []),
    adjustment.waccDeltaBps,
    adjustment.terminalGrowthDeltaBps,
  ].map((value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}

function mergeScenarioSpread(base, spread) {
  return normalizeScenarioAdjustments({
    ...base,
    revenueGrowthDeltaPpts: addScenarioArrays(base.revenueGrowthDeltaPpts, spread.revenueGrowthDeltaPpts),
    grossMarginDeltaBps: addScenarioArrays(base.grossMarginDeltaBps, spread.grossMarginDeltaBps),
    operatingMarginDeltaBps: addScenarioArrays(base.operatingMarginDeltaBps, spread.operatingMarginDeltaBps),
    capexPctDeltaBps: addScenarioArrays(base.capexPctDeltaBps, spread.capexPctDeltaBps),
    daPctDeltaBps: addScenarioArrays(base.daPctDeltaBps, spread.daPctDeltaBps),
    nwcPctDeltaBps: addScenarioArrays(base.nwcPctDeltaBps, spread.nwcPctDeltaBps),
    taxRateDeltaBps: addScenarioArrays(base.taxRateDeltaBps, spread.taxRateDeltaBps),
    waccDeltaBps: Number(base.waccDeltaBps || 0) + spread.waccDeltaBps,
    terminalGrowthDeltaBps: Number(base.terminalGrowthDeltaBps || 0) + spread.terminalGrowthDeltaBps,
    summary: base.summary || spread.summary,
    keyAssumptions: [
      ...(Array.isArray(base.keyAssumptions) ? base.keyAssumptions : []),
      ...spread.keyAssumptions,
    ].filter(Boolean).slice(0, 6),
  });
}

function addScenarioArrays(left = [], right = []) {
  return Array.from({ length: HORIZON }, (_value, index) => {
    const leftValue = Number(left[index]);
    const rightValue = Number(right[index]);
    return (Number.isFinite(leftValue) ? leftValue : 0) + (Number.isFinite(rightValue) ? rightValue : 0);
  });
}

function buildScenarioModel(label, baseline, adjustment) {
  const grossMarginPath = buildPath(baseline.grossMarginStart, baseline.grossMarginEnd).map(
    (value, index) => clamp(value + adjustment.grossMarginDeltaBps[index] / 100, -20, 95)
  );
  const operatingMarginPath = buildPath(baseline.operatingMarginStart, baseline.operatingMarginEnd).map(
    (value, index) => clamp(value + adjustment.operatingMarginDeltaBps[index] / 100, -40, 75)
  );
  const revenueGrowth = baseline.revenueGrowth.map((value, index) => clamp(value + adjustment.revenueGrowthDeltaPpts[index], -50, 60));
  const capexPctPath = YEAR_LABELS.map((_year, index) => clamp(baseline.capexPct + adjustment.capexPctDeltaBps[index] / 100, 0, 25));
  const daPctPath = YEAR_LABELS.map((_year, index) => clamp(baseline.daPct + adjustment.daPctDeltaBps[index] / 100, 0, 20));
  const nwcPctPath = buildWorkingCapitalPath({
    startPct: baseline.nwcPct,
    targetPct: baseline.workingCapitalTargetPct,
    profile: baseline.workingCapitalProfile,
  }).map((value, index) => clamp(value + adjustment.nwcPctDeltaBps[index] / 100, -20, 20));
  const taxRatePath = YEAR_LABELS.map((_year, index) => clamp(baseline.taxRate + adjustment.taxRateDeltaBps[index] / 100, 0, 45));
  const wacc = clamp(baseline.wacc + adjustment.waccDeltaBps / 100, 4, 20);
  const terminalGrowth = clamp(baseline.terminalGrowth + adjustment.terminalGrowthDeltaBps / 100, -2, Math.min(6, wacc - 1));

  let priorRevenue = baseline.currentRevenue;
  let priorWorkingCapital = baseline.currentRevenue * (baseline.nwcPct / 100);

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
  const pvForecastCashFlows = discounted.reduce((sum, row) => sum + row.pvFreeCashFlow, 0);
  const enterpriseValue = pvForecastCashFlows + pvTerminalValue;
  const equityValue = enterpriseValue - netDebt;
  const valuePerShare = shareCount > 0 ? equityValue / shareCount : null;
  const exitEnterpriseValue = exitEbitdaMultiple > 0 ? (forecastTable.at(-1)?.ebitda ?? 0) * exitEbitdaMultiple : null;
  const pvExitEnterpriseValue = Number.isFinite(exitEnterpriseValue) ? exitEnterpriseValue / Math.pow(1 + waccDecimal, forecastTable.length) : null;
  const enterpriseValueFromExit = Number.isFinite(pvExitEnterpriseValue) ? pvForecastCashFlows + pvExitEnterpriseValue : null;
  const equityValueFromExit = Number.isFinite(enterpriseValueFromExit) ? enterpriseValueFromExit - netDebt : null;
  const valuePerShareFromExit = shareCount > 0 && Number.isFinite(equityValueFromExit) ? equityValueFromExit / shareCount : null;
  const impliedTerminalEvEbitda = Number.isFinite(forecastTable.at(-1)?.ebitda) && Math.abs(forecastTable.at(-1)?.ebitda) > 0.0001
    ? terminalValue / forecastTable.at(-1).ebitda
    : null;

  return {
    wacc,
    terminalGrowth,
    terminalValue,
    pvTerminalValue,
    pvForecastCashFlows,
    enterpriseValue,
    equityValue,
    valuePerShare,
    exitMultipleValue: exitEnterpriseValue,
    terminalContributionPct: enterpriseValue !== 0 ? (pvTerminalValue / enterpriseValue) * 100 : null,
    impliedTerminalEvEbitda,
    methods: {
      primary: {
        kind: 'gordon_growth',
        enterpriseValue,
        equityValue,
        valuePerShare,
        terminalValue,
        pvTerminalValue,
      },
      exitMultipleCrossCheck: Number.isFinite(exitEnterpriseValue)
        ? {
          kind: 'exit_multiple',
          exitEbitdaMultiple,
          terminalValue: exitEnterpriseValue,
          pvTerminalValue: pvExitEnterpriseValue,
          enterpriseValue: enterpriseValueFromExit,
          equityValue: equityValueFromExit,
          valuePerShare: valuePerShareFromExit,
        }
        : null,
    },
    discountedCashFlows: discounted,
  };
}

function buildScenarioComparison(base, upside, downside, prior) {
  const finalBase = base.forecastTable.at(-1);
  const finalUpside = upside.forecastTable.at(-1);
  const finalDownside = downside.forecastTable.at(-1);

  return [
    {
      metric: 'FY+1 revenue growth',
      prior: prior.forecastTable[0]?.revenueGrowth,
      base: base.forecastTable[0]?.revenueGrowth,
      upside: upside.forecastTable[0]?.revenueGrowth,
      downside: downside.forecastTable[0]?.revenueGrowth,
      format: 'percent',
    },
    {
      metric: 'FY+5 revenue',
      prior: prior.forecastTable.at(-1)?.revenue,
      base: finalBase?.revenue,
      upside: finalUpside?.revenue,
      downside: finalDownside?.revenue,
      format: 'number',
    },
    {
      metric: 'FY+5 operating margin',
      prior: prior.forecastTable.at(-1)?.operatingMargin,
      base: finalBase?.operatingMargin,
      upside: finalUpside?.operatingMargin,
      downside: finalDownside?.operatingMargin,
      format: 'percent',
    },
    {
      metric: 'FY+5 free cash flow',
      prior: prior.forecastTable.at(-1)?.freeCashFlow,
      base: finalBase?.freeCashFlow,
      upside: finalUpside?.freeCashFlow,
      downside: finalDownside?.freeCashFlow,
      format: 'number',
    },
    {
      metric: 'Implied enterprise value',
      prior: prior.valuation.enterpriseValue,
      base: base.valuation.enterpriseValue,
      upside: upside.valuation.enterpriseValue,
      downside: downside.valuation.enterpriseValue,
      format: 'number',
    },
    {
      metric: 'Implied value per share',
      prior: prior.valuation.valuePerShare,
      base: base.valuation.valuePerShare,
      upside: upside.valuation.valuePerShare,
      downside: downside.valuation.valuePerShare,
      format: 'perShare',
    },
  ];
}

function buildChangeVsPrior(priorView, baseScenario) {
  const priorFinal = priorView.forecastTable.at(-1);
  const baseFinal = baseScenario.forecastTable.at(-1);
  return [
    {
      metric: 'FY+1 revenue growth',
      prior: priorView.forecastTable[0]?.revenueGrowth,
      revised: baseScenario.forecastTable[0]?.revenueGrowth,
      delta: (baseScenario.forecastTable[0]?.revenueGrowth ?? 0) - (priorView.forecastTable[0]?.revenueGrowth ?? 0),
      format: 'percent',
    },
    {
      metric: 'FY+5 operating margin',
      prior: priorFinal?.operatingMargin,
      revised: baseFinal?.operatingMargin,
      delta: (baseFinal?.operatingMargin ?? 0) - (priorFinal?.operatingMargin ?? 0),
      format: 'percent',
    },
    {
      metric: 'FY+5 free cash flow',
      prior: priorFinal?.freeCashFlow,
      revised: baseFinal?.freeCashFlow,
      delta: (baseFinal?.freeCashFlow ?? 0) - (priorFinal?.freeCashFlow ?? 0),
      format: 'number',
    },
    {
      metric: 'Implied enterprise value',
      prior: priorView.valuation.enterpriseValue,
      revised: baseScenario.valuation.enterpriseValue,
      delta: baseScenario.valuation.enterpriseValue - priorView.valuation.enterpriseValue,
      format: 'number',
    },
    {
      metric: 'Implied value per share',
      prior: priorView.valuation.valuePerShare,
      revised: baseScenario.valuation.valuePerShare,
      delta: (baseScenario.valuation.valuePerShare ?? 0) - (priorView.valuation.valuePerShare ?? 0),
      format: 'perShare',
    },
  ];
}

function buildValuationBridge(baseline, baseAdjustment) {
  const steps = [
    {
      key: 'prior',
      label: 'Prior view',
      adjustment: ZERO_SCENARIO_ADJUSTMENTS,
    },
    {
      key: 'revenue',
      label: 'Revenue cadence',
      adjustment: {
        ...ZERO_SCENARIO_ADJUSTMENTS,
        revenueGrowthDeltaPpts: baseAdjustment.revenueGrowthDeltaPpts,
      },
    },
    {
      key: 'margin',
      label: 'Margin read-through',
      adjustment: {
        ...ZERO_SCENARIO_ADJUSTMENTS,
        revenueGrowthDeltaPpts: baseAdjustment.revenueGrowthDeltaPpts,
        grossMarginDeltaBps: baseAdjustment.grossMarginDeltaBps,
        operatingMarginDeltaBps: baseAdjustment.operatingMarginDeltaBps,
      },
    },
    {
      key: 'cashflow',
      label: 'Cash flow intensity',
      adjustment: {
        ...ZERO_SCENARIO_ADJUSTMENTS,
        revenueGrowthDeltaPpts: baseAdjustment.revenueGrowthDeltaPpts,
        grossMarginDeltaBps: baseAdjustment.grossMarginDeltaBps,
        operatingMarginDeltaBps: baseAdjustment.operatingMarginDeltaBps,
        capexPctDeltaBps: baseAdjustment.capexPctDeltaBps,
        daPctDeltaBps: baseAdjustment.daPctDeltaBps,
        nwcPctDeltaBps: baseAdjustment.nwcPctDeltaBps,
        taxRateDeltaBps: baseAdjustment.taxRateDeltaBps,
      },
    },
    {
      key: 'valuation',
      label: 'Valuation frame',
      adjustment: baseAdjustment,
    },
  ].map((step) => ({
    ...step,
    scenario: buildScenarioModel(step.label, baseline, normalizeScenarioAdjustments(step.adjustment)),
  }));

  return steps.map((step, index) => {
    const previousEv = index === 0 ? step.scenario.valuation.enterpriseValue : steps[index - 1].scenario.valuation.enterpriseValue;
    const currentEv = step.scenario.valuation.enterpriseValue;
    return {
      key: step.key,
      label: step.label,
      enterpriseValue: currentEv,
      delta: index === 0 ? 0 : currentEv - previousEv,
    };
  });
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

function buildWorkingCapitalPath({ startPct, targetPct, profile = 'balanced' }) {
  const power = profile === 'negative'
    ? 1.9
    : profile === 'light'
      ? 1.7
      : profile === 'inventory_heavy'
        ? 1.2
        : 1.4;

  return YEAR_LABELS.map((_year, index) => {
    if (YEAR_LABELS.length === 1) return startPct;
    const t = index / (YEAR_LABELS.length - 1);
    return startPct + (targetPct - startPct) * Math.pow(t, power);
  });
}

function normalizeArray(input, fallback, length, min = -Infinity, max = Infinity) {
  const scalar = Number(input);
  const source = Array.isArray(input)
    ? input
    : Number.isFinite(scalar)
      ? Array(length).fill(scalar)
      : fallback;
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

function round1(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

export const DEFAULT_ASSET_MANAGER_BASELINE = {
  companyName: '',
  unitLabel: '$mm',
  aum: null,
  feeRelatedEarnings: null,
  distributableEarnings: null,
  managementFees: null,
  performanceIncome: null,
  bookValue: null,
  balanceSheetInvestments: null,
  shareCount: null,
  cash: null,
  debt: null,
  netDebt: null,
};

export const DEFAULT_DIRECTIONAL_BASELINE = {
  companyName: '',
  unitLabel: '$mm',
  shareCount: null,
  bookValue: null,
  earningsLikeAnchor: null,
  cash: null,
  debt: null,
  netDebt: null,
  anchorLabel: '',
};

const ASSET_MANAGER_MULTIPLES = {
  fre: { downside: 12, base: 16, upside: 20, weight: 0.45, label: 'FRE multiple' },
  de: { downside: 8, base: 11, upside: 14, weight: 0.35, label: 'Distributable earnings multiple' },
  book: { downside: 0.9, base: 1.2, upside: 1.5, weight: 0.2, label: 'Book / equity multiple' },
};

const DIRECTIONAL_BOOK_MULTIPLES = { downside: 0.8, base: 1.0, upside: 1.2 };
const DIRECTIONAL_EARNINGS_MULTIPLES = { downside: 8, base: 11, upside: 14 };

export function normalizeAssetManagerBaseline(input = {}) {
  return {
    companyName: String(input.companyName || '').trim(),
    unitLabel: String(input.unitLabel || DEFAULT_ASSET_MANAGER_BASELINE.unitLabel).trim() || DEFAULT_ASSET_MANAGER_BASELINE.unitLabel,
    aum: clampNullableNumber(input.aum, 0, 10_000_000_000),
    feeRelatedEarnings: clampNullableNumber(input.feeRelatedEarnings, -1_000_000, 1_000_000),
    distributableEarnings: clampNullableNumber(input.distributableEarnings, -1_000_000, 1_000_000),
    managementFees: clampNullableNumber(input.managementFees, -1_000_000, 1_000_000),
    performanceIncome: clampNullableNumber(input.performanceIncome, -1_000_000, 1_000_000),
    bookValue: clampNullableNumber(input.bookValue, -10_000_000, 10_000_000),
    balanceSheetInvestments: clampNullableNumber(input.balanceSheetInvestments, -10_000_000, 10_000_000),
    shareCount: clampNullableNumber(input.shareCount, 0.1, 10_000_000),
    cash: clampNullableNumber(input.cash, -10_000_000, 10_000_000),
    debt: clampNullableNumber(input.debt, -10_000_000, 10_000_000),
    netDebt: clampNullableNumber(input.netDebt, -10_000_000, 10_000_000),
  };
}

export function normalizeDirectionalBaseline(input = {}) {
  return {
    companyName: String(input.companyName || '').trim(),
    unitLabel: String(input.unitLabel || DEFAULT_DIRECTIONAL_BASELINE.unitLabel).trim() || DEFAULT_DIRECTIONAL_BASELINE.unitLabel,
    shareCount: clampNullableNumber(input.shareCount, 0.1, 10_000_000),
    bookValue: clampNullableNumber(input.bookValue, -10_000_000, 10_000_000),
    earningsLikeAnchor: clampNullableNumber(input.earningsLikeAnchor, -1_000_000, 1_000_000),
    cash: clampNullableNumber(input.cash, -10_000_000, 10_000_000),
    debt: clampNullableNumber(input.debt, -10_000_000, 10_000_000),
    netDebt: clampNullableNumber(input.netDebt, -10_000_000, 10_000_000),
    anchorLabel: String(input.anchorLabel || '').trim(),
  };
}

export function buildAssetManagerModelPack({ baseline }) {
  const normalized = normalizeAssetManagerBaseline(baseline);
  const baseScenario = buildAssetManagerScenarioModel('Base', normalized, 'base');
  const upsideScenario = buildAssetManagerScenarioModel('Upside', normalized, 'upside');
  const downsideScenario = buildAssetManagerScenarioModel('Downside', normalized, 'downside');
  const scenarios = { base: baseScenario, upside: upsideScenario, downside: downsideScenario };
  const anchorCount = baseScenario.valuation.availableAnchorCount;
  const valuationSummary = {
    range: {
      low: downsideScenario.valuation.valuePerShare,
      midpoint: baseScenario.valuation.valuePerShare,
      high: upsideScenario.valuation.valuePerShare,
    },
    methodLabel: baseScenario.valuation.methodLabel,
    confidence: baseScenario.valuation.confidence,
  };

  return {
    analysisMode: 'asset_manager',
    baseline: normalized,
    scenarios,
    comparison: buildAssetManagerComparison(scenarios),
    valuationSummary,
    baseSensitivity: null,
    anchorSnapshot: buildAssetManagerAnchorSnapshot(normalized),
    anchorWeights: buildAssetManagerAnchorWeights(baseScenario.valuation.anchorBreakdown),
    narrative: {
      summary: anchorCount === 1
        ? 'Only one valuation anchor was usable, so the range was widened and confidence was reduced.'
        : 'The valuation blends whichever anchor families were supported by the filing, with weights renormalized across the available anchors.',
    },
  };
}

export function buildAssetManagerScenarioModel(label, baseline, scenarioKey) {
  const valuation = runAssetManagerValuation({ baseline, scenarioKey });
  return {
    label,
    forecastTable: buildAssetManagerForecastRows(baseline, valuation),
    valuation,
    narrative: {
      summary: valuation.availableAnchorCount === 1
        ? `${label} case relies on a single supported anchor family and should be read as especially wide and directional.`
        : `${label} case blends supported anchor families across FRE, distributable earnings, and book value where available.`,
      keyAssumptions: valuation.anchorBreakdown.map((anchor) => `${anchor.label}: ${round2(anchor.multiple)}x / weight ${round1(anchor.weight * 100)}%`),
    },
  };
}

export function runAssetManagerValuation({ baseline, scenarioKey = 'base' }) {
  const shareCount = baseline.shareCount;
  const anchorInputs = [
    buildAssetManagerAnchor('fre', baseline.feeRelatedEarnings, shareCount, scenarioKey),
    buildAssetManagerAnchor('de', baseline.distributableEarnings, shareCount, scenarioKey),
    buildAssetManagerAnchor('book', baseline.bookValue, shareCount, scenarioKey),
  ].filter(Boolean);

  const widened = anchorInputs.length <= 1;
  const effectiveAnchors = anchorInputs.map((anchor) => {
    const multiple = widened ? widenMultiple(anchor.multiple, scenarioKey) : anchor.multiple;
    return { ...anchor, multiple, equityValue: anchor.metricValue * multiple, valuePerShare: shareCount > 0 ? (anchor.metricValue * multiple) / shareCount : null };
  });

  const totalWeight = effectiveAnchors.reduce((sum, anchor) => sum + anchor.baseWeight, 0) || 1;
  const weightedAnchors = effectiveAnchors.map((anchor) => ({ ...anchor, weight: anchor.baseWeight / totalWeight }));
  const equityValue = weightedAnchors.reduce((sum, anchor) => sum + (anchor.equityValue * anchor.weight), 0);
  const valuePerShare = shareCount > 0 ? equityValue / shareCount : null;
  const confidence = weightedAnchors.length >= 3 ? 'high' : weightedAnchors.length === 2 ? 'medium' : weightedAnchors.length === 1 ? 'low' : 'low';

  return {
    methodLabel: 'Blended asset-manager anchors',
    equityValue,
    enterpriseValue: null,
    valuePerShare,
    confidence,
    availableAnchorCount: weightedAnchors.length,
    anchorBreakdown: weightedAnchors,
    rangeIsWidened: widened,
  };
}

export function buildDirectionalModelPack({ baseline, directionalModeReason = '' }) {
  const normalized = normalizeDirectionalBaseline(baseline);
  const anchorType = Number.isFinite(normalized.shareCount) && Number.isFinite(normalized.bookValue) && Math.abs(normalized.bookValue) > 0.0001
    ? 'book'
    : Number.isFinite(normalized.shareCount) && Number.isFinite(normalized.earningsLikeAnchor) && Math.abs(normalized.earningsLikeAnchor) > 0.0001
      ? 'earnings'
      : null;

  const scenarios = {
    base: buildDirectionalScenarioModel('Base', normalized, 'base', anchorType),
    upside: buildDirectionalScenarioModel('Upside', normalized, 'upside', anchorType),
    downside: buildDirectionalScenarioModel('Downside', normalized, 'downside', anchorType),
  };

  return {
    analysisMode: 'directional_only',
    baseline: normalized,
    hasNumericValuation: Boolean(anchorType),
    anchorType,
    directionalModeReason,
    scenarios,
    valuationSummary: {
      range: anchorType ? {
        low: scenarios.downside.valuation.valuePerShare,
        midpoint: scenarios.base.valuation.valuePerShare,
        high: scenarios.upside.valuation.valuePerShare,
      } : null,
      methodLabel: anchorType === 'book' ? 'Directional book / equity range' : anchorType === 'earnings' ? 'Directional earnings-like range' : 'Directional narrative only',
      confidence: anchorType ? 'low' : 'low',
    },
    comparison: buildDirectionalComparison(scenarios, normalized, anchorType),
    baseSensitivity: null,
    anchorSnapshot: buildDirectionalAnchorSnapshot(normalized, anchorType),
    anchorWeights: [],
  };
}

function buildDirectionalScenarioModel(label, baseline, scenarioKey, anchorType) {
  if (!anchorType) {
    return {
      label,
      forecastTable: [],
      valuation: {
        methodLabel: 'Directional narrative only',
        equityValue: null,
        enterpriseValue: null,
        valuePerShare: null,
        confidence: 'low',
        anchorBreakdown: [],
        availableAnchorCount: 0,
      },
      narrative: {
        summary: 'Numeric valuation was withheld because the filing did not support a defensible share-count plus book/equity or earnings-like anchor.',
        keyAssumptions: [],
      },
    };
  }

  const multiple = anchorType === 'book'
    ? DIRECTIONAL_BOOK_MULTIPLES[scenarioKey]
    : DIRECTIONAL_EARNINGS_MULTIPLES[scenarioKey];
  const metricValue = anchorType === 'book' ? baseline.bookValue : baseline.earningsLikeAnchor;
  const equityValue = metricValue * multiple;
  const valuePerShare = baseline.shareCount > 0 ? equityValue / baseline.shareCount : null;
  const labelText = anchorType === 'book' ? 'Book / equity multiple' : (baseline.anchorLabel || 'Earnings-like anchor');

  return {
    label,
    forecastTable: buildDirectionalForecastRows(baseline, anchorType, multiple, metricValue),
    valuation: {
      methodLabel: anchorType === 'book' ? 'Directional book / equity range' : 'Directional earnings-like range',
      equityValue,
      enterpriseValue: null,
      valuePerShare,
      confidence: 'low',
      anchorBreakdown: [{ key: anchorType, label: labelText, metricValue, multiple, weight: 1, baseWeight: 1, equityValue, valuePerShare }],
      availableAnchorCount: 1,
    },
    narrative: {
      summary: anchorType === 'book'
        ? `${label} case applies a wide book / equity multiple to the filing-supported equity base.`
        : `${label} case applies a wide earnings-like multiple to the filing-supported anchor.` ,
      keyAssumptions: [`${labelText}: ${round2(multiple)}x`],
    },
  };
}

function buildAssetManagerComparison(scenarios) {
  return [
    { metric: 'Implied value per share', prior: null, base: scenarios.base.valuation.valuePerShare, upside: scenarios.upside.valuation.valuePerShare, downside: scenarios.downside.valuation.valuePerShare, format: 'perShare' },
    { metric: 'Implied equity value', prior: null, base: scenarios.base.valuation.equityValue, upside: scenarios.upside.valuation.equityValue, downside: scenarios.downside.valuation.equityValue, format: 'number' },
    { metric: 'Anchor count', prior: null, base: scenarios.base.valuation.availableAnchorCount, upside: scenarios.upside.valuation.availableAnchorCount, downside: scenarios.downside.valuation.availableAnchorCount, format: 'count' },
  ];
}

function buildDirectionalComparison(scenarios, baseline, anchorType) {
  return [
    { metric: 'Implied value per share', prior: null, base: scenarios.base.valuation.valuePerShare, upside: scenarios.upside.valuation.valuePerShare, downside: scenarios.downside.valuation.valuePerShare, format: 'perShare' },
    { metric: anchorType === 'book' ? 'Book value' : (baseline.anchorLabel || 'Earnings-like anchor'), prior: null, base: anchorType === 'book' ? baseline.bookValue : baseline.earningsLikeAnchor, upside: anchorType === 'book' ? baseline.bookValue : baseline.earningsLikeAnchor, downside: anchorType === 'book' ? baseline.bookValue : baseline.earningsLikeAnchor, format: 'number' },
  ];
}

function buildAssetManagerAnchorSnapshot(baseline) {
  return [
    { metric: 'AUM', value: baseline.aum, format: 'number' },
    { metric: 'Fee-related earnings', value: baseline.feeRelatedEarnings, format: 'number' },
    { metric: 'Distributable earnings', value: baseline.distributableEarnings, format: 'number' },
    { metric: 'Book value', value: baseline.bookValue, format: 'number' },
    { metric: 'Share count', value: baseline.shareCount, format: 'count' },
  ].filter((row) => Number.isFinite(row.value));
}

function buildDirectionalAnchorSnapshot(baseline, anchorType) {
  return [
    { metric: 'Share count', value: baseline.shareCount, format: 'count' },
    { metric: 'Book value', value: baseline.bookValue, format: 'number' },
    { metric: anchorType === 'earnings' ? (baseline.anchorLabel || 'Earnings-like anchor') : 'Earnings-like anchor', value: baseline.earningsLikeAnchor, format: 'number' },
  ].filter((row) => Number.isFinite(row.value));
}

function buildAssetManagerAnchorWeights(anchorBreakdown = []) {
  return anchorBreakdown.map((anchor) => ({
    key: anchor.key,
    label: anchor.label,
    enterpriseValue: anchor.equityValue,
    delta: anchor.weight * 100,
    format: 'weight',
  }));
}

function buildAssetManagerForecastRows(baseline, valuation) {
  return [
    { year: 'Current', aum: baseline.aum, feeRelatedEarnings: baseline.feeRelatedEarnings, distributableEarnings: baseline.distributableEarnings, bookValue: baseline.bookValue, valuePerShare: valuation.valuePerShare },
  ];
}

function buildDirectionalForecastRows(baseline, anchorType, multiple, metricValue) {
  return [
    { year: 'Current', shareCount: baseline.shareCount, bookValue: baseline.bookValue, earningsLikeAnchor: baseline.earningsLikeAnchor, selectedMultiple: multiple, selectedAnchor: metricValue, valuePerShare: baseline.shareCount > 0 ? (metricValue * multiple) / baseline.shareCount : null, anchorType },
  ];
}

function buildAssetManagerAnchor(key, metricValue, shareCount, scenarioKey) {
  if (!Number.isFinite(metricValue) || Math.abs(metricValue) < 0.0001 || !Number.isFinite(shareCount) || shareCount <= 0) return null;
  const config = ASSET_MANAGER_MULTIPLES[key];
  if (!config) return null;
  return {
    key,
    label: config.label,
    metricValue,
    multiple: config[scenarioKey],
    baseWeight: config.weight,
  };
}

function widenMultiple(multiple, scenarioKey) {
  if (scenarioKey === 'downside') return multiple * 0.9;
  if (scenarioKey === 'upside') return multiple * 1.1;
  return multiple;
}

function clampNullableNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return clamp(numeric, min, max);
}
