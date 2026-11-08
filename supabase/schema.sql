-- Invoice Agent — database schema
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run (drops and recreates everything).

drop table if exists run_steps cascade;
drop table if exists runs cascade;
drop table if exists purchase_orders cascade;
drop table if exists vendors cascade;

-- Vendor master: who we are allowed to pay, and their bank details on file.
create table vendors (
  id            text primary key,              -- e.g. V001
  name          text not null,
  aliases       text[] not null default '{}',  -- other names the vendor trades under
  tax_id        text,
  email         text,
  bank_last4    text,                          -- last 4 digits of bank account on file
  status        text not null default 'approved' check (status in ('approved','blocked')),
  created_at    timestamptz not null default now()
);

-- Purchase orders: what we committed to spend, per vendor.
create table purchase_orders (
  po_number     text primary key,              -- e.g. PO-1001
  vendor_id     text not null references vendors(id),
  description   text not null,
  amount        numeric(12,2) not null,        -- total committed amount (incl. tax)
  currency      text not null default 'USD',
  line_items    jsonb not null default '[]',   -- [{description, quantity, unit_price}]
  status        text not null default 'open' check (status in ('open','closed')),
  created_at    timestamptz not null default now()
);

-- One row per invoice processed. Holds the extraction, the decision and the reasons.
create table runs (
  id                   uuid primary key default gen_random_uuid(),
  run_no               bigint generated always as identity,
  source               text not null default 'upload' check (source in ('upload','seed')),
  status               text not null default 'running' check (status in ('running','done','failed')),
  file_name            text,
  file_path            text,                   -- path inside the 'invoices' storage bucket
  file_hash            text,                   -- sha256 of the uploaded file
  extracted            jsonb,                  -- raw structured extraction from Gemini
  vendor_id            text references vendors(id),
  vendor_name          text,                   -- as printed on the invoice
  invoice_number       text,
  invoice_number_norm  text,                   -- uppercase, symbols stripped (INV-0457 → INV0457)
  invoice_date         date,
  po_number            text,                   -- matched / inferred PO
  po_match_method      text,                   -- explicit | inferred | none
  currency             text,
  total                numeric(12,2),
  decision             text check (decision in ('APPROVE','HOLD','REJECT')),
  summary              text,                   -- one-line plain-English explanation
  next_action          text,
  reasons              jsonb not null default '[]', -- [{code, severity, stage, message}]
  review_decision      text check (review_decision in ('APPROVE','REJECT')),
  review_note          text,
  reviewed_at          timestamptz,
  error                text,
  duration_ms          integer,
  created_at           timestamptz not null default now(),
  finished_at          timestamptz
);
create index runs_created_idx on runs (created_at desc);
create index runs_vendor_inv_idx on runs (vendor_id, invoice_number_norm);
create index runs_po_idx on runs (po_number);

-- One row per pipeline stage per run. The live run view polls these.
create table run_steps (
  id           bigint generated always as identity primary key,
  run_id       uuid not null references runs(id) on delete cascade,
  seq          integer not null,
  stage        text not null,               -- ingest | extract | validate | vendor | po_match | checks | decide
  label        text not null,
  status       text not null default 'pending' check (status in ('pending','running','done','warn','failed','skipped')),
  summary      text,
  detail       jsonb,
  started_at   timestamptz,
  finished_at  timestamptz,
  unique (run_id, stage)
);
create index run_steps_run_idx on run_steps (run_id, seq);

-- The app only talks to the database from the server using the service-role key,
-- so we enable RLS with no policies: the public anon key can read nothing.
alter table vendors          enable row level security;
alter table purchase_orders  enable row level security;
alter table runs             enable row level security;
alter table run_steps        enable row level security;

-- Private storage bucket for uploaded invoice files.
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;
