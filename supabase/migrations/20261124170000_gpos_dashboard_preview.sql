-- GPOS numbers are display-only snapshots; they never enter accounting tables.
create table if not exists boy_central.gpos_dashboard_snapshots (
  branch_code text not null default 'BIGC-CENTRAL-PATTAYA',
  business_date date not null,
  net_sales numeric(14,2) not null check (net_sales >= 0),
  order_count integer not null check (order_count >= 0),
  captured_at timestamptz not null default now(),
  primary key (branch_code, business_date),
  constraint gpos_dashboard_branch_check check (branch_code = 'BIGC-CENTRAL-PATTAYA')
);

alter table boy_central.gpos_dashboard_snapshots enable row level security;
revoke all on boy_central.gpos_dashboard_snapshots from public, anon, authenticated;
grant select on boy_central.gpos_dashboard_snapshots to authenticated;

create policy gpos_dashboard_read on boy_central.gpos_dashboard_snapshots
for select to authenticated using (
  boy_central_private.has_branch_access(
    (select id from boy_central.branches where code = branch_code),
    array['admin','manager','staff']
  )
);

create function boy_central.save_gpos_dashboard_snapshot(
  target_date date, sales_amount numeric, sales_orders integer
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from boy_central.profiles p
    where p.user_id = (select auth.uid()) and p.active and p.company_role = 'admin'
  ) then
    raise exception 'Only an active BOY administrator can publish a GPOS preview';
  end if;
  if target_date is distinct from (now() at time zone 'Asia/Bangkok')::date
     or sales_amount is null or sales_amount < 0
     or sales_orders is null or sales_orders < 0 then
    raise exception 'Invalid GPOS preview';
  end if;

  insert into boy_central.gpos_dashboard_snapshots
    (branch_code, business_date, net_sales, order_count, captured_at)
  values ('BIGC-CENTRAL-PATTAYA', target_date, sales_amount, sales_orders, now())
  on conflict (branch_code, business_date) do update set
    net_sales = excluded.net_sales,
    order_count = excluded.order_count,
    captured_at = excluded.captured_at;
end $$;
revoke all on function boy_central.save_gpos_dashboard_snapshot(date,numeric,integer) from public, anon;
grant execute on function boy_central.save_gpos_dashboard_snapshot(date,numeric,integer) to authenticated;
