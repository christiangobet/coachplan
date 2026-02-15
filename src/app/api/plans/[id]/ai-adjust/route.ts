import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { ActivityPriority, ActivityType, Units } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { alignWeeksToRaceDate } from '@/lib/clone-plan';
import { getDefaultAiModel, openaiJsonSchema } from '@/lib/openai';
import { ensureUserFromAuth } from '@/lib/user-sync';
import { getDayDateFromWeekStart, resolveWeekBounds } from '@/lib/plan-dates';
import { isDayMarkedDone } from '@/lib/day-status';

type MoveActivityChange = {
  op: 'move_activity';
  activityId: string;
  targetDayId: string;
  reason: string;
};

type EditActivityChange = {
  op: 'edit_activity';
  activityId: string;
  reason: string;
  type?: ActivityType;
  title?: string;
  duration?: number | null;
  distance?: number | null;
  distanceUnit?: Units | null;
  paceTarget?: string | null;
  effortTarget?: string | null;
  notes?: string | null;
  mustDo?: boolean;
  bailAllowed?: boolean;
  priority?: ActivityPriority | null;
};

type AddActivityChange = {
  op: 'add_activity';
  dayId: string;
  reason: string;
  type: ActivityType;
  title: string;
  duration?: number | null;
  distance?: number | null;
  distanceUnit?: Units | null;
  paceTarget?: string | null;
  effortTarget?: string | null;
  notes?: string | null;
  mustDo?: boolean;
  bailAllowed?: boolean;
  priority?: ActivityPriority | null;
};

type DeleteActivityChange = {
  op: 'delete_activity';
  activityId: string;
  reason: string;
};

type ExtendPlanChange = {
  op: 'extend_plan';
  newStartDate: string;
  reason: string;
};

type PlanAdjustmentChange =
  | MoveActivityChange
  | EditActivityChange
  | AddActivityChange
  | DeleteActivityChange
  | ExtendPlanChange;

type PlanAdjustmentProposal = {
  coachReply: string;
  summary: string;
  confidence: 'low' | 'medium' | 'high';
  riskFlags?: string[];
  followUpQuestion?: string;
  changes: PlanAdjustmentChange[];
};

type PlanAdjustRequestBody = {
  message?: unknown;
  apply?: unknown;
  proposal?: unknown;
};

type ActivityLockInfo = {
  dayId: string;
  completed: boolean;
};

type PlanLockState = {
  dayIdSet: Set<string>;
  lockedDayIdSet: Set<string>;
  activityById: Map<string, ActivityLockInfo>;
};

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

function isoDateToLocalDate(isoDate: string) {
  const [y, m, d] = isoDate.split('-').map((part) => Number(part));
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toMonday(date: Date) {
  const monday = new Date(date);
  const dow = monday.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  monday.setDate(monday.getDate() + offset);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  next.setHours(0, 0, 0, 0);
  return next;
}

function diffDays(start: Date, end: Date) {
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function isLockedDay(notes: string | null | undefined, activities: Array<{ completed: boolean }>) {
  return isDayMarkedDone(notes) || (activities.length > 0 && activities.every((activity) => activity.completed));
}

function parseProposal(raw: unknown): PlanAdjustmentProposal | null {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as Record<string, unknown>;
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

    return null;
  }

  const riskFlags = Array.isArray(payload.riskFlags)
    ? payload.riskFlags.filter((item): item is string => typeof item === 'string').map((text) => text.slice(0, 180))
    : [];
  const followUpQuestion = normalizeText(payload.followUpQuestion) || undefined;

  return {
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
      completed: boolean;
      duration: number | null;
      distance: number | null;
      distanceUnit: Units | null;
      priority: ActivityPriority | null;
      mustDo: boolean;
    }>;
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
    for (const day of days) {
      const date = getDayDateFromWeekStart(bounds.startDate, day.dayOfWeek);
      const dayActivities = day.activities || [];
      rows.push({
        dayId: day.id,
        weekIndex: week.weekIndex,
        dayOfWeek: day.dayOfWeek,
        dateISO: date ? new Date(date).toISOString().slice(0, 10) : null,
        isLocked: isLockedDay(day.notes, dayActivities),
        activities: dayActivities.map((activity) => ({
          activityId: activity.id,
          title: activity.title,
          type: activity.type,
          completed: activity.completed,
          duration: activity.duration ?? null,
          distance: activity.distance ?? null,
          distanceUnit: activity.distanceUnit ?? null,
          priority: activity.priority ?? null,
          mustDo: activity.mustDo
        }))
      });
    }
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
    days: rows
  };
}

