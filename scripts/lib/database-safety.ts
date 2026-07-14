import { neon } from '@neondatabase/serverless';

export type DatabaseTarget = 'development' | 'production';

type OperationOptions = {
  operation: string;
  allowedTargets?: DatabaseTarget[];
};

const PRODUCTION_CONFIRMATION = '--confirm-production';

function getConnectionString(): string {
  // Node scripts are loaded by tsx, outside Vite's import.meta.env replacement.
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set for this database command.');
  }
  return connectionString;
}

export function getRequestedTarget(): DatabaseTarget {
  const targetArg = process.argv.find((arg) => arg.startsWith('--target='));
  const target = targetArg?.slice('--target='.length);
  if (target !== 'development' && target !== 'production') {
    throw new Error('Pass an explicit database target: --target=development or --target=production.');
  }
  if (target === 'production' && !process.argv.includes(PRODUCTION_CONFIRMATION)) {
    throw new Error(`Production operations require ${PRODUCTION_CONFIRMATION}.`);
  }
  return target;
}

function safeDatabaseLocation(connectionString: string): { host: string; database: string } {
  const url = new URL(connectionString);
  return {
    host: url.hostname,
    database: url.pathname.replace(/^\//, '') || '(default)',
  };
}

export async function inspectDatabase() {
  const connectionString = getConnectionString();
  const query = neon(connectionString);
  const [identity] = await query`
    SELECT current_database() AS database, current_user AS role
  `;
  const [markerTable] = await query`
    SELECT to_regclass('public.deployment_environment') IS NOT NULL AS exists
  `;
  const marker = markerTable.exists
    ? (await query`
        SELECT environment, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM deployment_environment
        WHERE id = 1
      `)[0] ?? null
    : null;
  const tables = await query`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;
  const counts: Record<string, number> = {};
  for (const { tablename } of tables) {
    const escapedName = String(tablename).replaceAll('"', '""');
    const rows = await query.query(`SELECT count(*)::int AS count FROM "${escapedName}"`, []);
    counts[String(tablename)] = Number(rows[0]?.count ?? 0);
  }
  return {
    location: safeDatabaseLocation(connectionString),
    identity,
    marker,
    counts,
  };
}

export async function assertDatabaseTarget(target: DatabaseTarget, operation: string) {
  const state = await inspectDatabase();
  if (!state.marker) {
    throw new Error(
      `Refusing to ${operation}: deployment_environment is not initialized. ` +
      `Run the explicit db:environment:init:${target === 'development' ? 'dev' : 'prod'} command first.`,
    );
  }
  if (state.marker.environment !== target) {
    throw new Error(
      `Refusing to ${operation}: requested ${target}, but the database marker is ${String(state.marker.environment)}.`,
    );
  }
  console.log(
    `✓ Database target verified: ${target} (${state.location.host}/${state.identity.database}).`,
  );
  return state;
}

export async function printVerifiedDatabaseState(label: string) {
  const state = await inspectDatabase();
  console.log(`\n${label}`);
  console.log(JSON.stringify({
    environment: state.marker?.environment ?? null,
    database: state.identity.database,
    host: state.location.host,
    counts: state.counts,
  }, null, 2));
  return state;
}

export async function runDatabaseOperation(
  options: OperationOptions,
  operation: () => Promise<void>,
) {
  const target = getRequestedTarget();
  if (options.allowedTargets && !options.allowedTargets.includes(target)) {
    throw new Error(
      `${options.operation} is allowed only for: ${options.allowedTargets.join(', ')}.`,
    );
  }
  await assertDatabaseTarget(target, options.operation);
  try {
    await operation();
  } catch (error) {
    await printVerifiedDatabaseState(`Database state after failed ${options.operation}:`)
      .catch((inspectionError) => console.error('State verification also failed:', inspectionError));
    throw error;
  }
  const state = await printVerifiedDatabaseState(`Verified database state after ${options.operation}:`);
  if (state.marker?.environment !== target) {
    throw new Error(`Database marker changed unexpectedly during ${options.operation}.`);
  }
}

export function exitOnDatabaseError(error: unknown) {
  console.error(error);
  process.exit(1);
}
