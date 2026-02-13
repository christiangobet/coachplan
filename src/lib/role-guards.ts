import { UserRole } from '@prisma/client';
import { redirect } from 'next/navigation';
import { getCurrentUserRoleContext, getRoleHomePath, UserRoleContext } from '@/lib/user-roles';

type ApiRoleCheckResult =
  | { ok: true; context: UserRoleContext }
  | { ok: false; status: 401 | 403; error: string };

export async function requireRolePage(requiredRole: UserRole): Promise<UserRoleContext> {
  const context = await getCurrentUserRoleContext();
  if (!context) redirect('/sign-in');
  if (!context.isActive) redirect('/sign-in');

  if (!context.availableRoles.includes(requiredRole)) {
    redirect(getRoleHomePath(context.currentRole));
  }

  if (context.currentRole !== requiredRole) {
    redirect('/select-role');
  }

  return context;
}

export async function requireRoleApi(requiredRole: UserRole): Promise<ApiRoleCheckResult> {
  const context = await getCurrentUserRoleContext();
  if (!context) return { ok: false, status: 401, error: 'Unauthorized' };
  if (!context.isActive) return { ok: false, status: 403, error: 'Account is deactivated' };

  if (!context.availableRoles.includes(requiredRole)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  if (context.currentRole !== requiredRole) {
    return {
      ok: false,
      status: 403,
      error: `Switch role to ${requiredRole} to access this resource`
    };
  }

  return { ok: true, context };
}
