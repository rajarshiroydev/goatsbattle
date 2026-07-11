/**
 * Migration for stat tagging (GBT-7 deferred feature). Idempotent — safe to
 * re-run. Adds `comment_stat_tags` so a comment can cite one or more definitive
 * goat stats. Applies DDL directly (see scripts/migrate-matches.ts for why).
 *
 * Run with:  npm run db:migrate:stat-tags
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/lib/db';

const statements = [
  `CREATE TABLE IF NOT EXISTS comment_stat_tags (
     id serial PRIMARY KEY,
     comment_id integer NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
     goat_slug text NOT NULL REFERENCES entities(id),
     stat_label text NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS comment_stat_tags_comment_idx ON comment_stat_tags (comment_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS comment_stat_tags_uniq
     ON comment_stat_tags (comment_id, goat_slug, stat_label)`,
];

async function main() {
  for (const stmt of statements) {
    const label = stmt.replace(/\s+/g, ' ').slice(0, 70);
    process.stdout.write(`→ ${label}…\n`);
    await db.execute(sql.raw(stmt));
  }
  console.log('\n✓ Stat-tags migration applied.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
