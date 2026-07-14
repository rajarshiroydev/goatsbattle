import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveLiveMatchClock } from '../src/lib/liveMatchClock';

const at = new Date('2026-07-14T19:30:00.000Z');

test('projects a running minute from the latest provider timeline update', () => {
  assert.equal(deriveLiveMatchClock({
    status: 'live',
    latestEvent: { minute: 31, extraTime: 0, period: 'first_half', type: 'foul' },
    providerUpdatedAt: at,
    now: at.getTime() + 2 * 60_000,
  }), "33'");
});

test('projects known first-half stoppage time', () => {
  assert.equal(deriveLiveMatchClock({
    status: 'live',
    latestEvent: { minute: 45, extraTime: 3, period: 'first_half', type: 'foul' },
    providerUpdatedAt: at,
    now: at.getTime() + 60_000,
  }), "45+4'");
});

test('shows explicit interval and penalty phases', () => {
  assert.equal(deriveLiveMatchClock({
    status: 'live',
    latestEvent: { minute: 45, extraTime: 4, period: 'first_half', type: 'period_end' },
    providerUpdatedAt: at,
    now: at.getTime() + 10 * 60_000,
  }), 'HT');
  assert.equal(deriveLiveMatchClock({
    status: 'live',
    latestEvent: { minute: 120, extraTime: 0, period: 'penalties', type: 'penalty_scored' },
    providerUpdatedAt: at,
    now: at.getTime(),
  }), 'PENS');
});

test('does not invent a clock without a live timeline', () => {
  assert.equal(deriveLiveMatchClock({
    status: 'scheduled', latestEvent: null, providerUpdatedAt: null, now: at.getTime(),
  }), null);
});
