import test from 'node:test';
import assert from 'node:assert/strict';
import { excerpt, buildMessage, fetchNews, articleDetails, FEED } from '../src/steam.js';
import { processNews } from '../src/state.js';
import { Discord } from '../src/discord.js';

const item = (gid, date = 100) => ({ gid, date, appid: 730, feedname: FEED, title: 'Update', contents: '[p]\\[ RUSH ][/p][list][*][p]Fixed a bug.[/p][/*][/list]', url: 'https://steamcommunity.com/games/CSGO/announcements/detail/123' });
test('excerpt keeps patch headings, removes media and markup, neutralizes mentions', () => {
  assert.equal(excerpt(item('1').contents), '[ RUSH ]\n\n• Fixed a bug.');
  assert.equal(excerpt('[video poster="x"]xx[/video][img]image[/img][p]Hello &amp; @everyone[/p]'), 'Hello & @\u200beveryone');
  assert.ok(excerpt('hello '.repeat(500)).length <= 650);
});
test('only the configured role is permitted and non-pinging previews cannot notify', () => {
  const payload = buildMessage(item('1'), { url: 'https://steamcommunity.com/', image: 'https://example.com/i.jpg' }, '123456789012345678');
  assert.equal(payload.content, '<@&123456789012345678>');
  assert.deepEqual(payload.allowed_mentions, { parse: [], roles: ['123456789012345678'], users: [], replied_user: false });
  assert.deepEqual(buildMessage(item('1'), {}, '123', false).allowed_mentions.roles, []);
  assert.notEqual(buildMessage(item('1'), {}, '123', false).nonce, payload.nonce);
});
test('first run establishes baseline without sending, then posts new announcements once in supplied order', async () => {
  const sent = []; let saved;
  const operations = { channel: 'c', save: async s => { saved = structuredClone(s); }, send: async p => { sent.push(p.gid); return { id: 'm' }; }, prepare: async i => i };
  let state = await processNews([item('1')], null, operations);
  assert.equal(sent.length, 0);
  state = await processNews([item('1'), item('2', 101), item('3', 102)], state, operations);
  state = await processNews([item('2', 101), item('3', 102)], state, operations);
  assert.deepEqual(sent, ['2', '3']);
  assert.equal(saved.pending, null);
  assert.equal(state.since, 102);
});
test('uncertain delivery persists pending and refuses to resend on restart', async () => {
  let saved; let attempts = 0;
  const state = { version: 1, channel: 'c', since: 100, seen: ['1'], pending: null };
  const operations = { save: async s => { saved = structuredClone(s); }, prepare: async i => i, send: async () => { attempts++; throw new Error('timeout'); } };
  await assert.rejects(processNews([item('2', 101)], state, operations), /timeout/);
  assert.equal(saved.pending.gid, '2');
  await assert.rejects(processNews([item('2', 101)], saved, operations), /needs review/);
  assert.equal(attempts, 1);
});
test('failed state persistence prevents Discord transmission', async () => {
  let sent = false;
  await assert.rejects(processNews([item('2')], { seen: ['1'], since: 100 }, { prepare: async i => i, save: async () => { throw new Error('disk full'); }, send: async () => { sent = true; } }), /disk full/);
  assert.equal(sent, false);
});
test('feed includes news as well as patches, catches up across pages and overlapping seconds', async () => {
  const first = Array.from({ length: 100 }, (_, i) => item(String(300 - i), 300 - i));
  const second = [item('201', 201), item('200', 200), item('199', 199)];
  let calls = 0;
  const result = await fetchNews(200, async url => {
    assert.equal(url.searchParams.get('feeds'), FEED);
    if (calls) assert.equal(url.searchParams.get('enddate'), '202');
    return { ok: true, json: async () => ({ appnews: { appid: 730, newsitems: calls++ ? second : first } }) };
  });
  assert.equal(result.length, 101);
  assert.equal(result[0].gid, '200');
  assert.equal(result.at(-1).gid, '300');
});
test('unexpected feeds cannot enter posting pipeline', async () => {
  await assert.rejects(fetchNews(null, async () => ({ ok: true, json: async () => ({ appnews: { appid: 730, newsitems: [{ ...item('1'), feedname: 'press' }] } }) })), /Invalid announcement/);
});
test('article follows Steam redirect to canonical community link and image', async () => {
  const result = await articleDetails(item('1'), async () => ({ ok: true, url: 'https://steamcommunity.com/games/CSGO/announcements/detail/123?tracking=x', text: async () => '<meta property="og:image" content="https://example.com/image.jpg">' }));
  assert.equal(result.url, item('1').url);
  assert.equal(result.image, 'https://example.com/image.jpg');
});
test('Discord permission check validates role notifications and channel overwrites', async () => {
  const roles = [{ id: 'g', permissions: '19456' }, { id: 'r', name: 'CS Updates', permissions: '0', mentionable: false }];
  let overwrites = [];
  const api = new Discord('secret', 'c', async url => ({ ok: true, json: async () => {
    if (url.endsWith('/users/@me')) return { id: 'app', username: 'Bot' };
    if (url.endsWith('/channels/c')) return { guild_id: 'g', type: 0, name: 'cs', permission_overwrites: overwrites };
    if (url.endsWith('/roles')) return roles;
    return { roles: [] };
  } }));
  await assert.rejects(api.check('r', 'app', 'g'), /not mentionable/);
  overwrites = [{ id: 'app', type: 1, allow: '131072', deny: '0' }];
  assert.equal((await api.check('r', 'app', 'g')).role, 'CS Updates');
  overwrites = [{ id: 'app', type: 1, allow: '131072', deny: '2048' }];
  await assert.rejects(api.check('r', 'app', 'g'), /Send Messages/);
  await assert.rejects(api.check('r', 'app', 'other'), /different server/);
});
test('Discord does not replay an ambiguous server failure', async () => {
  let calls = 0;
  const api = new Discord('secret', 'c', async () => { calls++; return { ok: false, status: 500 }; });
  await assert.rejects(api.send({}), /HTTP 500/);
  assert.equal(calls, 1);
});

