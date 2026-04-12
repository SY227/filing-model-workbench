# Filing Model Workbench

A filing-grounded finance workspace for generating a premium model-first analysis pack from a deterministically retrieved SEC filing.

## Default UX

The default workflow is now ticker-first:

1. enter a ticker
2. choose **10-Q** or **10-K**
3. if you choose **10-Q**, select **Q1**, **Q2**, or **Q3**
4. optionally enter a year
5. let the system retrieve the matching SEC filing and generate the analysis pack

If year is omitted, the latest matching filing is used.
If quarter is selected for a 10-Q, the backend attempts a deterministic quarter match instead of silently picking the wrong filing.

Advanced manual input still exists when needed:

- filing URL
- pasted filing text

## Product framing

This release stays intentionally narrow and filing-first.

It does not start from a transcript workflow.
It starts from a public SEC filing, treats the filing as the factual anchor, and produces a model-first valuation pack designed to feel like disciplined institutional finance work product.

## Retrieval model

SEC retrieval is:

- backend-only
- deterministic
- SEC-based
- paced to avoid excessive requests
- lightly cached to avoid unnecessary repeated fetches

The app does not rely on browser-style SEC navigation logic.

## What the system produces

The final pack is organized in a model-first hierarchy:

1. Company and filing context strip
2. Model headline summary
3. Scenario overview with model outputs first and narrative below
4. Valuation frame
5. Base-case enterprise value sensitivity
6. Valuation bridge and key deltas
7. AI-drafted model assumptions
8. Executive summary
9. Business overview from filing
10. Key filing takeaways
11. What matters for the model
12. Key sensitivities
13. Key risks and watch items
14. Review flags / checklist / source appendix

## What the backend does

The backend:

- resolves ticker to CIK from SEC data
- retrieves company submissions from SEC data
- selects the latest matching 10-Q or 10-K, optionally constrained to a calendar year
- adds quarter-aware 10-Q selection using filing metadata and fiscal-period inference
- fetches and normalizes filing text from SEC, or accepts manual URL / pasted text in advanced mode
- identifies filing metadata where possible
- extracts a reported base and disclosure-driven takeaways
- drafts a complete normalized model baseline directly from the filing
- classifies drafted fields as reported, derived, proposed, or review required
- runs deterministic forecast and DCF-style valuation math in code
- formats a final analysis pack for review and export

## Deterministic math remains code-driven

Gemini is used for structured extraction, baseline drafting, and writing quality.
The forecast, scenario roll-forward, DCF, valuation bridge, and sensitivity matrix remain deterministic and inspectable in code.

That split is deliberate.
The product should not pretend the filing alone creates fully precise model output.

## Stack

- **Frontend:** React + Vite
- **Backend:** Express
- **Model:** Gemini 2.5 Flash Lite via Google Generative Language API
- **Parsing:** filing text / URL normalization with Cheerio
- **Retrieval:** deterministic SEC lookup and filing resolution on the backend
- **Math:** deterministic forecast, DCF, valuation bridge, and sensitivity logic in code

## Run locally

```bash
cd /Users/sy1127/Desktop/OpenClaw-Projects/earnings-to-model-update-agent
npm install
npm run dev
```

Open:

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:8787/api/health`

## Environment variables

```bash
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash-lite
PORT=8787
SEC_USER_AGENT="Filing Model Workbench/1.0 your-email@example.com"
```

`GEMINI_MODEL` is optional.
`SEC_USER_AGENT` is recommended for production-style SEC access.

## Real SEC example cases included

The sample buttons load real public SEC filings:

- **Apple** 10-Q filed January 30, 2026
- **Microsoft** 10-Q filed January 28, 2026
- **NVIDIA** 10-K filed February 25, 2026

These examples still use direct public SEC filing URLs.

## File structure

- `src/App.jsx` — ticker-first intake, quarter-aware 10-Q selection, model-first report hierarchy, review/generate flows, export actions
- `src/assumptions.js` — shared drafted-baseline field metadata and formatting helpers
- `src/samples.js` — real SEC public example filings
- `src/styles.css` — premium light-theme finance presentation system with harmony-blue accents
- `server/index.js` — review endpoint, SSE processing pipeline, drafted-baseline assembly, result payload
- `server/secLookup.js` — deterministic SEC ticker lookup, submissions retrieval, quarter-aware filing selection, request pacing
- `server/sourceNormalization.js` — filing request normalization, SEC/manual ingestion, document normalization
- `server/promptSchemas.js` — filing extraction, drafted-baseline, and report-formatting prompts
- `server/modeling.js` — deterministic scenario, valuation bridge, and sensitivity logic
- `server/schemas.js` — strict JSON schemas and defaults for Gemini response normalization

## Error handling

The app now returns clear user-facing messages for cases like:

- unknown ticker
- invalid year format
- no matching 10-Q / 10-K for a selected year
- no confident quarter match for a selected 10-Q
- SEC fetch failure
- SEC response missing expected fields
- filing normalization failure

## Intentionally deferred rather than faked

- PDF upload / parsing
- transcript workflow
- supporting-material ingestion in the main v1 path
- spreadsheet writeback
- persistence / auth / saved workspaces
- full three-statement modeling

Those features are omitted on purpose rather than mocked.

## Notes on interpretation

- This is an external-analyst approximation layer, not a claim of full model completeness.
- The filing is treated as the factual base.
- Reported facts, derived implications, proposed assumptions, and review-required items remain visibly distinct.
- Where the filing does not support precision, the tool is designed to stay measured rather than over-claim certainty.
- Some model inputs will still rely on conservative fallbacks when the filing does not support direct extraction.
