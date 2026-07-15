import type { LiveMatchCoordinator, StatsApiRequestBroker } from '../../src/worker';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DATABASE_URL: string;
    THESTATSAPI_API_KEY: string;
    LIVE_MATCH_COORDINATOR: DurableObjectNamespace<LiveMatchCoordinator>;
    STATS_API_REQUEST_BROKER: DurableObjectNamespace<StatsApiRequestBroker>;
  }
}
