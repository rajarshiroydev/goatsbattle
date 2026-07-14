import assert from 'node:assert/strict';
import test from 'node:test';
import { worldCup2026Fixtures } from '../src/data/worldCup2026';
import {
  displayScore,
  displayProviderTeamName,
  evaluateLineupQuality,
  mapStatsApiWorldCupMatches,
  validateStatsApiLineup,
  validateStatsApiMatchesPage,
  validateStatsApiTimeline,
  type StatsApiMatch,
} from '../src/lib/theStatsApi';

const rawMatch = (index: number) => {
  const fixture = worldCup2026Fixtures[index];
  const placeholder = (name: string) => name
    .replace(/^Winner Match (\d+)$/, 'W$1')
    .replace(/^Loser Match (\d+)$/, 'L$1');
  return {
    id: `mt_${String(index + 1).padStart(9, '0')}`,
    competition_id: 'comp_6107',
    season_id: 'sn_118868',
    status: fixture.status,
    utc_date: new Date(new Date(fixture.kickoff).getTime() - (index >= 100 ? 60 * 60_000 : 0)).toISOString(),
    stage_name: fixture.stage === 'group' ? null : fixture.stage.replaceAll('-', '_'),
    home_team: { id: `tm_home_${index}`, name: placeholder(fixture.homeTeam) },
    away_team: { id: `tm_away_${index}`, name: placeholder(fixture.awayTeam) },
    score: {
      home: fixture.homeScore,
      away: fixture.awayScore,
      final_score: null,
      regulation: fixture.homeScore === null ? null : { home: fixture.homeScore, away: fixture.awayScore },
      after_extra_time: null,
      penalty_shootout: null,
      went_to_extra_time: false,
      went_to_penalties: false,
      winner: null,
    },
  };
};

test('validates and maps all 104 provider fixtures to canonical match routes', () => {
  const raw = Array.from({ length: 104 }, (_, index) => rawMatch(index));
  const page = validateStatsApiMatchesPage({
    data: raw,
    meta: { page: 1, total: 104, total_pages: 1 },
  });
  const mapped = mapStatsApiWorldCupMatches(page.matches, worldCup2026Fixtures);
  assert.equal(mapped.length, 104);
  assert.equal(mapped[100].fixture.id, 'world-cup-2026-match-101');
  assert.equal(mapped[103].provider.homeTeam.name, 'W101');
});

test('rejects a provider match that cannot map by both teams', () => {
  const matches = Array.from({ length: 104 }, (_, index) => rawMatch(index))
    .map((value) => validateStatsApiMatchesPage({
      data: [value], meta: { page: 1, total: 1, total_pages: 1 },
    }).matches[0]);
  matches[100] = {
    ...matches[100],
    homeTeam: { ...matches[100].homeTeam, name: 'Invented Team' },
  };
  assert.throws(
    () => mapStatsApiWorldCupMatches(matches, worldCup2026Fixtures),
    /Could not uniquely map/,
  );
});

test('validates stoppage time, extra-time, shootout and nullable entities', () => {
  const timeline = validateStatsApiTimeline({
    data: {
      match_id: 'mt_shootout',
      coverage: 'full',
      events: [
        { sequence: 1, minute: 1, extra_time: 0, period: 'first_half', type: 'period_start', team: null, player: null },
        { sequence: 2, minute: 45, extra_time: 3, period: 'first_half', type: 'yellow_card', team: { id: 'tm_1', name: 'Home', slug: 'home' }, player: { id: 'pl_1', name: 'Player', slug: 'player' } },
        { sequence: 3, minute: 120, extra_time: 1, period: 'penalties', type: 'penalty_scored', team: { id: 'tm_1', name: 'Home' }, player: { id: 'pl_1', name: 'Player' } },
      ],
    },
    meta: { coverage: 'full', total: 3, last_updated: '2026-07-07T22:51:00.716Z' },
  }, 'mt_shootout');
  assert.equal(timeline.events[1].extraTime, 3);
  assert.equal(timeline.events[2].period, 'penalties');
});

