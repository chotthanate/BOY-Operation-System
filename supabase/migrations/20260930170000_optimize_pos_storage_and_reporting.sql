-- Keep normalized POS rows as the source of truth. Large device snapshots and
-- image blobs belong in the POS local database, not in Postgres JSON payloads.

create or replace function boy_central_private.trim_pos_raw_payload()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.raw_payload := '{}'::jsonb;
  return new;
end;
$$;

drop trigger if exists trim_pos_order_raw_payload on boy_central.pos_orders;
create trigger trim_pos_order_raw_payload
before insert or update of raw_payload on boy_central.pos_orders
for each row execute function boy_central_private.trim_pos_raw_payload();

drop trigger if exists trim_pos_shift_raw_payload on boy_central.pos_shifts;
create trigger trim_pos_shift_raw_payload
before insert or update of raw_payload on boy_central.pos_shifts
for each row execute function boy_central_private.trim_pos_raw_payload();

update boy_central.pos_orders
set raw_payload = '{}'::jsonb
where raw_payload <> '{}'::jsonb;

update boy_central.pos_shifts
set raw_payload = '{}'::jsonb
where raw_payload <> '{}'::jsonb;

create or replace function boy_central.get_dashboard_daily(target_date date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_company_id uuid;
  day_start timestamptz;
  day_end timestamptz;
  result jsonb;
begin
  select p.company_id into target_company_id
  from boy_central.profiles p
  where p.user_id = actor_id and p.active;
  if target_company_id is null then raise exception 'company access required'; end if;

  day_start := target_date::timestamp at time zone 'Asia/Bangkok';
  day_end := (target_date + 1)::timestamp at time zone 'Asia/Bangkok';

  with branch_rows as (
    select b.id, b.code, b.name,
      coalesce(s.income, 0) as income,
      coalesce(s.cash, 0) as cash,
      coalesce(s.transfer, 0) as transfer,
      coalesce(s.government, 0) as government,
      coalesce(s.other, 0) as other,
      coalesce(e.expense, 0) as expense,
      coalesce(r.pending_reimbursement, 0) as pending_reimbursement
    from boy_central.branches b
    left join lateral (
      select
        coalesce(sum(o.total_amount), 0) as income,
        coalesce(sum(o.total_amount) filter (where lower(coalesce(o.payment_method,'')) = 'cash'), 0) as cash,
        coalesce(sum(o.total_amount) filter (where lower(coalesce(o.payment_method,'')) = 'transfer'), 0) as transfer,
        coalesce(sum(o.total_amount) filter (where lower(coalesce(o.payment_method,'')) in ('thai_chuay_thai','thai_co_pay','government')), 0) as government,
        coalesce(sum(o.total_amount) filter (where lower(coalesce(o.payment_method,'')) not in ('cash','transfer','thai_chuay_thai','thai_co_pay','government')), 0) as other
      from boy_central.pos_orders o
      where o.branch_id = b.id and o.voided_at is null
        and o.payment_status in ('completed','paid')
        and o.ordered_at >= day_start and o.ordered_at < day_end
    ) s on true
    left join lateral (
      select coalesce(sum(t.total_amount), 0) as expense
      from boy_central.transactions t
      where t.branch_id = b.id and t.transaction_type = 'expense'
        and t.status = 'confirmed' and t.transaction_date = target_date
    ) e on true
    left join lateral (
      select coalesce(sum(p.amount), 0) as pending_reimbursement
      from boy_central.payments p
      join boy_central.transactions t on t.id = p.transaction_id
      where t.branch_id = b.id and t.transaction_type = 'expense'
        and p.method = 'reimbursement_pending' and p.status = 'pending'
    ) r on true
    where b.company_id = target_company_id and b.active
  ), totals as (
    select coalesce(sum(income),0) income, coalesce(sum(expense),0) expense,
      coalesce(sum(pending_reimbursement),0) pending_reimbursement
    from branch_rows
  )
  select jsonb_build_object(
    'date', target_date,
    'generatedAt', now(),
    'source', 'supabase',
    'totals', jsonb_build_object(
      'income', totals.income,
      'expense', totals.expense,
      'net', totals.income - totals.expense,
      'pending_reimbursement', totals.pending_reimbursement
    ),
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', br.id, 'code', br.code, 'name', br.name,
        'income', br.income, 'cash', br.cash, 'transfer', br.transfer,
        'government', br.government, 'other', br.other,
        'expense', br.expense, 'net', br.income - br.expense,
        'details', jsonb_build_array(
          jsonb_build_object('label','เงินสด','amount',br.cash),
          jsonb_build_object('label','เงินโอน','amount',br.transfer),
          jsonb_build_object('label','ไทยช่วยไทย','amount',br.government),
          jsonb_build_object('label','ช่องทางอื่น','amount',br.other)
        )
      ) order by br.name) from branch_rows br
    ), '[]'::jsonb)
  ) into result
  from totals;
  return result;
end;
$$;

