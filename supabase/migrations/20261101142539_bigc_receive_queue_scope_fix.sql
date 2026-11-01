-- Receive rounds share the daily workflow while retaining distinct receipt keys.
-- Use the existing authorized writer for validation, costing and stock reconciliation.
create or replace function boy_central.append_bigc_v2_receive(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
<<append_bigc_v2_receive>>
declare
  target_date date := (payload->>'business_date')::date;
  context jsonb;
  branch_id uuid;
  workflow_id uuid;
  old_lines jsonb := '[]'::jsonb;
  new_lines jsonb := '[]'::jsonb;
  entry jsonb;
  combined jsonb;
  result jsonb;
  seen_keys text[] := array[]::text[];
  seen_sources text[] := array[]::text[];
  receipt_key text;
  source_key text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if payload->>'workflow_type' is distinct from 'receive' or target_date is null then
    raise exception 'receive workflow and business_date required';
  end if;
  if jsonb_typeof(payload->'lines') is distinct from 'array'
    or jsonb_array_length(payload->'lines') = 0 then
    raise exception 'receive lines required';
  end if;
  -- This existing API checks both authentication and access to the BigC branch.
  context := boy_central.get_bigc_v2_context(target_date);
  branch_id := (context->'branch'->>'id')::uuid;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'bigc-receive:' || branch_id::text || ':' || target_date::text, 0));

  select w.id into workflow_id from boy_central.bigc_workflows w
    where w.branch_id = append_bigc_v2_receive.branch_id
      and w.business_date = target_date and w.workflow_type = 'receive'
      and w.status <> 'voided';
  select coalesce(jsonb_agg(to_jsonb(l) order by l.sort_order, l.line_key), '[]'::jsonb)
    into old_lines from boy_central.bigc_workflow_lines l
    where l.workflow_id = append_bigc_v2_receive.workflow_id;
  select coalesce(array_agg(x->>'line_key'), array[]::text[]),
    coalesce(array_agg(coalesce(nullif(x->>'source_line_key',''),
      case when x->>'line_key' not like 'receipt-%' then x->>'line_key' end))
      filter (where coalesce(nullif(x->>'source_line_key',''),
        case when x->>'line_key' not like 'receipt-%' then x->>'line_key' end) is not null),
      array[]::text[])
    into seen_keys, seen_sources from jsonb_array_elements(old_lines) x;

  for entry in select value from jsonb_array_elements(payload->'lines') loop
    receipt_key := entry->>'line_key';
    source_key := nullif(entry->>'source_line_key','');
    if receipt_key is null or receipt_key !~ '^receipt-[0-9a-f-]{36}$' then
      raise exception 'unique receipt key required';
    end if;
    perform substring(receipt_key from 9)::uuid;
    if trim(coalesce(entry->>'item_name','')) = ''
      or coalesce((entry->>'quantity')::numeric,0) <= 0 then
      raise exception 'item name and positive quantity required';
    end if;
    -- Retrying the same receipt or receiving the same ordered line on two
    -- devices must not add its quantity twice. Manual additions have no source.
    if receipt_key = any(seen_keys)
      or (source_key is not null and source_key = any(seen_sources)) then continue; end if;
    seen_keys := array_append(seen_keys, receipt_key);
    if source_key is not null then seen_sources := array_append(seen_sources, source_key); end if;
    new_lines := new_lines || jsonb_build_array(entry || jsonb_build_object(
      'sort_order', jsonb_array_length(old_lines) + jsonb_array_length(new_lines),
      'received', true));
  end loop;
  combined := payload || jsonb_build_object('lines', old_lines || new_lines);
  if jsonb_array_length(new_lines) > 0 then
    result := boy_central.save_bigc_v2_workflow(combined);
    workflow_id := (result->>'workflow_id')::uuid;
  else
    result := jsonb_build_object('status','saved','workflow_id',workflow_id,'duplicate',true);
  end if;
  return result || jsonb_build_object('mirror_payload', combined);
end;
$$;
revoke all on function boy_central.append_bigc_v2_receive(jsonb) from public, anon;
grant execute on function boy_central.append_bigc_v2_receive(jsonb) to authenticated;
notify pgrst, 'reload schema';
