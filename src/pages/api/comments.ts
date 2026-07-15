import type { APIRoute } from 'astro';
import { listComments, postComment, deleteComment, type CommentSubject } from '../../lib/commentService';
import { rateLimit } from '../../lib/ratelimit';
import { getClientIp, hashIp } from '../../lib/ip';
import {
  commentBodySchema,
  deleteCommentBodySchema,
  parseJsonBody,
  slugSchema,
} from '../../lib/apiValidation';
import { publishCommentCreated, publishCommentDeleted } from '../../lib/liveMatchPublish';

export const prerender = false;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/**
 * Resolve the comment subject from a battle/match id pair. Exactly one must be
 * present (mirrors the schema CHECK). Returns null when neither/both are given.
 */
const resolveSubject = (battle: string | null, match: string | null): CommentSubject | null => {
  if (battle && !match) return { battle };
  if (match && !battle) return { match };
  return null;
};

/** GET ?battle=slug | ?match=id → flat list of the subject's comments (public read). */
export const GET: APIRoute = async ({ request, url, locals }) => {
  const battle = url.searchParams.get('battle');
  const match = url.searchParams.get('match');
  if ((battle && !slugSchema.safeParse(battle).success) || (match && !slugSchema.safeParse(match).success)) {
    return json({ error: 'invalid battle/match query parameter' }, 400);
  }
  const subject = resolveSubject(battle, match);
  if (!subject) return json({ error: 'exactly one of battle/match query param required' }, 400);

  const rl = await rateLimit(`comments:read:${hashIp(getClientIp(request.headers))}`, { max: 120 });
  if (!rl.ok) {
    return json({ error: 'Too many requests.' }, 429, {
      'Retry-After': String(rl.retryAfter),
      'Cache-Control': 'private, no-store',
    });
  }

  const list = await listComments(subject, locals.user?.id ?? null);
  return json({ comments: list });
};

/** POST { battleId|matchId, parentId?, body } → create a comment/reply (auth required). */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return json({ error: 'Log in to comment', code: 'auth_required' }, 401);
  }
  const parsed = await parseJsonBody(request, commentBodySchema);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const b = parsed.data;
  const subject = resolveSubject(
    b.battleId ?? null,
    b.matchId ?? null,
  );
  if (!subject) {
    return json({ error: 'exactly one of battleId/matchId, plus body, are required' }, 400);
  }

  const rl = await rateLimit(`comments:write:${locals.user.id}`, { max: 10 });
  if (!rl.ok) {
    return json({ error: 'Too fast — slow down.' }, 429, { 'Retry-After': String(rl.retryAfter) });
  }

  const result = await postComment(
    subject,
    locals.user.id,
    b.parentId ?? null,
    b.body,
    b.momentId ?? null,
    b.statTags,
  );
  if (result.status === 'invalid') return json({ error: result.error }, 400);
  if (result.status === 'not_found') return json({ error: 'Subject not found' }, 404);
  if ('match' in subject) await publishCommentCreated(subject.match, result.comment);
  return json({ comment: result.comment });
};

/** DELETE { commentId } → soft-delete your own comment (auth required). */
export const DELETE: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return json({ error: 'Log in first', code: 'auth_required' }, 401);
  }
  const parsed = await parseJsonBody(request, deleteCommentBodySchema);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const { commentId } = parsed.data;

  const rl = await rateLimit(`comments:write:${locals.user.id}`, { max: 10 });
  if (!rl.ok) {
    return json({ error: 'Too fast — slow down.' }, 429, { 'Retry-After': String(rl.retryAfter) });
  }

  const result = await deleteComment(commentId, locals.user.id);
  if (result.status === 'not_found') return json({ error: 'Comment not found' }, 404);
  if (result.status === 'forbidden') return json({ error: 'Not your comment' }, 403);
  if (result.matchId) await publishCommentDeleted(result.matchId, commentId);
  return json({ ok: true });
};
