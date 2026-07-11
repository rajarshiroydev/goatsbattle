import type { APIRoute } from 'astro';
import { recordHeadToHeadVote } from '../../lib/voteService';
import { getClientIp, hashIp, getCountry } from '../../lib/ip';
import { rateLimit } from '../../lib/ratelimit';
import { toResult } from '../../lib/voteWire';
import { parseJsonBody, voteBodySchema } from '../../lib/apiValidation';

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
  const ipHash = hashIp(getClientIp(request.headers));

  // Per-user limit plus an IP-scoped ceiling (so churning accounts from one host
  // can't bypass the per-user cap). Checked in sequence so a failing request
  // doesn't also consume the other bucket's quota.
  const rl = await rateLimit(`vote:user:${locals.user.id}`);
  if (!rl.ok) {
    return json({ error: 'Too many votes — slow down.' }, 429, { 'Retry-After': String(rl.retryAfter) });
  }
  const rlIp = await rateLimit(`vote:ip:${ipHash}`, { max: 40 });
  if (!rlIp.ok) {
    return json({ error: 'Too many votes — slow down.' }, 429, { 'Retry-After': String(rlIp.retryAfter) });
  }

  const parsed = await parseJsonBody(request, voteBodySchema);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const { battleId, choice } = parsed.data;

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
