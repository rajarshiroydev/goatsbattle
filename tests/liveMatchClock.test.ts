import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveLiveMatchClock,
  formatLiveMatchClock,
  recalibrateLiveMatchClock,
  type LiveClockState,
} from '../src/lib/liveMatchClock';

const at = new Date('2026-07-14T19:30:00.000Z');

test('projects seconds from the local ingestion observation time', () => {
  const clock = deriveLiveMatchClock({
    status: 'live',
    latestEvent: { minute: 31, extraTime: 0, period: 'first_half', type: 'foul' },
    observedAt: at,
  });
  assert.equal(formatLiveMatchClock(clock, at.getTime() + 23_000), '31:23');
});

test('formats first-half stoppage time with seconds', () => {
  const clock = deriveLiveMatchClock({
    status: 'live',
    latestEvent: { minute: 45, extraTime: 3, period: 'first_half', type: 'foul' },
    observedAt: at,
  });
  assert.equal(formatLiveMatchClock(clock, at.getTime() + 12_000), '45+03:12');
});

test('shows explicit interval and penalty phases', () => {
  assert.equal(formatLiveMatchClock(deriveLiveMatchClock({
    status: 'live',
    latestEvent: { minute: 45, extraTime: 4, period: 'first_half', type: 'period_end' },
    observedAt: at,
  }), at.getTime() + 10 * 60_000), 'HT');
  assert.equal(formatLiveMatchClock(deriveLiveMatchClock({
    status: 'live',
    latestEvent: { minute: 105, extraTime: 1, period: 'extra_time_first_half', type: 'period_end' },
    observedAt: at,
  })), 'ET HT');
  assert.equal(formatLiveMatchClock(deriveLiveMatchClock({
    status: 'live',
    latestEvent: { minute: 120, extraTime: 0, period: 'penalties', type: 'penalty_scored' },
    observedAt: at,
  })), 'PENS');
});

test('formats persistent regulation and extra-time full-time labels', () => {
  assert.equal(formatLiveMatchClock(deriveLiveMatchClock({
    status: 'finished',
    latestEvent: { minute: 90, extraTime: 5, period: 'second_half', type: 'period_end' },
    observedAt: at,
  }), at.getTime() + 24 * 60 * 60_000), '90 minutes');
  assert.equal(formatLiveMatchClock(deriveLiveMatchClock({
    status: 'finished',
    latestEvent: { minute: 120, extraTime: 2, period: 'extra_time_second_half', type: 'period_end' },
    observedAt: at,
  })), '120 minutes');
});

test('wall-time formatting recovers after a background-tab gap', () => {
  const clock: LiveClockState = {
    phase: 'second_half', elapsedSeconds: 58 * 60, observedAt: at.toISOString(), running: true,
  };
  assert.equal(formatLiveMatchClock(clock, at.getTime() + 5 * 60_000 + 7_000), '63:07');
});

test('recalibration moves forward but never jumps backward in one period', () => {
  const previous: LiveClockState = {
    phase: 'second_half', elapsedSeconds: 58 * 60, observedAt: at.toISOString(), running: true,
  };
  const observedLater = new Date(at.getTime() + 30_000).toISOString();
  assert.deepEqual(recalibrateLiveMatchClock(previous, {
    phase: 'second_half', elapsedSeconds: 57 * 60, observedAt: observedLater, running: true,
  }), {
    phase: 'second_half', elapsedSeconds: 58 * 60 + 30, observedAt: observedLater, running: true,
  });
  assert.equal(recalibrateLiveMatchClock(previous, {
    phase: 'second_half', elapsedSeconds: 60 * 60, observedAt: observedLater, running: true,
  })?.elapsedSeconds, 60 * 60);
});

test('does not invent a clock without a timeline event', () => {
  assert.equal(deriveLiveMatchClock({ status: 'scheduled', latestEvent: null, observedAt: null }), null);
});
