-- Run BEGIN, this setup, migration, assertions below, then ROLLBACK.
create temporary table bridge_original_items as select * from boy_central.items;
create temporary table bridge_original_expenses as select * from boy_central.expense_items;
create temporary table bridge_original_stock as select md5(coalesce(jsonb_agg(to_jsonb(b) order by id),'[]')::text) digest from boy_central.inventory_balances b;
create temporary table bridge_original_movements as select count(*) n from boy_central.stock_movements;
create temporary table bridge_original_recipes as select md5(coalesce(jsonb_agg(to_jsonb(r) order by id),'[]')::text) digest from boy_central.recipes r;
-- MIGRATION
-- ASSERTIONS
do $$
declare r record;company uuid;renamed text:='QA-rename-'||gen_random_uuid();old_id uuid;old_code text;other_unit text;rejected boolean;
begin
 if exists(select 1 from bridge_original_items old left join boy_central.items current on current.id=old.id where current is null or to_jsonb(current)<>to_jsonb(old)) then raise exception 'existing item identity, metadata or unit changed';end if;
 if exists(select 1 from bridge_original_expenses old left join boy_central.expense_items current on current.id=old.id where current is null or to_jsonb(current)<>to_jsonb(old)) then raise exception 'existing expense changed';end if;
 if (select digest from bridge_original_stock)<>(select md5(coalesce(jsonb_agg(to_jsonb(b) order by id),'[]')::text) from boy_central.inventory_balances b) then raise exception 'stock balance changed';end if;
 if (select n from bridge_original_movements)<>(select count(*) from boy_central.stock_movements) then raise exception 'stock movement created';end if;
 if (select digest from bridge_original_recipes)<>(select md5(coalesce(jsonb_agg(to_jsonb(b) order by id),'[]')::text) from boy_central.recipes b) then raise exception 'recipe changed';end if;
 if has_function_privilege('anon','boy_central_private.backfill_master_runtime(uuid)','execute') or has_function_privilege('authenticated','boy_central_private.sync_master_runtime_row(uuid,boolean)','execute') then raise exception 'runtime writer exposed';end if;
 select m.id,m.company_id,l.item_id into r from boy_central.master_runtime_links l join boy_central.master_catalog_rows m on m.id=l.master_row_id
 where l.status='ready' and l.item_id is not null and not exists(select 1 from bridge_original_items old where old.id=l.item_id) limit 1;
 old_id:=r.item_id;company:=r.company_id;
 update boy_central.master_catalog_rows set row_data=jsonb_set(row_data,'{ชื่อสินค้า}',to_jsonb(renamed)) where id=r.id;
 if not exists(select 1 from boy_central.items where id=old_id and name=renamed) then raise exception 'rename broke UUID';end if;
 perform boy_central_private.backfill_master_runtime(company);
 if not exists(select 1 from boy_central.master_runtime_links where master_row_id=r.id and item_id=old_id and status='ready') then raise exception 'backfill changed new UUID';end if;
 select m.id,l.item_id into r from boy_central.master_runtime_links l join boy_central.master_catalog_rows m on m.id=l.master_row_id
 where l.status='ready' and l.item_id is not null and(exists(select 1 from boy_central.transaction_lines where item_id=l.item_id) or exists(select 1 from boy_central.stock_movements where item_id=l.item_id)) limit 1;
 if r.id is null then raise exception 'missing historical unit-guard fixture';end if;
 select u.code into other_unit from boy_central.units u join boy_central.items i on i.id=r.item_id where u.company_id=i.company_id and u.id<>i.base_unit_id and u.active limit 1;
 rejected:=false;
 begin update boy_central.master_catalog_rows set row_data=jsonb_set(row_data,'{base_unit_id}',to_jsonb(other_unit)) where id=r.id;
 exception when others then rejected:=sqlerrm like 'สินค้านี้มีธุรกรรม%';end;
 if not rejected then raise exception 'historical base unit changed without conversion';end if;
 if not exists(select 1 from boy_central.master_runtime_links l join boy_central.master_catalog_rows m on m.id=l.master_row_id where m.record_key='ITEM-0336' and l.status='unit_review') then raise exception 'reused bread code not quarantined';end if;
end $$;
select 'master/runtime bridge safety assertions passed' result;
