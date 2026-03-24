import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushNotification } from "@/lib/web-push";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const dayStart = new Date(
    Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate())
  );
  const dayEnd = new Date(dayStart.getTime() + 86400000);

  // PlanDay has no scheduledDate; weeks carry startDate/endDate.
  // Find weeks whose startDate <= tomorrow < endDate, then pick the matching dayOfWeek.
  const tomorrowDow = dayStart.getUTCDay(); // 0 = Sun … 6 = Sat

  const weeks = await prisma.planWeek.findMany({
    where: {
      startDate: { lte: dayEnd },
      endDate: { gt: dayStart },
      plan: { status: "ACTIVE" },
    },
    include: {
      days: {
        where: {
          dayOfWeek: tomorrowDow,
          activities: { some: {} },
        },
        include: { activities: true },
      },
      plan: {
        include: {
          owner: { include: { pushSubscriptions: true } },
          athlete: { include: { pushSubscriptions: true } },
        },
      },
    },
  });

  let sent = 0;
  for (const week of weeks) {
    for (const day of week.days) {
      const count = day.activities.length;
      const payload = {
        title: "Tomorrow's Training",
        body: `You have ${count} workout${count === 1 ? "" : "s"} scheduled. Tap to view.`,
        url: `/calendar?date=${dayStart.toISOString().slice(0, 10)}`,
      };

      // Notify both owner (coach) and athlete if present
      const usersToNotify = [week.plan.owner, week.plan.athlete].filter(Boolean);
      for (const user of usersToNotify) {
        if (!user) continue;
        for (const sub of user.pushSubscriptions) {
          try {
            await sendPushNotification(sub, payload);
            sent++;
          } catch {
            await prisma.pushSubscription
              .delete({ where: { id: sub.id } })
              .catch(() => {});
          }
        }
      }
    }
  }

  return NextResponse.json({ ok: true, sent });
}
