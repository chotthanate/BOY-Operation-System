-- Run BEGIN/ROLLBACK. No purchases, receipts, devices or balances remain.
do $test$
declare branch record;owner uuid;category uuid;unit uuid;tracked uuid;untracked uuid;location uuid;
 token text;result jsonb;payload jsonb;receipt uuid;line1 uuid;line2 uuid;response jsonb;listing jsonb;transaction uuid;
begin
 for branch in select * from boy_central.branches where code in('GRILL','BURGER') loop
  select user_id into owner from boy_central.profiles where company_id=branch.company_id and company_role='admin' and active limit 1;
  perform set_config('request.jwt.claim.sub',owner::text,true);
  select id into category from boy_central.categories where company_id=branch.company_id and category_type='item' and active limit 1;
  select id into unit from boy_central.units where company_id=branch.company_id and active limit 1;
  insert into boy_central.items(company_id,code,name,category_id,base_unit_id,track_stock,purchaseable)
  values(branch.company_id,'QA-'||gen_random_uuid(),'QA tracked '||branch.code,category,unit,true,true) returning id into tracked;
  insert into boy_central.items(company_id,code,name,category_id,base_unit_id,track_stock,purchaseable)
  values(branch.company_id,'QA-'||gen_random_uuid(),'QA untracked '||branch.code,category,unit,false,true) returning id into untracked;
  insert into boy_central.inventory_locations(company_id,branch_id,code,name) values(branch.company_id,branch.id,'QA-'||gen_random_uuid(),'QA delivery location') returning id into location;
  insert into boy_central.branch_items(company_id,branch_id,item_id,default_location_id) values(branch.company_id,branch.id,tracked,location),(branch.company_id,branch.id,untracked,location);
  insert into boy_central.item_units(company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase) values(branch.company_id,tracked,unit,1,true,true),(branch.company_id,untracked,unit,1,true,true);
  payload:=jsonb_build_object('branch_id',branch.id,'transaction_date',current_date,'idempotency_key',gen_random_uuid(),'receiving_mode','delivery','source_system','qa_rollback',
   'payment',jsonb_build_object('method','cash','amount',50),'lines',jsonb_build_array(
   jsonb_build_object('item_id',tracked,'category_id',category,'description','QA tracked','quantity',3,'unit_id',unit,'line_total',30),
   jsonb_build_object('item_id',untracked,'category_id',category,'description','QA untracked','quantity',2,'unit_id',unit,'line_total',20)));
  result:=boy_central.record_expense_v4(payload);receipt:=(result->>'pending_receipt_id')::uuid;transaction:=(result->>'transaction_id')::uuid;
  if receipt is null or (select count(*) from boy_central.purchase_receipt_lines where receipt_id=receipt)<>2 then raise exception 'delivery lines missing: %',branch.code;end if;
  if exists(select 1 from boy_central.stock_movements where transaction_id=transaction) then raise exception 'delivery entered stock before receipt';end if;
  select id into line1 from boy_central.purchase_receipt_lines where receipt_id=receipt and item_id=tracked;
  select id into line2 from boy_central.purchase_receipt_lines where receipt_id=receipt and item_id=untracked;
  token:=gen_random_uuid()::text;
  insert into boy_central.pos_devices(company_id,branch_id,device_code,device_name,status,access_token_hash)
   values(branch.company_id,branch.id,'QA-'||gen_random_uuid(),'QA delivery device','active',encode(extensions.digest(token,'sha256'),'hex'));
  if branch.code='GRILL' then listing:=public.grill_purchase_receipts(token);else listing:=public.burger_purchase_receipts(token);end if;
  if not exists(select 1 from jsonb_array_elements(listing)x where x->>'receipt_id'=receipt::text) then raise exception 'POS did not see web purchase: %',branch.code;end if;
  payload:=jsonb_build_object('receipt_id',receipt,'request_id',gen_random_uuid(),'lines',jsonb_build_array(jsonb_build_object('line_id',line1,'quantity',3,'expected_received',0),jsonb_build_object('line_id',line2,'quantity',2,'expected_received',0)));
  if branch.code='GRILL' then response:=public.grill_receive_purchase(token,payload);else response:=public.burger_receive_purchase(token,payload);end if;
  if response->>'status'<>'received' then raise exception 'POS receipt failed';end if;
  if exists(select 1 from boy_central.inventory_balances where item_id=untracked) or exists(select 1 from boy_central.stock_movements where item_id=untracked) then raise exception 'non-stock receipt affected stock';end if;
  if (select sum(quantity_delta) from boy_central.stock_movements where item_id=tracked)<>3 then raise exception 'tracked receipt quantity wrong';end if;
  if branch.code='GRILL' then response:=public.grill_receive_purchase(token,payload);else response:=public.burger_receive_purchase(token,payload);end if;
  if response->>'status'<>'duplicate' then raise exception 'receipt retry not idempotent';end if;
  if not exists(select 1 from jsonb_array_elements(boy_central.get_branch_pending_receipts(branch.code))x where x->>'receipt_id'=receipt::text and x->>'status'='received') then raise exception 'web did not see POS completion';end if;
  result:=boy_central.record_expense_v4(jsonb_build_object('branch_id',branch.id,'transaction_date',current_date,'idempotency_key',gen_random_uuid(),'receiving_mode','delivery','source_system','qa_rollback',
   'payment',jsonb_build_object('method','cash','amount',10),'lines',jsonb_build_array(jsonb_build_object('item_id',untracked,'category_id',category,'description','QA nonstock whole receipt','quantity',1,'unit_id',unit,'line_total',10))));
  receipt:=(result->>'pending_receipt_id')::uuid;
  if not exists(select 1 from jsonb_array_elements(public.pos_pending_receipts(token))x where x->>'receipt_id'=receipt::text) then raise exception 'generic POS did not see non-stock delivery';end if;
  response:=public.pos_receive_purchase_receipt(token,receipt);
  if response->>'status'<>'received' then raise exception 'whole POS receipt failed';end if;
  if exists(select 1 from boy_central.inventory_balances where item_id=untracked) or exists(select 1 from boy_central.stock_movements where item_id=untracked) then raise exception 'whole non-stock receipt affected stock';end if;
 end loop;
end $test$;
select 'web delivery to GRILL/BURGER POS, non-stock goods, tracked balances, duplicate and cross-client completion passed' result;
