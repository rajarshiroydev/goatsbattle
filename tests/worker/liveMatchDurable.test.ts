import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COORDINATOR_HEALTHY_GRACE_MS,
  FINISHED_CORRECTION_WORK,
  correctionDueAt,
  coordinatorRetryDelay,
} from '../../src/durable/LiveMatchCoordinator';
import { LIVE_MATCH_PROTOCOL_VERSION } from '../../src/lib/liveMatchProtocol';
import { evaluateLineupQuality, hashNormalizedValue } from '../../src/lib/theStatsApi';
import {
  fetchStatsApiLineup,
  fetchStatsApiMatch,
  fetchStatsApiTimeline,
} from '../../src/lib/theStatsApiClient';
import type {
  CoordinatedStatsApiResult,
  CoordinatedStatsApiWork,
  StatsApiCoordinatorMatch,
} from '../../src/lib/theStatsApiSync';
import {
  SIMULATED_API_KEY,
  SIMULATED_KICKOFF,
  SIMULATED_MATCH_ID,
  TheStatsApiSimulator,
} from '../support/theStatsApiSimulator';

afterEach(() => vi.restoreAllMocks());

type CoordinatorInternals = {
  alarm(): Promise<void>;
  runWork(
    config: { kickoff: string },
    work: CoordinatedStatsApiWork,
    now: number,
  ): Promise<CoordinatedStatsApiResult | null>;
  broadcastSnapshot(): Promise<void>;
};

function simulatedCoordinatorWork(simulator: TheStatsApiSimulator) {
  let previousHash: string | null = null;
  return async (
    config: { kickoff: string },
    work: CoordinatedStatsApiWork,
    now: number,
  ): Promise<CoordinatedStatsApiResult> => {
    const options = { apiKey: SIMULATED_API_KEY, fetcher: simulator.fetch };
    if (work === 'status') {
      const match = await fetchStatsApiMatch(SIMULATED_MATCH_ID, options);
      const matchStatus = match.status === 'live' || match.status === 'finished'
        ? match.status
        : 'scheduled';
      return { work, matchStatus, changed: true };
    }
    if (work === 'lineup') {
      const match = await fetchStatsApiMatch(SIMULATED_MATCH_ID, options);
      const lineup = await fetchStatsApiLineup(SIMULATED_MATCH_ID, options);
      const quality = evaluateLineupQuality({
        lineup,
        kickoff: new Date(config.kickoff),
        now: new Date(now),
        matchStatus: match.status,
      });
      return {
        work,
        matchStatus: match.status === 'live' || match.status === 'finished' ? match.status : 'scheduled',
        changed: quality.accepted,
        officialLineup: quality.accepted,
      };
    }
    const timeline = await fetchStatsApiTimeline(SIMULATED_MATCH_ID, work === 'timeline', options);
    const snapshotHash = await hashNormalizedValue(timeline.events);
    const changed = snapshotHash !== previousHash;
    previousHash = snapshotHash;
    return {
      work,
      matchStatus: work === 'timeline' ? 'live' : 'finished',
      changed,
      snapshotHash,
      finalized: work === 'final' ? timeline.coverage === 'full' : undefined,
    };
  };
}

describe('StatsApiRequestBroker', () => {
  it('reserves at most seven featured and three other requests per minute', async () => {
    const broker = env.STATS_API_REQUEST_BROKER.getByName('provider-quota');
    const now = Date.UTC(2026, 6, 15, 12, 0, 0);
    for (let index = 0; index < 7; index += 1) expect(await broker.reserve(true, now)).toBe(true);
    expect(await broker.reserve(true, now)).toBe(false);
    for (let index = 0; index < 3; index += 1) expect(await broker.reserve(false, now)).toBe(true);
    expect(await broker.reserve(false, now)).toBe(false);
  });

  it('opens a fresh allocation window after sixty seconds', async () => {
    const broker = env.STATS_API_REQUEST_BROKER.getByName('provider-window');
    const now = Date.UTC(2026, 6, 15, 12, 0, 0);
    for (let index = 0; index < 7; index += 1) await broker.reserve(true, now);
    expect(await broker.reserve(true, now + 60_000)).toBe(true);
  });
});

