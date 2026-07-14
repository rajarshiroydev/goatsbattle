import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  subscribeMatchMoments, anchorLabel, minuteLabel, isGoal, isCard,
  type Moment,
} from '../lib/matchMoments';

interface Props {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
}

/**
 * Full-width match timeline rail (design §4a). Sits under the scoreboard.
 * Only goals (labelled circles) and cards (thin ticks) land on the rail so it
 * stays legible — subs/VAR/etc. live in the Match Moments list. Clicking a
 * marker anchors the debate composer to that moment (`gb:moment`).
 */
export default function MatchTimelineRail({ matchId, homeTeam, awayTeam }: Props) {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);

  useEffect(() => {
    return subscribeMatchMoments(
      matchId,
      (feed) => {
        setMoments(feed.moments);
        setReady(true);
      },
      () => setReady(true),
    );
  }, [matchId]);

  useEffect(() => {
    const clear = () => setActiveId(null);
    window.addEventListener('gb:moment-clear', clear);
    return () => window.removeEventListener('gb:moment-clear', clear);
  }, []);

  const maxMinute = useMemo(
    () => Math.max(90, ...moments.map((m) => m.minute + (m.extra ?? 0))),
    [moments],
  );
  const pct = (m: Moment) => Math.min(97, Math.max(3, ((m.minute + (m.extra ?? 0)) / maxMinute) * 100));
  const htPct = Math.min(97, Math.max(3, (45 / maxMinute) * 100));

  const railMoments = moments.filter((m) => isGoal(m.type) || isCard(m.type));
  // Nothing to show before data resolves or for matches with no rail events.
  if (!ready || railMoments.length === 0) return null;

  const goals = railMoments.filter((m) => isGoal(m.type));
  const cards = railMoments.filter((m) => isCard(m.type));
  const cardColor = (type: string) => (type === 'red_card' ? 'var(--color-red)' : '#f5c518');

  function select(m: Moment) {
    setActiveId(m.id);
    window.dispatchEvent(new CustomEvent('gb:moment', { detail: { id: m.id, label: anchorLabel(m) } }));
  }

  return (
    <div class="mt-3 bg-canvas-soft border border-hairline rounded-lg px-5 sm:px-10 pt-3.5 pb-5">
      <div class="flex items-center justify-between mb-1 font-mono text-[9.5px] uppercase tracking-[0.16em]">
        <span class="text-lime">▲ {homeTeam}</span>
        <span class="text-mute">Match timeline</span>
      </div>

      <div class="relative h-[104px]">
        {/* rail + endpoints */}
        <div class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-hairline-strong" />
        <div class="absolute left-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-lime" />
        <div class="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-red" />

        {/* half-time divider */}
        <div class="absolute top-[38px] h-[28px] border-l border-dashed border-hairline-strong" style={`left:${htPct}%`} />
        <div class="absolute top-[20px] -translate-x-1/2 font-mono text-[8.5px] uppercase tracking-[0.14em] text-mute" style={`left:${htPct}%`}>HT</div>

        {/* goals — home above the rail, away below */}
        {goals.map((m) => {
          const home = m.team === 'home';
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => select(m)}
              title={m.detail ?? anchorLabel(m)}
              class={`absolute -translate-x-1/2 flex flex-col items-center gap-1 ${home ? 'top-0' : 'top-[58px]'} ${activeId === m.id ? 'z-10' : ''}`}
              style={`left:${pct(m)}%`}
            >
              {home && <span class="font-headline font-extrabold text-[12px] text-lime leading-none">{minuteLabel(m)}</span>}
              <span
                class={`w-[22px] h-[22px] rounded-full grid place-items-center text-[11px] leading-none ${home ? 'bg-lime' : 'bg-red'} ${activeId === m.id ? 'ring-2 ring-ink' : ''}`}
                style={`box-shadow:0 0 0 4px ${home ? 'rgba(200,255,0,0.14)' : 'rgba(255,45,85,0.14)'}`}
              >⚽</span>
              {!home && <span class="font-headline font-extrabold text-[12px] text-red leading-none">{minuteLabel(m)}</span>}
            </button>
          );
        })}

        {/* cards — thin ticks hugging the rail */}
        {cards.map((m) => {
          const home = m.team === 'home';
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => select(m)}
              title={m.detail ?? anchorLabel(m)}
              class={`absolute -translate-x-1/2 w-[9px] h-[12px] rounded-[1px] ${home ? 'top-[38px]' : 'top-[54px]'} ${activeId === m.id ? 'ring-2 ring-ink' : ''}`}
              style={`left:${pct(m)}%; background:${cardColor(m.type)}`}
            />
          );
        })}
      </div>

      <div class="flex items-center justify-between mt-1 font-mono text-[9.5px] uppercase tracking-[0.16em]">
        <span class="text-red">▼ {awayTeam}</span>
        <span class="flex items-center gap-3 text-mute">
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-lime" />Goal</span>
          <span class="flex items-center gap-1.5"><span class="w-2 h-2.5 rounded-[1px]" style="background:#f5c518" />Card</span>
        </span>
      </div>
    </div>
  );
}
