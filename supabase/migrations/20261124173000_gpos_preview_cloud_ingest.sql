-- This token can update only today's BigC GPOS preview, never accounting data.
create function public.save_gpos_dashboard_snapshot_worker(
  target_date date, sales_amount numeric, sales_orders integer, ingest_token text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if ingest_token is null or length(ingest_token) < 40 or
     extensions.digest(convert_to(ingest_token, 'UTF8'), 'sha256') <> decode('9f307c9dee1a59b2dba1ac5cf1a40c2ff5b0c980c5332aaef944cea0503a2974', 'hex') then
    raise exception 'GPOS preview token rejected';
  end if;
  if target_date is distinct from (now() at time zone 'Asia/Bangkok')::date
     or sales_amount is null or sales_amount < 0 or sales_amount > 100000000
     or sales_orders is null or sales_orders < 0 or sales_orders > 1000000 then
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
revoke all on function public.save_gpos_dashboard_snapshot_worker(date,numeric,integer,text) from public, authenticated;
grant execute on function public.save_gpos_dashboard_snapshot_worker(date,numeric,integer,text) to anon;
