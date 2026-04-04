'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────
interface TopIssue {
  rank:             number;
  issue:            string;
  frequency:        number;
  examples:         string[];
  recommended_rule: string;
}

interface AbbreviationEntry {
  abbr:     string;
  meaning:  string;
  seen_in:  string[];
}

interface PromptSection {
  section:      string;
  current_gap:  string;
  addition:     string;
}

interface Aggregate {
  summary?:                    string;
  top_issues?:                 TopIssue[];
  new_abbreviations_to_add?:   AbbreviationEntry[];
  prompt_sections_to_update?:  PromptSection[];
}

interface PlanAnalysis {
  layout_type:         string;
  source_units:        string;
  total_weeks_detected: number | null;
  unhandled_patterns:  Array<{ pattern: string; issue: string; suggested_rule: string }>;
  new_abbreviations:   Array<{ abbr: string; meaning: string }>;
  prompt_improvements: string[];
  anomalies:           string[];
}

interface LogEntry {
  id:      number;
  kind:    'log' | 'ok' | 'warn' | 'error';
  message: string;
}

interface PatchCandidatePreview {
  candidate_id: string;
  cluster_id: string;
  after_section: string;
  insert_text: string;
  rationale: string;
  evidence_ids: string[];
}

interface PatchEvalResult {
  candidate_id: string;
  coverage_gain: string;
  risk: string;
  confidence: number;
  representative_examples: string[];
}

interface FinalAdjustment {
  candidate_id: string;
  after_section: string;
  insert_text: string;
  rationale: string;
  confidence: number;
  risk: string;
  coverage_gain: string;
  evidence_ids: string[];
}

interface ReviewableAdjustment extends FinalAdjustment {
  approved: boolean;
}

interface RejectedIdea {
  candidate_id: string;
  verdict: string;
  reason: string;
}

interface FinalAdjustmentBundle {
  generated_at: string;
  final_adjustments: FinalAdjustment[];
  rejected_or_merged: RejectedIdea[];
}

type StageProgressState = Record<string, {
  status: 'running' | 'complete' | 'error';
  message?: string;
  meta?: string;
}>;

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  initialFiles:     string[];
  initialAggregate: Aggregate | null;
  initialPerPlan:   Record<string, { analysis: PlanAnalysis }>;
  cloudProvider:    string;
  cloudModel:       string;
}

