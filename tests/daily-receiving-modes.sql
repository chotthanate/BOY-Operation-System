-- Run inside BEGIN/ROLLBACK. No fixture, purchase or balance may remain.
do $test$
declare actor uuid; company uuid; branch uuid; category uuid; unit uuid; item uuid; location uuid;
 document uuid; body jsonb; payload jsonb; result jsonb; receipts integer; old_ids uuid[]; cat jsonb;
begin
 select user_id,company_id into actor,company from boy_central.profiles where active and company_role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select id into branch from boy_central.branches where code='TAWANA';
 select id into category from boy_central.categories where company_id=company and parent_id is null and category_type='item' and code~'^CAT-[0-9]+$' and active limit 1;
 select id into unit from boy_central.units where company_id=company and active limit 1;
 insert into boy_central.items(company_id,code,name,item_type,base_unit_id,category_id,track_stock,purchaseable)
 select company,'QA-'||gen_random_uuid(),'Rollback purchase mode QA',item_type,unit,category,true,true from boy_central.items where company_id=company limit 1 returning id into item;
 insert into boy_central.inventory_locations(company_id,branch_id,code,name)
 values(company,branch,'QA-'||gen_random_uuid(),'Rollback QA location') returning id into location;
 insert into boy_central.branch_items(company_id,branch_id,item_id,default_location_id) values(company,branch,item,location);
 insert into boy_central.item_units(company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase) values(company,item,unit,1,true,true);
 body:=jsonb_build_object('cash',jsonb_build_object('v',100),'transfer',jsonb_build_object('v',0),'other',jsonb_build_object('v',0),
  'exp',jsonb_build_array(
   jsonb_build_object('i','QA immediate','item_id',item,'category_id',category,'unit_id',unit,'q',2,'p',20,'pay','cash','receiving_mode','immediate'),
   jsonb_build_object('i','QA delivery','item_id',item,'category_id',category,'unit_id',unit,'q',3,'p',30,'pay','cash','receiving_mode','delivery')));
 payload:=jsonb_build_object('branch_code','TAWANA','business_date','2099-03-12','request_id',gen_random_uuid(),'expected_revision',0,'data',body);
 result:=boy_central.post_daily_document(payload); document:=(result->>'document_id')::uuid;
 if (select quantity_on_hand from boy_central.inventory_balances where location_id=location and item_id=item)<>2 then raise exception 'delivery changed physical stock';end if;
 select count(*) into receipts from boy_central.purchase_receipts r join boy_central.transactions t on t.id=r.transaction_id where t.id=any((select transaction_ids from boy_central.daily_documents where id=document)::uuid[]) and r.status='pending';
 if receipts<>1 then raise exception 'pending receipt not split from immediate purchase';end if;
 select transaction_ids into old_ids from boy_central.daily_documents where id=document;
 result:=boy_central.post_daily_document(payload);
 if not(result->>'duplicate')::boolean then raise exception 'duplicate not acknowledged';end if;
 if (select quantity_on_hand from boy_central.inventory_balances where location_id=location and item_id=item)<>2 then raise exception 'retry received twice';end if;
 result:=boy_central.post_daily_document(payload||jsonb_build_object('request_id',gen_random_uuid(),'expected_revision',1,'data',jsonb_set(body,'{cash,v}','150')));
 if (select transaction_ids from boy_central.daily_documents where id=document) is distinct from old_ids then raise exception 'income correction reposted expenses';end if;
 if (select quantity_on_hand from boy_central.inventory_balances where location_id=location and item_id=item)<>2 then raise exception 'income correction changed stock';end if;
 begin
  perform boy_central.post_daily_document(payload||jsonb_build_object('request_id',gen_random_uuid(),'expected_revision',2,'data',jsonb_set(body,'{exp,0,q}','4')));
  raise exception 'changed received purchase was accepted';
 exception when others then
  if sqlerrm not like 'received purchase cannot be replaced%' then raise;end if;
 end;
 cat:=boy_central.get_daily_catalog('TAWANA',null);
 if not exists(select 1 from jsonb_array_elements(cat->'items') i where i->>'expense_item_id' is not null) then raise exception 'expense definitions missing from catalog';end if;
 if exists(select 1 from jsonb_array_elements(cat->'items') i join boy_central.master_runtime_links l on l.item_id=(i->>'id')::uuid where l.status<>'ready') then raise exception 'quarantine exposed';end if;
 if has_function_privilege('anon','boy_central.record_expense_v4(jsonb)','execute') then raise exception 'anonymous expense write';end if;
end $test$;
select 'daily immediate/delivery, retries, income-only correction, catalog and permissions passed' as result;
