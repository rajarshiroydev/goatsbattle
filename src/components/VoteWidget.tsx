import { useEffect, useState } from 'preact/hooks';
import type { BattleResult } from '../lib/voteWire';

interface Props {
  battleId: string;
  entityAId: string;
  entityBId: string;
  shortA: string;
  shortB: string;
}

export default function VoteWidget({ battleId, entityAId, entityBId, shortA, shortB }: Props) {
  const [result, setResult] = useState<BattleResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load current tally + whether this fingerprint already voted.
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
    if (pending || result?.voted) return;
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

  if (loading) {
    return (
      <div class="mt-6 flex items-center justify-center h-12">
        <span class="font-mono text-[10px] uppercase tracking-widest text-mute animate-pulse">Loading votes…</span>
      </div>
    );
  }

  const voted = result?.voted ?? false;
  const votedA = result?.votedChoice === entityAId;
  const votedB = result?.votedChoice === entityBId;

  return (
    <div class="mt-6">
      {!voted ? (
        <>
          <div class="flex flex-col sm:flex-row items-center gap-4 justify-center">
            <button
              onClick={() => vote(entityAId)}
              disabled={pending}
              class="font-headline font-black uppercase tracking-wider text-base bg-lime text-canvas px-10 h-12 flex items-center rounded-sm whitespace-nowrap hover:bg-lime-dark transition-colors disabled:opacity-50"
            >
              Vote {shortA}
            </button>
            <span class="font-mono text-[10px] uppercase tracking-widest text-mute">VS</span>
            <button
              onClick={() => vote(entityBId)}
              disabled={pending}
              class="font-headline font-black uppercase tracking-wider text-base bg-canvas-soft-2 text-ink border border-hairline-strong px-10 h-12 flex items-center rounded-sm whitespace-nowrap hover:border-lime transition-colors disabled:opacity-50"
            >
              Vote {shortB}
            </button>
          </div>
          <p class="text-center font-mono text-[10px] uppercase tracking-widest text-mute mt-3">
            One vote per battle · results revealed after you vote
          </p>
        </>
      ) : (
        <div>
          <div class="flex items-center justify-between font-headline font-black uppercase mb-2">
            <span class={`text-2xl ${result!.pctA >= result!.pctB ? 'text-lime' : 'text-ink'}`}>{shortA} {result!.pctA}%</span>
            <span class={`text-2xl ${result!.pctB > result!.pctA ? 'text-lime' : 'text-ink'}`}>{result!.pctB}% {shortB}</span>
          </div>
          <div class="flex h-3 gap-0.5 rounded-full overflow-hidden">
            <div style={`width:${result!.pctA}%`} class={result!.pctA >= result!.pctB ? 'bg-lime' : 'bg-hairline-strong'}></div>
            <div style={`width:${result!.pctB}%`} class={result!.pctB > result!.pctA ? 'bg-lime' : 'bg-hairline-strong'}></div>
          </div>
          <p class="text-center font-mono text-[10px] uppercase tracking-widest text-mute mt-3">
            {result!.total.toLocaleString()} total votes · you backed {votedA ? shortA : votedB ? shortB : '—'}
            {result!.alreadyVoted ? ' (already counted)' : ''}
          </p>
        </div>
      )}
      {error && (
        <p class="text-center font-mono text-[10px] uppercase tracking-widest text-red mt-3">{error}</p>
      )}
    </div>
  );
}
