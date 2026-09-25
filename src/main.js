import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fetchNews, articleDetails, buildMessage } from './steam.js';
import { Discord } from './discord.js';
import { loadState, saveState, lockState, processNews } from './state.js';

const command = process.argv[2] || 'preview';
const role = process.env.DISCORD_ROLE_ID;
const application = process.env.DISCORD_APPLICATION_ID;
const guild = process.env.DISCORD_GUILD_ID;
const channel = process.env.DISCORD_CHANNEL_ID;
const statePath = resolve(process.env.STATE_FILE || './data/state.json');
const interval = Number(process.env.POLL_SECONDS || 120);
let stopping = false;
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; controller.abort(); });
const log = message => console.log(`${new Date().toISOString()} ${message}`);

async function main() {
  if (!['preview', 'check', 'run', 'resolve-sent', 'resolve-retry'].includes(command)) throw new Error('Unknown command');
  if (command === 'preview') {
    const items = await fetchNews();
    const latest = items.at(-1);
    if (!latest) throw new Error('Steam feed is empty');
    const payload = buildMessage(latest, await articleDetails(latest), role, false);
    await writeFile('preview.json', JSON.stringify(payload, null, 2));
    log(`Saved preview.json: ${latest.title} — ${payload.embeds[0].url}. Nothing sent to Discord.`);
    return;
  }
  if (!process.env.DISCORD_BOT_TOKEN || !/^\d{17,20}$/.test(channel || '')) throw new Error('Set DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID in .env first');
  for (const [name, value] of Object.entries({ DISCORD_ROLE_ID: role, DISCORD_APPLICATION_ID: application, DISCORD_GUILD_ID: guild })) {
    if (!/^\d{17,20}$/.test(value || '')) throw new Error(`Set a valid ${name} in .env first`);
  }
  const discord = new Discord(process.env.DISCORD_BOT_TOKEN, channel);
  const info = await discord.check(role, application, guild);
  log(`Verified ${info.bot} → #${info.channel}; role: ${info.role}`);
  if (command === 'check') return;
  const release = await lockState(statePath);
  try {
    if (command.startsWith('resolve-')) {
      const state = await loadState(statePath, channel);
      if (!state?.pending) throw new Error('No pending delivery to resolve');
      if (process.argv[3] !== state.pending.gid) throw new Error('Supply the exact pending announcement ID to confirm your review');
      if (command === 'resolve-sent') {
        state.seen.push(state.pending.gid);
        state.since = Math.max(state.since, state.pending.date);
      }
      state.pending = null;
      await saveState(statePath, state);
      log('Delivery review recorded. You can restart the bot.');
      return;
    }
    if (!Number.isInteger(interval) || interval < 60) throw new Error('POLL_SECONDS must be an integer of at least 60');
    log(`Monitoring every ${interval}s. Waiting for new announcements; press Ctrl+C to stop.`);
    while (!stopping) {
      const state = await loadState(statePath, channel);
      if (state?.pending) throw new Error(`Delivery ${state.pending.gid} needs review; see README. Posting is paused to avoid duplicate pings.`);
      try {
        const items = await fetchNews(state?.since ?? null);
        const next = await processNews(items, state, {
          channel, save: value => saveState(statePath, value),
          prepare: async item => buildMessage(item, await articleDetails(item), role),
          shouldStop: () => stopping,
          send: async payload => {
            const message = await discord.send(payload);
            log(`Posted ${payload.embeds[0].title}: https://discord.com/channels/${guild}/${channel}/${message.id}`);
            return message;
          }
        });
        if (!state && next) log('Baseline saved. Watching for new announcements; no old posts sent.');
      } catch (error) {
        if ((await loadState(statePath, channel))?.pending) throw error;
        log(`Check failed: ${error.message}. Will retry after ${interval}s.`);
      }
      await sleep(interval * 1000, undefined, { signal: controller.signal }).catch(error => { if (error.name !== 'AbortError') throw error; });
    }
  } finally { await release(); }
  log('Monitoring stopped. Posting history saved.');
}
main().catch(error => { console.error(`Stopped: ${error.message}`); process.exitCode = 1; });
