# Feature testing and release gates

GOATSBattle uses layered tests because no single suite can prove an Astro page, a hydrated Preact
island, a Worker binding, a Neon data contract, a Durable Object alarm, and an external sports feed
all work together. Production promotion requires evidence from the exact Git tree deployed to
preview; a green build alone is not sufficient.

## Release gates

| Gate | Runs where | Required evidence | Blocks |
| --- | --- | --- | --- |
| Pull request | CI | TypeScript, unit/contract tests, Worker/Durable Object tests, production and preview builds, Wrangler dry-run | Merge |
| Development integration | Localhost or preview development database | Disposable-data lifecycle smokes with verified cleanup and final row counts | Preview sign-off |
| Preview feature verification | Deployed preview Worker | Git SHA/tree, public routes, headers, API contracts, data readiness, hydrated desktop/mobile UI, browser errors | Production promotion |
| Authenticated preview smoke | Deployed preview Worker | Google sign-in, session persistence, vote/comment/reply/report flows using a designated test account | Production promotion when auth/community code changes |
| Production smoke | Public Worker, read-only by default | Version, health, critical routes, bindings/triggers and logs | Release completion |

The guarded release script automatically runs `npm run test:feature:preview` after a preview upload.
Before production, it reruns the same verifier against the active preview version whose Git tree must
match `main`. A failed feature verifier is a release failure even if the upload itself succeeded.

## Commands

Deterministic checks used on every pull request:

```sh
npm run release:check
npm run worker:verify-build:production
npm run worker:dry-run
```

`release:check` includes the provider feature simulation. CI shows it as a separate named step so
a provider-contract failure is distinguishable from ordinary unit or Worker-runtime failures.

## TheStatsAPI feature simulator

`tests/support/theStatsApiSimulator.ts` is a deterministic HTTP double for the exact provider
endpoints used by GOATSBattle. It requires no API key, provider network access, clock waiting, or
database connection. The simulator is test-only and is never bundled into the Worker.

The blocking `npm run test:feature:stats-api` suite covers:

- two-page World Cup import, request paths, bearer authentication, content negotiation, user agent,
  shared quota reservation, missing credentials and request deadlines;
- scheduled lineup 404; unconfirmed, short-XI, missing-bench, duplicate-player and premature lineup
  rejection; and complete official acceptance;
- scheduled → live → finished resources, an initially empty live timeline, a timeline goal leading
  the match score, VAR removal, partial final coverage, full finalization and late correction;
- provider event normalization for goals, cards, substitutions, penalties and conservative VAR
  details, plus stable event identities and changed-snapshot hashes;
- 429 responses, malformed JSON, oversized bodies, stalled requests, coordinator ownership,
  generic-refresh exclusion, fallback selection and total-provider failure;
- the real Durable Object alarm state machine from live polling through an incomplete-final retry
  and a successful correction slot.

The upstream service sends no webhook to GOATSBattle. The production flow is a scheduled Worker
watchdog followed by per-match Durable Object polling; WebSockets broadcast persisted snapshots to
browsers. Tests therefore simulate provider HTTP responses and invoke scheduled/alarm behavior,
instead of adding a non-production webhook endpoint.

### Database-backed provider integration

The deterministic suite deliberately stops at the Postgres boundary. SQL persistence, public API
reads and browser rendering must eventually run in a separate CI job against an ephemeral Neon
branch created for that workflow run, migrated from scratch, verified by row counts and deleted in
an always-run cleanup step. It must never use the shared development/preview database.

Add that job only after a least-privilege Neon CI credential and reliable branch cleanup are in
place. Keep it separate from the fast required simulator step initially; promote it to a required
check after repeated runs prove it isolated and non-flaky. Until then, the guarded disposable
development smoke and deployed-preview verifier remain the persistence and rendering gates.

Read-only deployed-preview verification:

```sh
npm run test:feature:preview
```

The command defaults to `https://goatsbattle-preview.roystark.workers.dev` and refuses to target
the production hostname. It verifies the deployed `/api/version` tree against the current checkout
(and the SHA unless production promotion has already proven an equivalent merge tree),
critical routes and security headers, World Cup result/identity readiness, materialized moments,
anonymous session and comment reads, and hydrated match-moment rendering at desktop and mobile
viewports. `FEATURE_MATCH_ID` can select another completed match with provider moments.

Disposable development lifecycle smoke against the deployed preview API:

```sh
SMOKE_BASE_URL=https://goatsbattle-preview.roystark.workers.dev \
  npm run db:smoke:live-moments:dev
```

This creates an isolated development match, proves provisional, corrected, and finalized moment
behavior through the deployed API, deletes the match, and verifies no dependent rows remain. It
must never target production. Provider import/backfill commands are separate operations because
they consume a shared external quota; run them only after checking provider state and avoiding the
production polling window.

