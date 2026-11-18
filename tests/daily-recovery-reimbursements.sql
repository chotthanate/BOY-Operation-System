-- Always BEGIN/ROLLBACK: never settle a real reimbursement in a test.
do $test$
declare actor uuid;company uuid;b uuid;c uuid;tx uuid;payment uuid;body jsonb;args jsonb;old_request uuid:=gen_random_uuid();new_request uuid:=gen_random_uuid();r jsonb;baseline numeric;denied boolean;
begin
 select user_id,company_id into actor,company from boy_central.profiles where active and company_role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select id into b from boy_central.branches where code='BIGC-SOUTH-PATTAYA';
 select id into c from boy_central.categories where company_id=company and active and parent_id is null and category_type='item' and code~'^CAT-[0-9]+$' limit 1;
 baseline:=(boy_central.get_reimbursements()->>'total')::numeric;
 r:=boy_central.record_expense_v4(jsonb_build_object('branch_id',b,'transaction_date','2098-11-19','idempotency_key',gen_random_uuid(),'receiving_mode','immediate','source_system','QA_RECOVERY_ROLLBACK','payment',jsonb_build_object('method','reimbursement_pending','amount',20),'lines',jsonb_build_array(jsonb_build_object('description','QA pending reimbursement','category_id',c,'line_total',20))));
 tx:=(r->>'transaction_id')::uuid;select id into payment from boy_central.payments where transaction_id=tx;
 if not exists(select 1 from jsonb_array_elements(boy_central.get_reimbursements()->'rows')x where x->>'id'=payment::text and x->>'branch_code'='BIGC-SOUTH-PATTAYA') then raise exception 'South reimbursement missing';end if;
 r:=boy_central.settle_reimbursements(jsonb_build_object('payment_ids',jsonb_build_array(payment)));
 if (r->>'settled')::integer<>1 then raise exception 'settlement failed';end if;
 if (boy_central.get_reimbursements()->>'total')::numeric<>baseline then raise exception 'unrelated reimbursement changed';end if;
 r:=boy_central.settle_reimbursements(jsonb_build_object('payment_ids',jsonb_build_array(payment)));
 if (r->>'settled')::integer<>0 then raise exception 'settlement not idempotent';end if;
 if not exists(select 1 from boy_central.mirror_jobs where entity_id=tx and revision like 'reimbursement:%') then raise exception 'settlement mirror not queued';end if;
 denied:=false;begin perform boy_central.settle_reimbursements(jsonb_build_object('payment_ids',jsonb_build_array(gen_random_uuid())));exception when others then denied:=true;end;
 if not denied then raise exception 'unknown payment accepted';end if;
 body:=jsonb_build_object('cash',jsonb_build_object('v',100),'transfer',jsonb_build_object('v',''),'exp','[]'::jsonb);
 args:=jsonb_build_object('branch_code','TAWANA','business_date','2098-11-19','request_id',old_request,'expected_data',body,'expected_revision',0);
 if boy_central.resolve_daily_request(args)->>'state'<>'not_found' then raise exception 'unexpected pending state';end if;
 if boy_central.resolve_daily_request(args||'{"supersede":true}')->>'state'<>'superseded' then raise exception 'supersede failed';end if;
 denied:=false;begin perform boy_central.post_daily_document(jsonb_build_object('branch_code','TAWANA','business_date','2098-11-19','request_id',old_request,'expected_revision',0,'data',body));exception when others then denied:=sqlerrm like 'request superseded%';end;
 if not denied then raise exception 'late old request was posted';end if;
 r:=boy_central.post_daily_document(jsonb_build_object('branch_code','TAWANA','business_date','2098-11-19','request_id',new_request,'expected_revision',0,'data',body));
 if r->>'status'<>'Success' then raise exception 'blank transfer blocked';end if;
 if not exists(select 1 from boy_central.financial_closes f join boy_central.branches b on b.id=f.branch_id where b.code='TAWANA' and f.business_date='2098-11-19' and f.transfer=0 and f.cash=100) then raise exception 'blank transfer not zero';end if;
 if boy_central.resolve_daily_request(args||jsonb_build_object('request_id',new_request))->>'state'<>'committed' then raise exception 'committed request not found';end if;
 if has_function_privilege('anon','boy_central.resolve_daily_request(jsonb)','execute') or has_function_privilege('anon','boy_central.settle_reimbursements(jsonb)','execute') then raise exception 'anonymous financial access';end if;
 -- Simulate sequential devices/users through the shared revision contract.
 r:=boy_central.save_daily_draft(jsonb_build_object('branch_code','TAWANA','business_date','2098-11-20','expected_revision',0,'expected_document_revision',0,'data',body));
 if (r->>'revision')::integer<>1 then raise exception 'first shared revision incorrect';end if;
 if (boy_central.get_daily_document('TAWANA','2098-11-20')->>'draft_revision')::integer<>1 then raise exception 'shared draft not visible';end if;
 denied:=false;begin perform boy_central.save_daily_draft(jsonb_build_object('branch_code','TAWANA','business_date','2098-11-20','expected_revision',0,'expected_document_revision',0,'data',body));exception when others then denied:=sqlerrm like 'draft conflict%';end;
 if not denied then raise exception 'stale shared edit accepted';end if;
 denied:=false;begin perform boy_central.post_daily_document(jsonb_build_object('branch_code','TAWANA','business_date','2098-11-20','request_id',gen_random_uuid(),'expected_revision',0,'expected_draft_revision',0,'data',body));exception when others then denied:=sqlerrm like 'draft conflict%';end;
 if not denied then raise exception 'stale submission discarded another device draft';end if;
 r:=boy_central.post_daily_document(jsonb_build_object('branch_code','TAWANA','business_date','2098-11-20','request_id',gen_random_uuid(),'expected_revision',0,'expected_draft_revision',1,'data',body));
 if r->>'status'<>'Success' or exists(select 1 from boy_central.daily_shared_drafts where business_date='2098-11-20' and branch_id=(select id from boy_central.branches where code='TAWANA')) then raise exception 'shared submit cleanup failed';end if;
 perform boy_central.save_daily_draft(jsonb_build_object('branch_code','TAWANA','business_date','2098-11-20','expected_revision',0,'expected_document_revision',1,'data',body||'{"cash":{"v":200}}'));
 if (boy_central.get_daily_document('TAWANA','2098-11-20')->>'submitted')::boolean then raise exception 'new shared edit incorrectly locked as submitted';end if;
end $test$;
select 'reimbursement, recovery fencing and blank-transfer tests passed; rollback required' result;