export default function ParserRulesClient({ initialFiles, initialAggregate, initialPerPlan, cloudProvider, cloudModel }: Props) {
  const [useCloud,  setUseCloud]  = useState(true);
  const [server,    setServer]    = useState('http://localhost:8080');
  const [model,     setModel]     = useState('local');
  const [limit,     setLimit]     = useState('');
  const [selected,  setSelected]  = useState<string[]>([]);

  const [running,   setRunning]   = useState(false);
  const [log,       setLog]       = useState<LogEntry[]>([]);
  const [aggregate, setAggregate] = useState<Aggregate | null>(initialAggregate);
  const [perPlan,   setPerPlan]   = useState<Record<string, { analysis: PlanAnalysis }>>(initialPerPlan);
  const [expanded,  setExpanded]  = useState<string | null>(null);

  // Patch workbench state
  const [patchLoading,       setPatchLoading]       = useState(false);
  const [patchStatus,        setPatchStatus]        = useState<{ ok: boolean; message: string } | null>(null);
  const [patchSaving,        setPatchSaving]        = useState(false);
  const [patchNewName,       setPatchNewName]       = useState('');
  const [patchActivate,      setPatchActivate]      = useState(false);
  const [patchBasePrompt,    setPatchBasePrompt]    = useState<string>('');
  const [stageProgress,      setStageProgress]      = useState<StageProgressState>({});
  const [candidatePreviews,  setCandidatePreviews]  = useState<PatchCandidatePreview[]>([]);
  const [evalResults,        setEvalResults]        = useState<PatchEvalResult[]>([]);
  const [finalBundle,        setFinalBundle]        = useState<FinalAdjustmentBundle | null>(null);
  const [reviewAdjustments,  setReviewAdjustments]  = useState<ReviewableAdjustment[]>([]);

  const logIdRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  function addLog(kind: LogEntry['kind'], message: string) {
    setLog(prev => [...prev, { id: logIdRef.current++, kind, message }]);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }

  const syncBundleState = useCallback((bundle: FinalAdjustmentBundle, promptName = '') => {
    setFinalBundle(bundle);
    setReviewAdjustments(bundle.final_adjustments.map((adjustment) => ({
      ...adjustment,
      approved: true,
    })));
    if (promptName) {
      setPatchBasePrompt(promptName);
      const date = new Date().toISOString().slice(0, 10);
      setPatchNewName(`${promptName}_patch_${date}`);
    }
  }, []);

  const loadSavedWorkbench = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/parser-rules/patch-workbench');
      if (!res.ok) return;
      const data = await res.json() as {
        final_bundle?: FinalAdjustmentBundle;
        candidates?: { candidates?: PatchCandidatePreview[] };
        evaluation?: { evaluated_candidates?: PatchEvalResult[] };
      };
      if (data.final_bundle) {
        syncBundleState(data.final_bundle);
      }
      if (data.candidates?.candidates) {
        setCandidatePreviews(data.candidates.candidates);
      }
      if (data.evaluation?.evaluated_candidates) {
        setEvalResults(data.evaluation.evaluated_candidates);
      }
    } catch {
      // Ignore resumable load failures — the workbench can still run fresh.
    }
  }, [syncBundleState]);

  useEffect(() => {
    void loadSavedWorkbench();
  }, [loadSavedWorkbench]);

  const runPatchWorkbench = useCallback(async () => {
    setPatchLoading(true);
    setPatchStatus(null);
    setStageProgress({});
    setCandidatePreviews([]);
    setEvalResults([]);
    setFinalBundle(null);
    setReviewAdjustments([]);

    const body = useCloud ? { server: 'cloud', model: 'cloud' } : { server, model };
    const decoder = new TextDecoder();
    let buffer = '';
    let sawStructuredError = false;

    const updateStage = (stage: string, next: StageProgressState[string]) => {
      setStageProgress((prev) => ({ ...prev, [stage]: next }));
    };

    const handleWorkbenchEvent = (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case 'stage_start':
          updateStage(msg.stage as string, { status: 'running' });
          break;
        case 'stage_progress':
          updateStage(msg.stage as string, { status: 'running', message: msg.message as string });
          break;
        case 'stage_complete': {
          const meta = [
            typeof msg.row_count === 'number' ? `${msg.row_count} evidence rows` : null,
            typeof msg.cluster_count === 'number' ? `${msg.cluster_count} clusters` : null,
            typeof msg.candidate_count === 'number' ? `${msg.candidate_count} candidates` : null,
            typeof msg.accepted_count === 'number' ? `${msg.accepted_count} accepted` : null,
            typeof msg.rejected_count === 'number' ? `${msg.rejected_count} rejected` : null,
            typeof msg.evaluated_count === 'number' ? `${msg.evaluated_count} evaluated` : null,
            typeof msg.final_adjustment_count === 'number' ? `${msg.final_adjustment_count} final adjustments` : null,
          ].filter(Boolean).join(' • ');
          updateStage(msg.stage as string, { status: 'complete', meta });
          break;
        }
        case 'candidate_preview':
          setCandidatePreviews((prev) => [...prev, msg.candidate as PatchCandidatePreview]);
          break;
        case 'eval_result':
          setEvalResults((prev) => [...prev, msg.evaluation as PatchEvalResult]);
          break;
        case 'complete': {
          const prompt = msg.prompt as { name?: string } | undefined;
          syncBundleState(msg.final_bundle as FinalAdjustmentBundle, prompt?.name ?? '');
          setPatchStatus({ ok: true, message: 'Workbench complete. Review final adjustments before saving.' });
          break;
        }
        case 'error':
          sawStructuredError = true;
          setPatchStatus({ ok: false, message: msg.message as string });
          break;
      }
    };

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      try {
        handleWorkbenchEvent(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // Ignore malformed NDJSON chunks.
      }
    };

    const flushBuffer = () => {
      const trailing = buffer.trim();
      buffer = '';
      if (trailing) handleLine(trailing);
    };

    try {
      const res = await fetch('/api/admin/parser-rules/patch-workbench', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? `Error ${res.status}`);
      }

      if (!res.body) {
        throw new Error('Workbench response did not include a stream body.');
      }

      const reader = res.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          handleLine(line);
        }
      }

      buffer += decoder.decode();
      flushBuffer();
    } catch (err) {
      buffer += decoder.decode();
      flushBuffer();
      if (!sawStructuredError) {
        setPatchStatus({ ok: false, message: (err as Error).message });
      }
    } finally {
      setPatchLoading(false);
    }
  }, [model, server, syncBundleState, useCloud]);

  const toggleApproval = useCallback((idx: number) => {
    setReviewAdjustments(prev =>
      prev.map((s, i) => i === idx ? { ...s, approved: !s.approved } : s)
    );
  }, []);

  const updateInsertText = useCallback((idx: number, text: string) => {
    setReviewAdjustments(prev =>
      prev.map((s, i) => i === idx ? { ...s, insert_text: text } : s)
    );
  }, []);

  const savePatch = useCallback(async () => {
    const approved = reviewAdjustments.filter(s => s.approved);
    if (!approved.length || !patchNewName) return;
    setPatchSaving(true);
    setPatchStatus(null);
    try {
      // Fetch current active prompt text
      const activeRes = await fetch('/api/admin/parser-prompts/active');
      if (!activeRes.ok) throw new Error(activeRes.status === 404 ? 'No active prompt. Seed it in Prompt Manager first.' : `Error ${activeRes.status}`);
      const { text: baseText } = await activeRes.json() as { text: string };

      // Apply approved patches: insert each after its anchor section
      let patched = baseText;
      for (const s of approved) {
        const anchor = s.after_section;
        const idx = patched.indexOf(anchor);
        if (idx === -1) {
          // Anchor not found — append at end with comment
          patched += `\n\n// [Patch: ${s.candidate_id}]\n${s.insert_text}`;
        } else {
          const insertPos = idx + anchor.length;
          patched = patched.slice(0, insertPos) + '\n' + s.insert_text + patched.slice(insertPos);
        }
      }

      const res = await fetch('/api/admin/parser-prompts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: patchNewName, text: patched, activate: patchActivate }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? `Error ${res.status}`);
      }
      setPatchStatus({
        ok: true,
        message: patchActivate
          ? `Saved and activated as "${patchNewName}" (${approved.length} patch${approved.length !== 1 ? 'es' : ''} applied).`
          : `Saved as "${patchNewName}" (inactive). Activate in Prompt Manager.`,
      });
      setReviewAdjustments([]);
    } catch (err) {
      setPatchStatus({ ok: false, message: (err as Error).message });
    } finally {
      setPatchSaving(false);
    }
  }, [patchActivate, patchNewName, reviewAdjustments]);

  const runAnalysis = useCallback(async () => {
    setRunning(true);
    setLog([]);

    const body: Record<string, unknown> = useCloud ? { server: 'cloud', model: 'cloud' } : { server, model };
    if (limit) body.limit = parseInt(limit, 10);
    if (selected.length > 0) body.files = selected;

    const decoder = new TextDecoder();
    let buffer = '';
    let sawStructuredError = false;

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line) as Record<string, unknown>;
        if (msg.type === 'error' || msg.type === 'plan_error') {
          sawStructuredError = true;
        }
        handleStreamEvent(msg);
      } catch {
        // Ignore malformed NDJSON lines so one bad chunk does not kill the whole run.
      }
    };

    const flushBuffer = () => {
      const trailing = buffer.trim();
      buffer = '';
      if (trailing) handleLine(trailing);
    };

    try {
      const res = await fetch('/api/admin/parser-rules', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        addLog('error', `Server error: ${res.status}`);
        setRunning(false);
        return;
      }

      const reader  = res.body.getReader();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          handleLine(line);
        }
      }

      buffer += decoder.decode();
      flushBuffer();
    } catch (err) {
      buffer += decoder.decode();
      flushBuffer();
      if (!sawStructuredError) {
        addLog('error', (err as Error).message);
      }
    } finally {
      setRunning(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, model, limit, selected, useCloud]);

  function handleStreamEvent(msg: Record<string, unknown>) {
    switch (msg.type) {
      case 'start':
        addLog('log', `Starting analysis of ${msg.total} PDF(s)...`);
        break;
      case 'log':
        addLog('log', msg.message as string);
        break;
      case 'progress': {
        const step = msg.step as string;
        if (step === 'extract')    addLog('log',  `[${msg.file}] Extracting text...`);
        if (step === 'extract_ok') addLog('ok',   `[${msg.file}] ${msg.chars} chars extracted`);
        if (step === 'analyze')    addLog('log',  `[${msg.file}] Analysing with LLM...`);
        if (step === 'analyze_ok') addLog('ok',   `[${msg.file}] ${msg.patterns} patterns, ${msg.abbrs} abbreviations`);
        break;
      }
      case 'plan_done': {
        const analysis = msg.analysis as PlanAnalysis;
        setPerPlan(prev => ({ ...prev, [msg.file as string]: { analysis } }));
        break;
      }
      case 'plan_error':
        addLog('warn', `[${msg.file}] ${msg.step} failed: ${msg.message}`);
        break;
      case 'complete':
        addLog('ok', `Done. ${msg.count} plan(s) analysed.`);
        if (msg.aggregate) setAggregate(msg.aggregate as Aggregate);
        break;
      case 'error':
        addLog('error', msg.message as string);
        break;
    }
  }

  const allFiles = initialFiles;
  const toggleFile = (f: string) =>
    setSelected(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
  const orderedStages = [
    ['evidence_ledger', 'Evidence Ledger'],
    ['cluster_issues', 'Issue Clusters'],
    ['draft_patch_candidates', 'Draft Candidates'],
    ['critique_patch_candidates', 'Review Guardrails'],
    ['evaluate_patch_candidates', 'Candidate Eval'],
    ['final_adjustment_bundle', 'Final Bundle'],
  ] as const;

  return (
    <div style={{ display: 'grid', gap: 14 }}>

      {/* Config card */}
      <div className="admin-card">
        <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#293a58', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Configuration
        </h3>
        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['cloud', 'local'] as const).map(m => (
            <button key={m} onClick={() => setUseCloud(m === 'cloud')} disabled={running} style={{
              padding: '5px 16px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: running ? 'not-allowed' : 'pointer', border: 'none',
              background: (m === 'cloud') === useCloud ? '#fc4c02' : '#edf2fa',
              color:      (m === 'cloud') === useCloud ? '#fff' : '#65728a',
            }}>
              {m === 'cloud' ? `Cloud (${cloudProvider})` : 'Local LLM'}
            </button>
          ))}
        </div>

        {/* Cloud info row */}
        {useCloud && (
          <div style={{ fontSize: 12, color: '#65728a', background: '#f0f4ff', border: '1px solid #d5ddf5', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
            Provider: <strong style={{ color: '#1a2a44' }}>{cloudProvider}</strong> — model: <strong style={{ color: '#1a2a44' }}>{cloudModel}</strong>
          </div>
        )}

        {/* Local LLM fields */}
        {!useCloud && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <label style={{ display: 'grid', gap: 5, fontSize: 12, color: '#65728a', fontWeight: 700 }}>
              LLM Server URL
              <input value={server} onChange={e => setServer(e.target.value)} placeholder="http://localhost:8080" style={inputStyle} disabled={running} />
            </label>
            <label style={{ display: 'grid', gap: 5, fontSize: 12, color: '#65728a', fontWeight: 700 }}>
              Model name
              <input value={model} onChange={e => setModel(e.target.value)} placeholder="local" style={inputStyle} disabled={running} />
            </label>
          </div>
        )}

        {/* Limit (always visible) */}
        <div style={{ marginBottom: 4 }}>
          <label style={{ display: 'inline-grid', gap: 5, fontSize: 12, color: '#65728a', fontWeight: 700 }}>
            Limit PDFs
            <input
              value={limit}
              onChange={e => setLimit(e.target.value)}
              placeholder="all"
              style={{ ...inputStyle, width: 90 }}
              disabled={running}
              type="number"
              min={1}
            />
          </label>
        </div>

        {/* File selector */}
        {allFiles.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: '#65728a', fontWeight: 700, marginBottom: 6 }}>
              PDFs in fixtures/plans/ {selected.length > 0 && `(${selected.length} selected)`}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {allFiles.map(f => {
                const isSelected = selected.includes(f) || selected.length === 0;
                const explicit   = selected.includes(f);
                return (
                  <button
                    key={f}
                    onClick={() => toggleFile(f)}
                    disabled={running}
                    style={{
                      padding:      '4px 10px',
                      borderRadius: 999,
                      border:       `1px solid ${explicit ? '#fc4c02' : '#d1d9ea'}`,
                      background:   explicit ? 'rgba(252,76,2,0.08)' : '#f4f7fc',
                      color:        explicit ? '#fc4c02' : '#5e6f8c',
                      fontSize:     12,
                      fontWeight:   explicit ? 700 : 400,
                      cursor:       running ? 'not-allowed' : 'pointer',
                      opacity:      running ? 0.5 : 1,
                    }}
                  >
                    {f}
                    {perPlan[f] && (
                      <span style={{ marginLeft: 4, opacity: 0.6 }}>✓</span>
                    )}
                  </button>
                );
              })}
              {selected.length > 0 && (
                <button
                  onClick={() => setSelected([])}
                  disabled={running}
                  style={{ ...chipReset, color: '#888', fontSize: 12 }}
                >
                  clear selection
                </button>
              )}
            </div>
          </div>
        )}

        {allFiles.length === 0 && (
          <div style={{ marginTop: 10, fontSize: 13, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px' }}>
            No PDFs found in <code>scripts/fixtures/plans/</code>. Add PDF files there first.
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <button
            onClick={runAnalysis}
            disabled={running || allFiles.length === 0}
            style={running ? { ...runBtnStyle, opacity: 0.6, cursor: 'not-allowed' } : runBtnStyle}
          >
            {running ? 'Running...' : 'Run Analysis'}
          </button>
          {running && (
            <span style={{ marginLeft: 12, fontSize: 12, color: '#65728a' }}>
              This may take a few minutes depending on plan count.
            </span>
          )}
        </div>
      </div>

      {/* Log */}
      {log.length > 0 && (
        <div className="admin-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #e0e6f2', fontSize: 12, fontWeight: 700, color: '#65728a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Log
          </div>
          <div style={{ background: '#0d1117', padding: '12px 14px', maxHeight: 280, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }}>
            {log.map(entry => (
              <div key={entry.id} style={{ color: logColor(entry.kind) }}>
                {entry.message}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* Aggregate results */}
      {aggregate && (
        <div className="admin-card">
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#293a58', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Findings
          </h3>

          {aggregate.summary && (
            <p style={{ fontSize: 14, color: '#3d4f6e', marginBottom: 16, lineHeight: 1.6, borderLeft: '3px solid #fc4c02', paddingLeft: 12 }}>
              {aggregate.summary}
            </p>
          )}

          {/* Top issues */}
          {aggregate.top_issues && aggregate.top_issues.length > 0 && (
            <section style={{ marginBottom: 20 }}>
              <SectionHeading>Top Issues</SectionHeading>
              <div style={{ display: 'grid', gap: 8 }}>
                {aggregate.top_issues.map(issue => (
                  <div key={issue.rank} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ background: '#fc4c02', color: '#fff', fontSize: 11, fontWeight: 800, width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {issue.rank}
                      </span>
                      <strong style={{ fontSize: 14, color: '#1a2a44' }}>{issue.issue}</strong>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: '#65728a', background: '#edf2fa', borderRadius: 999, padding: '2px 8px', fontWeight: 700 }}>
                        {issue.frequency} plan{issue.frequency !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {issue.examples?.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 11, color: '#65728a', fontWeight: 700, marginBottom: 4 }}>Examples</div>
                        {issue.examples.map((ex, i) => (
                          <code key={i} style={{ display: 'block', fontSize: 11, background: '#fff', border: '1px solid #dde4f0', borderRadius: 6, padding: '3px 8px', marginBottom: 3, color: '#2d3748' }}>
                            {ex}
                          </code>
                        ))}
                      </div>
                    )}
                    {issue.recommended_rule && (
                      <div>
                        <div style={{ fontSize: 11, color: '#065f46', fontWeight: 700, marginBottom: 4 }}>Rule to add</div>
                        <pre style={ruleBlockStyle}>{issue.recommended_rule}</pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* New abbreviations */}
          {aggregate.new_abbreviations_to_add && aggregate.new_abbreviations_to_add.length > 0 && (
            <section style={{ marginBottom: 20 }}>
              <SectionHeading>New Abbreviations</SectionHeading>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                {aggregate.new_abbreviations_to_add.map(a => (
                  <div key={a.abbr} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px' }}>
                    <code style={{ fontSize: 13, fontWeight: 700, color: '#fc4c02' }}>{a.abbr}</code>
                    <span style={{ fontSize: 12, color: '#3d4f6e', marginLeft: 6 }}>{a.meaning}</span>
                    {a.seen_in?.length > 0 && (
                      <div style={{ fontSize: 11, color: '#65728a', marginTop: 4 }}>
                        {a.seen_in.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Prompt section updates */}
          {aggregate.prompt_sections_to_update && aggregate.prompt_sections_to_update.length > 0 && (
            <section>
              <SectionHeading>Prompt Section Updates</SectionHeading>
              <div style={{ display: 'grid', gap: 8 }}>
                {aggregate.prompt_sections_to_update.map((s, i) => (
                  <div key={i} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1a2a44', marginBottom: 4 }}>{s.section}</div>
                    <div style={{ fontSize: 12, color: '#b45309', marginBottom: 8 }}>Gap: {s.current_gap}</div>
                    <pre style={ruleBlockStyle}>{s.addition}</pre>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Patch Workbench */}
      <div className="admin-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: finalBundle ? 16 : 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1a2a44' }}>Patch Workbench</div>
            <div style={{ fontSize: 12, color: '#65728a', marginTop: 2 }}>
              Run the staged patch workbench, watch stage progress live, then approve the final adjustment bundle before saving.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {patchStatus && (
              <span style={{ fontSize: 12, fontWeight: 600, color: patchStatus.ok ? '#0f8a47' : '#b42318', maxWidth: 320 }}>
                {patchStatus.message}
              </span>
            )}
            {!aggregate && !finalBundle && (
              <span style={{ fontSize: 12, color: '#65728a' }}>Run analysis first.</span>
            )}
            {(aggregate || finalBundle) && (
              <button
                onClick={runPatchWorkbench}
                disabled={patchLoading}
                style={patchLoading ? { ...runBtnStyle, height: 36, fontSize: 13, opacity: 0.6, cursor: 'not-allowed' } : { ...runBtnStyle, height: 36, fontSize: 13 }}
              >
                {patchLoading ? 'Running Workbench…' : 'Run Patch Workbench'}
              </button>
            )}
          </div>
        </div>

        {(Object.keys(stageProgress).length > 0 || patchLoading) && (
          <section style={{ marginBottom: 18 }}>
            <SectionHeading>Workbench Progress</SectionHeading>
            <div style={{ display: 'grid', gap: 8 }}>
              {orderedStages.map(([stageKey, label]) => {
                const stage = stageProgress[stageKey];
                const color = stage?.status === 'complete'
                  ? '#0f8a47'
                  : stage?.status === 'running'
                    ? '#3730a3'
                    : '#94a3b8';
                const background = stage?.status === 'complete'
                  ? '#f0fdf4'
                  : stage?.status === 'running'
                    ? '#eef2ff'
                    : '#f8fafc';
                return (
                  <div key={stageKey} style={{ border: `1px solid ${color}30`, background, borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <strong style={{ fontSize: 13, color: '#1a2a44' }}>{label}</strong>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {stage?.status ?? 'pending'}
                      </span>
                    </div>
                    {stage?.message && (
                      <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>{stage.message}</div>
                    )}
                    {stage?.meta && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{stage.meta}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {finalBundle && (
          <div style={{ display: 'grid', gap: 16 }}>
            {patchBasePrompt && (
              <div style={{ fontSize: 12, color: '#65728a', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px' }}>
                Base prompt: <strong style={{ color: '#1a2a44' }}>{patchBasePrompt}</strong>
                <span style={{ marginLeft: 10, color: '#8899b4' }}>
                  {reviewAdjustments.filter(s => s.approved).length} / {reviewAdjustments.length} approved
                </span>
              </div>
            )}

            <section>
              <SectionHeading>Final Adjustments</SectionHeading>
              <div style={{ display: 'grid', gap: 8 }}>
                {reviewAdjustments.map((s, idx) => (
                  <div
                    key={s.candidate_id}
                    style={{
                      border: `1px solid ${s.approved ? '#bbf7d0' : '#e2e8f0'}`,
                      borderRadius: 10,
                      background: s.approved ? '#f0fdf4' : '#f8fafc',
                      padding: 12,
                      opacity: s.approved ? 1 : 0.62,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                      <button
                        onClick={() => toggleApproval(idx)}
                        style={{
                          width: 22, height: 22, borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0,
                          background: s.approved ? '#0f8a47' : '#e2e8f0',
                          color: s.approved ? '#fff' : '#8899b4',
                          fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                        title={s.approved ? 'Click to reject' : 'Click to approve'}
                      >
                        {s.approved ? '✓' : '✗'}
                      </button>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: '#065f46', fontWeight: 700, marginBottom: 3 }}>Insert after</div>
                        <code style={{ fontSize: 11, background: '#fff', border: '1px solid #d5f5e3', borderRadius: 4, padding: '2px 6px', color: '#1a2a44', display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                          {s.after_section}
                        </code>
                      </div>
                    </div>

                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: '#3730a3', fontWeight: 700, marginBottom: 4 }}>Text to insert</div>
                      <textarea
                        value={s.insert_text}
                        onChange={e => updateInsertText(idx, e.target.value)}
                        rows={3}
                        spellCheck={false}
                        style={{ width: '100%', boxSizing: 'border-box', borderRadius: 8, border: '1px solid #c7d2fe', background: '#fff', color: '#1e1b4b', padding: '7px 10px', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.55, resize: 'vertical' }}
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginBottom: 8 }}>
                      <Metric label="Confidence" value={`${Math.round(s.confidence * 100)}%`} />
                      <Metric label="Risk" value={s.risk} />
                      <Metric label="Coverage" value={s.coverage_gain} />
                      <Metric label="Evidence" value={String(s.evidence_ids.length)} />
                    </div>

                    <div style={{ fontSize: 12, color: '#3d4f6e', lineHeight: 1.5 }}>{s.rationale}</div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <SectionHeading>Rejected or Merged Ideas</SectionHeading>
              {finalBundle.rejected_or_merged.length === 0 ? (
                <div style={{ fontSize: 12, color: '#64748b' }}>No rejected or merged ideas in the latest bundle.</div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {finalBundle.rejected_or_merged.map((item) => (
                    <div key={item.candidate_id} style={{ border: '1px solid #e2e8f0', background: '#f8fafc', borderRadius: 10, padding: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <strong style={{ fontSize: 13, color: '#1a2a44' }}>{item.candidate_id}</strong>
                        <span style={{ fontSize: 11, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 999, padding: '2px 8px' }}>
                          {item.verdict}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>{item.reason}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <SectionHeading>Evidence and Eval Details</SectionHeading>
              <div style={{ display: 'grid', gap: 12 }}>
                {candidatePreviews.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: '#65728a', fontWeight: 700, marginBottom: 6 }}>Candidate previews</div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {candidatePreviews.map((candidate) => (
                        <div key={candidate.candidate_id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, background: '#fff' }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#1a2a44', marginBottom: 4 }}>{candidate.candidate_id}</div>
                          <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>{candidate.rationale}</div>
                          <code style={{ fontSize: 11, color: '#3730a3', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{candidate.insert_text}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {evalResults.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: '#65728a', fontWeight: 700, marginBottom: 6 }}>Eval results</div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {evalResults.map((result) => (
                        <div key={result.candidate_id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, background: '#fff' }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                            <strong style={{ fontSize: 12, color: '#1a2a44' }}>{result.candidate_id}</strong>
                            <Pill label={result.coverage_gain} color="#065f46" />
                            <Pill label={result.risk} color="#92400e" />
                            <Pill label={`${Math.round(result.confidence * 100)}%`} color="#1e40af" />
                          </div>
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            Examples: {result.representative_examples.join(', ') || 'none'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'end', paddingTop: 4 }}>
              <label style={{ display: 'grid', gap: 5, fontSize: 12, color: '#65728a', fontWeight: 700 }}>
                New version name
                <input
                  value={patchNewName}
                  onChange={e => setPatchNewName(e.target.value)}
                  style={{ ...inputStyle }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#3d4f6e', cursor: 'pointer', paddingBottom: 8 }}>
                <input type="checkbox" checked={patchActivate} onChange={e => setPatchActivate(e.target.checked)} />
                Activate immediately
              </label>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                onClick={savePatch}
                disabled={patchSaving || !patchNewName || reviewAdjustments.filter(s => s.approved).length === 0}
                style={patchSaving || !patchNewName || reviewAdjustments.filter(s => s.approved).length === 0
                  ? { ...runBtnStyle, opacity: 0.5, cursor: 'not-allowed' }
                  : runBtnStyle}
              >
                {patchSaving ? 'Saving…' : `Save ${reviewAdjustments.filter(s => s.approved).length} patch${reviewAdjustments.filter(s => s.approved).length !== 1 ? 'es' : ''}`}
              </button>
              <Link href="/admin/parser-prompts" style={{ fontSize: 13, color: '#fc4c02', fontWeight: 600 }}>
                Prompt Manager →
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Per-plan breakdown */}
      {Object.keys(perPlan).length > 0 && (
        <div className="admin-card">
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#293a58', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Per-Plan Breakdown
          </h3>
          <div style={{ display: 'grid', gap: 6 }}>
            {Object.entries(perPlan).map(([file, entry]) => {
              const a  = entry.analysis;
              const np = a.unhandled_patterns?.length ?? 0;
              const na = a.new_abbreviations?.length  ?? 0;
              const open = expanded === file;
              return (
                <div key={file} style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                  <button
                    onClick={() => setExpanded(open ? null : file)}
                    style={{ width: '100%', textAlign: 'left', background: open ? '#f0f4ff' : '#f8fafc', border: 'none', cursor: 'pointer', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1a2a44', flex: 1 }}>{file}</span>
                    <Pill label={a.layout_type} color="#5b21b6" />
                    <Pill label={a.source_units} color="#065f46" />
                    {np > 0 && <Pill label={`${np} pattern${np !== 1 ? 's' : ''}`} color="#92400e" />}
                    {na > 0 && <Pill label={`${na} abbr`} color="#1e40af" />}
                    <span style={{ fontSize: 11, color: '#65728a' }}>{open ? '▲' : '▼'}</span>
                  </button>
                  {open && (
                    <div style={{ padding: '12px 14px', borderTop: '1px solid #e2e8f0', display: 'grid', gap: 14 }}>
                      {a.unhandled_patterns?.length > 0 && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', marginBottom: 6 }}>Unhandled patterns</div>
                          {a.unhandled_patterns.map((p, i) => (
                            <div key={i} style={{ marginBottom: 8, fontSize: 12 }}>
                              <code style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, padding: '2px 6px', color: '#92400e' }}>{p.pattern}</code>
                              <div style={{ color: '#65728a', marginTop: 3 }}>{p.issue}</div>
                              <div style={{ color: '#065f46', marginTop: 2, fontStyle: 'italic' }}>→ {p.suggested_rule}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      {a.prompt_improvements?.length > 0 && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#065f46', marginBottom: 6 }}>Prompt improvements</div>
                          {a.prompt_improvements.map((p, i) => (
                            <div key={i} style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#166534', marginBottom: 4 }}>
                              {p}
                            </div>
                          ))}
                        </div>
                      )}
                      {a.anomalies?.length > 0 && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#b45309', marginBottom: 6 }}>Anomalies</div>
                          {a.anomalies.map((x, i) => (
                            <div key={i} style={{ fontSize: 12, color: '#92400e', marginBottom: 3 }}>• {x}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, color: '#65728a', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #e8ecf4' }}>
      {children}
    </div>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color, background: `${color}18`, border: `1px solid ${color}40`, borderRadius: 999, padding: '2px 7px', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', padding: '8px 10px' }}>
      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: '#1a2a44', fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function logColor(kind: LogEntry['kind']): string {
  if (kind === 'ok')    return '#4ade80';
  if (kind === 'warn')  return '#fbbf24';
  if (kind === 'error') return '#f87171';
  return '#9ca3af';
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  height:      36,
  borderRadius: 10,
  border:      '1px solid #d6deee',
  background:  '#f9fbff',
  padding:     '0 10px',
  fontFamily:  'inherit',
  fontSize:    13,
  color:       '#1d2f4d',
  width:       '100%',
};

const runBtnStyle: React.CSSProperties = {
  height:       40,
  padding:      '0 24px',
  background:   '#fc4c02',
  color:        '#fff',
  border:       'none',
  borderRadius: 10,
  fontSize:     14,
  fontWeight:   700,
  cursor:       'pointer',
  letterSpacing: '0.02em',
};

const ruleBlockStyle: React.CSSProperties = {
  background:   '#f0fdf4',
  border:       '1px solid #bbf7d0',
  borderRadius: 8,
  padding:      '8px 10px',
  fontSize:     12,
  color:        '#166534',
  whiteSpace:   'pre-wrap',
  margin:       0,
  fontFamily:   'monospace',
  lineHeight:   1.5,
};

const chipReset: React.CSSProperties = {
  background:   'none',
  border:       'none',
  cursor:       'pointer',
  padding:      '4px 6px',
  borderRadius: 999,
};
