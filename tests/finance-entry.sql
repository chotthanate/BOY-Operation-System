-- Run after the migration inside BEGIN/ROLLBACK. All fixtures are rolled back.
do $test$
declare actor uuid;company uuid;b record;category uuid;subcategory uuid;unit uuid;item uuid;location uuid;payload jsonb;result jsonb;workspace jsonb;
 request uuid;rev integer;tid uuid;body jsonb;income jsonb;denied boolean;ids uuid[];before_count integer;receipt uuid;receipt_line uuid;token text;
begin
 select user_id,company_id into actor,company from boy_central.profiles where active and company_role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select id into category from boy_central.categories where company_id=company and parent_id is null and category_type='item' and code~'^CAT-[0-9]+$' and active limit 1;
 select c.id,c.parent_id into subcategory,category from boy_central.categories c join boy_central.categories p on p.id=c.parent_id where c.company_id=company and c.active and p.active and c.category_type='item' limit 1;
 select id into unit from boy_central.units where company_id=company and active limit 1;
 for b in select id,code from boy_central.branches where code in('TAWANA','BURGER','GRILL','BIGC-CENTRAL-PATTAYA','BIGC-SOUTH-PATTAYA') loop
  workspace:=boy_central.get_finance_entry_workspace(b.code);rev:=(workspace->>'revision')::integer;
  result:=boy_central.save_finance_entry_draft(jsonb_build_object('branch_code',b.code,'expected_revision',rev,'data',jsonb_build_object('date','2099-06-01','lines','[]'::jsonb)));
  rev:=(result->>'revision')::integer;
  begin
   perform boy_central.save_finance_entry_draft(jsonb_build_object('branch_code',b.code,'expected_revision',rev-1,'data','{}'::jsonb));
   raise exception 'stale draft accepted';
  exception when others then if sqlerrm not like 'ร่างถูกแก้%' then raise;end if;end;
  request:=gen_random_uuid();
  payload:=jsonb_build_object('branch_code',b.code,'date','2099-06-01','request_id',request,'expected_revision',rev,
   'lines',jsonb_build_array(jsonb_build_object('description','Rollback batch one','category_id',category,'subcategory_id',subcategory,'line_total',100,'payment_method','reimbursement_pending','receiving_mode','immediate')));
  result:=boy_central.record_finance_expenses(payload);tid:=(result#>>'{transaction_ids,0}')::uuid;
  if tid is null or (select total_amount from boy_central.transactions where id=tid)<>100 then raise exception 'expense missing for %',b.code;end if;
  if not exists(select 1 from boy_central.transaction_lines where transaction_id=tid and category_id=category and subcategory_id=subcategory) then raise exception 'subcategory was not stored';end if;
  if not exists(select 1 from boy_central.mirror_jobs where entity_id=tid and entity_type='transaction') then raise exception 'expense copy not queued';end if;
  rev:=(result->>'draft_revision')::integer;
  begin
   perform boy_central.record_finance_expenses(jsonb_set(payload||jsonb_build_object('request_id',gen_random_uuid(),'expected_revision',rev),'{lines,0,subcategory_id}',to_jsonb(category)));
   raise exception 'unrelated subcategory accepted';
  exception when others then if sqlerrm not like 'ประเภทย่อยไม่ตรง%' then raise;end if;end;
  result:=boy_central.record_finance_expenses(payload);
  if result->>'duplicate'<>'true' then raise exception 'request retry not deduplicated';end if;
  begin
   perform boy_central.record_finance_expenses(jsonb_set(payload,'{lines,0,line_total}','200'));
   raise exception 'changed duplicate accepted';
  exception when others then if sqlerrm not like 'รหัสคำขอซ้ำ%' then raise;end if;end;
  payload:=payload||jsonb_build_object('request_id',gen_random_uuid(),'expected_revision',rev);
  result:=boy_central.record_finance_expenses(payload);
  if (select count(*) from boy_central.transactions where branch_id=b.id and transaction_date='2099-06-01' and status='confirmed' and transaction_type='expense')<>2 then raise exception 'second batch replaced first';end if;
  if jsonb_array_length(boy_central.get_branch_finance_day(b.code,'2099-06-01')->'expenses')<>2 then raise exception 'history mismatch';end if;
  rev:=(result->>'draft_revision')::integer;
  select count(*) into before_count from boy_central.transactions;
  begin
   perform boy_central.record_finance_expenses(payload||jsonb_build_object('request_id',gen_random_uuid(),'expected_revision',rev,'lines',jsonb_build_array(
    jsonb_build_object('description','valid first group','category_id',category,'line_total',10,'payment_method','cash'),
    jsonb_build_object('description','bad second group','category_id',category,'line_total',20,'payment_method','invalid'))));
   raise exception 'invalid group accepted';
  exception when others then if sqlerrm not like 'เลือกช่องทาง%' then raise;end if;end;
  if (select count(*) from boy_central.transactions)<>before_count then raise exception 'group not atomic';end if;
  income:=jsonb_build_object('branch_code',b.code,'date','2099-06-01','request_id',gen_random_uuid(),'cash',500,'transfer',0,'expected_revision',0);
  if b.code in('TAWANA','BIGC-CENTRAL-PATTAYA') then
   result:=boy_central.save_branch_manual_income(income);
   if not exists(select 1 from boy_central.mirror_jobs where entity_id=(result#>>'{income,id}')::uuid and entity_type='financial_close') then raise exception 'income copy not queued';end if;
   if result#>>'{income,cash}'<>'500.00' then raise exception 'income not saved';end if;
   if boy_central.save_branch_manual_income(income)->>'duplicate'<>'true' then raise exception 'income retry duplicate';end if;
   begin perform boy_central.save_branch_manual_income(income||jsonb_build_object('request_id',gen_random_uuid(),'cash',600));
    raise exception 'stale income accepted';
   exception when others then if sqlerrm not like 'รายรับถูกแก้%' then raise;end if;end;
   result:=boy_central.save_branch_manual_income(income||jsonb_build_object('request_id',gen_random_uuid(),'expected_revision',(result#>>'{income,revision}')::integer,'cash',600));
   if (boy_central.get_branch_finance_day(b.code,'2099-06-01')#>>'{income,cash}')::numeric<>600 then raise exception 'income edit not visible';end if;
   if jsonb_array_length(boy_central.get_branch_finance_day(b.code,'2099-06-01')->'expenses')<>2 then raise exception 'income edit touched expenses';end if;
   if (boy_central.get_branch_dashboard(b.code,'2099-06-01','2099-06-01')#>>'{totals,expenses}')::numeric<>200 then raise exception 'dashboard expense mismatch';end if;
  else
   begin perform boy_central.save_branch_manual_income(income);raise exception 'POS branch manual income accepted';
   exception when others then if sqlerrm not like 'สาขานี้ใช้รายรับ%' then raise;end if;end;
  end if;
 end loop;
 select id,code into b from boy_central.branches where code='GRILL';
 insert into boy_central.items(company_id,code,name,item_type,base_unit_id,category_id,track_stock,purchaseable)
 select company,'QA-'||gen_random_uuid(),'Rollback common entry stock',item_type,unit,category,true,true from boy_central.items where company_id=company limit 1 returning id into item;
 insert into boy_central.inventory_locations(company_id,branch_id,code,name) values(company,b.id,'QA-'||gen_random_uuid(),'Rollback common entry location') returning id into location;
 insert into boy_central.branch_items(company_id,branch_id,item_id,default_location_id) values(company,b.id,item,location);
 insert into boy_central.item_units(company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase) values(company,item,unit,1,true,true);
 workspace:=boy_central.get_finance_entry_workspace(b.code);
 payload:=jsonb_build_object('branch_code',b.code,'date','2099-06-02','request_id',gen_random_uuid(),'expected_revision',workspace->'revision','lines',jsonb_build_array(
  jsonb_build_object('description','Immediate','item_id',item,'category_id',category,'unit_id',unit,'quantity',2,'line_total',20,'receiving_mode','immediate'),
  jsonb_build_object('description','Delivery','item_id',item,'category_id',category,'unit_id',unit,'quantity',3,'line_total',30,'receiving_mode','delivery')));
 result:=boy_central.record_finance_expenses(payload);
 if (select quantity_on_hand from boy_central.inventory_balances where location_id=location and item_id=item)<>2 then raise exception 'pending purchase changed stock';end if;
 if (select count(*) from boy_central.purchase_receipts r join boy_central.transactions t on t.id=r.transaction_id where t.branch_id=b.id and t.transaction_date='2099-06-02' and r.status='pending')<>1 then raise exception 'delivery missing pending receipts';end if;
 perform boy_central.record_finance_expenses(payload);
 if (select quantity_on_hand from boy_central.inventory_balances where location_id=location and item_id=item)<>2 then raise exception 'stock doubled on retry';end if;
 select r.id into receipt from boy_central.purchase_receipts r join boy_central.transactions t on t.id=r.transaction_id where t.branch_id=b.id and t.transaction_date='2099-06-02' and r.status='pending';
 select id into receipt_line from boy_central.purchase_receipt_lines where receipt_id=receipt;
 token:=gen_random_uuid()::text;
 insert into boy_central.pos_devices(company_id,branch_id,device_code,device_name,status,access_token_hash)
  values(company,b.id,'QA-'||gen_random_uuid(),'Rollback common entry device','active',encode(extensions.digest(token,'sha256'),'hex'));
 if not exists(select 1 from jsonb_array_elements(public.grill_purchase_receipts(token))x where x->>'receipt_id'=receipt::text) then raise exception 'new entry missing in GRILL POS';end if;
 result:=public.grill_receive_purchase(token,jsonb_build_object('receipt_id',receipt,'request_id',gen_random_uuid(),'lines',jsonb_build_array(jsonb_build_object('line_id',receipt_line,'quantity',3,'expected_received',0))));
 if result->>'status'<>'received' or (select quantity_on_hand from boy_central.inventory_balances where location_id=location and item_id=item)<>5 then raise exception 'POS receipt did not complete stock';end if;
 if not exists(select 1 from jsonb_array_elements(boy_central.get_branch_pending_receipts('GRILL'))x where x->>'receipt_id'=receipt::text and x->>'status'='received') then raise exception 'web receipt status not shared';end if;
 workspace:=boy_central.get_finance_entry_workspace('GRILL');
 result:=boy_central.record_finance_expenses(jsonb_build_object('branch_code','GRILL','date','2099-06-03','request_id',gen_random_uuid(),'expected_revision',workspace->'revision',
  'lines',jsonb_build_array(jsonb_build_object('description','Capital with old product category','expense_class','capital','project_name','Rollback project','investment_category','construction','category_id',category,'subcategory_id',subcategory,'line_total',10))));
 if exists(select 1 from boy_central.transaction_lines where transaction_id=(result#>>'{transaction_ids,0}')::uuid and subcategory_id is not null) then raise exception 'capital retained unrelated subcategory';end if;
 -- Legacy full-day form cannot replace an income entry saved independently.
 body:=jsonb_build_object('cash',jsonb_build_object('v',1),'transfer',jsonb_build_object('v',0),'other',jsonb_build_object('v',0),'exp','[]'::jsonb);
 perform boy_central.post_daily_document(jsonb_build_object('branch_code','TAWANA','business_date','2099-06-01','request_id',gen_random_uuid(),'expected_revision',0,'data',body));
 if (boy_central.get_branch_finance_day('TAWANA','2099-06-01')#>>'{income,cash}')::numeric<>600 then raise exception 'legacy form overwrote independent income';end if;
 if has_function_privilege('anon','boy_central.record_finance_expenses(jsonb)','execute') or has_table_privilege('authenticated','boy_central.expense_entry_drafts','update') then raise exception 'unexpected direct write access';end if;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform boy_central.get_finance_entry_workspace('TAWANA');raise exception 'anonymous workspace accepted';
 exception when others then if sqlerrm not like 'ไม่มีสิทธิ์%' then raise;end if;end;
end $test$;
select 'Five branches: append-only batches, separate income, revision conflicts, retry dedup, atomic groups, delivery/stock and auth passed' as result;
