import type { MouseEvent, ReactNode } from 'react';
import styles from './SessionFlowStrip.module.css';

export type SessionStepNode = {
  type: string;
  repetitions?: number;
  steps?: SessionStepNode[];
  distance_miles?: number;
  distance_km?: number;
  duration_minutes?: number;
  pace_target?: string | null;
  effort?: string | null;
  description?: string | null;
};

const STEP_TYPE_LABELS: Record<string, string> = {
  warmup: 'Warm-up',
  cooldown: 'Cool-down',
  tempo: 'Tempo',
  interval: 'Interval',
  recovery: 'Recovery',
  easy: 'Easy',
  distance: 'Run',
  note: 'Note',
};

function humanizeStepType(type: string): string {
  return String(type || 'step')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function formatStepNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function normalizeStepTone(type: string): string {
  return String(type || 'default').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'default';
}

function stepLabel(step: SessionStepNode): string {
  const parts: string[] = [];
  const type = String(step.type || '').toLowerCase();
  const heading = STEP_TYPE_LABELS[type] ?? humanizeStepType(type);
  if (type !== 'note') parts.push(heading);

  if (typeof step.distance_miles === 'number' && Number.isFinite(step.distance_miles)) {
    parts.push(`${formatStepNumber(step.distance_miles)} mi`);
  } else if (typeof step.distance_km === 'number' && Number.isFinite(step.distance_km)) {
    parts.push(`${formatStepNumber(step.distance_km)} km`);
  }
  if (typeof step.duration_minutes === 'number' && Number.isFinite(step.duration_minutes)) {
    parts.push(`${formatStepNumber(step.duration_minutes)} min`);
  }
  if (step.pace_target) parts.push(`@ ${step.pace_target}`);
  if (step.effort) parts.push(step.effort);

  const description = typeof step.description === 'string' ? step.description.trim() : '';
  if (description) {
    if (type === 'note') parts.push(description);
    else parts.push(`(${description})`);
  }
  if (parts.length === 0) parts.push(heading);
  return parts.filter(Boolean).join(' ');
}

type SessionFlowStripProps = {
  structure: unknown;
  label?: string;
  className?: string;
  size?: 'default' | 'compact';
  activePath?: number[] | null;
  onStepDoubleClick?: (path: number[], step: SessionStepNode) => void;
  onAddStep?: () => void;
};

export default function SessionFlowStrip({
  structure,
  label = 'Session Flow',
  className,
  size = 'default',
  activePath = null,
  onStepDoubleClick,
  onAddStep,
}: SessionFlowStripProps) {
  const steps = Array.isArray(structure)
    ? (structure as SessionStepNode[]).filter((step) => step && typeof step.type === 'string')
    : [];
  if (steps.length === 0 && !onAddStep) return null;

  const stripClasses = [styles.strip, size === 'compact' ? styles.compact : '', className || '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={stripClasses} aria-label="Session flow">
      <span className={styles.label}>{label}</span>
      <ul className={styles.list}>
        {steps.map((step, index) =>
          renderStepNode(step, [index], activePath, onStepDoubleClick)
        )}
        {onAddStep && (
          <li>
            <button
              type="button"
              className={styles.addStepButton}
              onClick={onAddStep}
              aria-label="Add session flow step"
              title="Add step"
            >
              +
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

function renderStepNode(
  step: SessionStepNode,
  path: number[],
  activePath: number[] | null,
  onStepDoubleClick?: (path: number[], step: SessionStepNode) => void,
): ReactNode {
  const stepType = String(step.type || '').toLowerCase();
  const interactive = typeof onStepDoubleClick === 'function';
  const isActive = isSamePath(path, activePath);
  if (stepType === 'repeat') {
    const onRepeatDoubleClick = interactive
      ? (event: MouseEvent) => {
        event.stopPropagation();
        onStepDoubleClick(path, step);
      }
      : undefined;
    const nested = (step.steps ?? [])
      .filter((child) => child && typeof child.type === 'string')
      .map((child, childIndex) =>
        renderStepChip(child, [...path, childIndex], true, activePath, onStepDoubleClick)
      )
      .filter(Boolean);

    if (nested.length === 0) return null;

    const repeatClasses = [
      styles.repeatItem,
      interactive ? styles.interactive : '',
      isActive ? styles.active : '',
    ].filter(Boolean).join(' ');

    return (
      <li key={`repeat-${path.join('-')}`} className={repeatClasses} onDoubleClick={onRepeatDoubleClick}>
        <span className={styles.repeatCount}>{step.repetitions ?? 2}×</span>
        <ul className={styles.repeatList}>{nested}</ul>
      </li>
    );
  }

  return renderStepChip(step, path, false, activePath, onStepDoubleClick);
}

function renderStepChip(
  step: SessionStepNode,
  path: number[],
  isChild: boolean,
  activePath: number[] | null,
  onStepDoubleClick?: (path: number[], step: SessionStepNode) => void,
): ReactNode {
  const label = stepLabel(step);
  if (!label) return null;
  const tone = normalizeStepTone(step.type);
  const interactive = typeof onStepDoubleClick === 'function';
  const chipClasses = [
    styles.stepChip,
    isChild ? styles.stepChipChild : '',
    interactive ? styles.interactive : '',
    isSamePath(path, activePath) ? styles.active : '',
  ].filter(Boolean).join(' ');
  const onDoubleClick = interactive
    ? (event: MouseEvent) => {
      event.stopPropagation();
      onStepDoubleClick(path, step);
    }
    : undefined;
  return (
    <li
      key={`${isChild ? 'child' : 'step'}-${path.join('-')}-${tone}`}
      className={chipClasses}
      data-tone={tone}
      onDoubleClick={onDoubleClick}
      title={interactive ? 'Double-click to edit step' : undefined}
    >
      {label}
    </li>
  );
}

function isSamePath(path: number[], other: number[] | null): boolean {
  if (!other || other.length !== path.length) return false;
  return path.every((value, index) => value === other[index]);
}
