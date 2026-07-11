/**
 * Security-hardening schema migration. Idempotent and safe to re-run.
 *
 * Run with: npm run db:migrate:security
 * Then verify the printed row counts against the database before deployment.
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/lib/db';

const statements = [
  `CREATE TABLE IF NOT EXISTS head_vote_windows (
     user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
     battle_id text NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
     window_start timestamptz NOT NULL DEFAULT now(),
     choice text NOT NULL REFERENCES entities(id),
     CONSTRAINT head_vote_windows_user_battle_pk PRIMARY KEY (user_id, battle_id)
   )`,
  `INSERT INTO head_vote_windows (user_id, battle_id, window_start, choice)
   SELECT DISTINCT ON (user_id, battle_id)
          user_id, battle_id, created_at, choice
   FROM votes
   WHERE user_id IS NOT NULL
     AND created_at > now() - interval '24 hours'
   ORDER BY user_id, battle_id, created_at DESC
   ON CONFLICT (user_id, battle_id) DO UPDATE
   SET window_start = excluded.window_start, choice = excluded.choice
   WHERE excluded.window_start > head_vote_windows.window_start`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
     key text PRIMARY KEY,
     window_start timestamptz NOT NULL DEFAULT now(),
     hits integer NOT NULL DEFAULT 1 CHECK (hits > 0)
   )`,
];

async function main() {
  for (const statement of statements) await db.execute(sql.raw(statement));

  const headClaims = await db.execute(sql`SELECT count(*)::int AS count FROM head_vote_windows`);
  const rateCounters = await db.execute(sql`SELECT count(*)::int AS count FROM rate_limits`);
  const headCount = (headClaims as unknown as Array<{ count: number }>)[0]?.count ?? 0;
  const rateCount = (rateCounters as unknown as Array<{ count: number }>)[0]?.count ?? 0;
  console.log(`✓ Security schema ready: ${headCount} head-vote claims, ${rateCount} active rate counters.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
