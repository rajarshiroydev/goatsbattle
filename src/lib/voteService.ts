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
 * plane only — it never touches a GOAT's ranking `votes`. Dedup is a rolling
 * {@link WINDOW_HOURS} window per (ipHash, battleId): if this fingerprint voted
 * this pairing within the window, the counts are left untouched.
 *
 * neon-http has no transactions, so this is a check-then-write; the small race
 * (two simultaneous votes from one fingerprint) is acceptable at this scale.
 */
export async function recordHeadToHeadVote(
  battleId: string,
  choice: string,
  ipHash: string,
  country: string | null,
): Promise<VoteOutcome> {
  const summary = await getBattleSummary(battleId);
  if (!summary) return { status: 'not_found' };

  const isA = choice === summary.a.id;
  const isB = choice === summary.b.id;
  if (!isA && !isB) return { status: 'bad_choice' };

  const alreadyVoted = await hasRecentHeadToHeadVote(battleId, ipHash);

  if (!alreadyVoted) {
    const loser = isA ? summary.b.id : summary.a.id;
    const battleBump = isA ? sql`votes_a = votes_a + 1` : sql`votes_b = votes_b + 1`;

    // Record the ledger row, bump the matchup tally, and update the two
    // head-to-head aggregates (wins/losses) used for the win-rate display.
    await db.insert(votes).values({ battleId, choice, ipHash, country });
    await db.execute(sql`
      WITH ub AS (
        UPDATE battles SET ${battleBump} WHERE id = ${battleId}
      ),
      uw AS (
        UPDATE entities SET votes_for = votes_for + 1 WHERE id = ${choice}
      )
      UPDATE entities SET votes_against = votes_against + 1 WHERE id = ${loser}
    `);
  }

  const fresh = (await getBattleSummary(battleId)) ?? summary;
  return { status: 'ok', alreadyVoted, summary: fresh, votedChoice: choice };
}

/** Whether this fingerprint voted this pairing within the rolling window. */
async function hasRecentHeadToHeadVote(battleId: string, ipHash: string): Promise<boolean> {
  const [row] = await db
    .select({ id: votes.id })
    .from(votes)
    .where(
      and(
        eq(votes.battleId, battleId),
        eq(votes.ipHash, ipHash),
        gt(votes.createdAt, sql`now() - interval '${sql.raw(String(WINDOW_HOURS))} hours'`),
      ),
    )
    .limit(1);
  return !!row;
}

export interface VoteState {
  summary: BattleSummary;
  /** The entity this fingerprint voted for in this matchup's window, or null. */
  votedChoice: string | null;
}

/** Current tallies for a battle plus this fingerprint's recent vote (if any). */
export async function getVoteState(battleId: string, ipHash: string): Promise<VoteState | null> {
  const summary = await getBattleSummary(battleId);
  if (!summary) return null;

  const [row] = await db
    .select({ choice: votes.choice })
    .from(votes)
    .where(
      and(
        eq(votes.battleId, battleId),
        eq(votes.ipHash, ipHash),
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
 * window per (ipHash, entity): the window opens on the user's first ranking vote
 * for that GOAT and each channel may fire once inside it. `profile` adds +1,
 * `champion` adds +5. Both channels reset together when the window expires.
 */
export async function recordRankingVote(
  entityId: string,
  channel: VoteChannel,
  ipHash: string,
): Promise<RankingVoteResult> {
  const [entity] = await db
    .select({ votes: entities.votes })
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1);
  if (!entity) {
    return { status: 'unknown_entity', awarded: 0, total: 0, profileUsed: false, championUsed: false, windowResetsAt: null };
  }

  const [win] = await db
    .select({
      profileUsed: voteWindows.profileUsed,
      championUsed: voteWindows.championUsed,
      windowStart: voteWindows.windowStart,
      active: sql<boolean>`${voteWindows.windowStart} > now() - interval '${sql.raw(String(WINDOW_HOURS))} hours'`,
    })
    .from(voteWindows)
    .where(and(eq(voteWindows.ipHash, ipHash), eq(voteWindows.entityId, entityId)))
    .limit(1);

  const active = !!win?.active;
  const usedField = channel === 'profile' ? 'profileUsed' : 'championUsed';

  // Already spent this channel in the live window → reject.
  if (active && win?.[usedField]) {
    return {
      status: 'already_used',
      awarded: 0,
      total: entity.votes,
      profileUsed: win.profileUsed,
      championUsed: win.championUsed,
      windowResetsAt: resetsAt(win.windowStart),
    };
  }

  const value = VOTE_VALUES[channel];
  const profileUsed = channel === 'profile' ? true : active ? !!win?.profileUsed : false;
  const championUsed = channel === 'champion' ? true : active ? !!win?.championUsed : false;
  // Keep the anchor when extending a live window; reset it when opening a new one.
  const windowStart = active && win ? win.windowStart : new Date();

  await db
    .insert(voteWindows)
    .values({ ipHash, entityId, windowStart, profileUsed, championUsed })
    .onConflictDoUpdate({
      target: [voteWindows.ipHash, voteWindows.entityId],
      set: { windowStart, profileUsed, championUsed },
    });

  const [updated] = await db
    .update(entities)
    .set({ votes: sql`${entities.votes} + ${value}` })
    .where(eq(entities.id, entityId))
    .returning({ votes: entities.votes });

  return {
    status: 'awarded',
    awarded: value,
    total: updated?.votes ?? entity.votes + value,
    profileUsed,
    championUsed,
    windowResetsAt: resetsAt(windowStart),
  };
}

/** Read the ranking-vote window state for one GOAT (for button hydration). */
export async function getRankingVoteState(entityId: string, ipHash: string): Promise<RankingVoteState> {
  const [win] = await db
    .select({
      profileUsed: voteWindows.profileUsed,
      championUsed: voteWindows.championUsed,
      windowStart: voteWindows.windowStart,
      active: sql<boolean>`${voteWindows.windowStart} > now() - interval '${sql.raw(String(WINDOW_HOURS))} hours'`,
    })
    .from(voteWindows)
    .where(and(eq(voteWindows.ipHash, ipHash), eq(voteWindows.entityId, entityId)))
    .limit(1);

  if (!win?.active) return { profileUsed: false, championUsed: false, windowResetsAt: null };
  return {
    profileUsed: win.profileUsed,
    championUsed: win.championUsed,
    windowResetsAt: resetsAt(win.windowStart),
  };
}

/**
 * Entity ids this fingerprint has crowned within the live window — excluded from
 * their next ranked Champion Mode run. Scoped to one arena.
 */
export async function getLockedEntities(category: string, ipHash: string): Promise<string[]> {
  const rows = await db
    .select({ entityId: voteWindows.entityId })
    .from(voteWindows)
    .innerJoin(entities, eq(entities.id, voteWindows.entityId))
    .where(
      and(
        eq(voteWindows.ipHash, ipHash),
        eq(voteWindows.championUsed, true),
        eq(entities.category, category),
        gt(voteWindows.windowStart, sql`now() - interval '${sql.raw(String(WINDOW_HOURS))} hours'`),
      ),
    );
  return rows.map((r) => r.entityId);
}

/** When a window anchored at `start` resets, as an ISO string. */
function resetsAt(start: Date): string {
  return new Date(start.getTime() + WINDOW_HOURS * 3600_000).toISOString();
}
