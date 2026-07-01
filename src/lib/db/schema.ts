import { pgTable, text, integer, timestamp, serial, date, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { SEED_ELO } from '../elo';

/**
 * Entities — the curated GOAT candidates. The canonical profile/stat content
 * lives in code (src/data), but mutable global state (Elo, aggregate votes)
 * is stored here so it can evolve with community voting.
 */
export const entities = pgTable('entities', {
  id: text('id').primaryKey(), // slug, e.g. "messi"
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  category: text('category').notNull().default('football'),
  countryCode: text('country_code').notNull(),
  elo: integer('elo').notNull().default(SEED_ELO),
  votesFor: integer('votes_for').notNull().default(0), // total votes won across all battles
  votesAgainst: integer('votes_against').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Battles — one row per canonical pairing. `entityA`/`entityB` are always
 * stored alphabetically sorted (entityA < entityB) so the id is deterministic.
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
 * Votes — individual cast votes. A SHA-256 hash of (ip + server salt) gives
 * GDPR-safe dedup via the unique index. Uniqueness is bucketed by `voteDay`
 * (UTC calendar day), so a fingerprint may vote each battle once per day and
 * come back the next day. `choice` stores the entity id voted for; `country`
 * comes from the Vercel geo header.
 */
export const votes = pgTable(
  'votes',
  {
    id: serial('id').primaryKey(),
    battleId: text('battle_id').notNull().references(() => battles.id),
    choice: text('choice').notNull(), // entity id voted for
    ipHash: text('ip_hash').notNull(),
    country: text('country'),
    // UTC calendar day this vote counts for; drives the daily dedup window.
    voteDay: date('vote_day').notNull().default(sql`CURRENT_DATE`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // one vote per fingerprint per battle per day
    uniqueVote: uniqueIndex('votes_ip_battle_day_uniq').on(t.ipHash, t.battleId, t.voteDay),
    battleIdx: index('votes_battle_idx').on(t.battleId),
    countryIdx: index('votes_country_idx').on(t.battleId, t.country),
  })
);

/**
 * Elo history — append-only log of rating changes, for ranking trends and
 * "rating over time" charts later.
 */
export const eloHistory = pgTable(
  'elo_history',
  {
    id: serial('id').primaryKey(),
    entityId: text('entity_id').notNull().references(() => entities.id),
    battleId: text('battle_id').notNull().references(() => battles.id),
    elo: integer('elo').notNull(),
    delta: integer('delta').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index('elo_history_entity_idx').on(t.entityId),
  })
);

export type EntityRow = typeof entities.$inferSelect;
export type BattleRow = typeof battles.$inferSelect;
export type VoteRow = typeof votes.$inferSelect;