## Feature coverage matrix

### Public shell and discovery

- Routes: home, floor, World Cup hub, arenas, rankings, GOAT profiles, battles, Face Off,
  Champion Mode, rules/privacy/terms, 404, sitemap, robots and OG images.
- Assert status, canonical redirects, navigation targets, metadata, responsive layout and absence
  of page/console errors.
- Keep a desktop and phone visual set for changed surfaces. Visual review is required until stable
  image baselines and a reviewed pixel-difference threshold are introduced.

### Authentication and sessions

- Automated: anonymous session contract, protected mutation rejection, cookie/origin and rate-limit
  behavior, session-loading hydration consistency.
- Preview smoke: Google OAuth redirect/callback, same-email linking, persistence after reload and
  logout using a designated non-production test account.
- Never automate real-user credentials or copy production sessions into preview.

### Battles, votes and rankings

- Unit/DB contract: atomic vote-window claims, duplicate/idempotent requests, aggregate changes,
  rank ordering and invalid entity/arena rejection.
- Preview browser: cast one disposable vote, confirm both the battle and ranking views update, then
  clean up and verify database counts.

### Floor, comments and moderation

- API/DB lifecycle: create comment, reply, vote, stat tag and report; verify authorization,
  validation, duplicate-report constraints, deletion behavior and aggregate counts.
- Browser: signed-out prompt, signed-in composer, sort order, replies, live updates and error states.
- Every mutating smoke uses unique IDs and a `finally` cleanup with explicit leftover counts.

### World Cup scores, clocks and moments

- Provider fixtures: schema validation, canonical mapping, resolved knockout identities, score and
  shootout separation, lineup quality, event normalization and correction/retraction behavior.
- Worker/Durable Object: scheduled → live → finished transitions, alarm scheduling, retry/backoff,
  status-before-final correction, no slot advancement on incomplete work, pending broadcasts and
  coordinator/generic-sync exclusion.
- Preview: current development data must contain a completed full timeline with materialized
  moments. Verify status API, scorecard, clock phase, timeline rail, moments list and desktop/mobile
  hydration. Empty or stale preview data is a failed readiness gate, not a UI success.
- External live-provider canaries are scheduled deliberately and never run concurrently across
  development and production databases.

### Realtime transport

- Worker integration: WebSocket upgrade, initial snapshot, reconnect, event ordering and REST
  fallback merging.
- Preview browser: socket connects without console errors, a disposable update reaches all active
  islands, and a delayed REST response cannot overwrite newer socket state.

### Database and infrastructure

- Verify the persistent environment marker before every mutation and actual row counts afterward.
- Exercise idempotent migrations twice against development and confirm no drift or partial state.
- Verify generated Worker name, compatibility date, KV and Durable Object bindings/migrations,
  preview's lack of cron, production's cron/routes, startup time and Git version annotations.
- Applied Postgres and Durable Object migrations are never deleted as cleanup.

### Security, accessibility and performance

- Security: CSP/security headers, origin validation, authz, rate limits, input limits and secret
  isolation. No production secrets may enter browser bundles or logs.
- Accessibility: keyboard navigation, focus visibility, labels, landmarks, contrast and reduced
  motion on the main desktop/mobile flows. Add an automated accessibility engine only as a reviewed
  dependency change; manual keyboard testing remains required.
- Performance: track representative Worker CPU metrics separately from Neon wall time, plus browser
  Core Web Vitals for the home, floor and match pages.

## Incremental implementation plan

1. **Current foundation:** repaired live-moment lifecycle smoke, read-only preview API/browser gate,
   automatic preview/promotion enforcement, and the blocking deterministic TheStatsAPI simulator.
2. **Community lifecycle:** disposable authenticated comment/reply/vote/report/stat-tag smoke with
   cleanup verification.
3. **Realtime lifecycle:** expand the current provider-driven alarm test with WebSocket/REST race
   recovery and add a preview multi-page socket smoke.
4. **Browser regression suite:** Playwright flows for navigation, battles, rankings, comments and
   World Cup surfaces with stable semantic selectors.
5. **Quality budgets:** reviewed screenshot baselines, accessibility checks and performance budgets.

Each batch should be a separate pull request. A new test becomes blocking only after it is reliable,
isolated, cleanup-safe and proven not to depend on production data or uncontrolled provider timing.

## Release evidence

For every production candidate, record in the release notes or PR:

- preview version ID, Git SHA and Git tree;
- commands and pass/fail results;
- development database verification counts after mutating smokes;
- desktop/mobile screenshots for changed visual surfaces;
- authenticated smoke scenarios performed and cleanup identity;
- known warnings, untested areas and rollback version.

If evidence is missing or a test is flaky, stop promotion and investigate. Do not convert a failure
into an ignored warning merely to finish a deployment.
