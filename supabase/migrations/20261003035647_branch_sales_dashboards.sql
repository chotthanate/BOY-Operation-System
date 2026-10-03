create or replace function boy_central_private.get_branch_dashboard(
  target_branch_code text,
  date_from date,
  date_to date
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
  target_branch boy_central.branches%rowtype;
  range_start timestamptz;
  range_end timestamptz;
  result jsonb;
begin
  if actor_id is null then raise exception 'authentication required'; end if;
  if date_from is null or date_to is null or date_from > date_to then raise exception 'invalid date range'; end if;
  if date_to - date_from > 366 then raise exception 'date range must not exceed 366 days'; end if;

  select p.company_id into target_company_id
  from boy_central.profiles p
  where p.user_id = actor_id and p.active;
  if target_company_id is null then raise exception 'company access required'; end if;

  select b.* into target_branch
  from boy_central.branches b
  where b.company_id = target_company_id and b.code = target_branch_code
  limit 1;
  if target_branch.id is null then raise exception 'branch not found'; end if;
  if not boy_central_private.has_branch_access(target_branch.id, null) then raise exception 'branch access denied'; end if;

  range_start := date_from::timestamp at time zone 'Asia/Bangkok';
  range_end := (date_to + 1)::timestamp at time zone 'Asia/Bangkok';

  with
  paid_orders as (
    select o.*
    from boy_central.pos_orders o
    where o.branch_id = target_branch.id
      and o.payment_status in ('completed','paid')
      and o.voided_at is null
      and o.ordered_at >= range_start and o.ordered_at < range_end
  ),
  void_orders as (
    select o.*
    from boy_central.pos_orders o
    where o.branch_id = target_branch.id
      and (o.payment_status = 'voided' or o.voided_at is not null)
      and o.ordered_at >= range_start and o.ordered_at < range_end
  ),
  expense_rows as (
    select t.*
    from boy_central.transactions t
    where t.branch_id = target_branch.id
      and t.transaction_type = 'expense'
      and t.status = 'confirmed'
      and t.transaction_date between date_from and date_to
  ),
  sales_totals as (
    select coalesce(sum(total_amount),0) revenue,
      coalesce(sum(subtotal),0) subtotal,
      coalesce(sum(discount),0) discount,
      count(*) order_count,
      coalesce(avg(total_amount),0) average_order
    from paid_orders
  ),
  expense_totals as (
    select coalesce(sum(total_amount),0) expense, count(*) expense_count from expense_rows
  ),
  daily as (
    select d::date sales_date,
      coalesce(s.revenue,0) revenue,
      coalesce(s.order_count,0) order_count,
      coalesce(e.expense,0) expense
    from generate_series(date_from,date_to,interval '1 day') d
    left join lateral (
      select sum(o.total_amount) revenue,count(*) order_count
      from paid_orders o where (o.ordered_at at time zone 'Asia/Bangkok')::date=d::date
    ) s on true
    left join lateral (
      select sum(t.total_amount) expense from expense_rows t where t.transaction_date=d::date
    ) e on true
  ),
  payment_rows as (
    select case lower(coalesce(payment_method,''))
      when 'cash' then 'cash'
      when 'transfer' then 'transfer'
      when 'thai_chuay_thai' then 'government'
      when 'thai_co_pay' then 'government'
      when 'government' then 'government'
      else 'other' end method,
      sum(total_amount) amount,count(*) order_count
    from paid_orders group by 1
  ),
  channel_rows as (
    select coalesce(nullif(sales_channel,''),'store') channel,
      sum(total_amount) amount,count(*) order_count
    from paid_orders group by 1
  ),
  product_rows as (
    select l.item_name,
      sum(l.quantity) quantity,
      sum(l.line_total) revenue,
      count(distinct l.pos_order_id) order_count
    from boy_central.pos_order_lines l join paid_orders o on o.id=l.pos_order_id
    group by l.item_name order by sum(l.quantity) desc,sum(l.line_total) desc limit 20
  ),
  hour_rows as (
    select extract(hour from ordered_at at time zone 'Asia/Bangkok')::integer as sale_hour,
      sum(total_amount) revenue,count(*) order_count
    from paid_orders group by 1 order by 1
  ),
  expense_categories as (
    select coalesce(c.name,'ไม่ระบุหมวด') category,
      sum(tl.line_total) amount,count(distinct tl.transaction_id) transaction_count
    from boy_central.transaction_lines tl
    join expense_rows t on t.id=tl.transaction_id
    left join boy_central.categories c on c.id=tl.category_id
    group by 1 order by sum(tl.line_total) desc limit 12
  ),
  recent_orders as (
    select o.order_no,o.ordered_at,o.payment_method,o.total_amount,o.discount,
      (select sum(l.quantity) from boy_central.pos_order_lines l where l.pos_order_id=o.id) item_count
    from paid_orders o order by o.ordered_at desc limit 30
  ),
  available as (
    select min(x.activity_date) first_date,max(x.activity_date) last_date from (
      select (o.ordered_at at time zone 'Asia/Bangkok')::date activity_date
      from boy_central.pos_orders o where o.branch_id=target_branch.id and o.payment_status in ('completed','paid') and o.voided_at is null
      union all
      select t.transaction_date from boy_central.transactions t where t.branch_id=target_branch.id and t.transaction_type='expense' and t.status='confirmed'
    ) x
  )
  select jsonb_build_object(
    'generatedAt',now(),'source','supabase','dateFrom',date_from,'dateTo',date_to,
    'branch',jsonb_build_object('id',target_branch.id,'code',target_branch.code,'name',target_branch.name,'active',target_branch.active),
    'available',jsonb_build_object('from',available.first_date,'to',available.last_date),
    'totals',jsonb_build_object(
      'revenue',sales_totals.revenue,'subtotal',sales_totals.subtotal,'discount',sales_totals.discount,
      'orders',sales_totals.order_count,'averageOrder',sales_totals.average_order,
      'voidOrders',(select count(*) from void_orders),'expenses',expense_totals.expense,
      'expenseTransactions',expense_totals.expense_count,'net',sales_totals.revenue-expense_totals.expense
    ),
    'daily',coalesce((select jsonb_agg(jsonb_build_object('date',sales_date,'revenue',revenue,'orders',order_count,'expenses',expense,'net',revenue-expense) order by sales_date) from daily),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(payment_rows) order by amount desc) from payment_rows),'[]'::jsonb),
    'channels',coalesce((select jsonb_agg(to_jsonb(channel_rows) order by amount desc) from channel_rows),'[]'::jsonb),
    'products',coalesce((select jsonb_agg(to_jsonb(product_rows) order by quantity desc,revenue desc) from product_rows),'[]'::jsonb),
    'hours',coalesce((select jsonb_agg(to_jsonb(hour_rows) order by sale_hour) from hour_rows),'[]'::jsonb),
    'expenseCategories',coalesce((select jsonb_agg(to_jsonb(expense_categories) order by amount desc) from expense_categories),'[]'::jsonb),
    'recentOrders',coalesce((select jsonb_agg(to_jsonb(recent_orders) order by ordered_at desc) from recent_orders),'[]'::jsonb)
  ) into result
  from sales_totals cross join expense_totals cross join available;
  return result;
end;
$$;

revoke all on function boy_central_private.get_branch_dashboard(text,date,date) from public,anon;
grant execute on function boy_central_private.get_branch_dashboard(text,date,date) to authenticated;

create or replace function boy_central.get_branch_dashboard(target_branch_code text,date_from date,date_to date)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$ select boy_central_private.get_branch_dashboard(target_branch_code,date_from,date_to) $$;

revoke all on function boy_central.get_branch_dashboard(text,date,date) from public,anon;
grant execute on function boy_central.get_branch_dashboard(text,date,date) to authenticated;

notify pgrst,'reload schema';
