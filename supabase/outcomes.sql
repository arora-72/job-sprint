-- Job Sprint: outcomes after applying (interview, offer, rejected, withdrawn), for Analytics.
-- Run once in the Job Sprint V1 Supabase project's SQL Editor. Additive, safe to re-run.

-- 1) Backup of the jobs table before the change, in a schema the Data API does not expose.
create schema if not exists backup;
revoke all on schema backup from anon, authenticated;
create table if not exists backup.jobs_before_outcomes as table public.jobs;

-- 2) Outcome columns. Empty = no outcome yet. interview_at is the first time the job reached
--    an interview, and stays set even if a rejection comes later.
alter table public.jobs add column if not exists outcome text;
alter table public.jobs add column if not exists outcome_at timestamptz;
alter table public.jobs add column if not exists outcome_by text;
alter table public.jobs add column if not exists interview_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_outcome_check') then
    alter table public.jobs add constraint jobs_outcome_check check (outcome is null or outcome in ('interview', 'offer', 'rejected', 'withdrawn'));
  end if;
end $$;
