create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  timezone text not null default 'Asia/Bangkok',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  code text not null,
  name text not null,
  branch_type text not null default 'store',
  timezone text not null default 'Asia/Bangkok',
  active boolean not null default true,
  opened_at time,
  closed_at time,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (company_id, name)
);

create table public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  branch_id uuid not null references public.branches(id),
  code text not null,
  name text not null,
  location_type text not null default 'store',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (branch_id, name)
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  display_name text not null,
  employee_code text,
  company_role text not null default 'staff'
    check (company_role in ('admin', 'manager', 'staff', 'viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, employee_code)
);

create table public.user_branch_roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  role text not null check (role in ('admin', 'manager', 'staff', 'viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, branch_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  code text not null,
  name text not null,
  category_type text not null check (category_type in ('item', 'expense', 'menu')),
  parent_id uuid references public.categories(id),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, category_type, code)
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  code text not null,
  name text not null,
  symbol text,
  unit_type text not null default 'count',
  decimal_places smallint not null default 2 check (decimal_places between 0 and 6),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (company_id, name)
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  code text not null,
  name text not null,
  category_id uuid references public.categories(id),
  base_unit_id uuid not null references public.units(id),
  track_stock boolean not null default false,
  purchaseable boolean not null default true,
  issueable boolean not null default true,
  sellable boolean not null default false,
  active boolean not null default true,
  legacy_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (company_id, name)
);

create table public.item_units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  item_id uuid not null references public.items(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  conversion_to_base numeric(18,6) not null check (conversion_to_base > 0),
  is_base_unit boolean not null default false,
  allow_purchase boolean not null default true,
  allow_issue boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, unit_id)
);

create table public.branch_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  branch_id uuid not null references public.branches(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  default_location_id uuid references public.inventory_locations(id),
  minimum_stock numeric(18,6) not null default 0,
  reorder_point numeric(18,6) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, item_id)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  code text not null,
  name text not null,
  supplier_type text,
  tax_id text,
  phone text,
  email text,
  address text,
  payment_terms text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (company_id, name)
);

create table public.item_suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  item_id uuid not null references public.items(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  supplier_item_code text,
  is_primary boolean not null default false,
  last_purchase_price numeric(18,4),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, supplier_id)
);

create table public.expense_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  code text not null,
  name text not null,
  category_id uuid not null references public.categories(id),
  item_id uuid references public.items(id),
  affects_stock boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (company_id, name)
);

