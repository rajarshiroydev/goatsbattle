import { textOn } from '../lib/colorContrast';
import { compactNumber, flagEmoji, relativeTime } from '../lib/format';

export interface FloorFeedEvent {
  id: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  homeCode: string | null;
  awayCode: string | null;
  homeScore: number | null;
  awayScore: number | null;
  kickoff: string;
  status: string;
  venue: string | null;
  commentCount: number;
  goats: Array<{ slug: string; shortName: string; accent: string; team: string | null }>;
}

export default function FloorEventRow({ event }: { event: FloorFeedEvent }) {
  const isLive = event.status === 'live';
  const isUpcoming = event.status === 'scheduled';
  const hasScore = event.homeScore !== null && event.awayScore !== null;
  return (
    <a
      href={`/floor/${event.id}`}
      class="group flex items-center gap-4 bg-canvas-soft border border-hairline rounded-md px-[18px] py-3.5 hover:border-hairline-strong transition-colors"
      style={isLive ? 'border-left: 2px solid rgba(255,45,85,0.6)' : undefined}
    >
      <div class="shrink-0 w-16 flex flex-col items-start gap-1">
        {isLive ? (
          <span class="font-mono text-[10px] uppercase tracking-[0.12em] text-red flex items-center gap-1.5">
            <span class="live-dot gb-pulse-fast" style="--dot: var(--color-red)" /> Live
          </span>
        ) : (
          <span class="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">
            {isUpcoming ? 'Upcoming' : relativeTime(event.kickoff)}
          </span>
        )}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 font-headline font-black uppercase text-ink text-lg leading-none">
          <span class="truncate">{flagEmoji(event.homeCode ?? '')} {event.homeTeam}</span>
          {hasScore ? (
            <span class="font-mono text-sm text-body shrink-0">{event.homeScore}–{event.awayScore}</span>
          ) : (
            <span class="font-headline text-mute text-base italic shrink-0">vs</span>
          )}
          <span class="truncate">{event.awayTeam} {flagEmoji(event.awayCode ?? '')}</span>
        </div>
        <div class="mt-1.5 flex items-center gap-2 flex-wrap">
          <span class="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">{event.competition}</span>
          {event.goats.map((goat) => (
            <span key={goat.slug} class="team-tag" style={`--tag:${goat.accent}; --tag-fg:${textOn(goat.accent)}`}>
              {goat.shortName}
            </span>
          ))}
        </div>
      </div>
      <span class="shrink-0 flex items-center gap-1.5 font-mono text-[11px] text-mute whitespace-nowrap">
        <span class="text-lime">💬</span> {compactNumber(event.commentCount)}
      </span>
    </a>
  );
}
