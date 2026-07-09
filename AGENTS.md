## Tech Stack / Framework Conventions
This is an Astro project using Preact islands. Never use string-based inline event handlers; use proper Preact event handlers (onClick, etc.) so island hydration works.

## Environment / Config section
Access environment variables (e.g. DATABASE_URL) directly via import.meta.env.VAR and never through optional chaining or dynamic access, since Vite's static replacement won't apply and the value will be undefined at runtime.

## Database section
After running any DB seed or cleanup script, verify the actual DB state (row counts, no leftover test users/comments/aggregates) before reporting success; inline cleanup scripts have silently errored before.

## Domain / Naming Conventions section
The canonical domain terms are 'arena' (not 'category') and 'goats' with URLs /goats/<slug> and /rankings/<arena>; use these consistently across routes, links, and data.

## UI / Styling Conventions section
Pages should use consistent width max-w-7xl and share the common PageHeader component for navbar active-tab highlighting; keep sibling pages visually consistent.

## Shell / Scripting section
When writing shell rename/loop scripts in zsh, always quote variables and use explicit loops — unquoted variables do not word-split as in bash and sed renames can fail silently.

## Development
When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
