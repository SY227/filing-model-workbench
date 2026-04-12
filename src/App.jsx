import { useEffect, useMemo, useState } from 'react';
import { baselineGroups, defaultBaseline, horizonLabels } from './assumptions';
import { sampleCases } from './samples';

const workflowTemplate = [
  { key: 'ingest', label: 'Ingesting filing', note: 'Fetch or normalize the 10-Q or 10-K text.', status: 'pending' },
  { key: 'extract', label: 'Extracting filing facts', note: 'Identify filing metadata, reported base metrics, and disclosure-driven takeaways.', status: 'pending' },
  { key: 'frame', label: 'Drafting assumptions and model implications', note: 'Translate the filing into proposed assumptions, scenario setup, and valuation context.', status: 'pending' },
  { key: 'forecast', label: 'Running deterministic model math', note: 'Roll the setup through code-driven forecast and DCF logic.', status: 'pending' },
  { key: 'pack', label: 'Preparing analysis pack', note: 'Assemble the final client-ready sections, tables, and exports.', status: 'pending' },
];

const scenarioKeys = ['base', 'upside', 'downside'];
const confidenceOrder = { high: 3, medium: 2, low: 1 };
const classificationOrder = { reported: 4, derived: 3, proposed: 2, review_required: 1, missing: 0 };

function createEmptyFiling() {
  return {
    inputMode: 'url',
    text: '',
    url: '',
    title: '',
  };
}

