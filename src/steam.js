export const FEED = 'steam_community_announcements';
export const FALLBACK_IMAGE = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/730/header.jpg';

export async function fetchNews(since = null, fetcher = fetch) {
  const items = new Map();
  let enddate;
  for (let page = 0; page < 100; page++) {
    const url = new URL('https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/');
    url.search = new URLSearchParams({ appid: '730', feeds: FEED, count: '100', maxlength: '0', ...(enddate ? { enddate: String(enddate) } : {}) });
    const response = await fetcher(url, { signal: AbortSignal.timeout(30000) });
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

export function decode(text) {
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, entity => {
    const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const hex = entity.toLowerCase().startsWith('&#x');
    const value = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
  });
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
  if (!['steamstore-a.akamaihd.net', 'steamcommunity.com', 'store.steampowered.com'].includes(source.hostname) || source.protocol !== 'https:') throw new Error('Unexpected Steam announcement URL');
  const response = await fetcher(source, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Steam article returned HTTP ${response.status}`);
  const destination = new URL(response.url);
  if (!['steamcommunity.com', 'store.steampowered.com'].includes(destination.hostname)) throw new Error('Unexpected announcement redirect');
  destination.search = '';
  const html = await response.text();
  const tag = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*>/i)?.[0];
  const candidate = decode(tag?.match(/content=["']([^"']+)["']/i)?.[1] || FALLBACK_IMAGE);
  const image = new URL(candidate);
  return { url: destination.href, image: image.protocol === 'https:' ? image.href : FALLBACK_IMAGE };
}

export function buildMessage(item, details, roleId, ping = true) {
  return {
    content: ping ? `<@&${roleId}>` : 'Preview — notifications disabled',
    allowed_mentions: { parse: [], roles: ping ? [roleId] : [], users: [], replied_user: false },
    nonce: ping ? item.gid : `p${item.gid}`,
    enforce_nonce: true,
    embeds: [{
      title: item.title.slice(0, 256), url: details.url,
      description: excerpt(item.contents) || 'Read the announcement on Steam.',
      color: 0xf0a126,
      image: { url: details.image },
      footer: { text: `Counter-Strike 2 • Steam • ${item.gid}` },
      timestamp: new Date(item.date * 1000).toISOString()
    }]
  };
}
