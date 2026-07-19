import assert from 'node:assert/strict';
import test from 'node:test';
import {
  StatsApiHttpError,
  fetchStatsApiLineup,
  fetchStatsApiMatch,
  fetchStatsApiTimeline,
  fetchStatsApiWorldCupMatches,
  type StatsApiClientOptions,
} from '../../src/lib/theStatsApiClient';
import {
  SIMULATED_API_KEY,
  SIMULATED_MATCH_ID,
  TheStatsApiSimulator,
  statsApiSimulatorPaths,
} from '../support/theStatsApiSimulator';

function options(simulator: TheStatsApiSimulator, overrides: Partial<StatsApiClientOptions> = {}) {
  return {
    apiKey: SIMULATED_API_KEY,
    fetcher: simulator.fetch,
    ...overrides,
  } satisfies StatsApiClientOptions;
}

test('fetches and validates both World Cup pages through the provider contract', async () => {
  const simulator = new TheStatsApiSimulator();
  const reserved: string[] = [];
  const matches = await fetchStatsApiWorldCupMatches(options(simulator, {
    reserveRequest: async (path) => { reserved.push(path); },
  }));

  assert.equal(matches.length, 104);
  assert.equal(new Set(matches.map((match) => match.id)).size, 104);
  assert.deepEqual(simulator.requests.map((request) => new URLSearchParams(request.search).get('page')), ['1', '2']);
  assert.deepEqual(reserved, [
    '/football/matches?competition_id=comp_6107&season_id=sn_118868&per_page=100&page=1',
    '/football/matches?competition_id=comp_6107&season_id=sn_118868&per_page=100&page=2',
  ]);
  assert.ok(simulator.requests.every((request) => request.authorization === `Bearer ${SIMULATED_API_KEY}`));
  assert.ok(simulator.requests.every((request) => request.accept === 'application/json'));
  assert.ok(simulator.requests.every((request) => request.userAgent === 'GOATSBattle/1.0'));
});

test('uses the exact match, live timeline, final timeline, and lineup endpoints', async () => {
  const simulator = new TheStatsApiSimulator();
  simulator.setStage('lineup-official');
  assert.equal((await fetchStatsApiMatch(SIMULATED_MATCH_ID, options(simulator))).id, SIMULATED_MATCH_ID);
  assert.equal((await fetchStatsApiLineup(SIMULATED_MATCH_ID, options(simulator))).home.startingXi.length, 11);
  simulator.setStage('live-goal');
  assert.equal((await fetchStatsApiTimeline(SIMULATED_MATCH_ID, true, options(simulator))).events.length, 2);
  simulator.setStage('finished-final');
  assert.equal((await fetchStatsApiTimeline(SIMULATED_MATCH_ID, false, options(simulator))).coverage, 'full');
  assert.deepEqual(simulator.requests.map((request) => request.pathname), [
    statsApiSimulatorPaths.match,
    statsApiSimulatorPaths.lineup,
    statsApiSimulatorPaths.liveTimeline,
    statsApiSimulatorPaths.finalTimeline,
  ]);
});

test('preserves an expected pre-release lineup 404 as a typed provider error', async () => {
  const simulator = new TheStatsApiSimulator();
  await assert.rejects(
    fetchStatsApiLineup(SIMULATED_MATCH_ID, options(simulator)),
    (error: unknown) => error instanceof StatsApiHttpError
      && error.status === 404
      && error.path.endsWith('/lineups'),
  );
});

test('rejects absent credentials before reserving quota or making a request', async () => {
  const simulator = new TheStatsApiSimulator();
  let reserved = false;
  await assert.rejects(
    fetchStatsApiMatch(SIMULATED_MATCH_ID, options(simulator, {
      apiKey: '',
      reserveRequest: async () => { reserved = true; },
    })),
    /THESTATSAPI_API_KEY is not configured/,
  );
  assert.equal(reserved, false);
  assert.equal(simulator.requests.length, 0);
});

test('surfaces a rejected bearer credential as a typed 401 response', async () => {
  const simulator = new TheStatsApiSimulator();
  await assert.rejects(
    fetchStatsApiMatch(SIMULATED_MATCH_ID, options(simulator, { apiKey: 'wrong-key' })),
    (error: unknown) => error instanceof StatsApiHttpError && error.status === 401,
  );
});

test('does not call the provider when shared quota reservation fails', async () => {
  const simulator = new TheStatsApiSimulator();
  await assert.rejects(
    fetchStatsApiMatch(SIMULATED_MATCH_ID, options(simulator, {
      reserveRequest: async () => { throw new Error('quota refused'); },
    })),
    /quota refused/,
  );
  assert.equal(simulator.requests.length, 0);
});

test('surfaces rate limits with bounded provider error details', async () => {
  const simulator = new TheStatsApiSimulator();
  simulator.queueFault(statsApiSimulatorPaths.match, {
    kind: 'http', status: 429, payload: { error: 'trial quota exhausted' },
  });
  await assert.rejects(
    fetchStatsApiMatch(SIMULATED_MATCH_ID, options(simulator)),
    (error: unknown) => error instanceof StatsApiHttpError
      && error.status === 429
      && error.message.includes('trial quota exhausted'),
  );
});

test('rejects malformed and oversized successful provider responses', async () => {
  const simulator = new TheStatsApiSimulator();
  simulator.queueFault(statsApiSimulatorPaths.match, { kind: 'invalid-json' });
  await assert.rejects(fetchStatsApiMatch(SIMULATED_MATCH_ID, options(simulator)), SyntaxError);

  simulator.queueFault(statsApiSimulatorPaths.match, { kind: 'oversize' });
  await assert.rejects(
    fetchStatsApiMatch(SIMULATED_MATCH_ID, options(simulator)),
    /response exceeds 2097152 bytes/,
  );
});

test('aborts a stalled provider request at the configured deadline', async () => {
  const simulator = new TheStatsApiSimulator();
  simulator.queueFault(statsApiSimulatorPaths.match, { kind: 'hang' });
  await assert.rejects(
    fetchStatsApiMatch(SIMULATED_MATCH_ID, options(simulator, { requestTimeoutMs: 10 })),
    (error: unknown) => error instanceof Error && error.name === 'TimeoutError',
  );
});
