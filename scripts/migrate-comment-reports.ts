/** Minimum launch moderation queue (GBT-17). */
import { neon } from '@neondatabase/serverless';
import { exitOnDatabaseError, runDatabaseOperation } from './lib/database-safety';

const statements = [
  `CREATE TABLE IF NOT EXISTS comment_reports (
    id serial PRIMARY KEY,
    reporter_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    comment_id integer NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    reason text NOT NULL,
    details text,
    status text NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT comment_reports_reason_ck CHECK (
      reason IN ('spam', 'harassment', 'hate', 'privacy', 'misinformation', 'other')
    ),
    CONSTRAINT comment_reports_status_ck CHECK (
      status IN ('open', 'reviewing', 'resolved', 'dismissed')
    )
  )`,
  `CREATE INDEX IF NOT EXISTS comment_reports_status_idx
    ON comment_reports (status, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS comment_reports_active_uniq
    ON comment_reports (reporter_id, comment_id) WHERE status = 'open'`,
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  const query = neon(connectionString);
  for (const statement of statements) await query.query(statement, []);
  console.log('✓ Comment-report moderation migration applied.');
}

runDatabaseOperation({ operation: 'comment-report moderation migration' }, main)
  .catch(exitOnDatabaseError);
