import { handle } from '@astrojs/cloudflare/handler';
import { runStatsApiScheduledRefresh } from './lib/theStatsApiSchedule';

export { LiveMatchCoordinator } from './durable/LiveMatchCoordinator';
export { StatsApiRequestBroker } from './durable/StatsApiRequestBroker';

type AstroHandleArgs = Parameters<typeof handle>;

export default {
  fetch(request: AstroHandleArgs[0], env: AstroHandleArgs[1], ctx: AstroHandleArgs[2]) {
    return handle(request, env, ctx);
  },

  async scheduled(controller: { readonly scheduledTime: number }, env: Env) {
    await runStatsApiScheduledRefresh(controller.scheduledTime, env);
  },
};
