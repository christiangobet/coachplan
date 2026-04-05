import test from "node:test";
import assert from "node:assert/strict";

import { enrichLegacyDayDraftsFromProgram } from "../src/lib/parsing/legacy-program-enrichment.ts";
import type { ProgramJsonV1 } from "../src/lib/schemas/program-json-v1.ts";

function buildProgram(): ProgramJsonV1 {
  return {
    program: {
      title: "Plan",
      distance_target: "MARATHON",
      plan_length_weeks: 18,
      layout_type: "calendar_grid",
      source_units: "miles",
      intensity_rules: {},
      training_rules: {},
      phase_rules: [],
      progression: {},
      symbol_dictionary: {},
      glossary: {},
      assumptions: [],
      program_notes: [],
    },
    weeks: [
      {
        week_number: 1,
        week_type: null,
        week_brief: null,
        total_weekly_mileage_min: null,
        total_weekly_mileage_max: null,
        sessions: [
          {
            day_of_week: "Thu",
            activity_type: "Run",
            raw_text: "Tempo run: 1-2 mile WU; T: 1.5 miles; 1-mile CD",
            session_role: "Tempo",
            priority: true,
            optional: false,
            notes: "Run controlled tempo work and stay relaxed.",
            coaching_note: "This is a key session. Hold back early and finish strong.",
            session_focus: "tempo",
            intensity: null,
            distance_miles: 1.5,
            duration_minutes: null,
            steps: [
              {
                type: "warmup",
                distance_miles: 1,
                description: "Warm-up",
              },
              {
                type: "tempo",
                distance_miles: 1.5,
                description: "Tempo",
              },
              {
                type: "cooldown",
                distance_miles: 1,
                description: "Cool-down",
              },
            ],
            optional_alternatives: [],
          },
        ],
      },
    ],
    quality_checks: {
      weeks_detected: 1,
      missing_days: [],
      anomalies: [],
    },
  };
}

test("enrichLegacyDayDraftsFromProgram backfills day notes and coaching fields from program sessions", () => {
  const enriched = enrichLegacyDayDraftsFromProgram({
    planId: "plan_1",
    dayId: "day_1",
    sourceUnits: "miles",
    weekNumber: 1,
    dayOfWeek: 4,
    baseActivities: [
      {
        planId: "plan_1",
        dayId: "day_1",
        type: "RUN",
        subtype: "tempo",
        title: "Tempo",
        rawText: "Tempo run: 1-2 mile WU; T: 1.5 miles; 1-mile CD",
        distance: 1.5,
        distanceUnit: "MILES",
        duration: null,
        priority: "KEY",
        bailAllowed: false,
        mustDo: true,
      },
    ],
    program: buildProgram(),
  });

  assert.match(enriched.dayNotes || "", /controlled tempo work/i);
  assert.match(enriched.dayNotes || "", /tempo run: 1-2 mile wu/i);
  assert.equal(enriched.activities[0].notes, "Run controlled tempo work and stay relaxed.");
  assert.match(enriched.activities[0].sessionInstructions || "", /Warm-up/);
  assert.match(enriched.activities[0].coachingNote || "", /key session/i);
  assert.equal(enriched.activities[0].sessionFocus, "tempo");
});

test("enrichLegacyDayDraftsFromProgram replaces coaching-derived titles with workout identity and preserves execution order", () => {
  const enriched = enrichLegacyDayDraftsFromProgram({
    planId: "plan_2",
    dayId: "day_2",
    sourceUnits: "miles",
    weekNumber: 1,
    dayOfWeek: 1,
    baseActivities: [
      {
        id: "activity_1",
        planId: "plan_2",
        dayId: "day_2",
        type: "RUN",
        subtype: null,
        title: "Bail if necessary",
        rawText: "Easy run: 3 miles at easy pace",
        sessionInstructions: "Easy run: 3 miles at easy pace",
        distance: 3,
        distanceUnit: "MILES",
        duration: null,
        priority: "MEDIUM",
        bailAllowed: false,
        mustDo: false,
        coachingNote: null,
      },
    ],
    program: {
      program: {
        title: "Plan",
        distance_target: "MARATHON",
        plan_length_weeks: 18,
        layout_type: "calendar_grid",
        source_units: "miles",
        intensity_rules: {},
        training_rules: {},
        phase_rules: [],
        progression: {},
        symbol_dictionary: {},
        glossary: {},
        assumptions: [],
        program_notes: [],
      },
      weeks: [
        {
          week_number: 1,
          week_type: null,
          week_brief: null,
          total_weekly_mileage_min: null,
          total_weekly_mileage_max: null,
          sessions: [
            {
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
              distance_miles: 3,
              duration_minutes: null,
              steps: [
                { type: "easy", distance_miles: 3, description: "Easy run" },
                {
                  type: "repeat",
                  repetitions: 4,
                  steps: [{ type: "note", description: "Strides about 100m / 30 sec with equal recovery" }],
                },
              ],
              optional_alternatives: [],
              session_focus: "recovery",
            },
          ],
        },
      ],
      quality_checks: {
        weeks_detected: 1,
        missing_days: [],
        anomalies: [],
      },
    },
  });

  assert.equal(enriched.activities[0].title, "Easy run + strides");
  assert.match(enriched.activities[0].sessionInstructions || "", /easy 3 mi[\s\S]*strides about 100m/i);
  assert.match(enriched.activities[0].rawText || "", /easy run \+ strides/i);
  assert.match(enriched.activities[0].coachingNote || "", /bail if necessary/i);
  assert.equal(enriched.activities[0].bailAllowed, true);
});

test("enrichLegacyDayDraftsFromProgram keeps good existing titles when markdown is noisier", () => {
  const enriched = enrichLegacyDayDraftsFromProgram({
    planId: "plan_3",
    dayId: "day_3",
    sourceUnits: "miles",
    weekNumber: 1,
    dayOfWeek: 2,
    baseActivities: [
      {
        id: "activity_2",
        planId: "plan_3",
        dayId: "day_3",
        type: "RUN",
        subtype: "tempo",
        title: "Tempo Run",
        rawText: "Tempo run 4 miles",
        sessionInstructions: "Warm-up, then tempo, then cooldown.",
        distance: 4,
        distanceUnit: "MILES",
        duration: null,
        priority: "KEY",
        bailAllowed: false,
        mustDo: true,
        coachingNote: "Hold back early.",
      },
    ],
    program: {
      program: {
        title: "Plan",
        distance_target: "MARATHON",
        plan_length_weeks: 18,
        layout_type: "calendar_grid",
        source_units: "miles",
        intensity_rules: {},
        training_rules: {},
        phase_rules: [],
        progression: {},
        symbol_dictionary: {},
        glossary: {},
        assumptions: [],
        program_notes: [],
      },
      weeks: [
        {
          week_number: 1,
          week_type: null,
          week_brief: null,
          total_weekly_mileage_min: null,
          total_weekly_mileage_max: null,
          sessions: [
            {
              day_of_week: "Tue",
              activity_type: "Run",
              session_role: "Workout",
              raw_text: "Run",
              notes: null,
              coaching_note: null,
              priority: false,
              optional: false,
              intensity: null,
              distance_miles: 4,
              duration_minutes: null,
              steps: [],
              optional_alternatives: [],
            },
          ],
        },
      ],
      quality_checks: {
        weeks_detected: 1,
        missing_days: [],
        anomalies: [],
      },
    },
  });

  assert.equal(enriched.activities[0].title, "Tempo Run");
  assert.equal(enriched.activities[0].sessionInstructions, "Warm-up, then tempo, then cooldown.");
});
