alter table boy_central.expense_items
  add column if not exists purchase_unit_id uuid references boy_central.units(id),
  add column if not exists stock_conversion_to_base numeric(18,6);

alter table boy_central.expense_items
  drop constraint if exists expense_items_stock_conversion_positive,
  add constraint expense_items_stock_conversion_positive
    check (stock_conversion_to_base is null or stock_conversion_to_base > 0);

update boy_central.expense_items ei
set purchase_unit_id = coalesce(
      ei.purchase_unit_id,
      (select iu.unit_id from boy_central.item_units iu
       where iu.item_id = ei.item_id and iu.active and iu.allow_purchase
       order by iu.is_base_unit, iu.created_at limit 1),
      (select i.base_unit_id from boy_central.items i where i.id = ei.item_id)
    ),
    stock_conversion_to_base = coalesce(
      ei.stock_conversion_to_base,
      (select iu.conversion_to_base from boy_central.item_units iu
       where iu.item_id = ei.item_id and iu.active and iu.allow_purchase
       order by iu.is_base_unit, iu.created_at limit 1),
      1
    )
where ei.affects_stock and ei.item_id is not null;

comment on column boy_central.expense_items.item_id is
  'Stock item automatically increased when this expense item is recorded.';
comment on column boy_central.expense_items.purchase_unit_id is
  'Purchase unit configured once for this expense item.';
comment on column boy_central.expense_items.stock_conversion_to_base is
  'Base-stock quantity added for one purchase unit of this expense item.';

update boy_central.master_catalog_sheets
set headers = headers || '["กระทบสต็อก","purchase_unit_id","อัตราเพิ่มสต็อกต่อหน่วยซื้อ","ต้องกรอกจำนวน","ต้องเลือกหน่วย"]'::jsonb,
    updated_at = now()
where sheet_name = 'M_รายการค่าใช้จ่าย'
  and not headers @> '["อัตราเพิ่มสต็อกต่อหน่วยซื้อ"]'::jsonb;

with expense_sheet as (
  select id from boy_central.master_catalog_sheets where sheet_name='M_รายการค่าใช้จ่าย'
), item_sheet as (
  select id from boy_central.master_catalog_sheets where sheet_name='M_สินค้า'
), unit_sheet as (
  select id from boy_central.master_catalog_sheets where sheet_name='M_หน่วยสินค้า'
)
update boy_central.master_catalog_rows expense_row
set row_data = expense_row.row_data || jsonb_build_object(
      'กระทบสต็อก', coalesce((item_row.row_data->>'ติดตามสต็อก')::boolean, false),
      'purchase_unit_id', coalesce(unit_row.row_data->>'unit_id', item_row.row_data->>'base_unit_id', ''),
      'อัตราเพิ่มสต็อกต่อหน่วยซื้อ', coalesce((unit_row.row_data->>'อัตราแปลงเป็นหน่วยฐาน')::numeric, 1),
      'ต้องกรอกจำนวน', coalesce((item_row.row_data->>'ติดตามสต็อก')::boolean, false),
      'ต้องเลือกหน่วย', coalesce((item_row.row_data->>'ติดตามสต็อก')::boolean, false)
    ), updated_at=now()
