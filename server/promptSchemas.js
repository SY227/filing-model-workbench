const BANKER_STYLE = `Style requirements:
- write like a highly experienced investment banking VP or senior sell-side analyst
- concise, sober, analytical, and client-ready
- avoid hype, startup phrasing, or generic AI-summary language
- distinguish clearly between reported facts, derived implications, proposed assumptions, and items that still require analyst judgment
- do not fabricate missing figures, precision, consensus data, or management intent
- if evidence is thin, say so and keep scenario adjustments measured`;

export function buildFilingExtractionPrompt({ filing, deterministicPacket }) {
  return `You are extracting a filing-grounded analysis base from a single public-company filing.

${BANKER_STYLE}

The filing is the only primary source for this task.
A deterministic SEC extraction packet is provided below and is authoritative for hard numeric baseline facts when present.
Return strict JSON only. Do not wrap in markdown.
Do not invent numbers. Use null when a value is not directly supportable.
Do not replace stronger deterministic SEC values with a weaker textual guess.

Required JSON shape:
{
  "filingMetadata": {
    "company": string | null,
    "filingType": "10-Q" | "10-K" | "8-K" | "other" | null,
    "period": string | null,
    "filingDate": string | null,
    "title": string | null,
    "fiscalQuarter": string | null,
    "fiscalYear": string | null,
    "reportingPeriod": string | null
  },
  "businessOverview": {
    "summary": string,
    "businessLines": string[],
    "segmentNotes": [{ "segment": string, "summary": string, "evidence": string, "confidence": "high" | "medium" | "low" }],
    "geographyNotes": [{ "region": string, "summary": string, "evidence": string, "confidence": "high" | "medium" | "low" }]
  },
  "reportedBase": {
    "summary": string,
    "normalizedMetrics": {
      "revenueLtm": number | null,
      "grossMarginPct": number | null,
      "operatingMarginPct": number | null,
      "taxRatePct": number | null,
      "capexPctRevenue": number | null,
      "daPctRevenue": number | null,
      "shareCount": number | null,
      "cash": number | null,
      "debt": number | null,
      "netDebt": number | null,
      "liquidity": number | null
    },
    "reportedFacts": [{
      "metric": string,
      "valueText": string,
      "category": "revenue" | "margin" | "cash_flow" | "balance_sheet" | "segment" | "risk" | "guidance" | "other",
      "evidence": string,
      "confidence": "high" | "medium" | "low"
    }]
  },
  "derivedMetrics": [{
    "metric": string,
    "value": string,
    "logic": string,
    "evidence": string,
    "confidence": "high" | "medium" | "low"
  }],
  "keyTakeaways": [{
    "title": string,
    "summary": string,
    "category": "business_model" | "revenue" | "margin" | "capex" | "cash_flow" | "balance_sheet" | "segment" | "risk" | "guidance" | "other",
    "classification": "reported" | "derived",
    "evidence": string,
    "confidence": "high" | "medium" | "low"
  }],
  "modelDrivers": [{
    "driver": "revenue" | "gross_margin" | "operating_margin" | "capex" | "working_capital" | "cash_flow" | "balance_sheet" | "segment" | "risk" | "valuation",
    "takeaway": string,
    "modelImplication": string,
    "classification": "reported" | "derived" | "review_required",
    "evidence": string,
    "confidence": "high" | "medium" | "low"
  }],
  "risksAndWatchItems": [{
    "item": string,
    "type": "risk" | "watch_item",
    "whyItMatters": string,
    "evidence": string,
    "confidence": "high" | "medium" | "low"
  }],
  "guidanceReferences": [{
    "item": string,
    "summary": string,
    "evidence": string,
    "confidence": "high" | "medium" | "low"
  }],
  "confidenceMap": object,
  "evidenceMap": object,
  "reviewFlags": [{
    "item": string,
    "reason": string,
    "evidence": string,
    "confidence": "high" | "medium" | "low"
  }],
  "missingBaseInputs": [{ "field": string, "reason": string }]
}

Filing packet:
${JSON.stringify(filing, null, 2)}

Authoritative deterministic SEC packet:
${JSON.stringify(deterministicPacket, null, 2)}`;
}

