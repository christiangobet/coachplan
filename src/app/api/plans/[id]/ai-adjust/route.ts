import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { ActivityPriority, ActivityType, Units } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getDefaultAiModel, openaiJsonSchema } from '@/lib/openai';
import { ensureUserFromAuth } from '@/lib/user-sync';
import { getDayDateFromWeekStart, resolveWeekBounds } from '@/lib/plan-dates';
import { isDayClosed } from '@/lib/day-status';

import {
  applyAdjustmentProposal,
  PlanAdjustmentProposal,
  sanitizeProposalAgainstLockedDays,
  buildLockStateFromPlan,
  PlanAdjustmentChange,
  EditActivityChange,
  AddActivityChange
} from '@/lib/plan-editor';

type PlanAdjustRequestBody = {
  message?: unknown;
  apply?: unknown;
  proposal?: unknown;
  changeIndexes?: unknown;
  clarificationResponse?: unknown;
};

const PLAN_PATCH_SCHEMA_VERSION = 'coachplan.plan_patch.v1';
const MAX_PATCH_CHANGES = 24;
const INJURY_OR_ILLNESS_PATTERN = /\b(injur|pain|sick|ill|fever|flu|achilles|shin|knee|hip|hamstring|calf)\b/i;
const VALID_MODES = new Set(['minimal_changes', 'balanced', 'aggressive', 'injury_cautious']);

const QUALITY_RUN_SUBTYPES = new Set([
  'tempo',
  'hills',
  'hill-pyramid',
  'incline-treadmill',
  'progression',
  'training-race',
  'race',
  'fast-finish'
]);

function buildApplyToken(planId: string, proposal: PlanAdjustmentProposal): string {
  const payload = JSON.stringify({
    schemaVersion: proposal.schemaVersion || PLAN_PATCH_SCHEMA_VERSION,
    patchId: proposal.patchId || '',
    createdAt: proposal.createdAt || '',
    mode: proposal.mode || 'balanced',
    requiresClarification: Boolean(proposal.requiresClarification),
    clarificationPrompt: proposal.clarificationPrompt || null,
    coachReply: proposal.coachReply,
    summary: proposal.summary,
    confidence: proposal.confidence,
    riskFlags: proposal.riskFlags || [],
    followUpQuestion: proposal.followUpQuestion || null,
    changes: proposal.changes
  });

  return createHash('sha256')
    .update(`coachplan:ai-adjust:${planId}:${payload}`)
    .digest('hex');
}

function withPatchEnvelope(planId: string, proposal: PlanAdjustmentProposal): PlanAdjustmentProposal {
  const normalized: PlanAdjustmentProposal = {
    ...proposal,
    schemaVersion: proposal.schemaVersion || PLAN_PATCH_SCHEMA_VERSION,
    patchId: proposal.patchId || randomUUID(),
    createdAt: proposal.createdAt || new Date().toISOString(),
    mode: proposal.mode || 'balanced'
  };

  return {
    ...normalized,
    applyToken: buildApplyToken(planId, normalized)
  };
}

function isValidPatchId(value: string | undefined): boolean {
  if (!value) return false;
  return /^[a-zA-Z0-9_-]{8,80}$/.test(value);
}

function isRecentTimestamp(value: string | undefined): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const ageMs = Date.now() - date.getTime();
  return ageMs >= 0 && ageMs <= 1000 * 60 * 60 * 48;
}

function hashProposalContent(proposal: PlanAdjustmentProposal): string {
  return createHash('sha256')
    .update(JSON.stringify({
      mode: proposal.mode || 'balanced',
      requiresClarification: Boolean(proposal.requiresClarification),
      clarificationPrompt: proposal.clarificationPrompt || null,
      coachReply: proposal.coachReply,
      summary: proposal.summary,
      confidence: proposal.confidence,
      riskFlags: proposal.riskFlags || [],
      followUpQuestion: proposal.followUpQuestion || null,
      changes: proposal.changes
    }))
    .digest('hex');
}

function applyAdvisorySafetyPolicy(message: string, proposal: PlanAdjustmentProposal): PlanAdjustmentProposal {
  const next = { ...proposal };
  const riskFlags = [...(proposal.riskFlags || [])];
  const mentionsInjuryOrIllness = INJURY_OR_ILLNESS_PATTERN.test(message);
  const isLargePatch = proposal.changes.length >= 10;

  if (mentionsInjuryOrIllness) {
    if (next.confidence === 'high') next.confidence = 'medium';
    if (!next.followUpQuestion) {
      next.followUpQuestion = 'Any acute pain or medical guidance we should respect before applying bigger changes?';
    }
    riskFlags.unshift('Caution: injury/illness language detected. Keep changes conservative.');
  }

  if (isLargePatch && !next.followUpQuestion) {
    next.followUpQuestion = 'This is a larger change set. Confirm you want these broader adjustments applied together.';
  }

  next.riskFlags = riskFlags.slice(0, 6);
  return next;
}

function validatePatchGuardrails(message: string, proposal: PlanAdjustmentProposal): string | null {
  if (proposal.changes.length === 0) return null;
  if (proposal.changes.length > MAX_PATCH_CHANGES) {
    return `Proposal has ${proposal.changes.length} changes, exceeding max ${MAX_PATCH_CHANGES}.`;
  }

  let extendPlanCount = 0;
  const touchedActivityOps = new Map<string, Set<string>>();
  const duplicateMoveTargets = new Set<string>();

  for (const change of proposal.changes) {
    if (change.op === 'extend_plan') {
      extendPlanCount += 1;
      continue;
    }

    if (change.op === 'move_activity' || change.op === 'edit_activity' || change.op === 'delete_activity') {
      const opSet = touchedActivityOps.get(change.activityId) || new Set<string>();
      opSet.add(change.op);
      touchedActivityOps.set(change.activityId, opSet);
      if (change.op === 'move_activity') {
        const key = `${change.activityId}:${change.targetDayId}`;
        if (duplicateMoveTargets.has(key)) {
          return `Proposal has duplicate move for activity ${change.activityId}.`;
        }
        duplicateMoveTargets.add(key);
      }
    }
  }

  if (extendPlanCount > 1) {
    return 'Proposal can include at most one extend_plan operation.';
  }

  for (const [activityId, ops] of touchedActivityOps.entries()) {
    if (ops.has('delete_activity') && ops.size > 1) {
      return `Proposal conflicts on activity ${activityId}: delete cannot be combined with edit/move.`;
    }
  }

  if (INJURY_OR_ILLNESS_PATTERN.test(message) && proposal.changes.length > 14) {
    return 'Too many changes for an injury/illness scenario. Keep the adjustment set smaller and safer.';
  }

  return null;
}

