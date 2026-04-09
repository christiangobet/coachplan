---
status: awaiting_human_verify
trigger: "review page stays stuck on Parsing In Progress and never auto-transitions to the plan view"
created: 2026-04-07T00:00:00Z
updated: 2026-04-07T01:30:00Z
---

## Current Focus

hypothesis: CONFIRMED (third fix) — polling runs correctly but two gaps existed:
  1. When `uploadStatus === 'completed'` (server says done), the page didn't fast-path an immediate loadPlan; it waited 3 seconds for the next interval tick.
  2. When `uploadStatus === 'completed'` AND weeks stayed 0 (server finished but DB write may have failed), the stall detector only counted API errors, not "succeeded but still 0 weeks" polls. The user saw infinite "Parsing In Progress" with no actionable message.
  3. `reviewBlockedByUpload` kept `arrivedFromUpload` always-true for any upload user even when `uploadStatus === 'completed'` — this was correct (polls until weeks appear) but needed the stall detection to close the loop.
test: (a) immediate loadPlan effect fires when uploadStatus becomes 'completed'; (b) interval counts "completed polls with 0 weeks" and shows stall UI after 5 polls (~15s); (c) reviewBlockedByUpload uses explicit status checks instead of arrivedFromUpload catchall
expecting: page transitions within seconds of server completing; stall message appears if server reported completed but DB has no weeks
next_action: user verification

## Symptoms

expected: After upload completes and the markdown-native parse finishes, the review page should detect the completion and automatically transition to show the parsed plan (weeks + activities)
actual: The page stays permanently showing 0 weeks — never auto-transitions. Manual page refresh works.
errors: Clerk auth() errors and infinite redirect loop may be contributing, but the root cause is structural
reproduction: 1) Upload PDF plan, 2) land on /plans/[id]/review?fromUpload=1, 3) initial loadPlan() returns 0 weeks (race with DB commit), 4) no polling runs because arrivedFromUpload=true disables reviewBlockedByUpload, 5) page stuck forever
started: Prior fix attempt (setInterval etc.) didn't help because the polling logic was behind the arrivedFromUpload guard

## Eliminated

- hypothesis: Polling fails silently due to Clerk auth errors
  evidence: The polling never starts at all — the issue is that reviewBlockedByUpload is permanently false when arrivedFromUpload=true
  timestamp: 2026-04-07

- hypothesis: setInterval / stall detection fixes were incomplete
  evidence: The interval IS correctly implemented, but it never starts because it's inside `if (!reviewBlockedByUpload || !planId) return` and reviewBlockedByUpload is always false
  timestamp: 2026-04-07

- hypothesis: separate catch-up poll (previous fix) would handle the race condition independently
  evidence: User reported still stuck after that fix. Either the poll wasn't firing (plan===null condition at initial render) or the poll ran silently without showing any visible progress screen, making the bug appear unfixed. Root cause was the same: reviewBlockedByUpload=false prevented the main progress screen from showing.
  timestamp: 2026-04-07

## Evidence

- timestamp: 2026-04-07T01:30:00Z
  checked: src/app/api/plans/[id]/route.ts GET handler
  found: Returns { plan: ..., viewerUnits }. Plan includes weeks via Prisma include. loadPlan correctly extracts data?.plan. No issue here.
  implication: loadPlan correctly picks up weeks when they exist in DB.

- timestamp: 2026-04-07T01:30:00Z
  checked: src/lib/plan-parse-context.ts buildParseContextSummary — uploadStatus derivation
  found: |
    uploadStatus = latestUploadLifecycle?.status ?? (job.status === 'SUCCESS' ? 'completed' : ...)
    latestUploadLifecycle.status = derived from stage: "processing" for non-completed/failed stages.
    So if lifecycle artifact stage is "markdown_available", uploadStatus = "processing" — not "completed".
    "completed" only when lifecycle artifact has stage="completed" or job.status="SUCCESS" with no artifact.
  implication: The "polling forever" scenario occurs when lifecycle shows 'processing' AND weeks = 0.
    reviewBlockedByUpload stays true (arrivedFromUpload). Polling keeps running. No stall detection fires because loadPlan returns successfully (just with 0 weeks).

- timestamp: 2026-04-07T01:30:00Z
  checked: src/lib/parsing/async-upload-processor.ts processAsyncUpload
  found: Worker stages: extracting_markdown → markdown_available → parsing_markdown → persisting_plan → completed.
    "parsing_markdown" lifecycle written BEFORE AI calls (parseExtractedMarkdownToProgram + enrichMarkdownSession).
    enrichMarkdownSession makes one OpenAI call per session, falls back on error. For large plans (80+ sessions), takes minutes.
    scheduleAsyncUploadProcessing prevents concurrent workers via globalThis registry.
  implication: UI showing "parsing_markdown" = server is in the AI enrichment loop. This is expected.
    "never auto-transitions" most likely means: (a) server takes too long and user gives up, OR (b) dev server hot-reload kills the worker and a new one starts from scratch repeatedly.
    In either case: once the worker completes, loadPlan will pick up weeks. But there was no fast-path and no stall detection for "completed but empty" case.

