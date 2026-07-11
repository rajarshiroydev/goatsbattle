import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  timestamp,
  serial,
  boolean,
  index,
  primaryKey,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/**
 * Auth tables (better-auth). Column layout mirrors better-auth's expected
 * Postgres schema (see `getAuthTables`); the drizzle adapter maps by the
 * camelCase property keys, so the snake_case DB column names are cosmetic. The
 * `user` table adds one app field — `username` — populated on signup by a
 * `databaseHooks.user.create.before` in `src/lib/auth.ts` and surfaced on
 * `/users/[username]` + comment authorship.
 */
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  username: text('username').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Entities — the curated GOAT candidates. The canonical profile/stat content
 * lives in code (src/data), but mutable global state is stored here so it can
 * evolve with community voting.
 *
 * `votes` is the single ranking metric (the number users ever see). It is fed
 * only by ranking votes: profile "Vote <GOAT>" (+1) and Champion Mode crowns
 * (+5). `votesFor`/`votesAgainst` are a separate head-to-head aggregate (votes
 * won/lost across 1v1 matchups) used only for the head-to-head win-rate display
 * — they do NOT affect the ranking.
 */
export const entities = pgTable('entities', {
  id: text('id').primaryKey(), // slug, e.g. "messi"
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  arena: text('arena').notNull().default('football'),
  countryCode: text('country_code').notNull(),
  votes: integer('votes').notNull().default(0), // ranking total (profile +1, crown +5)
  votesFor: integer('votes_for').notNull().default(0), // head-to-head wins across battles
  votesAgainst: integer('votes_against').notNull().default(0), // head-to-head losses
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Battles — one row per canonical pairing. `entityA`/`entityB` are always
 * stored alphabetically sorted (entityA < entityB) so the id is deterministic.
 * `votesA`/`votesB` are the head-to-head tally for this matchup, fed by 1v1
 * battle-page votes and every Champion Mode bout.
 */
export const battles = pgTable('battles', {
  id: text('id').primaryKey(), // canonical slug, e.g. "messi-vs-ronaldo"
  entityA: text('entity_a').notNull().references(() => entities.id),
  entityB: text('entity_b').notNull().references(() => entities.id),
  arena: text('arena').notNull().default('football'),
  votesA: integer('votes_a').notNull().default(0),
  votesB: integer('votes_b').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Votes — the head-to-head vote ledger. One row per cast 1v1/bout vote. A
 * Voting now requires login, so dedup is keyed on `userId` — a rolling 24h
 * window per (userId, battleId), enforced by query against `createdAt` (no
 * static unique index, since the window rolls). `ipHash` (SHA-256 of ip + server
 * salt) is retained as a secondary anti-abuse signal. `userId` is nullable so
 * historic anonymous rows stay valid. `choice` stores the entity id voted for;
 * `country` comes from the Vercel geo header.
 */
export const votes = pgTable(
  'votes',
  {
    id: serial('id').primaryKey(),
    battleId: text('battle_id').notNull().references(() => battles.id),
    choice: text('choice').notNull(), // entity id voted for
    userId: text('user_id').references(() => user.id),
    ipHash: text('ip_hash').notNull(),
    country: text('country'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    battleIdx: index('votes_battle_idx').on(t.battleId),
    countryIdx: index('votes_country_idx').on(t.battleId, t.country),
    // Speeds up the rolling-window dedup lookup by user + battle.
    userBattleIdx: index('votes_user_battle_idx').on(t.userId, t.battleId),
    // Retained: secondary anti-abuse lookup by fingerprint + battle.
    ipBattleIdx: index('votes_ip_battle_idx').on(t.ipHash, t.battleId),
  })
);

/**
 * Vote windows — ranking-vote enforcement + Champion Mode lockout, per
 * (user, entity). `windowStart` anchors a shared 24h window opened by the user's
 * first ranking vote for that GOAT. `profileUsed`/`championUsed` mark which
 * channels have fired inside the current window; both reset together once the
 * window expires. A live `championUsed` also excludes that GOAT from the user's
 * next ranked Champion Mode run. `ipHash` is retained as a secondary signal.
 */
export const voteWindows = pgTable(
  'vote_windows',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    entityId: text('entity_id').notNull().references(() => entities.id),
    ipHash: text('ip_hash'),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
    profileUsed: boolean('profile_used').notNull().default(false),
    championUsed: boolean('champion_used').notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.entityId] }),
  })
);

/**
 * Matches — football events users discuss on The Floor. Unlike entities/battles
 * (curated content that lives in code), a match is dynamic external data, so it
 * lives entirely in Postgres. `externalId` holds the API-Football fixture id so
 * a future live-sync phase can upsert by it; today rows are hand-seeded (free
 * tier = 100 req/day — see scripts/seed-matches.ts). `homeCode`/`awayCode` are
 * ISO country codes used for flags/accents. `status` drives the Live filter.
 */
