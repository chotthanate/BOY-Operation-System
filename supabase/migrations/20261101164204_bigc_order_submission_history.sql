-- Keep every confirmed order submission, even when a later order on the same
-- business date is added to the daily workflow used by the receiving screen.
create table boy_central_private.bigc_order_submissions (
  id uuid primary key,
  workflow_id uuid not null references boy_central.bigc_workflows(id),
  branch_id uuid not null references boy_central.branches(id),
  business_date date not null,
  submitted_at timestamptz not null default clock_timestamp(),
  submitted_by uuid not null references auth.users(id),
  lines jsonb not null check (jsonb_typeof(lines)='array' and jsonb_array_length(lines)>0),
  mirror_payload jsonb not null
);
alter table boy_central_private.bigc_order_submissions enable row level security;
revoke all on boy_central_private.bigc_order_submissions from public,anon,authenticated;
create index bigc_order_submissions_recent_idx
  on boy_central_private.bigc_order_submissions(branch_id,business_date desc,submitted_at desc);
create index bigc_order_submissions_workflow_idx
  on boy_central_private.bigc_order_submissions(workflow_id);
create index bigc_order_submissions_actor_idx
  on boy_central_private.bigc_order_submissions(submitted_by);

-- A stable submission UUID makes a retry harmless. The daily workflow remains
-- cumulative, so a second order cannot erase the first order's receiving list.
create function boy_central.append_bigc_v2_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  actor uuid:=auth.uid();
  target_branch boy_central.branches%rowtype;
  target_date date;
  submission_id uuid;
  previous boy_central_private.bigc_order_submissions%rowtype;
  old_line boy_central.bigc_workflow_lines%rowtype;
  new_line jsonb;
  old_value jsonb;
  line_key_value text;
  new_quantity numeric;
  merged_by_key jsonb:='{}'::jsonb;
  merged_lines jsonb;
  merged_payload jsonb;
  result jsonb;
begin
  if actor is null then raise exception 'authentication required'; end if;
  select * into target_branch from boy_central.branches
    where code='BIGC-CENTRAL-PATTAYA' and active;
  if target_branch.id is null or not boy_central_private.has_branch_access(
    target_branch.id,array['admin','manager','staff']) then
    raise exception 'branch access denied';
  end if;
  if payload->>'workflow_type' is distinct from 'close_order' then
    raise exception 'order submission required';
  end if;
  target_date:=nullif(payload->>'business_date','')::date;
  submission_id:=nullif(payload->>'submission_id','')::uuid;
  if target_date is null or submission_id is null or
    jsonb_typeof(payload->'lines') is distinct from 'array' or
    jsonb_array_length(payload->'lines')=0 then
    raise exception 'order date, submission ID and items are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    target_branch.id::text||':'||target_date::text||':bigc-order',0));
  select * into previous from boy_central_private.bigc_order_submissions
    where id=submission_id;
  if previous.id is not null then
    if previous.branch_id<>target_branch.id or previous.business_date<>target_date or
      previous.submitted_by<>actor or previous.lines<>payload->'lines' then
      raise exception 'submission ID was already used for a different order';
    end if;
    return jsonb_build_object('status','saved','workflow_id',previous.workflow_id,
      'submission_id',previous.id,'mirror_payload',previous.mirror_payload,
      'already_saved',true);
  end if;

  for old_line in select l.* from boy_central.bigc_workflow_lines l
    join boy_central.bigc_workflows w on w.id=l.workflow_id
    where w.branch_id=target_branch.id and w.business_date=target_date
      and w.workflow_type='close_order' and w.status='submitted'
    order by l.sort_order,l.line_key
  loop
    merged_by_key:=merged_by_key||jsonb_build_object(old_line.line_key,to_jsonb(old_line));
  end loop;
  for new_line in select value from jsonb_array_elements(payload->'lines') loop
    line_key_value:=trim(coalesce(new_line->>'line_key',''));
    new_quantity:=nullif(new_line->>'quantity','')::numeric;
    if line_key_value='' or new_quantity is null or new_quantity<=0 or
      trim(coalesce(new_line->>'item_name',''))='' then
      raise exception 'order contains an invalid item or quantity';
    end if;
    old_value:=merged_by_key->line_key_value;
    if old_value is not null then
      if coalesce(old_value->>'item_id','')<>coalesce(new_line->>'item_id','') or
        coalesce(old_value->>'unit_name','')<>coalesce(new_line->>'unit_name','') then
        raise exception 'item mapping or unit changed for %, review the existing order',
          new_line->>'item_name';
      end if;
      merged_by_key:=jsonb_set(merged_by_key,array[line_key_value,'quantity'],
        to_jsonb((old_value->>'quantity')::numeric+new_quantity));
    else
      merged_by_key:=merged_by_key||jsonb_build_object(line_key_value,new_line);
    end if;
  end loop;
  select jsonb_agg(value order by coalesce((value->>'sort_order')::integer,0),value->>'item_name')
    into merged_lines from jsonb_each(merged_by_key);
  merged_payload:=(payload-'submission_id')||jsonb_build_object('lines',merged_lines);
  result:=boy_central.save_bigc_v2_workflow(merged_payload);
  insert into boy_central_private.bigc_order_submissions
    (id,workflow_id,branch_id,business_date,submitted_by,lines,mirror_payload)
  values (submission_id,(result->>'workflow_id')::uuid,target_branch.id,target_date,
    actor,payload->'lines',merged_payload);
  return result||jsonb_build_object('submission_id',submission_id,
    'mirror_payload',merged_payload,'already_saved',false);
