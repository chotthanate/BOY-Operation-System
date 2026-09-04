-- Make BOY Central the canonical Burger stock ledger while keeping the legacy
-- JSON POS state available for the controlled cutover.

create or replace function boy_central.get_burger_pos_sync_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  burger_branch boy_central.branches%rowtype;
begin
  select * into burger_branch
  from boy_central.branches
  where code = 'BURGER' and active
  limit 1;

  if burger_branch.id is null then
    raise exception 'active Burger branch not found';
  end if;
  if (select auth.uid()) is null
    or not boy_central_private.has_branch_access(burger_branch.id, null) then
    raise exception 'branch access denied';
  end if;

  return jsonb_build_object(
    'branch_id', burger_branch.id,
    'server_time', now(),
    'stock', coalesce((
      select jsonb_agg(jsonb_build_object(
        'legacy_key', mapping.legacy_key,
        'item_id', mapping.item_id,
        'item_name', item.name,
        'quantity_on_hand', coalesce(balance.quantity_on_hand, 0),
        'average_unit_cost', coalesce(balance.average_unit_cost, 0),
        'unit_name', unit.name,
        'updated_at', balance.updated_at
      ) order by item.name)
      from boy_central.pos_master_mappings mapping
      join boy_central.items item on item.id = mapping.item_id
      join boy_central.units unit on unit.id = item.base_unit_id
      left join boy_central.inventory_locations location
        on location.branch_id = burger_branch.id and location.active
      left join boy_central.inventory_balances balance
        on balance.location_id = location.id and balance.item_id = mapping.item_id
      where mapping.branch_id = burger_branch.id
        and mapping.source_system = 'burger_pos_app_state'
        and mapping.entity_type = 'ingredient'
        and mapping.match_status = 'matched'
        and mapping.item_id is not null
    ), '[]'::jsonb),
    'synced_order_external_ids', coalesce((
      select jsonb_agg(pos_order.external_id order by pos_order.ordered_at)
      from boy_central.pos_orders pos_order
      where pos_order.branch_id = burger_branch.id
        and pos_order.source_system = 'burger_pos_app_state'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function boy_central.get_burger_pos_sync_state() from public, anon;
grant execute on function boy_central.get_burger_pos_sync_state() to authenticated;

-- One-time opening balance: retain the quantities currently visible on the POS
-- so the tablet can continue selling. A physical count can supersede these
-- provisional values later through normal adjustment movements.
do $$
declare
  burger_branch boy_central.branches%rowtype;
  target_location_id uuid;
  entry jsonb;
  mapping_item_id uuid;
  before_quantity numeric(18,6);
  target_quantity numeric(18,6);
  unit_cost numeric(18,6);
  opening_key text;
begin
  select * into burger_branch
  from boy_central.branches
  where code = 'BURGER' and active
  limit 1;

  if burger_branch.id is null then return; end if;

  select id into target_location_id
  from boy_central.inventory_locations
  where branch_id = burger_branch.id and active
  order by created_at, id
  limit 1;

  if target_location_id is null then return; end if;

  for entry in
    select jsonb_array_elements(payload)
    from public.pos_app_state
    where store_id = 'boy-burger-main' and key = 'ingredients'
  loop
    select item_id into mapping_item_id
    from boy_central.pos_master_mappings
    where branch_id = burger_branch.id
      and source_system = 'burger_pos_app_state'
      and entity_type = 'ingredient'
      and legacy_key = entry->>'id'
      and match_status = 'matched'
      and item_id is not null;

    if mapping_item_id is null then continue; end if;

    opening_key := 'burger-pos-opening:' || (entry->>'id');
    if exists (
      select 1 from boy_central.stock_movements
      where company_id = burger_branch.company_id
        and source_system = 'burger_pos_cutover'
        and external_id = opening_key
    ) then continue; end if;

    target_quantity := coalesce(nullif(entry->>'stock', '')::numeric, 0);

    insert into boy_central.inventory_balances (
      company_id, branch_id, location_id, item_id
    ) values (
      burger_branch.company_id, burger_branch.id, target_location_id, mapping_item_id
    ) on conflict (location_id, item_id) do nothing;

    select quantity_on_hand, average_unit_cost
      into before_quantity, unit_cost
    from boy_central.inventory_balances
    where location_id = target_location_id and item_id = mapping_item_id
    for update;

    update boy_central.inventory_balances balance
    set quantity_on_hand = target_quantity,
        inventory_value = round((target_quantity * unit_cost)::numeric, 2),
        updated_at = now()
    where balance.location_id = target_location_id and balance.item_id = mapping_item_id;

    insert into boy_central.stock_movements (
      company_id, branch_id, location_id, item_id, movement_type,
      quantity_before, quantity_delta, quantity_after, unit_cost_base,
      movement_value, source_system, external_id, occurred_at, reason
    ) values (
      burger_branch.company_id, burger_branch.id, target_location_id, mapping_item_id,
      'opening', before_quantity, target_quantity - before_quantity,
      target_quantity, unit_cost,
      round((abs(target_quantity - before_quantity) * unit_cost)::numeric, 2),
      'burger_pos_cutover', opening_key, now(),
      'ยอดตั้งต้นชั่วคราวจาก Burger POS ก่อนตรวจนับจริง'
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
