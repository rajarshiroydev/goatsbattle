import type { RankingRow } from './queries';

/** Lean per-entity ranking row returned by /api/rankings (also the public SaaS shape). */
export interface RankEntry {
  rank: number;
  id: string;
  name: string;
  shortName: string;
  countryCode: string;
  nationality: string;
  elo: number;
  votesFor: number;
  votesAgainst: number;
  totalVotes: number;
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
    elo: r.elo,
    votesFor: r.votesFor,
    votesAgainst: r.votesAgainst,
    totalVotes: r.totalVotes,
    winRate: r.winRate,
  };
}
