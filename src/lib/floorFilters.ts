/** Build-safe Floor filter definitions shared by static pages and API routes. */
export const FLOOR_FILTERS = [
  { key: 'top', label: 'Top', hint: 'Most-discussed events' },
  { key: 'recents', label: 'Recents', hint: 'Newest kickoffs first' },
  { key: 'live', label: 'Live', hint: 'Happening right now' },
  { key: 'mygoats', label: 'My Goats', hint: 'Events with the goats you back' },
] as const;

export type FloorFilter = (typeof FLOOR_FILTERS)[number]['key'];

const FILTER_KEYS = FLOOR_FILTERS.map((filter) => filter.key) as readonly string[];

export function parseFloorFilter(value: string | null | undefined): FloorFilter {
  return (value && FILTER_KEYS.includes(value) ? value : 'top') as FloorFilter;
}