create or replace function boy_central.get_dashboard_monthly(target_year integer, target_month integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_company_id uuid;
  month_start date;
  month_end date;
  result jsonb;
begin
  select p.company_id into target_company_id
  from boy_central.profiles p
  where p.user_id = actor_id and p.active;
  if target_company_id is null then raise exception 'company access required'; end if;
  if target_month < 1 or target_month > 12 then raise exception 'invalid month'; end if;

  month_start := make_date(target_year, target_month, 1);
  month_end := (month_start + interval '1 month')::date;

  with sales_by_day as (
    select (o.ordered_at at time zone 'Asia/Bangkok')::date as sales_date,
      sum(o.total_amount) as income
    from boy_central.pos_orders o
    join boy_central.branches b on b.id = o.branch_id
    where b.company_id = target_company_id and o.voided_at is null
      and o.payment_status in ('completed','paid')
      and o.ordered_at >= month_start::timestamp at time zone 'Asia/Bangkok'
      and o.ordered_at < month_end::timestamp at time zone 'Asia/Bangkok'
    group by 1
  ), expense_total as (
    select coalesce(sum(t.total_amount),0) as expense
    from boy_central.transactions t
    where t.company_id = target_company_id and t.transaction_type = 'expense'
      and t.status = 'confirmed' and t.transaction_date >= month_start and t.transaction_date < month_end
  ), sales_total as (
    select coalesce(sum(income),0) as income from sales_by_day
  )
  select jsonb_build_object(
    'year', target_year, 'month', target_month, 'source', 'supabase',
    'summary', jsonb_build_object(
      'income', sales_total.income,
      'expense', expense_total.expense,
      'profit', sales_total.income - expense_total.expense,
      'rawMaterialExpense', expense_total.expense
    ),
    'dailyIncome', coalesce((select jsonb_agg(jsonb_build_object(
      'day', extract(day from sales_date)::integer,
      'label', 'วันที่ ' || extract(day from sales_date)::integer,
      'total', income
    ) order by sales_date) from sales_by_day), '[]'::jsonb)
  ) into result from sales_total cross join expense_total;
  return result;
end;
$$;

create or replace function boy_central.get_pos_order_history(
  target_branch_code text default null,
  before_ordered_at timestamptz default null,
  before_id uuid default null,
  page_size integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_company_id uuid;
  safe_page_size integer := least(greatest(coalesce(page_size,30),1),50);
  result jsonb;
begin
  select p.company_id into target_company_id
  from boy_central.profiles p where p.user_id = actor_id and p.active;
  if target_company_id is null then raise exception 'company access required'; end if;

  with page as (
    select o.id, o.branch_id, b.code branch_code, b.name branch_name,
      o.order_no, o.payment_method, o.total_amount, o.payment_status,
      o.ordered_at, o.voided_at,
      (select count(*) from boy_central.pos_order_lines l where l.pos_order_id=o.id) line_count
    from boy_central.pos_orders o
    join boy_central.branches b on b.id=o.branch_id
    where o.company_id=target_company_id
      and (target_branch_code is null or b.code=target_branch_code)
      and (before_ordered_at is null or (o.ordered_at,o.id) < (before_ordered_at,coalesce(before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by o.ordered_at desc,o.id desc
    limit safe_page_size
  )
  select jsonb_build_object(
    'items',coalesce(jsonb_agg(to_jsonb(page) order by ordered_at desc,id desc),'[]'::jsonb),
    'next_cursor',case when count(*)=safe_page_size then jsonb_build_object(
      'ordered_at',(array_agg(ordered_at order by ordered_at desc,id desc))[count(*)::integer],
      'id',(array_agg(id order by ordered_at desc,id desc))[count(*)::integer]
    ) else null end
  ) into result from page;
  return result;
end;
$$;

create or replace function boy_central.get_system_capacity_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_company_id uuid;
  database_bytes bigint;
  free_limit_bytes bigint := 500 * 1024 * 1024;
  result jsonb;
begin
  select p.company_id into target_company_id
  from boy_central.profiles p
  where p.user_id=actor_id and p.active and p.company_role='admin';
  if target_company_id is null then raise exception 'admin access required'; end if;
  select pg_database_size(current_database()) into database_bytes;
  select jsonb_build_object(
    'database_bytes',database_bytes,
    'free_limit_bytes',free_limit_bytes,
    'used_percent',round(database_bytes::numeric/free_limit_bytes*100,1),
    'level',case when database_bytes >= free_limit_bytes*.85 then 'danger'
                 when database_bytes >= free_limit_bytes*.75 then 'warning'
                 when database_bytes >= free_limit_bytes*.60 then 'notice' else 'ok' end,
    'measured_at',now(),
    'largest_relations',coalesce((select jsonb_agg(to_jsonb(r) order by r.total_bytes desc) from (
      select n.nspname || '.' || c.relname as relation,
        pg_total_relation_size(c.oid) as total_bytes
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('boy_central','public') and c.relkind in ('r','m')
      order by pg_total_relation_size(c.oid) desc limit 8
    ) r),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function boy_central.get_dashboard_daily(date) from public, anon;
revoke all on function boy_central.get_dashboard_monthly(integer,integer) from public, anon;
revoke all on function boy_central.get_pos_order_history(text,timestamptz,uuid,integer) from public, anon;
revoke all on function boy_central.get_system_capacity_snapshot() from public, anon;
grant execute on function boy_central.get_dashboard_daily(date) to authenticated;
grant execute on function boy_central.get_dashboard_monthly(integer,integer) to authenticated;
grant execute on function boy_central.get_pos_order_history(text,timestamptz,uuid,integer) to authenticated;
grant execute on function boy_central.get_system_capacity_snapshot() to authenticated;

notify pgrst, 'reload schema';
