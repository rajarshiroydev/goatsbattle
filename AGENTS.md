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

## Deployment authority (mandatory)

- The GitHub `Protect Main` ruleset is active for the default branch with no bypass actors. It
  blocks branch deletion and force-pushes, requires changes to enter through a pull request with
  resolved review threads, and requires the strict `validate` status check. Never weaken, bypass,
  or disable it as part of an ordinary release.
- Production deployment always requires the user's explicit approval for that specific deployment
  in the current conversation. A request to commit, push, open/merge a PR, or deploy preview is not
  production approval.
- Deploy preview and production only through `npm run worker:deploy:preview` and the guarded
  `npm run worker:deploy:production -- --preview-version=<id> --confirm-production` flow documented
  in `docs/RELEASES.md`. Never use a raw `wrangler deploy`, an unverified dashboard upload, or an
  arbitrary working-tree build to reach production.
- If any release guard fails (dirty tree, wrong branch, stale `origin/main`, inactive preview
  version, tree mismatch, failed CI/build/test/migration check), stop and report it. Do not bypass
  the guard to finish the deployment.
- Never expose, print, commit, or share `.env.production`, Wrangler credentials, or Cloudflare API
  tokens. Do not grant another collaborator or automation production deploy access during ordinary
  feature work. Cloudflare access is a separate production boundary from GitHub branch protection.
- Before every production deployment, record the active production version for rollback, confirm
  the tested preview tree matches production `main`, and after deployment verify `/api/version`,
  public health, bindings/triggers, and production logs. A Worker rollback never authorizes or
  performs a database rollback.

### When to recommend stronger deployment isolation

The current small-team workflow intentionally keeps production deployment manual. Proactively
recommend moving production deployment into a protected GitHub Actions `production` environment
when any of these becomes true: another person or automation needs Cloudflare deploy access;
production deployments become frequent enough that the manual credential/process boundary is
error-prone; an audit trail or approval separation is required; or any raw/bypassed/accidental
production deployment occurs.

That upgrade should restrict deployments to protected `main`, keep a least-privilege Cloudflare
token only in the GitHub `production` environment, require an explicit environment approval (and
prevent self-approval once a second trusted reviewer exists), deploy the already-tested commit/tree,
and remove ordinary local production-deploy credentials. Do not introduce this infrastructure
preemptively; surface the recommendation to the user when a trigger occurs.

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
- **A REST fallback can overwrite newer WebSocket state.** Symptom: a newly created/deleted/voted
  comment briefly appears and then reverts, or a live clock jumps backward after reconnect → Cause:
  an in-flight fallback response can resolve after socket events or local wall-time projection →
  Fix: buffer comment socket events while the refresh is pending and replay them in order onto the
  fetched snapshot; merge clock responses through `recalibrateLiveMatchClock` rather than replacing
  the current anchor directly.
- **`tsc` writes diagnostics to STDOUT, not stderr.** When wiring typecheck into any
  hook/CI, capture `2>&1` — checking only stderr makes real type errors look like "no
  output" (this silently broke a Stop hook that appeared to pass but was failing).
- **Deploy flow is manual and approval-gated.** localhost (`astro dev`) reflects live edits;
  the preview Worker (`npm run worker:deploy:preview`) and prod (`worker:deploy:production`)
  are separate manual `wrangler deploy` snapshots — nothing auto-deploys from git. A
  client-side fix (e.g. the `useSession` hydration fix) only reaches preview/prod after a
  redeploy. Preview vs prod differ by `CLOUDFLARE_ENV` at build time (name, routes, cron,
  KV, secrets); only prod has the every-minute cron and the `goatsbattle.com` routes. Follow
  `docs/RELEASES.md`: deploy only clean commits, test the candidate on preview, and promote
  only a `main` tree that matches the active tested preview version. Never deploy arbitrary
  uncommitted work directly to production.
- **Dirty feature work is not a reason to bypass the release clean-tree guard.** Symptom: a
  reviewed `main` tree is ready to promote but the shared working directory contains unrelated
  uncommitted work → Cause: `release-worker.mjs` intentionally refuses every dirty tree, even when
  the dirty files are not part of the build → Fix: preserve the user's files and deploy from a
  separate clean temporary worktree checked out on fetched `main`; install from the lockfile, link
  only the ignored environment secrets file, verify its SHA/tree, and remove the temporary worktree
  afterward. Never stash, reset, discard, or bypass the guard merely to release.
- **`/api/version` can briefly serve the pre-route cached 404 after its first deployment.** Symptom:
  Cloudflare reports the new Worker active, but the first plain version request returns the old
  static 404 with `cf-cache-status: HIT` → Cause: the edge retained the response created before the
  dynamic route existed → Fix: revalidate with `Cache-Control: no-cache` or a unique query string,
  then confirm the endpoint returns the expected SHA/tree and `Cache-Control: no-store`; do not
  mistake that one stale response for a failed Worker deployment.
- **The Astro Cloudflare adapter emits an env-FLATTENED redirected config** at
  `dist/server/wrangler.json` selected by `CLOUDFLARE_ENV` at BUILD time. So the deploy
  scripts run a bare `wrangler deploy` with **no `--env` flag** — adding one breaks (the
  flattened config has no `env.*`). Footgun: the top-level `wrangler.jsonc` `name` is
  `goatsbattle` (= prod), so a bare `astro build` (no `CLOUDFLARE_ENV`) + `wrangler deploy`
  targets PRODUCTION. Always build via the `worker:build:preview`/`:production` scripts.