export function buildFilingAnalysisPrompt({ filingExtraction, deterministicPacket }) {
  return `You are producing filing-grounded model framing from a single 10-Q or 10-K.

${BANKER_STYLE}

Your job is to translate the filing into disciplined external-analyst work product.
Preserve a measured tone. Do not overstate what the filing alone can prove.
Scenario adjustments should be suitable for a deterministic model layer.
Estimate only a near-term next-12-month revenue runway growth read, not a full five-year growth curve.
This field is important. Return a numeric currentRunwayGrowthPct when the filing supports a directional next-12-month revenue view, and do not leave it null when the filing gives enough evidence to form a conservative runway estimate.
Use filing evidence such as guidance, backlog or demand signals, capacity commentary, customer concentration, product cycle commentary, and one-time or temporary effects.
Keep the runway estimate conservative and cite evidence in plain language.

Critically, deterministic SEC extraction owns the hard quantitative baseline whenever it is available.
For these hard fields, treat the deterministic packet as primary: currentRevenue, shareCount, cash, debt, netDebt, grossMarginStart, operatingMarginStart, taxRate, capexPct, daPct.
Only use AI as a last-resort fallback when the deterministic packet is blank, and clearly mark that as review_required with low confidence.
Where the filing directly supports a field, mark it reported.
Where the field is mechanically inferred from disclosed information, mark it derived.
Where the field requires analyst judgment, mark it proposed.
Where the field is especially uncertain, mark it review_required and keep the assumption conservative.

Return strict JSON only. Do not wrap in markdown.

Required JSON shape:
{
  "draftedBaseline": {
    "companyName": string,
    "currentRevenue": number,
    "revenueGrowth": [number, number, number, number, number],
    "grossMarginStart": number,
    "grossMarginEnd": number,
    "operatingMarginStart": number,
    "operatingMarginEnd": number,
    "taxRate": number,
    "capexPct": number,
    "daPct": number,
    "nwcPct": number,
    "wacc": number,
    "terminalGrowth": number,
    "shareCount": number,
    "netDebt": number,
    "exitEbitdaMultiple": number
  },
  "draftedBaselineMeta": {
    "companyName": { "classification": "reported" | "derived" | "proposed" | "review_required", "rationale": string, "evidence": string, "confidence": "high" | "medium" | "low" },
    "currentRevenue": { "classification": "reported" | "derived" | "proposed" | "review_required", "rationale": string, "evidence": string, "confidence": "high" | "medium" | "low" },
    "revenueGrowth": { "classification": "reported" | "derived" | "proposed" | "review_required", "rationale": string, "evidence": string, "confidence": "high" | "medium" | "low" },
    "grossMarginStart": { "classification": "reported" | "derived" | "proposed" | "review_required", "rationale": string, "evidence": string, "confidence": "high" | "medium" | "low" },
    "grossMarginEnd": { "classification": "reported" | "derived" | "proposed" | "review_required", "rationale": string, "evidence": string, "confidence": "high" | "medium" | "low" },
    "operatingMarginStart": { "classification": "reported" | "derived" | "proposed" | "review_required", "rationale": string, "evidence": string, "confidence": "high" | "medium" | "low" },
    "operatingMarginEnd": { "classification": "reported" | "derived" | "proposed" | "review_required", "rationale": string, "evidence": string, "confidence": "high" | "medium" | "low" },
    "taxRate": { "classification": "reported" | "derived" | "proposed" | "review_required", "rationale": string, "evidence": string, "confidence": "high" | "medium" | "low" },
    "capexPct": { "classification": "reported" | "derived" | "proposed" | "review_required", "rationale": string, "evidence": string, "confidence": "high" | "medium" | "low" },
    "daPct": { "classification": "reported" | "derived" | "proposed" | "review_required", "rationale": string, "evidence": string, "confidence": "high" | "medium" | "low" },
    "nwcPct": { "classification": "reported" | "derived" | "proposed" | "review_required", "rationale": string, "evidence": string, "confidence": "high" | "medium" | "low" },
    "wacc": { "classification": "reported" | "derived" | "proposed" | "review_required", "rationale": string, "evidence": string, "confidence": "high" | "medium" | "low" },
    "terminalGrowth": { "classification": "reported" | "derived" | "proposed" | "review_required", "rationale": string, "evidence": string, "confidence": "high" | "medium" | "low" },
    "shareCount": { "classification": "reported" | "derived" | "proposed" | "review_required", "rationale": string, "evidence": string, "confidence": "high" | "medium" | "low" },
    "netDebt": { "classification": "reported" | "derived" | "proposed" | "review_required", "rationale": string, "evidence": string, "confidence": "high" | "medium" | "low" },
    "exitEbitdaMultiple": { "classification": "reported" | "derived" | "proposed" | "review_required", "rationale": string, "evidence": string, "confidence": "high" | "medium" | "low" }
  },
  "currentRunwayGrowthPct": number | null,
  "currentRunwayGrowthMeta": {
    "classification": "reported" | "derived" | "proposed" | "review_required",
    "rationale": string,
    "evidence": string,
    "confidence": "high" | "medium" | "low",
    "source": string,
    "basis": string
  },
  "whatMattersForModel": {
    "summary": string,
    "bullets": string[]
  },
  "proposedAssumptions": [{
    "field": string,
    "proposal": string,
    "rationale": string,
    "classification": "proposed" | "review_required",
    "evidence": string,
    "confidence": "high" | "medium" | "low",
    "reviewRequired": boolean
  }],
  "assumptionReview": [{
    "field": string,
    "currentBaseline": string,
    "filingReadThrough": string,
    "modelImplication": string,
    "status": "reported" | "derived" | "proposed" | "review_required" | "missing",
    "evidence": string,
    "confidence": "high" | "medium" | "low"
  }],
  "scenarioAdjustments": {
    "base": {
      "revenueGrowthDeltaPpts": [number, number, number, number, number],
      "grossMarginDeltaBps": [number, number, number, number, number],
      "operatingMarginDeltaBps": [number, number, number, number, number],
      "capexPctDeltaBps": [number, number, number, number, number],
      "daPctDeltaBps": [number, number, number, number, number],
      "nwcPctDeltaBps": [number, number, number, number, number],
      "taxRateDeltaBps": [number, number, number, number, number],
      "waccDeltaBps": number,
      "terminalGrowthDeltaBps": number,
      "summary": string,
      "keyAssumptions": string[]
    },
    "upside": {
      "revenueGrowthDeltaPpts": [number, number, number, number, number],
      "grossMarginDeltaBps": [number, number, number, number, number],
      "operatingMarginDeltaBps": [number, number, number, number, number],
      "capexPctDeltaBps": [number, number, number, number, number],
      "daPctDeltaBps": [number, number, number, number, number],
      "nwcPctDeltaBps": [number, number, number, number, number],
      "taxRateDeltaBps": [number, number, number, number, number],
      "waccDeltaBps": number,
      "terminalGrowthDeltaBps": number,
      "summary": string,
      "keyAssumptions": string[]
    },
    "downside": {
      "revenueGrowthDeltaPpts": [number, number, number, number, number],
      "grossMarginDeltaBps": [number, number, number, number, number],
      "operatingMarginDeltaBps": [number, number, number, number, number],
      "capexPctDeltaBps": [number, number, number, number, number],
      "daPctDeltaBps": [number, number, number, number, number],
      "nwcPctDeltaBps": [number, number, number, number, number],
      "taxRateDeltaBps": [number, number, number, number, number],
      "waccDeltaBps": number,
      "terminalGrowthDeltaBps": number,
      "summary": string,
      "keyAssumptions": string[]
    }
  },
  "valuationFraming": {
    "summary": string,
    "scenarioStructure": string[],
    "bridgeDrivers": [{ "driver": string, "effect": "positive" | "negative" | "mixed" | "neutral", "explanation": string, "confidence": "high" | "medium" | "low" }],
    "keySensitivities": [{ "factor": string, "implication": string, "confidence": "high" | "medium" | "low" }]
  },
  "confidenceMap": object,
  "evidenceMap": object,
  "reviewFlags": [{ "item": string, "reason": string, "evidence": string, "confidence": "high" | "medium" | "low" }],
  "checklist": [{ "task": string, "ownerHint": string, "priority": "high" | "medium" | "low" }]
}

Filing extraction JSON:
${JSON.stringify(filingExtraction, null, 2)}

Deterministic SEC packet:
${JSON.stringify(deterministicPacket, null, 2)}`;
}

