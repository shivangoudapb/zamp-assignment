-- Adds the settings table used by the Rules page (editable tolerances and rule outcomes).
-- Run once in Supabase: SQL Editor → New query → paste → Run. Safe to re-run.

create table if not exists settings (
  id          text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table settings enable row level security;
