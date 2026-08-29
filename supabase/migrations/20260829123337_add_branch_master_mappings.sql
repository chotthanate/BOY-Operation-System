-- Branch-specific availability for shared company master data.
-- Master records stay company-wide; these mappings control what each branch uses.

create table boy_central.branch_expense_items (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references boy_central.branches(id) on delete cascade,
  expense_item_id uuid not null references boy_central.expense_items(id) on delete cascade,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, expense_item_id)
);

create table boy_central.branch_suppliers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references boy_central.branches(id) on delete cascade,
  supplier_id uuid not null references boy_central.suppliers(id) on delete cascade,
  is_preferred boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, supplier_id)
);

create table boy_central.branch_item_suppliers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references boy_central.branches(id) on delete cascade,
  item_id uuid not null references boy_central.items(id) on delete cascade,
  supplier_id uuid not null references boy_central.suppliers(id) on delete cascade,
  supplier_item_code text,
  is_primary boolean not null default false,
  last_purchase_price numeric(18,4) check (last_purchase_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, item_id, supplier_id)
);

create index branch_expense_items_expense_item_id_idx
  on boy_central.branch_expense_items (expense_item_id);
create index branch_suppliers_supplier_id_idx
  on boy_central.branch_suppliers (supplier_id);
create index branch_item_suppliers_item_id_idx
  on boy_central.branch_item_suppliers (item_id);
create index branch_item_suppliers_supplier_id_idx
  on boy_central.branch_item_suppliers (supplier_id);
create unique index branch_item_suppliers_one_primary_idx
  on boy_central.branch_item_suppliers (branch_id, item_id)
  where active and is_primary;

create trigger branch_expense_items_set_updated_at
before update on boy_central.branch_expense_items
for each row execute function boy_central_private.set_updated_at();

create trigger branch_suppliers_set_updated_at
before update on boy_central.branch_suppliers
for each row execute function boy_central_private.set_updated_at();

create trigger branch_item_suppliers_set_updated_at
before update on boy_central.branch_item_suppliers
for each row execute function boy_central_private.set_updated_at();

alter table boy_central.branch_expense_items enable row level security;
alter table boy_central.branch_suppliers enable row level security;
alter table boy_central.branch_item_suppliers enable row level security;

create policy branch_expense_items_branch_select
on boy_central.branch_expense_items
for select to authenticated
using ((select boy_central_private.has_branch_access(branch_id, null)));

create policy branch_suppliers_branch_select
on boy_central.branch_suppliers
for select to authenticated
using ((select boy_central_private.has_branch_access(branch_id, null)));

create policy branch_item_suppliers_branch_select
on boy_central.branch_item_suppliers
for select to authenticated
using ((select boy_central_private.has_branch_access(branch_id, null)));

revoke all on boy_central.branch_expense_items from anon;
revoke all on boy_central.branch_suppliers from anon;
revoke all on boy_central.branch_item_suppliers from anon;

revoke insert, update, delete, truncate, references, trigger
  on boy_central.branch_expense_items, boy_central.branch_suppliers,
     boy_central.branch_item_suppliers
  from authenticated;

grant select
  on boy_central.branch_expense_items, boy_central.branch_suppliers,
     boy_central.branch_item_suppliers
  to authenticated;
