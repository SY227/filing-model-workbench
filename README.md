# Earnings-to-Model Update Agent

A polished local prototype for turning an earnings transcript into a structured, reviewable model-update workflow.

## What it does

The app supports exactly two input paths:

1. paste a transcript URL, or
2. paste transcript text directly.

It then runs a multi-step workflow:

- ingest and clean the transcript
- identify metadata, tone, and major themes
- extract key financial signals
- map findings to modeling drivers
- generate base, upside, and downside implications
- produce a reviewable output pack with explicit vs inferred separation

## Stack

- **Frontend:** React + Vite
- **Backend:** Express
- **Model:** Gemini 2.5 Flash Lite via Google Generative Language API
- **Parsing:** server-side HTML fetching + text extraction with Cheerio

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

## Architecture

### Frontend

The React app is a desktop-first, report-style interface with:

- premium landing and input area
- two-path ingestion UI
- visible workflow progress rail
- collapsible results sections
- editable analyst baseline cells in the delta log
- copy and print/export actions

### Backend

The Express server handles:

- transcript URL fetching
- HTML cleanup and transcript extraction
- pasted transcript normalization
- two-step Gemini workflow
- streaming stage updates to the UI over SSE

## Agentic workflow structure

This is intentionally not a single blob completion.

### Pass 1: Extraction

Gemini receives the cleaned transcript and returns structured JSON for:

- metadata
- tone and themes
- key signals
- explicit statements
- inferred implications
- review flags

### Pass 2: Synthesis

Gemini receives the extraction JSON plus transcript context and returns structured JSON for:

- executive summary
- assumption delta log
- scenario views
- model update checklist
- review trail

The UI renders these into a finance-oriented report pack.

## Implemented

- working URL ingestion with graceful failure path
- working pasted-text ingestion
- transcript cleaning and normalization
- structured Gemini JSON workflow
- confidence labels and explicit vs inferred separation
- assumption delta log with analyst-editable baseline fields
- scenario section
- review flags and checklist
- copy actions and print-friendly export
- built-in example transcripts for demo convenience

## Simplified

- URL parsing is heuristic, not site-specific
- no authentication or persistence layer
- no PDF export service, print/export uses browser print
- no spreadsheet integration or direct model writeback
- no transcript chunk orchestration for extremely long calls beyond simple truncation

## Notes

- The app is designed to avoid false precision. It asks the model for directional updates unless exact figures are explicitly supported by the transcript.
- If transcript extraction from a URL fails, the app tells the user to use the paste-text path instead of silently breaking.
