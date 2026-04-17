import { useEffect, useMemo, useState } from 'react';
import { formatDraftedBaselineValue, getBaselineFieldLabels, getBaselineFieldOrder, horizonLabels } from './assumptions';

const workflowTemplate = [
  { key: 'ingest', label: 'Ingesting filing', note: 'Fetch or normalize the 10-Q or 10-K text.', status: 'pending' },
  { key: 'extract', label: 'Extracting filing facts', note: 'Identify filing metadata, reported base metrics, and disclosure-driven takeaways.', status: 'pending' },
  { key: 'frame', label: 'Drafting baseline and model implications', note: 'Draft the full normalized model baseline directly from the filing, then frame scenarios and valuation context.', status: 'pending' },
  { key: 'forecast', label: 'Running deterministic model math', note: 'Roll the AI-drafted baseline through code-driven forecast and DCF logic.', status: 'pending' },
  { key: 'pack', label: 'Preparing analysis pack', note: 'Assemble the final client-ready sections, tables, and exports.', status: 'pending' },
];

const scenarioKeys = ['base', 'upside', 'downside'];
const moneyDisplayUnit = '$mm';
const perShareDisplayUnit = '$ / share';
const shareCountDisplayUnit = 'mm';
const confidenceOrder = { high: 3, medium: 2, low: 1 };
const classificationOrder = { reported: 4, derived: 3, proposed: 2, review_required: 1, missing: 0 };
const filingTypeOptions = ['10-Q', '10-K'];
const quarterOptions = ['Q1', 'Q2', 'Q3', 'Q4'];
const workflowStepDurationHintsMs = {
  ingest: 7000,
  extract: 18000,
  frame: 16000,
  forecast: 7000,
  pack: 14000,
};

