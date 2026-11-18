-- Run inside BEGIN/ROLLBACK with master_store_scope migration.
do $test$
declare r boy_central.master_catalog_rows; result jsonb; before_count bigint; denied boolean;
begin
 perform set_config('request.jwt.claim.sub',(select user_id::text from boy_central.profiles where active and company_role='admin' limit 1),true);
 select count(*) into before_count from boy_central.stock_movements;
 select m.* into r from boy_central.master_catalog_rows m join boy_central.master_catalog_sheets s on s.id=m.sheet_id where s.sheet_name='M_สินค้า' and m.record_key='ITEM-0136';
 perform boy_central.bulk_upsert_master_catalog_rows('M_สินค้า',jsonb_build_array(jsonb_build_object('item_id',r.record_key,'__version',r.source_version,'store_types',jsonb_build_array('water'))),'QA scope rollback');
 if exists(select 1 from boy_central.branch_items bi join boy_central.branches b on b.id=bi.branch_id join boy_central.items i on i.id=bi.item_id where i.code=r.record_key and b.code in ('GRILL','BURGER') and bi.active) then raise exception 'unchecked shop remained active'; end if;
 result:=boy_central.get_master_catalog('M_สินค้า');
 if not exists(select 1 from jsonb_array_elements(result->'rows') x where x->>'item_id'=r.record_key and x->'store_types'='["water"]'::jsonb) then raise exception 'reload lost scope'; end if;
 select * into r from boy_central.master_catalog_rows where id=r.id;
 perform boy_central.bulk_upsert_master_catalog_rows('M_สินค้า',jsonb_build_array(jsonb_build_object('item_id',r.record_key,'__version',r.source_version,'store_types','[]'::jsonb)),'QA shared scope rollback');
 if exists(select 1 from boy_central.branch_items bi join boy_central.items i on i.id=bi.item_id where i.code=r.record_key and not bi.active) then raise exception 'empty scope did not mean shared'; end if;
 if (select count(*) from boy_central.stock_movements)<>before_count then raise exception 'scope changed stock history'; end if;
 denied:=false;
 begin
  perform boy_central.bulk_upsert_master_catalog_rows('M_สินค้า',jsonb_build_array(jsonb_build_object('item_id',r.record_key,'__version',r.source_version,'store_types','["unknown"]'::jsonb)),'QA invalid');
 exception when others then denied:=true; end;
 if not denied then raise exception 'invalid or stale edit accepted'; end if;
end;
$test$;
