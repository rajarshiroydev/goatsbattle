import type { Entity } from './types';

/** Parse a stat value (e.g. "0.79", 794, "130+") down to a comparable number. */
export function toNum(value: string | number): number | null {
  const n = parseFloat(String(value).replace(/[^0-9.\-]/g, ''));
  return Number.isNaN(n) ? null : n;
}

export interface StatComparisonRow {
  label: string;
  valueA: string | number;
  valueB: string | number;
  winner: 'a' | 'b' | 'tie';
  pctA: number;
  pctB: number;
}

export interface StatComparisonSection {
  heading: string;
  rows: StatComparisonRow[];
}

export interface EntityComparison {
  sections: StatComparisonSection[];
  winsA: number;
  winsB: number;
  leader: 'a' | 'b' | 'tie';
}

/**
 * Compare two entities across the stat sections they share. For each shared
 * stat we resolve a leader and the proportional split, and tally arena wins.
 * Used by battle pages today; reusable by rankings and the data API as voting
 * wiring lands.
 */
export function compareEntities(entityA: Entity, entityB: Entity): EntityComparison {
  let winsA = 0;
  let winsB = 0;
  const sections: StatComparisonSection[] = [];

  for (const sectionA of entityA.statSections) {
    const sectionB = entityB.statSections.find((s) => s.heading === sectionA.heading);
    if (!sectionB) continue;

    const rows: StatComparisonRow[] = [];
    for (const statA of sectionA.stats) {
      const statB = sectionB.stats.find((s) => s.label === statA.label);
      if (!statB) continue;

      const a = toNum(statA.value);
      const b = toNum(statB.value);
      let winner: 'a' | 'b' | 'tie' = 'tie';
      let pctA = 50;
      if (a !== null && b !== null && a + b > 0) {
        pctA = Math.round((a / (a + b)) * 100);
        if (a > b) { winner = 'a'; winsA++; }
        else if (b > a) { winner = 'b'; winsB++; }
      }
      rows.push({ label: statA.label, valueA: statA.value, valueB: statB.value, winner, pctA, pctB: 100 - pctA });
    }

    if (rows.length > 0) sections.push({ heading: sectionA.heading, rows });
  }

  const leader: 'a' | 'b' | 'tie' = winsA > winsB ? 'a' : winsB > winsA ? 'b' : 'tie';
  return { sections, winsA, winsB, leader };
}
