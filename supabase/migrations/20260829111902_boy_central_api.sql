create or replace function boy_central.record_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_branch boy_central.branches%rowtype;
  target_company_id uuid;
  target_supplier_id uuid;
  line_supplier_id uuid;
  target_location_id uuid;
  target_transaction_id uuid;
  existing_transaction_id uuid;
  target_line_id uuid;
  target_item boy_central.items%rowtype;
  current_balance boy_central.inventory_balances%rowtype;
  line jsonb;
  payment jsonb;
  source_name text := coalesce(nullif(trim(payload->>'source_system'), ''), 'boy_web');
  request_key text := nullif(trim(payload->>'idempotency_key'), '');
  transaction_date_value date;
  line_number integer := 0;
  quantity_value numeric(18,6);
  conversion_value numeric(18,6);
  base_quantity_value numeric(18,6);
  line_total_value numeric(18,2);
  unit_cost_value numeric(18,6);
  next_quantity numeric(18,6);
  next_value numeric(18,2);
  next_average numeric(18,6);
  grand_total numeric(18,2) := 0;
  affects_stock_value boolean := false;
begin
  if actor_id is null then
    raise exception 'authentication required';
  end if;

  if request_key is null then
    raise exception 'idempotency_key is required';
  end if;

  select * into target_branch
  from boy_central.branches
  where id = nullif(payload->>'branch_id', '')::uuid and active;

  if target_branch.id is null then
    raise exception 'active branch not found';
  end if;

  if not boy_central_private.has_branch_access(target_branch.id, array['admin', 'manager', 'staff']) then
    raise exception 'branch access denied';
  end if;

  target_company_id := target_branch.company_id;
  transaction_date_value := coalesce(nullif(payload->>'transaction_date', '')::date, current_date);
  target_supplier_id := nullif(payload->>'supplier_id', '')::uuid;

  select id into existing_transaction_id
  from boy_central.transactions
  where company_id = target_company_id
    and source_system = source_name
    and idempotency_key = request_key;

  if existing_transaction_id is not null then
    return jsonb_build_object(
      'status', 'duplicate',
      'transaction_id', existing_transaction_id,
      'idempotency_key', request_key
    );
  end if;

  if jsonb_typeof(payload->'lines') <> 'array' or jsonb_array_length(payload->'lines') = 0 then
    raise exception 'at least one expense line is required';
  end if;

  if target_supplier_id is not null and not exists (
    select 1 from boy_central.suppliers s
    where s.id = target_supplier_id and s.company_id = target_company_id and s.active
  ) then
    raise exception 'supplier not found';
  end if;

  insert into boy_central.transactions (
    company_id, branch_id, transaction_no, transaction_type, transaction_date,
    occurred_at, supplier_id, status, source_system, external_id,
    idempotency_key, created_by, updated_by, note
  ) values (
    target_company_id,
    target_branch.id,
    coalesce(nullif(payload->>'transaction_no', ''), 'EXP-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')),
    'expense',
    transaction_date_value,
    coalesce(nullif(payload->>'occurred_at', '')::timestamptz, now()),
    target_supplier_id,
    'confirmed',
    source_name,
    nullif(payload->>'external_id', ''),
    request_key,
    actor_id,
    actor_id,
    nullif(payload->>'note', '')
  ) returning id into target_transaction_id;

  for line in
    select value
    from jsonb_array_elements(payload->'lines')
    order by coalesce(value->>'item_id', ''), coalesce(value->>'description', '')
  loop
    line_number := line_number + 1;
    quantity_value := coalesce(nullif(line->>'quantity', '')::numeric, 0);
    line_total_value := round(coalesce(nullif(line->>'line_total', '')::numeric, 0), 2);

    if line_total_value < 0 then
      raise exception 'line_total cannot be negative at line %', line_number;
    end if;

    target_item.id := null;
    target_item.name := null;
    target_item.track_stock := false;
    if nullif(line->>'item_id', '') is not null then
      select * into target_item
      from boy_central.items
      where id = (line->>'item_id')::uuid
        and company_id = target_company_id
        and active;

      if target_item.id is null then
        raise exception 'item not found at line %', line_number;
      end if;
    end if;

    if nullif(line->>'expense_item_id', '') is not null and not exists (
      select 1
      from boy_central.expense_items ei
      where ei.id = (line->>'expense_item_id')::uuid
        and ei.company_id = target_company_id
        and ei.active
    ) then
      raise exception 'expense item not found at line %', line_number;
    end if;

    line_supplier_id := coalesce(nullif(line->>'supplier_id', '')::uuid, target_supplier_id);
    if line_supplier_id is not null and not exists (
      select 1
      from boy_central.suppliers s
      where s.id = line_supplier_id
        and s.company_id = target_company_id
        and s.active
    ) then
      raise exception 'supplier not found at line %', line_number;
    end if;

    if nullif(line->>'unit_id', '') is not null and not exists (
      select 1
      from boy_central.units u
      where u.id = (line->>'unit_id')::uuid
        and u.company_id = target_company_id
        and u.active
    ) then
      raise exception 'unit not found at line %', line_number;
    end if;

    conversion_value := 1;
    if target_item.id is not null and nullif(line->>'unit_id', '') is not null then
      select iu.conversion_to_base into conversion_value
      from boy_central.item_units iu
      where iu.item_id = target_item.id
        and iu.unit_id = (line->>'unit_id')::uuid
        and iu.active;

      if conversion_value is null then
        raise exception 'purchase unit is not configured at line %', line_number;
      end if;
    end if;

    base_quantity_value := quantity_value * conversion_value;
    unit_cost_value := case
      when base_quantity_value > 0 then line_total_value / base_quantity_value
      else 0
    end;

    insert into boy_central.transaction_lines (
      company_id, transaction_id, line_no, item_id, expense_item_id, supplier_id, supplier_name_raw,
      description, quantity, unit_id, conversion_to_base, base_quantity,
      unit_price, line_total, unit_cost_base, lot_no, manufactured_on,
      expires_on, note
    ) values (
      target_company_id,
      target_transaction_id,
      line_number,
      target_item.id,
      nullif(line->>'expense_item_id', '')::uuid,
      line_supplier_id,
      case when line_supplier_id is null then nullif(trim(line->>'supplier_name'), '') else null end,
      coalesce(nullif(trim(line->>'description'), ''), target_item.name, 'ไม่ระบุรายการ'),
      quantity_value,
      nullif(line->>'unit_id', '')::uuid,
      conversion_value,
      base_quantity_value,
      coalesce(nullif(line->>'unit_price', '')::numeric,
        case when quantity_value > 0 then line_total_value / quantity_value else 0 end),
      line_total_value,
      unit_cost_value,
      nullif(line->>'lot_no', ''),
      nullif(line->>'manufactured_on', '')::date,
      nullif(line->>'expires_on', '')::date,
      nullif(line->>'note', '')
    ) returning id into target_line_id;

    grand_total := grand_total + line_total_value;

    if target_item.id is not null and target_item.track_stock then
      if base_quantity_value <= 0 then
        raise exception 'stock item quantity must be greater than zero at line %', line_number;
      end if;

      select coalesce(
        nullif(line->>'location_id', '')::uuid,
        bi.default_location_id,
        (
          select il.id
          from boy_central.inventory_locations il
          where il.branch_id = target_branch.id and il.active
          order by il.created_at, il.id
          limit 1
        )
      ) into target_location_id
      from boy_central.branch_items bi
      where bi.branch_id = target_branch.id
        and bi.item_id = target_item.id
        and bi.active;

      if target_location_id is null then
        select il.id into target_location_id
        from boy_central.inventory_locations il
        where il.branch_id = target_branch.id and il.active
        order by il.created_at, il.id
        limit 1;
      end if;

      if target_location_id is null then
        raise exception 'inventory location not configured for branch';
      end if;

      insert into boy_central.inventory_balances (
        company_id, branch_id, location_id, item_id
      ) values (
        target_company_id, target_branch.id, target_location_id, target_item.id
      ) on conflict (location_id, item_id) do nothing;

      select * into current_balance
      from boy_central.inventory_balances
      where location_id = target_location_id and item_id = target_item.id
      for update;

      next_quantity := current_balance.quantity_on_hand + base_quantity_value;
      next_value := round((current_balance.inventory_value + line_total_value)::numeric, 2);
      next_average := case when next_quantity = 0 then 0 else next_value / next_quantity end;

      update boy_central.inventory_balances
      set quantity_on_hand = next_quantity,
          average_unit_cost = next_average,
          inventory_value = next_value,
          updated_at = now()
      where id = current_balance.id;

      insert into boy_central.stock_movements (
        company_id, branch_id, location_id, item_id, transaction_id,
        transaction_line_id, movement_type, quantity_before, quantity_delta,
        quantity_after, unit_cost_base, movement_value, lot_no, expires_on,
        source_system, external_id, occurred_at, created_by, reason
      ) values (
        target_company_id, target_branch.id, target_location_id, target_item.id,
        target_transaction_id, target_line_id, 'purchase',
        current_balance.quantity_on_hand, base_quantity_value, next_quantity,
        unit_cost_value, line_total_value, nullif(line->>'lot_no', ''),
        nullif(line->>'expires_on', '')::date, source_name,
        case when nullif(line->>'external_id', '') is null then null
          else (line->>'external_id') end,
        coalesce(nullif(payload->>'occurred_at', '')::timestamptz, now()),
        actor_id, coalesce(nullif(line->>'stock_reason', ''), 'บันทึกรายจ่ายซื้อสินค้า')
      );

      update boy_central.item_suppliers
      set last_purchase_price = line_total_value /
          nullif(quantity_value, 0),
          updated_at = now()
      where item_id = target_item.id
        and supplier_id = target_supplier_id;

      affects_stock_value := true;
    end if;
  end loop;

  update boy_central.transactions
  set subtotal = grand_total,
      total_amount = grand_total,
      affects_stock = affects_stock_value,
      updated_at = now()
  where id = target_transaction_id;

  payment := payload->'payment';
  if jsonb_typeof(payment) = 'object' and coalesce(nullif(payment->>'amount', '')::numeric, 0) > 0 then
    insert into boy_central.payments (
      company_id, transaction_id, method, amount, reference_no,
      paid_at, status, created_by, note
    ) values (
      target_company_id,
      target_transaction_id,
      coalesce(nullif(payment->>'method', ''), 'other'),
      (payment->>'amount')::numeric,
      nullif(payment->>'reference_no', ''),
      coalesce(nullif(payment->>'paid_at', '')::timestamptz, now()),
      'paid',
      actor_id,
      nullif(payment->>'note', '')
    );
  end if;

  insert into boy_central.status_history (
    company_id, branch_id, entity_type, entity_id, new_status,
    changed_by, reason
  ) values (
    target_company_id, target_branch.id, 'transaction', target_transaction_id,
    'confirmed', actor_id, 'บันทึกรายจ่าย'
  );

  insert into boy_central.audit_log (
    company_id, branch_id, actor_user_id, action, entity_type, entity_id,
    source_system, request_id, after_data
  ) values (
    target_company_id, target_branch.id, actor_id, 'record_expense',
    'transaction', target_transaction_id::text, source_name, request_key,
    jsonb_build_object('total_amount', grand_total, 'line_count', line_number, 'affects_stock', affects_stock_value)
  );

  return jsonb_build_object(
    'status', 'success',
    'transaction_id', target_transaction_id,
    'total_amount', grand_total,
    'line_count', line_number,
    'affects_stock', affects_stock_value,
    'idempotency_key', request_key
  );