function normalizeSubtypeToken(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function isLongRunLikeActivity(activity: {
  type: ActivityType;
  subtype: string | null;
  title: string;
}) {
  const subtype = normalizeSubtypeToken(activity.subtype || '');
  const title = String(activity.title || '').toLowerCase();
  return (
    activity.type === 'RUN'
    && (
      subtype === 'lrl'
      || /\blong run\b/.test(title)
      || /\blrl\b/.test(title)
    )
  );
}

function isHardRunLikeActivity(activity: {
  type: ActivityType;
  subtype: string | null;
  title: string;
  priority: ActivityPriority | null;
  mustDo: boolean;
}) {
  if (activity.type !== 'RUN') return false;
  const subtype = normalizeSubtypeToken(activity.subtype || '');
  const title = String(activity.title || '').toLowerCase();
  return (
    activity.mustDo
    || activity.priority === 'KEY'
    || QUALITY_RUN_SUBTYPES.has(subtype)
    || /\btempo\b/.test(title)
    || /\bhill\b/.test(title)
    || /\binterval\b/.test(title)
    || /\brace\b/.test(title)
  );
}



function isActivityType(value: unknown): value is ActivityType {
  return typeof value === 'string' && [
    'RUN', 'STRENGTH', 'CROSS_TRAIN', 'REST', 'MOBILITY', 'YOGA', 'HIKE', 'OTHER'
  ].includes(value);
}

function isUnits(value: unknown): value is Units {
  return value === 'KM' || value === 'MILES';
}

function isPriority(value: unknown): value is ActivityPriority {
  return value === 'KEY' || value === 'MEDIUM' || value === 'OPTIONAL';
}

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseIsoDate(input: unknown): string | null {
  const text = normalizeText(input);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseInteger(input: unknown): number | null {
  if (input === null || input === undefined || input === '') return null;
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (Math.abs(parsed - rounded) > 1e-9) return null;
  return rounded;
}

function parseDayOfWeek(input: unknown): number | null {
  const value = parseInteger(input);
  if (value === null) return null;
  if (value < 1 || value > 7) return null;
  return value;
}



function parseProposal(raw: unknown): PlanAdjustmentProposal | null {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as Record<string, unknown>;
  const schemaVersion = normalizeText(payload.schemaVersion) || undefined;
  const patchId = normalizeText(payload.patchId) || undefined;
  const createdAt = normalizeText(payload.createdAt) || undefined;
  const applyToken = normalizeText(payload.applyToken) || undefined;
  const modeRaw = normalizeText(payload.mode);
  const mode = modeRaw && VALID_MODES.has(modeRaw) ? (modeRaw as PlanAdjustmentProposal['mode']) : undefined;
  const requiresClarification = payload.requiresClarification === true;
  const clarificationPrompt = normalizeText(payload.clarificationPrompt) || undefined;
  const coachReply = normalizeText(payload.coachReply);
  const summary = normalizeText(payload.summary);
  const confidence = payload.confidence;
  const changesRaw = payload.changes;
  if (!coachReply || !summary || !Array.isArray(changesRaw)) return null;
  if (confidence !== 'low' && confidence !== 'medium' && confidence !== 'high') return null;

  const changes: PlanAdjustmentChange[] = [];
  for (const item of changesRaw) {
    if (!item || typeof item !== 'object') return null;
    const change = item as Record<string, unknown>;
    const op = change.op;
    const reason = normalizeText(change.reason);
    if (!reason) return null;

    if (op === 'move_activity') {
      const activityId = normalizeText(change.activityId);
      const targetDayId = normalizeText(change.targetDayId);
      if (!activityId || !targetDayId) return null;
      changes.push({ op, activityId, targetDayId, reason });
      continue;
    }

    if (op === 'delete_activity') {
      const activityId = normalizeText(change.activityId);
      if (!activityId) return null;
      changes.push({ op, activityId, reason });
      continue;
    }

    if (op === 'edit_activity') {
      const activityId = normalizeText(change.activityId);
      if (!activityId) return null;
      const parsed: EditActivityChange = { op, activityId, reason };
      if (change.type !== undefined) {
        if (!isActivityType(change.type)) return null;
        parsed.type = change.type;
      }
      if (change.title !== undefined) {
        const title = normalizeText(change.title);
        if (!title) return null;
        parsed.title = title.slice(0, 200);
      }
      if (change.duration !== undefined) {
        const duration = normalizeNumber(change.duration);
        if (duration !== null && (duration < 0 || duration > 600)) return null;
        parsed.duration = duration;
      }
      if (change.distance !== undefined) {
        const distance = normalizeNumber(change.distance);
        if (distance !== null && (distance < 0 || distance > 200)) return null;
        parsed.distance = distance;
      }
      if (change.distanceUnit !== undefined) {
        if (change.distanceUnit !== null && !isUnits(change.distanceUnit)) return null;
        parsed.distanceUnit = change.distanceUnit as Units | null;
      }
      if (change.paceTarget !== undefined) parsed.paceTarget = normalizeText(change.paceTarget);
      if (change.effortTarget !== undefined) parsed.effortTarget = normalizeText(change.effortTarget);
      if (change.notes !== undefined) parsed.notes = normalizeText(change.notes);
      if (change.mustDo !== undefined) {
        if (typeof change.mustDo !== 'boolean') return null;
        parsed.mustDo = change.mustDo;
      }
      if (change.bailAllowed !== undefined) {
        if (typeof change.bailAllowed !== 'boolean') return null;
        parsed.bailAllowed = change.bailAllowed;
      }
      if (change.priority !== undefined) {
        if (change.priority !== null && !isPriority(change.priority)) return null;
        parsed.priority = change.priority as ActivityPriority | null;
      }
      changes.push(parsed);
      continue;
    }

    if (op === 'add_activity') {
      const dayId = normalizeText(change.dayId);
      const type = change.type;
      const title = normalizeText(change.title);
      if (!dayId || !title || !isActivityType(type)) return null;
      const parsed: AddActivityChange = { op, dayId, type, title: title.slice(0, 200), reason };
      if (change.duration !== undefined) {
        const duration = normalizeNumber(change.duration);
        if (duration !== null && (duration < 0 || duration > 600)) return null;
        parsed.duration = duration;
      }
      if (change.distance !== undefined) {
        const distance = normalizeNumber(change.distance);
        if (distance !== null && (distance < 0 || distance > 200)) return null;
        parsed.distance = distance;
      }
      if (change.distanceUnit !== undefined) {
        if (change.distanceUnit !== null && !isUnits(change.distanceUnit)) return null;
        parsed.distanceUnit = change.distanceUnit as Units | null;
      }
      if (change.paceTarget !== undefined) parsed.paceTarget = normalizeText(change.paceTarget);
      if (change.effortTarget !== undefined) parsed.effortTarget = normalizeText(change.effortTarget);
      if (change.notes !== undefined) parsed.notes = normalizeText(change.notes);
      if (change.mustDo !== undefined) {
        if (typeof change.mustDo !== 'boolean') return null;
        parsed.mustDo = change.mustDo;
      }
      if (change.bailAllowed !== undefined) {
        if (typeof change.bailAllowed !== 'boolean') return null;
        parsed.bailAllowed = change.bailAllowed;
      }
      if (change.priority !== undefined) {
        if (change.priority !== null && !isPriority(change.priority)) return null;
        parsed.priority = change.priority as ActivityPriority | null;
      }
      changes.push(parsed);
      continue;
    }

    if (op === 'extend_plan') {
      const newStartDate = parseIsoDate(change.newStartDate);
      if (!newStartDate) return null;
      changes.push({ op, newStartDate, reason });
      continue;
    }

    if (op === 'reanchor_subtype_weekly') {
      const subtype = normalizeText(change.subtype);
      const targetDayOfWeek = parseDayOfWeek(change.targetDayOfWeek);
      const fromDayOfWeekRaw = change.fromDayOfWeek;
      const startWeekIndexRaw = change.startWeekIndex;
      if (!subtype || targetDayOfWeek === null) return null;

      let fromDayOfWeek: number | null | undefined = undefined;
      if (fromDayOfWeekRaw !== undefined) {
        if (fromDayOfWeekRaw === null || fromDayOfWeekRaw === '') {
          fromDayOfWeek = null;
        } else {
          const parsedFromDay = parseDayOfWeek(fromDayOfWeekRaw);
          if (parsedFromDay === null) return null;
          fromDayOfWeek = parsedFromDay;
        }
      }

      let startWeekIndex: number | null | undefined = undefined;
      if (startWeekIndexRaw !== undefined) {
        if (startWeekIndexRaw === null || startWeekIndexRaw === '') {
          startWeekIndex = null;
        } else {
          const parsedStartWeek = parseInteger(startWeekIndexRaw);
          if (parsedStartWeek === null || parsedStartWeek < 1) return null;
          startWeekIndex = parsedStartWeek;
        }
      }

      changes.push({
        op,
        subtype: subtype.slice(0, 60),
        targetDayOfWeek,
        ...(fromDayOfWeek !== undefined ? { fromDayOfWeek } : {}),
        ...(startWeekIndex !== undefined ? { startWeekIndex } : {}),
        reason
      });
      continue;
    }

    return null;
  }

  const riskFlags = Array.isArray(payload.riskFlags)
    ? payload.riskFlags.filter((item): item is string => typeof item === 'string').map((text) => text.slice(0, 180))
    : [];
  const followUpQuestion = normalizeText(payload.followUpQuestion) || undefined;

  return {
    schemaVersion,
    patchId,
    createdAt,
    applyToken,
    mode,
    requiresClarification,
    clarificationPrompt,
    coachReply: coachReply.slice(0, 1200),
    summary: summary.slice(0, 260),
    confidence,
    riskFlags,
    followUpQuestion,
    changes
  };
}

async function appendSourcePlanName<T extends { sourceId?: string | null }>(plan: T) {
  if (!plan.sourceId) {
    return { ...plan, sourcePlanName: null };
  }
  const sourcePlan = await prisma.trainingPlan.findUnique({
    where: { id: plan.sourceId },
    select: { name: true }
  });
  return { ...plan, sourcePlanName: sourcePlan?.name || null };
}

type PlanForContext = Awaited<ReturnType<typeof loadPlanForUser>>;

async function loadPlanForUser(planId: string, userId: string) {
  const plan = await prisma.trainingPlan.findUnique({
    where: { id: planId },
    include: {
      weeks: { include: { days: { include: { activities: true } } } },
      days: { include: { activities: true } },
      activities: true
    }
  });
  if (!plan) return null;
  if (plan.ownerId !== userId && plan.athleteId !== userId) return null;
  return plan;
}

function buildPlanContext(plan: NonNullable<PlanForContext>) {
  const weeks = [...(plan.weeks || [])].sort((a, b) => a.weekIndex - b.weekIndex);
  const allWeekIndexes = weeks.map((week) => week.weekIndex);
  const rows: Array<{
    dayId: string;
    weekIndex: number;
    dayOfWeek: number;
    dateISO: string | null;
    isLocked: boolean;
    activities: Array<{
      activityId: string;
      title: string;
      type: ActivityType;
      subtype: string | null;
      completed: boolean;
      duration: number | null;
      distance: number | null;
      distanceUnit: Units | null;
      priority: ActivityPriority | null;
      mustDo: boolean;
    }>;
  }> = [];
  const weekSummaries: Array<{
    weekIndex: number;
    startDateISO: string | null;
    endDateISO: string | null;
    restDays: number[];
    longRunDayOfWeek: number | null;
    hardRunDays: number[];
    keySessionDays: number[];
    consecutiveHardPairs: Array<[number, number]>;
    hasRestAfterLongRun: boolean | null;
    plannedDurationMin: number | null;
  }> = [];

  for (const week of weeks) {
    const bounds = resolveWeekBounds({
      weekIndex: week.weekIndex,
      weekStartDate: week.startDate,
      weekEndDate: week.endDate,
      raceDate: plan.raceDate,
      weekCount: plan.weekCount,
      allWeekIndexes
    });
    const days = [...(week.days || [])].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    const restDays: number[] = [];
    const hardRunDays = new Set<number>();
    const keySessionDays = new Set<number>();
    let longRunDayOfWeek: number | null = null;
    let plannedDurationMin = 0;
    let hasDuration = false;

    for (const day of days) {
      const date = getDayDateFromWeekStart(bounds.startDate, day.dayOfWeek);
      const dayActivities = day.activities || [];
      const hasRestDay = dayActivities.some((activity) => activity.type === 'REST');
      if (hasRestDay) restDays.push(day.dayOfWeek);

      for (const activity of dayActivities) {
        const duration = activity.duration ?? null;
        if (duration !== null && Number.isFinite(duration) && duration >= 0) {
          plannedDurationMin += duration;
          hasDuration = true;
        }
        if (activity.priority === 'KEY' || activity.mustDo) {
          keySessionDays.add(day.dayOfWeek);
        }
        if (isLongRunLikeActivity(activity)) {
          longRunDayOfWeek = day.dayOfWeek;
          keySessionDays.add(day.dayOfWeek);
        }
        if (isHardRunLikeActivity(activity)) {
          hardRunDays.add(day.dayOfWeek);
        }
      }

      rows.push({
        dayId: day.id,
        weekIndex: week.weekIndex,
        dayOfWeek: day.dayOfWeek,
        dateISO: date ? new Date(date).toISOString().slice(0, 10) : null,
        isLocked: isDayClosed(day.notes) || (dayActivities.length > 0 && dayActivities.every((activity) => activity.completed)),
        activities: dayActivities.map((activity) => ({
          activityId: activity.id,
          title: activity.title,
          type: activity.type,
          subtype: activity.subtype ?? null,
          completed: activity.completed,
          duration: activity.duration ?? null,
          distance: activity.distance ?? null,
          distanceUnit: activity.distanceUnit ?? null,
          priority: activity.priority ?? null,
          mustDo: activity.mustDo
        }))
      });
    }

    const hardRunDayList = [...hardRunDays].sort((a, b) => a - b);
    const consecutiveHardPairs: Array<[number, number]> = [];
    for (let i = 1; i < hardRunDayList.length; i += 1) {
      if (hardRunDayList[i] === hardRunDayList[i - 1] + 1) {
        consecutiveHardPairs.push([hardRunDayList[i - 1], hardRunDayList[i]]);
      }
    }
    const hasRestAfterLongRun = longRunDayOfWeek
      ? restDays.includes(Math.min(7, longRunDayOfWeek + 1))
      : null;

    weekSummaries.push({
      weekIndex: week.weekIndex,
      startDateISO: bounds.startDate ? bounds.startDate.toISOString().slice(0, 10) : null,
      endDateISO: bounds.endDate ? bounds.endDate.toISOString().slice(0, 10) : null,
      restDays: [...restDays].sort((a, b) => a - b),
      longRunDayOfWeek,
      hardRunDays: hardRunDayList,
      keySessionDays: [...keySessionDays].sort((a, b) => a - b),
      consecutiveHardPairs,
      hasRestAfterLongRun,
      plannedDurationMin: hasDuration ? plannedDurationMin : null
    });
  }

  const dayDates = rows
    .map((row) => row.dateISO)
    .filter((value): value is string => Boolean(value))
    .sort();
  const planStartDateISO = dayDates.length > 0 ? dayDates[0] : null;

  return {
    plan: {
      id: plan.id,
      name: plan.name,
      status: plan.status,
      weekCount: plan.weekCount,
      raceName: plan.raceName,
      raceDate: plan.raceDate ? new Date(plan.raceDate).toISOString().slice(0, 10) : null,
      startDate: planStartDateISO
    },
    todayISO: new Date().toISOString().slice(0, 10),
    lockedDayIds: rows.filter((row) => row.isLocked).map((row) => row.dayId),
    days: rows,
    weekSummaries
  };
}

type PlanContext = ReturnType<typeof buildPlanContext>;
type ContextDay = PlanContext['days'][number];
type ContextActivity = ContextDay['activities'][number];

type WeekMetrics = {
  weekIndex: number;
  restDays: number;
  hardDays: number[];
  longRunDayOfWeek: number | null;
  plannedDurationMin: number;
};

type InvariantWeekDelta = {
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
};

type InvariantReport = {
  selectedMode: NonNullable<PlanAdjustmentProposal['mode']>;
  candidateScore: number;
  summaryFlags: string[];
  weeks: InvariantWeekDelta[];
};

function isLikelyHardRunText(text: string | null | undefined) {
  const normalized = String(text || '').toLowerCase();
  return /\b(tempo|threshold|interval|hills?|race pace|vo2|max effort|speed)\b/.test(normalized);
}

function cloneContextDays(days: PlanContext['days']): ContextDay[] {
  return days.map((day) => ({
    ...day,
    activities: day.activities.map((activity) => ({ ...activity }))
  }));
}

function buildWeekMaps(context: PlanContext) {
  const dayWeekMap = new Map<string, number>();
  const activityWeekMap = new Map<string, number>();
  for (const day of context.days) {
    dayWeekMap.set(day.dayId, day.weekIndex);
    for (const activity of day.activities) {
      activityWeekMap.set(activity.activityId, day.weekIndex);
    }
  }
  return { dayWeekMap, activityWeekMap };
}

function findActivityLocation(days: ContextDay[], activityId: string) {
  for (let dayIdx = 0; dayIdx < days.length; dayIdx += 1) {
    const activityIdx = days[dayIdx].activities.findIndex((activity) => activity.activityId === activityId);
    if (activityIdx >= 0) return { dayIdx, activityIdx };
  }
  return null;
}

function activityMatchesReanchorSubtype(activity: ContextActivity, subtype: string) {
  const token = normalizeSubtypeToken(subtype);
  if (!token) return false;
  const activitySubtype = normalizeSubtypeToken(activity.subtype || '');
  const title = String(activity.title || '').toLowerCase();

  if (token === 'lrl') {
    return activity.type === 'RUN' && (activitySubtype === 'lrl' || /\blong run\b|\blrl\b/.test(title));
  }
  if (token === 'rest') {
    return activity.type === 'REST' || activitySubtype === 'rest' || /\brest\b/.test(title);
  }
  if (token === 'cross-training') {
    return activity.type === 'CROSS_TRAIN' || /\bcross[\s-]?training\b|\bxt\b/.test(title);
  }
  if (token === 'strength') {
    return activity.type === 'STRENGTH' || /\bstrength\b/.test(title);
  }
  if (token === 'tempo') {
    return activity.type === 'RUN' && /\btempo\b/.test(title);
  }
  return activitySubtype === token || title.includes(token.replace(/-/g, ' '));
}

function simulateProposalDays(context: PlanContext, proposal: PlanAdjustmentProposal) {
  const days = cloneContextDays(context.days);
  let virtualActivityCounter = 0;

  for (const change of proposal.changes) {
    if (change.op === 'extend_plan') {
      continue;
    }
    if (change.op === 'move_activity') {
      const source = findActivityLocation(days, change.activityId);
      const targetDayIdx = days.findIndex((day) => day.dayId === change.targetDayId);
      if (!source || targetDayIdx < 0) continue;
      const [activity] = days[source.dayIdx].activities.splice(source.activityIdx, 1);
      days[targetDayIdx].activities.push(activity);
      continue;
    }
    if (change.op === 'delete_activity') {
      const source = findActivityLocation(days, change.activityId);
      if (!source) continue;
      days[source.dayIdx].activities.splice(source.activityIdx, 1);
      continue;
    }
    if (change.op === 'edit_activity') {
      const source = findActivityLocation(days, change.activityId);
      if (!source) continue;
      const activity = days[source.dayIdx].activities[source.activityIdx];
      if (change.type !== undefined) activity.type = change.type;
      if (change.title !== undefined) activity.title = change.title;
      if (change.duration !== undefined) activity.duration = change.duration;
      if (change.distance !== undefined) activity.distance = change.distance;
      if (change.distanceUnit !== undefined) activity.distanceUnit = change.distanceUnit;
      if (change.priority !== undefined) activity.priority = change.priority;
      if (change.mustDo !== undefined) activity.mustDo = change.mustDo;
      continue;
    }
    if (change.op === 'add_activity') {
      const targetDayIdx = days.findIndex((day) => day.dayId === change.dayId);
      if (targetDayIdx < 0) continue;
      days[targetDayIdx].activities.push({
        activityId: `virtual-${virtualActivityCounter += 1}`,
        title: change.title,
        type: change.type,
        subtype: null,
        completed: false,
        duration: change.duration ?? null,
        distance: change.distance ?? null,
        distanceUnit: change.distanceUnit ?? null,
        priority: change.priority ?? null,
        mustDo: change.mustDo ?? false
      });
      continue;
    }
    if (change.op === 'reanchor_subtype_weekly') {
      const weekIndexes = [...new Set(days.map((day) => day.weekIndex))].sort((a, b) => a - b);
      const startWeek = change.startWeekIndex ?? 1;
      for (const weekIndex of weekIndexes) {
        if (weekIndex < startWeek) continue;
        const weekDays = days
          .filter((day) => day.weekIndex === weekIndex)
          .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
        const targetDay = weekDays.find((day) => day.dayOfWeek === change.targetDayOfWeek);
        if (!targetDay) continue;
        const sourceDays = change.fromDayOfWeek
          ? weekDays.filter((day) => day.dayOfWeek === change.fromDayOfWeek)
          : weekDays;
        let moved = false;
        for (const sourceDay of sourceDays) {
          const idx = sourceDay.activities.findIndex((activity) =>
            !activity.completed && activityMatchesReanchorSubtype(activity, change.subtype)
          );
          if (idx < 0) continue;
          const [activity] = sourceDay.activities.splice(idx, 1);
          targetDay.activities.push(activity);
          moved = true;
          break;
        }
        if (!moved) continue;
      }
      continue;
    }
  }
  return days;
}

function computeWeekMetricsFromDays(days: ContextDay[]): WeekMetrics[] {
  const weekMap = new Map<number, ContextDay[]>();
  for (const day of days) {
    const existing = weekMap.get(day.weekIndex) || [];
    existing.push(day);
    weekMap.set(day.weekIndex, existing);
  }
  const weekIndexes = [...weekMap.keys()].sort((a, b) => a - b);
  return weekIndexes.map((weekIndex) => {
    const weekDays = (weekMap.get(weekIndex) || []).sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    const hardDays = new Set<number>();
    let restDays = 0;
    let longRunDayOfWeek: number | null = null;
    let plannedDurationMin = 0;
    for (const day of weekDays) {
      let hasRest = false;
      let hasHard = false;
      for (const activity of day.activities) {
        if (activity.type === 'REST') hasRest = true;
        if (isLongRunLikeActivity(activity)) longRunDayOfWeek = day.dayOfWeek;
        if (isHardRunLikeActivity(activity)) hasHard = true;
        if (activity.duration !== null && Number.isFinite(activity.duration) && activity.duration >= 0) {
          plannedDurationMin += activity.duration;
        }
      }
      if (hasRest) restDays += 1;
      if (hasHard) hardDays.add(day.dayOfWeek);
    }
    return {
      weekIndex,
      restDays,
      hardDays: [...hardDays].sort((a, b) => a - b),
      longRunDayOfWeek,
      plannedDurationMin
    };
  });
}

function getTouchedWeekIndexes(context: PlanContext, proposal: PlanAdjustmentProposal) {
  const { dayWeekMap, activityWeekMap } = buildWeekMaps(context);
  const touchedWeeks = new Set<number>();

  for (const change of proposal.changes) {
    if (change.op === 'extend_plan' || change.op === 'reanchor_subtype_weekly') {
      for (const week of context.weekSummaries) touchedWeeks.add(week.weekIndex);
      continue;
    }
    if (change.op === 'add_activity') {
      const week = dayWeekMap.get(change.dayId);
      if (week) touchedWeeks.add(week);
      continue;
    }
    if (change.op === 'move_activity') {
      const fromWeek = activityWeekMap.get(change.activityId);
      const toWeek = dayWeekMap.get(change.targetDayId);
      if (fromWeek) touchedWeeks.add(fromWeek);
      if (toWeek) touchedWeeks.add(toWeek);
      continue;
    }
    if (change.op === 'edit_activity' || change.op === 'delete_activity') {
      const week = activityWeekMap.get(change.activityId);
      if (week) touchedWeeks.add(week);
    }
  }

  return [...touchedWeeks].sort((a, b) => a - b);
}

function formatDelta(before: number, after: number) {
  const delta = after - before;
  if (delta === 0) return '0';
  return delta > 0 ? `+${delta}` : String(delta);
}

function buildInvariantReport(
  context: PlanContext,
  proposal: PlanAdjustmentProposal,
  candidateScore: number,
  scoreDiagnostics: string[]
): InvariantReport {
  const beforeWeeks = computeWeekMetricsFromDays(context.days);
  const afterWeeks = computeWeekMetricsFromDays(simulateProposalDays(context, proposal));
  const beforeByWeek = new Map(beforeWeeks.map((week) => [week.weekIndex, week]));
  const afterByWeek = new Map(afterWeeks.map((week) => [week.weekIndex, week]));
  const touchedWeekIndexes = getTouchedWeekIndexes(context, proposal);

  const weekRows: InvariantWeekDelta[] = touchedWeekIndexes.map((weekIndex) => {
    const before = beforeByWeek.get(weekIndex) || {
      weekIndex,
      restDays: 0,
      hardDays: [],
      longRunDayOfWeek: null,
      plannedDurationMin: 0
    };
    const after = afterByWeek.get(weekIndex) || before;
    const flags: string[] = [];

    if (after.restDays === 0) flags.push('No rest day.');
    if (after.hardDays.length > 2) flags.push(`Hard days ${after.hardDays.length} (>2).`);
    for (let i = 1; i < after.hardDays.length; i += 1) {
      if (after.hardDays[i] === after.hardDays[i - 1] + 1) {
        flags.push('Back-to-back hard days.');
        break;
      }
    }

    return {
      weekIndex,
      before: {
        restDays: before.restDays,
        hardDays: before.hardDays.length,
        longRunDayOfWeek: before.longRunDayOfWeek,
        plannedDurationMin: before.plannedDurationMin
      },
      after: {
        restDays: after.restDays,
        hardDays: after.hardDays.length,
        longRunDayOfWeek: after.longRunDayOfWeek,
        plannedDurationMin: after.plannedDurationMin
      },
      flags
    };
  });

  const summaryFlags = [
    ...scoreDiagnostics,
    ...weekRows.flatMap((row) => row.flags.map((flag) => `W${row.weekIndex}: ${flag}`)),
    ...weekRows
      .map((row) => {
        const durationDelta = row.after.plannedDurationMin - row.before.plannedDurationMin;
        if (durationDelta === 0) return null;
        return `W${row.weekIndex}: duration ${formatDelta(row.before.plannedDurationMin, row.after.plannedDurationMin)} min`;
      })
      .filter((flag): flag is string => Boolean(flag))
  ].slice(0, 8);

  return {
    selectedMode: (proposal.mode || 'balanced') as NonNullable<PlanAdjustmentProposal['mode']>,
    candidateScore: Number(candidateScore.toFixed(1)),
    summaryFlags,
    weeks: weekRows
  };
}

function scoreProposalCandidate(message: string, context: PlanContext, proposal: PlanAdjustmentProposal) {
  const simulatedDays = simulateProposalDays(context, proposal);
  const baseWeeks = computeWeekMetricsFromDays(context.days);
  const weeks = computeWeekMetricsFromDays(simulatedDays);
  const baseHardByWeek = new Map(baseWeeks.map((week) => [week.weekIndex, week.hardDays.length]));
  let score = proposal.changes.length * 0.6;
  const diagnostics: string[] = [];

  for (const week of weeks) {
    if (week.restDays === 0) {
      score += 25;
      diagnostics.push(`Week ${week.weekIndex} has no rest day.`);
    }
    if (week.hardDays.length > 2) {
      const extraHard = week.hardDays.length - 2;
      score += extraHard * 15;
      diagnostics.push(`Week ${week.weekIndex} has ${week.hardDays.length} hard days.`);
    }
    for (let i = 1; i < week.hardDays.length; i += 1) {
      if (week.hardDays[i] === week.hardDays[i - 1] + 1) {
        score += 10;
        diagnostics.push(`Week ${week.weekIndex} has back-to-back hard days.`);
      }
    }
    if (week.longRunDayOfWeek && week.hardDays.includes(Math.max(1, week.longRunDayOfWeek - 1))) {
      score += 8;
      diagnostics.push(`Week ${week.weekIndex} has a hard day before long run.`);
    }
    if (week.longRunDayOfWeek && week.hardDays.includes(Math.min(7, week.longRunDayOfWeek + 1))) {
      score += 8;
      diagnostics.push(`Week ${week.weekIndex} has a hard day after long run.`);
    }
    if (INJURY_OR_ILLNESS_PATTERN.test(message)) {
      const baselineHard = baseHardByWeek.get(week.weekIndex) || 0;
      if (week.hardDays.length > baselineHard) {
        score += 18;
        diagnostics.push(`Week ${week.weekIndex} increases hard-load during illness/injury context.`);
      }
    }
  }

  for (let i = 1; i < weeks.length; i += 1) {
    const prev = weeks[i - 1].plannedDurationMin;
    const curr = weeks[i].plannedDurationMin;
    if (prev <= 0 || curr <= 0) continue;
    const deltaRatio = (curr - prev) / prev;
    if (deltaRatio > 0.2) {
      const penalty = Math.min(40, (deltaRatio - 0.2) * 100);
      score += penalty;
      diagnostics.push(`Week ${weeks[i].weekIndex} duration jump exceeds 20%.`);
    }
  }

  return { score, diagnostics };
}

function normalizeProposalForMode(
  proposal: PlanAdjustmentProposal,
  mode: NonNullable<PlanAdjustmentProposal['mode']>
): PlanAdjustmentProposal {
  return { ...proposal, mode };
}

function buildMinimalVariant(proposal: PlanAdjustmentProposal): PlanAdjustmentProposal {
  const prioritized = proposal.changes.filter((change) =>
    change.op === 'move_activity' || change.op === 'edit_activity' || change.op === 'reanchor_subtype_weekly'
  );
  const fallback = prioritized.length > 0 ? prioritized : proposal.changes;
  const reducedChanges = fallback.slice(0, Math.min(8, fallback.length));
  return normalizeProposalForMode({
    ...proposal,
    summary: proposal.summary,
    changes: reducedChanges
  }, 'minimal_changes');
}

function buildInjuryCautiousVariant(proposal: PlanAdjustmentProposal): PlanAdjustmentProposal {
  const conservativeChanges = proposal.changes.filter((change) => {
    if (change.op === 'add_activity') {
      if (change.type !== 'RUN') return true;
      return !isLikelyHardRunText(change.title) && !isLikelyHardRunText(change.reason);
    }
    if (change.op === 'edit_activity') {
      if (change.type && change.type !== 'RUN') return true;
      return !isLikelyHardRunText(change.title) && !isLikelyHardRunText(change.reason);
    }
    return true;
  }).slice(0, 10);

  return normalizeProposalForMode({
    ...proposal,
    confidence: proposal.confidence === 'high' ? 'medium' : proposal.confidence,
    changes: conservativeChanges
  }, 'injury_cautious');
}

function selectBestProposalCandidate(message: string, context: PlanContext, proposal: PlanAdjustmentProposal) {
  const candidates: PlanAdjustmentProposal[] = [normalizeProposalForMode(proposal, proposal.mode || 'balanced')];
  if (proposal.changes.length > 6) {
    candidates.push(buildMinimalVariant(proposal));
  }
  if (INJURY_OR_ILLNESS_PATTERN.test(message)) {
    candidates.push(buildInjuryCautiousVariant(proposal));
  }

  let best = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;
  let bestDiagnostics: string[] = [];

  for (const candidate of candidates) {
    const { score, diagnostics } = scoreProposalCandidate(message, context, candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
      bestDiagnostics = diagnostics;
    }
  }

  const riskFlags = [...(best.riskFlags || [])];
  for (const diagnostic of bestDiagnostics.slice(0, 2)) {
    if (!riskFlags.includes(diagnostic)) riskFlags.push(diagnostic);
  }

  const selectedProposal = {
    ...best,
    riskFlags: riskFlags.slice(0, 6)
  };

  return {
    proposal: selectedProposal,
    score: bestScore,
    diagnostics: bestDiagnostics
  };
}

function applyMajorClarificationPolicy(context: PlanContext, proposal: PlanAdjustmentProposal) {
  const { dayWeekMap, activityWeekMap } = buildWeekMaps(context);
  const touchedWeeks = new Set<number>();
  let hasStructuralChange = false;

  for (const change of proposal.changes) {
    if (change.op === 'extend_plan' || change.op === 'reanchor_subtype_weekly') {
      hasStructuralChange = true;
    }
    if (change.op === 'add_activity') {
      const week = dayWeekMap.get(change.dayId);
      if (week) touchedWeeks.add(week);
    }
    if (change.op === 'move_activity') {
      const fromWeek = activityWeekMap.get(change.activityId);
      const toWeek = dayWeekMap.get(change.targetDayId);
      if (fromWeek) touchedWeeks.add(fromWeek);
      if (toWeek) touchedWeeks.add(toWeek);
    }
    if (change.op === 'edit_activity' || change.op === 'delete_activity') {
      const week = activityWeekMap.get(change.activityId);
      if (week) touchedWeeks.add(week);
    }
  }

  const isMajor = hasStructuralChange || proposal.changes.length >= 10 || (proposal.changes.length >= 6 && touchedWeeks.size >= 3);
  if (!isMajor) {
    return {
      ...proposal,
      requiresClarification: false,
      clarificationPrompt: undefined
    };
  }

  return {
    ...proposal,
    requiresClarification: true,
    clarificationPrompt:
      proposal.clarificationPrompt
      || proposal.followUpQuestion
      || 'This is a major plan reshuffle. Confirm constraints (available days, non-negotiable sessions, and acceptable load changes) before applying.'
  };
}





async function generateAdjustmentProposal(message: string, plan: NonNullable<PlanForContext>) {
  const context = buildPlanContext(plan);
  const model = getDefaultAiModel();
  return openaiJsonSchema<PlanAdjustmentProposal>({
    model,
    input: [
      'You are an experienced endurance running coach.',
      'Given athlete feedback and current training plan context, propose safe, practical plan adjustments.',
      'Act like an expert training advisor, not a simple editor: preserve weekly intent, recovery rhythm, and athlete adherence.',
      'Primary objective: preserve the original plan goal (race target, timeline, and performance intent) while adapting execution details.',
      'Rules:',
      '- Be conservative when illness/fatigue is mentioned.',
      '- Preserve key sessions when possible, but reduce load if needed.',
      '- Do not increase weekly load aggressively.',
      '- Prioritize consistency over perfection.',
      '- Do not rewrite the entire plan unless absolutely necessary.',
      '- Make minimal, intelligent adjustments that keep the athlete on track.',
      '- Adapt to practical constraints from athlete feedback (time limits, travel, fatigue, illness, missed sessions, work schedule).',
      '- Keep weekly balance: avoid stacking hard/key run days back-to-back unless the athlete explicitly requests it.',
      '- When moving long run day, rebalance neighboring days to protect recovery (typically easier/rest before, easier/recovery after).',
      '- When adapting rest day to work schedule constraints, rebalance surrounding intensity so quality sessions are still recoverable.',
      '- Use weekSummaries to reason about long-run placement, hard-day clustering, and recovery spacing before proposing changes.',
      '- Use only IDs present in context for day/activity references.',
      '- Days listed in lockedDayIds are completed and must not be modified.',
      '- Do not add activities to completed days.',
      '- Do not move/edit/delete activities that are completed or already in completed days.',
      '- You may use extend_plan ONLY when athlete asks to start earlier or add weeks while keeping race date unchanged.',
      '- For extend_plan, provide newStartDate as ISO date (YYYY-MM-DD).',
      '- Do not use extend_plan for race-date changes or other structure changes.',
      '- For repeated weekly structure changes (example: move long run day across remaining weeks), prefer reanchor_subtype_weekly.',
      '- For reanchor_subtype_weekly use dayOfWeek numbers where 1=Mon ... 7=Sun.',
      '- For reanchor_subtype_weekly subtype should be a plain token like lrl, tempo, strength, cross-training, rest, recovery.',
      '- Use minimal but sufficient changes: include companion edits when a single move would create poor weekly balance.',
      '- If critical details are missing for major changes, ask one concise follow-up question and reduce confidence.',
      '- Explain reasoning in coaching terms for each change reason.',
      'Coach reply format (single concise response):',
      '1) Quick assessment',
      '2) Risks if unchanged',
      '3) Proposed adjustments',
      '4) Why these changes work',
      'Keep coachReply concise, practical, and athlete-friendly.',
      `Athlete feedback: ${message}`,
      `Plan context JSON: ${JSON.stringify(context)}`
    ].join('\n'),
    schema: {
      name: 'plan_adjustment_proposal',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['coachReply', 'summary', 'confidence', 'changes'],
        properties: {
          mode: { type: 'string', enum: ['minimal_changes', 'balanced', 'aggressive', 'injury_cautious'] },
          coachReply: { type: 'string', minLength: 12, maxLength: 1200 },
          summary: { type: 'string', minLength: 6, maxLength: 260 },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          riskFlags: {
            type: 'array',
            items: { type: 'string', maxLength: 180 },
            maxItems: 6
          },
          followUpQuestion: { type: 'string', maxLength: 240 },
          changes: {
            type: 'array',
            minItems: 0,
            maxItems: 20,
            items: {
              oneOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['op', 'activityId', 'targetDayId', 'reason'],
                  properties: {
                    op: { type: 'string', const: 'move_activity' },
                    activityId: { type: 'string', minLength: 3, maxLength: 64 },
                    targetDayId: { type: 'string', minLength: 3, maxLength: 64 },
                    reason: { type: 'string', minLength: 4, maxLength: 220 }
                  }
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['op', 'activityId', 'reason'],
                  properties: {
                    op: { type: 'string', const: 'edit_activity' },
                    activityId: { type: 'string', minLength: 3, maxLength: 64 },
                    reason: { type: 'string', minLength: 4, maxLength: 220 },
                    type: {
                      type: 'string',
                      enum: ['RUN', 'STRENGTH', 'CROSS_TRAIN', 'REST', 'MOBILITY', 'YOGA', 'HIKE', 'OTHER']
                    },
                    title: { type: 'string', minLength: 2, maxLength: 200 },
                    duration: { type: ['number', 'null'], minimum: 0, maximum: 600 },
                    distance: { type: ['number', 'null'], minimum: 0, maximum: 200 },
                    distanceUnit: { type: ['string', 'null'], enum: ['MILES', 'KM', null] },
                    paceTarget: { type: ['string', 'null'], maxLength: 80 },
                    effortTarget: { type: ['string', 'null'], maxLength: 80 },
                    notes: { type: ['string', 'null'], maxLength: 400 },
                    mustDo: { type: 'boolean' },
                    bailAllowed: { type: 'boolean' },
                    priority: { type: ['string', 'null'], enum: ['KEY', 'MEDIUM', 'OPTIONAL', null] }
                  }
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['op', 'dayId', 'type', 'title', 'reason'],
                  properties: {
                    op: { type: 'string', const: 'add_activity' },
                    dayId: { type: 'string', minLength: 3, maxLength: 64 },
                    type: {
                      type: 'string',
                      enum: ['RUN', 'STRENGTH', 'CROSS_TRAIN', 'REST', 'MOBILITY', 'YOGA', 'HIKE', 'OTHER']
                    },
                    title: { type: 'string', minLength: 2, maxLength: 200 },
                    reason: { type: 'string', minLength: 4, maxLength: 220 },
                    duration: { type: ['number', 'null'], minimum: 0, maximum: 600 },
                    distance: { type: ['number', 'null'], minimum: 0, maximum: 200 },
                    distanceUnit: { type: ['string', 'null'], enum: ['MILES', 'KM', null] },
                    paceTarget: { type: ['string', 'null'], maxLength: 80 },
                    effortTarget: { type: ['string', 'null'], maxLength: 80 },
                    notes: { type: ['string', 'null'], maxLength: 400 },
                    mustDo: { type: 'boolean' },
                    bailAllowed: { type: 'boolean' },
                    priority: { type: ['string', 'null'], enum: ['KEY', 'MEDIUM', 'OPTIONAL', null] }
                  }
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['op', 'activityId', 'reason'],
                  properties: {
                    op: { type: 'string', const: 'delete_activity' },
                    activityId: { type: 'string', minLength: 3, maxLength: 64 },
                    reason: { type: 'string', minLength: 4, maxLength: 220 }
                  }
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['op', 'newStartDate', 'reason'],
                  properties: {
                    op: { type: 'string', const: 'extend_plan' },
                    newStartDate: { type: 'string', minLength: 10, maxLength: 32 },
                    reason: { type: 'string', minLength: 4, maxLength: 220 }
                  }
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['op', 'subtype', 'targetDayOfWeek', 'reason'],
                  properties: {
                    op: { type: 'string', const: 'reanchor_subtype_weekly' },
                    subtype: { type: 'string', minLength: 2, maxLength: 60 },
                    targetDayOfWeek: { type: 'integer', minimum: 1, maximum: 7 },
                    fromDayOfWeek: { type: ['integer', 'null'], minimum: 1, maximum: 7 },
                    startWeekIndex: { type: ['integer', 'null'], minimum: 1, maximum: 104 },
                    reason: { type: 'string', minLength: 4, maxLength: 220 }
                  }
                }
              ]
            }
          }
        }
      }
    }
  });
}