test('rejects non-monotonic timeline sequences', () => {
  assert.throws(() => validateStatsApiTimeline({
    data: {
      match_id: 'mt_1', coverage: 'full', events: [
        { sequence: 2, minute: 1, extra_time: 0, period: 'first_half', type: 'foul', team: null, player: null },
        { sequence: 1, minute: 2, extra_time: 0, period: 'first_half', type: 'foul', team: null, player: null },
      ],
    },
    meta: { coverage: 'full' },
  }, 'mt_1'), /strictly increasing/);
});

const lineupPayload = (substituteCount: number) => ({
  data: {
    match_id: 'mt_836288430',
    confirmed: true,
    home: {
      id: 'tm_france', name: 'France', formation: '4-2-3-1',
      starting_xi: Array.from({ length: 11 }, (_, i) => ({ id: `fr_start_${i}`, name: `France ${i}`, position: 'M', jersey_number: i + 1 })),
      substitutes: Array.from({ length: substituteCount }, (_, i) => ({ id: `fr_sub_${i}`, name: `France sub ${i}`, position: 'M', jersey_number: i + 12 })),
    },
    away: {
      id: 'tm_spain', name: 'Spain', formation: '4-3-3',
      starting_xi: Array.from({ length: 11 }, (_, i) => ({ id: `es_start_${i}`, name: `Spain ${i}`, position: 'M', jersey_number: i + 1 })),
      substitutes: Array.from({ length: substituteCount }, (_, i) => ({ id: `es_sub_${i}`, name: `Spain sub ${i}`, position: 'M', jersey_number: i + 12 })),
    },
  },
});

test('rejects the observed premature provider-confirmed lineup', () => {
  const lineup = validateStatsApiLineup(lineupPayload(0), 'mt_836288430');
  assert.deepEqual(evaluateLineupQuality({
    lineup,
    kickoff: new Date('2026-07-14T19:00:00Z'),
    now: new Date('2026-07-13T16:45:00Z'),
    matchStatus: 'scheduled',
  }), { accepted: false, reason: 'too-early' });
});

test('requires full starters and a non-empty bench inside the official window', () => {
  const kickoff = new Date('2026-07-14T19:00:00Z');
  const incomplete = validateStatsApiLineup(lineupPayload(0), 'mt_836288430');
  assert.deepEqual(evaluateLineupQuality({
    lineup: incomplete, kickoff, now: new Date('2026-07-14T17:30:00Z'), matchStatus: 'scheduled',
  }), { accepted: false, reason: 'missing-bench' });
  const complete = validateStatsApiLineup(lineupPayload(15), 'mt_836288430');
  assert.deepEqual(evaluateLineupQuality({
    lineup: complete, kickoff, now: new Date('2026-07-14T17:45:00Z'), matchStatus: 'scheduled',
  }), { accepted: true, reason: 'official-window-complete' });
});

test('separates the displayed match score from shootout kicks', () => {
  const score: StatsApiMatch['score'] = {
    home: 0, away: 0,
    finalScore: { home: 4, away: 3 },
    regulation: { home: 0, away: 0 },
    afterExtraTime: { home: 0, away: 0 },
    penaltyShootout: { home: 4, away: 3 },
    wentToExtraTime: true,
    wentToPenalties: true,
    winner: 'home',
  };
  assert.deepEqual(displayScore(score), {
    home: 0, away: 0, penaltiesHome: 4, penaltiesAway: 3,
  });
});

test('keeps readable canonical placeholders until a real team is known', () => {
  assert.equal(displayProviderTeamName('W101', 'Winner Match 101'), 'Winner Match 101');
  assert.equal(displayProviderTeamName('L102', 'Loser Match 102'), 'Loser Match 102');
  assert.equal(displayProviderTeamName('Argentina', 'Winner Match 102'), 'Argentina');
});
