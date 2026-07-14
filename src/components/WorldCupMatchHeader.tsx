import { useEffect, useState } from 'preact/hooks';
import { flagEmoji } from '../lib/format';
import type { WorldCupHubMatch } from './WorldCupHub';

type StatusResponse = { matches: Array<Partial<WorldCupHubMatch> & { id: string }> };

export default function WorldCupMatchHeader({ initial }: { initial: WorldCupHubMatch }) {
  const [match, setMatch] = useState(initial);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let active = true;
    const refresh = () => fetch('/api/world-cup-status')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: StatusResponse) => {
        if (!active) return;
        const update = data.matches.find((item) => item.id === initial.id);
        if (update) setMatch((current) => ({ ...current, ...update }));
      })
      .catch(() => undefined);
    refresh();
    const poll = window.setInterval(refresh, 120_000);
    const clock = window.setInterval(() => {
      if (active) setNow(Date.now());
    }, 60_000);
    return () => {
      active = false;
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [initial.id]);

  const hasScore = match.homeScore !== null && match.awayScore !== null;
  const kickoff = new Date(match.kickoff);
  const minutes = Math.max(0, Math.floor((kickoff.getTime() - now) / 60_000));
  const countdown = minutes >= 1_440
    ? `${Math.floor(minutes / 1_440)}d ${Math.floor((minutes % 1_440) / 60)}h`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

  return (
    <div class="bg-canvas-soft border border-hairline rounded-lg px-5 py-5 sm:px-7 sm:py-6">
      <div class="flex flex-wrap items-center gap-3 mb-4 font-mono text-[10px] uppercase tracking-[0.14em] text-mute">
        <span>FIFA World Cup 2026 · Match {match.matchNumber}</span>
        {match.status === 'live' ? (
          <span class="text-red flex items-center gap-1.5"><span class="live-dot gb-pulse-fast" style="--dot:var(--color-red)" />Live</span>
        ) : <span>{match.status === 'finished' ? 'Full time' : `Kickoff in ${countdown}`}</span>}
        {match.delayed && <span class="ml-auto text-red">Updates delayed</span>}
      </div>
      <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6">
        <div class="text-right">
          <div class="text-3xl sm:text-4xl leading-none mb-1">{flagEmoji(match.homeCode ?? '')}</div>
          <div class="font-headline font-black uppercase text-ink text-2xl sm:text-3xl leading-none">{match.homeTeam}</div>
        </div>
        <div class="text-center px-1 font-headline font-black text-ink text-4xl sm:text-5xl leading-none tabular-nums">
          {hasScore ? <>{match.homeScore}<span class="text-mute px-1">–</span>{match.awayScore}</> : <span class="italic text-mute text-2xl">VS</span>}
          {match.homePenaltyScore !== null && match.homePenaltyScore !== undefined
            && match.awayPenaltyScore !== null && match.awayPenaltyScore !== undefined
            && <span class="block mt-2 font-mono text-[10px] uppercase tracking-wider text-mute">{match.homePenaltyScore}–{match.awayPenaltyScore} pens</span>}
        </div>
        <div class="text-left">
          <div class="text-3xl sm:text-4xl leading-none mb-1">{flagEmoji(match.awayCode ?? '')}</div>
          <div class="font-headline font-black uppercase text-ink text-2xl sm:text-3xl leading-none">{match.awayTeam}</div>
        </div>
      </div>
      <div class="mt-5 pt-4 border-t border-hairline flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] uppercase tracking-[0.1em] text-mute">
        <span>{kickoff.toLocaleString(undefined, { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}</span>
        <span>· {match.venue}</span>
        {match.goats?.map((goat) => (
          <a key={goat.slug} href={`/goats/${goat.slug}`} class="team-tag hover:border-lime hover:text-ink transition-colors">
            {goat.shortName}
          </a>
        ))}
      </div>
    </div>
  );
}
