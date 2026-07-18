import { useEffect, useState } from 'preact/hooks';
import { textOn } from '../lib/colorContrast';
import { useSession } from '../lib/useSession';
import { openAuthModal } from '../lib/authModal';

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
  const { user, loading: sessionLoading } = useSession();
  const [state, setState] = useState<RankState | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justVoted, setJustVoted] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/rank-vote?goat=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: RankState) => active && setState(data))
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  async function vote() {
    if (pending || sessionLoading || state?.profileUsed) return;
    if (!user) {
      openAuthModal({ reason: `Log in to vote ${shortName}` });
      return;
    }
    setError(null);
    setPending(true);

    // Optimistic flip — show the voted state immediately, reconcile/roll back
    // once the server responds so the button never feels a round-trip behind.
    const prev = state;
    setState({
      profileUsed: true,
      championUsed: prev?.championUsed ?? false,
      windowResetsAt: prev?.windowResetsAt ?? null,
    });
    setJustVoted(true);

    try {
      const res = await fetch('/api/rank-vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goatSlug: id, channel: 'profile' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Vote failed');
      setState({ profileUsed: data.profileUsed, championUsed: data.championUsed, windowResetsAt: data.windowResetsAt });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vote failed');
      setState(prev); // roll back the optimistic flip
      setJustVoted(false);
    } finally {
      setPending(false);
    }
  }

  const voted = state?.profileUsed ?? false;

  // Always wait for the session first — otherwise a logged-in user briefly
  // sees "Log in to vote" when the rank fetch resolves before the session.
  // Only a logged-in user can have a prior vote, so anonymous viewers don't
  // need to block on the rank fetch and get their button sooner.
  if (sessionLoading || (user && loading)) {
    return (
      <div class="h-11 flex items-center px-6 rounded-sm border border-hairline">
        <span class="font-mono text-xs uppercase tracking-widest text-mute animate-pulse">Loading…</span>
      </div>
    );
  }

  if (voted) {
    return (
      <div class="inline-flex flex-col justify-center">
        <div
          class="font-headline font-black uppercase text-base tracking-wider px-6 h-11 flex items-center gap-2 rounded-sm border"
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

  if (!user) {
    return (
      <div class="inline-flex flex-col">
        <button
          type="button"
          onClick={() => openAuthModal({ reason: `Log in to vote ${shortName}` })}
          class="font-headline font-black uppercase text-base tracking-wider px-6 h-11 flex items-center gap-2 rounded-sm bg-lime text-canvas hover:bg-lime-dark transition-colors whitespace-nowrap"
        >
          Log in to vote
        </button>
      </div>
    );
  }

  return (
    <div class="inline-flex flex-col">
      <button
        type="button"
        onClick={vote}
        disabled={pending}
        class="font-headline font-black uppercase text-base tracking-wider px-6 h-11 flex items-center gap-2 rounded-sm transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
        style={`background:${accent}; color:${textOn(accent)}`}
      >
        Vote {shortName}
        <span class="text-sm">✦</span>
      </button>
      {error && (
        <span class="font-mono text-[13px] uppercase tracking-widest text-red mt-1.5">{error}</span>
      )}
    </div>
  );
}
