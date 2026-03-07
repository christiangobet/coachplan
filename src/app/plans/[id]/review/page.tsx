'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import './review.css';
import {
  estimateGoalTimeFromEvidence,
  formatTimeHms,
  parseTimePartsToSeconds,
  type PaceEvidence
} from '@/lib/pace-estimation';
import { inferPaceBucketFromText } from '@/lib/intensity-targets';
import { normalizePaceForStorage, resolveDistanceUnitFromActivity } from '@/lib/unit-display';
import PlanSourcePdfPane from '@/components/PlanSourcePdfPane';
import SessionFlowStrip, { type SessionStepNode } from '@/components/SessionFlowStrip';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ACTIVITY_TYPES = ['RUN', 'STRENGTH', 'CROSS_TRAIN', 'REST', 'MOBILITY', 'YOGA', 'HIKE', 'OTHER'] as const;
const DISTANCE_UNITS = ['MILES', 'KM'] as const;
const RACE_DISTANCE_OPTIONS = [
  { value: '5', label: '5K' },
  { value: '10', label: '10K' },
  { value: '21.0975', label: 'Half Marathon (21.1K)' },
  { value: '42.195', label: 'Marathon (42.2K)' },
  { value: '50', label: '50K' }
] as const;
const PACE_MULTIPLIERS = {
  RACE: 1.0,
  LONG: 1.09,
  EASY: 1.14,
  TEMPO: 0.96,
  INTERVAL: 0.87
} as const;
const PACE_BUCKET_OPTIONS = [
  { value: 'RECOVERY', short: 'RE', label: 'Recovery', profileKey: 'recovery' },
  { value: 'EASY', short: 'EZ', label: 'Easy', profileKey: 'easy' },
  { value: 'LONG', short: 'LR', label: 'Long run', profileKey: 'long' },
  { value: 'RACE', short: 'RP', label: 'Race pace', profileKey: 'race' },
  { value: 'TEMPO', short: 'TP', label: 'Tempo', profileKey: 'tempo' },
  { value: 'THRESHOLD', short: 'TH', label: 'Threshold', profileKey: 'threshold' },
  { value: 'INTERVAL', short: 'IN', label: 'Interval', profileKey: 'interval' }
] as const;

type ActivityTypeValue = (typeof ACTIVITY_TYPES)[number];
type DistanceUnitValue = (typeof DISTANCE_UNITS)[number];
type PaceSourceMode = 'TARGET_TIME' | 'PAST_RESULT' | 'STRAVA';
type PaceBucketValue = (typeof PACE_BUCKET_OPTIONS)[number]['value'];
type WeekDateAnchor = 'RACE_DATE' | 'START_DATE';

type StravaPaceCandidate = {
  id: string;
  label: string;
  distanceKm: number;
  timeSec: number;
  dateISO: string;
  activityName: string | null;
};

type ManualResultDraft = {
  id: string;
  distanceKm: string;
  hours: string;
  minutes: string;
  seconds: string;
  dateISO: string;
  label: string;
};

type ReviewActivity = {
  id: string;
  title: string;
  type: ActivityTypeValue;
  distance: number | null;
  distanceUnit: DistanceUnitValue | null;
  duration: number | null;
  paceTarget: string | null;
  paceTargetBucket: PaceBucketValue | null;
  effortTarget: string | null;
  rawText: string | null;
  notes: string | null;
  sessionInstructions: string | null;
  structure?: unknown;
};

type ReviewDay = {
  id: string;
  weekId: string | null;
  dayOfWeek: number;
  rawText: string | null;
  notes: string | null;
  activities: ReviewActivity[];
};

type ReviewWeek = {
  id: string;
  weekIndex: number;
  days: ReviewDay[];
};

type ReviewPlan = {
  id: string;
  name: string;
  status: string;
  raceDate?: string | null;
  parseProfile?: unknown;
  planGuide?: string | null;
  weeks: ReviewWeek[];
  days: ReviewDay[];
  activities: ReviewActivity[];
};

type ReviewProgramProfile = {
  plan_length_weeks: number | null;
  days_per_week: number | null;
  distance_type: string | null;
  intensity_model: string | null;
  units: string | null;
  language_hint: string | null;
  peak_week_km: number | null;
  peak_long_run_km: number | null;
  taper_weeks: number | null;
  structure_tags: string[];
  includes_quality: {
    intervals: boolean;
    tempo: boolean;
    hills: boolean;
    strides: boolean;
    strength: boolean;
    cross_training: boolean;
  } | null;
};

type SourceDocumentMeta = {
  loading: boolean;
  available: boolean;
  fileUrl: string | null;
  fileName: string | null;
  pageCount: number | null;
  error: string | null;
};

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function humanizeToken(value: string | null) {
  if (!value) return 'Unknown';
  return value
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

type ActivityDraft = {
  title: string;
  type: ActivityTypeValue;
  distance: string;
  distanceUnit: DistanceUnitValue | '';
  duration: string;
  paceTargetBucket: PaceBucketValue | '';
  paceTarget: string;
  effortTarget: string;
  rawText: string;
  sessionInstructions: string;
  structure: unknown;
};

type ProfilePaceMap = Partial<Record<PaceBucketValue, string>>;

const GENERIC_TITLES_BY_TYPE: Record<ActivityTypeValue, string[]> = {
  RUN: ['run', 'running', 'workout', 'session', 'training'],
  STRENGTH: ['strength', 'strength training', 'gym', 'workout', 'session', 'training'],
  CROSS_TRAIN: ['cross train', 'cross training', 'xt', 'workout', 'session', 'training'],
  REST: ['rest', 'rest day', 'off', 'off day'],
  MOBILITY: ['mobility', 'mobility work', 'workout', 'session', 'training'],
  YOGA: ['yoga', 'workout', 'session', 'training'],
  HIKE: ['hike', 'hiking', 'workout', 'session', 'training'],
  OTHER: ['workout', 'session', 'training']
};

const STEP_LABEL_BY_TYPE: Record<string, string> = {
  interval: 'Intervals',
  tempo: 'Tempo Run',
  threshold: 'Threshold Run',
  recovery: 'Recovery Run',
  easy: 'Easy Run',
  distance: 'Run',
  warmup: 'Warm-up',
  cooldown: 'Cool-down',
  note: 'Run'
};

const STEP_PRIORITY: Record<string, number> = {
  interval: 0,
  tempo: 1,
  threshold: 2,
  distance: 3,
  easy: 4,
  recovery: 5,
  warmup: 6,
  cooldown: 7,
  note: 8
};

function normalizeTitleToken(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/[^a-z0-9 ]+/g, '').trim();
}

function formatStepNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function isGenericActivityTitle(title: string | null | undefined, type: ActivityTypeValue): boolean {
  const normalized = normalizeTitleToken(title || '');
  if (!normalized) return true;
  const generic = new Set([
    ...(GENERIC_TITLES_BY_TYPE[type] || []),
    type.toLowerCase().replace(/_/g, ' '),
    'activity'
  ]);
  return generic.has(normalized);
}

function compactTextSnippet(input: string | null | undefined, maxLength = 40): string | null {
  if (!input) return null;
  let text = input
    .replace(/\s+/g, ' ')
    .replace(/^[\-–—•*:\s]+/, '')
    .trim();
  if (!text) return null;
  const sentence = text.split(/[.;!?]/)[0]?.trim() || text;
  text = sentence.split(/\s*[-–—:]\s*/)[0]?.trim() || sentence;
  if (!text) return null;
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength);
  const safe = clipped.slice(0, clipped.lastIndexOf(' ')).trim();
  return `${(safe || clipped).trim()}...`;
}

function pickPrimaryStep(structure: unknown): SessionStepNode | null {
  if (!Array.isArray(structure) || structure.length === 0) return null;
  const topSteps = (structure as SessionStepNode[]).filter((step) => step && typeof step.type === 'string');
  if (topSteps.length === 0) return null;

  const flattened = topSteps.flatMap((step) => {
    const type = String(step.type || '').toLowerCase();
    if (type !== 'repeat') return [step];
    const children = Array.isArray(step.steps)
      ? step.steps.filter((child) => child && typeof child.type === 'string')
      : [];
    return children.length > 0 ? children : [step];
  });

  return flattened
    .sort((a, b) => {
      const aPriority = STEP_PRIORITY[String(a.type || '').toLowerCase()] ?? 99;
      const bPriority = STEP_PRIORITY[String(b.type || '').toLowerCase()] ?? 99;
      return aPriority - bPriority;
    })[0] || null;
}

function structureTitle(structure: unknown): string | null {
  const primary = pickPrimaryStep(structure);
  if (!primary) return null;
  const type = String(primary.type || '').toLowerCase();
  const label = STEP_LABEL_BY_TYPE[type] || 'Run';
  const metric =
    typeof primary.distance_miles === 'number' && Number.isFinite(primary.distance_miles)
      ? `${formatStepNumber(primary.distance_miles)} mi`
      : typeof primary.distance_km === 'number' && Number.isFinite(primary.distance_km)
        ? `${formatStepNumber(primary.distance_km)} km`
        : typeof primary.duration_minutes === 'number' && Number.isFinite(primary.duration_minutes)
          ? `${formatStepNumber(primary.duration_minutes)} min`
          : null;
  return metric ? `${label} ${metric}` : label;
}

