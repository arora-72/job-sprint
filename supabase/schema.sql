create extension if not exists pgcrypto;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  title text not null,
  location text default '',
  url text not null,
  status text not null default 'pipeline' check (status in ('pipeline','applied','blocked')),
  added_by text not null check (added_by in ('Garima','Indresh')),
  added_at timestamptz not null default now(),
  applied_by text check (applied_by in ('Garima','Indresh')),
  applied_at timestamptz,
  blocked_by text check (blocked_by in ('Garima','Indresh')),
  blocked_at timestamptz,
  blocked_reason text default '',
  updated_at timestamptz not null default now()
);

create index if not exists jobs_status_idx on public.jobs(status);
create index if not exists jobs_added_at_idx on public.jobs(added_at desc);

-- The browser never talks to Supabase directly. Netlify Functions use the
-- server-side service-role key, so RLS can remain enabled and deny public access.
alter table public.jobs enable row level security;

-- The project does not automatically grant Data API access to new tables.
-- Only the server-side role used by Netlify may reach this table.
revoke all on table public.jobs from anon, authenticated;
grant select, insert, update on table public.jobs to service_role;
