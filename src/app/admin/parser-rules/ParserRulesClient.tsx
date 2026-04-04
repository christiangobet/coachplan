'use client';

import { useState, useRef, useCallback } from 'react';
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

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  initialFiles:     string[];
  initialAggregate: Aggregate | null;
  initialPerPlan:   Record<string, { analysis: PlanAnalysis }>;
}

export default function ParserRulesClient({ initialFiles, initialAggregate, initialPerPlan }: Props) {
  const [server,    setServer]    = useState('http://localhost:8080');
  const [model,     setModel]     = useState('local');
  const [limit,     setLimit]     = useState('');
  const [selected,  setSelected]  = useState<string[]>([]);

  const [running,   setRunning]   = useState(false);
  const [log,       setLog]       = useState<LogEntry[]>([]);
  const [aggregate, setAggregate] = useState<Aggregate | null>(initialAggregate);
  const [perPlan,   setPerPlan]   = useState<Record<string, { analysis: PlanAnalysis }>>(initialPerPlan);
  const [expanded,  setExpanded]  = useState<string | null>(null);

  // Apply-to-prompt state
  const [applyOpen,      setApplyOpen]      = useState(false);
  const [applyLoading,   setApplyLoading]   = useState(false);
  const [applyAdditions, setApplyAdditions] = useState('');
  const [applyNewName,   setApplyNewName]   = useState('');
  const [applyActivate,  setApplyActivate]  = useState(false);
  const [applyStatus,    setApplyStatus]    = useState<{ ok: boolean; message: string } | null>(null);
  const [activePrompt,   setActivePrompt]   = useState<{ id: string; name: string; text: string } | null>(null);

  const logIdRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  function addLog(kind: LogEntry['kind'], message: string) {
    setLog(prev => [...prev, { id: logIdRef.current++, kind, message }]);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }

  function buildAdditions(agg: Aggregate): string {
    const lines: string[] = [];
    const date = new Date().toISOString().slice(0, 10);
    lines.push(`\n\n--------------------------------------------------`);
    lines.push(`PARSER RULE FINDER ADDITIONS (${date})`);
    lines.push(`--------------------------------------------------`);

    if (agg.new_abbreviations_to_add?.length) {
      lines.push('\nNEW ABBREVIATIONS:');
      for (const a of agg.new_abbreviations_to_add) {
        lines.push(`- ${a.abbr}=${a.meaning}`);
      }
    }

    if (agg.top_issues?.length) {
      lines.push('\nNEW RULES:');
      for (const issue of agg.top_issues) {
        if (issue.recommended_rule) {
          lines.push(`\n// Issue: ${issue.issue} (${issue.frequency} plans)`);
          lines.push(issue.recommended_rule);
        }
      }
    }

    if (agg.prompt_sections_to_update?.length) {
      lines.push('\nSECTION ADDITIONS:');
      for (const s of agg.prompt_sections_to_update) {
        lines.push(`\n// ${s.section} — ${s.current_gap}`);
        lines.push(s.addition);
      }
    }

    return lines.join('\n');
  }

  const prepareApply = useCallback(async () => {
    if (!aggregate) return;
    setApplyLoading(true);
    setApplyStatus(null);
    try {
      const res = await fetch('/api/admin/parser-prompts/active');
      if (!res.ok) throw new Error(res.status === 404 ? 'No active prompt found — create one in Prompt Manager first.' : `Error ${res.status}`);
      const prompt = await res.json() as { id: string; name: string; text: string };
      setActivePrompt(prompt);
      setApplyAdditions(buildAdditions(aggregate));
      const date = new Date().toISOString().slice(0, 10);
      setApplyNewName(`${prompt.name}_rulefinder_${date}`);
      setApplyOpen(true);
    } catch (err) {
      setApplyStatus({ ok: false, message: (err as Error).message });
    } finally {
      setApplyLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aggregate]);

  const saveNewVersion = useCallback(async () => {
    if (!activePrompt || !applyNewName) return;
    setApplyLoading(true);
    setApplyStatus(null);
    try {
      const newText = activePrompt.text + applyAdditions;
      const res = await fetch('/api/admin/parser-prompts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: applyNewName, text: newText, activate: applyActivate }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? `Error ${res.status}`);
      }
      setApplyStatus({ ok: true, message: applyActivate ? `Saved and activated as "${applyNewName}".` : `Saved as "${applyNewName}" (inactive). Activate it in Prompt Manager.` });
      setApplyOpen(false);
    } catch (err) {
      setApplyStatus({ ok: false, message: (err as Error).message });
    } finally {
      setApplyLoading(false);
    }
  }, [activePrompt, applyAdditions, applyNewName, applyActivate]);

  const runAnalysis = useCallback(async () => {
    setRunning(true);
    setLog([]);

    const body: Record<string, unknown> = { server, model };
    if (limit) body.limit = parseInt(limit, 10);
    if (selected.length > 0) body.files = selected;

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
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as Record<string, unknown>;
            handleStreamEvent(msg);
          } catch { /* skip malformed line */ }
        }
      }
    } catch (err) {
      addLog('error', (err as Error).message);
    } finally {
      setRunning(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, model, limit, selected]);

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

  return (
    <div style={{ display: 'grid', gap: 14 }}>

      {/* Config card */}
      <div className="admin-card">
        <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#293a58', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Configuration
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 5, fontSize: 12, color: '#65728a', fontWeight: 700 }}>
            LLM Server URL
            <input
              value={server}
              onChange={e => setServer(e.target.value)}
              placeholder="http://localhost:8080"
              style={inputStyle}
              disabled={running}
            />
          </label>
          <label style={{ display: 'grid', gap: 5, fontSize: 12, color: '#65728a', fontWeight: 700 }}>
            Model name
            <input
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="local"
              style={inputStyle}
              disabled={running}
            />
          </label>
          <label style={{ display: 'grid', gap: 5, fontSize: 12, color: '#65728a', fontWeight: 700 }}>
            Limit
            <input
              value={limit}
              onChange={e => setLimit(e.target.value)}
              placeholder="all"
              style={{ ...inputStyle, width: 72 }}
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

      {/* Apply to prompt */}
      <div className="admin-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: applyOpen ? 14 : 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1a2a44' }}>Apply to Prompt</div>
            <div style={{ fontSize: 12, color: '#65728a', marginTop: 2 }}>
              Appends the suggested rules to the active prompt and saves it as a new version.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {applyStatus && (
              <span style={{ fontSize: 12, fontWeight: 600, color: applyStatus.ok ? '#0f8a47' : '#b42318' }}>
                {applyStatus.message}
              </span>
            )}
            {!aggregate && (
              <span style={{ fontSize: 12, color: '#65728a' }}>Run analysis first.</span>
            )}
            {aggregate && !applyOpen && (
              <button
                onClick={prepareApply}
                disabled={applyLoading}
                style={{ ...runBtnStyle, height: 36, fontSize: 13 }}
              >
                {applyLoading ? 'Loading…' : 'Prepare patch'}
              </button>
            )}
            {applyOpen && (
              <button
                onClick={() => setApplyOpen(false)}
                style={{ height: 36, padding: '0 14px', background: 'none', border: '1px solid #d6deee', borderRadius: 10, fontSize: 13, color: '#65728a', cursor: 'pointer' }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {applyOpen && activePrompt && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 12, color: '#65728a', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px' }}>
              Base: <strong style={{ color: '#1a2a44' }}>{activePrompt.name}</strong>
              <span style={{ color: '#8899b4', marginLeft: 8 }}>{activePrompt.text.length.toLocaleString()} chars</span>
            </div>

            <label style={{ display: 'grid', gap: 5, fontSize: 12, color: '#65728a', fontWeight: 700 }}>
              Additions to append
              <textarea
                value={applyAdditions}
                onChange={e => setApplyAdditions(e.target.value)}
                rows={14}
                spellCheck={false}
                style={{ borderRadius: 10, border: '1px solid #d6deee', background: '#0d1117', color: '#e0e0e0', padding: '10px 12px', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.55, resize: 'vertical' }}
              />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'end' }}>
              <label style={{ display: 'grid', gap: 5, fontSize: 12, color: '#65728a', fontWeight: 700 }}>
                New version name
                <input
                  value={applyNewName}
                  onChange={e => setApplyNewName(e.target.value)}
                  style={{ ...inputStyle }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#3d4f6e', cursor: 'pointer', paddingBottom: 8 }}>
                <input type="checkbox" checked={applyActivate} onChange={e => setApplyActivate(e.target.checked)} />
                Activate immediately
              </label>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                onClick={saveNewVersion}
                disabled={applyLoading || !applyNewName}
                style={applyLoading || !applyNewName ? { ...runBtnStyle, opacity: 0.5, cursor: 'not-allowed' } : runBtnStyle}
              >
                {applyLoading ? 'Saving…' : 'Save new version'}
              </button>
              <Link href="/admin/parser-prompts" style={{ fontSize: 13, color: '#fc4c02', fontWeight: 600 }}>
                Open Prompt Manager →
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
