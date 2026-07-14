/**
 * Creates the complete pre-launch schema on a fresh, marked database. This is
 * intentionally separate from the historical incremental migrations so a new
 * production database never needs the obsolete category/Elo bootstrap schema.
 */
import { sql } from 'drizzle-orm';
import { db } from './lib/node-db';
import {
  exitOnDatabaseError,
  inspectDatabase,
  runDatabaseOperation,
} from './lib/database-safety';

const statements = [
  `CREATE TABLE entities (
     id text PRIMARY KEY,
     name text NOT NULL,
     short_name text NOT NULL,
     arena text NOT NULL DEFAULT 'football',
     country_code text NOT NULL,
     votes integer NOT NULL DEFAULT 0,
     votes_for integer NOT NULL DEFAULT 0,
     votes_against integer NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE battles (
     id text PRIMARY KEY,
     entity_a text NOT NULL REFERENCES entities(id),
     entity_b text NOT NULL REFERENCES entities(id),
     arena text NOT NULL DEFAULT 'football',
     votes_a integer NOT NULL DEFAULT 0,
     votes_b integer NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE "user" (
     id text PRIMARY KEY,
     name text NOT NULL,
     email text NOT NULL UNIQUE,
     email_verified boolean NOT NULL DEFAULT false,
     image text,
     username text UNIQUE,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE session (
     id text PRIMARY KEY,
     user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
     token text NOT NULL UNIQUE,
     expires_at timestamptz NOT NULL,
     ip_address text,
     user_agent text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE account (
     id text PRIMARY KEY,
     user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
     account_id text NOT NULL,
     provider_id text NOT NULL,
     access_token text,
     refresh_token text,
     id_token text,
     access_token_expires_at timestamptz,
     refresh_token_expires_at timestamptz,
     scope text,
     password text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE verification (
     id text PRIMARY KEY,
     identifier text NOT NULL,
     value text NOT NULL,
     expires_at timestamptz NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE votes (
     id serial PRIMARY KEY,
     battle_id text NOT NULL REFERENCES battles(id),
     choice text NOT NULL,
     user_id text REFERENCES "user"(id),
     ip_hash text NOT NULL,
     country text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX votes_battle_idx ON votes (battle_id)`,
  `CREATE INDEX votes_country_idx ON votes (battle_id, country)`,
  `CREATE INDEX votes_user_battle_idx ON votes (user_id, battle_id)`,
  `CREATE INDEX votes_ip_battle_idx ON votes (ip_hash, battle_id)`,
  `CREATE TABLE head_vote_windows (
     user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
     battle_id text NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
     window_start timestamptz NOT NULL DEFAULT now(),
     choice text NOT NULL REFERENCES entities(id),
     CONSTRAINT head_vote_windows_user_battle_pk PRIMARY KEY (user_id, battle_id)
   )`,
  `CREATE TABLE vote_windows (
     user_id text NOT NULL REFERENCES "user"(id),
     entity_id text NOT NULL REFERENCES entities(id),
     ip_hash text,
     window_start timestamptz NOT NULL DEFAULT now(),
     profile_used boolean NOT NULL DEFAULT false,
     champion_used boolean NOT NULL DEFAULT false,
     CONSTRAINT vote_windows_user_id_entity_id_pk PRIMARY KEY (user_id, entity_id)
   )`,
  `CREATE TABLE rate_limits (
     key text PRIMARY KEY,
     window_start timestamptz NOT NULL DEFAULT now(),
     hits integer NOT NULL DEFAULT 1 CHECK (hits > 0)
   )`,
  `CREATE INDEX rate_limits_window_start_idx ON rate_limits (window_start)`,
  `CREATE TABLE matches (
     id text PRIMARY KEY,
     external_id text UNIQUE,
     arena text NOT NULL DEFAULT 'football',
     competition text NOT NULL,
     home_team text NOT NULL,
     away_team text NOT NULL,
     home_code text,
     away_code text,
     home_score integer,
     away_score integer,
     kickoff timestamptz NOT NULL,
     status text NOT NULL DEFAULT 'finished',
     venue text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX matches_status_idx ON matches (status)`,
  `CREATE INDEX matches_kickoff_idx ON matches (kickoff)`,
  `CREATE TABLE match_moments (
     id serial PRIMARY KEY,
     match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
     minute integer NOT NULL,
     extra integer,
     type text NOT NULL,
     team text NOT NULL,
     player_name text,
     goat_slug text REFERENCES entities(id),
     detail text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX match_moments_match_idx ON match_moments (match_id)`,
  `CREATE TABLE match_goats (
     match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
     goat_slug text NOT NULL REFERENCES entities(id),
     team text,
     CONSTRAINT match_goats_match_id_goat_slug_pk PRIMARY KEY (match_id, goat_slug)
   )`,
  `CREATE TABLE comments (
     id serial PRIMARY KEY,
     battle_id text REFERENCES battles(id),
     match_id text REFERENCES matches(id),
     moment_id integer REFERENCES match_moments(id) ON DELETE SET NULL,
     user_id text NOT NULL REFERENCES "user"(id),
     parent_id integer REFERENCES comments(id),
     body text NOT NULL,
     upvotes integer NOT NULL DEFAULT 0,
     deleted boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT comments_subject_ck CHECK (
       ((battle_id IS NOT NULL)::int + (match_id IS NOT NULL)::int) = 1
     ),
     CONSTRAINT comments_moment_ck CHECK (moment_id IS NULL OR match_id IS NOT NULL)
   )`,
  `CREATE INDEX comments_battle_idx ON comments (battle_id)`,
  `CREATE INDEX comments_match_idx ON comments (match_id)`,
  `CREATE INDEX comments_moment_idx ON comments (moment_id)`,
  `CREATE INDEX comments_parent_idx ON comments (parent_id)`,
  `CREATE TABLE comment_votes (
     comment_id integer NOT NULL REFERENCES comments(id),
     user_id text NOT NULL REFERENCES "user"(id),
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT comment_votes_pk PRIMARY KEY (comment_id, user_id)
   )`,
  `CREATE TABLE comment_stat_tags (
     id serial PRIMARY KEY,
     comment_id integer NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
     goat_slug text NOT NULL REFERENCES entities(id),
     stat_label text NOT NULL
   )`,
  `CREATE INDEX comment_stat_tags_comment_idx ON comment_stat_tags (comment_id)`,
  `CREATE UNIQUE INDEX comment_stat_tags_uniq
     ON comment_stat_tags (comment_id, goat_slug, stat_label)`,
];

async function main() {
  const before = await inspectDatabase();
  const applicationTables = Object.keys(before.counts).filter(
    (table) => table !== 'deployment_environment',
  );
  if (applicationTables.length > 0) {
    throw new Error(
      `Fresh-schema migration requires an empty database; found: ${applicationTables.join(', ')}.`,
    );
  }
  for (const statement of statements) await db.execute(sql.raw(statement));
  console.log('✓ Fresh canonical schema created.');
}

runDatabaseOperation({ operation: 'fresh canonical schema migration' }, main)
  .catch(exitOnDatabaseError);
