# Coding Conventions

**Analysis Date:** 2025-02-24

## Naming Patterns

**Files:**
- Page files use `.tsx` extension: `page.tsx`, `layout.tsx`
- API routes: `route.ts` inside dynamic directories: `src/app/api/[resource]/[id]/[action]/route.ts`
- Components: PascalCase: `DayLogCard.tsx`, `ActivityTypeIcon.tsx`
- Utility/library files: camelCase: `user-sync.ts`, `day-status.ts`, `ai-plan-parser.ts`
- Styling: `*.css` co-located with pages/components: `calendar.css`, `dashboard.css`

**Functions:**
- Async functions: camelCase with clear action verbs: `ensureUserFromAuth()`, `submitActivity()`, `saveDayStatus()`
- Helper/utility functions: camelCase, descriptive: `normalizeEmail()`, `parseNumericOrNull()`, `formatDistanceMeters()`
- React components: PascalCase exported as default
- Type predicates: prefix with `is` or `get`: `isDayExplicitlyOpen()`, `getDayStatus()`, `getDayMissedReason()`

**Variables:**
- Local state variables: camelCase: `dayStatus`, `syncBusy`, `missedReason`
- Constants (immutable): UPPER_SNAKE_CASE: `DAY_DONE_TAG`, `WEEKDAY_LABELS`, `TYPE_GLOSSARY_ORDER`
- Query parameters: camelCase with clear scope: `requestedPlanId`, `selectedDate`, `returnToParam`
- Map/record keys: camelCase: `activitiesByDate`, `dayInfoByDate`, `forms`

**Types:**
- Component props type: `[ComponentName]Props`: `ActivityTypeIconProps`
- Union types: descriptive PascalCase: `DayStatus`, `ActivityType`, `MatchLevel`, `SyncTone`
- State shape objects: PascalCase: `StravaImportSummary`, `StravaSyncDecision`, `ActivityFormState`, `DayInfo`
- Record types for data mappings: `Record<KeyType, ValueType>`: `Record<ActivityType, string>`

## Code Style

**Formatting:**
- Tool: ESLint with `eslint-config-next` (Next.js recommended rules)
- Config: `eslint.config.mjs` (flat config format)
- Line length: Not explicitly enforced; observe existing code (~1000 chars in some cases)
- Indentation: 2 spaces (standard Next.js)
- Quotes: Double quotes in JSX/TypeScript (ESLint default)

**Linting:**
- Tool: ESLint 9.x with `@typescript-eslint` rules
- Key rule: `@typescript-eslint/no-explicit-any` is OFF (allowing `any` type)
- Scripts: `npm run lint` runs ESLint check

**TypeScript:**
- Target: ES2017
- Strict mode: ENABLED
- Module resolution: `bundler` (Node.js-compatible)
- Lib: dom, dom.iterable, esnext
- JSX: react-jsx (automatic runtime)

## Import Organization

**Order:**
1. React/Next.js core imports (from `react`, `next/*`)
2. Clerk imports (from `@clerk/nextjs/*`)
3. Prisma imports
4. Utility imports (from `@/lib/*`)
5. Component imports (from `@/components/*`)
6. Type imports (when using `import type`)
7. CSS imports (at end of file)

**Path Aliases:**
- Single alias used: `@/*` → `./src/*`
- All absolute imports use `@/` prefix: `@/lib/prisma`, `@/components/DayLogCard`
- No relative imports (`../`) in files that can use alias

**Example from `src/app/calendar/page.tsx`:**
```typescript
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { getDayDateFromWeekStart, resolveWeekBounds } from "@/lib/plan-dates";
import { ensureUserFromAuth } from "@/lib/user-sync";
import { getDayMissedReason, getDayStatus, isDayExplicitlyOpen, type DayStatus } from "@/lib/day-status";
import AthleteSidebar from "@/components/AthleteSidebar";
import DayLogCard from "@/components/DayLogCard";
import "../dashboard/dashboard.css";
import "./calendar.css";
```

## Error Handling

**Patterns:**

**API Routes:**
- Catch errors early with null/undefined checks: `if (!day) return NextResponse.json({ error: 'Day not found' }, { status: 404 });`
- Explicit status codes: 400 (bad request), 401 (unauthorized), 403 (forbidden), 404 (not found)
- Error response format: `{ error: string }` with descriptive message
- Always validate request body: `const body = (await req.json().catch(() => ({}))) as Body;`

