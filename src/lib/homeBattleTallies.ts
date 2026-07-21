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
const MAX_ATTEMPTS = 3;

const retryDelay = (attempt: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, 750 * (2 ** attempt)));

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface RequestTalliesOptions {
  fetcher?: Fetcher;
  wait?: (attempt: number) => Promise<void>;
}

export async function requestTallies(
  query: string,
  { fetcher = fetch, wait = retryDelay }: RequestTalliesOptions = {},
): Promise<BattleTally[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetcher(`/api/home-battles?${query}`);
      if (!response.ok) throw new Error(`home-battles returned ${response.status}`);
      return await response.json() as BattleTally[];
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS - 1) await wait(attempt);
    }
  }
  throw lastError;
}

function load(slugs: string[]) {
  if (pending) return pending;
  const query = slugs.map((slug) => `battle=${encodeURIComponent(slug)}`).join('&');
  pending = requestTallies(query)
    .then((rows: BattleTally[]) => new Map(rows.map((row) => [row.slug, row])))
    .catch((error) => {
      // Clear the memo after the bounded shared retry sequence. A later-mounted
      // caller can then try again instead of inheriting a permanent rejection.
      pending = null;
      throw error;
    });
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
    load(battles.map((b) => b.slug))
      .then((tallies) => {
        if (!active) return;
        setCurrent((deck) => deck.map((b) => {
          const tally = tallies.get(b.slug);
          return tally && tally.total > 0 ? apply(b, tally) : b;
        }));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [battles]);

  return current;
}
