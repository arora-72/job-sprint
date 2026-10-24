-- Run once in the existing Job Sprint V1 Supabase project's SQL Editor.
create table if not exists public.discover_jobs (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  company text not null,
  title text not null,
  location text not null default '',
  url text not null,
  fit_tier text not null check (fit_tier in ('S', 'A')),
  fit_score integer check (fit_score between 0 and 100),
  why_fit text not null default '',
  found_at date not null default current_date,
  posted_at date,
  source_name text not null default 'Role watch',
  status text not null default 'new' check (status in ('new', 'dismissed', 'added')),
  acted_by text check (acted_by in ('Garima', 'Indresh')),
  acted_at timestamptz,
  pipeline_job_id uuid references public.jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists discover_jobs_queue_idx on public.discover_jobs(status, fit_tier, fit_score desc, found_at desc);
alter table public.discover_jobs enable row level security;
revoke all on table public.discover_jobs from anon, authenticated;
grant select, insert, update on table public.discover_jobs to service_role;
