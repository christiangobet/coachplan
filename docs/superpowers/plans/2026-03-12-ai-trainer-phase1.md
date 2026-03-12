# AI Trainer Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI trainer feel like an observing coach — persisting chat history to DB, reacting to drag/drop moves, generating edit session summaries, and grounding advice in real Strava/manual performance data.

**Architecture:** Two new Prisma tables (`PlanChatMessage`, `PlanChangeLog`) store all chat and plan-change history. A new `/chat` API route handles all AI interactions synchronously (no polling). The plan page gains edit-session tracking, 5s-debounced drag/drop AI triggers, and simplified conversational proposal rendering.

**Tech Stack:** Next.js 16 App Router, Prisma + PostgreSQL, TypeScript, Clerk auth, OpenAI (via existing `src/lib/openai.ts`)

**Spec:** `docs/superpowers/specs/2026-03-12-ai-trainer-phase1-design.md`

**Verification commands:**
- `npm run typecheck` — TypeScript errors
- `npm run lint` — ESLint
- `npm run build` — full build check
- Dev server: `npm run dev` (runs on http://localhost:3001)

---

## Chunk 1: Database Layer + API Routes

### Task 1: Add PlanChatMessage and PlanChangeLog to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1.1: Add new models to schema.prisma**

Open `prisma/schema.prisma`. After the `TrainingPlan` model (ends around line 168), add:

```prisma
model PlanChatMessage {
  id        String       @id @default(cuid())
  planId    String
  plan      TrainingPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  role      String       // "athlete" | "coach" | "system"
  content   String
  metadata  Json?
  createdAt DateTime     @default(now())

  @@index([planId, createdAt])
}

model PlanChangeLog {
  id            String       @id @default(cuid())
  planId        String
  plan          TrainingPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  source        String       // "manual_drag" | "ai_applied" | "manual_edit"
  changeType    String       // "move_activity" | "edit_activity" | "add_activity" | "delete_activity"
  activityId    String?
  fromDayId     String?
  toDayId       String?
  before        Json?
  after         Json?
  editSessionId String?
  createdAt     DateTime     @default(now())

  @@index([planId, createdAt])
  @@index([planId, editSessionId])
}
```

- [ ] **Step 1.2: Add back-relations to TrainingPlan**

In the `TrainingPlan` model, after the last existing relation (e.g. `bannerImage`), add:

```prisma
  chatMessages PlanChatMessage[]
  changeLogs   PlanChangeLog[]
```

- [ ] **Step 1.3: Run Prisma migration**

```bash
npx prisma migrate dev --name add_plan_chat_and_change_log
```

Expected: migration file created in `prisma/migrations/`, Prisma client regenerated. No errors.

- [ ] **Step 1.4: Verify TypeScript sees new models**

```bash
npm run typecheck
```

Expected: zero errors. If Prisma client isn't updated, run `npx prisma generate` first.

- [ ] **Step 1.5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add PlanChatMessage and PlanChangeLog to schema"
```

---

### Task 2: Create plan-chat-types.ts — shared TypeScript types

**Files:**
- Create: `src/lib/plan-chat-types.ts`

- [ ] **Step 2.1: Write the types file**

```typescript
// src/lib/plan-chat-types.ts
// Shared types for chat messages, change log, and proposal state.
// These mirror the Prisma JSON fields — keep in sync with spec.

import type { PlanAdjustmentProposal } from './plan-editor';

export type ChatMessageRole = 'athlete' | 'coach' | 'system';
export type ProposalState = 'active' | 'applied' | 'superseded';

export interface MessageMetadata {
  proposal?: PlanAdjustmentProposal;
  state?: ProposalState;
  changeLogIds?: string[];
  // For system messages that describe a move
  moveDescription?: string;
}

export interface DaySnapshot {
  dayId: string;
  activities: Array<{
    id: string;
    type: string;
    subtype: string | null;
    title: string;
    duration: number | null;
    distance: number | null;
    distanceUnit: string | null;
    priority: string | null;
  }>;
}

export interface ChatMessage {
  id: string;
  planId: string;
  role: ChatMessageRole;
  content: string;
  metadata: MessageMetadata | null;
  createdAt: string; // ISO string
}
```

- [ ] **Step 2.2: Verify no type errors**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 2.3: Commit**

```bash
git add src/lib/plan-chat-types.ts
git commit -m "feat: add plan chat types"
```

---

### Task 3: POST /api/plans/[id]/edit-session

Called when athlete enters edit mode. Returns a server-generated `editSessionId`.

**Files:**
- Create: `src/app/api/plans/[id]/edit-session/route.ts`

- [ ] **Step 3.1: Write the route**

```typescript
// src/app/api/plans/[id]/edit-session/route.ts
import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { createId } from '@paralleldrive/cuid2';
import { prisma } from '@/lib/prisma';
import { ensureUserFromAuth } from '@/lib/user-sync';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: planId } = await params;
  const clerkUser = await currentUser();
  if (!clerkUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await ensureUserFromAuth(clerkUser);

  const plan = await prisma.trainingPlan.findFirst({
    where: {
      id: planId,
      OR: [{ ownerId: user.id }, { athleteId: user.id }]
    },
    select: { id: true }
  });
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const editSessionId = createId();
  return NextResponse.json({ editSessionId });
}
```

Note: `createId` from `@paralleldrive/cuid2`. Check if the package exists:

```bash
grep -r "cuid2\|@paralleldrive" /Users/christiangobet/CODEX/coachplan/package.json
```

If not present, use Node's built-in crypto instead:

```typescript
import { randomUUID } from 'node:crypto';
// ...
const editSessionId = randomUUID();
```

- [ ] **Step 3.2: Verify typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3.3: Test manually**

With dev server running (`npm run dev`), open the browser dev tools console on the plan page and run:

```javascript
fetch('/api/plans/PLAN_ID/edit-session', { method: 'POST' })
  .then(r => r.json()).then(console.log)
