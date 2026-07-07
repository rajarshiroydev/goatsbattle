import { useEffect, useState } from 'preact/hooks';
import type { RankEntry } from '../lib/rankWire';

interface Props {
  slug: string;
  arena: string;
  /** Player accent colour (hex) for the headline rank figure. */
  accent: string;
}

/**
 * Live "global standing" strip for a player profile. Profile pages are static
 * (prerendered), so the mutable rank/score/record are hydrated client-side from
 * the shared /api/rankings endpoint. See [[project-goatsbattle]].
 */
export default function PlayerRank({ slug, arena, accent }: Props) {
  const [me, setMe] = useState<RankEntry | null>(null);
  const [field, setField] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    fetch(`/api/rankings?arena=${encodeURIComponent(arena)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((rows: RankEntry[]) => {
        if (!active) return;
        setField(rows.length);
        const found = rows.find((r) => r.id === slug) ?? null;
        setMe(found);
        setState('ready');
      })
      .catch(() => active && setState('error'));
    return () => {
      active = false;
    };
  }, [slug, arena]);

  if (state === 'error') return null;

  const cells: Array<{ value: string; label: string; accent?: boolean }> =
    state === 'ready' && me
      ? [
          { value: `#${me.rank}`, label: field ? `of ${field}` : 'Global rank', accent: true },
          { value: me.votes.toLocaleString(), label: 'Votes' },
          { value: me.headToHeadVotes.toLocaleString(), label: '1v1 votes' },
          { value: me.headToHeadVotes > 0 ? `${me.winRate}%` : '—', label: '1v1 win rate' },
        ]
      : [
          { value: '—', label: 'Global rank', accent: true },
          { value: '—', label: 'Votes' },
          { value: '—', label: '1v1 votes' },
          { value: '—', label: '1v1 win rate' },
        ];

  const loading = state === 'loading';

  return (
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cells.map((c) => (
        <div class="bg-canvas border border-hairline rounded-md px-5 py-5">
          <p
            class={`font-headline font-black text-5xl leading-none ${c.accent ? '' : 'text-ink'} ${loading ? 'animate-pulse' : ''}`}
            style={c.accent && !loading ? { color: accent } : undefined}
          >
            {c.value}
          </p>
          <p class="font-mono text-xs uppercase tracking-widest text-mute mt-2.5">{c.label}</p>
        </div>
      ))}
    </div>
  );
}
