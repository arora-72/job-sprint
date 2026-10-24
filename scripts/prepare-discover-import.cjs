const fs = require('node:fs');
const path = require('node:path');
const { sourceKey } = require('../netlify/functions/_job-url');

const root = path.resolve(__dirname, '..');
const inputPath = path.resolve(process.argv[2] || path.join(root, 'supabase/discover-initial.json'));
const outputPath = path.resolve(process.argv[3] || path.join(root, 'supabase/discover-initial.sql'));
const rows = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (!Array.isArray(rows) || rows.some((role) => !['S', 'A'].includes(role.fit_tier) || !role.company || !role.title || !role.url)) {
  throw new Error('Import must be an array of S/A roles with company, title, and official job URL.');
}
const quote = (value) => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const fields = ['source_key', 'company', 'title', 'location', 'url', 'fit_tier', 'fit_score', 'why_fit', 'found_at', 'posted_at', 'source_name'];
const values = rows.map((role) => {
  const complete = { ...role, source_key: sourceKey(role.url) };
  return `(${fields.map((field) => quote(complete[field])).join(', ')})`;
});
const sql = `insert into public.discover_jobs (${fields.join(', ')})\nvalues\n${values.join(',\n')}\non conflict (source_key) do update set\n  company = excluded.company, title = excluded.title, location = excluded.location,\n  url = excluded.url, fit_tier = excluded.fit_tier, fit_score = excluded.fit_score,\n  why_fit = excluded.why_fit, found_at = excluded.found_at, posted_at = excluded.posted_at,\n  source_name = excluded.source_name, updated_at = now();\n`;
fs.writeFileSync(outputPath, sql);
console.log(`Prepared ${rows.length} Discover roles.`);
