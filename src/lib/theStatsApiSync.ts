import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import {
  StatsApiHttpError,
  fetchStatsApiLineup,
  fetchStatsApiMatch,
  fetchStatsApiTimeline,
  type StatsApiClientOptions,
} from './theStatsApiClient';
import {
  THE_STATS_API_PROVIDER,
  displayProviderTeamName,
  displayScore,
  evaluateLineupQuality,
  hashNormalizedValue,
  type StatsApiLineup,
  type StatsApiMatch,
  type StatsApiTimeline,
  type StatsApiTimelineEvent,
} from './theStatsApi';
import { assertSafeStatusTransition } from './worldCupSync';

const INTERNAL_RPM_LIMIT = 10;
const TRIAL_REQUEST_RESERVE = 9_500;
const ACTIVE_BEFORE_MS = 2 * 60 * 60 * 1_000;
const FINAL_RECHECK_MS = 15 * 60 * 1_000;

type Query = NeonQueryFunction<false, false>;
type AppStatus = 'scheduled' | 'live' | 'finished';

interface SourceRow {
  matchId: string;
  providerMatchId: string;
  kickoff: Date;
  status: AppStatus;
  homeTeam: string;
  awayTeam: string;
  metadata: Record<string, unknown>;
}

type DatabaseSourceRow = Omit<SourceRow, 'kickoff'> & {
  kickoff: Date | string;
};

export function normalizeStatsApiSourceRow(source: DatabaseSourceRow): SourceRow {
  const kickoff = source.kickoff instanceof Date
    ? source.kickoff
    : new Date(source.kickoff);
  if (Number.isNaN(kickoff.getTime())) {
    throw new Error(`Invalid kickoff timestamp for ${source.matchId}.`);
  }
  return { ...source, kickoff };
}

interface NormalizedMoment {
  providerEventId: string;
  providerSequence: number;
  period: string;
  minute: number;
  extra: number;
  type: string;
  team: 'home' | 'away';
  providerTeamId: string;
  providerPlayerId: string | null;
  playerName: string | null;
  detail: string | null;
}

export interface StatsApiSyncResult {
  outcome: 'skipped' | 'updated';
  matches: number;
  scores: number;
  lineupsAccepted: number;
  lineupsRejected: number;
  snapshots: number;
  provisional: number;
  finalized: number;
  failures: number;
}

export interface StatsApiCoordinatorMatch {
  matchId: string;
  provider: typeof THE_STATS_API_PROVIDER;
  providerMatchId: string;
  kickoff: string;
  status: AppStatus;
  featured: boolean;
  needsRepair?: boolean;
}

export async function listStatsApiCoordinatorMatches(options: {
  databaseUrl: string;
  now: Date;
}): Promise<StatsApiCoordinatorMatch[]> {
  const query = neon(options.databaseUrl);
  const rows = await query.query(
    `SELECT source.match_id AS "matchId", source.provider_match_id AS "providerMatchId",
            match.kickoff, match.status,
            EXISTS (
              SELECT 1
              FROM match_timeline_state state
              WHERE state.match_id = match.id
                AND state.coverage = 'full'
                AND NOT EXISTS (
                  SELECT 1 FROM match_moments moment
                  WHERE moment.match_id = match.id AND moment.provider = $1
                )
                AND EXISTS (
                  SELECT 1 FROM jsonb_array_elements(state.events) event
                  WHERE event ->> 'type' IN (
                    'goal', 'yellow_card', 'red_card', 'yellow_red_card', 'substitution',
                    'penalty_awarded', 'penalty_scored', 'penalty_missed', 'penalty_saved', 'var'
                  )
                )
            ) AS "needsRepair"
     FROM match_sources source
     JOIN matches match ON match.id = source.match_id
     WHERE source.provider = $1 AND source.role = 'score'
       AND source.status IN ('active', 'degraded')
       AND (
         (match.status IN ('scheduled', 'live')
           AND match.kickoff BETWEEN $2::timestamptz - interval '5 hours'
                                 AND $2::timestamptz + interval '2 hours')
         OR (match.status = 'finished'
           AND match.kickoff BETWEEN $2::timestamptz - interval '7 days'
                                 AND $2::timestamptz)
       )
     ORDER BY CASE WHEN match.status = 'live' THEN 0 ELSE 1 END, match.kickoff`,
    [THE_STATS_API_PROVIDER, options.now],
  ) as Array<{
    matchId: string;
    providerMatchId: string;
    kickoff: Date | string;
    status: AppStatus;
    needsRepair: boolean;
  }>;
  let featuredAssigned = false;
  return rows.map((row) => {
    const featured = !row.needsRepair && !featuredAssigned;
    if (featured) featuredAssigned = true;
    return {
      matchId: row.matchId,
      provider: THE_STATS_API_PROVIDER,
      providerMatchId: row.providerMatchId,
      kickoff: new Date(row.kickoff).toISOString(),
      status: row.status,
      featured,
      needsRepair: row.needsRepair,
    };
  });
}

