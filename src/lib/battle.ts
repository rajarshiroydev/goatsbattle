export function getBattleId(slugA: string, slugB: string): string {
  return [slugA, slugB].sort().join('-vs-');
}

export function parseBattleSlug(slug: string): [string, string] | null {
  const parts = slug.split('-vs-');
  if (parts.length !== 2) return null;
  return [parts[0], parts[1]];
}

export function getAllBattlePairs(slugs: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      const [a, b] = [slugs[i], slugs[j]].sort() as [string, string];
      pairs.push([a, b]);
    }
  }
  return pairs;
}

export function getCanonicalBattleSlug(slugA: string, slugB: string): string {
  return getBattleId(slugA, slugB);
}
