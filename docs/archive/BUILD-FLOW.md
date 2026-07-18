# GOATSBattle — Build Flow & Feature Map

> **Historical snapshot — archived 2026-07-18.** This launch-branch plan preserves the state and
> assumptions recorded before production; it is not a current build, release, or operations guide.
> Consult [AGENTS.md](../../AGENTS.md), [STACK.md](../../STACK.md), and
> [docs/RELEASES.md](../RELEASES.md) for current guidance.

> Purpose: a single, uniform view of how the product got here and what's still uncommitted, so the
> World Cup launch branch can be sliced into sensible commits/PRs. Every step below uses the same
> shape — **Direction** (why, tied to [product direction](../../GOATSBattle_Product_Direction.md)),
> **Changes** (what), **Surfaces** (key files/routes). PRs on `main` were uneven (some huge, some
> one-liners); here they're normalized to one coherent deliverable per step.

- **`main`**: 10 merged PRs (Jul 1 → Jul 12). Shipped and stable.
- **`feature/gbt-10-world-cup-launch`** (current): **nothing committed yet** — 52 modified files + 68
  new files implementing the entire World Cup launch epic **GBT-10** (tickets GBT-11 → GBT-20).
- Legend: ✅ merged · 🟡 in working tree (uncommitted) · ⛔ not started.

---

## Part A — Shipped history on `main` (✅)

Normalized into 11 thematic steps. Dates are commit dates.

### A1 · Multi-arena foundation + Champion Mode — Jul 1
- **Direction:** Establish the wedge (GOAT debates) on a platform that isn't a single-sport toy —
  §3 "start with football", §9 "curated pool per arena".
- **Changes:** Initial Elo ranking + Champion Mode; expanded from one list into a multi-arena
  platform (football / cricket / tennis / F1) with per-arena curated pools.
- **Surfaces:** `src/data/*`, arenas registry, Champion Mode.

### A2 · Scoring overhaul + domain naming — Jul 6–7
- **Direction:** §10 "living opinion graph" — a single honest metric beats an opaque Elo number;
  lock canonical vocabulary early.
- **Changes:** Removed Elo entirely → **Votes** as the only ranking metric. Renamed
  `category` → **arena**, `player/<slug>` → **/goats/<slug>**. Added dedicated 1v1 battle page,
  `/faceoff` builder, Rankings nav.
- **Surfaces:** `/goats`, `/battle/[slug]`, `/faceoff`, `/rankings/[arena]`, `/arenas`.

### A3 · UI / nav cleanup + tooling — Jul 7–9
- **Direction:** §14 "web first" — discoverable, low-friction, consistent.
- **Changes:** Navbar/width/navigation fixes, removed "category" copy, Astro MCP configured,
  win/loss visuals on GOAT profiles.
- **Surfaces:** nav, profile pages.

### A4 · Social layer: accounts + threaded comments — Jul 8–9 · PR #1–#2
- **Direction:** §7 identity, §13 launch scope "threaded comments", "login only when a user acts".
- **Changes:** better-auth (Google OAuth) accounts, threaded comments, **login-gated voting**.
- **Surfaces:** `src/lib/auth.ts`, `AuthModal`, `AccountMenu`, `CommentThread`, `/users/[username]`.

### A5 · Vote/auth hardening + perf — Jul 9 · PR #3
- **Direction:** integrity + perceived speed before scale.
- **Changes:** Short-circuit vote rate-limit checks, namespaced per-user rank-vote keys, fixed
  vote-button lag and the false "log in" flash for logged-in users, Champion Mode CTA loading states.
- **Surfaces:** vote path, `useSession`, ChampionMode.

### A6 · Screenshot tooling + conventions — Jul 9 · PR #4–#5
- **Direction:** repeatable QA; shared cross-agent conventions (Claude + Codex).
- **Changes:** `npm run shot` Playwright tooling, typecheck hook fix, expanded `AGENTS.md`.
- **Surfaces:** `scripts/shot.mjs`, `AGENTS.md`.

