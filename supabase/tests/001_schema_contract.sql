do $$
declare
  missing_tables text[];
  rls_disabled text[];
  anon_exposed text[];
begin
  select array_agg(required_table order by required_table)
  into missing_tables
  from unnest(array[
    'companies', 'branches', 'inventory_locations', 'profiles', 'user_branch_roles',
    'categories', 'units', 'items', 'item_units', 'branch_items', 'suppliers',
    'item_suppliers', 'expense_items', 'menus', 'recipes', 'transactions',
    'transaction_lines', 'payments', 'inventory_balances', 'stock_movements',
    'stock_counts', 'stock_count_lines', 'stock_transfers', 'stock_transfer_lines',
    'external_statements', 'external_statement_lines', 'attachments',
    'status_history', 'audit_log', 'import_batches', 'import_rows', 'pos_shifts',
    'pos_orders', 'pos_order_lines', 'pos_order_modifiers'
  ]) required_table
  where to_regclass('public.' || required_table) is null;

  if missing_tables is not null then
    raise exception 'missing BOY Central tables: %', missing_tables;
  end if;

  select array_agg(c.relname order by c.relname)
  into rls_disabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in (
      'companies', 'branches', 'inventory_locations', 'profiles', 'user_branch_roles',
      'categories', 'units', 'items', 'item_units', 'branch_items', 'suppliers',
      'item_suppliers', 'expense_items', 'menus', 'recipes', 'transactions',
      'transaction_lines', 'payments', 'inventory_balances', 'stock_movements',
      'stock_counts', 'stock_count_lines', 'stock_transfers', 'stock_transfer_lines',
      'external_statements', 'external_statement_lines', 'attachments',
      'status_history', 'audit_log', 'import_batches', 'import_rows', 'pos_shifts',
      'pos_orders', 'pos_order_lines', 'pos_order_modifiers'
    )
    and not c.relrowsecurity;

  if rls_disabled is not null then
    raise exception 'RLS is disabled on: %', rls_disabled;
  end if;

  select array_agg(distinct table_name order by table_name)
  into anon_exposed
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee = 'anon';

  if anon_exposed is not null then
    raise exception 'anon unexpectedly has table privileges on: %', anon_exposed;
  end if;

  if to_regprocedure('public.record_expense(jsonb)') is null
    or to_regprocedure('public.ingest_pos_order(jsonb)') is null
    or to_regprocedure('public.ingest_pos_void(jsonb)') is null
    or to_regprocedure('public.upsert_import_batch(jsonb)') is null then
    raise exception 'one or more BOY Central API functions are missing';
  end if;

  if (select count(*) from public.branches where code in (
    'TAWANA', 'BIGC-CENTRAL-PATTAYA', 'BURGER', 'GRILL'
  )) <> 4 then
    raise exception 'reference branches are incomplete';
  end if;

  raise notice 'BOY Central schema contract passed';
end;
$$;
