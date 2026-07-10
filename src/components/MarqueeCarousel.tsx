import { useEffect, useState } from 'preact/hooks';

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
 * "Happening Now" marquee — cycles one battle card at a time (design §5 /
 * landing 3h). Auto-advances every 3.5s with a 280ms opacity fade; pill dots
 * jump to any card and restart the timer. Left = lime (champion),
 * right = red (challenger), always.
 */
export default function MarqueeCarousel({ battles }: Props) {
  const [i, setI] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (battles.length <= 1) return;
    const timer = setInterval(() => advance((i + 1) % battles.length), 3500);
    return () => clearInterval(timer);
  }, [i, battles.length]);

  function advance(next: number) {
    setVisible(false);
    setTimeout(() => {
      setI(next);
      setVisible(true);
    }, 280);
  }

  function goTo(idx: number) {
    if (idx === i) return;
    advance(idx);
  }

  if (battles.length === 0) return null;
  const b = battles[i];
  const rightPct = 100 - b.leftPct;

  return (
    <div class="flex flex-col gap-2.5 w-full max-w-[400px]">
      <div class="flex items-center gap-2 mb-0.5">
        <span class="live-dot"></span>
        <span class="font-mono text-[11px] uppercase tracking-[0.18em] text-lime">Happening now</span>
      </div>

      <div class="bg-canvas-soft border border-hairline rounded-md overflow-hidden" style="box-shadow: 0 4px 24px rgba(0,0,0,0.5)">
        <div style={`transition: opacity 0.28s ease; opacity: ${visible ? 1 : 0}`}>
          {/* header */}
          <div class="flex items-center justify-between px-4 py-3 border-b border-hairline">
            <span class="font-mono text-[10.5px] uppercase tracking-[0.16em] text-mute">Marquee battle</span>
            <span class="font-mono text-[10.5px] uppercase tracking-[0.16em]" style={`color:${b.arenaAccent}`}>
              {b.arenaEmoji} {b.arenaLabel}
            </span>
          </div>

          {/* body */}
          <div class="px-4 pt-[18px] pb-4">
            <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div class="text-center min-w-0">
                <div class="font-headline font-black uppercase text-[27px] leading-none text-ink truncate">{b.leftName}</div>
                <div class="font-headline font-black text-[34px] leading-none text-lime mt-1.5">{b.leftPct}%</div>
              </div>
              <span class="font-headline font-black italic text-xl text-mute">VS</span>
              <div class="text-center min-w-0">
                <div class="font-headline font-black uppercase text-[27px] leading-none text-ink truncate">{b.rightName}</div>
                <div class="font-headline font-black text-[34px] leading-none text-red mt-1.5">{rightPct}%</div>
              </div>
            </div>

            <div class="vote-bar mt-3.5" style={`--seg:${b.leftPct}%`}>
              <div class="vote-seg-a"></div>
              <div class="vote-seg-b"></div>
            </div>

            <div class="flex justify-between mt-2.5">
              <span class="font-mono text-[11px] text-mute">{b.votes} votes</span>
              <a href={`/battle/${b.slug}`} class="font-mono text-[11px] text-lime hover:text-ink transition-colors">Cast yours →</a>
            </div>
          </div>
        </div>
      </div>

      {battles.length > 1 && (
        <div class="flex justify-center gap-[7px]">
          {battles.map((_, idx) => (
            <button
              key={idx}
              type="button"
              aria-label={`Show battle ${idx + 1}`}
              onClick={() => goTo(idx)}
              class="h-1.5 rounded-full transition-all duration-300"
              style={`width:${idx === i ? 22 : 6}px; background:${idx === i ? 'var(--color-lime)' : 'var(--color-hairline-strong)'}`}
            ></button>
          ))}
        </div>
      )}
    </div>
  );
}
