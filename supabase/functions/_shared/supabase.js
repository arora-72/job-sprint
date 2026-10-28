// Server-side access to the Job Sprint database. The browser never sees the key.
// Works on Supabase Edge Functions (Deno) and in the Node tests.
export function env(name) {
  return globalThis.Deno?.env?.get(name) ?? globalThis.process?.env?.[name];
}

// Edge Functions get the project's keys automatically. Prefer a modern secret key, else the
// legacy service_role key. A custom SUPABASE_SECRET_KEY (used by the tests) wins if set.
function secretKey() {
  const custom = env('SUPABASE_SECRET_KEY');
  if (custom) return custom;
  try {
    const keys = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}');
    const first = keys.default || Object.values(keys)[0];
    if (first) return first;
  } catch { /* fall through */ }
  return env('SUPABASE_SERVICE_ROLE_KEY');
}

export async function supabase(path, { method = 'GET', body, headers = {} } = {}) {
  const url = env('SUPABASE_URL');
  const key = secretKey();
  if (!url || !key) throw new Error('Missing SUPABASE_URL or a server key.');
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      // Legacy keys are JWTs and also go in Authorization; modern sb_secret_ keys must not.
      ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.message || data?.hint || `Supabase request failed (${res.status})`);
  return data;
}
