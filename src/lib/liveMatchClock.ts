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

function intervalLabel(event: TimelineClockEvent): string | null {
  if (event.type !== 'period_end') return null;
  if (event.period === 'first_half') return 'HT';
  if (event.period === 'extra_time_first_half') return 'ET HT';
  return null;
}

function regulationBoundary(period: string): number | null {
  if (period === 'first_half') return 45;
  if (period === 'second_half') return 90;
  if (period === 'extra_time_first_half') return 105;
  if (period === 'extra_time_second_half') return 120;
  return null;
}

/** TheStatsAPI's match resource has no clock. Project a display clock from the
 * latest timeline event and the provider timestamp that accompanied it. */
export function deriveLiveMatchClock(options: {
  status: string;
  latestEvent: unknown;
  providerUpdatedAt: Date | null;
  now: number;
}): string | null {
  if (options.status !== 'live') return null;
  const event = clockEvent(options.latestEvent);
  if (!event) return null;

  const interval = intervalLabel(event);
  if (interval) return interval;
  if (event.period === 'penalties') return 'PENS';

  const boundary = regulationBoundary(event.period);
  if (boundary === null) return null;
  if (event.type === 'period_end') {
    return event.extraTime > 0 ? `${boundary}+${event.extraTime}'` : `${boundary}'`;
  }
  const elapsed = options.providerUpdatedAt
    ? Math.max(0, Math.floor((options.now - options.providerUpdatedAt.getTime()) / 60_000))
    : 0;

  if (event.minute >= boundary) {
    const extra = event.extraTime + elapsed;
    return extra > 0 ? `${boundary}+${extra}'` : `${boundary}'`;
  }
  return `${Math.min(boundary, event.minute + elapsed)}'`;
}
