import { worldCup2026Fixtures } from '../../src/data/worldCup2026';
import {
  THE_STATS_API_BASE_URL,
  THE_STATS_API_WORLD_CUP_COMPETITION,
  THE_STATS_API_WORLD_CUP_SEASON,
} from '../../src/lib/theStatsApi';

export const SIMULATED_API_KEY = 'simulated-stats-api-key';
export const SIMULATED_MATCH_ID = 'mt_simulated_101';
export const SIMULATED_HOME_TEAM_ID = 'tm_france';
export const SIMULATED_AWAY_TEAM_ID = 'tm_spain';
export const SIMULATED_KICKOFF = '2026-07-14T19:00:00.000Z';

export type StatsApiScenarioStage =
  | 'scheduled'
  | 'lineup-unconfirmed'
  | 'lineup-incomplete-xi'
  | 'lineup-incomplete'
  | 'lineup-duplicate'
  | 'lineup-official'
  | 'live-empty'
  | 'live-goal'
  | 'live-var-correction'
  | 'finished-partial'
  | 'finished-final'
  | 'finished-late-correction';

export type StatsApiSimulatorFault =
  | { kind: 'http'; status: number; payload?: unknown }
  | { kind: 'invalid-json' }
  | { kind: 'oversize' }
  | { kind: 'hang' }
  | { kind: 'payload'; payload: unknown };

export interface StatsApiSimulatorRequest {
  method: string;
  pathname: string;
  search: string;
  authorization: string | null;
  accept: string | null;
  userAgent: string | null;
}

export const statsApiSimulatorPaths = {
  match: `/api/football/matches/${SIMULATED_MATCH_ID}`,
  lineup: `/api/football/matches/${SIMULATED_MATCH_ID}/lineups`,
  liveTimeline: `/api/football/matches/${SIMULATED_MATCH_ID}/live-timeline`,
  finalTimeline: `/api/football/matches/${SIMULATED_MATCH_ID}/timeline`,
} as const;

const primaryFixtureIndex = worldCup2026Fixtures.findIndex((fixture) => fixture.matchNumber === 101);
if (primaryFixtureIndex === -1) throw new Error('World Cup match 101 is missing from the canonical schedule.');

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}

function providerId(index: number): string {
  return index === primaryFixtureIndex
    ? SIMULATED_MATCH_ID
    : `mt_simulated_${String(index + 1).padStart(3, '0')}`;
}

function placeholder(name: string): string {
  return name
    .replace(/^Winner Match (\d+)$/, 'W$1')
    .replace(/^Loser Match (\d+)$/, 'L$1');
}

function scenarioMatchState(stage: StatsApiScenarioStage) {
  if (stage === 'scheduled' || stage.startsWith('lineup-')) {
    return { status: 'scheduled', home: null, away: null } as const;
  }
  if (stage.startsWith('live-')) {
    return { status: 'live', home: 0, away: 0 } as const;
  }
  if (stage === 'finished-partial') {
    return { status: 'finished', home: 0, away: 1 } as const;
  }
  if (stage === 'finished-final') {
    return { status: 'finished', home: 1, away: 1 } as const;
  }
  return { status: 'finished', home: 0, away: 1 } as const;
}

function rawMatch(index: number, stage: StatsApiScenarioStage) {
  const fixture = worldCup2026Fixtures[index];
  const scenario = index === primaryFixtureIndex ? scenarioMatchState(stage) : null;
  const status = scenario?.status ?? fixture.status;
  const home = scenario ? scenario.home : fixture.homeScore;
  const away = scenario ? scenario.away : fixture.awayScore;
  const scorePair = home === null || away === null ? null : { home, away };
  return {
    id: providerId(index),
    competition_id: THE_STATS_API_WORLD_CUP_COMPETITION,
    season_id: THE_STATS_API_WORLD_CUP_SEASON,
    status,
    utc_date: index === primaryFixtureIndex ? SIMULATED_KICKOFF : fixture.kickoff,
    stage_name: fixture.stage === 'group' ? null : fixture.stage.replaceAll('-', '_'),
    home_team: {
      id: index === primaryFixtureIndex ? SIMULATED_HOME_TEAM_ID : `tm_home_${index + 1}`,
      name: placeholder(fixture.homeTeam),
    },
    away_team: {
      id: index === primaryFixtureIndex ? SIMULATED_AWAY_TEAM_ID : `tm_away_${index + 1}`,
      name: placeholder(fixture.awayTeam),
    },
    score: {
      home,
      away,
      final_score: status === 'finished' ? scorePair : null,
      regulation: scorePair,
      after_extra_time: null,
      penalty_shootout: null,
      went_to_extra_time: false,
      went_to_penalties: false,
      winner: status !== 'finished' || home === null || away === null
        ? null
        : home === away ? 'draw' : home > away ? 'home' : 'away',
    },
  };
}