export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authUser = await currentUser();
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await ensureUserFromAuth(authUser, {
    defaultRole: 'ATHLETE',
    defaultCurrentRole: 'ATHLETE'
  });
  const body = (await req.json().catch(() => null)) as PlanAdjustRequestBody | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const message = normalizeText(body.message);
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  const { id: planId } = await params;
  const plan = await loadPlanForUser(planId, user.id);
  if (!plan) {
    return NextResponse.json({ error: 'Plan not found or forbidden' }, { status: 404 });
  }
  if (plan.status === 'ARCHIVED') {
    return NextResponse.json({ error: 'Archived plans cannot be adjusted' }, { status: 400 });
  }

  const apply = Boolean(body.apply);
  if (!apply) {
    try {
      const proposal = await generateAdjustmentProposal(message, plan);
      const parsed = parseProposal(proposal);
      if (!parsed) {
        return NextResponse.json({ error: 'AI proposal format was invalid. Please try again.' }, { status: 502 });
      }
      const lockState = buildLockStateFromPlan(plan);
      const sanitized = sanitizeProposalAgainstLockedDays(parsed, lockState);
      const safetyAdjusted = applyAdvisorySafetyPolicy(message, sanitized);
      const context = buildPlanContext(plan);
      const candidateSelected = selectBestProposalCandidate(message, context, safetyAdjusted);
      const withInvariantReport: PlanAdjustmentProposal = {
        ...candidateSelected.proposal,
        invariantReport: buildInvariantReport(
          context,
          candidateSelected.proposal,
          candidateSelected.score,
          candidateSelected.diagnostics
        )
      };
      const clarified = applyMajorClarificationPolicy(context, withInvariantReport);
      const guardrailError = validatePatchGuardrails(message, clarified);
      if (guardrailError) {
        return NextResponse.json({ error: guardrailError }, { status: 422 });
      }
      const enveloped = withPatchEnvelope(plan.id, clarified);
      return NextResponse.json({
        proposal: enveloped,
        plan: {
          id: plan.id,
          name: plan.name,
          status: plan.status
        }
      });
    } catch (error: unknown) {
      const messageText = error instanceof Error ? error.message : 'Failed to generate adjustment proposal';
      return NextResponse.json({ error: messageText }, { status: 500 });
    }
  }

  const parsedProposal = parseProposal(body.proposal);
  if (!parsedProposal) {
    return NextResponse.json({ error: 'proposal is required when apply=true' }, { status: 400 });
  }
  if (parsedProposal.schemaVersion !== PLAN_PATCH_SCHEMA_VERSION) {
    return NextResponse.json({ error: 'Unsupported proposal schema version.' }, { status: 400 });
  }
  if (!isValidPatchId(parsedProposal.patchId)) {
    return NextResponse.json({ error: 'Proposal patchId is missing or invalid.' }, { status: 400 });
  }
  if (!isRecentTimestamp(parsedProposal.createdAt)) {
    return NextResponse.json({ error: 'Proposal is stale. Generate a fresh adjustment first.' }, { status: 400 });
  }
  if (!parsedProposal.applyToken) {
    return NextResponse.json({ error: 'Proposal apply token is missing.' }, { status: 400 });
  }
  const expectedToken = buildApplyToken(plan.id, parsedProposal);
  if (parsedProposal.applyToken !== expectedToken) {
    return NextResponse.json({ error: 'Proposal content changed. Regenerate and review before applying.' }, { status: 400 });
  }

  let selectedChanges = parsedProposal.changes;
  if (Array.isArray(body.changeIndexes) && body.changeIndexes.length > 0) {
    const indexes = [...new Set(
      body.changeIndexes
        .map((value) => parseInteger(value))
        .filter((value): value is number => value !== null && value >= 0 && value < parsedProposal.changes.length)
    )].sort((a, b) => a - b);
    if (indexes.length === 0) {
      return NextResponse.json({ error: 'No valid change indexes provided.' }, { status: 400 });
    }
    selectedChanges = indexes.map((index) => parsedProposal.changes[index]);
  }

  const proposalToApply: PlanAdjustmentProposal = {
    ...parsedProposal,
    changes: selectedChanges
  };

  if (parsedProposal.requiresClarification) {
    const clarificationResponse = normalizeText(body.clarificationResponse);
    if (!clarificationResponse) {
      return NextResponse.json(
        {
          error: parsedProposal.clarificationPrompt || 'Clarification is required before applying this major plan change.',
          requiresClarification: true
        },
        { status: 409 }
      );
    }
  }

  const sanitizedProposal = sanitizeProposalAgainstLockedDays(proposalToApply, buildLockStateFromPlan(plan));
  if (hashProposalContent(sanitizedProposal) !== hashProposalContent(proposalToApply)) {
    return NextResponse.json(
      { error: 'Plan state changed since this proposal was generated. Please regenerate the adjustment.' },
      { status: 409 }
    );
  }
  const guardrailError = validatePatchGuardrails(message, proposalToApply);
  if (guardrailError) {
    return NextResponse.json({ error: guardrailError }, { status: 422 });
  }

  if (proposalToApply.changes.length === 0) {
    return NextResponse.json(
      { error: proposalToApply.summary || 'No changes to apply.' },
      { status: 400 }
    );
  }

  try {
    const result = await applyAdjustmentProposal(plan.id, proposalToApply);
    const refreshed = await loadPlanForUser(plan.id, user.id);
    if (!refreshed) {
      return NextResponse.json({ error: 'Plan refresh failed after apply' }, { status: 500 });
    }
    return NextResponse.json({
      applied: true,
      patchId: proposalToApply.patchId,
      appliedCount: result.appliedCount,
      extendedWeeks: result.extendedWeeks,
      summary: proposalToApply.summary,
      plan: await appendSourcePlanName(refreshed)
    });
  } catch (error: unknown) {
    const messageText = error instanceof Error ? error.message : 'Failed to apply adjustments';
    return NextResponse.json({ error: messageText }, { status: 400 });
  }
}
