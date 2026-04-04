'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import type { PatchSuggestion } from '@/app/api/admin/parser-rules/patch/route';

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

  // Smart Patch state
  const [patchLoading,     setPatchLoading]     = useState(false);
  const [patchSuggestions, setPatchSuggestions] = useState<PatchSuggestion[]>([]);
  const [patchStatus,      setPatchStatus]      = useState<{ ok: boolean; message: string } | null>(null);
  const [patchSaving,      setPatchSaving]      = useState(false);
  const [patchNewName,     setPatchNewName]     = useState('');
  const [patchActivate,    setPatchActivate]    = useState(false);
  const [patchBasePrompt,  setPatchBasePrompt]  = useState<string>('');  // name of the base prompt

  const logIdRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  function addLog(kind: LogEntry['kind'], message: string) {
    setLog(prev => [...prev, { id: logIdRef.current++, kind, message }]);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }

  const fetchPatch = useCallback(async () => {
    if (!aggregate) return;
    setPatchLoading(true);
    setPatchStatus(null);
    setPatchSuggestions([]);
    try {
      const res = await fetch('/api/admin/parser-rules/patch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ server, model }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? `Error ${res.status}`);
      }
      const data = await res.json() as { suggestions: PatchSuggestion[]; base_prompt_name: string };
      setPatchSuggestions(data.suggestions);
      setPatchBasePrompt(data.base_prompt_name);
      const date = new Date().toISOString().slice(0, 10);
      setPatchNewName(`${data.base_prompt_name}_patch_${date}`);
    } catch (err) {
      setPatchStatus({ ok: false, message: (err as Error).message });
    } finally {
      setPatchLoading(false);
    }
  }, [aggregate, server, model]);

  const toggleApproval = useCallback((idx: number) => {
    setPatchSuggestions(prev =>
      prev.map((s, i) => i === idx ? { ...s, approved: !s.approved } : s)
    );
  }, []);

  const updateInsertText = useCallback((idx: number, text: string) => {
    setPatchSuggestions(prev =>
      prev.map((s, i) => i === idx ? { ...s, insert_text: text } : s)
    );
  }, []);

  const savePatch = useCallback(async () => {
    const approved = patchSuggestions.filter(s => s.approved);
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
          patched += `\n\n// [Patch: ${s.source_issue}]\n${s.insert_text}`;
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
      setPatchSuggestions([]);
    } catch (err) {
      setPatchStatus({ ok: false, message: (err as Error).message });
    } finally {
      setPatchSaving(false);
    }
  }, [patchSuggestions, patchNewName, patchActivate]);

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

      {/* Smart Patch */}
      <div className="admin-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: patchSuggestions.length > 0 ? 16 : 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1a2a44' }}>Smart Patch</div>
            <div style={{ fontSize: 12, color: '#65728a', marginTop: 2 }}>
              Ask the LLM to suggest section-anchored insertions into the active prompt. Review and approve each before saving.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {patchStatus && (
              <span style={{ fontSize: 12, fontWeight: 600, color: patchStatus.ok ? '#0f8a47' : '#b42318', maxWidth: 260 }}>
                {patchStatus.message}
              </span>
            )}
            {!aggregate && (
              <span style={{ fontSize: 12, color: '#65728a' }}>Run analysis first.</span>
            )}
            {aggregate && patchSuggestions.length === 0 && (
              <button
                onClick={fetchPatch}
                disabled={patchLoading}
                style={patchLoading ? { ...runBtnStyle, height: 36, fontSize: 13, opacity: 0.6, cursor: 'not-allowed' } : { ...runBtnStyle, height: 36, fontSize: 13 }}
              >
                {patchLoading ? 'Asking LLM…' : 'Suggest Patches'}
              </button>
            )}
            {patchSuggestions.length > 0 && (
              <button
                onClick={() => { setPatchSuggestions([]); setPatchStatus(null); }}
                style={{ height: 36, padding: '0 14px', background: 'none', border: '1px solid #d6deee', borderRadius: 10, fontSize: 13, color: '#65728a', cursor: 'pointer' }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {patchSuggestions.length > 0 && (
          <div style={{ display: 'grid', gap: 12 }}>
            {patchBasePrompt && (
              <div style={{ fontSize: 12, color: '#65728a', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px' }}>
                Base prompt: <strong style={{ color: '#1a2a44' }}>{patchBasePrompt}</strong>
                <span style={{ marginLeft: 10, color: '#8899b4' }}>
                  {patchSuggestions.filter(s => s.approved).length} / {patchSuggestions.length} approved
                </span>
              </div>
            )}

            {/* Suggestion list */}
            <div style={{ display: 'grid', gap: 8 }}>
              {patchSuggestions.map((s, idx) => (
                <div
                  key={idx}
                  style={{
                    border:       `1px solid ${s.approved ? '#bbf7d0' : '#e2e8f0'}`,
                    borderRadius: 10,
                    background:   s.approved ? '#f0fdf4' : '#f8fafc',
                    padding:      12,
                    opacity:      s.approved ? 1 : 0.6,
                    transition:   'opacity 0.15s, border-color 0.15s',
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

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 11, color: '#65728a', fontWeight: 700, marginBottom: 2 }}>Rationale</div>
                      <div style={{ fontSize: 12, color: '#3d4f6e', lineHeight: 1.5 }}>{s.rationale}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#65728a', fontWeight: 700, marginBottom: 2 }}>Source issue</div>
                      <div style={{ fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>{s.source_issue}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Save controls */}
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
                disabled={patchSaving || !patchNewName || patchSuggestions.filter(s => s.approved).length === 0}
                style={patchSaving || !patchNewName || patchSuggestions.filter(s => s.approved).length === 0
                  ? { ...runBtnStyle, opacity: 0.5, cursor: 'not-allowed' }
                  : runBtnStyle}
              >
                {patchSaving ? 'Saving…' : `Save ${patchSuggestions.filter(s => s.approved).length} patch${patchSuggestions.filter(s => s.approved).length !== 1 ? 'es' : ''}`}
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
