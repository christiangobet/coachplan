import test from "node:test";
import assert from "node:assert/strict";

const moduleHref = new URL("../src/lib/parsing/v4-persistence-mapping.ts", import.meta.url).href;

test("derivePlanDayNotes preserves useful session note text for the saved day", async () => {
  const { derivePlanDayNotes } = await import(moduleHref);

  const notes = derivePlanDayNotes([
    {
      day_of_week: "Sat",
      activity_type: "Run",
      raw_text: "Long Run 8 miles",
      notes: "Build endurance through long run. Hydration and nutrition matter once you top 75 minutes.",
      coaching_note: "Stay relaxed early and finish feeling strong.",
      priority: false,
      optional: false,
      steps: [],
      optional_alternatives: [],
    },
  ]);

  assert.equal(
    notes,
    [
      "Long Run 8 miles",
      "Build endurance through long run. Hydration and nutrition matter once you top 75 minutes.",
      "Stay relaxed early and finish feeling strong.",
    ].join("\n\n"),
  );
});

test("derivePlanDayNotes falls back to session raw text when notes are absent", async () => {
  const { derivePlanDayNotes } = await import(moduleHref);

  const notes = derivePlanDayNotes([
    {
      day_of_week: "Wed",
      activity_type: "CrossTraining",
      raw_text: "Cross-train: non-high-impact cardio 30-60 min; recommended to add Strength-Training Routine",
      notes: null,
      coaching_note: null,
      priority: false,
      optional: false,
      steps: [],
      optional_alternatives: [],
    },
  ]);

  assert.equal(
    notes,
    "Cross-train: non-high-impact cardio 30-60 min; recommended to add Strength-Training Routine",
  );
});

test("buildActivityDraftFromSession keeps execution detail and note fields distinct", async () => {
  const { buildActivityDraftFromSession } = await import(moduleHref);

  const activity = buildActivityDraftFromSession({
    planId: "plan_123",
    dayId: "day_123",
    sourceUnits: "miles",
    session: {
      day_of_week: "Wed",
      activity_type: "Run",
      session_role: "Tempo Run",
      raw_text: "WU 10min + 3 x 8min tempo + CD 10min",
      notes: "Keep the recoveries truly easy and controlled.",
      coaching_note: "Do not race the first rep.",
      intensity: "Zone 3",
      priority: false,
      optional: false,
      steps: [
        { type: "warmup", duration_minutes: 10, description: "Easy" },
        {
          type: "repeat",
          repetitions: 3,
          steps: [
            { type: "tempo", duration_minutes: 8, description: "Tempo" },
            { type: "recovery", duration_minutes: 2, description: "Easy jog" },
          ],
        },
        { type: "cooldown", duration_minutes: 10, description: "Easy" },
      ],
      optional_alternatives: [],
    },
  });

  assert.equal(activity.notes, "Keep the recoveries truly easy and controlled.");
  assert.equal(activity.coachingNote, "Do not race the first rep.");
  assert.match(
    String(activity.sessionInstructions),
    /Warm-up 10 min[\s\S]*3×[\s\S]*Tempo 8 min[\s\S]*Recovery 2 min[\s\S]*Cool-down 10 min[\s\S]*Keep the recoveries truly easy and controlled\./,
  );
});

test("buildActivityDraftFromSession does not let coaching phrases become the title", async () => {
  const { buildActivityDraftFromSession } = await import(moduleHref);

  const activity = buildActivityDraftFromSession({
    planId: "plan_456",
    dayId: "day_456",
    sourceUnits: "miles",
    session: {
      day_of_week: "Mon",
      activity_type: "Run",
      session_role: "Bail if necessary",
      raw_text: "Easy run + strides: run 3 miles at easy pace, followed by 2-4 strides",
      notes: null,
      coaching_note: "Bail if necessary — rest if your body is telling you it needs a break.",
      priority: false,
      optional: true,
      priority_level: "OPTIONAL",
      intensity: "Easy pace",
      steps: [
        { type: "easy", distance_miles: 3, description: "Easy run" },
        {
          type: "repeat",
          repetitions: 4,
          steps: [{ type: "note", description: "Strides about 100m / 30 sec with equal recovery" }],
        },
      ],
      optional_alternatives: [],
    },
  });

  assert.equal(activity.title, "Easy run + strides");
  assert.equal(activity.bailAllowed, true);
  assert.match(String(activity.coachingNote), /bail if necessary/i);
});
