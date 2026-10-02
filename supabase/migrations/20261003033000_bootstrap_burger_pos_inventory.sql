-- Give every Burger branch item a usable stock location, then apply the
-- historical Burger POS sale deltas that arrived before that location existed.
-- The movement external IDs make this safe to run more than once.

do $migration$
declare
  burger_branch_id uuid;
  burger_company_id uuid;
  main_location_id uuid;
  row_data record;
  balance_data boy_central.inventory_balances%rowtype;
begin
  select b.id, b.company_id
    into burger_branch_id, burger_company_id
  from boy_central.branches b
  where b.code = 'BURGER'
  limit 1;

  select l.id
    into main_location_id
  from boy_central.inventory_locations l
  where l.branch_id = burger_branch_id and l.active
  order by l.created_at
  limit 1;

  if burger_branch_id is null or main_location_id is null then
    raise exception 'Burger branch or its active inventory location is missing';
  end if;

  update boy_central.branch_items
  set default_location_id = main_location_id,
      updated_at = now()
  where branch_id = burger_branch_id
    and active
    and default_location_id is null;

  for row_data in
    with raw_deltas as (
      select
        nullif(delta->>'central_item_id', '') as central_item_id,
        case trim(delta->>'name')
          when 'ขนมปังเบอร์เกอร์' then 'ขนมปัง'
          when 'ชีส' then 'ชีส Allowrie'
          when 'เนื้อกุ้ง' then 'เนื้อกุ้ง Ramly 65 กรัม'
          when 'เนื้อไก่' then 'เนื้อไก่ Ramly 60 กรัม'
          when 'เนื้อปลา' then 'เนื้อปลา Ramly 65 กรัม'
          when 'เนื้อวัว' then 'เนื้อวัว Ramly 60 กรัม'
          else trim(delta->>'name')
        end as target_name,
        (delta->>'quantity_delta')::numeric as quantity_delta,
        e.occurred_at
      from boy_central.pos_sync_events e
      cross join lateral jsonb_array_elements(coalesce(e.payload->'stock_deltas', '[]'::jsonb)) delta
      where e.branch_id = burger_branch_id
        and e.event_type = 'ORDER'
    )
    select
      i.id as item_id,
      sum(r.quantity_delta) as quantity_delta,
      max(r.occurred_at) as occurred_at
    from raw_deltas r
    join boy_central.items i
      on i.company_id = burger_company_id
     and i.active
     and i.track_stock
     and (
       (r.central_item_id is not null and i.id::text = r.central_item_id)
       or i.name = r.target_name
     )
    join boy_central.branch_items bi
      on bi.branch_id = burger_branch_id
     and bi.item_id = i.id
     and bi.active
    group by i.id
  loop
    if not exists (
      select 1
      from boy_central.stock_movements sm
      where sm.company_id = burger_company_id
        and sm.source_system = 'burger_pos_backfill_v13'
        and sm.external_id = 'sales-20260905-20261002:' || row_data.item_id::text
    ) then
      insert into boy_central.inventory_balances (
        company_id, branch_id, location_id, item_id,
        quantity_on_hand, average_unit_cost, inventory_value
      )
      values (
        burger_company_id, burger_branch_id, main_location_id, row_data.item_id,
        0, 0, 0
      )
      on conflict (location_id, item_id) do nothing;

      select *
        into balance_data
      from boy_central.inventory_balances
      where location_id = main_location_id
        and item_id = row_data.item_id
      for update;

      insert into boy_central.stock_movements (
        company_id, branch_id, location_id, item_id,
        movement_type, quantity_before, quantity_delta, quantity_after,
        unit_cost_base, movement_value, source_system, external_id,
        occurred_at, reason
      )
      values (
        burger_company_id, burger_branch_id, main_location_id, row_data.item_id,
        'sale', balance_data.quantity_on_hand, row_data.quantity_delta,
        balance_data.quantity_on_hand + row_data.quantity_delta,
        balance_data.average_unit_cost,
        abs(row_data.quantity_delta) * balance_data.average_unit_cost,
        'burger_pos_backfill_v13',
        'sales-20260905-20261002:' || row_data.item_id::text,
        row_data.occurred_at,
        'ตัดสต็อกย้อนหลังจากยอดขาย Burger POS'
      );

      update boy_central.inventory_balances
      set quantity_on_hand = quantity_on_hand + row_data.quantity_delta,
          inventory_value = (quantity_on_hand + row_data.quantity_delta) * average_unit_cost,
          updated_at = now()
      where id = balance_data.id;
    end if;
  end loop;
end
$migration$;
