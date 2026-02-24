# Testing Patterns

**Analysis Date:** 2025-02-24

## Test Framework

**Runner:**
- NOT CONFIGURED - No test framework (Jest, Vitest, or similar) is set up in this project
- Config: None present (`jest.config.*` or `vitest.config.*` not found)

**Assertion Library:**
- Not applicable (no testing framework installed)

**Run Commands:**
```bash
# Testing is currently not available
# No test commands defined in package.json
```

## Current State

**No unit/integration tests present:**
- No `.test.ts`, `.test.tsx`, `.spec.ts`, or `.spec.tsx` files in `src/`
- No test fixtures or mocks infrastructure
- No coverage reporting configured

**Code validation occurs via:**
1. TypeScript compiler: `npm run typecheck` (type checking only)
2. ESLint: `npm run lint` (static analysis, no runtime tests)
3. Build verification: `npm run verify` runs `tsc --noEmit && next build`

## Test File Organization

**Proposed Structure (not currently in use):**

For future implementation, tests should follow:
- **Co-located pattern**: Test files sit next to source code
- **File naming**: `src/lib/day-status.test.ts` for `src/lib/day-status.ts`
- **Component tests**: `src/components/DayLogCard.test.tsx` for `src/components/DayLogCard.tsx`
- **API route tests**: `src/app/api/plan-days/[id]/complete.test.ts` for the route handler

**Directory structure (proposed):**
```
src/
├── lib/
│   ├── day-status.ts
│   ├── day-status.test.ts
│   ├── user-sync.ts
│   ├── user-sync.test.ts
│   └── ...
├── components/
│   ├── DayLogCard.tsx
│   ├── DayLogCard.test.tsx
│   └── ...
└── app/
    └── api/
        ├── plan-days/
        │   └── [id]/
        │       └── complete/
        │           ├── route.ts
        │           └── route.test.ts
        └── ...
```

## Test Structure (Proposed for Implementation)

**Suite Organization:**

Using Jest/Vitest convention:
```typescript
describe('day-status', () => {
  describe('getDayStatus', () => {
    it('returns OPEN when no tags present', () => {
      const result = getDayStatus(null);
      expect(result).toBe('OPEN');
    });

    it('prioritizes DAY_OPEN_TAG over other tags', () => {
      const notes = '[DAY_OPEN]\n[DAY_DONE]';
      expect(getDayStatus(notes)).toBe('OPEN');
    });

    it('returns DONE when DAY_DONE_TAG present', () => {
      const notes = '[DAY_DONE]';
      expect(getDayStatus(notes)).toBe('DONE');
    });
  });

  describe('setDayStatus', () => {
    it('appends status tag to existing notes', () => {
      const notes = 'Some workout notes';
      const result = setDayStatus(notes, 'DONE');
      expect(result).toContain('[DAY_DONE]');
      expect(result).toContain('Some workout notes');
    });

    it('strips old status tags when changing status', () => {
      const notes = '[DAY_DONE]';
      const result = setDayStatus(notes, 'MISSED');
      expect(result).not.toContain('[DAY_DONE]');
      expect(result).toContain('[DAY_MISSED]');
    });

    it('includes missed reason when status is MISSED', () => {
      const result = setDayStatus(null, 'MISSED', 'Weather was too bad');
      expect(result).toContain('[DAY_MISSED_REASON] Weather was too bad');
    });
  });
});
```

**Patterns:**
- Setup: Use `describe()` blocks to organize related tests
- Teardown: None needed (pure functions); Prisma mocking would be required for database tests
- Assertion: Use Jest/Vitest matchers: `expect().toBe()`, `expect().toContain()`, `expect().toThrow()`

## Mocking

**Framework:** (Not yet implemented; would use Jest mocks or `vi` from Vitest)

**Proposed Patterns:**

**Database Mocking (Prisma):**
```typescript
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    planDay: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));

test('ensureUserFromAuth creates user if not found', async () => {
  (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);
  (prisma.user.create as jest.Mock).mockResolvedValueOnce({
    id: 'auth-id', email: 'user@example.com', name: 'User',
  });

  const result = await ensureUserFromAuth(mockAuthUser);
  expect(result.email).toBe('user@example.com');
});
```

**Fetch Mocking (API calls in components):**
```typescript
global.fetch = jest.fn().mockResolvedValueOnce({
  ok: true,
  json: async () => ({ activity: { id: '123', completed: true } }),
});

// After testing:
expect(global.fetch).toHaveBeenCalledWith('/api/activities/123/complete', expect.any(Object));
```

**What to Mock:**
- Prisma database calls (return test fixtures)
- Clerk `currentUser()` and `auth()` (return mock user object)
- `fetch()` calls for external APIs (return mock response)
- Router navigation: `next/navigation` `useRouter` hook

**What NOT to Mock:**
- Pure utility functions: `getDayStatus()`, `normalizeEmail()`, `formatDistanceMeters()`
- Type predicates: `isDayExplicitlyOpen()`, `isDayMarkedDone()`
- Date manipulations within local scope (acceptable to test as integration with Date API)

## Fixtures and Factories

**Test Data (Proposed):**

Create fixture files for common test data:

