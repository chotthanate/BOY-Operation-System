-- Branch dashboard expenses include BigC transfers without writing duplicate
-- purchase transactions. The company-wide cost delta remains zero.
alter function boy_central_private.get_branch_dashboard(text,date,date)
  rename to get_branch_dashboard_before_bigc_allocations;
revoke all on function boy_central_private.get_branch_dashboard_before_bigc_allocations(text,date,date)
  from public,anon,authenticated;

create function boy_central_private.get_branch_dashboard(
  target_branch_code text,date_from date,date_to date
) returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare
  result jsonb;
  branch_id_value uuid;
  transfer_total numeric(18,4);
  transfer_count integer;
  first_transfer_date date;
  last_transfer_date date;
  base_expense numeric;
  total_expense numeric;
  daily_rows jsonb;
begin
  -- The existing implementation checks actor, company, branch and date range.
  result:=boy_central_private.get_branch_dashboard_before_bigc_allocations(
    target_branch_code,date_from,date_to);
  branch_id_value:=(result->'branch'->>'id')::uuid;
  select coalesce(sum(case when a.source_branch_id=branch_id_value
      then a.source_branch_cost_delta else a.target_branch_cost_delta end),0),
    count(*)::integer,min(w.business_date),max(w.business_date)
  into transfer_total,transfer_count,first_transfer_date,last_transfer_date
  from boy_central.branch_cost_allocations a
  join boy_central.bigc_workflows w on w.id=a.workflow_id
  where w.business_date between date_from and date_to and w.status='submitted'
    and a.cost_status in ('provisional','final','reversed')
    and (a.source_branch_id=branch_id_value or a.target_branch_id=branch_id_value);

  base_expense:=coalesce((result#>>'{totals,expenses}')::numeric,0);
  total_expense:=base_expense+transfer_total;
  result:=jsonb_set(result,'{totals,expenses}',to_jsonb(total_expense));
  result:=jsonb_set(result,'{totals,net}',
    to_jsonb(coalesce((result#>>'{totals,revenue}')::numeric,0)-total_expense));
  result:=jsonb_set(result,'{totals,expenseTransactions}',
    to_jsonb(coalesce((result#>>'{totals,expenseTransactions}')::integer,0)+transfer_count));
  result:=result||jsonb_build_object('interbranchCosts',jsonb_build_object(
    'amount',transfer_total,'entries',transfer_count));

  select coalesce(jsonb_agg(d.value||jsonb_build_object(
    'expenses',coalesce((d.value->>'expenses')::numeric,0)+coalesce(x.amount,0),
    'net',coalesce((d.value->>'revenue')::numeric,0)
      -coalesce((d.value->>'expenses')::numeric,0)-coalesce(x.amount,0))
    order by d.ordinality),'[]'::jsonb)
  into daily_rows
  from jsonb_array_elements(coalesce(result->'daily','[]'::jsonb))
    with ordinality as d(value,ordinality)
  left join lateral (
    select sum(case when a.source_branch_id=branch_id_value
      then a.source_branch_cost_delta else a.target_branch_cost_delta end) amount
    from boy_central.branch_cost_allocations a
    join boy_central.bigc_workflows w on w.id=a.workflow_id
    where w.business_date=(d.value->>'date')::date and w.status='submitted'
      and a.cost_status in ('provisional','final','reversed')
      and (a.source_branch_id=branch_id_value or a.target_branch_id=branch_id_value)
  ) x on true;
  result:=jsonb_set(result,'{daily}',daily_rows);

  if transfer_count>0 then
    result:=jsonb_set(result,'{expenseCategories}',
      coalesce(result->'expenseCategories','[]'::jsonb)||jsonb_build_array(
        jsonb_build_object('category','โอนต้นทุน BigC/ทาวน่า',
          'amount',transfer_total,'transaction_count',transfer_count)));
    result:=jsonb_set(result,'{available,from}',to_jsonb(least(
      (result#>>'{available,from}')::date,first_transfer_date)));
    result:=jsonb_set(result,'{available,to}',to_jsonb(greatest(
      (result#>>'{available,to}')::date,last_transfer_date)));
  end if;
  return result;
end
$function$;
revoke all on function boy_central_private.get_branch_dashboard(text,date,date)
  from public,anon,authenticated;

create or replace function boy_central.get_branch_dashboard(
  target_branch_code text,date_from date,date_to date
) returns jsonb language sql stable security invoker set search_path=''
as $function$
  select boy_central_private.get_branch_dashboard(target_branch_code,date_from,date_to)
$function$;
revoke all on function boy_central.get_branch_dashboard(text,date,date) from public,anon;
grant execute on function boy_central.get_branch_dashboard(text,date,date) to authenticated;
notify pgrst,'reload schema';
