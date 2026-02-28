import Link from "next/link";
import styles from "../legal.module.css";

export const metadata = {
  title: "Privacy Policy — CoachPlan",
  description: "How CoachPlan collects, uses, and protects your personal data.",
};

export default function PrivacyPage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <span className={styles.eyebrow}>Legal</span>
        <h1>Privacy Policy</h1>
        <p className={styles.meta}>Last updated: February 28, 2026</p>
      </div>

      <div className={styles.body}>
        <div className={styles.highlight}>
          <p>
            CoachPlan is a training plan management tool for endurance athletes and coaches.
            This policy explains what data we collect, why we collect it, and how you can
            control it — including data we receive from Strava.
          </p>
        </div>

        <h2>1. Who We Are</h2>
        <p>
          CoachPlan (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;) operates the CoachPlan
          application at www.mytrainingplan.io. For privacy questions, contact us at{" "}
          <a href="mailto:privacy@mytrainingplan.io">privacy@mytrainingplan.io</a>.
        </p>

        <h2>2. Data We Collect</h2>
        <p>We collect the following categories of data:</p>
        <ul>
          <li>
            <strong>Account information</strong> — your name, email address, and
            authentication credentials, managed via Clerk (our authentication provider).
          </li>
          <li>
            <strong>Training plans</strong> — PDF files you upload, and the structured
            workout schedules we extract from them using AI.
          </li>
          <li>
            <strong>Workout logs</strong> — distance, duration, pace, notes, and completion
            status you record manually within CoachPlan.
          </li>
          <li>
            <strong>Strava activity data</strong> — if you connect your Strava account, we
            receive: activity type, start date/time, distance, moving time, elapsed time,
            average pace, average and max heart rate, calories, and elevation gain.
          </li>
          <li>
            <strong>Strava athlete profile</strong> — your Strava athlete ID, first name,
            last name, and username, used solely to associate your account.
          </li>
        </ul>

        <h2>3. How We Use Your Data</h2>
        <ul>
          <li>
            <strong>Training plan management</strong> — to display, align, and track your
            structured training schedule.
          </li>
          <li>
            <strong>Strava activity matching</strong> — to compare your Strava activities
            against planned sessions and allow you to import actuals into your training log.
          </li>
          <li>
            <strong>AI plan parsing</strong> — uploaded PDF plans are processed by OpenAI&apos;s
            API to extract structured workout data. We do not use your data to train AI models.
          </li>
          <li>
            <strong>Progress tracking</strong> — to display weekly and plan-level completion
            metrics visible only to you and any coach you are linked with.
          </li>
        </ul>

        <h2>4. Strava Integration</h2>
        <p>
          When you connect Strava, CoachPlan requests the{" "}
          <strong>read</strong> and <strong>activity:read_all</strong> scopes. This allows
          us to read your activity history to match sessions to your training plan.
        </p>
        <p>
          We do not write data to Strava, share your Strava data with third parties, or use
          it for any purpose other than populating your CoachPlan training log.
        </p>
        <p>
          You can disconnect Strava at any time from the Import Strava page. Disconnecting
          removes your Strava access tokens from our database. Previously imported activity
          data in your training log is retained unless you request full deletion.
        </p>

        <h2>5. Data Sharing</h2>
        <p>We share data with the following service providers only to the extent necessary to operate CoachPlan:</p>
        <ul>
          <li><strong>Clerk</strong> — authentication and user account management</li>
          <li><strong>OpenAI</strong> — AI extraction of workout data from uploaded PDFs</li>
          <li><strong>Strava</strong> — activity data via OAuth (only when you connect)</li>
          <li><strong>Vercel</strong> — application hosting and infrastructure</li>
          <li><strong>Neon / PostgreSQL</strong> — encrypted database storage</li>
        </ul>
        <p>We do not sell your personal data.</p>

        <h2>6. Data Retention</h2>
        <p>
          We retain your data for as long as your account is active. If you request account
          deletion, we will remove your personal data and training records within 30 days.
          Some anonymised aggregate data may be retained for operational purposes.
        </p>

        <h2>7. Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
          <li>Access the personal data we hold about you</li>
          <li>Request correction of inaccurate data</li>
          <li>Request deletion of your account and all associated data</li>
          <li>Disconnect third-party integrations (Strava) at any time</li>
          <li>Object to or restrict certain data processing</li>
        </ul>
        <p>
          To exercise any of these rights, email{" "}
          <a href="mailto:privacy@mytrainingplan.io">privacy@mytrainingplan.io</a>.
        </p>

        <h2>8. Security</h2>
        <p>
          We use industry-standard security measures including encrypted connections (TLS),
          encrypted token storage, and access controls to protect your data. Strava OAuth
          tokens are stored encrypted and used only for API requests on your behalf.
        </p>

        <h2>9. Cookies</h2>
        <p>
          CoachPlan uses cookies and similar technologies for authentication (managed by
          Clerk) and session management. We do not use advertising or tracking cookies.
        </p>

        <h2>10. Changes to This Policy</h2>
        <p>
          We may update this policy from time to time. Significant changes will be
          communicated via email or an in-app notice. The &ldquo;Last updated&rdquo; date at the top
          reflects the most recent revision.
        </p>

        <h2>11. Contact</h2>
        <p>
          Questions about this policy? Contact us at{" "}
          <a href="mailto:privacy@mytrainingplan.io">privacy@mytrainingplan.io</a>.
        </p>
      </div>

      <div className={styles.footer}>
        <Link href="/">← Back to CoachPlan</Link>
        <span>·</span>
        <Link href="/terms">Terms of Service</Link>
      </div>
    </div>
  );
}
