# Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow athletes to receive workout reminder push notifications on their iPhone when the app is installed to home screen.

**Architecture:** Web Push API with VAPID keys. Subscriptions stored in Postgres via Prisma. A `/api/push/send` route sends notifications server-side using `web-push`. A Vercel cron hits `/api/cron/push-reminders` nightly to notify athletes about tomorrow's workouts.

**Tech Stack:** `web-push` npm package, Prisma, Next.js App Router API routes, service worker Push API, Vercel Cron Jobs.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `prisma/schema.prisma` | Modify | Add `PushSubscription` model |
| `prisma/migrations/…` | Create | DB migration |
| `public/sw.js` | Modify | Add `push` + `notificationclick` event handlers |
| `src/lib/web-push.ts` | Create | VAPID config + `sendPushNotification` helper |
| `src/app/api/push/subscribe/route.ts` | Create | POST/DELETE subscription endpoints |
| `src/app/api/push/vapid-key/route.ts` | Create | GET public VAPID key (for client) |
| `src/app/api/cron/push-reminders/route.ts` | Create | Nightly cron — find tomorrow's workouts + notify |
| `src/components/NotificationToggle.tsx` | Create | "Enable notifications" toggle button |
| `src/app/profile/page.tsx` or `AthleteSidebar` | Modify | Mount `NotificationToggle` |
| `vercel.json` | Create/Modify | Cron schedule definition |
| `.env.example` | Modify | Add VAPID key vars |

---

## Task 1: Install `web-push` and generate VAPID keys

**Files:** `package.json`, `.env.local`, `.env.example`

- [ ] Install package
```bash
cd /path/to/project && npm install web-push
npm install --save-dev @types/web-push
```

- [ ] Generate VAPID keys
```bash
npx web-push generate-vapid-keys
```
Copy output — looks like:
```
Public Key: Bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=
Private Key: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=
```

- [ ] Add to `.env.local`
```
VAPID_PUBLIC_KEY="Bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx="
VAPID_PRIVATE_KEY="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx="
VAPID_SUBJECT="mailto:admin@mytrainingplan.app"
NEXT_PUBLIC_VAPID_PUBLIC_KEY="Bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx="
```
Note: `NEXT_PUBLIC_` prefix exposes the public key to the browser (required for subscription).

- [ ] Add placeholders to `.env.example`
```
VAPID_PUBLIC_KEY=""
VAPID_PRIVATE_KEY=""
VAPID_SUBJECT="mailto:admin@mytrainingplan.app"
NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
```

- [ ] Commit
```bash
git add package.json package-lock.json .env.example
git commit -m "feat: install web-push and add VAPID env vars"
```

---

## Task 2: Add PushSubscription model to Prisma

**Files:** `prisma/schema.prisma`

- [ ] Add model at end of schema
```prisma
model PushSubscription {
  id        String   @id @default(cuid())
  userId    String
  endpoint  String   @unique
  p256dh    String
  auth      String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

- [ ] Add relation to `User` model (find the User model, add inside it)
```prisma
pushSubscriptions PushSubscription[]
```

- [ ] Run migration
```bash
npx prisma migrate dev --name add-push-subscriptions
```
Expected: migration file created, DB updated.

- [ ] Run typecheck
```bash
npm run typecheck
```
Expected: no errors.

- [ ] Commit
```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add PushSubscription model to schema"
```

---

## Task 3: Create `web-push` server helper

**Files:** `src/lib/web-push.ts` (create)

- [ ] Create file
```typescript
// src/lib/web-push.ts
import webpush from "web-push";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload
): Promise<void> {
  await webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    JSON.stringify(payload)
  );
}

