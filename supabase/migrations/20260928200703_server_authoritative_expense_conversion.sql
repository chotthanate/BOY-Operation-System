do $migration$
declare
  function_definition text;
  old_block text := $old$conversion_value := 1;
    if target_item.id is not null and nullif(line->>'unit_id', '') is not null then
      select iu.conversion_to_base into conversion_value
      from boy_central.item_units iu
      where iu.item_id = target_item.id
        and iu.unit_id = (line->>'unit_id')::uuid
        and iu.active;

      if conversion_value is null then
        raise exception 'purchase unit is not configured at line %', line_number;
      end if;
    end if;$old$;
  new_block text := $new$conversion_value := nullif(line->>'conversion_to_base', '')::numeric;
    if conversion_value is null then
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
    elsif conversion_value <= 0 then
      raise exception 'conversion_to_base must be greater than zero at line %', line_number;
    end if;$new$;
begin
  select pg_get_functiondef('boy_central.record_expense(jsonb)'::regprocedure)
    into function_definition;
  if position(old_block in function_definition) = 0 then
    raise exception 'record_expense conversion block does not match expected definition';
  end if;
  execute replace(function_definition, old_block, new_block);
end;
$migration$;

create or replace function boy_central.record_expense_v3(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  line jsonb;
  resolved_line jsonb;
  resolved_lines jsonb := '[]'::jsonb;
  resolved_payload jsonb;
  expense_row boy_central.expense_items%rowtype;
  resolved_unit_id uuid;
  resolved_conversion numeric(18,6);
  result jsonb;
  target_transaction_id uuid;
begin
  if actor_id is null then raise exception 'authentication required'; end if;

  for line in select value from jsonb_array_elements(payload->'lines') loop
    resolved_line := line;
    expense_row.id := null;
    if nullif(line->>'expense_item_id','') is not null then
      select * into expense_row
      from boy_central.expense_items ei
      where ei.id=(line->>'expense_item_id')::uuid and ei.active;
      if expense_row.id is null then raise exception 'active expense item not found'; end if;

      if expense_row.affects_stock then
        if expense_row.item_id is null then
          raise exception 'stock target is not configured for expense item %', expense_row.name;
        end if;
        select coalesce(expense_row.purchase_unit_id,i.base_unit_id),
               coalesce(expense_row.stock_conversion_to_base,1)
          into resolved_unit_id,resolved_conversion
        from boy_central.items i
        where i.id=expense_row.item_id and i.active and i.track_stock;
        if resolved_unit_id is null or resolved_conversion is null or resolved_conversion <= 0 then
          raise exception 'stock mapping is incomplete for expense item %', expense_row.name;
        end if;
        if not exists (
          select 1 from boy_central.item_units iu
          where iu.item_id=expense_row.item_id and iu.unit_id=resolved_unit_id and iu.active
        ) then
          raise exception 'purchase unit is not configured for expense item %', expense_row.name;
        end if;
        resolved_line := resolved_line || jsonb_build_object(
          'item_id',expense_row.item_id,
          'unit_id',resolved_unit_id,
          'conversion_to_base',resolved_conversion
        );
      else
        resolved_line := resolved_line - 'item_id' - 'unit_id' - 'conversion_to_base';
      end if;
    end if;
    resolved_lines := resolved_lines || jsonb_build_array(resolved_line);
  end loop;

  resolved_payload := jsonb_set(payload,'{lines}',resolved_lines,true);
  result := boy_central.record_expense_v2(resolved_payload);

  if result->>'status' <> 'duplicate'
     and coalesce(payload->'payment'->>'method','')='reimbursement_pending' then
    target_transaction_id := (result->>'transaction_id')::uuid;
    update boy_central.payments set status='pending',paid_at=null,
      note=coalesce(note || ' · ','') || 'รอเบิกค่าใช้จ่าย'
    where transaction_id=target_transaction_id and method='reimbursement_pending';
  end if;
  return result;
end;
$$;

revoke all on function boy_central.record_expense(jsonb) from public, anon, authenticated;
revoke all on function boy_central.record_expense_v2(jsonb) from public, anon, authenticated;
revoke all on function boy_central.record_expense_v3(jsonb) from public, anon;
grant execute on function boy_central.record_expense_v3(jsonb) to authenticated;
notify pgrst, 'reload schema';
