-- Post-migration read and isolated fixture assertions. All fixtures roll back.
begin;
do $test$
declare
  owner_id uuid;
  owner_company uuid;
  day date := (now() at time zone 'Asia/Bangkok')::date;
  dashboard jsonb;
  home jsonb;
  row_ jsonb;
  expected numeric;
  scratch_company uuid;
  scratch_tawana uuid;
  scratch_grill uuid;
  scratch_burger uuid;
  staff_actor uuid := gen_random_uuid();
  viewer_actor uuid := gen_random_uuid();
  special_actor uuid := gen_random_uuid();
  txn uuid;
  denied boolean;
begin
  if has_function_privilege('anon','public.get_operation_home()','execute')
     or has_function_privilege('anon','boy_central_private.get_operation_home()','execute')
     or not has_function_privilege('authenticated','public.get_operation_home()','execute')
     or (select prosecdef or provolatile <> 's' from pg_proc where oid='public.get_operation_home()'::regprocedure) then
    raise exception 'Home RPC must be stable, invoker, and authenticated only';
  end if;
  perform set_config('request.jwt.claims','{}',true);
  perform set_config('request.jwt.claim.sub','',true);
  denied := false;
  begin perform public.get_operation_home(); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'missing identity accepted'; end if;

  select p.user_id,p.company_id into owner_id,owner_company from boy_central.profiles p
  where p.active and p.company_role='admin' and exists (
    select 1 from boy_central.branches b where b.company_id=p.company_id and b.code='TAWANA' and b.active
  ) limit 1;
  if owner_id is not null then
    perform set_config('request.jwt.claim.sub',owner_id::text,true);
    home := public.get_operation_home();
    dashboard := boy_central.get_dashboard_daily(day);
    if (home->>'date')::date is distinct from day then raise exception 'incorrect Bangkok business day'; end if;
    select coalesce(sum((d->>'expense')::numeric),0) into expected from jsonb_array_elements(dashboard->'branches') d
    where d->>'code' in ('TAWANA','BIGC-CENTRAL-PATTAYA','BIGC-SOUTH-PATTAYA','BURGER','GRILL');
    if (home->>'total_expenses')::numeric is distinct from expected then raise exception 'operating expense reconciliation failed'; end if;
    for row_ in select value from jsonb_array_elements(home->'branches') loop
      if row_->>'sales_status'='recorded' then
        select (d->>'income')::numeric into expected from jsonb_array_elements(dashboard->'branches') d
        where d->>'code'=row_->>'code';
        if (row_->>'sales')::numeric is distinct from expected then raise exception 'sales reconciliation failed'; end if;
      elsif jsonb_typeof(row_->'sales') is distinct from 'null' then
        raise exception 'unrecorded sale must be null';
      end if;
      if (row_ - array['code','name','sales','sales_status','can_enter_expenses','draft_count','draft_date','receipts','reimbursements']) <> '{}'::jsonb then
        raise exception 'unexpected branch payload fields';
      end if;
    end loop;
  end if;

  insert into boy_central.companies(code,name) values ('QA-HOME-'||gen_random_uuid(),'Rollback Home fixtures') returning id into scratch_company;
  insert into boy_central.branches(company_id,code,name) values (scratch_company,'TAWANA','Test manual') returning id into scratch_tawana;
  insert into boy_central.branches(company_id,code,name) values (scratch_company,'GRILL','Test shift') returning id into scratch_grill;
  insert into boy_central.branches(company_id,code,name) values (scratch_company,'BURGER','Test legacy') returning id into scratch_burger;
  insert into auth.users(id,aud,role) values
    (staff_actor,'authenticated','authenticated'),(viewer_actor,'authenticated','authenticated'),(special_actor,'authenticated','authenticated');
  insert into boy_central.profiles(user_id,company_id,display_name,employee_code,company_role) values
    (staff_actor,scratch_company,'Test staff',null,'staff'),(viewer_actor,scratch_company,'Test viewer',null,'viewer'),
    (special_actor,scratch_company,'Test restricted','BIGC-SHARED-STAFF','admin');
  insert into boy_central.user_branch_roles(company_id,user_id,branch_id,role) values
    (scratch_company,staff_actor,scratch_tawana,'staff'),(scratch_company,staff_actor,scratch_burger,'staff'),
    (scratch_company,viewer_actor,scratch_tawana,'viewer');
  insert into boy_central.branch_revenue_policies(branch_id,mode,effective_date) values
    (scratch_tawana,'manual',day),(scratch_grill,'pos_shift',day),(scratch_burger,'pos_shift',day+1);
  insert into boy_central.expense_entry_drafts(branch_id,company_id,payload) values
    (scratch_tawana,scratch_company,jsonb_build_object('date',day-1,'lines',jsonb_build_array(
      '{"expanded":true,"description":" ","payment_method":"cash","receiving_mode":"immediate"}'::jsonb,
      '{"description":"PRIVATE-DRAFT-TEXT"}'::jsonb,'{"receiving_mode":"delivery"}'::jsonb))),
    (scratch_grill,scratch_company,jsonb_build_object('date',day,'lines','[{"description":"PRIVATE-DRAFT-TEXT"}]'::jsonb));

  insert into boy_central.transactions(company_id,branch_id,transaction_no,transaction_type,transaction_date,total_amount,
       source_system,idempotency_key,status,note) values
    (scratch_company,scratch_tawana,'T-1','expense',day,25,'QA_HOME','1','confirmed','PRIVATE-TXN-NOTE')
  returning id into txn;
  insert into boy_central.transaction_lines(company_id,transaction_id,line_no,description,line_total)
  values (scratch_company,txn,1,'PRIVATE-LINE-TEXT',25);
  insert into boy_central.payments(company_id,transaction_id,method,amount,status)
  values (scratch_company,txn,'reimbursement_pending',25,'pending');
  insert into boy_central.purchase_receipts(company_id,branch_id,transaction_id,status)
  values (scratch_company,scratch_tawana,txn,'pending');
  insert into boy_central.transactions(company_id,branch_id,transaction_no,transaction_type,transaction_date,total_amount,
       source_system,idempotency_key,status) values
    (scratch_company,scratch_grill,'T-2','expense',day,99,'QA_HOME','2','confirmed'),
    (scratch_company,scratch_tawana,'T-3','expense',day,300,'QA_HOME','3','voided');

  perform set_config('request.jwt.claim.sub',staff_actor::text,true);
  home := public.get_operation_home();
  if jsonb_array_length(home->'branches') <> 2 or (home->>'total_expenses')::numeric <> 25
     or home::text ~ 'PRIVATE-|Test shift|"GRILL"|T-1' then
    raise exception 'unscoped branch, amount or private text exposed';
  end if;
  select value into row_ from jsonb_array_elements(home->'branches') where value->>'code'='TAWANA';
  if (row_->>'draft_count')::integer is distinct from 2
     or (row_->>'draft_date')::date is distinct from day-1
     or (row_->>'receipts')::integer is distinct from 1
     or (row_->>'reimbursements')::integer is distinct from 1
     or (row_->>'can_enter_expenses')::boolean is distinct from true then
    raise exception 'work queue counts or original draft date incorrect';
  end if;
  if boy_central.daily_finance_active() and row_->>'sales_status' is distinct from 'awaiting_manual' then
    raise exception 'missing manual close did not show waiting';
  end if;
  select value into row_ from jsonb_array_elements(home->'branches') where value->>'code'='BURGER';
  if row_->>'sales_status' is distinct from 'no_sales' or jsonb_typeof(row_->'sales') is distinct from 'null' then
    raise exception 'missing legacy sales did not show no data';
  end if;
  if jsonb_array_length(home->'recent') is distinct from 1 or
     home#>>'{recent,0,kind}' is distinct from 'expense' or
     (home#>>'{recent,0,amount}')::numeric is distinct from 25 or
     (home#>>'{recent,0,count}')::integer is distinct from 1 then
    raise exception 'recent confirmed expense was wrong or out-of-scope event leaked';
  end if;

  insert into boy_central.financial_closes(company_id,branch_id,business_date,source_type,source_key,fingerprint)
  values (scratch_company,scratch_tawana,day,'manual',day::text,'test-explicit-zero');
  insert into boy_central.pos_orders(company_id,branch_id,source_system,external_id,order_no,payment_status,ordered_at)
  values (scratch_company,scratch_burger,'QA_HOME','B-1','B-1','completed',now());
  home := public.get_operation_home();
  for row_ in select value from jsonb_array_elements(home->'branches') loop
    if (row_->>'code'='BURGER' or boy_central.daily_finance_active()) and
      (row_->>'sales_status' is distinct from 'recorded' or (row_->>'sales')::numeric is distinct from 0) then
      raise exception 'recorded zero confused with no data';
    end if;
  end loop;
  perform set_config('request.jwt.claim.sub',viewer_actor::text,true);
  home := public.get_operation_home();
  row_ := home#>'{branches,0}';
  if jsonb_array_length(home->'branches') is distinct from 1 or row_->>'code' is distinct from 'TAWANA'
     or (row_->>'can_enter_expenses')::boolean is distinct from false
     or (row_->>'draft_count')::integer is distinct from 0
     or (row_->>'reimbursements')::integer is distinct from 0 then
    raise exception 'viewer scope or expense rights not enforced';
  end if;
  perform set_config('request.jwt.claim.sub',special_actor::text,true);
  denied := false;
  begin perform public.get_operation_home(); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'BigC shared account accessed Home'; end if;
end $test$;
rollback;
