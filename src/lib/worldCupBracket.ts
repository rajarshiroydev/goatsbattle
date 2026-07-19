export interface WorldCupKnockoutMatch {
  id: string;
  status: string;
  homeTeam: string;
  awayTeam: string;
  homeCode: string | null;
  awayCode: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homePenaltyScore?: number | null;
  awayPenaltyScore?: number | null;
}

interface DatedWorldCupMatch extends WorldCupKnockoutMatch {
  lastSyncedAt: Date | null;
}

/** Prefer a newer database row, but do not let an older provider snapshot
 * regress a validated static fallback during client hydration. */
export function applyWorldCupFallbackSnapshot<T extends DatedWorldCupMatch>(
  matches: readonly T[],
  fallback: readonly WorldCupKnockoutMatch[],
  validatedAt: string,
): T[] {
  const fallbackById = new Map(fallback.map((match) => [match.id, match]));
  const validatedAtMs = Date.parse(validatedAt);
  return matches.map((match) => {
    const known = fallbackById.get(match.id);
    const syncedAtMs = match.lastSyncedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (!known || !Number.isFinite(validatedAtMs) || syncedAtMs >= validatedAtMs) return match;
    return {
      ...match,
      status: known.status,
      homeTeam: known.homeTeam,
      awayTeam: known.awayTeam,
      homeCode: known.homeCode,
      awayCode: known.awayCode,
      homeScore: known.homeScore,
      awayScore: known.awayScore,
      homePenaltyScore: known.homePenaltyScore ?? null,
      awayPenaltyScore: known.awayPenaltyScore ?? null,
    };
  });
}

interface ResolvedTeam {
  name: string;
  code: string | null;
}

function outcomeTeam(
  match: WorldCupKnockoutMatch | undefined,
  outcome: 'winner' | 'loser',
): ResolvedTeam | null {
  if (!match || match.status !== 'finished'
    || match.homeScore === null || match.awayScore === null) return null;
  let homeWon: boolean;
  if (match.homeScore !== match.awayScore) {
    homeWon = match.homeScore > match.awayScore;
  } else if (match.homePenaltyScore !== null && match.homePenaltyScore !== undefined
    && match.awayPenaltyScore !== null && match.awayPenaltyScore !== undefined
    && match.homePenaltyScore !== match.awayPenaltyScore) {
    homeWon = match.homePenaltyScore > match.awayPenaltyScore;
  } else {
    return null;
  }
  const useHome = outcome === 'winner' ? homeWon : !homeWon;
  return useHome
    ? { name: match.homeTeam, code: match.homeCode }
    : { name: match.awayTeam, code: match.awayCode };
}

/** Resolve the bronze and final participants from the canonical semi-final
 * results. This keeps reader-facing labels current even before an external
 * provider replaces its W101/L101 placeholder identities. */
export function resolveWorldCupKnockoutTeams<T extends WorldCupKnockoutMatch>(
  matches: readonly T[],
): T[] {
  const byId = new Map(matches.map((match) => [match.id, match]));
  const semi101 = byId.get('world-cup-2026-match-101');
  const semi102 = byId.get('world-cup-2026-match-102');
  const bronzeHome = outcomeTeam(semi101, 'loser');
  const bronzeAway = outcomeTeam(semi102, 'loser');
  const finalHome = outcomeTeam(semi101, 'winner');
  const finalAway = outcomeTeam(semi102, 'winner');

  return matches.map((match) => {
    const home = match.id === 'world-cup-2026-match-103' ? bronzeHome
      : match.id === 'world-cup-2026-match-104' ? finalHome : null;
    const away = match.id === 'world-cup-2026-match-103' ? bronzeAway
      : match.id === 'world-cup-2026-match-104' ? finalAway : null;
    if (!home && !away) return match;
    return {
      ...match,
      homeTeam: home?.name ?? match.homeTeam,
      homeCode: home?.code ?? match.homeCode,
      awayTeam: away?.name ?? match.awayTeam,
      awayCode: away?.code ?? match.awayCode,
    };
  });
}