### A7 · Stadium Gate redesign — Jul 10 · PR #6–#7
- **Direction:** a distinctive, consistent design system (see `product_design/DESIGN-GUIDE.md`).
- **Changes:** Full redesign to **Stadium Gate**: design-system primitives in `global.css`, 1120px
  `.page-container` standard, shared heroes, Champion Mode setup/results polish.
- **Surfaces:** `src/styles/global.css`, all top-level pages.

### A8 · GBT-6 UI fixes — Jul 11 · PR #7
- **Direction:** §15.4 "feel useful before a large community" — richer landing.
- **Changes:** Hero carousel, marquee between hero and floor, GOATs cards; fixed horizontal
  scrollbar from off-screen carousel cards.
- **Surfaces:** `index.astro`, `MarqueeCarousel`, GOATs cards. — **[GBT-6 ✅]**

### A9 · GBT-7 The Floor foundation — Jul 11 · PR #8
- **Direction:** §5–§6 — discussion attached to real match objects, not a generic feed.
- **Changes:** Reframed The Floor to football **match events** — DB-backed matches/moments, comments
  became **battle-XOR-match** scoped, event page + timeline + fan tags.
- **Surfaces:** `floor.astro`, `floor/[match].astro`, `commentService`, schema matches/moments.
  — **[GBT-7 ✅ foundation]**

### A10 · GBT-7 cont.: live-sync scaffold + tagging — Jul 11 · PR #9
- **Direction:** §5 enrich conversation with event context; §15.2 event-driven model.
- **Changes:** API-Football live-sync scaffolding, **interactive moment tagging** in the composer,
  **GOAT stat tagging** in discussions.
- **Surfaces:** `CommentThread`, `statTags`, moment-tag migration. *(API-Football later superseded by
  TheStatsAPI — see B3.)*

### A11 · Security hardening (formal audit) — Jul 12 · PR #10
- **Direction:** §16 moderation/abuse safety; make the app deploy-safe.
- **Changes:** Atomic single-statement vote claims (removed check-then-write race), shared DB-backed
  rate limiter, Zod API validation, CSP/security headers, preserved access for existing email
  accounts (OAuth linking), dependency patches.
- **Surfaces:** `apiValidation.ts`, `middleware.ts`, `auth.ts`, vote SQL, migration script.
  — **[Security hardening ✅]**

---

## Part B — Uncommitted World Cup launch branch (🟡)

Everything below lives in the working tree with **zero commits**. It implements epic **GBT-10 —
World Cup 2026 Public Launch**. The steps are ordered by dependency (the ticket release order), and
**each step is a self-contained slice you can turn into one commit/PR**. File lists are included
precisely so you can `git add` per slice.

