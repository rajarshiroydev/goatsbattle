/** Throttled, resumable backfill of finalized World Cup timelines. */
import { neon } from '@neondatabase/serverless';
import { THE_STATS_API_PROVIDER } from '../src/lib/theStatsApi';
import { backfillStatsApiTimeline } from '../src/lib/theStatsApiSync';
import { exitOnDatabaseError, runDatabaseOperation } from './lib/database-safety';

const delay = (milliseconds: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds);
});

// Keep historical work below the shared 10 RPM ceiling so the production cron
// retains capacity for score, lineup, and live-timeline requests.
const BACKFILL_DELAY_MS = 10_500;

function requestedLimit() {
  const raw = process.argv.find((arg) => arg.startsWith('--limit='))?.slice('--limit='.length);
  if (!raw) return 100;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error('--limit must be an integer from 1 through 100.');
  }
  return value;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const apiKey = process.env.THESTATSAPI_API_KEY;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  if (!apiKey) throw new Error('THESTATSAPI_API_KEY is not set.');
  const query = neon(connectionString);
  const limit = requestedLimit();
  const replay = process.argv.includes('--replay');
  const requestedMatch = process.argv.find((arg) => arg.startsWith('--match='))?.slice('--match='.length);
  const rows = await query.query(
    `SELECT source.match_id AS "matchId", source.provider_match_id AS "providerMatchId"
     FROM match_sources source
     JOIN matches match ON match.id = source.match_id
     LEFT JOIN match_timeline_state state ON state.match_id = source.match_id
     WHERE source.provider = $1 AND source.role = 'timeline'
       AND match.status = 'finished'
       AND ($2::text IS NULL OR source.match_id = $2)
       AND ($4::boolean OR COALESCE(state.mode, '') <> 'finalized')
     ORDER BY match.kickoff DESC
     LIMIT $3`,
    [THE_STATS_API_PROVIDER, requestedMatch ?? null, limit, replay],
  ) as Array<{ matchId: string; providerMatchId: string }>;
  console.log(`Preparing to backfill ${rows.length} finished timeline(s) at <=6 requests/minute.`);
  let finalized = 0;
  let unavailable = 0;
  for (const [index, row] of rows.entries()) {
    if (index > 0) await delay(BACKFILL_DELAY_MS);
    const result = await backfillStatsApiTimeline({
      databaseUrl: connectionString,
      apiKey,
      matchId: row.matchId,
      providerMatchId: row.providerMatchId,
      now: new Date(),
    });
    if (result.outcome === 'finalized') finalized += 1;
    else unavailable += 1;
    console.log(JSON.stringify({
      progress: `${index + 1}/${rows.length}`,
      matchId: row.matchId,
      ...result,
    }));
  }

  const [verification] = await query`
    SELECT
      count(*) FILTER (WHERE verification_status = 'confirmed')::int AS confirmed,
      count(*) FILTER (WHERE verification_status = 'retracted')::int AS retracted,
      count(DISTINCT match_id)::int AS "matchesWithMoments"
    FROM match_moments
    WHERE provider = ${THE_STATS_API_PROVIDER}
  `;
  const [duplicates] = await query`
    SELECT count(*)::int AS count FROM (
      SELECT provider, provider_event_id
      FROM match_moments
      WHERE provider = ${THE_STATS_API_PROVIDER} AND provider_event_id IS NOT NULL
      GROUP BY provider, provider_event_id HAVING count(*) > 1
    ) duplicate_events
  `;
  const [invalidIds] = await query`
    SELECT count(*)::int AS count
    FROM match_moments
    WHERE provider = ${THE_STATS_API_PROVIDER} AND provider_event_id IS NULL
  `;
  if (Number(invalidIds.count) !== 0) throw new Error('TheStatsAPI moments with null provider IDs detected.');
  if (Number(duplicates.count) !== 0) throw new Error('Duplicate TheStatsAPI moment IDs detected.');
  console.log(JSON.stringify({ finalized, unavailable, verification, duplicateProviderEvents: 0 }));
}

runDatabaseOperation({ operation: 'TheStatsAPI finalized timeline backfill' }, main)
  .catch(exitOnDatabaseError);
