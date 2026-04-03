# Coaching Guidance Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract coaching guidance (the "how" of workouts, weekly context, pacing philosophy) from training plan PDFs and surface it to athletes — inline coaching note on activity cards, and a collapsible weekly brief on the calendar view.

**Architecture:** Extend `ProgramJsonV1` schema with three new fields (`coaching_note`, `session_focus`, `week_brief`), run a Prisma migration to add `coachingNote`/`sessionFocus` on `PlanActivity` and `coachBrief` on `PlanWeek`, update both parser prompts to extract the fields, map them through `v4-to-plan.ts`, and render them in `DayLogCard` and the calendar week header.

**Tech Stack:** Prisma migrations, Zod schema, Next.js server components + React client components, TypeScript

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/schemas/program-json-v1.ts` | Modify | Add `coaching_note`, `session_focus` to `SessionV1Schema`; add `week_brief` to `WeekV1Schema` |
| `prisma/schema.prisma` | Modify | Add `coachingNote`, `sessionFocus` to `PlanActivity`; `coachBrief` to `PlanWeek` |
| `src/lib/parsing/v4-to-plan.ts` | Modify | Map new session and week fields into DB create payloads |
| `src/lib/prompts/plan-parser/vision-extraction-prompt.ts` | Modify | Add coaching cue preservation rules |
| `src/lib/prompts/plan-parser/md-parser-prompt.ts` | Modify | Add `coaching_note`, `session_focus`, `week_brief` extraction rules |
| `src/lib/log-activity.ts` | Modify | Add `coachingNote` to `LogActivity` type and `buildLogActivities` mapper |
| `src/components/DayLogCard.tsx` | Modify | Render `coachingNote` below activity steps |
| `src/app/calendar/page.tsx` | Modify | Render `coachBrief` disclosure row below week label in week view |

---

## Task 1: Extend ProgramJsonV1 schema

**Files:**
- Modify: `src/lib/schemas/program-json-v1.ts`

- [ ] **Step 1: Add fields to SessionV1Schema**

In `src/lib/schemas/program-json-v1.ts`, find `SessionV1Schema` and add two fields after `raw_text`:

```ts
// Before (find this line):
  raw_text: z.string().catch('')

// After (add these two fields after raw_text):
  raw_text: z.string().catch(''),
  coaching_note: z.string().nullable().optional(),
  session_focus: z.enum([
    'tempo', 'threshold', 'recovery', 'long_run',
    'race_sim', 'strength', 'other'
  ]).nullable().optional().catch(null),
```

- [ ] **Step 2: Add week_brief to WeekV1Schema**

In `WeekV1Schema`, add after `week_type`:

```ts
// Before (find this):
  sessions: z.array(SessionV1Schema)

// After (add week_brief before sessions):
  week_brief: z.string().nullable().optional(),
  sessions: z.array(SessionV1Schema)
```

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/schemas/program-json-v1.ts
git commit -m "feat: add coaching_note, session_focus, week_brief to ProgramJsonV1 schema"
```

---

## Task 2: Prisma migration — add coaching fields

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add fields to PlanActivity in schema.prisma**

Find the `model PlanActivity` block. After the `notes String?` field (or after `sessionInstructions String?` if notes comes later), add:

```prisma
  coachingNote  String?
  sessionFocus  String?
```

- [ ] **Step 2: Add coachBrief to PlanWeek in schema.prisma**

Find the `model PlanWeek` block. After `endDate DateTime?`, add:

```prisma
  coachBrief    String?
```

- [ ] **Step 3: Generate and apply migration**

```bash
npx prisma migrate dev --name add-coaching-fields
```

Expected output: migration created and applied, Prisma client regenerated

- [ ] **Step 4: Verify Prisma client has the new fields**

```bash
node -e "const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient(); console.log('ok')"
```

