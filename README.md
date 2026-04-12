# Filing-to-Model Update Workbench

A filing-grounded external analyst workspace for turning the latest 10-Q or 10-K, optional earnings-call commentary, and prior baseline assumptions into a reviewable forecast and valuation update.

## Product framing

This version is **filing-first, not transcript-first**.

The filing is the factual base.
The transcript is the optional but strongly recommended change-detection layer.
The model math remains deterministic and inspectable.

The product is designed to feel like institutional finance work product rather than a generic AI summary tool.

## Workflow

1. add the latest **10-Q or 10-K** (required)
2. add an **earnings transcript** if available (optional, recommended)
3. add **supporting materials** such as the earnings release, deck, or shareholder letter (optional)
4. review or adjust the prior baseline assumptions
5. generate the model update pack

## What the system does

### Filing layer

The backend treats the latest filing as the factual anchor and attempts to extract:

- company, period, filing type, and filing date
- reported revenue and margin context
- capex, liquidity, debt, and share-count references
- segment and risk disclosures
- missing base inputs that still require analyst judgment

### Transcript layer

If a transcript is provided, the backend compares management commentary against the filing-grounded base to identify:

- guidance changes
- demand, pricing, and volume commentary
- margin and opex read-through
- capex, working-capital, and cash-flow signal
- tone, risks, and watch items

### Model update layer

The system then:

- validates the prior baseline against the filing where possible
- proposes conservative estimate changes
- runs deterministic scenario forecast math
- computes DCF-style valuation output, valuation bridge steps, and sensitivities
- packages the output into a banker-style report shell with evidence and review separation

## Stack

- **Frontend:** React + Vite
- **Backend:** Express
- **Model:** Gemini 2.5 Flash Lite via Google Generative Language API
- **Parsing:** server-side text and URL ingestion with HTML normalization via Cheerio
- **Math:** deterministic forecast, DCF, valuation bridge, and sensitivity logic in code

## Run locally

```bash
cd /Users/sy1127/Desktop/OpenClaw-Projects/earnings-to-model-update-agent
cp .env.example .env
# add your Gemini API key to .env
npm install
npm run dev
```

Open:

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:8787/api/health`

## Environment variables

Create a `.env` file:

```bash
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash-lite
PORT=8787
```

`GEMINI_MODEL` is optional. The app defaults to `gemini-2.5-flash-lite`.

## Architecture

### Frontend

The React app is organized as a professional workbench with:

- filing-first source inputs
- optional transcript and supporting-material inputs
- prior baseline assumption editor
- streamed workflow progress
- banker-style report sections
- forecast and valuation tables
- CSV and clipboard export actions
- source appendix for review

### Backend

The Express server handles:

- filing ingestion and normalization
- transcript ingestion and normalization
- supporting-material ingestion
- filing extraction prompt
- transcript delta prompt
- integrated model update prompt
- report-formatting prompt
- deterministic math pass
- SSE stage streaming to the client

## Reasoning split: Gemini vs deterministic math

### Gemini is used for

- filing extraction and factual structuring
- transcript delta detection
- estimate change recommendations
- evidence classification
- scenario rationale and concise banker-style copy
- review flags, watch items, and checklist generation

### Code is used for

- baseline normalization
- selective filing-based baseline backfill where defaults remain in place
- scenario forecast roll-forward
- margin path interpolation
- NOPAT and free cash flow approximation
- DCF-style enterprise value and equity value
- implied value per share
- valuation bridge steps
- sensitivity table generation
- CSV and clipboard export formatting

This keeps judgment in the model layer and keeps the math inspectable and deterministic.

## Core output sections

The app now produces a sharper institutional-style output structure:

1. Executive takeaway
2. Key filing and call takeaways
3. What changed vs prior view
4. Filing-grounded base assumptions
5. Recommended estimate changes
6. Scenario forecast
7. Valuation summary
8. Valuation bridge and key sensitivities
9. Evidence map
10. Review flags and analyst judgment
11. Model update checklist
12. Source appendix

## Implemented

- filing-first workflow and request shape
- required filing input with optional transcript and supporting materials
- filing extraction prompt returning reported base and missing inputs
- transcript delta prompt returning change-detection output when a call is provided
- integrated model update prompt returning estimate changes and scenario adjustments
- report-formatting prompt for sharper executive output
- deterministic prior-view, base, upside, and downside forecast math
- deterministic valuation bridge and sensitivity table
- source appendix and clearer evidence classification
- institutional, restrained UI redesign
- CSV exports for estimate changes, forecast, and valuation summary
- clipboard-friendly takeaway, estimate-change, and forecast blocks

## Intentionally deferred rather than faked

- PDF upload and parsing
- site-specific SEC parsing logic beyond best-effort text extraction
- spreadsheet writeback
- a full three-statement model
- persistence, auth, or saved workspaces

These are omitted rather than mocked.

## Notes

- The app is an external-analyst approximation layer, not a claim of full model completeness.
- The filing is treated as the factual base. The transcript, when provided, mainly affects the forward setup and estimate revisions.
- The product avoids false precision and keeps reported, stated, inferred, and review-required items distinct.
