-- Job Sprint 1.1: Networking stage and notes.
-- Run once in the existing Job Sprint V1 Supabase project's SQL Editor, after schema.sql.
-- Additive only: no columns are dropped or renamed, and it is safe to re-run.

-- 1) Backup of the jobs table before the change, in a schema the Data API does not expose.
create schema if not exists backup;
revoke all on schema backup from anon, authenticated;
create table if not exists backup.jobs_before_networking as table public.jobs;

-- 2) New columns on the existing jobs table.
--    Which tab a job appears in is derived, so there is no separate "location" column to drift:
--      status = 'pipeline'                              -> To apply
--      status = 'applied' and network_closed_at is null -> Networking
--      status = 'blocked', or network_closed_at set     -> History
alter table public.jobs
  add column if not exists network_status text,
  add column if not exists network_updated_by text,
  add column if not exists network_updated_at timestamptz,
  add column if not exists network_closed_by text,
  add column if not exists network_closed_at timestamptz,
  add column if not exists notes jsonb not null default '[]'::jsonb;

do $$ begin
  alter table public.jobs add constraint jobs_network_status_check
    check (network_status in ('not_networked', 'first_pass', 'second_pass', 'successful', 'stale'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.jobs add constraint jobs_network_updated_by_check
    check (network_updated_by in ('Garima', 'Indresh'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.jobs add constraint jobs_network_closed_by_check
    check (network_closed_by in ('Garima', 'Indresh'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.jobs add constraint jobs_notes_is_array_check
    check (jsonb_typeof(notes) = 'array');
exception when duplicate_object then null; end $$;

create index if not exists jobs_stage_idx on public.jobs(status, network_closed_at);

-- 3) Jobs already marked Applied start in Networking as "Not networked".
update public.jobs
set network_status = 'not_networked'
where status = 'applied' and network_status is null;
