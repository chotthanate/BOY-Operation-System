-- Run after migration inside BEGIN/ROLLBACK. Never retain the fixtures.
do $test$
declare actor uuid;company uuid;b record;category uuid;base uuid;pack uuid;
 self_item uuid;pool uuid;brand uuid;untracked uuid;location uuid;workspace jsonb;body jsonb;result jsonb;
 expected jsonb;entry jsonb;txn uuid;receipt uuid;receipt_body jsonb;pos_token text;listing jsonb;source record;resolved jsonb;unit uuid;mapped uuid;
begin
 select user_id,company_id into actor,company from boy_central.profiles where active and company_role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select id into category from boy_central.categories where company_id=company and parent_id is null and active and code~'^CAT-[0-9]+$' limit 1;
 select id into base from boy_central.units where company_id=company and active limit 1;
 select id into pack from boy_central.units where company_id=company and active and id<>base limit 1;
 for b in select id,code from boy_central.branches where code in('TAWANA','BURGER','GRILL','BIGC-CENTRAL-PATTAYA','BIGC-SOUTH-PATTAYA') loop
  insert into boy_central.items(company_id,code,name,category_id,base_unit_id,track_stock,purchaseable)
   values(company,'QA-'||gen_random_uuid(),'QA routing tracked '||b.code,category,base,true,true) returning id into self_item;
  insert into boy_central.items(company_id,code,name,category_id,base_unit_id,track_stock,purchaseable)
   values(company,'QA-'||gen_random_uuid(),'QA routing pool '||b.code,category,base,true,true) returning id into pool;
  insert into boy_central.items(company_id,code,name,category_id,base_unit_id,track_stock,purchaseable,stock_target_item_id)
   values(company,'QA-'||gen_random_uuid(),'QA routing brand '||b.code,category,base,false,true,pool) returning id into brand;
  insert into boy_central.items(company_id,code,name,category_id,base_unit_id,track_stock,purchaseable)
   values(company,'QA-'||gen_random_uuid(),'QA routing untracked '||b.code,category,base,false,true) returning id into untracked;
  insert into boy_central.inventory_locations(company_id,branch_id,code,name) values(company,b.id,'QA-'||gen_random_uuid(),'Rollback location') returning id into location;
  insert into boy_central.branch_items(company_id,branch_id,item_id,default_location_id)
   values(company,b.id,self_item,location),(company,b.id,pool,location),(company,b.id,brand,location),(company,b.id,untracked,location);
  insert into boy_central.item_units(company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase)
   values(company,self_item,base,1,true,true),(company,pool,base,1,true,true),(company,brand,base,1,true,true),(company,untracked,base,1,true,true),
   (company,self_item,pack,5,false,true),(company,brand,pack,4,false,true),(company,untracked,pack,3,false,true);
  expected:=jsonb_build_array(jsonb_build_object('item_id',self_item,'quantity',2,'conversion_to_base',999,'category_id',category,'unit_id',pack,'description','QA self','line_total',20),
    jsonb_build_object('item_id',brand,'quantity',2,'conversion_to_base',999,'category_id',category,'unit_id',pack,'description','QA brand','line_total',30),
    jsonb_build_object('item_id',untracked,'quantity',2,'conversion_to_base',999,'category_id',category,'unit_id',pack,'description','QA untracked','line_total',40),
    jsonb_build_object('quantity',0,'category_id',category,'description','QA expense','custom_expense',true,'line_total',10));
  body:='[]';
  for entry in select value from jsonb_array_elements(expected) loop
   body:=body||jsonb_build_array(entry||'{"receiving_mode":"immediate"}'::jsonb,entry||'{"receiving_mode":"delivery"}'::jsonb);
  end loop;
  workspace:=boy_central.get_finance_entry_workspace(b.code);
  body:=jsonb_build_object('branch_code',b.code,'request_id',gen_random_uuid(),'date','2099-07-01','expected_revision',workspace->'revision','lines',body);
  begin
   perform boy_central.record_finance_expenses(jsonb_set(body,'{lines}',jsonb_build_array(jsonb_build_object('description','Missing product identity','category_id',category,'line_total',10))));
   raise exception 'unlinked product silently posted';
  exception when others then if sqlerrm not like 'เลือกสินค้า%' then raise;end if;end;
  result:=boy_central.record_finance_expenses(body);
  if (select quantity_on_hand from boy_central.inventory_balances where location_id=location and item_id=self_item)<>10 then raise exception 'immediate stock incorrect %',b.code;end if;
  if (select quantity_on_hand from boy_central.inventory_balances where location_id=location and item_id=pool)<>8 then raise exception 'pooled brand did not enter stock %',b.code;end if;
  if exists(select 1 from boy_central.inventory_balances where item_id in(brand,untracked)) then raise exception 'stock recorded against wrong item %',b.code;end if;
  if (select count(*) from boy_central.transaction_lines where purchased_item_id=brand and item_id=pool)<>2 then raise exception 'purchase brand identity lost %',b.code;end if;
  select r.id into receipt from boy_central.purchase_receipts r join boy_central.transactions t on t.id=r.transaction_id
   where t.id in(select value::text::uuid from jsonb_array_elements_text(result->'transaction_ids')) and r.status='pending';
  if receipt is null or (select count(*) from boy_central.purchase_receipt_lines where receipt_id=receipt)<>3 then raise exception 'pending physical goods missing %',b.code;end if;
  if not exists(select 1 from jsonb_array_elements(boy_central.get_branch_pending_receipts(b.code))x where x->>'receipt_id'=receipt::text and x->>'status'='pending') then raise exception 'web pending list mismatch';end if;
  pos_token:=gen_random_uuid()::text;
  insert into boy_central.pos_devices(company_id,branch_id,device_code,device_name,status,access_token_hash)
   values(company,b.id,'QA-'||gen_random_uuid(),'Rollback receipt device','active',encode(extensions.digest(pos_token,'sha256'),'hex'));
  if b.code='BURGER' then listing:=public.burger_purchase_receipts(pos_token);
  elsif b.code='GRILL' then listing:=public.grill_purchase_receipts(pos_token);
  else listing:=public.pos_pending_receipts(pos_token);end if;
  if not exists(select 1 from jsonb_array_elements(listing)x where x->>'receipt_id'=receipt::text) then raise exception 'POS pending list mismatch %',b.code;end if;
  receipt_body:=jsonb_build_object('receipt_id',receipt,'request_id',gen_random_uuid(),'lines',
   (select jsonb_agg(jsonb_build_object('line_id',id,'quantity',quantity_expected,'expected_received',0)) from boy_central.purchase_receipt_lines where receipt_id=receipt));
  if b.code='BURGER' then result:=public.burger_receive_purchase(pos_token,receipt_body);
  elsif b.code='GRILL' then result:=public.grill_receive_purchase(pos_token,receipt_body);
  else result:=boy_central.receive_purchase_receipt_lines(receipt_body);end if;
  if result->>'status'<>'received' then raise exception 'receipt not completed %',b.code;end if;
  if (select quantity_on_hand from boy_central.inventory_balances where location_id=location and item_id=self_item)<>20 then raise exception 'received stock incorrect %',b.code;end if;
  if (select quantity_on_hand from boy_central.inventory_balances where location_id=location and item_id=pool)<>16 then raise exception 'received pooled stock incorrect %',b.code;end if;
  if exists(select 1 from boy_central.inventory_balances where item_id in(brand,untracked)) then raise exception 'nonstock or brand has balance';end if;
  perform boy_central.record_finance_expenses(body);
  perform boy_central.receive_purchase_receipt_lines(receipt_body);
  if (select quantity_on_hand from boy_central.inventory_balances where location_id=location and item_id=pool)<>16 then raise exception 'retry doubled stock %',b.code;end if;
  if exists(select 1 from jsonb_array_elements(boy_central.get_branch_pending_receipts(b.code))x where x->>'receipt_id'=receipt::text and x->>'status'='pending') then raise exception 'completed receipt remains pending';end if;
  insert into boy_central.expense_items(company_id,code,name,category_id,item_id,affects_stock,requires_quantity,requires_unit,purchase_unit_id,stock_conversion_to_base)
   values(company,'QA-'||gen_random_uuid(),'QA mapped '||b.code,category,brand,true,false,false,base,1) returning id into mapped;
  workspace:=boy_central.get_finance_entry_workspace(b.code);
  body:=jsonb_build_object('branch_code',b.code,'request_id',gen_random_uuid(),'date','2099-07-02','expected_revision',workspace->'revision','lines',
   jsonb_build_array(jsonb_build_object('description','QA mapped','expense_item_id',mapped,'quantity',0,'category_id',category,'line_total',10,'receiving_mode','immediate')));
  begin perform boy_central.record_finance_expenses(body);raise exception 'mapped stock accepted zero quantity';
  exception when others then if sqlerrm not like 'กรอกจำนวนสินค้า%' then raise;end if;end;
  result:=boy_central.record_finance_expenses(jsonb_set(body,'{lines,0,quantity}','1'));
  if (select quantity_on_hand from boy_central.inventory_balances where location_id=location and item_id=pool)<>17 then raise exception 'mapped expense flags prevented stock %',b.code;end if;
 end loop;
 -- Real catalog configuration, resolver-only: no purchase or balance is written.
 for source in select i.* from boy_central.items i where i.code in('ITEM-0271','ITEM-0272','ITEM-0273','ITEM-0274','ITEM-0278') and i.active loop
  select iu.unit_id into unit from boy_central.item_units iu join boy_central.units u on u.id=iu.unit_id where iu.item_id=source.id and iu.active and iu.allow_purchase and u.name='แพ็ค' limit 1;
  resolved:=boy_central_private.resolve_direct_purchase_line(jsonb_build_object('item_id',source.id,'unit_id',unit,'quantity',2,'conversion_to_base',999),company);
  if (resolved->>'item_id')::uuid<>source.stock_target_item_id or (resolved->>'purchased_item_id')::uuid<>source.id then raise exception 'real brand identity unresolved';end if;
  if source.code in('ITEM-0271','ITEM-0272') and (resolved->>'conversion_to_base')::numeric<>6 then raise exception 'bread pack conversion incorrect';end if;
  if source.code='ITEM-0273' and (resolved->>'conversion_to_base')::numeric<>10 then raise exception 'cross-base bread conversion incorrect';end if;
  if source.code='ITEM-0274' and (resolved->>'conversion_to_base')::numeric<>87 then raise exception 'cheese pack conversion incorrect';end if;
  if source.code='ITEM-0278' and (resolved->>'conversion_to_base')::numeric<>20 then raise exception 'current pork purchase pack ignored';end if;
  if source.code='ITEM-0273' then
   select base_unit_id into unit from boy_central.items where id=source.stock_target_item_id;
   resolved:=boy_central_private.resolve_direct_purchase_line(jsonb_build_object('item_id',source.id,'unit_id',unit,'quantity',2),company);
   if (resolved->>'conversion_to_base')::numeric<>1 then raise exception 'pool base unit was multiplied twice';end if;
  end if;
 end loop;
 if has_function_privilege('authenticated','boy_central_private.resolve_direct_purchase_line(jsonb,uuid)','execute') then raise exception 'private resolver exposed';end if;
end $test$;
select 'All five branches: direct/pool/non-stock, immediate/delivery, web/POS receive, conversions, source identity and retry assertions passed' result;
