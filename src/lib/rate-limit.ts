/**
 * Simple in-memory rate limiter for Next.js server routes.
 * Works in both serverful (Node) and serverless (Vercel) environments.
 * For serverless, limits are per-instance (sufficient to prevent abuse from a single client).
 *
 * To upgrade to distributed rate limiting, swap the Map for Upstash Redis
 * using @upstash/ratelimit and @upstash/redis.
 */

type BucketEntry = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, BucketEntry>();

// Prune expired entries periodically to avoid memory leaks
let lastPruned = Date.now();
function maybePrune() {
  if (Date.now() - lastPruned < 60_000) return;
  lastPruned = Date.now();
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt < now) buckets.delete(key);
  }
}

/**
 * Check and record a rate-limit hit.
 *
 * @param key     Unique identifier (e.g. userId + endpoint)
 * @param limit   Max requests allowed in the window
 * @param windowMs  Window size in milliseconds
 * @returns `{ allowed: true }` or `{ allowed: false, retryAfterMs: number }`
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  maybePrune();
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || entry.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (entry.count >= limit) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }

  entry.count += 1;
  return { allowed: true };
}
