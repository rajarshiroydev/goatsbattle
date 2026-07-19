import {
  THE_STATS_API_BASE_URL,
  THE_STATS_API_WORLD_CUP_COMPETITION,
  THE_STATS_API_WORLD_CUP_SEASON,
  mapStatsApiMatch,
  validateStatsApiLineup,
  validateStatsApiMatchesPage,
  validateStatsApiTimeline,
  type StatsApiLineup,
  type StatsApiMatch,
  type StatsApiTimeline,
} from './theStatsApi';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class StatsApiHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'StatsApiHttpError';
  }
}

export interface StatsApiClientOptions {
  apiKey: string;
  fetcher?: typeof fetch;
  reserveRequest?: (path: string) => Promise<void>;
  requestTimeoutMs?: number;
}

async function boundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel('declared length exceeds limit');
    throw new Error(`TheStatsAPI response exceeds ${MAX_RESPONSE_BYTES} bytes.`);
  }
  if (!response.body) throw new Error('TheStatsAPI response has no body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel('response too large');
      throw new Error(`TheStatsAPI response exceeds ${MAX_RESPONSE_BYTES} bytes.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function requestJson(path: string, options: StatsApiClientOptions): Promise<unknown> {
  if (!options.apiKey) throw new Error('THESTATSAPI_API_KEY is not configured.');
  await options.reserveRequest?.(path);
  const response = await (options.fetcher ?? fetch)(`${THE_STATS_API_BASE_URL}${path}`, {
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      accept: 'application/json',
      'user-agent': 'GOATSBattle/1.0',
    },
    signal: AbortSignal.timeout(options.requestTimeoutMs ?? 10_000),
  });
  const payload = await boundedJson(response).catch((error) => {
    if (!response.ok) return null;
    throw error;
  });
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? JSON.stringify(payload).slice(0, 500)
      : 'no JSON error body';
    throw new StatsApiHttpError(response.status, path, `TheStatsAPI HTTP ${response.status}: ${detail}`);
  }
  return payload;
}

export async function fetchStatsApiWorldCupMatches(
  options: StatsApiClientOptions,
): Promise<StatsApiMatch[]> {
  const base = `/football/matches?competition_id=${THE_STATS_API_WORLD_CUP_COMPETITION}` +
    `&season_id=${THE_STATS_API_WORLD_CUP_SEASON}&per_page=100`;
  const first = validateStatsApiMatchesPage(await requestJson(`${base}&page=1`, options));
  if (first.total !== 104 || first.totalPages !== 2) {
    throw new Error(`Expected a 104-match, two-page World Cup response; received ${first.total} matches across ${first.totalPages} pages.`);
  }
  const second = validateStatsApiMatchesPage(await requestJson(`${base}&page=2`, options));
  const matches = [...first.matches, ...second.matches];
  if (matches.length !== 104 || new Set(matches.map((match) => match.id)).size !== 104) {
    throw new Error(`Expected 104 unique TheStatsAPI World Cup matches; received ${matches.length}.`);
  }
  return matches;
}

export async function fetchStatsApiMatch(
  matchId: string,
  options: StatsApiClientOptions,
): Promise<StatsApiMatch> {
  const payload = await requestJson(`/football/matches/${encodeURIComponent(matchId)}`, options);
  const item = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).data
    : null;
  const match = mapStatsApiMatch(item);
  if (match.id !== matchId) throw new Error(`TheStatsAPI match mismatch: ${match.id}.`);
  return match;
}

export async function fetchStatsApiTimeline(
  matchId: string,
  live: boolean,
  options: StatsApiClientOptions,
): Promise<StatsApiTimeline> {
  const suffix = live ? 'live-timeline' : 'timeline';
  const payload = await requestJson(
    `/football/matches/${encodeURIComponent(matchId)}/${suffix}`,
    options,
  );
  return validateStatsApiTimeline(payload, matchId);
}

export async function fetchStatsApiLineup(
  matchId: string,
  options: StatsApiClientOptions,
): Promise<StatsApiLineup> {
  const payload = await requestJson(
    `/football/matches/${encodeURIComponent(matchId)}/lineups`,
    options,
  );
  return validateStatsApiLineup(payload, matchId);
}
