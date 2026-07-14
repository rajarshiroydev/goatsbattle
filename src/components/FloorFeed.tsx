import { useEffect, useMemo, useState } from 'preact/hooks';
import { FLOOR_FILTERS, type FloorFilter } from '../lib/floorFilters';
import { compactNumber, flagEmoji, relativeTime } from '../lib/format';
import { useSession } from '../lib/useSession';

export interface FloorFeedEvent {
  id: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  homeCode: string | null;
  awayCode: string | null;
  homeScore: number | null;
  awayScore: number | null;
  kickoff: string;
  status: string;
  venue: string | null;
  commentCount: number;
  goats: Array<{ slug: string; shortName: string; accent: string; team: string | null }>;
}

interface Props {
  events: FloorFeedEvent[];
}

function textOn(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length < 6) return '#0d0d0f';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#0d0d0f' : '#f0f0f2';
}

function EventRow({ event }: { event: FloorFeedEvent }) {
  const isLive = event.status === 'live';
  const isUpcoming = event.status === 'scheduled';
  const hasScore = event.homeScore !== null && event.awayScore !== null;
  return (
    <a
      href={`/floor/${event.id}`}
      class="group flex items-center gap-4 bg-canvas-soft border border-hairline rounded-md px-[18px] py-3.5 hover:border-hairline-strong transition-colors"
      style={isLive ? 'border-left: 2px solid rgba(255,45,85,0.6)' : undefined}
    >
      <div class="shrink-0 w-16 flex flex-col items-start gap-1">
        {isLive ? (
          <span class="font-mono text-[10px] uppercase tracking-[0.12em] text-red flex items-center gap-1.5">
            <span class="live-dot gb-pulse-fast" style="--dot: var(--color-red)" /> Live
          </span>
        ) : (
          <span class="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">
            {isUpcoming ? 'Upcoming' : relativeTime(event.kickoff)}
          </span>
        )}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 font-headline font-black uppercase text-ink text-lg leading-none">
          <span class="truncate">{flagEmoji(event.homeCode ?? '')} {event.homeTeam}</span>
          {hasScore ? (
            <span class="font-mono text-sm text-body shrink-0">{event.homeScore}–{event.awayScore}</span>
          ) : (
            <span class="font-headline text-mute text-base italic shrink-0">vs</span>
          )}
          <span class="truncate">{event.awayTeam} {flagEmoji(event.awayCode ?? '')}</span>
        </div>
        <div class="mt-1.5 flex items-center gap-2 flex-wrap">
          <span class="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">{event.competition}</span>
          {event.goats.map((goat) => (
            <span key={goat.slug} class="team-tag" style={`--tag:${goat.accent}; --tag-fg:${textOn(goat.accent)}`}>
              {goat.shortName}
            </span>
          ))}
        </div>
      </div>
      <span class="shrink-0 flex items-center gap-1.5 font-mono text-[11px] text-mute whitespace-nowrap">
        <span class="text-lime">💬</span> {compactNumber(event.commentCount)}
      </span>
    </a>
  );
}

function readFilter(): FloorFilter {
  if (typeof window === 'undefined') return 'top';
  const value = new URLSearchParams(window.location.search).get('filter');
  return FLOOR_FILTERS.some((item) => item.key === value) ? value as FloorFilter : 'top';
}

export default function FloorFeed({ events }: Props) {
  const [filter, setFilter] = useState<FloorFilter>('top');
  const [personal, setPersonal] = useState<FloorFeedEvent[] | null>(null);
  const [personalError, setPersonalError] = useState(false);
  const { user, loading: sessionLoading } = useSession();

  useEffect(() => setFilter(readFilter()), []);

  useEffect(() => {
    if (filter !== 'mygoats' || !user) return;
    let active = true;
    setPersonal(null);
    setPersonalError(false);
    fetch('/api/floor?filter=mygoats')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { events: FloorFeedEvent[] }) => active && setPersonal(data.events))
      .catch(() => active && setPersonalError(true));
    return () => { active = false; };
  }, [filter, user?.id]);

  const shown = useMemo(() => {
    if (filter === 'mygoats') return personal ?? [];
    const copy = events.slice();
    if (filter === 'live') return copy.filter((event) => event.status === 'live');
    if (filter === 'recents') return copy.sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff));
    return copy.sort((a, b) => b.commentCount - a.commentCount || Date.parse(b.kickoff) - Date.parse(a.kickoff));
  }, [events, filter, personal]);

  const waitingForPersonal = filter === 'mygoats' && (sessionLoading || (user && personal === null && !personalError));
  const empty = filter === 'mygoats' && !user
    ? { head: 'Log in to see your goats', body: 'Sign in and we’ll surface the matches your GOATs played in.', href: '/login', cta: 'Log in' }
    : filter === 'mygoats'
      ? { head: 'No matches yet', body: personalError ? 'Your matches could not be loaded. Try again shortly.' : 'Back a GOAT by voting, and their matches show up here.', href: '/goats', cta: 'Find your GOAT' }
      : filter === 'live'
        ? { head: 'Nothing live right now', body: 'No matches are in progress. Check the top debates instead.', href: '/floor?filter=top', cta: 'Top debates' }
        : { head: 'The floor is open', body: 'No matches on the floor yet — check back soon.', href: '/goats', cta: 'Browse goats' };

  return (
    <>
      <section class="pt-7">
        <div class="page-container">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-3">
            <h1 class="font-headline font-black uppercase leading-none tracking-tight text-ink text-4xl md:text-[2.75rem]">The Floor</h1>
            <div class="flex flex-wrap items-center gap-1.5">
              {FLOOR_FILTERS.map((item) => (
                <a key={item.key} href={`/floor?filter=${item.key}`} class={`chip${item.key === filter ? ' chip-active' : ''}`} title={item.hint}>
                  {item.label}
                </a>
              ))}
            </div>
            <span class="ml-auto font-mono text-[11px] uppercase tracking-widest text-mute whitespace-nowrap">
              {shown.length} matches on the floor
            </span>
          </div>
        </div>
      </section>
      <section class="pt-[18px] pb-10">
        <div class="page-container flex flex-col gap-2.5">
          {waitingForPersonal ? (
            <div class="bg-canvas-soft border border-hairline rounded-md px-6 py-12 text-center font-sans text-body">Loading your matches…</div>
          ) : shown.length > 0 ? (
            <>
              {shown.map((event) => <EventRow key={event.id} event={event} />)}
              <span class="self-center mt-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-mute">That's every match so far</span>
            </>
          ) : (
            <div class="bg-canvas-soft border border-hairline rounded-md px-6 py-12 text-center">
              <p class="font-headline font-black uppercase text-2xl text-ink">{empty.head}</p>
              <p class="mt-2 font-sans text-body">{empty.body}</p>
              <a href={empty.href} class="btn btn-primary text-sm px-6 py-2.5 mt-5">{empty.cta}</a>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
