import { useEffect, useMemo, useState } from 'react';
import { baselineGroups, defaultBaseline, horizonLabels, supportingMaterialKinds } from './assumptions';
import { sampleCases } from './samples';

const workflowTemplate = [
  { key: 'filing', label: 'Ingesting filing', note: 'Fetch or normalize the latest 10-Q or 10-K', status: 'pending' },
  { key: 'support', label: 'Ingesting supporting materials', note: 'Add optional release, deck, letter, or commentary', status: 'pending' },
  { key: 'reported', label: 'Extracting filing-grounded base', note: 'Pull reported facts, disclosures, and missing inputs', status: 'pending' },
  { key: 'delta', label: 'Assessing transcript delta', note: 'Compare management commentary against the filing-grounded base', status: 'pending' },
  { key: 'integrate', label: 'Integrating source read-through', note: 'Merge filing, call, and baseline into estimate revisions', status: 'pending' },
  { key: 'forecast', label: 'Running deterministic scenario forecast', note: 'Roll assumptions through inspectable code-driven math', status: 'pending' },
  { key: 'valuation', label: 'Running valuation bridge and sensitivities', note: 'Compute scenario value, bridge impacts, and sensitivities', status: 'pending' },
  { key: 'pack', label: 'Preparing model update pack', note: 'Assemble banker-style sections, evidence mapping, and exports', status: 'pending' },
];

const scenarioKeys = ['base', 'upside', 'downside'];
const confidenceOrder = { high: 3, medium: 2, low: 1 };

function createEmptyDocument(kind, label) {
  return {
    kind,
    label,
    inputMode: 'text',
    text: '',
    url: '',
  };
}

function createSupportItem(kind = 'earnings_release') {
  return {
    id: crypto.randomUUID(),
    kind,
    inputMode: 'text',
    text: '',
    url: '',
  };
}

