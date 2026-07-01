import { sql, gt, eq, desc } from 'drizzle-orm';
import { db } from './db';
import { battles, votes, entities } from './db/schema';
import { getEntityBySlug } from '../data/football';
import type { Entity } from './types';

/**
 * A battle enriched with live vote tallies (from the DB) and the static entity
 * display data (from src/data). The display content lives in code; only the
 * mutable counts come from Postgres. See [[project-goatsbattle]] architecture.
 */
export interface BattleSummary {
  slug: string;
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

  return { trending, mostVoted, closest, totalVotes: totals?.total ?? 0 };
}

/** Every battle, enriched and sorted by total votes (then featured order). */
export async function getAllBattleSummaries(): Promise<BattleSummary[]> {
  const rows = await db
    .select({
      id: battles.id,
      entityA: battles.entityA,
      entityB: battles.entityB,
      votesA: battles.votesA,
      votesB: battles.votesB,
    })
    .from(battles);

  return rows
    .map(toSummary)
    .filter((s): s is BattleSummary => s !== null)
    .sort(
      (x, y) => y.total - x.total || featuredRank(x.slug) - featuredRank(y.slug),
    );
}

/** One row of the Elo leaderboard: static display data + live rating/record. */
export interface RankingRow {
  rank: number;
  entity: Entity;
  elo: number;
  votesFor: number;
  votesAgainst: number;
  totalVotes: number;
  /** Share of head-to-head votes won, 0–100 (0 when the entity has no votes). */
  winRate: number;
}

/**
 * The Elo leaderboard for a category, highest-rated first. Ratings and records
 * come from the DB; display fields (name, flag) come from the static dataset.
 * Entities missing from the dataset are dropped so the board never half-renders.
 */
export async function getRankings(category = 'football'): Promise<RankingRow[]> {
  const rows = await db
    .select({
      id: entities.id,
      elo: entities.elo,
      votesFor: entities.votesFor,
      votesAgainst: entities.votesAgainst,
    })
    .from(entities)
    .where(eq(entities.category, category))
    .orderBy(desc(entities.elo), desc(entities.votesFor));

  return rows
    .map((r) => {
      const entity = getEntityBySlug(r.id);
      if (!entity) return null;
      const totalVotes = r.votesFor + r.votesAgainst;
      const winRate = totalVotes > 0 ? Math.round((r.votesFor / totalVotes) * 100) : 0;
      return { entity, elo: r.elo, votesFor: r.votesFor, votesAgainst: r.votesAgainst, totalVotes, winRate };
    })
    .filter((r): r is Omit<RankingRow, 'rank'> => r !== null)
    .map((r, i) => ({ rank: i + 1, ...r }));
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
