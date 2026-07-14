# Database operations

The current `.env` is development-only. A fresh Neon database or branch must be
placed in ignored `.env.production`; never reuse or copy the development data.

Every data-changing script requires an explicit target, checks the persistent
`deployment_environment` marker before writing, and prints actual row counts
after success or partial failure. Production commands additionally refuse to run
unless `--confirm-production` is supplied by the operator.

## Development

Initialize the current development database once:

```sh
npm run db:environment:init:dev
```

Verify it at any time:

```sh
npm run db:verify:dev
```

Use only commands ending in `:dev` for development migrations, imports, and
seeds. The fabricated battle-vote seed exists only as `db:seed:votes:dev`.

## Fresh production database

1. Provision a separate Neon database or branch without copying data.
2. Put only its connection string and production secrets in `.env.production`.
3. Initialize and mark the empty target with an explicit confirmation:

```sh
npm run db:environment:init:prod -- --confirm-production
```

4. Create the canonical schema:

```sh
npm run db:migrate:fresh:prod -- --confirm-production
```

5. Apply later production migrations individually with the same confirmation
   flag, then seed only curated goats/battles:

```sh
npm run db:seed:prod -- --confirm-production
npm run db:verify:prod -- --confirm-production
```

Do not run the historical incremental migrations on a fresh production target;
they exist only to upgrade older databases. Never run the fabricated vote seed
or the legacy API-Football demo importer against production.