function player(team: 'france' | 'spain', kind: 'starter' | 'substitute', index: number) {
  return {
    id: `pl_${team}_${kind}_${index + 1}`,
    name: `${team === 'france' ? 'France' : 'Spain'} ${kind} ${index + 1}`,
    position: kind === 'starter' ? 'M' : 'F',
    jersey_number: kind === 'starter' ? index + 1 : index + 12,
  };
}

function lineupPayload(stage: StatsApiScenarioStage) {
  const complete = stage !== 'lineup-incomplete';
  const starterCount = stage === 'lineup-incomplete-xi' ? 10 : 11;
  const side = (team: 'france' | 'spain', id: string, name: string) => ({
    id,
    name,
    formation: team === 'france' ? '4-2-3-1' : '4-3-3',
    starting_xi: Array.from({ length: starterCount }, (_, index) => player(team, 'starter', index)),
    substitutes: complete
      ? Array.from({ length: 7 }, (_, index) => player(team, 'substitute', index))
      : [],
  });
  const payload = {
    data: {
      match_id: SIMULATED_MATCH_ID,
      confirmed: stage !== 'lineup-unconfirmed',
      home: side('france', SIMULATED_HOME_TEAM_ID, 'France'),
      away: side('spain', SIMULATED_AWAY_TEAM_ID, 'Spain'),
    },
  };
  if (stage === 'lineup-duplicate') {
    payload.data.home.substitutes[0].id = payload.data.home.starting_xi[0].id;
  }
  return payload;
}

const event = (
  sequence: number,
  minute: number,
  type: string,
  team: 'home' | 'away' | null,
  playerId: string | null = null,
) => ({
  sequence,
  minute,
  extra_time: 0,
  period: 'first_half',
  type,
  team: team === null ? null : {
    id: team === 'home' ? SIMULATED_HOME_TEAM_ID : SIMULATED_AWAY_TEAM_ID,
    name: team === 'home' ? 'France' : 'Spain',
    slug: team === 'home' ? 'france' : 'spain',
  },
  player: playerId ? { id: playerId, name: playerId.replaceAll('_', ' '), slug: playerId } : null,
});

function timelineEvents(stage: StatsApiScenarioStage) {
  const start = event(1, 0, 'period_start', null);
  const awayGoal = event(2, 12, 'goal', 'away', 'pl_spain_goal');
  if (stage === 'scheduled' || stage.startsWith('lineup-') || stage === 'live-empty') return [];
  if (stage === 'live-goal') return [start, awayGoal];
  if (stage === 'live-var-correction') {
    return [start, event(3, 14, 'var', 'away', 'pl_spain_goal')];
  }
  const finalEvents = [
    start,
    awayGoal,
    event(3, 30, 'yellow_card', 'home', 'pl_france_card'),
    event(4, 60, 'substitution', 'away', 'pl_spain_substitute'),
    event(5, 70, 'penalty_awarded', 'home', 'pl_france_penalty'),
    event(6, 71, 'penalty_saved', 'home', 'pl_france_penalty'),
    event(7, 88, 'goal', 'home', 'pl_france_goal'),
    event(8, 89, 'var', 'home', 'pl_france_goal'),
  ];
  return stage === 'finished-late-correction'
    ? finalEvents.filter((item) => item.sequence !== 7)
    : finalEvents;
}