export const matches = pgTable(
  'matches',
  {
    id: text('id').primaryKey(), // readable slug, e.g. "argentina-vs-egypt-2026-06-15"
    externalId: text('external_id').unique(), // API-Football fixture id (future sync)
    arena: text('arena').notNull().default('football'),
    competition: text('competition').notNull(),
    homeTeam: text('home_team').notNull(),
    awayTeam: text('away_team').notNull(),
    homeCode: text('home_code'), // ISO country code
    awayCode: text('away_code'),
    homeScore: integer('home_score'),
    awayScore: integer('away_score'),
    kickoff: timestamp('kickoff', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('finished'), // scheduled | live | finished
    venue: text('venue'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('matches_status_idx').on(t.status),
    kickoffIdx: index('matches_kickoff_idx').on(t.kickoff),
  })
);

/**
 * Match moments — the visual timeline of a match. API-Football's free events
 * feed only supplies Goal/Card/Subst/VAR; richer types (`foul`, `handball` —
 * e.g. the Argentina-Egypt disallowed-goal build-up) are hand-seeded to show
 * the feature's intent. `goatSlug` links a moment to a tracked entity when the
 * player is one. Read-only in this phase; tagging arrives in a follow-up.
 */
export const matchMoments = pgTable(
  'match_moments',
  {
    id: serial('id').primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    minute: integer('minute').notNull(),
    extra: integer('extra'), // stoppage-time minute, e.g. 45+2 → minute 45, extra 2
    type: text('type').notNull(), // goal|penalty|own_goal|yellow_card|red_card|foul|handball|sub|var
    team: text('team').notNull(), // home | away
    playerName: text('player_name'),
    goatSlug: text('goat_slug').references(() => entities.id),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    matchIdx: index('match_moments_match_idx').on(t.matchId),
  })
);

/**
 * Match ↔ goat participation. Powers the goat tags on event cards and the "My
 * Goats" Floor filter (matches involving goats the viewer follows/voted for).
 */
export const matchGoats = pgTable(
  'match_goats',
  {
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    goatSlug: text('goat_slug')
      .notNull()
      .references(() => entities.id),
    team: text('team'), // home | away
  },
  (t) => ({
    pk: primaryKey({ columns: [t.matchId, t.goatSlug] }),
  })
);

/**
 * Comments — threaded discussion under a battle *or* a match. Adjacency list:
 * `parentId` is null for top-level comments, else points at the parent (self-ref,
 * typed with `AnyPgColumn` to break the circular reference). Soft-deleted
 * comments keep the row (so replies stay threaded) with `deleted=true`; the API
 * blanks the body. Exactly one of `battleId`/`matchId` is set (CHECK) — the
 * single seam that lets one comment stack serve both surfaces.
 */
export const comments = pgTable(
  'comments',
  {
    id: serial('id').primaryKey(),
    battleId: text('battle_id').references(() => battles.id),
    matchId: text('match_id').references(() => matches.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    parentId: integer('parent_id').references((): AnyPgColumn => comments.id),
    body: text('body').notNull(),
    upvotes: integer('upvotes').notNull().default(0),
    deleted: boolean('deleted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    battleIdx: index('comments_battle_idx').on(t.battleId),
    matchIdx: index('comments_match_idx').on(t.matchId),
    parentIdx: index('comments_parent_idx').on(t.parentId),
    // Exactly one subject: a comment belongs to a battle XOR a match.
    subjectCk: check(
      'comments_subject_ck',
      sql`(${t.battleId} IS NOT NULL)::int + (${t.matchId} IS NOT NULL)::int = 1`,
    ),
  })
);

/**
 * Comment upvotes — one row per (comment, user). Composite PK makes upvotes
 * idempotent (`onConflictDoNothing`) and lets the list query cheaply tell which
 * comments the viewer already upvoted.
 */
export const commentVotes = pgTable(
  'comment_votes',
  {
    commentId: integer('comment_id')
      .notNull()
      .references(() => comments.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.commentId, t.userId] }),
  })
);

export type EntityRow = typeof entities.$inferSelect;
export type BattleRow = typeof battles.$inferSelect;
export type VoteRow = typeof votes.$inferSelect;
export type VoteWindowRow = typeof voteWindows.$inferSelect;
export type UserRow = typeof user.$inferSelect;
export type SessionRow = typeof session.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type CommentVoteRow = typeof commentVotes.$inferSelect;
export type MatchRow = typeof matches.$inferSelect;
export type MatchMomentRow = typeof matchMoments.$inferSelect;
export type MatchGoatRow = typeof matchGoats.$inferSelect;
