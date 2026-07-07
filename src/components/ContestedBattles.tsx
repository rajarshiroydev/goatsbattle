import { useEffect, useState } from 'preact/hooks';
import type { ContestedBattle } from '../lib/battleWire';

interface Props {
  slug: string;
  /** Profile goat's accent (hex) — used for its side of each split bar. */
  accent: string;
}

/**
 * Live "hottest battles" strip for a goat profile. Profiles are prerendered, so
 * the mutable vote tallies are hydrated client-side from /api/goat-battles —
 * same pattern as PlayerRank. Rows are the goat's tightest current matchups.
 * See [[project-goatsbattle]].
 */
export default function ContestedBattles({ slug, accent }: Props) {
  const [rows, setRows] = useState<ContestedBattle[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    fetch(`/api/goat-battles?goat=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: ContestedBattle[]) => {
        if (!active) return;
        setRows(data);
        setState('ready');
      })
      .catch(() => active && setState('error'));
    return () => {
      active = false;
    };
  }, [slug]);

  if (state === 'error') return null;

  if (state === 'loading') {
    return (
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {[0, 1, 2].map(() => (
          <div class="bg-canvas-soft border border-hairline rounded-md px-4 py-4">
            <div class="h-5 w-24 bg-hairline rounded animate-pulse mb-3"></div>
            <div class="h-2 w-full bg-hairline rounded-full animate-pulse"></div>
          </div>
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p class="font-sans text-body text-base">
        No battles yet — pick an opponent above to start one.
      </p>
    );
  }

  return (
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {rows.map((b) => (
        <a
          href={`/battle/${b.battleSlug}`}
          class="group block bg-canvas-soft border rounded-md px-4 py-4 transition-all duration-200 hover:-translate-y-0.5"
          style={`border-color:${b.opponentAccent}40`}
          onmouseover={`this.style.borderColor='${b.opponentAccent}'`}
          onmouseout={`this.style.borderColor='${b.opponentAccent}40'`}
        >
          <div class="flex items-baseline justify-between gap-3 mb-3">
            <span class="font-headline font-black uppercase text-2xl leading-none" style={`color:${b.opponentAccent}`}>
              {b.opponentShortName}
            </span>
            <span class="font-mono text-[13px] uppercase tracking-wider text-mute shrink-0">
              {b.total.toLocaleString()} votes
            </span>
          </div>

          <div class="flex h-2 gap-0.5 rounded-full overflow-hidden">
            <div style={`width:${b.goatPct}%; background:${accent}`}></div>
            <div class="bg-hairline-strong" style={`width:${b.opponentPct}%`}></div>
          </div>

          <div class="flex items-center justify-between mt-1.5 font-mono text-[13px] uppercase tracking-wider">
            <span style={`color:${accent}`}>{b.goatPct}%</span>
            <span class="text-mute">{b.opponentPct}%</span>
          </div>
        </a>
      ))}
    </div>
  );
}
