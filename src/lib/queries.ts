import { sql, gt, eq, or, desc } from 'drizzle-orm';
import { db } from './db';
import { battles, votes, entities } from './db/schema';
import { getEntityBySlug, arenas } from '../data';
import type { Entity } from './types';

/**
 * A battle enriched with live vote tallies (from the DB) and the static entity
 * display data (from src/data). The display content lives in code; only the
 * mutable counts come from Postgres. See [[project-goatsbattle]] architecture.
 */
export interface BattleSummary {
  slug: string;
  /** Arena this battle belongs to, e.g. "football". */
  arena: string;
  a: Entity;
  b: Entity;
  votesA: number;
  votesB: number;
  total: number;
  pctA: number;
  pctB: number;
  leader: 'a' | 'b' | 'tie';
  /** Absolute percentage gap between the two sides (0 = dead heat). */
  margin: number;
}

interface BattleRow {
  id: string;
  entityA: string;
  entityB: string;
  votesA: number;
  votesB: number;
}

function toSummary(row: BattleRow): BattleSummary | null {
  const a = getEntityBySlug(row.entityA);
  const b = getEntityBySlug(row.entityB);
  if (!a || !b) return null;

  const total = row.votesA + row.votesB;
  const pctA = total > 0 ? Math.round((row.votesA / total) * 100) : 50;
  const pctB = 100 - pctA;
  const leader: 'a' | 'b' | 'tie' =
    row.votesA > row.votesB ? 'a' : row.votesB > row.votesA ? 'b' : 'tie';

  return {
    slug: row.id,
    arena: a.arena,
    a,
    b,
    votesA: row.votesA,
    votesB: row.votesB,
    total,
    pctA,
    pctB,
    leader,
    margin: Math.abs(pctA - pctB),
  };
}

/**
 * Marquee battles to anchor the homepage before community voting data builds
 * up. Used as the fallback ordering when sections would otherwise be empty.
 */
const FEATURED_ORDER = [
  'messi-vs-ronaldo',
  'maradona-vs-pele',
  'messi-vs-pele',
  'cruyff-vs-pele',
  'mbappe-vs-messi',
  'maradona-vs-messi',
];

function featuredRank(slug: string): number {
  const i = FEATURED_ORDER.indexOf(slug);
  return i === -1 ? FEATURED_ORDER.length : i;
}

export interface HomeBattleData {
  trending: BattleSummary[];
  mostVoted: BattleSummary[];
  closest: BattleSummary[];
  /** One headline battle per arena, for the cross-arena showcase. */
  spotlight: BattleSummary[];
  totalVotes: number;
}

/**
 * One round-trip of work for the homepage: pulls every battle's tallies plus
 * 24h vote velocity, then derives the trending / most-voted / closest sections.
 * Falls back to curated featured battles while vote data is still sparse.
 */
export async function getHomeBattleData(limit = 6): Promise<HomeBattleData> {
  const [rows, recent, [totals]] = await Promise.all([
    db
      .select({
        id: battles.id,
        entityA: battles.entityA,
        entityB: battles.entityB,
        votesA: battles.votesA,
        votesB: battles.votesB,
      })
      .from(battles),
    db
      .select({ battleId: votes.battleId, c: sql<number>`count(*)::int` })
      .from(votes)
      .where(gt(votes.createdAt, sql`now() - interval '24 hours'`))
      .groupBy(votes.battleId),
    db
      .select({ total: sql<number>`coalesce(sum(${battles.votesA} + ${battles.votesB}), 0)::int` })
      .from(battles),
  ]);

  const recentMap = new Map(recent.map((r) => [r.battleId, r.c]));
  const summaries = rows
    .map(toSummary)
    .filter((s): s is BattleSummary => s !== null);

  const mostVoted = [...summaries]
    .sort(
      (x, y) =>
        y.total - x.total ||
        featuredRank(x.slug) - featuredRank(y.slug),
    )
    .slice(0, limit);

  const closest = [...summaries]
    .sort((x, y) => {
      // Real contests first (need votes), then tightest margin, then bigger sample.
      if (x.total > 0 !== y.total > 0) return x.total > 0 ? -1 : 1;
      if (x.total > 0 && y.total > 0) {
        return x.margin - y.margin || y.total - x.total;
      }
      return featuredRank(x.slug) - featuredRank(y.slug);
    })
    .slice(0, limit);

  const trending = [...summaries]
    .sort((x, y) => {
      const rx = recentMap.get(x.slug) ?? 0;
      const ry = recentMap.get(y.slug) ?? 0;
      return ry - rx || y.total - x.total || featuredRank(x.slug) - featuredRank(y.slug);
    })
    .slice(0, limit);

  // One headline battle per arena — prefer the curated rivalry, else the arena's
  // most-voted battle, so the cross-arena showcase always fills.
  const byId = new Map(summaries.map((s) => [s.slug, s]));
  const seenCat = new Set<string>();
  const spotlight: BattleSummary[] = [];
  for (const { id: arena, spotlightBattleSlug } of arenas) {
    const pick = byId.get(spotlightBattleSlug) ??
      summaries.filter((s) => s.arena === arena).sort((a, b) => b.total - a.total)[0];
    if (pick && !seenCat.has(pick.arena)) {
      spotlight.push(pick);
      seenCat.add(pick.arena);
    }
  }

  return { trending, mostVoted, closest, spotlight, totalVotes: totals?.total ?? 0 };
}

