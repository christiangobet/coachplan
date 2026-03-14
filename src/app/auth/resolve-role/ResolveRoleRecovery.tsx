'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from '../../auth.module.css';

type Props = {
  retryHref: string;
  signInHref: string;
};

export default function ResolveRoleRecovery({ retryHref, signInHref }: Props) {
  const router = useRouter();
  const [showManualActions, setShowManualActions] = useState(false);

  useEffect(() => {
    const retryTimer = window.setTimeout(() => {
      router.replace(retryHref);
      router.refresh();
    }, 350);
    const revealTimer = window.setTimeout(() => {
      setShowManualActions(true);
    }, 1800);

    return () => {
      window.clearTimeout(retryTimer);
      window.clearTimeout(revealTimer);
    };
  }, [retryHref, router]);

  return (
    <>
      <h2>Finishing your account setup…</h2>
      <p>We are doing one last role check before sending you into the app.</p>
      {showManualActions ? (
        <>
          <div className={styles.resolveRoleActions}>
            <a className={styles.resolveRolePrimary} href={retryHref}>Try again</a>
            <a className={styles.resolveRoleSecondary} href={signInHref}>Go to sign in</a>
          </div>
          <p className={styles.resolveRoleMeta}>
            If this keeps happening, the role lookup is likely delayed rather than your account being missing.
          </p>
        </>
      ) : (
        <p className={styles.resolveRoleMeta}>This usually takes less than a second.</p>
      )}
    </>
  );
}
