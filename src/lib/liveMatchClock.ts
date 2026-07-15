export type LiveClockPhase =
  | 'first_half'
  | 'half_time'
  | 'second_half'
  | 'extra_time_first_half'
  | 'extra_time_half_time'
  | 'extra_time_second_half'
  | 'penalties'
  | 'full_time';

export interface LiveClockState {
  phase: LiveClockPhase;
  /** Match elapsed time, including known stoppage time. */
  elapsedSeconds: number;
  /** When this anchor was first observed by our ingestion, not provider time. */
  observedAt: string;
  running: boolean;
  /** True until a real timeline event provides the clock anchor. */
  approximate: boolean;
}

interface TimelineClockEvent {
  minute: number;
  extraTime: number;
  period: string;
  type: string;
}

function clockEvent(value: unknown): TimelineClockEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (!Number.isInteger(event.minute) || Number(event.minute) < 0) return null;
  if (!Number.isInteger(event.extraTime) || Number(event.extraTime) < 0) return null;
  if (typeof event.period !== 'string' || typeof event.type !== 'string') return null;
  return {
    minute: Number(event.minute),
    extraTime: Number(event.extraTime),
    period: event.period,
    type: event.type,
  };
}

function playPhase(period: string): LiveClockPhase | null {
  if (period === 'first_half') return 'first_half';
  if (period === 'second_half') return 'second_half';
  if (period === 'extra_time_first_half') return 'extra_time_first_half';
  if (period === 'extra_time_second_half') return 'extra_time_second_half';
  if (period === 'penalties') return 'penalties';
  return null;
}

function periodBoundary(phase: LiveClockPhase): number | null {
  if (phase === 'first_half') return 45;
  if (phase === 'second_half') return 90;
  if (phase === 'extra_time_first_half') return 105;
  if (phase === 'extra_time_second_half') return 120;
  return null;
}

function observedIso(value: Date | null): string {
  return (value ?? new Date()).toISOString();
}

/** Create a clock anchor from the latest snapshot. The anchor intentionally
 * uses our first-seen snapshot time; a provider response timestamp can predate
 * when the event was actually made available to us. */
export function deriveLiveMatchClock(options: {
  status: string;
  latestEvent: unknown;
  observedAt: Date | null;
}): LiveClockState | null {
  const event = clockEvent(options.latestEvent);
  if (!event) {
    if (options.status !== 'live' || !options.observedAt) return null;
    return {
      phase: 'first_half',
      elapsedSeconds: 0,
      observedAt: options.observedAt.toISOString(),
      running: true,
      approximate: true,
    };
  }
  const observedAt = observedIso(options.observedAt);

  if (options.status === 'finished') {
    const extraTime = event.period.startsWith('extra_time') || event.period === 'penalties';
    return {
      phase: 'full_time',
      elapsedSeconds: (extraTime ? 120 : 90) * 60,
      observedAt,
      running: false,
      approximate: false,
    };
  }
  if (options.status !== 'live') return null;
  if (event.period === 'penalties') {
    return {
      phase: 'penalties', elapsedSeconds: 120 * 60, observedAt, running: false, approximate: false,
    };
  }
  if (event.type === 'period_end' && event.period === 'first_half') {
    return {
      phase: 'half_time', elapsedSeconds: (45 + event.extraTime) * 60,
      observedAt, running: false, approximate: false,
    };
  }
  if (event.type === 'period_end' && event.period === 'extra_time_first_half') {
    return {
      phase: 'extra_time_half_time', elapsedSeconds: (105 + event.extraTime) * 60,
      observedAt, running: false, approximate: false,
    };
  }

  const phase = playPhase(event.period);
  if (!phase) return null;
  const boundary = periodBoundary(phase);
  const elapsedMinutes = boundary !== null && event.minute >= boundary
    ? boundary + event.extraTime
    : event.minute;
  return {
    phase,
    elapsedSeconds: elapsedMinutes * 60,
    observedAt,
    running: event.type !== 'period_end',
    approximate: false,
  };
}

function projectedSeconds(clock: LiveClockState, now: number): number {
  if (!clock.running) return clock.elapsedSeconds;
  const observed = Date.parse(clock.observedAt);
  return clock.elapsedSeconds + (Number.isFinite(observed) ? Math.max(0, Math.floor((now - observed) / 1_000)) : 0);
}

/** Recalibrate to a newer event without allowing a backwards jump inside the
 * same period. Phase changes (for example live play to HT) always win. */
export function recalibrateLiveMatchClock(
  previous: LiveClockState | null,
  next: LiveClockState | null,
): LiveClockState | null {
  if (!previous || !next) return next;
  // A real timeline anchor always wins, including a backwards correction from
  // the lower-trust provisional clock. A later provisional response can never
  // displace a real anchor already held by the client. Treat a missing field
  // from an older protocol payload as real for rolling-deployment safety.
  const previousApproximate = previous.approximate === true;
  const nextApproximate = next.approximate === true;
  if (previousApproximate !== nextApproximate) return previousApproximate ? next : previous;
  if (previous.phase !== next.phase) return next;
  const nextObservedAt = Date.parse(next.observedAt);
  const previousAtObservation = projectedSeconds(previous, nextObservedAt);
  if (next.elapsedSeconds >= previousAtObservation) return next;
  return { ...next, elapsedSeconds: previousAtObservation };
}

const two = (value: number) => String(value).padStart(2, '0');
const PROVISIONAL_CLOCK_MAX_SECONDS = 10 * 60;

/** Format from wall time on every render. Background tabs therefore recover on
 * their next render instead of replaying missed interval ticks. */
export function formatLiveMatchClock(clock: LiveClockState | null, now = Date.now()): string | null {
  if (!clock) return null;
  if (clock.phase === 'half_time') return 'HT';
  if (clock.phase === 'extra_time_half_time') return 'ET HT';
  if (clock.phase === 'penalties') return 'PENS';
  if (clock.phase === 'full_time') return clock.elapsedSeconds >= 120 * 60 ? '120 minutes' : '90 minutes';

  const seconds = projectedSeconds(clock, now);
  // Empty timeline hashes can recur later in a match. Never let their original
  // first-seen timestamp turn an estimated startup clock into bogus stoppage time.
  if (clock.approximate === true && seconds > PROVISIONAL_CLOCK_MAX_SECONDS) return null;
  const boundary = periodBoundary(clock.phase);
  if (boundary !== null && seconds >= boundary * 60) {
    const extraSeconds = seconds - boundary * 60;
    return `${boundary}+${two(Math.floor(extraSeconds / 60))}:${two(extraSeconds % 60)}`;
  }
  return `${Math.floor(seconds / 60)}:${two(seconds % 60)}`;
}

export function formatLiveMatchClockLabel(
  clock: LiveClockState | null,
  now = Date.now(),
): string | null {
  const clockText = formatLiveMatchClock(clock, now);
  if (!clockText) return null;
  return clock?.approximate === true ? `Est. ${clockText}` : clockText;
}
