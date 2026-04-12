const BANKER_STYLE = `Style requirements:
- write like a seasoned sell-side analyst or investment banking associate
- concise, sober, analytical, and precise
- do not use hype, startup language, or inflated certainty
- separate reported facts, stated management commentary, inferred implications, and analyst-review items
- if evidence is weak, say so and keep numerical revisions at zero or modest`;

export function buildFilingExtractionPrompt({ filing, supportingMaterials, baseline }) {
  return `You are extracting a filing-grounded base for an external analyst model update.

${BANKER_STYLE}

The latest filing is the factual anchor. Optional supporting materials can add context, but they do not override the filing.

Return strict JSON only. Do not wrap in markdown.
Do not fabricate reported figures. If a figure is not clearly supported, return null.

Required JSON shape:
{
  "filingMetadata": {
    "company": string | null,
    "filingType": "10-Q" | "10-K" | "8-K" | "other" | null,
    "period": string | null,
    "filingDate": string | null,
    "title": string | null
  },
  "reportedBase": {
    "summary": string,
    "normalizedMetrics": {
      "revenueLtm": number | null,
      "grossMarginPct": number | null,
      "operatingMarginPct": number | null,
      "taxRatePct": number | null,
      "capexPctRevenue": number | null,
      "shareCount": number | null,
      "cash": number | null,
      "debt": number | null,
      "netDebt": number | null
    },
    "reportedFacts": [
      {
        "metric": string,
        "valueText": string,
        "category": "revenue" | "margin" | "cash_flow" | "balance_sheet" | "segment" | "risk" | "guidance" | "other",
        "evidence": string,
        "confidence": "high" | "medium" | "low"
      }
    ],
    "segmentNotes": [
      {
        "segment": string,
        "summary": string,
        "evidence": string,
        "confidence": "high" | "medium" | "low"
      }
    ],
    "liquidityAndBalanceSheet": string[],
    "riskFactors": string[]
  },
  "filingTakeaways": [
    {
      "title": string,
      "summary": string,
      "category": "revenue" | "demand" | "pricing" | "volume" | "gross_margin" | "operating_margin" | "opex" | "capex" | "working_capital" | "cash_flow" | "balance_sheet" | "segment" | "risk" | "guidance" | "valuation",
      "evidence": string,
      "classification": "reported" | "inferred",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "evidenceMap": [
    {
      "driver": "revenue" | "demand" | "pricing" | "volume" | "gross_margin" | "operating_margin" | "opex" | "capex" | "working_capital" | "cash_flow" | "balance_sheet" | "segment" | "risk" | "guidance" | "valuation",
      "source": "filing",
      "classification": "reported" | "inferred" | "review_required",
      "summary": string,
      "evidence": string,
      "confidence": "high" | "medium" | "low"
    }
  ],
  "missingBaseInputs": [
    {
      "field": string,
      "reason": string
    }
  ]
}

User baseline assumptions:
${JSON.stringify(baseline, null, 2)}

Filing packet:
${JSON.stringify(filing, null, 2)}

Supporting material packets:
${JSON.stringify(supportingMaterials, null, 2)}`;
}

export function buildTranscriptDeltaPrompt({ filingExtraction, transcript, supportingMaterials }) {
  return `You are comparing management commentary against a filing-grounded base.

${BANKER_STYLE}

Use the filing extraction as the base frame. The transcript is the change-detection and forward-signal layer.

Return strict JSON only. Do not wrap in markdown.
Do not restate the filing unless it matters for what changed or what management emphasized.

Required JSON shape:
{
  "transcriptMetadata": {
    "title": string | null,
    "callDate": string | null,
    "managementTone": {
      "label": "constructive" | "mixed" | "cautious" | "negative" | "neutral",
      "rationale": string
    }
  },
  "callTakeaways": [
    {
      "title": string,
      "summary": string,
      "category": "guidance" | "demand" | "pricing" | "volume" | "gross_margin" | "operating_margin" | "opex" | "capex" | "working_capital" | "cash_flow" | "segment" | "risk" | "valuation",
      "evidence": string,
      "classification": "stated" | "inferred" | "review_required",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "transcriptDelta": {
    "overview": string,
    "changes": [
      {
        "driver": "revenue" | "demand" | "pricing" | "volume" | "gross_margin" | "operating_margin" | "opex" | "capex" | "working_capital" | "cash_flow" | "segment" | "risk" | "guidance" | "valuation",
        "direction": "up" | "down" | "mixed" | "neutral",
        "summary": string,
        "evidence": string,
        "classification": "stated" | "inferred" | "review_required",
        "confidence": "high" | "medium" | "low"
      }
    ]
  },
  "watchItems": [
    {
      "item": string,
      "whyItMatters": string,
      "confidence": "high" | "medium" | "low"
    }
  ]
}

Filing extraction JSON:
${JSON.stringify(filingExtraction, null, 2)}

Transcript packet:
${JSON.stringify(transcript, null, 2)}

Supporting material packets:
${JSON.stringify(supportingMaterials, null, 2)}`;
}