```

Expected: `{ editSessionId: "..." }`

- [ ] **Step 3.4: Commit**

```bash
git add src/app/api/plans/[id]/edit-session/route.ts
git commit -m "feat: add edit-session endpoint"
```

---

### Task 4: GET /api/plans/[id]/chat

Returns last N chat messages for page-load hydration.

**Files:**
- Create: `src/app/api/plans/[id]/chat/route.ts`

- [ ] **Step 4.1: Write the GET handler**

Create the file with only GET for now (POST added in Task 5):

```typescript
// src/app/api/plans/[id]/chat/route.ts
import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { ensureUserFromAuth } from '@/lib/user-sync';
import type { ChatMessage } from '@/lib/plan-chat-types';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: planId } = await params;
  const clerkUser = await currentUser();
  if (!clerkUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await ensureUserFromAuth(clerkUser);

  const plan = await prisma.trainingPlan.findFirst({
    where: {
      id: planId,
      OR: [{ ownerId: user.id }, { athleteId: user.id }]
    },
    select: { id: true }
  });
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 100);

  const messages = await prisma.planChatMessage.findMany({
    where: { planId },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  const result: ChatMessage[] = messages.map((m) => ({
    id: m.id,
    planId: m.planId,
    role: m.role as ChatMessage['role'],
    content: m.content,
    metadata: m.metadata as ChatMessage['metadata'],
    createdAt: m.createdAt.toISOString(),
  }));

  return NextResponse.json({ messages: result });
}
```

- [ ] **Step 4.2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4.3: Test manually**

```bash
curl http://localhost:3001/api/plans/PLAN_ID/chat
```

Expected: `{ messages: [] }` (empty initially).

- [ ] **Step 4.4: Commit**

```bash
git add src/app/api/plans/[id]/chat/route.ts
git commit -m "feat: add GET /chat endpoint for history hydration"
```

---

### Task 5: Performance context builder

Builds the 14-day Strava + manual activity summary string for AI calls.

**Files:**
- Create: `src/lib/plan-performance-context.ts`

- [ ] **Step 5.1: Write the builder**

```typescript
// src/lib/plan-performance-context.ts
// Builds a human-readable summary of the athlete's last 14 days of
// completed activities (Strava-matched + manually logged) for AI context.

import { prisma } from '@/lib/prisma';

function formatPace(secPerKm: number | null | undefined): string | null {
  if (!secPerKm) return null;
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}/km`;
}

function formatDistance(distanceM: number | null | undefined): string | null {
  if (!distanceM) return null;
  return `${(distanceM / 1000).toFixed(1)}km`;
}

function resolveActivityDate(activity: {
  completedAt: Date | null;
  day: {
    dayOfWeek: number;
    week: { startDate: Date | null };
  };
}): Date | null {
  if (activity.completedAt) return activity.completedAt;
  const startDate = activity.day.week.startDate;
  if (!startDate) return null;
  const date = new Date(startDate);
  date.setDate(date.getDate() + (activity.day.dayOfWeek - 1));
  return date;
}

export async function buildPerformanceContext(planId: string): Promise<string> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);

  const activities = await prisma.planActivity.findMany({
    where: {
      planId,
      completed: true,
      OR: [
        { completedAt: { gte: cutoff } },
        { completedAt: null } // fallback: include and filter by derived date below
      ]
    },
    select: {
      id: true,
      title: true,
      type: true,
      completedAt: true,
      actualPace: true,
      actualDuration: true,
      actualDistance: true,
      day: {
        select: {
          dayOfWeek: true,
          week: { select: { startDate: true } }
        }
      },
      externalActivities: {
        where: { matchedPlanActivityId: { not: null } },
        select: {
          avgHeartRate: true,
          movingTimeSec: true,
          distanceM: true,
          avgPaceSecPerKm: true,
        },
        take: 1,
      }
    },
    orderBy: { completedAt: 'desc' },
    take: 30,
  });

  const recentActivities = activities.filter((a) => {
    const date = resolveActivityDate(a);
    return date && date >= cutoff;
  });

  if (recentActivities.length === 0) return '';

  const lines = recentActivities.map((a) => {
    const date = resolveActivityDate(a);
    const dateStr = date
      ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'Unknown date';

    const strava = a.externalActivities[0];
    const hasStrava = !!strava;

    const distance = hasStrava
      ? formatDistance(strava.distanceM)
      : a.actualDistance ? `${a.actualDistance}km` : null;

    const pace = hasStrava
      ? formatPace(strava.avgPaceSecPerKm)
      : a.actualPace ?? null;

    const hr = hasStrava && strava.avgHeartRate
      ? `, HR ${strava.avgHeartRate}`
      : '';

    const source = hasStrava ? '[Strava]' : '[manual]';

    const parts = [distance, pace ? `@ ${pace}` : null].filter(Boolean).join(' ');
    return `  ${dateStr} — ${a.title}${parts ? ` ${parts}` : ''}${hr} ${source}`;
  });

  return `Recent performance (last 14 days):\n${lines.join('\n')}`;
}
```

- [ ] **Step 5.2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors. If `externalActivities` relation errors appear, check the Prisma schema relation name — it is `externalActivities` via `@relation("MatchedPlanActivity")` on `ExternalActivity.matchedPlanActivityId`.

- [ ] **Step 5.3: Commit**

```bash
git add src/lib/plan-performance-context.ts
git commit -m "feat: add performance context builder for AI"
```

---

## Chunk 2: AI Chat Handler + Client Integration

### Task 6: Core AI chat handler — src/lib/plan-chat-ai.ts

Handles all three triggers: `athlete_message`, `drag_drop`, `edit_session_end`.

**Files:**
- Create: `src/lib/plan-chat-ai.ts`

- [ ] **Step 6.1: Understand the AI call convention**

The existing `openaiJsonSchema` helper takes a **single `input` string** (not a messages array).
Signature (from `src/lib/openai.ts` line 314):
```typescript
openaiJsonSchema<T>(opts: {
  input: string;                      // All context merged into one string
  schema: { name: string; schema: Record<string, unknown>; strict?: boolean };
  model?: string;
  maxOutputTokens?: number;
})
```
`getDefaultAiModel()` is synchronous — call without `await`.

The conversation history and system prompt are both merged into `input`. Pattern from existing callers:
```typescript
const input = `[SYSTEM] You are an experienced endurance running coach.\n\n[CONTEXT]\n${context}\n\n[REQUEST]\n${athleteMessage}`;
```

- [ ] **Step 6.2: Write the AI handler**

```typescript
// src/lib/plan-chat-ai.ts
import { prisma } from '@/lib/prisma';
import { getDefaultAiModel, openaiJsonSchema } from '@/lib/openai';
import { buildPerformanceContext } from '@/lib/plan-performance-context';
import type { ChatMessage, MessageMetadata, DaySnapshot } from '@/lib/plan-chat-types';

async function getRecentMessages(planId: string, limit = 30) {
  const messages = await prisma.planChatMessage.findMany({
    where: { planId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return messages.reverse();
}

function serializeConversation(messages: Awaited<ReturnType<typeof getRecentMessages>>): string {
  if (messages.length === 0) return '';
  return '[CONVERSATION HISTORY]\n' + messages.map((m) => {
    const label = m.role === 'athlete' ? 'Athlete' : m.role === 'coach' ? 'Coach' : 'System';
    return `${label}: ${m.content}`;
  }).join('\n');
}

export async function handleAthleteMessage(
  planId: string,
  content: string
): Promise<ChatMessage> {
  // 1. Mark any existing active coach messages as superseded
  const activeMessages = await prisma.planChatMessage.findMany({
    where: { planId, role: 'coach' },
    select: { id: true, metadata: true },
  });
  for (const msg of activeMessages) {
    const meta = (msg.metadata as MessageMetadata | null) ?? {};
    if (meta.state === 'active') {
      await prisma.planChatMessage.update({
        where: { id: msg.id },
        data: { metadata: { ...meta, state: 'superseded' } },
      });
    }
  }

  // 2. Save athlete message
  await prisma.planChatMessage.create({
    data: { planId, role: 'athlete', content },
  });

  // 3. Build context
  const [recentMessages, performanceContext] = await Promise.all([
    getRecentMessages(planId),
    buildPerformanceContext(planId),
  ]);

  const recentChanges = await prisma.planChangeLog.findMany({
    where: { planId, createdAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  const changesContext = recentChanges.length > 0
    ? `[RECENT PLAN CHANGES]\n${recentChanges.map((c) => `  ${c.changeType} (${c.source}) — ${new Date(c.createdAt).toLocaleDateString()}`).join('\n')}`
    : '';

  const input = [
    '[SYSTEM] You are an experienced endurance running coach.',
    'Respond conversationally in 1-3 sentences. Be direct, practical, and athlete-friendly.',
    performanceContext ? `\n${performanceContext}` : '',
    changesContext ? `\n${changesContext}` : '',
    serializeConversation(recentMessages),
    `[ATHLETE REQUEST]\n${content}`,
  ].filter(Boolean).join('\n\n');

  // 4. Call AI
  const model = getDefaultAiModel();
  const result = await openaiJsonSchema<{ coachReply: string; followUpQuestion?: string }>({
    input,
    model,
    schema: {
      name: 'coach_reply',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          coachReply: { type: 'string' },
          followUpQuestion: { type: 'string' },
        },
        required: ['coachReply'],
        additionalProperties: false,
      },
    },
  });

  const replyContent = result.followUpQuestion
    ? `${result.coachReply}\n\n${result.followUpQuestion}`
    : result.coachReply;

  // 5. Save coach message
  const metadata: MessageMetadata = { state: 'active' };
  const saved = await prisma.planChatMessage.create({
    data: { planId, role: 'coach', content: replyContent, metadata },
  });

  return {
    id: saved.id,
    planId: saved.planId,
    role: 'coach',
    content: saved.content,
    metadata: saved.metadata as MessageMetadata,
    createdAt: saved.createdAt.toISOString(),
  };
}

export async function handleDragDrop(
  planId: string,
  changeLogIds: string[]
): Promise<ChatMessage | null> {
  if (changeLogIds.length === 0) return null;

  const changeLogs = await prisma.planChangeLog.findMany({
    where: { id: { in: changeLogIds }, planId },
  });
  if (changeLogs.length === 0) return null;

  const performanceContext = await buildPerformanceContext(planId);

  const changeDesc = changeLogs.map((c) => {
    const before = c.before as DaySnapshot | null;
    const after = c.after as DaySnapshot | null;
    const beforeActivities = before?.activities.map((a) => `${a.title} (${a.type})`).join(', ') || 'empty';
    const afterActivities = after?.activities.map((a) => `${a.title} (${a.type})`).join(', ') || 'empty';
    return `Activity "${c.activityId}" moved from day "${c.fromDayId}" (was: ${beforeActivities}) to day "${c.toDayId}" (now: ${afterActivities})`;
  }).join('\n');

  const input = [
    '[SYSTEM] You are an experienced endurance running coach observing plan edits.',
    'Analyse the session moves below.',
    'If you detect a REAL risk (back-to-back hard/quality sessions on consecutive days, 2+ quality sessions on one day, quality session in race week), write a SHORT coaching comment (50-120 words). Be conversational.',
    'If moves are safe (easy runs, rest days, cross-training), set risk to false.',
    'Quality session subtypes: tempo, hills, progression, training-race, race, fast-finish, hill-pyramid, incline-treadmill.',
    performanceContext ? `\n${performanceContext}` : '',
    `[PLAN CHANGES]\n${changeDesc}`,
  ].filter(Boolean).join('\n\n');

  const model = getDefaultAiModel();
  const result = await openaiJsonSchema<{ risk: boolean; comment?: string; followUp?: string }>({
    input,
    model,
    schema: {
      name: 'risk_assessment',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          risk: { type: 'boolean' },
          comment: { type: 'string' },
          followUp: { type: 'string' },
        },
        required: ['risk'],
        additionalProperties: false,
      },
    },
  });

  if (!result.risk || !result.comment) return null;

  const moveNote = changeLogs.length === 1 ? 'You moved a session' : `You moved ${changeLogs.length} sessions`;
  await prisma.planChatMessage.create({
    data: { planId, role: 'system', content: moveNote, metadata: { changeLogIds } as MessageMetadata },
  });

  const replyContent = result.followUp ? `${result.comment}\n\n${result.followUp}` : result.comment;
  const saved = await prisma.planChatMessage.create({
    data: { planId, role: 'coach', content: replyContent, metadata: { state: 'active' } as MessageMetadata },
  });

  return {
    id: saved.id,
    planId: saved.planId,
    role: 'coach',
    content: saved.content,
    metadata: saved.metadata as MessageMetadata,
    createdAt: saved.createdAt.toISOString(),
  };
}

export async function handleEditSessionEnd(
  planId: string,
  editSessionId: string
): Promise<ChatMessage | null> {
  const changes = await prisma.planChangeLog.findMany({
    where: { planId, editSessionId },
    orderBy: { createdAt: 'asc' },
  });
  if (changes.length === 0) return null;

  const performanceContext = await buildPerformanceContext(planId);
  const changeDesc = changes.map((c) => {
    const before = c.before as DaySnapshot | null;
    const after = c.after as DaySnapshot | null;
    const fromActs = before?.activities.map((a) => a.title).join(', ') || 'empty';
    const toActs = after?.activities.map((a) => a.title).join(', ') || 'empty';
    return `${c.changeType}: "${c.activityId ?? 'unknown'}" from "${c.fromDayId ?? '?'}" (${fromActs}) → "${c.toDayId ?? '?'}" (${toActs})`;
  }).join('\n');

  const input = [
    '[SYSTEM] You are an experienced endurance running coach.',
    'The athlete just finished editing their training plan. Summarise what was changed in 1-3 concise sentences (max 150 words).',
    'Be conversational and coaching-focused. Note implications for load, recovery, or upcoming races.',
    performanceContext ? `\n${performanceContext}` : '',
    `[SESSION CHANGES]\n${changeDesc}`,
  ].filter(Boolean).join('\n\n');

  const model = getDefaultAiModel();
  const result = await openaiJsonSchema<{ summary: string; followUp?: string }>({
    input,
    model,
    schema: {
      name: 'session_summary',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          followUp: { type: 'string' },
        },
        required: ['summary'],
        additionalProperties: false,
      },
    },
  });

  const content = result.followUp ? `${result.summary}\n\n${result.followUp}` : result.summary;
  const saved = await prisma.planChatMessage.create({
    data: { planId, role: 'coach', content, metadata: { state: 'active' } as MessageMetadata },
  });

  return {
    id: saved.id,
    planId: saved.planId,
    role: 'coach',
    content: saved.content,
    metadata: saved.metadata as MessageMetadata,
    createdAt: saved.createdAt.toISOString(),
  };
}
```

- [ ] **Step 6.3: Typecheck**

```bash
npm run typecheck
```

Fix any type errors. Common issues: `openaiJsonSchema` parameter names, Prisma Json casting.

- [ ] **Step 6.4: Commit**

```bash
git add src/lib/plan-chat-ai.ts
git commit -m "feat: add AI chat handler (athlete_message, drag_drop, edit_session_end)"
```

---

### Task 7: POST /api/plans/[id]/chat

Adds the POST handler to the existing chat route file.

**Files:**
- Modify: `src/app/api/plans/[id]/chat/route.ts`

- [ ] **Step 7.1: Add POST handler to the chat route**

Append to `src/app/api/plans/[id]/chat/route.ts` (after the GET handler):

```typescript
import {
  handleAthleteMessage,
  handleDragDrop,
  handleEditSessionEnd,
} from '@/lib/plan-chat-ai';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: planId } = await params;
  const clerkUser = await currentUser();
  if (!clerkUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await ensureUserFromAuth(clerkUser);

  const plan = await prisma.trainingPlan.findFirst({
    where: {
      id: planId,
      OR: [{ ownerId: user.id }, { athleteId: user.id }]
    },
    select: { id: true }
  });
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json() as {
    trigger: 'athlete_message' | 'drag_drop' | 'edit_session_end';
    content?: string;
    changeLogIds?: string[];
    editSessionId?: string;
  };

  try {
    if (body.trigger === 'athlete_message') {
      if (!body.content?.trim()) {
        return NextResponse.json({ error: 'content required' }, { status: 400 });
      }
      const coachMessage = await handleAthleteMessage(planId, body.content.trim());
      return NextResponse.json({ coachMessage, silent: false });
    }

    if (body.trigger === 'drag_drop') {
      const ids = body.changeLogIds ?? [];
      const coachMessage = await handleDragDrop(planId, ids);
      return NextResponse.json({ coachMessage, silent: coachMessage === null });
    }

    if (body.trigger === 'edit_session_end') {
      if (!body.editSessionId) {
        return NextResponse.json({ error: 'editSessionId required' }, { status: 400 });
      }
      const coachMessage = await handleEditSessionEnd(planId, body.editSessionId);
      return NextResponse.json({ coachMessage, silent: coachMessage === null });
    }

    return NextResponse.json({ error: 'Unknown trigger' }, { status: 400 });
  } catch (err) {
    console.error('[plan-chat POST]', err);
    return NextResponse.json({ error: 'AI call failed' }, { status: 500 });
  }
}
```

- [ ] **Step 7.2: Fix imports at top of chat route**

Ensure the file starts with all needed imports. The final import block at the top of `route.ts` should be:

```typescript
import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { ensureUserFromAuth } from '@/lib/user-sync';
import {
  handleAthleteMessage,
  handleDragDrop,
  handleEditSessionEnd,
} from '@/lib/plan-chat-ai';
import type { ChatMessage } from '@/lib/plan-chat-types';
```

- [ ] **Step 7.3: Typecheck + build**

```bash
npm run typecheck && npm run build
```

Fix any errors.

- [ ] **Step 7.4: Test POST manually**

```javascript
// In browser console on plan page:
fetch('/api/plans/PLAN_ID/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ trigger: 'athlete_message', content: 'How does my plan look this week?' })
}).then(r => r.json()).then(console.log)
```

Expected: `{ coachMessage: { id: "...", role: "coach", content: "...", ... }, silent: false }`

- [ ] **Step 7.5: Commit**

```bash
git add src/app/api/plans/[id]/chat/route.ts
git commit -m "feat: add POST /chat endpoint (athlete_message, drag_drop, edit_session_end)"
```

---

### Task 8: Write PlanChangeLog on ai-adjust apply

When the AI proposal is applied, log it to `PlanChangeLog`.

**Files:**
- Modify: `src/app/api/plans/[id]/ai-adjust/route.ts`

- [ ] **Step 8.1: Find the apply block in ai-adjust**

```bash
grep -n "apply.*true\|applyAdjustmentProposal\|appliedCount" src/app/api/plans/[id]/ai-adjust/route.ts | head -20
```

Locate the section where `applyAdjustmentProposal` is called and `appliedCount` is used.

- [ ] **Step 8.2: Add change log writes after successful apply**

After the `applyAdjustmentProposal(planId, sanitized)` call succeeds, add:

```typescript
// Log each applied change to PlanChangeLog
await Promise.all(
  sanitized.changes.map((change) =>
    prisma.planChangeLog.create({
      data: {
        planId,
        source: 'ai_applied',
        changeType: change.op,
        activityId: 'activityId' in change ? change.activityId : null,
        fromDayId: null,
        toDayId: 'targetDayId' in change ? change.targetDayId : ('dayId' in change ? change.dayId : null),
      },
    })
  )
);
```

Also add `prisma` to imports if not already there (it should be).

- [ ] **Step 8.3: Mark the applied proposal's chat message as applied**

After logging changes, look up the most recent active coach message for this plan and update its state:

```typescript
// Mark coach message as applied (best-effort, non-blocking)
const activeCoachMsg = await prisma.planChatMessage.findFirst({
  where: { planId, role: 'coach' },
  orderBy: { createdAt: 'desc' },
});
if (activeCoachMsg) {
  const meta = (activeCoachMsg.metadata as Record<string, unknown>) ?? {};
  if (meta.state === 'active') {
    await prisma.planChatMessage.update({
      where: { id: activeCoachMsg.id },
      data: { metadata: { ...meta, state: 'applied' } },
    });
  }
}
```

- [ ] **Step 8.4: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 8.5: Commit**

```bash
git add src/app/api/plans/[id]/ai-adjust/route.ts
git commit -m "feat: log AI-applied changes to PlanChangeLog"
```

---

## Chunk 3: Client Integration + UI

### Task 9: Plan page — edit session + drag/drop change logging

**Files:**
- Modify: `src/app/plans/[id]/page.tsx`

This is a large file (3090 lines). Make surgical edits only.

- [ ] **Step 9.1: Add editSessionId state near isEditMode (line ~548)**

After `const [isEditMode, setIsEditMode] = useState(false);` (line 548), add:

```typescript
const [editSessionId, setEditSessionId] = useState<string | null>(null);
const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const pendingChangeLogIds = useRef<string[]>([]);
```

- [ ] **Step 9.2: Add chat messages state near other AI state**

Find where `aiChatTurns` is declared (search: `aiChatTurns`). Nearby, add:

```typescript
const [chatMessages, setChatMessages] = useState<import('@/lib/plan-chat-types').ChatMessage[]>([]);
const [chatLoading, setChatLoading] = useState(false);
```

- [ ] **Step 9.3: Load chat history on mount**

Find the `useEffect` that calls `loadPlan()` on mount. Add a parallel fetch:

```typescript
// Load chat history on mount
useEffect(() => {
  if (!planId) return;
  fetch(`/api/plans/${planId}/chat?limit=50`)
    .then((r) => r.json())
    .then((data) => {
      if (data.messages) setChatMessages(data.messages);
    })
    .catch(() => {}); // non-critical
}, [planId]);
```

- [ ] **Step 9.4: Start edit session when isEditMode becomes true**

Locate the Edit Plan button onClick (line ~1710):

```typescript
onClick={() => {
  setIsEditMode((prev) => {
    const next = !prev;
    if (next) {
      setSelectedDay(null);
      setSelectedActivity(null);
    }
    return next;
  });
}}
```

Replace with:

```typescript
onClick={() => {
  setIsEditMode((prev) => {
    const next = !prev;
    if (next) {
      setSelectedDay(null);
      setSelectedActivity(null);
      // Start edit session — get server-generated ID
      fetch(`/api/plans/${planId}/edit-session`, { method: 'POST' })
        .then((r) => r.json())
        .then((data) => { if (data.editSessionId) setEditSessionId(data.editSessionId); })
        .catch(() => {});
    } else {
      // Done editing — trigger session summary
      const sessionId = editSessionId;
      setEditSessionId(null);
      if (sessionId) {
        fetch(`/api/plans/${planId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trigger: 'edit_session_end', editSessionId: sessionId }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.coachMessage) {
              setChatMessages((prev) => [...prev, data.coachMessage]);
            }
          })
          .catch(() => {});
      }
    }
    return next;
  });
}}
```

- [ ] **Step 9.5: Write PlanChangeLog + trigger debounced AI after a successful move**

The callback is named `moveActivity` (not `handleActivityMove`). Find it at line ~887:
```bash
grep -n "const moveActivity\|moveActivity = useCallback" src/app/plans/[id]/page.tsx | head -5
```

After the `emitPlanEditEvent(sameDay ? 'plan_activity_reordered' : 'plan_activity_moved', ...)` call on successful move, add:

```typescript
// Write change log and schedule AI risk scan (only for cross-day moves)
if (!sameDay) {
  // Capture before/after snapshots from current plan state for AI context
  const activitiesForDay = (dayId: string) => {
    for (const week of plan?.weeks ?? []) {
      for (const day of week.days ?? []) {
        if (day.id === dayId) {
          return (day.activities ?? []).map((a: { id: string; type: string; subtype?: string | null; title: string; duration?: number | null; distance?: number | null; distanceUnit?: string | null; priority?: string | null }) => ({
            id: a.id, type: a.type, subtype: a.subtype ?? null,
            title: a.title, duration: a.duration ?? null,
            distance: a.distance ?? null, distanceUnit: a.distanceUnit ?? null,
            priority: a.priority ?? null,
          }));
        }
      }
    }
    return [];
  };
  // before = source day state before move (already mutated in memory after success,
  // so read from the server-returned plan or note this is best-effort)
  const afterActivities = activitiesForDay(targetDayId);

  fetch(`/api/plans/${planId}/change-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'manual_drag',
      changeType: 'move_activity',
      activityId,
      fromDayId: sourceDayId,
      toDayId: targetDayId,
      editSessionId: editSessionId ?? undefined,
      after: { dayId: targetDayId, activities: afterActivities },
    }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.id) {
        // Accumulate and debounce AI risk call
        pendingChangeLogIds.current.push(data.id);
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          const ids = [...pendingChangeLogIds.current];
          pendingChangeLogIds.current = [];
          fetch(`/api/plans/${planId}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trigger: 'drag_drop', changeLogIds: ids }),
          })
            .then((r) => r.json())
            .then((chatData) => {
              if (chatData.coachMessage) {
                setChatMessages((prev) => [...prev, chatData.coachMessage]);
              }
            })
            .catch(() => {});
        }, 5000);
      }
    })
    .catch(() => {});
}
```

- [ ] **Step 9.6: Create the change-log write endpoint**

Create `src/app/api/plans/[id]/change-log/route.ts`:

```typescript
// src/app/api/plans/[id]/change-log/route.ts
// Writes a PlanChangeLog entry. Called by client after manual drag/drop.
import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { ensureUserFromAuth } from '@/lib/user-sync';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: planId } = await params;
  const clerkUser = await currentUser();
  if (!clerkUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await ensureUserFromAuth(clerkUser);
  const plan = await prisma.trainingPlan.findFirst({
    where: { id: planId, OR: [{ ownerId: user.id }, { athleteId: user.id }] },
    select: { id: true }
  });
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json() as {
    source: string;
    changeType: string;
    activityId?: string;
    fromDayId?: string;
    toDayId?: string;
    editSessionId?: string;
    before?: unknown;
    after?: unknown;
  };

  const entry = await prisma.planChangeLog.create({
    data: {
      planId,
      source: body.source,
      changeType: body.changeType,
      activityId: body.activityId ?? null,
      fromDayId: body.fromDayId ?? null,
      toDayId: body.toDayId ?? null,
      editSessionId: body.editSessionId ?? null,
      before: body.before ? (body.before as object) : undefined,
      after: body.after ? (body.after as object) : undefined,
    }
  });

  return NextResponse.json({ id: entry.id });
}
```

- [ ] **Step 9.7: Typecheck**

```bash
npm run typecheck
```

Fix any errors. Common issue: `editSessionId` not in scope in the button handler — ensure it's referenced correctly via the ref or closure.

- [ ] **Step 9.8: Test edit session flow in browser**

1. Navigate to a plan page at http://localhost:3001/plans/PLAN_ID
2. Click "Edit Plan" — check network tab for `POST /edit-session` → should return `{ editSessionId: "..." }`
3. Drag an activity to another day — check network tab for `POST /change-log` entry
4. Wait 5 seconds — check for `POST /chat` with `trigger: drag_drop`
5. Click "Done Editing" — check for `POST /chat` with `trigger: edit_session_end`

- [ ] **Step 9.9: Commit**

```bash
git add src/app/plans/[id]/page.tsx src/app/api/plans/[id]/change-log/route.ts
git commit -m "feat: wire edit session tracking and drag/drop AI triggers to plan page"
```

---

### Task 10: Plan page — athlete message input wired to POST /chat

**Files:**
- Modify: `src/app/plans/[id]/page.tsx`

- [ ] **Step 10.1: Find the existing AI message send handler**

```bash
grep -n "sendAiMessage\|submitAiMessage\|aiInput\|handleAiSubmit\|setAiLoading" src/app/plans/[id]/page.tsx | head -20
```

Locate the handler that currently calls `/api/plans/${planId}/ai-adjust`.

- [ ] **Step 10.2: Add a parallel call to /chat alongside the existing ai-adjust call**

Find where the athlete's message is sent. After the existing `ai-adjust` fetch succeeds and the turn is added to `aiChatTurns`, also persist to the new endpoint:

```typescript
// Persist to new chat DB (non-blocking, fire and forget for now)
fetch(`/api/plans/${planId}/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ trigger: 'athlete_message', content: athleteMessage }),
}).catch(() => {});
```

Note: This persists the message to DB without disrupting the existing AI flow. The DB messages will be loaded on the next page visit.

- [ ] **Step 10.3: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 10.4: Commit**

```bash
git add src/app/plans/[id]/page.tsx
git commit -m "feat: persist athlete chat messages to DB"
```

---

### Task 11: Simplified conversational proposal UI

**Files:**
- Modify: `src/app/plans/[id]/page.tsx`
- Modify: `src/app/plans/plans.css`

- [ ] **Step 11.1: Find the proposal rendering section**

The active proposal is rendered around line 1869 in `page.tsx`. Find:
```
{aiTrainerProposal ? (
  <div className="pcal-ai-trainer-proposal">
```

- [ ] **Step 11.2: Add "Show details" toggle state**

Near other AI state, add:

```typescript
const [proposalDetailsOpen, setProposalDetailsOpen] = useState(false);
```

- [ ] **Step 11.3: Restructure the proposal rendering**

Replace the existing proposal block (from `{aiTrainerProposal ? (` to its closing `} : null}`) with the new conversational layout:

```tsx
{aiTrainerProposal ? (
  <div className="pcal-ai-trainer-proposal">
    {/* Coach reply */}
    <p className="pcal-ai-trainer-reply">
      {humanizeAiText(aiTrainerProposal.coachReply, aiChangeLookup)}
    </p>

    {/* Follow-up question */}
    {aiTrainerProposal.followUpQuestion && (
      <p className="pcal-ai-trainer-followup-q">
        {humanizeAiText(aiTrainerProposal.followUpQuestion, aiChangeLookup)}
      </p>
    )}

    {/* Clarification (if required) */}
    {aiTrainerProposal.requiresClarification && (
      <div className="pcal-ai-trainer-clarification">
        <p>{humanizeAiText(aiTrainerProposal.clarificationPrompt ?? 'Please confirm before applying.', aiChangeLookup)}</p>
        <textarea
          value={aiTrainerClarification}
          onChange={(e) => setAiTrainerClarification(e.target.value)}
          placeholder="Your response..."
          rows={2}
        />
      </div>
    )}

    {/* Changes list */}
    {aiTrainerProposal.changes.length > 0 && (
      <div className="pcal-ai-trainer-change-list">
        {aiTrainerProposal.changes.map((change, i) => (
          <div key={i} className="pcal-ai-trainer-change-item">
            <span className="pcal-ai-trainer-change-dot" />
            <span className="pcal-ai-trainer-change-label">
              {humanizeAiText(change.reason, aiChangeLookup)}
            </span>
            <button
              type="button"
              className="dash-btn-primary pcal-ai-apply-one"
              onClick={() => applyProposalChanges([i])}
              disabled={aiLoading}
            >
              Apply
            </button>
          </div>
        ))}
      </div>
    )}

    {/* Action row */}
    <div className="pcal-ai-trainer-actions">
      {aiTrainerProposal.changes.length > 1 && (
        <button
          type="button"
          className="dash-btn-primary"
          onClick={() => applyProposalChanges(aiTrainerProposal.changes.map((_, i) => i))}
          disabled={aiLoading}
        >
          Apply all changes
        </button>
      )}
      <button
        type="button"
        className="dash-btn-ghost pcal-ai-details-toggle"
        onClick={() => setProposalDetailsOpen((p) => !p)}
      >
        {proposalDetailsOpen ? '▾ Hide details' : '▸ Show details'}
      </button>
    </div>

    {/* Expandable details */}
    {proposalDetailsOpen && (
      <div className="pcal-ai-trainer-details">
        <div className="pcal-ai-trainer-meta">
          <span>Confidence: {aiTrainerProposal.confidence}</span>
          {aiTrainerProposal.invariantReport && (
            <span>Mode: {aiTrainerProposal.invariantReport.selectedMode.replace(/_/g, ' ')}</span>
          )}
        </div>
        {aiTrainerProposal.riskFlags && aiTrainerProposal.riskFlags.length > 0 && (
          <ul className="pcal-ai-trainer-risks">
            {aiTrainerProposal.riskFlags.map((flag, i) => (
              <li key={i}>⚠ {flag}</li>
            ))}
          </ul>
        )}
        {aiTrainerProposal.invariantReport && aiTrainerProposal.invariantReport.weeks.length > 0 && (
          <div className="pcal-ai-trainer-invariants">
            {aiTrainerProposal.invariantReport.weeks.map((w) => (
              <div key={w.weekIndex} className="pcal-ai-trainer-week-row">
                <span>Week {w.weekIndex}</span>
                <span>Rest: {w.before.restDays}→{w.after.restDays}</span>
                <span>Hard: {w.before.hardDays}→{w.after.hardDays}</span>
                {w.flags.length > 0 && <span className="pcal-ai-trainer-week-flag">{w.flags.join(', ')}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    )}
  </div>
) : null}
```

- [ ] **Step 11.4: Add CSS for new classes**

In `src/app/plans/plans.css`, find `.pcal-ai-trainer-proposal` (around line 2157) and add new classes after the existing block:

```css
.pcal-ai-trainer-reply {
  color: var(--d-text);
  line-height: 1.55;
  margin-bottom: 10px;
}

.pcal-ai-trainer-followup-q {
  font-style: italic;
  color: var(--d-muted);
  font-size: 13px;
  margin-bottom: 10px;
}

.pcal-ai-trainer-clarification {
  background: var(--d-bg);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 10px;
}

.pcal-ai-trainer-clarification textarea {
  width: 100%;
  margin-top: 6px;
  border: 1px solid var(--d-border);
  border-radius: 5px;
  padding: 6px 8px;
  font-size: 13px;
  resize: vertical;
  background: var(--d-raised);
  color: var(--d-text);
}

.pcal-ai-trainer-change-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.pcal-ai-trainer-change-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.pcal-ai-trainer-change-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--d-orange);
  flex-shrink: 0;
}

.pcal-ai-trainer-change-label {
  flex: 1;
  color: var(--d-text);
}

.pcal-ai-apply-one {
  font-size: 11px;
  padding: 3px 10px;
  flex-shrink: 0;
}

.pcal-ai-trainer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.pcal-ai-details-toggle {
  font-size: 12px;
  color: var(--d-muted);
  margin-left: auto;
}

.pcal-ai-trainer-details {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--d-border-light);
}

.pcal-ai-trainer-week-row {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--d-muted);
  padding: 3px 0;
}

.pcal-ai-trainer-week-flag {
  color: var(--d-orange);
}
```

- [ ] **Step 11.5: Also handle chat message display from DB**

In the chat thread section (around line 1805), the existing code maps `aiChatTurns`. We need to also show `chatMessages` from DB for history on load. Add above the existing thread map:

```tsx
{/* DB-persisted chat history (shown on load, before this session's turns) */}
{chatMessages.map((msg) => (
  <article key={msg.id} className={`pcal-ai-turn role-${msg.role}`}>
    <div className="pcal-ai-turn-head">
      <strong>
        {msg.role === 'athlete' ? 'You' : msg.role === 'coach' ? 'Coach' : 'System'}
      </strong>
      {msg.metadata?.state && (
        <span className={`pcal-ai-turn-state state-${msg.metadata.state}`}>
          {msg.metadata.state === 'applied' ? 'Applied' : msg.metadata.state === 'superseded' ? 'History' : ''}
        </span>
      )}
    </div>
    <p>{msg.content}</p>
  </article>
))}
```

- [ ] **Step 11.6: Typecheck**

```bash
npm run typecheck
```

Fix any errors. Common issue: `applyProposalChanges` may take different args — find the existing apply handler and match its signature.

- [ ] **Step 11.7: Visual check**

1. Navigate to a plan with an active AI proposal at http://localhost:3001
2. Verify: coach reply visible, follow-up italic, changes list with individual Apply buttons
3. Click "Show details" → confidence + risk flags + week balance appear
4. Click again → collapse
5. Take a screenshot to verify layout

- [ ] **Step 11.8: Commit**

```bash
git add src/app/plans/[id]/page.tsx src/app/plans/plans.css
git commit -m "feat: simplified conversational AI proposal UI with expandable details"
```

---

### Task 12: Final verification

- [ ] **Step 12.1: Full typecheck + lint**

```bash
npm run typecheck && npm run lint
```

All zero errors.

- [ ] **Step 12.2: Full build**

```bash
npm run build
```

Expected: clean build, no errors.

- [ ] **Step 12.3: End-to-end flow test**

Test the complete flow manually:

1. Open a plan page — verify chat history loads from DB (GET /chat)
2. Click "Edit Plan" — verify `POST /edit-session` returns editSessionId
3. Drag an activity to a new day — verify `POST /change-log` fires
4. Wait 5 seconds — verify `POST /chat` fires with `drag_drop` trigger
5. If risk detected: coach message appears in chat panel
6. Click "Done Editing" — verify `POST /chat` fires with `edit_session_end`; summary appears in chat
7. Type a message in the chat input — verify `POST /chat` fires with `athlete_message`; coach replies
8. Reload the page — verify chat history loads back from DB
9. Apply an AI proposal change — verify `PlanChangeLog` entry with `ai_applied` source is created

- [ ] **Step 12.4: Final commit**

```bash
git add -A
git commit -m "feat: AI trainer phase 1 complete — chat persistence, drag/drop awareness, performance context"
```
