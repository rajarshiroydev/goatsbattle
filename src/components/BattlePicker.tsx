import { useEffect, useMemo, useState } from 'preact/hooks';
import { getBattleId } from '../lib/battle';

export interface PickerEntity {
  slug: string;
  name: string;
  shortName: string;
  nationality: string;
  accent: string;
  arena: string;
}

export interface PickerArena {
  id: string;
  label: string;
  emoji: string;
  accent: string;
}

interface Props {
  roster: PickerEntity[];
  arenas: PickerArena[];
}

/** Readable text colour (near-black or near-white) on top of a hex accent. */
function onAccent(hex: string): string {
  const h = hex.replace('#', '');
  const lum =
    (0.299 * parseInt(h.slice(0, 2), 16) +
      0.587 * parseInt(h.slice(2, 4), 16) +
      0.114 * parseInt(h.slice(4, 6), 16)) /
    255;
  return lum > 0.6 ? '#0d0d0f' : '#f0f0f2';
}

/** Split a full name into a leading part + surname for the two-line display. */
function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { first: '', last: parts[0] };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/**
 * The battle builder (design §8 / 3e). Two fighter slots — lime fighter one,
 * red fighter two — an arena chip bar, per-slot swap chips, and a full roster.
 * Filling both slots with same-arena GOATs jumps to that battle's `/battle/<id>`
 * vote page. `/faceoff?goat=<slug>` pre-seeds slot A + locks the arena to theirs.
 */
