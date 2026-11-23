-- Applied production migration version: 20261123232307.
-- Home is a read-only projection: no draft, submission, or stock writes.
-- Keep amounts aligned to the existing daily dashboard while disclosing only
-- branches the requesting account can access and only metadata about drafts.
create function boy_central_private.get_operation_home() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  actor_company uuid;
  snapshot_at timestamptz := now();
  day date := (snapshot_at at time zone 'Asia/Bangkok')::date;
  day_start timestamptz := day::timestamp at time zone 'Asia/Bangkok';
  day_end timestamptz := (day + 1)::timestamp at time zone 'Asia/Bangkok';
  recent_start timestamptz := snapshot_at - interval '30 days';
  finance_active boolean;
  dashboard jsonb;
  result jsonb;
begin
  select company_id into actor_company from boy_central.profiles
  where actor is not null and user_id = actor and active
    and employee_code is distinct from 'BIGC-SHARED-STAFF';
  if actor_company is null then
    raise exception 'ไม่มีสิทธิ์เปิดหน้าหลัก' using errcode = '42501';
  end if;

  finance_active := boy_central.daily_finance_active();
  dashboard := boy_central.get_dashboard_daily(day);

  with scoped as materialized (
    select b.id,b.code,b.name,p.mode,p.effective_date,
      boy_central_private.has_branch_access(b.id,array['admin','manager','staff']) as can_enter_expenses
    from boy_central.branches b
    left join boy_central.branch_revenue_policies p on p.branch_id = b.id
    where b.company_id = actor_company and b.active
      and b.code in ('TAWANA','BIGC-CENTRAL-PATTAYA','BIGC-SOUTH-PATTAYA','BURGER','GRILL')
      and boy_central_private.has_branch_access(b.id,null)
  ), daily as materialized (
    select s.*, (d.row->>'income')::numeric as income, (d.row->>'expense')::numeric as expense,
      case
        when finance_active and s.effective_date <= day then
          case when exists (
            select 1 from boy_central.financial_closes c
            where c.company_id = actor_company and c.branch_id = s.id
              and c.business_date = day and c.source_type = s.mode
          ) then 'recorded'
          when s.mode = 'manual' then 'awaiting_manual'
          else 'awaiting_shift' end
        when exists (
          select 1 from boy_central.pos_orders o
          where o.company_id = actor_company and o.branch_id = s.id
            and o.voided_at is null and o.payment_status in ('completed','paid')
            and o.ordered_at >= day_start and o.ordered_at < day_end
        ) or exists (
          select 1 from boy_central_private.bigc_manual_revenue(s.id,day,day)
          where s.code in ('BIGC-CENTRAL-PATTAYA','BIGC-SOUTH-PATTAYA')
        ) then 'recorded'
        else 'no_sales'
      end as sales_status
    from scoped s
    join jsonb_array_elements(dashboard->'branches') d(row) on d.row->>'id' = s.id::text
  ), summaries as (
    select d.code,d.name,
      case when d.sales_status = 'recorded' then d.income end as sales,
      d.sales_status,d.can_enter_expenses,
      coalesce(draft.line_count,0) as draft_count,
      case when draft.line_count > 0 and draft.posting_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        then draft.posting_date end as draft_date,
      (select count(*) from boy_central.purchase_receipts r
        where r.company_id = actor_company and r.branch_id = d.id and r.status = 'pending') as receipts,
      case when d.can_enter_expenses then (
        select count(*) from boy_central.payments p join boy_central.transactions t on t.id = p.transaction_id
        where t.company_id = actor_company and t.branch_id = d.id
          and t.transaction_type = 'expense' and t.status = 'confirmed'
          and p.method = 'reimbursement_pending' and p.status = 'pending'
      ) else 0 end as reimbursements
    from daily d
    left join lateral (
      select dr.payload->>'date' as posting_date, (
        select count(*) from jsonb_array_elements(case when jsonb_typeof(dr.payload->'lines') = 'array'
          then dr.payload->'lines' else '[]'::jsonb end) l(line)
        where exists (
          select 1 from unnest(array['description','quantity','line_total','supplier_name','note',
            'item_id','expense_item_id','category_id','subcategory_id','unit_id','project_name','investment_category']) fields(key)
          where (l.line->>fields.key) ~ '[^[:space:]]'
        )
        or l.line->'is_investment' = 'true'::jsonb
        or coalesce(l.line->>'payment_method','') not in ('','cash')
        or coalesce(l.line->>'receiving_mode','') not in ('','immediate')
      ) as line_count
      from boy_central.expense_entry_drafts dr
      where dr.branch_id = d.id and dr.company_id = actor_company and d.can_enter_expenses
    ) draft on true
  ), expense_events as (
    select 'expense' as kind,s.code as branch_code,t.id,t.created_at as at,t.transaction_date as date,t.total_amount as amount
    from scoped s join boy_central.transactions t on t.branch_id = s.id
    where t.company_id = actor_company and t.transaction_type = 'expense' and t.status = 'confirmed'
      and t.accounting_class = 'operating' and t.created_at >= recent_start and t.created_at <= snapshot_at
    order by t.created_at desc,t.id desc limit 5
  ), close_events as (
    select case when c.source_type = 'manual' then 'income' else 'shift' end as kind,s.code as branch_code,
      c.id,c.updated_at as at,c.business_date as date,c.cash + c.transfer + c.government + c.other as amount
    from scoped s join boy_central.financial_closes c on c.branch_id = s.id
    where c.company_id = actor_company and c.source_type = s.mode
      and c.updated_at >= recent_start and c.updated_at <= snapshot_at
    order by c.updated_at desc,c.id desc limit 5
  ), receipt_events as (
    select 'receipt' as kind,s.code as branch_code,r.id,r.received_at as at,(r.received_at at time zone 'Asia/Bangkok')::date as date,
      null::numeric as amount
    from scoped s join boy_central.purchase_receipts r on r.branch_id = s.id
    where r.company_id = actor_company and r.status = 'received'
      and r.received_at >= recent_start and r.received_at <= snapshot_at
    order by r.received_at desc,r.id desc limit 5
  ), recent as (
    select * from (select * from expense_events union all select * from close_events union all select * from receipt_events) e
    order by e.at desc,e.id desc limit 5
  )
  select jsonb_build_object(
    'date',day,'generated_at',snapshot_at,
    'branches',coalesce((select jsonb_agg(to_jsonb(s) order by array_position(
      array['TAWANA','BIGC-CENTRAL-PATTAYA','BIGC-SOUTH-PATTAYA','BURGER','GRILL'],s.code)) from summaries s),'[]'::jsonb),
    'total_expenses',(select coalesce(sum(expense),0) from daily),
    'recent',coalesce((select jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object('kind',r.kind,'branch_code',r.branch_code,'at',r.at,'date',r.date,
        'amount',r.amount,'count',case when r.kind = 'expense' then (
          select count(*) from boy_central.transaction_lines l where l.transaction_id = r.id
        ) end)) order by r.at desc,r.id desc) from recent r),'[]'::jsonb)
  ) into result;
  return result;
end $$;

revoke all on function boy_central_private.get_operation_home() from public,anon;
grant execute on function boy_central_private.get_operation_home() to authenticated;

create function public.get_operation_home() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select boy_central_private.get_operation_home();
$$;
revoke all on function public.get_operation_home() from public,anon;
grant execute on function public.get_operation_home() to authenticated;
notify pgrst,'reload schema';
