import type { RankingRow } from './queries';

/** Lean per-entity ranking row returned by /api/rankings (also the public SaaS shape). */
export interface RankEntry {
  rank: number;
  id: string;
  name: string;
  shortName: string;
  countryCode: string;
  nationality: string;
  /** Ranking total — the number users see. */
  votes: number;
  /** Head-to-head record (separate from the ranking). */
  votesFor: number;
  votesAgainst: number;
  headToHeadVotes: number;
  winRate: number;
}

export function toRankEntry(r: RankingRow): RankEntry {
  return {
    rank: r.rank,
    id: r.entity.id,
    name: r.entity.name,
    shortName: r.entity.shortName,
    countryCode: r.entity.countryCode,
    nationality: r.entity.nationality,
    votes: r.votes,
    votesFor: r.votesFor,
    votesAgainst: r.votesAgainst,
    headToHeadVotes: r.headToHeadVotes,
    winRate: r.winRate,
  };
}
