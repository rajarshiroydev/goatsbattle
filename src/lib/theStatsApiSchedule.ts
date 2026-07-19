import {
  listStatsApiCoordinatorMatches,
  refreshTheStatsApiWorldCup,
  type StatsApiCoordinatorMatch,
  type StatsApiSyncResult,
} from './theStatsApiSync';
import { refreshWorldCupScores, type WorldCupRefreshResult } from './worldCupSync';

interface CoordinatorStub {
  start(config: StatsApiCoordinatorMatch): Promise<{ active: boolean; healthy: boolean }>;
}

export interface StatsApiScheduleEnv {
  DATABASE_URL: string;
  THESTATSAPI_API_KEY?: string;
  LIVE_MATCH_COORDINATOR: { getByName(matchId: string): CoordinatorStub };
}

export interface StatsApiScheduleDependencies {
  listCoordinatorMatches(options: {
    databaseUrl: string;
    now: Date;
  }): Promise<StatsApiCoordinatorMatch[]>;
  refreshStatsApi(options: {
    databaseUrl: string;
    apiKey: string;
    now: Date;
    excludeMatchIds: readonly string[];
  }): Promise<StatsApiSyncResult>;
  refreshFallback(options: { databaseUrl: string; now: Date }): Promise<WorldCupRefreshResult>;
}

const defaultDependencies: StatsApiScheduleDependencies = {
  listCoordinatorMatches: listStatsApiCoordinatorMatches,
  refreshStatsApi: refreshTheStatsApiWorldCup,
  refreshFallback: refreshWorldCupScores,
};

/** Run the World Cup provider watchdog for one scheduled Worker invocation. */
export async function runStatsApiScheduledRefresh(
  scheduledTime: number,
  env: StatsApiScheduleEnv,
  dependencies: StatsApiScheduleDependencies = defaultDependencies,
): Promise<void> {
  const now = new Date(scheduledTime);
  let shouldUseFallback = !env.THESTATSAPI_API_KEY;
  try {
    if (env.THESTATSAPI_API_KEY) {
      const coordinatedMatchIds: string[] = [];
      const candidates = await dependencies.listCoordinatorMatches({
        databaseUrl: env.DATABASE_URL,
        now,
      });
      for (const candidate of candidates) {
        // Let the bounded cron repair path refresh provider identities and
        // rematerialize a finalized-but-empty timeline without racing the
        // existing coordinator alarm for the same match.
        if (candidate.needsRepair) continue;
        try {
          const coordinator = env.LIVE_MATCH_COORDINATOR.getByName(candidate.matchId);
          const status = await coordinator.start(candidate);
          if (status.active && (status.healthy || candidate.status === 'finished')) {
            coordinatedMatchIds.push(candidate.matchId);
          }
        } catch (error) {
          console.error(JSON.stringify({
            event: 'live_match_coordinator_start_failed',
            matchId: candidate.matchId,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }
      const result = await dependencies.refreshStatsApi({
        databaseUrl: env.DATABASE_URL,
        apiKey: env.THESTATSAPI_API_KEY,
        now,
        excludeMatchIds: coordinatedMatchIds,
      });
      shouldUseFallback = result.failures > 0;
      console.log(JSON.stringify({
        event: 'thestatsapi_world_cup_refresh',
        ...result,
        coordinatedMatches: coordinatedMatchIds.length,
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
      const fallback = await dependencies.refreshFallback({ databaseUrl: env.DATABASE_URL, now });
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
}
