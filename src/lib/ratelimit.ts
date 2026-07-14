import { sql } from 'drizzle-orm';
import { db } from './db';

const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_MAX_HITS = 20;
const MAX_SUPPORTED_WINDOW_SECONDS = 60;
const PRUNE_BATCH_SIZE = 100;

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfter: number;
}

export interface RateLimitOptions {
  max?: number;
  windowSeconds?: number;
}

interface BetterAuthRateLimitValue {
  key: string;
  count: number;
  lastRequest: number;
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
  const windowSeconds = Math.min(
    Math.max(1, options.windowSeconds ?? DEFAULT_WINDOW_SECONDS),
    MAX_SUPPORTED_WINDOW_SECONDS,
  );
  const normalizedKey = key.slice(0, 200);

  const result = await db.execute(sql`
    WITH expired AS (
      SELECT key
      FROM rate_limits
      WHERE window_start < now() - (${MAX_SUPPORTED_WINDOW_SECONDS} * interval '1 second')
        AND key <> ${normalizedKey}
      ORDER BY window_start
      LIMIT ${PRUNE_BATCH_SIZE}
    ), pruned AS (
      DELETE FROM rate_limits
      USING expired
      WHERE rate_limits.key = expired.key
        AND rate_limits.window_start < now() - (${MAX_SUPPORTED_WINDOW_SECONDS} * interval '1 second')
    )
    INSERT INTO rate_limits (key, window_start, hits)
    VALUES (${normalizedKey}, now(), 1)
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
  const row = (result as unknown as {
    rows: Array<{ hits: number; windowStart: Date }>;
  }).rows[0];
  const hits = row?.hits ?? max + 1;
  const elapsed = Date.now() - new Date(row?.windowStart ?? Date.now()).getTime();
  const retryAfter = Math.max(1, Math.ceil((windowSeconds * 1000 - elapsed) / 1000));

  return {
    ok: hits <= max,
    remaining: Math.max(0, max - hits),
    retryAfter: hits <= max ? 0 : retryAfter,
  };
}

const authKey = (key: string) => `auth:${key}`;

/** Better Auth adapter over the same shared atomic limiter used by app routes. */
export const betterAuthRateLimitStorage = {
  async get(key: string): Promise<BetterAuthRateLimitValue | null> {
    const result = await db.execute(sql`
      SELECT hits, window_start AS "windowStart"
      FROM rate_limits
      WHERE key = ${authKey(key)}
    `);
    const row = (result as unknown as {
      rows: Array<{ hits: number; windowStart: Date }>;
    }).rows[0];
    if (!row) return null;
    return {
      key,
      count: Number(row.hits),
      lastRequest: new Date(row.windowStart).getTime(),
    };
  },

  async set(key: string, value: BetterAuthRateLimitValue): Promise<void> {
    await db.execute(sql`
      INSERT INTO rate_limits (key, window_start, hits)
      VALUES (${authKey(key)}, ${new Date(value.lastRequest)}, ${value.count})
      ON CONFLICT (key) DO UPDATE
      SET window_start = excluded.window_start,
          hits = excluded.hits
    `);
  },

  async consume(key: string, rule: { window: number; max: number }) {
    const result = await rateLimit(authKey(key), {
      max: rule.max,
      windowSeconds: rule.window,
    });
    return {
      allowed: result.ok,
      retryAfter: result.ok ? null : result.retryAfter,
    };
  },
};
