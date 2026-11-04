-- Execute inside BEGIN/ROLLBACK, after the three migrations. No test data stays.
do $test$
declare actor uuid; company uuid;tawana uuid;south uuid;category uuid;body jsonb;request uuid:=gen_random_uuid();
 payload jsonb;result jsonb;first_tx uuid;doc uuid;denied boolean;token text:='test-only-'||gen_random_uuid();close_payload jsonb;stamp text;signature text;
begin
 select user_id,company_id into actor,company from boy_central.profiles where active and company_role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select id into tawana from boy_central.branches where code='TAWANA';select id into south from boy_central.branches where code='BIGC-SOUTH-PATTAYA';
 update boy_central.branch_revenue_policies set effective_date='2099-02-01' where branch_id=tawana;
 select id into category from boy_central.categories where company_id=company and parent_id is null and category_type='item' and code~'^CAT-[0-9]+$' and active limit 1;
 body:=jsonb_build_object('cash',jsonb_build_object('v',500),'transfer',jsonb_build_object('v',0),'other',jsonb_build_object('v',0),
 'exp',jsonb_build_array(jsonb_build_object('i','ทดสอบค่าใช้จ่าย','p','100','q','','u','','category_id',category,'pay','cash')));
 payload:=jsonb_build_object('branch_code','TAWANA','business_date','2099-02-01','request_id',request,'expected_revision',0,'data',body);
 result:=boy_central.post_daily_document(payload);doc:=(result->>'document_id')::uuid;
 select unnest(transaction_ids) into first_tx from boy_central.daily_documents where id=doc;
 if (result->>'revision')::integer<>1 then raise exception 'first revision missing';end if;
 result:=boy_central.post_daily_document(payload);
 if not (result->>'duplicate')::boolean then raise exception 'retry not deduplicated';end if;
 if (select count(*) from boy_central.transactions where id=first_tx)<>1 then raise exception 'expense duplicated';end if;
 if not exists(select 1 from jsonb_array_elements(boy_central.get_dashboard_daily('2099-02-01')->'branches')b where b->>'code'='TAWANA' and (b->>'income')::numeric=500 and (b->>'expense')::numeric=100) then raise exception 'daily dashboard mismatch';end if;
 denied:=false;
 begin perform boy_central.post_daily_document(payload||jsonb_build_object('request_id',gen_random_uuid()));exception when others then denied:=sqlerrm like 'document conflict%';end;
 if not denied then raise exception 'stale revision overwritten';end if;
 body:=jsonb_set(body,'{exp,0,p}','"60"');body:=jsonb_set(body,'{cash,v}','700');
 result:=boy_central.post_daily_document(payload||jsonb_build_object('request_id',gen_random_uuid(),'expected_revision',1,'data',body));
 if not exists(select 1 from boy_central.transactions where id=first_tx and status='voided') then raise exception 'old expense not reversed';end if;
 if (boy_central.get_branch_dashboard('TAWANA','2099-02-01','2099-02-01')#>>'{totals,net}')::numeric<>640 then raise exception 'corrected dashboard mismatch';end if;
 if not exists(select 1 from boy_central.financial_revisions where entity_type='daily_documents' and entity_id=doc and revision=1) then raise exception 'document revision history missing';end if;
 if (select sum((p->>'amount')::numeric) from jsonb_array_elements(boy_central.get_branch_dashboard('TAWANA','2099-01-31','2099-02-01')->'payments')p)<>700 then raise exception 'mixed-cutover payment mismatch';end if;
 insert into boy_central.financial_closes(company_id,branch_id,business_date,source_type,source_key,cash,fingerprint)
 values(company,tawana,'2099-02-01','pos_shift','ignored-while-manual',999,'test');
 if (boy_central.get_branch_dashboard('TAWANA','2099-02-01','2099-02-01')#>>'{totals,revenue}')::numeric<>700 then raise exception 'manual and POS counted twice';end if;
 insert into boy_central.pos_devices(company_id,branch_id,device_code,device_name,status,access_token_hash)
 values(company,south,'QA-'||gen_random_uuid(),'rollback only','active',encode(extensions.digest(token,'sha256'),'hex'));
 close_payload:=jsonb_build_object('shift_id','QA-'||gen_random_uuid(),'opened_at','2099-02-01T08:00:00+07:00','closed_at','2099-02-01T20:00:00+07:00','cash',100,'transfer',50,'total',150,'order_count',2);
 result:=boy_central.record_pos_shift_close(token,close_payload);
 if result->>'status'<>'saved' then raise exception 'shift close not saved';end if;
 result:=boy_central.record_pos_shift_close(token,close_payload);
 if not(result->>'duplicate')::boolean then raise exception 'shift close retry duplicated';end if;
 denied:=false;
 begin perform boy_central.record_pos_shift_close(token,close_payload||'{"cash":99,"total":149}'::jsonb);exception when others then denied:=sqlerrm like 'shift close conflict%';end;
 if not denied then raise exception 'changed close silently overwritten';end if;
 if (boy_central.get_branch_dashboard('BIGC-SOUTH-PATTAYA','2099-02-01','2099-02-01')#>>'{totals,revenue}')::numeric<>150 then raise exception 'POS revenue missing';end if;
 if boy_central.get_pos_device_delta(token,null,null)->>'configuration_version' is null then raise exception 'delta missing versions';end if;
 result:=boy_central.get_pos_device_delta(token,null,null);
 result:=boy_central.get_pos_device_delta(token,result->>'configuration_version',result->>'stock_version');
 if not(result->>'not_modified')::boolean then raise exception 'unchanged POS downloaded full configuration';end if;
 if has_function_privilege('anon','boy_central.claim_mirror_jobs(integer)','execute') then raise exception 'anonymous mirror access';end if;
 if has_function_privilege('anon','boy_central.post_daily_document(jsonb)','execute') then raise exception 'anonymous financial write';end if;
 if has_function_privilege('anon','boy_central.get_central_mirror_key()','execute') then raise exception 'signing key exposed';end if;
 stamp:=floor(extract(epoch from now())*1000)::bigint::text;
 signature:=encode(extensions.hmac(stamp||E'\n'||'{}',boy_central.get_central_mirror_key(),'sha256'),'hex');
 if not public.verify_central_mirror(stamp,'{}',signature) then raise exception 'valid mirror signature rejected';end if;
 if public.verify_central_mirror(stamp,'{"changed":true}',signature) then raise exception 'tampered mirror payload accepted';end if;
 if public.verify_central_mirror('1000000000000','{}',signature) then raise exception 'expired mirror request accepted';end if;
 if jsonb_array_length(boy_central.claim_mirror_jobs(30))=0 then raise exception 'mirror not queued atomically';end if;
 -- Voiding a daily document is a new revision, never deletion of its history.
 result:=boy_central.post_daily_document(payload||jsonb_build_object('request_id',gen_random_uuid(),'expected_revision',2,'data','{"exp":[]}'::jsonb));
 if (boy_central.get_branch_dashboard('TAWANA','2099-02-01','2099-02-01')#>>'{totals,revenue}')::numeric<>0 then raise exception 'cancelled manual income remains';end if;
 if exists(select 1 from boy_central.transactions where transaction_no like 'DLY-'||doc||'-%' and status='confirmed') then raise exception 'cancelled expense remains';end if;
end $test$;
select 'central financial flow assertions passed; transaction must be rolled back' as result;