create table public.menus (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  code text not null,
  name text not null,
  category_id uuid references public.categories(id),
  base_price numeric(18,2) not null default 0 check (base_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  menu_id uuid not null references public.menus(id) on delete cascade,
  item_id uuid not null references public.items(id),
  quantity_base numeric(18,6) not null check (quantity_base >= 0),
  wastage_percent numeric(9,4) not null default 0 check (wastage_percent between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (menu_id, item_id)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  branch_id uuid not null references public.branches(id),
  transaction_no text not null,
  transaction_type text not null check (transaction_type in (
    'income', 'expense', 'purchase', 'sale', 'sale_void', 'platform_fee',
    'settlement', 'adjustment', 'transfer', 'stock_count', 'opening_balance'
  )),
  transaction_date date not null,
  occurred_at timestamptz not null default now(),
  supplier_id uuid references public.suppliers(id),
  parent_transaction_id uuid references public.transactions(id),
  subtotal numeric(18,2) not null default 0,
  discount numeric(18,2) not null default 0,
  tax numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null default 0,
  status text not null default 'confirmed' check (status in ('draft', 'pending_review', 'confirmed', 'voided', 'rejected')),
  affects_stock boolean not null default false,
  source_system text not null,
  external_id text,
  idempotency_key text not null,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  void_reason text,
  unique (company_id, transaction_no),
  unique (company_id, source_system, idempotency_key)
);

create unique index transactions_external_source_uidx
  on public.transactions (company_id, source_system, external_id)
  where external_id is not null;

create table public.transaction_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  transaction_id uuid not null references public.transactions(id),
  line_no integer not null check (line_no > 0),
  item_id uuid references public.items(id),
  expense_item_id uuid references public.expense_items(id),
  supplier_id uuid references public.suppliers(id),
  supplier_name_raw text,
  description text not null,
  quantity numeric(18,6) not null default 0,
  unit_id uuid references public.units(id),
  conversion_to_base numeric(18,6) not null default 1 check (conversion_to_base > 0),
  base_quantity numeric(18,6) not null default 0,
  unit_price numeric(18,4) not null default 0,
  discount numeric(18,2) not null default 0,
  tax numeric(18,2) not null default 0,
  line_total numeric(18,2) not null default 0,
  unit_cost_base numeric(18,6),
  lot_no text,
  manufactured_on date,
  expires_on date,
  note text,
  created_at timestamptz not null default now(),
  unique (transaction_id, line_no)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  transaction_id uuid not null references public.transactions(id),
  method text not null check (method in ('cash', 'transfer', 'grab', 'thai_co_pay', 'other')),
  amount numeric(18,2) not null check (amount >= 0),
  reference_no text,
  paid_at timestamptz,
  status text not null default 'paid' check (status in ('pending', 'paid', 'refunded', 'voided')),
  created_by uuid references auth.users(id),
  note text,
  created_at timestamptz not null default now()
);

create table public.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  branch_id uuid not null references public.branches(id),
  location_id uuid not null references public.inventory_locations(id),
  item_id uuid not null references public.items(id),
  quantity_on_hand numeric(18,6) not null default 0,
  average_unit_cost numeric(18,6) not null default 0,
  inventory_value numeric(18,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (location_id, item_id)
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  branch_id uuid not null references public.branches(id),
  location_id uuid not null references public.inventory_locations(id),
  item_id uuid not null references public.items(id),
  transaction_id uuid references public.transactions(id),
  transaction_line_id uuid references public.transaction_lines(id),
  movement_type text not null check (movement_type in (
    'purchase', 'sale', 'sale_void', 'issue', 'return', 'adjustment',
    'count_gain', 'count_loss', 'transfer_in', 'transfer_out', 'opening'
  )),
  quantity_before numeric(18,6) not null,
  quantity_delta numeric(18,6) not null,
  quantity_after numeric(18,6) not null,
  unit_cost_base numeric(18,6) not null default 0,
  movement_value numeric(18,2) not null default 0,
  lot_no text,
  expires_on date,
  source_system text not null,
  external_id text,
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  reason text,
  created_at timestamptz not null default now()
);

create unique index stock_movements_external_source_uidx
  on public.stock_movements (company_id, source_system, external_id)
  where external_id is not null;

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  branch_id uuid not null references public.branches(id),
  location_id uuid not null references public.inventory_locations(id),
  count_no text not null,
  counted_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'voided')),
  created_by uuid references auth.users(id),
  confirmed_by uuid references auth.users(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, count_no)
);

create table public.stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  stock_count_id uuid not null references public.stock_counts(id) on delete cascade,
  item_id uuid not null references public.items(id),
  expected_quantity numeric(18,6) not null,
  counted_quantity numeric(18,6) not null,
  difference_quantity numeric(18,6) generated always as (counted_quantity - expected_quantity) stored,
  note text,
  unique (stock_count_id, item_id)
);

create table public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  from_branch_id uuid not null references public.branches(id),
  from_location_id uuid not null references public.inventory_locations(id),
  to_branch_id uuid not null references public.branches(id),
  to_location_id uuid not null references public.inventory_locations(id),
  transfer_no text not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'received', 'voided')),
  sent_at timestamptz,
  received_at timestamptz,
  created_by uuid references auth.users(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_location_id <> to_location_id),
  unique (company_id, transfer_no)
);

create table public.stock_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  stock_transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
  item_id uuid not null references public.items(id),
  quantity_base numeric(18,6) not null check (quantity_base > 0),
  unit_cost_base numeric(18,6) not null default 0,
  note text,
  unique (stock_transfer_id, item_id)
);

create table public.external_statements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  branch_id uuid not null references public.branches(id),
  channel text not null,
  statement_no text not null,
  period_start date not null,
  period_end date not null,
  gross_sales numeric(18,2) not null default 0,
  commission numeric(18,2) not null default 0,
  service_fee numeric(18,2) not null default 0,
  merchant_discount numeric(18,2) not null default 0,
  tax numeric(18,2) not null default 0,
  adjustments numeric(18,2) not null default 0,
  net_payout numeric(18,2) not null default 0,
  payout_date date,
  reconciliation_status text not null default 'pending'
    check (reconciliation_status in ('pending', 'matched', 'difference', 'approved', 'rejected')),
  pos_sales_amount numeric(18,2),
  difference_amount numeric(18,2),
  source_system text not null default 'google_sheets',
  external_id text,
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (company_id, branch_id, channel, statement_no)
);

