-- Always run inside BEGIN/ROLLBACK.
do $test$
declare old_jobs bigint;old_pending bigint;r boy_central.master_catalog_rows;change uuid;job uuid;claimed jsonb;result jsonb;
begin
 perform set_config('request.jwt.claim.sub',(select user_id::text from boy_central.profiles where active and company_role='admin' limit 1),true);
 select count(*) into old_jobs from boy_central.mirror_jobs where entity_type='master_row';
 select count(*) into old_pending from boy_central.master_catalog_changes where mirror_status='pending';
 update boy_central.master_mirror_control set enabled=true;
 if (select count(*) from boy_central.mirror_jobs where entity_type='master_row')<>old_jobs then raise exception 'historical changes were replayed';end if;
 result:=boy_central.get_master_catalog_versions(array['M_หน่วย']);
 if result#>>'{M_หน่วย,serverMirror}'<>'true' then raise exception 'mirror capability not advertised';end if;
 select m.* into r from boy_central.master_catalog_rows m join boy_central.master_catalog_sheets s on s.id=m.sheet_id where s.sheet_name='M_หน่วย' and m.record_key='UNIT-013';
 perform boy_central.bulk_upsert_master_catalog_rows('M_หน่วย',jsonb_build_array(jsonb_build_object('unit_id',r.record_key,'__version',r.source_version,'หมายเหตุ','QA rollback mirror')),'QA master performance rollback');
 select id into change from boy_central.master_catalog_changes where row_id=r.id order by created_at desc,id desc limit 1;
 select id into job from boy_central.mirror_jobs where entity_type='master_row' and entity_id=r.id and revision=change::text;
 if job is null then raise exception 'new write has no durable mirror job';end if;
 update boy_central.mirror_jobs set available_at='2000-01-01' where id=job;
 select value->'payload' into claimed from jsonb_array_elements(boy_central.claim_mirror_jobs(1)) where value->>'id'=job::text;
 if claimed->>'sheet_name'<>'M_หน่วย' or claimed#>>'{data,หมายเหตุ}'<>'QA rollback mirror' then raise exception 'snapshot identity mismatch';end if;
 perform boy_central.finish_mirror_job(job,false,'QA transient failure');
 if not exists(select 1 from boy_central.mirror_jobs where id=job and status='error') then raise exception 'failure was acknowledged as success';end if;
 perform boy_central.finish_mirror_job(job,true,null);
 if not exists(select 1 from boy_central.master_catalog_changes where id=change and mirror_status='synced') then raise exception 'new audit copy not acknowledged';end if;
 if (select count(*) from boy_central.master_catalog_changes where mirror_status='pending')<>old_pending then raise exception 'historical pending states were altered';end if;
 if has_function_privilege('anon','boy_central.get_master_catalog_versions(text[])','execute') then raise exception 'anonymous catalog metadata granted';end if;
end $test$;
select 'version reads, new-only durable queue, failure/retry and old-queue preservation passed; rollback required' result;
