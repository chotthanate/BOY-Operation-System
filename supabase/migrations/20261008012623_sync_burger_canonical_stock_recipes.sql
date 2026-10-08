-- Canonical stock resolution for POS events and shared recipe master data.

create or replace function boy_central_private.resolve_pos_stock_item(
  target_branch_id uuid,
  requested_item_id text,
  legacy_key text default null,
  legacy_name text default null
)
returns table(item_id uuid, location_id uuid)
language plpgsql
stable
security definer
set search_path=''
as $$
declare requested_uuid uuid;
begin
  if nullif(trim(coalesce(requested_item_id,'')),'') is not null then
    if requested_item_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return;
    end if;
    requested_uuid := requested_item_id::uuid;
    return query
      select coalesce(source_item.stock_target_item_id,source_item.id), target_link.default_location_id
      from boy_central.items source_item
      join boy_central.branch_items source_link
        on source_link.branch_id=target_branch_id and source_link.item_id=source_item.id and source_link.active
      join boy_central.items target_item on target_item.id=coalesce(source_item.stock_target_item_id,source_item.id)
      join boy_central.branch_items target_link
        on target_link.branch_id=target_branch_id and target_link.item_id=target_item.id and target_link.active
      where source_item.id=requested_uuid and target_item.track_stock
      limit 1;
    return;
  end if;

  -- Legacy fallback is intentionally used only when the sender has no UUID.
  return query
    with candidate as (
      select i.*
      from boy_central.pos_master_mappings m
      join boy_central.items i on i.id=m.item_id
      where m.branch_id=target_branch_id and m.entity_type='ingredient'
        and nullif(trim(coalesce(legacy_key,'')),'') is not null and m.legacy_key=legacy_key
      union all
      select i.*
      from boy_central.items i
      join boy_central.branch_items bi on bi.branch_id=target_branch_id and bi.item_id=i.id and bi.active
      where nullif(trim(coalesce(legacy_name,'')),'') is not null and i.name=legacy_name
        and not exists (
          select 1 from boy_central.pos_master_mappings m
          where m.branch_id=target_branch_id and m.entity_type='ingredient' and m.legacy_key=legacy_key
        )
      limit 1
    )
    select coalesce(source_item.stock_target_item_id,source_item.id), target_link.default_location_id
    from candidate source_item
    join boy_central.items target_item on target_item.id=coalesce(source_item.stock_target_item_id,source_item.id)
    join boy_central.branch_items target_link
      on target_link.branch_id=target_branch_id and target_link.item_id=target_item.id and target_link.active
    where target_item.track_stock
    limit 1;
end $$;

revoke all on function boy_central_private.resolve_pos_stock_item(uuid,text,text,text) from public,anon,authenticated;

-- Recipes always point to the canonical stock row, never to a purchase-brand row.
update boy_central.recipes r
set item_id=i.stock_target_item_id, updated_at=now()
from boy_central.items i
where i.id=r.item_id and i.stock_target_item_id is not null and r.item_id<>i.stock_target_item_id;

