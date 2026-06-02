-- Migration: proper, secure chat customer identity.
--
-- Adds a dedicated chat_customers table for the visitor's name + email and
-- links chat_sessions to it with a real foreign key, instead of keeping the
-- details inside the chat_sessions.metadata JSON blob.
--
-- Safe to run on an existing database (idempotent).

create extension if not exists pgcrypto;

-- 1. Customer identity table. The email column is unique (the server stores it
-- lowercased), which matches the server's ON CONFLICT (email) upsert.
create table if not exists chat_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint chat_customers_email_format check (email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$')
);

-- 2. Link chat_sessions to the customer.
alter table chat_sessions
  add column if not exists customer_id uuid references chat_customers(id) on delete cascade;

create index if not exists chat_sessions_customer_id_idx
  on chat_sessions (customer_id);

create index if not exists chat_messages_session_id_idx
  on chat_messages (session_id);

-- 3. Backfill customers from any existing sessions that stored name/email in metadata.
insert into chat_customers (name, email)
select distinct on (lower(s.metadata ->> 'customer_email'))
  s.metadata ->> 'customer_name' as name,
  lower(s.metadata ->> 'customer_email') as email
from chat_sessions s
where s.metadata ->> 'customer_email' is not null
  and s.metadata ->> 'customer_name' is not null
  and s.metadata ->> 'customer_email' ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
order by lower(s.metadata ->> 'customer_email'), s.created_at
on conflict (lower(email)) do nothing;

update chat_sessions s
set customer_id = c.id
from chat_customers c
where s.customer_id is null
  and lower(s.metadata ->> 'customer_email') = lower(c.email);

-- 4. Lock down the personal-data tables. RLS with no policies blocks the
-- anon/authenticated roles entirely; the bot server's service-role key bypasses
-- RLS, so server access is unaffected.
alter table chat_customers enable row level security;
alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;
