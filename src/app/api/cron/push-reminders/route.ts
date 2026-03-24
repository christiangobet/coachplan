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
        const seen = new Map<string, NonNullable<typeof week.plan.owner>>();
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
        const seen = new Map<string, NonNullable<typeof week.plan.owner>>();
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
