do $$
declare
  missing_tables text[];
  missing_columns text[];
  rls_disabled text[];
  anon_exposed text[];
  price_definition text;
  refresh_definition text;
  save_definition text;
begin
  select array_agg(required_table order by required_table)
  into missing_tables
  from unnest(array[
    'bigc_interbranch_cost_rules',
    'bigc_interbranch_yields',
    'bigc_raw_fruit_piece_weights',
    'branch_cost_allocations'
  ]) required_table
  where to_regclass('boy_central.'||required_table) is null;
  if missing_tables is not null then
    raise exception 'missing BigC costing tables: %',missing_tables;
  end if;

  select array_agg(required_column order by required_column)
  into missing_columns
  from unnest(array[
    'actual_weight_kg',
    'handling_type',
    'costing_basis',
    'measurement_basis'
  ]) required_column
  where not exists(
    select 1 from information_schema.columns c
    where c.table_schema='boy_central'
      and c.table_name='bigc_workflow_lines'
      and c.column_name=required_column
  );
  if missing_columns is not null then
    raise exception 'missing BigC receipt metadata columns: %',missing_columns;
  end if;

  select array_agg(c.relname order by c.relname)
  into rls_disabled
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='boy_central' and c.relkind='r'
    and c.relname in ('bigc_interbranch_cost_rules','bigc_interbranch_yields','bigc_raw_fruit_piece_weights','branch_cost_allocations')
    and not c.relrowsecurity;
  if rls_disabled is not null then
    raise exception 'RLS is disabled on BigC costing tables: %',rls_disabled;
  end if;

  select array_agg(distinct table_name order by table_name)
  into anon_exposed
  from information_schema.role_table_grants
  where table_schema='boy_central' and grantee='anon'
    and table_name in ('bigc_interbranch_cost_rules','bigc_interbranch_yields','bigc_raw_fruit_piece_weights','branch_cost_allocations');
  if anon_exposed is not null then
    raise exception 'anon unexpectedly has BigC costing table privileges: %',anon_exposed;
  end if;

  if to_regprocedure('boy_central_private.resolve_tawana_monthly_raw_price(uuid,uuid,date,integer)') is null
    or to_regprocedure('boy_central_private.resolve_bigc_piece_weight(uuid,uuid,date)') is null
    or to_regprocedure('boy_central_private.resolve_bigc_yield(uuid,date,integer)') is null
    or to_regprocedure('boy_central_private.refresh_bigc_interbranch_costs(uuid)') is null
    or to_regprocedure('boy_central.admin_save_bigc_interbranch_cost_rule(jsonb)') is null
    or to_regprocedure('boy_central.admin_save_bigc_piece_weight(jsonb)') is null
    or to_regprocedure('boy_central.get_bigc_piece_weight_settings()') is null
    or to_regprocedure('boy_central.reprocess_bigc_interbranch_costs(uuid)') is null then
    raise exception 'one or more BigC costing functions are missing';
  end if;

  if has_function_privilege('anon','boy_central.admin_save_bigc_interbranch_cost_rule(jsonb)','execute')
    or has_function_privilege('anon','boy_central.admin_save_bigc_piece_weight(jsonb)','execute')
    or has_function_privilege('anon','boy_central.get_bigc_piece_weight_settings()','execute')
    or has_function_privilege('anon','boy_central.reprocess_bigc_interbranch_costs(uuid)','execute') then
    raise exception 'anon unexpectedly can execute BigC costing admin functions';
  end if;
  if not has_function_privilege('authenticated','boy_central.admin_save_bigc_interbranch_cost_rule(jsonb)','execute')
    or not has_function_privilege('authenticated','boy_central.admin_save_bigc_piece_weight(jsonb)','execute')
    or not has_function_privilege('authenticated','boy_central.get_bigc_piece_weight_settings()','execute')
    or not has_function_privilege('authenticated','boy_central.reprocess_bigc_interbranch_costs(uuid)','execute') then
    raise exception 'authenticated role is missing explicit BigC costing RPC grants';
  end if;

  select lower(pg_get_functiondef(
    'boy_central_private.resolve_tawana_monthly_raw_price(uuid,uuid,date,integer)'::regprocedure
  )) into price_definition;
  if position('unit-011' in price_definition)=0
    or position('unit-013' in price_definition)=0
    or position('complete_mass' in price_definition)=0
    or position('t.affects_stock' in price_definition)=0 then
    raise exception 'Tawana price resolver does not validate mixed kg/piece purchase mass';
  end if;
  if position('item_name' in price_definition)>0 then
    raise exception 'Tawana price resolver must not map source purchases by display name';
  end if;

  select pg_get_functiondef('boy_central_private.refresh_bigc_interbranch_costs(uuid)'::regprocedure)
  into refresh_definition;
  if position('stock_movements' in refresh_definition)>0
    or position('insert into boy_central.transactions' in lower(refresh_definition))>0 then
    raise exception 'BigC costing must not create stock movements or duplicate purchase transactions';
  end if;
  if position('missing_source_workflow' in refresh_definition)=0 then
    raise exception 'returns without an explicit source receipt do not fail closed';
  end if;
  if position('consignment_item_excluded_from_interbranch_costing' in refresh_definition)=0
    or position('not_applicable' in refresh_definition)=0 then
    raise exception 'consignment receipts are not explicitly excluded from interbranch costing';
  end if;
  if position('line_not_received' in refresh_definition)=0 then
    raise exception 'unchecked receipt lines are not explicitly excluded from costing';
  end if;
  if position('estimated_raw' in refresh_definition)=0
    or position('missing_piece_weight_estimate' in refresh_definition)=0
    or position('rule_row.counted_by_piece' in refresh_definition)=0 then
    raise exception 'piece-count fruit receipts are not costed through an approved estimate';
  end if;

  select pg_get_functiondef('boy_central.save_bigc_v2_workflow(jsonb)'::regprocedure)
  into save_definition;
  if position('refresh_bigc_interbranch_costs' in save_definition)=0 then
    raise exception 'BigC workflow save is not wired to atomic cost refresh';
  end if;
  if position('actual_weight_kg' in save_definition)=0
    or position('measurement_basis' in save_definition)=0 then
    raise exception 'BigC workflow save does not persist receipt costing measurements';
  end if;

  if exists(
    select 1 from boy_central.branch_cost_allocations
    where company_cost_delta<>0
  ) then
    raise exception 'branch cost allocations do not eliminate company-wide';
  end if;

  raise notice 'BigC interbranch costing contract passed';
end
$$;