Expected: `ok` (no errors about missing fields)

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add coachingNote, sessionFocus to PlanActivity; coachBrief to PlanWeek"
```

---

## Task 3: Map new fields in v4-to-plan.ts

**Files:**
- Modify: `src/lib/parsing/v4-to-plan.ts` (lines ~201–219 for activity, line ~133 for week)

- [ ] **Step 1: Add coaching fields to the activity row builder**

In `v4-to-plan.ts`, find the `return {` block inside the `.map((session) => { ... })` that builds activity rows (around line 201). Add two fields after `structure`:

```ts
          structure: stepsStructure ?? Prisma.JsonNull,
          coachingNote: session.coaching_note ?? null,
          sessionFocus: session.session_focus ?? null,
```

- [ ] **Step 2: Add coachBrief to the PlanWeek create call**

Find `prisma.planWeek.create` (around line 133). Add `coachBrief` to the data object:

```ts
    const planWeek = await prisma.planWeek.create({
      data: {
        planId,
        weekIndex: week.week_number,
        coachBrief: week.week_brief ?? null,
      }
    });
```

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors. If Prisma types complain, run `npx prisma generate` first.

- [ ] **Step 4: Commit**

```bash
git add src/lib/parsing/v4-to-plan.ts
git commit -m "feat: map coaching_note, session_focus, week_brief fields from parser to DB"
```

---

## Task 4: Update vision extraction prompt

**Files:**
- Modify: `src/lib/prompts/plan-parser/vision-extraction-prompt.ts`

- [ ] **Step 1: Add coaching cue rule to the weekly table rules**

In `VISION_EXTRACTION_PROMPT`, find the `RULES FOR WEEK TABLES:` section. Add a new rule 10 after rule 9:

```
10. Preserve any per-session coaching cues (how to run it, perceived effort description, technique focus, mental approach) verbatim in the Notes column — separate from any distance or duration metric. Example: "Run by feel today — if legs feel heavy from yesterday, back off pace" belongs in Notes.
```

- [ ] **Step 2: Add week-tagging instruction to Trainer Notes**

Find the `## Trainer Notes` extraction instruction in the prompt (the paragraph starting "Extract ALL coaching narrative..."). Replace the last sentence of that paragraph with:

```
If a note applies to a specific week, prefix it with "Week N:" (e.g. "Week 3: This is a build week — expect fatigue mid-week; protect sleep"). This prefix lets the downstream parser map it to the correct week.
```

- [ ] **Step 3: Update the DB record if vision_master is already seeded**

If you ran Task 1 of WS1 (vision_master is in DB), reseed it so the DB record reflects the updated prompt:

```bash
npx tsx scripts/seed-vision-prompt.mjs
```

(The script does an upsert — safe to run again.)

- [ ] **Step 4: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompts/plan-parser/vision-extraction-prompt.ts
git commit -m "feat: update vision prompt to preserve coaching cues and tag trainer notes by week"
```

---

## Task 5: Update MD parser prompt

**Files:**
- Modify: `src/lib/prompts/plan-parser/md-parser-prompt.ts`

- [ ] **Step 1: Add three extraction rules to MD_PARSER_PROMPT**

In `MD_PARSER_PROMPT`, find the `RULES:` section (the numbered list). Add three new rules after the existing last rule:

```
- Extract `coaching_note` from the Notes column: the qualitative "how to run it" guidance (perceived effort, technique cues, mental approach). Do not include distance or duration metrics here. Set to null if the Notes column contains only metrics or is empty.
- Set `session_focus` to one of: tempo, threshold, recovery, long_run, race_sim, strength, other — infer from session content and intensity cues. Set to null if unclear.
- Extract `week_brief` for each week from the ## Trainer Notes section: find the line prefixed "Week N:" where N matches the current week number. Use the text after the prefix as the brief. Set to null if no matching Trainer Notes line exists for this week.
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/prompts/plan-parser/md-parser-prompt.ts
git commit -m "feat: update MD parser prompt to extract coaching_note, session_focus, week_brief"
```

---

## Task 6: Add coachingNote to LogActivity type and mapper

**Files:**
- Modify: `src/lib/log-activity.ts`

- [ ] **Step 1: Add coachingNote to LogActivity type**

In `src/lib/log-activity.ts`, find the `LogActivity` type definition (around line 11). Add after `sessionInstructions`:

```ts
  sessionInstructions: string | null;
  coachingNote: string | null;        // ← add this line
  structure: unknown;
```

- [ ] **Step 2: Map coachingNote in buildLogActivities**

In `buildLogActivities`, find the `sessionInstructions` mapping (around line 104). Add `coachingNote` after it:

```ts
        sessionInstructions: typeof activity.sessionInstructions === 'string' && activity.sessionInstructions.trim()
          ? activity.sessionInstructions.trim()
          : null,
        coachingNote: typeof activity.coachingNote === 'string' && activity.coachingNote.trim()
          ? activity.coachingNote.trim()
          : null,
        structure: activity.structure ?? null,
```

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/log-activity.ts
git commit -m "feat: add coachingNote to LogActivity type and buildLogActivities mapper"
```

---

## Task 7: Render coachingNote in DayLogCard

**Files:**
- Modify: `src/components/DayLogCard.tsx`

- [ ] **Step 1: Add coach note render below the instruction details block**

In `DayLogCard.tsx`, there are two places where `instructionText` renders inside a `<details>` block — one for individual activities (around line 982) and one for session group members (around line 1079). In **both** places, add the coach note block immediately after the closing `</details>` of the instruction block:

For individual activity (after `</details>` at ~line 987):

```tsx
                {instructionText && (
                  <details className="day-log-instructions" open>
                    <summary className="day-log-instructions-toggle">How to execute</summary>
                    <p className="day-log-instructions-text">{instructionText}</p>
                  </details>
                )}
                {activity.coachingNote && (
                  <p className="day-log-coach-note">{activity.coachingNote}</p>
                )}
```

Apply the same pattern in the session group member render (around line 1079):

```tsx
                      {instructionText && (
                        <details className="day-log-instructions" open>
                          <summary className="day-log-instructions-toggle">How to execute</summary>
                          <p className="day-log-instructions-text">{instructionText}</p>
                        </details>
                      )}
                      {activity.coachingNote && (
                        <p className="day-log-coach-note">{activity.coachingNote}</p>
                      )}
```

- [ ] **Step 2: Add CSS for day-log-coach-note**

Find the CSS file used by DayLogCard (check for an adjacent `.css` file or global styles import):

```bash
grep -n "day-log-instructions\|dayLogCard" src/app/globals.css src/app/calendar/calendar.css 2>/dev/null | head -5
```

Add the new class near the `day-log-instructions` styles:

```css
.day-log-coach-note {
  margin: 4px 0 0;
  font-size: 13px;
  font-style: italic;
  color: var(--d-muted);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.day-log-coach-note:focus-within,
.day-log-coach-note[data-expanded="true"] {
  -webkit-line-clamp: unset;
  overflow: visible;
}
```

Note: The 2-line clamp is a simple truncation. A "more" expand tap is a future enhancement — for now truncation is enough.

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/components/DayLogCard.tsx src/app/globals.css  # adjust CSS path if different
git commit -m "feat: render coachingNote on activity cards in DayLogCard"
```

---

## Task 8: Render coachBrief in calendar week view

**Files:**
- Modify: `src/app/calendar/page.tsx`

- [ ] **Step 1: Extract coachBrief from displayedPlanWeek**

In `src/app/calendar/page.tsx`, after the `weekLabel` is computed (around line 964), add:

```ts
  const weekCoachBrief = displayedPlanWeek?.coachBrief ?? null;
```

- [ ] **Step 2: Render disclosure row below the week navigation label**

Find the week-view navigation block — the `<div className="cal-month-nav">` that contains `<strong>{weekLabel}</strong>` (around line 1062). Immediately after the closing `</div>` of that nav block, add:

```tsx
              {isWeekView && weekCoachBrief && (
                <details className="cal-week-coach-brief">
                  <summary className="cal-week-coach-brief-toggle">Coach's note ›</summary>
                  <p className="cal-week-coach-brief-text">{weekCoachBrief}</p>
                </details>
              )}
```

- [ ] **Step 3: Add CSS for cal-week-coach-brief**

Find the calendar CSS file:

```bash
grep -rn "cal-month-nav\|cal-week" src/app/calendar/ | head -5
```

Add near other `cal-month-nav` styles:

```css
.cal-week-coach-brief {
  margin: 6px 0 0;
  padding: 0 12px;
}
.cal-week-coach-brief-toggle {
  font-size: 12px;
  font-weight: 600;
  color: var(--d-muted);
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.cal-week-coach-brief-toggle::-webkit-details-marker { display: none; }
.cal-week-coach-brief-text {
  margin: 4px 0 0;
  font-size: 13px;
  font-style: italic;
  color: var(--d-text);
  line-height: 1.55;
}
```

- [ ] **Step 4: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors — `coachBrief` should be on the `PlanWeek` type after Task 2 migration.

- [ ] **Step 5: Manual smoke test**

1. `npm run dev`
2. Parse a new plan from a PDF that has coach notes (use one from `scripts/fixtures/plans/`)
3. Navigate to the calendar week view
4. Verify "Coach's note ›" disclosure row appears when `coachBrief` is populated
5. Tap to expand — verify text shows correctly
6. Navigate to a day with an activity — verify `coachingNote` appears below steps when populated
7. Check an existing plan (no coaching fields) — verify no empty space or broken layout

- [ ] **Step 6: Commit**

```bash
git add src/app/calendar/page.tsx src/app/calendar/calendar.css  # adjust CSS path if different
git commit -m "feat: render coachBrief as collapsible coach note in calendar week view"
```

---

## Self-Review Checklist

- [x] Spec: Extend ProgramJsonV1 with coaching_note, session_focus, week_brief → Task 1
- [x] Spec: Prisma migration coachingNote, sessionFocus, coachBrief → Task 2
- [x] Spec: v4-to-plan.ts mapping → Task 3
- [x] Spec: Vision prompt updates → Task 4
- [x] Spec: MD parser prompt updates → Task 5
- [x] Spec: LogActivity type updated → Task 6
- [x] Spec: Activity card renders coachingNote → Task 7
- [x] Spec: Week header renders coachBrief → Task 8
- [x] Backward compatibility: all new fields nullable, existing plans unaffected → Tasks 2, 7, 8 (null-guarded renders)
- [x] Type names consistent: `coaching_note`/`coachingNote`, `session_focus`/`sessionFocus`, `week_brief`/`coachBrief` used consistently throughout
- [x] No placeholders

**One dependency note:** Task 3 (mapping) depends on Task 2 (migration). Run `npx prisma generate` after migration before running typecheck on v4-to-plan.ts. All other tasks are independent.
