import type { APIRoute } from 'astro';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../lib/db';
import { entities, matches, matchGoats, matchMoments, matchTimelineState } from '../../lib/db/schema';
import { deriveLiveMatchClock } from '../../lib/liveMatchClock';
import { deriveLiveScore } from '../../lib/liveScore';
import { THE_STATS_API_PROVIDER } from '../../lib/theStatsApi';
import { worldCup2026Fixtures } from '../../data/worldCup2026';

export const prerender = false;

export const GET: APIRoute = async () => {
  const now = Date.now();
  const featuredIds = worldCup2026Fixtures
    .filter((fixture) => fixture.matchNumber >= 101)
    .map((fixture) => fixture.id);
  const timelineGoals = db
    .select({
      matchId: matchMoments.matchId,
      homeGoals: sql<number>`count(*) filter (where ${matchMoments.team} = 'home')::int`.as('home_goals'),
      awayGoals: sql<number>`count(*) filter (where ${matchMoments.team} = 'away')::int`.as('away_goals'),
    })
    .from(matchMoments)
    .where(and(
      eq(matchMoments.provider, THE_STATS_API_PROVIDER),
      inArray(matchMoments.verificationStatus, ['provisional', 'confirmed']),
      inArray(matchMoments.type, ['goal', 'penalty']),
      inArray(matchMoments.matchId, featuredIds),
    ))
    .groupBy(matchMoments.matchId)
    .as('timeline_goals');
  const rows = await db
    .select({
      id: matches.id,
      homeTeam: matches.homeTeam,
      awayTeam: matches.awayTeam,
      homeScore: matches.homeScore,
      awayScore: matches.awayScore,
      homePenaltyScore: matches.homePenaltyScore,
      awayPenaltyScore: matches.awayPenaltyScore,
      kickoff: matches.kickoff,
      status: matches.status,
      lastSyncedAt: matches.lastSyncedAt,
      timelineLatestEvent: sql<unknown>`${matchTimelineState.events} -> -1`,
      timelineProviderUpdatedAt: matchTimelineState.providerUpdatedAt,
      timelineCoverage: matchTimelineState.coverage,
      timelineHomeGoals: timelineGoals.homeGoals,
      timelineAwayGoals: timelineGoals.awayGoals,
    })
    .from(matches)
    .leftJoin(matchTimelineState, eq(matchTimelineState.matchId, matches.id))
    .leftJoin(timelineGoals, eq(timelineGoals.matchId, matches.id))
    .where(inArray(matches.id, featuredIds))
    .orderBy(asc(matches.kickoff));
  const participation = await db
    .select({
      matchId: matchGoats.matchId,
      slug: entities.id,
      shortName: entities.shortName,
      team: matchGoats.team,
    })
    .from(matchGoats)
    .innerJoin(entities, eq(entities.id, matchGoats.goatSlug))
    .where(inArray(matchGoats.matchId, featuredIds));
  const goatsByMatch = new Map<string, typeof participation>();
  for (const goat of participation) {
    goatsByMatch.set(goat.matchId, [...(goatsByMatch.get(goat.matchId) ?? []), goat]);
  }

  const remaining = rows.filter((row) => row.id.startsWith('world-cup-2026-match-'));
  return new Response(JSON.stringify({
    matches: remaining.map((row) => {
      const kickoff = row.kickoff.getTime();
      const inPollingWindow = now >= kickoff - 60 * 60 * 1_000 && now <= kickoff + 4 * 60 * 60 * 1_000;
      const {
        timelineLatestEvent,
        timelineProviderUpdatedAt,
        timelineCoverage,
        timelineHomeGoals,
        timelineAwayGoals,
        ...match
      } = row;
      const liveScore = deriveLiveScore({
        status: row.status,
        timelineCoverage,
        providerHomeScore: row.homeScore,
        providerAwayScore: row.awayScore,
        timelineHomeGoals,
        timelineAwayGoals,
      });
      return {
        ...match,
        homeScore: liveScore.homeScore,
        awayScore: liveScore.awayScore,
        scoreProvisional: liveScore.provisional,
        kickoff: row.kickoff.toISOString(),
        lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
        delayed: inPollingWindow && (!row.lastSyncedAt || now - row.lastSyncedAt.getTime() > 3 * 60 * 1_000),
        matchClock: deriveLiveMatchClock({
          status: row.status,
          latestEvent: timelineLatestEvent,
          providerUpdatedAt: timelineProviderUpdatedAt,
          now,
        }),
        goats: (goatsByMatch.get(row.id) ?? []).map(({ slug, shortName, team }) => ({ slug, shortName, team })),
      };
    }),
  }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3, s-maxage=10, stale-while-revalidate=5',
    },
  });
};
