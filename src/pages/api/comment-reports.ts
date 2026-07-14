import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { commentReportBodySchema, parseJsonBody } from '../../lib/apiValidation';
import { db } from '../../lib/db';
import { commentReports, comments } from '../../lib/db/schema';
import { rateLimit } from '../../lib/ratelimit';

export const prerender = false;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Log in to report a comment', code: 'auth_required' }, 401);

  const parsed = await parseJsonBody(request, commentReportBodySchema, 4_096);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);

  const limit = await rateLimit(`comments:report:${locals.user.id}`, { max: 5 });
  if (!limit.ok) {
    return json({ error: 'Too many reports. Try again shortly.' }, 429, {
      'Retry-After': String(limit.retryAfter),
    });
  }

  const [comment] = await db
    .select({ id: comments.id, userId: comments.userId, deleted: comments.deleted })
    .from(comments)
    .where(eq(comments.id, parsed.data.commentId))
    .limit(1);

  if (!comment || comment.deleted) return json({ error: 'Comment not found' }, 404);
  if (comment.userId === locals.user.id) return json({ error: 'You cannot report your own comment' }, 400);

  const [existing] = await db
    .select({ id: commentReports.id })
    .from(commentReports)
    .where(and(
      eq(commentReports.reporterId, locals.user.id),
      eq(commentReports.commentId, comment.id),
      eq(commentReports.status, 'open'),
    ))
    .limit(1);
  if (existing) return json({ error: 'You already reported this comment' }, 409);

  const [created] = await db
    .insert(commentReports)
    .values({
      reporterId: locals.user.id,
      commentId: comment.id,
      reason: parsed.data.reason,
      details: parsed.data.details || null,
    })
    .onConflictDoNothing()
    .returning({ id: commentReports.id });
  if (!created) return json({ error: 'You already reported this comment' }, 409);

  return json({ ok: true, reportId: created.id }, 201);
};
