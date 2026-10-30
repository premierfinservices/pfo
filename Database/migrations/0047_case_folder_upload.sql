-- ===========================================================================
-- 0047 — Uploading a case folder (ADR-040)
--
-- One requirement row, one file. Monthly GST returns and multi-page deeds are
-- many files of one type for one person, and matching a document to its row by
-- type and person alone would show only the newest. So a row now remembers the
-- file uploaded against it.
--
-- `financial_summary` holds the `GST and ITR Summary.txt` the organize skill
-- writes, so the eligibility question can sit beside the figures. PFO works
-- these figures out itself in a later step; until then it shows that file.
-- ===========================================================================

alter table document_requirement
  add column uploaded_document_id uuid references document (id);

comment on column document_requirement.uploaded_document_id is
  'The file uploaded against this row. Null on rows from before this column, which '
  'still find their document by type, person and period.';

alter table loan_case
  add column financial_summary text,
  add column financial_summary_at timestamptz;
