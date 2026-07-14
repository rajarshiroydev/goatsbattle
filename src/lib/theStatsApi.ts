import type { WorldCupCanonicalFixture } from '../data/worldCup2026';

export const THE_STATS_API_PROVIDER = 'thestatsapi' as const;
export const THE_STATS_API_BASE_URL = 'https://api.thestatsapi.com/api';
export const THE_STATS_API_WORLD_CUP_COMPETITION = 'comp_6107';
export const THE_STATS_API_WORLD_CUP_SEASON = 'sn_118868';

export type StatsApiMatchStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'postponed'
  | 'cancelled';

export type TimelinePeriod =
  | 'first_half'
  | 'second_half'
  | 'extra_time_first_half'
  | 'extra_time_second_half'
  | 'penalties';

export type TimelineEventType =
  | 'goal'
  | 'shot_on_target'
  | 'shot_off_target'
  | 'shot_blocked'
  | 'shot_saved'
  | 'yellow_card'
  | 'red_card'
  | 'yellow_red_card'
  | 'foul'
  | 'offside'
  | 'corner_kick'
  | 'substitution'
  | 'penalty_awarded'
  | 'penalty_scored'
  | 'penalty_missed'
  | 'penalty_saved'
  | 'var'
  | 'period_start'
  | 'period_end'
  | 'added_time';

export interface StatsApiEntityRef {
  id: string | null;
  name: string | null;
  slug: string | null;
}

export interface StatsApiScore {
  home: number | null;
  away: number | null;
  finalScore: { home: number; away: number } | null;
  regulation: { home: number; away: number } | null;
  afterExtraTime: { home: number; away: number } | null;
  penaltyShootout: { home: number; away: number } | null;
  wentToExtraTime: boolean | null;
  wentToPenalties: boolean | null;
  winner: 'home' | 'away' | 'draw' | null;
}

export interface StatsApiMatch {
  id: string;
  competitionId: string;
  seasonId: string;
  status: StatsApiMatchStatus;
  kickoff: string;
  stageName: string | null;
  homeTeam: { id: string; name: string };
  awayTeam: { id: string; name: string };
  score: StatsApiScore;
}

export interface StatsApiTimelineEvent {
  sequence: number;
  minute: number;
  extraTime: number;
  period: TimelinePeriod;
  type: TimelineEventType;
  team: StatsApiEntityRef | null;
  player: StatsApiEntityRef | null;
}

export interface StatsApiTimeline {
  matchId: string;
  coverage: 'full' | 'partial' | 'none';
  reason: string | null;
  lastUpdated: string | null;
  events: StatsApiTimelineEvent[];
}

export interface StatsApiLineupPlayer {
  id: string;
  name: string;
  position: string | null;
  jerseyNumber: number | null;
}

export interface StatsApiLineupSide {
  id: string;
  name: string;
  formation: string | null;
  startingXi: StatsApiLineupPlayer[];
  substitutes: StatsApiLineupPlayer[];
}

export interface StatsApiLineup {
  matchId: string;
  confirmed: boolean;
  home: StatsApiLineupSide;
  away: StatsApiLineupSide;
}

export type LineupQuality =
  | { accepted: true; reason: 'official-window-complete' | 'finished-complete' }
  | {
      accepted: false;
      reason:
        | 'too-early'
        | 'provider-unconfirmed'
        | 'incomplete-starting-xi'
        | 'missing-bench'
        | 'duplicate-player';
    };

export interface CanonicalStatsApiMatch {
  fixture: WorldCupCanonicalFixture;
  provider: StatsApiMatch;
}

const MATCH_STATUSES = new Set<StatsApiMatchStatus>([
  'scheduled', 'live', 'finished', 'postponed', 'cancelled',
]);
const TIMELINE_PERIODS = new Set<TimelinePeriod>([
  'first_half', 'second_half', 'extra_time_first_half',
  'extra_time_second_half', 'penalties',
]);
const TIMELINE_TYPES = new Set<TimelineEventType>([
  'goal', 'shot_on_target', 'shot_off_target', 'shot_blocked', 'shot_saved',
  'yellow_card', 'red_card', 'yellow_red_card', 'foul', 'offside', 'corner_kick',
  'substitution', 'penalty_awarded', 'penalty_scored', 'penalty_missed',
  'penalty_saved', 'var', 'period_start', 'period_end', 'added_time',
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new Error(`${label} must be a safe integer greater than or equal to ${minimum}.`);
  }
  return Number(value);
}