end;
$$;

revoke all on function boy_central.record_expense(jsonb) from public, anon;
grant execute on function boy_central.record_expense(jsonb) to authenticated;

create or replace function boy_central.ingest_pos_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  caller_role text := coalesce((select auth.jwt()->>'role'), '');
  target_branch boy_central.branches%rowtype;
  target_company_id uuid;
  target_transaction_id uuid;
  target_pos_order_id uuid;
  existing_order_id uuid;
  target_shift_id uuid;
  target_location_id uuid;
  target_line_id uuid;
  current_balance boy_central.inventory_balances%rowtype;
  order_line jsonb;
  modifier_line jsonb;
  movement_line jsonb;
  source_name text := coalesce(nullif(payload->>'source_system', ''), 'burger_pos');
  source_order_id text := nullif(payload->>'external_id', '');
  request_key text := nullif(payload->>'idempotency_key', '');
  line_no_value integer := 0;
  quantity_delta_value numeric(18,6);
  next_quantity numeric(18,6);
  movement_cost numeric(18,6);
begin
  if actor_id is null and caller_role <> 'service_role' then
    raise exception 'authentication required';
  end if;

  if source_order_id is null or request_key is null then
    raise exception 'external_id and idempotency_key are required';
  end if;

  select * into target_branch
  from boy_central.branches
  where id = nullif(payload->>'branch_id', '')::uuid and active;

  if target_branch.id is null then
    raise exception 'active branch not found';
  end if;

  if caller_role <> 'service_role'
    and not boy_central_private.has_branch_access(target_branch.id, array['admin', 'manager', 'staff']) then
    raise exception 'branch access denied';
  end if;

  target_company_id := target_branch.company_id;

  select id into existing_order_id
  from boy_central.pos_orders
  where company_id = target_company_id
    and source_system = source_name
    and external_id = source_order_id;

  if existing_order_id is not null then
    return jsonb_build_object('status', 'duplicate', 'pos_order_id', existing_order_id);
  end if;

  if nullif(payload->>'shift_external_id', '') is not null then
    insert into boy_central.pos_shifts (
      company_id, branch_id, source_system, external_id, opened_at,
      closed_at, opening_cash, closing_cash, expected_cash, cash_difference,
      status, raw_payload
    ) values (
      target_company_id, target_branch.id, source_name,
      payload->>'shift_external_id',
      coalesce(nullif(payload->>'shift_opened_at', '')::timestamptz, now()),
      nullif(payload->>'shift_closed_at', '')::timestamptz,
      coalesce(nullif(payload->>'opening_cash', '')::numeric, 0),
      nullif(payload->>'closing_cash', '')::numeric,
      nullif(payload->>'expected_cash', '')::numeric,
      nullif(payload->>'cash_difference', '')::numeric,
      case when nullif(payload->>'shift_closed_at', '') is null then 'open' else 'closed' end,
      coalesce(payload->'shift_payload', '{}'::jsonb)
    ) on conflict (company_id, source_system, external_id)
      do update set
        closed_at = coalesce(excluded.closed_at, boy_central.pos_shifts.closed_at),
        closing_cash = coalesce(excluded.closing_cash, boy_central.pos_shifts.closing_cash),
        expected_cash = coalesce(excluded.expected_cash, boy_central.pos_shifts.expected_cash),
        cash_difference = coalesce(excluded.cash_difference, boy_central.pos_shifts.cash_difference),
        status = excluded.status,
        raw_payload = excluded.raw_payload,
        updated_at = now()
    returning id into target_shift_id;
  end if;

  insert into boy_central.transactions (
    company_id, branch_id, transaction_no, transaction_type, transaction_date,
    occurred_at, subtotal, discount, total_amount, status, affects_stock,
    source_system, external_id, idempotency_key, created_by, updated_by, note
  ) values (
    target_company_id,
    target_branch.id,
    coalesce(nullif(payload->>'order_no', ''), source_order_id),
    'sale',
    coalesce(nullif(payload->>'ordered_at', '')::timestamptz::date, current_date),
    coalesce(nullif(payload->>'ordered_at', '')::timestamptz, now()),
    coalesce(nullif(payload->>'subtotal', '')::numeric, 0),
    coalesce(nullif(payload->>'discount', '')::numeric, 0),
    coalesce(nullif(payload->>'total_amount', '')::numeric, 0),
    'confirmed',
    jsonb_array_length(coalesce(payload->'stock_movements', '[]'::jsonb)) > 0,
    source_name,
    source_order_id,
    request_key,
    actor_id,
    actor_id,
    nullif(payload->>'note', '')
  ) returning id into target_transaction_id;

  insert into boy_central.pos_orders (
    company_id, branch_id, shift_id, transaction_id, source_system,
    external_id, order_no, sales_channel, payment_method, subtotal,
    discount, total_amount, payment_status, ordered_at, raw_payload
  ) values (
    target_company_id, target_branch.id, target_shift_id, target_transaction_id,
    source_name, source_order_id, coalesce(nullif(payload->>'order_no', ''), source_order_id),
    coalesce(nullif(payload->>'sales_channel', ''), 'store'),
    nullif(payload->>'payment_method', ''),
    coalesce(nullif(payload->>'subtotal', '')::numeric, 0),
    coalesce(nullif(payload->>'discount', '')::numeric, 0),
    coalesce(nullif(payload->>'total_amount', '')::numeric, 0),
    'completed',
    coalesce(nullif(payload->>'ordered_at', '')::timestamptz, now()),
    payload
  ) returning id into target_pos_order_id;

  for order_line in select value from jsonb_array_elements(coalesce(payload->'lines', '[]'::jsonb))
  loop
    line_no_value := line_no_value + 1;
    insert into boy_central.pos_order_lines (
      company_id, pos_order_id, external_id, menu_id, item_name,
      quantity, unit_price, line_total, note
    ) values (
      target_company_id,
      target_pos_order_id,
      nullif(order_line->>'external_id', ''),
      nullif(order_line->>'menu_id', '')::uuid,
      coalesce(nullif(order_line->>'item_name', ''), 'ไม่ระบุสินค้า'),
      coalesce(nullif(order_line->>'quantity', '')::numeric, 1),
      coalesce(nullif(order_line->>'unit_price', '')::numeric, 0),
      coalesce(nullif(order_line->>'line_total', '')::numeric, 0),
      nullif(order_line->>'note', '')
    ) returning id into target_line_id;

    for modifier_line in select value from jsonb_array_elements(coalesce(order_line->'modifiers', '[]'::jsonb))
    loop
      insert into boy_central.pos_order_modifiers (
        company_id, pos_order_line_id, external_id, name, quantity, price_delta
      ) values (
        target_company_id,
        target_line_id,
        nullif(modifier_line->>'external_id', ''),
        coalesce(nullif(modifier_line->>'name', ''), 'ไม่ระบุตัวเลือก'),
        coalesce(nullif(modifier_line->>'quantity', '')::numeric, 1),
        coalesce(nullif(modifier_line->>'price_delta', '')::numeric, 0)
      );
    end loop;
  end loop;

  for movement_line in
    select value
    from jsonb_array_elements(coalesce(payload->'stock_movements', '[]'::jsonb))
    order by value->>'item_id'
  loop
    quantity_delta_value := coalesce(nullif(movement_line->>'quantity_delta', '')::numeric, 0);
    if quantity_delta_value > 0 then
      raise exception 'sale stock movement must not increase stock';
    end if;

    target_location_id := coalesce(
      nullif(movement_line->>'location_id', '')::uuid,
      (
        select il.id from boy_central.inventory_locations il
        where il.branch_id = target_branch.id and il.active
        order by il.created_at, il.id limit 1
      )
    );

    insert into boy_central.inventory_balances (
      company_id, branch_id, location_id, item_id
    ) values (
      target_company_id, target_branch.id, target_location_id,
      (movement_line->>'item_id')::uuid
    ) on conflict (location_id, item_id) do nothing;

    select * into current_balance
    from boy_central.inventory_balances
    where location_id = target_location_id
      and item_id = (movement_line->>'item_id')::uuid
    for update;

    next_quantity := current_balance.quantity_on_hand + quantity_delta_value;
    movement_cost := current_balance.average_unit_cost;

    update boy_central.inventory_balances
    set quantity_on_hand = next_quantity,
        inventory_value = round((next_quantity * movement_cost)::numeric, 2),
        updated_at = now()
    where id = current_balance.id;

    insert into boy_central.stock_movements (
      company_id, branch_id, location_id, item_id, transaction_id,
      movement_type, quantity_before, quantity_delta, quantity_after,
      unit_cost_base, movement_value, source_system, external_id,
      occurred_at, created_by, reason
    ) values (
      target_company_id, target_branch.id, target_location_id,
      (movement_line->>'item_id')::uuid, target_transaction_id, 'sale',
      current_balance.quantity_on_hand, quantity_delta_value, next_quantity,
      movement_cost, round((abs(quantity_delta_value) * movement_cost)::numeric, 2),
      source_name, nullif(movement_line->>'external_id', ''),
      coalesce(nullif(payload->>'ordered_at', '')::timestamptz, now()),
      actor_id, coalesce(nullif(movement_line->>'reason', ''), 'ตัดสต็อกจาก POS')
    );
  end loop;

  if coalesce(nullif(payload->>'total_amount', '')::numeric, 0) > 0 then
    insert into boy_central.payments (
      company_id, transaction_id, method, amount, reference_no,
      paid_at, status, created_by
    ) values (
      target_company_id,
      target_transaction_id,
      case upper(coalesce(payload->>'payment_method', 'OTHER'))
        when 'CASH' then 'cash'
        when 'TRANSFER' then 'transfer'
        when 'THAI_CHUAY_THAI' then 'thai_co_pay'
        else case when lower(coalesce(payload->>'sales_channel', '')) = 'grab' then 'grab' else 'other' end
      end,
      (payload->>'total_amount')::numeric,
      nullif(payload->>'payment_reference', ''),
      coalesce(nullif(payload->>'ordered_at', '')::timestamptz, now()),
      'paid',
      actor_id
    );
  end if;

  insert into boy_central.audit_log (
    company_id, branch_id, actor_user_id, action, entity_type, entity_id,
    source_system, request_id, after_data
  ) values (
    target_company_id, target_branch.id, actor_id, 'ingest_pos_order',
    'pos_order', target_pos_order_id::text, source_name, request_key,
    jsonb_build_object('external_id', source_order_id, 'total_amount', payload->>'total_amount')
  );

  return jsonb_build_object(
    'status', 'success',
    'pos_order_id', target_pos_order_id,
    'transaction_id', target_transaction_id
  );
