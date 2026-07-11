# Demo Data — Production Cleanup Tracker

Features currently populated with **fabricated demo data** so the UI looks alive
pre-launch. Before real traffic arrives (or shortly after), each of these should
be reset or reconsidered so users only ever see real numbers.

Status legend: 🔴 still demo · 🟡 needs decision · 🟢 resolved

| # | Feature | Where | What's fake | Action before prod |
|---|---------|-------|-------------|--------------------|
| 1 | Head-to-Head Record (per-goat profile) + rankings 1v1 popover | `scripts/seed-battle-votes.ts` → `battles.votesA/votesB` | Head-to-head vote tallies (totals 150–5000, hashed splits) on all 90 canonical battle pairings | 🔴 Reset tallies to 0/0 before launch, or keep as seed and let real votes accrue. Script only fills 0/0 rows, so real votes are safe either way. |
| 2 | Head-to-Head Record — demo split votes | Cast via `/api/vote` (real ledger + tallies) on `messi-vs-ronaldo`, `mbappe-vs-messi`, `cruyff-vs-messi` | A few opponent votes added so those bars render a genuine two-colour split (75/25, 67/33) instead of shutouts — used to demo the split bar | 🔴 **Must reset** with the SQL below before launch (these are fabricated demos, not organic votes). Mark 🟢 once removed. |
| 3 | The Floor — match events + timelines (GBT-7) | `scripts/sync-matches.ts` → `matches` / `match_moments` / `match_goats` | Real data, but a **curated 5-match subset** of the 2022 World Cup knockouts (the matches our tracked goats played in) — not the full fixture list. Free tier = 100 req/day + seasons 2022–2024 only (WC 2026 is 403), so it's a deliberate slice. | 🟡 Before launch, decide the real coverage (more WC 2022 matches, or a paid plan for current seasons) and expand `FIXTURE_IDS` in `scripts/sync-matches.ts`. Re-run `npm run db:sync:matches` (idempotent). |

## How to reset an item

Battle vote tallies (#1):

```sql
-- Wipe all head-to-head tallies back to zero
UPDATE battles SET votes_a = 0, votes_b = 0;
```

Or add a `--reset` path to `scripts/seed-battle-votes.ts` if you want it scripted.

Demo split votes (#2) — remove the ledger rows so the tallies don't re-accrue
from the fabricated votes, then recompute the affected aggregates:

```sql
-- The demo split votes were cast on these three matchups
DELETE FROM votes
WHERE battle_id IN ('messi-vs-ronaldo', 'mbappe-vs-messi', 'cruyff-vs-messi')
  AND user_id IS NULL; -- demo votes predate accounts (no user attribution)
-- Then re-zero / recompute tallies (the UPDATE above already zeroes battles).
```

Synced match events (#3) — everything comes from `scripts/sync-matches.ts`
(externalId is non-null on synced rows). The FK cascade on
`match_moments`/`match_goats` clears the children automatically; comments left on
a match are removed first so the FK holds:

```sql
DELETE FROM comments WHERE match_id IN (SELECT id FROM matches WHERE external_id IS NOT NULL);
DELETE FROM matches WHERE external_id IS NOT NULL; -- cascades to moments + goats
```

## When adding new demo data

Any time you seed, hardcode, or fabricate values to make a feature look
populated, **add a row to the table above** with: what's fake, where it lives,
and how to undo it. Keep this file the single source of truth for "what's not
real yet."
