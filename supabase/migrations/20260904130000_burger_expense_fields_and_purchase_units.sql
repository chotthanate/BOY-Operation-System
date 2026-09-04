alter table boy_central.expense_items
  add column if not exists requires_quantity boolean not null default false,
  add column if not exists requires_unit boolean not null default false;

update boy_central.expense_items
set requires_quantity = true,
    requires_unit = true
where affects_stock
  and (not requires_quantity or not requires_unit);

alter table boy_central.expense_items
  drop constraint if exists expense_items_unit_requires_quantity,
  add constraint expense_items_unit_requires_quantity
    check (not requires_unit or requires_quantity);

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
  conversion_value numeric(18,6);
  generated_code text;
  expense_id uuid;
  stock_value boolean;
  quantity_required boolean;
  unit_required boolean;
begin
  select p.company_id into company
  from boy_central.profiles p
  where p.user_id = actor
    and p.active
    and p.company_role = 'admin';
  if company is null then raise exception 'admin access required'; end if;

  select id into burger
  from boy_central.branches
  where company_id = company and code = 'BURGER';

  kind := payload->>'kind';
  target := nullif(payload->>'id', '')::uuid;
  category := nullif(payload->>'category_id', '')::uuid;

  if category is not null and not exists (
    select 1 from boy_central.categories c
    where c.id = category and c.company_id = company and c.active
  ) then
    raise exception 'active category not found';
  end if;

  if kind = 'item' then
    base_unit := nullif(payload->>'base_unit_id', '')::uuid;
    purchase_unit := nullif(payload->>'purchase_unit_id', '')::uuid;
    conversion_value := coalesce(nullif(payload->>'conversion_to_base', '')::numeric, 1);
    stock_value := coalesce((payload->>'track_stock')::boolean, false);

    if base_unit is not null and not exists (
      select 1 from boy_central.units u
      where u.id = base_unit and u.company_id = company and u.active
    ) then raise exception 'active base unit not found'; end if;

    if purchase_unit is not null and not exists (
      select 1 from boy_central.units u
      where u.id = purchase_unit and u.company_id = company and u.active
    ) then raise exception 'active purchase unit not found'; end if;

    if conversion_value <= 0 then raise exception 'conversion must be greater than zero'; end if;

    if target is null then
      if nullif(trim(payload->>'name'), '') is null or category is null or base_unit is null then
        raise exception 'name, category and base unit are required';
      end if;
      generated_code := 'ITEM-WEB-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
      insert into boy_central.items
        (company_id, code, name, category_id, base_unit_id, track_stock, purchaseable, issueable, active)
      values
        (company, generated_code, trim(payload->>'name'), category, base_unit, stock_value, true, true, true)
      returning id into target;

      insert into boy_central.branch_items (company_id, branch_id, item_id, active)
      values (company, burger, target, true);

      insert into boy_central.expense_items
        (company_id, code, name, category_id, item_id, affects_stock, requires_quantity, requires_unit, active)
      values
        (company, 'EXP-' || generated_code, trim(payload->>'name'), category, target, stock_value, stock_value, stock_value, true)
      returning id into expense_id;

      insert into boy_central.branch_expense_items (branch_id, expense_item_id, active)
      values (burger, expense_id, true);
    else
      if not exists (
        select 1 from boy_central.branch_items
        where branch_id = burger and item_id = target
      ) then raise exception 'burger item not found'; end if;

      update boy_central.items
      set name = coalesce(nullif(trim(payload->>'name'), ''), name),
          category_id = coalesce(category, category_id),
          base_unit_id = coalesce(base_unit, base_unit_id),
          track_stock = coalesce((payload->>'track_stock')::boolean, track_stock),
          active = coalesce((payload->>'active')::boolean, active)
      where id = target and company_id = company;

      select i.base_unit_id, i.track_stock into base_unit, stock_value
      from boy_central.items i where i.id = target;

      update boy_central.expense_items
      set name = (select name from boy_central.items where id = target),
          category_id = (select category_id from boy_central.items where id = target),
          affects_stock = stock_value,
          requires_quantity = stock_value,
          requires_unit = stock_value
      where item_id = target and company_id = company;
    end if;

    update boy_central.item_units
    set is_base_unit = false,
        allow_purchase = false,
        updated_at = now()
    where item_id = target;

    insert into boy_central.item_units
      (company_id, item_id, unit_id, conversion_to_base, is_base_unit, allow_purchase, allow_issue, active)
    values
      (company, target, base_unit, 1, true, true, true, true)
    on conflict (item_id, unit_id) do update
    set conversion_to_base = 1,
        is_base_unit = true,
        allow_purchase = true,
        allow_issue = true,
        active = true,
        updated_at = now();

    if stock_value and purchase_unit is not null and purchase_unit <> base_unit then
      insert into boy_central.item_units
        (company_id, item_id, unit_id, conversion_to_base, is_base_unit, allow_purchase, allow_issue, active)
      values
        (company, target, purchase_unit, conversion_value, false, true, false, true)
      on conflict (item_id, unit_id) do update
      set conversion_to_base = excluded.conversion_to_base,
          is_base_unit = false,
          allow_purchase = true,
          active = true,
          updated_at = now();
    end if;

  elsif kind = 'expense_item' then
    stock_value := coalesce((payload->>'affects_stock')::boolean, false);
    quantity_required := coalesce((payload->>'requires_quantity')::boolean, false);
    unit_required := coalesce((payload->>'requires_unit')::boolean, false);
    if unit_required and not quantity_required then
      raise exception 'unit requires quantity';
    end if;

    if target is null then
      if nullif(trim(payload->>'name'), '') is null or category is null then
        raise exception 'name and category are required';
      end if;
      generated_code := 'EXP-WEB-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
      insert into boy_central.expense_items
        (company_id, code, name, category_id, affects_stock, requires_quantity, requires_unit, active)
      values
        (company, generated_code, trim(payload->>'name'), category, stock_value, quantity_required, unit_required, true)
      returning id into target;
      insert into boy_central.branch_expense_items (branch_id, expense_item_id, active)
      values (burger, target, true);
    else
      if not exists (
        select 1 from boy_central.branch_expense_items
        where branch_id = burger and expense_item_id = target
      ) then raise exception 'burger expense item not found'; end if;
      update boy_central.expense_items
      set name = coalesce(nullif(trim(payload->>'name'), ''), name),
          category_id = coalesce(category, category_id),
          affects_stock = coalesce((payload->>'affects_stock')::boolean, affects_stock),
          requires_quantity = coalesce((payload->>'requires_quantity')::boolean, requires_quantity),
          requires_unit = coalesce((payload->>'requires_unit')::boolean, requires_unit),
          active = coalesce((payload->>'active')::boolean, active)
      where id = target and company_id = company;
    end if;
  else
    raise exception 'unsupported master kind';
  end if;

  return jsonb_build_object('status', 'saved', 'id', target);
