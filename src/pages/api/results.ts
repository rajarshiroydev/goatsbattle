import type { APIRoute } from 'astro';
import { getVoteState } from '../../lib/voteService';
import { toResult } from '../../lib/voteWire';

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const GET: APIRoute = async ({ url, locals }) => {
  const battleId = url.searchParams.get('battle');
  if (!battleId) return json({ error: 'battle query param required' }, 400);

  const state = await getVoteState(battleId, locals.user?.id ?? null);
  if (!state) return json({ error: 'Battle not found' }, 404);

  return json(
    toResult(state.summary, {
      voted: state.votedChoice !== null,
      votedChoice: state.votedChoice,
    }),
  );
};
