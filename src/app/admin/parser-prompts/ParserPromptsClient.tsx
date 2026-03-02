'use client';

import { useState } from 'react';
import Link from 'next/link';

type Prompt = {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  charCount: number;
  text: string;
};

type Props = { initialPrompts: Prompt[] };

export default function ParserPromptsClient({ initialPrompts }: Props) {
  const [prompts, setPrompts] = useState<Prompt[]>(initialPrompts);
  const [selected, setSelected] = useState<Prompt | null>(initialPrompts[0] ?? null);
  const [isNew, setIsNew] = useState(false);
  const [editName, setEditName] = useState(initialPrompts[0]?.name ?? '');
  const [editText, setEditText] = useState(initialPrompts[0]?.text ?? '');
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function selectPrompt(p: Prompt) {
    setSelected(p);
    setIsNew(false);
    setEditName(p.name);
    setEditText(p.text);
    setError(null);
    setSuccess(null);
  }

  function startNew() {
    setSelected(null);
    setIsNew(true);
    setEditName('');
    setEditText('');
    setError(null);
    setSuccess(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (isNew) {
        const res = await fetch('/api/admin/parser-prompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: editName, text: editText })
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? 'Failed to create prompt');
        }
        const created = await res.json();
        const newEntry: Prompt = {
          id: created.id,
          name: created.name,
          isActive: created.isActive,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
          charCount: editText.length,
          text: editText
        };
        setPrompts(prev => [...prev, newEntry]);
        setSelected(newEntry);
        setIsNew(false);
        setSuccess('Prompt created.');
      } else if (selected) {
        const res = await fetch(`/api/admin/parser-prompts/${selected.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: editName, text: editText })
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? 'Failed to save prompt');
        }
        const updated = await res.json();
        const updatedEntry: Prompt = {
          ...selected,
          name: updated.name,
          text: editText,
          charCount: editText.length,
          updatedAt: updated.updatedAt
        };
        setPrompts(prev => prev.map(p => p.id === selected.id ? updatedEntry : p));
        setSelected(updatedEntry);
        setSuccess('Changes saved.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate() {
    if (!selected) return;
    setActivating(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/admin/parser-prompts/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activate: true })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Failed to activate prompt');
      }
      const updatedSelected = { ...selected, isActive: true };
      setSelected(updatedSelected);
      setPrompts(prev => prev.map(p => ({ ...p, isActive: p.id === selected.id })));
      setSuccess('Prompt activated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setActivating(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    if (!confirm(`Delete prompt "${selected.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/parser-prompts/${selected.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Failed to delete prompt');
      }
      const remaining = prompts.filter(p => p.id !== selected.id);
      setPrompts(remaining);
      const next = remaining[0] ?? null;
      setSelected(next);
      if (next) { setEditName(next.name); setEditText(next.text); }
      setIsNew(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setDeleting(false);
    }
  }

  const canDelete = selected && !selected.isActive && prompts.length > 1;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 12, alignItems: 'start' }}>
      {/* ── Left: prompt list ── */}
      <div className="admin-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid #e0e6f2', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#65728a' }}>Prompts</span>
          <button onClick={startNew} style={{ fontSize: 12, fontWeight: 700, color: '#fc4c02', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}>
            + New
          </button>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {prompts.map(p => (
            <li
              key={p.id}
              onClick={() => selectPrompt(p)}
              style={{
                padding: '10px 14px',
                cursor: 'pointer',
                borderBottom: '1px solid #f0f4fb',
                background: selected?.id === p.id ? 'rgba(252,76,2,0.06)' : undefined,
                display: 'grid',
                gap: 3
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 13, color: '#1d2f4d', fontFamily: 'monospace' }}>{p.name}</strong>
                {p.isActive && (
                  <span style={{
                    fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em',
                    background: 'rgba(15,138,71,0.12)', color: '#0f8a47', borderRadius: 999, padding: '2px 7px'
                  }}>Active</span>
                )}
              </div>
              <span style={{ fontSize: 11, color: '#8899b4' }}>{p.charCount.toLocaleString()} chars · {new Date(p.createdAt).toLocaleDateString()}</span>
            </li>
          ))}
          {isNew && (
            <li style={{ padding: '10px 14px', background: 'rgba(252,76,2,0.06)', borderBottom: '1px solid #f0f4fb' }}>
              <strong style={{ fontSize: 13, color: '#fc4c02', fontFamily: 'monospace' }}>New prompt…</strong>
            </li>
          )}
        </ul>
      </div>

      {/* ── Right: editor panel ── */}
      <div className="admin-card" style={{ display: 'grid', gap: 12 }}>
        {(selected || isNew) ? (
          <>
            <div style={{ display: 'grid', gap: 5 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#65728a', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Name</label>
              <input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                placeholder="e.g. v5_master"
                style={{
                  height: 36, borderRadius: 10, border: '1px solid #d6deee', background: '#f9fbff',
                  padding: '0 10px', fontFamily: 'monospace', fontSize: 13, color: '#1d2f4d'
                }}
              />
            </div>

            <div style={{ display: 'grid', gap: 5 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#65728a', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Prompt text
                <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 8 }}>{editText.length.toLocaleString()} chars</span>
              </label>
              <textarea
                value={editText}
                onChange={e => setEditText(e.target.value)}
                rows={24}
                spellCheck={false}
                style={{
                  borderRadius: 10, border: '1px solid #d6deee', background: '#f9fbff',
                  padding: '10px 12px', fontFamily: 'monospace', fontSize: 12, color: '#1d2f4d',
                  lineHeight: 1.55, resize: 'vertical'
                }}
              />
            </div>

            {error && <p style={{ margin: 0, color: '#b42318', fontSize: 13, fontWeight: 600 }}>{error}</p>}
            {success && <p style={{ margin: 0, color: '#0f8a47', fontSize: 13, fontWeight: 600 }}>{success}</p>}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={handleSave}
                disabled={saving || !editName || !editText}
                style={{
                  height: 36, borderRadius: 10, border: '1px solid #fc4c02', background: '#fc4c02',
                  color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: '0 16px'
                }}
              >
                {saving ? 'Saving…' : isNew ? 'Create prompt' : 'Save changes'}
              </button>

              {!isNew && selected && (
                <button
                  onClick={handleActivate}
                  disabled={activating || selected.isActive}
                  style={{
                    height: 36, borderRadius: 10, border: '1px solid rgba(15,138,71,0.4)',
                    background: selected.isActive ? '#f4f7fc' : 'rgba(15,138,71,0.1)',
                    color: selected.isActive ? '#8899b4' : '#0f8a47',
                    fontWeight: 700, fontSize: 13, cursor: selected.isActive ? 'not-allowed' : 'pointer', padding: '0 16px'
                  }}
                >
                  {activating ? 'Activating…' : selected.isActive ? 'Already active' : 'Set as active'}
                </button>
              )}

              {!isNew && selected && (
                <button
                  onClick={handleDelete}
                  disabled={deleting || !canDelete}
                  title={selected.isActive ? 'Cannot delete the active prompt' : prompts.length <= 1 ? 'Cannot delete the only prompt' : undefined}
                  style={{
                    height: 36, borderRadius: 10, border: '1px solid rgba(180,35,24,0.3)',
                    background: canDelete ? 'rgba(180,35,24,0.07)' : '#f4f7fc',
                    color: canDelete ? '#b42318' : '#8899b4',
                    fontWeight: 700, fontSize: 13, cursor: canDelete ? 'pointer' : 'not-allowed', padding: '0 16px', marginLeft: 'auto'
                  }}
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              )}
            </div>
          </>
        ) : (
          <p style={{ margin: 0, color: '#65728a', fontSize: 13 }}>Select a prompt or create a new one.</p>
        )}
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <Link className="admin-link" href="/admin" style={{ display: 'inline-block' }}>← Back to Admin</Link>
      </div>
    </div>
  );
}
