-- Applied migration version: 20261128080629.
-- Web count adjustments share the POS default stock location and central ledger.
create function boy_central.admin_set_water_stock(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  b boy_central.branches%rowtype; balance boy_central.inventory_balances%rowtype;
  item uuid; loc uuid; rid uuid; target numeric; expected numeric; delta numeric;
  previous jsonb; answer jsonb; reason text;
begin
  select * into b from boy_central.branches where id=(payload->>'branch_id')::uuid and active and code='BIGC-SOUTH-PATTAYA';
  if auth.uid() is null or b.id is null or not boy_central_private.is_company_admin(b.company_id) then
    raise exception 'เฉพาะแอดมินของสาขาเท่านั้น' using errcode='42501';
  end if;
  rid := (payload->>'request_id')::uuid;
  if rid is null then raise exception 'request_id required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('water-web-stock:'||rid::text,0));
  select after_data into previous from boy_central.audit_log where company_id=b.company_id and branch_id=b.id
    and action='water_admin_set_stock' and request_id=rid::text;
  if previous is not null then
    if previous->'payload' <> payload then raise exception 'request_id conflict'; end if;
    return previous->'result';
  end if;
  target := (payload->>'quantity')::numeric;
  expected := (payload->>'expected_quantity')::numeric;
  reason := trim(coalesce(payload->>'reason',''));
  if target is null or expected is null or not (abs(target)<=1000000000 and abs(expected)<=1000000000)
    or scale(target)>6 or length(reason) not between 1 and 500 then raise exception 'จำนวนหรือเหตุผลไม่ถูกต้อง'; end if;
  select i.id, l.id into item,loc from boy_central.branch_items bi
    join boy_central.items i on i.id=bi.item_id and i.company_id=b.company_id
    join boy_central.inventory_locations l on l.id=bi.default_location_id and l.branch_id=b.id and l.active
    where bi.branch_id=b.id and bi.active and i.id=(payload->>'item_id')::uuid and i.active
      and i.track_stock and i.stock_target_item_id is null and l.id=(payload->>'location_id')::uuid;
  if item is null then raise exception 'ไม่พบรายการสต็อกที่จุดเก็บของ POS'; end if;
  insert into boy_central.inventory_balances(company_id,branch_id,location_id,item_id)
    values(b.company_id,b.id,loc,item) on conflict(location_id,item_id) do nothing;
  select * into strict balance from boy_central.inventory_balances
    where branch_id=b.id and location_id=loc and item_id=item for update;
  if balance.quantity_on_hand<>expected then raise exception 'ยอดเปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนปรับยอด' using errcode='40001';end if;
  delta := target-balance.quantity_on_hand;
  if delta<>0 then
    insert into boy_central.stock_movements(company_id,branch_id,location_id,item_id,movement_type,quantity_before,quantity_delta,quantity_after,unit_cost_base,movement_value,source_system,external_id,created_by,reason)
      values(b.company_id,b.id,loc,item,'adjustment',balance.quantity_on_hand,delta,target,balance.average_unit_cost,abs(delta)*balance.average_unit_cost,'water_admin',rid::text,auth.uid(),reason);
    update boy_central.inventory_balances set quantity_on_hand=target,inventory_value=target*average_unit_cost,updated_at=clock_timestamp() where id=balance.id;
  end if;
  answer := jsonb_build_object('status','saved','quantity',target);
  insert into boy_central.audit_log(company_id,branch_id,actor_user_id,action,entity_type,entity_id,source_system,request_id,before_data,after_data)
    values(b.company_id,b.id,auth.uid(),'water_admin_set_stock','inventory_balances',balance.id::text,'water_admin',rid::text,
      jsonb_build_object('quantity',expected),jsonb_build_object('payload',payload,'result',answer));
  return answer;
end $$;
revoke all on function boy_central.admin_set_water_stock(jsonb) from public,anon;
grant execute on function boy_central.admin_set_water_stock(jsonb) to authenticated;
