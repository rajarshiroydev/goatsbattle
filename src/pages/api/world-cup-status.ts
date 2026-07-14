import type { APIRoute } from 'astro';
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '../../lib/db';
import { entities, matches, matchGoats } from '../../lib/db/schema';

export const prerender = false;

export const GET: APIRoute = async () => {
  const now = Date.now();
  const featuredIds = [
    'world-cup-2026-match-101',
    'world-cup-2026-match-102',
    'world-cup-2026-match-103',
    'world-cup-2026-match-104',
  ];
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
    })
    .from(matches)
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
      return {
        ...row,
        kickoff: row.kickoff.toISOString(),
        lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
        delayed: inPollingWindow && (!row.lastSyncedAt || now - row.lastSyncedAt.getTime() > 3 * 60 * 1_000),
        goats: (goatsByMatch.get(row.id) ?? []).map(({ slug, shortName, team }) => ({ slug, shortName, team })),
      };
    }),
  }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=30, stale-while-revalidate=90',
    },
  });
};
