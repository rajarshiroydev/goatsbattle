import { getEntityBySlug, getEntitiesByArena } from '../data';
import type { CommentStatTag } from './commentWire';

/**
 * Stat tagging — the "settle it with a fact" mechanic. A comment references a
 * goat stat by (slug, label); the value is resolved live from the canonical
 * stat data in code so tags never drift from the source of truth.
 */
export type StatTag = CommentStatTag;

/** A (goat, stat) reference a comment cites, before value resolution. The single
 * source of truth for the request contract, shared by the client and service. */
export interface StatTagInput {
  goatSlug: string;
  statLabel: string;
}

/** Cap on stat tags per comment — keeps a comment an argument, not a spreadsheet. */
export const MAX_STAT_TAGS = 6;

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

export type ResolveStatTagInputsResult =
  | { ok: true; tags: StatTag[]; requested: number }
  | { ok: false; error: string };

/** Validate and deduplicate the complete submitted set. Unknown references are
 * never dropped: the caller must reject the comment so its citations remain
 * exactly what the author selected. */
export function resolveStatTagInputs(inputs: readonly StatTagInput[]): ResolveStatTagInputsResult {
  if (inputs.length > MAX_STAT_TAGS) {
    return { ok: false, error: `Too many stat tags (max ${MAX_STAT_TAGS})` };
  }
  const seen = new Set<string>();
  const tags: StatTag[] = [];
  for (const input of inputs) {
    const key = `${input.goatSlug}|${input.statLabel}`;
    if (seen.has(key)) continue;
    const tag = resolveStat(input.goatSlug, input.statLabel);
    if (!tag) return { ok: false, error: `Unknown stat tag: ${input.goatSlug} · ${input.statLabel}` };
    seen.add(key);
    tags.push(tag);
  }
  return { ok: true, tags, requested: inputs.length };
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
