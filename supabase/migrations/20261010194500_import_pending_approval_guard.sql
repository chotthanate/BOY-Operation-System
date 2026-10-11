-- Import batches are approved only when every submitted row has been
-- explicitly validated. Pending, warning, skipped, imported, and error rows
-- remain reviewable instead of being approved implicitly.

create or replace function boy_central.upsert_import_batch(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  caller_role text := coalesce((select auth.jwt()->>'role'), '');
  target_company_id uuid := nullif(payload->>'company_id', '')::uuid;
  target_branch_id uuid := nullif(payload->>'branch_id', '')::uuid;
  target_batch_id uuid;
  request_key text := nullif(payload->>'idempotency_key', '');
  row_value jsonb;
  row_number_value integer := 0;
begin
  if actor_id is null and caller_role <> 'service_role' then
    raise exception 'authentication required';
  end if;

  if target_company_id is null or request_key is null then
    raise exception 'company_id and idempotency_key are required';
  end if;

  if caller_role <> 'service_role' and not boy_central_private.is_company_member(target_company_id) then
    raise exception 'company access denied';
  end if;

  if target_branch_id is not null
    and caller_role <> 'service_role'
    and not boy_central_private.has_branch_access(target_branch_id, array['admin', 'manager']) then
    raise exception 'branch access denied';
  end if;

  insert into boy_central.import_batches (
    company_id, branch_id, import_type, source_system, source_file_id,
    source_sheet_name, status, row_count, idempotency_key, requested_by
  ) values (
    target_company_id,
    target_branch_id,
    payload->>'import_type',
    coalesce(nullif(payload->>'source_system', ''), 'google_sheets'),
    nullif(payload->>'source_file_id', ''),
    nullif(payload->>'source_sheet_name', ''),
    'validating',
    jsonb_array_length(coalesce(payload->'rows', '[]'::jsonb)),
    request_key,
    actor_id
  ) on conflict (company_id, source_system, idempotency_key)
    do update set
      source_file_id = excluded.source_file_id,
      source_sheet_name = excluded.source_sheet_name,
      updated_at = now()
  returning id into target_batch_id;

  delete from boy_central.import_rows where import_batch_id = target_batch_id;

  for row_value in select value from jsonb_array_elements(coalesce(payload->'rows', '[]'::jsonb))
  loop
    row_number_value := row_number_value + 1;
    insert into boy_central.import_rows (
      company_id, import_batch_id, source_row_number, payload,
      validation_status, validation_messages
    ) values (
      target_company_id,
      target_batch_id,
      coalesce(nullif(row_value->>'source_row_number', '')::integer, row_number_value + 1),
      row_value,
      case when nullif(row_value->>'validation_status', '') is null then 'pending'
        else row_value->>'validation_status' end,
      coalesce(row_value->'validation_messages', '[]'::jsonb)
    );
  end loop;

  update boy_central.import_batches ib
  set valid_count = counts.valid_or_warning_count,
      error_count = counts.error_count,
      status = case
        when counts.total_count > 0 and counts.valid_count = counts.total_count then 'approved'
        else 'needs_review'
      end,
      updated_at = now()
  from (
    select
      count(*)::integer as total_count,
      count(*) filter (where validation_status = 'valid')::integer as valid_count,
      count(*) filter (where validation_status in ('valid', 'warning'))::integer as valid_or_warning_count,
      count(*) filter (where validation_status = 'error')::integer as error_count
    from boy_central.import_rows
    where import_batch_id = target_batch_id
  ) counts
  where ib.id = target_batch_id;

  return jsonb_build_object(
    'status', 'success',
    'import_batch_id', target_batch_id,
    'row_count', row_number_value
  );
end;
$$;

revoke all on function boy_central.upsert_import_batch(jsonb) from public, anon;
grant execute on function boy_central.upsert_import_batch(jsonb) to authenticated, service_role;
