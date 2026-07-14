/** Development-only constraint smoke for the launch moderation queue. */
import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { exitOnDatabaseError, runDatabaseOperation } from './lib/database-safety';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  const query = neon(connectionString);
  const reporterId = `report-smoke-${randomUUID()}`;
  const email = `${reporterId}@example.com`;

  try {
    const [comment] = await query`
      SELECT id, user_id AS "userId" FROM comments WHERE deleted = false ORDER BY id LIMIT 1
    `;
    if (!comment) throw new Error('No non-deleted comment exists for the report smoke.');

    await query`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES (${reporterId}, 'Report Smoke', ${email}, true, now(), now())
    `;
    await query`
      INSERT INTO comment_reports (reporter_id, comment_id, reason, details)
      VALUES (${reporterId}, ${comment.id}, 'spam', 'Constraint smoke; must be deleted.')
    `;

    let duplicateRejected = false;
    try {
      await query`
        INSERT INTO comment_reports (reporter_id, comment_id, reason)
        VALUES (${reporterId}, ${comment.id}, 'other')
      `;
    } catch (error) {
      duplicateRejected = (error as { code?: string }).code === '23505';
    }
    if (!duplicateRejected) throw new Error('Active report uniqueness constraint did not reject a duplicate.');
    console.log('✓ Active report uniqueness rejected the duplicate insert.');
  } finally {
    await query`DELETE FROM "user" WHERE id = ${reporterId}`;
  }

  const [leftovers] = await query`
    SELECT
      (SELECT count(*)::int FROM "user" WHERE id = ${reporterId}) AS users,
      (SELECT count(*)::int FROM comment_reports WHERE reporter_id = ${reporterId}) AS reports
  `;
  if (Number(leftovers.users) !== 0 || Number(leftovers.reports) !== 0) {
    throw new Error(`Report smoke cleanup failed: ${JSON.stringify(leftovers)}`);
  }
  console.log('✓ Report smoke user and reports were removed.');
}

runDatabaseOperation({
  operation: 'comment-report constraint smoke',
  allowedTargets: ['development'],
}, main).catch(exitOnDatabaseError);
