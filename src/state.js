import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function loadState(path, channel) {
  let state;
  try { state = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('State cannot be read; refusing to reset posting history'); }
  if (state.version !== 1 || state.channel !== channel || !Array.isArray(state.seen) || !Number.isFinite(state.since)) throw new Error('State is invalid or belongs to another channel');
  return state;
}
export async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}
export async function lockState(path) {
  await mkdir(dirname(path), { recursive: true });
  let handle;
  try { handle = await open(`${path}.lock`, 'wx'); }
  catch { throw new Error('State is locked. Stop other instances; after a crash, remove the .lock file only when no bot is running.'); }
  await handle.writeFile(String(process.pid));
  return async () => { await handle.close(); await unlink(`${path}.lock`); };
}
export async function processNews(items, state, { save, send, prepare, channel }) {
  if (!state) {
    if (!items.length) throw new Error('Empty initial feed; waiting before establishing baseline');
    const initial = { version: 1, channel, since: Math.max(...items.map(i => i.date)), seen: items.map(i => i.gid), pending: null };
    await save(initial);
    return initial;
  }
  if (state.pending) throw new Error(`Delivery ${state.pending.gid} needs review. Check the channel before resolving it; see README.`);
  const next = structuredClone(state);
  for (const item of items) {
    if (next.seen.includes(item.gid)) continue;
    const payload = await prepare(item);
    next.pending = { gid: item.gid, date: item.date, title: item.title, started: new Date().toISOString() };
    await save(next); // Record intent before sending; an interrupted delivery must never silently replay.
    const message = await send(payload);
    if (!message?.id) throw new Error('Discord did not return a message ID; delivery needs review');
    next.seen.push(item.gid);
    next.pending = null;
    next.since = Math.max(next.since, item.date);
    await save(next);
  }
  return next;
}
