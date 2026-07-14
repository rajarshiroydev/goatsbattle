/** World Cup source identity and idempotent provider reconciliation (GBT-15). */
import { neon } from '@neondatabase/serverless';
import { exitOnDatabaseError, runDatabaseOperation } from './lib/database-safety';

const statements = [
  `ALTER TABLE matches ADD COLUMN IF NOT EXISTS provider text`,
  `ALTER TABLE matches ADD COLUMN IF NOT EXISTS provider_fixture_id text`,
  `ALTER TABLE matches ADD COLUMN IF NOT EXISTS tournament_stage text`,
  `ALTER TABLE matches ADD COLUMN IF NOT EXISTS source_status text NOT NULL DEFAULT 'canonical'`,
  `ALTER TABLE matches ADD COLUMN IF NOT EXISTS last_synced_at timestamptz`,
  `CREATE UNIQUE INDEX IF NOT EXISTS matches_provider_fixture_uniq
     ON matches (provider, provider_fixture_id)`,
  `ALTER TABLE match_moments ADD COLUMN IF NOT EXISTS provider text`,
  `ALTER TABLE match_moments ADD COLUMN IF NOT EXISTS provider_event_id text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS match_moments_provider_event_uniq
     ON match_moments (provider, provider_event_id)`,
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  const query = neon(connectionString);
  for (const statement of statements) {
    process.stdout.write(`→ ${statement.replace(/\s+/g, ' ').slice(0, 76)}…\n`);
    await query.query(statement, []);
  }
  console.log('\n✓ World Cup source-identity migration applied.');
}

runDatabaseOperation({ operation: 'World Cup source-identity migration' }, main)
  .catch(exitOnDatabaseError);
