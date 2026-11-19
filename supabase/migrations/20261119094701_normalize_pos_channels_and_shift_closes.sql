-- Preserve the real ordering channel independently from payment method. Older
-- GRILL builds sent Grab as transfer, and the original POS ingest hard-coded
-- every order to walk_in. Normalize at the canonical tables so old and new
-- installed clients both report correctly.

create or replace function boy_central_private.normalize_pos_order_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_channel text := lower(trim(coalesce(new.raw_payload->>'salesChannel', new.raw_payload->>'sales_channel', '')));
begin
  new.sales_channel := case requested_channel
    when 'grab' then 'grab'
    when 'lineman' then 'lineman'
    when 'line_man' then 'lineman'
    when 'shopee' then 'shopee_food'
    when 'shopee_food' then 'shopee_food'
    when 'store' then 'walk_in'
    when 'walk_in' then 'walk_in'
    else coalesce(nullif(new.sales_channel, ''), 'walk_in')
  end;

  if new.sales_channel = 'grab' then
    new.payment_method := 'grab';
  end if;
  return new;
end;
$$;

revoke all on function boy_central_private.normalize_pos_order_channel() from public, anon, authenticated;
grant execute on function boy_central_private.normalize_pos_order_channel() to postgres, service_role;

drop trigger if exists normalize_pos_order_channel on boy_central.pos_orders;
create trigger normalize_pos_order_channel
before insert or update of raw_payload, sales_channel, payment_method
on boy_central.pos_orders
for each row execute function boy_central_private.normalize_pos_order_channel();

create or replace function boy_central_private.normalize_pos_payment_method()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from boy_central.pos_orders o
    where o.transaction_id = new.transaction_id
      and o.sales_channel = 'grab'
  ) then
    new.method := 'grab';
  end if;
  return new;
end;
$$;

revoke all on function boy_central_private.normalize_pos_payment_method() from public, anon, authenticated;
grant execute on function boy_central_private.normalize_pos_payment_method() to postgres, service_role;

drop trigger if exists normalize_pos_payment_method on boy_central.payments;
create trigger normalize_pos_payment_method
before insert or update of transaction_id, method
on boy_central.payments
for each row execute function boy_central_private.normalize_pos_payment_method();

-- A closed POS shift is a financial close. The existing financial_close_mirror
-- trigger then creates the central mirror job; the tablet never writes Sheets
-- directly.
alter table boy_central.pos_shifts
  add column if not exists cash_sales numeric not null default 0,
  add column if not exists transfer_sales numeric not null default 0,
  add column if not exists government_sales numeric not null default 0,
  add column if not exists other_sales numeric not null default 0,
  add column if not exists order_count integer not null default 0;

alter table boy_central.pos_shifts
  drop constraint if exists pos_shifts_financial_totals_check;
alter table boy_central.pos_shifts
  add constraint pos_shifts_financial_totals_check check (
    cash_sales >= 0 and transfer_sales >= 0 and government_sales >= 0
    and other_sales >= 0 and order_count >= 0
  );

create or replace function boy_central_private.capture_pos_shift_close_metrics()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'closed' then
    new.cash_sales := greatest(coalesce((new.raw_payload->>'cash')::numeric, new.cash_sales, 0), 0);
    new.transfer_sales := greatest(coalesce((new.raw_payload->>'transfer')::numeric, new.transfer_sales, 0), 0);
    new.government_sales := greatest(coalesce((new.raw_payload->>'government')::numeric, new.government_sales, 0), 0);
    new.other_sales := greatest(coalesce((new.raw_payload->>'other')::numeric, new.other_sales, 0), 0);
    new.order_count := greatest(coalesce((new.raw_payload->>'order_count')::integer, new.order_count, 0), 0);
  end if;
  return new;
end;
$$;

revoke all on function boy_central_private.capture_pos_shift_close_metrics() from public, anon, authenticated;
grant execute on function boy_central_private.capture_pos_shift_close_metrics() to postgres, service_role;

drop trigger if exists capture_pos_shift_close_metrics on boy_central.pos_shifts;
create trigger capture_pos_shift_close_metrics
before insert or update of status, raw_payload
on boy_central.pos_shifts
for each row execute function boy_central_private.capture_pos_shift_close_metrics();

create or replace function boy_central_private.pos_shift_financial_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload_fingerprint text;
begin
  if new.status <> 'closed' or new.closed_at is null then
    return new;
  end if;

  payload_fingerprint := pg_catalog.md5(jsonb_build_object(
    'shift', new.external_id,
    'closed_at', new.closed_at,
    'cash', new.cash_sales,
    'transfer', new.transfer_sales,
    'government', new.government_sales,
    'other', new.other_sales,
    'order_count', new.order_count
  )::text);

  insert into boy_central.financial_closes (
    company_id, branch_id, business_date, source_type, source_key,
    cash, transfer, government, other, order_count, revision, fingerprint, updated_at
  ) values (
    new.company_id,
    new.branch_id,
    (new.closed_at at time zone 'Asia/Bangkok')::date,
    'pos_shift',
    new.external_id,
    new.cash_sales,
    new.transfer_sales,
    new.government_sales,
    new.other_sales,
    new.order_count,
    1,
    payload_fingerprint,
    now()
  )
  on conflict (branch_id, source_type, source_key) do update
  set business_date = excluded.business_date,
      cash = excluded.cash,
      transfer = excluded.transfer,
      government = excluded.government,
      other = excluded.other,
      order_count = excluded.order_count,
      revision = case
        when boy_central.financial_closes.fingerprint = excluded.fingerprint
          then boy_central.financial_closes.revision
        else boy_central.financial_closes.revision + 1
      end,
      fingerprint = excluded.fingerprint,
      updated_at = now();

  return new;
end;
$$;

revoke all on function boy_central_private.pos_shift_financial_close() from public, anon, authenticated;
grant execute on function boy_central_private.pos_shift_financial_close() to postgres, service_role;

drop trigger if exists pos_shift_financial_close on boy_central.pos_shifts;
create trigger pos_shift_financial_close
after insert or update of status, closed_at, raw_payload
on boy_central.pos_shifts
for each row execute function boy_central_private.pos_shift_financial_close();

-- Both are verified pre-go-live orphans: the first contains only a fully voided
-- test order and the second contains no orders. Reconcile only those exact rows
-- and only while no non-voided order exists, so this migration cannot close a
-- future business shift by accident.
update boy_central.pos_shifts s
set status = 'voided',
    closed_at = coalesce(s.closed_at, now()),
    raw_payload = coalesce(s.raw_payload, '{}'::jsonb) || jsonb_build_object(
      'reconciled_before_go_live', true,
      'reconciled_at', now()
    ),
    updated_at = now()
where s.branch_id = 'a05ff385-0c34-40ac-be61-7f12a0774737'::uuid
  and s.source_system = 'grill_pos'
  and s.external_id in ('SHIFT-1794696135028', 'SHIFT-1795038221196')
  and s.status = 'open'
  and not exists (
    select 1
    from boy_central.pos_orders o
    where o.shift_id = s.id
      and o.payment_status not in ('voided', 'refunded')
  );