```typescript
// src/lib/__fixtures__/mockAuthUser.ts
export const mockAuthUser = {
  id: 'user-123',
  primaryEmailAddress: { emailAddress: 'athlete@example.com' },
  fullName: 'Test Athlete',
  firstName: 'Test',
};

// src/lib/__fixtures__/mockActivity.ts
export const mockActivity = {
  id: 'activity-1',
  type: 'RUN',
  title: 'Morning run',
  distance: 10,
  duration: 60,
  distanceUnit: 'KM',
  paceTarget: '6:00 /km',
  completed: false,
  completedAt: null,
  actualDistance: null,
  actualDuration: null,
};

// src/lib/__fixtures__/mockPlanDay.ts
export const mockPlanDay = {
  id: 'day-1',
  notes: null,
  dayOfWeek: 1,
  activities: [mockActivity],
};
```

**Location:**
- `src/lib/__fixtures__/` - Shared test data
- `src/components/__fixtures__/` - Component-specific mock data

## Coverage

**Requirements:** None enforced (no coverage thresholds configured)

**View Coverage (Proposed):**
```bash
# Once Jest/Vitest is configured:
jest --coverage
# or
vitest run --coverage
```

Expected output: HTML report in `coverage/` directory

## Test Types

**Unit Tests (Proposed Implementation):**
- Scope: Pure functions and utilities
- Approach: Test input/output without side effects
- Examples: `day-status.ts`, `unit-display.ts`, `user-sync.ts` normalization functions
- Coverage goal: All branches of conditional logic

**Unit Test Example:**
```typescript
describe('parseNumericOrNull', () => {
  it('returns null for empty string', () => {
    expect(parseNumericOrNull('')).toBeNull();
  });

  it('returns NaN for non-numeric input', () => {
    expect(Number.isNaN(parseNumericOrNull('abc'))).toBe(true);
  });

  it('returns NaN for negative numbers', () => {
    expect(Number.isNaN(parseNumericOrNull('-5'))).toBe(true);
  });

  it('parses positive decimal numbers', () => {
    expect(parseNumericOrNull('10.5')).toBe(10.5);
  });
});
```

**Integration Tests (Proposed Implementation):**
- Scope: API routes with Prisma + auth
- Approach: Mock Prisma/Clerk, test request/response cycle
- Examples: `src/app/api/plan-days/[id]/complete/route.ts`, activity endpoints

**Integration Test Example:**
```typescript
describe('POST /api/plan-days/[id]/complete', () => {
  it('marks day as DONE and returns updated status', async () => {
    (requireRoleApi as jest.Mock).mockResolvedValueOnce({
      ok: true,
      context: { userId: 'user-123' },
    });
    (prisma.planDay.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'day-1',
      notes: null,
      plan: { athleteId: 'user-123' },
    });
    (prisma.planDay.update as jest.Mock).mockResolvedValueOnce({
      id: 'day-1',
      notes: '[DAY_DONE]',
    });

    const request = new Request('http://localhost/api/plan-days/day-1/complete', {
      method: 'POST',
      body: JSON.stringify({ status: 'DONE' }),
    });
    const response = await POST(request, { params: Promise.resolve({ id: 'day-1' }) });
    const data = await response.json();

    expect(data.day.status).toBe('DONE');
  });
});
```

**E2E Tests:**
- Framework: Playwright is installed (`playwright` ^1.58.2 in devDependencies)
- Current use: Audit/screenshot tests via manual scripts (see `scripts/capture-audit.mjs`)
- No end-to-end test suite structured in Playwright yet

## Common Patterns

**Async Testing (Proposed):**
```typescript
it('async function resolves with expected value', async () => {
  const result = await ensureUserFromAuth(mockAuthUser);
  expect(result.id).toBe('user-123');
});

it('catches async errors', async () => {
  (prisma.user.create as jest.Mock).mockRejectedValueOnce(new Error('DB error'));
  await expect(ensureUserFromAuth(invalidUser)).rejects.toThrow('DB error');
});
```

**Error Testing (Proposed):**
```typescript
describe('API route validation', () => {
  it('returns 400 when body.status is invalid', async () => {
    const request = new Request('...', {
      method: 'POST',
      body: JSON.stringify({ status: 'INVALID' }),
    });
    const response = await POST(request, { params: Promise.resolve({ id: 'day-1' }) });
    expect(response.status).toBe(400);
  });

  it('returns 404 when day not found', async () => {
    (prisma.planDay.findUnique as jest.Mock).mockResolvedValueOnce(null);
    const response = await POST(request, { params: Promise.resolve({ id: 'missing' }) });
    expect(response.status).toBe(404);
  });
});
```

## Files for Testing Priority

**High Priority (Core Logic):**
- `src/lib/day-status.ts` - Status encoding/decoding (10 pure functions)
- `src/lib/user-sync.ts` - User creation/sync logic (transactional)
- `src/lib/unit-display.ts` - Distance/pace conversions
- `src/app/api/plan-days/[id]/complete/route.ts` - Day completion endpoint

**Medium Priority (Utilities):**
- `src/lib/plan-dates.ts` - Week boundary calculations
- `src/lib/activity-actuals.ts` - Activity update builder
- Form validation helpers in components

**Low Priority (Presentation):**
- Component rendering (would require React Testing Library)
- CSS/styling logic
- API routes that primarily fetch data

---

*Testing analysis: 2025-02-24*
