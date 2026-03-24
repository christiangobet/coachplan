# Push Notification Preferences — Time Picker & Same-Day Option

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users pick the hour for their "evening before" push reminder and optionally enable a same-morning reminder, stored on the User model and respected by an hourly cron.

**Architecture:** Add 3 fields to `User` (`notifPrevDayHour Int @default(18)`, `notifSameDayEnabled Boolean @default(false)`, `notifSameDayHour Int @default(7)`). Extend `/api/me` PUT to persist them. Rewrite `NotificationToggle` to load prefs, show hour selectors and an encouraging message when subscribed, and save on change. Convert the cron from a fixed nightly run to an hourly run that filters users whose preferred hour matches the current UTC hour.

**Tech Stack:** Prisma migration, Next.js App Router API routes, React client component, web-push, Vercel Cron (vercel.json)

---

## File Map

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add 3 fields to `User` model |
| `prisma/migrations/…` | Auto-generated migration |
| `src/app/api/me/route.ts` | Accept 3 new fields in PUT body |
| `src/components/NotificationToggle.tsx` | Full rewrite — load prefs, time pickers, save, encouraging message |
| `src/app/api/cron/push-reminders/route.ts` | Hourly logic: match current UTC hour to per-user prefs, add same-day path |
| `vercel.json` | Change schedule `0 18 * * *` → `0 * * * *` |

---

## Task 1: Schema — add 3 notification-preference fields to User

**Files:**
- Modify: `prisma/schema.prisma` (User model)

- [ ] **Step 1: Add fields after `createdAt` in the User model**

In `prisma/schema.prisma`, find the `User` model. After the `createdAt` field and before the relation fields, insert:

```prisma
  notifPrevDayHour    Int     @default(18)
  notifSameDayEnabled Boolean @default(false)
  notifSameDayHour    Int     @default(7)
```

The surrounding context should look like:
```prisma
  createdAt    DateTime @default(now())

  notifPrevDayHour    Int     @default(18)
  notifSameDayEnabled Boolean @default(false)
  notifSameDayHour    Int     @default(7)

  athleteLinks CoachAthlete[] @relation("Athlete")
```

- [ ] **Step 2: Run migration**

```bash
cd /Users/christiangobet/CODEX/coachplan
npx prisma migrate dev --name add-notif-prefs
```

Expected: migration file created, client regenerated, no errors.

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck 2>&1 | head -20
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add notifPrevDayHour/SameDayEnabled/SameDayHour to User"
```

---

## Task 2: API — accept new preference fields in PUT /api/me

**Files:**
- Modify: `src/app/api/me/route.ts`

The existing PUT handler at `src/app/api/me/route.ts:25-36` updates a fixed set of fields. Add the 3 new ones.

- [ ] **Step 1: Extend the prisma update data block**

In the `PUT` handler, extend the `data` object passed to `prisma.user.update`:

```ts
    data: {
      name: body.name,
      units: body.units,
      paceTargets: body.paceTargets,
      // Only set null when goalRaceDate is explicitly provided and falsy — not when absent
      goalRaceDate: body.goalRaceDate !== undefined
        ? (body.goalRaceDate ? new Date(body.goalRaceDate) : null)
        : undefined,
      role: body.role || undefined,
      currentRole: body.role || undefined,
      hasBothRoles: body.hasBothRoles ?? undefined,
      notifPrevDayHour:    typeof body.notifPrevDayHour === 'number'    ? body.notifPrevDayHour    : undefined,
      notifSameDayEnabled: typeof body.notifSameDayEnabled === 'boolean' ? body.notifSameDayEnabled : undefined,
      notifSameDayHour:    typeof body.notifSameDayHour === 'number'    ? body.notifSameDayHour    : undefined,
    }
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck 2>&1 | grep "me/route"
```

Expected: no output (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/me/route.ts
git commit -m "feat: expose notif pref fields in PUT /api/me"
```

---

## Task 3: NotificationToggle — time pickers + save + encouraging message

**Files:**
- Modify: `src/components/NotificationToggle.tsx` (full rewrite)

The component needs to:
1. Load user prefs from `GET /api/me` when subscribed
2. Show hour picker for prev-day time (range 5–23, displayed in 12-hour UTC)
3. Show same-day toggle + conditionally a second hour picker
4. Save prefs via `PUT /api/me` immediately on change
5. Show a random encouraging message when subscribed

- [ ] **Step 1: Replace the entire file with the new component**

