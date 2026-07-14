export const WORLD_CUP_PROVIDER = 'worldcup26-community' as const;

export type WorldCupStage =
  | 'group'
  | 'round-of-32'
  | 'round-of-16'
  | 'quarterfinal'
  | 'semifinal'
  | 'third-place'
  | 'final';

export type WorldCupMatchStatus = 'scheduled' | 'live' | 'finished';

export interface WorldCupCommunityMatch {
  provider: typeof WORLD_CUP_PROVIDER;
  providerFixtureId: string;
  matchNumber: number;
  stage: WorldCupStage;
  status: WorldCupMatchStatus;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  homeScore: number | null;
  awayScore: number | null;
}

const STAGE_COUNTS: Readonly<Record<WorldCupStage, number>> = {
  group: 72,
  'round-of-32': 16,
  'round-of-16': 8,
  quarterfinal: 4,
  semifinal: 2,
  'third-place': 1,
  final: 1,
};

const PROVIDER_STAGE: Readonly<Record<string, WorldCupStage>> = {
  group: 'group',
  r32: 'round-of-32',
  r16: 'round-of-16',
  qf: 'quarterfinal',
  sf: 'semifinal',
  third: 'third-place',
  final: 'final',
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function integerString(value: unknown, label: string): number {
  const raw = requiredString(value, label);
  if (!/^\d+$/.test(raw)) throw new Error(`${label} must be an unsigned integer string.`);
  return Number(raw);
}

function nullableProviderString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === 'null' || normalized === '0') return null;
  return normalized;
}

function teamIdentity(value: unknown): string | null {
  const id = nullableProviderString(value);
  return id && /^\d+$/.test(id) ? id : null;
}

function score(value: unknown, label: string): number {
  const parsed = integerString(value, label);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is outside the safe integer range.`);
  return parsed;
}

function expectedStage(matchNumber: number): WorldCupStage {
  if (matchNumber <= 72) return 'group';
  if (matchNumber <= 88) return 'round-of-32';
  if (matchNumber <= 96) return 'round-of-16';
  if (matchNumber <= 100) return 'quarterfinal';
  if (matchNumber <= 102) return 'semifinal';
  if (matchNumber === 103) return 'third-place';
  return 'final';
}

function normalizeStatus(game: Record<string, unknown>): WorldCupMatchStatus {
  const finished = String(game.finished ?? '').trim().toLowerCase();
  const elapsed = String(game.time_elapsed ?? '').trim().toLowerCase();

  if (finished === 'true' || elapsed === 'finished') return 'finished';
  if (finished !== 'false') throw new Error(`Unsupported finished value: ${String(game.finished)}.`);
  if (elapsed === 'notstarted') return 'scheduled';
  if (elapsed && elapsed !== 'null') return 'live';
  throw new Error(`Unsupported time_elapsed value: ${String(game.time_elapsed)}.`);
}

/**
 * Maps only provider-owned score/status/team identity. Canonical kickoff, venue,
 * bracket labels, events, lineups, and GOAT linkage must come from other data.
 */
export function mapWorldCupCommunityGame(value: unknown): WorldCupCommunityMatch {
  const game = asRecord(value, 'Community match');
  const matchNumber = integerString(game.id, 'id');
  if (matchNumber < 1 || matchNumber > 104) throw new Error(`Match id ${matchNumber} is outside 1-104.`);

  const rawStage = requiredString(game.type, 'type').toLowerCase();
  const stage = PROVIDER_STAGE[rawStage];
  if (!stage) throw new Error(`Unsupported World Cup stage: ${rawStage}.`);
  const canonicalStage = expectedStage(matchNumber);
  if (stage !== canonicalStage) {
    throw new Error(`Match ${matchNumber} stage mismatch: expected ${canonicalStage}, received ${stage}.`);
  }

  const status = normalizeStatus(game);
  const homeTeamId = teamIdentity(game.home_team_id);
  const awayTeamId = teamIdentity(game.away_team_id);
  const homeTeam = homeTeamId ? nullableProviderString(game.home_team_name_en) : null;
  const awayTeam = awayTeamId ? nullableProviderString(game.away_team_name_en) : null;

  return {
    provider: WORLD_CUP_PROVIDER,
    providerFixtureId: `${WORLD_CUP_PROVIDER}:${matchNumber}`,
    matchNumber,
    stage,
    status,
    homeTeamId,
    awayTeamId,
    homeTeam,
    awayTeam,
    homeScore: status === 'scheduled' ? null : score(game.home_score, 'home_score'),
    awayScore: status === 'scheduled' ? null : score(game.away_score, 'away_score'),
  };
}

/** Fail-closed validation for the all-matches response before any DB write. */
export function validateWorldCupCommunityPayload(value: unknown): WorldCupCommunityMatch[] {
  const payload = asRecord(value, 'Community payload');
  if (!Array.isArray(payload.games)) throw new Error('Community payload games must be an array.');
  if (payload.games.length !== 104) {
    throw new Error(`Expected 104 community matches; received ${payload.games.length}.`);
  }

  const games = payload.games.map(mapWorldCupCommunityGame);
  const ids = new Set(games.map((game) => game.matchNumber));
  if (ids.size !== 104 || Array.from({ length: 104 }, (_, i) => i + 1).some((id) => !ids.has(id))) {
    throw new Error('Community match ids must contain each integer from 1 through 104 exactly once.');
  }

  for (const [stage, expected] of Object.entries(STAGE_COUNTS) as Array<[WorldCupStage, number]>) {
    const actual = games.filter((game) => game.stage === stage).length;
    if (actual !== expected) throw new Error(`${stage} count mismatch: expected ${expected}, received ${actual}.`);
  }
  return games.sort((a, b) => a.matchNumber - b.matchNumber);
}
