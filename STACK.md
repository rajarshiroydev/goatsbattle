# Stack & tooling inventory

Canonical list of what this project runs on and what tooling the agents use. Both Claude
Code and Codex work this repo (see `AGENTS.md`) — keep this current when deps or tooling
change. Versions are the `package.json` ranges at time of writing; check `package.json` /
`package-lock.json` for the exact resolved versions.

## Runtime & framework
- **Node** ≥ 22.12 (`engines.node`).
- **Astro** ^7.0.3 — SSR + static hybrid. Config in `astro.config.mjs`.
- **Preact** ^10.29 via `@astrojs/preact` ^6 — interactive islands (no React).
- **Tailwind CSS** v4 (`tailwindcss` + `@tailwindcss/vite` ^4.3) — design tokens via
  `@theme` in `src/styles/global.css`; full "Stadium Gate" spec in
  `product_design/DESIGN-GUIDE.md`.
- **TypeScript** ^6 — typecheck with `npx tsc --noEmit` (`astro build` does NOT typecheck).

## Data & auth
- **Neon** Postgres via `@neondatabase/serverless` ^1.1 (neon-http driver — no interactive
  transactions). Two SEPARATE Neon projects: production + development.
- **Drizzle ORM** ^0.45 + **drizzle-kit** ^0.31. Schema applied with hand-written idempotent
  SQL migration scripts (`scripts/migrate-*.ts` → `db:migrate:*` npm scripts), NOT
  `drizzle-kit push`/generate. See `AGENTS.md` gotchas + `DATABASE-OPERATIONS.md`.
- **better-auth** ^1.6 — Google OAuth (deployed), sessions in Postgres. `src/lib/auth.ts`.
- **Zod** ^4 — API input validation (`src/lib/apiValidation.ts`).

## Hosting, build & deploy
- **Cloudflare Workers** via `@astrojs/cloudflare` ^14 + **wrangler** ^4.110. Config in
  `wrangler.jsonc` (env-flattened redirected config at build via `CLOUDFLARE_ENV`).
- **Cloudflare Durable Objects** — per-match live ingestion/WebSocket coordination plus a
  per-provider request broker; SQLite-backed alarms and hibernating WebSockets are tested in
  workerd via `npm run test:worker`.
- Deploy is manual/approval-gated: `worker:deploy:preview` (Worker `goatsbattle-preview`) and
  `worker:deploy:production` (Worker `goatsbattle`, custom domain + cron). See `AGENTS.md`.
- **OG images**: `satori` ^0.26 + `@resvg/resvg-js` ^2.6, prerendered in Node
  (`prerenderEnvironment: 'node'`) since resvg is a native binary that won't run in workerd.
- **tsx** ^4 — runs the `scripts/*.ts` tooling (DB migrations, imports, verification).
- **Playwright** ^1.61 — UI screenshots (`npm run shot -- <route>`).
- **Vitest** ^4.1 + `@cloudflare/vitest-pool-workers` ^0.18 — Worker-runtime tests for
  Durable Object storage, alarms, WebSockets, and provider quota coordination.

## External services / providers
- **Neon** — database (prod + dev projects).
- **Cloudflare** — Workers hosting, Durable Objects, DNS/custom domain, Web Analytics, KV
  (SESSION binding).
- **Google OAuth** — the only deployed identity provider.
- **TheStatsAPI** (`comp_6107`) — World Cup scores/status/timelines/lineups provider
  (`src/lib/theStatsApi*.ts`); community World Cup API is a score/status fallback only.
- **Linear** — issue tracking (team GOATSBattle, `GBT-*`); both agents can read it.

## Agent tooling — Claude Code side
These are Claude Code's tools/config. Codex uses its own MCP/tooling — Codex should add its
equivalents below so each agent knows what the other has.
- **Project MCP** (`.mcp.json`, checked in): `astro-docs` (Astro docs search).
- **Plugins** (`.claude/settings.json`): `frontend-design`, `neon` (Neon MCP).
  User-level also: `context7` (library-docs MCP), `code-simplifier`, `pyright-lsp`.
- **Other MCP connectors in use this session**: Linear (issue tracking), better-auth docs,
  in-app browser (preview/verify), Neon.
- **Key built-in skills**: `code-review`, `verify`, `run`, `security-review`; Cloudflare
  skills (`cloudflare`, `workers-best-practices`, `wrangler`, `durable-objects`) relevant to
  the deploy target.
- **Hooks** (`.claude/settings.json`): `Stop` → `.claude/hooks/typecheck-on-stop.sh`
  (typechecks on stop, blocks only on real errors, loop-guarded).
- **Local dev**: `.claude/launch.json` defines the `astro-dev` server (port 4321).

## Codex tooling
Codex's integrations are user-level unless a repo path is named here; they are not application
dependencies and do not bypass the repository's database/deploy safety gates.

- **Linear MCP server:** authenticated issue/comment access for the GOATSBattle workspace;
  use it for `GBT-*` status and operational next steps.
- **Neon Postgres Codex plugin:** installed Neon app/MCP operations for projects, branches,
  schemas, connection strings, SQL, migrations, and query analysis, plus the bundled
  `neon-postgres` and egress-optimizer skills. Repo mutations still go through the guarded,
  idempotent scripts in `package.json`; never use the app to bypass target markers or production
  confirmation.
- **Repo skills:** `.agents/skills/security_check` for OWASP-focused review and
  `.agents/skills/tailwind-4-docs` for Tailwind v4 work. Codex also has system workflows for
  official OpenAI docs, plugin/skill management, and raster image generation when relevant.
- **Workspace operations:** built-in shell execution, patch-based file editing (`apply_patch`),
  local image inspection, and web retrieval. External writes, deployments, and production DB
  operations remain approval-gated.
- **Astro docs:** `.mcp.json` is Claude's project MCP configuration; Codex consults the official
  Astro documentation via web retrieval unless an Astro docs MCP is separately configured.
