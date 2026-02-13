import { NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireRoleApi } from '@/lib/role-guards';

type RolePreset = 'ATHLETE' | 'COACH' | 'ADMIN' | 'ATHLETE_COACH';

function parseRolePreset(input: unknown): RolePreset | null {
  if (
    input === 'ATHLETE'
    || input === 'COACH'
    || input === 'ADMIN'
    || input === 'ATHLETE_COACH'
  ) {
    return input;
  }
  return null;
}

function updatesForRolePreset(rolePreset: RolePreset, currentRole: UserRole) {
  if (rolePreset === 'ADMIN') {
    return { role: 'ADMIN' as UserRole, currentRole: 'ADMIN' as UserRole, hasBothRoles: false };
  }
  if (rolePreset === 'COACH') {
    return { role: 'COACH' as UserRole, currentRole: 'COACH' as UserRole, hasBothRoles: false };
  }
  if (rolePreset === 'ATHLETE') {
    return { role: 'ATHLETE' as UserRole, currentRole: 'ATHLETE' as UserRole, hasBothRoles: false };
  }
  return {
    role: 'ATHLETE' as UserRole,
    currentRole: currentRole === 'COACH' ? 'COACH' as UserRole : 'ATHLETE' as UserRole,
    hasBothRoles: true
  };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireRoleApi('ADMIN');
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const rolePreset = parseRolePreset((body as { rolePreset?: unknown }).rolePreset);
  const isActiveInput = (body as { isActive?: unknown }).isActive;
  const hasActiveUpdate = typeof isActiveInput === 'boolean';

  if (!rolePreset && !hasActiveUpdate) {
    return NextResponse.json({ error: 'No supported fields to update' }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      role: true,
      currentRole: true,
      isActive: true
    }
  });

  if (!existing) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const isSelf = existing.id === access.context.userId;
  if (isSelf && hasActiveUpdate && isActiveInput === false) {
    return NextResponse.json({ error: 'You cannot deactivate your own account' }, { status: 400 });
  }
  if (isSelf && rolePreset && rolePreset !== 'ADMIN') {
    return NextResponse.json({ error: 'You cannot remove your own admin role' }, { status: 400 });
  }

  const data: {
    role?: UserRole;
    currentRole?: UserRole;
    hasBothRoles?: boolean;
    isActive?: boolean;
    deactivatedAt?: Date | null;
  } = {};

  if (rolePreset) {
    const roleUpdates = updatesForRolePreset(rolePreset, existing.currentRole);
    data.role = roleUpdates.role;
    data.currentRole = roleUpdates.currentRole;
    data.hasBothRoles = roleUpdates.hasBothRoles;
  }

  if (hasActiveUpdate) {
    data.isActive = isActiveInput;
    data.deactivatedAt = isActiveInput ? null : new Date();
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      currentRole: true,
      hasBothRoles: true,
      isActive: true,
      createdAt: true,
      deactivatedAt: true
    }
  });

  return NextResponse.json({ user: updated });
}
