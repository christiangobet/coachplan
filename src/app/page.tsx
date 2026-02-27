import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import Image from "next/image";
import styles from "./page.module.css";

const featureCards = [
  {
    title: "Upload & Parse",
    text: "Drop in your PDF plan and convert it into clean week/day workouts in minutes.",
    image: "/landing/upload-parse.svg"
  },
  {
    title: "Race-Day Alignment",
    text: "Shift your full schedule so peak week lands exactly on race weekend.",
    image: "/landing/race-alignment.svg"
  },
  {
    title: "Coach Sync",
    text: "Share plans, track completion, and keep athlete feedback in one workflow.",
    image: "/landing/coach-sync.svg"
  }
];

export default async function Home() {
  let user = null;
  try {
    user = await currentUser();
  } catch (error) {
    console.error('Failed to resolve current user on landing page', error);
  }

  if (user) {
    redirect("/auth/resolve-role");
  }

  return (
    <main className={styles.landing}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>Built for athletes and coaches</span>
          <h1>Training plans that feel as sharp as race day.</h1>
          <p>
            CoachPlan turns static PDFs into structured sessions, aligns your build to the big event,
            and gives you one place to track execution week by week.
          </p>
          <div className={styles.ctas}>
            <Link className={styles.ctaPrimary} href="/sign-in">Sign in</Link>
            <Link className={styles.ctaSecondary} href="/sign-up">Create account</Link>
          </div>
          <div className={styles.metrics}>
            <div className={styles.metric}>
              <strong>PDF to schedule</strong>
              <span>AI extraction + structure</span>
            </div>
            <div className={styles.metric}>
              <strong>Race-ready timing</strong>
              <span>Automatic week alignment</span>
            </div>
            <div className={styles.metric}>
              <strong>Daily execution</strong>
              <span>Complete and log actuals</span>
            </div>
          </div>
        </div>
        <div className={styles.heroVisual}>
          <Image
            src="/landing/hero-race-group.jpg"
            alt="Group of runners racing in a city marathon"
            className={styles.heroImage}
            fill
            sizes="(max-width: 1080px) 100vw, 460px"
            priority
          />
          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeLabel}>Active Plan</span>
            <strong>City Marathon Build</strong>
            <span>Race date: Oct 19</span>
          </div>
        </div>
      </section>

      <section className={styles.features}>
        <div className={styles.sectionHead}>
          <h2>Everything in one training command center</h2>
          <p>From plan setup to daily check-off, keep the whole season visible.</p>
        </div>
        <div className={styles.featureGrid}>
          {featureCards.map((card) => (
            <article key={card.title} className={styles.featureCard}>
              <Image
                src={card.image}
                alt={`${card.title} illustration`}
                className={styles.featureImage}
                width={800}
                height={520}
              />
              <h3>{card.title}</h3>
              <p>{card.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.bottomCta}>
        <h2>Start with your next training cycle today</h2>
        <p>Import a plan, set your race date, and make every workout count.</p>
        <div className={styles.ctas}>
          <Link className={styles.ctaPrimary} href="/sign-up">Create account</Link>
          <Link className={styles.ctaSecondary} href="/sign-in">Sign in</Link>
        </div>
      </section>
    </main>
  );
}
