import { useEffect, useRef, useState } from 'preact/hooks';
import type { ContestedBattle } from '../lib/battleWire';
import { groupRecord } from '../lib/battleWire';

interface Props {
  slug: string;
  shortName: string;
  /** The goat's accent (hex) — used for its side of every split. */
  accent: string;
  /** Pre-formatted 1v1 vote count shown as the hover trigger (e.g. "19"). */
  label: string;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Head-to-head popover anchored to a rankings row's 1v1 count. Hovering the
 * number reveals the goat's per-opponent record — same goat-left / score /
 * opponent-right layout as the profile cards. The record is fetched lazily on
 * first open and cached, so the leaderboard doesn't fire a request per row on
 * load. The trigger sits above the row's stretched navigation link (z-10) so
 * interacting with it never navigates. See [[project-goatsbattle]].
 */
export default function H2HPopover({ slug, shortName, accent, label }: Props) {
  const [open, setOpen] = useState(false);
  // A click/tap "pins" the popover so it survives mouseleave (needed on touch).
  const [pinned, setPinned] = useState(false);
  const [state, setState] = useState<LoadState>('idle');
  const [rows, setRows] = useState<ContestedBattle[]>([]);
  const wrap = useRef<HTMLSpanElement>(null);
  const loaded = useRef(false);
  const inFlight = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Lazy-load the record the first time the popover opens. Guarded by refs (not
  // the render state) so a fetch interrupted by an early close can't wedge the
  // popover on the loading skeleton.
  useEffect(() => {
    if (!open || loaded.current || inFlight.current) return;
    inFlight.current = true;
    setState('loading');
    fetch(`/api/goat-battles?goat=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: ContestedBattle[]) => {
        loaded.current = true;
        if (!alive.current) return;
        setRows(data);
        setState('ready');
      })
      .catch(() => alive.current && setState('error'))
      .finally(() => {
        inFlight.current = false;
      });
  }, [open, slug]);

  // Dismiss a pinned popover on outside-click or Escape.
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pinned]);

  function close() {
    setOpen(false);
    setPinned(false);
  }

  const groups = state === 'ready' ? groupRecord(rows) : null;

  return (
    <span
      ref={wrap}
      // Each row's number sits in its own z-10 stacking context; when open, lift
      // this one above the later rows so the panel isn't covered by their numbers.
      class={`relative inline-block ${open ? 'z-50' : 'z-10'}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => !pinned && setOpen(false)}
    >
      <button
        type="button"
        aria-label={`${shortName} head-to-head record`}
        aria-expanded={open}
        class="font-mono text-sm text-body hover:text-ink transition-colors cursor-help underline decoration-dotted decoration-mute underline-offset-4"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const next = !pinned;
          setPinned(next);
          setOpen(next);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => !pinned && setOpen(false)}
      >
        {label}
      </button>

      {open && (
        // pt-2 (padding, not margin) bridges the gap to the card so moving the
        // cursor from the number onto the panel doesn't fire mouseleave.
        <div
          class="absolute right-0 top-full pt-2 z-20 cursor-default"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <div class="w-96 max-w-[90vw] bg-canvas border border-hairline-strong rounded-md shadow-xl p-4 text-left">
            <p class="font-mono text-[12px] uppercase tracking-widest text-mute mb-3">
              {shortName} · 1v1 record
            </p>

            {state === 'loading' && (
              <div class="space-y-2.5">
                {[0, 1, 2].map((i) => (
                  <div key={i} class="h-9 w-full bg-hairline rounded animate-pulse"></div>
                ))}
              </div>
            )}

            {state === 'error' && (
              <p class="font-sans text-sm text-mute">Couldn't load record.</p>
            )}

            {state === 'ready' && rows.length === 0 && (
              <p class="font-sans text-sm text-mute">No 1v1 battles yet.</p>
            )}

            {groups && rows.length > 0 && (
              <div class="max-h-96 overflow-y-auto space-y-4 -mr-1 pr-1">
                {groups.leading.length > 0 && (
                  <PopGroup title={`Beats (${groups.leading.length})`} battles={groups.leading} goatName={shortName} accent={accent} />
                )}
                {groups.trailing.length > 0 && (
                  <PopGroup title={`Loses to (${groups.trailing.length})`} battles={groups.trailing} goatName={shortName} accent={accent} />
                )}
                {groups.even.length > 0 && (
                  <PopGroup title={`Even (${groups.even.length})`} battles={groups.even} goatName={shortName} accent={accent} />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}

function PopGroup({
  title,
  battles,
  goatName,
  accent,
}: {
  title: string;
  battles: ContestedBattle[];
  goatName: string;
  accent: string;
}) {
  return (
    <div>
      <p class="font-mono text-[10px] uppercase tracking-widest text-mute mb-1.5">{title}</p>
      <div class="space-y-2.5">
        {battles.map((b) => (
          <Matchup
            key={b.battleSlug}
            goatName={goatName}
            accent={accent}
            opponent={b.opponentShortName}
            opponentAccent={b.opponentAccent}
            goatVotes={b.goatVotes}
            opponentVotes={b.opponentVotes}
            goatPct={b.goatPct}
            opponentPct={b.opponentPct}
          />
        ))}
      </div>
    </div>
  );
}

/** Compact goat-left / score / opponent-right row with a two-colour split bar. */
function Matchup({
  goatName,
  accent,
  opponent,
  opponentAccent,
  goatVotes,
  opponentVotes,
  goatPct,
  opponentPct,
}: {
  goatName: string;
  accent: string;
  opponent: string;
  opponentAccent: string;
  goatVotes: number;
  opponentVotes: number;
  goatPct: number;
  opponentPct: number;
}) {
  return (
    <div>
      <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-1.5">
        <span class="text-left font-headline font-black uppercase text-sm leading-none truncate" style={`color:${accent}`}>
          {goatName}
        </span>
        <span class="text-center font-headline font-black text-lg leading-none tabular-nums">
          <span style={`color:${accent}`}>{goatVotes.toLocaleString()}</span>
          <span class="text-mute mx-1.5">–</span>
          <span style={`color:${opponentAccent}`}>{opponentVotes.toLocaleString()}</span>
        </span>
        <span class="text-right font-headline font-black uppercase text-sm leading-none truncate" style={`color:${opponentAccent}`}>
          {opponent}
        </span>
      </div>
      <div class="flex h-2 gap-0.5 rounded-full overflow-hidden">
        <div style={`width:${goatPct}%; background:${accent}`}></div>
        <div style={`width:${opponentPct}%; background:${opponentAccent}`}></div>
      </div>
      <div class="flex items-center justify-between mt-1 font-mono text-[11px] tracking-wider tabular-nums">
        <span style={`color:${accent}`}>{goatPct}%</span>
        <span style={`color:${opponentAccent}`}>{opponentPct}%</span>
      </div>
    </div>
  );
}
