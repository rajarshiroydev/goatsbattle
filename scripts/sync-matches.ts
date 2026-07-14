/**
 * Syncs real football matches into The Floor from API-Football (v3).
 *
 * The free tier is 100 requests/day and only covers seasons 2022–2024, so this
 * backfills a *curated* set of World Cup 2022 knockout matches — the ones our
 * tracked goats played in — rather than the whole tournament. One /fixtures call
 * + one /fixtures/events call per selected match (≈6 calls total). Idempotent:
 * re-running upserts each match and replaces its moments + goat links.
 *
 * WC 2026 is intentionally NOT used — it 403s on the free plan (see the season
 * check in the plan). Swap SEASON/LEAGUE + FIXTURE_IDS here to target other
 * accessible data. Tracked in DEMO_DATA.md.
 *
 * Run with:  npm run db:sync:matches
 */
import { eq } from 'drizzle-orm';
import { db } from './lib/node-db';
import { matches, matchMoments, matchGoats } from '../src/lib/db/schema';
import { getFixtures, getFixtureEvents, type ApiFixture, type ApiEvent } from '../src/lib/apiFootball';
import { exitOnDatabaseError, runDatabaseOperation } from './lib/database-safety';

const LEAGUE = 1; // FIFA World Cup
const SEASON = 2022; // Qatar (accessible on the free plan)

// Curated knockout matches, one per tracked goat (+ the final). Keeps the run
// small and guarantees every active goat has a real match to discuss.
const FIXTURE_IDS = [
  979139, // Final — Argentina 3-3 France (pens) — Messi + Mbappé
  977794, // QF — Netherlands 2-2 Argentina (pens) — Messi
  978279, // SF — Argentina 3-0 Croatia — Messi
  977706, // R16 — Portugal 6-1 Switzerland — Ronaldo
  977705, // R16 — Brazil 4-1 South Korea — Neymar
];

/** National team name → the tracked goat who anchors it (drives match_goats). */
const TEAM_GOAT: Record<string, string> = {
  Argentina: 'messi',
  France: 'mbappe',
  Portugal: 'ronaldo',
  Brazil: 'neymar',
};

/** Player-name (accent-insensitive substring) → goat slug, for moment linking. */
const PLAYER_GOAT: Array<[string, string]> = [
  ['messi', 'messi'],
  ['mbappe', 'mbappe'],
  ['ronaldo', 'ronaldo'],
  ['neymar', 'neymar'],
];

/** Country name → ISO alpha-2 (for flags). Covers the teams in scope. */
const COUNTRY_CODE: Record<string, string> = {
  Argentina: 'AR', France: 'FR', Netherlands: 'NL', Croatia: 'HR',
  Portugal: 'PT', Switzerland: 'CH', Brazil: 'BR', 'South Korea': 'KR',
  Morocco: 'MA', England: 'GB', Poland: 'PL', Australia: 'AU', Spain: 'ES',
  Japan: 'JP', 'United States': 'US', Senegal: 'SN', Germany: 'DE',
};

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const slugify = (s: string) =>
  norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function goatForPlayer(name: string | null): string | null {
  if (!name) return null;
  const n = norm(name);
  for (const [needle, slug] of PLAYER_GOAT) if (n.includes(needle)) return slug;
  return null;
}

/** Map an API event to our moment {type, detail}, or null to skip (e.g. subs). */
function mapMoment(ev: ApiEvent): { type: string; detail: string | null } | null {
  const t = ev.type.toLowerCase();
  const d = ev.detail.toLowerCase();
  let type: string | null = null;
  if (t === 'goal') {
    if (d.includes('own goal')) type = 'own_goal';
    else if (d.includes('missed penalty')) type = 'penalty_missed';
    else if (d.includes('penalty')) type = 'penalty';
    else type = 'goal';
  } else if (t === 'card') {
    type = d.includes('red') || d.includes('second yellow') ? 'red_card' : 'yellow_card';
  } else if (t === 'var') {
    type = 'var';
  } else {
    return null; // subs and anything else are timeline noise
  }
  // A readable detail: drop the boring "Normal Goal", fold in the API comment.
  const rawDetail = ev.detail === 'Normal Goal' ? null : ev.detail;
  const parts = [rawDetail, ev.comments].filter(
    (p, i, a): p is string => !!p && a.indexOf(p) === i,
  );
  return { type, detail: parts.length ? parts.join(' · ') : null };
}

function mapStatus(short: string): string {
  if (['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE'].includes(short)) return 'live';
  if (['NS', 'TBD', 'PST'].includes(short)) return 'scheduled';
  return 'finished'; // FT, AET, PEN, ...
}

