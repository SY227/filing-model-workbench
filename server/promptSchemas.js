const BANKER_STYLE = `Style requirements:
- write like a highly experienced investment banking VP or senior sell-side analyst
- concise, sober, analytical, and client-ready
- avoid hype, startup phrasing, or generic AI-summary language
- distinguish clearly between reported facts, derived implications, proposed assumptions, and items that still require analyst judgment
- do not fabricate missing figures, precision, consensus data, or management intent
- if evidence is thin, say so and keep scenario adjustments measured`;

function buildExtractionModeInstructions(issuerArchetype) {
  if (issuerArchetype === 'asset_manager') {
    return `Focus on alternative-asset-manager economics.
Prioritize AUM, fee-paying AUM, fee-related earnings, distributable earnings, management fees, performance or incentive income, book value, balance-sheet investments, share count, cash, debt, and net debt.
Do not force gross margin, operating margin, capex, or D&A into the primary template when those are not the right economics.`;
  }

  if (issuerArchetype === 'financial_other' || issuerArchetype === 'directional_only') {
    return `Focus on the issuer's actual valuation anchors and operating frame.
Look for book value, stockholders' equity, earnings-like anchors, capital ratios, net interest income, premiums, FFO or AFFO, and other issuer-specific balance-sheet or earnings anchors.
Do not force the filing into an operating-company DCF template when that is not defensible.`;
  }

  return `Use the standard operating-company lane.
Deterministic SEC extraction remains authoritative for hard numeric baseline facts when present.`;
}

