import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveLiveMatchClock,
  formatLiveMatchClock,
  formatLiveMatchClockLabel,
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
  assert.equal(formatLiveMatchClockLabel(clock, at.getTime() + 23_000), '31:23');
  assert.equal(clock?.approximate, false);
});

test('starts a provisional clock at the first live empty-timeline observation', () => {
  const clock = deriveLiveMatchClock({ status: 'live', latestEvent: null, observedAt: at });
  assert.deepEqual(clock, {
    phase: 'first_half',
    elapsedSeconds: 0,
    observedAt: at.toISOString(),
    running: true,
    approximate: true,
  });
  assert.equal(formatLiveMatchClock(clock, at.getTime() + 73_000), '1:13');
  assert.equal(formatLiveMatchClockLabel(clock, at.getTime() + 73_000), 'Est. 1:13');
});

test('expires a provisional clock before it can become bogus stoppage time', () => {
  const clock = deriveLiveMatchClock({ status: 'live', latestEvent: null, observedAt: at });
  assert.equal(formatLiveMatchClockLabel(clock, at.getTime() + 10 * 60_000), 'Est. 10:00');
  assert.equal(formatLiveMatchClock(clock, at.getTime() + 10 * 60_000 + 1_000), null);
  assert.equal(formatLiveMatchClockLabel(clock, at.getTime() + 60 * 60_000), null);
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
    phase: 'second_half', elapsedSeconds: 58 * 60, observedAt: at.toISOString(),
    running: true, approximate: false,
  };
  assert.equal(formatLiveMatchClock(clock, at.getTime() + 5 * 60_000 + 7_000), '63:07');
});

test('recalibration moves forward but never jumps backward in one period', () => {
  const previous: LiveClockState = {
    phase: 'second_half', elapsedSeconds: 58 * 60, observedAt: at.toISOString(),
    running: true, approximate: false,
  };
  const observedLater = new Date(at.getTime() + 30_000).toISOString();
  assert.deepEqual(recalibrateLiveMatchClock(previous, {
    phase: 'second_half', elapsedSeconds: 57 * 60, observedAt: observedLater,
    running: true, approximate: false,
  }), {
    phase: 'second_half', elapsedSeconds: 58 * 60 + 30, observedAt: observedLater,
    running: true, approximate: false,
  });
  assert.equal(recalibrateLiveMatchClock(previous, {
    phase: 'second_half', elapsedSeconds: 60 * 60, observedAt: observedLater,
    running: true, approximate: false,
  })?.elapsedSeconds, 60 * 60);
});

test('accepts a newer real phase and rejects a stale real phase transition', () => {
  const firstHalf: LiveClockState = {
    phase: 'first_half', elapsedSeconds: 44 * 60, observedAt: at.toISOString(),
    running: true, approximate: false,
  };
  const halfTime: LiveClockState = {
    phase: 'half_time', elapsedSeconds: 45 * 60,
    observedAt: new Date(at.getTime() + 60_000).toISOString(),
    running: false, approximate: false,
  };
  assert.deepEqual(recalibrateLiveMatchClock(firstHalf, halfTime), halfTime);
  assert.deepEqual(recalibrateLiveMatchClock(halfTime, firstHalf), halfTime);
});

test('accepts a backwards correction when a real timeline replaces the provisional clock', () => {
  const provisional = deriveLiveMatchClock({ status: 'live', latestEvent: null, observedAt: at });
  const realObservedAt = new Date(at.getTime() + 3 * 60_000);
  const real = deriveLiveMatchClock({
    status: 'live',
    latestEvent: { minute: 1, extraTime: 0, period: 'first_half', type: 'period_start' },
    observedAt: realObservedAt,
  });
  assert.deepEqual(recalibrateLiveMatchClock(provisional, real), real);
  assert.equal(real?.elapsedSeconds, 60);
});

test('accepts a forward correction when a real timeline replaces the provisional clock', () => {
  const provisional = deriveLiveMatchClock({ status: 'live', latestEvent: null, observedAt: at });
  const real = deriveLiveMatchClock({
    status: 'live',
    latestEvent: { minute: 4, extraTime: 0, period: 'first_half', type: 'foul' },
    observedAt: new Date(at.getTime() + 3 * 60_000),
  });
  assert.deepEqual(recalibrateLiveMatchClock(provisional, real), real);
  assert.equal(real?.elapsedSeconds, 4 * 60);
});

test('never lets a provisional response replace a real timeline clock', () => {
  const real = deriveLiveMatchClock({
    status: 'live',
    latestEvent: { minute: 4, extraTime: 0, period: 'first_half', type: 'foul' },
    observedAt: at,
  });
  const provisional = deriveLiveMatchClock({
    status: 'live', latestEvent: null, observedAt: new Date(at.getTime() + 60_000),
  });
  assert.deepEqual(recalibrateLiveMatchClock(real, provisional), real);
});

test('treats an older payload without the trust field as a real clock', () => {
  const legacyReal = {
    phase: 'first_half', elapsedSeconds: 4 * 60, observedAt: at.toISOString(), running: true,
  } as LiveClockState;
  const provisional = deriveLiveMatchClock({
    status: 'live', latestEvent: null, observedAt: new Date(at.getTime() + 60_000),
  });
  assert.deepEqual(recalibrateLiveMatchClock(legacyReal, provisional), legacyReal);
});

test('does not create a provisional clock unless the match is live', () => {
  assert.equal(deriveLiveMatchClock({ status: 'scheduled', latestEvent: null, observedAt: at }), null);
  assert.equal(deriveLiveMatchClock({ status: 'finished', latestEvent: null, observedAt: at }), null);
  assert.equal(deriveLiveMatchClock({ status: 'live', latestEvent: null, observedAt: null }), null);
});

test('does not treat a malformed latest event as an empty timeline', () => {
  assert.equal(deriveLiveMatchClock({ status: 'live', latestEvent: {}, observedAt: at }), null);
  assert.equal(deriveLiveMatchClock({ status: 'live', latestEvent: undefined, observedAt: at }), null);
});
