import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { ActivityPriority, ActivityType, Units } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getDefaultAiModel, openaiJsonSchema } from '@/lib/openai';
import { ensureUserFromAuth } from '@/lib/user-sync';
import { getDayDateFromWeekStart, resolveWeekBounds } from '@/lib/plan-dates';
import { isDayMarkedDone } from '@/lib/day-status';

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
};

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
        isLocked: isDayMarkedDone(day.notes) || (dayActivities.length > 0 && dayActivities.every((activity) => activity.completed)),
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





async function generateAdjustmentProposal(message: string, plan: NonNullable<PlanForContext>) {
  const context = buildPlanContext(plan);
  const model = getDefaultAiModel();
  return openaiJsonSchema<PlanAdjustmentProposal>({
    model,
    input: [
      'You are an experienced endurance running coach.',
      'Given athlete feedback and current training plan context, propose safe, practical plan adjustments.',
      'Act like an expert training advisor, not a simple editor: preserve weekly intent, recovery rhythm, and athlete adherence.',
      'Rules:',
      '- Be conservative when illness/fatigue is mentioned.',
      '- Preserve key sessions when possible, but reduce load if needed.',
      '- Do not increase weekly load aggressively.',
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
      '- If critical details are missing, ask one concise follow-up question and reduce confidence.',
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

  const parsedProposal = parseProposal(body.proposal);
  if (!parsedProposal) {
    return NextResponse.json({ error: 'proposal is required when apply=true' }, { status: 400 });
  }
  const sanitizedProposal = sanitizeProposalAgainstLockedDays(parsedProposal, buildLockStateFromPlan(plan));
  if (sanitizedProposal.changes.length === 0) {
    return NextResponse.json(
      { error: sanitizedProposal.summary || 'No changes to apply.' },
      { status: 400 }
    );
  }

  try {
    const result = await applyAdjustmentProposal(plan.id, sanitizedProposal);
    const refreshed = await loadPlanForUser(plan.id, user.id);
    if (!refreshed) {
      return NextResponse.json({ error: 'Plan refresh failed after apply' }, { status: 500 });
    }
    return NextResponse.json({
      applied: true,
      appliedCount: result.appliedCount,
      extendedWeeks: result.extendedWeeks,
      summary: sanitizedProposal.summary,
      plan: await appendSourcePlanName(refreshed)
    });
  } catch (error: unknown) {
    const messageText = error instanceof Error ? error.message : 'Failed to apply adjustments';
    return NextResponse.json({ error: messageText }, { status: 400 });
  }
}
