
import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { ensureUserFromAuth } from '@/lib/user-sync';
import { applyAdjustmentProposal, PlanAdjustmentProposal, AddActivityChange } from '@/lib/plan-editor';
import { ActivityType, Units, ActivityPriority } from '@prisma/client';

type AddActivityBody = {
    type: ActivityType;
    title: string;
    duration?: number;
    distance?: number;
    distanceUnit?: Units;
    paceTarget?: string;
    effortTarget?: string;
    notes?: string;
    mustDo?: boolean;
    bailAllowed?: boolean;
    priority?: ActivityPriority;
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const authUser = await currentUser();
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await ensureUserFromAuth(authUser, { defaultRole: 'ATHLETE' });

    const { id: dayId } = await params;

    // Find the plan associated with this day to verify ownership
    const day = await prisma.planDay.findUnique({
        where: { id: dayId },
        select: {
            plan: {
                select: { id: true, ownerId: true, athleteId: true }
            }
        }
    });

    if (!day || !day.plan) {
        return NextResponse.json({ error: 'Day not found' }, { status: 404 });
    }

    if (day.plan.ownerId !== user.id && day.plan.athleteId !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json() as AddActivityBody;

    // Validate required fields
    if (!body.type || !body.title) {
        return NextResponse.json({ error: 'Missing required fields: type, title' }, { status: 400 });
    }

    const change: AddActivityChange = {
        op: 'add_activity',
        dayId: dayId,
        reason: 'Manual addition by user',
        type: body.type,
        title: body.title,
        duration: body.duration,
        distance: body.distance,
        distanceUnit: body.distanceUnit,
        paceTarget: body.paceTarget,
        effortTarget: body.effortTarget,
        notes: body.notes,
        mustDo: body.mustDo,
        bailAllowed: body.bailAllowed,
        priority: body.priority
    };

    const proposal: PlanAdjustmentProposal = {
        coachReply: 'Manually added activity.',
        summary: 'Manually added activity.',
        confidence: 'high',
        changes: [change]
    };

    try {
        const result = await applyAdjustmentProposal(day.plan.id, proposal);
        return NextResponse.json({ success: true, appliedCount: result.appliedCount });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to add activity';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
