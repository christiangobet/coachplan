# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## monday-activity-split-parsing — compound session rows not splitting into separate activities
- **Date:** 2026-04-08
- **Error patterns:** compound session, activity split, strength run, plus separator, single activity, session-flow, WU CD, hill repeats, interval notation, pipe separator
- **Root cause:** parseSessionRow in markdown-program-parser.ts produced exactly one SessionV1 per markdown table row. A row like "Strength 1 (...) + Easy run" was treated as one session. No compound-split logic existed, and later a session-flow pre-check was missing so structured single-session text (WU/CD/intervals/pipe separators) could be incorrectly split.
- **Fix:** Added splitCompoundSessionText() with (1) a session-flow pre-check that returns immediately for text containing WU/CD keywords, interval notation ("N x M"), or pipe "|" phase separators, and (2) a heterogeneous-type guard that only splits on top-level " + " when the resulting parts have different activity types. Added splitCompoundSessionText to the module default export. Updated parseWeekTables to use flatMap.
- **Files changed:** src/lib/parsing/markdown-program-parser.ts, scripts/fix-monday-compound-sessions.ts, scripts/markdown-program-parser.test.ts
---

