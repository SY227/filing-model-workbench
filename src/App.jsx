import { useEffect, useMemo, useState } from 'react';
import { baselineGroups, defaultBaseline, horizonLabels } from './assumptions';
import { sampleTranscripts } from './samples';

const workflowTemplate = [
  { key: 'ingest', label: 'Ingesting transcript', note: 'Fetch or normalize transcript text', status: 'pending' },
  { key: 'signals', label: 'Extracting management guidance and signals', note: 'Pull transcript-backed evidence and themes', status: 'pending' },
  { key: 'drivers', label: 'Mapping transcript evidence to model drivers', note: 'Connect guidance to revenue, margin, cash flow, and valuation inputs', status: 'pending' },
  { key: 'revise', label: 'Revising assumptions', note: 'Generate conservative transcript-backed scenario revisions', status: 'pending' },
  { key: 'forecast', label: 'Building base / upside / downside forecast', note: 'Run deterministic operating forecast math', status: 'pending' },
  { key: 'valuation', label: 'Running valuation view', note: 'Compute DCF-style enterprise value, equity value, and per-share output', status: 'pending' },
  { key: 'pack', label: 'Preparing model update pack', note: 'Assemble exportable tables, rationale, and review flags', status: 'pending' },
];

const confidenceOrder = { high: 3, medium: 2, low: 1 };
const scenarioKeys = ['base', 'upside', 'downside'];