function buildLockStateFromPlan(plan: NonNullable<PlanForContext>): PlanLockState {
  const dayIdSet = new Set<string>();
  const lockedDayIdSet = new Set<string>();
  const activityById = new Map<string, ActivityLockInfo>();

  for (const week of plan.weeks || []) {
    for (const day of week.days || []) {
      dayIdSet.add(day.id);
      const dayActivities = day.activities || [];
      if (isLockedDay(day.notes, dayActivities)) {
        lockedDayIdSet.add(day.id);
      }
      for (const activity of dayActivities) {
        activityById.set(activity.id, {
          dayId: day.id,
          completed: activity.completed
        });
      }
    }
  }

  return { dayIdSet, lockedDayIdSet, activityById };
}

async function loadLockStateForPlan(planId: string): Promise<PlanLockState> {
  const planDays = await prisma.planDay.findMany({
    where: { planId },
    select: {
      id: true,
      notes: true,
      activities: {
        select: {
          id: true,
          completed: true
        }
      }
    }
  });

  const dayIdSet = new Set<string>();
  const lockedDayIdSet = new Set<string>();
  const activityById = new Map<string, ActivityLockInfo>();

  for (const day of planDays) {
    dayIdSet.add(day.id);
    const dayActivities = day.activities || [];
    if (isLockedDay(day.notes, dayActivities)) {
      lockedDayIdSet.add(day.id);
    }
    for (const activity of dayActivities) {
      activityById.set(activity.id, {
        dayId: day.id,
        completed: activity.completed
      });
    }
  }

  return { dayIdSet, lockedDayIdSet, activityById };
}

function changeTouchesLockedDay(change: PlanAdjustmentChange, lockState: PlanLockState) {
  if (change.op === 'extend_plan') return false;

  if (change.op === 'add_activity') {
    return lockState.lockedDayIdSet.has(change.dayId);
  }

  const activity = lockState.activityById.get(change.activityId);
  if (!activity) return false;
  if (activity.completed || lockState.lockedDayIdSet.has(activity.dayId)) return true;

  if (change.op === 'move_activity') {
    return lockState.lockedDayIdSet.has(change.targetDayId);
  }

  return false;
}

function sanitizeProposalAgainstLockedDays(
  proposal: PlanAdjustmentProposal,
  lockState: PlanLockState
) {
  let removed = 0;
  const nextChanges = proposal.changes.filter((change) => {
    const blocked = changeTouchesLockedDay(change, lockState);
    if (blocked) removed += 1;
    return !blocked;
  });

  if (removed === 0) {
    return proposal;
  }

  const lockNote = `${removed} proposed change(s) were removed because completed days are locked.`;
  const riskFlags = [lockNote, ...(proposal.riskFlags || [])].slice(0, 6);
  return {
    ...proposal,
    summary: nextChanges.length === 0 ? 'No applicable changes: completed days are locked.' : proposal.summary,
    riskFlags,
    changes: nextChanges
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
      'Rules:',
      '- Be conservative when illness/fatigue is mentioned.',
      '- Preserve key sessions when possible, but reduce load if needed.',
      '- Do not increase weekly load aggressively.',
      '- Use only IDs present in context for day/activity references.',
      '- Days listed in lockedDayIds are completed and must not be modified.',
      '- Do not add activities to completed days.',
      '- Do not move/edit/delete activities that are completed or already in completed days.',
      '- You may use extend_plan ONLY when athlete asks to start earlier or add weeks while keeping race date unchanged.',
      '- For extend_plan, provide newStartDate as ISO date (YYYY-MM-DD).',
      '- Do not use extend_plan for race-date changes or other structure changes.',
      '- Explain changes briefly in plain language.',
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
            maxItems: 12,
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
                }
              ]
            }
          }
        }
      }
    }
  });
}

