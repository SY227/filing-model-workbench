import { useEffect, useMemo, useState } from 'react';
import { baselineFieldLabels, baselineFieldOrder, formatDraftedBaselineValue, horizonLabels } from './assumptions';
import { sampleCases } from './samples';

const workflowTemplate = [
  { key: 'ingest', label: 'Ingesting filing', note: 'Fetch or normalize the 10-Q or 10-K text.', status: 'pending' },
  { key: 'extract', label: 'Extracting filing facts', note: 'Identify filing metadata, reported base metrics, and disclosure-driven takeaways.', status: 'pending' },
  { key: 'frame', label: 'Drafting baseline and model implications', note: 'Draft the full normalized model baseline directly from the filing, then frame scenarios and valuation context.', status: 'pending' },
  { key: 'forecast', label: 'Running deterministic model math', note: 'Roll the AI-drafted baseline through code-driven forecast and DCF logic.', status: 'pending' },
  { key: 'pack', label: 'Preparing analysis pack', note: 'Assemble the final client-ready sections, tables, and exports.', status: 'pending' },
];

const scenarioKeys = ['base', 'upside', 'downside'];
const confidenceOrder = { high: 3, medium: 2, low: 1 };
const classificationOrder = { reported: 4, derived: 3, proposed: 2, review_required: 1, missing: 0 };
const filingTypeOptions = ['10-Q', '10-K'];
const quarterOptions = ['Q1', 'Q2', 'Q3', 'Q4'];

function createEmptyFiling() {
  return { inputMode: 'ticker', ticker: '', formType: '10-Q', quarter: 'Q1', year: '', text: '', url: '', title: '' };
}

