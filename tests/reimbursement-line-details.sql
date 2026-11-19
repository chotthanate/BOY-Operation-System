-- Always run inside BEGIN/ROLLBACK; no real reimbursement is changed.
do $test$
declare company uuid;branch uuid;cat uuid;result jsonb;row_data jsonb;before_data jsonb;payment uuid;tx uuid;
begin
 select company_id into company from boy_central.profiles where active and company_role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',(select user_id::text from boy_central.profiles where company_id=company and active and company_role='admin' limit 1),true);
 select id into branch from boy_central.branches where code='BIGC-SOUTH-PATTAYA';
 select id into cat from boy_central.categories where company_id=company and active and parent_id is null and category_type='item' and code~'^CAT-[0-9]+$' limit 1;
 before_data:=boy_central.get_reimbursements();
 result:=boy_central.record_expense_v4(jsonb_build_object('branch_id',branch,'transaction_date','2098-11-22','idempotency_key',gen_random_uuid(),'receiving_mode','immediate','source_system','QA_LINES_ROLLBACK',
 'payment',jsonb_build_object('method','reimbursement_pending','amount',50),'lines',jsonb_build_array(
 jsonb_build_object('description','QA first expense','category_id',cat,'line_total',20),
 jsonb_build_object('description','QA second expense','category_id',cat,'line_total',30))));
 tx:=(result->>'transaction_id')::uuid;
 select id into payment from boy_central.payments where transaction_id=tx;
 result:=boy_central.get_reimbursements();
 select value into row_data from jsonb_array_elements(result->'rows') where value->>'id'=payment::text;
 if row_data is null or jsonb_array_length(row_data->'lines')<>2 then raise exception 'expense lines were combined or missing';end if;
 if row_data#>>'{lines,0,description}'<>'QA first expense' or (row_data#>>'{lines,0,amount}')::numeric<>20
 or row_data#>>'{lines,1,description}'<>'QA second expense' or (row_data#>>'{lines,1,amount}')::numeric<>30 then raise exception 'line order/amount mismatch';end if;
 if (result->>'count')::integer<>(before_data->>'count')::integer+1 or (result->>'line_count')::integer<>(before_data->>'line_count')::integer+2 then raise exception 'bill/line count mismatch';end if;
 if (result->>'total')::numeric<>(before_data->>'total')::numeric+50 or row_data->>'branch_code'<>'BIGC-SOUTH-PATTAYA' then raise exception 'branch/total mismatch';end if;
 if has_function_privilege('anon','boy_central.get_reimbursements()','execute') then raise exception 'anonymous read granted';end if;
end;
$test$;
select 'line details, separate bill/item counts, amounts, branch and access checks passed; rollback required' result;
