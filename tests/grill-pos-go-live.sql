begin;

do $$
declare
  target_company uuid;
  target_branch uuid;
  target_transaction uuid := gen_random_uuid();
  target_shift uuid := gen_random_uuid();
  target_order uuid;
  target_close uuid;
  target_payment uuid;
begin
  select company_id, id into target_company, target_branch
  from boy_central.branches where code = 'GRILL';

  insert into boy_central.transactions (
    id, company_id, branch_id, transaction_no, transaction_type,
    transaction_date, occurred_at, subtotal, total_amount, status,
    affects_stock, source_system, external_id, idempotency_key
  ) values (
    target_transaction, target_company, target_branch, 'QA-GRAB-CHANNEL', 'sale',
    current_date, now(), 20, 20, 'confirmed', false,
    'qa_rollback', 'QA-GRAB-CHANNEL', 'qa:grill:grab:channel'
  );

  insert into boy_central.pos_orders (
    company_id, branch_id, transaction_id, source_system, external_id,
    order_no, sales_channel, payment_method, subtotal, total_amount,
    payment_status, ordered_at, raw_payload
  ) values (
    target_company, target_branch, target_transaction, 'qa_rollback', 'QA-GRAB-CHANNEL',
    'QA-GRAB-CHANNEL', 'walk_in', 'transfer', 20, 20,
    'completed', now(), '{"salesChannel":"grab","payment":"transfer"}'::jsonb
  ) returning id into target_order;

  if not exists (
    select 1 from boy_central.pos_orders
    where id = target_order and sales_channel = 'grab' and payment_method = 'grab'
  ) then
    raise exception 'Grab order was not normalized';
  end if;

  insert into boy_central.payments (company_id, transaction_id, method, amount, paid_at)
  values (target_company, target_transaction, 'transfer', 20, now())
  returning id into target_payment;

  if not exists (select 1 from boy_central.payments where id = target_payment and method = 'grab') then
    raise exception 'Grab payment was not normalized';
  end if;

  insert into boy_central.pos_shifts (
    id, company_id, branch_id, source_system, external_id, opened_at,
    opening_cash, status, raw_payload
  ) values (
    target_shift, target_company, target_branch, 'qa_rollback', 'QA-SHIFT-CLOSE', now(),
    500, 'open', '{}'::jsonb
  );

  update boy_central.pos_shifts
  set status = 'closed', closed_at = now(), closing_cash = 620,
      expected_cash = 620, cash_difference = 0,
      raw_payload = '{"cash":120,"transfer":30,"government":10,"other":20,"order_count":9}'::jsonb
  where id = target_shift;

  select id into target_close from boy_central.financial_closes
  where branch_id = target_branch and source_type = 'pos_shift' and source_key = 'QA-SHIFT-CLOSE';

  if target_close is null or not exists (
    select 1 from boy_central.financial_closes
    where id = target_close and cash = 120 and transfer = 30
      and government = 10 and other = 20 and order_count = 9
  ) then
    raise exception 'POS shift financial close was not created correctly';
  end if;

  if not exists (
    select 1 from boy_central.mirror_jobs
    where entity_type = 'financial_close' and entity_id = target_close
  ) then
    raise exception 'Financial close mirror job was not created';
  end if;
end;
$$;

rollback;
