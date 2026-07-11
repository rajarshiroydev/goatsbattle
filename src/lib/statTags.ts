import { getEntityBySlug, getEntitiesByArena } from '../data';

/**
 * Stat tagging — the "settle it with a fact" mechanic. A comment references a
 * goat stat by (slug, label); the value is resolved live from the canonical
 * stat data in code so tags never drift from the source of truth.
 */
export interface StatTag {
  goatSlug: string;
  goatShortName: string;
  statLabel: string;
  value: string | number;
  unit?: string;
}

/** Resolve a (goat, stat label) reference to its current value, or null if gone. */
export function resolveStat(goatSlug: string, statLabel: string): StatTag | null {
  const goat = getEntityBySlug(goatSlug);
  if (!goat) return null;
  for (const section of goat.statSections) {
    const stat = section.stats.find((s) => s.label === statLabel);
    if (stat) {
      return {
        goatSlug,
        goatShortName: goat.shortName,
        statLabel,
        value: stat.value,
        ...(stat.unit ? { unit: stat.unit } : {}),
      };
    }
  }
  return null;
}

/** A goat whose stats can be tagged, flattened for the composer picker. */
export interface TaggableGoat {
  slug: string;
  shortName: string;
  accent: string;
  stats: Array<{ label: string; value: string | number; unit?: string }>;
}

/**
 * The taggable goats for a discussion — every goat in the subject's arena, with
 * `prioritySlugs` (the match's / battle's own goats) floated to the front so the
 * most relevant options are one click away. Stats are flattened across sections
 * (labels are unique within a goat) for a simple picker.
 */
export function taggableGoatsForArena(arena: string, prioritySlugs: string[] = []): TaggableGoat[] {
  const priority = new Set(prioritySlugs);
  return getEntitiesByArena(arena)
    .map((g) => ({
      slug: g.slug,
      shortName: g.shortName,
      accent: g.accent,
      stats: g.statSections.flatMap((s) =>
        s.stats.map((st) => ({ label: st.label, value: st.value, ...(st.unit ? { unit: st.unit } : {}) })),
      ),
    }))
    .sort((a, b) => {
      const pa = priority.has(a.slug) ? 0 : 1;
      const pb = priority.has(b.slug) ? 0 : 1;
      return pa - pb || a.shortName.localeCompare(b.shortName);
    });
}
