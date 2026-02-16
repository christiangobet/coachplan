
import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { ensureUserFromAuth } from '@/lib/user-sync';
import { applyAdjustmentProposal, PlanAdjustmentProposal, EditActivityChange, DeleteActivityChange } from '@/lib/plan-editor';
import { ActivityType, Units, ActivityPriority } from '@prisma/client';

type UpdateActivityBody = {
    type?: ActivityType;
    title?: string;
    duration?: number;
    distance?: number;
    distanceUnit?: Units | null;
    paceTarget?: string;
    effortTarget?: string;
    notes?: string;
    mustDo?: boolean;
    bailAllowed?: boolean;
    priority?: ActivityPriority;
};

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const authUser = await currentUser();
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await ensureUserFromAuth(authUser, { defaultRole: 'ATHLETE' });
    const { id: activityId } = await params;

    // Verify ownership via plan -> day -> activity
    const activity = await prisma.planActivity.findUnique({
        where: { id: activityId },
        select: {
            id: true,
            day: {
                select: {
                    plan: {
                        select: { id: true, ownerId: true, athleteId: true }
                    }
                }
            }
        }
    });

    if (!activity || !activity.day || !activity.day.plan) {
        return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    }

    const plan = activity.day.plan;
    if (plan.ownerId !== user.id && plan.athleteId !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json() as UpdateActivityBody;

    const change: EditActivityChange = {
        op: 'edit_activity',
        activityId: activityId,
        reason: 'Manual edit by user',
        ...body
    };

    const proposal: PlanAdjustmentProposal = {
        coachReply: 'Manual edit',
        summary: 'Manual edit',
        confidence: 'high',
        changes: [change]
    };

    try {
        const result = await applyAdjustmentProposal(plan.id, proposal);
        return NextResponse.json({ success: true, appliedCount: result.appliedCount });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to update activity';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const authUser = await currentUser();
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await ensureUserFromAuth(authUser, { defaultRole: 'ATHLETE' });
    const { id: activityId } = await params;

    const activity = await prisma.planActivity.findUnique({
        where: { id: activityId },
        select: {
            id: true,
            day: {
                select: {
                    plan: {
                        select: { id: true, ownerId: true, athleteId: true }
                    }
                }
            }
        }
    });

    if (!activity || !activity.day || !activity.day.plan) {
        return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    }

    const plan = activity.day.plan;
    if (plan.ownerId !== user.id && plan.athleteId !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const change: DeleteActivityChange = {
        op: 'delete_activity',
        activityId: activityId,
        reason: 'Manual deletion by user'
    };

    const proposal: PlanAdjustmentProposal = {
        coachReply: 'Manual delete',
        summary: 'Manual delete',
        confidence: 'high',
        changes: [change]
    };

    try {
        const result = await applyAdjustmentProposal(plan.id, proposal);
        return NextResponse.json({ success: true, appliedCount: result.appliedCount });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to delete activity';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
