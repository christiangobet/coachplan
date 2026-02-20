'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
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
  parseProfile?: unknown;
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
};

type ProfilePaceMap = Partial<Record<PaceBucketValue, string>>;

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
    title: activity.title || '',
    type: activity.type || 'OTHER',
    distance: activity.distance === null || activity.distance === undefined ? '' : String(activity.distance),
    distanceUnit: resolvedDistanceUnit || fallbackUnit,
    duration: activity.duration === null || activity.duration === undefined ? '' : String(activity.duration),
    paceTargetBucket: inferredPaceBucket || '',
    paceTarget: activity.paceTarget || '',
    effortTarget: activity.effortTarget || '',
    rawText: activity.rawText || ''
  };
}

function sortDays(days: ReviewDay[]) {
  return [...days].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
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

export default function PlanReviewPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const planId = Array.isArray(params?.id) ? params?.id[0] : params?.id;
  const arrivedFromUpload = searchParams?.get('fromUpload') === '1';
  const parseWarningMsg = searchParams?.get('parseWarningMsg');
  const hasParseWarning = searchParams?.get('parseWarning') === '1';

  const [plan, setPlan] = useState<ReviewPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [dayDrafts, setDayDrafts] = useState<Record<string, string>>({});
  const [expandedDayNotes, setExpandedDayNotes] = useState<Record<string, boolean>>({});
  const [savingDayIds, setSavingDayIds] = useState<Record<string, boolean>>({});
  const [queuedDayIds, setQueuedDayIds] = useState<Record<string, boolean>>({});

  const [activityDrafts, setActivityDrafts] = useState<Record<string, ActivityDraft>>({});
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
  const [isWideScreen, setIsWideScreen] = useState(false);
  const [showSourcePdf, setShowSourcePdf] = useState(false);
  const [sourceDocument, setSourceDocument] = useState<SourceDocumentMeta>({
    loading: false,
    available: false,
    fileUrl: null,
    fileName: null,
    pageCount: null,
    error: null
  });

  const daySaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const activitySaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const sourceToggleStorageKey = planId ? `review-source-pane:${planId}` : null;

  const initializeDrafts = useCallback((nextPlan: ReviewPlan, fallbackUnit: DistanceUnitValue) => {
    const nextDayDrafts: Record<string, string> = {};
    const nextExpandedDayNotes: Record<string, boolean> = {};
    const nextActivityDrafts: Record<string, ActivityDraft> = {};

    for (const week of nextPlan.weeks || []) {
      for (const day of week.days || []) {
        nextDayDrafts[day.id] = day.rawText || '';
        nextExpandedDayNotes[day.id] = false;
        for (const activity of day.activities || []) {
          nextActivityDrafts[activity.id] = toActivityDraft(activity, fallbackUnit);
        }
      }
    }

    setDayDrafts(nextDayDrafts);
    setExpandedDayNotes(nextExpandedDayNotes);
    setActivityDrafts(nextActivityDrafts);
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
      initializeDrafts(fetchedPlan, units);
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

      setSourceDocument({
        loading: false,
        available: true,
        fileUrl: typeof data.fileUrl === 'string' ? data.fileUrl : `/api/plans/${planId}/source-document/file`,
        fileName: typeof data.fileName === 'string' ? data.fileName : 'Uploaded plan.pdf',
        pageCount: typeof data.pageCount === 'number' ? data.pageCount : null,
        error: null
      });
    } catch {
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
    if (!planId || plan?.status === 'ACTIVE') return;
    void loadSourceDocument();
  }, [loadSourceDocument, plan?.status, planId]);

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
    const busy = queuedCount + savingCount > 0;
    const label = busy
      ? 'Saving changes…'
      : lastSavedAt
        ? `All changes saved at ${formatSavedTime(lastSavedAt)}`
        : 'Changes save automatically';
    return { busy, label };
  }, [lastSavedAt, queuedActivityIds, queuedDayIds, savingActivityIds, savingDayIds]);
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
            rawText: draft.rawText.trim() || null
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
    (activityId: string, field: keyof ActivityDraft, value: string) => {
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
      const res = await fetch(`/api/plans/${planId}/publish`, { method: 'POST' });
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
  }, [autosaveState.busy, goToDashboard, planId]);

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

  return (
    <main className={`review-page-shell${showDesktopSourcePane ? ' with-source-pane' : ''}`}>
      <section className={`review-page-card review-hero${isActivated ? ' review-hero-live' : ''}`}>
        <div className="review-hero-head">
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
            {!isActivated && arrivedFromUpload && (
              <p className="review-publish-copy">
                You are one step away. Confirm this parsed plan, then activate it to unlock Today and Training Log.
              </p>
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
                {showPaceCta && (
                  <button
                    className="cta secondary"
                    type="button"
                    onClick={() => {
                      setPaceFormOpen((prev) => !prev);
                      setPaceStep(1);
                      setPaceModalError(null);
                    }}
                  >
                    {paceFormOpen ? 'Hide Pace Setup' : 'Personalize Paces (Optional)'}
                  </button>
                )}
              </>
            ) : (
              <>
                <button className="cta" onClick={handlePublish} disabled={publishing || autosaveState.busy}>
                  {publishing ? (arrivedFromUpload ? 'Activating…' : 'Publishing…') : (arrivedFromUpload ? 'Activate Plan' : 'Publish Plan')}
                </button>
                <Link className="cta secondary" href={`/plans/${plan.id}`}>View Plan</Link>
                {isWideScreen && (
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
                )}
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
        {!isActivated && hasParseWarning && (
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
        {!isActivated && isWideScreen && !sourceDocument.loading && !sourceDocument.available && !sourceDocument.error && (
          <p className="review-muted">
            Source PDF is unavailable for this plan (older upload or text-only creation).
          </p>
        )}
        {!isActivated && sourceDocument.error && <p className="review-error">{sourceDocument.error}</p>}
        {error && <p className="review-error">{error}</p>}
      </section>

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
                const notesOpen = expandedDayNotes[day.id] ?? false;
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
                          className="review-save-btn"
                          type="button"
                          onClick={() => addActivity(day.id)}
                          disabled={creatingDayId === day.id}
                        >
                          {creatingDayId === day.id ? 'Adding…' : 'Add Activity'}
                        </button>
                      </div>
                    </div>

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
                      {(day.activities || []).map((activity) => {
                        const draft = activityDrafts[activity.id] || toActivityDraft(activity, viewerUnits);
                        const paceUnitLabel = (draft.distanceUnit || viewerUnits) === 'KM' ? 'km' : 'mi';
                        const hasDistance = draft.distance.trim() !== '';
                        const activitySaving = Boolean(savingActivityIds[activity.id] || queuedActivityIds[activity.id]);
                        return (
                          <div key={activity.id} className="review-activity-item review-activity-item-compact">
                            <div className="review-activity-top">
                              <strong>{activity.type.replace(/_/g, ' ')}</strong>
                              <div className="review-activity-actions">
                                {activitySaving && <span className="review-inline-status">Saving…</span>}
                                <button
                                  className="review-delete-btn text"
                                  type="button"
                                  onClick={() => deleteActivity(activity.id)}
                                  disabled={deletingActivityId === activity.id}
                                >
                                  {deletingActivityId === activity.id ? 'Deleting…' : 'Delete'}
                                </button>
                              </div>
                            </div>

                            <div className="review-activity-grid">
                              <label className="review-field review-col-activity">
                                <span>Activity</span>
                                <input
                                  type="text"
                                  value={draft.title}
                                  onChange={(event) =>
                                    setActivityDraftField(activity.id, 'title', event.target.value)
                                  }
                                />
                              </label>

                              <label className="review-field review-col-distance">
                                <div className="review-field-label-row">
                                  <span>Distance</span>
                                  <span className="review-help-wrap">
                                    <button
                                      type="button"
                                      className="review-help-dot"
                                      aria-label="Distance unit help"
                                    >
                                      ?
                                    </button>
                                    <span className="review-help-popover" role="tooltip">
                                      {hasDistance
                                        ? 'Unit is auto-set by parser/profile. Change only if needed.'
                                        : `Unit will default to ${viewerUnits === 'KM' ? 'km' : 'mi'} once distance is entered.`}
                                    </span>
                                  </span>
                                </div>
                                <div className={`review-distance-input-row${hasDistance ? '' : ' single'}`}>
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.1"
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

                              <label className="review-field review-col-duration">
                                <span>Duration (min)</span>
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={draft.duration}
                                  onChange={(event) =>
                                    setActivityDraftField(activity.id, 'duration', event.target.value)
                                  }
                                />
                              </label>

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

                              <label className="review-field review-col-type review-col-type-highlight">
                                <span>Workout Type</span>
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
                              </label>

                              <label className="review-field review-field-compact review-col-pace">
                                <span>Pace</span>
                                {draft.type === 'RUN' ? (
                                  <div className="review-pace-categories" role="radiogroup" aria-label="Run pace category">
                                    {PACE_BUCKET_OPTIONS.map((option) => {
                                      const selected = draft.paceTargetBucket === option.value;
                                      return (
                                        <button
                                          key={`${activity.id}-${option.value}`}
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
                                ) : (
                                  <span className="review-field-hint">No pace category for this activity type.</span>
                                )}
                                <input
                                  type="text"
                                  value={draft.paceTarget}
                                  onChange={(event) =>
                                    setActivityDraftField(activity.id, 'paceTarget', event.target.value)
                                  }
                                  placeholder={`4:45 /${paceUnitLabel}`}
                                />
                                {draft.type === 'RUN' && draft.paceTargetBucket && !profilePaces[draft.paceTargetBucket] && (
                                  <span className="review-field-hint">
                                    Set {PACE_BUCKET_OPTIONS.find((option) => option.value === draft.paceTargetBucket)?.label || 'this'} pace in Profile for auto-fill.
                                  </span>
                                )}
                              </label>

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
