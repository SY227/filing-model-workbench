# Filing Model Workbench

A filing-grounded finance workspace for loading a single public-company 10-Q or 10-K and generating a premium model-first analysis pack.

## Product framing

This v1 release is intentionally narrow.

It focuses on one filing, not a transcript workflow.
The filing is the factual anchor.
The output is designed to feel like disciplined banker or senior-analyst work product, with model and valuation outputs leading the experience rather than sitting behind narrative sections.

## v1 workflow

1. load a **10-Q or 10-K** by URL or pasted text
2. let Gemini extract the filing and draft the normalized model inputs
3. generate a model-first filing-grounded analysis pack
4. optionally review the supporting filing snapshot and appendix detail

## What the system produces

The final pack is organized in a model-first hierarchy:

1. Company and filing context strip
2. Model headline summary
3. Scenario overview
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

### Filing ingestion

The backend:

- fetches and normalizes filing text from a URL, or accepts pasted text directly
- identifies filing metadata where possible
- extracts a reported base and disclosure-driven takeaways
- drafts a complete normalized model baseline directly from the filing
- classifies drafted fields as reported, derived, proposed, or review required
- runs deterministic forecast and DCF-style valuation math in code
- formats a final analysis pack for review and export

### Deterministic math remains code-driven

Gemini is used for structured extraction, baseline drafting, and writing quality.
The forecast, scenario roll-forward, DCF, valuation bridge, and sensitivity matrix remain deterministic and inspectable in code.

That split is deliberate.
The product should not pretend the filing alone creates fully precise model output.

## Stack

- **Frontend:** React + Vite
- **Backend:** Express
- **Model:** Gemini 2.5 Flash Lite via Google Generative Language API
- **Parsing:** filing text / URL normalization with Cheerio
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
```

`GEMINI_MODEL` is optional.

## Real SEC example cases included

The sample buttons load real public SEC filings:

- **Apple** 10-Q filed January 30, 2026
- **Microsoft** 10-Q filed January 28, 2026
- **NVIDIA** 10-K filed February 25, 2026

These are loaded by URL from SEC EDGAR rather than fabricated example content.

## File structure

- `src/App.jsx` — filing-only interface, model-first report hierarchy, premium metric-led shell, export actions
- `src/assumptions.js` — shared drafted-baseline field metadata and formatting helpers
- `src/samples.js` — real SEC public example filings
- `src/styles.css` — premium navy / gold / neutral presentation system and table styling
- `server/index.js` — review endpoint, SSE processing pipeline, drafted-baseline assembly, result payload
- `server/promptSchemas.js` — filing extraction, drafted-baseline, and report-formatting prompts
- `server/sourceNormalization.js` — filing URL/text ingestion and normalization
- `server/modeling.js` — deterministic scenario, valuation bridge, and sensitivity logic
- `server/schemas.js` — strict JSON schemas and defaults for Gemini response normalization

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
