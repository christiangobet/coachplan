"use client";

import { SignUp, useUser } from '@clerk/nextjs';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import styles from '../../auth.module.css';

export default function SignUpPage() {
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
              <h1>Build your season plan with structure from day one.</h1>
              <p>Import your plan, set race day, and start tracking each workout with confidence.</p>
              <div className={styles.visualBullets}>
                <span>Import PDF training plans</span>
                <span>Align your build to race day</span>
                <span>Track consistency every week</span>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.formPane}>
          <div className={styles.formCard}>
            <h2>Create account</h2>
            <p>Start your next cycle with CoachPlan.</p>
            <SignUp
              routing="path"
              path="/sign-up"
              afterSignUpUrl="/auth/resolve-role"
              redirectUrl="/auth/resolve-role"
            />
            <div className={styles.altLink}>
              Already registered? <Link href="/sign-in">Sign in</Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
