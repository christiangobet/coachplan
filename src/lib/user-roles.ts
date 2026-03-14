import { UserRole } from '@prisma/client';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { ensureUserFromAuth } from '@/lib/user-sync';

const ROLE_PRIORITY: UserRole[] = ['ATHLETE', 'COACH', 'ADMIN'];

const ROLE_HOME: Record<UserRole, string> = {
  ATHLETE: '/dashboard',
  COACH: '/coach',
  ADMIN: '/admin'
};

export type UserRoleContext = {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  currentRole: UserRole;
  availableRoles: UserRole[];
  hasBothRoles: boolean;
  isActive: boolean;
};

export type UserRoleContextResolution = {
  context: UserRoleContext | null;
  failure: 'signed_out' | 'auth_unavailable' | 'sync_failed' | null;
  durationMs: number;
};

export function getRoleHomePath(role: UserRole): string {
  return ROLE_HOME[role];
}

export function getRoleLabel(role: UserRole): string {
  if (role === 'ATHLETE') return 'Athlete';
  if (role === 'COACH') return 'Coach';
  return 'Admin';
}

function sortRoles(roles: Set<UserRole>): UserRole[] {
  return ROLE_PRIORITY.filter((role) => roles.has(role));
}

async function inferRolesFromData(userId: string): Promise<Set<UserRole>> {
  const [coachLinkCount, athleteLinkCount, coachTemplateCount, athletePlanCount] =
    await prisma.$transaction([
      prisma.coachAthlete.count({ where: { coachId: userId } }),
      prisma.coachAthlete.count({ where: { athleteId: userId } }),
      prisma.trainingPlan.count({ where: { ownerId: userId, isTemplate: true } }),
      prisma.trainingPlan.count({
        where: {
          isTemplate: false,
          OR: [{ athleteId: userId }, { ownerId: userId }]
        }
      })
    ]);

  const inferred = new Set<UserRole>();
  if (coachLinkCount > 0 || coachTemplateCount > 0) inferred.add('COACH');
  if (athleteLinkCount > 0 || athletePlanCount > 0) inferred.add('ATHLETE');
  return inferred;
}

export async function resolveCurrentUserRoleContext(): Promise<UserRoleContextResolution> {
  const startedAt = Date.now();
  let authUser;
  try {
    authUser = await currentUser();
  } catch (error) {
    console.error('Failed to read Clerk user context', error);
    const resolution: UserRoleContextResolution = {
      context: null,
      failure: 'auth_unavailable',
      durationMs: Date.now() - startedAt
    };
    console.warn('[user-roles] auth_unavailable', { durationMs: resolution.durationMs });
    return resolution;
  }
  if (!authUser) {
    return {
      context: null,
      failure: 'signed_out',
      durationMs: Date.now() - startedAt
    };
  }

  let dbUser;
  try {
    dbUser = await ensureUserFromAuth(authUser, {
      defaultRole: 'ATHLETE',
      defaultCurrentRole: 'ATHLETE'
    });
  } catch (error) {
    console.error('Failed to sync user role context', error);
    const resolution: UserRoleContextResolution = {
      context: null,
      failure: 'sync_failed',
      durationMs: Date.now() - startedAt
    };
    console.warn('[user-roles] sync_failed', {
      durationMs: resolution.durationMs,
      authUserId: authUser.id
    });
    return resolution;
  }

  if (!dbUser.isActive) {
    const resolution: UserRoleContextResolution = {
      context: {
        userId: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        role: dbUser.role,
        currentRole: dbUser.currentRole,
        availableRoles: [dbUser.currentRole],
        hasBothRoles: dbUser.hasBothRoles,
        isActive: false
      },
      failure: null,
      durationMs: Date.now() - startedAt
    };
    console.info('[user-roles] resolved_inactive_user', {
      userId: dbUser.id,
      durationMs: resolution.durationMs
    });
    return resolution;
  }

  const roles = new Set<UserRole>([dbUser.role, dbUser.currentRole]);

  if (dbUser.hasBothRoles && !(dbUser.role === 'ADMIN' && dbUser.currentRole === 'ADMIN')) {
    roles.add('ATHLETE');
    roles.add('COACH');
  }

  try {
    const inferred = await inferRolesFromData(dbUser.id);
    inferred.forEach((role) => roles.add(role));
  } catch (error) {
    console.error('Failed to infer role context from data', error);
  }

  if (roles.size === 0) roles.add('ATHLETE');

  const availableRoles = sortRoles(roles);
  const currentRole = availableRoles.includes(dbUser.currentRole)
    ? dbUser.currentRole
    : availableRoles[0];

  const resolution: UserRoleContextResolution = {
    context: {
      userId: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role,
      currentRole,
      availableRoles,
      hasBothRoles: dbUser.hasBothRoles,
      isActive: true
    },
    failure: null,
    durationMs: Date.now() - startedAt
  };
  if (resolution.durationMs > 250) {
    console.info('[user-roles] slow_resolution', {
      userId: dbUser.id,
      durationMs: resolution.durationMs,
      availableRoles: availableRoles.length
    });
  }
  return resolution;
}

export async function getCurrentUserRoleContext(): Promise<UserRoleContext | null> {
  const resolution = await resolveCurrentUserRoleContext();
  return resolution.context;
}
