import { getEntityBySlug } from './index';
import type { FloorEvent } from '../lib/queries';

type ArchiveMatch = Omit<FloorEvent, 'goats'> & {
  goatLinks: Array<{ slug: string; team: string }>;
};

const archive: ArchiveMatch[] = [
  {
    id: 'brazil-vs-south-korea-2022-12-05', competition: 'World Cup 2022',
    homeTeam: 'Brazil', awayTeam: 'South Korea', homeCode: 'BR', awayCode: 'KR',
    homeScore: 4, awayScore: 1, kickoff: new Date('2022-12-05T19:00:00.000Z'),
    status: 'finished', venue: 'Stadium 974, Doha', commentCount: 0,
    goatLinks: [{ slug: 'neymar', team: 'home' }],
  },
  {
    id: 'portugal-vs-switzerland-2022-12-06', competition: 'World Cup 2022',
    homeTeam: 'Portugal', awayTeam: 'Switzerland', homeCode: 'PT', awayCode: 'CH',
    homeScore: 6, awayScore: 1, kickoff: new Date('2022-12-06T19:00:00.000Z'),
    status: 'finished', venue: 'Lusail Iconic Stadium, Lusail', commentCount: 0,
    goatLinks: [{ slug: 'ronaldo', team: 'home' }],
  },
  {
    id: 'netherlands-vs-argentina-2022-12-09', competition: 'World Cup 2022',
    homeTeam: 'Netherlands', awayTeam: 'Argentina', homeCode: 'NL', awayCode: 'AR',
    homeScore: 2, awayScore: 2, kickoff: new Date('2022-12-09T19:00:00.000Z'),
    status: 'finished', venue: 'Lusail Iconic Stadium, Lusail', commentCount: 0,
    goatLinks: [{ slug: 'messi', team: 'away' }],
  },
  {
    id: 'argentina-vs-croatia-2022-12-13', competition: 'World Cup 2022',
    homeTeam: 'Argentina', awayTeam: 'Croatia', homeCode: 'AR', awayCode: 'HR',
    homeScore: 3, awayScore: 0, kickoff: new Date('2022-12-13T19:00:00.000Z'),
    status: 'finished', venue: 'Lusail Iconic Stadium, Lusail', commentCount: 0,
    goatLinks: [{ slug: 'messi', team: 'home' }],
  },
  {
    id: 'argentina-vs-france-2022-12-18', competition: 'World Cup 2022',
    homeTeam: 'Argentina', awayTeam: 'France', homeCode: 'AR', awayCode: 'FR',
    homeScore: 3, awayScore: 3, kickoff: new Date('2022-12-18T15:00:00.000Z'),
    status: 'finished', venue: 'Lusail Iconic Stadium, Lusail', commentCount: 0,
    goatLinks: [{ slug: 'messi', team: 'home' }, { slug: 'mbappe', team: 'away' }],
  },
];

export const archiveMatches: FloorEvent[] = archive.map(({ goatLinks, ...match }) => ({
  ...match,
  goats: goatLinks.flatMap(({ slug, team }) => {
    const goat = getEntityBySlug(slug);
    return goat
      ? [{ slug, shortName: goat.shortName, accent: goat.accent, team }]
      : [];
  }),
}));

export function getArchiveMatch(id: string | undefined): FloorEvent | undefined {
  return archiveMatches.find((match) => match.id === id);
}
