import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from './db';
import { votes, entities, voteWindows } from './db/schema';
import { VOTE_VALUES, WINDOW_HOURS, type VoteChannel } from './votes';
import { getBattleSummary, type BattleSummary } from './queries';

// ─── Head-to-head votes (1v1 battle pages + Champion Mode bouts) ──────────────

export type VoteOutcome =
  | { status: 'not_found' }
  | { status: 'bad_choice' }
  | { status: 'ok'; alreadyVoted: boolean; summary: BattleSummary; votedChoice: string };

/**
 * Record a head-to-head vote and bump the matchup tally. Feeds the head-to-head
 * plane only — it never touches a GOAT's ranking `votes`. Voting requires login,
 * so dedup is a rolling {@link WINDOW_HOURS} window per (userId, battleId): if
 * this user voted this pairing within the window, the counts are left untouched.
 * `ipHash` is still stored as a secondary anti-abuse signal.
 *
 * The rolling-window claim, ledger insert, and all counter updates happen in one
 * PostgreSQL statement. This is atomic even through neon-http and prevents
 * parallel requests from awarding more than once.
 */
export async function recordHeadToHeadVote(
  battleId: string,
  choice: string,
  userId: string,
  ipHash: string,
  country: string | null,
): Promise<VoteOutcome> {
  const summary = await getBattleSummary(battleId);
  if (!summary) return { status: 'not_found' };

  const isA = choice === summary.a.id;
  const isB = choice === summary.b.id;
  if (!isA && !isB) return { status: 'bad_choice' };

  const loser = isA ? summary.b.id : summary.a.id;
  const claimResult = await db.execute(sql`
    WITH claimed AS (
      INSERT INTO head_vote_windows (user_id, battle_id, window_start, choice)
      VALUES (${userId}, ${battleId}, now(), ${choice})
      ON CONFLICT (user_id, battle_id) DO UPDATE
      SET window_start = excluded.window_start, choice = excluded.choice
      WHERE head_vote_windows.window_start <= now() - interval '${sql.raw(String(WINDOW_HOURS))} hours'
      RETURNING 1
    ), ledger AS (
      INSERT INTO votes (battle_id, choice, user_id, ip_hash, country)
      SELECT ${battleId}, ${choice}, ${userId}, ${ipHash}, ${country}
      FROM claimed
    ), battle_update AS (
      UPDATE battles
      SET votes_a = votes_a + CASE WHEN entity_a = ${choice} THEN 1 ELSE 0 END,
          votes_b = votes_b + CASE WHEN entity_b = ${choice} THEN 1 ELSE 0 END
      WHERE id = ${battleId} AND EXISTS (SELECT 1 FROM claimed)
    ), winner_update AS (
      UPDATE entities SET votes_for = votes_for + 1
      WHERE id = ${choice} AND EXISTS (SELECT 1 FROM claimed)
    ), loser_update AS (
      UPDATE entities SET votes_against = votes_against + 1
      WHERE id = ${loser} AND EXISTS (SELECT 1 FROM claimed)
    )
    SELECT EXISTS (SELECT 1 FROM claimed) AS awarded
  `);
  const claim = (claimResult as unknown as {
    rows: Array<{ awarded: boolean }>;
  }).rows[0];
  const alreadyVoted = !claim?.awarded;

  const fresh = (await getBattleSummary(battleId)) ?? summary;
  return { status: 'ok', alreadyVoted, summary: fresh, votedChoice: choice };
}

export interface VoteState {
  summary: BattleSummary;
  /** The entity this user voted for in this matchup's window, or null. */
  votedChoice: string | null;
}

/**
 * Current tallies for a battle plus this user's recent vote (if any). `userId`
 * is null for logged-out viewers → `votedChoice` is null (nothing voted).
 */
export async function getVoteState(
  battleId: string,
  userId: string | null,
): Promise<VoteState | null> {
  const summary = await getBattleSummary(battleId);
  if (!summary) return null;
  if (!userId) return { summary, votedChoice: null };

  const [row] = await db
    .select({ choice: votes.choice })
    .from(votes)
    .where(
      and(
        eq(votes.battleId, battleId),
        eq(votes.userId, userId),
        gt(votes.createdAt, sql`now() - interval '${sql.raw(String(WINDOW_HOURS))} hours'`),
      ),
    )
    .orderBy(sql`${votes.createdAt} desc`)
    .limit(1);

  return { summary, votedChoice: row?.choice ?? null };
}

// ─── Ranking votes (profile "Vote X" +1, Champion Mode crown +5) ──────────────

export type RankingVoteStatus = 'awarded' | 'already_used' | 'unknown_entity';

export interface RankingVoteState {
  /** Whether the profile +1 has fired in the current window. */
  profileUsed: boolean;
  /** Whether the champion +5 crown has fired in the current window. */
  championUsed: boolean;
  /** ISO timestamp the shared window resets (both channels free again), or null. */
  windowResetsAt: string | null;
}

export interface RankingVoteResult extends RankingVoteState {
  status: RankingVoteStatus;
  /** Votes awarded this call (0 when not awarded). */
  awarded: number;
  /** The entity's new ranking total (unchanged when not awarded). */
  total: number;
}

/**
 * Cast a ranking vote for a GOAT through one channel. Enforces a shared rolling
 * window per (userId, entity): the window opens on the user's first ranking vote
 * for that GOAT and each channel may fire once inside it. `profile` adds +1,
 * `champion` adds +5. Both channels reset together when the window expires.
 * `ipHash` is stored as a secondary anti-abuse signal.
 */