async function syncFixture(fx: ApiFixture) {
  const date = fx.fixture.date.slice(0, 10);
  const id = `${slugify(fx.teams.home.name)}-vs-${slugify(fx.teams.away.name)}-${date}`;
  const venue = [fx.fixture.venue.name, fx.fixture.venue.city].filter(Boolean).join(', ') || null;

  const matchRow = {
    id,
    externalId: String(fx.fixture.id),
    arena: 'football',
    competition: `${fx.league.name} ${fx.league.season}`,
    homeTeam: fx.teams.home.name,
    awayTeam: fx.teams.away.name,
    homeCode: COUNTRY_CODE[fx.teams.home.name] ?? null,
    awayCode: COUNTRY_CODE[fx.teams.away.name] ?? null,
    homeScore: fx.goals.home,
    awayScore: fx.goals.away,
    kickoff: new Date(fx.fixture.date),
    status: mapStatus(fx.fixture.status.short),
    venue,
  };

  await db.insert(matches).values(matchRow).onConflictDoUpdate({
    target: matches.id,
    set: { ...matchRow, id: undefined },
  });

  // ── Moments ──────────────────────────────────────────────────────────────
  // Skip re-syncing moments for a match that already has them: deleting rows
  // would fire `comments.moment_id ON DELETE SET NULL` and silently erase users'
  // moment tags (and burns an API call). Historical results don't change, so
  // first-sync-wins is safe; a future re-import would need identity-based
  // reconciliation (and neon-http has no interactive transactions to wrap it).
  const already = await db
    .select({ id: matchMoments.id })
    .from(matchMoments)
    .where(eq(matchMoments.matchId, id))
    .limit(1);
  if (already.length > 0) {
    await syncGoats(fx, id);
    console.log(`  ✓ ${id} — kept existing moments (already synced)`);
    return id;
  }

  const events = await getFixtureEvents(fx.fixture.id);
  const moments = events
    .map((ev) => {
      // Skip individual shootout kicks — we synthesize one summary moment below.
      if (ev.comments?.toLowerCase().includes('shootout')) return null;
      const mapped = mapMoment(ev);
      if (!mapped || ev.time.elapsed === null) return null;
      return {
        matchId: id,
        minute: Math.max(0, ev.time.elapsed),
        extra: ev.time.extra ?? null,
        type: mapped.type,
        team: ev.team.id === fx.teams.home.id ? 'home' : 'away',
        playerName: ev.player.name ?? null,
        goatSlug: goatForPlayer(ev.player.name),
        detail: mapped.detail,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  // Synthesize a shootout moment so the final's 4-2 pens aren't lost (the score
  // columns only hold the 3-3 after extra time).
  const pen = fx.score.penalty;
  if (pen.home !== null && pen.away !== null) {
    moments.push({
      matchId: id,
      minute: 120,
      extra: null,
      type: 'shootout',
      team: pen.home > pen.away ? 'home' : 'away',
      playerName: null,
      goatSlug: null,
      detail: `Shootout: ${fx.teams.home.name} ${pen.home}–${pen.away} ${fx.teams.away.name}`,
    });
  }

  if (moments.length) await db.insert(matchMoments).values(moments);

  const goatCount = await syncGoats(fx, id);
  console.log(`  ✓ ${id} — ${moments.length} moments, ${goatCount} goats`);
  return id;
}

/** Replace a match's goat links (no dependent rows, so delete+reinsert is safe). */
async function syncGoats(fx: ApiFixture, id: string): Promise<number> {
  const goats: Array<{ matchId: string; goatSlug: string; team: string }> = [];
  for (const side of ['home', 'away'] as const) {
    const slug = TEAM_GOAT[fx.teams[side].name];
    if (slug) goats.push({ matchId: id, goatSlug: slug, team: side });
  }
  await db.delete(matchGoats).where(eq(matchGoats.matchId, id));
  if (goats.length) await db.insert(matchGoats).values(goats);
  return goats.length;
}

async function main() {
  console.log(`→ Fetching World Cup ${SEASON} fixtures…`);
  const all = await getFixtures(LEAGUE, SEASON);
  const byId = new Map(all.map((f) => [f.fixture.id, f]));

  // Fail fast before any writes if the curated set is incomplete — better than
  // silently landing partial match/goat coverage.
  const missing = FIXTURE_IDS.filter((fid) => !byId.has(fid));
  if (missing.length > 0) {
    throw new Error(`Fixtures not found in season ${SEASON}: ${missing.join(', ')}. Aborting without writes.`);
  }

  console.log(`→ Syncing ${FIXTURE_IDS.length} curated matches…`);
  const done: string[] = [];
  for (const fid of FIXTURE_IDS) {
    done.push(await syncFixture(byId.get(fid)!));
  }

  console.log(`\n✓ Done. Synced ${done.length} real matches from API-Football.`);
}

runDatabaseOperation({
  operation: 'legacy API-Football demo match import',
  allowedTargets: ['development'],
}, main).catch(exitOnDatabaseError);
