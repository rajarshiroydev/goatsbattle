import type { Entity } from '../lib/types';
import { getAllBattlePairs, getBattleId } from '../lib/battle';
import { categories } from './categories';
import { footballEntities } from './football';
import { cricketEntities } from './cricket';
import { tennisEntities } from './tennis';
import { f1Entities } from './f1';

/**
 * The single source of truth for every GOAT candidate across all arenas.
 * Per-category files hold the roster + stats; this module aggregates them and
 * exposes the category-agnostic lookups the rest of the app builds on. Slugs
 * are globally unique, so a slug alone resolves an entity without its category.
 */
export const allEntities: Entity[] = [
  ...footballEntities,
  ...cricketEntities,
  ...tennisEntities,
  ...f1Entities,
];

export { categories };
export type { Category } from './categories';

export function getEntityBySlug(slug: string): Entity | undefined {
  return allEntities.find((e) => e.slug === slug);
}

/** Every entity in a category, in dataset order. */
export function getEntitiesByCategory(category: string): Entity[] {
  return allEntities.filter((e) => e.category === category);
}

/** A category's roster with active competitors listed first. */
export function getRoster(category: string): Entity[] {
  return getEntitiesByCategory(category).sort(
    (a, b) => Number(b.active) - Number(a.active),
  );
}

export function getCategorySlugs(category: string): string[] {
  return getEntitiesByCategory(category).map((e) => e.slug);
}

/**
 * Every canonical battle pairing, computed once at module load. Pairs are
 * generated within each category only — two entities from different arenas
 * never battle.
 */
export const battlePairsByCategory: Record<string, Array<[string, string]>> =
  Object.fromEntries(
    categories.map((c) => [c.id, getAllBattlePairs(getCategorySlugs(c.id))]),
  );

export const allBattlePairs: Array<[string, string]> = categories.flatMap(
  (c) => battlePairsByCategory[c.id],
);

export interface EntityBattle {
  battleSlug: string;
  opponent: Entity;
}

/**
 * All battles involving `slug`, resolved to the opponent entity. Because pairs
 * are category-scoped, this only ever returns same-arena opponents.
 * Pass `exclude` to drop a specific opponent and `limit` to cap the count.
 */
export function getBattlesForEntity(
  slug: string,
  opts: { exclude?: string; limit?: number } = {},
): EntityBattle[] {
  const { exclude, limit } = opts;
  // Pairs are category-scoped, so only this entity's arena can contain its battles.
  const category = getEntityBySlug(slug)?.category;
  const battles = (category ? battlePairsByCategory[category] : allBattlePairs)
    .filter(([a, b]) => (a === slug || b === slug) && a !== exclude && b !== exclude)
    .map(([a, b]) => ({
      battleSlug: getBattleId(a, b),
      opponent: getEntityBySlug(a === slug ? b : a)!,
    }));
  return limit ? battles.slice(0, limit) : battles;
}
