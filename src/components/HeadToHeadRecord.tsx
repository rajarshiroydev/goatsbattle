import { useEffect, useState } from 'preact/hooks';
import type { ContestedBattle } from '../lib/battleWire';
import { groupRecord } from '../lib/battleWire';

interface Props {
  slug: string;
  /** The profile goat's short name — shown on the left of every matchup. */
  goatShortName: string;
  /** Profile goat's accent (hex) — used for its side of every split bar. */
  accent: string;
}

/**
 * Full head-to-head record for a goat profile: every voted 1v1 matchup, split
 * into the ones this goat is winning vs losing. Each card reads left-to-right —
 * this goat, the score, the opponent — with a two-colour bar below so the result
 * is legible at a glance. Profiles are prerendered, so the mutable tallies
 * hydrate client-side from /api/goat-battles. See [[project-goatsbattle]].
 */
export default function HeadToHeadRecord({ slug, goatShortName, accent }: Props) {
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
        {[0, 1, 2].map((i) => (
          <div key={i} class="bg-canvas-soft border border-hairline rounded-md px-4 py-4">
            <div class="h-5 w-full bg-hairline rounded animate-pulse mb-3"></div>
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

  const { leading, trailing, even } = groupRecord(rows);

  return (
    <div class="space-y-8">
      {/* Summary line */}
      <p class="font-mono text-[13px] uppercase tracking-widest text-mute">
        <span style={`color:${accent}`}>Leads {leading.length}</span>
        <span class="text-hairline-strong mx-2">·</span>
        <span>Trails {trailing.length}</span>
        {even.length > 0 && (
          <>
            <span class="text-hairline-strong mx-2">·</span>
            <span>Even {even.length}</span>
          </>
        )}
      </p>

      {leading.length > 0 && (
        <RecordGroup title="Leading" battles={leading} goatName={goatShortName} accent={accent} />
      )}
      {trailing.length > 0 && (
        <RecordGroup title="Trailing" battles={trailing} goatName={goatShortName} accent={accent} />
      )}
      {even.length > 0 && (
        <RecordGroup title="Even" battles={even} goatName={goatShortName} accent={accent} />
      )}
    </div>
  );
}

function RecordGroup({
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
      <h3 class="font-mono text-[13px] uppercase tracking-widest text-mute mb-3">
        {title} <span class="text-hairline-strong">({battles.length})</span>
      </h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {battles.map((b) => (
          <a
            key={b.battleSlug}
            href={`/battle/${b.battleSlug}`}
            class="group block bg-canvas-soft border border-hairline rounded-md px-4 py-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-hairline-strong"
          >
            {/* Goat · score · opponent */}
            <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-3 mb-3">
              <span class="text-left font-headline font-black uppercase text-lg leading-none truncate" style={`color:${accent}`}>
                {goatName}
              </span>
              <span class="text-center font-headline font-black text-2xl leading-none tabular-nums">
                <span style={`color:${accent}`}>{b.goatVotes.toLocaleString()}</span>
                <span class="text-mute mx-1.5">–</span>
                <span style={`color:${b.opponentAccent}`}>{b.opponentVotes.toLocaleString()}</span>
              </span>
              <span class="text-right font-headline font-black uppercase text-lg leading-none truncate" style={`color:${b.opponentAccent}`}>
                {b.opponentShortName}
              </span>
            </div>

            {/* Two-colour vote-share bar + percentages */}
            <div class="flex h-2 gap-0.5 rounded-full overflow-hidden">
              <div style={`width:${b.goatPct}%; background:${accent}`}></div>
              <div style={`width:${b.opponentPct}%; background:${b.opponentAccent}`}></div>
            </div>
            <div class="flex items-center justify-between mt-1.5 font-mono text-[13px] tracking-wider tabular-nums">
              <span style={`color:${accent}`}>{b.goatPct}%</span>
              <span style={`color:${b.opponentAccent}`}>{b.opponentPct}%</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
