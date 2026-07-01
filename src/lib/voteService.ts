import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { votes } from './db/schema';
import { eloDeltaSql } from './elo';
import { getBattleSummary, type BattleSummary } from './queries';

export type VoteOutcome =
  | { status: 'not_found' }
  | { status: 'bad_choice' }
  | { status: 'ok'; alreadyVoted: boolean; summary: BattleSummary; votedChoice: string };

/**
 * Record a vote and bump the affected tallies. The unique (ip_hash, battle_id)
 * index makes this idempotent per fingerprint: a repeat vote is detected via an
 * empty insert and the counts are left untouched. When the vote is fresh, one
 * atomic data-modifying CTE bumps the battle count, computes the Elo delta from
 * the two ratings, applies it to both entities, and appends the rating log — so
 * there is no read-then-write race and it costs a single round-trip.
 */
export async function recordVote(
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

  // voteDay defaults to CURRENT_DATE; the conflict target is the per-day unique
  // index, so a second vote on the same battle today is a no-op insert.
  const inserted = await db
    .insert(votes)
    .values({ battleId, choice, ipHash, country })
    .onConflictDoNothing({ target: [votes.ipHash, votes.battleId, votes.voteDay] })
    .returning({ id: votes.id });

  const alreadyVoted = inserted.length === 0;

  if (!alreadyVoted) {
    const winner = choice; // the entity that took this vote
    const loser = isA ? summary.b.id : summary.a.id;
    // Which battle column this vote increments (canonical A/B ordering).
    const battleBump = isA
      ? sql`votes_a = votes_a + 1`
      : sql`votes_b = votes_b + 1`;

    // One atomic statement. `d` reads both current ratings and the standard Elo
    // delta round(K·(1 − expected(winner))); both UPDATEs and the history insert
    // share that snapshot, so concurrent votes can't lose an update — the delta
    // is applied additively even if another vote lands first.
    //
    // Guarded for a partially-seeded DB: if a rating row is missing, `d` yields no
    // row (delta → NULL) and the matching UPDATE touches nothing. COALESCE keeps
    // the surviving side from writing NULL into a NOT NULL column, and the history
    // rows are driven off the UPDATE's RETURNING (`FROM uw`/`FROM ul`) so a missing
    // entity simply logs nothing rather than 500-ing the vote. The battle tally
    // (`ub`) always bumps regardless.
    await db.execute(sql`
      WITH d AS (
        SELECT ${eloDeltaSql(sql`w.elo`, sql`l.elo`)} AS delta
        FROM entities w, entities l
        WHERE w.id = ${winner} AND l.id = ${loser}
      ),
      ub AS (
        UPDATE battles SET ${battleBump} WHERE id = ${battleId}
      ),
      uw AS (
        UPDATE entities
        SET elo = elo + COALESCE((SELECT delta FROM d), 0), votes_for = votes_for + 1
        WHERE id = ${winner}
        RETURNING elo AS new_elo
      ),
      ul AS (
        UPDATE entities
        SET elo = elo - COALESCE((SELECT delta FROM d), 0), votes_against = votes_against + 1
        WHERE id = ${loser}
        RETURNING elo AS new_elo
      )
      INSERT INTO elo_history (entity_id, battle_id, elo, delta)
      SELECT ${winner}, ${battleId}, uw.new_elo, COALESCE((SELECT delta FROM d), 0) FROM uw
      UNION ALL
      SELECT ${loser}, ${battleId}, ul.new_elo, -COALESCE((SELECT delta FROM d), 0) FROM ul
    `);
  }

  const fresh = (await getBattleSummary(battleId)) ?? summary;
  return { status: 'ok', alreadyVoted, summary: fresh, votedChoice: choice };
}

export interface VoteState {
  summary: BattleSummary;
  /** The entity this fingerprint already voted for, or null. */
  votedChoice: string | null;
}

/** Current tallies for a battle plus whether this fingerprint already voted today. */
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
        eq(votes.voteDay, sql`CURRENT_DATE`),
      ),
    )
    .limit(1);

  return { summary, votedChoice: row?.choice ?? null };
}
