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
  const leader: ContestedBattle['leader'] =
    s.leader === 'tie' ? 'tie' : (s.leader === 'a') === goatIsA ? 'goat' : 'opponent';

  return {
    battleSlug: s.slug,
    opponentShortName: opp.shortName,
    opponentNationality: opp.nationality,
    opponentAccent: opp.accent,
    goatPct,
    opponentPct: 100 - goatPct,
    total: s.total,
    leader,
  };
}
