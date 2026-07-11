/**
 * Migration for the match-events layer (GBT-7). Idempotent — safe to re-run.
 * Applies DDL directly because `drizzle-kit push` needs a TTY and would also try
 * to reconcile the better-auth tables (which are managed by their own migration,
 * not push). See scripts/migrate-auth-comments.ts for the same pattern.
 *
 * Creates matches / match_moments / match_goats, and generalizes `comments` to
 * attach to a battle XOR a match (adds nullable match_id, drops battle_id's NOT
 * NULL, adds the exactly-one-subject CHECK). Existing battle comments satisfy
 * the CHECK (battle_id set, match_id null) so it applies without data loss.
 *
 * Run with:  npm run db:migrate:matches
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/lib/db';

const statements = [
  // ─── matches (events) ───────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS matches (
     id text PRIMARY KEY,
     external_id text UNIQUE,
     arena text NOT NULL DEFAULT 'football',
     competition text NOT NULL,
     home_team text NOT NULL,
     away_team text NOT NULL,
     home_code text,
     away_code text,
     home_score integer,
     away_score integer,
     kickoff timestamptz NOT NULL,
     status text NOT NULL DEFAULT 'finished',
     venue text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS matches_status_idx ON matches (status)`,
  `CREATE INDEX IF NOT EXISTS matches_kickoff_idx ON matches (kickoff)`,

  // ─── match moments (timeline) ───────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS match_moments (
     id serial PRIMARY KEY,
     match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
     minute integer NOT NULL,
     extra integer,
     type text NOT NULL,
     team text NOT NULL,
     player_name text,
     goat_slug text REFERENCES entities(id),
     detail text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS match_moments_match_idx ON match_moments (match_id)`,

  // ─── match ↔ goat participation ─────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS match_goats (
     match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
     goat_slug text NOT NULL REFERENCES entities(id),
     team text,
     CONSTRAINT match_goats_match_id_goat_slug_pk PRIMARY KEY (match_id, goat_slug)
   )`,

  // ─── comments: generalize subject (battle XOR match) ────────────────────────
  `ALTER TABLE comments ADD COLUMN IF NOT EXISTS match_id text REFERENCES matches(id)`,
  `ALTER TABLE comments ALTER COLUMN battle_id DROP NOT NULL`,
  `CREATE INDEX IF NOT EXISTS comments_match_idx ON comments (match_id)`,
  `ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_subject_ck`,
  `ALTER TABLE comments ADD CONSTRAINT comments_subject_ck
     CHECK (((battle_id IS NOT NULL)::int + (match_id IS NOT NULL)::int) = 1)`,
];

async function main() {
  for (const stmt of statements) {
    const label = stmt.replace(/\s+/g, ' ').slice(0, 70);
    process.stdout.write(`→ ${label}…\n`);
    await db.execute(sql.raw(stmt));
  }
  console.log('\n✓ Match-events migration applied.');
}

// neon-http has no interactive transactions, so statements run one-by-one and
// this migration is NOT atomic. Every statement is idempotent (IF [NOT] EXISTS,
// idempotent ALTER, DROP CONSTRAINT before ADD), so recovery is to re-run it.
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
