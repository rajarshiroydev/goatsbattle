import { allBattlePairs, allEntities, getEntityBySlug } from '../data';
import type { BattleSummary, RankingRow } from './queries';
import { getBattleId } from './battle';

const FEATURED_ORDER = [
  'messi-vs-ronaldo',
  'maradona-vs-pele',
  'messi-vs-pele',
  'cruyff-vs-pele',
  'mbappe-vs-messi',
  'maradona-vs-messi',
];

const featuredRank = (slug: string) => {
  const index = FEATURED_ORDER.indexOf(slug);
  return index === -1 ? FEATURED_ORDER.length : index;
};

/**
 * Build-safe catalog used by prerendered acquisition pages. Mutable vote state
 * is deliberately zeroed and hydrated only by interactive API-backed islands.
 * This keeps database credentials and database work out of static rendering.
 */
export function getStaticBattleSummaries(arena?: string): BattleSummary[] {
  const summaries: BattleSummary[] = [];
  for (const [slugA, slugB] of allBattlePairs) {
    const a = getEntityBySlug(slugA);
    const b = getEntityBySlug(slugB);
    if (!a || !b || (arena && a.arena !== arena)) continue;
    summaries.push({
        slug: getBattleId(slugA, slugB),
        arena: a.arena,
        a,
        b,
        votesA: 0,
        votesB: 0,
        total: 0,
        pctA: 50,
        pctB: 50,
        leader: 'tie',
        margin: 0,
    });
  }
  return summaries.sort((a, b) => featuredRank(a.slug) - featuredRank(b.slug));
}

/** Build-safe, zero-tally ranking snapshot for a fresh public database. */
export function getStaticRankings(arena?: string): RankingRow[] {
  return allEntities
    .filter((entity) => !arena || entity.arena === arena)
    .map((entity, index) => ({
      rank: index + 1,
      entity,
      votes: 0,
      votesFor: 0,
      votesAgainst: 0,
      headToHeadVotes: 0,
      winRate: 0,
    }));
}
