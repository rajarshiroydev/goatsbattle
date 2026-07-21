import assert from 'node:assert/strict';
import test from 'node:test';
import { requestTallies } from '../src/lib/homeBattleTallies';

test('retries a transient home battle failure through the shared request', async () => {
  let calls = 0;
  const attempts: number[] = [];
  const rows = await requestTallies('battle=messi-vs-ronaldo', {
    fetcher: async () => {
      calls += 1;
      return calls === 1
        ? Response.json({ error: 'temporary' }, { status: 503 })
        : Response.json([{ slug: 'messi-vs-ronaldo', leftPct: 61, total: 100 }]);
    },
    wait: async (attempt) => { attempts.push(attempt); },
  });

  assert.equal(calls, 2);
  assert.deepEqual(attempts, [0]);
  assert.deepEqual(rows, [{ slug: 'messi-vs-ronaldo', leftPct: 61, total: 100 }]);
});

test('bounds home battle retries and preserves the final failure', async () => {
  let calls = 0;
  const attempts: number[] = [];
  await assert.rejects(
    requestTallies('battle=messi-vs-ronaldo', {
      fetcher: async () => {
        calls += 1;
        return Response.json({ error: 'temporary' }, { status: 503 });
      },
      wait: async (attempt) => { attempts.push(attempt); },
    }),
    /home-battles returned 503/,
  );

  assert.equal(calls, 3);
  assert.deepEqual(attempts, [0, 1]);
});
