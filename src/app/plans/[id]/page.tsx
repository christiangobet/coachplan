'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { useUser } from '@clerk/nextjs';
import { getDayDateFromWeekStart, resolveWeekBounds } from '@/lib/plan-dates';
import { getDayStatus, getDayMissedReason, type DayStatus } from '@/lib/day-status';
import { getFirstName } from '@/lib/display-name';
import AthleteSidebar from '@/components/AthleteSidebar';
import SelectedPlanCookie from '@/components/SelectedPlanCookie';
import {
  convertDistanceForDisplay,
  convertPaceForDisplay,
  distanceUnitLabel,
  formatDistanceNumber,
  resolveDistanceUnitFromActivity,
  type DistanceUnit
} from '@/lib/unit-display';
import { inferPaceBucketFromText, parseStructuredPaceTarget } from '@/lib/intensity-targets';
import ActivityForm, { ActivityFormData } from '@/components/PlanEditor/ActivityForm';
import DayLogCard from '@/components/DayLogCard';
import PlanSourcePdfPane from '@/components/PlanSourcePdfPane';
import PlanGuidePanel from '@/components/PlanGuidePanel';
import PlanSummarySection from '@/components/PlanSummarySection';
import ExternalSportIcon from '@/components/ExternalSportIcon';
import StravaIcon from '@/components/StravaIcon';
import type { PlanSummary } from '@/lib/types/plan-summary';
import { buildLogActivities, type LogActivity } from '@/lib/log-activity';
import { PLAN_IMAGE_MAX_COUNT, PLAN_IMAGE_MAX_FILE_BYTES } from '@/lib/plan-banner';
import '../plans.css';
import './review/review.css';
import '../../dashboard/dashboard.css';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ACTIVITY_TYPE_ABBR: Record<string, string> = {
  RUN: 'RUN',
  STRENGTH: 'STR',
  CROSS_TRAIN: 'XT',
  REST: 'RST',
  MOBILITY: 'MOB',
  YOGA: 'YOG',
  HIKE: 'HIK',
  OTHER: 'OTH'
};

const PACE_BUCKET_SHORT: Record<string, string> = {
  RECOVERY: 'RE', EASY: 'EZ', LONG: 'LR', RACE: 'RP',
  TEMPO: 'TP', THRESHOLD: 'TH', INTERVAL: 'IN'
};

