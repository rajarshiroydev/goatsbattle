import type { APIRoute } from 'astro';
import { toggleCommentUpvote } from '../../lib/commentService';
import { rateLimit } from '../../lib/ratelimit';
import { commentVoteBodySchema, parseJsonBody } from '../../lib/apiValidation';
import { publishCommentVote } from '../../lib/liveMatchPublish';

export const prerender = false;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/** POST { commentId, remove? } → toggle an upvote on a comment (auth required). */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return json({ error: 'Log in to upvote', code: 'auth_required' }, 401);
  }
  const parsed = await parseJsonBody(request, commentVoteBodySchema);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const { commentId, remove } = parsed.data;

  const rl = await rateLimit(`comments:vote:${locals.user.id}`);
  if (!rl.ok) {
    return json({ error: 'Too fast — slow down.' }, 429, { 'Retry-After': String(rl.retryAfter) });
  }

  const result = await toggleCommentUpvote(commentId, locals.user.id, remove);
  if (result.status === 'not_found') return json({ error: 'Comment not found' }, 404);
  if (result.matchId) await publishCommentVote(result.matchId, commentId, result.upvotes);
  return json({ upvotes: result.upvotes, viewerUpvoted: result.viewerUpvoted });
};
