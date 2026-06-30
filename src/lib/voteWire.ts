import type { BattleSummary } from './queries';

/** JSON shape returned by /api/vote and /api/results and consumed by VoteWidget. */
export interface BattleResult {
  battleId: string;
  entityA: string;
  entityB: string;
  votesA: number;
  votesB: number;
  total: number;
  pctA: number;
  pctB: number;
  voted: boolean;
  votedChoice: string | null;
  /** True when the vote was a duplicate that didn't change the tally. */
  alreadyVoted?: boolean;
}

export function toResult(
  s: BattleSummary,
  opts: { voted: boolean; votedChoice: string | null; alreadyVoted?: boolean },
): BattleResult {
  return {
    battleId: s.slug,
    entityA: s.a.id,
    entityB: s.b.id,
    votesA: s.votesA,
    votesB: s.votesB,
    total: s.total,
    pctA: s.pctA,
    pctB: s.pctB,
    voted: opts.voted,
    votedChoice: opts.votedChoice,
    ...(opts.alreadyVoted !== undefined ? { alreadyVoted: opts.alreadyVoted } : {}),
  };
}
