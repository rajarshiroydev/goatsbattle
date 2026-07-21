import { sql, eq, and, or, desc, inArray } from 'drizzle-orm';
import { db } from './db';
import {
  battles,
  voteWindows,
  entities,
  comments,
  matches,
  matchMoments,
  matchTimelineState,
  matchGoats,
} from './db/schema';
import { getEntityBySlug } from '../data';
import type { FloorFilter } from './floorFilters';
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

const battleColumns = {
  id: battles.id,
  entityA: battles.entityA,
  entityB: battles.entityB,
  votesA: battles.votesA,
  votesB: battles.votesB,
};

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
    .select(battleColumns)
    .from(battles)
    .where(or(eq(battles.entityA, slug), eq(battles.entityB, slug)));

  return rows
    .map(toSummary)
    .filter((s): s is BattleSummary => s !== null && s.total > 0)
    // Most-contested first, then tightest margin as the tie-breaker.
    .sort((x, y) => y.total - x.total || x.margin - y.margin);
}

/** Live tally for a single battle, used by the results/vote API endpoints. */
export async function getBattleSummary(slug: string): Promise<BattleSummary | null> {
  const [row] = await db
    .select(battleColumns)
    .from(battles)
    .where(sql`${battles.id} = ${slug}`)
    .limit(1);

  return row ? toSummary(row) : null;
}

/**
 * Live tallies for a known set of battles, in one round trip. The homepage
 * renders a static zero-tally shell (see `getStaticBattleSummaries`) and its
 * carousel island hydrates from this — so anonymous page views stay off the
 * database while the numbers on screen are still real.
 */
export async function getBattleSummaries(slugs: string[]): Promise<BattleSummary[]> {
  if (slugs.length === 0) return [];
  const rows = await db
    .select(battleColumns)
    .from(battles)
    .where(inArray(battles.id, slugs));

  return rows.map(toSummary).filter((s): s is BattleSummary => s !== null);
}

// ── The Floor: football match events ─────────────────────────────────────────

/** A goat that played in a match, enriched with its display data. */
export interface EventGoat {
  slug: string;
  shortName: string;
  accent: string;
  team: string | null;
}

/** One match as shown in the Floor list / previews. */
export interface FloorEvent {
  id: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  homeCode: string | null;
  awayCode: string | null;
  homeScore: number | null;
  awayScore: number | null;
  kickoff: Date;
  status: string; // scheduled | live | finished
  venue: string | null;
  commentCount: number;
  goats: EventGoat[];
}

/** Enrich a set of match ids with their participating goats (one query, no N+1). */
async function goatsForMatches(matchIds: string[]): Promise<Map<string, EventGoat[]>> {
  const map = new Map<string, EventGoat[]>();
  if (matchIds.length === 0) return map;

  const rows = await db
    .select({ matchId: matchGoats.matchId, goatSlug: matchGoats.goatSlug, team: matchGoats.team })
    .from(matchGoats)
    .where(or(...matchIds.map((id) => eq(matchGoats.matchId, id))));

  for (const r of rows) {
    const goat = getEntityBySlug(r.goatSlug);
    if (!goat) continue;
    const list = map.get(r.matchId) ?? [];
    list.push({ slug: goat.slug, shortName: goat.shortName, accent: goat.accent, team: r.team });
    map.set(r.matchId, list);
  }
  return map;
}

/**
 * Match events for The Floor. Filters (GBT-7):
 *  - `top`      → most-discussed first (comment count desc)
 *  - `recents`  → newest kickoff first
 *  - `live`     → status = 'live'
 *  - `mygoats`  → matches whose goats the viewer has voted for (needs `userId`;
 *                 returns [] when logged out — the UI prompts a login instead).
 * A future phase adds My-Goats sub-filters (commented / most-active / date).
 */
