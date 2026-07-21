import { useEffect, useState } from 'preact/hooks';
import { useBattleTallies } from '../lib/homeBattleTallies';

export interface MarqueeBattle {
  slug: string;
  arenaLabel: string;
  arenaEmoji: string;
  arenaAccent: string;
  leftName: string;
  rightName: string;
  /** Left side's share of the vote (0–100). Right is the remainder. */
  leftPct: number;
  /** Formatted total, e.g. "214,382". */
  votes: string;
}

interface Props {
  battles: MarqueeBattle[];
}

/**
 * Hero battle carousel (landing 3h). A stacked "coverflow" deck: the active
 * battle sits full-size in the centre with the previous/next cards peeking,
 * scaled-down and dimmed, behind either edge. Advancing animates the deck
 * across. Auto-advances every 4.2s; arrows + dots restart the timer.
 * Left = lime (champion), right = red (challenger), always.
 */
export default function MarqueeCarousel({ battles }: Props) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  // The page renders a static zero-tally shell so anonymous views never touch
  // the database; the real percentages arrive here, after mount.
  const deck = useBattleTallies(battles, (b, tally) => ({
    ...b,
    leftPct: tally.leftPct,
    votes: tally.total.toLocaleString(),
  }));
  const n = deck.length;

  useEffect(() => {
    if (n <= 1 || paused) return;
    // setTimeout (not setInterval) so navigation — which changes `i` — restarts
    // the countdown rather than letting a near-due interval fire immediately.
    // Paused while focus is inside the deck so the active card never slides out
    // from under a focused link.
    const timer = setTimeout(() => setI((cur) => (cur + 1) % n), 4200);
    return () => clearTimeout(timer);
  }, [n, i, paused]);

  if (n === 0) return null;

  const go = (next: number) => setI(((next % n) + n) % n);

  // Circular offset of card j from the active card, in the range [-n/2, n/2].
  const offsetOf = (j: number) => {
    let off = j - i;
    if (off > n / 2) off -= n;
    else if (off < -n / 2) off += n;
    return off;
  };

  return (
    <div
      class="w-full h-full flex flex-col"
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* Card stage — fills the column so the centre card's top sits flush
          with the hero heading on the left. */}
      {/* No overflow-hidden here: the neighbouring cards are meant to spill past
          the column and peek. The hero section's own overflow-x-clip stops that
          spill from producing a horizontal scrollbar. */}
      <div class="relative flex-1 min-h-[280px] [perspective:1400px]">
        {deck.map((b, j) => {
          const off = offsetOf(j);
          const abs = Math.abs(off);
          const isCenter = off === 0;
          const rightPct = 100 - b.leftPct;
          // Base -50% centres the card (left-anchored at 50%); each step fans
          // the neighbours out so they peek, mostly tucked behind the centre.
          const tx = -50 + off * 50;
          const scale = isCenter ? 1 : abs === 1 ? 0.84 : 0.74;
          const opacity = isCenter ? 1 : abs === 1 ? 0.38 : 0;
          const z = isCenter ? 30 : abs === 1 ? 20 : 0;

          return (
            <div
              key={b.slug}
              class="absolute inset-y-0 left-1/2 w-[82%]"
              style={`transform: translate(${tx}%, 0) scale(${scale}); opacity: ${opacity}; z-index: ${z}; pointer-events: ${isCenter ? 'auto' : 'none'}; transition: transform 0.55s cubic-bezier(.4,.12,.25,1), opacity 0.55s ease`}
              aria-hidden={!isCenter}
            >
              <div class="h-full flex flex-col bg-canvas-soft border border-hairline rounded-lg overflow-hidden"
                style="box-shadow: 0 12px 40px rgba(0,0,0,0.55)">
                {/* header — arena tag only, right-aligned */}
                <div class="flex items-center justify-end px-4 py-3 border-b border-hairline shrink-0">
                  <span class="font-mono text-[10.5px] uppercase tracking-[0.16em]" style={`color:${b.arenaAccent}`}>
                    {b.arenaEmoji} {b.arenaLabel}
                  </span>
                </div>

                {/* body — centred in the taller card */}
                <div class="flex-1 flex flex-col justify-center px-5 py-4">
                  <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <div class="text-center min-w-0">
                      <div class="font-headline font-black uppercase text-[27px] leading-none text-ink truncate">{b.leftName}</div>
                      <div class="font-headline font-black text-[36px] leading-none text-lime mt-2">{b.leftPct}%</div>
                    </div>
                    <span class="font-headline font-black italic text-xl text-mute">VS</span>
                    <div class="text-center min-w-0">
                      <div class="font-headline font-black uppercase text-[27px] leading-none text-ink truncate">{b.rightName}</div>
                      <div class="font-headline font-black text-[36px] leading-none text-red mt-2">{rightPct}%</div>
                    </div>
                  </div>

                  <div class="vote-bar mt-4" style={`--seg:${b.leftPct}%`}>
                    <div class="vote-seg-a"></div>
                    <div class="vote-seg-b"></div>
                  </div>
                </div>

                {/* footer */}
                <div class="flex justify-between px-5 py-3.5 border-t border-hairline shrink-0">
                  <span class="font-mono text-[11px] text-mute">{b.votes} votes</span>
                  <a href={`/battle/${b.slug}`} class="font-mono text-[11px] text-lime hover:text-ink transition-colors" tabIndex={isCenter ? 0 : -1}>Cast yours →</a>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Controls — prev · dots · next */}
      {n > 1 && (
        <div class="flex items-center justify-center gap-4 mt-5 shrink-0">
          <button
            type="button"
            aria-label="Previous battle"
            onClick={() => go(i - 1)}
            class="font-mono text-lg text-mute hover:text-ink transition-colors leading-none"
          >←</button>

          <div class="flex items-center gap-[7px]">
            {deck.map((_, idx) => (
              <button
                key={idx}
                type="button"
                aria-label={`Show battle ${idx + 1}`}
                onClick={() => go(idx)}
                class="h-1.5 rounded-full transition-all duration-300"
                style={`width:${idx === i ? 22 : 6}px; background:${idx === i ? 'var(--color-lime)' : 'var(--color-hairline-strong)'}`}
              ></button>
            ))}
          </div>

          <button
            type="button"
            aria-label="Next battle"
            onClick={() => go(i + 1)}
            class="font-mono text-lg text-mute hover:text-ink transition-colors leading-none"
          >→</button>
        </div>
      )}
    </div>
  );
}
