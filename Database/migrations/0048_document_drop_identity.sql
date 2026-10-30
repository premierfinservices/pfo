-- ===========================================================================
-- 0048 — The document drop: what a file was called, and what it contains (ADR-040)
--
-- Files are now stored under a standard name ("PAN Card - NAME.pdf"), so the
-- name the customer sent is kept in `original_file_name`, never lost.
--
-- `content_sha256` is the file's own fingerprint. A repeat is the same bytes,
-- whatever it is called: the same scan sent twice on WhatsApp has two names.
-- Rows from before this column have neither, and are still caught by name and
-- size.
-- ===========================================================================

alter table document
  add column original_file_name text,
  add column content_sha256 text;

comment on column document.original_file_name is
  'The name the file arrived with, when PFO stored it under a standard name instead.';
comment on column document.content_sha256 is
  'SHA-256 of the file''s bytes, hex. Null on documents uploaded before the document drop.';

create index document_content_sha256_idx on document (content_sha256) where content_sha256 is not null;
