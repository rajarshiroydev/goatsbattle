# Release workflow

This repository uses three intentionally distinct environments. They must share application
behavior and schema contracts, but they must not share production data merely for visual parity.

| Environment | Purpose | Data and identity |
| --- | --- | --- |
| Localhost | Fast development when Astro dev is usable | Uses `.env`; currently the development Neon database |
| Preview | Test a committed release candidate on Cloudflare | Uses `.dev.vars.preview`; intentionally shares the development Neon database with localhost |
| Production | Public application | Uses `.env.production` and a separate production Neon database |

Preview and production use different Worker names, Better Auth secrets and base URLs, Neon
databases, KV namespaces, cookies/sessions, user rows, comments, votes, moments, timeline state,
and Durable Object state. They currently use the same Google OAuth client and TheStatsAPI key.
Do not run preview/development provider jobs concurrently with production polling.

There are no R2, D1, or Queue bindings. Better Auth stores users and sessions in Postgres; the
adapter-provided `SESSION` KV binding is separate per environment and is not the auth database.
Only production has the custom domains and every-minute cron.

## Approved sequence

1. Work on a feature branch. Commit and push the candidate; never release an arbitrary working
   tree. Open a pull request and require the `CI / validate` check.
2. Apply new idempotent migrations to the development database, then run `npm run db:verify:dev`.
   Migrations must be backward-compatible because database rollback is separate from Worker
   rollback.
3. Deploy the committed candidate with `npm run worker:deploy:preview`. The command runs the full
   release checks, verifies the generated preview bindings, and stamps the Git commit and tree in
   Cloudflare's version metadata and `/api/version`.
4. Record the preview Worker version ID. Test auth, comments, votes, moments, live status, mobile
   UI, headers, and the changed feature on preview-specific data. Confirm
   `https://goatsbattle-preview.roystark.workers.dev/api/version` reports the expected Git tree.
5. Merge the reviewed PR to `main`. If the merge/squash changes the Git tree, redeploy `main` to
   preview and repeat verification. A different commit SHA is acceptable only when its Git tree
   is identical to the tested preview tree.
6. Before production, verify `main == origin/main`, record the active production Worker version,
   inspect production counts with `npm run db:verify:prod`, and apply only the reviewed,
   backward-compatible production migrations with their explicit `--confirm-production` gates.
7. Promote with:

   ```sh
   npm run worker:deploy:production -- \
     --preview-version=<tested-preview-version-id> \
     --confirm-production
   ```

   The command refuses a dirty tree, a non-`main` branch, a stale `origin/main`, an inactive
   preview version, or a preview version whose recorded Git tree differs from production HEAD.
8. Verify `https://goatsbattle.com/api/version`, smoke-test the public routes, and inspect logs.

Deployments are manual. Pushing or merging `main` runs CI but does not deploy either Worker.
Cloudflare dashboard edits are not part of the approved release path; keep `wrangler.jsonc` and
the ignored secrets files as the deployment sources of truth.

`release-worker.mjs` enforces that a preview candidate comes from a clean, fully committed tree.
Pushing that commit and opening a pull request are procedural release policy enforced by review,
not checks performed by the preview deployment script. Production promotion adds stricter branch,
remote, and tested-preview checks.

## Version inspection and rollback

Inspect active deployments and their Git metadata:

```sh
npx wrangler deployments status --name goatsbattle-preview --json
npx wrangler versions list --name goatsbattle-preview --json
npx wrangler deployments status --name goatsbattle --json
npx wrangler versions list --name goatsbattle --json
```

If runtime checks fail, roll the Worker back to the version recorded before deployment:

```sh
npx wrangler rollback <previous-production-version-id> \
  --name goatsbattle \
  --message "rollback after failed smoke test"
```

Rollback changes Worker code/configuration immediately but does not undo Postgres writes,
migrations, KV contents, or Durable Object storage. Keep migrations additive so the previous
Worker remains compatible; handle any database repair as a separate, explicitly reviewed action.

### Durable Object migration exception

The current realtime branch introduces `v1-live-match-coordination`, the first SQLite Durable
Object migration. The active preview and production versions inspected before this workflow was
added did not yet have those Durable Object bindings. Cloudflare can refuse rollback to a version
on the other side of a Durable Object migration. Treat the first production rollout as a
forward-fix release: validate the migration on preview, keep the old application code compatible
with the additive Postgres schema, and do not promise that the pre-migration Worker version can be
restored. After the migration exists in successive production versions, normal Worker-version
rollback applies within that migration state.
