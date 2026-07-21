import { useBattleTallies } from '../lib/homeBattleTallies';
import type { MarqueeBattle } from './MarqueeCarousel';

interface Props {
  battles: MarqueeBattle[];
  /** Evergreen call-outs woven in after the scorelines. */
  callouts: string[];
}

/**
 * The battle board strip under the hero. Shares one tally request with the
 * carousel above it — the two must never quote different percentages for the
 * same battle. Two identical groups, second hidden from assistive tech.
 */
export default function BattleTicker({ battles, callouts }: Props) {
  const deck = useBattleTallies(battles, (b, tally) => ({ ...b, leftPct: tally.leftPct }));

  const items = [
    ...deck.map((b) => `${b.arenaEmoji} ${b.leftName} ${b.leftPct}% ▸ ${b.rightName} ${100 - b.leftPct}%`),
    ...callouts,
  ];
  if (items.length === 0) return null;

  return (
    <section class="marquee border-b border-hairline bg-canvas-soft overflow-hidden" aria-label="Battle board">
      <div class="marquee-track flex items-center whitespace-nowrap py-2.5">
        {[0, 1].map((copy) => (
          <div key={copy} class="flex items-center shrink-0" aria-hidden={copy === 1 ? 'true' : undefined}>
            {items.map((item) => (
              <span key={item} class="flex items-center">
                <span class="font-mono text-[11px] uppercase tracking-[0.16em] text-body px-6">{item}</span>
                <span class="w-1 h-1 rounded-full bg-lime shrink-0"></span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