export function buildIntegratedUpdatePrompt({ filingExtraction, transcriptDelta, supportingMaterials, baseline }) {
  return `You are producing a banker-grade model update recommendation pack for an external analyst.

${BANKER_STYLE}

Your job is to merge the filing-grounded base, optional transcript delta, optional supporting materials, and the user's prior baseline view.

Rules:
- return strict JSON only
- do not wrap in markdown
- do not fabricate reported values, consensus figures, or false precision
- preserve zero / no-change adjustments when evidence is weak
- scenario adjustments are meant for deterministic math, not narrative flourish
- language should read like experienced banker / sell-side work product

Required JSON shape:
{
  "changeVsPriorView": {
    "summary": string,
    "bullets": string[]
  },
  "filingGroundedBase": {
    "summary": string,
    "assumptionChecks": [
      {
        "field": string,
        "currentBaseline": string,
        "filingReadThrough": string,
        "status": "reported" | "inferred" | "review_required" | "missing",
        "evidence": string,
        "confidence": "high" | "medium" | "low"
      }
    ]
  },
  "estimateChangeLog": [
    {
      "driver": string,
      "priorView": string,
      "recommendedChange": string,
      "classification": "reported" | "stated" | "inferred" | "review_required",
      "rationale": string,
      "evidence": string,
      "confidence": "high" | "medium" | "low",
      "reviewRequired": true | false
    }
  ],
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
  "valuationImplications": {
    "summary": string,
    "bridgeDrivers": [
      {
        "driver": string,
        "effect": "positive" | "negative" | "mixed" | "neutral",
        "explanation": string,
        "confidence": "high" | "medium" | "low"
      }
    ]
  },
  "reviewFlags": [
    {
      "item": string,
      "reason": string,
      "evidence": string,
      "confidence": "high" | "medium" | "low"
    }
  ],
  "watchItems": [
    {
      "item": string,
      "whyItMatters": string,
      "confidence": "high" | "medium" | "low"
    }
  ],
  "checklist": [
    {
      "task": string,
      "ownerHint": string,
      "priority": "high" | "medium" | "low"
    }
  ]
}

User baseline assumptions:
${JSON.stringify(baseline, null, 2)}

Filing extraction JSON:
${JSON.stringify(filingExtraction, null, 2)}

Transcript delta JSON:
${JSON.stringify(transcriptDelta, null, 2)}

Supporting material packets:
${JSON.stringify(supportingMaterials, null, 2)}`;
}

export function buildReportFormattingPrompt({ filingExtraction, transcriptDelta, integratedUpdate, modelSummary }) {
  return `You are formatting a concise banker-grade model update pack.

${BANKER_STYLE}

Return strict JSON only. Do not wrap in markdown. Keep the output sharp and concise.

Required JSON shape:
{
  "executiveTakeaway": {
    "headline": string,
    "body": string,
    "bullets": string[]
  },
  "keyTakeaways": [
    {
      "title": string,
      "summary": string,
      "source": "filing" | "transcript" | "supporting_material",
      "classification": "reported" | "stated" | "inferred" | "review_required",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "scenarioWriteups": {
    "base": {
      "summary": string,
      "bullets": string[]
    },
    "upside": {
      "summary": string,
      "bullets": string[]
    },
    "downside": {
      "summary": string,
      "bullets": string[]
    }
  },
  "valuationSummary": {
    "summary": string,
    "bridgeCommentary": string
  },
  "whatWouldChangeMyView": string[]
}

Filing extraction JSON:
${JSON.stringify(filingExtraction, null, 2)}

Transcript delta JSON:
${JSON.stringify(transcriptDelta, null, 2)}

Integrated update JSON:
${JSON.stringify(integratedUpdate, null, 2)}

Deterministic model summary:
${JSON.stringify(modelSummary, null, 2)}`;
}
