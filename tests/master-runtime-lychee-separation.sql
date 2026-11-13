-- Read-only post-migration check. This does not change stock or sales history.
do $$
declare
  bread boy_central.items%rowtype;
  lychee boy_central.items%rowtype;
  master_row boy_central.master_catalog_rows%rowtype;
begin
  select * into bread from boy_central.items where code = 'ITEM-0336' and name = 'ขนมปัง';
  select * into lychee from boy_central.items where code = 'ITEM-0400' and name = 'ลิ้นจี่ แช่แข็ง aro  1 กก.';
  if bread.id is null or lychee.id is null or bread.id = lychee.id then
    raise exception 'Bread and Aro lychee must have separate runtime identities';
  end if;
  if (select count(*) from boy_central.stock_movements where item_id = bread.id) <> 927
     or (select count(*) from boy_central.recipes where item_id = bread.id) <> 12
     or exists (select 1 from boy_central.stock_movements where item_id = lychee.id)
     or exists (select 1 from boy_central.recipes where item_id = lychee.id) then
    raise exception 'Bread history changed or Aro lychee unexpectedly has history';
  end if;
  select r.* into master_row from boy_central.master_catalog_rows r
  join boy_central.master_catalog_sheets s on s.id = r.sheet_id
  where s.sheet_name = 'M_สินค้า' and r.record_key = 'ITEM-0400';
  if master_row.id is null or master_row.row_data->>'item_id' <> 'ITEM-0400'
     or not exists (select 1 from boy_central.master_runtime_links
                    where master_row_id = master_row.id and item_id = lychee.id and status = 'ready')
     or not exists (
       select 1 from boy_central.master_catalog_rows r
       join boy_central.master_catalog_sheets s on s.id = r.sheet_id
       where s.sheet_name = 'M_หน่วยสินค้า' and r.record_key = 'IU-00288'
         and r.row_data->>'item_id' = 'ITEM-0400'
     ) then
    raise exception 'Aro lychee Master identity or purchase-unit mapping is incomplete';
  end if;
end $$;
select 'Aro lychee and bread identities verified' as result;
