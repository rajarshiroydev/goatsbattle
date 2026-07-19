import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyWorldCupFallbackSnapshot,
  resolveWorldCupKnockoutTeams,
  type WorldCupKnockoutMatch,
} from '../src/lib/worldCupBracket';

const match = (values: Partial<WorldCupKnockoutMatch> & Pick<WorldCupKnockoutMatch, 'id'>): WorldCupKnockoutMatch => ({
  status: 'scheduled',
  homeTeam: 'Home',
  awayTeam: 'Away',
  homeCode: null,
  awayCode: null,
  homeScore: null,
  awayScore: null,
  ...values,
});

test('derives bronze and final participants from finished semi-finals', () => {
  const resolved = resolveWorldCupKnockoutTeams([
    match({
      id: 'world-cup-2026-match-101', status: 'finished',
      homeTeam: 'France', awayTeam: 'Spain', homeCode: 'FR', awayCode: 'ES',
      homeScore: 0, awayScore: 2,
    }),
    match({
      id: 'world-cup-2026-match-102', status: 'finished',
      homeTeam: 'England', awayTeam: 'Argentina', homeCode: 'GB', awayCode: 'AR',
      homeScore: 1, awayScore: 2,
    }),
    match({ id: 'world-cup-2026-match-103', homeTeam: 'Loser Match 101', awayTeam: 'Loser Match 102' }),
    match({ id: 'world-cup-2026-match-104', homeTeam: 'Winner Match 101', awayTeam: 'Winner Match 102' }),
  ]);

  assert.deepEqual(
    resolved.slice(2).map(({ homeTeam, awayTeam, homeCode, awayCode }) => ({ homeTeam, awayTeam, homeCode, awayCode })),
    [
      { homeTeam: 'France', awayTeam: 'England', homeCode: 'FR', awayCode: 'GB' },
      { homeTeam: 'Spain', awayTeam: 'Argentina', homeCode: 'ES', awayCode: 'AR' },
    ],
  );
});

test('uses shootout scores and preserves placeholders until an outcome is known', () => {
  const fixtures = [
    match({
      id: 'world-cup-2026-match-101', status: 'finished',
      homeTeam: 'France', awayTeam: 'Spain', homeScore: 1, awayScore: 1,
      homePenaltyScore: 3, awayPenaltyScore: 4,
    }),
    match({
      id: 'world-cup-2026-match-102', status: 'live',
      homeTeam: 'England', awayTeam: 'Argentina', homeScore: 1, awayScore: 0,
    }),
    match({ id: 'world-cup-2026-match-104', homeTeam: 'Winner Match 101', awayTeam: 'Winner Match 102' }),
  ];
  const final = resolveWorldCupKnockoutTeams(fixtures)[2];
  assert.equal(final.homeTeam, 'Spain');
  assert.equal(final.awayTeam, 'Winner Match 102');
});

test('prevents an older provider row from regressing the validated fallback', () => {
  const database = [{
    ...match({
      id: 'world-cup-2026-match-103', status: 'finished',
      homeTeam: 'France', awayTeam: 'England', homeScore: 0, awayScore: 0,
    }),
    lastSyncedAt: new Date('2026-07-18T23:02:03.271Z'),
  }];
  const fallback = [match({
    id: 'world-cup-2026-match-103', status: 'finished',
    homeTeam: 'France', awayTeam: 'England', homeScore: 4, awayScore: 6,
  })];
  const [resolved] = applyWorldCupFallbackSnapshot(
    database,
    fallback,
    '2026-07-19T05:23:42.000Z',
  );
  assert.equal(resolved.homeScore, 4);
  assert.equal(resolved.awayScore, 6);

  const [newer] = applyWorldCupFallbackSnapshot(
    [{ ...database[0], homeScore: 5, awayScore: 6, lastSyncedAt: new Date('2026-07-19T06:00:00Z') }],
    fallback,
    '2026-07-19T05:23:42.000Z',
  );
  assert.equal(newer.homeScore, 5);
});
