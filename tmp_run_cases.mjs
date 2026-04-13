const cases = [
  { label: 'AAPL-10K', filingRequest: { mode: 'ticker_lookup', ticker: 'AAPL', filingType: '10-K' } },
  { label: 'MSFT-10K', filingRequest: { mode: 'ticker_lookup', ticker: 'MSFT', filingType: '10-K' } },
  { label: 'NVDA-Q3-10Q', filingRequest: { mode: 'ticker_lookup', ticker: 'NVDA', filingType: '10-Q', quarter: 'Q3' } },
];

async function runCase(baseUrl, testCase) {
  const res = await fetch(`${baseUrl}/api/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ filingRequest: testCase.filingRequest }),
  });
  const text = await res.text();
  const chunks = text.split('\n\n');
  let result = null;
  let error = null;
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const eventLine = lines.find((line) => line.startsWith('event:'));
    const dataLine = lines.find((line) => line.startsWith('data:'));
    if (!eventLine || !dataLine) continue;
    const event = eventLine.replace('event:', '').trim();
    const data = JSON.parse(dataLine.replace('data:', '').trim());
    if (event === 'result') result = data;
    if (event === 'error') error = data;
  }

  if (error) return { label: testCase.label, error };

  return {
    label: testCase.label,
    company: result?.filingMetadata?.company,
    status: result?.analysisStatus,
    baseline: result?.draftedBaseline ? {
      currentRevenue: result.draftedBaseline.currentRevenue,
      revenueGrowth: result.draftedBaseline.revenueGrowth,
      grossMarginStart: result.draftedBaseline.grossMarginStart,
      operatingMarginStart: result.draftedBaseline.operatingMarginStart,
      taxRate: result.draftedBaseline.taxRate,
      capexPct: result.draftedBaseline.capexPct,
      daPct: result.draftedBaseline.daPct,
      shareCount: result.draftedBaseline.shareCount,
      netDebt: result.draftedBaseline.netDebt,
      wacc: result.draftedBaseline.wacc,
      terminalGrowth: result.draftedBaseline.terminalGrowth,
    } : null,
    normalizedMetrics: result?.reportedBase?.normalizedMetrics,
    valuation: result?.modelPack?.scenarios?.base?.valuation || null,
    reviewFlags: result?.reviewFlags || [],
    missingBaseInputs: result?.missingBaseInputs || [],
  };
}

const baseUrl = process.argv[2] || 'http://localhost:8792';
const outputs = [];
for (const testCase of cases) {
  console.log(`RUNNING ${testCase.label}...`);
  outputs.push(await runCase(baseUrl, testCase));
}
console.log(JSON.stringify(outputs, null, 2));
