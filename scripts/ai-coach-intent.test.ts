import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

type AiCoachPlanContext = import("../src/lib/ai-coach-intent").AiCoachPlanContext;

const workspaceRoot = process.cwd();

async function loadAiCoachIntentModule() {
  return import(pathToFileURL(path.join(workspaceRoot, "src/lib/ai-coach-intent.ts")).href);
}

const context: AiCoachPlanContext = {
  todayISO: "2026-03-18",
  weekSummaries: [
    {
      weekIndex: 10,
      startDateISO: "2026-03-09",
      endDateISO: "2026-03-15",
      restDays: [5],
      hardRunDays: [2],
      keySessionDays: [2, 6],
      plannedDurationMin: 320,
    },
    {
      weekIndex: 11,
      startDateISO: "2026-03-16",
      endDateISO: "2026-03-22",
      restDays: [5],
      hardRunDays: [2, 4],
      keySessionDays: [2, 4, 6],
      plannedDurationMin: 410,
    },
  ],
  days: [
    {
      weekIndex: 11,
      dayOfWeek: 1,
      dateISO: "2026-03-16",
      isLocked: true,
      activities: [
        { title: "Easy Run", type: "RUN", completed: true, duration: 45 },
      ],
    },
    {
      weekIndex: 11,
      dayOfWeek: 2,
      dateISO: "2026-03-17",
      isLocked: true,
      activities: [
        { title: "Tempo", type: "RUN", completed: true, duration: 55 },
      ],
    },
    {
      weekIndex: 11,
      dayOfWeek: 3,
      dateISO: "2026-03-18",
      isLocked: false,
      activities: [
        { title: "Strength", type: "STRENGTH", completed: false, duration: 30 },
      ],
    },
    {
      weekIndex: 11,
      dayOfWeek: 4,
      dateISO: "2026-03-19",
      isLocked: false,
      activities: [
        { title: "Intervals", type: "RUN", completed: false, duration: 60 },
      ],
    },
    {
      weekIndex: 10,
      dayOfWeek: 4,
      dateISO: "2026-03-12",
      isLocked: true,
      activities: [
        { title: "Recovery Run", type: "RUN", completed: true, duration: 35 },
      ],
    },
  ],
};

test("detectAiCoachIntent treats weekly status questions as status checks", () => {
  return loadAiCoachIntentModule().then(({ detectAiCoachIntent }) => {
    assert.equal(detectAiCoachIntent("How is my week so far?"), "status_check");
    assert.equal(detectAiCoachIntent("Am I on track this week?"), "status_check");
  });
});

test("detectAiCoachIntent keeps explicit edit asks on the adjustment path", () => {
  return loadAiCoachIntentModule().then(({ detectAiCoachIntent }) => {
    assert.equal(detectAiCoachIntent("Move my long run to Sunday"), "adjustment_request");
    assert.equal(detectAiCoachIntent("Please rename the hike"), "adjustment_request");
  });
});

test("detectAiCoachIntent routes retrospective workout questions to activity feedback", () => {
  return loadAiCoachIntentModule().then(({ detectAiCoachIntent }) => {
    assert.equal(detectAiCoachIntent("Does my hike from yesterday count as strength?"), "activity_feedback");
  });
});

test("resolveCurrentWeekIndex prefers the active week from context when no explicit week is passed", () => {
  return loadAiCoachIntentModule().then(({ resolveCurrentWeekIndex }) => {
    assert.equal(resolveCurrentWeekIndex(context, null), 11);
  });
});

test("buildWeekStatusScope narrows status feedback to the active week", () => {
  return loadAiCoachIntentModule().then(({ buildWeekStatusScope }) => {
    const scope = buildWeekStatusScope(context, null);

    assert.equal(scope.weekIndex, 11);
    assert.equal(scope.totalActivities, 4);
    assert.equal(scope.completedActivities, 2);
    assert.equal(scope.lockedDays, 2);
    assert.deepEqual(scope.days.map((day: { dayOfWeek: number }) => day.dayOfWeek), [1, 2, 3, 4]);
  });
});

test("buildActivityFeedbackScope focuses on yesterday's completed activity when asked", () => {
  return loadAiCoachIntentModule().then(({ buildActivityFeedbackScope }) => {
    const scope = buildActivityFeedbackScope("Does my hike from yesterday count as strength?", context, null);

    assert.equal(scope.targetDateISO, "2026-03-17");
    assert.equal(scope.targetDay?.weekIndex, 11);
    assert.deepEqual(scope.targetDay?.activities.map((activity: { title: string }) => activity.title), ["Tempo"]);
  });
});
