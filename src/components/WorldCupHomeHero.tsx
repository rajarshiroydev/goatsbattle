import { useEffect, useMemo, useState } from 'preact/hooks';
import { flagEmoji } from '../lib/format';
import type { WorldCupHubMatch } from './WorldCupHub';

function stageLabel(stage: string) {
  return stage.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function selectHeroMatch(matches: readonly WorldCupHubMatch[]) {
  return matches.find((match) => match.status === 'live')
    ?? matches.filter((match) => match.status === 'scheduled')
      .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))[0]
    ?? matches.slice().sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff))[0];
}

export default function WorldCupHomeHero({ fixtures }: { fixtures: WorldCupHubMatch[] }) {
  const [matches, setMatches] = useState(fixtures);
  useEffect(() => {
    let active = true;
    const refresh = () => fetch('/api/world-cup-status')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { matches: Array<Partial<WorldCupHubMatch> & { id: string }> }) => {
        if (!active) return;
        const updates = new Map(data.matches.map((match) => [match.id, match]));
        setMatches((current) => current.map((match) => ({
          ...match,
          ...(updates.get(match.id) ?? {}),
        })));
      })
      .catch(() => undefined);
    refresh();
    const poll = window.setInterval(refresh, 60_000);
    return () => { active = false; window.clearInterval(poll); };
  }, []);

  const match = useMemo(() => selectHeroMatch(matches), [matches]);
  if (!match) return null;
  const stage = stageLabel(match.stage);
  const kickoff = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC', timeZoneName: 'short',
  }).format(new Date(match.kickoff));
  const finished = match.status === 'finished';
  const live = match.status === 'live';
  const hasScore = match.homeScore !== null && match.awayScore !== null;

  return (
    <section class="border-b border-hairline overflow-x-clip" style="background: radial-gradient(ellipse 80% 75% at 18% 115%, rgba(200,255,0,0.11), transparent 62%)">
      <div class="page-container py-11">
        <div class="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-8 lg:gap-12 items-center">
          <div>
            <span class="chip chip-active">World Cup 2026 · Match {match.matchNumber}</span>
            <h1 class="mt-4 font-headline font-black uppercase text-ink leading-[0.88] tracking-tight text-[clamp(3rem,7.5vw,72px)]">
              The world is on <span class="text-lime">the floor.</span>
            </h1>
            <p class="mt-4 font-sans text-body text-base leading-relaxed max-w-md">
              Follow all 104 matches, then make the case in the main match thread. The {stage.toLowerCase()} is ready for your take.
            </p>
            <div class="mt-6 flex flex-wrap gap-2.5">
              <a href={`/floor/${match.id}`} class="btn btn-primary text-base px-6 py-3">Join the discussion</a>
              <a href="/world-cup" class="btn btn-secondary text-base px-6 py-3">View all 104 matches</a>
            </div>
          </div>
          <a href={`/floor/${match.id}`} class="block bg-canvas-soft border border-hairline rounded-lg p-5 sm:p-6 hover:border-hairline-strong transition-colors">
            <div class="flex items-center justify-between gap-3">
              <span class="font-mono text-[11px] uppercase tracking-[0.14em] text-lime">{stage} · {live ? 'Live' : finished ? 'Full time' : 'Upcoming'}</span>
              <span class="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">Discuss →</span>
            </div>
            <div class="mt-7 grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
              <div class="text-center min-w-0">
                <span class="text-3xl" aria-hidden="true">{flagEmoji(match.homeCode ?? '')}</span>
                <p class="mt-2 font-headline font-black uppercase text-xl sm:text-2xl text-ink truncate">{match.homeTeam}</p>
              </div>
              <span class="font-headline font-black italic text-2xl text-mute">{hasScore ? `${match.homeScore}–${match.awayScore}` : 'vs'}</span>
              <div class="text-center min-w-0">
                <span class="text-3xl" aria-hidden="true">{flagEmoji(match.awayCode ?? '')}</span>
                <p class="mt-2 font-headline font-black uppercase text-xl sm:text-2xl text-ink truncate">{match.awayTeam}</p>
              </div>
            </div>
            <div class="mt-7 pt-4 border-t border-hairline text-center">
              <p class="font-mono text-xs uppercase tracking-[0.1em] text-body">{kickoff}</p>
              <p class="mt-1 font-sans text-xs text-mute">{match.venue}</p>
            </div>
          </a>
        </div>
      </div>
    </section>
  );
}
