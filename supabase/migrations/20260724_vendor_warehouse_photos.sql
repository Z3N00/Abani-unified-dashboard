-- Warehouse arrival evidence belongs to a specific vendor/SellerCloud package.
-- Existing rows predate that relationship, so assign them to the first package
-- in their documentation entry to preserve visibility without showing them in
-- every vendor tab.
alter table public."ContainerWarehousePhoto"
  add column if not exists "containerDocVendorId" text;

update public."ContainerWarehousePhoto" photo
set "containerDocVendorId" = (
  select v.id
  from public."ContainerDocVendor" v
  where v."entryId" = photo."entryId"
  order by v."createdAt" asc nulls last, v.id asc
  limit 1
)
where photo."containerDocVendorId" is null;

alter table public."ContainerWarehousePhoto"
  drop constraint if exists "ContainerWarehousePhoto_containerDocVendorId_fkey";

alter table public."ContainerWarehousePhoto"
  add constraint "ContainerWarehousePhoto_containerDocVendorId_fkey"
  foreign key ("containerDocVendorId")
  references public."ContainerDocVendor"(id)
  on delete cascade;

create index if not exists "ContainerWarehousePhoto_containerDocVendorId_idx"
  on public."ContainerWarehousePhoto" ("containerDocVendorId");
