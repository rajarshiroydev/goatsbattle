import { useEffect, useMemo, useState } from 'preact/hooks';
import { FLOOR_FILTERS, type FloorFilter } from '../lib/floorFilters';
import { useSession } from '../lib/useSession';
import FloorEventRow, { type FloorFeedEvent } from './FloorEventRow';

export type { FloorFeedEvent } from './FloorEventRow';

interface Props {
  events: FloorFeedEvent[];
}

function readFilter(): FloorFilter {
  if (typeof window === 'undefined') return 'top';
  const value = new URLSearchParams(window.location.search).get('filter');
  return FLOOR_FILTERS.some((item) => item.key === value) ? value as FloorFilter : 'top';
}

export default function FloorFeed({ events }: Props) {
  const [filter, setFilter] = useState<FloorFilter>('top');
  const [currentEvents, setCurrentEvents] = useState(events);
  const [personal, setPersonal] = useState<FloorFeedEvent[] | null>(null);
  const [personalError, setPersonalError] = useState(false);
  const { user, loading: sessionLoading } = useSession();

  useEffect(() => setFilter(readFilter()), []);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      fetch('/api/world-cup-status')
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then((data: { matches: Array<Partial<FloorFeedEvent> & { id: string }> }) => {
          if (!active) return;
          const updates = new Map(data.matches.map((match) => [match.id, match]));
          setCurrentEvents((current) => current.map((event) => ({
            ...event,
            ...(updates.get(event.id) ?? {}),
          })));
        })
        .catch(() => undefined);
    };
    refresh();
    const poll = window.setInterval(refresh, 60_000);
    return () => { active = false; window.clearInterval(poll); };
  }, []);

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
    const copy = currentEvents.slice();
    if (filter === 'live') return copy.filter((event) => event.status === 'live');
    if (filter === 'recents') return copy.sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff));
    return copy.sort((a, b) => b.commentCount - a.commentCount || Date.parse(b.kickoff) - Date.parse(a.kickoff));
  }, [currentEvents, filter, personal]);

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
              {shown.map((event) => <FloorEventRow key={event.id} event={event} />)}
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