async function applyAdjustmentProposal(planId: string, proposal: PlanAdjustmentProposal) {
  const planMeta = await prisma.trainingPlan.findUnique({
    where: { id: planId },
    select: { raceDate: true, weekCount: true }
  });
  if (!planMeta) {
    throw new Error('Plan not found while applying adjustments');
  }

  const lockState = await loadLockStateForPlan(planId);
  const dayIdSet = lockState.dayIdSet;
  const lockedDayIdSet = lockState.lockedDayIdSet;
  const activityById = lockState.activityById;
  const activityIdSet = new Set(activityById.keys());
  const initialWeekIndexes = await prisma.planWeek.findMany({
    where: { planId },
    select: { weekIndex: true }
  });
  let effectiveWeekCount = Math.max(
    planMeta.weekCount ?? 0,
    ...initialWeekIndexes.map((week) => week.weekIndex)
  );

  let appliedCount = 0;
  let extendedWeeks = 0;
  await prisma.$transaction(async (tx) => {
    for (const change of proposal.changes) {
      if (change.op === 'extend_plan') {
        const requestedStart = isoDateToLocalDate(change.newStartDate);
        if (!requestedStart) {
          throw new Error(`Invalid newStartDate: ${change.newStartDate}`);
        }

        const weeks = await tx.planWeek.findMany({
          where: { planId },
          select: { id: true, weekIndex: true, startDate: true, endDate: true },
          orderBy: { weekIndex: 'asc' }
        });
        if (weeks.length === 0) {
          throw new Error('Cannot extend a plan with no existing weeks.');
        }

        const allWeekIndexes = weeks.map((week) => week.weekIndex);
        let earliestStart: Date | null = null;
        for (const week of weeks) {
          const bounds = resolveWeekBounds({
            weekIndex: week.weekIndex,
            weekStartDate: week.startDate,
            weekEndDate: week.endDate,
            raceDate: planMeta.raceDate,
            weekCount: effectiveWeekCount,
            allWeekIndexes
          });
          if (!bounds.startDate) continue;
          if (!earliestStart || bounds.startDate.getTime() < earliestStart.getTime()) {
            earliestStart = bounds.startDate;
          }
        }
        if (!earliestStart) {
          throw new Error('Unable to determine current plan start date for extend_plan.');
        }

        const requestedMonday = toMonday(requestedStart);
        const daysToCover = diffDays(requestedMonday, earliestStart);
        if (daysToCover <= 0) {
          continue;
        }

        const weeksToAdd = Math.ceil(daysToCover / 7);
        const descendingWeeks = [...weeks].sort((a, b) => b.weekIndex - a.weekIndex);
        for (const week of descendingWeeks) {
          await tx.planWeek.update({
            where: { id: week.id },
            data: { weekIndex: week.weekIndex + weeksToAdd }
          });
        }

        for (let i = 0; i < weeksToAdd; i += 1) {
          const startDate = addDays(requestedMonday, i * 7);
          const endDate = addDays(startDate, 6);
          const createdWeek = await tx.planWeek.create({
            data: {
              planId,
              weekIndex: i + 1,
              startDate,
              endDate
            }
          });
          await tx.planDay.createMany({
            data: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
              planId,
              weekId: createdWeek.id,
              dayOfWeek,
              rawText: null,
              notes: null
            }))
          });
        }

        const maxExistingWeekIndex = weeks.reduce(
          (max, week) => (week.weekIndex > max ? week.weekIndex : max),
          0
        );
        effectiveWeekCount = Math.max(effectiveWeekCount, maxExistingWeekIndex) + weeksToAdd;
        await tx.trainingPlan.update({
          where: { id: planId },
          data: { weekCount: effectiveWeekCount }
        });
        extendedWeeks += weeksToAdd;
        appliedCount += 1;
        continue;
      }

      if (change.op === 'move_activity') {
        if (!activityIdSet.has(change.activityId)) {
          throw new Error(`Activity not found in plan: ${change.activityId}`);
        }
        if (!dayIdSet.has(change.targetDayId)) {
          throw new Error(`Target day not found in plan: ${change.targetDayId}`);
        }
        const activity = activityById.get(change.activityId);
        if (!activity) {
          throw new Error(`Activity not found in plan: ${change.activityId}`);
        }
        if (activity.completed || lockedDayIdSet.has(activity.dayId)) {
          throw new Error('Cannot move activities from completed days.');
        }
        if (lockedDayIdSet.has(change.targetDayId)) {
          throw new Error('Cannot move activities into completed days.');
        }
        await tx.planActivity.update({
          where: { id: change.activityId },
          data: { dayId: change.targetDayId }
        });
        activityById.set(change.activityId, {
          ...activity,
          dayId: change.targetDayId
        });
        appliedCount += 1;
        continue;
      }

      if (change.op === 'delete_activity') {
        if (!activityIdSet.has(change.activityId)) {
          throw new Error(`Activity not found in plan: ${change.activityId}`);
        }
        const activity = activityById.get(change.activityId);
        if (!activity) {
          throw new Error(`Activity not found in plan: ${change.activityId}`);
        }
        if (activity.completed || lockedDayIdSet.has(activity.dayId)) {
          throw new Error('Cannot delete activities from completed days.');
        }
        await tx.externalActivity.updateMany({
          where: { matchedPlanActivityId: change.activityId },
          data: { matchedPlanActivityId: null }
        });
        await tx.planActivity.delete({ where: { id: change.activityId } });
        activityIdSet.delete(change.activityId);
        activityById.delete(change.activityId);
        appliedCount += 1;
        continue;
      }

      if (change.op === 'edit_activity') {
        if (!activityIdSet.has(change.activityId)) {
          throw new Error(`Activity not found in plan: ${change.activityId}`);
        }
        const activity = activityById.get(change.activityId);
        if (!activity) {
          throw new Error(`Activity not found in plan: ${change.activityId}`);
        }
        if (activity.completed || lockedDayIdSet.has(activity.dayId)) {
          throw new Error('Cannot edit activities from completed days.');
        }
        const updates: {
          type?: ActivityType;
          subtype?: string | null;
          title?: string;
          duration?: number | null;
          distance?: number | null;
          distanceUnit?: Units | null;
          paceTarget?: string | null;
          effortTarget?: string | null;
          notes?: string | null;
          mustDo?: boolean;
          bailAllowed?: boolean;
          priority?: ActivityPriority | null;
        } = {};
        if (change.type !== undefined) {
          updates.type = change.type;
          updates.subtype = null;
        }
        if (change.title !== undefined) {
          updates.title = change.title;
          updates.subtype = null;
        }
        if (change.duration !== undefined) updates.duration = change.duration;
        if (change.distance !== undefined) updates.distance = change.distance;
        if (change.distanceUnit !== undefined) updates.distanceUnit = change.distanceUnit;
        if (change.paceTarget !== undefined) updates.paceTarget = change.paceTarget;
        if (change.effortTarget !== undefined) updates.effortTarget = change.effortTarget;
        if (change.notes !== undefined) updates.notes = change.notes;
        if (change.mustDo !== undefined) updates.mustDo = change.mustDo;
        if (change.bailAllowed !== undefined) updates.bailAllowed = change.bailAllowed;
        if (change.priority !== undefined) updates.priority = change.priority;

        if (Object.keys(updates).length > 0) {
          await tx.planActivity.update({
            where: { id: change.activityId },
            data: updates
          });
          appliedCount += 1;
        }
        continue;
      }

      if (change.op === 'add_activity') {
        if (!dayIdSet.has(change.dayId)) {
          throw new Error(`Target day not found in plan: ${change.dayId}`);
        }
        if (lockedDayIdSet.has(change.dayId)) {
          throw new Error('Cannot add activities to completed days.');
        }
        await tx.planActivity.create({
          data: {
            planId,
            dayId: change.dayId,
            type: change.type,
            title: change.title,
            duration: change.duration ?? null,
            distance: change.distance ?? null,
            distanceUnit: change.distanceUnit ?? null,
            paceTarget: change.paceTarget ?? null,
            effortTarget: change.effortTarget ?? null,
            notes: change.notes ?? null,
            mustDo: change.mustDo ?? false,
            bailAllowed: change.bailAllowed ?? false,
            priority: change.priority ?? null
          }
        });
        appliedCount += 1;
      }
    }
  });

  if (extendedWeeks > 0 && planMeta.raceDate && effectiveWeekCount > 0) {
    await alignWeeksToRaceDate(planId, effectiveWeekCount, planMeta.raceDate);
  }

  return { appliedCount, extendedWeeks };
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
      return NextResponse.json({
        proposal: sanitized,
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

  const proposal = parseProposal(body.proposal);
  if (!proposal) {
    return NextResponse.json({ error: 'proposal is required when apply=true' }, { status: 400 });
  }
  if (proposal.changes.length === 0) {
    return NextResponse.json({ error: 'No changes to apply.' }, { status: 400 });
  }

  try {
    const result = await applyAdjustmentProposal(plan.id, proposal);
    const refreshed = await loadPlanForUser(plan.id, user.id);
    if (!refreshed) {
      return NextResponse.json({ error: 'Plan refresh failed after apply' }, { status: 500 });
    }
    return NextResponse.json({
      applied: true,
      appliedCount: result.appliedCount,
      extendedWeeks: result.extendedWeeks,
      summary: proposal.summary,
      plan: await appendSourcePlanName(refreshed)
    });
  } catch (error: unknown) {
    const messageText = error instanceof Error ? error.message : 'Failed to apply adjustments';
    return NextResponse.json({ error: messageText }, { status: 400 });
  }
}
