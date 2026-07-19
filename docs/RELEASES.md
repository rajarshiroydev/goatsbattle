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
4. Record the preview Worker version ID. The guarded preview command automatically runs the
   read-only API/browser gate in `npm run test:feature:preview`; any failure means the candidate is
   not ready. Run the applicable disposable-data and authenticated smokes from
   [FEATURE-TESTING.md](FEATURE-TESTING.md), including auth, comments, votes, moments, live status,
   mobile UI and the changed feature. Confirm `/api/version` reports the expected Git tree.
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
   It also reruns the read-only preview feature gate before changing production.
8. Verify `https://goatsbattle.com/api/version`, smoke-test the public routes, and inspect logs.

Deployments are manual. Pushing or merging `main` runs CI but does not deploy either Worker.
Cloudflare dashboard edits are not part of the approved release path; keep `wrangler.jsonc` and
the ignored secrets files as the deployment sources of truth.

`release-worker.mjs` enforces that a preview candidate comes from a clean, fully committed tree.
Pushing that commit and opening a pull request are procedural release policy enforced by review,
not checks performed by the preview deployment script. Production promotion adds stricter branch,
remote, and tested-preview checks.

## Repository and production protections

The active GitHub `Protect Main` ruleset targets the default branch and has no bypass actors. It
blocks deletion and force-pushes, requires a pull request with resolved review threads, and requires
the strict `validate` status check before merge. Branch protection controls what enters `main`; it
does not authorize or technically prevent a Cloudflare deployment made with separate Cloudflare
credentials.

Production credentials remain restricted to the trusted manual release path. Agents must receive
explicit user approval for each production deployment, must use the guarded production command
above, and must never substitute raw Wrangler or dashboard deployment commands. A failed release
guard is a stop condition, not permission to work around it. Production secrets, Wrangler auth, and
Cloudflare API tokens must never be printed, committed, shared, or granted to another collaborator
or automation as part of ordinary work.

Move production deployment to a protected GitHub Actions `production` environment when another
actor or automation needs deploy access, deployments become frequent enough to make the manual
boundary fragile, approval/audit separation is required, or an accidental/raw production deploy
occurs. At that point, restrict the environment to protected `main`, store a least-privilege
Cloudflare token only in that environment, require explicit approval (with self-approval disabled
once a second trusted reviewer exists), and retire ordinary local production-deploy credentials.

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

`v1-live-match-coordination`, the first SQLite Durable Object migration, was applied to preview and
production on 2026-07-17. The first production version on that migration state is
`800c38f2-78ad-4d83-a938-7301ec4cd920`; the recorded pre-migration production version is
`331a1378-b2bd-4f9e-ae51-800e2be432c0`.

Cloudflare can refuse rollback across this boundary, so do not promise that the pre-migration
version can be restored. Use a forward fix for any issue that would require crossing back before
`v1-live-match-coordination`. Normal Worker-version rollback applies between successive production
versions that already share this migration state. Postgres, KV, and Durable Object data still need
separate recovery decisions.
