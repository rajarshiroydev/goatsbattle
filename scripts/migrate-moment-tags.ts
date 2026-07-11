/**
 * Migration for moment tagging (GBT-7). Idempotent — safe to re-run. Adds
 * `comments.moment_id` so a match comment can anchor to a point on the match
 * timeline, with a CHECK that a moment anchor only exists on a match comment.
 * Applies DDL directly (see scripts/migrate-matches.ts for why).
 *
 * Run with:  npm run db:migrate:moment-tags
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/lib/db';

const statements = [
  `ALTER TABLE comments ADD COLUMN IF NOT EXISTS moment_id integer
     REFERENCES match_moments(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS comments_moment_idx ON comments (moment_id)`,
  `ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_moment_ck`,
  `ALTER TABLE comments ADD CONSTRAINT comments_moment_ck
     CHECK (moment_id IS NULL OR match_id IS NOT NULL)`,
];

async function main() {
  for (const stmt of statements) {
    const label = stmt.replace(/\s+/g, ' ').slice(0, 70);
    process.stdout.write(`→ ${label}…\n`);
    await db.execute(sql.raw(stmt));
  }
  console.log('\n✓ Moment-tags migration applied.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
