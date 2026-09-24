import { setTimeout as sleep } from 'node:timers/promises';

export class Discord {
  constructor(token, channel, fetcher = fetch) { this.token = token; this.channel = channel; this.fetcher = fetcher; }
  async request(path, method = 'GET', body) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await this.fetcher(`https://discord.com/api/v10${path}`, {
        method, headers: { Authorization: `Bot ${this.token}`, 'Content-Type': 'application/json', 'User-Agent': 'CS2UpdatesBot/1.0' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000)
      });
      if (response.status === 429) {
        const retry = Number((await response.json()).retry_after);
        if (!Number.isFinite(retry) || retry < 0 || retry > 300) throw new Error('Discord rate limit requires a later retry');
        await sleep(Math.ceil(retry * 1000) + 100);
        continue;
      }
      // Never print a response/request containing credentials or automatically replay an uncertain POST.
      if (!response.ok) throw new Error(`Discord HTTP ${response.status}; check token, installation and channel permissions`);
      return response.json();
    }
    throw new Error('Discord rate limit retry budget exhausted');
  }
  send(payload) { return this.request(`/channels/${this.channel}/messages`, 'POST', payload); }
  async check(roleId, applicationId, guildId) {
    const me = await this.request('/users/@me');
    if (me.id !== applicationId) throw new Error('Token belongs to a different bot application');
    const channel = await this.request(`/channels/${this.channel}`);
    if (![0, 5].includes(channel.type) || !channel.guild_id) throw new Error('Choose a server text or announcement channel');
    if (guildId && channel.guild_id !== guildId) throw new Error('Channel belongs to a different server');
    const roles = await this.request(`/guilds/${channel.guild_id}/roles`);
    const target = roles.find(r => r.id === roleId);
    if (!target) throw new Error('CS Updates role does not exist in the destination server');
    const member = await this.request(`/guilds/${channel.guild_id}/members/${me.id}`);
    let permissions = roles.filter(r => r.id === channel.guild_id || member.roles.includes(r.id)).reduce((bits, role) => bits | BigInt(role.permissions), 0n);
    if (!(permissions & 8n)) {
      const overwrites = channel.permission_overwrites || [];
      const apply = entry => { if (entry) permissions = (permissions & ~BigInt(entry.deny)) | BigInt(entry.allow); };
      apply(overwrites.find(o => o.id === channel.guild_id));
      const matches = overwrites.filter(o => o.type === 0 && member.roles.includes(o.id));
      apply({ deny: matches.reduce((n, o) => n | BigInt(o.deny), 0n), allow: matches.reduce((n, o) => n | BigInt(o.allow), 0n) });
      apply(overwrites.find(o => o.type === 1 && o.id === me.id));
      for (const [bit, name] of [[1024n, 'View Channel'], [2048n, 'Send Messages'], [16384n, 'Embed Links']]) {
        if (!(permissions & bit)) throw new Error(`Missing channel permission: ${name}`);
      }
      if (!target.mentionable && !(permissions & 131072n)) throw new Error('CS Updates is not mentionable and the bot lacks Mention Everyone in this channel');
    }
    return { bot: me.username, channel: channel.name, role: target.name };
  }
}
