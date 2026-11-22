-- All fixtures, postings and inventory changes must be rolled back.
do $test$
declare actor uuid;company uuid;branch uuid;category uuid;unit uuid;item uuid;location uuid;
 first jsonb;body jsonb;payload jsonb;result jsonb;document uuid;prior_ids uuid[];version integer;
begin
 select user_id,company_id into actor,company from boy_central.profiles where active and company_role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select id into branch from boy_central.branches where code='TAWANA';
 select id into category from boy_central.categories where company_id=company and category_type='item' and parent_id is null and active and code='CAT-001';
 select id into unit from boy_central.units where company_id=company and active limit 1;
 insert into boy_central.items(company_id,code,name,item_type,base_unit_id,category_id,track_stock,purchaseable)
 values(company,'QA-'||gen_random_uuid(),'Rollback received daily append','STOCK_ITEM',unit,category,true,true) returning id into item;
 insert into boy_central.inventory_locations(company_id,branch_id,code,name) values(company,branch,'QA-'||gen_random_uuid(),'Rollback daily append') returning id into location;
 insert into boy_central.branch_items(company_id,branch_id,item_id,default_location_id) values(company,branch,item,location);
 insert into boy_central.item_units(company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase) values(company,item,unit,1,true,true);
 first:=jsonb_build_object('i','QA old immediate','item_id',item,'category_id',category,'unit_id',unit,'q','2','p','20','pay','cash','receiving_mode','immediate','t','');
 body:=jsonb_build_object('cash',jsonb_build_object('v',100),'exp',jsonb_build_array(first,
  first||jsonb_build_object('i','QA old delivery','q',3,'p',30,'receiving_mode','delivery')));
 payload:=jsonb_build_object('branch_code','TAWANA','business_date','2099-04-12','request_id',gen_random_uuid(),'expected_revision',0,'data',body);
 result:=boy_central.post_daily_document(payload);document:=(result->>'document_id')::uuid;
 select transaction_ids into prior_ids from boy_central.daily_documents where id=document;
 -- Reordering, adding category display labels and numeric formatting do not buy again.
 body:=jsonb_set(body,'{exp}',jsonb_build_array(body#>'{exp,1}',first||jsonb_build_object('t','ผลไม้','q','2.00','p','20.00')));
 payload:=payload||jsonb_build_object('request_id',gen_random_uuid(),'expected_revision',1,'data',body);
 result:=boy_central.post_daily_document(payload);
 if (select transaction_ids from boy_central.daily_documents where id=document) is distinct from prior_ids then raise exception 'Metadata change reposted purchases';end if;
 if (select quantity_on_hand from boy_central.inventory_balances where item_id=item and location_id=location)<>2 then raise exception 'Metadata changed stock';end if;
 -- Add new received purchase and new reimbursement without changing old receipts.
 body:=jsonb_set(body,'{exp}',body->'exp'||jsonb_build_array(first||jsonb_build_object('i','QA new purchase','q',4,'p',40),
  jsonb_build_object('i','QA reimbursement','category_id',category,'p',15,'pay','reimbursement_pending','receiving_mode','immediate')));
 payload:=payload||jsonb_build_object('request_id',gen_random_uuid(),'expected_revision',2,'data',body);
 result:=boy_central.post_daily_document(payload);
 if not prior_ids <@ (select transaction_ids from boy_central.daily_documents where id=document) then raise exception 'Old transaction IDs lost';end if;
 if exists(select 1 from boy_central.transactions where id=any(prior_ids) and status<>'confirmed') then raise exception 'Old purchase was voided';end if;
 if (select quantity_on_hand from boy_central.inventory_balances where item_id=item and location_id=location)<>6 then raise exception 'Append did not receive only delta';end if;
 if not exists(select 1 from boy_central.purchase_receipts where transaction_id=any(prior_ids) and status='pending') then raise exception 'Pending old receipt cancelled';end if;
 if (select sum(total_amount) from boy_central.transactions where id=any((select transaction_ids from boy_central.daily_documents where id=document)::uuid[]) and status='confirmed')<>105 then raise exception 'Expense totals duplicated or missing';end if;
 result:=boy_central.post_daily_document(payload);
 if not(result->>'duplicate')::boolean then raise exception 'Retry not deduplicated';end if;
 if (select quantity_on_hand from boy_central.inventory_balances where item_id=item and location_id=location)<>6 then raise exception 'Retry doubled stock';end if;
 -- Removing/altering posted rows must still fail, without any partial posting.
 for version in 1..2 loop
  begin
   perform boy_central.post_daily_document(payload||jsonb_build_object('request_id',gen_random_uuid(),'expected_revision',3,'data',
    case version when 1 then jsonb_set(body,'{exp,1,q}','9') else jsonb_set(body,'{exp}',(body->'exp')-1) end));
   raise exception 'Received edit accepted';
  exception when others then if sqlerrm not like 'รายการ % รับสินค้าแล้ว%' then raise;end if;end;
 end loop;
 -- A genuinely identical additional purchase is not mistaken for a retry.
 body:=jsonb_set(body,'{exp}',body->'exp'||jsonb_build_array(first));
 result:=boy_central.post_daily_document(payload||jsonb_build_object('request_id',gen_random_uuid(),'expected_revision',3,'data',body));
 if (select quantity_on_hand from boy_central.inventory_balances where item_id=item and location_id=location)<>8 then raise exception 'Identical new purchase was dropped';end if;
end $test$;
select 'Received append, metadata/reorder, totals, reimbursements, retries, duplicate lines and edit guards passed' result;