from expense_sheet, item_sheet
join boy_central.master_catalog_rows item_row on item_row.sheet_id=item_sheet.id
left join unit_sheet on true
left join lateral (
  select u.row_data from boy_central.master_catalog_rows u
  where u.sheet_id=unit_sheet.id
    and u.row_data->>'item_id'=item_row.row_data->>'item_id'
    and coalesce((u.row_data->>'เปิดใช้งาน')::boolean,true)
    and coalesce((u.row_data->>'ใช้หน่วยนี้ตอนซื้อ')::boolean,true)
  order by coalesce((u.row_data->>'เป็นหน่วยฐาน')::boolean,false),u.row_number limit 1
) unit_row on true
where expense_row.sheet_id=expense_sheet.id
  and expense_row.row_data->>'item_id'=item_row.row_data->>'item_id'
  and not (expense_row.row_data ? 'อัตราเพิ่มสต็อกต่อหน่วยซื้อ');

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
  key_value text;
  original_conversions jsonb := '{}'::jsonb;
  existing_conversion numeric;
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
      where ei.id = (line->>'expense_item_id')::uuid and ei.active;
      if expense_row.id is null then raise exception 'active expense item not found'; end if;

      if expense_row.affects_stock then
        if expense_row.item_id is null then
          raise exception 'stock target is not configured for expense item %', expense_row.name;
        end if;
        select coalesce(expense_row.purchase_unit_id, i.base_unit_id),
               coalesce(expense_row.stock_conversion_to_base,
                 (select iu.conversion_to_base from boy_central.item_units iu
                  where iu.item_id=expense_row.item_id
                    and iu.unit_id=coalesce(expense_row.purchase_unit_id,i.base_unit_id)
                    and iu.active), 1)
          into resolved_unit_id, resolved_conversion
        from boy_central.items i where i.id=expense_row.item_id and i.active;
        if resolved_unit_id is null or resolved_conversion is null or resolved_conversion <= 0 then
          raise exception 'purchase unit mapping is incomplete for expense item %', expense_row.name;
        end if;
        resolved_line := resolved_line || jsonb_build_object(
          'item_id', expense_row.item_id,
          'unit_id', resolved_unit_id,
          'conversion_to_base', resolved_conversion
        );
      else
        resolved_line := (resolved_line - 'item_id' - 'unit_id' - 'conversion_to_base');
      end if;
    end if;
    resolved_lines := resolved_lines || jsonb_build_array(resolved_line);
  end loop;

  resolved_payload := jsonb_set(payload, '{lines}', resolved_lines, true);

  -- record_expense currently reads conversion from item_units. Lock and replace only
  -- inside this transaction, then restore it before returning. The expense-item
  -- mapping above remains authoritative and cannot be overridden by the client.
  for line in select value from jsonb_array_elements(resolved_lines) loop
    if nullif(line->>'item_id','') is null or nullif(line->>'unit_id','') is null
       or nullif(line->>'conversion_to_base','') is null then continue; end if;
    resolved_conversion := (line->>'conversion_to_base')::numeric;
    if resolved_conversion <= 0 then raise exception 'conversion_to_base must be greater than zero'; end if;
    key_value := line->>'item_id' || '|' || line->>'unit_id';
    existing_conversion := nullif(original_conversions->>key_value,'')::numeric;
    if existing_conversion is not null then continue; end if;
    select iu.conversion_to_base into existing_conversion
    from boy_central.item_units iu
    where iu.item_id=(line->>'item_id')::uuid and iu.unit_id=(line->>'unit_id')::uuid and iu.active
    for update;
    if existing_conversion is null then raise exception 'purchase unit is not configured'; end if;
    original_conversions := original_conversions || jsonb_build_object(key_value, existing_conversion);
    update boy_central.item_units set conversion_to_base=resolved_conversion, updated_at=now()
    where item_id=(line->>'item_id')::uuid and unit_id=(line->>'unit_id')::uuid;
  end loop;

  result := boy_central.record_expense_v2(resolved_payload);

  for line in select value from jsonb_array_elements(resolved_lines) loop
    if nullif(line->>'item_id','') is null or nullif(line->>'unit_id','') is null then continue; end if;
    key_value := line->>'item_id' || '|' || line->>'unit_id';
    existing_conversion := nullif(original_conversions->>key_value,'')::numeric;
    if existing_conversion is not null then
      update boy_central.item_units set conversion_to_base=existing_conversion, updated_at=now()
      where item_id=(line->>'item_id')::uuid and unit_id=(line->>'unit_id')::uuid;
    end if;
  end loop;

  if result->>'status' <> 'duplicate' and coalesce(payload->'payment'->>'method','') = 'reimbursement_pending' then
    target_transaction_id := (result->>'transaction_id')::uuid;
    update boy_central.payments set status='pending', paid_at=null,
      note=coalesce(note || ' · ','') || 'รอเบิกค่าใช้จ่าย'
    where transaction_id=target_transaction_id and method='reimbursement_pending';
  end if;
  return result;
end;
$$;

revoke all on function boy_central.record_expense_v3(jsonb) from public, anon;
grant execute on function boy_central.record_expense_v3(jsonb) to authenticated;
notify pgrst, 'reload schema';
