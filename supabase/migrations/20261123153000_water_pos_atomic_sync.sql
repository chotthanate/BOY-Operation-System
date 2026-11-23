-- Water-only adapter. Existing Burger and Grill clients retain their RPC behavior.
create or replace function boy_central.sync_water_pos_event(device_token text,event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 d boy_central.pos_devices%rowtype; result jsonb; previous jsonb; kind text; ext text;
 target_order uuid; target_line uuid; line jsonb; opt jsonb; delta jsonb;
 item_id_value uuid; location_id_value uuid; bal boy_central.inventory_balances%rowtype;
 normalized jsonb; shift_payload jsonb; n integer; optn integer;
begin
 select * into d from boy_central_private.pos_device_for_token(device_token);
 if d.id is null or d.device_code not like 'WATER-%' then raise exception 'water device access denied'; end if;
 kind:=upper(event->>'event_type');ext:=event->>'external_id';
 if kind not in ('ORDER','VOID','SHIFT_OPEN','SHIFT_CLOSE','STOCK_ADJUST','HEARTBEAT') or nullif(ext,'') is null then raise exception 'invalid water event';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(d.branch_id::text||':water:'||kind||':'||ext,0));
 select payload into previous from boy_central.pos_sync_events where branch_id=d.branch_id and source_system='water_pos' and event_type=kind and external_id=ext;
 if previous is not null then
   if previous <> event then raise exception 'event id already has different payload';end if;
   return jsonb_build_object('status','duplicate','external_id',ext);
 end if;
 if kind='SHIFT_CLOSE' then
   shift_payload:=event->'data';
   if coalesce((shift_payload->>'cash')::numeric,0)+coalesce((shift_payload->>'transfer')::numeric,0)+coalesce((shift_payload->>'government')::numeric,0)+coalesce((shift_payload->>'other')::numeric,0) <> coalesce((shift_payload->'metrics'->>'revenue')::numeric,0) then raise exception 'shift payment totals mismatch';end if;
   if not exists(select 1 from boy_central.pos_shifts where branch_id=d.branch_id and source_system='water_pos' and external_id=ext) then raise exception 'shift open missing';end if;
 end if;
 -- Reject ambiguous or unresolved stock rows rather than silently skipping them.
 for delta in select value from jsonb_array_elements(coalesce(event->'stock_deltas','[]')) loop
   select r.item_id,r.location_id into item_id_value,location_id_value from boy_central_private.resolve_pos_stock_item(d.branch_id,delta->>'central_item_id',null,delta->>'name') r;
   if item_id_value is null or location_id_value is null then raise exception 'unmapped stock item %',delta->>'name';end if;
   if (delta->>'quantity_delta')::numeric is null then raise exception 'stock quantity missing';end if;
 end loop;
 normalized:=event;
 -- Native payment IDs remain in raw payload; server payment normalization uses immutable type.
 if kind='ORDER' and nullif(event->'data'->>'paymentType','') is not null then
   normalized:=jsonb_set(normalized,'{data,payment}',to_jsonb(event->'data'->>'paymentType'));
 end if;
 result:=boy_central.sync_pos_event(device_token,normalized);
 update boy_central.pos_sync_events set payload=event where branch_id=d.branch_id and source_system='water_pos' and event_type=kind and external_id=ext;
 if kind='ORDER' then
   select id into target_order from boy_central.pos_orders where branch_id=d.branch_id and source_system='water_pos' and external_id=ext;
   update boy_central.pos_orders set raw_payload=event->'data' where id=target_order;
   for line in select value from jsonb_array_elements(event->'data'->'items') loop
     select id into target_line from boy_central.pos_order_lines where pos_order_id=target_order and external_id=line->>'id';
     if target_line is null then raise exception 'order line missing';end if;
     optn:=0;
     for opt in select value from jsonb_array_elements(coalesce(line->'options',line->'addons','[]')) loop
       optn:=optn+1;
       insert into boy_central.pos_order_modifiers(company_id,pos_order_line_id,external_id,name,quantity,price_delta)
       values(d.company_id,target_line,coalesce(opt->>'id',optn::text),opt->>'name',1,coalesce((opt->>'price')::numeric,0));
     end loop;
   end loop;
 elsif kind in ('STOCK_ADJUST','VOID') then
   for delta in select value from jsonb_array_elements(coalesce(event->'stock_deltas','[]')) loop
     select r.item_id,r.location_id into item_id_value,location_id_value from boy_central_private.resolve_pos_stock_item(d.branch_id,delta->>'central_item_id',null,delta->>'name') r;
     select * into bal from boy_central.inventory_balances where location_id=location_id_value and item_id=item_id_value for update;
     if bal.id is null then raise exception 'stock balance missing';end if;
     insert into boy_central.stock_movements(company_id,branch_id,location_id,item_id,movement_type,quantity_before,quantity_delta,quantity_after,unit_cost_base,movement_value,source_system,external_id,occurred_at,reason)
     values(d.company_id,d.branch_id,location_id_value,item_id_value,case when kind='VOID' then 'sale_void' else 'adjustment' end,bal.quantity_on_hand,(delta->>'quantity_delta')::numeric,bal.quantity_on_hand+(delta->>'quantity_delta')::numeric,bal.average_unit_cost,abs((delta->>'quantity_delta')::numeric)*bal.average_unit_cost,'water_pos',ext||':'||item_id_value,coalesce((event->>'occurred_at')::timestamptz,now()),coalesce(event->>'reason','คืนสต๊อกจาก BOY Water POS'));
     update boy_central.inventory_balances set quantity_on_hand=quantity_on_hand+(delta->>'quantity_delta')::numeric,inventory_value=(quantity_on_hand+(delta->>'quantity_delta')::numeric)*average_unit_cost,updated_at=now() where id=bal.id;
   end loop;
 end if;
 return result;
end $$;
revoke all on function boy_central.sync_water_pos_event(text,jsonb) from public;
grant execute on function boy_central.sync_water_pos_event(text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
