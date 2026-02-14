import { UserRole, Prisma, User } from '@prisma/client';
import { prisma } from '@/lib/prisma';

type AuthLikeUser = {
  id: string;
  primaryEmailAddress?: { emailAddress?: string | null } | null;
  fullName?: string | null;
  firstName?: string | null;
};

type EnsureUserOptions = {
  defaultRole?: UserRole;
  defaultCurrentRole?: UserRole;
};

function normalizeEmail(authUser: AuthLikeUser): string {
  const raw = authUser.primaryEmailAddress?.emailAddress?.trim().toLowerCase() || '';
  if (raw) return raw;
  return `${authUser.id}@local.user`;
}

function normalizeName(authUser: AuthLikeUser): string {
  return authUser.fullName?.trim() || authUser.firstName?.trim() || 'User';
}

export async function ensureUserFromAuth(
  authUser: AuthLikeUser,
  options?: EnsureUserOptions
): Promise<User> {
  const normalizedEmail = normalizeEmail(authUser);
  const normalizedName = normalizeName(authUser);
  const defaultRole = options?.defaultRole || 'ATHLETE';
  const defaultCurrentRole = options?.defaultCurrentRole || defaultRole;

  return prisma.$transaction(async (tx) => {
    const byId = await tx.user.findUnique({ where: { id: authUser.id } });
    if (byId) {
      const updateData: Prisma.UserUpdateInput = {};
      if (byId.name !== normalizedName) {
        updateData.name = normalizedName;
      }

      if (byId.email !== normalizedEmail) {
        const conflicting = await tx.user.findUnique({
          where: { email: normalizedEmail },
          select: { id: true }
        });
        if (!conflicting || conflicting.id === byId.id) {
          updateData.email = normalizedEmail;
        }
      }

      if (Object.keys(updateData).length === 0) return byId;
      return tx.user.update({
        where: { id: byId.id },
        data: updateData
      });
    }

    const byEmail = await tx.user.findUnique({ where: { email: normalizedEmail } });
    if (byEmail) {
      // Keep stable DB user id to avoid FK breakage when user already has linked records.
      // We treat matching email as the same app user and refresh profile fields only.
      const updateData: Prisma.UserUpdateInput = {};
      if (byEmail.name !== normalizedName) {
        updateData.name = normalizedName;
      }

      if (byEmail.email !== normalizedEmail) {
        updateData.email = normalizedEmail;
      }

      if (Object.keys(updateData).length === 0) return byEmail;
      return tx.user.update({
        where: { id: byEmail.id },
        data: updateData
      });
    }

    return tx.user.create({
      data: {
        id: authUser.id,
        email: normalizedEmail,
        name: normalizedName,
        role: defaultRole,
        currentRole: defaultCurrentRole
      }
    });
  });
}
