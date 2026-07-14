import { neon } from '@neondatabase/serverless';
import {
  getRequestedTarget,
  inspectDatabase,
  printVerifiedDatabaseState,
  exitOnDatabaseError,
} from './lib/database-safety';

async function main() {
  const target = getRequestedTarget();
  if (!process.argv.includes('--confirm-initialize')) {
    throw new Error('Environment initialization requires --confirm-initialize.');
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');

  const before = await inspectDatabase();
  if (before.marker && before.marker.environment !== target) {
    throw new Error(
      `Refusing to replace existing ${String(before.marker.environment)} marker with ${target}.`,
    );
  }

  const query = neon(connectionString);
  await query`
    CREATE TABLE IF NOT EXISTS deployment_environment (
      id integer PRIMARY KEY CHECK (id = 1),
      environment text NOT NULL CHECK (environment IN ('development', 'production')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await query`
    INSERT INTO deployment_environment (id, environment)
    VALUES (1, ${target})
    ON CONFLICT (id) DO UPDATE
    SET updated_at = now()
    WHERE deployment_environment.environment = EXCLUDED.environment
  `;

  const after = await printVerifiedDatabaseState('Verified database state after environment initialization:');
  if (after.marker?.environment !== target) {
    throw new Error(`Failed to persist the ${target} database marker.`);
  }
}

main().catch(exitOnDatabaseError);
