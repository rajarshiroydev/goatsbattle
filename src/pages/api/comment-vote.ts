import type { APIRoute } from 'astro';
import { toggleCommentUpvote } from '../../lib/commentService';
import { rateLimit } from '../../lib/ratelimit';

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const commentId = typeof (body as any)?.commentId === 'number' ? (body as any).commentId : null;
  const remove = (body as any)?.remove === true;
  if (commentId === null) return json({ error: 'commentId is required' }, 400);

  const rl = rateLimit(`cv:${locals.user.id}`);
  if (!rl.ok) {
    return json({ error: 'Too fast — slow down.' }, 429, { 'Retry-After': String(rl.retryAfter) });
  }

  const result = await toggleCommentUpvote(commentId, locals.user.id, remove);
  if (result.status === 'not_found') return json({ error: 'Comment not found' }, 404);
  return json({ upvotes: result.upvotes, viewerUpvoted: result.viewerUpvoted });
};