create table public.external_statement_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  statement_id uuid not null references public.external_statements(id) on delete cascade,
  line_type text not null check (line_type in ('sale', 'commission', 'service_fee', 'discount', 'tax', 'adjustment', 'payout')),
  description text not null,
  amount numeric(18,2) not null,
  reference_no text,
  occurred_on date,
  transaction_id uuid references public.transactions(id),
  created_at timestamptz not null default now()
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  branch_id uuid not null references public.branches(id),
  transaction_id uuid references public.transactions(id),
  statement_id uuid references public.external_statements(id),
  storage_bucket text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint check (file_size is null or file_size >= 0),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (transaction_id is not null or statement_id is not null),
  unique (storage_bucket, storage_path)
);

create table public.status_history (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id),
  branch_id uuid references public.branches(id),
  entity_type text not null,
  entity_id uuid not null,
  previous_status text,
  new_status text not null,
  changed_by uuid references auth.users(id),
  reason text,
  details jsonb not null default '{}'::jsonb,
  changed_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id),
  branch_id uuid references public.branches(id),
  actor_user_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  source_system text not null,
  request_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  branch_id uuid references public.branches(id),
  import_type text not null check (import_type in (
    'items', 'suppliers', 'employees', 'branches', 'external_income',
    'channel_statement', 'platform_fee', 'adjustment', 'migration'
  )),
  source_system text not null default 'google_sheets',
  source_file_id text,
  source_sheet_name text,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'validating', 'needs_review', 'approved', 'importing', 'completed', 'failed', 'rejected')),
  row_count integer not null default 0 check (row_count >= 0),
  valid_count integer not null default 0 check (valid_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  idempotency_key text not null,
  requested_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, source_system, idempotency_key)
);

create table public.import_rows (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id),
  import_batch_id uuid not null references public.import_batches(id) on delete cascade,
  source_row_number integer not null check (source_row_number > 0),
  payload jsonb not null,
  validation_status text not null default 'pending'
    check (validation_status in ('pending', 'valid', 'warning', 'error', 'imported', 'skipped')),
  validation_messages jsonb not null default '[]'::jsonb,
  imported_entity_type text,
  imported_entity_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (import_batch_id, source_row_number)
);

create table public.pos_shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  branch_id uuid not null references public.branches(id),
  source_system text not null,
  external_id text not null,
  opened_at timestamptz not null,
  closed_at timestamptz,
  opening_cash numeric(18,2) not null default 0,
  closing_cash numeric(18,2),
  expected_cash numeric(18,2),
  cash_difference numeric(18,2),
  status text not null check (status in ('open', 'closed', 'voided')),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, source_system, external_id)
);

create table public.pos_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  branch_id uuid not null references public.branches(id),
  shift_id uuid references public.pos_shifts(id),
  transaction_id uuid references public.transactions(id),
  source_system text not null,
  external_id text not null,
  order_no text not null,
  sales_channel text not null default 'store',
  payment_method text,
  subtotal numeric(18,2) not null default 0,
  discount numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null default 0,
  payment_status text not null check (payment_status in ('pending', 'completed', 'voided', 'refunded')),
  ordered_at timestamptz not null,
  voided_at timestamptz,
  void_reason text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, source_system, external_id),
  unique (company_id, branch_id, order_no)
);

create table public.pos_order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  pos_order_id uuid not null references public.pos_orders(id) on delete cascade,
  external_id text,
  menu_id uuid references public.menus(id),
  item_name text not null,
  quantity numeric(18,6) not null check (quantity > 0),
  unit_price numeric(18,4) not null default 0,
  line_total numeric(18,2) not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create table public.pos_order_modifiers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  pos_order_line_id uuid not null references public.pos_order_lines(id) on delete cascade,
  external_id text,
  name text not null,
  quantity numeric(18,6) not null default 1,
  price_delta numeric(18,4) not null default 0,
  created_at timestamptz not null default now()
);