- **Durable Object bindings are not inherited by Wrangler environments.** Symptom: the
  top-level `durable_objects` config looks correct, but `wrangler types --env preview` warns
  and the generated `Env` omits the namespace → Cause: bindings must be repeated inside each
  `env.*` block → Fix: keep the coordinator/broker bindings at top level and in preview/prod,
  regenerate `worker-configuration.d.ts`, then inspect `dist/server/wrangler.json` after the
  environment-specific Astro build to verify both bindings and the SQLite class migration.
- **The first Durable Object migration is now a permanent rollback boundary.** Symptom: an attempt
  to restore a production Worker from before realtime coordination may be rejected even though the
  old version still appears in version history → Cause: `v1-live-match-coordination` introduced the
  first SQLite Durable Object classes and was applied to preview and production on 2026-07-17 →
  Fix: use a forward fix for problems that would require crossing back before that migration;
  ordinary rollback is valid only among versions that already contain the same migration state.
- **The live-match coordinator owns a match through its full correction lifecycle.** Symptom: the
  minute cron and a Durable Object both sync a finished match, consuming quota and racing state →
  Cause: finished matches can drop out of the coordinator candidate set or appear unhealthy between
  widely spaced correction alarms → Fix: keep finished matches routed to their coordinator until
  every correction slot is consumed, treat scheduled correction intervals as healthy ownership,
  and exclude active coordinator IDs from the watchdog refresh even while a finalization retry is
  backing off.
- **Durable Object progress flags must advance after the durable effect succeeds.** Symptom: an
  incomplete final timeline permanently consumes a correction slot, or a failed snapshot read loses
  its pending broadcast → Cause: `correction_index`/`pending_broadcast` were updated before complete
  coverage and payload assembly were proven → Fix: advance a correction only after an accepted
  full-coverage finalization, and clear `pending_broadcast` only after the persisted snapshot has
  been read and broadcast; rejected/incomplete work stays retryable with backoff.
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
- **A live match can have no timeline clock for several minutes.** Symptom: the scorecard says
  LIVE but shows no clock after kickoff → Cause: the provider match resource can flip to
  `live` about two minutes after the real whistle, then `/live-timeline` can remain empty for
  roughly two more minutes, including about 60 seconds of provider response caching (observed:
  live at 19:03:12; events stamped 19:04:00.654 were not served until 19:05:12) → Fix: while
  status is `live` and the timeline is empty, show a clearly approximate clock anchored to our
  first live empty-snapshot observation, but stop rendering it after ten minutes so a recurring
  empty hash cannot create bogus first-half stoppage time; never gate the "match started" UX
  solely on timeline events.
- **A timeline clock must not use the heartbeat timestamp.** Symptom: the live clock freezes at
  the last event minute and falls minutes behind real time → Cause: an identical-snapshot
  heartbeat re-stamps `provider_updated_at` on every poll, so `event minute + (now -
  provider_updated_at)` never advances between events → Fix: anchor to the first-seen
  `fetched_at` for the current snapshot hash, as `liveMatchClock.ts` does; never anchor a clock
  to `provider_updated_at`.
- **Provider fixtures are identities/enrichment, not the canonical schedule.** Symptom:
  semifinal kickoff times drift or unresolved `W101`/`L101` labels leak into public pages →
  Cause: the provider schedule can disagree with FIFA and uses terse placeholder teams →
  Fix: `mapStatsApiWorldCupMatches` requires one exact normalized team-pair match and only
  uses kickoff as a 12-hour sanity bound; never overwrite canonical kickoff/stage/venue/URL,
  and pass team names through `displayProviderTeamName` until real teams are known.
- **Resolved knockout teams can invalidate imported provider identities.** Symptom: a completed
  knockout match remains 0–0 and its full provider timeline produces no public moments → Cause:
  the match was imported while its participants were placeholders, so `match_sources.metadata`
  retains obsolete team IDs and strict timeline normalization rejects every resolved-team event;
  a coordinator that only refetches the final timeline cannot repair the stale score either → Fix:
  update the match score/status and source team IDs atomically before every finished correction,
  then retry any finalized full timeline that contains supported events but has zero materialized
  provider moments; keep this repair bounded so it cannot become an endless provider poll.
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
- **The timeline can lead the match score resource by minutes.** Symptom: a goal appears in
  Match Moments while the score card remains stale even though both poll frequently → Cause:
  TheStatsAPI updates `/live-timeline` and the match resource independently (observed skew:
  about two minutes) → Fix: for live matches with `full` timeline coverage, the public status
  endpoint derives the regulation score from active TheStatsAPI `goal`/`penalty` moments;
  exclude shootouts and fall back to the match resource outside that gate. This adds no
  provider request and lets retracted provisional goals correct the displayed score.
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
- **Comment stat tags are all-or-nothing with their comment.** Symptom: a comment posts but its
  requested stat chips disappear after reload → Cause: resolving or inserting tags separately can
  silently discard unknown pairs or leave the comment committed after a tag failure → Fix: reject
  every unresolved GOAT/stat pair with `400`, deduplicate validated inputs, insert the comment and
  tags in one data-modifying CTE, and return the tags read back from the database.
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
- **The Worker test tsconfig must override the root exclusion.** Symptom: the dedicated Worker
  `tsc -p tests/worker/tsconfig.json` exits successfully while checking none of the test files →
  Cause: the nested config inherits the root `tests/worker` exclusion even when it declares its own
  include list → Fix: override `exclude` in the nested config, confirm the files with `--listFiles`,
  and keep `cloudflare:test`'s `ProvidedEnv` narrowed to bindings actually supplied by
  `wrangler.test.jsonc`.
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