```tsx
"use client";
import { useState, useEffect } from "react";

type State = "unsupported" | "denied" | "prompt" | "granted" | "loading";

type Prefs = {
  notifPrevDayHour: number;
  notifSameDayEnabled: boolean;
  notifSameDayHour: number;
};

const HOUR_OPTIONS = Array.from({ length: 19 }, (_, i) => i + 5); // 5..23

function fmtHour(h: number) {
  if (h === 0) return "12:00 AM";
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return "12:00 PM";
  return `${h - 12}:00 PM`;
}

const QUOTES = [
  "Consistency is everything. Your future self will thank you.",
  "Reminders help athletes show up even on tired days. You've got this.",
  "Small daily commitments compound into big race-day results. Keep going!",
  "You're one of the athletes who actually follows through. That's rare.",
  "Champions aren't made on race day — they're made in the daily grind.",
];

export default function NotificationToggle() {
  const [state, setState] = useState<State>("loading");
  const [subscribed, setSubscribed] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>({
    notifPrevDayHour: 18,
    notifSameDayEnabled: false,
    notifSameDayHour: 7,
  });
  const [saving, setSaving] = useState(false);
  const [quote] = useState(
    () => QUOTES[Math.floor(Math.random() * QUOTES.length)]
  );

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setState("unsupported");
      return;
    }
    setState(Notification.permission as State);
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => setSubscribed(!!sub))
    );
  }, []);

  // Load prefs from server once subscribed
  useEffect(() => {
    if (!subscribed) return;
    fetch("/api/me")
      .then((r) => r.json())
      .then((u) => {
        if (typeof u.notifPrevDayHour === "number") {
          setPrefs({
            notifPrevDayHour: u.notifPrevDayHour,
            notifSameDayEnabled: !!u.notifSameDayEnabled,
            notifSameDayHour: u.notifSameDayHour ?? 7,
          });
        }
      })
      .catch(() => {});
  }, [subscribed]);

  async function savePrefs(next: Prefs) {
    setPrefs(next);
    setSaving(true);
    await fetch("/api/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => {});
    setSaving(false);
  }

  async function subscribe() {
    setState("loading");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState("denied"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setSubscribed(true);
      setState("granted");
    } catch {
      setState(Notification.permission as State);
    }
  }

  async function unsubscribe() {
    setState("loading");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    setSubscribed(false);
    setState("granted");
  }

  if (state === "unsupported") return null;
  if (state === "loading")
    return <button className="dash-btn-ghost" disabled>Notifications…</button>;
  if (state === "denied")
    return (
      <p style={{ fontSize: 13, color: "var(--d-muted)" }}>
        Notifications blocked — enable in iOS Settings.
      </p>
    );

  if (!subscribed) {
    return (
      <button className="dash-btn-ghost" onClick={subscribe}>
        Enable workout reminders
      </button>
    );
  }

  const selectStyle: React.CSSProperties = {
    fontSize: 13,
    padding: "2px 6px",
    borderRadius: 6,
    border: "1px solid var(--d-border)",
    background: "var(--d-raised)",
    color: "var(--d-text)",
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Encouraging message */}
      <p style={{ fontSize: 13, color: "var(--d-orange)", fontStyle: "italic", margin: 0 }}>
        {quote}
      </p>

      {/* Evening (prev-day) reminder */}
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <span style={{ color: "var(--d-text)", flex: 1 }}>Evening reminder (night before)</span>
        <select
          value={prefs.notifPrevDayHour}
          onChange={(e) =>
            savePrefs({ ...prefs, notifPrevDayHour: Number(e.target.value) })
          }
          style={selectStyle}
        >
          {HOUR_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {fmtHour(h)} UTC
            </option>
          ))}
        </select>
      </label>

      {/* Same-day toggle */}
      <label
        style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}
      >
        <input
          type="checkbox"
          checked={prefs.notifSameDayEnabled}
          onChange={(e) =>
            savePrefs({ ...prefs, notifSameDayEnabled: e.target.checked })
          }
          style={{ accentColor: "var(--d-orange)", width: 16, height: 16, flexShrink: 0 }}
        />
        <span style={{ color: "var(--d-text)" }}>Morning reminder (day of workout)</span>
      </label>

      {/* Same-day hour picker — only shown when enabled */}
      {prefs.notifSameDayEnabled && (
        <label
          style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, paddingLeft: 24 }}
        >
          <span style={{ color: "var(--d-text-mid)", flex: 1 }}>Morning time</span>
          <select
            value={prefs.notifSameDayHour}
            onChange={(e) =>
              savePrefs({ ...prefs, notifSameDayHour: Number(e.target.value) })
            }
            style={selectStyle}
          >
            {HOUR_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {fmtHour(h)} UTC
              </option>
            ))}
          </select>
        </label>
      )}

      {saving && (
        <p style={{ fontSize: 12, color: "var(--d-muted)", margin: 0 }}>Saving…</p>
      )}

      <button
        className="dash-btn-ghost"
        style={{ fontSize: 12, color: "var(--d-muted)", alignSelf: "start" }}
        onClick={unsubscribe}
      >
        Disable reminders
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck 2>&1 | grep "NotificationToggle"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/NotificationToggle.tsx
git commit -m "feat: add time picker, same-day toggle, and encouraging message to NotificationToggle"
```

---

## Task 4: Cron — hourly, respects per-user prefs + same-day path

**Files:**
- Modify: `src/app/api/cron/push-reminders/route.ts`

