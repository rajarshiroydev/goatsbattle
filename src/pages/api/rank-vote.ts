import type { APIRoute } from 'astro';
import { recordRankingVote, getRankingVoteState } from '../../lib/voteService';
import { getClientIp, hashIp } from '../../lib/ip';
import { rateLimit } from '../../lib/ratelimit';
import type { VoteChannel } from '../../lib/votes';
// getClientIp/hashIp retained: ipHash is stored as a secondary anti-abuse signal.

export const prerender = false;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const CHANNELS: VoteChannel[] = ['profile', 'champion'];

/** GET ?entity=slug → this user's ranking-vote window state for that GOAT. */
export const GET: APIRoute = async ({ url, locals }) => {
  const entityId = url.searchParams.get('entity');
  if (!entityId) return json({ error: 'entity is required' }, 400);
  const state = await getRankingVoteState(entityId, locals.user?.id ?? null);
  return json(state);
};

/** POST { entityId, channel } → cast a ranking vote (+1 profile / +5 champion). */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return json({ error: 'Log in to vote', code: 'auth_required' }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const entityId = body && typeof (body as any).entityId === 'string' ? (body as any).entityId : null;
  const channel = body && typeof (body as any).channel === 'string' ? (body as any).channel : null;
  if (!entityId || !channel || !CHANNELS.includes(channel as VoteChannel)) {
    return json({ error: 'entityId and a valid channel are required' }, 400);
  }

  const ipHash = hashIp(getClientIp(request.headers));

  // Per-user limit plus an IP-scoped ceiling (see /api/vote).
  const rl = rateLimit(locals.user.id);
  const rlIp = rateLimit(`ip:${ipHash}`);
  if (!rl.ok || !rlIp.ok) {
    const retryAfter = Math.max(rl.retryAfter, rlIp.retryAfter);
    return json({ error: 'Too many votes — slow down.' }, 429, { 'Retry-After': String(retryAfter) });
  }

  const result = await recordRankingVote(entityId, channel as VoteChannel, locals.user.id, ipHash);
  if (result.status === 'unknown_entity') return json({ error: 'Unknown GOAT' }, 404);

  return json(result);
};
