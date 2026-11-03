-- Job Sprint: shared Notes tab (interview prep, STAR stories, research, coffee chats…).
-- Run once in the Job Sprint V1 Supabase project's SQL Editor. Additive, safe to re-run.
-- New table only; nothing existing is touched.
create table if not exists public.notes (
  id uuid primary key,
  title text not null default '' check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 100000), -- cleaned HTML (see the notes function)
  color text check (color is null or color in ('sand', 'rose', 'peach', 'mint', 'sky', 'lilac')),
  pinned boolean not null default false,
  labels text[] not null default '{}',
  link_kind text check (link_kind is null or link_kind in ('job', 'company')),
  link_id uuid,
  link_label text check (link_label is null or char_length(link_label) <= 120),
  created_by text not null check (created_by in ('Garima', 'Indresh')),
  created_at timestamptz not null default now(),
  updated_by text check (updated_by is null or updated_by in ('Garima', 'Indresh')),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists notes_link_idx on public.notes (link_id);
alter table public.notes enable row level security;
revoke all on public.notes from anon, authenticated;
grant all on public.notes to service_role;
