-- Import the retained POS order history for reporting only. Historical rows do
-- not carry stock movements because the opening balance already represents the
-- stock position after those sales.
do $$
declare
  burger_branch_id uuid;
  order_entry jsonb;
  order_lines jsonb;
  imported integer := 0;
begin
  select id into burger_branch_id
  from boy_central.branches
  where code = 'BURGER' and active
  limit 1;

  if burger_branch_id is null then return; end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  for order_entry in
    select value
    from public.pos_app_state state
    cross join lateral jsonb_array_elements(state.payload) value
    where state.store_id = 'boy-burger-main'
      and state.key = 'orders'
      and coalesce((value->>'isTest')::boolean, false) = false
    order by nullif(value->>'createdAt', '')::timestamptz
  loop
    select coalesce(jsonb_agg(line_payload order by ordinal), '[]'::jsonb)
      into order_lines
    from (
      select
        line_index as ordinal,
        jsonb_build_object(
          'external_id', (order_entry->>'id') || ':' || line_index,
          'menu_id', (
            select mapping.menu_id
            from boy_central.pos_master_mappings mapping
            where mapping.branch_id = burger_branch_id
              and mapping.source_system = 'burger_pos_app_state'
              and mapping.entity_type = 'product'
              and mapping.legacy_key = item_line->>'productId'
              and mapping.match_status = 'matched'
            limit 1
          ),
          'item_name', coalesce(nullif(item_line->>'name', ''), 'ไม่ระบุสินค้า'),
          'quantity', coalesce(nullif(item_line->>'quantity', '')::numeric, 1),
          'unit_price', coalesce(nullif(item_line->>'unitPrice', '')::numeric, 0),
          'line_total', coalesce(nullif(item_line->>'quantity', '')::numeric, 1)
            * coalesce(nullif(item_line->>'unitPrice', '')::numeric, 0),
          'note', nullif(item_line->>'note', ''),
          'modifiers', coalesce((
            select jsonb_agg(jsonb_build_object(
              'external_id', (order_entry->>'id') || ':' || line_index || ':mod:' || modifier_index,
              'name', modifier_name,
              'quantity', 1,
              'price_delta', 0
            ) order by modifier_index)
            from jsonb_array_elements_text(coalesce(item_line->'modifiers', '[]'::jsonb))
              with ordinality as modifier(modifier_name, modifier_index)
          ), '[]'::jsonb)
        ) as line_payload
      from jsonb_array_elements(coalesce(order_entry->'items', '[]'::jsonb))
        with ordinality as order_item(item_line, line_index)
    ) built_lines;

    perform boy_central.ingest_pos_order(jsonb_build_object(
      'branch_id', burger_branch_id,
      'source_system', 'burger_pos_app_state',
      'external_id', order_entry->>'id',
      'idempotency_key', 'burger-pos:order:' || (order_entry->>'id'),
      'order_no', 'BURGER-' || (order_entry->>'id'),
      'ordered_at', order_entry->>'createdAt',
      'shift_external_id', nullif(order_entry->>'shiftId', ''),
      'sales_channel', coalesce(nullif(order_entry->>'salesChannel', ''), 'store'),
      'payment_method', coalesce(nullif(order_entry->>'paymentMethod', ''), 'OTHER'),
      'subtotal', coalesce(nullif(order_entry->>'totalAmount', '')::numeric, 0),
      'discount', 0,
      'total_amount', coalesce(nullif(order_entry->>'totalAmount', '')::numeric, 0),
      'note', nullif(order_entry->>'note', ''),
      'lines', order_lines,
      'stock_movements', '[]'::jsonb
    ));

    if nullif(order_entry->>'voidedAt', '') is not null then
      perform boy_central.ingest_pos_void(jsonb_build_object(
        'source_system', 'burger_pos_app_state',
        'external_id', order_entry->>'id',
        'idempotency_key', 'burger-pos:void:' || (order_entry->>'id'),
        'voided_at', order_entry->>'voidedAt',
        'void_reason', coalesce(nullif(order_entry->>'voidReason', ''), 'ยกเลิกออเดอร์จาก Burger POS'),
        'refund_method', coalesce(nullif(order_entry->>'voidRefundMethod', ''), 'NONE'),
        'refund_amount', coalesce(nullif(order_entry->>'voidRefundAmount', '')::numeric, 0)
      ));
    end if;

    imported := imported + 1;
  end loop;

  raise notice 'Backfilled % Burger POS orders without historical stock movements', imported;
end;
$$;
