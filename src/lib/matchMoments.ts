// Shared live feed for the two timeline islands on a match page. A module-level
// store gives both islands one request and one polling timer per match.
import { subscribeLiveMatch } from './liveMatchSocket';

export interface Moment {
  id: number;
  minute: number;
  extra: number | null;
  type: string;
  team: string;
  playerName: string | null;
  goatSlug: string | null;
  goatShortName: string | null;
  detail: string | null;
  verificationStatus: 'active' | 'corrected';
}

type MomentLabelInput = Pick<Moment, 'minute' | 'extra' | 'type'>;

export interface MomentFeed {
  moments: Moment[];
  matchStatus: string | null;
  fetchedAt: string | null;
  hasCorrections: boolean;
  liveEnabled: boolean;
}

type FeedListener = (feed: MomentFeed) => void;
type ErrorListener = () => void;
interface FeedStore {
  feed: MomentFeed | null;
  request: Promise<MomentFeed> | null;
  listeners: Set<FeedListener>;
  errorListeners: Set<ErrorListener>;
  timer: number | null;
}

const stores = new Map<string, FeedStore>();
const FALLBACK_POLL_MS = 60_000;

function storeFor(matchId: string): FeedStore {
  let store = stores.get(matchId);
  if (!store) {
    store = {
      feed: null,
      request: null,
      listeners: new Set(),
      errorListeners: new Set(),
      timer: null,
    };
    stores.set(matchId, store);
  }
  return store;
}

export function fetchMatchMomentFeed(matchId: string): Promise<MomentFeed> {
  const store = storeFor(matchId);
  if (!store.request) {
    store.request = fetch(`/api/match-moments?match=${encodeURIComponent(matchId)}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('failed'))))
      .then((data: MomentFeed) => {
        store.feed = data;
        for (const listener of store.listeners) listener(data);
        return data;
      })
      .catch((error) => {
        for (const listener of store.errorListeners) listener();
        throw error;
      })
      .finally(() => {
        store.request = null;
      });
  }
  return store.request;
}

function shouldPoll(feed: MomentFeed | null): boolean {
  if (!feed) return true;
  if (!feed.liveEnabled) return false;
  return feed.matchStatus !== 'finished';
}

/** Subscribe to the shared live feed. The first subscriber starts polling and
 * the last subscriber tears it down; hidden tabs do not create requests. */
export function subscribeMatchMoments(
  matchId: string,
  onFeed: FeedListener,
  onError: ErrorListener,
): () => void {
  const store = storeFor(matchId);
  store.listeners.add(onFeed);
  store.errorListeners.add(onError);
  if (store.feed) onFeed(store.feed);
  void fetchMatchMomentFeed(matchId).catch(() => undefined);
  const unsubscribeSocket = subscribeLiveMatch(
    matchId,
    (event) => {
      if (event.type !== 'match.snapshot') return;
      const next: MomentFeed = {
        moments: event.payload.moments,
        matchStatus: event.payload.status,
        fetchedAt: event.payload.freshness.fetchedAt,
        hasCorrections: event.payload.moments.some((moment) => moment.verificationStatus === 'corrected'),
        liveEnabled: true,
      };
      store.feed = next;
      for (const listener of store.listeners) listener(next);
    },
    () => { void fetchMatchMomentFeed(matchId).catch(() => undefined); },
  );

  if (store.timer === null) {
    store.timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && shouldPoll(store.feed)) {
        void fetchMatchMomentFeed(matchId).catch(() => undefined);
      }
    }, FALLBACK_POLL_MS);
  }

  return () => {
    store.listeners.delete(onFeed);
    store.errorListeners.delete(onError);
    unsubscribeSocket();
    if (store.listeners.size === 0 && store.timer !== null) {
      window.clearInterval(store.timer);
      store.timer = null;
    }
  };
}

// ── Shared moment vocabulary ──────────────────────────────────────────────────

export const MOMENT_GLYPH: Record<string, string> = {
  goal: '⚽', penalty: '⚽', own_goal: '⚽', penalty_missed: '❌',
  yellow_card: '🟨', red_card: '🟥', foul: '⚠️', handball: '✋',
  sub: '🔁', var: '📺', shootout: '🥅',
};

export const MOMENT_TYPE_LABEL: Record<string, string> = {
  goal: 'Goal', penalty: 'Penalty', own_goal: 'Own goal', penalty_missed: 'Missed pen',
  yellow_card: 'Yellow card', red_card: 'Red card', foul: 'Foul', handball: 'Handball',
  sub: 'Sub', var: 'VAR', shootout: 'Shootout',
};

export const isGoal = (type: string) => type === 'goal' || type === 'penalty' || type === 'own_goal';
export const isCard = (type: string) => type === 'yellow_card' || type === 'red_card';

export const momentGlyph = (type: string) => MOMENT_GLYPH[type] ?? '•';
export const cardColor = (type: string) => type === 'red_card' ? 'var(--color-red)' : '#f5c518';
export const momentTypeLabel = (type: string) => MOMENT_TYPE_LABEL[type] ?? type.replace(/_/g, ' ');
export const minuteLabel = (moment: MomentLabelInput) => `${moment.minute}${moment.extra ? `+${moment.extra}` : ''}'`;
export const anchorLabel = (moment: MomentLabelInput) => `${minuteLabel(moment)} ${momentTypeLabel(moment.type)}`;