**Example from `src/app/api/plan-days/[id]/complete/route.ts`:**
```typescript
const body = (await req.json().catch(() => ({}))) as Body;
const day = await prisma.planDay.findUnique({ where: { id }, select: { ... } });
if (!day) return NextResponse.json({ error: 'Day not found' }, { status: 404 });
if (day.plan.athleteId !== access.context.userId) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

**Client Components:**
- Try-catch blocks around fetch calls with fallback error messages
- State-based error display: `error` state field holds error message for UI
- Network errors default to generic message: `'Failed to save log'` or `'Failed to sync Strava day log'`

**Example from `src/components/DayLogCard.tsx`:**
```typescript
try {
  const res = await fetch(endpoint, { method, headers, body });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    patchForm(activity.id, { busy: false, error: body?.error || 'Failed to save log' });
    return;
  }
} catch {
  patchForm(activity.id, { busy: false, error: 'Failed to save log' });
}
```

## Logging

**Framework:** `console` (no centralized logging library)

**Patterns:**
- Prisma logs errors/warnings: `new PrismaClient({ log: ['error', 'warn'] })` in `src/lib/prisma.ts`
- No explicit console.log() calls in tracked source code
- Debug output deferred to error state messages passed to UI

## Comments

**When to Comment:**
- Explain WHY, not WHAT: Comments describe reasoning, not code logic
- Tag markers when needed: Tag system notes with `//` for clarity on business logic decisions
- Note backward compatibility concerns: e.g., "Keep stable DB user id to avoid FK breakage when user already has linked records."

**JSDoc/TSDoc:**
- Minimal use; types speak for themselves in most cases
- Only used for complex type definitions or when public contract is unclear
- Example: `type EnsureUserOptions = { defaultRole?: UserRole; defaultCurrentRole?: UserRole; };`

## Function Design

**Size:** Functions range from 10–200 lines
- Helper utilities: 5–30 lines (normalizers, formatters)
- Component handlers: 30–100 lines (form submission, state management)
- Page components: 200+ lines (acceptable for complex page logic due to server-side data fetching)

**Parameters:**
- Named parameters using destructuring when 2+ params: `{ params }: { params: Promise<{ id: string }> }`
- Avoid positional args in function signatures; use objects for options
- Optional params marked with `?`: `options?: EnsureUserOptions`

**Return Values:**
- Async functions return `Promise<T>` where T is the primary data type
- API routes return `NextResponse` always
- Helper functions return the specific type: `string`, `Date`, `null` (not undefined when null is semantic)
- Validation functions return `{ provided: boolean; value?: T; error?: string }` to distinguish "not provided" from "invalid"

## Module Design

**Exports:**
- Default export for single-export modules (React components): `export default function DayLogCard() { ... }`
- Named exports for utility functions: `export { prisma }`, `export function getDayStatus() { ... }`
- No barrel exports within `src/lib` (individual file imports preferred for clarity)

**Barrel Files:**
- Not commonly used; imports point directly to utility files
- Example: `import { getDayStatus } from "@/lib/day-status"` not `import { getDayStatus } from "@/lib"`

## Database & State

**Prisma Patterns:**
- Singleton client: `src/lib/prisma.ts` with global augmentation
- Always specify `.select()` to minimize data transfer; only fetch needed fields
- Use `.include()` for relationships rather than multiple queries
- Transactions for multi-step operations: `prisma.$transaction(async (tx) => { ... })`

**State Metadata in Notes Field:**
- Day completion status encoded in `planDay.notes` field as tags: `[DAY_DONE]`, `[DAY_MISSED]`, `[DAY_PARTIAL]`, `[DAY_OPEN]`
- Missed reason appended: `[DAY_MISSED_REASON] user's explanation text`
- Parser functions: `getDayStatus()`, `setDayStatus()`, `getDayMissedReason()` manage encoding/decoding

## Testing Helpers

**Utility Validation:**
- Helper functions validate at module boundary: `normalizeEmail()`, `normalizeDistanceUnit()`
- Parsing functions catch errors explicitly: `parseNumericOrNull()` returns `NaN` for invalid input (tested with `Number.isNaN()`)
- Type-narrowing predicates for runtime checks: `typeof raw === 'string'`, `Number.isFinite()`

---

*Convention analysis: 2025-02-24*
