/**
 * Seeds The Floor with a small set of football match events (GBT-7 foundation).
 * Idempotent: re-running upserts each match and replaces its moments + goat
 * links. Run with:  npm run db:seed:matches
 *
 * ── Why hand-seeded (and not fetched live yet) ───────────────────────────────
 * We use API-Football's *free* tier (100 requests/day), so live sync is a later
 * phase. Just as important, the free feed can't supply the richest moments this
 * feature is built around. What the endpoints actually return:
 *   GET /fixtures            → match list, score, status, venue, competition
 *   GET /fixtures/events     → ONLY Goal / Card / Subst / VAR (minute+player+team)
 *   GET /fixtures/statistics → AGGREGATE team stats (fouls, possession) — NOT per-minute
 *   GET /fixtures/lineups, GET /players
 * So per-minute fouls / handballs (e.g. the Argentina–Egypt disallowed-goal
 * build-up) are NOT in the standard feed — they're hand-authored below to show
 * the timeline's intent. Live sync will only auto-populate goals/cards/subs/VAR.
 *
 * NOTE: tracked in DEMO_DATA.md — replace this seed with real sync before prod.
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { matches, matchMoments, matchGoats } from '../src/lib/db/schema';

type MomentSeed = {
  minute: number;
  extra?: number;
  type: string; // goal|penalty|own_goal|yellow_card|red_card|foul|handball|sub|var
  team: 'home' | 'away';
  playerName?: string;
  goatSlug?: string;
  detail?: string;
};

type GoatSeed = { slug: string; team: 'home' | 'away' };

type MatchSeed = {
  id: string;
  externalId?: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  homeCode: string;
  awayCode: string;
  homeScore: number | null;
  awayScore: number | null;
  kickoff: string; // ISO
  status: 'scheduled' | 'live' | 'finished';
  venue?: string;
  goats: GoatSeed[];
  moments: MomentSeed[];
};

const MATCHES: MatchSeed[] = [
  {
    id: 'argentina-vs-egypt-2026-06-15',
    competition: 'International Friendly',
    homeTeam: 'Argentina',
    awayTeam: 'Egypt',
    homeCode: 'AR',
    awayCode: 'EG',
    homeScore: 2,
    awayScore: 1,
    kickoff: '2026-06-15T19:00:00Z',
    status: 'finished',
    venue: 'Estadio Monumental, Buenos Aires',
    goats: [{ slug: 'messi', team: 'home' }],
    moments: [
      { minute: 12, type: 'goal', team: 'home', playerName: 'Lionel Messi', goatSlug: 'messi', detail: 'Curled free-kick into the top corner' },
      { minute: 34, type: 'yellow_card', team: 'away', playerName: 'M. Elneny', detail: 'Late challenge on Mac Allister' },
      { minute: 45, extra: 2, type: 'foul', team: 'away', playerName: 'A. Hegazi', detail: 'Cynical trip to stop a counter-attack' },
      { minute: 52, type: 'goal', team: 'away', playerName: 'Mostafa Mohamed', detail: 'Egypt level from a corner' },
      { minute: 63, type: 'handball', team: 'away', playerName: 'O. Marmoush', detail: 'Ball strikes the arm in the build-up — flagged to VAR' },
      { minute: 64, type: 'var', team: 'away', detail: "Egypt's second goal DISALLOWED — foul on the Argentine defender in the build-up. The controversial call of the night." },
      { minute: 78, type: 'penalty', team: 'home', playerName: 'Lionel Messi', goatSlug: 'messi', detail: 'Messi sends the keeper the wrong way' },
      { minute: 90, extra: 3, type: 'red_card', team: 'away', playerName: 'A. Fatouh', detail: 'Second yellow for dissent' },
    ],
  },
  {
    id: 'argentina-vs-france-2026-07-19',
    externalId: undefined,
    competition: 'FIFA World Cup 2026',
    homeTeam: 'Argentina',
    awayTeam: 'France',
    homeCode: 'AR',
    awayCode: 'FR',
    homeScore: 3,
    awayScore: 3,
    kickoff: '2026-07-19T19:00:00Z',
    status: 'finished',
    venue: 'MetLife Stadium, New Jersey',
    goats: [
      { slug: 'messi', team: 'home' },
      { slug: 'mbappe', team: 'away' },
    ],
    moments: [
      { minute: 23, type: 'penalty', team: 'home', playerName: 'Lionel Messi', goatSlug: 'messi', detail: 'Opening goal from the spot' },
      { minute: 36, type: 'goal', team: 'home', playerName: 'Á. Di María', detail: 'Sweeping counter finished coolly' },
      { minute: 80, type: 'goal', team: 'away', playerName: 'Kylian Mbappé', goatSlug: 'mbappe', detail: 'Penalty won and converted' },
      { minute: 81, type: 'goal', team: 'away', playerName: 'Kylian Mbappé', goatSlug: 'mbappe', detail: '97 seconds later — volley to level it' },
      { minute: 108, type: 'goal', team: 'home', playerName: 'Lionel Messi', goatSlug: 'messi', detail: 'Extra-time strike' },
      { minute: 118, type: 'goal', team: 'away', playerName: 'Kylian Mbappé', goatSlug: 'mbappe', detail: 'Hat-trick penalty — 3-3' },
    ],
  },
  {
    id: 'brazil-vs-argentina-2026-06-28',
    competition: 'FIFA World Cup 2026',
    homeTeam: 'Brazil',
    awayTeam: 'Argentina',
    homeCode: 'BR',
    awayCode: 'AR',
    homeScore: 1,
    awayScore: 2,
    kickoff: '2026-06-28T22:00:00Z',
    status: 'finished',
    venue: 'AT&T Stadium, Dallas',
    goats: [
      { slug: 'neymar', team: 'home' },
      { slug: 'messi', team: 'away' },
    ],
    moments: [
      { minute: 18, type: 'goal', team: 'home', playerName: 'Neymar Jr.', goatSlug: 'neymar', detail: 'Trademark solo dribble and finish' },
      { minute: 55, type: 'goal', team: 'away', playerName: 'Lionel Messi', goatSlug: 'messi', detail: 'Left-foot curler' },
      { minute: 70, type: 'yellow_card', team: 'home', playerName: 'Casemiro' },
      { minute: 88, type: 'goal', team: 'away', playerName: 'J. Álvarez', detail: 'Late winner off a Messi assist' },
    ],
  },
  {
    id: 'france-vs-portugal-2026-07-05',
    competition: 'FIFA World Cup 2026',
    homeTeam: 'France',
    awayTeam: 'Portugal',
    homeCode: 'FR',
    awayCode: 'PT',
    homeScore: 2,
    awayScore: 2,
    kickoff: '2026-07-05T19:00:00Z',
    status: 'finished',
    venue: 'SoFi Stadium, Los Angeles',
    goats: [
      { slug: 'mbappe', team: 'home' },
      { slug: 'ronaldo', team: 'away' },
    ],
    moments: [
      { minute: 9, type: 'goal', team: 'home', playerName: 'Kylian Mbappé', goatSlug: 'mbappe', detail: 'Blistering counter finished near post' },
      { minute: 44, type: 'penalty', team: 'away', playerName: 'Cristiano Ronaldo', goatSlug: 'ronaldo', detail: 'Ronaldo levels from the spot' },
      { minute: 61, type: 'goal', team: 'away', playerName: 'Cristiano Ronaldo', goatSlug: 'ronaldo', detail: 'Towering header' },
      { minute: 90, type: 'goal', team: 'home', playerName: 'Kylian Mbappé', goatSlug: 'mbappe', detail: 'Stoppage-time equaliser' },
    ],
  },
  {
    id: 'argentina-vs-spain-2026-07-11',
    competition: 'FIFA World Cup 2026',
    homeTeam: 'Argentina',
    awayTeam: 'Spain',
    homeCode: 'AR',
    awayCode: 'ES',
    homeScore: 1,
    awayScore: 1,
    kickoff: '2026-07-11T19:00:00Z',
    status: 'live',
    venue: 'Rose Bowl, Pasadena',
    goats: [{ slug: 'messi', team: 'home' }],
    moments: [
      { minute: 27, type: 'goal', team: 'home', playerName: 'Lionel Messi', goatSlug: 'messi', detail: 'Opened the scoring early' },
      { minute: 41, type: 'yellow_card', team: 'away', playerName: 'Rodri' },
      { minute: 58, type: 'goal', team: 'away', playerName: 'Lamine Yamal', detail: 'Spain hit back' },
    ],
  },
];

async function main() {
  console.log('→ Seeding match events…');
  for (const m of MATCHES) {
    await db
      .insert(matches)
      .values({
        id: m.id,
        externalId: m.externalId ?? null,
        competition: m.competition,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        homeCode: m.homeCode,
        awayCode: m.awayCode,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        kickoff: new Date(m.kickoff),
        status: m.status,
        venue: m.venue ?? null,
      })
      .onConflictDoUpdate({
        target: matches.id,
        set: {
          competition: m.competition,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          homeCode: m.homeCode,
          awayCode: m.awayCode,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          kickoff: new Date(m.kickoff),
          status: m.status,
          venue: m.venue ?? null,
        },
      });

    // Replace moments + goat links so re-runs stay clean.
    await db.delete(matchMoments).where(eq(matchMoments.matchId, m.id));
    if (m.moments.length > 0) {
      await db.insert(matchMoments).values(
        m.moments.map((x) => ({
          matchId: m.id,
          minute: x.minute,
          extra: x.extra ?? null,
          type: x.type,
          team: x.team,
          playerName: x.playerName ?? null,
          goatSlug: x.goatSlug ?? null,
          detail: x.detail ?? null,
        })),
      );
    }

    await db.delete(matchGoats).where(eq(matchGoats.matchId, m.id));
    if (m.goats.length > 0) {
      await db
        .insert(matchGoats)
        .values(m.goats.map((g) => ({ matchId: m.id, goatSlug: g.slug, team: g.team })));
    }

    console.log(`  ✓ ${m.id} (${m.moments.length} moments, ${m.goats.length} goats)`);
  }

  console.log(`\n✓ Done. ${MATCHES.length} matches seeded.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
