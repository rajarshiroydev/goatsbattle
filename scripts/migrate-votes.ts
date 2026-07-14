/**
 * One-off migration to the votes-only model (drops Elo). Idempotent — safe to
 * re-run. Applies the DDL directly because `drizzle-kit push` needs a TTY for
 * its create-vs-rename resolver.
 *
 * Run with:  npx tsx --env-file=.env scripts/migrate-votes.ts
 */
import { sql } from 'drizzle-orm';
import { db } from './lib/node-db';
import { exitOnDatabaseError, runDatabaseOperation } from './lib/database-safety';

const statements = [
  // entities: ranking total replaces Elo
  `ALTER TABLE entities ADD COLUMN IF NOT EXISTS votes integer NOT NULL DEFAULT 0`,
  `ALTER TABLE entities DROP COLUMN IF EXISTS elo`,
  // drop the Elo history log
  `DROP TABLE IF EXISTS elo_history`,
  // votes table → rolling-window head-to-head ledger
  `DROP INDEX IF EXISTS votes_ip_battle_day_uniq`,
  `ALTER TABLE votes DROP COLUMN IF EXISTS vote_day`,
  `CREATE INDEX IF NOT EXISTS votes_ip_battle_idx ON votes (ip_hash, battle_id)`,
  // ranking-vote window / champion lockout
  `CREATE TABLE IF NOT EXISTS vote_windows (
     ip_hash text NOT NULL,
     entity_id text NOT NULL REFERENCES entities(id),
     window_start timestamptz NOT NULL DEFAULT now(),
     profile_used boolean NOT NULL DEFAULT false,
     champion_used boolean NOT NULL DEFAULT false,
     CONSTRAINT vote_windows_ip_hash_entity_id_pk PRIMARY KEY (ip_hash, entity_id)
   )`,
];

async function main() {
  for (const stmt of statements) {
    const label = stmt.replace(/\s+/g, ' ').slice(0, 70);
    process.stdout.write(`→ ${label}…\n`);
    await db.execute(sql.raw(stmt));
  }
  console.log('\n✓ Migration applied.');
}

runDatabaseOperation({ operation: 'votes migration' }, main).catch(exitOnDatabaseError);