end;
$$;

revoke all on function boy_central.admin_update_burger_master(jsonb) from public, anon;
grant execute on function boy_central.admin_update_burger_master(jsonb) to authenticated;

create or replace function boy_central.record_expense_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  result jsonb;
  target_transaction_id uuid;
  target_company_id uuid;
  category_value uuid;
  line jsonb;
  line_number integer := 0;
  quantity_required boolean;
  unit_required boolean;
begin
  if actor_id is null then raise exception 'authentication required'; end if;

  result := boy_central.record_expense(payload);
  if result->>'status' = 'duplicate' then return result; end if;

  target_transaction_id := nullif(result->>'transaction_id', '')::uuid;
  select t.company_id into target_company_id
  from boy_central.transactions t
  where t.id = target_transaction_id and t.created_by = actor_id;
  if target_company_id is null then raise exception 'created expense transaction not found'; end if;

  for line in
    select value
    from jsonb_array_elements(payload->'lines')
    order by coalesce(value->>'item_id', ''), coalesce(value->>'description', '')
  loop
    line_number := line_number + 1;
    category_value := nullif(line->>'category_id', '')::uuid;

    if category_value is null or not exists (
      select 1 from boy_central.categories c
      where c.id = category_value
        and c.company_id = target_company_id
        and c.category_type = 'item'
        and c.parent_id is null
        and c.code ~ '^CAT-[0-9]+$'
        and c.active
    ) then raise exception 'active main expense category is required at line %', line_number; end if;

    quantity_required := false;
    unit_required := false;
    if nullif(line->>'expense_item_id', '') is not null then
      select ei.requires_quantity, ei.requires_unit
      into quantity_required, unit_required
      from boy_central.expense_items ei
      where ei.id = (line->>'expense_item_id')::uuid
        and ei.company_id = target_company_id;
    end if;

    if quantity_required and coalesce(nullif(line->>'quantity', '')::numeric, 0) <= 0 then
      raise exception 'quantity is required at line %', line_number;
    end if;
    if unit_required and nullif(line->>'unit_id', '') is null then
      raise exception 'unit is required at line %', line_number;
    end if;

    update boy_central.transaction_lines
    set category_id = category_value
    where transaction_id = target_transaction_id and line_no = line_number;
    if not found then raise exception 'expense line not found at line %', line_number; end if;
  end loop;

  return result;
end;
$$;

revoke all on function boy_central.record_expense_v2(jsonb) from public, anon;
grant execute on function boy_central.record_expense_v2(jsonb) to authenticated;

notify pgrst, 'reload schema';