export async function reserveStatsApiRequest(query: Query, now: Date, path: string) {
  const rows = await query.query(
    `INSERT INTO provider_sync_state (
       provider, window_started_at, requests_in_window, total_requests, updated_at
     ) VALUES ($1, $2, 1, 1, $2)
     ON CONFLICT (provider) DO UPDATE SET
       window_started_at = CASE
         WHEN provider_sync_state.window_started_at <= $2::timestamptz - interval '60 seconds'
           THEN $2 ELSE provider_sync_state.window_started_at END,
       requests_in_window = CASE
         WHEN provider_sync_state.window_started_at <= $2::timestamptz - interval '60 seconds'
           THEN 1 ELSE provider_sync_state.requests_in_window + 1 END,
       total_requests = provider_sync_state.total_requests + 1,
       updated_at = $2
     WHERE (provider_sync_state.circuit_open_until IS NULL OR provider_sync_state.circuit_open_until <= $2)
       AND provider_sync_state.total_requests < $3
       AND (
         provider_sync_state.window_started_at <= $2::timestamptz - interval '60 seconds'
         OR provider_sync_state.requests_in_window < $4
       )
     RETURNING requests_in_window AS "requestsInWindow", total_requests AS "totalRequests"`,
    [THE_STATS_API_PROVIDER, now, TRIAL_REQUEST_RESERVE, INTERNAL_RPM_LIMIT],
  );
  if (rows.length === 0) {
    throw new Error(`TheStatsAPI quota or circuit breaker refused ${path}.`);
  }
  return rows[0] as { requestsInWindow: number; totalRequests: number };
}

async function noteProviderSuccess(query: Query, now: Date) {
  await query`
    UPDATE provider_sync_state
    SET consecutive_failures = 0, circuit_open_until = NULL, updated_at = ${now}
    WHERE provider = ${THE_STATS_API_PROVIDER}
  `;
}

async function noteProviderFailure(query: Query, now: Date) {
  await query`
    UPDATE provider_sync_state
    SET consecutive_failures = consecutive_failures + 1,
        circuit_open_until = CASE
          WHEN consecutive_failures + 1 >= 5 THEN ${new Date(now.getTime() + 5 * 60_000)}
          ELSE circuit_open_until
        END,
        updated_at = ${now}
    WHERE provider = ${THE_STATS_API_PROVIDER}
  `;
}

function clientOptions(query: Query, apiKey: string, now: Date): StatsApiClientOptions {
  return {
    apiKey,
    reserveRequest: async (path) => {
      await reserveStatsApiRequest(query, now, path);
    },
  };
}

async function providerCall<T>(
  query: Query,
  now: Date,
  operation: () => Promise<T>,
  expectedHttpStatuses: readonly number[] = [],
): Promise<T> {
  try {
    const result = await operation();
    await noteProviderSuccess(query, now);
    return result;
  } catch (error) {
    if (error instanceof StatsApiHttpError && expectedHttpStatuses.includes(error.status)) {
      await noteProviderSuccess(query, now);
      throw error;
    }
    if (!(error instanceof Error && error.message.includes('quota or circuit breaker refused'))) {
      await noteProviderFailure(query, now).catch(() => undefined);
    }
    throw error;
  }
}

function appStatus(status: StatsApiMatch['status']): AppStatus {
  if (status === 'live') return 'live';
  if (status === 'finished') return 'finished';
  return 'scheduled';
}

