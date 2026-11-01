-- A GRILL void must reverse the exact stock movements of the original sale.
-- This trigger runs inside sync_pos_event's transaction: a validation or stock
-- failure rolls back the VOID event as well as the order/payment changes.
create or replace function boy_central_private.apply_grill_pos_void()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  original_order boy_central.pos_orders%rowtype;
  original_tx boy_central.transactions%rowtype;
  sale_movement boy_central.stock_movements%rowtype;
  balance boy_central.inventory_balances%rowtype;
  restore_stock boolean;
begin
  if new.source_system <> 'grill_pos' or new.event_type <> 'VOID' then
    return new;
  end if;

  if new.payload->'data'->>'id' is distinct from new.external_id then
    raise exception 'GRILL void order ID does not match event ID';
  end if;

  select * into original_order
  from boy_central.pos_orders
  where company_id = new.company_id and branch_id = new.branch_id
    and source_system = 'grill_pos' and external_id = new.external_id
  for update;
  if original_order.id is null or original_order.payment_status <> 'completed' then
    raise exception 'GRILL sale not found or already voided: %', new.external_id;
  end if;

  select * into original_tx from boy_central.transactions
  where id = original_order.transaction_id and company_id = new.company_id
    and branch_id = new.branch_id and source_system = 'grill_pos'
  for update;
  if original_tx.id is null or original_tx.status <> 'confirmed' then
    raise exception 'GRILL sale transaction is not confirmed: %', new.external_id;
  end if;

  restore_stock := coalesce((new.payload->'data'->>'stockRestored')::boolean, false);
  if restore_stock then
    for sale_movement in
      select * from boy_central.stock_movements
      where transaction_id = original_tx.id and company_id = new.company_id
        and branch_id = new.branch_id and source_system = 'grill_pos'
        and movement_type = 'sale'
      order by id
    loop
      select * into balance from boy_central.inventory_balances
      where location_id = sale_movement.location_id and item_id = sale_movement.item_id
        and company_id = new.company_id and branch_id = new.branch_id
      for update;
      if balance.id is null then
        raise exception 'GRILL stock balance missing for sale movement %', sale_movement.id;
      end if;

      insert into boy_central.stock_movements(
        company_id, branch_id, location_id, item_id, transaction_id,
        movement_type, quantity_before, quantity_delta, quantity_after,
        unit_cost_base, movement_value, source_system, external_id,
        occurred_at, reason
      ) values (
        new.company_id, new.branch_id, sale_movement.location_id,
        sale_movement.item_id, original_tx.id, 'sale_void',
        balance.quantity_on_hand, -sale_movement.quantity_delta,
        balance.quantity_on_hand - sale_movement.quantity_delta,
        sale_movement.unit_cost_base, sale_movement.movement_value,
        'grill_pos', 'void:' || new.external_id || ':' || sale_movement.id,
        new.occurred_at, coalesce(new.payload->'data'->>'voidReason', 'ยกเลิกบิล')
      );
      update boy_central.inventory_balances
      set quantity_on_hand = quantity_on_hand - sale_movement.quantity_delta,
        inventory_value = (quantity_on_hand - sale_movement.quantity_delta) * average_unit_cost,
        updated_at = now()
      where id = balance.id;
    end loop;
  end if;
  return new;
end $$;

revoke all on function boy_central_private.apply_grill_pos_void() from public, anon, authenticated;
drop trigger if exists apply_grill_pos_void on boy_central.pos_sync_events;
create trigger apply_grill_pos_void
after insert on boy_central.pos_sync_events
for each row execute function boy_central_private.apply_grill_pos_void();
