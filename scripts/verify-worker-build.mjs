import { readFileSync } from 'node:fs';

const environment = process.argv[2];
if (environment !== 'preview' && environment !== 'production') {
  throw new Error('Usage: node scripts/verify-worker-build.mjs <preview|production>');
}

const config = JSON.parse(readFileSync('dist/server/wrangler.json', 'utf8'));
const expected = environment === 'preview'
  ? {
      name: 'goatsbattle-preview',
      appEnv: 'preview',
      sessionId: '4204057bcfd648ce9cd5db5754c6bdd3',
      cron: null,
    }
  : {
      name: 'goatsbattle',
      appEnv: 'production',
      sessionId: '15a174bd4b144bf9958469bed9b8794f',
      cron: '* * * * *',
    };

function assert(condition, message) {
  if (!condition) throw new Error(`Generated Worker config is unsafe: ${message}`);
}

assert(config.name === expected.name, `expected name ${expected.name}, got ${String(config.name)}`);
assert(config.vars?.APP_ENV === expected.appEnv, `expected APP_ENV=${expected.appEnv}`);
// Deliberate release tripwire: edit this assertion together with wrangler.jsonc when changing the flag.
assert(config.vars?.LIVE_MOMENTS_ENABLED === 'true', 'LIVE_MOMENTS_ENABLED must be true');

const session = config.kv_namespaces?.find((binding) => binding.binding === 'SESSION');
assert(session?.id === expected.sessionId, 'SESSION must use the environment-specific KV namespace');

const durableBindings = new Set(
  (config.durable_objects?.bindings ?? []).map((binding) => binding.name),
);
assert(durableBindings.has('LIVE_MATCH_COORDINATOR'), 'LIVE_MATCH_COORDINATOR binding is missing');
assert(durableBindings.has('STATS_API_REQUEST_BROKER'), 'STATS_API_REQUEST_BROKER binding is missing');

const migration = config.migrations?.find((item) => item.tag === 'v1-live-match-coordination');
const sqliteClasses = new Set(migration?.new_sqlite_classes ?? []);
assert(sqliteClasses.has('LiveMatchCoordinator'), 'LiveMatchCoordinator SQLite migration is missing');
assert(sqliteClasses.has('StatsApiRequestBroker'), 'StatsApiRequestBroker SQLite migration is missing');

const crons = config.triggers?.crons ?? [];
if (expected.cron) {
  assert(crons.length === 1 && crons[0] === expected.cron, 'production cron is missing or changed');
  assert(Array.isArray(config.routes) && config.routes.length === 2, 'production custom domains are missing');
} else {
  assert(crons.length === 0, 'preview must not have an automatic cron');
  assert(!config.routes || config.routes.length === 0, 'preview must not have production routes');
}

console.log(`✓ Verified generated ${environment} Worker config (${config.name}).`);