function isoOrNull(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function updateScore(
  query: Query,
  source: SourceRow,
  match: StatsApiMatch,
  now: Date,
) {
  if (match.id !== source.providerMatchId) throw new Error('Provider match identity changed.');
  const nextStatus = appStatus(match.status);
  assertSafeStatusTransition(source.status, nextStatus);
  const score = displayScore(match.score);
  const homeTeam = displayProviderTeamName(match.homeTeam.name, source.homeTeam);
  const awayTeam = displayProviderTeamName(match.awayTeam.name, source.awayTeam);
  const [updated] = await query.query(
    `WITH updated_match AS (
       UPDATE matches
       SET home_team = $3,
           away_team = $4,
           home_score = $5,
           away_score = $6,
           home_penalty_score = $7,
           away_penalty_score = $8,
           status = $9,
           source_status = 'fresh',
           last_synced_at = $10
       WHERE id = $1
         AND status = $2
         AND (last_synced_at IS NULL OR last_synced_at <= $10)
       RETURNING id
     ), updated_sources AS (
       UPDATE match_sources
       SET metadata = metadata || jsonb_build_object(
             'homeTeamId', $11::text,
             'awayTeamId', $12::text
           ),
           last_attempt_at = $10,
           last_success_at = $10,
           status = 'active',
           updated_at = $10
       WHERE match_id IN (SELECT id FROM updated_match)
         AND provider = $13
       RETURNING role
     )
     SELECT
       (SELECT count(*)::int FROM updated_match) AS "matchesUpdated",
       (SELECT count(*)::int FROM updated_sources) AS "sourcesUpdated"`,
    [
      source.matchId,
      source.status,
      homeTeam,
      awayTeam,
      score.home,
      score.away,
      score.penaltiesHome,
      score.penaltiesAway,
      nextStatus,
      now,
      match.homeTeam.id,
      match.awayTeam.id,
      THE_STATS_API_PROVIDER,
    ],
  ) as Array<{ matchesUpdated: number; sourcesUpdated: number }>;
  if (Number(updated?.matchesUpdated ?? 0) === 0) {
    throw new Error(`Concurrent score refresh superseded ${source.matchId}.`);
  }
  if (Number(updated?.sourcesUpdated ?? 0) === 0) {
    throw new Error(`Provider metadata refresh missed ${source.matchId}.`);
  }
  source.status = nextStatus;
  source.homeTeam = homeTeam;
  source.awayTeam = awayTeam;
  source.metadata = {
    ...source.metadata,
    homeTeamId: match.homeTeam.id,
    awayTeamId: match.awayTeam.id,
  };
}

async function persistLineup(
  query: Query,
  source: SourceRow,
  lineup: StatsApiLineup,
  matchStatus: AppStatus,
  now: Date,
) {
  const quality = evaluateLineupQuality({
    lineup,
    kickoff: source.kickoff,
    now,
    matchStatus,
  });
  const snapshotHash = await hashNormalizedValue(lineup);
  const status = quality.accepted ? 'official' : 'rejected';
  const rejectionReason = quality.accepted ? null : quality.reason;
  await query.query(
    `INSERT INTO match_lineups (
       match_id, provider, provider_match_id, status, rejection_reason,
       snapshot_hash, lineup, fetched_at, validated_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $8)
     ON CONFLICT (match_id, provider) DO UPDATE SET
       provider_match_id = excluded.provider_match_id,
       status = excluded.status,
       rejection_reason = excluded.rejection_reason,
       snapshot_hash = excluded.snapshot_hash,
       lineup = excluded.lineup,
       fetched_at = excluded.fetched_at,
       validated_at = excluded.validated_at,
       updated_at = excluded.updated_at
     WHERE match_lineups.status <> 'official' OR excluded.status = 'official'`,
    [
      source.matchId,
      THE_STATS_API_PROVIDER,
      source.providerMatchId,
      status,
      rejectionReason,
      snapshotHash,
      JSON.stringify(lineup),
      now,
      quality.accepted ? now : null,
    ],
  );
  if (quality.accepted) await linkMappedGoats(query, source.matchId, lineup);
  return quality;
}

async function linkMappedGoats(query: Query, matchId: string, lineup: StatsApiLineup) {
  const participants = [
    ...lineup.home.startingXi.map((player) => ({ id: player.id, team: 'home' })),
    ...lineup.home.substitutes.map((player) => ({ id: player.id, team: 'home' })),
    ...lineup.away.startingXi.map((player) => ({ id: player.id, team: 'away' })),
    ...lineup.away.substitutes.map((player) => ({ id: player.id, team: 'away' })),
  ];
  await query.query(
    `WITH participants AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS p(id text, team text)
     )
     INSERT INTO match_goats (match_id, goat_slug, team)
     SELECT $2, mapping.goat_slug, participants.team
     FROM participants
     JOIN goat_provider_players mapping
       ON mapping.provider = $3 AND mapping.provider_player_id = participants.id
     ON CONFLICT (match_id, goat_slug) DO UPDATE SET team = excluded.team`,
    [JSON.stringify(participants), matchId, THE_STATS_API_PROVIDER],
  );
}

async function persistTimelineSnapshot(
  query: Query,
  source: SourceRow,
  timeline: StatsApiTimeline,
  mode: 'shadow' | 'finalizing',
  now: Date,
) {
  const snapshotHash = await hashNormalizedValue(timeline.events);
  const providerUpdatedAt = isoOrNull(timeline.lastUpdated);
  await query.query(
    `INSERT INTO match_timeline_snapshots (
       match_id, provider, snapshot_hash, coverage, event_count, events,
       provider_updated_at, fetched_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     ON CONFLICT (match_id, provider, snapshot_hash) DO NOTHING`,
    [source.matchId, THE_STATS_API_PROVIDER, snapshotHash, timeline.coverage,
      timeline.events.length, JSON.stringify(timeline.events), providerUpdatedAt, now],
  );
  const [state] = await query.query(
    `INSERT INTO match_timeline_state (
       match_id, provider, provider_match_id, mode, coverage, snapshot_hash,
       snapshot_version, events, provider_updated_at, fetched_at, last_success_at,
       last_final_check_at, consecutive_identical, last_error_code, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7::jsonb, $8, $9, $9, $10, 1, NULL, $9)
     ON CONFLICT (match_id) DO UPDATE SET
       provider = excluded.provider,
       provider_match_id = excluded.provider_match_id,
       mode = excluded.mode,
       coverage = excluded.coverage,
       snapshot_hash = excluded.snapshot_hash,
       snapshot_version = CASE
         WHEN match_timeline_state.snapshot_hash IS DISTINCT FROM excluded.snapshot_hash
           THEN match_timeline_state.snapshot_version + 1
         ELSE match_timeline_state.snapshot_version END,
       events = excluded.events,
       provider_updated_at = excluded.provider_updated_at,
       fetched_at = excluded.fetched_at,
       last_success_at = excluded.last_success_at,
       last_final_check_at = excluded.last_final_check_at,
       consecutive_identical = CASE
         WHEN match_timeline_state.snapshot_hash = excluded.snapshot_hash
           THEN match_timeline_state.consecutive_identical + 1
         ELSE 1 END,
       last_error_code = NULL,
       updated_at = excluded.updated_at
     WHERE match_timeline_state.fetched_at IS NULL
        OR match_timeline_state.fetched_at < excluded.fetched_at
     RETURNING snapshot_hash AS "snapshotHash",
               consecutive_identical AS "consecutiveIdentical"`,
    [source.matchId, THE_STATS_API_PROVIDER, source.providerMatchId, mode,
      timeline.coverage, snapshotHash, JSON.stringify(timeline.events), providerUpdatedAt,
      now, mode === 'finalizing' ? now : null],
  ) as Array<{ snapshotHash: string; consecutiveIdentical: number }>;
  if (!state) {
    return { accepted: false, snapshotHash, unchanged: false, consecutiveIdentical: 0 };
  }
  const consecutiveIdentical = Number(state.consecutiveIdentical);
  return {
    accepted: true,
    snapshotHash: state.snapshotHash,
    unchanged: consecutiveIdentical > 1,
    consecutiveIdentical,
  };
}

export function normalizeStatsApiMoment(
  event: StatsApiTimelineEvent,
  providerMatchId: string,
  homeTeamId: string,
  awayTeamId: string,
): NormalizedMoment | null {
  const supported = new Set([
    'goal', 'yellow_card', 'red_card', 'yellow_red_card', 'substitution',
    'penalty_awarded', 'penalty_scored', 'penalty_missed', 'penalty_saved', 'var',
  ]);
  if (!supported.has(event.type) || !event.team?.id) return null;
  const team = event.team.id === homeTeamId
    ? 'home'
    : event.team.id === awayTeamId
      ? 'away'
      : null;
  if (!team) return null;
  const type = event.type === 'substitution'
    ? 'sub'
    : event.type === 'yellow_red_card'
      ? 'red_card'
      : event.type === 'penalty_scored'
        ? (event.period === 'penalties' ? 'shootout' : 'penalty')
        : event.type === 'penalty_missed' || event.type === 'penalty_saved'
          ? 'penalty_missed'
          : event.type;
  const detail = event.type === 'substitution'
    ? 'Substitution recorded; provider supplies one player only.'
    : event.type === 'var'
      ? 'VAR review; provider outcome unavailable.'
      : event.type === 'penalty_saved'
        ? 'Penalty saved'
        : event.type === 'penalty_missed'
          ? 'Penalty missed'
          : null;
  return {
    providerEventId: `${providerMatchId}:${event.period}:${event.sequence}`,
    providerSequence: event.sequence,
    period: event.period,
    minute: event.minute,
    extra: event.extraTime,
    type,
    team,
    providerTeamId: event.team.id,
    providerPlayerId: event.player?.id ?? null,
    playerName: event.player?.name ?? null,
    detail,
  };
}

export async function persistStatsApiMoments(
  query: Query,
  source: SourceRow,
  timeline: StatsApiTimeline,
  snapshotHash: string,
  now: Date,
  verificationStatus: 'provisional' | 'confirmed',
) {
  if (verificationStatus === 'confirmed' && timeline.coverage !== 'full') {
    throw new Error('Refusing to finalize a non-full timeline.');
  }
  const homeTeamId = String(source.metadata.homeTeamId ?? '');
  const awayTeamId = String(source.metadata.awayTeamId ?? '');
  if (!homeTeamId || !awayTeamId) throw new Error('Match source lacks provider team IDs.');
  const moments = timeline.events
    .map((event) => normalizeStatsApiMoment(event, source.providerMatchId, homeTeamId, awayTeamId))
    .filter((moment): moment is NormalizedMoment => moment !== null);
  const databaseMoments = moments.map((moment) => ({
    provider_event_id: moment.providerEventId,
    provider_sequence: moment.providerSequence,
    period: moment.period,
    minute: moment.minute,
    extra: moment.extra,
    type: moment.type,
    team: moment.team,
    provider_team_id: moment.providerTeamId,
    provider_player_id: moment.providerPlayerId,
    player_name: moment.playerName,
    detail: moment.detail,
  }));
  const [result] = await query.query(
    `WITH incoming AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS event(
         provider_event_id text, provider_sequence integer, period text,
         minute integer, extra integer, type text, team text,
         provider_team_id text, provider_player_id text, player_name text, detail text
       )
     ), upserted AS (
       INSERT INTO match_moments (
         provider, provider_event_id, provider_sequence, period, match_id,
         minute, extra, type, team, provider_team_id, provider_player_id,
         player_name, goat_slug, detail, verification_status, snapshot_hash, updated_at
       )
       SELECT $2, event.provider_event_id, event.provider_sequence, event.period, $3,
         event.minute, event.extra, event.type, event.team, event.provider_team_id,
         event.provider_player_id, event.player_name, mapping.goat_slug, event.detail,
         $6, $4, $5
       FROM incoming event
       LEFT JOIN goat_provider_players mapping
         ON mapping.provider = $2 AND mapping.provider_player_id = event.provider_player_id
       ON CONFLICT (provider, provider_event_id) DO UPDATE SET
         provider_sequence = excluded.provider_sequence,
         period = excluded.period,
         minute = excluded.minute,
         extra = excluded.extra,
         type = excluded.type,
         team = excluded.team,
         provider_team_id = excluded.provider_team_id,
         provider_player_id = excluded.provider_player_id,
         player_name = excluded.player_name,
         goat_slug = COALESCE(excluded.goat_slug, match_moments.goat_slug),
         detail = excluded.detail,
         verification_status = CASE
           WHEN match_moments.verification_status = 'confirmed' AND $6 = 'provisional'
             THEN 'confirmed'
           ELSE $6
         END,
         snapshot_hash = excluded.snapshot_hash,
         updated_at = excluded.updated_at
       RETURNING provider_event_id
     ), retracted AS (
       UPDATE match_moments existing
       SET verification_status = 'retracted', snapshot_hash = $4, updated_at = $5
       WHERE existing.match_id = $3 AND existing.provider = $2
         AND ($6 = 'confirmed' OR existing.verification_status = 'provisional')
         AND NOT EXISTS (
           SELECT 1 FROM incoming WHERE incoming.provider_event_id = existing.provider_event_id
       )
       RETURNING existing.provider_event_id
     ), finalized AS (
       UPDATE match_timeline_state
       SET mode = 'finalized', updated_at = $5
       WHERE match_id = $3 AND $6 = 'confirmed'
       RETURNING match_id
     )
     SELECT
       (SELECT count(*)::int FROM upserted) AS written,
       (SELECT count(*)::int FROM retracted) AS retracted,
       (SELECT count(*)::int FROM finalized) AS finalized`,
    [JSON.stringify(databaseMoments), THE_STATS_API_PROVIDER, source.matchId, snapshotHash, now, verificationStatus],
  ) as Array<{ written: number; retracted: number }>;
  return { written: Number(result?.written ?? 0), retracted: Number(result?.retracted ?? 0) };
}

async function finalizeDurableMoments(
  query: Query,
  source: SourceRow,
  timeline: StatsApiTimeline,
  snapshotHash: string,
  now: Date,
) {
  const result = await persistStatsApiMoments(query, source, timeline, snapshotHash, now, 'confirmed');
  return { confirmed: result.written, retracted: result.retracted };
}

async function shouldFetchFinalTimeline(query: Query, matchId: string, now: Date) {
  const [state] = await query.query(
    `SELECT state.mode, state.last_final_check_at AS "lastFinalCheckAt",
            (state.coverage = 'full'
              AND NOT EXISTS (
                SELECT 1 FROM match_moments moment
                WHERE moment.match_id = $1 AND moment.provider = $2
              ) AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(state.events) event
                WHERE event ->> 'type' IN (
                  'goal', 'yellow_card', 'red_card', 'yellow_red_card', 'substitution',
                  'penalty_awarded', 'penalty_scored', 'penalty_missed', 'penalty_saved', 'var'
                )
              )
            ) AS "needsRepair"
     FROM match_timeline_state state WHERE state.match_id = $1`,
    [matchId, THE_STATS_API_PROVIDER],
  ) as Array<{ mode: string; lastFinalCheckAt: Date | null; needsRepair: boolean }>;
  if (state?.mode === 'finalized' && !state.needsRepair) return false;
  if (state?.needsRepair) return true;
  return !state?.lastFinalCheckAt
    || now.getTime() - new Date(state.lastFinalCheckAt).getTime() >= FINAL_RECHECK_MS;
}

async function syncOneSource(
  query: Query,
  source: SourceRow,
  apiKey: string,
  now: Date,
) {
  const options = clientOptions(query, apiKey, now);
  const match = await providerCall(query, now, () => fetchStatsApiMatch(source.providerMatchId, options));
  await updateScore(query, source, match, now);
  let lineupAccepted = 0;
  let lineupRejected = 0;
  let snapshots = 0;
  let provisional = 0;
  let finalized = 0;

  const insideLineupWindow = now.getTime() >= source.kickoff.getTime() - ACTIVE_BEFORE_MS;
  if (insideLineupWindow) {
    const [existing] = await query.query(
      `SELECT status FROM match_lineups WHERE match_id = $1 AND provider = $2`,
      [source.matchId, THE_STATS_API_PROVIDER],
    ) as Array<{ status: string }>;
    if (existing?.status !== 'official') {
      try {
        const lineup = await providerCall(
          query,
          now,
          () => fetchStatsApiLineup(source.providerMatchId, options),
          [404],
        );
        const quality = await persistLineup(query, source, lineup, source.status, now);
        if (quality.accepted) lineupAccepted += 1;
        else lineupRejected += 1;
      } catch (error) {
        if (!(error instanceof StatsApiHttpError && error.status === 404)) throw error;
      }
    }
  }

  if (source.status === 'live') {
    const timeline = await providerCall(query, now, () => fetchStatsApiTimeline(source.providerMatchId, true, options));
    const snapshot = await persistTimelineSnapshot(query, source, timeline, 'shadow', now);
    if (snapshot.accepted) {
      snapshots += 1;
      const moments = await persistStatsApiMoments(
        query, source, timeline, snapshot.snapshotHash, now, 'provisional',
      );
      provisional += moments.written;
    }
  } else if (source.status === 'finished' && await shouldFetchFinalTimeline(query, source.matchId, now)) {
    const timeline = await providerCall(query, now, () => fetchStatsApiTimeline(source.providerMatchId, false, options));
    const snapshot = await persistTimelineSnapshot(query, source, timeline, 'finalizing', now);
    if (!snapshot.accepted) return { lineupAccepted, lineupRejected, snapshots, provisional, finalized };
    snapshots += 1;
    if (timeline.coverage === 'full') {
      await finalizeDurableMoments(query, source, timeline, snapshot.snapshotHash, now);
      finalized += 1;
    }
  }
  return { lineupAccepted, lineupRejected, snapshots, provisional, finalized };
}

export type CoordinatedStatsApiWork = 'status' | 'lineup' | 'timeline' | 'final';

export interface CoordinatedStatsApiResult {
  work: CoordinatedStatsApiWork;
  matchStatus: AppStatus;
  changed: boolean;
  officialLineup?: boolean;
  snapshotHash?: string;
  finalized?: boolean;
}

async function loadCoordinatedSource(query: Query, matchId: string): Promise<SourceRow> {
  const [databaseSource] = await query.query(
    `SELECT source.match_id AS "matchId", source.provider_match_id AS "providerMatchId",
            match.kickoff, match.status, match.home_team AS "homeTeam",
            match.away_team AS "awayTeam", source.metadata
     FROM match_sources source
     JOIN matches match ON match.id = source.match_id
     WHERE source.match_id = $1 AND source.provider = $2 AND source.role = 'score'
       AND source.status IN ('active', 'degraded')
     LIMIT 1`,
    [matchId, THE_STATS_API_PROVIDER],
  ) as DatabaseSourceRow[];
  if (!databaseSource) throw new Error(`No active TheStatsAPI source for ${matchId}.`);
  return normalizeStatsApiSourceRow(databaseSource);
}

/** One quota-accounted provider operation for the Durable Object coordinator.
 * The broker allocates a slot before this is called; reserveStatsApiRequest is
 * still invoked by the client as the cross-isolate final authority. */
export async function syncCoordinatedStatsApiMatch(options: {
  databaseUrl: string;
  apiKey: string;
  matchId: string;
  work: CoordinatedStatsApiWork;
  now: Date;
}): Promise<CoordinatedStatsApiResult> {
  const query = neon(options.databaseUrl);
  const source = await loadCoordinatedSource(query, options.matchId);
  const client = clientOptions(query, options.apiKey, options.now);

  if (options.work === 'status') {
    const before = source.status;
    const match = await providerCall(query, options.now, () =>
      fetchStatsApiMatch(source.providerMatchId, client));
    await updateScore(query, source, match, options.now);
    return { work: options.work, matchStatus: source.status, changed: before !== source.status };
  }

  if (options.work === 'lineup') {
    const [existing] = await query.query(
      `SELECT status FROM match_lineups WHERE match_id = $1 AND provider = $2`,
      [source.matchId, THE_STATS_API_PROVIDER],
    ) as Array<{ status: string }>;
    if (existing?.status === 'official') {
      return { work: options.work, matchStatus: source.status, changed: false, officialLineup: true };
    }
    try {
      const lineup = await providerCall(query, options.now, () =>
        fetchStatsApiLineup(source.providerMatchId, client), [404]);
      const quality = await persistLineup(query, source, lineup, source.status, options.now);
      return {
        work: options.work,
        matchStatus: source.status,
        changed: quality.accepted,
        officialLineup: quality.accepted,
      };
    } catch (error) {
      if (error instanceof StatsApiHttpError && error.status === 404) {
        return { work: options.work, matchStatus: source.status, changed: false, officialLineup: false };
      }
      throw error;
    }
  }

  if (options.work === 'timeline') {
    if (source.status !== 'live') {
      return { work: options.work, matchStatus: source.status, changed: false };
    }
    const timeline = await providerCall(query, options.now, () =>
      fetchStatsApiTimeline(source.providerMatchId, true, client));
    const snapshot = await persistTimelineSnapshot(query, source, timeline, 'shadow', options.now);
    if (snapshot.accepted) {
      await persistStatsApiMoments(
        query, source, timeline, snapshot.snapshotHash, options.now, 'provisional',
      );
    }
    return {
      work: options.work,
      matchStatus: source.status,
      changed: snapshot.accepted && !snapshot.unchanged,
      snapshotHash: snapshot.snapshotHash,
    };
  }

  const timeline = await providerCall(query, options.now, () =>
    fetchStatsApiTimeline(source.providerMatchId, false, client));
  const snapshot = await persistTimelineSnapshot(query, source, timeline, 'finalizing', options.now);
  if (snapshot.accepted && timeline.coverage === 'full') {
    await finalizeDurableMoments(query, source, timeline, snapshot.snapshotHash, options.now);
  }
  return {
    work: options.work,
    matchStatus: source.status,
    changed: snapshot.accepted && !snapshot.unchanged,
    snapshotHash: snapshot.snapshotHash,
    finalized: snapshot.accepted && timeline.coverage === 'full',
  };
}

export async function refreshTheStatsApiWorldCup(options: {
  databaseUrl: string;
  apiKey: string;
  now: Date;
  excludeMatchIds?: readonly string[];
}): Promise<StatsApiSyncResult> {
  const query = neon(options.databaseUrl);
  const databaseRows = await query.query(
    `SELECT source.match_id AS "matchId", source.provider_match_id AS "providerMatchId",
            match.kickoff, match.status, match.home_team AS "homeTeam",
            match.away_team AS "awayTeam", source.metadata
     FROM match_sources source
     JOIN matches match ON match.id = source.match_id
     WHERE source.provider = $1 AND source.role = 'score'
       AND source.status IN ('active', 'degraded')
       AND (
         match.kickoff BETWEEN $2::timestamptz - interval '5 hours'
                           AND $2::timestamptz + interval '2 hours'
         OR (
           match.status = 'finished'
           AND match.kickoff BETWEEN $2::timestamptz - interval '7 days' AND $2::timestamptz
           AND (source.last_attempt_at IS NULL
             OR source.last_attempt_at <= $2::timestamptz - interval '15 minutes')
           AND EXISTS (
             SELECT 1
             FROM match_timeline_state state
             WHERE state.match_id = match.id
               AND state.coverage = 'full'
               AND NOT EXISTS (
                 SELECT 1 FROM match_moments moment
                 WHERE moment.match_id = match.id AND moment.provider = $1
               )
               AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(state.events) event
                 WHERE event ->> 'type' IN (
                   'goal', 'yellow_card', 'red_card', 'yellow_red_card', 'substitution',
                   'penalty_awarded', 'penalty_scored', 'penalty_missed', 'penalty_saved', 'var'
                 )
               )
           )
         )
       )
     ORDER BY match.kickoff`,
    [THE_STATS_API_PROVIDER, options.now],
  ) as DatabaseSourceRow[];
  const excluded = new Set(options.excludeMatchIds ?? []);
  const rows = databaseRows.map(normalizeStatsApiSourceRow)
    .filter((source) => !excluded.has(source.matchId));
  if (rows.length === 0) {
    return {
      outcome: 'skipped', matches: 0, scores: 0, lineupsAccepted: 0,
      lineupsRejected: 0, snapshots: 0, provisional: 0, finalized: 0, failures: 0,
    };
  }
  const result: StatsApiSyncResult = {
    outcome: 'updated', matches: rows.length, scores: 0, lineupsAccepted: 0,
    lineupsRejected: 0, snapshots: 0, provisional: 0, finalized: 0, failures: 0,
  };
  for (const source of rows) {
    try {
      const synced = await syncOneSource(query, source, options.apiKey, options.now);
      result.scores += 1;
      result.lineupsAccepted += synced.lineupAccepted;
      result.lineupsRejected += synced.lineupRejected;
      result.snapshots += synced.snapshots;
      result.provisional += synced.provisional;
      result.finalized += synced.finalized;
    } catch (error) {
      result.failures += 1;
      await query`
        UPDATE match_sources
        SET status = 'degraded', last_attempt_at = ${options.now}, updated_at = ${options.now}
        WHERE match_id = ${source.matchId} AND provider = ${THE_STATS_API_PROVIDER}
      `.catch(() => undefined);
      await query`
        UPDATE match_timeline_state
        SET mode = CASE WHEN mode = 'finalized' THEN mode ELSE 'degraded' END,
            last_error_code = ${error instanceof StatsApiHttpError ? `http_${error.status}` : 'sync_error'},
            updated_at = ${options.now}
        WHERE match_id = ${source.matchId}
      `.catch(() => undefined);
      console.error(JSON.stringify({
        event: 'thestatsapi_match_sync_failed',
        matchId: source.matchId,
        providerMatchId: source.providerMatchId,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  return result;
}

export async function backfillStatsApiTimeline(options: {
  databaseUrl: string;
  apiKey: string;
  matchId: string;
  providerMatchId: string;
  now: Date;
}) {
  const query = neon(options.databaseUrl);
  const [databaseSource] = await query.query(
    `SELECT source.match_id AS "matchId", source.provider_match_id AS "providerMatchId",
            match.kickoff, match.status, match.home_team AS "homeTeam",
            match.away_team AS "awayTeam", source.metadata
     FROM match_sources source
     JOIN matches match ON match.id = source.match_id
     WHERE source.match_id = $1 AND source.provider_match_id = $2
       AND source.provider = $3 AND source.role = 'timeline'`,
    [options.matchId, options.providerMatchId, THE_STATS_API_PROVIDER],
  ) as DatabaseSourceRow[];
  if (!databaseSource) throw new Error(`No TheStatsAPI timeline source for ${options.matchId}.`);
  const source = normalizeStatsApiSourceRow(databaseSource);
  if (source.status !== 'finished') throw new Error(`Refusing to backfill unfinished match ${options.matchId}.`);
  const client = clientOptions(query, options.apiKey, options.now);
  const timeline = await providerCall(query, options.now, () =>
    fetchStatsApiTimeline(options.providerMatchId, false, client));
  const snapshot = await persistTimelineSnapshot(query, source, timeline, 'finalizing', options.now);
  if (timeline.coverage !== 'full') {
    return { outcome: 'not-finalized' as const, coverage: timeline.coverage, events: timeline.events.length };
  }
  const moments = await finalizeDurableMoments(query, source, timeline, snapshot.snapshotHash, options.now);
  return { outcome: 'finalized' as const, events: timeline.events.length, ...moments };
}
