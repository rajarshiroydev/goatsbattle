GOATSBattle release history:

## 2026-07-17 — Realtime live-match release

First deployed to `goatsbattle-preview` from commit
`2f2c66460be8e4c7656ee22e544951601bb3f45c` (tree
`379c356f1c1ed43f585d78774a30b792e92a6b85`) as Cloudflare Worker version
`caf53878-267f-4c17-b846-00e013d38990`. PR #21 then merged through protected `main` as commit
`d02e7d0b5a4a5bfd1240a3aef62185c047e7ee8f` with the identical Git tree and was promoted to
production as Worker version `800c38f2-78ad-4d83-a938-7301ec4cd920`.

### Live-match experience

- Added Cloudflare Durable Object coordination and WebSocket delivery for realtime match state.
- Kept REST and WebSocket clients on the same live-clock derivation and recalibration behavior.
- Fixed clocks freezing at the most recent event by anchoring elapsed time to the first observation
  of a timeline snapshot hash rather than the provider heartbeat timestamp.
- Added stale-phase protection while allowing trusted timeline corrections.

### Provisional startup clock

- Added a clearly approximate clock when the provider reports `live` before timeline events arrive.
- Marked provisional clocks with `approximate: true` and rendered them with an `Est.` treatment.
- Expired the estimate after ten minutes so an empty or recurring timeline cannot create a bogus
  long-running stoppage-time clock.
- Ensured the first real timeline anchor replaces a provisional clock in either direction, while a
  provisional response can never replace an established real clock.
- Applied the same rules to the World Cup status API and the realtime publish path.

### Provider and Worker coordination

- Added `LiveMatchCoordinator` and `StatsApiRequestBroker` Durable Object bindings and their first
  SQLite migration.
- Kept preview and production Durable Object state isolated.
- Added generated-config checks that verify Worker identity, routes, cron, KV bindings, Durable
  Object binding-to-class mappings, migrations, and release feature flags.

### Release safety and observability

- Added guarded preview and production release commands with clean-tree, branch, remote, active
  preview, and tested-tree checks.
- Embedded the Git commit and tree in Worker releases and exposed them through `/api/version`.
- Added GitHub CI for TypeScript, Node tests, Worker tests, and environment-specific Worker builds.
- Documented preview-to-production promotion, verification, and rollback behavior.
- Hardened the reviewed implementation against malformed timeline events, stale phase transitions,
  persisted checkout credentials, and miswired Durable Object classes.

### Main branch protection

- Enabled the active GitHub `Protect Main` ruleset for the default branch.
- Configured no bypass actors.
- Blocked deletion and force-pushes.
- Required pull requests, resolved review threads, the `validate` status check, and an up-to-date
  branch before merge.
- Recorded that GitHub branch protection does not replace the separate Cloudflare production
  credential boundary: production still requires explicit approval and the guarded release command.

### Production promotion

- Verified the production Neon environment and row counts without modifying production data.
- Re-ran TypeScript, 40 Node tests, 8 Worker tests, and the environment-specific Worker build.
- Activated production at 100% with the exact Git tree tested on preview.
- Verified `/api/version`, the affected match page, custom domains, production KV, both Durable
  Objects, their SQLite migration, and the every-minute scheduled handler.
- Observed successful production requests and a successful cron execution with no Worker
  exceptions during the post-deploy log tail.
- Recorded `331a1378-b2bd-4f9e-ae51-800e2be432c0` as the pre-release version, while noting that the
  first Durable Object migration can prevent rollback across that boundary and may require a
  forward fix.

### Scope notes

- The experimental localhost dependency-optimizer work was reverted and is not part of this
  preview release.
- Preview retains isolated development data and has no production cron; code parity does not imply
  shared users, sessions, comments, moments, or match state.
