import { DurableObject } from 'cloudflare:workers';
import { readLiveMatchSnapshot } from '../lib/liveMatchData';
import {
  LIVE_MATCH_PROTOCOL_VERSION,
  type LiveMatchEvent,
  type PublishableLiveMatchEvent,
} from '../lib/liveMatchProtocol';
import {
  syncCoordinatedStatsApiMatch,
  type CoordinatedStatsApiWork,
  type StatsApiCoordinatorMatch,
} from '../lib/theStatsApiSync';

const POLL_MS = 10_000;
const STATUS_MS = 60_000;
export const COORDINATOR_HEALTHY_GRACE_MS = STATUS_MS + 2 * POLL_MS;
const CORRECTION_OFFSETS = [0, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];
const FAILURE_BACKOFF = [10_000, 20_000, 40_000, 60_000];

export const correctionDueAt = (finishedAt: number, correctionIndex: number): number | null => {
  const offset = CORRECTION_OFFSETS[correctionIndex];
  return offset === undefined ? null : finishedAt + offset;
};

export const coordinatorRetryDelay = (failureCount: number): number =>
  FAILURE_BACKOFF[Math.min(Math.max(1, failureCount) - 1, FAILURE_BACKOFF.length - 1)];

interface CoordinatorState {
  revision: number;
  last_status: string;
  last_timeline_at: number;
  last_status_at: number;
  last_lineup_at: number;
  last_success_at: number;
  failure_count: number;
  next_attempt_at: number;
  official_lineup: number;
  pending_broadcast: number;
  finished_at: number;
  correction_index: number;
}

type DurableObjectContext = ConstructorParameters<typeof DurableObject>[0];
type DurableSocket = Parameters<DurableObjectContext['acceptWebSocket']>[0];
type WebSocketResponseInit = ResponseInit & { webSocket: DurableSocket };

