import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveLiveMatchClock } from '../../src/lib/liveMatchClock';
import { deriveLiveScore } from '../../src/lib/liveScore';
import {
  evaluateLineupQuality,
  hashNormalizedValue,
  type StatsApiTimeline,
} from '../../src/lib/theStatsApi';
import {
  StatsApiHttpError,
  fetchStatsApiLineup,
  fetchStatsApiMatch,
  fetchStatsApiTimeline,
} from '../../src/lib/theStatsApiClient';
import { normalizeStatsApiMoment } from '../../src/lib/theStatsApiSync';
import {
  SIMULATED_API_KEY,
  SIMULATED_AWAY_TEAM_ID,
  SIMULATED_HOME_TEAM_ID,
  SIMULATED_KICKOFF,
  SIMULATED_MATCH_ID,
  TheStatsApiSimulator,
} from '../support/theStatsApiSimulator';

const options = (simulator: TheStatsApiSimulator) => ({
  apiKey: SIMULATED_API_KEY,
  fetcher: simulator.fetch,
});

function moments(timeline: StatsApiTimeline) {
  return timeline.events
    .map((event) => normalizeStatsApiMoment(
      event,
      SIMULATED_MATCH_ID,
      SIMULATED_HOME_TEAM_ID,
      SIMULATED_AWAY_TEAM_ID,
    ))
    .filter((moment) => moment !== null);
}

function goalScore(timeline: StatsApiTimeline) {
  const activeGoals = moments(timeline).filter((moment) => moment.type === 'goal' || moment.type === 'penalty');
  return {
    home: activeGoals.filter((moment) => moment.team === 'home').length,
    away: activeGoals.filter((moment) => moment.team === 'away').length,
  };
}

test('simulates the scheduled lineup lifecycle without accepting premature data', async () => {
  const simulator = new TheStatsApiSimulator();
  const scheduled = await fetchStatsApiMatch(SIMULATED_MATCH_ID, options(simulator));
  assert.equal(scheduled.status, 'scheduled');
  assert.equal(scheduled.score.home, null);
  await assert.rejects(
    fetchStatsApiLineup(SIMULATED_MATCH_ID, options(simulator)),
    (error: unknown) => error instanceof StatsApiHttpError && error.status === 404,
  );

  simulator.setStage('lineup-incomplete');
  const incomplete = await fetchStatsApiLineup(SIMULATED_MATCH_ID, options(simulator));
  assert.deepEqual(evaluateLineupQuality({
    lineup: incomplete,
    kickoff: new Date(SIMULATED_KICKOFF),
    now: new Date('2026-07-14T17:30:00.000Z'),
    matchStatus: 'scheduled',
  }), { accepted: false, reason: 'missing-bench' });

  simulator.setStage('lineup-official');
  const official = await fetchStatsApiLineup(SIMULATED_MATCH_ID, options(simulator));
  assert.deepEqual(evaluateLineupQuality({
    lineup: official,
    kickoff: new Date(SIMULATED_KICKOFF),
    now: new Date('2026-07-14T17:45:00.000Z'),
    matchStatus: 'scheduled',
  }), { accepted: true, reason: 'official-window-complete' });
});

test('rejects every structurally unsafe lineup variant from the simulator', async () => {
  const simulator = new TheStatsApiSimulator();
  const expected = [
    ['lineup-unconfirmed', 'provider-unconfirmed'],
    ['lineup-incomplete-xi', 'incomplete-starting-xi'],
    ['lineup-incomplete', 'missing-bench'],
    ['lineup-duplicate', 'duplicate-player'],
  ] as const;
  for (const [stage, reason] of expected) {
    simulator.setStage(stage);
    const lineup = await fetchStatsApiLineup(SIMULATED_MATCH_ID, options(simulator));
    assert.deepEqual(evaluateLineupQuality({
      lineup,
      kickoff: new Date(SIMULATED_KICKOFF),
      now: new Date('2026-07-14T17:45:00.000Z'),
      matchStatus: 'scheduled',
    }), { accepted: false, reason });
  }
});

