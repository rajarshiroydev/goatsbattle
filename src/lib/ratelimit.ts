import { sql } from 'drizzle-orm';
import { db } from './db';

const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_MAX_HITS = 20;

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfter: number;
}

export interface RateLimitOptions {
  max?: number;
  windowSeconds?: number;
}

/**
 * Shared fixed-window limiter backed by PostgreSQL. The upsert is a single
 * atomic statement, so all serverless instances observe the same counter.
 */
export async function rateLimit(
  key: string,
  options: RateLimitOptions = {},
): Promise<RateResult> {
  const max = options.max ?? DEFAULT_MAX_HITS;
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;

  const result = await db.execute(sql`
    INSERT INTO rate_limits (key, window_start, hits)
    VALUES (${key.slice(0, 200)}, now(), 1)
    ON CONFLICT (key) DO UPDATE
    SET hits = CASE
          WHEN rate_limits.window_start <= now() - (${windowSeconds} * interval '1 second') THEN 1
          ELSE rate_limits.hits + 1
        END,
        window_start = CASE
          WHEN rate_limits.window_start <= now() - (${windowSeconds} * interval '1 second') THEN now()
          ELSE rate_limits.window_start
        END
    RETURNING hits, window_start AS "windowStart"
  `);
  const row = (result as unknown as Array<{ hits: number; windowStart: Date }>)[0];
  const hits = row?.hits ?? max + 1;
  const elapsed = Date.now() - new Date(row?.windowStart ?? Date.now()).getTime();
  const retryAfter = Math.max(1, Math.ceil((windowSeconds * 1000 - elapsed) / 1000));

  return {
    ok: hits <= max,
    remaining: Math.max(0, max - hits),
    retryAfter: hits <= max ? 0 : retryAfter,
  };
}
