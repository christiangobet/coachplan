import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getCurrentUserRoleContext, getRoleHomePath } from '@/lib/user-roles';

export default async function ResolveRolePage() {
  const roleContext = await getCurrentUserRoleContext();
  if (!roleContext) redirect('/sign-in');
  if (!roleContext.isActive) redirect('/sign-in');

  if (roleContext.availableRoles.length > 1) {
    if (roleContext.currentRole && roleContext.availableRoles.includes(roleContext.currentRole)) {
      redirect(getRoleHomePath(roleContext.currentRole));
    }
    redirect(getRoleHomePath(roleContext.availableRoles[0]));
  }

  const selectedRole = roleContext.availableRoles[0] || roleContext.currentRole;

  if (roleContext.currentRole !== selectedRole) {
    await prisma.user.update({
      where: { id: roleContext.userId },
      data: { currentRole: selectedRole }
    });
  }

  redirect(getRoleHomePath(selectedRole));
}