export default function App() {
  const [filing, setFiling] = useState(createEmptyFiling());
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

  const yearError = validateYearInput(filing.year);
  const filingReady = filing.inputMode === 'ticker'
    ? Boolean(filing.ticker?.trim()) && !yearError && (filing.formType !== '10-Q' || Boolean(filing.quarter))
    : filing.inputMode === 'url'
      ? Boolean(filing.url.trim())
      : filing.text.trim().length >= 1000;
  const activeMetadata = result?.filingMetadata || reviewPacket?.filingMetadata || null;
  const projectionLabels = useMemo(() => buildProjectionLabels(activeMetadata), [activeMetadata]);
  const selectedScenarioModel = result ? result.modelPack.scenarios[selectedScenario] : null;

  const heroMetrics = useMemo(() => {
    if (!result) return [];
    const comparisonMap = Object.fromEntries((result.modelPack.comparison || []).map((row) => [row.metric, row]));
    const valuationRange = result.modelPack.valuationSummary?.range || {};
    return [
      { label: 'Base value / share', value: formatPerShare(result.modelPack.scenarios.base.valuation.valuePerShare), tone: 'primary' },
      { label: 'Base enterprise value', value: formatMoney(result.modelPack.scenarios.base.valuation.enterpriseValue), tone: 'neutral' },
      { label: 'Valuation range', value: `${formatPerShare(valuationRange.low)} to ${formatPerShare(valuationRange.high)}`, tone: 'neutral' },
      { label: 'FY+1 revenue growth', value: formatPercent(comparisonMap['FY+1 revenue growth']?.base), tone: 'neutral' },
      { label: 'FY+5 revenue', value: formatMoney(comparisonMap['FY+5 revenue']?.base), tone: 'neutral' },
      { label: 'FY+5 operating margin', value: formatPercent(comparisonMap['FY+5 operating margin']?.base), tone: 'neutral' },
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
        body: JSON.stringify({ filingRequest: buildFilingRequestPayload(filing) }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Could not review the filing.');
      setReviewPacket(payload);
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
        { filingRequest: buildFilingRequestPayload(filing) },
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
    setReviewPacket(null);
    setResult(null);
    setError('');
    setWorkflow(workflowTemplate);
    setLastCompletedStage('');
    setSelectedScenario('base');
  }

  function loadSample(sample) {
    setFiling(sample.filing);
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
        <section className="hero hero-premium card">
          <div className="hero-copy-block">
            <div className="eyebrow">Ticker-first model output from a 10-Q or 10-K</div>
            <h1>Filing Model Workbench</h1>
            <p className="hero-copy">
              Enter a ticker, choose the filing type, target the quarter when you are working off a 10-Q, and generate a model and valuation view from a deterministically retrieved SEC filing.
            </p>
          </div>
          <div className="hero-meta">
            <StatusPill configured={status.configured} model={status.model} />
            <div className="hero-stats">
              <StatTile label="Primary source" value="Public filing" />
              <StatTile label="Core output" value="Instant model + valuation view" />
            </div>
          </div>
        </section>

        <section className="workspace-grid">
          <div className="left-column">
            <section className="card input-card premium-panel">
              <div className="section-header">
                <div>
                  <div className="section-kicker">Step 1</div>
                  <h2>Load a filing</h2>
                </div>
                <button className="ghost-button" onClick={handleReset} disabled={isProcessing || isReviewing}>Reset</button>
              </div>

              <DocumentInputCard
                title="10-Q or 10-K"
                subtitle="Enter a ticker, choose 10-Q or 10-K, add quarter selection when relevant, and generate a model and valuation view from a deterministically retrieved SEC filing. Advanced manual input stays available if you want to override retrieval."
                document={filing}
                required
                yearError={yearError}
                onChange={updateFiling}
                tickerPlaceholder="AAPL"
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
                <button className="primary-button" onClick={handleProcess} disabled={!filingReady || isProcessing}>
                  {isProcessing ? 'Building model pack…' : 'Generate analysis pack'}
                </button>
              </div>

              <div className="inline-guidance">
                Enter ticker, keep the filing type and quarter precise, and let the system retrieve the matching SEC filing automatically. Year stays optional when you want to target a specific filing window.
              </div>

              {error ? <div className="error-banner">{error}</div> : null}
            </section>

            <section className="card workflow-card premium-panel">
              <div className="section-header compact">
                <div>
                  <div className="section-kicker">Workflow status</div>
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
                {isProcessing ? `Current step: ${lastCompletedStage || 'Starting'}` : result ? 'Model pack complete' : 'Awaiting filing input'}
              </div>
            </section>
          </div>

          <div className="right-column">
            {!result ? (
              reviewPacket ? (
                <section className="card review-card premium-panel">
                  <div className="section-kicker">Step 2</div>
                  <h2>Review extracted filing snapshot</h2>
                  <p className="review-copy">
                    This preview isolates the filing metadata, reported base, and the internally drafted model baseline that will feed the deterministic model and valuation output.
                  </p>

                  <div className="report-header-grid review-meta-grid">
                    <MetaPill label="Company" value={reviewPacket.filingMetadata.company || 'Needs review'} />
                    <MetaPill label="Filing type" value={reviewPacket.filingMetadata.filingType || 'Needs review'} />
                    <MetaPill label="Period" value={reviewPacket.filingMetadata.period || 'Needs review'} />
                    {reviewPacket.filingMetadata.fiscalQuarter ? <MetaPill label="Quarter" value={reviewPacket.filingMetadata.fiscalQuarter} /> : null}
                    <MetaPill label="Filing date" value={reviewPacket.filingMetadata.filingDate || 'Needs review'} />
                  </div>

                  <DraftedBaselineTable draftedBaseline={reviewPacket.draftedBaseline} draftedBaselineMeta={reviewPacket.draftedBaselineMeta} compact />
                </section>
              ) : (
                <section className="card empty-state premium-panel empty-state-model-first">
                  <div className="section-kicker">Model-first output</div>
                  <h2>Generate a model and valuation view from the latest SEC filing</h2>
                  <p>
                    Enter a ticker, choose 10-Q or 10-K, and add the quarter for 10-Q work so the system can retrieve the right SEC filing before building the model pack.
                  </p>
                  <div className="empty-grid model-first-grid">
                    <div className="empty-chip">Model headline summary</div>
                    <div className="empty-chip">Scenario cases</div>
                    <div className="empty-chip">Valuation range</div>
                    <div className="empty-chip">EV sensitivity</div>
                    <div className="empty-chip">Drafted assumptions</div>
                    <div className="empty-chip">Filing takeaways</div>
                  </div>
                </section>
              )
            ) : (
              <>
                <section className="card report-hero report-slide-hero">
                  <div className="report-context-strip">
                    <MetaPill label="Company" value={result.filingMetadata.company || result.filingMetadata.title || 'Filing-grounded analysis'} />
                    <MetaPill label="Filing type" value={result.filingMetadata.filingType || 'Needs review'} />
                    <MetaPill label="Period" value={result.filingMetadata.period || 'Needs review'} />
                    {result.filingMetadata.fiscalQuarter ? <MetaPill label="Quarter" value={result.filingMetadata.fiscalQuarter} /> : null}
                    <MetaPill label="Filing date" value={result.filingMetadata.filingDate || 'Needs review'} />
                    <MetaPill label="Source" value="Public filing" />
                  </div>

                  <div className="report-hero-top report-hero-premium-top">
                    <div>
                      <div className="section-kicker gold-kicker">Instant model output</div>
                      <h2>{result.filingMetadata.company || result.filingMetadata.title || 'Filing-grounded analysis'}</h2>
                      <p className="hero-subcopy">A filing-grounded model and valuation frame with deterministic forecast math, disciplined scenario logic, and visible assumption classification.</p>
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

                  <div className="summary-stats-grid hero-metrics-grid">
                    {heroMetrics.map((item) => (
                      <HeroMetricCard key={item.label} label={item.label} value={item.value} tone={item.tone} />
                    ))}
                  </div>

                  {copyFeedback ? <div className="copy-feedback">{copyFeedback}</div> : null}
                </section>

                <SectionCard title="Scenario overview" kicker="1" defaultOpen accent>
                  <div className="scenario-grid three-up premium-scenario-grid">
                    {scenarioKeys.map((scenarioKey) => (
                      <article key={scenarioKey} className={`scenario-summary-card scenario-hero-card ${scenarioKey}`}>
                        <div className="scenario-label">{capitalize(scenarioKey)} case</div>
                        <div className="scenario-summary-main">{formatPerShare(result.modelPack.scenarios[scenarioKey].valuation.valuePerShare)}</div>
                        <div className="scenario-metric-grid">
                          {buildScenarioHighlights(result.modelPack.scenarios[scenarioKey]).map((item) => (
                            <div key={`${scenarioKey}-${item.label}`} className="scenario-metric-item">
                              <span>{item.label}</span>
                              <strong>{item.value}</strong>
                            </div>
                          ))}
                        </div>
                        <div className="scenario-summary-copy">{result.scenarioWriteups?.[scenarioKey]?.summary || result.modelPack.scenarios[scenarioKey].narrative?.summary}</div>
                        <ul className="bullet-list compact-list inside-card">
                          {(result.scenarioWriteups?.[scenarioKey]?.bullets || result.modelPack.scenarios[scenarioKey].narrative?.keyAssumptions || []).map((item) => <li key={item}>{item}</li>)}
                        </ul>
                      </article>
                    ))}
                  </div>

                  <div className="section-controls compact-spacing">
                    <div className="scenario-toggle horizontal-toggle">
                      {scenarioKeys.map((scenarioKey) => (
                        <button key={scenarioKey} className={selectedScenario === scenarioKey ? 'mode-button active' : 'mode-button'} onClick={() => setSelectedScenario(scenarioKey)} type="button">
                          {capitalize(scenarioKey)}
                        </button>
                      ))}
                    </div>
                    <div className="mini-note">Projection headers use fiscal-year estimate labels where the filing period supports a reasonable forward-year read-through.</div>
                  </div>

                  <div className="table-wrap compact-spacing premium-table-wrap">
                    <table className="forecast-table numeric-table elite-table">
                      <thead>
                        <tr>
                          <th>Metric</th>
                          {projectionLabels.map((label) => <th key={label} className="numeric-cell">{label}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {forecastMetricRows(selectedScenarioModel).map((row) => (
                          <tr key={row.label}>
                            <td className="strong-cell">{row.label}</td>
                            {row.values.map((value, index) => <td key={`${row.label}-${index}`} className="numeric-cell">{value}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>

                <SectionCard title="Valuation frame" kicker="2" defaultOpen accent>
                  <p className="executive-body valuation-lead">{result.valuationSummary?.summary}</p>
                  <div className="valuation-grid three-up compact-spacing premium-valuation-grid">
                    <ValuationCard title="Base case" valuation={result.modelPack.scenarios.base.valuation} tone="base" />
                    <ValuationCard title="Upside case" valuation={result.modelPack.scenarios.upside.valuation} tone="upside" />
                    <ValuationCard title="Downside case" valuation={result.modelPack.scenarios.downside.valuation} tone="downside" />
                  </div>

                  {(result.valuationSummary?.scenarioStructure || []).length ? (
                    <div className="missing-inputs-card compact-spacing premium-note-panel">
                      <div className="section-subtitle">Scenario structure</div>
                      <ul className="bullet-list compact-list">
                        {result.valuationSummary.scenarioStructure.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </SectionCard>

                <SectionCard title="Base-case enterprise value sensitivity" kicker="3" defaultOpen accent>
                  <div className="sensitivity-hero-card">
                    <div className="sensitivity-hero-copy">
                      <div className="section-subtitle">Key valuation artifact</div>
                      <p className="executive-body">The base-case EV matrix frames valuation sensitivity against WACC and terminal growth, designed to surface the most decision-relevant range quickly.</p>
                    </div>
                    <div className="table-wrap compact-wrap premium-table-wrap sensitivity-matrix-wrap">
                      <table className="sensitivity-table numeric-table elite-table sensitivity-matrix-table">
                        <thead>
                          <tr>
                            <th>Terminal growth \\ WACC</th>
                            {result.modelPack.baseSensitivity.waccValues.map((value) => <th key={value} className="numeric-cell">{formatPercent(value)}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {result.modelPack.baseSensitivity.terminalGrowthValues.map((terminalValue, rowIndex) => (
                            <tr key={terminalValue}>
                              <td className="strong-cell">{formatPercent(terminalValue)}</td>
                              {result.modelPack.baseSensitivity.matrix[rowIndex].map((cell, cellIndex) => <td key={`${terminalValue}-${cellIndex}`} className={`numeric-cell sensitivity-cell ${cellIndex === 1 && rowIndex === 1 ? 'midpoint' : ''}`}>{formatMoney(cell)}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="Valuation bridge and key deltas" kicker="4" defaultOpen>
                  <div className="two-column-grid detail-grid">
                    <div className="split-panel premium-panel-soft">
                      <div className="split-header">Change vs prior</div>
                      <div className="table-wrap compact-wrap premium-table-wrap">
                        <table className="delta-table numeric-table elite-table compact-finance-table">
                          <thead>
                            <tr>
                              <th>Metric</th>
                              <th className="numeric-cell">Prior</th>
                              <th className="numeric-cell">Current</th>
                              <th className="numeric-cell">Delta</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(result.modelPack.changeVsPrior || []).map((row) => (
                              <tr key={row.metric}>
                                <td className="strong-cell">{row.metric}</td>
                                <td className="numeric-cell">{formatByType(row.prior, row.format)}</td>
                                <td className="numeric-cell">{formatByType(row.revised, row.format)}</td>
                                <td className="numeric-cell emphasis-cell">{formatByType(row.delta, row.format)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div className="split-panel premium-panel-soft">
                      <div className="split-header">Valuation bridge</div>
                      <div className="table-wrap compact-wrap premium-table-wrap">
                        <table className="delta-table numeric-table elite-table compact-finance-table">
                          <thead>
                            <tr>
                              <th>Bridge step</th>
                              <th className="numeric-cell">Enterprise value</th>
                              <th className="numeric-cell">Delta</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(result.modelPack.valuationBridge || []).map((row) => (
                              <tr key={row.key}>
                                <td className="strong-cell">{row.label}</td>
                                <td className="numeric-cell">{formatMoney(row.enterpriseValue)}</td>
                                <td className="numeric-cell emphasis-cell">{formatMoney(row.delta)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="AI-drafted model assumptions" kicker="5" defaultOpen>
                  <p className="executive-body">
                    Gemini drafts the normalized model baseline directly from the filing. Deterministic forecast and valuation math run from this baseline, with uncertainty kept visible and classified field by field.
                  </p>
                  <DraftedBaselineTable draftedBaseline={result.draftedBaseline} draftedBaselineMeta={result.draftedBaselineMeta} />
                </SectionCard>

                <SectionCard title="Executive summary" kicker="6" defaultOpen>
                  <div className="executive-headline">{result.executiveSummary?.headline}</div>
                  <p className="executive-body">{result.executiveSummary?.body}</p>
                  <ul className="bullet-list">
                    {(result.executiveSummary?.bullets || []).map((bullet) => <li key={bullet}>{bullet}</li>)}
                  </ul>
                </SectionCard>

                <SectionCard title="Business overview from filing" kicker="7">
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

                <SectionCard title="Key filing takeaways" kicker="8">
                  <div className="takeaway-grid">
                    {sortByClassificationAndConfidence(result.keyTakeaways).map((item, index) => (
                      <article key={`${item.title}-${index}`} className="takeaway-card premium-panel-soft">
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

                <SectionCard title="What matters for the model" kicker="9">
                  <p className="executive-body">{result.whatMattersForModel?.summary}</p>
                  <ul className="bullet-list compact-list">
                    {(result.whatMattersForModel?.bullets || []).map((bullet) => <li key={bullet}>{bullet}</li>)}
                  </ul>

                  <div className="takeaway-grid compact-spacing">
                    {sortByClassificationAndConfidence(result.whatMattersForModel?.drivers || []).map((item, index) => (
                      <article key={`${item.driver}-${index}`} className="evidence-card premium-panel-soft">
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

                <SectionCard title="Key sensitivities" kicker="10">
                  <div className="two-column-grid detail-grid">
                    <div className="split-panel premium-panel-soft">
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
                    <div className="split-panel premium-panel-soft">
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
                </SectionCard>

                <SectionCard title="Key risks and watch items" kicker="11">
                  <div className="two-column-grid detail-grid">
                    <InfoList title="Key risks" items={(result.risksAndWatchItems || []).filter((item) => item.type === 'risk').map((item) => `${item.item}: ${item.whyItMatters}`)} emptyLabel="No major risks were isolated cleanly from the filing text." />
                    <InfoList title="Watch items" items={(result.risksAndWatchItems || []).filter((item) => item.type === 'watch_item').map((item) => `${item.item}: ${item.whyItMatters}`)} emptyLabel="No distinct watch items were isolated beyond the core risk set." />
                  </div>
                </SectionCard>

                <SectionCard title="Review flags" kicker="12">
                  <div className="stack-list">
                    {(result.reviewFlags || []).map((flag, index) => (
                      <div key={`${flag.item}-${index}`} className="stack-item flagged-item premium-panel-soft">
                        <div className="stack-text">{flag.item}</div>
                        <div className="stack-support">{flag.reason}</div>
                        <div className="source-block">{flag.evidence}</div>
                        <ConfidencePill confidence={flag.confidence} />
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Analyst checklist" kicker="13">
                  <div className="checklist-grid">
                    {(result.checklist || []).map((item, index) => (
                      <div key={`${item.task}-${index}`} className="check-card premium-panel-soft">
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

                <SectionCard title="Source appendix" kicker="14">
                  {result.sourceAppendix?.methodology ? (
                    <div className="missing-inputs-card compact-spacing premium-note-panel">
                      <div className="section-subtitle">Methodology</div>
                      <p className="executive-body">{result.sourceAppendix.methodology}</p>
                      {(result.sourceAppendix.caveats || []).length ? (
                        <ul className="bullet-list compact-list">
                          {result.sourceAppendix.caveats.map((item) => <li key={item}>{item}</li>)}
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

function DraftedBaselineTable({ draftedBaseline, draftedBaselineMeta, compact = false }) {
  if (!draftedBaseline) return null;
  return (
    <div className="table-wrap compact-spacing premium-table-wrap">
      <table className={`delta-table assumption-table numeric-table elite-table ${compact ? 'compact-table' : ''}`}>
        <thead>
          <tr>
            <th>Field</th>
            <th>Drafted value</th>
            <th>Classification</th>
            <th>Rationale</th>
            <th>Evidence</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {baselineFieldOrder.map((field) => {
            const meta = draftedBaselineMeta?.[field] || {};
            return (
              <tr key={field}>
                <td className="strong-cell">{baselineFieldLabels[field] || field}</td>
                <td className="numeric-cell">{formatDraftedBaselineValue(field, draftedBaseline[field])}</td>
                <td><ClassificationPill classification={meta.classification || 'review_required'} /></td>
                <td>{meta.rationale || '—'}</td>
                <td>{meta.evidence || '—'}</td>
                <td><ConfidencePill confidence={meta.confidence || 'low'} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DocumentInputCard({ title, subtitle, document, onChange, required = false, yearError, tickerPlaceholder, urlPlaceholder, textPlaceholder }) {
  const showQuarterSelector = document.formType === '10-Q';

  return (
    <div className="document-card premium-panel-soft intake-card-primary">
      <div className="document-card-head">
        <div>
          <div className="document-title-row">
            <div className="document-title">{title}</div>
            {required ? <span className="required-pill">Required</span> : <span className="optional-pill">Optional</span>}
          </div>
          <div className="document-copy">{subtitle}</div>
        </div>
      </div>

      <div className="primary-input-block">
        <div className="primary-input-copy">
          <div className="section-subtitle emphasis-subtitle">Primary retrieval</div>
          <div className="primary-input-title">Enter ticker</div>
          <div className="mini-note">Enter ticker, keep filing type on one clean row, choose the quarter for 10-Q retrieval, and optionally add a year. Leave year blank to retrieve the latest matching filing.</div>
        </div>

        <div className="primary-controls-stack">
          <div className="primary-controls-row primary-controls-row-top">
            <div className="control-group ticker-control-group">
              <label className="control-label">Ticker</label>
              <input
                className="text-input ticker-input"
                type="text"
                placeholder={tickerPlaceholder}
                value={document.ticker || ''}
                onChange={(event) => onChange({ ...document, inputMode: 'ticker', ticker: event.target.value.toUpperCase() })}
              />
            </div>

            <div className="control-group year-control-group year-control-group-top">
              <label className="control-label">Year (optional)</label>
              <input
                className={`text-input year-input ${yearError ? 'input-error' : ''}`}
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="2025"
                value={document.year || ''}
                onChange={(event) => onChange({ ...document, inputMode: 'ticker', year: event.target.value.replace(/[^0-9]/g, '') })}
              />
              <div className={`field-help ${yearError ? 'field-error' : ''}`}>{yearError || 'Optional. Use a 4-digit year to search within that calendar year.'}</div>
            </div>
          </div>

          <div className={`primary-controls-row primary-controls-row-bottom ${showQuarterSelector ? 'with-quarter' : 'without-quarter'}`}>
            {showQuarterSelector ? (
              <div className="control-group quarter-control-group">
                <label className="control-label">Quarter</label>
                <div className="mini-switch filing-quarter-switch">
                  {quarterOptions.map((option) => (
                    <button
                      key={option}
                      className={document.quarter === option ? 'mode-button active' : 'mode-button'}
                      onClick={() => onChange({ ...document, inputMode: 'ticker', quarter: option })}
                      type="button"
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <div className="field-help">Quarter-aware retrieval is only used for 10-Q filings.</div>
              </div>
            ) : null}

            <div className="control-group filing-type-control-group">
              <label className="control-label">Filing type</label>
              <div className="mini-switch filing-type-switch">
                {filingTypeOptions.map((option) => (
                  <button
                    key={option}
                    className={document.formType === option ? 'mode-button active' : 'mode-button'}
                    onClick={() => onChange({
                      ...document,
                      inputMode: 'ticker',
                      formType: option,
                      quarter: option === '10-Q' ? document.quarter || 'Q1' : '',
                    })}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <details className="advanced-inputs-card">
        <summary>
          <div>
            <div className="section-subtitle">Advanced input</div>
            <div className="advanced-input-title">Manual filing URL or pasted text</div>
          </div>
          <span className="summary-hint">Open</span>
        </summary>

        <div className="mini-note advanced-note">Use this only when you want to override ticker-based SEC retrieval.</div>

        <div className="mini-switch advanced-switch">
          <button className={document.inputMode === 'url' ? 'mode-button active' : 'mode-button'} onClick={() => onChange({ ...document, inputMode: 'url' })} type="button">Filing URL</button>
          <button className={document.inputMode === 'text' ? 'mode-button active' : 'mode-button'} onClick={() => onChange({ ...document, inputMode: 'text' })} type="button">Paste filing text</button>
        </div>

        {document.inputMode === 'text' ? (
          <textarea className="document-textarea" placeholder={textPlaceholder} value={document.text || ''} onChange={(event) => onChange({ ...document, inputMode: 'text', text: event.target.value })} />
        ) : (
          <input className="text-input" type="url" placeholder={urlPlaceholder} value={document.url || ''} onChange={(event) => onChange({ ...document, inputMode: 'url', url: event.target.value })} />
        )}
      </details>
    </div>
  );
}

function SectionCard({ title, kicker, children, defaultOpen = false, accent = false }) {
  return (
    <details className={`card section-card premium-panel ${accent ? 'section-accent' : ''}`} open={defaultOpen}>
      <summary>
        <div>
          <div className={`section-kicker ${accent ? 'gold-kicker' : ''}`}>{kicker}</div>
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
    <details className="appendix-card premium-panel-soft" open={false}>
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
    <div className="split-panel premium-panel-soft">
      <div className="split-header">{title}</div>
      <div className="stack-list">
        {items.length ? items.map((item, index) => <div key={`${title}-${index}`} className="stack-item"><div className="stack-support">{item}</div></div>) : <div className="stack-item"><div className="stack-support">{emptyLabel}</div></div>}
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
    <article className={`valuation-card premium-valuation-card ${tone}`}>
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

function HeroMetricCard({ label, value, tone = 'neutral' }) {
  return (
    <div className={`hero-metric-card ${tone}`}>
      <div className="hero-metric-label">{label}</div>
      <div className="hero-metric-value">{value}</div>
    </div>
  );
}

function StatusPill({ configured, model }) {
  const label = configured ? 'Model engine ready' : configured === false ? 'Set GEMINI_API_KEY' : 'Checking model config';
  return <div className={`status-pill ${configured ? 'ready' : configured === false ? 'warning' : ''}`}><span>{label}</span>{model ? <strong>{model}</strong> : null}</div>;
}

function ConfidencePill({ confidence = 'medium' }) {
  return <span className={`confidence-pill ${confidence}`}>{confidence}</span>;
}

function PriorityPill({ priority = 'medium' }) {
  return <span className={`priority-pill ${priority}`}>{priority} priority</span>;
}

function MetaPill({ label, value }) {
  return <div className="meta-pill"><span>{label}</span><strong>{value}</strong></div>;
}

function StatTile({ label, value }) {
  return <div className="stat-tile"><span>{label}</span><strong>{value}</strong></div>;
}

function ValuationLine({ label, value }) {
  return <div className="valuation-line"><span>{label}</span><strong>{value}</strong></div>;
}

function renderStatusLabel(status) {
  if (status === 'complete') return 'Done';
  if (status === 'active') return 'Running';
  return 'Queued';
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

function formatByType(value, format) {
  if (format === 'percent') return formatPercent(value);
  if (format === 'perShare') return formatPerShare(value);
  return formatMoney(value);
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

  return rows.map((row) => ({ label: row.label, values: (scenarioModel?.forecastTable || []).map((item) => (row.format === 'percent' ? formatPercent(item[row.key]) : formatMoney(item[row.key]))) }));
}

function buildScenarioHighlights(scenarioModel) {
  const finalYear = scenarioModel?.forecastTable?.at(-1) || null;
  return [
    { label: 'Enterprise value', value: formatMoney(scenarioModel?.valuation?.enterpriseValue) },
    { label: 'FY+1 rev growth', value: formatPercent(scenarioModel?.forecastTable?.[0]?.revenueGrowth) },
    { label: 'FY+5 op margin', value: formatPercent(finalYear?.operatingMargin) },
    { label: 'FY+5 FCF', value: formatMoney(finalYear?.freeCashFlow) },
  ];
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

function validateYearInput(year) {
  const value = String(year || '').trim();
  if (!value) return '';
  if (!/^\d{4}$/.test(value)) return 'Enter a 4-digit year, like 2025, or leave it blank for latest.';
  const numeric = Number(value);
  if (numeric < 1994 || numeric > 2100) return 'Enter a valid 4-digit filing year, or leave it blank for latest.';
  return '';
}

function buildFilingRequestPayload(filing) {
  if (filing.inputMode === 'ticker') {
    return {
      mode: 'ticker_lookup',
      ticker: filing.ticker?.trim() || '',
      filingType: filing.formType || '10-Q',
      quarter: filing.formType === '10-Q' ? filing.quarter || 'Q1' : null,
      year: filing.year?.trim() ? Number(filing.year) : null,
    };
  }

  if (filing.inputMode === 'url') {
    return {
      mode: 'url',
      url: filing.url?.trim() || '',
    };
  }

  return {
    mode: 'text',
    text: filing.text || '',
  };
}

function buildCopyPayload(kind, result, projectionHeaders) {
  if (kind === 'summary') {
    return [result.executiveSummary?.headline, result.executiveSummary?.body, ...(result.executiveSummary?.bullets || []).map((bullet) => `• ${bullet}`)].filter(Boolean).join('\n');
  }
  return buildForecastTsv(result, projectionHeaders);
}

function buildCsvPayload(kind, result, projectionHeaders) {
  if (kind === 'forecast') return { filename: 'filing-forecast.csv', content: buildForecastCsv(result, projectionHeaders) };
  if (kind === 'valuation') return { filename: 'filing-valuation.csv', content: buildValuationCsv(result) };
  return { filename: 'drafted-assumptions.csv', content: buildAssumptionCsv(result) };
}

function buildAssumptionCsv(result) {
  const lines = ['Field,Drafted value,Classification,Rationale,Evidence,Confidence'];
  baselineFieldOrder.forEach((field) => {
    const meta = result.draftedBaselineMeta?.[field] || {};
    lines.push([
      baselineFieldLabels[field] || field,
      formatDraftedBaselineValue(field, result.draftedBaseline?.[field]),
      meta.classification || 'review_required',
      meta.rationale || '',
      meta.evidence || '',
      meta.confidence || 'low',
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
    lines.push([capitalize(key), valuation.enterpriseValue, valuation.equityValue, valuation.valuePerShare, valuation.wacc, valuation.terminalGrowth].map(escapeCsv).join(','));
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
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) return `"${stringValue.replace(/"/g, '""')}"`;
  return stringValue;
}

function copyLabel(kind) {
  if (kind === 'summary') return 'Executive summary copied';
  return 'Forecast table copied';
}

function downloadLabel(kind) {
  if (kind === 'forecast') return 'Forecast CSV downloaded';
  if (kind === 'valuation') return 'Valuation CSV downloaded';
  return 'Drafted assumptions CSV downloaded';
}

async function streamProcess(payload, handlers) {
  const response = await fetch('/api/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) throw new Error('Could not start the filing analysis workflow.');

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
