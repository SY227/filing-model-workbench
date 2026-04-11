import { useEffect, useMemo, useState } from 'react';
import { sampleTranscripts } from './samples';

const workflowTemplate = [
  { key: 'ingest', label: 'Ingesting transcript', note: 'Fetch or clean transcript content', status: 'pending' },
  { key: 'metadata', label: 'Identifying metadata', note: 'Company, quarter, tone, and themes', status: 'pending' },
  { key: 'signals', label: 'Extracting key signals', note: 'Guidance, demand, margin, macro, and risks', status: 'pending' },
  { key: 'mapping', label: 'Mapping modeling drivers', note: 'Assumption deltas, scenarios, and review trail', status: 'pending' },
  { key: 'pack', label: 'Preparing review pack', note: 'Structured output for analyst review', status: 'pending' },
];

const confidenceOrder = { high: 3, medium: 2, low: 1 };

export default function App() {
  const [inputMode, setInputMode] = useState('url');
  const [url, setUrl] = useState('');
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState({ configured: null, model: null });
  const [workflow, setWorkflow] = useState(workflowTemplate);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [lastCompletedStage, setLastCompletedStage] = useState('');
  const [baselineEdits, setBaselineEdits] = useState({});
  const [copyFeedback, setCopyFeedback] = useState('');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setStatus(data))
      .catch(() => setStatus({ configured: false, model: null }));
  }, []);

  useEffect(() => {
    if (!copyFeedback) return undefined;
    const timer = setTimeout(() => setCopyFeedback(''), 1800);
    return () => clearTimeout(timer);
  }, [copyFeedback]);

  const transcriptChars = transcript.trim().length;
  const canSubmit = inputMode === 'url' ? Boolean(url.trim()) : transcriptChars >= 800;

  const summaryStats = useMemo(() => {
    if (!result) return [];
    return [
      {
        label: 'Signals captured',
        value: String(result.keySignals.length),
      },
      {
        label: 'Review flags',
        value: String(result.reviewFlags.length),
      },
      {
        label: 'Checklist items',
        value: String(result.modelUpdateChecklist.length),
      },
      {
        label: 'Transcript size',
        value: `${Math.round(result.source.transcriptChars / 1000)}k chars`,
      },
    ];
  }, [result]);

  async function handleProcess() {
    if (!canSubmit || isProcessing) return;

    setError('');
    setResult(null);
    setBaselineEdits({});
    setLastCompletedStage('');
    setWorkflow(workflowTemplate.map((step, index) => ({
      ...step,
      status: index === 0 ? 'active' : 'pending',
    })));
    setIsProcessing(true);

    try {
      await streamProcess(
        {
          inputMode,
          url: url.trim(),
          transcript,
        },
        {
          onStage: (payload) => {
            setLastCompletedStage(payload.label);
            setWorkflow((current) => {
              const activeIndex = current.findIndex((step) => step.key === payload.key);
              return current.map((step, index) => {
                if (index < activeIndex) return { ...step, status: 'complete' };
                if (step.key === payload.key) return { ...step, note: payload.note || step.note, status: 'active' };
                return { ...step, status: 'pending' };
              });
            });
          },
          onResult: (payload) => {
            setResult(payload);
            setBaselineEdits(
              Object.fromEntries((payload.assumptionDeltaLog || []).map((row, index) => [String(index), row.analystBaselineField || '']))
            );
            setWorkflow((current) => current.map((step) => ({ ...step, status: 'complete' })));
          },
          onError: (payload) => {
            setError(payload.message || 'Processing failed.');
            setWorkflow((current) => current.map((step) => ({ ...step, status: step.status === 'active' ? 'pending' : step.status })));
          },
        }
      );
    } catch (streamError) {
      setError(streamError.message || 'Processing failed.');
    } finally {
      setIsProcessing(false);
    }
  }

  function handleReset() {
    setUrl('');
    setTranscript('');
    setError('');
    setResult(null);
    setBaselineEdits({});
    setWorkflow(workflowTemplate);
    setLastCompletedStage('');
  }

  function loadSample(sample) {
    setInputMode('text');
    setTranscript(sample.transcript);
    setError('');
    setResult(null);
  }

  async function handleCopy(kind) {
    if (!result) return;
    const text = buildCopyBlock(kind, result, baselineEdits);
    await navigator.clipboard.writeText(text);
    setCopyFeedback(kind === 'full' ? 'Full report copied' : kind === 'delta' ? 'Delta log copied' : 'Executive summary copied');
  }

  return (
    <div className="app-shell">
      <div className="page-gradient" />
      <main className="page">
        <section className="hero card glass">
          <div>
            <div className="eyebrow">Investor-grade transcript workflow</div>
            <h1>Earnings-to-Model Update Agent</h1>
            <p className="hero-copy">
              Turn an earnings transcript into a structured, reviewable model-update pack with explicit evidence,
              inference boundaries, and scenario-ready outputs.
            </p>
          </div>
          <div className="hero-meta">
            <StatusPill configured={status.configured} model={status.model} />
            <div className="hero-stats">
              <StatTile label="Workflow" value="Ingest → Extract → Map → Review" />
              <StatTile label="Designed for" value="Investors, corp dev, strategy" />
            </div>
          </div>
        </section>

        <section className="workspace-grid">
          <div className="left-column">
            <section className="card input-card">
              <div className="section-header">
                <div>
                  <div className="section-kicker">Input</div>
                  <h2>Choose a transcript path</h2>
                </div>
                <button className="ghost-button" onClick={handleReset} disabled={isProcessing}>
                  Clear
                </button>
              </div>

              <div className="mode-switch" role="tablist" aria-label="Input mode">
                <button
                  className={inputMode === 'url' ? 'mode-button active' : 'mode-button'}
                  onClick={() => setInputMode('url')}
                >
                  Paste transcript URL
                </button>
                <button
                  className={inputMode === 'text' ? 'mode-button active' : 'mode-button'}
                  onClick={() => setInputMode('text')}
                >
                  Paste transcript text
                </button>
              </div>

              {inputMode === 'url' ? (
                <div className="input-block">
                  <label htmlFor="transcript-url">Transcript URL</label>
                  <input
                    id="transcript-url"
                    className="text-input"
                    type="url"
                    placeholder="https://www.example.com/earnings-transcript"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                  <p className="input-help">
                    Best effort transcript fetching is handled server-side. If the page is hard to parse, the app will tell you and point you to paste-text mode.
                  </p>
                </div>
              ) : (
                <div className="input-block">
                  <div className="label-row">
                    <label htmlFor="transcript-text">Transcript text</label>
                    <span>{transcriptChars.toLocaleString()} chars</span>
                  </div>
                  <textarea
                    id="transcript-text"
                    className="transcript-input"
                    placeholder="Paste the earnings transcript here"
                    value={transcript}
                    onChange={(event) => setTranscript(event.target.value)}
                  />
                  <p className="input-help">
                    Keep speaker changes and management commentary intact when possible. The workflow uses the cleaned transcript as the grounding document for every downstream step.
                  </p>
                </div>
              )}

              <div className="samples-row">
                <div className="samples-label">Built-in demo examples</div>
                <div className="sample-chips">
                  {sampleTranscripts.map((sample) => (
                    <button key={sample.id} className="sample-chip" onClick={() => loadSample(sample)} disabled={isProcessing}>
                      <strong>{sample.label}</strong>
                      <span>{sample.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="action-row">
                <button className="primary-button" onClick={handleProcess} disabled={!canSubmit || isProcessing}>
                  {isProcessing ? 'Processing…' : 'Generate model update pack'}
                </button>
                <div className="inline-guidance">
                  {inputMode === 'text' ? 'Aim for at least 800 characters of transcript.' : 'Transcript page fetches run through the local backend.'}
                </div>
              </div>

              {error ? <div className="error-banner">{error}</div> : null}
            </section>

            <section className="card workflow-card">
              <div className="section-header compact">
                <div>
                  <div className="section-kicker">Workflow</div>
                  <h2>Agentic processing trail</h2>
                </div>
                {isProcessing ? <span className="live-pill">Live</span> : null}
              </div>
              <div className="workflow-list">
                {workflow.map((step) => (
                  <div key={step.key} className={`workflow-step ${step.status}`}>
                    <div className="workflow-indicator" />
                    <div>
                      <div className="workflow-label">{step.label}</div>
                      <div className="workflow-note">{step.note}</div>
                    </div>
                    <div className="workflow-status">{renderStatusLabel(step.status)}</div>
                  </div>
                ))}
              </div>
              <div className="workflow-footer">
                {isProcessing ? `Current step: ${lastCompletedStage || 'Starting'}` : result ? 'Workflow complete' : 'Ready for input'}
              </div>
            </section>
          </div>

          <div className="right-column">
            {!result ? (
              <section className="card empty-state">
                <div className="section-kicker">Output</div>
                <h2>Review pack appears here</h2>
                <p>
                  The result view separates explicit management statements from inferred modeling implications,
                  keeps confidence visible, and turns transcript evidence into analyst-ready output blocks.
                </p>
              </section>
            ) : (
              <>
                <section className="card report-hero">
                  <div className="report-hero-top">
                    <div>
                      <div className="section-kicker">Output pack</div>
                      <h2>{result.metadata.title || 'Transcript analysis'}</h2>
                    </div>
                    <div className="action-cluster">
                      <button className="secondary-button" onClick={() => handleCopy('summary')}>Copy executive summary</button>
                      <button className="secondary-button" onClick={() => handleCopy('delta')}>Copy delta log</button>
                      <button className="secondary-button" onClick={() => handleCopy('full')}>Copy full output</button>
                      <button className="secondary-button" onClick={() => window.print()}>Export report</button>
                    </div>
                  </div>

                  <div className="report-header-grid">
                    <MetaPill label="Company" value={result.metadata.company || 'Needs review'} />
                    <MetaPill label="Period" value={result.metadata.quarter || 'Needs review'} />
                    <MetaPill label="Call date" value={result.metadata.callDate || 'Needs review'} />
                    <MetaPill label="Tone" value={result.metadata.managementTone?.label || 'neutral'} />
                  </div>

                  <div className="summary-stats-grid">
                    {summaryStats.map((item) => (
                      <StatTile key={item.label} label={item.label} value={item.value} />
                    ))}
                  </div>

                  <div className="themes-row">
                    {(result.metadata.majorThemes || []).map((theme) => (
                      <span key={theme} className="theme-chip">{theme}</span>
                    ))}
                  </div>

                  {copyFeedback ? <div className="copy-feedback">{copyFeedback}</div> : null}
                </section>

                <SectionCard title="Executive Summary" kicker="1" defaultOpen>
                  <div className="executive-headline">{result.executiveSummary?.headline}</div>
                  <p className="executive-body">{result.executiveSummary?.body}</p>
                  <ul className="bullet-list">
                    {(result.executiveSummary?.bullets || []).map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                </SectionCard>

                <SectionCard title="Key Earnings Signals" kicker="2" defaultOpen>
                  <div className="signal-grid">
                    {sortByConfidence(result.keySignals).map((signal, index) => (
                      <article key={`${signal.title}-${index}`} className="signal-card">
                        <div className="signal-card-top">
                          <span className="category-pill">{prettyCategory(signal.category)}</span>
                          <ConfidencePill confidence={signal.confidence} />
                        </div>
                        <h3>{signal.title}</h3>
                        <p>{signal.summary}</p>
                        <div className="source-block">{signal.evidence}</div>
                        <div className="signal-footer">
                          <span>{signal.explicitness === 'explicit' ? 'Explicit management statement' : 'Inferred implication'}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Assumption Delta Log" kicker="3" defaultOpen>
                  <div className="table-wrap">
                    <table className="delta-table">
                      <thead>
                        <tr>
                          <th>Modeling driver</th>
                          <th>Analyst baseline</th>
                          <th>Proposed update</th>
                          <th>Rationale</th>
                          <th>Source support</th>
                          <th>Confidence</th>
                          <th>Review</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(result.assumptionDeltaLog || []).map((row, index) => (
                          <tr key={`${row.driver}-${index}`}>
                            <td className="strong-cell">{row.driver}</td>
                            <td>
                              <textarea
                                className="baseline-input"
                                value={baselineEdits[String(index)] || ''}
                                onChange={(event) => setBaselineEdits((current) => ({ ...current, [String(index)]: event.target.value }))}
                              />
                            </td>
                            <td>{row.proposedUpdate}</td>
                            <td>{row.rationale}</td>
                            <td>{row.sourceSupport}</td>
                            <td><ConfidencePill confidence={row.confidence} /></td>
                            <td>{row.reviewRequired ? <span className="flag-chip">Review required</span> : <span className="ok-chip">Low friction</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>

                <SectionCard title="Base / Upside / Downside View" kicker="4" defaultOpen>
                  <div className="scenario-grid">
                    {['base', 'upside', 'downside'].map((caseKey) => (
                      <article key={caseKey} className={`scenario-card ${caseKey}`}>
                        <div className="scenario-label">{caseKey}</div>
                        <h3>{result.scenarios?.[caseKey]?.summary}</h3>
                        <ul className="bullet-list compact">
                          {(result.scenarios?.[caseKey]?.points || []).map((point) => (
                            <li key={point}>{point}</li>
                          ))}
                        </ul>
                      </article>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Explicit vs Inferred" kicker="5">
                  <div className="two-column-grid">
                    <div className="split-panel">
                      <div className="split-header">Explicit management statements</div>
                      <div className="stack-list">
                        {(result.explicitStatements || []).map((item, index) => (
                          <div key={`${item.statement}-${index}`} className="stack-item">
                            <div className="stack-text">{item.statement}</div>
                            <div className="source-block">{item.evidence}</div>
                            <ConfidencePill confidence={item.confidence} />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="split-panel">
                      <div className="split-header">Inferred implications</div>
                      <div className="stack-list">
                        {(result.inferredImplications || []).map((item, index) => (
                          <div key={`${item.implication}-${index}`} className="stack-item">
                            <div className="stack-text">{item.implication}</div>
                            <div className="stack-support">{item.whyItMatters}</div>
                            <div className="source-block">{item.evidence}</div>
                            <ConfidencePill confidence={item.confidence} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="Review Required Flags" kicker="6">
                  <div className="flag-list">
                    {(result.reviewFlags || []).map((flag, index) => (
                      <div key={`${flag.item}-${index}`} className="flag-row">
                        <div>
                          <h3>{flag.item}</h3>
                          <p>{flag.reason}</p>
                          <div className="source-block">{flag.evidence}</div>
                        </div>
                        <ConfidencePill confidence={flag.confidence} />
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Model Update Checklist" kicker="7">
                  <div className="checklist-grid">
                    {(result.modelUpdateChecklist || []).map((item, index) => (
                      <div key={`${item.task}-${index}`} className="check-card">
                        <div className="check-top">
                          <span className="check-bullet">{index + 1}</span>
                          <PriorityPill priority={item.priority} />
                        </div>
                        <h3>{item.task}</h3>
                        <p>{item.ownerHint}</p>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Review Trail" kicker="8">
                  <div className="trail-list">
                    {(result.reviewTrail || []).map((item, index) => (
                      <div key={`${item.item}-${index}`} className="trail-row">
                        <div>
                          <div className="trail-item">{item.item}</div>
                          <div className="trail-reason">{item.whyReview}</div>
                        </div>
                        <div className="trail-meta">
                          <span className="category-pill">{item.classification}</span>
                          <ConfidencePill confidence={item.confidence} />
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <details className="card transcript-card">
                  <summary>
                    <div>
                      <div className="section-kicker">Source review</div>
                      <h2>Extracted transcript</h2>
                    </div>
                    <span className="summary-hint">Open</span>
                  </summary>
                  <div className="transcript-preview">{result.source.transcriptFull}</div>
                </details>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function SectionCard({ title, kicker, children, defaultOpen = false }) {
  return (
    <details className="card section-card" open={defaultOpen}>
      <summary>
        <div>
          <div className="section-kicker">{kicker}</div>
          <h2>{title}</h2>
        </div>
        <span className="summary-hint">Open</span>
      </summary>
      <div>{children}</div>
    </details>
  );
}

function StatusPill({ configured, model }) {
  const label = configured ? 'Gemini ready' : configured === false ? 'Set GEMINI_API_KEY' : 'Checking config';
  return (
    <div className={`status-pill ${configured ? 'ready' : configured === false ? 'warning' : ''}`}>
      <span>{label}</span>
      {model ? <strong>{model}</strong> : null}
    </div>
  );
}

function ConfidencePill({ confidence = 'medium' }) {
  return <span className={`confidence-pill ${confidence}`}>{confidence}</span>;
}

function PriorityPill({ priority = 'medium' }) {
  return <span className={`priority-pill ${priority}`}>{priority} priority</span>;
}

function MetaPill({ label, value }) {
  return (
    <div className="meta-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatTile({ label, value }) {
  return (
    <div className="stat-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function prettyCategory(category = 'other') {
  return category.replace(/_/g, ' ');
}

function renderStatusLabel(status) {
  if (status === 'complete') return 'Done';
  if (status === 'active') return 'Running';
  return 'Queued';
}

function sortByConfidence(items) {
  return [...(items || [])].sort((a, b) => (confidenceOrder[b.confidence] || 0) - (confidenceOrder[a.confidence] || 0));
}

function buildCopyBlock(kind, result, baselineEdits) {
  const executive = [
    result.executiveSummary?.headline,
    result.executiveSummary?.body,
    ...(result.executiveSummary?.bullets || []).map((bullet) => `• ${bullet}`),
  ].filter(Boolean).join('\n');

  const deltaLog = (result.assumptionDeltaLog || [])
    .map((row, index) => [
      `${index + 1}. ${row.driver}`,
      `Baseline: ${baselineEdits[String(index)] || '—'}`,
      `Proposed update: ${row.proposedUpdate}`,
      `Rationale: ${row.rationale}`,
      `Source support: ${row.sourceSupport}`,
      `Confidence: ${row.confidence}`,
      `Review required: ${row.reviewRequired ? 'Yes' : 'No'}`,
    ].join('\n'))
    .join('\n\n');

  if (kind === 'summary') return executive;
  if (kind === 'delta') return deltaLog;

  const scenarios = ['base', 'upside', 'downside']
    .map((caseKey) => {
      const view = result.scenarios?.[caseKey];
      return [
        caseKey.toUpperCase(),
        view?.summary,
        ...(view?.points || []).map((point) => `• ${point}`),
      ].filter(Boolean).join('\n');
    })
    .join('\n\n');

  const explicit = (result.explicitStatements || []).map((item) => `• ${item.statement} (${item.confidence})`).join('\n');
  const inferred = (result.inferredImplications || []).map((item) => `• ${item.implication} (${item.confidence})`).join('\n');
  const flags = (result.reviewFlags || []).map((item) => `• ${item.item}: ${item.reason}`).join('\n');
  const checklist = (result.modelUpdateChecklist || []).map((item) => `• ${item.task} [${item.priority}]`).join('\n');

  return [
    `${result.metadata.title || 'Transcript analysis'}`,
    executive,
    'ASSUMPTION DELTA LOG',
    deltaLog,
    'SCENARIOS',
    scenarios,
    'EXPLICIT MANAGEMENT STATEMENTS',
    explicit,
    'INFERRED IMPLICATIONS',
    inferred,
    'REVIEW FLAGS',
    flags,
    'MODEL UPDATE CHECKLIST',
    checklist,
  ].filter(Boolean).join('\n\n');
}

async function streamProcess(payload, handlers) {
  const response = await fetch('/api/process', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    throw new Error('Could not start the processing workflow.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';

    chunks.forEach((chunk) => {
      const lines = chunk.split('\n');
      const eventLine = lines.find((line) => line.startsWith('event:'));
      const dataLine = lines.find((line) => line.startsWith('data:'));
      if (!eventLine || !dataLine) return;
      const event = eventLine.replace('event:', '').trim();
      const payloadText = dataLine.replace('data:', '').trim();
      const data = JSON.parse(payloadText);

      if (event === 'stage') handlers.onStage?.(data);
      if (event === 'result') handlers.onResult?.(data);
      if (event === 'error') handlers.onError?.(data);
    });
  }
}
