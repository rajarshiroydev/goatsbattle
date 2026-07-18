# GOATSBattle

GOATSBattle is a production sports debate platform where fans compare all-time greats, vote in head-to-head battles, follow live World Cup matches, and discuss match moments.

## Stack

The application uses Astro 7 with Preact islands and Tailwind CSS 4. It runs on Cloudflare Workers, with Durable Objects and WebSockets for live-match coordination. Neon Postgres is accessed through Drizzle, Better Auth provides Google OAuth, and TheStatsAPI supplies World Cup match data.

See [STACK.md](STACK.md) for the complete service, dependency, and tooling inventory.

## Local development

Requirements:

- A current Node.js release supported by the project dependencies
- npm
- A development Neon database and the required local credentials

Install dependencies and create a local environment file:

```sh
npm install
cp .env.example .env
```

Fill in development values only. Database-changing scripts validate their target and environment marker; follow [DATABASE-OPERATIONS.md](DATABASE-OPERATIONS.md) before initializing, migrating, seeding, or cleaning a database.

Start Astro in background mode:

```sh
npm run dev -- --background
```

Use `npm run astro -- dev status`, `npm run astro -- dev logs`, and `npm run astro -- dev stop` to inspect or stop the background server.

## Environment model

Configuration has two distinct paths:

- Server-only runtime secrets, including database, authentication, IP hashing, and sports-provider credentials, are read from `cloudflare:workers`. During `astro dev`, the serve-only Vite shim in `astro.config.mjs` maps that runtime environment to the local `.env`. Never rename these values with a `PUBLIC_` prefix.
- Public build-time values use `PUBLIC_*` names and static `import.meta.env.VAR` access. Optional chaining and dynamic or bracket access prevent Vite from replacing them reliably.

Do not commit local environment files or copy production credentials into `.env`. Preview and production Workers have separate bindings, secrets, routes, and triggers.

## Validation

Run the core checks before submitting a change:

```sh
npm run typecheck
npm test
npm run test:worker
```

Worker packaging and release validation are documented in [docs/RELEASES.md](docs/RELEASES.md). Production releases are manual, approval-gated, and must use the repository's guarded workflow.

## Project guidance

- [AGENTS.md](AGENTS.md) — framework conventions, safety rules, and hard-won engineering gotchas
- [STACK.md](STACK.md) — current architecture and external services
- [docs/RELEASES.md](docs/RELEASES.md) — protected preview and production release process
- [DATABASE-OPERATIONS.md](DATABASE-OPERATIONS.md) — database targeting, migrations, verification, and recovery
