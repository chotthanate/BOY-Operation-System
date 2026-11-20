-- All writes are test-only and must be rolled back.
do $test$
declare owner uuid;company uuid;main jsonb;sub jsonb;water jsonb;burger jsonb;catalog jsonb;old_count bigint;
begin
 select user_id,company_id into owner,company from boy_central.profiles where active and company_role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',owner::text,true);
 select count(*) into old_count from boy_central.master_catalog_rows;
 main:=boy_central.create_expense_category(jsonb_build_object('branch_code','TAWANA','kind','main','name','QA water main','store_types',jsonb_build_array('water')));
 sub:=boy_central.create_expense_category(jsonb_build_object('branch_code','TAWANA','kind','sub','parent_id',main->>'id','name','QA water sub','store_types',jsonb_build_array('water')));
 water:=boy_central.get_expense_category_options('TAWANA');burger:=boy_central.get_expense_category_options('BURGER');
 if not exists(select 1 from jsonb_array_elements(water)c where c->>'id'=sub->>'id') then raise exception 'new category missing from owner branch';end if;
 if exists(select 1 from jsonb_array_elements(burger)c where c->>'id' in(main->>'id',sub->>'id')) then raise exception 'water category leaked to burger';end if;
 if exists(select 1 from jsonb_array_elements(water)c where c->>'code' in('SUB-0048','SUB-0088')) then raise exception 'burger/grill category leaked to water';end if;
 if (select count(*) from boy_central.master_catalog_rows)<>old_count+2 then raise exception 'central category rows missing';end if;
 if not exists(select 1 from boy_central.master_catalog_rows r join boy_central.master_catalog_sheets s on s.id=r.sheet_id where s.sheet_name='M_หมวดหมู่' and r.record_key=sub->>'code' and r.row_data->>'ใช้กับร้านน้ำ'='true') then raise exception 'central store scope or generated ID missing';end if;
 catalog:=boy_central.get_daily_catalog('TAWANA',null);
 if not exists(select 1 from jsonb_array_elements(catalog->'categories')c where c->>'id'=sub->>'id') then raise exception 'daily category list stale';end if;
 begin
  perform boy_central.create_expense_category(jsonb_build_object('branch_code','TAWANA','kind','sub','parent_id',main->>'id','name','QA water sub','store_types',jsonb_build_array('water')));
  raise exception 'duplicate category accepted';
 exception when others then if sqlerrm='duplicate category accepted' then raise;end if;end;
 if has_function_privilege('anon','boy_central.create_expense_category(jsonb)','execute') then raise exception 'anonymous category write granted';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 begin
  perform boy_central.create_expense_category(jsonb_build_object('branch_code','TAWANA','kind','main','name','denied','store_types','[]'::jsonb));
  raise exception 'non-admin category accepted';
 exception when others then if sqlerrm not like '%เฉพาะแอดมิน%' then raise;end if;end;
end $test$;
select 'category UUIDs, central codes, branch scope, daily refresh, duplicate and authorization checks passed' result;
