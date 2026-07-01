import { useEffect, useState } from 'preact/hooks';
import type { BattleResult } from '../lib/voteWire';

interface Props {
  battleId: string;
  entityAId: string;
  entityBId: string;
  shortA: string;
  shortB: string;
  /** Player-associated accent colours (hex). */
  accentA: string;
  accentB: string;
}

/** Readable text colour (dark or light) for a solid accent background. */
function textOn(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#0d0d0f' : '#f0f0f2';
}

export default function VoteWidget({ battleId, entityAId, entityBId, shortA, shortB, accentA, accentB }: Props) {
  const [result, setResult] = useState<BattleResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load current tally + whether this fingerprint already voted today.
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
        <span class="font-mono text-xs uppercase tracking-widest text-mute animate-pulse">Loading votes…</span>
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
              style={{ background: accentA, color: textOn(accentA) }}
              class="font-headline font-black uppercase tracking-wider text-lg px-10 h-12 flex items-center rounded-sm whitespace-nowrap transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Vote {shortA}
            </button>
            <span class="font-mono text-xs uppercase tracking-widest text-mute">VS</span>
            <button
              onClick={() => vote(entityBId)}
              disabled={pending}
              style={{ background: accentB, color: textOn(accentB) }}
              class="font-headline font-black uppercase tracking-wider text-lg px-10 h-12 flex items-center rounded-sm whitespace-nowrap transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Vote {shortB}
            </button>
          </div>
          <p class="text-center font-mono text-[11px] uppercase tracking-widest text-mute mt-3">
            One vote per battle each day · results revealed after you vote
          </p>
        </>
      ) : (
        <div>
          <div class="flex items-center justify-between font-headline font-black uppercase mb-2">
            <span class="text-3xl" style={{ color: accentA }}>{shortA} {result!.pctA}%</span>
            <span class="text-3xl" style={{ color: accentB }}>{result!.pctB}% {shortB}</span>
          </div>
          <div class="flex h-3.5 gap-0.5 rounded-full overflow-hidden">
            <div style={{ width: `${result!.pctA}%`, background: accentA }}></div>
            <div style={{ width: `${result!.pctB}%`, background: accentB }}></div>
          </div>
          <p class="text-center font-mono text-[11px] uppercase tracking-widest text-mute mt-3">
            {result!.total.toLocaleString()} total votes · you backed {votedA ? shortA : votedB ? shortB : '—'}
          </p>
          <p class="text-center font-mono text-[11px] uppercase tracking-widest text-lime mt-1.5">
            ✓ Voted today — come back tomorrow to vote again
          </p>
        </div>
      )}
      {error && (
        <p class="text-center font-mono text-[11px] uppercase tracking-widest text-red mt-3">{error}</p>
      )}
    </div>
  );
}
