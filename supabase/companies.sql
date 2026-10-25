-- Job Sprint 1.2: Companies to track, with people to reach out to.
-- Run once in the Job Sprint V1 Supabase project's SQL Editor. Safe to re-run.
-- Adds one new table. The jobs table is not touched.

create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  -- Lowercased name, used to block duplicates and to match jobs to tracked companies.
  name_key text generated always as (lower(btrim(name))) stored,
  source text not null default '' check (char_length(source) <= 60),
  stage text not null default 'watching'
    check (stage in ('watching', 'reached_out', 'in_conversation', 'referral')),
  stage_updated_by text check (stage_updated_by in ('Garima', 'Indresh')),
  stage_updated_at timestamptz,
  -- [{ id, name, role, link, status: not_contacted | messaged | replied, by, at }]
  people jsonb not null default '[]'::jsonb check (jsonb_typeof(people) = 'array'),
  -- [{ id, text, by, at }] running log, same shape as jobs.notes
  notes jsonb not null default '[]'::jsonb check (jsonb_typeof(notes) = 'array'),
  added_by text not null check (added_by in ('Garima', 'Indresh')),
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists companies_name_key_idx on public.companies(name_key);

-- The browser never talks to Supabase directly. Netlify Functions use the server-side key.
alter table public.companies enable row level security;
revoke all on table public.companies from anon, authenticated;
grant select, insert, update, delete on table public.companies to service_role;
