do $test$
declare actor uuid;company uuid;b uuid;c uuid;result jsonb;body jsonb;payload jsonb;tx uuid;before_stock bigint;denied boolean:=false;
begin
 select user_id,company_id into actor,company from boy_central.profiles where active and company_role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select id into b from boy_central.branches where code='BIGC-SOUTH-PATTAYA';
 select id into c from boy_central.categories where company_id=company and code='CAT-900000';
 select count(*) into before_stock from boy_central.stock_movements;
 payload:=jsonb_build_object('branch_id',b,'transaction_date','2098-10-12','source_system','QA_ROLLBACK','idempotency_key',gen_random_uuid()::text,
 'receiving_mode','immediate','payment',jsonb_build_object('method','cash','amount',500),
 'lines',jsonb_build_array(jsonb_build_object('description','QA construction','line_total',500,'expense_class','capital','project_name','QA opening','investment_category','construction')));
 payload:=jsonb_set(payload,'{lines,0,item_id}',to_jsonb((select id from boy_central.items where company_id=company limit 1)::text));
 result:=boy_central.record_expense_v4(payload);tx:=(result->>'transaction_id')::uuid;
 if not exists(select 1 from boy_central.transactions where id=tx and accounting_class='capital') then raise exception 'classification missing';end if;
 if not exists(select 1 from boy_central.transaction_lines where transaction_id=tx and investment_details->>'project_name'='QA opening') then raise exception 'project missing';end if;
 if (select count(*) from boy_central.stock_movements)<>before_stock then raise exception 'investment changed stock';end if;
 if exists(select 1 from boy_central.purchase_receipts where transaction_id=tx) then raise exception 'investment created receipt';end if;
 result:=boy_central.record_expense_v4(payload);
 if result->>'status'<>'duplicate' then raise exception 'retry duplicated';end if;
 begin perform boy_central.record_expense_v4(jsonb_set(payload,'{lines,0,project_name}','"changed"'));exception when others then denied:=true;end;
 if not denied then raise exception 'changed project retry accepted';end if;
 if (boy_central.get_branch_dashboard('BIGC-SOUTH-PATTAYA','2098-10-12','2098-10-12')#>>'{totals,expenses}')::numeric<>0 then raise exception 'capital counted as operating expense';end if;
 if (boy_central.get_branch_dashboard('BIGC-SOUTH-PATTAYA','2098-10-12','2098-10-12')#>>'{totals,investment}')::numeric<>500 then raise exception 'investment dashboard missing';end if;
 if (boy_central.get_investment_report('BIGC-SOUTH-PATTAYA','2098-10-01','2098-10-31')->>'total')::numeric<>500 then raise exception 'report mismatch';end if;
 body:=jsonb_build_object('exp',jsonb_build_array(
 jsonb_build_object('i','QA operating','p',20,'category_id',c,'pay','cash','receiving_mode','immediate'),
 jsonb_build_object('i','QA investment','p',300,'pay','cash','receiving_mode','immediate','expense_class','capital','project_name','QA daily','investment_category','equipment')));
 result:=boy_central.post_daily_document(jsonb_build_object('branch_code','BIGC-CENTRAL-PATTAYA','business_date','2098-10-12','request_id',gen_random_uuid(),'expected_revision',0,'data',body));
 if (boy_central.get_branch_dashboard('BIGC-CENTRAL-PATTAYA','2098-10-12','2098-10-12')#>>'{totals,expenses}')::numeric<>20 then raise exception 'mixed daily operating mismatch';end if;
 if (boy_central.get_dashboard_monthly(2098,10)#>>'{summary,investment}')::numeric<>800 then raise exception 'monthly investment missing';end if;
 if (boy_central.get_dashboard_daily('2098-10-12')#>>'{totals,expense}')::numeric<>20 then raise exception 'daily capital mixed into expense';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);denied:=false;
 begin perform boy_central.record_expense_v4(payload||jsonb_build_object('idempotency_key',gen_random_uuid()));exception when others then denied:=true;end;
 if not denied then raise exception 'unprivileged investment write accepted';end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 update boy_central.transactions set status='voided' where id=tx;
 if (boy_central.get_investment_report('BIGC-SOUTH-PATTAYA','2098-10-01','2098-10-31')->>'total')::numeric<>0 then raise exception 'voided investment still counted';end if;
 if has_function_privilege('anon','boy_central.get_investment_report(text,date,date)','execute') then raise exception 'anon investment access';end if;
end $test$;
select 'investment tests passed (rollback)' result;