The cron runs every hour. On each invocation it:
1. Gets the current UTC hour
2. Queries plan weeks active **tomorrow**, collects users whose `notifPrevDayHour == currentHour` → sends "tomorrow's training" notification
3. Queries plan weeks active **today**, collects users whose `notifSameDayEnabled == true && notifSameDayHour == currentHour` → sends "today's training" notification
4. Auto-deletes stale subscriptions on send failure

- [ ] **Step 1: Replace the entire cron route file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushNotification } from "@/lib/web-push";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const currentHour = new Date().getUTCHours();
  let sent = 0;

  // ── Prev-day reminders ────────────────────────────────────────────────────
  {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const dayStart = new Date(
      Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate())
    );
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const tomorrowDow = dayStart.getUTCDay();
    const tomorrowLabel = dayStart.toISOString().slice(0, 10);

    const weeks = await prisma.planWeek.findMany({
      where: {
        startDate: { lte: dayEnd },
        endDate: { gt: dayStart },
        plan: { status: "ACTIVE" },
      },
      include: {
        days: {
          where: { dayOfWeek: tomorrowDow, activities: { some: {} } },
          include: { activities: true },
        },
        plan: {
          include: {
            owner:   { include: { pushSubscriptions: true } },
            athlete: { include: { pushSubscriptions: true } },
          },
        },
      },
    });

    for (const week of weeks) {
      for (const day of week.days) {
        const count = day.activities.length;
        // Deduplicate: a solo athlete may be both owner and athlete on a plan
        const seen = new Map<string, typeof week.plan.owner>([]);
        for (const u of [week.plan.owner, week.plan.athlete]) {
          if (u) seen.set(u.id, u);
        }
        const uniqueUsers = [...seen.values()];
        for (const user of uniqueUsers) {
          if (user.notifPrevDayHour !== currentHour) continue;
          const payload = {
            title: "Tomorrow's Training",
            body: `You have ${count} workout${count === 1 ? "" : "s"} scheduled tomorrow. Tap to view.`,
            url: `/calendar?date=${tomorrowLabel}`,
          };
          for (const sub of user.pushSubscriptions) {
            try {
              await sendPushNotification(sub, payload);
              sent++;
            } catch {
              await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
            }
          }
        }
      }
    }
  }

  // ── Same-day reminders ────────────────────────────────────────────────────
  {
    const today = new Date();
    const dayStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    );
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const todayDow = dayStart.getUTCDay();
    const todayLabel = dayStart.toISOString().slice(0, 10);

    const weeks = await prisma.planWeek.findMany({
      where: {
        startDate: { lte: dayEnd },
        endDate: { gt: dayStart },
        plan: { status: "ACTIVE" },
      },
      include: {
        days: {
          where: { dayOfWeek: todayDow, activities: { some: {} } },
          include: { activities: true },
        },
        plan: {
          include: {
            owner:   { include: { pushSubscriptions: true } },
            athlete: { include: { pushSubscriptions: true } },
          },
        },
      },
    });

    for (const week of weeks) {
      for (const day of week.days) {
        const count = day.activities.length;
        // Deduplicate: a solo athlete may be both owner and athlete on a plan
        const seen = new Map<string, typeof week.plan.owner>([]);
        for (const u of [week.plan.owner, week.plan.athlete]) {
          if (u) seen.set(u.id, u);
        }
        const uniqueUsers = [...seen.values()];
        for (const user of uniqueUsers) {
          if (!user.notifSameDayEnabled || user.notifSameDayHour !== currentHour) continue;
          const payload = {
            title: "Today's Training",
            body: `You have ${count} workout${count === 1 ? "" : "s"} today. Let's go!`,
            url: `/calendar?date=${todayLabel}`,
          };
          for (const sub of user.pushSubscriptions) {
            try {
              await sendPushNotification(sub, payload);
              sent++;
            } catch {
              await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
            }
          }
        }
      }
    }
  }

  return NextResponse.json({ ok: true, sent, hour: currentHour });
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck 2>&1 | grep "push-reminders"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/push-reminders/route.ts
git commit -m "feat: hourly cron respects per-user notif hour prefs + same-day option"
```

---

## Task 5: vercel.json — switch to hourly schedule

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Change schedule from nightly to hourly**

In `vercel.json`, change `"schedule": "0 18 * * *"` to `"schedule": "0 * * * *"`.

Final file:
```json
{
  "buildCommand": "prisma generate && next build",
  "crons": [
    {
      "path": "/api/cron/push-reminders",
      "schedule": "0 * * * *"
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "chore: switch push-reminders cron to hourly schedule"
```

---

## Task 6: Verify

- [ ] **Step 1: Full typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 2: Lint**

```bash
npm run lint 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 3: Screenshot the profile page**

Take a screenshot of `http://localhost:3001/profile` with notifications already enabled to verify the new UI (time picker, same-day toggle, encouraging quote, "Disable reminders" button) renders correctly.
