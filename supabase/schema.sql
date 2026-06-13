create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists product_documents (
  id text primary key,
  product_id bigint not null,
  chunk_index integer not null,
  title text not null,
  content text not null,
  url text,
  sku text,
  price numeric,
  stock_status text,
  categories text[] default '{}',
  metadata jsonb default '{}'::jsonb,
  embedding vector(1536) not null,
  updated_at timestamptz not null default now()
);

create index if not exists product_documents_product_id_idx
  on product_documents (product_id);

create index if not exists product_documents_stock_status_idx
  on product_documents (stock_status);

create index if not exists product_documents_categories_idx
  on product_documents using gin (categories);

create index if not exists product_documents_embedding_idx
  on product_documents using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create table if not exists page_documents (
  id text primary key,
  page_id bigint,
  chunk_index integer not null,
  title text not null,
  content text not null,
  url text,
  metadata jsonb default '{}'::jsonb,
  embedding vector(1536) not null,
  updated_at timestamptz not null default now()
);

create index if not exists page_documents_embedding_idx
  on page_documents using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create table if not exists sync_events (
  id bigint generated always as identity primary key,
  source text not null,
  event_type text not null,
  entity_type text not null,
  entity_id text,
  status text not null,
  payload jsonb,
  error text,
  created_at timestamptz not null default now()
);

-- Customer identity captured when the chat is started (name + email).
-- This is the canonical store for the visitor's details; sessions link to it.
-- The email is stored lowercased by the server, so a column-level unique gives
-- one row per address and matches the server's ON CONFLICT (email) upsert.
create table if not exists chat_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint chat_customers_email_format check (email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$')
);

create table if not exists chat_sessions (
  id text primary key,
  customer_id uuid references chat_customers(id) on delete cascade,
  codex_thread_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb default '{}'::jsonb
);

create index if not exists chat_sessions_customer_id_idx
  on chat_sessions (customer_id);

create table if not exists chat_messages (
  id bigint generated always as identity primary key,
  session_id text references chat_sessions(id) on delete cascade,
  role text not null,
  content text not null,
  feedback text check (feedback is null or feedback in ('up', 'down')),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_session_id_idx
  on chat_messages (session_id);

-- Lock down the tables that hold personal data. Row Level Security with no
-- policies denies all access to the anon/authenticated roles; only the bot
-- server, which connects with the service-role key, can read or write them.
alter table chat_customers enable row level security;
alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;

create table if not exists support_handoffs (
  id bigint generated always as identity primary key,
  session_id text,
  name text,
  email text,
  phone text,
  reason text not null,
  transcript jsonb,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

alter table support_handoffs enable row level security;

create or replace function match_product_documents (
  query_embedding vector(1536),
  match_count int default 8,
  filter_category text default null,
  filter_stock_status text default null
)
returns table (
  id text,
  product_id bigint,
  title text,
  content text,
  url text,
  sku text,
  price numeric,
  stock_status text,
  categories text[],
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    product_documents.id,
    product_documents.product_id,
    product_documents.title,
    product_documents.content,
    product_documents.url,
    product_documents.sku,
    product_documents.price,
    product_documents.stock_status,
    product_documents.categories,
    product_documents.metadata,
    1 - (product_documents.embedding <=> query_embedding) as similarity
  from product_documents
  where
    (filter_category is null or filter_category = any(product_documents.categories))
    and (filter_stock_status is null or product_documents.stock_status = filter_stock_status)
  order by product_documents.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function match_page_documents (
  query_embedding vector(1536),
  match_count int default 8
)
returns table (
  id text,
  page_id bigint,
  title text,
  content text,
  url text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    page_documents.id,
    page_documents.page_id,
    page_documents.title,
    page_documents.content,
    page_documents.url,
    page_documents.metadata,
    1 - (page_documents.embedding <=> query_embedding) as similarity
  from page_documents
  order by page_documents.embedding <=> query_embedding
  limit match_count;
$$;