function fallbackTypeTitle(type: ActivityTypeValue): string {
  if (type === 'CROSS_TRAIN') return 'Cross Train';
  if (type === 'REST') return 'Rest Day';
  return type.replace(/_/g, ' ').toLowerCase().replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function deriveSmartActivityTitle(activity: ReviewActivity): string {
  const currentTitle = (activity.title || '').trim();
  if (!isGenericActivityTitle(currentTitle, activity.type)) return currentTitle;

  const fromStructure = structureTitle(activity.structure);
  if (fromStructure && !isGenericActivityTitle(fromStructure, activity.type)) return fromStructure;

  const fromInstructions = compactTextSnippet(activity.sessionInstructions);
  if (fromInstructions && !isGenericActivityTitle(fromInstructions, activity.type)) return fromInstructions;

  const fromRawText = compactTextSnippet(activity.rawText);
  if (fromRawText && !isGenericActivityTitle(fromRawText, activity.type)) return fromRawText;

  return fallbackTypeTitle(activity.type);
}

function isPaceBucketValue(value: unknown): value is PaceBucketValue {
  return PACE_BUCKET_OPTIONS.some((option) => option.value === value);
}

function normalizeProfilePace(value: unknown, unit: DistanceUnitValue) {
  if (typeof value !== 'string') return null;
  const normalized = normalizePaceForStorage(value, unit);
  return normalized || null;
}

function toProfilePaceMap(rawTargets: unknown, unit: DistanceUnitValue): ProfilePaceMap {
  if (!rawTargets || typeof rawTargets !== 'object') return {};
  const source = rawTargets as Record<string, unknown>;
  const result: ProfilePaceMap = {};
  for (const option of PACE_BUCKET_OPTIONS) {
    const normalized = normalizeProfilePace(source[option.profileKey], unit);
    if (normalized) result[option.value] = normalized;
  }
  return result;
}

function toActivityDraft(activity: ReviewActivity, fallbackUnit: DistanceUnitValue): ActivityDraft {
  const resolvedDistanceUnit = resolveDistanceUnitFromActivity({
    distanceUnit: activity.distanceUnit,
    paceTarget: activity.paceTarget,
    fallbackUnit
  }) as DistanceUnitValue | null;
  const inferredPaceBucket = activity.type === 'RUN'
    ? (
        isPaceBucketValue(activity.paceTargetBucket)
          ? activity.paceTargetBucket
          : (inferPaceBucketFromText(activity.paceTarget || activity.rawText || activity.title) as PaceBucketValue | null)
      )
    : null;
  return {
    title: deriveSmartActivityTitle(activity),
    type: activity.type || 'OTHER',
    distance: activity.distance === null || activity.distance === undefined ? '' : String(activity.distance),
    distanceUnit: resolvedDistanceUnit || fallbackUnit,
    duration: activity.duration === null || activity.duration === undefined ? '' : String(activity.duration),
    paceTargetBucket: inferredPaceBucket || '',
    paceTarget: activity.paceTarget || '',
    effortTarget: activity.effortTarget || '',
    rawText: activity.rawText || '',
    sessionInstructions: activity.sessionInstructions || '',
    structure: activity.structure ?? null
  };
}

function sortDays(days: ReviewDay[]) {
  return [...days].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}

function cloneStructureSteps(structure: unknown): SessionStepNode[] {
  if (!Array.isArray(structure)) return [];
  return JSON.parse(JSON.stringify(structure)) as SessionStepNode[];
}

function getStepContainerAtPath(
  steps: SessionStepNode[],
  path: number[],
): { container: SessionStepNode[]; index: number } | null {
  if (!Array.isArray(steps) || path.length === 0) return null;
  if (path.length === 1) {
    const index = path[0];
    if (!Number.isInteger(index) || index < 0 || index >= steps.length) return null;
    return { container: steps, index };
  }
  if (path.length === 2) {
    const [parentIndex, childIndex] = path;
    if (!Number.isInteger(parentIndex) || parentIndex < 0 || parentIndex >= steps.length) return null;
    const parent = steps[parentIndex];
    if (!parent || parent.type !== 'repeat' || !Array.isArray(parent.steps)) return null;
    if (!Number.isInteger(childIndex) || childIndex < 0 || childIndex >= parent.steps.length) return null;
    return { container: parent.steps, index: childIndex };
  }
  return null;
}

function getStepAtPath(structure: unknown, path: number[]): SessionStepNode | null {
  const cloned = cloneStructureSteps(structure);
  const target = getStepContainerAtPath(cloned, path);
  if (!target) return null;
  return target.container[target.index] || null;
}

function applyActivityUpdateToPlan(
  plan: ReviewPlan,
  activityId: string,
  updater: (activity: ReviewActivity) => ReviewActivity
): ReviewPlan {
  return {
    ...plan,
    weeks: plan.weeks.map((week) => ({
      ...week,
      days: week.days.map((day) => ({
        ...day,
        activities: day.activities.map((activity) =>
          activity.id === activityId ? updater(activity) : activity
        )
      }))
    })),
    days: plan.days.map((day) => ({
      ...day,
      activities: day.activities.map((activity) =>
        activity.id === activityId ? updater(activity) : activity
      )
    })),
    activities: plan.activities.map((activity) =>
      activity.id === activityId ? updater(activity) : activity
    )
  };
}

function applyDayUpdateToPlan(
  plan: ReviewPlan,
  dayId: string,
  updater: (day: ReviewDay) => ReviewDay
): ReviewPlan {
  return {
    ...plan,
    weeks: plan.weeks.map((week) => ({
      ...week,
      days: week.days.map((day) => (day.id === dayId ? updater(day) : day))
    })),
    days: plan.days.map((day) => (day.id === dayId ? updater(day) : day))
  };
}

function appendActivityToDayPlan(
  plan: ReviewPlan,
  dayId: string,
  activity: ReviewActivity
): ReviewPlan {
  return {
    ...plan,
    weeks: plan.weeks.map((week) => ({
      ...week,
      days: week.days.map((day) => (
        day.id === dayId
          ? { ...day, activities: [...(day.activities || []), activity] }
          : day
      ))
    })),
    days: plan.days.map((day) => (
      day.id === dayId
        ? { ...day, activities: [...(day.activities || []), activity] }
        : day
    )),
    activities: [...plan.activities, activity]
  };
}

function removeActivityFromPlan(
  plan: ReviewPlan,
  activityId: string
): ReviewPlan {
  return {
    ...plan,
    weeks: plan.weeks.map((week) => ({
      ...week,
      days: week.days.map((day) => ({
        ...day,
        activities: day.activities.filter((activity) => activity.id !== activityId)
      }))
    })),
    days: plan.days.map((day) => ({
      ...day,
      activities: day.activities.filter((activity) => activity.id !== activityId)
    })),
    activities: plan.activities.filter((activity) => activity.id !== activityId)
  };
}

function setFlag(
  previous: Record<string, boolean>,
  id: string,
  enabled: boolean
) {
  const next = { ...previous };
  if (enabled) next[id] = true;
  else delete next[id];
  return next;
}

function formatSavedTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

function makeManualResult(): ManualResultDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    distanceKm: '10',
    hours: '0',
    minutes: '50',
    seconds: '0',
    dateISO: '',
    label: ''
  };
}

