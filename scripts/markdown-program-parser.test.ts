import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import parserModule from "../src/lib/parsing/markdown-program-parser.ts";
import sessionEnricherModule from "../src/lib/parsing/markdown-session-enricher.ts";

test("markdown-native parser contract exists and is deterministic", async () => {
  const source = await readFile(
    new URL("../src/lib/parsing/markdown-program-parser.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /export\s+async\s+function\s+parseMarkdownProgram/);
  assert.match(source, /ProgramJsonV1/);
  assert.match(source, /week/i);
  assert.match(source, /table/i);
  assert.doesNotMatch(source, /chunked?\s+whole-plan/i);

  assert.equal(typeof parserModule.parseMarkdownProgram, "function");
  assert.equal(typeof parserModule.splitWeekSections, "function");
  assert.equal(typeof parserModule.parseWeekTables, "function");

  const markdown = [
    "## Week 1",
    "",
    "| Day | Session | Distance | Duration | Notes |",
    "| --- | --- | --- | --- | --- |",
    "| Monday | ♥ Easy run | 3 miles | 45 min | Start easy |",
    "| Tuesday | ⭐ Key session — WU 1 mile + Tempo 3 miles + CD 1 mile | 5 miles | 50 min | Must do |",
    "| Wednesday | Rest or Crosstrain | — | — | Take it easy |",
    "| Thursday | Hills 8 x 30 sec | 5 miles | 40-45 min | Speed work |",
    "| Friday | Strength training | — | 30 min | Mobility and core |",
    "| Saturday | Long Run 10 miles | 10 miles | 90 min | Long run day |",
    "| Sunday | Race 5K | 5 km | — | Race day |",
    "",
    "**TWM: 18.5-20.5 miles**",
  ].join("\n");

  const parsed = await parserModule.parseMarkdownProgram({
    markdown,
    planName: "Demo Plan",
  });

  assert.equal(parsed.program.title, "Demo Plan");
  assert.equal(parsed.program.layout_type, "sequential_table");
  assert.equal(parsed.program.plan_length_weeks, 1);
  assert.equal(parsed.weeks.length, 1);
  assert.equal(parsed.quality_checks.weeks_detected, 1);
  assert.equal(parsed.weeks[0].week_number, 1);
  assert.equal(parsed.weeks[0].total_weekly_mileage_min, 18.5);
  assert.equal(parsed.weeks[0].total_weekly_mileage_max, 20.5);

  const sessionsByDay = new Map(
    parsed.weeks[0].sessions.map((session) => [session.day_of_week, session]),
  );

  assert.equal(sessionsByDay.get("Mon")?.raw_text, "♥ Easy run");
  assert.equal(
    sessionsByDay.get("Tue")?.raw_text,
    "⭐ Key session — WU 1 mile + Tempo 3 miles + CD 1 mile",
  );
  assert.equal(sessionsByDay.get("Wed")?.raw_text, "Rest or Crosstrain");
  assert.equal(sessionsByDay.get("Sat")?.raw_text, "Long Run 10 miles");
  assert.equal(sessionsByDay.get("Mon")?.activity_type, "Run");
  assert.equal(sessionsByDay.get("Wed")?.activity_type, "Rest");
  assert.equal(sessionsByDay.get("Fri")?.activity_type, "Strength");
  assert.equal(sessionsByDay.get("Sun")?.activity_type, "Race");

  assert.equal(sessionsByDay.get("Mon")?.optional, true);
  assert.equal(sessionsByDay.get("Mon")?.session_role, "easy");
  assert.equal(sessionsByDay.get("Mon")?.session_focus, "recovery");
  assert.equal(sessionsByDay.get("Mon")?.distance_miles, 3);
  assert.equal(sessionsByDay.get("Mon")?.duration_minutes, 45);

  assert.equal(sessionsByDay.get("Tue")?.priority, true);
  assert.equal(sessionsByDay.get("Tue")?.priority_level, "KEY");
  assert.equal(sessionsByDay.get("Tue")?.session_role, "tempo");
  assert.equal(sessionsByDay.get("Tue")?.session_focus, "tempo");
  assert.equal(sessionsByDay.get("Tue")?.distance_miles, 5);
  assert.equal(sessionsByDay.get("Tue")?.duration_minutes, 50);

  assert.equal(sessionsByDay.get("Thu")?.session_role, "hill");
  assert.equal(sessionsByDay.get("Thu")?.session_focus, "threshold");
  assert.equal(sessionsByDay.get("Thu")?.distance_miles, 5);
  assert.equal(sessionsByDay.get("Thu")?.duration_min_minutes, 40);
  assert.equal(sessionsByDay.get("Thu")?.duration_max_minutes, 45);

  assert.equal(sessionsByDay.get("Sat")?.session_role, "long_run");
  assert.equal(sessionsByDay.get("Sat")?.session_focus, "long_run");
  assert.equal(sessionsByDay.get("Sat")?.distance_miles, 10);
  assert.equal(sessionsByDay.get("Sun")?.session_role, "race");
  assert.equal(sessionsByDay.get("Sun")?.session_focus, "race_sim");
  assert.equal(sessionsByDay.get("Sun")?.distance_km, 5);

  assert.deepEqual(
    parserModule.parseWeekTables({
      weekNumber: 3,
      tableRows: [
        "| Day | Session | Distance | Duration | Notes |",
        "| --- | --- | --- | --- | --- |",
        "| Monday | ⭐ Key session — WU 1 mile + Tempo 3 miles + CD 1 mile | 5 miles | 50 min | Start easy |",
      ],
      rawText: "## Week 3\n| Day | Session | Distance | Duration | Notes |\n| --- | --- | --- | --- | --- |\n| Monday | ⭐ Key session — WU 1 mile + Tempo 3 miles + CD 1 mile | 5 miles | 50 min | Start easy |",
    }),
    {
      week_number: 3,
      sessions: [
        {
          day_of_week: "Mon",
          activity_type: "Run",
          session_role: "tempo",
          priority: true,
          optional: false,
          priority_level: "KEY",
          session_focus: "tempo",
          distance_miles: 5,
          duration_minutes: 50,
          raw_text: "⭐ Key session — WU 1 mile + Tempo 3 miles + CD 1 mile",
          steps: [],
          optional_alternatives: [],
        },
      ],
    },
  );
});

test("markdown session enricher stays scoped to one session at a time", async () => {
  const source = await readFile(
    new URL("../src/lib/parsing/markdown-session-enricher.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /single session/i);
  assert.match(source, /intensity/i);
  assert.match(source, /coaching_note/i);
  assert.match(source, /session_focus/i);
  assert.doesNotMatch(source, /whole week/i);
  assert.doesNotMatch(source, /whole plan/i);

  assert.equal(typeof sessionEnricherModule.buildMarkdownSessionEnrichmentPrompt, "function");
  assert.equal(typeof sessionEnricherModule.enrichMarkdownSession, "function");

  const prompt = sessionEnricherModule.buildMarkdownSessionEnrichmentPrompt({
    session: {
      day_of_week: "Tue",
      activity_type: "Run",
      session_role: "tempo",
      priority: true,
      optional: false,
      raw_text: "WU 1 mile + Tempo 3 miles + CD 1 mile",
      steps: [],
      optional_alternatives: [],
    },
    context: {
      planName: "Demo Plan",
      weekNumber: 3,
      dayLabel: "Tuesday",
      weekSummary: "Tempo week",
      glossary: "WU = warm up; CD = cool down",
    },
  });

  assert.match(prompt, /single session/i);
  assert.match(prompt, /do not parse or rewrite the rest of the program/i);
  assert.match(prompt, /session_role/i);
  assert.match(prompt, /intensity/i);
  assert.match(prompt, /notes/i);
  assert.match(prompt, /coaching_note/i);
  assert.match(prompt, /session_focus/i);

  const enriched = await sessionEnricherModule.enrichMarkdownSession({
    session: {
      day_of_week: "Tue",
      activity_type: "Run",
      session_role: "tempo",
      priority: true,
      optional: false,
      raw_text: "WU 1 mile + Tempo 3 miles + CD 1 mile",
      steps: [],
      optional_alternatives: [],
    },
    context: {
      planName: "Demo Plan",
      weekNumber: 3,
      dayLabel: "Tuesday",
      weekSummary: "Tempo week",
      glossary: "WU = warm up; CD = cool down",
    },
  });

  assert.equal(enriched.session.session_role, "tempo");
  assert.equal(enriched.session.raw_text, "WU 1 mile + Tempo 3 miles + CD 1 mile");
  assert.ok(Array.isArray(enriched.session.steps));
});

test("splitCompoundSessionText — session-flow text stays as one activity", () => {
  const { splitCompoundSessionText } = parserModule;

  // Hill-repeat run session: WU + intervals with pipe phase separators + CD
  // Must remain a single activity despite '+' and '|' characters
  const hillsText =
    "Hills: WU 10 min flat ground, then 4 x 90 seconds up hill (jog back down between each) | 8 x 1 minute up hill (jog back down between each) | 4 x 30 seconds flat and fast (at 5K race pace, 30 sec recovery between each), CD 10 min flat ground";
  assert.deepEqual(splitCompoundSessionText(hillsText), [hillsText]);

  // Classic WU + Tempo + CD — all Run, must stay as one session
  const tempoText = "WU 1 mile + Tempo 3 miles + CD 1 mile";
  assert.deepEqual(splitCompoundSessionText(tempoText), [tempoText]);

  // Key session with WU/CD prefix — must stay as one session
  const keyText = "⭐ Key session — WU 1 mile + Tempo 3 miles + CD 1 mile";
  assert.deepEqual(splitCompoundSessionText(keyText), [keyText]);

  // Interval notation without WU/CD — pipe separator alone keeps it together
  const intervalText = "Track: 6 x 800m at 5K pace | 400m jog recovery";
  assert.deepEqual(splitCompoundSessionText(intervalText), [intervalText]);
});

test("splitCompoundSessionText — heterogeneous compound sessions still split", () => {
  const { splitCompoundSessionText } = parserModule;

  // Strength + Easy run — genuinely different activity types → must split
  const compoundText =
    "Strength 1 (Circuit 1 — weeks 1–8; see Strength & Conditioning section) + Easy run";
  const result = splitCompoundSessionText(compoundText);
  assert.equal(result.length, 2);
  assert.equal(result[0], "Strength 1 (Circuit 1 — weeks 1–8; see Strength & Conditioning section)");
  assert.equal(result[1], "Easy run");

  // Trail miles + Long Run Label — two distinct run-type descriptions that
  // produce the same activity type → kept as one session (homogeneous rule)
  const trailText = "6 trail miles + LRL (long run label)";
  // Both parts infer as Run → homogeneous → single element
  assert.equal(splitCompoundSessionText(trailText).length, 1);
});
