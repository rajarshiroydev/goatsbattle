import { useEffect, useState } from 'preact/hooks';
import { recalibrateLiveMatchClock, type LiveClockState } from './liveMatchClock';

/** Partial match rows keyed by match id, as served by /api/world-cup-status. */
export type WorldCupStatusUpdates = Map<string, Record<string, unknown>>;

type Subscriber = (updates: WorldCupStatusUpdates) => void;

const REFRESH_MS = 60_000;

// Module-level poller. Several islands on the homepage want the same live
// status; without this each one would run its own interval and multiply the
// request rate against a single shared endpoint. One interval, one in-flight
// request, fanned out to every mounted subscriber.
const subscribers = new Set<Subscriber>();
let latest: WorldCupStatusUpdates = new Map();
let timer: number | undefined;
let generation = 0;

function refresh() {
  const current = ++generation;
  return fetch('/api/world-cup-status')
    .then((response) => response.ok ? response.json() : Promise.reject())
    .then((data: { matches: Array<{ id: string } & Record<string, unknown>> }) => {
      // A slow earlier response must not clobber a newer one.
      if (current !== generation) return;
      latest = new Map(data.matches.map((match) => [match.id, match]));
      for (const notify of subscribers) notify(latest);
    })
    .catch(() => undefined);
}

function subscribe(subscriber: Subscriber) {
  subscribers.add(subscriber);
  // A late-mounting island gets the last known snapshot immediately rather
  // than sitting on stale server HTML until the next tick.
  if (latest.size > 0) subscriber(latest);
  if (timer === undefined) {
    refresh();
    timer = window.setInterval(refresh, REFRESH_MS);
  }
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0 && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

/**
 * Keeps a list of World Cup matches current, merging live status onto the
 * server-rendered fixtures. Every caller shares one poller.
 */
export function useWorldCupStatus<T extends { id: string }>(fixtures: T[]): T[] {
  const [matches, setMatches] = useState(fixtures);
  useEffect(() => subscribe((updates) => {
    setMatches((current) => current.map((match) => {
      const update = updates.get(match.id);
      if (!update) return match;
      const merged = { ...match, ...update } as T & { matchClock?: LiveClockState | null };
      // A live clock must never have its anchor replaced wholesale: a response
      // that lands after local wall-time projection would make the clock jump
      // backwards. Reconcile through recalibrate instead. Callers without a
      // matchClock field (e.g. the floor feed) are unaffected.
      if ('matchClock' in update) {
        merged.matchClock = recalibrateLiveMatchClock(
          (match as { matchClock?: LiveClockState | null }).matchClock ?? null,
          (update.matchClock as LiveClockState | null | undefined) ?? null,
        );
      }
      return merged;
    }));
  }), []);
  return matches;
}
