import { useEffect, useMemo, useState } from 'preact/hooks';
import { getBattleId } from '../lib/battle';

export interface PickerEntity {
  slug: string;
  name: string;
  shortName: string;
  nationality: string;
  accent: string;
  category: string;
}

export interface PickerCategory {
  id: string;
  label: string;
  emoji: string;
  accent: string;
}

interface Props {
  roster: PickerEntity[];
  categories: PickerCategory[];
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

/**
 * The battle builder. Two slots, a category tab bar, and a roster grid. Filling
 * both slots with same-arena GOATs unlocks the matchup and jumps to that
 * battle's vote page — the same `/battle/<id>` route every other link uses.
 *
 * Visiting `/faceoff?goat=<slug>` from a profile pre-selects that GOAT into
 * slot A and locks the arena to theirs; visiting from the navbar starts empty
 * so any two GOATs from one arena can be paired. See [[project-goatsbattle]].
 */
export default function BattlePicker({ roster, categories }: Props) {
  const [category, setCategory] = useState(categories[0]?.id ?? '');
  const [pickA, setPickA] = useState<string | null>(null);
  const [pickB, setPickB] = useState<string | null>(null);

  const bySlug = useMemo(
    () => Object.fromEntries(roster.map((e) => [e.slug, e])),
    [roster],
  );

  // Pre-selection from a profile page: ?goat=<slug> seeds slot A and its arena.
  useEffect(() => {
    const seed = new URLSearchParams(window.location.search).get('goat');
    const entity = seed ? bySlug[seed] : undefined;
    if (entity) {
      setCategory(entity.category);
      setPickA(entity.slug);
    }
  }, [bySlug]);

  const contenders = useMemo(
    () => roster.filter((e) => e.category === category),
    [roster, category],
  );

  function switchCategory(id: string) {
    if (id === category) return;
    setCategory(id);
    setPickA(null);
    setPickB(null);
  }

  // Click-to-toggle: deselect if already picked, otherwise drop into the first
  // open slot. With both slots full, a new pick replaces slot B.
  function toggle(slug: string) {
    if (slug === pickA) return setPickA(null);
    if (slug === pickB) return setPickB(null);
    if (!pickA) return setPickA(slug);
    if (!pickB) return setPickB(slug);
    setPickB(slug);
  }

  function clearSlot(which: 'a' | 'b') {
    if (which === 'a') setPickA(null);
    else setPickB(null);
  }

  const ready = pickA && pickB;
  function start() {
    if (pickA && pickB) window.location.href = `/battle/${getBattleId(pickA, pickB)}`;
  }

  const entA = pickA ? bySlug[pickA] : null;
  const entB = pickB ? bySlug[pickB] : null;

  return (
    <div>
      {/* Arena tabs — pick the battleground first. */}
      <div class="flex flex-wrap gap-2 mb-8">
        {categories.map((c) => {
          const on = c.id === category;
          return (
            <button
              type="button"
              onClick={() => switchCategory(c.id)}
              class="font-headline font-black uppercase tracking-wider text-sm px-4 h-10 flex items-center gap-2 rounded-sm border transition-colors"
              style={
                on
                  ? `background:${c.accent}; color:${onAccent(c.accent)}; border-color:${c.accent}`
                  : `color:#a0a0a6; border-color:#2a2a2e`
              }
            >
              <span aria-hidden="true">{c.emoji}</span>
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Two slots + slash divider — mirrors the battle-page hero. */}
      <div class="relative flex items-stretch gap-3 md:gap-0 mb-4">
        <Slot entity={entA} label="GOAT #1" onClear={() => clearSlot('a')} />

        <div class="hidden md:flex items-center justify-center px-2 shrink-0">
          <span
            class="font-headline font-black text-6xl leading-none select-none"
            style={`background:linear-gradient(150deg, ${entA?.accent ?? '#3a3a3e'}, ${entB?.accent ?? '#3a3a3e'}); -webkit-background-clip:text; background-clip:text; color:transparent`}
          >
            /
          </span>
        </div>

        <Slot entity={entB} label="GOAT #2" align="right" onClear={() => clearSlot('b')} />
      </div>

      {/* Start CTA */}
      <button
        type="button"
        onClick={start}
        disabled={!ready}
        class="w-full font-headline font-black uppercase text-xl tracking-wider h-14 rounded-sm transition-opacity mb-10"
        style={
          ready
            ? `background:linear-gradient(90deg, ${entA!.accent}, ${entB!.accent}); color:#0d0d0f`
            : 'background:#1c1c20; color:#5a5a60; cursor:not-allowed'
        }
      >
        {ready ? `Battle: ${entA!.shortName} / ${entB!.shortName} →` : 'Pick two GOATs to battle'}
      </button>

      {/* Roster grid for the active arena. */}
      <div class="flex items-center gap-3 mb-5">
        <span class="w-0.5 h-5 inline-block bg-hairline-strong"></span>
        <h2 class="font-headline font-black uppercase text-xl tracking-tight text-ink">
          Choose your fighters
        </h2>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {contenders.map((e) => {
          const picked = e.slug === pickA || e.slug === pickB;
          return (
            <button
              type="button"
              onClick={() => toggle(e.slug)}
              aria-pressed={picked}
              class="group text-left bg-canvas-soft border rounded-md px-4 py-4 transition-all duration-150 hover:-translate-y-0.5"
              style={
                picked
                  ? `border-color:${e.accent}; background:${e.accent}14`
                  : `border-color:${e.accent}33`
              }
              onMouseOver={(ev) => {
                if (!picked) ev.currentTarget.style.borderColor = `${e.accent}80`;
              }}
              onMouseOut={(ev) => {
                if (!picked) ev.currentTarget.style.borderColor = `${e.accent}33`;
              }}
            >
              <div class="flex items-baseline justify-between gap-2 mb-1">
                <span
                  class="font-headline font-black uppercase text-2xl leading-none truncate"
                  style={`color:${e.accent}`}
                >
                  {e.shortName}
                </span>
                {picked && (
                  <span
                    class="font-mono text-[10px] uppercase tracking-widest shrink-0"
                    style={`color:${e.accent}`}
                  >
                    Picked
                  </span>
                )}
              </div>
              <p class="font-sans text-sm text-body truncate">{e.name}</p>
              <p class="font-mono text-[13px] uppercase tracking-wider text-mute mt-0.5">
                {e.nationality}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Slot({
  entity,
  label,
  align = 'left',
  onClear,
}: {
  entity: PickerEntity | null;
  label: string;
  align?: 'left' | 'right';
  onClear: () => void;
}) {
  const right = align === 'right';
  if (!entity) {
    return (
      <div
        class={`flex-1 min-h-[132px] rounded-md border-2 border-dashed border-hairline-strong flex flex-col justify-center px-6 py-6 ${right ? 'items-end text-right' : ''}`}
      >
        <span class="font-mono text-xs uppercase tracking-widest text-mute mb-1">{label}</span>
        <span class="font-headline font-black uppercase text-2xl text-hairline-strong leading-none">
          Pick a GOAT
        </span>
      </div>
    );
  }
  return (
    <div
      class={`relative flex-1 min-h-[132px] rounded-md border flex flex-col justify-between px-6 py-5 overflow-hidden ${right ? 'items-end text-right' : ''}`}
      style={`border-color:${entity.accent}; background:${entity.accent}14`}
    >
      <div class={`flex flex-col ${right ? 'items-end' : ''}`}>
        <span class="font-mono text-xs uppercase tracking-widest text-mute mb-1">
          {entity.nationality}
        </span>
        <span
          class="font-headline font-black uppercase leading-[0.95] tracking-tight"
          style={`font-size: clamp(1.5rem, 3.5vw, 2.5rem); color:${entity.accent}`}
        >
          {entity.name}
        </span>
      </div>
      <button
        type="button"
        onClick={onClear}
        class="font-mono text-[13px] uppercase tracking-widest text-mute hover:text-ink transition-colors mt-3"
      >
        ✕ Change
      </button>
    </div>
  );
}
