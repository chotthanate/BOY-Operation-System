-- Daily close totals are revenue, not POS order counts. Prefer actual POS sales
-- on days where a BigC branch has POS data, to avoid counting both sources.
create or replace function boy_central_private.bigc_manual_revenue(target_branch uuid,date_from date,date_to date)
returns table(business_date date,cash numeric,transfer numeric,government numeric)
language sql stable security definer set search_path='' as $$
  select w.business_date,sum(w.cash_amount),sum(w.transfer_amount),sum(w.thai_chuay_thai_amount)
  from boy_central.bigc_workflows w join boy_central.branches b on b.id=w.branch_id
  where w.branch_id=target_branch and b.code in ('BIGC-CENTRAL-PATTAYA','BIGC-SOUTH-PATTAYA')
    and w.workflow_type='return' and w.status='submitted' and w.business_date between date_from and date_to
    and not exists(select 1 from boy_central.pos_orders o where o.branch_id=w.branch_id
      and o.voided_at is null and o.payment_status in ('completed','paid')
      and o.ordered_at >= w.business_date::timestamp at time zone 'Asia/Bangkok'
      and o.ordered_at < (w.business_date+1)::timestamp at time zone 'Asia/Bangkok')
  group by w.business_date
$$;
revoke all on function boy_central_private.bigc_manual_revenue(uuid,date,date) from public,anon,authenticated;

