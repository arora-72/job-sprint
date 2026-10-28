-- Job Sprint: priority order for the To apply list.
-- Run once in the Job Sprint V1 Supabase project's SQL Editor. Additive, safe to re-run.

-- 1) Backup of the jobs table before the change, in a schema the Data API does not expose.
create schema if not exists backup;
revoke all on schema backup from anon, authenticated;
create table if not exists backup.jobs_before_priority as table public.jobs;

-- 2) A number per job: smaller = higher in the list. Empty = new, waiting in "To rank".
--    The first time only, open jobs get ranks in the same order the Date added view shows them
--    (backlog oldest first, then today's newest first, Pittsburgh time), so nothing looks scrambled.
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'jobs' and column_name = 'priority') then
    alter table public.jobs add column priority double precision;
    with today as (select (date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York') as t0),
    ranked as (
      select j.id, row_number() over (
        order by (j.added_at >= today.t0),
                 case when j.added_at >= today.t0 then -extract(epoch from j.added_at) else extract(epoch from j.added_at) end,
                 j.id) as n
      from public.jobs j cross join today
      where j.status = 'pipeline'
    )
    update public.jobs j set priority = ranked.n from ranked where ranked.id = j.id;
  end if;
end $$;
