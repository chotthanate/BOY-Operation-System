create or replace function boy_central.save_pos_device_config(device_token text,new_config jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare d boy_central.pos_devices%rowtype; new_version bigint;
begin
  select * into d from boy_central_private.pos_device_for_token(device_token);
  if d.id is null then raise exception 'device access denied'; end if;
  if jsonb_typeof(new_config)<>'object' then raise exception 'config must be an object'; end if;
  insert into boy_central.pos_branch_configs(company_id,branch_id,config,version)
  values(d.company_id,d.branch_id,new_config,1)
  on conflict(branch_id) do update set config=excluded.config,version=boy_central.pos_branch_configs.version+1,updated_at=now()
  returning version into new_version;
  update boy_central.pos_devices set last_seen_at=now(),last_sync_at=now() where id=d.id;
  return jsonb_build_object('status','saved','version',new_version);
end $$;

create or replace function boy_central.sync_pos_stock_adjustment(device_token text,event jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare d boy_central.pos_devices%rowtype; ext_id text; at_time timestamptz; inserted_id uuid; delta jsonb;
  target_item_id uuid; target_location_id uuid; balance boy_central.inventory_balances%rowtype; amount numeric;
begin
  select * into d from boy_central_private.pos_device_for_token(device_token);
  if d.id is null then raise exception 'device access denied'; end if;
  ext_id:=event->>'external_id'; at_time:=coalesce(nullif(event->>'occurred_at','')::timestamptz,now());
  if trim(coalesce(ext_id,''))='' then raise exception 'external id is required'; end if;
  insert into boy_central.pos_sync_events(company_id,branch_id,device_id,event_type,external_id,payload,occurred_at)
  values(d.company_id,d.branch_id,d.id,'STOCK_ADJUST',ext_id,event,at_time)
  on conflict(branch_id,source_system,event_type,external_id) do nothing returning id into inserted_id;
  if inserted_id is null then return jsonb_build_object('status','duplicate','external_id',ext_id); end if;
  for delta in select value from jsonb_array_elements(coalesce(event->'stock_deltas','[]'::jsonb)) loop
    amount:=(delta->>'quantity_delta')::numeric;
    select bi.item_id,bi.default_location_id into target_item_id,target_location_id
    from boy_central.branch_items bi join boy_central.items i on i.id=bi.item_id
    where bi.branch_id=d.branch_id and bi.active and (i.id::text=delta->>'central_item_id' or i.name=delta->>'name') limit 1;
    if target_item_id is not null and target_location_id is not null and amount<>0 then
      select * into balance from boy_central.inventory_balances where location_id=target_location_id and item_id=target_item_id for update;
      if balance.id is null then
        insert into boy_central.inventory_balances(company_id,branch_id,location_id,item_id,quantity_on_hand,average_unit_cost,inventory_value)
        values(d.company_id,d.branch_id,target_location_id,target_item_id,0,0,0) returning * into balance;
      end if;
      insert into boy_central.stock_movements(company_id,branch_id,location_id,item_id,movement_type,quantity_before,quantity_delta,quantity_after,unit_cost_base,movement_value,source_system,external_id,occurred_at,reason)
      values(d.company_id,d.branch_id,target_location_id,target_item_id,'adjustment',balance.quantity_on_hand,amount,balance.quantity_on_hand+amount,
        balance.average_unit_cost,abs(amount)*balance.average_unit_cost,'water_pos',ext_id||':'||target_item_id,at_time,coalesce(event->>'reason','ปรับสต็อกจาก Water POS'));
      update boy_central.inventory_balances set quantity_on_hand=quantity_on_hand+amount,
        inventory_value=(quantity_on_hand+amount)*average_unit_cost,updated_at=now() where id=balance.id;
    end if;
  end loop;
  update boy_central.pos_devices set last_seen_at=now(),last_sync_at=now() where id=d.id;
  return jsonb_build_object('status','processed','event_id',inserted_id,'external_id',ext_id);
end $$;

revoke all on function boy_central.save_pos_device_config(text,jsonb) from public;
grant execute on function boy_central.save_pos_device_config(text,jsonb) to anon,authenticated;
revoke all on function boy_central.sync_pos_stock_adjustment(text,jsonb) from public;
grant execute on function boy_central.sync_pos_stock_adjustment(text,jsonb) to anon,authenticated;

notify pgrst,'reload schema';
