import { handle } from '@astrojs/cloudflare/handler';
import { refreshTheStatsApiWorldCup } from './lib/theStatsApiSync';
import { refreshWorldCupScores } from './lib/worldCupSync';

type AstroHandleArgs = Parameters<typeof handle>;

export default {
  fetch(request: AstroHandleArgs[0], env: AstroHandleArgs[1], ctx: AstroHandleArgs[2]) {
    return handle(request, env, ctx);
  },

  async scheduled(controller: { readonly scheduledTime: number }, env: Env) {
    const now = new Date(controller.scheduledTime);
    let shouldUseFallback = !env.THESTATSAPI_API_KEY;
    try {
      if (env.THESTATSAPI_API_KEY) {
        const result = await refreshTheStatsApiWorldCup({
          databaseUrl: env.DATABASE_URL,
          apiKey: env.THESTATSAPI_API_KEY,
          now,
        });
        shouldUseFallback = result.failures > 0;
        console.log(JSON.stringify({
          event: 'thestatsapi_world_cup_refresh',
          ...result,
          at: now.toISOString(),
        }));
      }
    } catch (error) {
      shouldUseFallback = true;
      console.error(JSON.stringify({
        event: 'thestatsapi_world_cup_refresh_failed',
        at: now.toISOString(),
        error: error instanceof Error ? error.message : String(error),
      }));
    }

    if (shouldUseFallback) {
      try {
        const fallback = await refreshWorldCupScores({ databaseUrl: env.DATABASE_URL, now });
        console.warn(JSON.stringify({
          event: 'world_cup_community_fallback',
          ...fallback,
          at: now.toISOString(),
        }));
      } catch (error) {
        // Preserve the last valid database state. Freshness-based UI marks it
        // delayed after three minutes; there is intentionally no public retry URL.
        console.error(JSON.stringify({
          event: 'world_cup_all_providers_failed',
          at: now.toISOString(),
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
  },
};
