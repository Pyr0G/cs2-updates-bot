import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatPatchNotes, splitDescriptions, decode } from '../src/patchnotes.js';
import { buildMessage } from '../src/steam.js';
import { processNews } from '../src/state.js';
const fixture = readFileSync(new URL('./fixtures/oct23.bbcode', import.meta.url), 'utf8');
const item = (contents = fixture) => ({ gid: '1847286114034398', date: 1792709770, title: 'Counter-Strike 2 Update', contents });
const details = { url: 'https://steamcommunity.com/games/CSGO/announcements/detail/694275728822244200', image: 'https://example.com/image.jpg' };
const literal = s => s.replace(/\\([\\*_`~|\[\]])/g, '$1');

test('complete October 23 announcement keeps all 54 paragraphs and 53 bullets', () => {
  const payload = buildMessage(item(), details, '123');
  const rendered = literal(payload.embeds.map(e => e.description).join(''));
  const paragraphs = [...fixture.matchAll(/\[p\](.*?)\[\/p\]/g)].map(m => decode(m[1]).replace(/\\\[/g,'[').replace(/\u00a0/g,' '));
  assert.equal(paragraphs.length, 54);
  for (const p of paragraphs) assert.ok(rendered.includes(p), `Missing paragraph: ${p}`);
  assert.equal((rendered.match(/•/g) || []).length, 53);
  assert.ok(rendered.includes('[ MAP SCRIPTING ]'));
  assert.ok(rendered.endsWith('Improved auto complete of the map_workshop command'));
  assert.ok(rendered.length > 650);
});
test('nested bullets retain indentation and literal section headings', () => {
  assert.equal(literal(formatPatchNotes('[p]\\[ MAPS ][/p][list][*][p]Parent[/p][list][*][p]Child[/p][/*][/list][/*][/list]')), '[ MAPS ]\n• Parent\n  • Child');
});
test('HTML entities, numeric Unicode and source mentions are safe', () => {
  assert.equal(formatPatchNotes('<p>A &amp; B &#x1f600;</p><ul><li>@everyone *literal*</li></ul>'), 'A & B 😀\n• @\u200beveryone \\*literal\\*');
});
test('media is removed while surrounding notes remain', () => {
  assert.equal(formatPatchNotes('[p]Before[/p][img]hidden URL[/img][p]After[/p]'), 'Before\nAfter');
});
test('long notes use distinct continuation embeds without losing UTF-8 or escapes', () => {
  const source = ('😀 item_with_name\n'.repeat(190)).trimEnd();
  const payload = buildMessage(item(source), details, '123');
  assert.equal(payload.embeds.length, 2);
  assert.equal(payload.embeds.map(e => e.description).join(''), formatPatchNotes(source));
  assert.notEqual(payload.embeds[0].url, payload.embeds[1].url);
  assert.equal(payload.embeds[0].image, undefined);
  assert.equal(payload.embeds[1].image.url, details.image);
  assert.deepEqual(payload.allowed_mentions.roles, ['123']);
  assert.equal(payload.content, '<@&123>');
  for (const e of payload.embeds) {
    assert.ok(Buffer.byteLength(e.description) <= 3500);
    assert.ok(e.description.length <= 4096);
    assert.doesNotMatch(e.description, /[\uD800-\uDBFF]$/u);
  }
  const total = payload.embeds.reduce((n,e) => n + e.title.length + e.description.length + e.footer.text.length, 0);
  assert.ok(total <= 6000);
});
test('title limits preserve whole surrogate pairs, including continuation suffix', () => {
  const payload = buildMessage({ ...item('x'.repeat(4000)), title: '😀'.repeat(200) }, details, '123');
  for (const e of payload.embeds) { assert.ok(e.title.length <= 256); assert.doesNotMatch(e.title, /[\uD800-\uDBFF]$/u); }
});
test('oversize input, Discord overflow and pathological nesting are held', () => {
  assert.throws(() => formatPatchNotes('x'.repeat(32001)), /source limit/);
  assert.throws(() => buildMessage(item('x'.repeat(5201)), details, '123'), /budget/);
  assert.throws(() => formatPatchNotes('[list]'.repeat(17)), /nesting/);
});
test('formatting rejection leaves checkpoint intact and never creates intent or sends', async () => {
  const state = { version: 1, channel: 'c', since: 1, seen: ['1'], pending: null };
  const original = structuredClone(state); let saves = 0, sends = 0;
  await assert.rejects(processNews([item('x'.repeat(5201))], state, {
    prepare: async i => buildMessage(i, details, '123'),
    save: async () => { ++saves; }, send: async () => { ++sends; }
  }), /budget/);
  assert.equal(saves, 0); assert.equal(sends, 0); assert.deepEqual(state, original);
});
test('full-note preview cannot mention a role or reuse delivery nonce', () => {
  const preview = buildMessage(item(), details, '123', false);
  assert.equal(preview.content, ''); assert.deepEqual(preview.allowed_mentions.roles, []);
  assert.equal(preview.nonce, 'p1847286114034398');
  assert.equal(preview.embeds.map(e => e.description).join(''), formatPatchNotes(fixture));
});
