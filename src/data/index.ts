import type { Entity } from '../lib/types';
import { getAllBattlePairs, getBattleId } from '../lib/battle';
import { arenas } from './arenas';
import { footballEntities } from './football';
import { cricketEntities } from './cricket';
import { tennisEntities } from './tennis';
import { f1Entities } from './f1';

/**
 * The single source of truth for every GOAT candidate across all arenas.
 * Per-arena files hold the roster + stats; this module aggregates them and
 * exposes the arena-agnostic lookups the rest of the app builds on. Slugs
 * are globally unique, so a slug alone resolves an entity without its arena.
 */
export const allEntities: Entity[] = [
  ...footballEntities,
  ...cricketEntities,
  ...tennisEntities,
  ...f1Entities,
];

export { arenas };
export type { Arena } from './arenas';

export function getEntityBySlug(slug: string): Entity | undefined {
  return allEntities.find((e) => e.slug === slug);
}

/** Every entity in an arena, in dataset order. */
export function getEntitiesByArena(arena: string): Entity[] {
  return allEntities.filter((e) => e.arena === arena);
}

/** An arena's roster with active competitors listed first. */
export function getRoster(arena: string): Entity[] {
  return getEntitiesByArena(arena).sort(
    (a, b) => Number(b.active) - Number(a.active),
  );
}

export function getArenaSlugs(arena: string): string[] {
  return getEntitiesByArena(arena).map((e) => e.slug);
}

/**
 * Every canonical battle pairing, computed once at module load. Pairs are
 * generated within each arena only — two entities from different arenas
 * never battle.
 */
export const battlePairsByArena: Record<string, Array<[string, string]>> =
  Object.fromEntries(
    arenas.map((c) => [c.id, getAllBattlePairs(getArenaSlugs(c.id))]),
  );

export const allBattlePairs: Array<[string, string]> = arenas.flatMap(
  (c) => battlePairsByArena[c.id],
);

export interface EntityBattle {
  battleSlug: string;
  opponent: Entity;
}

/**
 * All battles involving `slug`, resolved to the opponent entity. Because pairs
 * are arena-scoped, this only ever returns same-arena opponents.
 * Pass `exclude` to drop a specific opponent and `limit` to cap the count.
 */
export function getBattlesForEntity(
  slug: string,
  opts: { exclude?: string; limit?: number } = {},
): EntityBattle[] {
  const { exclude, limit } = opts;
  // Pairs are arena-scoped, so only this entity's arena can contain its battles.
  const arena = getEntityBySlug(slug)?.arena;
  const battles = (arena ? battlePairsByArena[arena] : allBattlePairs)
    .filter(([a, b]) => (a === slug || b === slug) && a !== exclude && b !== exclude)
    .map(([a, b]) => ({
      battleSlug: getBattleId(a, b),
      opponent: getEntityBySlug(a === slug ? b : a)!,
    }));
  return limit ? battles.slice(0, limit) : battles;
}
