-- Run inside BEGIN/ROLLBACK. Never leave test documents or identity edits behind.
do $test$
declare actor uuid; company uuid; data jsonb; entry jsonb; row_id uuid; expense uuid;
 missing integer; branch text; result jsonb; before_count integer;
begin
 select user_id,company_id into actor,company from boy_central.profiles where active and company_role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 foreach branch in array array['TAWANA','BIGC-CENTRAL-PATTAYA'] loop
  data:=boy_central.get_daily_catalog(branch,null);
  select count(*) into missing from jsonb_array_elements(data->'items') x
  join boy_central.master_runtime_links l on
   (l.item_id=(x->>'id')::uuid and x->>'expense_item_id' is null)
   or l.expense_item_id=nullif(x->>'expense_item_id','')::uuid
  join boy_central.categories c on c.company_id=company and c.category_type='item' and c.code=l.source_data->>'subcategory_id'
  where l.status='ready' and (x->>'subcategory_id' is distinct from c.id::text or x->>'sub' is distinct from c.name);
  if missing<>0 then raise exception 'Linked subcategories missing for %: %',branch,missing;end if;
  if exists(select 1 from jsonb_array_elements(data->'categories')x where x->>'code' in('SUB-0048','SUB-0088')) then raise exception 'Cross-store category leaked';end if;
  select x into entry from jsonb_array_elements(data->'items')x where x->>'code'='ITEM-0197';
  if entry is null or entry->>'name'<>'ค่าขนส่ง' or entry->>'sub'<>'ค่าส่ง' then raise exception 'Shipping expense still missing';end if;
 end loop;
 select r.id,l.expense_item_id into row_id,expense from boy_central.master_catalog_rows r
 join boy_central.master_catalog_sheets s on s.id=r.sheet_id
 join boy_central.master_runtime_links l on l.master_row_id=r.id
 where r.company_id=company and s.sheet_name='M_รายการค่าใช้จ่าย' and r.record_key='EXP-0003';
 if not exists(select 1 from boy_central.expense_items where id=expense and code='EXP-BURGER-DELIVERY') then raise exception 'Legacy UUID not preserved';end if;
 select count(*) into before_count from boy_central.expense_items;
 if boy_central_private.sync_master_runtime_row(row_id,true)<>'ready' then raise exception 'Reviewed link lost on later edit';end if;
 if (select expense_item_id from boy_central.master_runtime_links where master_row_id=row_id)<>expense
  or (select count(*) from boy_central.expense_items)<>before_count then raise exception 'Expense identity duplicated';end if;
 result:=boy_central.post_daily_document(jsonb_build_object('branch_code','TAWANA','business_date','2099-04-11',
  'request_id',gen_random_uuid(),'expected_revision',0,'data',jsonb_build_object('exp',jsonb_build_array(jsonb_build_object(
   'i',entry->>'name','expense_item_id',entry->>'expense_item_id','master_code',entry->>'code',
   'category_id',entry->>'category_id','p',50,'pay','cash','receiving_mode','immediate')))));
 if result->>'status'<>'Success' then raise exception 'Shipping expense cannot save';end if;
 data:=boy_central.get_daily_catalog('TAWANA',null);
 if not (boy_central.get_daily_catalog('TAWANA',data->>'version')->>'not_modified')::boolean then raise exception 'Catalog cache contract broken';end if;
end $test$;
select 'Linked subcategories, shipping legacy UUID, edits, posting, branch filters and version cache passed' result;
