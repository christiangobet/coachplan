# Resolve Role Stall Fix Implementation Plan

> **Status: COMPLETED** — implemented and merged to main

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the intermittent `/auth/resolve-role` stall so signed-in users consistently land on the correct home screen without needing a manual refresh.

**Architecture:** The fix should reduce duplicated auth/role-resolution work, make transient failures observable instead of silently returning `null`, and introduce a clearer retry/recovery path for the resolve-role screen. The recommended approach is to centralize role-resolution decision logic, skip unnecessary role lookups in the root layout for auth/public routes, and add targeted instrumentation plus regression coverage.

**Tech Stack:** Next.js App Router, React Server Components, Clerk auth, Prisma, TypeScript, Node test scripts for regression coverage

---

## Investigation Summary

Evidence from the current code suggests several plausible failure modes:

1. **Duplicate role resolution on the same request**
   - `src/app/layout.tsx` calls `getCurrentUserRoleContext()` for nearly every route, including `/auth/resolve-role`.
   - `src/app/auth/resolve-role/page.tsx` calls `getCurrentUserRoleContext()` again.
   - This means Clerk + DB sync + role inference can run twice during the first post-auth navigation.

2. **Silent failure collapse**
   - `src/lib/user-roles.ts` catches `currentUser`, `ensureUserFromAuth`, and role-inference errors, logs them, and returns `null`.
   - `src/app/auth/resolve-role/page.tsx` cannot distinguish “signed out” from “transient auth/DB failure”.

3. **Retry path is too opaque**
   - `resolve-role` retries with query params, but shows no explicit loading or recovery state.
   - From the user perspective, that can feel like a stuck page.

4. **Auth routes pay unnecessary app-shell work**
   - `src/app/layout.tsx` builds signed-in navigation context even on sign-in, sign-up, select-role, and resolve-role surfaces.
   - That increases the chance of race conditions and latency during the most timing-sensitive flow.

These are inferences from the local code path and should be validated with instrumentation during implementation.

## Options

### Option A: Minimal hardening

Add logging and a clearer retry UI to `resolve-role`, but leave the architecture mostly intact.

- **Impact:** Faster diagnosis, slightly better UX
- **Effort:** Low
- **Risk:** Core race/duplication issue may remain
- **What to measure:** frequency of `resolve-role` retries and refresh-required sessions

### Option B: Recommended balanced fix

Remove duplicate role-resolution work from auth/public routes, extract decision logic into a dedicated helper, and make retry/recovery states explicit.

- **Impact:** Best balance of correctness, UX, and regression control
- **Effort:** Medium
- **Risk:** Moderate; touches shared layout and auth decision flow
- **What to measure:** drop in resolve-role retries, drop in stalled auth sessions, time-to-home after sign-in

### Option C: Full auth-bootstrap redesign

Move role resolution into a dedicated API/bootstrap layer with client polling and cached session state.

- **Impact:** Most flexible long-term
- **Effort:** High
- **Risk:** Overkill for current symptom; larger auth regression surface
- **What to measure:** same as Option B plus auth bootstrap error rate

## Recommendation

Choose **Option B**.

It targets the two strongest likely causes:
- duplicated role-resolution work on `/auth/resolve-role`
- hidden transient failures collapsing to `null`

It is also small enough to ship safely without redesigning the whole auth model.

## Implementation Outline

### Task 1: Add observability around resolve-role outcomes

**Files:**
- Modify: `src/lib/user-roles.ts`
- Modify: `src/app/auth/resolve-role/page.tsx`
- Optional Create: `scripts/resolve-role-flow.test.ts`

**Step 1: Add structured outcome logging in `getCurrentUserRoleContext`**

Capture:
- `currentUser` read failure
- `ensureUserFromAuth` failure
- role inference failure
- total time spent resolving role context

**Step 2: Add explicit logging in `resolve-role` page**

Log:
- retry count
- whether `auth().userId` exists when role context is missing
- final redirect destination

**Step 3: Write a failing regression test or harness for resolver outcomes**

Prefer a small testable helper over trying to test the page directly.

Run:

```bash
node --test --experimental-strip-types scripts/resolve-role-flow.test.ts
```

Expected: FAIL for the current duplicated/opaque behavior until the helper is introduced.

**Step 4: Commit instrumentation groundwork**

```bash
git add src/lib/user-roles.ts src/app/auth/resolve-role/page.tsx scripts/resolve-role-flow.test.ts
git commit -m "test: add resolve role outcome coverage"
```

### Task 2: Extract resolve-role decision logic into a dedicated helper

**Files:**
- Create: `src/lib/auth/resolve-role.ts`
- Modify: `src/app/auth/resolve-role/page.tsx`
- Test: `scripts/resolve-role-flow.test.ts`

**Step 1: Create a pure helper that maps inputs to an outcome**

The helper should accept:
- `roleContext`
- `userId present / absent`
- `retryCount`

And return one of:
- retry resolve-role
- redirect sign-in
- redirect role home
- update current role then redirect

**Step 2: Write failing tests for each branch**

Cover:
- transient missing role context with signed-in user
- inactive user
- multi-role user with valid current role
- single-role user with mismatched current role
- exhausted retries

**Step 3: Implement the helper minimally**

Keep page logic thin and move branching into the helper.

**Step 4: Re-run the regression test**

Run:

