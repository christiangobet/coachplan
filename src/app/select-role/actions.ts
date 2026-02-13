'use server';

import { UserRole } from '@prisma/client';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getCurrentUserRoleContext, getRoleHomePath } from '@/lib/user-roles';

const ACCEPTED_ROLES: UserRole[] = ['ATHLETE', 'COACH', 'ADMIN'];

function isUserRole(value: string): value is UserRole {
  return ACCEPTED_ROLES.includes(value as UserRole);
}

export async function chooseRoleAction(formData: FormData) {
  const requested = String(formData.get('role') || '');
  if (!isUserRole(requested)) {
    redirect('/select-role');
  }

  const roleContext = await getCurrentUserRoleContext();
  if (!roleContext) {
    redirect('/sign-in');
  }
  if (!roleContext.isActive) {
    redirect('/sign-in');
  }

  if (!roleContext.availableRoles.includes(requested)) {
    redirect('/select-role');
  }

  await prisma.user.update({
    where: { id: roleContext.userId },
    data: { currentRole: requested }
  });

  redirect(getRoleHomePath(requested));
}
