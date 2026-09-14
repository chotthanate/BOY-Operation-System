create or replace function boy_central.sync_pos_event(device_token text,event jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare d boy_central.pos_devices%rowtype; event_name text; ext_id text; at_time timestamptz; inserted_id uuid;
  target_shift_id uuid; target_order_id uuid; target_tx_id uuid; line jsonb; delta jsonb; balance boy_central.inventory_balances%rowtype;
  target_item_id uuid; target_location_id uuid; method_name text;
begin
  select * into d from boy_central_private.pos_device_for_token(device_token);
  if d.id is null then raise exception 'device access denied'; end if;
  event_name:=upper(coalesce(event->>'event_type','')); ext_id:=event->>'external_id'; at_time:=coalesce(nullif(event->>'occurred_at','')::timestamptz,now());
  if event_name not in ('ORDER','VOID','SHIFT_OPEN','SHIFT_CLOSE','STOCK_ADJUST','HEARTBEAT') or trim(coalesce(ext_id,''))='' then raise exception 'invalid event'; end if;
  insert into boy_central.pos_sync_events(company_id,branch_id,device_id,event_type,external_id,payload,occurred_at)
  values(d.company_id,d.branch_id,d.id,event_name,ext_id,event,at_time)
  on conflict(branch_id,source_system,event_type,external_id) do nothing returning id into inserted_id;
  if inserted_id is null then return jsonb_build_object('status','duplicate','external_id',ext_id); end if;

  if event_name='SHIFT_OPEN' then
    insert into boy_central.pos_shifts(company_id,branch_id,source_system,external_id,opened_at,opening_cash,status,raw_payload)
    values(d.company_id,d.branch_id,'water_pos',ext_id,at_time,coalesce((event->'data'->>'openingCash')::numeric,0),'open',event->'data')
    on conflict(company_id,source_system,external_id) do update set raw_payload=excluded.raw_payload,updated_at=now();
  elsif event_name='SHIFT_CLOSE' then
    update boy_central.pos_shifts set closed_at=at_time,closing_cash=nullif(event->'data'->>'countedCash','')::numeric,
      expected_cash=nullif(event->'data'->'metrics'->>'expectedCash','')::numeric,cash_difference=nullif(event->'data'->>'difference','')::numeric,
      status='closed',raw_payload=event->'data',updated_at=now()
    where company_id=d.company_id and source_system='water_pos' and external_id=coalesce(event->'data'->>'id',ext_id);
  elsif event_name='ORDER' then
    select id into target_shift_id from boy_central.pos_shifts where company_id=d.company_id and source_system='water_pos' and external_id=event->'data'->>'shiftId';
    insert into boy_central.transactions(company_id,branch_id,transaction_no,transaction_type,transaction_date,occurred_at,subtotal,discount,tax,total_amount,status,affects_stock,source_system,external_id,idempotency_key,note)
    values(d.company_id,d.branch_id,'WPOS-'||ext_id,'sale',(at_time at time zone 'Asia/Bangkok')::date,at_time,
      coalesce((event->'data'->>'subtotal')::numeric,0),coalesce((event->'data'->>'discount')::numeric,0),coalesce((event->'data'->>'vatAmount')::numeric,0),
      coalesce((event->'data'->>'total')::numeric,0),'confirmed',true,'water_pos',ext_id,'water_pos:order:'||ext_id,event->'data'->>'note')
    on conflict(company_id,source_system,idempotency_key) do update set updated_at=now() returning id into target_tx_id;
    insert into boy_central.pos_orders(company_id,branch_id,shift_id,transaction_id,source_system,external_id,order_no,sales_channel,payment_method,subtotal,discount,total_amount,payment_status,ordered_at,raw_payload)
    values(d.company_id,d.branch_id,target_shift_id,target_tx_id,'water_pos',ext_id,coalesce(event->'data'->>'orderNo',ext_id),'walk_in',event->'data'->>'payment',
      coalesce((event->'data'->>'subtotal')::numeric,0),coalesce((event->'data'->>'discount')::numeric,0),coalesce((event->'data'->>'total')::numeric,0),'completed',at_time,event->'data')
    on conflict(company_id,source_system,external_id) do update set raw_payload=excluded.raw_payload,updated_at=now() returning id into target_order_id;
    if not exists(select 1 from boy_central.pos_order_lines where pos_order_id=target_order_id) then
      for line in select value from jsonb_array_elements(coalesce(event->'data'->'items','[]'::jsonb)) loop
        insert into boy_central.pos_order_lines(company_id,pos_order_id,external_id,item_name,quantity,unit_price,line_total,note)
        values(d.company_id,target_order_id,line->>'id',line->>'name',coalesce((line->>'qty')::numeric,1),
          coalesce((line->>'total')::numeric/nullif((line->>'qty')::numeric,0),0),coalesce((line->>'total')::numeric,0),
          concat_ws(' · ',nullif(line->>'note',''),nullif(line->>'packaging','')));
      end loop;
      method_name:=case event->'data'->>'payment' when 'cash' then 'cash' when 'transfer' then 'transfer' when 'government' then 'thai_co_pay' else 'other' end;
      insert into boy_central.payments(company_id,transaction_id,method,amount,paid_at,status,note)
      values(d.company_id,target_tx_id,method_name,coalesce((event->'data'->>'total')::numeric,0),at_time,'paid','Water POS');
      for delta in select value from jsonb_array_elements(coalesce(event->'stock_deltas','[]'::jsonb)) loop
        select bi.item_id,bi.default_location_id into target_item_id,target_location_id from boy_central.branch_items bi join boy_central.items i on i.id=bi.item_id
          where bi.branch_id=d.branch_id and bi.active and (i.id::text=delta->>'central_item_id' or i.name=delta->>'name') limit 1;
        if target_item_id is not null and target_location_id is not null then
          select * into balance from boy_central.inventory_balances where location_id=target_location_id and item_id=target_item_id for update;
          if balance.id is null then
            insert into boy_central.inventory_balances(company_id,branch_id,location_id,item_id,quantity_on_hand,average_unit_cost,inventory_value)
            values(d.company_id,d.branch_id,target_location_id,target_item_id,0,0,0) returning * into balance;
          end if;
          insert into boy_central.stock_movements(company_id,branch_id,location_id,item_id,transaction_id,movement_type,quantity_before,quantity_delta,quantity_after,unit_cost_base,movement_value,source_system,external_id,occurred_at,reason)
          values(d.company_id,d.branch_id,target_location_id,target_item_id,target_tx_id,'sale',balance.quantity_on_hand,(delta->>'quantity_delta')::numeric,
            balance.quantity_on_hand+(delta->>'quantity_delta')::numeric,balance.average_unit_cost,abs((delta->>'quantity_delta')::numeric)*balance.average_unit_cost,
            'water_pos',ext_id||':'||target_item_id,at_time,'ตัดสต็อกจาก Water POS');
          update boy_central.inventory_balances set quantity_on_hand=quantity_on_hand+(delta->>'quantity_delta')::numeric,
            inventory_value=(quantity_on_hand+(delta->>'quantity_delta')::numeric)*average_unit_cost,updated_at=now() where id=balance.id;
        end if;
      end loop;
    end if;
  elsif event_name='VOID' then
    update boy_central.pos_orders set payment_status=case when coalesce(event->'data'->>'refundMethod','')<>'' then 'refunded' else 'voided' end,
      voided_at=at_time,void_reason=event->'data'->>'voidReason',raw_payload=event->'data',updated_at=now()
    where company_id=d.company_id and source_system='water_pos' and external_id=event->'data'->>'id';
    update boy_central.transactions set status='voided',void_reason=event->'data'->>'voidReason',updated_at=now()
    where company_id=d.company_id and source_system='water_pos' and external_id=event->'data'->>'id';
    update boy_central.payments p set status=case when coalesce(event->'data'->>'refundMethod','')<>'' then 'refunded' else 'voided' end
    from boy_central.transactions t where p.transaction_id=t.id and t.company_id=d.company_id and t.source_system='water_pos' and t.external_id=event->'data'->>'id';
  end if;
  update boy_central.pos_devices set last_seen_at=now(),last_sync_at=now(),app_version=event->>'app_version' where id=d.id;
  return jsonb_build_object('status','processed','event_id',inserted_id,'external_id',ext_id);
end $$;


notify pgrst,'reload schema';