function formatPace(goalTimeSec: number, raceDistanceKm: number, multiplier: number, units: DistanceUnitValue) {
  const secPerKm = (goalTimeSec / Math.max(0.1, raceDistanceKm)) * multiplier;
  const secPerUnit = units === 'KM' ? secPerKm : secPerKm * 1.609344;
  let minutes = Math.floor(secPerUnit / 60);
  let seconds = Math.round(secPerUnit - (minutes * 60));
  if (seconds >= 60) {
    minutes += 1;
    seconds -= 60;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')} ${units === 'KM' ? '/km' : '/mi'}`;
}

function toDateInputValue(value: string | Date | null | undefined) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

export default function PlanReviewPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const planId = Array.isArray(params?.id) ? params?.id[0] : params?.id;
  const arrivedFromUpload = searchParams?.get('fromUpload') === '1';
  const parseWarningMsg = searchParams?.get('parseWarningMsg');
  const hasParseWarning = searchParams?.get('parseWarning') === '1';
  const debugMode = searchParams?.get('debug') === '1';
  const parserPromptName = searchParams?.get('parserPromptName') ?? null;

  const [plan, setPlan] = useState<ReviewPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activationWeekDateAnchor, setActivationWeekDateAnchor] = useState<WeekDateAnchor>('RACE_DATE');
  const [activationRaceDate, setActivationRaceDate] = useState('');
  const [activationStartDate, setActivationStartDate] = useState('');

  const [dayDrafts, setDayDrafts] = useState<Record<string, string>>({});
  const [expandedDayNotes, setExpandedDayNotes] = useState<Record<string, boolean>>({});
  const [savingDayIds, setSavingDayIds] = useState<Record<string, boolean>>({});
  const [queuedDayIds, setQueuedDayIds] = useState<Record<string, boolean>>({});

  const [activityDrafts, setActivityDrafts] = useState<Record<string, ActivityDraft>>({});
  const [expandedActivityDetails, setExpandedActivityDetails] = useState<Record<string, boolean>>({});
  const [savingActivityIds, setSavingActivityIds] = useState<Record<string, boolean>>({});
  const [queuedActivityIds, setQueuedActivityIds] = useState<Record<string, boolean>>({});
  const [creatingDayId, setCreatingDayId] = useState<string | null>(null);
  const [deletingActivityId, setDeletingActivityId] = useState<string | null>(null);
  const [viewerUnits, setViewerUnits] = useState<DistanceUnitValue>('MILES');
  const [profilePaces, setProfilePaces] = useState<ProfilePaceMap>({});
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [paceFormOpen, setPaceFormOpen] = useState(false);
  const [paceStep, setPaceStep] = useState<1 | 2>(1);
  const [paceApplying, setPaceApplying] = useState(false);
  const [paceRunCount, setPaceRunCount] = useState(0);
  const [paceSource, setPaceSource] = useState<PaceSourceMode>('TARGET_TIME');
  const [raceDistanceKm, setRaceDistanceKm] = useState('42.195');
  const [goalHours, setGoalHours] = useState('3');
  const [goalMinutes, setGoalMinutes] = useState('30');
  const [goalSeconds, setGoalSeconds] = useState('0');
  const [manualResults, setManualResults] = useState<ManualResultDraft[]>([makeManualResult()]);
  const [athleteAge, setAthleteAge] = useState('');
  const [athleteSex, setAthleteSex] = useState('');
  const [paceSourcesLoading, setPaceSourcesLoading] = useState(false);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [stravaUsername, setStravaUsername] = useState<string | null>(null);
  const [stravaLastSyncAt, setStravaLastSyncAt] = useState<string | null>(null);
  const [stravaCandidates, setStravaCandidates] = useState<StravaPaceCandidate[]>([]);
  const [selectedStravaId, setSelectedStravaId] = useState('');
  const [overrideExistingPaces, setOverrideExistingPaces] = useState(false);
  const [savePaceProfile, setSavePaceProfile] = useState(true);
  const [paceModalError, setPaceModalError] = useState<string | null>(null);
  const [isWideScreen, setIsWideScreen] = useState(
    () => (typeof window === 'undefined' ? true : window.matchMedia('(min-width: 1100px)').matches)
  );
  const [showSourcePdf, setShowSourcePdf] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [sourceDocumentChecked, setSourceDocumentChecked] = useState(false);
  const [sourceDocument, setSourceDocument] = useState<SourceDocumentMeta>({
    loading: false,
    available: false,
    fileUrl: null,
    fileName: null,
    pageCount: null,
    error: null
  });

  const [planGuide, setPlanGuide] = useState('');
  const [guideSaving, setGuideSaving] = useState(false);
  const [guideSaved, setGuideSaved] = useState(false);
  const [extractingGuide, setExtractingGuide] = useState(false);
  const [extractGuideError, setExtractGuideError] = useState<string | null>(null);
  const [reparsing, setReparsing] = useState(false);
  const [reparseResult, setReparseResult] = useState<{ weeksProcessed: number; activitiesUpdated: number } | null>(null);
  const [reparseError, setReparseError] = useState<string | null>(null);
  const [expandedSessionInstructions, setExpandedSessionInstructions] = useState<Record<string, boolean>>({});
  const [activeFlowEditor, setActiveFlowEditor] = useState<{ activityId: string; path: number[] } | null>(null);
  const [recheckingDayId, setRecheckingDayId] = useState<string | null>(null);
  const [recheckErrors, setRecheckErrors] = useState<Record<string, string>>({});

  const daySaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const activitySaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const guideSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guideSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceToggleStorageKey = planId ? `review-source-pane:${planId}` : null;

  const initializeDrafts = useCallback((nextPlan: ReviewPlan, fallbackUnit: DistanceUnitValue) => {
    const nextDayDrafts: Record<string, string> = {};
    const nextExpandedDayNotes: Record<string, boolean> = {};
    const nextActivityDrafts: Record<string, ActivityDraft> = {};
    const nextExpandedActivityDetails: Record<string, boolean> = {};

    for (const week of nextPlan.weeks || []) {
      for (const day of week.days || []) {
        nextDayDrafts[day.id] = day.rawText || '';
        nextExpandedDayNotes[day.id] = false;
        for (const activity of day.activities || []) {
          nextActivityDrafts[activity.id] = toActivityDraft(activity, fallbackUnit);
          nextExpandedActivityDetails[activity.id] = false;
        }
      }
    }

    setDayDrafts(nextDayDrafts);
    setExpandedDayNotes(nextExpandedDayNotes);
    setActivityDrafts(nextActivityDrafts);
    setExpandedActivityDetails(nextExpandedActivityDetails);
  }, []);

  const loadPlan = useCallback(async () => {
    if (!planId) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    setSavingDayIds({});
    setQueuedDayIds({});
    setSavingActivityIds({});
    setQueuedActivityIds({});
    Object.values(daySaveTimersRef.current).forEach((timer) => clearTimeout(timer));
    Object.values(activitySaveTimersRef.current).forEach((timer) => clearTimeout(timer));
    daySaveTimersRef.current = {};
    activitySaveTimersRef.current = {};

    try {
      const res = await fetch(`/api/plans/${planId}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || 'Failed to load plan.');
        return;
      }
      const fetchedPlan = data?.plan as ReviewPlan;
      const units = data?.viewerUnits === 'KM' ? 'KM' : 'MILES';
      setViewerUnits(units);
      setPlan(fetchedPlan);
      setPlanGuide(fetchedPlan.planGuide ?? '');
      const nextRaceDate = toDateInputValue(fetchedPlan?.raceDate ?? null);
      setActivationRaceDate(nextRaceDate);
      setActivationStartDate('');
      setActivationWeekDateAnchor(nextRaceDate ? 'RACE_DATE' : 'START_DATE');
      initializeDrafts(fetchedPlan, units);
      return fetchedPlan;
    } catch {
      setError('Failed to load plan.');
    } finally {
      setLoading(false);
    }
  }, [planId, initializeDrafts]);

  const loadProfilePaces = useCallback(async () => {
    try {
      const res = await fetch('/api/me');
      const data = await res.json().catch(() => null);
      if (!res.ok) return;
      setProfilePaces(toProfilePaceMap(data?.paceTargets, viewerUnits));
    } catch {
      // Keep parsing review usable even if profile fetch fails.
    }
  }, [viewerUnits]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  useEffect(() => {
    void loadProfilePaces();
  }, [loadProfilePaces]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(min-width: 1100px)');
    const handleChange = () => setIsWideScreen(media.matches);
    handleChange();
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!sourceToggleStorageKey || typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(sourceToggleStorageKey);
    setShowSourcePdf(saved === '1');
  }, [sourceToggleStorageKey]);

  useEffect(() => {
    if (!sourceToggleStorageKey || typeof window === 'undefined') return;
    window.localStorage.setItem(sourceToggleStorageKey, showSourcePdf ? '1' : '0');
  }, [showSourcePdf, sourceToggleStorageKey]);

  const loadSourceDocument = useCallback(async () => {
    if (!planId) return;

    setSourceDocumentChecked(false);
    setSourceDocument((prev) => ({
      ...prev,
      loading: true,
      error: null
    }));

    try {
      const res = await fetch(`/api/plans/${planId}/source-document`, {
        cache: 'no-store'
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setSourceDocumentChecked(true);
        setSourceDocument({
          loading: false,
          available: false,
          fileUrl: null,
          fileName: null,
          pageCount: null,
          error: data?.error || 'Failed to load source PDF metadata.'
        });
        return;
      }

      if (!data?.available) {
        setSourceDocumentChecked(true);
        setSourceDocument({
          loading: false,
          available: false,
          fileUrl: null,
          fileName: null,
          pageCount: null,
          error: null
        });
        return;
      }

      setSourceDocumentChecked(true);
      setSourceDocument({
        loading: false,
        available: true,
        fileUrl: typeof data.fileUrl === 'string' ? data.fileUrl : `/api/plans/${planId}/source-document/file`,
        fileName: typeof data.fileName === 'string' ? data.fileName : 'Uploaded plan.pdf',
        pageCount: typeof data.pageCount === 'number' ? data.pageCount : null,
        error: null
      });
    } catch {
      setSourceDocumentChecked(true);
      setSourceDocument({
        loading: false,
        available: false,
        fileUrl: null,
        fileName: null,
        pageCount: null,
        error: 'Failed to load source PDF metadata.'
      });
    }
  }, [planId]);

  useEffect(() => {
    if (!planId || plan?.status === 'ACTIVE' || !isWideScreen) return;
    void loadSourceDocument();
  }, [isWideScreen, loadSourceDocument, plan?.status, planId]);

  useEffect(() => {
    return () => {
      Object.values(daySaveTimersRef.current).forEach((timer) => clearTimeout(timer));
      Object.values(activitySaveTimersRef.current).forEach((timer) => clearTimeout(timer));
      daySaveTimersRef.current = {};
      activitySaveTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (plan?.status === 'ACTIVE') {
      setNotice('Plan published. Continue to Today or personalize run paces now.');
      return;
    }
    if (hasParseWarning) {
      setNotice(
        parseWarningMsg
          ? `Automatic parse could not complete (${parseWarningMsg}). Fallback mode is active: review and add activities manually.`
          : 'Automatic parse could not complete. Fallback mode is active: review and add activities manually.'
      );
    } else if (arrivedFromUpload) {
      setNotice('Upload completed. Review and adjust activities before publishing.');
    } else {
      setNotice(null);
    }
  }, [arrivedFromUpload, hasParseWarning, parseWarningMsg, plan?.status]);

  useEffect(() => {
    if (hasParseWarning || sourceDocument.error) {
      setDiagnosticsOpen(true);
    }
  }, [hasParseWarning, sourceDocument.error]);

  useEffect(() => {
    if (!activeFlowEditor) return;
    const draft = activityDrafts[activeFlowEditor.activityId];
    if (!draft) {
      setActiveFlowEditor(null);
      return;
    }
    const selected = getStepAtPath(draft.structure, activeFlowEditor.path);
    if (!selected) setActiveFlowEditor(null);
  }, [activeFlowEditor, activityDrafts]);

  const goToDashboard = useCallback(() => {
    if (!planId) {
      window.location.href = '/dashboard';
      return;
    }
    const params = new URLSearchParams();
    params.set('activated', '1');
    params.set('plan', planId);
    window.location.href = `/dashboard?${params.toString()}`;
  }, [planId]);

  const loadPaceSources = useCallback(async () => {
    if (!planId) return;
    setPaceSourcesLoading(true);
    try {
      const res = await fetch(`/api/plans/${planId}/pace-personalize`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) return;
      const defaultDistance = Number(data.raceDistanceKmDefault);
      if (Number.isFinite(defaultDistance) && defaultDistance > 0) {
        setRaceDistanceKm(String(defaultDistance));
      }
      const strava = data.strava as {
        connected?: boolean;
        providerUsername?: string | null;
        lastSyncAt?: string | null;
        candidates?: StravaPaceCandidate[];
      } | undefined;
      setStravaConnected(Boolean(strava?.connected));
      setStravaUsername(strava?.providerUsername || null);
      setStravaLastSyncAt(strava?.lastSyncAt || null);
      const candidates = Array.isArray(strava?.candidates) ? strava.candidates : [];
      setStravaCandidates(candidates);
      if (candidates.length > 0) {
        setSelectedStravaId((prev) => prev || candidates[0].id);
      }
    } finally {
      setPaceSourcesLoading(false);
    }
  }, [planId]);

  const weeks = useMemo(() => {
    if (!plan?.weeks) return [];
    return [...plan.weeks].sort((a, b) => a.weekIndex - b.weekIndex);
  }, [plan]);

  const unassigned = useMemo(() => {
    if (!plan?.days) return [];
    return plan.days.filter((day) => !day.weekId);
  }, [plan]);

  const summary = useMemo(() => {
    const totalWeeks = plan?.weeks?.length || 0;
    const totalActivities = plan?.activities?.length || 0;
    const runActivities = (plan?.activities || []).filter((activity) => activity.type === 'RUN').length;
    const unassignedCount = unassigned?.length || 0;
    return { totalWeeks, totalActivities, runActivities, unassignedCount };
  }, [plan, unassigned]);

  const parseProfile = useMemo<ReviewProgramProfile | null>(() => {
    const source = plan?.parseProfile;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;

    const profile = source as Record<string, unknown>;
    const rawQuality = profile.includes_quality;
    const includesQuality = rawQuality && typeof rawQuality === 'object' && !Array.isArray(rawQuality)
      ? {
        intervals: Boolean((rawQuality as Record<string, unknown>).intervals),
        tempo: Boolean((rawQuality as Record<string, unknown>).tempo),
        hills: Boolean((rawQuality as Record<string, unknown>).hills),
        strides: Boolean((rawQuality as Record<string, unknown>).strides),
        strength: Boolean((rawQuality as Record<string, unknown>).strength),
        cross_training: Boolean((rawQuality as Record<string, unknown>).cross_training)
      }
      : null;

    const structureTags = Array.isArray(profile.structure_tags)
      ? profile.structure_tags
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
      : [];

    return {
      plan_length_weeks: toFiniteNumber(profile.plan_length_weeks),
      days_per_week: toFiniteNumber(profile.days_per_week),
      distance_type: toStringValue(profile.distance_type),
      intensity_model: toStringValue(profile.intensity_model),
      units: toStringValue(profile.units),
      language_hint: toStringValue(profile.language_hint),
      peak_week_km: toFiniteNumber(profile.peak_week_km),
      peak_long_run_km: toFiniteNumber(profile.peak_long_run_km),
      taper_weeks: toFiniteNumber(profile.taper_weeks),
      structure_tags: structureTags,
      includes_quality: includesQuality
    };
  }, [plan?.parseProfile]);

  const qualityFlags = useMemo(() => {
    if (!parseProfile?.includes_quality) return [];
    const entries: Array<{ key: keyof NonNullable<ReviewProgramProfile['includes_quality']>; label: string }> = [
      { key: 'intervals', label: 'Intervals' },
      { key: 'tempo', label: 'Tempo' },
      { key: 'hills', label: 'Hills' },
      { key: 'strides', label: 'Strides' },
      { key: 'strength', label: 'Strength' },
      { key: 'cross_training', label: 'Cross training' }
    ];
    return entries.filter((entry) => parseProfile.includes_quality?.[entry.key]).map((entry) => entry.label);
  }, [parseProfile]);

  const autosaveState = useMemo(() => {
    const queuedCount = Object.keys(queuedDayIds).length + Object.keys(queuedActivityIds).length;
    const savingCount = Object.keys(savingDayIds).length + Object.keys(savingActivityIds).length;
    const busy = queuedCount + savingCount > 0 || guideSaving;
    const label = busy
      ? 'Saving changes…'
      : lastSavedAt
        ? `All changes saved at ${formatSavedTime(lastSavedAt)}`
        : 'Changes save automatically';
    return { busy, label };
  }, [lastSavedAt, queuedActivityIds, queuedDayIds, savingActivityIds, savingDayIds, guideSaving]);
  const isActivated = plan?.status === 'ACTIVE';
  const effectiveRunCount = Math.max(paceRunCount, summary.runActivities);
  const showPaceCta = effectiveRunCount > 0;

  useEffect(() => {
    if (!paceFormOpen || !isActivated || !showPaceCta) return;
    void loadPaceSources();
  }, [isActivated, loadPaceSources, paceFormOpen, showPaceCta]);

  const raceDistanceValue = Number(raceDistanceKm);

  const manualEvidence = useMemo<PaceEvidence[]>(() => (
    manualResults.flatMap((item) => {
      const distanceKm = Number(item.distanceKm);
      const timeSec = parseTimePartsToSeconds(item.hours, item.minutes, item.seconds);
      if (!Number.isFinite(distanceKm) || distanceKm <= 0 || !timeSec || timeSec < 60) return [];
      return [{
        source: 'MANUAL' as const,
        label: item.label || null,
        distanceKm,
        timeSec,
        dateISO: item.dateISO || null
      }];
    })
  ), [manualResults]);

  const selectedStravaCandidate = useMemo(
    () => stravaCandidates.find((item) => item.id === selectedStravaId) || null,
    [selectedStravaId, stravaCandidates]
  );

  const evidenceEstimate = useMemo(() => {
    if (!Number.isFinite(raceDistanceValue) || raceDistanceValue <= 0) return null;
    if (paceSource === 'PAST_RESULT') {
      return estimateGoalTimeFromEvidence({
        targetDistanceKm: raceDistanceValue,
        evidence: manualEvidence
      });
    }
    if (paceSource === 'STRAVA' && selectedStravaCandidate) {
      return estimateGoalTimeFromEvidence({
        targetDistanceKm: raceDistanceValue,
        evidence: [{
          source: 'STRAVA',
          label: selectedStravaCandidate.label,
          distanceKm: selectedStravaCandidate.distanceKm,
          timeSec: selectedStravaCandidate.timeSec,
          dateISO: selectedStravaCandidate.dateISO
        }]
      });
    }
    return null;
  }, [manualEvidence, paceSource, raceDistanceValue, selectedStravaCandidate]);

  const targetGoalTimeSec = useMemo(() => {
    if (paceSource === 'TARGET_TIME') {
      return parseTimePartsToSeconds(goalHours, goalMinutes, goalSeconds);
    }
    return evidenceEstimate?.goalTimeSec || null;
  }, [evidenceEstimate, goalHours, goalMinutes, goalSeconds, paceSource]);

  const pacePreview = useMemo(() => {
    if (!targetGoalTimeSec || targetGoalTimeSec < 600 || !Number.isFinite(raceDistanceValue) || raceDistanceValue <= 0) {
      return null;
    }
    return {
      race: formatPace(targetGoalTimeSec, raceDistanceValue, PACE_MULTIPLIERS.RACE, viewerUnits),
      long: formatPace(targetGoalTimeSec, raceDistanceValue, PACE_MULTIPLIERS.LONG, viewerUnits),
      easy: formatPace(targetGoalTimeSec, raceDistanceValue, PACE_MULTIPLIERS.EASY, viewerUnits),
      tempo: formatPace(targetGoalTimeSec, raceDistanceValue, PACE_MULTIPLIERS.TEMPO, viewerUnits),
      interval: formatPace(targetGoalTimeSec, raceDistanceValue, PACE_MULTIPLIERS.INTERVAL, viewerUnits)
    };
  }, [raceDistanceValue, targetGoalTimeSec, viewerUnits]);

  const persistDay = useCallback(
    async (dayId: string, rawText: string) => {
      if (!planId) return;

      setQueuedDayIds((prev) => setFlag(prev, dayId, false));
      setSavingDayIds((prev) => setFlag(prev, dayId, true));
      setError(null);

      try {
        const res = await fetch(`/api/plans/${planId}/review/days/${dayId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawText })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error || 'Failed to autosave day notes');
          return;
        }
        const updatedDay = data?.day as ReviewDay;
        setPlan((prev) => {
          if (!prev) return prev;
          return applyDayUpdateToPlan(prev, dayId, () => ({
            ...updatedDay,
            activities: updatedDay.activities as ReviewActivity[]
          }));
        });
        setLastSavedAt(Date.now());
      } catch {
        setError('Failed to autosave day notes');
      } finally {
        setSavingDayIds((prev) => setFlag(prev, dayId, false));
      }
    },
    [planId]
  );

  const queueDayAutosave = useCallback(
    (dayId: string, rawText: string) => {
      const existing = daySaveTimersRef.current[dayId];
      if (existing) clearTimeout(existing);
      setQueuedDayIds((prev) => setFlag(prev, dayId, true));
      daySaveTimersRef.current[dayId] = setTimeout(() => {
        delete daySaveTimersRef.current[dayId];
        void persistDay(dayId, rawText);
      }, 700);
    },
    [persistDay]
  );

  const setDayDraftField = useCallback(
    (dayId: string, value: string) => {
      setDayDrafts((prev) => ({ ...prev, [dayId]: value }));
      queueDayAutosave(dayId, value);
    },
    [queueDayAutosave]
  );

  const persistActivity = useCallback(
    async (activityId: string, draft: ActivityDraft) => {
      if (!planId) return;
      if (!draft.title.trim()) return;

      const parsedDistance = draft.distance.trim() === '' ? null : Number(draft.distance);
      const parsedDuration = draft.duration.trim() === '' ? null : Number(draft.duration);

      if (parsedDistance !== null && (!Number.isFinite(parsedDistance) || parsedDistance < 0)) return;
      if (
        parsedDuration !== null
        && (!Number.isFinite(parsedDuration) || parsedDuration < 0 || !Number.isInteger(parsedDuration))
      ) return;

      const resolvedDistanceUnit = (draft.distanceUnit || viewerUnits) as DistanceUnitValue;
      setQueuedActivityIds((prev) => setFlag(prev, activityId, false));
      setSavingActivityIds((prev) => setFlag(prev, activityId, true));
      setError(null);

      try {
        const res = await fetch(`/api/plans/${planId}/review/activities/${activityId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: draft.title.trim(),
            type: draft.type,
            distance: parsedDistance,
            distanceUnit: parsedDistance === null ? null : resolvedDistanceUnit,
            duration: parsedDuration,
            paceTargetBucket: draft.paceTargetBucket || null,
            paceTarget: draft.paceTarget.trim() || null,
            effortTarget: draft.effortTarget.trim() || null,
            rawText: draft.rawText.trim() || null,
            sessionInstructions: draft.sessionInstructions.trim() || null,
            structure: Array.isArray(draft.structure) ? draft.structure : null
          })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error || 'Failed to autosave activity');
          return;
        }
        const updatedActivity = data?.activity as ReviewActivity;
        setPlan((prev) => {
          if (!prev) return prev;
          return applyActivityUpdateToPlan(prev, activityId, () => updatedActivity);
        });
        setLastSavedAt(Date.now());
      } catch {
        setError('Failed to autosave activity');
      } finally {
        setSavingActivityIds((prev) => setFlag(prev, activityId, false));
      }
    },
    [planId, viewerUnits]
  );

  const queueActivityAutosave = useCallback(
    (activityId: string, draft: ActivityDraft) => {
      const existing = activitySaveTimersRef.current[activityId];
      if (existing) clearTimeout(existing);
      setQueuedActivityIds((prev) => setFlag(prev, activityId, true));
      activitySaveTimersRef.current[activityId] = setTimeout(() => {
        delete activitySaveTimersRef.current[activityId];
        void persistActivity(activityId, draft);
      }, 700);
    },
    [persistActivity]
  );

  const setActivityDraftField = useCallback(
    (
      activityId: string,
      field: Exclude<keyof ActivityDraft, 'structure'>,
      value: string
    ) => {
      setActivityDrafts((prev) => {
        const current = prev[activityId];
        if (!current) return prev;
        const nextDraft = { ...current, [field]: value } as ActivityDraft;
        if (field === 'type' && value !== 'RUN') {
          nextDraft.paceTargetBucket = '';
        }
        queueActivityAutosave(activityId, nextDraft);
        return {
          ...prev,
          [activityId]: nextDraft
        };
      });
    },
    [queueActivityAutosave]
  );

  const updateFlowStep = useCallback((
    activityId: string,
    path: number[],
    updater: (step: SessionStepNode) => SessionStepNode,
  ) => {
    setActivityDrafts((prev) => {
      const current = prev[activityId];
      if (!current) return prev;
      const nextSteps = cloneStructureSteps(current.structure);
      const target = getStepContainerAtPath(nextSteps, path);
      if (!target) return prev;
      const nextStep = updater(target.container[target.index]);
      target.container[target.index] = nextStep;
      const nextDraft: ActivityDraft = { ...current, structure: nextSteps };
      queueActivityAutosave(activityId, nextDraft);
      return {
        ...prev,
        [activityId]: nextDraft
      };
    });
  }, [queueActivityAutosave]);

  const moveFlowStep = useCallback((
    activityId: string,
    path: number[],
    direction: -1 | 1,
  ) => {
    let nextEditorPath: number[] | null = null;
    setActivityDrafts((prev) => {
      const current = prev[activityId];
      if (!current) return prev;
      const nextSteps = cloneStructureSteps(current.structure);
      const target = getStepContainerAtPath(nextSteps, path);
      if (!target) return prev;
      const nextIndex = target.index + direction;
      if (nextIndex < 0 || nextIndex >= target.container.length) return prev;
      const moved = target.container[target.index];
      target.container[target.index] = target.container[nextIndex];
      target.container[nextIndex] = moved;
      const nextPath = [...path];
      nextPath[nextPath.length - 1] = nextIndex;
      nextEditorPath = nextPath;
      const nextDraft: ActivityDraft = { ...current, structure: nextSteps };
      queueActivityAutosave(activityId, nextDraft);
      return {
        ...prev,
        [activityId]: nextDraft
      };
    });
    if (nextEditorPath) {
      setActiveFlowEditor({ activityId, path: nextEditorPath });
    }
  }, [queueActivityAutosave]);

  const deleteFlowStep = useCallback((activityId: string, path: number[]) => {
    setActivityDrafts((prev) => {
      const current = prev[activityId];
      if (!current) return prev;
      const nextSteps = cloneStructureSteps(current.structure);
      const target = getStepContainerAtPath(nextSteps, path);
      if (!target) return prev;
      target.container.splice(target.index, 1);
      const nextDraft: ActivityDraft = { ...current, structure: nextSteps };
      queueActivityAutosave(activityId, nextDraft);
      return {
        ...prev,
        [activityId]: nextDraft
      };
    });
    setActiveFlowEditor(null);
  }, [queueActivityAutosave]);

  const addFlowStep = useCallback((activityId: string) => {
    let createdPath: number[] | null = null;
    setActivityDrafts((prev) => {
      const current = prev[activityId];
      if (!current) return prev;
      const nextSteps = cloneStructureSteps(current.structure);
      nextSteps.push({ type: 'distance' });
      createdPath = [nextSteps.length - 1];
      const nextDraft: ActivityDraft = { ...current, structure: nextSteps };
      queueActivityAutosave(activityId, nextDraft);
      return {
        ...prev,
        [activityId]: nextDraft
      };
    });
    if (createdPath) {
      setActiveFlowEditor({ activityId, path: createdPath });
    }
  }, [queueActivityAutosave]);

  const persistPlanGuide = useCallback(
    async (value: string) => {
      if (!planId) return;
      setGuideSaving(true);
      try {
        const res = await fetch(`/api/plans/${planId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planGuide: value })
        });
        if (!res.ok) return;
        if (guideSavedTimerRef.current) clearTimeout(guideSavedTimerRef.current);
        setGuideSaved(true);
        guideSavedTimerRef.current = setTimeout(() => setGuideSaved(false), 2500);
      } catch {
        // Silently fail — guide save is best-effort
      } finally {
        setGuideSaving(false);
      }
    },
    [planId]
  );

  const handleGuideChange = useCallback((value: string) => {
    setPlanGuide(value);
    if (guideSaveTimerRef.current) clearTimeout(guideSaveTimerRef.current);
    guideSaveTimerRef.current = setTimeout(() => {
      void persistPlanGuide(value);
    }, 800);
  }, [persistPlanGuide]);

  const handleExtractGuide = useCallback(async () => {
    if (!planId || extractingGuide) return;
    setExtractingGuide(true);
    setExtractGuideError(null);
    try {
      const res = await fetch(`/api/plans/${planId}/extract-guide`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setExtractGuideError(data?.error || 'Guide extraction failed');
        return;
      }
      if (data?.planGuide) {
        setPlanGuide(data.planGuide);
      }
    } catch {
      setExtractGuideError('Guide extraction failed');
    } finally {
      setExtractingGuide(false);
    }
  }, [planId, extractingGuide]);

  const handleReparse = useCallback(async () => {
    if (!planId || reparsing) return;
    setReparsing(true);
    setReparseResult(null);
    setReparseError(null);
    try {
      const res = await fetch(`/api/plans/${planId}/reparse`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setReparseError(data?.error || 'Re-parse failed');
        return;
      }
      setReparseResult({
        weeksProcessed: Number(data?.weeksProcessed ?? 0),
        activitiesUpdated: Number(data?.activitiesUpdated ?? 0)
      });
      router.refresh();
      const refreshedPlan = await loadPlan();
      if (refreshedPlan) {
        const expanded: Record<string, boolean> = {};
        for (const week of refreshedPlan.weeks) {
          for (const day of week.days) {
            for (const activity of day.activities) {
              if (activity.sessionInstructions) expanded[activity.id] = true;
            }
          }
        }
        if (Object.keys(expanded).length > 0) setExpandedSessionInstructions(expanded);
      }
    } catch {
      setReparseError('Re-parse failed');
    } finally {
      setReparsing(false);
    }
  }, [loadPlan, planId, reparsing, router]);

  const handleRecheckDay = useCallback(async (dayId: string, weekIndex: number, dayOfWeek: number) => {
    if (!planId || recheckingDayId) return;
    setRecheckingDayId(dayId);
    setRecheckErrors((prev) => ({ ...prev, [dayId]: '' }));
    try {
      const res = await fetch(`/api/plans/${planId}/reparse-day`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekIndex, dayOfWeek })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRecheckErrors((prev) => ({ ...prev, [dayId]: data?.error || 'Re-check failed' }));
        return;
      }
      // Patch plan state with refreshed day activities
      const freshActivities: ReviewActivity[] = (data?.day?.activities ?? []) as ReviewActivity[];
      if (freshActivities.length > 0) {
        setPlan((prev) => {
          if (!prev) return prev;
          return applyDayUpdateToPlan(prev, dayId, (d) => ({ ...d, activities: freshActivities }));
        });
        // Re-init drafts for the updated activities
        const fallbackUnit = viewerUnits === 'KM' ? 'KM' : 'MILES';
        setActivityDrafts((prev) => {
          const next = { ...prev };
          for (const activity of freshActivities) {
            next[activity.id] = toActivityDraft(activity, fallbackUnit);
          }
          return next;
        });
        // Auto-expand session instructions for activities that have them
        setExpandedSessionInstructions((prev) => {
          const next = { ...prev };
          for (const activity of freshActivities) {
            if (activity.sessionInstructions) next[activity.id] = true;
          }
          return next;
        });
      }
    } catch {
      setRecheckErrors((prev) => ({ ...prev, [dayId]: 'Re-check failed' }));
    } finally {
      setRecheckingDayId(null);
    }
  }, [planId, recheckingDayId, viewerUnits]);

  const applyPaceBucket = useCallback(
    (activityId: string, bucket: PaceBucketValue) => {
      setActivityDrafts((prev) => {
        const current = prev[activityId];
        if (!current) return prev;

        const nextBucket = current.paceTargetBucket === bucket ? '' : bucket;
        const profilePace = nextBucket ? profilePaces[nextBucket] : null;
        const nextDraft: ActivityDraft = {
          ...current,
          paceTargetBucket: nextBucket,
          paceTarget: profilePace || current.paceTarget
        };

        queueActivityAutosave(activityId, nextDraft);
        return {
          ...prev,
          [activityId]: nextDraft
        };
      });
    },
    [profilePaces, queueActivityAutosave]
  );

  useEffect(() => {
    if (Object.keys(profilePaces).length === 0) return;
    setActivityDrafts((prev) => {
      let changed = false;
      const next: Record<string, ActivityDraft> = { ...prev };
      for (const [activityId, draft] of Object.entries(prev)) {
        if (draft.type !== 'RUN') continue;
        if (draft.paceTarget.trim()) continue;
        if (!draft.paceTargetBucket) continue;
        const profilePace = profilePaces[draft.paceTargetBucket];
        if (!profilePace) continue;
        const updatedDraft: ActivityDraft = { ...draft, paceTarget: profilePace };
        next[activityId] = updatedDraft;
        queueActivityAutosave(activityId, updatedDraft);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [profilePaces, queueActivityAutosave]);

  const addActivity = useCallback(
    async (dayId: string) => {
      if (!planId) return;
      setCreatingDayId(dayId);
      setError(null);
      setNotice(null);

      try {
        const res = await fetch(`/api/plans/${planId}/review/days/${dayId}/activities`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error || 'Failed to add activity');
          return;
        }
        const createdActivity = data?.activity as ReviewActivity;
        setPlan((prev) => (prev ? appendActivityToDayPlan(prev, dayId, createdActivity) : prev));
        setActivityDrafts((prev) => ({ ...prev, [createdActivity.id]: toActivityDraft(createdActivity, viewerUnits) }));
        setExpandedActivityDetails((prev) => ({ ...prev, [createdActivity.id]: true }));
        setNotice('Activity added');
      } catch {
        setError('Failed to add activity');
      } finally {
        setCreatingDayId(null);
      }
    },
    [planId, viewerUnits]
  );

  const deleteActivity = useCallback(
    async (activityId: string) => {
      if (!planId) return;
      const timer = activitySaveTimersRef.current[activityId];
      if (timer) {
        clearTimeout(timer);
        delete activitySaveTimersRef.current[activityId];
      }
      setQueuedActivityIds((prev) => setFlag(prev, activityId, false));
      setSavingActivityIds((prev) => setFlag(prev, activityId, false));
      setDeletingActivityId(activityId);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch(`/api/plans/${planId}/review/activities/${activityId}`, {
          method: 'DELETE'
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error || 'Failed to delete activity');
          return;
        }
        setPlan((prev) => (prev ? removeActivityFromPlan(prev, activityId) : prev));
        setActivityDrafts((prev) => {
          const next = { ...prev };
          delete next[activityId];
          return next;
        });
        setExpandedActivityDetails((prev) => {
          const next = { ...prev };
          delete next[activityId];
          return next;
        });
        setLastSavedAt(Date.now());
        setNotice('Activity removed');
      } catch {
        setError('Failed to delete activity');
      } finally {
        setDeletingActivityId(null);
      }
    },
    [planId]
  );

  const handlePublish = useCallback(async () => {
    if (!planId) return;
    if (autosaveState.busy) {
      setError('Please wait until all autosave changes are complete before publishing.');
      return;
    }
    if (activationWeekDateAnchor === 'RACE_DATE' && !activationRaceDate) {
      setError('Race date is required to activate with race-date scheduling.');
      return;
    }
    if (activationWeekDateAnchor === 'START_DATE' && !activationStartDate) {
      setError('Training start date is required to activate with Week 1 scheduling.');
      return;
    }
    setPublishing(true);
    setError(null);
    setNotice(null);

    Object.values(daySaveTimersRef.current).forEach((timer) => clearTimeout(timer));
    Object.values(activitySaveTimersRef.current).forEach((timer) => clearTimeout(timer));
    daySaveTimersRef.current = {};
    activitySaveTimersRef.current = {};
    setQueuedDayIds({});
    setQueuedActivityIds({});

    try {
      const payload: Record<string, string> = { weekDateAnchor: activationWeekDateAnchor };
      if (activationWeekDateAnchor === 'RACE_DATE' && activationRaceDate) {
        payload.raceDate = activationRaceDate;
      }
      if (activationWeekDateAnchor === 'START_DATE' && activationStartDate) {
        payload.startDate = activationStartDate;
      }
      const res = await fetch(`/api/plans/${planId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Publish failed');
      const runCount = Number(data?.runActivityCount || 0);
      setPlan((prev) => (prev ? { ...prev, status: 'ACTIVE' } : prev));
      setPaceRunCount(runCount);
      if (runCount > 0) {
        setPaceFormOpen(false);
        setPaceStep(1);
        setPaceSource('TARGET_TIME');
        setPaceModalError(null);
        setNotice('Plan published. Continue to dashboard or personalize run paces now.');
        return;
      }
      goToDashboard();
    } catch (publishError: unknown) {
      setError(publishError instanceof Error ? publishError.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  }, [activationRaceDate, activationStartDate, activationWeekDateAnchor, autosaveState.busy, goToDashboard, planId]);

  const setManualField = useCallback((id: string, field: keyof ManualResultDraft, value: string) => {
    setManualResults((prev) => prev.map((item) => (
      item.id === id ? { ...item, [field]: value } : item
    )));
  }, []);

  const addManualResult = useCallback(() => {
    setManualResults((prev) => [...prev, makeManualResult()]);
  }, []);

  const removeManualResult = useCallback((id: string) => {
    setManualResults((prev) => (prev.length > 1 ? prev.filter((item) => item.id !== id) : prev));
  }, []);

  const continuePaceSetup = useCallback(() => {
    setPaceModalError(null);
    if (!Number.isFinite(raceDistanceValue) || raceDistanceValue <= 0) {
      setPaceModalError('Goal race distance must be greater than 0.');
      return;
    }

    if (paceSource === 'TARGET_TIME') {
      const parsed = parseTimePartsToSeconds(goalHours, goalMinutes, goalSeconds);
      if (!parsed || parsed < 600) {
        setPaceModalError('Please enter a valid target race time of at least 10 minutes.');
        return;
      }
    }

    if (paceSource === 'PAST_RESULT' && manualEvidence.length === 0) {
      setPaceModalError('Add at least one valid past race/workout result.');
      return;
    }

    if (paceSource === 'STRAVA' && !selectedStravaId) {
      setPaceModalError('Select one Strava best effort to continue.');
      return;
    }

    if (!targetGoalTimeSec || targetGoalTimeSec < 600) {
      setPaceModalError('Could not estimate a valid target time from your input.');
      return;
    }

    setPaceStep(2);
  }, [
    goalHours,
    goalMinutes,
    goalSeconds,
    manualEvidence.length,
    paceSource,
    raceDistanceValue,
    selectedStravaId,
    targetGoalTimeSec
  ]);

  const applyPacePersonalization = useCallback(async () => {
    if (!planId) return;
    if (!Number.isFinite(raceDistanceValue) || raceDistanceValue <= 0) {
      setPaceModalError('Race distance must be greater than 0.');
      return;
    }
    if (!targetGoalTimeSec || targetGoalTimeSec < 600) {
      setPaceModalError('A valid target time is required.');
      return;
    }

    setPaceApplying(true);
    setPaceModalError(null);
    try {
      const payload: Record<string, unknown> = {
        raceDistanceKm: raceDistanceValue,
        targetGoalTimeSec,
        overrideExisting: overrideExistingPaces,
        saveToProfile: savePaceProfile,
        age: athleteAge.trim() ? Number(athleteAge) : null,
        sex: athleteSex.trim() || null
      };

      if (paceSource === 'TARGET_TIME') {
        payload.goalHours = Number(goalHours || 0);
        payload.goalMinutes = Number(goalMinutes || 0);
        payload.goalSeconds = Number(goalSeconds || 0);
      }
      if (paceSource === 'PAST_RESULT') {
        payload.manualEvidence = manualEvidence;
      }
      if (paceSource === 'STRAVA') {
        payload.stravaActivityId = selectedStravaId || null;
      }

      const res = await fetch(`/api/plans/${planId}/pace-personalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setPaceModalError(data?.error || 'Failed to personalize paces.');
        return;
      }
      const personalized = Number(data?.summary?.updated || 0);
      setNotice(`Pace targets personalized for ${personalized} run activities.`);
      goToDashboard();
    } catch {
      setPaceModalError('Failed to personalize paces.');
    } finally {
      setPaceApplying(false);
    }
  }, [
    athleteAge,
    athleteSex,
    goalHours,
    goalMinutes,
    goalSeconds,
    manualEvidence,
    overrideExistingPaces,
    paceSource,
    planId,
    raceDistanceValue,
    savePaceProfile,
    selectedStravaId,
    targetGoalTimeSec,
    goToDashboard
  ]);

  const sourcePaneAvailable = !isActivated && isWideScreen && sourceDocument.available;
  const showDesktopSourcePane = sourcePaneAvailable && showSourcePdf;
  const hasSourceUnavailableNote = (
    !isActivated
    && isWideScreen
    && sourceDocumentChecked
    && !sourceDocument.loading
    && !sourceDocument.available
    && !sourceDocument.error
  );
  const hasDiagnostics = !isActivated && (
    hasParseWarning
    || Boolean(parseProfile)
    || Boolean(sourceDocument.error)
    || hasSourceUnavailableNote
  );

  if (loading) {
    return (
      <main className="review-page-shell">
        <section className="review-page-card">
          <p className="review-muted">Loading review workspace…</p>
        </section>
      </main>
    );
  }

  if (!plan) {
    return (
      <main className="review-page-shell">
        <section className="review-page-card">
          <p className="review-error">{error || 'Plan not found'}</p>
        </section>
      </main>
    );
  }

  if (!isWideScreen) {
    return (
      <main className="review-page-shell review-mobile-guard-shell">
        <section className="review-page-card review-mobile-guard-card">
          <h1>Desktop Required</h1>
          <p>
            Parsing review is optimized for desktop screens (1100px and wider). Open this page on desktop to
            validate and edit activities safely.
          </p>
          <div className="review-mobile-guard-actions">
            {isActivated ? (
              <button className="cta" type="button" onClick={goToDashboard}>
                Go to Today
              </button>
            ) : (
              <Link className="cta" href="/plans">
                Back to Plans
              </Link>
            )}
            <Link className="cta secondary" href={`/plans/${plan.id}`}>
              View Plan
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`review-page-shell${showDesktopSourcePane ? ' with-source-pane' : ''}`}>
      <section className={`review-page-card review-hero${isActivated ? ' review-hero-live' : ''}`}>
        <div className="review-hero-head review-action-bar">
          <div>
            <h1>
              {isActivated
                ? 'Plan is live'
                : (arrivedFromUpload ? 'Confirm Parse and Activate Plan' : 'Review and Edit Before Publish')}
            </h1>
            <p>
              Plan: <strong>{plan.name}</strong>
              {!isActivated && <> · Status: <strong>{plan.status}</strong></>}
            </p>
            {debugMode && parserPromptName && (
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#888' }}>
                Parser prompt: <code style={{ background: 'rgba(0,0,0,0.06)', borderRadius: 3, padding: '1px 5px' }}>{parserPromptName}</code>
              </p>
            )}
            {!isActivated && arrivedFromUpload && (
              <p className="review-publish-copy">
                You are one step away. Confirm this parsed plan, then activate it to unlock Today and Training Calendar.
              </p>
            )}
            {!isActivated && (
              <div className="review-activation-schedule">
                <p className="review-publish-copy">
                  Scheduling is applied at activation. Choose how calendar week dates should be anchored.
                </p>
                <div className="review-source-row">
                  <button
                    type="button"
                    className={`review-source-chip${activationWeekDateAnchor === 'RACE_DATE' ? ' active' : ''}`}
                    onClick={() => setActivationWeekDateAnchor('RACE_DATE')}
                  >
                    Race date
                  </button>
                  <button
                    type="button"
                    className={`review-source-chip${activationWeekDateAnchor === 'START_DATE' ? ' active' : ''}`}
                    onClick={() => setActivationWeekDateAnchor('START_DATE')}
                  >
                    Training start date (W1)
                  </button>
                </div>
                <label className="review-field review-activation-date-field">
                  <span>{activationWeekDateAnchor === 'RACE_DATE' ? 'Race date' : 'Training start date (Week 1)'}</span>
                  <input
                    type="date"
                    value={activationWeekDateAnchor === 'RACE_DATE' ? activationRaceDate : activationStartDate}
                    onChange={(event) => {
                      if (activationWeekDateAnchor === 'RACE_DATE') setActivationRaceDate(event.target.value);
                      else setActivationStartDate(event.target.value);
                    }}
                  />
                </label>
              </div>
            )}
            {isActivated && (
              <p className="review-publish-copy">
                Your training plan is active. Open Today to start logging, and personalize pace targets when ready.
              </p>
            )}
          </div>
          <div className="review-hero-actions">
            {isActivated ? (
              <>
                <button className="cta" type="button" onClick={goToDashboard}>
                  Go to Today
                </button>
                <Link className="cta secondary" href={`/plans/${plan.id}`}>View Plan</Link>
              </>
            ) : (
              <>
                <button className="cta" onClick={handlePublish} disabled={publishing || autosaveState.busy}>
                  {publishing ? (arrivedFromUpload ? 'Activating…' : 'Publishing…') : (arrivedFromUpload ? 'Activate Plan' : 'Publish Plan')}
                </button>
                <Link className="cta secondary" href="/plans">Save as Draft</Link>
                <Link className="cta secondary" href={`/plans/${plan.id}`}>View Plan</Link>
                <button
                  className="cta secondary"
                  type="button"
                  onClick={() => {
                    if (!sourceDocument.available) return;
                    setShowSourcePdf((prev) => !prev);
                  }}
                  disabled={sourceDocument.loading || !sourceDocument.available}
                >
                  {sourceDocument.loading
                    ? 'Loading Source PDF…'
                    : sourceDocument.available
                      ? (showSourcePdf ? 'Hide Source PDF' : 'Show Source PDF')
                      : 'Source PDF Unavailable'}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="review-stats-grid">
          <div>
            <strong>{summary.totalWeeks}</strong>
            <span>Weeks parsed</span>
          </div>
          <div>
            <strong>{summary.totalActivities}</strong>
            <span>Activities</span>
          </div>
          <div>
            <strong>{summary.runActivities}</strong>
            <span>Run activities</span>
          </div>
        </div>

        {parseProfile && (
          <div className="review-profile-panel">
            <div className="review-profile-head">
              <h3>Detected Plan Profile</h3>
              <p>Auto-inferred document context used to guide structured parsing.</p>
            </div>
            <div className="review-profile-grid">
              <div>
                <strong>{parseProfile.plan_length_weeks ?? summary.totalWeeks}</strong>
                <span>Plan length (weeks)</span>
              </div>
              <div>
                <strong>{parseProfile.days_per_week ?? '—'}</strong>
                <span>Days per week</span>
              </div>
              <div>
                <strong>{humanizeToken(parseProfile.distance_type)}</strong>
                <span>Distance type</span>
              </div>
              <div>
                <strong>{humanizeToken(parseProfile.intensity_model)}</strong>
                <span>Intensity model</span>
              </div>
              <div>
                <strong>{humanizeToken(parseProfile.units)}</strong>
                <span>Units</span>
              </div>
              <div>
                <strong>{humanizeToken(parseProfile.language_hint)}</strong>
                <span>Language hint</span>
              </div>
              <div>
                <strong>{parseProfile.peak_week_km !== null ? `${parseProfile.peak_week_km.toFixed(1)} km` : '—'}</strong>
                <span>Peak week</span>
              </div>
              <div>
                <strong>{parseProfile.peak_long_run_km !== null ? `${parseProfile.peak_long_run_km.toFixed(1)} km` : '—'}</strong>
                <span>Peak long run</span>
              </div>
              <div>
                <strong>{parseProfile.taper_weeks ?? '—'}</strong>
                <span>Taper weeks</span>
              </div>
            </div>

            {(qualityFlags.length > 0 || parseProfile.structure_tags.length > 0) && (
              <div className="review-profile-tags">
                {qualityFlags.map((label) => (
                  <span key={`quality-${label}`} className="review-profile-tag">{label}</span>
                ))}
                {parseProfile.structure_tags.map((tag) => (
                  <span key={`tag-${tag}`} className="review-profile-tag alt">{humanizeToken(tag)}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {!isActivated && (
          <p className={`review-autosave ${autosaveState.busy ? 'busy' : ''}`}>{autosaveState.label}</p>
        )}

        {notice && <p className="review-notice">{notice}</p>}
        {error && <p className="review-error">{error}</p>}
      </section>

      {!isActivated && hasDiagnostics && (
        <section className="review-page-card review-diagnostics-panel">
          <div className="review-diagnostics-head">
            <div>
              <h3>Parser diagnostics</h3>
              <p>Details from parsing and source detection. Keep collapsed unless you are troubleshooting.</p>
            </div>
            <button
              className="review-save-btn secondary"
              type="button"
              onClick={() => setDiagnosticsOpen((prev) => !prev)}
            >
              {diagnosticsOpen ? 'Hide diagnostics' : 'Show diagnostics'}
            </button>
          </div>

          {diagnosticsOpen && (
            <div className="review-diagnostics-body">
              {hasParseWarning && (
                <div className="review-fallback-panel">
                  <div className="review-fallback-copy">
                    <h3>Parse needs manual confirmation</h3>
                    <p>
                      We created a safe draft so you can keep moving. Choose one recovery path below, then activate once the plan looks right.
                    </p>
                    {parseWarningMsg && (
                      <p className="review-fallback-detail">
                        Parser warning: {parseWarningMsg}
                      </p>
                    )}
                  </div>
                  <div className="review-fallback-actions">
                    <Link className="cta secondary" href="/upload">Re-upload PDF</Link>
                    <a className="cta secondary" href="#review-week-grid">Continue Manual Review</a>
                    <Link className="cta secondary" href="/plans">Use Template Instead</Link>
                  </div>
                </div>
              )}

              {parseProfile && (
                <div className="review-profile-panel">
                  <div className="review-profile-head">
                    <h3>Detected Plan Profile</h3>
                    <p>Auto-inferred document context used to guide structured parsing.</p>
                  </div>
                  <div className="review-profile-grid">
                    <div>
                      <strong>{parseProfile.plan_length_weeks ?? summary.totalWeeks}</strong>
                      <span>Plan length (weeks)</span>
                    </div>
                    <div>
                      <strong>{parseProfile.days_per_week ?? '—'}</strong>
                      <span>Days per week</span>
                    </div>
                    <div>
                      <strong>{humanizeToken(parseProfile.distance_type)}</strong>
                      <span>Distance type</span>
                    </div>
                    <div>
                      <strong>{humanizeToken(parseProfile.intensity_model)}</strong>
                      <span>Intensity model</span>
                    </div>
                    <div>
                      <strong>{humanizeToken(parseProfile.units)}</strong>
                      <span>Units</span>
                    </div>
                    <div>
                      <strong>{humanizeToken(parseProfile.language_hint)}</strong>
                      <span>Language hint</span>
                    </div>
                    <div>
                      <strong>{parseProfile.peak_week_km !== null ? `${parseProfile.peak_week_km.toFixed(1)} km` : '—'}</strong>
                      <span>Peak week</span>
                    </div>
                    <div>
                      <strong>{parseProfile.peak_long_run_km !== null ? `${parseProfile.peak_long_run_km.toFixed(1)} km` : '—'}</strong>
                      <span>Peak long run</span>
                    </div>
                    <div>
                      <strong>{parseProfile.taper_weeks ?? '—'}</strong>
                      <span>Taper weeks</span>
                    </div>
                  </div>

                  {(qualityFlags.length > 0 || parseProfile.structure_tags.length > 0) && (
                    <div className="review-profile-tags">
                      {qualityFlags.map((label) => (
                        <span key={`quality-${label}`} className="review-profile-tag">{label}</span>
                      ))}
                      {parseProfile.structure_tags.map((tag) => (
                        <span key={`tag-${tag}`} className="review-profile-tag alt">{humanizeToken(tag)}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {hasSourceUnavailableNote && (
                <p className="review-muted">
                  Source PDF is unavailable for this plan (older upload or text-only creation).
                </p>
              )}
              {sourceDocument.error && <p className="review-error">{sourceDocument.error}</p>}
            </div>
          )}
        </section>
      )}

      {isActivated && showPaceCta && (
        <section className="review-page-card review-publish-panel">
          <div className="review-publish-head">
            <div>
              <h3>Optional: personalize run paces</h3>
              <p>
                Generate personalized targets for {effectiveRunCount} run activities using target time, past results, or Strava.
              </p>
            </div>
            <div className="review-publish-actions">
              <button
                className="cta secondary"
                type="button"
                onClick={() => {
                  setPaceFormOpen((prev) => !prev);
                  setPaceStep(1);
                  setPaceModalError(null);
                }}
              >
                {paceFormOpen ? 'Hide Pace Setup' : 'Open Pace Setup'}
              </button>
            </div>
          </div>

          {paceFormOpen && (
            <div className="review-publish-body">
              <p className="review-publish-copy">
                {paceStep === 1
                  ? `Step 1 of 2: choose your data source. CoachPlan will estimate paces in ${viewerUnits === 'KM' ? 'min/km' : 'min/mi'}.`
                  : 'Step 2 of 2: review estimated target and apply pace zones to run workouts.'}
              </p>

              <div className="review-modal-grid">
                <label className="review-field">
                  <span>Goal race distance</span>
                  <select value={raceDistanceKm} onChange={(event) => setRaceDistanceKm(event.target.value)}>
                    {RACE_DISTANCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                {paceStep === 1 && (
                  <>
                    <div className="review-source-row">
                      <button
                        type="button"
                        className={`review-source-chip${paceSource === 'TARGET_TIME' ? ' active' : ''}`}
                        onClick={() => setPaceSource('TARGET_TIME')}
                      >
                        Target time
                      </button>
                      <button
                        type="button"
                        className={`review-source-chip${paceSource === 'PAST_RESULT' ? ' active' : ''}`}
                        onClick={() => setPaceSource('PAST_RESULT')}
                      >
                        Past race result
                      </button>
                      <button
                        type="button"
                        className={`review-source-chip${paceSource === 'STRAVA' ? ' active' : ''}`}
                        onClick={() => setPaceSource('STRAVA')}
                      >
                        Strava effort
                      </button>
                    </div>

                    {paceSource === 'TARGET_TIME' && (
                      <label className="review-field">
                        <span>Target time (hh:mm:ss)</span>
                        <div className="review-time-input-row">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={goalHours}
                            onChange={(event) => setGoalHours(event.target.value)}
                            placeholder="hh"
                          />
                          <input
                            type="number"
                            min={0}
                            max={59}
                            step={1}
                            value={goalMinutes}
                            onChange={(event) => setGoalMinutes(event.target.value)}
                            placeholder="mm"
                          />
                          <input
                            type="number"
                            min={0}
                            max={59}
                            step={1}
                            value={goalSeconds}
                            onChange={(event) => setGoalSeconds(event.target.value)}
                            placeholder="ss"
                          />
                        </div>
                      </label>
                    )}

                    {paceSource === 'PAST_RESULT' && (
                      <div className="review-results-grid">
                        {manualResults.map((item) => (
                          <div key={item.id} className="review-result-card">
                            <div className="review-result-row">
                              <label className="review-field">
                                <span>Distance</span>
                                <select
                                  value={item.distanceKm}
                                  onChange={(event) => setManualField(item.id, 'distanceKm', event.target.value)}
                                >
                                  {RACE_DISTANCE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="review-field">
                                <span>Date</span>
                                <input
                                  type="date"
                                  value={item.dateISO}
                                  onChange={(event) => setManualField(item.id, 'dateISO', event.target.value)}
                                />
                              </label>
                            </div>
                            <label className="review-field">
                              <span>Time (hh:mm:ss)</span>
                              <div className="review-time-input-row">
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.hours}
                                  onChange={(event) => setManualField(item.id, 'hours', event.target.value)}
                                  placeholder="hh"
                                />
                                <input
                                  type="number"
                                  min={0}
                                  max={59}
                                  step={1}
                                  value={item.minutes}
                                  onChange={(event) => setManualField(item.id, 'minutes', event.target.value)}
                                  placeholder="mm"
                                />
                                <input
                                  type="number"
                                  min={0}
                                  max={59}
                                  step={1}
                                  value={item.seconds}
                                  onChange={(event) => setManualField(item.id, 'seconds', event.target.value)}
                                  placeholder="ss"
                                />
                              </div>
                            </label>
                            <label className="review-field">
                              <span>Label (optional)</span>
                              <input
                                type="text"
                                value={item.label}
                                onChange={(event) => setManualField(item.id, 'label', event.target.value)}
                                placeholder="e.g. Spring 10K race"
                              />
                            </label>
                            {manualResults.length > 1 && (
                              <button
                                className="review-delete-btn text"
                                type="button"
                                onClick={() => removeManualResult(item.id)}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                        <button className="review-save-btn secondary" type="button" onClick={addManualResult}>
                          Add result
                        </button>
                      </div>
                    )}

                    {paceSource === 'STRAVA' && (
                      <div className="review-strava-box">
                        <p className="review-field-hint">
                          Status: {stravaConnected ? `Connected${stravaUsername ? ` as ${stravaUsername}` : ''}` : 'Not connected'}
                          {stravaLastSyncAt ? ` · last sync ${new Date(stravaLastSyncAt).toLocaleDateString()}` : ''}
                        </p>
                        {paceSourcesLoading ? (
                          <p className="review-muted">Loading Strava efforts…</p>
                        ) : stravaCandidates.length === 0 ? (
                          <p className="review-muted">No synced race-like Strava efforts found yet.</p>
                        ) : (
                          <label className="review-field">
                            <span>Select effort</span>
                            <select value={selectedStravaId} onChange={(event) => setSelectedStravaId(event.target.value)}>
                              {stravaCandidates.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.label} · {formatTimeHms(candidate.timeSec)} · {new Date(candidate.dateISO).toLocaleDateString()}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                    )}

                    <div className="review-result-row">
                      <label className="review-field">
                        <span>Age (optional)</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={athleteAge}
                          onChange={(event) => setAthleteAge(event.target.value)}
                          placeholder="e.g. 38"
                        />
                      </label>
                      <label className="review-field">
                        <span>Sex (optional)</span>
                        <select value={athleteSex} onChange={(event) => setAthleteSex(event.target.value)}>
                          <option value="">Prefer not to say</option>
                          <option value="female">Female</option>
                          <option value="male">Male</option>
                          <option value="non_binary">Non-binary</option>
                        </select>
                      </label>
                    </div>
                  </>
                )}

                {paceStep === 2 && (
                  <div className="review-summary-block">
                    <p className="review-publish-copy">
                      Source: {paceSource === 'TARGET_TIME' ? 'Target time' : paceSource === 'PAST_RESULT' ? 'Past results estimate' : 'Strava estimate'}
                    </p>
                    <p className="review-publish-copy">
                      Estimated target race time: <strong>{targetGoalTimeSec ? formatTimeHms(targetGoalTimeSec) : '--:--:--'}</strong>
                      {evidenceEstimate?.confidence ? ` · ${evidenceEstimate.confidence} confidence` : ''}
                    </p>
                    {pacePreview && (
                      <div className="review-summary-paces">
                        <span>Race: {pacePreview.race}</span>
                        <span>Long: {pacePreview.long}</span>
                        <span>Easy: {pacePreview.easy}</span>
                        <span>Tempo: {pacePreview.tempo}</span>
                        <span>Interval: {pacePreview.interval}</span>
                      </div>
                    )}
                  </div>
                )}

                <label className="review-check-row">
                  <input
                    type="checkbox"
                    checked={overrideExistingPaces}
                    onChange={(event) => setOverrideExistingPaces(event.target.checked)}
                  />
                  <span>Override existing pace targets already parsed from the source plan</span>
                </label>

                <label className="review-check-row">
                  <input
                    type="checkbox"
                    checked={savePaceProfile}
                    onChange={(event) => setSavePaceProfile(event.target.checked)}
                  />
                  <span>Save generated pace profile to athlete settings for next plans</span>
                </label>
              </div>

              {paceModalError && <p className="review-error">{paceModalError}</p>}

              <div className="review-modal-actions">
                <button
                  className="cta secondary"
                  type="button"
                  onClick={() => {
                    setPaceFormOpen(false);
                    setPaceStep(1);
                    setPaceModalError(null);
                  }}
                  disabled={paceApplying}
                >
                  Not now
                </button>
                {paceStep === 2 && (
                  <button className="cta secondary" type="button" onClick={() => setPaceStep(1)} disabled={paceApplying}>
                    Back
                  </button>
                )}
                {paceStep === 1 ? (
                  <button
                    className="cta"
                    type="button"
                    onClick={continuePaceSetup}
                    disabled={paceApplying || !targetGoalTimeSec}
                  >
                    Continue
                  </button>
                ) : (
                  <button className="cta" type="button" onClick={applyPacePersonalization} disabled={paceApplying}>
                    {paceApplying ? 'Applying…' : 'Apply Pace Targets'}
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {showDesktopSourcePane && (
        <aside className="review-page-card review-source-pane">
          <div className="review-source-pane-head">
            <div>
              <h3>Source PDF</h3>
              <p>
                {sourceDocument.fileName || 'Uploaded training plan PDF'}
                {sourceDocument.pageCount ? ` · ${sourceDocument.pageCount} pages` : ''}
              </p>
            </div>
            <button
              className="review-save-btn secondary"
              type="button"
              onClick={() => setShowSourcePdf(false)}
            >
              Close
            </button>
          </div>
          <div className="review-source-pane-body">
            {sourceDocument.fileUrl ? (
              <PlanSourcePdfPane
                fileUrl={sourceDocument.fileUrl}
                initialPageCount={sourceDocument.pageCount}
              />
            ) : (
              <p className="review-muted">Source PDF is unavailable.</p>
            )}
          </div>
        </aside>
      )}

      <div className={showDesktopSourcePane ? 'review-main-column' : undefined}>
      {!isActivated && (
        <section className="review-page-card review-guide-panel">
          <div className="review-guide-head">
            <div>
              <h3>Plan Context Guide</h3>
              <p>
                This guide is used to expand abbreviations and write session instructions during parsing.
                Correct any errors, then re-parse.
              </p>
            </div>
            {guideSaving && <span className="review-guide-status">Saving&hellip;</span>}
            {!guideSaving && guideSaved && <span className="review-guide-status saved">Saved &#10003;</span>}
          </div>
          {!planGuide && (
            <div className="review-guide-extract">
              <button
                className="review-save-btn"
                type="button"
                onClick={handleExtractGuide}
                disabled={extractingGuide}
              >
                {extractingGuide ? 'Extracting guide\u2026 (30\u201360s)' : '\u2728 Extract Guide from PDF'}
              </button>
              {extractGuideError && <p className="review-error">{extractGuideError}</p>}
              <p className="review-guide-warning">
                Extracts abbreviations, pace zones, and session context from the original PDF. Review and correct before re-parsing.
              </p>
            </div>
          )}
          <label className="review-field">
            <span className="review-visually-hidden">Plan guide content</span>
            <textarea
              className="review-guide-textarea"
              value={planGuide}
              onChange={(event) => handleGuideChange(event.target.value)}
              rows={6}
              placeholder="No guide extracted yet. Click &quot;Extract Guide from PDF&quot; above, or paste abbreviations and pace zone definitions here."
            />
          </label>
          <div className="review-guide-actions">
            <button
              className="review-save-btn"
              type="button"
              onClick={handleReparse}
              disabled={reparsing || autosaveState.busy || guideSaving}
            >
              {reparsing ? 'Re-parsing\u2026 (this may take 30\u201360s)' : '\u21BA Re-parse Schedule with Current Guide'}
            </button>
            {reparseResult && (
              <span className="review-guide-result">
                &#10003; Re-parsed: {reparseResult.weeksProcessed} weeks &middot; {reparseResult.activitiesUpdated} activities updated
              </span>
            )}
          </div>
          {reparseError && <p className="review-error">{reparseError}</p>}
          <p className="review-guide-warning">
            Re-parse updates activity titles, instructions, and pace targets. It does not change logged data or planned distances.
          </p>
        </section>
      )}
      {!isActivated && (
        <section className="review-week-grid" id="review-week-grid">
          {weeks.map((week) => {
          const days = sortDays(week.days || []);
          const weekActivityCount = days.reduce((sum, day) => sum + (day.activities?.length || 0), 0);
          return (
            <article key={week.id} className="review-page-card review-week-card">
              <div className="review-week-head">
                <h2>Week {week.weekIndex}</h2>
                <span>{weekActivityCount} activities</span>
              </div>

              {days.length === 0 && <p className="review-muted">No days parsed for this week.</p>}

              {days.map((day) => {
                const notesOpen = expandedDayNotes[day.id] ?? true;
                return (
                  <div key={day.id} className="review-day-block">
                    <div className="review-day-head">
                      <span className="review-day-pill">{DAY_LABELS[(day.dayOfWeek || 1) - 1] || 'Day'}</span>
                      <div className="review-day-actions">
                        <button
                          className="review-save-btn secondary"
                          type="button"
                          onClick={() =>
                            setExpandedDayNotes((prev) => ({ ...prev, [day.id]: !notesOpen }))
                          }
                        >
                          {notesOpen ? 'Hide Notes' : 'Show Notes'}
                        </button>
                        <button
                          className="review-save-btn secondary"
                          type="button"
                          onClick={() => void handleRecheckDay(day.id, week.weekIndex, day.dayOfWeek)}
                          disabled={recheckingDayId === day.id || reparsing}
                          title="Re-parse this day's activities from stored source text"
                        >
                          {recheckingDayId === day.id ? 'Checking…' : '↺ Re-check'}
                        </button>
                        <button
                          className="review-save-btn"
                          type="button"
                          onClick={() => addActivity(day.id)}
                          disabled={creatingDayId === day.id}
                        >
                          {creatingDayId === day.id ? 'Adding…' : 'Add Activity'}
                        </button>
                      </div>
                    </div>

                    {recheckErrors[day.id] && (
                      <p className="review-error review-error-inline">{recheckErrors[day.id]}</p>
                    )}

                    {notesOpen && (
                      <label className="review-field review-day-notes">
                        <span>Day notes / source text</span>
                        <textarea
                          value={dayDrafts[day.id] || ''}
                          onChange={(event) =>
                            setDayDraftField(day.id, event.target.value)
                          }
                          rows={2}
                        />
                      </label>
                    )}

                    <div className="review-activity-list">
                      {(day.activities || []).length > 0 && (
                        <div className="review-activity-head-row" aria-hidden="true">
                          <span>Activity</span>
                          <span>Type</span>
                          <span>Distance</span>
                          <span>Duration</span>
                          <span>Actions</span>
                        </div>
                      )}
                      {(day.activities || []).map((activity) => {
                        const draft = activityDrafts[activity.id] || toActivityDraft(activity, viewerUnits);
                        const flowStructure = draft.structure;
                        const flowEditorPath = activeFlowEditor?.activityId === activity.id ? activeFlowEditor.path : null;
                        const selectedFlowStep = flowEditorPath ? getStepAtPath(flowStructure, flowEditorPath) : null;
                        const flowTarget = flowEditorPath
                          ? getStepContainerAtPath(cloneStructureSteps(flowStructure), flowEditorPath)
                          : null;
                        const canMoveFlowStepLeft = Boolean(flowTarget && flowTarget.index > 0);
                        const canMoveFlowStepRight = Boolean(
                          flowTarget && flowTarget.index < flowTarget.container.length - 1
                        );
                        const paceUnitLabel = (draft.distanceUnit || viewerUnits) === 'KM' ? 'km' : 'mi';
                        const hasDistance = draft.distance.trim() !== '';
                        const isRunActivity = draft.type === 'RUN';
                        const hasPaceTarget = draft.paceTarget.trim() !== '';
                        const showPaceField = isRunActivity || hasPaceTarget;
                        const detailsOpen = expandedActivityDetails[activity.id] ?? false;
                        const sessionInstructionsOpen = expandedSessionInstructions[activity.id] ?? false;
                        const activitySaving = Boolean(savingActivityIds[activity.id] || queuedActivityIds[activity.id]);
                        const activityDisplayType = draft.type.replace(/_/g, ' ');
                        return (
                          <div key={activity.id} className="review-activity-item review-activity-item-compact">
                            <div className="review-activity-quick-grid">
                              <div className="review-col-activity review-col-activity-stack">
                                <label className="review-field review-field-inline">
                                  <span className="review-visually-hidden">Activity</span>
                                  <input
                                    type="text"
                                    value={draft.title}
                                    placeholder={activityDisplayType}
                                    onChange={(event) =>
                                      setActivityDraftField(activity.id, 'title', event.target.value)
                                    }
                                  />
                                </label>
                                <SessionFlowStrip
                                  structure={flowStructure}
                                  size="compact"
                                  activePath={flowEditorPath}
                                  onStepDoubleClick={(path) => {
                                    setActiveFlowEditor({ activityId: activity.id, path });
                                  }}
                                  onAddStep={() => addFlowStep(activity.id)}
                                />
                                {flowEditorPath && selectedFlowStep && (
                                  <div className="review-flow-editor">
                                    <div className="review-flow-editor-head">
                                      <span>Edit Flow Step</span>
                                      <button
                                        type="button"
                                        className="review-flow-editor-close"
                                        onClick={() => setActiveFlowEditor(null)}
                                      >
                                        Close
                                      </button>
                                    </div>
                                    <div className="review-flow-editor-grid">
                                      <label className="review-field review-flow-editor-field">
                                        <span>Type</span>
                                        <select
                                          value={selectedFlowStep.type || 'distance'}
                                          onChange={(event) =>
                                            updateFlowStep(activity.id, flowEditorPath, (step) => ({
                                              ...step,
                                              type: event.target.value
                                            }))
                                          }
                                        >
                                          <option value="warmup">Warm-up</option>
                                          <option value="distance">Run</option>
                                          <option value="tempo">Tempo</option>
                                          <option value="interval">Interval</option>
                                          <option value="recovery">Recovery</option>
                                          <option value="easy">Easy</option>
                                          <option value="cooldown">Cool-down</option>
                                          <option value="repeat">Repeat</option>
                                          <option value="note">Note</option>
                                        </select>
                                      </label>
                                      <label className="review-field review-flow-editor-field">
                                        <span>Distance (mi)</span>
                                        <input
                                          type="number"
                                          min={0}
                                          step="0.1"
                                          value={selectedFlowStep.distance_miles ?? ''}
                                          onChange={(event) =>
                                            updateFlowStep(activity.id, flowEditorPath, (step) => {
                                              const value = event.target.value.trim();
                                              const next = { ...step };
                                              if (!value) delete next.distance_miles;
                                              else {
                                                const parsed = Number(value);
                                                if (Number.isFinite(parsed) && parsed >= 0) {
                                                  next.distance_miles = parsed;
                                                }
                                              }
                                              return next;
                                            })
                                          }
                                        />
                                      </label>
                                      <label className="review-field review-flow-editor-field">
                                        <span>Distance (km)</span>
                                        <input
                                          type="number"
                                          min={0}
                                          step="0.1"
                                          value={selectedFlowStep.distance_km ?? ''}
                                          onChange={(event) =>
                                            updateFlowStep(activity.id, flowEditorPath, (step) => {
                                              const value = event.target.value.trim();
                                              const next = { ...step };
                                              if (!value) delete next.distance_km;
                                              else {
                                                const parsed = Number(value);
                                                if (Number.isFinite(parsed) && parsed >= 0) {
                                                  next.distance_km = parsed;
                                                }
                                              }
                                              return next;
                                            })
                                          }
                                        />
                                      </label>
                                      <label className="review-field review-flow-editor-field">
                                        <span>Duration (min)</span>
                                        <input
                                          type="number"
                                          min={0}
                                          step="0.1"
                                          value={selectedFlowStep.duration_minutes ?? ''}
                                          onChange={(event) =>
                                            updateFlowStep(activity.id, flowEditorPath, (step) => {
                                              const value = event.target.value.trim();
                                              const next = { ...step };
                                              if (!value) delete next.duration_minutes;
                                              else {
                                                const parsed = Number(value);
                                                if (Number.isFinite(parsed) && parsed >= 0) {
                                                  next.duration_minutes = parsed;
                                                }
                                              }
                                              return next;
                                            })
                                          }
                                        />
                                      </label>
                                      <label className="review-field review-flow-editor-field">
                                        <span>Pace</span>
                                        <input
                                          type="text"
                                          value={selectedFlowStep.pace_target ?? ''}
                                          onChange={(event) =>
                                            updateFlowStep(activity.id, flowEditorPath, (step) => ({
                                              ...step,
                                              pace_target: event.target.value.trim() || null
                                            }))
                                          }
                                        />
                                      </label>
                                      <label className="review-field review-flow-editor-field">
                                        <span>Effort</span>
                                        <input
                                          type="text"
                                          value={selectedFlowStep.effort ?? ''}
                                          onChange={(event) =>
                                            updateFlowStep(activity.id, flowEditorPath, (step) => ({
                                              ...step,
                                              effort: event.target.value.trim() || null
                                            }))
                                          }
                                        />
                                      </label>
                                      <label className="review-field review-flow-editor-field review-flow-editor-field-full">
                                        <span>Description</span>
                                        <input
                                          type="text"
                                          value={selectedFlowStep.description ?? ''}
                                          onChange={(event) =>
                                            updateFlowStep(activity.id, flowEditorPath, (step) => ({
                                              ...step,
                                              description: event.target.value.trim() || null
                                            }))
                                          }
                                        />
                                      </label>
                                      {selectedFlowStep.type === 'repeat' && (
                                        <label className="review-field review-flow-editor-field">
                                          <span>Repetitions</span>
                                          <input
                                            type="number"
                                            min={1}
                                            step={1}
                                            value={selectedFlowStep.repetitions ?? 2}
                                            onChange={(event) =>
                                              updateFlowStep(activity.id, flowEditorPath, (step) => {
                                                const parsed = Number(event.target.value);
                                                return {
                                                  ...step,
                                                  repetitions: Number.isFinite(parsed) && parsed > 0
                                                    ? Math.floor(parsed)
                                                    : 2
                                                };
                                              })
                                            }
                                          />
                                        </label>
                                      )}
                                    </div>
                                    <div className="review-flow-editor-actions">
                                      <button
                                        type="button"
                                        className="review-save-btn secondary"
                                        onClick={() => moveFlowStep(activity.id, flowEditorPath, -1)}
                                        disabled={!canMoveFlowStepLeft}
                                      >
                                        Move Left
                                      </button>
                                      <button
                                        type="button"
                                        className="review-save-btn secondary"
                                        onClick={() => moveFlowStep(activity.id, flowEditorPath, 1)}
                                        disabled={!canMoveFlowStepRight}
                                      >
                                        Move Right
                                      </button>
                                      <button
                                        type="button"
                                        className="review-delete-btn ghost"
                                        onClick={() => deleteFlowStep(activity.id, flowEditorPath)}
                                      >
                                        Delete Step
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>

                              <label className="review-field review-col-type review-field-inline">
                                <span className="review-visually-hidden">Workout type</span>
                                <select
                                  value={draft.type}
                                  onChange={(event) =>
                                    setActivityDraftField(
                                      activity.id,
                                      'type',
                                      event.target.value as ActivityTypeValue
                                    )
                                  }
                                >
                                  {ACTIVITY_TYPES.map((type) => (
                                    <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
                                  ))}
                                </select>
                                {isRunActivity && (
                                  <div
                                    className="review-pace-categories review-pace-categories-inline"
                                    role="radiogroup"
                                    aria-label="Run pace category"
                                  >
                                    {PACE_BUCKET_OPTIONS.map((option) => {
                                      const selected = draft.paceTargetBucket === option.value;
                                      return (
                                        <button
                                          key={`${activity.id}-inline-${option.value}`}
                                          type="button"
                                          className={`review-pace-chip${selected ? ' active' : ''}`}
                                          aria-label={option.label}
                                          aria-pressed={selected}
                                          onClick={() => applyPaceBucket(activity.id, option.value)}
                                          title={`${option.label}${profilePaces[option.value] ? ` · ${profilePaces[option.value]}` : ''}`}
                                        >
                                          {option.short}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </label>

                              <label className="review-field review-col-distance review-field-inline">
                                <span className="review-visually-hidden">Distance</span>
                                <div className={`review-distance-input-row${hasDistance ? '' : ' single'}`}>
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.1"
                                    placeholder="Distance"
                                    value={draft.distance}
                                    onChange={(event) =>
                                      setActivityDraftField(activity.id, 'distance', event.target.value)
                                    }
                                  />
                                  {hasDistance && (
                                    <select
                                      value={draft.distanceUnit || viewerUnits}
                                      onChange={(event) =>
                                        setActivityDraftField(activity.id, 'distanceUnit', event.target.value)
                                      }
                                    >
                                      {DISTANCE_UNITS.map((unit) => (
                                        <option key={unit} value={unit}>{unit === 'KM' ? 'km' : 'mi'}</option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              </label>

                              <label className="review-field review-col-duration review-field-inline">
                                <span className="review-visually-hidden">Duration in minutes</span>
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  placeholder="Duration (min)"
                                  value={draft.duration}
                                  onChange={(event) =>
                                    setActivityDraftField(activity.id, 'duration', event.target.value)
                                  }
                                />
                              </label>

                              <div className="review-col-actions review-activity-actions-compact">
                                {activitySaving && <span className="review-inline-status">Saving…</span>}
                                <button
                                  className="review-save-btn secondary review-details-toggle"
                                  type="button"
                                  onClick={() =>
                                    setExpandedSessionInstructions((prev) => ({ ...prev, [activity.id]: !sessionInstructionsOpen }))
                                  }
                                >
                                  {sessionInstructionsOpen ? 'Hide Instructions' : 'Session Instructions'}
                                </button>
                                <button
                                  className="review-save-btn secondary review-details-toggle"
                                  type="button"
                                  onClick={() =>
                                    setExpandedActivityDetails((prev) => ({ ...prev, [activity.id]: !detailsOpen }))
                                  }
                                >
                                  {detailsOpen ? 'Less' : 'Details'}
                                </button>
                                <button
                                  className="review-delete-btn ghost"
                                  type="button"
                                  onClick={() => deleteActivity(activity.id)}
                                  disabled={deletingActivityId === activity.id}
                                >
                                  {deletingActivityId === activity.id ? 'Deleting…' : 'Delete'}
                                </button>
                              </div>
                            </div>

                            {sessionInstructionsOpen && (
                              <div className="review-session-instructions-panel">
                                <label className="review-field">
                                  <span>Session Instructions</span>
                                  <textarea
                                    value={draft.sessionInstructions}
                                    onChange={(event) =>
                                      setActivityDraftField(activity.id, 'sessionInstructions', event.target.value)
                                    }
                                    rows={3}
                                    placeholder="Generated session instructions will appear here after re-parsing."
                                  />
                                </label>
                              </div>
                            )}

                            {detailsOpen && (
                              <div className={`review-activity-details${showPaceField ? '' : ' no-pace'}`}>
                                <label className="review-field review-col-instructions">
                                  <span>Instructions</span>
                                  <textarea
                                    value={draft.rawText}
                                    onChange={(event) =>
                                      setActivityDraftField(activity.id, 'rawText', event.target.value)
                                    }
                                    rows={2}
                                  />
                                </label>

                                {showPaceField && (
                                  <label className="review-field review-field-compact review-col-pace">
                                    <span>Pace</span>
                                    <input
                                      type="text"
                                      value={draft.paceTarget}
                                      onChange={(event) =>
                                        setActivityDraftField(activity.id, 'paceTarget', event.target.value)
                                      }
                                      placeholder={`4:45 /${paceUnitLabel}`}
                                    />
                                    {isRunActivity && draft.paceTargetBucket && !profilePaces[draft.paceTargetBucket] && (
                                      <span className="review-field-hint">
                                        Set {PACE_BUCKET_OPTIONS.find((option) => option.value === draft.paceTargetBucket)?.label || 'this'} pace in Profile for auto-fill.
                                      </span>
                                    )}
                                  </label>
                                )}

                                <label className="review-field review-field-compact review-col-effort">
                                  <span>Effort</span>
                                  <input
                                    type="text"
                                    value={draft.effortTarget}
                                    onChange={(event) =>
                                      setActivityDraftField(activity.id, 'effortTarget', event.target.value)
                                    }
                                    placeholder="RPE 6 or Z2"
                                  />
                                </label>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </article>
          );
          })}
        </section>
      )}

      {!isActivated && unassigned.length > 0 && (
        <section className="review-page-card review-unassigned-section">
          <h3>Unassigned Days</h3>
          <div className="review-unassigned-list">
            {unassigned.map((day) => (
              <div key={day.id} className="review-unassigned-item">
                <span className="review-day-pill">{DAY_LABELS[(day.dayOfWeek || 1) - 1] || 'Day'}</span>
                <span>{day.rawText || 'No notes'}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      </div>
    </main>
  );
}
