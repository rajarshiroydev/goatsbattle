import { sql, type SQL } from 'drizzle-orm';

/**
 * Elo rating engine. Every vote is treated as a 1v1 "match" the chosen entity
 * wins against its opponent. Ratings are seeded at 1500 (see schema default) and
 * move by a fixed K-factor. Both entry points — direct battles and Champion Mode
 * — flow through the same vote API, so they feed one shared rating per entity.
 *
 * The rating update runs inside the vote write-path's atomic CTE (no read-then-
 * write race), so the formula lives here as a SQL-expression builder rather than
 * as plain arithmetic — that keeps a single source of truth for the math.
 * See [[project-goatsbattle]].
 */

/** Default K-factor. Higher = ratings react faster to each result. */
export const DEFAULT_K = 32;

/** Rating every entity starts at before any votes. */
export const SEED_ELO = 1500;

/**
 * SQL expression for the points the winner gains (and the loser loses) when the
 * entity rated `winnerElo` beats the one rated `loserElo`: the standard
 * `round(K · (1 − expected(winner)))`. The exchange is zero-sum, so the loser
 * moves by the negation of this value.
 *
 * `winnerElo`/`loserElo` are SQL fragments for the two rating columns (e.g.
 * `sql`w.elo``), letting the caller apply the delta additively in one statement.
 */
export function eloDeltaSql(winnerElo: SQL, loserElo: SQL, k = DEFAULT_K): SQL {
  return sql`round(${k}::numeric * (1 - 1.0 / (1 + power(10, ((${loserElo}) - (${winnerElo})) / 400.0))))::int`;
}