describe('LiveMatchCoordinator runtime', () => {
  it('schedules its first alarm when the cron watchdog starts it', async () => {
    const coordinator = env.LIVE_MATCH_COORDINATOR.getByName('alarm-match');
    const status = await coordinator.start({
      matchId: 'alarm-match',
      provider: 'thestatsapi',
      providerMatchId: 'provider-1',
      kickoff: new Date(Date.now() + 60 * 60_000).toISOString(),
      status: 'scheduled',
      featured: true,
    });
    expect(status).toEqual({ active: true, healthy: true });
    await runInDurableObject(coordinator, async (_instance, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });

  it('accepts a hibernating WebSocket and broadcasts versioned events', async () => {
    const coordinator = env.LIVE_MATCH_COORDINATOR.getByName('discussion-match');
    const response = await coordinator.fetch(new Request('https://example.com/socket', {
      headers: { upgrade: 'websocket' },
    }));
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    socket!.accept();
    const received = new Promise<string>((resolve) => {
      socket!.addEventListener('message', (event: MessageEvent) => resolve(String(event.data)), { once: true });
    });
    await coordinator.publish({
      version: LIVE_MATCH_PROTOCOL_VERSION,
      type: 'provider.health',
      matchId: 'discussion-match',
      sentAt: new Date().toISOString(),
      payload: { status: 'healthy', failureCount: 0, retryAt: null },
    });
    expect(JSON.parse(await received)).toMatchObject({
      version: 1,
      type: 'provider.health',
      matchId: 'discussion-match',
    });
    socket!.close(1000, 'done');
  });

  it('keeps a coordinator healthy through the status cadence grace window', async () => {
    const coordinator = env.LIVE_MATCH_COORDINATOR.getByName('health-grace-match');
    // Keep the alarm scheduled beyond the test run. A fixed historical time
    // makes Miniflare immediately fire the overdue alarm and mutate this state.
    const now = Date.now() + 60 * 60_000;
    const config = {
      matchId: 'health-grace-match',
      provider: 'thestatsapi' as const,
      providerMatchId: 'provider-health',
      kickoff: new Date(now + 60 * 60_000).toISOString(),
      status: 'scheduled' as const,
      featured: true,
      needsRepair: false,
    };
    await coordinator.start(config, now);
    await runInDurableObject(coordinator, async (_instance, state) => {
      state.storage.sql.exec(
        'UPDATE coordinator_state SET last_success_at = ?, failure_count = 0 WHERE id = 1',
        now - COORDINATOR_HEALTHY_GRACE_MS + 5_000,
      );
    });
    expect((await coordinator.start(config, now)).healthy).toBe(true);
  });

  it('keeps finished coordinators active until every correction slot is consumed', async () => {
    const coordinator = env.LIVE_MATCH_COORDINATOR.getByName('correction-lifecycle-match');
    const config = {
      matchId: 'correction-lifecycle-match',
      provider: 'thestatsapi' as const,
      providerMatchId: 'provider-corrections',
      kickoff: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
      status: 'finished' as const,
      featured: true,
      needsRepair: false,
    };
    expect(await coordinator.start(config)).toEqual({ active: true, healthy: true });
    await runInDurableObject(coordinator, async (_instance, state) => {
      state.storage.sql.exec(
        'UPDATE coordinator_state SET correction_index = 6, failure_count = 0 WHERE id = 1',
      );
    });
    expect(await coordinator.start(config)).toEqual({ active: false, healthy: true });
  });

  it('runs a simulated live match through alarms, retries incomplete finalization, and corrects it', async () => {
    const simulator = new TheStatsApiSimulator();
    const coordinator = env.LIVE_MATCH_COORDINATOR.getByName('simulated-provider-lifecycle');
    let now = Date.now() + 60 * 60_000;
    const config: StatsApiCoordinatorMatch = {
      matchId: 'simulated-provider-lifecycle',
      provider: 'thestatsapi',
      providerMatchId: SIMULATED_MATCH_ID,
      kickoff: SIMULATED_KICKOFF,
      status: 'scheduled',
      featured: true,
      needsRepair: false,
    };
    await coordinator.start(config, now);

    await runInDurableObject(coordinator, async (instance, state) => {
      const internal = instance as unknown as CoordinatorInternals;
      const calls: CoordinatedStatsApiWork[] = [];
      const work = simulatedCoordinatorWork(simulator);
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      vi.spyOn(internal, 'runWork').mockImplementation(async (currentConfig, kind, at) => {
        calls.push(kind);
        return work(currentConfig, kind, at);
      });
      vi.spyOn(internal, 'broadcastSnapshot').mockImplementation(async () => {
        state.storage.sql.exec('UPDATE coordinator_state SET pending_broadcast = 0 WHERE id = 1');
      });

      simulator.setStage('live-goal');
      await internal.alarm();
      expect(calls).toEqual(['status', 'timeline', 'lineup']);
      let coordinatorState = state.storage.sql.exec<{
        last_status: string; official_lineup: number; correction_index: number;
      }>('SELECT last_status, official_lineup, correction_index FROM coordinator_state WHERE id = 1').one();
      expect(coordinatorState).toEqual({ last_status: 'live', official_lineup: 1, correction_index: 0 });

      calls.length = 0;
      now += 60_000;
      simulator.setStage('finished-partial');
      await internal.alarm();
      expect(calls).toEqual(['status', 'status', 'final']);
      let retryState = state.storage.sql.exec<{
        last_status: string; correction_index: number; failure_count: number; next_attempt_at: number;
      }>(
        'SELECT last_status, correction_index, failure_count, next_attempt_at FROM coordinator_state WHERE id = 1',
      ).one();
      expect(retryState.last_status).toBe('finished');
      expect(retryState.correction_index).toBe(0);
      expect(retryState.failure_count).toBe(1);
      expect(retryState.next_attempt_at).toBe(now + 10_000);

      calls.length = 0;
      now = retryState.next_attempt_at + 1;
      simulator.setStage('finished-final');
      await internal.alarm();
      expect(calls).toEqual(['status', 'final']);
      retryState = state.storage.sql.exec(
        'SELECT last_status, correction_index, failure_count, next_attempt_at FROM coordinator_state WHERE id = 1',
      ).one() as typeof retryState;
      expect(retryState).toEqual({
        last_status: 'finished', correction_index: 1, failure_count: 0, next_attempt_at: 0,
      });

      coordinatorState = state.storage.sql.exec(
        'SELECT last_status, official_lineup, correction_index FROM coordinator_state WHERE id = 1',
      ).one() as typeof coordinatorState;
      expect(coordinatorState.correction_index).toBe(1);
      vi.restoreAllMocks();
    });
  });
});

describe('coordinator schedules', () => {
  it('uses 10/20/40/60 second retry backoff', () => {
    expect([1, 2, 3, 4, 5].map(coordinatorRetryDelay)).toEqual([10_000, 20_000, 40_000, 60_000, 60_000]);
  });

  it('schedules immediate, 5m, 15m, 1h, 6h, and 24h corrections', () => {
    const finishedAt = Date.UTC(2026, 6, 15, 12, 0, 0);
    expect([0, 1, 2, 3, 4, 5, 6].map((index) => correctionDueAt(finishedAt, index))).toEqual([
      finishedAt,
      finishedAt + 5 * 60_000,
      finishedAt + 15 * 60_000,
      finishedAt + 60 * 60_000,
      finishedAt + 6 * 60 * 60_000,
      finishedAt + 24 * 60 * 60_000,
      null,
    ]);
  });

  it('rechecks the finished score before finalizing each corrected timeline', () => {
    expect(FINISHED_CORRECTION_WORK).toEqual(['status', 'final']);
  });
});
