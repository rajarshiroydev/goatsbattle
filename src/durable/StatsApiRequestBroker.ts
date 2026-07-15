import { DurableObject } from 'cloudflare:workers';

const FEATURED_LIMIT = 7;
const OTHER_LIMIT = 3;
const GLOBAL_LIMIT = 10;

export class StatsApiRequestBroker extends DurableObject<Env> {
  constructor(ctx: ConstructorParameters<typeof DurableObject>[0], env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS request_window (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          window_started_at INTEGER NOT NULL,
          featured_requests INTEGER NOT NULL,
          other_requests INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO request_window
          (id, window_started_at, featured_requests, other_requests)
        VALUES (1, 0, 0, 0);
      `);
    });
  }

  reserve(featured: boolean, now = Date.now()): boolean {
    const windowStartedAt = Math.floor(now / 60_000) * 60_000;
    let row = this.ctx.storage.sql.exec<{
      window_started_at: number;
      featured_requests: number;
      other_requests: number;
    }>('SELECT window_started_at, featured_requests, other_requests FROM request_window WHERE id = 1').one();
    if (row.window_started_at !== windowStartedAt) {
      this.ctx.storage.sql.exec(
        `UPDATE request_window
         SET window_started_at = ?, featured_requests = 0, other_requests = 0
         WHERE id = 1`,
        windowStartedAt,
      );
      row = { window_started_at: windowStartedAt, featured_requests: 0, other_requests: 0 };
    }
    if (row.featured_requests + row.other_requests >= GLOBAL_LIMIT) return false;
    if (featured && row.featured_requests >= FEATURED_LIMIT) return false;
    if (!featured && row.other_requests >= OTHER_LIMIT) return false;
    this.ctx.storage.sql.exec(
      featured
        ? 'UPDATE request_window SET featured_requests = featured_requests + 1 WHERE id = 1'
        : 'UPDATE request_window SET other_requests = other_requests + 1 WHERE id = 1',
    );
    return true;
  }
}
