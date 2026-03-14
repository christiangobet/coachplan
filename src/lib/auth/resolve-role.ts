import { UserRole } from '@prisma/client';
import type { UserRoleContext } from '@/lib/user-roles';

export const MAX_RESOLVE_ROLE_RETRIES = 3;
const ROLE_HOME: Record<UserRole, string> = {
  ATHLETE: '/dashboard',
  COACH: '/coach',
  ADMIN: '/admin'
};

export type ResolveRoleFailure =
  | 'signed_out'
  | 'auth_unavailable'
  | 'sync_failed'
  | 'unknown';

export type ResolveRoleAction =
  | {
      type: 'retry';
      href: string;
      reason: Exclude<ResolveRoleFailure, 'signed_out'>;
    }
  | {
      type: 'redirect';
      href: string;
      reason: 'signed_out' | 'inactive' | 'multi_role_current' | 'multi_role_fallback' | 'single_role_current';
    }
  | {
      type: 'update-and-redirect';
      href: string;
      role: UserRole;
      reason: 'single_role_sync';
    }
  | {
      type: 'render-recovery';
      title: string;
      message: string;
      retryHref: string;
      signInHref: string;
      reason: Exclude<ResolveRoleFailure, 'signed_out'>;
    };

type DecideResolveRoleActionArgs = {
  roleContext: UserRoleContext | null;
  userId: string | null;
  retryCount: number;
  failure: ResolveRoleFailure | null;
};

function buildRetryHref(nextRetryCount: number) {
  return `/auth/resolve-role?retry=${nextRetryCount}`;
}

function getRoleHomePath(role: UserRole) {
  return ROLE_HOME[role];
}

export function decideResolveRoleAction(args: DecideResolveRoleActionArgs): ResolveRoleAction {
  const retryCount = Number.isFinite(args.retryCount) ? Math.max(0, args.retryCount) : 0;
  const failure = args.failure ?? 'unknown';

  if (!args.roleContext) {
    if (!args.userId) {
      return {
        type: 'redirect',
        href: '/sign-in',
        reason: 'signed_out'
      };
    }

    if (retryCount < MAX_RESOLVE_ROLE_RETRIES) {
      return {
        type: 'retry',
        href: buildRetryHref(retryCount + 1),
        reason: failure === 'signed_out' ? 'unknown' : failure
      };
    }

    return {
      type: 'render-recovery',
      title: 'We are still setting up your account',
      message:
        'Your session is active, but role setup has not completed yet. You can try again now or return to sign in.',
      retryHref: '/auth/resolve-role',
      signInHref: '/sign-in',
      reason: failure === 'signed_out' ? 'unknown' : failure
    };
  }

  if (!args.roleContext.isActive) {
    return {
      type: 'redirect',
      href: '/sign-in',
      reason: 'inactive'
    };
  }

  if (args.roleContext.availableRoles.length > 1) {
    if (args.roleContext.currentRole && args.roleContext.availableRoles.includes(args.roleContext.currentRole)) {
      return {
        type: 'redirect',
        href: getRoleHomePath(args.roleContext.currentRole),
        reason: 'multi_role_current'
      };
    }

    return {
      type: 'redirect',
      href: getRoleHomePath(args.roleContext.availableRoles[0]),
      reason: 'multi_role_fallback'
    };
  }

  const selectedRole = args.roleContext.availableRoles[0] || args.roleContext.currentRole;
  if (args.roleContext.currentRole !== selectedRole) {
    return {
      type: 'update-and-redirect',
      href: getRoleHomePath(selectedRole),
      role: selectedRole,
      reason: 'single_role_sync'
    };
  }

  return {
    type: 'redirect',
    href: getRoleHomePath(selectedRole),
    reason: 'single_role_current'
  };
}
