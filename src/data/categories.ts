/**
 * Category registry — the arenas GOATs compete in. Metadata only (labels,
 * chrome). The competitors themselves live in the per-category data files and
 * are aggregated in src/data/index.ts.
 */
export interface Category {
  id: string;
  label: string;
  /** Emoji used as the arena glyph across cards and grids. */
  emoji: string;
  /** Vivid accent for this arena's chrome (headers, category chips). */
  accent: string;
  /** One-liner shown on the categories grid and arena headers. */
  tagline: string;
  /** The debate this arena settles, e.g. "Bradman or Tendulkar?". */
  debate: string;
  /** Marquee rivalry to lead this arena with on the homepage showcase. */
  spotlightBattleSlug: string;
  /** false = coming soon (no roster yet). */
  active: boolean;
}

export const categories: Category[] = [
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

export function getCategory(id: string): Category | undefined {
  return categories.find((c) => c.id === id);
}

/** Category label with a safe fallback so pages never render "undefined". */
export function categoryLabel(id: string): string {
  return getCategory(id)?.label ?? id;
}

/** Category glyph with a neutral fallback. */
export function categoryEmoji(id: string): string {
  return getCategory(id)?.emoji ?? '🏆';
}
