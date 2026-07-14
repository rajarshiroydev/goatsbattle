// @ts-check
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';

import preact from '@astrojs/preact';

/**
 * Dev-only shim for the `cloudflare:workers` virtual module.
 *
 * In the deployed Worker, `import { env } from 'cloudflare:workers'` reads the
 * encrypted runtime secrets (and keeps them out of the bundle). That module only
 * exists inside workerd, so under `astro dev` (plain Node) the import throws
 * "Cannot find module 'cloudflare:workers'" and every DB-backed SSR route 500s.
 *
 * `apply: 'serve'` scopes this to the dev server only — the Worker build still
 * uses the real virtual module. We back `env` with the local `.env` (loaded into
 * process.env) so `env.DATABASE_URL`, `env.BETTER_AUTH_*`, `env.IP_HASH_SALT`,
 * etc. resolve the same way they did before the Cloudflare port.
 *
 * @returns {import('vite').Plugin}
 */
function cloudflareWorkersDevShim() {
  const VIRTUAL = 'cloudflare:workers';
  const RESOLVED = '\0cloudflare:workers';
  return {
    name: 'cloudflare-workers-dev-shim',
    apply: 'serve',
    enforce: 'pre',
    config() {
      // '' prefix loads unprefixed vars (DATABASE_URL, secrets) too.
      const loaded = loadEnv('development', process.cwd(), '');
      for (const [key, value] of Object.entries(loaded)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
    },
    resolveId(id) {
      if (id === VIRTUAL) return RESOLVED;
    },
    load(id) {
      if (id === RESOLVED) {
        return `export const env = new Proxy({}, {
          get: (_target, key) => (typeof key === 'string' ? process.env[key] : undefined),
        });`;
      }
    },
  };
}

// https://astro.build/config
export default defineConfig({
  site: 'https://goatsbattle.com',

  security: {
    checkOrigin: true,
    csp: {
      directives: [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' https: data:",
        "connect-src 'self' https://cloudflareinsights.com",
      ],
      scriptDirective: { resources: ["'self'", 'https://static.cloudflareinsights.com'] },
      // Astro hashes emitted stylesheets. Interactive islands separately need
      // style-src-attr above for computed transforms, percentages, and colours.
      styleDirective: { resources: ["'self'", 'https://fonts.googleapis.com'] },
    },
  },

  vite: {
    plugins: [cloudflareWorkersDevShim(), tailwindcss()],
    // Pre-bundle every Preact entrypoint in one dep-optimize pass. Otherwise
    // Vite can optimize `preact` (for the island bootstrap) and `preact/hooks`
    // (discovered later, when a component hydrates) into two separate
    // generations, loading two Preact instances → `Cannot read properties of
    // undefined (reading '__H')` on hydration. Dev-only; the build is unaffected.
    optimizeDeps: {
      include: ['preact', 'preact/hooks', 'preact/jsx-runtime', 'preact/compat', 'preact/debug'],
    },
    // Force a single Preact instance across the module graph. Without this, a
    // dep re-optimization (e.g. after a config change) can serve two Preact
    // generations at once, producing the `__H` hydration crash that blanks
    // client-rendered islands like FloorFeed.
    resolve: {
      dedupe: ['preact', 'preact/hooks', 'preact/jsx-runtime', 'preact/compat'],
    },
  },

  adapter: cloudflare({
    // OG images are static build artifacts and depend on Node-only font/file
    // tooling. All on-demand routes still execute in workerd.
    prerenderEnvironment: 'node',
    // The application serves checked-in/static images; do not provision the
    // paid Cloudflare Images transformation binding for the launch spike.
    imageService: 'passthrough',
  }),
  integrations: [preact()],
});
