-- Per-message customer feedback (thumbs up / down) on Mobi's replies.
-- Run this in the Supabase SQL editor (migrations are applied manually).

alter table chat_messages
  add column if not exists feedback text
  check (feedback is null or feedback in ('up', 'down'));
