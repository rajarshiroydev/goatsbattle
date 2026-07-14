/** Resilient TheStatsAPI source, snapshot, lineup, and durable-moment schema. */
import { neon } from '@neondatabase/serverless';
import { exitOnDatabaseError, runDatabaseOperation } from './lib/database-safety';

const statements = [
  `ALTER TABLE matches ADD COLUMN IF NOT EXISTS home_penalty_score integer`,
  `ALTER TABLE matches ADD COLUMN IF NOT EXISTS away_penalty_score integer`,
  `CREATE TABLE IF NOT EXISTS match_sources (
     id serial PRIMARY KEY,
     match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
     provider text NOT NULL,
     provider_match_id text NOT NULL,
     role text NOT NULL CHECK (role IN ('score', 'timeline', 'lineup')),
     status text NOT NULL DEFAULT 'active',
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     last_attempt_at timestamptz,
     last_success_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS match_sources_provider_match_uniq
     ON match_sources (provider, provider_match_id, role)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS match_sources_match_role_uniq
     ON match_sources (match_id, provider, role)`,
  `CREATE INDEX IF NOT EXISTS match_sources_match_idx ON match_sources (match_id)`,
  `CREATE TABLE IF NOT EXISTS provider_sync_state (
     provider text PRIMARY KEY,
     window_started_at timestamptz NOT NULL DEFAULT now(),
     requests_in_window integer NOT NULL DEFAULT 0 CHECK (requests_in_window >= 0),
     total_requests integer NOT NULL DEFAULT 0 CHECK (total_requests >= 0),
     consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
     circuit_open_until timestamptz,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS match_timeline_state (
     match_id text PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
     provider text NOT NULL,
     provider_match_id text NOT NULL,
     mode text NOT NULL DEFAULT 'shadow'
       CHECK (mode IN ('shadow', 'live', 'finalizing', 'finalized', 'degraded')),
     coverage text NOT NULL DEFAULT 'none',
     snapshot_hash text,
     snapshot_version integer NOT NULL DEFAULT 0,
     events jsonb NOT NULL DEFAULT '[]'::jsonb,
     provider_updated_at timestamptz,
     fetched_at timestamptz,
     last_success_at timestamptz,
     last_final_check_at timestamptz,
     consecutive_identical integer NOT NULL DEFAULT 0,
     last_error_code text,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS match_timeline_snapshots (
     id serial PRIMARY KEY,
     match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
     provider text NOT NULL,
     snapshot_hash text NOT NULL,
     coverage text NOT NULL,
     event_count integer NOT NULL,
     events jsonb NOT NULL,
     provider_updated_at timestamptz,
     fetched_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS match_timeline_snapshots_hash_uniq
     ON match_timeline_snapshots (match_id, provider, snapshot_hash)`,
  `CREATE INDEX IF NOT EXISTS match_timeline_snapshots_match_idx
     ON match_timeline_snapshots (match_id, fetched_at)`,
  `CREATE TABLE IF NOT EXISTS match_lineups (
     match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
     provider text NOT NULL,
     provider_match_id text NOT NULL,
     status text NOT NULL CHECK (status IN ('rejected', 'official')),
     rejection_reason text,
     snapshot_hash text NOT NULL,
     lineup jsonb NOT NULL,
     fetched_at timestamptz NOT NULL DEFAULT now(),
     validated_at timestamptz,
     updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (match_id, provider)
   )`,
  `ALTER TABLE match_moments ADD COLUMN IF NOT EXISTS provider text`,
  `ALTER TABLE match_moments ADD COLUMN IF NOT EXISTS provider_event_id text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS match_moments_provider_event_uniq
     ON match_moments (provider, provider_event_id)`,
  `ALTER TABLE match_moments ADD COLUMN IF NOT EXISTS provider_sequence integer`,
  `ALTER TABLE match_moments ADD COLUMN IF NOT EXISTS period text`,
  `ALTER TABLE match_moments ADD COLUMN IF NOT EXISTS provider_team_id text`,
  `ALTER TABLE match_moments ADD COLUMN IF NOT EXISTS provider_player_id text`,
  `ALTER TABLE match_moments ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'confirmed'`,
  `ALTER TABLE match_moments ADD COLUMN IF NOT EXISTS snapshot_hash text`,
  `ALTER TABLE match_moments ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`,
  `ALTER TABLE match_moments DROP CONSTRAINT IF EXISTS match_moments_verification_ck`,
  `DO $$ BEGIN
     ALTER TABLE match_moments ADD CONSTRAINT match_moments_verification_ck
       CHECK (verification_status IN ('provisional', 'confirmed', 'retracted', 'superseded'));
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `CREATE TABLE IF NOT EXISTS goat_provider_players (
     goat_slug text NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
     provider text NOT NULL,
     provider_player_id text NOT NULL,
     verified_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (goat_slug, provider)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS goat_provider_players_provider_player_uniq
     ON goat_provider_players (provider, provider_player_id)`,
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  const query = neon(connectionString);
  for (const statement of statements) {
    process.stdout.write(`→ ${statement.replace(/\s+/g, ' ').slice(0, 82)}…\n`);
    await query.query(statement, []);
  }
  console.log('\n✓ TheStatsAPI resilience migration applied.');
}

runDatabaseOperation({ operation: 'TheStatsAPI resilience migration' }, main)
  .catch(exitOnDatabaseError);