/**
 * Every battle, enriched and sorted by total votes (then featured order).
 * Pass a `arena` to restrict the catalog to a single arena.
 */
export async function getAllBattleSummaries(arena?: string): Promise<BattleSummary[]> {
  const rows = await db
    .select({
      id: battles.id,
      entityA: battles.entityA,
      entityB: battles.entityB,
      votesA: battles.votesA,
      votesB: battles.votesB,
    })
    .from(battles)
    .where(arena ? eq(battles.arena, arena) : undefined);

  return rows
    .map(toSummary)
    .filter((s): s is BattleSummary => s !== null)
    .sort(
      (x, y) => y.total - x.total || featuredRank(x.slug) - featuredRank(y.slug),
    );
}

/** One row of the leaderboard: static display data + live ranking votes + H2H record. */
export interface RankingRow {
  rank: number;
  entity: Entity;
  /** Ranking total — the number users see. Profile +1, Champion crown +5. */
  votes: number;
  /** Head-to-head wins across 1v1 matchups (separate from the ranking). */
  votesFor: number;
  votesAgainst: number;
  /** Total head-to-head votes cast in this entity's matchups. */
  headToHeadVotes: number;
  /** Share of head-to-head votes won, 0–100 (0 when the entity has no H2H votes). */
  winRate: number;
}

/**
 * The vote leaderboard for an arena, most-voted first. Ranking votes and the
 * head-to-head record come from the DB; display fields (name, flag) come from
 * the static dataset. Entities missing from the dataset are dropped so the board
 * never half-renders.
 */
export async function getRankings(arena = 'football'): Promise<RankingRow[]> {
  const rows = await db
    .select({
      id: entities.id,
      votes: entities.votes,
      votesFor: entities.votesFor,
      votesAgainst: entities.votesAgainst,
    })
    .from(entities)
    .where(eq(entities.arena, arena))
    .orderBy(desc(entities.votes), desc(entities.votesFor));

  return rows
    .map((r) => {
      const entity = getEntityBySlug(r.id);
      if (!entity) return null;
      const headToHeadVotes = r.votesFor + r.votesAgainst;
      const winRate = headToHeadVotes > 0 ? Math.round((r.votesFor / headToHeadVotes) * 100) : 0;
      return { entity, votes: r.votes, votesFor: r.votesFor, votesAgainst: r.votesAgainst, headToHeadVotes, winRate };
    })
    .filter((r): r is Omit<RankingRow, 'rank'> => r !== null)
    .map((r, i) => ({ rank: i + 1, ...r }));
}

/**
 * A single goat's most-contested battles: the tightest live matchups it's part
 * of, votes-first. Mirrors the "closest" ordering used on the homepage. Only
 * battles that have real votes are returned, so a fresh goat yields an empty
 * list (the profile then shows an empty state).
 */
export async function getContestedBattlesForEntity(
  slug: string,
  limit = 6,
): Promise<BattleSummary[]> {
  const rows = await db
    .select({
      id: battles.id,
      entityA: battles.entityA,
      entityB: battles.entityB,
      votesA: battles.votesA,
      votesB: battles.votesB,
    })
    .from(battles)
    .where(or(eq(battles.entityA, slug), eq(battles.entityB, slug)));

  return rows
    .map(toSummary)
    .filter((s): s is BattleSummary => s !== null && s.total > 0)
    // Tightest contest first, then bigger sample as the tie-breaker.
    .sort((x, y) => x.margin - y.margin || y.total - x.total)
    .slice(0, limit);
}

/** Live tally for a single battle, used by the results/vote API endpoints. */
export async function getBattleSummary(slug: string): Promise<BattleSummary | null> {
  const [row] = await db
    .select({
      id: battles.id,
      entityA: battles.entityA,
      entityB: battles.entityB,
      votesA: battles.votesA,
      votesB: battles.votesB,
    })
    .from(battles)
    .where(sql`${battles.id} = ${slug}`)
    .limit(1);

  return row ? toSummary(row) : null;
}
