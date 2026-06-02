-- Migration: support handoff capture.
--
-- Adds an optional phone number for callbacks and locks the table down with RLS
-- (it holds PII: name, email, phone, transcript). Idempotent.

alter table support_handoffs
  add column if not exists phone text;

alter table support_handoffs enable row level security;
