import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  timestamp,
  serial,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/**
 * Persistent safety marker for destructive or data-changing CLI operations.
 * A database is initialized exactly once as development or production; scripts
 * refuse to run when their explicit target does not match this row.
 */
export const deploymentEnvironment = pgTable(
  'deployment_environment',
  {
    id: integer('id').primaryKey(),
    environment: text('environment').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    singletonCk: check('deployment_environment_singleton_ck', sql`${t.id} = 1`),
    environmentCk: check(
      'deployment_environment_name_ck',
      sql`${t.environment} IN ('development', 'production')`,
    ),
  }),
);

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
 * `country` comes from Cloudflare request metadata.
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
 * Atomic rolling-window claim for head-to-head votes. The composite primary key
 * gives each user/battle pair one mutable claim row; voteService refreshes it
 * only after the previous 24-hour window has expired. This closes the
 * check-then-write race that the append-only votes ledger cannot prevent.
 */
export const headVoteWindows = pgTable(
  'head_vote_windows',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    battleId: text('battle_id')
      .notNull()
      .references(() => battles.id, { onDelete: 'cascade' }),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
    choice: text('choice').notNull().references(() => entities.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.battleId] }),
  }),
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

/** Shared fixed-window rate-limit counters. Unlike an in-process Map, these are
 * consistent across serverless instances. Expired keys are opportunistically
 * recycled and can be pruned without affecting correctness. */
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').primaryKey(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
    hits: integer('hits').notNull().default(1),
  },
  (t) => ({
    windowStartIdx: index('rate_limits_window_start_idx').on(t.windowStart),
  }),
);

/**
 * Matches — football events users discuss on The Floor. Unlike entities/battles
 * (curated content that lives in code), a match is dynamic external data, so it
 * lives entirely in Postgres. `externalId` holds the API-Football fixture id so
 * a live-sync phase upserts by it (scripts/sync-matches.ts pulls a curated WC
 * 2022 subset; free tier = 100 req/day). `homeCode`/`awayCode` are
 * ISO country codes used for flags/accents. `status` drives the Live filter.
 */
export const matches = pgTable(
  'matches',
  {
    id: text('id').primaryKey(), // readable slug, e.g. "argentina-vs-egypt-2026-06-15"
    externalId: text('external_id').unique(), // API-Football fixture id (future sync)
    provider: text('provider'),
    providerFixtureId: text('provider_fixture_id'),
    tournamentStage: text('tournament_stage'),
    sourceStatus: text('source_status').notNull().default('canonical'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    arena: text('arena').notNull().default('football'),
    competition: text('competition').notNull(),
    homeTeam: text('home_team').notNull(),
    awayTeam: text('away_team').notNull(),
    homeCode: text('home_code'), // ISO country code
    awayCode: text('away_code'),
    homeScore: integer('home_score'),
    awayScore: integer('away_score'),
    homePenaltyScore: integer('home_penalty_score'),
    awayPenaltyScore: integer('away_penalty_score'),
    kickoff: timestamp('kickoff', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('finished'), // scheduled | live | finished
    venue: text('venue'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('matches_status_idx').on(t.status),
    kickoffIdx: index('matches_kickoff_idx').on(t.kickoff),
    providerFixtureUniq: uniqueIndex('matches_provider_fixture_uniq').on(
      t.provider,
      t.providerFixtureId,
    ),
  })
);

/** Multiple provider identities can belong to one canonical match. The match
 * row keeps the public route and FIFA schedule; this table owns external IDs. */
export const matchSources = pgTable(
  'match_sources',
  {
    id: serial('id').primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerMatchId: text('provider_match_id').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerMatchUniq: uniqueIndex('match_sources_provider_match_uniq').on(
      t.provider,
      t.providerMatchId,
      t.role,
    ),
    matchRoleUniq: uniqueIndex('match_sources_match_role_uniq').on(
      t.matchId,
      t.provider,
      t.role,
    ),
    matchIdx: index('match_sources_match_idx').on(t.matchId),
    roleCk: check(
      'match_sources_role_ck',
      sql`${t.role} IN ('score', 'timeline', 'lineup')`,
    ),
  }),
);

/** Provider-wide quota state. The Worker reserves a request atomically before
 * every upstream fetch, preventing overlapping isolates from exceeding trial
 * or per-minute limits. */
export const providerSyncState = pgTable('provider_sync_state', {
  provider: text('provider').primaryKey(),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(),
  requestsInWindow: integer('requests_in_window').notNull().default(0),
  totalRequests: integer('total_requests').notNull().default(0),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  circuitOpenUntil: timestamp('circuit_open_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Current provisional timeline. Snapshot replacement is safe here because no
 * user citation points at this row; durable citations use match_moments. */
export const matchTimelineState = pgTable(
  'match_timeline_state',
  {
    matchId: text('match_id')
      .primaryKey()
      .references(() => matches.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerMatchId: text('provider_match_id').notNull(),
    mode: text('mode').notNull().default('shadow'),
    coverage: text('coverage').notNull().default('none'),
    snapshotHash: text('snapshot_hash'),
    snapshotVersion: integer('snapshot_version').notNull().default(0),
    events: jsonb('events').$type<unknown[]>().notNull().default([]),
    providerUpdatedAt: timestamp('provider_updated_at', { withTimezone: true }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastFinalCheckAt: timestamp('last_final_check_at', { withTimezone: true }),
    consecutiveIdentical: integer('consecutive_identical').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    modeCk: check(
      'match_timeline_state_mode_ck',
      sql`${t.mode} IN ('shadow', 'live', 'finalizing', 'finalized', 'degraded')`,
    ),
  }),
);

/** Changed snapshots retained for replay/idempotency evidence. Identical polls
 * are deduplicated by hash and update only the current-state heartbeat. */
export const matchTimelineSnapshots = pgTable(
  'match_timeline_snapshots',
  {
    id: serial('id').primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    snapshotHash: text('snapshot_hash').notNull(),
    coverage: text('coverage').notNull(),
    eventCount: integer('event_count').notNull(),
    events: jsonb('events').$type<unknown[]>().notNull(),
    providerUpdatedAt: timestamp('provider_updated_at', { withTimezone: true }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hashUniq: uniqueIndex('match_timeline_snapshots_hash_uniq').on(
      t.matchId,
      t.provider,
      t.snapshotHash,
    ),
    matchIdx: index('match_timeline_snapshots_match_idx').on(t.matchId, t.fetchedAt),
  }),
);

/** Latest lineup payload and our independent quality verdict. Provider
 * `confirmed=true` is never sufficient by itself. */
export const matchLineups = pgTable(
  'match_lineups',
  {
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerMatchId: text('provider_match_id').notNull(),
    status: text('status').notNull(),
    rejectionReason: text('rejection_reason'),
    snapshotHash: text('snapshot_hash').notNull(),
    lineup: jsonb('lineup').$type<Record<string, unknown>>().notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.matchId, t.provider] }),
    statusCk: check(
      'match_lineups_status_ck',
      sql`${t.status} IN ('rejected', 'official')`,
    ),
  }),
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
    provider: text('provider'),
    providerEventId: text('provider_event_id'),
    providerSequence: integer('provider_sequence'),
    period: text('period'),
    providerTeamId: text('provider_team_id'),
    providerPlayerId: text('provider_player_id'),
    verificationStatus: text('verification_status').notNull().default('confirmed'),
    snapshotHash: text('snapshot_hash'),
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
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    matchIdx: index('match_moments_match_idx').on(t.matchId),
    providerEventUniq: uniqueIndex('match_moments_provider_event_uniq').on(
      t.provider,
      t.providerEventId,
    ),
    verificationCk: check(
      'match_moments_verification_ck',
      sql`${t.verificationStatus} IN ('provisional', 'confirmed', 'retracted', 'superseded')`,
    ),
  })
);

