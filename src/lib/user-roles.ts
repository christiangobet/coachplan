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

export async function getCurrentUserRoleContext(): Promise<UserRoleContext | null> {
  const authUser = await currentUser();
  if (!authUser) return null;

  const dbUser = await ensureUserFromAuth(authUser, {
    defaultRole: 'ATHLETE',
    defaultCurrentRole: 'ATHLETE'
  });

  if (!dbUser.isActive) {
    return {
      userId: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role,
      currentRole: dbUser.currentRole,
      availableRoles: [dbUser.currentRole],
      hasBothRoles: dbUser.hasBothRoles,
      isActive: false
    };
  }

  const roles = new Set<UserRole>([dbUser.role, dbUser.currentRole]);

  if (dbUser.hasBothRoles && !(dbUser.role === 'ADMIN' && dbUser.currentRole === 'ADMIN')) {
    roles.add('ATHLETE');
    roles.add('COACH');
  }

  const inferred = await inferRolesFromData(dbUser.id);
  inferred.forEach((role) => roles.add(role));

  if (roles.size === 0) roles.add('ATHLETE');

  const availableRoles = sortRoles(roles);
  const currentRole = availableRoles.includes(dbUser.currentRole)
    ? dbUser.currentRole
    : availableRoles[0];

  return {
    userId: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    role: dbUser.role,
    currentRole,
    availableRoles,
    hasBothRoles: dbUser.hasBothRoles,
    isActive: true
  };
}