create index branches_company_id_idx on public.branches (company_id);
create index inventory_locations_branch_id_idx on public.inventory_locations (branch_id);
create index profiles_company_id_idx on public.profiles (company_id);
create index user_branch_roles_branch_user_idx on public.user_branch_roles (branch_id, user_id) where active;
create index categories_company_type_idx on public.categories (company_id, category_type, active);
create index items_company_active_idx on public.items (company_id, active, name);
create index item_units_item_id_idx on public.item_units (item_id);
create index branch_items_branch_active_idx on public.branch_items (branch_id, active, item_id);
create index suppliers_company_active_idx on public.suppliers (company_id, active, name);
create index item_suppliers_item_id_idx on public.item_suppliers (item_id, active);
create index item_suppliers_supplier_id_idx on public.item_suppliers (supplier_id);
create index expense_items_company_active_idx on public.expense_items (company_id, active, name);
create index menus_company_active_idx on public.menus (company_id, active, name);
create index recipes_menu_id_idx on public.recipes (menu_id);
create index recipes_item_id_idx on public.recipes (item_id);
create index transactions_branch_date_idx on public.transactions (branch_id, transaction_date desc, transaction_type);
create index transactions_parent_id_idx on public.transactions (parent_transaction_id);
create index transaction_lines_transaction_id_idx on public.transaction_lines (transaction_id);
create index transaction_lines_item_id_idx on public.transaction_lines (item_id);
create index transaction_lines_supplier_id_idx on public.transaction_lines (supplier_id);
create index payments_transaction_id_idx on public.payments (transaction_id);
create index inventory_balances_branch_item_idx on public.inventory_balances (branch_id, item_id);
create index stock_movements_branch_item_time_idx on public.stock_movements (branch_id, item_id, occurred_at desc);
create index stock_movements_transaction_id_idx on public.stock_movements (transaction_id);
create index stock_count_lines_count_id_idx on public.stock_count_lines (stock_count_id);
create index stock_transfer_lines_transfer_id_idx on public.stock_transfer_lines (stock_transfer_id);
create index external_statements_branch_period_idx on public.external_statements (branch_id, period_start, period_end, channel);
create index external_statement_lines_statement_id_idx on public.external_statement_lines (statement_id);
create index attachments_transaction_id_idx on public.attachments (transaction_id);
create index attachments_statement_id_idx on public.attachments (statement_id);
create index status_history_entity_idx on public.status_history (entity_type, entity_id, changed_at desc);
create index audit_log_company_time_idx on public.audit_log (company_id, created_at desc);
create index import_batches_status_idx on public.import_batches (company_id, status, created_at desc);
create index import_rows_batch_status_idx on public.import_rows (import_batch_id, validation_status);
create index pos_shifts_branch_time_idx on public.pos_shifts (branch_id, opened_at desc);
create index pos_orders_branch_time_idx on public.pos_orders (branch_id, ordered_at desc);
create index pos_order_lines_order_id_idx on public.pos_order_lines (pos_order_id);
create index pos_order_modifiers_line_id_idx on public.pos_order_modifiers (pos_order_line_id);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'companies', 'branches', 'inventory_locations', 'profiles', 'categories',
    'units', 'items', 'item_units', 'branch_items', 'suppliers', 'item_suppliers',
    'expense_items', 'menus', 'recipes', 'transactions', 'stock_counts',
    'stock_transfers', 'external_statements', 'import_batches', 'import_rows',
    'pos_shifts', 'pos_orders'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
  end loop;
end $$;

insert into public.companies (code, name)
values ('BOY', 'BOY')
on conflict (code) do nothing;

insert into public.branches (company_id, code, name, branch_type, active)
select c.id, seed.code, seed.name, seed.branch_type, seed.active
from public.companies c
cross join (values
  ('TAWANA', 'ทาวน่า', 'headquarters', true),
  ('BIGC-CENTRAL-PATTAYA', 'บิ๊กซีพัทยากลาง', 'store', true),
  ('BURGER', 'ร้านเบอร์เกอร์', 'store', true),
  ('GRILL', 'ร้านเนื้อย่าง', 'store', false)
) as seed(code, name, branch_type, active)
where c.code = 'BOY'
on conflict (company_id, code) do nothing;

insert into public.inventory_locations (company_id, branch_id, code, name, location_type)
select b.company_id, b.id, b.code || '-MAIN', 'สต็อกหลัก', 'store'
from public.branches b
join public.companies c on c.id = b.company_id and c.code = 'BOY'
on conflict (company_id, code) do nothing;

create or replace function private.is_company_member(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles p
      where p.user_id = (select auth.uid())
        and p.company_id = target_company_id
        and p.active
    );
$$;

create or replace function private.is_company_admin(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles p
      where p.user_id = (select auth.uid())
        and p.company_id = target_company_id
        and p.company_role = 'admin'
        and p.active
    );
