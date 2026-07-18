import assert from 'node:assert/strict';
import test from 'node:test';
import { textOn } from '../src/lib/colorContrast';

test('selects readable text for representative vivid accents', () => {
  assert.equal(textOn('#E8202A'), '#f0f0f2');
  assert.equal(textOn('#2E6FE0'), '#f0f0f2');
  assert.equal(textOn('#C6FF00'), '#0d0d0f');
});

test('uses the established dark fallback for unsupported accent values', () => {
  assert.equal(textOn('#fff'), '#0d0d0f');
  assert.equal(textOn('not-a-color'), '#0d0d0f');
  assert.equal(textOn('000#000'), '#0d0d0f');
  assert.equal(textOn(undefined), '#0d0d0f');
});
