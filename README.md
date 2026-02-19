# CoachPlan

Training plan management app (Next.js + Prisma + Clerk) with PDF plan parsing.

## Local setup

1. Use Node `22.x` (matches Vercel runtime).
2. Install dependencies:

```bash
npm install
```

3. Create local env file:

```bash
cp .env.example .env.local
```

4. Fill required values in `.env.local`:
- `DATABASE_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

5. Start app:

```bash
npm run dev
```

## Build parity with Vercel

Run this before pushing:

```bash
npm run verify
```

This runs:
- `prisma generate`
- `tsc --noEmit`
- `next build`

## Stability notes

- If Git commands hang, clear stale lock files:

```bash
rm -f .git/index.lock .git/HEAD.lock .git/refs/heads/main.lock
```

- Avoid keeping the repo in an iCloud-optimized folder (`Documents/Desktop` with cloud offloading enabled), which can cause intermittent lock/dataless file behavior.

## Vercel

`vercel.json` uses:

```json
{
  "buildCommand": "prisma generate && next build"
}
```

Keep Vercel env vars in sync with `.env.example`.

