-- Job Sprint 1.4: Owner (assigned to Garima or Indresh) on jobs and companies.
-- Run once in the Job Sprint V1 Supabase project's SQL Editor. Additive, safe to re-run.

-- 1) Backup of the jobs table before the change, in a schema the Data API does not expose.
create schema if not exists backup;
revoke all on schema backup from anon, authenticated;
create table if not exists backup.jobs_before_assign as table public.jobs;

-- 2) Jobs: existing jobs go to whoever added them. This runs only the first time, when the column is created,
--    so re-running the file never overwrites owners you changed later.
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'jobs' and column_name = 'assigned_to') then
    alter table public.jobs add column assigned_to text;
    update public.jobs set assigned_to = added_by;
  end if;
end $$;

-- 3) Companies: owner starts empty (Unassigned).
alter table public.companies add column if not exists assigned_to text;

do $$ begin
  alter table public.jobs add constraint jobs_assigned_to_check check (assigned_to in ('Garima', 'Indresh'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.companies add constraint companies_assigned_to_check check (assigned_to in ('Garima', 'Indresh'));
exception when duplicate_object then null; end $$;
