import FloorEventRow, { type FloorFeedEvent } from './FloorEventRow';
import { useWorldCupStatus } from '../lib/useWorldCupStatus';

export default function WorldCupHomeFeed({ events }: { events: FloorFeedEvent[] }) {
  const current = useWorldCupStatus(events);
  return <>{current.map((event) => <FloorEventRow key={event.id} event={event} />)}</>;
}
