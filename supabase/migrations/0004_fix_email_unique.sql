-- Migration: fix chat_customers email uniqueness.
--
-- Earlier 0001 created a unique index on lower(email) (an expression index),
-- but the server upserts with ON CONFLICT (email), which needs a unique
-- constraint on the email column itself. This replaces the expression index
-- with a column-level unique constraint. Idempotent.

drop index if exists chat_customers_email_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chat_customers_email_unique'
  ) then
    alter table chat_customers add constraint chat_customers_email_unique unique (email);
  end if;
end $$;
