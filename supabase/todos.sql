-- Job Sprint: personal to-do lists (one for Garima, one for Indresh).
-- Run once in the Job Sprint V1 Supabase project's SQL Editor. Safe to re-run.
-- Adds one new table. Existing tables are not touched.

create extension if not exists pgcrypto;

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  -- Whose list the item is on.
  owner text not null check (owner in ('Garima', 'Indresh')),
  text text not null check (char_length(btrim(text)) between 1 and 500),
  done boolean not null default false,
  done_at timestamptz,
  done_by text check (done_by in ('Garima', 'Indresh')),
  -- Order within the list. Moving an item gives it a number between its new neighbours.
  position double precision not null default 0,
  due_on date,
  -- Optional link to a job or a tracked company. The label is kept so the chip still reads
  -- correctly if the job or company is later deleted.
  link_kind text check (link_kind in ('job', 'company')),
  link_id uuid,
  link_label text check (char_length(link_label) <= 120),
  added_by text not null check (added_by in ('Garima', 'Indresh')),
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists todos_owner_position_idx on public.todos(owner, done, position);

-- The browser never talks to Supabase directly. Netlify Functions use the server-side key.
alter table public.todos enable row level security;
revoke all on table public.todos from anon, authenticated;
grant select, insert, update, delete on table public.todos to service_role;
