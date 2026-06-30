export interface Stat {
  label: string;
  value: string | number;
  unit?: string;
}

export interface StatSection {
  heading: string;
  stats: Stat[];
}

export interface Achievement {
  title: string;
  count: number;
  years?: number[];
}

export interface Entity {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  category: string;
  nationality: string;
  countryCode: string;
  born: string;
  position: string;
  bio: string;
  statSections: StatSection[];
  achievements: Achievement[];
  careerHighlights: string[];
  initialElo: number;
  active: boolean;
}
