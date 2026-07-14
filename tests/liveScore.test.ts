import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveLiveScore } from '../src/lib/liveScore';

test('uses a full live timeline when it leads the match score resource', () => {
  assert.deepEqual(deriveLiveScore({
    status: 'live',
    timelineCoverage: 'full',
    providerHomeScore: 0,
    providerAwayScore: 1,
    timelineHomeGoals: 0,
    timelineAwayGoals: 2,
  }), {
    homeScore: 0,
    awayScore: 2,
    provisional: true,
  });
});

test('lets a full live timeline retract a stale provider goal', () => {
  assert.deepEqual(deriveLiveScore({
    status: 'live',
    timelineCoverage: 'full',
    providerHomeScore: 1,
    providerAwayScore: 0,
    timelineHomeGoals: 0,
    timelineAwayGoals: 0,
  }), {
    homeScore: 0,
    awayScore: 0,
    provisional: true,
  });
});

test('does not overlay partial or non-live timelines', () => {
  assert.deepEqual(deriveLiveScore({
    status: 'live',
    timelineCoverage: 'partial',
    providerHomeScore: 1,
    providerAwayScore: 0,
    timelineHomeGoals: 1,
    timelineAwayGoals: 1,
  }), {
    homeScore: 1,
    awayScore: 0,
    provisional: false,
  });
  assert.deepEqual(deriveLiveScore({
    status: 'completed',
    timelineCoverage: 'full',
    providerHomeScore: 2,
    providerAwayScore: 1,
    timelineHomeGoals: 2,
    timelineAwayGoals: 2,
  }), {
    homeScore: 2,
    awayScore: 1,
    provisional: false,
  });
});
