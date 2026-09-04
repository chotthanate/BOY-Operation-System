alter table boy_central.items
  add column if not exists item_type text not null default 'STOCK_ITEM',
  add column if not exists brand text,
  add column if not exists package_size numeric(18,6),
  add column if not exists package_unit_id uuid references boy_central.units(id),
  add column if not exists notes text;

update boy_central.items
set item_type = case when track_stock then 'STOCK_ITEM' else 'NON_STOCK_ITEM' end;

alter table boy_central.items
  add constraint items_item_type_check check (item_type in ('STOCK_ITEM', 'NON_STOCK_ITEM')),
  add constraint items_package_size_check check (package_size is null or package_size > 0);

alter table boy_central.branch_items
  add column if not exists target_stock numeric(18,6) not null default 0,
  add column if not exists preferred_supplier_id uuid references boy_central.suppliers(id),
  add column if not exists default_purchase_unit_id uuid references boy_central.units(id),
  add column if not exists default_issue_unit_id uuid references boy_central.units(id),
  add column if not exists notes text;

alter table boy_central.branch_items
  add constraint branch_items_stock_levels_check
    check (minimum_stock >= 0 and reorder_point >= 0 and target_stock >= 0);

alter table boy_central.expense_items
  add column if not exists requires_supplier boolean not null default false,
  add column if not exists requires_receipt boolean not null default false,
  add column if not exists notes text;

create index if not exists branch_items_preferred_supplier_id_idx
  on boy_central.branch_items (preferred_supplier_id);
create index if not exists branch_items_default_purchase_unit_id_idx
  on boy_central.branch_items (default_purchase_unit_id);
create index if not exists branch_items_default_issue_unit_id_idx
  on boy_central.branch_items (default_issue_unit_id);
create index if not exists items_package_unit_id_idx
  on boy_central.items (package_unit_id);

