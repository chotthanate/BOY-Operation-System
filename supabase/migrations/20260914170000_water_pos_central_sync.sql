-- Water POS control plane, secure device pairing, event ingestion, and shared stock.
create extension if not exists pgcrypto with schema extensions;

create table boy_central.pos_branch_configs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id),
  branch_id uuid not null references boy_central.branches(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id)
);

create table boy_central.pos_devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id),
  branch_id uuid not null references boy_central.branches(id) on delete cascade,
  device_code text not null,
  device_name text not null,
  status text not null default 'pending' check (status in ('pending','active','revoked')),
  pairing_code_hash text,
  pairing_expires_at timestamptz,
  claim_attempts integer not null default 0,
  access_token_hash text,
  last_seen_at timestamptz,
  last_sync_at timestamptz,
  app_version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, device_code)
);

create table boy_central.pos_sync_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id),
  branch_id uuid not null references boy_central.branches(id) on delete cascade,
  device_id uuid not null references boy_central.pos_devices(id),
  source_system text not null default 'water_pos',
  event_type text not null check (event_type in ('ORDER','VOID','SHIFT_OPEN','SHIFT_CLOSE','STOCK_ADJUST','HEARTBEAT')),
  external_id text not null,
  payload jsonb not null,
  status text not null default 'processed' check (status in ('processed','duplicate','failed')),
  error_message text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique (branch_id, source_system, event_type, external_id)
);

create index pos_devices_branch_status_idx on boy_central.pos_devices(branch_id,status);
create index pos_sync_events_branch_received_idx on boy_central.pos_sync_events(branch_id,received_at desc);
create index pos_sync_events_device_received_idx on boy_central.pos_sync_events(device_id,received_at desc);

create trigger pos_branch_configs_set_updated_at before update on boy_central.pos_branch_configs
for each row execute function boy_central_private.set_updated_at();
create trigger pos_devices_set_updated_at before update on boy_central.pos_devices
for each row execute function boy_central_private.set_updated_at();

alter table boy_central.pos_branch_configs enable row level security;
alter table boy_central.pos_devices enable row level security;
alter table boy_central.pos_sync_events enable row level security;

create policy pos_branch_configs_select on boy_central.pos_branch_configs for select to authenticated
using ((select boy_central_private.has_branch_access(branch_id,null)));
create policy pos_branch_configs_write on boy_central.pos_branch_configs for all to authenticated
using ((select boy_central_private.has_branch_access(branch_id,array['admin','manager'])))
with check ((select boy_central_private.has_branch_access(branch_id,array['admin','manager'])));
create policy pos_devices_select on boy_central.pos_devices for select to authenticated
using ((select boy_central_private.has_branch_access(branch_id,array['admin','manager'])));
create policy pos_devices_write on boy_central.pos_devices for all to authenticated
using ((select boy_central_private.has_branch_access(branch_id,array['admin','manager'])))
with check ((select boy_central_private.has_branch_access(branch_id,array['admin','manager'])));
create policy pos_sync_events_select on boy_central.pos_sync_events for select to authenticated
using ((select boy_central_private.has_branch_access(branch_id,array['admin','manager'])));

revoke all on boy_central.pos_branch_configs,boy_central.pos_devices,boy_central.pos_sync_events from public,anon;
grant select,insert,update on boy_central.pos_branch_configs,boy_central.pos_devices to authenticated;
grant select on boy_central.pos_sync_events to authenticated;

create or replace function boy_central_private.pos_device_for_token(raw_token text)
returns boy_central.pos_devices
language sql stable security definer set search_path=''
as $$
  select d.* from boy_central.pos_devices d
  where d.status='active'
    and d.access_token_hash=encode(extensions.digest(raw_token,'sha256'),'hex')
  limit 1
$$;
revoke all on function boy_central_private.pos_device_for_token(text) from public,anon,authenticated;

