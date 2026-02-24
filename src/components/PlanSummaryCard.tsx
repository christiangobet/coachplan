'use client';

import type { PlanSummary, WeekDay } from '@/lib/types/plan-summary';
import s from './PlanSummaryCard.module.css';

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  summary: PlanSummary | null;
  planId?: string;
  onExtract?: () => Promise<void>;
};

// ── Icon components ─────────────────────────────────────────────────────────

function IconQuality() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2L3 14h8l-1 8 11-14h-8l0-6z" />
    </svg>
  );
}

function IconLong() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7" cy="6" r="2" />
      <circle cx="17" cy="18" r="2" />
      <path d="M7 8c0 6 10 2 10 8" />
    </svg>
  );
}

function IconEasy() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 16c3 0 6-2 8-6l3 3c2 2 4 2 5 2v3H4v-2z" />
      <path d="M9 10l-1-1" />
    </svg>
  );
}

function IconRecovery() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z" />
    </svg>
  );
}

function IconCross() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 10v4M17 10v4" />
      <path d="M9 12h6" />
      <path d="M5 9v6M19 9v6" />
    </svg>
  );
}

function IconRest() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 14a7.5 7.5 0 0 1-9-9 8.5 8.5 0 1 0 9 9z" />
    </svg>
  );
}

function IntensityIcon({ kind }: { kind?: WeekDay['intensity'] }) {
  switch (kind) {
    case 'quality':   return <IconQuality />;
    case 'long':      return <IconLong />;
    case 'easy':      return <IconEasy />;
    case 'recovery':  return <IconRecovery />;
    case 'cross':     return <IconCross />;
    default:          return <IconRest />;
  }
}

// ── Pill style ──────────────────────────────────────────────────────────────

function intensityClass(intensity?: WeekDay['intensity']): string {
  switch (intensity) {
    case 'quality':  return s.pillQuality;
    case 'long':     return s.pillLong;
    case 'easy':     return s.pillEasy;
    case 'recovery': return s.pillRecovery;
    case 'cross':    return s.pillCross;
    default:         return s.pillRest;
  }
}

// ── Load curve SVG ──────────────────────────────────────────────────────────

function LoadCurve({ points }: { points: number[] }) {
  const W = 640;
  const H = 100;
  const padX = 6;
  const padY = 8;
  const n = Math.max(points.length, 2);
  const dx = (W - padX * 2) / (n - 1);
  const y = (v: number) => H - padY - Math.min(1, Math.max(0, v)) * (H - padY * 2);

  const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${padX + i * dx} ${y(v)}`).join(' ');
  const area = `${line} L ${padX + (n - 1) * dx} ${H - padY} L ${padX} ${H - padY} Z`;

  return (
    <div className={s.curveWrap}>
      <div className={s.curveHeader}>
        <span className={s.curveLabel}>Training Load</span>
        <span className={s.curveSub}>Build → Peak → Taper</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className={s.curveSvg} aria-hidden="true">
        <defs>
          <linearGradient id="psAreaGrad" x1="0" x2="1">
            <stop offset="0%" stopColor="#fc4c02" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#fc4c02" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <path d={`M ${padX} ${H - padY} L ${W - padX} ${H - padY}`} stroke="rgba(0,0,0,0.1)" strokeWidth="1" />
        <path d={area} fill="url(#psAreaGrad)" />
        <path d={line} fill="none" stroke="#fc4c02" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function PlanSummaryCard({ summary, onExtract }: Props) {
  if (!summary) {
    return (
      <div className={s.emptyState}>
        <p className={s.emptyText}>No plan summary generated yet.</p>
        {onExtract && (
          <button className={s.generateBtn} onClick={onExtract}>
            ✦ Generate plan summary
          </button>
        )}
      </div>
    );
  }

  const categories = summary.categories?.slice(0, 3) ?? [];

  return (
    <div className={s.card}>
      <div className={s.body}>

        {/* Header */}
        <div className={s.header}>
          <div className={s.headerLeft}>
            <div className={s.planLabel}>
              <span className={s.dotAccent} />
              <span>{summary.weeksTotal}-Week Plan</span>
            </div>
            <h2 className={s.title}>{summary.title}</h2>
            {categories.length > 0 && (
              <div className={s.categoryRow}>
                {categories.map((c) => (
                  <span key={c} className={s.categoryBadge}>{c}</span>
                ))}
              </div>
            )}
          </div>
          {summary.phases.length > 0 && (
            <div className={s.headerMeta}>
              <span className={s.metaLabel}>Phases</span>
              <span className={s.metaValue}>{summary.phases.length}</span>
            </div>
          )}
        </div>

        {/* Load curve */}
        {summary.loadCurve?.points?.length ? (
          <LoadCurve points={summary.loadCurve.points} />
        ) : null}

        {/* Phase chips */}
        {summary.phases.length > 0 && (
          <div className={s.phaseGrid}>
            {summary.phases.map((p) => (
              <div key={`${p.name}-${p.weeks[0]}`} className={s.phaseCard}>
                <div className={s.phaseCardTop}>
                  <span className={s.phaseName}>{p.name}</span>
                  <span className={s.phaseWeeks}>Wk {p.weeks[0]}–{p.weeks[1]}</span>
                </div>
                <p className={s.phaseFocus}>{p.focus}</p>
              </div>
            ))}
          </div>
        )}

        {/* Typical week */}
        {summary.typicalWeek.length > 0 && (
          <div>
            <div className={s.weekHeader}>
              <span className={s.weekTitle}>Typical Week</span>
              <span className={s.weekSub}>Protect your long run + quality session</span>
            </div>
            <div className={s.weekScrollOuter}>
              <div className={s.weekGrid}>
                {summary.typicalWeek.map((d) => (
                  <div key={d.day} className={s.weekCell}>
                    <div className={s.weekCellTop}>
                      <span className={s.dayAbbr}>{d.day.toUpperCase()}</span>
                      <span className={`${s.intensityPill} ${intensityClass(d.intensity)}`}>
                        {d.tag ?? (d.intensity?.toUpperCase() ?? '—')}
                      </span>
                    </div>
                    <div className={s.weekCellIcon}>
                      <IntensityIcon kind={d.intensity} />
                    </div>
                    <p className={s.weekCellLabel}>{d.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer principle */}
        <div className={s.footer}>
          <p className={s.principle}>
            {summary.principle ?? 'Consistency over perfection · Adaptation over strict scheduling'}
          </p>
          {summary.footerNote && (
            <p className={s.footerNote}>{summary.footerNote}</p>
          )}
        </div>

      </div>
    </div>
  );
}
