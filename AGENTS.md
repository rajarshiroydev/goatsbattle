# How we collaborate (read first)
This repo is worked on by both **Claude Code** and **Codex**, reviewing each other's work.
`CLAUDE.md` is a symlink to this file, so both agents read it — it's the shared source of
truth. Durable learnings (fixes, root causes, engineering gotchas) go in the **Engineering
gotchas / hard-won learnings** section below, in `symptom → cause → fix` form. Agent-private
memory is not shared and doesn't count. When you burn time on something non-obvious, leave
the lesson here so the other agent doesn't re-hit it. Verify claims against current code
before writing them.

## Tech Stack / Framework Conventions
This is an Astro project using Preact islands. Never use string-based inline event handlers; use proper Preact event handlers (onClick, etc.) so island hydration works.

**Full stack, external services, and agent tooling inventory: see [STACK.md](STACK.md)** — keep it current when deps/tooling change. In short: Astro 7 + Preact 10 islands, Tailwind v4, Neon Postgres + Drizzle (idempotent SQL migration scripts), better-auth (Google OAuth), Zod, deployed on Cloudflare Workers (`@astrojs/cloudflare` + wrangler); OG images via satori/resvg; TheStatsAPI as the World Cup data provider; Linear for issues.

## Environment / Config section
Two distinct env sources after the Cloudflare port — do not mix them up:

