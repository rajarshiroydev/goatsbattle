import { useEffect, useState } from 'preact/hooks';
import FloorEventRow, { type FloorFeedEvent } from './FloorEventRow';

export default function WorldCupHomeFeed({ events }: { events: FloorFeedEvent[] }) {
  const [current, setCurrent] = useState(events);

  useEffect(() => {
    let active = true;
    const refresh = () => fetch('/api/world-cup-status')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { matches: Array<Partial<FloorFeedEvent> & { id: string }> }) => {
        if (!active) return;
        const updates = new Map(data.matches.map((match) => [match.id, match]));
        setCurrent((matches) => matches.map((match) => ({
          ...match,
          ...(updates.get(match.id) ?? {}),
        })));
      })
      .catch(() => undefined);
    refresh();
    const poll = window.setInterval(refresh, 60_000);
    return () => { active = false; window.clearInterval(poll); };
  }, []);

  return <>{current.map((event) => <FloorEventRow key={event.id} event={event} />)}</>;
}
