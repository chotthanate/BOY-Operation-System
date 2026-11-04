-- Run inside BEGIN/ROLLBACK. No test business records should be retained.
do $test$
declare actor uuid; south uuid; central uuid; result jsonb; order_id uuid;
  old_central integer; source_id uuid; denied boolean:=false; expense_payload jsonb; expense_id uuid; expense_key uuid:=gen_random_uuid(); category_uuid uuid; receipt_payload jsonb;
begin
  select user_id into actor from boy_central.profiles where active and company_role='admin' limit 1;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  select id into south from boy_central.branches where code='BIGC-SOUTH-PATTAYA';
  select id into central from boy_central.branches where code='BIGC-CENTRAL-PATTAYA';
  if south is null or south=central then raise exception 'separate branch required'; end if;
  select count(*) into old_central from boy_central.bigc_workflows where branch_id=central;
  result:=boy_central.bigc_branch_request('BIGC-SOUTH-PATTAYA','get_bigc_v2_context',jsonb_build_object('target_date','2099-01-02'));
  if result#>>'{branch,code}'<>'BIGC-SOUTH-PATTAYA' then raise exception 'context leaked across branches'; end if;
  perform boy_central.bigc_branch_request('BIGC-SOUTH-PATTAYA','save_bigc_v2_draft',jsonb_build_object('payload',jsonb_build_object('business_date','2099-01-02','order',jsonb_build_object('qa',2))));
  if not exists(select 1 from boy_central.bigc_workflow_drafts where branch_id=south and business_date='2099-01-02' and user_id=actor) then raise exception 'south draft missing'; end if;
  result:=boy_central.bigc_branch_request('BIGC-SOUTH-PATTAYA','append_bigc_v2_order',jsonb_build_object('payload',jsonb_build_object(
    'business_date','2099-01-02','workflow_type','close_order','submission_id',gen_random_uuid(),
    'lines',jsonb_build_array(jsonb_build_object('line_key','qa-south','item_name','ทดสอบแยกสาขา','quantity',2,'unit_name','ถุง','input_mode','quantity')))));
  order_id:=(result->>'workflow_id')::uuid;
  if not exists(select 1 from boy_central.bigc_workflows where id=order_id and branch_id=south) then raise exception 'order in wrong branch'; end if;
  if result#>>'{mirror_payload,branch_code}'<>'BIGC-SOUTH-PATTAYA' then raise exception 'mirror missing branch scope'; end if;
  receipt_payload:=jsonb_build_object('business_date','2099-01-03','workflow_type','receive','source_workflow_id',order_id,
    'lines',jsonb_build_array(jsonb_build_object('line_key','receipt-'||gen_random_uuid(),'source_line_key','qa-south',
      'item_name','ทดสอบแยกสาขา','quantity',2,'unit_name','ถุง','input_mode','quantity','received',true)));
  result:=boy_central.bigc_branch_request('BIGC-SOUTH-PATTAYA','append_bigc_v2_receive',jsonb_build_object('payload',receipt_payload));
  if not exists(select 1 from boy_central.bigc_workflows where id=(result->>'workflow_id')::uuid and branch_id=south and workflow_type='receive') then raise exception 'receipt in wrong branch'; end if;
  result:=boy_central.bigc_branch_request('BIGC-SOUTH-PATTAYA','append_bigc_v2_receive',jsonb_build_object('payload',receipt_payload));
  if not coalesce((result->>'duplicate')::boolean,false) then raise exception 'receipt retry duplicated'; end if;
  perform boy_central.bigc_branch_request('BIGC-SOUTH-PATTAYA','save_bigc_v2_workflow',jsonb_build_object('payload',jsonb_build_object('business_date','2099-01-02','workflow_type','return','cash_amount',120,'lines','[]'::jsonb)));
  if (boy_central.get_branch_dashboard('BIGC-SOUTH-PATTAYA','2099-01-02','2099-01-02')#>>'{totals,revenue}')::numeric<>120 then raise exception 'branch revenue missing'; end if;
  if (boy_central.get_dashboard_monthly(2099,1)#>>'{summary,income}')::numeric<>120 then raise exception 'monthly revenue missing'; end if;
  if not exists(select 1 from jsonb_array_elements(boy_central.get_dashboard_daily('2099-01-02')->'branches') x where x->>'code'='BIGC-SOUTH-PATTAYA' and (x->>'income')::numeric=120) then raise exception 'daily revenue missing'; end if;
  if (select count(*) from boy_central.bigc_workflows where branch_id=central)<>old_central then raise exception 'central history changed'; end if;
  if exists(select 1 from boy_central.inventory_balances where branch_id=south) then raise exception 'opening stock was copied'; end if;
  if boy_central_private.current_bigc_branch_code()<>'BIGC-CENTRAL-PATTAYA' then raise exception 'request branch scope was not restored'; end if;
  select id into source_id from boy_central.bigc_workflows where branch_id=central limit 1;
  if source_id is not null then
    begin
      perform boy_central.bigc_branch_request('BIGC-SOUTH-PATTAYA','save_bigc_v2_workflow',jsonb_build_object('payload',jsonb_build_object('source_workflow_id',source_id)));
    exception when others then denied:=sqlerrm='source workflow belongs to another branch'; end;
    if not denied then raise exception 'cross-branch workflow was accepted'; end if;
  end if;
  if (boy_central.get_bigc_v2_context('2099-01-02')->'branch'->>'code')<>'BIGC-CENTRAL-PATTAYA' then raise exception 'legacy client changed branch'; end if;
  select c.id into category_uuid from boy_central.categories c join boy_central.branches b on b.company_id=c.company_id
    where b.id=south and c.active and c.category_type='item' and c.parent_id is null and c.code ~ '^CAT-[0-9]+$' limit 1;
  expense_payload:=jsonb_build_object('branch_id',south,'transaction_date','2099-01-02','source_system','boy_bigc_south_web',
    'idempotency_key',expense_key,'payment',jsonb_build_object('method','cash','amount',12),
    'lines',jsonb_build_array(jsonb_build_object('category_id',category_uuid,'description','ทดสอบรายจ่ายสาขาใต้','quantity',0,'line_total',12)));
  result:=boy_central.record_expense_v3(expense_payload); expense_id:=(result->>'transaction_id')::uuid;
  if not exists(select 1 from boy_central.transactions where id=expense_id and branch_id=south and total_amount=12) then raise exception 'expense not saved in South'; end if;
  result:=boy_central.record_expense_v3(expense_payload);
  if result->>'status'<>'duplicate' then raise exception 'expense retry not idempotent'; end if;
  if (boy_central.get_branch_dashboard('BIGC-SOUTH-PATTAYA','2099-01-02','2099-01-02')#>>'{totals,net}')::numeric<>108 then raise exception 'expense/revenue dashboard does not reconcile'; end if;
end $test$;
