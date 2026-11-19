-- Execute with BEGIN/ROLLBACK: creates no lasting business data or mirror jobs.
do $test$
declare result jsonb; first_code text; second_code text; version text; old_count bigint;
begin
  perform set_config('request.jwt.claim.sub',(select user_id::text from boy_central.profiles where active and company_role='admin' limit 1),true);
  select count(*) into old_count from boy_central.master_catalog_rows;
  result := boy_central.bulk_upsert_master_catalog_rows('M_หน่วย',jsonb_build_array(
    jsonb_build_object('unit_id','','ชื่อหน่วย','QA auto ID first','ประเภทหน่วย','นับ/บรรจุ','เปิดใช้งาน',true),
    jsonb_build_object('ชื่อหน่วย','QA auto ID second','ประเภทหน่วย','นับ/บรรจุ','เปิดใช้งาน',true)
  ),'QA rollback automatic IDs');
  select record_key,source_version into first_code,version from boy_central.master_catalog_rows where row_data->>'ชื่อหน่วย'='QA auto ID first';
  select record_key into second_code from boy_central.master_catalog_rows where row_data->>'ชื่อหน่วย'='QA auto ID second';
  if first_code !~ '^UNIT-[0-9]+$' or second_code !~ '^UNIT-[0-9]+$' or first_code=second_code then raise exception 'automatic unit IDs failed';end if;
  if (result#>>'{imported,added}')::integer<>2 then raise exception 'insert result mismatch';end if;
  if not exists(select 1 from boy_central.units where code=first_code) then raise exception 'canonical unit linkage missing';end if;
  -- Internal queue is intentionally not readable by authenticated clients.
  if current_user='postgres' then
    if not exists(select 1 from boy_central.mirror_jobs j join boy_central.master_catalog_rows r on r.id=j.entity_id where j.entity_type='master_row' and r.record_key=first_code) then raise exception 'generated ID was not queued for Sheet copy';end if;
  end if;
  perform boy_central.bulk_upsert_master_catalog_rows('M_หน่วย',jsonb_build_array(jsonb_build_object('unit_id',first_code,'__version',version,'หมายเหตุ','QA edit')),'QA rollback existing ID');
  if not exists(select 1 from boy_central.master_catalog_rows where record_key=first_code and row_data->>'หมายเหตุ'='QA edit') then raise exception 'edit did not preserve ID';end if;
  begin
    perform boy_central.bulk_upsert_master_catalog_rows('M_หน่วย',jsonb_build_array(jsonb_build_object('__version',version,'ชื่อหน่วย','must not create')),'QA invalid edit');
    raise exception 'missing edit ID was accepted';
  exception when others then
    if sqlerrm='missing edit ID was accepted' then raise;end if;
  end;
  begin
    perform boy_central.bulk_upsert_master_catalog_rows('M_หน่วย','[{}]'::jsonb,'QA missing name');
    raise exception 'missing name was accepted';
  exception when others then
    if sqlerrm='missing name was accepted' then raise;end if;
  end;
  result:=boy_central.bulk_upsert_master_catalog_rows('M_ผู้ขาย',jsonb_build_array(jsonb_build_object('ชื่อผู้ขาย','QA automatic supplier','เปิดใช้งาน',true)),'QA rollback supplier');
  if not exists(select 1 from boy_central.master_catalog_rows where row_data->>'ชื่อผู้ขาย'='QA automatic supplier' and record_key~'^SUP-[0-9]+$') then raise exception 'supplier auto ID missing';end if;
  if (select count(*) from boy_central.master_catalog_rows)<>old_count+3 then raise exception 'unexpected row changes';end if;
  if has_function_privilege('anon','boy_central.bulk_upsert_master_catalog_rows(text,jsonb,text)','execute') then raise exception 'anonymous write allowed';end if;
end $test$;
select 'automatic IDs, unique multi-row allocation, canonical unit linkage, existing-ID edits and access checks passed; rollback required' result;
