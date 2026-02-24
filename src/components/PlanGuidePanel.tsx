'use client';

import { useEffect, useState } from 'react';
import s from './PlanGuidePanel.module.css';

// ── Types ──────────────────────────────────────────────────────────────────

type GuideSection = { title: string; items: string[] };

// ── Constants ──────────────────────────────────────────────────────────────

const GUIDE_SECTION_META: Record<string, { icon: string; slug: string }> = {
  'PLAN OVERVIEW': { icon: '📋', slug: 'overview' },
  'GLOSSARY & ABBREVIATIONS': { icon: '📖', slug: 'glossary' },
  'GLOSSARY': { icon: '📖', slug: 'glossary' },
  'PACE ZONES': { icon: '⚡', slug: 'paces' },
  'NAMED SESSIONS & CIRCUITS': { icon: '🏃', slug: 'sessions' },
  'NAMED SESSIONS': { icon: '🏃', slug: 'sessions' },
  'GENERAL INSTRUCTIONS': { icon: '📌', slug: 'instructions' },
};

// ── Parsing ────────────────────────────────────────────────────────────────

function parsePlanGuide(text: string): GuideSection[] {
  const sections: GuideSection[] = [];
  let current: GuideSection | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // Section header: mostly uppercase, no leading dash, at least 4 chars
    if (!line.startsWith('-') && /^[A-Z][A-Z &/]+$/.test(line) && line.length >= 4) {
      if (current) sections.push(current);
      current = { title: line, items: [] };
    } else if (current) {
      current.items.push(line.startsWith('- ') ? line.slice(2) : line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

// ── Intensity detection for pace zones ────────────────────────────────────

type Intensity = 'easy' | 'moderate' | 'hard' | 'max' | 'rest';

function paceIntensity(label: string): Intensity {
  const l = label.toLowerCase();
  if (/easy|recov|base|aerob|jog|walk|z1\b|zone 1/.test(l)) return 'easy';
  if (/marathon|m-pace|tempo|threshold|lt\b|lactate|comf|z2\b|z3\b|zone 2|zone 3/.test(l)) return 'moderate';
  if (/interval|vo2|speed|hard|fast|z4\b|zone 4/.test(l)) return 'hard';
  if (/max|sprint|race pace|peak|z5\b|zone 5/.test(l)) return 'max';
  return 'rest';
}

// ── Item renderers ─────────────────────────────────────────────────────────

function renderGlossaryItem(item: string, i: number) {
  const eqIdx = item.indexOf(' = ');
  const colonIdx = item.indexOf(': ');
  if (eqIdx > -1) {
    return (
      <li key={i} className={s.glossItem}>
        <span className={s.glossKey}>{item.slice(0, eqIdx)}</span>
        {item.slice(eqIdx + 3)}
      </li>
    );
  }
  if (colonIdx > -1 && colonIdx < 6) {
    return (
      <li key={i} className={s.glossItem}>
        <span className={s.glossKey}>{item.slice(0, colonIdx)}</span>
        {item.slice(colonIdx + 2)}
      </li>
    );
  }
  return <li key={i} className={s.glossItem}>{item}</li>;
}

function renderPaceItem(item: string, i: number) {
  const eqIdx = item.indexOf(' = ');
  const colonIdx = item.indexOf(': ');
  const sep = eqIdx > -1 ? eqIdx : colonIdx > -1 ? colonIdx : -1;
  const sepLen = eqIdx > -1 ? 3 : 2;
  if (sep > -1) {
    const label = item.slice(0, sep);
    const value = item.slice(sep + sepLen);
    const intensity = paceIntensity(label);
    return (
      <li key={i} className={`${s.paceRow} ${s[`pace_${intensity}`]}`}>
        <span className={s.paceLabel}>{label}</span>
        <span className={s.paceValue}>{value}</span>
      </li>
    );
  }
  return <li key={i} className={`${s.paceRow} ${s.pace_rest}`}><span className={s.paceValue}>{item}</span></li>;
}

function renderSessionItem(item: string, i: number) {
  const colonIdx = item.indexOf(': ');
  const dashIdx = item.indexOf(' – ');
  const sep = colonIdx > -1 ? colonIdx : dashIdx > -1 ? dashIdx : -1;
  const sepLen = colonIdx > -1 ? 2 : 3;
  if (sep > -1) {
    return (
      <li key={i} className={s.sessionItem}>
        <span className={s.sessionName}>{item.slice(0, sep)}</span>
        {': '}{item.slice(sep + sepLen)}
      </li>
    );
  }
  return <li key={i} className={s.item}>{item}</li>;
}

// ── Section renderer ───────────────────────────────────────────────────────

function renderSection(section: GuideSection) {
  const meta = GUIDE_SECTION_META[section.title] ?? { icon: '•', slug: 'other' };
  const slug = meta.slug;

  const items = section.items.map((item, i) => {
    if (slug === 'glossary') return renderGlossaryItem(item, i);
    if (slug === 'paces') return renderPaceItem(item, i);
    if (slug === 'sessions') return renderSessionItem(item, i);
    return <li key={i} className={s.item}>{item}</li>;
  });

  return (
    <div key={section.title} className={s.section}>
      <h3 className={s.sectionTitle}>
        <span className={s.icon}>{meta.icon}</span>
        {section.title}
      </h3>
      <ul className={s.list}>{items}</ul>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

type PlanGuidePanelProps = {
  guideText: string;
  planId: string;
  editable?: boolean;
  compact?: boolean;
};

export default function PlanGuidePanel({
  guideText,
  planId,
  editable = false,
  compact = false,
}: PlanGuidePanelProps) {
  const [liveText, setLiveText] = useState(guideText);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(guideText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Zoom modal state
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomEditing, setZoomEditing] = useState(false);
  const [zoomDraft, setZoomDraft] = useState(guideText);
  const [zoomSaving, setZoomSaving] = useState(false);
  const [zoomError, setZoomError] = useState<string | null>(null);

  // Close modal on Escape key; lock body scroll while open
  useEffect(() => {
    if (!zoomOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeZoom();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [zoomOpen]);

  // ── Inline edit handlers ──────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planGuide: draft }),
      });
      if (!res.ok) throw new Error('Save failed');
      setLiveText(draft);
      setEditing(false);
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setDraft(liveText);
    setEditing(false);
    setError(null);
  }

  // ── Zoom modal handlers ───────────────────────────────────────────────────

  function openZoom() {
    setZoomDraft(liveText);
    setZoomEditing(false);
    setZoomError(null);
    setZoomOpen(true);
  }

  function closeZoom() {
    setZoomOpen(false);
    setZoomEditing(false);
    setZoomError(null);
  }

  async function handleZoomSave() {
    setZoomSaving(true);
    setZoomError(null);
    try {
      const res = await fetch(`/api/plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planGuide: zoomDraft }),
      });
      if (!res.ok) throw new Error('Save failed');
      setLiveText(zoomDraft);
      setDraft(zoomDraft); // keep inline draft in sync
      setZoomEditing(false);
    } catch {
      setZoomError('Failed to save. Please try again.');
    } finally {
      setZoomSaving(false);
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  const allSections = parsePlanGuide(liveText);
  const sectionsToRender = compact
    ? (allSections.find((sec) => sec.title === 'PACE ZONES')
        ? [allSections.find((sec) => sec.title === 'PACE ZONES')!]
        : allSections.filter((sec) => sec.title === 'PLAN OVERVIEW').slice(0, 1))
    : allSections;

  // ── Zoom modal ────────────────────────────────────────────────────────────

  const zoomModal = zoomOpen ? (
    <div className={s.zoomOverlay} onClick={(e) => { if (e.target === e.currentTarget) closeZoom(); }}>
      <div className={s.zoomModal} role="dialog" aria-modal="true" aria-label="Plan guide">
        {/* Modal header */}
        <div className={s.zoomHeader}>
          <div className={s.zoomHeaderLeft}>
            <span className={s.zoomTitle}>📋 Plan Guide</span>
          </div>
          <div className={s.zoomHeaderRight}>
            {!zoomEditing && (
              <button
                className={s.zoomEditBtn}
                onClick={() => { setZoomDraft(liveText); setZoomEditing(true); }}
              >
                ✎ Edit
              </button>
            )}
            <button className={s.zoomCloseBtn} onClick={closeZoom} aria-label="Close">✕</button>
          </div>
        </div>

        {/* Modal body */}
        <div className={s.zoomBody}>
          {zoomEditing ? (
            <>
              <p className={s.zoomEditHint}>
                Edit the guide below. Use plain text with uppercase section headings (e.g. PACE ZONES, GLOSSARY &amp; ABBREVIATIONS).
              </p>
              <textarea
                className={s.zoomTextarea}
                value={zoomDraft}
                onChange={(e) => setZoomDraft(e.target.value)}
                spellCheck={false}
                autoFocus
              />
              {zoomError && <p className={s.errorMsg}>{zoomError}</p>}
              <div className={s.zoomSaveRow}>
                <button className={s.saveBtn} onClick={handleZoomSave} disabled={zoomSaving}>
                  {zoomSaving ? 'Saving…' : 'Save guide'}
                </button>
                <button
                  className={s.cancelBtn}
                  onClick={() => { setZoomEditing(false); setZoomError(null); }}
                  disabled={zoomSaving}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            allSections.length === 0
              ? <p className={s.empty}>No guide content found.</p>
              : allSections.map(renderSection)
          )}
        </div>
      </div>
    </div>
  ) : null;

  // ── Inline edit mode ──────────────────────────────────────────────────────

  if (editing && editable) {
    return (
      <>
        <div className={s.panel}>
          <div className={s.editHeader}>
            <span className={s.editLabel}>Edit guide text</span>
            <button className={s.zoomBtn} onClick={openZoom} title="Open in full view">⊞ Zoom</button>
          </div>
          <textarea
            className={s.editTextarea}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
          {error && <p className={s.errorMsg}>{error}</p>}
          <div className={s.editActions}>
            <button className={s.saveBtn} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save guide'}
            </button>
            <button className={s.cancelBtn} onClick={handleCancel} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
        {zoomModal}
      </>
    );
  }

  // ── Normal display mode ───────────────────────────────────────────────────

  return (
    <>
      <div className={s.panel}>
        <div className={s.editHeader}>
          {editable
            ? <span className={s.editLabel}>Plan guide</span>
            : <span className={s.editLabel} />
          }
          <div className={s.headerActions}>
            <button className={s.zoomBtn} onClick={openZoom} title="Open in full view">⊞ Zoom</button>
            {editable && (
              <button className={s.editBtn} onClick={() => { setDraft(liveText); setEditing(true); }}>
                ✎ Edit
              </button>
            )}
          </div>
        </div>
        {sectionsToRender.length === 0 ? (
          <p className={s.empty}>No guide content found.</p>
        ) : (
          sectionsToRender.map(renderSection)
        )}
      </div>
      {zoomModal}
    </>
  );
}
