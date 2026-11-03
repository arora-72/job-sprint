// A strict allow-list cleaner for note bodies. Notes are shared, so whatever one person pastes
// must be safe to show the other: only simple formatting tags survive, links must be http(s) or
// mailto, and every attribute except a few known ones is dropped. Text is kept; tags are not.
const TAGS = new Set(['p', 'br', 'div', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'blockquote', 'hr', 'code']);
const VOID = new Set(['br', 'hr']);
const RENAME = { b: 'strong', i: 'em', div: 'p' };
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|template|svg|math|noscript|textarea|select|button|head|title)\b[\s\S]*?<\/\1\s*>/gi;

function attrs(raw) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(raw))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}
const escAttr = (v) => String(v).replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function safeHref(v) {
  const s = String(v).replace(/&amp;/g, '&').trim();
  // Strip control characters and whitespace that browsers ignore inside a scheme (e.g. "java\tscript:").
  const probe = s.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
  return /^(https?:|mailto:)/.test(probe) ? s : null;
}

export function cleanHtml(input, max = 100000) {
  let html = String(input || '').slice(0, max * 2);
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(DROP_WITH_CONTENT, '');
  const parts = html.split(/(<[^>]*>)/g);
  const open = [];
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    if (part[0] !== '<' || part.length < 3) {
      // Text: escape anything that could start markup; keep existing entities as they are.
      out += part.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      continue;
    }
    // A real tag starts right after "<" or "</". Anything else (like "a < b > c") is just text.
    const m = part.match(/^<(\/?)([a-zA-Z][a-zA-Z0-9]*)(\s[\s\S]*?)?\/?>$/);
    if (!m) { out += part.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); continue; }
    const closing = !!m[1];
    let tag = m[2].toLowerCase();
    if (!TAGS.has(tag)) continue;
    tag = RENAME[tag] || tag;
    if (closing) {
      const idx = open.lastIndexOf(tag);
      if (idx === -1) continue;
      while (open.length > idx) out += `</${open.pop()}>`;
      continue;
    }
    const a = attrs(m[3] || '');
    let keep = '';
    if (tag === 'a') {
      const href = safeHref(a.href || '');
      if (!href) continue; // a link we won't keep: keep its text only
      keep = ` href="${escAttr(href)}" target="_blank" rel="noopener noreferrer"`;
    }
    if (tag === 'ul' && a['data-type'] === 'todo') keep = ' data-type="todo"';
    if (tag === 'li' && a['data-checked'] === 'true') keep = ' data-checked="true"';
    if (VOID.has(tag)) { out += `<${tag}>`; continue; }
    out += `<${tag}${keep}>`;
    open.push(tag);
  }
  while (open.length) out += `</${open.pop()}>`;
  return out.slice(0, max);
}

// Plain text of a cleaned body, for previews and search.
export function htmlText(html) {
  return String(html || '').replace(/<(br|\/p|\/li|\/h2|\/h3|\/blockquote)>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
