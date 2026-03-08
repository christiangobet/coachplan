import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserRoleContext, getRoleHomePath } from '@/lib/user-roles';

type ResolveRoleSearchParams = {
  retry?: string;
};

export default async function ResolveRolePage({
  searchParams
}: {
  searchParams?: Promise<ResolveRoleSearchParams>;
}) {
  const params = (await searchParams) || {};
  const retryCountRaw = Number(params.retry || '0');
  const retryCount = Number.isFinite(retryCountRaw) ? retryCountRaw : 0;
  const roleContext = await getCurrentUserRoleContext();
  if (!roleContext) {
    const { userId } = await auth();
    if (userId && retryCount < 3) {
      redirect(`/auth/resolve-role?retry=${retryCount + 1}`);
    }
    redirect('/sign-in');
  }
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
