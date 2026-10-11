do $$
declare
  definition text;
begin
  if to_regprocedure('boy_central.upsert_import_batch(jsonb)') is null then
    raise exception 'upsert_import_batch(jsonb) is missing';
  end if;

  select lower(pg_get_functiondef('boy_central.upsert_import_batch(jsonb)'::regprocedure))
  into definition;

  if position('counts.total_count > 0 and counts.valid_count = counts.total_count' in definition) = 0 then
    raise exception 'import batches are not guarded by explicit all-valid approval';
  end if;

  if position('validation_status = ''valid''' in definition) = 0
    or position('else ''needs_review''' in definition) = 0 then
    raise exception 'pending or warning import rows can still be approved implicitly';
  end if;

  if position('on conflict (company_id, source_system, idempotency_key)' in definition) = 0 then
    raise exception 'import idempotency behavior was not preserved';
  end if;

  if position('authentication required' in definition) = 0
    or position('company access denied' in definition) = 0
    or position('branch access denied' in definition) = 0 then
    raise exception 'import authorization checks were not preserved';
  end if;

  if has_function_privilege('anon','boy_central.upsert_import_batch(jsonb)','execute') then
    raise exception 'anon unexpectedly can execute upsert_import_batch';
  end if;

  if not has_function_privilege('authenticated','boy_central.upsert_import_batch(jsonb)','execute')
    or not has_function_privilege('service_role','boy_central.upsert_import_batch(jsonb)','execute') then
    raise exception 'expected import RPC grants are missing';
  end if;

  raise notice 'import pending approval guard contract passed';
end
$$;
