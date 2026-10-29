-- Job Sprint: allow Word (.docx) files as well as PDFs in the private "documents" bucket.
-- Run once in the Job Sprint V1 Supabase project's SQL Editor. Safe to re-run. No table changes.
update storage.buckets
set allowed_mime_types = array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
where id = 'documents';