### B1 · GBT-11 — Separate dev/prod databases + safety rails 🟡 ✅done
- **Direction:** §15.5 preserve data integrity; never leak demo data into production.
- **Changes:** Made the existing Neon DB development-only, added fresh-prod provisioning, an
  environment marker every mutating script must match, `--confirm-production` gating, and post-op row
  counts. Node scripts get their own DB adapter (Worker runtime module can't load in `tsx`).
- **Surfaces (new):** `scripts/lib/database-safety.ts`, `scripts/lib/node-db.ts`,
  `scripts/init-db-environment.ts`, `scripts/verify-db-state.ts`, `scripts/migrate-fresh-schema.ts`,
  `scripts/verify-production-owner-auth.ts`, `DATABASE-OPERATIONS.md`.
- **Surfaces (mod):** all `scripts/migrate-*.ts` (`--env-file`), `drizzle.config.ts`, `seed*.ts`.

### B2 · GBT-12 — Cloudflare Workers port 🟡 ✅done
- **Direction:** §14 web-first infra; move off Vercel to the Workers runtime.
- **Changes:** Astro Cloudflare adapter + `wrangler.jsonc`, preview/prod deploy scripts, secrets read
  from `cloudflare:workers` at runtime (+ dev-only Vite shim), OG rendering pinned to a prerender
  node environment, CSP merged across Astro + middleware, geo/IP via Cloudflare request metadata,
  security headers.
- **Surfaces (new):** `wrangler.jsonc`, `worker-configuration.d.ts`, `src/worker.ts`,
  `public/_headers`, `.claude/launch.json`, `src/lib/staticCatalog.ts`.
- **Surfaces (mod):** `astro.config.mjs`, `src/lib/db/index.ts`, `auth.ts`, `ip.ts`, `og.ts`,
  `middleware.ts`, `package.json` (+lock), `src/pages/og/battle/[slug].png.ts`, `Layout.astro`.

### B3 · GBT-13 — Provider spike → TheStatsAPI adoption 🟡 ✅done
- **Direction:** §5 full match coverage needs a reliable data provider. **Pivot recorded here:** the
  ticket began as a *Sportmonks* spike; the project adopted **TheStatsAPI** as the World Cup provider.
- **Changes:** Provider client + mapping layer, recorded payload fixtures (completed / live /
  scheduled), deterministic fixture/status mapping, automated mapping tests.
- **Surfaces (new):** `src/lib/theStatsApi.ts`, `theStatsApiClient.ts`, `worldCupProvider.ts`,
  `tests/theStatsApi.test.ts`, `tests/worldCupProvider.test.ts`, `tests/fixtures/worldcup26-*.json`.

### B4 · GBT-15 — World Cup import + conservative score/status refresh 🟡 ✅done
- **Direction:** §5 every supported match gets a page; §15.3 avoid premature real-time — scores only.
- **Changes:** Provider/source identity, tournament stage, stable fixture IDs; idempotent import of
  **104 matches**; scheduled score/status poll (60 min pre-kickoff → 4 h after) via Worker cron;
  **no live goal/card/sub events exposed** at launch; GOAT↔provider-player mapping **by ID only**.
- **Surfaces (new):** `scripts/import-world-cup.ts`, `import-thestatsapi-world-cup.ts`,
  `migrate-world-cup.ts`, `migrate-thestatsapi.ts`, `map-thestatsapi-goats.ts`,
  `src/data/worldCup2026.ts`, `worldCupCatalog.ts`, `archiveMatches.ts`, `src/lib/worldCupSync.ts`,
  `theStatsApiSync.ts`, `src/pages/api/world-cup-status.ts`.
- **Surfaces (mod):** `scripts/sync-matches.ts`, `schema.ts`, `src/worker.ts` (cron).

### B5 · GBT-18 — World Cup hub + launch positioning 🟡 ✅done
- **Direction:** §4 evergreen + fresh layers; football-first homepage.
- **Changes:** `/world-cup` hub (Upcoming / Live / Results) featuring both semifinals, bronze match,
  final with countdown/status; homepage hero → next World Cup match; football content promoted above
  other arenas; The Floor feed island.
- **Surfaces (new):** `src/pages/world-cup.astro`, `WorldCupHub.tsx`, `WorldCupMatchHeader.tsx`,
  `FloorFeed.tsx`, `src/lib/floorFilters.ts`, `src/pages/api/floor.ts`.
- **Surfaces (mod):** `index.astro`, `floor.astro`, `floor/[match].astro`.

### B6 · GBT-14 — Match prompt cards, GOAT linkage, sharing 🟡 ✅done
- **Direction:** §15.4 seed debate for sparse communities; §6 structured surfaces; §12 shareability.
- **Changes:** 2–3 editorial prompts per match that focus the composer (comments stay in the main
  thread), Web Share + copy-link fallback, static share images for remaining fixtures, fixed profile
  match comments linking to `/battle/null`.
- **Surfaces (new):** `src/components/ShareButton.tsx`, `src/data/shareBattles.ts`,
  `src/pages/og/match/[match].png.ts`.
- **Surfaces (mod):** `CommentThread.tsx`, `floor/[match].astro`, `users/[username].astro`, `floor.ts`.

### B7 · GBT-17 — Comment reporting + minimum moderation 🟡 ✅done
- **Direction:** §16 argument without abuse; launch-minimum moderation.
- **Changes:** `comment_reports` table (one active report per user/comment via partial unique index),
  authenticated rate-limited `POST /api/comment-reports`, rejects self/invalid/duplicate reports,
  Report action on non-deleted comments, community rules page. Reports reviewed in the prod DB (no
  admin dashboard at launch).
- **Surfaces (new):** `scripts/migrate-comment-reports.ts`, `smoke-comment-reports.ts`,
  `src/pages/api/comment-reports.ts`, `src/pages/rules.astro`.
- **Surfaces (mod):** `CommentThread.tsx`, `schema.ts`, `apiValidation.ts`.

### B8 · GBT-16 — Launch UX, mobile, SEO, legal, analytics 🟡 ✅done
- **Direction:** §14 web-first discoverability; §13 shareable, legal-ready launch.
- **Changes:** Hydrated Preact mobile nav; `/privacy`, `/terms`, `robots.txt`, dynamic sitemap; 404
  and empty/loading/failure states; Cloudflare Web Analytics under prod CSP; removed dead Public API /
  placeholder footer links.
- **Surfaces (new):** `src/components/MobileNav.tsx`, `src/pages/privacy.astro`, `terms.astro`,
  `robots.txt.ts`, `sitemap.xml.ts`, `404.astro`.
- **Surfaces (mod):** `Layout.astro`, `middleware.ts`, `astro.config.mjs`.

### B9 · GBT-19 (foundation only) — durable moments + private live snapshots 🟡 ⛔public gate
- **Direction:** §15.2 event-driven; §15.3 gate real-time behind quality proof.
- **Changes present:** durable `match_moments` keyed by `providerMatchId:period:sequence`, private
  provisional live-timeline snapshots retained by hash, structural shadow verifier, cleanup/backfill
  scripts. `/api/match-moments` exposes **confirmed durable moments only** — **public live events are
  NOT enabled** (that's the remaining launch-critical work, due **2026-07-20**, see GBT-19).
- **Surfaces (new):** `src/components/MatchTimelineLive.tsx`, `src/pages/api/match-moments.ts`,
  `scripts/backfill-thestatsapi-timelines.ts`, `cleanup-invalid-thestatsapi-moments.ts`,
  `verify-thestatsapi-shadow.ts`.

### B10 · GBT-20 — Fresh prod init + release QA 🟡 ⛔remaining
- **Direction:** §17 launch readiness; verified, non-fabricated production state.
- **Changes/state:** Prod schema/security/World Cup/reporting migrations applied & verified; 28 goats
  / 90 battles / 104 matches seeded clean; Worker + domains + OAuth round-trip verified. **Remaining:**
  authenticated prod smoke checks (votes, Champion Mode, comments/replies/upvotes, non-self report
  with a second real user) + record TheStatsAPI prod state.

> **Also uncommitted (repo hygiene, fold into the most relevant slice or a `chore:` commit):**
> `AGENTS.md` (gotchas), `STACK.md`, `GOATSBattle_Product_Direction.md`, `product_design/*`,
> `.claude/hooks/`, `.claude/skills/`, `.env.example`, `.gitignore`, `.claude/settings.json`.

### Suggested commit/PR order for the branch
`B1 → B2 → B3 → B4 → B5 → B6 → B7 → B8 → B9`, then land **GBT-19 public live** as its own PR before
closing GBT-20. B1–B3 are infra and should merge first; B4–B8 are product surfaces and are largely
independent of each other once B4 lands.

---

## Part C — Feature List

### C1 · Shipped / in-branch features

**GOATs & arenas**
- Curated GOAT pools per arena (football, cricket, tennis, F1); football-first.
- GOAT profile pages `/goats/<slug>` with career stats and 1v1 win/loss visuals.
- Arena hub `/arenas` and `/arenas/[arena]`.

**Battles, rankings, Champion Mode**
- 1v1 battle pages `/battle/<slug>` + `/faceoff` battle builder (BattlePicker).
- Rankings `/rankings/<arena>` with podium/ticker.
- **Votes** as the single scoring metric (Elo removed): profile +1, Champion crown +5, shared rolling
  24h window, Ranked/Friendly modes, separate head-to-head plane.
- Champion Mode: blind ranked voting.

**Accounts & identity**
- better-auth accounts with Google OAuth (password endpoints disabled on the Free Worker for CPU).
- Account menu, user profiles `/users/<username>`, fan/team tags.
- Login-gated voting, commenting, and reporting; read access without an account.

**Discussion — The Floor**
- Threaded comments with replies and upvotes, scoped **battle-XOR-match**.
- GOAT **stat citations** and match **moment tagging** in the composer (match pages).
- Editorial **prompt cards** per match that focus the composer.
- **Comment reporting** + minimum moderation (one active report/user/comment) + community rules.

**Matches & World Cup**
- 104 canonical World Cup 2026 matches; match pages at `/floor/<match-slug>` with timelines.
- Conservative **live score/status refresh** via Worker cron (no live events exposed yet).
- `/world-cup` hub — Upcoming / Live / Results; homepage hero tracks the next match.
- The Floor feed with filters.

**Sharing & SEO**
- Web Share + copy-link; OG images for battles and matches.
- Dynamic sitemap, `robots.txt`, `/privacy`, `/terms`, `/rules`, custom 404, mobile nav.

**Platform / infra**
- Astro SSR + Preact islands, Tailwind v4 "Stadium Gate" design system.
- Neon Postgres + Drizzle with hand-written **idempotent** migration scripts.
- Cloudflare Workers deploy (separate preview/prod), dev/prod DB separation + safety rails.
- CSP + security headers, shared DB-backed rate limiting, atomic vote claims, Cloudflare Web Analytics.
- **TheStatsAPI** provider integration: recorded fixtures, sync, GOAT↔player mapping by ID, shared
  cross-isolate rate limiter, structural shadow verifier.

### C2 · Planned / future features

**Immediate (open tickets)**
- **GBT-19** — public live event sync (goals/cards/subs, provisional live moments) — *launch-critical,
  due 2026-07-20 with the TheStatsAPI trial window.*
- **GBT-8** — expanded moment tagging into battle (1v1) and GOAT discussions (not just match threads).
- **GBT-9** — structured match **debates + polls**: debate cards, 2–4 option polls, dedicated debate
  pages `/floor/<match>/debates/<debate>`, debate-scoped threads.

**Product-direction roadmap (Phases 2–5)**
- *Daily retention:* player-of-the-match voting, replies/mentions, follows (clubs/players/debates),
  notifications, personalised home feed, trending topics, club communities, match-day streaks.
- *Community depth:* reputation & progression (badges, levels, streaks), club/category/seasonal
  leaderboards, roles + community moderators, moderation tooling (topic locks, escalation),
  historical opinion charts & regional breakdowns (the "opinion graph"), search & discovery, debate
  collections, tournament/season hubs, creator tools.
- *Entities:* competitions beyond the World Cup, club and player entity pages.
- *Mobile:* native iOS/Android apps with push, live-match alerts, fast reply flows.
- *Category expansion:* deepen cricket, F1, tennis, then basketball/film/music/literature/gaming —
  each reusing the same Entity/Event/Debate/Poll/Vote/Ranking primitives (football-first until PMF).
- *Explicitly deferred:* politics as a category; Discord-style disposable live chat replacing
  persistent structured debate.