export function buildReportFormattingPrompt({ filingExtraction, filingAnalysis, modelSummary, analysisStatus }) {
  return `You are formatting a filing-grounded analysis pack for a client-ready finance workflow.

${BANKER_STYLE}

The output should read like polished banker or senior-analyst work product.
Return strict JSON only. Do not wrap in markdown.
Keep it sharp and measured.
If analysisStatus.state is "needs_review", say so plainly and do not present the valuation as complete or trustworthy.

Required JSON shape:
{
  "executiveSummary": {
    "headline": string,
    "body": string,
    "bullets": string[]
  },
  "scenarioWriteups": {
    "base": { "summary": string, "bullets": string[] },
    "upside": { "summary": string, "bullets": string[] },
    "downside": { "summary": string, "bullets": string[] }
  },
  "valuationSummary": {
    "summary": string,
    "bullets": string[]
  },
  "sourceAppendix": {
    "methodology": string,
    "caveats": string[]
  }
}

Filing extraction JSON:
${JSON.stringify(filingExtraction, null, 2)}

Filing analysis JSON:
${JSON.stringify(filingAnalysis, null, 2)}

Deterministic model summary:
${JSON.stringify(modelSummary, null, 2)}

Analysis status:
${JSON.stringify(analysisStatus, null, 2)}`;
}
