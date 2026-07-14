import { neon } from '@neondatabase/serverless';
import {
  assertDatabaseTarget,
  getRequestedTarget,
  exitOnDatabaseError,
} from './lib/database-safety';

const EXPECTED_OWNER_EMAIL = 'roystark24@gmail.com';

async function main() {
  const target = getRequestedTarget();
  if (target !== 'production') {
    throw new Error('This verifier is restricted to the production database.');
  }

  await assertDatabaseTarget(target, 'verify production owner authentication');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set for this database command.');
  }

  const query = neon(connectionString);
  const users = await query`
    SELECT id, email, email_verified AS "emailVerified"
    FROM "user"
    ORDER BY created_at
  `;
  const accounts = await query`
    SELECT user_id AS "userId", provider_id AS "providerId"
    FROM account
    ORDER BY created_at
  `;
  const [sessionCount] = await query`
    SELECT count(*)::int AS count
    FROM session
  `;
  const [activity] = await query`
    SELECT
      (SELECT count(*)::int FROM comments) AS comments,
      (SELECT count(*)::int FROM votes) AS votes,
      (SELECT count(*)::int FROM comment_votes) AS "commentVotes",
      (SELECT count(*)::int FROM comment_reports) AS reports,
      (SELECT COALESCE(sum(votes), 0)::int FROM entities) AS "entityVotes",
      (SELECT COALESCE(sum(votes_for + votes_against), 0)::int FROM entities) AS "entityBattleVotes",
      (SELECT COALESCE(sum(votes_a + votes_b), 0)::int FROM battles) AS "battleVotes"
  `;

  if (users.length !== 1 || users[0]?.email !== EXPECTED_OWNER_EMAIL) {
    throw new Error(`Expected exactly one production owner user (${EXPECTED_OWNER_EMAIL}).`);
  }
  if (users[0].emailVerified !== true) {
    throw new Error('The production owner email is not verified.');
  }
  if (
    accounts.length !== 1 ||
    accounts[0]?.providerId !== 'google' ||
    accounts[0]?.userId !== users[0]?.id
  ) {
    throw new Error('Expected exactly one Google account linked to the production owner.');
  }

  const activityCounts = {
    comments: Number(activity.comments),
    votes: Number(activity.votes),
    commentVotes: Number(activity.commentVotes),
    reports: Number(activity.reports),
    entityVotes: Number(activity.entityVotes),
    entityBattleVotes: Number(activity.entityBattleVotes),
    battleVotes: Number(activity.battleVotes),
  };
  if (Object.values(activityCounts).some((count) => count !== 0)) {
    throw new Error('Unexpected production activity or aggregate tally detected.');
  }

  console.log('Verified production owner authentication:');
  console.log(JSON.stringify({
    email: users[0].email,
    emailVerified: users[0].emailVerified,
    linkedProvider: accounts[0].providerId,
    users: users.length,
    linkedAccounts: accounts.length,
    sessions: Number(sessionCount.count),
    activity: activityCounts,
  }, null, 2));
}

main().catch(exitOnDatabaseError);
