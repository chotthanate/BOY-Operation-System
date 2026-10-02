-- Keep the Burger POS recipe and every purchasable bread brand on one shared
-- piece-based stock item. Purchase conversion stays on each expense item so a
-- 6-piece and a 10-piece pack can both increase the same balance correctly.

do $migration$
declare
  company uuid;
  burger uuid;
  bread_target uuid;
  piece_unit uuid;
  pack_unit uuid;
begin
  select b.company_id, b.id
    into company, burger
  from boy_central.branches b
  where b.code = 'BURGER' and b.active
  limit 1;

  select i.id
    into bread_target
  from boy_central.items i
  where i.company_id = company and i.code = 'ITEM-0336' and i.active;

  select u.id into piece_unit
  from boy_central.units u
  where u.company_id = company and u.code = 'UNIT-015' and u.active;

  select u.id into pack_unit
  from boy_central.units u
  where u.company_id = company and u.code = 'UNIT-002' and u.active;

  if company is null or burger is null or bread_target is null or piece_unit is null or pack_unit is null then
    raise exception 'Burger bread stock prerequisites are incomplete';
  end if;

  update boy_central.items
  set name = 'ขนมปัง',
      base_unit_id = piece_unit,
      track_stock = true,
      stock_target_item_id = null,
      purchaseable = false,
      issueable = true,
      updated_at = now()
  where id = bread_target;

  update boy_central.item_units
  set is_base_unit = false,
      allow_issue = false,
      updated_at = now()
  where item_id = bread_target;

  insert into boy_central.item_units
    (company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase,allow_issue,active)
  values
    (company,bread_target,piece_unit,1,true,true,true,true)
  on conflict(item_id,unit_id) do update set
    conversion_to_base = 1,
    is_base_unit = true,
    allow_purchase = true,
    allow_issue = true,
    active = true,
    updated_at = now();

  insert into boy_central.item_units
    (company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase,allow_issue,active)
  values
    (company,bread_target,pack_unit,1,false,true,false,true)
  on conflict(item_id,unit_id) do update set
    is_base_unit = false,
    allow_purchase = true,
    allow_issue = false,
    active = true,
    updated_at = now();

  update boy_central.branch_items
  set default_purchase_unit_id = null,
      default_issue_unit_id = piece_unit,
      updated_at = now()
  where branch_id = burger and item_id = bread_target;

  update boy_central.items
  set track_stock = false,
      stock_target_item_id = bread_target,
      updated_at = now()
  where company_id = company
    and code in ('ITEM-0271','ITEM-0272','ITEM-0273');

  update boy_central.expense_items ei
  set affects_stock = true,
      requires_quantity = true,
      requires_unit = true,
      purchase_unit_id = pack_unit,
      stock_conversion_to_base = case i.code
        when 'ITEM-0271' then 6
        when 'ITEM-0272' then 6
        when 'ITEM-0273' then 10
      end,
      updated_at = now()
  from boy_central.items i
  where ei.item_id = i.id
    and i.company_id = company
    and i.code in ('ITEM-0271','ITEM-0272','ITEM-0273')
    and ei.active;

  update boy_central.expense_items
  set affects_stock = false,
      requires_quantity = false,
      requires_unit = false,
      updated_at = now()
  where company_id = company and item_id = bread_target and active;
end
$migration$;
