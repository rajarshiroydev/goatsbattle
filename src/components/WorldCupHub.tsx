import { useEffect, useMemo, useState } from 'preact/hooks';
import { flagEmoji } from '../lib/format';
import { formatLiveMatchClock, type LiveClockState } from '../lib/liveMatchClock';

type HubFilter = 'upcoming' | 'live' | 'results';

export interface WorldCupHubMatch {
  id: string;
  matchNumber: number;
  stage: string;
  status: string;
  homeTeam: string;
  awayTeam: string;
  homeCode: string | null;
  awayCode: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homePenaltyScore?: number | null;
  awayPenaltyScore?: number | null;
  kickoff: string;
  venue: string;
  delayed?: boolean;
  matchClock?: LiveClockState | null;
  goats?: Array<{ slug: string; shortName: string; team: string | null }>;
}

type StatusResponse = { matches: Array<Partial<WorldCupHubMatch> & { id: string }> };

const FEATURED = new Set([101, 102, 103, 104]);
const STAGE_LABEL: Record<string, string> = {
  group: 'Group stage',
  'round-of-32': 'Round of 32',
  'round-of-16': 'Round of 16',
  quarterfinal: 'Quarter-final',
  semifinal: 'Semi-final',
  'third-place': 'Bronze match',
  final: 'Final',
};

function countdown(kickoff: string, now: number) {
  const difference = Date.parse(kickoff) - now;
  if (difference <= 0) return null;
  const minutes = Math.floor(difference / 60_000);
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const mins = minutes % 60;
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${mins}m`;
}

function MatchRow({ match, now, featured = false }: { match: WorldCupHubMatch; now: number; featured?: boolean }) {
  const hasScore = match.homeScore !== null && match.awayScore !== null;
  const time = new Date(match.kickoff).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const remaining = countdown(match.kickoff, now);
  const clock = formatLiveMatchClock(match.matchClock ?? null, now);
  return (
    <a
      href={`/floor/${match.id}`}
      class={`block border rounded-md transition-colors hover:border-lime ${featured ? 'bg-canvas-soft-2 border-hairline-strong p-5' : 'bg-canvas-soft border-hairline px-4 py-3.5'}`}
    >
      <div class="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-mute">
        <span>Match {match.matchNumber} · {STAGE_LABEL[match.stage] ?? match.stage}</span>
        {match.status === 'live' ? (
          <span class="text-red flex items-center gap-1.5"><span class="live-dot gb-pulse-fast" style="--dot:var(--color-red)" />Live{clock ? ` · ${clock}` : ''}</span>
        ) : match.delayed ? <span class="text-red">Updates delayed</span> : <span>{remaining ?? (match.status === 'finished' ? 'Full time' : time)}</span>}
      </div>
      <div class={`mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3 ${featured ? 'text-2xl' : 'text-lg'}`}>
        <span class="font-headline font-black uppercase text-right text-ink leading-none">{flagEmoji(match.homeCode ?? '')} {match.homeTeam}</span>
        <span class="font-headline font-black text-ink tabular-nums">
          {hasScore ? `${match.homeScore}–${match.awayScore}` : <span class="italic text-mute text-base">VS</span>}
          {match.homePenaltyScore !== null && match.homePenaltyScore !== undefined
            && match.awayPenaltyScore !== null && match.awayPenaltyScore !== undefined
            && <span class="block font-mono text-[9px] text-mute text-center">{match.homePenaltyScore}–{match.awayPenaltyScore} pens</span>}
        </span>
        <span class="font-headline font-black uppercase text-left text-ink leading-none">{match.awayTeam} {flagEmoji(match.awayCode ?? '')}</span>
      </div>
      <div class="mt-3 flex items-center justify-between gap-3 font-sans text-xs text-mute">
        <span>{time}</span><span class="truncate text-right">{match.venue}</span>
      </div>
    </a>
  );
}

export default function WorldCupHub({ fixtures }: { fixtures: WorldCupHubMatch[] }) {
  const [filter, setFilter] = useState<HubFilter>('upcoming');
  const [matches, setMatches] = useState(fixtures);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () => fetch('/api/world-cup-status')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: StatusResponse) => {
        if (!active) return;
        const updates = new Map(data.matches.map((match) => [match.id, match]));
        setMatches((current) => current.map((match) => ({ ...match, ...updates.get(match.id) })));
      })
      .catch(() => undefined);
    refresh();
    const poll = window.setInterval(refresh, 120_000);
    return () => { active = false; window.clearInterval(poll); };
  }, []);

  const featured = matches.filter((match) => FEATURED.has(match.matchNumber));
  const shown = useMemo(() => {
    const filtered = matches.filter((match) => filter === 'upcoming'
      ? match.status === 'scheduled'
      : filter === 'live'
        ? match.status === 'live'
        : match.status === 'finished');
    return filtered.sort((a, b) => filter === 'results'
      ? Date.parse(b.kickoff) - Date.parse(a.kickoff)
      : Date.parse(a.kickoff) - Date.parse(b.kickoff));
  }, [filter, matches]);

  return (
    <>
      <section class="pt-8 pb-7 border-b border-hairline bg-canvas-deep">
        <div class="page-container">
          <p class="font-mono text-[11px] uppercase tracking-[0.16em] text-lime">FIFA World Cup 2026</p>
          <div class="mt-2 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <h1 class="font-headline font-black uppercase text-ink text-5xl sm:text-6xl leading-[0.9]">The World Cup Floor</h1>
              <p class="mt-3 max-w-2xl font-sans text-body">Every match has a thread. Four games remain; the greatness debates are already open.</p>
            </div>
            <span class="font-mono text-[11px] uppercase tracking-widest text-mute">104 matches · 1 tournament</span>
          </div>
        </div>
      </section>

      <section class="page-container py-7">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          {featured.map((match) => <MatchRow key={match.id} match={match} now={now} featured />)}
        </div>

        <div class="mt-9 flex flex-wrap items-center gap-2">
          {(['upcoming', 'live', 'results'] as HubFilter[]).map((value) => (
            <button type="button" class={`chip${filter === value ? ' chip-active' : ''}`} onClick={() => setFilter(value)}>
              {value}
            </button>
          ))}
          <span class="ml-auto font-mono text-[11px] uppercase tracking-widest text-mute">{shown.length} matches</span>
        </div>

        <div class="mt-4 flex flex-col gap-2.5">
          {shown.length > 0 ? shown.map((match) => <MatchRow key={match.id} match={match} now={now} />) : (
            <div class="bg-canvas-soft border border-hairline rounded-md px-6 py-12 text-center">
              <p class="font-headline font-black uppercase text-2xl text-ink">Nothing live right now</p>
              <p class="mt-2 font-sans text-body">The next match thread is already open above.</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
