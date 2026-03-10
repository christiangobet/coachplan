# Strava Extended API — Application Reference

**Submitted:** 2026-03-10
**Expected response:** 2026-03-17 to 2026-03-20
**Application form:** https://share.hsforms.com/1VXSwPUYqSH6IxK0y51FjHwcnkd8
**Status:** Submitted — awaiting review

---

## App Identity

| Field | Value |
|-------|-------|
| App name | MyTrainingPlan |
| Strava App ID | 202574 |
| Website | https://www.mytrainingplan.io |
| Callback domain | www.mytrainingplan.io |
| Privacy policy | https://www.mytrainingplan.io/privacy |
| Terms of service | https://www.mytrainingplan.io/terms |
| Contact email | privacy@mytrainingplan.io |

---

## OAuth Scopes

| Scope | Reason |
|-------|--------|
| `read` | Read athlete profile to associate Strava account |
| `activity:read_all` | Read private activities — athletes frequently train early morning with activities set to private by default; standard `activity:read` would silently miss these sessions |

We do **not** request write scopes. No data is written back to Strava.

---

## Webhook Subscription

| Field | Value |
|-------|-------|
| Subscription ID | 334246 |
| Callback URL | https://www.mytrainingplan.io/api/integrations/strava/webhook |
| Verify token | stored in `STRAVA_WEBHOOK_VERIFY_TOKEN` env var |
| Registered | 2026-03-10 |

**Events handled:**
- `athlete` / `update` with `authorized: false` → immediately deletes OAuth tokens + all Strava activity records
- `athlete` / `delete` → same as above

**Security:**
- Subscription ID validated on every incoming POST (`STRAVA_WEBHOOK_SUBSCRIPTION_ID=334246`)
- Invalid subscription IDs rejected with 403
- DB errors return 200 to prevent Strava unsubscribing on transient failures

---

## Data Handling

### What we fetch
- Activity type, start date/time, distance, moving time, elapsed time, average pace, average + max heart rate, calories, elevation gain
- Athlete ID, first name, last name, username (for account association only)
- Lookback window: user-configurable, default 30 days, max 3650 days

### What we store
- OAuth access + refresh tokens (encrypted at rest)
- Activity records cached in PostgreSQL (Neon) for training log display

### What we do NOT do
- Write any data back to Strava
- Share Strava data with third parties
- Use Strava data to train ML/AI models
- Store data in plaintext logs or third-party analytics

### Deletion on disconnect
Disconnecting Strava from the app:
1. Immediately deletes OAuth tokens from database
2. Immediately deletes all cached Strava activity records
3. Does not affect manually logged training data

Full account deletion: email privacy@mytrainingplan.io — all data removed within 30 days.

---

## Technical Infrastructure

| Component | Service |
|-----------|---------|
| Hosting | Vercel (production + preview) |
| Database | Neon (PostgreSQL) |
| Auth | Clerk |
| AI parsing | OpenAI (PDF extraction only, not activity data) |
| Error tracking | Sentry (optional, env var gated) |
| Rate limiting | In-memory per user (10 uploads/hr, 30 syncs/hr) |
| Strava API backoff | Exponential backoff on 429, respects `x-ratelimit-reset` header |

---

## Likely Follow-up Questions & Answers

### "How do you handle Strava's rate limits (200 req/15min)?"
> Each sync fetches activities in pages of 100. We use exponential backoff on 429 responses, respecting the `x-ratelimit-reset` header. Syncs are rate-limited to 30 per user per hour at the application layer. A single sync fetches at most 20 pages × 20 windows = 2,000 activities, but typical syncs are 1–3 pages covering 30 days.

### "Can users export or access their raw Strava data?"
> No. Activity data is displayed only within the athlete's own training log. There is no export or API that exposes the raw Strava data to other parties.

### "What happens if a user's Strava token expires?"
> We automatically refresh tokens using the stored refresh token before each sync. If the refresh fails (token revoked), the Strava account is marked inactive and the user is prompted to reconnect.

### "Do you display Strava data to other users (e.g. coaches)?"
> Coaches linked to an athlete can see the athlete's training log, which includes matched Strava activities (sport type, date, distance, pace). This is equivalent to the athlete sharing their own training data with their coach — the relationship is explicitly established by the athlete.

### "Do you scrape or bulk-fetch data beyond what users explicitly authorise?"
> No. We only fetch data for users who have explicitly connected their Strava account via OAuth. We do not fetch data for disconnected accounts or accounts not registered with MyTrainingPlan.

### "What is your app's commercial model?"
> *(fill in: free / freemium / paid subscription)*

### "How many active users do you have?"
> *(fill in current count)*

### "Is your app available on mobile?"
> The app is a responsive web app accessible on mobile browsers. There is no native iOS/Android app.

---

## Environment Variables (production)

| Variable | Set | Notes |
|----------|-----|-------|
| `STRAVA_CLIENT_ID` | ✅ | App ID 202574 |
| `STRAVA_CLIENT_SECRET` | ✅ | |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | ✅ | |
| `STRAVA_WEBHOOK_SUBSCRIPTION_ID` | ✅ | 334246 |
| `INTEGRATIONS_STATE_SECRET` | ✅ | Set 2026-03-10 |

---

## Code References

| Concern | File |
|---------|------|
| OAuth flow | `src/lib/integrations/strava.ts` — `getStravaAuthUrl()` |
| Token refresh | `src/lib/integrations/strava.ts` — `ensureFreshStravaAccount()` |
| Activity sync | `src/lib/integrations/strava.ts` — `syncStravaActivitiesForUser()` |
| Webhook handler | `src/app/api/integrations/strava/webhook/route.ts` |
| Disconnect + data deletion | `src/lib/integrations/strava.ts` — `disconnectStravaForUser()` |
| Rate limit backoff | `src/lib/integrations/strava.ts` — `stravaFetchWithBackoff()` |
| OAuth state signing | `src/lib/integrations/state.ts` |
