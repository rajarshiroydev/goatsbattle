/**
 * Elo rating engine. Every vote is treated as a 1v1 "match" the chosen entity
 * wins against its opponent. Ratings are seeded at 1500 (see schema default) and
 * move by a fixed K-factor. Both entry points — direct battles and Champion Mode
 * — flow through the same vote API, so they feed one shared rating per entity.
 * See [[project-goatsbattle]].
 */

/** Default K-factor. Higher = ratings react faster to each result. */
export const DEFAULT_K = 32;

/** Rating every entity starts at before any votes. */
export const SEED_ELO = 1500;

/**
 * Expected score for `ratingA` against `ratingB` — the probability (0–1) that A
 * is the "greater" per the logistic Elo curve. A 400-point gap ≈ 10:1 odds.
 */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export interface EloResult {
  /** Winner's new rating. */
  winnerElo: number;
  /** Loser's new rating. */
  loserElo: number;
  /** Points the winner gained (and the loser lost — the exchange is zero-sum). */
  delta: number;
}

/**
 * Apply one result where `winnerElo` beat `loserElo`. The delta is rounded once
 * and applied symmetrically so the pair's combined rating is conserved.
 */
export function computeElo(winnerElo: number, loserElo: number, k = DEFAULT_K): EloResult {
  const expected = expectedScore(winnerElo, loserElo);
  const delta = Math.round(k * (1 - expected));
  return {
    winnerElo: winnerElo + delta,
    loserElo: loserElo - delta,
    delta,
  };
}