- **Server-only runtime secrets** (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_*`, `IP_HASH_SALT`, `THESTATSAPI_API_KEY`): read from `import { env } from 'cloudflare:workers'` (see `src/lib/db/index.ts`, `src/lib/auth.ts`, `src/lib/ip.ts`). This keeps secrets out of the built bundle and reads the encrypted Worker env at runtime. `cloudflare:workers` is a workerd-only virtual module — under `astro dev` (Node) it doesn't exist, so a **dev-only Vite shim in `astro.config.mjs`** (`cloudflareWorkersDevShim`, `apply: 'serve'`) maps `env` to the local `.env`. Do NOT remove that shim or every DB-backed SSR route 500s locally with "Cannot find module 'cloudflare:workers'". Do NOT put these secrets behind a `PUBLIC_` name.
- **Public / build-time config** (`PUBLIC_*`): read via `import.meta.env.VAR` with **static** access only — never optional chaining or dynamic/bracket access, since Vite's static replacement won't apply and the value will be undefined at runtime.

## Database section
After running any DB seed or cleanup script, verify the actual DB state (row counts, no leftover test users/comments/aggregates) before reporting success; inline cleanup scripts have silently errored before.

## Domain / Naming Conventions section
The canonical domain terms are 'arena' (not 'category') and 'goats' with URLs /goats/<slug> and /rankings/<arena>; use these consistently across routes, links, and data.

## UI / Styling Conventions section
The design system is "Stadium Gate" — see `product_design/DESIGN-GUIDE.md` for the full spec (colours, type, spacing, components). Every top-level page shares the `.page-container` width standard (max-width 1120px, 32px gutter / 20px on phones) defined in src/styles/global.css — use it instead of ad-hoc `max-w-*` + `px-*` wrappers. Reuse the design-system primitive classes (`.btn-*`, `.chip`, `.team-tag`, `.vote-bar`, `.live-dot`) and the shared page-header component rather than re-implementing them; keep sibling pages visually consistent.

## Shell / Scripting section
When writing shell rename/loop scripts in zsh, always quote variables and use explicit loops — unquoted variables do not word-split as in bash and sed renames can fail silently.

## Development
When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Engineering gotchas / hard-won learnings
Keep this list current. Each entry = symptom → cause → fix.

- **`cloudflare:workers` breaks `astro dev`.** Symptom: DB-backed SSR routes (`/floor/*`,
  profiles, `/api/*`) 500 locally with "Cannot find module 'cloudflare:workers'" while the
  deployed preview/prod Workers are fine. Cause: that virtual module only exists in workerd,
  not Node. Fix: the dev-only Vite shim in `astro.config.mjs` (`cloudflareWorkersDevShim`,
  `apply: 'serve'`) maps it to `.env`. Keep it. The build is unaffected (serve-only).
- **Node DB scripts cannot import the Worker runtime DB adapter.** Symptom: a `tsx` migration,
  seed, or verifier fails before connecting with "Cannot find module 'cloudflare:workers'" →
  Cause: the Vite serve shim does not run for standalone Node scripts, while
  `src/lib/db/index.ts` intentionally imports the workerd-only environment module → Fix:
  Drizzle-based scripts import `scripts/lib/node-db.ts`; raw Neon scripts read
  `process.env.DATABASE_URL` directly. Both rely on the command's explicit `--env-file`; keep
  application runtime code on `src/lib/db/index.ts`.
- **Preact `__H` duplicate-instance crash → blank islands.** Symptom: a client-rendered
  island area (e.g. FloorFeed) renders BLANK though the SSR HTML has the data (curl shows
  content, browser shows nothing); console shows `Cannot read properties of undefined
  (reading '__H')`; the network panel shows mismatched `preact*.js?v=<hash>` (two optimize
  generations). Cause: Vite dep-optimizer split Preact into two generations (often after a
  config edit / cache clear). Fix (durable, already in `astro.config.mjs`): BOTH
  `vite.optimizeDeps.include` pre-bundles the Preact entrypoints (including `preact/debug`)
  and `vite.resolve.dedupe` forces the core runtime entrypoints (`preact`, `preact/hooks`,
  `preact/jsx-runtime`, `preact/compat`) to one instance. `optimizeDeps.include` alone is NOT
  durable — it re-splits on the next config restart. After touching these, clear
  `node_modules/.vite` once and restart. This is all dev-only; production/preview bundles
  Preact once via Rollup.
- **`client:visible` on an island that renders `null` until async data never hydrates.**
  Symptom: an island placed above the fold (e.g. `MatchTimelineRail`) never mounts / never
  fetches, even on reload → Cause: its initial (SSR) render returns `null` while data loads,
  so the placeholder has zero height and the `client:visible` IntersectionObserver never
  fires → Fix: use `client:load` for such islands (or give the loading state a non-zero
  min-height). Islands that render a visible "Loading…" placeholder (e.g. the Match Moments
  list) can stay `client:visible`.
- **Session islands must start `loading=true` for hydration.** `src/lib/useSession.ts` must
  NOT seed its initial `useState` from the shared module-level `cachedUser` — SSR always
  renders the `loading` placeholder (the session fetch only runs in an effect, never on the
  server), so any island whose first client render reads a warm cache diverges from SSR and
  throws a hydration mismatch (e.g. CommentThread `button` vs `div`). Always start
  `user=null, loading=true` and resolve in the effect.
- **`tsc` writes diagnostics to STDOUT, not stderr.** When wiring typecheck into any
  hook/CI, capture `2>&1` — checking only stderr makes real type errors look like "no
  output" (this silently broke a Stop hook that appeared to pass but was failing).
- **Deploy flow is manual and approval-gated.** localhost (`astro dev`) reflects live edits;
  the preview Worker (`npm run worker:deploy:preview`) and prod (`worker:deploy:production`)
  are separate manual `wrangler deploy` snapshots — nothing auto-deploys from git. A
  client-side fix (e.g. the `useSession` hydration fix) only reaches preview/prod after a
  redeploy. Preview vs prod differ by `CLOUDFLARE_ENV` at build time (name, routes, cron,
  KV, secrets); only prod has the every-minute cron and the `goatsbattle.com` routes.
- **The Astro Cloudflare adapter emits an env-FLATTENED redirected config** at
  `dist/server/wrangler.json` selected by `CLOUDFLARE_ENV` at BUILD time. So the deploy
  scripts run a bare `wrangler deploy` with **no `--env` flag** — adding one breaks (the
  flattened config has no `env.*`). Footgun: the top-level `wrangler.jsonc` `name` is
  `goatsbattle` (= prod), so a bare `astro build` (no `CLOUDFLARE_ENV`) + `wrangler deploy`
  targets PRODUCTION. Always build via the `worker:build:preview`/`:production` scripts.
- **Wall-clock benchmarks can falsely fail the Workers Free CPU gate.** Symptom: a
  Neon-backed route takes more than 10 ms by `Date.now()`/client timing and appears to
  require Workers Paid → Cause: wall time includes the Neon network wait, while Cloudflare
  CPU time excludes waiting on I/O → Fix: make the plan decision from the deployed
  Worker's **CPU Time per execution** metrics/quantiles, not handler elapsed time; profile
  genuine compute separately.
- **Password auth is a real Worker CPU outlier.** Symptom: Better Auth password signup/login
  consumes roughly 155–179 ms of actual Worker CPU and can exceed the Free-plan request
  ceiling → Cause: password hashing is deliberately CPU-hard, unlike the mostly-I/O session
  lookup → Fix: `src/lib/auth.ts` disables `emailAndPassword` whenever Google is configured,
  keeps deployed auth OAuth-first, and rate-limits social initiation; do not casually
  re-enable password endpoints on the Free Worker.
- **Same-email Google login can still return `account_not_linked`.** Symptom: an owner who
  first registered by email/password cannot sign in with Google using the identical address
  → Cause: Better Auth will not implicitly link an untrusted provider or an unverified local
  identity → Fix: keep `account.accountLinking` enabled only for trusted `google`, keep
  `allowDifferentEmails: false`, verify the existing owner's email/account relationship, and
  run `db:verify:owner-auth:prod` after any auth-data repair.
- **Native OG rendering must never enter the workerd runtime graph.** Symptom: battle/match
  OG routes fail or bloat the Worker when `@resvg/resvg-js` is treated as on-demand code →
  Cause: resvg and the font/file work in `src/lib/og.ts` are Node/native build tooling → Fix:
  keep OG routes prerendered and `adapter.cloudflare.prerenderEnvironment: 'node'` in
  `astro.config.mjs`; on-demand application routes still run in workerd.
- **CSP has two producers and must be merged, not overwritten.** Symptom: generated pages
  lose Astro's route-specific hashes/nonces, early API responses miss headers, or Cloudflare
  Web Analytics loads but cannot beacon → Cause: Astro emits the complete production CSP,
  while middleware is also needed for responses outside that renderer; analytics uses
  separate script and connection origins → Fix: `src/middleware.ts` preserves an existing
  CSP and only supplies a fallback, while `astro.config.mjs` allowlists both
  `static.cloudflareinsights.com` and `cloudflareinsights.com`.

### TheStatsAPI / match data
- **Provider fixtures are identities/enrichment, not the canonical schedule.** Symptom:
  semifinal kickoff times drift or unresolved `W101`/`L101` labels leak into public pages →
  Cause: the provider schedule can disagree with FIFA and uses terse placeholder teams →
  Fix: `mapStatsApiWorldCupMatches` requires one exact normalized team-pair match and only
  uses kickoff as a 12-hour sanity bound; never overwrite canonical kickoff/stage/venue/URL,
  and pass team names through `displayProviderTeamName` until real teams are known.
- **A lineup `404` is normal, while `confirmed: true` is not sufficient evidence.** Symptom:
  expected pre-announcement responses open the circuit breaker, or a 26-hours-early lineup
  with 11 starters and no bench creates false GOAT participation → Cause: the endpoint
  legitimately returns 404 before release and has also emitted premature/incomplete 200s →
  Fix: `providerCall(..., [404])` treats that status as healthy, while
  `evaluateLineupQuality` requires the official window, both complete XIs, non-empty benches,
  and unique player IDs before `match_goats` can be written.
- **The live timeline is a mutable snapshot, not an append-only event ledger.** Symptom:
  delta sync leaves ghost goals after VAR/corrections or duplicates events because the feed
  has no stable event ID → Cause: TheStatsAPI silently mutates/removes sequence-ordered
  objects → Fix: replace the private `match_timeline_state` snapshot atomically, retain
  changed snapshots by hash, and expose only finalized `match_moments` keyed by
  `providerMatchId:period:sequence`; later removals become `retracted`, never destructive
  deletes of citation history.
- **Substitution and VAR payloads are semantically incomplete.** Symptom: a timeline claims
  a player-in/player-out pair or a VAR outcome the provider never supplied → Cause:
  TheStatsAPI substitution events currently identify only one player, and VAR events lack a
  reliable outcome → Fix: keep the conservative copy in `normalizeMoment`
  (`src/lib/theStatsApiSync.ts`) and never infer the missing player or decision.
- **The semifinal shadow verifier is structural, not an official-record oracle.** Symptom:
  `db:verify:stats-api-shadow:*` passes and is mistaken for proof that the feed was complete →
  Cause: `scripts/verify-thestatsapi-shadow.ts` checks changed-snapshot count, hash uniqueness,
  payload counts, sequence ordering, and durable-event uniqueness, but cannot detect an event
  the provider omitted → Fix: after the script passes, manually compare goals, cards, ordering,
  stoppage time, corrections, and outages with the official match record; keep public live
  events disabled until the GBT-19 gate and explicit approval are satisfied.
- **Provider rate limiting must be shared across isolates and scripts.** Symptom: cron,
  preview work, and a backfill each look under the RPM cap but collectively exhaust the
  trial → Cause: an in-memory limiter is per process/isolate → Fix:
  `reserveStatsApiRequest` atomically reserves from `provider_sync_state` (10 RPM, 9,500
  total safety stop), and `backfill-thestatsapi-timelines.ts` spaces requests by 10.5 seconds
  (at most 6 RPM) so the production cron retains headroom; never run multiple imports/backfills
  concurrently.
- **Marking a source degraded must not remove it from the retry set.** Symptom: one transient
  provider failure makes that match stop syncing forever → Cause: the failure path changes
  `match_sources.status` from `active` to `degraded`, so an active-only scheduler can never
  observe a recovery → Fix: `refreshTheStatsApiWorldCup` selects both `active` and `degraded`
  score sources, and `updateScore` restores all roles to `active` after a successful poll.
- **GOAT linkage cannot use display-name matching.** Symptom: aliases, accents, or similarly
  named players attach the wrong GOAT to a match/moment → Cause: provider names are display
  data, not identity → Fix: populate `goat_provider_players` only from reviewed, unique
  provider player IDs (`scripts/map-thestatsapi-goats.ts`), then join by ID; no fuzzy fallback.

### Database / Drizzle / Neon
- **This project applies schema with hand-written idempotent SQL migration scripts, NOT
  `drizzle-kit`.** The `drizzle/*.sql` files apply nothing. Each change is a
  `scripts/migrate-*.ts` run via a `db:migrate:*:{dev,prod}` npm script (prod requires
  `--confirm-production`). Mirror an existing one (e.g. `migrate-matches.ts`) for new DDL.
- **`drizzle-kit push` is effectively unusable here**: it tries to reconcile the better-auth
  tables (wants to truncate `user`) and its create-vs-rename resolver needs a TTY (fails on
  any drop+add diff with "Interactive prompts require a TTY"). Don't reach for it.
- **Don't run `db:generate` casually** — it mutates `drizzle/meta/_journal.json` + adds a
  snapshot, drifting meta from reality. If you generate only to read the SQL, `git checkout`
  the journal and delete the new files after.
- **neon-http has NO interactive transactions.** For integrity-sensitive writes use a
  single-statement data-modifying CTE (the vote planes atomically claim their window +
  update counters in one statement — the old check-then-write race is not accepted). Raw
  `db.execute()` results are under `result.rows`, not `result[0]`. Multi-statement migrations
  also run sequentially and can be left partly applied on failure; keep every DDL step
  idempotent and rerun from the top to converge (see `scripts/migrate-matches.ts` and
  `scripts/migrate-auth-comments.ts`).
- **Drizzle correlated-subquery trap:** a `sql` correlated subquery in the SELECT list
  renders `${matches.id}` **unqualified** as `"id"`, which shadows to `comments.id` inside
  the subquery → `operator does not exist: text = integer`. Use a `LEFT JOIN` + `GROUP BY`
  for comment/aggregate counts instead.
- **`psql` is not installed locally.** Inspect the live DB with a node one-liner:
  `node --input-type=module -e "import { neon } from '@neondatabase/serverless'; const sql = neon(process.env.DATABASE_URL); console.log(await sql\`select …\`)"` (env loaded).
- **A CLI `--target` label does not prove which Neon database the URL reaches.** Symptom: a
  correctly named seed/import command can still write to the wrong project after an env-file
  mix-up → Cause: connection strings are external mutable configuration → Fix: every
  mutating script must go through `scripts/lib/database-safety.ts`, match the persistent
  `deployment_environment` marker, require `--confirm-production` for prod, and print actual
  post-operation row counts before success is reported.
- **`jsonb_to_recordset` key names fail silently when casing differs.** Symptom: an import
  succeeds but columns such as `provider_event_id` are null even though the TypeScript
  objects contain `providerEventId` → Cause: PostgreSQL matches JSON keys exactly to the
  declared record fields and supplies null for missing snake_case keys → Fix: build an
  explicit snake_case payload before SQL (see `databaseMoments` in
  `src/lib/theStatsApiSync.ts`) and make null-ID plus duplicate-ID verification a hard gate.
- **Read-before-insert does not enforce one active report under concurrency.** Symptom: two
  simultaneous report requests can both pass the duplicate check → Cause: application-level
  checks race on neon-http → Fix: keep the partial unique index
  `comment_reports_active_uniq` on open reports and use `onConflictDoNothing()` as the final
  authority in `src/pages/api/comment-reports.ts`.
- **Scoring is a single `entities.votes` integer (see `src/lib/votes.ts`).** Elo was fully
  removed — `src/lib/elo.ts`, `eloDeltaSql`, `elo_history` are DELETED. Don't reference or
  resurrect them.

### Build / typecheck / styling
- **`astro build` does NOT typecheck** — Vite only bundles, so type errors slip through. Run
  `npx tsc --noEmit` (NOT `astro check`, which needs a TTY) before shipping. `tsc` writes
  diagnostics to **stdout**, not stderr (see the gotcha above).
- **Tailwind v4:** custom colours via `@theme` in `src/styles/global.css`; `bg-lime/5` and
  arbitrary `text-[11px]` work, but **`h-13` does NOT exist** (standard scale only). Player
  accent colours must be vivid / mid-luminance so they read as both fills and on-dark text.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
