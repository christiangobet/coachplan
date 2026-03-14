import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { resolveCurrentUserRoleContext } from '@/lib/user-roles';
import { decideResolveRoleAction } from '@/lib/auth/resolve-role';
import styles from '../../auth.module.css';
import ResolveRoleRecovery from './ResolveRoleRecovery';

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
  const [{ userId }, resolution] = await Promise.all([auth(), resolveCurrentUserRoleContext()]);
  const action = decideResolveRoleAction({
    roleContext: resolution.context,
    userId,
    retryCount,
    failure: resolution.failure
  });

  console.info('[resolve-role]', {
    retryCount,
    authUserPresent: Boolean(userId),
    failure: resolution.failure,
    durationMs: resolution.durationMs,
    action: action.type,
    destination:
      action.type === 'redirect' || action.type === 'retry' || action.type === 'update-and-redirect'
        ? action.href
        : undefined,
    reason: action.reason
  });

  if (action.type === 'retry' || action.type === 'redirect') {
    redirect(action.href);
  }

  if (action.type === 'update-and-redirect') {
    await prisma.user.update({
      where: { id: resolution.context!.userId },
      data: { currentRole: action.role }
    });
    redirect(action.href);
  }

  return (
    <main className={styles.authPage}>
      <div className={styles.authShell}>
        <section className={styles.formPane}>
          <div className={styles.formCard}>
            <ResolveRoleRecovery
              retryHref={action.retryHref}
              signInHref={action.signInHref}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