export { webpush };
```

- [ ] Run typecheck
```bash
npm run typecheck
```

- [ ] Commit
```bash
git add src/lib/web-push.ts
git commit -m "feat: add web-push server helper with VAPID config"
```

---

## Task 4: API routes — subscribe + vapid-key

**Files:**
- Create: `src/app/api/push/subscribe/route.ts`
- Create: `src/app/api/push/vapid-key/route.ts`

- [ ] Create `vapid-key` route (returns public key to client)
```typescript
// src/app/api/push/vapid-key/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY });
}
```

- [ ] Create `subscribe` route
```typescript
// src/app/api/push/subscribe/route.ts
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { endpoint, keys } = await req.json();
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    update: { userId, p256dh: keys.p256dh, auth: keys.auth },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { endpoint } = await req.json();
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });

  return NextResponse.json({ ok: true });
}
```

- [ ] Check how `auth()` is imported in other API routes in this codebase — look at e.g. `src/app/api/plans/route.ts` and match the import pattern exactly.

- [ ] Run typecheck
```bash
npm run typecheck
```

- [ ] Commit
```bash
git add src/app/api/push/
git commit -m "feat: add push subscribe and vapid-key API routes"
```

---

## Task 5: Update service worker with push handler

**Files:** `public/sw.js` (modify)

- [ ] Add push and notificationclick handlers at the end of `public/sw.js`
```javascript
// ── Push notifications ─────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  const title = data.title || 'MyTrainingPlan';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'mtp-notification',
    renotify: true,
    data: { url: data.url || '/dashboard' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/dashboard';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
```

- [ ] Bump the cache version constant at the top from `'v1'` to `'v2'` so the new SW is installed.

- [ ] Commit
```bash
git add public/sw.js
git commit -m "feat: add push and notificationclick handlers to service worker"
```

---

## Task 6: NotificationToggle UI component

**Files:** `src/components/NotificationToggle.tsx` (create)

- [ ] Create component
```typescript
"use client";
import { useState, useEffect } from "react";

type State = "unsupported" | "denied" | "prompt" | "granted" | "loading";

export default function NotificationToggle() {
  const [state, setState] = useState<State>("loading");
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setState("unsupported");
      return;
    }
    setState(Notification.permission as State);

    // Check if already subscribed
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => setSubscribed(!!sub))
    );
  }, []);

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
  if (state === "loading") return <button className="dash-btn-ghost" disabled>Notifications…</button>;
  if (state === "denied") return <p style={{ fontSize: 13, color: "var(--d-muted)" }}>Notifications blocked — enable in iOS Settings.</p>;

  return (
    <button
      className="dash-btn-ghost"
      onClick={subscribed ? unsubscribe : subscribe}
    >
      {subscribed ? "Disable workout reminders" : "Enable workout reminders"}
    </button>
  );
}
```

- [ ] Run typecheck
```bash
npm run typecheck
```

- [ ] Commit
```bash
git add src/components/NotificationToggle.tsx
git commit -m "feat: add NotificationToggle client component"
```

---

## Task 7: Mount NotificationToggle in Profile page

**Files:** `src/app/profile/page.tsx` (modify — or wherever settings/profile UI lives)

- [ ] Find the profile page. Import and add `NotificationToggle`:
```typescript
import NotificationToggle from "@/components/NotificationToggle";
```

- [ ] Find a logical place in the profile UI (e.g. a "Notifications" section) and add:
```tsx
<div className="profile-section">
  <h3>Notifications</h3>
  <p style={{ fontSize: 13, color: "var(--d-muted)", marginBottom: 8 }}>
    Get workout reminders on your device.
  </p>
  <NotificationToggle />
</div>
```

- [ ] Run typecheck. Commit.
```bash
git commit -m "feat: add NotificationToggle to profile page"
```

---

## Task 8: Nightly reminder cron route

**Files:** `src/app/api/cron/push-reminders/route.ts` (create), `vercel.json` (create/modify)

- [ ] Create cron route
```typescript
// src/app/api/cron/push-reminders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushNotification } from "@/lib/web-push";

// Vercel calls this with a secret header to prevent unauthorized triggers
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find tomorrow's date range (UTC)
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const dayStart = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate()));
  const dayEnd   = new Date(dayStart.getTime() + 86400000);

  // Find all active plans with activities scheduled for tomorrow
  const days = await prisma.planDay.findMany({
    where: {
      scheduledDate: { gte: dayStart, lt: dayEnd },
      week: { plan: { status: "ACTIVE" } },
      activities: { some: {} },
    },
    include: {
      activities: true,
      week: { include: { plan: { include: { user: { include: { pushSubscriptions: true } } } } } },
    },
  });

  let sent = 0;
  for (const day of days) {
    const user = day.week.plan.user;
    const activityCount = day.activities.length;
    const label = activityCount === 1 ? "1 workout" : `${activityCount} workouts`;
    const payload = {
      title: "Tomorrow's Training 💪",
      body: `You have ${label} scheduled. Tap to view.`,
      url: `/calendar?date=${dayStart.toISOString().slice(0, 10)}`,
    };
    for (const sub of user.pushSubscriptions) {
      try {
        await sendPushNotification(sub, payload);
        sent++;
      } catch {
        // Subscription expired — clean up
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      }
    }
  }

  return NextResponse.json({ ok: true, sent });
}
```

- [ ] Add `CRON_SECRET` to `.env.example` and `.env.local`
```
CRON_SECRET="generate-a-random-secret-here"
```

- [ ] Create or update `vercel.json`
```json
{
  "crons": [
    {
      "path": "/api/cron/push-reminders",
      "schedule": "0 18 * * *"
    }
  ]
}
```
Note: `0 18 * * *` = 18:00 UTC daily (adjust to ~8pm user local time as needed).

- [ ] Run typecheck
```bash
npm run typecheck
```

- [ ] Commit
```bash
git add src/app/api/cron/ vercel.json .env.example
git commit -m "feat: add nightly push reminder cron route and vercel.json schedule"
```

---

## Task 9: Test end-to-end on device

- [ ] Deploy to Vercel (or test locally with ngrok for HTTPS)
- [ ] Open app on iPhone Safari (must be HTTPS)
- [ ] Add to Home Screen, launch in standalone mode
- [ ] Go to Profile → tap "Enable workout reminders"
- [ ] Accept permission prompt
- [ ] Trigger test notification manually:
```bash
curl -X GET https://yourapp.com/api/cron/push-reminders \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```
- [ ] Verify notification appears on lock screen and tapping opens correct day

---

## Notes

- Push notifications only work on **HTTPS** — localhost won't work on real device
- iOS requires the app to be in **standalone mode** (added to home screen) for web push
- Expired/invalid subscriptions are auto-cleaned in the cron route
- The `NEXT_PUBLIC_VAPID_PUBLIC_KEY` must match `VAPID_PUBLIC_KEY` exactly (same key, different env var name)