export default function App() {
  const [inputMode, setInputMode] = useState('url');
  const [url, setUrl] = useState('');
  const [transcript, setTranscript] = useState('');
  const [baseline, setBaseline] = useState(defaultBaseline);
  const [status, setStatus] = useState({ configured: null, model: null });
  const [workflow, setWorkflow] = useState(workflowTemplate);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [lastCompletedStage, setLastCompletedStage] = useState('');
  const [copyFeedback, setCopyFeedback] = useState('');
  const [selectedScenario, setSelectedScenario] = useState('base');

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

  useEffect(() => {
    if (result) setSelectedScenario('base');
  }, [result]);

  const transcriptChars = transcript.trim().length;
  const canSubmit = (inputMode === 'url' ? Boolean(url.trim()) : transcriptChars >= 800) && Number(baseline.currentRevenue) > 0;

  const summaryStats = useMemo(() => {
    if (!result) return [];
    const unit = result.baseline.unitLabel;
    const baseValuation = result.modelPack.scenarios.base.valuation;
    const baseForecast = result.modelPack.scenarios.base.forecastTable;
    return [
      { label: 'Base value / share', value: formatPerShare(baseValuation.valuePerShare, unit) },
      { label: 'Base enterprise value', value: formatNumber(baseValuation.enterpriseValue, unit) },
      {
        label: 'Valuation range',
        value: `${formatPerShare(result.modelPack.valuationSummary.range.low, unit)} to ${formatPerShare(result.modelPack.valuationSummary.range.high, unit)}`,
      },
      { label: 'FY+1 revenue growth', value: formatPercent(baseForecast[0]?.revenueGrowth) },
    ];
  }, [result]);

  const selectedScenarioModel = result ? result.modelPack.scenarios[selectedScenario] : null;

  async function handleProcess() {
    if (!canSubmit || isProcessing) return;

    setError('');
    setResult(null);
    setLastCompletedStage('');
    setWorkflow(
      workflowTemplate.map((step, index) => ({
        ...step,
        status: index === 0 ? 'active' : 'pending',
      }))
    );
    setIsProcessing(true);

    try {
      await streamProcess(
        {
          inputMode,
          url: url.trim(),
          transcript,
          baseline,
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
    setBaseline(defaultBaseline);
    setError('');
    setResult(null);
    setWorkflow(workflowTemplate);
    setLastCompletedStage('');
    setSelectedScenario('base');
  }

  function handleBaselineChange(key, value) {
    setBaseline((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function handleRevenueGrowthChange(index, value) {
    setBaseline((current) => ({
      ...current,
      revenueGrowth: current.revenueGrowth.map((item, itemIndex) => (itemIndex === index ? value : item)),
    }));
  }

  function loadSample(sample) {
    setInputMode('text');
    setTranscript(sample.transcript);
    setBaseline(sample.baseline);
    setError('');
    setResult(null);
  }

  async function handleCopy(kind) {
    if (!result) return;
    const text = buildCopyPayload(kind, result);
    await navigator.clipboard.writeText(text);
    setCopyFeedback(copyLabel(kind));
  }

  function handleDownload(kind) {
    if (!result) return;
    const { filename, content } = buildCsvPayload(kind, result);
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    setCopyFeedback(downloadLabel(kind));
  }

  return (
    <div className="app-shell">
      <div className="page-gradient" />
      <main className="page">
        <section className="hero card glass">
          <div>
            <div className="eyebrow">External analyst modeling workflow</div>
            <h1>Earnings-to-Model Update Agent</h1>
            <p className="hero-copy">
              Turn earnings transcripts plus analyst baseline assumptions into a transcript-backed forecast,
              DCF-style valuation view, and exportable model update pack.
            </p>
          </div>
          <div className="hero-meta">
            <StatusPill configured={status.configured} model={status.model} />
            <div className="hero-stats">
              <StatTile label="Core flow" value="Transcript → Assumptions → Forecast → Valuation" />
              <StatTile label="Built for" value="Investors, research, corp dev, strategy" />
            </div>
          </div>
        </section>

        <section className="workspace-grid">
          <div className="left-column">
            <section className="card input-card">
              <div className="section-header">
                <div>
                  <div className="section-kicker">Step 1</div>
                  <h2>Transcript input</h2>
                </div>
                <button className="ghost-button" onClick={handleReset} disabled={isProcessing}>
                  Reset
                </button>
              </div>

              <div className="mode-switch" role="tablist" aria-label="Input mode">
                <button className={inputMode === 'url' ? 'mode-button active' : 'mode-button'} onClick={() => setInputMode('url')}>
                  Paste transcript URL
                </button>
                <button className={inputMode === 'text' ? 'mode-button active' : 'mode-button'} onClick={() => setInputMode('text')}>
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
                    The backend attempts a best-effort transcript fetch and cleanup. If the page is hard to parse, the app will steer you to paste-text mode.
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
                    Preserve speaker changes and management guidance where possible. The transcript remains visible in the final model pack for trust and review.
                  </p>
                </div>
              )}

              <div className="samples-row">
                <div className="samples-label">Built-in example runs</div>
                <div className="sample-chips">
                  {sampleTranscripts.map((sample) => (
                    <button key={sample.id} className="sample-chip" onClick={() => loadSample(sample)} disabled={isProcessing}>
                      <strong>{sample.label}</strong>
                      <span>{sample.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              {error ? <div className="error-banner">{error}</div> : null}
            </section>

            <section className="card assumptions-card">
              <div className="section-header compact">
                <div>
                  <div className="section-kicker">Step 2</div>
                  <h2>Baseline analyst model</h2>
                </div>
                <div className="card-badge">Editable inputs</div>
              </div>

              {baselineGroups.map((group) => (
                <div key={group.title} className="assumption-group">
                  <div className="assumption-group-header">
                    <div className="assumption-group-title">{group.title}</div>
                    <div className="assumption-group-copy">{group.description}</div>
                  </div>

                  {group.revenueGrowth ? (
                    <div className="growth-grid">
                      {horizonLabels.map((label, index) => (
                        <NumericField
                          key={label}
                          label={`${label} growth`}
                          value={baseline.revenueGrowth[index]}
                          step={0.1}
                          suffix="%"
                          onChange={(value) => handleRevenueGrowthChange(index, value)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="field-grid">
                      {group.fields.map((field) => (
                        <InputField
                          key={field.key}
                          {...field}
                          value={baseline[field.key]}
                          onChange={(value) => handleBaselineChange(field.key, value)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}

              <div className="action-row model-action-row">
                <button className="primary-button" onClick={handleProcess} disabled={!canSubmit || isProcessing}>
                  {isProcessing ? 'Building model update…' : 'Generate forecast and valuation update'}
                </button>
                <div className="inline-guidance">Use your own baseline view. The app adjusts it with transcript-backed scenario logic, then runs deterministic model math.</div>
              </div>
            </section>

            <section className="card workflow-card">
              <div className="section-header compact">
                <div>
                  <div className="section-kicker">Workflow</div>
                  <h2>Agentic model build</h2>
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
                {isProcessing ? `Current step: ${lastCompletedStage || 'Starting'}` : result ? 'Model pack complete' : 'Ready to process'}
              </div>
            </section>
          </div>

          <div className="right-column">
            {!result ? (
              <section className="card empty-state">
                <div className="section-kicker">Output</div>
                <h2>Forecast, valuation, and evidence appear here</h2>
                <p>
                  This workspace is designed for outside analysts. It turns transcript evidence into assumption revisions,
                  rolls them through deterministic operating forecast math, and surfaces a reviewable valuation range.
                </p>
                <div className="empty-grid">
                  <div className="empty-chip">Executive model summary</div>
                  <div className="empty-chip">Assumption change log</div>
                  <div className="empty-chip">Forecast table</div>
                  <div className="empty-chip">DCF-style valuation</div>
                  <div className="empty-chip">Scenario comparison</div>
                  <div className="empty-chip">Evidence + review flags</div>
                </div>
              </section>
            ) : (
              <>
                <section className="card report-hero">
                  <div className="report-hero-top">
                    <div>
                      <div className="section-kicker">Model update pack</div>
                      <h2>{result.metadata.company || result.metadata.title || 'Transcript model update'}</h2>
                    </div>
                    <div className="action-cluster">
                      <button className="secondary-button" onClick={() => handleCopy('summary')}>Copy summary</button>
                      <button className="secondary-button" onClick={() => handleCopy('forecast')}>Copy forecast table</button>
                      <button className="secondary-button" onClick={() => handleCopy('valuation')}>Copy valuation table</button>
                      <button className="secondary-button" onClick={() => handleDownload('forecast')}>Forecast CSV</button>
                      <button className="secondary-button" onClick={() => handleDownload('assumptions')}>Assumptions CSV</button>
                      <button className="secondary-button" onClick={() => handleDownload('valuation')}>Valuation CSV</button>
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

                <SectionCard title="Executive model summary" kicker="A" defaultOpen>
                  <div className="executive-headline">{result.executiveSummary?.headline}</div>
                  <p className="executive-body">{result.executiveSummary?.body}</p>
                  <ul className="bullet-list">
                    {(result.executiveSummary?.bullets || []).map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                </SectionCard>

                <SectionCard title="Assumption change log" kicker="B" defaultOpen>
                  <div className="table-wrap">
                    <table className="delta-table">
                      <thead>
                        <tr>
                          <th>Driver</th>
                          <th>Prior analyst baseline</th>
                          <th>Updated view</th>
                          <th>Rationale</th>
                          <th>Transcript evidence</th>
                          <th>Confidence</th>
                          <th>Review</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(result.assumptionDeltaLog || []).map((row, index) => (
                          <tr key={`${row.driver}-${index}`}>
                            <td className="strong-cell">{row.driver}</td>
                            <td>{row.priorAnalystBaseline}</td>
                            <td>{row.updatedValue}</td>
                            <td>{row.rationale}</td>
                            <td>{row.evidence}</td>
                            <td><ConfidencePill confidence={row.confidence} /></td>
                            <td>{row.reviewRequired ? <span className="flag-chip">Review required</span> : <span className="ok-chip">Low friction</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>

                <SectionCard title="Forecast table" kicker="C" defaultOpen>
                  <div className="section-controls">
                    <div className="scenario-toggle">
                      {scenarioKeys.map((scenarioKey) => (
                        <button
                          key={scenarioKey}
                          className={selectedScenario === scenarioKey ? 'mode-button active' : 'mode-button'}
                          onClick={() => setSelectedScenario(scenarioKey)}
                        >
                          {capitalize(scenarioKey)} case
                        </button>
                      ))}
                    </div>
                    <div className="mini-note">Scenario math is deterministic. Gemini only proposes structured revisions and rationale.</div>
                  </div>

                  <div className="scenario-note-card">
                    <div className="scenario-note-head">
                      <span className="scenario-label solid">{capitalize(selectedScenario)} case</span>
                      <span className="mini-note">{selectedScenarioModel?.narrative?.summary || 'No scenario note returned.'}</span>
                    </div>
                    <div className="themes-row small">
                      {(selectedScenarioModel?.narrative?.keyAssumptions || []).map((point) => (
                        <span key={point} className="theme-chip muted">{point}</span>
                      ))}
                    </div>
                  </div>

                  <div className="table-wrap">
                    <table className="forecast-table">
                      <thead>
                        <tr>
                          <th>Metric</th>
                          {selectedScenarioModel?.forecastTable.map((row) => (
                            <th key={row.year}>{row.year}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {forecastMetricRows(selectedScenarioModel, result.baseline.unitLabel).map((row) => (
                          <tr key={row.label}>
                            <td className="strong-cell">{row.label}</td>
                            {row.values.map((value, index) => (
                              <td key={`${row.label}-${index}`}>{value}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>

                <SectionCard title="Valuation" kicker="D" defaultOpen>
                  <div className="valuation-grid">
                    {scenarioKeys.map((scenarioKey) => {
                      const valuation = result.modelPack.scenarios[scenarioKey].valuation;
                      return (
                        <article key={scenarioKey} className={`valuation-card ${scenarioKey}`}>
                          <div className="scenario-label">{scenarioKey}</div>
                          <div className="valuation-main">{formatPerShare(valuation.valuePerShare, result.baseline.unitLabel)}</div>
                          <div className="valuation-sub">Implied value per share</div>
                          <div className="valuation-list">
                            <ValuationLine label="Enterprise value" value={formatNumber(valuation.enterpriseValue, result.baseline.unitLabel)} />
                            <ValuationLine label="Equity value" value={formatNumber(valuation.equityValue, result.baseline.unitLabel)} />
                            <ValuationLine label="Terminal value" value={formatNumber(valuation.terminalValue, result.baseline.unitLabel)} />
                            <ValuationLine label="PV of terminal" value={formatNumber(valuation.pvTerminalValue, result.baseline.unitLabel)} />
                            <ValuationLine label="WACC" value={formatPercent(valuation.wacc)} />
                            <ValuationLine label="Terminal growth" value={formatPercent(valuation.terminalGrowth)} />
                            <ValuationLine label="Exit EBITDA EV" value={formatNumber(valuation.exitMultipleValue, result.baseline.unitLabel)} />
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  <div className="sensitivity-card">
                    <div className="section-subtitle">Base-case EV sensitivity ({result.baseline.unitLabel})</div>
                    <div className="table-wrap compact-wrap">
                      <table className="sensitivity-table">
                        <thead>
                          <tr>
                            <th>Terminal growth \ WACC</th>
                            {result.modelPack.baseSensitivity.waccValues.map((value) => (
                              <th key={value}>{formatPercent(value)}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.modelPack.baseSensitivity.terminalGrowthValues.map((terminalValue, rowIndex) => (
                            <tr key={terminalValue}>
                              <td className="strong-cell">{formatPercent(terminalValue)}</td>
                              {result.modelPack.baseSensitivity.matrix[rowIndex].map((cell, cellIndex) => (
                                <td key={`${terminalValue}-${cellIndex}`}>{formatNumber(cell, result.baseline.unitLabel)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="Scenario comparison" kicker="E" defaultOpen>
                  <div className="table-wrap">
                    <table className="comparison-table">
                      <thead>
                        <tr>
                          <th>Metric</th>
                          <th>Base</th>
                          <th>Upside</th>
                          <th>Downside</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(result.modelPack.comparison || []).map((row) => (
                          <tr key={row.metric}>
                            <td className="strong-cell">{row.metric}</td>
                            <td>{formatByType(row.base, row.format, result.baseline.unitLabel)}</td>
                            <td>{formatByType(row.upside, row.format, result.baseline.unitLabel)}</td>
                            <td>{formatByType(row.downside, row.format, result.baseline.unitLabel)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>

                <SectionCard title="Transcript evidence" kicker="F">
                  <div className="signal-grid single">
                    <div className="evidence-card">
                      <div className="split-header">Model driver map</div>
                      <div className="stack-list">
                        {sortByConfidence(result.modelDriverMap).map((item, index) => (
                          <div key={`${item.driver}-${index}`} className="stack-item">
                            <div className="signal-card-top">
                              <span className="category-pill">{prettyCategory(item.driver)}</span>
                              <ConfidencePill confidence={item.confidence} />
                            </div>
                            <div className="stack-text">{item.summary}</div>
                            <div className="stack-support">Impact: {item.impact}</div>
                            <div className="source-block">{item.evidence}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="two-column-grid evidence-columns">
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
                      <div className="split-header">Inferred modeling implications</div>
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

                <SectionCard title="Review flags" kicker="G">
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

                <SectionCard title="Model update checklist" kicker="H">
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

                <SectionCard title="Review trail" kicker="I">
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

function InputField({ label, type, value, onChange, step, suffix, placeholder }) {
  const isText = type === 'text';
  return (
    <label className="field-card">
      <span>{label}</span>
      <div className="field-input-wrap">
        <input
          className="text-input small"
          type={type}
          step={step}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(isText ? event.target.value : toNumber(event.target.value))}
        />
        {suffix ? <em>{suffix}</em> : null}
      </div>
    </label>
  );
}

function NumericField({ label, value, onChange, step = 0.1, suffix }) {
  return (
    <label className="field-card compact-card">
      <span>{label}</span>
      <div className="field-input-wrap">
        <input className="text-input small" type="number" step={step} value={value} onChange={(event) => onChange(toNumber(event.target.value))} />
        {suffix ? <em>{suffix}</em> : null}
      </div>
    </label>
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

function ValuationLine({ label, value }) {
  return (
    <div className="valuation-line">
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

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return `${Number(value).toFixed(1)}%`;
}

function formatNumber(value, unitLabel = '') {
  if (!Number.isFinite(Number(value))) return '—';
  const abs = Math.abs(Number(value));
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })}${unitLabel ? ` ${unitLabel}` : ''}`;
}

function formatPerShare(value, unitLabel = '') {
  if (!Number.isFinite(Number(value))) return '—';
  const shareUnit = unitLabel.endsWith('m') ? unitLabel.slice(0, -1) : unitLabel || 'Value';
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ${shareUnit}/sh`;
}

function formatByType(value, type, unitLabel) {
  if (type === 'percent') return formatPercent(value);
  if (type === 'perShare') return formatPerShare(value, unitLabel);
  return formatNumber(value, unitLabel);
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function forecastMetricRows(scenarioModel, unitLabel) {
  const rows = [
    { label: 'Revenue', key: 'revenue', format: 'number' },
    { label: 'Revenue growth %', key: 'revenueGrowth', format: 'percent' },
    { label: 'Gross margin %', key: 'grossMargin', format: 'percent' },
    { label: 'Gross profit', key: 'grossProfit', format: 'number' },
    { label: 'Operating margin %', key: 'operatingMargin', format: 'percent' },
    { label: 'Operating income', key: 'operatingIncome', format: 'number' },
    { label: 'EBITDA', key: 'ebitda', format: 'number' },
    { label: 'Tax rate %', key: 'taxRate', format: 'percent' },
    { label: 'NOPAT', key: 'nopat', format: 'number' },
    { label: 'Capex', key: 'capex', format: 'number' },
    { label: 'D&A', key: 'da', format: 'number' },
    { label: 'Δ Working capital', key: 'deltaWorkingCapital', format: 'number' },
    { label: 'Free cash flow', key: 'freeCashFlow', format: 'number' },
  ];

  return rows.map((row) => ({
    label: row.label,
    values: (scenarioModel?.forecastTable || []).map((item) => (row.format === 'percent' ? formatPercent(item[row.key]) : formatNumber(item[row.key], unitLabel))),
  }));
}

function buildCopyPayload(kind, result) {
  if (kind === 'summary') {
    return [
      result.executiveSummary?.headline,
      result.executiveSummary?.body,
      ...(result.executiveSummary?.bullets || []).map((bullet) => `• ${bullet}`),
    ].filter(Boolean).join('\n');
  }

  if (kind === 'forecast') {
    return buildForecastTsv(result);
  }

  if (kind === 'valuation') {
    return buildValuationTsv(result);
  }

  return [buildForecastTsv(result), '', buildValuationTsv(result)].join('\n');
}

function buildCsvPayload(kind, result) {
  if (kind === 'forecast') {
    return {
      filename: 'forecast-table.csv',
      content: buildForecastCsv(result),
    };
  }

  if (kind === 'valuation') {
    return {
      filename: 'valuation-table.csv',
      content: buildValuationCsv(result),
    };
  }

  return {
    filename: 'assumption-change-log.csv',
    content: buildAssumptionsCsv(result),
  };
}

function buildForecastCsv(result) {
  const lines = ['Scenario,Metric,' + horizonLabels.join(',')];
  scenarioKeys.forEach((scenarioKey) => {
    forecastMetricRows(result.modelPack.scenarios[scenarioKey], result.baseline.unitLabel).forEach((row) => {
      lines.push([capitalize(scenarioKey), escapeCsv(row.label), ...row.values.map(escapeCsv)].join(','));
    });
  });
  return lines.join('\n');
}

function buildAssumptionsCsv(result) {
  const lines = ['Driver,Prior analyst baseline,Updated view,Rationale,Transcript evidence,Confidence,Review required'];
  (result.assumptionDeltaLog || []).forEach((row) => {
    lines.push([
      row.driver,
      row.priorAnalystBaseline,
      row.updatedValue,
      row.rationale,
      row.evidence,
      row.confidence,
      row.reviewRequired ? 'Yes' : 'No',
    ].map(escapeCsv).join(','));
  });
  return lines.join('\n');
}

function buildValuationCsv(result) {
  const lines = ['Scenario,Enterprise value,Equity value,Value per share,Terminal value,PV of terminal,WACC,Terminal growth,Exit EBITDA EV'];
  scenarioKeys.forEach((scenarioKey) => {
    const valuation = result.modelPack.scenarios[scenarioKey].valuation;
    lines.push([
      capitalize(scenarioKey),
      valuation.enterpriseValue,
      valuation.equityValue,
      valuation.valuePerShare,
      valuation.terminalValue,
      valuation.pvTerminalValue,
      valuation.wacc,
      valuation.terminalGrowth,
      valuation.exitMultipleValue,
    ].map(escapeCsv).join(','));
  });
  return lines.join('\n');
}

function buildForecastTsv(result) {
  const rows = [['Scenario', 'Metric', ...horizonLabels]];
  scenarioKeys.forEach((scenarioKey) => {
    forecastMetricRows(result.modelPack.scenarios[scenarioKey], result.baseline.unitLabel).forEach((row) => {
      rows.push([capitalize(scenarioKey), row.label, ...row.values]);
    });
  });
  return rows.map((row) => row.join('\t')).join('\n');
}

function buildValuationTsv(result) {
  const rows = [['Scenario', 'Enterprise value', 'Equity value', 'Value per share', 'Terminal value', 'PV of terminal', 'WACC', 'Terminal growth', 'Exit EBITDA EV']];
  scenarioKeys.forEach((scenarioKey) => {
    const valuation = result.modelPack.scenarios[scenarioKey].valuation;
    rows.push([
      capitalize(scenarioKey),
      formatNumber(valuation.enterpriseValue, result.baseline.unitLabel),
      formatNumber(valuation.equityValue, result.baseline.unitLabel),
      formatPerShare(valuation.valuePerShare, result.baseline.unitLabel),
      formatNumber(valuation.terminalValue, result.baseline.unitLabel),
      formatNumber(valuation.pvTerminalValue, result.baseline.unitLabel),
      formatPercent(valuation.wacc),
      formatPercent(valuation.terminalGrowth),
      formatNumber(valuation.exitMultipleValue, result.baseline.unitLabel),
    ]);
  });
  return rows.map((row) => row.join('\t')).join('\n');
}

function escapeCsv(value) {
  const stringValue = String(value ?? '');
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function copyLabel(kind) {
  if (kind === 'summary') return 'Summary copied';
  if (kind === 'forecast') return 'Forecast table copied';
  if (kind === 'valuation') return 'Valuation table copied';
  return 'Output copied';
}

function downloadLabel(kind) {
  if (kind === 'forecast') return 'Forecast CSV downloaded';
  if (kind === 'valuation') return 'Valuation CSV downloaded';
  return 'Assumptions CSV downloaded';
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
