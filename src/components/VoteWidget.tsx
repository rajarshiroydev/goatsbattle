import { useEffect, useState } from 'preact/hooks';
import type { BattleResult } from '../lib/voteWire';
import { useSession } from '../lib/useSession';
import { openAuthModal } from '../lib/authModal';

interface Props {
  battleId: string;
  entityAId: string;
  entityBId: string;
  /** Full names, split into first line + surname for the split-arena display. */
  nameA: string;
  nameB: string;
  shortA: string;
  shortB: string;
  /** One-line career tagline under each name. */
  taglineA: string;
  taglineB: string;
  /** Arena id (e.g. "football") — links the post-vote rankings CTA. */
  arena: string;
  /** Human-readable arena label (e.g. "Football"). */
  arenaLabel: string;
}

/** Split a full name into a leading part and its surname (last word). */
function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { first: '', last: parts[0] };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/**
 * The Battle split-arena (design §6 / 3f). A full-bleed 50/50 hero — left is the
 * lime champion, right is the red challenger, always. Kickers, the bottom vote
 * bar, and the percentages are live; the two Vote buttons cast against the same
 * /api/vote + /api/results contract as before.
 */
export default function VoteWidget({
  battleId, entityAId, entityBId, nameA, nameB, shortA, shortB, taglineA, taglineB, arena, arenaLabel,
}: Props) {
  const { user, loading: sessionLoading } = useSession();
  const [result, setResult] = useState<BattleResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/results?battle=${encodeURIComponent(battleId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: BattleResult) => active && setResult(data))
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [battleId]);

  async function vote(choice: string) {
    if (pending || sessionLoading || result?.voted) return;
    if (!user) {
      openAuthModal({ reason: 'Log in to vote' });
      return;
    }
    setError(null);
    setPending(true);

    // Optimistic update — assume the vote lands.
    const base = result ?? {
      battleId, entityA: entityAId, entityB: entityBId,
      votesA: 0, votesB: 0, total: 0, pctA: 50, pctB: 50,
      voted: false, votedChoice: null,
    };
    const votesA = base.votesA + (choice === entityAId ? 1 : 0);
    const votesB = base.votesB + (choice === entityBId ? 1 : 0);
    const total = votesA + votesB;
    const pctA = total > 0 ? Math.round((votesA / total) * 100) : 50;
    setResult({ ...base, votesA, votesB, total, pctA, pctB: 100 - pctA, voted: true, votedChoice: choice });

    try {
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ battleId, choice }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Vote failed');
      setResult(data as BattleResult); // reconcile with the server truth
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vote failed');
      setResult({ ...base, voted: false, votedChoice: null }); // roll back
    } finally {
      setPending(false);
    }
  }

  const ready = !loading && !sessionLoading;
  const voted = result?.voted ?? false;
  const votedA = result?.votedChoice === entityAId;
  const votedB = result?.votedChoice === entityBId;
  const pctA = result?.total ? result.pctA : null;
  const pctB = result?.total ? result.pctB : null;
  const total = result?.total ?? 0;

  const a = splitName(nameA);
  const b = splitName(nameB);
  const pctLabel = (p: number | null) => (p === null ? '··' : `${p}%`);

  return (
    <section class="relative bg-canvas-deep border-b border-hairline">
      <div class="relative grid grid-cols-1 md:grid-cols-2 min-h-[440px]">

        {/* Champion (left / lime) */}
        <div
          class="relative flex flex-col justify-end px-8 py-9 md:border-r border-hairline overflow-hidden"
          style="background: linear-gradient(160deg, #141608 0%, #0a0a0c 70%)"
        >
          <span class="absolute top-8 left-8 font-mono text-[11px] uppercase tracking-[0.2em] text-lime">
            The Champion · {pctLabel(pctA)}
          </span>
          <span class="absolute -top-6 right-0 font-headline font-black leading-none select-none pointer-events-none"
            style="font-size: 220px; color: rgba(200,255,0,0.06)" aria-hidden="true">{a.last.charAt(0)}</span>

          <div class="relative">
            <h2 class="font-headline font-black uppercase leading-[0.85] tracking-tight"
              style="font-size: clamp(2.75rem, 7vw, 88px)">
              {a.first && <span class="text-ink">{a.first}<br /></span>}<span class="text-lime">{a.last}</span>
            </h2>
            <p class="mt-3.5 font-sans text-sm text-body">{taglineA}</p>
            <button
              onClick={() => vote(entityAId)}
              disabled={pending || voted || !ready}
              class={`btn btn-primary text-base px-[26px] py-3 mt-5.5 self-start disabled:opacity-60${votedA ? ' ring-2 ring-lime' : ''}`}
            >
              {votedA ? `✓ ${shortA}` : `Vote ${shortA}`}
            </button>
          </div>
        </div>

        {/* Challenger (right / red) */}
        <div
          class="relative flex flex-col justify-end items-end text-right px-8 py-9 overflow-hidden"
          style="background: linear-gradient(200deg, #170a0e 0%, #0a0a0c 70%)"
        >
          <span class="absolute top-8 right-8 font-mono text-[11px] uppercase tracking-[0.2em] text-red">
            The Challenger · {pctLabel(pctB)}
          </span>
          <span class="absolute -top-6 left-0 font-headline font-black leading-none select-none pointer-events-none"
            style="font-size: 220px; color: rgba(255,45,85,0.06)" aria-hidden="true">{b.last.charAt(0)}</span>

          <div class="relative flex flex-col items-end">
            <h2 class="font-headline font-black uppercase leading-[0.85] tracking-tight"
              style="font-size: clamp(2.75rem, 7vw, 88px)">
              {b.first && <span class="text-ink">{b.first}<br /></span>}<span class="text-red">{b.last}</span>
            </h2>
            <p class="mt-3.5 font-sans text-sm text-body">{taglineB}</p>
            <button
              onClick={() => vote(entityBId)}
              disabled={pending || voted || !ready}
              class={`btn btn-danger text-base px-[26px] py-3 mt-5.5 disabled:opacity-60${votedB ? ' ring-2 ring-red' : ''}`}
            >
              {votedB ? `✓ ${shortB}` : `Vote ${shortB}`}
            </button>
          </div>
        </div>

        {/* VS badge */}
        <div class="absolute left-1/2 top-1/2 md:top-[44%] -translate-x-1/2 -translate-y-1/2 w-[76px] h-[76px] rounded-full bg-canvas-deep border border-hairline-strong flex items-center justify-center"
          style="box-shadow: 0 0 40px rgba(0,0,0,0.8)">
          <span class="font-headline font-black italic text-3xl text-ink">VS</span>
        </div>

        {/* Bottom shared vote bar */}
        <div class="absolute left-0 right-0 bottom-0 h-1 flex">
          <div style={`width:${pctA ?? 50}%; background: var(--color-lime); transition: width 400ms ease`}></div>
          <div style={`width:${pctB ?? 50}%; background: var(--color-red); transition: width 400ms ease`}></div>
        </div>
      </div>

      {/* Live strip */}
      <div class="flex items-center gap-4 py-3.5 px-8 border-t border-hairline" style="background:#0e0e11">
        <span class="live-dot shrink-0"></span>
        <span class="font-mono text-[11px] uppercase tracking-[0.16em] text-mute">
          {total > 0 ? `${total.toLocaleString()} votes` : 'Be the first to vote'}
          {voted ? ` · you backed ${votedA ? shortA : shortB}` : ' · cast yours above'}
        </span>
        {voted && (
          <a href={`/rankings/${arena}`}
            class="ml-auto font-mono text-[11px] uppercase tracking-[0.14em] text-lime hover:text-ink transition-colors whitespace-nowrap">
            {arenaLabel} rankings →
          </a>
        )}
        {error && <span class="ml-auto font-mono text-[11px] uppercase tracking-widest text-red">{error}</span>}
      </div>
    </section>
  );
}
