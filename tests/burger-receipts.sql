-- All fixtures and stock effects are rolled back by the caught subtransaction exception.
do $test$
declare company uuid; branch uuid; item uuid; unit uuid;
  device uuid; txn uuid; txnline uuid; receipt uuid; receiptline uuid; token text:=gen_random_uuid()::text;
  request1 uuid:=gen_random_uuid(); request2 uuid:=gen_random_uuid(); body jsonb; result jsonb;
  denied boolean; initial_qty numeric; final_qty numeric; passed boolean:=false;
begin
  begin
    select id,company_id into branch,company from boy_central.branches where code='BURGER' and active;
    select i.id,i.base_unit_id into item,unit from boy_central.items i join boy_central.branch_items bi on bi.item_id=i.id
      where bi.branch_id=branch and bi.active and i.active order by i.id limit 1;
    select coalesce(sum(quantity_on_hand),0) into initial_qty from boy_central.inventory_balances where branch_id=branch and item_id=item;
    insert into boy_central.pos_devices(company_id,branch_id,device_code,device_name,status,access_token_hash)
      values(company,branch,'QA-'||gen_random_uuid(),'Temporary rollback test','active',encode(extensions.digest(token,'sha256'),'hex')) returning id into device;
    insert into boy_central.transactions(company_id,branch_id,transaction_no,transaction_type,transaction_date,total_amount,source_system,idempotency_key)
      values(company,branch,'QA-'||gen_random_uuid(),'expense',current_date,10,'burger_receipt_qa',gen_random_uuid()::text) returning id into txn;
    insert into boy_central.transaction_lines(company_id,transaction_id,line_no,item_id,description,quantity,unit_id,base_quantity,line_total)
      values(company,txn,1,item,'Rollback QA',3,unit,3,10) returning id into txnline;
    insert into boy_central.purchase_receipts(company_id,branch_id,transaction_id) values(company,branch,txn) returning id into receipt;
    insert into boy_central.purchase_receipt_lines(company_id,branch_id,receipt_id,transaction_line_id,item_id,unit_id,quantity_expected,unit_cost_base,line_value)
      values(company,branch,receipt,txnline,item,unit,3,3.333333,10) returning id into receiptline;
    body:=jsonb_build_object('receipt_id',receipt,'request_id',request1,'lines',jsonb_build_array(jsonb_build_object('line_id',receiptline,'quantity',1,'expected_received',0)));
    result:=public.burger_receive_purchase(token,body);
    if result->>'status'<>'partial' then raise exception 'partial test failed'; end if;
    result:=public.burger_receive_purchase(token,body);
    if result->>'status'<>'duplicate' then raise exception 'retry test failed'; end if;
    if (select quantity_received from boy_central.purchase_receipt_lines where id=receiptline)<>1 then raise exception 'retry added stock twice'; end if;
    denied:=false;
    begin perform public.burger_receive_purchase(token,jsonb_set(body,'{lines,0,quantity}','2')); exception when others then denied:=true; end;
    if not denied then raise exception 'changed idempotent request accepted'; end if;
    denied:=false;
    begin perform public.burger_receive_purchase(token,jsonb_set(body,'{request_id}',to_jsonb(gen_random_uuid()))); exception when others then denied:=true; end;
    if not denied then raise exception 'stale receipt accepted'; end if;
    denied:=false;
    begin perform boy_central_private.complete_purchase_receipt(receipt,company,branch,null,device,'qa'); exception when others then denied:=true; end;
    if not denied then raise exception 'legacy full receiver accepted partial receipt'; end if;
    denied:=false;
    begin perform public.burger_receive_purchase('invalid-token',body); exception when others then denied:=true; end;
    if not denied then raise exception 'invalid token accepted'; end if;
    denied:=false;
    begin perform public.burger_receive_purchase(token,jsonb_build_object('receipt_id',receipt,'request_id',gen_random_uuid(),'lines',jsonb_build_array(jsonb_build_object('line_id',receiptline,'quantity',3,'expected_received',1)))); exception when others then denied:=true; end;
    if not denied then raise exception 'over receipt accepted'; end if;
    result:=public.burger_receive_purchase(token,jsonb_build_object('receipt_id',receipt,'request_id',request2,'lines',jsonb_build_array(jsonb_build_object('line_id',receiptline,'quantity',2,'expected_received',1))));
    if result->>'status'<>'received' then raise exception 'completion failed'; end if;
    if (select sum(movement_value) from boy_central.stock_movements where transaction_id=txn)<>10 then raise exception 'cost rounding failed'; end if;
    select coalesce(sum(quantity_on_hand),0) into final_qty from boy_central.inventory_balances where branch_id=branch and item_id=item;
    if final_qty-initial_qty<>3 then raise exception 'stock quantity failed'; end if;
    if (select count(*) from boy_central.stock_movements where transaction_id=txn)<>2 then raise exception 'movement count failed'; end if;
    if not exists(select 1 from jsonb_array_elements(public.burger_purchase_receipts(token)) v where v->>'receipt_id'=receipt::text and v->>'status'='received') then raise exception 'history failed'; end if;
    raise exception using message='BURGER_RECEIPT_QA_PASSED',errcode='P0099';
  exception when sqlstate 'P0099' then passed:=true;
  end;
  if not passed then raise exception 'QA did not finish'; end if;
  raise notice 'PASS: partial, duplicate, conflict, legacy guard, invalid token, excess, completion, stock, rounding, history; fixtures rolled back';
end $test$;