$$;

create or replace function private.has_branch_access(target_branch_id uuid, allowed_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.branches b
      join public.profiles p
        on p.company_id = b.company_id
       and p.user_id = (select auth.uid())
       and p.active
      left join public.user_branch_roles ubr
        on ubr.branch_id = b.id
       and ubr.user_id = p.user_id
       and ubr.active
      where b.id = target_branch_id
        and (
          p.company_role = 'admin'
          or (
            ubr.id is not null
            and (allowed_roles is null or ubr.role = any(allowed_roles))
          )
        )
    );
$$;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
revoke all on function private.is_company_member(uuid) from public, anon;
revoke all on function private.is_company_admin(uuid) from public, anon;
revoke all on function private.has_branch_access(uuid, text[]) from public, anon;
grant execute on function private.is_company_member(uuid) to authenticated;
grant execute on function private.is_company_admin(uuid) to authenticated;
grant execute on function private.has_branch_access(uuid, text[]) to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'companies', 'branches', 'inventory_locations', 'profiles', 'user_branch_roles',
    'categories', 'units', 'items', 'item_units', 'branch_items', 'suppliers',
    'item_suppliers', 'expense_items', 'menus', 'recipes', 'transactions',
    'transaction_lines', 'payments', 'inventory_balances', 'stock_movements',
    'stock_counts', 'stock_count_lines', 'stock_transfers', 'stock_transfer_lines',
    'external_statements', 'external_statement_lines', 'attachments',
    'status_history', 'audit_log', 'import_batches', 'import_rows', 'pos_shifts',
    'pos_orders', 'pos_order_lines', 'pos_order_modifiers'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

create policy companies_member_select on public.companies
for select to authenticated
using ((select private.is_company_member(id)));

create policy profiles_member_select on public.profiles
for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_company_admin(company_id)));

create policy user_branch_roles_member_select on public.user_branch_roles
for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_company_admin(company_id)));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'branches', 'categories', 'units', 'items', 'item_units', 'suppliers',
    'item_suppliers', 'expense_items', 'menus', 'recipes'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_company_member(company_id)))',
      table_name || '_member_select', table_name
    );
  end loop;
end $$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'inventory_locations', 'branch_items', 'transactions', 'inventory_balances',
    'stock_movements', 'stock_counts', 'external_statements', 'attachments',
    'import_batches', 'pos_shifts', 'pos_orders'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.has_branch_access(branch_id, null)))',
      table_name || '_branch_select', table_name
    );
  end loop;
end $$;

create policy stock_transfers_branch_select on public.stock_transfers
for select to authenticated
using (
  (select private.has_branch_access(from_branch_id, null))
  or (select private.has_branch_access(to_branch_id, null))
);

create policy transaction_lines_parent_select on public.transaction_lines
for select to authenticated
using (exists (
  select 1 from public.transactions t
  where t.id = transaction_id
    and (select private.has_branch_access(t.branch_id, null))
));

create policy payments_parent_select on public.payments
for select to authenticated
using (exists (
  select 1 from public.transactions t
  where t.id = transaction_id
    and (select private.has_branch_access(t.branch_id, null))
));

create policy stock_count_lines_parent_select on public.stock_count_lines
for select to authenticated
using (exists (
  select 1 from public.stock_counts sc
  where sc.id = stock_count_id
    and (select private.has_branch_access(sc.branch_id, null))
));

create policy stock_transfer_lines_parent_select on public.stock_transfer_lines
for select to authenticated
using (exists (
  select 1 from public.stock_transfers st
  where st.id = stock_transfer_id
    and (
      (select private.has_branch_access(st.from_branch_id, null))
      or (select private.has_branch_access(st.to_branch_id, null))
    )
));

create policy external_statement_lines_parent_select on public.external_statement_lines
for select to authenticated
using (exists (
  select 1 from public.external_statements es
  where es.id = statement_id
    and (select private.has_branch_access(es.branch_id, null))
));

create policy import_rows_parent_select on public.import_rows
for select to authenticated
using (exists (
  select 1 from public.import_batches ib
  where ib.id = import_batch_id
    and (
      (ib.branch_id is null and (select private.is_company_member(ib.company_id)))
      or (ib.branch_id is not null and (select private.has_branch_access(ib.branch_id, null)))
    )
));

