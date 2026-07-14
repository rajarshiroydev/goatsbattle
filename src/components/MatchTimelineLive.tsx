import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  subscribeMatchMoments, anchorLabel, minuteLabel, momentGlyph, momentTypeLabel,
  isGoal, isCard, type Moment,
} from '../lib/matchMoments';

interface Props {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
}

/** "GOAL · penalty · 1–0" style sub-label for a moment row (design §4a). */
function detailLine(moment: Moment, score: string | null): string {
  const parts: string[] = [];
  if (isGoal(moment.type)) {
    parts.push(moment.type === 'own_goal' ? 'Own goal' : 'Goal');
    if (moment.type === 'penalty') parts.push('penalty');
  } else {
    parts.push(moment.type === 'red_card' ? 'Red' : moment.type === 'yellow_card' ? 'Yellow' : momentTypeLabel(moment.type));
  }
  if (moment.detail) parts.push(moment.detail);
  if (score) parts.push(score);
  return parts.join(' · ');
}

export default function MatchTimelineLive({ matchId, homeTeam, awayTeam }: Props) {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [hasProvisional, setHasProvisional] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  useEffect(() => {
    return subscribeMatchMoments(
      matchId,
      (feed) => {
        setMoments(feed.moments);
        setHasProvisional(feed.hasProvisional);
        setFetchedAt(feed.fetchedAt);
        setError(false);
        setLoading(false);
      },
      () => {
        setError(true);
        setLoading(false);
      },
    );
  }, [matchId]);

  useEffect(() => {
    const clear = () => setActiveId(null);
    window.addEventListener('gb:moment-clear', clear);
    return () => window.removeEventListener('gb:moment-clear', clear);
  }, []);

  // Running score after each goal, so goal rows can read "2–0" like the design.
  const scoreByMoment = useMemo(() => {
    const map = new Map<number, string>();
    let home = 0;
    let away = 0;
    for (const m of moments) {
      if (!isGoal(m.type)) continue;
      // Own goals credit the opposing side.
      if (m.type === 'own_goal') { m.team === 'home' ? (away += 1) : (home += 1); }
      else { m.team === 'home' ? (home += 1) : (away += 1); }
      map.set(m.id, `${home}–${away}`);
    }
    return map;
  }, [moments]);

  function select(moment: Moment) {
    setActiveId(moment.id);
    window.dispatchEvent(new CustomEvent('gb:moment', { detail: { id: moment.id, label: anchorLabel(moment) } }));
  }

  return (
    <div class="bg-canvas-soft border border-hairline rounded-lg p-4 sm:p-5">
      <div class="flex items-baseline justify-between mb-1">
        <span class="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink">Match Moments</span>
        {!loading && moments.length > 0 && (
          <span class={`font-mono text-[10px] ${hasProvisional ? 'text-red' : 'text-mute'}`}>
            {hasProvisional ? 'Live · provisional' : `${moments.length} ${moments.length === 1 ? 'event' : 'events'}`}
          </span>
        )}
      </div>

      {loading ? (
        <p class="font-sans text-sm text-mute py-4 text-center">Loading match moments…</p>
      ) : error ? (
        <p class="font-sans text-sm text-mute py-4 text-center">Timeline temporarily unavailable.</p>
      ) : moments.length === 0 ? (
        <p class="font-sans text-sm text-mute py-4 text-center">No moments recorded for this match.</p>
      ) : (
        <ul class="mt-1">
          {moments.map((moment, index) => {
            const home = moment.team === 'home';
            const goal = isGoal(moment.type);
            const card = isCard(moment.type);
            const showHalfTime = index > 0 && moments[index - 1].minute <= 45 && moment.minute > 45;
            return (
              <li key={moment.id}>
                {showHalfTime && (
                  <div class="flex items-center gap-2.5 py-2">
                    <span class="flex-1 h-px bg-hairline" />
                    <span class="font-mono text-[9px] uppercase tracking-[0.16em] text-mute">Half time</span>
                    <span class="flex-1 h-px bg-hairline" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => select(moment)}
                  title={`Tag this moment: ${anchorLabel(moment)}`}
                  class={`group grid grid-cols-[34px_18px_1fr_auto] items-start gap-2.5 w-full text-left py-3 border-b border-[color:var(--color-hairline)]/70 last:border-0 transition-colors hover:bg-canvas ${activeId === moment.id ? 'bg-lime/5' : ''}`}
                >
                  <span class={`font-headline font-extrabold text-[14px] leading-none pt-0.5 ${home ? 'text-lime' : 'text-red'}`}>{minuteLabel(moment)}</span>
                  <span class="mt-0.5 flex justify-center" aria-hidden="true">
                    {goal ? (
                      <span class="w-4 h-4 rounded-full bg-lime grid place-items-center text-[9px] leading-none">⚽</span>
                    ) : card ? (
                      <span class="w-3 h-[15px] rounded-[2px]" style={`background:${moment.type === 'red_card' ? 'var(--color-red)' : '#f5c518'}`} />
                    ) : (
                      <span class="text-[12px] leading-none">{momentGlyph(moment.type)}</span>
                    )}
                  </span>
                  <span class="min-w-0">
                    <span class="sr-only">{home ? homeTeam : awayTeam} — </span>
                    <span class={`block font-sans text-[13.5px] leading-tight text-ink ${goal ? 'font-bold' : 'font-semibold'}`}>
                      {moment.playerName ?? (home ? homeTeam : awayTeam)}
                    </span>
                    <span class={`block mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${goal ? 'text-lime' : 'text-mute'}`}>
                      {detailLine(moment, goal ? scoreByMoment.get(moment.id) ?? null : null)}
                      {moment.verificationStatus === 'provisional' ? ' · provisional' : ''}
                    </span>
                  </span>
                  <span class="self-center font-mono text-[9px] uppercase tracking-wider text-lime opacity-0 group-hover:opacity-100 transition-opacity">Tag ⚑</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hasProvisional && fetchedAt && (
        <p class="mt-3 font-mono text-[9px] uppercase tracking-[0.1em] text-mute">
          Live events may be corrected · feed updated {new Date(fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
    </div>
  );
}
