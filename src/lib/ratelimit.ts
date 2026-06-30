/**
 * Tiny in-memory sliding-window limiter for basic bot mitigation. Best-effort
 * only: serverless instances don't share state, so this caps bursts per warm
 * instance rather than enforcing a global quota. The real anti-double-vote
 * guarantee is the unique (ip_hash, battle_id) DB constraint.
 */
const WINDOW_MS = 60_000;
const MAX_HITS = 20; // votes per key per window

const hits = new Map<string, number[]>();

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfter: number; // seconds until the window frees up
}

export function rateLimit(key: string, now = Date.now()): RateResult {
  const cutoff = now - WINDOW_MS;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

  if (recent.length >= MAX_HITS) {
    const retryAfter = Math.ceil((recent[0] + WINDOW_MS - now) / 1000);
    hits.set(key, recent);
    return { ok: false, remaining: 0, retryAfter: Math.max(retryAfter, 1) };
  }

  recent.push(now);
  hits.set(key, recent);

  // Opportunistic cleanup so the map can't grow unbounded on a warm instance.
  if (hits.size > 5000) {
    for (const [k, ts] of hits) {
      if (ts.every((t) => t <= cutoff)) hits.delete(k);
    }
  }

  return { ok: true, remaining: MAX_HITS - recent.length, retryAfter: 0 };
}
