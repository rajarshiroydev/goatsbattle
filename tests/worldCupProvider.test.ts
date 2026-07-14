import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  mapWorldCupCommunityGame,
  validateWorldCupCommunityPayload,
} from '../src/lib/worldCupProvider';
import { worldCup2026Fixtures } from '../src/data/worldCup2026';
import {
  assertSafeStatusTransition,
  fixturesInScoreWindow,
  isDailyMetadataWindow,
} from '../src/lib/worldCupSync';

const fixture = async (name: string) => JSON.parse(
  await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
);

const rawStage = (id: number) => {
  if (id <= 72) return 'group';
  if (id <= 88) return 'r32';
  if (id <= 96) return 'r16';
  if (id <= 100) return 'qf';
  if (id <= 102) return 'sf';
  return id === 103 ? 'third' : 'final';
};

const rawGame = (id: number) => ({
  id: String(id),
  type: rawStage(id),
  home_team_id: id >= 103 ? '0' : '1',
  away_team_id: id >= 103 ? '0' : '2',
  home_team_name_en: id >= 103 ? undefined : 'Home',
  away_team_name_en: id >= 103 ? undefined : 'Away',
  home_score: '0',
  away_score: '0',
  finished: 'FALSE',
  time_elapsed: 'notstarted',
});

test('maps completed score/status while ignoring non-canonical kickoff data', async () => {
  const mapped = mapWorldCupCommunityGame(await fixture('worldcup26-completed'));
  assert.deepEqual(mapped, {
    provider: 'worldcup26-community',
    providerFixtureId: 'worldcup26-community:98',
    matchNumber: 98,
    stage: 'quarterfinal',
    status: 'finished',
    homeTeamId: '29',
    awayTeamId: '25',
    homeTeam: 'Spain',
    awayTeam: 'Belgium',
    homeScore: 2,
    awayScore: 1,
  });
  assert.equal('kickoff' in mapped, false);
});

test('maps scheduled fixtures without treating placeholder zero scores as results', async () => {
  const mapped = mapWorldCupCommunityGame(await fixture('worldcup26-scheduled'));
  assert.equal(mapped.status, 'scheduled');
  assert.equal(mapped.homeScore, null);
  assert.equal(mapped.awayScore, null);
});

test('maps any non-empty in-progress elapsed value as live', async () => {
  const mapped = mapWorldCupCommunityGame(await fixture('worldcup26-live'));
  assert.equal(mapped.status, 'live');
  assert.equal(mapped.homeScore, 1);
  assert.equal(mapped.awayScore, 0);
});

test('accepts the observed inconsistent Finished casing', () => {
  const mapped = mapWorldCupCommunityGame({
    ...rawGame(21),
    finished: 'TRUE',
    time_elapsed: 'Finished',
  });
  assert.equal(mapped.status, 'finished');
});

test('validates all 104 stable match numbers and stage counts', () => {
  const games = validateWorldCupCommunityPayload({
    games: Array.from({ length: 104 }, (_, index) => rawGame(index + 1)),
  });
  assert.equal(games.length, 104);
  assert.equal(games[0].matchNumber, 1);
  assert.equal(games[103].matchNumber, 104);
});

test('rejects duplicate IDs even when the response contains 104 rows', () => {
  const games = Array.from({ length: 104 }, (_, index) => rawGame(index + 1));
  games[103] = rawGame(103);
  assert.throws(
    () => validateWorldCupCommunityPayload({ games }),
    /each integer from 1 through 104 exactly once/,
  );
});

test('rejects a provider stage that disagrees with the canonical match number', () => {
  assert.throws(
    () => mapWorldCupCommunityGame({ ...rawGame(101), type: 'final' }),
    /stage mismatch/,
  );
});

test('canonical schedule contains 104 stable fixtures and FIFA semifinal kickoff', () => {
  assert.equal(worldCup2026Fixtures.length, 104);
  assert.equal(new Set(worldCup2026Fixtures.map((game) => game.id)).size, 104);
  assert.equal(new Set(worldCup2026Fixtures.map((game) => game.providerFixtureId)).size, 104);
  assert.equal(worldCup2026Fixtures.filter((game) => game.stage === 'group').length, 72);
  assert.equal(worldCup2026Fixtures.filter((game) => game.stage === 'semifinal').length, 2);
  assert.equal(worldCup2026Fixtures.find((game) => game.matchNumber === 101)?.kickoff,
    '2026-07-14T19:00:00.000Z');
});

test('score polling is limited to one hour before through four hours after kickoff', () => {
  assert.deepEqual(fixturesInScoreWindow(new Date('2026-07-14T17:59:59Z')), []);
  assert.deepEqual(
    fixturesInScoreWindow(new Date('2026-07-14T18:00:00Z')).map((game) => game.matchNumber),
    [101],
  );
  assert.deepEqual(
    fixturesInScoreWindow(new Date('2026-07-14T23:00:00Z')).map((game) => game.matchNumber),
    [101],
  );
  assert.deepEqual(fixturesInScoreWindow(new Date('2026-07-14T23:00:01Z')), []);
});

test('daily metadata refresh has a single two-minute UTC window', () => {
  assert.equal(isDailyMetadataWindow(new Date('2026-07-13T00:01:59Z')), true);
  assert.equal(isDailyMetadataWindow(new Date('2026-07-13T00:02:00Z')), false);
});

test('status transitions reject regressions and accept forward progress', () => {
  assert.doesNotThrow(() => assertSafeStatusTransition('scheduled', 'live'));
  assert.doesNotThrow(() => assertSafeStatusTransition('live', 'finished'));
  assert.throws(() => assertSafeStatusTransition('live', 'scheduled'), /status regression/);
  assert.throws(() => assertSafeStatusTransition('finished', 'live'), /status regression/);
});
