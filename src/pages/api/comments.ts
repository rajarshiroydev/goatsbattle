import type { APIRoute } from 'astro';
import { listComments, postComment, deleteComment } from '../../lib/commentService';
import { rateLimit } from '../../lib/ratelimit';
import { getClientIp, hashIp } from '../../lib/ip';

export const prerender = false;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/** GET ?battle=slug → flat list of the battle's comments (public read). */
export const GET: APIRoute = async ({ url, request, locals }) => {
  const battleId = url.searchParams.get('battle');
  if (!battleId) return json({ error: 'battle query param required' }, 400);

  // Lightweight anti-abuse ceiling for the public read (keyed by client IP).
  const rl = rateLimit(`cget:${hashIp(getClientIp(request.headers))}`);
  if (!rl.ok) {
    return json({ error: 'Too many requests — slow down.' }, 429, { 'Retry-After': String(rl.retryAfter) });
  }

  const list = await listComments(battleId, locals.user?.id ?? null);
  return json({ comments: list });
};

/** POST { battleId, parentId?, body } → create a comment/reply (auth required). */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return json({ error: 'Log in to comment', code: 'auth_required' }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const b = body as Record<string, unknown>;
  const battleId = typeof b.battleId === 'string' ? b.battleId : null;
  const text = typeof b.body === 'string' ? b.body : null;
  const parentId = typeof b.parentId === 'number' ? b.parentId : null;
  if (!battleId || text === null) {
    return json({ error: 'battleId and body are required' }, 400);
  }

  const rl = rateLimit(`c:${locals.user.id}`);
  if (!rl.ok) {
    return json({ error: 'Too fast — slow down.' }, 429, { 'Retry-After': String(rl.retryAfter) });
  }

  const result = await postComment(battleId, locals.user.id, parentId, text);
  if (result.status === 'invalid') return json({ error: result.error }, 400);
  if (result.status === 'not_found') return json({ error: 'Battle not found' }, 404);
  return json({ comment: result.comment });
};

/** DELETE { commentId } → soft-delete your own comment (auth required). */
export const DELETE: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return json({ error: 'Log in first', code: 'auth_required' }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const commentId = typeof (body as any)?.commentId === 'number' ? (body as any).commentId : null;
  if (commentId === null) return json({ error: 'commentId is required' }, 400);

  const result = await deleteComment(commentId, locals.user.id);
  if (result.status === 'not_found') return json({ error: 'Comment not found' }, 404);
  if (result.status === 'forbidden') return json({ error: 'Not your comment' }, 403);
  return json({ ok: true });
};
