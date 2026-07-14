// Shared live feed for the two timeline islands on a match page. A module-level
// store gives both islands one request and one polling timer per match.

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
  verificationStatus: 'provisional' | 'confirmed';
}

export interface MomentFeed {
  moments: Moment[];
  matchStatus: string | null;
  fetchedAt: string | null;
  hasProvisional: boolean;
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
const POLL_MS = 15_000;

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

export function fetchMatchMoments(matchId: string): Promise<Moment[]> {
  return fetchMatchMomentFeed(matchId).then((feed) => feed.moments);
}

function shouldPoll(feed: MomentFeed | null): boolean {
  if (!feed) return true;
  if (!feed.liveEnabled) return false;
  return feed.matchStatus !== 'finished' || feed.hasProvisional;
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

  if (store.timer === null) {
    store.timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && shouldPoll(store.feed)) {
        void fetchMatchMomentFeed(matchId).catch(() => undefined);
      }
    }, POLL_MS);
  }

  return () => {
    store.listeners.delete(onFeed);
    store.errorListeners.delete(onError);
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
export const momentTypeLabel = (type: string) => MOMENT_TYPE_LABEL[type] ?? type.replace(/_/g, ' ');
export const minuteLabel = (moment: Moment) => `${moment.minute}${moment.extra ? `+${moment.extra}` : ''}'`;
export const anchorLabel = (moment: Moment) => `${minuteLabel(moment)} ${momentTypeLabel(moment.type)}`;
