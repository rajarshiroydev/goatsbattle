import { inArray, sql } from 'drizzle-orm';
import { db } from './db';
import { votes } from './db/schema';
import { textOn } from './colorContrast';
import { getEntityBySlug } from '../data';

/**
 * A user's "fan tag" — the goat they back most, shown before their username in
 * discussions (design-guide §"Team tag"). Derived from their voting history; a
 * dedicated allegiance picker is a future enhancement.
 */
export interface FanTag {
  /** Goat slug, e.g. "messi". */
  slug: string;
  /** Uppercase short name for the tag, e.g. "MESSI". */
  label: string;
  /** Background accent (the goat's colour). */
  bg: string;
  /** Readable foreground for that background. */
  fg: string;
}

/**
 * Batch-resolve fan tags for a set of users. For each user we take the goat they
 * have voted for most; users with no votes (or an unresolvable choice) are
 * omitted. One grouped query for the whole set — cheap enough for a comment page.
 */
export async function getFanTags(userIds: string[]): Promise<Map<string, FanTag>> {
  const out = new Map<string, FanTag>();
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return out;

  const rows = await db
    .select({ userId: votes.userId, choice: votes.choice, n: sql<number>`count(*)::int` })
    .from(votes)
    .where(inArray(votes.userId, ids))
    .groupBy(votes.userId, votes.choice);

  // Reduce to each user's top choice (highest count wins).
  const top = new Map<string, { choice: string; n: number }>();
  for (const r of rows) {
    if (!r.userId) continue;
    const cur = top.get(r.userId);
    if (!cur || r.n > cur.n) top.set(r.userId, { choice: r.choice, n: r.n });
  }

  for (const [userId, { choice }] of top) {
    const goat = getEntityBySlug(choice);
    if (!goat) continue;
    out.set(userId, {
      slug: goat.slug,
      label: goat.shortName.toUpperCase(),
      bg: goat.accent,
      fg: textOn(goat.accent),
    });
  }
  return out;
}
