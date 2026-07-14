/** Development-only smoke for provisional live events and retractions. */
import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { exitOnDatabaseError, runDatabaseOperation } from './lib/database-safety';
import { persistStatsApiMoments } from '../src/lib/theStatsApiSync';
import type { StatsApiTimeline } from '../src/lib/theStatsApi';

interface MomentFeed {
  moments: Array<{ id: number; verificationStatus: string }>;
  liveEnabled: boolean;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  const query = neon(connectionString);
  const smokeId = randomUUID();
  const providerMatchId = `gbt19-smoke:${smokeId}`;
  const matchId = `gbt19-smoke-${smokeId}`;
  const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost:4321';
  let momentId: number | null = null;
  let matchCreated = false;

  const fetchFeed = async () => {
    const url = new URL('/api/match-moments', baseUrl);
    url.searchParams.set('match', matchId);
    url.searchParams.set('smoke', randomUUID());
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Moment API returned ${response.status}.`);
    return await response.json() as MomentFeed;
  };

  try {
    await query`
      INSERT INTO matches (id, competition, home_team, away_team, kickoff, status)
      VALUES (${matchId}, 'GBT-19 Smoke', 'Smoke Home', 'Smoke Away', now(), 'live')
    `;
    matchCreated = true;
    const source = {
      matchId,
      providerMatchId,
      kickoff: new Date('2026-07-14T19:00:00Z'),
      status: 'live' as const,
      homeTeam: 'France',
      awayTeam: 'Spain',
      metadata: { homeTeamId: 'smoke-home', awayTeamId: 'smoke-away' },
    };
    const timeline: StatsApiTimeline = {
      matchId: providerMatchId,
      coverage: 'partial',
      reason: null,
      lastUpdated: new Date().toISOString(),
      events: [{
        sequence: 1,
        minute: 1,
        extraTime: 0,
        period: 'first_half',
        type: 'goal',
        team: { id: 'smoke-home', name: 'France', slug: null },
        player: { id: 'smoke-player', name: 'Smoke Player', slug: null },
      }],
    };
    const written = await persistStatsApiMoments(
      query, source, timeline, 'gbt19-smoke-1', new Date(), 'provisional',
    );
    if (written.written !== 1) throw new Error(`Expected one provisional write: ${JSON.stringify(written)}`);
    const [inserted] = await query`
      SELECT id FROM match_moments
      WHERE provider_event_id = ${`${providerMatchId}:first_half:1`}
    `;
    momentId = Number(inserted?.id);
    if (!Number.isSafeInteger(momentId)) throw new Error('Reconciler did not persist the smoke event.');

    const provisional = await fetchFeed();
    if (!provisional.liveEnabled) throw new Error('Local live-moment gate is disabled.');
    if (!provisional.moments.some((moment) =>
      moment.id === momentId && moment.verificationStatus === 'provisional')) {
      throw new Error('Moment API did not expose the provisional smoke event.');
    }
    console.log('✓ Provisional event was exposed by the live API.');

    const retracted = await persistStatsApiMoments(
      query,
      source,
      { ...timeline, events: [] },
      'gbt19-smoke-2',
      new Date(),
      'provisional',
    );
    if (retracted.retracted !== 1) throw new Error(`Expected one retraction: ${JSON.stringify(retracted)}`);
    const corrected = await fetchFeed();
    if (corrected.moments.some((moment) => moment.id === momentId)) {
      throw new Error('Moment API still exposed the retracted smoke event.');
    }
    console.log('✓ Retracted event disappeared from the taggable live feed.');

    const finalized = await persistStatsApiMoments(
      query,
      source,
      { ...timeline, coverage: 'full' },
      'gbt19-smoke-final',
      new Date(),
      'confirmed',
    );
    if (finalized.written !== 1) throw new Error(`Expected one final write: ${JSON.stringify(finalized)}`);
    const finalFeed = await fetchFeed();
    const finalMoment = finalFeed.moments.find((moment) => moment.id === momentId);
    if (finalMoment?.verificationStatus !== 'confirmed') {
      throw new Error('Final snapshot did not promote the smoke event to confirmed.');
    }
    console.log('✓ Final snapshot promoted the same durable event to confirmed.');
  } finally {
    if (matchCreated) await query`DELETE FROM matches WHERE id = ${matchId}`;
  }

  const [leftovers] = await query`
    SELECT
      (SELECT count(*)::int FROM matches WHERE id = ${matchId}) AS matches,
      (SELECT count(*)::int FROM match_moments
        WHERE provider_event_id = ${`${providerMatchId}:first_half:1`}) AS moments,
      (SELECT count(*)::int FROM match_timeline_state WHERE match_id = ${matchId}) AS timeline_state
  `;
  if (Number(leftovers.matches) !== 0
    || Number(leftovers.moments) !== 0
    || Number(leftovers.timeline_state) !== 0) {
    throw new Error(`Live-moment smoke cleanup failed: ${JSON.stringify(leftovers)}`);
  }
  console.log('✓ Dedicated smoke match and all dependent state were removed.');
}

runDatabaseOperation({
  operation: 'live-moment lifecycle smoke',
  allowedTargets: ['development'],
}, main).catch(exitOnDatabaseError);
