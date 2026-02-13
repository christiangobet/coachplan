import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { ensureUserFromAuth } from '@/lib/user-sync';

export type AdminAccess =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: 'unauthorized' | 'forbidden' };

export type AdminStats = {
  users: {
    total: number;
    active: number;
    inactive: number;
    athletes: number;
    coaches: number;
    admins: number;
    joinedLast7Days: number;
  };
  plans: {
    total: number;
    active: number;
    draft: number;
    templates: number;
    createdLast7Days: number;
  };
  workouts: {
    total: number;
    completed: number;
    completionRate: number;
  };
};

export async function requireAdminAccess(): Promise<AdminAccess> {
  const authUser = await currentUser();
  if (!authUser) return { ok: false, reason: 'unauthorized' };

  const dbUser = await ensureUserFromAuth(authUser, {
    defaultRole: 'ATHLETE',
    defaultCurrentRole: 'ATHLETE'
  });

  if (!dbUser) return { ok: false, reason: 'forbidden' };
  if (!dbUser.isActive) return { ok: false, reason: 'forbidden' };

  const isAdmin = dbUser.role === 'ADMIN' || dbUser.currentRole === 'ADMIN';
  if (!isAdmin) return { ok: false, reason: 'forbidden' };

  return { ok: true, userId: dbUser.id, email: dbUser.email };
}

export async function getAdminStats(): Promise<AdminStats> {
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const [
    totalUsers,
    activeUsers,
    inactiveUsers,
    totalAthletes,
    totalCoaches,
    totalAdmins,
    usersLast7Days,
    totalPlans,
    activePlans,
    draftPlans,
    templatePlans,
    plansLast7Days,
    totalActivities,
    completedActivities
  ] = await prisma.$transaction([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.user.count({ where: { isActive: false } }),
    prisma.user.count({ where: { role: 'ATHLETE' } }),
    prisma.user.count({ where: { role: 'COACH' } }),
    prisma.user.count({ where: { role: 'ADMIN' } }),
    prisma.user.count({ where: { createdAt: { gte: since } } }),
    prisma.trainingPlan.count(),
    prisma.trainingPlan.count({ where: { status: 'ACTIVE' } }),
    prisma.trainingPlan.count({ where: { status: 'DRAFT' } }),
    prisma.trainingPlan.count({ where: { isTemplate: true } }),
    prisma.trainingPlan.count({ where: { createdAt: { gte: since } } }),
    prisma.planActivity.count(),
    prisma.planActivity.count({ where: { completed: true } })
  ]);

  const completionRate =
    totalActivities > 0 ? Math.round((completedActivities / totalActivities) * 100) : 0;

  return {
    users: {
      total: totalUsers,
      active: activeUsers,
      inactive: inactiveUsers,
      athletes: totalAthletes,
      coaches: totalCoaches,
      admins: totalAdmins,
      joinedLast7Days: usersLast7Days
    },
    plans: {
      total: totalPlans,
      active: activePlans,
      draft: draftPlans,
      templates: templatePlans,
      createdLast7Days: plansLast7Days
    },
    workouts: {
      total: totalActivities,
      completed: completedActivities,
      completionRate
    }
  };
}