test('simulates an empty live feed, score-leading goal, and VAR retraction', async () => {
  const simulator = new TheStatsApiSimulator();
  const observedAt = new Date('2026-07-14T19:03:00.000Z');

  simulator.setStage('live-empty');
  const empty = await fetchStatsApiTimeline(SIMULATED_MATCH_ID, true, options(simulator));
  assert.equal(empty.coverage, 'none');
  assert.deepEqual(deriveLiveMatchClock({ status: 'live', latestEvent: null, observedAt }), {
    phase: 'first_half',
    elapsedSeconds: 0,
    observedAt: observedAt.toISOString(),
    running: true,
    approximate: true,
  });

  simulator.setStage('live-goal');
  const laggingMatch = await fetchStatsApiMatch(SIMULATED_MATCH_ID, options(simulator));
  const goalTimeline = await fetchStatsApiTimeline(SIMULATED_MATCH_ID, true, options(simulator));
  const score = goalScore(goalTimeline);
  assert.deepEqual(deriveLiveScore({
    status: laggingMatch.status,
    timelineCoverage: goalTimeline.coverage,
    providerHomeScore: laggingMatch.score.home,
    providerAwayScore: laggingMatch.score.away,
    timelineHomeGoals: score.home,
    timelineAwayGoals: score.away,
  }), { homeScore: 0, awayScore: 1, provisional: true });
  assert.equal(deriveLiveMatchClock({
    status: 'live',
    latestEvent: goalTimeline.events.at(-1),
    observedAt,
  })?.elapsedSeconds, 12 * 60);

  const provisionalIds = new Set(moments(goalTimeline).map((moment) => moment.providerEventId));
  simulator.setStage('live-var-correction');
  const correctedTimeline = await fetchStatsApiTimeline(SIMULATED_MATCH_ID, true, options(simulator));
  const correctedMoments = moments(correctedTimeline);
  const correctedIds = new Set(correctedMoments.map((moment) => moment.providerEventId));
  assert.deepEqual([...provisionalIds].filter((id) => !correctedIds.has(id)), [
    `${SIMULATED_MATCH_ID}:first_half:2`,
  ]);
  assert.deepEqual(correctedMoments.map((moment) => moment.type), ['var']);
  assert.equal(correctedMoments[0].detail, 'VAR review; provider outcome unavailable.');
});

test('simulates partial finalization followed by a full result and late correction', async () => {
  const simulator = new TheStatsApiSimulator();
  simulator.setStage('finished-partial');
  const partial = await fetchStatsApiTimeline(SIMULATED_MATCH_ID, false, options(simulator));
  assert.equal(partial.coverage, 'partial');

  simulator.setStage('finished-final');
  const finalMatch = await fetchStatsApiMatch(SIMULATED_MATCH_ID, options(simulator));
  const finalTimeline = await fetchStatsApiTimeline(SIMULATED_MATCH_ID, false, options(simulator));
  assert.equal(finalTimeline.coverage, 'full');
  assert.deepEqual(goalScore(finalTimeline), { home: 1, away: 1 });
  assert.deepEqual([finalMatch.score.home, finalMatch.score.away], [1, 1]);
  const finalMoments = moments(finalTimeline);
  assert.deepEqual(finalMoments.map((moment) => moment.type), [
    'goal', 'yellow_card', 'sub', 'penalty_awarded', 'penalty_missed', 'goal', 'var',
  ]);
  assert.equal(finalMoments.find((moment) => moment.type === 'sub')?.detail,
    'Substitution recorded; provider supplies one player only.');
  assert.equal(finalMoments.find((moment) => moment.type === 'penalty_missed')?.detail, 'Penalty saved');

  simulator.setStage('finished-late-correction');
  const correctedMatch = await fetchStatsApiMatch(SIMULATED_MATCH_ID, options(simulator));
  const correctedTimeline = await fetchStatsApiTimeline(SIMULATED_MATCH_ID, false, options(simulator));
  assert.deepEqual(goalScore(correctedTimeline), { home: 0, away: 1 });
  assert.deepEqual([correctedMatch.score.home, correctedMatch.score.away], [0, 1]);
  const removedIds = new Set(moments(finalTimeline).map((moment) => moment.providerEventId));
  for (const moment of moments(correctedTimeline)) removedIds.delete(moment.providerEventId);
  assert.deepEqual([...removedIds], [`${SIMULATED_MATCH_ID}:first_half:7`]);
  assert.notEqual(await hashNormalizedValue(finalTimeline.events), await hashNormalizedValue(correctedTimeline.events));
  assert.equal(deriveLiveMatchClock({
    status: 'finished',
    latestEvent: correctedTimeline.events.at(-1),
    observedAt: new Date('2026-07-14T21:15:00.000Z'),
  })?.phase, 'full_time');
});
