import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

// Astro statically replaces these server-side import.meta.env reads during the build;
// they do not need PUBLIC_ prefixes and are not runtime Worker secrets.
const gitSha = import.meta.env.RELEASE_SHA || 'unversioned';
const gitTree = import.meta.env.RELEASE_TREE || 'unversioned';

export const GET: APIRoute = () => Response.json({
  environment: env.APP_ENV ?? 'local',
  gitSha,
  gitTree,
}, {
  headers: { 'Cache-Control': 'no-store' },
});
