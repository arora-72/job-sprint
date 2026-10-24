const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const dns = require('node:dns').promises;
const net = require('node:net');

function isPublicAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)));
  }
  if (version === 6) {
    const value = address.toLowerCase();
    if (value.startsWith('::ffff:')) return isPublicAddress(value.slice(7));
    return !(value === '::' || value === '::1' || value.startsWith('fc') ||
      value.startsWith('fd') || /^fe[89ab]/.test(value) || value.startsWith('ff'));
  }
  return false;
}

async function checkPublicUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use a public http or https job link.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || (!net.isIP(host) && !host.includes('.'))) {
    throw new Error('Use a public job link.');
  }
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('Use a public job link.');
  }
  return url;
}

function decodeHtml(str = '') {
  return str
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&hellip;/g, '…')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
function clean(str = '') {
  return decodeHtml(String(str)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function meta(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i'),
  ];
  for (const p of patterns) { const m = html.match(p); if (m) return clean(m[1]); }
  return '';
}
function locationFromJob(job) {
  if (!job) return '';
  if (job.jobLocationType === 'TELECOMMUTE') return 'Remote';
  const loc = Array.isArray(job.jobLocation) ? job.jobLocation[0] : job.jobLocation;
  const a = loc?.address || loc;
  if (!a) return '';
  return [a.addressLocality, a.addressRegion, a.addressCountry?.name || a.addressCountry].filter(Boolean).join(', ');
}
function pickJobPosting(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const n of node) { const hit = pickJobPosting(n); if (hit) return hit; }
    return null;
  }
  if (typeof node !== 'object') return null;
  const type = node['@type'];
  if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) return node;
  if (node['@graph']) return pickJobPosting(node['@graph']);
  for (const v of Object.values(node)) {
    if (typeof v === 'object') { const hit = pickJobPosting(v); if (hit) return hit; }
  }
  return null;
}
function jsonLdJob(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const job = pickJobPosting(parsed);
      if (job) return job;
    } catch (_) {}
  }
  return null;
}
function fallbackTitle(html) {
  return meta(html, 'og:title') || clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
}
function inferCompanyAndTitle(rawTitle) {
  const parts = rawTitle.split(/\s+[|–—-]\s+/).map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) return { title: parts[0], company: parts[parts.length - 1] };
  return { title: rawTitle, company: '' };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  try {
    const { url } = JSON.parse(event.body || '{}');
    if (!url) return json(400, { error: 'Missing URL.' });
    let target = await checkPublicUrl(url);
    let res;
    for (let redirects = 0; redirects <= 5; redirects++) {
      res = await fetch(target, {
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; JobSprint/1.0)',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });
      if (![301, 302, 303, 307, 308].includes(res.status)) break;
      if (redirects === 5) throw new Error('Too many redirects.');
      const next = res.headers.get('location');
      if (!next) throw new Error('Job page redirect is missing its destination.');
      target = await checkPublicUrl(new URL(next, target).href);
    }
    if (!res.ok) throw new Error(`Job page returned ${res.status}.`);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) throw new Error('This link did not return a web page.');
    const html = (await res.text()).slice(0, 2_000_000);

    const job = jsonLdJob(html);
    if (job) {
      const company = clean(job.hiringOrganization?.name || '');
      const title = clean(job.title || '');
      const location = clean(locationFromJob(job));
      const confidence = company && title ? 'high' : 'medium';
      return json(200, { company, title, location, confidence, source: 'json-ld' });
    }

    const rawTitle = fallbackTitle(html);
    const inferred = inferCompanyAndTitle(rawTitle);
    const company = meta(html, 'og:site_name') || inferred.company;
    const title = inferred.title;
    const location = meta(html, 'job:location') || meta(html, 'og:locality') || '';
    return json(200, { company: clean(company), title: clean(title), location: clean(location), confidence: company && title ? 'medium' : 'low', source: 'meta' });
  } catch (err) {
    return json(422, { error: err.message || 'Could not parse this job page.' });
  }
};
