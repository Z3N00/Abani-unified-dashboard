-- Read-optimized Sellercloud inventory cache for the Containers overview.
-- This migration is intentionally NOT executed automatically by the application.
-- Run it in Supabase SQL Editor only after review.

create table if not exists public.inventory (
  sku text not null,
  warehouse text not null default 'Main',
  warehouse_id text not null default '',
  product_name text not null default '',
  qty_on_hand integer not null default 0,
  qty_available integer not null default 0,
  qty_reserved integer not null default 0,
  qty_inbound integer not null default 0,
  sold_30 integer not null default 0,
  velocity_30d numeric not null default 0,
  days_of_stock numeric not null default 0,
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source_data jsonb not null default '{}'::jsonb,
  primary key (sku, warehouse)
);

create index if not exists idx_inventory_sku on public.inventory (sku);
create index if not exists idx_inventory_warehouse on public.inventory (warehouse);
create index if not exists idx_inventory_synced_at on public.inventory (synced_at desc);

create table if not exists public.inventory_sync_state (
  source text primary key,
  completed_at timestamptz,
  records_synced integer not null default 0,
  next_page integer not null default 1,
  status text not null default 'idle',
  error_message text,
  updated_at timestamptz not null default now()
);

-- Safe when the table was created before this migration was updated.
alter table public.inventory_sync_state add column if not exists next_page integer not null default 1;

alter table public.inventory enable row level security;
alter table public.inventory_sync_state enable row level security;

-- No browser-facing policies: the dashboard reads this through its server only.
