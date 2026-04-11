# Earnings-to-Model Update Agent

A local prototype for outside analysts who want to go from an earnings transcript plus baseline assumptions to a transcript-backed forecast and valuation update.

## What changed in this version

The app is no longer centered on transcript commentary.

It now works as an **external analyst modeling workflow**:

1. ingest a transcript from URL or pasted text
2. enter baseline operating and valuation assumptions
3. let Gemini propose structured scenario revisions
4. run deterministic forecast and DCF math in code
5. export model-ready tables and a reviewable report pack

## Core product flow

### Step 1: Transcript input

- paste transcript URL, or
- paste transcript text directly

### Step 2: Baseline analyst model input

The app includes a structured baseline panel for:

- LTM revenue
- FY+1 to FY+5 revenue growth
- gross margin start and FY+5 target
- operating margin start and FY+5 target
- tax rate
- capex % of revenue
- D&A % of revenue
- working capital % of revenue
- WACC
- terminal growth
- share count
- net debt / cash
- exit EBITDA multiple

### Step 3: Agentic workflow

Visible workflow stages:

- ingesting transcript
- extracting management guidance and signals
- mapping transcript evidence to model drivers
- revising assumptions
- building base / upside / downside forecast
- running valuation view
- preparing model update pack

### Step 4: Outputs

The main outputs are now model-oriented:

- executive model summary
- assumption change log
- deterministic forecast table
- DCF-style valuation view
- scenario comparison
- transcript evidence and model driver mapping
- review flags
- exportable CSV and Excel-friendly copy blocks

## Stack

- **Frontend:** React + Vite
- **Backend:** Express
- **Model:** Gemini 2.5 Flash Lite via Google Generative Language API
- **Parsing:** server-side HTML fetching + text extraction with Cheerio
- **Model math:** deterministic forecast + DCF logic in code

## Run locally

```bash
cd ~/Desktop/OpenClaw-Projects/earnings-to-model-update-agent
cp .env.example .env
# add your Gemini API key to .env
npm install
npm run dev
```

Then open:

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

## Revised architecture

### Frontend

The React app now behaves like a modeling workspace, not a transcript summary screen.

It includes:

- transcript ingestion UI
- structured analyst baseline assumptions panel
- multi-step progress rail
- forecast and valuation tables
- scenario selector
- CSV download actions
- Excel-friendly copy actions
- transcript evidence and review sections

### Backend

The Express server handles:

- transcript fetching and cleanup
- transcript normalization
- Gemini extraction pass
- Gemini model-revision pass
- deterministic forecast and DCF calculations
- SSE streaming stage updates back to the client

## Gemini reasoning vs deterministic math

This split is the core of the product.

### Gemini is used for

- extracting transcript metadata and themes
- identifying guidance and model-relevant signals
- mapping transcript evidence to modeling drivers
- proposing conservative scenario revisions
- generating the executive model summary and review trail

### Code is used for

- baseline normalization
- multi-year forecast roll-forward
- gross margin and operating margin path construction
- NOPAT and free cash flow approximation
- DCF-style enterprise value and equity value math
- implied value per share
- scenario comparison tables
- sensitivity table generation
- CSV export formatting

This keeps judgment and language in the model layer, while keeping the actual math deterministic and inspectable.

## Deterministic model math implemented

The current deterministic layer includes:

- revenue roll-forward from baseline + scenario growth deltas
- gross margin and operating margin paths across FY+1 to FY+5
- operating income, EBITDA, tax, NOPAT
- capex, D&A, working capital impact
- free cash flow
- DCF-style enterprise value
- equity value and value per share
- base-case EV sensitivity matrix

## Implemented

- working transcript URL ingestion with graceful failure
- working pasted transcript ingestion
- structured baseline assumptions panel
- transcript-to-driver mapping
- Gemini-driven scenario adjustment proposals
- deterministic base / upside / downside forecast math
- deterministic DCF-style valuation output
- valuation comparison across scenarios
- CSV downloads for forecast, assumptions, and valuation
- copy-ready forecast and valuation tables for Excel
- transcript evidence section with explicit vs inferred separation
- review flags and model update checklist
- harmony-green visual refresh

## Simplified

- URL parsing is heuristic rather than site-specific
- no persistence or user accounts
- no direct spreadsheet writeback
- no fully general three-statement model
- DCF uses a practical external-analyst approximation layer instead of company-specific detailed line items
- very long transcripts are truncated before model submission rather than chunk-orchestrated

## Notes

- The product is conservative by design. It avoids false precision and treats transcript language as evidence, not certainty.
- The app is designed for outside analysts. It does not assume internal company planning access.
- If transcript extraction from a URL fails, the app tells the user to use the paste-text path instead of silently breaking.
