import type { APIRoute } from 'astro';
import { getVoteState } from '../../lib/voteService';
import { toResult } from '../../lib/voteWire';
import { rateLimit } from '../../lib/ratelimit';
import { getClientIp, hashIp } from '../../lib/ip';
import { slugSchema } from '../../lib/apiValidation';

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const GET: APIRoute = async ({ url, locals, request }) => {
  const parsedBattle = slugSchema.safeParse(url.searchParams.get('battle'));
  if (!parsedBattle.success) return json({ error: 'valid battle query param required' }, 400);
  const battleId = parsedBattle.data;
  const rl = await rateLimit(`results:${hashIp(getClientIp(request.headers))}`, { max: 60 });
  if (!rl.ok) return json({ error: 'Too many requests' }, 429);

  const state = await getVoteState(battleId, locals.user?.id ?? null);
  if (!state) return json({ error: 'Battle not found' }, 404);

  return json(
    toResult(state.summary, {
      voted: state.votedChoice !== null,
      votedChoice: state.votedChoice,
    }),
  );
};
