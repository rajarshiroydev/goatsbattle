import { pgTable, text, integer, timestamp, serial, boolean, index, primaryKey } from 'drizzle-orm/pg-core';

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
  category: text('category').notNull().default('football'),
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
  category: text('category').notNull().default('football'),
  votesA: integer('votes_a').notNull().default(0),
  votesB: integer('votes_b').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Votes — the head-to-head vote ledger. One row per cast 1v1/bout vote. A
 * SHA-256 hash of (ip + server salt) gives GDPR-safe dedup. Uniqueness is a
 * rolling 24h window per (ipHash, battleId), enforced by query against
 * `createdAt` (no static unique index, since the window rolls). `choice` stores
 * the entity id voted for; `country` comes from the Vercel geo header.
 */
export const votes = pgTable(
  'votes',
  {
    id: serial('id').primaryKey(),
    battleId: text('battle_id').notNull().references(() => battles.id),
    choice: text('choice').notNull(), // entity id voted for
    ipHash: text('ip_hash').notNull(),
    country: text('country'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    battleIdx: index('votes_battle_idx').on(t.battleId),
    countryIdx: index('votes_country_idx').on(t.battleId, t.country),
    // Speeds up the rolling-window dedup lookup by fingerprint + battle.
    ipBattleIdx: index('votes_ip_battle_idx').on(t.ipHash, t.battleId),
  })
);

/**
 * Vote windows — ranking-vote enforcement + Champion Mode lockout, per
 * (fingerprint, entity). `windowStart` anchors a shared 24h window opened by the
 * user's first ranking vote for that GOAT. `profileUsed`/`championUsed` mark
 * which channels have fired inside the current window; both reset together once
 * the window expires. A live `championUsed` also excludes that GOAT from the
 * user's next ranked Champion Mode run.
 */
export const voteWindows = pgTable(
  'vote_windows',
  {
    ipHash: text('ip_hash').notNull(),
    entityId: text('entity_id').notNull().references(() => entities.id),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
    profileUsed: boolean('profile_used').notNull().default(false),
    championUsed: boolean('champion_used').notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.ipHash, t.entityId] }),
  })
);

export type EntityRow = typeof entities.$inferSelect;
export type BattleRow = typeof battles.$inferSelect;
export type VoteRow = typeof votes.$inferSelect;
export type VoteWindowRow = typeof voteWindows.$inferSelect;