export async function getFloorEvents(opts: {
  filter: FloorFilter;
  userId?: string | null;
  limit?: number;
}): Promise<FloorEvent[]> {
  const { filter, userId = null, limit = 30 } = opts;

  // Count live (non-deleted) comments via a LEFT JOIN + GROUP BY on the match PK
  // (a correlated subquery in the select list shadows `id` to comments.id).
  const commentCount = sql<number>`count(${comments.id})::int`;

  // "My Goats" needs a signed-in viewer with at least one backed goat.
  if (filter === 'mygoats' && !userId) return [];

  const where =
    filter === 'live'
      ? eq(matches.status, 'live')
      : filter === 'mygoats'
        ? sql`EXISTS (
            SELECT 1 FROM ${matchGoats} mg
            JOIN ${voteWindows} vw ON vw.entity_id = mg.goat_slug
            WHERE mg.match_id = ${matches.id} AND vw.user_id = ${userId}
          )`
        : undefined;

  const orderBy =
    filter === 'recents' || filter === 'live'
      ? [desc(matches.kickoff)]
      : [desc(commentCount), desc(matches.kickoff)]; // top, mygoats

  const rows = await db
    .select({
      id: matches.id,
      competition: matches.competition,
      homeTeam: matches.homeTeam,
      awayTeam: matches.awayTeam,
      homeCode: matches.homeCode,
      awayCode: matches.awayCode,
      homeScore: matches.homeScore,
      awayScore: matches.awayScore,
      kickoff: matches.kickoff,
      status: matches.status,
      venue: matches.venue,
      commentCount,
    })
    .from(matches)
    .leftJoin(comments, and(eq(comments.matchId, matches.id), eq(comments.deleted, false)))
    .where(where)
    .groupBy(matches.id)
    .orderBy(...orderBy)
    .limit(limit);

  const goatMap = await goatsForMatches(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, goats: goatMap.get(r.id) ?? [] }));
}

/** One moment on a match's timeline, enriched with the goat's short name. */
export interface MatchMoment {
  id: number;
  minute: number;
  extra: number | null;
  type: string;
  team: string; // home | away
  playerName: string | null;
  goatSlug: string | null;
  goatShortName: string | null;
  detail: string | null;
  verificationStatus: 'active' | 'corrected';
}

export interface MatchMomentFeed {
  moments: MatchMoment[];
  matchStatus: string | null;
  fetchedAt: string | null;
  hasCorrections: boolean;
}

/** A match's moments, ordered along the timeline with live-feed freshness. */
export async function getMatchMomentFeed(
  matchId: string,
  includeProvisional = false,
): Promise<MatchMomentFeed> {
  const statuses = includeProvisional
    ? ['provisional', 'confirmed', 'retracted', 'superseded']
    : ['confirmed'];
  const rows = await db
    .select({
      matchStatus: matches.status,
      fetchedAt: matchTimelineState.fetchedAt,
      id: matchMoments.id,
      minute: matchMoments.minute,
      extra: matchMoments.extra,
      type: matchMoments.type,
      team: matchMoments.team,
      playerName: matchMoments.playerName,
      goatSlug: matchMoments.goatSlug,
      detail: matchMoments.detail,
      verificationStatus: matchMoments.verificationStatus,
    })
    .from(matches)
    .leftJoin(matchTimelineState, eq(matchTimelineState.matchId, matches.id))
    .leftJoin(matchMoments, and(
      eq(matchMoments.matchId, matches.id),
      inArray(matchMoments.verificationStatus, statuses),
    ))
    .where(eq(matches.id, matchId))
    .orderBy(
      sql`${matchMoments.minute} ASC NULLS LAST`,
      sql`${matchMoments.extra} ASC NULLS FIRST`,
      sql`${matchMoments.providerSequence} ASC NULLS LAST`,
    );

  const moments: MatchMoment[] = rows
    .filter((row): row is typeof row & { id: number; minute: number; type: string; team: string; verificationStatus: string } =>
      row.id !== null && row.minute !== null && row.type !== null
      && row.team !== null && row.verificationStatus !== null)
    .map(({ matchStatus: _matchStatus, fetchedAt: _fetchedAt, ...row }) => ({
      ...row,
      verificationStatus: row.verificationStatus === 'retracted' || row.verificationStatus === 'superseded'
        ? 'corrected'
        : 'active',
      goatShortName: row.goatSlug ? (getEntityBySlug(row.goatSlug)?.shortName ?? null) : null,
    }));
  const state = rows[0];
  return {
    moments,
    matchStatus: state?.matchStatus ?? null,
    fetchedAt: state?.fetchedAt ? new Date(state.fetchedAt).toISOString() : null,
    hasCorrections: moments.some((moment) => moment.verificationStatus === 'corrected'),
  };
}
