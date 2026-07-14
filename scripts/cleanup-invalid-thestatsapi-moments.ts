/** One-time cleanup for canary rows written without JSON key normalization. */
import { neon } from '@neondatabase/serverless';
import { THE_STATS_API_PROVIDER } from '../src/lib/theStatsApi';
import { exitOnDatabaseError, runDatabaseOperation } from './lib/database-safety';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  const query = neon(connectionString);
  const cited = await query.query(
    `SELECT moment.id
     FROM match_moments moment
     JOIN comments comment ON comment.moment_id = moment.id
     WHERE moment.provider = $1 AND moment.provider_event_id IS NULL`,
    [THE_STATS_API_PROVIDER],
  );
  if (cited.length > 0) throw new Error('Refusing to remove an invalid moment referenced by a comment.');
  const removed = await query.query(
    `DELETE FROM match_moments
     WHERE provider = $1 AND provider_event_id IS NULL
     RETURNING id`,
    [THE_STATS_API_PROVIDER],
  );
  const [remaining] = await query`
    SELECT count(*)::int AS count
    FROM match_moments
    WHERE provider = ${THE_STATS_API_PROVIDER} AND provider_event_id IS NULL
  `;
  if (Number(remaining.count) !== 0) throw new Error('Invalid TheStatsAPI moments remain after cleanup.');
  await query`
    DELETE FROM match_timeline_state
    WHERE match_id = 'world-cup-2026-match-100' AND provider = ${THE_STATS_API_PROVIDER}
  `;
  await query`
    DELETE FROM match_timeline_snapshots
    WHERE match_id = 'world-cup-2026-match-100' AND provider = ${THE_STATS_API_PROVIDER}
  `;
  const [timelineState] = await query`
    SELECT
      (SELECT count(*)::int FROM match_timeline_state
       WHERE match_id = 'world-cup-2026-match-100'
         AND provider = ${THE_STATS_API_PROVIDER}) AS state,
      (SELECT count(*)::int FROM match_timeline_snapshots
       WHERE match_id = 'world-cup-2026-match-100'
         AND provider = ${THE_STATS_API_PROVIDER}) AS snapshots
  `;
  if (Number(timelineState.state) !== 0 || Number(timelineState.snapshots) !== 0) {
    throw new Error('Invalid TheStatsAPI canary timeline rows remain after cleanup.');
  }
  console.log(`✓ Removed and verified ${removed.length} uncited invalid canary moments and timeline rows.`);
}

runDatabaseOperation({
  operation: 'invalid TheStatsAPI canary cleanup',
  allowedTargets: ['development'],
}, main).catch(exitOnDatabaseError);