export default function BattlePicker({ roster, arenas }: Props) {
  const [arena, setArena] = useState(arenas[0]?.id ?? '');
  const [pickA, setPickA] = useState<string | null>(null);
  const [pickB, setPickB] = useState<string | null>(null);

  const bySlug = useMemo(() => Object.fromEntries(roster.map((e) => [e.slug, e])), [roster]);
  const arenaById = useMemo(() => Object.fromEntries(arenas.map((a) => [a.id, a])), [arenas]);

  // Pre-selection from a profile page: ?goat=<slug> seeds slot A and its arena.
  useEffect(() => {
    const seed = new URLSearchParams(window.location.search).get('goat');
    const entity = seed ? bySlug[seed] : undefined;
    if (entity) {
      setArena(entity.arena);
      setPickA(entity.slug);
    }
  }, [bySlug]);

  const contenders = useMemo(() => roster.filter((e) => e.arena === arena), [roster, arena]);

  function switchArena(id: string) {
    if (id === arena) return;
    setArena(id);
    setPickA(null);
    setPickB(null);
  }

  // Click-to-toggle: deselect if already picked, else drop into the first open
  // slot. With both full, a new pick replaces slot B.
  function toggle(slug: string) {
    if (slug === pickA) return setPickA(null);
    if (slug === pickB) return setPickB(null);
    if (!pickA) return setPickA(slug);
    if (!pickB) return setPickB(slug);
    setPickB(slug);
  }

  function setSlot(which: 'a' | 'b', slug: string) {
    if (which === 'a') {
      if (slug === pickB) setPickB(null);
      setPickA(slug);
    } else {
      if (slug === pickA) setPickA(null);
      setPickB(slug);
    }
  }

  const ready = pickA && pickB;
  function start() {
    if (pickA && pickB) window.location.href = `/battle/${getBattleId(pickA, pickB)}`;
  }

  const entA = pickA ? bySlug[pickA] : null;
  const entB = pickB ? bySlug[pickB] : null;
  const meta = (e: PickerEntity) => {
    const c = arenaById[e.arena];
    return `${c?.emoji ?? ''} ${c?.label ?? e.arena} · ${e.nationality}`;
  };

  return (
    <div>
      {/* Arena chips — pick the battleground first. */}
      <div class="flex flex-wrap gap-1.5 justify-center mb-6">
        {arenas.map((c) => {
          const on = c.id === arena;
          return (
            <button
              type="button"
              onClick={() => switchArena(c.id)}
              class={`chip${on ? ' chip-active' : ''}`}
              style={on ? `background:${c.accent}; border-color:${c.accent}; color:${onAccent(c.accent)}` : ''}
            >
              <span aria-hidden="true">{c.emoji}</span> {c.label}
            </button>
          );
        })}
      </div>

      {/* Two fighter slots + VS badge. */}
      <div class="grid grid-cols-1 md:grid-cols-[1fr_90px_1fr] items-stretch gap-3 md:gap-0">
        <FighterSlot side="a" entity={entA} contenders={contenders} pickA={pickA} pickB={pickB} onPick={setSlot} meta={meta} />

        <div class="flex items-center justify-center py-2 md:py-0">
          <div class="w-16 h-16 rounded-full bg-canvas-deep border border-hairline-strong flex items-center justify-center">
            <span class="font-headline font-black italic text-2xl text-ink">VS</span>
          </div>
        </div>

        <FighterSlot side="b" entity={entB} contenders={contenders} pickA={pickA} pickB={pickB} onPick={setSlot} meta={meta} />
      </div>

      {/* Battle CTA */}
      <div class="flex flex-col items-center gap-2.5 mt-6">
        <button
          type="button"
          onClick={start}
          disabled={!ready}
          class="btn btn-primary text-lg px-11 py-3.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {ready ? `Battle ${entA!.shortName} / ${entB!.shortName} ⚔` : 'Battle ⚔'}
        </button>
        <span class="font-mono text-[10px] uppercase tracking-[0.14em] text-mute text-center">
          Same-arena battles · pick two legends to settle it
        </span>
      </div>

      {/* Full roster for the active arena. */}
      <div class="mt-10">
        <div class="flex items-center gap-3 mb-5">
          <span class="w-0.5 h-5 inline-block bg-hairline-strong"></span>
          <h2 class="font-headline font-black uppercase text-xl tracking-tight text-ink">Choose your fighters</h2>
          <span class="ml-auto font-mono text-[11px] uppercase tracking-widest text-mute">{contenders.length} in this arena</span>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {contenders.map((e) => {
            const pickedA = e.slug === pickA;
            const pickedB = e.slug === pickB;
            const picked = pickedA || pickedB;
            const pill = pickedA ? 'var(--color-lime)' : pickedB ? 'var(--color-red)' : '';
            return (
              <button
                type="button"
                onClick={() => toggle(e.slug)}
                aria-pressed={picked}
                class="group text-left bg-canvas-soft border rounded-md px-4 py-4 transition-colors"
                style={picked ? `border-color:${pill}` : 'border-color:var(--color-hairline)'}
                onMouseOver={(ev) => { if (!picked) ev.currentTarget.style.borderColor = 'var(--color-hairline-strong)'; }}
                onMouseOut={(ev) => { if (!picked) ev.currentTarget.style.borderColor = 'var(--color-hairline)'; }}
              >
                <div class="flex items-baseline justify-between gap-2 mb-1">
                  <span class="font-headline font-black uppercase text-2xl leading-none truncate text-ink">{e.shortName}</span>
                  {picked && (
                    <span class="font-mono text-[10px] uppercase tracking-widest shrink-0" style={`color:${pill}`}>
                      {pickedA ? 'One' : 'Two'}
                    </span>
                  )}
                </div>
                <p class="font-sans text-sm text-body truncate">{e.name}</p>
                <p class="font-mono text-[13px] uppercase tracking-wider text-mute mt-0.5">{e.nationality}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FighterSlot({
  side,
  entity,
  contenders,
  pickA,
  pickB,
  onPick,
  meta,
}: {
  side: 'a' | 'b';
  entity: PickerEntity | null;
  contenders: PickerEntity[];
  pickA: string | null;
  pickB: string | null;
  onPick: (which: 'a' | 'b', slug: string) => void;
  meta: (e: PickerEntity) => string;
}) {
  const right = side === 'b';
  const color = right ? 'var(--color-red)' : 'var(--color-lime)';
  const kicker = right ? 'Fighter two' : 'Fighter one';
  const gradient = right
    ? 'linear-gradient(200deg, rgba(255,45,85,0.07), transparent 60%)'
    : 'linear-gradient(160deg, rgba(198,255,0,0.07), transparent 60%)';

  // Swap options: same-arena GOATs not already in either slot.
  const swaps = contenders.filter((e) => e.slug !== pickA && e.slug !== pickB).slice(0, 4);
  const name = entity ? splitName(entity.name) : null;

  return (
    <div
      class={`rounded-md border p-6 ${right ? 'items-end text-right' : ''} flex flex-col`}
      style={`border-color:${color}55; background-image:${gradient}; background-color: var(--color-canvas-soft)`}
    >
      <div class="font-mono text-[10px] uppercase tracking-[0.18em]" style={`color:${color}`}>{kicker}</div>

      {name ? (
        <div class="font-headline font-black uppercase leading-[0.9] tracking-tight text-ink mt-3.5"
          style="font-size: clamp(2rem, 5vw, 52px)">
          {name.first && <>{name.first}<br /></>}<span style={`color:${color}`}>{name.last}</span>
        </div>
      ) : (
        <div class="font-headline font-black uppercase leading-[0.9] tracking-tight text-hairline-strong mt-3.5"
          style="font-size: clamp(2rem, 5vw, 52px)">
          Pick a<br />GOAT
        </div>
      )}

      <div class="font-sans text-[13px] text-mute mt-2.5">{entity ? meta(entity) : 'From the roster below'}</div>

      {swaps.length > 0 && (
        <div class={`flex flex-wrap gap-1.5 mt-4 pt-3.5 border-t border-hairline w-full ${right ? 'justify-end' : ''}`}>
          {swaps.map((e) => (
            <button type="button" onClick={() => onPick(side, e.slug)} class="chip">{e.shortName}</button>
          ))}
        </div>
      )}
    </div>
  );
}
