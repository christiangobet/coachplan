"use client";

import { SignIn, useUser } from '@clerk/nextjs';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import styles from '../../auth.module.css';

export default function SignInPage() {
  const { isSignedIn } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (isSignedIn) router.replace('/auth/resolve-role');
  }, [isSignedIn, router]);

  return (
    <main className={styles.authPage}>
      <div className={styles.authShell}>
        <section className={styles.visualPane}>
          <Image
            src="/landing/auth-scene.svg"
            alt="Athlete training visualization"
            className={styles.visualImage}
            fill
            priority
            sizes="(max-width: 980px) 100vw, 60vw"
          />
          <div className={styles.visualOverlay}>
            <div className={styles.brandRow}>
              <span className={styles.brand}>CoachPlan</span>
              <Link href="/" className={styles.homeLink}>Back home</Link>
            </div>
            <div className={styles.visualText}>
              <h1>Welcome back to your training command center.</h1>
              <p>Review today&apos;s session, keep your build on schedule, and keep momentum high.</p>
              <div className={styles.visualBullets}>
                <span>See your active plan instantly</span>
                <span>Track completion and actual metrics</span>
                <span>Stay aligned with your coach</span>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.formPane}>
          <div className={styles.formCard}>
            <h2>Sign in</h2>
            <p>Continue your current training cycle.</p>
            <SignIn
              routing="path"
              path="/sign-in"
              afterSignInUrl="/auth/resolve-role"
              redirectUrl="/auth/resolve-role"
            />
            <div className={styles.altLink}>
              New here? <Link href="/sign-up">Create an account</Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