- timestamp: 2026-04-07T01:30:00Z
  checked: reviewBlockedByUpload + polling effect interaction when uploadStatus='completed'
  found: When server finishes (uploadStatus='completed'), the polling was waiting up to 3 seconds for next tick.
    Also: the stall detector only counts loadPlan API failures, not "succeeded but 0 weeks" — so if uploadStatus='completed' and weeks=0 (something went wrong server-side), the page would poll indefinitely with no user feedback.
  implication: Two missing mechanisms: (1) immediate loadPlan on completed, (2) stall detection for completed+empty state.

- timestamp: 2026-04-07
  checked: review/page.tsx line 838-843 — reviewBlockedByUpload definition
  found: |
    const reviewBlockedByUpload = Boolean(
      !arrivedFromUpload        // ← ALWAYS FALSE when ?fromUpload=1 is in URL
      && plan
      && plan.weeks.length === 0
      && uploadState.uploadStatus === 'processing'
    );
  implication: Boolean(false && ...) === false always. The guard is permanently disabled for every user coming from the upload flow.

- timestamp: 2026-04-07
  checked: review/page.tsx line 845-867 — polling useEffect
  found: |
    if (!reviewBlockedByUpload || !planId) return;  // always returns early
    const interval = window.setInterval(...)        // NEVER REACHED
  implication: setInterval polling never runs for arrivedFromUpload paths

- timestamp: 2026-04-07
  checked: upload/page.tsx line 203-210 — when redirect fires
  found: redirect happens when data.status === 'completed' — AFTER the upload worker saves stage:completed
  implication: redirect happens immediately after upload pipeline completion, but before the browser can fetch the plan. Initial loadPlan() on the review page may race with DB commit visibility.

- timestamp: 2026-04-07
  checked: async-upload-processor.ts lines 189-217 — completion sequence
  found: populatePlanFromV4 (persists weeks to DB) → saveUploadLifecycleStatus(completed) → updateParseJobStatus(SUCCESS). The lifecycle artifact is saved AFTER weeks are persisted.
  implication: When the upload page poll reads status=completed, weeks should already be in DB. But the review page's first loadPlan() may still race with commit visibility (network latency, connection pool read lag).

- timestamp: 2026-04-07
  checked: arrivedFromUpload definition
  found: const arrivedFromUpload = searchParams?.get('fromUpload') === '1'
  implication: ALL paths from upload flow (upload page redirect, dashboard link, plans list) pass ?fromUpload=1, so the guard is disabled for all normal user flows.

## Resolution

root_cause: |
  Multiple compounding issues:
  1. (fixed in prior session) `reviewBlockedByUpload` had `!arrivedFromUpload` which permanently disabled the polling for upload users.
  2. (fixed in this session) When `uploadStatus === 'completed'` (server confirmed done), there was no fast-path to immediately call loadPlan — the UI waited up to 3 seconds for the next interval tick.
  3. (fixed in this session) The stall detector only counted API errors (loadPlan returning undefined). It did NOT count "successful poll but still 0 weeks after server reported completed" — leaving users stuck forever with no actionable message or recovery.
  4. (fixed in this session) `reviewBlockedByUpload` used `arrivedFromUpload` as an always-true catch-all, which was correct functionally but didn't distinguish the null/processing/completed states, making the stall detection inside the interval ineffective.

fix: |
  Three targeted changes to src/app/plans/[id]/review/page.tsx:
  
  1. reviewBlockedByUpload now uses explicit status checks:
     `uploadStatus === 'processing' || uploadStatus === 'completed' || (uploadStatus === null && arrivedFromUpload)`
     - 'failed' status intentionally excluded: lets the plan render with 0 weeks + parse-debug tools
  
  2. New immediate-reload effect:
     When uploadStatus transitions to 'completed', immediately call loadPlan({ silent: true })
     so the page transitions without waiting for the next 3-second interval tick.
  
  3. Enhanced stall detection in the polling interval:
     Tracks `completedPollsWithNoWeeks` — increments when loadPlan succeeds (returns a plan)
     but weeks are still 0 AND uploadStatus === 'completed'. After 5 polls (~15 seconds),
     sets uploadPollStalled=true and shows a specific message: "Parsing finished on the server
     but the plan appears empty. Try refreshing to load it."
  
  TypeScript typecheck: passed (tsc --noEmit clean)

verification: awaiting human verification in browser
files_changed: [src/app/plans/[id]/review/page.tsx]