create or replace function boy_central.get_pos_device_bootstrap(device_token text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare d boy_central.pos_devices%rowtype; result jsonb;
begin
  select * into d from boy_central_private.pos_device_for_token(device_token);
  if d.id is null then raise exception 'device access denied'; end if;
  update boy_central.pos_devices set last_seen_at=now() where id=d.id;
  select jsonb_build_object(
    'server_time',now(),'device_id',d.id,'device_code',d.device_code,'device_name',d.device_name,
    'branch_id',b.id,'branch_code',b.code,'branch_name',b.name,'company_name',c.name,
    'version',coalesce(cfg.version,0),'config',coalesce(cfg.config,'{}'::jsonb),
    'master_version',greatest(
      coalesce(extract(epoch from (select max(updated_at) from boy_central.items where company_id=d.company_id))*1000,0),
      coalesce(extract(epoch from (select max(updated_at) from boy_central.menus where company_id=d.company_id))*1000,0),
      coalesce(extract(epoch from (select max(updated_at) from boy_central.recipes where company_id=d.company_id))*1000,0),
      coalesce(extract(epoch from (select max(updated_at) from boy_central.pos_master_mappings where branch_id=d.branch_id))*1000,0),
      coalesce(cfg.version,0)
    )::bigint,
    'inventory',coalesce((select jsonb_agg(jsonb_build_object(
      'central_item_id',i.id,'code',i.code,'name',i.name,'quantity',coalesce(ib.quantity_on_hand,0),
      'unit',u.name,'low_stock',bi.minimum_stock,'target_stock',bi.target_stock
    ) order by i.name) from boy_central.branch_items bi join boy_central.items i on i.id=bi.item_id
      join boy_central.units u on u.id=i.base_unit_id left join boy_central.inventory_balances ib on ib.branch_id=bi.branch_id and ib.item_id=bi.item_id
      where bi.branch_id=b.id and bi.active and i.track_stock and i.stock_target_item_id is null),'[]'::jsonb),
    'ingredient_mappings',coalesce((select jsonb_agg(jsonb_build_object(
      'legacy_key',m.legacy_key,'source_name',m.source_name,'central_item_id',target.id,
      'central_item_name',target.name,'unit',u.name
    ) order by m.legacy_key)
      from boy_central.pos_master_mappings m
      join boy_central.items source on source.id=m.item_id
      join boy_central.items target on target.id=coalesce(source.stock_target_item_id,source.id)
      join boy_central.units u on u.id=target.base_unit_id
      join boy_central.branch_items bi on bi.branch_id=m.branch_id and bi.item_id=target.id and bi.active
      where m.branch_id=b.id and m.entity_type='ingredient' and target.track_stock),'[]'::jsonb),
    'recipes',coalesce((select jsonb_agg(jsonb_build_object(
      'product_id',pm.legacy_key,'product_name',menu.name,'ingredient_id',im.legacy_key,
      'central_item_id',target.id,'central_item_name',target.name,'quantity',r.quantity_base
    ) order by pm.legacy_key,im.legacy_key)
      from boy_central.recipes r
      join boy_central.menus menu on menu.id=r.menu_id and menu.active
      join boy_central.pos_master_mappings pm on pm.branch_id=b.id and pm.entity_type='product' and pm.menu_id=menu.id
      join boy_central.items recipe_item on recipe_item.id=r.item_id
      join boy_central.items target on target.id=coalesce(recipe_item.stock_target_item_id,recipe_item.id)
      join lateral (
        select m.legacy_key from boy_central.pos_master_mappings m
        join boy_central.items mapped on mapped.id=m.item_id
        where m.branch_id=b.id and m.entity_type='ingredient'
          and coalesce(mapped.stock_target_item_id,mapped.id)=target.id
        order by (mapped.id=target.id) desc,m.updated_at desc limit 1
      ) im on true
      where r.company_id=d.company_id and r.active and target.track_stock),'[]'::jsonb)
  ) into result from boy_central.branches b join boy_central.companies c on c.id=b.company_id
    left join boy_central.pos_branch_configs cfg on cfg.branch_id=b.id where b.id=d.branch_id;
  return result;
end $$;

create or replace function boy_central.admin_save_branch_recipe(payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare target_branch boy_central.branches%rowtype; target_menu boy_central.menus%rowtype;
  recipe_line jsonb; requested_item boy_central.items%rowtype; canonical_item_id uuid; saved_count integer:=0;
begin
  select * into target_branch from boy_central.branches where code=upper(trim(payload->>'branch_code')) and active limit 1;
  if target_branch.id is null or not boy_central_private.has_branch_access(target_branch.id,array['manager']) then
    raise exception 'branch access denied';
  end if;
  select * into target_menu from boy_central.menus
  where id=nullif(payload->>'menu_id','')::uuid and company_id=target_branch.company_id and active;
  if target_menu.id is null or not exists(
    select 1 from boy_central.pos_master_mappings m
    where m.branch_id=target_branch.id and m.entity_type='product' and m.menu_id=target_menu.id
  ) then raise exception 'menu is not available for this branch'; end if;
  if jsonb_typeof(coalesce(payload->'lines','[]'::jsonb))<>'array' then raise exception 'recipe lines must be an array'; end if;

  delete from boy_central.recipes where company_id=target_branch.company_id and menu_id=target_menu.id;
  for recipe_line in select value from jsonb_array_elements(coalesce(payload->'lines','[]'::jsonb)) loop
    select * into requested_item from boy_central.items
    where id=nullif(recipe_line->>'item_id','')::uuid and company_id=target_branch.company_id and active;
    canonical_item_id:=coalesce(requested_item.stock_target_item_id,requested_item.id);
    if canonical_item_id is null or not exists(
      select 1 from boy_central.items i join boy_central.branch_items bi on bi.item_id=i.id
      where i.id=canonical_item_id and i.track_stock and i.stock_target_item_id is null
        and bi.branch_id=target_branch.id and bi.active
    ) then raise exception 'recipe item must be a canonical stock item'; end if;
    if coalesce((recipe_line->>'quantity')::numeric,0)<=0 then raise exception 'recipe quantity must be greater than zero'; end if;
    insert into boy_central.recipes(company_id,menu_id,item_id,quantity_base,active)
    values(target_branch.company_id,target_menu.id,canonical_item_id,(recipe_line->>'quantity')::numeric,true)
    on conflict(menu_id,item_id) do update set quantity_base=excluded.quantity_base,active=true,updated_at=now();
    saved_count:=saved_count+1;
  end loop;
  insert into boy_central.pos_branch_configs(company_id,branch_id,config,version)
  values(target_branch.company_id,target_branch.id,'{}'::jsonb,1)
  on conflict(branch_id) do update set version=boy_central.pos_branch_configs.version+1,updated_at=now();
  return jsonb_build_object('status','saved','menu_id',target_menu.id,'line_count',saved_count);
end $$;

revoke all on function boy_central.admin_save_branch_recipe(jsonb) from public,anon;
grant execute on function boy_central.admin_save_branch_recipe(jsonb) to authenticated;

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
    select r.item_id,r.location_id into target_item_id,target_location_id
    from boy_central_private.resolve_pos_stock_item(d.branch_id,delta->>'central_item_id',delta->>'legacy_ingredient_id',delta->>'name') r;
    if nullif(delta->>'central_item_id','') is not null and target_item_id is null then
      raise exception 'unknown central stock item %',delta->>'central_item_id';
    end if;
    if target_item_id is not null and target_location_id is not null and amount<>0 then
      select * into balance from boy_central.inventory_balances where location_id=target_location_id and item_id=target_item_id for update;
      if balance.id is null then
        insert into boy_central.inventory_balances(company_id,branch_id,location_id,item_id,quantity_on_hand,average_unit_cost,inventory_value)
        values(d.company_id,d.branch_id,target_location_id,target_item_id,0,0,0) returning * into balance;
      end if;
      insert into boy_central.stock_movements(company_id,branch_id,location_id,item_id,movement_type,quantity_before,quantity_delta,quantity_after,unit_cost_base,movement_value,source_system,external_id,occurred_at,reason)
      values(d.company_id,d.branch_id,target_location_id,target_item_id,'adjustment',balance.quantity_on_hand,amount,balance.quantity_on_hand+amount,
        balance.average_unit_cost,abs(amount)*balance.average_unit_cost,'burger_pos',ext_id||':'||target_item_id,at_time,coalesce(event->>'reason','ปรับสต็อกจาก Burger POS'));
      update boy_central.inventory_balances set quantity_on_hand=quantity_on_hand+amount,
        inventory_value=(quantity_on_hand+amount)*average_unit_cost,updated_at=now() where id=balance.id;
    end if;
  end loop;
  update boy_central.pos_devices set last_seen_at=now(),last_sync_at=now(),app_version=event->>'app_version' where id=d.id;
  return jsonb_build_object('status','processed','event_id',inserted_id,'external_id',ext_id);
end $$;

-- Replace only the ORDER receiver. Other event types retain their existing behavior.
create or replace function boy_central.sync_pos_event(device_token text,event jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare d boy_central.pos_devices%rowtype; event_name text; ext_id text; at_time timestamptz; inserted_id uuid;
  target_shift_id uuid; target_order_id uuid; target_tx_id uuid; line jsonb; delta jsonb; balance boy_central.inventory_balances%rowtype;
  target_item_id uuid; target_location_id uuid; method_name text; source_name text;
begin
  select * into d from boy_central_private.pos_device_for_token(device_token);
  if d.id is null then raise exception 'device access denied'; end if;
  source_name:=case when d.device_code like 'BURGER%' then 'burger_pos' else 'water_pos' end;
  event_name:=upper(coalesce(event->>'event_type','')); ext_id:=event->>'external_id'; at_time:=coalesce(nullif(event->>'occurred_at','')::timestamptz,now());
  if event_name not in ('ORDER','VOID','SHIFT_OPEN','SHIFT_CLOSE','STOCK_ADJUST','HEARTBEAT') or trim(coalesce(ext_id,''))='' then raise exception 'invalid event'; end if;
  insert into boy_central.pos_sync_events(company_id,branch_id,device_id,event_type,external_id,payload,occurred_at)
  values(d.company_id,d.branch_id,d.id,event_name,ext_id,event,at_time)
  on conflict(branch_id,source_system,event_type,external_id) do nothing returning id into inserted_id;
  if inserted_id is null then return jsonb_build_object('status','duplicate','external_id',ext_id); end if;

  if event_name='SHIFT_OPEN' then
    insert into boy_central.pos_shifts(company_id,branch_id,source_system,external_id,opened_at,opening_cash,status,raw_payload)
    values(d.company_id,d.branch_id,source_name,ext_id,at_time,coalesce((event->'data'->>'openingCash')::numeric,0),'open',event->'data')
    on conflict(company_id,source_system,external_id) do update set raw_payload=excluded.raw_payload,updated_at=now();
  elsif event_name='SHIFT_CLOSE' then
    update boy_central.pos_shifts set closed_at=at_time,closing_cash=nullif(event->'data'->>'countedCash','')::numeric,
      expected_cash=nullif(event->'data'->'metrics'->>'expectedCash','')::numeric,cash_difference=nullif(event->'data'->>'difference','')::numeric,
      status='closed',raw_payload=event->'data',updated_at=now()
    where company_id=d.company_id and source_system=source_name and external_id=coalesce(event->'data'->>'id',ext_id);
  elsif event_name='ORDER' then
    select id into target_shift_id from boy_central.pos_shifts where company_id=d.company_id and source_system=source_name and external_id=event->'data'->>'shiftId';
    insert into boy_central.transactions(company_id,branch_id,transaction_no,transaction_type,transaction_date,occurred_at,subtotal,discount,tax,total_amount,status,affects_stock,source_system,external_id,idempotency_key,note)
    values(d.company_id,d.branch_id,case when source_name='burger_pos' then 'BPOS-' else 'WPOS-' end||ext_id,'sale',(at_time at time zone 'Asia/Bangkok')::date,at_time,
      coalesce((event->'data'->>'subtotal')::numeric,0),coalesce((event->'data'->>'discount')::numeric,0),coalesce((event->'data'->>'vatAmount')::numeric,0),
      coalesce((event->'data'->>'total')::numeric,0),'confirmed',true,source_name,ext_id,source_name||':order:'||ext_id,event->'data'->>'note')
    on conflict(company_id,source_system,idempotency_key) do update set updated_at=now() returning id into target_tx_id;
    insert into boy_central.pos_orders(company_id,branch_id,shift_id,transaction_id,source_system,external_id,order_no,sales_channel,payment_method,subtotal,discount,total_amount,payment_status,ordered_at,raw_payload)
    values(d.company_id,d.branch_id,target_shift_id,target_tx_id,source_name,ext_id,coalesce(event->'data'->>'orderNo',ext_id),'walk_in',event->'data'->>'payment',
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
      values(d.company_id,target_tx_id,method_name,coalesce((event->'data'->>'total')::numeric,0),at_time,'paid',case when source_name='burger_pos' then 'Burger POS' else 'Water POS' end);
      for delta in select value from jsonb_array_elements(coalesce(event->'stock_deltas','[]'::jsonb)) loop
        select r.item_id,r.location_id into target_item_id,target_location_id
        from boy_central_private.resolve_pos_stock_item(d.branch_id,delta->>'central_item_id',delta->>'legacy_ingredient_id',delta->>'name') r;
        if nullif(delta->>'central_item_id','') is not null and target_item_id is null then raise exception 'unknown central stock item %',delta->>'central_item_id'; end if;
        if target_item_id is not null and target_location_id is not null then
          select * into balance from boy_central.inventory_balances where location_id=target_location_id and item_id=target_item_id for update;
          if balance.id is null then
            insert into boy_central.inventory_balances(company_id,branch_id,location_id,item_id,quantity_on_hand,average_unit_cost,inventory_value)
            values(d.company_id,d.branch_id,target_location_id,target_item_id,0,0,0) returning * into balance;
          end if;
          insert into boy_central.stock_movements(company_id,branch_id,location_id,item_id,transaction_id,movement_type,quantity_before,quantity_delta,quantity_after,unit_cost_base,movement_value,source_system,external_id,occurred_at,reason)
          values(d.company_id,d.branch_id,target_location_id,target_item_id,target_tx_id,'sale',balance.quantity_on_hand,(delta->>'quantity_delta')::numeric,
            balance.quantity_on_hand+(delta->>'quantity_delta')::numeric,balance.average_unit_cost,abs((delta->>'quantity_delta')::numeric)*balance.average_unit_cost,
            source_name,ext_id||':'||target_item_id,at_time,case when source_name='burger_pos' then 'ตัดสต็อกจาก Burger POS' else 'ตัดสต็อกจาก Water POS' end);
          update boy_central.inventory_balances set quantity_on_hand=quantity_on_hand+(delta->>'quantity_delta')::numeric,
            inventory_value=(quantity_on_hand+(delta->>'quantity_delta')::numeric)*average_unit_cost,updated_at=now() where id=balance.id;
        end if;
      end loop;
    end if;
  elsif event_name='VOID' then
    update boy_central.pos_orders set payment_status=case when coalesce(event->'data'->>'refundMethod','')<>'' then 'refunded' else 'voided' end,
      voided_at=at_time,void_reason=event->'data'->>'voidReason',raw_payload=event->'data',updated_at=now()
    where company_id=d.company_id and source_system=source_name and external_id=event->'data'->>'id';
    update boy_central.transactions set status='voided',void_reason=event->'data'->>'voidReason',updated_at=now()
    where company_id=d.company_id and source_system=source_name and external_id=event->'data'->>'id';
    update boy_central.payments p set status=case when coalesce(event->'data'->>'refundMethod','')<>'' then 'refunded' else 'voided' end
    from boy_central.transactions t where p.transaction_id=t.id and t.company_id=d.company_id and t.source_system=source_name and t.external_id=event->'data'->>'id';
  end if;
  update boy_central.pos_devices set last_seen_at=now(),last_sync_at=now(),app_version=event->>'app_version' where id=d.id;
  return jsonb_build_object('status','processed','event_id',inserted_id,'external_id',ext_id);
end $$;

-- Audit-preserving reconciliation for movements that can be proven to have been
-- sent with a canonical UUID but were stored on a purchase-brand row.
do $$
declare rec record; source_balance boy_central.inventory_balances%rowtype; target_balance boy_central.inventory_balances%rowtype;
begin
  for rec in
    select distinct sm.*, source.stock_target_item_id as target_item_id, target_link.default_location_id as target_location_id
    from boy_central.stock_movements sm
    join boy_central.items source on source.id=sm.item_id and source.stock_target_item_id is not null
    join boy_central.branch_items target_link on target_link.branch_id=sm.branch_id and target_link.item_id=source.stock_target_item_id and target_link.active
    join boy_central.pos_sync_events e on e.branch_id=sm.branch_id
      and sm.external_id=e.external_id||':'||sm.item_id::text
    join lateral jsonb_array_elements(coalesce(e.payload->'stock_deltas','[]'::jsonb)) delta on true
    where delta->>'central_item_id'=source.stock_target_item_id::text
      and (delta->>'quantity_delta')::numeric=sm.quantity_delta
      and not exists(select 1 from boy_central.stock_movements done where done.external_id='reconcile:'||sm.id::text||':source')
    order by sm.occurred_at,sm.created_at
  loop
    select * into source_balance from boy_central.inventory_balances
      where branch_id=rec.branch_id and location_id=rec.location_id and item_id=rec.item_id for update;
    select * into target_balance from boy_central.inventory_balances
      where branch_id=rec.branch_id and location_id=rec.target_location_id and item_id=rec.target_item_id for update;
    if target_balance.id is null then
      insert into boy_central.inventory_balances(company_id,branch_id,location_id,item_id,quantity_on_hand,average_unit_cost,inventory_value)
      values(rec.company_id,rec.branch_id,rec.target_location_id,rec.target_item_id,0,source_balance.average_unit_cost,0) returning * into target_balance;
    end if;
    insert into boy_central.stock_movements(company_id,branch_id,location_id,item_id,movement_type,quantity_before,quantity_delta,quantity_after,unit_cost_base,movement_value,source_system,external_id,occurred_at,reason)
    values(rec.company_id,rec.branch_id,rec.location_id,rec.item_id,'adjustment',source_balance.quantity_on_hand,-rec.quantity_delta,source_balance.quantity_on_hand-rec.quantity_delta,
      source_balance.average_unit_cost,abs(rec.quantity_delta)*source_balance.average_unit_cost,'stock_reconciliation','reconcile:'||rec.id::text||':source',now(),'คืน movement ที่ POS ส่งเข้า UUID สต็อกกลาง');
    update boy_central.inventory_balances set quantity_on_hand=quantity_on_hand-rec.quantity_delta,
      inventory_value=(quantity_on_hand-rec.quantity_delta)*average_unit_cost,updated_at=now() where id=source_balance.id;
    insert into boy_central.stock_movements(company_id,branch_id,location_id,item_id,movement_type,quantity_before,quantity_delta,quantity_after,unit_cost_base,movement_value,source_system,external_id,occurred_at,reason)
    values(rec.company_id,rec.branch_id,rec.target_location_id,rec.target_item_id,'adjustment',target_balance.quantity_on_hand,rec.quantity_delta,target_balance.quantity_on_hand+rec.quantity_delta,
      target_balance.average_unit_cost,abs(rec.quantity_delta)*target_balance.average_unit_cost,'stock_reconciliation','reconcile:'||rec.id::text||':target',now(),'ย้าย movement ตาม UUID สต็อกกลางจาก POS');
    update boy_central.inventory_balances set quantity_on_hand=quantity_on_hand+rec.quantity_delta,
      inventory_value=(quantity_on_hand+rec.quantity_delta)*average_unit_cost,updated_at=now() where id=target_balance.id;
  end loop;
end $$;

revoke all on function boy_central.get_pos_device_bootstrap(text) from public;
grant execute on function boy_central.get_pos_device_bootstrap(text) to anon,authenticated;
revoke all on function boy_central.sync_pos_event(text,jsonb) from public;
grant execute on function boy_central.sync_pos_event(text,jsonb) to anon,authenticated;
revoke all on function boy_central.sync_pos_stock_adjustment(text,jsonb) from public;
grant execute on function boy_central.sync_pos_stock_adjustment(text,jsonb) to anon,authenticated;

notify pgrst,'reload schema';
