// Complete notes are sent atomically in one Discord message. Never silently shorten them.
export const MAX_SOURCE_BYTES = 32000;
export const MAX_DESCRIPTION_BYTES = 5200;
export function decode(text) {
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, entity => {
    const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const hex = entity.toLowerCase().startsWith('&#x');
    const value = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : '';
  });
}
export function formatPatchNotes(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_SOURCE_BYTES) throw new Error('Full announcement exceeds source limit; nothing sent');
  let plain = '', depth = 0;
  const line = () => { plain = plain.replace(/[ \t]+$/, ''); if (plain && !plain.endsWith('\n')) plain += '\n'; };
  for (let i = 0; i < source.length;) {
    if (Buffer.byteLength(plain) > MAX_DESCRIPTION_BYTES) throw new Error('Complete patch notes exceed Discord budget; nothing sent');
    if (source[i] === '\\' && /[\[\]]/.test(source[i + 1] || '')) { plain += source[i + 1]; i += 2; continue; }
    const html = source[i] === '<';
    if (source[i] === '[' || html) {
      const end = source.indexOf(html ? '>' : ']', i + 1);
      if (end >= 0 && end - i <= 2048) {
        const tag = source.slice(i + 1, end).toLowerCase();
        const closing = tag.startsWith('/');
        const name = (closing ? tag.slice(1) : tag).split(/[ =\t/]/)[0];
        let handled = true;
        if (!closing && ['img', 'video', 'youtube', 'script', 'style'].includes(name)) {
          const close = `${html ? '</' : '[/'}${name}${html ? '>' : ']'}`;
          const stop = source.toLowerCase().indexOf(close, end + 1);
          if (stop >= 0) { i = stop + close.length; continue; }
        }
        if (['list', 'olist', 'ul', 'ol'].includes(name)) {
          line();
          if (closing) depth = Math.max(0, depth - 1);
          else { if (depth >= 16) throw new Error('Announcement nesting limit; nothing sent'); ++depth; }
        } else if (['*', 'li'].includes(name)) {
          line(); if (!closing) plain += '  '.repeat(Math.max(0, depth - 1)) + '• ';
        } else if (['p', 'div', 'br', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(name)) {
          if (closing || !plain.endsWith('• ')) line();
        } else if (['td', 'th'].includes(name)) { if (closing) plain += ' | '; }
        else if (!['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'url', 'a', 'quote', 'blockquote', 'code', 'pre', 'spoiler', 'table', 'span', 'img', 'hr'].includes(name)) handled = false;
        if (handled) { i = end + 1; continue; }
      }
    }
    let c = source[i++];
    if (c === '\r') continue;
    if (c === '\n') { line(); continue; }
    if (c === '\t') c = ' ';
    if (c === ' ' && (!plain || /[ \n]$/.test(plain))) continue;
    plain += c;
  }
  const safe = decode(plain).replace(/\u00a0/g, ' ').trimEnd().replace(/@/g, '@\u200b').replace(/([\\*_`~|\[\]])/g, '\\$1');
  if (Buffer.byteLength(safe) > MAX_DESCRIPTION_BYTES) throw new Error('Complete patch notes exceed Discord budget; nothing sent');
  return safe || 'Read the announcement on Steam.';
}
export function splitDescriptions(text) {
  const parts = [];
  let start = 0;
  while (start < text.length) {
    let end = start, bytes = 0;
    while (end < text.length) {
      const c = String.fromCodePoint(text.codePointAt(end));
      const size = Buffer.byteLength(c);
      if (bytes + size > 3500) break;
      bytes += size; end += c.length;
    }
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end - 1);
      if (newline > start) end = newline + 1;
      let slashes = 0;
      for (let j = end; j > start && text[j - 1] === '\\'; --j) ++slashes;
      if (slashes % 2) --end;
    }
    if (end <= start) throw new Error('Cannot safely split patch notes; nothing sent');
    parts.push(text.slice(start, end)); start = end;
  }
  return parts;
}
export function titlePrefix(text, limit) {
  let result = '';
  for (const c of text) { if (result.length + c.length > limit) break; result += c; }
  return result;
}
