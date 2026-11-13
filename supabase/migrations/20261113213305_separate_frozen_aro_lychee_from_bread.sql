-- ITEM-0336 belongs to the operational pooled burger bread.  The Master row
-- for frozen Aro lychee accidentally reused that code; move only that Master
-- identity and its purchase-unit mapping.  Never relabel or revalue bread.
do $$
declare
  lychee_row boy_central.master_catalog_rows%rowtype;
  unit_row boy_central.master_catalog_rows%rowtype;
  bread_id uuid;
  lychee_id uuid;
  frozen_target_id uuid;
  bread_movements bigint;
  bread_recipes bigint;
begin
  select r.* into lychee_row
  from boy_central.master_catalog_rows r
  join boy_central.master_catalog_sheets s on s.id = r.sheet_id
  where s.sheet_name = 'M_สินค้า' and r.record_key = 'ITEM-0336'
  for update of r;
  if lychee_row.id is null
     or lychee_row.row_data->>'ชื่อสินค้า' <> 'ลิ้นจี่ แช่แข็ง aro  1 กก.'
     or lychee_row.row_data->>'base_unit_id' <> 'UNIT-001'
     or lychee_row.row_data->>'stock_target_item_id' <> 'ITEM-179326699290620'
     or not lychee_row.active then
    raise exception 'Frozen Aro lychee Master row changed; review before migrating';
  end if;

  if exists (
    select 1 from boy_central.master_catalog_rows r
    join boy_central.master_catalog_sheets s on s.id = r.sheet_id
    where s.sheet_name = 'M_สินค้า' and r.record_key = 'ITEM-0400'
  ) or exists (select 1 from boy_central.items where company_id = lychee_row.company_id and code = 'ITEM-0400') then
    raise exception 'ITEM-0400 is already allocated';
  end if;

  select id into bread_id from boy_central.items
  where company_id = lychee_row.company_id and code = 'ITEM-0336' and name = 'ขนมปัง'
  for update;
  select id into frozen_target_id from boy_central.items
  where company_id = lychee_row.company_id and code = 'ITEM-179326699290620'
    and name = 'ลิ้นจี่แช่แข็ง 1 กก.';
  if bread_id is null or frozen_target_id is null then
    raise exception 'Bread or frozen lychee stock target is missing';
  end if;
  select count(*) into bread_movements from boy_central.stock_movements where item_id = bread_id;
  select count(*) into bread_recipes from boy_central.recipes where item_id = bread_id;

  select r.* into unit_row
  from boy_central.master_catalog_rows r
  join boy_central.master_catalog_sheets s on s.id = r.sheet_id
  where s.sheet_name = 'M_หน่วยสินค้า' and r.record_key = 'IU-00288'
  for update of r;
  if unit_row.id is null or unit_row.row_data->>'item_id' <> 'ITEM-0336'
     or unit_row.row_data->>'unit_id' <> 'UNIT-001'
     or (select count(*) from boy_central.master_catalog_rows r
         join boy_central.master_catalog_sheets s on s.id = r.sheet_id
         where s.sheet_name = 'M_หน่วยสินค้า' and r.row_data->>'item_id' = 'ITEM-0336') <> 1 then
    raise exception 'Frozen Aro lychee purchase-unit mapping changed';
  end if;

  -- Changing record_key and row_data together makes the existing guarded
  -- trigger create a fresh runtime UUID, instead of mutating the bread UUID.
  update boy_central.master_catalog_rows
  set record_key = 'ITEM-0400',
      row_data = jsonb_set(row_data, '{item_id}', to_jsonb('ITEM-0400'::text))
  where id = lychee_row.id;

  select id into lychee_id from boy_central.items
  where company_id = lychee_row.company_id and code = 'ITEM-0400'
  for update;
  if lychee_id is null or lychee_id = bread_id then
    raise exception 'Frozen Aro lychee did not receive a separate runtime identity';
  end if;

  update boy_central.master_catalog_rows
  set row_data = jsonb_set(row_data, '{item_id}', to_jsonb('ITEM-0400'::text))
  where id = unit_row.id;

  update boy_central.items
  set stock_target_item_id = frozen_target_id, track_stock = false
  where id = lychee_id;

  if not exists (
    select 1 from boy_central.master_runtime_links
    where master_row_id = lychee_row.id and item_id = lychee_id and status = 'ready'
  ) or not exists (
    select 1 from boy_central.item_units iu
    join boy_central.units u on u.id = iu.unit_id
    where iu.item_id = lychee_id and u.code = 'UNIT-001'
      and iu.conversion_to_base = 1 and iu.is_base_unit
  ) or (select count(*) from boy_central.stock_movements where item_id = bread_id) <> bread_movements
    or (select count(*) from boy_central.recipes where item_id = bread_id) <> bread_recipes
    or (select name from boy_central.items where id = bread_id) <> 'ขนมปัง' then
    raise exception 'Post-migration identity or bread-history check failed';
  end if;
end $$;
