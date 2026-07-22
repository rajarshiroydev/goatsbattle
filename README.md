# GOATSBattle

GOATSBattle is a live sports discussion, voting, and watch-along platform built to make following a match feel like one connected experience. Instead of moving between a score app, a creator stream, social media, and a stats site, fans can follow the action, debate key moments, cite athlete statistics, and vote on greatness in one place.

The production site is available at [goatsbattle.com](https://goatsbattle.com).

**OpenAI Build Week track:** Apps for Your Life

## Inspiration

Sports conversations are spread across Reddit, Discord, X, YouTube, live-score apps, and private group chats. Each platform solves one part of the experience, but fans still jump between them to watch, understand, and discuss the same match.

GOATSBattle started with a simple idea: give every match one organized home where live context and fan opinion belong together. Discussions become easier to follow when comments can cite a match moment or a real athlete statistic instead of losing context in a fast-moving feed.

## What it does

Today, GOATSBattle provides:

- Live World Cup scores, match status, timelines, and dedicated discussion threads
- Match-moment and athlete-stat tagging for more focused, data-rich arguments
- Head-to-head GOAT battles, profile votes, and community rankings
- Google-authenticated comments, replies, upvotes, and fan identity signals
- Real-time match coordination and discussion updates at the edge

The broader product vision also includes synchronized creator watch-alongs, conversation summaries, and flexible chat surfaces. The goal is to let a fan watch a favourite creator, follow reliable match data, and join the wider debate without manually keeping several sites in sync.

## How we built it

The application uses Astro and TypeScript with Preact islands for interactive experiences and Tailwind CSS for the Stadium Gate design system. It runs on Cloudflare Workers, while Durable Objects coordinate live-match polling, alarms, and WebSocket updates. Neon PostgreSQL stores accounts, votes, discussions, match data, and citations; Drizzle ORM provides the typed data layer. Better Auth handles Google sign-in, and TheStatsAPI supplies World Cup data.

Codex running GPT-5.6 Sol was used as an architecture and engineering partner throughout Build Week. It helped turn product goals into system boundaries, compare implementation options, review code, diagnose failures, write tests, and operate the guarded preview-to-production release process. Design choices were discussed first and then validated through tests and deployed checks rather than treated as code-generation decisions alone.

GPT-5.6 Sol is part of the development workflow, not a runtime chatbot or an OpenAI API dependency inside the product. Its meaningful contribution is visible in the architecture, implementation, review, and verification of the application described below.

See [STACK.md](STACK.md) for the complete runtime, service, dependency, and tooling inventory.

## Build Week work and Codex contribution

GOATSBattle existed before the hackathon: the repository's [initial commit](https://github.com/rajarshiroydev/goatsbattle/commit/786415a) is dated June 29, 2026. The earlier version established the GOAT comparison, voting, profile, ranking, authentication, and discussion foundations.

During the Submission Period, the project was meaningfully extended with Codex and GPT-5.6 Sol. The new work included:

- The World Cup hub, match pages, live scores, structured moments, and match discussions
- Durable Object ownership of live matches, scheduled polling, alarms, WebSocket fan-out, retries, and provider-wide rate limiting
- Mutable timeline reconciliation for late events, VAR reversals, incomplete feeds, finalization, and post-match corrections
- Data-rich comment citations using match moments and reviewed athlete statistics
- Safer authentication, database targeting, protected pull requests, deterministic provider simulation, preview verification, and guarded production promotion

Codex was especially valuable when the first working solution was not reliable enough. It helped identify that provider timelines behave like mutable snapshots rather than append-only logs, design a Durable Object coordinator so cron and live polling would not race, and separate network waiting from actual Worker CPU when evaluating Cloudflare limits. It also reviewed each release candidate, converted production failures into regression tests and shared engineering gotchas, and verified the exact Git tree across preview and production.

Evidence is available in the public [commit history](https://github.com/rajarshiroydev/goatsbattle/commits/main/) and merged pull requests, including the [World Cup launch foundation](https://github.com/rajarshiroydev/goatsbattle/pull/11), [real-time match coordinator](https://github.com/rajarshiroydev/goatsbattle/pull/20), [deployed-preview release gates](https://github.com/rajarshiroydev/goatsbattle/pull/26), and [deterministic provider lifecycle simulator](https://github.com/rajarshiroydev/goatsbattle/pull/27). The primary Codex `/feedback` Session ID is supplied separately in the Devpost submission, as required.

## Run the project locally

### Requirements

- Node.js 22.12 or newer
- npm
- A development Neon database
- Local development credentials for the services you want to exercise

Install dependencies and create your local environment file:

```sh
npm install
cp .env.example .env
```

Fill `.env` with development values only. Do not reuse production credentials. Database setup, migrations, seeds, and environment verification are documented in [DATABASE-OPERATIONS.md](DATABASE-OPERATIONS.md).

For a fresh development database, initialize its safety marker, create the schema, load the curated GOAT and battle sample data, and verify the resulting rows:

```sh
npm run db:environment:init:dev
npm run db:migrate:fresh:dev
npm run db:seed:dev
npm run db:verify:dev
```

The hosted demo is already populated, so judges do not need to import sample data. Live World Cup imports require a TheStatsAPI key and consume provider quota; they are optional for local evaluation and should only be run using the guarded development commands in the database guide.

Start Astro in background mode:

```sh
npm run dev -- --background
```

The app is normally available at `http://localhost:4321`. Manage the background server with:

```sh
npm run astro -- dev status
npm run astro -- dev logs
npm run astro -- dev stop
```

Run the main validation suite before submitting changes:

```sh
npm run typecheck
npm test
npm run test:feature:stats-api
npm run test:worker
```

Server-only secrets are read from the Cloudflare Workers runtime in deployed environments. During local development, the serve-only Vite shim maps those values from `.env`. Public build-time configuration uses static `PUBLIC_*` variables. Release and deployment instructions live in [docs/RELEASES.md](docs/RELEASES.md).

## How judges can test it

The fastest path is the public production deployment at [goatsbattle.com](https://goatsbattle.com); no rebuild or test account is required for the public experience.

1. Open **World Cup**, which defaults to completed matches, then open a match to inspect the score, structured moments, athlete-stat context, and discussion surface.
2. Open **Face Off** to compare two GOATs, then visit an athlete profile and the arena rankings to see how profile and head-to-head votes feed the wider community view.
3. Browse **Floor** to see discussions organized around matches and debates rather than an isolated social feed.
4. Sign in with Google to cast a vote or post a comment with match-moment and athlete-stat tags. Public browsing works without authentication; mutations require a real account, so no shared credentials are published.

For deterministic technical verification without calling the live sports provider, run `npm run release:check`. It exercises unit and contract tests, the complete simulated provider lifecycle, and Worker/Durable Object behavior. More detailed manual and deployed checks are listed in [docs/FEATURE-TESTING.md](docs/FEATURE-TESTING.md).

## Challenges we ran into

The hardest problem was making real-time sports discussion reliable at the edge. Match events can arrive late, change after review, or briefly disagree with the score feed. At the same time, WebSocket clients need a consistent view without overloading the data provider or database.

Durable Objects became the coordination layer: they own match polling windows, durable alarms, correction retries, and live fan-out. The application also treats provider timelines as mutable snapshots so corrections and VAR decisions do not leave ghost events behind.

## Accomplishments we are proud of

GOATSBattle became a production-ready foundation for a broader sports social platform in roughly a week. It combines voting, rankings, live match context, structured discussion, and real-time infrastructure while keeping preview checks, database safety, protected pull requests, and guarded production releases part of the normal workflow.

## What we learned

Building a production application requires more than making features work once. Architecture, failure handling, security boundaries, test coverage, observability, and deployment discipline matter just as much as the visible product. Pairing closely with Codex made those decisions easier to examine and helped turn an ambitious first build into a system that could be tested and operated with confidence.

## What is next

The next steps are to expand beyond football, build synchronized creator watch-alongs, improve personalized discovery and conversation summaries, and eventually launch mobile apps. The long-term aim is for GOATSBattle to become the place fans open when they want the complete live sports conversation—not another isolated feed.

## Project references

- [AGENTS.md](AGENTS.md) — framework conventions, safety rules, and hard-won engineering lessons
- [STACK.md](STACK.md) — architecture and external-service inventory
- [docs/FEATURE-TESTING.md](docs/FEATURE-TESTING.md) — feature and promotion coverage
- [docs/RELEASES.md](docs/RELEASES.md) — preview and production release process
- [DATABASE-OPERATIONS.md](DATABASE-OPERATIONS.md) — database setup, migrations, and recovery