export class LiveMatchCoordinator extends DurableObject<Env> {
  constructor(ctx: DurableObjectContext, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS coordinator_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          match_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          provider_match_id TEXT NOT NULL,
          kickoff TEXT NOT NULL,
          featured INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS coordinator_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          revision INTEGER NOT NULL DEFAULT 0,
          last_status TEXT NOT NULL DEFAULT 'scheduled',
          last_timeline_at INTEGER NOT NULL DEFAULT 0,
          last_status_at INTEGER NOT NULL DEFAULT 0,
          last_lineup_at INTEGER NOT NULL DEFAULT 0,
          last_success_at INTEGER NOT NULL DEFAULT 0,
          failure_count INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL DEFAULT 0,
          official_lineup INTEGER NOT NULL DEFAULT 0,
          pending_broadcast INTEGER NOT NULL DEFAULT 0,
          finished_at INTEGER NOT NULL DEFAULT 0,
          correction_index INTEGER NOT NULL DEFAULT 0
        );
      `);
    });
  }

  async start(config: StatsApiCoordinatorMatch): Promise<{ active: boolean; healthy: boolean }> {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO coordinator_config
        (id, match_id, provider, provider_match_id, kickoff, featured)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         match_id = excluded.match_id, provider = excluded.provider,
         provider_match_id = excluded.provider_match_id, kickoff = excluded.kickoff,
         featured = excluded.featured`,
      config.matchId, config.provider, config.providerMatchId, config.kickoff, config.featured ? 1 : 0,
    );
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO coordinator_state (id, last_status, finished_at) VALUES (1, ?, ?)`,
      config.status, config.status === 'finished' ? now : 0,
    );
    const state = this.state();
    const correctionActive = state.last_status === 'finished'
      && correctionDueAt(state.finished_at, state.correction_index) !== null;
    const active = state.last_status !== 'finished' || correctionActive;
    const alarm = await this.ctx.storage.getAlarm();
    if (!active && alarm !== null) {
      await this.ctx.storage.deleteAlarm();
    } else if (active && (alarm === null || alarm > now + POLL_MS)) {
      await this.ctx.storage.setAlarm(now + 100);
    }
    const recentlyHealthy = state.last_success_at === 0
      || now - state.last_success_at < COORDINATOR_HEALTHY_GRACE_MS;
    return {
      active,
      healthy: state.failure_count === 0 && (correctionActive || recentlyHealthy),
    };
  }

  async publish(event: PublishableLiveMatchEvent): Promise<void> {
    const config = this.config();
    if ((config && event.matchId !== config.match_id) || event.version !== LIVE_MATCH_PROTOCOL_VERSION) return;
    this.broadcast(event);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }
    const Pair = (globalThis as typeof globalThis & {
      WebSocketPair: new () => { 0: DurableSocket; 1: DurableSocket };
    }).WebSocketPair;
    const pair = new Pair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    this.ctx.waitUntil(this.sendCurrentSnapshot(server));
    return new Response(null, { status: 101, webSocket: client } as WebSocketResponseInit);
  }

  async webSocketMessage(socket: DurableSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === 'string' && message === 'ping') socket.send('pong');
  }

  webSocketClose(socket: DurableSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }

  webSocketError(socket: DurableSocket): void {
    socket.close(1011, 'WebSocket error');
  }

  async alarm(): Promise<void> {
    const config = this.config();
    if (!config) return;
    const now = Date.now();
    let state = this.state();
    if (state.next_attempt_at > now) {
      await this.ctx.storage.setAlarm(state.next_attempt_at);
      return;
    }

    try {
      let statusSucceeded = false;
      const statusDue = now - state.last_status_at >= STATUS_MS;
      if (state.last_status !== 'finished' && statusDue) {
        const result = await this.runWork(config, 'status', now);
        if (result) {
          statusSucceeded = true;
          this.ctx.storage.sql.exec(
            `UPDATE coordinator_state
             SET last_status = ?, last_status_at = ?, last_success_at = ?, failure_count = 0, next_attempt_at = 0
             WHERE id = 1`,
            result.matchStatus, now, now,
          );
          if (result.matchStatus === 'finished' && state.finished_at === 0) {
            this.ctx.storage.sql.exec(
              `UPDATE coordinator_state SET finished_at = ?, correction_index = 0, pending_broadcast = 1 WHERE id = 1`,
              now,
            );
          }
          state = this.state();
        }
      }

      if (state.last_status === 'scheduled') {
        const kickoff = Date.parse(config.kickoff);
        if (!state.official_lineup && now >= kickoff - 2 * 60 * 60_000 && now - state.last_lineup_at >= STATUS_MS) {
          const lineup = await this.runWork(config, 'lineup', now);
          if (lineup) {
            this.ctx.storage.sql.exec(
              `UPDATE coordinator_state
               SET last_lineup_at = ?, official_lineup = ?, last_success_at = ?, failure_count = 0
               WHERE id = 1`,
              now, lineup.officialLineup ? 1 : 0, now,
            );
          }
        }
      } else if (state.last_status === 'live' && now - state.last_timeline_at >= POLL_MS) {
        const timeline = await this.runWork(config, 'timeline', now);
        if (timeline) {
          this.ctx.storage.sql.exec(
            `UPDATE coordinator_state
             SET last_timeline_at = ?, pending_broadcast = CASE WHEN ? THEN 1 ELSE pending_broadcast END,
                 last_success_at = ?, failure_count = 0
             WHERE id = 1`,
            now, timeline.changed ? 1 : 0, now,
          );
          state = this.state();
        }
        if (!state.official_lineup && now - state.last_lineup_at >= STATUS_MS) {
          const lineup = await this.runWork(config, 'lineup', now);
          if (lineup) {
            this.ctx.storage.sql.exec(
              `UPDATE coordinator_state
               SET last_lineup_at = ?, official_lineup = ?, last_success_at = ?, failure_count = 0
               WHERE id = 1`,
              now, lineup.officialLineup ? 1 : 0, now,
            );
          }
        }
      }

      state = this.state();
      if (state.last_status === 'finished') {
        const dueAt = correctionDueAt(state.finished_at, state.correction_index) ?? Number.POSITIVE_INFINITY;
        if (now >= dueAt) {
          const final = await this.runWork(config, 'final', now);
          if (final) {
            if (!final.finalized) throw new Error(`Final timeline is incomplete for ${config.match_id}.`);
            this.ctx.storage.sql.exec(
              `UPDATE coordinator_state
               SET correction_index = correction_index + 1,
                   pending_broadcast = CASE WHEN ? THEN 1 ELSE pending_broadcast END,
                   last_success_at = ?, failure_count = 0
               WHERE id = 1`,
              final.changed ? 1 : 0, now,
            );
          }
        }
      }

      state = this.state();
      if (state.pending_broadcast === 1
        || (statusSucceeded && state.last_status !== 'scheduled')) {
        await this.broadcastSnapshot();
      }
      await this.broadcastHealth('healthy', 0, null);
      state = this.state();
      const nextCorrection = state.last_status === 'finished'
        ? correctionDueAt(state.finished_at, state.correction_index) ?? Number.POSITIVE_INFINITY
        : Number.POSITIVE_INFINITY;
      if (Number.isFinite(nextCorrection)) await this.ctx.storage.setAlarm(Math.max(now + POLL_MS, nextCorrection));
      else if (state.last_status !== 'finished') await this.ctx.storage.setAlarm(now + POLL_MS);
      else await this.ctx.storage.deleteAlarm();
    } catch (error) {
      state = this.state();
      const failureCount = state.failure_count + 1;
      const delay = coordinatorRetryDelay(failureCount);
      const retryAt = now + delay;
      this.ctx.storage.sql.exec(
        `UPDATE coordinator_state SET failure_count = ?, next_attempt_at = ? WHERE id = 1`,
        failureCount, retryAt,
      );
      await this.broadcastHealth('delayed', failureCount, new Date(retryAt).toISOString());
      console.error(JSON.stringify({
        event: 'live_match_coordinator_failed',
        matchId: config.match_id,
        provider: config.provider,
        failureCount,
        error: error instanceof Error ? error.message : String(error),
      }));
      await this.ctx.storage.setAlarm(retryAt);
    }
  }

  private config() {
    return this.ctx.storage.sql.exec<{
      match_id: string; provider: string; provider_match_id: string; kickoff: string; featured: number;
    }>('SELECT match_id, provider, provider_match_id, kickoff, featured FROM coordinator_config WHERE id = 1').toArray()[0];
  }

  private state(): CoordinatorState {
    const row = this.ctx.storage.sql.exec<CoordinatorState>(
      `SELECT revision, last_status, last_timeline_at, last_status_at, last_lineup_at,
              last_success_at, failure_count, next_attempt_at, official_lineup,
              pending_broadcast, finished_at, correction_index
       FROM coordinator_state WHERE id = 1`,
    ).toArray()[0];
    if (!row) throw new Error('Coordinator state is not initialized.');
    return row;
  }

  private async runWork(
    config: NonNullable<ReturnType<LiveMatchCoordinator['config']>>,
    work: CoordinatedStatsApiWork,
    now: number,
  ) {
    if (config.provider !== 'thestatsapi') throw new Error(`Unsupported live provider ${config.provider}.`);
    const broker = this.env.STATS_API_REQUEST_BROKER.getByName(config.provider);
    if (!await broker.reserve(config.featured === 1, now)) return null;
    return syncCoordinatedStatsApiMatch({
      databaseUrl: this.env.DATABASE_URL,
      apiKey: this.env.THESTATSAPI_API_KEY,
      matchId: config.match_id,
      work,
      now: new Date(now),
    });
  }

  private async sendCurrentSnapshot(socket: DurableSocket): Promise<void> {
    const config = this.config();
    if (!config) return;
    const state = this.state();
    const payload = await readLiveMatchSnapshot({
      databaseUrl: this.env.DATABASE_URL,
      matchId: config.match_id,
      revision: state.revision,
    });
    socket.send(JSON.stringify({
      version: LIVE_MATCH_PROTOCOL_VERSION,
      type: 'match.snapshot',
      matchId: config.match_id,
      sentAt: new Date().toISOString(),
      payload,
    } satisfies LiveMatchEvent));
  }

  private async broadcastSnapshot(): Promise<void> {
    const config = this.config();
    if (!config) return;
    this.ctx.storage.sql.exec(
      'UPDATE coordinator_state SET revision = revision + 1 WHERE id = 1',
    );
    const state = this.state();
    const payload = await readLiveMatchSnapshot({
      databaseUrl: this.env.DATABASE_URL,
      matchId: config.match_id,
      revision: state.revision,
    });
    this.broadcast({
      version: LIVE_MATCH_PROTOCOL_VERSION,
      type: 'match.snapshot',
      matchId: config.match_id,
      sentAt: new Date().toISOString(),
      payload,
    });
    this.ctx.storage.sql.exec(
      'UPDATE coordinator_state SET pending_broadcast = 0 WHERE id = 1',
    );
  }

  private async broadcastHealth(
    status: 'healthy' | 'delayed',
    failureCount: number,
    retryAt: string | null,
  ): Promise<void> {
    const config = this.config();
    if (!config) return;
    this.broadcast({
      version: LIVE_MATCH_PROTOCOL_VERSION,
      type: 'provider.health',
      matchId: config.match_id,
      sentAt: new Date().toISOString(),
      payload: { status, failureCount, retryAt },
    });
  }

  private broadcast(event: LiveMatchEvent): void {
    const message = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(message); } catch { socket.close(1011, 'Broadcast failed'); }
    }
  }
}
