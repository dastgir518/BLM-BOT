-- Migration: persist a per-customer profile.
--
-- Stores the facts the bot learns about a customer (age, weight, mobility
-- condition, product preferences) so they can be remembered for our records and
-- for future verified recall. Safe to run on an existing database (idempotent).

alter table chat_customers
  add column if not exists profile jsonb not null default '{}'::jsonb;
