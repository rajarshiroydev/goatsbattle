import type { APIRoute } from 'astro';
import { recordHeadToHeadVote } from '../../lib/voteService';
import { getClientIp, hashIp, getCountry } from '../../lib/ip';
import { rateLimit } from '../../lib/ratelimit';
import { toResult } from '../../lib/voteWire';

export const prerender = false;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

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

  const battleId = body && typeof (body as any).battleId === 'string' ? (body as any).battleId : null;
  const choice = body && typeof (body as any).choice === 'string' ? (body as any).choice : null;
  if (!battleId || !choice) {
    return json({ error: 'battleId and choice are required' }, 400);
  }

  const ipHash = hashIp(getClientIp(request.headers));

  // Per-user limit plus an IP-scoped ceiling (so churning accounts from one host
  // can't bypass the per-user cap).
  const rl = rateLimit(locals.user.id);
  const rlIp = rateLimit(`ip:${ipHash}`);
  if (!rl.ok || !rlIp.ok) {
    const retryAfter = Math.max(rl.retryAfter, rlIp.retryAfter);
    return json({ error: 'Too many votes — slow down.' }, 429, { 'Retry-After': String(retryAfter) });
  }

  const country = getCountry(request.headers);
  const outcome = await recordHeadToHeadVote(battleId, choice, locals.user.id, ipHash, country);

  if (outcome.status === 'not_found') return json({ error: 'Battle not found' }, 404);
  if (outcome.status === 'bad_choice') return json({ error: 'Invalid choice for this battle' }, 400);

  return json(
    toResult(outcome.summary, {
      voted: true,
      votedChoice: outcome.votedChoice,
      alreadyVoted: outcome.alreadyVoted,
    }),
  );
};
