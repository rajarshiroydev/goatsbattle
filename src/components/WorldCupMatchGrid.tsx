import { flagEmoji } from '../lib/format';
import { useWorldCupStatus } from '../lib/useWorldCupStatus';
import type { WorldCupHubMatch } from './WorldCupHub';

const STAGE_LABEL: Record<string, string> = {
  group: 'Group stage',
  'round-of-32': 'Round of 32',
  'round-of-16': 'Round of 16',
  quarterfinal: 'Quarter-final',
  semifinal: 'Semi-final',
  'third-place': 'Bronze match',
  final: 'Final',
};

const stageLabel = (stage: string) =>
  STAGE_LABEL[stage] ?? stage.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const kickoffLabel = (kickoff: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
  }).format(new Date(kickoff));

/** The one-line pitch under each card title. */
function description(match: WorldCupHubMatch) {
  if (match.status === 'live') return `Live from ${match.venue}. Call it as it happens.`;
  if (match.status === 'finished') return `Full time at ${match.venue}. Argue the result.`;
  return `${kickoffLabel(match.kickoff)} · ${match.venue}`;
}

function MatchCard({ match }: { match: WorldCupHubMatch }) {
  const live = match.status === 'live';
  const finished = match.status === 'finished';
  const hasScore = match.homeScore !== null && match.awayScore !== null;

  return (
    <a
      href={`/floor/${match.id}`}
      class="flex flex-col bg-canvas-soft border border-hairline rounded-lg p-5 hover:border-hairline-strong transition-colors"
    >
      <div class="flex items-center justify-between gap-3">
        <span class="font-mono text-[10.5px] uppercase tracking-[0.16em] text-lime">
          {stageLabel(match.stage)}
        </span>
        <span class="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-mute">
          {live && <span class="live-dot" aria-hidden="true"></span>}
          {live ? 'Live' : finished ? 'Full time' : `Match ${match.matchNumber}`}
        </span>
      </div>

      {/* mb-5 sets the minimum gap; the foot's mt-auto absorbs any extra height
          the tallest card in the row imposes. */}
      <div class="mt-5 mb-5 grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
        <div class="text-center min-w-0">
          <span class="text-2xl" aria-hidden="true">{flagEmoji(match.homeCode ?? '')}</span>
          <p class="mt-1.5 font-headline font-black uppercase text-lg text-ink truncate">{match.homeTeam}</p>
        </div>
        <span class="font-headline font-black italic text-xl text-mute">
          {hasScore ? `${match.homeScore}–${match.awayScore}` : 'vs'}
        </span>
        <div class="text-center min-w-0">
          <span class="text-2xl" aria-hidden="true">{flagEmoji(match.awayCode ?? '')}</span>
          <p class="mt-1.5 font-headline font-black uppercase text-lg text-ink truncate">{match.awayTeam}</p>
        </div>
      </div>

      {/* Title + description, pinned to the card foot so ragged descriptions
          don't leave the row's bottom edges misaligned. */}
      <div class="mt-auto pt-4 border-t border-hairline">
        <p class="font-headline font-black uppercase text-base text-ink truncate">
          {match.homeTeam} vs {match.awayTeam}
        </p>
        <p class="mt-1 font-sans text-xs leading-relaxed text-body">{description(match)}</p>
      </div>
    </a>
  );
}

/**
 * The tournament's decisive matches, as a static grid inside the page
 * container. Deliberately not a carousel: there are only a handful of matches,
 * so showing them all at once beats hiding them behind motion — and it keeps
 * the section within the shared `.page-container` width.
 */
export default function WorldCupMatchGrid({ fixtures }: { fixtures: WorldCupHubMatch[] }) {
  const matches = useWorldCupStatus(fixtures);
  if (matches.length === 0) return null;

  return (
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {matches.map((match) => <MatchCard key={match.id} match={match} />)}
    </div>
  );
}
