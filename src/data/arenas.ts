/**
 * Arena registry — the arenas GOATs compete in. Metadata only (labels,
 * chrome). The competitors themselves live in the per-arena data files and
 * are aggregated in src/data/index.ts.
 */
export interface Arena {
  id: string;
  label: string;
  /** Emoji used as the arena glyph across cards and grids. */
  emoji: string;
  /** Vivid accent for this arena's chrome (headers, arena chips). */
  accent: string;
  /** One-liner shown on the arenas grid and arena headers. */
  tagline: string;
  /** The debate this arena settles, e.g. "Bradman or Tendulkar?". */
  debate: string;
  /** Marquee rivalry to lead this arena with on the homepage showcase. */
  spotlightBattleSlug: string;
  /** false = coming soon (no roster yet). */
  active: boolean;
}

export const arenas: Arena[] = [
  {
    id: 'football',
    label: 'Football',
    emoji: '⚽',
    accent: '#C6FF00',
    tagline: 'The beautiful game\'s eternal argument.',
    debate: 'Messi or Ronaldo?',
    spotlightBattleSlug: 'messi-vs-ronaldo',
    active: true,
  },
  {
    id: 'cricket',
    label: 'Cricket',
    emoji: '🏏',
    accent: '#2E7DD1',
    tagline: 'Willow, leather, and a century of legends.',
    debate: 'Bradman or Tendulkar?',
    spotlightBattleSlug: 'bradman-vs-tendulkar',
    active: true,
  },
  {
    id: 'tennis',
    label: 'Tennis',
    emoji: '🎾',
    accent: '#22A06B',
    tagline: 'The Big Three and the ghosts of Grand Slams past.',
    debate: 'Federer, Nadal or Djokovic?',
    spotlightBattleSlug: 'federer-vs-nadal',
    active: true,
  },
  {
    id: 'f1',
    label: 'Formula 1',
    emoji: '🏎️',
    accent: '#E8202A',
    tagline: 'Twenty drivers, one throne, zero agreement.',
    debate: 'Schumacher or Hamilton?',
    spotlightBattleSlug: 'hamilton-vs-schumacher',
    active: true,
  },
];

export function getArena(id: string): Arena | undefined {
  return arenas.find((c) => c.id === id);
}

/** Arena label with a safe fallback so pages never render "undefined". */
export function arenaLabel(id: string): string {
  return getArena(id)?.label ?? id;
}

/** Arena glyph with a neutral fallback. */
export function arenaEmoji(id: string): string {
  return getArena(id)?.emoji ?? '🏆';
}