export async function recordRankingVote(
  entityId: string,
  channel: VoteChannel,
  userId: string,
  ipHash: string | null = null,
): Promise<RankingVoteResult> {
  const [entity] = await db
    .select({ votes: entities.votes })
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1);
  if (!entity) {
    return { status: 'unknown_entity', awarded: 0, total: 0, profileUsed: false, championUsed: false, windowResetsAt: null };
  }

  const value = VOTE_VALUES[channel];
  const profileUsedInput = channel === 'profile';
  const championUsedInput = channel === 'champion';
  const result = await db.execute(sql`
    WITH claimed AS (
      INSERT INTO vote_windows
        (user_id, entity_id, ip_hash, window_start, profile_used, champion_used)
      VALUES
        (${userId}, ${entityId}, ${ipHash}, now(), ${profileUsedInput}, ${championUsedInput})
      ON CONFLICT (user_id, entity_id) DO UPDATE
      SET window_start = CASE
            WHEN vote_windows.window_start <= now() - interval '${sql.raw(String(WINDOW_HOURS))} hours'
              THEN excluded.window_start
            ELSE vote_windows.window_start
          END,
          profile_used = CASE
            WHEN vote_windows.window_start <= now() - interval '${sql.raw(String(WINDOW_HOURS))} hours'
              THEN excluded.profile_used
            ELSE vote_windows.profile_used OR excluded.profile_used
          END,
          champion_used = CASE
            WHEN vote_windows.window_start <= now() - interval '${sql.raw(String(WINDOW_HOURS))} hours'
              THEN excluded.champion_used
            ELSE vote_windows.champion_used OR excluded.champion_used
          END,
          ip_hash = excluded.ip_hash
      WHERE vote_windows.window_start <= now() - interval '${sql.raw(String(WINDOW_HOURS))} hours'
         OR (${channel} = 'profile' AND vote_windows.profile_used = false)
         OR (${channel} = 'champion' AND vote_windows.champion_used = false)
      RETURNING window_start, profile_used, champion_used
    ), updated AS (
      UPDATE entities SET votes = votes + ${value}
      WHERE id = ${entityId} AND EXISTS (SELECT 1 FROM claimed)
      RETURNING votes
    )
    SELECT claimed.window_start AS "windowStart",
           claimed.profile_used AS "profileUsed",
           claimed.champion_used AS "championUsed",
           updated.votes AS total
    FROM claimed CROSS JOIN updated
  `);
  const awarded = (result as unknown as {
    rows: Array<{
      windowStart: Date;
      profileUsed: boolean;
      championUsed: boolean;
      total: number;
    }>;
  }).rows[0];

  if (!awarded) {
    const state = await getRankingVoteState(entityId, userId);
    const [fresh] = await db
      .select({ votes: entities.votes })
      .from(entities)
      .where(eq(entities.id, entityId))
      .limit(1);
    return { status: 'already_used', awarded: 0, total: fresh?.votes ?? entity.votes, ...state };
  }

  return {
    status: 'awarded',
    awarded: value,
    total: awarded.total,
    profileUsed: awarded.profileUsed,
    championUsed: awarded.championUsed,
    windowResetsAt: resetsAt(new Date(awarded.windowStart)),
  };
}

/**
 * Read the ranking-vote window state for one GOAT (for button hydration).
 * `userId` is null for logged-out viewers → a neutral (nothing used) state.
 */
export async function getRankingVoteState(
  entityId: string,
  userId: string | null,
): Promise<RankingVoteState> {
  if (!userId) return { profileUsed: false, championUsed: false, windowResetsAt: null };

  const [win] = await db
    .select({
      profileUsed: voteWindows.profileUsed,
      championUsed: voteWindows.championUsed,
      windowStart: voteWindows.windowStart,
      active: sql<boolean>`${voteWindows.windowStart} > now() - interval '${sql.raw(String(WINDOW_HOURS))} hours'`,
    })
    .from(voteWindows)
    .where(and(eq(voteWindows.userId, userId), eq(voteWindows.entityId, entityId)))
    .limit(1);

  if (!win?.active) return { profileUsed: false, championUsed: false, windowResetsAt: null };
  return {
    profileUsed: win.profileUsed,
    championUsed: win.championUsed,
    windowResetsAt: resetsAt(win.windowStart),
  };
}

/**
 * Entity ids this user has crowned within the live window — excluded from their
 * next ranked Champion Mode run. Scoped to one arena. Empty for logged-out users.
 */
export async function getLockedEntities(arena: string, userId: string | null): Promise<string[]> {
  if (!userId) return [];
  const rows = await db
    .select({ entityId: voteWindows.entityId })
    .from(voteWindows)
    .innerJoin(entities, eq(entities.id, voteWindows.entityId))
    .where(
      and(
        eq(voteWindows.userId, userId),
        eq(voteWindows.championUsed, true),
        eq(entities.arena, arena),
        gt(voteWindows.windowStart, sql`now() - interval '${sql.raw(String(WINDOW_HOURS))} hours'`),
      ),
    );
  return rows.map((r) => r.entityId);
}

/** When a window anchored at `start` resets, as an ISO string. */
function resetsAt(start: Date): string {
  return new Date(start.getTime() + WINDOW_HOURS * 3600_000).toISOString();
}