/** Explicit provider-player mappings. GOAT linkage never uses fuzzy names. */
export const goatProviderPlayers = pgTable(
  'goat_provider_players',
  {
    goatSlug: text('goat_slug')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerPlayerId: text('provider_player_id').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.goatSlug, t.provider] }),
    providerPlayerUniq: uniqueIndex('goat_provider_players_provider_player_uniq').on(
      t.provider,
      t.providerPlayerId,
    ),
  }),
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
 * single seam that lets one comment stack serve both surfaces. A match comment
 * may additionally anchor to a `momentId` (a point on the match timeline).
 */
export const comments = pgTable(
  'comments',
  {
    id: serial('id').primaryKey(),
    battleId: text('battle_id').references(() => battles.id),
    matchId: text('match_id').references(() => matches.id),
    // Optional timeline anchor — only valid on a match comment (CHECK below).
    momentId: integer('moment_id').references(() => matchMoments.id, { onDelete: 'set null' }),
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
    momentIdx: index('comments_moment_idx').on(t.momentId),
    parentIdx: index('comments_parent_idx').on(t.parentId),
    // Exactly one subject: a comment belongs to a battle XOR a match.
    subjectCk: check(
      'comments_subject_ck',
      sql`(${t.battleId} IS NOT NULL)::int + (${t.matchId} IS NOT NULL)::int = 1`,
    ),
    // A moment anchor only makes sense on a match comment.
    momentCk: check(
      'comments_moment_ck',
      sql`${t.momentId} IS NULL OR ${t.matchId} IS NOT NULL`,
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

/** Launch moderation queue. A partial unique index permits a new report only
 * after the previous report by that user for that comment is no longer open. */
export const commentReports = pgTable(
  'comment_reports',
  {
    id: serial('id').primaryKey(),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    commentId: integer('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    details: text('details'),
    status: text('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('comment_reports_status_idx').on(t.status, t.createdAt),
    activeUniq: uniqueIndex('comment_reports_active_uniq')
      .on(t.reporterId, t.commentId)
      .where(sql`${t.status} = 'open'`),
    reasonCk: check(
      'comment_reports_reason_ck',
      sql`${t.reason} IN ('spam', 'harassment', 'hate', 'privacy', 'misinformation', 'other')`,
    ),
    statusCk: check(
      'comment_reports_status_ck',
      sql`${t.status} IN ('open', 'reviewing', 'resolved', 'dismissed')`,
    ),
  }),
);

/**
 * Comment stat tags — the "settle it with a fact" mechanic. A comment can cite
 * one or more definitive goat stats (e.g. Messi · International Goals). Only the
 * reference is stored (goat slug + stat label); the *value* is resolved live
 * from the canonical stat data in code (src/data), so tags never go stale. The
 * unique index dedupes the same stat tagged twice on one comment.
 */
export const commentStatTags = pgTable(
  'comment_stat_tags',
  {
    id: serial('id').primaryKey(),
    commentId: integer('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    goatSlug: text('goat_slug')
      .notNull()
      .references(() => entities.id),
    statLabel: text('stat_label').notNull(),
  },
  (t) => ({
    commentIdx: index('comment_stat_tags_comment_idx').on(t.commentId),
    uniq: uniqueIndex('comment_stat_tags_uniq').on(t.commentId, t.goatSlug, t.statLabel),
  })
);
