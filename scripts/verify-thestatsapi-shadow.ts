/** Structural semifinal shadow-run audit. Official event completeness remains a human gate. */
import { neon } from '@neondatabase/serverless';
import { THE_STATS_API_PROVIDER } from '../src/lib/theStatsApi';
import { exitOnDatabaseError, runDatabaseOperation } from './lib/database-safety';

const CORE_TYPES = new Set([
  'goal', 'yellow_card', 'red_card', 'yellow_red_card', 'substitution',
  'penalty_awarded', 'penalty_scored', 'penalty_missed', 'penalty_saved', 'var',
]);

interface SnapshotEvent {
  sequence?: unknown;
  minute?: unknown;
  extraTime?: unknown;
  period?: unknown;
  type?: unknown;
  team?: { name?: unknown } | null;
  player?: { name?: unknown } | null;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  const matchId = process.argv.find((argument) => argument.startsWith('--match='))
    ?.slice('--match='.length);
  if (!matchId || !/^world-cup-2026-match-(101|102)$/.test(matchId)) {
    throw new Error('Pass a semifinal: --match=world-cup-2026-match-101 or --match=world-cup-2026-match-102.');
  }
  const query = neon(connectionString);
  const [match] = await query.query(
    `SELECT id, kickoff, status FROM matches WHERE id = $1`,
    [matchId],
  ) as Array<{ id: string; kickoff: Date; status: string }>;
  if (!match) throw new Error(`Unknown match ${matchId}.`);
  const kickoff = new Date(match.kickoff);
  const snapshots = await query.query(
    `SELECT snapshot_hash AS "snapshotHash", event_count AS "eventCount",
            events, fetched_at AS "fetchedAt"
     FROM match_timeline_snapshots
     WHERE match_id = $1 AND provider = $2
       AND fetched_at BETWEEN $3::timestamptz - interval '15 minutes'
                          AND $3::timestamptz + interval '5 hours'
     ORDER BY fetched_at`,
    [matchId, THE_STATS_API_PROVIDER, kickoff],
  ) as Array<{
    snapshotHash: string;
    eventCount: number;
    events: SnapshotEvent[];
    fetchedAt: Date;
  }>;
  if (snapshots.length < 2) {
    throw new Error(`Shadow evidence is insufficient: found ${snapshots.length} changed snapshot(s).`);
  }
  if (new Set(snapshots.map((snapshot) => snapshot.snapshotHash)).size !== snapshots.length) {
    throw new Error('Duplicate snapshot hashes detected.');
  }
  for (const snapshot of snapshots) {
    if (!Array.isArray(snapshot.events) || snapshot.events.length !== Number(snapshot.eventCount)) {
      throw new Error(`Snapshot ${snapshot.snapshotHash} event count does not match its payload.`);
    }
    const sequences = snapshot.events.map((event) => Number(event.sequence));
    if (sequences.some((sequence) => !Number.isInteger(sequence) || sequence < 0)) {
      throw new Error(`Snapshot ${snapshot.snapshotHash} contains an invalid sequence.`);
    }
    if (sequences.some((sequence, index) => index > 0 && sequence <= sequences[index - 1])) {
      throw new Error(`Snapshot ${snapshot.snapshotHash} is not strictly ordered by sequence.`);
    }
  }
  const latest = snapshots.at(-1)!;
  const coreEvents = latest.events.filter((event) => CORE_TYPES.has(String(event.type)));
  const [momentCounts] = await query.query(
    `SELECT count(*) FILTER (WHERE verification_status = 'confirmed')::int AS confirmed,
            count(*) FILTER (WHERE verification_status = 'retracted')::int AS retracted,
            count(DISTINCT provider_event_id)::int AS "uniqueProviderEvents"
     FROM match_moments WHERE match_id = $1 AND provider = $2`,
    [matchId, THE_STATS_API_PROVIDER],
  ) as Array<{ confirmed: number; retracted: number; uniqueProviderEvents: number }>;

  console.log(JSON.stringify({
    structuralShadowChecks: 'passed',
    matchId,
    matchStatus: match.status,
    changedSnapshots: snapshots.length,
    firstSnapshotAt: new Date(snapshots[0].fetchedAt).toISOString(),
    latestSnapshotAt: new Date(latest.fetchedAt).toISOString(),
    latestEventCount: latest.eventCount,
    durableMoments: momentCounts,
    coreEventsForOfficialReview: coreEvents.map((event) => ({
      sequence: event.sequence,
      minute: event.minute,
      extraTime: event.extraTime,
      period: event.period,
      type: event.type,
      team: event.team?.name ?? null,
      player: event.player?.name ?? null,
    })),
    remainingGate: 'Compare goals, cards, ordering, stoppage time, and outages against the official match record.',
  }, null, 2));
}

runDatabaseOperation({ operation: 'TheStatsAPI semifinal shadow verification' }, main)
  .catch(exitOnDatabaseError);
