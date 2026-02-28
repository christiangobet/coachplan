import Link from "next/link";
import styles from "../legal.module.css";

export const metadata = {
  title: "Terms of Service — CoachPlan",
  description: "Terms governing your use of the CoachPlan application.",
};

export default function TermsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <span className={styles.eyebrow}>Legal</span>
        <h1>Terms of Service</h1>
        <p className={styles.meta}>Last updated: February 28, 2026</p>
      </div>

      <div className={styles.body}>
        <div className={styles.highlight}>
          <p>
            By using CoachPlan you agree to these terms. Please read them carefully.
            These terms govern your access to and use of the CoachPlan application and services.
          </p>
        </div>

        <h2>1. About CoachPlan</h2>
        <p>
          CoachPlan is a training plan management application for endurance athletes and coaches.
          It allows users to upload training plans, align schedules to race dates, track workout
          completion, and optionally import activity data from Strava.
        </p>

        <h2>2. Acceptance of Terms</h2>
        <p>
          By creating an account or using CoachPlan, you confirm that you are at least 16 years
          old and agree to be bound by these Terms of Service and our{" "}
          <Link href="/privacy">Privacy Policy</Link>. If you do not agree, do not use the service.
        </p>

        <h2>3. Your Account</h2>
        <ul>
          <li>You are responsible for maintaining the security of your account credentials.</li>
          <li>You must provide accurate information when creating your account.</li>
          <li>You may not share your account with others or create accounts on behalf of others without their consent.</li>
          <li>We reserve the right to suspend or terminate accounts that violate these terms.</li>
        </ul>

        <h2>4. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use CoachPlan for any unlawful purpose or in violation of any applicable regulations</li>
          <li>Upload content you do not have the right to share (e.g. copyrighted training plans without authorisation)</li>
          <li>Attempt to access other users&apos; data or accounts</li>
          <li>Interfere with or disrupt the service or its infrastructure</li>
          <li>Reverse-engineer or attempt to extract our source code</li>
          <li>Use the service to distribute spam or malicious content</li>
        </ul>

        <h2>5. Coach and Athlete Relationships</h2>
        <p>
          CoachPlan facilitates plan sharing between coaches and athletes. When a coach links
          an athlete to a plan, the athlete can view that plan and log their workouts. Coaches
          can view completion data for linked athletes.
        </p>
        <p>
          CoachPlan is a tool — it does not regulate or mediate the coaching relationship itself.
          Any coaching advice, training decisions, or health guidance remains the responsibility
          of the coach and athlete involved.
        </p>

        <h2>6. Strava Integration</h2>
        <p>
          CoachPlan optionally integrates with Strava via their official API. By connecting
          Strava, you authorise CoachPlan to read your Strava activity data in accordance with
          Strava&apos;s own{" "}
          <a href="https://www.strava.com/legal/terms" target="_blank" rel="noopener noreferrer">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="https://www.strava.com/legal/privacy" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </a>
          . You can disconnect Strava at any time from within the app.
        </p>

        <h2>7. Data Ownership</h2>
        <p>
          Your training plans, workout logs, and personal data remain yours. You grant CoachPlan
          a limited licence to store and process your data solely to provide the service to you.
          We do not claim ownership of your content.
        </p>
        <p>
          Training plans created by third-party coaches and uploaded by you may be subject to
          their own copyright. You are responsible for having appropriate permission to upload
          and use any plan content.
        </p>

        <h2>8. AI-Assisted Features</h2>
        <p>
          CoachPlan uses AI (powered by OpenAI) to extract and structure training data from
          uploaded PDFs. AI-generated output may contain errors. You are responsible for
          reviewing extracted workout data for accuracy before relying on it.
        </p>

        <h2>9. Service Availability</h2>
        <p>
          We aim to keep CoachPlan available and reliable, but we do not guarantee uninterrupted
          access. We may modify, suspend, or discontinue features at any time, with reasonable
          notice where practicable.
        </p>

        <h2>10. Limitation of Liability</h2>
        <p>
          CoachPlan is provided &ldquo;as is&rdquo; without warranties of any kind. We are not liable for
          any indirect, incidental, or consequential damages arising from your use of the service,
          including but not limited to training outcomes, injury, or data loss.
        </p>
        <p>
          Nothing in these terms limits liability for fraud, death, or personal injury caused
          by our negligence.
        </p>

        <h2>11. Changes to These Terms</h2>
        <p>
          We may update these terms from time to time. Continued use of CoachPlan after changes
          are posted constitutes acceptance of the revised terms. We will notify users of
          material changes via email or in-app notice.
        </p>

        <h2>12. Governing Law</h2>
        <p>
          These terms are governed by the laws of Switzerland. Any disputes shall be subject
          to the exclusive jurisdiction of the courts of Switzerland.
        </p>

        <h2>13. Contact</h2>
        <p>
          Questions about these terms? Contact us at{" "}
          <a href="mailto:hello@mytrainingplan.io">hello@mytrainingplan.io</a>.
        </p>
      </div>

      <div className={styles.footer}>
        <Link href="/">← Back to CoachPlan</Link>
        <span>·</span>
        <Link href="/privacy">Privacy Policy</Link>
      </div>
    </div>
  );
}