export default function App() {
  const [filing, setFiling] = useState(createEmptyFiling());
  const [baseline, setBaseline] = useState(defaultBaseline);
  const [status, setStatus] = useState({ configured: null, model: null });
  const [workflow, setWorkflow] = useState(workflowTemplate);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [error, setError] = useState('');
  const [reviewPacket, setReviewPacket] = useState(null);
  const [result, setResult] = useState(null);
  const [lastCompletedStage, setLastCompletedStage] = useState('');
  const [selectedScenario, setSelectedScenario] = useState('base');
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

  const filingReady = filing.inputMode === 'url' ? Boolean(filing.url.trim()) : filing.text.trim().length >= 1000;
  const activeMetadata = result?.filingMetadata || reviewPacket?.filingMetadata || null;
  const projectionLabels = useMemo(() => buildProjectionLabels(activeMetadata), [activeMetadata]);
  const selectedScenarioModel = result ? result.modelPack.scenarios[selectedScenario] : null;

  const summaryStats = useMemo(() => {
    if (!result) return [];
    return [
      { label: 'Base value / share', value: formatPerShare(result.modelPack.scenarios.base.valuation.valuePerShare) },
      { label: 'Base enterprise value', value: formatMoney(result.modelPack.scenarios.base.valuation.enterpriseValue) },
      { label: 'Filing type', value: result.filingMetadata.filingType || 'Needs review' },
      { label: 'Anchor period', value: result.filingMetadata.period || 'Needs review' },
    ];
  }, [result]);

  async function handleReviewFiling() {
    if (!filingReady || isReviewing) return;

    setError('');
    setReviewPacket(null);
    setResult(null);
    setIsReviewing(true);

    try {
      const response = await fetch('/api/review-filing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filing, baseline }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Could not review the filing.');

      setReviewPacket(payload);
      setBaseline(payload.baselineSuggested || baseline);
    } catch (reviewError) {
      setError(reviewError.message || 'Could not review the filing.');
    } finally {
      setIsReviewing(false);
    }
  }

  async function handleProcess() {
    if (!filingReady || isProcessing) return;

    setError('');
    setResult(null);
    setLastCompletedStage('');
    setWorkflow(workflowTemplate.map((step, index) => ({ ...step, status: index === 0 ? 'active' : 'pending' })));
    setIsProcessing(true);

    try {
      await streamProcess(
        { filing, baseline },
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
    } catch (processError) {
      setError(processError.message || 'Processing failed.');
    } finally {
      setIsProcessing(false);
    }
  }

  function updateFiling(next) {
    setFiling(next);
    setReviewPacket(null);
    setResult(null);
    setError('');
  }

  function handleReset() {
    setFiling(createEmptyFiling());
    setBaseline(defaultBaseline);
    setReviewPacket(null);
    setResult(null);
    setError('');
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
    setBaseline(sample.baseline || defaultBaseline);
    setReviewPacket(null);
    setResult(null);
    setError('');
  }

  async function handleCopy(kind) {
    if (!result) return;
    const projectionHeaders = buildProjectionLabels(result.filingMetadata);
    await navigator.clipboard.writeText(buildCopyPayload(kind, result, projectionHeaders));
    setCopyFeedback(copyLabel(kind));
  }

  function handleDownload(kind) {
    if (!result) return;
    const projectionHeaders = buildProjectionLabels(result.filingMetadata);
    const { filename, content } = buildCsvPayload(kind, result, projectionHeaders);
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
            <div className="eyebrow">10-Q / 10-K grounded analysis</div>
            <h1>Filing Model Workbench</h1>
            <p className="hero-copy">
              Load a single public filing, review the extracted base, and generate a filing-grounded model analysis pack with deterministic scenario math,
              valuation framing, and a disciplined caveat trail.
            </p>
          </div>
          <div className="hero-meta">
            <StatusPill configured={status.configured} model={status.model} />
            <div className="hero-stats">
              <StatTile label="Primary source" value="One 10-Q or 10-K" />
              <StatTile label="Output" value="Client-ready analysis pack" />
            </div>
          </div>
        </section>

        <section className="workspace-grid">
          <div className="left-column">
            <section className="card input-card">
              <div className="section-header">
                <div>
                  <div className="section-kicker">Step 1</div>
                  <h2>Load a filing</h2>
                </div>
                <button className="ghost-button" onClick={handleReset} disabled={isProcessing || isReviewing}>Reset</button>
              </div>

              <DocumentInputCard
                title="10-Q or 10-K"
                subtitle="Use a public SEC filing URL or paste filing text directly. PDF upload is intentionally deferred for v1 rather than faked."
                document={filing}
                required
                onChange={updateFiling}
                urlPlaceholder="https://www.sec.gov/Archives/.../company-filing.htm"
                textPlaceholder="Paste the filing text here"
              />

              <div className="samples-row">
                <div className="samples-label">Public SEC examples</div>
                <div className="sample-chips">
                  {sampleCases.map((sample) => (
                    <button key={sample.id} className="sample-chip" onClick={() => loadSample(sample)} disabled={isProcessing || isReviewing}>
                      <strong>{sample.label}</strong>
                      <span>{sample.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="action-row">
                <button className="secondary-button" onClick={handleReviewFiling} disabled={!filingReady || isReviewing || isProcessing}>
                  {isReviewing ? 'Reviewing filing…' : 'Review filing'}
                </button>
                <div className="inline-guidance">
                  The review step extracts the filing metadata, reported base, and the main disclosure signals before you lock the analysis pack.
                </div>
              </div>

              {error ? <div className="error-banner">{error}</div> : null}
            </section>

            <section className="card assumptions-card">
              <div className="section-header compact">
                <div>
                  <div className="section-kicker">Step 3</div>
                  <h2>Analyst baseline assumptions</h2>
                </div>
                <div className="card-badge">Editable</div>
              </div>

              <div className="inline-guidance assumption-guidance">
                These fields are your reviewable override layer. The filing review backfills explicit reported items where possible, then the AI proposes assumption framing, and deterministic math runs only after that review step.
              </div>

              {baselineGroups.map((group) => (
                <div key={group.title} className="assumption-group">
                  <div className="assumption-group-header">
                    <div className="assumption-group-title">{group.title}</div>
                    <div className="assumption-group-copy">{group.description}</div>
                  </div>

                  {group.revenueGrowth ? (
                    <div className="growth-grid">
                      {projectionLabels.map((label, index) => (
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
                  {isProcessing ? 'Building analysis pack…' : 'Generate analysis pack'}
                </button>
                <div className="inline-guidance">
                  The final pack stays filing-grounded. Deterministic scenario math remains fully code-driven.
                </div>
              </div>
            </section>

            <section className="card workflow-card">
              <div className="section-header compact">
                <div>
                  <div className="section-kicker">Step 4</div>
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
                {isProcessing ? `Current step: ${lastCompletedStage || 'Starting'}` : result ? 'Analysis pack complete' : 'Awaiting filing input'}
              </div>
            </section>
          </div>

          <div className="right-column">
            {!result ? (
              reviewPacket ? (
                <section className="card review-card">
                  <div className="section-kicker">Step 2</div>
                  <h2>Review extracted filing information</h2>
                  <p className="review-copy">
                    This preview isolates the filing metadata, reported base, derived read-through, and the disclosure set that will drive the drafted assumption layer.
                  </p>

                  <div className="report-header-grid review-meta-grid">
                    <MetaPill label="Company" value={reviewPacket.filingMetadata.company || 'Needs review'} />
                    <MetaPill label="Filing type" value={reviewPacket.filingMetadata.filingType || 'Needs review'} />
                    <MetaPill label="Period" value={reviewPacket.filingMetadata.period || 'Needs review'} />
                    <MetaPill label="Filing date" value={reviewPacket.filingMetadata.filingDate || 'Needs review'} />
                  </div>

                  <div className="review-block">
                    <div className="section-subtitle">Business overview</div>
                    <p className="executive-body">{reviewPacket.businessOverview?.summary}</p>
                  </div>

                  <div className="facts-grid compact-grid">
                    {(reviewPacket.reportedBase?.reportedFacts || []).slice(0, 8).map((fact, index) => (
                      <div key={`${fact.metric}-${index}`} className="fact-card">
                        <div className="fact-metric">{fact.metric}</div>
                        <div className="fact-value">{fact.valueText}</div>
                        <div className="fact-foot">{fact.category}</div>
                      </div>
                    ))}
                  </div>

                  {(reviewPacket.derivedMetrics || []).length ? (
                    <div className="table-wrap compact-spacing">
                      <table className="delta-table numeric-table">
                        <thead>
                          <tr>
                            <th>Derived metric</th>
                            <th>Value</th>
                            <th>Logic</th>
                            <th>Evidence</th>
                            <th>Confidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reviewPacket.derivedMetrics.map((item, index) => (
                            <tr key={`${item.metric}-${index}`}>
                              <td className="strong-cell">{item.metric}</td>
                              <td>{item.value}</td>
                              <td>{item.logic}</td>
                              <td>{item.evidence}</td>
                              <td><ConfidencePill confidence={item.confidence} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  <div className="review-columns two-column-grid">
                    <div className="split-panel">
                      <div className="split-header">Key filing takeaways</div>
                      <div className="stack-list">
                        {sortByClassificationAndConfidence(reviewPacket.keyTakeaways).slice(0, 6).map((item, index) => (
                          <div key={`${item.title}-${index}`} className="stack-item">
                            <div className="stack-text">{item.title}</div>
                            <div className="stack-support">{item.summary}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="split-panel">
                      <div className="split-header">Missing inputs to review</div>
                      <div className="stack-list">
                        {(reviewPacket.missingBaseInputs || []).length ? (
                          reviewPacket.missingBaseInputs.map((item, index) => (
                            <div key={`${item.field}-${index}`} className="stack-item">
                              <div className="stack-text">{item.field}</div>
                              <div className="stack-support">{item.reason}</div>
                            </div>
                          ))
                        ) : (
                          <div className="stack-item">
                            <div className="stack-text">No major gaps surfaced</div>
                            <div className="stack-support">The filing appears to provide enough base detail for a practical first-pass model frame.</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              ) : (
                <section className="card empty-state">
                  <div className="section-kicker">Output</div>
                  <h2>Filing-grounded work product appears here</h2>
                  <p>
                    Review the filing first, then generate a client-ready pack organized around business overview, model drivers, scenario analysis, valuation framing, and risks.
                  </p>
                  <div className="empty-grid">
                    <div className="empty-chip">Executive summary</div>
                    <div className="empty-chip">Business overview</div>
                    <div className="empty-chip">Reported base</div>
                    <div className="empty-chip">Scenario analysis</div>
                    <div className="empty-chip">Valuation summary</div>
                    <div className="empty-chip">Key risks</div>
                  </div>
                </section>
              )
            ) : (
              <>
                <section className="card report-hero">
                  <div className="report-hero-top">
                    <div>
                      <div className="section-kicker">Analysis pack</div>
                      <h2>{result.filingMetadata.company || result.filingMetadata.title || 'Filing-grounded analysis'}</h2>
                    </div>
                    <div className="action-cluster">
                      <button className="secondary-button" onClick={() => handleCopy('summary')}>Copy summary</button>
                      <button className="secondary-button" onClick={() => handleCopy('forecast')}>Copy forecast</button>
                      <button className="secondary-button" onClick={() => handleDownload('assumptions')}>Assumptions CSV</button>
                      <button className="secondary-button" onClick={() => handleDownload('forecast')}>Forecast CSV</button>
                      <button className="secondary-button" onClick={() => handleDownload('valuation')}>Valuation CSV</button>
                      <button className="secondary-button" onClick={() => window.print()}>Export report</button>
                    </div>
                  </div>

                  <div className="report-header-grid report-meta-grid">
                    <MetaPill label="Filing type" value={result.filingMetadata.filingType || 'Needs review'} />
                    <MetaPill label="Period" value={result.filingMetadata.period || 'Needs review'} />
                    <MetaPill label="Filing date" value={result.filingMetadata.filingDate || 'Needs review'} />
                    <MetaPill label="Source" value="Public filing" />
                  </div>

                  <div className="summary-stats-grid">
                    {summaryStats.map((item) => (
                      <StatTile key={item.label} label={item.label} value={item.value} />
                    ))}
                  </div>

                  {copyFeedback ? <div className="copy-feedback">{copyFeedback}</div> : null}
                </section>

                <SectionCard title="Executive summary" kicker="1" defaultOpen>
                  <div className="executive-headline">{result.executiveSummary?.headline}</div>
                  <p className="executive-body">{result.executiveSummary?.body}</p>
                  <ul className="bullet-list">
                    {(result.executiveSummary?.bullets || []).map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                </SectionCard>

                <SectionCard title="Business overview from filing" kicker="2" defaultOpen>
                  <p className="executive-body">{result.businessOverview?.summary}</p>
                  <div className="two-column-grid detail-grid">
                    <InfoList title="Business lines" items={result.businessOverview?.businessLines || []} emptyLabel="No explicit business-line summary extracted." />
                    <InfoList
                      title="Segment and geographic notes"
                      items={[
                        ...(result.businessOverview?.segmentNotes || []).map((item) => `${item.segment}: ${item.summary}`),
                        ...(result.businessOverview?.geographyNotes || []).map((item) => `${item.region}: ${item.summary}`),
                      ]}
                      emptyLabel="No segment or geographic notes surfaced cleanly from the filing."
                    />
                  </div>
                </SectionCard>

                <SectionCard title="Key filing takeaways" kicker="3" defaultOpen>
                  <div className="takeaway-grid">
                    {sortByClassificationAndConfidence(result.keyTakeaways).map((item, index) => (
                      <article key={`${item.title}-${index}`} className="takeaway-card">
                        <div className="takeaway-top">
                          <SourcePill source="filing" />
                          <div className="pill-group">
                            <ClassificationPill classification={item.classification} />
                            <ConfidencePill confidence={item.confidence} />
                          </div>
                        </div>
                        <h3>{item.title}</h3>
                        <p>{item.summary}</p>
                        <div className="source-block compact-source">{item.evidence}</div>
                      </article>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="What matters for the model" kicker="4" defaultOpen>
                  <p className="executive-body">{result.whatMattersForModel?.summary}</p>
                  <ul className="bullet-list compact-list">
                    {(result.whatMattersForModel?.bullets || []).map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>

                  <div className="takeaway-grid compact-spacing">
                    {sortByClassificationAndConfidence(result.whatMattersForModel?.drivers || []).map((item, index) => (
                      <article key={`${item.driver}-${index}`} className="evidence-card">
                        <div className="takeaway-top">
                          <span className="category-pill">{prettyCategory(item.driver)}</span>
                          <div className="pill-group">
                            <ClassificationPill classification={item.classification} />
                            <ConfidencePill confidence={item.confidence} />
                          </div>
                        </div>
                        <div className="stack-text">{item.takeaway}</div>
                        <div className="stack-support">{item.modelImplication}</div>
                        <div className="source-block">{item.evidence}</div>
                      </article>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Reported base and proposed assumptions" kicker="5" defaultOpen>
                  <p className="executive-body">{result.reportedBase?.summary}</p>

                  <div className="facts-grid">
                    {(result.reportedBase?.reportedFacts || []).slice(0, 8).map((fact, index) => (
                      <div key={`${fact.metric}-${index}`} className="fact-card">
                        <div className="fact-metric">{fact.metric}</div>
                        <div className="fact-value">{fact.valueText}</div>
                        <div className="fact-foot">{fact.category}</div>
                      </div>
                    ))}
                  </div>

                  {(result.proposedAssumptions || []).length ? (
                    <div className="table-wrap compact-spacing">
                      <table className="delta-table assumption-table numeric-table">
                        <thead>
                          <tr>
                            <th>Field</th>
                            <th>Proposed assumption</th>
                            <th>Rationale</th>
                            <th>Evidence</th>
                            <th>Review</th>
                            <th>Confidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.proposedAssumptions.map((row, index) => (
                            <tr key={`${row.field}-${index}`}>
                              <td className="strong-cell">{row.field}</td>
                              <td>{row.proposal}</td>
                              <td>{row.rationale}</td>
                              <td>{row.evidence}</td>
                              <td><ClassificationPill classification={row.reviewRequired ? 'review_required' : 'proposed'} /></td>
                              <td><ConfidencePill confidence={row.confidence} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  <div className="table-wrap compact-spacing">
                    <table className="delta-table assumption-table numeric-table">
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Analyst baseline</th>
                          <th>Filing read-through</th>
                          <th>Model implication</th>
                          <th>Status</th>
                          <th>Confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(result.assumptionReview || []).map((row, index) => (
                          <tr key={`${row.field}-${index}`}>
                            <td className="strong-cell">{row.field}</td>
                            <td>{row.currentBaseline}</td>
                            <td>{row.filingReadThrough}</td>
                            <td>{row.modelImplication}</td>
                            <td><ClassificationPill classification={row.status} /></td>
                            <td><ConfidencePill confidence={row.confidence} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {(result.missingBaseInputs || []).length ? (
                    <div className="missing-inputs-card compact-spacing">
                      <div className="section-subtitle">Open items still requiring judgment</div>
                      <ul className="bullet-list compact-list">
                        {result.missingBaseInputs.map((item, index) => (
                          <li key={`${item.field}-${index}`}><strong>{item.field}:</strong> {item.reason}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </SectionCard>

                <SectionCard title="Scenario analysis" kicker="6" defaultOpen>
                  <div className="scenario-grid three-up">
                    {scenarioKeys.map((scenarioKey) => (
                      <article key={scenarioKey} className={`scenario-summary-card ${scenarioKey}`}>
                        <div className="scenario-label">{capitalize(scenarioKey)} case</div>
                        <div className="scenario-summary-copy">{result.scenarioWriteups?.[scenarioKey]?.summary || result.modelPack.scenarios[scenarioKey].narrative?.summary}</div>
                        <ul className="bullet-list compact-list inside-card">
                          {(result.scenarioWriteups?.[scenarioKey]?.bullets || result.modelPack.scenarios[scenarioKey].narrative?.keyAssumptions || []).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </article>
                    ))}
                  </div>

                  <div className="section-controls compact-spacing">
                    <div className="scenario-toggle horizontal-toggle">
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
                    <div className="mini-note">Projection headers are shown in fiscal-year estimate format where the filing period allows a reasonable forward-year inference.</div>
                  </div>

                  <div className="table-wrap compact-spacing">
                    <table className="forecast-table numeric-table">
                      <thead>
                        <tr>
                          <th>Metric</th>
                          {projectionLabels.map((label) => (
                            <th key={label} className="numeric-cell">{label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {forecastMetricRows(selectedScenarioModel).map((row) => (
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
                  <p className="executive-body">{result.valuationSummary?.summary}</p>
                  <ul className="bullet-list compact-list">
                    {(result.valuationSummary?.bullets || []).map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>

                  {(result.valuationSummary?.scenarioStructure || []).length ? (
                    <div className="missing-inputs-card compact-spacing">
                      <div className="section-subtitle">Scenario structure</div>
                      <ul className="bullet-list compact-list">
                        {result.valuationSummary.scenarioStructure.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="valuation-grid three-up compact-spacing">
                    <ValuationCard title="Base case" valuation={result.modelPack.scenarios.base.valuation} tone="base" />
                    <ValuationCard title="Upside case" valuation={result.modelPack.scenarios.upside.valuation} tone="upside" />
                    <ValuationCard title="Downside case" valuation={result.modelPack.scenarios.downside.valuation} tone="downside" />
                  </div>
                </SectionCard>

                <SectionCard title="Key sensitivities" kicker="8" defaultOpen>
                  <div className="two-column-grid detail-grid">
                    <div className="split-panel">
                      <div className="split-header">Primary sensitivities</div>
                      <div className="stack-list">
                        {(result.keySensitivities || []).map((item, index) => (
                          <div key={`${item.factor}-${index}`} className="stack-item">
                            <div className="stack-text">{item.factor}</div>
                            <div className="stack-support">{item.implication}</div>
                            <ConfidencePill confidence={item.confidence} />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="split-panel">
                      <div className="split-header">Valuation framing</div>
                      <div className="stack-list">
                        {(result.valuationSummary?.bridgeDrivers || []).map((item, index) => (
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

                  <div className="sensitivity-card compact-spacing">
                    <div className="section-subtitle">Base-case enterprise value sensitivity</div>
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
                                <td key={`${terminalValue}-${cellIndex}`} className="numeric-cell">{formatMoney(cell)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="Key risks and watch items" kicker="9" defaultOpen>
                  <div className="two-column-grid detail-grid">
                    <InfoList
                      title="Key risks"
                      items={(result.risksAndWatchItems || []).filter((item) => item.type === 'risk').map((item) => `${item.item}: ${item.whyItMatters}`)}
                      emptyLabel="No major risks were isolated cleanly from the filing text."
                    />
                    <InfoList
                      title="Watch items"
                      items={(result.risksAndWatchItems || []).filter((item) => item.type === 'watch_item').map((item) => `${item.item}: ${item.whyItMatters}`)}
                      emptyLabel="No distinct watch items were isolated beyond the core risk set."
                    />
                  </div>
                </SectionCard>

                <SectionCard title="Review flags" kicker="10">
                  <div className="stack-list">
                    {(result.reviewFlags || []).map((flag, index) => (
                      <div key={`${flag.item}-${index}`} className="stack-item flagged-item">
                        <div className="stack-text">{flag.item}</div>
                        <div className="stack-support">{flag.reason}</div>
                        <div className="source-block">{flag.evidence}</div>
                        <ConfidencePill confidence={flag.confidence} />
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Analyst checklist" kicker="11">
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
                  {result.sourceAppendix?.methodology ? (
                    <div className="missing-inputs-card compact-spacing">
                      <div className="section-subtitle">Methodology</div>
                      <p className="executive-body">{result.sourceAppendix.methodology}</p>
                      {(result.sourceAppendix.caveats || []).length ? (
                        <ul className="bullet-list compact-list">
                          {result.sourceAppendix.caveats.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  <SourceAppendixCard title="Filing" source={result.sources.filing} />
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
        <button className={document.inputMode === 'url' ? 'mode-button active' : 'mode-button'} onClick={() => onChange({ ...document, inputMode: 'url' })} type="button">
          Load URL
        </button>
        <button className={document.inputMode === 'text' ? 'mode-button active' : 'mode-button'} onClick={() => onChange({ ...document, inputMode: 'text' })} type="button">
          Paste text
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
          className="document-textarea"
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
      <div className="source-preview appendix-text">{source.fullText}</div>
    </details>
  );
}

function InfoList({ title, items, emptyLabel }) {
  return (
    <div className="split-panel">
      <div className="split-header">{title}</div>
      <div className="stack-list">
        {items.length ? (
          items.map((item, index) => (
            <div key={`${title}-${index}`} className="stack-item">
              <div className="stack-support">{item}</div>
            </div>
          ))
        ) : (
          <div className="stack-item">
            <div className="stack-support">{emptyLabel}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function SourcePill({ source }) {
  const label = source === 'filing' ? 'Filing' : source === 'integrated_model' ? 'Model layer' : source;
  return <span className={`source-pill ${source}`}>{label}</span>;
}

function ClassificationPill({ classification = 'derived' }) {
  return <span className={`classification-pill ${classification}`}>{classificationLabel(classification)}</span>;
}

function ValuationCard({ title, valuation, tone }) {
  return (
    <article className={`valuation-card ${tone}`}>
      <div className="scenario-label">{title}</div>
      <div className="valuation-main">{formatPerShare(valuation.valuePerShare)}</div>
      <div className="valuation-sub">Implied value per share</div>
      <div className="valuation-list compact-listing">
        <ValuationLine label="Enterprise value" value={formatMoney(valuation.enterpriseValue)} />
        <ValuationLine label="Equity value" value={formatMoney(valuation.equityValue)} />
        <ValuationLine label="WACC" value={formatPercent(valuation.wacc)} />
        <ValuationLine label="Terminal growth" value={formatPercent(valuation.terminalGrowth)} />
      </div>
    </article>
  );
}

function StatusPill({ configured, model }) {
  const label = configured ? 'Model engine ready' : configured === false ? 'Set GEMINI_API_KEY' : 'Checking model config';
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

function sortByClassificationAndConfidence(items) {
  return [...(items || [])].sort((a, b) => {
    const aClass = classificationOrder[a.classification] ?? classificationOrder[a.status] ?? 0;
    const bClass = classificationOrder[b.classification] ?? classificationOrder[b.status] ?? 0;
    if (bClass !== aClass) return bClass - aClass;
    return (confidenceOrder[b.confidence] || 0) - (confidenceOrder[a.confidence] || 0);
  });
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return `${Number(value).toFixed(1)}%`;
}

function formatMoney(value) {
  if (!Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  const abs = Math.abs(number);
  const digits = abs >= 100 ? 0 : 1;
  const formatted = abs.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  return number < 0 ? `($${formatted})` : `$${formatted}`;
}

function formatPerShare(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function prettyCategory(value = 'other') {
  return value.replace(/_/g, ' ');
}

function classificationLabel(value) {
  if (value === 'review_required') return 'review required';
  if (value === 'proposed') return 'proposed';
  return value.replace(/_/g, ' ');
}

function forecastMetricRows(scenarioModel) {
  const rows = [
    { label: 'Revenue', key: 'revenue', format: 'money' },
    { label: 'Revenue growth', key: 'revenueGrowth', format: 'percent' },
    { label: 'Gross margin', key: 'grossMargin', format: 'percent' },
    { label: 'Gross profit', key: 'grossProfit', format: 'money' },
    { label: 'Operating margin', key: 'operatingMargin', format: 'percent' },
    { label: 'Operating income', key: 'operatingIncome', format: 'money' },
    { label: 'EBITDA', key: 'ebitda', format: 'money' },
    { label: 'Tax rate', key: 'taxRate', format: 'percent' },
    { label: 'NOPAT', key: 'nopat', format: 'money' },
    { label: 'Capex', key: 'capex', format: 'money' },
    { label: 'D&A', key: 'da', format: 'money' },
    { label: 'Δ Working capital', key: 'deltaWorkingCapital', format: 'money' },
    { label: 'Free cash flow', key: 'freeCashFlow', format: 'money' },
  ];

  return rows.map((row) => ({
    label: row.label,
    values: (scenarioModel?.forecastTable || []).map((item) => (row.format === 'percent' ? formatPercent(item[row.key]) : formatMoney(item[row.key]))),
  }));
}

function buildProjectionLabels(metadata, count = horizonLabels.length) {
  const year = extractAnchorYear(metadata);
  if (!year) return horizonLabels;
  return Array.from({ length: count }, (_value, index) => `FY${year + index + 1}E`);
}

function extractAnchorYear(metadata) {
  const text = `${metadata?.period || ''} ${metadata?.filingDate || ''}`;
  const matches = [...text.matchAll(/(20\d{2})/g)].map((match) => Number(match[1]));
  return matches.at(-1) || null;
}

function buildCopyPayload(kind, result, projectionHeaders) {
  if (kind === 'summary') {
    return [
      result.executiveSummary?.headline,
      result.executiveSummary?.body,
      ...(result.executiveSummary?.bullets || []).map((bullet) => `• ${bullet}`),
    ].filter(Boolean).join('\n');
  }

  return buildForecastTsv(result, projectionHeaders);
}

function buildCsvPayload(kind, result, projectionHeaders) {
  if (kind === 'forecast') {
    return { filename: 'filing-forecast.csv', content: buildForecastCsv(result, projectionHeaders) };
  }
  if (kind === 'valuation') {
    return { filename: 'filing-valuation.csv', content: buildValuationCsv(result) };
  }
  return { filename: 'assumption-review.csv', content: buildAssumptionCsv(result) };
}

function buildAssumptionCsv(result) {
  const lines = ['Field,Analyst baseline,Filing read-through,Model implication,Status,Evidence,Confidence'];
  (result.assumptionReview || []).forEach((row) => {
    lines.push([
      row.field,
      row.currentBaseline,
      row.filingReadThrough,
      row.modelImplication,
      row.status,
      row.evidence,
      row.confidence,
    ].map(escapeCsv).join(','));
  });
  return lines.join('\n');
}

function buildForecastCsv(result, projectionHeaders) {
  const lines = ['Scenario,Metric,' + projectionHeaders.join(',')];
  scenarioKeys.forEach((scenarioKey) => {
    forecastMetricRows(result.modelPack.scenarios[scenarioKey]).forEach((row) => {
      lines.push([capitalize(scenarioKey), escapeCsv(row.label), ...row.values.map(escapeCsv)].join(','));
    });
  });
  return lines.join('\n');
}

function buildValuationCsv(result) {
  const lines = ['Scenario,Enterprise value,Equity value,Value per share,WACC,Terminal growth'];
  scenarioKeys.forEach((key) => {
    const valuation = result.modelPack.scenarios[key].valuation;
    lines.push([
      capitalize(key),
      valuation.enterpriseValue,
      valuation.equityValue,
      valuation.valuePerShare,
      valuation.wacc,
      valuation.terminalGrowth,
    ].map(escapeCsv).join(','));
  });
  return lines.join('\n');
}

function buildForecastTsv(result, projectionHeaders) {
  const rows = [['Scenario', 'Metric', ...projectionHeaders]];
  scenarioKeys.forEach((scenarioKey) => {
    forecastMetricRows(result.modelPack.scenarios[scenarioKey]).forEach((row) => {
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
  if (kind === 'summary') return 'Executive summary copied';
  return 'Forecast table copied';
}

function downloadLabel(kind) {
  if (kind === 'forecast') return 'Forecast CSV downloaded';
  if (kind === 'valuation') return 'Valuation CSV downloaded';
  return 'Assumption review CSV downloaded';
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
    throw new Error('Could not start the filing analysis workflow.');
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
