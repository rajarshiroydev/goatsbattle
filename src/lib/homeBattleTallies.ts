import { useEffect, useState } from 'preact/hooks';

export interface BattleTally {
  slug: string;
  /** Left side's share of the vote (0–100). */
  leftPct: number;
  total: number;
}

/**
 * One in-flight request per page load, shared by every island that renders the
 * homepage battle board. Without this the carousel and the ticker would each
 * fetch — and, worse, could render different percentages for the same battle.
 */
let pending: Promise<Map<string, BattleTally>> | null = null;

function load(slugs: string[]) {
  if (pending) return pending;
  const query = slugs.map((slug) => `battle=${encodeURIComponent(slug)}`).join('&');
  pending = fetch(`/api/home-battles?${query}`)
    .then((response) => response.ok ? response.json() : Promise.reject())
    .then((rows: BattleTally[]) => new Map(rows.map((row) => [row.slug, row])))
    .catch(() => new Map<string, BattleTally>());
  return pending;
}

/**
 * Replaces the static 50/50 placeholder with live tallies after mount. A battle
 * with no votes yet keeps its placeholder rather than rendering a misleading
 * 0-vote landslide.
 */
export function useBattleTallies<T extends { slug: string; leftPct: number }>(
  battles: T[],
  apply: (battle: T, tally: BattleTally) => T,
): T[] {
  const [current, setCurrent] = useState(battles);

  useEffect(() => {
    if (battles.length === 0) return;
    let active = true;
    load(battles.map((b) => b.slug)).then((tallies) => {
      if (!active) return;
      setCurrent((deck) => deck.map((b) => {
        const tally = tallies.get(b.slug);
        return tally && tally.total > 0 ? apply(b, tally) : b;
      }));
    });
    return () => { active = false; };
  }, [battles]);

  return current;
}
