-- A receive date can have several independent order slips. Orders placed
-- after midnight but before 06:00 Bangkok time belong to that same morning.
-- The older daily order workflow is retained as one legacy slip.
create function boy_central.get_bigc_v2_receive_order_rounds(target_date date)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  target_branch boy_central.branches%rowtype;
  result jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if target_date is null then raise exception 'receive date required'; end if;
  select * into target_branch from boy_central.branches
    where code='BIGC-CENTRAL-PATTAYA' and active;
  if target_branch.id is null or not boy_central_private.has_branch_access(
    target_branch.id,array['admin','manager','staff']) then
    raise exception 'branch access denied';
  end if;

  with rounds as (
    select s.id,s.workflow_id,s.business_date,s.submitted_at,s.lines,false as legacy
    from boy_central_private.bigc_order_submissions s
    join boy_central.bigc_workflows w on w.id=s.workflow_id
    where s.branch_id=target_branch.id and w.status='submitted'
      and least(s.business_date+1,
        (s.submitted_at at time zone 'Asia/Bangkok')::date
          + case when extract(hour from s.submitted_at at time zone 'Asia/Bangkok')<6
            then 0 else 1 end) = target_date
    union all
    select w.id,w.id,w.business_date,w.submitted_at,
      coalesce((select jsonb_agg(jsonb_build_object(
        'line_key',l.line_key,'item_id',l.item_id,'master_item_id',l.master_item_id,
        'item_name',l.item_name,'category_name',l.category_name,
        'unit_name',l.unit_name,'input_mode',l.input_mode,
        'quantity',l.quantity,'sort_order',l.sort_order)
        order by l.sort_order,l.item_name)
        from boy_central.bigc_workflow_lines l
        where l.workflow_id=w.id and l.quantity>0),'[]'::jsonb),true
    from boy_central.bigc_workflows w
    where w.branch_id=target_branch.id and w.workflow_type='close_order'
      and w.status='submitted' and w.business_date=target_date-1
      and not exists (select 1 from boy_central_private.bigc_order_submissions s
        where s.workflow_id=w.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'workflow_id',workflow_id,'business_date',business_date,
    'submitted_at',submitted_at,'lines',lines,'legacy',legacy)
    order by submitted_at desc,id desc),'[]'::jsonb)
    into result from rounds;
  return result;
end
$function$;
revoke all on function boy_central.get_bigc_v2_receive_order_rounds(date) from public,anon;
grant execute on function boy_central.get_bigc_v2_receive_order_rounds(date) to authenticated;
notify pgrst,'reload schema';
