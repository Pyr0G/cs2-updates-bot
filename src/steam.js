import { decode, formatPatchNotes, splitDescriptions, titlePrefix } from './patchnotes.js';
export { decode } from './patchnotes.js';
export const FEED = 'steam_community_announcements';
export const FALLBACK_IMAGE = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/730/header.jpg';

const ARTICLE_HOSTS = new Set(['steamstore-a.akamaihd.net', 'steamcommunity.com', 'store.steampowered.com']);
const ARTICLE_DESTINATIONS = new Set(['steamcommunity.com', 'store.steampowered.com']);
const FEED_HOSTS = new Set(['api.steampowered.com']);

async function fetchSteam(url, fetcher, hosts) {
  let current = new URL(url);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (current.protocol !== 'https:' || !hosts.has(current.hostname) || current.port || current.username || current.password) {
      throw new Error('Unexpected Steam redirect');
    }
    const response = await fetcher(current, { signal: AbortSignal.timeout(30000), redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, url: current };
    const location = response.headers?.get('location');
    if (!location) throw new Error('Steam redirect has no destination');
    current = new URL(location, current);
  }
  throw new Error('Too many Steam redirects');
}

export async function fetchNews(since = null, fetcher = fetch) {
  const items = new Map();
  let enddate;
  for (let page = 0; page < 100; page++) {
    const url = new URL('https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/');
    url.search = new URLSearchParams({ appid: '730', feeds: FEED, count: '100', maxlength: '0', ...(enddate ? { enddate: String(enddate) } : {}) });
    const { response } = await fetchSteam(url, fetcher, FEED_HOSTS);
    if (!response.ok) throw new Error(`Steam returned HTTP ${response.status}`);
    const news = (await response.json()).appnews;
    if (news?.appid !== 730 || !Array.isArray(news.newsitems)) throw new Error('Unexpected Steam feed response');
    const batch = news.newsitems;
    for (const item of batch) {
      if (item.feedname !== FEED || item.appid !== 730 || !/^\d+$/.test(item.gid) || !Number.isFinite(item.date) || typeof item.contents !== 'string' || typeof item.title !== 'string') throw new Error('Invalid announcement in Steam feed');
      items.set(item.gid, item);
    }
    const oldest = Math.min(...batch.map(i => i.date));
    if (since === null || batch.length < 100 || oldest < since) {
      return [...items.values()].filter(i => since === null || i.date >= since).sort((a, b) => a.date - b.date || a.gid.localeCompare(b.gid));
    }
    const next = oldest + 1; // overlap the boundary second so tied timestamps are not skipped
    if (enddate !== undefined && next >= enddate) throw new Error('Steam pagination made no progress; refusing to skip announcements');
    enddate = next;
  }
  throw new Error('Steam catch-up exceeded 100 pages; checkpoint unchanged');
}

export function excerpt(content, limit = 650) {
  const plain = decode(content
    .replace(/\[(img|video|youtube)[^\]]*\][\s\S]*?\[\/\1\]/gi, '')
    .replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, '$1')
    .replace(/\[\*\]\s*(?:\[p\])?/gi, '\n• ')
    .replace(/\[\/?(?:p|h[1-6]|list|olist)[^\]]*\]/gi, '\n')
    .replace(/\[\/?(?:b|i|u|s|strike|url|quote|code|spoiler|table|tr|td|th|\*)[^\]]*\]/gi, '')
    .replace(/<br\s*\/?\s*>|<\/(?:p|li|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\\\[/g, '['))
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  // Keep source text literal in Discord and neutralize mention-looking content.
  const safe = plain.replace(/@/g, '@\u200b').replace(/([\\*_`~|])/g, '\\$1');
  return safe.length <= limit ? safe : safe.slice(0, limit - 1).replace(/\s+\S*$/, '').replace(/\\$/, '') + '…';
}

export async function articleDetails(item, fetcher = fetch) {
  const source = new URL(item.url);
  if (!ARTICLE_HOSTS.has(source.hostname) || source.protocol !== 'https:') throw new Error('Unexpected Steam announcement URL');
  const { response, url: destination } = await fetchSteam(source, fetcher, ARTICLE_HOSTS);
  if (!response.ok) throw new Error(`Steam article returned HTTP ${response.status}`);
  if (!ARTICLE_DESTINATIONS.has(destination.hostname)) throw new Error('Unexpected announcement redirect');
  destination.search = '';
  const html = await response.text();
  const tag = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*>/i)?.[0];
  const candidate = decode(tag?.match(/content=["']([^"']+)["']/i)?.[1] || FALLBACK_IMAGE);
  const image = new URL(candidate);
  return { url: destination.href, image: image.protocol === 'https:' ? image.href : FALLBACK_IMAGE };
}

export function buildMessage(item, details, roleId, ping = true) {
  const parts = splitDescriptions(formatPatchNotes(item.contents));
  const embeds = parts.map((description, part) => {
    const url = details.url ? new URL(details.url) : null;
    if (part && url) url.hash = `cs2-part-${part + 1}`;
    return {
      title: titlePrefix(item.title, part ? 244 : 256) + (part ? ' (continued)' : ''),
      url: url?.href, description, color: 0xf0a126,
      ...(part === parts.length - 1 ? { image: { url: details.image } } : {}),
      footer: { text: 'Counter-Strike 2 \u2022 Steam' },
      timestamp: new Date(item.date * 1000).toISOString()
    };
  });
  return {
    content: ping ? `<@&${roleId}>` : '',
    allowed_mentions: { parse: [], roles: ping ? [roleId] : [], users: [], replied_user: false },
    nonce: ping ? item.gid : `p${item.gid}`, enforce_nonce: true, embeds
  };
}
