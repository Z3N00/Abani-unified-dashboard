-- Read-optimized projection for the Containers list.
-- This does not alter any existing production table or production row.
-- Run this file in Supabase SQL Editor after reviewing it.

create table if not exists public.container_dashboard_snapshot (
  container_id text primary key,
  container_number text not null,
  payload jsonb not null,
  docs_status text not null default 'DOCS_PENDING',
  source_updated_at timestamp without time zone,
  snapshot_updated_at timestamptz not null default now()
);

create index if not exists idx_container_dashboard_snapshot_number
  on public.container_dashboard_snapshot (container_number);

create index if not exists idx_container_dashboard_snapshot_source_updated
  on public.container_dashboard_snapshot (source_updated_at desc);

alter table public.container_dashboard_snapshot enable row level security;

-- No browser policies are added. The dashboard reads this projection with its
-- server-only service-role client.

create or replace function public.container_dashboard_docs_status(p_container_id text)
returns text
language sql
stable
set search_path = public
as $$
  select case coalesce(min(
    case coalesce(v.status::text, 'DOCS_PENDING')
      when 'DOCS_PENDING' then 0
      when 'DOCS_UPLOADED' then 1
      when 'REVIEWED' then 2
      when 'IN_SELLERCLOUD' then 3
      when 'CUSTOMS_CLEARED' then 4
      when 'PAID' then 5
      else 0
    end
  ), 0)
    when 0 then 'DOCS_PENDING'
    when 1 then 'DOCS_UPLOADED'
    when 2 then 'REVIEWED'
    when 3 then 'IN_SELLERCLOUD'
    when 4 then 'CUSTOMS_CLEARED'
    when 5 then 'PAID'
    else 'DOCS_PENDING'
  end
  from public."ContainerDocEntry" e
  left join public."ContainerDocVendor" v on v."entryId" = e.id
  where e."containerId" = p_container_id;
$$;

create or replace function public.refresh_container_dashboard_snapshot(p_container_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.container_dashboard_snapshot (
    container_id,
    container_number,
    payload,
    docs_status,
    source_updated_at,
    snapshot_updated_at
  )
  select
    c.id,
    coalesce(c."containerName", 'Untitled container'),
    to_jsonb(c) || jsonb_build_object(
      'warehouseName', w.name,
      'docsStatus', public.container_dashboard_docs_status(c.id)
    ),
    public.container_dashboard_docs_status(c.id),
    c."updatedAt",
    now()
  from public."Container" c
  left join public."Warehouse" w on w.id = c."warehouseId"
  where c.id = p_container_id
  on conflict (container_id) do update set
    container_number = excluded.container_number,
    payload = excluded.payload,
    docs_status = excluded.docs_status,
    source_updated_at = excluded.source_updated_at,
    snapshot_updated_at = excluded.snapshot_updated_at;

  if not found then
    delete from public.container_dashboard_snapshot
    where container_id = p_container_id;
  end if;
end;
$$;

create or replace function public.refresh_all_container_dashboard_snapshots()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_container record;
  refreshed_count integer := 0;
begin
  delete from public.container_dashboard_snapshot;

  for current_container in select id from public."Container"
  loop
    perform public.refresh_container_dashboard_snapshot(current_container.id);
    refreshed_count := refreshed_count + 1;
  end loop;

  return refreshed_count;
end;
$$;

create or replace function public.sync_container_dashboard_snapshot_from_container()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.container_dashboard_snapshot where container_id = old.id;
    return old;
  end if;

  perform public.refresh_container_dashboard_snapshot(new.id);
  return new;
end;
$$;

create or replace function public.sync_container_dashboard_snapshot_from_warehouse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_container record;
  target_id text;
begin
  target_id := case when tg_op = 'DELETE' then old.id else new.id end;

  for current_container in
    select id from public."Container" where "warehouseId" = target_id
  loop
    perform public.refresh_container_dashboard_snapshot(current_container.id);
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.sync_container_dashboard_snapshot_from_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old."containerId" is not null then
    perform public.refresh_container_dashboard_snapshot(old."containerId");
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new."containerId" is not null then
    perform public.refresh_container_dashboard_snapshot(new."containerId");
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.sync_container_dashboard_snapshot_from_vendor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_entry_id text;
  target_container_id text;
begin
  target_entry_id := case when tg_op = 'DELETE' then old."entryId" else new."entryId" end;

  select "containerId" into target_container_id
  from public."ContainerDocEntry"
  where id = target_entry_id;

  if target_container_id is not null then
    perform public.refresh_container_dashboard_snapshot(target_container_id);
  end if;

  if tg_op = 'UPDATE' and old."entryId" is distinct from new."entryId" then
    select "containerId" into target_container_id
    from public."ContainerDocEntry"
    where id = old."entryId";

    if target_container_id is not null then
      perform public.refresh_container_dashboard_snapshot(target_container_id);
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_container_dashboard_snapshot_container on public."Container";
create trigger trg_container_dashboard_snapshot_container
after insert or update or delete on public."Container"
for each row execute function public.sync_container_dashboard_snapshot_from_container();

drop trigger if exists trg_container_dashboard_snapshot_warehouse on public."Warehouse";
create trigger trg_container_dashboard_snapshot_warehouse
after update or delete on public."Warehouse"
for each row execute function public.sync_container_dashboard_snapshot_from_warehouse();

drop trigger if exists trg_container_dashboard_snapshot_entry on public."ContainerDocEntry";
create trigger trg_container_dashboard_snapshot_entry
after insert or update or delete on public."ContainerDocEntry"
for each row execute function public.sync_container_dashboard_snapshot_from_entry();

drop trigger if exists trg_container_dashboard_snapshot_vendor on public."ContainerDocVendor";
create trigger trg_container_dashboard_snapshot_vendor
after insert or update or delete on public."ContainerDocVendor"
for each row execute function public.sync_container_dashboard_snapshot_from_vendor();

-- These maintenance functions are not browser APIs.
revoke execute on function public.container_dashboard_docs_status(text) from public, anon, authenticated;
revoke execute on function public.refresh_container_dashboard_snapshot(text) from public, anon, authenticated;
revoke execute on function public.refresh_all_container_dashboard_snapshots() from public, anon, authenticated;
revoke execute on function public.sync_container_dashboard_snapshot_from_container() from public, anon, authenticated;
revoke execute on function public.sync_container_dashboard_snapshot_from_warehouse() from public, anon, authenticated;
revoke execute on function public.sync_container_dashboard_snapshot_from_entry() from public, anon, authenticated;
revoke execute on function public.sync_container_dashboard_snapshot_from_vendor() from public, anon, authenticated;

-- Initial backfill. Future changes are maintained by the triggers above.
select public.refresh_all_container_dashboard_snapshots();
