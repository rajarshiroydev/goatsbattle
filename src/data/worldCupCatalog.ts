import type { FloorEvent } from '../lib/queries';
import { worldCup2026Fixtures } from './worldCup2026';

export const worldCupEvents: FloorEvent[] = worldCup2026Fixtures.map((fixture) => ({
  id: fixture.id,
  competition: 'FIFA World Cup 2026',
  homeTeam: fixture.homeTeam,
  awayTeam: fixture.awayTeam,
  homeCode: fixture.homeCode,
  awayCode: fixture.awayCode,
  homeScore: fixture.homeScore,
  awayScore: fixture.awayScore,
  kickoff: new Date(fixture.kickoff),
  status: fixture.status,
  venue: fixture.venue,
  commentCount: 0,
  // Deliberately empty: this source has no trustworthy lineups, so GOAT
  // participation is never inferred from nationality or roster membership.
  goats: [],
}));

export function getWorldCupEvent(id: string | undefined) {
  return worldCupEvents.find((event) => event.id === id);
}

export function getWorldCupMatchNumber(id: string | undefined) {
  const match = id?.match(/^world-cup-2026-match-(\d{1,3})$/);
  const number = match ? Number(match[1]) : NaN;
  return Number.isInteger(number) && number >= 1 && number <= 104 ? number : null;
}
