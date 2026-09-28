create or replace function boy_central.bulk_upsert_master_catalog_rows(
  target_sheet_name text,
  rows jsonb,
  actor_name text default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_sheet boy_central.master_catalog_sheets;
  target_row boy_central.master_catalog_rows;
  entry jsonb;
  clean_entry jsonb;
  merged_data jsonb;
  old_data jsonb;
  target_key text;
  expected_version text;
  new_version text;
  missing_header text;
  next_number integer;
  added_count integer := 0;
  updated_count integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนนำเข้าข้อมูล';
  end if;
  if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows) = 0 then
    raise exception 'ไม่พบข้อมูลนำเข้า';
  end if;
  if jsonb_array_length(rows) > 500 then
    raise exception 'นำเข้าได้สูงสุดครั้งละ 500 รายการ';
  end if;

  select * into target_sheet
  from boy_central.master_catalog_sheets s
  where s.sheet_name = target_sheet_name
    and s.active
    and boy_central_private.is_company_admin(s.company_id)
  limit 1
  for update;
  if target_sheet.id is null then
    raise exception 'ไม่พบตารางหรือไม่มีสิทธิ์แก้ไข';
  end if;
  if nullif(target_sheet.id_header, '') is null then
    raise exception 'ตารางนี้ไม่มีรหัสรายการ จึงยังนำเข้าแบบ Excel ไม่ได้';
  end if;

  if exists (
    select 1
    from (
      select nullif(btrim(value ->> target_sheet.id_header), '') as record_key, count(*)
      from jsonb_array_elements(rows)
      group by 1
      having count(*) > 1
    ) duplicates
    where duplicates.record_key is not null
  ) then
    raise exception 'ไฟล์มีรหัสรายการซ้ำ กรุณาแก้ก่อนนำเข้า';
  end if;

  select coalesce(max(r.row_number), 1) into next_number
  from boy_central.master_catalog_rows r
  where r.sheet_id = target_sheet.id;

  for entry in select value from jsonb_array_elements(rows)
  loop
    target_key := nullif(btrim(entry ->> target_sheet.id_header), '');
    if target_key is null then
      raise exception 'ทุกรายการต้องมี %', target_sheet.id_header;
    end if;

    select coalesce(jsonb_object_agg(source.key, source.value), '{}'::jsonb)
    into clean_entry
    from jsonb_each(entry) source
    where exists (
      select 1 from jsonb_array_elements_text(target_sheet.headers) allowed(value)
      where allowed.value = source.key
    )
    and not exists (
      select 1 from jsonb_array_elements_text(target_sheet.readonly_headers) readonly(value)
      where readonly.value = source.key
    );
    clean_entry := clean_entry || jsonb_build_object(target_sheet.id_header, target_key);
    expected_version := nullif(entry ->> '__version', '');

    target_row.id := null;
    select * into target_row
    from boy_central.master_catalog_rows r
    where r.sheet_id = target_sheet.id and r.record_key = target_key
    for update;

    if target_row.id is not null then
      if expected_version is null then
        raise exception 'รายการ % ไม่มีข้อมูลเวอร์ชัน กรุณาส่งออก Excel ใหม่', target_key;
      end if;
      if expected_version is distinct from target_row.source_version then
        raise exception 'รายการ % มีการแก้ไขใหม่กว่า กรุณาส่งออก Excel ใหม่แล้วลองอีกครั้ง', target_key;
      end if;
      merged_data := coalesce(target_row.row_data, '{}'::jsonb) || clean_entry;
    else
      merged_data := clean_entry;
    end if;

    missing_header := null;
    select required.value into missing_header
    from jsonb_array_elements_text(target_sheet.required_headers) required(value)
    where nullif(btrim(merged_data ->> required.value), '') is null
    limit 1;
    if missing_header is not null then
      raise exception 'รายการ % ขาดข้อมูลบังคับ: %', target_key, missing_header;
    end if;

    new_version := extract(epoch from clock_timestamp())::text;
    if target_row.id is not null then
      old_data := target_row.row_data;
      update boy_central.master_catalog_rows
      set row_data = merged_data,
          record_key = target_key,
          source_version = new_version
      where id = target_row.id
      returning * into target_row;
      insert into boy_central.master_catalog_changes(
        company_id, sheet_id, row_id, action, before_data, after_data, actor_id, actor_label
      ) values (
        target_sheet.company_id, target_sheet.id, target_row.id, 'import', old_data,
        target_row.row_data, (select auth.uid()), actor_name
      );
      updated_count := updated_count + 1;
    else
      next_number := next_number + 1;
      insert into boy_central.master_catalog_rows(
        company_id, sheet_id, row_number, record_key, row_data, source_version
      ) values (
        target_sheet.company_id, target_sheet.id, next_number, target_key, merged_data, new_version
      ) returning * into target_row;
      insert into boy_central.master_catalog_changes(
        company_id, sheet_id, row_id, action, after_data, actor_id, actor_label
      ) values (
        target_sheet.company_id, target_sheet.id, target_row.id, 'import',
        target_row.row_data, (select auth.uid()), actor_name
      );
      added_count := added_count + 1;
    end if;
  end loop;

  update boy_central.master_catalog_sheets
  set source_name = 'supabase',
      source_revision = extract(epoch from clock_timestamp())::text,
      last_imported_at = now()
  where id = target_sheet.id;

  return coalesce(boy_central.get_master_catalog(target_sheet_name), '{}'::jsonb)
    || jsonb_build_object('imported', jsonb_build_object('added', added_count, 'updated', updated_count));
end;
$$;

revoke all on function boy_central.bulk_upsert_master_catalog_rows(text, jsonb, text) from public, anon;
grant execute on function boy_central.bulk_upsert_master_catalog_rows(text, jsonb, text) to authenticated;

comment on function boy_central.bulk_upsert_master_catalog_rows(text, jsonb, text)
is 'Bulk upserts a partial exported master catalog with optimistic version checks; Supabase is primary and Google Sheets is mirrored asynchronously.';