end
$function$;
revoke all on function boy_central.append_bigc_v2_order(jsonb) from public,anon;
grant execute on function boy_central.append_bigc_v2_order(jsonb) to authenticated;

create function boy_central.get_bigc_v2_order_history(max_rows integer default 30)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  target_branch boy_central.branches%rowtype;
  result jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into target_branch from boy_central.branches
    where code='BIGC-CENTRAL-PATTAYA' and active;
  if target_branch.id is null or not boy_central_private.has_branch_access(
    target_branch.id,array['admin','manager','staff']) then
    raise exception 'branch access denied';
  end if;
  with history as (
    select s.id,s.workflow_id,s.business_date,s.submitted_at,s.lines,false legacy
    from boy_central_private.bigc_order_submissions s
    join boy_central.bigc_workflows w on w.id=s.workflow_id
    where s.branch_id=target_branch.id and w.status='submitted'
    union all
    select w.id,w.id,w.business_date,w.submitted_at,
      coalesce((select jsonb_agg(jsonb_build_object(
        'line_key',l.line_key,'item_name',l.item_name,'category_name',l.category_name,
        'unit_name',l.unit_name,'quantity',l.quantity,'sort_order',l.sort_order)
        order by l.sort_order,l.item_name)
        from boy_central.bigc_workflow_lines l where l.workflow_id=w.id),'[]'::jsonb),true
    from boy_central.bigc_workflows w
    where w.branch_id=target_branch.id and w.workflow_type='close_order'
      and w.status='submitted' and not exists (
        select 1 from boy_central_private.bigc_order_submissions s
        where s.workflow_id=w.id)
  ), limited as (
    select * from history order by business_date desc,submitted_at desc,id desc
    limit least(greatest(coalesce(max_rows,30),1),50)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'workflow_id',workflow_id,'business_date',business_date,
    'submitted_at',submitted_at,'lines',lines,'legacy',legacy)
    order by business_date desc,submitted_at desc,id desc),'[]'::jsonb)
  into result from limited;
  return result;
end
$function$;
revoke all on function boy_central.get_bigc_v2_order_history(integer) from public,anon;
grant execute on function boy_central.get_bigc_v2_order_history(integer) to authenticated;
notify pgrst,'reload schema';
