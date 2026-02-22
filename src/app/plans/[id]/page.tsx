'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { getDayDateFromWeekStart, resolveWeekBounds } from '@/lib/plan-dates';
import { isDayMarkedDone, getDayStatus, getDayMissedReason, type DayStatus } from '@/lib/day-status';
import ActivityTypeIcon from '@/components/ActivityTypeIcon';
import PlanSidebar from '@/components/PlanSidebar';
import SelectedPlanCookie from '@/components/SelectedPlanCookie';
import {
  convertDistanceForDisplay,
  convertPaceForDisplay,
  distanceUnitLabel,
  formatDistanceNumber,
  resolveDistanceUnitFromActivity,
  type DistanceUnit
} from '@/lib/unit-display';
import ActivityForm, { ActivityFormData } from '@/components/PlanEditor/ActivityForm';
import DayLogCard from '@/components/DayLogCard';
import { buildLogActivities, type LogActivity } from '@/lib/log-activity';
import '../plans.css';
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

function formatType(type: string) {
  return type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
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

export default function PlanDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const planId = Array.isArray(params?.id) ? params?.id[0] : params?.id;
  const aiPromptParam = searchParams?.get('aiPrompt')?.trim() || '';
  const aiPromptSource = searchParams?.get('aiSource')?.trim() || '';
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
  const [viewMode, setViewMode] = useState<'plan' | 'log'>('plan');
  const [cellView, setCellView] = useState<'compact' | 'detail'>('detail');
  const [selectedDay, setSelectedDay] = useState<SelectedDayState | null>(null);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [aiTrainerInput, setAiTrainerInput] = useState('');
  const [aiChatTurns, setAiChatTurns] = useState<AiChatTurn[]>(() => [
    createAiGreetingTurn()
  ]);
  const [activeProposalTurnId, setActiveProposalTurnId] = useState<string | null>(null);
  const [aiAppliedByTurn, setAiAppliedByTurn] = useState<Record<string, number[]>>({});
  const [aiTrainerLoading, setAiTrainerLoading] = useState(false);
  const [aiTrainerApplyingTarget, setAiTrainerApplyingTarget] = useState<'all' | number | null>(null);
  const [aiTrainerError, setAiTrainerError] = useState<string | null>(null);
  const [aiTrainerStatus, setAiTrainerStatus] = useState<string | null>(null);
  const [aiTrainerClarification, setAiTrainerClarification] = useState('');
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

  // -- Edit Mode State --
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingActivity, setEditingActivity] = useState<any>(null);
  const [addingToDayId, setAddingToDayId] = useState<string | null>(null);

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

  const handleSaveActivity = async (data: ActivityFormData) => {
    try {
      if (editingActivity) {
        // Edit existing
        const res = await fetch(`/api/activities/${editingActivity.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to update activity');
        }
        // Refresh plan
        await loadPlan();
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
        await loadPlan();
      }
    } catch (err: any) {
      alert(err.message); // Simple error feedback for now
      throw err;
    }
  };

  const handleDeleteActivity = async (activityId: string) => {
    if (!confirm('Are you sure you want to delete this activity?')) return;
    try {
      const res = await fetch(`/api/activities/${activityId}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete');
      await loadPlan();
      setEditingActivity(null); // Close form if it was open (though usually delete is from form or list)
    } catch (err: any) {
      alert(err.message);
    }
  };

  const loadPlan = useCallback(async () => {
    if (!planId) return;
    try {
      const res = await fetch(`/api/plans/${planId}`);
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
  }, [planId]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  useEffect(() => {
    fetch('/api/integrations/accounts')
      .then(r => r.json())
      .then(data => {
        const strava = (data?.accounts || []).find((a: any) => a.provider === 'STRAVA');
        setStravaConnected(Boolean(strava?.connected && strava?.isActive));
      })
      .catch(() => {});
  }, []);

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
    if (!selectedActivity || savingActuals) return;
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
  }, [selectedActivity, savingActuals, actualDistance, actualDuration, actualPace, viewerUnits, applyActivityUpdate]);

  const syncActivityFromStrava = useCallback(async () => {
    if (!selectedActivity || syncingStrava) return;

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
        body: JSON.stringify({ date: dateISO })
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
  }, [selectedActivity, syncingStrava, loadPlan]);

  const completeFromModal = useCallback(() => {
    const withActuals = Boolean(
      actualDistance.trim()
      || actualDuration.trim()
      || actualPace.trim()
    );
    completeActivity(withActuals);
  }, [actualDistance, actualDuration, actualPace, completeActivity]);

  const saveActuals = useCallback(async () => {
    if (!selectedActivity || savingActuals) return;
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
  }, [selectedActivity, savingActuals, actualDistance, actualDuration, actualPace, viewerUnits, applyActivityUpdate]);

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
      if (e.key === 'Escape') setSelectedActivity(null);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

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
  const toDisplayDistance = (value: number | null | undefined, sourceUnit: string | null | undefined) =>
    convertDistanceForDisplay(value, sourceUnit, viewerUnits);
  const formatDisplayDistance = (value: number | null | undefined, sourceUnit: string | null | undefined) => {
    const converted = toDisplayDistance(value, sourceUnit);
    if (!converted) return null;
    return `${formatDistanceNumber(converted.value)}${distanceUnitLabel(converted.unit)}`;
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

  return (
    <main className="pcal">
      <SelectedPlanCookie planId={plan.status === 'ACTIVE' ? plan.id : null} />
      <div className="pcal-layout">
        <PlanSidebar
          planId={plan.id}
          active="overview"
        />

        <section className="pcal-main">
          {/* Header */}
          <div className="pcal-header" id="plan-overview">
            <div className="pcal-header-top">
              <h1>{plan.name}</h1>
              <button
                type="button"
                className={`dash-btn-ghost pcal-edit-btn${isEditMode ? ' active' : ''}`}
                onClick={() => setIsEditMode(!isEditMode)}
              >
                {isEditMode ? 'Done Editing' : 'Edit Plan'}
              </button>
            </div>
            <div className="pcal-header-meta">
              <span className={`plan-detail-status ${statusClass}`}>{plan.status}</span>
              {plan.weekCount && <span className="pcal-header-meta-item">{plan.weekCount} weeks</span>}
              {plan.raceName && <span className="pcal-header-meta-item">{plan.raceName}</span>}
              {plan.raceDate && <span className="pcal-header-meta-item">{new Date(plan.raceDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
              {plan.sourcePlanName && <span className="pcal-header-meta-item">Source: {plan.sourcePlanName}</span>}
            </div>
          </div>

          {/* Stats bar */}
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
            <div className="pcal-col-headers">
              {DAY_LABELS.map((d) => (
                <span key={d}>{d}</span>
              ))}
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

              return (
                <div className={`pcal-week${isCurrentWeek ? ' pcal-week-current' : ''}`} key={week.id}>
                  <div className="pcal-week-label">
                    <div className="pcal-week-head">
                      <span className="pcal-week-num">W{week.weekIndex}</span>
                      {isCurrentWeek && <span className="pcal-week-today-badge">Today</span>}
                    </div>
                    {weekRange && <span className="pcal-week-range">{weekRange}</span>}
                    {!weekRange && <span className="pcal-week-range muted">Dates not set</span>}
                  </div>
                  <div className="pcal-week-grid">
                    {[1, 2, 3, 4, 5, 6, 7].map((dow) => {
                      const day = dayMap.get(dow);
                      const activities = day?.activities || [];
                      const dayDate = getDayDateFromWeekStart(bounds.startDate, dow);
                      const dayManualDone = isDayMarkedDone(day?.notes);
                      const dayDone = dayManualDone || (activities.length > 0 && activities.every((activity: any) => activity.completed));
                      const isToday = dayDate && dayDate.getTime() === today.getTime();
                      const isPast = dayDate && dayDate.getTime() < today.getTime();
                      const showMonthInDate = !!dayDate && (dow === 1 || dayDate.getDate() === 1);

                      const openDayLog = () => {
                        if (!dayDate) return;
                        const dayStatus = day ? getDayStatus(day.notes) : 'OPEN';
                        const missedReason = day ? (getDayMissedReason(day.notes) || null) : null;
                        setSelectedDay({
                          dayId: day?.id || null,
                          dateISO: toLocalDateKey(dayDate),
                          dateLabel: dayDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
                          activities: buildLogActivities(activities, viewerUnits),
                          dayStatus,
                          missedReason,
                        });
                      };

                      return (
                        <div
                          className={`pcal-cell${isToday ? ' pcal-cell-today' : ''}${isPast ? ' pcal-cell-past' : ''}${dayDone ? ' pcal-cell-day-done' : ''}${!isEditMode && dayDate ? ' pcal-cell-clickable' : ''}`}
                          key={dow}
                          onClick={!isEditMode && dayDate ? openDayLog : undefined}
                        >
                          {dayDate && (
                            <span className="pcal-cell-date">
                              {showMonthInDate
                                ? dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                : dayDate.getDate()}
                            </span>
                          )}
                          {dayDone && <span className="pcal-cell-day-check" title="Day completed">✓</span>}
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
                          {activities.map((a: any) => {
                            const plannedSourceUnit = resolveActivityDistanceSourceUnit(a, viewerUnits);
                            const actualSourceUnit = resolveActivityDistanceSourceUnit(
                              a,
                              viewerUnits,
                              true,
                              plannedSourceUnit
                            );
                            const details: string[] = [];
                            let targetBadges: string[] = [];

                            if (viewMode === 'plan') {
                              const plannedDistanceLabel = formatDisplayDistance(a.distance, plannedSourceUnit);
                              if (plannedDistanceLabel) details.push(plannedDistanceLabel);
                              if (a.duration) details.push(`${a.duration}m`);
                              const displayPaceTarget = formatDisplayPace(a.paceTarget, plannedSourceUnit);
                              targetBadges = createTargetBadges({
                                paceTarget: displayPaceTarget,
                                effortTarget: a.effortTarget
                              });
                            } else {
                              // Log view: actuals for completed, planned for upcoming
                              if (a.completed) {
                                const actualDistanceLabel = formatDisplayDistance(a.actualDistance, actualSourceUnit);
                                if (actualDistanceLabel) details.push(actualDistanceLabel);
                                if (a.actualDuration) details.push(`${a.actualDuration}m`);
                                const displayActualPace = formatDisplayPace(a.actualPace, actualSourceUnit);
                                if (displayActualPace) details.push(displayActualPace);
                              } else {
                                const plannedDistanceLabel = formatDisplayDistance(a.distance, plannedSourceUnit);
                                if (plannedDistanceLabel) details.push(plannedDistanceLabel);
                                if (a.duration) details.push(`${a.duration}m`);
                              }
                            }

                            const activityTypeAbbr = ACTIVITY_TYPE_ABBR[String(a.type || 'OTHER')] ?? 'OTH';
                            return (
                              <div
                                className={`pcal-activity pcal-activity-clickable${a.completed ? ' pcal-activity-done' : ''}${a.mustDo || a.priority === 'KEY' ? ' pcal-activity-key' : ''}${cellView === 'compact' ? ' pcal-activity-compact' : ''}`}
                                key={a.id}
                                title={cellView === 'compact' ? a.title : undefined}
                                onClick={(e) => {
                                  if (isEditMode) {
                                    e.stopPropagation();
                                    setEditingActivity(a);
                                  }
                                  // non-edit: let click bubble up to cell → opens day log
                                }}
                              >
                                <span
                                  className={`pcal-complete-indicator${a.completed ? ' pcal-complete-indicator-done' : ''}`}
                                  aria-hidden="true"
                                  title={a.completed ? 'Completed' : 'Planned'}
                                />
                                {cellView === 'compact' ? (
                                  <span className={`pcal-activity-abbr type-${String(a.type || 'OTHER').toLowerCase()}`}>
                                    {activityTypeAbbr}
                                  </span>
                                ) : (
                                  <div className="pcal-activity-content">
                                    <span className="pcal-activity-title">
                                      <ActivityTypeIcon
                                        type={a.type}
                                        className={`pcal-activity-icon type-${String(a.type || 'OTHER').toLowerCase()}`}
                                      />
                                      <span className="pcal-activity-title-text">{a.title}</span>
                                    </span>
                                    {details.length > 0 && (
                                      <span className="pcal-activity-details">
                                        {details.join(' · ')}
                                      </span>
                                    )}
                                    {targetBadges.length > 0 && (
                                      <span className="pcal-activity-targets">
                                        {targetBadges.map((badge, index) => (
                                          <span key={`${a.id}-target-${index}`} className="pcal-activity-target-chip">
                                            {badge}
                                          </span>
                                        ))}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="pcal-chat-panel" id="ai-trainer">
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
              {aiChatTurns.length === 0 && (
                <p className="pcal-ai-trainer-status">
                  Start with one clear request, for example: &quot;Move this week’s long run to Sunday and rebalance recovery.&quot;
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
                <div className="pcal-ai-trainer-meta">
                  <strong>Active Recommendation</strong>
                  <span>Confidence: {aiTrainerProposal.confidence}</span>
                </div>
                <p>{humanizeAiText(aiTrainerProposal.coachReply, aiChangeLookup)}</p>
                {aiTrainerProposal.followUpQuestion && (
                  <p className="pcal-ai-trainer-followup">
                    Follow-up: {humanizeAiText(aiTrainerProposal.followUpQuestion, aiChangeLookup)}
                  </p>
                )}
                {aiTrainerProposal.requiresClarification && (
                  <div className="pcal-ai-trainer-followup">
                    <p>
                      Clarification required: {humanizeAiText(aiTrainerProposal.clarificationPrompt || 'Please confirm constraints before applying.', aiChangeLookup)}
                    </p>
                    <textarea
                      value={aiTrainerClarification}
                      onChange={(e) => setAiTrainerClarification(e.target.value)}
                      placeholder="Example: Keep long run on Sunday, max 1 hard session mid-week, no added mileage this week."
                      rows={3}
                    />
                  </div>
                )}
                {aiTrainerProposal.invariantReport && aiTrainerProposal.invariantReport.weeks.length > 0 && (
                  <div className="pcal-ai-trainer-invariants">
                    <div className="pcal-ai-trainer-meta">
                      <strong>Week Balance Check</strong>
                      <span>
                        Mode: {aiTrainerProposal.invariantReport.selectedMode.replace(/_/g, ' ')} · Score: {aiTrainerProposal.invariantReport.candidateScore}
                      </span>
                    </div>
                    <div className="pcal-ai-trainer-invariant-grid">
                      {aiTrainerProposal.invariantReport.weeks.map((week) => (
                        <article key={`inv-${week.weekIndex}`} className="pcal-ai-trainer-invariant-week">
                          <header>
                            <strong>Week {week.weekIndex}</strong>
                          </header>
                          <p>Rest: {week.before.restDays} → {week.after.restDays}</p>
                          <p>Hard days: {week.before.hardDays} → {week.after.hardDays}</p>
                          <p>Long run: {formatDowLabel(week.before.longRunDayOfWeek)} → {formatDowLabel(week.after.longRunDayOfWeek)}</p>
                          <p>Planned duration: {week.before.plannedDurationMin}m → {week.after.plannedDurationMin}m</p>
                          {week.flags.length > 0 && (
                            <ul>
                              {week.flags.map((flag, idx) => (
                                <li key={`${week.weekIndex}-${flag}-${idx}`}>{flag}</li>
                              ))}
                            </ul>
                          )}
                        </article>
                      ))}
                    </div>
                    {aiTrainerProposal.invariantReport.summaryFlags.length > 0 && (
                      <div className="pcal-ai-trainer-risks">
                        <strong>Balance Notes</strong>
                        <ul>
                          {aiTrainerProposal.invariantReport.summaryFlags.map((flag, idx) => (
                            <li key={`summary-${idx}`}>{flag}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                <div className="pcal-ai-trainer-meta">
                  <strong>Planned Changes ({aiTrainerProposal.changes.length})</strong>
                </div>
                {aiTrainerProposal.changes.length === 0 && (
                  <p className="pcal-ai-trainer-followup">
                    This request needs a plan-structure update (weeks/dates), which is not supported yet.
                  </p>
                )}
                <ul className="pcal-ai-trainer-change-list">
                  {aiTrainerProposal.changes.map((change, idx) => (
                    <li
                      key={`${change.op}-${idx}`}
                      className={aiTrainerAppliedRows.has(idx) ? 'is-applied' : ''}
                    >
                      <div className="pcal-ai-trainer-change-head">
                        <span className="pcal-ai-trainer-op">{change.op.replace(/_/g, ' ')}</span>
                        <strong>{describeAiChange(change, aiChangeLookup)}</strong>
                        <button
                          className="dash-btn-ghost pcal-ai-trainer-apply-one"
                          type="button"
                          onClick={() => applyAiAdjustment(idx)}
                          disabled={
                            aiTrainerAppliedRows.has(idx)
                            || aiTrainerLoading
                            || aiTrainerApplying
                            || (aiTrainerProposal.requiresClarification && !aiTrainerClarification.trim())
                          }
                        >
                          {aiTrainerAppliedRows.has(idx)
                            ? 'Applied'
                            : aiTrainerApplyingTarget === idx
                              ? 'Applying…'
                              : 'Apply'}
                        </button>
                      </div>
                      <p>{humanizeAiText(change.reason, aiChangeLookup)}</p>
                    </li>
                  ))}
                </ul>
                <div className="pcal-ai-trainer-apply-all">
                  <button
                    className="dash-btn-primary"
                    type="button"
                    onClick={() => applyAiAdjustment()}
                    disabled={
                      aiTrainerProposal.changes.length === 0
                      || aiTrainerAppliedRows.size >= aiTrainerProposal.changes.length
                      || aiTrainerLoading
                      || aiTrainerApplying
                      || (aiTrainerProposal.requiresClarification && !aiTrainerClarification.trim())
                    }
                  >
                    {aiTrainerApplyingTarget === 'all' ? 'Applying all…' : 'Apply All Changes'}
                  </button>
                </div>
                {(aiTrainerProposal.riskFlags || []).length > 0 && (
                  <div className="pcal-ai-trainer-risks">
                    <strong>Risk Flags</strong>
                    <ul>
                      {(aiTrainerProposal.riskFlags || []).map((flag, idx) => (
                        <li key={`${flag}-${idx}`}>{humanizeAiText(flag, aiChangeLookup)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="pcal-ai-trainer-proposal pcal-ai-proposal-empty">
                <p>No active recommendation. Generate a new one from the chat above.</p>
              </div>
            )}
          </section>
        </aside>
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
                  <button
                    className="pcal-modal-strava-sync"
                    onClick={syncActivityFromStrava}
                    type="button"
                    disabled={syncingStrava || savingActuals}
                  >
                    {syncingStrava ? 'Syncing…' : 'Sync with Strava'}
                  </button>
                </div>
                <p className="pcal-modal-text">{selectedActivity.rawText || 'No extra instructions for this activity.'}</p>
                {stravaSyncError && <p className="pcal-modal-form-error">{stravaSyncError}</p>}
                {stravaSyncStatus && <p className="pcal-modal-form-success">{stravaSyncStatus}</p>}
              </div>

              {/* Notes */}
              {selectedActivity.notes && (
                <div className="pcal-modal-section">
                  <h3 className="pcal-modal-section-title">Notes</h3>
                  <p className="pcal-modal-text">{selectedActivity.notes}</p>
                </div>
              )}

              {/* Actuals */}
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
              </div>

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
      />

      {/* Day log modal */}
      {selectedDay && (
        <div
          className="pcal-day-overlay"
          onClick={() => { setSelectedDay(null); loadPlan(); }}
        >
          <div className="pcal-day-modal" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="pcal-day-modal-head">
              <div className="pcal-day-modal-head-left">
                <span className="pcal-day-modal-date">{selectedDay.dateLabel}</span>
                {selectedDay.activities.length === 0 && (
                  <h3 className="pcal-day-modal-title">Rest Day</h3>
                )}
                {selectedDay.activities.map((a) => (
                  <div key={a.id} className="pcal-day-modal-activity">
                    <span className={`pcal-activity-abbr type-${String(a.type || 'OTHER').toLowerCase()}`}>
                      {typeAbbr(a.type)}
                    </span>
                    <div className="pcal-day-modal-activity-copy">
                      <span className="pcal-day-modal-title">{a.title || formatType(a.type)}</span>
                      {a.plannedDetails.length > 0 && (
                        <span className="pcal-day-modal-metrics">{a.plannedDetails.join(' · ')}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="pcal-day-modal-close"
                onClick={() => { setSelectedDay(null); loadPlan(); }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {/* Day log card */}
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
              onClose={() => { setSelectedDay(null); loadPlan(); }}
            />
          </div>
        </div>
      )}

    </main>
  );
}
