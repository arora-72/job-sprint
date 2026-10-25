-- Job Sprint 1.3: Notes on Discover roles. Additive only, safe to re-run.
-- When a role is added to the pipeline, its notes are copied onto the new job.
alter table public.discover_jobs
  add column if not exists notes jsonb not null default '[]'::jsonb;

do $$ begin
  alter table public.discover_jobs add constraint discover_jobs_notes_is_array_check
    check (jsonb_typeof(notes) = 'array');
exception when duplicate_object then null; end $$;
