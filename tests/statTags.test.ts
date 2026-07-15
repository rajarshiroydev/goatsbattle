import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveStatTagInputs } from '../src/lib/statTags';

test('rejects an unknown requested stat instead of silently dropping it', () => {
  assert.deepEqual(resolveStatTagInputs([
    { goatSlug: 'messi', statLabel: 'Definitely not a canonical stat' },
  ]), {
    ok: false,
    error: 'Unknown stat tag: messi · Definitely not a canonical stat',
  });
});

test('deduplicates validated stat references without changing the request count', () => {
  const first = resolveStatTagInputs([{ goatSlug: 'messi', statLabel: 'World Cup' }]);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const duplicate = resolveStatTagInputs([
    { goatSlug: first.tags[0].goatSlug, statLabel: first.tags[0].statLabel },
    { goatSlug: first.tags[0].goatSlug, statLabel: first.tags[0].statLabel },
  ]);
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) return;
  assert.equal(duplicate.requested, 2);
  assert.equal(duplicate.tags.length, 1);
});
