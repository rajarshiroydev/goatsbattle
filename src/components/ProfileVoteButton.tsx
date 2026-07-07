import { useEffect, useState } from 'preact/hooks';

interface Props {
  /** Entity id (slug) to vote for. */
  id: string;
  shortName: string;
  /** Player accent colour (hex). */
  accent: string;
}

interface RankState {
  profileUsed: boolean;
  championUsed: boolean;
  windowResetsAt: string | null;
}

/** Readable text colour (dark or light) for a solid accent background. */
function textOn(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#0d0d0f' : '#f0f0f2';
}

/** "resets in 5h" / "resets soon" from an ISO reset timestamp. */
function resetLabel(iso: string | null): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return '';
  const hrs = Math.ceil(ms / 3_600_000);
  return hrs <= 1 ? 'resets within an hour' : `resets in ${hrs}h`;
}

/**
 * The profile "Vote <GOAT>" button — casts a +1 ranking vote for this GOAT. One
 * profile vote per GOAT per rolling 24h window (shared with the Champion Mode
 * crown; see recordRankingVote). Hydrates its used/locked state on mount.
 */
export default function ProfileVoteButton({ id, shortName, accent }: Props) {
  const [state, setState] = useState<RankState | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justVoted, setJustVoted] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/rank-vote?entity=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: RankState) => active && setState(data))
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  async function vote() {
    if (pending || state?.profileUsed) return;
    setError(null);
    setPending(true);
    try {
      const res = await fetch('/api/rank-vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId: id, channel: 'profile' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Vote failed');
      setState({ profileUsed: data.profileUsed, championUsed: data.championUsed, windowResetsAt: data.windowResetsAt });
      if (data.status === 'awarded') setJustVoted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vote failed');
    } finally {
      setPending(false);
    }
  }

  const voted = state?.profileUsed ?? false;

  if (loading) {
    return (
      <div class="h-12 flex items-center px-8 rounded-sm border border-hairline">
        <span class="font-mono text-xs uppercase tracking-widest text-mute animate-pulse">Loading…</span>
      </div>
    );
  }

  if (voted) {
    return (
      <div class="inline-flex flex-col justify-center">
        <div
          class="font-headline font-black uppercase text-lg tracking-wider px-8 h-12 flex items-center gap-2 rounded-sm border"
          style={`color:${accent}; border-color:${accent}`}
        >
          ✓ {justVoted ? `Voted ${shortName}` : `${shortName} Voted`}
        </div>
        <span class="font-mono text-[13px] uppercase tracking-widest text-mute mt-1.5">
          {resetLabel(state?.windowResetsAt ?? null) || 'one vote per day'}
        </span>
      </div>
    );
  }

  return (
    <div class="inline-flex flex-col">
      <button
        type="button"
        onClick={vote}
        disabled={pending}
        class="font-headline font-black uppercase text-lg tracking-wider px-8 h-12 flex items-center gap-2 rounded-sm transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
        style={`background:${accent}; color:${textOn(accent)}`}
      >
        Vote {shortName}
        <span class="text-base">✦</span>
      </button>
      {error && (
        <span class="font-mono text-[13px] uppercase tracking-widest text-red mt-1.5">{error}</span>
      )}
    </div>
  );
}
