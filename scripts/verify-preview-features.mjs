#!/usr/bin/env node
/** Read-only feature verification for the active preview Worker. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const base = new URL(process.env.PREVIEW_BASE_URL ?? 'https://goatsbattle-preview.roystark.workers.dev');
const allowedHost = base.hostname === 'goatsbattle-preview.roystark.workers.dev'
  || base.hostname === 'localhost'
  || base.hostname === '127.0.0.1';
if (!allowedHost) throw new Error(`Refusing to run preview verification against ${base.hostname}.`);

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const expectedSha = process.env.EXPECTED_GIT_SHA ?? git('rev-parse', 'HEAD');
const expectedTree = process.env.EXPECTED_GIT_TREE ?? git('rev-parse', 'HEAD^{tree}');
const allowEquivalentSha = process.env.ALLOW_EQUIVALENT_PREVIEW_SHA === 'true';
const matchId = process.env.FEATURE_MATCH_ID ?? 'world-cup-2026-match-101';
const canonicalMatchPath = `/floor/${matchId}/`;
const unique = () => `${Date.now()}-${crypto.randomUUID()}`;
const ignoredConsoleErrors = [
  "The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.",
];

async function get(path) {
  const url = new URL(path, base);
  url.searchParams.set('feature_verify', unique());
  return fetch(url, { redirect: 'follow', headers: { 'Cache-Control': 'no-cache' } });
}

async function json(path) {
  const response = await get(path);
  assert.equal(response.status, 200, `${path} returned ${response.status}`);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  return response.json();
}

const version = await json('/api/version');
assert.equal(version.environment, 'preview');
if (!allowEquivalentSha) {
  assert.equal(version.gitSha, expectedSha, 'preview Git SHA does not match the tested checkout');
}
assert.equal(version.gitTree, expectedTree, 'preview Git tree does not match the tested checkout');
console.log(`✓ Preview version ${version.gitSha} matches tested tree ${expectedTree}.`);

const routes = ['/', '/floor/', '/world-cup/', canonicalMatchPath, '/goats/messi/', '/rankings/football/'];
for (const route of routes) {
  const response = await get(route);
  assert.equal(response.status, 200, `${route} returned ${response.status}`);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  if (route === '/') {
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  }
}
console.log(`✓ ${routes.length} public routes and security headers are healthy.`);

const worldCup = await json('/api/world-cup-status');
assert.ok(Array.isArray(worldCup.matches));
const featured = worldCup.matches.find((match) => match.id === matchId);
assert.ok(featured, `${matchId} is missing from the World Cup status feed`);
assert.equal(featured.status, 'finished', `${matchId} is not finished in preview data`);
assert.equal(typeof featured.homeScore, 'number');
assert.equal(typeof featured.awayScore, 'number');
assert.ok(!/^Winner |^Loser /.test(featured.homeTeam));
assert.ok(!/^Winner |^Loser /.test(featured.awayTeam));
const final = worldCup.matches.find((match) => match.id === 'world-cup-2026-match-104');
assert.ok(final, 'World Cup final is missing from the status feed');
assert.ok(!/^Winner |^Loser /.test(final.homeTeam));
assert.ok(!/^Winner |^Loser /.test(final.awayTeam));
console.log('✓ World Cup result and resolved knockout identities are ready.');

const momentFeed = await json(`/api/match-moments?match=${encodeURIComponent(matchId)}`);
assert.equal(momentFeed.liveEnabled, true);
assert.equal(momentFeed.matchStatus, 'finished');
assert.ok(Array.isArray(momentFeed.moments) && momentFeed.moments.length > 0,
  `${matchId} has no materialized preview moments`);
assert.ok(momentFeed.moments.every((moment) => Number.isInteger(moment.minute) && moment.minute >= 0));
assert.ok(momentFeed.moments.every((moment) => moment.team === 'home' || moment.team === 'away'));
assert.ok(momentFeed.moments.every((moment) => moment.verificationStatus === 'active'
  || moment.verificationStatus === 'corrected'));
console.log(`✓ Match-moment API exposes ${momentFeed.moments.length} validated events.`);

const comments = await json(`/api/comments?match=${encodeURIComponent(matchId)}`);
assert.ok(Array.isArray(comments.comments), 'comment API response is missing its comments array');
const sessionResponse = await get('/api/auth/get-session');
assert.equal(sessionResponse.status, 200, `anonymous session lookup returned ${sessionResponse.status}`);
console.log('✓ Anonymous session and comment-read contracts are healthy.');

const browser = await chromium.launch();
try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const failures = [];
    page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error'
        && !ignoredConsoleErrors.some((known) => message.text().includes(known))) {
        failures.push(`console: ${message.text()}`);
      }
    });
    const response = await page.goto(new URL(canonicalMatchPath, base).toString(), {
      waitUntil: 'networkidle',
    });
    assert.equal(response?.status(), 200);
    await page.locator('button[title^="Tag this moment:"]').first().waitFor({ state: 'visible' });
    const renderedMoments = await page.locator('button[title^="Tag this moment:"]').count();
    assert.equal(renderedMoments, momentFeed.moments.length,
      `rendered ${renderedMoments} moments, API returned ${momentFeed.moments.length}`);
    assert.equal(await page.getByText('No moments recorded for this match.').count(), 0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `${viewport.width}px viewport overflows horizontally by ${overflow}px`);
    assert.deepEqual(failures, [], `${viewport.width}px browser errors: ${failures.join('; ')}`);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log('✓ Hydrated match moments render without browser errors on desktop and mobile.');
console.log('✓ Preview feature verification passed.');
