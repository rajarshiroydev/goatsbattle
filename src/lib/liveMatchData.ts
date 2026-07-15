import { neon } from '@neondatabase/serverless';
import { deriveLiveMatchClock } from './liveMatchClock';
import { deriveLiveScore } from './liveScore';
import type { LiveMatchSnapshot } from './liveMatchProtocol';
import type { Moment } from './matchMoments';

export async function readLiveMatchSnapshot(options: {
  databaseUrl: string;
  matchId: string;
  revision: number;
  now?: Date;
}): Promise<LiveMatchSnapshot> {
  const query = neon(options.databaseUrl);
  const [match] = await query.query(
    `SELECT match.id, match.status,
            match.home_score AS "homeScore", match.away_score AS "awayScore",
            match.home_penalty_score AS "homePenaltyScore",
            match.away_penalty_score AS "awayPenaltyScore",
            state.events -> -1 AS "latestEvent",
            state.fetched_at AS "fetchedAt",
            state.last_success_at AS "lastSuccessAt",
            state.coverage AS "timelineCoverage",
            (
              SELECT snapshot.fetched_at
              FROM match_timeline_snapshots snapshot
              WHERE snapshot.match_id = match.id
                AND snapshot.snapshot_hash = state.snapshot_hash
              ORDER BY snapshot.fetched_at ASC
              LIMIT 1
            ) AS "observedAt"
     FROM matches match
     LEFT JOIN match_timeline_state state ON state.match_id = match.id
     WHERE match.id = $1`,
    [options.matchId],
  ) as Array<{
    id: string;
    status: string;
    homeScore: number | null;
    awayScore: number | null;
    homePenaltyScore: number | null;
    awayPenaltyScore: number | null;
    latestEvent: unknown;
    fetchedAt: Date | string | null;
    lastSuccessAt: Date | string | null;
    timelineCoverage: string | null;
    observedAt: Date | string | null;
  }>;
  if (!match) throw new Error(`Match ${options.matchId} was not found.`);

  const rows = await query.query(
    `SELECT moment.id, moment.minute, moment.extra, moment.type, moment.team, moment.period,
            moment.player_name AS "playerName", moment.goat_slug AS "goatSlug",
            entity.short_name AS "goatShortName", moment.detail,
            moment.verification_status AS "verificationStatus"
     FROM match_moments moment
     LEFT JOIN entities entity ON entity.id = moment.goat_slug
     WHERE moment.match_id = $1
       AND moment.verification_status IN ('provisional', 'confirmed', 'retracted', 'superseded')
     ORDER BY moment.minute, moment.extra NULLS FIRST, moment.provider_sequence NULLS LAST`,
    [options.matchId],
  ) as Array<Omit<Moment, 'verificationStatus'> & { verificationStatus: string; period: string | null }>;
  const moments: Moment[] = rows.map(({ period: _period, ...moment }) => ({
    ...moment,
    verificationStatus: moment.verificationStatus === 'retracted' || moment.verificationStatus === 'superseded'
      ? 'corrected'
      : 'active',
  }));
  const now = options.now ?? new Date();
  const fetchedAt = match.fetchedAt ? new Date(match.fetchedAt) : null;
  const lastSuccessAt = match.lastSuccessAt ? new Date(match.lastSuccessAt) : null;
  let timelineHomeScore = 0;
  let timelineAwayScore = 0;
  for (const moment of rows) {
    if (!['goal', 'penalty', 'own_goal'].includes(moment.type)
      || moment.period === 'penalties'
      || moment.verificationStatus === 'retracted'
      || moment.verificationStatus === 'superseded') continue;
    if (moment.type === 'own_goal') {
      if (moment.team === 'home') timelineAwayScore += 1;
      else timelineHomeScore += 1;
    } else if (moment.team === 'home') timelineHomeScore += 1;
    else timelineAwayScore += 1;
  }
  // A changed live timeline is broadcast immediately. Deriving its regulation
  // score from the same persisted moments keeps goals and score in one revision;
  // the approximately-minute match-resource poll remains authoritative and
  // recalibrates any provider correction that cannot be inferred here.
  const liveScore = deriveLiveScore({
    status: match.status,
    timelineCoverage: match.timelineCoverage,
    providerHomeScore: match.homeScore,
    providerAwayScore: match.awayScore,
    timelineHomeGoals: timelineHomeScore,
    timelineAwayGoals: timelineAwayScore,
  });
  return {
    matchId: match.id,
    status: match.status,
    homeScore: liveScore.homeScore,
    awayScore: liveScore.awayScore,
    homePenaltyScore: match.homePenaltyScore,
    awayPenaltyScore: match.awayPenaltyScore,
    clock: deriveLiveMatchClock({
      status: match.status,
      latestEvent: match.latestEvent,
      observedAt: match.observedAt ? new Date(match.observedAt) : null,
    }),
    moments,
    revision: options.revision,
    freshness: {
      fetchedAt: fetchedAt?.toISOString() ?? null,
      lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
      delayed: match.status === 'live' && (!lastSuccessAt || now.getTime() - lastSuccessAt.getTime() > 30_000),
    },
  };
}
