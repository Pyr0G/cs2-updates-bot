import test from 'node:test';
import assert from 'node:assert/strict';
import { baselineNews, processNews } from '../src/state.js';

const item = (gid, date) => ({ gid, date, title: 'Update', url: 'https://steamcommunity.com/example' });
const old = { version: 1, channel: 'channel', since: 100, seen: ['1'], pending: null, lastDelivery: { gid: '1' } };

test('switching back quietly skips announcements sent by the other host and begins with subsequent news', async () => {
  let saved; const sends = [];
  const operations = { channel: 'channel', save: async value => { saved = structuredClone(value); }, prepare: async value => value,
    send: async value => { sends.push(value.gid); return { id: 'receipt' }; } };
  const next = await baselineNews([item('2', 101), item('3', 102)], old, operations);
  assert.deepEqual(next.seen, ['2', '3']);
  assert.equal(next.since, 102);
  assert.deepEqual(next.lastDelivery, old.lastDelivery);
  assert.deepEqual(sends, []);
  await processNews([item('3', 102), item('4', 102), item('5', 103)], next, operations);
  assert.deepEqual(sends, ['4', '5']);
  assert.equal(saved.pending, null);
  assert.deepEqual(old.seen, ['1']);
});

test('quiet startup never clears an uncertain delivery', async () => {
  let writes = 0;
  await assert.rejects(baselineNews([item('2', 101)], { ...old, pending: { gid: '2', date: 101 } },
    { channel: 'channel', save: async () => { writes++; } }), /needs review/);
  assert.equal(writes, 0);
});

test('failed or empty startup baseline never permits normal posting', async () => {
  await assert.rejects(baselineNews([], old, { channel: 'channel', save: async () => {} }), /Empty startup/);
  await assert.rejects(baselineNews([item('2', 101)], old, { channel: 'channel', save: async () => { throw new Error('disk full'); } }), /disk full/);
});

test('startup baseline respects destination and shutdown', async () => {
  let writes = 0;
  const options = { channel: 'channel', save: async () => { writes++; }, shouldStop: () => true };
  assert.equal(await baselineNews([item('2', 101)], old, options), null);
  assert.equal(writes, 0);
  await assert.rejects(baselineNews([item('2', 101)], old, { ...options, channel: 'other' }), /another channel/);
});
