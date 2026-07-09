#!/usr/bin/env node
// Screenshot one or more routes of the running dev server with Playwright.
//
// Usage:
//   node scripts/shot.mjs [route...] [--mobile] [--out <dir>] [--base <url>]
//
// Examples:
//   node scripts/shot.mjs /                       -> screenshots/home.png
//   node scripts/shot.mjs /rankings/cricket       -> screenshots/rankings-cricket.png
//   node scripts/shot.mjs / /goats --mobile       -> mobile viewport
//
// Requires the dev server running (astro dev --background). Defaults to
// http://localhost:4321 unless --base or the BASE_URL env var overrides it.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
};

const mobile = args.includes('--mobile');
const outDir = resolve(flag('--out') ?? 'screenshots');
const base = (flag('--base') ?? process.env.BASE_URL ?? 'http://localhost:4321').replace(/\/$/, '');

// Routes are the positional args (everything not a flag or a flag's value).
const consumed = new Set();
for (const name of ['--out', '--base']) {
  const i = args.indexOf(name);
  if (i !== -1) consumed.add(i).add(i + 1);
}
const routes = args.filter((a, i) => !a.startsWith('--') && !consumed.has(i));
if (routes.length === 0) routes.push('/');

const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 };
const slug = (r) => (r === '/' ? 'home' : r.replace(/^\//, '').replace(/\//g, '-').replace(/[^\w-]/g, '') || 'home');

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport });

for (const route of routes) {
  const url = `${base}${route.startsWith('/') ? route : `/${route}`}`;
  const out = resolve(outDir, `${slug(route)}${mobile ? '-mobile' : ''}.png`);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.screenshot({ path: out, fullPage: true });
  console.log(`✓ ${url} -> ${out}`);
}

await browser.close();