// Release behavior: clean chat output and persisted delivery tracking.
test('announcement output contains no test labels or technical footer IDs', () => {
  const payload = buildMessage(item('123456789'), { url: 'https://steamcommunity.com/', image: 'https://example.com/i.jpg' }, '123456789012345678');
  assert.equal(payload.content, '<@&123456789012345678>');
  assert.equal(payload.embeds[0].footer.text, 'Counter-Strike 2 • Steam');
  assert.equal(buildMessage(item('1'), {}, undefined, false).content, '');
});

test('shutdown during article preparation prevents a new send or state change', async () => {
  let stopping = false;
  let writes = 0;
  let sends = 0;
  const state = { seen: ['1'], since: 100, pending: null };
  const next = await processNews([item('2', 101)], state, {
    shouldStop: () => stopping,
    prepare: async value => { stopping = true; return value; },
    save: async () => { writes++; },
    send: async () => { sends++; }
  });
  assert.deepEqual(next, state);
  assert.equal(writes, 0);
  assert.equal(sends, 0);
});

test('a delivery in progress finishes saving before shutdown stops the backlog', async () => {
  let stopping = false;
  let saved;
  const next = await processNews([item('2', 101), item('3', 102)], { seen: ['1'], since: 100, pending: null }, {
    shouldStop: () => stopping,
    prepare: async value => value,
    save: async value => { saved = structuredClone(value); },
    send: async () => { stopping = true; return { id: 'message-2' }; }
  });
  assert.deepEqual(next.seen, ['1', '2']);
  assert.equal(saved.pending, null);
  assert.equal(saved.lastDelivery.messageId, 'message-2');
  assert.equal(saved.lastDelivery.gid, '2');
});

test('disk-backed restart preserves history and blocks malformed state', async t => {
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { saveState, loadState } = await import('../src/state.js');
  const folder = await mkdtemp(join(tmpdir(), 'cs2-state-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const file = join(folder, 'state.json');
  let sends = 0;
  const operations = { channel: 'c', save: state => saveState(file, state), prepare: async value => value, send: async () => { sends++; return { id: 'message' }; } };
  await processNews([item('1')], null, operations);
  await processNews([item('1'), item('2', 101)], await loadState(file, 'c'), operations);
  await processNews([item('1'), item('2', 101)], await loadState(file, 'c'), operations);
  assert.equal(sends, 1);
  assert.equal((await loadState(file, 'c')).lastDelivery.gid, '2');
  await assert.rejects(loadState(file, 'other'), /invalid/);
  for (const bad of [null, { version: 1, channel: 'c', seen: [123], since: 100, pending: null }, { version: 1, channel: 'c', seen: ['1'], since: 100, pending: {} }]) {
    await writeFile(file, JSON.stringify(bad));
    await assert.rejects(loadState(file, 'c'), /invalid/);
  }
});

test('removed manual send commands fail before any network or credential access', async () => {
  const { spawnSync } = await import('node:child_process');
  for (const command of ['send-preview', 'send-test']) {
    const result = spawnSync(process.execPath, ['src/main.js', command], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown command/);
  }
});
