import { LIVE_MATCH_PROTOCOL_VERSION, type LiveMatchEvent } from './liveMatchProtocol';

type EventListener = (event: LiveMatchEvent) => void;
type ReconnectListener = () => void;

interface SocketStore {
  socket: WebSocket | null;
  listeners: Set<EventListener>;
  reconnectListeners: Set<ReconnectListener>;
  retryTimer: number | null;
  retryAttempt: number;
  openedOnce: boolean;
  closedByClient: boolean;
}

const stores = new Map<string, SocketStore>();

function storeFor(matchId: string): SocketStore {
  let store = stores.get(matchId);
  if (!store) {
    store = {
      socket: null,
      listeners: new Set(),
      reconnectListeners: new Set(),
      retryTimer: null,
      retryAttempt: 0,
      openedOnce: false,
      closedByClient: false,
    };
    stores.set(matchId, store);
  }
  return store;
}

function connect(matchId: string, store: SocketStore): void {
  if (store.socket || store.listeners.size === 0) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/api/live-matches/${encodeURIComponent(matchId)}/socket`);
  store.socket = socket;
  store.closedByClient = false;

  socket.addEventListener('open', () => {
    const reconnected = store.openedOnce;
    store.openedOnce = true;
    store.retryAttempt = 0;
    if (reconnected) for (const listener of store.reconnectListeners) listener();
  });
  socket.addEventListener('message', (message) => {
    if (typeof message.data !== 'string') return;
    try {
      const event = JSON.parse(message.data) as LiveMatchEvent;
      if (event.version !== LIVE_MATCH_PROTOCOL_VERSION || event.matchId !== matchId) return;
      for (const listener of store.listeners) listener(event);
    } catch {
      // Ignore malformed frames. The next valid snapshot is self-contained.
    }
  });
  socket.addEventListener('close', () => {
    store.socket = null;
    if (store.closedByClient || store.listeners.size === 0) return;
    const delay = Math.min(30_000, 1_000 * (2 ** store.retryAttempt));
    store.retryAttempt += 1;
    store.retryTimer = window.setTimeout(() => {
      store.retryTimer = null;
      connect(matchId, store);
    }, delay);
  });
}

/** All islands for a match share this one module-level socket. */
export function subscribeLiveMatch(
  matchId: string,
  onEvent: EventListener,
  onReconnect: ReconnectListener = () => undefined,
): () => void {
  const store = storeFor(matchId);
  store.listeners.add(onEvent);
  store.reconnectListeners.add(onReconnect);
  connect(matchId, store);
  return () => {
    store.listeners.delete(onEvent);
    store.reconnectListeners.delete(onReconnect);
    if (store.listeners.size > 0) return;
    store.closedByClient = true;
    if (store.retryTimer !== null) window.clearTimeout(store.retryTimer);
    store.retryTimer = null;
    store.socket?.close(1000, 'No subscribers');
    store.socket = null;
    stores.delete(matchId);
  };
}
