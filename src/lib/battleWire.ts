import type { BattleSummary } from './queries';

/**
 * A contested battle oriented around one goat, returned by /api/goat-battles.
 * Percentages and the leader are framed from the profile goat's perspective, so
 * the client can render a split bar without re-deriving which side is which.
 * Only the opponent's display fields travel — the goat's own are already on the
 * profile page.
 */
export interface ContestedBattle {
  battleSlug: string;
  opponentShortName: string;
  opponentNationality: string;
  opponentAccent: string;
  /** Raw head-to-head votes for the profile goat in this matchup. */
  goatVotes: number;
  /** Raw head-to-head votes for the opponent in this matchup. */
  opponentVotes: number;
  /** Vote share for the profile goat, 0–100. */
  goatPct: number;
  opponentPct: number;
  total: number;
  leader: 'goat' | 'opponent' | 'tie';
}

export function toContestedBattle(s: BattleSummary, goatSlug: string): ContestedBattle {
  const goatIsA = s.a.slug === goatSlug;
  const opp = goatIsA ? s.b : s.a;
  const goatPct = goatIsA ? s.pctA : s.pctB;
  const goatVotes = goatIsA ? s.votesA : s.votesB;
  const leader: ContestedBattle['leader'] =
    s.leader === 'tie' ? 'tie' : (s.leader === 'a') === goatIsA ? 'goat' : 'opponent';

  return {
    battleSlug: s.slug,
    opponentShortName: opp.shortName,
    opponentNationality: opp.nationality,
    opponentAccent: opp.accent,
    goatVotes,
    opponentVotes: s.total - goatVotes,
    goatPct,
    opponentPct: 100 - goatPct,
    total: s.total,
    leader,
  };
}

/**
 * Split a goat's head-to-head record into wins / losses / ties from its own
 * perspective. Shared by the profile record section and the rankings popover so
 * the grouping logic lives in one place. Input order is preserved within groups.
 */
export interface GroupedRecord {
  leading: ContestedBattle[];
  trailing: ContestedBattle[];
  even: ContestedBattle[];
}

export function groupRecord(battles: ContestedBattle[]): GroupedRecord {
  const grouped: GroupedRecord = { leading: [], trailing: [], even: [] };
  for (const b of battles) {
    if (b.leader === 'goat') grouped.leading.push(b);
    else if (b.leader === 'opponent') grouped.trailing.push(b);
    else grouped.even.push(b);
  }
  return grouped;
}