export default function App() {
  const [filing, setFiling] = useState(createEmptyDocument('filing', 'Filing'));
  const [transcript, setTranscript] = useState(createEmptyDocument('transcript', 'Transcript'));
  const [supportingMaterials, setSupportingMaterials] = useState([]);
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

  const filingReady = filing.inputMode === 'url' ? Boolean(filing.url.trim()) : filing.text.trim().length >= 1000;

  const summaryStats = useMemo(() => {
    if (!result) return [];
    const priorValue = result.modelPack.priorView.valuation.valuePerShare;
    const baseValue = result.modelPack.scenarios.base.valuation.valuePerShare;
    const sourceCount = 1 + (result.sources.transcript ? 1 : 0) + (result.sources.supportingMaterials?.length || 0);
    return [
      { label: 'Base value / share', value: formatPerShare(baseValue, result.baselineUsed.unitLabel) },
      { label: 'Change vs prior view', value: formatDelta(baseValue - priorValue, 'perShare', result.baselineUsed.unitLabel) },
      { label: 'Filing type', value: result.filingMetadata.filingType || 'Needs review' },
      { label: 'Source count', value: String(sourceCount) },
    ];
  }, [result]);

  const selectedScenarioModel = result ? result.modelPack.scenarios[selectedScenario] : null;

  async function handleProcess() {
    if (!filingReady || isProcessing) return;

    setError('');
    setResult(null);
    setLastCompletedStage('');
    setWorkflow(workflowTemplate.map((step, index) => ({ ...step, status: index === 0 ? 'active' : 'pending' })));
    setIsProcessing(true);

    try {
      await streamProcess(
        {
          filing,
          transcript: hasDocumentContent(transcript) ? transcript : null,
          supportingMaterials: supportingMaterials.filter(hasDocumentContent),
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
            setSelectedScenario('base');
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
    setFiling(createEmptyDocument('filing', 'Filing'));
    setTranscript(createEmptyDocument('transcript', 'Transcript'));
    setSupportingMaterials([]);
    setBaseline(defaultBaseline);
    setError('');
    setResult(null);
    setWorkflow(workflowTemplate);
    setLastCompletedStage('');
    setSelectedScenario('base');
  }

  function handleBaselineChange(key, value) {
    setBaseline((current) => ({ ...current, [key]: value }));
  }

  function handleRevenueGrowthChange(index, value) {
    setBaseline((current) => ({
      ...current,
      revenueGrowth: current.revenueGrowth.map((item, itemIndex) => (itemIndex === index ? value : item)),
    }));
  }

  function loadSample(sample) {
    setFiling(sample.filing);
    setTranscript(sample.transcript || createEmptyDocument('transcript', 'Transcript'));
    setSupportingMaterials((sample.supportingMaterials || []).map((item) => ({ id: crypto.randomUUID(), ...item })));
    setBaseline(sample.baseline);
    setError('');
    setResult(null);
  }

  function updateSupportItem(id, key, value) {
    setSupportingMaterials((current) => current.map((item) => (item.id === id ? { ...item, [key]: value } : item)));
  }

  function addSupportItem() {
    setSupportingMaterials((current) => [...current, createSupportItem()]);
  }

  function removeSupportItem(id) {
    setSupportingMaterials((current) => current.filter((item) => item.id !== id));
  }

  async function handleCopy(kind) {
    if (!result) return;
    await navigator.clipboard.writeText(buildCopyPayload(kind, result));
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
      <main className="page">
        <section className="hero card">
          <div className="hero-copy-block">
            <div className="eyebrow">Filing-grounded external analyst workflow</div>
            <h1>Filing-to-Model Update Workbench</h1>
            <p className="hero-copy">
              Ground the model in the latest 10-Q or 10-K, layer in call commentary where available,
              and produce a reviewable forecast and valuation update with explicit evidence, inference boundaries, and deterministic math.
            </p>
          </div>
          <div className="hero-meta">
            <StatusPill configured={status.configured} model={status.model} />
            <div className="hero-stats">
              <StatTile label="Primary anchor" value="Latest 10-Q / 10-K" />
              <StatTile label="Optional layer" value="Transcript, release, deck, letter" />
            </div>
          </div>
        </section>

        <section className="workspace-grid">
          <div className="left-column">
            <section className="card input-card">
              <div className="section-header">
                <div>
                  <div className="section-kicker">Step 1 to 3</div>
                  <h2>Source materials</h2>
                </div>
                <button className="ghost-button" onClick={handleReset} disabled={isProcessing}>Reset</button>
              </div>

              <DocumentInputCard
                title="Latest filing"
                subtitle="Required. Use the latest 10-Q or 10-K as the factual base for the model update."
                document={filing}
                required
                onChange={setFiling}
                urlPlaceholder="https://www.sec.gov/.../10-q-or-10-k"
                textPlaceholder="Paste the latest filing text here"
              />

              <DocumentInputCard
                title="Earnings transcript"
                subtitle="Optional but recommended. Use the call to detect what changed and to shape the forward view."
                document={transcript}
                onChange={setTranscript}
                urlPlaceholder="https://www.example.com/earnings-call-transcript"
                textPlaceholder="Paste the earnings transcript here"
              />

              <div className="support-card">
                <div className="support-header">
                  <div>
                    <div className="support-title">Supporting materials</div>
                    <div className="support-copy">Optional. Add the release, deck, shareholder letter, or other management commentary.</div>
                  </div>
                  <button className="secondary-button small-button" onClick={addSupportItem} type="button">Add source</button>
                </div>

                {supportingMaterials.length === 0 ? (
                  <div className="subtle-empty">No optional support materials added.</div>
                ) : (
                  <div className="supporting-list">
                    {supportingMaterials.map((item) => (
                      <div key={item.id} className="supporting-item">
                        <div className="supporting-item-top">
                          <select className="select-input" value={item.kind} onChange={(event) => updateSupportItem(item.id, 'kind', event.target.value)}>
                            {supportingMaterialKinds.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                          <div className="mini-switch">
                            <button
                              className={item.inputMode === 'text' ? 'mode-button active' : 'mode-button'}
                              onClick={() => updateSupportItem(item.id, 'inputMode', 'text')}
                              type="button"
                            >
                              Paste text
                            </button>
                            <button
                              className={item.inputMode === 'url' ? 'mode-button active' : 'mode-button'}
                              onClick={() => updateSupportItem(item.id, 'inputMode', 'url')}
                              type="button"
                            >
                              Paste URL
                            </button>
                          </div>
                          <button className="ghost-button small-button" type="button" onClick={() => removeSupportItem(item.id)}>Remove</button>
                        </div>

                        {item.inputMode === 'url' ? (
                          <input
                            className="text-input"
                            type="url"
                            placeholder="https://www.example.com/supporting-material"
                            value={item.url || ''}
                            onChange={(event) => updateSupportItem(item.id, 'url', event.target.value)}
                          />
                        ) : (
                          <textarea
                            className="transcript-input compact"
                            placeholder="Paste supporting material text here"
                            value={item.text || ''}
                            onChange={(event) => updateSupportItem(item.id, 'text', event.target.value)}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="samples-row">
                <div className="samples-label">Example cases</div>
                <div className="sample-chips">
                  {sampleCases.map((sample) => (
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
                  <div className="section-kicker">Step 4</div>
                  <h2>Prior baseline assumptions</h2>
                </div>
                <div className="card-badge">Editable</div>
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
                          label={label}
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
                <button className="primary-button" onClick={handleProcess} disabled={!filingReady || isProcessing}>
                  {isProcessing ? 'Building model update pack…' : 'Generate model update pack'}
                </button>
                <div className="inline-guidance">
                  Filing input is required. Transcript input is optional, but it materially improves change detection and the forward read-through.
                </div>
              </div>
            </section>

            <section className="card workflow-card">
              <div className="section-header compact">
                <div>
                  <div className="section-kicker">Step 5</div>
                  <h2>Processing trail</h2>
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
                {isProcessing ? `Current step: ${lastCompletedStage || 'Starting'}` : result ? 'Update pack complete' : 'Awaiting required filing input'}
              </div>
            </section>
          </div>

          <div className="right-column">
            {!result ? (
              <section className="card empty-state">
                <div className="section-kicker">Output</div>
                <h2>Filing-grounded work product appears here</h2>
                <p>
                  The output is organized like institutional finance work product: filing-grounded base assumptions,
                  recommended estimate changes, deterministic scenario forecast, valuation bridge, and a clear evidence trail.
                </p>
                <div className="empty-grid">
                  <div className="empty-chip">Executive takeaway</div>
                  <div className="empty-chip">What changed vs prior view</div>
                  <div className="empty-chip">Filing-grounded base</div>
                  <div className="empty-chip">Estimate change log</div>
                  <div className="empty-chip">Scenario forecast</div>
                  <div className="empty-chip">Valuation bridge</div>
                </div>
              </section>
            ) : (
              <>
                <section className="card report-hero">
                  <div className="report-hero-top">
                    <div>
                      <div className="section-kicker">Model update pack</div>
                      <h2>{result.filingMetadata.company || result.filingMetadata.title || 'Filing-grounded model update'}</h2>
                    </div>
                    <div className="action-cluster">
                      <button className="secondary-button" onClick={() => handleCopy('takeaway')}>Copy takeaway</button>
                      <button className="secondary-button" onClick={() => handleCopy('changes')}>Copy estimate changes</button>
                      <button className="secondary-button" onClick={() => handleCopy('forecast')}>Copy forecast</button>
                      <button className="secondary-button" onClick={() => handleDownload('changes')}>Estimate CSV</button>
                      <button className="secondary-button" onClick={() => handleDownload('forecast')}>Forecast CSV</button>
                      <button className="secondary-button" onClick={() => handleDownload('valuation')}>Valuation CSV</button>
                      <button className="secondary-button" onClick={() => window.print()}>Export report</button>
                    </div>
                  </div>

                  <div className="report-header-grid report-meta-grid">
                    <MetaPill label="Filing type" value={result.filingMetadata.filingType || 'Needs review'} />
                    <MetaPill label="Period" value={result.filingMetadata.period || 'Needs review'} />
                    <MetaPill label="Filing date" value={result.filingMetadata.filingDate || 'Needs review'} />
                    <MetaPill label="Call layer" value={result.sources.transcript ? 'Included' : 'Not provided'} />
                  </div>

                  <div className="summary-stats-grid">
                    {summaryStats.map((item) => (
                      <StatTile key={item.label} label={item.label} value={item.value} />
                    ))}
                  </div>

                  {copyFeedback ? <div className="copy-feedback">{copyFeedback}</div> : null}
                </section>

                <SectionCard title="Executive takeaway" kicker="1" defaultOpen>
                  <div className="executive-headline">{result.executiveTakeaway?.headline}</div>
                  <p className="executive-body">{result.executiveTakeaway?.body}</p>
                  <ul className="bullet-list">
                    {(result.executiveTakeaway?.bullets || []).map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                </SectionCard>

                <SectionCard title="Key filing and call takeaways" kicker="2" defaultOpen>
                  <div className="takeaway-grid">
                    {sortByConfidence(result.keyTakeaways).map((item, index) => (
                      <article key={`${item.title}-${index}`} className="takeaway-card">
                        <div className="takeaway-top">
                          <SourcePill source={item.source} />
                          <div className="pill-group">
                            <ClassificationPill classification={item.classification} />
                            <ConfidencePill confidence={item.confidence} />
                          </div>
                        </div>
                        <h3>{item.title}</h3>
                        <p>{item.summary}</p>
                      </article>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="What changed vs prior view" kicker="3" defaultOpen>
                  <div className="executive-body">{result.changeVsPriorView?.summary}</div>
                  <ul className="bullet-list compact-list">
                    {(result.changeVsPriorView?.bullets || []).map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>

                  <div className="table-wrap compact-spacing">
                    <table className="comparison-table numeric-table">
                      <thead>
                        <tr>
                          <th>Metric</th>
                          <th>Prior view</th>
                          <th>Revised base</th>
                          <th>Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(result.modelPack.changeVsPrior || []).map((row) => (
                          <tr key={row.metric}>
                            <td className="strong-cell">{row.metric}</td>
                            <td className="numeric-cell">{formatByType(row.prior, row.format, result.baselineUsed.unitLabel)}</td>
                            <td className="numeric-cell">{formatByType(row.revised, row.format, result.baselineUsed.unitLabel)}</td>
                            <td className="numeric-cell">{formatDelta(row.delta, row.format, result.baselineUsed.unitLabel)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>

                <SectionCard title="Filing-grounded base assumptions" kicker="4" defaultOpen>
                  <div className="base-summary">{result.filingGroundedBase?.summary || result.reportedBase?.summary}</div>

                  <div className="facts-grid">
                    {(result.reportedBase?.reportedFacts || []).slice(0, 8).map((fact, index) => (
                      <div key={`${fact.metric}-${index}`} className="fact-card">
                        <div className="fact-metric">{fact.metric}</div>
                        <div className="fact-value">{fact.valueText}</div>
                        <div className="fact-foot">{fact.category}</div>
                      </div>
                    ))}
                  </div>

                  <div className="table-wrap compact-spacing">
                    <table className="delta-table assumption-table">
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Current baseline</th>
                          <th>Filing read-through</th>
                          <th>Status</th>
                          <th>Evidence</th>
                          <th>Confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(result.filingGroundedBase?.assumptionChecks || []).map((row, index) => (
                          <tr key={`${row.field}-${index}`}>
                            <td className="strong-cell">{row.field}</td>
                            <td>{row.currentBaseline}</td>
                            <td>{row.filingReadThrough}</td>
                            <td><ClassificationPill classification={row.status} /></td>
                            <td>{row.evidence}</td>
                            <td><ConfidencePill confidence={row.confidence} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>

                <SectionCard title="Recommended estimate changes" kicker="5" defaultOpen>
                  <div className="table-wrap">
                    <table className="delta-table assumption-table">
                      <thead>
                        <tr>
                          <th>Driver</th>
                          <th>Prior view</th>
                          <th>Recommended change</th>
                          <th>Classification</th>
                          <th>Rationale</th>
                          <th>Evidence</th>
                          <th>Confidence</th>
                          <th>Review</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(result.estimateChangeLog || []).map((row, index) => (
                          <tr key={`${row.driver}-${index}`}>
                            <td className="strong-cell">{row.driver}</td>
                            <td>{row.priorView}</td>
                            <td>{row.recommendedChange}</td>
                            <td><ClassificationPill classification={row.classification} /></td>
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

                <SectionCard title="Scenario forecast" kicker="6" defaultOpen>
                  <div className="section-controls">
                    <div className="scenario-toggle">
                      {scenarioKeys.map((scenarioKey) => (
                        <button
                          key={scenarioKey}
                          className={selectedScenario === scenarioKey ? 'mode-button active' : 'mode-button'}
                          onClick={() => setSelectedScenario(scenarioKey)}
                          type="button"
                        >
                          {capitalize(scenarioKey)}
                        </button>
                      ))}
                    </div>
                    <div className="mini-note">Math is code-driven. Gemini only proposes the structured revision layer.</div>
                  </div>

                  <div className="scenario-note-card">
                    <div className="scenario-note-head">
                      <span className="scenario-label solid">{capitalize(selectedScenario)} case</span>
                      <span className="mini-note">{result.scenarioWriteups?.[selectedScenario]?.summary || selectedScenarioModel?.narrative?.summary}</span>
                    </div>
                    <ul className="bullet-list compact-list inside-card">
                      {(result.scenarioWriteups?.[selectedScenario]?.bullets || selectedScenarioModel?.narrative?.keyAssumptions || []).map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="table-wrap">
                    <table className="forecast-table numeric-table">
                      <thead>
                        <tr>
                          <th>Metric</th>
                          {selectedScenarioModel?.forecastTable.map((row) => (
                            <th key={row.year} className="numeric-cell">{row.year}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {forecastMetricRows(selectedScenarioModel, result.baselineUsed.unitLabel).map((row) => (
                          <tr key={row.label}>
                            <td className="strong-cell">{row.label}</td>
                            {row.values.map((value, index) => (
                              <td key={`${row.label}-${index}`} className="numeric-cell">{value}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>

                <SectionCard title="Valuation summary" kicker="7" defaultOpen>
                  <div className="valuation-summary-copy">{result.valuationSummary?.summary}</div>
                  <div className="valuation-grid four-up">
                    <ValuationCard title="Prior view" valuation={result.modelPack.priorView.valuation} unitLabel={result.baselineUsed.unitLabel} tone="prior" />
                    <ValuationCard title="Base case" valuation={result.modelPack.scenarios.base.valuation} unitLabel={result.baselineUsed.unitLabel} tone="base" />
                    <ValuationCard title="Upside case" valuation={result.modelPack.scenarios.upside.valuation} unitLabel={result.baselineUsed.unitLabel} tone="upside" />
                    <ValuationCard title="Downside case" valuation={result.modelPack.scenarios.downside.valuation} unitLabel={result.baselineUsed.unitLabel} tone="downside" />
                  </div>
                </SectionCard>

                <SectionCard title="Valuation bridge and key sensitivities" kicker="8" defaultOpen>
                  <div className="executive-body">{result.valuationSummary?.bridgeCommentary}</div>

                  <div className="bridge-grid">
                    <div className="table-wrap compact-spacing">
                      <table className="comparison-table numeric-table">
                        <thead>
                          <tr>
                            <th>Bridge step</th>
                            <th>Enterprise value</th>
                            <th>Step delta</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(result.modelPack.valuationBridge || []).map((row) => (
                            <tr key={row.key}>
                              <td className="strong-cell">{row.label}</td>
                              <td className="numeric-cell">{formatNumber(row.enterpriseValue, result.baselineUsed.unitLabel)}</td>
                              <td className="numeric-cell">{formatDelta(row.delta, 'number', result.baselineUsed.unitLabel)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="bridge-comments">
                      <div className="split-header">Key valuation implications</div>
                      <div className="stack-list">
                        {(result.valuationImplications?.bridgeDrivers || []).map((item, index) => (
                          <div key={`${item.driver}-${index}`} className="stack-item">
                            <div className="signal-card-top">
                              <span className="category-pill">{item.driver}</span>
                              <ConfidencePill confidence={item.confidence} />
                            </div>
                            <div className="stack-text">{item.effect}</div>
                            <div className="stack-support">{item.explanation}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="sensitivity-card">
                    <div className="section-subtitle">Base-case EV sensitivity ({result.baselineUsed.unitLabel})</div>
                    <div className="table-wrap compact-wrap">
                      <table className="sensitivity-table numeric-table">
                        <thead>
                          <tr>
                            <th>Terminal growth \ WACC</th>
                            {result.modelPack.baseSensitivity.waccValues.map((value) => (
                              <th key={value} className="numeric-cell">{formatPercent(value)}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.modelPack.baseSensitivity.terminalGrowthValues.map((terminalValue, rowIndex) => (
                            <tr key={terminalValue}>
                              <td className="strong-cell">{formatPercent(terminalValue)}</td>
                              {result.modelPack.baseSensitivity.matrix[rowIndex].map((cell, cellIndex) => (
                                <td key={`${terminalValue}-${cellIndex}`} className="numeric-cell">{formatNumber(cell, result.baselineUsed.unitLabel)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="Evidence map" kicker="9">
                  <div className="evidence-grid">
                    {sortByConfidence(result.evidenceMap).map((item, index) => (
                      <div key={`${item.driver}-${index}`} className="evidence-card">
                        <div className="takeaway-top">
                          <SourcePill source={item.source} />
                          <div className="pill-group">
                            <ClassificationPill classification={item.classification} />
                            <ConfidencePill confidence={item.confidence} />
                          </div>
                        </div>
                        <div className="stack-text">{prettyCategory(item.driver)}</div>
                        <div className="stack-support">{item.summary}</div>
                        <div className="source-block">{item.evidence}</div>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Review flags and analyst judgment" kicker="10">
                  <div className="two-column-grid review-columns">
                    <div className="split-panel">
                      <div className="split-header">Review flags</div>
                      <div className="stack-list">
                        {(result.reviewFlags || []).map((flag, index) => (
                          <div key={`${flag.item}-${index}`} className="stack-item">
                            <div className="stack-text">{flag.item}</div>
                            <div className="stack-support">{flag.reason}</div>
                            <div className="source-block">{flag.evidence}</div>
                            <ConfidencePill confidence={flag.confidence} />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="split-panel">
                      <div className="split-header">Watch items</div>
                      <div className="stack-list">
                        {(result.watchItems || []).map((item, index) => (
                          <div key={`${item.item}-${index}`} className="stack-item">
                            <div className="stack-text">{item.item}</div>
                            <div className="stack-support">{item.whyItMatters}</div>
                            <ConfidencePill confidence={item.confidence} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="Model update checklist" kicker="11">
                  <div className="checklist-grid">
                    {(result.checklist || []).map((item, index) => (
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

                <SectionCard title="Source appendix" kicker="12">
                  <SourceAppendixCard title="Filing" source={result.sources.filing} />
                  {result.sources.transcript ? <SourceAppendixCard title="Transcript" source={result.sources.transcript} /> : null}
                  {(result.sources.supportingMaterials || []).map((source, index) => (
                    <SourceAppendixCard key={`${source.title}-${index}`} title={source.label || `Supporting material ${index + 1}`} source={source} />
                  ))}
                </SectionCard>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function DocumentInputCard({ title, subtitle, document, onChange, required = false, urlPlaceholder, textPlaceholder }) {
  return (
    <div className="document-card">
      <div className="document-card-head">
        <div>
          <div className="document-title-row">
            <div className="document-title">{title}</div>
            {required ? <span className="required-pill">Required</span> : <span className="optional-pill">Optional</span>}
          </div>
          <div className="document-copy">{subtitle}</div>
        </div>
      </div>

      <div className="mini-switch">
        <button className={document.inputMode === 'text' ? 'mode-button active' : 'mode-button'} onClick={() => onChange({ ...document, inputMode: 'text' })} type="button">
          Paste text
        </button>
        <button className={document.inputMode === 'url' ? 'mode-button active' : 'mode-button'} onClick={() => onChange({ ...document, inputMode: 'url' })} type="button">
          Paste URL
        </button>
      </div>

      {document.inputMode === 'url' ? (
        <input
          className="text-input"
          type="url"
          placeholder={urlPlaceholder}
          value={document.url || ''}
          onChange={(event) => onChange({ ...document, url: event.target.value })}
        />
      ) : (
        <textarea
          className="transcript-input"
          placeholder={textPlaceholder}
          value={document.text || ''}
          onChange={(event) => onChange({ ...document, text: event.target.value })}
        />
      )}
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

function SourceAppendixCard({ title, source }) {
  return (
    <details className="appendix-card" open={false}>
      <summary>
        <div>
          <div className="appendix-title">{title}</div>
          <div className="appendix-meta">{source.inputMode === 'url' ? source.url || 'URL source' : `${source.chars.toLocaleString()} chars`}</div>
        </div>
        <span className="summary-hint">Open</span>
      </summary>
      <div className="transcript-preview appendix-text">{source.fullText}</div>
    </details>
  );
}

function SourcePill({ source }) {
  const label =
    source === 'filing'
      ? 'Filing'
      : source === 'transcript'
        ? 'Transcript'
        : source === 'supporting_material'
          ? 'Support'
          : source === 'integrated_model'
            ? 'Model layer'
            : source;
  return <span className={`source-pill ${source}`}>{label}</span>;
}

function ClassificationPill({ classification = 'inferred' }) {
  return <span className={`classification-pill ${classification}`}>{classificationLabel(classification)}</span>;
}

function ValuationCard({ title, valuation, unitLabel, tone }) {
  return (
    <article className={`valuation-card ${tone}`}>
      <div className="scenario-label">{title}</div>
      <div className="valuation-main">{formatPerShare(valuation.valuePerShare, unitLabel)}</div>
      <div className="valuation-sub">Implied value per share</div>
      <div className="valuation-list compact-listing">
        <ValuationLine label="Enterprise value" value={formatNumber(valuation.enterpriseValue, unitLabel)} />
        <ValuationLine label="Equity value" value={formatNumber(valuation.equityValue, unitLabel)} />
        <ValuationLine label="WACC" value={formatPercent(valuation.wacc)} />
        <ValuationLine label="Terminal growth" value={formatPercent(valuation.terminalGrowth)} />
      </div>
    </article>
  );
}

function StatusPill({ configured, model }) {
  const label = configured ? 'Gemini configured' : configured === false ? 'Set GEMINI_API_KEY' : 'Checking model config';
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

function formatDelta(value, type, unitLabel) {
  if (!Number.isFinite(Number(value))) return '—';
  const prefix = Number(value) > 0 ? '+' : '';
  return `${prefix}${formatByType(value, type, unitLabel)}`;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function prettyCategory(value = 'other') {
  return value.replace(/_/g, ' ');
}

function classificationLabel(value) {
  if (value === 'review_required') return 'review required';
  return value.replace(/_/g, ' ');
}

function forecastMetricRows(scenarioModel, unitLabel) {
  const rows = [
    { label: 'Revenue', key: 'revenue', format: 'number' },
    { label: 'Revenue growth', key: 'revenueGrowth', format: 'percent' },
    { label: 'Gross margin', key: 'grossMargin', format: 'percent' },
    { label: 'Gross profit', key: 'grossProfit', format: 'number' },
    { label: 'Operating margin', key: 'operatingMargin', format: 'percent' },
    { label: 'Operating income', key: 'operatingIncome', format: 'number' },
    { label: 'EBITDA', key: 'ebitda', format: 'number' },
    { label: 'Tax rate', key: 'taxRate', format: 'percent' },
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
  if (kind === 'takeaway') {
    return [
      result.executiveTakeaway?.headline,
      result.executiveTakeaway?.body,
      ...(result.executiveTakeaway?.bullets || []).map((bullet) => `• ${bullet}`),
    ].filter(Boolean).join('\n');
  }

  if (kind === 'changes') {
    return buildEstimateChangeTsv(result);
  }

  return buildForecastTsv(result);
}

function buildCsvPayload(kind, result) {
  if (kind === 'forecast') {
    return { filename: 'scenario-forecast.csv', content: buildForecastCsv(result) };
  }
  if (kind === 'valuation') {
    return { filename: 'valuation-summary.csv', content: buildValuationCsv(result) };
  }
  return { filename: 'estimate-change-log.csv', content: buildEstimateChangeCsv(result) };
}

function buildEstimateChangeCsv(result) {
  const lines = ['Driver,Prior view,Recommended change,Classification,Rationale,Evidence,Confidence,Review required'];
  (result.estimateChangeLog || []).forEach((row) => {
    lines.push([
      row.driver,
      row.priorView,
      row.recommendedChange,
      row.classification,
      row.rationale,
      row.evidence,
      row.confidence,
      row.reviewRequired ? 'Yes' : 'No',
    ].map(escapeCsv).join(','));
  });
  return lines.join('\n');
}

function buildForecastCsv(result) {
  const lines = ['Scenario,Metric,' + horizonLabels.join(',')];
  scenarioKeys.forEach((scenarioKey) => {
    forecastMetricRows(result.modelPack.scenarios[scenarioKey], result.baselineUsed.unitLabel).forEach((row) => {
      lines.push([capitalize(scenarioKey), escapeCsv(row.label), ...row.values.map(escapeCsv)].join(','));
    });
  });
  return lines.join('\n');
}

function buildValuationCsv(result) {
  const lines = ['Scenario,Enterprise value,Equity value,Value per share,WACC,Terminal growth'];
  [['prior', result.modelPack.priorView.valuation], ...scenarioKeys.map((key) => [key, result.modelPack.scenarios[key].valuation])].forEach(([name, valuation]) => {
    lines.push([
      capitalize(name),
      valuation.enterpriseValue,
      valuation.equityValue,
      valuation.valuePerShare,
      valuation.wacc,
      valuation.terminalGrowth,
    ].map(escapeCsv).join(','));
  });
  return lines.join('\n');
}

function buildEstimateChangeTsv(result) {
  const rows = [['Driver', 'Prior view', 'Recommended change', 'Classification', 'Rationale', 'Evidence', 'Confidence', 'Review required']];
  (result.estimateChangeLog || []).forEach((row) => {
    rows.push([row.driver, row.priorView, row.recommendedChange, row.classification, row.rationale, row.evidence, row.confidence, row.reviewRequired ? 'Yes' : 'No']);
  });
  return rows.map((row) => row.join('\t')).join('\n');
}

function buildForecastTsv(result) {
  const rows = [['Scenario', 'Metric', ...horizonLabels]];
  scenarioKeys.forEach((scenarioKey) => {
    forecastMetricRows(result.modelPack.scenarios[scenarioKey], result.baselineUsed.unitLabel).forEach((row) => {
      rows.push([capitalize(scenarioKey), row.label, ...row.values]);
    });
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
  if (kind === 'takeaway') return 'Executive takeaway copied';
  if (kind === 'changes') return 'Estimate changes copied';
  return 'Forecast table copied';
}

function downloadLabel(kind) {
  if (kind === 'forecast') return 'Forecast CSV downloaded';
  if (kind === 'valuation') return 'Valuation CSV downloaded';
  return 'Estimate change CSV downloaded';
}

function hasDocumentContent(document) {
  return Boolean(document && ((document.inputMode === 'url' && document.url?.trim()) || (document.inputMode === 'text' && document.text?.trim())));
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
