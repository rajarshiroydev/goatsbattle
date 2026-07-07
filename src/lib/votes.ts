/**
 * Vote model constants — the single source of truth for the "Votes" system that
 * replaced Elo. A GOAT's rank is driven purely by its total `votes`.
 *
 * Ranking votes come from two channels:
 *  - `profile` — the "Vote <GOAT>" button on a profile page (+1)
 *  - `champion` — being crowned the winner of a Champion Mode run (+5)
 *
 * Each channel may fire once per GOAT per rolling window, per fingerprint. The
 * window is shared across channels and anchored to the first ranking vote a user
 * casts for that GOAT (see vote_windows in the schema + recordRankingVote).
 */

export type VoteChannel = 'profile' | 'champion';

/** Votes awarded per ranking channel. Champion crowns are worth more than a click. */
export const VOTE_VALUES: Record<VoteChannel, number> = {
  profile: 1,
  champion: 5,
};

/** Length of the per-(user, GOAT) voting window, in hours. */
export const WINDOW_HOURS = 24;
