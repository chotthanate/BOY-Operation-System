-- Execute in a transaction with the migration, then ROLLBACK.
do $$
declare company uuid; branch uuid; item uuid; unit uuid; device uuid; txn uuid; txnline uuid; receipt uuid; receiptline uuid;
 token text:=gen_random_uuid()::text; body jsonb; result jsonb; owner uuid; initial_qty numeric;
begin
 select id,company_id into branch,company from boy_central.branches where code='GRILL';
 select user_id into owner from boy_central.profiles where company_id=company and active and company_role='admin' limit 1;
 select i.id,i.base_unit_id into item,unit from boy_central.items i join boy_central.branch_items bi on bi.item_id=i.id where bi.branch_id=branch and bi.active and i.active order by i.id limit 1;
 select coalesce(sum(quantity_on_hand),0) into initial_qty from boy_central.inventory_balances where branch_id=branch and item_id=item;
 insert into boy_central.pos_devices(company_id,branch_id,device_code,device_name,status,access_token_hash)
 values(company,branch,'QA-'||gen_random_uuid(),'Rollback shared test','active',encode(extensions.digest(token,'sha256'),'hex')) returning id into device;
 insert into boy_central.transactions(company_id,branch_id,transaction_no,transaction_type,transaction_date,total_amount,source_system,idempotency_key)
 values(company,branch,'QA-'||gen_random_uuid(),'expense',current_date,10,'grill_receipt_qa',gen_random_uuid()::text) returning id into txn;
 insert into boy_central.transaction_lines(company_id,transaction_id,line_no,item_id,description,quantity,unit_id,base_quantity,line_total)
 values(company,txn,1,item,'QA rollback',3,unit,3,10) returning id into txnline;
 insert into boy_central.purchase_receipts(company_id,branch_id,transaction_id) values(company,branch,txn) returning id into receipt;
 insert into boy_central.purchase_receipt_lines(company_id,branch_id,receipt_id,transaction_line_id,item_id,unit_id,quantity_expected,unit_cost_base,line_value)
 values(company,branch,receipt,txnline,item,unit,3,3.333333,10) returning id into receiptline;
 body:=jsonb_build_object('receipt_id',receipt,'request_id',gen_random_uuid(),'lines',jsonb_build_array(jsonb_build_object('line_id',receiptline,'quantity',1,'expected_received',0)));
 perform set_config('request.jwt.claim.sub','',true);
 begin
   perform boy_central.receive_purchase_receipt_lines(body);raise exception 'anon allowed';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',owner::text,true);
 result:=boy_central.receive_purchase_receipt_lines(body);
 if result->>'status'<>'partial' then raise exception 'web partial failed'; end if;
 if boy_central.receive_purchase_receipt_lines(body)->>'status'<>'duplicate' then raise exception 'web retry failed'; end if;
 if not exists(select 1 from jsonb_array_elements(public.grill_purchase_receipts(token)) r where r->>'receipt_id'=receipt::text and r#>>'{lines,0,quantity_received}'='1.000000') then
   -- Numeric JSON representation may omit trailing zeros.
   if not exists(select 1 from jsonb_array_elements(public.grill_purchase_receipts(token)) r where r->>'receipt_id'=receipt::text and (r#>>'{lines,0,quantity_received}')::numeric=1) then raise exception 'POS did not see web receipt'; end if;
 end if;
 result:=public.grill_receive_purchase(token,body||jsonb_build_object('request_id',gen_random_uuid(),'lines',jsonb_build_array(jsonb_build_object('line_id',receiptline,'quantity',2,'expected_received',1))));
 if result->>'status'<>'received' then raise exception 'POS completion failed'; end if;
 if (select sum(movement_value) from boy_central.stock_movements where transaction_id=txn)<>10 then raise exception 'rounding failed'; end if;
 if (select coalesce(sum(quantity_on_hand),0) from boy_central.inventory_balances where branch_id=branch and item_id=item)-initial_qty<>3 then raise exception 'stock failed'; end if;
 if not exists(select 1 from jsonb_array_elements(boy_central.get_branch_pending_receipts('GRILL')) r where r->>'receipt_id'=receipt::text and r->>'status'='received' and jsonb_array_length(r->'checks')=2) then raise exception 'web history missing'; end if;
end $$;
