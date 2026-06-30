# GOATSBattle — Build TODO

Tracking the build of GOATSBattle (goatsbattle.com): a global GOAT-debate platform
with stat-rich entity profiles, dynamic 1v1 battles, community voting, live Elo
rankings, and a paid data API.

Launch scope: **Football only** — Messi, Ronaldo, Pelé, Maradona, Zidane,
Ronaldinho, Mbappé, Neymar, Cruyff, Beckenbauer (10 entities → 45 battle combos).

Legend: `[x]` done · `[~]` in progress · `[ ]` not started

---

## Phase 0 — Project foundation
- [x] Astro 7 project scaffolded
- [x] Tailwind CSS v4 wired up (`@tailwindcss/vite`, `global.css`)
- [x] Base `Layout.astro` + global styles
- [x] Add `@astrojs/vercel` adapter (static-first; pages opt into SSR)
- [x] Document env vars (`.env.example`: `DATABASE_URL`, `IP_HASH_SALT`)

## Phase 1 — Static content layer (mostly done)
- [x] Football entity dataset (`src/data/football.ts`, 10 entities w/ stat sections)
- [x] Shared types (`src/lib/types.ts`)
- [x] Canonical battle-slug logic (alphabetical `a-vs-b`, `src/lib/battle.ts`)
- [x] Static battle pages `/battle/[slug]` — stat comparison + SEO meta
- [x] Player profile pages `/player/[slug]`
- [x] Homepage `/`
- [x] Card-based battle comparison view (stat scoreline + per-stat leader + versus bars)
- [x] Polish homepage: trending / most-voted / closest-battles sections (SSR, DB-backed, curated fallback) + `/category/football` discovery page
- [x] Shared comparison UI (radar charts, trophy timeline) on battle pages
- [x] Open Graph / share-image generation per battle (satori + resvg, static PNG per battle, og/twitter meta)

## Phase 2 — Database & data layer
- [x] Add Drizzle ORM + define schema (`entities`, `battles`, `votes`, `elo_history`)
- [x] Unique constraint on `(ip_hash, battle_id)` for anti-spam
- [x] Seed script: load football entities + 45 battle rows into DB (`scripts/seed.ts`)
- [x] DB client helper for SSR routes (`src/lib/db/index.ts`)
- [x] Drizzle config + npm scripts (`db:generate/push/seed/studio`)
- [x] Provision Neon project + set `DATABASE_URL` → ran `db:push` then `db:seed` (10 entities, 45 battles live)

## Phase 3 — Voting system
- [x] Vote API endpoint (`POST /api/vote`) + `GET /api/results` for live tallies
- [x] SHA-256 IP-hash w/ server salt (GDPR-safe dedupe) — `src/lib/ip.ts`
- [x] Rate limiting / basic bot mitigation — `src/lib/ratelimit.ts` (sliding window) + unique `(ip_hash, battle_id)` DB constraint
- [x] `VoteWidget` Preact island (optimistic UI, live % results, rollback on error)
- [x] Wire VoteWidget into battle pages
- [x] Capture `x-vercel-ip-country` per vote → stored on each vote row

## Phase 4 — Rankings (Elo)
- [ ] Elo engine (K=32, seed 1500) shared by both entry points
- [ ] Update Elo transactionally on each vote
- [ ] Rankings page `/rankings` (SSR, live leaderboard)
- [ ] Per-entity rank + record on player profiles

## Phase 5 — Champion Mode
- [ ] `/play` route — pick your GOAT, fight opponents one by one
- [ ] Random-opponent draw logic (reuses same vote API + Elo)
- [ ] `ChampionMode` Preact island (streak, progression UI)

## Phase 6 — Discovery & engagement
- [ ] `Search` Preact island (find entities & battles)
- [ ] Country-level support heatmap on battle pages
- [ ] "Why people voted" / argument capture (optional, later)
- [ ] Entity-suggestion form (suggest only — no direct creation)

## Phase 7 — SaaS API (monetization)
- [ ] Public read API (`GET /api/compare/:a/:b`, rankings)
- [ ] API keys + tiered access (free / pro / enterprise)
- [ ] Pro features: bulk export (CSV), ranking history, chart/PNG export
- [ ] Usage metering + rate limits per tier

## Phase 8 — Launch
- [ ] SEO pass: sitemap, structured data, canonical tags across 45 battle pages
- [ ] Analytics
- [ ] Deploy to Vercel on goatsbattle.com
- [ ] Pre-launch QA (vote integrity, mobile, share images)
