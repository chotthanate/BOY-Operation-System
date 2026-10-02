create or replace function boy_central.admin_update_burger_master_v3(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_result jsonb;
  mapping_result jsonb;
  target_item uuid;
begin
  saved_result := boy_central.admin_update_burger_master_v2(payload);

  if payload->>'kind' = 'item' then
    target_item := coalesce(
      nullif(saved_result->>'id', '')::uuid,
      nullif(payload->>'id', '')::uuid
    );
    if target_item is null then
      raise exception 'saved item id is missing';
    end if;

    mapping_result := boy_central.admin_save_stock_mapping(jsonb_build_object(
      'branch_code', coalesce(nullif(payload->>'branch_code', ''), 'BURGER'),
      'source_item_id', target_item,
      'mode', coalesce(nullif(payload->>'stock_mode', ''), 'none'),
      'target_item_id', nullif(payload->>'stock_target_item_id', ''),
      'conversion_to_target', coalesce(nullif(payload->>'conversion_to_base', ''), '1')
    ));
  end if;

  return saved_result || jsonb_build_object('stock_mapping', mapping_result);
end;
$$;

revoke all on function boy_central.admin_update_burger_master_v3(jsonb) from public, anon;
grant execute on function boy_central.admin_update_burger_master_v3(jsonb) to authenticated;

create or replace function boy_central.admin_bulk_save_stock_tracking(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_company uuid;
  change_row jsonb;
  saved_count integer := 0;
begin
  select p.company_id into actor_company
  from boy_central.profiles p
  where p.user_id = actor_id and p.active and p.company_role = 'admin';
  if actor_company is null then raise exception 'admin access required'; end if;
  if jsonb_typeof(coalesce(payload->'changes', '[]'::jsonb)) <> 'array' then
    raise exception 'changes must be an array';
  end if;

  for change_row in
    select value from jsonb_array_elements(coalesce(payload->'changes', '[]'::jsonb))
  loop
    perform boy_central.admin_save_stock_mapping(jsonb_build_object(
      'branch_code', payload->>'branch_code',
      'source_item_id', change_row->>'item_id',
      'mode', coalesce(nullif(change_row->>'mode', ''), 'none'),
      'target_item_id', nullif(change_row->>'target_item_id', ''),
      'conversion_to_target', coalesce(nullif(change_row->>'conversion_to_target', ''), '1')
    ));
    saved_count := saved_count + 1;
  end loop;

  return jsonb_build_object('status', 'saved', 'saved_count', saved_count);
end;
$$;

revoke all on function boy_central.admin_bulk_save_stock_tracking(jsonb) from public, anon;
grant execute on function boy_central.admin_bulk_save_stock_tracking(jsonb) to authenticated;

notify pgrst, 'reload schema';
