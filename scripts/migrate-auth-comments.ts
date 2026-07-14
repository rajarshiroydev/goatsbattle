/**
 * Migration for the auth + threaded-comments layer. Idempotent — safe to
 * re-run. Applies the DDL directly because `drizzle-kit push` needs a TTY for
 * its create-vs-rename resolver, and this diff both alters existing tables
 * (votes, vote_windows) and creates new ones.
 *
 * Adds better-auth's tables (user/session/account/verification), the comments +
 * comment_votes tables, attributes votes to a user, and re-keys vote_windows
 * from (ip_hash, entity_id) to (user_id, entity_id).
 *
 * NOTE: vote_windows rows are ephemeral (24h) and pre-migration rows have no
 * user_id, so this TRUNCATEs them before the NOT NULL user_id + new PK. The
 * `votes` ledger keeps its history (user_id is nullable there).
 *
 * Run with:  npx tsx --env-file=.env scripts/migrate-auth-comments.ts
 */
import { sql } from 'drizzle-orm';
import { db } from './lib/node-db';
import { exitOnDatabaseError, runDatabaseOperation } from './lib/database-safety';

const statements = [
  // ─── better-auth core tables ("user" is a reserved word → always quoted) ────
  `CREATE TABLE IF NOT EXISTS "user" (
     id text PRIMARY KEY,
     name text NOT NULL,
     email text NOT NULL UNIQUE,
     email_verified boolean NOT NULL DEFAULT false,
     image text,
     username text UNIQUE,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS session (
     id text PRIMARY KEY,
     user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
     token text NOT NULL UNIQUE,
     expires_at timestamptz NOT NULL,
     ip_address text,
     user_agent text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS account (
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
  `CREATE TABLE IF NOT EXISTS verification (
     id text PRIMARY KEY,
     identifier text NOT NULL,
     value text NOT NULL,
     expires_at timestamptz NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,

  // ─── Threaded comments ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS comments (
     id serial PRIMARY KEY,
     battle_id text NOT NULL REFERENCES battles(id),
     user_id text NOT NULL REFERENCES "user"(id),
     parent_id integer REFERENCES comments(id),
     body text NOT NULL,
     upvotes integer NOT NULL DEFAULT 0,
     deleted boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS comments_battle_idx ON comments (battle_id)`,
  `CREATE INDEX IF NOT EXISTS comments_parent_idx ON comments (parent_id)`,
  `CREATE TABLE IF NOT EXISTS comment_votes (
     comment_id integer NOT NULL REFERENCES comments(id),
     user_id text NOT NULL REFERENCES "user"(id),
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT comment_votes_pk PRIMARY KEY (comment_id, user_id)
   )`,

  // ─── votes: attribute to a user (nullable → keep historic anon rows) ────────
  `ALTER TABLE votes ADD COLUMN IF NOT EXISTS user_id text REFERENCES "user"(id)`,
  `CREATE INDEX IF NOT EXISTS votes_user_battle_idx ON votes (user_id, battle_id)`,

  // ─── vote_windows: re-key (ip_hash, entity_id) → (user_id, entity_id) ───────
  `TRUNCATE vote_windows`,
  `ALTER TABLE vote_windows DROP CONSTRAINT IF EXISTS vote_windows_ip_hash_entity_id_pk`,
  `ALTER TABLE vote_windows ADD COLUMN IF NOT EXISTS user_id text REFERENCES "user"(id)`,
  `ALTER TABLE vote_windows ALTER COLUMN user_id SET NOT NULL`,
  `ALTER TABLE vote_windows ALTER COLUMN ip_hash DROP NOT NULL`,
  `ALTER TABLE vote_windows DROP CONSTRAINT IF EXISTS vote_windows_user_id_entity_id_pk`,
  `ALTER TABLE vote_windows ADD CONSTRAINT vote_windows_user_id_entity_id_pk PRIMARY KEY (user_id, entity_id)`,
];

async function main() {
  for (const stmt of statements) {
    const label = stmt.replace(/\s+/g, ' ').slice(0, 70);
    process.stdout.write(`→ ${label}…\n`);
    await db.execute(sql.raw(stmt));
  }
  console.log('\n✓ Auth + comments migration applied.');
}

// neon-http has no interactive transactions, so statements run one-by-one and
// this migration is NOT atomic — a mid-run failure can leave it partially
// applied. Recovery is simply to re-run it: every statement is written to be
// idempotent (CREATE/ADD ... IF [NOT] EXISTS, DROP CONSTRAINT IF EXISTS before
// ADD, idempotent ALTER ... SET/DROP NOT NULL, TRUNCATE), so re-running from the
// top safely converges to the target schema.
runDatabaseOperation({ operation: 'auth/comments migration' }, main).catch(exitOnDatabaseError);
