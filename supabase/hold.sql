-- Job Sprint: "On hold" for jobs in To apply (waiting on a referral, coffee chats, ...).
-- Run once in the Job Sprint V1 Supabase project's SQL Editor. Additive, safe to re-run.

-- 1) Backup of the jobs table before the change, in a schema the Data API does not expose.
create schema if not exists backup;
revoke all on schema backup from anon, authenticated;
create table if not exists backup.jobs_before_hold as table public.jobs;

-- 2) Hold columns. Empty = not on hold. Existing jobs are untouched.
alter table public.jobs add column if not exists hold_reason text;
alter table public.jobs add column if not exists hold_since timestamptz;
alter table public.jobs add column if not exists hold_by text;
