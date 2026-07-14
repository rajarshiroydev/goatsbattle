import { useEffect, useState } from 'preact/hooks';
import { flagEmoji } from '../lib/format';
import type { WorldCupHubMatch } from './WorldCupHub';

type StatusResponse = { matches: Array<Partial<WorldCupHubMatch> & { id: string }> };

export default function WorldCupMatchHeader({ initial }: { initial: WorldCupHubMatch }) {
  const [match, setMatch] = useState(initial);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return Promise.resolve();
      return fetch('/api/world-cup-status')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: StatusResponse) => {
        if (!active) return;
        const update = data.matches.find((item) => item.id === initial.id);
        if (update) setMatch((current) => ({ ...current, ...update }));
      })
      .catch(() => undefined);
    };
    refresh();
    const poll = window.setInterval(refresh, 10_000);
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
    <div class="bg-canvas-soft border border-hairline rounded-lg overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 sm:px-6 py-3.5 border-b border-hairline font-mono text-[10px] sm:text-[10.5px] uppercase tracking-[0.14em] text-mute">
        <span>FIFA World Cup 2026 · Match {match.matchNumber}</span>
        <span class="flex items-center gap-3">
          {match.status === 'live' ? (
            <span class="inline-flex items-center gap-1.5 text-red"><span class="live-dot gb-pulse-fast" style="--dot:var(--color-red)" />Live</span>
          ) : <span class={match.status === 'finished' ? 'border border-hairline rounded-full px-2.5 py-1' : ''}>{match.status === 'finished' ? 'Full time' : `Kickoff in ${countdown}`}</span>}
          {match.delayed && <span class="text-red">Updates delayed</span>}
        </span>
      </div>
      <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4 px-4 sm:px-6 py-6 sm:py-7">
        <div class="flex flex-col sm:flex-row items-center sm:justify-end gap-1.5 sm:gap-4">
          <span class="font-headline font-black uppercase text-ink text-2xl sm:text-4xl md:text-5xl leading-none text-center sm:text-right">{match.homeTeam}</span>
          <span class="text-3xl sm:text-4xl leading-none order-first sm:order-none">{flagEmoji(match.homeCode ?? '')}</span>
        </div>
        <div class="flex flex-col items-center gap-1.5 px-1 sm:px-5">
          <div class="flex items-center justify-center gap-2 sm:gap-4">
            {hasScore ? (
              <>
                <span class="font-headline font-black text-lime text-4xl sm:text-6xl leading-none tabular-nums">{match.homeScore}</span>
                <span class="font-headline font-black text-hairline-strong text-2xl sm:text-4xl leading-none">–</span>
                <span class="font-headline font-black text-red text-4xl sm:text-6xl leading-none tabular-nums">{match.awayScore}</span>
              </>
            ) : <span class="font-headline font-black italic text-mute text-xl sm:text-3xl leading-none">VS</span>}
          </div>
          {match.homePenaltyScore !== null && match.homePenaltyScore !== undefined
            && match.awayPenaltyScore !== null && match.awayPenaltyScore !== undefined
            && <span class="font-mono text-[10px] uppercase tracking-wider text-mute whitespace-nowrap">{match.homePenaltyScore}–{match.awayPenaltyScore} pens</span>}
        </div>
        <div class="flex flex-col sm:flex-row items-center sm:justify-start gap-1.5 sm:gap-4">
          <span class="text-3xl sm:text-4xl leading-none">{flagEmoji(match.awayCode ?? '')}</span>
          <span class="font-headline font-black uppercase text-ink text-2xl sm:text-4xl md:text-5xl leading-none text-center sm:text-left">{match.awayTeam}</span>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 sm:px-6 py-3.5 border-t border-hairline bg-sunken font-mono text-[10.5px] uppercase tracking-[0.12em] text-mute">
        <span>{kickoff.toLocaleString(undefined, { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}</span>
        <span class="text-hairline-strong">·</span>
        <span>{match.venue}</span>
        {match.goats && match.goats.length > 0 && (
          <span class="flex items-center gap-1.5 ml-auto">
            <span class="normal-case tracking-normal">Goats on the pitch:</span>
            {match.goats.map((goat) => (
              <a key={goat.slug} href={`/goats/${goat.slug}`} class="team-tag hover:border-lime hover:text-ink transition-colors">
                {goat.shortName}
              </a>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
