/** Curated evergreen share images; other battle pages use summary cards. */
export const SHARE_BATTLE_SLUGS = [
  'messi-vs-ronaldo',
  'maradona-vs-pele',
  'federer-vs-nadal',
  'hamilton-vs-schumacher',
] as const;

export const shareBattleSlugs = new Set<string>(SHARE_BATTLE_SLUGS);
