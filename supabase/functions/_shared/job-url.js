import { createHash } from 'node:crypto';

const TRACKING_KEYS = new Set(['ref', 'refid', 'trackingid', 'trk', 'trkinfo', 'src', 'source', 'gh_src', 'lever-source', 'lever-origin', 'li_fat_id', 'gclid', 'fbclid', 'origin', 'from', 'referer', 'referrer']);

function normalizeJobUrl(value) {
  const url = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use a valid job link.');
  [...url.searchParams.keys()].forEach((key) => {
    if (key.toLowerCase().startsWith('utm_') || TRACKING_KEYS.has(key.toLowerCase())) url.searchParams.delete(key);
  });
  url.searchParams.sort();
  return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${url.search}`;
}

function sourceKey(value) {
  return createHash('sha256').update(normalizeJobUrl(value)).digest('hex');
}

export { normalizeJobUrl, sourceKey };
