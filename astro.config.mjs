// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

import vercel from '@astrojs/vercel';

import preact from '@astrojs/preact';

// https://astro.build/config
export default defineConfig({
  site: 'https://goatsbattle.com',

  vite: {
    plugins: [tailwindcss()],
  },

  adapter: vercel(),
  integrations: [preact()],
});