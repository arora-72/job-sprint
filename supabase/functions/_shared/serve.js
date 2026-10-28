// Turns a Supabase Edge Function request into the same { httpMethod, headers, body } event the
// handlers were written for, and adds CORS so the GitHub Pages site can call it.
const ALLOWED_ORIGINS = ['https://arora-72.github.io'];
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) || LOCAL.test(origin || '');
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export async function toResponse(handler, req) {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const url = new URL(req.url);
  const event = {
    httpMethod: req.method,
    headers: Object.fromEntries(req.headers),
    queryStringParameters: Object.fromEntries(url.searchParams),
    body: req.method === 'GET' || req.method === 'HEAD' ? null : await req.text(),
  };
  try {
    const out = await handler(event);
    return new Response(out.body ?? '', { status: out.statusCode, headers: { ...(out.headers || {}), ...cors } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err?.message || 'Server error.' }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
  }
}

export function serve(handler) {
  if (typeof globalThis.Deno?.serve !== 'function') return; // imported by tests
  globalThis.Deno.serve((req) => toResponse(handler, req));
}