alter function boy_central.get_dashboard_daily(date) rename to get_dashboard_daily_before_bigc_revenue;
revoke all on function boy_central.get_dashboard_daily_before_bigc_revenue(date) from public,anon,authenticated;
create function boy_central.get_dashboard_daily(target_date date default current_date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; rows jsonb:='[]'; br jsonb; r record; cost numeric; income numeric:=0; expenses numeric:=0;
begin
  result:=boy_central.get_dashboard_daily_before_bigc_revenue(target_date);
  for br in select value from jsonb_array_elements(result->'branches') loop
    select coalesce(sum(cash),0) cash,coalesce(sum(transfer),0) transfer,coalesce(sum(government),0) government
    into r from boy_central_private.bigc_manual_revenue((br->>'id')::uuid,target_date,target_date);
    select coalesce(sum(case when a.source_branch_id=(br->>'id')::uuid then a.source_branch_cost_delta else a.target_branch_cost_delta end),0)
    into cost from boy_central.branch_cost_allocations a join boy_central.bigc_workflows w on w.id=a.workflow_id
    where w.business_date=target_date and w.status='submitted' and a.cost_status in ('provisional','final','reversed')
      and ((br->>'id')::uuid=a.source_branch_id or (br->>'id')::uuid=a.target_branch_id);
    br:=br||jsonb_build_object('cash',(br->>'cash')::numeric+r.cash,'transfer',(br->>'transfer')::numeric+r.transfer,
      'government',(br->>'government')::numeric+r.government,'income',(br->>'income')::numeric+r.cash+r.transfer+r.government,
      'expense',(br->>'expense')::numeric+cost);
    br:=br||jsonb_build_object('net',(br->>'income')::numeric-(br->>'expense')::numeric,'details',jsonb_build_array(
      jsonb_build_object('label','เงินสด','amount',(br->>'cash')::numeric),jsonb_build_object('label','เงินโอน','amount',(br->>'transfer')::numeric),
      jsonb_build_object('label','ไทยช่วยไทย','amount',(br->>'government')::numeric),jsonb_build_object('label','ช่องทางอื่น','amount',(br->>'other')::numeric)));
    income:=income+(br->>'income')::numeric; expenses:=expenses+(br->>'expense')::numeric;
    rows:=rows||jsonb_build_array(br);
  end loop;
  return result||jsonb_build_object('branches',rows,'totals',(result->'totals')||jsonb_build_object('income',income,'expense',expenses,'net',income-expenses));
end $$;
revoke all on function boy_central.get_dashboard_daily(date) from public,anon;
grant execute on function boy_central.get_dashboard_daily(date) to authenticated;

alter function boy_central.get_dashboard_monthly(integer,integer) rename to get_dashboard_monthly_before_bigc_revenue;
revoke all on function boy_central.get_dashboard_monthly_before_bigc_revenue(integer,integer) from public,anon,authenticated;
create function boy_central.get_dashboard_monthly(target_year integer,target_month integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; first_day date; last_day date; actor_company uuid; extra numeric; daily jsonb;
begin
  result:=boy_central.get_dashboard_monthly_before_bigc_revenue(target_year,target_month);
  select company_id into actor_company from boy_central.profiles where user_id=auth.uid() and active;
  first_day:=make_date(target_year,target_month,1); last_day:=(first_day+interval '1 month'-interval '1 day')::date;
  with amounts as (
    select (x->>'day')::integer day_number,(x->>'total')::numeric amount from jsonb_array_elements(result->'dailyIncome') x
    union all select extract(day from r.business_date)::integer,r.cash+r.transfer+r.government
      from boy_central.branches b cross join lateral boy_central_private.bigc_manual_revenue(b.id,first_day,last_day) r
      where b.company_id=actor_company
  ), grouped as (select day_number,sum(amount) amount from amounts group by day_number)
  select coalesce(jsonb_agg(jsonb_build_object('day',day_number,'label','วันที่ '||day_number,'total',amount) order by day_number),'[]') into daily from grouped;
  select coalesce(sum(r.cash+r.transfer+r.government),0) into extra
  from boy_central.branches b cross join lateral boy_central_private.bigc_manual_revenue(b.id,first_day,last_day) r where b.company_id=actor_company;
  return result||jsonb_build_object('dailyIncome',daily,'summary',(result->'summary')||jsonb_build_object(
    'income',(result#>>'{summary,income}')::numeric+extra,'profit',(result#>>'{summary,profit}')::numeric+extra));
end $$;
revoke all on function boy_central.get_dashboard_monthly(integer,integer) from public,anon;
grant execute on function boy_central.get_dashboard_monthly(integer,integer) to authenticated;

alter function boy_central_private.get_branch_dashboard(text,date,date) rename to get_branch_dashboard_before_bigc_revenue;
revoke all on function boy_central_private.get_branch_dashboard_before_bigc_revenue(text,date,date) from public,anon,authenticated;
create function boy_central_private.get_branch_dashboard(target_branch_code text,date_from date,date_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; target_branch uuid; extra numeric; daily jsonb; payments jsonb; first_day date; last_day date;
begin
  result:=boy_central_private.get_branch_dashboard_before_bigc_revenue(target_branch_code,date_from,date_to);
  target_branch:=(result#>>'{branch,id}')::uuid;
  select coalesce(sum(cash+transfer+government),0) into extra from boy_central_private.bigc_manual_revenue(target_branch,date_from,date_to);
  select coalesce(jsonb_agg(d||jsonb_build_object('revenue',(d->>'revenue')::numeric+coalesce(r.amount,0),
    'net',(d->>'net')::numeric+coalesce(r.amount,0)) order by d->>'date'),'[]') into daily
  from jsonb_array_elements(result->'daily') d left join lateral (
    select cash+transfer+government amount from boy_central_private.bigc_manual_revenue(target_branch,(d->>'date')::date,(d->>'date')::date)
  ) r on true;
  with values_ as (
    select p->>'method' method,(p->>'amount')::numeric amount,(p->>'order_count')::integer order_count from jsonb_array_elements(result->'payments') p
    union all select v.method,v.amount,0 from boy_central_private.bigc_manual_revenue(target_branch,date_from,date_to) r
      cross join lateral(values('cash',r.cash),('transfer',r.transfer),('government',r.government)) v(method,amount)
  ), grouped as (select method,sum(amount) amount,sum(order_count) order_count from values_ group by method having sum(amount)<>0)
  select coalesce(jsonb_agg(to_jsonb(grouped) order by amount desc),'[]') into payments from grouped;
  select min(business_date),max(business_date) into first_day,last_day from boy_central_private.bigc_manual_revenue(target_branch,'1900-01-01','2999-12-31');
  result:=result||jsonb_build_object('daily',daily,'payments',payments,'manualRevenue',extra,
    'totals',(result->'totals')||jsonb_build_object('revenue',(result#>>'{totals,revenue}')::numeric+extra,
      'subtotal',(result#>>'{totals,subtotal}')::numeric+extra,'net',(result#>>'{totals,net}')::numeric+extra));
  if first_day is not null then
    result:=jsonb_set(result,'{available}',jsonb_build_object('from',least((result#>>'{available,from}')::date,first_day),'to',greatest((result#>>'{available,to}')::date,last_day)));
  end if;
  return result;
end $$;
revoke all on function boy_central_private.get_branch_dashboard(text,date,date) from public,anon,authenticated;
-- Private helpers are not callable by clients. The public entrypoint performs
-- authorization inside the private implementation before returning any data.
create or replace function boy_central.get_branch_dashboard(target_branch_code text,date_from date,date_to date)
returns jsonb language sql stable security definer set search_path='' as $$
  select boy_central_private.get_branch_dashboard(target_branch_code,date_from,date_to)
$$;
revoke all on function boy_central.get_branch_dashboard(text,date,date) from public,anon;
grant execute on function boy_central.get_branch_dashboard(text,date,date) to authenticated;
notify pgrst,'reload schema';
