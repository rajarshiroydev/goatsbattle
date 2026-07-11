import type { APIRoute } from 'astro';
import { recordRankingVote, getRankingVoteState } from '../../lib/voteService';
import { getClientIp, hashIp } from '../../lib/ip';
import { rateLimit } from '../../lib/ratelimit';
import { parseJsonBody, rankVoteBodySchema, slugSchema } from '../../lib/apiValidation';
// getClientIp/hashIp retained: ipHash is stored as a secondary anti-abuse signal.

export const prerender = false;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/** GET ?entity=slug → this user's ranking-vote window state for that GOAT. */
export const GET: APIRoute = async ({ url, locals }) => {
  const parsedEntity = slugSchema.safeParse(url.searchParams.get('entity'));
  if (!parsedEntity.success) return json({ error: 'valid entity is required' }, 400);
  const entityId = parsedEntity.data;
  if (locals.user) {
    const rl = await rateLimit(`rank-state:${locals.user.id}`, { max: 60 });
    if (!rl.ok) return json({ error: 'Too many requests' }, 429);
  }
  const state = await getRankingVoteState(entityId, locals.user?.id ?? null);
  return json(state);
};

/** POST { entityId, channel } → cast a ranking vote (+1 profile / +5 champion). */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return json({ error: 'Log in to vote', code: 'auth_required' }, 401);
  }
  const parsed = await parseJsonBody(request, rankVoteBodySchema);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const { entityId, channel } = parsed.data;

  const ipHash = hashIp(getClientIp(request.headers));

  // Per-user limit plus an IP-scoped ceiling, checked in sequence (see /api/vote).
  // Namespaced key so ranking votes get their own bucket, not shared with the
  // head-to-head vote endpoint (rateLimit uses one global map).
  const rl = await rateLimit(`rank:user:${locals.user.id}`);
  if (!rl.ok) {
    return json({ error: 'Too many votes — slow down.' }, 429, { 'Retry-After': String(rl.retryAfter) });
  }
  const rlIp = await rateLimit(`rank:ip:${ipHash}`, { max: 40 });
  if (!rlIp.ok) {
    return json({ error: 'Too many votes — slow down.' }, 429, { 'Retry-After': String(rlIp.retryAfter) });
  }

  const result = await recordRankingVote(entityId, channel, locals.user.id, ipHash);
  if (result.status === 'unknown_entity') return json({ error: 'Unknown GOAT' }, 404);

  return json(result);
};
