import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { fetchStatsApiMatch, fetchStatsApiTimeline } from '../../src/lib/theStatsApiClient';
import {
  runStatsApiScheduledRefresh,
  type StatsApiScheduleDependencies,
  type StatsApiScheduleEnv,
} from '../../src/lib/theStatsApiSchedule';
import type { StatsApiCoordinatorMatch, StatsApiSyncResult } from '../../src/lib/theStatsApiSync';
import {
  SIMULATED_API_KEY,
  SIMULATED_MATCH_ID,
  TheStatsApiSimulator,
} from '../support/theStatsApiSimulator';

const scheduledTime = Date.parse('2026-07-14T19:15:00.000Z');
const emptyResult = (failures = 0): StatsApiSyncResult => ({
  outcome: 'updated',
  matches: 1,
  scores: 1,
  lineupsAccepted: 0,
  lineupsRejected: 0,
  snapshots: 1,
  provisional: 1,
  finalized: 0,
  failures,
});

function candidate(
  matchId: string,
  status: StatsApiCoordinatorMatch['status'] = 'live',
  needsRepair = false,
): StatsApiCoordinatorMatch {
  return {
    matchId,
    provider: 'thestatsapi',
    providerMatchId: `${SIMULATED_MATCH_ID}-${matchId}`,
    kickoff: new Date(scheduledTime - 15 * 60_000).toISOString(),
    status,
    featured: matchId === 'healthy-live',
    needsRepair,
  };
}

function envWith(starts: Record<string, { active: boolean; healthy: boolean } | Error>): StatsApiScheduleEnv {
  return {
    DATABASE_URL: 'postgresql://simulated.invalid/goatsbattle',
    THESTATSAPI_API_KEY: SIMULATED_API_KEY,
    LIVE_MATCH_COORDINATOR: {
      getByName(matchId) {
        return {
          async start() {
            const result = starts[matchId];
            if (result instanceof Error) throw result;
            return result ?? { active: false, healthy: false };
          },
        };
      },
    },
  };
}

test('uses the fallback only when the primary provider key is absent', async () => {
  mock.method(console, 'warn', () => undefined);
  try {
    let fallbackCalls = 0;
    const dependencies: StatsApiScheduleDependencies = {
      listCoordinatorMatches: async () => { throw new Error('should not list candidates'); },
      refreshStatsApi: async () => { throw new Error('should not refresh TheStatsAPI'); },
      refreshFallback: async ({ databaseUrl, now }) => {
        fallbackCalls += 1;
        assert.equal(databaseUrl, 'postgresql://simulated.invalid/goatsbattle');
        assert.equal(now.toISOString(), new Date(scheduledTime).toISOString());
        return { outcome: 'skipped', checked: 0, updated: 0 };
      },
    };
    const env = envWith({});
    env.THESTATSAPI_API_KEY = '';
    await runStatsApiScheduledRefresh(scheduledTime, env, dependencies);
    assert.equal(fallbackCalls, 1);
  } finally {
    mock.restoreAll();
  }
});

test('routes healthy coordinator owners away from generic refresh while exercising the fake provider', async () => {
  mock.method(console, 'log', () => undefined);
  mock.method(console, 'error', () => undefined);
  try {
    const simulator = new TheStatsApiSimulator();
    simulator.setStage('live-goal');
    const candidates = [
      candidate('healthy-live'),
      candidate('unhealthy-live'),
      candidate('finished-owner', 'finished'),
      candidate('repair-needed', 'finished', true),
      candidate('start-error'),
    ];
    let excluded: readonly string[] = [];
    let fallbackCalls = 0;
    const dependencies: StatsApiScheduleDependencies = {
      listCoordinatorMatches: async () => candidates,
      refreshStatsApi: async (options) => {
        excluded = options.excludeMatchIds;
        const client = { apiKey: options.apiKey, fetcher: simulator.fetch };
        const match = await fetchStatsApiMatch(SIMULATED_MATCH_ID, client);
        const timeline = await fetchStatsApiTimeline(SIMULATED_MATCH_ID, true, client);
        assert.equal(match.status, 'live');
        assert.equal(timeline.events.some((event) => event.type === 'goal'), true);
        return emptyResult();
      },
      refreshFallback: async () => {
        fallbackCalls += 1;
        return { outcome: 'updated', checked: 104, updated: 1 };
      },
    };
    await runStatsApiScheduledRefresh(scheduledTime, envWith({
      'healthy-live': { active: true, healthy: true },
      'unhealthy-live': { active: true, healthy: false },
      'finished-owner': { active: true, healthy: false },
      'start-error': new Error('coordinator unavailable'),
    }), dependencies);

    assert.deepEqual(excluded, ['healthy-live', 'finished-owner']);
    assert.equal(fallbackCalls, 0);
    assert.deepEqual(simulator.requests.map((request) => request.pathname), [
      `/api/football/matches/${SIMULATED_MATCH_ID}`,
      `/api/football/matches/${SIMULATED_MATCH_ID}/live-timeline`,
    ]);
  } finally {
    mock.restoreAll();
  }
});

test('runs the community fallback after any primary refresh failure', async () => {
  mock.method(console, 'log', () => undefined);
  mock.method(console, 'warn', () => undefined);
  try {
    let fallbackCalls = 0;
    await runStatsApiScheduledRefresh(scheduledTime, envWith({}), {
      listCoordinatorMatches: async () => [],
      refreshStatsApi: async () => emptyResult(1),
      refreshFallback: async () => {
        fallbackCalls += 1;
        return { outcome: 'updated', checked: 104, updated: 1 };
      },
    });
    assert.equal(fallbackCalls, 1);
  } finally {
    mock.restoreAll();
  }
});

test('preserves the last database state when primary and fallback providers both fail', async () => {
  const errors: string[] = [];
  mock.method(console, 'error', (message: unknown) => { errors.push(String(message)); });
  try {
    await runStatsApiScheduledRefresh(scheduledTime, envWith({}), {
      listCoordinatorMatches: async () => { throw new Error('primary unavailable'); },
      refreshStatsApi: async () => { throw new Error('not reached'); },
      refreshFallback: async () => { throw new Error('fallback unavailable'); },
    });
    assert.equal(errors.some((message) => message.includes('thestatsapi_world_cup_refresh_failed')), true);
    assert.equal(errors.some((message) => message.includes('world_cup_all_providers_failed')), true);
  } finally {
    mock.restoreAll();
  }
});