export function buildFilingExtractionPrompt({ filing, deterministicPacket, issuerArchetype = 'operating_company' }) {
  return `You are extracting a filing-grounded analysis base from a single public-company filing.

${BANKER_STYLE}

The filing is the only primary source for this task.
A deterministic SEC extraction packet is provided below and is authoritative for hard numeric baseline facts when present.
Provisional issuer archetype: ${issuerArchetype}.
${buildExtractionModeInstructions(issuerArchetype)}
Return strict JSON only. Do not wrap in markdown.
Do not invent numbers. Use null when a value is not directly supportable.
Do not replace stronger deterministic SEC values with a weaker textual guess.

Required JSON shape:
{
  "issuerArchetype": "operating_company" | "asset_manager" | "financial_other" | "directional_only" | null,
  "analysisMode": string | null,
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
  "assetManagerMetrics": {
    "aum": { "value": number | null, "classification": "reported" | "derived" | "review_required", "evidence": string, "confidence": "high" | "medium" | "low" },
    "feeRelatedEarnings": { "value": number | null, "classification": "reported" | "derived" | "review_required", "evidence": string, "confidence": "high" | "medium" | "low" },
    "distributableEarnings": { "value": number | null, "classification": "reported" | "derived" | "review_required", "evidence": string, "confidence": "high" | "medium" | "low" },
    "managementFees": { "value": number | null, "classification": "reported" | "derived" | "review_required", "evidence": string, "confidence": "high" | "medium" | "low" },
    "performanceIncome": { "value": number | null, "classification": "reported" | "derived" | "review_required", "evidence": string, "confidence": "high" | "medium" | "low" },
    "bookValue": { "value": number | null, "classification": "reported" | "derived" | "review_required", "evidence": string, "confidence": "high" | "medium" | "low" },
    "balanceSheetInvestments": { "value": number | null, "classification": "reported" | "derived" | "review_required", "evidence": string, "confidence": "high" | "medium" | "low" },
    "shareCount": { "value": number | null, "classification": "reported" | "derived" | "review_required", "evidence": string, "confidence": "high" | "medium" | "low" },
    "cash": { "value": number | null, "classification": "reported" | "derived" | "review_required", "evidence": string, "confidence": "high" | "medium" | "low" },
    "debt": { "value": number | null, "classification": "reported" | "derived" | "review_required", "evidence": string, "confidence": "high" | "medium" | "low" },
    "netDebt": { "value": number | null, "classification": "reported" | "derived" | "review_required", "evidence": string, "confidence": "high" | "medium" | "low" }
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
This prompt is for operating companies only.
Estimate only a near-term next-12-month revenue runway growth read, not a full five-year growth curve.
Deterministic SEC extraction owns the hard quantitative baseline whenever it is available.
For these hard fields, treat the deterministic packet as primary: currentRevenue, shareCount, cash, debt, netDebt, grossMarginStart, operatingMarginStart, taxRate, capexPct, daPct.
Only use AI as a last-resort fallback when the deterministic packet is blank, and clearly mark that as review_required with low confidence.
Where the filing directly supports a field, mark it reported.
Where the field is mechanically inferred from disclosed information, mark it derived.
Where the field requires analyst judgment, mark it proposed.
Where the field is especially uncertain, mark it review_required and keep the assumption conservative.

Return strict JSON only. Do not wrap in markdown.

Required JSON shape:
{
  "analysisMode": "operating_company",
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
  "draftedBaselineMeta": object,
  "currentRunwayGrowthPct": number | null,
  "currentRunwayGrowthMeta": {
    "classification": "reported" | "derived" | "proposed" | "review_required",
    "rationale": string,
    "evidence": string,
    "confidence": "high" | "medium" | "low",
    "source": string,
    "basis": string
  },
  "whatMattersForModel": { "summary": string, "bullets": string[] },
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
    "base": object,
    "upside": object,
    "downside": object
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

export function buildAssetManagerAnalysisPrompt({ filingExtraction, deterministicPacket }) {
  return `You are producing filing-grounded valuation framing for an alternative asset manager.

${BANKER_STYLE}

This lane is explicitly for asset managers, not operating-company DCF work.
Focus on AUM, fee-paying AUM, fee-related earnings, distributable earnings, management fees, performance or incentive income, book value, balance-sheet investments, share count, cash, debt, and net debt.
Do not treat gross margin, operating margin, capex, or D&A as the primary template unless the filing makes them truly central.
Keep the output usable for a valuation engine built from three anchor families: FRE multiple, distributable-earnings multiple, and book/equity multiple.
If a field is missing, say so. Do not invent it.

Return strict JSON only. Do not wrap in markdown.

Required JSON shape:
{
  "analysisMode": "asset_manager",
  "draftedBaseline": {
    "companyName": string,
    "aum": number | null,
    "feeRelatedEarnings": number | null,
    "distributableEarnings": number | null,
    "managementFees": number | null,
    "performanceIncome": number | null,
    "bookValue": number | null,
    "balanceSheetInvestments": number | null,
    "shareCount": number | null,
    "cash": number | null,
    "debt": number | null,
    "netDebt": number | null
  },
  "draftedBaselineMeta": object,
  "whatMattersForModel": { "summary": string, "bullets": string[] },
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
  "valuationFraming": {
    "summary": string,
    "scenarioStructure": string[],
    "bridgeDrivers": [{ "driver": string, "effect": "positive" | "negative" | "mixed" | "neutral", "explanation": string, "confidence": "high" | "medium" | "low" }],
    "keySensitivities": [{ "factor": string, "implication": string, "confidence": "high" | "medium" | "low" }]
  },
  "directionalModeReason": string,
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

export function buildDirectionalAnalysisPrompt({ filingExtraction, deterministicPacket, issuerArchetype = 'directional_only' }) {
  return `You are producing an honest directional valuation frame for a non-operating-company issuer.

${BANKER_STYLE}

Issuer archetype: ${issuerArchetype}.
Do not force a full DCF.
If the filing supports book value, stockholders' equity, or an earnings-like anchor, surface that clearly so a simple wide directional range can be shown.
If the filing does not support even that, say why numeric valuation should be withheld.

Return strict JSON only. Do not wrap in markdown.

Required JSON shape:
{
  "analysisMode": "directional_only",
  "draftedBaseline": {
    "companyName": string,
    "shareCount": number | null,
    "bookValue": number | null,
    "earningsLikeAnchor": number | null,
    "cash": number | null,
    "debt": number | null,
    "netDebt": number | null,
    "anchorLabel": string | null
  },
  "draftedBaselineMeta": object,
  "whatMattersForModel": { "summary": string, "bullets": string[] },
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
  "valuationFraming": {
    "summary": string,
    "scenarioStructure": string[],
    "bridgeDrivers": [{ "driver": string, "effect": "positive" | "negative" | "mixed" | "neutral", "explanation": string, "confidence": "high" | "medium" | "low" }],
    "keySensitivities": [{ "factor": string, "implication": string, "confidence": "high" | "medium" | "low" }]
  },
  "directionalModeReason": string,
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

export function buildRunwayGrowthPrompt({ filingExtraction, deterministicPacket, retry = false }) {
  return `You are estimating next-12-month revenue runway growth from a single 10-Q or 10-K.

${BANKER_STYLE}

This field is required.
Return a single numeric next-12-month revenue growth estimate.
Use filing evidence such as guidance, backlog, demand commentary, capacity or supply commentary, product cycle, and temporary distortions.
If visibility is imperfect, still return the best conservative numeric estimate.
Do not return null unless the filing truly provides no directional basis at all.
Return strict JSON only. Do not wrap in markdown.
Return only these fields: currentRunwayGrowthPct, rationale, evidence, confidence.
Do not provide a full scenario set.
Do not provide a five-year curve.
${retry ? 'Retry instruction: return JSON only, return one numeric percentage, do not return null unless literally impossible, do not explain first, do not use ranges, and do not output prose outside the schema.' : ''}

Required JSON shape:
{
  "currentRunwayGrowthPct": number | null,
  "rationale": string,
  "evidence": string,
  "confidence": "high" | "medium" | "low"
}

Filing extraction JSON:
${JSON.stringify(filingExtraction, null, 2)}

Deterministic SEC packet:
${JSON.stringify(deterministicPacket, null, 2)}`;
}

export function buildReportFormattingPrompt({ analysisMode = 'operating_company', filingExtraction, filingAnalysis, modelSummary, analysisStatus }) {
  return `You are formatting a filing-grounded analysis pack for a client-ready finance workflow.

${BANKER_STYLE}

The output should read like polished banker or senior-analyst work product.
Analysis mode: ${analysisMode}.
If the mode is operating_company, you may refer to a DCF and exit multiple cross-check.
If the mode is asset_manager, frame the valuation around FRE, distributable earnings, and book/equity anchors.
If the mode is directional_only, label the work as Directional Mode and make clear when the numeric range is intentionally wide or intentionally withheld.
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