end;
$$;

revoke all on function boy_central.ingest_pos_order(jsonb) from public, anon;
grant execute on function boy_central.ingest_pos_order(jsonb) to authenticated, service_role;

create or replace function boy_central.ingest_pos_void(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  caller_role text := coalesce((select auth.jwt()->>'role'), '');
  source_name text := coalesce(nullif(payload->>'source_system', ''), 'burger_pos');
  source_order_id text := nullif(payload->>'external_id', '');
  request_key text := nullif(payload->>'idempotency_key', '');
  target_order boy_central.pos_orders%rowtype;
  target_transaction boy_central.transactions%rowtype;
  void_transaction_id uuid;
  original_movement boy_central.stock_movements%rowtype;
  current_balance boy_central.inventory_balances%rowtype;
  next_quantity numeric(18,6);
begin
  if actor_id is null and caller_role <> 'service_role' then
    raise exception 'authentication required';
  end if;

  if source_order_id is null or request_key is null then
    raise exception 'external_id and idempotency_key are required';
  end if;

  select * into target_order
  from boy_central.pos_orders
  where source_system = source_name and external_id = source_order_id
  for update;

  if target_order.id is null then
    raise exception 'POS order not found';
  end if;

  if caller_role <> 'service_role'
    and not boy_central_private.has_branch_access(target_order.branch_id, array['admin', 'manager']) then
    raise exception 'branch access denied';
  end if;

  if target_order.payment_status = 'voided' then
    return jsonb_build_object('status', 'duplicate', 'pos_order_id', target_order.id);
  end if;

  select * into target_transaction
  from boy_central.transactions
  where id = target_order.transaction_id
  for update;

  insert into boy_central.transactions (
    company_id, branch_id, transaction_no, transaction_type, transaction_date,
    occurred_at, parent_transaction_id, subtotal, total_amount, status,
    affects_stock, source_system, external_id, idempotency_key,
    created_by, updated_by, note
  ) values (
    target_order.company_id,
    target_order.branch_id,
    'VOID-' || target_order.order_no,
    'sale_void',
    coalesce(nullif(payload->>'voided_at', '')::timestamptz::date, current_date),
    coalesce(nullif(payload->>'voided_at', '')::timestamptz, now()),
    target_transaction.id,
    -target_order.subtotal,
    -target_order.total_amount,
    'confirmed',
    target_transaction.affects_stock,
    source_name,
    source_order_id || ':void',
    request_key,
    actor_id,
    actor_id,
    nullif(payload->>'void_reason', '')
  ) returning id into void_transaction_id;

  for original_movement in
    select sm.*
    from boy_central.stock_movements sm
    where sm.transaction_id = target_transaction.id
      and sm.movement_type = 'sale'
    order by sm.item_id
    for update
  loop
    select * into current_balance
    from boy_central.inventory_balances
    where location_id = original_movement.location_id
      and item_id = original_movement.item_id
    for update;

    next_quantity := current_balance.quantity_on_hand - original_movement.quantity_delta;

    update boy_central.inventory_balances
    set quantity_on_hand = next_quantity,
        inventory_value = round((next_quantity * current_balance.average_unit_cost)::numeric, 2),
        updated_at = now()
    where id = current_balance.id;

    insert into boy_central.stock_movements (
      company_id, branch_id, location_id, item_id, transaction_id,
      movement_type, quantity_before, quantity_delta, quantity_after,
      unit_cost_base, movement_value, source_system, external_id,
      occurred_at, created_by, reason
    ) values (
      target_order.company_id,
      target_order.branch_id,
      original_movement.location_id,
      original_movement.item_id,
      void_transaction_id,
      'sale_void',
      current_balance.quantity_on_hand,
      -original_movement.quantity_delta,
      next_quantity,
      current_balance.average_unit_cost,
      original_movement.movement_value,
      source_name,
      coalesce(original_movement.external_id, original_movement.id::text) || ':void',
      coalesce(nullif(payload->>'voided_at', '')::timestamptz, now()),
      actor_id,
      coalesce(nullif(payload->>'void_reason', ''), 'ยกเลิกออเดอร์ POS')
    );
  end loop;

  update boy_central.transactions
  set status = 'voided',
      void_reason = nullif(payload->>'void_reason', ''),
      updated_by = actor_id,
      updated_at = now()
  where id = target_transaction.id;

  update boy_central.payments
  set status = 'voided'
  where transaction_id = target_transaction.id;

  update boy_central.pos_orders
  set payment_status = 'voided',
      voided_at = coalesce(nullif(payload->>'voided_at', '')::timestamptz, now()),
      void_reason = nullif(payload->>'void_reason', ''),
      updated_at = now()
  where id = target_order.id;

  insert into boy_central.audit_log (
    company_id, branch_id, actor_user_id, action, entity_type, entity_id,
    source_system, request_id, before_data, after_data
  ) values (
    target_order.company_id, target_order.branch_id, actor_id,
    'ingest_pos_void', 'pos_order', target_order.id::text,
    source_name, request_key,
    jsonb_build_object('payment_status', target_order.payment_status),
    jsonb_build_object('payment_status', 'voided', 'void_transaction_id', void_transaction_id)
  );

  return jsonb_build_object(
    'status', 'success',
    'pos_order_id', target_order.id,
    'void_transaction_id', void_transaction_id
  );
end;
$$;

revoke all on function boy_central.ingest_pos_void(jsonb) from public, anon;
grant execute on function boy_central.ingest_pos_void(jsonb) to authenticated, service_role;

create or replace function boy_central.upsert_import_batch(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  caller_role text := coalesce((select auth.jwt()->>'role'), '');
  target_company_id uuid := nullif(payload->>'company_id', '')::uuid;
  target_branch_id uuid := nullif(payload->>'branch_id', '')::uuid;
  target_batch_id uuid;
  request_key text := nullif(payload->>'idempotency_key', '');
  row_value jsonb;
  row_number_value integer := 0;
begin
  if actor_id is null and caller_role <> 'service_role' then
    raise exception 'authentication required';
  end if;

  if target_company_id is null or request_key is null then
    raise exception 'company_id and idempotency_key are required';
  end if;

  if caller_role <> 'service_role' and not boy_central_private.is_company_member(target_company_id) then
    raise exception 'company access denied';
  end if;

  if target_branch_id is not null
    and caller_role <> 'service_role'
    and not boy_central_private.has_branch_access(target_branch_id, array['admin', 'manager']) then
    raise exception 'branch access denied';
  end if;

  insert into boy_central.import_batches (
    company_id, branch_id, import_type, source_system, source_file_id,
    source_sheet_name, status, row_count, idempotency_key, requested_by
  ) values (
    target_company_id,
    target_branch_id,
    payload->>'import_type',
    coalesce(nullif(payload->>'source_system', ''), 'google_sheets'),
    nullif(payload->>'source_file_id', ''),
    nullif(payload->>'source_sheet_name', ''),
    'validating',
    jsonb_array_length(coalesce(payload->'rows', '[]'::jsonb)),
    request_key,
    actor_id
  ) on conflict (company_id, source_system, idempotency_key)
    do update set
      source_file_id = excluded.source_file_id,
      source_sheet_name = excluded.source_sheet_name,
      updated_at = now()
  returning id into target_batch_id;

  delete from boy_central.import_rows where import_batch_id = target_batch_id;

  for row_value in select value from jsonb_array_elements(coalesce(payload->'rows', '[]'::jsonb))
  loop
    row_number_value := row_number_value + 1;
    insert into boy_central.import_rows (
      company_id, import_batch_id, source_row_number, payload,
      validation_status, validation_messages
    ) values (
      target_company_id,
      target_batch_id,
      coalesce(nullif(row_value->>'source_row_number', '')::integer, row_number_value + 1),
      row_value,
      case when nullif(row_value->>'validation_status', '') is null then 'pending'
        else row_value->>'validation_status' end,
      coalesce(row_value->'validation_messages', '[]'::jsonb)
    );
  end loop;

  update boy_central.import_batches ib
  set valid_count = counts.valid_count,
      error_count = counts.error_count,
      status = case when counts.error_count > 0 then 'needs_review' else 'approved' end,
      updated_at = now()
  from (
    select
      count(*) filter (where validation_status in ('valid', 'warning'))::integer as valid_count,
      count(*) filter (where validation_status = 'error')::integer as error_count
    from boy_central.import_rows
    where import_batch_id = target_batch_id
  ) counts
  where ib.id = target_batch_id;

  return jsonb_build_object(
    'status', 'success',
    'import_batch_id', target_batch_id,
    'row_count', row_number_value
  );
end;
$$;

revoke all on function boy_central.upsert_import_batch(jsonb) from public, anon;
grant execute on function boy_central.upsert_import_batch(jsonb) to authenticated, service_role;
