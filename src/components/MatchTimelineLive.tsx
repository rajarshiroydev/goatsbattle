import { useEffect, useMemo, useState } from 'preact/hooks';

interface Moment {
  id: number;
  minute: number;
  extra: number | null;
  type: string;
  team: string;
  playerName: string | null;
  goatSlug: string | null;
  goatShortName: string | null;
  detail: string | null;
}
interface Props {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
}

const GLYPH: Record<string, string> = {
  goal: '⚽', penalty: '⚽', own_goal: '⚽', penalty_missed: '❌',
  yellow_card: '🟨', red_card: '🟥', foul: '⚠️', handball: '✋',
  sub: '🔁', var: '📺', shootout: '🥅',
};
const TYPE_LABEL: Record<string, string> = {
  goal: 'Goal', penalty: 'Penalty', own_goal: 'Own goal', penalty_missed: 'Missed pen',
  yellow_card: 'Yellow card', red_card: 'Red card', foul: 'Foul', handball: 'Handball',
  sub: 'Sub', var: 'VAR', shootout: 'Shootout',
};
const glyph = (type: string) => GLYPH[type] ?? '•';
const typeLabel = (type: string) => TYPE_LABEL[type] ?? type.replace(/_/g, ' ');
const minuteLabel = (moment: Moment) => `${moment.minute}${moment.extra ? `+${moment.extra}` : ''}'`;
const anchorLabel = (moment: Moment) => `${minuteLabel(moment)} ${typeLabel(moment.type)}`;

export default function MatchTimelineLive({ matchId, homeTeam, awayTeam }: Props) {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/match-moments?match=${encodeURIComponent(matchId)}`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { moments: Moment[] }) => active && setMoments(data.moments))
      .catch(() => active && setError(true))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [matchId]);

  useEffect(() => {
    const clear = () => setActiveId(null);
    window.addEventListener('gb:moment-clear', clear);
    return () => window.removeEventListener('gb:moment-clear', clear);
  }, []);

  const maxMinute = useMemo(
    () => Math.max(90, ...moments.map((moment) => moment.minute + (moment.extra ?? 0))),
    [moments],
  );
  const pct = (moment: Moment) => Math.min(98, ((moment.minute + (moment.extra ?? 0)) / maxMinute) * 100);
  const home = moments.filter((moment) => moment.team === 'home');
  const away = moments.filter((moment) => moment.team === 'away');

  function select(moment: Moment) {
    setActiveId(moment.id);
    window.dispatchEvent(new CustomEvent('gb:moment', {
      detail: { id: moment.id, label: anchorLabel(moment) },
    }));
  }

  return (
    <div class="bg-canvas-soft border border-hairline rounded-md p-4">
      <div class="flex items-center justify-between mb-3">
        <span class="font-mono text-[10px] uppercase tracking-[0.14em] text-mute">Match timeline</span>
        {!loading && moments.length > 0 && <span class="font-mono text-[10px] uppercase tracking-[0.14em] text-mute">{maxMinute}'</span>}
      </div>
      {loading ? (
        <p class="font-sans text-sm text-mute py-4 text-center">Loading match moments…</p>
      ) : error ? (
        <p class="font-sans text-sm text-mute py-4 text-center">Timeline temporarily unavailable.</p>
      ) : moments.length === 0 ? (
        <p class="font-sans text-sm text-mute py-4 text-center">No moments recorded for this match.</p>
      ) : (
        <div>
          <div class="relative h-[92px] my-1" aria-hidden="true">
            {home.map((moment) => (
              <button key={moment.id} type="button" tabIndex={-1}
                class={`absolute -translate-x-1/2 flex flex-col items-center gap-0.5 cursor-pointer${activeId === moment.id ? ' bg-lime/10 rounded' : ''}`}
                style={`left:${pct(moment)}%; top:0`} title={moment.detail ?? anchorLabel(moment)} onClick={() => select(moment)}>
                <span class="text-[15px] leading-none">{glyph(moment.type)}</span>
                <span class="font-mono text-[9px] text-mute">{minuteLabel(moment)}</span>
              </button>
            ))}
            <div class="absolute left-0 right-0 top-1/2 h-px bg-hairline-strong" />
            <div class="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-lime" />
            <div class="absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-red" />
            {away.map((moment) => (
              <button key={moment.id} type="button" tabIndex={-1}
                class={`absolute -translate-x-1/2 flex flex-col items-center gap-0.5 cursor-pointer${activeId === moment.id ? ' bg-lime/10 rounded' : ''}`}
                style={`left:${pct(moment)}%; bottom:0`} title={moment.detail ?? anchorLabel(moment)} onClick={() => select(moment)}>
                <span class="font-mono text-[9px] text-mute">{minuteLabel(moment)}</span>
                <span class="text-[15px] leading-none">{glyph(moment.type)}</span>
              </button>
            ))}
          </div>
          <div class="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] mb-3">
            <span class="text-lime">{homeTeam}</span><span class="text-red">{awayTeam}</span>
          </div>
          <ul class="flex flex-col gap-0.5 border-t border-hairline pt-2">
            {moments.map((moment) => (
              <li key={moment.id}>
                <button type="button" onClick={() => select(moment)}
                  class={`w-full flex items-start gap-2 text-sm text-left rounded px-1.5 py-1 hover:bg-canvas transition-colors${activeId === moment.id ? ' bg-lime/10' : ''}`}
                  title={`Tag this moment: ${anchorLabel(moment)}`}>
                  <span class="font-mono text-[11px] text-mute w-9 shrink-0 pt-0.5 text-right">{minuteLabel(moment)}</span>
                  <span class="shrink-0" aria-hidden="true">{glyph(moment.type)}</span>
                  <span class="sr-only">{moment.team === 'home' ? homeTeam : awayTeam} — {typeLabel(moment.type)}:</span>
                  <span class="flex-1 min-w-0">
                    <span class="font-sans font-semibold text-ink">{moment.playerName ?? (moment.team === 'home' ? homeTeam : awayTeam)}</span>
                    {moment.detail && <span class="font-sans text-body"> — {moment.detail}</span>}
                  </span>
                  <span class="shrink-0 self-center font-mono text-[9px] uppercase tracking-wider text-lime">Tag ⚑</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