create or replace function boy_central.create_pos_pairing_code(target_branch_id uuid,target_device_code text,target_device_name text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare target_branch boy_central.branches%rowtype; code text;
begin
  select * into target_branch from boy_central.branches where id=target_branch_id and active;
  if target_branch.id is null or (select auth.uid()) is null
     or not boy_central_private.has_branch_access(target_branch.id,array['admin','manager']) then
    raise exception 'branch access denied';
  end if;
  if trim(coalesce(target_device_code,''))='' or trim(coalesce(target_device_name,''))='' then
    raise exception 'device code and name are required';
  end if;
  code := lpad((floor(random()*100000000))::bigint::text,8,'0');
  insert into boy_central.pos_devices(company_id,branch_id,device_code,device_name,status,pairing_code_hash,pairing_expires_at,claim_attempts,access_token_hash)
  values(target_branch.company_id,target_branch.id,trim(target_device_code),trim(target_device_name),'pending',encode(extensions.digest(code,'sha256'),'hex'),now()+interval '15 minutes',0,null)
  on conflict(branch_id,device_code) do update set device_name=excluded.device_name,status='pending',pairing_code_hash=excluded.pairing_code_hash,pairing_expires_at=excluded.pairing_expires_at,claim_attempts=0,access_token_hash=null,updated_at=now();
  return jsonb_build_object('pairing_code',code,'expires_at',now()+interval '15 minutes','device_code',trim(target_device_code));
end $$;

create or replace function boy_central.claim_pos_device(target_branch_code text,target_device_code text,pairing_code text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare target_device boy_central.pos_devices%rowtype; raw_token text;
begin
  select d.* into target_device from boy_central.pos_devices d
  join boy_central.branches b on b.id=d.branch_id
  where b.code=target_branch_code and d.device_code=target_device_code for update of d;
  if target_device.id is null then raise exception 'pairing request not found'; end if;
  if target_device.claim_attempts >= 5 then raise exception 'pairing locked; create a new code'; end if;
  update boy_central.pos_devices set claim_attempts=claim_attempts+1 where id=target_device.id;
  if target_device.status<>'pending' or target_device.pairing_expires_at<now()
    or target_device.pairing_code_hash<>encode(extensions.digest(pairing_code,'sha256'),'hex') then
    raise exception 'invalid or expired pairing code';
  end if;
  raw_token := encode(extensions.gen_random_bytes(32),'hex');
  update boy_central.pos_devices set status='active',access_token_hash=encode(extensions.digest(raw_token,'sha256'),'hex'),pairing_code_hash=null,pairing_expires_at=null,claim_attempts=0,last_seen_at=now(),last_sync_at=now() where id=target_device.id;
  return jsonb_build_object('device_token',raw_token,'device_id',target_device.id,'branch_id',target_device.branch_id);
end $$;

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
    'inventory',coalesce((select jsonb_agg(jsonb_build_object(
      'central_item_id',i.id,'code',i.code,'name',i.name,'quantity',coalesce(ib.quantity_on_hand,0),
      'unit',u.name,'low_stock',bi.minimum_stock,'target_stock',bi.target_stock
    ) order by i.name) from boy_central.branch_items bi join boy_central.items i on i.id=bi.item_id
      join boy_central.units u on u.id=i.base_unit_id left join boy_central.inventory_balances ib on ib.branch_id=bi.branch_id and ib.item_id=bi.item_id
      where bi.branch_id=b.id and bi.active and i.track_stock),'[]'::jsonb)
  ) into result from boy_central.branches b join boy_central.companies c on c.id=b.company_id
    left join boy_central.pos_branch_configs cfg on cfg.branch_id=b.id where b.id=d.branch_id;
  return result;
end $$;

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

revoke all on function boy_central.create_pos_pairing_code(uuid,text,text) from public,anon;
grant execute on function boy_central.create_pos_pairing_code(uuid,text,text) to authenticated;
revoke all on function boy_central.claim_pos_device(text,text,text) from public;
grant execute on function boy_central.claim_pos_device(text,text,text) to anon,authenticated;
revoke all on function boy_central.get_pos_device_bootstrap(text) from public;
grant execute on function boy_central.get_pos_device_bootstrap(text) to anon,authenticated;
revoke all on function boy_central.sync_pos_event(text,jsonb) from public;
grant execute on function boy_central.sync_pos_event(text,jsonb) to anon,authenticated;

-- Public POS artwork/QR assets. Upload/update/delete remain protected by Storage RLS.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('boy-pos-assets','boy-pos-assets',true,5242880,array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy boy_pos_assets_admin_insert on storage.objects for insert to authenticated
with check (bucket_id='boy-pos-assets' and exists(select 1 from boy_central.profiles p where p.user_id=(select auth.uid()) and p.active and p.company_role='admin'));
create policy boy_pos_assets_admin_update on storage.objects for update to authenticated
using (bucket_id='boy-pos-assets' and exists(select 1 from boy_central.profiles p where p.user_id=(select auth.uid()) and p.active and p.company_role='admin'))
with check (bucket_id='boy-pos-assets' and exists(select 1 from boy_central.profiles p where p.user_id=(select auth.uid()) and p.active and p.company_role='admin'));
create policy boy_pos_assets_admin_delete on storage.objects for delete to authenticated
using (bucket_id='boy-pos-assets' and exists(select 1 from boy_central.profiles p where p.user_id=(select auth.uid()) and p.active and p.company_role='admin'));

-- Seed shared packaging items for Tawana without hard-coded UUIDs.
do $$
declare branch_row boy_central.branches%rowtype; unit_id uuid; target_location uuid; item_row record;
begin
  select * into branch_row from boy_central.branches where code='TAWANA' limit 1;
  select id into unit_id from boy_central.units where name='ชิ้น' order by code limit 1;
  select id into target_location from boy_central.inventory_locations where branch_id=branch_row.id and active order by code limit 1;
  if branch_row.id is not null and unit_id is not null and target_location is not null then
    insert into boy_central.items(company_id,code,name,base_unit_id,track_stock,purchaseable,issueable,sellable,active,item_type)
    values
      (branch_row.company_id,'WATER-PKG-001','แก้ว',unit_id,true,true,true,false,true,'STOCK_ITEM'),
      (branch_row.company_id,'WATER-PKG-002','ฝาแก้ว',unit_id,true,true,true,false,true,'STOCK_ITEM'),
      (branch_row.company_id,'WATER-PKG-003','ขวด',unit_id,true,true,true,false,true,'STOCK_ITEM'),
      (branch_row.company_id,'WATER-PKG-004','ฝาขวด',unit_id,true,true,true,false,true,'STOCK_ITEM')
    on conflict(company_id,code) do update set name=excluded.name,base_unit_id=excluded.base_unit_id,track_stock=true,active=true;
    for item_row in select id,name from boy_central.items where company_id=branch_row.company_id and code like 'WATER-PKG-%' loop
      insert into boy_central.branch_items(company_id,branch_id,item_id,default_location_id,minimum_stock,reorder_point,target_stock,active)
      values(branch_row.company_id,branch_row.id,item_row.id,target_location,20,20,120,true)
      on conflict(branch_id,item_id) do update set default_location_id=excluded.default_location_id,active=true;
      insert into boy_central.inventory_balances(company_id,branch_id,location_id,item_id,quantity_on_hand,average_unit_cost,inventory_value)
      values(branch_row.company_id,branch_row.id,target_location,item_row.id,case when item_row.name in ('ขวด','ฝาขวด') then 24 else 120 end,0,0)
      on conflict(location_id,item_id) do nothing;
    end loop;
  end if;
end $$;

insert into boy_central.pos_branch_configs(company_id,branch_id,config)
select b.company_id,b.id,jsonb_build_object(
  'store',jsonb_build_object('name','BOY ร้านน้ำ','branchName',b.name,'branchCode',b.code),
  'categories',jsonb_build_array('น้ำปั่น','โยเกิร์ต','น้ำสกัด','ชาและกาแฟ','โซดา','สินค้าสำเร็จรูป'),
  'paymentMethods',jsonb_build_array(
    jsonb_build_object('id','cash','label','เงินสด','type','cash','active',true,'canGiveChange',true),
    jsonb_build_object('id','transfer','label','เงินโอน','type','transfer','active',true,'canGiveChange',false),
    jsonb_build_object('id','government','label','โครงการรัฐ','type','government','active',true,'canGiveChange',false)
  ),
  'settings',jsonb_build_object('vatEnabled',false,'vatRate',7,'vatPriceMode','included','requireOpeningCash',true,'requireClosingCash',true,'businessDayStart','06:00','preventNegativeStock',true,'lowStockAlerts',true),
  'catalogStatus','draft'
) from boy_central.branches b where b.code='TAWANA'
on conflict(branch_id) do nothing;

notify pgrst,'reload schema';
