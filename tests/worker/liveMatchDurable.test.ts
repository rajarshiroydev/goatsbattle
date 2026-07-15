import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { correctionDueAt, coordinatorRetryDelay } from '../../src/durable/LiveMatchCoordinator';
import { LIVE_MATCH_PROTOCOL_VERSION } from '../../src/lib/liveMatchProtocol';

describe('StatsApiRequestBroker', () => {
  it('reserves at most seven featured and three other requests per minute', async () => {
    const broker = env.STATS_API_REQUEST_BROKER.getByName('provider-quota');
    const now = Date.UTC(2026, 6, 15, 12, 0, 0);
    for (let index = 0; index < 7; index += 1) expect(await broker.reserve(true, now)).toBe(true);
    expect(await broker.reserve(true, now)).toBe(false);
    for (let index = 0; index < 3; index += 1) expect(await broker.reserve(false, now)).toBe(true);
    expect(await broker.reserve(false, now)).toBe(false);
  });

  it('opens a fresh allocation window after sixty seconds', async () => {
    const broker = env.STATS_API_REQUEST_BROKER.getByName('provider-window');
    const now = Date.UTC(2026, 6, 15, 12, 0, 0);
    for (let index = 0; index < 7; index += 1) await broker.reserve(true, now);
    expect(await broker.reserve(true, now + 60_000)).toBe(true);
  });
});

describe('LiveMatchCoordinator runtime', () => {
  it('schedules its first alarm when the cron watchdog starts it', async () => {
    const coordinator = env.LIVE_MATCH_COORDINATOR.getByName('alarm-match');
    const status = await coordinator.start({
      matchId: 'alarm-match',
      provider: 'thestatsapi',
      providerMatchId: 'provider-1',
      kickoff: new Date(Date.now() + 60 * 60_000).toISOString(),
      status: 'scheduled',
      featured: true,
    });
    expect(status).toEqual({ active: true, healthy: true });
    await runInDurableObject(coordinator, async (_instance, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });

  it('accepts a hibernating WebSocket and broadcasts versioned events', async () => {
    const coordinator = env.LIVE_MATCH_COORDINATOR.getByName('discussion-match');
    const response = await coordinator.fetch(new Request('https://example.com/socket', {
      headers: { upgrade: 'websocket' },
    }));
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    socket!.accept();
    const received = new Promise<string>((resolve) => {
      socket!.addEventListener('message', (event) => resolve(String(event.data)), { once: true });
    });
    await coordinator.publish({
      version: LIVE_MATCH_PROTOCOL_VERSION,
      type: 'provider.health',
      matchId: 'discussion-match',
      sentAt: new Date().toISOString(),
      payload: { status: 'healthy', failureCount: 0, retryAt: null },
    });
    expect(JSON.parse(await received)).toMatchObject({
      version: 1,
      type: 'provider.health',
      matchId: 'discussion-match',
    });
    socket!.close(1000, 'done');
  });
});

describe('coordinator schedules', () => {
  it('uses 10/20/40/60 second retry backoff', () => {
    expect([1, 2, 3, 4, 5].map(coordinatorRetryDelay)).toEqual([10_000, 20_000, 40_000, 60_000, 60_000]);
  });

  it('schedules immediate, 5m, 15m, 1h, 6h, and 24h corrections', () => {
    const finishedAt = Date.UTC(2026, 6, 15, 12, 0, 0);
    expect([0, 1, 2, 3, 4, 5, 6].map((index) => correctionDueAt(finishedAt, index))).toEqual([
      finishedAt,
      finishedAt + 5 * 60_000,
      finishedAt + 15 * 60_000,
      finishedAt + 60 * 60_000,
      finishedAt + 6 * 60 * 60_000,
      finishedAt + 24 * 60 * 60_000,
      null,
    ]);
  });
});