create policy status_history_member_select on public.status_history
for select to authenticated
using (
  (branch_id is null and (select private.is_company_member(company_id)))
  or (branch_id is not null and (select private.has_branch_access(branch_id, null)))
);

create policy audit_log_member_select on public.audit_log
for select to authenticated
using (
  (branch_id is null and (select private.is_company_admin(company_id)))
  or (branch_id is not null and (select private.has_branch_access(branch_id, array['admin', 'manager'])))
);

create policy import_batches_company_select on public.import_batches
for select to authenticated
using (branch_id is null and (select private.is_company_member(company_id)));

create policy pos_order_lines_parent_select on public.pos_order_lines
for select to authenticated
using (exists (
  select 1 from public.pos_orders po
  where po.id = pos_order_id
    and (select private.has_branch_access(po.branch_id, null))
));

create policy pos_order_modifiers_parent_select on public.pos_order_modifiers
for select to authenticated
using (exists (
  select 1
  from public.pos_order_lines pol
  join public.pos_orders po on po.id = pol.pos_order_id
  where pol.id = pos_order_line_id
    and (select private.has_branch_access(po.branch_id, null))
));

revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from authenticated;

create or replace function public.bootstrap_first_admin(display_name text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_company_id uuid;
  created_profile public.profiles;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  if nullif(trim(display_name), '') is null then
    raise exception 'display name is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('boy-central-bootstrap-admin'));

  select id into target_company_id
  from public.companies
  where code = 'BOY' and active
  limit 1;

  if target_company_id is null then
    raise exception 'BOY company not found';
  end if;

  if exists (select 1 from public.profiles where company_id = target_company_id) then
    raise exception 'initial admin already exists';
  end if;

  insert into public.profiles (user_id, company_id, display_name, company_role)
  values (current_user_id, target_company_id, trim(display_name), 'admin')
  returning * into created_profile;

  insert into public.user_branch_roles (company_id, user_id, branch_id, role)
  select target_company_id, current_user_id, b.id, 'admin'
  from public.branches b
  where b.company_id = target_company_id
  on conflict (user_id, branch_id) do update set role = excluded.role, active = true;

  insert into public.audit_log (
    company_id, actor_user_id, action, entity_type, entity_id, source_system, after_data
  ) values (
    target_company_id, current_user_id, 'bootstrap_admin', 'profile', current_user_id::text,
    'boy_central', jsonb_build_object('company_role', 'admin')
  );

  return created_profile;
end;
$$;

revoke all on function public.bootstrap_first_admin(text) from public, anon;
grant execute on function public.bootstrap_first_admin(text) to authenticated;

create view public.v_stock_on_hand
with (security_invoker = true)
as
select
  ib.company_id,
  ib.branch_id,
  b.code as branch_code,
  b.name as branch_name,
  ib.location_id,
  il.name as location_name,
  ib.item_id,
  i.code as item_code,
  i.name as item_name,
  u.name as base_unit_name,
  ib.quantity_on_hand,
  ib.average_unit_cost,
  ib.inventory_value,
  bi.minimum_stock,
  bi.reorder_point,
  ib.quantity_on_hand <= bi.minimum_stock as is_low_stock,
  ib.updated_at
from public.inventory_balances ib
join public.branches b on b.id = ib.branch_id
join public.inventory_locations il on il.id = ib.location_id
join public.items i on i.id = ib.item_id
join public.units u on u.id = i.base_unit_id
left join public.branch_items bi on bi.branch_id = ib.branch_id and bi.item_id = ib.item_id;

create view public.v_monthly_branch_summary
with (security_invoker = true)
as
select
  t.company_id,
  t.branch_id,
  date_trunc('month', t.transaction_date)::date as month_start,
  sum(case when t.transaction_type in ('income', 'sale', 'settlement') and t.status = 'confirmed' then t.total_amount else 0 end) as income,
  sum(case when t.transaction_type in ('expense', 'purchase', 'platform_fee') and t.status = 'confirmed' then t.total_amount else 0 end) as expense,
  sum(case when t.transaction_type in ('income', 'sale', 'settlement') and t.status = 'confirmed' then t.total_amount else 0 end)
    - sum(case when t.transaction_type in ('expense', 'purchase', 'platform_fee') and t.status = 'confirmed' then t.total_amount else 0 end) as net_profit
from public.transactions t
group by t.company_id, t.branch_id, date_trunc('month', t.transaction_date)::date;

grant select on public.v_stock_on_hand, public.v_monthly_branch_summary to authenticated;
