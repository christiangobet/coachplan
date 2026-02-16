
import { ActivityPriority, ActivityType, Units } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolveWeekBounds } from '@/lib/plan-dates';
import { isDayMarkedDone } from '@/lib/day-status';

export type MoveActivityChange = {
    op: 'move_activity';
    activityId: string;
    targetDayId: string;
    reason: string;
};

export type EditActivityChange = {
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

export type AddActivityChange = {
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

export type DeleteActivityChange = {
    op: 'delete_activity';
    activityId: string;
    reason: string;
};

export type ExtendPlanChange = {
    op: 'extend_plan';
    newStartDate: string;
    reason: string;
};

export type ReanchorSubtypeWeeklyChange = {
    op: 'reanchor_subtype_weekly';
    subtype: string;
    targetDayOfWeek: number;
    fromDayOfWeek?: number | null;
    startWeekIndex?: number | null;
    reason: string;
};

export type PlanAdjustmentChange =
    | MoveActivityChange
    | EditActivityChange
    | AddActivityChange
    | DeleteActivityChange
    | ExtendPlanChange
    | ReanchorSubtypeWeeklyChange;

export type PlanAdjustmentProposal = {
    coachReply: string;
    summary: string;
    confidence: 'low' | 'medium' | 'high';
    riskFlags?: string[];
    followUpQuestion?: string;
    changes: PlanAdjustmentChange[];
};

export type ActivityLockInfo = {
    dayId: string;
    completed: boolean;
};

export type PlanLockState = {
    dayIdSet: Set<string>;
    lockedDayIdSet: Set<string>;
    activityById: Map<string, ActivityLockInfo>;
};

// Helper function to load lock state
export async function loadLockStateForPlan(planId: string): Promise<PlanLockState> {
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
        if (isDayMarkedDone(day.notes) || (dayActivities.length > 0 && dayActivities.every((a) => a.completed))) {
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

export interface PlanWithStructure {
    weeks: {
        days: {
            id: string;
            notes: string | null;
            activities: {
                id: string;
                completed: boolean;
            }[];
        }[];
    }[];
}

export function buildLockStateFromPlan(plan: PlanWithStructure): PlanLockState {
    const dayIdSet = new Set<string>();
    const lockedDayIdSet = new Set<string>();
    const activityById = new Map<string, ActivityLockInfo>();

    for (const week of plan.weeks || []) {
        for (const day of week.days || []) {
            dayIdSet.add(day.id);
            const dayActivities = day.activities || [];
            if (isDayMarkedDone(day.notes) || (dayActivities.length > 0 && dayActivities.every((a) => a.completed))) {
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

function normalizeSubtypeKey(value: string) {
    const token = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[_\s]+/g, '-')
        .replace(/[^a-z0-9-]/g, '');

    if (!token) return '';
    if (token === 'lr' || token === 'longrun' || token === 'long-run') return 'lrl';
    if (token === 'cross-train' || token === 'cross' || token === 'xt') return 'cross-training';
    return token;
}

function activityMatchesSubtype(
    activity: { type: ActivityType; subtype: string | null; title: string },
    requestedSubtype: string
) {
    const subtype = normalizeSubtypeKey(activity.subtype || '');
    const title = String(activity.title || '').toLowerCase();
    const target = normalizeSubtypeKey(requestedSubtype);
    if (!target) return false;

    if (target === 'lrl') {
        return (
            subtype === 'lrl'
            || /\blong run\b/i.test(title)
            || /\blrl\b/i.test(title)
        );
    }
    if (target === 'rest') {
        return activity.type === 'REST' || subtype === 'rest' || /\brest\b/i.test(title);
    }
    if (target === 'cross-training') {
        return (
            activity.type === 'CROSS_TRAIN'
            || subtype === 'cross-training'
            || /\bcross[\s-]?training\b/i.test(title)
            || /\bxt\b/i.test(title)
        );
    }
    if (target === 'strength') {
        return activity.type === 'STRENGTH' || subtype === 'strength' || /\bstrength\b/i.test(title);
    }
    if (target === 'tempo') {
        return subtype === 'tempo' || /\btempo\b/i.test(title);
    }
    if (target === 'recovery') {
        return subtype === 'recovery' || /\brecovery\b/i.test(title);
    }

    return subtype === target || title.includes(target.replace(/-/g, ' '));
}

// Core application logic
export async function applyAdjustmentProposal(planId: string, proposal: PlanAdjustmentProposal) {
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

            if (change.op === 'reanchor_subtype_weekly') {
                const targetDay = Number(change.targetDayOfWeek);
                if (!Number.isInteger(targetDay) || targetDay < 1 || targetDay > 7) {
                    throw new Error('reanchor_subtype_weekly.targetDayOfWeek must be an integer between 1 and 7.');
                }
                const fromDay = change.fromDayOfWeek === null || change.fromDayOfWeek === undefined
                    ? null
                    : Number(change.fromDayOfWeek);
                if (fromDay !== null && (!Number.isInteger(fromDay) || fromDay < 1 || fromDay > 7)) {
                    throw new Error('reanchor_subtype_weekly.fromDayOfWeek must be null or an integer between 1 and 7.');
                }
                const startWeekIndex = change.startWeekIndex === null || change.startWeekIndex === undefined
                    ? 1
                    : Number(change.startWeekIndex);
                if (!Number.isInteger(startWeekIndex) || startWeekIndex < 1) {
                    throw new Error('reanchor_subtype_weekly.startWeekIndex must be null or a positive integer.');
                }

                const weeks = await tx.planWeek.findMany({
                    where: { planId },
                    orderBy: { weekIndex: 'asc' },
                    include: {
                        days: {
                            include: {
                                activities: {
                                    select: {
                                        id: true,
                                        dayId: true,
                                        completed: true,
                                        type: true,
                                        subtype: true,
                                        title: true
                                    }
                                }
                            }
                        }
                    }
                });

                const normalizedTargetSubtype = normalizeSubtypeKey(change.subtype);
                if (!normalizedTargetSubtype) {
                    throw new Error('reanchor_subtype_weekly.subtype is required.');
                }

                let movedForThisChange = 0;
                for (const week of weeks) {
                    if (week.weekIndex < startWeekIndex) continue;

                    const orderedDays = [...(week.days || [])].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
                    const dayByDow = new Map(orderedDays.map((day) => [day.dayOfWeek, day]));
                    const targetDayEntry = dayByDow.get(targetDay);
                    if (!targetDayEntry) continue;
                    if (lockedDayIdSet.has(targetDayEntry.id)) continue;

                    const sourceDays = fromDay
                        ? (dayByDow.get(fromDay) ? [dayByDow.get(fromDay)!] : [])
                        : orderedDays;

                    let selectedActivityId: string | null = null;
                    let selectedFromDayId: string | null = null;
                    for (const sourceDay of sourceDays) {
                        if (lockedDayIdSet.has(sourceDay.id)) continue;
                        const candidate = (sourceDay.activities || []).find((activity) => {
                            if (activity.completed) return false;
                            if (!activityMatchesSubtype(activity, normalizedTargetSubtype)) return false;
                            const lockInfo = activityById.get(activity.id);
                            if (!lockInfo) return false;
                            if (lockInfo.completed || lockedDayIdSet.has(lockInfo.dayId)) return false;
                            return true;
                        });
                        if (candidate) {
                            selectedActivityId = candidate.id;
                            selectedFromDayId = sourceDay.id;
                            break;
                        }
                    }

                    if (!selectedActivityId || !selectedFromDayId) continue;
                    if (selectedFromDayId === targetDayEntry.id) continue;

                    await tx.planActivity.update({
                        where: { id: selectedActivityId },
                        data: { dayId: targetDayEntry.id }
                    });
                    const lockInfo = activityById.get(selectedActivityId);
                    if (lockInfo) {
                        activityById.set(selectedActivityId, {
                            ...lockInfo,
                            dayId: targetDayEntry.id
                        });
                    }
                    movedForThisChange += 1;
                }

                appliedCount += movedForThisChange;
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
                await tx.planActivity.delete({
                    where: { id: change.activityId }
                });
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
                    throw new Error('Cannot edit activities in completed days.');
                }

                const data: any = {};
                if (change.type !== undefined) data.type = change.type;
                if (change.title !== undefined) data.title = change.title;
                if (change.duration !== undefined) data.duration = change.duration;
                if (change.distance !== undefined) data.distance = change.distance;
                if (change.distanceUnit !== undefined) data.distanceUnit = change.distanceUnit;
                if (change.paceTarget !== undefined) data.paceTarget = change.paceTarget;
                if (change.effortTarget !== undefined) data.effortTarget = change.effortTarget;
                if (change.notes !== undefined) data.notes = change.notes;
                if (change.mustDo !== undefined) data.mustDo = change.mustDo;
                if (change.bailAllowed !== undefined) data.bailAllowed = change.bailAllowed;
                if (change.priority !== undefined) data.priority = change.priority;

                await tx.planActivity.update({
                    where: { id: change.activityId },
                    data
                });
                appliedCount += 1;
                continue;
            }

            if (change.op === 'add_activity') {
                if (!dayIdSet.has(change.dayId)) {
                    throw new Error(`Day not found in plan: ${change.dayId}`);
                }
                if (lockedDayIdSet.has(change.dayId)) {
                    throw new Error('Cannot add activities to completed days.');
                }

                await tx.planActivity.create({
                    data: {
                        planId: planId,
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
                        priority: change.priority ?? null,
                        completed: false
                    }
                });
                appliedCount += 1;
                continue;
            }
        }
    });

    return { appliedCount, extendedWeeks };
}

export function isChangeAllowed(change: PlanAdjustmentChange, lockState: PlanLockState): boolean {
    if (change.op === 'extend_plan') return true;
    if (change.op === 'reanchor_subtype_weekly') return true;
    if (change.op === 'add_activity') {
        return !lockState.lockedDayIdSet.has(change.dayId);
    }
    if (change.op === 'move_activity') {
        const activity = lockState.activityById.get(change.activityId);
        if (!activity) return false;
        if (activity.completed || lockState.lockedDayIdSet.has(activity.dayId)) return false;
        return !lockState.lockedDayIdSet.has(change.targetDayId);
    }
    if (change.op === 'delete_activity' || change.op === 'edit_activity') {
        const activity = lockState.activityById.get(change.activityId);
        if (!activity) return false;
        return !activity.completed && !lockState.lockedDayIdSet.has(activity.dayId);
    }
    return false;
}

export function changeTouchesLockedDay(change: PlanAdjustmentChange, lockState: PlanLockState): boolean {
    return !isChangeAllowed(change, lockState);
}

export function sanitizeProposalAgainstLockedDays(
    proposal: PlanAdjustmentProposal,
    lockState: PlanLockState
) {
    let removed = 0;
    const nextChanges = proposal.changes.filter((change) => {
        // isChangeAllowed returns true if allowed, false if blocked.
        // changeTouchesLockedDay returns true if blocked (touching locked), false if safe.
        // We want to keep changes that do NOT touch locked days.
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