function resolveWorkflowTerminalState(currentWorkflow, mode) {
  if (mode === 'success') return currentWorkflow.map((step) => ({ ...step, status: 'complete' }));
  return currentWorkflow.map((step) => ({
    ...step,
    status: step.status === 'active' ? 'failed' : step.status,
  }));
}

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
  const [runningDotCount, setRunningDotCount] = useState(1);
  const [activeWorkflowStepKey, setActiveWorkflowStepKey] = useState('');
  const [activeWorkflowStepStartedAt, setActiveWorkflowStepStartedAt] = useState(0);
  const [activeWorkflowStepProgress, setActiveWorkflowStepProgress] = useState(0);
  const [activeWorkflowProgressVisible, setActiveWorkflowProgressVisible] = useState(false);

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
    if (!isProcessing) {
      setRunningDotCount(1);
      return undefined;
    }

    const timer = setInterval(() => {
      setRunningDotCount((current) => (current % 3) + 1);
    }, 420);

    return () => clearInterval(timer);
  }, [isProcessing]);

  useEffect(() => {
    if (!isProcessing || !activeWorkflowStepKey || !activeWorkflowStepStartedAt) {
      return undefined;
    }

    const durationHint = workflowStepDurationHintsMs[activeWorkflowStepKey] || 12000;
    const updateStepProgress = () => {
      const elapsed = Date.now() - activeWorkflowStepStartedAt;
      const progress = Math.max(6, Math.min(95, Math.round((elapsed / durationHint) * 100)));
      setActiveWorkflowStepProgress(progress);
    };

    updateStepProgress();
    const timer = setInterval(updateStepProgress, 400);
    return () => clearInterval(timer);
  }, [activeWorkflowStepKey, activeWorkflowStepStartedAt, isProcessing]);

  const yearError = validateYearInput(filing.year);
  const filingReady = filing.inputMode === 'ticker'
    ? Boolean(filing.ticker?.trim()) && !yearError && (filing.formType !== '10-Q' || Boolean(filing.quarter))
    : filing.inputMode === 'url'
      ? Boolean(filing.url.trim())
      : filing.text.trim().length >= 1000;
  const activeMetadata = result?.filingMetadata || reviewPacket?.filingMetadata || null;
  const analysisMode = getAnalysisMode(result || reviewPacket);
  const activePack = getActivePack(result);
  const selectedScenarioModel = activePack?.scenarios?.[selectedScenario] || null;
  const projectionLabels = useMemo(
    () => buildProjectionLabels(activeMetadata, selectedScenarioModel?.forecastTable?.length || horizonLabels.length, analysisMode),
    [activeMetadata, selectedScenarioModel, analysisMode]
  );
  const needsReview = Boolean(result && (result.analysisStatus?.state === 'needs_review' || !activePack));
  const runningDots = '.'.repeat(runningDotCount);

  const heroMetrics = useMemo(() => buildHeroMetricsByMode({ result, analysisMode, activePack }), [result, analysisMode, activePack]);
  const projectionRows = useMemo(() => buildScenarioRowsByMode(selectedScenarioModel, analysisMode), [selectedScenarioModel, analysisMode]);

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

    const applyTerminalState = (mode, nextError = '') => {
      if (mode === 'error') setError(nextError || 'Processing failed.');
      setWorkflow((current) => resolveWorkflowTerminalState(current, mode));
      setActiveWorkflowStepProgress(mode === 'success' ? 100 : 0);
      if (mode === 'success') {
        setTimeout(() => {
          setActiveWorkflowProgressVisible(false);
          setActiveWorkflowStepKey('');
          setActiveWorkflowStepStartedAt(0);
        }, 800);
        return;
      }
      setActiveWorkflowProgressVisible(false);
      setActiveWorkflowStepKey('');
      setActiveWorkflowStepStartedAt(0);
    };

    setError('');
    setResult(null);
    setLastCompletedStage('');
    setWorkflow(workflowTemplate.map((step, index) => ({ ...step, status: index === 0 ? 'active' : 'pending' })));
    setActiveWorkflowStepKey(workflowTemplate[0].key);
    setActiveWorkflowStepStartedAt(Date.now());
    setActiveWorkflowStepProgress(6);
    setActiveWorkflowProgressVisible(true);
    setIsProcessing(true);

    try {
      await streamProcess(
        { filingRequest: buildFilingRequestPayload(filing) },
        {
          onStage: (payload) => {
            setLastCompletedStage(payload.label);
            setActiveWorkflowStepKey(payload.key);
            setActiveWorkflowStepStartedAt(Date.now());
            setActiveWorkflowStepProgress(6);
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
            applyTerminalState('success');
          },
          onError: (payload) => {
            applyTerminalState('error', payload.message || 'Processing failed.');
          },
        }
      );
    } catch (processError) {
      applyTerminalState('error', processError.message || 'Processing failed.');
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
    setActiveWorkflowStepKey('');
    setActiveWorkflowStepStartedAt(0);
    setActiveWorkflowStepProgress(0);
    setActiveWorkflowProgressVisible(false);
  }

  async function handleCopy(kind) {
    if (!result) return;
    const projectionHeaders = buildProjectionLabels(result.filingMetadata, selectedScenarioModel?.forecastTable?.length || horizonLabels.length, analysisMode);
    await navigator.clipboard.writeText(buildCopyPayload(kind, result, projectionHeaders));
    setCopyFeedback(copyLabel(kind));
  }

  function handleDownload(kind) {
    if (!result) return;
    const projectionHeaders = buildProjectionLabels(result.filingMetadata, selectedScenarioModel?.forecastTable?.length || horizonLabels.length, analysisMode);
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
        <section className="top-workspace-grid">
          <section className="card input-card premium-panel combined-intake-card">
            <div className="hero hero-premium combined-intake-hero">
              <div className="hero-copy-block combined-intake-copy-block">
                <div className="eyebrow">Agentic SEC filing-to-model workflow</div>
                <h1>10-Q / 10-K Model Workbench</h1>
                <p className="hero-copy">
                  Enter a ticker, select 10-Q or 10-K, choose the quarter when relevant, and generate a filing-grounded model and valuation view from the selected SEC filing.
                </p>
              </div>
            </div>

            <div className="section-header">
              <div>
                <div className="section-kicker">Step 1</div>
                <h2>Load a filing</h2>
              </div>
              <button className="ghost-button" onClick={handleReset} disabled={isProcessing || isReviewing}>Reset</button>
            </div>

            <DocumentInputCard
              title="10-Q or 10-K"
              subtitle="Enter a ticker, choose 10-Q or 10-K, add quarter selection when relevant, and generate a model and valuation view from a deterministically retrieved SEC filing."
              document={filing}
              yearError={yearError}
              onChange={updateFiling}
              tickerPlaceholder="AAPL"
            />

            <div className="action-row">
              <button className="primary-button" onClick={handleProcess} disabled={!filingReady || isProcessing}>
                {isProcessing ? 'Building model pack…' : 'Generate analysis pack'}
              </button>
            </div>

            {error ? <div className="error-banner">{error}</div> : null}
          </section>

          <section className="card workflow-card premium-panel top-panel-card">
            <div className="section-header compact">
              <div>
                <div className="section-kicker">Agentic Flow</div>
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
                  <div className="workflow-status-stack">
                    <div className="workflow-status">{renderStatusLabel(step.status, runningDots)}</div>
                    {step.status === 'active' && activeWorkflowProgressVisible ? <div className="workflow-progress">{activeWorkflowStepProgress}%</div> : null}
                  </div>
                </div>
              ))}
            </div>
            <div className="workflow-footer">
              {isProcessing
                ? `Current step: ${lastCompletedStage || `Starting${runningDots}`} • ${activeWorkflowStepProgress}% of step`
                : result
                  ? 'Model pack complete'
                  : 'Awaiting filing input'}
            </div>
          </section>
        </section>

        <section className="bottom-workspace">
          {!result ? (
            reviewPacket ? (
              <section className="card review-card premium-panel">
                <div className="section-kicker">Step 2</div>
                <h2>Review extracted filing snapshot</h2>
                <p className="review-copy">
                  This preview isolates the deterministic filing facts, the drafted baseline, and any review blockers before the valuation model runs.
                </p>

                <div className="report-header-grid review-meta-grid">
                  <MetaPill label="Company" value={resolveMetaValue(reviewPacket.filingMetadata.company)} />
                  <MetaPill label="Filing type" value={resolveMetaValue(reviewPacket.filingMetadata.filingType)} />
                  <MetaPill label="Mode" value={modeLabel(reviewPacket.analysisMode)} />
                  <MetaPill label="Period" value={resolvePeriodValue(reviewPacket.filingMetadata)} />
                  {reviewPacket.filingMetadata.fiscalQuarter ? <MetaPill label="Quarter" value={reviewPacket.filingMetadata.fiscalQuarter} /> : null}
                  <MetaPill label="Filing date" value={resolveMetaValue(reviewPacket.filingMetadata.filingDate)} />
                  <MetaPill label="Status" value={reviewPacket.analysisStatus?.state === 'needs_review' ? 'Needs review' : 'Ready'} />
                </div>

                <ReviewStatusPanel analysisStatus={reviewPacket.analysisStatus} missingBaseInputs={reviewPacket.missingBaseInputs} reviewFlags={reviewPacket.reviewFlags} compact />
                <NormalizedMetricsCard metrics={reviewPacket.reportedBase?.normalizedMetrics} assetManagerMetrics={reviewPacket.assetManagerMetrics} mode={getAnalysisMode(reviewPacket)} compact />
                <DraftedBaselineTable draftedBaseline={reviewPacket.draftedBaseline} draftedBaselineMeta={reviewPacket.draftedBaselineMeta} mode={getAnalysisMode(reviewPacket)} compact />
              </section>
            ) : (
              <section className="card empty-state premium-panel empty-state-model-first">
                <div className="section-kicker">Model-first output</div>
                <h2>Generate a model and valuation view from the latest SEC filing</h2>
                <p>
                  Once you run the analysis, the app will retrieve the filing, build the model, and surface the key valuation outputs in a client-ready layout.
                </p>
                <p>
                  Expect a concise model-first pack with scenario views, valuation framing, and filing-grounded assumptions once processing completes.
                </p>
              </section>
            )
          ) : (
            <>
              <section className="card report-hero report-slide-hero">
                <div className="report-context-strip">
                  <MetaPill label="Company" value={result.filingMetadata.company || result.filingMetadata.title || 'Filing-grounded analysis'} />
                  <MetaPill label="Filing type" value={resolveMetaValue(result.filingMetadata.filingType)} />
                  <MetaPill label="Mode" value={modeLabel(analysisMode)} />
                  <MetaPill label="Period" value={resolvePeriodValue(result.filingMetadata)} />
                  {result.filingMetadata.fiscalQuarter ? <MetaPill label="Quarter" value={result.filingMetadata.fiscalQuarter} /> : null}
                  <MetaPill label="Filing date" value={resolveMetaValue(result.filingMetadata.filingDate)} />
                  <MetaPill label="Status" value={needsReview ? 'Needs review' : modeReadyLabel(analysisMode)} />
                </div>

                <div className="report-hero-top report-hero-premium-top">
                  <div>
                    <div className="section-kicker gold-kicker">{needsReview ? 'Review required' : 'Instant model output'}</div>
                    {!needsReview ? <span className="live-pill">{modeLabel(analysisMode)}</span> : null}
                    <h2>{result.filingMetadata.company || result.filingMetadata.title || 'Filing-grounded analysis'}</h2>
                    <p className="hero-subcopy">
                      {needsReview
                        ? 'The filing was ingested, but key baseline inputs still need review before the app will present a valuation as complete.'
                        : 'A filing-grounded model and valuation frame with deterministic forecast math, disciplined scenario logic, and visible assumption classification.'}
                    </p>
                  </div>
                  <div className="action-cluster">
                    <button className="secondary-button" onClick={() => handleCopy('summary')}>Copy summary</button>
                    {!needsReview ? <button className="secondary-button" onClick={() => handleCopy('forecast')}>Copy forecast</button> : null}
                    <button className="secondary-button" onClick={() => handleDownload('assumptions')}>Assumptions CSV</button>
                    {!needsReview ? <button className="secondary-button" onClick={() => handleDownload('forecast')}>Forecast CSV</button> : null}
                    {!needsReview ? <button className="secondary-button" onClick={() => handleDownload('valuation')}>Valuation CSV</button> : null}
                    <button className="secondary-button" onClick={() => window.print()}>Export report</button>
                  </div>
                </div>

                {!needsReview ? (
                  <>
                    <div className="mini-note">Dollar-denominated model outputs are shown in {moneyDisplayUnit}. Per-share outputs are labeled separately as {perShareDisplayUnit}.</div>
                    <div className="summary-stats-grid hero-metrics-grid">
                      {heroMetrics.map((item) => (
                        <HeroMetricCard key={item.label} label={item.label} value={item.value} tone={item.tone} />
                      ))}
                    </div>
                  </>
                ) : null}

                {copyFeedback ? <div className="copy-feedback">{copyFeedback}</div> : null}
              </section>

              {needsReview ? (
                <>
                  <SectionCard title={`Needs review before valuation (${moneyDisplayUnit} unless noted)`} kicker="1" defaultOpen accent>
                    <ReviewStatusPanel analysisStatus={result.analysisStatus} missingBaseInputs={result.missingBaseInputs} reviewFlags={result.reviewFlags} />
                    <NormalizedMetricsCard metrics={result.reportedBase?.normalizedMetrics} assetManagerMetrics={result.assetManagerMetrics} mode={analysisMode} />
                  </SectionCard>

                  <SectionCard title={`Drafted baseline (${moneyDisplayUnit} unless noted)`} kicker="2" defaultOpen>
                    <DraftedBaselineTable draftedBaseline={result.draftedBaseline} draftedBaselineMeta={result.draftedBaselineMeta} mode={analysisMode} />
                  </SectionCard>

                  <SectionCard title="Executive summary" kicker="3" defaultOpen>
                    <div className="executive-headline">{result.executiveSummary?.headline}</div>
                    <p className="executive-body">{result.executiveSummary?.body}</p>
                    <ul className="bullet-list">
                      {(result.executiveSummary?.bullets || []).map((bullet) => <li key={bullet}>{bullet}</li>)}
                    </ul>
                  </SectionCard>
                </>
              ) : (
                <>
                  <SectionCard title={`${scenarioSectionTitle(analysisMode)} (${moneyDisplayUnit} unless noted)`} kicker="1" defaultOpen accent>
                    <div className="section-controls compact-spacing">
                      <div className="scenario-toggle horizontal-toggle">
                        {scenarioKeys.map((scenarioKey) => (
                          <button key={scenarioKey} className={selectedScenario === scenarioKey ? 'mode-button active' : 'mode-button'} onClick={() => setSelectedScenario(scenarioKey)} type="button">
                            {capitalize(scenarioKey)}
                          </button>
                        ))}
                      </div>
                      <div className="mini-note">{analysisMode === 'operating_company' ? 'Projection headers use fiscal-year estimate labels where the filing period supports a reasonable forward-year read-through.' : 'Current-period anchor labels are shown because this mode uses filing-supported valuation anchors rather than a full DCF forecast.'}</div>
                    </div>

                    <div className="mini-note">Dollar-denominated forecast lines are presented in {moneyDisplayUnit}. Per-share outputs stay labeled separately as {perShareDisplayUnit}.</div>

                    <div className="table-wrap compact-spacing premium-table-wrap">
                      <table className="forecast-table numeric-table elite-table">
                        <thead>
                          <tr>
                            <th>Metric</th>
                            {projectionLabels.map((label) => <th key={label} className="numeric-cell">{label}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {projectionRows.map((row) => (
                            <tr key={row.label}>
                              <td className="strong-cell">{row.label}</td>
                              {row.values.map((value, index) => <td key={`${row.label}-${index}`} className="numeric-cell">{value}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="scenario-grid three-up premium-scenario-grid">
                      {scenarioKeys.map((scenarioKey) => {
                        const scenarioPack = activePack?.scenarios?.[scenarioKey];
                        return (
                          <article key={scenarioKey} className={`scenario-summary-card scenario-hero-card ${scenarioKey}`}>
                            <div className="scenario-label">{capitalize(scenarioKey)} case</div>
                            <div className="scenario-summary-main">{formatScenarioHeadlineValue(scenarioPack?.valuation, analysisMode)}</div>
                            <div className="valuation-sub">{scenarioHeadlineLabel(analysisMode)}</div>
                            <div className="scenario-metric-grid">
                              {buildScenarioHighlights(scenarioPack, analysisMode).map((item) => (
                                <div key={`${scenarioKey}-${item.label}`} className="scenario-metric-item">
                                  <span>{item.label}</span>
                                  <strong>{item.value}</strong>
                                </div>
                              ))}
                            </div>
                            <div className="scenario-summary-copy">{result.scenarioWriteups?.[scenarioKey]?.summary || scenarioPack?.narrative?.summary}</div>
                            <ul className="bullet-list compact-list inside-card">
                              {(result.scenarioWriteups?.[scenarioKey]?.bullets || scenarioPack?.narrative?.keyAssumptions || []).map((item) => <li key={item}>{item}</li>)}
                            </ul>
                          </article>
                        );
                      })}
                    </div>
                  </SectionCard>

                  <SectionCard title={valuationSectionTitle(analysisMode)} kicker="2" defaultOpen accent>
                    <p className="executive-body valuation-lead">{result.valuationSummary?.summary}</p>
                    {analysisMode === 'operating_company' ? <div className="mini-note">Primary value uses a Gordon-growth DCF. The exit EBITDA multiple is shown automatically as a terminal cross-check, with no extra user input.</div> : null}
                    {analysisMode === 'asset_manager' ? <div className="mini-note">Asset Manager Mode blends supported FRE, distributable-earnings, and book / equity anchors, with weights renormalized when some anchors are missing.</div> : null}
                    {analysisMode === 'directional_only' ? <div className="mini-note">Directional Mode is not a full DCF. Numeric ranges are shown only when simple book / equity or earnings-like anchors are defensible.</div> : null}
                    <div className="mini-note">Enterprise value and equity value are shown in {moneyDisplayUnit}. Value / share remains labeled separately as {perShareDisplayUnit}.</div>
                    <div className="valuation-grid three-up compact-spacing premium-valuation-grid">
                      <ValuationCard title="Base case" valuation={activePack?.scenarios?.base?.valuation} tone="base" mode={analysisMode} />
                      <ValuationCard title="Upside case" valuation={activePack?.scenarios?.upside?.valuation} tone="upside" mode={analysisMode} />
                      <ValuationCard title="Downside case" valuation={activePack?.scenarios?.downside?.valuation} tone="downside" mode={analysisMode} />
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

                  {analysisMode === 'operating_company' && activePack?.baseSensitivity ? (
                    <SectionCard title={`Base-case enterprise value sensitivity (${moneyDisplayUnit})`} kicker="3" defaultOpen accent>
                      <div className="sensitivity-hero-card">
                        <div className="sensitivity-hero-copy">
                          <div className="section-subtitle">Key valuation artifact, enterprise value shown in {moneyDisplayUnit}</div>
                          <p className="executive-body">The base-case EV matrix frames valuation sensitivity against WACC and terminal growth, designed to surface the most decision-relevant range quickly.</p>
                        </div>
                        <div className="table-wrap compact-wrap premium-table-wrap sensitivity-matrix-wrap">
                          <table className="sensitivity-table numeric-table elite-table sensitivity-matrix-table">
                            <thead>
                              <tr>
                                <th>Terminal growth \\ WACC</th>
                                {activePack.baseSensitivity.waccValues.map((value) => <th key={value} className="numeric-cell">{formatPercent(value)}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {activePack.baseSensitivity.terminalGrowthValues.map((terminalValue, rowIndex) => (
                                <tr key={terminalValue}>
                                  <td className="strong-cell">{formatPercent(terminalValue)}</td>
                                  {activePack.baseSensitivity.matrix[rowIndex].map((cell, cellIndex) => <td key={`${terminalValue}-${cellIndex}`} className={`numeric-cell sensitivity-cell ${cellIndex === 1 && rowIndex === 1 ? 'midpoint' : ''}`}>{formatMoney(cell)}</td>)}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </SectionCard>
                  ) : null}

                  <SectionCard title={bridgeSectionTitle(analysisMode)} kicker="4" defaultOpen>
                    <div className="two-column-grid detail-grid">
                      <div className="split-panel premium-panel-soft">
                        <div className="split-header">{changeSectionTitle(analysisMode)} ({moneyDisplayUnit} unless noted)</div>
                        <div className="table-wrap compact-wrap premium-table-wrap">
                          <table className="delta-table numeric-table elite-table compact-finance-table">
                            <thead>
                              <tr>
                                <th>Metric / unit</th>
                                <th className="numeric-cell">{analysisMode === 'operating_company' ? 'Prior' : 'Base'}</th>
                                <th className="numeric-cell">{analysisMode === 'operating_company' ? 'Current' : 'Upside'}</th>
                                <th className="numeric-cell">{analysisMode === 'operating_company' ? 'Delta' : 'Change'}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {getChangeRows(activePack, analysisMode).map((row) => (
                                <tr key={row.metric}>
                                  <td className="strong-cell">{formatMetricLabel(row.metric, row.format)}</td>
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
                        <div className="split-header">{bridgeTableTitle(analysisMode)} ({moneyDisplayUnit})</div>
                        <div className="table-wrap compact-wrap premium-table-wrap">
                          <table className="delta-table numeric-table elite-table compact-finance-table">
                            <thead>
                              <tr>
                                <th>{analysisMode === 'operating_company' ? 'Bridge step' : 'Anchor family'}</th>
                                <th className="numeric-cell">{analysisMode === 'operating_company' ? `Enterprise value (${moneyDisplayUnit})` : `Anchor value (${moneyDisplayUnit})`}</th>
                                <th className="numeric-cell">{analysisMode === 'operating_company' ? `Delta (${moneyDisplayUnit})` : 'Weight'}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {getBridgeRows(activePack, analysisMode).map((row) => (
                                <tr key={row.key || row.label}>
                                  <td className="strong-cell">{row.label}</td>
                                  <td className="numeric-cell">{formatMoney(row.enterpriseValue)}</td>
                                  <td className="numeric-cell emphasis-cell">{formatBridgeDelta(row, analysisMode)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </SectionCard>

                  <SectionCard title={assumptionSectionTitle(analysisMode, moneyDisplayUnit)} kicker="5" defaultOpen>
                    <p className="executive-body">
                      {analysisMode === 'operating_company'
                        ? 'Hard numeric baseline fields are deterministic-first, while the AI is used for softer assumptions, commentary, and review notes.'
                        : analysisMode === 'asset_manager'
                          ? 'Asset Manager Mode keeps the baseline anchored to filing-supported AUM, earnings, equity, and capital-structure metrics rather than forcing an operating-company template.'
                          : 'Directional Mode keeps only the honest anchor set needed to explain a wide range, or why numeric valuation was withheld.'}
                    </p>
                    <DraftedBaselineTable draftedBaseline={result.draftedBaseline} draftedBaselineMeta={result.draftedBaselineMeta} mode={analysisMode} />
                  </SectionCard>

                  <SectionCard title="Executive summary" kicker="6" defaultOpen>
                    <div className="executive-headline">{result.executiveSummary?.headline}</div>
                    <p className="executive-body">{result.executiveSummary?.body}</p>
                    <ul className="bullet-list">
                      {(result.executiveSummary?.bullets || []).map((bullet) => <li key={bullet}>{bullet}</li>)}
                    </ul>
                  </SectionCard>
                </>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function DraftedBaselineTable({ draftedBaseline, draftedBaselineMeta, mode = 'operating_company', compact = false }) {
  if (!draftedBaseline) return null;
  const fieldOrder = getBaselineFieldOrder(mode);
  const fieldLabels = getBaselineFieldLabels(mode);
  return (
    <>
      <div className="mini-note">Dollar-denominated drafted inputs are shown in {moneyDisplayUnit}. Share counts stay labeled separately in {shareCountDisplayUnit}.</div>
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
            {fieldOrder.map((field) => {
              const meta = draftedBaselineMeta?.[field] || {};
              return (
                <tr key={field}>
                  <td className="strong-cell">{fieldLabels[field] || field}</td>
                  <td className="numeric-cell">{formatDraftedBaselineValue(field, draftedBaseline[field], mode)}</td>
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
    </>
  );
}

function ReviewStatusPanel({ analysisStatus, missingBaseInputs = [], reviewFlags = [], compact = false }) {
  const blockingIssues = analysisStatus?.blockingIssues || [];
  const checks = analysisStatus?.checks || [];
  return (
    <div className="missing-inputs-card compact-spacing premium-note-panel">
      <div className="section-subtitle">{analysisStatus?.state === 'needs_review' ? 'Needs review' : 'Validation status'}</div>
      <p className="executive-body">{analysisStatus?.summary || 'No review status available.'}</p>
      {blockingIssues.length ? (
        <ul className="bullet-list compact-list">
          {blockingIssues.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}
      {!blockingIssues.length && checks.length ? (
        <ul className="bullet-list compact-list">
          {checks.filter((check) => check.passed).slice(0, compact ? 3 : 6).map((check) => <li key={check.label}>{check.label}</li>)}
        </ul>
      ) : null}
      {missingBaseInputs.length ? (
        <div className="mini-note">Unresolved inputs: {missingBaseInputs.map((item) => item.field).join(', ')}</div>
      ) : null}
      {reviewFlags.length ? (
        <div className="mini-note">Review flags: {reviewFlags.slice(0, compact ? 2 : 4).map((item) => item.item).join(' • ')}</div>
      ) : null}
    </div>
  );
}

function NormalizedMetricsCard({ metrics, assetManagerMetrics, mode = 'operating_company', compact = false }) {
  const items = buildNormalizedMetricItems(metrics, assetManagerMetrics, mode);

  return (
    <div className="split-panel premium-panel-soft">
      <div className="split-header">{normalizedMetricTitle(mode)} ({moneyDisplayUnit} unless noted)</div>
      <div className="summary-stats-grid hero-metrics-grid">
        {items.slice(0, compact ? 6 : items.length).map((item) => (
          <HeroMetricCard key={item.label} label={item.label} value={item.value} tone="neutral" />
        ))}
      </div>
    </div>
  );
}

function DocumentInputCard({ title, subtitle, document, onChange, yearError, tickerPlaceholder }) {
  const showQuarterSelector = document.formType === '10-Q';

  return (
    <div className="document-card premium-panel-soft intake-card-primary">
      <div className="document-card-head">
        <div>
          <div className="document-title-row">
            <div className="document-title">{title}</div>
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
              <label className="control-label">Year</label>
              <input
                className={`text-input year-input ${yearError ? 'input-error' : ''}`}
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="2025"
                value={document.year || ''}
                onChange={(event) => onChange({ ...document, inputMode: 'ticker', year: event.target.value.replace(/[^0-9]/g, '') })}
              />
              {yearError ? <div className="field-help field-error">{yearError}</div> : null}
            </div>
          </div>

          <div className={`primary-controls-row primary-controls-row-bottom ${showQuarterSelector ? 'with-quarter' : 'without-quarter'}`}>
            <div className="control-group filing-type-control-group">
              <label className="control-label">Filing type</label>
              <select
                className="text-input select-input"
                value={document.formType || '10-Q'}
                onChange={(event) => onChange({
                  ...document,
                  inputMode: 'ticker',
                  formType: event.target.value,
                  quarter: event.target.value === '10-Q' ? document.quarter || 'Q1' : '',
                })}
              >
                {filingTypeOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>

            {showQuarterSelector ? (
              <div className="control-group quarter-control-group">
                <label className="control-label">Quarter</label>
                <select
                  className="text-input select-input"
                  value={document.quarter || 'Q1'}
                  onChange={(event) => onChange({ ...document, inputMode: 'ticker', quarter: event.target.value })}
                >
                  {quarterOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        </div>
      </div>
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

function ClassificationPill({ classification = 'derived' }) {
  return <span className={`classification-pill ${classification}`}>{classificationLabel(classification)}</span>;
}

function ValuationCard({ title, valuation, tone, mode = 'operating_company' }) {
  const exitCrossCheck = valuation?.methods?.exitMultipleCrossCheck;
  return (
    <article className={`valuation-card premium-valuation-card ${tone}`}>
      <div className="scenario-label">{title}</div>
      <div className="valuation-main">{formatScenarioHeadlineValue(valuation, mode)}</div>
      <div className="valuation-sub">{scenarioHeadlineLabel(mode)}</div>
      <div className="valuation-list compact-listing">
        {mode === 'operating_company' ? (
          <>
            <ValuationLine label={withUnitLabel('Enterprise value', moneyDisplayUnit)} value={formatMoney(valuation?.enterpriseValue)} />
            <ValuationLine label={withUnitLabel('Equity value', moneyDisplayUnit)} value={formatMoney(valuation?.equityValue)} />
            <ValuationLine label="WACC" value={formatPercent(valuation?.wacc)} />
            <ValuationLine label="Terminal growth" value={formatPercent(valuation?.terminalGrowth)} />
            <ValuationLine label="Terminal EV in DCF" value={formatMoney(valuation?.terminalValue)} />
            <ValuationLine label="Implied terminal EV / EBITDA" value={formatMultiple(valuation?.impliedTerminalEvEbitda)} />
            {exitCrossCheck ? <ValuationLine label="Exit cross-check / share" value={formatPerShare(exitCrossCheck.valuePerShare)} /> : null}
            {exitCrossCheck ? <ValuationLine label="Exit cross-check EV" value={formatMoney(exitCrossCheck.enterpriseValue)} /> : null}
            {exitCrossCheck ? <ValuationLine label="Exit EBITDA multiple" value={formatMultiple(exitCrossCheck.exitEbitdaMultiple)} /> : null}
          </>
        ) : (
          <>
            <ValuationLine label={withUnitLabel('Equity value', moneyDisplayUnit)} value={formatMoney(valuation?.equityValue)} />
            <ValuationLine label="Confidence" value={capitalize(String(valuation?.confidence || 'low'))} />
            <ValuationLine label="Method" value={valuation?.methodLabel || '—'} />
            {(valuation?.anchorBreakdown || []).slice(0, 3).map((anchor) => (
              <ValuationLine key={anchor.key || anchor.label} label={anchor.label} value={`${formatMultiple(anchor.multiple)} • ${formatPercent((anchor.weight || 0) * 100)}`} />
            ))}
          </>
        )}
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

function ConfidencePill({ confidence = 'medium' }) {
  return <span className={`confidence-pill ${confidence}`}>{confidence}</span>;
}

function MetaPill({ label, value }) {
  return <div className="meta-pill"><span>{label}</span><strong>{value}</strong></div>;
}

function ValuationLine({ label, value }) {
  return <div className="valuation-line"><span>{label}</span><strong>{value}</strong></div>;
}

function renderStatusLabel(status, runningDots = '.') {
  if (status === 'complete') return 'Done';
  if (status === 'active') return `Running${runningDots}`;
  if (status === 'failed') return 'Stopped';
  return 'Queued';
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

function formatMultiple(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}x`;
}

function formatCount(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatByType(value, format) {
  if (format === 'percent') return formatPercent(value);
  if (format === 'perShare') return formatPerShare(value);
  if (format === 'multiple') return formatMultiple(value);
  if (format === 'count') return formatCount(value);
  if (format === 'weight') return formatPercent(value);
  return formatMoney(value);
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function classificationLabel(value) {
  if (value === 'review_required') return 'review required';
  if (value === 'proposed') return 'proposed';
  return value.replace(/_/g, ' ');
}

function buildScenarioRowsByMode(scenarioModel, mode = 'operating_company') {
  if (mode === 'asset_manager') {
    const rows = [
      { label: 'AUM', key: 'aum', format: 'money' },
      { label: 'Fee-related earnings', key: 'feeRelatedEarnings', format: 'money' },
      { label: 'Distributable earnings', key: 'distributableEarnings', format: 'money' },
      { label: 'Book value', key: 'bookValue', format: 'money' },
      { label: 'Value / share', key: 'valuePerShare', format: 'perShare' },
    ];
    return rows
      .map((row) => ({ label: formatMetricLabel(row.label, row.format), values: (scenarioModel?.forecastTable || []).map((item) => formatValueForRow(item[row.key], row.format)) }))
      .filter((row) => row.values.some(hasRenderableValue));
  }
  if (mode === 'directional_only') {
    if (!(scenarioModel?.forecastTable || []).length) {
      return [{ label: 'Directional note', values: ['Numeric valuation withheld'] }];
    }
    const rows = [
      { label: 'Share count', key: 'shareCount', format: 'count' },
      { label: 'Book value', key: 'bookValue', format: 'money' },
      { label: 'Earnings-like anchor', key: 'earningsLikeAnchor', format: 'money' },
      { label: 'Selected multiple', key: 'selectedMultiple', format: 'multiple' },
      { label: 'Value / share', key: 'valuePerShare', format: 'perShare' },
    ];
    return rows
      .map((row) => ({ label: formatMetricLabel(row.label, row.format), values: (scenarioModel?.forecastTable || []).map((item) => formatValueForRow(item[row.key], row.format)) }))
      .filter((row) => row.values.some(hasRenderableValue));
  }

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

  return rows.map((row) => ({ label: formatMetricLabel(row.label, row.format), values: (scenarioModel?.forecastTable || []).map((item) => formatValueForRow(item[row.key], row.format)) }));
}

function buildScenarioHighlights(scenarioModel, mode = 'operating_company') {
  const finalYear = scenarioModel?.forecastTable?.at(-1) || null;
  if (mode === 'asset_manager') {
    return [
      { label: withUnitLabel('Equity value', moneyDisplayUnit), value: formatMoney(scenarioModel?.valuation?.equityValue) },
      { label: 'Anchor count', value: String(scenarioModel?.valuation?.availableAnchorCount ?? '—') },
      { label: 'Confidence', value: capitalize(String(scenarioModel?.valuation?.confidence || 'low')) },
      { label: 'Method', value: scenarioModel?.valuation?.methodLabel || '—' },
    ];
  }
  if (mode === 'directional_only') {
    return [
      { label: withUnitLabel('Equity value', moneyDisplayUnit), value: formatMoney(scenarioModel?.valuation?.equityValue) },
      { label: 'Anchor count', value: String(scenarioModel?.valuation?.availableAnchorCount ?? '—') },
      { label: 'Confidence', value: capitalize(String(scenarioModel?.valuation?.confidence || 'low')) },
      { label: 'Method', value: scenarioModel?.valuation?.methodLabel || 'Directional narrative only' },
    ];
  }
  return [
    { label: withUnitLabel('Enterprise value', moneyDisplayUnit), value: formatMoney(scenarioModel?.valuation?.enterpriseValue) },
    { label: 'FY+1 rev growth', value: formatPercent(scenarioModel?.forecastTable?.[0]?.revenueGrowth) },
    { label: 'FY+5 op margin', value: formatPercent(finalYear?.operatingMargin) },
    { label: withUnitLabel('FY+5 FCF', moneyDisplayUnit), value: formatMoney(finalYear?.freeCashFlow) },
  ];
}

function withUnitLabel(label, unit) {
  return `${label} (${unit})`;
}

function formatMetricLabel(label, format) {
  if (format === 'money') return withUnitLabel(label, moneyDisplayUnit);
  if (format === 'perShare') return withUnitLabel(label, perShareDisplayUnit);
  if (format === 'count') return withUnitLabel(label, shareCountDisplayUnit);
  return label;
}

function buildProjectionLabels(metadata, count = horizonLabels.length, mode = 'operating_company') {
  const resolvedCount = mode === 'operating_company' ? count : Math.max(count || 0, 1);
  if (mode !== 'operating_company') return Array.from({ length: resolvedCount }, (_value, index) => (index === 0 ? 'Current' : `Anchor ${index + 1}`));
  const year = extractAnchorYear(metadata);
  if (!year) return horizonLabels;
  return Array.from({ length: resolvedCount }, (_value, index) => `FY${year + index + 1}E`);
}

function extractAnchorYear(metadata) {
  const text = `${metadata?.period || ''} ${metadata?.filingDate || ''}`;
  const matches = [...text.matchAll(/(20\d{2})/g)].map((match) => Number(match[1]));
  return matches.at(-1) || null;
}

function joinNonEmpty(parts, separator = ' ') {
  return parts.filter(Boolean).join(separator).trim();
}

function resolvePeriodValue(filingMetadata = {}) {
  if (filingMetadata.period) return filingMetadata.period;
  if (filingMetadata.reportingPeriod) return filingMetadata.reportingPeriod;
  const quarterYear = joinNonEmpty([filingMetadata.fiscalQuarter, filingMetadata.fiscalYear]);
  if (quarterYear) return quarterYear;
  if (filingMetadata.fiscalYear) return String(filingMetadata.fiscalYear);
  return '—';
}

function resolveMetaValue(value, fallback = '—') {
  return value ? value : fallback;
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
  const mode = getAnalysisMode(result);
  const fieldOrder = getBaselineFieldOrder(mode);
  const fieldLabels = getBaselineFieldLabels(mode);
  const lines = ['Field / unit,Drafted value,Classification,Rationale,Evidence,Confidence'];
  fieldOrder.forEach((field) => {
    const meta = result.draftedBaselineMeta?.[field] || {};
    lines.push([
      fieldLabels[field] || field,
      formatDraftedBaselineValue(field, result.draftedBaseline?.[field], mode),
      meta.classification || 'review_required',
      meta.rationale || '',
      meta.evidence || '',
      meta.confidence || 'low',
    ].map(escapeCsv).join(','));
  });
  return lines.join('\n');
}

function buildForecastCsv(result, projectionHeaders) {
  const mode = getAnalysisMode(result);
  const activePack = getActivePack(result);
  const lines = ['Scenario,Metric / unit,' + projectionHeaders.join(',')];
  scenarioKeys.forEach((scenarioKey) => {
    buildScenarioRowsByMode(activePack?.scenarios?.[scenarioKey], mode).forEach((row) => {
      lines.push([capitalize(scenarioKey), escapeCsv(row.label), ...row.values.map(escapeCsv)].join(','));
    });
  });
  return lines.join('\n');
}

function buildValuationCsv(result) {
  const mode = getAnalysisMode(result);
  const activePack = getActivePack(result);
  if (mode === 'operating_company') {
    const lines = [`Scenario,Enterprise value (${moneyDisplayUnit}),Equity value (${moneyDisplayUnit}),Value per share (${perShareDisplayUnit}),WACC,Terminal growth,Terminal EV (${moneyDisplayUnit}),Implied terminal EV / EBITDA,Exit cross-check EV (${moneyDisplayUnit}),Exit cross-check value per share (${perShareDisplayUnit}),Exit EBITDA multiple`];
    scenarioKeys.forEach((key) => {
      const valuation = activePack?.scenarios?.[key]?.valuation || {};
      const exitCrossCheck = valuation.methods?.exitMultipleCrossCheck || {};
      lines.push([
        capitalize(key),
        valuation.enterpriseValue,
        valuation.equityValue,
        valuation.valuePerShare,
        valuation.wacc,
        valuation.terminalGrowth,
        valuation.terminalValue,
        valuation.impliedTerminalEvEbitda,
        exitCrossCheck.enterpriseValue,
        exitCrossCheck.valuePerShare,
        exitCrossCheck.exitEbitdaMultiple,
      ].map(escapeCsv).join(','));
    });
    return lines.join('\n');
  }

  const lines = ['Scenario,Method,Equity value ($mm),Value per share ($ / share),Confidence,Anchor breakdown'];
  scenarioKeys.forEach((key) => {
    const valuation = activePack?.scenarios?.[key]?.valuation || {};
    lines.push([
      capitalize(key),
      valuation.methodLabel || '',
      valuation.equityValue,
      valuation.valuePerShare,
      valuation.confidence || '',
      (valuation.anchorBreakdown || []).map((anchor) => `${anchor.label} ${anchor.multiple}x ${Math.round((anchor.weight || 0) * 100)}%`).join(' | '),
    ].map(escapeCsv).join(','));
  });
  return lines.join('\n');
}

function buildForecastTsv(result, projectionHeaders) {
  const mode = getAnalysisMode(result);
  const activePack = getActivePack(result);
  const rows = [['Scenario', 'Metric / unit', ...projectionHeaders]];
  scenarioKeys.forEach((scenarioKey) => {
    buildScenarioRowsByMode(activePack?.scenarios?.[scenarioKey], mode).forEach((row) => {
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
  let sawTerminalEvent = false;

  const processChunk = (chunk) => {
    const normalizedChunk = chunk.replace(/\r\n/g, '\n').trim();
    if (!normalizedChunk) return;

    const lines = normalizedChunk.split('\n');
    const eventLine = lines.find((line) => line.startsWith('event:'));
    const dataLines = lines.filter((line) => line.startsWith('data:'));
    if (!eventLine || !dataLines.length) return;

    const event = eventLine.replace('event:', '').trim();
    const payloadText = dataLines.map((line) => line.replace('data:', '').trim()).join('\n');
    const data = JSON.parse(payloadText);

    if (event === 'stage') handlers.onStage?.(data);
    if (event === 'result') {
      sawTerminalEvent = true;
      handlers.onResult?.(data);
    }
    if (event === 'error') {
      sawTerminalEvent = true;
      handlers.onError?.(data);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.replace(/\r\n/g, '\n').split('\n\n');
    buffer = chunks.pop() || '';
    chunks.forEach(processChunk);
  }

  buffer += decoder.decode();
  processChunk(buffer);

  if (!sawTerminalEvent) throw new Error('Processing ended before a final result or error event was received.');
}

function getAnalysisMode(packet) {
  return packet?.analysisMode || 'operating_company';
}

function getActivePack(result) {
  if (!result) return null;
  const mode = getAnalysisMode(result);
  if (mode === 'asset_manager') return result.assetManagerPack || null;
  if (mode === 'directional_only') return result.directionalPack || null;
  return result.modelPack || null;
}

function modeLabel(mode = 'operating_company') {
  if (mode === 'asset_manager') return 'Asset Manager Mode';
  if (mode === 'directional_only') return 'Directional Mode';
  return 'Operating Company Mode';
}

function modeReadyLabel(mode = 'operating_company') {
  if (mode === 'asset_manager') return 'Asset Manager Mode';
  if (mode === 'directional_only') return 'Directional Mode';
  return 'Model ready';
}

function buildHeroMetricsByMode({ result, analysisMode, activePack }) {
  if (!result || !activePack) return [];
  const valuationRange = activePack?.valuationSummary?.range || {};
  if (analysisMode === 'asset_manager') {
    const baseScenario = activePack?.scenarios?.base;
    const anchorSnapshot = Object.fromEntries((activePack?.anchorSnapshot || []).map((item) => [item.metric, item.value]));
    const freValue = anchorSnapshot['Fee-related earnings'];
    const deValue = anchorSnapshot['Distributable earnings'];
    return [
      { label: 'Base value / share', value: formatPerShare(baseScenario?.valuation?.valuePerShare), tone: 'base' },
      { label: withUnitLabel('Valuation range', perShareDisplayUnit), value: formatPerShareRange(valuationRange.low, valuationRange.high), tone: 'neutral' },
      { label: withUnitLabel('AUM', moneyDisplayUnit), value: formatMoney(anchorSnapshot.AUM), tone: 'neutral' },
      { label: withUnitLabel(Number.isFinite(freValue) ? 'FRE' : 'Distributable earnings', moneyDisplayUnit), value: formatMoney(Number.isFinite(freValue) ? freValue : deValue), tone: 'neutral' },
    ];
  }
  if (analysisMode === 'directional_only') {
    const baseScenario = activePack?.scenarios?.base;
    return [
      { label: Number.isFinite(baseScenario?.valuation?.valuePerShare) ? 'Base value / share' : 'Valuation output', value: Number.isFinite(baseScenario?.valuation?.valuePerShare) ? formatPerShare(baseScenario?.valuation?.valuePerShare) : 'Narrative only', tone: 'base' },
      { label: 'Valuation family', value: directionalFamilyLabel(baseScenario?.valuation), tone: 'neutral' },
      { label: 'Method', value: baseScenario?.valuation?.methodLabel || 'Directional narrative only', tone: 'neutral' },
      { label: 'Confidence', value: capitalize(String(baseScenario?.valuation?.confidence || 'low')), tone: 'neutral' },
    ];
  }
  const comparisonMap = Object.fromEntries((activePack?.comparison || []).map((row) => [row.metric, row]));
  return [
    { label: 'Base value / share', value: formatPerShare(activePack?.scenarios?.base?.valuation?.valuePerShare), tone: 'base' },
    { label: 'Base enterprise value', value: formatMoney(activePack?.scenarios?.base?.valuation?.enterpriseValue), tone: 'neutral' },
    { label: withUnitLabel('Valuation range', perShareDisplayUnit), value: formatPerShareRange(valuationRange.low, valuationRange.high), tone: 'neutral' },
    { label: 'FY+1 revenue growth', value: formatPercent(comparisonMap['FY+1 revenue growth']?.base), tone: 'neutral' },
    { label: withUnitLabel('FY+5 revenue', moneyDisplayUnit), value: formatMoney(comparisonMap['FY+5 revenue']?.base), tone: 'neutral' },
    { label: 'FY+5 operating margin', value: formatPercent(comparisonMap['FY+5 operating margin']?.base), tone: 'neutral' },
  ];
}

function buildNormalizedMetricItems(metrics, assetManagerMetrics, mode) {
  if (mode === 'asset_manager') {
    return [
      { label: withUnitLabel('AUM', moneyDisplayUnit), value: formatMoney(assetManagerMetrics?.aum?.value) },
      { label: withUnitLabel('FRE', moneyDisplayUnit), value: formatMoney(assetManagerMetrics?.feeRelatedEarnings?.value) },
      { label: withUnitLabel('Distributable earnings', moneyDisplayUnit), value: formatMoney(assetManagerMetrics?.distributableEarnings?.value) },
      { label: withUnitLabel('Book value', moneyDisplayUnit), value: formatMoney(assetManagerMetrics?.bookValue?.value) },
      { label: withUnitLabel('Share count', shareCountDisplayUnit), value: formatCount(metrics?.shareCount ?? assetManagerMetrics?.shareCount?.value) },
      { label: withUnitLabel('Net debt / (cash)', moneyDisplayUnit), value: formatMoney(assetManagerMetrics?.netDebt?.value ?? metrics?.netDebt) },
    ];
  }
  if (mode === 'directional_only') {
    return [
      { label: withUnitLabel('Share count', shareCountDisplayUnit), value: formatCount(metrics?.shareCount ?? assetManagerMetrics?.shareCount?.value) },
      { label: withUnitLabel('Book value', moneyDisplayUnit), value: formatMoney(assetManagerMetrics?.bookValue?.value) },
      { label: withUnitLabel('Cash', moneyDisplayUnit), value: formatMoney(metrics?.cash ?? assetManagerMetrics?.cash?.value) },
      { label: withUnitLabel('Debt', moneyDisplayUnit), value: formatMoney(metrics?.debt ?? assetManagerMetrics?.debt?.value) },
      { label: withUnitLabel('Net debt / (cash)', moneyDisplayUnit), value: formatMoney(metrics?.netDebt ?? assetManagerMetrics?.netDebt?.value) },
    ];
  }
  return [
    { label: withUnitLabel('Revenue base', moneyDisplayUnit), value: formatMoney(metrics?.revenueLtm) },
    { label: 'Gross margin', value: formatPercent(metrics?.grossMarginPct) },
    { label: 'Operating margin', value: formatPercent(metrics?.operatingMarginPct) },
    { label: 'Tax rate', value: formatPercent(metrics?.taxRatePct) },
    { label: 'Capex / revenue', value: formatPercent(metrics?.capexPctRevenue) },
    { label: 'D&A / revenue', value: formatPercent(metrics?.daPctRevenue) },
    { label: 'Operating WC / revenue', value: formatPercent(metrics?.operatingWorkingCapitalPct) },
    { label: withUnitLabel('Diluted shares', shareCountDisplayUnit), value: formatCount(metrics?.shareCount) },
    { label: withUnitLabel('Cash', moneyDisplayUnit), value: formatMoney(metrics?.cash) },
    { label: withUnitLabel('Debt', moneyDisplayUnit), value: formatMoney(metrics?.debt) },
    { label: withUnitLabel('Net debt / (cash)', moneyDisplayUnit), value: formatMoney(metrics?.netDebt) },
  ];
}

function normalizedMetricTitle(mode) {
  if (mode === 'asset_manager') return 'Extracted asset-manager metrics';
  if (mode === 'directional_only') return 'Extracted directional anchor set';
  return 'Deterministic extracted base metrics';
}

function scenarioHeadlineLabel(mode) {
  if (mode === 'asset_manager') return 'Implied value / share, blended anchor range';
  if (mode === 'directional_only') return 'Implied value / share, directional range';
  return 'Implied value / share, Gordon-growth DCF';
}

function formatScenarioHeadlineValue(valuation, mode) {
  if (mode !== 'operating_company' && !Number.isFinite(valuation?.valuePerShare)) return 'Narrative only';
  return formatPerShare(valuation?.valuePerShare);
}

function valuationSectionTitle(mode) {
  if (mode === 'asset_manager') return 'Anchor breakdown';
  if (mode === 'directional_only') return 'Directional valuation details';
  return 'Valuation frame';
}

function scenarioSectionTitle(mode) {
  if (mode === 'asset_manager') return 'Valuation overview';
  if (mode === 'directional_only') return 'Directional valuation frame';
  return 'Scenario overview';
}

function bridgeSectionTitle(mode) {
  if (mode === 'asset_manager') return `Anchor bridge and key deltas (${moneyDisplayUnit} unless noted)`;
  if (mode === 'directional_only') return `Directional anchor bridge and key deltas (${moneyDisplayUnit} unless noted)`;
  return `Valuation bridge and key deltas (${moneyDisplayUnit} unless noted)`;
}

function changeSectionTitle(mode) {
  if (mode === 'asset_manager') return 'Anchor comparison';
  if (mode === 'directional_only') return 'Directional comparison';
  return 'Change vs prior';
}

function bridgeTableTitle(mode) {
  if (mode === 'asset_manager') return 'Anchor weight bridge';
  if (mode === 'directional_only') return 'Directional anchor bridge';
  return 'Valuation bridge';
}

function assumptionSectionTitle(mode, unit) {
  if (mode === 'asset_manager') return `AI-drafted valuation inputs (${unit} unless noted)`;
  if (mode === 'directional_only') return `Directional baseline assumptions (${unit} unless noted)`;
  return `AI-drafted model assumptions (${unit} unless noted)`;
}

function getChangeRows(activePack, mode) {
  if (!activePack) return [];
  if (mode === 'asset_manager' || mode === 'directional_only') {
    const comparison = activePack.comparison || [];
    return comparison.map((row) => ({
      metric: row.metric,
      prior: row.base,
      revised: row.upside,
      delta: Number.isFinite(row.upside) && Number.isFinite(row.base) ? row.upside - row.base : null,
      format: row.format === 'count' ? 'count' : row.format,
    }));
  }
  return activePack.changeVsPrior || [];
}

function getBridgeRows(activePack, mode) {
  if (!activePack) return [];
  if (mode === 'asset_manager') return (activePack.anchorWeights || []).map((row) => ({ ...row, enterpriseValue: row.enterpriseValue, delta: row.delta }));
  if (mode === 'directional_only') {
    return (activePack.scenarios?.base?.valuation?.anchorBreakdown || []).map((anchor) => ({
      key: anchor.key,
      label: anchor.label,
      enterpriseValue: anchor.equityValue,
      delta: anchor.weight * 100,
      format: 'weight',
    }));
  }
  return activePack.valuationBridge || [];
}

function formatBridgeDelta(row, mode) {
  if (mode === 'asset_manager' || mode === 'directional_only') return formatPercent(row.delta);
  return formatMoney(row.delta);
}

function formatValueForRow(value, format) {
  return formatByType(value, format);
}

function hasRenderableValue(value) {
  return value !== '—' && value !== '' && value !== null && value !== undefined;
}

function formatPerShareRange(low, high) {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return '—';
  return `${formatPerShare(low)} to ${formatPerShare(high)}`;
}

function directionalFamilyLabel(valuation = {}) {
  if (valuation?.methodLabel?.toLowerCase().includes('book')) return 'Book / equity';
  if (valuation?.methodLabel?.toLowerCase().includes('earnings')) return 'Earnings-like';
  return 'Narrative only';
}
