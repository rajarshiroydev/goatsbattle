import type { Entity } from './types';
import { toNum } from './stats';

/** Find the first stat on an entity whose label matches one of `candidates`. */
function findStat(entity: Entity, candidates: string[]): number | null {
  for (const section of entity.statSections) {
    for (const stat of section.stats) {
      if (candidates.includes(stat.label)) {
        const n = toNum(stat.value);
        if (n !== null) return n;
      }
    }
  }
  return null;
}

/** A radar axis: the shared metric resolved for both entities, plus 0..1 norms. */
export interface RadarAxis {
  label: string;
  rawA: number;
  rawB: number;
  /** Normalised against the larger of the two, so the leader touches the rim. */
  normA: number;
  normB: number;
}

// Each axis tries several stat labels so entities with differently-named
// sections (Pelé's "Official Club Goals", Pelé's "Santos Appearances", …) still
// line up. An axis is only included when BOTH entities resolve a value.
const AXIS_DEFS: { label: string; candidates: string[] }[] = [
  { label: 'Goals', candidates: ['Club Goals', 'Official Club Goals', 'All Goals (incl. friendlies)', 'Santos Goals'] },
  { label: 'Assists', candidates: ['Club Assists'] },
  { label: 'Apps', candidates: ['Club Appearances', 'Santos Appearances', 'Bayern Munich Apps', 'Ajax Appearances'] },
  { label: "Int'l Goals", candidates: ['International Goals'] },
  { label: "Int'l Caps", candidates: ['International Caps'] },
  { label: 'WC Goals', candidates: ['World Cup Goals'] },
];

/**
 * Build the radar axes shared by two entities. Returns null when fewer than 3
 * axes are common (a polygon needs at least a triangle).
 */
export function getRadarAxes(a: Entity, b: Entity): RadarAxis[] | null {
  const axes: RadarAxis[] = [];
  for (const def of AXIS_DEFS) {
    const rawA = findStat(a, def.candidates);
    const rawB = findStat(b, def.candidates);
    if (rawA === null || rawB === null) continue;
    const max = Math.max(rawA, rawB) || 1;
    axes.push({ label: def.label, rawA, rawB, normA: rawA / max, normB: rawB / max });
  }
  return axes.length >= 3 ? axes : null;
}

export interface TrophyEvent {
  year: number;
  title: string;
}

/** Flatten an entity's dated honours into a sorted list of {year, title}. */
export function getTrophyEvents(entity: Entity): TrophyEvent[] {
  const events: TrophyEvent[] = [];
  for (const a of entity.achievements) {
    if (!a.years) continue;
    for (const year of a.years) events.push({ year, title: a.title });
  }
  return events.sort((x, y) => x.year - y.year);
}