```bash
node --test --experimental-strip-types scripts/resolve-role-flow.test.ts
```

Expected: PASS

**Step 5: Commit the helper extraction**

```bash
git add src/lib/auth/resolve-role.ts src/app/auth/resolve-role/page.tsx scripts/resolve-role-flow.test.ts
git commit -m "refactor: extract resolve role decision helper"
```

### Task 3: Stop root layout from resolving role context on auth/public routes

**Files:**
- Modify: `src/app/layout.tsx`
- Review: `src/app/page.tsx`
- Review: `src/app/sign-in/[[...sign-in]]/page.tsx`
- Review: `src/app/sign-up/[[...sign-up]]/page.tsx`
- Review: `src/app/select-role/page.tsx`

**Step 1: Define a public/auth route allowlist in layout**

Include at minimum:
- `/`
- `/sign-in`
- `/sign-up`
- `/auth/resolve-role`
- `/select-role`
- `/privacy`
- `/terms`

**Step 2: Skip `getCurrentUserRoleContext()` for those routes**

This removes duplicate Clerk + Prisma work during sign-in and resolve-role transitions.

**Step 3: Keep signed-in app chrome only where needed**

Ensure athlete/coach/admin routes still render role-aware navigation.

**Step 4: Verify auth routes still render correctly**

Check:
- sign-in page
- sign-up page
- resolve-role page
- select-role page

**Step 5: Commit the layout scope reduction**

```bash
git add src/app/layout.tsx
git commit -m "fix: skip role resolution on auth routes"
```

### Task 4: Replace opaque retry behavior with explicit recovery state

**Files:**
- Modify: `src/app/auth/resolve-role/page.tsx`
- Optional Create: `src/app/auth/resolve-role/loading.tsx`
- Optional Modify: `src/app/auth.module.css` or route-local styles if needed

**Step 1: Show an intentional resolving state**

Display:
- “Setting up your account…”
- short explanation
- visible retry/fallback state after the retry budget is exhausted

**Step 2: Keep auto-retry bounded**

Retain a small retry budget, but stop silently bouncing without user context.

**Step 3: Add a manual recovery path**

For example:
- “Try again”
- “Go to sign in”

**Step 4: Make failure modes explicit**

Differentiate:
- signed-out
- inactive account
- transient setup delay
- unrecoverable sync failure

**Step 5: Commit recovery UX**

```bash
git add src/app/auth/resolve-role/page.tsx src/app/auth/resolve-role/loading.tsx src/app/auth.module.css
git commit -m "fix: add explicit resolve role recovery state"
```

### Task 5: Tighten `getCurrentUserRoleContext` contracts

**Files:**
- Modify: `src/lib/user-roles.ts`
- Optional Modify: `src/lib/user-sync.ts`
- Test: `scripts/resolve-role-flow.test.ts`

**Step 1: Stop collapsing every failure into plain `null`**

Prefer returning or throwing typed failure reasons internally, even if the page still maps them to redirects.

**Step 2: Separate “not signed in” from “sync failed”**

This is critical so resolve-role can choose the right recovery path.

**Step 3: Keep `inferRolesFromData` non-fatal**

Role inference should never block access if base user identity is already known.

**Step 4: Verify first-sign-in flow still creates or resolves DB users safely**

Review the email-based fallback behavior in `ensureUserFromAuth`.

**Step 5: Commit contract hardening**

```bash
git add src/lib/user-roles.ts src/lib/user-sync.ts scripts/resolve-role-flow.test.ts
git commit -m "fix: distinguish resolve role failure states"
```

### Task 6: Verify the end-to-end role flow

**Files:**
- Review: `src/app/auth/resolve-role/page.tsx`
- Review: `src/app/select-role/page.tsx`
- Review: `src/app/layout.tsx`

**Step 1: Verify happy paths**

Test:
- athlete-only user
- coach-only user
- multi-role user
- inactive user

**Step 2: Verify first-login timing path**

Simulate:
- just-signed-in user redirected to `/auth/resolve-role`
- transient delayed user-context read

**Step 3: Verify no manual refresh is required**

Expected: user lands on the correct destination or sees an actionable recovery state.

**Step 4: Run checks**

Run:

```bash
npm run typecheck
npm run lint
node --test --experimental-strip-types scripts/resolve-role-flow.test.ts
```

Expected:
- typecheck passes
- lint passes
- regression test passes

**Step 5: Commit verification-complete fix**

```bash
git add src/app/auth/resolve-role/page.tsx src/app/layout.tsx src/lib/user-roles.ts src/lib/user-sync.ts scripts/resolve-role-flow.test.ts
git commit -m "fix: prevent intermittent resolve role stalls"
```

## Analytics and Monitoring

Add lightweight events or logs for:
- `resolve_role_started`
- `resolve_role_retry`
- `resolve_role_failed_transient`
- `resolve_role_failed_signed_out`
- `resolve_role_redirected`
- `resolve_role_manual_retry_clicked`

Success metric:
- reduce refresh-required resolve-role sessions to near zero

## Risks

- Touching `src/app/layout.tsx` affects all signed-in routes
- Changing failure contracts in `getCurrentUserRoleContext` can affect other auth guards
- Over-aggressive retry logic could hide real auth problems instead of surfacing them

## Out of Scope

- Full Clerk/auth architecture redesign
- Coach/admin navigation redesign
- Role model changes in the database