create or replace function boy_central.admin_update_burger_master(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  company uuid;
  burger uuid;
  target uuid;
  kind text;
  category uuid;
  base_unit uuid;
  purchase_unit uuid;
  issue_unit uuid;
  package_unit uuid;
  preferred_supplier uuid;
  supplier_value uuid;
  conversion_value numeric(18,6);
  generated_code text;
  expense_id uuid;
  stock_value boolean;
  quantity_required boolean;
  unit_required boolean;
  supplier_ids jsonb := coalesce(payload->'supplier_ids', '[]'::jsonb);
begin
  select p.company_id into company
  from boy_central.profiles p
  where p.user_id = actor and p.active and p.company_role = 'admin';
  if company is null then raise exception 'admin access required'; end if;

  select b.id into burger
  from boy_central.branches b
  where b.company_id = company and b.code = 'BURGER' and b.active;
  if burger is null then raise exception 'active burger branch not found'; end if;

  kind := payload->>'kind';
  target := nullif(payload->>'id', '')::uuid;
  category := nullif(payload->>'category_id', '')::uuid;

  if category is not null and not exists (
    select 1 from boy_central.categories c
    where c.id = category and c.company_id = company and c.active
  ) then raise exception 'active category not found'; end if;

  if kind = 'item' then
    base_unit := nullif(payload->>'base_unit_id', '')::uuid;
    purchase_unit := nullif(payload->>'purchase_unit_id', '')::uuid;
    issue_unit := coalesce(nullif(payload->>'default_issue_unit_id', '')::uuid, base_unit);
    package_unit := nullif(payload->>'package_unit_id', '')::uuid;
    preferred_supplier := nullif(payload->>'preferred_supplier_id', '')::uuid;
    conversion_value := coalesce(nullif(payload->>'conversion_to_base', '')::numeric, 1);
    stock_value := coalesce((payload->>'track_stock')::boolean, false);

    if base_unit is null or not exists (
      select 1 from boy_central.units u where u.id = base_unit and u.company_id = company and u.active
    ) then raise exception 'active base unit is required'; end if;
    if purchase_unit is not null and not exists (
      select 1 from boy_central.units u where u.id = purchase_unit and u.company_id = company and u.active
    ) then raise exception 'active purchase unit not found'; end if;
    if issue_unit is not null and not exists (
      select 1 from boy_central.units u where u.id = issue_unit and u.company_id = company and u.active
    ) then raise exception 'active issue unit not found'; end if;
    if package_unit is not null and not exists (
      select 1 from boy_central.units u where u.id = package_unit and u.company_id = company and u.active
    ) then raise exception 'active package unit not found'; end if;
    if preferred_supplier is not null and not exists (
      select 1 from boy_central.suppliers s where s.id = preferred_supplier and s.company_id = company and s.active
    ) then raise exception 'active preferred supplier not found'; end if;
    if conversion_value <= 0 then raise exception 'conversion must be greater than zero'; end if;
    if coalesce(nullif(payload->>'minimum_stock', '')::numeric, 0) < 0
      or coalesce(nullif(payload->>'reorder_point', '')::numeric, 0) < 0
      or coalesce(nullif(payload->>'target_stock', '')::numeric, 0) < 0
    then raise exception 'stock levels cannot be negative'; end if;

    if target is null then
      if nullif(trim(payload->>'name'), '') is null or category is null then
        raise exception 'name, category and base unit are required';
      end if;
      generated_code := 'ITEM-WEB-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
      insert into boy_central.items
        (company_id, code, name, item_type, category_id, base_unit_id, track_stock,
         purchaseable, issueable, sellable, active, brand, package_size, package_unit_id, notes)
      values
        (company, generated_code, trim(payload->>'name'), coalesce(nullif(payload->>'item_type', ''), 'STOCK_ITEM'),
         category, base_unit, stock_value, coalesce((payload->>'purchaseable')::boolean, true),
         coalesce((payload->>'issueable')::boolean, true), coalesce((payload->>'sellable')::boolean, false), true,
         nullif(trim(payload->>'brand'), ''), nullif(payload->>'package_size', '')::numeric,
         package_unit, nullif(trim(payload->>'notes'), ''))
      returning id into target;

      insert into boy_central.branch_items
        (company_id, branch_id, item_id, minimum_stock, reorder_point, target_stock,
         preferred_supplier_id, default_purchase_unit_id, default_issue_unit_id, notes, active)
      values
        (company, burger, target, coalesce(nullif(payload->>'minimum_stock', '')::numeric, 0),
         coalesce(nullif(payload->>'reorder_point', '')::numeric, 0), coalesce(nullif(payload->>'target_stock', '')::numeric, 0),
         preferred_supplier, coalesce(purchase_unit, base_unit), issue_unit,
         nullif(trim(payload->>'branch_notes'), ''), true);

      insert into boy_central.expense_items
        (company_id, code, name, category_id, item_id, affects_stock, requires_quantity, requires_unit, active)
      values
        (company, 'EXP-' || generated_code, trim(payload->>'name'), category, target, stock_value, stock_value, stock_value, true)
      returning id into expense_id;
      insert into boy_central.branch_expense_items (branch_id, expense_item_id, active)
      values (burger, expense_id, true);
    else
      if not exists (select 1 from boy_central.branch_items where branch_id = burger and item_id = target)
      then raise exception 'burger item not found'; end if;

      update boy_central.items
      set name = coalesce(nullif(trim(payload->>'name'), ''), name),
          item_type = coalesce(nullif(payload->>'item_type', ''), item_type),
          category_id = coalesce(category, category_id),
          base_unit_id = base_unit,
          track_stock = coalesce((payload->>'track_stock')::boolean, track_stock),
          purchaseable = coalesce((payload->>'purchaseable')::boolean, purchaseable),
          issueable = coalesce((payload->>'issueable')::boolean, issueable),
          sellable = coalesce((payload->>'sellable')::boolean, sellable),
          active = coalesce((payload->>'active')::boolean, active),
          brand = nullif(trim(payload->>'brand'), ''),
          package_size = nullif(payload->>'package_size', '')::numeric,
          package_unit_id = package_unit,
          notes = nullif(trim(payload->>'notes'), '')
      where id = target and company_id = company;

      update boy_central.branch_items
      set minimum_stock = coalesce(nullif(payload->>'minimum_stock', '')::numeric, 0),
          reorder_point = coalesce(nullif(payload->>'reorder_point', '')::numeric, 0),
          target_stock = coalesce(nullif(payload->>'target_stock', '')::numeric, 0),
          preferred_supplier_id = preferred_supplier,
          default_purchase_unit_id = coalesce(purchase_unit, base_unit),
          default_issue_unit_id = issue_unit,
          notes = nullif(trim(payload->>'branch_notes'), ''),
          active = coalesce((payload->>'active')::boolean, active),
          updated_at = now()
      where branch_id = burger and item_id = target;

      select i.track_stock into stock_value from boy_central.items i where i.id = target;
      update boy_central.expense_items
      set name = (select i.name from boy_central.items i where i.id = target),
          category_id = (select i.category_id from boy_central.items i where i.id = target),
          affects_stock = stock_value, requires_quantity = stock_value, requires_unit = stock_value
      where item_id = target and company_id = company;
    end if;

    update boy_central.item_units set is_base_unit = false, updated_at = now() where item_id = target;
    insert into boy_central.item_units
      (company_id, item_id, unit_id, conversion_to_base, is_base_unit, allow_purchase, allow_issue, active)
    values (company, target, base_unit, 1, true, true, true, true)
    on conflict (item_id, unit_id) do update
    set conversion_to_base = 1, is_base_unit = true, allow_purchase = true, allow_issue = true, active = true, updated_at = now();

    if purchase_unit is not null and purchase_unit <> base_unit then
      insert into boy_central.item_units
        (company_id, item_id, unit_id, conversion_to_base, is_base_unit, allow_purchase, allow_issue, active)
      values (company, target, purchase_unit, conversion_value, false, true, issue_unit = purchase_unit, true)
      on conflict (item_id, unit_id) do update
      set conversion_to_base = excluded.conversion_to_base, allow_purchase = true,
          allow_issue = excluded.allow_issue, active = true, updated_at = now();
    end if;

    if payload ? 'supplier_ids' then
      if jsonb_typeof(supplier_ids) <> 'array' then raise exception 'supplier_ids must be an array'; end if;
      if preferred_supplier is not null and not supplier_ids @> jsonb_build_array(preferred_supplier::text)
      then raise exception 'preferred supplier must be selected'; end if;
      update boy_central.branch_item_suppliers
      set active = false, is_primary = false, updated_at = now()
      where branch_id = burger and item_id = target;
      for supplier_value in select value::uuid from jsonb_array_elements_text(supplier_ids)
      loop
        if not exists (
          select 1 from boy_central.suppliers s where s.id = supplier_value and s.company_id = company and s.active
        ) then raise exception 'active item supplier not found'; end if;
        insert into boy_central.branch_item_suppliers (branch_id, item_id, supplier_id, is_primary, active)
        values (burger, target, supplier_value, supplier_value = preferred_supplier, true)
        on conflict (branch_id, item_id, supplier_id) do update
        set is_primary = excluded.is_primary, active = true, updated_at = now();
      end loop;
    end if;

  elsif kind = 'expense_item' then
    stock_value := coalesce((payload->>'affects_stock')::boolean, false);
    quantity_required := coalesce((payload->>'requires_quantity')::boolean, false);
    unit_required := coalesce((payload->>'requires_unit')::boolean, false);
    if unit_required and not quantity_required then raise exception 'unit requires quantity'; end if;

    if target is null then
      if nullif(trim(payload->>'name'), '') is null or category is null then raise exception 'name and category are required'; end if;
      generated_code := 'EXP-WEB-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
      insert into boy_central.expense_items
        (company_id, code, name, category_id, affects_stock, requires_quantity, requires_unit,
         requires_supplier, requires_receipt, notes, active)
      values
        (company, generated_code, trim(payload->>'name'), category, stock_value, quantity_required, unit_required,
         coalesce((payload->>'requires_supplier')::boolean, false), coalesce((payload->>'requires_receipt')::boolean, false),
         nullif(trim(payload->>'notes'), ''), true)
      returning id into target;
      insert into boy_central.branch_expense_items (branch_id, expense_item_id, sort_order, active)
      values (burger, target, coalesce(nullif(payload->>'sort_order', '')::integer, 0), true);
    else
      if not exists (select 1 from boy_central.branch_expense_items where branch_id = burger and expense_item_id = target)
      then raise exception 'burger expense item not found'; end if;
      update boy_central.expense_items
      set name = coalesce(nullif(trim(payload->>'name'), ''), name),
          category_id = coalesce(category, category_id),
          affects_stock = coalesce((payload->>'affects_stock')::boolean, affects_stock),
          requires_quantity = coalesce((payload->>'requires_quantity')::boolean, requires_quantity),
          requires_unit = coalesce((payload->>'requires_unit')::boolean, requires_unit),
          requires_supplier = coalesce((payload->>'requires_supplier')::boolean, requires_supplier),
          requires_receipt = coalesce((payload->>'requires_receipt')::boolean, requires_receipt),
          notes = nullif(trim(payload->>'notes'), ''),
          active = coalesce((payload->>'active')::boolean, active)
      where id = target and company_id = company;
      update boy_central.branch_expense_items
      set sort_order = coalesce(nullif(payload->>'sort_order', '')::integer, sort_order),
          active = coalesce((payload->>'active')::boolean, active), updated_at = now()
      where branch_id = burger and expense_item_id = target;
    end if;
  else
    raise exception 'unsupported master kind';
  end if;

  return jsonb_build_object('status', 'saved', 'id', target);
end;
$$;

revoke all on function boy_central.admin_update_burger_master(jsonb) from public, anon;
grant execute on function boy_central.admin_update_burger_master(jsonb) to authenticated;

notify pgrst, 'reload schema';
