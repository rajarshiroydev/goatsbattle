/**
 * Populates head-to-head vote tallies on every battle so each goat's profile
 * "Hottest Battles" strip renders real matchups instead of the empty state.
 *
 * The base seed.ts inserts every canonical pairing with 0/0 votes, which
 * getContestedBattlesForEntity filters out (it requires total > 0). This script
 * gives each battle a deterministic, plausible tally: totals and splits are
 * derived from a hash of the battle id, so re-running is stable and idempotent.
 *
 * Only touches battles still sitting at 0/0 — real votes are never overwritten.
 *
 * Run with:  npm run db:seed:votes   (loads .env via --env-file)
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { allBattlePairs } from '../src/data';
import { getBattleId } from '../src/lib/battle';
import { battles } from '../src/lib/db/schema';

/** Deterministic 32-bit hash of a string (FNV-1a). */
function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A small pseeded PRNG so multiple draws from one id stay independent. */
function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = Math.imul(s ^ (s >>> 15), s | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive a plausible (votesA, votesB) split for a battle id. */
function tallyFor(id: string): { votesA: number; votesB: number } {
  const r = rng(hash(id));
  // Totals span quiet matchups to marquee ones.
  const total = 150 + Math.floor(r() * 4850); // 150 – 5000
  // Bias share toward 0.5 so plenty of battles read as genuinely contested,
  // but allow the occasional blowout. Average of two draws hugs the middle.
  const share = (r() + r()) / 2; // ~0.2 – 0.8, centred on 0.5
  const votesA = Math.max(1, Math.round(total * share));
  const votesB = Math.max(1, total - votesA);
  return { votesA, votesB };
}

async function main() {
  console.log('→ Seeding battle vote tallies…');
  let updated = 0;

  for (const [a, b] of allBattlePairs) {
    const id = getBattleId(a, b);
    const { votesA, votesB } = tallyFor(id);

    const res = await db
      .update(battles)
      .set({ votesA, votesB })
      // Only fill in untouched battles; never clobber real votes.
      .where(and(eq(battles.id, id), eq(battles.votesA, 0), eq(battles.votesB, 0)));

    // neon-http returns rowCount on the result.
    updated += (res as unknown as { rowCount?: number }).rowCount ?? 0;
  }

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(battles)
    .where(sql`${battles.votesA} + ${battles.votesB} > 0`);

  console.log(`  ✓ Filled ${updated} battle(s).`);
  console.log(`\n✓ Done. ${row.count} battles now have votes.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
