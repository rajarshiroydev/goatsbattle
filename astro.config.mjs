// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

import vercel from '@astrojs/vercel';

import preact from '@astrojs/preact';

// https://astro.build/config
export default defineConfig({
  site: 'https://goatsbattle.com',

  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' https: data:",
        "connect-src 'self'",
      ],
      scriptDirective: { resources: ["'self'"] },
      styleDirective: { resources: ["'self'", 'https://fonts.googleapis.com'] },
    },
  },

  vite: {
    plugins: [tailwindcss()],
  },

  adapter: vercel(),
  integrations: [preact()],
});
