-- Job Sprint: PDFs. Files attached to a job, and a shared library of standard resumes.
-- Run once in the Job Sprint V1 Supabase project's SQL Editor. Additive, safe to re-run.

-- 1) Backup of the jobs table before the change, in a schema the Data API does not expose.
create schema if not exists backup;
revoke all on schema backup from anon, authenticated;
create table if not exists backup.jobs_before_files as table public.jobs;

-- 2) One row per file. The file itself lives in the private "documents" bucket at `path`.
create table if not exists public.documents (
  id uuid primary key,
  kind text not null check (kind in ('resume', 'attachment')),
  job_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  role_tag text check (role_tag is null or char_length(role_tag) <= 80),
  is_default boolean not null default false,
  path text not null unique,
  pending_path text,
  size_bytes integer not null default 0,
  ready boolean not null default false,
  uploaded_by text not null check (uploaded_by in ('Garima', 'Indresh')),
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists documents_job_id_idx on public.documents (job_id);
alter table public.documents enable row level security;
revoke all on public.documents from anon, authenticated;
grant all on public.documents to service_role;

-- 3) Which standard resume was sent for a job (empty = not recorded).
alter table public.jobs add column if not exists resume_id uuid;

-- 4) Private bucket: PDFs only, 10 MB each. Only the server functions can sign links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];
