import { sql, gt, eq, or, desc } from 'drizzle-orm';
import { db } from './db';
import { battles, votes, entities, comments, user } from './db/schema';
import { getEntityBySlug, arenas } from '../data';
import { parseBattleSlug } from './battle';
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
 * Every goat across all arenas, ranked by ranking votes (global rank) — powers
 * the filterable Goats directory (design §8 / 3c). Same vote/win-rate semantics
 * as {@link getRankings}, just without the per-arena filter.
 */
export async function getAllGoatsRanked(): Promise<RankingRow[]> {
  const rows = await db
    .select({
      id: entities.id,
      votes: entities.votes,
      votesFor: entities.votesFor,
      votesAgainst: entities.votesAgainst,
    })
    .from(entities)
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
 * A goat's complete head-to-head record: every 1v1 matchup it's part of that has
 * real votes, most-contested (highest total) first. Unlike the leaderboard's
 * aggregate win-rate, this preserves the per-opponent split so the profile and
 * rankings popover can show who a goat beats and by how much. A fresh goat with
 * no voted matchups yields an empty list (callers render an empty state).
 */
export async function getHeadToHeadRecordForEntity(
  slug: string,
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
    // Most-contested first, then tightest margin as the tie-breaker.
    .sort((x, y) => y.total - x.total || x.margin - y.margin);
}

/**
 * A single "take" for The Floor — a battle comment enriched with its author and
 * the two combatants it's arguing over. The Floor is a read-only aggregation of
 * existing battle comments across every matchup (design §5 / 3a). The Team/side
 * tag and official match threads arrive later with the matches API; for now each
 * take carries its arena and the two sides so the UI can render the design.
 */
export interface FloorTake {
  id: number;
  battleId: string;
  body: string;
  upvotes: number;
  username: string | null;
  createdAt: Date;
  arena: string;
  a: Entity;
  b: Entity;
}

/**
 * Recent non-deleted takes across every battle, newest first — the global floor
 * stream. Enriches each row with its author handle and both combatants (parsed
 * from the canonical battle slug); rows whose slug can't resolve are dropped.
 */
export async function getRecentTakes(limit = 20): Promise<FloorTake[]> {
  const rows = await db
    .select({
      id: comments.id,
      battleId: comments.battleId,
      body: comments.body,
      upvotes: comments.upvotes,
      createdAt: comments.createdAt,
      username: user.username,
    })
    .from(comments)
    .innerJoin(user, eq(comments.userId, user.id))
    .where(eq(comments.deleted, false))
    .orderBy(desc(comments.createdAt))
    .limit(limit);

  return rows
    .map((row): FloorTake | null => {
      const parsed = parseBattleSlug(row.battleId);
      if (!parsed) return null;
      const a = getEntityBySlug(parsed[0]);
      const b = getEntityBySlug(parsed[1]);
      if (!a || !b) return null;
      return { ...row, arena: a.arena, a, b };
    })
    .filter((t): t is FloorTake => t !== null);
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
