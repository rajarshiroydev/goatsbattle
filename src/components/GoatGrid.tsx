import { useMemo, useState } from 'preact/hooks';

export interface GoatCardData {
  slug: string;
  rank: number;
  arena: string;
  accent: string;
  name: string;
  shortName: string;
  nationality: string;
  /** Short honour line, e.g. "8× Ballon d'Or". */
  honour: string;
  votes: number;
  winRate: number;
}

export interface GridArena {
  id: string;
  label: string;
  emoji: string;
  accent: string;
}

interface Props {
  goats: GoatCardData[];
  arenas: GridArena[];
}

function onAccent(hex: string): string {
  const h = hex.replace('#', '');
  return (0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16)) / 255 > 0.6 ? '#0d0d0f' : '#f0f0f2';
}
function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { first: '', last: parts[0] };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/**
 * The Goats directory (design §8 / 3c) — a single votes-sorted grid with an
 * arena filter. Cards carry the goat's global rank as a ghost number; the arena
 * tag stands in for the Team tag. Filtering is instant + client-side.
 */
export default function GoatGrid({ goats, arenas }: Props) {
  const [active, setActive] = useState('all');
  const arenaById = useMemo(() => Object.fromEntries(arenas.map((a) => [a.id, a])), [arenas]);
  const shown = active === 'all' ? goats : goats.filter((g) => g.arena === active);

  return (
    <div>
      {/* Filter chips */}
      <div class="flex flex-wrap items-center gap-1.5 mb-5">
        <button type="button" onClick={() => setActive('all')} class={`chip${active === 'all' ? ' chip-active' : ''}`}>All</button>
        {arenas.map((c) => {
          const on = c.id === active;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setActive(c.id)}
              class="chip"
              style={on
                ? `background:${c.accent}; border-color:${c.accent}; color:${onAccent(c.accent)}`
                : `color:${c.accent}; border-color:${c.accent}44`}
            >
              {c.emoji} {c.label}
            </button>
          );
        })}
        <span class="ml-auto font-mono text-[11px] uppercase tracking-widest text-mute">{shown.length} goats · sorted by votes</span>
      </div>

      {/* Grid */}
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {shown.map((g, idx) => {
          const c = arenaById[g.arena];
          const n = splitName(g.name);
          // Rank reflects position within the current view: global on "All",
          // re-numbered 1..N per arena when a filter is active.
          const displayRank = idx + 1;
          const ghost = displayRank <= 3 ? `${g.accent}1f` : 'rgba(240,240,242,0.05)';
          return (
            <a
              key={g.slug}
              href={`/goats/${g.slug}`}
              class="group relative flex flex-col bg-canvas-soft border border-hairline rounded-md p-[18px] overflow-hidden transition-colors"
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = g.accent)}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = '')}
            >
              <span class="absolute -top-[18px] -right-1.5 font-headline font-black leading-none select-none pointer-events-none"
                style={`font-size:96px; color:${ghost}`} aria-hidden="true">
                {String(displayRank).padStart(2, '0')}
              </span>

              <span class="team-tag relative self-start" style={c ? `--tag:${c.accent}; --tag-fg:${onAccent(c.accent)}` : ''}>
                {c?.emoji} {c?.label ?? g.arena}
              </span>

              {/* Fixed two-line box keeps the meta + footer aligned across cards
                  regardless of one- vs two-word names. */}
              <div class="relative flex flex-col justify-end min-h-[3.8rem] mt-3">
                <div class="font-headline font-black uppercase text-[32px] leading-[0.95] tracking-tight text-ink">
                  {n.first && <>{n.first}<br /></>}{n.last}
                </div>
              </div>

              <div class="relative font-sans text-[12px] text-mute mt-2">{g.nationality}{g.honour ? ` · ${g.honour}` : ''}</div>

              <div class="relative flex justify-between mt-auto pt-4 border-t border-hairline">
                <span class="font-mono text-[10px] text-mute">{g.votes.toLocaleString()} votes</span>
                <span class="font-mono text-[10px] text-lime">{g.winRate > 0 ? `${g.winRate}% win rate` : '—'}</span>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