function timelinePayload(stage: StatsApiScenarioStage, final: boolean) {
  const partial = stage === 'finished-partial';
  const empty = stage === 'scheduled' || stage.startsWith('lineup-') || stage === 'live-empty';
  const coverage = partial ? 'partial' : empty ? 'none' : 'full';
  return {
    data: {
      match_id: SIMULATED_MATCH_ID,
      coverage,
      events: timelineEvents(stage),
    },
    meta: {
      coverage,
      total: timelineEvents(stage).length,
      reason: empty ? 'provider-warming-up' : partial ? 'finalizing' : null,
      last_updated: final ? '2026-07-14T21:15:00.000Z' : '2026-07-14T19:15:00.000Z',
    },
  };
}

/** Deterministic HTTP double for TheStatsAPI's World Cup endpoints. */
export class TheStatsApiSimulator {
  stage: StatsApiScenarioStage = 'scheduled';
  readonly requests: StatsApiSimulatorRequest[] = [];
  private readonly faults = new Map<string, StatsApiSimulatorFault[]>();

  setStage(stage: StatsApiScenarioStage): void {
    this.stage = stage;
  }

  queueFault(pathname: string, fault: StatsApiSimulatorFault): void {
    const queue = this.faults.get(pathname) ?? [];
    queue.push(fault);
    this.faults.set(pathname, queue);
  }

  clearRequests(): void {
    this.requests.length = 0;
  }

  readonly fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    this.requests.push({
      method: request.method,
      pathname: url.pathname,
      search: url.search,
      authorization: request.headers.get('authorization'),
      accept: request.headers.get('accept'),
      userAgent: request.headers.get('user-agent'),
    });

    if (url.origin !== new URL(THE_STATS_API_BASE_URL).origin
      || !url.pathname.startsWith('/api/')) {
      return json({ error: 'unexpected provider origin' }, 404);
    }
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
    if (request.headers.get('authorization') !== `Bearer ${SIMULATED_API_KEY}`) {
      return json({ error: 'unauthorized' }, 401);
    }

    const queued = this.faults.get(url.pathname);
    const fault = queued?.shift();
    if (queued?.length === 0) this.faults.delete(url.pathname);
    if (fault?.kind === 'http') return json(fault.payload ?? { error: `HTTP ${fault.status}` }, fault.status);
    if (fault?.kind === 'invalid-json') {
      return new Response('{invalid-json', { headers: { 'content-type': 'application/json' } });
    }
    if (fault?.kind === 'oversize') {
      return new Response('{}', { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } });
    }
    if (fault?.kind === 'payload') return json(fault.payload);
    if (fault?.kind === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(request.signal.reason ?? new DOMException('Aborted', 'AbortError'));
        if (request.signal.aborted) abort();
        else request.signal.addEventListener('abort', abort, { once: true });
      });
    }

    if (url.pathname === '/api/football/matches') {
      if (url.searchParams.get('competition_id') !== THE_STATS_API_WORLD_CUP_COMPETITION
        || url.searchParams.get('season_id') !== THE_STATS_API_WORLD_CUP_SEASON
        || url.searchParams.get('per_page') !== '100') {
        return json({ error: 'unexpected World Cup query' }, 400);
      }
      const page = Number(url.searchParams.get('page'));
      const start = page === 1 ? 0 : page === 2 ? 100 : -1;
      if (start < 0) return json({ error: 'page not found' }, 404);
      return json({
        data: worldCup2026Fixtures.slice(start, start + 100)
          .map((_fixture, offset) => rawMatch(start + offset, this.stage)),
        meta: { page, total: 104, total_pages: 2 },
      });
    }

    if (url.pathname === statsApiSimulatorPaths.match) {
      return json({ data: rawMatch(primaryFixtureIndex, this.stage) });
    }
    if (url.pathname === statsApiSimulatorPaths.lineup) {
      if (this.stage === 'scheduled') return json({ error: 'lineup not released' }, 404);
      return json(lineupPayload(this.stage));
    }
    if (url.pathname === statsApiSimulatorPaths.liveTimeline) {
      return json(timelinePayload(this.stage, false));
    }
    if (url.pathname === statsApiSimulatorPaths.finalTimeline) {
      return json(timelinePayload(this.stage, true));
    }
    return json({ error: 'provider route not found' }, 404);
  }) as typeof fetch;
}