function nullableInteger(value: unknown, label: string): number | null {
  return value === null || value === undefined ? null : integer(value, label);
}

function nullableBoolean(value: unknown, label: string): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean or null.`);
  return value;
}

function scorePair(value: unknown, label: string): { home: number; away: number } | null {
  if (value === null || value === undefined) return null;
  const pair = record(value, label);
  return {
    home: integer(pair.home, `${label}.home`),
    away: integer(pair.away, `${label}.away`),
  };
}

function team(value: unknown, label: string): { id: string; name: string } {
  const item = record(value, label);
  return { id: string(item.id, `${label}.id`), name: string(item.name, `${label}.name`) };
}

function mapScore(value: unknown): StatsApiScore {
  const item = record(value, 'match.score');
  const rawWinner = nullableString(item.winner);
  if (rawWinner && rawWinner !== 'home' && rawWinner !== 'away' && rawWinner !== 'draw') {
    throw new Error(`Unsupported match.score.winner: ${rawWinner}.`);
  }
  return {
    home: nullableInteger(item.home, 'match.score.home'),
    away: nullableInteger(item.away, 'match.score.away'),
    finalScore: scorePair(item.final_score, 'match.score.final_score'),
    regulation: scorePair(item.regulation, 'match.score.regulation'),
    afterExtraTime: scorePair(item.after_extra_time, 'match.score.after_extra_time'),
    penaltyShootout: scorePair(item.penalty_shootout, 'match.score.penalty_shootout'),
    wentToExtraTime: nullableBoolean(item.went_to_extra_time, 'match.score.went_to_extra_time'),
    wentToPenalties: nullableBoolean(item.went_to_penalties, 'match.score.went_to_penalties'),
    winner: rawWinner as StatsApiScore['winner'],
  };
}

export function mapStatsApiMatch(value: unknown): StatsApiMatch {
  const item = record(value, 'match');
  const status = string(item.status, 'match.status') as StatsApiMatchStatus;
  if (!MATCH_STATUSES.has(status)) throw new Error(`Unsupported match status: ${status}.`);
  const kickoff = string(item.utc_date, 'match.utc_date');
  if (Number.isNaN(Date.parse(kickoff))) throw new Error(`Invalid match kickoff: ${kickoff}.`);
  return {
    id: string(item.id, 'match.id'),
    competitionId: string(item.competition_id, 'match.competition_id'),
    seasonId: string(item.season_id, 'match.season_id'),
    status,
    kickoff,
    stageName: nullableString(item.stage_name),
    homeTeam: team(item.home_team, 'match.home_team'),
    awayTeam: team(item.away_team, 'match.away_team'),
    score: mapScore(item.score),
  };
}

export function validateStatsApiMatchesPage(value: unknown): {
  matches: StatsApiMatch[];
  page: number;
  total: number;
  totalPages: number;
} {
  const payload = record(value, 'matches payload');
  if (!Array.isArray(payload.data)) throw new Error('matches payload.data must be an array.');
  const meta = record(payload.meta, 'matches payload.meta');
  const matches = payload.data.map(mapStatsApiMatch);
  const ids = new Set(matches.map((match) => match.id));
  if (ids.size !== matches.length) throw new Error('matches page contains duplicate provider IDs.');
  return {
    matches,
    page: integer(meta.page, 'matches payload.meta.page', 1),
    total: integer(meta.total, 'matches payload.meta.total'),
    totalPages: integer(meta.total_pages, 'matches payload.meta.total_pages', 1),
  };
}

function normalizeTeamName(value: string): string {
  const basic = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const placeholder = basic.match(/^(winner|loser) match (\d+)$/);
  if (placeholder) return `${placeholder[1]} match ${placeholder[2]}`;
  const shortPlaceholder = basic.match(/^([wl])(\d+)$/);
  if (shortPlaceholder) return `${shortPlaceholder[1] === 'w' ? 'winner' : 'loser'} match ${shortPlaceholder[2]}`;
  const aliases: Readonly<Record<string, string>> = {
    'turkiye': 'turkey',
    'cote d ivoire': 'ivory coast',
    'korea republic': 'south korea',
    'usa': 'united states',
    'united states of america': 'united states',
    'czechia': 'czech republic',
    'bosnia herzegovina': 'bosnia and herzegovina',
    'dr congo': 'democratic republic of the congo',
    'congo dr': 'democratic republic of the congo',
    'democratic republic congo': 'democratic republic of the congo',
    'curacao': 'curacao',
  };
  return aliases[basic] ?? basic;
}

/** Keep canonical, reader-friendly placeholders until the provider names a real team. */
export function displayProviderTeamName(providerName: string, canonicalName: string): string {
  const normalized = providerName.trim();
  return /^(?:[wl]\d+|(?:winner|loser)\s+match\s+\d+)$/i.test(normalized)
    ? canonicalName
    : providerName;
}

export function mapStatsApiWorldCupMatches(
  providerMatches: readonly StatsApiMatch[],
  canonicalFixtures: readonly WorldCupCanonicalFixture[],
): CanonicalStatsApiMatch[] {
  if (providerMatches.length !== 104) {
    throw new Error(`Expected 104 TheStatsAPI matches; received ${providerMatches.length}.`);
  }
  if (new Set(providerMatches.map((match) => match.id)).size !== 104) {
    throw new Error('TheStatsAPI World Cup provider IDs must be unique.');
  }

  const unused = new Set(canonicalFixtures.map((fixture) => fixture.id));
  const mapped = providerMatches.map((provider) => {
    const candidates = canonicalFixtures.filter((fixture) => {
      if (!unused.has(fixture.id)) return false;
      return normalizeTeamName(fixture.homeTeam) === normalizeTeamName(provider.homeTeam.name)
        && normalizeTeamName(fixture.awayTeam) === normalizeTeamName(provider.awayTeam.name);
    });
    if (candidates.length !== 1) {
      throw new Error(
        `Could not uniquely map ${provider.homeTeam.name} vs ${provider.awayTeam.name} (${provider.id}); ` +
        `found ${candidates.length} canonical candidates.`,
      );
    }
    const fixture = candidates[0];
    const kickoffDifference = Math.abs(
      new Date(fixture.kickoff).getTime() - new Date(provider.kickoff).getTime(),
    );
    if (kickoffDifference > 12 * 60 * 60 * 1_000) {
      throw new Error(`Kickoff mismatch exceeds 12 hours for ${provider.id}.`);
    }
    unused.delete(fixture.id);
    return { fixture, provider };
  });
  if (unused.size !== 0) throw new Error(`Unmapped canonical fixtures: ${Array.from(unused).join(', ')}.`);
  return mapped.sort((a, b) => a.fixture.matchNumber - b.fixture.matchNumber);
}

function entityRef(value: unknown, label: string): StatsApiEntityRef | null {
  if (value === null || value === undefined) return null;
  const item = record(value, label);
  return {
    id: nullableString(item.id),
    name: nullableString(item.name),
    slug: nullableString(item.slug),
  };
}

export function validateStatsApiTimeline(value: unknown, expectedMatchId: string): StatsApiTimeline {
  const payload = record(value, 'timeline payload');
  const data = record(payload.data, 'timeline payload.data');
  const meta = record(payload.meta, 'timeline payload.meta');
  const matchId = string(data.match_id, 'timeline payload.data.match_id');
  if (matchId !== expectedMatchId) throw new Error(`Timeline match mismatch: ${matchId}.`);
  if (!Array.isArray(data.events)) throw new Error('timeline payload.data.events must be an array.');
  let previousSequence = 0;
  const events = data.events.map((value, index): StatsApiTimelineEvent => {
    const item = record(value, `timeline event ${index}`);
    const sequence = integer(item.sequence, `timeline event ${index}.sequence`, 1);
    if (sequence <= previousSequence) throw new Error('Timeline sequences must be strictly increasing.');
    previousSequence = sequence;
    const period = string(item.period, `timeline event ${index}.period`) as TimelinePeriod;
    const type = string(item.type, `timeline event ${index}.type`) as TimelineEventType;
    if (!TIMELINE_PERIODS.has(period)) throw new Error(`Unsupported timeline period: ${period}.`);
    if (!TIMELINE_TYPES.has(type)) throw new Error(`Unsupported timeline event type: ${type}.`);
    return {
      sequence,
      minute: integer(item.minute, `timeline event ${index}.minute`),
      extraTime: integer(item.extra_time, `timeline event ${index}.extra_time`),
      period,
      type,
      team: entityRef(item.team, `timeline event ${index}.team`),
      player: entityRef(item.player, `timeline event ${index}.player`),
    };
  });
  const coverage = string(meta.coverage ?? data.coverage, 'timeline coverage');
  if (coverage !== 'full' && coverage !== 'partial' && coverage !== 'none') {
    throw new Error(`Unsupported timeline coverage: ${coverage}.`);
  }
  if (coverage === 'none' && events.length > 0) throw new Error('Timeline with no coverage contains events.');
  return {
    matchId,
    coverage,
    reason: nullableString(meta.reason),
    lastUpdated: nullableString(meta.last_updated),
    events,
  };
}

function lineupPlayer(value: unknown, label: string): StatsApiLineupPlayer {
  const item = record(value, label);
  return {
    id: string(item.id, `${label}.id`),
    name: string(item.name, `${label}.name`),
    position: nullableString(item.position),
    jerseyNumber: nullableInteger(item.jersey_number, `${label}.jersey_number`),
  };
}

function lineupSide(value: unknown, label: string): StatsApiLineupSide {
  const item = record(value, label);
  if (!Array.isArray(item.starting_xi) || !Array.isArray(item.substitutes)) {
    throw new Error(`${label} must contain starting_xi and substitutes arrays.`);
  }
  return {
    id: string(item.id, `${label}.id`),
    name: string(item.name, `${label}.name`),
    formation: nullableString(item.formation),
    startingXi: item.starting_xi.map((player, index) => lineupPlayer(player, `${label}.starting_xi.${index}`)),
    substitutes: item.substitutes.map((player, index) => lineupPlayer(player, `${label}.substitutes.${index}`)),
  };
}

export function validateStatsApiLineup(value: unknown, expectedMatchId: string): StatsApiLineup {
  const payload = record(value, 'lineup payload');
  const data = record(payload.data, 'lineup payload.data');
  const matchId = string(data.match_id, 'lineup payload.data.match_id');
  if (matchId !== expectedMatchId) throw new Error(`Lineup match mismatch: ${matchId}.`);
  if (typeof data.confirmed !== 'boolean') throw new Error('lineup confirmed must be a boolean.');
  return {
    matchId,
    confirmed: data.confirmed,
    home: lineupSide(data.home, 'lineup home'),
    away: lineupSide(data.away, 'lineup away'),
  };
}

export function evaluateLineupQuality(options: {
  lineup: StatsApiLineup;
  kickoff: Date;
  now: Date;
  matchStatus: StatsApiMatchStatus;
}): LineupQuality {
  const { lineup, kickoff, now, matchStatus } = options;
  if (matchStatus === 'scheduled' && now.getTime() < kickoff.getTime() - 2 * 60 * 60 * 1_000) {
    return { accepted: false, reason: 'too-early' };
  }
  if (!lineup.confirmed) return { accepted: false, reason: 'provider-unconfirmed' };
  if (lineup.home.startingXi.length !== 11 || lineup.away.startingXi.length !== 11) {
    return { accepted: false, reason: 'incomplete-starting-xi' };
  }
  if (lineup.home.substitutes.length === 0 || lineup.away.substitutes.length === 0) {
    return { accepted: false, reason: 'missing-bench' };
  }
  for (const side of [lineup.home, lineup.away]) {
    const players = [...side.startingXi, ...side.substitutes];
    if (new Set(players.map((player) => player.id)).size !== players.length) {
      return { accepted: false, reason: 'duplicate-player' };
    }
  }
  return {
    accepted: true,
    reason: matchStatus === 'finished' ? 'finished-complete' : 'official-window-complete',
  };
}

export async function hashNormalizedValue(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function displayScore(score: StatsApiScore): {
  home: number | null;
  away: number | null;
  penaltiesHome: number | null;
  penaltiesAway: number | null;
} {
  const main = score.wentToPenalties
    ? (score.afterExtraTime ?? score.regulation)
    : score.wentToExtraTime
      ? (score.afterExtraTime ?? score.finalScore)
      : (score.regulation ?? score.finalScore);
  return {
    home: main?.home ?? score.home,
    away: main?.away ?? score.away,
    penaltiesHome: score.penaltyShootout?.home ?? null,
    penaltiesAway: score.penaltyShootout?.away ?? null,
  };
}