function formatType(type: string) {
  return type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function trimUnitFromValue(value: string, unit: string) {
  if (!unit) return value;
  if (value.endsWith(` ${unit}`)) return value.slice(0, -(unit.length + 1));
  if (value.endsWith(unit)) return value.slice(0, -unit.length);
  return value;
}

function buildDistanceProgressLabel(planned: string | null, logged: string | null, unit?: string) {
  if (planned && logged) {
    const plannedCompact = unit ? trimUnitFromValue(planned, unit) : planned;
    return `${plannedCompact} \u2192 ${logged}`;
  }
  if (logged) return logged;
  if (planned) return planned;
  return null;
}

function distanceProgressVariant(planned: string | null, logged: string | null) {
  if (planned && logged) return 'mix';
  if (logged) return 'logged';
  return 'planned';
}

function formatDistanceOneDecimal(value: number) {
  return value.toFixed(1);
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}


function formatWeekRange(startDate: Date | null, endDate: Date | null): string | null {
  if (!startDate) return null;
  const s = new Date(startDate);
  s.setHours(0, 0, 0, 0);

  let e = endDate ? new Date(endDate) : null;
  if (!e) {
    e = new Date(s);
    e.setDate(e.getDate() + 6);
  }
  e.setHours(0, 0, 0, 0);

  const sameYear = s.getFullYear() === e.getFullYear();
  const fmtStart = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
  const fmtEnd = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return `${fmtStart(s)} - ${fmtEnd(e)}`;
}

type SelectedDayState = {
  dayId: string | null;
  dateISO: string;
  dateLabel: string;
  activities: LogActivity[];
  dayStatus: DayStatus;
  missedReason: string | null;
};

type DayStravaMarker = {
  id: string;
  name: string;
  sportType: string | null;
  startTime: string | null;
  distanceM: number | null;
  durationSec: number | null;
  matchedPlanActivityId: string | null;
};


function typeColor(type: string): string {
  switch (type) {
    case 'RUN': return 'var(--accent)';
    case 'STRENGTH': return '#6c5ce7';
    case 'CROSS_TRAIN': return '#0984e3';
    case 'REST': return 'var(--green)';
    case 'MOBILITY': return '#e67e22';
    case 'YOGA': return 'var(--green)';
    case 'HIKE': return '#0984e3';
    default: return 'var(--muted)';
  }
}

function typeAbbr(type: string | null | undefined) {
  return ACTIVITY_TYPE_ABBR[String(type || 'OTHER').toUpperCase()] || 'OTH';
}

function createTargetBadges(args: {
  paceTarget?: string | null;
  effortTarget?: string | null;
}) {
  const chips: string[] = [];
  if (args.paceTarget) chips.push(args.paceTarget);
  if (args.effortTarget) chips.push(`Effort ${args.effortTarget}`);
  return chips;
}

function resolveActivityDistanceSourceUnit(
  activity: {
    distanceUnit?: string | null;
    paceTarget?: string | null;
    actualPace?: string | null;
  } | null | undefined,
  viewerUnits: DistanceUnit,
  preferActualPace = false,
  fallbackUnit?: string | null
) {
  return (
    resolveDistanceUnitFromActivity({
      distanceUnit: activity?.distanceUnit,
      paceTarget: activity?.paceTarget,
      actualPace: activity?.actualPace,
      fallbackUnit: fallbackUnit ?? viewerUnits,
      preferActualPace
    })
    || viewerUnits
  );
}

function toLocalDateKey(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatLocalDateKey(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function locateActivityInPlan(plan: any, activityId: string) {
  if (!plan?.weeks || !activityId) return null;
  const sortedWeeks = [...plan.weeks].sort((a: any, b: any) => a.weekIndex - b.weekIndex);
  const allWeekIndexes = sortedWeeks.map((week: any) => week.weekIndex);

  for (const week of sortedWeeks) {
    const bounds = resolveWeekBounds({
      weekIndex: week.weekIndex,
      weekStartDate: week.startDate,
      weekEndDate: week.endDate,
      raceDate: plan.raceDate,
      weekCount: plan.weekCount,
      allWeekIndexes
    });

    for (const day of week.days || []) {
      const found = (day.activities || []).find((activity: any) => activity.id === activityId);
      if (!found) continue;
      const dayDate = getDayDateFromWeekStart(bounds.startDate, day.dayOfWeek);
      return {
        activity: found,
        dayDateISO: dayDate ? toLocalDateKey(dayDate) : null
      };
    }
  }

  return null;
}

type AiTrainerChange =
  | {
    op: 'move_activity';
    activityId: string;
    targetDayId: string;
    reason: string;
  }
  | {
    op: 'edit_activity';
    activityId: string;
    reason: string;
    type?: string;
    title?: string;
    duration?: number | null;
    distance?: number | null;
    distanceUnit?: string | null;
    paceTarget?: string | null;
    effortTarget?: string | null;
    notes?: string | null;
    mustDo?: boolean;
    bailAllowed?: boolean;
    priority?: string | null;
  }
  | {
    op: 'add_activity';
    dayId: string;
    reason: string;
    type: string;
    title: string;
    duration?: number | null;
    distance?: number | null;
    distanceUnit?: string | null;
    paceTarget?: string | null;
    effortTarget?: string | null;
    notes?: string | null;
    mustDo?: boolean;
    bailAllowed?: boolean;
    priority?: string | null;
  }
  | {
    op: 'delete_activity';
    activityId: string;
    reason: string;
  }
  | {
    op: 'extend_plan';
    newStartDate: string;
    reason: string;
  }
  | {
    op: 'reanchor_subtype_weekly';
    subtype: string;
    targetDayOfWeek: number;
    fromDayOfWeek?: number | null;
    startWeekIndex?: number | null;
    reason: string;
  };

type AiTrainerProposal = {
  schemaVersion?: string;
  patchId?: string;
  createdAt?: string;
  applyToken?: string;
  mode?: 'minimal_changes' | 'balanced' | 'aggressive' | 'injury_cautious';
  requiresClarification?: boolean;
  clarificationPrompt?: string;
  invariantReport?: {
    selectedMode: 'minimal_changes' | 'balanced' | 'aggressive' | 'injury_cautious';
    candidateScore: number;
    summaryFlags: string[];
    weeks: Array<{
      weekIndex: number;
      before: {
        restDays: number;
        hardDays: number;
        longRunDayOfWeek: number | null;
        plannedDurationMin: number;
      };
      after: {
        restDays: number;
        hardDays: number;
        longRunDayOfWeek: number | null;
        plannedDurationMin: number;
      };
      flags: string[];
    }>;
  };
  coachReply: string;
  summary: string;
  confidence: 'low' | 'medium' | 'high';
  riskFlags?: string[];
  followUpQuestion?: string;
  changes: AiTrainerChange[];
};

type AiProposalState = 'active' | 'superseded' | 'applied';

type AiChatTurn = {
  id: string;
  role: 'athlete' | 'coach' | 'system';
  text: string;
  createdAt: number;
  requestMessage?: string;
  proposal?: AiTrainerProposal;
  proposalState?: AiProposalState;
  errorCode?: string;
};

const AI_GREETING = "Hi, I'm your AI Trainer. Tell me what changed this week (missed session, travel, fatigue, sickness) and I'll propose safe plan adjustments.";

function createAiGreetingTurn(): AiChatTurn {
  return {
    id: nextTurnId(),
    role: 'coach',
    text: AI_GREETING,
    createdAt: Date.now()
  };
}

function keepOnlyGreeting(turns: AiChatTurn[]): AiChatTurn[] {
  const existing = turns.find((turn) => turn.role === 'coach' && turn.text === AI_GREETING && !turn.proposal);
  return existing ? [existing] : [createAiGreetingTurn()];
}

function formatDowLabel(dayOfWeek: number | null | undefined) {
  if (!dayOfWeek || dayOfWeek < 1 || dayOfWeek > 7) return '—';
  return DAY_LABELS[dayOfWeek - 1] || '—';
}

function nextTurnId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function classifyAiError(message: string) {
  const text = String(message || '');
  if (/429|resource exhausted|rate limit|quota/i.test(text)) {
    return {
      code: 'RATE_LIMIT',
      summary: 'I could not generate a new recommendation right now.',
      help: 'The AI coach is temporarily busy. Try again in about 30-60 seconds.'
    };
  }
  if (/clarification|required/i.test(text)) {
    return {
      code: 'CLARIFICATION_REQUIRED',
      summary: text,
      help: 'Please answer the clarification and generate/apply again.'
    };
  }
  return {
    code: 'GENERATION_FAILED',
    summary: 'I could not generate a new recommendation right now.',
    help: 'Please try again. If it keeps failing, simplify the request to one-week changes.'
  };
}

type AiChangeLookup = {
  dayLabelById: Map<string, string>;
  activityLabelById: Map<string, string>;
};

function describeAiChange(change: AiTrainerChange, lookup: AiChangeLookup) {
  const dayLabel = (dayId: string) => lookup.dayLabelById.get(dayId) || 'a plan day';
  const activityLabel = (activityId: string) => lookup.activityLabelById.get(activityId) || 'a scheduled activity';
  const dayName = (dayOfWeek: number | null | undefined) => {
    if (!dayOfWeek || dayOfWeek < 1 || dayOfWeek > 7) return 'a day';
    return DAY_LABELS[dayOfWeek - 1] || 'a day';
  };

  if (change.op === 'extend_plan') {
    const startDate = new Date(`${change.newStartDate}T00:00:00`);
    const startText = Number.isNaN(startDate.getTime())
      ? change.newStartDate
      : startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `Extend plan to start on ${startText} (prepend weeks, keep race date).`;
  }
  if (change.op === 'reanchor_subtype_weekly') {
    const subtypeLabel = change.subtype.replace(/[-_]+/g, ' ').trim();
    const sourceText = change.fromDayOfWeek ? ` from ${dayName(change.fromDayOfWeek)}` : '';
    const startText = change.startWeekIndex ? ` from week ${change.startWeekIndex}` : ' for remaining weeks';
    return `Move ${subtypeLabel} sessions${sourceText} to ${dayName(change.targetDayOfWeek)}${startText}.`;
  }
  if (change.op === 'move_activity') {
    return `Move ${activityLabel(change.activityId)} to ${dayLabel(change.targetDayId)}.`;
  }
  if (change.op === 'delete_activity') {
    return `Remove ${activityLabel(change.activityId)}.`;
  }
  if (change.op === 'add_activity') {
    return `Add ${formatType(change.type)} "${change.title}" on ${dayLabel(change.dayId)}.`;
  }
  const updates: string[] = [];
  if (change.title !== undefined) updates.push('title');
  if (change.type !== undefined) updates.push('type');
  if (change.duration !== undefined) updates.push('duration');
  if (change.distance !== undefined) updates.push('distance');
  if (change.paceTarget !== undefined) updates.push('pace');
  if (change.effortTarget !== undefined) updates.push('effort');
  if (change.notes !== undefined) updates.push('notes');
  if (change.priority !== undefined) updates.push('priority');
  if (change.mustDo !== undefined) updates.push('must-do');
  if (change.bailAllowed !== undefined) updates.push('bail');
  return `Edit ${activityLabel(change.activityId)}${updates.length > 0 ? ` (${updates.join(', ')})` : ''}.`;
}

function humanizeAiText(text: string | null | undefined, lookup: AiChangeLookup) {
  if (!text) return '';
  let next = text;

  for (const [id, label] of lookup.activityLabelById.entries()) {
    if (!id || !next.includes(id)) continue;
    next = next.split(id).join(label);
  }
  for (const [id, label] of lookup.dayLabelById.entries()) {
    if (!id || !next.includes(id)) continue;
    next = next.split(id).join(label);
  }

  return next;
}

type SourceDocumentMeta = {
  loading: boolean;
  available: boolean;
  fileUrl: string | null;
  fileName: string | null;
  pageCount: number | null;
  error: string | null;
};

type PlanBannerImage = {
  id: string;
  fileName: string | null;
  mimeType: string;
  fileSize: number;
  focusY: number;
  createdAt: string;
  isSelected: boolean;
  url: string;
};

export default function PlanDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const { user } = useUser();
  const planId = Array.isArray(params?.id) ? params?.id[0] : params?.id;
  const aiPromptParam = searchParams?.get('aiPrompt')?.trim() || '';
  const aiPromptSource = searchParams?.get('aiSource')?.trim() || '';
  const bannerLibraryParam = (searchParams?.get('bannerLibrary') || '').trim().toLowerCase();
  const [plan, setPlan] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<any>(null);
  const [actualDistance, setActualDistance] = useState('');
  const [actualDuration, setActualDuration] = useState('');
  const [actualPace, setActualPace] = useState('');
  const [actualsError, setActualsError] = useState<string | null>(null);
  const [stravaSyncError, setStravaSyncError] = useState<string | null>(null);
  const [stravaSyncStatus, setStravaSyncStatus] = useState<string | null>(null);
  const [syncingStrava, setSyncingStrava] = useState(false);
  const [savingActuals, setSavingActuals] = useState(false);
  const [viewerUnits, setViewerUnits] = useState<DistanceUnit>('MILES');
  const [viewMode, setViewMode] = useState<'plan' | 'log'>('log');
  const [cellView, setCellView] = useState<'compact' | 'detail'>('detail');
  const [selectedDay, setSelectedDay] = useState<SelectedDayState | null>(null);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [stravaMarkersByDate, setStravaMarkersByDate] = useState<Record<string, DayStravaMarker[]>>({});
  const [aiTrainerInput, setAiTrainerInput] = useState('');
  const [aiChatTurns, setAiChatTurns] = useState<AiChatTurn[]>(() => [
    createAiGreetingTurn()
  ]);
  const [chatMessages, setChatMessages] = useState<import('@/lib/plan-chat-types').ChatMessage[]>([]);
  const [activeProposalTurnId, setActiveProposalTurnId] = useState<string | null>(null);
  const [aiAppliedByTurn, setAiAppliedByTurn] = useState<Record<string, number[]>>({});
  const [aiTrainerLoading, setAiTrainerLoading] = useState(false);
  const [aiTrainerApplyingTarget, setAiTrainerApplyingTarget] = useState<'all' | number | null>(null);
  const [aiTrainerError, setAiTrainerError] = useState<string | null>(null);
  const [aiTrainerStatus, setAiTrainerStatus] = useState<string | null>(null);
  const [aiTrainerClarification, setAiTrainerClarification] = useState('');
  const [proposalDetailsOpen, setProposalDetailsOpen] = useState(false);
  const aiTrainerApplying = aiTrainerApplyingTarget !== null;
  const activeProposalTurn = useMemo(
    () => aiChatTurns.find((turn) => turn.id === activeProposalTurnId && turn.proposal) || null,
    [aiChatTurns, activeProposalTurnId]
  );
  const aiTrainerProposal = activeProposalTurn?.proposal || null;
  const aiTrainerAppliedRows = useMemo(() => {
    if (!activeProposalTurnId) return new Set<number>();
    return new Set(aiAppliedByTurn[activeProposalTurnId] || []);
  }, [aiAppliedByTurn, activeProposalTurnId]);

  // -- Source PDF State --
  const [isWideScreen, setIsWideScreen] = useState(
    () => (typeof window === 'undefined' ? true : window.matchMedia('(min-width: 1100px)').matches)
  );
  const [showSourcePdf, setShowSourcePdf] = useState(false);
  const [sourceDocumentChecked, setSourceDocumentChecked] = useState(false);
  const [sourceDocument, setSourceDocument] = useState<SourceDocumentMeta>({
    loading: false,
    available: false,
    fileUrl: null,
    fileName: null,
    pageCount: null,
    error: null
  });
  const sourceToggleStorageKey = planId ? `plan-source-pane:${planId}` : null;
  const [sourcePaneWidth, setSourcePaneWidth] = useState(380);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef<number>(0);
  const dragStartWidthRef = useRef<number>(380);
  const [bannerModalOpen, setBannerModalOpen] = useState(false);
  const [bannerImages, setBannerImages] = useState<PlanBannerImage[]>([]);
  const [bannerLibraryLoading, setBannerLibraryLoading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [bannerActionImageId, setBannerActionImageId] = useState<string | null>(null);
  const [bannerLibraryError, setBannerLibraryError] = useState<string | null>(null);
  const [bannerLibraryStatus, setBannerLibraryStatus] = useState<string | null>(null);
  const [bannerFocusDraft, setBannerFocusDraft] = useState<Record<string, number>>({});

  // -- Edit Mode State --
  const [isEditMode, setIsEditMode] = useState(false);
  const [editSessionId, setEditSessionId] = useState<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingChangeLogIds = useRef<string[]>([]);
  const [editingActivity, setEditingActivity] = useState<any>(null);
  const [addingToDayId, setAddingToDayId] = useState<string | null>(null);
  const [movingActivityId, setMovingActivityId] = useState<string | null>(null);
  const [deletingWeekId, setDeletingWeekId] = useState<string | null>(null);
  const [draggingActivity, setDraggingActivity] = useState<{
    activityId: string;
    sourceDayId: string;
    sourceIndex: number;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    dayId: string;
    rawIndex: number;
    position: 'before' | 'after' | 'append';
    valid: boolean;
  } | null>(null);
  const dragMovedRef = useRef(false);
  const suppressClickActivityIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (searchParams && searchParams.get('mode') === 'edit') {
      setIsEditMode(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!aiPromptParam) return;
    setAiTrainerInput((prev) => (prev.trim().length > 0 ? prev : aiPromptParam));
    if (aiPromptSource) {
      setAiTrainerStatus(`Adjustment prompt loaded from ${aiPromptSource}. Review and generate recommendation.`);
    }
  }, [aiPromptParam, aiPromptSource]);

  useEffect(() => {
    if (bannerLibraryParam !== '1' && bannerLibraryParam !== 'true') return;
    setBannerLibraryError(null);
    setBannerLibraryStatus(null);
    setBannerModalOpen(true);
  }, [bannerLibraryParam]);

  const emitPlanEditEvent = useCallback((event: string, detail: Record<string, unknown> = {}) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('coachplan:analytics', {
        detail: {
          event,
          planId,
          ...detail
        }
      })
    );
  }, [planId]);

  const handleSaveActivity = async (data: ActivityFormData) => {
    try {
      if (editingActivity) {
        const payload: Record<string, unknown> = { ...data };
        if (typeof data.dayId === 'string' && data.dayId !== editingActivity.dayId) {
          payload.targetDayId = data.dayId;
        }
        delete payload.dayId;
        // Edit existing
        const res = await fetch(`/api/activities/${editingActivity.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to update activity');
        }
        // Refresh plan in background so the modal closes immediately
        loadPlan();
      } else if (addingToDayId) {
        // Add new
        const res = await fetch(`/api/plan-days/${addingToDayId}/activities`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to add activity');
        }
        loadPlan();
      }
    } catch (err: any) {
      alert(err.message); // Simple error feedback for now
      throw err;
    }
  };

  const handleDeleteActivity = async (activityId: string) => {
    const res = await fetch(`/api/activities/${activityId}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || 'Failed to delete');
    }
    await loadPlan();
    setEditingActivity(null);
  };

  const loadStravaMarkers = useCallback(async (targetPlanId: string) => {
    if (!targetPlanId) {
      setStravaMarkersByDate({});
      return;
    }
    try {
      const res = await fetch(`/api/integrations/strava/review?plan=${encodeURIComponent(targetPlanId)}`, {
        cache: 'no-store'
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error || 'Failed to load Strava markers');

      const next: Record<string, DayStravaMarker[]> = {};
      for (const day of payload?.days || []) {
        if (!day || typeof day.date !== 'string' || !Array.isArray(day.stravaActivities)) continue;
        next[day.date] = day.stravaActivities
          .map((activity: any) => ({
            id: String(activity?.id || ''),
            name: typeof activity?.name === 'string' && activity.name.trim().length > 0
              ? activity.name
              : (typeof activity?.sportType === 'string' ? formatType(activity.sportType) : 'Strava activity'),
            sportType: typeof activity?.sportType === 'string' ? activity.sportType : null,
            startTime: typeof activity?.startTime === 'string' ? activity.startTime : null,
            distanceM: typeof activity?.distanceM === 'number' ? activity.distanceM : null,
            durationSec: typeof activity?.durationSec === 'number' ? activity.durationSec : null,
            matchedPlanActivityId: typeof activity?.matchedPlanActivityId === 'string' ? activity.matchedPlanActivityId : null
          }))
          .filter((activity: DayStravaMarker) => activity.id.length > 0);
      }
      setStravaMarkersByDate(next);
    } catch {
      setStravaMarkersByDate({});
    }
  }, []);

  const loadPlan = useCallback(async () => {
    if (!planId) return;
    try {
      // Fetch plan data and Strava markers in parallel — removes one full round-trip
      const [res] = await Promise.all([
        fetch(`/api/plans/${planId}`),
        loadStravaMarkers(planId)
      ]);
      const text = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        setError('Server returned non-JSON response.');
        return;
      }
      if (!res.ok) {
        setError(data?.error || 'Failed to load plan.');
        return;
      }
      setViewerUnits(data?.viewerUnits === 'KM' ? 'KM' : 'MILES');
      setPlan(data.plan);
      setSelectedActivity((prev: any) => {
        if (!prev) return prev;
        const located = locateActivityInPlan(data.plan, prev.id);
        if (!located) return null;
        return {
          ...located.activity,
          dayDateISO: located.dayDateISO || prev.dayDateISO || null
        };
      });
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load plan.');
    }
  }, [loadStravaMarkers, planId]);

  const handleDeleteLastWeek = useCallback(async (week: any) => {
    if (!planId || !week?.id) return;
    const weekActivities = (week.days || []).flatMap((day: any) => day.activities || []);
    if (weekActivities.length > 0) {
      setError('Clear all activities from this week before deleting it.');
      return;
    }

    const confirmed = window.confirm(
      `Delete week ${week.weekIndex}? This removes the week from the plan and updates total week count.`
    );
    if (!confirmed) return;

    setDeletingWeekId(week.id);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${planId}/weeks/${week.id}`, {
        method: 'DELETE'
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || 'Failed to delete week');
      }
      emitPlanEditEvent('plan_last_week_deleted', {
        weekId: week.id,
        weekIndex: week.weekIndex
      });
      setSelectedDay(null);
      await loadPlan();
    } catch (err: any) {
      emitPlanEditEvent('plan_last_week_delete_failed', {
        weekId: week.id,
        weekIndex: week.weekIndex
      });
      setError(err?.message || 'Failed to delete week');
    } finally {
      setDeletingWeekId(null);
    }
  }, [emitPlanEditEvent, loadPlan, planId]);

  const loadBannerLibrary = useCallback(async () => {
    if (!planId) return;
    setBannerLibraryLoading(true);
    setBannerLibraryError(null);
    setBannerLibraryStatus(null);
    try {
      const res = await fetch(`/api/plans/${planId}/images`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load banner library');
      }
      const images = Array.isArray(data?.images) ? data.images : [];
      setBannerImages(images);
      setBannerFocusDraft(
        images.reduce((acc: Record<string, number>, image: PlanBannerImage) => {
          acc[image.id] = typeof image.focusY === 'number' ? image.focusY : 0.5;
          return acc;
        }, {})
      );
      if (data?.schemaReady === false) {
        setBannerLibraryStatus(data?.warning || 'Banner library is unavailable until database migrations are applied.');
      }
    } catch (err: any) {
      setBannerLibraryError(err?.message || 'Failed to load banner library');
      setBannerImages([]);
    } finally {
      setBannerLibraryLoading(false);
    }
  }, [planId]);

  const uploadBannerFiles = useCallback(async (files: FileList | null) => {
    if (!planId || !files || files.length === 0) return;
    const queue = Array.from(files);
    setBannerUploading(true);
    setBannerLibraryError(null);
    setBannerLibraryStatus(null);
    try {
      for (const file of queue) {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`/api/plans/${planId}/images`, {
          method: 'POST',
          body: form,
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload?.error || `Failed to upload ${file.name}`);
        }
      }
      setBannerLibraryStatus(queue.length === 1 ? 'Image uploaded.' : `${queue.length} images uploaded.`);
      await Promise.all([loadBannerLibrary(), loadPlan()]);
    } catch (err: any) {
      setBannerLibraryError(err?.message || 'Failed to upload image');
    } finally {
      setBannerUploading(false);
    }
  }, [loadBannerLibrary, loadPlan, planId]);

  const selectBannerImage = useCallback(async (imageId: string) => {
    if (!planId) return;
    setBannerActionImageId(imageId);
    setBannerLibraryError(null);
    setBannerLibraryStatus(null);
    try {
      const res = await fetch(`/api/plans/${planId}/images/${imageId}`, { method: 'PATCH' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to set banner image');
      }
      setBannerLibraryStatus('Banner updated.');
      await Promise.all([loadBannerLibrary(), loadPlan()]);
    } catch (err: any) {
      setBannerLibraryError(err?.message || 'Failed to set banner image');
    } finally {
      setBannerActionImageId(null);
    }
  }, [loadBannerLibrary, loadPlan, planId]);

  const deleteBannerImage = useCallback(async (imageId: string) => {
    if (!planId) return;
    setBannerActionImageId(imageId);
    setBannerLibraryError(null);
    setBannerLibraryStatus(null);
    try {
      const res = await fetch(`/api/plans/${planId}/images/${imageId}`, { method: 'DELETE' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to delete image');
      }
      setBannerLibraryStatus('Image deleted.');
      await Promise.all([loadBannerLibrary(), loadPlan()]);
    } catch (err: any) {
      setBannerLibraryError(err?.message || 'Failed to delete image');
    } finally {
      setBannerActionImageId(null);
    }
  }, [loadBannerLibrary, loadPlan, planId]);

  const updateBannerFocus = useCallback(async (imageId: string, focusY: number) => {
    if (!planId) return;
    setBannerActionImageId(imageId);
    setBannerLibraryError(null);
    setBannerLibraryStatus(null);
    try {
      const normalized = Math.max(0, Math.min(1, focusY));
      const res = await fetch(`/api/plans/${planId}/images/${imageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ select: false, focusY: normalized }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to save image focus');
      }
      setBannerLibraryStatus('Image focus saved.');
      await Promise.all([loadBannerLibrary(), loadPlan()]);
    } catch (err: any) {
      setBannerLibraryError(err?.message || 'Failed to save image focus');
    } finally {
      setBannerActionImageId(null);
    }
  }, [loadBannerLibrary, loadPlan, planId]);

  const moveActivity = useCallback(async (args: {
    activityId: string;
    sourceDayId: string;
    sourceIndex: number;
    targetDayId: string;
    rawTargetIndex: number;
  }) => {
    const { activityId, sourceDayId, sourceIndex, targetDayId, rawTargetIndex } = args;
    const sameDay = sourceDayId === targetDayId;
    const normalizedIndex = sameDay && rawTargetIndex > sourceIndex ? rawTargetIndex - 1 : rawTargetIndex;
    if (sameDay && normalizedIndex === sourceIndex) return;

    setMovingActivityId(activityId);
    setError(null);
    try {
      const res = await fetch(`/api/activities/${activityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDayId,
          targetIndex: Math.max(0, normalizedIndex)
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Failed to move activity');
      }
      emitPlanEditEvent(sameDay ? 'plan_activity_reordered' : 'plan_activity_moved', {
        activityId,
        sourceDayId,
        targetDayId
      });
      // Write change log entry and schedule AI risk scan for cross-day moves
      if (!sameDay) {
        // Capture after-state from current plan data
        const activitiesForDay = (dayId: string) => {
          for (const week of (plan?.weeks ?? [])) {
            for (const day of (week.days ?? [])) {
              if (day.id === dayId) {
                return (day.activities ?? []).map((a: { id: string; type: string; subtype?: string | null; title: string; duration?: number | null; distance?: number | null; distanceUnit?: string | null; priority?: string | null }) => ({
                  id: a.id, type: a.type, subtype: a.subtype ?? null,
                  title: a.title, duration: a.duration ?? null,
                  distance: a.distance ?? null, distanceUnit: a.distanceUnit ?? null,
                  priority: a.priority ?? null,
                }));
              }
            }
          }
          return [];
        };

        const afterActivities = activitiesForDay(targetDayId);

        fetch(`/api/plans/${planId}/change-log`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'manual_drag',
            changeType: 'move_activity',
            activityId,
            fromDayId: sourceDayId,
            toDayId: targetDayId,
            editSessionId: editSessionId ?? undefined,
            after: { dayId: targetDayId, activities: afterActivities },
          }),
        })
          .then((r) => r.json())
          .then((data: { id?: string }) => {
            if (data.id) {
              pendingChangeLogIds.current.push(data.id);
              if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
              debounceTimerRef.current = setTimeout(() => {
                const ids = [...pendingChangeLogIds.current];
                pendingChangeLogIds.current = [];
                fetch(`/api/plans/${planId}/chat`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ trigger: 'drag_drop', changeLogIds: ids }),
                })
                  .then((r) => r.json())
                  .then((chatData: { coachMessage?: import('@/lib/plan-chat-types').ChatMessage | null }) => {
                    if (chatData.coachMessage) {
                      setChatMessages((prev) => [...prev, chatData.coachMessage!]);
                    }
                  })
                  .catch(() => {});
              }, 5000);
            }
          })
          .catch(() => {});
      }
      await loadPlan();
    } catch (err: any) {
      emitPlanEditEvent('plan_activity_move_failed', {
        activityId,
        sourceDayId,
        targetDayId
      });
      setError(err?.message || 'Failed to move activity');
    } finally {
      setMovingActivityId(null);
      setDropTarget(null);
      setDraggingActivity(null);
    }
  }, [emitPlanEditEvent, loadPlan, plan, planId, editSessionId, setChatMessages]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  // Load chat history on mount
  useEffect(() => {
    if (!planId) return;
    fetch(`/api/plans/${planId}/chat?limit=50`)
      .then((r) => r.json())
      .then((data: { messages?: import('@/lib/plan-chat-types').ChatMessage[] }) => {
        if (data.messages) setChatMessages(data.messages);
      })
      .catch(() => {}); // non-critical
  }, [planId]);

  useEffect(() => {
    if (!bannerModalOpen) return;
    void loadBannerLibrary();
  }, [bannerModalOpen, loadBannerLibrary]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!selectedDay) return;
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedDay]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!selectedDay) return;
    if (!window.matchMedia('(min-width: 901px)').matches) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.pcal-chat-panel')) return;
      if (target.closest('.pcal-cell')) return;
      setSelectedDay(null);
      void loadPlan();
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [loadPlan, selectedDay]);

  useEffect(() => {
    fetch('/api/integrations/accounts')
      .then(r => r.json())
      .then(data => {
        const strava = (data?.accounts || []).find((a: any) => a.provider === 'STRAVA');
        setStravaConnected(Boolean(strava?.connected && strava?.isActive));
      })
      .catch(() => {});
  }, []);

  // -- Source PDF effects --
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
    setSourceDocument((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch(`/api/plans/${planId}/source-document`, { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.available) {
        setSourceDocumentChecked(true);
        setSourceDocument({ loading: false, available: false, fileUrl: null, fileName: null, pageCount: null, error: data?.error || null });
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
      setSourceDocument({ loading: false, available: false, fileUrl: null, fileName: null, pageCount: null, error: null });
    }
  }, [planId]);

  useEffect(() => {
    if (!planId || !isWideScreen) return;
    void loadSourceDocument();
  }, [isWideScreen, loadSourceDocument, planId]);

  // -- Resize drag --
  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = sourcePaneWidth;
    setIsDragging(true);
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - dragStartXRef.current;
      setSourcePaneWidth(Math.max(260, Math.min(700, dragStartWidthRef.current + delta)));
    };
    const onUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [sourcePaneWidth]);

  const applyActivityUpdate = useCallback((activityId: string, updater: (activity: any) => any) => {
    setPlan((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        weeks: prev.weeks.map((w: any) => ({
          ...w,
          days: (w.days || []).map((d: any) => ({
            ...d,
            activities: (d.activities || []).map((a: any) =>
              a.id === activityId ? updater(a) : a
            )
          }))
        }))
      };
    });

    setSelectedActivity((prev: any) =>
      prev?.id === activityId ? updater(prev) : prev
    );
  }, []);

  const completeActivity = useCallback(async (withActuals: boolean) => {
    if (isEditMode || !selectedActivity || savingActuals) return;
    setSavingActuals(true);
    setActualsError(null);

    const payload = withActuals
      ? {
        actualDistance: actualDistance.trim(),
        actualDuration: actualDuration.trim(),
        actualPace: actualPace.trim(),
        actualDistanceUnit: viewerUnits
      }
      : { actualDistanceUnit: viewerUnits };

    try {
      const res = await fetch(`/api/activities/${selectedActivity.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActualsError(data?.error || 'Failed to complete activity');
        return;
      }
      if (data?.activity) {
        applyActivityUpdate(selectedActivity.id, () => data.activity);
      }
    } catch {
      setActualsError('Failed to complete activity');
    } finally {
      setSavingActuals(false);
    }
  }, [isEditMode, selectedActivity, savingActuals, actualDistance, actualDuration, actualPace, viewerUnits, applyActivityUpdate]);

  const syncActivityFromStrava = useCallback(async () => {
    if (isEditMode || !selectedActivity || syncingStrava) return;

    const dateISO = typeof selectedActivity.dayDateISO === 'string'
      ? selectedActivity.dayDateISO
      : null;
    if (!dateISO) {
      setStravaSyncError('Cannot sync this activity because its calendar date is missing.');
      return;
    }

    setSyncingStrava(true);
    setStravaSyncError(null);
    setStravaSyncStatus(null);
    try {
      const res = await fetch('/api/integrations/strava/import-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateISO, planId })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || 'Failed to sync from Strava');
      }

      const updatedCount = Number(body?.summary?.workoutsUpdated || 0);
      if (updatedCount > 0) {
        setStravaSyncStatus(`Synced Strava logs and updated ${updatedCount} workout(s).`);
      } else {
        setStravaSyncStatus('Strava sync finished. No matching workout updates were found for this day.');
      }
      await loadPlan();
    } catch (err: unknown) {
      setStravaSyncError(err instanceof Error ? err.message : 'Failed to sync from Strava');
    } finally {
      setSyncingStrava(false);
    }
  }, [isEditMode, planId, selectedActivity, syncingStrava, loadPlan]);

  const completeFromModal = useCallback(() => {
    const withActuals = Boolean(
      actualDistance.trim()
      || actualDuration.trim()
      || actualPace.trim()
    );
    completeActivity(withActuals);
  }, [actualDistance, actualDuration, actualPace, completeActivity]);

  const saveActuals = useCallback(async () => {
    if (isEditMode || !selectedActivity || savingActuals) return;
    setSavingActuals(true);
    setActualsError(null);

    try {
      const res = await fetch(`/api/activities/${selectedActivity.id}/actuals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actualDistance: actualDistance.trim(),
          actualDuration: actualDuration.trim(),
          actualPace: actualPace.trim(),
          actualDistanceUnit: viewerUnits
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActualsError(data?.error || 'Failed to save actuals');
        return;
      }

      if (data?.activity) {
        applyActivityUpdate(selectedActivity.id, () => data.activity);
      }
    } catch {
      setActualsError('Failed to save actuals');
    } finally {
      setSavingActuals(false);
    }
  }, [isEditMode, selectedActivity, savingActuals, actualDistance, actualDuration, actualPace, viewerUnits, applyActivityUpdate]);

  const closeSelectedDayPanel = useCallback(() => {
    setSelectedDay(null);
    void loadPlan();
  }, [loadPlan]);

  const generateAiAdjustment = useCallback(async () => {
    if (!planId) return;
    const message = aiTrainerInput.trim();
    if (!message) {
      setAiTrainerError('Describe what happened so the trainer can adapt the plan.');
      return;
    }
    const athleteTurn: AiChatTurn = {
      id: nextTurnId(),
      role: 'athlete',
      text: message,
      createdAt: Date.now()
    };
    setAiTrainerLoading(true);
    setAiTrainerError(null);
    setAiTrainerStatus('Generating new recommendation...');
    setAiTrainerClarification('');
    setAiTrainerInput('');
    setActiveProposalTurnId(null);
    setAiAppliedByTurn({});
    setAiChatTurns((prev) => {
      const greetingOnly = keepOnlyGreeting(prev);
      return [...greetingOnly, athleteTurn];
    });
    try {
      // Persist athlete message to chat DB (non-blocking)
      fetch(`/api/plans/${planId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'athlete_message', content: message }),
      }).catch(() => {});

      const res = await fetch(`/api/plans/${planId}/ai-adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to generate adjustment proposal.');
      }

      const proposal = (data?.proposal || null) as AiTrainerProposal | null;
      if (!proposal) {
        throw new Error('No new proposal was generated.');
      }

      const coachTurnId = nextTurnId();
      const coachTurn: AiChatTurn = {
        id: coachTurnId,
        role: 'coach',
        text: proposal.coachReply || proposal.summary || 'New recommendation generated.',
        createdAt: Date.now(),
        requestMessage: message,
        proposal,
        proposalState: 'active'
      };
      setAiChatTurns((prev) => {
        const greetingOnly = keepOnlyGreeting(prev);
        return [...greetingOnly, athleteTurn, coachTurn];
      });
      setActiveProposalTurnId(coachTurnId);
      setAiAppliedByTurn({ [coachTurnId]: [] });
      setAiTrainerStatus(proposal.summary || 'New recommendation generated.');
    } catch (err: unknown) {
      const classified = classifyAiError(err instanceof Error ? err.message : 'Failed to generate adjustment proposal.');
      setAiTrainerError(classified.summary);
      setAiTrainerStatus(classified.help);
      setAiChatTurns((prev) => {
        const greetingOnly = keepOnlyGreeting(prev);
        return [
          ...greetingOnly,
          athleteTurn,
          {
          id: nextTurnId(),
          role: 'system',
          text: `${classified.summary} ${classified.help}`,
          createdAt: Date.now(),
          errorCode: classified.code
          }
        ];
      });
    } finally {
      setAiTrainerLoading(false);
    }
  }, [aiTrainerInput, planId]);

  const applyAiAdjustment = useCallback(async (changeIndex?: number) => {
    if (!planId || !aiTrainerProposal || !activeProposalTurn) return;
    const message = activeProposalTurn.requestMessage || aiTrainerInput.trim();
    if (!message) {
      setAiTrainerError('No source athlete request is available for this proposal. Generate again.');
      return;
    }
    if (aiTrainerProposal.requiresClarification && !aiTrainerClarification.trim()) {
      setAiTrainerError(aiTrainerProposal.clarificationPrompt || 'Please answer the clarification before applying this adjustment.');
      return;
    }

    const targetIndexes =
      typeof changeIndex === 'number'
        ? aiTrainerProposal.changes
          .map((_, idx) => idx)
          .filter((idx) => idx === changeIndex && !aiTrainerAppliedRows.has(idx))
        : aiTrainerProposal.changes
          .map((_, idx) => idx)
          .filter((idx) => !aiTrainerAppliedRows.has(idx));
    if (targetIndexes.length === 0) {
      setAiTrainerError('No changes available to apply.');
      return;
    }

    setAiTrainerApplyingTarget(typeof changeIndex === 'number' ? changeIndex : 'all');
    setAiTrainerError(null);
    setAiTrainerStatus(null);
    try {
      const res = await fetch(`/api/plans/${planId}/ai-adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          apply: true,
          clarificationResponse: aiTrainerClarification.trim() || undefined,
          changeIndexes: targetIndexes,
          proposal: aiTrainerProposal
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to apply plan adjustments.');
      }
      const appliedRowIndexes = typeof changeIndex === 'number'
        ? [...targetIndexes]
        : aiTrainerProposal.changes.map((_, idx) => idx);
      setAiAppliedByTurn((prev) => {
        const current = new Set(prev[activeProposalTurn.id] || []);
        for (const idx of appliedRowIndexes) current.add(idx);
        return {
          ...prev,
          [activeProposalTurn.id]: [...current].sort((a, b) => a - b)
        };
      });

      const extendedWeeks = Number(data?.extendedWeeks || 0);
      const appliedCount = Number(data?.appliedCount || 0);
      if (extendedWeeks > 0) {
        setAiTrainerStatus(`Applied ${appliedCount} change(s), including ${extendedWeeks} prepended week(s).`);
      } else {
        setAiTrainerStatus(`Applied ${appliedCount} change(s) to the plan.`);
      }
      const totalAppliedSet = new Set([
        ...(aiAppliedByTurn[activeProposalTurn.id] || []),
        ...appliedRowIndexes
      ]);
      if (totalAppliedSet.size >= aiTrainerProposal.changes.length) {
        setAiChatTurns((prev) =>
          prev.map((turn) =>
            turn.id === activeProposalTurn.id
              ? { ...turn, proposalState: 'applied' as AiProposalState }
              : turn
          )
        );
        setActiveProposalTurnId(null);
      }
      setSelectedActivity(null);
      await loadPlan();
    } catch (err: unknown) {
      const classified = classifyAiError(err instanceof Error ? err.message : 'Failed to apply plan adjustments.');
      setAiTrainerError(classified.summary);
      setAiTrainerStatus(classified.help);
      setAiChatTurns((prev) => [
        ...prev,
        {
          id: nextTurnId(),
          role: 'system',
          text: `${classified.summary} ${classified.help}`,
          createdAt: Date.now(),
          errorCode: classified.code
        }
      ]);
    } finally {
      setAiTrainerApplyingTarget(null);
    }
  }, [aiTrainerClarification, aiTrainerInput, aiTrainerProposal, aiTrainerAppliedRows, aiAppliedByTurn, activeProposalTurn, loadPlan, planId]);

  const activateProposalTurn = useCallback((turnId: string) => {
    setAiChatTurns((prev) =>
      prev.map((turn) => {
        if (!turn.proposal) return turn;
        if (turn.id === turnId) return { ...turn, proposalState: turn.proposalState === 'applied' ? 'applied' : 'active' };
        if (turn.proposalState === 'active') {
          return { ...turn, proposalState: 'superseded' };
        }
        return turn;
      })
    );
    setActiveProposalTurnId(turnId);
    setAiTrainerClarification('');
    setAiTrainerError(null);
    setAiTrainerStatus('Previous recommendation re-opened.');
  }, []);

  const clearAiChat = useCallback(() => {
    setAiChatTurns([createAiGreetingTurn()]);
    setActiveProposalTurnId(null);
    setAiAppliedByTurn({});
    setAiTrainerClarification('');
    setAiTrainerInput('');
    setAiTrainerError(null);
    setAiTrainerStatus(null);
  }, []);

  // Close modal on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (bannerModalOpen) {
        setBannerModalOpen(false);
        return;
      }
      setSelectedActivity(null);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [bannerModalOpen]);

  useEffect(() => {
    if (!selectedActivity) return;
    const plannedSourceUnit = resolveActivityDistanceSourceUnit(selectedActivity, viewerUnits);
    const actualSourceUnit = resolveActivityDistanceSourceUnit(
      selectedActivity,
      viewerUnits,
      true,
      plannedSourceUnit
    );
    setActualDistance(
      selectedActivity.actualDistance === null || selectedActivity.actualDistance === undefined
        ? ''
        : String(
          convertDistanceForDisplay(
            selectedActivity.actualDistance,
            actualSourceUnit,
            viewerUnits
          )?.value ?? selectedActivity.actualDistance
        )
    );
    setActualDuration(
      selectedActivity.actualDuration === null || selectedActivity.actualDuration === undefined
        ? ''
        : String(selectedActivity.actualDuration)
    );
    setActualPace(
      convertPaceForDisplay(
        selectedActivity.actualPace,
        viewerUnits,
        actualSourceUnit
      ) || ''
    );
    setActualsError(null);
    setStravaSyncError(null);
    setStravaSyncStatus(null);
  }, [selectedActivity, viewerUnits]);

  const aiChangeLookup = useMemo<AiChangeLookup>(() => {
    const dayLabelById = new Map<string, string>();
    const activityLabelById = new Map<string, string>();
    if (!plan) return { dayLabelById, activityLabelById };

    const sortedWeeks = [...(plan.weeks || [])].sort((a: any, b: any) => a.weekIndex - b.weekIndex);
    const weekIndexes = sortedWeeks.map((week: any) => week.weekIndex);

    for (const week of sortedWeeks) {
      const bounds = resolveWeekBounds({
        weekIndex: week.weekIndex,
        weekStartDate: week.startDate,
        weekEndDate: week.endDate,
        raceDate: plan.raceDate,
        weekCount: plan.weekCount,
        allWeekIndexes: weekIndexes
      });
      for (const day of week.days || []) {
        const date = getDayDateFromWeekStart(bounds.startDate, day.dayOfWeek);
        const dayName = DAY_LABELS[Math.max(0, day.dayOfWeek - 1)] || `Day ${day.dayOfWeek}`;
        const dayText = date
          ? `${dayName} ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
          : dayName;
        dayLabelById.set(day.id, dayText);

        for (const activity of day.activities || []) {
          const title = typeof activity.title === 'string' && activity.title.trim()
            ? activity.title.trim()
            : formatType(activity.type || 'Workout');
          activityLabelById.set(activity.id, `"${title}" (${dayText})`);
        }
      }
    }

    return { dayLabelById, activityLabelById };
  }, [plan]);

  if (error) {
    return (
      <main className="pcal">
        <p style={{ color: 'var(--red)', fontSize: 14 }}>{error}</p>
      </main>
    );
  }

  if (!plan) {
    return (
      <main className="pcal">
        <p className="muted">Loading...</p>
      </main>
    );
  }

  const statusClass = plan.status === 'ACTIVE' ? 'active' : plan.status === 'DRAFT' ? 'draft' : 'archived';
  const weeks = [...(plan.weeks || [])].sort((a: any, b: any) => a.weekIndex - b.weekIndex);
  const allWeekIndexes = weeks.map((week: any) => week.weekIndex);
  const lastWeekIndex = allWeekIndexes.length > 0 ? Math.max(...allWeekIndexes) : null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Compute plan-level stats
  const allActivities = weeks.flatMap((w: any) =>
    (w.days || []).flatMap((d: any) => d.activities || [])
  );
  const totalActivities = allActivities.length;
  const completedActivities = allActivities.filter((a: any) => a.completed).length;
  const totalMinutes = allActivities.reduce((acc: number, a: any) => acc + (a.duration || 0), 0);
  const completionPct = totalActivities > 0 ? Math.round((completedActivities / totalActivities) * 100) : 0;
  const viewerUnitLabel = distanceUnitLabel(viewerUnits);
  const desktopDndEnabled = isEditMode && isWideScreen;
  const toDisplayDistance = (value: number | null | undefined, sourceUnit: string | null | undefined) =>
    convertDistanceForDisplay(value, sourceUnit, viewerUnits);

  // Weekly run data for the volume chart in PlanSummaryCard
  const weeklyRunData = weeks.map((week: any) => {
    const runs = (week.days || [])
      .flatMap((d: any) => d.activities || [])
      .filter((a: any) => String(a.type).toUpperCase() === 'RUN');
    let total = 0;
    let loggedTotal = 0;
    let longRun = 0;
    for (const a of runs) {
      const plannedSourceUnit = resolveActivityDistanceSourceUnit(a, viewerUnits);
      const plannedDistance = toDisplayDistance(a.distance, plannedSourceUnit);
      const plannedValue = plannedDistance?.value ?? 0;
      total += plannedValue;
      if (plannedValue > longRun) longRun = plannedValue;

      const loggedSourceUnit = resolveActivityDistanceSourceUnit(a, viewerUnits, true);
      const loggedDistance = toDisplayDistance(a.actualDistance, loggedSourceUnit);
      loggedTotal += loggedDistance?.value ?? 0;
    }
    return {
      weekIndex: week.weekIndex as number,
      total: Math.round(total * 10) / 10,
      longRun: Math.round(longRun * 10) / 10,
      loggedTotal: Math.round(loggedTotal * 10) / 10
    };
  });
  const activeCurrentWeekIndex = (() => {
    if (plan.status !== 'ACTIVE') return null;
    for (const week of weeks) {
      const bounds = resolveWeekBounds({
        weekIndex: week.weekIndex,
        weekStartDate: week.startDate,
        weekEndDate: week.endDate,
        raceDate: plan.raceDate,
        weekCount: plan.weekCount,
        allWeekIndexes
      });
      if (bounds.startDate && bounds.endDate && today >= bounds.startDate && today <= bounds.endDate) {
        return week.weekIndex as number;
      }
    }
    return null;
  })();
  const formatDisplayDistance = (value: number | null | undefined, sourceUnit: string | null | undefined) => {
    const converted = toDisplayDistance(value, sourceUnit);
    if (!converted) return null;
    return `${formatDistanceOneDecimal(converted.value)}${distanceUnitLabel(converted.unit)}`;
  };
  const formatDisplayPace = (pace: string | null | undefined, sourceUnit: string | null | undefined) =>
    convertPaceForDisplay(pace, viewerUnits, sourceUnit || viewerUnits);
  const selectedPlannedSourceUnit = selectedActivity
    ? resolveActivityDistanceSourceUnit(selectedActivity, viewerUnits)
    : viewerUnits;
  const selectedDistanceDisplay = selectedActivity
    ? toDisplayDistance(selectedActivity.distance, selectedPlannedSourceUnit)
    : null;
  const selectedPaceDisplay = selectedActivity
    ? formatDisplayPace(selectedActivity.paceTarget, selectedPlannedSourceUnit)
    : null;
  const selectedTargetBadges = createTargetBadges({
    paceTarget: selectedPaceDisplay,
    effortTarget: selectedActivity?.effortTarget
  });
  const selectedActivityDateLabel = selectedActivity
    ? formatLocalDateKey(selectedActivity.dayDateISO)
    : null;
  const dayOptions = weeks.flatMap((week: any) =>
    (week.days || []).map((day: any) => {
      const bounds = resolveWeekBounds({
        weekIndex: week.weekIndex,
        weekStartDate: week.startDate,
        weekEndDate: week.endDate,
        raceDate: plan.raceDate,
        weekCount: plan.weekCount,
        allWeekIndexes
      });
      const dayDate = getDayDateFromWeekStart(bounds.startDate, day.dayOfWeek);
      const dayLabel = DAY_LABELS[Math.max(0, day.dayOfWeek - 1)] || `Day ${day.dayOfWeek}`;
      return {
        id: day.id,
        label: dayDate
          ? `Week ${week.weekIndex} · ${dayLabel} ${dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
          : `Week ${week.weekIndex} · ${dayLabel}`
      };
    })
  );

  const sourcePaneAvailable = isWideScreen && sourceDocument.available;
  const showDesktopSourcePane = sourcePaneAvailable && showSourcePdf;
  const planBannerUrl = typeof plan?.banner?.url === 'string' ? plan.banner.url : null;
  const planBannerFocus = typeof plan?.banner?.focusY === 'number'
    ? Math.max(0, Math.min(1, plan.banner.focusY))
    : 0.5;
  const planHeaderStyle = planBannerUrl
    ? ({
      '--plan-banner-url': `url("${planBannerUrl}")`,
      '--plan-banner-focus-y': `${Math.round(planBannerFocus * 100)}%`
    } as any)
    : undefined;

  return (
    <main
      className={`pcal${showDesktopSourcePane ? ' with-source-pane' : ''}`}
      style={showDesktopSourcePane ? { '--pcal-source-width': `${sourcePaneWidth}px` } as React.CSSProperties : undefined}
    >
      <SelectedPlanCookie planId={plan.status === 'ACTIVE' ? plan.id : null} />

      {showDesktopSourcePane && (
        <aside className="pcal-source-pane">
          <div className="pcal-source-pane-head">
            <div>
              <h3>Source PDF</h3>
              <p>
                {sourceDocument.fileName || 'Uploaded training plan PDF'}
                {sourceDocument.pageCount ? ` · ${sourceDocument.pageCount} pages` : ''}
              </p>
            </div>
            <button
              className="dash-btn-ghost pcal-source-pane-close"
              type="button"
              onClick={() => setShowSourcePdf(false)}
            >
              Close
            </button>
          </div>
          <div className="pcal-source-pane-body">
            {sourceDocument.fileUrl ? (
              <PlanSourcePdfPane
                fileUrl={sourceDocument.fileUrl}
                initialPageCount={sourceDocument.pageCount}
              />
            ) : (
              <p className="pcal-muted">Source PDF is unavailable.</p>
            )}
          </div>
        </aside>
      )}

      {showDesktopSourcePane && (
        <div
          className={`pcal-source-pane-resize${isDragging ? ' dragging' : ''}`}
          onMouseDown={startDrag}
        />
      )}

      <div className={showDesktopSourcePane ? 'pcal-main-column' : undefined}>
      <div className={`pcal-layout${showDesktopSourcePane ? ' pdf-open' : ''}${selectedDay ? ' day-open' : ''}${isEditMode ? ' edit-mode' : ''}`} data-debug-id="PLD">
        <AthleteSidebar
          name={getFirstName(user?.fullName || user?.firstName || 'Athlete')}
          active="plan-view"
          selectedPlanId={planId || null}
        />

        <section className="pcal-main" data-debug-id="PCG">
          {/* Header */}
          <div
            className={`pcal-header${planBannerUrl ? ' has-banner' : ''}`}
            id="plan-overview"
            style={planHeaderStyle}
          >
            <div className="pcal-header-top">
              <h1>{plan.name}</h1>
              <div className="pcal-header-actions">
                {isWideScreen && sourceDocumentChecked && (
                  <button
                    type="button"
                    className="dash-btn-ghost"
                    onClick={() => {
                      if (!sourceDocument.available) return;
                      setShowSourcePdf((prev) => !prev);
                    }}
                    disabled={sourceDocument.loading || !sourceDocument.available}
                    title={sourceDocument.available ? undefined : 'No source PDF uploaded for this plan'}
                  >
                    {sourceDocument.loading
                      ? 'Loading PDF…'
                      : sourceDocument.available
                        ? (showSourcePdf ? 'Hide Source PDF' : 'Show Source PDF')
                        : 'No Source PDF'}
                  </button>
                )}
                <button
                  type="button"
                  className={`dash-btn-ghost pcal-edit-btn${isEditMode ? ' active' : ''}`}
                  onClick={() => {
                    setIsEditMode((prev) => {
                      const next = !prev;
                      if (next) {
                        setSelectedDay(null);
                        setSelectedActivity(null);
                        // Start edit session
                        fetch(`/api/plans/${planId}/edit-session`, { method: 'POST' })
                          .then((r) => r.json())
                          .then((data: { editSessionId?: string }) => {
                            if (data.editSessionId) setEditSessionId(data.editSessionId);
                          })
                          .catch(() => {});
                      } else {
                        // Done editing — trigger session summary
                        const sessionId = editSessionId;
                        setEditSessionId(null);
                        if (sessionId) {
                          fetch(`/api/plans/${planId}/chat`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ trigger: 'edit_session_end', editSessionId: sessionId }),
                          })
                            .then((r) => r.json())
                            .then((data: { coachMessage?: import('@/lib/plan-chat-types').ChatMessage }) => {
                              if (data.coachMessage) {
                                setChatMessages((prev) => [...prev, data.coachMessage!]);
                              }
                            })
                            .catch(() => {});
                        }
                      }
                      return next;
                    });
                  }}
                >
                  {isEditMode ? 'Done Editing' : 'Edit Plan'}
                </button>
              </div>
            </div>
            <div className="pcal-header-meta">
              <span className={`plan-detail-status ${statusClass}`}>{plan.status}</span>
              {plan.weekCount && <span className="pcal-header-meta-item">{plan.weekCount} weeks</span>}
              {plan.raceName && <span className="pcal-header-meta-item">{plan.raceName}</span>}
              {plan.raceDate && <span className="pcal-header-meta-item">{new Date(plan.raceDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
              {plan.sourcePlanName && <span className="pcal-header-meta-item">Source: {plan.sourcePlanName}</span>}
            </div>
            {isEditMode && (
              <div className="pcal-edit-mode-banner" role="status" aria-live="polite">
                Plan editing mode is on. You can edit planned activities only. Workout logging is disabled.
              </div>
            )}

            {/* Stats inside banner */}
            <div className="pcal-stats">
              <div className="pcal-stat">
                <span className="pcal-stat-value">{completionPct}%</span>
                <span className="pcal-stat-label">Complete</span>
              </div>
              <div className="pcal-stat">
                <span className="pcal-stat-value">{completedActivities}/{totalActivities}</span>
                <span className="pcal-stat-label">Workouts</span>
              </div>
              <div className="pcal-stat">
                <span className="pcal-stat-value">{Math.floor(totalMinutes / 60)}h{totalMinutes % 60 > 0 ? ` ${totalMinutes % 60}m` : ''}</span>
                <span className="pcal-stat-label">Total Time</span>
              </div>
            </div>
            <div className="pcal-stat-bar">
              <div className="pcal-stat-bar-fill" style={{ width: `${completionPct}%` }} />
            </div>
          </div>

          {/* Inline accordion panels — Plan Guide + AI Trainer */}
          <div className="pcal-inline-sections">
            <details className="pcal-inline-panel">
              <summary className="pcal-inline-panel-summary">📋 Plan Guide</summary>
              <div className="pcal-inline-panel-body pcal-guide-panel">
                <PlanSummarySection
                  summary={plan?.planSummary as PlanSummary | null ?? null}
                  planId={planId as string}
                  weeklyRuns={weeklyRunData}
                  weeklyRunUnit={viewerUnitLabel}
                  currentWeekIndex={activeCurrentWeekIndex}
                  onExtract={async () => {
                    await fetch(`/api/plans/${planId}/extract-guide`, { method: 'POST' });
                    await loadPlan();
                  }}
                />
                {plan?.planGuide && (
                  <PlanGuidePanel
                    guideText={plan.planGuide as string}
                    planId={planId as string}
                    editable
                  />
                )}
              </div>
            </details>
            <details className="pcal-inline-panel">
              <summary className="pcal-inline-panel-summary">AI Trainer</summary>
              <div className="pcal-inline-panel-body">
                <section className="pcal-ai-trainer pcal-ai-trainer-chat">
                  <div className="pcal-ai-trainer-head">
                    <div>
                      <h2>AI Trainer</h2>
                      <p>Chat with your coach. Each new request starts a fresh recommendation thread.</p>
                    </div>
                    <div className="pcal-ai-trainer-head-actions">
                      <button
                        className="dash-btn-ghost"
                        type="button"
                        onClick={clearAiChat}
                        disabled={aiTrainerLoading || aiTrainerApplying}
                      >
                        Clear chat
                      </button>
                    </div>
                  </div>

                  <div className="pcal-ai-thread">
                    {/* Chat history from DB (loaded on mount) */}
                    {chatMessages.map((msg) => (
                      <article key={msg.id} className={`pcal-ai-turn role-${msg.role}`}>
                        <div className="pcal-ai-turn-head">
                          <strong>
                            {msg.role === 'athlete' ? 'You' : msg.role === 'coach' ? 'Coach' : 'System'}
                          </strong>
                          {msg.metadata?.state && msg.metadata.state !== 'active' && (
                            <span className={`pcal-ai-turn-state state-${msg.metadata.state}`}>
                              {msg.metadata.state === 'applied' ? 'Applied' : 'History'}
                            </span>
                          )}
                        </div>
                        <p>{msg.content}</p>
                      </article>
                    ))}
                    {aiChatTurns.length === 0 && chatMessages.length === 0 && (
                      <p className="pcal-ai-trainer-status">
                        Start with one clear request, for example: &quot;Move this week&apos;s long run to Sunday and rebalance recovery.&quot;
                      </p>
                    )}
                    {aiChatTurns.map((turn) => (
                      <article key={turn.id} className={`pcal-ai-turn role-${turn.role}`}>
                        <div className="pcal-ai-turn-head">
                          <strong>
                            {turn.role === 'athlete' ? 'You' : turn.role === 'coach' ? 'Coach' : 'System'}
                          </strong>
                          {turn.proposal && (
                            <span className={`pcal-ai-turn-state state-${turn.proposalState || 'superseded'}`}>
                              {turn.proposalState === 'active'
                                ? 'Active proposal'
                                : turn.proposalState === 'applied'
                                  ? 'Applied'
                                  : 'History'}
                            </span>
                          )}
                        </div>
                        <p>{humanizeAiText(turn.text, aiChangeLookup)}</p>
                        {turn.errorCode && (
                          <span className="pcal-ai-turn-error-code">{turn.errorCode}</span>
                        )}
                        {turn.proposal && turn.proposalState !== 'active' && turn.proposalState !== 'applied' && (
                          <button
                            className="dash-btn-ghost pcal-ai-turn-use"
                            type="button"
                            onClick={() => activateProposalTurn(turn.id)}
                          >
                            Use this proposal
                          </button>
                        )}
                      </article>
                    ))}
                  </div>

                  <div className="pcal-ai-composer">
                    <textarea
                      value={aiTrainerInput}
                      onChange={(e) => setAiTrainerInput(e.target.value)}
                      placeholder="Example: Move this week's long run to Sunday because I'll ski Saturday, and rebalance the week safely."
                      rows={4}
                    />
                    <div className="pcal-ai-trainer-actions">
                      <button
                        className="dash-btn-primary"
                        type="button"
                        onClick={generateAiAdjustment}
                        disabled={aiTrainerLoading || aiTrainerApplying}
                      >
                        {aiTrainerLoading ? 'Generating…' : 'Generate Recommendation'}
                      </button>
                    </div>
                    {aiTrainerError && <p className="pcal-ai-trainer-error">{aiTrainerError}</p>}
                    {aiTrainerStatus && (
                      <p className="pcal-ai-trainer-status">
                        {humanizeAiText(aiTrainerStatus, aiChangeLookup)}
                      </p>
                    )}
                  </div>

                  {aiTrainerProposal ? (
                    <div className="pcal-ai-trainer-proposal">
                      {/* Coach reply */}
                      <p className="pcal-ai-trainer-reply">
                        {humanizeAiText(aiTrainerProposal.coachReply, aiChangeLookup)}
                      </p>

                      {/* Follow-up question */}
                      {aiTrainerProposal.followUpQuestion && (
                        <p className="pcal-ai-trainer-followup-q">
                          {humanizeAiText(aiTrainerProposal.followUpQuestion, aiChangeLookup)}
                        </p>
                      )}

                      {/* Clarification required */}
                      {aiTrainerProposal.requiresClarification && (
                        <div className="pcal-ai-trainer-clarification">
                          <p>{humanizeAiText(aiTrainerProposal.clarificationPrompt ?? 'Please confirm before applying.', aiChangeLookup)}</p>
                          <textarea
                            value={aiTrainerClarification}
                            onChange={(e) => setAiTrainerClarification(e.target.value)}
                            placeholder="Your response..."
                            rows={2}
                          />
                        </div>
                      )}

                      {/* Changes list */}
                      {aiTrainerProposal.changes.length > 0 && (
                        <div className="pcal-ai-trainer-change-list">
                          {aiTrainerProposal.changes.map((change, i) => (
                            <div key={i} className="pcal-ai-trainer-change-item">
                              <span className="pcal-ai-trainer-change-dot" />
                              <span className="pcal-ai-trainer-change-label">
                                {humanizeAiText(change.reason, aiChangeLookup)}
                              </span>
                              <button
                                type="button"
                                className="dash-btn-primary pcal-ai-apply-one"
                                onClick={() => applyAiAdjustment(i)}
                                disabled={aiTrainerLoading}
                              >
                                Apply
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Action row */}
                      <div className="pcal-ai-trainer-actions">
                        {aiTrainerProposal.changes.length > 1 && (
                          <button
                            type="button"
                            className="dash-btn-primary"
                            onClick={() => applyAiAdjustment()}
                            disabled={aiTrainerLoading}
                          >
                            Apply all changes
                          </button>
                        )}
                        <button
                          type="button"
                          className="dash-btn-ghost pcal-ai-details-toggle"
                          onClick={() => setProposalDetailsOpen((p) => !p)}
                        >
                          {proposalDetailsOpen ? '▾ Hide details' : '▸ Show details'}
                        </button>
                      </div>

                      {/* Expandable details */}
                      {proposalDetailsOpen && (
                        <div className="pcal-ai-trainer-details">
                          <div className="pcal-ai-trainer-meta">
                            <span>Confidence: {aiTrainerProposal.confidence}</span>
                            {aiTrainerProposal.invariantReport && (
                              <span>Mode: {aiTrainerProposal.invariantReport.selectedMode.replace(/_/g, ' ')}</span>
                            )}
                          </div>
                          {aiTrainerProposal.riskFlags && aiTrainerProposal.riskFlags.length > 0 && (
                            <ul className="pcal-ai-trainer-risks">
                              {aiTrainerProposal.riskFlags.map((flag, i) => (
                                <li key={i}>⚠ {flag}</li>
                              ))}
                            </ul>
                          )}
                          {aiTrainerProposal.invariantReport && aiTrainerProposal.invariantReport.weeks.length > 0 && (
                            <div className="pcal-ai-trainer-invariants">
                              {aiTrainerProposal.invariantReport.weeks.map((w) => (
                                <div key={w.weekIndex} className="pcal-ai-trainer-week-row">
                                  <span>Week {w.weekIndex}</span>
                                  <span>Rest: {w.before.restDays}→{w.after.restDays}</span>
                                  <span>Hard: {w.before.hardDays}→{w.after.hardDays}</span>
                                  {w.flags.length > 0 && <span className="pcal-ai-trainer-week-flag">{w.flags.join(', ')}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}
                </section>
              </div>
            </details>
          </div>

          {/* View toggle + column headers */}
          <div className="pcal-calendar-header">
            <div className="pcal-calendar-header-top">
              <div className="pcal-view-toggle">
                <button
                  type="button"
                  className={`pcal-view-pill${viewMode === 'plan' ? ' active' : ''}`}
                  onClick={() => setViewMode('plan')}
                >
                  Plan
                </button>
                <button
                  type="button"
                  className={`pcal-view-pill${viewMode === 'log' ? ' active' : ''}`}
                  onClick={() => setViewMode('log')}
                >
                  Log
                </button>
              </div>
              <div className="pcal-view-toggle">
                <button
                  type="button"
                  className={`pcal-view-pill${cellView === 'compact' ? ' active' : ''}`}
                  onClick={() => setCellView('compact')}
                >
                  Compact
                </button>
                <button
                  type="button"
                  className={`pcal-view-pill${cellView === 'detail' ? ' active' : ''}`}
                  onClick={() => setCellView('detail')}
                >
                  Detail
                </button>
              </div>
            </div>
            {/* Column day-of-week headers — inside calendar-header so they scroll with it */}
            <div className="pcal-week pcal-week-col-header">
              <div className="pcal-week-label" />
              <div className="pcal-week-grid">
                {DAY_LABELS.map((d) => (
                  <span key={d} className="pcal-col-header-label">{d}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Week rows */}
          <div className="pcal-weeks">
            {weeks.map((week: any) => {
              const dayMap = new Map<number, any>();
              for (const day of (week.days || [])) {
                dayMap.set(day.dayOfWeek, day);
              }
              const bounds = resolveWeekBounds({
                weekIndex: week.weekIndex,
                weekStartDate: week.startDate,
                weekEndDate: week.endDate,
                raceDate: plan.raceDate,
                weekCount: plan.weekCount,
                allWeekIndexes
              });
              const weekRange = formatWeekRange(bounds.startDate, bounds.endDate);
              const weekStart = bounds.startDate;
              const weekEnd = bounds.endDate;
              const isCurrentWeek = !!(weekStart && weekEnd && today >= weekStart && today <= weekEnd);

              // Weekly run totals for the label
              const allWeekActivities = week.days?.flatMap((d: any) => d.activities || []) || [];
              const runActivities = allWeekActivities.filter((a: any) => String(a.type).toUpperCase() === 'RUN');
              const isLastWeek = lastWeekIndex !== null && week.weekIndex === lastWeekIndex;
              const weekHasActivities = allWeekActivities.length > 0;
              const canDeleteLastWeek = isEditMode && isLastWeek && !weekHasActivities && deletingWeekId !== week.id;
              const weekTotalRunDist = runActivities.reduce((sum: number, a: any) => {
                const src = resolveActivityDistanceSourceUnit(a, viewerUnits);
                const d = toDisplayDistance(a.distance, src);
                return sum + (d?.value ?? 0);
              }, 0);
              const longRun = runActivities.reduce((best: any, a: any) => {
                const src = resolveActivityDistanceSourceUnit(a, viewerUnits);
                const d = toDisplayDistance(a.distance, src);
                const bestSrc = best ? resolveActivityDistanceSourceUnit(best, viewerUnits) : null;
                const bestD = best ? toDisplayDistance(best.distance, bestSrc) : null;
                return (d?.value ?? 0) > (bestD?.value ?? 0) ? a : best;
              }, null);
              const longRunSrc = longRun ? resolveActivityDistanceSourceUnit(longRun, viewerUnits) : null;
              const longRunDist = longRun ? toDisplayDistance(longRun.distance, longRunSrc) : null;

              return (
                <div className={`pcal-week${isCurrentWeek ? ' pcal-week-current' : ''}`} key={week.id} data-debug-id="WKR">
                  <div className="pcal-week-label">
                    <div className="pcal-week-head">
                      <span className="pcal-week-num">W{week.weekIndex}</span>
                      {isCurrentWeek && <span className="pcal-week-today-badge">Today</span>}
                    </div>
                    {weekRange && <span className="pcal-week-range">{weekRange}</span>}
                    {!weekRange && <span className="pcal-week-range muted">Dates not set</span>}
                    {weekTotalRunDist > 0 && (
                      <div className="pcal-week-run-summary">
                        <span className="pcal-week-run-total">
                          {formatDistanceNumber(weekTotalRunDist)}{viewerUnitLabel}
                        </span>
                        {longRunDist && (
                          <span className="pcal-week-long-run" title="Longest run">
                            LR {formatDistanceNumber(longRunDist.value)}{viewerUnitLabel}
                          </span>
                        )}
                      </div>
                    )}
                    {isEditMode && isLastWeek && (
                      <div className="pcal-week-edit-actions">
                        <button
                          type="button"
                          className="pcal-week-delete-btn"
                          onClick={() => void handleDeleteLastWeek(week)}
                          disabled={!canDeleteLastWeek}
                          title={
                            weekHasActivities
                              ? 'Clear all activities from this week before deleting it.'
                              : undefined
                          }
                        >
                          {deletingWeekId === week.id ? 'Deleting…' : 'Delete last week'}
                        </button>
                        {weekHasActivities && (
                          <span className="pcal-week-delete-hint">Clear this week first</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="pcal-week-grid">
                    {[1, 2, 3, 4, 5, 6, 7].map((dow) => {
                      const day = dayMap.get(dow);
                      const activities = day?.activities || [];
                      const dayDate = getDayDateFromWeekStart(bounds.startDate, dow);
                      const cellDayStatus: DayStatus = day ? getDayStatus(day.notes) : 'OPEN';
                      const dayAutoCompleted = activities.length > 0 && activities.every((activity: any) => activity.completed);
                      const dayDone = cellDayStatus === 'DONE' || dayAutoCompleted;
                      const dayMissed = cellDayStatus === 'MISSED' && !dayAutoCompleted;
                      const dayPartial = cellDayStatus === 'PARTIAL' && !dayAutoCompleted;
                      const isToday = dayDate && dayDate.getTime() === today.getTime();
                      const isPast = dayDate && dayDate.getTime() < today.getTime();
                      const showMonthInDate = !!dayDate && (dow === 1 || dayDate.getDate() === 1);
                      const dayDateKey = dayDate ? toLocalDateKey(dayDate) : null;
                      const dayStravaLogs = dayDateKey ? (stravaMarkersByDate[dayDateKey] || []) : [];
                      const stravaMarkerLogs = dayStravaLogs.slice(0, 3);
                      const stravaOverflow = Math.max(0, dayStravaLogs.length - stravaMarkerLogs.length);

                      const openDayLog = () => {
                        if (!dayDate) return;
                        const dayStatus = cellDayStatus;
                        const missedReason = day ? (getDayMissedReason(day.notes) || null) : null;
                        setSelectedDay({
                          dayId: day?.id || null,
                          dateISO: toLocalDateKey(dayDate),
                          dateLabel: dayDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
                          activities: buildLogActivities(activities, viewerUnits),
                          dayStatus,
                          missedReason,
                        });
                        document.querySelector('.pcal-layout')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      };

                      // Primary type: KEY activity first, then first RUN, then first activity
                      const primaryActivity =
                        activities.find((a: any) => a.mustDo || a.priority === 'KEY') ||
                        activities.find((a: any) => String(a.type).toUpperCase() === 'RUN') ||
                        activities[0];
                      const primaryType = primaryActivity
                        ? String(primaryActivity.type || 'OTHER').toLowerCase()
                        : activities.length === 0 && dayDate ? 'rest' : null;
                      const dayLockedForMove = dayDone || dayAutoCompleted;
                      const isDropTargetDay = Boolean(day?.id && dropTarget?.dayId === day.id);
                      const displayedActivities = (
                        cellView === 'compact' && !isEditMode
                          ? (() => {
                            const seen = new Set<string>();
                            return activities.flatMap((activity: any) => {
                              if (!activity.sessionGroupId) return [{ activity, sessionCount: undefined }];
                              if (seen.has(activity.sessionGroupId)) return [];
                              seen.add(activity.sessionGroupId);
                              const count = activities.filter((x: any) => x.sessionGroupId === activity.sessionGroupId).length;
                              return [{ activity, sessionCount: count }];
                            });
                          })()
                          : activities.map((activity: any) => ({ activity, sessionCount: undefined }))
                      );

                      return (
                        <div
                          className={`pcal-cell${isToday ? ' pcal-cell-today' : ''}${isPast ? ' pcal-cell-past' : ''}${dayDone ? ' pcal-cell-day-done' : ''}${dayMissed ? ' pcal-cell-day-missed' : ''}${dayPartial ? ' pcal-cell-day-partial' : ''}${primaryType ? ` pcal-cell--type-${primaryType}` : ''}${dayDate && !isEditMode ? ' pcal-cell-clickable' : ''}${isDropTargetDay && dropTarget?.valid ? ' pcal-cell-drop-target' : ''}${isDropTargetDay && dropTarget && !dropTarget.valid ? ' pcal-cell-drop-target-invalid' : ''}`}
                          data-debug-id="PDC"
                          key={dow}
                          onClick={dayDate && !isEditMode ? openDayLog : undefined}
                          onDragOver={(event) => {
                            if (!desktopDndEnabled || !draggingActivity || !day?.id) return;
                            event.preventDefault();
                            dragMovedRef.current = true;
                            setDropTarget({
                              dayId: day.id,
                              rawIndex: activities.length,
                              position: 'append',
                              valid: !dayLockedForMove
                            });
                          }}
                          onDrop={(event) => {
                            if (!desktopDndEnabled || !draggingActivity || !day?.id) return;
                            event.preventDefault();
                            if (dayLockedForMove) return;
                            void moveActivity({
                              activityId: draggingActivity.activityId,
                              sourceDayId: draggingActivity.sourceDayId,
                              sourceIndex: draggingActivity.sourceIndex,
                              targetDayId: day.id,
                              rawTargetIndex: activities.length
                            });
                          }}
                        >
                          {dayDate && (
                            <span className="pcal-cell-date">
                              {showMonthInDate
                                ? dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                : dayDate.getDate()}
                            </span>
                          )}
                          {dayDone && <span className="pcal-cell-day-check" title="Day completed">✓</span>}
                          {dayMissed && <span className="pcal-cell-day-check pcal-cell-day-check--missed" title="Day missed">✗</span>}
                          {dayPartial && <span className="pcal-cell-day-check pcal-cell-day-check--partial" title="Day partial">≈</span>}
                          {isToday && <span className="pcal-cell-today-badge">Today</span>}
                          {activities.length === 0 && !isEditMode && (
                            <span className="pcal-cell-empty" />
                          )}
                          {isEditMode && (
                            <button
                              className="btn-ghost"
                              style={{ width: '100%', padding: '4px', fontSize: '11px', marginTop: '4px', borderStyle: 'dashed' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setAddingToDayId(day?.id || null);
                              }}
                            >
                              + Add
                            </button>
                          )}
                          {displayedActivities.map(({ activity: a, sessionCount }: { activity: any; sessionCount: number | undefined }, activityIndex: number) => {
                            const plannedSourceUnit = resolveActivityDistanceSourceUnit(a, viewerUnits);
                            const actualSourceUnit = resolveActivityDistanceSourceUnit(
                              a,
                              viewerUnits,
                              true,
                              plannedSourceUnit
                            );
                            const details: string[] = [];
                            const isRun = String(a.type || '').toUpperCase() === 'RUN';
                            const plannedDistanceLabel = formatDisplayDistance(a.distance, plannedSourceUnit);
                            const loggedDistanceLabel = formatDisplayDistance(a.actualDistance, actualSourceUnit);
                            const runDistanceValue = isRun
                              ? buildDistanceProgressLabel(plannedDistanceLabel, loggedDistanceLabel, viewerUnitLabel)
                              : null;
                            const runDistanceTone = distanceProgressVariant(plannedDistanceLabel, loggedDistanceLabel);
                            let targetBadges: string[] = [];
                            let paceShort: string | null = null;
                            let displayPaceTarget: string | null = null;

                            if (viewMode === 'plan') {
                              if (isRun) {
                                // Run distance is rendered in the compact progress pill below.
                              } else if (plannedDistanceLabel) {
                                details.push(plannedDistanceLabel);
                              }
                              if (a.duration) details.push(`${a.duration}m`);

                              // Pace badge: abbreviation for circle, fallback text
                              const bucket = (a.paceTargetBucket as string | null) || inferPaceBucketFromText(a.paceTarget);
                              paceShort = bucket ? (PACE_BUCKET_SHORT[bucket] ?? null) : null;
                              displayPaceTarget = formatDisplayPace(a.paceTarget, plannedSourceUnit);

                              // Est. run time from distance × parsed pace (when no explicit duration)
                              if (String(a.type).toUpperCase() === 'RUN' && !a.duration) {
                                const distVal = toDisplayDistance(a.distance, plannedSourceUnit)?.value;
                                if (distVal && a.paceTarget) {
                                  const parsed = parseStructuredPaceTarget(a.paceTarget, plannedSourceUnit);
                                  if (parsed?.minSec) {
                                    let d = distVal;
                                    if (parsed.unit && parsed.unit !== viewerUnits) {
                                      d = viewerUnits === 'KM' ? d / 1.60934 : d * 1.60934;
                                    }
                                    const minMin = Math.round(d * parsed.minSec / 60);
                                    const maxMin = Math.round(d * (parsed.maxSec ?? parsed.minSec) / 60);
                                    if (minMin > 0) {
                                      details.push(minMin === maxMin ? `~${minMin}m` : `~${minMin}-${maxMin}m`);
                                    }
                                  }
                                }
                              }

                              if (a.effortTarget && cellView !== 'compact') {
                                targetBadges = [`Effort ${a.effortTarget}`];
                              }
                            } else {
                              // Log view: actuals for completed, planned for upcoming
                              if (a.completed) {
                                if (isRun) {
                                  // Run distance is rendered in the compact progress pill below.
                                } else if (loggedDistanceLabel) {
                                  details.push(loggedDistanceLabel);
                                }
                                if (a.actualDuration) details.push(`${a.actualDuration}m`);
                                const displayActualPace = formatDisplayPace(a.actualPace, actualSourceUnit);
                                if (displayActualPace) details.push(displayActualPace);
                              } else {
                                if (isRun) {
                                  // Run distance is rendered in the compact progress pill below.
                                } else if (plannedDistanceLabel) {
                                  details.push(plannedDistanceLabel);
                                }
                                if (a.duration) details.push(`${a.duration}m`);
                              }
                            }

                            const activityTypeAbbr = ACTIVITY_TYPE_ABBR[String(a.type || 'OTHER')] ?? 'OTH';

                            // Distance label for compact chip (sum for sessions, single for standalone)
                            let compactDistLabel: string | null = null;
                            if (cellView === 'compact') {
                              if (sessionCount && sessionCount > 1) {
                                const members = activities.filter((x: any) => x.sessionGroupId === a.sessionGroupId);
                                let totalPlanned = 0;
                                let totalLogged = 0;
                                let hasPlanned = false;
                                let hasLogged = false;
                                for (const m of members) {
                                  const plannedMemberSource = resolveActivityDistanceSourceUnit(
                                    m,
                                    viewerUnits,
                                    false,
                                    plannedSourceUnit
                                  );
                                  const loggedMemberSource = resolveActivityDistanceSourceUnit(
                                    m,
                                    viewerUnits,
                                    true,
                                    plannedSourceUnit
                                  );
                                  const plannedConverted = toDisplayDistance(m.distance, plannedMemberSource);
                                  const loggedConverted = toDisplayDistance(m.actualDistance, loggedMemberSource);
                                  if (plannedConverted) {
                                    totalPlanned += plannedConverted.value;
                                    hasPlanned = true;
                                  }
                                  if (loggedConverted) {
                                    totalLogged += loggedConverted.value;
                                    hasLogged = true;
                                  }
                                }
                                if (isRun) {
                                  const plannedText = hasPlanned ? `${formatDistanceOneDecimal(totalPlanned)}${viewerUnitLabel}` : null;
                                  const loggedText = hasLogged ? `${formatDistanceOneDecimal(totalLogged)}${viewerUnitLabel}` : null;
                                  compactDistLabel = buildDistanceProgressLabel(plannedText, loggedText, viewerUnitLabel);
                                } else if (hasPlanned || hasLogged) {
                                  const value = viewMode === 'log' && hasLogged ? totalLogged : totalPlanned;
                                  compactDistLabel = `${formatDistanceOneDecimal(value)}${viewerUnitLabel}`;
                                }
                              } else {
                                if (isRun) {
                                  compactDistLabel = buildDistanceProgressLabel(plannedDistanceLabel, loggedDistanceLabel, viewerUnitLabel);
                                } else {
                                  const compactSourceUnit = viewMode === 'log' && a.completed ? actualSourceUnit : plannedSourceUnit;
                                  const compactRawDistance = viewMode === 'log' && a.completed ? a.actualDistance : a.distance;
                                  compactDistLabel = formatDisplayDistance(compactRawDistance, compactSourceUnit);
                                }
                              }
                            }

                            const activityDragDisabled = !desktopDndEnabled || !day?.id || dayLockedForMove || a.completed;
                            const showDropBefore = Boolean(
                              dropTarget
                              && dropTarget.valid
                              && day?.id
                              && dropTarget.dayId === day.id
                              && dropTarget.rawIndex === activityIndex
                            );
                            const showDropAfter = Boolean(
                              dropTarget
                              && dropTarget.valid
                              && day?.id
                              && dropTarget.dayId === day.id
                              && dropTarget.rawIndex === activityIndex + 1
                            );

                            return (
                              <div
                                className={`pcal-activity-wrap${showDropBefore ? ' pcal-activity-wrap-drop-before' : ''}${showDropAfter ? ' pcal-activity-wrap-drop-after' : ''}`}
                                key={a.id}
                              >
                                <div
                                  className={`pcal-activity pcal-activity-clickable${a.completed ? ' pcal-activity-done' : ''}${a.mustDo || a.priority === 'KEY' ? ' pcal-activity-key' : ''}${longRun && a.id === longRun.id ? ' pcal-activity-long-run' : ''}${cellView === 'compact' ? ' pcal-activity-compact' : ''}${movingActivityId === a.id ? ' pcal-activity-moving' : ''}${draggingActivity?.activityId === a.id ? ' pcal-activity-dragging' : ''}`}
                                  title={cellView === 'compact' ? a.title : undefined}
                                  draggable={!activityDragDisabled}
                                  onDragStart={(event) => {
                                    if (activityDragDisabled || !day?.id) return;
                                    event.stopPropagation();
                                    dragMovedRef.current = false;
                                    setDraggingActivity({
                                      activityId: a.id,
                                      sourceDayId: day.id,
                                      sourceIndex: activityIndex
                                    });
                                    setDropTarget({
                                      dayId: day.id,
                                      rawIndex: activityIndex,
                                      position: 'before',
                                      valid: !dayLockedForMove
                                    });
                                    emitPlanEditEvent('plan_activity_drag_started', {
                                      activityId: a.id,
                                      sourceDayId: day.id
                                    });
                                    event.dataTransfer.effectAllowed = 'move';
                                    event.dataTransfer.setData('text/plain', a.id);
                                  }}
                                  onDragEnd={() => {
                                    if (dragMovedRef.current) {
                                      suppressClickActivityIdRef.current = a.id;
                                    }
                                    setDraggingActivity(null);
                                    setDropTarget(null);
                                  }}
                                  onDragOver={(event) => {
                                    if (!desktopDndEnabled || !draggingActivity || !day?.id) return;
                                    event.preventDefault();
                                    event.stopPropagation();
                                    dragMovedRef.current = true;
                                    const rect = event.currentTarget.getBoundingClientRect();
                                    const before = event.clientY <= rect.top + rect.height / 2;
                                    setDropTarget({
                                      dayId: day.id,
                                      rawIndex: before ? activityIndex : activityIndex + 1,
                                      position: before ? 'before' : 'after',
                                      valid: !dayLockedForMove
                                    });
                                  }}
                                  onDrop={(event) => {
                                    if (!desktopDndEnabled || !draggingActivity || !day?.id) return;
                                    event.preventDefault();
                                    event.stopPropagation();
                                    if (dayLockedForMove) return;
                                    const rect = event.currentTarget.getBoundingClientRect();
                                    const before = event.clientY <= rect.top + rect.height / 2;
                                    void moveActivity({
                                      activityId: draggingActivity.activityId,
                                      sourceDayId: draggingActivity.sourceDayId,
                                      sourceIndex: draggingActivity.sourceIndex,
                                      targetDayId: day.id,
                                      rawTargetIndex: before ? activityIndex : activityIndex + 1
                                    });
                                  }}
                                  onClick={(e) => {
                                    if (suppressClickActivityIdRef.current === a.id) {
                                      suppressClickActivityIdRef.current = null;
                                      return;
                                    }
                                    if (isEditMode) {
                                      e.stopPropagation();
                                      setEditingActivity(a);
                                    }
                                    // non-edit: let click bubble up to cell → opens day log
                                  }}
                                >
                                {cellView === 'compact' ? (
                                  <>
                                    <span className={`pcal-activity-abbr type-${String(a.type || 'OTHER').toLowerCase()}`}>
                                      {activityTypeAbbr}{sessionCount && sessionCount > 1 ? ` ×${sessionCount}` : ''}{compactDistLabel ? ` · ${compactDistLabel}` : ''}
                                    </span>
                                    {String(a.type || '').toUpperCase() === 'RUN' && paceShort && (
                                      <span
                                        className="review-pace-chip active pcal-pace-chip-sm"
                                        title={a.paceTarget ?? undefined}
                                      >
                                        {paceShort}
                                      </span>
                                    )}
                                    {isEditMode && !isWideScreen && day?.id && (
                                      <span className="pcal-activity-move-controls">
                                        <button
                                          type="button"
                                          className="pcal-activity-move-btn"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            void moveActivity({
                                              activityId: a.id,
                                              sourceDayId: day.id,
                                              sourceIndex: activityIndex,
                                              targetDayId: day.id,
                                              rawTargetIndex: Math.max(0, activityIndex - 1)
                                            });
                                          }}
                                          disabled={activityIndex === 0 || movingActivityId === a.id}
                                          aria-label="Move activity up"
                                        >
                                          ↑
                                        </button>
                                        <button
                                          type="button"
                                          className="pcal-activity-move-btn"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            void moveActivity({
                                              activityId: a.id,
                                              sourceDayId: day.id,
                                              sourceIndex: activityIndex,
                                              targetDayId: day.id,
                                              rawTargetIndex: activityIndex + 2
                                            });
                                          }}
                                          disabled={activityIndex === activities.length - 1 || movingActivityId === a.id}
                                          aria-label="Move activity down"
                                        >
                                          ↓
                                        </button>
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <div className="pcal-activity-content">
                                    <div className="pcal-detail-row">
                                      <span className={`pcal-activity-abbr type-${String(a.type || 'OTHER').toLowerCase()}${a.completed ? ' pcal-activity-abbr--done' : ''}`}>
                                        {a.completed ? '✓' : activityTypeAbbr}
                                      </span>
                                      <span className="pcal-activity-title-text">{a.title}</span>
                                    </div>
                                    {details.length > 0 && (
                                      <span className="pcal-activity-details">
                                        {details.join(' · ')}
                                      </span>
                                    )}
                                    {runDistanceValue && (
                                      <span className={`pcal-run-distance-line ${runDistanceTone}`}>
                                        {runDistanceValue}
                                      </span>
                                    )}
                                    {(paceShort || displayPaceTarget || targetBadges.length > 0) && (
                                      <span className="pcal-activity-targets">
                                        {paceShort ? (
                                          <span
                                            className="review-pace-chip active pcal-pace-chip-sm"
                                            title={a.paceTarget ?? undefined}
                                          >
                                            {paceShort}
                                          </span>
                                        ) : displayPaceTarget ? (
                                          <span className="pcal-activity-target-chip">{displayPaceTarget}</span>
                                        ) : null}
                                        {targetBadges.map((badge, index) => (
                                          <span key={`${a.id}-target-${index}`} className="pcal-activity-target-chip">
                                            {badge}
                                          </span>
                                        ))}
                                      </span>
                                    )}
                                    {isEditMode && !isWideScreen && day?.id && (
                                      <span className="pcal-activity-move-controls">
                                        <button
                                          type="button"
                                          className="pcal-activity-move-btn"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            void moveActivity({
                                              activityId: a.id,
                                              sourceDayId: day.id,
                                              sourceIndex: activityIndex,
                                              targetDayId: day.id,
                                              rawTargetIndex: Math.max(0, activityIndex - 1)
                                            });
                                          }}
                                          disabled={activityIndex === 0 || movingActivityId === a.id}
                                          aria-label="Move activity up"
                                        >
                                          ↑
                                        </button>
                                        <button
                                          type="button"
                                          className="pcal-activity-move-btn"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            void moveActivity({
                                              activityId: a.id,
                                              sourceDayId: day.id,
                                              sourceIndex: activityIndex,
                                              targetDayId: day.id,
                                              rawTargetIndex: activityIndex + 2
                                            });
                                          }}
                                          disabled={activityIndex === activities.length - 1 || movingActivityId === a.id}
                                          aria-label="Move activity down"
                                        >
                                          ↓
                                        </button>
                                      </span>
                                    )}
                                  </div>
                                )}
                                </div>
                              </div>
                            );
                          })}
                          {dayStravaLogs.length > 0 && (
                            <button
                              type="button"
                              className="pcal-strava-pill"
                              onClick={(event) => {
                                event.stopPropagation();
                                openDayLog();
                              }}
                              aria-label="View synced Strava activities for this day"
                            >
                              <StravaIcon size={12} className="pcal-strava-pill-logo" />
                              <span className="pcal-strava-pill-icons">
                                {stravaMarkerLogs.map((log) => (
                                  <ExternalSportIcon
                                    key={log.id}
                                    provider="STRAVA"
                                    sportType={log.sportType}
                                    className="pcal-strava-icon"
                                  />
                                ))}
                                {stravaOverflow > 0 && (
                                  <span className="pcal-strava-pill-more">+{stravaOverflow}</span>
                                )}
                              </span>
                            </button>
                          )}
                          {dropTarget && dropTarget.valid && day?.id && dropTarget.dayId === day.id && dropTarget.rawIndex === activities.length && (
                            <div className="pcal-drop-indicator" aria-hidden="true" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside
          className={`pcal-chat-panel${selectedDay ? ' day-open' : ''}`}
          id="ai-trainer"
          data-debug-id="PSB"
        >
          {selectedDay && (
            <div className="pcal-day-panel" data-debug-id="PDL">
              <div className="pcal-day-modal-head">
                <div className="pcal-day-modal-head-left">
                  <span className="pcal-day-modal-date">{selectedDay.dateLabel}</span>
                  {selectedDay.activities.length === 0 ? (
                    <span className="pcal-day-modal-summary">Rest day</span>
                  ) : (
                    <span className="pcal-day-modal-summary">
                      {selectedDay.activities.length} planned activit{selectedDay.activities.length === 1 ? 'y' : 'ies'}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="pcal-day-modal-close"
                  onClick={closeSelectedDayPanel}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <div className="pcal-day-panel-scroll">
                <DayLogCard
                  key={selectedDay.dateISO}
                  dayId={selectedDay.dayId}
                  dateISO={selectedDay.dateISO}
                  planId={planId}
                  activities={selectedDay.activities}
                  viewerUnits={viewerUnits}
                  dayStatus={selectedDay.dayStatus}
                  missedReason={selectedDay.missedReason}
                  stravaConnected={stravaConnected}
                  enabled
                  planView={isEditMode}
                  onClose={closeSelectedDayPanel}
                />
              </div>
            </div>
          )}
        </aside>
      </div>
      </div>

      {/* Activity detail modal */}
      {selectedActivity && (
        <div className="pcal-modal-overlay" onClick={() => setSelectedActivity(null)}>
          <div className="pcal-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="pcal-modal-close"
              onClick={() => setSelectedActivity(null)}
              type="button"
              aria-label="Close"
            >
              &times;
            </button>

            <div className="pcal-modal-type-bar" style={{ background: typeColor(selectedActivity.type) }} />

            <div className="pcal-modal-body">
              <span className="pcal-modal-type">
                <span
                  className={`pcal-modal-type-chip type-${String(selectedActivity.type || 'OTHER').toLowerCase()}`}
                  title={formatType(selectedActivity.type)}
                >
                  {typeAbbr(selectedActivity.type)}
                </span>
                {formatType(selectedActivity.type)}
              </span>
              <h2 className="pcal-modal-title">{selectedActivity.title}</h2>
              {selectedActivityDateLabel && (
                <p className="pcal-modal-day-context">
                  {selectedActivityDateLabel}
                </p>
              )}

              {/* Stats row */}
              <div className="pcal-modal-stats">
                {selectedDistanceDisplay && (
                  <div className="pcal-modal-stat">
                    <span className="pcal-modal-stat-value">
                      {formatDistanceNumber(selectedDistanceDisplay.value)}
                    </span>
                    <span className="pcal-modal-stat-label">
                      {viewerUnitLabel}
                    </span>
                  </div>
                )}
                {selectedActivity.duration && (
                  <div className="pcal-modal-stat">
                    <span className="pcal-modal-stat-value">
                      {selectedActivity.duration}
                    </span>
                    <span className="pcal-modal-stat-label">min</span>
                  </div>
                )}
              </div>

              {selectedTargetBadges.length > 0 && (
                <div className="pcal-modal-section pcal-modal-section-tight">
                  <h3 className="pcal-modal-section-title">Targets</h3>
                  <div className="pcal-modal-targets">
                    {selectedTargetBadges.map((badge, index) => (
                      <span key={`selected-target-${index}`} className="pcal-modal-target-chip">
                        {badge}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Instructions / Strava sync */}
              <div className="pcal-modal-section">
                <div className="pcal-modal-section-head">
                  <h3 className="pcal-modal-section-title">Instructions</h3>
                  {!isEditMode && (
                    <button
                      className="pcal-modal-strava-sync"
                      onClick={syncActivityFromStrava}
                      type="button"
                      disabled={syncingStrava || savingActuals}
                    >
                      {syncingStrava ? 'Syncing…' : 'Sync with Strava'}
                    </button>
                  )}
                </div>
                {selectedActivity.sessionInstructions ? (
                  <p className="pcal-modal-text">{selectedActivity.sessionInstructions}</p>
                ) : (
                  <p className="pcal-modal-text pcal-modal-text-muted">{selectedActivity.rawText || 'No instructions for this activity.'}</p>
                )}
                {!isEditMode && stravaSyncError && <p className="pcal-modal-form-error">{stravaSyncError}</p>}
                {!isEditMode && stravaSyncStatus && <p className="pcal-modal-form-success">{stravaSyncStatus}</p>}
              </div>

              {/* Notes */}
              {selectedActivity.notes && (
                <div className="pcal-modal-section">
                  <h3 className="pcal-modal-section-title">Notes</h3>
                  <p className="pcal-modal-text">{selectedActivity.notes}</p>
                </div>
              )}

              {/* Actuals */}
              {isEditMode ? (
                <div className="pcal-modal-section pcal-modal-edit-lockout" role="note">
                  <h3 className="pcal-modal-section-title">Logging locked while editing plan</h3>
                  <p className="pcal-modal-text">
                    Exit plan editing mode to sync Strava, complete workouts, or update actual distance/time.
                  </p>
                </div>
              ) : (
                <div className="pcal-modal-section">
                  <div className="pcal-modal-section-head">
                    <h3 className="pcal-modal-section-title">Actuals</h3>
                    {selectedActivityDateLabel && (
                      <span className="pcal-modal-day-chip">{selectedActivityDateLabel}</span>
                    )}
                  </div>
                  <div className="pcal-modal-actuals-form">
                    <label>
                      Distance ({viewerUnitLabel})
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={actualDistance}
                        onChange={(e) => setActualDistance(e.target.value)}
                        placeholder={
                          selectedDistanceDisplay?.value != null
                            ? String(selectedDistanceDisplay.value)
                            : 'e.g. 8'
                        }
                      />
                    </label>
                    <label>
                      Duration (min)
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1"
                        value={actualDuration}
                        onChange={(e) => setActualDuration(e.target.value)}
                        placeholder={selectedActivity.duration != null ? String(selectedActivity.duration) : 'e.g. 50'}
                      />
                    </label>
                    <label>
                      Pace
                      <input
                        type="text"
                        value={actualPace}
                        onChange={(e) => setActualPace(e.target.value)}
                        placeholder={
                          selectedPaceDisplay
                          || `e.g. ${viewerUnitLabel === 'km' ? '4:40 /km' : '7:30 /mi'}`
                        }
                      />
                    </label>
                  </div>
                  <p className="pcal-modal-text pcal-modal-actuals-hint">
                    {selectedActivity.completed
                      ? 'This activity is marked done. Update actuals if needed.'
                      : 'Actuals are optional. Use Complete below to save this activity.'}
                  </p>
                  {actualsError && <p className="pcal-modal-form-error">{actualsError}</p>}
                </div>
              )}

              {/* Tags */}
              {selectedActivity.tags && Array.isArray(selectedActivity.tags) && selectedActivity.tags.length > 0 && (
                <div className="pcal-modal-tags">
                  {selectedActivity.tags.map((tag: string, i: number) => (
                    <span className="pcal-modal-tag" key={i}>{tag}</span>
                  ))}
                </div>
              )}

              {/* Priority / Key workout badge */}
              {(selectedActivity.mustDo || selectedActivity.priority === 'KEY') && (
                <div className="pcal-modal-badge-row">
                  <span className="pcal-modal-badge">Key Workout</span>
                </div>
              )}

              <div className="pcal-modal-footer">
                <button
                  className="pcal-modal-cancel"
                  onClick={() => setSelectedActivity(null)}
                  type="button"
                  disabled={savingActuals || syncingStrava}
                >
                  Cancel
                </button>
                {isEditMode ? (
                  <button
                    className="pcal-modal-primary"
                    onClick={() => {
                      setSelectedActivity(null);
                      setEditingActivity(selectedActivity);
                    }}
                    type="button"
                  >
                    Edit activity
                  </button>
                ) : (
                  <button
                    className="pcal-modal-primary"
                    onClick={selectedActivity.completed ? saveActuals : completeFromModal}
                    type="button"
                    disabled={savingActuals || syncingStrava}
                  >
                    {savingActuals
                      ? 'Saving…'
                      : (selectedActivity.completed ? 'Save' : 'Complete')}
                  </button>
                )}
              </div>

            </div>
          </div>
        </div>
      )}
      {bannerModalOpen && (
        <div className="pcal-modal-overlay" onClick={() => setBannerModalOpen(false)}>
          <div className="pcal-modal pcal-banner-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="pcal-modal-close"
              onClick={() => setBannerModalOpen(false)}
              type="button"
              aria-label="Close banner library"
            >
              &times;
            </button>
            <div className="pcal-modal-body pcal-banner-modal-body">
              <div className="pcal-banner-modal-head">
                <div>
                  <h2>Banner Library</h2>
                  <p>
                    Upload up to {PLAN_IMAGE_MAX_COUNT} images ({Math.round(PLAN_IMAGE_MAX_FILE_BYTES / (1024 * 1024))}MB max each).
                  </p>
                </div>
                <span className="pcal-banner-modal-count">
                  {bannerImages.length}/{PLAN_IMAGE_MAX_COUNT}
                </span>
              </div>
              <div className="pcal-banner-modal-toolbar">
                <label className="dash-btn-primary pcal-banner-upload-btn">
                  {bannerUploading ? 'Uploading…' : 'Upload images'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    multiple
                    disabled={bannerUploading || bannerImages.length >= PLAN_IMAGE_MAX_COUNT}
                    onChange={(event) => {
                      void uploadBannerFiles(event.target.files);
                      event.currentTarget.value = '';
                    }}
                  />
                </label>
                <span className="pcal-banner-modal-help">
                  Supported: JPG, PNG, WEBP, AVIF
                </span>
              </div>
              {bannerLibraryError && <p className="pcal-modal-form-error">{bannerLibraryError}</p>}
              {bannerLibraryStatus && <p className="pcal-modal-form-success">{bannerLibraryStatus}</p>}
              {bannerLibraryLoading ? (
                <p className="pcal-banner-modal-empty">Loading images…</p>
              ) : bannerImages.length === 0 ? (
                <p className="pcal-banner-modal-empty">
                  No images yet. Upload one to personalize this plan.
                </p>
              ) : (
                <div className="pcal-banner-grid">
                  {bannerImages.map((image) => {
                    const busy = bannerActionImageId === image.id;
                    const focusY = Math.max(
                      0,
                      Math.min(1, typeof bannerFocusDraft[image.id] === 'number' ? bannerFocusDraft[image.id] : image.focusY)
                    );
                    return (
                      <article
                        key={image.id}
                        className={`pcal-banner-card${image.isSelected ? ' is-selected' : ''}`}
                      >
                        <div className="pcal-banner-card-image-wrap">
                          <Image
                            src={image.url}
                            alt={image.fileName ? `Banner ${image.fileName}` : 'Plan banner image'}
                            fill
                            sizes="(max-width: 640px) 100vw, 240px"
                            className="pcal-banner-card-image"
                            unoptimized
                            style={{ objectPosition: `50% ${Math.round(focusY * 100)}%` }}
                          />
                          {image.isSelected && <span className="pcal-banner-selected">Selected</span>}
                          <span
                            className="pcal-banner-focus-guide"
                            style={{ top: `${Math.round(focusY * 100)}%` }}
                            aria-hidden
                          />
                        </div>
                        <div className="pcal-banner-card-meta">
                          <strong title={image.fileName || 'Image'}>
                            {image.fileName || 'Untitled image'}
                          </strong>
                          <span>{formatBytes(image.fileSize)}</span>
                        </div>
                        <div className="pcal-banner-card-actions">
                          <button
                            type="button"
                            className="dash-btn-ghost"
                            disabled={busy || image.isSelected}
                            onClick={() => void selectBannerImage(image.id)}
                          >
                            {image.isSelected ? 'Selected' : busy ? 'Saving…' : 'Set banner'}
                          </button>
                          <button
                            type="button"
                            className="dash-btn-ghost pcal-banner-delete-btn"
                            disabled={busy}
                            onClick={() => void deleteBannerImage(image.id)}
                          >
                            {busy ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                        <div className="pcal-banner-focus-control">
                          <label htmlFor={`banner-focus-${image.id}`}>Focus line</label>
                          <input
                            id={`banner-focus-${image.id}`}
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={Math.round(focusY * 100)}
                            disabled={busy}
                            onChange={(event) => {
                              const next = Number(event.target.value) / 100;
                              setBannerFocusDraft((prev) => ({ ...prev, [image.id]: next }));
                            }}
                          />
                          <button
                            type="button"
                            className="dash-btn-ghost"
                            disabled={busy || Math.abs(focusY - image.focusY) < 0.005}
                            onClick={() => void updateBannerFocus(image.id, focusY)}
                          >
                            {busy ? 'Saving…' : 'Save focus'}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Activity Form Modal */}
      <ActivityForm
        isOpen={!!editingActivity || !!addingToDayId}
        onClose={() => {
          setEditingActivity(null);
          setAddingToDayId(null);
        }}
        onSubmit={handleSaveActivity}
        onDelete={handleDeleteActivity}
        initialData={editingActivity || {}}
        title={editingActivity ? 'Edit Activity' : 'Add Activity'}
        dayId={addingToDayId || undefined}
        sessionInstructions={
          (() => {
            const sessionText = typeof (editingActivity as any)?.sessionInstructions === 'string'
              ? (editingActivity as any).sessionInstructions.trim()
              : '';
            if (sessionText) return sessionText;
            const rawText = typeof (editingActivity as any)?.rawText === 'string'
              ? (editingActivity as any).rawText.trim()
              : '';
            return rawText || null;
          })()
        }
        dayOptions={dayOptions}
      />


    </main>
  );
}
