import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { battles, votes, entities } from './db/schema';
import { getBattleSummary, type BattleSummary } from './queries';

export type VoteOutcome =
  | { status: 'not_found' }
  | { status: 'bad_choice' }
  | { status: 'ok'; alreadyVoted: boolean; summary: BattleSummary; votedChoice: string };

/**
 * Record a vote and bump the affected tallies. The unique (ip_hash, battle_id)
 * index makes this idempotent per fingerprint: a repeat vote is detected via an
 * empty insert and the counts are left untouched. The counter updates run as a
 * single Neon batch so they apply together.
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

  const inserted = await db
    .insert(votes)
    .values({ battleId, choice, ipHash, country })
    .onConflictDoNothing({ target: [votes.ipHash, votes.battleId] })
    .returning({ id: votes.id });

  const alreadyVoted = inserted.length === 0;

  if (!alreadyVoted) {
    const opponent = isA ? summary.b.id : summary.a.id;
    await db.batch([
      db
        .update(battles)
        .set(isA ? { votesA: sql`${battles.votesA} + 1` } : { votesB: sql`${battles.votesB} + 1` })
        .where(eq(battles.id, battleId)),
      db
        .update(entities)
        .set({ votesFor: sql`${entities.votesFor} + 1` })
        .where(eq(entities.id, choice)),
      db
        .update(entities)
        .set({ votesAgainst: sql`${entities.votesAgainst} + 1` })
        .where(eq(entities.id, opponent)),
    ]);
  }

  const fresh = (await getBattleSummary(battleId)) ?? summary;
  return { status: 'ok', alreadyVoted, summary: fresh, votedChoice: choice };
}

export interface VoteState {
  summary: BattleSummary;
  /** The entity this fingerprint already voted for, or null. */
  votedChoice: string | null;
}

/** Current tallies for a battle plus whether this fingerprint already voted. */
export async function getVoteState(battleId: string, ipHash: string): Promise<VoteState | null> {
  const summary = await getBattleSummary(battleId);
  if (!summary) return null;

  const [row] = await db
    .select({ choice: votes.choice })
    .from(votes)
    .where(and(eq(votes.battleId, battleId), eq(votes.ipHash, ipHash)))
    .limit(1);

  return { summary, votedChoice: row?.choice ?? null };
}
